import React from 'react';
import { clsx } from 'clsx';
import { Activity, ListTodo } from 'lucide-react';
import type { BotTrigger } from './types';
import { ActivityCard } from './ActivityCard';

export function ActivityTab({
  tasks,
  logs,
  triggersById,
  onSelectLog,
  vmActivity = false,
}: {
  tasks: any[];
  logs: any[];
  triggersById: Map<string, BotTrigger>;
  onSelectLog: (id: string) => void;
  /** True when this agent lives on the VM and we're surfacing kanban + run-log
   *  data here instead of the desktop's local proactive tasks/wake-up logs. */
  vmActivity?: boolean;
}) {
  return (
    <div className="rounded-xl border border-[color:var(--dashboard-panel-border)] bg-zinc-500/10">
      {/* Tasks */}
      <section className="p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-[15px] font-semibold text-theme-fg">
            <ListTodo className="h-4 w-4" /> {vmActivity ? 'Active Cards' : 'Tasks'}
            <span className="text-[12px] font-normal text-theme-muted">({tasks.length})</span>
          </h3>
        </div>
        {tasks.length === 0 ? (
          <div className="flex items-center justify-center rounded-lg border border-dashed border-theme/40 p-6 text-center">
            <div className="max-w-sm text-[12px] leading-5 text-theme-muted">
              {vmActivity
                ? 'No active kanban cards — the agent will add some as it works. See the Kanban tab for the full board.'
                : 'No tasks yet — the agent will create some when it runs.'}
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            {tasks.slice(0, 30).map(t => (
              <div key={t.id} className="rounded-lg border border-[color:var(--dashboard-panel-border)] bg-theme-card px-3.5 py-2.5 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13px] font-medium text-theme-fg">{t.title}</span>
                  <span className={clsx('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                    t.status === 'completed' ? 'bg-emerald-500/10 text-emerald-300'
                    : t.status === 'failed' ? 'bg-red-500/10 text-red-300'
                    : t.status === 'in_progress' ? 'bg-amber-500/10 text-amber-300'
                    : 'bg-theme-card/70 text-theme-muted',
                  )}>{t.status}</span>
                </div>
                {t.instructions && <div className="mt-1 line-clamp-2 text-[11px] text-theme-muted">{t.instructions}</div>}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Recent runs */}
      <section className="border-t border-theme/30 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-[15px] font-semibold text-theme-fg">
            <Activity className="h-4 w-4" /> Recent Runs
            <span className="text-[12px] font-normal text-theme-muted">({logs.length})</span>
          </h3>
        </div>
        {logs.length === 0 ? (
          <div className="flex items-center justify-center rounded-lg border border-dashed border-theme/40 p-6 text-center">
            <div className="max-w-sm text-[12px] leading-5 text-theme-muted">
              No runs yet. Click "Run Now" or deploy the agent.
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            {logs.slice(0, 20).map(log => (
              <ActivityCard
                key={log.id}
                log={log}
                firedBy={log.triggerId ? triggersById.get(log.triggerId) : null}
                onOpen={() => onSelectLog(log.id)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
