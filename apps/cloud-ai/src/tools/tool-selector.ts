/**
 * Tool Selector
 *
 * Uses embeddings to select relevant tools for a given query.
 * This reduces token usage by only including tools the agent is likely to need.
 */

import { embedMany } from 'ai';
import { getSupabaseService } from '../supabase';
import { resolveEmbedder } from '../utils/embeddings';

export interface SelectedTool {
  name: string;
  description: string;
  category: string;
  similarity: number;
}

// Core tools that are always included
const CORE_TOOLS = new Set([
  // Flow control
  'wait',
  'run_sequential',
  'run_parallel',
  // Always useful
  'web_search',
  'scrape_url',
  'analyze_media',
  'ai_inference',
  // Memory/knowledge
  'memory_retrieval',
  'search_past_conversations',
  'get_conversation_context',
  'browse_topic_collections',
  'get_collection_detail',
  'synthesize_collection',
  // Spaces — always available for knowledge management
  'list_user_spaces',
  'get_space_contents',
  'add_to_space',
  'create_space',
  'find_or_create_space',
  'ensure_space_path',
  'list_space_path',
  'add_to_space_path',
  'get_space_tree',
  // System
  'run_command',
]);

// Integration tool prefixes - only include if integration is enabled
const INTEGRATION_PREFIXES: Record<string, string[]> = {
  google: ['google_', 'gmail_', 'calendar_', 'drive_', 'sheets_', 'docs_', 'tasks_'],
  outlook: ['outlook_'],
  github: ['github_'],
  facebook: ['facebook_'],
  instagram: ['instagram_'],
  threads: ['threads_'],
  whatsapp: ['whatsapp_'],
  discord: ['discord_'],
  reddit: ['reddit_'],
  x: ['x_'],
  notion: ['notion_'],  // MCP
  linear: ['linear_'],  // MCP
  stripe: ['stripe_'],  // MCP
  'browser-use': ['browser_use_'],
  browser_use: ['browser_use_'],  // alias
};

/**
 * Select relevant tools for a user query using embedding similarity
 *
 * @param query - The user's message/query
 * @param enabledIntegrations - List of enabled integration IDs
 * @param topK - Maximum number of tools to return (default 15)
 * @param similarityThreshold - Minimum similarity score (default 0.3)
 */
export async function selectToolsForQuery(
  query: string,
  enabledIntegrations: string[] = [],
  topK: number = 15,
  similarityThreshold: number = 0.3
): Promise<SelectedTool[]> {
  const supabase = getSupabaseService();

  // Always include core tools
  const selectedTools: SelectedTool[] = [];

  // If no Supabase, return core tools only
  if (!supabase) {
    console.warn('[tool-selector] Supabase not available, returning core tools only');
    return selectedTools;
  }

  try {
    // 1. Embed the query
    const { embedder } = await resolveEmbedder();
    const { embeddings } = await embedMany({ model: embedder as any, values: [query] });
    const queryVector = embeddings[0];

    // 2. Search via pgvector RPC (server-side cosine similarity)
    const { data, error } = await supabase.rpc('search_tools', {
      query_embedding: queryVector,
      match_threshold: similarityThreshold,
      match_count: topK * 3, // fetch extra for integration filtering
      filter_category: null,
      filter_kind: null,
      enabled_only: true,
    });

    if (error || !data) {
      console.warn('[tool-selector] search_tools RPC failed:', error);
      return selectedTools;
    }

    // 3. Build set of allowed prefixes based on enabled integrations
    const allowedPrefixes: string[] = [];
    for (const integration of enabledIntegrations) {
      const prefixes = INTEGRATION_PREFIXES[integration];
      if (prefixes) {
        allowedPrefixes.push(...prefixes);
      }
    }

    // 4. Add core tools first (always included) - fetch from registry
    const { data: coreRows } = await supabase
      .from('tool_embeddings')
      .select('name, description, category')
      .in('name', [...CORE_TOOLS]);

    if (coreRows) {
      for (const row of coreRows) {
        selectedTools.push({
          name: row.name,
          description: row.description,
          category: row.category,
          similarity: 1.0,
        });
      }
    }

    // 5. Filter by integration access and add top similar tools
    const coreNames = new Set(selectedTools.map(t => t.name));

    for (const row of data) {
      if (selectedTools.length >= topK) break;
      if (coreNames.has(row.name)) continue;

      // Skip integration tools if integration not enabled
      const isIntegration = Object.values(INTEGRATION_PREFIXES)
        .flat()
        .some(prefix => row.name.startsWith(prefix));

      if (isIntegration) {
        const isAllowed = allowedPrefixes.some(prefix => row.name.startsWith(prefix));
        if (!isAllowed) continue;
      }

      selectedTools.push({
        name: row.name,
        description: row.description || '',
        category: row.category || 'Other',
        similarity: typeof row.similarity === 'number' ? row.similarity : 0,
      });
    }

    console.log(`[tool-selector] Selected ${selectedTools.length} tools for query`);
    return selectedTools;

  } catch (e) {
    console.error('[tool-selector] Error selecting tools:', e);
    return selectedTools;
  }
}

/**
 * Get just the tool names for a query (for use in agent tool filtering)
 */
export async function getRelevantToolNames(
  query: string,
  enabledIntegrations: string[] = [],
  topK: number = 15
): Promise<string[]> {
  const tools = await selectToolsForQuery(query, enabledIntegrations, topK);
  return tools.map(t => t.name);
}

/**
 * Check if a specific tool should be available for a query
 */
export async function isToolRelevantForQuery(
  toolName: string,
  query: string,
  threshold: number = 0.3
): Promise<boolean> {
  // Core tools are always relevant
  if (CORE_TOOLS.has(toolName)) return true;

  const tools = await selectToolsForQuery(query, [], 50, threshold);
  return tools.some(t => t.name === toolName);
}
