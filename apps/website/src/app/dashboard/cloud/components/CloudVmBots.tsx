'use client';

/**
 * Cloud VM — Bots view.
 *
 * Faithfully mirrors the desktop's `BotsView` component used inside the Cloud
 * Engine workspace (scope='vm') from
 * `apps/desktop/src/renderer/components/BotsView.tsx`.
 *
 * Layout summary:
 * - List view (no selection):
 *   • Header: "Bots on VM" + subtitle, refresh action.
 *   • "Overview" StatCard grid: On VM / Running / Local-only / Errored.
 *     (We omit "Local only" since the website only sees VM bots; we surface
 *     "Last run" instead.)
 *   • "Deployed to VM" card grid (1/2/3 cols) with `BotCard`s.
 * - Detail view (a bot is selected):
 *   • Header: back arrow, emoji tile, name, Run Now + status badge.
 *   • Two-column body:
 *     - Aside: Overview (Next check-in, Active tasks, Total runs),
 *       Config (Executor, Intelligence, Trigger), Focus Brief (instructions).
 *     - Main: tabs (Activity / Memory / Settings) with content panes.
 *
 * Editing (create / update / delete / pause-resume / change schedule, tools,
 * triggers …) is intentionally *not* exposed here. Those operations require
 * mutating the bot file from the desktop's local store and re-syncing to the
 * VM. The view links out to the desktop app for mutation.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import {
  Activity,
  AlertCircle,
  Bell,
  Brain,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  Clock,
  Cloud,
  Cpu,
  ExternalLink,
  Globe,
  Hand,
  Hash,
  Layers,
  ListTodo,
  Loader2,
  Mail,
  RefreshCw,
  Scale,
  Settings2,
  Sparkles,
  Terminal,
  Wrench,
  XCircle,
  Zap,
} from 'lucide-react';
import {
  exportVmBotMemory,
  getVmBotsStatus,
  listVmBots,
  runVmBot,
  type VmBot,
  type VmBotConfig,
  type VmBotMemoryEntry,
  type VmBotTrigger,
} from '@/lib/cloudApi';

interface Props {
  engine: any;
  className?: string;
}

// ─── Constants (mirror desktop labels) ───────────────────────────────────────

const SCHEDULE_LABELS: Record<string, string> = {
  '10m': 'Every 10 minutes',
  '15m': 'Every 15 minutes',
  '30m': 'Every 30 minutes',
  '1h': 'Every hour',
  '2h': 'Every 2 hours',
  random: 'Random check-ins',
  manual: 'Manual only',
};

const SHORT_SCHEDULE_LABELS: Record<string, string> = {
  '10m': '10 mins',
  '15m': '15 mins',
  '30m': '30 mins',
  '1h': '1 hour',
  '2h': '2 hours',
  random: 'Random',
  manual: 'Manual',
};

const MODEL_MODE_META: Record<string, { label: string; description: string; icon: any }> = {
  auto:     { label: 'Auto',     description: 'Route model automatically',  icon: Sparkles },
  fast:     { label: 'Fast',     description: 'Lower latency responses',    icon: Zap },
  balanced: { label: 'Balanced', description: 'Good speed and quality',     icon: Scale },
  smart:    { label: 'Smart',    description: 'Best reasoning quality',     icon: Brain },
};

const NOTIFICATION_CHANNEL_LABELS: Record<string, { label: string; description: string }> = {
  app:  { label: 'In-App', description: 'Desktop notification popup' },
  sms:  { label: 'SMS',    description: 'Text message to verified phone' },
  call: { label: 'Phone Call', description: 'Voice call with TTS message' },
};

const TRIGGER_META: Record<string, { label: string; icon: any; tagline: string }> = {
  'schedule.interval': { label: 'On a schedule',    icon: Clock,    tagline: 'Wake every fixed interval' },
  'schedule.cron':     { label: 'Cron expression',  icon: Calendar, tagline: 'Custom cron expression' },
  webhook:             { label: 'Incoming webhook', icon: Globe,    tagline: 'Wake when a unique URL receives a POST' },
  'gmail.new_email':   { label: 'New Gmail email',  icon: Mail,     tagline: 'Wake when a new email matches your filters' },
  manual:              { label: 'Manual only',      icon: Hand,     tagline: 'Wake only when you press Run Now' },
};

// ─── Helpers (mirror desktop) ────────────────────────────────────────────────

function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 60_000) return 'Just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86400_000)}d ago`;
}

function timeUntil(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const diff = new Date(dateStr).getTime() - Date.now();
  if (diff <= 0) return 'Any moment';
  if (diff < 60_000) return `${Math.ceil(diff / 1000)}s`;
  if (diff < 3600_000) return `${Math.ceil(diff / 60_000)}m`;
  return `${Math.round(diff / 3600_000 * 10) / 10}h`;
}

function padCount(value: number): string {
  return String(Math.max(0, value)).padStart(2, '0');
}

function formatClockTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '--';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }).toLowerCase();
}

function formatShortScheduleLabel(interval?: string): string {
  if (!interval) return 'Manual';
  return SHORT_SCHEDULE_LABELS[interval] || SCHEDULE_LABELS[interval] || interval;
}

function describeTrigger(t: VmBotTrigger): string {
  switch (t.type) {
    case 'schedule.interval': {
      const every = t.args?.every || '30m';
      return SCHEDULE_LABELS[every] || `Every ${every}`;
    }
    case 'schedule.cron':
      return `Cron: ${t.args?.expression || t.args?.expr || ''}`.trim();
    case 'webhook':
      return t.args?.url ? `Webhook · ${t.args.url}` : 'Webhook · waiting for first hit';
    case 'gmail.new_email': {
      const filters: string[] = [];
      if (t.args?.from) filters.push(`from ${t.args.from}`);
      if (t.args?.subjectContains) filters.push(`subject "${t.args.subjectContains}"`);
      if (t.args?.label) filters.push(`label "${t.args.label}"`);
      return filters.length ? `Gmail · ${filters.join(', ')}` : 'Any new Gmail email';
    }
    case 'manual':
      return 'Run only when triggered manually';
    default:
      return t.type;
  }
}

// ─── Status helpers (mirror desktop) ─────────────────────────────────────────

type BadgeTone = 'neutral' | 'primary' | 'warning' | 'success' | 'danger';

interface StatusInfo {
  dot: string;
  label: string;
  textColor: string;
  badgeTone: BadgeTone;
}

function statusInfo(status?: string): StatusInfo {
  const s = String(status || '').toLowerCase();
  if (s === 'running') return { dot: 'bg-emerald-500', label: 'Running', textColor: 'text-emerald-400', badgeTone: 'success' };
  if (s === 'errored' || s === 'error' || s === 'failed') return { dot: 'bg-rose-500', label: 'Errored', textColor: 'text-rose-400', badgeTone: 'danger' };
  if (s === 'paused') return { dot: 'bg-zinc-400', label: 'Paused', textColor: 'text-theme-muted', badgeTone: 'neutral' };
  return { dot: 'bg-zinc-400', label: status || 'Unknown', textColor: 'text-theme-muted', badgeTone: 'neutral' };
}

// ─── Main component ─────────────────────────────────────────────────────────

export function CloudVmBots({ engine, className }: Props) {
  const [statusBots, setStatusBots] = useState<VmBot[]>([]);
  const [configBots, setConfigBots] = useState<VmBot[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);
  const isRunning = engine?.status === 'running';

  // Merge runtime status with full config (config is shape, status is fresh).
  const bots = useMemo<VmBot[]>(() => {
    const byId = new Map<string, VmBot>();
    for (const b of configBots) byId.set(b.id, { ...b });
    for (const b of statusBots) {
      const existing = byId.get(b.id);
      if (existing) {
        byId.set(b.id, {
          ...existing,
          status: b.status ?? existing.status,
          lastRunAt: b.lastRunAt ?? existing.lastRunAt,
          nextRunAt: b.nextRunAt ?? existing.nextRunAt,
          lastOutcome: b.lastOutcome ?? existing.lastOutcome,
          lastError: b.lastError ?? existing.lastError,
          isRunning: b.isRunning ?? existing.isRunning,
        });
      } else {
        byId.set(b.id, b);
      }
    }
    return Array.from(byId.values()).sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
  }, [statusBots, configBots]);

  const refresh = useCallback(async () => {
    if (!isRunning) {
      setLoading(false);
      setStatusBots([]);
      setConfigBots([]);
      return;
    }
    setRefreshing(true);
    try {
      const [statusRes, listRes] = await Promise.all([
        getVmBotsStatus(),
        listVmBots(),
      ]);
      if (statusRes.ok) {
        setStatusBots(((statusRes as any).bots || []) as VmBot[]);
        setError(null);
      } else {
        setError(statusRes.error || 'Failed to fetch bots');
      }
      // bots_list returns { ok, result: { ok, bots: [...] } } via the relay.
      const listResult = (listRes as any)?.result || listRes;
      if (listResult?.ok && Array.isArray(listResult.bots)) {
        setConfigBots(listResult.bots as VmBot[]);
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to fetch bots');
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, [isRunning]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Re-fetch every 10s — same cadence as desktop's BotsView.
  useEffect(() => {
    if (!isRunning) return;
    pollRef.current = window.setInterval(() => void refresh(), 10_000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [refresh, isRunning]);

  const handleRun = useCallback(async (botId: string) => {
    setActionLoading(`run-${botId}`);
    try {
      await runVmBot(botId);
      window.setTimeout(() => void refresh(), 1500);
    } finally {
      window.setTimeout(() => setActionLoading(null), 1500);
    }
  }, [refresh]);

  const selectedBot = useMemo(
    () => (selectedBotId ? bots.find((b) => b.id === selectedBotId) || null : null),
    [selectedBotId, bots],
  );

  // Loading
  if (loading) {
    return (
      <div className={clsx('flex h-full items-center justify-center gap-3', className)}>
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <span className="text-sm text-theme-muted">Loading bots…</span>
      </div>
    );
  }

  // Detail view
  if (selectedBot) {
    return (
      <BotDetailView
        bot={selectedBot}
        engineRunning={isRunning}
        onBack={() => setSelectedBotId(null)}
        onRun={() => void handleRun(selectedBot.id)}
        running={actionLoading === `run-${selectedBot.id}`}
        className={className}
      />
    );
  }

  // List view (no selection)
  const runningCount = bots.filter((b) => b.isRunning || String(b.status).toLowerCase() === 'running').length;
  const erroredCount = bots.filter((b) => {
    const s = String(b.status).toLowerCase();
    return s === 'errored' || s === 'error' || s === 'failed' || !!b.lastError;
  }).length;
  const lastRunCount = bots.filter((b) => !!b.lastRunAt).length;

  return (
    <div className={clsx('flex h-full min-h-0 flex-col px-6 py-6', className)}>
      {/* ─── Header ───────────────────────────────────────────────── */}
      <div className="mb-6 flex flex-shrink-0 items-start justify-between gap-4 px-1">
        <div className="min-w-0">
          <h1 className="font-stuard text-[28px] font-semibold leading-none tracking-tight text-theme-fg">
            Bots on VM
          </h1>
          <p className="mt-2 flex items-center gap-2 text-[13px] text-theme-muted">
            <Cloud className="h-3.5 w-3.5 shrink-0 text-primary/80" />
            <span>Bots running 24/7 on your cloud VM — independent of whether your laptop is open.</span>
          </p>
        </div>
        <button
          onClick={() => void refresh()}
          disabled={refreshing}
          className="inline-flex items-center gap-2 rounded-full border border-theme/30 bg-theme-card/50 px-3.5 py-2 text-[12px] font-semibold text-theme-fg shadow-sm transition hover:bg-theme-hover disabled:opacity-60"
          title="Refresh bots"
        >
          <RefreshCw className={clsx('h-3.5 w-3.5', refreshing && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {!isRunning && (
        <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-700 dark:text-amber-400">
          Engine is paused. Resume the engine to view bot status.
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-xs text-red-500 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-4 custom-scrollbar">
        <div className="space-y-7">
          {/* Overview stats */}
          <section>
            <h2 className="mb-3 text-[15px] font-semibold text-theme-fg">Overview</h2>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <StatCard value={padCount(bots.length)} label="On VM" />
              <StatCard value={padCount(runningCount)} label="Running" />
              <StatCard value={padCount(lastRunCount)} label="Have run" />
              <StatCard value={padCount(erroredCount)} label="Errored" />
            </div>
          </section>

          {/* Bots grid */}
          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-[15px] font-semibold text-theme-fg">Deployed to VM</h2>
              <span className="text-[12px] text-theme-muted">{bots.length} on VM</span>
            </div>

            {bots.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-theme/40 bg-zinc-500/5 px-6 py-14 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Cloud className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-[15px] font-semibold text-theme-fg">No bots on this VM yet</h3>
                  <p className="max-w-sm text-[12px] text-theme-muted">
                    Open any bot in the Stuard desktop app and choose &ldquo;Deploy to VM&rdquo; so it keeps
                    running even when your laptop is closed.
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {bots.map((bot) => (
                  <BotCard
                    key={bot.id}
                    bot={bot}
                    onClick={() => setSelectedBotId(bot.id)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

// ─── Bot card (mirrors desktop BotCard) ──────────────────────────────────────

function BotCard({ bot, onClick }: { bot: VmBot; onClick: () => void }) {
  const status = statusInfo(bot.status);

  return (
    <button
      onClick={onClick}
      className="group relative flex flex-col gap-3 rounded-2xl border border-theme/30 dark:border-transparent bg-zinc-500/10 p-5 text-left transition hover:bg-theme-hover/30"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-theme-card text-xl shadow-sm">
            {bot.emoji || '🤖'}
          </div>
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold text-theme-fg">{bot.name || bot.id}</div>
            <div className="mt-1 flex items-center gap-1.5 text-[11px]">
              <span className={clsx('h-1.5 w-1.5 rounded-full', status.dot)} />
              <span className={clsx('font-medium', status.textColor)}>{status.label}</span>
              {bot.isRunning && (
                <span className="ml-1 rounded-full bg-blue-500/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-blue-400">
                  Running now
                </span>
              )}
            </div>
          </div>
        </div>
        <DashboardBadge label="On VM" tone="primary" icon={Cloud} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-theme-card px-3 py-2.5 shadow-sm">
          <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-theme-muted/70">Last run</div>
          <div className="mt-1 truncate text-[13px] font-semibold text-theme-fg">{timeAgo(bot.lastRunAt)}</div>
        </div>
        <div className="rounded-xl bg-theme-card px-3 py-2.5 shadow-sm">
          <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-theme-muted/70">Next in</div>
          <div className="mt-1 truncate text-[13px] font-semibold text-theme-fg">
            {String(bot.status).toLowerCase() === 'running' ? timeUntil(bot.nextRunAt) : '—'}
          </div>
        </div>
      </div>

      {bot.lastError && (
        <div className="flex items-start gap-1.5 rounded-lg border border-red-500/20 bg-red-500/5 px-2.5 py-1.5 text-[11px] text-red-400">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
          <span className="line-clamp-2">{bot.lastError}</span>
        </div>
      )}
    </button>
  );
}

// ─── Detail view (mirrors desktop BotDetailView two-column layout) ──────────

type DetailTab = 'activity' | 'memory' | 'settings';

function BotDetailView({
  bot,
  engineRunning,
  onBack,
  onRun,
  running,
  className,
}: {
  bot: VmBot;
  engineRunning: boolean;
  onBack: () => void;
  onRun: () => void;
  running: boolean;
  className?: string;
}) {
  const [tab, setTab] = useState<DetailTab>('activity');
  const [memory, setMemory] = useState<{
    facts?: VmBotMemoryEntry[];
    runs?: VmBotMemoryEntry[];
    tasks?: VmBotMemoryEntry[];
  } | null>(null);
  const [memLoading, setMemLoading] = useState(false);
  const [memError, setMemError] = useState<string | null>(null);

  const loadMemory = useCallback(async () => {
    setMemLoading(true);
    setMemError(null);
    try {
      const res = await exportVmBotMemory(bot.id);
      if (res.ok) {
        const payload = (res as any).memory || res;
        setMemory({
          facts: payload.facts || [],
          runs: payload.runs || [],
          tasks: payload.tasks || [],
        });
      } else {
        setMemError(res.error || 'Could not load bot memory');
      }
    } catch (e: any) {
      setMemError(e?.message || 'Could not load bot memory');
    } finally {
      setMemLoading(false);
    }
  }, [bot.id]);

  useEffect(() => {
    void loadMemory();
  }, [loadMemory]);

  // Re-pull memory while bot is actively running so freshly-completed runs
  // surface in the Activity tab without a manual refresh.
  useEffect(() => {
    if (!engineRunning) return;
    if (!bot.isRunning && !running) return;
    const id = window.setInterval(() => void loadMemory(), 5_000);
    return () => window.clearInterval(id);
  }, [engineRunning, bot.isRunning, running, loadMemory]);

  const cfg: VmBotConfig = bot.config || ({} as VmBotConfig);
  const triggers: VmBotTrigger[] = bot.triggers || [];

  const status: StatusInfo = bot.isRunning
    ? { dot: 'bg-amber-400', label: 'Running now', textColor: 'text-amber-300', badgeTone: 'warning' }
    : statusInfo(bot.status);

  const modelMode = cfg.modelMode || 'balanced';
  const modelMeta = MODEL_MODE_META[modelMode] || MODEL_MODE_META.balanced;

  // Trigger summary mirrors desktop's compact label.
  const triggerSummary = (() => {
    const enabled = triggers.filter((t) => t.enabled !== false);
    if (enabled.length === 0) return 'None';
    if (enabled.length > 1) return 'Multiple';
    const t = enabled[0];
    if (t.type === 'schedule.interval') {
      return formatShortScheduleLabel((t.args?.every || cfg.interval || '30m') as string);
    }
    if (t.type === 'schedule.cron') return 'Cron';
    if (t.type === 'webhook') return 'Webhook';
    if (t.type === 'gmail.new_email') return 'Gmail';
    return 'Manual';
  })();

  const nextRunValue = (() => {
    if (bot.isRunning) return 'Running now';
    if (bot.nextRunAt) return formatClockTime(bot.nextRunAt);
    if (String(bot.status).toLowerCase() === 'errored') return 'Errored';
    if (String(bot.status).toLowerCase() !== 'running') return 'Paused';
    return 'Waiting';
  })();

  const activeTaskCount = (memory?.tasks || []).filter(
    (t: any) => t.status === 'queued' || t.status === 'in_progress',
  ).length;
  const totalRuns = (memory?.runs || []).length;

  const tabs: { id: DetailTab; label: string; icon: any; count?: number }[] = [
    { id: 'activity', label: 'Activity', icon: Activity, count: activeTaskCount },
    { id: 'memory',   label: 'Memory',   icon: Brain },
    { id: 'settings', label: 'Settings', icon: Settings2 },
  ];

  return (
    <div className={clsx('flex h-full min-h-0 flex-col px-6 py-6', className)}>
      {/* ─── Header ───────────────────────────────────────────────── */}
      <div className="mb-6 flex flex-shrink-0 items-start justify-between gap-4 px-1">
        <div className="flex min-w-0 items-center gap-3">
          <button
            onClick={onBack}
            className="rounded-full p-1.5 text-theme-muted transition hover:bg-theme-hover/40 hover:text-theme-fg"
            title="Back to bots"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-500/10 text-2xl">
            {bot.emoji || '🤖'}
          </div>
          <div className="min-w-0">
            <h1 className="truncate font-stuard text-[28px] font-semibold leading-none tracking-tight text-theme-fg">
              {bot.name || bot.id}
            </h1>
            <p className="mt-2 flex items-center gap-2 text-[13px] text-theme-muted">
              <Cloud className="h-3.5 w-3.5 shrink-0 text-primary/80" />
              <span>Running on your cloud VM — independent of your laptop.</span>
            </p>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <DashboardBadge label={status.label} tone={status.badgeTone} />
          <button
            onClick={onRun}
            disabled={running || bot.isRunning || !engineRunning}
            className="inline-flex items-center gap-2 rounded-full border border-theme bg-theme-card px-4 py-2 text-[13px] font-medium text-theme-fg shadow-sm transition hover:bg-theme-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {running || bot.isRunning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Terminal className="h-3.5 w-3.5" />
            )}
            {running || bot.isRunning ? 'Running' : 'Run Now'}
          </button>
          <a
            href="/download"
            className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-[13px] font-semibold text-primary-fg shadow-sm transition hover:opacity-90"
            title="Edit this bot in Stuard Desktop"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Edit in Desktop
          </a>
        </div>
      </div>

      {bot.lastError && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-[12px] text-red-300">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="min-w-0">
            <div className="font-medium">Last run failed</div>
            <div className="mt-0.5 text-red-300/80 break-words">{bot.lastError}</div>
          </div>
        </div>
      )}

      {/* ─── Body: two-column layout ────────────────────────────── */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-hidden lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        {/* LEFT aside */}
        <aside className="overflow-y-auto px-1 pb-2 custom-scrollbar">
          <div className="space-y-7">
            {/* Overview */}
            <section>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-[15px] font-semibold text-theme-fg">Overview</h2>
                <DashboardBadge label={status.label} tone={status.badgeTone} />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <StatCard
                  value={(nextRunValue || '').includes(':') ? nextRunValue.replace(':', ' : ') : nextRunValue}
                  label="Next Check-in"
                />
                <StatCard value={padCount(activeTaskCount)} label="Active Tasks" />
                <StatCard value={padCount(totalRuns)} label="Total Runs" className="col-span-2 sm:col-span-1" />
              </div>
            </section>

            {/* Config */}
            <section>
              <h2 className="mb-3 text-[15px] font-semibold text-theme-fg">Config</h2>
              <div className="grid grid-cols-3 gap-2.5">
                <StatCard size="md" value="Cloud VM" label="Executor" />
                <StatCard size="md" value={modelMeta.label} label="Intelligence" />
                <StatCard size="md" value={triggerSummary} label="Trigger" />
              </div>
            </section>

            {/* Focus Brief — read-only on website (editing requires desktop) */}
            {cfg.instructions && (
              <section>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 className="text-[15px] font-semibold text-theme-fg">Focus Brief</h2>
                  <span className="text-[10px] uppercase tracking-wider font-medium text-theme-muted">
                    Read-only
                  </span>
                </div>
                <div className="rounded-2xl border border-theme/30 dark:border-transparent bg-zinc-500/10 px-4 py-3.5">
                  <pre className="min-h-[64px] whitespace-pre-wrap text-[13px] leading-6 text-theme-fg font-sans">
                    {cfg.instructions}
                  </pre>
                </div>
              </section>
            )}
          </div>
        </aside>

        {/* RIGHT/MAIN: Tabs */}
        <main className="flex min-h-0 flex-col overflow-hidden">
          <div className="mb-4 flex flex-shrink-0 items-center gap-2 p-0.5">
            {tabs.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={clsx(
                    'inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-[13px] font-medium transition-all',
                    active
                      ? 'border-primary bg-theme-card text-theme-fg shadow-sm ring-2 ring-primary/30'
                      : 'border-theme/40 dark:border-transparent bg-theme-card/40 text-theme-muted hover:bg-theme-card hover:text-theme-fg',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{t.label}</span>
                  {(t.count ?? 0) > 0 && (
                    <span
                      className={clsx(
                        'ml-0.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded-md px-1.5 text-[10px] font-semibold',
                        active ? 'bg-theme-fg text-theme-bg' : 'bg-theme-hover/80 text-theme-muted',
                      )}
                    >
                      {t.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-4 custom-scrollbar">
            {tab === 'activity' && (
              <ActivityTab
                tasks={memory?.tasks || []}
                runs={memory?.runs || []}
                memLoading={memLoading}
                memError={memError}
                onReload={() => void loadMemory()}
              />
            )}
            {tab === 'memory' && (
              <MemoryTab
                memoryEnabled={cfg.memoryEnabled !== false}
                facts={memory?.facts || []}
                runs={memory?.runs || []}
                memLoading={memLoading}
                memError={memError}
              />
            )}
            {tab === 'settings' && (
              <SettingsTab bot={bot} cfg={cfg} triggers={triggers} />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

// ─── Activity tab (mirrors desktop ActivityTab) ──────────────────────────────

function ActivityTab({
  tasks,
  runs,
  memLoading,
  memError,
  onReload,
}: {
  tasks: VmBotMemoryEntry[];
  runs: VmBotMemoryEntry[];
  memLoading: boolean;
  memError: string | null;
  onReload: () => void;
}) {
  return (
    <div className="rounded-xl border border-theme/30 dark:border-transparent bg-zinc-500/10">
      {/* Active cards / tasks */}
      <section className="p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-[15px] font-semibold text-theme-fg">
            <ListTodo className="h-4 w-4" /> Active Cards
            <span className="text-[12px] font-normal text-theme-muted">({tasks.length})</span>
          </h3>
          <button
            onClick={onReload}
            disabled={memLoading}
            className="inline-flex items-center gap-1 rounded-lg bg-theme-hover/40 px-2 py-1 text-[10px] font-medium text-theme-muted hover:text-theme-fg disabled:opacity-50"
          >
            {memLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Reload
          </button>
        </div>
        {memError ? (
          <div className="text-[12px] text-amber-600 dark:text-amber-400 flex items-start gap-2">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{memError}</span>
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex items-center justify-center rounded-lg border border-dashed border-theme/40 p-6 text-center">
            <div className="max-w-sm text-[12px] leading-5 text-theme-muted">
              No active kanban cards — the bot will add some as it works.
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            {tasks.slice(0, 30).map((t: any, i) => (
              <div
                key={t.id || `task-${i}`}
                className="rounded-lg border border-theme/30 dark:border-transparent bg-theme-card px-3.5 py-2.5 shadow-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13px] font-medium text-theme-fg">
                    {t.title || t.text || t.summary || `Task ${i + 1}`}
                  </span>
                  {t.status && (
                    <span
                      className={clsx(
                        'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                        t.status === 'completed' && 'bg-emerald-500/10 text-emerald-300',
                        t.status === 'failed' && 'bg-red-500/10 text-red-300',
                        t.status === 'in_progress' && 'bg-amber-500/10 text-amber-300',
                        (t.status === 'queued' || !['completed', 'failed', 'in_progress'].includes(t.status)) &&
                          'bg-theme-card/70 text-theme-muted',
                      )}
                    >
                      {t.status}
                    </span>
                  )}
                </div>
                {(t.notes || t.instructions || t.description) && (
                  <div className="mt-1 line-clamp-2 text-[11px] text-theme-muted">
                    {t.notes || t.instructions || t.description}
                  </div>
                )}
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
            <span className="text-[12px] font-normal text-theme-muted">({runs.length})</span>
          </h3>
        </div>
        {runs.length === 0 ? (
          <div className="flex items-center justify-center rounded-lg border border-dashed border-theme/40 p-6 text-center">
            <div className="max-w-sm text-[12px] leading-5 text-theme-muted">
              No runs yet. Click &ldquo;Run Now&rdquo; to trigger one.
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            {runs.slice(0, 20).map((log: any, i) => (
              <RunCard key={log.id || `run-${i}`} log={log} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function RunCard({ log }: { log: any }) {
  const outcome = String(log.outcome || log.status || '').toLowerCase();
  const failed = outcome === 'failed' || outcome === 'error';
  const summary = log.summary || log.agentMessage || log.text || log.content || '';
  return (
    <div className="rounded-lg border border-theme/30 dark:border-transparent bg-theme-card px-3.5 py-2.5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {failed ? (
            <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
          )}
          <span className="text-[12px] font-semibold text-theme-fg capitalize">
            {outcome || 'Completed'}
          </span>
        </div>
        <span className="text-[11px] text-theme-muted">
          {timeAgo(log.at || log.startedAt || log.createdAt || log.updatedAt)}
        </span>
      </div>
      {summary && (
        <div className="mt-1.5 line-clamp-3 text-[12px] text-theme-fg/90 whitespace-pre-wrap">
          {summary}
        </div>
      )}
      {log.notes && failed && (
        <div className="mt-1 text-[11px] text-red-300/80 line-clamp-2">{log.notes}</div>
      )}
    </div>
  );
}

// ─── Memory tab (mirrors desktop MemoryTab) ──────────────────────────────────

function MemoryTab({
  memoryEnabled,
  facts,
  runs,
  memLoading,
  memError,
}: {
  memoryEnabled: boolean;
  facts: VmBotMemoryEntry[];
  runs: VmBotMemoryEntry[];
  memLoading: boolean;
  memError: string | null;
}) {
  const summaries = useMemo(
    () =>
      runs
        .filter((r: any) => (r.summary || r.agentMessage || r.text) && r.outcome !== 'failed')
        .slice(0, 10),
    [runs],
  );

  return (
    <div className="rounded-xl border border-theme/30 dark:border-transparent bg-zinc-500/10 p-4 space-y-6">
      <ConfigRow
        label="Memory tool"
        description="Inject recent runs and stored facts into the bot's prompt at runtime so it remembers across runs."
        control={
          <span
            className={clsx(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold',
              memoryEnabled ? 'bg-emerald-500/15 text-emerald-400' : 'bg-theme-hover/60 text-theme-muted',
            )}
          >
            {memoryEnabled ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
            {memoryEnabled ? 'Enabled' : 'Disabled'}
          </span>
        }
      />

      {memError && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-[12px] text-amber-700 dark:text-amber-400 flex items-start gap-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{memError}</span>
        </div>
      )}

      {/* Stored facts */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-[15px] font-semibold text-theme-fg">
            <Brain className="h-4 w-4" /> Things to remember
            <span className="text-[12px] font-normal text-theme-muted">({facts.length})</span>
          </h3>
          {memLoading && <Loader2 className="h-3 w-3 animate-spin text-theme-muted" />}
        </div>
        {facts.length === 0 ? (
          <div className="flex items-center justify-center rounded-lg border border-dashed border-theme/40 p-6 text-center">
            <div className="max-w-sm text-[12px] leading-5 text-theme-muted">
              No durable facts yet — the bot will store useful findings here as it works.
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            {facts.slice(0, 30).map((fact: any, i) => {
              const text = String(fact.text || fact.content || fact.summary || '');
              return (
                <div
                  key={fact.id || `fact-${i}`}
                  className="rounded-2xl border border-theme/40 dark:border-transparent bg-theme-card px-4 py-3 shadow-sm"
                >
                  <div className="text-[12px] text-theme-fg/90 whitespace-pre-wrap">{text}</div>
                  {(fact.createdAt || fact.updatedAt) && (
                    <div className="mt-1 text-[10px] text-theme-muted">
                      {timeAgo(fact.updatedAt || fact.createdAt)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Recent run summaries */}
      <section>
        <h3 className="mb-3 text-[15px] font-semibold text-theme-fg">Recent runs (auto)</h3>
        {summaries.length === 0 ? (
          <div className="flex items-center justify-center rounded-lg border border-dashed border-theme/40 p-6 text-center">
            <div className="max-w-sm text-[12px] leading-5 text-theme-muted">
              Memory will populate after the bot runs a few times.
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            {summaries.map((s: any, i) => (
              <div
                key={s.id || `summary-${i}`}
                className="rounded-2xl border border-theme/40 dark:border-transparent bg-theme-card px-4 py-3 shadow-sm"
              >
                <div className="text-[11px] text-theme-muted">
                  {timeAgo(s.at || s.startedAt || s.createdAt)}
                </div>
                <div className="mt-1 line-clamp-3 text-[12px] text-theme-fg/90">
                  {s.summary || s.agentMessage || s.text}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ─── Settings tab (read-only mirror of desktop SettingsTab) ──────────────────

function SettingsTab({
  bot,
  cfg,
  triggers,
}: {
  bot: VmBot;
  cfg: VmBotConfig;
  triggers: VmBotTrigger[];
}) {
  const channels = cfg.notificationChannels || [];
  const tools = cfg.allowedTools || [];
  const skills = cfg.skills || [];
  const modelMeta = MODEL_MODE_META[cfg.modelMode || 'balanced'] || MODEL_MODE_META.balanced;
  const ModelIcon = modelMeta.icon;

  return (
    <div className="rounded-xl border border-theme/30 dark:border-transparent bg-zinc-500/10 p-4 space-y-6">
      {/* Read-only banner */}
      <div className="flex items-start gap-2 rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2.5 text-[12px] text-blue-600 dark:text-blue-300">
        <Cloud className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div>
          This bot lives on your VM. Settings are <span className="font-semibold">read-only</span> here —
          {' '}
          <a className="underline" href="/download">
            open Stuard Desktop
          </a>{' '}
          to edit identity, triggers, tools, model and more.
        </div>
      </div>

      {/* Identity */}
      <section>
        <h3 className="mb-3 text-[15px] font-semibold text-theme-fg">Identity</h3>
        <div className="rounded-2xl border border-theme/40 dark:border-transparent bg-theme-card px-4 py-3.5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-500/10 text-2xl">
              {bot.emoji || '🤖'}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-semibold text-theme-fg">
                {bot.name || bot.id}
              </div>
              <div className="mt-0.5 flex items-center gap-1 text-[11px] text-theme-muted font-mono truncate">
                <Hash className="h-3 w-3" /> {bot.id}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Personality / Objective */}
      {cfg.instructions && (
        <section>
          <h3 className="mb-3 text-[15px] font-semibold text-theme-fg">Personality / Objective</h3>
          <div className="rounded-2xl border border-theme/40 dark:border-transparent bg-theme-card px-4 py-3 shadow-sm">
            <pre className="whitespace-pre-wrap text-[13px] leading-6 text-theme-fg/90 font-sans">
              {cfg.instructions}
            </pre>
          </div>
        </section>
      )}

      {/* Triggers */}
      <section>
        <h3 className="mb-3 text-[15px] font-semibold text-theme-fg">Triggers</h3>
        {triggers.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-theme/40 px-4 py-6 text-center text-[12px] text-theme-muted">
            No triggers configured. The bot will only run when you click &ldquo;Run Now&rdquo;.
          </div>
        ) : (
          <ul className="space-y-2">
            {triggers.map((t) => {
              const meta = TRIGGER_META[t.type] || { label: t.type, icon: Clock, tagline: '' };
              const Icon = meta.icon;
              return (
                <li
                  key={t.id}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-theme/40 dark:border-transparent bg-theme-card px-4 py-3 shadow-sm"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold text-theme-fg">{meta.label}</div>
                      <div className="mt-0.5 text-[11px] text-theme-muted line-clamp-1">
                        {describeTrigger(t)}
                      </div>
                    </div>
                  </div>
                  <span
                    className={clsx(
                      'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                      t.enabled === false
                        ? 'bg-theme-hover/40 text-theme-muted'
                        : 'bg-emerald-500/15 text-emerald-400',
                    )}
                  >
                    {t.enabled === false ? 'Off' : 'On'}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Tools */}
      <section>
        <h3 className="mb-3 text-[15px] font-semibold text-theme-fg">
          Tools <span className="text-[12px] font-normal text-theme-muted">({tools.length})</span>
        </h3>
        {tools.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-theme/40 px-4 py-6 text-center text-[12px] text-theme-muted">
            Default bot tools only.
          </div>
        ) : (
          <div className="rounded-2xl border border-theme/40 dark:border-transparent bg-theme-card p-3 shadow-sm">
            <div className="flex flex-wrap gap-1.5">
              {tools.map((tool) => (
                <span
                  key={tool}
                  className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-[10px] font-mono text-primary"
                >
                  <Wrench className="h-2.5 w-2.5" />
                  {tool}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Skills */}
      {skills.length > 0 && (
        <section>
          <h3 className="mb-3 text-[15px] font-semibold text-theme-fg">
            Skills <span className="text-[12px] font-normal text-theme-muted">({skills.length})</span>
          </h3>
          <ul className="space-y-2">
            {skills.map((s) => (
              <li
                key={s.id}
                className="flex items-start gap-3 rounded-2xl border border-theme/40 dark:border-transparent bg-theme-card px-4 py-3 shadow-sm"
              >
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-base shrink-0"
                  style={
                    s.color
                      ? { background: `${s.color}22`, color: s.color }
                      : undefined
                  }
                >
                  {s.icon || <Layers className="h-4 w-4 text-primary" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-theme-fg truncate">{s.name}</div>
                  {s.description && (
                    <div className="mt-0.5 text-[11px] text-theme-muted line-clamp-2">
                      {s.description}
                    </div>
                  )}
                </div>
                {s.isActive === false && (
                  <span className="shrink-0 rounded-full bg-theme-hover/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-theme-muted">
                    Inactive
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Notifications */}
      <section>
        <h3 className="mb-3 text-[15px] font-semibold text-theme-fg">Notifications</h3>
        {channels.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-theme/40 px-4 py-6 text-center text-[12px] text-theme-muted">
            No notification channels configured.
          </div>
        ) : (
          <ul className="space-y-2">
            {channels.map((ch) => {
              const meta = NOTIFICATION_CHANNEL_LABELS[ch] || { label: ch, description: '' };
              return (
                <li
                  key={ch}
                  className="flex items-center gap-3 rounded-2xl border border-theme/40 dark:border-transparent bg-theme-card px-4 py-3 shadow-sm"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400 shrink-0">
                    <Bell className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-theme-fg">{meta.label}</div>
                    {meta.description && (
                      <div className="text-[11px] text-theme-muted">{meta.description}</div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Model */}
      <section>
        <h3 className="mb-3 text-[15px] font-semibold text-theme-fg">Model</h3>
        <div className="rounded-2xl border border-theme/40 dark:border-transparent bg-theme-card px-4 py-3.5 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
              <ModelIcon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-theme-fg">{modelMeta.label}</div>
              <div className="mt-0.5 text-[11px] text-theme-muted">{modelMeta.description}</div>
              {cfg.modelId && (
                <div className="mt-1 text-[10px] font-mono text-theme-muted truncate">
                  <Cpu className="inline h-3 w-3 mr-1" /> {cfg.modelId}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Schedule (default interval) */}
      {cfg.interval && (
        <section>
          <h3 className="mb-3 text-[15px] font-semibold text-theme-fg">Default schedule</h3>
          <div className="flex items-center gap-3 rounded-2xl border border-theme/40 dark:border-transparent bg-theme-card px-4 py-3 shadow-sm">
            <Clock className="h-4 w-4 text-theme-muted shrink-0" />
            <div className="text-[13px] text-theme-fg">
              {SCHEDULE_LABELS[cfg.interval] || cfg.interval}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

// ─── Layout primitives (mirror desktop) ──────────────────────────────────────

function StatCard({
  value,
  label,
  size = 'lg',
  className,
}: {
  value: React.ReactNode;
  label: string;
  size?: 'lg' | 'md';
  className?: string;
}) {
  return (
    <div
      className={clsx(
        'rounded-2xl bg-zinc-500/10 px-4 py-3.5 border border-theme/30 dark:border-transparent',
        className,
      )}
    >
      <div
        className={clsx(
          'font-semibold tracking-tight text-theme-fg leading-none truncate',
          size === 'lg' ? 'text-[22px]' : 'text-[15px]',
        )}
      >
        {value}
      </div>
      <div className="mt-2 text-[12px] text-theme-muted">{label}</div>
    </div>
  );
}

function DashboardBadge({
  label,
  tone = 'neutral',
  icon: Icon,
  className,
}: {
  label: string;
  tone?: BadgeTone;
  icon?: any;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold',
        tone === 'primary' && 'border-primary/25 bg-primary/10 text-primary',
        tone === 'warning' && 'border-amber-500/20 bg-amber-500/10 text-amber-300',
        tone === 'success' && 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
        tone === 'danger' && 'border-red-500/20 bg-red-500/10 text-red-300',
        tone === 'neutral' && 'border-theme/10 bg-theme-card/70 text-theme-muted',
        className,
      )}
    >
      {Icon && <Icon className="h-3.5 w-3.5" />}
      <span>{label}</span>
    </span>
  );
}

function ConfigRow({
  label,
  description,
  control,
}: {
  label: string;
  description?: string;
  control: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-theme/40 dark:border-transparent bg-theme-card px-4 py-3.5 shadow-sm">
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-theme-fg">{label}</div>
        {description && <div className="mt-0.5 text-[11px] text-theme-muted">{description}</div>}
      </div>
      <div className="flex-none">{control}</div>
    </div>
  );
}
