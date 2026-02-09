/**
 * Tool-Likelihood Ranking
 *
 * Given a pre-computed query embedding, returns the top-N most relevant tool
 * names from Supabase tool_embeddings via the `search_tools` RPC.
 *
 * Results are filtered by enabled integrations so that tools for disconnected
 * services (Google, Outlook, GitHub, etc.) are excluded.
 *
 * This module is consumed by:
 *   - server.ts (parallel pre-fetch during request pipeline)
 *   - stuard/tools.ts (proactive tool inclusion in agent toolset)
 */

import { getSupabaseService } from '../supabase';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface RankedTool {
  name: string;
  description: string;
  category: string;
  score: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// INTEGRATION FILTERS
// ═══════════════════════════════════════════════════════════════════════════════

const INTEGRATION_PREFIXES: Record<string, string[]> = {
  google: ['google_', 'gmail_', 'calendar_', 'drive_', 'sheets_', 'docs_', 'tasks_'],
  outlook: ['outlook_'],
  github: ['github_'],
  notion: ['notion_'],
  linear: ['linear_'],
  stripe: ['stripe_'],
};

/**
 * Check whether a tool name belongs to an integration that requires
 * the user to have connected the service.
 */
function isIntegrationTool(name: string): boolean {
  return Object.values(INTEGRATION_PREFIXES)
    .flat()
    .some(prefix => name.startsWith(prefix));
}

function isToolAllowed(name: string, allowedPrefixes: string[]): boolean {
  if (!isIntegrationTool(name)) return true; // non-integration tools are always ok
  return allowedPrefixes.some(prefix => name.startsWith(prefix));
}

// ═══════════════════════════════════════════════════════════════════════════════
// RANKING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Rank tools by semantic similarity to a pre-computed query embedding.
 *
 * Uses the existing Supabase `search_tools` RPC which performs cosine similarity
 * via pgvector HNSW index.
 *
 * @param queryEmbedding   Pre-computed embedding vector for the user prompt
 * @param enabledIntegrations  List of integration IDs the user has connected
 * @param topN             Maximum tools to return (default 5)
 * @param threshold        Minimum similarity score (default 0.25)
 * @returns                Ranked tools sorted by score descending
 */
export async function rankToolsByEmbedding(
  queryEmbedding: number[],
  enabledIntegrations: string[] = [],
  topN: number = 5,
  threshold: number = 0.25
): Promise<RankedTool[]> {
  if (!queryEmbedding || queryEmbedding.length === 0) return [];

  const supabase = getSupabaseService();
  if (!supabase) {
    if (process.env.SIS_DEBUG === '1') {
      console.log('[tool-ranking] Supabase not available, skipping ranking');
    }
    return [];
  }

  try {
    // Request more than topN to have headroom for filtering
    const fetchCount = Math.max(topN * 3, 20);

    const { data, error } = await supabase.rpc('search_tools', {
      query_embedding: queryEmbedding,
      match_threshold: threshold,
      match_count: fetchCount,
      filter_category: null,
      filter_kind: null,
      enabled_only: true,
    });

    if (error) {
      if (process.env.SIS_DEBUG === '1') {
        console.warn('[tool-ranking] search_tools RPC failed:', error.message);
      }
      return [];
    }

    // Build allowed prefixes from enabled integrations
    const allowedPrefixes: string[] = [];
    for (const integration of enabledIntegrations) {
      const prefixes = INTEGRATION_PREFIXES[integration];
      if (prefixes) allowedPrefixes.push(...prefixes);
    }

    // Filter and map
    const ranked: RankedTool[] = (data || [])
      .filter((row: any) => isToolAllowed(row.name, allowedPrefixes))
      .map((row: any) => ({
        name: row.name,
        description: row.description || '',
        category: row.category || 'Other',
        score: typeof row.similarity === 'number' ? row.similarity : 0,
      }));

    // Already sorted by similarity from the RPC, but ensure consistent ordering
    ranked.sort((a, b) => b.score - a.score);

    const result = ranked.slice(0, topN);

    if (process.env.SIS_DEBUG === '1') {
      console.log(`[tool-ranking] Top ${result.length} tools for query:`,
        result.map(t => `${t.name}(${t.score.toFixed(3)})`).join(', ')
      );
    }

    return result;

  } catch (e: any) {
    if (process.env.SIS_DEBUG === '1') {
      console.error('[tool-ranking] Error:', e.message);
    }
    return [];
  }
}

/**
 * Convenience: get just the tool names from ranking.
 */
export async function getRankedToolNames(
  queryEmbedding: number[],
  enabledIntegrations: string[] = [],
  topN: number = 5,
  threshold: number = 0.25
): Promise<string[]> {
  const ranked = await rankToolsByEmbedding(queryEmbedding, enabledIntegrations, topN, threshold);
  return ranked.map(t => t.name);
}
