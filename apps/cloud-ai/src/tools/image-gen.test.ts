import { describe, expect, it } from 'vitest';

import {
  normalizeImageModelId,
  buildImageMessageContent,
  parseImageDataUrl,
  extractImagesFromResponse,
} from './image-gen';

describe('normalizeImageModelId', () => {
  it('passes through OpenRouter slugs untouched', () => {
    expect(normalizeImageModelId('google/gemini-3.1-flash-image-preview')).toBe('google/gemini-3.1-flash-image-preview');
    expect(normalizeImageModelId('openai/gpt-5-image')).toBe('openai/gpt-5-image');
  });

  it('prefixes bare vendor model names', () => {
    expect(normalizeImageModelId('gemini-3.1-flash-image-preview')).toBe('google/gemini-3.1-flash-image-preview');
    expect(normalizeImageModelId('imagen-4.0-generate-001')).toBe('google/imagen-4.0-generate-001');
    expect(normalizeImageModelId('gpt-image-1')).toBe('openai/gpt-image-1');
    expect(normalizeImageModelId('gpt-5-image-mini')).toBe('openai/gpt-5-image-mini');
    expect(normalizeImageModelId('grok-imagine-image')).toBe('x-ai/grok-imagine-image');
  });

  it('falls back to the default for empty input', () => {
    expect(normalizeImageModelId('')).toBe('google/gemini-3.1-flash-image-preview');
  });
});

describe('buildImageMessageContent', () => {
  it('returns a plain string when there are no reference images', () => {
    expect(buildImageMessageContent('a red bicycle', [])).toBe('a red bicycle');
  });

  it('appends an aspect-ratio hint when not auto', () => {
    expect(buildImageMessageContent('a red bicycle', [], '16:9')).toContain('aspect ratio 16:9');
    expect(buildImageMessageContent('a red bicycle', [], 'auto')).toBe('a red bicycle');
  });

  it('builds a multimodal content array for image-to-image', () => {
    const content = buildImageMessageContent('edit this', [{ name: 'in.png', mimeType: 'image/png', b64: 'abc123' }]);
    expect(content).toEqual([
      { type: 'text', text: 'edit this' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,abc123' } },
    ]);
  });
});

describe('parseImageDataUrl', () => {
  it('parses a base64 data URL into b64 + normalized format', () => {
    expect(parseImageDataUrl('data:image/png;base64,AAAA')).toEqual({ b64: 'AAAA', format: 'png' });
    expect(parseImageDataUrl('data:image/jpeg;base64,BBBB')).toEqual({ b64: 'BBBB', format: 'jpg' });
  });

  it('returns null for non-image / malformed urls', () => {
    expect(parseImageDataUrl('https://example.com/x.png')).toBeNull();
    expect(parseImageDataUrl('')).toBeNull();
  });
});

describe('extractImagesFromResponse', () => {
  it('extracts images from choices[0].message.images', () => {
    const data = {
      choices: [
        {
          message: {
            images: [
              { type: 'image_url', image_url: { url: 'data:image/png;base64,ZZZZ' } },
            ],
          },
        },
      ],
    };
    expect(extractImagesFromResponse(data)).toEqual([{ b64: 'ZZZZ', format: 'png' }]);
  });

  it('returns an empty array when there are no images', () => {
    expect(extractImagesFromResponse({ choices: [{ message: { content: 'no image' } }] })).toEqual([]);
    expect(extractImagesFromResponse({})).toEqual([]);
  });
});
