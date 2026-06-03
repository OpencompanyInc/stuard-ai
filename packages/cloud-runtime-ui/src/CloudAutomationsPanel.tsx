'use client';

/**
 * CloudAutomationsPanel — shared, friendly automations view.
 *
 * Used by BOTH the website dashboard and the desktop app so the experience
 * stays identical. It is deliberately non-technical: plain-language status,
 * "when did it run / when does it run next", readable activity instead of a raw
 * log dump, the latest output, and clear error explanations.
 *
 * It is presentational + interactive only — the host app supplies the data and
 * the action callbacks (refresh / start / stop / delete / fetch logs), because
 * the website and desktop talk to the backend through different clients.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Cloud,
  FileText,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Repeat,
  Rocket,
  Sparkles,
  Terminal,
  Trash2,
  Workflow,
  Zap,
} from 'lucide-react';

// ─── Public types ────────────────────────────────────────────────────────────

export interface AutomationTriggerBinding {
  triggerId?: string;
  type: string;
  mode?: string | null;
  args?: Record<string, any>;
}

export interface AutomationDeployment {
  id: string;
  name: string;
  kind: string; // 'workflow' | 'project'
  description?: string | null;
  status: string;
  schedule?: string | null;
  timezone?: string | null;
  auto_restart?: boolean;
  pid?: number | null;
  run_count?: number;
  last_run_at?: string | null;
  last_completed_at?: string | null;
  last_trigger_source?: string | null;
  trigger_bindings?: AutomationTriggerBinding[];
  error_message?: string | null;
  started_at?: string | null;
  stopped_at?: string | null;
  created_at?: string;
}

export interface CloudAutomationsPanelProps {
  deployments: AutomationDeployment[];
  loading?: boolean;
  refreshing?: boolean;
  error?: string | null;
  /** Whether the cloud engine is running. When false, actions are disabled. */
  isRunning?: boolean;
  title?: string;
  subtitle?: string;
  emptyTitle?: string;
  emptyHint?: string;
  onRefresh: () => void;
  onStart: (id: string) => void | Promise<void>;
  onStop: (id: string) => void | Promise<void>;
  onDelete: (id: string, name: string) => void | Promise<void>;
  getLogs: (id: string, lines?: number) => Promise<string>;
  /** Extra buttons rendered in the header (e.g. desktop "New automation"). */
  headerActions?: React.ReactNode;
  /** Rendered above the list (e.g. desktop create form). */
  banner?: React.ReactNode;
  className?: string;
}

// ─── Time helpers ──────────────────────────────────────────────────────────────

function formatRelative(value?: string | null): string {
  if (!value) return 'Never';
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return 'Unknown';
  const diff = Date.now() - time;
  const future = diff < 0;
  const seconds = Math.floor(Math.abs(diff) / 1000);
  const fmt = (n: number, unit: string) => `${future ? 'in ' : ''}${n}${unit}${future ? '' : ' ago'}`;
  if (seconds < 45) return future ? 'in a moment' : 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return fmt(minutes, 'm');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return fmt(hours, 'h');
  const days = Math.floor(hours / 24);
  if (days < 30) return fmt(days, 'd');
  const months = Math.floor(days / 30);
  if (months < 12) return fmt(months, 'mo');
  return fmt(Math.floor(months / 12), 'y');
}

