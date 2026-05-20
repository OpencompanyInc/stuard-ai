import { useEffect, useMemo, useRef, useState } from 'react';
import type { UrgencyLevel } from './usePlannerData';

/**
 * A single rotating item in the compact-mode status pill carousel.
 * Providers (next-up event, weather, urgent message, etc.) each emit one
 * StatusItem or null; the carousel cycles through whatever is non-null.
 */
export interface StatusItem {
  id: string;
  text: string;
  /** Built-in icon name OR a custom React node */
  icon: 'video' | 'calendar' | 'bell' | 'task' | 'weather' | 'slack' | 'ai' | 'mic' | 'queue' | 'custom';
  /** Optional explicit color override; falls back to urgency/icon-type defaults */
  iconColor?: string;
  /** Optional custom node when icon === 'custom' */
  iconNode?: React.ReactNode;
  urgency?: UrgencyLevel;
  /** Higher = shown earlier in the rotation */
  priority?: number;
  /** Pull-to-front when truthy (e.g., true now-alarms that shouldn't rotate away) */
  pin?: boolean;
  onClick?: () => void;
  /** Optional tooltip / aria-label override (defaults to `text`) */
  ariaLabel?: string;
}

export interface UseStatusCarouselOptions {
  /** Rotation interval in ms (default 10s) */
  intervalMs?: number;
  /** Pause rotation (hover / pinned-open). Current item stays visible. */
  paused?: boolean;
}

export interface UseStatusCarouselResult {
  current: StatusItem | null;
  index: number;
  count: number;
}

const isUrgentNow = (it: StatusItem) => it.pin || it.urgency === 'now';

/**
 * Carousel state for the compact status pill. Sorts items by urgency + priority,
 * pins any urgency='now' items so they never rotate away, and cycles the rest
 * every `intervalMs`. Stops if there is only one (or zero) eligible items.
 */
export function useStatusCarousel(
  items: StatusItem[],
  opts: UseStatusCarouselOptions = {},
): UseStatusCarouselResult {
  const { intervalMs = 10_000, paused = false } = opts;

  const sorted = useMemo(() => {
    const valid = (items || []).filter((it) => it && it.id && it.text);
    return [...valid].sort((a, b) => {
      const au = isUrgentNow(a) ? 1 : 0;
      const bu = isUrgentNow(b) ? 1 : 0;
      if (au !== bu) return bu - au;
      return (b.priority ?? 0) - (a.priority ?? 0);
    });
  }, [items]);

  const pinnedItem = sorted.find(isUrgentNow) || null;

  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  useEffect(() => { indexRef.current = index; }, [index]);

  // Reset index when the eligible item set changes meaningfully.
  const idsKey = sorted.map((s) => s.id).join('|');
  useEffect(() => {
    if (sorted.length === 0) {
      if (indexRef.current !== 0) setIndex(0);
      return;
    }
    if (indexRef.current >= sorted.length) setIndex(0);
  }, [idsKey, sorted.length]);

  useEffect(() => {
    if (paused) return;
    if (pinnedItem) return;
    if (sorted.length <= 1) return;
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % sorted.length);
    }, Math.max(1500, intervalMs));
    return () => window.clearInterval(id);
  }, [paused, pinnedItem, sorted.length, intervalMs]);

  const current = pinnedItem
    ? pinnedItem
    : sorted.length === 0
      ? null
      : sorted[Math.min(index, sorted.length - 1)] || null;

  return { current, index, count: sorted.length };
}
