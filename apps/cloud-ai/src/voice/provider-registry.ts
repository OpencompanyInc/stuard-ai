/**
 * Voice Provider Registry
 *
 * Central registry for voice providers. Providers register at startup,
 * and the telephony bridge resolves providers by ID at runtime.
 */

import type { VoiceProvider, ActiveCall } from './types';

const providers = new Map<string, VoiceProvider>();
const activeCalls = new Map<string, ActiveCall>();
const TOOL_CAPABLE_PROVIDER_ORDER = ['openai-realtime', 'grok-realtime'] as const;

export function registerVoiceProvider(provider: VoiceProvider): void {
  providers.set(provider.id, provider);
  console.log(`[voice-registry] Registered provider: ${provider.id} (${provider.name})`);
}

export function getVoiceProvider(id: string): VoiceProvider | undefined {
  return providers.get(id);
}

export function listVoiceProviders(): VoiceProvider[] {
  return Array.from(providers.values());
}

export function getConfiguredProviders(): VoiceProvider[] {
  return Array.from(providers.values()).filter(p => p.isConfigured());
}

export function supportsVoiceToolCalling(providerOrId: VoiceProvider | string | undefined): boolean {
  if (!providerOrId) return false;
  const provider = typeof providerOrId === 'string' ? providers.get(providerOrId) : providerOrId;
  return provider?.supportsToolCalling === true;
}

export function findToolCapableVoiceProvider(preferredIds: readonly string[] = TOOL_CAPABLE_PROVIDER_ORDER): VoiceProvider | undefined {
  const configured = getConfiguredProviders().filter((provider) => supportsVoiceToolCalling(provider));
  for (const id of preferredIds) {
    const match = configured.find((provider) => provider.id === id);
    if (match) return match;
  }
  return configured[0];
}

export function getDefaultProviderId(): string {
  const configured = getConfiguredProviders();
  if (configured.length === 0) return '';
  const preferred = ['gemini-live', 'openai-realtime', 'grok-realtime', 'elevenlabs'];
  for (const id of preferred) {
    if (configured.find(p => p.id === id)) return id;
  }
  return configured[0].id;
}

export function registerActiveCall(callControlId: string, call: ActiveCall): void {
  activeCalls.set(callControlId, call);
}

export function getActiveCall(callControlId: string): ActiveCall | undefined {
  return activeCalls.get(callControlId);
}

export function removeActiveCall(callControlId: string): void {
  const call = activeCalls.get(callControlId);
  if (call?.session?.isActive()) {
    call.session.close('call_ended');
  }
  activeCalls.delete(callControlId);
}

export function getActiveCallCount(): number {
  return activeCalls.size;
}

export function listActiveCalls(): ActiveCall[] {
  return Array.from(activeCalls.values());
}
