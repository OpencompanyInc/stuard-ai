import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import OpenAI from 'openai';
import { toFile } from 'openai/uploads';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { basename, extname, join } from 'path';
import { randomUUID } from 'crypto';
import { mediaGalleryDir } from '../utils/platform';

// ─── Provider → Model mapping ───────────────────────────────────────────────
// Flexible: if a model isn't listed here, the tool will try to infer the
// provider from the model name. Unknown models default to openai.

const PROVIDER_MODELS: Record<string, string[]> = {
  openai: [
    'gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini',
    'dall-e-3', 'dall-e-2',
  ],
  google: [
    // Nano Banana family (Gemini native image gen)
    'gemini-3.1-flash-image-preview',  // Nano Banana 2 (latest)
    'gemini-3.0-pro-image-preview',    // Nano Banana Pro
    'gemini-2.5-flash-image',          // Nano Banana (original)
    'gemini-2.5-flash-preview-native-audio-dialog',
    // Imagen family (dedicated image models)
    'imagen-4.0-generate-001',         // Imagen 4
    'imagen-3.0-generate-002',         // Imagen 3
  ],
  xai: [
    'grok-imagine-image',              // Grok Imagine (Aurora-powered)
    'grok-2-image',                    // Grok 2 Image (legacy)
  ],
};

function getProviderForModel(model: string): string {
  for (const [provider, models] of Object.entries(PROVIDER_MODELS)) {
    if (models.includes(model)) return provider;
  }
  // Infer from model name prefix
  if (model.startsWith('gemini-') || model.startsWith('imagen-')) return 'google';
  if (model.startsWith('grok-')) return 'xai';
  if (model.startsWith('gpt-image') || model.startsWith('dall-e')) return 'openai';
  return 'openai';
}

const INPUT_IMAGE_SCHEMA = z.object({
  path: z.string().optional().describe('Path to a local input image file'),
  filename: z.string().optional().describe('Optional filename override'),
  contentType: z.string().optional().describe('Optional MIME type override'),
  data: z.string().optional().describe('Base64-encoded image data (used when images are sent from desktop to cloud)'),
});

type InputImageFile = z.infer<typeof INPUT_IMAGE_SCHEMA>;

type LoadedInputImage = InputImageFile & {
  name: string;
  mimeType: string;
  buffer: Buffer;
  b64: string;
};

