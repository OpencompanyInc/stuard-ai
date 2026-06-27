import React from 'react';
import { motion } from 'framer-motion';
import { Check, type LucideIcon } from 'lucide-react';
import { clsx } from 'clsx';

export interface ChallengeStep {
  id: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  color: string;        // e.g. 'blue', 'purple', 'amber'
  cta?: string;         // button label
  completed?: boolean;
}

interface ChallengeCardProps {
  step: ChallengeStep;
  mode: 'welcome' | 'nudge' | 'celebration';
  onAction?: () => void;
  onDismiss?: () => void;
}

const COLOR_MAP: Record<string, { bg: string; border: string; text: string; glow: string }> = {
  blue:   { bg: 'bg-blue-500/10', border: 'border-blue-400/20', text: 'text-blue-300', glow: 'rgba(56,168,255,0.15)' },
  purple: { bg: 'bg-purple-500/10', border: 'border-purple-400/20', text: 'text-purple-300', glow: 'rgba(168,85,247,0.15)' },
  amber:  { bg: 'bg-amber-500/10', border: 'border-amber-400/20', text: 'text-amber-300', glow: 'rgba(245,158,11,0.15)' },
  green:  { bg: 'bg-green-500/10', border: 'border-green-400/20', text: 'text-green-300', glow: 'rgba(34,197,94,0.15)' },
  cyan:   { bg: 'bg-cyan-500/10', border: 'border-cyan-400/20', text: 'text-cyan-300', glow: 'rgba(6,182,212,0.15)' },
};

export function ChallengeCard({ step, mode, onAction, onDismiss }: ChallengeCardProps) {
  const colors = COLOR_MAP[step.color] || COLOR_MAP.blue;
  const Icon = step.icon;

  // Celebration mode — brief checkmark
  if (mode === 'celebration' || step.completed) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        className="flex items-center gap-3 rounded-2xl border border-green-400/15 bg-green-500/8 px-4 py-3"
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-green-500/15">
          <Check className="w-4 h-4 text-green-300" />
        </div>
        <span className="text-sm font-medium text-green-200/80">{step.title}</span>
      </motion.div>
    );
  }

  // Nudge mode — compact floating bar
  if (mode === 'nudge') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 12 }}
        className={clsx(
          'flex items-center gap-3 rounded-2xl border px-4 py-3 backdrop-blur-xl',
          colors.border, 'bg-black/40',
        )}
      >
        <div className={clsx('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', colors.bg)}>
          <Icon className={clsx('w-3.5 h-3.5', colors.text)} />
        </div>
        <span className="flex-1 text-xs text-white/60">{step.subtitle}</span>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="text-[10px] text-white/30 hover:text-white/60 transition-colors"
          >
            Dismiss
          </button>
        )}
      </motion.div>
    );
  }

  // Welcome mode — full card in empty chat area
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
      className={clsx(
        'relative overflow-hidden rounded-2xl border backdrop-blur-xl',
        colors.border, 'bg-white/[0.04]',
      )}
    >
      {/* Subtle glow */}
      <div
        className="pointer-events-none absolute -top-12 left-1/2 h-24 w-48 -translate-x-1/2 rounded-full blur-3xl"
        style={{ background: colors.glow }}
      />

      <div className="relative z-10 flex flex-col items-center px-6 py-8 text-center">
        <div className={clsx('flex h-14 w-14 items-center justify-center rounded-2xl border', colors.bg, colors.border)}>
          <Icon className={clsx('w-7 h-7', colors.text)} />
        </div>

        <h3 className="mt-5 text-lg font-semibold text-white/90">{step.title}</h3>
        <p className="mt-2 max-w-xs text-sm leading-relaxed text-white/45">{step.subtitle}</p>

        {step.cta && onAction && (
          <button
            onClick={onAction}
            className={clsx(
              'mt-6 rounded-xl border px-5 py-2.5 text-sm font-medium transition-all hover:bg-white/[0.06] active:scale-[0.97]',
              colors.border, colors.text,
            )}
          >
            {step.cta}
          </button>
        )}
      </div>
    </motion.div>
  );
}
