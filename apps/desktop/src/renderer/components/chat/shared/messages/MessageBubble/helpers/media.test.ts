import { describe, expect, it } from 'vitest';
import { collectImageSources, isImagePath, isImageUrl } from './media';

describe('isImageUrl / isImagePath', () => {
  it('detects data:image and image-extension URLs', () => {
    expect(isImageUrl('data:image/png;base64,AAAA')).toBe(true);
    expect(isImageUrl('https://x.com/a/b.png?sig=1')).toBe(true);
    expect(isImageUrl('https://x.com/blob/abc')).toBe(false);
    expect(isImageUrl('data:application/json,{}')).toBe(false);
  });

  it('detects image file paths', () => {
    expect(isImagePath('/tmp/out.png')).toBe(true);
    expect(isImagePath('/tmp/notes.txt')).toBe(false);
  });
});

describe('collectImageSources', () => {
  it('walks nested results for image paths and URLs', () => {
    const result = {
      ok: true,
      data: { images: ['/tmp/a.png', 'https://x.com/b.jpg'], note: 'ignore me' },
      other: '/tmp/log.txt',
    };
    expect(collectImageSources(result)).toEqual(['/tmp/a.png', 'https://x.com/b.jpg']);
  });

  it('ignores extensionless URLs unless the tool is known to emit images', () => {
    const result = { url: 'https://oai.blob/img-xyz' };
    expect(collectImageSources(result)).toEqual([]);
    expect(collectImageSources(result, { assumeImage: true })).toEqual(['https://oai.blob/img-xyz']);
  });

  it('dedupes and caps results', () => {
    const result = { a: '/tmp/x.png', b: '/tmp/x.png', c: '/tmp/y.png' };
    expect(collectImageSources(result)).toEqual(['/tmp/x.png', '/tmp/y.png']);
    expect(collectImageSources({ list: Array(10).fill(0).map((_, i) => `/tmp/i${i}.png`) }, { max: 3 }))
      .toHaveLength(3);
  });
});
