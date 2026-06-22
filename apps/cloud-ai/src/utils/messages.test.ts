import { describe, it, expect } from 'vitest';
import { buildAttachmentParts } from './messages';

// 1x1 transparent PNG.
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('buildAttachmentParts — modality gating', () => {
  const imageAttachment = {
    type: 'image',
    name: 'shot.png',
    mimeType: 'image/png',
    data: PNG_B64,
    path: 'C:/Users/me/shot.png',
  };

  it('embeds images natively when the model supports image input', () => {
    const parts = buildAttachmentParts([imageAttachment], { image: true, file: true });
    expect(parts).toHaveLength(1);
    expect(parts[0].type).toBe('image');
    expect(Buffer.isBuffer(parts[0].image)).toBe(true);
    expect(parts[0].mediaType).toBe('image/png');
  });

  it('defaults to embedding everything when no support is provided (back-compat)', () => {
    const parts = buildAttachmentParts([imageAttachment]);
    expect(parts[0].type).toBe('image');
  });

  it('downgrades an unsupported image to a hidden file-path reference', () => {
    const parts = buildAttachmentParts([imageAttachment], { image: false, file: true });
    expect(parts).toHaveLength(1);
    expect(parts[0].type).toBe('text');
    expect(parts[0].text).toContain('C:/Users/me/shot.png');
    expect(parts[0].text).toContain("can't view images");
    // The binary must NOT be embedded for a non-vision model.
    expect(parts[0].text).not.toContain(PNG_B64);
  });

  it('tells the user to switch models when an unsupported image has no path', () => {
    const parts = buildAttachmentParts(
      [{ type: 'image', name: 'paste.png', mimeType: 'image/png', data: PNG_B64 }],
      { image: false, file: true },
    );
    expect(parts[0].type).toBe('text');
    expect(parts[0].text).toContain('no local file path');
    expect(parts[0].text).toContain('vision-capable');
  });

  it('downgrades an unsupported binary file to a hidden file-path reference', () => {
    const parts = buildAttachmentParts(
      [{ type: 'file', name: 'report.pdf', mimeType: 'application/pdf', data: 'AAAA', path: '/tmp/report.pdf' }],
      { image: true, file: false },
    );
    expect(parts[0].type).toBe('text');
    expect(parts[0].text).toContain('/tmp/report.pdf');
    expect(parts[0].text).toContain('file tools');
    expect(parts[0].text).not.toContain('AAAA'); // raw binary must not be embedded
  });

  it('tells the user to switch models when an unsupported file has no path', () => {
    const parts = buildAttachmentParts(
      [{ type: 'file', name: 'report.pdf', mimeType: 'application/pdf', data: 'AAAA' }],
      { image: true, file: false },
    );
    expect(parts[0].type).toBe('text');
    expect(parts[0].text).toContain('document-capable');
  });

  it('embeds a binary file natively when the model supports file input', () => {
    const parts = buildAttachmentParts(
      [{ type: 'file', name: 'report.pdf', mimeType: 'application/pdf', data: 'AAAA', path: '/tmp/report.pdf' }],
      { image: true, file: true },
    );
    expect(parts[0].type).toBe('file');
    expect(Buffer.isBuffer(parts[0].data)).toBe(true);
    expect(parts[0].mediaType).toBe('application/pdf');
  });

  it('always inlines text-like files as text, regardless of modality support', () => {
    const text = 'hello world from a notes file';
    const parts = buildAttachmentParts(
      [{ type: 'file', name: 'notes.txt', mimeType: 'text/plain', data: Buffer.from(text).toString('base64') }],
      { image: false, file: false },
    );
    expect(parts[0].type).toBe('text');
    expect(parts[0].text).toContain(text);
    expect(parts[0].text).toContain('notes.txt');
  });
});
