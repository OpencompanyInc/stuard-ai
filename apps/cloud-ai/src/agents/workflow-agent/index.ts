/**
 * Workflow Agent - Lean & Fast
 *
 * Specialized agent for designing, testing, and modifying Stuard workflows.
 * Uses search_workflow_docs for on-demand documentation lookup instead of
 * embedding ~1100 lines of docs in the system prompt.
 *
 * Token savings: ~8-12k tokens per request.
 */

import { Agent } from '@mastra/core/agent';
import { buildProviderModel } from '../../utils/models';
import { writeLog } from '../../utils/logger';
import os from 'node:os';

// Core tools
import { search_tools, search_workflow_nodes } from '../../tools/meta-tools';
import { retrieveToolFormat } from '../../tools/workflow-system';
import { workflowModifyTool } from '../../tools/workflow';
import { stop_automation, write_file, create_directory } from '../../tools/device-tools';
import { file_edit } from '../../tools/agentic-file-tools';
import { web_search } from '../../tools/perplexity-tools';
import { executeStep, listWorkflows, inspectWorkflow } from './tools';
import { searchWorkflowDocs } from './docs';

const GOOGLE_API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const XAI_API_KEY = process.env.XAI_API_KEY || '';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY || '';

// Get user home directory for file operations
const USER_HOME_DIR = (process.env.USERPROFILE || os.homedir()).replace(/\\/g, '/');

// ═══════════════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT - Comprehensive workflow engine context
// ═══════════════════════════════════════════════════════════════════════════════