function formatClock(value?: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// ─── Schedule (cron) helpers ─────────────────────────────────────────────────

function parseCronField(field: string, min: number, max: number): Set<number> | null {
  const values = new Set<number>();
  for (const rawPart of field.split(',')) {
    const part = rawPart.trim();
    if (!part) return null;
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart == null ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step <= 0) return null;
    if (rangePart === '*') {
      for (let n = min; n <= max; n += step) values.add(n);
      continue;
    }
    const range = rangePart.match(/^(\d+)-(\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (start < min || end > max || start > end) return null;
      for (let n = start; n <= end; n += step) values.add(n);
      continue;
    }
    const exact = Number(rangePart);
    if (!Number.isInteger(exact) || exact < min || exact > max || step !== 1) return null;
    values.add(exact);
  }
  return values;
}

function parseCron(expr: string): Array<Set<number>> | null {
  const parts = String(expr || '').trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const ranges: Array<[number, number]> = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
  const parsed = parts.map((part, i) => parseCronField(part, ranges[i][0], ranges[i][1]));
  if (parsed.some((p) => !p)) return null;
  return parsed as Array<Set<number>>;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function humanizeCron(expr?: string | null): string | null {
  const cron = String(expr || '').trim();
  if (!cron) return null;
  const parts = cron.split(/\s+/);
  if (parts.length !== 5) return cron;
  const [min, hour, dom, mon, dow] = parts;

  const at = (h: string, m: string) => {
    const hh = Number(h);
    const mm = Number(m);
    if (!Number.isInteger(hh) || !Number.isInteger(mm)) return null;
    const d = new Date();
    d.setHours(hh, mm, 0, 0);
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  };

  if (cron === '* * * * *') return 'Every minute';
  const everyNMin = min.match(/^\*\/(\d+)$/);
  if (everyNMin && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return `Every ${everyNMin[1]} minutes`;
  }
  if (min === '0' && hour === '*' && dom === '*' && mon === '*' && dow === '*') return 'Every hour';
  const everyNHour = hour.match(/^\*\/(\d+)$/);
  if (/^\d+$/.test(min) && everyNHour && dom === '*' && mon === '*' && dow === '*') {
    return `Every ${everyNHour[1]} hours`;
  }
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*' && mon === '*' && dow === '*') {
    const t = at(hour, min);
    return t ? `Every day at ${t}` : cron;
  }
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*' && mon === '*' && /^\d+$/.test(dow)) {
    const t = at(hour, min);
    const day = WEEKDAYS[Number(dow) % 7];
    return t ? `Every ${day} at ${t}` : cron;
  }
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && /^\d+$/.test(dom) && mon === '*' && dow === '*') {
    const t = at(hour, min);
    return t ? `Monthly on day ${dom} at ${t}` : cron;
  }
  return cron;
}

function nextRunFromCron(expr?: string | null): Date | null {
  const cron = String(expr || '').trim();
  if (!cron) return null;
  const parsed = parseCron(cron);
  if (!parsed) return null;
  const [mins, hours, doms, months, dows] = parsed;
  let d = new Date();
  d.setSeconds(0, 0);
  d = new Date(d.getTime() + 60_000);
  // Scan forward up to ~13 months for the next matching minute.
  for (let i = 0; i < 400 * 24 * 60; i++, d = new Date(d.getTime() + 60_000)) {
    const weekdayOk = dows.has(d.getDay()) || (d.getDay() === 0 && dows.has(7));
    if (
      mins.has(d.getMinutes()) &&
      hours.has(d.getHours()) &&
      doms.has(d.getDate()) &&
      months.has(d.getMonth() + 1) &&
      weekdayOk
    ) {
      return d;
    }
  }
  return null;
}

function getScheduleCron(dep: AutomationDeployment): string | null {
  if (dep.schedule && String(dep.schedule).trim()) return String(dep.schedule).trim();
  const cronBinding = (dep.trigger_bindings || []).find(
    (t) => t.type === 'schedule.cron' && t.args && typeof t.args.cron === 'string',
  );
  return cronBinding?.args?.cron ? String(cronBinding.args.cron).trim() : null;
}

function hasEventTriggers(dep: AutomationDeployment): boolean {
  return (dep.trigger_bindings || []).some((t) => t.type !== 'schedule.cron');
}

// ─── Friendly kind + status ──────────────────────────────────────────────────

function kindMeta(kind: string): { label: string; Icon: typeof Workflow; tone: string } {
  if (kind === 'workflow') return { label: 'Workflow', Icon: Workflow, tone: 'text-blue-500 bg-blue-500/10' };
  if (kind === 'project') return { label: 'App', Icon: Rocket, tone: 'text-amber-500 bg-amber-500/10' };
  return { label: 'Automation', Icon: Zap, tone: 'text-primary bg-primary/10' };
}

type StatusKey = 'active' | 'finished' | 'paused' | 'attention' | 'starting';

interface FriendlyStatus {
  key: StatusKey;
  label: string;
  blurb: string;
  chip: string;
  dot: string;
}

