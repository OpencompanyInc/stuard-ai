import { useEffect, useState } from 'react';

// Single shared ticker bus. N "Working… 4s" badges across the chat used to
// each spin their own setInterval — for long sessions with many running
// subagents that's a measurable hot loop. Subscribers receive Date.now()
// on the chosen cadence; the underlying interval only runs when there is
// at least one subscriber.

type Listener = (now: number) => void;

class TickerBus {
  private listeners = new Set<Listener>();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  constructor(private periodMs: number) {}

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    if (this.intervalId == null) {
      this.intervalId = setInterval(() => {
        const now = Date.now();
        this.listeners.forEach((l) => l(now));
      }, this.periodMs);
    }
    return () => {
      this.listeners.delete(fn);
      if (this.listeners.size === 0 && this.intervalId != null) {
        clearInterval(this.intervalId);
        this.intervalId = null;
      }
    };
  }
}

const oneHzBus = new TickerBus(1000);
const tenHzBus = new TickerBus(100);

function useSharedNow(active: boolean, bus: TickerBus): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    return bus.subscribe(setNow);
  }, [active, bus]);
  return now;
}

// Elapsed seconds since `startMs`, updated at ~1Hz while `active`. Returns 0
// when no start time is provided.
export function useElapsedSeconds(startMs: number | undefined, active: boolean): number {
  const now = useSharedNow(active && typeof startMs === 'number', oneHzBus);
  if (typeof startMs !== 'number') return 0;
  return Math.max(0, Math.floor((now - startMs) / 1000));
}

// Floating-point elapsed seconds at ~10Hz — for "Thinking… 12.4s" style
// readouts that animate finer than a whole second.
export function useElapsedSecondsFine(startMs: number | undefined, active: boolean): number {
  const now = useSharedNow(active && typeof startMs === 'number', tenHzBus);
  if (typeof startMs !== 'number') return 0;
  return Math.max(0, (now - startMs) / 1000);
}
