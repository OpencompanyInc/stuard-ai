/**
 * Workflow Documentation Search System
 *
 * The doc corpus itself lives in ./docs-data.ts (pure data, no imports) so
 * the workflow agent's system prompt can inline ALL of it statically — the
 * workflow agent no longer carries a search_workflow_docs tool.
 *
 * This module keeps the search machinery (lexical + Supabase semantic) and
 * the search_workflow_docs tool for the agents that still discover docs on
 * demand (orchestrator / stuard tool registry), plus the embeddings sync.
 *
 * If docs-data.ts content changes, re-run sync-workflow-docs-embeddings.ts
 * so semantic search stays aligned.
 */

import { createTool } from '@mastra/core/tools';
import { embedMany } from 'ai';
import { z } from 'zod';
import { getSupabaseService } from '../../supabase';
import { resolveEmbedder } from '../../utils/embeddings';
import { DOC_CHUNKS, getDocSection, listDocSections, type DocChunk } from './docs-data';

export { DOC_CHUNKS, getDocSection, listDocSections, type DocChunk } from './docs-data';

// ═══════════════════════════════════════════════════════════════════════════════
// SEARCH ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Score a doc chunk against a query using keyword overlap.
 * Returns 0–1 relevance score.
 */
function scoreChunk(chunk: DocChunk, queryTokens: string[]): number {
  let score = 0;
  const lowerContent = chunk.content.toLowerCase();

  for (const token of queryTokens) {
    // Keyword match (high weight)
    if (chunk.keywords.some(kw => kw.includes(token) || token.includes(kw))) {
      score += 3;
    }
    // Title match (medium weight)
    if (chunk.title.toLowerCase().includes(token)) {
      score += 2;
    }
    // ID match (treat like title)
    if (chunk.id.toLowerCase().includes(token)) {
      score += 2;
    }
    // Content match (low weight — just confirms relevance)
    if (lowerContent.includes(token)) {
      score += 0.5;
    }
  }

  // Normalize by query length so longer queries don't unfairly inflate scores
  return queryTokens.length > 0 ? score / queryTokens.length : 0;
}

/**
 * Lexical fallback: keyword-overlap search over DOC_CHUNKS.
 * Used when Supabase / embedder is unavailable.
 */
export function searchDocsLexical(query: string, topK: number = 3): DocChunk[] {
  const queryTokens = query
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);

  if (queryTokens.length === 0) {
    return DOC_CHUNKS.filter(c => c.id === 'architecture');
  }

  const scored = DOC_CHUNKS
    .map(chunk => ({ chunk, score: scoreChunk(chunk, queryTokens) }))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, topK).map(s => s.chunk);
}

/**
 * Semantic search via Supabase pgvector.
 * Embeds the query, calls the search_workflow_docs RPC, and resolves
 * IDs back to local DOC_CHUNKS so callers always get full content
 * (even if the row in Supabase is stale).
 *
 * Returns null if the backend isn't configured / fails — caller should
 * fall back to searchDocsLexical().
 */
export async function searchDocsSemantic(
  query: string,
  topK: number = 3,
): Promise<DocChunk[] | null> {
  const supabase = getSupabaseService();
  if (!supabase) return null;

  try {
    const { embedder } = await resolveEmbedder();
    const { embeddings } = await embedMany({
      model: embedder as any,
      values: [query],
    });
    const queryEmbedding = embeddings[0];
    if (!queryEmbedding) return null;

    const { data, error } = await supabase.rpc('search_workflow_docs', {
      query_embedding: queryEmbedding,
      match_threshold: 0.25,
      match_count: topK,
    });
    if (error || !data) return null;

    const byId = new Map(DOC_CHUNKS.map(c => [c.id, c]));
    const hits: DocChunk[] = [];
    for (const row of data as Array<{ id: string }>) {
      const chunk = byId.get(row.id);
      if (chunk) hits.push(chunk);
    }
    return hits;
  } catch (e) {
    console.warn('[search_workflow_docs] semantic search failed', e);
    return null;
  }
}

/**
 * Search documentation chunks by query.
 * Tries semantic search via Supabase first, falls back to lexical scoring.
 */
