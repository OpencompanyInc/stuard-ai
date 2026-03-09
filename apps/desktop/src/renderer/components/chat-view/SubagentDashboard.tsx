import React, { memo, useState, useMemo } from 'react';
import { clsx } from 'clsx';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
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
  Clock,
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
    color: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/20',
    dot: 'bg-blue-500',
    glow: 'shadow-[0_0_12px_-3px_rgba(59,130,246,0.3)]',
    label: 'Thinking',
  },
  completed: {
    icon: CheckCircle2,
    color: 'text-emerald-600 dark:text-emerald-500',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/20',
    dot: 'bg-emerald-500',
    glow: '',
    label: 'Done',
  },
  failed: {
    icon: XCircle,
    color: 'text-red-600 dark:text-red-500',
    bg: 'bg-red-500/10',
    border: 'border-red-500/20',
    dot: 'bg-red-500',
    glow: '',
    label: 'Failed',
  },
} as const;

function getStatusConfig(status: string) {
  return STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] || {
    icon: Brain,
    color: 'text-theme-muted',
    bg: 'bg-theme-bg',
    border: 'border-theme-border',
    dot: 'bg-theme-muted',
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

const MARKDOWN_COMPONENTS = {
  p: ({ children }: any) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }: any) => <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
  ol: ({ children }: any) => <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
  li: ({ children }: any) => <li className="leading-relaxed">{children}</li>,
  a: ({ children, ...props }: any) => (
    <a
      {...props}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-300 underline decoration-blue-400/40 underline-offset-2 hover:text-blue-200"
    >
      {children}
    </a>
  ),
  code: ({ inline, className, children, ...props }: any) =>
    inline ? (
      <code
        {...props}
        className="rounded-md bg-white/[0.08] px-1.5 py-0.5 font-mono text-[0.92em] text-blue-100"
      >
        {children}
      </code>
    ) : (
      <code {...props} className={clsx('block whitespace-pre-wrap break-words font-mono text-[12px] text-theme-fg/90', className)}>
        {children}
      </code>
    ),
  pre: ({ children }: any) => (
    <pre className="my-2 overflow-x-auto rounded-xl border border-white/[0.08] bg-black/20 px-3 py-3 shadow-inner custom-scrollbar">
      {children}
    </pre>
  ),
  blockquote: ({ children }: any) => (
    <blockquote className="my-2 border-l-2 border-white/[0.12] pl-3 text-theme-fg/70 italic">
      {children}
    </blockquote>
  ),
};

