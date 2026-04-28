import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { generateText } from 'ai';
import { google } from '../utils/models';
import { execLocalTool, safeToolWrite } from './bridge';
import { createTempMediaUrls, deleteTempMediaObject } from '../utils/gcs';

type AnalyzeMediaSource = {
  url?: string;
  path?: string;
  data?: string;
  mimeType?: string;
  captureScreen?: boolean;
};

type AnalyzeMediaMode = 'fast' | 'detailed';

type AnalyzeMediaInput = {
  task?: string;
  sources?: AnalyzeMediaSource[];
  mode?: AnalyzeMediaMode;
};

// Helper to infer mime type from file extension
function inferMimeType(pathOrUrl: string): string {
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

// Check if URL is a YouTube URL
function isYouTubeUrl(url: string): boolean {
  return /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(url);
}

// Check if mime type is audio - these should be read directly as binary, not via GCS URL
function isAudioMimeType(mimeType: string): boolean {
  return mimeType.startsWith('audio/');
}

// Check if mime type should be read directly as binary (base64).
// All supported media types work as inline base64 with Gemini — avoids
// the fragile GCS signed-URL upload path via upload_file_to_url.
function shouldReadDirectly(mimeType: string): boolean {
  return mimeType.startsWith('audio/') || mimeType.startsWith('image/') || mimeType.startsWith('video/') || mimeType === 'application/pdf';
}

async function executeAnalyzeMedia(
  inputData: AnalyzeMediaInput,
  writer: any,
  options?: { forceFastMode?: boolean },
): Promise<{ summary: string }> {
  const { task, sources } = (inputData || {}) as AnalyzeMediaInput;
  const requestedMode = (inputData?.mode || 'fast') as AnalyzeMediaMode;
  const mode: AnalyzeMediaMode = options?.forceFastMode ? 'fast' : requestedMode;

  await safeToolWrite(writer as any, {
    type: 'tool_event',
    tool: 'analyze_media',
    status: 'started',
    count: sources?.length ?? 0,
    mode,
  });

  const isDetailed = mode === 'detailed';
  const modelId = isDetailed ? 'gemini-3.1-pro-preview' : 'gemini-3.1-flash-lite-preview';
  const parts: any[] = [{ type: 'text', text: task || 'Analyze this media and provide key observations, details, and any relevant information.' }];
  const uploadedObjects: string[] = [];

  for (const s of sources || []) {
    // Handle screen capture request
    if (s.captureScreen) {
      await safeToolWrite(writer as any, {
        type: 'tool_event',
        tool: 'analyze_media',
        status: 'capturing_screen',
      });

      const shot = await execLocalTool('take_screenshot', {}, writer as any);
      const filePath = typeof shot?.filePath === 'string' ? shot.filePath : '';
      if (!filePath) {
        await safeToolWrite(writer as any, {
          type: 'tool_event',
          tool: 'analyze_media',
          status: 'error',
          error: 'screenshot_failed',
        });
        continue;
      }

      // Read the screenshot file
      const bin = await execLocalTool('read_file_binary', { path: filePath }, writer as any);
      const data = bin?.data as string | undefined;
      const mimeType = (bin?.mimeType as string | undefined) || 'image/png';
      if (data) {
        parts.push({ type: 'file', data, mediaType: mimeType });
        await safeToolWrite(writer as any, {
          type: 'tool_event',
          tool: 'analyze_media',
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

      // For audio, images, and PDFs: read directly as base64 - more reliable with Gemini
      // For video: use GCS upload since they can be large, but fallback to direct if needed
      const tryDirect = shouldReadDirectly(mimeType);

      if (tryDirect) {
        await safeToolWrite(writer as any, {
          type: 'tool_event',
          tool: 'analyze_media',
          status: 'reading_file',
          path: s.path,
          mimeType,
        });

        try {
          const bin = await execLocalTool('read_file_binary', { path: s.path }, writer as any);
          const data = bin?.data as string | undefined;
          if (data) {
            parts.push({ type: 'file', data, mediaType: mimeType });
            await safeToolWrite(writer as any, {
              type: 'tool_event',
              tool: 'analyze_media',
              status: 'file_read_complete',
              path: s.path,
              size: data.length,
            });
          } else {
            await safeToolWrite(writer as any, {
              type: 'tool_event',
              tool: 'analyze_media',
              status: 'error',
              path: s.path,
              error: 'file_read_failed',
            });
          }
        } catch (e: any) {
          await safeToolWrite(writer as any, {
            type: 'tool_event',
            tool: 'analyze_media',
            status: 'error',
            path: s.path,
            error: 'file_read_error',
            message: e?.message || String(e || ''),
          });
        }
      } else {
        // For video and large files: route through GCS using signed URLs
        try {
          await safeToolWrite(writer as any, {
            type: 'tool_event',
            tool: 'analyze_media',
            status: 'gcs_upload_init',
            path: s.path,
          });

          const { objectName, uploadUrl, downloadUrl } = await createTempMediaUrls({ extension: ext, mimeType });

          const upload = await execLocalTool(
            'upload_file_to_url',
            { path: s.path, url: uploadUrl, method: 'PUT', mimeType },
            writer as any,
          );

          if (upload && upload.ok) {
            uploadedObjects.push(objectName);
            parts.push({ type: 'file', data: downloadUrl, mediaType: mimeType });
            await safeToolWrite(writer as any, {
              type: 'tool_event',
              tool: 'analyze_media',
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
          // FALLBACK: Attempt direct read if GCS fails
          await safeToolWrite(writer as any, {
            type: 'tool_event',
            tool: 'analyze_media',
            status: 'gcs_fallback_direct',
            path: s.path,
            message: e?.message || String(e || ''),
          });

          try {
            const bin = await execLocalTool('read_file_binary', { path: s.path }, writer as any);
            const data = bin?.data as string | undefined;
            if (data) {
              parts.push({ type: 'file', data, mediaType: mimeType });
              await safeToolWrite(writer as any, {
                type: 'tool_event',
                tool: 'analyze_media',
                status: 'file_read_complete',
                path: s.path,
                size: data.length,
              });
            } else {
              throw new Error('Fallback direct read failed - no data');
            }
          } catch (fallbackErr: any) {
            await safeToolWrite(writer as any, {
              type: 'tool_event',
              tool: 'analyze_media',
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
      // YouTube URLs must use video/mp4 mime type per AI SDK docs
      const m = isYouTubeUrl(s.url) ? 'video/mp4' : (s.mimeType || inferMimeType(s.url));
      // Pass the URL directly - AI SDK auto-downloads except for YouTube and Google Files API URLs
      parts.push({ type: 'file', data: s.url, mediaType: m });
    }
  }

  const messages = [{ role: 'user' as const, content: parts }];

  let summary = '';
  try {
    const res = await generateText({
      model: google(modelId) as any,
      messages,
      temperature: 0.2,
      ...(isDetailed && {
        providerOptions: {
          google: { thinkingConfig: { thinkingBudget: 8192 } },
        },
      }),
    });
    summary = (res.text || '').trim();
  } catch (err: any) {
    // Handle Gemini blocked content responses
    const responseBody = err?.responseBody || err?.cause?.responseBody || '';
    if (typeof responseBody === 'string' && responseBody.includes('blockReason')) {
      try {
        const parsed = JSON.parse(responseBody);
        const blockReason = parsed?.promptFeedback?.blockReason;
        if (blockReason) {
          summary = `[Content blocked by Gemini: ${blockReason}] Unable to analyze this media. The content may violate Google's usage policies.`;
          await safeToolWrite(writer as any, {
            type: 'tool_event',
            tool: 'analyze_media',
            status: 'blocked',
            reason: blockReason,
          });
        } else {
          throw err;
        }
      } catch {
        if (!summary) {
          throw err;
        }
      }
    } else {
      throw err;
    }
  } finally {
    // Best-effort cleanup of any temporary media objects.
    for (const obj of uploadedObjects) {
      try {
        await deleteTempMediaObject(obj);
      } catch {
        // ignore
      }
    }
  }

  await safeToolWrite(writer as any, {
    type: 'tool_event',
    tool: 'analyze_media',
    status: 'completed',
    length: summary.length,
  });

  return { summary };
}

export const analyzeMediaTool = createTool({
  id: 'analyze_media',
  description:
    'Analyze media files (video, PDF, images, screenshots, audio) or YouTube URLs using Gemini. Use this for all vision/media analysis including screenshots and screen captures. Provide the media source(s) and an optional task prompt (e.g., summarize, extract key points, describe screen, identify UI elements).',
  inputSchema: z.object({
    task: z
      .string()
      .default('Analyze this media and provide key observations, details, and any relevant information.'),
    sources: z
      .array(
        z.object({
          url: z
            .string()
            .url()
            .optional()
            .describe('YouTube URL or direct media URL (video, PDF, image)'),
          path: z
            .string()
            .optional()
            .describe('Local path to a media file (e.g., C:\\path\\to\\video.mp4, C:\\screenshot.png)'),
          data: z
            .string()
            .optional()
            .describe('Base64-encoded media data'),
          mimeType: z
            .string()
            .optional()
            .describe('MIME type of the media (auto-detected if not provided)'),
          captureScreen: z
            .boolean()
            .optional()
            .describe('If true, capture current screen and analyze it (ignores other source fields)'),
        })
      )
      .min(1),
    mode: z.enum(['fast', 'detailed']).default('fast').describe('fast = Gemini 2.5 Flash, detailed = Gemini 3.1 Pro Preview with thinking'),
  }),
  outputSchema: z.object({ summary: z.string() }),
  execute: async (inputData: any, { writer }: any) => {
    return executeAnalyzeMedia(inputData as AnalyzeMediaInput, writer);
  },
} as any);

export const browserUseAnalyzeScreenshotTool = createTool({
  id: 'browser_use_analyze_screenshot',
  description:
    'Capture the current browser page and analyze the screenshot with the fast media-analysis model. ' +
    'Use this when DOM/text tools are not enough, when you need visual interpretation, or when the user asks what is visible. ' +
    'This tool is fast-mode only and returns both the screenshot path and the visual summary.',
  inputSchema: z.object({
    task: z
      .string()
      .default('Analyze the current browser page screenshot and describe the relevant visual details.')
      .describe('What to look for in the browser screenshot.'),
    full_page: z
      .boolean()
      .optional()
      .describe('Capture the full scrollable page instead of just the viewport (default: false)'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    summary: z.string(),
    image_path: z.string().optional(),
    screenshot_path: z.string().optional(),
    format: z.string().optional(),
    url: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData: any, { writer }: any) => {
    const task = String(inputData?.task || 'Analyze the current browser page screenshot and describe the relevant visual details.');
    const fullPage = Boolean(inputData?.full_page);

    await safeToolWrite(writer as any, {
      type: 'tool_event',
      tool: 'browser_use_analyze_screenshot',
      status: 'capturing_screenshot',
      full_page: fullPage,
    });

    const shot = await execLocalTool('browser_use_screenshot', { full_page: fullPage }, writer as any);
    const screenshotPath = typeof shot?.image_path === 'string'
      ? shot.image_path
      : (typeof shot?.screenshot_path === 'string' ? shot.screenshot_path : '');

    if (!shot?.ok || !screenshotPath) {
      return {
        ok: false,
        summary: '',
        error: String(shot?.error || 'browser_screenshot_failed'),
      };
    }

    const { summary } = await executeAnalyzeMedia(
      {
        task,
        sources: [{ path: screenshotPath }],
        mode: 'fast',
      },
      writer,
      { forceFastMode: true },
    );

    await safeToolWrite(writer as any, {
      type: 'tool_event',
      tool: 'browser_use_analyze_screenshot',
      status: 'completed',
      screenshot_path: screenshotPath,
    });

    return {
      ok: true,
      summary,
      image_path: shot?.image_path,
      screenshot_path: shot?.screenshot_path || shot?.image_path,
      format: shot?.format,
      url: shot?.url,
      width: shot?.width,
      height: shot?.height,
    };
  },
} as any);
