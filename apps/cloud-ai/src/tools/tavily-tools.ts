import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getBridgeState, setBridgeState } from './bridge';
import { TAVILY_API_KEY } from '../utils/config';

const SCRAPE_CACHE_KEY = '__scrapeUrlCache';
const DEFAULT_MAX_SCRAPE_LINES = 500;
const ABSOLUTE_MAX_SCRAPE_LINES = 5000;
const PREVIEW_LINES = 10;
/** If basic extraction returns less than this, retry once with advanced */
const SHORT_CONTENT_RETRY_THRESHOLD = 900;
/** Cap stored extracted text per URL to avoid unbounded memory */
const MAX_STORED_CHARS = 200_000;

type ExtractDepth = 'basic' | 'advanced';

export type ScrapeCacheEntry = {
  fullText: string;
  title?: string;
  extractDepth: ExtractDepth;
  fetchedAt: number;
  storedTruncated?: boolean;
  originalLength?: number;
};

export type ScrapeUrlCache = Record<string, ScrapeCacheEntry>;

export function resolveScrapeMaxLines(): number {
  const raw = Number(process.env.SCRAPE_URL_MAX_LINES || '');
  if (!Number.isNaN(raw) && raw > 0) {
    return Math.min(Math.floor(raw), ABSOLUTE_MAX_SCRAPE_LINES);
  }
  return DEFAULT_MAX_SCRAPE_LINES;
}

export function splitScrapeLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n');
  if (!normalized) return [];
  const parts = normalized.split('\n');
  return parts.map((line, index) => (index < parts.length - 1 ? `${line}\n` : line));
}

export function extractScrapeResultText(result: Record<string, unknown>): string {
  const candidates = [
    result?.rawContent,
    result?.raw_content,
    result?.content,
    result?.text,
  ];
  for (const value of candidates) {
    const text = String(value ?? '').trim();
    if (text) return text.replace(/\r\n/g, '\n');
  }
  return '';
}

export function capScrapeStoredText(text: string): {
  fullText: string;
  storedTruncated: boolean;
  originalLength: number;
} {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return { fullText: '', storedTruncated: false, originalLength: 0 };
  }
  if (normalized.length <= MAX_STORED_CHARS) {
    return { fullText: normalized, storedTruncated: false, originalLength: normalized.length };
  }
  return {
    fullText: normalized.slice(0, MAX_STORED_CHARS),
    storedTruncated: true,
    originalLength: normalized.length,
  };
}

export function formatScrapeBatchResponse(
  url: string,
  fullText: string,
  options: {
    lineStart?: number;
    lineEnd?: number;
    maxLines?: number;
    title?: string;
    extractDepth?: 'basic' | 'advanced';
    fromCache?: boolean;
    storedTruncated?: boolean;
    originalLength?: number;
  } = {},
): Record<string, unknown> {
  const maxLines = options.maxLines ?? resolveScrapeMaxLines();
  const lines = splitScrapeLines(fullText);
  const totalLines = lines.length;
  const base: Record<string, unknown> = { url };
  if (options.title) base.title = options.title;
  if (options.extractDepth) base.extractDepth = options.extractDepth;
  if (options.fromCache) base.fromCache = true;
  if (options.storedTruncated) {
    base.storedTruncated = true;
    base.originalLength = options.originalLength;
    base.storageNote = `Extracted text was capped at ${MAX_STORED_CHARS} characters in session cache.`;
  }

  if (!fullText.trim()) {
    return { ...base, ok: false, error: 'no_content_extracted' };
  }

  const lineStart = options.lineStart;
  const lineEnd = options.lineEnd;
  const hasRange = lineStart != null || lineEnd != null;

  if (!hasRange && totalLines > maxLines) {
    const previewStart = lines.slice(0, PREVIEW_LINES).join('');
    const previewEnd =
      totalLines > PREVIEW_LINES * 2 ? lines.slice(-PREVIEW_LINES).join('') : '';
    return {
      ...base,
      ok: false,
      error: 'page_too_large',
      message: `Page has ${totalLines} lines which exceeds the ${maxLines} line limit. Use line_start and line_end to read specific portions.`,
      total_lines: totalLines,
      max_lines: maxLines,
      preview_start: previewStart,
      preview_end: previewEnd,
      hint: `Try: line_start=1, line_end=${maxLines} to read the first ${maxLines} lines`,
    };
  }

  if (hasRange) {
    const startIdx = lineStart != null ? Math.max(0, lineStart - 1) : 0;
    const endIdx = lineEnd != null ? Math.min(lineEnd, totalLines) : totalLines;
    const clampedStart = Math.min(startIdx, totalLines);
    const clampedEnd = Math.max(clampedStart, Math.min(endIdx, totalLines));
    const slice = lines.slice(clampedStart, clampedEnd);
    return {
      ...base,
      ok: true,
      content: slice.join(''),
      line_start: clampedStart + 1,
      line_end: clampedStart + slice.length,
      lines_returned: slice.length,
      total_lines: totalLines,
    };
  }

  return {
    ...base,
    ok: true,
    content: lines.join(''),
    total_lines: totalLines,
  };
}

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

