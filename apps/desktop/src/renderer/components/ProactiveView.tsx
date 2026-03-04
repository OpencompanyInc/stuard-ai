import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { clsx } from 'clsx';
import {
  Play, Plus, Trash2, Check, Clock, Camera, Mic, Volume2,
  Shield, ChevronDown, ChevronRight, Loader2, Sparkles, Cloud, Monitor,
  Bell, MessageSquare, Phone, Zap, Brain, Cpu, CheckCircle2, XCircle,
  Eye, ListTodo,
} from 'lucide-react';
import type {
  ProactiveConfig,
  ProactiveTask,
  ProactiveTaskStatus,
  ProactiveWakeUpLog,
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

function WakeUpLogEntry({ log }: { log: ProactiveWakeUpLog }) {
  const [expanded, setExpanded] = useState(false);
  const statusColor = log.status === 'completed' ? 'text-emerald-400' : log.status === 'failed' ? 'text-red-400' : 'text-amber-400';

  return (
    <div className="border border-theme/5 rounded-xl p-3 hover:bg-theme-hover/10 transition">
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center gap-3 text-left">
        <div className={clsx('w-2 h-2 rounded-full flex-shrink-0', statusColor.replace('text-', 'bg-'))} />
        <div className="flex-1 min-w-0">
          <div className="text-xs text-theme-fg font-medium">
            {log.status === 'running' ? 'Running...' : log.agentMessage?.slice(0, 80) || 'No message'}
          </div>
          <div className="text-[10px] text-theme-muted mt-0.5">
            {timeAgo(log.startedAt)} {log.contextUsed.length > 0 && `· ${log.contextUsed.join(', ')}`}
          </div>
        </div>
        <ChevronRight className={clsx('w-3.5 h-3.5 text-theme-muted transition-transform', expanded && 'rotate-90')} />
      </button>
      {expanded && log.agentMessage && (
        <div className="mt-2 ml-5 text-xs text-theme-muted bg-theme-hover/20 rounded-lg p-2.5 whitespace-pre-wrap">
          {log.agentMessage}
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
  { key: 'start',   label: 'Starting',    icon: Zap },
  { key: 'context', label: 'Context',     icon: Eye },
  { key: 'tasks',   label: 'Tasks',       icon: ListTodo },
  { key: 'agent',   label: 'Agent',       icon: Brain },
  { key: 'process', label: 'Processing',  icon: Cpu },
  { key: 'done',    label: 'Done',        icon: CheckCircle2 },
];

function mapRawStageToDisplay(raw: string): string {
  switch (raw) {
    case 'initializing':      return 'start';
    case 'capturing-screen':
    case 'gathering-context': return 'context';
    case 'loading-tasks':     return 'tasks';
    case 'connecting':
    case 'thinking':          return 'agent';
    case 'processing':        return 'process';
    case 'complete':
    case 'failed':            return 'done';
    default:                  return 'start';
  }
}

interface StageState {
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

export function ProactiveView() {
  const [config, setConfig] = useState<ProactiveConfig>(DEFAULT_PROACTIVE_CONFIG);
  const [tasks, setTasks] = useState<ProactiveTask[]>([]);
  const [logs, setLogs] = useState<ProactiveWakeUpLog[]>([]);
  const [availableTools, setAvailableTools] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddTask, setShowAddTask] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newInstructions, setNewInstructions] = useState('');
  const [showLogs, setShowLogs] = useState(false);
  const [saving, setSaving] = useState(false);
  const [wakeUpRunning, setWakeUpRunning] = useState(false);
  const [stageState, setStageState] = useState<StageState | null>(null);
  const stageClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load everything
  const loadData = useCallback(async () => {
    try {
      const [cfgRes, taskRes, logRes, toolRes] = await Promise.all([
        window.desktopAPI.proactiveGetConfig(),
        window.desktopAPI.proactiveListTasks(),
        window.desktopAPI.proactiveGetWakeUpLog(20),
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
      }
      if (data.type === 'stage') {
        setStageState({
          stage: data.stage,
          label: data.label,
          progress: data.progress,
          detail: data.detail,
          failed: data.stage === 'failed',
        });

        if (stageClearTimer.current) clearTimeout(stageClearTimer.current);
        if (data.stage === 'complete' || data.stage === 'failed') {
          stageClearTimer.current = setTimeout(() => setStageState(null), 5000);
        }
      }
      if (data.type === 'wake-up-complete' || data.type === 'wake-up-failed') {
        setWakeUpRunning(false);
        loadData();
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
  }, [loadData]);

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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-theme-fg flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-500/20 to-purple-600/20 flex items-center justify-center border border-violet-500/20">
              <Sparkles className="w-5 h-5 text-violet-400" />
            </div>
            Proactive Agent
          </h1>
          <p className="text-sm text-theme-muted mt-1">
            Your agent wakes up periodically to check on you, complete tasks, and offer help.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {config.enabled && (
            <>
              <div className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border',
                config.executionTarget === 'cloud'
                  ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                  : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
              )}>
                {config.executionTarget === 'cloud' ? <Cloud className="w-3.5 h-3.5" /> : <Monitor className="w-3.5 h-3.5" />}
                {config.executionTarget === 'cloud' ? 'Cloud VM' : 'Local'}
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border bg-violet-500/10 text-violet-400 border-violet-500/20">
                <Brain className="w-3.5 h-3.5" />
                {config.modelId?.trim() || PROACTIVE_MODEL_MODE_LABELS[(config.modelMode || 'balanced') as ProactiveModelMode].label}
              </div>
            </>
          )}
          <button
            onClick={handleTriggerNow}
            disabled={wakeUpRunning}
            className={clsx(
              'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition border',
              wakeUpRunning
                ? 'bg-amber-500/10 text-amber-400 border-amber-500/20 cursor-not-allowed'
                : 'bg-primary/10 text-primary border-primary/20 hover:bg-primary/20'
            )}
          >
            {wakeUpRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {wakeUpRunning ? 'Checking in...' : 'Wake Up Now'}
          </button>
        </div>
      </div>

      {/* Stage Visualizer (live when wake-up is running) */}
      <StageVisualizer stageState={stageState} />

      {/* Main Config Card */}
      <div className="rounded-2xl border border-theme/10 bg-theme-card/30 overflow-hidden">
        {/* Enable toggle + status */}
        <div className="p-5 flex items-center justify-between border-b border-theme/5">
          <div className="flex items-center gap-4">
            <Toggle checked={config.enabled} onChange={v => updateConfig({ enabled: v })} />
            <div>
              <div className="text-sm font-bold text-theme-fg">
                {config.enabled ? 'Proactive Mode Active' : 'Proactive Mode Off'}
              </div>
              <div className="text-xs text-theme-muted mt-0.5">
                {config.enabled
                  ? config.interval === 'manual'
                    ? 'Manual triggers only'
                    : `Next check-in: ${timeUntil(config.nextWakeUpAt)}`
                  : 'Enable to let the agent check in on you periodically'}
              </div>
            </div>
          </div>
          {config.lastWakeUpAt && (
            <div className="text-xs text-theme-muted flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              Last: {timeAgo(config.lastWakeUpAt)}
            </div>
          )}
        </div>

        {/* Execution Target */}
        <div className="p-5 border-b border-theme/5">
          <label className="text-xs font-bold text-theme-muted uppercase tracking-wider mb-3 block">Execution Target</label>
          <div className="grid grid-cols-2 gap-3">
            {(Object.entries(EXECUTION_TARGET_LABELS) as [ExecutionTarget, { label: string; description: string }][]).map(([key, meta]) => (
              <button
                key={key}
                onClick={() => updateConfig({ executionTarget: key })}
                className={clsx(
                  'flex items-center gap-3 p-3 rounded-xl border transition text-left',
                  config.executionTarget === key
                    ? 'border-primary/30 bg-primary/5'
                    : 'border-theme/10 bg-theme-hover/10 hover:bg-theme-hover/20'
                )}
              >
                {key === 'local'
                  ? <Monitor className={clsx('w-5 h-5 flex-shrink-0', config.executionTarget === key ? 'text-primary' : 'text-theme-muted')} />
                  : <Cloud className={clsx('w-5 h-5 flex-shrink-0', config.executionTarget === key ? 'text-primary' : 'text-theme-muted')} />
                }
                <div>
                  <div className={clsx('text-sm font-semibold', config.executionTarget === key ? 'text-primary' : 'text-theme-fg')}>
                    {meta.label}
                  </div>
                  <div className="text-[10px] text-theme-muted">{meta.description}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Model Selection */}
        <div className="p-5 border-b border-theme/5">
          <label className="text-xs font-bold text-theme-muted uppercase tracking-wider mb-2 block">Agent Model</label>
          <p className="text-xs text-theme-muted mb-3">
            Pick a model tier for proactive check-ins, or set an exact provider model ID override.
          </p>
          <div className="flex flex-wrap gap-2">
            {(Object.entries(PROACTIVE_MODEL_MODE_LABELS) as [ProactiveModelMode, { label: string; description: string }][]).map(([key, meta]) => (
              <button
                key={key}
                onClick={() => updateConfig({ modelMode: key })}
                title={meta.description}
                className={clsx(
                  'px-3 py-1.5 rounded-xl text-xs font-semibold transition border',
                  (config.modelMode || 'balanced') === key
                    ? 'bg-primary/15 text-primary border-primary/30'
                    : 'bg-theme-hover/20 text-theme-muted border-theme/10 hover:bg-theme-hover/40'
                )}
              >
                {meta.label}
              </button>
            ))}
          </div>
          <div className="mt-3">
            <label className="text-[10px] font-bold text-theme-muted uppercase tracking-wider mb-1 block">
              Specific Model ID (optional)
            </label>
            <input
              type="text"
              value={config.modelId || ''}
              onChange={e => setConfig(prev => ({ ...prev, modelId: e.target.value }))}
              onBlur={() => updateConfig({ modelId: String(config.modelId || '').trim() })}
              placeholder="e.g. google/gemini-3.1-pro-preview"
              className="w-full px-3 py-2 rounded-xl bg-theme-hover/20 text-sm text-theme-fg placeholder:text-theme-muted/40 border border-theme/10 focus:border-primary/30 focus:outline-none transition"
            />
          </div>
        </div>

        {/* Schedule */}
        <div className="p-5 border-b border-theme/5">
          <label className="text-xs font-bold text-theme-muted uppercase tracking-wider mb-2 block">Schedule</label>
          <div className="flex flex-wrap gap-2">
            {(Object.entries(SCHEDULE_LABELS) as [ScheduleInterval, string][]).map(([key, label]) => (
              <button
                key={key}
                onClick={() => updateConfig({ interval: key })}
                className={clsx(
                  'px-3 py-1.5 rounded-xl text-xs font-semibold transition border',
                  config.interval === key
                    ? 'bg-primary/15 text-primary border-primary/30'
                    : 'bg-theme-hover/20 text-theme-muted border-theme/10 hover:bg-theme-hover/40'
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Instructions */}
        <div className="p-5 border-b border-theme/5">
          <label className="text-xs font-bold text-theme-muted uppercase tracking-wider mb-2 block">
            General Instructions
          </label>
          <textarea
            value={config.instructions}
            onChange={e => setConfig(prev => ({ ...prev, instructions: e.target.value }))}
            onBlur={() => updateConfig({ instructions: config.instructions })}
            placeholder="E.g., Check if I seem stuck or stressed and offer help. Remind me to take breaks. Keep an eye on my calendar."
            rows={3}
            className="w-full px-4 py-3 rounded-xl bg-theme-hover/20 text-sm text-theme-fg placeholder:text-theme-muted/40 border border-theme/10 focus:border-primary/30 focus:outline-none resize-none transition"
          />
        </div>

        {/* Context Permissions */}
        <div className="p-5 border-b border-theme/5">
          <label className="text-xs font-bold text-theme-muted uppercase tracking-wider mb-3 block">
            Context Permissions
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className={clsx(
              'flex items-center gap-3 p-3 rounded-xl border transition',
              config.contextPermissions.screenshot ? 'border-primary/20 bg-primary/5' : 'border-theme/10 bg-theme-hover/10'
            )}>
              <Camera className={clsx('w-4 h-4', config.contextPermissions.screenshot ? 'text-primary' : 'text-theme-muted')} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-theme-fg">Screenshot</div>
                <div className="text-[10px] text-theme-muted">See your screen</div>
              </div>
              <Toggle
                checked={config.contextPermissions.screenshot}
                onChange={v => updateConfig({ contextPermissions: { ...config.contextPermissions, screenshot: v } })}
              />
            </div>
            <div className={clsx(
              'flex items-center gap-3 p-3 rounded-xl border transition',
              config.contextPermissions.systemAudio ? 'border-primary/20 bg-primary/5' : 'border-theme/10 bg-theme-hover/10'
            )}>
              <Volume2 className={clsx('w-4 h-4', config.contextPermissions.systemAudio ? 'text-primary' : 'text-theme-muted')} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-theme-fg">System Audio</div>
                <div className="text-[10px] text-theme-muted">Hear system sounds</div>
              </div>
              <Toggle
                checked={config.contextPermissions.systemAudio}
                onChange={v => updateConfig({ contextPermissions: { ...config.contextPermissions, systemAudio: v } })}
              />
            </div>
            <div className={clsx(
              'flex items-center gap-3 p-3 rounded-xl border transition',
              config.contextPermissions.micAudio ? 'border-primary/20 bg-primary/5' : 'border-theme/10 bg-theme-hover/10'
            )}>
              <Mic className={clsx('w-4 h-4', config.contextPermissions.micAudio ? 'text-primary' : 'text-theme-muted')} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-theme-fg">Microphone</div>
                <div className="text-[10px] text-theme-muted">Hear your voice</div>
              </div>
              <Toggle
                checked={config.contextPermissions.micAudio}
                onChange={v => updateConfig({ contextPermissions: { ...config.contextPermissions, micAudio: v } })}
              />
            </div>
          </div>
        </div>

        {/* Notification Channels */}
        <div className="p-5 border-b border-theme/5">
          <label className="text-xs font-bold text-theme-muted uppercase tracking-wider mb-3 block">
            Notification Channels
          </label>
          <p className="text-xs text-theme-muted mb-3">
            How Stuard notifies you after a proactive check-in. SMS/Call requires a verified phone number in Integrations.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {(Object.entries(NOTIFICATION_CHANNEL_LABELS) as Array<[NotificationChannel, { label: string; description: string }]>).map(([ch, info]) => {
              const channels: NotificationChannel[] = config.notificationChannels || ['app'];
              const isActive = channels.includes(ch);
              const Icon = ch === 'sms' ? MessageSquare : ch === 'call' ? Phone : Bell;
              return (
                <div key={ch} className={clsx(
                  'flex items-center gap-3 p-3 rounded-xl border transition',
                  isActive ? 'border-primary/20 bg-primary/5' : 'border-theme/10 bg-theme-hover/10'
                )}>
                  <Icon className={clsx('w-4 h-4', isActive ? 'text-primary' : 'text-theme-muted')} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-theme-fg">{info.label}</div>
                    <div className="text-[10px] text-theme-muted">{info.description}</div>
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

        {/* Tool Restrictions */}
        <div className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <Shield className="w-4 h-4 text-theme-muted" />
            <label className="text-xs font-bold text-theme-muted uppercase tracking-wider">
              Allowed Tools
            </label>
            <span className="text-[10px] text-theme-muted/60 ml-1">(safety)</span>
          </div>
          <p className="text-xs text-theme-muted mb-3">
            Restrict which tools the agent can use during proactive check-ins. Leave empty to allow all tools.
          </p>
          <ToolSelector
            selected={config.allowedTools}
            available={availableTools}
            onChange={tools => updateConfig({ allowedTools: tools })}
          />
        </div>
      </div>

      {/* Optional Tasks Kanban */}
      <div className="rounded-2xl border border-theme/10 bg-theme-card/30 overflow-hidden">
        <div className="p-5 flex items-center justify-between border-b border-theme/5">
          <div>
            <h2 className="text-sm font-bold text-theme-fg">Task Queue</h2>
            <p className="text-xs text-theme-muted mt-0.5">
              Optional tasks for the agent to work on during check-ins
            </p>
          </div>
          <button
            onClick={() => setShowAddTask(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-theme-hover/30 text-xs font-semibold text-theme-fg hover:bg-theme-hover/50 transition border border-theme/10"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Task
          </button>
        </div>

        {/* Add task form */}
        {showAddTask && (
          <div className="p-4 border-b border-theme/5 bg-theme-hover/10">
            <div className="space-y-3">
              <input
                type="text"
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                placeholder="Task title..."
                className="w-full px-3 py-2 rounded-xl bg-theme-card/50 text-sm text-theme-fg placeholder:text-theme-muted/40 border border-theme/10 focus:border-primary/30 focus:outline-none"
                autoFocus
                onKeyDown={e => e.key === 'Enter' && handleAddTask()}
              />
              <textarea
                value={newInstructions}
                onChange={e => setNewInstructions(e.target.value)}
                placeholder="Instructions for the agent (optional)..."
                rows={2}
                className="w-full px-3 py-2 rounded-xl bg-theme-card/50 text-sm text-theme-fg placeholder:text-theme-muted/40 border border-theme/10 focus:border-primary/30 focus:outline-none resize-none"
              />
              <div className="flex gap-2 justify-end">
                <button onClick={() => { setShowAddTask(false); setNewTitle(''); setNewInstructions(''); }}
                  className="px-3 py-1.5 rounded-lg text-xs text-theme-muted hover:text-theme-fg transition">Cancel</button>
                <button onClick={handleAddTask}
                  className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white hover:bg-primary/90 transition"
                  disabled={!newTitle.trim()}>
                  Add
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Kanban board */}
        <div className="p-5">
          {tasks.length === 0 && !showAddTask ? (
            <div className="text-center py-8">
              <div className="w-12 h-12 rounded-2xl bg-theme-hover/20 flex items-center justify-center mx-auto mb-3">
                <Sparkles className="w-6 h-6 text-theme-muted/40" />
              </div>
              <div className="text-sm text-theme-muted">No tasks queued</div>
              <div className="text-xs text-theme-muted/60 mt-1">
                The agent will still check in based on your instructions
              </div>
            </div>
          ) : (
            <div className="flex gap-4 overflow-x-auto custom-scrollbar pb-2">
              <KanbanColumn status="queued" tasks={tasksByStatus.queued} onDelete={handleDeleteTask} />
              <KanbanColumn status="in_progress" tasks={tasksByStatus.in_progress} onDelete={handleDeleteTask} />
              <KanbanColumn status="completed" tasks={tasksByStatus.completed} onDelete={handleDeleteTask} />
              <KanbanColumn status="failed" tasks={tasksByStatus.failed} onDelete={handleDeleteTask} />
            </div>
          )}
        </div>
      </div>

      {/* Wake-Up History */}
      <div className="rounded-2xl border border-theme/10 bg-theme-card/30 overflow-hidden">
        <button
          onClick={() => setShowLogs(!showLogs)}
          className="w-full p-5 flex items-center justify-between hover:bg-theme-hover/10 transition"
        >
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-theme-muted" />
            <h2 className="text-sm font-bold text-theme-fg">Check-in History</h2>
            <span className="text-[10px] text-theme-muted/60">{logs.length} entries</span>
          </div>
          <ChevronDown className={clsx('w-4 h-4 text-theme-muted transition-transform', showLogs && 'rotate-180')} />
        </button>

        {showLogs && (
          <div className="px-5 pb-5 space-y-2">
            {logs.length === 0 ? (
              <div className="text-center py-6 text-xs text-theme-muted">No check-ins yet</div>
            ) : (
              logs.map(log => <WakeUpLogEntry key={log.id} log={log} />)
            )}
          </div>
        )}
      </div>
    </div>
  );
}
