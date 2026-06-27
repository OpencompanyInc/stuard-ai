import type { IncomingMessage, ServerResponse } from 'http';
import {
  verifyToken, getStorageUsage, upsertStorageUsage,
  createShareLink, getShareLink, revokeShareLinks,
} from '../supabase';
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
  createTtlShareCopy,
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

/** Normalize a user-provided link name into a slug: lowercase, [a-z0-9-]. */
function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function randomSlugSuffix(): string {
  return Math.random().toString(36).slice(2, 6);
}

/** Public base for short links, derived from the incoming request. */
function shortLinkBase(req: IncomingMessage): string {
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || 'http';
  const host = String(req.headers['x-forwarded-host'] || req.headers['host'] || '').split(',')[0].trim();
  return host ? `${proto}://${host}` : '';
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
      const folder = String(body.folder || '').trim();
      const contentType = String(body.contentType || 'application/octet-stream').trim();
      // Set raw=true to skip the Cloudflare proxy rewrite. Use for server-to-
      // server uploads (e.g. desktop main process) so large files aren't capped
      // by Cloudflare's request body limit.
      const raw = body.raw === true;
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

      const result = await generateUserUploadUrl(user.userId, filename, raw, folder, contentType);
      json(res, 200, { ok: true, ...result });
    } catch (e: any) {
      console.error('[cloud-storage] upload-url error:', e?.message);
      json(res, 500, { ok: false, error: 'upload_url_failed', message: e?.message || 'failed' });
    }
    return true;
  }

  // ── POST /v1/cloud-storage/upload-complete ───────────────────────────────
  // Called by clients after a direct-to-GCS signed-URL upload finishes.
  // Recomputes cold_storage_bytes from GCS so billing/UI stay accurate.
  if (method === 'POST' && path === '/v1/cloud-storage/upload-complete') {
    const user = await authenticate(req, res);
    if (!user) return true;
    try {
      const totalBytes = await getUserStorageBytes(user.userId);
      await upsertStorageUsage(user.userId, { cold_storage_bytes: totalBytes });
      json(res, 200, { ok: true, coldStorageBytes: totalBytes });
    } catch (e: any) {
      console.error('[cloud-storage] upload-complete error:', e?.message);
      json(res, 500, { ok: false, error: 'upload_complete_failed', message: e?.message || 'failed' });
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
      if (!result) {
        json(res, 404, { ok: false, error: 'file_not_found' });
        return true;
      }
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
        const visRaw = String(body.visibility || 'private');
        const visibility = (visRaw === 'public' || visRaw === 'ttl' ? visRaw : 'private') as 'public' | 'private' | 'ttl';
        // TTL mode: signed URL valid for a custom duration (capped server-side at 7 days)
        const ttlHours = Math.max(0, Number(body.ttlHours ?? body.ttl_hours ?? 0) || 0);
        const ttlMs = visibility === 'ttl' && ttlHours > 0 ? ttlHours * 60 * 60 * 1000 : undefined;

        if (!filename) {
          json(res, 400, { ok: false, error: 'missing_filename' });
          return true;
        }
        if (!b64data) {
          json(res, 400, { ok: false, error: 'missing_data', message: 'Provide base64-encoded file data in "data" field' });
          return true;
        }

        const buffer = Buffer.from(b64data, 'base64');
        console.log(`[cloud-storage] upload (json): user=${user.userId} file=${filename} folder=${folderPath || '/'} size=${buffer.length} type=${fileContentType} vis=${visibility}${ttlMs ? ` ttl=${ttlMs}ms` : ''}`);
        const result = await uploadUserFileBuffer(user.userId, filename, buffer, fileContentType, folderPath, visibility, ttlMs);
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
          ...(result.expiresAt ? { expiresAt: new Date(result.expiresAt).toISOString() } : {}),
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

  // ── POST /v1/cloud-storage/share-url ─────────────────────────────────────
  // Generate a shareable link for a file:
  //   mode "public"  → copy to public bucket, permanent branded URL
  //   mode "ttl"     → signed URL valid for ttlHours (capped at 7 days)
  //   mode "private" → revoke public access (delete public-bucket copy)
  if (method === 'POST' && path === '/v1/cloud-storage/share-url') {
    const user = await authenticate(req, res);
    if (!user) return true;
    try {
      const body = await readBody(req);
      let objectName = String(body.objectName || '').trim();
      const mode = String(body.mode || '').trim();
      if (!objectName) {
        json(res, 400, { ok: false, error: 'missing_object_name' });
        return true;
      }
      if (mode !== 'public' && mode !== 'ttl' && mode !== 'private') {
        json(res, 400, { ok: false, error: 'invalid_mode', valid: ['public', 'ttl', 'private'] });
        return true;
      }
      if (!objectName.startsWith(`${user.userId}/`)) {
        objectName = `${user.userId}/${objectName}`;
      }
      if (!validateObjectName(objectName)) {
        json(res, 400, { ok: false, error: 'invalid_object_name' });
        return true;
      }

      if (mode === 'private') {
        await makeFilePrivate(user.userId, objectName);
        await revokeShareLinks(user.userId, objectName);
        json(res, 200, { ok: true, mode, objectName });
        return true;
      }

      // Optional custom slug + download-vs-preview behaviour
      const rawLinkName = String(body.linkName ?? body.link_name ?? '').trim();
      const dispRaw = String(body.disposition || 'inline');
      const disposition = (dispRaw === 'attachment' ? 'attachment' : 'inline') as 'inline' | 'attachment';
      let customSlug = '';
      if (rawLinkName) {
        customSlug = slugify(rawLinkName);
        if (customSlug.length < 3) {
          json(res, 400, { ok: false, error: 'invalid_link_name', message: 'Link names need at least 3 letters or numbers.' });
          return true;
        }
      }

      // Create the public copy (permanent or expiring)
      let directUrl: string;
      let expiresAtIso: string | null = null;
      if (mode === 'public') {
        // Branded storage.stuard.ai URL — safe for public objects (no query
        // string). Signed URLs can't go through the proxy (it strips the
        // query string carrying the V4 signature), hence public copies.
        const { publicUrl } = await makeFilePublic(user.userId, objectName, disposition);
        directUrl = publicUrl;
      } else {
        // Fractional hours allowed (0.5 = 30 minutes); clamped to [1min, 7d].
        const ttlHours = Math.max(0, Number(body.ttlHours ?? body.ttl_hours ?? 0) || 0);
        if (ttlHours <= 0) {
          json(res, 400, { ok: false, error: 'missing_ttl_hours' });
          return true;
        }
        const { url, expiresAt } = await createTtlShareCopy(user.userId, objectName, ttlHours * 60 * 60 * 1000, disposition);
        directUrl = url;
        expiresAtIso = new Date(expiresAt).toISOString();
      }

      // Register the short link (/s/<slug>). Auto slugs retry on collision;
      // custom names report the conflict so the user can pick another.
      const filenameBase = slugify((objectName.split('/').pop() || 'file').replace(/\.[^.]+$/, '')).slice(0, 24) || 'file';
      let slug = customSlug || `${filenameBase}-${randomSlugSuffix()}`;
      let shortUrl: string | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const created = await createShareLink({
          slug,
          user_id: user.userId,
          object_name: objectName,
          mode,
          disposition,
          expires_at: expiresAtIso,
        });
        if (created.ok) {
          const base = shortLinkBase(req);
          shortUrl = base ? `${base}/s/${slug}` : null;
          break;
        }
        if (created.error === 'slug_taken') {
          if (customSlug) {
            json(res, 409, { ok: false, error: 'link_name_taken', message: `"${customSlug}" is already in use. Try another name.` });
            return true;
          }
          slug = `${filenameBase}-${randomSlugSuffix()}`;
          continue;
        }
        console.warn('[cloud-storage] share link insert failed:', created.error);
        break; // fall through with the direct URL only
      }

      json(res, 200, {
        ok: true,
        mode,
        url: directUrl,
        ...(shortUrl ? { shortUrl, slug } : {}),
        objectName,
        ...(expiresAtIso ? { expiresAt: expiresAtIso } : {}),
      });
    } catch (e: any) {
      console.error('[cloud-storage] share-url error:', e?.message);
      json(res, 500, { ok: false, error: 'share_url_failed', message: e?.message || 'failed' });
    }
    return true;
  }

  // ── GET /v1/cloud-storage/files ───────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// Short share links — GET /s/<slug> (public, no auth)
// ─────────────────────────────────────────────────────────────────────────────

function shareErrorPage(res: ServerResponse, status: number, title: string, detail: string): void {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Stuard</title><style>
  body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0c0a09;color:#fafaf9;font-family:system-ui,-apple-system,sans-serif}
  .card{text-align:center;padding:48px 40px;max-width:380px}
  .dot{width:48px;height:48px;border-radius:16px;background:rgba(229,72,77,.12);display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:22px}
  h1{font-size:19px;margin:0 0 8px;font-weight:650;letter-spacing:-.01em}
  p{font-size:13.5px;line-height:1.6;color:#a8a29e;margin:0}
  </style></head><body><div class="card"><div class="dot">🔗</div><h1>${title}</h1><p>${detail}</p></div></body></html>`;
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}

/** Resolve /s/<slug> short links → 302 to the public file URL. */
export async function handleShareLinkRoutes(req: IncomingMessage, res: ServerResponse, parsedUrl: URL): Promise<boolean> {
  const path = parsedUrl.pathname;
  if (!path.startsWith('/s/')) return false;
  if ((req.method || '') !== 'GET' && (req.method || '') !== 'HEAD') return false;

  const slug = decodeURIComponent(path.slice(3)).trim().toLowerCase();
  if (!slug || slug.includes('/')) {
    shareErrorPage(res, 404, 'Link not found', 'This share link doesn’t exist. Double-check the URL.');
    return true;
  }

  const link = await getShareLink(slug);
  if (!link) {
    shareErrorPage(res, 404, 'Link not found', 'This share link doesn’t exist. Double-check the URL.');
    return true;
  }
  if (link.revoked) {
    shareErrorPage(res, 410, 'Link revoked', 'The owner removed access to this file.');
    return true;
  }
  if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) {
    shareErrorPage(res, 410, 'Link expired', 'This share link has expired and no longer works.');
    return true;
  }

  res.writeHead(302, {
    Location: getPublicUrl(link.object_name),
    'Cache-Control': 'no-store',
  });
  res.end();
  return true;
}
