// ── Desktop-local streaming speech-to-text ───────────────────────────────────
// The live audio stream produced by `capture_media` (stream mode) lives ONLY on
// this machine, inside the local Python agent's media bus. Cloud-ai therefore
// cannot read it back: in production the desktop talks to the REMOTE cloud-ai,
// whose `runStreamingTranscription` would fall back to ws://127.0.0.1:8765 and
// fail with ECONNREFUSED (there is no Python agent on the cloud box).
//
// So we run the windowing loop HERE, next to the audio, and only send small
// utterance-sized WAV windows to the cloud's stateless one-shot transcription
// endpoint — exactly how file-based transcription already crosses the network.
//
// Repetition / "it transcribed it 3×":
//   Whisper/Scribe/transcribe models loop-repeat a real utterance when the clip
//   handed to them has SILENCE PADDING around the speech (a classic, model-
//   independent failure — which is why it reproduced across whisper-1, scribe and
//   mai-transcribe, and why it was "certain" on the segment flushed when you stop
//   talking). The fix is at the audio layer, not text filtering: every window is
//   silence-trimmed to the speech region before it is sent, and pure-silence
//   windows are never sent at all (VAD gate). No transcript post-processing.

import { net } from 'electron';
import { execLocalTool } from '../tools/handlers/local';
import { RouterContext } from '../tools/types';

const DEFAULT_STT_MODEL = 'openai/whisper-1';

const SILENCE_VOL_PCT = 2.0;     // volumePercent below this counts as silence (window-cut timing)
const SPEECH_VOL_PCT = 4.0;      // volumePercent at/above this counts as actual speech (VAD gate)
const MIN_SPEECH_MS = 250;       // a window needs at least this much speech-level audio to be sent
const SERVER_WAIT_MS = 1500;     // server-side blocking read window
const IDLE_TIMEOUT_MS = 30000;   // give up if no audio at all for this long
const MIN_SPEECH_SEC = 0.4;      // skip windows too short (post-trim) to carry speech

// ── WAV helpers (mirror media/pcm.ts) ────────────────────────────────────────

/** Wrap raw 16-bit little-endian PCM samples in a minimal WAV (RIFF) container. */
function wrapPcm16Wav(pcm16: Buffer, sampleRate: number, channels: number): Buffer {
  const bitsPerSample = 16;
  const blockAlign = (channels * bitsPerSample) >> 3;
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm16.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm16.length, 40);
  return Buffer.concat([header, pcm16]);
}

/** Convert raw little-endian float32 PCM (~[-1,1]) into a 16-bit PCM WAV buffer. */
function float32PcmToWav(float32: Buffer, sampleRate: number, channels = 1): Buffer {
  const sampleCount = Math.floor(float32.length / 4);
  const pcm16 = Buffer.alloc(sampleCount * 2);
  for (let i = 0; i < sampleCount; i++) {
    let s = float32.readFloatLE(i * 4);
    if (Number.isNaN(s)) s = 0;
    if (s > 1) s = 1;
    else if (s < -1) s = -1;
    pcm16.writeInt16LE(Math.round(s * 32767), i * 2);
  }
  return wrapPcm16Wav(pcm16, Math.max(8000, Math.round(sampleRate) || 44100), Math.max(1, channels));
}

/** Duration (seconds) of a raw float32 PCM buffer at the given sample rate. */
function float32DurationSec(float32Bytes: number, sampleRate: number): number {
  const sr = Math.max(1, sampleRate || 44100);
  return (float32Bytes / 4) / sr;
}

/** RMS volume (as a 0–100 percent, matching the bus's volumePercent) of a float32 PCM buffer. */
function rmsPercentFromFloat32(buf: Buffer): number {
  const n = Math.floor(buf.length / 4);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const s = buf.readFloatLE(i * 4);
    if (Number.isFinite(s)) sum += s * s;
  }
  return Math.sqrt(sum / n) * 100;
}

/**
 * Trim leading/trailing silence from a float32 PCM window down to the speech
 * region (+ a small margin). Silence padding is the main trigger for STT
 * repetition loops, so every window is tightened to just the speech before it is
 * encoded. Returns an empty buffer when the window contains no speech at all.
 */
