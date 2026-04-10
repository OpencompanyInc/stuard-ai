/**
 * Google Gemini Live API Voice Provider
 *
 * Connects to Gemini's Live API via WebSocket for real-time multimodal
 * voice conversations. Uses a different protocol than OpenAI/Grok.
 *
 * Audio: Gemini expects PCM16 16kHz input and outputs PCM16 24kHz.
 * For telephony (µ-law 8kHz), this provider transcodes in both directions:
 *   Telnyx µ-law 8kHz → PCM16 16kHz → Gemini
 *   Gemini → PCM16 24kHz → µ-law 8kHz → Telnyx
 *
 * Docs: https://ai.google.dev/gemini-api/docs/live
 */

import { WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import type { VoiceProvider, VoiceSession, VoiceSessionConfig, AudioFormat } from './types';

const GEMINI_LIVE_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

// µ-law to linear PCM16 expansion table
const ULAW_TO_LINEAR = new Int16Array(256);
(function buildUlawTable() {
  for (let i = 0; i < 256; i++) {
    let mu = ~i & 0xff;
    const sign = (mu & 0x80) ? -1 : 1;
    mu = mu & 0x7f;
    const exponent = (mu >> 4) & 0x07;
    const mantissa = mu & 0x0f;
    let sample = ((mantissa << 3) + 0x84) << exponent;
    sample -= 0x84;
    ULAW_TO_LINEAR[i] = sign * sample;
  }
})();

// Linear PCM16 to µ-law compression
function linearToUlaw(sample: number): number {
  const BIAS = 0x84;
  const MAX = 0x7fff;
  let sign = 0;
  if (sample < 0) {
    sign = 0x80;
    sample = -sample;
  }
  if (sample > MAX) sample = MAX;
  sample += BIAS;
  let exponent = 7;
  const expMask = 0x4000;
  for (; exponent > 0; exponent--) {
    if (sample & expMask) break;
    sample <<= 1;
  }
  const mantissa = (sample >> 10) & 0x0f;
  const ulawByte = ~(sign | (exponent << 4) | mantissa) & 0xff;
  return ulawByte;
}

/** Convert µ-law 8kHz buffer to PCM16 16kHz (upsample 2x with linear interpolation) */
function ulawToPcm16_16k(ulawB64: string): string {
  const ulawBuf = Buffer.from(ulawB64, 'base64');
  const pcm16 = new Int16Array(ulawBuf.length * 2);

  for (let i = 0; i < ulawBuf.length; i++) {
    const current = ULAW_TO_LINEAR[ulawBuf[i]];
    const next = i + 1 < ulawBuf.length ? ULAW_TO_LINEAR[ulawBuf[i + 1]] : current;
    pcm16[i * 2] = current;
    pcm16[i * 2 + 1] = Math.round((current + next) / 2);
  }

  return Buffer.from(pcm16.buffer).toString('base64');
}

/** Convert PCM16 24kHz buffer to µ-law 8kHz (downsample 3x) */
function pcm16_24kToUlaw(pcmB64: string): string {
  const pcmBuf = Buffer.from(pcmB64, 'base64');
  const sampleCount = pcmBuf.length / 2;
  const outputCount = Math.floor(sampleCount / 3);
  const ulawBuf = Buffer.alloc(outputCount);

  for (let i = 0; i < outputCount; i++) {
    const srcIdx = i * 3;
    const sample = pcmBuf.readInt16LE(srcIdx * 2);
    ulawBuf[i] = linearToUlaw(sample);
  }

  return ulawBuf.toString('base64');
}

/** Downsample PCM16 24kHz to PCM16 16kHz (3:2 ratio with linear interpolation) */
function pcm16_24kTo16k(pcmB64: string): string {
  const pcmBuf = Buffer.from(pcmB64, 'base64');
  const sampleCount = pcmBuf.length / 2;
  const outputCount = Math.round(sampleCount * 2 / 3);
  const outBuf = Buffer.alloc(outputCount * 2);

  for (let i = 0; i < outputCount; i++) {
    const srcIdx = i * 1.5;
    const lo = Math.floor(srcIdx);
    const hi = Math.min(lo + 1, sampleCount - 1);
    const frac = srcIdx - lo;
    const sLo = pcmBuf.readInt16LE(lo * 2);
    const sHi = pcmBuf.readInt16LE(hi * 2);
    const sample = Math.round(sLo * (1 - frac) + sHi * frac);
    outBuf.writeInt16LE(sample, i * 2);
  }

  return outBuf.toString('base64');
}

class GeminiLiveSession implements VoiceSession {
  id: string;
  providerId = 'gemini-live';
  private ws: WebSocket | null = null;
  private audioCallbacks: Array<(audioBase64: string) => void> = [];
  private _active = false;
  private config: VoiceSessionConfig;
  private needsTranscoding: boolean;
  private needsDownsample: boolean;

  constructor(config: VoiceSessionConfig) {
    this.id = `gem_${randomUUID().slice(0, 12)}`;
    this.config = config;
    this.needsTranscoding = config.inputAudioFormat === 'ulaw_8000' ||
      config.inputAudioFormat === 'pcmu' ||
      config.inputAudioFormat === 'g711_ulaw';
    this.needsDownsample = config.inputAudioFormat === 'pcm_24000';
  }

  async connect(): Promise<void> {
    const apiKey = process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY || '';
    if (!apiKey) throw new Error('GOOGLE_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, or GEMINI_API_KEY not set');

    const model = this.config.model || process.env.GEMINI_LIVE_MODEL || 'gemini-2.5-flash-native-audio-preview-12-2025';
    const wsUrl = `${GEMINI_LIVE_URL}?key=${encodeURIComponent(apiKey)}`;

    this.ws = new WebSocket(wsUrl);

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Gemini Live connection timeout')), 15000);
      let resolved = false;

      this.ws!.on('open', () => {
        this._active = true;

        // Gemini Live API setup message
        const setupMsg: Record<string, any> = {
          setup: {
            model: `models/${model}`,
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: this.config.voiceId || 'Aoede',
                  },
                },
              },
            },
          },
        };

        if (this.config.systemPrompt) {
          setupMsg.setup.systemInstruction = {
            parts: [{ text: this.config.systemPrompt }],
          };
        }

        this.ws!.send(JSON.stringify(setupMsg));
      });

      this.ws!.on('message', (rawData: Buffer | string) => {
        try {
          const msg = JSON.parse(rawData.toString());

          // Setup complete — now safe to send audio/text
          if (msg.setupComplete) {
            console.log('[gemini-live] Setup complete');
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);

              // Send initial message now that setup is confirmed
              if (this.config.initialMessage && this.ws?.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                  clientContent: {
                    turns: [{
                      role: 'user',
                      parts: [{ text: `[Greet the caller]: ${this.config.initialMessage}` }],
                    }],
                    turnComplete: true,
                  },
                }));
              }

              resolve();
            }
          }

          // Gemini sends audio in serverContent.modelTurn.parts[].inlineData
          if (msg.serverContent?.modelTurn?.parts) {
            for (const part of msg.serverContent.modelTurn.parts) {
              if (part.inlineData?.mimeType?.startsWith('audio/') && part.inlineData?.data) {
                let audioB64 = part.inlineData.data;

                // Transcode PCM16 24kHz → µ-law 8kHz if needed for telephony
                if (this.needsTranscoding) {
                  audioB64 = pcm16_24kToUlaw(audioB64);
                }

                for (const cb of this.audioCallbacks) {
                  cb(audioB64);
                }
              }

              if (part.text) {
                this.config.onTranscript?.('assistant', part.text, true);
              }
            }
          }

          // Interruption
          if (msg.serverContent?.interrupted) {
            this.config.onInterruption?.();
          }
        } catch { /* ignore parse errors */ }
      });

      this.ws!.on('close', (_code, reason) => {
        this._active = false;
        this.config.onSessionEnd?.(reason?.toString() || 'closed');
      });

      this.ws!.on('error', (err) => {
        console.error('[gemini-live] WS error:', err.message);
        this._active = false;
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          reject(err);
        }
      });
    });
  }

  sendAudio(audioBase64: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      let pcmB64 = audioBase64;

      if (this.needsTranscoding) {
        // µ-law 8kHz → PCM16 16kHz
        pcmB64 = ulawToPcm16_16k(audioBase64);
      } else if (this.needsDownsample) {
        // PCM16 24kHz → PCM16 16kHz (browser sends 24kHz, Gemini expects 16kHz)
        pcmB64 = pcm16_24kTo16k(audioBase64);
      }

      this.ws.send(JSON.stringify({
        realtimeInput: {
          mediaChunks: [{
            mimeType: 'audio/pcm;rate=16000',
            data: pcmB64,
          }],
        },
      }));
    }
  }

  onAudio(callback: (audioBase64: string) => void): void {
    this.audioCallbacks.push(callback);
  }

  sendText(text: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        clientContent: {
          turns: [{
            role: 'user',
            parts: [{ text }],
          }],
          turnComplete: true,
        },
      }));
    }
  }

  interrupt(): void {
    // Gemini handles interruptions via barge-in automatically
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

export const geminiLiveProvider: VoiceProvider = {
  id: 'gemini-live',
  name: 'Google Gemini Live',
  supportedInputFormats: ['pcm_16000', 'pcm_24000', 'ulaw_8000', 'pcmu', 'g711_ulaw'] as AudioFormat[],
  supportedOutputFormats: ['pcm_24000', 'ulaw_8000', 'pcmu', 'g711_ulaw'] as AudioFormat[],

  async createSession(config: VoiceSessionConfig): Promise<VoiceSession> {
    const session = new GeminiLiveSession(config);
    await session.connect();
    return session;
  },

  isConfigured(): boolean {
    return !!(process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY);
  },
};
