import { describe, it, expect } from 'vitest';
import { float32PcmToWav, float32DurationSec } from './pcm';

/** Build a raw little-endian float32 buffer from a list of samples. */
function f32(samples: number[]): Buffer {
  const buf = Buffer.alloc(samples.length * 4);
  samples.forEach((s, i) => buf.writeFloatLE(s, i * 4));
  return buf;
}

describe('float32PcmToWav', () => {
  it('produces a valid 44-byte RIFF/WAVE PCM header', () => {
    const pcm = f32([0, 0.5, -0.5, 1, -1]);
    const wav = float32PcmToWav(pcm, 16000, 1);

    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE');
    expect(wav.subarray(12, 16).toString('ascii')).toBe('fmt ');
    expect(wav.subarray(36, 40).toString('ascii')).toBe('data');

    expect(wav.readUInt32LE(16)).toBe(16);   // PCM fmt chunk size
    expect(wav.readUInt16LE(20)).toBe(1);    // format = PCM
    expect(wav.readUInt16LE(22)).toBe(1);    // mono
    expect(wav.readUInt32LE(24)).toBe(16000);// sample rate
    expect(wav.readUInt16LE(34)).toBe(16);   // bits per sample
  });

  it('emits 16-bit samples (2 bytes each) with a correct data chunk size', () => {
    const pcm = f32([0, 0.25, -0.25, 0.75]); // 4 samples
    const wav = float32PcmToWav(pcm, 16000, 1);

    const dataLen = wav.readUInt32LE(40);
    expect(dataLen).toBe(4 * 2);                 // 4 samples * 16-bit
    expect(wav.length).toBe(44 + dataLen);
    expect(wav.readUInt32LE(4)).toBe(36 + dataLen); // RIFF chunk size
  });

  it('scales floats to int16 and clamps out-of-range values', () => {
    const pcm = f32([0, 1, -1, 2, -2]); // 2 / -2 must clamp to +1 / -1
    const wav = float32PcmToWav(pcm, 8000, 1);
    const data = wav.subarray(44);

    expect(data.readInt16LE(0)).toBe(0);       // 0.0
    expect(data.readInt16LE(2)).toBe(32767);   // +1.0 → max
    expect(data.readInt16LE(4)).toBe(-32767);  // -1.0
    expect(data.readInt16LE(6)).toBe(32767);   // +2.0 clamped
    expect(data.readInt16LE(8)).toBe(-32767);  // -2.0 clamped
  });

  it('byte rate and block align match 16-bit mono', () => {
    const wav = float32PcmToWav(f32([0, 0]), 44100, 1);
    expect(wav.readUInt16LE(32)).toBe(2);          // block align = channels * 16/8
    expect(wav.readUInt32LE(28)).toBe(44100 * 2);  // byte rate
  });

  it('falls back to a sane sample rate for bogus input', () => {
    const wav = float32PcmToWav(f32([0]), 0, 1);
    expect(wav.readUInt32LE(24)).toBeGreaterThanOrEqual(8000);
  });
});

describe('float32DurationSec', () => {
  it('computes duration from raw float32 byte count', () => {
    // 16000 samples * 4 bytes = 64000 bytes @ 16kHz = 1 second
    expect(float32DurationSec(16000 * 4, 16000)).toBeCloseTo(1, 6);
    expect(float32DurationSec(8000 * 4, 16000)).toBeCloseTo(0.5, 6);
  });

  it('guards against a zero/negative sample rate', () => {
    expect(Number.isFinite(float32DurationSec(4000, 0))).toBe(true);
  });
});
