'use client';

/**
 * Cloud VM — Deploys + Automations views.
 *
 * Mirrors the desktop's `DeploysTab` (full list with create form, logs, all
 * actions) and `VmAutomationsTab` (card grid focused on cards-per-deployment).
 * Both components consume the SAME data set returned by the cloud-ai
 * `/v1/cloud-engine/deploys` endpoint:
 *
 *   { ok: true, deployments: CloudDeployment[] }
 *
 * NOTE: previous versions read `res.deploys`, which is why automations were
 * always empty on the website. Field names follow the backend's snake_case
 * shape (`started_at`, `last_run_at`, `error_message`, `auto_restart`,
 * `trigger_bindings`, etc.) to match the desktop schema.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Clock,
  Cloud,
  FileText,
  History,
  ListChecks,
  Loader2,
  Pause,
  Play,
  Radio,
  RefreshCw,
  Rocket,
  ScrollText,
  Square,
  Timer,
  Trash2,
  Upload,
  Workflow,
  Zap,
} from 'lucide-react';
import {
  deleteCloudDeployment,
  getCloudDeploymentLogs,
  listCloudDeployments,
  restartCloudDeployment,
  stopCloudDeployment,
  type CloudDeployment,
  type CloudDeployKind,
} from '@/lib/cloudApi';

// ─── Shared helpers (kept aligned with desktop's CloudEngineDashboard) ───────

function formatRelativeTime(value?: string | null): string {
  if (!value) return 'Never';
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return 'Unknown';
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getDeployKindIcon(kind: string) {
  if (kind === 'workflow') return Workflow;
  if (kind === 'script') return FileText;
  return Rocket;
}

function deployKindMeta(kind: CloudDeployment['kind']) {
  if (kind === 'workflow') return { label: 'Workflow', icon: Workflow, tone: 'text-blue-400 bg-blue-500/10' };
  if (kind === 'script') return { label: 'Script', icon: FileText, tone: 'text-violet-400 bg-violet-500/10' };
  return { label: 'Project', icon: Rocket, tone: 'text-amber-400 bg-amber-500/10' };
}

function deployStatusMeta(status: CloudDeployment['status']) {
  switch (status) {
    case 'running':   return { label: 'Running',   tone: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', dot: 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse' };
    case 'completed': return { label: 'Completed', tone: 'bg-sky-500/10 text-sky-400 border-sky-500/20',           dot: 'bg-sky-500' };
    case 'stopped':   return { label: 'Stopped',   tone: 'bg-zinc-500/10 text-theme-muted border-theme/20',         dot: 'bg-zinc-400' };
    case 'failed':    return { label: 'Failed',    tone: 'bg-red-500/10 text-red-400 border-red-500/20',           dot: 'bg-red-500' };
    case 'pending':   return { label: 'Pending',   tone: 'bg-amber-500/10 text-amber-400 border-amber-500/20',     dot: 'bg-amber-500 animate-pulse' };
    case 'deploying': return { label: 'Deploying', tone: 'bg-blue-500/10 text-blue-400 border-blue-500/20',        dot: 'bg-blue-500 animate-pulse' };
    case 'uploading': return { label: 'Uploading', tone: 'bg-blue-500/10 text-blue-400 border-blue-500/20',        dot: 'bg-blue-500 animate-pulse' };
    default:          return { label: String(status), tone: 'bg-zinc-500/10 text-theme-muted border-theme/20',     dot: 'bg-zinc-400' };
  }
}

// ─── Shared deployment loader hook ───────────────────────────────────────────

function useDeployments(engine: any) {
  const [deployments, setDeployments] = useState<CloudDeployment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRunning = engine?.status === 'running';
  const pollRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    if (!isRunning) {
      setDeployments([]);
      setLoading(false);
      return;
    }
    setRefreshing(true);
    try {
      const res = await listCloudDeployments();
      if (res.ok) {
        // Cloud-ai backend returns { ok, deployments: CloudDeployment[] }.
        setDeployments(res.deployments || []);
        setError(null);
      } else {
        setError(res.error || 'Failed to load deployments');
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load deployments');
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, [isRunning]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!isRunning) return;
    pollRef.current = window.setInterval(() => void refresh(), 15_000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [refresh, isRunning]);

  return { deployments, loading, refreshing, error, refresh, isRunning };
}

// ─── Automations view (mirrors desktop's VmAutomationsTab) ───────────────────

export function CloudVmAutomations({ engine, className }: { engine: any; className?: string }) {
  const { deployments, loading, refreshing, error, refresh, isRunning } = useDeployments(engine);
  const [actionId, setActionId] = useState<string | null>(null);

  const handleStop = useCallback(async (id: string) => {
    setActionId(id);
    try { await stopCloudDeployment(id); await refresh(); } finally { setActionId(null); }
  }, [refresh]);

  const handleRestart = useCallback(async (id: string) => {
    setActionId(id);
    try { await restartCloudDeployment(id); await refresh(); } finally { setActionId(null); }
  }, [refresh]);

  const runningCount = deployments.filter((d) => d.status === 'running').length;
  const scheduledCount = deployments.filter(
    (d) => !!d.schedule || (d.trigger_bindings || []).some((t) => t.type === 'schedule.cron'),
  ).length;
  const attentionCount = deployments.filter((d) => d.status === 'failed' || !!d.error_message).length;

  if (loading) {
    return (
      <div className={clsx('flex items-center justify-center h-full text-theme-muted', className)}>
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading automations…
      </div>
    );
  }

  return (
    <div className={clsx('flex h-full min-h-0 flex-col px-6 py-6', className)}>
      <div className="mb-6 flex flex-shrink-0 items-start justify-between gap-4 px-1">
        <div className="min-w-0">
          <h1 className="font-stuard text-[28px] font-semibold leading-none tracking-tight text-theme-fg">
            Automations on VM
          </h1>
          <p className="mt-2 flex items-center gap-2 text-[13px] text-theme-muted">
            <Cloud className="h-3.5 w-3.5 shrink-0 text-primary/80" />
            <span>Workflows, scripts, and projects running on this cloud VM — independent of your laptop.</span>
          </p>
        </div>
        <button
          onClick={() => void refresh()}
          disabled={refreshing}
          className="inline-flex items-center gap-2 rounded-full border border-theme/30 bg-theme-card/50 px-3.5 py-2 text-[12px] font-semibold text-theme-fg shadow-sm transition hover:bg-theme-hover disabled:opacity-60"
          title="Refresh deployments"
        >
          <RefreshCw className={clsx('h-3.5 w-3.5', refreshing && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {!isRunning && (
        <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-700 dark:text-amber-400">
          Engine is paused. Resume the engine to manage automations.
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
          {/* Stats */}
          <section>
            <h2 className="mb-3 text-[15px] font-semibold text-theme-fg">Overview</h2>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <AutomationStat value={String(deployments.length).padStart(2, '0')} label="Total" />
              <AutomationStat value={String(runningCount).padStart(2, '0')} label="Running" />
              <AutomationStat value={String(scheduledCount).padStart(2, '0')} label="Scheduled" />
              <AutomationStat value={String(attentionCount).padStart(2, '0')} label="Attention" />
            </div>
          </section>

          {/* Grid */}
          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-[15px] font-semibold text-theme-fg">Deployed automations</h2>
              <span className="text-[12px] text-theme-muted">{deployments.length} on VM</span>
            </div>

            {deployments.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-theme/40 bg-zinc-500/5 px-6 py-14 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Zap className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-[15px] font-semibold text-theme-fg">No automations on this VM yet</h3>
                  <p className="max-w-sm text-[12px] text-theme-muted">
                    Use the Stuard desktop app&apos;s <span className="font-medium text-theme-fg">Deploys</span> tab to push a workflow,
                    script, or project to the VM. It will keep running 24/7.
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {deployments.map((dep) => {
                  const kind = deployKindMeta(dep.kind);
                  const status = deployStatusMeta(dep.status);
                  const KindIcon = kind.icon;
                  const triggers = (dep.trigger_bindings || []).map((t) => t.type).filter(Boolean);
                  const hasSchedule = !!dep.schedule || triggers.some((t) => t === 'schedule.cron');
                  const isDepRunning = dep.status === 'running';
                  const isBusy = actionId === dep.id;

                  return (
                    <div
                      key={dep.id}
                      className="group relative flex flex-col gap-3 rounded-2xl border border-theme/30 dark:border-transparent bg-zinc-500/10 p-5 transition hover:bg-theme-hover/30"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className={clsx('flex h-11 w-11 items-center justify-center rounded-xl', kind.tone)}>
                            <KindIcon className="h-5 w-5" />
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-[15px] font-semibold text-theme-fg">{dep.name}</div>
                            <div className="mt-1 flex items-center gap-1.5 text-[11px]">
                              <span className={clsx('h-1.5 w-1.5 rounded-full', status.dot)} />
                              <span className="font-medium text-theme-muted">
                                {status.label} · {kind.label}
                              </span>
                            </div>
                          </div>
                        </div>
                        <span
                          className={clsx(
                            'shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
                            status.tone,
                          )}
                        >
                          {status.label}
                        </span>
                      </div>

                      {dep.description && (
                        <p className="line-clamp-2 text-[12px] text-theme-muted">{dep.description}</p>
                      )}

                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-xl bg-theme-card px-3 py-2.5 shadow-sm">
                          <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-theme-muted/70">
                            Last run
                          </div>
                          <div className="mt-1 truncate text-[13px] font-semibold text-theme-fg">
                            {formatRelativeTime(dep.last_run_at || dep.started_at)}
                          </div>
                        </div>
                        <div className="rounded-xl bg-theme-card px-3 py-2.5 shadow-sm">
                          <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-theme-muted/70">
                            Schedule
                          </div>
                          <div className="mt-1 truncate text-[13px] font-semibold text-theme-fg">
                            {hasSchedule ? (dep.schedule || 'Cron') : '—'}
                          </div>
                        </div>
                      </div>

                      {dep.error_message && (
                        <div className="flex items-start gap-1.5 rounded-lg border border-red-500/20 bg-red-500/5 px-2.5 py-1.5 text-[11px] text-red-400">
                          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                          <span className="line-clamp-2">{dep.error_message}</span>
                        </div>
                      )}

                      <div className="mt-auto flex items-center gap-2 pt-1">
                        {isDepRunning ? (
                          <button
                            onClick={() => void handleStop(dep.id)}
                            disabled={isBusy}
                            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border border-theme/30 bg-theme-card px-3 py-1.5 text-[12px] font-medium text-theme-fg transition hover:bg-theme-hover disabled:opacity-60"
                          >
                            {isBusy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Pause className="h-3.5 w-3.5" />
                            )}
                            Stop
                          </button>
                        ) : (
                          <button
                            onClick={() => void handleRestart(dep.id)}
                            disabled={isBusy}
                            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-[12px] font-semibold text-primary-fg shadow-sm transition hover:opacity-90 disabled:opacity-60"
                          >
                            {isBusy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Play className="h-3.5 w-3.5" />
                            )}
                            Start
                          </button>
                        )}
                        {isDepRunning && (
                          <button
                            onClick={() => void handleRestart(dep.id)}
                            disabled={isBusy}
                            className="inline-flex items-center justify-center gap-1.5 rounded-full border border-theme/30 bg-theme-card px-3 py-1.5 text-[12px] font-medium text-theme-fg transition hover:bg-theme-hover disabled:opacity-60"
                            title="Restart"
                          >
                            {isBusy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3.5 w-3.5" />
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function AutomationStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl border border-theme/30 bg-zinc-500/10 px-4 py-3.5 dark:border-transparent">
      <div className="text-[22px] font-semibold leading-none tracking-tight text-theme-fg">{value}</div>
      <div className="mt-2 text-[12px] text-theme-muted">{label}</div>
    </div>
  );
}

// ─── Full Deploys view (mirrors desktop's DeploysTab list section) ───────────

const STATUS_CONFIG: Record<
  string,
  { color: string; bg: string; icon: any; label: string }
> = {
  running:   { color: 'text-green-500', bg: 'bg-green-500/10', icon: CheckCircle2, label: 'Running' },
  stopped:   { color: 'text-gray-400', bg: 'bg-gray-400/10', icon: Circle,        label: 'Stopped' },
  failed:    { color: 'text-red-500',   bg: 'bg-red-500/10',  icon: AlertCircle,  label: 'Failed' },
  deploying: { color: 'text-blue-400',  bg: 'bg-blue-500/10', icon: Loader2,      label: 'Deploying' },
  pending:   { color: 'text-amber-400', bg: 'bg-amber-500/10', icon: Clock,       label: 'Pending' },
  uploading: { color: 'text-blue-400',  bg: 'bg-blue-500/10', icon: Upload,       label: 'Uploading' },
  completed: { color: 'text-green-500', bg: 'bg-green-500/10', icon: CheckCircle2, label: 'Completed' },
};

interface DeploysProps {
  engine: any;
  /** Restrict listing to specific kinds. Default shows everything. */
  filterKinds?: CloudDeployKind[];
  title?: string;
  subtitle?: string;
  emptyHint?: string;
  showLogs?: boolean;
  className?: string;
}

export function CloudVmDeploys({
  engine,
  filterKinds,
  title = 'Deployments',
  subtitle = 'Workflows, scripts and projects running on this VM.',
  emptyHint = 'No deployments yet',
  showLogs = true,
  className,
}: DeploysProps) {
  const { deployments, loading, refreshing, error, refresh, isRunning } = useDeployments(engine);
  const [actionId, setActionId] = useState<string | null>(null);
  const [logsId, setLogsId] = useState<string | null>(null);
  const [logs, setLogs] = useState('');
  const [logsLoading, setLogsLoading] = useState(false);

  const filtered = useMemo(() => {
    if (!filterKinds || filterKinds.length === 0) return deployments;
    return deployments.filter((d) => filterKinds.includes(d.kind));
  }, [deployments, filterKinds]);

  const handleStop = useCallback(async (id: string) => {
    setActionId(id);
    try { await stopCloudDeployment(id); await refresh(); } finally { setActionId(null); }
  }, [refresh]);

  const handleRestart = useCallback(async (id: string) => {
    setActionId(id);
    try { await restartCloudDeployment(id); await refresh(); } finally { setActionId(null); }
  }, [refresh]);

  const handleDelete = useCallback(async (id: string, name: string) => {
    if (typeof window !== 'undefined' && !window.confirm(`Permanently delete deployment "${name}"?`)) return;
    setActionId(id);
    try { await deleteCloudDeployment(id); await refresh(); } finally { setActionId(null); }
  }, [refresh]);

  const handleViewLogs = useCallback(async (id: string) => {
    if (logsId === id) {
      setLogsId(null);
      return;
    }
    setLogsId(id);
    setLogsLoading(true);
    try {
      const res = await getCloudDeploymentLogs(id, 200);
      setLogs(res.ok ? (res.logs || '(empty)') : `(no logs available — ${res.error || 'error'})`);
    } finally {
      setLogsLoading(false);
    }
  }, [logsId]);

  const refreshLogs = useCallback(async () => {
    if (!logsId) return;
    setLogsLoading(true);
    try {
      const res = await getCloudDeploymentLogs(logsId, 200);
      setLogs(res.ok ? (res.logs || '(empty)') : `(no logs available — ${res.error || 'error'})`);
    } finally {
      setLogsLoading(false);
    }
  }, [logsId]);

  const stats = useMemo(() => ({
    live: filtered.filter((d) => d.status === 'running').length,
    workflows: filtered.filter((d) => d.kind === 'workflow').length,
    scheduled: filtered.filter(
      (d) => !!d.schedule || (d.trigger_bindings || []).some((t) => t.type === 'schedule.cron'),
    ).length,
    attention: filtered.filter((d) => d.status === 'failed' || !!d.error_message).length,
  }), [filtered]);

  if (loading) {
    return (
      <div className={clsx('flex items-center justify-center h-full text-theme-muted', className)}>
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading deployments…
      </div>
    );
  }

  return (
    <div className={clsx('h-full overflow-y-auto custom-scrollbar p-6 space-y-5', className)}>
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-theme-fg tracking-tight">{title}</h2>
          <p className="text-xs text-theme-muted mt-1 max-w-lg">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-theme-hover/40 text-theme-muted hover:text-theme-fg text-[11px] font-medium transition-colors disabled:opacity-50 shrink-0"
        >
          {refreshing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Refresh
        </button>
      </header>

      {!isRunning && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-700 dark:text-amber-400">
          Engine is paused. Resume the engine to manage deployments.
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-xs text-red-500 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Stats grid (matches desktop DeploysTab) */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {[
          { label: 'Live', value: stats.live, icon: Radio, tone: 'text-green-400', bg: 'bg-green-500/10' },
          { label: 'Workflows', value: stats.workflows, icon: Workflow, tone: 'text-blue-400', bg: 'bg-blue-500/10' },
          { label: 'Scheduled', value: stats.scheduled, icon: CalendarDays, tone: 'text-amber-400', bg: 'bg-amber-500/10' },
          { label: 'Attention', value: stats.attention, icon: AlertCircle, tone: 'text-red-400', bg: 'bg-red-500/10' },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-xl border border-theme bg-theme-card p-3 flex items-center gap-3"
          >
            <span
              className={clsx(
                'h-9 w-9 rounded-lg flex items-center justify-center',
                item.bg,
                item.tone,
              )}
            >
              <item.icon className="w-4 h-4" />
            </span>
            <div>
              <div className="text-lg font-black text-theme-fg leading-none">{item.value}</div>
              <div className="text-[10px] font-bold text-theme-muted uppercase tracking-wider mt-1">
                {item.label}
              </div>
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="rounded-2xl border border-theme bg-theme-card p-12 text-center">
          <Rocket className="w-10 h-10 text-theme-muted mx-auto mb-3 opacity-30" />
          <p className="text-sm font-bold text-theme-muted">{emptyHint}</p>
          <p className="text-xs text-theme-muted/70 mt-1">
            Deploy a workflow, script, or project from the Stuard desktop app — they will appear here and run independently of your laptop.
          </p>
        </div>
      )}

      {filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map((dep) => {
            const sc = STATUS_CONFIG[dep.status] || STATUS_CONFIG.stopped;
            const StatusIcon = sc.icon;
            const KindIcon = getDeployKindIcon(dep.kind);
            const triggerBindings = dep.trigger_bindings || [];
            const isExpanded = logsId === dep.id;
            const isBusy = actionId === dep.id;

            return (
              <div key={dep.id}>
                <div className="rounded-xl border border-theme bg-theme-card p-4 flex items-center justify-between hover:border-theme/20 dark:hover:border-transparent transition-all">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="h-6 w-6 rounded-lg bg-theme-hover text-theme-muted flex items-center justify-center shrink-0">
                        <KindIcon className="w-3.5 h-3.5" />
                      </span>
                      <span className="text-sm font-bold text-theme-fg truncate">{dep.name}</span>
                      <span
                        className={clsx(
                          'flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black shrink-0',
                          sc.bg,
                          sc.color,
                        )}
                      >
                        <StatusIcon className={clsx('w-2.5 h-2.5', dep.status === 'deploying' && 'animate-spin')} />
                        {sc.label}
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-theme-hover text-theme-muted shrink-0">
                        {dep.kind}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-[10px] text-theme-muted pl-8">
                      {dep.description && <span className="truncate max-w-[200px]">{dep.description}</span>}
                      <span className="flex items-center gap-1">
                        <History className="w-3 h-3" /> Created {formatRelativeTime(dep.created_at)}
                      </span>
                      {dep.pid != null && <span>PID {dep.pid}</span>}
                      {dep.schedule && (
                        <span className="flex items-center gap-1">
                          <CalendarDays className="w-3 h-3" /> {dep.schedule}
                        </span>
                      )}
                      {dep.timezone && (
                        <span className="flex items-center gap-1">
                          <Timer className="w-3 h-3" /> {dep.timezone}
                        </span>
                      )}
                      {dep.auto_restart && (
                        <span className="flex items-center gap-1">
                          <RefreshCw className="w-3 h-3" /> auto-restart
                        </span>
                      )}
                    </div>

                    {(triggerBindings.length > 0 || dep.last_run_at || dep.started_at) && (
                      <div className="mt-3 ml-8 grid grid-cols-2 lg:grid-cols-4 gap-2 text-[10px]">
                        <div className="rounded-lg bg-theme-hover/55 px-2.5 py-2">
                          <div className="text-theme-muted font-bold uppercase tracking-wider">Runs</div>
                          <div className="text-theme-fg font-black mt-0.5">{dep.run_count ?? 0}</div>
                        </div>
                        <div className="rounded-lg bg-theme-hover/55 px-2.5 py-2">
                          <div className="text-theme-muted font-bold uppercase tracking-wider">Last Run</div>
                          <div className="text-theme-fg font-black mt-0.5">
                            {formatRelativeTime(dep.last_run_at || dep.started_at)}
                          </div>
                        </div>
                        <div className="rounded-lg bg-theme-hover/55 px-2.5 py-2">
                          <div className="text-theme-muted font-bold uppercase tracking-wider">Completed</div>
                          <div className="text-theme-fg font-black mt-0.5">
                            {formatRelativeTime(dep.last_completed_at || dep.stopped_at)}
                          </div>
                        </div>
                        <div className="rounded-lg bg-theme-hover/55 px-2.5 py-2">
                          <div className="text-theme-muted font-bold uppercase tracking-wider">Source</div>
                          <div className="text-theme-fg font-black mt-0.5 truncate">
                            {dep.last_trigger_source || triggerBindings[0]?.type || 'manual'}
                          </div>
                        </div>
                      </div>
                    )}

                    {triggerBindings.length > 0 && (
                      <div className="mt-2 ml-8 flex flex-wrap gap-1.5">
                        {triggerBindings.slice(0, 4).map((binding) => (
                          <span
                            key={`${binding.type}:${binding.triggerId}`}
                            className="inline-flex items-center gap-1 rounded-full bg-theme-hover px-2 py-0.5 text-[9px] font-bold text-theme-muted"
                          >
                            <ListChecks className="w-2.5 h-2.5" />
                            {binding.type}
                          </span>
                        ))}
                      </div>
                    )}

                    {dep.error_message && (
                      <div className="flex items-center gap-1.5 mt-1.5 pl-8 text-[10px] text-red-400">
                        <AlertCircle className="w-3 h-3 shrink-0" />
                        <span className="truncate">{dep.error_message}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2 shrink-0 ml-4">
                    {showLogs && (
                      <button
                        onClick={() => void handleViewLogs(dep.id)}
                        className={clsx(
                          'flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-all',
                          isExpanded
                            ? 'bg-primary/10 text-primary'
                            : 'bg-theme-hover text-theme-muted hover:text-theme-fg',
                        )}
                      >
                        <ScrollText className="w-3 h-3" />
                        Logs
                        {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      </button>
                    )}
                    {dep.status === 'running' && (
                      <button
                        onClick={() => void handleStop(dep.id)}
                        disabled={isBusy}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-amber-500/10 text-amber-400 rounded-lg hover:bg-amber-500/20 disabled:opacity-50 transition-all"
                      >
                        {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Square className="w-3 h-3" />}
                        Stop
                      </button>
                    )}
                    {(['stopped', 'failed', 'completed'].includes(dep.status as string)) && (
                      <button
                        onClick={() => void handleRestart(dep.id)}
                        disabled={isBusy}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-green-500/10 text-green-500 rounded-lg hover:bg-green-500/20 disabled:opacity-50 transition-all"
                      >
                        {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                        Start
                      </button>
                    )}
                    <button
                      onClick={() => void handleDelete(dep.id, dep.name)}
                      disabled={isBusy}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-red-500 rounded-lg hover:bg-red-500/10 disabled:opacity-50 transition-all"
                      title="Delete"
                    >
                      {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                    </button>
                  </div>
                </div>

                {showLogs && isExpanded && (
                  <div className="mt-1 rounded-xl border border-theme bg-theme-hover/20 px-4 py-3">
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-theme-muted mb-2">
                      <ScrollText className="w-3 h-3" />
                      Recent logs
                      <button
                        type="button"
                        onClick={() => void refreshLogs()}
                        className="ml-auto text-theme-muted hover:text-theme-fg"
                        title="Refresh logs"
                      >
                        <RefreshCw className="w-3 h-3" />
                      </button>
                    </div>
                    <pre className="text-[11px] font-mono text-theme-fg/80 whitespace-pre-wrap max-h-48 overflow-y-auto custom-scrollbar bg-theme-bg/40 rounded-lg p-2.5">
                      {logsLoading ? 'Loading…' : logs || '(no logs yet)'}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
