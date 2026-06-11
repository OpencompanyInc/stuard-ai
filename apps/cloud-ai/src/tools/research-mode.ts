/**
 * Research Mode tools — deep-research counterpart to Project Mode.
 *
 * Context-engineering design (modeled on how humans research):
 * - Raw web content NEVER flows through the conversation. research_search
 *   returns compact relevance chunks, research_read stores full text in the
 *   session, and the model distills everything into research_note entries.
 * - The distilled notes + source registry are re-injected into the system
 *   prompt each turn (see research-prompts.ts), so context grows linearly
 *   with insights instead of quadratically with tool output.
 * - research_compile hands back the raw stored excerpts ONLY at report time,
 *   so the final deliverable is written with full fidelity.
 *
 * State lives in a module-level map keyed by conversation_id (NOT bridge
 * state, which is a fresh Map per WS request — see the workflow ALS lesson).
 * It is cloud-side and in-memory only: no personal research content is ever
 * persisted to Supabase, and the mode works on desktop, website, and VM chat
 * alike because all of them run through this orchestrator.
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { PERPLEXITY_API_KEY, TAVILY_API_KEY } from '../utils/config';
import {
  scrapeUrlsWithTavily,
  formatScrapeBatchResponse,
  resolveScrapeMaxLines,
} from './tavily-tools';

// ─── Session model ───────────────────────────────────────────────────────────

export interface ResearchSource {
  id: string; // s1, s2…
  url: string;
  normalizedUrl: string;
  title?: string;
  publishedDate?: string;
  addedAt: number;
  via: 'search' | 'read';
  /** Queries that surfaced this source (for attribution + overlap detection). */
  queries: string[];
  /** Best relevance chunk seen in search results — compile fallback when unread. */
  bestSnippet?: string;
  /** Full extracted text, populated by research_read. */
  fullText?: string;
  noteCount: number;
}

export interface ResearchNote {
  id: string; // n1, n2…
  kind: 'finding' | 'gap' | 'question' | 'hypothesis' | 'answer';
  text: string;
  sourceIds: string[];
  topic?: string;
  resolved?: boolean;
  createdAt: number;
}

export interface ResearchSession {
  conversationId: string;
  brief: string;
  plan?: string;
  status: 'active' | 'compiling' | 'delivered';
  createdAt: number;
  updatedAt: number;
  queries: string[];
  sources: ResearchSource[];
  notes: ResearchNote[];
  sourceSeq: number;
  noteSeq: number;
  /** Final deliverable, set by research_report. Kept for re-opening in the viewer. */
  report?: { title: string; markdown: string; deliveredAt: number };
}

/** Read-only snapshot handed to the prompt builder each turn. */
export interface ResearchSessionView {
  conversationId: string;
  brief: string;
  plan?: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  queries: string[];
  sources: Array<{
    id: string;
    title?: string;
    url: string;
    read: boolean;
    noteCount: number;
  }>;
  notes: Array<{
    id: string;
    kind: string;
    text: string;
    sourceIds: string[];
    topic?: string;
    resolved?: boolean;
  }>;
  reportTitle?: string;
}

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_SESSIONS = 100;
const MAX_SOURCES_PER_SESSION = 150;
const MAX_NOTES_PER_SESSION = 400;
const MAX_SNIPPET_CHARS = 800;
const MAX_BEST_SNIPPET_CHARS = 2000;
const COMPILE_TOTAL_CHAR_CAP = 90_000;

const sessions = new Map<string, ResearchSession>();

function pruneSessions(): void {
  const now = Date.now();
  for (const [key, session] of sessions) {
    if (now - session.updatedAt > SESSION_TTL_MS) sessions.delete(key);
  }
  if (sessions.size > MAX_SESSIONS) {
    const oldest = [...sessions.values()].sort((a, b) => a.updatedAt - b.updatedAt);
    for (const session of oldest.slice(0, sessions.size - MAX_SESSIONS)) {
      sessions.delete(session.conversationId);
    }
  }
}

function getSession(conversationId: string | undefined | null): ResearchSession | null {
  const id = String(conversationId || '').trim();
  if (!id) return null;
  pruneSessions();
  return sessions.get(id) || null;
}

function touch(session: ResearchSession): void {
  session.updatedAt = Date.now();
}

/**
 * Fields the desktop UI reads off the tool RESULT (completed tool_event carries
 * `result` but not `args`, so the conversation id + live counts must live here
 * for the ActiveResearchBar to light up and stay current). Kept tiny.
 */
