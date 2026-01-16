import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getSupabaseService } from '../supabase';
import { resolveEmbedder } from '../utils/embeddings';
import { embed } from 'ai';

// Generate embedding for search query
async function generateQueryEmbedding(query: string): Promise<number[] | null> {
  try {
    const { embedder } = await resolveEmbedder();
    const { embedding } = await embed({ model: embedder as any, value: query });
    return embedding as number[];
  } catch (e) {
    console.error('[marketplace-tools] embedding generation failed:', e);
    return null;
  }
}

const WorkflowResultSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.string().nullable(),
  tags: z.array(z.string()).nullable(),
  icon: z.string().nullable(),
  rating_avg: z.number(),
  rating_count: z.number(),
  download_count: z.number(),
  publisher_name: z.string().nullable(),
  similarity: z.number().optional(),
});

/**
 * Search the Stuard workflow marketplace using semantic similarity.
 * Returns workflows that match the query description.
 */
export const search_marketplace = createTool({
  id: 'search_marketplace',
  description: 
    'Search the Stuard workflow marketplace to find pre-built automations. ' +
    'Use natural language to describe what kind of workflow you need. ' +
    'Returns matching workflows with ratings and download counts.',
  inputSchema: z.object({
    query: z.string().min(1).describe('Natural language description of the workflow you are looking for'),
    category: z.string().optional().describe('Filter by category: productivity, automation, data, integration, ai, media, developer, communication, general'),
    limit: z.number().int().min(1).max(20).default(10).describe('Maximum number of results to return'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    results: z.array(WorkflowResultSchema),
    count: z.number(),
    error: z.string().optional(),
  }),
  execute: async ({ context }) => {
    const { query, category, limit } = context as { query: string; category?: string; limit: number };
    
    const supabase = getSupabaseService();
    if (!supabase) {
      return { ok: false, results: [], count: 0, error: 'Database not available' };
    }

    try {
      // Generate embedding for semantic search
      const embedding = await generateQueryEmbedding(query);
      
      if (embedding) {
        // Use semantic search RPC
        const { data, error } = await supabase.rpc('search_marketplace_workflows', {
          query_embedding: embedding,
          match_threshold: 0.25,
          match_count: limit,
          filter_category: category || null,
        });

        if (error) {
          console.error('[marketplace-tools] search rpc error:', error);
          // Fallback to text search
        } else if (data && data.length > 0) {
          return {
            ok: true,
            results: data.map((r: any) => ({
              ...r,
              similarity: parseFloat(r.similarity?.toFixed(3) || '0'),
            })),
            count: data.length,
          };
        }
      }

      // Fallback: text-based search
      let queryBuilder = supabase
        .from('marketplace_workflows')
        .select('id, slug, name, description, category, tags, icon, rating_avg, rating_count, download_count, publisher_name')
        .eq('status', 'published');
      
      if (category) {
        queryBuilder = queryBuilder.eq('category', category);
      }
      
      // Simple text match on name/description
      queryBuilder = queryBuilder.or(`name.ilike.%${query}%,description.ilike.%${query}%`);
      
      const { data, error } = await queryBuilder
        .order('download_count', { ascending: false })
        .limit(limit);

      if (error) {
        return { ok: false, results: [], count: 0, error: error.message };
      }

      return {
        ok: true,
        results: (data || []).map((r: any) => ({ ...r, similarity: undefined })),
        count: data?.length || 0,
      };
    } catch (e: any) {
      console.error('[marketplace-tools] search exception:', e);
      return { ok: false, results: [], count: 0, error: e.message || 'Search failed' };
    }
  },
});

/**
 * Get the full spec of a marketplace workflow for import.
 */
export const get_marketplace_workflow = createTool({
  id: 'get_marketplace_workflow',
  description: 
    'Retrieve the full workflow specification from the marketplace by slug. ' +
    'Use this after search_marketplace to get the complete workflow JSON for import.',
  inputSchema: z.object({
    slug: z.string().min(1).describe('The workflow slug from search results'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    workflow: z.object({
      id: z.string(),
      slug: z.string(),
      name: z.string(),
      description: z.string(),
      version: z.string(),
      spec: z.any(),
      category: z.string().nullable(),
      tags: z.array(z.string()).nullable(),
      rating_avg: z.number(),
      download_count: z.number(),
      publisher_name: z.string().nullable(),
    }).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ context }) => {
    const { slug } = context as { slug: string };
    
    const supabase = getSupabaseService();
    if (!supabase) {
      return { ok: false, error: 'Database not available' };
    }

    try {
      const { data, error } = await supabase
        .from('marketplace_workflows')
        .select('id, slug, name, description, version, spec, category, tags, rating_avg, download_count, publisher_name')
        .eq('slug', slug)
        .eq('status', 'published')
        .single();

      if (error || !data) {
        return { ok: false, error: 'Workflow not found' };
      }

      // Track download
      await supabase.from('marketplace_downloads').insert({
        workflow_id: data.id,
        user_id: null, // Tool context doesn't have user auth
      });

      return { ok: true, workflow: data };
    } catch (e: any) {
      return { ok: false, error: e.message || 'Failed to fetch workflow' };
    }
  },
});

/**
 * List popular/trending workflows from the marketplace.
 */
export const list_popular_workflows = createTool({
  id: 'list_popular_workflows',
  description: 
    'List popular and highly-rated workflows from the Stuard marketplace. ' +
    'Use this to discover trending automations.',
  inputSchema: z.object({
    category: z.string().optional().describe('Filter by category'),
    sort_by: z.enum(['downloads', 'rating', 'recent']).default('downloads').describe('Sort by: downloads (most popular), rating (highest rated), or recent (newest)'),
    limit: z.number().int().min(1).max(20).default(10),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    workflows: z.array(WorkflowResultSchema),
    count: z.number(),
    error: z.string().optional(),
  }),
  execute: async ({ context }) => {
    const { category, sort_by, limit } = context as { category?: string; sort_by: string; limit: number };
    
    const supabase = getSupabaseService();
    if (!supabase) {
      return { ok: false, workflows: [], count: 0, error: 'Database not available' };
    }

    try {
      let queryBuilder = supabase
        .from('marketplace_workflows')
        .select('id, slug, name, description, category, tags, icon, rating_avg, rating_count, download_count, publisher_name, created_at')
        .eq('status', 'published');
      
      if (category) {
        queryBuilder = queryBuilder.eq('category', category);
      }

      switch (sort_by) {
        case 'rating':
          queryBuilder = queryBuilder.order('rating_avg', { ascending: false }).order('rating_count', { ascending: false });
          break;
        case 'recent':
          queryBuilder = queryBuilder.order('created_at', { ascending: false });
          break;
        default: // downloads
          queryBuilder = queryBuilder.order('download_count', { ascending: false });
      }

      const { data, error } = await queryBuilder.limit(limit);

      if (error) {
        return { ok: false, workflows: [], count: 0, error: error.message };
      }

      return {
        ok: true,
        workflows: data || [],
        count: data?.length || 0,
      };
    } catch (e: any) {
      return { ok: false, workflows: [], count: 0, error: e.message || 'List failed' };
    }
  },
});

/**
 * Import a workflow directly from the marketplace by slug.
 * This combines get_marketplace_workflow + import_workflow in one step.
 */
export const import_from_marketplace = createTool({
  id: 'import_from_marketplace',
  description: 
    'Import a workflow from the Stuard marketplace directly into your local workflows. ' +
    'Use search_marketplace first to find the workflow slug, then use this to import it.',
  inputSchema: z.object({
    slug: z.string().min(1).describe('The workflow slug from search results'),
    new_name: z.string().optional().describe('Optional: rename the workflow during import'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    workflow_id: z.string().optional(),
    workflow_name: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ context }) => {
    const { slug, new_name } = context as { slug: string; new_name?: string };
    
    const supabase = getSupabaseService();
    if (!supabase) {
      return { ok: false, error: 'Database not available' };
    }

    try {
      // Fetch the workflow spec
      const { data, error } = await supabase
        .from('marketplace_workflows')
        .select('id, slug, name, spec')
        .eq('slug', slug)
        .eq('status', 'published')
        .single();

      if (error || !data || !data.spec) {
        return { ok: false, error: 'Workflow not found' };
      }

      // Track download
      await supabase.from('marketplace_downloads').insert({
        workflow_id: data.id,
        user_id: null,
      });

      // Return spec for import (the agent or UI will need to handle actual import via IPC)
      const spec = data.spec;
      if (new_name) {
        spec.name = new_name;
      }

      return { 
        ok: true, 
        workflow_id: spec.id || `marketplace_${Date.now().toString(36)}`,
        workflow_name: spec.name || data.name,
        spec, // Include spec so caller can import it
      };
    } catch (e: any) {
      return { ok: false, error: e.message || 'Import failed' };
    }
  },
});

/**
 * Get available marketplace categories.
 */
export const list_marketplace_categories = createTool({
  id: 'list_marketplace_categories',
  description: 'List all available workflow categories in the Stuard marketplace.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    ok: z.boolean(),
    categories: z.array(z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
    })),
  }),
  execute: async () => {
    const categories = [
      { id: 'productivity', name: 'Productivity', description: 'Task management, scheduling, and efficiency tools' },
      { id: 'automation', name: 'Automation', description: 'File processing, system tasks, and repetitive workflows' },
      { id: 'data', name: 'Data Processing', description: 'Data extraction, transformation, and analysis' },
      { id: 'integration', name: 'Integrations', description: 'Connect apps and services together' },
      { id: 'ai', name: 'AI & ML', description: 'Workflows using AI models and machine learning' },
      { id: 'media', name: 'Media', description: 'Image, video, and audio processing' },
      { id: 'developer', name: 'Developer', description: 'Development and DevOps workflows' },
      { id: 'communication', name: 'Communication', description: 'Email, messaging, and notifications' },
      { id: 'general', name: 'General', description: 'Miscellaneous workflows' },
    ];
    return { ok: true, categories };
  },
});
