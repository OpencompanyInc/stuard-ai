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
});
