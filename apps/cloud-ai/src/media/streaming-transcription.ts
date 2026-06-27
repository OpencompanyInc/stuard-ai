// ── Streaming speech-to-text ────────────────────────────────────────────────
// OpenRouter / ElevenLabs STT are one-shot (whole-clip in, whole-transcript out),
// so there is no native streaming transcription endpoint. We make EVERY model
// behave like a streaming transcriber by consuming a live audio stream, slicing
// it into utterance-sized windows (flushed on a silence gap or a hard time cap),
// transcribing each window one-shot, and pushing the partial transcript onto an
// output text stream as it lands. Works for any model the one-shot path supports.

import { execLocalTool, safeToolWrite } from '../tools/bridge';
import { transcribeAudio } from './transcription';
import { float32PcmToWav, float32DurationSec } from './pcm';
import { shouldFlushWindow, deriveWindowParams } from './transcription-window';
import { sttCostUsd } from '../pricing';
import { writeLog } from '../utils/logger';

export interface StreamingTranscriptionOpts {
  audioStreamId: string;
  sttModel: string;
  language?: string;
  windowMs: number;        // hard cap before a window is force-flushed
  maxDurationMs: number;   // 0 = run until the audio stream closes
  stopSessionId?: string;  // capture session to stop_capture when maxDuration elapses
  sampleRateHint?: number;
  streamOut: boolean;      // true → emit to an output stream; false → return joined text
  writer: any;
  flowId?: string;         // owning workflow id — scopes the output stream for cleanup

  /**
   * Optional usage/billing hook. Invoked with the cost + audio-seconds
   * accumulated across the session (flushed periodically and at close), NOT
   * per window — so the per-event credit floor applies to the session total.
   */
  logUsage?: (model: string, usage: any) => Promise<void>;
}

const SILENCE_VOL_PCT = 2.0;     // volumePercent below this counts as silence
const SERVER_WAIT_MS = 1500;     // server-side blocking read window
const IDLE_TIMEOUT_MS = 30000;   // give up if no audio at all for this long
const MIN_SPEECH_SEC = 0.4;      // skip windows too short to carry speech
const BILL_FLUSH_AUDIO_SEC = 300; // emit a usage event at least every ~5 min of audio

/**
 * Consume an audio stream and emit/accumulate transcripts window-by-window.
 * When streamOut is true an output text stream is created and its id returned
 * immediately while transcription continues in the background; otherwise the
 * stream is drained synchronously and the joined transcript is returned.
 */
