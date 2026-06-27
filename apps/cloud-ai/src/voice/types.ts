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

/**
 * Per-turn (or per-session) usage report from a voice provider.
 *
 * Providers emit one event per turn whenever the upstream WebSocket carries
 * a usage payload (Gemini Live's `usageMetadata`, OpenAI/Grok Realtime's
 * `response.done.response.usage`). ElevenLabs has no per-turn usage so it
 * emits a single synthetic event on close.
 *
 * `costUsd` (when set by the provider) is authoritative — voice models price
 * audio tokens very differently from text, and the central pricing.ts table
 * doesn't model audio rates. The billing tracker prefers explicit cost over
 * recomputing from token counts.
 */
export interface VoiceUsageEvent {
  /** Logical model id used for the cost calculation / log row. */
  model: string;
  /** Total input tokens (text + audio combined). */
  inputTokens: number;
  /** Total output tokens (text + audio combined). */
  outputTokens: number;
  /** Cached input tokens (counted within inputTokens). */
  cachedInputTokens?: number;
  /** Optional per-modality breakdown for audit/logs. */
  inputTextTokens?: number;
  inputAudioTokens?: number;
  outputTextTokens?: number;
  outputAudioTokens?: number;
  /** Optional reasoning/thinking tokens (counted within outputTokens). */
  reasoningTokens?: number;
  /** Provider-computed USD cost (preferred over token-derived estimate). */
  costUsd?: number;
  /** Raw provider payload, kept for debugging. */
  raw?: any;
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
  /** Callback when the provider reports token/audio usage for a turn. */
  onUsage?: (event: VoiceUsageEvent) => void;
}

export interface VoiceSession {
  id: string;
  providerId: string;
  /** Send audio chunk (base64) to the voice provider */
  sendAudio(audioBase64: string): void;
  /** Receive audio from provider - emitted via callback */
  onAudio(callback: (audioBase64: string) => void): void;
  /**
   * Send a single image/video frame (base64) to providers that support
   * realtime vision. Gemini Live: JPEG/PNG, ≤1 FPS recommended.
   */
  sendImage?(imageBase64: string, mimeType?: string): void;
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
  /** Whether the provider can execute function/tool calls during the live session */
  supportsToolCalling?: boolean;
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
