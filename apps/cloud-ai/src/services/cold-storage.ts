import { Storage } from '@google-cloud/storage';
import { Readable, Transform } from 'stream';
import { CLOUD_ENGINE_BUCKET, GCP_KEY_FILE, STORAGE_PUBLIC_BASE_URL } from '../utils/config';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const UPLOAD_URL_TTL_MS = 15 * 60 * 1000;    // 15 minutes
const DOWNLOAD_URL_TTL_MS = 60 * 60 * 1000;  // 1 hour
const MAX_SIGNED_URL_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days (v4 max)
const MAX_FILENAME_LENGTH = 255;
const VALID_OBJECT_NAME_RE = /^[a-zA-Z0-9_\-./() @+,!#%&=~]+$/;

/** Public bucket name — derived from the private bucket name + "-public" suffix. */
const PUBLIC_BUCKET = `${CLOUD_ENGINE_BUCKET}-public`;

/**
 * Object names (relative to the `{userId}/` prefix) that are Stuard-managed
 * system artifacts, NOT files the user uploaded. They're hidden from file
 * listings and reported separately in the storage breakdown so the dashboard's
 * "your files" view and totals reconcile (and users can't delete their backup).
 */
const SYSTEM_OBJECT_NAMES = new Set<string>(['memory_backup.tar.gz']);

// ─────────────────────────────────────────────────────────────────────────────
// Filename Sanitization
// ─────────────────────────────────────────────────────────────────────────────

function sanitizeFilename(filename: string): string {
  let sanitized = filename
    .replace(/\\/g, '_')          // backslashes
    .replace(/\//g, '_')          // forward slashes
    .replace(/\.\./g, '_')        // path traversal
    .replace(/[\x00-\x1f]/g, '') // control chars
    .replace(/[\x7f]/g, '')      // DEL
    .trim();
  if (!sanitized) sanitized = 'unnamed';
  if (sanitized.length > MAX_FILENAME_LENGTH) {
    sanitized = sanitized.slice(0, MAX_FILENAME_LENGTH);
  }
  return sanitized;
}

/** Validate an object name is safe (no traversal, valid characters). */
export function validateObjectName(objectName: string): boolean {
  if (!objectName || objectName.length > 1024) return false;
  if (!VALID_OBJECT_NAME_RE.test(objectName)) return false;
  if (objectName.includes('..')) return false;
  return true;
}

/** Verify an object path belongs to the given user prefix. */
function assertUserPrefix(userId: string, objectName: string): void {
  if (!objectName.startsWith(`${userId}/`)) {
    throw new Error('Object does not belong to this user');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Storage Instances
// ─────────────────────────────────────────────────────────────────────────────

let _storage: Storage | null = null;
function getStorage(): Storage {
  if (!_storage) {
    // Prefer explicit key file; fall back to Application Default Credentials
    _storage = GCP_KEY_FILE
      ? new Storage({ keyFilename: GCP_KEY_FILE })
      : new Storage();
  }
  return _storage;
}

/** Private bucket — default for all files. */
function getBucket() {
  return getStorage().bucket(CLOUD_ENGINE_BUCKET);
}

/** Public bucket — allUsers have objectViewer. Files here are permanently public. */
function getPublicBucket() {
  return getStorage().bucket(PUBLIC_BUCKET);
}

// ─────────────────────────────────────────────────────────────────────────────
// URL Builders
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the permanent public URL for an object in the public bucket.
 * Routes through storage.stuard.ai (Cloudflare Worker → GCS).
 */
export function getPublicUrl(objectName: string): string {
  const base = STORAGE_PUBLIC_BASE_URL || 'https://storage.googleapis.com';
  return `${base.replace(/\/+$/, '')}/${PUBLIC_BUCKET}/${objectName}`;
}

/**
 * Rewrite a GCS signed URL to route through storage.stuard.ai.
 * The Cloudflare Worker proxies to storage.googleapis.com, so the signature stays valid.
 */
function rewriteSignedUrl(signedUrl: string): string {
  if (!STORAGE_PUBLIC_BASE_URL) return signedUrl;
  return signedUrl.replace('https://storage.googleapis.com', STORAGE_PUBLIC_BASE_URL.replace(/\/+$/, ''));
}

// ─────────────────────────────────────────────────────────────────────────────
// Upload Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a signed upload URL for a user file.
 * @param raw If true, returns raw GCS URL without Cloudflare proxy rewrite (use for VM-destined URLs).
 * @param folderPath Optional subfolder path (e.g. "videos/2026"); each segment is sanitised.
 * @param contentType Bound to the signed URL — the client MUST PUT with the same Content-Type.
 */
export async function generateUserUploadUrl(
  userId: string,
  filename: string,
  raw = false,
  folderPath = '',
  contentType = 'application/octet-stream',
): Promise<{ uploadUrl: string; objectName: string; contentType: string }> {
  const safe = sanitizeFilename(filename);
  const prefix = folderPath
    ? folderPath.split('/').map(s => sanitizeFilename(s)).filter(Boolean).join('/')
    : '';
  const objectName = prefix ? `${userId}/${prefix}/${safe}` : `${userId}/${safe}`;

  const file = getBucket().file(objectName);
  const expires = Date.now() + UPLOAD_URL_TTL_MS;
  const [uploadUrl] = await file.getSignedUrl({
    version: 'v4',
    action: 'write',
    expires,
    contentType,
  });

  return { uploadUrl: raw ? uploadUrl : rewriteSignedUrl(uploadUrl), objectName, contentType };
}

/**
 * Stream-upload a raw body (readable stream) to a user's GCS path.
 * Used by the proxy-upload endpoint to avoid client-side CORS issues.
 */
export async function uploadUserFileStream(
  userId: string,
  filename: string,
  body: Readable,
  contentType = 'application/octet-stream',
  maxBytes = 2 * 1024 * 1024 * 1024,
  /** Optional subfolder path (e.g. "photos/2024") — segments are sanitised individually */
  folderPath = '',
): Promise<{ objectName: string; bytesWritten: number }> {
  const safe = sanitizeFilename(filename);
  // Build the full key: {userId}/{folderPath}/{filename}
  const prefix = folderPath
    ? folderPath.split('/').map(s => sanitizeFilename(s)).filter(Boolean).join('/')
    : '';
  const objectName = prefix ? `${userId}/${prefix}/${safe}` : `${userId}/${safe}`;

  const file = getBucket().file(objectName);
  const writeStream = file.createWriteStream({
    resumable: true,          // resumable upload for large files (video etc.)
    contentType,
    metadata: { contentType },
  });

  return new Promise((resolve, reject) => {
    let bytesWritten = 0;
    let rejected = false;

    // Use a Transform stream to count bytes while piping,
    // avoiding the dual-listener issue with body.on('data') + body.pipe().
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytesWritten += chunk.length;
        if (bytesWritten > maxBytes && !rejected) {
          rejected = true;
          body.destroy();
          writeStream.destroy();
          // Best-effort: delete partial upload
          file.delete({ ignoreNotFound: true }).catch(() => {});
          callback(new Error('upload_size_limit_exceeded'));
          return;
        }
        callback(null, chunk);
      },
    });

    body.pipe(counter).pipe(writeStream);

    writeStream.on('finish', () => {
      if (!rejected) resolve({ objectName, bytesWritten });
    });
    writeStream.on('error', (err) => {
      if (!rejected) {
        rejected = true;
        reject(err);
      }
    });
    counter.on('error', (err) => {
      if (!rejected) {
        rejected = true;
        reject(err);
      }
    });
    body.on('error', (err) => {
      if (!rejected) {
        rejected = true;
        reject(err);
      }
    });
  });
}

/**
 * Upload raw buffer data to a user's GCS path.
 *
 * Visibility modes:
 *  - "private" → uploaded to the private bucket, returns a 1-hour signed URL
 *  - "public"  → uploaded to the public bucket, returns a permanent URL (never expires)
 *  - "ttl"     → uploaded to the private bucket, returns a signed URL with custom ttlMs
 */
export async function uploadUserFileBuffer(
  userId: string,
  filename: string,
  data: Buffer,
  contentType = 'application/octet-stream',
  folderPath = '',
  visibility: 'private' | 'public' | 'ttl' = 'private',
  ttlMs?: number,
): Promise<{ objectName: string; bytesWritten: number; url: string; visibility: 'private' | 'public' | 'ttl' }> {
  const safe = sanitizeFilename(filename);
  const prefix = folderPath
    ? folderPath.split('/').map(s => sanitizeFilename(s)).filter(Boolean).join('/')
    : '';
  const objectName = prefix ? `${userId}/${prefix}/${safe}` : `${userId}/${safe}`;

  let url: string;

  if (visibility === 'public') {
    // Upload directly to the public bucket — permanently accessible
    const file = getPublicBucket().file(objectName);
    await file.save(data, {
      contentType,
      resumable: data.length > 5 * 1024 * 1024,
      metadata: { contentType },
    });
    url = getPublicUrl(objectName);
  } else {
    // Upload to private bucket
    const file = getBucket().file(objectName);
    await file.save(data, {
      contentType,
      resumable: data.length > 5 * 1024 * 1024,
      metadata: { contentType },
    });

    // Generate signed URL with appropriate TTL
    const expires = visibility === 'ttl' && ttlMs
      ? Date.now() + Math.min(ttlMs, MAX_SIGNED_URL_TTL_MS)
      : Date.now() + DOWNLOAD_URL_TTL_MS;
    const [signedUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires,
    });
    url = rewriteSignedUrl(signedUrl);
  }

  return { objectName, bytesWritten: data.length, url, visibility };
}