function trimSilenceFloat32(pcm: Buffer, sampleRate: number): Buffer {
  const total = Math.floor(pcm.length / 4);
  if (total === 0) return Buffer.alloc(0);
  const frame = Math.max(1, Math.floor(sampleRate * 0.02)); // 20ms analysis frames
  const nFrames = Math.ceil(total / frame);

  const rms = new Array<number>(nFrames);
  let peak = 0;
  for (let f = 0; f < nFrames; f++) {
    const start = f * frame;
    const end = Math.min(total, start + frame);
    let sum = 0;
    for (let i = start; i < end; i++) {
      const s = pcm.readFloatLE(i * 4);
      sum += s * s;
    }
    const r = Math.sqrt(sum / Math.max(1, end - start));
    rms[f] = r;
    if (r > peak) peak = r;
  }
  if (peak <= 0) return Buffer.alloc(0);

  // Adaptive threshold (relative to the loudest frame) so it works across mic
  // gains, with a low absolute floor for true silence.
  const thresh = Math.max(0.006, peak * 0.12);
  let first = 0;
  while (first < nFrames && rms[first] < thresh) first++;
  let last = nFrames - 1;
  while (last > first && rms[last] < thresh) last--;
  if (first > last) return Buffer.alloc(0);

  // Keep ~60ms of margin either side so we don't clip onsets/offsets.
  const margin = Math.ceil((0.06 * sampleRate) / frame);
  first = Math.max(0, first - margin);
  last = Math.min(nFrames - 1, last + margin);

  const startSample = first * frame;
  const endSample = Math.min(total, (last + 1) * frame);
  return pcm.subarray(startSample * 4, endSample * 4);
}

// ── Windowing (mirror media/transcription-window.ts) ─────────────────────────

interface WindowFlushParams { hardCapMs: number; minFlushMs: number; silenceGapMs: number; }
type FlushReason = 'window_full' | 'silence_gap' | null;

function shouldFlushWindow(windowMsSoFar: number, silenceMs: number, p: WindowFlushParams): FlushReason {
  if (windowMsSoFar >= p.hardCapMs) return 'window_full';
  if (windowMsSoFar >= p.minFlushMs && silenceMs >= p.silenceGapMs) return 'silence_gap';
  return null;
}

function deriveWindowParams(windowMs: number): WindowFlushParams {
  const hardCapMs = Math.max(2000, windowMs || 8000);
  return { hardCapMs, minFlushMs: Math.min(1200, hardCapMs), silenceGapMs: 280 };
}

/** Per-chunk volume percent — prefer the bus metadata, else derive from the PCM. */
function chunkVolumePercent(chunk: any, buf: Buffer): number {
  if (typeof chunk?.volumePercent === 'number') return chunk.volumePercent;
  if (typeof chunk?.volume === 'number') return chunk.volume;
  return rmsPercentFromFloat32(buf);
}

// ── Cloud calls ──────────────────────────────────────────────────────────────

function getCloudAiUrl(ctx: RouterContext): string {
  return String(ctx.cloudAiUrl || 'http://localhost:8082').trim().replace(/\/+$/, '') || 'http://localhost:8082';
}

async function resolveAccessToken(ctx: RouterContext): Promise<string | undefined> {
  if (ctx.accessToken) return ctx.accessToken;
  try {
    const { getValidMainAccessToken } = require('../services/auth-session');
    return (await getValidMainAccessToken()) || undefined;
  } catch {
    return undefined;
  }
}

/** Pick the STT model: explicit transcriptionModel, else an STT-looking model id, else default. */
function resolveSttModel(args: any): string {
  const tm = typeof args?.transcriptionModel === 'string' ? args.transcriptionModel.trim() : '';
  if (tm) return tm;
  const m = typeof args?.model === 'string' ? args.model.trim() : '';
  if (m && /whisper|transcribe|scribe/i.test(m)) return m;
  return DEFAULT_STT_MODEL;
}

/**
 * Transcribe a single WAV window via cloud-ai's stateless one-shot endpoint.
 * `streamWindow:true` asks the cloud to skip per-call billing (we bill the whole
 * session once at the end); harmless on older deploys that ignore the flag.
 */