const MarkdownContent: React.FC<{ content: string; className?: string }> = ({ content, className }) => {
  const trimmed = content.trim();
  if (!trimmed) return null;

  return (
    <div className={clsx('markdown-body break-words text-theme-fg/85', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
        {trimmed}
      </ReactMarkdown>
    </div>
  );
};

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
        'group relative flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-semibold transition-all whitespace-nowrap border backdrop-blur-md',
        isActive
          ? `bg-white/[0.08] border-white/[0.12] shadow-[0_10px_30px_-18px_rgba(15,23,42,0.9)] ${cfg.color}`
          : 'bg-transparent border-transparent text-theme-muted hover:text-theme-fg hover:bg-white/[0.05]'
      )}
    >
      <Icon
        className={clsx(
          'w-3 h-3 shrink-0',
          task.status === 'running' && 'animate-[pulse_1.5s_ease-in-out_infinite]',
          isActive ? cfg.color : 'text-theme-muted group-hover:text-theme-fg'
        )}
      />
      <span className="truncate max-w-[120px]">{truncate(task.objective, 24)}</span>
      {task.status !== 'running' && (
        <span
          onClick={onDismiss}
          className="ml-1 p-0.5 rounded hover:bg-theme-active opacity-0 group-hover:opacity-100 transition-opacity text-theme-muted hover:text-red-500"
          role="button"
          aria-label="Dismiss"
        >
          <X className="w-3 h-3" />
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
    <div className={clsx(
      'relative rounded-2xl border border-white/[0.06] bg-white/[0.03] px-3.5 py-3 shadow-[0_10px_40px_-24px_rgba(15,23,42,0.8)] backdrop-blur-md',
      isLive && 'border-blue-500/20 bg-blue-500/[0.05]'
    )}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <Brain className={clsx('w-3 h-3', isLive ? 'text-blue-500 animate-pulse' : 'text-theme-muted')} />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-theme-muted">
          {isLive ? 'Thinking' : 'Reasoning'}
        </span>
        {isLive && (
          <span className="flex items-center gap-1">
            <span className="w-1 h-1 rounded-full bg-blue-500 animate-ping" />
            <span className="w-1 h-1 rounded-full bg-blue-500 animate-ping [animation-delay:0.15s]" />
            <span className="w-1 h-1 rounded-full bg-blue-500 animate-ping [animation-delay:0.3s]" />
          </span>
        )}
      </div>
      <div
        className={clsx(
          'max-h-[220px] overflow-y-auto custom-scrollbar pr-1 text-[12px] leading-relaxed',
          isLive && 'border-l border-blue-500/30 pl-3'
        )}
      >
        {isTruncated && (
          <button
            onClick={() => setExpanded(true)}
            className="text-[10px] text-blue-500/70 hover:text-blue-500 mb-1 block"
          >
            …show earlier reasoning
          </button>
        )}
        <MarkdownContent content={displayText} className="text-[12.5px] leading-relaxed" />
        {isLive && <span className="inline-block w-1.5 h-3 bg-blue-500/60 animate-[blink_1s_steps(2)_infinite] ml-0.5 align-middle" />}
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
    <div className="flex items-center gap-1.5 flex-wrap">
      {grouped.map((item, i) => {
        const TIcon = toolIcon(item.name);
        const isActive = item.status === 'running';
        return (
          <span
            key={`${item.name}-${i}`}
            className={clsx(
              'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-medium border transition-all shadow-sm backdrop-blur-md',
              isActive
                ? 'bg-blue-500/10 border-blue-500/20 text-blue-600 dark:text-blue-400'
                : 'bg-white/[0.04] border-white/[0.07] text-theme-muted hover:text-theme-fg hover:border-white/[0.12]'
            )}
            title={item.name}
          >
            {isActive ? (
              <Loader2 className="w-2.5 h-2.5 animate-spin" />
            ) : (
              <TIcon className="w-2.5 h-2.5" />
            )}
            <span className="truncate max-w-[100px]">{item.name.replace(/_/g, ' ')}</span>
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
    <div className="px-5 py-4 space-y-5">
      <div className="flex items-start gap-4">
        <div className={clsx(
          'mt-0.5 p-2 rounded-xl shrink-0 border shadow-sm backdrop-blur-md',
          task.status === 'running' ? 'bg-blue-500/10 border-blue-500/20' : 'bg-white/[0.05] border-white/[0.08]'
        )}>
          <Sparkles className={clsx('w-4 h-4', cfg.color)} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-theme-fg leading-snug line-clamp-2">
            {task.objective}
          </p>
          <div className="flex items-center gap-3 mt-2.5">
            <span className={clsx(
              'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider border shadow-sm',
              cfg.color, cfg.bg, cfg.border
            )}>
              <Icon className={clsx('w-2.5 h-2.5', task.status === 'running' && 'animate-[pulse_1.5s_ease-in-out_infinite]')} />
              {cfg.label}
            </span>
            <span className="flex items-center gap-1.5 text-[10px] text-theme-muted font-medium bg-white/[0.05] px-2 py-0.5 rounded-md border border-white/[0.08] shadow-sm backdrop-blur-md">
              <Cpu className="w-2.5 h-2.5" />
              {task.model}
            </span>
            {logs.length > 0 && (
              <span className="text-[10px] text-theme-muted font-medium bg-white/[0.04] border border-white/[0.06] rounded-md px-2 py-0.5 backdrop-blur-md">
                {getToolLogs(logs).length} tools used
              </span>
            )}
            {elapsed > 0 && task.status !== 'running' && (
              <span className="text-[10px] text-theme-muted flex items-center gap-1 font-medium bg-white/[0.04] border border-white/[0.06] rounded-md px-2 py-0.5 backdrop-blur-md">
                <Clock className="w-2.5 h-2.5" />
                {formatDuration(elapsed)}
              </span>
            )}
          </div>
        </div>
      </div>

      {task.status === 'running' && (
        <div className="h-[2px] bg-theme-border overflow-hidden relative rounded-full mx-1">
          <div className="absolute top-0 bottom-0 w-1/3 bg-blue-500/60 animate-[shimmer_2s_infinite_linear]" />
        </div>
      )}

      {reasoning && (
        <ReasoningPanel text={reasoning} isLive={task.status === 'running'} />
      )}

      {logs.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2.5">
            <Eye className="w-3.5 h-3.5 text-theme-muted" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-theme-muted">Activity</span>
          </div>
          <ToolActivity logs={logs} />
        </div>
      )}

      {task.status === 'completed' && resultText && (
        <div className="relative pt-2">
          <div className="flex items-center gap-1.5 mb-2.5">
            <MessageSquare className="w-3.5 h-3.5 text-emerald-500" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Output</span>
          </div>
          <div className="bg-emerald-500/[0.07] border border-emerald-400/15 rounded-2xl p-4
            max-h-[250px] overflow-y-auto custom-scrollbar shadow-[0_10px_35px_-24px_rgba(16,185,129,0.45)] backdrop-blur-md">
            <MarkdownContent content={(typeof resultText === 'string' ? resultText : String(resultText)).slice(0, 2000)} className="text-[13px] leading-relaxed" />
          </div>
        </div>
      )}

      {task.status === 'failed' && resultText && (
        <div className="relative pt-2">
          <div className="flex items-center gap-1.5 mb-2.5">
            <XCircle className="w-3.5 h-3.5 text-red-500" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-red-600 dark:text-red-400">Error</span>
          </div>
          <div className="text-red-700 dark:text-red-300 bg-red-500/[0.07] border border-red-400/15 rounded-2xl p-4
            max-h-[150px] overflow-y-auto custom-scrollbar shadow-[0_10px_35px_-24px_rgba(239,68,68,0.45)] backdrop-blur-md">
            <MarkdownContent content={(typeof resultText === 'string' ? resultText : String(resultText)).slice(0, 1000)} className="text-[13px] leading-relaxed" />
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
        'mx-4 mb-4 rounded-2xl transition-all duration-300 overflow-hidden',
        'bg-theme-card/55 backdrop-blur-2xl border border-white/[0.08] shadow-[0_18px_60px_-30px_rgba(15,23,42,0.95)]',
        hasRunning
          ? 'border-blue-500/25 shadow-[0_16px_50px_-24px_rgba(59,130,246,0.32)]'
          : 'border-white/[0.08]'
      )}
    >
      <div className={clsx(
        "flex items-center gap-3 px-3 py-2 min-h-[48px] transition-colors",
        "bg-white/[0.03] border-b backdrop-blur-xl",
        hasRunning ? "border-blue-500/20" : "border-white/[0.06]"
      )}>
        <div className="flex items-center gap-2.5 shrink-0 pl-1">
          <div className={clsx(
            'p-1.5 rounded-lg border shadow-sm transition-colors backdrop-blur-md',
            hasRunning ? 'bg-blue-500/10 border-blue-500/20' : 'bg-white/[0.05] border-white/[0.08]'
          )}>
            <Sparkles className={clsx('w-4 h-4', hasRunning ? 'text-blue-500' : 'text-theme-muted')} />
          </div>
          {runningCount > 0 && (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 text-[10px] font-bold tracking-wide uppercase shadow-sm backdrop-blur-md">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-500 opacity-60" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
              </span>
              {runningCount} active
            </span>
          )}
        </div>

        <div className="flex-1 min-w-0 overflow-x-auto scrollbar-hidden">
          <div className="flex items-center gap-1.5 px-1 py-1">
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

        <div className="flex items-center gap-1 shrink-0 ml-2 pr-1">
          <button
            onClick={refresh}
            className="p-1.5 rounded-md hover:bg-white/[0.06] text-theme-muted hover:text-theme-fg transition-colors"
            title="Refresh"
          >
            <RefreshCw className={clsx('w-4 h-4', loading && 'animate-spin')} />
          </button>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-1.5 rounded-md hover:bg-white/[0.06] text-theme-muted hover:text-theme-fg transition-colors"
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="p-1.5 rounded-md hover:bg-white/[0.06] text-theme-muted hover:text-red-500 transition-colors"
            title="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {!collapsed && activeTask && (
        <div className="bg-white/[0.02] backdrop-blur-xl">
          <TaskDetail task={activeTask} />
        </div>
      )}
    </div>
  );
};

export const SubagentDashboard = memo(SubagentDashboardInner);
