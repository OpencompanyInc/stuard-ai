import { useEffect, useRef, useState } from 'react';
import type { DiscoveryTip } from '../components/onboarding/DiscoveryEngine';
import { useDiscovery } from './useDiscovery';

function randomMs(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

export interface UseStatusDiscoveryTipsOptions {
  enabled: boolean;
  currentArea?: string;
  isEmptyState?: boolean;
  count?: number;
}

/** Scored tip pool from DiscoveryEngine. */
export function useStatusDiscoveryTips(options: UseStatusDiscoveryTipsOptions): DiscoveryTip[] {
  const { getTipsForCarousel, markTipSeen } = useDiscovery();
  const { enabled, currentArea, isEmptyState, count = 10 } = options;

  const [tips, setTips] = useState<DiscoveryTip[]>([]);
  const markedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled) {
      setTips([]);
      return;
    }
    const pool = getTipsForCarousel(count, {
      currentArea,
    });
    setTips(pool);
    for (const tip of pool) {
      if (markedRef.current.has(tip.id)) continue;
      markedRef.current.add(tip.id);
      markTipSeen(tip.id);
    }
  }, [enabled, currentArea, isEmptyState, count, getTipsForCarousel, markTipSeen]);

  return enabled ? tips : [];
}

export interface StatusDiscoveryTipCycle {
  tip: DiscoveryTip | null;
  /** True while a tip is on screen (slide-in + hold). False during random pauses. */
  visible: boolean;
}

/**
 * During long-running work: show one structured tip, hide, wait a random beat,
 * then show the next — not a continuous marquee and not while idle.
 */
export function useStatusDiscoveryTipCycle(
  options: UseStatusDiscoveryTipsOptions,
): StatusDiscoveryTipCycle {
  const tips = useStatusDiscoveryTips(options);
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(false);
  const timersRef = useRef<number[]>();

  const clearTimers = () => {
    for (const id of timersRef.current ?? []) window.clearTimeout(id);
    timersRef.current = [];
  };

  const schedule = (fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms);
    timersRef.current = [...(timersRef.current ?? []), id];
    return id;
  };

  useEffect(() => {
    clearTimers();
    setVisible(false);
    setIndex(0);

    if (!options.enabled || tips.length === 0) return clearTimers;

    let cancelled = false;
    let tipIdx = 0;

    const runCycle = () => {
      if (cancelled || tips.length === 0) return;

      setIndex(tipIdx);
      setVisible(true);

      schedule(() => {
        if (cancelled) return;
        setVisible(false);

        schedule(() => {
          if (cancelled) return;
          tipIdx = (tipIdx + 1) % tips.length;
          runCycle();
        }, randomMs(14_000, 38_000));
      }, randomMs(6_500, 11_000));
    };

    schedule(runCycle, randomMs(2_500, 6_000));

    return () => {
      cancelled = true;
      clearTimers();
      setVisible(false);
    };
  }, [options.enabled, tips]);

  const tip = options.enabled && tips.length > 0 ? tips[index] ?? null : null;

  return {
    tip: visible ? tip : null,
    visible,
  };
}
