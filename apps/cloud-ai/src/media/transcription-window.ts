// ─── Streaming transcription windowing ───────────────────────────────────────
// Decides when an accumulated audio window should be flushed to a one-shot STT
// call. Pulled out of ai-inference.ts so the segmentation logic is unit-testable
// without standing up the audio stream / model plumbing.

export interface WindowFlushParams {
  /** Hard cap (ms): force a flush once the window reaches this length. */
  hardCapMs: number;
  /** Minimum window (ms) before a silence gap is allowed to flush early. */
  minFlushMs: number;
  /** Contiguous silence (ms) that triggers an early flush past minFlushMs. */
  silenceGapMs: number;
}

export type FlushReason = 'window_full' | 'silence_gap' | null;

/**
 * Given how much audio has accumulated (windowMsSoFar) and how long we've been
 * in silence (silenceMs), decide whether to flush the current window and why.
 *  - 'window_full'  — hit the hard cap, flush regardless of silence.
 *  - 'silence_gap'  — past the minimum and sitting in a pause → flush an utterance.
 *  - null           — keep accumulating.
 */
export function shouldFlushWindow(
  windowMsSoFar: number,
  silenceMs: number,
  p: WindowFlushParams,
): FlushReason {
  if (windowMsSoFar >= p.hardCapMs) return 'window_full';
  if (windowMsSoFar >= p.minFlushMs && silenceMs >= p.silenceGapMs) return 'silence_gap';
  return null;
}

/** Derive flush params from a user-supplied hard-cap window (windowMs). */
export function deriveWindowParams(windowMs: number): WindowFlushParams {
  const hardCapMs = Math.max(2000, windowMs || 8000);
  return {
    hardCapMs,
    minFlushMs: Math.min(1200, hardCapMs),
    silenceGapMs: 280,
  };
}
