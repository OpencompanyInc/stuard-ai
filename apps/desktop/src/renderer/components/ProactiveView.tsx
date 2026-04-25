import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import {
  Play, Pause, Plus, Trash2, Check, Clock, Camera, Mic, Volume2,
  ChevronDown, ChevronRight, ChevronLeft, ChevronsUpDown, Loader2, Cloud, Monitor,
  Bell, MessageSquare, Phone, Sparkles, CheckCircle2, XCircle,
  ListTodo, Settings2, Activity, Terminal, Maximize2, X,
} from 'lucide-react';
import { ReasoningBlock } from './ReasoningBlock';
import { GenUIContainer, GenUIErrorBoundary } from './genui';

const GENUI_TOOL_NAMES = new Set([
  'ask_confirmation', 'confirm_action',
  'show_choices', 'choice_group',
  'pick_date', 'date_picker',
  'request_files', 'file_dropzone',
  'show_table', 'data_table',
  'show_info', 'key_value_grid',
  'show_details', 'accordion',
  'show_files', 'file_tree',
  'show_command', 'terminal_block',
  'show_json', 'json_viewer',
  'show_link', 'link_preview',
  'show_colors', 'color_palette',
  'show_progress', 'progress_bar',
  'show_slider', 'slider',
  'show_chart', 'chart',
  'show_info_card', 'info_card',
  'show_weather', 'weather_card',
  'show_email', 'draft_email', 'email',
  'agent_todo', 'agent_todo_list', 'show_todo', 'todo_list',
  'show_feedback_form', 'feedback_form',
  'show_form', 'form_wizard',
  'connect_integration', 'integration_connect', 'show_integrations',
  'chat_ui',
]);
import type {
  ProactiveConfig,
  ProactiveTask,
  ProactiveTaskStatus,
  ProactiveWakeUpLog,
  ProactiveWakeUpToolCall,
  ProactiveWakeUpActivityEvent,
  ScheduleInterval,
  ExecutionTarget,
  NotificationChannel,
  ProactiveModelMode,
} from '../types/proactive';
import {
  SCHEDULE_LABELS,
  DEFAULT_PROACTIVE_CONFIG,
  EXECUTION_TARGET_LABELS,
  NOTIFICATION_CHANNEL_LABELS,
  PROACTIVE_MODEL_MODE_LABELS,
} from '../types/proactive';
import { useModelRegistry } from '../hooks/useModelRegistry';
import { ContextUsageIndicator } from './ContextUsageIndicator';
import { buildContextUsageMetrics } from '../utils/contextUsage';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 60_000) return 'Just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86400_000)}d ago`;
}

function timeUntil(dateStr: string | null | undefined): string {
  if (!dateStr) return 'Not scheduled';
  const diff = new Date(dateStr).getTime() - Date.now();
  if (diff <= 0) return 'Any moment...';
  if (diff < 60_000) return `${Math.ceil(diff / 1000)}s`;
  if (diff < 3600_000) return `${Math.ceil(diff / 60_000)}m`;
  return `${Math.round(diff / 3600_000 * 10) / 10}h`;
}

function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '--';
  return new Date(dateStr).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatClockTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '--';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }).toLowerCase();
}

function formatShortScheduleLabel(interval: ScheduleInterval): string {
  switch (interval) {
    case '10m': return '10 mins';
    case '15m': return '15 mins';
    case '30m': return '30 mins';
    case '1h': return '1 hour';
    case '2h': return '2 hours';
    case 'random': return 'Random';
    case 'manual': return 'Manual';
    default: return SCHEDULE_LABELS[interval];
  }
}

function padCount(value: number): string {
  return String(Math.max(0, value)).padStart(2, '0');
}

