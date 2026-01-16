import React, { useEffect, useRef, useState } from "react";
import { 
  ArrowLeft, 
  Bot, 
  CheckCircle2, 
  Clock, 
  Cpu, 
  Terminal, 
  XCircle, 
  Loader2,
  ChevronDown,
  ChevronRight,
  Maximize2,
  Minimize2
} from "lucide-react";
import { clsx } from 'clsx';
import ReactMarkdown from 'react-markdown';

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

interface SubAgentDetailsProps {
  task: SubAgentTask;
  onBack: () => void;
  onUpdate: (task: SubAgentTask) => void;
  compact?: boolean;
}

const LogItem = ({ log }: { log: any }) => {
  const [expanded, setExpanded] = useState(false);

  // Styling based on log type
  let colorClass = "text-slate-300";
  let Icon = Terminal;
  
  if (log.type === 'tool_call') {
    colorClass = "text-blue-300";
    Icon = Bot;
  } else if (log.type === 'tool_result') {
    colorClass = "text-emerald-300";
    Icon = CheckCircle2;
  } else if (log.type === 'tool_event') {
    colorClass = "text-amber-300";
    Icon = Loader2;
  } else if (log.error) {
    colorClass = "text-red-300";
    Icon = XCircle;
  }

  const timestamp = log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : '';

  return (
    <div className="group">
      <div 
        className={clsx("flex items-start gap-2.5", colorClass, "cursor-pointer hover:bg-white/5 -mx-2 px-2 py-1 rounded")}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-[10px] text-slate-600 mt-0.5 min-w-[50px]">{timestamp}</span>
        <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <div className="flex-1 break-words overflow-hidden">
            <div className="flex items-center gap-2">
                <span className="font-bold text-[11px] opacity-80 uppercase tracking-wider">
                    {log.tool || log.type}
                </span>
                {log.type === 'tool_call' && log.tool && (
                    <span className="opacity-60 text-[10px]">Calling...</span>
                )}
            </div>
            
            {/* Short preview for tool calls/results */}
            {!expanded && (log.args || log.result) && (
                <div className="opacity-60 text-[11px] truncate mt-0.5 font-sans">
                    {JSON.stringify(log.args || log.result)}
                </div>
            )}
        </div>
        <div className={clsx("opacity-0 group-hover:opacity-100 transition-opacity", expanded && "rotate-90")}>
            <ChevronRight className="w-3.5 h-3.5" />
        </div>
      </div>

      {expanded && (
        <div className="pl-[70px] pr-2 py-2 text-slate-400">
           <pre className="bg-black/30 p-2 rounded border border-white/5 overflow-x-auto text-[10px] leading-relaxed">
             {JSON.stringify(log.args || log.result || log, null, 2)}
           </pre>
        </div>
      )}
    </div>
  );
};

