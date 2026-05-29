import { DEFAULT_MAX_STEPS, MAX_STEPS_CAP } from '../../utils/config';
import type { AgentType } from './types';
import { isQuickChatRequest } from './quick-request';

interface ProviderOptionsArgs {
  agentType: AgentType;
  workflowModelId?: string;
  skillModelId?: string;
  chosenModelId?: string;
  modelSource?: string;
  modelLabel: string;
  msg: any;
}

export function resolveMaxSteps(msg: any, agentType: AgentType) {
  if (isQuickChatRequest(msg)) return 1;

  const requestedMaxSteps = msg?.maxSteps ?? msg?.limits?.maxSteps;
  let maxSteps = (agentType === 'workflow' || agentType === 'skill') ? 60 : DEFAULT_MAX_STEPS;

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
  // 0 = no timeout
  return 0;
}

type ReasoningLevel = 'none' | 'low' | 'medium' | 'high';

function normalizeReasoning(msg: any): ReasoningLevel {
  const raw = String(msg?.reasoningLevel || '').toLowerCase();
  if (raw === 'none' || raw === 'low' || raw === 'medium' || raw === 'high') return raw;
  return 'high';
}

/** First path segment of "provider/...". Lowercased; empty when no slash. */
function prefixOf(id: string): string {
  const idx = id.indexOf('/');
  if (idx <= 0) return '';
  return id.slice(0, idx).toLowerCase();
}

/** Last path segment, used to apply model-family-specific caps (e.g. gpt-5.1). */
function tailOf(id: string): string {
  if (!id) return '';
  return id.split('/').pop() || '';
}

