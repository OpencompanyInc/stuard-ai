import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { writeFile } from 'fs/promises';
import { basename, extname, join } from 'path';
import { readFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import { mediaGalleryDir } from '../utils/platform';
import { getBridgeSecrets, hasClientBridge, execLocalTool } from './bridge';
import { logUsageEvent } from '../supabase';

// ─── OpenRouter transport ────────────────────────────────────────────────────
// All image generation goes through Stuard's OpenRouter account using the
// chat/completions endpoint with `modalities: ['image','text']`. There is no
// per-vendor native SDK path anymore — the model id is an OpenRouter slug
// (e.g. "google/gemini-3.1-flash-image-preview") and any image-capable
// OpenRouter model is supported, not just a hard-coded list.

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

// Default image model (Nano Banana 2 on OpenRouter). Overridable per-call;
// any image-output OpenRouter model id is accepted.
const DEFAULT_IMAGE_MODEL = 'google/gemini-3.1-flash-image-preview';

function openRouterHeaders(): Record<string, string> {
  const apiKey = process.env.OPENROUTER_API_KEY || '';
  return {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    // Optional attribution headers OpenRouter recommends.
    'HTTP-Referer': 'https://stuard.ai',
    'X-Title': 'Stuard AI',
  };
}

// ─── Supported models ────────────────────────────────────────────────────────
// Curated list surfaced in the tool description and the "no images" hint. The
// model param is still free-form, so any other valid image model id also works.

const SUPPORTED_IMAGE_MODELS: Array<{ id: string; note: string }> = [
  { id: 'google/gemini-3.1-flash-image-preview', note: 'Nano Banana 2 — fast, default' },
  { id: 'google/gemini-3-pro-image-preview', note: 'Nano Banana Pro — best quality, up to 4K, strong text rendering' },
  { id: 'google/gemini-2.5-flash-image', note: 'Nano Banana — fast & efficient' },
  { id: 'openai/gpt-5-image', note: 'high quality' },
  { id: 'openai/gpt-5-image-mini', note: 'fast & cheap' },
];
const SUPPORTED_IMAGE_MODEL_IDS = SUPPORTED_IMAGE_MODELS.map((m) => m.id);

/**
 * Normalize a model id into a fully-qualified vendor slug. Slugs (containing
 * "/") pass through untouched. Bare vendor model names are prefixed so legacy
 * callers that still pass e.g. "gemini-3.1-flash-image-preview" keep working.
 */
export function normalizeImageModelId(model: string): string {
  const m = String(model || '').trim();
  if (!m) return DEFAULT_IMAGE_MODEL;
  if (m.includes('/')) return m;
  if (m.startsWith('gemini') || m.startsWith('imagen') || m.startsWith('lyria')) return `google/${m}`;
  if (m.startsWith('gpt-image') || m.startsWith('gpt-5') || m.startsWith('dall-e')) return `openai/${m}`;
  if (m.startsWith('grok')) return `x-ai/${m}`;
  return m;
}

/** Vendor portion of a model slug (e.g. "google/gemini-..." → "google"). */
function vendorFromModelId(slug: string): string {
  const v = String(slug || '').split('/')[0] || '';
  return v === 'x-ai' ? 'xai' : v;
}

// ─── Input image loading ─────────────────────────────────────────────────────

const INPUT_IMAGE_SCHEMA = z.object({
  path: z.string().optional().describe('Path to a local input image file'),
  filename: z.string().optional().describe('Optional filename override'),
  contentType: z.string().optional().describe('Optional MIME type override'),
  data: z.string().optional().describe('Base64-encoded image data (used when images are sent from desktop to cloud)'),
});

type InputImageFile = z.infer<typeof INPUT_IMAGE_SCHEMA>;

type LoadedInputImage = {
  name: string;
  mimeType: string;
  b64: string;
};

const IMAGE_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
};

/** Infer an image MIME type, never throwing — defaults to image/png. */
function safeImageMimeType(filePath?: string, contentType?: string): string {
  if (contentType?.startsWith('image/')) return contentType;
  return IMAGE_MIME_TYPES[extname(filePath || '').toLowerCase()] || 'image/png';
}

/**
 * Strip a leading `data:<mime>;base64,` URL prefix so we always store/encode raw
 * base64. Models commonly pass a full data URL in the `data` field; without this
 * the prefix would be double-encoded into the image and corrupt it.
 */
export function stripDataUrlPrefix(data: string): string {
  const s = String(data || '').trim();
  const m = /^data:[^,]*,(.*)$/s.exec(s);
  return m ? m[1] : s;
}

async function loadInputImages(inputImages: InputImageFile[] = []): Promise<LoadedInputImage[]> {
  return Promise.all(inputImages.map(loadOneInputImage));
}

