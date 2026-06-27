/**
 * Workflow Agent - Lean & Fast
 *
 * Specialized agent for designing, testing, and modifying Stuard workflows.
 * The FULL (compressed) workflow doc corpus is inlined in the system prompt
 * (see system-prompt.ts / docs-data.ts) — a static, prompt-cache-friendly
 * prefix — so there is no search_workflow_docs tool and no doc-lookup
 * round trips. Node/tool discovery stays on-demand via search_workflow_nodes,
 * search_tools, and get_tool_schema.
 */

import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { buildProviderModel, buildProviderModelForUser, type ModelSourcePreference } from '../../utils/models';
import { writeLog } from '../../utils/logger';

// Core tools
import { createSearchWorkflowNodesTool } from '../../tools/meta-tools';
import { createWorkflowTool, retrieveToolFormat } from '../../tools/workflow-system';
import { workflowModifyTool } from '../../tools/workflow';
import { readWorkflow, editWorkflow } from '../../tools/workflow-dsl';
import { stop_automation, write_file, create_directory, read_file, list_directory } from '../../tools/device-tools';
import { file_edit } from '../../tools/agentic-file-tools';
import { web_search } from '../../tools/perplexity-tools';
import { scrape_url } from '../../tools/tavily-tools';
import { getBridgeSecrets, getBridgeWs, runWithSecrets, withClientBridge } from '../../tools/bridge';
import {
  clearActiveBridge,
  execLocalToolWithCapturedBridge,
  getLocalToolSpec,
  setActiveBridge,
  withActiveBridgeContext,
} from '../../tools/device/shared';
import { executeStep, searchWorkflows, loadWorkflow } from './tools';
import { createSearchWorkflowDocsTool } from './docs';
import { deployWorkflow } from './deploy';
import { WORKFLOW_SYSTEM_PROMPT, WORKFLOW_EDIT_SYSTEM_PROMPT, WORKFLOW_EDIT_TOOL_NAMES } from './system-prompt';
import { normalizeToolInputForSchema, coerceToolInputSchema } from '../../tools/zod-utils';

const GOOGLE_API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const XAI_API_KEY = process.env.XAI_API_KEY || '';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY || '';
// Gemini/GPT/Grok/DeepSeek are served through Stuard's OpenRouter account, so an
// OpenRouter key satisfies the native-provider requirement (see buildProviderModel).
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';

export { WORKFLOW_SYSTEM_PROMPT, WORKFLOW_EDIT_SYSTEM_PROMPT, WORKFLOW_EDIT_TOOL_NAMES };

const DEFAULT_WORKFLOW_LOCAL_TOOL_TIMEOUT_MS = 30 * 60 * 1000;