async function transcribeWavViaCloud(
  wav: Buffer,
  sttModel: string,
  language: string | undefined,
  ctx: RouterContext,
): Promise<string> {
  const url = `${getCloudAiUrl(ctx)}/tools/ai_inference`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = await resolveAccessToken(ctx);
  if (token) headers.Authorization = `Bearer ${token}`;

  const body: any = {
    mode: 'transcription',
    transcriptionModel: sttModel,
    sources: [{ data: wav.toString('base64'), mimeType: 'audio/wav' }],
    streamWindow: true,
  };
  if (language) body.language = language;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const resp = await net.fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal as any,
    });
    if (!resp.ok) {
      ctx.logFn(`ai_inference: transcription window failed (${resp.status})`);
      return '';
    }
    const j: any = await resp.json().catch(() => ({}));
    const r = j?.result ?? j;
    if (r?.ok === false) {
      ctx.logFn(`ai_inference: transcription window error: ${r?.error || 'unknown'}`);
      return '';
    }
    return String(r?.text || '').trim();
  } catch (e: any) {
    ctx.logFn(`ai_inference: transcription window exception: ${e?.message || e}`);
    return '';
  } finally {
    clearTimeout(timer);
  }
}

/** Bill the whole session's audio in one usage event (clears the 0.1-credit floor). */
async function billSessionOnce(audioSeconds: number, sttModel: string, ctx: RouterContext): Promise<void> {
  if (!(audioSeconds > 0)) return;
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = await resolveAccessToken(ctx);
    if (token) headers.Authorization = `Bearer ${token}`;
    await net.fetch(`${getCloudAiUrl(ctx)}/tools/ai_inference`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        mode: 'transcription',
        billUsageOnly: true,
        audioSeconds: Number(audioSeconds.toFixed(3)),
        transcriptionModel: sttModel,
      }),
    });
  } catch {
    // Best-effort billing; never block teardown (also no-op on older deploys).
  }
}

// ── Public entry ─────────────────────────────────────────────────────────────

export interface DesktopStreamingTranscriptionResult {
  ok: boolean;
  streamId?: string;
  text?: string;
  model: string;
  error?: string;
}

/**
 * Run windowed streaming transcription on the desktop, reading the live audio
 * stream from the local Python agent and emitting a transcript stream the
 * workflow consumes. When args.stream is true the transcript stream id is
 * returned immediately and the loop runs detached; otherwise the audio stream is
 * drained synchronously and the joined transcript returned.
 */
