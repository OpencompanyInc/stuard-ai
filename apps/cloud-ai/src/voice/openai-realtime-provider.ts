/**
 * OpenAI Realtime API Voice Provider
 *
 * Connects to the OpenAI Realtime API via WebSocket for real-time
 * voice conversations with GPT-4o.
 *
 * Supports G.711 µ-law (audio/pcmu) natively for telephony.
 * Also supports PCM16 at 24kHz.
 *
 * Docs: https://platform.openai.com/docs/guides/realtime-websockets
 */

import { WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import type { VoiceProvider, VoiceSession, VoiceSessionConfig, AudioFormat } from './types';

const OPENAI_REALTIME_URL = 'wss://api.openai.com/v1/realtime';
const DEFAULT_MODEL = 'gpt-4o-realtime-preview';

const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer', 'verse'] as const;

class OpenAIRealtimeSession implements VoiceSession {
  id: string;
  providerId = 'openai-realtime';
  private ws: WebSocket | null = null;
  private audioCallbacks: Array<(audioBase64: string) => void> = [];
  private _active = false;
  private config: VoiceSessionConfig;

  constructor(config: VoiceSessionConfig) {
    this.id = `oai_${randomUUID().slice(0, 12)}`;
    this.config = config;
  }

  async connect(): Promise<void> {
    const apiKey = (process.env.OPENAI_API_KEY || '').trim();
    if (!apiKey) throw new Error('OPENAI_API_KEY not set');

    const model = this.config.model || DEFAULT_MODEL;
    const wsUrl = `${OPENAI_REALTIME_URL}?model=${encodeURIComponent(model)}`;

    this.ws = new WebSocket(wsUrl, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    });

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('OpenAI Realtime connection timeout')), 15000);

      this.ws!.on('open', () => {
        this._active = true;
        clearTimeout(timeout);

        const voice = this.config.voiceId || 'alloy';
        const validVoice = OPENAI_VOICES.includes(voice as any) ? voice : 'alloy';

        // Map our AudioFormat to OpenAI's format names
        const toOaiFormat = (fmt?: string) => {
          if (fmt === 'pcm_24000' || fmt === 'pcm_16000') return 'pcm16';
          if (fmt === 'g711_alaw' || fmt === 'pcma') return 'g711_alaw';
          return 'g711_ulaw'; // default for telephony
        };

        const inputFmt = toOaiFormat(this.config.inputAudioFormat);
        const outputFmt = toOaiFormat(this.config.outputAudioFormat);

        const sessionConfig: Record<string, any> = {
          type: 'session.update',
          session: {
            modalities: ['text', 'audio'],
            voice: validVoice,
            input_audio_format: inputFmt,
            output_audio_format: outputFmt,
            input_audio_transcription: {
              model: 'whisper-1',
              language: this.config.language || 'en',
            },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 500,
            },
          },
        };

        if (this.config.systemPrompt) {
          sessionConfig.session.instructions = this.config.systemPrompt;
        }

        this.ws!.send(JSON.stringify(sessionConfig));

        // If there's an initial message, create a response
        if (this.config.initialMessage) {
          this.ws!.send(JSON.stringify({
            type: 'conversation.item.create',
            item: {
              type: 'message',
              role: 'user',
              content: [{ type: 'input_text', text: `[System: Greet the caller] ${this.config.initialMessage}` }],
            },
          }));
          this.ws!.send(JSON.stringify({ type: 'response.create' }));
        }

        resolve();
      });

      this.ws!.on('message', (rawData: Buffer | string) => {
        try {
          const msg = JSON.parse(rawData.toString());

          if (msg.type === 'response.audio.delta' && msg.delta) {
            for (const cb of this.audioCallbacks) {
              cb(msg.delta);
            }
          }

          if (msg.type === 'response.audio_transcript.done') {
            this.config.onTranscript?.('assistant', msg.transcript || '', true);
          }

          if (msg.type === 'conversation.item.input_audio_transcription.completed') {
            this.config.onTranscript?.('user', msg.transcript || '', true);
          }

          if (msg.type === 'input_audio_buffer.speech_started') {
            this.config.onInterruption?.();
          }

          if (msg.type === 'error') {
            console.error('[openai-realtime] Error:', msg.error?.message || JSON.stringify(msg.error));
          }

          if (msg.type === 'session.created') {
            console.log(`[openai-realtime] Session created: ${msg.session?.id}`);
          }
        } catch { /* ignore parse errors */ }
      });

      this.ws!.on('close', (_code, reason) => {
        this._active = false;
        this.config.onSessionEnd?.(reason?.toString() || 'closed');
      });

      this.ws!.on('error', (err) => {
        console.error('[openai-realtime] WS error:', err.message);
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
      this.ws.send(JSON.stringify({ type: 'response.create' }));
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

export const openaiRealtimeProvider: VoiceProvider = {
  id: 'openai-realtime',
  name: 'OpenAI Realtime (GPT-4o)',
  supportedInputFormats: ['g711_ulaw', 'g711_alaw', 'pcmu', 'pcma', 'ulaw_8000', 'pcm_24000'] as AudioFormat[],
  supportedOutputFormats: ['g711_ulaw', 'g711_alaw', 'pcmu', 'pcma', 'ulaw_8000', 'pcm_24000'] as AudioFormat[],

  async createSession(config: VoiceSessionConfig): Promise<VoiceSession> {
    const session = new OpenAIRealtimeSession(config);
    await session.connect();
    return session;
  },

  isConfigured(): boolean {
    return !!(process.env.OPENAI_API_KEY);
  },
};