// ─────────────────────────────────────────────────────────────────────────────
// File Operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List user files in their storage prefix.
 */
export async function listUserFiles(
  userId: string,
  prefix?: string,
  maxResults = 1000,
): Promise<Array<{ name: string; size: number; updated: string; contentType: string }>> {
  const fullPrefix = prefix ? `${userId}/${prefix}` : `${userId}/`;
  const [files] = await getBucket().getFiles({ prefix: fullPrefix, maxResults });

  return files
    .map(f => ({
      name: String(f.name).replace(`${userId}/`, ''),
      size: Number(f.metadata.size || 0),
      updated: String(f.metadata.updated || f.metadata.timeCreated || ''),
      contentType: String(f.metadata.contentType || 'application/octet-stream'),
    }))
    // Hide Stuard-managed system artifacts (e.g. the workspace backup) — they
    // aren't user files and showing them makes usage numbers look wrong and
    // invites accidental deletion of the backup.
    .filter(f => !SYSTEM_OBJECT_NAMES.has(f.name));
}

/**
 * Sum a user's stored bytes split into their own files vs Stuard-managed
 * system artifacts (the workspace backup). `totalBytes` is what's billed and
 * counts against quota; `fileBytes` is what the dashboard's file list shows.
 */
export async function getUserStorageBreakdown(
  userId: string,
): Promise<{ totalBytes: number; fileBytes: number; backupBytes: number }> {
  const prefix = `${userId}/`;
  const [files] = await getBucket().getFiles({ prefix });
  let totalBytes = 0;
  let backupBytes = 0;
  for (const file of files) {
    const size = Number(file.metadata.size || 0);
    totalBytes += size;
    if (SYSTEM_OBJECT_NAMES.has(String(file.name).slice(prefix.length))) {
      backupBytes += size;
    }
  }
  return { totalBytes, fileBytes: totalBytes - backupBytes, backupBytes };
}