function clientMeta(session: ResearchSession): {
  conversation_id: string;
  total_sources: number;
  total_notes: number;
} {
  return {
    conversation_id: session.conversationId,
    total_sources: session.sources.length,
    total_notes: session.notes.length,
  };
}

/**
 * Client-only enrichment for the research_report tool result — mirrors
 * attachWorkflowForClient. The tool returns a COMPACT result to the model (no
 * markdown re-echo), and stream-runner re-attaches the full report markdown to
 * the copy sent to the desktop so the report viewer can open it. The model
 * history stays compact.
 */
export function attachResearchReportForClient(toolName: string, result: any): any {
  if (toolName !== 'research_report') return result;
  if (!result || typeof result !== 'object' || Array.isArray(result) || result.ok !== true) return result;
  const cid = String(result.conversation_id || '').trim();
  const session = cid ? sessions.get(cid) : null;
  if (!session?.report) return result;
  return {
    ...result,
    report: { title: session.report.title, markdown: session.report.markdown },
  };
}

export function getResearchSessionView(conversationId: string | undefined | null): ResearchSessionView | null {
  const session = getSession(conversationId);
  if (!session) return null;
  return {
    conversationId: session.conversationId,
    brief: session.brief,
    plan: session.plan,
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    queries: [...session.queries],
    sources: session.sources.map((s) => ({
      id: s.id,
      title: s.title,
      url: s.url,
      read: !!s.fullText,
      noteCount: s.noteCount,
    })),
    notes: session.notes.map((n) => ({
      id: n.id,
      kind: n.kind,
      text: n.text,
      sourceIds: [...n.sourceIds],
      topic: n.topic,
      resolved: n.resolved,
    })),
    reportTitle: session.report?.title,
  };
}

// ─── URL + source registry helpers ───────────────────────────────────────────

const TRACKING_PARAMS = /^(utm_|fbclid|gclid|mc_cid|mc_eid|ref_src)/i;

export function normalizeResearchUrl(raw: string): string {
  const trimmed = String(raw || '').trim();
  try {
    const url = new URL(trimmed);
    url.hash = '';
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    const params = [...url.searchParams.keys()];
    for (const key of params) {
      if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
    }
    let result = url.toString();
    if (result.endsWith('/')) result = result.slice(0, -1);
    return result;
  } catch {
    return trimmed;
  }
}

function findSource(session: ResearchSession, urlOrId: string): ResearchSource | undefined {
  const key = String(urlOrId || '').trim();
  if (!key) return undefined;
  const byId = session.sources.find((s) => s.id === key);
  if (byId) return byId;
  const normalized = normalizeResearchUrl(key);
  return session.sources.find((s) => s.normalizedUrl === normalized);
}

function registerSource(
  session: ResearchSession,
  input: {
    url: string;
    title?: string;
    snippet?: string;
    publishedDate?: string;
    via: 'search' | 'read';
    query?: string;
  },
): { source: ResearchSource; isNew: boolean } {
  const normalizedUrl = normalizeResearchUrl(input.url);
  const existing = session.sources.find((s) => s.normalizedUrl === normalizedUrl);
  if (existing) {
    if (input.query && !existing.queries.includes(input.query)) existing.queries.push(input.query);
    if (input.title && !existing.title) existing.title = input.title;
    if (input.publishedDate && !existing.publishedDate) existing.publishedDate = input.publishedDate;
    if (input.snippet && (input.snippet.length > (existing.bestSnippet?.length || 0))) {
      existing.bestSnippet = input.snippet.slice(0, MAX_BEST_SNIPPET_CHARS);
    }
    return { source: existing, isNew: false };
  }

  session.sourceSeq += 1;
  const source: ResearchSource = {
    id: `s${session.sourceSeq}`,
    url: input.url,
    normalizedUrl,
    title: input.title,
    publishedDate: input.publishedDate,
    addedAt: Date.now(),
    via: input.via,
    queries: input.query ? [input.query] : [],
    bestSnippet: input.snippet ? input.snippet.slice(0, MAX_BEST_SNIPPET_CHARS) : undefined,
    noteCount: 0,
  };
  session.sources.push(source);
  return { source, isNew: true };
}

// ─── Search providers (Perplexity + Tavily, merged) ──────────────────────────

interface ProviderResult {
  title?: string;
  url: string;
  snippet: string;
  publishedDate?: string;
}

interface SearchProviderOptions {
  maxResults: number;
  recency?: 'day' | 'week' | 'month' | 'year';
  includeDomains?: string[];
  topic?: 'general' | 'news' | 'finance';
}

