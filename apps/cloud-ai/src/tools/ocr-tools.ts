import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { execLocalTool, getBridgeSecrets, safeToolWrite } from './bridge';

const ocrRegionSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
});

function getGoogleVisionApiKey(): string {
  try {
    const secrets = getBridgeSecrets();
    const candidates = [
      (secrets as any)?.GOOGLE_CLOUD_VISION_API_KEY,
      (secrets as any)?.GOOGLE_API_KEY,
      process.env.GOOGLE_CLOUD_VISION_API_KEY,
      process.env.GOOGLE_API_KEY,
    ];
    for (const candidate of candidates) {
      const value = String(candidate || '').trim();
      if (value) return value;
    }
  } catch { }
  return '';
}

function getBoundingBox(vertices: Array<{ x?: number; y?: number }> | undefined) {
  const points = Array.isArray(vertices) ? vertices : [];
  const xs = points.map((point) => Number(point?.x || 0));
  const ys = points.map((point) => Number(point?.y || 0));
  const minX = xs.length ? Math.min(...xs) : 0;
  const maxX = xs.length ? Math.max(...xs) : 0;
  const minY = ys.length ? Math.min(...ys) : 0;
  const maxY = ys.length ? Math.max(...ys) : 0;
  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
}

function extractWordsFromFullTextAnnotation(fullTextAnnotation: any) {
  const words: Array<{ text: string; confidence?: number; boundingBox: { x: number; y: number; width: number; height: number } }> = [];
  try {
    const pages = Array.isArray(fullTextAnnotation?.pages) ? fullTextAnnotation.pages : [];
    for (const page of pages) {
      const blocks = Array.isArray(page?.blocks) ? page.blocks : [];
      for (const block of blocks) {
        const paragraphs = Array.isArray(block?.paragraphs) ? block.paragraphs : [];
        for (const paragraph of paragraphs) {
          const paragraphWords = Array.isArray(paragraph?.words) ? paragraph.words : [];
          for (const word of paragraphWords) {
            const symbols = Array.isArray(word?.symbols) ? word.symbols : [];
            const text = symbols.map((symbol: any) => String(symbol?.text || '')).join('');
            if (!text) continue;
            words.push({
              text,
              confidence: typeof word?.confidence === 'number' ? word.confidence : undefined,
              boundingBox: getBoundingBox(word?.boundingBox?.vertices),
            });
          }
        }
      }
    }
  } catch { }
  return words;
}

function extractWordsFromTextAnnotations(textAnnotations: any) {
  const annotations = Array.isArray(textAnnotations) ? textAnnotations.slice(1) : [];
  return annotations
    .map((annotation: any) => ({
      text: String(annotation?.description || '').trim(),
      boundingBox: getBoundingBox(annotation?.boundingPoly?.vertices),
    }))
    .filter((annotation: any) => annotation.text);
}

function extractDetectedLanguages(fullTextAnnotation: any) {
  const languages = new Set<string>();
  try {
    const pages = Array.isArray(fullTextAnnotation?.pages) ? fullTextAnnotation.pages : [];
    for (const page of pages) {
      const props = page?.property;
      const detected = Array.isArray(props?.detectedLanguages) ? props.detectedLanguages : [];
      for (const item of detected) {
        const code = String(item?.languageCode || '').trim();
        if (code) languages.add(code);
      }
    }
  } catch { }
  return Array.from(languages);
}

async function resolveOcrImage(inputData: any, writer: any) {
  const path = String((inputData as any)?.path || '').trim();
  const imageUrl = String((inputData as any)?.imageUrl || '').trim();
  const base64 = String((inputData as any)?.base64 || '').trim();
  const mimeType = String((inputData as any)?.mimeType || 'image/png').trim() || 'image/png';
  const captureScreen = !!(inputData as any)?.captureScreen;
  const region = (inputData as any)?.region;

  if (captureScreen) {
    await safeToolWrite(writer, { type: 'tool_event', tool: 'google_cloud_ocr', status: 'capturing_screen' });
    const screenshot = await execLocalTool('take_screenshot', { region, hideUI: true }, writer);
    const screenshotPath = typeof screenshot?.filePath === 'string' ? screenshot.filePath : '';
    if (!screenshotPath) return { ok: false as const, error: 'Failed to capture screenshot for OCR.' };
    await safeToolWrite(writer, { type: 'tool_event', tool: 'google_cloud_ocr', status: 'reading_file', path: screenshotPath });
    const bin = await execLocalTool('read_file_binary', { path: screenshotPath }, writer);
    const data = typeof bin?.data === 'string' ? bin.data : '';
    if (!data) return { ok: false as const, error: String(bin?.error || 'Failed to read screenshot image.') };
    return {
      ok: true as const,
      image: { content: data },
      mimeType: String(bin?.mimeType || 'image/png'),
      source: { kind: 'screen_capture', path: screenshotPath },
      screenshotPath,
    };
  }

  if (path) {
    await safeToolWrite(writer, { type: 'tool_event', tool: 'google_cloud_ocr', status: 'reading_file', path });
    const bin = await execLocalTool('read_file_binary', { path }, writer);
    const data = typeof bin?.data === 'string' ? bin.data : '';
    if (!data) return { ok: false as const, error: String(bin?.error || 'Failed to read image file.') };
    return {
      ok: true as const,
      image: { content: data },
      mimeType: String(bin?.mimeType || mimeType),
      source: { kind: 'file', path },
      screenshotPath: undefined,
    };
  }

  if (imageUrl) {
    return {
      ok: true as const,
      image: { source: { imageUri: imageUrl } },
      mimeType,
      source: { kind: 'url', url: imageUrl },
      screenshotPath: undefined,
    };
  }

  if (base64) {
    return {
      ok: true as const,
      image: { content: base64.replace(/^data:[^;]+;base64,/, '') },
      mimeType,
      source: { kind: 'base64' },
      screenshotPath: undefined,
    };
  }

  return { ok: false as const, error: 'Provide `path`, `imageUrl`, or `base64`, or set `captureScreen` to true.' };
}

