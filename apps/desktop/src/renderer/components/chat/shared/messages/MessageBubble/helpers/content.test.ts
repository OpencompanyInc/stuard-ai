import { describe, expect, it } from 'vitest';
import { extractContentSegments } from './content';

const kinds = (text: string) => extractContentSegments(text).map((s) => s.kind);

describe('extractContentSegments — links inside code', () => {
  it('keeps a URL inside a fenced code block as literal text (no link preview)', () => {
    const text = 'Run the installer:\n\n```bash\ncurl -fsSL https://paxel.ycombinator.com/install.sh | bash\n```';
    const segs = extractContentSegments(text);
    expect(segs.some((s) => s.kind === 'link_preview')).toBe(false);
    // The whole thing stays a single text segment so the code block renders intact.
    expect(segs.every((s) => s.kind === 'text')).toBe(true);
    expect((segs[0] as { value: string }).value).toContain('https://paxel.ycombinator.com/install.sh');
  });

  it('keeps a URL inside an inline code span as literal text', () => {
    const text = 'Visit `curl https://example.com/x` to install.';
    expect(kinds(text)).not.toContain('link_preview');
  });

  it('protects a URL in a code block that is still streaming (no closing fence)', () => {
    const text = 'Here you go:\n\n```bash\ncurl -fsSL https://example.com/setup.sh';
    expect(kinds(text)).not.toContain('link_preview');
  });

  it('does not turn a youtube link inside code into an embed', () => {
    const text = '```\nopen https://www.youtube.com/watch?v=dQw4w9WgXcQ\n```';
    const k = kinds(text);
    expect(k).not.toContain('youtube');
    expect(k).not.toContain('link_preview');
  });

  it('still renders a link preview for a bare URL in normal prose', () => {
    const text = 'Check out https://example.com for more details.';
    expect(kinds(text)).toContain('link_preview');
  });

  it('renders a link preview before a code block but not the one inside it', () => {
    const text = 'See https://example.com\n\n```sh\nwget https://cdn.example.com/a.tar.gz\n```';
    const previews = extractContentSegments(text).filter((s) => s.kind === 'link_preview');
    expect(previews).toHaveLength(1);
    expect((previews[0] as { url: string }).url).toBe('https://example.com');
  });
});
