export interface ChatAttachment {
  type: 'image' | 'file';
  name: string;
  data?: string;
  mimeType?: string;
  path?: string;
  source?: 'picker' | 'clipboard-file' | 'clipboard-text' | 'drop';
  previewText?: string;
  lineCount?: number;
  charCount?: number;
}

export type ChatAttachmentKind = 'image' | 'video' | 'audio' | 'document' | 'file';

const TEXT_MIME_RE = /^(text\/|application\/(json|xml|javascript|x-javascript))/i;
const VIDEO_MIME_RE = /^video\//i;
const AUDIO_MIME_RE = /^audio\//i;
const IMAGE_MIME_RE = /^image\//i;

function utf8ToBase64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToUtf8(input: string): string | null {
  try {
    const binary = atob(input);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function normalizePreviewText(input: string): string {
  return input
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function inferDocumentPreview(attachment: ChatAttachment) {
  const existingPreview = typeof attachment.previewText === 'string' ? normalizePreviewText(attachment.previewText) : '';
  const previewText = existingPreview || (
    isDocumentAttachment(attachment) && typeof attachment.data === 'string'
      ? normalizePreviewText(base64ToUtf8(attachment.data) || '')
      : ''
  );
  if (!previewText) {
    return {
      previewText: undefined,
      lineCount: attachment.lineCount,
      charCount: attachment.charCount,
    };
  }
  return {
    previewText: previewText.slice(0, 420),
    lineCount: typeof attachment.lineCount === 'number' ? attachment.lineCount : previewText.split(/\n/).length,
    charCount: typeof attachment.charCount === 'number' ? attachment.charCount : previewText.length,
  };
}

export function isDocumentAttachment(attachment: Pick<ChatAttachment, 'mimeType' | 'source'>): boolean {
  return attachment.source === 'clipboard-text' || TEXT_MIME_RE.test(String(attachment.mimeType || ''));
}

export function getChatAttachmentKind(attachment: Pick<ChatAttachment, 'type' | 'mimeType' | 'source'>): ChatAttachmentKind {
  if (attachment.type === 'image' || IMAGE_MIME_RE.test(String(attachment.mimeType || ''))) return 'image';
  if (attachment.source === 'clipboard-text' || isDocumentAttachment(attachment)) return 'document';
  if (VIDEO_MIME_RE.test(String(attachment.mimeType || ''))) return 'video';
  if (AUDIO_MIME_RE.test(String(attachment.mimeType || ''))) return 'audio';
  return 'file';
}

export function getChatAttachmentDataUrl(attachment: Pick<ChatAttachment, 'data' | 'mimeType'>): string | null {
  if (typeof attachment.data !== 'string' || !attachment.data.trim()) return null;
  if (/^data:/i.test(attachment.data)) return attachment.data;
  return `data:${attachment.mimeType || 'application/octet-stream'};base64,${attachment.data}`;
}

export function normalizeChatAttachment(input: any): ChatAttachment {
  const attachment: ChatAttachment = {
    type: input?.type === 'image' ? 'image' : 'file',
    name: typeof input?.name === 'string' && input.name.trim()
      ? input.name.trim()
      : (input?.type === 'image' ? 'image' : 'attachment'),
    data: typeof input?.data === 'string' ? input.data : undefined,
    mimeType: typeof input?.mimeType === 'string' && input.mimeType.trim()
      ? input.mimeType.trim()
      : (input?.type === 'image' ? 'image/png' : 'application/octet-stream'),
    path: typeof input?.path === 'string' ? input.path : undefined,
    source: input?.source === 'clipboard-text'
      ? 'clipboard-text'
      : input?.source === 'clipboard-file'
        ? 'clipboard-file'
        : input?.source === 'drop'
          ? 'drop'
          : 'picker',
    previewText: typeof input?.previewText === 'string' ? input.previewText : undefined,
    lineCount: typeof input?.lineCount === 'number' ? input.lineCount : undefined,
    charCount: typeof input?.charCount === 'number' ? input.charCount : undefined,
  };

  if (getChatAttachmentKind(attachment) === 'document') {
    const preview = inferDocumentPreview(attachment);
    attachment.previewText = preview.previewText;
    attachment.lineCount = preview.lineCount;
    attachment.charCount = preview.charCount;
  }

  return attachment;
}

export function normalizeChatAttachments(input: any[]): ChatAttachment[] {
  return Array.isArray(input) ? input.map((attachment) => normalizeChatAttachment(attachment)) : [];
}

export function serializeChatAttachment(attachment: ChatAttachment) {
  return {
    type: attachment.type,
    name: attachment.name,
    data: attachment.data,
    mimeType: attachment.mimeType,
    path: attachment.path,
    source: attachment.source,
    previewText: attachment.previewText,
    lineCount: attachment.lineCount,
    charCount: attachment.charCount,
  };
}

export function buildAttachmentMessageText(
  attachments: ChatAttachment[],
  contextPaths?: Array<{ name: string }>,
): string {
  const names = attachments
    .map((attachment) => attachment.name)
    .filter((name): name is string => typeof name === 'string' && !!name.trim());
  const contextNames = Array.isArray(contextPaths)
    ? contextPaths
        .map((path) => path?.name)
        .filter((name): name is string => typeof name === 'string' && !!name.trim())
    : [];

  if (names.length === 0 && contextNames.length === 0) return '';
  if (names.length === 0) return `Context: ${contextNames.join(', ')}`;

  const attachmentText = names.length === 1
    ? `Attached ${names[0]}`
    : `Attached ${names.length} items: ${names.slice(0, 2).join(', ')}${names.length > 2 ? ', ...' : ''}`;

  return contextNames.length > 0
    ? `${attachmentText} | Context: ${contextNames.join(', ')}`
    : attachmentText;
}

export function shouldConvertPasteToDocumentAttachment(text: string): boolean {
  const trimmed = String(text || '').trim();
  if (!trimmed) return false;
  const lineCount = trimmed.split(/\r?\n/).length;
  return trimmed.length >= 650 || lineCount >= 10 || (trimmed.length >= 400 && lineCount >= 5);
}

export function createClipboardDocumentAttachment(text: string, name = 'pasted-document.txt'): ChatAttachment {
  const normalized = normalizePreviewText(String(text || ''));
  return normalizeChatAttachment({
    type: 'file',
    name,
    data: utf8ToBase64(normalized),
    mimeType: 'text/plain',
    source: 'clipboard-text',
    previewText: normalized.slice(0, 420),
    lineCount: normalized ? normalized.split(/\n/).length : 0,
    charCount: normalized.length,
  });
}