export interface WorkflowAgentOptions {
  modelId?: string;
  modelInstance?: any;
  includeCreateWorkflow?: boolean;
  extraTools?: Record<string, any>;
  instructionsSuffix?: string;
  id?: string;
  name?: string;
  bridgeWs?: any;
  bridgeSecrets?: Record<string, any>;
  /**
   * EDIT MODE — an existing, non-empty workflow is loaded and the user is
   * iterating on it. Uses the slim WORKFLOW_EDIT_SYSTEM_PROMPT (no inlined
   * build docs) and limits the model-visible tool schemas to
   * WORKFLOW_EDIT_TOOL_NAMES (the full universe is still built for execution),
   * cutting the always-resent prefix from ~18k to ~6k. See
   * project_workflow_token_blowup_levers.
   */
  editMode?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// WORKFLOW AGENT FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

export function workflowAgentLog(event: string, data?: Record<string, any>) {
  const msg = data ? `[workflow-agent] ${event}: ${JSON.stringify(data)}` : `[workflow-agent] ${event}`;
  console.log(msg);
  writeLog(`wf_agent_${event}`, data);
}

function normalizeWorkflowAgentOptions(modelIdOrOptions?: string | WorkflowAgentOptions): WorkflowAgentOptions {
  if (typeof modelIdOrOptions === 'string') return { modelId: modelIdOrOptions };
  return modelIdOrOptions || {};
}

function compactForLog(value: any, maxLength = 4000): string {
  try {
    const json = JSON.stringify(value);
    return json.length > maxLength ? `${json.slice(0, maxLength)}...<truncated ${json.length - maxLength} chars>` : json;
  } catch {
    return String(value);
  }
}

function createLoggedTool(tool: any, name: string) {
  const inputSchema = tool.inputSchema || tool.parameters;
  return {
    ...tool,
    ...(inputSchema ? { inputSchema: coerceToolInputSchema(inputSchema) } : {}),
    execute: async (args: any, runCtx?: any) => {
      const normalizedArgs = inputSchema ? normalizeToolInputForSchema(inputSchema, args) : args;
      console.log(`[workflow-agent] Tool call: ${name}`, compactForLog(normalizedArgs));
      try {
        const result = await tool.execute(normalizedArgs, runCtx);
        console.log(`[workflow-agent] Tool result: ${name}`, compactForLog(result));
        return result;
      } catch (error) {
        console.error(`[workflow-agent] Tool error: ${name}`, error);
        throw error;
      }
    },
  };
}

function wrapWorkflowToolWithBridge(tool: any, bridgeWs: any, bridgeSecrets?: Record<string, any>): any {
  if (!tool || typeof tool.execute !== 'function') return tool;

  const originalExecute = tool.execute.bind(tool);
  const toolId = tool.id || tool.name || 'unknown';
  const inputSchema = tool.inputSchema || tool.parameters || z.any();
  const outputSchema = tool.outputSchema || z.any();
  const localToolSpec = getLocalToolSpec(tool);

  return createTool({
    id: toolId,
    description: tool.description || '',
    inputSchema: coerceToolInputSchema(inputSchema),
    outputSchema,
    execute: async (args: any, ctx: any) => {
      const normalizedArgs = normalizeToolInputForSchema(inputSchema, args);
      if (bridgeWs && bridgeWs.readyState === 1) {
        const activeBridgeScope = setActiveBridge(bridgeWs, bridgeSecrets);
        try {
          if (localToolSpec) {
            const workflowToolSpec = typeof localToolSpec.timeoutMs === 'undefined'
              ? { ...localToolSpec, timeoutMs: DEFAULT_WORKFLOW_LOCAL_TOOL_TIMEOUT_MS }
              : localToolSpec;
            return await execLocalToolWithCapturedBridge(
              toolId,
              normalizedArgs,
              ctx?.writer,
              workflowToolSpec,
              { ws: bridgeWs, secrets: bridgeSecrets },
            );
          }
          return await withActiveBridgeContext(
            bridgeWs,
            bridgeSecrets,
            () => withClientBridge(bridgeWs, () => originalExecute(normalizedArgs, ctx), bridgeSecrets),
          );
        } finally {
          clearActiveBridge(activeBridgeScope);
        }
      }

      if (bridgeSecrets) {
        const secretsScope = setActiveBridge(null, bridgeSecrets);
        try {
          return await runWithSecrets(bridgeSecrets, () => originalExecute(normalizedArgs, ctx));
        } finally {
          clearActiveBridge(secretsScope);
        }
      }

      return originalExecute(normalizedArgs, ctx);
    },
  });
}

function buildWorkflowTools(options: WorkflowAgentOptions): Record<string, any> {
  const baseTools: Record<string, any> = {};

  // DELEGATE MODE (invoked from main chat) sets includeCreateWorkflow. The studio
  // architect does not. Tools that only make sense when driving workflows FROM
  // chat — bootstrapping/finding a flow (create/load/search_workflows) and
  // running them (deploy/stop) — are delegate-only. The studio agent builds and
  // tests on the canvas; deploy/stop/search live on the main-chat path.
  const isDelegate = !!options.includeCreateWorkflow;
  if (isDelegate) {
    // Bootstrap + discover a flow to act on (studio loads via the UI instead).
    baseTools.create_workflow = createLoggedTool(createWorkflowTool, 'create_workflow');
    baseTools.load_workflow = createLoggedTool(loadWorkflow, 'load_workflow');
    baseTools.search_workflows = createLoggedTool(searchWorkflows, 'search_workflows');
    // Run/stop saved automations — main-chat capability, not a studio concern.
    baseTools.deploy_workflow = createLoggedTool(deployWorkflow, 'deploy_workflow');
    baseTools.stop_automation = createLoggedTool(stop_automation, 'stop_automation');
  }

  Object.assign(baseTools, {
    // Search workflow nodes — fresh dedup set per session (won't repeat same node)
    search_workflow_nodes: createLoggedTool(
      createSearchWorkflowNodesTool({ seen: new Set<string>() }),
      'search_workflow_nodes',
    ),
    // Search workflow docs — fetch ON-DEMAND reference sections (custom_ui,
    // streams, agent_nodes, advanced variants). Core docs are inlined in the prompt.
    search_workflow_docs: createLoggedTool(
      createSearchWorkflowDocsTool({ seen: new Set<string>() }),
      'search_workflow_docs',
    ),
    // Get tool schema (exact args for a chosen node/tool)
    get_tool_schema: createLoggedTool(retrieveToolFormat, 'get_tool_schema'),
    // Read workflow as compact DSL (outline | window | full) — the lean read path.
    // validate:true folds in the old inspect_workflow topology check + .stuard reads.
    read_workflow: createLoggedTool(readWorkflow, 'read_workflow'),
    // Edit workflow via DSL find/replace — the lean edit path
    edit_workflow: createLoggedTool(editWorkflow, 'edit_workflow'),
    // Modify workflow (structured ops)
    modify_workflow: createLoggedTool(workflowModifyTool, 'modify_workflow'),
    // Execute step — ONE unified tester: { tool, args } runs one node;
    // { steps:[...] } runs a sequence/path with shared context (see tools.ts).
    execute_step: createLoggedTool(executeStep, 'execute_step'),
    // Web: find pages, then read a specific one's content.
    web_search: createLoggedTool(web_search, 'web_search'),
    scrape_url: createLoggedTool(scrape_url, 'scrape_url'),
    // Create/write files in the workspace or on disk
    write_file: createLoggedTool(write_file, 'write_file'),
    // Read files (workspace scripts/data/sub-workflows, or any path)
    read_file: createLoggedTool(read_file, 'read_file'),
    // List directory contents (e.g. the workflow workspace)
    list_directory: createLoggedTool(list_directory, 'list_directory'),
    // Create directories
    create_directory: createLoggedTool(create_directory, 'create_directory'),
    // Edit non-stuard files (string-based find/replace)
    file_edit: createLoggedTool(file_edit, 'file_edit'),
  });

  for (const [name, tool] of Object.entries(options.extraTools || {})) {
    baseTools[name] = createLoggedTool(tool, name);
  }

  const bridgeWs = options.bridgeWs || getBridgeWs();
  const bridgeSecrets = options.bridgeSecrets || getBridgeSecrets();
  if (!bridgeWs && !bridgeSecrets) return baseTools;

  const wrapped: Record<string, any> = {};
  for (const [name, tool] of Object.entries(baseTools)) {
    wrapped[name] = wrapWorkflowToolWithBridge(tool, bridgeWs, bridgeSecrets);
  }
  return wrapped;
}

/**
 * Get the Workflow Agent configured with Gemini 3 Pro Preview.
 */
export function getWorkflowAgent(modelIdOrOptions?: string | WorkflowAgentOptions): Agent {
  const options = normalizeWorkflowAgentOptions(modelIdOrOptions);
  const modelId =
    (typeof options.modelId === 'string' && options.modelId.trim())
      ? options.modelId.trim()
      : (process.env.WORKFLOW_MODEL_ID || 'google/gemini-3-pro-preview');

  const provider = String(modelId.split('/')[0] || '').toLowerCase();

  if (!options.modelInstance && provider === 'google' && !GOOGLE_API_KEY && !OPENROUTER_API_KEY) {
    workflowAgentLog('error', { message: 'GOOGLE_GENERATIVE_AI_API_KEY/GEMINI_API_KEY or OPENROUTER_API_KEY not set', modelId });
    throw new Error('GOOGLE_GENERATIVE_AI_API_KEY, GEMINI_API_KEY, or OPENROUTER_API_KEY is required for google workflow models');
  }
  if (!options.modelInstance && provider === 'openai' && !OPENAI_API_KEY && !OPENROUTER_API_KEY) {
    workflowAgentLog('error', { message: 'OPENAI_API_KEY or OPENROUTER_API_KEY not set', modelId });
    throw new Error('OPENAI_API_KEY or OPENROUTER_API_KEY is required for openai workflow models');
  }
  if (!options.modelInstance && provider === 'xai' && !XAI_API_KEY && !OPENROUTER_API_KEY) {
    workflowAgentLog('error', { message: 'XAI_API_KEY or OPENROUTER_API_KEY not set', modelId });
    throw new Error('XAI_API_KEY or OPENROUTER_API_KEY is required for xai workflow models');
  }
  if (!options.modelInstance && provider === 'deepseek' && !DEEPSEEK_API_KEY && !OPENROUTER_API_KEY) {
    workflowAgentLog('error', { message: 'DEEPSEEK_API_KEY or OPENROUTER_API_KEY not set', modelId });
    throw new Error('DEEPSEEK_API_KEY or OPENROUTER_API_KEY is required for deepseek workflow models');
  }
  if (!options.modelInstance && provider === 'perplexity' && !PERPLEXITY_API_KEY) {
    workflowAgentLog('error', { message: 'PERPLEXITY_API_KEY not set', modelId });
    throw new Error('PERPLEXITY_API_KEY is required for perplexity workflow models');
  }

  const model = options.modelInstance || buildProviderModel(modelId);
  if (!model) {
    workflowAgentLog('error', { message: 'Failed to build provider model', modelId });
    throw new Error(`Unsupported workflow modelId: ${modelId}`);
  }

  workflowAgentLog('init', { model: modelId });

  const tools = buildWorkflowTools(options);
  const toolNames = Object.keys(tools);
  // EDIT MODE: slim prompt + only the lean edit tools are shown to the model.
  // The full tool universe is still built (above) so execution never fails with
  // "tool not found"; we only restrict the schemas the model SEES via activeTools.
  const baseInstructions = options.editMode ? WORKFLOW_EDIT_SYSTEM_PROMPT : WORKFLOW_SYSTEM_PROMPT;
  const instructions = options.instructionsSuffix
    ? `${baseInstructions}\n\n${options.instructionsSuffix}`
    : baseInstructions;
  // Only expose lean-set tools that actually exist on this agent (e.g. omit
  // create_workflow which isn't built in studio mode).
  const editActiveToolNames = WORKFLOW_EDIT_TOOL_NAMES.filter((n) => toolNames.includes(n));
  const activeToolNames = options.editMode && editActiveToolNames.length > 0
    ? editActiveToolNames
    : toolNames;

  // Determine if we should use thinking mode. Keep thought text out of the
  // stream by default; exposing it can dominate workflow-agent token usage
  // without improving the edited workflow.
  //
  // CRITICAL token lever: this wrapper OVERRIDES whatever reasoning the caller
  // passed. The studio UI defaults selectedReasoningLevel='high', which
  // agent-runner otherwise translates into the MAX thinking budget/level +
  // includeThoughts:true — verbose streamed reasoning that is the single
  // biggest token sink for one build (see project_workflow_token_blowup_levers).
  // The workflow architect does mechanical DSL edits, so cap it. We cover both
  // Gemini 3 (thinkingLevel) and Gemini 2.5 (thinkingBudget) because the
  // resolved model can be either — previously only gemini-3 was capped, so a
  // gemini-2.5 fallback silently ran at full 'high' thinking + visible thoughts.
  const isGoogle = provider === 'google';
  const isGemini3 = isGoogle && modelId.includes('gemini-3');
  const isGemini25 = isGoogle && modelId.includes('gemini-2.5');
  const useThinking = isGemini3 || isGemini25;
  const includeThoughts = String(process.env.WORKFLOW_INCLUDE_THOUGHTS || '').toLowerCase() === 'true';
  // Edit-mode tweaks are small/targeted — default to low thinking (the −15%
  // lever) so simple edits don't pay a deep reasoning tax every step.
  const thinkingLevel = options.editMode
    ? (process.env.WORKFLOW_EDIT_THINKING_LEVEL || 'low')
    : (process.env.WORKFLOW_THINKING_LEVEL || 'medium');
  // Gemini 2.5 has no thinkingLevel — it takes an integer token budget. Keep it
  // modest (well under agent-runner's 24576 'high' budget) so the fallback model
  // doesn't blow the build budget. Edit gets less; build gets some headroom.
  const thinkingBudget = options.editMode
    ? Number(process.env.WORKFLOW_EDIT_THINKING_BUDGET || 2048)
    : Number(process.env.WORKFLOW_THINKING_BUDGET || 8192);
  const leanThinkingConfig: Record<string, any> = isGemini3
    ? { includeThoughts, thinkingLevel }
    : { includeThoughts, thinkingBudget };

  // Create agent with enhanced logging
  const agent = new Agent({
    id: options.id || 'workflow-architect',
    name: options.name || 'workflow-architect',
    instructions,
    model: model as any,
    tools,
  });

  (agent as any).__activeToolNames = activeToolNames;
  (agent as any).__editMode = !!options.editMode;
  (agent as any).__modelSource = (model as any)?.__stuardResolvedSource;
  (agent as any).__billingExcluded = !!(model as any)?.__stuardBillingExcluded;

  // Add message logging and inject providerOptions for thinking at stream level
  const originalStream = agent.stream.bind(agent);
  (agent as any).stream = async (input: any, options?: any) => {
    console.log('[workflow-agent] Input message:', compactForLog(input, 6000));
    
    // Inject the lean thinkingConfig at the stream call level for Gemini models,
    // overriding any reasoning the caller (agent-runner) set from the UI level.
    const mergedOptions = useThinking
      ? {
          ...options,
          providerOptions: {
            ...options?.providerOptions,
            google: {
              ...options?.providerOptions?.google,
              thinkingConfig: leanThinkingConfig,
            },
          },
        }
      : options;
    
    const result = await originalStream(input, mergedOptions);
    return result;
  };

  return agent;
}

export async function getWorkflowAgentForUser(
  modelIdOrOptions?: string | (WorkflowAgentOptions & {
    userId?: string | null;
    modelSource?: ModelSourcePreference | string | null;
  }),
): Promise<Agent> {
  const options = normalizeWorkflowAgentOptions(modelIdOrOptions as any) as WorkflowAgentOptions & {
    userId?: string | null;
    modelSource?: ModelSourcePreference | string | null;
  };
  const modelId =
    (typeof options.modelId === 'string' && options.modelId.trim())
      ? options.modelId.trim()
      : (process.env.WORKFLOW_MODEL_ID || 'google/gemini-3-pro-preview');
  const resolved = await buildProviderModelForUser(options.userId, modelId, options.modelSource);
  if (!resolved?.model) {
    throw new Error(`Unsupported workflow modelId: ${modelId}`);
  }
  return getWorkflowAgent({ ...options, modelId, modelInstance: resolved.model });
}

// Re-export tools for external use
export { executeStep, searchWorkflows, inspectWorkflow, loadWorkflow } from './tools';
export { searchWorkflowDocs } from './docs';
export { deployWorkflow } from './deploy';
export { workflowModifyTool } from '../../tools/workflow';
