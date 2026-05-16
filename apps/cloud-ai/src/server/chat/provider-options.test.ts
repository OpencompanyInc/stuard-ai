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
});