export async function runStreamingTranscription(
  opts: StreamingTranscriptionOpts,
): Promise<{ ok: boolean; streamId?: string; text?: string; model: string; error?: string }> {
  const { audioStreamId, sttModel, language, windowMs, maxDurationMs, stopSessionId, writer } = opts;

  // A window flushes early on a short silence gap (so we transcribe whole
  // utterances), and is hard-capped at windowMs.
  const windowParams = deriveWindowParams(windowMs);

  // Subscribe to the live audio stream.
  const sub = await execLocalTool('stream_subscribe', {
    streamId: audioStreamId,
    label: 'ai_inference:transcribe',
    fromStart: true,
  });
  if (!sub?.ok || !sub?.subscriberId) {
    return { ok: false, error: `failed to subscribe to audio stream ${audioStreamId}`, model: sttModel };
  }
  const subscriberId = sub.subscriberId as string;

  // For streaming output, create the output text stream up front.
  let outStreamId = '';
  if (opts.streamOut) {
    const created = await execLocalTool('stream_create', {
      kind: 'text',
      sourceStepId: 'ai_inference',
      ...(opts.flowId ? { flowId: opts.flowId } : {}),
      metadata: { transcription: true, model: sttModel, audioStreamId },
    });
    if (!created?.ok || !created?.streamId) {
      await execLocalTool('stream_unsubscribe', { streamId: audioStreamId, subscriberId }).catch(() => {});
      return { ok: false, error: 'failed to create transcript output stream', model: sttModel };
    }
    outStreamId = created.streamId;
  }

  const joined: string[] = [];

  // The actual consume/window/transcribe loop. For streamOut we run it detached.
  const loop = async () => {
    let pending: Buffer[] = [];
    let pendingBytes = 0;
    let sampleRate = opts.sampleRateHint || 44100;
    let silenceMs = 0;
    const startedAt = Date.now();
    let lastDataAt = Date.now();
    let stopRequested = false;

    // ── Session-level billing accumulation ────────────────────────────────────
    // STT is billed by audio duration upstream, so we sum cost + audio across the
    // whole session and emit usage events that clear the 0.1-credit floor —
    // periodically (every BILL_FLUSH_AUDIO_SEC of audio) and once at close. Billing
    // per window would floor every short utterance to 0.1 credits ("0.1 per word").
    let pendingBillSec = 0;
    let pendingBillUsd = 0;

    const flushBilling = async () => {
      const audioSeconds = pendingBillSec;
      const costUsd = pendingBillUsd;
      pendingBillSec = 0;
      pendingBillUsd = 0;
      if (!opts.logUsage) return;
      if (audioSeconds <= 0 && costUsd <= 0) return;
      await opts.logUsage(sttModel, {
        costUsd: Number(costUsd.toFixed(8)),
        audioSeconds: Number(audioSeconds.toFixed(3)),
      });
    };

    const flush = async (reason: string) => {
      if (pendingBytes <= 0) return;
      const pcm = Buffer.concat(pending, pendingBytes);
      pending = [];
      pendingBytes = 0;
      silenceMs = 0;
      // Skip windows too short to carry speech.
      const windowSec = float32DurationSec(pcm.length, sampleRate);
      if (windowSec < MIN_SPEECH_SEC) return;
      try {
        const wav = float32PcmToWav(pcm, sampleRate, 1);
        const result = await transcribeAudio(wav, 'audio/wav', language, sttModel);
        const text = (result.transcript || '').trim();

        // Accumulate cost: prefer the provider's reported amount, otherwise price
        // by the audio duration we just transcribed (how STT is billed upstream).
        const providerCost = Number(result.usage?.cost);
        const windowUsd =
          Number.isFinite(providerCost) && providerCost > 0
            ? providerCost
            : sttCostUsd(sttModel, windowSec);
        pendingBillSec += windowSec;
        pendingBillUsd += windowUsd;
        if (pendingBillSec >= BILL_FLUSH_AUDIO_SEC) {
          await flushBilling();
        }

        if (!text) return;
        joined.push(text);
        if (opts.streamOut && outStreamId) {
          // Trailing space so a consumer's accumulated fullText reads naturally.
          await execLocalTool('stream_write', { streamId: outStreamId, chunk: text + ' ', chunkType: 'raw' }).catch(() => {});
        }
        await safeToolWrite(writer, {
          type: 'tool_event',
          tool: 'ai_inference',
          status: 'transcript_chunk',
          mode: 'transcription',
          reason,
          text,
        });
      } catch (err: any) {
        writeLog('ai_inference_transcription_window_error', { error: err?.message });
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
        });

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
            const vol = typeof chunk?.volumePercent === 'number' ? chunk.volumePercent : 100;
            if (vol < SILENCE_VOL_PCT) silenceMs += chunkMs;
            else silenceMs = 0;

            const windowMsSoFar = float32DurationSec(pendingBytes, sampleRate) * 1000;
            const reason = shouldFlushWindow(windowMsSoFar, silenceMs, windowParams);
            if (reason) {
              await flush(reason);
            }
          }
        }

        // Stop the capture session once the requested duration elapses, then keep
        // draining so the final audio still gets transcribed before close.
        if (!stopRequested && maxDurationMs > 0 && Date.now() - startedAt >= maxDurationMs) {
          stopRequested = true;
          if (stopSessionId) {
            await execLocalTool('stop_capture', { sessionId: stopSessionId }).catch(() => {});
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
      // Bill whatever audio accumulated since the last flush before tearing down.
      await flushBilling().catch(() => {});
      await execLocalTool('stream_unsubscribe', { streamId: audioStreamId, subscriberId }).catch(() => {});
      if (opts.streamOut && outStreamId) {
        await execLocalTool('stream_close', { streamId: outStreamId }).catch(() => {});
      }
    }
  };

  if (opts.streamOut) {
    // Fire-and-forget; the output streamId is the handle the workflow consumes.
    loop().catch((err: any) => writeLog('ai_inference_transcription_stream_error', { error: err?.message }));
    return { ok: true, streamId: outStreamId, model: sttModel };
  }

  await loop();
  return { ok: true, text: joined.join(' ').trim(), model: sttModel };
}
