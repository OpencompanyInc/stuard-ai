import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { TAVILY_API_KEY } from '../utils/config';

/** Max chars of extracted content per URL to return to LLM */
const MAX_CONTENT_CHARS = 4000;

export const scrape_url = createTool({
  id: 'scrape_url',
  description: 'Extract page content from a URL. Returns truncated text. For full content, use multiple calls with different sections.',
  inputSchema: z.object({
    urls: z
      .union([
        z.string().min(1).transform(s => [s]),
        z.array(z.string().min(1)).min(1).max(5),
      ])
      .describe('URL or list of URLs (max 5)'),
    extractDepth: z
      .enum(['basic', 'advanced'])
      .optional()
      .default('basic')
      .describe('basic is faster; advanced is higher quality'),
  }),
  outputSchema: z.object({
    results: z.array(z.any()),
  }),
  execute: async (inputData, context) => {
    const { urls, extractDepth } = inputData;

    if (!TAVILY_API_KEY) {
      throw new Error('Missing TAVILY_API_KEY configuration');
    }

    const mod: any = await import('@tavily/core');
    const client = mod.tavily({ apiKey: TAVILY_API_KEY });

    const options: any = {
      extractDepth: extractDepth || 'basic',
      format: 'text',
    };

    const response = await client.extract(urls, options);

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
