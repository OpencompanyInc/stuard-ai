import React from 'react';
import { clsx } from 'clsx';
import type { ContextUsageMetrics } from '../utils/contextUsage';
import { formatTokenCount } from '../utils/contextUsage';

const TONE_STYLES = {
  safe: {
    ring: 'rgba(52, 211, 153, 0.95)',
    label: 'text-emerald-300',
    chip: 'border-emerald-500/20 bg-emerald-500/8',
  },
  warn: {
    ring: 'rgba(251, 191, 36, 0.95)',
    label: 'text-amber-300',
    chip: 'border-amber-500/20 bg-amber-500/8',
  },
  danger: {
    ring: 'rgba(248, 113, 113, 0.95)',
    label: 'text-red-300',
    chip: 'border-red-500/20 bg-red-500/8',
  },
  unknown: {
    ring: 'rgba(148, 163, 184, 0.9)',
    label: 'text-theme-muted',
    chip: 'border-theme/10 bg-theme-hover/20',
  },
} as const;

export function ContextUsageIndicator({
  metrics,
  compact = false,
  className,
  label = 'Context',
}: {
  metrics?: ContextUsageMetrics | null;
  compact?: boolean;
  className?: string;
  label?: string;
}) {
  if (!metrics) return null;

  const tone = TONE_STYLES[metrics.tone];
  const percentage = typeof metrics.percentage === 'number' ? Math.max(0, Math.min(100, metrics.percentage)) : undefined;
  const size = compact ? 28 : 36;
  const innerSize = compact ? 20 : 26;
  const title = metrics.contextWindow
    ? `${label}: ${formatTokenCount(metrics.promptTokens)} / ${formatTokenCount(metrics.contextWindow)} prompt tokens (${percentage}%${metrics.modelId ? ` • ${metrics.modelId}` : ''})`
    : `${label}: ${formatTokenCount(metrics.promptTokens)} prompt tokens${metrics.modelId ? ` • ${metrics.modelId}` : ''}`;

  return (
    <div
      className={clsx(
        'inline-flex items-center gap-2 rounded-2xl border px-2 py-1.5',
        tone.chip,
        compact && 'rounded-xl px-2 py-1',
        className,
      )}
      title={title}
    >
      <div
        className="relative shrink-0 rounded-full"
        style={{
          width: size,
          height: size,
          background: percentage === undefined
            ? 'rgba(148, 163, 184, 0.12)'
            : `conic-gradient(${tone.ring} ${Math.max(percentage, 1)}%, rgba(148, 163, 184, 0.16) 0)`,
        }}
      >
        <div
          className="absolute inset-0 m-auto rounded-full border border-white/10 bg-theme-bg/90 backdrop-blur-sm"
          style={{ width: innerSize, height: innerSize }}
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={clsx('font-black tabular-nums', compact ? 'text-[9px]' : 'text-[10px]', tone.label)}>
            {percentage === undefined ? 'tok' : `${percentage}%`}
          </span>
        </div>
      </div>

      <div className="min-w-0 leading-tight">
        {!compact && (
          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-theme-muted/70">
            {label}
          </div>
        )}
        <div className={clsx('font-semibold tabular-nums', compact ? 'text-[10px]' : 'text-[11px]', tone.label)}>
          {metrics.contextWindow
            ? `${formatTokenCount(metrics.promptTokens)} / ${formatTokenCount(metrics.contextWindow)}`
            : `${formatTokenCount(metrics.promptTokens)} prompt`}
        </div>
      </div>
    </div>
  );
}
