/**
 * Voice Provider Abstraction Layer
 *
 * Defines a provider-agnostic interface for real-time voice conversations.
 * Providers (ElevenLabs, OpenAI Realtime, etc.) implement VoiceProvider
 * and are registered in the provider registry for dynamic dispatch.
 */

import type { WebSocket } from 'ws';

export type AudioFormat = 'pcmu' | 'pcma' | 'ulaw_8000' | 'g711_ulaw' | 'g711_alaw' | 'pcm_16000' | 'pcm_24000';

/** Tool/function definition for voice providers that support function calling */
export interface VoiceToolDefinition {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, any>; // JSON Schema
}

export interface VoiceSessionConfig {
  providerId: string;
  agentId?: string;
  voiceId?: string;
  model?: string;
  initialMessage?: string;
  systemPrompt?: string;
  language?: string;
  metadata?: Record<string, any>;
  inputAudioFormat?: AudioFormat;
  outputAudioFormat?: AudioFormat;
  /** Tools the voice AI can call during the conversation */
  tools?: VoiceToolDefinition[];
  /** Callback to capture transcript events */
  onTranscript?: (role: 'user' | 'assistant', text: string, isFinal: boolean) => void;
  /** Callback when the session ends */
  onSessionEnd?: (reason: string) => void;
  /** Callback for interruption events */
  onInterruption?: () => void;
  /** Callback when the voice AI wants to call a function/tool */
  onFunctionCall?: (callId: string, name: string, args: string) => void;
}

export interface VoiceSession {
  id: string;
  providerId: string;
  /** Send audio chunk (base64) to the voice provider */
  sendAudio(audioBase64: string): void;
  /** Receive audio from provider - emitted via callback */
  onAudio(callback: (audioBase64: string) => void): void;
  /** Send a text message to inject into the conversation */
  sendText?(text: string): void;
  /** Send a function call result back to the voice AI */
  sendFunctionResult?(callId: string, result: string): void;
  /** Interrupt the current agent speech */
  interrupt?(): void;
  /** Close the session */
  close(reason?: string): void;
  /** Whether the session is active */
  isActive(): boolean;
}

export interface VoiceProvider {
  id: string;
  name: string;
  /** Supported input audio formats */
  supportedInputFormats: AudioFormat[];
  /** Supported output audio formats */
  supportedOutputFormats: AudioFormat[];
  /** Create a new real-time voice session */
  createSession(config: VoiceSessionConfig): Promise<VoiceSession>;
  /** Check if the provider is configured (has API keys, etc.) */
  isConfigured(): boolean;
}

export interface TelephonyBridgeConfig {
  callControlId: string;
  streamId: string;
  providerId: string;
  sessionConfig: VoiceSessionConfig;
  userId?: string;
  callerNumber?: string;
  direction: 'inbound' | 'outbound';
}

export interface ActiveCall {
  callControlId: string;
  session: VoiceSession;
  bridgeConfig: TelephonyBridgeConfig;
  startedAt: number;
}