type GeneratedImagesResult = {
  images: Array<{ b64: string; revisedPrompt?: string }>;
  outputFormat?: string;
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

function inferImageMimeType(filePath: string, contentType?: string): string {
  if (contentType?.startsWith('image/')) return contentType;

  const mimeType = IMAGE_MIME_TYPES[extname(filePath).toLowerCase()];
  if (mimeType) return mimeType;

  throw new Error(`Unsupported input image type for ${filePath}. Use a common image file like png, jpg, jpeg, or webp.`);
}

async function loadInputImages(inputImages: InputImageFile[] = []): Promise<LoadedInputImage[]> {
  return Promise.all(
    inputImages.map(async (image) => {
      // Prefer pre-encoded base64 data (sent from desktop client), fall back to reading from path
      let buffer: Buffer;
      let mimeType: string;

      if (image.data) {
        buffer = Buffer.from(image.data, 'base64');
        mimeType = image.contentType || (image.path ? inferImageMimeType(image.path, image.contentType) : 'image/png');
      } else if (image.path) {
        buffer = await readFile(image.path);
        mimeType = inferImageMimeType(image.path, image.contentType);
      } else {
        throw new Error('Input image must have either a "data" (base64) or "path" field.');
      }

      const name = image.filename || (image.path ? basename(image.path) : `input_${Date.now()}.png`);
      return {
        ...image,
        name,
        mimeType,
        buffer,
        b64: buffer.toString('base64'),
      };
    }),
  );
}

export function getImageInputSupport(model: string): { supported: boolean; reason?: string } {
  const provider = getProviderForModel(model);

  if (provider === 'google') {
    if (model.startsWith('imagen-')) {
      return {
        supported: false,
        reason: 'input_images are not supported for Imagen models. Use a Gemini image-preview model instead.',
      };
    }
    return { supported: true };
  }

  if (provider === 'openai') {
    // All GPT Image models support images.edit (gpt-image-1.5, gpt-image-1, gpt-image-1-mini)
    if (model.startsWith('gpt-image')) return { supported: true };
    if (model.startsWith('dall-e-')) {
      return {
        supported: false,
        reason: 'input_images are not supported for DALL-E models. Use a gpt-image model instead.',
      };
    }
    return { supported: true }; // Default to supported for unknown OpenAI models
  }

  if (provider === 'xai') {
    // Grok Imagine supports multi-reference image editing via /v1/images/edits
    if (model === 'grok-imagine-image') return { supported: true };
    return {
      supported: false,
      reason: `input_images are not supported for ${model}. Use grok-imagine-image instead.`,
    };
  }

  return {
    supported: false,
    reason: `input_images are not supported for model ${model}.`,
  };
}

export function buildGeminiNativeRequestBody(params: {
  prompt: string;
  size: string;
  aspectRatio: string;
  inputImages?: Array<{ mimeType: string; b64: string }>;
}) {
  const resolutionMap: Record<string, string> = {
    '256x256': '512px', '512x512': '512px',
    '1024x1024': '1K', '1536x1024': '2K', '1024x1536': '2K',
    '2048x2048': '2K', '4096x4096': '4K',
  };
  const resolution = resolutionMap[params.size] || '1K';

  let aspectRatio = params.aspectRatio;
  if (aspectRatio === 'auto' && params.size !== 'auto') {
    const sizeToAR: Record<string, string> = {
      '1024x1024': '1:1', '1536x1024': '3:2', '1024x1536': '2:3',
      '512x512': '1:1', '256x256': '1:1',
    };
    aspectRatio = sizeToAR[params.size] || '1:1';
  }
  if (aspectRatio === 'auto') aspectRatio = '1:1';

  const parts = [
    ...((params.inputImages || []).map((image) => ({
      inlineData: {
        mimeType: image.mimeType,
        data: image.b64,
      },
    }))),
    { text: params.prompt },
  ];

  return {
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: {
        aspectRatio,
        imageSize: resolution,
      },
    },
  };
}

// ─── OpenAI client (also used for xAI via baseURL override) ─────────────────

let _openaiClient: OpenAI | null = null;
function getOpenAIClient(): OpenAI {
  if (!_openaiClient) _openaiClient = new OpenAI();
  return _openaiClient;
}

let _xaiClient: OpenAI | null = null;
function getXAIClient(): OpenAI {
  if (!_xaiClient) {
    _xaiClient = new OpenAI({
      apiKey: process.env.XAI_API_KEY,
      baseURL: 'https://api.x.ai/v1',
    });
  }
  return _xaiClient;
}

// ─── OpenAI generation ──────────────────────────────────────────────────────

async function generateWithOpenAI(params: {
  prompt: string;
  model: string;
  size: string;
  quality: string;
  n: number;
  format: string;
  background: string;
  aspectRatio: string;
  inputImages?: LoadedInputImage[];
}): Promise<GeneratedImagesResult> {
  const client = getOpenAIClient();
  const isGptImage = params.model.startsWith('gpt-image');

  if (params.inputImages?.length) {
    if (!params.model.startsWith('gpt-image')) {
      throw new Error(getImageInputSupport(params.model).reason || `input_images are not supported for ${params.model}`);
    }

    const uploads = await Promise.all(
      params.inputImages.map((image) => toFile(image.buffer, image.name, { type: image.mimeType })),
    );

    const requestParams: any = {
      model: params.model,
      prompt: params.prompt,
      image: uploads.length === 1 ? uploads[0] : uploads,
      n: params.n,
      size: params.size !== 'auto' ? params.size : '1024x1024',
    };

    if (params.quality !== 'auto') requestParams.quality = params.quality;
    if (params.background !== 'auto') requestParams.background = params.background;

    const response = await client.images.edit(requestParams);
    const images = (response.data || []).map((img: any) => ({
      b64: img.b64_json || img.b64 || '',
      revisedPrompt: img.revised_prompt,
    }));
    return { images, outputFormat: 'png' };
  }

  const requestParams: any = {
    model: params.model,
    prompt: params.prompt,
    n: params.n,
    size: params.size !== 'auto' ? params.size : '1024x1024',
  };

  if (isGptImage) {
    if (params.quality !== 'auto') requestParams.quality = params.quality;
    if (params.background !== 'auto') requestParams.background = params.background;
    requestParams.output_format = params.format;
  } else {
    // dall-e-3 / dall-e-2
    if (params.model === 'dall-e-3') {
      requestParams.quality = params.quality === 'high' ? 'hd' : 'standard';
      requestParams.n = 1; // dall-e-3 only supports n=1
    }
    requestParams.response_format = 'b64_json';
  }

  const response = await client.images.generate(requestParams);
  const images = (response.data || []).map((img: any) => ({
    b64: img.b64_json || img.b64 || '',
    revisedPrompt: img.revised_prompt,
  }));
  return { images, outputFormat: params.format };
}

