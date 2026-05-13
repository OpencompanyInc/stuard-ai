import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { generateText } from 'ai';
import { google } from '../utils/models';
import { execLocalTool, safeToolWrite } from './bridge';
import { loadMediaSources, cleanupUploadedMedia, type MediaSource } from './media-loader';

type AnalyzeMediaSource = MediaSource;

type AnalyzeMediaMode = 'fast' | 'detailed';

type AnalyzeMediaInput = {
  task?: string;
  sources?: AnalyzeMediaSource[];
  mode?: AnalyzeMediaMode;
};

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
  const { parts: mediaParts, uploadedObjects } = await loadMediaSources(
    sources || [],
    writer,
    'analyze_media',
  );
  const parts: any[] = [
    { type: 'text', text: task || 'Analyze this media and provide key observations, details, and any relevant information.' },
    ...mediaParts,
  ];

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
    await cleanupUploadedMedia(uploadedObjects);
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