export const WORKFLOW_SYSTEM_PROMPT = `You are the Workflow Architect for StuardAI.

You design and modify local automations. The user provides current workflow JSON — you modify it with modify_workflow.

**System Context**:
- Operating System: Windows
- User home directory: ${USER_HOME_DIR}
- Use forward slashes in paths (C:/Users/...) for cross-platform compatibility

══════════════════════════════════════════════════════════════════════════
KNOWLEDGE DISCOVERY — Pull docs on demand, never guess
══════════════════════════════════════════════════════════════════════════

You have THREE complementary discovery tools:

• search_workflow_nodes — for one-shot workflow node discovery. It returns
  candidate nodes with category, runtime type/location, and input/output
  schemas so you can shortlist and wire nodes quickly.

• search_tools / get_tool_schema — for TOOL schemas (what args a node takes,
  what fields it returns). Use these for every tool BEFORE wiring it.

• search_workflow_docs — for CONNECTING AND COMPOSING (wires, guards, loops,
  templates, variables, callNode, custom_ui, markdown, live updates,
  debugging, pitfalls, etc.). Use this whenever you're unsure how to structure
  flow, branching, data passing, or UI behavior.

Available doc sections (call with "list" to re-check):
  architecture, execution_model, connecting_nodes,
  triggers, trigger_advanced, input_params,
  nodes, nodes_outputs,
  wires, wires_branching, wires_convergence, wires_callnode,
  guards, guards_ai,
  loops, loops_patterns,
  templates, variables_workflow, variables_runtime,
  workspace, utility_tools, scripts,
  ai_inference, agent_nodes, streams, function_triggers,
  custom_ui_basics, custom_ui_hooks, custom_ui_data,
  custom_ui_markdown, custom_ui_live_updates, custom_ui_stuard_api,
  custom_ui_node_routing, custom_ui_multi_page, custom_ui_window,
  custom_ui_visual, custom_ui_pitfalls,
  modify_operations, modify_pitfalls, output_schema,
  debugging, common_pitfalls, performance

RULES:
1. BEFORE writing workflow structure you're unsure about, call
   search_workflow_docs({ query: "<topic>" }).
2. Before wiring a new node, prefer search_workflow_nodes({ query: "<what it should do>" }).
3. For tool args/outputs, call get_tool_schema({ toolName }).
4. You can fetch a specific section by id:
     search_workflow_docs({ query: "custom_ui_markdown" })
5. After non-trivial edits, call inspect_workflow to verify topology.

══════════════════════════════════════════════════════════════════════════
CORE STRATEGY
══════════════════════════════════════════════════════════════════════════

1. search_tools FIRST for integrations (calendar, email, browser, files, screenshots, etc.)
2. Prefer search_workflow_nodes for candidate node discovery and search_tools for broad catalog lookup.
3. NEVER invent tool names — use get_tool_schema to get exact args
4. Prefer existing tools over custom scripts (utility_tools > python > node)
5. Use inspect_workflow to understand current topology before modifying
6. DO NOT pass the full workflow JSON to modify_workflow — it auto-loads from session
7. For live-updating UIs: use set_variable notifyUi:true OR update_custom_ui
   — both now propagate to useVar hooks (search_workflow_docs:
   "custom_ui_live_updates").
8. For markdown text (AI output, docs, help): use the bundled <Markdown>
   component (search_workflow_docs: "custom_ui_markdown").

WORKFLOW STRUCTURE (quick reference):
  WORKFLOW = { id, name, triggers[], nodes[], wires[], variables?[] }
  Trigger → Wire → Node → Wire → Node → ...
  Guards on wires for conditional branching
  Loops on wires for repeated execution
  callNode: true wires for UI → worker on-demand routing

For detailed syntax on any of the above, use search_workflow_docs.

══════════════════════════════════════════════════════════════════════════
STREAM ARCHITECTURE — General-Purpose Pattern
══════════════════════════════════════════════════════════════════════════

Streams are tool-agnostic reactive data flow between nodes.
Any tool that returns { streamId } can feed any consumer via a stream wire:
  { from: "producer", to: "consumer", stream: { sourceField: "streamId", mode: "reactive" } }

Consumer reads via useStream(streamId) hook in custom_ui.
For full details: search_workflow_docs({ query: "stream_architecture" }).

══════════════════════════════════════════════════════════════════════════
FILE & DIRECTORY TOOLS
══════════════════════════════════════════════════════════════════════════

• write_file({ path, content, append? }) — Create/write files on disk
• create_directory({ path }) — Create directories
• file_edit({ path, mode, old_string, new_string, replace_all? }) — Edit non-stuard files

TARGETING SUB-WORKFLOWS:
• modify_workflow edits the main workflow by default
• Pass stuardFile: "path/to/sub.stuard" to modify a specific sub-workflow

SEND HOTKEY — BUILT-IN REPEAT:
  send_hotkey has count and delayMs args for repeating without wire loops.

══════════════════════════════════════════════════════════════════════════
YOUR TOOLS
══════════════════════════════════════════════════════════════════════════

 1. search_workflow_docs({ query }) — Look up workflow syntax/docs by topic
 2. search_workflow_nodes({ query }) — Find candidate workflow nodes with schema metadata
 3. search_tools({ query }) — Find tools by keyword
 4. get_tool_schema({ toolName }) — Get exact args format
 5. inspect_workflow({ mode }) — Inspect workflow topology (overview, node_flow, trigger_flow, wire)
 6. modify_workflow({ op, ...params }) — Edit workflow (NO workflow param needed!)
 7. execute_step({ tool, args }) — Test a tool
 8. list_workflows({}) — List saved workflows
 9. stop_workflow({ id }) — Stop running workflow
10. web_search({ query }) — Search the web
11. write_file({ path, content }) — Write files
12. create_directory({ path }) — Create directories
13. file_edit({ path, mode, ... }) — Edit files

CRITICAL: NEVER pass full workflow JSON to modify_workflow. Just use the op and params.
NEVER output raw JSON. Use modify_workflow for all changes.
When unsure about syntax, search_workflow_docs FIRST.`;


// ═══════════════════════════════════════════════════════════════════════════════
// WORKFLOW AGENT FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

export function workflowAgentLog(event: string, data?: Record<string, any>) {
  const msg = data ? `[workflow-agent] ${event}: ${JSON.stringify(data)}` : `[workflow-agent] ${event}`;
  console.log(msg);
  writeLog(`wf_agent_${event}`, data);
}

/**
 * Get the Workflow Agent configured with Gemini 3 Pro Preview.
 */
