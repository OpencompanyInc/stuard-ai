import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { PERPLEXITY_API_KEY } from '../utils/config';

const API_URL = 'https://api.perplexity.ai/search';

export const web_search = createTool({
  id: 'web_search',
  description: 'Search the web using Perplexity AI to get ranked, citation-backed results. Supports advanced filtering by domain, language, and country.',
  inputSchema: z.object({
    query: z.string().min(1).describe('The search query string. Must be a non-empty string.'),
    max_results: z.number().int().min(1).max(20).default(10).optional().describe('Number of results to return per query (max 20).'),
    search_domain_filter: z.array(z.string()).max(20).optional().describe('List of domains to include or exclude (prefixed with -). Cannot mix allow and deny lists.'),
    search_language_filter: z.array(z.string()).max(10).optional().describe('List of ISO 639-1 language codes (e.g. "en", "fr") to filter results.'),
    country: z.string().length(2).optional().describe('ISO 3166-1 alpha-2 country code (e.g. "US", "GB") to localize results.'),
    max_tokens_per_page: z.number().int().optional().describe('Max tokens to extract per page. Defaults to 1024. Use higher (2048) for research, lower (512) for speed.'),
  }),
  outputSchema: z.object({
    results: z.array(z.any()),
    id: z.string().optional(),
    usage: z.any().optional(),
  }).passthrough(),
  execute: async (args) => {
    const { query: rawQuery, max_results, search_domain_filter, search_language_filter, country, max_tokens_per_page } = args.context;

    // Ensure query is always a string
    const query = typeof rawQuery === 'string' ? rawQuery : String(rawQuery ?? '');
    if (!query.trim()) {
      throw new Error('Query must be a non-empty string');
    }

    if (!PERPLEXITY_API_KEY) {
      throw new Error('Missing PERPLEXITY_API_KEY configuration');
    }

    const body = {
      query: query.trim(),
      max_results: max_results || 10,
      search_domain_filter,
      search_language_filter,
      country,
      max_tokens_per_page,
    };

    // Remove undefined keys
    Object.keys(body).forEach(key => (body as any)[key] === undefined && delete (body as any)[key]);

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Perplexity API failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    const responseData: any = {
      results: (data as any).results,
      id: (data as any).id,
      usage: (data as any).usage,
    };
    return responseData;
  },
});
