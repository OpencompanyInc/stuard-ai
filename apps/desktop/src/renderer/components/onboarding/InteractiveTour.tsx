import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, X } from 'lucide-react';

// Floating, action-driven tour. Each step points at a real UI element with a
// hint card, listens for the user to perform the action, then briefly shows
// an acknowledgement before advancing. No mocks — runs over the actual app.

type Side = 'top' | 'bottom' | 'left' | 'right';

interface TourStepDef {
  id: string;
  hint: React.ReactNode;
  ack: string;
  anchor?: string;
  side?: Side;
  /** Returns a cleanup. Call `advance()` when the user completes the action. */
  detect: (advance: () => void) => () => void;
}

const STEPS: TourStepDef[] = [
  {
    id: 'move',
    hint: (
      <>Hold <Kbd>Ctrl</Kbd> + <Kbd>↑↓←→</Kbd> to move me around the screen.</>
    ),
    ack: 'There we go.',
    detect: (advance) => {
      const onKey = (e: KeyboardEvent) => {
        if (e.ctrlKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
          advance();
        }
      };
      window.addEventListener('keydown', onKey, true);
      return () => window.removeEventListener('keydown', onKey, true);
    },
  },
  {
    id: 'mention',
    hint: <>Type <Kbd>@</Kbd> in the input to drop in files, folders, or browser context.</>,
    ack: "Nice. That's how you hand me context.",
    anchor: 'stuard-input-area',
    side: 'top',
    detect: (advance) => {
      const onKey = (e: KeyboardEvent) => {
        if (e.key === '@') advance();
      };
      window.addEventListener('keydown', onKey, true);
      return () => window.removeEventListener('keydown', onKey, true);
    },
  },
  {
    id: 'attach',
    hint: <>Or click <Kbd>+</Kbd> to attach files directly.</>,
    ack: 'Got it.',
    anchor: 'stuard-attach-btn',
    side: 'top',
    detect: (advance) => {
      const el = document.getElementById('stuard-attach-btn');
      const onClick = () => advance();
      el?.addEventListener('click', onClick, true);
      return () => el?.removeEventListener('click', onClick, true);
    },
  },
  {
    id: 'layout',
    hint: <>Switch layouts here: compact, sidebar, or full window.</>,
    ack: 'Whichever fits.',
    anchor: 'stuard-collapse-btn',
    side: 'bottom',
    detect: (advance) => {
      let attached: HTMLElement | null = null;
      let interval: ReturnType<typeof setInterval> | null = null;
      const tryAttach = () => {
        const el = document.getElementById('stuard-collapse-btn');
        if (el && !attached) {
          attached = el;
          el.addEventListener('click', advance, true);
          if (interval) { clearInterval(interval); interval = null; }
        }
      };
      tryAttach();
      if (!attached) interval = setInterval(tryAttach, 200);
      return () => {
        if (interval) clearInterval(interval);
        if (attached) attached.removeEventListener('click', advance, true);
      };
    },
  },
  {
    id: 'dashboard',
    hint: <>And the full dashboard lives behind this button.</>,
    ack: "You've got the lay of the land.",
    anchor: 'stuard-dashboard-btn',
    side: 'top',
    detect: (advance) => {
      const el = document.getElementById('stuard-dashboard-btn');
      const onClick = () => advance();
      el?.addEventListener('click', onClick, true);
      return () => el?.removeEventListener('click', onClick, true);
    },
  },
];

interface Props {
  onComplete: () => void;
  /** Called once on mount so the parent can expand the overlay if needed. */
  onMount?: () => void;
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[18px] px-1.5 py-0.5 mx-0.5 text-[11px] font-medium bg-stone-900/80 border border-rose-200/20 rounded-[5px] text-rose-50/90 shadow-[0_1px_3px_rgba(0,0,0,0.4)]">
      {children}
    </kbd>
  );
}

