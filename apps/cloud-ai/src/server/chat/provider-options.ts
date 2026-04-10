import { DEFAULT_MAX_STEPS, MAX_STEPS_CAP } from '../../utils/config';
import type { AgentType } from './types';

interface ProviderOptionsArgs {
  agentType: AgentType;
  workflowModelId?: string;
  chosenModelId?: string;
  modelLabel: string;
  msg: any;
}

export function resolveMaxSteps(msg: any, agentType: AgentType) {
  const requestedMaxSteps = msg?.maxSteps ?? msg?.limits?.maxSteps;
  let maxSteps = agentType === 'workflow' ? 60 : DEFAULT_MAX_STEPS;

  try {
    const parsed = Number(requestedMaxSteps);
    if (!Number.isNaN(parsed) && parsed > 0) {
      maxSteps = Math.min(parsed, MAX_STEPS_CAP);
    }
  } catch { }

  return maxSteps;
}

export function getHardTimeoutMs(agentType: AgentType) {
  const raw = Number(process.env.CLOUD_CHAT_HARD_TIMEOUT_MS || process.env.CLOUD_STREAM_HARD_TIMEOUT_MS || '');
  if (!Number.isNaN(raw) && raw > 0) {
    return raw;
  }
  return agentType === 'workflow' ? 12 * 60 * 1000 : 8 * 60 * 1000;
}

export function buildProviderOptions({
  agentType,
  workflowModelId,
  chosenModelId,
  modelLabel,
  msg,
}: ProviderOptionsArgs) {
  const providerOptions: any = {};
  const reasoningLevel = ['none', 'low', 'medium', 'high'].includes(String(msg?.reasoningLevel || ''))
    ? String(msg.reasoningLevel)
    : 'high';

  const isGeminiThinking =
    (agentType === 'workflow'
      && typeof workflowModelId === 'string'
      && (workflowModelId.includes('google/gemini-3') || workflowModelId.includes('google/gemini-2.5')))
    || chosenModelId?.includes('google/gemini-3')
    || chosenModelId?.includes('google/gemini-2.5')
    || modelLabel.includes('google/gemini-3')
    || modelLabel.includes('gemini-3')
    || modelLabel.includes('google/gemini-2.5')
    || modelLabel.includes('gemini-2.5');

  if (isGeminiThinking) {
    providerOptions.google = {
      thinkingConfig: {
        includeThoughts: reasoningLevel !== 'none',
        thinkingLevel: reasoningLevel as 'none' | 'low' | 'medium' | 'high',
      },
    };
  }

  if (chosenModelId?.includes('anthropic/') || modelLabel.includes('anthropic/')) {
    if (reasoningLevel === 'none') {
      providerOptions.anthropic = {
        ...(providerOptions.anthropic || {}),
        thinking: { type: 'disabled' },
      };
    } else {
      const anthropicBudget: Record<string, number | undefined> = {
        low: 5000,
        medium: 16384,
        high: undefined,
      };
      const budgetTokens = anthropicBudget[reasoningLevel];
      providerOptions.anthropic = {
        ...(providerOptions.anthropic || {}),
        sendReasoning: true,
        thinking: budgetTokens ? { type: 'enabled', budgetTokens } : { type: 'enabled' },
      };
    }
  }

  if (chosenModelId?.includes('openai/') || modelLabel.includes('openai/')) {
    const modelPart = (chosenModelId || modelLabel || '').split('/').pop() || '';
    const supportsEffort = /^(o[1-9]|gpt-5-pro|gpt-5\.1)/.test(modelPart);
    if (supportsEffort && reasoningLevel !== 'none') {
      providerOptions.openai = {
        ...(providerOptions.openai || {}),
        reasoningEffort: reasoningLevel as 'low' | 'medium' | 'high',
      };
    }
  }

  return providerOptions;
}
