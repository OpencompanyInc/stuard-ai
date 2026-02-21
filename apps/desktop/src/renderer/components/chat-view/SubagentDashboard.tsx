import React, { memo, useState, useMemo } from 'react';
import { clsx } from 'clsx';
import {
  Loader2,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
  X,
  Sparkles,
  Cpu,
  Terminal,
  Globe,
  Code,
  RefreshCw,
  Zap,
  Brain,
  Eye,
  FileText,
  Search,
  MessageSquare,
} from 'lucide-react';
import type { SubAgentTask } from '@/hooks/useSubagentDashboard';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface SubagentDashboardProps {
  tasks: SubAgentTask[];
  visibleTasks: SubAgentTask[];
  activeTask: SubAgentTask | null;
  activeTaskId: string | null;
  setActiveTaskId: (id: string | null) => void;
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  dismissed: boolean;
  setDismissed: (v: boolean) => void;
  dismissTask: (id: string) => void;
  hasRunning: boolean;
  refresh: () => void;
  loading: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Status config — refined palette
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  running: {
    icon: Zap,
    color: 'text-violet-300',
    bg: 'bg-violet-500/8',
    border: 'border-violet-400/20',
    dot: 'bg-violet-400',
    glow: 'shadow-[0_0_12px_-3px_rgba(139,92,246,0.3)]',
    label: 'Thinking',
  },
  completed: {
    icon: CheckCircle2,
    color: 'text-emerald-300',
    bg: 'bg-emerald-500/8',
    border: 'border-emerald-400/20',
    dot: 'bg-emerald-400',
    glow: '',
    label: 'Done',
  },
  failed: {
    icon: XCircle,
    color: 'text-rose-300',
    bg: 'bg-rose-500/8',
    border: 'border-rose-400/20',
    dot: 'bg-rose-400',
    glow: '',
    label: 'Failed',
  },
} as const;

