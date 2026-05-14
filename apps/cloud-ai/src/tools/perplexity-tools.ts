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
    [
      'Search the web for up-to-date information. Returns concise results with title, URL, and snippet.',
      '',
      'Modes:',
      '- mode="web" (default): general web search via Perplexity.',
      '- mode="x": search X/Twitter posts via Grok x_search.',
      '',
      'CRITICAL — query string must be natural language only. The backend does NOT parse Google-style operators:',
      '- Do NOT write site:, -site:, intitle:, inurl:, OR, AND, quotes for phrase-match. They are treated as literal text and degrade results.',
      '- Use the structured parameters instead (search_domain_filter, search_recency_filter, search_after_date_filter, etc.).',
      '',
      'Domain filtering (search_domain_filter):',
      '- Pass bare hostnames: ["linkedin.com", "github.com"]. Subdomains work ("blog.example.com"). PATHS DO NOT WORK — "linkedin.com/in" is invalid.',
      '- Prefix with "-" to exclude: ["-pinterest.com", "-reddit.com"].',
      '- Max 20 entries. A root domain (example.com) matches all subdomains.',
      '- LinkedIn, X/Twitter, and other login-gated sites have very sparse coverage; filtering to them often returns zero. Prefer a broad query.',
      '',
      'Date filtering: use search_recency_filter for relative ranges, or the absolute MM/DD/YYYY filters for precise windows.',
    ].join('\n'),
  inputSchema: z.object({
    query: z
      .string()
      .min(1)
      .describe(
        'Natural-language search query. Do NOT include site:, OR, quotes, or other Google operators — use the structured filter parameters instead.',
      ),
    mode: z
      .enum(['web', 'x'])
      .default('web')
      .optional()
      .describe('Search mode: "web" for general web search (default, uses Perplexity), "x" for X/Twitter post search (uses Grok).'),
    max_results: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(5)
      .optional()
      .describe('Number of web results to return (1-20, default 5). Only used in web mode.'),
    search_domain_filter: z
      .array(z.string().max(253))
      .max(20)
      .optional()
      .describe(
        'Restrict results to these hostnames. Pass bare hosts like "linkedin.com" or subdomains like "blog.example.com" — paths are NOT supported. Prefix with "-" to exclude (e.g. "-pinterest.com"). Max 20. Only used in web mode.',
      ),
    country: z
      .string()
      .length(2)
      .optional()
      .describe('ISO 3166-1 alpha-2 country code (e.g. "US", "GB") for localized results. Only used in web mode.'),
    search_language_filter: z
      .array(z.string().length(2))
      .max(20)
      .optional()
      .describe('ISO 639-1 language codes (e.g. ["en", "es"]) to bias results. Max 20. Only used in web mode.'),
    search_recency_filter: z
      .enum(['hour', 'day', 'week', 'month', 'year'])
      .optional()
      .describe('Relative published-within window. Easier than the absolute date filters for "recent" queries. Only used in web mode.'),
    search_after_date_filter: z
      .string()
      .optional()
      .describe('Only results published on/after this date. Format: MM/DD/YYYY. Only used in web mode.'),
    search_before_date_filter: z
      .string()
      .optional()
      .describe('Only results published on/before this date. Format: MM/DD/YYYY. Only used in web mode.'),
    last_updated_after_filter: z
      .string()
      .optional()
      .describe('Only results last updated on/after this date. Format: MM/DD/YYYY. Only used in web mode.'),
    last_updated_before_filter: z
      .string()
      .optional()
      .describe('Only results last updated on/before this date. Format: MM/DD/YYYY. Only used in web mode.'),
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
    const {
      max_results,
      search_domain_filter,
      country,
      search_language_filter,
      search_recency_filter,
      search_after_date_filter,
      search_before_date_filter,
      last_updated_after_filter,
      last_updated_before_filter,
    } = inputData;

    if (!PERPLEXITY_API_KEY) {
      throw new Error('Missing PERPLEXITY_API_KEY configuration');
    }

    const finalQuery = query.trim();

    // Sanitize domain filter: Perplexity rejects entries with paths. Strip any path
    // accidentally included (e.g. "linkedin.com/in" -> "linkedin.com") and dedupe.
    const sanitizedDomains = (search_domain_filter ?? [])
      .map((d) => {
        if (typeof d !== 'string') return '';
        const trimmed = d.trim();
        if (!trimmed) return '';
        const neg = trimmed.startsWith('-');
        const bare = neg ? trimmed.slice(1) : trimmed;
        const host = bare.split('/')[0].split('?')[0].toLowerCase();
        return host ? (neg ? `-${host}` : host) : '';
      })
      .filter((d) => d.length > 0)
      .filter((d, i, arr) => arr.indexOf(d) === i)
      .slice(0, 20);

    const body: any = {
      query: finalQuery,
      max_results: max_results || 5,
      max_tokens_per_page: 512,
    };
    if (sanitizedDomains.length > 0) body.search_domain_filter = sanitizedDomains;
    if (country) body.country = country;
    if (search_language_filter?.length) body.search_language_filter = search_language_filter;
    if (search_recency_filter) body.search_recency_filter = search_recency_filter;
    if (search_after_date_filter) body.search_after_date_filter = search_after_date_filter;
    if (search_before_date_filter) body.search_before_date_filter = search_before_date_filter;
    if (last_updated_after_filter) body.last_updated_after_filter = last_updated_after_filter;
    if (last_updated_before_filter) body.last_updated_before_filter = last_updated_before_filter;

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
    console.log(
      '[web_search] query=%j domains=%j recency=%j count=%d',
      finalQuery,
      sanitizedDomains,
      search_recency_filter ?? null,
      trimmedResults.length,
    );
    return { results: trimmedResults };
  },
});