export async function searchDocs(query: string, topK: number = 3): Promise<DocChunk[]> {
  const semantic = await searchDocsSemantic(query, topK);
  if (semantic && semantic.length > 0) return semantic;
  return searchDocsLexical(query, topK);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SEARCH TOOL DEFINITION
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// Per-session dedup: don't return the same doc section twice across multiple
// search_workflow_docs calls in one session. We remember which section ids were
// already returned in FULL and omit their content from later searches (the model
// can still re-request a section by its exact id, which bypasses dedup).
//
// Seen-set resolution, in priority order:
//  1) An explicitly injected Set — callers can pass a fresh one per agent
//     build, giving reliable per-conversation-turn dedup.
//  2) A run-scoped object on the tool-execution context (WeakMap, auto-GC) —
//     best-effort for the orchestrator / registry singleton paths.
//  3) Neither available → no dedup (preserves prior behavior).
// ─────────────────────────────────────────────────────────────────────────────
const seenSectionsByRunObject = new WeakMap<object, Set<string>>();

function resolveSeenSet(injected: Set<string> | undefined, ctx: any): Set<string> | null {
  if (injected) return injected;
  const runObj =
    ctx && typeof ctx === 'object'
      ? ctx.requestContext ?? ctx.runtimeContext ?? ctx.abortSignal ?? ctx.agent
      : null;
  if (runObj && typeof runObj === 'object') {
    let set = seenSectionsByRunObject.get(runObj);
    if (!set) {
      set = new Set<string>();
      seenSectionsByRunObject.set(runObj, set);
    }
    return set;
  }
  return null;
}

export interface SearchWorkflowDocsOptions {
  /**
   * Dedup set shared across all search_workflow_docs calls that use this tool
   * instance. Pass a fresh Set per agent build to scope dedup to one session.
   */
  seen?: Set<string>;
}

/**
 * Build a search_workflow_docs tool. Each instance can carry its own dedup
 * `seen` set so the same section isn't returned in full more than once per
 * session. See `searchWorkflowDocs` for the shared (ctx-scoped) default.
 */
export function createSearchWorkflowDocsTool(opts: SearchWorkflowDocsOptions = {}) {
  return createTool({
    id: 'search_workflow_docs',
    description:
      'Search workflow documentation by topic. Returns relevant doc sections covering architecture, execution model, connecting nodes, triggers (manual/hotkey/cron/webhook including local request-response /webhooks/call with return_value), nodes, wires (basic/branching/convergence/callNode), guards (jsonlogic + ai routing), loops (forEach/repeat/while + patterns), variables (workflow + runtime), templates, workspace, utility tools, scripts (python/node), ai_inference, agent_nodes, streams, function triggers, custom_ui (basics, hooks, data passing, markdown, live updates, stuard API, node routing, multi-page, window config, visual effects, pitfalls), modify_workflow ops & pitfalls, output_schema, debugging, common pitfalls, and performance tips. Use "list" to see all sections, or a section id for a specific one. Sections already returned earlier in the session are omitted (listed under "omitted") to save tokens — re-request by exact id only if you need the full text again.',
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          'Search query describing what you need to know (e.g., "how do guards work", "live update custom ui", "markdown rendering", "connecting nodes", "forEach loop"), or "list" to see all sections, or a section ID to get that specific section.',
        ),
      topK: z
        .number()
        .int()
        .min(1)
        .max(3)
        .default(3)
        .describe('Maximum number of doc sections to return (capped at 3).'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      sections: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          content: z.string(),
        }),
      ),
      // Further matches beyond the content budget — fetch full content on demand
      // by calling search_workflow_docs again with the section id.
      more: z
        .array(z.object({ id: z.string(), title: z.string() }))
        .optional(),
      // Matches already returned in full earlier this session — content omitted
      // here on purpose. Re-request by exact id only if the full text is needed.
      omitted: z
        .array(z.object({ id: z.string(), title: z.string() }))
        .optional(),
      // Human-readable explanation when matches were omitted for dedup.
      note: z.string().optional(),
      availableSections: z
        .array(z.object({ id: z.string(), title: z.string() }))
        .optional(),
    }),
    execute: async (inputData, ctx) => {
      const { query, topK } = inputData as { query: string; topK: number };
      const seen = resolveSeenSet(opts.seen, ctx);

      // List mode
      if (query.trim().toLowerCase() === 'list') {
        return {
          ok: true,
          sections: [],
          availableSections: listDocSections(),
        };
      }

      // Direct ID lookup — always returns full content (an explicit re-request
      // bypasses dedup), and records the id so later searches don't repeat it.
      const directMatch = getDocSection(query.trim());
      if (directMatch) {
        seen?.add(directMatch.id);
        return {
          ok: true,
          sections: [
            {
              id: directMatch.id,
              title: directMatch.title,
              content: directMatch.content,
            },
          ],
        };
      }

      // Search mode (semantic via Supabase, lexical fallback)
      const results = await searchDocs(query, topK);
      if (results.length === 0) {
        return {
          ok: true,
          sections: [],
          availableSections: listDocSections(),
        };
      }

      // Drop matches already returned in full this session — surface them as
      // lightweight `omitted` pointers instead of resending their content.
      const omitted: Array<{ id: string; title: string }> = [];
      const fresh = results.filter(r => {
        if (seen && seen.has(r.id)) {
          omitted.push({ id: r.id, title: r.title });
          return false;
        }
        return true;
      });

      // Content budget: always return the top FRESH hit in full, then include
      // further fresh hits only while under budget. Remaining matches come back
      // as lightweight `more` pointers the model can fetch by id. This caps the
      // worst case (large custom_ui sections) without changing typical small
      // multi-section results, which still fit under the budget.
      const DOC_CONTENT_BUDGET = 7000; // chars (~1.75k tokens)
      const sections: Array<{ id: string; title: string; content: string }> = [];
      const more: Array<{ id: string; title: string }> = [];
      let used = 0;
      for (let i = 0; i < fresh.length; i++) {
        const r = fresh[i];
        if (i === 0 || used + r.content.length <= DOC_CONTENT_BUDGET) {
          sections.push({ id: r.id, title: r.title, content: r.content });
          used += r.content.length;
          seen?.add(r.id);
        } else {
          more.push({ id: r.id, title: r.title });
        }
      }

      let note: string | undefined;
      if (omitted.length > 0) {
        note =
          sections.length === 0
            ? `All ${omitted.length} match(es) for this query were already returned earlier in this session — their content is in your earlier tool results. Re-request a section by its exact id only if you truly need the full text again.`
            : `${omitted.length} further match(es) were already returned earlier this session and are omitted here (see "omitted").`;
      }

      return {
        ok: true,
        sections,
        ...(more.length > 0 ? { more } : {}),
        ...(omitted.length > 0 ? { omitted } : {}),
        ...(note ? { note } : {}),
      };
    },
  });
}

