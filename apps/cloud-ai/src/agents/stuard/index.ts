import { Agent } from '@mastra/core/agent';
import type { ModelChoice } from '../../router/model-router';
import { SYSTEM_INSTRUCTIONS } from './prompts';
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
  const tools = getTools(enabledIntegrations, mcpTools);
  const selectedModel = getModel(model, modelId);
  const name = getAgentName(model);

  const instructions = [
    {
      role: 'system',
      content: SYSTEM_INSTRUCTIONS,
      providerOptions: {
        anthropic: { cacheControl: { type: 'ephemeral' } },
      },
    },
  ];

  // Note: Memory with LibSQLStore removed to allow parallel request processing.
  // SQLite file locking was causing requests to serialize (stuck at "routing").
  // The server already manages conversation history via the conversations WeakMap
  // and passes full history in inputMessages, so agent-level memory is redundant.
  return new Agent({
    id: name,
    name,
    instructions: instructions as any,
    model: selectedModel as any,
    tools,
  });
}

export async function getAgentForQuery(
  model: ModelChoice,
  query: string,
  effort?: 'low' | 'medium' | 'high',
  enabledIntegrations: string[] = [],
  mcpTools: Record<string, any> = {},
  modelId?: string
): Promise<Agent> {
  const tools = await getToolsForQuery(query, enabledIntegrations, mcpTools);
  const selectedModel = getModel(model, modelId);
  const name = getAgentName(model);

  const instructions = [
    {
      role: 'system',
      content: SYSTEM_INSTRUCTIONS,
      providerOptions: {
        anthropic: { cacheControl: { type: 'ephemeral' } },
      },
    },
  ];

  return new Agent({
    id: name,
    name,
    instructions: instructions as any,
    model: selectedModel as any,
    tools,
  });
}

export type { ModelChoice };