// ─── xAI / Grok generation (OpenAI-compatible endpoint) ─────────────────────

async function generateWithXAI(params: {
  prompt: string;
  model: string;
  n: number;
  aspectRatio: string;
  inputImages?: LoadedInputImage[];
}): Promise<GeneratedImagesResult> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new Error('XAI_API_KEY is required for xAI image generation');

  // xAI image editing uses JSON endpoint, NOT OpenAI SDK multipart
  if (params.inputImages?.length && params.model === 'grok-imagine-image') {
    const imageRefs = params.inputImages.map((img) => ({
      url: `data:${img.mimeType};base64,${img.b64}`,
      type: 'image_url' as const,
    }));

    const body: any = {
      model: params.model,
      prompt: params.prompt,
      n: params.n,
      response_format: 'b64_json',
    };
    // Single image → "image", multiple → "images"
    if (imageRefs.length === 1) {
      body.image = imageRefs[0];
    } else {
      body.images = imageRefs;
    }
    if (params.aspectRatio !== 'auto') {
      body.aspect_ratio = params.aspectRatio;
    }

    const resp = await fetch('https://api.x.ai/v1/images/edits', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`xAI image edit error ${resp.status}: ${errText.slice(0, 300)}`);
    }

    const data: any = await resp.json();
    const images = (data?.data || []).map((img: any) => ({
      b64: img.b64_json || img.b64 || '',
      revisedPrompt: img.revised_prompt,
    }));
    return { images, outputFormat: 'jpeg' };
  }

  // Standard generation (no input images)
  const client = getXAIClient();

  const requestParams: any = {
    model: params.model,
    prompt: params.prompt,
    n: params.n,
    response_format: 'b64_json',
  };
  if (params.aspectRatio !== 'auto') {
    requestParams.aspect_ratio = params.aspectRatio;
  }

  const response = await client.images.generate(requestParams);
  const images = (response.data || []).map((img: any) => ({
    b64: img.b64_json || img.b64 || '',
    revisedPrompt: img.revised_prompt,
  }));
  return { images, outputFormat: 'jpeg' };
}

// ─── Google generation (REST API) ───────────────────────────────────────────

async function generateWithGoogle(params: {
  prompt: string;
  model: string;
  n: number;
  aspectRatio: string;
  size: string;
  inputImages?: LoadedInputImage[];
}): Promise<GeneratedImagesResult> {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
  if (!apiKey) throw new Error('GOOGLE_GENERATIVE_AI_API_KEY or GEMINI_API_KEY is required for Google image generation');

  const isImagen = params.model.startsWith('imagen-');

  if (isImagen) {
    if (params.inputImages?.length) {
      throw new Error(getImageInputSupport(params.model).reason || `input_images are not supported for ${params.model}`);
    }
    return generateWithImagen(params, apiKey);
  }
  return generateWithGeminiNative(params, apiKey);
}

// Gemini native image gen (Nano Banana family) — uses generateContent
async function generateWithGeminiNative(params: {
  prompt: string;
  model: string;
  n: number;
  aspectRatio: string;
  size: string;
  inputImages?: LoadedInputImage[];
}, apiKey: string): Promise<GeneratedImagesResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${params.model}:generateContent?key=${apiKey}`;
  const body = buildGeminiNativeRequestBody(params);

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Google API error ${resp.status}: ${errText.slice(0, 300)}`);
  }

  const data: any = await resp.json();
  const images: Array<{ b64: string; revisedPrompt?: string }> = [];
  const parts = data?.candidates?.[0]?.content?.parts || [];

  let textResponse = '';
  for (const part of parts) {
    if (part.text) textResponse = part.text;
    if (part.inlineData?.data) {
      images.push({
        b64: part.inlineData.data,
        revisedPrompt: textResponse || undefined,
      });
    }
  }

  return { images, outputFormat: 'png' };
}

