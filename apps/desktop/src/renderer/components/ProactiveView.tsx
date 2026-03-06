import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { clsx } from 'clsx';
import {
  Play, Plus, Trash2, Check, Clock, Camera, Mic, Volume2,
  Shield, ChevronDown, ChevronRight, Loader2, Sparkles, Cloud, Monitor,
  Bell, MessageSquare, Phone, Zap, Brain, Cpu, CheckCircle2, XCircle,
  Eye, ListTodo,
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

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

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

function formatClockTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '--:--:--';
  return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatCalendarDate(dateStr: string | null | undefined): string {
  if (!dateStr) return 'Unknown date';
  return new Date(dateStr).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
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

function getLastStage(log: ProactiveWakeUpLog) {
  const history = Array.isArray(log.stageHistory) ? log.stageHistory : [];
  return history.length > 0 ? history[history.length - 1] : null;
}

function buildWakeUpPreview(log: ProactiveWakeUpLog): string {
  if (log.timedOut) {
    return log.failureReason || `Timed out after ${Math.round((log.timeoutMs || 0) / 1000)}s`;
  }
  if (log.status === 'running') {
    return getLastStage(log)?.label || 'Running...';
  }
  return log.agentMessage?.slice(0, 80)
    || log.partialResponse?.slice(0, 80)
    || log.failureReason
    || 'No message';
}

function humanizeToolName(tool: string): string {
  return String(tool || 'tool')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
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
  } catch {
    return String(value);
  }
}

const STATUS_CONFIG: Record<ProactiveTaskStatus, { label: string; color: string; bg: string; border: string }> = {
  queued: { label: 'Queued', color: 'text-violet-400', bg: 'bg-violet-500/10', border: 'border-violet-500/20' },
  in_progress: { label: 'Working', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
  completed: { label: 'Done', color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
  failed: { label: 'Failed', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' },
};

// ─────────────────────────────────────────────────────────────────────────────
// Toggle Switch
// ─────────────────────────────────────────────────────────────────────────────

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      onClick={() => !disabled && onChange(!checked)}
      className={clsx(
        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none',
        checked ? 'bg-primary' : 'bg-theme-hover/60',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
    >
      <span className={clsx(
        'inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 shadow-sm',
        checked ? 'translate-x-6' : 'translate-x-1'
      )} />
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool Selector
// ─────────────────────────────────────────────────────────────────────────────

function ToolSelector({ selected, available, onChange }: { selected: string[]; available: string[]; onChange: (tools: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search) return available;
    const q = search.toLowerCase();
    return available.filter(t => t.toLowerCase().includes(q));
  }, [available, search]);

  const toggle = (tool: string) => {
    if (selected.includes(tool)) {
      onChange(selected.filter(t => t !== tool));
    } else {
      onChange([...selected, tool]);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 rounded-xl border border-theme/10 bg-theme-card/30 hover:bg-theme-hover/30 transition text-sm"
      >
        <span className="text-theme-muted">
          {selected.length === 0 ? 'All tools allowed (no restrictions)' : `${selected.length} tool${selected.length === 1 ? '' : 's'} allowed`}
        </span>
        <ChevronDown className={clsx('w-4 h-4 text-theme-muted transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-64 overflow-hidden rounded-xl border border-theme/10 bg-theme-card shadow-xl">
          <div className="p-2 border-b border-theme/10">
            <input
              type="text"
              placeholder="Search tools..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full px-3 py-1.5 rounded-lg bg-theme-hover/30 text-sm text-theme-fg placeholder:text-theme-muted/50 border-none outline-none"
            />
          </div>
          <div className="overflow-y-auto max-h-48 p-1 custom-scrollbar">
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-xs text-theme-muted">No tools found</div>
            )}
            {filtered.map(tool => (
              <button
                key={tool}
                onClick={() => toggle(tool)}
                className={clsx(
                  'w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition hover:bg-theme-hover/30',
                  selected.includes(tool) ? 'text-primary font-medium' : 'text-theme-fg'
                )}
              >
                <div className={clsx(
                  'w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition',
                  selected.includes(tool) ? 'bg-primary border-primary' : 'border-theme/20'
                )}>
                  {selected.includes(tool) && <Check className="w-3 h-3 text-white" />}
                </div>
                <span className="truncate font-mono text-xs">{tool}</span>
              </button>
            ))}
          </div>
          <div className="p-2 border-t border-theme/10 flex gap-2">
            <button onClick={() => onChange([])} className="flex-1 text-xs text-theme-muted hover:text-theme-fg py-1 rounded-lg hover:bg-theme-hover/30 transition">
              Clear all
            </button>
            <button onClick={() => setOpen(false)} className="flex-1 text-xs text-primary font-medium py-1 rounded-lg hover:bg-primary/10 transition">
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Task Card
// ─────────────────────────────────────────────────────────────────────────────

function TaskCard({ task, onDelete }: { task: ProactiveTask; onDelete: (id: string) => void }) {
  const sc = STATUS_CONFIG[task.status];
  return (
    <div className={clsx(
      'rounded-xl border p-3 transition-all duration-200 group',
      sc.bg, sc.border
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={clsx('text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md', sc.bg, sc.color)}>
              {sc.label}
            </span>
          </div>
          <div className="text-sm font-semibold text-theme-fg truncate">{task.title}</div>
          {task.instructions && (
            <div className="text-xs text-theme-muted mt-1 line-clamp-2">{task.instructions}</div>
          )}
          {task.result && (
            <div className="text-xs text-emerald-400 mt-1.5 line-clamp-2 bg-emerald-500/5 px-2 py-1 rounded-lg">
              {task.result}
            </div>
          )}
        </div>
        <button
          onClick={() => onDelete(task.id)}
          className="opacity-0 group-hover:opacity-100 text-theme-muted hover:text-red-400 transition p-1"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Kanban Column
// ─────────────────────────────────────────────────────────────────────────────

function KanbanColumn({ status, tasks, onDelete }: { status: ProactiveTaskStatus; tasks: ProactiveTask[]; onDelete: (id: string) => void }) {
  const sc = STATUS_CONFIG[status];
  return (
    <div className="flex-1 min-w-[200px]">
      <div className="flex items-center gap-2 mb-3 px-1">
        <span className={clsx('w-2 h-2 rounded-full', sc.color.replace('text-', 'bg-'))} />
        <span className="text-xs font-bold text-theme-muted uppercase tracking-wider">{sc.label}</span>
        <span className="text-[10px] text-theme-muted/60 ml-auto">{tasks.length}</span>
      </div>
      <div className="space-y-2 min-h-[60px]">
        {tasks.map(task => (
          <TaskCard key={task.id} task={task} onDelete={onDelete} />
        ))}
        {tasks.length === 0 && (
          <div className="rounded-xl border border-dashed border-theme/10 p-4 text-center">
            <span className="text-xs text-theme-muted/40">No tasks</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Wake-Up Log
// ─────────────────────────────────────────────────────────────────────────────

function WakeUpDiagnostics({ log, compact = false }: { log: ProactiveWakeUpLog; compact?: boolean }) {
  const [reasoningOpen, setReasoningOpen] = useState(!compact);
  const duration = formatDuration(log.startedAt, log.completedAt);
  const stageHistory = Array.isArray(log.stageHistory) ? log.stageHistory : [];
  const toolCalls = Array.isArray(log.toolCalls) ? log.toolCalls : [];
  const activityEvents = Array.isArray(log.activityEvents) ? log.activityEvents : [];
  const reasoningText = String(log.reasoningText || '').trim();
  const hasStreamedPreview = !!log.partialResponse && log.partialResponse !== log.agentMessage;
  const toneClass = log.timedOut || log.status === 'failed' ? 'text-red-300 border-red-500/20 bg-red-500/5' : 'text-theme-muted border-theme/5 bg-black/10';
  const visibleToolCalls = compact ? toolCalls.slice(-4) : toolCalls;
  const visibleActivityEvents = compact ? activityEvents.slice(-6) : activityEvents;

  if (!duration && !stageHistory.length && !log.executionTarget && !log.modelMode && !log.modelId && !log.timeoutMs && !log.failureReason && !hasStreamedPreview && !log.timedOut && !reasoningText && !toolCalls.length && !activityEvents.length) {
    return null;
  }

  return (
    <div className={clsx('rounded-2xl border mt-3', toneClass, compact ? 'p-3' : 'p-4')}>
      <div className="text-[10px] font-black uppercase tracking-[0.18em] text-theme-muted/70">Execution Trace</div>

      <div className="mt-3 flex flex-wrap gap-2">
        {log.executionTarget && <span className="px-2 py-1 rounded-lg bg-white/5 text-[10px] font-bold uppercase tracking-wide">{log.executionTarget}</span>}
        {log.modelMode && <span className="px-2 py-1 rounded-lg bg-white/5 text-[10px] font-bold uppercase tracking-wide">{log.modelMode}</span>}
        {log.modelId && <span className="px-2 py-1 rounded-lg bg-white/5 text-[10px] font-bold tracking-wide">{log.modelId}</span>}
        {duration && <span className="px-2 py-1 rounded-lg bg-white/5 text-[10px] font-bold uppercase tracking-wide">{duration}</span>}
        {log.timeoutMs && <span className="px-2 py-1 rounded-lg bg-white/5 text-[10px] font-bold uppercase tracking-wide">timeout {Math.round(log.timeoutMs / 1000)}s</span>}
        {log.timedOut && <span className="px-2 py-1 rounded-lg bg-red-500/10 text-[10px] font-bold uppercase tracking-wide text-red-300">timed out</span>}
      </div>

      {log.failureReason && (
        <div className="mt-3 rounded-xl border border-red-500/15 bg-red-500/5 px-3 py-2 text-xs text-red-200">
          {log.failureReason}
        </div>
      )}

      {stageHistory.length > 0 && (
        <div className="mt-3 space-y-2">
          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-theme-muted/60">Stage Timeline</div>
          <div className="space-y-2">
            {stageHistory.map((stage, idx) => (
              <div key={`${stage.stage}_${stage.at}_${idx}`} className="rounded-xl bg-white/5 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold text-theme-fg">{stage.label}</span>
                  <span className="text-[10px] font-bold uppercase tracking-wide text-theme-muted/70">{formatElapsedFrom(log.startedAt, stage.at)}</span>
                </div>
                {stage.detail && <div className="mt-1 text-[11px] text-theme-muted">{stage.detail}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {reasoningText && (
        <div className="mt-3">
          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-theme-muted/60">Reasoning Stream</div>
          <div className="mt-2 rounded-xl bg-white/5 px-3 py-2">
            <ReasoningBlock
              text={reasoningText}
              isOpen={reasoningOpen}
              onToggle={() => setReasoningOpen(prev => !prev)}
              isComplete={log.status !== 'running'}
            />
          </div>
        </div>
      )}

      {toolCalls.length > 0 && (
        <div className="mt-3 space-y-2">
          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-theme-muted/60">Tool Calls</div>
          <div className="space-y-2">
            {visibleToolCalls.map((toolCall: ProactiveWakeUpToolCall) => {
              const status = String(toolCall.status || '').toLowerCase();
              const isGenUI = GENUI_TOOL_NAMES.has(toolCall.tool);
              const statusTone = status === 'completed'
                ? 'text-emerald-300 border-emerald-500/20 bg-emerald-500/5'
                : status === 'error' || status === 'failed'
                  ? 'text-red-300 border-red-500/20 bg-red-500/5'
                  : 'text-amber-200 border-amber-500/20 bg-amber-500/5';
              const argsPreview = previewValue(toolCall.args);
              const resultPreview = previewValue(toolCall.result);

              if (isGenUI && toolCall.args) {
                const isCompleted = status === 'completed' || status === 'error';
                return (
                  <div key={toolCall.id} className={clsx('rounded-xl border p-1', statusTone)}>
                    <div className="flex items-center justify-between gap-3 px-2 py-1">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-theme-muted/70">{humanizeToolName(toolCall.tool)}</span>
                      <span className="text-[10px] font-bold uppercase tracking-wide">{formatToolStatus(toolCall.status)}</span>
                    </div>
                    <GenUIErrorBoundary componentName={toolCall.tool}>
                      <GenUIContainer
                        toolName={toolCall.tool}
                        args={toolCall.args}
                        isCompleted={isCompleted}
                        result={toolCall.result}
                        onResult={() => {}}
                      />
                    </GenUIErrorBoundary>
                    {toolCall.error && <div className="mt-1 px-2 text-[11px] text-red-200">error: {toolCall.error}</div>}
                  </div>
                );
              }

              return (
                <div key={toolCall.id} className={clsx('rounded-xl border px-3 py-2', statusTone)}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-semibold text-theme-fg">{humanizeToolName(toolCall.tool)}</span>
                    <span className="text-[10px] font-bold uppercase tracking-wide">{formatToolStatus(toolCall.status)}</span>
                  </div>
                  {toolCall.description && <div className="mt-1 text-[11px] text-theme-muted">{toolCall.description}</div>}
                  {!toolCall.description && argsPreview && <div className="mt-1 text-[11px] text-theme-muted">args: {argsPreview}</div>}
                  {resultPreview && <div className="mt-1 text-[11px] text-theme-muted">result: {resultPreview}</div>}
                  {toolCall.error && <div className="mt-1 text-[11px] text-red-200">error: {toolCall.error}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activityEvents.length > 0 && (
        <div className="mt-3 space-y-2">
          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-theme-muted/60">Agent Activity</div>
          <div className="space-y-2">
            {visibleActivityEvents.map((activity: ProactiveWakeUpActivityEvent) => (
              <div key={activity.id} className="rounded-xl bg-white/5 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold text-theme-fg">{activity.label}</span>
                  <span className="text-[10px] font-bold uppercase tracking-wide text-theme-muted/70">{formatElapsedFrom(log.startedAt, activity.at)}</span>
                </div>
                {activity.detail && <div className="mt-1 text-[11px] text-theme-muted">{activity.detail}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {hasStreamedPreview && (
        <div className="mt-3">
          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-theme-muted/60">Last Streamed Output</div>
          <div className="mt-2 max-h-40 overflow-y-auto rounded-xl bg-white/5 px-3 py-2 text-xs text-theme-muted whitespace-pre-wrap scrollbar-minimal">
            {log.partialResponse}
          </div>
        </div>
      )}
    </div>
  );
}

function WakeUpLogEntry({ log }: { log: ProactiveWakeUpLog }) {
  const [expanded, setExpanded] = useState(false);
  const statusColor = log.status === 'completed' ? 'text-emerald-400' : log.status === 'failed' ? 'text-red-400' : 'text-amber-400';

  return (
    <div className="border border-theme/5 rounded-xl p-3 hover:bg-theme-hover/10 transition">
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center gap-3 text-left">
        <div className={clsx('w-2 h-2 rounded-full flex-shrink-0', statusColor.replace('text-', 'bg-'))} />
        <div className="flex-1 min-w-0">
          <div className="text-xs text-theme-fg font-medium">
            {buildWakeUpPreview(log)}
          </div>
          <div className="text-[10px] text-theme-muted mt-0.5">
            {timeAgo(log.startedAt)} {log.contextUsed.length > 0 && `· ${log.contextUsed.join(', ')}`}
          </div>
        </div>
        <ChevronRight className={clsx('w-3.5 h-3.5 text-theme-muted transition-transform', expanded && 'rotate-90')} />
      </button>
      {expanded && (
        <div className="mt-2 ml-5">
          {log.agentMessage && (
            <div className="text-xs text-theme-muted bg-theme-hover/20 rounded-lg p-2.5 whitespace-pre-wrap">
              {log.agentMessage}
            </div>
          )}
          <WakeUpDiagnostics log={log} compact />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage Visualizer
// ─────────────────────────────────────────────────────────────────────────────

interface DisplayStage {
  key: string;
  label: string;
  icon: React.ElementType;
}

const DISPLAY_STAGES: DisplayStage[] = [
  { key: 'start', label: 'Starting', icon: Zap },
  { key: 'context', label: 'Context', icon: Eye },
  { key: 'tasks', label: 'Tasks', icon: ListTodo },
  { key: 'agent', label: 'Agent', icon: Brain },
  { key: 'process', label: 'Processing', icon: Cpu },
  { key: 'done', label: 'Done', icon: CheckCircle2 },
];

function mapRawStageToDisplay(raw: string): string {
  switch (raw) {
    case 'initializing': return 'start';
    case 'capturing-screen':
    case 'gathering-context': return 'context';
    case 'loading-tasks': return 'tasks';
    case 'connecting':
    case 'thinking': return 'agent';
    case 'processing': return 'process';
    case 'complete':
    case 'failed': return 'done';
    default: return 'start';
  }
}

interface StageState {
  logId: string;
  stage: string;
  label: string;
  progress: number;
  detail?: string;
  failed?: boolean;
}

function StageVisualizer({ stageState }: { stageState: StageState | null }) {
  if (!stageState) return null;

  const currentDisplay = mapRawStageToDisplay(stageState.stage);
  const isFailed = stageState.stage === 'failed';
  const isDone = stageState.stage === 'complete';
  const currentIdx = DISPLAY_STAGES.findIndex(s => s.key === currentDisplay);

  return (
    <div className="rounded-2xl border border-theme/10 bg-theme-card/30 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-400">
      <div className="p-5">
        {/* Stage pipeline */}
        <div className="flex items-center gap-1 mb-4">
          {DISPLAY_STAGES.map((stage, i) => {
            const Icon = stage.icon;
            const isPast = i < currentIdx;
            const isCurrent = i === currentIdx;
            const isFuture = i > currentIdx;

            return (
              <React.Fragment key={stage.key}>
                {/* Stage node */}
                <div className="flex flex-col items-center gap-1.5 flex-shrink-0" style={{ minWidth: 56 }}>
                  <div className={clsx(
                    'w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-500',
                    isPast && 'bg-emerald-500/15 text-emerald-400',
                    isCurrent && !isFailed && 'bg-primary/15 text-primary ring-2 ring-primary/30',
                    isCurrent && isFailed && 'bg-red-500/15 text-red-400 ring-2 ring-red-500/30',
                    isFuture && 'bg-theme-hover/20 text-theme-muted/30',
                  )}>
                    {isPast ? (
                      <Check className="w-4 h-4" />
                    ) : isCurrent && isFailed ? (
                      <XCircle className="w-4 h-4" />
                    ) : isCurrent && !isDone ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Icon className="w-4 h-4" />
                    )}
                  </div>
                  <span className={clsx(
                    'text-[10px] font-semibold transition-colors duration-300',
                    isPast && 'text-emerald-400/70',
                    isCurrent && !isFailed && 'text-primary',
                    isCurrent && isFailed && 'text-red-400',
                    isFuture && 'text-theme-muted/30',
                  )}>
                    {stage.label}
                  </span>
                </div>

                {/* Connector line */}
                {i < DISPLAY_STAGES.length - 1 && (
                  <div className="flex-1 h-0.5 rounded-full relative overflow-hidden bg-theme-hover/20 mx-0.5" style={{ marginBottom: 20 }}>
                    <div
                      className={clsx(
                        'absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-out',
                        isFailed && isCurrent ? 'bg-red-500/60' : 'bg-primary/60',
                      )}
                      style={{ width: isPast || (isCurrent && isDone) ? '100%' : isCurrent ? '50%' : '0%' }}
                    />
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* Current status line */}
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <div className={clsx(
              'text-sm font-semibold',
              isFailed ? 'text-red-400' : isDone ? 'text-emerald-400' : 'text-theme-fg',
            )}>
              {stageState.label}
            </div>
            {stageState.detail && (
              <div className="text-xs text-theme-muted mt-0.5">{stageState.detail}</div>
            )}
          </div>

          {/* Progress percentage */}
          <div className={clsx(
            'text-xs font-bold tabular-nums',
            isFailed ? 'text-red-400' : isDone ? 'text-emerald-400' : 'text-primary',
          )}>
            {stageState.progress}%
          </div>
        </div>

        {/* Overall progress bar */}
        <div className="mt-3 h-1 rounded-full bg-theme-hover/20 overflow-hidden">
          <div
            className={clsx(
              'h-full rounded-full transition-all duration-700 ease-out',
              isFailed ? 'bg-red-500' : isDone ? 'bg-emerald-500' : 'bg-primary',
            )}
            style={{ width: `${stageState.progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main View
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Main View
// ─────────────────────────────────────────────────────────────────────────────

type ProactiveTab = 'dashboard' | 'activity' | 'settings';

export function ProactiveView() {
  const [config, setConfig] = useState<ProactiveConfig>(DEFAULT_PROACTIVE_CONFIG);
  const [tasks, setTasks] = useState<ProactiveTask[]>([]);
  const [logs, setLogs] = useState<ProactiveWakeUpLog[]>([]);
  const [availableTools, setAvailableTools] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddTask, setShowAddTask] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newInstructions, setNewInstructions] = useState('');
  const [activeTab, setActiveTab] = useState<ProactiveTab>('dashboard');
  const [saving, setSaving] = useState(false);
  const [wakeUpRunning, setWakeUpRunning] = useState(false);
  const [stageState, setStageState] = useState<StageState | null>(null);
  const stageClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const upsertWakeUpLog = useCallback((logId: string, updater: (log: ProactiveWakeUpLog) => ProactiveWakeUpLog) => {
    setLogs(prev => {
      const index = prev.findIndex(log => log.id === logId);
      const base: ProactiveWakeUpLog = index >= 0
        ? prev[index]
        : {
          id: logId,
          startedAt: new Date().toISOString(),
          status: 'running',
          contextUsed: [],
          tasksProcessed: [],
          stageHistory: [],
          reasoningText: '',
          toolCalls: [],
          activityEvents: [],
        };
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

  // Load everything
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
    } catch (e) {
      console.error('[ProactiveView] Failed to load:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Listen for real-time updates
  useEffect(() => {
    const unsub = window.desktopAPI.onProactiveUpdate?.((data: any) => {
      if (data.type === 'wake-up-start') {
        setWakeUpRunning(true);
        if (data.logId) {
          upsertWakeUpLog(data.logId, log => ({
            ...log,
            startedAt: data.startedAt || log.startedAt,
            status: 'running',
            executionTarget: data.executionTarget || log.executionTarget,
            modelMode: data.modelMode || log.modelMode,
            modelId: data.modelId || log.modelId,
            timeoutMs: typeof data.timeoutMs === 'number' ? data.timeoutMs : log.timeoutMs,
          }));
        }
      }
      if (data.type === 'stage') {
        setStageState({
          logId: data.logId,
          stage: data.stage,
          label: data.label,
          progress: data.progress,
          detail: data.detail,
          failed: data.stage === 'failed',
        });

        if (data.logId) {
          upsertWakeUpLog(data.logId, log => ({
            ...log,
            completedAt: data.stage === 'complete' || data.stage === 'failed' ? (data.at || new Date().toISOString()) : log.completedAt,
            status: data.stage === 'failed' ? 'failed' : data.stage === 'complete' ? 'completed' : 'running',
            stageHistory: [
              ...(Array.isArray(log.stageHistory) ? log.stageHistory : []),
              {
                stage: data.stage,
                label: data.label,
                progress: data.progress,
                detail: data.detail,
                at: data.at || new Date().toISOString(),
              },
            ],
          }));
        }

        if (stageClearTimer.current) clearTimeout(stageClearTimer.current);
        if (data.stage === 'complete' || data.stage === 'failed') {
          stageClearTimer.current = setTimeout(() => setStageState(null), 8000);
        }
      }
      if (data.type === 'agent-progress' && data.logId) {
        upsertWakeUpLog(data.logId, log => ({
          ...log,
          partialResponse: typeof data.partialResponse === 'string' ? data.partialResponse : log.partialResponse,
        }));
      }
      if (data.type === 'agent-reasoning' && data.logId) {
        upsertWakeUpLog(data.logId, log => ({
          ...log,
          reasoningText: `${log.reasoningText || ''}${typeof data.textChunk === 'string' ? data.textChunk : ''}`,
        }));
      }
      if (data.type === 'agent-tool' && data.logId && data.toolCall) {
        upsertWakeUpLog(data.logId, log => {
          const existing = Array.isArray(log.toolCalls) ? log.toolCalls : [];
          const idx = existing.findIndex(call => call.id === data.toolCall.id);
          const nextCalls = idx >= 0
            ? existing.map((call, i) => i === idx ? { ...call, ...data.toolCall, startedAt: call.startedAt || data.toolCall.startedAt } : call)
            : [...existing, data.toolCall];
          return {
            ...log,
            toolCalls: nextCalls.slice(-50),
          };
        });
      }
      if (data.type === 'agent-activity' && data.logId && data.activity) {
        upsertWakeUpLog(data.logId, log => ({
          ...log,
          activityEvents: [...(Array.isArray(log.activityEvents) ? log.activityEvents : []), data.activity].slice(-80),
        }));
      }
      if (data.type === 'wake-up-complete' || data.type === 'wake-up-failed') {
        setWakeUpRunning(false);
        if (data.logId) {
          upsertWakeUpLog(data.logId, log => ({
            ...log,
            completedAt: log.completedAt || new Date().toISOString(),
            status: data.type === 'wake-up-failed' ? 'failed' : 'completed',
            agentMessage: data.agentMessage || log.agentMessage,
            failureReason: data.error || log.failureReason,
            timedOut: !!data.timedOut || log.timedOut,
          }));
        }
        loadData();
      }
      if (data.type === 'tasks-refreshed' && Array.isArray(data.tasks)) {
        setTasks(data.tasks);
      }
      if (data.type === 'next-wakeup-scheduled') {
        setConfig(prev => ({ ...prev, nextWakeUpAt: data.nextWakeUpAt }));
      }
      if (data.type === 'config-changed' && data.config) {
        setConfig(data.config);
      }
    });
    return () => {
      unsub?.();
      if (stageClearTimer.current) clearTimeout(stageClearTimer.current);
    };
  }, [loadData, upsertWakeUpLog]);

  // Update config
  const updateConfig = useCallback(async (updates: Partial<ProactiveConfig>) => {
    setSaving(true);
    try {
      const res = await window.desktopAPI.proactiveUpdateConfig(updates);
      if (res.config) setConfig(res.config);
    } finally {
      setSaving(false);
    }
  }, []);

  // Add task
  const handleAddTask = useCallback(async () => {
    if (!newTitle.trim()) return;
    const res = await window.desktopAPI.proactiveAddTask({ title: newTitle.trim(), instructions: newInstructions.trim() });
    if (res.tasks) setTasks(res.tasks);
    setNewTitle('');
    setNewInstructions('');
    setShowAddTask(false);
  }, [newTitle, newInstructions]);

  // Delete task
  const handleDeleteTask = useCallback(async (id: string) => {
    const res = await window.desktopAPI.proactiveDeleteTask(id);
    if (res.tasks) setTasks(res.tasks);
  }, []);

  // Trigger now
  const handleTriggerNow = useCallback(async () => {
    setWakeUpRunning(true);
    const res = await window.desktopAPI.proactiveTriggerNow();
    if (!res.ok) {
      setWakeUpRunning(false);
    }
  }, []);

  // Group tasks by status
  const tasksByStatus = useMemo(() => {
    const groups: Record<ProactiveTaskStatus, ProactiveTask[]> = { queued: [], in_progress: [], completed: [], failed: [] };
    for (const t of tasks) {
      if (groups[t.status]) groups[t.status].push(t);
    }
    return groups;
  }, [tasks]);

  const pendingCount = tasksByStatus.queued.length + tasksByStatus.in_progress.length;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        <p className="text-sm font-medium text-theme-muted animate-pulse">Synchronizing consciousness...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-10">
      {/* Header Area */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-[1.25rem] bg-gradient-to-br from-violet-600 to-indigo-700 flex items-center justify-center shadow-xl shadow-violet-500/20 border border-white/10">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-black text-theme-fg tracking-tight">Proactive Intelligence</h1>
              <div className="flex items-center gap-2 mt-1">
                <div className={clsx('w-2 h-2 rounded-full animate-pulse', config.enabled ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-red-500')} />
                <span className="text-xs font-bold text-theme-muted uppercase tracking-[0.1em] opacity-80">
                  {config.enabled ? 'Agent Active' : 'Agent Dormant'}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 bg-theme-card/30 p-1.5 rounded-2xl border border-theme/10 backdrop-blur-xl">
          {(['dashboard', 'activity', 'settings'] as ProactiveTab[]).map(t => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={clsx(
                'px-5 py-2 rounded-xl text-sm font-bold transition-all duration-300 capitalize relative',
                activeTab === t
                  ? 'bg-theme-bg text-theme-fg shadow-lg border border-theme/10'
                  : 'text-theme-muted hover:text-theme-fg hover:bg-theme-hover/40'
              )}
            >
              {activeTab === t && (
                <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary" />
              )}
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Hero Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="group rounded-3xl p-5 border border-theme/10 bg-theme-card/30 hover:bg-theme-hover/20 transition-all duration-300">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 rounded-2xl bg-primary/10 text-primary group-hover:scale-110 transition-transform duration-300">
              <Clock className="w-5 h-5" />
            </div>
            <span className="text-xs font-bold text-theme-muted uppercase tracking-wider">Next Check-in</span>
          </div>
          <div className="text-2xl font-black text-theme-fg">
            {!config.enabled ? '--:--' : config.interval === 'manual' ? 'Manual' : timeUntil(config.nextWakeUpAt)}
          </div>
          <div className="text-[10px] text-theme-muted mt-1 font-bold">
            {config.interval !== 'manual' && config.enabled ? `Frequency: ${SCHEDULE_LABELS[config.interval]}` : 'Waiting for trigger'}
          </div>
        </div>

        <div className="group rounded-3xl p-5 border border-theme/10 bg-theme-card/30 hover:bg-theme-hover/20 transition-all duration-300">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 rounded-2xl bg-amber-500/10 text-amber-500 group-hover:scale-110 transition-transform duration-300">
              <ListTodo className="w-5 h-5" />
            </div>
            <span className="text-xs font-bold text-theme-muted uppercase tracking-wider">Pending Tasks</span>
          </div>
          <div className="text-2xl font-black text-theme-fg">{pendingCount}</div>
          <div className="text-[10px] text-theme-muted mt-1 font-bold">
            In queue for agent check-in
          </div>
        </div>

        <div className="group rounded-3xl p-5 border border-theme/10 bg-theme-card/30 hover:bg-theme-hover/20 transition-all duration-300">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 rounded-2xl bg-emerald-500/10 text-emerald-500 group-hover:scale-110 transition-transform duration-300">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <span className="text-xs font-bold text-theme-muted uppercase tracking-wider">Daily Success</span>
          </div>
          <div className="text-2xl font-black text-theme-fg">
            {logs.filter(l => l.status === 'completed' && new Date(l.startedAt).toDateString() === new Date().toDateString()).length}
          </div>
          <div className="text-[10px] text-theme-muted mt-1 font-bold">
            Check-ins completed today
          </div>
        </div>

        <div className="group rounded-3xl p-5 border border-theme/10 bg-theme-card/30 hover:bg-theme-hover/20 transition-all duration-300 flex flex-col justify-between">
          <button
            onClick={handleTriggerNow}
            disabled={wakeUpRunning}
            className={clsx(
              'w-full h-full rounded-2xl flex flex-col items-center justify-center gap-3 transition-all duration-300 border-2 border-dashed group-hover:border-solid',
              wakeUpRunning
                ? 'bg-amber-500/15 border-amber-500/30 text-amber-500'
                : 'bg-primary/5 border-primary/20 text-primary hover:bg-primary/10 hover:border-primary/40 shadow-inner'
            )}
          >
            <div className={clsx('p-3 rounded-full bg-white/10 shadow-lg', wakeUpRunning && 'animate-pulse')}>
              {wakeUpRunning ? <Loader2 className="w-6 h-6 animate-spin" /> : <Play className="w-6 h-6" />}
            </div>
            <span className="text-sm font-black uppercase tracking-widest">
              {wakeUpRunning ? 'Waking up...' : 'Wake Up Now'}
            </span>
          </button>
        </div>
      </div>

      {/* Stage Visualizer (live when wake-up is running or recently finished) */}
      {stageState && (
        <div className="px-2 space-y-3">
          <StageVisualizer stageState={stageState} />
          {currentStageLog && <WakeUpDiagnostics log={currentStageLog} compact />}
        </div>
      )}

      {/* Tab Content */}
      <div className="min-h-[400px]">
        {activeTab === 'dashboard' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Kanban Board */}
            <div className="lg:col-span-2 space-y-6">
              <div className="flex items-center justify-between px-2">
                <h2 className="text-xl font-black text-theme-fg tracking-tight flex items-center gap-2">
                  <ListTodo className="w-5 h-5 text-primary" />
                  Intentions & Tasks
                </h2>
                <button
                  onClick={() => setShowAddTask(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-fg text-xs font-bold shadow-lg shadow-primary/20 hover:scale-105 active:scale-95 transition-all"
                >
                  <Plus className="w-4 h-4" />
                  New Intention
                </button>
              </div>

              <div className="rounded-[2rem] border border-theme/10 bg-theme-card/20 p-6 backdrop-blur-md">
                {showAddTask && (
                  <div className="mb-6 p-5 rounded-2xl bg-theme-hover/30 border border-theme/10 animate-in slide-in-from-top-4 duration-300">
                    <div className="space-y-4">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase tracking-widest text-theme-muted ml-1">Title</label>
                        <input
                          type="text"
                          value={newTitle}
                          onChange={e => setNewTitle(e.target.value)}
                          placeholder="What should the agent do?"
                          className="w-full px-4 py-3 rounded-xl bg-theme-card/50 text-sm text-theme-fg placeholder:text-theme-muted/30 border border-theme/10 focus:border-primary/50 focus:outline-none transition-all shadow-inner"
                          autoFocus
                          onKeyDown={e => e.key === 'Enter' && handleAddTask()}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase tracking-widest text-theme-muted ml-1">Special Instructions</label>
                        <textarea
                          value={newInstructions}
                          onChange={e => setNewInstructions(e.target.value)}
                          placeholder="Any specific context or data it should look for?"
                          rows={2}
                          className="w-full px-4 py-3 rounded-xl bg-theme-card/50 text-sm text-theme-fg placeholder:text-theme-muted/30 border border-theme/10 focus:border-primary/50 focus:outline-none resize-none transition-all shadow-inner"
                        />
                      </div>
                      <div className="flex gap-2 justify-end pt-2">
                        <button onClick={() => { setShowAddTask(false); setNewTitle(''); setNewInstructions(''); }}
                          className="px-5 py-2 rounded-xl text-xs font-bold text-theme-muted hover:text-theme-fg hover:bg-theme-hover/50 transition-all">
                          Discard
                        </button>
                        <button onClick={handleAddTask}
                          className="px-6 py-2 rounded-xl text-xs font-black bg-primary text-white hover:opacity-90 shadow-lg shadow-primary/20 transition-all disabled:opacity-50"
                          disabled={!newTitle.trim()}>
                          Schedule Intent
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {tasks.length === 0 && !showAddTask ? (
                  <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
                    <div className="w-20 h-20 rounded-[2rem] bg-theme-hover/20 flex items-center justify-center border border-theme/5">
                      <Brain className="w-10 h-10 text-theme-muted/20" />
                    </div>
                    <div className="space-y-1">
                      <h3 className="text-lg font-bold text-theme-fg">No Queued Intentions</h3>
                      <p className="text-sm text-theme-muted max-w-[280px] mx-auto">
                        Your agent will still check in based on your global instructions, but you can add specific one-off tasks here.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-6 overflow-x-auto pb-4 scrollbar-minimal">
                    <KanbanColumn status="queued" tasks={tasksByStatus.queued} onDelete={handleDeleteTask} />
                    <KanbanColumn status="in_progress" tasks={tasksByStatus.in_progress} onDelete={handleDeleteTask} />
                    <KanbanColumn status="completed" tasks={tasksByStatus.completed} onDelete={handleDeleteTask} />
                    <KanbanColumn status="failed" tasks={tasksByStatus.failed} onDelete={handleDeleteTask} />
                  </div>
                )}
              </div>
            </div>

            {/* Quick Activity Column */}
            <div className="space-y-6">
              <h2 className="text-xl font-black text-theme-fg tracking-tight flex items-center gap-2 px-2">
                <Clock className="w-5 h-5 text-violet-400" />
                Live Feed
              </h2>
              <div className="rounded-[2rem] border border-theme/10 bg-theme-card/10 overflow-hidden backdrop-blur-md">
                <div className="p-2 space-y-2 max-h-[600px] overflow-y-auto scrollbar-minimal">
                  {logs.length === 0 ? (
                    <div className="py-20 text-center">
                      <p className="text-xs font-bold text-theme-muted uppercase tracking-widest opacity-40">No activity yet</p>
                    </div>
                  ) : (
                    logs.slice(0, 15).map(log => <WakeUpLogEntry key={log.id} log={log} />)
                  )}
                </div>
                {logs.length > 0 && (
                  <button
                    onClick={() => setActiveTab('activity')}
                    className="w-full py-4 text-[10px] font-black uppercase tracking-[0.2em] text-theme-muted hover:text-primary transition-colors border-t border-theme/5 hover:bg-theme-hover/20"
                  >
                    View Comprehensive History
                  </button>
                )}
              </div>

              {/* Proactive Tip Card */}
              <div className="rounded-[2rem] p-6 bg-gradient-to-br from-violet-600/10 to-transparent border border-violet-500/20 relative overflow-hidden group">
                <div className="absolute -top-10 -right-10 w-32 h-32 bg-violet-500/10 rounded-full blur-3xl group-hover:scale-150 transition-transform duration-700" />
                <Sparkles className="w-8 h-8 text-violet-400 mb-4" />
                <h4 className="text-sm font-black text-theme-fg mb-2 uppercase tracking-tight">Proactive Wisdom</h4>
                <p className="text-xs text-theme-muted leading-relaxed">
                  The proactive agent uses <strong>Multi-Modal Screen Analysis</strong> to understand what you're doing. It only triggers when it feels it can be truly helpful based on your instructions.
                </p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'activity' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl mx-auto">
            <div className="flex items-center justify-between px-2">
              <h2 className="text-2xl font-black text-theme-fg tracking-tight">Check-in Chronicle</h2>
              <div className="text-xs font-bold text-theme-muted uppercase tracking-widest">
                Showing last {logs.length} events
              </div>
            </div>

            <div className="rounded-[2rem] border border-theme/10 bg-theme-card/30 p-4 space-y-4 max-h-[75vh] overflow-y-auto scrollbar-minimal">
              {logs.length === 0 ? (
                <div className="py-20 text-center text-theme-muted">No audit logs found.</div>
              ) : (
                logs.map(log => (
                  <div key={log.id} className="relative pl-8 pb-8 border-l border-theme/10 last:pb-0 ml-4">
                    <div className={clsx(
                      "absolute -left-2 top-0 w-4 h-4 rounded-full border-4 border-theme-bg shadow-lg transition-transform hover:scale-125",
                      log.status === 'completed' ? 'bg-emerald-500' : log.status === 'failed' ? 'bg-red-500' : 'bg-amber-500'
                    )} />
                    <div className="bg-theme-card/40 rounded-3xl p-6 border border-theme/5 hover:border-theme/10 transition-all hover:shadow-xl hover:shadow-black/5">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-black tabular-nums text-theme-muted">
                            {formatClockTime(log.startedAt)}
                          </span>
                          <span className="text-[10px] font-black text-theme-muted/50 uppercase tracking-widest">
                            {formatCalendarDate(log.startedAt)}
                          </span>
                        </div>
                        <div className={clsx(
                          "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest shadow-sm",
                          log.status === 'completed' ? 'bg-emerald-500/10 text-emerald-500' : log.status === 'failed' ? 'bg-red-500/10 text-red-500' : 'bg-amber-500/10 text-amber-500'
                        )}>
                          {log.status}
                        </div>
                      </div>

                      {log.agentMessage && (
                        <div className="text-sm text-theme-fg font-medium leading-relaxed bg-white/5 p-4 rounded-2xl border border-white/5 italic">
                          "{log.agentMessage}"
                        </div>
                      )}

                      <WakeUpDiagnostics log={log} />

                      <div className="mt-4 flex flex-wrap gap-2">
                        {log.contextUsed.map(ctx => (
                          <span key={ctx} className="px-2 py-0.5 rounded-lg bg-theme-hover/30 text-[9px] font-bold text-theme-muted uppercase tracking-tight flex items-center gap-1 border border-theme/5">
                            {ctx === 'screenshot' && <Camera className="w-2.5 h-2.5" />}
                            {ctx === 'system-audio' && <Volume2 className="w-2.5 h-2.5" />}
                            {ctx === 'mic-audio' && <Mic className="w-2.5 h-2.5" />}
                            {ctx}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Left Col: Core Settings */}
            <div className="space-y-6">
              <div className="rounded-[2rem] border border-theme/10 bg-theme-card/30 overflow-hidden">
                <div className="p-6 bg-gradient-to-r from-violet-600/10 to-transparent border-b border-theme/5">
                  <h3 className="text-lg font-black text-theme-fg">Behavioral Config</h3>
                  <p className="text-xs text-theme-muted mt-1">Control how and when the agent initializes.</p>
                </div>

                <div className="p-6 space-y-8">
                  {/* Enabled State */}
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="text-sm font-bold text-theme-fg flex items-center gap-2">
                        Proactive Awareness
                        {config.enabled && <Sparkles className="w-3.5 h-3.5 text-amber-500" />}
                      </div>
                      <p className="text-xs text-theme-muted max-w-[200px]">Allow the agent to wake up independently.</p>
                    </div>
                    <Toggle checked={config.enabled} onChange={v => updateConfig({ enabled: v })} />
                  </div>

                  {/* Schedule */}
                  <div className="space-y-3">
                    <label className="text-[10px] font-black text-theme-muted uppercase tracking-[0.2em] ml-1">Check-in Frequency</label>
                    <div className="flex flex-wrap gap-2">
                      {(Object.entries(SCHEDULE_LABELS) as [ScheduleInterval, string][]).map(([key, label]) => (
                        <button
                          key={key}
                          onClick={() => updateConfig({ interval: key })}
                          className={clsx(
                            'px-4 py-2 rounded-xl text-xs font-bold transition-all border shrink-0',
                            config.interval === key
                              ? 'bg-primary text-white shadow-lg shadow-primary/20 border-primary'
                              : 'bg-theme-card/40 text-theme-muted border-theme/10 hover:border-theme/30'
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Execution Target */}
                  <div className="space-y-3">
                    <label className="text-[10px] font-black text-theme-muted uppercase tracking-[0.2em] ml-1">Neural Engine Platform</label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {(Object.entries(EXECUTION_TARGET_LABELS) as [ExecutionTarget, { label: string; description: string }][]).map(([key, meta]) => (
                        <button
                          key={key}
                          onClick={() => updateConfig({ executionTarget: key })}
                          className={clsx(
                            'flex items-center gap-4 p-4 rounded-2xl border transition-all text-left group',
                            config.executionTarget === key
                              ? 'border-primary bg-primary/5 shadow-inner'
                              : 'border-theme/10 bg-theme-card/40 hover:bg-theme-hover/20'
                          )}
                        >
                          <div className={clsx(
                            'p-2.5 rounded-xl transition-all duration-300',
                            config.executionTarget === key ? 'bg-primary text-white scale-110' : 'bg-theme-hover/50 text-theme-muted group-hover:text-theme-fg'
                          )}>
                            {key === 'local' ? <Monitor className="w-5 h-5" /> : <Cloud className="w-5 h-5" />}
                          </div>
                          <div className="min-w-0">
                            <div className={clsx('text-sm font-black', config.executionTarget === key ? 'text-theme-fg' : 'text-theme-muted')}>
                              {meta.label}
                            </div>
                            <div className="text-[10px] font-medium opacity-60 leading-tight mt-0.5">{meta.description}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-[2rem] border border-theme/10 bg-theme-card/30 p-6 space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  <Brain className="w-5 h-5 text-primary" />
                  <h3 className="text-sm font-black text-theme-fg uppercase tracking-tight">Intelligence Override</h3>
                </div>
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    {(Object.entries(PROACTIVE_MODEL_MODE_LABELS) as [ProactiveModelMode, { label: string; description: string }][]).map(([key, meta]) => (
                      <button
                        key={key}
                        onClick={() => updateConfig({ modelMode: key })}
                        className={clsx(
                          'px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all border',
                          (config.modelMode || 'balanced') === key
                            ? 'bg-primary/20 text-primary border-primary/40'
                            : 'bg-theme-card/40 text-theme-muted border-theme/10 hover:border-theme/30'
                        )}
                      >
                        {meta.label}
                      </button>
                    ))}
                  </div>
                  <div className="pt-2">
                    <label className="text-[10px] font-black text-theme-muted uppercase tracking-widest ml-1 mb-2 block">Direct Model ID Provider</label>
                    <input
                      type="text"
                      value={config.modelId || ''}
                      onChange={e => setConfig(prev => ({ ...prev, modelId: e.target.value }))}
                      onBlur={() => updateConfig({ modelId: String(config.modelId || '').trim() })}
                      placeholder="e.g. google/gemini-3.1-pro-preview"
                      className="w-full px-4 py-3 rounded-xl bg-theme-bg/50 text-sm text-theme-fg placeholder:text-theme-muted/30 border border-theme/10 focus:border-primary/50 focus:outline-none transition-all"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Right Col: Permissions & Notifications */}
            <div className="space-y-6">
              <div className="rounded-[2rem] border border-theme/10 bg-theme-card/30 p-6">
                <div className="flex items-center gap-2 mb-6">
                  <Shield className="w-5 h-5 text-emerald-500" />
                  <h3 className="text-sm font-black text-theme-fg uppercase tracking-tight">Privacy & Permissions</h3>
                </div>

                <div className="space-y-3">
                  {[
                    { key: 'screenshot' as const, label: 'Screen Capturer', icon: Camera, desc: 'Allow agent to see your active window' },
                    { key: 'systemAudio' as const, label: 'Deep Hearing', icon: Volume2, desc: 'Allow agent to process system audio' },
                    { key: 'micAudio' as const, label: 'Vocal Presence', icon: Mic, desc: 'Allow agent to listen for your voice' },
                  ].map(perm => (
                    <div key={perm.key} className={clsx(
                      'flex items-center gap-4 p-4 rounded-2xl border transition-all',
                      config.contextPermissions[perm.key] ? 'border-primary/20 bg-primary/5' : 'border-theme/10 bg-theme-card/40'
                    )}>
                      <div className={clsx('p-2.5 rounded-xl', config.contextPermissions[perm.key] ? 'bg-primary/10 text-primary' : 'bg-theme-hover/50 text-theme-muted')}>
                        <perm.icon className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold text-theme-fg">{perm.label}</div>
                        <div className="text-[10px] font-medium text-theme-muted leading-tight mt-0.5">{perm.desc}</div>
                      </div>
                      <Toggle
                        checked={config.contextPermissions[perm.key]}
                        onChange={v => updateConfig({ contextPermissions: { ...config.contextPermissions, [perm.key]: v } })}
                      />
                    </div>
                  ))}
                </div>

                <div className="mt-8 pt-8 border-t border-theme/5">
                  <div className="flex items-center gap-2 mb-4">
                    <LockIcon className="w-4 h-4 text-theme-muted" />
                    <label className="text-[10px] font-black text-theme-muted uppercase tracking-[0.2em]">Safety Gate: Allowed Tools</label>
                  </div>
                  <ToolSelector
                    selected={config.allowedTools}
                    available={availableTools}
                    onChange={tools => updateConfig({ allowedTools: tools })}
                  />
                  <p className="text-[10px] text-theme-muted mt-3 italic opacity-60">
                    Leave empty to allow full autonomous tool usage within the proactive loop.
                  </p>
                </div>
              </div>

              <div className="rounded-[2rem] border border-theme/10 bg-theme-card/30 p-6">
                <div className="flex items-center gap-2 mb-1">
                  <Bell className="w-5 h-5 text-blue-500" />
                  <h3 className="text-sm font-black text-theme-fg uppercase tracking-tight">Post-Check Manifestations</h3>
                </div>
                <p className="text-xs text-theme-muted mb-6 opacity-80">How the agent reaches out after analyzing context.</p>

                <div className="grid grid-cols-1 gap-3">
                  {(Object.entries(NOTIFICATION_CHANNEL_LABELS) as Array<[NotificationChannel, { label: string; description: string }]>).map(([ch, info]) => {
                    const channels: NotificationChannel[] = config.notificationChannels || ['app'];
                    const isActive = channels.includes(ch);
                    const Icon = ch === 'sms' ? MessageSquare : ch === 'call' ? Phone : Bell;
                    return (
                      <div key={ch} className={clsx(
                        'flex items-center gap-4 p-4 rounded-2xl border transition-all',
                        isActive ? 'border-blue-500/20 bg-blue-500/5 shadow-inner' : 'border-theme/10 bg-theme-card/40'
                      )}>
                        <div className={clsx('p-2.5 rounded-xl', isActive ? 'bg-blue-500 text-white' : 'bg-theme-hover/50 text-theme-muted')}>
                          <Icon className="w-5 h-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-bold text-theme-fg">{info.label}</div>
                          <div className="text-[10px] font-medium text-theme-muted leading-tight mt-0.5">{info.description}</div>
                        </div>
                        <Toggle
                          checked={isActive}
                          onChange={v => {
                            const current: NotificationChannel[] = config.notificationChannels || ['app'];
                            const next = v
                              ? [...current, ch]
                              : current.filter(c => c !== ch);
                            updateConfig({ notificationChannels: next.length > 0 ? next : ['app'] } as any);
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Bottom Row: Instructions (Full Width) */}
            <div className="lg:col-span-2">
              <div className="rounded-[2rem] border border-theme/10 bg-theme-card/30 p-8 space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  <MessageSquare className="w-5 h-5 text-indigo-500" />
                  <h3 className="text-sm font-black text-theme-fg uppercase tracking-tight">Direct Consciousness Protocol</h3>
                </div>
                <p className="text-xs text-theme-muted opacity-80">
                  Defines the core personality and behavior during proactive intervals. Tell the agent what to look for on your screen or in your habits.
                </p>
                <textarea
                  value={config.instructions}
                  onChange={e => setConfig(prev => ({ ...prev, instructions: e.target.value }))}
                  onBlur={() => updateConfig({ instructions: config.instructions })}
                  placeholder="E.g., Analyze my workflow. If I am coding in Python, offer to refactor or help with documentation. If I seem to be procrastinating on social media, gently remind me of my goals."
                  rows={6}
                  className="w-full px-6 py-5 rounded-3xl bg-theme-bg/50 text-sm text-theme-fg placeholder:text-theme-muted/30 border border-theme/10 focus:border-primary/50 focus:outline-none resize-none transition-all shadow-2xl shadow-black/5"
                />
                <div className="flex justify-between items-center px-2">
                  <p className="text-[10px] text-theme-muted font-bold uppercase tracking-widest opacity-40">
                    Changes are autosaved on blur
                  </p>
                  {saving && (
                    <div className="flex items-center gap-2 text-primary">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      <span className="text-[10px] font-bold uppercase tracking-wider">Syncing...</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function LockIcon({ className }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>;
}
