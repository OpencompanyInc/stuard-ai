import React, { useMemo, useState } from 'react';
import { Brain } from 'lucide-react';
import type { Bot } from './types';
import { ConfigRow, Toggle } from './primitives';
import { timeAgo } from './helpers';

export function MemoryTab({
  bot,
  logs,
  onSaveFacts,
  onToggleMemory,
  memoryEnabled,
}: {
  bot: Bot;
  logs: any[];
  onSaveFacts: (facts: string) => Promise<void> | void;
  onToggleMemory?: (enabled: boolean) => void;
  memoryEnabled: boolean;
}) {
  const [facts, setFacts] = useState(bot.storedFacts || '');
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const handleBlur = async () => {
    if (facts === bot.storedFacts) return;
    await onSaveFacts(facts);
    setSavedAt(Date.now());
  };

  const summaries = useMemo(
    () => logs.filter(l => l.status === 'completed' && l.agentMessage).slice(0, 10),
    [logs],
  );

  return (
    <div className="rounded-xl border border-[color:var(--dashboard-panel-border)] bg-zinc-500/10 p-4 space-y-6">
      {onToggleMemory && (
        <ConfigRow
          label="Memory tool"
          description="Inject recent runs and facts into the agent's system prompt at runtime so it remembers across runs."
          control={<Toggle checked={memoryEnabled} onChange={onToggleMemory} />}
        />
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-[15px] font-semibold text-theme-fg">
            <Brain className="h-4 w-4" /> Things to remember
          </h3>
          {savedAt && <span className="text-[11px] font-medium text-emerald-400">Saved</span>}
        </div>
        <div className="rounded-2xl border border-[color:var(--dashboard-panel-border)] bg-theme-card px-4 py-3 shadow-sm">
          <textarea
            rows={6}
            value={facts}
            onChange={e => { setFacts(e.target.value); setSavedAt(null); }}
            onBlur={handleBlur}
            placeholder={'My X handle is @stuard.\nKeep tone friendly and concise.\nAvoid mentioning competitor products.'}
            className="w-full resize-none bg-transparent text-[13px] leading-6 text-theme-fg placeholder:text-theme-muted/50 outline-none"
          />
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-[15px] font-semibold text-theme-fg">Recent runs (auto)</h3>
        {summaries.length === 0 ? (
          <div className="flex items-center justify-center rounded-lg border border-dashed border-theme/40 p-6 text-center">
            <div className="max-w-sm text-[12px] leading-5 text-theme-muted">
              Memory will populate after the agent runs a few times.
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            {summaries.map(s => (
              <div key={s.id} className="rounded-2xl border border-[color:var(--dashboard-panel-border)] bg-theme-card px-4 py-3 shadow-sm">
                <div className="text-[11px] text-theme-muted">{timeAgo(s.startedAt)}</div>
                <div className="mt-1 line-clamp-3 text-[12px] text-theme-fg/90">{s.agentMessage}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