/**
 * Create a zero-byte "folder placeholder" so the folder shows up in listings.
 * GCS doesn't have real folders — we store a 0-byte object ending in /.
 */
export async function createFolder(
  userId: string,
  folderPath: string,
): Promise<{ objectName: string }> {
  const parts = folderPath.split('/').map(s => sanitizeFilename(s)).filter(Boolean);
  if (parts.length === 0) throw new Error('invalid_folder_path');
  const objectName = `${userId}/${parts.join('/')}/`;
  const file = getBucket().file(objectName);
  await file.save('', { contentType: 'application/x-directory' });
  return { objectName };
}

/**
 * Rename / move a user file by copying + deleting the original.
 */
export async function renameUserFile(
  userId: string,
  oldName: string,
  newName: string,
): Promise<{ objectName: string }> {
  const srcKey = oldName.startsWith(`${userId}/`) ? oldName : `${userId}/${oldName}`;
  const safeNew = newName.split('/').map(s => sanitizeFilename(s)).filter(Boolean).join('/');
  const destKey = `${userId}/${safeNew}`;
  if (srcKey === destKey) return { objectName: destKey };

  const srcFile = getBucket().file(srcKey);
  const destFile = getBucket().file(destKey);
  await srcFile.copy(destFile);
  await srcFile.delete({ ignoreNotFound: true });
  return { objectName: destKey };
}