async function loadOneInputImage(image: InputImageFile): Promise<LoadedInputImage> {
  const fallbackName = () =>
    image.filename || (image.path ? basename(image.path) : `input_${Date.now()}.png`);

  // 1. Inline base64 — the desktop handler pre-encodes here, and models may pass
  //    data directly. Tolerate a full `data:` URL by stripping the prefix.
  if (image.data) {
    return {
      name: fallbackName(),
      mimeType: image.contentType || safeImageMimeType(image.path, image.contentType),
      b64: stripDataUrlPrefix(image.data),
    };
  }

  const filePath = String(image.path || '').trim();
  if (!filePath) {
    throw new Error('Each input image needs a "path" or base64 "data" field.');
  }

  // 2. Read from the local filesystem — works when the image service runs on the
  //    same machine as the file (local dev / desktop-hosted cloud-ai).
  try {
    const buffer = await readFile(filePath);
    return {
      name: fallbackName(),
      mimeType: safeImageMimeType(filePath, image.contentType),
      b64: buffer.toString('base64'),
    };
  } catch (localErr: any) {
    // 3. The path is on the user's device but cloud-ai is remote — pull the bytes
    //    back over the client bridge instead of failing with ENOENT. This is what
    //    makes image-to-image / reference chaining work in production.
    if (hasClientBridge()) {
      try {
        const res: any = await execLocalTool(
          'read_file_base64',
          { path: filePath, inline: true },
          undefined,
          60_000,
          { silent: true },
        );
        const data = typeof res?.data === 'string' ? res.data : '';
        if (res?.ok && data) {
          return {
            name: fallbackName(),
            mimeType: image.contentType || res.mimeType || safeImageMimeType(filePath, image.contentType),
            b64: stripDataUrlPrefix(data),
          };
        }
        throw new Error(res?.error || 'device bridge returned no data');
      } catch (bridgeErr: any) {
        throw new Error(
          `Could not read input image "${filePath}" over the device bridge (${bridgeErr?.message || bridgeErr}). ` +
          `Pass the image as base64 in the "data" field instead.`,
        );
      }
    }
    throw new Error(
      `Could not read input image "${filePath}" (${localErr?.message || localErr}). ` +
      `If the file is on a different machine than the image service, pass it as base64 in the "data" field instead of "path".`,
    );
  }
}

// ─── Request / response shaping ──────────────────────────────────────────────

type GeneratedImage = { b64: string; format: string };

/**
 * Build the OpenRouter chat message content. A bare prompt is sent as a plain
 * string; when reference images are supplied we send a multimodal content
 * array (text + image_url data URLs) for image-to-image / editing.
 */
export function buildImageMessageContent(
  prompt: string,
  inputImages: LoadedInputImage[],
  aspectRatio?: string,
): any {
  const text = aspectRatio && aspectRatio !== 'auto'
    ? `${prompt}\n\n(Render with aspect ratio ${aspectRatio}.)`
    : prompt;

  if (!inputImages.length) return text;

  return [
    { type: 'text', text },
    ...inputImages.map((img) => ({
      type: 'image_url',
      image_url: { url: `data:${img.mimeType};base64,${img.b64}` },
    })),
  ];
}

/** Parse a `data:image/png;base64,XXXX` URL into base64 + format. */
export function parseImageDataUrl(url: string): GeneratedImage | null {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(String(url || '').trim());
  if (!m) return null;
  const format = m[1].split('/')[1].toLowerCase().replace('jpeg', 'jpg');
  return { b64: m[2], format };
}

/** Extract generated images from an OpenRouter chat/completions response. */
export function extractImagesFromResponse(data: any): GeneratedImage[] {
  const msg = data?.choices?.[0]?.message;
  const raw = Array.isArray(msg?.images) ? msg.images : [];
  const images: GeneratedImage[] = [];
  for (const im of raw) {
    const url = im?.image_url?.url || im?.url || (typeof im === 'string' ? im : '');
    const parsed = parseImageDataUrl(url);
    if (parsed) images.push(parsed);
  }
  return images;
}

/**
 * Extract any assistant text from the response. When a model can't produce an
 * image it usually replies with text explaining why ("I can't generate images…")
 * — surfacing that makes the "no image" failure actionable instead of opaque.
 */
export function extractTextFromResponse(data: any): string {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((p: any) => (typeof p === 'string' ? p : p?.text || ''))
      .join(' ')
      .trim();
  }
  return '';
}

/**
 * OpenRouter request error that carries enough context to map common upstream
 * failures (bad model id, unsupported modality) to a clear, model-readable hint.
 */
class ImageGenError extends Error {
  constructor(public status: number, public body: string) {
    super(`OpenRouter image error ${status}: ${String(body || '').slice(0, 400)}`);
    this.name = 'ImageGenError';
  }

