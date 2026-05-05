import { Agent } from '@mastra/core/agent';
import type { ModelChoice } from '../../router/model-router';
import { buildSystemInstructions } from './prompts';
import type { SkillSummary } from '../../tools/skill-tools';
import { getTools, getToolsForQuery, getExecutionTools } from './tools';
import { getModel, getAgentName } from './models';

/**
 * Get agent configured for DeepSeek, Grok, and Google Gemini.
 * Model tiers:
 *   - fast: DeepSeek Chat (quick responses)
 *   - balanced: Grok 3 Mini Fast with exposed reasoning
 *   - smart: Gemini 3 Pro Preview (complex analysis)
 */
export function getAgent(
  model: ModelChoice,
  effort?: 'low' | 'medium' | 'high',
  enabledIntegrations: string[] = [],
  mcpTools: Record<string, any> = {},
  modelId?: string,
  skills: SkillSummary[] = []
): Agent {
  // Lean tool set — only these are shown to the LLM (via activeTools)
  const activeTools = getTools(enabledIntegrations, mcpTools, modelId);
  // Full tool universe — available for execution so Mastra never throws
  // "Tool X not found" when the model calls a lazy-loaded tool directly.
  const executionTools = getExecutionTools(mcpTools);
  const selectedModel = getModel(model, modelId);
  const name = getAgentName(model);

  const instructions = [
    {
      role: 'system',
      content: buildSystemInstructions(enabledIntegrations, skills),
      providerOptions: {
        anthropic: { cacheControl: { type: 'ephemeral' } },
      },
    },
  ];

  const agent = new Agent({
    id: name,
    name,
    instructions: instructions as any,
    model: selectedModel as any,
    tools: executionTools,
  });
  // Attach metadata for token diagnostics (Mastra doesn't expose these publicly)
  (agent as any).__diagTools = activeTools;
  (agent as any).__diagInstructions = instructions;
  // Names of tools the LLM should see — pass as `activeTools` in stream options
  (agent as any).__activeToolNames = Object.keys(activeTools);
  (agent as any).__executionToolNames = Object.keys(executionTools);
  return agent;
}

export async function getAgentForQuery(
  model: ModelChoice,
  query: string,
  effort?: 'low' | 'medium' | 'high',
  enabledIntegrations: string[] = [],
  mcpTools: Record<string, any> = {},
  modelId?: string,
  rankedToolNames?: string[],
  skills: SkillSummary[] = []
): Promise<Agent> {
  const activeTools = await getToolsForQuery(query, enabledIntegrations, mcpTools, modelId, rankedToolNames);
  const executionTools = getExecutionTools(mcpTools);
  const selectedModel = getModel(model, modelId);
  const name = getAgentName(model);

  const instructions = [
    {
      role: 'system',
      content: buildSystemInstructions(enabledIntegrations, skills),
      providerOptions: {
        anthropic: { cacheControl: { type: 'ephemeral' } },
      },
    },
  ];

  const agent = new Agent({
    id: name,
    name,
    instructions: instructions as any,
    model: selectedModel as any,
    tools: executionTools,
  });
  (agent as any).__diagTools = activeTools;
  (agent as any).__diagInstructions = instructions;
  (agent as any).__activeToolNames = Object.keys(activeTools);
  (agent as any).__executionToolNames = Object.keys(executionTools);
  return agent;
}

export type { ModelChoice };

