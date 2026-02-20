/**
 * SIS Runtime Tools
 *
 * Meta-tools that allow agents to dynamically discover and execute tools at runtime.
 * Instead of pre-loading all tools, agents use these to find what they need on demand.
 * 
 * Features:
 * - Semantic search via Supabase pgvector (when enabled)
 * - Keyword fallback search (always available)
 * - Query agent for local tools via client bridge
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { searchToolsSemanticSupabase, isSupabaseSISEnabled, ResolvedTool } from './sis-supabase';
import { execLocalTool, hasClientBridge } from './bridge';
import { getToolRegistry, getToolMetadata } from './tool-registry';
// Ensure tools are registered
import { initToolRegistry } from './meta-tools';

// Initialize on module load
initToolRegistry();

/**
 * Fallback keyword search when Supabase SIS is not available.
 * Searches tool names and descriptions for matching keywords.
 */
function searchToolsKeyword(
  query: string,
  options: { category?: string | null; limit?: number } = {}
): Array<{ name: string; description: string; category: string; kind: string; score: number; schema: any }> {
  const { category = null, limit = 10 } = options;
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
  
  const results: Array<{ name: string; description: string; category: string; kind: string; score: number; schema: any }> = [];
  const registry = getToolRegistry();
  
  for (const [id, tool] of registry.entries()) {
    const metadata = getToolMetadata(id) || { category: 'Other', kind: 'local' };
    
    // Filter by category if specified
    if (category && metadata.category !== category) continue;
    
    const nameLower = id.toLowerCase();
    const descLower = (tool.description || '').toLowerCase();
    
    // Calculate relevance score based on keyword matches
    let score = 0;
    
    // Exact name match is highest priority
    if (nameLower === queryLower) {
      score = 1.0;
    } else if (nameLower.includes(queryLower)) {
      score = 0.9;
    } else {
      // Check each query word
      for (const word of queryWords) {
        if (nameLower.includes(word)) score += 0.3;
        if (descLower.includes(word)) score += 0.2;
      }
      // Normalize score
      score = Math.min(score / Math.max(queryWords.length * 0.5, 1), 0.85);
    }
    
    if (score > 0.1) {
      results.push({
        name: id,
        description: tool.description,
        category: metadata.category,
        kind: metadata.kind || 'local',
        score: Math.round(score * 100) / 100,
        schema: { args: tool.inputSchema, output: tool.outputSchema },
      });
    }
  }
  
  // Sort by score descending
  results.sort((a, b) => b.score - a.score);
  
  return results.slice(0, limit);
}

/**
 * Search for tools semantically. Returns tool names and short descriptions.
 * Use sis_execute_tool to run a discovered tool.
 */