export function getWorkflowAgent(modelIdOverride?: string): Agent {
  const modelId =
    (typeof modelIdOverride === 'string' && modelIdOverride.trim())
      ? modelIdOverride.trim()
      : (process.env.WORKFLOW_MODEL_ID || 'google/gemini-3-pro-preview');

  const provider = String(modelId.split('/')[0] || '').toLowerCase();

  if (provider === 'google' && !GOOGLE_API_KEY) {
    workflowAgentLog('error', { message: 'GOOGLE_GENERATIVE_AI_API_KEY or GEMINI_API_KEY not set', modelId });
    throw new Error('GOOGLE_GENERATIVE_AI_API_KEY or GEMINI_API_KEY is required for google workflow models');
  }
  if (provider === 'openai' && !OPENAI_API_KEY) {
    workflowAgentLog('error', { message: 'OPENAI_API_KEY not set', modelId });
    throw new Error('OPENAI_API_KEY is required for openai workflow models');
  }
  if (provider === 'xai' && !XAI_API_KEY) {
    workflowAgentLog('error', { message: 'XAI_API_KEY not set', modelId });
    throw new Error('XAI_API_KEY is required for xai workflow models');
  }
  if (provider === 'deepseek' && !DEEPSEEK_API_KEY) {
    workflowAgentLog('error', { message: 'DEEPSEEK_API_KEY not set', modelId });
    throw new Error('DEEPSEEK_API_KEY is required for deepseek workflow models');
  }
  if (provider === 'perplexity' && !PERPLEXITY_API_KEY) {
    workflowAgentLog('error', { message: 'PERPLEXITY_API_KEY not set', modelId });
    throw new Error('PERPLEXITY_API_KEY is required for perplexity workflow models');
  }

  const model = buildProviderModel(modelId);
  if (!model) {
    workflowAgentLog('error', { message: 'Failed to build provider model', modelId });
    throw new Error(`Unsupported workflow modelId: ${modelId}`);
  }

  workflowAgentLog('init', { model: modelId });

  // Create logging wrappers for tools
  const createLoggedTool = (tool: any, name: string) => ({
    ...tool,
    execute: async (args: any, runCtx?: any) => {
      console.log(`[workflow-agent] Tool call: ${name}`, JSON.stringify(args, null, 2));
      try {
        const result = await tool.execute(args, runCtx);
        console.log(`[workflow-agent] Tool result: ${name}`, JSON.stringify(result, null, 2));
        return result;
      } catch (error) {
        console.error(`[workflow-agent] Tool error: ${name}`, error);
        throw error;
      }
    }
  });

  // Core workflow tools
  const tools = {
    // 1. Search workflow documentation on demand
    search_workflow_docs: createLoggedTool(searchWorkflowDocs, 'search_workflow_docs'),
    // 2. Search workflow nodes with schema metadata
    search_workflow_nodes: createLoggedTool(search_workflow_nodes, 'search_workflow_nodes'),
    // 3. Search tools (sis search)
    search_tools: createLoggedTool(search_tools, 'search_tools'),
    // 4. Get tool schema
    get_tool_schema: createLoggedTool(retrieveToolFormat, 'get_tool_schema'),
    // 5. Inspect workflow topology
    inspect_workflow: createLoggedTool(inspectWorkflow, 'inspect_workflow'),
    // 6. Modify workflow
    modify_workflow: createLoggedTool(workflowModifyTool, 'modify_workflow'),
    // 7. Execute step (sis execute)
    execute_step: createLoggedTool(executeStep, 'execute_step'),
    // 8. List workflows
    list_workflows: createLoggedTool(listWorkflows, 'list_workflows'),
    // 9. Stop workflow
    stop_workflow: createLoggedTool(stop_automation, 'stop_workflow'),
    // 10. Web search
    web_search: createLoggedTool(web_search, 'web_search'),
    // 11. Create/write files in the workspace or on disk
    write_file: createLoggedTool(write_file, 'write_file'),
    // 12. Create directories
    create_directory: createLoggedTool(create_directory, 'create_directory'),
    // 13. Edit non-stuard files (string-based find/replace)
    file_edit: createLoggedTool(file_edit, 'file_edit'),
  };

  // Determine if we should use thinking mode
  const useThinking = provider === 'google' && modelId.includes('gemini-3');

  // Create agent with enhanced logging
  const agent = new Agent({
    id: 'workflow-architect',
    name: 'workflow-architect',
    instructions: WORKFLOW_SYSTEM_PROMPT,
    model: model as any,
    tools,
  });

  // Add message logging and inject providerOptions for thinking at stream level
  const originalStream = agent.stream.bind(agent);
  (agent as any).stream = async (input: any, options?: any) => {
    console.log('[workflow-agent] Input message:', JSON.stringify(input, null, 2));
    
    // Inject thinkingConfig at the stream call level for Gemini 3 models
    const mergedOptions = useThinking
      ? {
          ...options,
          providerOptions: {
            ...options?.providerOptions,
            google: {
              ...options?.providerOptions?.google,
              thinkingConfig: {
                includeThoughts: true,
                thinkingLevel: 'high',
              },
            },
          },
        }
      : options;
    
    const result = await originalStream(input, mergedOptions);
    return result;
  };

  return agent;
}

// Re-export tools for external use
export { executeStep, listWorkflows, inspectWorkflow } from './tools';
export { searchWorkflowDocs } from './docs';
export { workflowModifyTool } from '../../tools/workflow';
