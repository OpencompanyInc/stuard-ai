import React from 'react';
import { clsx } from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Video,
  Calendar,
  Bell,
  ListTodo,
  Sparkles,
  MessageSquare,
  Mic,
  Loader2,
  type LucideIcon,
} from 'lucide-react';

import type { StatusItem } from '../../../../../hooks/useStatusCarousel';

interface CompactStatusPillProps {
  item: StatusItem;
  statusExpanded: boolean;
  onHoverChange: (hovered: boolean) => void;
  onClick: (item: StatusItem) => void;
}

const ICON_MAP: Partial<Record<string, LucideIcon>> = {
  video: Video,
  calendar: Calendar,
  bell: Bell,
  task: ListTodo,
  weather: Sparkles,
  slack: MessageSquare,
  ai: Sparkles,
  mic: Mic,
  queue: Loader2,
};

const URGENCY_GLOW: Partial<Record<string, string>> = {
  now: '0 0 12px rgba(255, 56, 60, 0.35)',
  soon: '0 0 12px rgba(245, 158, 11, 0.3)',
};

const FLIP_TRANSITION = {
  duration: 0.32,
  ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
};

function resolveIconColor(item: StatusItem): string {
  if (item.iconColor) return item.iconColor;
  if (item.urgency === 'now') return '#FF383C';
  if (item.urgency === 'soon') return '#F59E0B';
  switch (item.icon) {
    case 'bell':
      return '#F59E0B';
    case 'calendar':
      return '#3B82F6';
    case 'task':
      return '#10B981';
    case 'weather':
      return '#60A5FA';
    case 'slack':
      return '#A855F7';
    case 'ai':
      return '#A78BFA';
    case 'mic':
      return '#FF383C';
    case 'queue':
      return '#60A5FA';
    default:
      return 'rgb(var(--compact-pill-fg))';
  }
}

/**
 * Carousel status pill rendered above the compact input bar. Animates icon
 * and text swaps like a flip-clock as the underlying StatusItem cycles.
 */
export const CompactStatusPill: React.FC<CompactStatusPillProps> = ({
  item,
  statusExpanded,
  onHoverChange,
  onClick,
}) => {
  const iconKey = item.icon;
  const IconCmp = ICON_MAP[iconKey] ?? null;
  const iconColor = resolveIconColor(item);
  const urgencyGlow = item.urgency ? URGENCY_GLOW[item.urgency] : undefined;

  return (
    <div className="w-full mx-auto flex" style={{ maxWidth: 420, marginBottom: 8 }}>
      <motion.button
        type="button"
        layout
        transition={{ type: 'spring', stiffness: 320, damping: 30, mass: 0.7 }}
        className={clsx(
          'no-drag flex items-center min-w-0 cursor-pointer outline-none',
          item.urgency === 'now' && 'animate-pulse',
        )}
        style={{
          backgroundColor: 'rgb(var(--compact-pill-bg))',
          borderRadius: 9999,
          padding: '6px 12px',
          gap: 8,
          height: 32,
          maxWidth: '100%',
          boxShadow: urgencyGlow ?? 'var(--compact-pill-shadow)',
        }}
        onMouseEnter={() => onHoverChange(true)}
        onMouseLeave={() => onHoverChange(false)}
        onFocus={() => onHoverChange(true)}
        onBlur={() => onHoverChange(false)}
        onClick={() => onClick(item)}
        aria-expanded={statusExpanded}
        aria-label={item.ariaLabel || item.text}
      >
        {iconKey === 'custom' && item.iconNode ? (
          <div
            className="flex items-center justify-center flex-shrink-0"
            style={{ height: 16 }}
          >
            {item.iconNode}
          </div>
        ) : (
          <div
            className="relative flex items-center justify-center flex-shrink-0 overflow-hidden"
            style={{ width: 16, height: 16 }}
          >
            <AnimatePresence initial={false} mode="popLayout">
              <motion.span
                key={`icon-${item.id}`}
                className="absolute inset-0 flex items-center justify-center"
                initial={{ y: '100%', opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: '-100%', opacity: 0 }}
                transition={FLIP_TRANSITION}
              >
                {IconCmp ? (
                  <IconCmp
                    className={clsx(
                      'w-4 h-4',
                      iconKey === 'queue' && 'animate-spin',
                      iconKey === 'ai' && 'animate-pulse',
                    )}
                    strokeWidth={1.75}
                    style={{ color: iconColor }}
                  />
                ) : null}
              </motion.span>
            </AnimatePresence>
          </div>
        )}
        <AnimatePresence initial={false}>
          {statusExpanded && (
            <motion.div
              key="status-text-wrap"
              className="overflow-hidden whitespace-nowrap relative"
              initial={{ opacity: 0, width: 0, marginLeft: -8 }}
              animate={{ opacity: 1, width: 'auto', marginLeft: 0 }}
              exit={{ opacity: 0, width: 0, marginLeft: -8 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              style={{ height: 16 }}
            >
              <AnimatePresence initial={false} mode="popLayout">
                <motion.span
                  key={`text-${item.id}`}
                  className="text-pill-fg block whitespace-nowrap"
                  initial={{ y: '100%', opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: '-100%', opacity: 0 }}
                  transition={FLIP_TRANSITION}
                  style={{
                    fontSize: 12,
                    lineHeight: '16px',
                    fontFamily: "'General Sans', 'Inter', 'Figtree', sans-serif",
                    fontWeight: 400,
                  }}
                >
                  {item.text}
                </motion.span>
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.button>
    </div>
  );
};

export default CompactStatusPill;