export async function runDesktopStreamingTranscription(
  args: any,
  ctx: RouterContext,
): Promise<DesktopStreamingTranscriptionResult> {
  const audioStreamId = String(args?.audioStreamId || '').trim();
  const sttModel = resolveSttModel(args);
  const language: string | undefined = typeof args?.language === 'string' && args.language.trim() ? args.language.trim() : undefined;
  const windowMs = Number(args?.windowMs) > 0 ? Number(args.windowMs) : 8000;
  const maxDurationMs = Number(args?.maxDurationMs) > 0 ? Number(args.maxDurationMs) : 0;
  const stopSessionId: string | undefined = typeof args?.stopSessionId === 'string' && args.stopSessionId.trim() ? args.stopSessionId.trim() : undefined;
  const streamOut = !!args?.stream;

  if (!audioStreamId) {
    return { ok: false, error: 'audioStreamId is required for streaming transcription', model: sttModel };
  }

  const windowParams = deriveWindowParams(windowMs);

  // Subscribe to the live audio stream (lives in the local Python agent).
  const sub = await execLocalTool('stream_subscribe', {
    streamId: audioStreamId,
    label: 'ai_inference:transcribe',
    fromStart: true,
  }, ctx, 30000);
  if (!sub?.ok || !sub?.subscriberId) {
    return { ok: false, error: `failed to subscribe to audio stream ${audioStreamId}`, model: sttModel };
  }
  const subscriberId = sub.subscriberId as string;

  // Create the transcript output stream up front (streaming mode).
  // NOTE: deliberately NO flowId — the transcript stream's lifecycle is tied to
  // the AUDIO stream, not the workflow run. A hotkey-toggle dictation starts the
  // capture in one run and stops it in a later run, so the transcript must
  // outlive the start run. It self-closes when the audio stream closes (below).
  let outStreamId = '';
  if (streamOut) {
    const created = await execLocalTool('stream_create', {
      kind: 'text',
      sourceStepId: 'ai_inference',
      metadata: { transcription: true, model: sttModel, audioStreamId },
    }, ctx, 30000);
    if (!created?.ok || !created?.streamId) {
      await execLocalTool('stream_unsubscribe', { streamId: audioStreamId, subscriberId }, ctx).catch(() => {});
      return { ok: false, error: 'failed to create transcript output stream', model: sttModel };
    }
    outStreamId = created.streamId;
  }

  const joined: string[] = [];

  const loop = async () => {
    let pending: Buffer[] = [];
    let pendingBytes = 0;
    let pendingSpeechMs = 0; // ms of speech-level audio accumulated in the current window
    let sampleRate = 44100;
    let silenceMs = 0;
    const startedAt = Date.now();
    let lastDataAt = Date.now();
    let stopRequested = false;
    let billableAudioSec = 0; // sum of transcribed windows → billed once at close

    const flush = async (_reason: string) => {
      if (pendingBytes <= 0) return;
      const raw = Buffer.concat(pending, pendingBytes);
      const speechMs = pendingSpeechMs;
      pending = [];
      pendingBytes = 0;
      pendingSpeechMs = 0;
      silenceMs = 0;
      // VAD gate: a window with no real speech is silence/noise — never send it.
      if (speechMs < MIN_SPEECH_MS) return;
      // Trim silence padding so the model gets a tight speech clip (no padding =
      // no repetition loop). The flush that fires when you STOP talking is the one
      // that always carried trailing silence — this is what made it "certain".
      const pcm = trimSilenceFloat32(raw, sampleRate);
      const windowSec = float32DurationSec(pcm.length, sampleRate);
      if (windowSec < MIN_SPEECH_SEC) return;
      const wav = float32PcmToWav(pcm, sampleRate, 1);
      const text = await transcribeWavViaCloud(wav, sttModel, language, ctx);
      billableAudioSec += windowSec;
      if (!text) return;
      joined.push(text);
      if (streamOut && outStreamId) {
        // Trailing space so a consumer's accumulated fullText reads naturally.
        await execLocalTool('stream_write', { streamId: outStreamId, chunk: text + ' ', chunkType: 'raw' }, ctx).catch(() => {});
      }
    };

    try {
      while (true) {
        const read = await execLocalTool('stream_read', {
          streamId: audioStreamId,
          subscriberId,
          maxChunks: 50,
          waitMs: SERVER_WAIT_MS,
          asBase64: true,
        }, ctx, SERVER_WAIT_MS + 8000);

        if (read?.ok && Array.isArray(read.chunks) && read.chunks.length > 0) {
          lastDataAt = Date.now();
          for (const chunk of read.chunks) {
            const dataB64 = typeof chunk?.data === 'string' ? chunk.data : '';
            if (!dataB64) continue;
            const buf = Buffer.from(dataB64, 'base64');
            if (buf.length === 0) continue;
            if (typeof chunk?.sampleRate === 'number' && chunk.sampleRate > 0) {
              sampleRate = chunk.sampleRate;
            }
            pending.push(buf);
            pendingBytes += buf.length;

            const chunkMs = float32DurationSec(buf.length, sampleRate) * 1000;
            const vol = chunkVolumePercent(chunk, buf);
            if (vol < SILENCE_VOL_PCT) silenceMs += chunkMs;
            else silenceMs = 0;
            if (vol >= SPEECH_VOL_PCT) pendingSpeechMs += chunkMs;

            const windowMsSoFar = float32DurationSec(pendingBytes, sampleRate) * 1000;
            const reason = shouldFlushWindow(windowMsSoFar, silenceMs, windowParams);
            if (reason) await flush(reason);
          }
        }

        // Stop the capture session once the requested duration elapses, then keep
        // draining so the final audio still gets transcribed before close.
        if (!stopRequested && maxDurationMs > 0 && Date.now() - startedAt >= maxDurationMs) {
          stopRequested = true;
          if (stopSessionId) {
            await execLocalTool('stop_capture', { sessionId: stopSessionId }, ctx).catch(() => {});
          }
        }

        if (read?.closed) {
          await flush('stream_closed');
          break;
        }
        if (Date.now() - lastDataAt > IDLE_TIMEOUT_MS) {
          await flush('idle_timeout');
          break;
        }
      }
    } finally {
      await billSessionOnce(billableAudioSec, sttModel, ctx);
      await execLocalTool('stream_unsubscribe', { streamId: audioStreamId, subscriberId }, ctx).catch(() => {});
      if (streamOut && outStreamId) {
        await execLocalTool('stream_close', { streamId: outStreamId }, ctx).catch(() => {});
      }
    }
  };

  if (streamOut) {
    // Fire-and-forget; the output streamId is the handle the workflow consumes.
    loop().catch((err: any) => ctx.logFn(`ai_inference: streaming transcription error: ${err?.message || err}`));
    return { ok: true, streamId: outStreamId, model: sttModel };
  }

  await loop();
  return { ok: true, text: joined.join(' ').trim(), model: sttModel };
}
