/**
 * Grok (xAI) Voice Agent API Provider
 *
 * Connects to xAI's Voice Agent API via WebSocket for real-time
 * voice conversations. Protocol is nearly identical to OpenAI Realtime.
 *
 * Supports G.711 µ-law (audio/pcmu) natively at 8kHz for telephony.
 * Also supports PCM at configurable sample rates.
 *
 * Docs: https://docs.x.ai/developers/model-capabilities/audio/voice-agent
 */

import { WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import type { VoiceProvider, VoiceSession, VoiceSessionConfig, AudioFormat } from './types';

const GROK_REALTIME_URL = 'wss://api.x.ai/v1/realtime';

const GROK_VOICES = ['Eve', 'Ara', 'Rex', 'Sal', 'Leo'] as const;

class GrokRealtimeSession implements VoiceSession {
  id: string;
  providerId = 'grok-realtime';
  private ws: WebSocket | null = null;
  private audioCallbacks: Array<(audioBase64: string) => void> = [];
  private _active = false;
  private _responding = false;
  private config: VoiceSessionConfig;

  constructor(config: VoiceSessionConfig) {
    this.id = `grok_${randomUUID().slice(0, 12)}`;
    this.config = config;
  }

  async connect(): Promise<void> {
    const apiKey = process.env.XAI_API_KEY || '';
    if (!apiKey) throw new Error('XAI_API_KEY not set');

    this.ws = new WebSocket(GROK_REALTIME_URL, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Grok Realtime connection timeout')), 15000);

      this.ws!.on('open', () => {
        this._active = true;
        clearTimeout(timeout);

        const voice = this.config.voiceId || 'Eve';
        const validVoice = GROK_VOICES.includes(voice as any) ? voice : 'Eve';

        const sessionConfig: Record<string, any> = {
          type: 'session.update',
          session: {
            voice: validVoice,
            instructions: this.config.systemPrompt || 'You are Stuard, a helpful AI assistant.',
            turn_detection: {
              type: 'server_vad',
              threshold: 0.3,
              silence_duration_ms: 300,
            },
            audio: {
              input: { format: { type: 'audio/pcmu' } },
              output: { format: { type: 'audio/pcmu' } },
            },
          },
        };

        // Add function calling tools if provided
        if (this.config.tools && this.config.tools.length > 0) {
          sessionConfig.session.tools = this.config.tools.map(t => ({
            type: 'function',
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          }));
        }

        this.ws!.send(JSON.stringify(sessionConfig));

        if (this.config.initialMessage) {
          this.ws!.send(JSON.stringify({
            type: 'conversation.item.create',
            item: {
              type: 'message',
              role: 'user',
              content: [{ type: 'input_text', text: `[System: Greet the caller] ${this.config.initialMessage}` }],
            },
          }));
          this.ws!.send(JSON.stringify({
            type: 'response.create',
            response: { modalities: ['text', 'audio'] },
          }));
        }

        resolve();
      });

      this.ws!.on('message', (rawData: Buffer | string) => {
        try {
          const msg = JSON.parse(rawData.toString());

          if (msg.type === 'response.audio.delta' && msg.delta) {
            this._responding = true;
            for (const cb of this.audioCallbacks) {
              cb(msg.delta);
            }
          }

          if (msg.type === 'response.done' || msg.type === 'response.cancelled') {
            this._responding = false;
          }

          if (msg.type === 'response.audio_transcript.done') {
            this.config.onTranscript?.('assistant', msg.transcript || '', true);
          }

          if (msg.type === 'conversation.item.input_audio_transcription.completed') {
            this.config.onTranscript?.('user', msg.transcript || '', true);
          }

          // Function call completed — forward to bridge for execution
          if (msg.type === 'response.function_call_arguments.done') {
            this._responding = false;
            const callId = msg.call_id || '';
            const fnName = msg.name || '';
            const fnArgs = msg.arguments || '{}';
            console.log('[grok-realtime] Function call:', { callId, fnName });
            this.config.onFunctionCall?.(callId, fnName, fnArgs);
          }

          if (msg.type === 'input_audio_buffer.speech_started') {
            if (this._responding) {
              this._responding = false;
              this.ws?.send(JSON.stringify({ type: 'response.cancel' }));
            }
            this.config.onInterruption?.();
          }

          if (msg.type === 'error') {
            console.error('[grok-realtime] Error:', msg.error?.message || JSON.stringify(msg.error));
          }

          if (msg.type === 'session.created' || msg.type === 'session.updated') {
            console.log(`[grok-realtime] Session ${msg.type}:`, msg.session?.id || 'ok');
          }
        } catch { /* ignore parse errors */ }
      });

      this.ws!.on('close', (_code, reason) => {
        this._active = false;
        this.config.onSessionEnd?.(reason?.toString() || 'closed');
      });

      this.ws!.on('error', (err) => {
        console.error('[grok-realtime] WS error:', err.message);
        this._active = false;
        if (!this.ws?.OPEN) {
          clearTimeout(timeout);
          reject(err);
        }
      });
    });
  }

  sendAudio(audioBase64: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: audioBase64,
      }));
    }
  }

  onAudio(callback: (audioBase64: string) => void): void {
    this.audioCallbacks.push(callback);
  }

  sendText(text: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text }],
        },
      }));
      this.ws.send(JSON.stringify({
        type: 'response.create',
        response: { modalities: ['text', 'audio'] },
      }));
    }
  }

  sendFunctionResult(callId: string, result: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: result,
        },
      }));
      this.ws.send(JSON.stringify({
        type: 'response.create',
        response: { modalities: ['text', 'audio'] },
      }));
    }
  }

  interrupt(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'response.cancel' }));
    }
  }

  close(reason?: string): void {
    this._active = false;
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

export const grokRealtimeProvider: VoiceProvider = {
  id: 'grok-realtime',
  name: 'Grok Voice Agent (xAI)',
  supportedInputFormats: ['pcmu', 'ulaw_8000', 'g711_ulaw', 'g711_alaw', 'pcm_16000', 'pcm_24000'] as AudioFormat[],
  supportedOutputFormats: ['pcmu', 'ulaw_8000', 'g711_ulaw', 'g711_alaw', 'pcm_16000', 'pcm_24000'] as AudioFormat[],

  async createSession(config: VoiceSessionConfig): Promise<VoiceSession> {
    const session = new GrokRealtimeSession(config);
    await session.connect();
    return session;
  },

  isConfigured(): boolean {
    return !!(process.env.XAI_API_KEY);
  },
};