function getScrapeCache(): ScrapeUrlCache {
  return getBridgeState<ScrapeUrlCache>(SCRAPE_CACHE_KEY) || {};
}

function setScrapeCacheEntry(url: string, entry: ScrapeCacheEntry): void {
  const cache = { ...getScrapeCache(), [url]: entry };
  setBridgeState(SCRAPE_CACHE_KEY, cache);
}

function shouldUseCacheEntry(
  entry: ScrapeCacheEntry | undefined,
  requestedDepth: 'basic' | 'advanced',
): boolean {
  if (!entry?.fullText?.trim()) return false;
  if (requestedDepth === 'basic') return true;
  return entry.extractDepth === 'advanced';
}

type TavilyExtractClient = {
  extract: (
    urls: string[],
    options?: {
      extractDepth?: 'basic' | 'advanced';
      format?: 'markdown' | 'text';
      timeout?: number;
    },
  ) => Promise<{
    results?: Array<Record<string, unknown>>;
    failedResults?: Array<{ url?: string; error?: string }>;
  }>;
};

function buildExtractOptions(depth: 'basic' | 'advanced') {
  return {
    extractDepth: depth,
    format: 'markdown' as const,
    timeout: depth === 'advanced' ? 30 : 15,
  };
}

async function extractWithClient(
  client: TavilyExtractClient,
  urls: string[],
  depth: ExtractDepth,
) {
  return client.extract(urls, buildExtractOptions(depth));
}

export async function scrapeUrlsWithTavily(
  urls: string[],
  options: { extractDepth?: ExtractDepth } = {},
): Promise<{
  byUrl: Map<string, { fullText: string; title?: string; extractDepth: ExtractDepth }>;
  failed: Map<string, string>;
  activeDepth: ExtractDepth;
}> {
  const normalizedUrls = normalizeScrapeUrlsInput(urls);
  if (!TAVILY_API_KEY) {
    throw new Error('Missing TAVILY_API_KEY configuration');
  }
  if (normalizedUrls.length === 0) {
    throw new Error('At least one valid URL is required');
  }

  const requestedDepth: ExtractDepth = options.extractDepth === 'basic' ? 'basic' : 'advanced';

  const mod: any = await import('@tavily/core');
  const client = mod.tavily({ apiKey: TAVILY_API_KEY }) as TavilyExtractClient;

  let activeDepth: ExtractDepth = requestedDepth;
  let response = await extractWithClient(client, normalizedUrls, activeDepth);

  const byUrl = new Map<string, Record<string, unknown>>();
  for (const row of response.results || []) {
    const url = String(row?.url || '').trim();
    if (url) byUrl.set(url, row);
  }

  const failed = new Map<string, string>();
  for (const row of response.failedResults || []) {
    const url = String(row?.url || '').trim();
    if (url) failed.set(url, String(row?.error || 'extract_failed'));
  }

  const shortUrls = normalizedUrls.filter((url) => {
    if (failed.has(url)) return true;
    const text = extractScrapeResultText(byUrl.get(url) || {});
    return text.length < SHORT_CONTENT_RETRY_THRESHOLD;
  });

  if (activeDepth === 'basic' && shortUrls.length > 0) {
    const retryResponse = await extractWithClient(client, shortUrls, 'advanced');
    activeDepth = 'advanced';
    for (const row of retryResponse.results || []) {
      const url = String(row?.url || '').trim();
      if (url) {
        byUrl.set(url, row);
        failed.delete(url);
      }
    }
    for (const row of retryResponse.failedResults || []) {
      const url = String(row?.url || '').trim();
      if (url) failed.set(url, String(row?.error || 'extract_failed'));
    }
  }

  const extracted = new Map<
    string,
    { fullText: string; title?: string; extractDepth: ExtractDepth }
  >();

  for (const url of normalizedUrls) {
    if (failed.has(url) && !extractScrapeResultText(byUrl.get(url) || {})) {
      continue;
    }
    const raw = byUrl.get(url) || { url };
    const title = typeof raw.title === 'string' ? raw.title.trim() : undefined;
    const { fullText, storedTruncated, originalLength } = capScrapeStoredText(
      extractScrapeResultText(raw),
    );
    extracted.set(url, { fullText, title, extractDepth: activeDepth });
    if (fullText) {
      setScrapeCacheEntry(url, {
        fullText,
        title,
        extractDepth: activeDepth,
        fetchedAt: Date.now(),
        ...(storedTruncated ? { storedTruncated: true, originalLength } : {}),
      });
    }
  }

  return { byUrl: extracted, failed, activeDepth };
}

