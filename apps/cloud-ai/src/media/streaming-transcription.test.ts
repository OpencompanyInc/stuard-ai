import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the bridge (local-tool RPC) and the one-shot STT provider so we can drive
// the streaming loop deterministically without an audio stream or network.
vi.mock('../tools/bridge', () => ({
  execLocalTool: vi.fn(),
  safeToolWrite: vi.fn(async () => {}),
}));
vi.mock('./transcription', () => ({
  transcribeAudio: vi.fn(),
}));
vi.mock('../utils/logger', () => ({ writeLog: vi.fn() }));

import { runStreamingTranscription } from './streaming-transcription';
import { execLocalTool } from '../tools/bridge';
import { transcribeAudio } from './transcription';

const execMock = vi.mocked(execLocalTool);
const transcribeMock = vi.mocked(transcribeAudio);

const SR = 16000;

/** base64 of `seconds` worth of mono float32 PCM at SR, all at `value`. */
function audioChunk(seconds: number, value: number): string {
  const samples = Math.round(seconds * SR);
  const buf = Buffer.alloc(samples * 4);
  for (let i = 0; i < samples; i++) buf.writeFloatLE(value, i * 4);
  return buf.toString('base64');
}

/** A "loud" 0.5s chunk + metadata. */
function loud() {
  return { data: audioChunk(0.5, 0.3), volumePercent: 30, sampleRate: SR };
}
/** A "silent" 0.5s chunk (volume below the silence threshold). */
function silent() {
  return { data: audioChunk(0.5, 0.0), volumePercent: 0, sampleRate: SR };
}

/**
 * Wire execLocalTool so that stream_read returns the given scripted responses
 * in order (and "closed" once exhausted). Returns the mock for assertions.
 */
function scriptReads(reads: any[], opts?: { readDelayMs?: number; outStream?: boolean }) {
  const queue = [...reads];
  execMock.mockImplementation(async (tool: string) => {
    if (tool === 'stream_subscribe') return { ok: true, subscriberId: 'sub-1' };
    if (tool === 'stream_create') return { ok: true, streamId: 'out-1' };
    if (tool === 'stream_read') {
      if (opts?.readDelayMs) await new Promise(r => setTimeout(r, opts.readDelayMs));
      return queue.shift() ?? { ok: true, chunks: [], closed: true };
    }
    return { ok: true };
  });
}

beforeEach(() => {
  execMock.mockReset();
  transcribeMock.mockReset();
  let n = 0;
  transcribeMock.mockImplementation(async (_buf, _mime, _lang, model) => {
    n += 1;
    return { transcript: n === 1 ? 'hello world' : 'second window', model: String(model), usage: { cost: 0.001, seconds: 2 } };
  });
});