  friendlyMessage(supportedIds: string[]): string {
    const supported = `Supported image models: ${supportedIds.join(', ')}.`;
    const b = String(this.body || '').toLowerCase();
    if (
      this.status === 404 ||
      b.includes('no endpoints found') ||
      b.includes('not a valid model') ||
      b.includes('no allowed providers') ||
      b.includes('is not a valid model id')
    ) {
      return `Model not available for image generation. ${supported}`;
    }
    if (b.includes('modalit') || b.includes('does not support') || b.includes('image output')) {
      return `That model does not support image generation. ${supported}`;
    }
    if (this.status === 429) return 'Image generation is rate-limited right now — try again in a moment.';
    if (this.status === 401 || this.status === 403) return 'Image generation auth failed (check the OpenRouter key).';
    return `${this.message}. ${supported}`;
  }
}

async function generateOneImage(params: {
  model: string;
  prompt: string;
  aspectRatio?: string;
  inputImages: LoadedInputImage[];
}): Promise<{ images: GeneratedImage[]; text: string; costUsd: number; usage: any }> {
  const body = {
    model: params.model,
    messages: [
      { role: 'user', content: buildImageMessageContent(params.prompt, params.inputImages, params.aspectRatio) },
    ],
    modalities: ['image', 'text'],
    // Ask OpenRouter to include the exact upstream cost so we bill accurately.
    usage: { include: true },
  };

  const resp = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: 'POST',
    headers: openRouterHeaders(),
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new ImageGenError(resp.status, errText);
  }

  const data: any = await resp.json();
  const images = extractImagesFromResponse(data);
  const text = extractTextFromResponse(data);
  const usage = data?.usage || null;
  const costUsd = Number(usage?.cost);
  return { images, text, costUsd: Number.isFinite(costUsd) ? costUsd : 0, usage };
}

async function logImageUsage(model: string, costUsd: number, usages: any[]): Promise<void> {
  try {
    const userId = getBridgeSecrets()?.userId;
    if (!userId || typeof userId !== 'string') return;
    const promptTokens = usages.reduce((s, u) => s + (Number(u?.prompt_tokens) || 0), 0);
    const completionTokens = usages.reduce((s, u) => s + (Number(u?.completion_tokens) || 0), 0);
    await logUsageEvent(userId, null, model, {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      ...(costUsd > 0 ? { costUsd: Number(costUsd.toFixed(8)) } : {}),
      provider: 'openrouter',
      endpoint: '/tools/generate_image',
      source_label: 'Image Generation',
    });
  } catch {
    // best-effort billing — never break the tool result
  }
}

// ─── Aspect ratio options ────────────────────────────────────────────────────

const ASPECT_RATIO_OPTIONS = [
  'auto', '1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4',
  '9:16', '16:9', '21:9',
] as const;

// ─── Tool definition ─────────────────────────────────────────────────────────