/**
 * Generate a signed download URL for a user file. Returns null if the object does not exist.
 * @param raw If true, returns raw GCS URL without Cloudflare proxy rewrite (use for VM-destined URLs).
 */
export async function generateUserDownloadUrl(
  userId: string,
  objectName: string,
  raw = false,
): Promise<{ downloadUrl: string } | null> {
  assertUserPrefix(userId, objectName);

  const file = getBucket().file(objectName);
  const [exists] = await file.exists();
  if (!exists) return null;

  const expires = Date.now() + DOWNLOAD_URL_TTL_MS;
  const [downloadUrl] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires,
  });

  return { downloadUrl: raw ? downloadUrl : rewriteSignedUrl(downloadUrl) };
}

/** Get total bytes stored for a user in their prefix. */
export async function getUserStorageBytes(userId: string): Promise<number> {
  const prefix = `${userId}/`;
  const [files] = await getBucket().getFiles({ prefix });
  let totalBytes = 0;
  for (const file of files) {
    totalBytes += Number(file.metadata.size || 0);
  }
  return totalBytes;
}

/** Delete a specific file belonging to a user. */
export async function deleteUserFile(userId: string, objectName: string): Promise<void> {
  assertUserPrefix(userId, objectName);
  await getBucket().file(objectName).delete({ ignoreNotFound: true });
  // Also delete from public bucket if it exists there
  await getPublicBucket().file(objectName).delete({ ignoreNotFound: true }).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────────────
// Public / Private Visibility
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Make a user file publicly accessible.
 * Copies the file from the private bucket to the public bucket.
 * Returns a permanent public URL that never expires.
 */
export async function makeFilePublic(
  userId: string,
  objectName: string,
): Promise<{ publicUrl: string }> {
  assertUserPrefix(userId, objectName);
  const srcFile = getBucket().file(objectName);
  const destFile = getPublicBucket().file(objectName);
  await srcFile.copy(destFile);
  return { publicUrl: getPublicUrl(objectName) };
}

/**
 * Make a user file private (remove public access).
 * Deletes the copy from the public bucket. The private copy remains.
 */
export async function makeFilePrivate(
  userId: string,
  objectName: string,
): Promise<void> {
  assertUserPrefix(userId, objectName);
  await getPublicBucket().file(objectName).delete({ ignoreNotFound: true });
}

/**
 * Generate a temporary public URL for a private file (TTL-based sharing).
 * Returns a signed URL valid for the specified duration (max 7 days).
 */
export async function generateTtlUrl(
  userId: string,
  objectName: string,
  ttlMs: number,
): Promise<{ url: string; expiresAt: number }> {
  assertUserPrefix(userId, objectName);
  const file = getBucket().file(objectName);
  const clampedTtl = Math.min(ttlMs, MAX_SIGNED_URL_TTL_MS);
  const expiresAt = Date.now() + clampedTtl;
  const [url] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: expiresAt,
  });
  return { url: rewriteSignedUrl(url), expiresAt };
}

// ─────────────────────────────────────────────────────────────────────────────
// User Data / Backups / Agent Data
// ─────────────────────────────────────────────────────────────────────────────

/** Delete all data for a user (all objects in their prefix). */
export async function deleteAllUserData(userId: string): Promise<void> {
  const prefix = `${userId}/`;
  await getBucket().deleteFiles({ prefix, force: true });
  // Also clean up public bucket
  await getPublicBucket().deleteFiles({ prefix, force: true }).catch(() => {});
}

/** Get the standard backup object name for a user. */
export function getBackupObjectName(userId: string): string {
  return `${userId}/memory_backup.tar.gz`;
}

/** Get the agent data (knowledge.db + memory.db) GCS path for a user. */
export function getAgentDataObjectName(userId: string): string {
  return `users/${userId}/agent-data.tar.gz`;
}

/** Get the rolling agent-data delta GCS path for a user. */
export function getAgentDataDeltaObjectName(userId: string): string {
  return `users/${userId}/agent-data.delta.tar.gz`;
}

/**
 * Upload raw agent data (tar.gz bytes) directly to GCS.
 * Used by desktop to push knowledge.db + memory.db before VM provisioning.
 */
