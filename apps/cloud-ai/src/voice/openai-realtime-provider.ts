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
import { computeVoiceCostUsd } from './voice-pricing';

const OPENAI_REALTIME_URL = 'wss://api.openai.com/v1/realtime';
const DEFAULT_MODEL = 'gpt-4o-realtime-preview';

const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer', 'verse'] as const;

class OpenAIRealtimeSession implements VoiceSession {
  id: string;
  providerId = 'openai-realtime';
  private ws: WebSocket | null = null;
  private audioCallbacks: Array<(audioBase64: string) => void> = [];
  private _active = false;
  private _responding = false;
  private config: VoiceSessionConfig;
  private resolvedModelId = '';

  constructor(config: VoiceSessionConfig) {
    this.id = `oai_${randomUUID().slice(0, 12)}`;
    this.config = config;
  }

  async connect(): Promise<void> {
    const apiKey = (process.env.OPENAI_API_KEY || '').trim();
    if (!apiKey) throw new Error('OPENAI_API_KEY not set');

    const model = this.config.model || DEFAULT_MODEL;
    this.resolvedModelId = model;
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
              threshold: 0.3,
              prefix_padding_ms: 200,
              silence_duration_ms: 300,
            },
          },
        };

        if (this.config.systemPrompt) {
          sessionConfig.session.instructions = this.config.systemPrompt;
        }

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
            this._responding = true;
            for (const cb of this.audioCallbacks) {
              cb(msg.delta);
            }
          }

          if (msg.type === 'response.done' || msg.type === 'response.cancelled') {
            this._responding = false;
            // response.done carries this turn's usage. Forward to the bridge
            // so credits debit live; cancelled responses still report partial
            // usage so we don't bill for tokens the user didn't consume in
            // a complete way but we also don't drop already-spent tokens.
            const usage = msg.response?.usage;
            if (usage) {
              try { this.emitUsage(usage); } catch (err: any) {
                console.warn('[openai-realtime] usage emit failed:', err?.message);
              }
            }
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
            console.log('[openai-realtime] Function call:', { callId, fnName });
            this.config.onFunctionCall?.(callId, fnName, fnArgs);
          }

          if (msg.type === 'input_audio_buffer.speech_started') {
            // User started talking — cancel any in-flight response immediately
            // so OpenAI stops generating and the bridge can clear Telnyx's buffer
            if (this._responding) {
              this._responding = false;
              this.ws?.send(JSON.stringify({ type: 'response.cancel' }));
            }
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

  private emitUsage(usage: any): void {
    const inDetails = usage?.input_token_details || {};
    const outDetails = usage?.output_token_details || {};
    const textIn = Math.max(0, Number(inDetails.text_tokens || 0));
    const audioIn = Math.max(0, Number(inDetails.audio_tokens || 0));
    const cachedIn = Math.max(0, Number(inDetails.cached_tokens || 0));
    const textOut = Math.max(0, Number(outDetails.text_tokens || 0));
    const audioOut = Math.max(0, Number(outDetails.audio_tokens || 0));

    // Fall back to flat totals when token details aren't present (older API
    // versions, partial responses).
    let resolvedIn = textIn + audioIn;
    if (resolvedIn === 0) resolvedIn = Math.max(0, Number(usage?.input_tokens || 0));
    let resolvedOut = textOut + audioOut;
    if (resolvedOut === 0) resolvedOut = Math.max(0, Number(usage?.output_tokens || 0));
    if (resolvedIn + resolvedOut === 0) return;

    const costUsd = computeVoiceCostUsd('openai-realtime', this.resolvedModelId, {
      textInputTokens: textIn || resolvedIn,
      audioInputTokens: audioIn,
      textOutputTokens: textOut,
      audioOutputTokens: audioOut || resolvedOut,
      cachedInputTokens: cachedIn,
    });

    this.config.onUsage?.({
      model: `openai/${this.resolvedModelId}`,
      inputTokens: resolvedIn,
      outputTokens: resolvedOut,
      cachedInputTokens: cachedIn,
      inputTextTokens: textIn,
      inputAudioTokens: audioIn,
      outputTextTokens: textOut,
      outputAudioTokens: audioOut,
      costUsd,
      raw: usage,
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

  sendFunctionResult(callId: string, result: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      // Send the function call output back to the conversation
      this.ws.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: result,
        },
      }));
      // Trigger the model to continue responding with audio
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
  supportsToolCalling: true,
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
