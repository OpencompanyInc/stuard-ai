import { Agent } from '@mastra/core/agent';

import { getModel, getModelForUser } from './stuard/models';
import type { ModelChoice } from '../router/model-router';
import type { ModelSourcePreference } from '../utils/models';
import { resolveExecutionTools } from '../orchestrator/execution-tools-resolver';
import { wrapToolWithBridge } from '../orchestrator/subagent-runtime';
import { getBridgeSecrets, getBridgeWs } from '../tools/bridge';
import { BOT_MEMORY_TOOL_NAMES, PROACTIVE_TASK_TOOL_NAMES } from '../tools/proactive-task-tools';

const BOT_INTERNAL_TOOL_NAMES = new Set<string>([
  ...PROACTIVE_TASK_TOOL_NAMES,
  ...BOT_MEMORY_TOOL_NAMES,
  'search_past_conversations',
  'get_conversation_context',
  'get_skill_info',
]);

function cleanToolNames(value: unknown): string[] {
  return Array.from(new Set(
    (Array.isArray(value) ? value : [])
      .map((tool) => String(tool || '').trim())
      .filter((tool) => tool && !isBlockedBotToolName(tool)),
  ));
}

function isBlockedBotToolName(name: string): boolean {
  const trimmed = String(name || '').trim();
  return trimmed.startsWith('browser_') && !trimmed.startsWith('browser_use_');
}

function isAddedBotTool(name: string, addedTools: string[]): boolean {
  if (BOT_INTERNAL_TOOL_NAMES.has(name)) return true;
  if (addedTools.includes(name)) return true;
  if (name === 'run_system_command' && addedTools.includes('run_command')) return true;
  return addedTools.some((allowed) => allowed.endsWith('_') && name.startsWith(allowed));
}

function buildBotToolSet(args: {
  botId?: string;
  allowedTools?: unknown;
  mcpTools?: Record<string, any>;
}): Record<string, any> {
  const executionTools = resolveExecutionTools(args.mcpTools || {});
  const addedTools = cleanToolNames(args.allowedTools);
  const bridgeWs = getBridgeWs();
  const bridgeSecrets = {
    ...(getBridgeSecrets() || {}),
    ...(args.botId ? { proactiveBotId: args.botId } : {}),
  };

  const selected: Record<string, any> = {};
  for (const [name, tool] of Object.entries(executionTools)) {
    if (!tool || typeof (tool as any).execute !== 'function') continue;
    if (!isAddedBotTool(name, addedTools)) continue;
    selected[name] = (bridgeWs || Object.keys(bridgeSecrets).length > 0)
      ? wrapToolWithBridge(tool, bridgeWs, bridgeSecrets)
      : tool;
  }
  return selected;
}

function buildBotSystemPrompt(args: {
  botId?: string;
  botName?: string;
  allowedTools?: unknown;
}): string {
  const botName = String(args.botName || 'Stuard bot').trim();
  const addedTools = cleanToolNames(args.allowedTools);
  const addedText = addedTools.length > 0 ? addedTools.join(', ') : '(none)';

  return `You are ${botName}, a standalone proactive bot running inside Stuard.

You are NOT the main Stuard chat agent. You do not inherit Stuard's global filesystem, terminal, browser, social, sub-agent, or automation capabilities.

Your tools are an addition set:
- Internal bot tools: proactive_task_*, bot_memory_*, search_past_conversations, get_conversation_context, get_skill_info.
- Added non-internal tools for this bot: ${addedText}.

All other tools are not part of this bot. If the user asks what tools you have, answer only from the two lists above. If the user asks you to change your kanban, call bot_memory_* and only claim success after the tool returns ok=true.`;
}

export function getBotAgent(args: {
  botId?: string;
  botName?: string;
  model: ModelChoice;
  modelId?: string;
  allowedTools?: unknown;
  mcpTools?: Record<string, any>;
}): Agent {
  const safeBotId = String(args.botId || args.botName || 'bot')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .slice(0, 80) || 'bot';
  const selectedTools = buildBotToolSet(args);
  const agent = new Agent({
    id: `stuard-bot-${safeBotId}`,
    name: args.botName ? `Stuard Bot: ${String(args.botName).slice(0, 80)}` : `Stuard Bot ${safeBotId}`,
    instructions: [{ role: 'system', content: buildBotSystemPrompt(args) }] as any,
    model: getModel(args.model, args.modelId) as any,
    tools: selectedTools,
  });

  (agent as any).__diagTools = selectedTools;
  (agent as any).__diagInstructions = [{ role: 'system', content: buildBotSystemPrompt(args) }];
  (agent as any).__activeToolNames = Object.keys(selectedTools);
  (agent as any).__executionToolNames = Object.keys(selectedTools);
  return agent;
}

export async function getBotAgentForUser(args: {
  botId?: string;
  botName?: string;
  model: ModelChoice;
  modelId?: string;
  modelSource?: ModelSourcePreference | string | null;
  userId?: string | null;
  allowedTools?: unknown;
  mcpTools?: Record<string, any>;
}): Promise<Agent> {
  const safeBotId = String(args.botId || args.botName || 'bot')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .slice(0, 80) || 'bot';
  const selectedTools = buildBotToolSet(args);
  const model = await getModelForUser(args.model, args.modelId, args.userId, args.modelSource);
  const instructions = [{ role: 'system', content: buildBotSystemPrompt(args) }] as any;
  const agent = new Agent({
    id: `stuard-bot-${safeBotId}`,
    name: args.botName ? `Stuard Bot: ${String(args.botName).slice(0, 80)}` : `Stuard Bot ${safeBotId}`,
    instructions,
    model: model as any,
    tools: selectedTools,
  });

  (agent as any).__diagTools = selectedTools;
  (agent as any).__diagInstructions = instructions;
  (agent as any).__activeToolNames = Object.keys(selectedTools);
  (agent as any).__executionToolNames = Object.keys(selectedTools);
  (agent as any).__modelSource = (model as any)?.__stuardResolvedSource;
  (agent as any).__billingExcluded = !!(model as any)?.__stuardBillingExcluded;
  return agent;
}