export const generate_image = createTool({
  id: 'generate_image',
  description:
    'AI image generation. Generate images from a text prompt or reference images. Supported models:\n' +
    SUPPORTED_IMAGE_MODELS.map((m) => `- ${m.id} (${m.note})`).join('\n') + '\n' +
    'Reference images (input_images) enable image-to-image / editing on the Gemini image models. ' +
    'Other image model ids are also accepted and used as-is.',
  inputSchema: z.object({
    prompt: z.string().min(1).max(4000).describe('Text description of the image to generate. Be detailed and specific.'),
    input_images: z.array(INPUT_IMAGE_SCHEMA).optional().describe(
      'Optional input/reference images for image-to-image or editing workflows. Supported by the Gemini image models.'
    ),
    model: z.string().default(DEFAULT_IMAGE_MODEL).describe(
      `Image model id. Default ${DEFAULT_IMAGE_MODEL}. ` +
      'Any supported image model id works; bare vendor names (e.g. "gemini-3.1-flash-image-preview") are auto-prefixed.'
    ),
    aspect_ratio: z.enum(ASPECT_RATIO_OPTIONS).default('auto').describe(
      'Aspect ratio hint. auto = model default. Options: 1:1, 3:2, 2:3, 4:3, 3:4, 9:16, 16:9, 21:9.'
    ),
    n: z.number().int().min(1).max(4).default(1).describe('Number of images to generate (1-4).'),
    format: z.string().default('png').describe('Preferred output format hint: png, webp, jpeg. Actual format follows the model output.'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    images: z.array(z.object({
      filePath: z.string().describe('Local file path where the image was saved'),
      format: z.string(),
      sizeBytes: z.number().optional(),
      revisedPrompt: z.string().optional(),
      _b64: z.string().optional().describe('Base64-encoded image data (internal, used by desktop handler)'),
    })).optional(),
    model: z.string().optional(),
    provider: z.string().optional(),
    note: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (input: any) => {
    const { prompt, input_images = [], model, aspect_ratio, n, format } = input;

    if (!process.env.OPENROUTER_API_KEY) {
      return { ok: false, error: 'openrouter_not_configured' };
    }

    const resolvedModel = normalizeImageModelId(model);

    try {
      const loadedInputImages = input_images.length ? await loadInputImages(input_images) : [];
      const count = Math.min(Math.max(1, Number(n) || 1), 4);

      console.log(`[image-gen] Generating ${count} image(s) via openrouter/${resolvedModel} (ar=${aspect_ratio}, inputs=${loadedInputImages.length})`);

      const results = await Promise.all(
        Array.from({ length: count }, () =>
          generateOneImage({ model: resolvedModel, prompt, aspectRatio: aspect_ratio, inputImages: loadedInputImages }),
        ),
      );

      const generated = results.flatMap((r) => r.images);

      if (!generated.length) {
        // The model returned no image. Surface its own text (it usually explains
        // that it can't generate images) plus the supported list so the agent can
        // switch to a real image model instead of retrying the same one.
        const modelText = results.map((r) => r.text).filter(Boolean).join(' ').trim();
        const hadInputs = loadedInputImages.length > 0;
        const supported = `Supported image models: ${SUPPORTED_IMAGE_MODEL_IDS.join(', ')}.`;
        const error = modelText
          ? `Model "${resolvedModel}" returned text instead of an image${hadInputs ? ' (it may not support reference/input images)' : ''}: "${modelText.slice(0, 240)}". It likely does not support image generation. ${supported}`
          : `Model "${resolvedModel}" did not return an image${hadInputs ? ' — it may not support reference/input images for image-to-image editing' : ' and may not support image generation'}. ${supported}`;
        return { ok: false, error, model: resolvedModel, ...(modelText ? { note: modelText.slice(0, 240) } : {}) };
      }

      const totalCost = results.reduce((s, r) => s + (r.costUsd || 0), 0);
      await logImageUsage(resolvedModel, totalCost, results.map((r) => r.usage));

      // Save to media gallery — models can't handle raw base64 blobs as tool output
      const imgDir = mediaGalleryDir('generated');
      const images: Array<{ filePath: string; format: string; sizeBytes: number; revisedPrompt?: string; _b64?: string }> = [];

      for (const img of generated) {
        const outputFormat = img.format || (format === 'jpeg' ? 'jpg' : format) || 'png';
        const ext = outputFormat === 'jpeg' ? 'jpg' : outputFormat;
        const fileName = `img_${randomUUID().slice(0, 8)}.${ext}`;
        const filePath = join(imgDir, fileName);
        const buffer = Buffer.from(img.b64, 'base64');
        await writeFile(filePath, buffer);
        images.push({
          filePath,
          format: outputFormat,
          sizeBytes: buffer.length,
          // _b64 is used by the desktop handler to save locally, then stripped
          // before the result reaches the model.
          _b64: img.b64,
        });
        console.log(`[image-gen] Saved ${filePath} (${Math.round(buffer.length / 1024)}KB)`);
      }

      console.log(`[image-gen] Generated ${images.length} image(s) via openrouter/${resolvedModel}`);

      // Register images in the desktop media library via bridge (best-effort, silent)
      try {
        const reg: any = await execLocalTool('_media_register', {
          images: images.map((img) => ({
            _b64: img._b64,
            format: img.format,
          })),
          source: 'generated',
          toolName: 'generate_image',
          classification: 'Generated image',
          tags: ['generated', 'ai'],
          metadata: { model: resolvedModel, provider: vendorFromModelId(resolvedModel), prompt },
        }, undefined, 30000, { silent: true });

        // When a desktop/VM bridge handled the registration it re-saved each image
        // to a real on-device path. Surface those local paths back as filePath so
        // the chat trace renders the file that actually exists on the client,
        // instead of cloud-ai's own /root/... path which the client can't read.
        const regItems = Array.isArray(reg?.items) ? reg.items : [];
        for (let i = 0; i < images.length; i++) {
          const localPath = String(regItems[i]?.localPath || '').trim();
          if (regItems[i]?.ok && localPath) images[i].filePath = localPath;
        }
      } catch (regErr: any) {
        console.log(`[image-gen] Media register (best-effort): ${regErr?.message || regErr}`);
      }

      return { ok: true, images, model: resolvedModel, provider: vendorFromModelId(resolvedModel) };
    } catch (e: any) {
      console.error('[image-gen] Error:', e);
      // Map upstream OpenRouter failures (bad model id, unsupported modality, auth,
      // rate limit) to a clear, actionable message instead of a raw HTTP dump.
      if (e instanceof ImageGenError) {
        return { ok: false, error: e.friendlyMessage(SUPPORTED_IMAGE_MODEL_IDS), model: resolvedModel };
      }
      return { ok: false, error: e?.message || 'image_generation_failed', model: resolvedModel };
    }
  },
});
