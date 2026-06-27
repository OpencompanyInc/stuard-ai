/**
 * Voice Provider System - Public API
 *
 * Initializes and exports all voice-related functionality.
 * Call initVoiceProviders() at server startup to register all providers.
 *
 * Supported providers:
 *   - ElevenLabs Conversational AI (agent-based, natural voices)
 *   - OpenAI Realtime (GPT-4o, native G.711 for telephony)
 *   - Grok Voice Agent (xAI, native G.711 for telephony)
 *   - Gemini Live (Google, PCM16 with auto-transcoding for telephony)
 */

export type {
  VoiceProvider,
  VoiceSession,
  VoiceSessionConfig,
  VoiceToolDefinition,
  VoiceUsageEvent,
  AudioFormat,
  TelephonyBridgeConfig,
  ActiveCall,
} from './types';

export { buildVoiceContext, getVoiceTools } from './voice-context';
export type { VoiceContext } from './voice-context';

export {
  registerVoiceProvider,
  getVoiceProvider,
  listVoiceProviders,
  getConfiguredProviders,
  supportsVoiceToolCalling,
  findToolCapableVoiceProvider,
  getTelephonyProviderOrder,
  getDefaultProviderId,
  registerActiveCall,
  getActiveCall,
  removeActiveCall,
  getActiveCallCount,
  listActiveCalls,
} from './provider-registry';

export { elevenlabsProvider } from './elevenlabs-provider';
export { openaiRealtimeProvider } from './openai-realtime-provider';
export { grokRealtimeProvider } from './grok-realtime-provider';
export { geminiLiveProvider } from './gemini-live-provider';

import { registerVoiceProvider } from './provider-registry';
import { elevenlabsProvider } from './elevenlabs-provider';
import { openaiRealtimeProvider } from './openai-realtime-provider';
import { grokRealtimeProvider } from './grok-realtime-provider';
import { geminiLiveProvider } from './gemini-live-provider';

let _initialized = false;

export function initVoiceProviders(): void {
  if (_initialized) return;
  _initialized = true;

  registerVoiceProvider(elevenlabsProvider);
  registerVoiceProvider(openaiRealtimeProvider);
  registerVoiceProvider(grokRealtimeProvider);
  registerVoiceProvider(geminiLiveProvider);

  console.log('[voice] Voice providers initialized (4 providers)');
}
