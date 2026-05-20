/**
 * Google Gemini Live API Voice Provider
 *
 * Connects to Gemini's Live API via WebSocket for real-time multimodal
 * voice (and optional vision) conversations. Default model is
 * `gemini-3.1-flash-live-preview` — Google's current audio-to-audio model
 * (released March 2026) that replaced `gemini-2.5-flash-native-audio-preview-12-2025`.
 *
 * Audio: Gemini expects PCM16 16kHz input and outputs PCM16 24kHz.
 * For telephony (µ-law 8kHz), this provider transcodes in both directions:
 *   Telnyx µ-law 8kHz → PCM16 16kHz → Gemini
 *   Gemini → PCM16 24kHz → µ-law 8kHz → Telnyx
 *
 * Vision: callers can hand JPEG frames to `sendImage()` and they get
 * forwarded as `realtimeInput.video` blobs. Google recommends ≤1 FPS;
 * sessions that mix audio + video are capped at ~2 minutes by Google.
 *
 * Protocol: uses the post-2025 `realtimeInput.audio` / `realtimeInput.video`
 * keys (NOT the legacy `mediaChunks` array, which the new models reject).
 *
 * Docs: https://ai.google.dev/gemini-api/docs/live-api
 */

import { WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import type { VoiceProvider, VoiceSession, VoiceSessionConfig, AudioFormat } from './types';
import { computeVoiceCostUsd } from './voice-pricing';

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

/**
 * Strip schema fields Gemini Live rejects.
 *
 * Gemini's function-declaration schema is OpenAPI-subset and chokes on
 * JSON-Schema extras like `additionalProperties`, `$schema`, `definitions`,
 * `oneOf`/`anyOf` at unsupported depths. We also normalize empty object
 * properties to an explicit empty map so the validator doesn't reject
 * `{ type: 'object' }` with no `properties`.
 */
function sanitizeGeminiSchema(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(sanitizeGeminiSchema);

  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'additionalProperties' || key === '$schema' || key === 'definitions' || key === '$ref') continue;
    if (key === 'properties' && value && typeof value === 'object') {
      const props: Record<string, any> = {};
      for (const [pk, pv] of Object.entries(value as Record<string, any>)) {
        props[pk] = sanitizeGeminiSchema(pv);
      }
      out[key] = props;
    } else if (key === 'items') {
      out[key] = sanitizeGeminiSchema(value);
    } else {
      out[key] = value;
    }
  }

  // If an object type declares no properties, give it an empty map so Gemini
  // accepts it (its validator rejects bare `{ type: 'object' }`).
  if (out.type === 'object' && !out.properties) {
    out.properties = {};
  }

  return out;
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
  // Gemini requires matching `name` on tool responses, so remember the name
  // registered against each in-flight call id.
  private pendingCallNames = new Map<string, string>();
  // Transcription events are delta fragments, not cumulative. We buffer per
  // turn so the client (which replaces non-final lines from the same role)
  // can keep growing the partial line until generation completes.
  private inputTranscriptBuffer = '';
  private outputTranscriptBuffer = '';
  private framesSent = 0;
  // Gemini Live `usageMetadata` reports cumulative session totals, not per-turn
  // deltas. We track the last reported counts so the bridge can settleIncrement
  // with just the new tokens.
  private lastUsage = {
    promptTextTokens: 0,
    promptAudioTokens: 0,
    promptCachedTokens: 0,
    responseTextTokens: 0,
    responseAudioTokens: 0,
  };
  private resolvedModelId = '';

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

    const model = this.config.model || process.env.GEMINI_LIVE_MODEL || 'gemini-3.1-flash-live-preview';
    this.resolvedModelId = model;
    const wsUrl = `${GEMINI_LIVE_URL}?key=${encodeURIComponent(apiKey)}`;

    this.ws = new WebSocket(wsUrl);

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Gemini Live connection timeout')), 15000);
      let resolved = false;

      this.ws!.on('open', () => {
        this._active = true;

        // Gemini Live API setup message.
        // inputAudioTranscription / outputAudioTranscription must live at the
        // `setup` level (NOT inside generationConfig) and are required for the
        // server to emit `serverContent.inputTranscription` /
        // `serverContent.outputTranscription` events that drive our UI text.
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
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            realtimeInputConfig: {
              automaticActivityDetection: {
                disabled: false,
                startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
                endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH',
                prefixPaddingMs: 200,
                silenceDurationMs: 300,
              },
              activityHandling: 'START_OF_ACTIVITY_INTERRUPTS',
              turnCoverage: 'TURN_INCLUDES_AUDIO_ACTIVITY_AND_ALL_VIDEO',
            },
          },
        };

        if (this.config.systemPrompt) {
          setupMsg.setup.systemInstruction = {
            parts: [{ text: this.config.systemPrompt }],
          };
        }

        // Register function-calling tools. Gemini groups declarations under a
        // single tools[0].functionDeclarations array.
        if (this.config.tools && this.config.tools.length > 0) {
          setupMsg.setup.tools = [{
            functionDeclarations: this.config.tools.map((t) => ({
              name: t.name,
              description: t.description,
              parameters: sanitizeGeminiSchema(t.parameters),
            })),
          }];
          console.log('[gemini-live] Registering tools:', this.config.tools.map((t) => t.name).join(', '));
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

          // A single serverContent event can carry audio chunks AND transcript
          // partials together — process every field, don't `else if`.
          const serverContent = msg.serverContent;
          if (serverContent) {
            // Audio chunks live in modelTurn.parts[].inlineData
            if (serverContent.modelTurn?.parts) {
              for (const part of serverContent.modelTurn.parts) {
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

                // For TEXT-modality sessions a `part.text` still arrives here.
                if (part.text) {
                  this.config.onTranscript?.('assistant', part.text, false);
                }
              }
            }

            // Streamed transcripts (only emitted when inputAudioTranscription /
            // outputAudioTranscription were enabled in `setup`). Each event is
            // an incremental delta — buffer locally and emit the *cumulative*
            // partial so the client can render a growing line.
            if (serverContent.inputTranscription?.text) {
              this.inputTranscriptBuffer += serverContent.inputTranscription.text;
              this.config.onTranscript?.('user', this.inputTranscriptBuffer, false);
            }
            if (serverContent.outputTranscription?.text) {
              this.outputTranscriptBuffer += serverContent.outputTranscription.text;
              this.config.onTranscript?.('assistant', this.outputTranscriptBuffer, false);
            }

            // Turn boundary — flush the buffered lines as final and reset.
            if (serverContent.generationComplete || serverContent.turnComplete) {
              if (this.inputTranscriptBuffer) {
                this.config.onTranscript?.('user', this.inputTranscriptBuffer, true);
                this.inputTranscriptBuffer = '';
              }
              if (this.outputTranscriptBuffer) {
                this.config.onTranscript?.('assistant', this.outputTranscriptBuffer, true);
                this.outputTranscriptBuffer = '';
              }
            }
          }

          // Usage report — cumulative session totals. Compute the delta from
          // the last reported counts and emit a per-turn usage event with
          // provider-computed cost (voice models charge audio tokens at much
          // higher rates than text — recomputing from a flat token count
          // would underbill).
          const usageMeta = msg.usageMetadata;
          if (usageMeta) {
            try {
              this.emitUsageDelta(usageMeta);
            } catch (err: any) {
              console.warn('[gemini-live] usage emit failed:', err?.message);
            }
          }

          // Tool/function call — Gemini sends { toolCall: { functionCalls: [...] } }
          if (msg.toolCall?.functionCalls?.length) {
            for (const call of msg.toolCall.functionCalls) {
              const callId = String(call.id || call.name || randomUUID());
              const fnName = String(call.name || '');
              const args = call.args ?? {};
              const argsJson = typeof args === 'string' ? args : JSON.stringify(args);
              this.pendingCallNames.set(callId, fnName);
              console.log('[gemini-live] Function call:', { callId, fnName });
              this.config.onFunctionCall?.(callId, fnName, argsJson);
            }
          }

          // Tool call cancellation — model bailed before we responded; nothing to send back
          if (msg.toolCallCancellation?.ids?.length) {
            console.log('[gemini-live] Tool call cancelled:', msg.toolCallCancellation.ids);
            for (const id of msg.toolCallCancellation.ids) {
              this.pendingCallNames.delete(String(id));
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

  private emitUsageDelta(usageMeta: any): void {
    const promptDetails = Array.isArray(usageMeta?.promptTokensDetails) ? usageMeta.promptTokensDetails : [];
    const responseDetails = Array.isArray(usageMeta?.responseTokensDetails) ? usageMeta.responseTokensDetails : [];

    const sumByModality = (details: any[], modality: string): number => {
      let sum = 0;
      for (const d of details) {
        const m = String(d?.modality || '').toUpperCase();
        if (m === modality) sum += Math.max(0, Number(d?.tokenCount || 0));
      }
      return sum;
    };

    // Prefer per-modality details; fall back to the flat counts so we never
    // miss a charge when Google omits the breakdown.
    let promptTextTokens = sumByModality(promptDetails, 'TEXT');
    let promptAudioTokens = sumByModality(promptDetails, 'AUDIO');
    if (promptTextTokens + promptAudioTokens === 0) {
      promptTextTokens = Math.max(0, Number(usageMeta?.promptTokenCount || 0));
    }
    let responseTextTokens = sumByModality(responseDetails, 'TEXT');
    let responseAudioTokens = sumByModality(responseDetails, 'AUDIO');
    if (responseTextTokens + responseAudioTokens === 0) {
      responseAudioTokens = Math.max(0, Number(usageMeta?.responseTokenCount || 0));
    }
    const promptCachedTokens = Math.max(0, Number(usageMeta?.cachedContentTokenCount || 0));

    const deltaPromptText = Math.max(0, promptTextTokens - this.lastUsage.promptTextTokens);
    const deltaPromptAudio = Math.max(0, promptAudioTokens - this.lastUsage.promptAudioTokens);
    const deltaPromptCached = Math.max(0, promptCachedTokens - this.lastUsage.promptCachedTokens);
    const deltaResponseText = Math.max(0, responseTextTokens - this.lastUsage.responseTextTokens);
    const deltaResponseAudio = Math.max(0, responseAudioTokens - this.lastUsage.responseAudioTokens);

    this.lastUsage = {
      promptTextTokens,
      promptAudioTokens,
      promptCachedTokens,
      responseTextTokens,
      responseAudioTokens,
    };

    if (deltaPromptText + deltaPromptAudio + deltaResponseText + deltaResponseAudio === 0) return;

    const costUsd = computeVoiceCostUsd('gemini-live', this.resolvedModelId, {
      textInputTokens: deltaPromptText,
      audioInputTokens: deltaPromptAudio,
      textOutputTokens: deltaResponseText,
      audioOutputTokens: deltaResponseAudio,
      cachedInputTokens: deltaPromptCached,
    });

    this.config.onUsage?.({
      model: `google/${this.resolvedModelId}`,
      inputTokens: deltaPromptText + deltaPromptAudio,
      outputTokens: deltaResponseText + deltaResponseAudio,
      cachedInputTokens: deltaPromptCached,
      inputTextTokens: deltaPromptText,
      inputAudioTokens: deltaPromptAudio,
      outputTextTokens: deltaResponseText,
      outputAudioTokens: deltaResponseAudio,
      costUsd,
      raw: usageMeta,
    });
  }

  sendAudio(audioBase64: string): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    let pcmB64 = audioBase64;

    if (this.needsTranscoding) {
      // µ-law 8kHz → PCM16 16kHz
      pcmB64 = ulawToPcm16_16k(audioBase64);
    } else if (this.needsDownsample) {
      // PCM16 24kHz → PCM16 16kHz (browser sends 24kHz, Gemini expects 16kHz)
      pcmB64 = pcm16_24kTo16k(audioBase64);
    }

    // Live API v1beta post-2025 protocol: realtimeInput.audio (NOT mediaChunks)
    this.ws.send(JSON.stringify({
      realtimeInput: {
        audio: {
          mimeType: 'audio/pcm;rate=16000',
          data: pcmB64,
        },
      },
    }));
  }

  /**
   * Send a single video/image frame (JPEG or PNG) to the model.
   * Gemini Live recommends ≤1 FPS. Caller must base64-encode the frame.
   */
  sendImage(imageBase64: string, mimeType: string = 'image/jpeg'): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.framesSent += 1;
    if (this.framesSent === 1 || this.framesSent % 30 === 0) {
      console.log(`[gemini-live] vision frames sent so far: ${this.framesSent}`);
    }
    this.ws.send(JSON.stringify({
      realtimeInput: {
        video: {
          mimeType,
          data: imageBase64,
        },
      },
    }));
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

  sendFunctionResult(callId: string, result: string): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    // Gemini expects response as a JSON object. Our voice runtime hands us a
    // JSON-encoded string (possibly truncated); parse back when possible and
    // fall back to wrapping the raw text so the model still gets something.
    let response: any;
    try {
      response = JSON.parse(result);
      if (response === null || typeof response !== 'object' || Array.isArray(response)) {
        response = { result: response };
      }
    } catch {
      response = { result };
    }

    const fnName = this.pendingCallNames.get(callId) || callId;
    this.pendingCallNames.delete(callId);

    this.ws.send(JSON.stringify({
      toolResponse: {
        functionResponses: [{
          id: callId,
          name: fnName,
          response,
        }],
      },
    }));
  }

  interrupt(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    // Automatic VAD handles normal barge-in. For an explicit "stop talking"
    // control, send clientContent: the Live API treats any clientContent
    // message as an interruption to current model generation.
    this.ws.send(JSON.stringify({
      clientContent: {
        turns: [{
          role: 'user',
          parts: [{ text: '[User interrupted the response. Stop speaking and listen.]' }],
        }],
        turnComplete: false,
      },
    }));
  }

  close(reason?: string): void {
    this._active = false;
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      this.ws.close(1000, reason || 'session_closed');
    }
    this.ws = null;
    this.audioCallbacks = [];
    this.pendingCallNames.clear();
  }

  isActive(): boolean {
    return this._active && this.ws?.readyState === WebSocket.OPEN;
  }
}

export const geminiLiveProvider: VoiceProvider = {
  id: 'gemini-live',
  name: 'Google Gemini Live',
  supportsToolCalling: true,
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