export const sis_search_tools = createTool({
  id: 'sis_search_tools',
  description: 'Discover available tools by describing what you need. Returns tool names and descriptions. Use sis_execute_tool to run them.',

  inputSchema: z.object({
    query: z.string().min(3).describe('What you want to do, e.g. "send email", "screenshot", "browser click"'),
    category: z.enum([
      'system', 'core', 'input', 'ui', 'vision', 'data', 'integrations', 'flow'
    ]).optional().describe('Filter by category'),
    limit: z.number().int().min(1).max(10).optional().default(5).describe('Max results (default 5)'),
  }),

  outputSchema: z.object({
    success: z.boolean(),
    count: z.number().optional(),
    tools: z.array(z.object({
      name: z.string(),
      description: z.string(),
    })).optional(),
    error: z.string().optional(),
  }),

  execute: async (inputData, context) => {
    const { query, category, limit = 10  } = inputData as { query: string; category?: string; limit?: number };

    let tools: Array<{ name: string; description: string; category: string; kind: string; score: number; schema: any }> = [];
    let searchMethod = 'keyword';

    // Try Supabase semantic search first (if enabled)
    if (isSupabaseSISEnabled()) {
      try {
        const results = await searchToolsSemanticSupabase(query, {
          topK: limit,
          threshold: 0.2,
          category: category || null,
        });

        tools = results.map((t: ResolvedTool) => ({
          name: t.name,
          description: t.description,
          category: t.category,
          kind: t.kind,
          score: Math.round(t.score * 100) / 100,
          schema: t.schema,
        }));
        searchMethod = 'semantic';

        if (process.env.SIS_DEBUG === '1') {
          console.log(`[sis_search_tools] Semantic search: "${query}" -> ${tools.length} tools`);
        }
      } catch (error: any) {
        console.warn('[sis_search_tools] Semantic search failed, falling back to keyword:', error.message);
        // Fall through to keyword search
      }
    }

    // Fallback to keyword search if semantic search didn't return results or isn't available
    if (tools.length === 0) {
      tools = searchToolsKeyword(query, { category, limit });
      searchMethod = 'keyword';

      if (process.env.SIS_DEBUG === '1') {
        console.log(`[sis_search_tools] Keyword search: "${query}" -> ${tools.length} tools`);
      }
    }

    // Also try querying the local agent for tools (if connected)
    if (hasClientBridge() && tools.length < limit) {
      try {
        const agentResult = await execLocalTool('list_tools', { category }) as any;
        if (agentResult?.ok && Array.isArray(agentResult.tools)) {
          // Add local agent tools not already in results
          const existingNames = new Set(tools.map(t => t.name));
          const queryLower = query.toLowerCase();
          
          for (const agentTool of agentResult.tools) {
            if (existingNames.has(agentTool.name)) continue;
            
            // Simple keyword match for agent tools
            const nameLower = agentTool.name.toLowerCase();
            const descLower = (agentTool.description || '').toLowerCase();
            
            if (nameLower.includes(queryLower) || descLower.includes(queryLower)) {
              tools.push({
                name: agentTool.name,
                description: agentTool.description,
                category: agentTool.category || 'local',
                kind: 'local',
                score: 0.5, // Default score for agent tools
                schema: {}, // Agent tools don't expose schema through list_tools
              });
            }
          }
          
          if (process.env.SIS_DEBUG === '1') {
            console.log(`[sis_search_tools] Added agent tools, total: ${tools.length}`);
          }
        }
      } catch (e) {
        // Agent query failed, continue with existing results
        if (process.env.SIS_DEBUG === '1') {
          console.log('[sis_search_tools] Agent query failed:', e);
        }
      }
    }

    // Sort by score and limit
    tools.sort((a, b) => b.score - a.score);
    tools = tools.slice(0, limit);

    // Return compact format: name + short description only (no schemas)
    const compactTools = tools.map(t => ({
      name: t.name,
      description: String(t.description || '').slice(0, 150),
    }));

    return {
      success: true,
      count: compactTools.length,
      tools: compactTools,
    };
  },
});

/**
 * Execute a tool by name with the given arguments.
 * Use this after finding a tool with sis_search_tools.
 */
