import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import {
  Activity, AlertCircle, Brain, ChevronLeft, LayoutGrid, Loader2, Pause,
  Play, Settings2, Target, Terminal, Zap,
} from 'lucide-react';
import {
  EXECUTION_TARGET_LABELS,
  PROACTIVE_MODEL_MODE_LABELS,
  type ProactiveModelMode,
  type ScheduleInterval,
} from './proactive-types';
import type {
  BadgeTone, Bot, BotConfig, BotsViewScope, BotTrigger, VmBotRuntime,
} from './types';
import { StatCard } from './primitives';
import {
  formatClockTime, formatShortScheduleLabel, humanizeVmError, padCount, statusInfo,
} from './helpers';
import { KanbanTab } from './KanbanTab';
import { ActivityTab } from './ActivityTab';
import { MemoryTab } from './MemoryTab';
import { SettingsTab } from './SettingsTab';
import { TaskDetailModal } from './TaskDetailModal';
import { useBotsPlatform } from './BotsPlatformContext';
import { platformConfirm, platformNotify } from './dialogs';

type DetailTab = 'activity' | 'kanban' | 'memory' | 'settings';

export function BotDetailView({
  bot,
  onBack,
  onChange,
  scope = 'all',
}: {
  bot: Bot;
  onBack: () => void;
  onChange: () => Promise<void> | void;
  scope?: BotsViewScope;
}) {
  const platform = useBotsPlatform();
  const readOnly = !!platform.readOnly;
  const [tab, setTab] = useState<DetailTab>('activity');
  const [config, setConfig] = useState<BotConfig | null>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [kanbanCards, setKanbanCards] = useState<any[]>([]);
  const [runLog, setRunLog] = useState<any[]>([]);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [vmRuntime, setVmRuntime] = useState<VmBotRuntime | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  // Live-run plumbing: track which run-log ids we've already loaded so a
  // streaming update for an unknown (just-started) run triggers a reload, and a
  // debounce handle so bursty progress events coalesce into one refetch.
  const logIdsRef = useRef<Set<string>>(new Set());
  const reloadTimerRef = useRef<number | null>(null);
  const vmRunActive = scope === 'vm' && !!vmRuntime?.isRunning;
  const status = vmRunActive
    ? { dot: 'bg-amber-400', label: 'Running now', textColor: 'text-amber-300', badgeTone: 'warning' as BadgeTone }
    : statusInfo(bot.status);

  const reloadKanban = useCallback(async () => {
    const [cardsRes, logRes] = await Promise.all([
      platform.memoryListCards?.(bot.id) ?? Promise.resolve({ ok: false } as { ok: boolean; cards?: unknown[] }),
      platform.memoryListRunLog?.(bot.id, 30) ?? Promise.resolve({ ok: false } as { ok: boolean; runLog?: unknown[] }),
    ]);
    if (cardsRes?.ok && Array.isArray(cardsRes.cards)) setKanbanCards(cardsRes.cards);
    if (logRes?.ok && Array.isArray(logRes.runLog)) setRunLog(logRes.runLog);
  }, [bot.id, platform]);

  const loadVmRuntime = useCallback(async () => {
    if (scope !== 'vm' || !bot.vmDeployedAt) {
      setVmRuntime(null);
      return null;
    }
    const res = await platform.getVmStatus?.(bot.id);
    if (res?.ok && res.bot) {
      setVmRuntime(res.bot as VmBotRuntime);
      return res.bot as VmBotRuntime;
    }
    return null;
  }, [bot.id, bot.vmDeployedAt, scope, platform]);

  const reload = useCallback(async () => {
    const [cfgRes, tasksRes, logsRes] = await Promise.all([
      platform.getConfig?.(bot.id) ?? Promise.resolve({ ok: false } as { ok: boolean; config?: BotConfig }),
      platform.listTasks?.(bot.id) ?? Promise.resolve({ ok: false } as { ok: boolean; tasks?: unknown[] }),
      platform.getWakeUpLog?.(bot.id, 30) ?? Promise.resolve({ ok: false } as { ok: boolean; logs?: unknown[] }),
    ]);
    if (cfgRes?.ok && cfgRes.config) setConfig(cfgRes.config as BotConfig);
    if (tasksRes?.ok && Array.isArray(tasksRes.tasks)) setTasks(tasksRes.tasks);
    if (logsRes?.ok && Array.isArray(logsRes.logs)) setLogs(logsRes.logs);
    await reloadKanban();
    await loadVmRuntime();
  }, [bot.id, reloadKanban, loadVmRuntime, platform]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (scope !== 'vm' || !bot.vmDeployedAt) return;
    let lastSeenRunAt: string | null = null;
    const id = window.setInterval(async () => {
      const runtime = await loadVmRuntime();
      const isRunning = !!runtime?.isRunning;
      const runAt = runtime?.lastRunAt || null;
      const runChanged = !!runAt && runAt !== lastSeenRunAt;
      if (isRunning || running || runChanged) {
        await reloadKanban();
      }
      if (runAt) lastSeenRunAt = runAt;
    }, 2500);
    return () => window.clearInterval(id);
  }, [bot.vmDeployedAt, loadVmRuntime, reloadKanban, running, scope]);

  useEffect(() => {
    const off = platform.onBotMemoryChanged?.(({ botId }: { botId: string }) => {
      if (botId === bot.id) reloadKanban();
    });
    return () => { off?.(); };
  }, [bot.id, reloadKanban, platform]);

  // Keep the loaded run-log id set in sync so the live handler below can tell a
  // brand-new run (needs a reload) from one it can patch in place.
  useEffect(() => {
    logIdsRef.current = new Set(logs.map((l: any) => l.id));
  }, [logs]);

  // Stream local runs into the Activity tab. The scheduler broadcasts
  // partialResponse + stage updates on 'proactive-update' as a run progresses;
  // without this the Activity list and the open run modal stay frozen on the
  // mount-time snapshot, so a running agent looks stuck and clicking it shows
  // nothing. (VM runs are covered by the poll above; this is the local path.)
  useEffect(() => {
    const scheduleReload = (delayMs: number) => {
      if (reloadTimerRef.current) window.clearTimeout(reloadTimerRef.current);
      reloadTimerRef.current = window.setTimeout(() => { reloadTimerRef.current = null; reload(); }, delayMs);
    };
    const off = platform.onProactiveUpdate?.((data: any) => {
      const logId = typeof data?.logId === 'string' ? data.logId : '';
      if (!logId) return;
      const partial = typeof data?.partialResponse === 'string' ? data.partialResponse : undefined;
      const isTerminal = data?.type === 'stage' && (data?.stage === 'complete' || data?.stage === 'failed');
      const known = logIdsRef.current.has(logId);

      if (known) {
        // Patch the matching run in place for snappy live updates.
        setLogs((prev: any[]) => {
          const idx = prev.findIndex((l: any) => l.id === logId);
          if (idx < 0) return prev;
          const next = prev.slice();
          const cur = next[idx];
          const alreadyDone = cur.status === 'completed' || cur.status === 'failed';
          next[idx] = {
            ...cur,
            ...(partial !== undefined ? { partialResponse: partial } : {}),
            ...(alreadyDone ? {} : { status: 'running' }),
          };
          return next;
        });
        // Pull the authoritative record (final status + agentMessage) on finish.
        if (isTerminal) scheduleReload(400);
      } else if (bot.status === 'running' || running) {
        // Unknown id while this agent is active → a run we haven't loaded yet.
        scheduleReload(250);
      }
    });
    return () => {
      off?.();
      if (reloadTimerRef.current) { window.clearTimeout(reloadTimerRef.current); reloadTimerRef.current = null; }
    };
  }, [bot.id, bot.status, running, reload, platform]);

  const handleToggleStatus = async () => {
    if (readOnly || !platform.setStatus) return;
    setSaving(true);
    try {
      const next = bot.status === 'running' ? 'paused' : 'running';
      await platform.setStatus(bot.id, next);
      await onChange();
    } finally {
      setSaving(false);
    }
  };

  const handleRunNow = async () => {
    setRunning(true);
    setRunError(null);
    try {
      if (scope === 'vm' && bot.vmDeployedAt) {
        const res = await platform.triggerOnVm?.(bot.id) ?? { ok: false };
        if (!res?.ok) {
          if (res?.error === 'bot_not_deployed_to_vm') {
            await platform.runNow?.(bot.id);
          } else {
            const reason = humanizeVmError(res?.error);
            console.warn('[bots] VM run failed:', res?.error);
            setRunError(reason);
          }
        } else {
          const now = new Date().toISOString();
          setVmRuntime((prev) => ({
            ...(prev || {}),
            id: bot.id,
            name: bot.name,
            status: 'running',
            isRunning: true,
            lastRunAt: now,
            nextRunAt: prev?.nextRunAt ?? bot.nextRunAt ?? null,
          }));
          window.setTimeout(() => { void loadVmRuntime(); }, 500);
          window.setTimeout(() => { void loadVmRuntime(); void reloadKanban(); }, 2500);
        }
      } else {
        await platform.runNow?.(bot.id);
      }
      setTimeout(() => { reload(); setRunning(false); }, 1500);
    } catch (e: any) {
      setRunError(String(e?.message || e || 'Run failed'));
      setRunning(false);
    }
  };

  const handleDelete = async () => {
    const ok = await platformConfirm(platform, {
      title: `Delete “${bot.name}”?`,
      message: 'This permanently removes the agent and its tasks. This can’t be undone.',
      confirmLabel: 'Delete agent',
      tone: 'danger',
    });
    if (!ok) return;
    const res = await platform.delete(bot.id);
    if (res?.ok) {
      await onChange();
      onBack();
    } else if (res?.error) {
      await platformNotify(platform, { title: 'Couldn’t delete agent', message: res.error, tone: 'danger' });
    }
  };

  const updateBotField = async (patch: Partial<Bot>) => {
    if (readOnly || !platform.update) return;
    setSaving(true);
    try {
      await platform.update(bot.id, patch);
      await onChange();
    } finally {
      setSaving(false);
    }
  };

  const updateConfigField = async (patch: Partial<BotConfig>) => {
    if (!config || readOnly || !platform.updateConfig) return;
    const next = { ...config, ...patch };
    setConfig(next);
    setSaving(true);
    try {
      await platform.updateConfig(bot.id, patch);
    } finally {
      setSaving(false);
    }
  };

  const triggersById = useMemo(() => {
    const map = new Map<string, BotTrigger>();
    for (const t of bot.triggers) map.set(t.id, t);
    return map;
  }, [bot.triggers]);

  const modelMode = (config?.modelMode || 'balanced') as ProactiveModelMode;
  const modelModeMeta = PROACTIVE_MODEL_MODE_LABELS[modelMode];
  const executionTargetMeta = config ? EXECUTION_TARGET_LABELS[config.executionTarget] : EXECUTION_TARGET_LABELS.local;
  const triggerSummary = (() => {
    const enabled = bot.triggers.filter(t => t.enabled !== false);
    if (enabled.length === 0) return 'None';
    if (enabled.length > 1) return 'Multiple';
    const t = enabled[0];
    if (t.type === 'schedule.interval') {
      return formatShortScheduleLabel((t.args?.every || '30m') as ScheduleInterval);
    }
    if (t.type === 'schedule.cron') return 'Cron';
    if (t.type === 'webhook') return 'Webhook';
    if (t.type === 'gmail.new_email') return 'Gmail';
    return 'Manual';
  })();
  const nextRunValue = (() => {
    if (vmRunActive) return 'Running now';
    if (scope === 'vm' && vmRuntime?.nextRunAt) return formatClockTime(vmRuntime.nextRunAt);
    if (bot.status === 'errored') return 'Errored';
    if (bot.status !== 'running') return 'Paused';
    if (!bot.nextRunAt) return 'Waiting';
    return formatClockTime(bot.nextRunAt);
  })();

  const isVmActivity = scope === 'vm' && !!bot.vmDeployedAt;
  const vmActivityLogs = useMemo(() => {
    if (!isVmActivity) return null;
    return runLog.map((entry: any) => ({
      id: entry.id,
      botId: bot.id,
      startedAt: entry.at,
      completedAt: entry.at,
      status: entry.outcome === 'failed' ? 'failed' : 'completed',
      agentMessage: entry.summary || '',
      failureReason: entry.outcome === 'failed' ? entry.notes : undefined,
      executionTarget: 'cloud' as const,
      contextUsed: [] as string[],
      tasksProcessed: Array.isArray(entry.cardIds) ? entry.cardIds : [],
    }));
  }, [isVmActivity, runLog, bot.id]);
  const vmActivityTasks = useMemo(() => {
    if (!isVmActivity) return null;
    return kanbanCards
      .filter((c: any) => c.status === 'queued' || c.status === 'in_progress')
      .map((c: any) => ({
        id: c.id,
        title: c.title,
        instructions: c.notes || '',
        status: c.status,
      }));
  }, [isVmActivity, kanbanCards]);
  const displayedTasks = vmActivityTasks ?? tasks;
  const displayedLogs = vmActivityLogs ?? logs;

  const selectedLogIndex = selectedLogId ? displayedLogs.findIndex((l: any) => l.id === selectedLogId) : -1;
  const selectedLog = selectedLogIndex >= 0 ? displayedLogs[selectedLogIndex] : null;
  const selectedLogTrigger = selectedLog?.triggerId ? triggersById.get(selectedLog.triggerId) || null : null;

  const activeKanbanCount = kanbanCards.filter(c => c.status === 'in_progress' || c.status === 'queued').length;
  const tabs: { id: DetailTab; label: string; icon: any; showCount?: boolean; count?: number }[] = [
    { id: 'activity', label: 'Activity', icon: Activity, showCount: true, count: displayedTasks.length },
    { id: 'kanban', label: 'Kanban', icon: LayoutGrid, showCount: true, count: activeKanbanCount },
    { id: 'memory', label: 'Memory', icon: Brain },
    { id: 'settings', label: 'Settings', icon: Settings2 },
  ];

  const executorLabel = bot.vmDeployedAt
    ? `${executionTargetMeta.label} · VM`
    : executionTargetMeta.label;

  return (
    <div className="flex h-full min-h-0 flex-col animate-in fade-in duration-300">
      {/* ─── Fixed workspace header ──────────────────────────────────────────
          Controls · identity + status + meta pills · tab bar. This whole zone
          stays put; only the content below scrolls — so the board, memory and
          settings always open from the same spot and never drift on tab switch
          (this is the StudioHome / workflow-workspace pattern). ─────────────── */}
      <div className="flex flex-shrink-0 flex-col gap-3.5">
        {/* Control row: back · run / deploy */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-1.5 rounded-full border border-theme/40 bg-theme-card/40 px-3 py-1.5 text-[12.5px] font-medium text-theme-muted transition hover:bg-theme-card hover:text-theme-fg"
            aria-label="Back to agents"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            <span>Agents</span>
          </button>
          <div className="flex items-center gap-2">
            {saving && (
              <span className="hidden items-center gap-1.5 text-[11px] font-medium text-primary sm:inline-flex">
                <Loader2 className="h-3 w-3 animate-spin" />
                Saving…
              </span>
            )}
            <button
              onClick={handleRunNow}
              disabled={running || vmRunActive}
              className="inline-flex items-center gap-2 rounded-full border border-theme/60 bg-theme-card px-3.5 py-2 text-[13px] font-medium text-theme-fg shadow-sm transition hover:bg-theme-hover disabled:cursor-not-allowed disabled:opacity-60 sm:px-4"
            >
              {running || vmRunActive ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Terminal className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">{running || vmRunActive ? 'Running' : 'Run now'}</span>
            </button>
            <button
              onClick={handleToggleStatus}
              disabled={saving || readOnly}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-3.5 py-2 text-[13px] font-semibold text-primary-fg shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 sm:px-4"
            >
              {bot.status === 'running' ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              {bot.status === 'running' ? 'Pause' : 'Deploy'}
            </button>
          </div>
        </div>

        {/* Identity row: avatar · name + status + executor · model / trigger pills */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-zinc-500/10 text-2xl shadow-sm">
              {bot.emoji || '🤖'}
            </div>
            <div className="min-w-0">
              <h1 className="truncate font-stuard text-[22px] font-semibold leading-tight tracking-tight text-theme-fg sm:text-[24px]">
                {bot.name}
              </h1>
              <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] font-medium">
                <span className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', status.dot)} />
                <span className={status.textColor}>{status.label}</span>
                <span className="text-theme-muted/50">·</span>
                <span className="truncate text-theme-muted">{executorLabel}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <HeroPill icon={Brain}>{modelModeMeta.label}</HeroPill>
            <HeroPill icon={Zap}>{triggerSummary}</HeroPill>
            {bot.isLegacyDefault && <HeroPill accent>Default agent</HeroPill>}
          </div>
        </div>

        {runError && (
          <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-[12px] text-red-300">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div className="min-w-0">
              <div className="font-medium">Couldn't run on your VM.</div>
              <div className="mt-0.5 text-red-300/80">{runError}</div>
            </div>
          </div>
        )}

        {/* Segmented tab bar */}
        <div className="flex overflow-x-auto rounded-2xl border border-[color:var(--dashboard-panel-border)] bg-zinc-500/10 p-1 shadow-sm scrollbar-minimal">
          {tabs.map(t => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={clsx(
                  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 text-[13px] font-medium transition-all sm:flex-1',
                  active
                    ? 'bg-theme-card text-theme-fg shadow-sm'
                    : 'text-theme-muted hover:text-theme-fg',
                )}
              >
                <Icon className={clsx('h-3.5 w-3.5', active && 'text-primary')} />
                <span>{t.label}</span>
                {t.showCount && (t.count ?? 0) > 0 && (
                  <span
                    className={clsx(
                      'ml-0.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded-md px-1.5 text-[10px] font-semibold',
                      active ? 'bg-primary text-primary-fg' : 'bg-theme-hover/80 text-theme-muted',
                    )}
                  >
                    {t.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── Content zone ────────────────────────────────────────────────────
          One flex cell; each tab owns its own scroll so the board can fill the
          full height while Activity / Memory / Settings scroll normally. ────── */}
      <div className="mt-4 min-h-0 flex-1">
        {tab === 'activity' && (
          <div className="h-full overflow-y-auto px-0.5 pb-6 scrollbar-minimal animate-in fade-in duration-200">
            <div className="space-y-5">
              {/* Status tiles */}
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                <StatCard
                  value={(nextRunValue || '').includes(':') ? nextRunValue.replace(':', ' : ') : nextRunValue}
                  label="Next check-in"
                />
                <StatCard value={padCount(displayedTasks.length)} label="Active tasks" />
                <StatCard value={padCount(displayedLogs.length)} label="Total runs" />
              </div>

              {/* Focus brief — slim editable card. */}
              {config && (
                <section className="rounded-2xl border border-[color:var(--dashboard-panel-border)] bg-zinc-500/10 p-4">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h3 className="flex items-center gap-2 text-[13px] font-semibold text-theme-fg">
                      <Target className="h-3.5 w-3.5 text-primary" />
                      <span>What it's focused on</span>
                    </h3>
                    {saving && <span className="text-[11px] font-medium text-primary">Saving…</span>}
                  </div>
                  <textarea
                    value={config.instructions || ''}
                    onChange={e => setConfig(prev => prev ? { ...prev, instructions: e.target.value } : prev)}
                    onBlur={() => updateConfigField({ instructions: config.instructions || '' })}
                    placeholder="Today: focus on the launch announcement."
                    rows={2}
                    readOnly={readOnly}
                    className="w-full resize-none rounded-xl border border-[color:var(--dashboard-panel-border)] bg-theme-card/60 px-3.5 py-2.5 text-[13.5px] leading-6 text-theme-fg outline-none transition placeholder:text-theme-muted/50 focus:border-primary/60"
                  />
                </section>
              )}

              <ActivityTab
                tasks={displayedTasks}
                logs={displayedLogs}
                triggersById={triggersById}
                onSelectLog={(id) => setSelectedLogId(id)}
                vmActivity={isVmActivity}
              />
            </div>
          </div>
        )}

        {tab === 'kanban' && (
          <div className="h-full min-h-0 px-0.5 animate-in fade-in duration-200">
            <KanbanTab
              botId={bot.id}
              cards={kanbanCards}
              runLog={runLog}
              onChanged={reloadKanban}
            />
          </div>
        )}

        {tab === 'memory' && (
          <div className="h-full overflow-y-auto px-0.5 pb-6 scrollbar-minimal animate-in fade-in duration-200">
            <MemoryTab
              bot={bot}
              logs={logs}
              onSaveFacts={(storedFacts) => updateBotField({ storedFacts })}
              onToggleMemory={config ? (memoryEnabled) => updateConfigField({ memoryEnabled }) : undefined}
              memoryEnabled={config?.memoryEnabled ?? true}
            />
          </div>
        )}

        {tab === 'settings' && config && (
          <div className="flex h-full min-h-0 flex-col px-0.5 pb-6 animate-in fade-in duration-200">
            <SettingsTab
              bot={bot}
              config={config}
              onUpdateBot={updateBotField}
              onUpdateConfig={updateConfigField}
              onDelete={handleDelete}
              onTriggersChanged={async () => { await onChange(); await reload(); }}
            />
          </div>
        )}
      </div>

      {selectedLog && (
        <TaskDetailModal
          log={selectedLog}
          firedBy={selectedLogTrigger}
          onClose={() => setSelectedLogId(null)}
          onPrev={selectedLogIndex > 0 ? () => setSelectedLogId(displayedLogs[selectedLogIndex - 1].id) : undefined}
          onNext={selectedLogIndex >= 0 && selectedLogIndex < displayedLogs.length - 1 ? () => setSelectedLogId(displayedLogs[selectedLogIndex + 1].id) : undefined}
          hasPrev={selectedLogIndex > 0}
          hasNext={selectedLogIndex >= 0 && selectedLogIndex < displayedLogs.length - 1}
        />
      )}
    </div>
  );
}

/** Small pill used in the agent header meta row. Reads like a label, doesn't
 *  shout. Keeps tonal weight away from the name + status. */
function HeroPill({
  icon: Icon,
  accent,
  children,
}: {
  icon?: any;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium',
        accent
          ? 'border-primary/25 bg-primary/10 text-primary'
          : 'border-[color:var(--dashboard-panel-border)] bg-theme-card/50 text-theme-muted',
      )}
    >
      {Icon && <Icon className={clsx('h-3 w-3', accent ? 'text-primary' : 'text-theme-muted')} />}
      <span className="truncate">{children}</span>
    </span>
  );
}
