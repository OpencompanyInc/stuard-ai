/**
 * SIS-Supabase Integration
 *
 * Semantic tool search using Supabase pgvector. Replaces in-memory SIS registration
 * with database-backed tool retrieval for reduced token usage.
 */

import { getSupabaseService } from '../supabase';
import { embed } from 'ai';
import { openai } from '@ai-sdk/openai';

const EMBEDDING_MODEL = 'text-embedding-3-large';
const EMBEDDING_CACHE_TTL_MS = 1000 * 60 * 60; // 1 hour

export interface ToolMetadata {
  name: string;
  description: string;
  category: string;
  kind: 'local' | 'cloud' | 'orchestration';
  schema: any;
  semantic_hints?: string[];
}

export interface ResolvedTool extends ToolMetadata {
  score: number;
}

// In-memory cache to avoid DB calls on every request
const toolCache = new Map<string, { tools: ToolMetadata[]; timestamp: number }>();

// Query embedding cache to avoid re-embedding same queries
const queryEmbeddingCache = new Map<string, { embedding: number[]; timestamp: number }>();
const QUERY_CACHE_TTL_MS = 1000 * 60 * 5; // 5 minutes

/**
 * Fetch all tools from Supabase (cached)
 */
export async function fetchAllToolsFromDB(): Promise<ToolMetadata[]> {
  const cacheKey = 'all_tools';
  const cached = toolCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < EMBEDDING_CACHE_TTL_MS) {
    return cached.tools;
  }

  const supabase = getSupabaseService();
  if (!supabase) {
    console.warn('[sis-supabase] Supabase not available');
    return [];
  }

  const { data, error } = await supabase
    .from('tool_embeddings')
    .select('name, description, category, kind, schema, semantic_hints')
    .eq('enabled', true);

  if (error) {
    console.error('[sis-supabase] Failed to fetch tools:', error.message);
    return [];
  }

  const tools = (data || []) as ToolMetadata[];
  toolCache.set(cacheKey, { tools, timestamp: Date.now() });

  if (process.env.SIS_DEBUG === '1') {
    console.log(`[sis-supabase] Cached ${tools.length} tools from database`);
  }

  return tools;
}

/**
 * Generate embedding for a query (with caching)
 */
async function getQueryEmbedding(query: string): Promise<number[]> {
  const normalizedQuery = query.trim().toLowerCase();
  const cached = queryEmbeddingCache.get(normalizedQuery);

  if (cached && Date.now() - cached.timestamp < QUERY_CACHE_TTL_MS) {
    return cached.embedding;
  }

  const { embedding } = await embed({
    model: openai.embedding(EMBEDDING_MODEL),
    value: query,
  });

  queryEmbeddingCache.set(normalizedQuery, {
    embedding: embedding as number[],
    timestamp: Date.now(),
  });

  return embedding as number[];
}

/**
 * Semantic search for tools using Supabase RPC
 */
export async function searchToolsSemanticSupabase(
  query: string,
  options: {
    topK?: number;
    threshold?: number;
    category?: string | null;
    kind?: string | null;
  } = {}
): Promise<ResolvedTool[]> {
  const {
    topK = 12,
    threshold = 0.25,
    category = null,
    kind = null,
  } = options;

  const supabase = getSupabaseService();
  if (!supabase) {
    console.warn('[sis-supabase] Supabase not available, returning empty');
    return [];
  }

  // Generate query embedding
  const queryEmbedding = await getQueryEmbedding(query);

  // Use Supabase RPC for semantic search
  const { data, error } = await supabase.rpc('search_tools', {
    query_embedding: queryEmbedding,
    match_threshold: threshold,
    match_count: topK,
    filter_category: category,
    filter_kind: kind,
    enabled_only: true,
  });

  if (error) {
    console.error('[sis-supabase] Search failed:', error.message);
    return [];
  }

  const results = (data || []).map((row: any) => ({
    name: row.name,
    description: row.description,
    category: row.category,
    kind: row.kind,
    schema: row.schema,
    semantic_hints: row.semantic_hints,
    score: row.similarity,
  }));

  if (process.env.SIS_DEBUG === '1') {
    console.log(`[sis-supabase] Query: "${query.slice(0, 50)}..." -> ${results.length} tools`);
    console.log('[sis-supabase] Top matches:', results.slice(0, 5).map((r: ResolvedTool) =>
      `${r.name} (${r.score.toFixed(3)})`
    ).join(', '));
  }

  return results;
}

/**
 * Get tool metadata by name (cached)
 */
export async function getToolMetadata(toolName: string): Promise<ToolMetadata | null> {
  const allTools = await fetchAllToolsFromDB();
  return allTools.find(t => t.name === toolName) || null;
}

/**
 * Get multiple tools by names (efficient batch lookup)
 */
export async function getToolsMetadataBatch(toolNames: string[]): Promise<Map<string, ToolMetadata>> {
  const allTools = await fetchAllToolsFromDB();
  const toolMap = new Map<string, ToolMetadata>();

  for (const tool of allTools) {
    if (toolNames.includes(tool.name)) {
      toolMap.set(tool.name, tool);
    }
  }

  return toolMap;
}

/**
 * Clear tool cache (call after sync)
 */
export function clearToolCache(): void {
  toolCache.clear();
  queryEmbeddingCache.clear();
  if (process.env.SIS_DEBUG === '1') {
    console.log('[sis-supabase] Cache cleared');
  }
}

/**
 * Pre-warm the cache on server startup
 */
export async function warmupToolCache(): Promise<void> {
  try {
    const tools = await fetchAllToolsFromDB();
    console.log(`[sis-supabase] Cache warmed with ${tools.length} tools`);
  } catch (error) {
    console.warn('[sis-supabase] Failed to warm cache:', error);
  }
}

/**
 * Check if Supabase-based SIS is available and configured
 */
export function isSupabaseSISEnabled(): boolean {
  return process.env.SIS_USE_SUPABASE === '1' && !!getSupabaseService();
}

/**
 * Get cache statistics for monitoring
 */
export function getCacheStats(): {
  toolsCached: number;
  queriesCached: number;
  toolCacheAge: number | null;
} {
  const toolCacheEntry = toolCache.get('all_tools');
  return {
    toolsCached: toolCacheEntry?.tools.length || 0,
    queriesCached: queryEmbeddingCache.size,
    toolCacheAge: toolCacheEntry ? Date.now() - toolCacheEntry.timestamp : null,
  };
}