export function InteractiveTour({ onComplete, onMount }: Props) {
  const [stepIdx, setStepIdx] = useState(0);
  const [acked, setAcked] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const step = STEPS[stepIdx];

  // One-shot mount callback (expand overlay, focus app, etc.)
  useEffect(() => { onMount?.(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Track the anchor element's position
  useEffect(() => {
    setAnchorRect(null);
    if (!step.anchor) return;
    const update = () => {
      const el = document.getElementById(step.anchor!);
      if (el) setAnchorRect(prev => {
        const r = el.getBoundingClientRect();
        if (prev && Math.abs(prev.x - r.x) < 1 && Math.abs(prev.y - r.y) < 1 && Math.abs(prev.width - r.width) < 1) return prev;
        return r;
      });
    };
    update();
    const interval = setInterval(update, 250);
    window.addEventListener('resize', update);
    return () => { clearInterval(interval); window.removeEventListener('resize', update); };
  }, [step.anchor]);

  // Wire up the action detector for the current step
  useEffect(() => {
    if (acked) return;
    const cleanup = step.detect(() => setAcked(true));
    return cleanup;
  }, [step, acked]);

  // Advance ~1.5s after ack
  useEffect(() => {
    if (!acked) return;
    const t = setTimeout(() => {
      if (stepIdx < STEPS.length - 1) {
        setStepIdx(s => s + 1);
        setAcked(false);
      } else {
        onComplete();
      }
    }, 1500);
    return () => clearTimeout(t);
  }, [acked, stepIdx, onComplete]);

  const cardStyle = computeCardPosition(anchorRect, step.side);

  return (
    <div className="fixed inset-0 z-[9998] pointer-events-none">
      {/* Highlight ring around the anchor */}
      <AnimatePresence>
        {anchorRect && (
          <motion.div
            key={`ring-${step.id}`}
            initial={{ opacity: 0, scale: 1.15 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
            className="absolute"
            style={{
              top: anchorRect.top - 6,
              left: anchorRect.left - 6,
              width: anchorRect.width + 12,
              height: anchorRect.height + 12,
              borderRadius: 12,
              border: '2px solid rgba(255, 130, 110, 0.65)',
              boxShadow: '0 0 0 4px rgba(255, 130, 110, 0.10), 0 0 32px rgba(255, 100, 90, 0.40)',
            }}
          />
        )}
      </AnimatePresence>

      {/* Skip button — bottom-right, subtle */}
      <button
        onClick={onComplete}
        className="absolute bottom-5 right-5 rounded-md border border-white/[0.10] bg-stone-950/70 backdrop-blur-md px-3 py-1.5 text-[10.5px] tracking-[0.08em] uppercase font-medium text-white/55 transition-colors hover:bg-stone-900/80 hover:border-white/[0.20] hover:text-white/80 pointer-events-auto inline-flex items-center gap-1.5"
        title="Skip the tour"
      >
        <X size={11} strokeWidth={2} />
        Skip tour
      </button>

      {/* Floating hint card */}
      <AnimatePresence mode="wait">
        <motion.div
          key={step.id + (acked ? '-ack' : '')}
          initial={{ opacity: 0, y: 6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -4, scale: 0.98 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          style={{ ...cardStyle, maxWidth: 340 }}
          className="absolute rounded-lg border border-rose-200/25 bg-stone-950/90 backdrop-blur-md px-4 py-3 shadow-[0_8px_32px_rgba(20,8,12,0.6)] pointer-events-auto"
        >
          {acked ? (
            <div className="flex items-center gap-2.5">
              <span className="flex h-6 w-6 items-center justify-center rounded-md border border-emerald-300/30 bg-emerald-950/55">
                <Check size={12} className="text-emerald-200" strokeWidth={2.4} />
              </span>
              <p className="text-[13px] leading-snug text-emerald-100/95 font-light">{step.ack}</p>
            </div>
          ) : (
            <>
              <p className="text-[10px] tracking-[0.10em] uppercase font-medium text-rose-200/70 mb-1.5">
                Step {stepIdx + 1} / {STEPS.length}
              </p>
              <p className="text-[13px] leading-relaxed text-white/95 font-light">{step.hint}</p>
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function computeCardPosition(rect: DOMRect | null, side?: Side): React.CSSProperties {
  const margin = 16;
  if (!rect) {
    return { bottom: '14vh', left: '50%', transform: 'translateX(-50%)' };
  }
  const gap = 14;
  let style: React.CSSProperties;
  switch (side) {
    case 'top':
      style = { top: rect.top - gap, left: rect.left + rect.width / 2, transform: 'translate(-50%, -100%)' };
      break;
    case 'left':
      style = { top: rect.top + rect.height / 2, left: rect.left - gap, transform: 'translate(-100%, -50%)' };
      break;
    case 'right':
      style = { top: rect.top + rect.height / 2, left: rect.right + gap, transform: 'translateY(-50%)' };
      break;
    case 'bottom':
    default:
      style = { top: rect.bottom + gap, left: rect.left + rect.width / 2, transform: 'translateX(-50%)' };
      break;
  }
  // Clamp into viewport when feasible
  if (typeof window !== 'undefined') {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (typeof style.left === 'number' && style.left < margin) style.left = margin;
    if (typeof style.left === 'number' && style.left > vw - margin) style.left = vw - margin;
    if (typeof style.top === 'number' && style.top < margin) style.top = margin;
    if (typeof style.top === 'number' && style.top > vh - margin) style.top = vh - margin;
  }
  return style;
}
