function toNonNegativeInt(value: unknown): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.floor(n);
}

function pickMax(candidates: unknown[]): number | undefined {
  let max: number | undefined;
  for (const candidate of candidates) {
    const n = toNonNegativeInt(candidate);
    if (typeof n === 'number' && (typeof max !== 'number' || n > max)) {
      max = n;
    }
  }
  return max;
}

export interface NormalizedUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedPromptTokens?: number;
  thinkingTokens?: number;
  reasoningTokens?: number;
  [key: string]: any;
}

export function normalizeUsage(usage: any): NormalizedUsage {
  const u: any = usage && typeof usage === 'object' ? usage : {};

  const promptTokens =
    pickMax([
      u.promptTokens,
      u.inputTokens,
      u.prompt_tokens,
      u.input_tokens,
      u.inputTokenCount,
    ]) ?? 0;

  const completionTokens =
    pickMax([
      u.completionTokens,
      u.outputTokens,
      u.completion_tokens,
      u.output_tokens,
      u.outputTokenCount,
    ]) ?? 0;

  const thinkingTokens = pickMax([
    u.thinkingTokens,
    u.reasoningTokens,
    u.thinking_tokens,
    u.reasoning_tokens,
    u.output_tokens_details?.reasoning,
    u.output_tokens_details?.thinking,
    u.output_tokens_details?.reasoning_tokens,
    u.output_tokens_details?.thinking_tokens,
    u.outputTokenDetails?.reasoning,
    u.outputTokenDetails?.thinking,
    u.outputTokenDetails?.reasoningTokens,
    u.outputTokenDetails?.thinkingTokens,
    u.token_details?.reasoning,
    u.token_details?.thinking,
    u.token_details?.reasoning_tokens,
    u.token_details?.thinking_tokens,
    u.tokenDetails?.reasoning,
    u.tokenDetails?.thinking,
    u.tokenDetails?.reasoningTokens,
    u.tokenDetails?.thinkingTokens,
    u.providerMetadata?.anthropic?.thinkingTokens,
    u.providerMetadata?.anthropic?.reasoningTokens,
    u.providerMetadata?.anthropic?.outputTokensDetails?.reasoning,
    u.providerMetadata?.anthropic?.outputTokensDetails?.thinking,
    u.providerMetadata?.anthropic?.outputTokenDetails?.reasoning,
    u.providerMetadata?.anthropic?.outputTokenDetails?.thinking,
    u.providerMetadata?.anthropic?.tokenDetails?.reasoning,
    u.providerMetadata?.anthropic?.tokenDetails?.thinking,
    u.providerMetadata?.openai?.reasoningTokens,
  ]);

  const cachedPromptTokens = pickMax([
    u.cachedPromptTokens,
    u.cachedInputTokens,
    u.cached_input_tokens,
    u.cacheReadInputTokens,
    u.promptTokensCached,
    u.inputCachedTokens,
    u.inputTokensCached,
    u.cache_read_input_tokens,
    u.inputTokenDetails?.cached,
    u.tokenDetails?.cacheReadInputTokens,
    u.providerMetadata?.anthropic?.cacheReadInputTokens,
  ]);

  const totalTokens =
    pickMax([u.totalTokens, u.total_tokens, u.totalTokenCount]) ??
    Math.max(0, promptTokens + completionTokens);

  const normalized: NormalizedUsage = {
    ...u,
    promptTokens,
    completionTokens,
    totalTokens,
  };

  if (typeof cachedPromptTokens === 'number') {
    normalized.cachedPromptTokens = cachedPromptTokens;
  }
  if (typeof thinkingTokens === 'number') {
    normalized.thinkingTokens = thinkingTokens;
    if (typeof normalized.reasoningTokens !== 'number') {
      normalized.reasoningTokens = thinkingTokens;
    }
  }

  return normalized;
}
