import { Storage } from '@google-cloud/storage';

const storage = new Storage();

const TEMP_MEDIA_BUCKET = (process.env.TEMP_MEDIA_BUCKET || '').trim();
const TEMP_MEDIA_URL_TTL_SECONDS = Number(process.env.TEMP_MEDIA_URL_TTL_SECONDS || 3600);

function requireBucket(): string {
  if (!TEMP_MEDIA_BUCKET) {
    throw new Error('TEMP_MEDIA_BUCKET env var is required for temp media uploads');
  }
  return TEMP_MEDIA_BUCKET;
}

export async function createTempMediaUrls(opts: { extension?: string; mimeType?: string }) {
  const bucketName = requireBucket();
  const bucket = storage.bucket(bucketName);

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const rawExt = (opts.extension || '').trim();
  const ext = rawExt && /^\.[A-Za-z0-9]+$/.test(rawExt) ? rawExt : '';
  const objectName = `temp-media/${id}${ext}`;

  const file = bucket.file(objectName);
  const contentType = opts.mimeType || 'application/octet-stream';
  const expires = Date.now() + TEMP_MEDIA_URL_TTL_SECONDS * 1000;

  const [uploadUrl] = await file.getSignedUrl({
    version: 'v4',
    action: 'write',
    expires,
    contentType,
  });

  const [downloadUrl] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires,
  });

  return { objectName, uploadUrl, downloadUrl, bucket: bucketName };
}

export async function deleteTempMediaObject(objectName: string) {
  if (!objectName) return;
  const bucketName = requireBucket();
  try {
    const bucket = storage.bucket(bucketName);
    await bucket.file(objectName).delete({ ignoreNotFound: true });
  } catch {
    // Best-effort cleanup; bucket also should have lifecycle rules.
  }
}