// Imagen family — uses predict endpoint
async function generateWithImagen(params: {
  prompt: string;
  model: string;
  n: number;
  aspectRatio: string;
  size: string;
}, apiKey: string): Promise<GeneratedImagesResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${params.model}:predict?key=${apiKey}`;

  let aspectRatio = params.aspectRatio;
  if (aspectRatio === 'auto') {
    const sizeToAR: Record<string, string> = {
      '1024x1024': '1:1', '1536x1024': '16:9', '1024x1536': '9:16',
      '512x512': '1:1', '256x256': '1:1',
    };
    aspectRatio = (params.size !== 'auto' && sizeToAR[params.size]) || '1:1';
  }

  const sizeMap: Record<string, string> = {
    '256x256': '1K', '512x512': '1K',
    '1024x1024': '1K', '1536x1024': '2K', '1024x1536': '2K',
    '2048x2048': '2K',
  };
  const imageSize = (params.size !== 'auto' && sizeMap[params.size]) || '1K';

  const body = {
    instances: [{ prompt: params.prompt }],
    parameters: {
      sampleCount: params.n,
      aspectRatio,
      imageSize,
    },
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Google Imagen API error ${resp.status}: ${errText.slice(0, 300)}`);
  }

  const data: any = await resp.json();
  const predictions = data?.predictions || [];
  const images = predictions
    .filter((p: any) => p.bytesBase64Encoded)
    .map((p: any) => ({
      b64: p.bytesBase64Encoded,
      revisedPrompt: undefined,
    }));

  return { images, outputFormat: 'png' };
}

// ─── Aspect ratio options ────────────────────────────────────────────────────

const ASPECT_RATIO_OPTIONS = [
  'auto', '1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4',
  '9:16', '16:9', '21:9',
] as const;

// ─── Tool definition ─────────────────────────────────────────────────────────

const allModels = Object.values(PROVIDER_MODELS).flat();

