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
import { createSearchToolsTool, createSearchWorkflowNodesTool } from '../../tools/meta-tools';
import { createWorkflowTool, retrieveToolFormat } from '../../tools/workflow-system';
import { workflowModifyTool } from '../../tools/workflow';
import { stop_automation, write_file, create_directory, read_file, list_directory } from '../../tools/device-tools';
import { file_edit } from '../../tools/agentic-file-tools';
import { web_search } from '../../tools/perplexity-tools';
import { getBridgeSecrets, getBridgeWs, runWithSecrets, withClientBridge } from '../../tools/bridge';
import {
  clearActiveBridge,
  execLocalToolWithCapturedBridge,
  getLocalToolSpec,
  setActiveBridge,
  withActiveBridgeContext,
} from '../../tools/device/shared';
import { executeStep, searchWorkflows, inspectWorkflow, loadWorkflow } from './tools';
import { deployWorkflow } from './deploy';
import { WORKFLOW_SYSTEM_PROMPT } from './system-prompt';
import { normalizeToolInputForSchema, coerceToolInputSchema } from '../../tools/zod-utils';

const GOOGLE_API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const XAI_API_KEY = process.env.XAI_API_KEY || '';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY || '';
// Gemini/GPT/Grok/DeepSeek are served through Stuard's OpenRouter account, so an
// OpenRouter key satisfies the native-provider requirement (see buildProviderModel).
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';

export { WORKFLOW_SYSTEM_PROMPT };

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

  if (options.includeCreateWorkflow) {
    baseTools.create_workflow = createLoggedTool(createWorkflowTool, 'create_workflow');
  }

  Object.assign(baseTools, {
    // (Docs are inlined in the system prompt — no search_workflow_docs tool.)
    // 2. Search workflow nodes — fresh dedup set per session (won't repeat same node)
    search_workflow_nodes: createLoggedTool(
      createSearchWorkflowNodesTool({ seen: new Set<string>() }),
      'search_workflow_nodes',
    ),
    // 3. Search tools (workflow surface — sees workflow-only tools, hides chat-only like chat_ui)
    search_tools: createLoggedTool(createSearchToolsTool('workflow'), 'search_tools'),
    // 4. Get tool schema
    get_tool_schema: createLoggedTool(retrieveToolFormat, 'get_tool_schema'),
    // 5. Inspect workflow topology
    inspect_workflow: createLoggedTool(inspectWorkflow, 'inspect_workflow'),
    // 5b. Load an existing saved workflow into session for editing
    load_workflow: createLoggedTool(loadWorkflow, 'load_workflow'),
    // 6. Modify workflow
    modify_workflow: createLoggedTool(workflowModifyTool, 'modify_workflow'),
    // 7. Execute step (sis execute)
    execute_step: createLoggedTool(executeStep, 'execute_step'),
    // 8. Search workflows
    search_workflows: createLoggedTool(searchWorkflows, 'search_workflows'),
    // 9. Stop workflow (canonical name - matches the delegate pack)
    stop_automation: createLoggedTool(stop_automation, 'stop_automation'),
    // 10. Web search
    web_search: createLoggedTool(web_search, 'web_search'),
    // 11. Create/write files in the workspace or on disk
    write_file: createLoggedTool(write_file, 'write_file'),
    // 11b. Read files (workspace scripts/data/sub-workflows, or any path)
    read_file: createLoggedTool(read_file, 'read_file'),
    // 11c. List directory contents (e.g. the workflow workspace)
    list_directory: createLoggedTool(list_directory, 'list_directory'),
    // 12. Create directories
    create_directory: createLoggedTool(create_directory, 'create_directory'),
    // 13. Edit non-stuard files (string-based find/replace)
    file_edit: createLoggedTool(file_edit, 'file_edit'),
    // 14. Deploy workflow to desktop and/or VM targets
    deploy_workflow: createLoggedTool(deployWorkflow, 'deploy_workflow'),
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
  const instructions = options.instructionsSuffix
    ? `${WORKFLOW_SYSTEM_PROMPT}\n\n${options.instructionsSuffix}`
    : WORKFLOW_SYSTEM_PROMPT;

  // Determine if we should use thinking mode. Keep thought text out of the
  // stream by default; exposing it can dominate workflow-agent token usage
  // without improving the edited workflow.
  const useThinking = provider === 'google' && modelId.includes('gemini-3');
  const includeThoughts = String(process.env.WORKFLOW_INCLUDE_THOUGHTS || '').toLowerCase() === 'true';
  const thinkingLevel = process.env.WORKFLOW_THINKING_LEVEL || 'medium';

  // Create agent with enhanced logging
  const agent = new Agent({
    id: options.id || 'workflow-architect',
    name: options.name || 'workflow-architect',
    instructions,
    model: model as any,
    tools,
  });

  (agent as any).__activeToolNames = toolNames;
  (agent as any).__modelSource = (model as any)?.__stuardResolvedSource;
  (agent as any).__billingExcluded = !!(model as any)?.__stuardBillingExcluded;

  // Add message logging and inject providerOptions for thinking at stream level
  const originalStream = agent.stream.bind(agent);
  (agent as any).stream = async (input: any, options?: any) => {
    console.log('[workflow-agent] Input message:', compactForLog(input, 6000));
    
    // Inject thinkingConfig at the stream call level for Gemini 3 models
    const mergedOptions = useThinking
      ? {
          ...options,
          providerOptions: {
            ...options?.providerOptions,
            google: {
              ...options?.providerOptions?.google,
              thinkingConfig: {
                includeThoughts,
                thinkingLevel,
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
