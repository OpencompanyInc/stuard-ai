import type { ModelMeta } from '../hooks/usePreferences';

export interface ContextUsageMetrics {
  promptTokens: number;
  contextWindow?: number;
  percentage?: number;
  ratio?: number;
  modelId?: string;
  tone: 'safe' | 'warn' | 'danger' | 'unknown';
}

type UsageLike = Record<string, any> | null | undefined;

function readNumber(value: unknown): number | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  return Math.round(numeric);
}

export function getPromptTokens(usage: UsageLike): number | undefined {
  if (!usage || typeof usage !== 'object') return undefined;
  return readNumber(
    usage.promptTokens
    ?? usage.inputTokens
    ?? usage.prompt_tokens
    ?? usage.input_tokens
  );
}

export function resolveContextWindow(
  modelId: string | undefined,
  modelById?: Map<string, ModelMeta | { contextWindow?: number }>,
  fallbackContextWindow?: number,
): number | undefined {
  const direct = readNumber(fallbackContextWindow);
  if (direct) return direct;
  if (!modelId || !modelById) return undefined;
  const lookup = modelById.get(modelId);
  return readNumber(lookup?.contextWindow);
}

export function buildContextUsageMetrics(args: {
  usage: UsageLike;
  modelId?: string;
  contextWindow?: number;
  modelById?: Map<string, ModelMeta | { contextWindow?: number }>;
}): ContextUsageMetrics | null {
  const promptTokens = getPromptTokens(args.usage);
  if (!promptTokens) return null;

  const contextWindow = resolveContextWindow(args.modelId, args.modelById, args.contextWindow);
  if (!contextWindow) {
    return {
      promptTokens,
      modelId: args.modelId,
      tone: 'unknown',
    };
  }

  const ratio = Math.max(0, Math.min(1, promptTokens / contextWindow));
  const percentage = Math.round(ratio * 100);
  const tone = ratio >= 0.85 ? 'danger' : ratio >= 0.65 ? 'warn' : 'safe';

  return {
    promptTokens,
    contextWindow,
    percentage,
    ratio,
    modelId: args.modelId,
    tone,
  };
}

export function formatTokenCount(value: number | undefined): string {
  const count = readNumber(value);
  if (!count) return '0';
  if (count >= 1_000_000) {
    const millions = count / 1_000_000;
    return `${millions >= 10 ? Math.round(millions) : millions.toFixed(1)}M`;
  }
  if (count >= 1_000) {
    const thousands = count / 1_000;
    return `${thousands >= 100 ? Math.round(thousands) : thousands.toFixed(1)}k`;
  }
  return String(count);
}

export function getLatestAssistantContext(messages: Array<{ role?: string; usage?: any; modelId?: string }> | null | undefined) {
  const items = Array.isArray(messages) ? messages : [];
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const message = items[i];
    if (message?.role === 'assistant' && message?.usage) {
      return {
        usage: message.usage,
        modelId: typeof message.modelId === 'string' ? message.modelId : undefined,
      };
    }
  }
  return {
    usage: undefined,
    modelId: undefined,
  };
}
