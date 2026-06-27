// ─── Raw PCM → WAV helpers ────────────────────────────────────────────────────
// The desktop audio bus (apps/agent media_bus.py) publishes mic audio as mono
// float32 numpy chunks. When read off a stream with asBase64=true, each chunk is
// base64 of the array's raw little-endian float32 bytes. The transcription STT
// providers (OpenRouter / ElevenLabs) want a real audio container, so we assemble
// accumulated float32 samples into a 16-bit PCM WAV before sending.

/** Wrap raw 16-bit little-endian PCM samples in a minimal WAV (RIFF) container. */
function wrapPcm16Wav(pcm16: Buffer, sampleRate: number, channels: number): Buffer {
  const bitsPerSample = 16;
  const blockAlign = (channels * bitsPerSample) >> 3;
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm16.length, 4); // file size minus first 8 bytes
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);                // fmt chunk size (PCM)
  header.writeUInt16LE(1, 20);                 // audio format 1 = PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm16.length, 40);

  return Buffer.concat([header, pcm16]);
}

/**
 * Convert raw little-endian float32 PCM samples (range ~[-1, 1]) into a 16-bit
 * PCM WAV buffer. `channels` defaults to mono (the bus downmixes to mono).
 */
export function float32PcmToWav(float32: Buffer, sampleRate: number, channels = 1): Buffer {
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
export function float32DurationSec(float32Bytes: number, sampleRate: number): number {
  const sr = Math.max(1, sampleRate || 44100);
  return (float32Bytes / 4) / sr;
}
