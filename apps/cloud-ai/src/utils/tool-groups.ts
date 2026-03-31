/**
 * Runtime Semantic Tool Injection via Supabase-stored groups.
 *
 * On startup, fetches `semantic_groups` from tool_embeddings once,
 * builds an inverted index (keyword → tool names), and caches in memory.
 * At request time, matches query keywords against the index to inject
 * tools natively — no embedding latency needed for obvious domain signals.
 */

import { getSupabaseService } from '../supabase';

// ─── Cache ───────────────────────────────────────────────────────────────────

/** keyword → Set<toolName> */
let _groupIndex: Map<string, Set<string>> | null = null;
let _loadPromise: Promise<void> | null = null;
let _lastLoadedAt = 0;

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ─── Load from Supabase ──────────────────────────────────────────────────────

async function loadGroupIndex(): Promise<void> {
  const supabase = getSupabaseService();
  if (!supabase) return;

  try {
    const { data, error } = await supabase
      .from('tool_embeddings')
      .select('name, semantic_groups')
      .eq('enabled', true)
      .not('semantic_groups', 'eq', '{}');

    if (error) {
      console.warn('[tool-groups] Failed to fetch groups:', error.message);
      return;
    }

    const index = new Map<string, Set<string>>();

    for (const row of (data || []) as Array<{ name: string; semantic_groups: string[] }>) {
      if (!row.semantic_groups?.length) continue;
      for (const group of row.semantic_groups) {
        const key = group.toLowerCase();
        if (!index.has(key)) index.set(key, new Set());
        index.get(key)!.add(row.name);
      }
    }

    _groupIndex = index;
    _lastLoadedAt = Date.now();

    if (process.env.SIS_DEBUG === '1') {
      console.log(`[tool-groups] Loaded ${index.size} groups covering ${new Set(data?.map((r: any) => r.name)).size} tools`);
    }
  } catch (e: any) {
    console.warn('[tool-groups] Error loading groups:', e.message);
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Warm up the group cache. Call once on server startup.
 * Non-blocking — returns immediately if already loading.
 */
export function warmupGroupCache(): void {
  if (_loadPromise) return;
  _loadPromise = loadGroupIndex().finally(() => { _loadPromise = null; });
}

/**
 * Ensure the group cache is loaded (lazy init + TTL refresh).
 */
async function ensureLoaded(): Promise<void> {
  if (_groupIndex && (Date.now() - _lastLoadedAt) < CACHE_TTL_MS) return;
  if (_loadPromise) { await _loadPromise; return; }
  _loadPromise = loadGroupIndex().finally(() => { _loadPromise = null; });
  await _loadPromise;
}

/**
 * Integration prefix map — tools with these prefixes require the
 * corresponding integration to be enabled before injection.
 * Tools not matching any prefix are always allowed.
 */
const INTEGRATION_PREFIXES: Record<string, string[]> = {
  google: ['google_', 'gmail_', 'calendar_', 'drive_', 'sheets_', 'docs_', 'tasks_'],
  outlook: ['outlook_'],
  github: ['github_'],
  facebook: ['facebook_'],
  instagram: ['instagram_'],
  threads: ['threads_'],
  whatsapp: ['whatsapp_'],
  telnyx: ['telnyx_'],
  reddit: ['reddit_'],
  discord: ['discord_'],
};

function isAllowedTool(name: string, enabledIntegrations: string[]): boolean {
  for (const [integration, prefixes] of Object.entries(INTEGRATION_PREFIXES)) {
    if (prefixes.some(p => name.startsWith(p))) {
      return enabledIntegrations.includes(integration);
    }
  }
  return true; // non-integration tools always allowed
}

/**
 * Match a user query against semantic groups and return tool names to inject.
 * Uses substring matching against the inverted index keywords.
 * Integration tools are filtered by enabledIntegrations.
 */
export async function getSemanticInjections(
  query: string,
  enabledIntegrations: string[] = []
): Promise<string[]> {
  await ensureLoaded();
  if (!_groupIndex || _groupIndex.size === 0) return [];

  const q = query.toLowerCase();
  const injected = new Set<string>();

  for (const [keyword, tools] of _groupIndex.entries()) {
    if (q.includes(keyword)) {
      for (const t of tools) {
        if (isAllowedTool(t, enabledIntegrations)) {
          injected.add(t);
        }
      }
    }
  }

  if (process.env.SIS_DEBUG === '1' && injected.size > 0) {
    console.log(`[tool-groups] Injecting ${injected.size} tools for query:`, Array.from(injected).join(', '));
  }

  return Array.from(injected);
}

/**
 * Force-refresh the cache (e.g. after a tool sync).
 */
export function invalidateGroupCache(): void {
  _groupIndex = null;
  _lastLoadedAt = 0;
}
