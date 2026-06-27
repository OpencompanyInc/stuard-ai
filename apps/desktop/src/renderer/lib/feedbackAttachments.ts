import { supabase } from './supabaseClient';
import { toMediaSrc } from '../components/chat/shared/messages/MessageBubble/helpers/media';

export const FEEDBACK_ATTACHMENTS_BUCKET = 'feedback-attachments';
export const FEEDBACK_ATTACHMENT_MAX_BYTES = 100 * 1024 * 1024;
export const FEEDBACK_ATTACHMENT_MAX_COUNT = 5;

export const FEEDBACK_ATTACHMENT_ACCEPT =
  'image/*,video/*,audio/*,.pdf,.png,.jpg,.jpeg,.webp,.gif,.svg,.bmp,.mp4,.webm,.mov,.avi,.mp3,.wav,.ogg,.m4a';

export interface FeedbackAttachment {
  url: string;
  caption?: string;
  mimeType?: string;
  size?: number;
}

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.pdf': 'application/pdf',
};

const ALLOWED_BUCKET_MIME_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml', 'image/bmp',
  'image/heic', 'image/heif',
  'video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska',
  'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4',
  'application/pdf',
]);

export function resolveFeedbackMimeType(fileName: string, mimeType?: string): string {
  const raw = String(mimeType || '').trim().toLowerCase();
  if (raw === 'image/jpg') return 'image/jpeg';
  if (raw === 'video/avi') return 'video/x-msvideo';
  if (raw === 'audio/x-m4a' || raw === 'audio/m4a') return 'audio/mp4';
  if (raw && raw !== 'application/octet-stream') return raw;
  return guessFeedbackMimeType(fileName, 'application/octet-stream');
}

export function isAllowedFeedbackMimeType(mimeType: string): boolean {
  return ALLOWED_BUCKET_MIME_TYPES.has(mimeType);
}

export function guessFeedbackMimeType(name: string, fallback = 'application/octet-stream'): string {
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : '';
  return MIME_BY_EXT[ext] || fallback;
}

export function formatFeedbackAttachmentSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isFeedbackAttachmentTooLarge(size: number): boolean {
  return size > FEEDBACK_ATTACHMENT_MAX_BYTES;
}

function sanitizeAttachmentName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'attachment';
}

export function buildFeedbackAttachmentPath(userId: string, fileName: string): string {
  const safeName = sanitizeAttachmentName(fileName);
  return `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
}

export async function uploadFeedbackAttachment(
  file: File,
  userId: string,
): Promise<FeedbackAttachment> {
  if (isFeedbackAttachmentTooLarge(file.size)) {
    throw new Error(`${file.name} exceeds the 100 MB limit (${formatFeedbackAttachmentSize(file.size)})`);
  }

  const contentType = resolveFeedbackMimeType(file.name, file.type);
  if (!isAllowedFeedbackMimeType(contentType)) {
    throw new Error(`${file.name}: unsupported file type (${contentType || 'unknown'}). Use images, video, audio, or PDF.`);
  }
  const path = buildFeedbackAttachmentPath(userId, file.name);

  const { error } = await supabase.storage
    .from(FEEDBACK_ATTACHMENTS_BUCKET)
    .upload(path, file, { upsert: false, contentType });

  if (error) {
    throw new Error(error.message || `Failed to upload ${file.name}`);
  }

  const { data } = supabase.storage.from(FEEDBACK_ATTACHMENTS_BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) {
    throw new Error(`Failed to get URL for ${file.name}`);
  }

  return {
    url: data.publicUrl,
    caption: file.name,
    mimeType: contentType,
    size: file.size,
  };
}

export async function uploadFeedbackAttachments(
  files: File[],
  userId: string,
): Promise<FeedbackAttachment[]> {
  const uploads: FeedbackAttachment[] = [];
  for (const file of files) {
    uploads.push(await uploadFeedbackAttachment(file, userId));
  }
  return uploads;
}

async function readLocalPathAsFile(path: string, name?: string, mimeType?: string): Promise<File> {
  const fileName = name || path.split(/[/\\]/).pop() || 'attachment';
  const contentType = mimeType || guessFeedbackMimeType(fileName);

  try {
    const response = await fetch(toMediaSrc(path));
    if (response.ok) {
      const blob = await response.blob();
      if (isFeedbackAttachmentTooLarge(blob.size)) {
        throw new Error(`${fileName} exceeds the 100 MB limit (${formatFeedbackAttachmentSize(blob.size)})`);
      }
      return new File([blob], fileName, { type: blob.type || contentType });
    }
  } catch {
    /* fall through to agent read */
  }

  const api = (window as any).desktopAPI;
  if (!api?.execTool) {
    throw new Error('Local file upload is unavailable.');
  }

  const result = await api.execTool('read_file_binary', { path, inline: true });
  if (!result?.ok || typeof result?.data !== 'string') {
    throw new Error(result?.error || `Could not read ${fileName}`);
  }

  const binary = atob(result.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  const file = new File([bytes], fileName, { type: result?.mimeType || contentType });

  if (isFeedbackAttachmentTooLarge(file.size)) {
    throw new Error(`${fileName} exceeds the 100 MB limit (${formatFeedbackAttachmentSize(file.size)})`);
  }

  return file;
}

export async function uploadFeedbackAttachmentsFromPending(
  attachments: Array<
    | { kind: 'file'; file: File }
    | { kind: 'path'; path: string; name?: string; mimeType?: string }
  >,
  userId: string,
): Promise<FeedbackAttachment[]> {
  const uploads: FeedbackAttachment[] = [];

  for (const item of attachments) {
    if (item.kind === 'file') {
      const filePath = (item.file as File & { path?: string }).path;
      if (typeof filePath === 'string' && filePath) {
        uploads.push(await uploadFeedbackAttachment(await readLocalPathAsFile(filePath, item.file.name, item.file.type), userId));
      } else {
        uploads.push(await uploadFeedbackAttachment(item.file, userId));
      }
      continue;
    }

    uploads.push(
      await uploadFeedbackAttachment(
        await readLocalPathAsFile(item.path, item.name, item.mimeType),
        userId,
      ),
    );
  }

  return uploads;
}
