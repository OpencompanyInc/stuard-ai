import { describe, it, expect } from 'vitest';
import { shouldFlushWindow, deriveWindowParams } from './transcription-window';

describe('deriveWindowParams', () => {
  it('uses windowMs as the hard cap with a floor of 2000ms', () => {
    expect(deriveWindowParams(8000).hardCapMs).toBe(8000);
    expect(deriveWindowParams(500).hardCapMs).toBe(2000); // floored
    expect(deriveWindowParams(0).hardCapMs).toBe(8000);   // default
  });

  it('caps the early-flush minimum at the hard cap', () => {
    expect(deriveWindowParams(8000).minFlushMs).toBe(1200);
    // A tiny window can't require more audio than its own cap.
    expect(deriveWindowParams(2000).minFlushMs).toBeLessThanOrEqual(2000);
  });
});

describe('shouldFlushWindow', () => {
  const p = deriveWindowParams(8000); // hardCap 8000, minFlush 1200, silenceGap 280

  it('keeps accumulating below the minimum window', () => {
    expect(shouldFlushWindow(800, 1000, p)).toBeNull();
  });

  it('does not flush on silence until past the minimum window', () => {
    expect(shouldFlushWindow(1000, 500, p)).toBeNull(); // 1000 < minFlush 1200
  });

  it('flushes on a silence gap once past the minimum window', () => {
    expect(shouldFlushWindow(1500, 300, p)).toBe('silence_gap');
  });

  it('does not flush past the minimum if still speaking (no silence)', () => {
    expect(shouldFlushWindow(3000, 0, p)).toBeNull();
  });

  it('force-flushes at the hard cap regardless of silence', () => {
    expect(shouldFlushWindow(8000, 0, p)).toBe('window_full');
    expect(shouldFlushWindow(9000, 0, p)).toBe('window_full');
  });

  it('hard cap takes precedence over silence gap', () => {
    expect(shouldFlushWindow(8000, 5000, p)).toBe('window_full');
  });
});
