import { describe, expect, it } from 'vitest';

import type { VoiceProvider } from './types';
import {
  findToolCapableVoiceProvider,
  registerVoiceProvider,
  supportsVoiceToolCalling,
} from './provider-registry';

function mockProvider(overrides: Partial<VoiceProvider> & Pick<VoiceProvider, 'id' | 'name'>): VoiceProvider {
  return {
    id: overrides.id,
    name: overrides.name,
    supportsToolCalling: overrides.supportsToolCalling ?? false,
    supportedInputFormats: overrides.supportedInputFormats ?? ['pcm_24000'],
    supportedOutputFormats: overrides.supportedOutputFormats ?? ['pcm_24000'],
    createSession: overrides.createSession ?? (async () => {
      throw new Error('not implemented');
    }),
    isConfigured: overrides.isConfigured ?? (() => true),
  };
}

describe('voice provider tool-calling helpers', () => {
  it('reports tool-calling support by provider id', () => {
    registerVoiceProvider(mockProvider({
      id: 'test-tool-provider-supported',
      name: 'Supported',
      supportsToolCalling: true,
    }));
    registerVoiceProvider(mockProvider({
      id: 'test-tool-provider-unsupported',
      name: 'Unsupported',
      supportsToolCalling: false,
    }));

    expect(supportsVoiceToolCalling('test-tool-provider-supported')).toBe(true);
    expect(supportsVoiceToolCalling('test-tool-provider-unsupported')).toBe(false);
    expect(supportsVoiceToolCalling('missing-provider')).toBe(false);
  });

  it('prefers configured tool-capable providers from the supplied order', () => {
    registerVoiceProvider(mockProvider({
      id: 'test-tool-provider-openai',
      name: 'OpenAI Test',
      supportsToolCalling: true,
      isConfigured: () => true,
    }));
    registerVoiceProvider(mockProvider({
      id: 'test-tool-provider-grok',
      name: 'Grok Test',
      supportsToolCalling: true,
      isConfigured: () => true,
    }));
    registerVoiceProvider(mockProvider({
      id: 'test-tool-provider-elevenlabs',
      name: 'ElevenLabs Test',
      supportsToolCalling: false,
      isConfigured: () => true,
    }));

    const provider = findToolCapableVoiceProvider([
      'test-tool-provider-grok',
      'test-tool-provider-openai',
    ]);

    expect(provider?.id).toBe('test-tool-provider-grok');
  });
});
