import type { IncomingMessage, ServerResponse } from 'http';
import { verifyToken, getStorageUsage, upsertStorageUsage } from '../supabase';
import {
  generateUserUploadUrl,
  generateUserDownloadUrl,
  getUserStorageBytes,
  deleteUserFile,
  validateObjectName,
  uploadUserFileStream,
  uploadUserFileBuffer,
  listUserFiles,
  createFolder,
  renameUserFile,
  makeFilePublic,
  makeFilePrivate,
  getPublicUrl,
} from '../services/cold-storage';
import { checkColdStorageQuota } from '../services/hot-storage';

// ─────────────────────────────────────────────────────────────────────────────
// Security Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Max upload size: 2 GB (enforced via Content-Length + streaming byte count) */
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

/** Max files returned by list endpoint (prevents OOM on huge prefixes) */
const MAX_LIST_FILES = 1000;

/** Per-user upload rate limit: max uploads per window */
const UPLOAD_RATE_LIMIT = 30;
const UPLOAD_RATE_WINDOW_MS = 60_000;
const uploadRateBuckets = new Map<string, { count: number; resetAt: number }>();

function checkUploadRate(userId: string): boolean {
  const now = Date.now();
  const bucket = uploadRateBuckets.get(userId);
  if (!bucket || now > bucket.resetAt) {
    uploadRateBuckets.set(userId, { count: 1, resetAt: now + UPLOAD_RATE_WINDOW_MS });
    return true;
  }
  bucket.count++;
  return bucket.count <= UPLOAD_RATE_LIMIT;
}

// Cleanup stale buckets every 5 min
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of uploadRateBuckets) {
    if (now > v.resetAt) uploadRateBuckets.delete(k);
  }
}, 5 * 60_000).unref();

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function json(res: ServerResponse, status: number, body: any): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage, maxBytes = 1024 * 1024): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('body_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('invalid_json'));
      }
    });
    req.on('error', reject);
  });
}