export const sis_execute_tool = createTool({
  id: 'sis_execute_tool',
  description: 'Execute a tool by name after discovering it with sis_search_tools. Pass args matching the tool schema.',

  inputSchema: z.object({
    tool_name: z.string().describe('The exact name of the tool to execute'),
    args: z.record(z.string(), z.any()).optional().default({}).describe('Arguments for the tool, matching its schema. Defaults to empty object if not provided.'),
  }),

  outputSchema: z.object({
    success: z.boolean(),
    tool: z.string().optional(),
    result: z.any().optional(),
    error: z.string().optional(),
  }),

  execute: async (inputData, runCtx) => {
    const { tool_name, args = {} } = inputData as { tool_name: string; args?: Record<string, any> };
    const { runId, writer } = (runCtx as any) || {};

    if (process.env.SIS_DEBUG === '1') {
      console.log(`[sis_execute_tool] Executing tool: ${tool_name}`, { args });
    }

    // Look up the tool in the dynamic registry
    const registry = getToolRegistry();
    const tool = registry.get(tool_name);

    if (tool) {
      // Found in cloud tools, execute it
      try {
        if (typeof tool.execute === 'function') {
          const result = await tool.execute(args, { runId, writer } as any);
          if (process.env.SIS_DEBUG === '1') {
            console.log(`[sis_execute_tool] Tool '${tool_name}' executed successfully (cloud)`);
          }
          return { success: true, tool: tool_name, result };
        } else {
          const errorMsg = `Tool '${tool_name}' exists but is not executable`;
          console.error(`[sis_execute_tool] ${errorMsg}`);
          return { success: false, error: errorMsg };
        }
      } catch (error: any) {
        const errorMsg = `Tool '${tool_name}' execution failed: ${error.message || 'Unknown error'}`;
        console.error(`[sis_execute_tool] ${errorMsg}`, error);
        return { success: false, tool: tool_name, error: errorMsg };
      }
    }

    // Tool not found in registry, try executing via local agent bridge
    if (hasClientBridge()) {
      if (process.env.SIS_DEBUG === '1') {
        console.log(`[sis_execute_tool] Tool '${tool_name}' not in cloud, trying local agent...`);
      }
      try {
        const result = await execLocalTool(tool_name, args);
        
        // Check if the tool was found
        if (result && typeof result === 'object' && (result as any).error === 'unknown_tool') {
          const errorMsg = `Tool '${tool_name}' not found in cloud or local agent. Use sis_search_tools to find available tools.`;
          if (process.env.SIS_DEBUG === '1') {
            console.error(`[sis_execute_tool] ${errorMsg}`);
          }
          return { success: false, error: errorMsg };
        }

        if (process.env.SIS_DEBUG === '1') {
          console.log(`[sis_execute_tool] Tool '${tool_name}' executed successfully (local)`);
        }
        return { success: true, tool: tool_name, result, source: 'local' };
      } catch (error: any) {
        const errorMsg = `Tool '${tool_name}' local execution failed: ${error.message || 'Unknown error'}`;
        console.error(`[sis_execute_tool] ${errorMsg}`, error);
        return { success: false, tool: tool_name, error: errorMsg };
      }
    }

    // No cloud tool and no bridge available
    const errorMsg = `Tool '${tool_name}' not found. Use sis_search_tools to find available tools.`;
    if (process.env.SIS_DEBUG === '1') {
      console.error(`[sis_execute_tool] ${errorMsg}`);
    }
    return { success: false, error: errorMsg };
  },
});


/**
 * List all available tool categories
 */
export const sis_list_categories = createTool({
  id: 'sis_list_categories',
  description: 'List all available tool categories to help narrow down searches.',

  inputSchema: z.object({}),

  outputSchema: z.object({
    categories: z.array(z.object({
      id: z.string(),
      description: z.string(),
    })),
    hint: z.string(),
  }),

  execute: async () => {
    return {
      categories: [
        { id: 'core', description: 'Orchestration and flow control (wait, run_sequential, run_parallel)' },
        { id: 'system', description: 'System commands, terminals, file operations' },
        { id: 'input', description: 'Keyboard, mouse, clipboard interactions' },
        { id: 'ui', description: 'Custom UI dialogs, notifications, user prompts' },
        { id: 'vision', description: 'Screenshots, screen capture, media analysis' },
        { id: 'data', description: 'Web search, AI inference, data processing' },
        { id: 'integrations', description: 'Gmail, Outlook, GitHub, Google Workspace, Browser automation' },
        { id: 'flow', description: 'Workflow control, headless agents, automation' },
      ],
      hint: 'Use sis_search_tools with a category to filter results.',
    };
  },
});

/**
 * All SIS runtime tools for export
 */
export const SIS_RUNTIME_TOOLS = {
  sis_search_tools,
  sis_execute_tool,
  sis_list_categories,
} as const;
