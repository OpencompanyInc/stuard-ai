import { describe, expect, it } from 'vitest';

import { buildProviderOptions } from './provider-options';

describe('buildProviderOptions', () => {
  it('forces stateless OpenAI serialization for Codex subscription requests', () => {
    const providerOptions = buildProviderOptions({
      agentType: 'stuard',
      chosenModelId: 'openai/gpt-5.1-codex',
      modelSource: 'subscription',
      modelLabel: 'openai/gpt-5.1-codex',
      msg: { reasoningLevel: 'high' },
    });

    expect(providerOptions.openai).toEqual(
      expect.objectContaining({
        store: false,
      }),
    );
  });

  it('does not force store=false for normal OpenAI requests', () => {
    const providerOptions = buildProviderOptions({
      agentType: 'stuard',
      chosenModelId: 'openai/gpt-5.1',
      modelLabel: 'openai/gpt-5.1',
      msg: { reasoningLevel: 'high' },
    });

    expect(providerOptions.openai?.store).toBeUndefined();
  });

  it('clamps gpt-5.1 reasoning effort to medium', () => {
    const providerOptions = buildProviderOptions({
      agentType: 'stuard',
      chosenModelId: 'openai/gpt-5.1',
      modelLabel: 'openai/gpt-5.1',
      msg: { reasoningLevel: 'high' },
    });

    expect(providerOptions.openai?.reasoningEffort).toBe('medium');
    expect(providerOptions.openai?.reasoningSummary).toBe('auto');
  });

  it('uses thinkingBudget (not thinkingLevel) for Gemini 2.5', () => {
    const providerOptions = buildProviderOptions({
      agentType: 'stuard',
      chosenModelId: 'google/gemini-2.5-pro',
      modelLabel: 'google/gemini-2.5-pro',
      msg: { reasoningLevel: 'medium' },
    });

    expect(providerOptions.google?.thinkingConfig?.thinkingBudget).toBe(8192);
    expect(providerOptions.google?.thinkingConfig?.thinkingLevel).toBeUndefined();
  });

  it('omits Gemini 3 thinkingConfig when reasoning is off (none is not a valid thinkingLevel)', () => {
    const providerOptions = buildProviderOptions({
      agentType: 'stuard',
      chosenModelId: 'google/gemini-3-pro',
      modelLabel: 'google/gemini-3-pro',
      msg: { reasoningLevel: 'none' },
    });

    expect(providerOptions.google).toBeUndefined();
  });

  it('emits xAI reasoning effort (medium collapses to high)', () => {
    const providerOptions = buildProviderOptions({
      agentType: 'stuard',
      chosenModelId: 'xai/grok-4',
      modelLabel: 'xai/grok-4',
      msg: { reasoningLevel: 'medium' },
    });

    expect(providerOptions.xai?.reasoningEffort).toBe('high');
  });

  it('toggles DeepSeek thinking via type enabled/disabled', () => {
    const off = buildProviderOptions({
      agentType: 'stuard',
      chosenModelId: 'deepseek/deepseek-chat',
      modelLabel: 'deepseek/deepseek-chat',
      msg: { reasoningLevel: 'none' },
    });
    expect(off.deepseek?.thinking?.type).toBe('disabled');

    const on = buildProviderOptions({
      agentType: 'stuard',
      chosenModelId: 'deepseek/deepseek-chat',
      modelLabel: 'deepseek/deepseek-chat',
      msg: { reasoningLevel: 'low' },
    });
    expect(on.deepseek?.thinking?.type).toBe('enabled');
  });

  it('routes reasoning through the openrouter namespace for openrouter/* models', () => {
    // openrouter/openai/... must NOT leak into the openai branch; the OpenRouter
    // SDK ignores per-provider option keys and needs `openrouter.reasoning`.
    const providerOptions = buildProviderOptions({
      agentType: 'stuard',
      chosenModelId: 'openrouter/openai/gpt-5.1',
      modelLabel: 'openrouter/openai/gpt-5.1',
      msg: { reasoningLevel: 'high' },
    });

    expect(providerOptions.openrouter?.reasoning).toEqual({ enabled: true, effort: 'high' });
    expect(providerOptions.openai).toBeUndefined();
    expect(providerOptions.anthropic).toBeUndefined();
    expect(providerOptions.google).toBeUndefined();
  });

  it('disables openrouter reasoning when level is none', () => {
    const providerOptions = buildProviderOptions({
      agentType: 'stuard',
      chosenModelId: 'openrouter/anthropic/claude-sonnet-4',
      modelLabel: 'openrouter/anthropic/claude-sonnet-4',
      msg: { reasoningLevel: 'none' },
    });

    expect(providerOptions.openrouter?.reasoning?.enabled).toBe(false);
    expect(providerOptions.anthropic).toBeUndefined();
  });

  it('routes a bare native id resolved to Stuard-serving through the openrouter namespace', () => {
    // A Stuard-served Gemini id ('friendly') is transported through OpenRouter,
    // so its reasoning must land on `openrouter.reasoning`, not `google`.
    const providerOptions = buildProviderOptions({
      agentType: 'stuard',
      chosenModelId: 'google/gemini-3-pro-preview',
      modelSource: 'friendly',
      modelLabel: 'google/gemini-3-pro-preview',
      msg: { reasoningLevel: 'high' },
    });

    expect(providerOptions.openrouter?.reasoning).toEqual({ enabled: true, effort: 'high' });
    expect(providerOptions.google).toBeUndefined();
  });

  it('keeps the native namespace for a BYOK-resolved native id', () => {
    // BYOK ('byok') keeps the native transport (the user's own key), so the
    // native provider namespace still applies.
    const providerOptions = buildProviderOptions({
      agentType: 'stuard',
      chosenModelId: 'google/gemini-3-pro-preview',
      modelSource: 'byok',
      modelLabel: 'google/gemini-3-pro-preview',
      msg: { reasoningLevel: 'high' },
    });

    expect(providerOptions.google?.thinkingConfig?.thinkingLevel).toBe('high');
    expect(providerOptions.openrouter).toBeUndefined();
  });

  it('passes xhigh through OpenRouter for a model that supports it (Opus 4.8)', () => {
    const providerOptions = buildProviderOptions({
      agentType: 'stuard',
      chosenModelId: 'openrouter/anthropic/claude-opus-4.8',
      modelLabel: 'openrouter/anthropic/claude-opus-4.8',
      msg: { reasoningLevel: 'xhigh' },
    });

    expect(providerOptions.openrouter?.reasoning).toEqual({ enabled: true, effort: 'xhigh' });
  });

  it('clamps xhigh down to the model ceiling for a low/high-only model (Grok)', () => {
    const providerOptions = buildProviderOptions({
      agentType: 'stuard',
      chosenModelId: 'openrouter/x-ai/grok-4.3',
      modelLabel: 'openrouter/x-ai/grok-4.3',
      msg: { reasoningLevel: 'xhigh' },
    });

    expect(providerOptions.openrouter?.reasoning).toEqual({ enabled: true, effort: 'high' });
  });

  it('passes the minimal tier through OpenRouter for GPT-5', () => {
    const providerOptions = buildProviderOptions({
      agentType: 'stuard',
      chosenModelId: 'openrouter/openai/gpt-5.4',
      modelLabel: 'openrouter/openai/gpt-5.4',
      msg: { reasoningLevel: 'minimal' },
    });

    expect(providerOptions.openrouter?.reasoning).toEqual({ enabled: true, effort: 'minimal' });
  });

  it('forces reasoning on (no effort pinned) when a model cannot disable it', () => {
    // Gemini 3 has no "off"; a stale `none` must enable reasoning rather than
    // sending `enabled: false`.
    const providerOptions = buildProviderOptions({
      agentType: 'stuard',
      chosenModelId: 'openrouter/google/gemini-3.1-pro-preview',
      modelLabel: 'openrouter/google/gemini-3.1-pro-preview',
      msg: { reasoningLevel: 'none' },
    });

    expect(providerOptions.openrouter?.reasoning?.enabled).toBe(true);
    expect(providerOptions.openrouter?.reasoning?.effort).toBeUndefined();
  });

  it('maps xhigh to a larger thinking budget for native Anthropic (BYOK)', () => {
    const providerOptions = buildProviderOptions({
      agentType: 'stuard',
      chosenModelId: 'anthropic/claude-opus-4-8',
      modelSource: 'byok',
      modelLabel: 'anthropic/claude-opus-4-8',
      msg: { reasoningLevel: 'xhigh' },
    });

    expect(providerOptions.anthropic?.thinking).toEqual({ type: 'enabled', budgetTokens: 32000 });
  });

  it('folds xhigh into high for native Gemini 3 thinkingLevel (BYOK)', () => {
    const providerOptions = buildProviderOptions({
      agentType: 'stuard',
      chosenModelId: 'google/gemini-3-pro-preview',
      modelSource: 'byok',
      modelLabel: 'google/gemini-3-pro-preview',
      msg: { reasoningLevel: 'xhigh' },
    });

    expect(providerOptions.google?.thinkingConfig?.thinkingLevel).toBe('high');
  });
});