async function authenticate(req: IncomingMessage, res: ServerResponse): Promise<{ userId: string; email?: string } | null> {
  const auth = String(req.headers['authorization'] || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const user = token ? await verifyToken(token) : null;
  if (!user) {
    json(res, 401, { ok: false, error: 'unauthorized' });
    return null;
  }
  return user;
}

// ─────────────────────────────────────────────────────────────────────────────
// Route Handler
// ─────────────────────────────────────────────────────────────────────────────

export async function handleCloudStorageRoutes(req: IncomingMessage, res: ServerResponse, parsedUrl: URL): Promise<boolean> {
  const path = parsedUrl.pathname;
  const method = req.method || '';

  if (!path.startsWith('/v1/cloud-storage')) return false;

  // ── CORS preflight ───────────────────────────────────────────────────────
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Filename, X-File-Path',
      'Access-Control-Max-Age': '86400',
    });
    res.end();
    return true;
  }

  // ── POST /v1/cloud-storage/upload-url ────────────────────────────────────
  if (method === 'POST' && path === '/v1/cloud-storage/upload-url') {
    const user = await authenticate(req, res);
    if (!user) return true;
    try {
      const body = await readBody(req);
      const filename = String(body.filename || '').trim();
      if (!filename) {
        json(res, 400, { ok: false, error: 'missing_filename' });
        return true;
      }

      // Check cold storage quota before generating upload URL
      const quota = await checkColdStorageQuota(user.userId);
      if (!quota.withinQuota) {
        json(res, 403, {
          ok: false,
          error: 'cold_storage_quota_exceeded',
          usedGb: Number(quota.usedGb.toFixed(2)),
          quotaGb: quota.quotaGb,
          message: 'Cold storage quota exceeded. Upgrade your storage plan.',
        });
        return true;
      }

      const result = await generateUserUploadUrl(user.userId, filename);
      json(res, 200, { ok: true, ...result });
    } catch (e: any) {
      console.error('[cloud-storage] upload-url error:', e?.message);
      json(res, 500, { ok: false, error: 'upload_url_failed', message: e?.message || 'failed' });
    }
    return true;
  }

  // ── POST /v1/cloud-storage/download-url ──────────────────────────────────
  if (method === 'POST' && path === '/v1/cloud-storage/download-url') {
    const user = await authenticate(req, res);
    if (!user) return true;
    try {
      const body = await readBody(req);
      let objectName = String(body.objectName || '').trim();
      if (!objectName) {
        json(res, 400, { ok: false, error: 'missing_object_name' });
        return true;
      }
      // Auto-prepend user prefix if missing
      if (!objectName.startsWith(`${user.userId}/`)) {
        objectName = `${user.userId}/${objectName}`;
      }
      if (!validateObjectName(objectName)) {
        json(res, 400, { ok: false, error: 'invalid_object_name' });
        return true;
      }

      const result = await generateUserDownloadUrl(user.userId, objectName);
      json(res, 200, { ok: true, ...result });
    } catch (e: any) {
      console.error('[cloud-storage] download-url error:', e?.message);
      json(res, 500, { ok: false, error: 'download_url_failed', message: e?.message || 'failed' });
    }
    return true;
  }

  // ── GET /v1/cloud-storage/usage ──────────────────────────────────────────
  if (method === 'GET' && path === '/v1/cloud-storage/usage') {
    const user = await authenticate(req, res);
    if (!user) return true;
    try {
      const storageUsage = await getStorageUsage(user.userId);
      const totalBytes = await getUserStorageBytes(user.userId);

      json(res, 200, {
        ok: true,
        coldStorageBytes: totalBytes,
        hotStorageGb: Number(storageUsage?.hot_storage_gb || 0),
        storagePlanId: storageUsage?.storage_plan_id || 'free',
        storageQuotaGb: Number(storageUsage?.storage_quota_gb || 5),
        coldQuotaGb: Number(storageUsage?.cold_quota_gb || 1),
        backupObjectName: storageUsage?.backup_object_name || null,
        lastSyncAt: storageUsage?.last_sync_at || null,
      });
    } catch (e: any) {
      console.error('[cloud-storage] usage error:', e?.message);
      json(res, 500, { ok: false, error: 'usage_failed', message: e?.message || 'failed' });
    }
    return true;
  }

  // ── DELETE /v1/cloud-storage/file ────────────────────────────────────────
  if (method === 'DELETE' && path === '/v1/cloud-storage/file') {
    const user = await authenticate(req, res);
    if (!user) return true;
    try {
      const body = await readBody(req);
      let objectName = String(body.objectName || '').trim();
      if (!objectName) {
        json(res, 400, { ok: false, error: 'missing_object_name' });
        return true;
      }
      // Auto-prepend user prefix if missing
      if (!objectName.startsWith(`${user.userId}/`)) {
        objectName = `${user.userId}/${objectName}`;
      }
      if (!validateObjectName(objectName)) {
        json(res, 400, { ok: false, error: 'invalid_object_name' });
        return true;
      }

      await deleteUserFile(user.userId, objectName);

      // Update cold_storage_bytes after deletion
      try {
        const totalBytes = await getUserStorageBytes(user.userId);
        await upsertStorageUsage(user.userId, { cold_storage_bytes: totalBytes });
      } catch (e: any) {
        console.warn('[cloud-storage] failed to update cold_storage_bytes after delete:', e?.message);
      }

      json(res, 200, { ok: true, message: 'File deleted' });
    } catch (e: any) {
      console.error('[cloud-storage] delete error:', e?.message);
      json(res, 500, { ok: false, error: 'delete_failed', message: e?.message || 'failed' });
    }
    return true;
  }

  // ── POST /v1/cloud-storage/upload ────────────────────────────────────────
  // Two modes:
  //   1. Raw stream: file body streamed directly, metadata in headers (X-Filename, X-File-Path)
  //   2. JSON + base64: Content-Type: application/json with { filename, data (base64), folder?, contentType? }
  //      This mode avoids Electron net.fetch issues with binary request bodies.
  if (method === 'POST' && path === '/v1/cloud-storage/upload') {
    const user = await authenticate(req, res);
    if (!user) return true;
    try {
      const reqContentType = String(req.headers['content-type'] || '').toLowerCase();
      const isJsonUpload = reqContentType.includes('application/json');

      // Check quota before uploading (non-fatal on error — allow upload if quota check fails)
      try {
        const quota = await checkColdStorageQuota(user.userId);
        if (!quota.withinQuota) {
          json(res, 403, {
            ok: false,
            error: 'cold_storage_quota_exceeded',
            usedGb: Number(quota.usedGb.toFixed(2)),
            quotaGb: quota.quotaGb,
            message: 'Cold storage quota exceeded. Upgrade your storage plan.',
          });
          return true;
        }
      } catch (quotaErr: any) {
        console.warn('[cloud-storage] quota check failed, allowing upload:', quotaErr?.message);
      }

      // Rate limit uploads
      if (!checkUploadRate(user.userId)) {
        json(res, 429, { ok: false, error: 'rate_limited', message: 'Too many uploads. Wait and try again.' });
        return true;
      }

      if (isJsonUpload) {
        // ── JSON + base64 mode (used by Electron desktop client) ──
        const body = await readBody(req, MAX_UPLOAD_BYTES);
        const filename = String(body.filename || '').trim();
        const b64data = String(body.data || '').trim();
        const folderPath = String(body.folder || '').trim();
        const fileContentType = String(body.contentType || 'application/octet-stream');
        const visibility = (body.visibility === 'public' ? 'public' : 'private') as 'public' | 'private';

        if (!filename) {
          json(res, 400, { ok: false, error: 'missing_filename' });
          return true;
        }
        if (!b64data) {
          json(res, 400, { ok: false, error: 'missing_data', message: 'Provide base64-encoded file data in "data" field' });
          return true;
        }

        const buffer = Buffer.from(b64data, 'base64');
        console.log(`[cloud-storage] upload (json): user=${user.userId} file=${filename} folder=${folderPath || '/'} size=${buffer.length} type=${fileContentType} vis=${visibility}`);
        const result = await uploadUserFileBuffer(user.userId, filename, buffer, fileContentType, folderPath, visibility);
        console.log(`[cloud-storage] upload complete: ${result.objectName} (${result.bytesWritten} bytes, url=${result.url ? 'yes' : 'none'})`);

        // Update cold_storage_bytes so billing and UI stay accurate
        try {
          const totalBytes = await getUserStorageBytes(user.userId);
          await upsertStorageUsage(user.userId, { cold_storage_bytes: totalBytes });
        } catch (e: any) {
          console.warn('[cloud-storage] failed to update cold_storage_bytes after upload:', e?.message);
        }

        json(res, 200, {
          ok: true,
          objectName: result.objectName,
          bytesWritten: result.bytesWritten,
          url: result.url,
          visibility: result.visibility,
        });
      } else {
        // ── Raw stream mode (original behavior) ──
        const filename = String(req.headers['x-filename'] || '').trim();
        if (!filename) {
          json(res, 400, { ok: false, error: 'missing_filename', message: 'Set X-Filename header' });
          return true;
        }

        // Enforce upload size limit via Content-Length header
        const declaredSize = parseInt(String(req.headers['content-length'] || '0'), 10);
        if (declaredSize > MAX_UPLOAD_BYTES) {
          json(res, 413, { ok: false, error: 'file_too_large', maxBytes: MAX_UPLOAD_BYTES });
          return true;
        }

        // Verify request body is still readable
        if (req.destroyed || req.readableEnded) {
          json(res, 400, { ok: false, error: 'request_body_unavailable', message: 'Request body was closed before upload could start.' });
          return true;
        }

        const contentType = String(req.headers['content-type'] || 'application/octet-stream');
        const folderPath = String(req.headers['x-file-path'] || '').trim();
        console.log(`[cloud-storage] upload starting: user=${user.userId} file=${filename} folder=${folderPath || '/'} size=${req.headers['content-length'] || 'unknown'} type=${contentType}`);
        const result = await uploadUserFileStream(user.userId, filename, req, contentType, MAX_UPLOAD_BYTES, folderPath);
        console.log(`[cloud-storage] upload complete: ${result.objectName} (${result.bytesWritten} bytes)`);

        // Update cold_storage_bytes so billing and UI stay accurate
        try {
          const totalBytes = await getUserStorageBytes(user.userId);
          await upsertStorageUsage(user.userId, { cold_storage_bytes: totalBytes });
        } catch (e: any) {
          console.warn('[cloud-storage] failed to update cold_storage_bytes after upload:', e?.message);
        }

        json(res, 200, { ok: true, objectName: result.objectName, bytesWritten: result.bytesWritten });
      }
    } catch (e: any) {
      console.error('[cloud-storage] upload error:', e?.stack || e?.message || e);
      const detail = e?.message || 'Unknown upload error';
      json(res, 500, { ok: false, error: 'upload_failed', message: detail });
    }
    return true;
  }

  // ── POST /v1/cloud-storage/create-folder ─────────────────────────────────
  if (method === 'POST' && path === '/v1/cloud-storage/create-folder') {
    const user = await authenticate(req, res);
    if (!user) return true;
    try {
      const body = await readBody(req);
      const folderPath = String(body.path || '').trim();
      if (!folderPath) {
        json(res, 400, { ok: false, error: 'missing_path' });
        return true;
      }
      const result = await createFolder(user.userId, folderPath);
      json(res, 200, { ok: true, objectName: result.objectName });
    } catch (e: any) {
      console.error('[cloud-storage] create-folder error:', e?.message);
      json(res, 500, { ok: false, error: 'create_folder_failed', message: e?.message || 'failed' });
    }
    return true;
  }

  // ── POST /v1/cloud-storage/rename ─────────────────────────────────────────
  if (method === 'POST' && path === '/v1/cloud-storage/rename') {
    const user = await authenticate(req, res);
    if (!user) return true;
    try {
      const body = await readBody(req);
      const oldName = String(body.oldName || '').trim();
      const newName = String(body.newName || '').trim();
      if (!oldName || !newName) {
        json(res, 400, { ok: false, error: 'missing_names' });
        return true;
      }
      const result = await renameUserFile(user.userId, oldName, newName);
      json(res, 200, { ok: true, objectName: result.objectName });
    } catch (e: any) {
      console.error('[cloud-storage] rename error:', e?.message);
      json(res, 500, { ok: false, error: 'rename_failed', message: e?.message || 'failed' });
    }
    return true;
  }

  // ── POST /v1/cloud-storage/set-visibility ────────────────────────────────
  // Change file visibility between public and private.
  if (method === 'POST' && path === '/v1/cloud-storage/set-visibility') {
    const user = await authenticate(req, res);
    if (!user) return true;
    try {
      const body = await readBody(req);
      let objectName = String(body.objectName || '').trim();
      const visibility = String(body.visibility || '').trim();
      if (!objectName) {
        json(res, 400, { ok: false, error: 'missing_object_name' });
        return true;
      }
      if (visibility !== 'public' && visibility !== 'private') {
        json(res, 400, { ok: false, error: 'invalid_visibility', valid: ['public', 'private'] });
        return true;
      }
      if (!objectName.startsWith(`${user.userId}/`)) {
        objectName = `${user.userId}/${objectName}`;
      }
      if (!validateObjectName(objectName)) {
        json(res, 400, { ok: false, error: 'invalid_object_name' });
        return true;
      }

      if (visibility === 'public') {
        const { publicUrl } = await makeFilePublic(user.userId, objectName);
        json(res, 200, { ok: true, visibility: 'public', url: publicUrl, objectName });
      } else {
        await makeFilePrivate(user.userId, objectName);
        json(res, 200, { ok: true, visibility: 'private', objectName });
      }
    } catch (e: any) {
      console.error('[cloud-storage] set-visibility error:', e?.message);
      json(res, 500, { ok: false, error: 'set_visibility_failed', message: e?.message || 'failed' });
    }
    return true;
  }

  // ── GET /v1/cloud-storage/files ──────────────────────────────────────────
  // List files in the user's GCS prefix.
  if (method === 'GET' && path === '/v1/cloud-storage/files') {
    const user = await authenticate(req, res);
    if (!user) return true;
    try {
      const prefix = parsedUrl.searchParams.get('prefix') || '';
      const files = await listUserFiles(user.userId, prefix || undefined);
      json(res, 200, { ok: true, files });
    } catch (e: any) {
      console.error('[cloud-storage] list-files error:', e?.message);
      json(res, 500, { ok: false, error: 'list_failed', message: e?.message || 'failed' });
    }
    return true;
  }

  return false;
}