export const generate_image = createTool({
  id: 'generate_image',
  description:
    'Generate images from a text prompt or reference images using AI. Supports multiple providers and models:\n' +
    '- OpenAI: gpt-image-1.5 (latest), gpt-image-1, gpt-image-1-mini, dall-e-3\n' +
    '- Google: gemini-3.1-flash-image-preview (Nano Banana 2), gemini-3.0-pro-image-preview (Nano Banana Pro), gemini-2.5-flash-image (Nano Banana), imagen-4.0-generate-001 (Imagen 4)\n' +
    '- xAI: grok-imagine-image (Aurora), grok-2-image\n' +
    'Choose model based on need: gpt-image-1.5 or Nano Banana Pro for best quality, gpt-image-1-mini or Nano Banana 2 for speed, grok-imagine-image for style variety.',
  inputSchema: z.object({
    prompt: z.string().min(1).max(4000).describe('Text description of the image to generate. Be detailed and specific.'),
    input_images: z.array(INPUT_IMAGE_SCHEMA).optional().describe(
      'Optional input/reference images for image-to-image or editing workflows. ' +
      'Supported by: all GPT Image models (gpt-image-1.5, gpt-image-1, gpt-image-1-mini), ' +
      'Gemini image-preview models, and grok-imagine-image (up to 3 images). ' +
      'NOT supported by: DALL-E, Imagen, or grok-2-image.'
    ),
    model: z.string().default('gpt-image-1').describe(
      `Image model to use. Known models: ${allModels.join(', ')}. ` +
      'You can also pass any new model ID — the provider is auto-detected from the prefix.'
    ),
    size: z.string().default('auto').describe(
      'Image dimensions (WxH). Examples: auto, 1024x1024, 1536x1024, 1024x1536, 512x512, 256x256. ' +
      'For Google/xAI models, prefer aspect_ratio instead.'
    ),
    aspect_ratio: z.enum(ASPECT_RATIO_OPTIONS).default('auto').describe(
      'Aspect ratio. Used by Google and xAI models. auto = 1:1. Options: 1:1, 3:2, 2:3, 4:3, 3:4, 9:16, 16:9, 21:9.'
    ),
    quality: z.string().default('auto').describe(
      'Image quality. auto, low, medium, high. Applies to OpenAI models. dall-e-3 uses "standard" or "hd".'
    ),
    n: z.number().int().min(1).max(4).default(1).describe('Number of images (1-4). dall-e-3 only supports 1.'),
    format: z.string().default('png').describe('Output format: png, webp, jpeg. png supports transparency.'),
    background: z.string().default('auto').describe(
      'Background: auto, transparent, opaque. Transparent only for OpenAI gpt-image models with png/webp.'
    ),
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
    error: z.string().optional(),
  }),
  execute: async (input) => {
    const { prompt, input_images = [], model, size, aspect_ratio, quality, n, format, background } = input;

    try {
      const provider = getProviderForModel(model);
      const hasInputImages = input_images.length > 0;
      const imageInputSupport = hasInputImages ? getImageInputSupport(model) : { supported: false };
      if (hasInputImages && !imageInputSupport.supported) {
        return { ok: false, error: imageInputSupport.reason || 'input_images_not_supported' };
      }

      const loadedInputImages = hasInputImages ? await loadInputImages(input_images) : [];

      console.log(`[image-gen] Generating ${n} image(s) with ${provider}/${model} (size=${size}, ar=${aspect_ratio}, quality=${quality}, inputs=${loadedInputImages.length})`);

      let result: GeneratedImagesResult;

      switch (provider) {
        case 'google':
          result = await generateWithGoogle({ prompt, model, n, aspectRatio: aspect_ratio, size, inputImages: loadedInputImages });
          break;
        case 'xai':
          result = await generateWithXAI({ prompt, model, n, aspectRatio: aspect_ratio, inputImages: loadedInputImages });
          break;
        case 'openai':
        default:
          result = await generateWithOpenAI({ prompt, model, size, quality, n, format, background, aspectRatio: aspect_ratio, inputImages: loadedInputImages });
          break;
      }

      if (!result.images.length) {
        return { ok: false, error: 'no_images_generated' };
      }

      // Save to media gallery — models can't handle raw base64 blobs as tool output
      const outputFormat = result.outputFormat || (provider === 'xai' ? 'jpeg' : format);
      const imgDir = mediaGalleryDir('generated');

      const images: Array<{ filePath: string; format: string; sizeBytes: number; revisedPrompt?: string; _b64?: string }> = [];

      for (const img of result.images) {
        const ext = outputFormat === 'jpeg' ? 'jpg' : outputFormat;
        const fileName = `img_${randomUUID().slice(0, 8)}.${ext}`;
        const filePath = join(imgDir, fileName);
        const buffer = Buffer.from(img.b64, 'base64');
        await writeFile(filePath, buffer);
        images.push({
          filePath,
          format: outputFormat,
          sizeBytes: buffer.length,
          revisedPrompt: img.revisedPrompt,
          // _b64 is used by the desktop handler to save locally, then stripped
          // before the result reaches the model. Not declared in outputSchema.
          _b64: img.b64,
        });
        console.log(`[image-gen] Saved ${filePath} (${Math.round(buffer.length / 1024)}KB)`);
      }

      console.log(`[image-gen] Generated ${images.length} image(s) via ${provider}/${model}`);

      // Register images in the desktop media library via bridge (best-effort, silent)
      try {
        const { execLocalTool } = await import('./bridge');
        await execLocalTool('_media_register', {
          images: images.map(img => ({
            _b64: img._b64,
            format: img.format,
            revisedPrompt: img.revisedPrompt,
          })),
          source: 'generated',
          toolName: 'generate_image',
          classification: 'Generated image',
          tags: ['generated', 'ai'],
          metadata: { model, provider, prompt },
        }, undefined, 30000, { silent: true });
      } catch (regErr: any) {
        console.log(`[image-gen] Media register (best-effort): ${regErr?.message || regErr}`);
      }

      return { ok: true, images, model, provider };
    } catch (e: any) {
      console.error('[image-gen] Error:', e);
      return { ok: false, error: e?.message || 'image_generation_failed' };
    }
  },
});
