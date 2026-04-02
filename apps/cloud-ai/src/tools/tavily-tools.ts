import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { TAVILY_API_KEY } from '../utils/config';

/** Max chars of extracted content per URL to return to LLM */
const MAX_CONTENT_CHARS = 4000;

function tryParseJson(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed || !/^[\[{"]/.test(trimmed)) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

export function normalizeScrapeUrlsInput(input: unknown, depth = 0): string[] {
  if (depth > 3 || input == null) {
    return [];
  }

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) {
      return [];
    }

    const parsed = tryParseJson(trimmed);
    if (parsed !== undefined) {
      const nested = normalizeScrapeUrlsInput(parsed, depth + 1);
      if (nested.length > 0) {
        return nested;
      }
    }

    return [trimmed];
  }

  if (Array.isArray(input)) {
    const normalized = input.flatMap((value) => normalizeScrapeUrlsInput(value, depth + 1));
    return Array.from(new Set(normalized));
  }

  return [];
}

export const scrapeUrlInputSchema = z.object({
  urls: z.preprocess(
    (value) => normalizeScrapeUrlsInput(value),
    z.array(z.string().min(1)).min(1).max(5),
  ).describe('URL or list of URLs (max 5). Accepts JSON-stringified arrays too.'),
  extractDepth: z
    .enum(['basic', 'advanced'])
    .optional()
    .default('basic')
    .describe('basic is faster; advanced is higher quality'),
});

export const scrape_url = createTool({
  id: 'scrape_url',
  description: 'Extract page content from a URL. Returns truncated text. For full content, use multiple calls with different sections.',
  inputSchema: scrapeUrlInputSchema,
  outputSchema: z.object({
    results: z.array(z.any()),
  }),
  execute: async (inputData, context) => {
    const { urls, extractDepth } = inputData;
    const normalizedUrls = normalizeScrapeUrlsInput(urls);

    if (!TAVILY_API_KEY) {
      throw new Error('Missing TAVILY_API_KEY configuration');
    }
    if (normalizedUrls.length === 0) {
      throw new Error('At least one valid URL is required');
    }

    const mod: any = await import('@tavily/core');
    const client = mod.tavily({ apiKey: TAVILY_API_KEY });

    const options: any = {
      extractDepth: extractDepth || 'basic',
      format: 'text',
    };

    const response = await client.extract(normalizedUrls, options);

    // Trim results: only keep url + truncated content
    const trimmed = ((response as any)?.results || []).map((r: any) => {
      const content = String(r.rawContent || r.content || r.text || '').slice(0, MAX_CONTENT_CHARS);
      const result: any = { url: r.url };
      if (content) {
        result.content = content;
        if (content.length >= MAX_CONTENT_CHARS) result.truncated = true;
      }
      return result;
    });

    return { results: trimmed };
  },
});
