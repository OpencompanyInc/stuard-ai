import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { PERPLEXITY_API_KEY } from '../utils/config';

const API_URL = 'https://api.perplexity.ai/search';
const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

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

/**
 * Execute X (Twitter) search via OpenRouter's x_search plugin on a Grok model.
 */
async function executeXSearch(input: {
  query: string;
  allowed_x_handles?: string[];
  excluded_x_handles?: string[];
  from_date?: string;
  to_date?: string;
}): Promise<{ results: any[] }> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is required for X search mode');
  }

  const xSearchFilter: Record<string, any> = {};
  if (input.allowed_x_handles?.length) xSearchFilter.allowed_x_handles = input.allowed_x_handles;
  if (input.excluded_x_handles?.length) xSearchFilter.excluded_x_handles = input.excluded_x_handles;
  if (input.from_date) xSearchFilter.from_date = input.from_date;
  if (input.to_date) xSearchFilter.to_date = input.to_date;

  const body: any = {
    model: 'x-ai/grok-4.1-fast',
    messages: [
      { role: 'system', content: 'Return the X search results directly. Be concise.' },
      { role: 'user', content: input.query },
    ],
    plugins: [{ id: 'web' }],
  };

  if (Object.keys(xSearchFilter).length > 0) {
    body.x_search_filter = xSearchFilter;
  }

  const response = await fetch(OPENROUTER_CHAT_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter X Search failed: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data: any = await response.json();
  const results: any[] = [];

  // Extract message content
  const choice = data.choices?.[0];
  if (choice?.message?.content) {
    results.push({ type: 'summary', text: String(choice.message.content).slice(0, 4000) });
  }

  // Extract citations if present
  if (Array.isArray(data.citations)) {
    for (const cite of data.citations) {
      results.push({
        type: 'citation',
        url: typeof cite === 'string' ? cite : cite.url || '',
        title: typeof cite === 'object' ? cite.title || '' : '',
        snippet: typeof cite === 'object' ? String(cite.snippet || cite.text || '').slice(0, 600) : '',
      });
    }
  }

  return { results };
}

export const web_search = createTool({
  id: 'web_search',
  description:
    'Search for up-to-date information. Use mode "web" (default) for general web search, or mode "x" to search X (Twitter) posts. Returns concise results with title, URL, and snippet.',
  inputSchema: z.object({
    query: z.string().min(1).describe('Search query'),
    mode: z
      .enum(['web', 'x'])
      .default('web')
      .optional()
      .describe('Search mode: "web" for general web search (default), "x" for X/Twitter post search'),
    max_results: z.number().int().min(1).max(10).default(5).optional().describe('Number of results (default 5, max 10). Only used in web mode.'),
    search_domain_filter: z.array(z.string()).max(10).optional().describe('Domains to include/exclude (prefix with -). Only used in web mode.'),
    country: z.string().length(2).optional().describe('Country code (e.g. "US"). Only used in web mode.'),
    // X search specific params
    allowed_x_handles: z.array(z.string()).max(10).optional().describe('Only include posts from these X handles (max 10). Only used in x mode.'),
    excluded_x_handles: z.array(z.string()).max(10).optional().describe('Exclude posts from these X handles (max 10). Only used in x mode.'),
    from_date: z.string().optional().describe('Start date for X search range (ISO8601 "YYYY-MM-DD"). Only used in x mode.'),
    to_date: z.string().optional().describe('End date for X search range (ISO8601 "YYYY-MM-DD"). Only used in x mode.'),
  }),
  outputSchema: z.object({
    results: z.array(z.any()),
  }),
  execute: async (inputData, context) => {
    const { query: rawQuery, mode = 'web' } = inputData;

    const query = typeof rawQuery === 'string' ? rawQuery : String(rawQuery ?? '');
    if (!query.trim()) {
      throw new Error('Query must be a non-empty string');
    }

    // --- X (Twitter) search mode ---
    if (mode === 'x') {
      return executeXSearch({
        query: query.trim(),
        allowed_x_handles: inputData.allowed_x_handles,
        excluded_x_handles: inputData.excluded_x_handles,
        from_date: inputData.from_date,
        to_date: inputData.to_date,
      });
    }

    // --- Web search mode (Perplexity) ---
    const { max_results, search_domain_filter, country } = inputData;

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
