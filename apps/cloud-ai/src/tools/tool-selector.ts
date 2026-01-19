/**
 * Tool Selector
 *
 * Uses embeddings to select relevant tools for a given query.
 * This reduces token usage by only including tools the agent is likely to need.
 */

import { embedMany } from 'ai';
import { getSupabaseService } from '../supabase';
import { resolveEmbedder, cosineSimilarity } from '../utils/embeddings';

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
  'ensure_space_path',
  'list_space_path',
  'add_to_space_path',
  'get_space_tree',
  // System
  'run_command',
  'run_system_command',
]);

// Integration tool prefixes - only include if integration is enabled
const INTEGRATION_PREFIXES: Record<string, string[]> = {
  google: ['google_', 'gmail_', 'calendar_', 'drive_', 'sheets_', 'docs_', 'tasks_'],
  outlook: ['outlook_'],
  github: ['github_'],
  notion: ['notion_'],  // MCP
  linear: ['linear_'],  // MCP
  stripe: ['stripe_'],  // MCP
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

    // 2. Fetch all tool embeddings
    const { data: rows, error } = await supabase
      .from('tool_embeddings')
      .select('name, description, category, embedding');

    if (error || !rows) {
      console.warn('[tool-selector] Failed to fetch tool embeddings:', error);
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

    // 4. Calculate similarity scores
    const withScores = rows
      .map((row: any) => {
        // Skip integration tools if integration not enabled
        const isIntegrationTool = Object.values(INTEGRATION_PREFIXES)
          .flat()
          .some(prefix => row.name.startsWith(prefix));

        if (isIntegrationTool) {
          const isAllowed = allowedPrefixes.some(prefix => row.name.startsWith(prefix));
          if (!isAllowed) return null;
        }

        // Parse embedding
        let vec = row.embedding;
        if (typeof vec === 'string') {
          try {
            vec = JSON.parse(vec);
          } catch {
            return null;
          }
        }

        if (!Array.isArray(vec)) return null;

        const similarity = cosineSimilarity(queryVector, vec);
        return {
          name: row.name,
          description: row.description,
          category: row.category,
          similarity,
        };
      })
      .filter((t): t is SelectedTool => t !== null);

    // 5. Sort by similarity
    withScores.sort((a, b) => b.similarity - a.similarity);

    // 6. Add core tools first (always included)
    for (const row of rows) {
      if (CORE_TOOLS.has(row.name)) {
        selectedTools.push({
          name: row.name,
          description: row.description,
          category: row.category,
          similarity: 1.0, // Core tools always have max similarity
        });
      }
    }

    // 7. Add top similar tools (that aren't already in core)
    const coreNames = new Set(selectedTools.map(t => t.name));
    for (const tool of withScores) {
      if (selectedTools.length >= topK) break;
      if (coreNames.has(tool.name)) continue;
      if (tool.similarity < similarityThreshold) continue;

      selectedTools.push(tool);
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
