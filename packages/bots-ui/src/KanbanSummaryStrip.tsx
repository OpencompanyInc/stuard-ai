import React from 'react';
import { clsx } from 'clsx';
import type { BadgeTone } from './types';
import { padCount } from './helpers';

export function KanbanSummaryStrip({
  status,
  nextRunValue,
  activeTaskCount,
  totalRuns,
  executionLabel,
  modelLabel,
  triggerLabel,
  vmDeployed,
}: {
  status: { dot: string; label: string; textColor: string; badgeTone: BadgeTone };
  nextRunValue: string;
  activeTaskCount: number;
  totalRuns: number;
  executionLabel: string;
  modelLabel: string;
  triggerLabel: string;
  vmDeployed: boolean;
}) {
  const items: Array<{ label: string; value: string }> = [
    { label: 'Next', value: nextRunValue },
    { label: 'Tasks', value: padCount(activeTaskCount) },
    { label: 'Runs', value: padCount(totalRuns) },
    { label: vmDeployed ? 'VM + Local' : 'Executor', value: executionLabel },
    { label: 'Intelligence', value: modelLabel },
    { label: 'Trigger', value: triggerLabel },
  ];
  return (
    <div className="mb-4 flex flex-shrink-0 flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-[color:var(--dashboard-panel-border)] bg-zinc-500/10 px-4 py-2.5">
      <div className="flex items-center gap-2">
        <span className={clsx('h-2 w-2 rounded-full', status.dot)} />
        <span className={clsx('text-[12px] font-semibold uppercase tracking-wide', status.textColor)}>{status.label}</span>
      </div>
      <div className="h-4 w-px bg-theme/15" />
      {items.map((it, i) => (
        <React.Fragment key={it.label}>
          {i > 0 && <div className="h-4 w-px bg-theme/15" />}
          <div className="flex items-baseline gap-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wide text-theme-muted">{it.label}</span>
            <span className="text-[12.5px] font-semibold text-theme-fg">{it.value}</span>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}