function friendlyStatus(dep: AutomationDeployment): FriendlyStatus {
  const status = String(dep.status || '').toLowerCase();
  const scheduled = !!getScheduleCron(dep);
  const eventDriven = hasEventTriggers(dep);

  if (status === 'failed' || (dep.error_message && status !== 'running')) {
    return {
      key: 'attention',
      label: 'Needs attention',
      blurb: dep.error_message ? "Last run didn't finish — see the details below." : 'Something went wrong on the last run.',
      chip: 'bg-red-500/10 text-red-500 border-red-500/20',
      dot: 'bg-red-500',
    };
  }
  if (status === 'running') {
    let blurb = 'Active and running right now.';
    if (scheduled) blurb = 'Active — runs automatically on its schedule.';
    else if (eventDriven) blurb = 'Active — waiting to run when something happens.';
    return {
      key: 'active',
      label: scheduled || eventDriven ? 'On' : 'Running',
      blurb,
      chip: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
      dot: 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.55)] animate-pulse',
    };
  }
  if (status === 'completed') {
    return {
      key: 'finished',
      label: 'Finished',
      blurb: 'Ran once and completed successfully.',
      chip: 'bg-sky-500/10 text-sky-500 border-sky-500/20',
      dot: 'bg-sky-500',
    };
  }
  if (status === 'pending' || status === 'deploying' || status === 'uploading') {
    return {
      key: 'starting',
      label: 'Starting up',
      blurb: 'Getting everything ready…',
      chip: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
      dot: 'bg-amber-500 animate-pulse',
    };
  }
  // stopped / unknown
  return {
    key: 'paused',
    label: 'Paused',
    blurb: 'Paused — it won’t run until you turn it back on.',
    chip: 'bg-zinc-500/10 text-theme-muted border-theme/20',
    dot: 'bg-zinc-400',
  };
}

// ─── Activity (log) parsing → readable timeline + output ──────────────────────

type ActivityLevel = 'info' | 'success' | 'error' | 'run';

interface ActivityEntry {
  time: string;
  text: string;
  level: ActivityLevel;
}

interface ParsedActivity {
  entries: ActivityEntry[];
  output: string[];
  totalRuns: number;
  errorCount: number;
}

const SYSTEM_TAG = /^\[(deploy|engine|restore|cron|run:\d+|stderr|log truncated)\]/i;

function parseActivity(raw: string): ParsedActivity {
  const lines = String(raw || '').split('\n');
  const entries: ActivityEntry[] = [];
  const output: string[] = [];
  let totalRuns = 0;
  let errorCount = 0;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '');
    if (!line.trim()) continue;

    // Pull a leading ISO timestamp if present: "[2026-06-02T18:00:00.000Z] rest"
    let time = '';
    let rest = line;
    const tsMatch = line.match(/^\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\]\s*(.*)$/);
    if (tsMatch) {
      const d = new Date(tsMatch[1]);
      time = Number.isFinite(d.getTime())
        ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })
        : '';
      rest = tsMatch[2];
    }

    if (!rest.trim()) continue;

    // Raw program output (no recognized system tag) → collect for "Latest output".
    const isSystem = SYSTEM_TAG.test(rest) || /^(Starting deployment:|Process exited:|Auto-restarting)/i.test(rest);
    if (!isSystem) {
      output.push(rest);
      entries.push({ time, text: rest, level: /error|fail|exception|traceback/i.test(rest) ? 'error' : 'info' });
      if (/error|fail|exception|traceback/i.test(rest)) errorCount++;
      continue;
    }

    let text = rest;
    let level: ActivityLevel = 'info';

    let m: RegExpMatchArray | null;
    if ((m = rest.match(/^\[run:(\d+)\]\s*Starting\s*\(([^)]*)\)/i))) {
      totalRuns++;
      text = `Run #${m[1]} started${m[2] ? ` · ${prettySource(m[2])}` : ''}`;
      level = 'run';
    } else if ((m = rest.match(/^\[run:(\d+)\]\s*Completed\s+ok=true/i))) {
      text = `Run #${m[1]} completed successfully`;
      level = 'success';
    } else if ((m = rest.match(/^\[run:(\d+)\]\s*Completed\s+ok=false(?:\s+error=(.*))?/i))) {
      text = `Run #${m[1]} finished with a problem${m[1] && m[2] ? `: ${m[2]}` : ''}`;
      level = 'error';
      errorCount++;
    } else if ((m = rest.match(/^\[run:(\d+)\]\s*Failed:\s*(.*)$/i))) {
      text = `Run #${m[1]} failed: ${m[2]}`;
      level = 'error';
      errorCount++;
    } else if (/^\[run:\d+\]\s*(Queued|Received)/i.test(rest)) {
      text = rest.replace(/^\[run:\d+\]\s*/i, 'A run was ');
      level = 'info';
    } else if (/^\[cron\]\s*Fired/i.test(rest)) {
      text = 'Schedule started a run';
      level = 'run';
    } else if (/^\[cron\]\s*Armed/i.test(rest)) {
      text = 'Schedule is set up';
    } else if (/^\[engine\]/i.test(rest)) {
      text = rest.replace(/^\[engine\]\s*/i, '');
    } else if (/^\[deploy\]/i.test(rest)) {
      text = `Setup · ${rest.replace(/^\[deploy\]\s*/i, '')}`;
    } else if (/^\[restore\]/i.test(rest)) {
      text = rest.replace(/^\[restore\]\s*/i, '');
    } else if (/^\[stderr\]/i.test(rest)) {
      text = rest.replace(/^\[stderr\]\s*/i, '');
      level = 'error';
      output.push(text);
      errorCount++;
    } else if (/^Process exited:/i.test(rest)) {
      text = rest.includes('code=0') ? 'Finished and stopped' : 'Stopped unexpectedly';
      level = rest.includes('code=0') ? 'info' : 'error';
    } else if (/^Auto-restarting/i.test(rest)) {
      text = 'Restarting automatically…';
    } else if (/^Starting deployment:/i.test(rest)) {
      text = 'Started';
    }

    if (level === 'info' && /error|fail|exception/i.test(text)) {
      level = 'error';
      errorCount++;
    }
    entries.push({ time, text, level });
  }

  return {
    entries,
    output: output.slice(-14),
    totalRuns,
    errorCount,
  };
}