export const searchWorkflowDocs = createSearchWorkflowDocsTool();

// ═══════════════════════════════════════════════════════════════════════════════
// EMBEDDINGS SYNC
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build the text we embed per chunk. Including title + keywords gives the
 * embedding model strong topical anchors so short queries (e.g. "guards",
 * "live update custom ui") still match the right section.
 */
function chunkEmbeddingText(chunk: DocChunk): string {
  const kw = chunk.keywords.length ? `\nKeywords: ${chunk.keywords.join(', ')}` : '';
  return `${chunk.title}${kw}\n\n${chunk.content}`;
}

/**
 * Mirrors ensureToolEmbeddings(): upserts any DOC_CHUNKS whose content
 * has changed (or is missing) into public.workflow_docs with a fresh
 * embedding. Safe to call repeatedly — incremental by content equality.
 */
export async function ensureWorkflowDocsEmbeddings(opts?: { force?: boolean }): Promise<{
  synced: number;
  skipped: number;
  errors: Array<{ id: string; error: string }>;
}> {
  const force = opts?.force === true;
  const result = { synced: 0, skipped: 0, errors: [] as Array<{ id: string; error: string }> };

  const supabase = getSupabaseService();
  if (!supabase) return result;

  let toUpdate: DocChunk[];
  if (force) {
    toUpdate = DOC_CHUNKS.slice();
  } else {
    const { data: existing, error } = await supabase
      .from('workflow_docs')
      .select('id, title, content');
    if (error) {
      // Table might not exist yet — fail gracefully like ensureToolEmbeddings.
      return result;
    }
    const existingMap = new Map(
      (existing as Array<{ id: string; title: string; content: string }>).map(r => [
        r.id,
        { title: r.title, content: r.content },
      ]),
    );
    toUpdate = DOC_CHUNKS.filter(c => {
      const prev = existingMap.get(c.id);
      return !prev || prev.title !== c.title || prev.content !== c.content;
    });
    result.skipped = DOC_CHUNKS.length - toUpdate.length;
  }

  if (toUpdate.length === 0) return result;

  try {
    const { embedder } = await resolveEmbedder();
    const texts = toUpdate.map(chunkEmbeddingText);
    const { embeddings } = await embedMany({ model: embedder as any, values: texts });

    const rows = toUpdate.map((c, i) => ({
      id: c.id,
      title: c.title,
      content: c.content,
      keywords: c.keywords,
      embedding: embeddings[i],
      updated_at: new Date().toISOString(),
    }));

    const { error: upsertError } = await supabase
      .from('workflow_docs')
      .upsert(rows, { onConflict: 'id' });
    if (upsertError) {
      result.errors.push({ id: '*', error: upsertError.message });
    } else {
      result.synced = rows.length;
    }
  } catch (e: any) {
    result.errors.push({ id: '*', error: e?.message || String(e) });
  }

  return result;
}