async function perplexitySearch(query: string, opts: SearchProviderOptions): Promise<ProviderResult[]> {
  if (!PERPLEXITY_API_KEY) return [];
  const body: any = {
    query,
    max_results: opts.maxResults,
    max_tokens_per_page: 512,
  };
  if (opts.recency) body.search_recency_filter = opts.recency;
  if (opts.includeDomains?.length) body.search_domain_filter = opts.includeDomains.slice(0, 20);

  const response = await fetch('https://api.perplexity.ai/search', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`perplexity ${response.status}`);
  }
  const data: any = await response.json();
  const rows = Array.isArray(data?.results) ? data.results : [];
  return rows
    .map((row: any) => ({
      title: row?.title ? String(row.title).slice(0, 200) : undefined,
      url: String(row?.url || '').trim(),
      snippet: String(row?.snippet || row?.content || row?.text || '').trim(),
      publishedDate: row?.date || row?.published_date || undefined,
    }))
    .filter((row: ProviderResult) => row.url);
}

async function tavilySearch(query: string, opts: SearchProviderOptions): Promise<ProviderResult[]> {
  if (!TAVILY_API_KEY) return [];
  const mod: any = await import('@tavily/core');
  const client = mod.tavily({ apiKey: TAVILY_API_KEY });
  const response = await client.search(query, {
    searchDepth: 'advanced',
    maxResults: opts.maxResults,
    chunksPerSource: 2,
    ...(opts.topic ? { topic: opts.topic } : {}),
    ...(opts.recency ? { timeRange: opts.recency } : {}),
    ...(opts.includeDomains?.length ? { includeDomains: opts.includeDomains.slice(0, 20) } : {}),
  });
  const rows = Array.isArray(response?.results) ? response.results : [];
  return rows
    .map((row: any) => ({
      title: row?.title ? String(row.title).slice(0, 200) : undefined,
      url: String(row?.url || '').trim(),
      snippet: String(row?.content || '').trim(),
      publishedDate: row?.publishedDate || undefined,
    }))
    .filter((row: ProviderResult) => row.url);
}

/** Fan a query out to both providers; tolerate either failing. */
async function combinedSearch(
  query: string,
  opts: SearchProviderOptions,
): Promise<{ results: ProviderResult[]; providerErrors: string[] }> {
  const [perplexity, tavily] = await Promise.allSettled([
    perplexitySearch(query, opts),
    tavilySearch(query, opts),
  ]);

  const providerErrors: string[] = [];
  const merged = new Map<string, ProviderResult>();

  // Tavily first: its advanced-search content is relevance-chunked, so prefer
  // it when both providers return the same URL.
  if (tavily.status === 'fulfilled') {
    for (const row of tavily.value) {
      merged.set(normalizeResearchUrl(row.url), row);
    }
  } else {
    providerErrors.push(`tavily: ${tavily.reason?.message || tavily.reason}`);
  }

  if (perplexity.status === 'fulfilled') {
    for (const row of perplexity.value) {
      const key = normalizeResearchUrl(row.url);
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, row);
      } else if (row.snippet.length > existing.snippet.length) {
        merged.set(key, { ...existing, snippet: row.snippet, publishedDate: existing.publishedDate || row.publishedDate });
      }
    }
  } else {
    providerErrors.push(`perplexity: ${perplexity.reason?.message || perplexity.reason}`);
  }

  return { results: [...merged.values()], providerErrors };
}

// ─── Tools ───────────────────────────────────────────────────────────────────

const ERR_NO_SESSION =
  'No active research session for this conversation. Call enter_research_mode({ conversation_id, brief }) first.';

const CONVERSATION_ID_DESC =
  'The current conversation ID (provided in your system prompt under <conversation>).';

