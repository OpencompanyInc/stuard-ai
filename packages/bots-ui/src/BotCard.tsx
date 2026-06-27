import React from 'react';
import { clsx } from 'clsx';
import { Cloud, Trash2 } from 'lucide-react';
import type { Bot } from './types';
import { DashboardBadge } from './primitives';
import { statusInfo, timeAgo, timeUntil } from './helpers';

export function BotCard({ bot, onClick, onDelete }: { bot: Bot; onClick: () => void; onDelete?: () => void }) {
  const status = statusInfo(bot.status);
  const onVm = !!bot.vmDeployedAt;

  return (
    <div className="group relative rounded-2xl border border-[color:var(--dashboard-panel-border)] bg-zinc-500/10 transition hover:bg-theme-hover/30">
      <button
        type="button"
        onClick={onClick}
        className="flex w-full flex-col gap-3 p-5 text-left"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-theme-card text-xl shadow-sm">
              {bot.emoji || '🤖'}
            </div>
            <div className="min-w-0">
              <div className="truncate text-[15px] font-semibold text-theme-fg">{bot.name}</div>
              <div className="mt-1 flex items-center gap-1.5 text-[11px]">
                <span className={clsx('h-1.5 w-1.5 rounded-full', status.dot)} />
                <span className={clsx('font-medium', status.textColor)}>{status.label}</span>
                {bot.isLegacyDefault && (
                  <span className="ml-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">default</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 pr-9">
            {onVm && <DashboardBadge label="On VM" tone="primary" icon={Cloud} />}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-theme-card px-3 py-2.5 shadow-sm">
            <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-theme-muted/70">Last run</div>
            <div className="mt-1 truncate text-[13px] font-semibold text-theme-fg">{timeAgo(bot.lastRunAt)}</div>
          </div>
          <div className="rounded-xl bg-theme-card px-3 py-2.5 shadow-sm">
            <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-theme-muted/70">Next in</div>
            <div className="mt-1 truncate text-[13px] font-semibold text-theme-fg">
              {bot.status === 'running' ? timeUntil(bot.nextRunAt) : '—'}
            </div>
          </div>
        </div>
      </button>
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full border border-red-500/20 bg-red-500/5 text-red-300 opacity-0 transition hover:bg-red-500/10 hover:text-red-200 focus:opacity-100 group-hover:opacity-100"
          title="Delete agent"
          aria-label={`Delete ${bot.name}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
