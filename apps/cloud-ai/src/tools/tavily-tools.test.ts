import { describe, expect, it } from 'vitest';
import {
  normalizeScrapeUrlsInput,
  scrapeUrlInputSchema,
  trimScrapeContent,
  extractScrapeResultText,
  resolveScrapeMaxContentChars,
  splitScrapeLines,
  formatScrapeBatchResponse,
  resolveScrapeMaxLines,
  capScrapeStoredText,
} from './tavily-tools';

describe('scrape_url input normalization', () => {
  it('accepts a plain string URL', () => {
    expect(normalizeScrapeUrlsInput('https://example.com')).toEqual(['https://example.com']);
  });

  it('unwraps a JSON-stringified URL array inside an array', () => {
    expect(
      normalizeScrapeUrlsInput(['["https://docs.x.ai/developers/models"]']),
    ).toEqual(['https://docs.x.ai/developers/models']);
  });

  it('unwraps a JSON-stringified URL array directly', () => {
    expect(
      normalizeScrapeUrlsInput('["https://example.com/a","https://example.com/b"]'),
    ).toEqual(['https://example.com/a', 'https://example.com/b']);
  });

  it('normalizes malformed model output through the schema', () => {
    const parsed = scrapeUrlInputSchema.parse({
      urls: ['["https://docs.x.ai/developers/models"]'],
      extractDepth: 'basic',
    });

    expect(parsed.urls).toEqual(['https://docs.x.ai/developers/models']);
    expect(parsed.extractDepth).toBe('basic');
  });

  it('defaults extractDepth to advanced', () => {
    const parsed = scrapeUrlInputSchema.parse({
      urls: ['https://example.com'],
    });
    expect(parsed.extractDepth).toBe('advanced');
  });

  it('accepts line_start and line_end', () => {
    const parsed = scrapeUrlInputSchema.parse({
      urls: ['https://example.com'],
      line_start: 1,
      line_end: 100,
    });
    expect(parsed.line_start).toBe(1);
    expect(parsed.line_end).toBe(100);
  });
});

describe('scrape_url content shaping', () => {
  it('prefers rawContent from Tavily rows', () => {
    const text = extractScrapeResultText({
      rawContent: '# Hello\n\nFull article body.',
      content: 'snippet only',
    });
    expect(text).toContain('Full article body');
    expect(text).not.toContain('snippet only');
  });

  it('trimScrapeContent reports truncation metadata', () => {
    const long = 'x'.repeat(5000);
    const trimmed = trimScrapeContent(long, 4000);
    expect(trimmed.content).toHaveLength(4000);
    expect(trimmed.truncated).toBe(true);
    expect(trimmed.originalLength).toBe(5000);
  });

  it('resolveScrapeMaxContentChars matches storage cap', () => {
    expect(resolveScrapeMaxContentChars()).toBe(200_000);
  });

  it('splitScrapeLines keeps trailing newlines like read_file', () => {
    const lines = splitScrapeLines('a\nb\nc');
    expect(lines).toEqual(['a\n', 'b\n', 'c']);
  });

  it('formatScrapeBatchResponse returns page_too_large without a line range', () => {
    const body = Array.from({ length: 600 }, (_, i) => `line ${i + 1}`).join('\n');
    const out = formatScrapeBatchResponse('https://example.com', body, { maxLines: 500 });
    expect(out.ok).toBe(false);
    expect(out.error).toBe('page_too_large');
    expect(out.total_lines).toBe(600);
    expect(out.preview_start).toContain('line 1');
    expect(out.hint).toContain('line_start=1');
  });

  it('formatScrapeBatchResponse returns a line slice when range is set', () => {
    const body = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n');
    const out = formatScrapeBatchResponse('https://example.com', body, {
      lineStart: 3,
      lineEnd: 5,
    });
    expect(out.ok).toBe(true);
    expect(out.line_start).toBe(3);
    expect(out.line_end).toBe(5);
    expect(out.lines_returned).toBe(3);
    expect(String(out.content)).toContain('line 3');
    expect(String(out.content)).toContain('line 5');
  });

  it('resolveScrapeMaxLines defaults to 500', () => {
    const prev = process.env.SCRAPE_URL_MAX_LINES;
    delete process.env.SCRAPE_URL_MAX_LINES;
    expect(resolveScrapeMaxLines()).toBe(500);
    if (prev !== undefined) process.env.SCRAPE_URL_MAX_LINES = prev;
  });

  it('capScrapeStoredText enforces session storage limit', () => {
    const long = 'z'.repeat(250_000);
    const capped = capScrapeStoredText(long);
    expect(capped.fullText).toHaveLength(200_000);
    expect(capped.storedTruncated).toBe(true);
  });
});