describe('runStreamingTranscription (drain mode, streamOut=false)', () => {
  it('windows audio on silence gaps and returns the joined transcript', async () => {
    // Two utterances, each = 3 loud chunks (1.5s) + a trailing silence chunk → flush.
    scriptReads([
      { ok: true, chunks: [loud(), loud(), loud(), silent()], closed: false },
      { ok: true, chunks: [loud(), loud(), loud(), silent()], closed: false },
      { ok: true, chunks: [], closed: true },
    ]);

    const res = await runStreamingTranscription({
      audioStreamId: 'audio-stream',
      sttModel: 'openai/whisper-1',
      windowMs: 8000,
      maxDurationMs: 0,
      streamOut: false,
      writer: null,
    });

    expect(res.ok).toBe(true);
    expect(res.text).toBe('hello world second window');
    expect(transcribeMock).toHaveBeenCalledTimes(2);

    // Each transcribed window must be a valid WAV (RIFF header) of ~2s.
    const firstWav = transcribeMock.mock.calls[0][0] as Buffer;
    expect(firstWav.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(firstWav.subarray(8, 12).toString('ascii')).toBe('WAVE');
    expect(firstWav.readUInt32LE(24)).toBe(SR); // sample rate carried from chunk metadata

    // Cleanup: subscribed and unsubscribed; no output stream created in drain mode.
    expect(execMock).toHaveBeenCalledWith('stream_subscribe', expect.objectContaining({ streamId: 'audio-stream' }));
    expect(execMock).toHaveBeenCalledWith('stream_unsubscribe', expect.objectContaining({ subscriberId: 'sub-1' }));
    expect(execMock).not.toHaveBeenCalledWith('stream_create', expect.anything());
  });

  it('force-flushes at the hard cap even without a silence gap', async () => {
    // 5 loud chunks = 2.5s of continuous speech, hard cap = 2000ms → must flush.
    scriptReads([
      { ok: true, chunks: [loud(), loud(), loud(), loud(), loud()], closed: false },
      { ok: true, chunks: [], closed: true },
    ]);

    const res = await runStreamingTranscription({
      audioStreamId: 'audio-stream',
      sttModel: 'openai/gpt-4o-transcribe',
      windowMs: 2000,
      maxDurationMs: 0,
      streamOut: false,
      writer: null,
    });

    expect(res.ok).toBe(true);
    expect(transcribeMock).toHaveBeenCalled();
  });

  it('bills once at stream close with the session-accumulated cost', async () => {
    scriptReads([
      { ok: true, chunks: [loud(), loud(), loud(), silent()], closed: false },
      { ok: true, chunks: [], closed: true },
    ]);
    const logUsage = vi.fn(async () => {});

    await runStreamingTranscription({
      audioStreamId: 'audio-stream',
      sttModel: 'openai/whisper-1',
      windowMs: 8000,
      maxDurationMs: 0,
      streamOut: false,
      writer: null,
      logUsage,
    });

    expect(logUsage).toHaveBeenCalledTimes(1);
    expect(logUsage).toHaveBeenCalledWith(
      'openai/whisper-1',
      expect.objectContaining({ costUsd: 0.001, audioSeconds: 2 }),
    );
  });

  it('accumulates billing across windows into a single session usage event', async () => {
    // Two utterances → two transcribed windows. Billing must NOT fire per window
    // (that floors each tiny utterance to 0.1 credits — the "0.1 per word" bug);
    // it sums to one event with the combined cost + audio duration.
    scriptReads([
      { ok: true, chunks: [loud(), loud(), loud(), silent()], closed: false },
      { ok: true, chunks: [loud(), loud(), loud(), silent()], closed: false },
      { ok: true, chunks: [], closed: true },
    ]);
    const logUsage = vi.fn(async () => {});

    await runStreamingTranscription({
      audioStreamId: 'audio-stream',
      sttModel: 'openai/whisper-1',
      windowMs: 8000,
      maxDurationMs: 0,
      streamOut: false,
      writer: null,
      logUsage,
    });

    expect(transcribeMock).toHaveBeenCalledTimes(2);
    expect(logUsage).toHaveBeenCalledTimes(1);
    // 2 windows × $0.001 provider cost, 2 windows × 2s audio.
    expect(logUsage).toHaveBeenCalledWith(
      'openai/whisper-1',
      expect.objectContaining({ costUsd: 0.002, audioSeconds: 4 }),
    );
  });

  it('prices by audio duration when the provider reports no cost', async () => {
    // Provider returns a transcript but no usage → fall back to duration pricing
    // (whisper-1 ≈ $0.006/min). One 2s window → 2/60 × 0.006 = $0.0002.
    transcribeMock.mockImplementation(async (_buf, _mime, _lang, model) => ({
      transcript: 'no usage here',
      model: String(model),
    }));
    scriptReads([
      { ok: true, chunks: [loud(), loud(), loud(), silent()], closed: false },
      { ok: true, chunks: [], closed: true },
    ]);
    const logUsage = vi.fn(async () => {});

    await runStreamingTranscription({
      audioStreamId: 'audio-stream',
      sttModel: 'openai/whisper-1',
      windowMs: 8000,
      maxDurationMs: 0,
      streamOut: false,
      writer: null,
      logUsage,
    });

    expect(logUsage).toHaveBeenCalledTimes(1);
    expect(logUsage).toHaveBeenCalledWith(
      'openai/whisper-1',
      expect.objectContaining({ costUsd: 0.0002, audioSeconds: 2 }),
    );
  });

  it('returns an error if it cannot subscribe to the audio stream', async () => {
    execMock.mockImplementation(async (tool: string) => {
      if (tool === 'stream_subscribe') return { ok: false };
      return { ok: true };
    });

    const res = await runStreamingTranscription({
      audioStreamId: 'bad-stream',
      sttModel: 'openai/whisper-1',
      windowMs: 8000,
      maxDurationMs: 0,
      streamOut: false,
      writer: null,
    });

    expect(res.ok).toBe(false);
    expect(transcribeMock).not.toHaveBeenCalled();
  });

  it('stops the capture session once maxDurationMs elapses', async () => {
    scriptReads(
      [
        { ok: true, chunks: [loud(), loud(), loud(), silent()], closed: false },
        { ok: true, chunks: [], closed: true },
      ],
      { readDelayMs: 5 }, // let wall-clock advance past maxDurationMs
    );

    await runStreamingTranscription({
      audioStreamId: 'audio-stream',
      sttModel: 'openai/whisper-1',
      windowMs: 8000,
      maxDurationMs: 1,
      stopSessionId: 'rec',
      streamOut: false,
      writer: null,
    });

    expect(execMock).toHaveBeenCalledWith('stop_capture', { sessionId: 'rec' });
  });
});

describe('runStreamingTranscription (live mode, streamOut=true)', () => {
  it('returns an output streamId immediately and emits transcript chunks to it', async () => {
    scriptReads([
      { ok: true, chunks: [loud(), loud(), loud(), silent()], closed: false },
      { ok: true, chunks: [], closed: true },
    ]);

    const res = await runStreamingTranscription({
      audioStreamId: 'audio-stream',
      sttModel: 'openai/whisper-1',
      windowMs: 8000,
      maxDurationMs: 0,
      streamOut: true,
      writer: null,
      flowId: 'flow_abc',
    });

    // Handle returned up front, before the background loop finishes.
    expect(res.ok).toBe(true);
    expect(res.streamId).toBe('out-1');
    // Output stream is scoped to the owning flow so close_all_streams can reap it.
    expect(execMock).toHaveBeenCalledWith('stream_create', expect.objectContaining({ kind: 'text', flowId: 'flow_abc' }));

    // The detached loop should push the transcript onto the output stream.
    await vi.waitFor(() => {
      expect(execMock).toHaveBeenCalledWith(
        'stream_write',
        expect.objectContaining({ streamId: 'out-1', chunk: 'hello world ' }),
      );
    });
    await vi.waitFor(() => {
      expect(execMock).toHaveBeenCalledWith('stream_close', expect.objectContaining({ streamId: 'out-1' }));
    });
  });
});
