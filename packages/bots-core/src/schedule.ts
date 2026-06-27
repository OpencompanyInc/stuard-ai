/**
 * Shared schedule-interval math — single-sources the interval→delay table and
 * the "random" check-in policy that the desktop scheduler (proactive-scheduler)
 * and the VM bot scheduler (vm-bots) both need to decide when a bot next wakes.
 *
 * These tables were copied independently and the 'random' bounds had already
 * drifted (desktop fired in [10m, 90m]; the VM in [10m, 30m] despite a comment
 * claiming it matched desktop). Canonicalized here on the desktop behavior so
 * both schedulers pick the same cadence from one source.
 *
 * Pure apart from Math.random() in the 'random' branch — callers anchor the
 * returned delay to `now` (or a bot's last run) themselves.
 */

/** Fixed delay (ms) for each non-random schedule-interval token. */
export const SCHEDULE_INTERVAL_MS: Record<string, number> = {
  '10m': 10 * 60_000,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h': 60 * 60_000,
  '2h': 2 * 60 * 60_000,
};

/** Bounds for the 'random' interval — a uniform pick in [MIN, MAX] per fire. */
export const RANDOM_INTERVAL_MIN_MS = 10 * 60_000;
export const RANDOM_INTERVAL_MAX_MS = 90 * 60_000;

/**
 * Resolves a schedule-interval token to a delay in milliseconds, or null when
 * the bot shouldn't be auto-scheduled — 'manual', or any unrecognized token.
 * 'random' returns a fresh uniform draw in [RANDOM_INTERVAL_MIN_MS,
 * RANDOM_INTERVAL_MAX_MS] on each call.
 */
export function intervalDelayMs(every: string): number | null {
  if (every === 'manual') return null;
  if (every === 'random') {
    return RANDOM_INTERVAL_MIN_MS + Math.random() * (RANDOM_INTERVAL_MAX_MS - RANDOM_INTERVAL_MIN_MS);
  }
  return SCHEDULE_INTERVAL_MS[every] ?? null;
}