function formatDuration(startedAt: string, completedAt?: string | null): string | null {
  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt || Date.now()).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  const totalSeconds = Math.max(0, Math.round((end - start) / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

function formatElapsedFrom(startedAt: string, at: string): string {
  const start = new Date(startedAt).getTime();
  const current = new Date(at).getTime();
  if (Number.isNaN(start) || Number.isNaN(current) || current < start) return '0s';
  const totalSeconds = Math.max(0, Math.round((current - start) / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

function buildWakeUpPreview(log: ProactiveWakeUpLog): string {
  if (log.timedOut) return log.failureReason || `Timed out after ${Math.round((log.timeoutMs || 0) / 1000)}s`;
  if (log.status === 'running') {
    const history = Array.isArray(log.stageHistory) ? log.stageHistory : [];
    return history.length > 0 ? history[history.length - 1].label : 'Running...';
  }
  return log.agentMessage?.slice(0, 120) || log.partialResponse?.slice(0, 120) || log.failureReason || 'No message';
}

function humanizeToolName(tool: string): string {
  return String(tool || 'tool').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
}

function formatToolStatus(status?: string): string {
  return String(status || 'running').replace(/_/g, ' ');
}

function previewValue(value: any): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value.length > 180 ? `${value.slice(0, 180)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    const json = JSON.stringify(value);
    return json.length > 180 ? `${json.slice(0, 180)}…` : json;
  } catch { return String(value); }
}

const STATUS_CONFIG: Record<ProactiveTaskStatus, { label: string; color: string; bg: string; border: string }> = {
  queued: { label: 'Queued', color: 'text-violet-400', bg: 'bg-violet-500/10', border: 'border-violet-500/20' },
  in_progress: { label: 'Working', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
  completed: { label: 'Done', color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
  failed: { label: 'Failed', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' },
};

type BadgeTone = 'neutral' | 'primary' | 'warning' | 'success' | 'danger';

function toneForTaskStatus(status: ProactiveTaskStatus): BadgeTone {
  switch (status) {
    case 'completed': return 'success';
    case 'failed': return 'danger';
    case 'in_progress': return 'warning';
    case 'queued':
    default:
      return 'neutral';
  }
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

function OverviewMetricCard({
  label,
  value,
  className,
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx('dashboard-card p-4', className)}>
      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-theme-muted/70">{label}</div>
      <div className="mt-2 text-[24px] font-semibold tracking-tight text-theme-fg leading-none">{value}</div>
    </div>
  );
}

function ConfigMetricCard({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="dashboard-card-muted p-3.5">
      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-theme-muted/70">{label}</div>
      <div className="mt-1.5 text-[15px] font-semibold tracking-tight text-theme-fg truncate">{value}</div>
    </div>
  );
}

// ─── Toggle ──────────────────────────────────────────────────────────────────

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      onClick={() => !disabled && onChange(!checked)}
      className={clsx(
        'relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 focus:outline-none flex-shrink-0',
        checked ? 'bg-primary' : 'bg-theme-hover/60',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
    >
      <span className={clsx(
        'inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform duration-200 shadow-sm',
        checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
      )} />
    </button>
  );
}

// ─── Tool Selector ───────────────────────────────────────────────────────────

function ToolSelector({ selected, available, onChange }: { selected: string[]; available: string[]; onChange: (tools: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    if (!search) return available;
    const q = search.toLowerCase();
    return available.filter(t => t.toLowerCase().includes(q));
  }, [available, search]);

  const toggle = (tool: string) => {
    if (selected.includes(tool)) onChange(selected.filter(t => t !== tool));
    else onChange([...selected, tool]);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-theme/10 bg-theme-card/30 hover:bg-theme-hover/30 transition text-sm"
      >
        <span className="text-theme-muted text-xs">
          {selected.length === 0 ? 'All tools (no restrictions)' : `${selected.length} tool${selected.length === 1 ? '' : 's'} restricted`}
        </span>
        <ChevronDown className={clsx('w-3.5 h-3.5 text-theme-muted transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-64 overflow-hidden rounded-lg border border-theme/10 bg-theme-card shadow-xl">
          <div className="p-2 border-b border-theme/10">
            <input
              type="text" placeholder="Search tools..." value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full px-3 py-1.5 rounded-md bg-theme-hover/30 text-xs text-theme-fg placeholder:text-theme-muted/50 border-none outline-none"
            />
          </div>
          <div className="overflow-y-auto max-h-48 p-1 custom-scrollbar">
            {filtered.length === 0 && <div className="px-3 py-2 text-xs text-theme-muted">No tools found</div>}
            {filtered.map(tool => (
              <button
                key={tool} onClick={() => toggle(tool)}
                className={clsx('w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-xs transition hover:bg-theme-hover/30', selected.includes(tool) ? 'text-primary font-medium' : 'text-theme-fg')}
              >
                <div className={clsx('w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0', selected.includes(tool) ? 'bg-primary border-primary' : 'border-theme/20')}>
                  {selected.includes(tool) && <Check className="w-2.5 h-2.5 text-white" />}
                </div>
                <span className="truncate font-mono">{tool}</span>
              </button>
            ))}
          </div>
          <div className="p-2 border-t border-theme/10 flex gap-2">
            <button onClick={() => onChange([])} className="flex-1 text-xs text-theme-muted hover:text-theme-fg py-1 rounded-md hover:bg-theme-hover/30 transition">Clear all</button>
            <button onClick={() => setOpen(false)} className="flex-1 text-xs text-primary font-medium py-1 rounded-md hover:bg-primary/10 transition">Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Task Card ───────────────────────────────────────────────────────────────

function TaskCard({ task, onDelete }: { task: ProactiveTask; onDelete: (id: string) => void }) {
  return (
    <div className="dashboard-card-muted group p-4 transition hover:bg-theme-hover/30">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-theme-muted/55">
            {timeAgo(task.createdAt)}
          </div>
          <div className="mt-2 text-[15px] font-medium leading-6 text-theme-fg">
            {task.title}
          </div>
          {task.instructions && (
            <div className="mt-1.5 text-sm leading-6 text-theme-muted line-clamp-2">
              {task.instructions}
            </div>
          )}
          <div className="mt-3">
            <DashboardBadge label={STATUS_CONFIG[task.status].label} tone={toneForTaskStatus(task.status)} />
          </div>
        </div>
        <button
          onClick={() => onDelete(task.id)}
          className="rounded-xl p-2 text-theme-muted/45 opacity-0 transition hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
          title="Remove task"
        >
        <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

// ─── Diagnostics (expandable inside log entries) ─────────────────────────────

function WakeUpDiagnostics({ log, modelById }: { log: ProactiveWakeUpLog; modelById?: Map<string, any> }) {
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const duration = formatDuration(log.startedAt, log.completedAt);
  const stageHistory = Array.isArray(log.stageHistory) ? log.stageHistory : [];
  const toolCalls = Array.isArray(log.toolCalls) ? log.toolCalls : [];
  const activityEvents = Array.isArray(log.activityEvents) ? log.activityEvents : [];
  const reasoningText = String(log.reasoningText || '').trim();
  const hasStreamedPreview = !!log.partialResponse && log.partialResponse !== log.agentMessage;
  const contextMetrics = useMemo(() => buildContextUsageMetrics({ usage: log.usage, modelId: log.modelId, modelById }), [log.modelId, log.usage, modelById]);

  const hasContent = duration || stageHistory.length || log.executionTarget || log.modelId || log.failureReason || toolCalls.length || activityEvents.length || reasoningText || hasStreamedPreview;
  if (!hasContent) return null;

  return (
    <div className="mt-3 space-y-3 text-xs">
      {/* Meta pills */}
      <div className="flex flex-wrap gap-1.5">
        {log.executionTarget && <span className="px-2 py-0.5 rounded bg-white/5 text-[10px] font-medium text-theme-muted">{log.executionTarget}</span>}
        {log.modelMode && <span className="px-2 py-0.5 rounded bg-white/5 text-[10px] font-medium text-theme-muted">{log.modelMode}</span>}
        {log.modelId && <span className="px-2 py-0.5 rounded bg-white/5 text-[10px] font-medium text-theme-muted truncate max-w-[200px]">{log.modelId}</span>}
        {duration && <span className="px-2 py-0.5 rounded bg-white/5 text-[10px] font-medium text-theme-muted">{duration}</span>}
        {log.timedOut && <span className="px-2 py-0.5 rounded bg-red-500/10 text-[10px] font-medium text-red-300">timed out</span>}
        <ContextUsageIndicator metrics={contextMetrics} compact />
      </div>

      {log.failureReason && (
        <div className="rounded-md border border-red-500/15 bg-red-500/5 px-3 py-2 text-red-200">{log.failureReason}</div>
      )}

      {/* Stage timeline */}
      {stageHistory.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-theme-muted/50 mb-1.5">Stages</div>
          <div className="flex flex-wrap gap-1.5">
            {stageHistory.map((stage, idx) => (
              <span key={`${stage.stage}_${idx}`} className="inline-flex items-center gap-1 rounded bg-white/5 px-2 py-0.5 text-[10px] text-theme-muted">
                <span className="font-medium text-theme-fg">{stage.label}</span>
                <span className="text-theme-muted/50">{formatElapsedFrom(log.startedAt, stage.at)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Reasoning */}
      {reasoningText && (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-theme-muted/50 mb-1.5">Reasoning</div>
          <div className="rounded-md bg-white/5 px-3 py-2">
            <ReasoningBlock text={reasoningText} isOpen={reasoningOpen} onToggle={() => setReasoningOpen(prev => !prev)} isComplete={log.status !== 'running'} />
          </div>
        </div>
      )}

      {/* Tool calls */}
      {toolCalls.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-theme-muted/50 mb-1.5">Tools ({toolCalls.length})</div>
          <div className="space-y-1.5">
            {toolCalls.slice(-8).map((toolCall: ProactiveWakeUpToolCall) => {
              const status = String(toolCall.status || '').toLowerCase();
              const isGenUI = GENUI_TOOL_NAMES.has(toolCall.tool);
              const statusColor = status === 'completed' ? 'text-emerald-400' : status === 'error' || status === 'failed' ? 'text-red-400' : 'text-amber-300';

              if (isGenUI && toolCall.args) {
                return (
                  <div key={toolCall.id} className="rounded-md border border-theme/10 bg-white/5 p-1">
                    <div className="flex items-center justify-between px-2 py-1">
                      <span className="text-[10px] font-medium text-theme-muted">{humanizeToolName(toolCall.tool)}</span>
                      <span className={clsx('text-[10px] font-medium', statusColor)}>{formatToolStatus(toolCall.status)}</span>
                    </div>
                    <GenUIErrorBoundary componentName={toolCall.tool}>
                      <GenUIContainer toolName={toolCall.tool} args={toolCall.args} isCompleted={status === 'completed' || status === 'error'} result={toolCall.result} onResult={() => {}} />
                    </GenUIErrorBoundary>
                    {toolCall.error && <div className="px-2 py-1 text-[10px] text-red-300">{toolCall.error}</div>}
                  </div>
                );
              }

              return (
                <div key={toolCall.id} className="flex items-center justify-between rounded-md bg-white/5 px-2.5 py-1.5">
                  <div className="min-w-0 flex-1">
                    <span className="font-medium text-theme-fg">{humanizeToolName(toolCall.tool)}</span>
                    {toolCall.description && <span className="ml-2 text-theme-muted">{toolCall.description}</span>}
                    {!toolCall.description && toolCall.args && <span className="ml-2 text-theme-muted truncate">{previewValue(toolCall.args)}</span>}
                  </div>
                  <span className={clsx('text-[10px] font-medium flex-shrink-0 ml-2', statusColor)}>{formatToolStatus(toolCall.status)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Activity events */}
      {activityEvents.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-theme-muted/50 mb-1.5">Activity ({activityEvents.length})</div>
          <div className="space-y-1">
            {activityEvents.slice(-8).map((a: ProactiveWakeUpActivityEvent) => (
              <div key={a.id} className="flex items-center justify-between rounded-md bg-white/5 px-2.5 py-1.5">
                <span className="font-medium text-theme-fg">{a.label}</span>
                <span className="text-theme-muted/50 ml-2 flex-shrink-0">{formatElapsedFrom(log.startedAt, a.at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Streamed preview */}
      {hasStreamedPreview && (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-theme-muted/50 mb-1.5">Streamed output</div>
          <div className="max-h-32 overflow-y-auto rounded-md bg-white/5 px-3 py-2 text-theme-muted whitespace-pre-wrap scrollbar-minimal">{log.partialResponse}</div>
        </div>
      )}
    </div>
  );
}

// ─── Log Entry ───────────────────────────────────────────────────────────────

function WakeUpLogEntry({ log, modelById }: { log: ProactiveWakeUpLog; modelById?: Map<string, any> }) {
  const [expanded, setExpanded] = useState(false);
  const isCompleted = log.status === 'completed';
  const isFailed = log.status === 'failed';
  const statusColor = isCompleted ? 'text-emerald-400' : isFailed ? 'text-red-400' : 'text-amber-300';
  const statusBg = isCompleted ? 'bg-emerald-500/10' : isFailed ? 'bg-red-500/10' : 'bg-amber-500/10';

  return (
    <div className={clsx('rounded-lg border transition', expanded ? 'border-theme/15 bg-theme-card/30' : 'border-theme/8 bg-theme-card/15 hover:bg-theme-card/25')}>
      <button onClick={() => setExpanded(!expanded)} className="w-full text-left px-3 py-2.5">
        <div className="flex items-center gap-2.5">
          <div className={clsx('flex h-7 w-7 items-center justify-center rounded-md flex-shrink-0', statusBg)}>
            {isCompleted ? <CheckCircle2 className={clsx('w-3.5 h-3.5', statusColor)} /> : isFailed ? <XCircle className={clsx('w-3.5 h-3.5', statusColor)} /> : <Loader2 className={clsx('w-3.5 h-3.5 animate-spin', statusColor)} />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={clsx('text-[10px] font-semibold uppercase', statusColor)}>{log.status}</span>
              {log.parentWakeUpId && <span className="text-[10px] font-medium text-blue-400">follow-up</span>}
              <span className="text-[10px] text-theme-muted/60">{formatDateTime(log.startedAt)}</span>
            </div>
            <div className="mt-0.5 text-xs text-theme-fg truncate">{buildWakeUpPreview(log)}</div>
          </div>
          <ChevronRight className={clsx('h-3.5 w-3.5 flex-shrink-0 text-theme-muted/40 transition-transform', expanded && 'rotate-90')} />
        </div>
      </button>
      {expanded && (
        <div className="px-3 pb-3 border-t border-theme/8">
          {log.agentMessage && (
            <div className="mt-2.5 rounded-md bg-theme-hover/15 p-2.5 text-xs text-theme-muted whitespace-pre-wrap leading-relaxed">{log.agentMessage}</div>
          )}
          <WakeUpDiagnostics log={log} modelById={modelById} />
        </div>
      )}
    </div>
  );
}

// ─── Live Stage Progress ─────────────────────────────────────────────────────

interface StageState {
  logId: string;
  stage: string;
  label: string;
  progress: number;
  detail?: string;
  failed?: boolean;
}

const PIPELINE_STAGES = ['start', 'context', 'tasks', 'agent', 'process', 'done'] as const;
const PIPELINE_LABELS: Record<string, string> = { start: 'Init', context: 'Context', tasks: 'Tasks', agent: 'Agent', process: 'Process', done: 'Done' };

function mapStage(raw: string): string {
  switch (raw) {
    case 'initializing': return 'start';
    case 'capturing-screen': case 'capturing-system-audio': case 'capturing-mic-audio': case 'gathering-context': return 'context';
    case 'loading-tasks': return 'tasks';
    case 'connecting': case 'thinking': return 'agent';
    case 'processing': return 'process';
    case 'complete': case 'failed': return 'done';
    default: return 'start';
  }
}

function StageProgress({ stageState }: { stageState: StageState }) {
  const current = mapStage(stageState.stage);
  const currentIdx = PIPELINE_STAGES.indexOf(current as any);
  const isFailed = stageState.stage === 'failed';
  const isDone = stageState.stage === 'complete';

  return (
    <div className="rounded-lg border border-theme/10 bg-theme-card/30 p-3">
      {/* Pipeline dots */}
      <div className="flex items-center gap-1 mb-2.5">
        {PIPELINE_STAGES.map((s, i) => {
          const isPast = i < currentIdx;
          const isCurrent = i === currentIdx;
          return (
            <React.Fragment key={s}>
              <div className="flex flex-col items-center gap-1" style={{ minWidth: 40 }}>
                <div className={clsx(
                  'w-6 h-6 rounded-md flex items-center justify-center text-[10px] transition-all duration-300',
                  isPast && 'bg-emerald-500/15 text-emerald-400',
                  isCurrent && !isFailed && 'bg-primary/15 text-primary ring-1 ring-primary/30',
                  isCurrent && isFailed && 'bg-red-500/15 text-red-400 ring-1 ring-red-500/30',
                  !isPast && !isCurrent && 'bg-theme-hover/15 text-theme-muted/25',
                )}>
                  {isPast ? <Check className="w-3 h-3" /> : isCurrent && !isDone ? <Loader2 className="w-3 h-3 animate-spin" /> : <span className="text-[9px] font-medium">{i + 1}</span>}
                </div>
                <span className={clsx('text-[9px] font-medium', isPast ? 'text-emerald-400/60' : isCurrent ? (isFailed ? 'text-red-400' : 'text-primary') : 'text-theme-muted/25')}>
                  {PIPELINE_LABELS[s]}
                </span>
              </div>
              {i < PIPELINE_STAGES.length - 1 && (
                <div className="flex-1 h-px bg-theme-hover/20 relative" style={{ marginBottom: 16 }}>
                  <div className={clsx('absolute inset-y-0 left-0 transition-all duration-500', isFailed && isCurrent ? 'bg-red-500/50' : 'bg-primary/50')} style={{ width: isPast || (isCurrent && isDone) ? '100%' : isCurrent ? '50%' : '0%' }} />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
      {/* Status line */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <span className={clsx('text-xs font-medium', isFailed ? 'text-red-400' : isDone ? 'text-emerald-400' : 'text-theme-fg')}>{stageState.label}</span>
          {stageState.detail && <span className="text-xs text-theme-muted ml-2">{stageState.detail}</span>}
        </div>
        <span className={clsx('text-[10px] font-medium tabular-nums', isFailed ? 'text-red-400' : isDone ? 'text-emerald-400' : 'text-primary')}>{stageState.progress}%</span>
      </div>
    </div>
  );
}

// ─── New layout primitives ───────────────────────────────────────────────────

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
          'font-semibold tracking-tight text-theme-fg leading-none',
          size === 'lg' ? 'text-[22px]' : 'text-[15px]',
        )}
      >
        {value}
      </div>
      <div className="mt-2 text-[12px] text-theme-muted">{label}</div>
    </div>
  );
}

function Select<T extends string>({
  value,
  options,
  onChange,
  align = 'right',
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const current = options.find(o => o.value === value);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-theme-fg transition hover:bg-theme-hover/50"
      >
        <span>{current?.label ?? value}</span>
        <ChevronsUpDown className="h-3.5 w-3.5 text-theme-muted" />
      </button>
      {open && (
        <div
          className={clsx(
            'absolute top-full mt-1 z-30 min-w-[170px] overflow-hidden rounded-xl border border-theme bg-theme-card shadow-lg',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {options.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={clsx(
                'block w-full px-3 py-2 text-left text-[13px] transition hover:bg-theme-hover/60',
                opt.value === value ? 'font-medium text-primary' : 'text-theme-fg',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
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
        {description && (
          <div className="mt-0.5 text-[11px] text-theme-muted">{description}</div>
        )}
      </div>
      <div className="flex-none">{control}</div>
    </div>
  );
}

function ActivityCard({
  log,
  onOpen,
}: {
  log: ProactiveWakeUpLog;
  onOpen: () => void;
}) {
  const isCompleted = log.status === 'completed';
  const isFailed = log.status === 'failed';
  const statusLabel = isCompleted ? 'Completed' : isFailed ? 'Failed' : 'Running';
  const statusColor = isCompleted ? 'text-emerald-400' : isFailed ? 'text-red-400' : 'text-amber-300';

  const title = log.agentMessage?.split(/\n+/)[0]?.slice(0, 140)
    || log.partialResponse?.slice(0, 140)
    || log.failureReason
    || buildWakeUpPreview(log);

  const formattedDate = (() => {
    const d = new Date(log.startedAt);
    if (Number.isNaN(d.getTime())) return '';
    const day = d.getDate();
    const month = d.toLocaleString(undefined, { month: 'short' });
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${day} ${month}, ${time}`;
  })();

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative w-full rounded-2xl border border-theme/40 dark:border-transparent bg-theme-card px-4 py-4 text-left shadow-sm transition hover:bg-theme-hover/30"
    >
      <div className="flex items-start justify-between gap-3">
        <div className={clsx('text-[12px] font-medium', statusColor)}>{statusLabel}</div>
        <Maximize2 className="h-3.5 w-3.5 flex-none text-theme-muted/60 transition group-hover:text-theme-fg" />
      </div>
      <div className="mt-2 text-[14px] leading-6 text-theme-fg line-clamp-2">{title}</div>
      <div className="mt-2 text-[11px] text-theme-muted">{formattedDate}</div>
    </button>
  );
}

function TaskDetailModal({
  log,
  onClose,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
}: {
  log: ProactiveWakeUpLog;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && hasPrev) onPrev?.();
      if (e.key === 'ArrowRight' && hasNext) onNext?.();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, onPrev, onNext, hasPrev, hasNext]);

  const isCompleted = log.status === 'completed';
  const isFailed = log.status === 'failed';
  const statusLabel = isCompleted ? 'Completed' : isFailed ? 'Failed' : 'Running';
  const statusColor = isCompleted ? 'text-emerald-400' : isFailed ? 'text-red-400' : 'text-amber-300';

  const d = new Date(log.startedAt);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const dateLabel = d.toLocaleDateString(undefined, { day: 'numeric', month: 'long' });

  const duration = formatDuration(log.startedAt, log.completedAt);
  const title = log.agentMessage?.split(/\n+/)[0]?.slice(0, 200) || buildWakeUpPreview(log);
  const body = log.agentMessage && log.agentMessage.split(/\n+/).slice(1).join('\n').trim();
  const stageHistory = Array.isArray(log.stageHistory) ? log.stageHistory : [];

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md animate-in fade-in duration-150"
      onClick={onClose}
      style={{ WebkitBackdropFilter: 'blur(12px)', backdropFilter: 'blur(12px)' }}
    >
      <div
        className="relative w-full max-w-[520px] rounded-3xl border border-theme/50 dark:border-transparent bg-theme-card p-6 shadow-2xl animate-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <span className={clsx('text-[12px] font-semibold', statusColor)}>{statusLabel}</span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onPrev}
              disabled={!hasPrev}
              className="rounded-lg p-1 text-theme-muted transition hover:bg-theme-hover/50 hover:text-theme-fg disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="text-center leading-tight">
              <div className="text-[14px] font-medium text-theme-fg tabular-nums">{time}</div>
              <div className="text-[11px] text-theme-muted">{dateLabel}</div>
            </div>
            <button
              type="button"
              onClick={onNext}
              disabled={!hasNext}
              className="rounded-lg p-1 text-theme-muted transition hover:bg-theme-hover/50 hover:text-theme-fg disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-theme-muted transition hover:bg-theme-hover/50 hover:text-theme-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 text-[14px] font-medium leading-6 text-theme-fg">{title}</div>
        {body && (
          <p className="mt-3 whitespace-pre-wrap text-[14px] leading-7 text-theme-fg/85">{body}</p>
        )}
        {log.failureReason && (
          <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-[12px] text-red-300">
            {log.failureReason}
          </div>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          {log.executionTarget && <Pill>{EXECUTION_TARGET_LABELS[log.executionTarget]?.label || log.executionTarget}</Pill>}
          {log.modelMode && <Pill>{PROACTIVE_MODEL_MODE_LABELS[log.modelMode as ProactiveModelMode]?.label || log.modelMode}</Pill>}
          {duration && <Pill>Execution Time: {duration}</Pill>}
        </div>

        {stageHistory.length > 0 && (
          <div className="mt-5">
            <div className="text-[13px] font-semibold text-theme-fg">Stages</div>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {stageHistory.map((stage, idx) => (
                <Pill key={`${stage.stage}_${idx}`}>
                  {stage.label} {formatElapsedFrom(log.startedAt, stage.at)}
                </Pill>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-theme-hover/60 px-3 py-1 text-[12px] font-medium text-theme-fg">
      {children}
    </span>
  );
}

// ─── Main View ───────────────────────────────────────────────────────────────

type ProactiveTab = 'overview' | 'activity' | 'settings';

export function ProactiveView() {
  const { modelById } = useModelRegistry();
  const [config, setConfig] = useState<ProactiveConfig>(DEFAULT_PROACTIVE_CONFIG);
  const [tasks, setTasks] = useState<ProactiveTask[]>([]);
  const [logs, setLogs] = useState<ProactiveWakeUpLog[]>([]);
  const [availableTools, setAvailableTools] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddTask, setShowAddTask] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newInstructions, setNewInstructions] = useState('');
  const [activeTab, setActiveTab] = useState<ProactiveTab>('overview');
  const [saving, setSaving] = useState(false);
  const [wakeUpRunning, setWakeUpRunning] = useState(false);
  const [stageState, setStageState] = useState<StageState | null>(null);
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const stageClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const upsertWakeUpLog = useCallback((logId: string, updater: (log: ProactiveWakeUpLog) => ProactiveWakeUpLog) => {
    setLogs(prev => {
      const index = prev.findIndex(log => log.id === logId);
      const base: ProactiveWakeUpLog = index >= 0
        ? prev[index]
        : { id: logId, startedAt: new Date().toISOString(), status: 'running', contextUsed: [], tasksProcessed: [], stageHistory: [], reasoningText: '', toolCalls: [], activityEvents: [] };
      const nextLog = updater(base);
      if (index >= 0) {
        const copy = [...prev];
        copy[index] = nextLog;
        return copy;
      }
      return [nextLog, ...prev];
    });
  }, []);

  const currentStageLog = useMemo(() => {
    if (!stageState) return null;
    return logs.find(log => log.id === stageState.logId) || null;
  }, [logs, stageState]);

  const loadData = useCallback(async () => {
    try {
      const [cfgRes, taskRes, logRes, toolRes] = await Promise.all([
        window.desktopAPI.proactiveGetConfig(),
        window.desktopAPI.proactiveListTasks(),
        window.desktopAPI.proactiveGetWakeUpLog(50),
        window.desktopAPI.proactiveGetAvailableTools(),
      ]);
      if (cfgRes.config) setConfig(cfgRes.config);
      if (taskRes.tasks) setTasks(taskRes.tasks);
      if (logRes.logs) setLogs(logRes.logs);
      if (toolRes.tools) setAvailableTools(toolRes.tools);
    } catch (e) { console.error('[ProactiveView] Failed to load:', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Real-time updates
  useEffect(() => {
    const unsub = window.desktopAPI.onProactiveUpdate?.((data: any) => {
      if (data.type === 'wake-up-start') {
        setWakeUpRunning(true);
        if (data.logId) {
          upsertWakeUpLog(data.logId, log => ({
            ...log, startedAt: data.startedAt || log.startedAt, status: 'running',
            executionTarget: data.executionTarget || log.executionTarget,
            modelMode: data.modelMode || log.modelMode, modelId: data.modelId || log.modelId,
            timeoutMs: typeof data.timeoutMs === 'number' ? data.timeoutMs : log.timeoutMs,
            parentWakeUpId: data.parentWakeUpId || log.parentWakeUpId,
          }));
        }
      }
      if (data.type === 'stage') {
        setStageState({ logId: data.logId, stage: data.stage, label: data.label, progress: data.progress, detail: data.detail, failed: data.stage === 'failed' });
        if (data.logId) {
          upsertWakeUpLog(data.logId, log => ({
            ...log,
            completedAt: data.stage === 'complete' || data.stage === 'failed' ? (data.at || new Date().toISOString()) : log.completedAt,
            status: data.stage === 'failed' ? 'failed' : data.stage === 'complete' ? 'completed' : 'running',
            stageHistory: [...(Array.isArray(log.stageHistory) ? log.stageHistory : []), { stage: data.stage, label: data.label, progress: data.progress, detail: data.detail, at: data.at || new Date().toISOString() }],
          }));
        }
        if (stageClearTimer.current) clearTimeout(stageClearTimer.current);
        if (data.stage === 'complete' || data.stage === 'failed') {
          stageClearTimer.current = setTimeout(() => setStageState(null), 8000);
        }
      }
      if (data.type === 'agent-progress' && data.logId) {
        upsertWakeUpLog(data.logId, log => ({ ...log, partialResponse: typeof data.partialResponse === 'string' ? data.partialResponse : log.partialResponse }));
      }
      if (data.type === 'agent-reasoning' && data.logId) {
        upsertWakeUpLog(data.logId, log => ({ ...log, reasoningText: `${log.reasoningText || ''}${typeof data.textChunk === 'string' ? data.textChunk : ''}` }));
      }
      if (data.type === 'agent-tool' && data.logId && data.toolCall) {
        upsertWakeUpLog(data.logId, log => {
          const existing = Array.isArray(log.toolCalls) ? log.toolCalls : [];
          const idx = existing.findIndex(call => call.id === data.toolCall.id);
          const nextCalls = idx >= 0
            ? existing.map((call, i) => i === idx ? { ...call, ...data.toolCall, startedAt: call.startedAt || data.toolCall.startedAt } : call)
            : [...existing, data.toolCall];
          return { ...log, toolCalls: nextCalls.slice(-50) };
        });
      }
      if (data.type === 'agent-activity' && data.logId && data.activity) {
        upsertWakeUpLog(data.logId, log => ({ ...log, activityEvents: [...(Array.isArray(log.activityEvents) ? log.activityEvents : []), data.activity].slice(-80) }));
      }
      if (data.type === 'wake-up-complete' || data.type === 'wake-up-failed') {
        setWakeUpRunning(false);
        if (data.logId) {
          upsertWakeUpLog(data.logId, log => ({
            ...log, completedAt: log.completedAt || new Date().toISOString(),
            status: data.type === 'wake-up-failed' ? 'failed' : 'completed',
            agentMessage: data.agentMessage || log.agentMessage, failureReason: data.error || log.failureReason,
            timedOut: !!data.timedOut || log.timedOut, usage: data.usage || log.usage, modelId: data.modelId || log.modelId,
          }));
        }
        loadData();
      }
      if (data.type === 'tasks-refreshed' && Array.isArray(data.tasks)) setTasks(data.tasks);
      if (data.type === 'next-wakeup-scheduled') setConfig(prev => ({ ...prev, nextWakeUpAt: data.nextWakeUpAt }));
      if (data.type === 'config-changed' && data.config) setConfig(data.config);
    });
    return () => { unsub?.(); if (stageClearTimer.current) clearTimeout(stageClearTimer.current); };
  }, [loadData, upsertWakeUpLog]);

  const updateConfig = useCallback(async (updates: Partial<ProactiveConfig>) => {
    setSaving(true);
    try { const res = await window.desktopAPI.proactiveUpdateConfig(updates); if (res.config) setConfig(res.config); }
    finally { setSaving(false); }
  }, []);

  const handleToggleEnabled = useCallback(() => {
    updateConfig({ enabled: !config.enabled });
  }, [config.enabled, updateConfig]);

  const handleAddTask = useCallback(async () => {
    if (!newTitle.trim()) return;
    const res = await window.desktopAPI.proactiveAddTask({ title: newTitle.trim(), instructions: newInstructions.trim() });
    if (res.tasks) setTasks(res.tasks);
    setNewTitle(''); setNewInstructions(''); setShowAddTask(false);
  }, [newTitle, newInstructions]);

  const handleDeleteTask = useCallback(async (id: string) => {
    const res = await window.desktopAPI.proactiveDeleteTask(id);
    if (res.tasks) setTasks(res.tasks);
  }, []);

  const handleClearQueued = useCallback(async (items: ProactiveTask[]) => {
    if (items.length === 0) return;
    for (const task of items) {
      await window.desktopAPI.proactiveDeleteTask(task.id);
    }
    await loadData();
  }, [loadData]);

  const handleTriggerNow = useCallback(async () => {
    setWakeUpRunning(true);
    const res = await window.desktopAPI.proactiveTriggerNow();
    if (!res.ok) setWakeUpRunning(false);
  }, []);

  // Derived data
  const tasksByStatus = useMemo(() => {
    const g: Record<ProactiveTaskStatus, ProactiveTask[]> = { queued: [], in_progress: [], completed: [], failed: [] };
    for (const t of tasks) if (g[t.status]) g[t.status].push(t);
    return g;
  }, [tasks]);

  const pendingCount = tasksByStatus.queued.length + tasksByStatus.in_progress.length;
  const notificationChannels = config.notificationChannels || ['app'];
  const modelMode = (config.modelMode || 'balanced') as ProactiveModelMode;
  const executionTargetMeta = EXECUTION_TARGET_LABELS[config.executionTarget];
  const modelModeMeta = PROACTIVE_MODEL_MODE_LABELS[modelMode];
  const activeTasks = useMemo(
    () => [...tasksByStatus.in_progress, ...tasksByStatus.queued],
    [tasksByStatus.in_progress, tasksByStatus.queued],
  );
  const currentTask = activeTasks[0] || null;
  const queuedTasks = useMemo(
    () => (currentTask ? activeTasks.filter(task => task.id !== currentTask.id) : activeTasks),
    [activeTasks, currentTask],
  );
  const schedulerState = wakeUpRunning
    ? { label: 'Checking in', tone: 'warning' as const }
    : config.enabled
      ? { label: 'Running', tone: 'success' as const }
      : { label: 'Paused', tone: 'warning' as const };
  const nextCheckInValue = useMemo(() => {
    if (config.nextWakeUpAt) return formatClockTime(config.nextWakeUpAt);
    if (config.interval === 'manual') return 'Manual';
    return config.enabled ? 'Waiting' : 'Paused';
  }, [config.enabled, config.interval, config.nextWakeUpAt]);
  const currentTaskTone = currentTask
    ? (!config.enabled ? 'warning' : toneForTaskStatus(currentTask.status))
    : 'neutral';
  const currentTaskLabel = currentTask
    ? (!config.enabled ? 'Paused' : currentTask.status === 'in_progress' ? 'Working now' : 'Queued')
    : 'No active task';

  // Build model options from the registry
  const modelOptions: { value: string; label: string }[] = [{ value: '', label: 'Default' }];
  if (modelById) {
    for (const [id, m] of modelById.entries()) {
      const label = (m as any)?.name || (m as any)?.displayName || id;
      modelOptions.push({ value: id, label });
    }
  }
  if (config.modelId && !modelOptions.find(o => o.value === config.modelId)) {
    modelOptions.push({ value: config.modelId, label: config.modelId });
  }

  const completedLogs = logs.filter(l => l.status === 'completed' || l.status === 'failed');
  const selectedLogIndex = selectedLogId ? logs.findIndex(l => l.id === selectedLogId) : -1;
  const selectedLog = selectedLogIndex >= 0 ? logs[selectedLogIndex] : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 gap-3">
        <Loader2 className="w-5 h-5 text-primary animate-spin" />
        <span className="text-sm text-theme-muted">Loading...</span>
      </div>
    );
  }

  const tabs = [
    { id: 'overview' as const, label: 'Tasks', icon: ListTodo, showCount: true },
    { id: 'activity' as const, label: 'Activity', icon: Activity, showCount: false },
    { id: 'settings' as const, label: 'Configuration', icon: Settings2, showCount: false },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col animate-in fade-in duration-300">
      {/* ─── Header ───────────────────────────────────────────────── */}
      <div className="flex-shrink-0 mb-6 flex items-start justify-between gap-4 px-1">
        <div className="min-w-0">
          <h1 className="text-[28px] font-semibold text-theme-fg tracking-tight font-stuard leading-none">
            Proactive
          </h1>
          <p className="mt-2 flex items-center gap-2 text-[13px] text-theme-muted">
            <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary/80" />
            <span>Configure autonomous agent behavior and monitoring parameters.</span>
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
          <button
            onClick={handleTriggerNow}
            disabled={wakeUpRunning}
            className="inline-flex items-center gap-2 rounded-full border border-theme bg-theme-card px-4 py-2 text-[13px] font-medium text-theme-fg shadow-sm transition hover:bg-theme-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {wakeUpRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Terminal className="h-3.5 w-3.5" />}
            {wakeUpRunning ? 'Running' : 'Run Once'}
          </button>
          <button
            onClick={handleToggleEnabled}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-[13px] font-semibold text-primary-fg shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {config.enabled ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {config.enabled ? 'Pause' : 'Resume'}
          </button>
        </div>
      </div>

      {/* ─── Two-column body ─────────────────────────────────────── */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-hidden lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        {/* ── LEFT: Overview / Config / Focus Brief ─────────────── */}
        <aside className="overflow-y-auto px-1 pb-2 scrollbar-minimal">
          <div className="space-y-7">
            {/* Overview */}
            <section>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-[15px] font-semibold text-theme-fg">Overview</h2>
                <DashboardBadge label={schedulerState.label} tone={schedulerState.tone} />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <StatCard
                  value={(nextCheckInValue || '').includes(':') ? nextCheckInValue.replace(':', ' : ') : nextCheckInValue}
                  label="Next Check-in"
                />
                <StatCard value={padCount(pendingCount)} label="Pending Tasks" />
                <StatCard value={padCount(logs.length)} label="Total Check-ins" className="col-span-2 sm:col-span-1" />
              </div>
            </section>

            {/* Config */}
            <section>
              <h2 className="mb-3 text-[15px] font-semibold text-theme-fg">Config</h2>
              <div className="grid grid-cols-3 gap-2.5">
                <StatCard size="md" value={executionTargetMeta.label} label={config.executionTarget === 'local' ? 'Enabled' : 'Active'} />
                <StatCard size="md" value={modelModeMeta.label} label="Intelligence Level" />
                <StatCard size="md" value={formatShortScheduleLabel(config.interval)} label="Check-in Interval" />
              </div>
            </section>

            {/* Focus Brief */}
            <section>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-[15px] font-semibold text-theme-fg">Focus Brief</h2>
                {saving && <span className="text-[11px] font-medium text-primary">Saving…</span>}
              </div>
              <div className="rounded-2xl border border-theme/30 dark:border-transparent bg-zinc-500/10 px-4 py-3.5">
                <textarea
                  value={config.instructions}
                  onChange={e => setConfig(prev => ({ ...prev, instructions: e.target.value }))}
                  onBlur={() => updateConfig({ instructions: config.instructions })}
                  placeholder="Monitor local host ports, alert on prolonged inactivity, extract action items from client calls."
                  rows={5}
                  className="min-h-[128px] w-full resize-none bg-transparent text-[13px] leading-6 text-theme-fg placeholder:text-theme-muted/50 outline-none"
                />
              </div>
            </section>
          </div>
        </aside>

        {/* ── RIGHT: Tabs + tab content ────────────────────────── */}
        <main className="flex min-h-0 flex-col overflow-hidden">
          {/* Tabs */}
          <div className="mb-4 flex flex-shrink-0 items-center gap-2 p-0.5">
            {tabs.map(tab => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={clsx(
                    'inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-[13px] font-medium transition-all',
                    active
                      ? 'border-primary bg-theme-card text-theme-fg shadow-sm ring-2 ring-primary/30'
                      : 'border-theme/40 dark:border-transparent bg-theme-card/40 text-theme-muted hover:bg-theme-card hover:text-theme-fg',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{tab.label}</span>
                  {tab.showCount && pendingCount > 0 && (
                    <span
                      className={clsx(
                        'ml-0.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded-md px-1.5 text-[10px] font-semibold',
                        active ? 'bg-theme-fg text-theme-bg' : 'bg-theme-hover/80 text-theme-muted',
                      )}
                    >
                      {pendingCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-4 scrollbar-minimal">
            {/* Live progress (any tab while running) */}
            {stageState && (
              <div className="mb-5 rounded-2xl border border-theme/40 dark:border-transparent bg-theme-card p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="text-[13px] font-semibold text-theme-fg">Live check-in</div>
                  <DashboardBadge label="In progress" tone="warning" icon={Loader2} />
                </div>
                <StageProgress stageState={stageState} />
                {currentStageLog && <WakeUpDiagnostics log={currentStageLog} modelById={modelById} />}
              </div>
            )}

            {/* ─── Tasks tab ─────────────────────────────────────── */}
            {activeTab === 'overview' && (
              <div className="animate-in fade-in duration-200">
                <div className="rounded-xl border border-theme/30 dark:border-transparent bg-zinc-500/10">
                {/* Current Task */}
                <section className="p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-[15px] font-semibold text-theme-fg">Current Task</h3>
                    <button
                      onClick={() => setShowAddTask(prev => !prev)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-theme bg-theme-card px-3 py-1.5 text-[12px] font-medium text-theme-fg shadow-sm transition hover:bg-theme-hover"
                    >
                      <Plus className="h-3 w-3" />
                      Add Task
                    </button>
                  </div>

                  {showAddTask && (
                    <div className="mb-3 rounded-lg border border-theme/40 dark:border-transparent bg-theme-bg/40 p-4 animate-in slide-in-from-top-1 duration-200">
                      <input
                        type="text"
                        value={newTitle}
                        onChange={e => setNewTitle(e.target.value)}
                        placeholder="Task title"
                        autoFocus
                        onKeyDown={e => e.key === 'Enter' && handleAddTask()}
                        className="w-full rounded-lg border border-theme/30 dark:border-transparent bg-theme-card px-3.5 py-2.5 text-[13px] text-theme-fg placeholder:text-theme-muted/40 focus:border-primary/40 focus:outline-none"
                      />
                      <textarea
                        value={newInstructions}
                        onChange={e => setNewInstructions(e.target.value)}
                        placeholder="Optional instructions…"
                        rows={3}
                        className="mt-2.5 w-full resize-none rounded-lg border border-theme/30 dark:border-transparent bg-theme-card px-3.5 py-2.5 text-[13px] text-theme-fg placeholder:text-theme-muted/40 focus:border-primary/40 focus:outline-none"
                      />
                      <div className="mt-2.5 flex items-center justify-end gap-2">
                        <button
                          onClick={() => { setShowAddTask(false); setNewTitle(''); setNewInstructions(''); }}
                          className="rounded-lg px-3 py-1.5 text-[12px] font-medium text-theme-muted transition hover:text-theme-fg"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleAddTask}
                          disabled={!newTitle.trim()}
                          className="rounded-lg bg-primary px-3 py-1.5 text-[12px] font-semibold text-primary-fg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Save Task
                        </button>
                      </div>
                    </div>
                  )}

                  {currentTask ? (
                    <div className="rounded-lg border border-theme/30 dark:border-transparent bg-theme-card px-3 py-2.5 shadow-sm">
                      <div className="inline-flex items-center rounded-md bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
                        {!config.enabled ? 'Paused' : currentTask.status === 'in_progress' ? 'Working now' : 'Queued'}
                      </div>
                      <div className="mt-1.5 text-[14px] font-medium leading-5 text-theme-fg">
                        {currentTask.title}
                      </div>
                      {currentTask.instructions && (
                        <div className="mt-1 text-[12px] leading-5 text-theme-muted line-clamp-2">
                          {currentTask.instructions}
                        </div>
                      )}
                      <div className="mt-2 flex justify-end">
                        <button
                          onClick={() => handleDeleteTask(currentTask.id)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-theme bg-theme-card px-3 py-1.5 text-[12px] font-medium text-theme-fg shadow-sm transition hover:bg-theme-hover"
                        >
                          End Task
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center rounded-lg border border-dashed border-theme/40 p-6 text-center">
                      <div>
                        <div className="text-[14px] font-medium text-theme-fg">No current task</div>
                        <div className="mt-1.5 max-w-sm text-[12px] leading-5 text-theme-muted">
                          Add a proactive task to give Stuard something concrete to monitor or complete.
                        </div>
                      </div>
                    </div>
                  )}
                </section>

                {/* Queued */}
                <section className="border-t border-theme/30 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-[15px] font-semibold text-theme-fg">Queued</h3>
                    {queuedTasks.length > 0 && (
                      <button
                        onClick={() => handleClearQueued(queuedTasks)}
                        className="rounded-lg border border-theme bg-theme-card px-3 py-1.5 text-[12px] font-medium text-theme-fg shadow-sm transition hover:bg-theme-hover"
                      >
                        Clear all
                      </button>
                    )}
                  </div>

                  {queuedTasks.length > 0 ? (
                    <div className="space-y-2.5">
                      {queuedTasks.map(task => (
                        <div key={task.id} className="group rounded-lg border border-theme/30 dark:border-transparent bg-theme-card px-3 py-2.5 shadow-sm transition hover:bg-theme-hover/30">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="text-[10px] text-theme-muted">Added {timeAgo(task.createdAt)}</div>
                              <div className="mt-0.5 text-[13px] font-medium leading-5 text-theme-fg">
                                {task.title}
                              </div>
                              {task.instructions && (
                                <div className="mt-0.5 line-clamp-2 text-[12px] leading-5 text-theme-muted">
                                  {task.instructions}
                                </div>
                              )}
                            </div>
                            <button
                              onClick={() => handleDeleteTask(task.id)}
                              className="rounded-md p-1.5 text-theme-muted/50 opacity-0 transition hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
                              title="Remove task"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center rounded-lg border border-dashed border-theme/40 p-5 text-center">
                      <div className="max-w-sm text-[12px] leading-5 text-theme-muted">
                        Nothing queued — additional tasks will show up here in the order Stuard will handle them.
                      </div>
                    </div>
                  )}
                </section>
                </div>
              </div>
            )}

            {/* ─── Activity tab ─────────────────────────────────── */}
            {activeTab === 'activity' && (
              <div className="animate-in fade-in duration-200">
                <div className="rounded-xl border border-theme/30 dark:border-transparent bg-zinc-500/10 p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="text-[15px] font-semibold text-theme-fg">
                      <span className="text-theme-fg">{completedLogs.length}</span>{' '}
                      <span className="font-normal text-theme-muted">Completed Tasks</span>
                    </div>
                    {logs.length > 0 && (
                      <button
                        className="rounded-lg border border-theme bg-theme-card px-3 py-1.5 text-[12px] font-medium text-theme-fg shadow-sm transition hover:bg-theme-hover"
                        onClick={() => setSelectedLogId(null)}
                      >
                        Clear All
                      </button>
                    )}
                  </div>

                  {logs.length === 0 ? (
                    <div className="flex items-center justify-center rounded-lg border border-dashed border-theme/40 p-8 text-center text-[12px] text-theme-muted">
                      No proactive history yet. Run a check-in to see results here.
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {logs.map(log => (
                        <ActivityCard key={log.id} log={log} onOpen={() => setSelectedLogId(log.id)} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ─── Configuration tab ────────────────────────────── */}
            {activeTab === 'settings' && (
              <div className="animate-in fade-in duration-200">
                <div className="rounded-xl border border-theme/30 dark:border-transparent bg-zinc-500/10 p-4 space-y-6">
                {/* Behaviour */}
                <section>
                  <h3 className="mb-3 text-[15px] font-semibold text-theme-fg">Behaviour</h3>
                  <div className="space-y-2.5">
                    <ConfigRow
                      label="Check-in Frequency"
                      control={
                        <Select<ScheduleInterval>
                          value={config.interval}
                          options={(Object.entries(SCHEDULE_LABELS) as [ScheduleInterval, string][])
                            .map(([value, label]) => ({ value, label }))}
                          onChange={value => updateConfig({ interval: value })}
                        />
                      }
                    />
                    <ConfigRow
                      label="Permission Level"
                      control={
                        <Select<'unrestricted' | 'restricted'>
                          value={config.allowedTools.length === 0 ? 'unrestricted' : 'restricted'}
                          options={[
                            { value: 'unrestricted', label: 'Unrestricted' },
                            { value: 'restricted', label: 'Restricted' },
                          ]}
                          onChange={value => {
                            if (value === 'unrestricted') updateConfig({ allowedTools: [] });
                          }}
                        />
                      }
                    />
                    {config.allowedTools.length > 0 && (
                      <div className="rounded-2xl border border-theme/40 dark:border-transparent bg-theme-card p-4 shadow-sm">
                        <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-theme-muted/70">
                          Allowed tools
                        </div>
                        <ToolSelector
                          selected={config.allowedTools}
                          available={availableTools}
                          onChange={tools => updateConfig({ allowedTools: tools })}
                        />
                      </div>
                    )}
                    <ConfigRow
                      label="Local Agent"
                      description="Stuard runs directly on your machine when enabled"
                      control={
                        <Toggle
                          checked={config.executionTarget === 'local'}
                          onChange={v => updateConfig({ executionTarget: v ? 'local' : 'cloud' })}
                        />
                      }
                    />
                  </div>
                </section>

                {/* Model */}
                <section>
                  <h3 className="mb-3 text-[15px] font-semibold text-theme-fg">Model</h3>
                  <div className="space-y-2.5">
                    <ConfigRow
                      label="Level of Intelligence"
                      control={
                        <Select<ProactiveModelMode>
                          value={modelMode}
                          options={(Object.entries(PROACTIVE_MODEL_MODE_LABELS) as [ProactiveModelMode, { label: string; description: string }][])
                            .map(([value, meta]) => ({ value, label: meta.label }))}
                          onChange={value => updateConfig({ modelMode: value })}
                        />
                      }
                    />
                    <ConfigRow
                      label="Custom model"
                      control={
                        <Select<string>
                          value={config.modelId || ''}
                          options={modelOptions}
                          onChange={value => updateConfig({ modelId: value })}
                        />
                      }
                    />
                  </div>
                </section>

                {/* Context permissions */}
                <section>
                  <h3 className="mb-3 text-[15px] font-semibold text-theme-fg">Context</h3>
                  <div className="space-y-2.5">
                    {[
                      { key: 'screenshot' as const, label: 'Screen capture', desc: 'Inspect the active window during check-ins' },
                      { key: 'systemAudio' as const, label: 'System audio', desc: 'Use playback audio as context' },
                      { key: 'micAudio' as const, label: 'Microphone', desc: 'Use voice input as context' },
                    ].map(perm => (
                      <ConfigRow
                        key={perm.key}
                        label={perm.label}
                        description={perm.desc}
                        control={
                          <Toggle
                            checked={config.contextPermissions[perm.key]}
                            onChange={v => updateConfig({ contextPermissions: { ...config.contextPermissions, [perm.key]: v } })}
                          />
                        }
                      />
                    ))}
                  </div>
                </section>

                {/* Notifications */}
                <section>
                  <h3 className="mb-3 text-[15px] font-semibold text-theme-fg">Notifications</h3>
                  <div className="space-y-2.5">
                    {(Object.entries(NOTIFICATION_CHANNEL_LABELS) as Array<[NotificationChannel, { label: string; description: string }]>).map(([ch, info]) => {
                      const isActive = notificationChannels.includes(ch);
                      return (
                        <ConfigRow
                          key={ch}
                          label={info.label}
                          description={info.description}
                          control={
                            <Toggle
                              checked={isActive}
                              onChange={v => {
                                const current = config.notificationChannels || ['app'];
                                const next = v ? Array.from(new Set([...current, ch])) : current.filter(c => c !== ch);
                                updateConfig({ notificationChannels: next.length > 0 ? next : ['app'] });
                              }}
                            />
                          }
                        />
                      );
                    })}
                  </div>
                </section>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      {selectedLog && (
        <TaskDetailModal
          log={selectedLog}
          onClose={() => setSelectedLogId(null)}
          onPrev={selectedLogIndex > 0 ? () => setSelectedLogId(logs[selectedLogIndex - 1].id) : undefined}
          onNext={selectedLogIndex >= 0 && selectedLogIndex < logs.length - 1 ? () => setSelectedLogId(logs[selectedLogIndex + 1].id) : undefined}
          hasPrev={selectedLogIndex > 0}
          hasNext={selectedLogIndex >= 0 && selectedLogIndex < logs.length - 1}
        />
      )}
    </div>
  );
}