export const scrapeUrlInputSchema = z.object({
  urls: z.preprocess(
    (value) => normalizeScrapeUrlsInput(value),
    z.array(z.string().min(1)).min(1).max(5),
  ).describe('URL or list of URLs (max 5). Accepts JSON-stringified arrays too.'),
  extractDepth: z
    .enum(['basic', 'advanced'])
    .optional()
    .default('advanced')
    .describe('advanced (default) extracts more content including JS-heavy pages; basic is faster'),
  line_start: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Starting line number (1-indexed, inclusive). Required for large pages.'),
  line_end: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Ending line number (1-indexed, inclusive). Required for large pages.'),
});

export const scrape_url = createTool({
  id: 'scrape_url',
  description: [
    'Extract readable page content from one or more URLs (markdown).',
    'Works like read_file: pages over 500 lines require line_start and line_end to read a batch.',
    'Full text is cached for the session so later line ranges do not re-fetch Tavily.',
    'Use after web_search when you need the full article or docs page.',
  ].join(' '),
  inputSchema: scrapeUrlInputSchema,
  outputSchema: z.object({
    results: z.array(z.any()),
    failedResults: z.array(z.object({
      url: z.string(),
      error: z.string(),
    })).optional(),
  }),
  execute: async (inputData) => {
    const { urls, extractDepth, line_start: lineStart, line_end: lineEnd } = inputData;
    const normalizedUrls = normalizeScrapeUrlsInput(urls);
    const requestedDepth: ExtractDepth = extractDepth === 'basic' ? 'basic' : 'advanced';
    const maxLines = resolveScrapeMaxLines();
    const cache = getScrapeCache();

    const toFetch: string[] = [];
    const resultByUrl = new Map<string, Record<string, unknown>>();

    for (const url of normalizedUrls) {
      const cached = cache[url];
      if (shouldUseCacheEntry(cached, requestedDepth)) {
        resultByUrl.set(
          url,
          formatScrapeBatchResponse(url, cached!.fullText, {
            lineStart,
            lineEnd,
            maxLines,
            title: cached!.title,
            extractDepth: cached!.extractDepth,
            fromCache: true,
            storedTruncated: cached!.storedTruncated,
            originalLength: cached!.originalLength,
          }),
        );
      } else {
        toFetch.push(url);
      }
    }

    const failedResults: Array<{ url: string; error: string }> = [];

    if (toFetch.length > 0) {
      const { byUrl, failed } = await scrapeUrlsWithTavily(toFetch, { extractDepth: requestedDepth });

      for (const url of toFetch) {
        if (failed.has(url) && !byUrl.has(url)) {
          const err = failed.get(url) || 'extract_failed';
          resultByUrl.set(url, { ok: false, url, error: err });
          failedResults.push({ url, error: err });
          continue;
        }
        const row = byUrl.get(url);
        if (!row?.fullText?.trim()) {
          resultByUrl.set(url, { ok: false, url, error: 'no_content_extracted' });
          failedResults.push({ url, error: 'no_content_extracted' });
          continue;
        }
        const entry = getScrapeCache()[url];
        resultByUrl.set(
          url,
          formatScrapeBatchResponse(url, row.fullText, {
            lineStart,
            lineEnd,
            maxLines,
            title: row.title,
            extractDepth: row.extractDepth,
            storedTruncated: entry?.storedTruncated,
            originalLength: entry?.originalLength,
          }),
        );
      }
    }

    const results = normalizedUrls.map((url) => resultByUrl.get(url) || { ok: false, url, error: 'missing_result' });

    return {
      results,
      ...(failedResults.length > 0 ? { failedResults } : {}),
    };
  },
});

/** @deprecated Use line-based batching; kept for tests that referenced char caps */
export function resolveScrapeMaxContentChars(): number {
  return MAX_STORED_CHARS;
}

/** @deprecated Use formatScrapeBatchResponse / capScrapeStoredText */
export function trimScrapeContent(
  text: string,
  maxChars: number,
): { content: string; truncated: boolean; originalLength: number } {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return { content: '', truncated: false, originalLength: 0 };
  }
  if (normalized.length <= maxChars) {
    return { content: normalized, truncated: false, originalLength: normalized.length };
  }
  return {
    content: normalized.slice(0, maxChars),
    truncated: true,
    originalLength: normalized.length,
  };
}
