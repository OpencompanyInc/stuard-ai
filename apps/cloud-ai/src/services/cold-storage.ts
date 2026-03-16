import { Storage } from '@google-cloud/storage';
import { Readable, Transform } from 'stream';
import { CLOUD_ENGINE_BUCKET, GCP_KEY_FILE } from '../utils/config';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const UPLOAD_URL_TTL_MS = 15 * 60 * 1000;    // 15 minutes
const DOWNLOAD_URL_TTL_MS = 60 * 60 * 1000;  // 1 hour
const MAX_FILENAME_LENGTH = 255;
const VALID_OBJECT_NAME_RE = /^[a-zA-Z0-9_\-./() @+,!#%&=~]+$/;

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
// Cold Storage Functions
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

function getBucket() {
  return getStorage().bucket(CLOUD_ENGINE_BUCKET);
}

/** Generate a signed upload URL for a user file. */
export async function generateUserUploadUrl(
  userId: string,
  filename: string,
): Promise<{ uploadUrl: string; objectName: string }> {
  const safe = sanitizeFilename(filename);
  const objectName = `${userId}/${safe}`;

  const file = getBucket().file(objectName);
  const expires = Date.now() + UPLOAD_URL_TTL_MS;
  const [uploadUrl] = await file.getSignedUrl({
    version: 'v4',
    action: 'write',
    expires,
    contentType: 'application/octet-stream',
  });

  return { uploadUrl, objectName };
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
 * List user files in their storage prefix.
 */
export async function listUserFiles(
  userId: string,
  prefix?: string,
  maxResults = 1000,
): Promise<Array<{ name: string; size: number; updated: string; contentType: string }>> {
  const fullPrefix = prefix ? `${userId}/${prefix}` : `${userId}/`;
  const [files] = await getBucket().getFiles({ prefix: fullPrefix, maxResults });

  return files.map(f => ({
    name: String(f.name).replace(`${userId}/`, ''),
    size: Number(f.metadata.size || 0),
    updated: String(f.metadata.updated || f.metadata.timeCreated || ''),
    contentType: String(f.metadata.contentType || 'application/octet-stream'),
  }));
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

/** Generate a signed download URL for a user file. */
export async function generateUserDownloadUrl(
  userId: string,
  objectName: string,
): Promise<{ downloadUrl: string }> {
  assertUserPrefix(userId, objectName);

  const file = getBucket().file(objectName);
  const expires = Date.now() + DOWNLOAD_URL_TTL_MS;
  const [downloadUrl] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires,
  });

  return { downloadUrl };
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
}

/** Make a user file publicly accessible. Returns the public URL. */
export async function makeFilePublic(
  userId: string,
  objectName: string,
): Promise<{ publicUrl: string }> {
  assertUserPrefix(userId, objectName);
  const file = getBucket().file(objectName);
  await file.makePublic();
  const bucketName = CLOUD_ENGINE_BUCKET;
  const publicUrl = `https://storage.googleapis.com/${bucketName}/${objectName}`;
  return { publicUrl };
}

/** Make a user file private (remove public access). */
export async function makeFilePrivate(
  userId: string,
  objectName: string,
): Promise<void> {
  assertUserPrefix(userId, objectName);
  const file = getBucket().file(objectName);
  await file.makePrivate();
}

/** Get the public URL for a file (does not check if it's actually public). */
export function getPublicUrl(objectName: string): string {
  return `https://storage.googleapis.com/${CLOUD_ENGINE_BUCKET}/${objectName}`;
}

/**
 * Upload raw buffer data to a user's GCS path.
 * Returns the object name and optionally a public or signed URL based on visibility.
 */
export async function uploadUserFileBuffer(
  userId: string,
  filename: string,
  data: Buffer,
  contentType = 'application/octet-stream',
  folderPath = '',
  visibility: 'private' | 'public' = 'private',
): Promise<{ objectName: string; bytesWritten: number; url: string; visibility: 'private' | 'public' }> {
  const safe = sanitizeFilename(filename);
  const prefix = folderPath
    ? folderPath.split('/').map(s => sanitizeFilename(s)).filter(Boolean).join('/')
    : '';
  const objectName = prefix ? `${userId}/${prefix}/${safe}` : `${userId}/${safe}`;

  const file = getBucket().file(objectName);
  await file.save(data, {
    contentType,
    resumable: data.length > 5 * 1024 * 1024,
    metadata: { contentType },
  });

  let url: string;
  if (visibility === 'public') {
    await file.makePublic();
    url = `https://storage.googleapis.com/${CLOUD_ENGINE_BUCKET}/${objectName}`;
  } else {
    const [signedUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + DOWNLOAD_URL_TTL_MS,
    });
    url = signedUrl;
  }

  return { objectName, bytesWritten: data.length, url, visibility };
}

/** Delete all data for a user (all objects in their prefix). */
export async function deleteAllUserData(userId: string): Promise<void> {
  const prefix = `${userId}/`;
  await getBucket().deleteFiles({ prefix, force: true });
}

/** Get the standard backup object name for a user. */
export function getBackupObjectName(userId: string): string {
  return `${userId}/memory_backup.tar.gz`;
}

/** Get the agent data (knowledge.db + memory.db) GCS path for a user. */
export function getAgentDataObjectName(userId: string): string {
  return `users/${userId}/agent-data.tar.gz`;
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
 * Generate a signed upload URL for agent data (used by desktop to upload directly to GCS).
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
  return { downloadUrl, objectName };
}

/**
 * Generate signed download URLs for VM startup assets (agent bundle, python agent).
 * These are scoped to specific objects — VM never gets broad bucket access.
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
    }
  } catch {}

  try {
    const pyFile = bucket.file('agent/stuard-python-agent.tar.gz');
    const [pyExists] = await pyFile.exists();
    if (pyExists) {
      const [url] = await pyFile.getSignedUrl({ version: 'v4', action: 'read', expires: ttl });
      pythonAgentUrl = url;
    }
  } catch {}

  return { agentBundleUrl, pythonAgentUrl };
}