export const enter_research_mode = createTool({
  id: 'enter_research_mode',
  description: [
    'Enter Research Mode for the current conversation — a deep-research discipline with deduped multi-provider search, a source registry (s1, s2…), distilled notes as working memory, and a compile step for the final cited report.',
    'Call when the user wants deep/multi-source research, a report, or a thorough comparison — NOT for quick factual lookups (plain web_search covers those).',
    'Calling it again while active updates the brief/plan without losing gathered sources or notes.',
    'After entering: scope ambiguity with ask_user (one consolidated form), plan subtopics with agent_todo, then loop research_search → research_note.',
  ].join(' '),
  inputSchema: z.object({
    conversation_id: z.string().describe(CONVERSATION_ID_DESC),
    brief: z
      .string()
      .min(1)
      .describe('The research question + deliverable definition in one tight paragraph (what, for whom, depth, timeframe).'),
    plan: z
      .string()
      .optional()
      .describe('Optional subtopic outline (one per line). Can be set/refined later by calling enter_research_mode again.'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    created: z.boolean().optional(),
    brief: z.string().optional(),
    conversation_id: z.string().optional(),
    total_sources: z.number().optional(),
    total_notes: z.number().optional(),
    instructions: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData) => {
    const c = inputData as any;
    const conversationId = String(c.conversation_id || '').trim();
    if (!conversationId) return { ok: false, error: 'missing conversation_id' };

    pruneSessions();
    const existing = sessions.get(conversationId);
    if (existing) {
      existing.brief = String(c.brief || existing.brief);
      if (c.plan !== undefined) existing.plan = String(c.plan || '') || undefined;
      existing.status = 'active';
      touch(existing);
      return {
        ok: true,
        created: false,
        brief: existing.brief,
        ...clientMeta(existing),
        instructions: 'Research session updated — existing sources and notes are preserved. Continue the gather loop.',
      };
    }

    const now = Date.now();
    const session: ResearchSession = {
      conversationId,
      brief: String(c.brief || '').trim(),
      plan: c.plan ? String(c.plan) : undefined,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      queries: [],
      sources: [],
      notes: [],
      sourceSeq: 0,
      noteSeq: 0,
    };
    sessions.set(conversationId, session);

    return {
      ok: true,
      created: true,
      brief: session.brief,
      ...clientMeta(session),
      instructions: [
        'Research Mode is active for this conversation (the full research system prompt takes over from the next turn; the research tools work right now).',
        'Discipline: (1) If the brief is ambiguous on depth/audience/format/timeframe, ask_user ONE consolidated scoping form before searching. (2) Plan 3–7 subtopics — agent_todo bulk_create (sessionId "current") so the user watches progress live. (3) Gather loop: research_search with 1–3 angled queries → research_note the distilled takeaways IMMEDIATELY → research_read only sources that deserve a full read. Breadth across subtopics before depth. (4) When coverage is solid, research_compile and write the final report with [s1]-style citations.',
        'Speed: with 3+ independent subtopics, fan the gather loop out — ONE delegate call with parallel "custom" tasks (one per subtopic, 3–5 max), each with tools ["research_search","research_read","research_note","research_status"] and an instruction carrying this conversation_id verbatim + the subtopic + a budget. They write into this same session; compile/report stay with you.',
        'If research_read fails on a source (paywall/JS/bot-wall) and the user\'s browser is connected, delegate the browser subagent with the URL as the backup reader, then research_note the takeaways.',
        'Never paste raw search/page content into your replies — distill into notes; the notes are your working memory.',
      ].join('\n'),
    };
  },
});

export const exit_research_mode = createTool({
  id: 'exit_research_mode',
  description:
    'Exit Research Mode for the current conversation. Discards the research session (sources, notes, stored page text). Call only after the final report is delivered or on a clear, lasting pivot away from the research task.',
  inputSchema: z.object({
    conversation_id: z.string().describe(CONVERSATION_ID_DESC),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    conversation_id: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData) => {
    const c = inputData as any;
    const conversationId = String(c.conversation_id || '').trim();
    if (!conversationId) return { ok: false, error: 'missing conversation_id' };
    sessions.delete(conversationId);
    return { ok: true, conversation_id: conversationId };
  },
});

export const research_search = createTool({
  id: 'research_search',
  description: [
    'Research Mode search — fans each query out to Perplexity AND Tavily advanced search in parallel, merges results, and dedups against this session\'s source registry.',
    'New sources are registered with ids (s1, s2…) and returned with relevance chunks; already-seen URLs come back as seen_source_ids with no content (fresh info only — pivot the query instead of re-reading them).',
    'Pass 1–3 differently-angled queries per call. Natural language only — no site:/OR operators (use include_domains).',
  ].join(' '),
  inputSchema: z.object({
    conversation_id: z.string().describe(CONVERSATION_ID_DESC),
    queries: z
      .array(z.string().min(1))
      .min(1)
      .max(3)
      .describe('1–3 natural-language queries, each attacking a different angle of the current subtopic.'),
    max_results: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe('Results per provider per query (default 6).'),
    recency: z
      .enum(['day', 'week', 'month', 'year'])
      .optional()
      .describe('Restrict to recently published content.'),
    include_domains: z
      .array(z.string())
      .max(20)
      .optional()
      .describe('Bare hostnames to restrict results to (e.g. ["arxiv.org"]). No paths.'),
    topic: z
      .enum(['general', 'news', 'finance'])
      .optional()
      .describe('Tavily topic hint. Default general.'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    conversation_id: z.string().optional(),
    total_sources: z.number().optional(),
    total_notes: z.number().optional(),
    searches: z.array(z.any()).optional(),
    stats: z.any().optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData) => {
    const c = inputData as any;
    const session = getSession(c.conversation_id);
    if (!session) return { ok: false, error: ERR_NO_SESSION };

    const queries: string[] = (Array.isArray(c.queries) ? c.queries : [])
      .map((q: any) => String(q || '').trim())
      .filter(Boolean)
      .slice(0, 3);
    if (queries.length === 0) return { ok: false, error: 'missing queries' };
    if (!PERPLEXITY_API_KEY && !TAVILY_API_KEY) {
      return { ok: false, error: 'no search provider configured (PERPLEXITY_API_KEY / TAVILY_API_KEY)' };
    }

    const opts: SearchProviderOptions = {
      maxResults: Math.min(Math.max(Number(c.max_results) || 6, 1), 10),
      recency: c.recency,
      includeDomains: Array.isArray(c.include_domains) ? c.include_domains : undefined,
      topic: c.topic,
    };

    const repeated = queries.filter((q) => session.queries.includes(q));
    const outcomes = await Promise.all(queries.map((query) => combinedSearch(query, opts)));

    let newCount = 0;
    let seenCount = 0;
    const registryFull = () => session.sources.length >= MAX_SOURCES_PER_SESSION;
    const searches = queries.map((query, index) => {
      const { results, providerErrors } = outcomes[index];
      if (!session.queries.includes(query)) session.queries.push(query);

      const newSources: any[] = [];
      const seenSourceIds: string[] = [];
      for (const row of results) {
        const known = session.sources.find((s) => s.normalizedUrl === normalizeResearchUrl(row.url));
        if (known) {
          if (!known.queries.includes(query)) known.queries.push(query);
          if (!seenSourceIds.includes(known.id)) seenSourceIds.push(known.id);
          seenCount += 1;
          continue;
        }
        if (registryFull()) continue;
        const { source } = registerSource(session, {
          url: row.url,
          title: row.title,
          snippet: row.snippet,
          publishedDate: row.publishedDate,
          via: 'search',
          query,
        });
        newCount += 1;
        newSources.push({
          source_id: source.id,
          title: source.title,
          url: source.url,
          ...(source.publishedDate ? { published: source.publishedDate } : {}),
          content: row.snippet.slice(0, MAX_SNIPPET_CHARS),
        });
      }

      return {
        query,
        new_sources: newSources,
        ...(seenSourceIds.length > 0 ? { seen_source_ids: seenSourceIds } : {}),
        ...(providerErrors.length > 0 ? { provider_errors: providerErrors } : {}),
      };
    });

    touch(session);

    const allFailed = outcomes.every((o) => o.results.length === 0 && o.providerErrors.length > 0);
    if (allFailed) {
      return { ok: false, error: `all search providers failed: ${outcomes[0].providerErrors.join('; ')}` };
    }

    return {
      ok: true,
      ...clientMeta(session),
      searches,
      stats: {
        new_sources: newCount,
        already_seen: seenCount,
        total_sources: session.sources.length,
        ...(repeated.length > 0 ? { repeated_queries: repeated } : {}),
        ...(registryFull() ? { warning: 'source registry full — stop broadening, start compiling' } : {}),
        reminder: 'Distill the takeaways into research_note NOW, before the next search.',
      },
    };
  },
});

export const research_read = createTool({
  id: 'research_read',
  description: [
    'Research Mode deep read — extracts the full page for a registered source (or new URL), stores the text in the session for compile-time citation, and returns it in line batches.',
    'Use ONLY when search chunks are insufficient (primary sources, data tables, methodology). Pages over the line limit require line_start/line_end; the stored text never re-fetches.',
    'If extraction fails (paywall, JS-heavy, login), delegate to the browser subagent instead, then research_note the takeaways.',
  ].join(' '),
  inputSchema: z.object({
    conversation_id: z.string().describe(CONVERSATION_ID_DESC),
    source: z
      .string()
      .min(1)
      .describe('A source id from the registry (e.g. "s3") or a URL (registered automatically).'),
    line_start: z.number().int().positive().optional().describe('Starting line (1-indexed). Required for large pages.'),
    line_end: z.number().int().positive().optional().describe('Ending line (1-indexed, inclusive).'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    conversation_id: z.string().optional(),
    total_sources: z.number().optional(),
    total_notes: z.number().optional(),
    source_id: z.string().optional(),
    url: z.string().optional(),
    title: z.string().optional(),
    content: z.string().optional(),
    line_start: z.number().optional(),
    line_end: z.number().optional(),
    total_lines: z.number().optional(),
    message: z.string().optional(),
    preview_start: z.string().optional(),
    preview_end: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData) => {
    const c = inputData as any;
    const session = getSession(c.conversation_id);
    if (!session) return { ok: false, error: ERR_NO_SESSION };

    const ref = String(c.source || '').trim();
    if (!ref) return { ok: false, error: 'missing source' };

    let source = findSource(session, ref);
    if (!source) {
      if (!/^https?:\/\//i.test(ref)) {
        return { ok: false, error: `unknown source id "${ref}" — pass a registered id or a full URL` };
      }
      source = registerSource(session, { url: ref, via: 'read' }).source;
    }

    if (!source.fullText) {
      try {
        const { byUrl, failed } = await scrapeUrlsWithTavily([source.url], { extractDepth: 'advanced' });
        const row = byUrl.get(source.url);
        if (!row?.fullText?.trim()) {
          const reason = failed.get(source.url) || 'no_content_extracted';
          return {
            ok: false,
            source_id: source.id,
            url: source.url,
            error: `extract_failed: ${reason}. Try the browser subagent for gated/JS-heavy pages.`,
          };
        }
        source.fullText = row.fullText;
        if (row.title && !source.title) source.title = row.title;
      } catch (error: any) {
        return { ok: false, source_id: source.id, url: source.url, error: String(error?.message || error) };
      }
    }

    touch(session);

    const formatted = formatScrapeBatchResponse(source.url, source.fullText, {
      lineStart: c.line_start,
      lineEnd: c.line_end,
      maxLines: resolveScrapeMaxLines(),
      title: source.title,
    });

    return {
      ...(formatted as any),
      ...clientMeta(session),
      source_id: source.id,
      message: (formatted as any).message
        || 'Full text is stored in the session — research_note the takeaways now; research_compile can quote it later.',
    };
  },
});

export const research_note = createTool({
  id: 'research_note',
  description: [
    'Research Mode distillation — your working memory. Call IMMEDIATELY after every research_search/research_read with the takeaways; notes (not raw content) are re-injected into your context each turn.',
    'Each note: one self-contained insight in 1–3 sentences with concrete specifics (numbers, dates, names) and the source ids that support it.',
    'Kinds: finding (default), gap (missing coverage), question (open thread), hypothesis (testable claim), answer (resolves a question — pass resolves: ["n3"]).',
  ].join(' '),
  inputSchema: z.object({
    conversation_id: z.string().describe(CONVERSATION_ID_DESC),
    notes: z
      .array(
        z.object({
          text: z.string().min(1).max(1200).describe('The distilled insight, self-contained, with specifics.'),
          kind: z.enum(['finding', 'gap', 'question', 'hypothesis', 'answer']).optional().describe('Default finding.'),
          source_ids: z.array(z.string()).max(10).optional().describe('Registry ids supporting this note, e.g. ["s2","s5"].'),
          topic: z.string().max(80).optional().describe('Subtopic label from your plan, for coverage tracking.'),
          resolves: z.array(z.string()).max(10).optional().describe('Note ids this resolves (marks those questions/gaps closed).'),
        }),
      )
      .min(1)
      .max(12)
      .describe('Batch of distilled notes.'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    conversation_id: z.string().optional(),
    total_sources: z.number().optional(),
    added: z.array(z.string()).optional(),
    total_notes: z.number().optional(),
    open_questions: z.number().optional(),
    warnings: z.array(z.string()).optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData) => {
    const c = inputData as any;
    const session = getSession(c.conversation_id);
    if (!session) return { ok: false, error: ERR_NO_SESSION };

    const items = Array.isArray(c.notes) ? c.notes : [];
    if (items.length === 0) return { ok: false, error: 'missing notes' };
    if (session.notes.length + items.length > MAX_NOTES_PER_SESSION) {
      return { ok: false, error: 'note limit reached — compile the report instead of gathering more' };
    }

    const warnings: string[] = [];
    const added: string[] = [];

    for (const item of items.slice(0, 12)) {
      const sourceIds: string[] = [];
      for (const rawId of (Array.isArray(item.source_ids) ? item.source_ids : [])) {
        const source = findSource(session, String(rawId));
        if (source) {
          if (!sourceIds.includes(source.id)) sourceIds.push(source.id);
        } else {
          warnings.push(`unknown source id "${rawId}" dropped`);
        }
      }

      session.noteSeq += 1;
      const note: ResearchNote = {
        id: `n${session.noteSeq}`,
        kind: item.kind || 'finding',
        text: String(item.text || '').trim(),
        sourceIds,
        topic: item.topic ? String(item.topic).trim() : undefined,
        createdAt: Date.now(),
      };
      session.notes.push(note);
      added.push(note.id);

      for (const id of sourceIds) {
        const source = session.sources.find((s) => s.id === id);
        if (source) source.noteCount += 1;
      }

      for (const resolveId of (Array.isArray(item.resolves) ? item.resolves : [])) {
        const target = session.notes.find((n) => n.id === String(resolveId).trim());
        if (target && (target.kind === 'question' || target.kind === 'gap' || target.kind === 'hypothesis')) {
          target.resolved = true;
        } else if (!target) {
          warnings.push(`unknown note id "${resolveId}" in resolves`);
        }
      }
    }

    touch(session);

    const openQuestions = session.notes.filter(
      (n) => (n.kind === 'question' || n.kind === 'gap') && !n.resolved,
    ).length;

    return {
      ok: true,
      ...clientMeta(session),
      added,
      open_questions: openQuestions,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  },
});

export const research_status = createTool({
  id: 'research_status',
  description:
    'Research Mode dashboard — the brief, plan, every note, the source registry, queries run, and open questions. Use to re-ground yourself mid-research instead of scrolling chat history, and to judge whether coverage is complete enough to compile.',
  inputSchema: z.object({
    conversation_id: z.string().describe(CONVERSATION_ID_DESC),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    brief: z.string().optional(),
    plan: z.string().optional(),
    status: z.string().optional(),
    queries: z.array(z.string()).optional(),
    sources: z.array(z.any()).optional(),
    notes: z.array(z.any()).optional(),
    open_questions: z.array(z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData) => {
    const c = inputData as any;
    const session = getSession(c.conversation_id);
    if (!session) return { ok: false, error: ERR_NO_SESSION };

    return {
      ok: true,
      brief: session.brief,
      ...(session.plan ? { plan: session.plan } : {}),
      status: session.status,
      queries: [...session.queries],
      sources: session.sources.map((s) => ({
        id: s.id,
        title: s.title || null,
        url: s.url,
        read: !!s.fullText,
        notes: s.noteCount,
      })),
      notes: session.notes.slice(-200).map((n) => ({
        id: n.id,
        kind: n.kind,
        ...(n.topic ? { topic: n.topic } : {}),
        text: n.text,
        ...(n.sourceIds.length > 0 ? { sources: n.sourceIds } : {}),
        ...(n.resolved ? { resolved: true } : {}),
      })),
      open_questions: session.notes
        .filter((n) => (n.kind === 'question' || n.kind === 'gap') && !n.resolved)
        .map((n) => ({ id: n.id, kind: n.kind, text: n.text })),
    };
  },
});

export const research_compile = createTool({
  id: 'research_compile',
  description: [
    'Research Mode compile — the final-report step. Returns ALL notes plus the stored raw text excerpts for cited sources, so the report is written with full fidelity (exact numbers, quotes, dates) instead of from distilled memory.',
    'Call once, when every subtopic has findings and no critical question is open. Then write the report: executive summary → sections mirroring the plan → inline [s1] citations → Sources section (id — title — url).',
  ].join(' '),
  inputSchema: z.object({
    conversation_id: z.string().describe(CONVERSATION_ID_DESC),
    source_ids: z
      .array(z.string())
      .max(60)
      .optional()
      .describe('Sources to include raw excerpts for. Default: every source referenced by at least one note.'),
    per_source_chars: z
      .number()
      .int()
      .min(500)
      .max(20000)
      .optional()
      .describe('Excerpt cap per source (default 6000).'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    brief: z.string().optional(),
    plan: z.string().optional(),
    notes: z.array(z.any()).optional(),
    sources: z.array(z.any()).optional(),
    omitted_source_ids: z.array(z.string()).optional(),
    open_questions: z.array(z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData) => {
    const c = inputData as any;
    const session = getSession(c.conversation_id);
    if (!session) return { ok: false, error: ERR_NO_SESSION };

    const perSourceCap = Math.min(Math.max(Number(c.per_source_chars) || 6000, 500), 20000);

    let targets: ResearchSource[];
    if (Array.isArray(c.source_ids) && c.source_ids.length > 0) {
      targets = c.source_ids
        .map((id: any) => findSource(session, String(id)))
        .filter(Boolean) as ResearchSource[];
    } else {
      targets = session.sources.filter((s) => s.noteCount > 0 || !!s.fullText);
      if (targets.length === 0) targets = [...session.sources];
    }

    let budget = COMPILE_TOTAL_CHAR_CAP;
    const omitted: string[] = [];
    const compiledSources = targets.map((source) => {
      const raw = (source.fullText || source.bestSnippet || '').trim();
      const excerptCap = Math.min(perSourceCap, Math.max(budget, 0));
      const excerpt = raw.slice(0, excerptCap);
      budget -= excerpt.length;
      if (raw && !excerpt) omitted.push(source.id);
      return {
        id: source.id,
        title: source.title || null,
        url: source.url,
        ...(source.publishedDate ? { published: source.publishedDate } : {}),
        read: !!source.fullText,
        ...(excerpt
          ? { excerpt, ...(excerpt.length < raw.length ? { truncated: true } : {}) }
          : { excerpt: '', note: 'no stored content — cite only what your notes captured' }),
      };
    });

    session.status = 'compiling';
    touch(session);

    return {
      ok: true,
      brief: session.brief,
      ...(session.plan ? { plan: session.plan } : {}),
      notes: session.notes.map((n) => ({
        id: n.id,
        kind: n.kind,
        ...(n.topic ? { topic: n.topic } : {}),
        text: n.text,
        ...(n.sourceIds.length > 0 ? { sources: n.sourceIds } : {}),
        ...(n.resolved ? { resolved: true } : {}),
      })),
      sources: compiledSources,
      ...(omitted.length > 0 ? { omitted_source_ids: omitted } : {}),
      open_questions: session.notes
        .filter((n) => (n.kind === 'question' || n.kind === 'gap') && !n.resolved)
        .map((n) => ({ id: n.id, text: n.text })),
    };
  },
});

export const research_report = createTool({
  id: 'research_report',
  description: [
    'Deliver the final research report as a markdown document — it opens in the user\'s report viewer (desktop) and stays re-openable for the session.',
    'Call AFTER research_compile, passing the COMPLETE report markdown: # title, executive summary, sections mirroring the plan, inline [s1] citations, and a closing "## Sources" section (one line per cited id: title — url).',
    'After this succeeds, give only a brief 3–6 line chat summary of the top findings — do NOT repeat the full report in chat.',
  ].join(' '),
  inputSchema: z.object({
    conversation_id: z.string().describe(CONVERSATION_ID_DESC),
    title: z.string().min(1).max(160).describe('Report title (used as the document name).'),
    markdown: z
      .string()
      .min(200)
      .describe('The complete report in markdown. Standard GFM; ==highlight== supported; math via $…$/$$…$$.'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    conversation_id: z.string().optional(),
    total_sources: z.number().optional(),
    total_notes: z.number().optional(),
    report: z
      .object({ title: z.string(), markdown: z.string() })
      .optional(),
    message: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData) => {
    const c = inputData as any;
    const session = getSession(c.conversation_id);
    if (!session) return { ok: false, error: ERR_NO_SESSION };

    const title = String(c.title || '').trim();
    const markdown = String(c.markdown || '').trim();
    if (!title || !markdown) return { ok: false, error: 'missing title or markdown' };

    session.report = { title, markdown, deliveredAt: Date.now() };
    session.status = 'delivered';
    touch(session);

    // The report markdown rides on the RESULT directly so the desktop viewer
    // gets it through the proven tool-result channel — independent of any
    // runner-side attach wiring. It doesn't bloat the model context: the
    // history builder caps non-rich tool results (~1800 chars), so the model
    // history keeps only a stub while the live client copy carries the full
    // document. (attachResearchReportForClient stays as a defensive fallback.)
    return {
      ok: true,
      ...clientMeta(session),
      report: { title, markdown },
      message:
        'Report delivered — it opened in the user\'s viewer. Now give a brief 3–6 line chat summary of the top findings (with [sN] citations); do not repeat the full report. End your summary with `<<report>>` on its own line so the user gets an "Open full report" button.',
    };
  },
});

export const RESEARCH_MODE_TOOLS = {
  enter_research_mode,
  exit_research_mode,
  research_search,
  research_read,
  research_note,
  research_status,
  research_compile,
  research_report,
} as const;