export const google_cloud_ocr = createTool({
  id: 'google_cloud_ocr',
  description: 'Extract text from an image, screenshot, or image URL using Google Cloud Vision OCR.',
  inputSchema: z.object({
    path: z.string().optional().describe('Local image path to OCR. Best option for workflow files and screenshots.'),
    imageUrl: z.string().url().optional().describe('Public image URL to OCR when the image is already online.'),
    base64: z.string().optional().describe('Raw base64 image bytes. Data URL prefixes are accepted.'),
    mimeType: z.string().optional().default('image/png').describe('MIME type for base64 input when it cannot be inferred automatically.'),
    captureScreen: z.boolean().optional().default(false).describe('Capture a fresh screenshot and OCR it.'),
    region: ocrRegionSchema.optional().describe('Optional screen region used only when captureScreen is true.'),
    ocrMode: z.enum(['document', 'text']).optional().default('document').describe('Use document for dense text like receipts/forms; use text for simple labels and UI text.'),
    languageHints: z.array(z.string()).optional().describe('Optional language hints like ["en", "es"].'),
    includeWordBoxes: z.boolean().optional().default(true).describe('Return per-word bounding boxes for downstream workflow steps.'),
  }),
  execute: async (inputData, { writer }) => {
    const apiKey = getGoogleVisionApiKey();
    if (!apiKey) {
      return {
        ok: false,
        error: 'Google Cloud Vision API key not configured. Set GOOGLE_CLOUD_VISION_API_KEY or GOOGLE_API_KEY.',
      };
    }

    await safeToolWrite(writer, { type: 'tool_event', tool: 'google_cloud_ocr', status: 'starting' });

    const resolved = await resolveOcrImage(inputData, writer);
    if (!resolved.ok) {
      await safeToolWrite(writer, { type: 'tool_event', tool: 'google_cloud_ocr', status: 'error', error: resolved.error });
      return { ok: false, error: resolved.error };
    }

    const ocrMode = String((inputData as any)?.ocrMode || 'document') === 'text' ? 'TEXT_DETECTION' : 'DOCUMENT_TEXT_DETECTION';
    const languageHints = Array.isArray((inputData as any)?.languageHints)
      ? (inputData as any).languageHints.map((value: any) => String(value || '').trim()).filter(Boolean)
      : [];
    const includeWordBoxes = (inputData as any)?.includeWordBoxes !== false;

    await safeToolWrite(writer, {
      type: 'tool_event',
      tool: 'google_cloud_ocr',
      status: 'analyzing',
      mode: ocrMode,
      source: resolved.source.kind,
    });

    let responseBody: any = null;
    try {
      const response = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [
            {
              image: resolved.image,
              features: [{ type: ocrMode }],
              ...(languageHints.length > 0 ? { imageContext: { languageHints } } : {}),
            },
          ],
        }),
      });

      responseBody = await (async () => {
        try { return await response.json(); } catch { return null; }
      })();

      if (!response.ok) {
        const message = String(responseBody?.error?.message || response.statusText || 'Vision API request failed');
        throw new Error(message);
      }
    } catch (error: any) {
      const message = String(error?.message || error || 'Vision API request failed');
      await safeToolWrite(writer, { type: 'tool_event', tool: 'google_cloud_ocr', status: 'error', error: message });
      return { ok: false, error: message };
    }

    const apiResponse = Array.isArray(responseBody?.responses) ? responseBody.responses[0] : null;
    if (apiResponse?.error) {
      const message = String(apiResponse.error?.message || 'Vision API OCR failed');
      await safeToolWrite(writer, { type: 'tool_event', tool: 'google_cloud_ocr', status: 'error', error: message });
      return { ok: false, error: message };
    }

    const text = String(apiResponse?.fullTextAnnotation?.text || apiResponse?.textAnnotations?.[0]?.description || '').trim();
    const words = includeWordBoxes
      ? (() => {
        const fromDocument = extractWordsFromFullTextAnnotation(apiResponse?.fullTextAnnotation);
        return fromDocument.length > 0 ? fromDocument : extractWordsFromTextAnnotations(apiResponse?.textAnnotations);
      })()
      : [];
    const detectedLanguages = extractDetectedLanguages(apiResponse?.fullTextAnnotation);

    await safeToolWrite(writer, {
      type: 'tool_event',
      tool: 'google_cloud_ocr',
      status: 'completed',
      source: resolved.source.kind,
      textLength: text.length,
      wordCount: words.length,
    });

    return {
      ok: true,
      text,
      wordCount: words.length,
      words: includeWordBoxes ? words : undefined,
      detectedLanguages,
      source: resolved.source,
      mimeType: resolved.mimeType,
      screenshotPath: resolved.screenshotPath,
    };
  },
});
