import { describe, expect, it } from 'vitest';
import { normalizeScrapeUrlsInput, scrapeUrlInputSchema } from './tavily-tools';

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
});
