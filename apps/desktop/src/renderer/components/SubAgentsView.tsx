import React, { useEffect, useState, useMemo } from "react";
import {
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronRight,
  Terminal,
  Cpu,
  RefreshCw,
  Filter
} from "lucide-react";
import { clsx } from 'clsx';
import { SubAgentDetails } from "./SubAgentDetails";
import { useModelRegistry } from '../hooks/useModelRegistry';
import { ContextUsageIndicator } from './ContextUsageIndicator';
import { buildContextUsageMetrics } from '../utils/contextUsage';

const AGENT_HTTP = (window as any).__AGENT_HTTP__ || "http://127.0.0.1:8765";

interface SubAgentTask {
  id: string;
  parent_id?: string;
  objective: string;
  status: 'running' | 'completed' | 'failed';
  model: string;
  created_at: string;
  updated_at: string;
  logs: any[];
  result?: any;
}

interface SubAgentsViewProps {
  // Optional: if we want to filter by parent conversation
  parentId?: string;
  compact?: boolean;
}

type FilterType = 'all' | 'running' | 'completed' | 'failed';

export const SubAgentsView: React.FC<SubAgentsViewProps> = ({ parentId, compact }) => {
  const { modelById } = useModelRegistry();
  const [tasks, setTasks] = useState<SubAgentTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedTask, setSelectedTask] = useState<SubAgentTask | null>(null);
  const [filter, setFilter] = useState<FilterType>('all');

  const fetchTasks = async () => {
    setLoading(true);
    try {
      let url = `${AGENT_HTTP}/v1/subagents/list?limit=50`;
      if (parentId) url += `&parent_id=${parentId}`;

      const res = await fetch(url);
      const data = await res.json();

      if (data.ok && Array.isArray(data.tasks)) {
        setTasks(data.tasks);
      }
    } catch (err) {
      console.error("Failed to fetch subagents", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
    // Poll every 3 seconds for updates if any are running
    const interval = setInterval(() => {
      setTasks(prev => {
        const hasRunning = prev.some(t => t.status === 'running');
        if (hasRunning) fetchTasks();
        return prev;
      });
    }, 3000);
    return () => clearInterval(interval);
  }, [parentId]);

  const filteredTasks = useMemo(() => {
    let t = [...tasks];
    if (filter !== 'all') {
      t = t.filter(task => task.status === filter);
    }
    // Sort: Running first, then new to old
    return t.sort((a, b) => {
      if (a.status === 'running' && b.status !== 'running') return -1;
      if (a.status !== 'running' && b.status === 'running') return 1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [tasks, filter]);

  // If a task is selected, show details
  if (selectedTask) {
    return (
      <SubAgentDetails
        task={selectedTask}
        onBack={() => setSelectedTask(null)}
        compact={compact}
        onUpdate={(updated) => {
          setTasks(prev => prev.map(t => t.id === updated.id ? updated : t));
          setSelectedTask(updated);
        }}
      />
    );
  }

  const FilterButton = ({ type, label }: { type: FilterType, label: string }) => (
    <button
      onClick={() => setFilter(type)}
      className={clsx(
        "px-3 py-1.5 rounded-full text-xs font-medium transition-all border",
        filter === type
          ? "bg-theme-fg text-theme-bg border-theme-fg"
          : "text-theme-muted hover:text-theme-fg border-transparent hover:bg-theme-hover"
      )}
    >
      {label}
    </button>
  );

  return (
    <div className={clsx("flex flex-col h-full", compact ? "px-2 pt-2" : "pb-12 mx-auto max-w-5xl w-full")}>
      {/* Header */}
      <div className={clsx("flex-none", compact ? "mb-4" : "mb-8 space-y-6")}>
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <h2 className={clsx("font-stuard text-theme-fg tracking-tight", compact ? "text-lg" : "text-2xl")}>
              Agent Tasks
            </h2>
            {!compact && (
              <p className="text-theme-muted text-sm font-medium">
                Autonomous sub-agents performing background work.
              </p>
            )}
          </div>
          <button
            onClick={fetchTasks}
            className="p-2 rounded-lg hover:bg-theme-hover text-theme-muted hover:text-theme-fg transition-all border border-transparent hover:border-theme"
            title="Refresh Tasks"
          >
            <RefreshCw className={clsx("w-4 h-4", loading && "animate-spin")} />
          </button>
        </div>

        {/* Filters */}
        {!compact && (
          <div className="flex items-center gap-1 border-b border-theme/50 pb-4">
            <Filter className="w-3.5 h-3.5 text-theme-muted mr-2" />
            <FilterButton type="all" label="All" />
            <FilterButton type="running" label="Running" />
            <FilterButton type="completed" label="Completed" />
            <FilterButton type="failed" label="Failed" />
            <div className="ml-auto text-xs text-theme-muted font-mono">
              {filteredTasks.length} tasks
            </div>
          </div>
        )}
      </div>

      {/* List */}
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        {filteredTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 px-4 text-center mt-8">
            <h3 className="text-base font-semibold text-theme-fg mb-2">
              {filter === 'all' ? "No agent tasks found" : `No ${filter} tasks`}
            </h3>
            <p className="text-sm text-theme-muted max-w-xs font-medium leading-relaxed">
              {filter === 'all'
                ? "Sub-agents spawned by your workflows or chat will appear here."
                : `There are no sub-agents currently in the '${filter}' state.`}
            </p>
          </div>
        ) : (
          <div className={clsx("grid gap-3 pb-8", compact ? "grid-cols-1" : "grid-cols-1")}>
            {filteredTasks.map(task => (
              <TaskCard
                key={task.id}
                task={task}
                onClick={() => setSelectedTask(task)}
                compact={compact}
                modelById={modelById}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const TaskCard = ({
  task,
  onClick,
  compact,
  modelById,
}: {
  task: SubAgentTask;
  onClick: () => void;
  compact?: boolean;
  modelById?: Map<string, any>;
}) => {
  const statusConfig = {
    running: {
      icon: Loader2,
      color: "text-blue-500",
      bg: "bg-blue-500/10",
      border: "border-blue-500/20",
      label: "Running"
    },
    completed: {
      icon: CheckCircle2,
      color: "text-emerald-500",
      bg: "bg-emerald-500/10",
      border: "border-emerald-500/20",
      label: "Completed"
    },
    failed: {
      icon: XCircle,
      color: "text-red-500",
      bg: "bg-red-500/10",
      border: "border-red-500/20",
      label: "Failed"
    }
  }[task.status] || {
    icon: Clock,
    color: "text-theme-muted",
    bg: "bg-theme-bg",
    border: "border-theme-border",
    label: task.status
  };

  const StatusIcon = statusConfig.icon;
  const contextMetrics = useMemo(() => buildContextUsageMetrics({
    usage: task.result?.usage,
    modelId: task.model,
    modelById,
  }), [modelById, task.model, task.result?.usage]);

  return (
    <div
      onClick={onClick}
      className={clsx(
        "group relative bg-theme-card rounded-xl border transition-all cursor-pointer overflow-hidden",
        "hover:border-theme-fg/30 hover:shadow-md",
        task.status === 'running' ? "border-blue-500/30 shadow-[0_0_15px_-3px_rgba(59,130,246,0.1)]" : "border-theme shadow-sm",
        compact ? "p-3" : "p-4"
      )}
    >
      {/* Progress Bar for Running */}
      {task.status === 'running' && (
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-blue-500/20 overflow-hidden">
          <div className="h-full bg-blue-500/60 w-1/3 animate-[shimmer_2s_infinite_linear]" />
        </div>
      )}

      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0 py-0.5">
          {/* Header Row */}
          <div className="flex items-center gap-2 mb-1.5">
            <span className={clsx(
              "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border shadow-sm",
              statusConfig.color, statusConfig.bg, statusConfig.border
            )}>
              <StatusIcon className={clsx("w-3 h-3", task.status === 'running' && "animate-[pulse_1.5s_ease-in-out_infinite]")} />
              {statusConfig.label}
            </span>

            <span className="text-[10px] text-theme-muted font-mono flex items-center gap-1 opacity-70 bg-theme-bg px-2 py-0.5 rounded-md border border-theme-border shadow-sm">
              <Cpu className="w-3 h-3" />
              {task.model}
            </span>
            <ContextUsageIndicator metrics={contextMetrics} compact />

            <span className="text-[10px] text-theme-muted ml-auto font-medium opacity-60">
              {new Date(task.created_at).toLocaleString(undefined, {
                month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
              })}
            </span>
          </div>

          <h3 className={clsx(
            "font-semibold text-theme-fg leading-snug group-hover:text-primary transition-colors",
            compact ? "text-sm line-clamp-1" : "text-base line-clamp-2"
          )}>
            {task.objective}
          </h3>

          <div className="flex items-center gap-4 mt-2 text-[11px] text-theme-muted/80">
            <span className="flex items-center gap-1.5 hover:text-theme-fg transition-colors">
              <Terminal className="w-3 h-3" />
              {task.logs?.length || 0} activities
            </span>
            {task.status !== 'running' && (
              <span className="flex items-center gap-1.5 opacity-60">
                <Clock className="w-3 h-3" />
                {Math.round((new Date(task.updated_at).getTime() - new Date(task.created_at).getTime()) / 1000)}s
              </span>
            )}
          </div>
        </div>

        <div className="self-center opacity-0 group-hover:opacity-100 transition-all transform translate-x-2 group-hover:translate-x-0">
          <ChevronRight className="w-5 h-5 text-theme-muted" />
        </div>
      </div>
    </div>
  );
};
