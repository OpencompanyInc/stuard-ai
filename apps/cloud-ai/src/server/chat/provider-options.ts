import { DEFAULT_MAX_STEPS, MAX_STEPS_CAP } from '../../utils/config';
import type { AgentType } from './types';
import { isQuickChatRequest } from './quick-request';
import {
  clampEffortToControl,
  heuristicReasoningControl,
  resolveEffectiveReasoning,
  type EffectiveReasoning,
  type ReasoningEffort,
  type RequestedReasoning,
} from '../../utils/reasoning-capability';

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

function normalizeReasoning(msg: any): RequestedReasoning {
  const raw = String(msg?.reasoningLevel || '').toLowerCase();
  if (
    raw === 'none' || raw === 'minimal' || raw === 'low' ||
    raw === 'medium' || raw === 'high' || raw === 'xhigh'
  ) {
    return raw;
  }
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

/**
 * Native id prefixes that Stuard serves through OpenRouter (see
 * buildProviderModel). When such a model resolves to Stuard-serving
 * ('friendly'), it's transported through OpenRouter — whose SDK only reads the
 * `openrouter` option namespace — so its reasoning controls must be emitted
 * there, exactly like an `openrouter/*` id. BYOK ('byok') and ChatGPT plan
 * ('subscription') keep the native transport, so they still use the native
 * namespaces below. Perplexity keeps its native key, so it's excluded.
 */
const OPENROUTER_SERVED_PREFIXES = new Set(['openai', 'penai', 'google', 'anthropic', 'deepseek', 'xai']);

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
  const requested = normalizeReasoning(msg);

  // Pick the id we should route from. Workflow/skill architects use their
  // dedicated model ids; everything else uses chosenModelId. modelLabel is the
  // last-resort fallback (it can be just a tier string like "balanced").
  const effectiveId = (agentType === 'workflow' && workflowModelId)
    ? workflowModelId
    : (agentType === 'skill' && skillModelId)
      ? skillModelId
      : (chosenModelId || modelLabel || '');
  const prefix = prefixOf(effectiveId);

  // Reconcile the requested level with what this model can actually do: turn
  // `none` into the model's default when it can't be disabled, and let the
  // per-provider mapping below translate the surviving effort tier. `effective`
  // is one of 'none' (off) | 'default' (on, model-chosen) | an effort tier.
  const control = heuristicReasoningControl(effectiveId);
  const effective: EffectiveReasoning = resolveEffectiveReasoning(requested, control);

  // When the model is routed through OpenRouter, its SDK ignores per-provider
  // option keys (anthropic/openai/google/etc.) — we must use the openrouter
  // namespace with the unified `reasoning` field. This covers explicit
  // `openrouter/*` ids AND bare native ids that resolved to Stuard-serving
  // ('friendly'), which buildProviderModel now transports through OpenRouter.
  const openRouterTransported = prefix === 'openrouter'
    || (modelSource === 'friendly' && OPENROUTER_SERVED_PREFIXES.has(prefix));
  if (openRouterTransported) {
    // OpenRouter accepts effort values 'xhigh' | 'high' | 'medium' | 'low' | 'minimal' | 'none'.
    // Clamp the tier into the model's supported ladder so we never send an
    // effort it would reject; 'default' enables reasoning without pinning a tier.
    if (effective === 'none') {
      providerOptions.openrouter = { reasoning: { enabled: false, effort: 'none' } };
    } else if (effective === 'default') {
      providerOptions.openrouter = { reasoning: { enabled: true } };
    } else {
      providerOptions.openrouter = {
        reasoning: { enabled: true, effort: clampEffortToControl(effective, control) },
      };
    }
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
      if (effective === 'none') {
        providerOptions.google = { thinkingConfig: { thinkingBudget: 0, includeThoughts: false } };
      } else if (effective === 'default') {
        // Can't disable (e.g. 2.5 Pro): leave the budget to the model.
        providerOptions.google = { thinkingConfig: { includeThoughts: true } };
      } else {
        const gemini25Budget: Record<ReasoningEffort, number> = {
          minimal: 512,
          low: 1024,
          medium: 8192,
          high: 24576,
          xhigh: 24576,
        };
        providerOptions.google = {
          thinkingConfig: { thinkingBudget: gemini25Budget[effective], includeThoughts: true },
        };
      }
    } else if (isGemini3 && effective !== 'none' && effective !== 'default') {
      // Gemini 3 thinkingLevel accepts low/medium/high; fold the extremes in.
      const gemini3Level: Record<ReasoningEffort, 'low' | 'medium' | 'high'> = {
        minimal: 'low',
        low: 'low',
        medium: 'medium',
        high: 'high',
        xhigh: 'high',
      };
      providerOptions.google = {
        thinkingConfig: { thinkingLevel: gemini3Level[effective], includeThoughts: true },
      };
    }
    // Gemini 3 has no documented "off" — omit thinkingConfig (for 'none'/'default')
    // and let the model decide rather than sending an invalid thinkingLevel.
  }

  // ---------- Anthropic extended thinking ----------
  if (prefix === 'anthropic') {
    if (effective === 'none') {
      providerOptions.anthropic = { thinking: { type: 'disabled' } };
    } else {
      const anthropicBudget: Record<EffectiveReasoning, number | undefined> = {
        none: undefined,
        default: undefined,
        minimal: 3000,
        low: 5000,
        medium: 16384,
        high: undefined,
        xhigh: 32000,
      };
      const budgetTokens = anthropicBudget[effective];
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
    if (supportsEffort && effective !== 'none') {
      // OpenAI reasoningEffort accepts minimal|low|medium|high; xhigh folds to
      // high. gpt-5.1 caps at 'medium'; 'default' lands on a safe 'medium'.
      const maxEffort: 'medium' | 'high' = /^gpt-5\.1/.test(tail) ? 'medium' : 'high';
      const order: Array<'minimal' | 'low' | 'medium' | 'high'> = ['minimal', 'low', 'medium', 'high'];
      const base: 'minimal' | 'low' | 'medium' | 'high' =
        effective === 'default' ? 'medium' : effective === 'xhigh' ? 'high' : effective;
      const clampedEffort = order.indexOf(base) > order.indexOf(maxEffort) ? maxEffort : base;
      providerOptions.openai = {
        reasoningEffort: clampedEffort,
        // Without `reasoningSummary` the Responses API streams no reasoning
        // chunks at all; gpt-5.4 supports the richer 'detailed' summary.
        reasoningSummary: /^gpt-5\.4/.test(tail) ? 'detailed' : 'auto',
      };
    }
  }

  // ---------- xAI / Grok reasoning ----------
  if (prefix === 'xai') {
    const tail = tailOf(effectiveId);
    const supportsReasoning = !tail.includes('non-reasoning');
    if (supportsReasoning && effective !== 'none') {
      // xAI Chat API only supports 'low' | 'high'; everything above low → high.
      const xaiEffort: 'low' | 'high' = (effective === 'low' || effective === 'minimal') ? 'low' : 'high';
      providerOptions.xai = { reasoningEffort: xaiEffort };
    }
  }

  // ---------- DeepSeek thinking ----------
  if (prefix === 'deepseek') {
    providerOptions.deepseek = {
      thinking: { type: effective === 'none' ? 'disabled' : 'enabled' },
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
