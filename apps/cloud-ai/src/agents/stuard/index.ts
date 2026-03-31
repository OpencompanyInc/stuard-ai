import { Agent } from '@mastra/core/agent';
import type { ModelChoice } from '../../router/model-router';
import { buildSystemInstructions } from './prompts';
import { getTools, getToolsForQuery } from './tools';
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
  modelId?: string
): Agent {
  const tools = getTools(enabledIntegrations, mcpTools, modelId);
  const selectedModel = getModel(model, modelId);
  const name = getAgentName(model);

  const instructions = [
    {
      role: 'system',
      content: buildSystemInstructions(enabledIntegrations),
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
    tools,
  });
  // Attach metadata for token diagnostics (Mastra doesn't expose these publicly)
  (agent as any).__diagTools = tools;
  (agent as any).__diagInstructions = instructions;
  return agent;
}

export async function getAgentForQuery(
  model: ModelChoice,
  query: string,
  effort?: 'low' | 'medium' | 'high',
  enabledIntegrations: string[] = [],
  mcpTools: Record<string, any> = {},
  modelId?: string,
  rankedToolNames?: string[]
): Promise<Agent> {
  const tools = await getToolsForQuery(query, enabledIntegrations, mcpTools, modelId, rankedToolNames);
  const selectedModel = getModel(model, modelId);
  const name = getAgentName(model);

  const instructions = [
    {
      role: 'system',
      content: buildSystemInstructions(enabledIntegrations),
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
    tools,
  });
  (agent as any).__diagTools = tools;
  (agent as any).__diagInstructions = instructions;
  return agent;
}

export type { ModelChoice };