export const SubAgentDetails: React.FC<SubAgentDetailsProps> = ({ task, onBack, onUpdate, compact }) => {
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [activeTab, setActiveTab] = useState<'logs' | 'result'>('logs');

  const fetchDetails = async () => {
    try {
      const res = await fetch(`${AGENT_HTTP}/v1/subagents/${task.id}`);
      const data = await res.json();
      if (data.ok && data.task) {
        onUpdate(data.task);
      }
    } catch (err) {
      console.error("Failed to refresh task details", err);
    }
  };

  useEffect(() => {
    // Poll for updates if running
    if (task.status === 'running') {
      const interval = setInterval(fetchDetails, 2000); // 2s polling for live logs
      return () => clearInterval(interval);
    }
  }, [task.status, task.id]);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [task.logs, autoScroll]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isAtBottom);
  };

  const getStatusColor = (s: string) => {
    switch (s) {
      case 'running': return 'text-amber-400 bg-amber-400/10 border-amber-400/20';
      case 'completed': return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20';
      case 'failed': return 'text-red-400 bg-red-400/10 border-red-400/20';
      default: return 'text-slate-400 bg-slate-400/10 border-slate-400/20';
    }
  };

  return (
    <div className="flex flex-col h-full bg-theme-card rounded-xl border border-theme shadow-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200">
      {/* Header */}
      <div className="flex items-center gap-4 p-4 border-b border-theme bg-theme-bg/50">
        <button 
          onClick={onBack}
          className="p-2 -ml-2 rounded-full hover:bg-theme-hover text-theme-muted hover:text-theme-fg transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={clsx(
              "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border",
              getStatusColor(task.status)
            )}>
              {task.status === 'running' && <Loader2 className="w-3 h-3 animate-spin" />}
              {task.status === 'completed' && <CheckCircle2 className="w-3 h-3" />}
              {task.status === 'failed' && <XCircle className="w-3 h-3" />}
              {task.status}
            </span>
            <span className="text-[10px] text-theme-muted font-mono flex items-center gap-1">
              <Cpu className="w-3 h-3" />
              {task.model}
            </span>
            <span className="text-[10px] text-theme-muted ml-auto font-medium">
              ID: {task.id.slice(0, 8)}
            </span>
          </div>
          <h2 className="text-sm font-bold text-theme-fg line-clamp-1">{task.objective}</h2>
        </div>
      </div>

      {/* Content */}
      <div className={clsx("flex-1 overflow-hidden flex", compact ? "flex-col" : "flex-col md:flex-row")}>
        
        {/* Compact Tabs */}
        {compact && (
          <div className="flex items-center border-b border-theme bg-theme-bg/30">
            <button
              onClick={() => setActiveTab('logs')}
              className={clsx(
                "flex-1 py-2 text-xs font-medium border-b-2 transition-colors",
                activeTab === 'logs' ? "border-primary text-primary" : "border-transparent text-theme-muted hover:text-theme-fg"
              )}
            >
              Logs ({task.logs.length})
            </button>
            <button
              onClick={() => setActiveTab('result')}
              className={clsx(
                "flex-1 py-2 text-xs font-medium border-b-2 transition-colors",
                activeTab === 'result' ? "border-primary text-primary" : "border-transparent text-theme-muted hover:text-theme-fg"
              )}
            >
              Result
            </button>
          </div>
        )}

        {/* Logs Console */}
        {(!compact || activeTab === 'logs') && (
          <div className={clsx("flex-1 flex flex-col min-w-0", !compact && "border-r border-theme")}>
            {!compact && (
              <div className="flex items-center justify-between px-4 py-2 bg-black/20 border-b border-theme">
                <div className="flex items-center gap-2 text-xs font-mono text-theme-muted">
                  <Terminal className="w-3.5 h-3.5" />
                  <span>Console Output</span>
                </div>
                <span className="text-[10px] text-theme-muted">{task.logs.length} events</span>
              </div>
            )}
            
            <div 
              ref={scrollRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto p-4 space-y-3 font-mono text-xs bg-[#0d1117]"
            >
              {task.logs.length === 0 ? (
                <div className="text-theme-muted/50 italic text-center py-10">Waiting for logs...</div>
              ) : (
                task.logs.map((log, i) => (
                  <LogItem key={i} log={log} />
                ))
              )}
              {task.status === 'running' && (
                <div className="flex items-center gap-2 text-amber-500/50 animate-pulse pt-2">
                  <span className="w-2 h-4 bg-amber-500/50 block" />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Result / Summary Panel */}
        {(!compact || activeTab === 'result') && (
          <div className={clsx("flex flex-col bg-theme-bg/30", compact ? "flex-1" : "w-full md:w-[400px]")}>
            {!compact && (
              <div className="flex items-center gap-2 px-4 py-3 border-b border-theme font-semibold text-xs text-theme-fg uppercase tracking-wider">
                <Bot className="w-4 h-4" />
                Result & Reasoning
              </div>
            )}
            
            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              {task.result ? (
                <div className="space-y-4">
                  {task.result.text && (
                    <div className="prose prose-invert prose-sm max-w-none">
                      <ReactMarkdown>{task.result.text}</ReactMarkdown>
                    </div>
                  )}
                  {task.result.error && (
                    <div className="p-3 rounded bg-red-500/10 border border-red-500/20 text-red-200 text-xs">
                      <div className="font-bold mb-1">Error:</div>
                      {task.result.error}
                    </div>
                  )}
                  <div className="text-[10px] text-theme-muted pt-4 border-t border-theme">
                    Finished at {new Date(task.updated_at).toLocaleString()}
                    {task.result.finishReason && ` • Reason: ${task.result.finishReason}`}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-theme-muted text-sm gap-2">
                  {task.status === 'running' ? (
                    <>
                      <Loader2 className="w-6 h-6 animate-spin text-primary" />
                      <span>Working on task...</span>
                    </>
                  ) : (
                    <span>No result output.</span>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
