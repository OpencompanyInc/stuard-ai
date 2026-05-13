import { execLocalTool, safeToolWrite } from './bridge';
import { createTempMediaUrls, deleteTempMediaObject } from '../utils/gcs';

// Shared media-source loading used by analyze_media and ai_inference (multimodal mode).
// Builds AI-SDK-compatible `parts` from {path, url, data, captureScreen} sources,
// inlines audio/image/PDF as base64, and routes video through GCS signed URLs.

export type MediaSource = {
  url?: string;
  path?: string;
  data?: string;
  mimeType?: string;
  captureScreen?: boolean;
};

export type LoadedMedia = {
  parts: Array<{ type: 'file'; data: string; mediaType: string }>;
  uploadedObjects: string[];
};

export function inferMimeType(pathOrUrl: string): string {
  const ext = pathOrUrl.toLowerCase().match(/\.([a-z0-9]+)(?:[?#]|$)/)?.[1] || '';
  const mimeMap: Record<string, string> = {
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    avi: 'video/x-msvideo',
    mkv: 'video/x-matroska',
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    flac: 'audio/flac',
    wma: 'audio/x-ms-wma',
    aiff: 'audio/aiff',
    opus: 'audio/opus',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

// OpenRouter rejects audio that isn't audio/mpeg, audio/mp3, audio/wav, or audio/x-wav.
// Normalize the common alias audio/mp3 → audio/mpeg so the user's MP3 just works.
const OPENROUTER_AUDIO_MIMES = new Set(['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav']);

export function normalizeAudioMimeForOpenRouter(mimeType: string): string {
  if (mimeType === 'audio/mp3') return 'audio/mpeg';
  return mimeType;
}

export function isAudioMimeOpenRouterCompatible(mimeType: string): boolean {
  return OPENROUTER_AUDIO_MIMES.has(normalizeAudioMimeForOpenRouter(mimeType));
}

export function isYouTubeUrl(url: string): boolean {
  return /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(url);
}

// Inline base64 works reliably with Gemini for audio/image/PDF. Video may be
// large, so we prefer GCS signed URLs with a direct-read fallback.
export function shouldReadDirectly(mimeType: string): boolean {
  return (
    mimeType.startsWith('audio/') ||
    mimeType.startsWith('image/') ||
    mimeType.startsWith('video/') ||
    mimeType === 'application/pdf'
  );
}

export async function loadMediaSources(
  sources: MediaSource[],
  writer: any,
  toolName: string = 'media_loader',
): Promise<LoadedMedia> {
  const parts: Array<{ type: 'file'; data: string; mediaType: string }> = [];
  const uploadedObjects: string[] = [];

  for (const s of sources || []) {
    if (s.captureScreen) {
      await safeToolWrite(writer, {
        type: 'tool_event',
        tool: toolName,
        status: 'capturing_screen',
      });

      const shot = await execLocalTool('take_screenshot', {}, writer);
      const filePath = typeof shot?.filePath === 'string' ? shot.filePath : '';
      if (!filePath) {
        await safeToolWrite(writer, {
          type: 'tool_event',
          tool: toolName,
          status: 'error',
          error: 'screenshot_failed',
        });
        continue;
      }

      const bin = await execLocalTool('read_file_binary', { path: filePath }, writer);
      const data = bin?.data as string | undefined;
      const mimeType = (bin?.mimeType as string | undefined) || 'image/png';
      if (data) {
        parts.push({ type: 'file', data, mediaType: mimeType });
        await safeToolWrite(writer, {
          type: 'tool_event',
          tool: toolName,
          status: 'screen_captured',
          filePath,
        });
      }
      continue;
    }

    if (s.path) {
      const pathStr = String(s.path);
      const extMatch = pathStr.match(/\.[A-Za-z0-9]+$/);
      const ext = extMatch ? extMatch[0] : '';
      const mimeType = s.mimeType || inferMimeType(pathStr);
      const tryDirect = shouldReadDirectly(mimeType);

      if (tryDirect) {
        await safeToolWrite(writer, {
          type: 'tool_event',
          tool: toolName,
          status: 'reading_file',
          path: s.path,
          mimeType,
        });

        try {
          const bin = await execLocalTool('read_file_binary', { path: s.path }, writer);
          const data = bin?.data as string | undefined;
          if (data) {
            parts.push({ type: 'file', data, mediaType: mimeType });
            await safeToolWrite(writer, {
              type: 'tool_event',
              tool: toolName,
              status: 'file_read_complete',
              path: s.path,
              size: data.length,
            });
          } else {
            await safeToolWrite(writer, {
              type: 'tool_event',
              tool: toolName,
              status: 'error',
              path: s.path,
              error: 'file_read_failed',
            });
          }
        } catch (e: any) {
          await safeToolWrite(writer, {
            type: 'tool_event',
            tool: toolName,
            status: 'error',
            path: s.path,
            error: 'file_read_error',
            message: e?.message || String(e || ''),
          });
        }
      } else {
        try {
          await safeToolWrite(writer, {
            type: 'tool_event',
            tool: toolName,
            status: 'gcs_upload_init',
            path: s.path,
          });

          const { objectName, uploadUrl, downloadUrl } = await createTempMediaUrls({ extension: ext, mimeType });

          const upload = await execLocalTool(
            'upload_file_to_url',
            { path: s.path, url: uploadUrl, method: 'PUT', mimeType },
            writer,
          );

          if (upload && upload.ok) {
            uploadedObjects.push(objectName);
            parts.push({ type: 'file', data: downloadUrl, mediaType: mimeType });
            await safeToolWrite(writer, {
              type: 'tool_event',
              tool: toolName,
              status: 'gcs_upload_complete',
              path: s.path,
              size: upload.size,
              objectName,
              downloadUrl,
            });
          } else {
            throw new Error(upload?.error || 'gcs_upload_failed');
          }
        } catch (e: any) {
          await safeToolWrite(writer, {
            type: 'tool_event',
            tool: toolName,
            status: 'gcs_fallback_direct',
            path: s.path,
            message: e?.message || String(e || ''),
          });

          try {
            const bin = await execLocalTool('read_file_binary', { path: s.path }, writer);
            const data = bin?.data as string | undefined;
            if (data) {
              parts.push({ type: 'file', data, mediaType: mimeType });
              await safeToolWrite(writer, {
                type: 'tool_event',
                tool: toolName,
                status: 'file_read_complete',
                path: s.path,
                size: data.length,
              });
            } else {
              throw new Error('Fallback direct read failed - no data');
            }
          } catch (fallbackErr: any) {
            await safeToolWrite(writer, {
              type: 'tool_event',
              tool: toolName,
              status: 'error',
              path: s.path,
              error: 'media_access_failed',
              message: `GCS fail: ${e?.message || 'unknown'}. Direct fail: ${fallbackErr?.message || 'unknown'}`,
            });
          }
        }
      }
    } else if (s.data) {
      const m = s.mimeType || 'application/octet-stream';
      parts.push({ type: 'file', data: s.data, mediaType: m });
    } else if (s.url) {
      const m = isYouTubeUrl(s.url) ? 'video/mp4' : (s.mimeType || inferMimeType(s.url));
      parts.push({ type: 'file', data: s.url, mediaType: m });
    }
  }

  return { parts, uploadedObjects };
}

export async function cleanupUploadedMedia(uploadedObjects: string[]): Promise<void> {
  for (const obj of uploadedObjects) {
    try {
      await deleteTempMediaObject(obj);
    } catch {
      // ignore
    }
  }
}