export function buildProviderOptions({
  agentType,
  workflowModelId,
  skillModelId,
  chosenModelId,
  modelSource,
  modelLabel,
  msg,
}: ProviderOptionsArgs) {
  const providerOptions: any = {};
  const reasoningLevel = normalizeReasoning(msg);

  // Pick the id we should route from. Workflow/skill architects use their
  // dedicated model ids; everything else uses chosenModelId. modelLabel is the
  // last-resort fallback (it can be just a tier string like "balanced").
  const effectiveId = (agentType === 'workflow' && workflowModelId)
    ? workflowModelId
    : (agentType === 'skill' && skillModelId)
      ? skillModelId
      : (chosenModelId || modelLabel || '');
  const prefix = prefixOf(effectiveId);

  // When the model is routed through OpenRouter, its SDK ignores per-provider
  // option keys (anthropic/openai/google/etc.) — we must use the openrouter
  // namespace with the unified `reasoning` field. The actual sub-provider lives
  // in the second path segment (e.g. "openrouter/anthropic/claude-...").
  if (prefix === 'openrouter') {
    // OpenRouter accepts effort values 'xhigh' | 'high' | 'medium' | 'low' | 'minimal' | 'none'.
    // Our four levels map directly; we also set `enabled: false` for 'none' so
    // providers that don't honor `effort: 'none'` still skip reasoning.
    const effortMap: Record<ReasoningLevel, 'none' | 'low' | 'medium' | 'high'> = {
      none: 'none',
      low: 'low',
      medium: 'medium',
      high: 'high',
    };
    providerOptions.openrouter = {
      reasoning: reasoningLevel === 'none'
        ? { enabled: false, effort: 'none' }
        : { enabled: true, effort: effortMap[reasoningLevel] },
    };
    return providerOptions;
  }

  // ---------- Google Gemini thinking ----------
  // Gemini 2.5 uses `thinkingBudget` (integer tokens); Gemini 3 uses `thinkingLevel`.
  // Sending the wrong field — or sending `thinkingLevel: 'none'` — is rejected by
  // the API, so each branch must build its own config.
  if (prefix === 'google') {
    const tail = tailOf(effectiveId);
    const isGemini25 = tail.includes('gemini-2.5');
    const isGemini3 = tail.includes('gemini-3');
    if (isGemini25) {
      const gemini25Budget: Record<ReasoningLevel, number> = {
        none: 0,
        low: 1024,
        medium: 8192,
        high: 24576,
      };
      providerOptions.google = {
        thinkingConfig: {
          thinkingBudget: gemini25Budget[reasoningLevel],
          includeThoughts: reasoningLevel !== 'none',
        },
      };
    } else if (isGemini3 && reasoningLevel !== 'none') {
      providerOptions.google = {
        thinkingConfig: {
          thinkingLevel: reasoningLevel,
          includeThoughts: true,
        },
      };
    }
    // Gemini 3 has no documented "off" — omit thinkingConfig and let the
    // model decide rather than sending the invalid `thinkingLevel: 'none'`.
  }

  // ---------- Anthropic extended thinking ----------
  if (prefix === 'anthropic') {
    if (reasoningLevel === 'none') {
      providerOptions.anthropic = { thinking: { type: 'disabled' } };
    } else {
      const anthropicBudget: Record<Exclude<ReasoningLevel, 'none'>, number | undefined> = {
        low: 5000,
        medium: 16384,
        high: undefined,
      };
      const budgetTokens = anthropicBudget[reasoningLevel];
      providerOptions.anthropic = {
        sendReasoning: true,
        thinking: budgetTokens ? { type: 'enabled', budgetTokens } : { type: 'enabled' },
      };
    }
  }

  // ---------- OpenAI reasoning effort (Responses API) ----------
  if (prefix === 'openai' || prefix === 'penai' /* typo-tolerant alias */) {
    const tail = tailOf(effectiveId);
    const supportsEffort = /^(o[1-9]|gpt-5(?:$|[-.]))/.test(tail);
    if (supportsEffort) {
      // gpt-5.1 caps reasoning effort at 'medium'; everything else allows 'high'.
      const maxEffort: 'medium' | 'high' = /^gpt-5\.1/.test(tail) ? 'medium' : 'high';
      const order: ReasoningLevel[] = ['none', 'low', 'medium', 'high'];
      const clampedEffort = order.indexOf(reasoningLevel) > order.indexOf(maxEffort)
        ? maxEffort
        : reasoningLevel;
      if (clampedEffort !== 'none') {
        providerOptions.openai = {
          reasoningEffort: clampedEffort,
          // Without `reasoningSummary` the Responses API streams no reasoning
          // chunks at all; gpt-5.4 supports the richer 'detailed' summary.
          reasoningSummary: /^gpt-5\.4/.test(tail) ? 'detailed' : 'auto',
        };
      }
    }
  }

  // ---------- xAI / Grok reasoning ----------
  if (prefix === 'xai') {
    const tail = tailOf(effectiveId);
    const supportsReasoning = !tail.includes('non-reasoning');
    if (supportsReasoning && reasoningLevel !== 'none') {
      // xAI Chat API only supports 'low' | 'high'; 'medium' collapses to 'high'.
      const xaiEffort: 'low' | 'high' = reasoningLevel === 'low' ? 'low' : 'high';
      providerOptions.xai = { reasoningEffort: xaiEffort };
    }
  }

  // ---------- DeepSeek thinking ----------
  if (prefix === 'deepseek') {
    providerOptions.deepseek = {
      thinking: { type: reasoningLevel === 'none' ? 'disabled' : 'enabled' },
    };
  }

  // Codex (ChatGPT-plan subscription) requires stateless serialization regardless
  // of the underlying OpenAI model. This stacks onto any reasoningEffort set above.
  const usesCodexSubscription =
    modelSource === 'subscription'
    || chosenModelId?.startsWith('codex/')
    || modelLabel.startsWith('codex/');

  if (usesCodexSubscription) {
    providerOptions.openai = {
      ...(providerOptions.openai || {}),
      store: false,
    };
  }

  return providerOptions;
}
