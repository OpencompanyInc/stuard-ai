// ─── MediaProcessor: unified inbound media pipeline for all channels ────────

import type { InboundMedia, ProcessedMedia, AttachmentPayload, MediaResult } from './types';
import { fetchMedia } from './fetchers';
import { transcribeAudio } from './transcription';

export interface ProcessOptions {
  /** Skip Whisper transcription for audio items (default false) */
  skipTranscription?: boolean;
  /** Language hint for Whisper (e.g. "en", "es") */
  transcriptionLanguage?: string;
}

/**
 * Process a batch of inbound media from any channel into a format the
 * cloud WS chat handler can consume directly (attachments + supplementary text).
 *
 * Usage:
 *   const result = await MediaProcessor.process(items);
 *   // result.attachments → pass to WS chat msg.attachments
 *   // result.supplementaryText → prepend to user message text
 */
export class MediaProcessor {

  /**
   * Process all media items in parallel.
   * - Images → base64 attachment
   * - Audio → transcribe via Whisper, attach transcript as text
   * - Video → caption/description only (too large for inline)
   * - Documents → base64 file attachment
   */
  static async process(items: InboundMedia[], opts?: ProcessOptions): Promise<MediaResult> {
    if (!items.length) return { attachments: [], supplementaryText: '', items: [] };

    const settled = await Promise.allSettled(
      items.map(item => MediaProcessor.processOne(item, opts)),
    );

    const processed: ProcessedMedia[] = [];
    const failures: string[] = [];

    for (let i = 0; i < settled.length; i++) {
      const r = settled[i];
      if (r.status === 'fulfilled') {
        processed.push(r.value);
      } else {
        const label = items[i].mediaType || 'media';
        failures.push(`[${label} could not be loaded: ${String(r.reason?.message || r.reason).slice(0, 100)}]`);
        console.error(`[media-processor] Failed to process ${label}:`, r.reason);
      }
    }

    const attachments = MediaProcessor.toAttachments(processed);
    const textParts: string[] = [];

    // Add transcriptions
    for (const p of processed) {
      if (p.transcript) {
        // Caption (text sent alongside the audio) is already in the caller's message text —
        // just label it as a voice note transcription to avoid duplicating the caption here.
        textParts.push(`[Voice note transcription]: "${p.transcript}"`);
      }
    }

    // Add failure descriptions
    textParts.push(...failures);

    return {
      attachments,
      supplementaryText: textParts.join('\n'),
      items: processed,
    };
  }

  /** Process a single media item: fetch + classify + transform */
  private static async processOne(item: InboundMedia, opts?: ProcessOptions): Promise<ProcessedMedia> {
    const { buffer, mimeType } = await fetchMedia(item);
    const effectiveMime = mimeType || item.mimeType;

    const result: ProcessedMedia = {
      original: item,
      buffer,
      mimeType: effectiveMime,
    };

    switch (item.mediaType) {
      case 'image': {
        const b64 = buffer.toString('base64');
        result.base64DataUri = `data:${effectiveMime};base64,${b64}`;
        break;
      }
      case 'audio': {
        if (!opts?.skipTranscription) {
          try {
            const t = await transcribeAudio(buffer, effectiveMime, opts?.transcriptionLanguage);
            result.transcript = t.transcript;
            result.transcriptLanguage = t.language;
            result.transcriptDuration = t.duration;
          } catch (e: any) {
            console.error('[media-processor] Transcription failed:', e?.message);
            result.transcript = undefined; // let caller know it failed via absence
          }
        }
        break;
      }
      // video: too large for inline — rely on caption text
      // document: attached as file below
    }

    return result;
  }

  /** Convert processed items into the AttachmentPayload format the WS handler expects */
  static toAttachments(items: ProcessedMedia[]): AttachmentPayload[] {
    const out: AttachmentPayload[] = [];
    for (const p of items) {
      switch (p.original.mediaType) {
        case 'image':
          if (p.base64DataUri) {
            out.push({
              type: 'image',
              name: p.original.filename,
              mimeType: p.mimeType,
              data: p.base64DataUri,
            });
          }
          break;
        case 'document':
          out.push({
            type: 'file',
            name: p.original.filename || 'document',
            mimeType: p.mimeType,
            data: `data:${p.mimeType};base64,${p.buffer.toString('base64')}`,
          });
          break;
        // audio: transcript is in supplementaryText, no need to attach binary
        // video: not attached inline (too large)
      }
    }
    return out;
  }
}