export async function uploadAgentData(userId: string, data: Buffer): Promise<{ objectName: string; bytes: number }> {
  const objectName = getAgentDataObjectName(userId);
  const file = getBucket().file(objectName);
  await file.save(data, {
    contentType: 'application/gzip',
    resumable: false,
    metadata: {
      metadata: { source: 'desktop-sync', uploadedAt: new Date().toISOString() },
    },
  });
  return { objectName, bytes: data.length };
}

/**
 * Generate a signed upload URL for agent data (used by desktop and VM to upload directly to GCS).
 * Returns raw GCS URL — both Electron (no CORS) and VMs can access storage.googleapis.com directly.
 */
export async function generateAgentDataUploadUrl(userId: string): Promise<{ uploadUrl: string; objectName: string }> {
  const objectName = getAgentDataObjectName(userId);
  const file = getBucket().file(objectName);
  const [uploadUrl] = await file.getSignedUrl({
    version: 'v4',
    action: 'write',
    expires: Date.now() + UPLOAD_URL_TTL_MS,
    contentType: 'application/gzip',
  });
  return { uploadUrl, objectName };
}

/** Generate a signed upload URL for an incremental agent-data bundle. */
export async function generateAgentDataDeltaUploadUrl(userId: string): Promise<{ uploadUrl: string; objectName: string }> {
  const objectName = getAgentDataDeltaObjectName(userId);
  const file = getBucket().file(objectName);
  const [uploadUrl] = await file.getSignedUrl({
    version: 'v4',
    action: 'write',
    expires: Date.now() + UPLOAD_URL_TTL_MS,
    contentType: 'application/gzip',
  });
  return { uploadUrl, objectName };
}

/**
 * Generate a signed download URL for agent data.
 * Used by VMs to download user data without needing direct GCS access.
 */
export async function generateAgentDataDownloadUrl(userId: string): Promise<{ downloadUrl: string; objectName: string } | null> {
  const objectName = getAgentDataObjectName(userId);
  const file = getBucket().file(objectName);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [downloadUrl] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + DOWNLOAD_URL_TTL_MS,
  });
  // VM-destined URLs use raw GCS URLs (no Cloudflare proxy rewrite)
  // VMs can access storage.googleapis.com directly and the proxy breaks signatures
  return { downloadUrl, objectName };
}

/** Generate a signed download URL for the latest incremental agent-data bundle. */
export async function generateAgentDataDeltaDownloadUrl(userId: string): Promise<{ downloadUrl: string; objectName: string } | null> {
  const objectName = getAgentDataDeltaObjectName(userId);
  const file = getBucket().file(objectName);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [downloadUrl] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + DOWNLOAD_URL_TTL_MS,
  });
  return { downloadUrl, objectName };
}

/**
 * Generate signed download URLs for VM startup assets (agent bundle, python agent).
 * These are scoped to specific objects — VM never gets broad bucket access.
 * Returns raw GCS URLs (not rewritten) since VMs access storage.googleapis.com directly.
 */
export async function generateVMAssetUrls(): Promise<{
  agentBundleUrl: string | null;
  pythonAgentUrl: string | null;
}> {
  const bucket = getBucket();
  const ttl = Date.now() + DOWNLOAD_URL_TTL_MS;

  let agentBundleUrl: string | null = null;
  let pythonAgentUrl: string | null = null;

  try {
    const bundleFile = bucket.file('agent/vm-agent-bundle.js');
    const [bundleExists] = await bundleFile.exists();
    if (bundleExists) {
      const [url] = await bundleFile.getSignedUrl({ version: 'v4', action: 'read', expires: ttl });
      agentBundleUrl = url;
    } else {
      console.warn('[cold-storage] agent/vm-agent-bundle.js not found in bucket');
    }
  } catch (e) {
    console.error('[cold-storage] Failed to generate signed URL for agent bundle:', e);
  }

  try {
    const pyFile = bucket.file('agent/stuard-python-agent.tar.gz');
    const [pyExists] = await pyFile.exists();
    if (pyExists) {
      const [url] = await pyFile.getSignedUrl({ version: 'v4', action: 'read', expires: ttl });
      pythonAgentUrl = url;
    }
  } catch (e) {
    console.error('[cold-storage] Failed to generate signed URL for python agent:', e);
  }

  return { agentBundleUrl, pythonAgentUrl };
}
