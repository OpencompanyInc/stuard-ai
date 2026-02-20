import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { PERPLEXITY_API_KEY } from '../utils/config';

const API_URL = 'https://api.perplexity.ai/search';

/**
 * Trim a search result to only essential fields for the LLM.
 * Removes raw_content, extra metadata, and truncates long snippets.
 */
function trimSearchResult(result: any): any {
  if (!result || typeof result !== 'object') return result;
  const trimmed: any = {};
  if (result.title) trimmed.title = String(result.title).slice(0, 200);
  if (result.url) trimmed.url = result.url;
  // Use snippet/content but cap length
  const text = result.snippet || result.content || result.text || '';
  if (text) trimmed.snippet = String(text).slice(0, 600);
  return trimmed;
}

export const web_search = createTool({
  id: 'web_search',
  description: 'Search the web for up-to-date information. Returns concise results with title, URL, and snippet. Use scrape_url to read full page content when needed.',
  inputSchema: z.object({
    query: z.string().min(1).describe('Search query'),
    max_results: z.number().int().min(1).max(10).default(5).optional().describe('Number of results (default 5, max 10)'),
    search_domain_filter: z.array(z.string()).max(10).optional().describe('Domains to include/exclude (prefix with -)'),
    country: z.string().length(2).optional().describe('Country code (e.g. "US")'),
  }),
  outputSchema: z.object({
    results: z.array(z.any()),
  }),
  execute: async (inputData, context) => {
    const { query: rawQuery, max_results, search_domain_filter, country } = inputData;

    const query = typeof rawQuery === 'string' ? rawQuery : String(rawQuery ?? '');
    if (!query.trim()) {
      throw new Error('Query must be a non-empty string');
    }

    if (!PERPLEXITY_API_KEY) {
      throw new Error('Missing PERPLEXITY_API_KEY configuration');
    }

    const body: any = {
      query: query.trim(),
      max_results: max_results || 5,
      max_tokens_per_page: 512,
    };
    if (search_domain_filter) body.search_domain_filter = search_domain_filter;
    if (country) body.country = country;

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
    // Trim results to essential fields only - strip metadata the LLM doesn't need
    const rawResults = Array.isArray((data as any).results) ? (data as any).results : [];
    const trimmedResults = rawResults.map(trimSearchResult);
    return { results: trimmedResults };
  },
});
