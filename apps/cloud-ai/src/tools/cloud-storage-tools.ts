import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getBridgeSecrets, execLocalTool, safeToolWrite } from './bridge';
import {
  uploadUserFileBuffer,
  generateUserDownloadUrl,
  listUserFiles,
  deleteUserFile,
  makeFilePublic,
  makeFilePrivate,
  getPublicUrl,
} from '../services/cold-storage';
import { checkColdStorageQuota } from '../services/hot-storage';

function requireUserId(): string {
  const secrets = getBridgeSecrets();
  const userId = String((secrets as any)?.userId || '');
  if (!userId) throw new Error('missing_user_context');
  return userId;
}

function inferMimeType(filename: string): string {
  const ext = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
  const mimeMap: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', avi: 'video/x-msvideo',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
    pdf: 'application/pdf', json: 'application/json', csv: 'text/csv',
    txt: 'text/plain', html: 'text/html', xml: 'text/xml', zip: 'application/zip',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

/**
 * Upload a file to cloud storage from a local path.
 * Supports public (permanent URL) and private (signed URL) visibility.
 */
export const cloud_storage_upload = createTool({
  id: 'cloud_storage_upload',
  description:
    'Upload a local file to cloud storage. Choose "public" visibility to get a permanent public URL (useful for Instagram, sharing), or "private" for a time-limited signed URL.',
  inputSchema: z.object({
    path: z.string().min(1).describe('Local file path to upload (e.g. C:\\Users\\me\\photo.jpg)'),
    folder: z.string().optional().describe('Optional subfolder in cloud storage (e.g. "instagram", "exports")'),
    visibility: z.enum(['public', 'private']).default('private').describe('"public" = permanent URL anyone can access. "private" = signed URL valid for 1 hour.'),
    filename: z.string().optional().describe('Override the filename in storage. Defaults to the original filename.'),
  }),
  execute: async (inputData: any, { writer }: any) => {
    const { path, folder, visibility, filename } = inputData as {
      path: string; folder?: string; visibility: 'public' | 'private'; filename?: string;
    };
    const userId = requireUserId();

    // Check quota
    const quota = await checkColdStorageQuota(userId);
    if (!quota.withinQuota) {
      throw new Error(`Storage quota exceeded (${quota.usedGb.toFixed(1)}/${quota.quotaGb} GB used). Upgrade your storage plan.`);
    }

    await safeToolWrite(writer as any, {
      type: 'tool_event', tool: 'cloud_storage_upload', status: 'reading_file', path,
    });

    // Read the file from the user's machine via bridge
    const bin = await execLocalTool('read_file_binary', { path }, writer as any);
    const data = bin?.data as string | undefined;
    if (!data) {
      throw new Error(`Could not read file at path: ${path}`);
    }

    const buffer = Buffer.from(data, 'base64');
    const originalFilename = path.replace(/\\/g, '/').split('/').pop() || 'file';
    const targetFilename = filename || originalFilename;
    const contentType = inferMimeType(targetFilename);

    await safeToolWrite(writer as any, {
      type: 'tool_event', tool: 'cloud_storage_upload', status: 'uploading',
      filename: targetFilename, size: buffer.length, visibility,
    });

    const result = await uploadUserFileBuffer(
      userId, targetFilename, buffer, contentType, folder || '', visibility,
    );

    await safeToolWrite(writer as any, {
      type: 'tool_event', tool: 'cloud_storage_upload', status: 'complete',
      objectName: result.objectName, url: result.url, visibility: result.visibility,
    });

    return {
      ok: true,
      objectName: result.objectName,
      url: result.url,
      visibility: result.visibility,
      bytesWritten: result.bytesWritten,
      contentType,
    };
  },
});

/**
 * Get a download URL for an existing file in cloud storage.
 */
export const cloud_storage_get_url = createTool({
  id: 'cloud_storage_get_url',
  description:
    'Get a download URL for a file already in cloud storage. Returns a signed (private) or public URL.',
  inputSchema: z.object({
    objectName: z.string().min(1).describe('The object name / path in cloud storage'),
    visibility: z.enum(['public', 'private']).default('private').describe('"public" = make file public and return permanent URL. "private" = return a signed URL valid for 1 hour.'),
  }),
  execute: async (inputData: any) => {
    const { objectName, visibility } = inputData as { objectName: string; visibility: 'public' | 'private' };
    const userId = requireUserId();

    const fullName = objectName.startsWith(`${userId}/`) ? objectName : `${userId}/${objectName}`;

    if (visibility === 'public') {
      await makeFilePublic(userId, fullName);
      return { ok: true, url: getPublicUrl(fullName), visibility: 'public' as const, objectName: fullName };
    } else {
      const { downloadUrl } = await generateUserDownloadUrl(userId, fullName);
      return { ok: true, url: downloadUrl, visibility: 'private' as const, objectName: fullName };
    }
  },
});

/**
 * List files in cloud storage.
 */
export const cloud_storage_list = createTool({
  id: 'cloud_storage_list',
  description: 'List files in your cloud storage. Optionally filter by folder prefix.',
  inputSchema: z.object({
    prefix: z.string().optional().describe('Folder prefix to filter (e.g. "instagram/", "exports/")'),
    limit: z.number().int().min(1).max(1000).default(100),
  }),
  execute: async (inputData: any) => {
    const { prefix, limit } = inputData as { prefix?: string; limit: number };
    const userId = requireUserId();

    const files = await listUserFiles(userId, prefix || undefined, limit);
    return { ok: true, files, count: files.length };
  },
});

/**
 * Delete a file from cloud storage.
 */
export const cloud_storage_delete = createTool({
  id: 'cloud_storage_delete',
  description: 'Delete a file from your cloud storage.',
  inputSchema: z.object({
    objectName: z.string().min(1).describe('The object name / path to delete'),
  }),
  execute: async (inputData: any) => {
    const { objectName } = inputData as { objectName: string };
    const userId = requireUserId();

    const fullName = objectName.startsWith(`${userId}/`) ? objectName : `${userId}/${objectName}`;
    await deleteUserFile(userId, fullName);
    return { ok: true, deleted: fullName };
  },
});

/**
 * Change file visibility (make public or private).
 */
export const cloud_storage_set_visibility = createTool({
  id: 'cloud_storage_set_visibility',
  description: 'Change the visibility of a file in cloud storage between public and private.',
  inputSchema: z.object({
    objectName: z.string().min(1).describe('The object name / path in cloud storage'),
    visibility: z.enum(['public', 'private']).describe('"public" = anyone can access via URL. "private" = requires signed URL.'),
  }),
  execute: async (inputData: any) => {
    const { objectName, visibility } = inputData as { objectName: string; visibility: 'public' | 'private' };
    const userId = requireUserId();

    const fullName = objectName.startsWith(`${userId}/`) ? objectName : `${userId}/${objectName}`;

    if (visibility === 'public') {
      const { publicUrl } = await makeFilePublic(userId, fullName);
      return { ok: true, visibility: 'public' as const, url: publicUrl, objectName: fullName };
    } else {
      await makeFilePrivate(userId, fullName);
      return { ok: true, visibility: 'private' as const, objectName: fullName };
    }
  },
});
