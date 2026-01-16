import React, { useEffect, useState } from "react";
import { 
  Bot, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  Loader2, 
  ChevronRight, 
  Terminal, 
  Cpu,
  RefreshCw
} from "lucide-react";
import { clsx } from 'clsx';
import { SubAgentDetails } from "./SubAgentDetails";

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

export const SubAgentsView: React.FC<SubAgentsViewProps> = ({ parentId, compact }) => {
  const [tasks, setTasks] = useState<SubAgentTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedTask, setSelectedTask] = useState<SubAgentTask | null>(null);

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
    // Poll every 5 seconds for updates if any are running
    const interval = setInterval(() => {
        // We could optimize this to only poll if we see running tasks or user requests it
        // For now, let's just refresh if there are running tasks
        setTasks(prev => {
            const hasRunning = prev.some(t => t.status === 'running');
            if (hasRunning) fetchTasks(); 
            return prev;
        });
    }, 5000);
    return () => clearInterval(interval);
  }, [parentId]);

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

  return (
    <div className={clsx("pb-12 mx-auto", compact ? "w-full px-2 pt-2" : "max-w-5xl")}>
      {/* Header */}
      <div className={clsx("flex items-center justify-between", compact ? "mb-4" : "mb-8")}>
        <div className="space-y-1">
          <h2 className={clsx("font-stuard text-theme-fg tracking-tight", compact ? "text-xl" : "text-3xl")}>Tasks</h2>
          {!compact && (
            <p className="text-theme-muted text-sm font-medium">
              Autonomous sub-agents running in the background.
            </p>
          )}
        </div>
        <button
          onClick={fetchTasks}
          className="p-2 rounded-theme-button hover:bg-theme-hover text-theme-muted hover:text-theme-fg transition-all border border-transparent hover:border-theme"
          title="Refresh Tasks"
        >
          <RefreshCw className={clsx("w-4 h-4", loading && "animate-spin")} />
        </button>
      </div>

      {/* List */}
      <div className="space-y-4">
        {tasks.length === 0 && !loading ? (
          <div className="flex flex-col items-center justify-center py-20 px-4 text-center bg-theme-card rounded-theme-card border border-theme border-dashed">
            <div className="w-16 h-16 bg-theme-hover rounded-full flex items-center justify-center mb-4 shadow-sm border border-theme">
              <Bot className="w-8 h-8 text-theme-muted" />
            </div>
            <h3 className="text-sm font-semibold text-theme-fg mb-1">No tasks found</h3>
            <p className="text-xs text-theme-muted max-w-xs font-medium">
              Sub-agents spawned by your workflows or chat will appear here.
            </p>
          </div>
        ) : (
          <div className="grid gap-3">
            {tasks.map(task => (
              <TaskCard 
                key={task.id} 
                task={task} 
                onClick={() => setSelectedTask(task)} 
                compact={compact}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const TaskCard = ({ task, onClick, compact }: { task: SubAgentTask; onClick: () => void; compact?: boolean }) => {
  const getStatusColor = (s: string) => {
    switch (s) {
      case 'running': return 'text-amber-400 bg-amber-400/10 border-amber-400/20';
      case 'completed': return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20';
      case 'failed': return 'text-red-400 bg-red-400/10 border-red-400/20';
      default: return 'text-slate-400 bg-slate-400/10 border-slate-400/20';
    }
  };

  const getStatusIcon = (s: string) => {
    switch (s) {
      case 'running': return <Loader2 className="w-3.5 h-3.5 animate-spin" />;
      case 'completed': return <CheckCircle2 className="w-3.5 h-3.5" />;
      case 'failed': return <XCircle className="w-3.5 h-3.5" />;
      default: return <Clock className="w-3.5 h-3.5" />;
    }
  };

  return (
    <div 
      onClick={onClick}
      className={clsx(
        "group relative bg-theme-card rounded-xl border border-theme shadow-sm hover:border-primary/50 hover:shadow-md transition-all cursor-pointer",
        compact ? "p-3" : "p-4"
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className={clsx(
            "rounded-lg flex items-center justify-center shrink-0 border transition-colors",
            compact ? "w-8 h-8" : "w-10 h-10",
            task.status === 'running' ? "bg-amber-500/10 border-amber-500/20" : "bg-theme-hover border-theme"
          )}>
            <Bot className={clsx(compact ? "w-4 h-4" : "w-5 h-5", task.status === 'running' ? "text-amber-500" : "text-theme-muted")} />
          </div>
          
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <span className={clsx(
                "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border",
                getStatusColor(task.status)
              )}>
                {getStatusIcon(task.status)}
                {task.status}
              </span>
              <span className="text-[10px] text-theme-muted font-mono flex items-center gap-1">
                <Cpu className="w-3 h-3" />
                {task.model}
              </span>
              <span className="text-[10px] text-theme-muted ml-auto font-medium">
                {new Date(task.created_at).toLocaleTimeString()}
              </span>
            </div>
            
            <h3 className="text-sm font-semibold text-theme-fg line-clamp-1 leading-snug">
              {task.objective}
            </h3>
            
            <div className="flex items-center gap-4 text-[11px] text-theme-muted">
              <span className="flex items-center gap-1.5">
                <Terminal className="w-3 h-3" />
                {task.logs?.length || 0} logs
              </span>
            </div>
          </div>
        </div>

        <div className="self-center opacity-0 group-hover:opacity-100 transition-opacity -mr-2">
            <ChevronRight className="w-5 h-5 text-theme-muted" />
        </div>
      </div>
    </div>
  );
};