function prettySource(source: string): string {
  const s = source.toLowerCase();
  if (s === 'cron') return 'on schedule';
  if (s === 'deploy_start') return 'on start';
  if (s === 'manual') return 'run by you';
  if (s.includes('webhook')) return 'from a webhook';
  if (s.includes('gmail')) return 'from email';
  return source;
}

// ─── Component ─────────────────────────────────────────────────────────────────

export function CloudAutomationsPanel({
  deployments,
  loading = false,
  refreshing = false,
  error = null,
  isRunning = true,
  title = 'Automations',
  subtitle = 'Tasks that run in the cloud around the clock — even when your computer is off.',
  emptyTitle = 'No automations yet',
  emptyHint = 'When you set up an automation, it shows up here so you can see exactly when it runs and how it’s doing.',
  onRefresh,
  onStart,
  onStop,
  onDelete,
  getLogs,
  headerActions,
  banner,
  className,
}: CloudAutomationsPanelProps) {
  const [actionId, setActionId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [logsById, setLogsById] = useState<Record<string, string>>({});
  const [logsLoadingId, setLogsLoadingId] = useState<string | null>(null);
  const [rawOpenId, setRawOpenId] = useState<string | null>(null);

  const stats = useMemo(() => ({
    total: deployments.length,
    active: deployments.filter((d) => String(d.status).toLowerCase() === 'running').length,
    scheduled: deployments.filter((d) => !!getScheduleCron(d)).length,
    attention: deployments.filter((d) => String(d.status).toLowerCase() === 'failed' || !!d.error_message).length,
  }), [deployments]);

  const loadLogs = useCallback(async (id: string) => {
    setLogsLoadingId(id);
    try {
      const text = await getLogs(id, 400);
      setLogsById((prev) => ({ ...prev, [id]: text || '' }));
    } finally {
      setLogsLoadingId(null);
    }
  }, [getLogs]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedId((cur) => {
      const next = cur === id ? null : id;
      if (next && logsById[id] === undefined) void loadLogs(id);
      return next;
    });
  }, [loadLogs, logsById]);

  const runAction = useCallback(async (id: string, fn: () => void | Promise<void>) => {
    setActionId(id);
    try { await fn(); } finally { setActionId(null); }
  }, []);

  if (loading) {
    return (
      <div className={clsx('flex h-full items-center justify-center text-theme-muted', className)}>
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading your automations…
      </div>
    );
  }

  return (
    <div className={clsx('flex h-full min-h-0 flex-col', className)}>
      {/* Header */}
      <div className="flex flex-shrink-0 flex-wrap items-start justify-between gap-3 px-1 pb-5">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-[22px] font-bold tracking-tight text-theme-fg">
            <Sparkles className="h-5 w-5 shrink-0 text-primary" />
            {title}
          </h1>
          <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-theme-muted">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {headerActions}
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-full border border-theme/30 bg-theme-card/60 px-3.5 py-2 text-[12px] font-semibold text-theme-fg transition hover:bg-theme-hover disabled:opacity-60"
          >
            <RefreshCw className={clsx('h-3.5 w-3.5', refreshing && 'animate-spin')} />
            Refresh
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-6 custom-scrollbar">
        {!isRunning && (
          <div className="mb-4 flex items-start gap-2 rounded-2xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-[12px] text-amber-600 dark:text-amber-400">
            <Pause className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Your cloud engine is paused. Turn it back on to start, stop, or change your automations.</span>
          </div>
        )}

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-2xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-[12px] text-red-500">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Overview stats */}
        <div className="mb-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <StatCard icon={Cloud} label="Total" value={stats.total} tone="text-theme-fg" bg="bg-theme-hover/60" />
          <StatCard icon={Activity} label="Running now" value={stats.active} tone="text-emerald-500" bg="bg-emerald-500/10" />
          <StatCard icon={CalendarClock} label="Scheduled" value={stats.scheduled} tone="text-sky-500" bg="bg-sky-500/10" />
          <StatCard icon={AlertTriangle} label="Need attention" value={stats.attention} tone="text-red-500" bg="bg-red-500/10" />
        </div>

        {banner}

        {deployments.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-theme/40 bg-theme-hover/20 px-6 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Zap className="h-6 w-6" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-[16px] font-bold text-theme-fg">{emptyTitle}</h3>
              <p className="mx-auto max-w-sm text-[13px] leading-relaxed text-theme-muted">{emptyHint}</p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {deployments.map((dep) => (
              <AutomationCard
                key={dep.id}
                dep={dep}
                isRunning={isRunning}
                busy={actionId === dep.id}
                expanded={expandedId === dep.id}
                logs={logsById[dep.id]}
                logsLoading={logsLoadingId === dep.id}
                rawOpen={rawOpenId === dep.id}
                onToggleExpand={() => toggleExpand(dep.id)}
                onToggleRaw={() => setRawOpenId((cur) => (cur === dep.id ? null : dep.id))}
                onRefreshLogs={() => loadLogs(dep.id)}
                onStart={() => runAction(dep.id, () => onStart(dep.id))}
                onStop={() => runAction(dep.id, () => onStop(dep.id))}
                onDelete={() => runAction(dep.id, () => onDelete(dep.id, dep.name))}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
  bg,
}: {
  icon: typeof Cloud;
  label: string;
  value: number;
  tone: string;
  bg: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-theme/30 bg-theme-card/50 px-3.5 py-3 dark:border-transparent">
      <span className={clsx('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', bg, tone)}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <div className={clsx('text-[20px] font-bold leading-none', tone)}>{value}</div>
        <div className="mt-1 truncate text-[11px] font-medium text-theme-muted">{label}</div>
      </div>
    </div>
  );
}

// ─── Automation card ────────────────────────────────────────────────────────────

interface AutomationCardProps {
  dep: AutomationDeployment;
  isRunning: boolean;
  busy: boolean;
  expanded: boolean;
  logs?: string;
  logsLoading: boolean;
  rawOpen: boolean;
  onToggleExpand: () => void;
  onToggleRaw: () => void;
  onRefreshLogs: () => void;
  onStart: () => void;
  onStop: () => void;
  onDelete: () => void;
}

function AutomationCard({
  dep,
  isRunning,
  busy,
  expanded,
  logs,
  logsLoading,
  rawOpen,
  onToggleExpand,
  onToggleRaw,
  onRefreshLogs,
  onStart,
  onStop,
  onDelete,
}: AutomationCardProps) {
  const kind = kindMeta(dep.kind);
  const status = friendlyStatus(dep);
  const KindIcon = kind.Icon;

  const cron = getScheduleCron(dep);
  const scheduleText = humanizeCron(cron);
  const nextRun = useMemo(() => {
    if (!cron) return null;
    if (String(dep.status).toLowerCase() !== 'running') return null;
    return nextRunFromCron(cron);
  }, [cron, dep.status]);

  const eventDriven = hasEventTriggers(dep);
  const runCount = dep.run_count ?? 0;
  const lastRun = dep.last_run_at || dep.started_at || null;
  const parsed = useMemo(() => (logs !== undefined ? parseActivity(logs) : null), [logs]);

  const lastResult = (() => {
    const s = String(dep.status).toLowerCase();
    if (s === 'failed' || dep.error_message) return { label: 'Had a problem', tone: 'text-red-500' };
    if (s === 'completed') return { label: 'Success', tone: 'text-emerald-500' };
    if (dep.last_completed_at) return { label: 'Success', tone: 'text-emerald-500' };
    if (lastRun) return { label: 'Running', tone: 'text-sky-500' };
    return { label: 'Not run yet', tone: 'text-theme-muted' };
  })();

  const canStart = ['stopped', 'failed', 'completed'].includes(String(dep.status).toLowerCase());
  const canStop = String(dep.status).toLowerCase() === 'running';

  return (
    <div className="overflow-hidden rounded-2xl border border-theme/30 bg-theme-card/50 transition dark:border-transparent">
      {/* Top row */}
      <div className="flex flex-wrap items-start gap-3 p-4">
        <span className={clsx('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', kind.tone)}>
          <KindIcon className="h-5 w-5" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-[15px] font-bold text-theme-fg">{dep.name}</h3>
            <span className={clsx('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold', status.chip)}>
              <span className={clsx('h-1.5 w-1.5 rounded-full', status.dot)} />
              {status.label}
            </span>
            <span className="rounded-full bg-theme-hover px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-theme-muted">
              {kind.label}
            </span>
          </div>
          <p className="mt-1 text-[12.5px] text-theme-muted">{status.blurb}</p>
          {dep.description && (
            <p className="mt-1 line-clamp-1 text-[12px] text-theme-muted/80">{dep.description}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1.5">
          {canStop && (
            <ActionButton onClick={onStop} disabled={busy || !isRunning} busy={busy} icon={Pause} label="Pause" />
          )}
          {canStart && (
            <ActionButton onClick={onStart} disabled={busy || !isRunning} busy={busy} icon={Play} label="Turn on" primary />
          )}
          <button
            type="button"
            onClick={onToggleExpand}
            className={clsx(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition',
              expanded ? 'bg-primary/10 text-primary' : 'bg-theme-hover text-theme-muted hover:text-theme-fg',
            )}
          >
            <Activity className="h-3.5 w-3.5" />
            Activity
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={busy || !isRunning}
            title="Delete automation"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-theme-muted transition hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Quick facts */}
      <div className="grid grid-cols-2 gap-2 px-4 pb-4 sm:grid-cols-4">
        <Fact icon={Repeat} label="Times run" value={runCount === 0 ? 'Never' : String(runCount)} />
        <Fact icon={Clock} label="Last run" value={formatRelative(lastRun)} title={formatClock(lastRun)} />
        <Fact
          icon={CheckCircle2}
          label="Last result"
          value={lastResult.label}
          valueClass={lastResult.tone}
        />
        <Fact
          icon={CalendarClock}
          label={nextRun ? 'Next run' : 'Schedule'}
          value={
            nextRun
              ? formatRelative(nextRun.toISOString())
              : scheduleText || (eventDriven ? 'When triggered' : 'Manual')
          }
          title={nextRun ? formatClock(nextRun.toISOString()) : scheduleText || undefined}
        />
      </div>

      {/* Schedule line */}
      {(scheduleText || eventDriven) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-theme/20 px-4 py-2.5 text-[11.5px] text-theme-muted">
          {scheduleText && (
            <span className="inline-flex items-center gap-1.5">
              <CalendarClock className="h-3.5 w-3.5 text-sky-500" />
              {scheduleText}
              {dep.timezone ? ` · ${dep.timezone}` : ''}
            </span>
          )}
          {eventDriven && (
            <span className="inline-flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-amber-500" />
              Also runs on events
            </span>
          )}
        </div>
      )}

      {/* Inline error callout */}
      {dep.error_message && (
        <div className="mx-4 mb-4 flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2.5 text-[12px] text-red-500">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="min-w-0">
            <div className="font-semibold">What went wrong</div>
            <div className="mt-0.5 break-words text-red-500/90">{dep.error_message}</div>
          </div>
        </div>
      )}

      {/* Expanded activity */}
      {expanded && (
        <div className="border-t border-theme/20 bg-theme-hover/15 px-4 py-4">
          {logsLoading && logs === undefined ? (
            <div className="flex items-center gap-2 py-4 text-[12px] text-theme-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading activity…
            </div>
          ) : (
            <ActivityView
              parsed={parsed}
              rawLogs={logs || ''}
              rawOpen={rawOpen}
              logsLoading={logsLoading}
              onToggleRaw={onToggleRaw}
              onRefreshLogs={onRefreshLogs}
              name={dep.name}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ActionButton({
  onClick,
  disabled,
  busy,
  icon: Icon,
  label,
  primary,
}: {
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  icon: typeof Play;
  label: string;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition disabled:opacity-50',
        primary
          ? 'bg-primary text-primary-fg hover:opacity-90'
          : 'bg-theme-hover text-theme-fg hover:bg-theme-hover/70',
      )}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
      {label}
    </button>
  );
}

function Fact({
  icon: Icon,
  label,
  value,
  valueClass,
  title,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
  valueClass?: string;
  title?: string;
}) {
  return (
    <div className="rounded-xl bg-theme-hover/50 px-3 py-2.5" title={title}>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-theme-muted">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className={clsx('mt-1 truncate text-[13px] font-bold text-theme-fg', valueClass)}>{value}</div>
    </div>
  );
}

// ─── Activity view (readable timeline + output + raw) ─────────────────────────

function ActivityView({
  parsed,
  rawLogs,
  rawOpen,
  logsLoading,
  onToggleRaw,
  onRefreshLogs,
  name,
}: {
  parsed: ParsedActivity | null;
  rawLogs: string;
  rawOpen: boolean;
  logsLoading: boolean;
  onToggleRaw: () => void;
  onRefreshLogs: () => void;
  name: string;
}) {
  const entries = parsed?.entries || [];
  const output = parsed?.output || [];
  const recent = entries.slice(-40).reverse();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-[12px] font-bold uppercase tracking-wider text-theme-muted">Recent activity</h4>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onRefreshLogs}
            className="inline-flex items-center gap-1.5 rounded-full bg-theme-hover px-2.5 py-1 text-[11px] font-semibold text-theme-muted transition hover:text-theme-fg"
          >
            <RefreshCw className={clsx('h-3 w-3', logsLoading && 'animate-spin')} /> Refresh
          </button>
          <button
            type="button"
            onClick={onToggleRaw}
            className={clsx(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition',
              rawOpen ? 'bg-primary/10 text-primary' : 'bg-theme-hover text-theme-muted hover:text-theme-fg',
            )}
          >
            <Terminal className="h-3 w-3" /> {rawOpen ? 'Hide raw log' : 'Raw log'}
          </button>
        </div>
      </div>

      {/* Latest output */}
      {output.length > 0 && (
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-theme-muted">
            <FileText className="h-3 w-3" /> Latest output
          </div>
          <div className="rounded-xl border border-theme/20 bg-theme-bg/50 p-3">
            <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11.5px] leading-relaxed text-theme-fg/85 custom-scrollbar">
              {output.join('\n')}
            </pre>
          </div>
        </div>
      )}

      {/* Readable timeline */}
      {recent.length > 0 ? (
        <ol className="space-y-1.5">
          {recent.map((entry, i) => (
            <li key={i} className="flex items-start gap-2.5 text-[12.5px]">
              <span className="mt-1.5 inline-flex h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: levelColor(entry.level) }}
              />
              <span className="w-[68px] shrink-0 pt-0.5 text-[11px] tabular-nums text-theme-muted/70">
                {entry.time || '—'}
              </span>
              <span className={clsx('min-w-0 break-words', levelTextClass(entry.level))}>{entry.text}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="py-2 text-[12.5px] text-theme-muted">No activity recorded yet. Once this runs, you’ll see a clear timeline here.</p>
      )}

      {/* Raw log */}
      {rawOpen && (
        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-theme-muted">Raw log — {name}</div>
          <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words rounded-xl bg-theme-bg/60 p-3 font-mono text-[11px] leading-relaxed text-theme-fg/70 custom-scrollbar">
            {logsLoading ? 'Loading…' : rawLogs || '(no logs yet)'}
          </pre>
        </div>
      )}
    </div>
  );
}

function levelColor(level: ActivityLevel): string {
  switch (level) {
    case 'success': return '#10b981';
    case 'error': return '#ef4444';
    case 'run': return '#0ea5e9';
    default: return '#a1a1aa';
  }
}

function levelTextClass(level: ActivityLevel): string {
  switch (level) {
    case 'error': return 'text-red-500';
    case 'success': return 'text-emerald-500';
    case 'run': return 'font-semibold text-theme-fg';
    default: return 'text-theme-fg/85';
  }
}

export default CloudAutomationsPanel;
