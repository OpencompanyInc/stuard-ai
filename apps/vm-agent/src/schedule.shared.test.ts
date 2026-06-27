import { describe, it, expect } from 'vitest';
import {
  intervalDelayMs,
  SCHEDULE_INTERVAL_MS,
  RANDOM_INTERVAL_MIN_MS,
  RANDOM_INTERVAL_MAX_MS,
} from '@stuardai/bots-core';

describe('intervalDelayMs', () => {
  it('returns the exact fixed delay for each known token', () => {
    expect(intervalDelayMs('10m')).toBe(10 * 60_000);
    expect(intervalDelayMs('15m')).toBe(15 * 60_000);
    expect(intervalDelayMs('30m')).toBe(30 * 60_000);
    expect(intervalDelayMs('1h')).toBe(60 * 60_000);
    expect(intervalDelayMs('2h')).toBe(2 * 60 * 60_000);
  });

  it('returns null for manual and unknown tokens (not auto-scheduled)', () => {
    expect(intervalDelayMs('manual')).toBeNull();
    expect(intervalDelayMs('')).toBeNull();
    expect(intervalDelayMs('weekly')).toBeNull();
  });

  it('draws random within the canonical [10m, 90m] window', () => {
    // Unified bound — both schedulers now agree on this range.
    expect(RANDOM_INTERVAL_MIN_MS).toBe(10 * 60_000);
    expect(RANDOM_INTERVAL_MAX_MS).toBe(90 * 60_000);
    for (let i = 0; i < 500; i++) {
      const ms = intervalDelayMs('random');
      expect(ms).not.toBeNull();
      expect(ms!).toBeGreaterThanOrEqual(RANDOM_INTERVAL_MIN_MS);
      expect(ms!).toBeLessThanOrEqual(RANDOM_INTERVAL_MAX_MS);
    }
  });

  it('exposes the fixed-interval table without a random/manual entry', () => {
    expect(Object.keys(SCHEDULE_INTERVAL_MS).sort()).toEqual(['10m', '15m', '1h', '2h', '30m'].sort());
    expect((SCHEDULE_INTERVAL_MS as any).random).toBeUndefined();
    expect((SCHEDULE_INTERVAL_MS as any).manual).toBeUndefined();
  });
});