function getStatusConfig(status: string) {
  return STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] || {
    icon: Brain,
    color: 'text-slate-400',
    bg: 'bg-slate-500/8',
    border: 'border-slate-500/20',
    dot: 'bg-slate-400',
    glow: '',
    label: status,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function truncate(s: string, max: number) {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function toolIcon(name: string) {
  if (name.includes('web_search') || name.includes('browse') || name.includes('fetch')) return Search;
  if (name.includes('code') || name.includes('edit') || name.includes('write')) return Code;
  if (name.includes('terminal') || name.includes('shell') || name.includes('exec')) return Terminal;
  if (name.includes('read') || name.includes('file') || name.includes('list')) return FileText;
  if (name.includes('deploy') || name.includes('agent')) return Sparkles;
  return Globe;
}

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** Extract the latest reasoning text from logs */
function getLatestReasoning(logs: any[]): string | null {
  for (let i = logs.length - 1; i >= 0; i--) {
    const log = logs[i];
    if (log?.type === 'reasoning' || log?.type === 'reasoning_complete') {
      return log.text || null;
    }
  }
  return null;
}

/** Extract tool call log entries */
function getToolLogs(logs: any[]): any[] {
  return logs.filter(l => l?.type === 'tool_call' || l?.type === 'tool_result');
}

// ─────────────────────────────────────────────────────────────────────────────
// Component: Tab Pill — refined glass style
// ─────────────────────────────────────────────────────────────────────────────

const TabPill: React.FC<{
  task: SubAgentTask;
  isActive: boolean;
  onClick: () => void;
  onDismiss: (e: React.MouseEvent) => void;
}> = ({ task, isActive, onClick, onDismiss }) => {
  const cfg = getStatusConfig(task.status);
  const Icon = cfg.icon;

  return (
    <button
      onClick={onClick}
      className={clsx(
        'group relative flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium transition-all whitespace-nowrap',
        isActive
          ? `backdrop-blur-xl bg-white/[0.08] border border-white/[0.12] ${cfg.color} ${cfg.glow}`
          : 'text-white/40 hover:text-white/70 hover:bg-white/[0.04] border border-transparent'
      )}
    >
      <Icon
        className={clsx(
          'w-3 h-3 shrink-0',
          task.status === 'running' && 'animate-[pulse_1.5s_ease-in-out_infinite]',
          isActive ? cfg.color : 'text-white/30'
        )}
      />
      <span className="truncate max-w-[100px]">{truncate(task.objective, 24)}</span>
      {task.status !== 'running' && (
        <span
          onClick={onDismiss}
          className="ml-0.5 p-0.5 rounded-full hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity"
          role="button"
          aria-label="Dismiss"
        >
          <X className="w-2.5 h-2.5" />
        </span>
      )}
    </button>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Component: Reasoning Panel — the star of the show
// ─────────────────────────────────────────────────────────────────────────────

const ReasoningPanel: React.FC<{ text: string; isLive: boolean }> = ({ text, isLive }) => {
  const [expanded, setExpanded] = useState(false);
  const displayText = expanded ? text : text.slice(-600);
  const isTruncated = !expanded && text.length > 600;

  return (
    <div className="relative">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Brain className={clsx('w-3 h-3', isLive ? 'text-violet-300 animate-pulse' : 'text-white/30')} />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
          {isLive ? 'Thinking' : 'Reasoning'}
        </span>
        {isLive && (
          <span className="flex items-center gap-1">
            <span className="w-1 h-1 rounded-full bg-violet-400 animate-ping" />
            <span className="w-1 h-1 rounded-full bg-violet-400 animate-ping [animation-delay:0.15s]" />
            <span className="w-1 h-1 rounded-full bg-violet-400 animate-ping [animation-delay:0.3s]" />
          </span>
        )}
      </div>
      <div
        className={clsx(
          'text-[12px] leading-relaxed text-white/60 whitespace-pre-wrap break-words',
          'max-h-[200px] overflow-y-auto custom-scrollbar',
          isLive && 'border-l-2 border-violet-500/30 pl-3'
        )}
      >
        {isTruncated && (
          <button
            onClick={() => setExpanded(true)}
            className="text-[10px] text-violet-300/60 hover:text-violet-300 mb-1 block"
          >
            …show earlier reasoning
          </button>
        )}
        {displayText}
        {isLive && <span className="inline-block w-1.5 h-3 bg-violet-400/60 animate-[blink_1s_steps(2)_infinite] ml-0.5 align-middle" />}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Component: Tool Activity — compact horizontal flow
// ─────────────────────────────────────────────────────────────────────────────

const ToolActivity: React.FC<{ logs: any[] }> = ({ logs }) => {
  const toolLogs = useMemo(() => getToolLogs(logs).slice(-12), [logs]);
  if (toolLogs.length === 0) return null;

  // Group consecutive calls: show tool name + count
  const grouped = useMemo(() => {
    const result: { name: string; count: number; status: string }[] = [];
    for (const log of toolLogs) {
      const name = log.tool || log.tool_name || 'step';
      if (log.type === 'tool_call') {
        result.push({ name, count: 1, status: 'running' });
      } else if (log.type === 'tool_result') {
        // Mark previous matching call as done
        const prev = [...result].reverse().find(r => r.name === name && r.status === 'running');
        if (prev) prev.status = 'completed';
        else result.push({ name, count: 1, status: 'completed' });
      }
    }
    return result.slice(-8);
  }, [toolLogs]);

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {grouped.map((item, i) => {
        const TIcon = toolIcon(item.name);
        const isActive = item.status === 'running';
        return (
          <span
            key={`${item.name}-${i}`}
            className={clsx(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border transition-all',
              isActive
                ? 'bg-violet-500/10 border-violet-400/20 text-violet-300'
                : 'bg-white/[0.03] border-white/[0.06] text-white/35'
            )}
            title={item.name}
          >
            {isActive ? (
              <Loader2 className="w-2.5 h-2.5 animate-spin" />
            ) : (
              <TIcon className="w-2.5 h-2.5" />
            )}
            <span className="truncate max-w-[80px]">{item.name.replace(/_/g, ' ')}</span>
          </span>
        );
      })}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Component: Task Detail — reasoning + output focused
// ─────────────────────────────────────────────────────────────────────────────

const TaskDetail: React.FC<{ task: SubAgentTask }> = ({ task }) => {
  const cfg = getStatusConfig(task.status);
  const Icon = cfg.icon;
  const logs = task.logs || [];
  const reasoning = getLatestReasoning(logs);
  const elapsed = task.updated_at && task.created_at
    ? new Date(task.updated_at).getTime() - new Date(task.created_at).getTime()
    : 0;

  const resultText = task.result
    ? (typeof task.result === 'string' ? task.result : task.result?.text || JSON.stringify(task.result))
    : null;

  return (
    <div className="px-4 py-3 space-y-3">
      {/* Objective + meta row */}
      <div className="flex items-start gap-3">
        <div className={clsx(
          'mt-0.5 p-1.5 rounded-lg shrink-0',
          'backdrop-blur-sm bg-white/[0.04] border border-white/[0.06]'
        )}>
          <Sparkles className={clsx('w-3.5 h-3.5', cfg.color)} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-white/80 leading-snug line-clamp-2">
            {task.objective}
          </p>
          <div className="flex items-center gap-3 mt-1.5">
            <span className={clsx(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border',
              cfg.color, cfg.bg, cfg.border
            )}>
              <Icon className={clsx('w-2.5 h-2.5', task.status === 'running' && 'animate-[pulse_1.5s_ease-in-out_infinite]')} />
              {cfg.label}
            </span>
            <span className="flex items-center gap-1 text-[10px] text-white/25">
              <Cpu className="w-2.5 h-2.5" />
              {task.model}
            </span>
            {logs.length > 0 && (
              <span className="text-[10px] text-white/25">
                {getToolLogs(logs).length} tools used
              </span>
            )}
            {elapsed > 0 && task.status !== 'running' && (
              <span className="text-[10px] text-white/25">
                {formatDuration(elapsed)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Progress shimmer for running */}
      {task.status === 'running' && (
        <div className="h-px bg-gradient-to-r from-transparent via-violet-500/30 to-transparent overflow-hidden">
          <div className="h-full w-1/3 bg-violet-400/40 animate-[shimmer_2.5s_infinite_linear] rounded-full" />
        </div>
      )}

      {/* Chain-of-thought reasoning — the main content */}
      {reasoning && (
        <ReasoningPanel text={reasoning} isLive={task.status === 'running'} />
      )}

      {/* Tool activity — compact pills */}
      {logs.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Eye className="w-3 h-3 text-white/25" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-white/25">Activity</span>
          </div>
          <ToolActivity logs={logs} />
        </div>
      )}

      {/* Final output — prominent when completed */}
      {task.status === 'completed' && resultText && (
        <div className="relative">
          <div className="flex items-center gap-1.5 mb-1.5">
            <MessageSquare className="w-3 h-3 text-emerald-400/50" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400/50">Output</span>
          </div>
          <div className="text-[12px] leading-relaxed text-white/70 whitespace-pre-wrap break-words
            bg-emerald-500/[0.04] border border-emerald-400/10 rounded-lg p-3
            max-h-[160px] overflow-y-auto custom-scrollbar">
            {typeof resultText === 'string' ? resultText.slice(0, 1200) : String(resultText).slice(0, 1200)}
          </div>
        </div>
      )}

      {/* Error output */}
      {task.status === 'failed' && resultText && (
        <div className="relative">
          <div className="flex items-center gap-1.5 mb-1.5">
            <XCircle className="w-3 h-3 text-rose-400/50" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-rose-400/50">Error</span>
          </div>
          <div className="text-[12px] leading-relaxed text-rose-300/70 whitespace-pre-wrap break-words
            bg-rose-500/[0.04] border border-rose-400/10 rounded-lg p-3
            max-h-[120px] overflow-y-auto custom-scrollbar">
            {typeof resultText === 'string' ? resultText.slice(0, 800) : String(resultText).slice(0, 800)}
          </div>
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Component: SubagentDashboard — translucent glass design
// ─────────────────────────────────────────────────────────────────────────────

const SubagentDashboardInner: React.FC<SubagentDashboardProps> = ({
  visibleTasks,
  activeTask,
  activeTaskId,
  setActiveTaskId,
  collapsed,
  setCollapsed,
  dismissed,
  setDismissed,
  dismissTask,
  hasRunning,
  refresh,
  loading,
}) => {
  // Don't render if no visible tasks or explicitly dismissed
  if (visibleTasks.length === 0 || dismissed) return null;

  const runningCount = visibleTasks.filter(t => t.status === 'running').length;

  return (
    <div
      className={clsx(
        'mx-2 mb-1.5 rounded-2xl transition-all duration-300 overflow-hidden',
        // Translucent glass effect
        'backdrop-blur-2xl bg-black/[0.35] border',
        hasRunning
          ? 'border-violet-500/15 shadow-[0_4px_24px_-4px_rgba(139,92,246,0.12)]'
          : 'border-white/[0.06] shadow-[0_2px_12px_-2px_rgba(0,0,0,0.3)]'
      )}
    >
      {/* Header strip */}
      <div className="flex items-center gap-2 px-3 py-2 min-h-[38px]">
        {/* Left: icon + label */}
        <div className="flex items-center gap-2 shrink-0">
          <div className={clsx(
            'p-1 rounded-lg',
            hasRunning ? 'bg-violet-500/10' : 'bg-white/[0.04]'
          )}>
            <Sparkles className={clsx('w-3 h-3', hasRunning ? 'text-violet-300' : 'text-white/30')} />
          </div>
          {runningCount > 0 && (
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-violet-500/10 border border-violet-400/15 text-violet-300 text-[10px] font-semibold">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-60" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-violet-400" />
              </span>
              {runningCount} active
            </span>
          )}
        </div>

        {/* Center: tab pills */}
        <div className="flex-1 min-w-0 overflow-x-auto scrollbar-hidden">
          <div className="flex items-center gap-1">
            {visibleTasks.map(task => (
              <TabPill
                key={task.id}
                task={task}
                isActive={activeTaskId === task.id}
                onClick={() => {
                  if (activeTaskId === task.id && !collapsed) {
                    setCollapsed(true);
                  } else {
                    setActiveTaskId(task.id);
                    setCollapsed(false);
                  }
                }}
                onDismiss={(e) => {
                  e.stopPropagation();
                  dismissTask(task.id);
                }}
              />
            ))}
          </div>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={refresh}
            className="p-1.5 rounded-lg hover:bg-white/[0.06] text-white/25 hover:text-white/50 transition-colors"
            title="Refresh"
          >
            <RefreshCw className={clsx('w-3 h-3', loading && 'animate-spin')} />
          </button>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-1.5 rounded-lg hover:bg-white/[0.06] text-white/25 hover:text-white/50 transition-colors"
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="p-1.5 rounded-lg hover:bg-white/[0.06] text-white/25 hover:text-white/50 transition-colors"
            title="Dismiss"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Detail panel — expands with smooth transition */}
      {!collapsed && activeTask && (
        <div className="border-t border-white/[0.04]">
          <TaskDetail task={activeTask} />
        </div>
      )}
    </div>
  );
};

export const SubagentDashboard = memo(SubagentDashboardInner);
