/**
 * ElevenLabs Conversational AI Voice Provider
 *
 * Connects to ElevenLabs' Conversational AI WebSocket for real-time
 * bidirectional voice conversations. Supports ulaw_8000 natively for
 * telephony without transcoding.
 */

import { WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import type { VoiceProvider, VoiceSession, VoiceSessionConfig, AudioFormat } from './types';
import { computeElevenLabsCostUsd } from './voice-pricing';

const EL_CONVAI_WS = 'wss://api.elevenlabs.io/v1/convai/conversation';

class ElevenLabsSession implements VoiceSession {
  id: string;
  providerId = 'elevenlabs';
  private ws: WebSocket | null = null;
  private audioCallbacks: Array<(audioBase64: string) => void> = [];
  private _active = false;
  private config: VoiceSessionConfig;
  private startedAtMs = 0;
  private usageEmitted = false;

  constructor(config: VoiceSessionConfig) {
    this.id = `el_${randomUUID().slice(0, 12)}`;
    this.config = config;
  }

  async connect(): Promise<void> {
    const apiKey = process.env.ELEVENLABS_API_KEY || '';
    if (!apiKey) throw new Error('ELEVENLABS_API_KEY not set');

    const agentId = this.config.agentId;
    if (!agentId) throw new Error('agentId required for ElevenLabs provider');

    const wsUrl = `${EL_CONVAI_WS}?agent_id=${encodeURIComponent(agentId)}`;
    this.ws = new WebSocket(wsUrl, { headers: { 'xi-api-key': apiKey } });

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('ElevenLabs connection timeout')), 15000);

      this.ws!.on('open', () => {
        this._active = true;
        this.startedAtMs = Date.now();
        clearTimeout(timeout);

        const initData: Record<string, any> = {
          type: 'conversation_initiation_client_data',
          conversation_config_override: {
            agent: {
              first_message: this.config.initialMessage || undefined,
              ...(this.config.systemPrompt ? { prompt: { prompt: this.config.systemPrompt } } : {}),
            },
            tts: { model_id: this.config.model || 'eleven_turbo_v2_5' },
            asr: { user_input_audio_format: this.config.inputAudioFormat || 'ulaw_8000' },
          },
        };

        if (this.config.metadata && Object.keys(this.config.metadata).length > 0) {
          initData.custom_llm_extra_body = { metadata: this.config.metadata };
        }

        this.ws!.send(JSON.stringify(initData));
        resolve();
      });

      this.ws!.on('message', (rawData: Buffer | string) => {
        try {
          const msg = JSON.parse(rawData.toString());

          if (msg.type === 'audio' && msg.audio_event?.audio_base_64) {
            for (const cb of this.audioCallbacks) {
              cb(msg.audio_event.audio_base_64);
            }
          }

          if (msg.type === 'conversation_initiation_metadata') {
            const convId = msg.conversation_initiation_metadata_event?.conversation_id;
            console.log(`[elevenlabs-voice] Conversation started: ${convId}`);
          }

          if (msg.type === 'agent_response') {
            this.config.onTranscript?.('assistant', msg.agent_response_event?.agent_response || '', true);
          }

          if (msg.type === 'user_transcript') {
            this.config.onTranscript?.('user', msg.user_transcription_event?.user_transcript || '', true);
          }

          if (msg.type === 'interruption') {
            this.config.onInterruption?.();
          }
        } catch { /* ignore parse errors */ }
      });

      this.ws!.on('close', (_code, reason) => {
        this._active = false;
        // ElevenLabs doesn't surface token usage on the WS — bill by wall-clock
        // session duration. Emit before onSessionEnd so the bridge has a chance
        // to settle before tearing down.
        this.emitDurationUsage();
        this.config.onSessionEnd?.(reason?.toString() || 'closed');
      });

      this.ws!.on('error', (err) => {
        console.error('[elevenlabs-voice] WS error:', err.message);
        this._active = false;
        if (!this.ws?.OPEN) {
          clearTimeout(timeout);
          reject(err);
        }
      });
    });
  }

  private emitDurationUsage(): void {
    if (this.usageEmitted || this.startedAtMs === 0) return;
    this.usageEmitted = true;
    const durationMs = Math.max(0, Date.now() - this.startedAtMs);
    if (durationMs < 1000) return; // ignore connect-and-bail sessions
    const modelId = this.config.model || 'eleven_turbo_v2_5';
    const costUsd = computeElevenLabsCostUsd(modelId, durationMs);
    if (costUsd <= 0) return;
    this.config.onUsage?.({
      model: `elevenlabs/${modelId}`,
      inputTokens: 0,
      outputTokens: 0,
      costUsd,
      raw: { durationMs, billingMode: 'duration' },
    });
  }

  sendAudio(audioBase64: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ user_audio_chunk: audioBase64 }));
    }
  }

  onAudio(callback: (audioBase64: string) => void): void {
    this.audioCallbacks.push(callback);
  }

  sendText(text: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'user_message', user_message: { text } }));
    }
  }

  interrupt(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'interruption' }));
    }
  }

  close(reason?: string): void {
    this._active = false;
    // Emit usage before tearing down the socket — once we close, the WS 'close'
    // handler doesn't fire reliably (especially if we initiated the close).
    this.emitDurationUsage();
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      this.ws.close(1000, reason || 'session_closed');
    }
    this.ws = null;
    this.audioCallbacks = [];
  }

  isActive(): boolean {
    return this._active && this.ws?.readyState === WebSocket.OPEN;
  }
}

export const elevenlabsProvider: VoiceProvider = {
  id: 'elevenlabs',
  name: 'ElevenLabs Conversational AI',
  supportsToolCalling: false,
  supportedInputFormats: ['ulaw_8000', 'pcmu', 'pcm_16000'] as AudioFormat[],
  supportedOutputFormats: ['ulaw_8000', 'pcmu'] as AudioFormat[],

  async createSession(config: VoiceSessionConfig): Promise<VoiceSession> {
    const session = new ElevenLabsSession(config);
    await session.connect();
    return session;
  },

  isConfigured(): boolean {
    return !!(process.env.ELEVENLABS_API_KEY);
  },
};
