export { MediaProcessor } from './processor';
export type { ProcessOptions } from './processor';
export type { InboundMedia, ProcessedMedia, AttachmentPayload, MediaResult } from './types';
export { transcribeAudio } from './transcription';
export { fetchMedia, fetchFromUrl, fetchFromWhatsApp } from './fetchers';

// ─── Convenience helpers for converting channel-specific payloads ────────────

import type { InboundMedia } from './types';

/** Classify a MIME type into a high-level media type */
export function classifyMime(mimeType: string): InboundMedia['mediaType'] {
  const m = (mimeType || '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('video/')) return 'video';
  return 'document';
}

/** Convert Telnyx MMS media items to InboundMedia[] */
export function fromTelnyxMms(mediaItems: any[], caption?: string): InboundMedia[] {
  return mediaItems
    .filter(m => m?.url)
    .map(m => ({
      ref: String(m.url),
      source: 'url' as const,
      mimeType: String(m.content_type || 'image/jpeg'),
      mediaType: classifyMime(m.content_type),
      caption,
    }));
}

/** Convert a WhatsApp media message to InboundMedia[] */
export function fromWhatsApp(mediaId: string, mimeType: string, caption?: string, filename?: string): InboundMedia[] {
  if (!mediaId) return [];
  return [{
    ref: mediaId,
    source: 'whatsapp_media_id' as const,
    mimeType: mimeType || 'application/octet-stream',
    mediaType: classifyMime(mimeType),
    filename,
    caption,
  }];
}

/** Convert Discord attachments (with url, contentType, name, size) to InboundMedia[] */
export function fromDiscordAttachments(attachments: Array<{ type: string; url: string; contentType: string; filename: string }>): InboundMedia[] {
  return attachments
    .filter(a => a?.url)
    .map(a => ({
      ref: a.url,
      source: 'url' as const,
      mimeType: a.contentType || 'application/octet-stream',
      mediaType: classifyMime(a.contentType) as InboundMedia['mediaType'],
      filename: a.filename,
    }));
}
