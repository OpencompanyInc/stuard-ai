/**
 * SIS Runtime Tools
 *
 * Meta-tools that allow agents to dynamically discover and execute tools at runtime.
 * Instead of pre-loading all tools, agents use these to find what they need on demand.
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { searchToolsSemanticSupabase, isSupabaseSISEnabled, ResolvedTool } from './sis-supabase';
import { ALL_TOOLS } from '../agents/stuard/tools';

/**
 * Search for tools semantically. Returns tool names, descriptions, and full schemas.
 * The agent can use this to discover what tools are available for a task.
 */
export const sis_search_tools = createTool({
  id: 'sis_search_tools',
  description: `Search for available tools by describing what you need. Returns matching tools with their full schemas so you can use them immediately.

Examples:
- "send an email" → returns gmail_send_message, outlook_send_mail with schemas
- "automate browser clicks" → returns browser_click_element, browser_fill_form, etc.
- "run python code" → returns run_python_script with schema
- "take a screenshot" → returns capture_screen, take_screenshot

Use this when you need a capability that isn't in your current toolset. IMPORTANT: You can discover and use ANY tool in the system this way - don't assume tools aren't available.`,

  inputSchema: z.object({
    query: z.string().min(3).describe('Describe what you want to do. Be specific about the action needed. Example: "send email", "capture screenshot", "click button in browser"'),
    category: z.enum([
      'system', 'core', 'input', 'ui', 'vision', 'data', 'integrations', 'flow'
    ]).optional().describe('Optional: filter by tool category'),
    limit: z.number().int().min(1).max(20).optional().default(10).describe('Max number of tools to return (default 10)'),
  }),

  outputSchema: z.object({
    success: z.boolean(),
    query: z.string().optional(),
    count: z.number().optional(),
    tools: z.array(z.object({
      name: z.string(),
      description: z.string(),
      category: z.string(),
      kind: z.string(),
      score: z.number(),
      schema: z.any(),
    })).optional(),
    hint: z.string().optional(),
    error: z.string().optional(),
  }),

  execute: async ({ context }) => {
    const { query, category, limit = 10 } = context as { query: string; category?: string; limit?: number };

    // Check if Supabase SIS is available
    if (!isSupabaseSISEnabled()) {
      return {
        success: false,
        error: 'Tool search not available. SIS_USE_SUPABASE is not enabled. Contact the system administrator.',
        tools: [],
        hint: 'SIS dynamic tool discovery is not configured.',
      };
    }

    try {
      const results = await searchToolsSemanticSupabase(query, {
        topK: limit,
        threshold: 0.2, // Lower threshold for discovery
        category: category || null,
      });

      // Format results for agent consumption
      const tools = results.map((t: ResolvedTool) => ({
        name: t.name,
        description: t.description,
        category: t.category,
        kind: t.kind, // 'local', 'cloud', or 'orchestration'
        score: Math.round(t.score * 100) / 100, // Round to 2 decimals
        schema: t.schema, // { args: {...}, output: {...} }
      }));

      if (process.env.SIS_DEBUG === '1') {
        console.log(`[sis_search_tools] Query: "${query}" -> Found ${tools.length} tools`);
      }

      return {
        success: true,
        query,
        count: tools.length,
        tools,
        hint: tools.length > 0
          ? `Found ${tools.length} tools matching "${query}". Use sis_execute_tool with the tool name and required args to execute any of these tools.`
          : `No matching tools found for "${query}". Try rephrasing your query or use sis_list_categories to see available tool categories.`,
      };
    } catch (error: any) {
      console.error('[sis_search_tools] Error:', error);
      return {
        success: false,
        error: `Search failed: ${error.message || 'Unknown error'}`,
        tools: [],
        hint: 'Tool search encountered an error. Check system logs for details.',
      };
    }
  },
});

/**
 * Execute a tool by name with the given arguments.
 * Use this after finding a tool with sis_search_tools.
 */
export const sis_execute_tool = createTool({
  id: 'sis_execute_tool',
  description: `Execute any tool by name. Use this after discovering a tool with sis_search_tools.

The tool must exist in the system. Pass arguments as specified in the tool's schema.

Example:
  sis_execute_tool({
    tool_name: "gmail_send_message",
    args: {
      to: ["user@example.com"],
      subject: "Hello",
      body: "Message content"
    }
  })`,

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

  execute: async ({ context, runId, writer }) => {
    const { tool_name, args = {} } = context as { tool_name: string; args?: Record<string, any> };

    if (process.env.SIS_DEBUG === '1') {
      console.log(`[sis_execute_tool] Executing tool: ${tool_name}`, { args });
    }

    // Look up the tool in ALL_TOOLS
    const toolFn = (ALL_TOOLS as any)[tool_name];

    if (!toolFn) {
      const errorMsg = `Tool '${tool_name}' not found in system. Use sis_search_tools to find available tools. Make sure you use the exact tool name returned by sis_search_tools.`;
      if (process.env.SIS_DEBUG === '1') {
        console.error(`[sis_execute_tool] ${errorMsg}`);
      }
      return {
        success: false,
        error: errorMsg,
      };
    }

    try {
      // Execute the tool with full context including writer for proper streaming
      // Tools from ALL_TOOLS are typically @mastra/core tools with an execute function
      if (typeof toolFn.execute === 'function') {
        // Pass through all execution context: args as context, runId, and writer
        const result = await toolFn.execute({ context: args, runId, writer });

        if (process.env.SIS_DEBUG === '1') {
          console.log(`[sis_execute_tool] Tool '${tool_name}' executed successfully`);
        }

        return {
          success: true,
          tool: tool_name,
          result,
        };
      } else if (typeof toolFn === 'function') {
        // Some tools might be plain functions
        const result = await toolFn(args);

        if (process.env.SIS_DEBUG === '1') {
          console.log(`[sis_execute_tool] Tool '${tool_name}' (function) executed successfully`);
        }

        return {
          success: true,
          tool: tool_name,
          result,
        };
      } else {
        const errorMsg = `Tool '${tool_name}' exists but is not executable (no execute function or is not a function)`;
        console.error(`[sis_execute_tool] ${errorMsg}`);
        return {
          success: false,
          error: errorMsg,
        };
      }
    } catch (error: any) {
      const errorMsg = `Tool '${tool_name}' execution failed: ${error.message || 'Unknown error'}`;
      console.error(`[sis_execute_tool] ${errorMsg}`, error);
      return {
        success: false,
        tool: tool_name,
        error: errorMsg,
      };
    }
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
