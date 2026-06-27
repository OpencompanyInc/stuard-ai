import React from 'react';
import { clsx } from 'clsx';
import { Hand, Maximize2 } from 'lucide-react';
import type { BotTrigger } from './types';
import { TRIGGER_META } from './constants';
import { buildLogPreview } from './helpers';

export function ActivityCard({
  log,
  firedBy,
  onOpen,
}: {
  log: any;
  firedBy?: BotTrigger | null;
  onOpen: () => void;
}) {
  const isCompleted = log.status === 'completed';
  const isFailed = log.status === 'failed';
  const statusLabel = isCompleted ? 'Completed' : isFailed ? 'Failed' : 'Running';
  const statusColor = isCompleted ? 'text-emerald-400' : isFailed ? 'text-red-400' : 'text-amber-300';

  const title = log.agentMessage?.split(/\n+/)[0]?.slice(0, 140)
    || log.partialResponse?.slice(0, 140)
    || log.failureReason
    || buildLogPreview(log);

  const formattedDate = (() => {
    const d = new Date(log.startedAt);
    if (Number.isNaN(d.getTime())) return '';
    const day = d.getDate();
    const month = d.toLocaleString(undefined, { month: 'short' });
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${day} ${month}, ${time}`;
  })();

  const TriggerIcon = firedBy ? TRIGGER_META[firedBy.type]?.icon : Hand;
  const triggerLabel = firedBy ? (TRIGGER_META[firedBy.type]?.label || firedBy.type) : 'Manual';

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative w-full rounded-2xl border border-[color:var(--dashboard-panel-border)] bg-theme-card px-4 py-4 text-left shadow-sm transition hover:bg-theme-hover/30"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={clsx('text-[12px] font-medium', statusColor)}>{statusLabel}</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-theme-hover/60 px-1.5 py-0.5 text-[10px] text-theme-muted">
            <TriggerIcon className="h-2.5 w-2.5" />
            {triggerLabel}
          </span>
        </div>
        <Maximize2 className="h-3.5 w-3.5 flex-none text-theme-muted/60 transition group-hover:text-theme-fg" />
      </div>
      <div className="mt-2 text-[14px] leading-6 text-theme-fg line-clamp-2">{title}</div>
      <div className="mt-2 text-[11px] text-theme-muted">{formattedDate}</div>
    </button>
  );
}
