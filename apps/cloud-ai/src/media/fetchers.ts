// ─── Channel-specific media download logic ──────────────────────────────────

import type { InboundMedia } from './types';

const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024; // 25 MB hard cap

/** Download media from a direct HTTP(S) URL (Telnyx MMS, Discord CDN, etc.) */
export async function fetchFromUrl(url: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Media download failed (${res.status}) from ${url.slice(0, 80)}`);
  const ct = res.headers.get('content-type') || 'application/octet-stream';
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_DOWNLOAD_BYTES) throw new Error(`Media too large (${(buf.length / 1e6).toFixed(1)}MB)`);
  return { buffer: buf, mimeType: ct };
}

/** Download media via WhatsApp media ID (requires WA_ACCESS_TOKEN). */
export async function fetchFromWhatsApp(mediaId: string): Promise<{ buffer: Buffer; mimeType: string }> {
  // Lazy import to avoid circular deps and keep WA config optional
  const { waGetMediaUrl } = await import('../routes/integrations/whatsapp');
  const { WA_ACCESS_TOKEN } = await import('../utils/config');
  if (!WA_ACCESS_TOKEN) throw new Error('WhatsApp not configured — cannot download media');

  const info = await waGetMediaUrl(mediaId);
  const res = await fetch(info.url, {
    headers: { 'Authorization': `Bearer ${WA_ACCESS_TOKEN}` },
  });
  if (!res.ok) throw new Error(`WhatsApp media download failed (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_DOWNLOAD_BYTES) throw new Error(`Media too large (${(buf.length / 1e6).toFixed(1)}MB)`);
  return { buffer: buf, mimeType: info.mimeType || 'application/octet-stream' };
}

/** Dispatch to the correct fetcher based on InboundMedia.source */
export async function fetchMedia(item: InboundMedia): Promise<{ buffer: Buffer; mimeType: string }> {
  switch (item.source) {
    case 'whatsapp_media_id':
      return fetchFromWhatsApp(item.ref);
    case 'url':
    default:
      return fetchFromUrl(item.ref);
  }
}
