import { describe, expect, it } from 'vitest';

import { buildGeminiNativeRequestBody, getImageInputSupport } from './image-gen';

describe('getImageInputSupport', () => {
  it('supports all GPT Image models', () => {
    expect(getImageInputSupport('gpt-image-1')).toEqual({ supported: true });
    expect(getImageInputSupport('gpt-image-1.5')).toEqual({ supported: true });
    expect(getImageInputSupport('gpt-image-1-mini')).toEqual({ supported: true });
  });

  it('supports Gemini image-preview models', () => {
    expect(getImageInputSupport('gemini-3.1-flash-image-preview')).toEqual({ supported: true });
    expect(getImageInputSupport('gemini-3.0-pro-image-preview')).toEqual({ supported: true });
    expect(getImageInputSupport('gemini-2.5-flash-image')).toEqual({ supported: true });
  });

  it('supports grok-imagine-image', () => {
    expect(getImageInputSupport('grok-imagine-image')).toEqual({ supported: true });
  });

  it('rejects unsupported models with clear reasons', () => {
    expect(getImageInputSupport('imagen-4.0-generate-001')).toMatchObject({ supported: false });
    expect(getImageInputSupport('dall-e-3')).toMatchObject({ supported: false });
    expect(getImageInputSupport('grok-2-image')).toMatchObject({ supported: false });
  });
});

describe('buildGeminiNativeRequestBody', () => {
  it('includes inline image parts before the prompt and maps size to Gemini config', () => {
    const body = buildGeminiNativeRequestBody({
      prompt: 'Turn this sketch into a polished render',
      size: '1536x1024',
      aspectRatio: 'auto',
      inputImages: [{ mimeType: 'image/png', b64: 'abc123' }],
    });

    expect(body.contents[0].parts).toEqual([
      { inlineData: { mimeType: 'image/png', data: 'abc123' } },
      { text: 'Turn this sketch into a polished render' },
    ]);
    expect(body.generationConfig.imageConfig).toEqual({
      aspectRatio: '3:2',
      imageSize: '2K',
    });
  });

  it('respects an explicit aspect ratio override', () => {
    const body = buildGeminiNativeRequestBody({
      prompt: 'Keep the character consistent',
      size: '1024x1024',
      aspectRatio: '16:9',
    });

    expect(body.generationConfig.imageConfig.aspectRatio).toBe('16:9');
    expect(body.contents[0].parts).toEqual([{ text: 'Keep the character consistent' }]);
  });
});