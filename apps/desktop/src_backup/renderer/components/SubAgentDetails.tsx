import React, { useEffect, useRef, useState, useMemo } from "react";
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
  Minimize2,
  LayoutList,
  FileText,
  Activity,
  Search,
  Globe,
  Code
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

// --- Types for Trace Visualization ---

interface TraceStep {
  id: string;
  type: 'tool' | 'parallel_group' | 'reasoning' | 'system';
  name: string;
  status: 'running' | 'completed' | 'failed';
  input?: any;
  output?: any;
  error?: string;
  timestamp: string;
  duration?: string;
  children?: TraceStep[]; // For parallel groups
}

// --- Helper Components ---

const StatusIcon = ({ status, className }: { status: string, className?: string }) => {
  switch (status) {
    case 'running': return <Loader2 className={clsx("animate-spin", className)} />;
    case 'completed': return <CheckCircle2 className={clsx("text-emerald-500", className)} />;
    case 'failed': return <XCircle className={clsx("text-red-500", className)} />;
    default: return <Clock className={clsx("text-slate-400", className)} />;
  }
};

const CodeBlock = ({ data, label }: { data: any, label?: string }) => (
  <div className="mt-2 text-xs font-mono">
    {label && <div className="text-[10px] uppercase tracking-wider text-theme-muted mb-1">{label}</div>}
    <div className="bg-black/30 rounded border border-white/5 p-2 overflow-x-auto custom-scrollbar">
      <pre className="text-theme-muted/80 whitespace-pre-wrap break-all">
        {typeof data === 'string' ? data : JSON.stringify(data, null, 2)}
      </pre>
    </div>
  </div>
);

// --- Trace View Component ---

const TraceItem = ({ step }: { step: TraceStep }) => {
  const [expanded, setExpanded] = useState(step.status === 'failed' || step.status === 'running');
  
  // Icon based on tool/step type
  let StepIcon = Activity;
  if (step.name.includes('web_search')) StepIcon = Globe;
  else if (step.name.includes('code')) StepIcon = Code;
  else if (step.name === 'RUN_PARALLEL') StepIcon = LayoutList;

  return (
    <div className="relative pl-6 pb-6 last:pb-0">
      {/* Timeline Line */}
      <div className="absolute left-2.5 top-8 bottom-0 w-px bg-theme-border" />
      
      {/* Step Header */}
      <div 
        className={clsx(
            "relative flex items-center gap-3 p-3 rounded-lg border transition-all cursor-pointer group select-none",
            step.status === 'running' ? "bg-theme-active border-theme-active-border" : "bg-theme-card border-theme hover:border-theme-hover"
        )}
        onClick={() => setExpanded(!expanded)}
      >
        {/* Status Bubble */}
        <div className={clsx(
            "absolute -left-[23px] w-5 h-5 rounded-full border flex items-center justify-center bg-theme-bg z-10",
            step.status === 'running' ? "border-amber-500 text-amber-500" :
            step.status === 'completed' ? "border-emerald-500 text-emerald-500" :
            step.status === 'failed' ? "border-red-500 text-red-500" : "border-theme-border text-theme-muted"
        )}>
            <StatusIcon status={step.status} className="w-3 h-3" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
                <StepIcon className="w-4 h-4 text-theme-muted" />
                <span className="font-semibold text-sm text-theme-fg">{step.name}</span>
                <span className="text-[10px] text-theme-muted ml-auto font-mono opacity-60">
                    {new Date(step.timestamp).toLocaleTimeString()}
                </span>
            </div>
            {/* Quick Preview */}
            {!expanded && step.input && (
                <div className="text-xs text-theme-muted truncate mt-1 pl-6 opacity-70 font-mono">
                    {JSON.stringify(step.input).slice(0, 60)}...
                </div>
            )}
        </div>
        
        <ChevronRight className={clsx("w-4 h-4 text-theme-muted transition-transform", expanded && "rotate-90")} />
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div className="mt-2 space-y-3 pl-2 animate-in fade-in slide-in-from-top-2 duration-200">
            {step.error && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded text-red-200 text-xs">
                    <div className="font-bold mb-1 flex items-center gap-2">
                        <XCircle className="w-3 h-3" /> Error
                    </div>
                    {step.error}
                </div>
            )}

            {step.input && <CodeBlock data={step.input} label="Input" />}
            
            {step.children && (
                <div className="space-y-4 mt-4 border-l-2 border-theme-border/50 pl-4">
                    {step.children.map(child => (
                        <TraceItem key={child.id} step={child} />
                    ))}
                </div>
            )}

            {step.output && <CodeBlock data={step.output} label="Result" />}
        </div>
      )}
    </div>
  );
};

const TraceView = ({ logs }: { logs: any[] }) => {
  // Parse logs into structured trace
  const trace = useMemo(() => {
    const steps: TraceStep[] = [];
    
    // 1. Check for structured "Trace" events first (RUN_PARALLEL with steps)
    // The user's logs show: {"steps": [...]} in a log entry
    
    let hasStructuredSteps = false;

    logs.forEach((log, index) => {
        const timestamp = log.timestamp || new Date().toISOString();
        const id = `step-${index}`;

        // Case A: High-level Step Groups (from user logs)
        if (log.args && log.args.steps && Array.isArray(log.args.steps)) {
            hasStructuredSteps = true;
            // Create a parent step for the group
            const groupStep: TraceStep = {
                id: `group-${index}`,
                type: 'parallel_group',
                name: 'Parallel Execution Group',
                status: 'completed', // Assume completed if logged? Or check next logs
                timestamp,
                input: { count: log.args.steps.length, mode: 'parallel' },
                children: log.args.steps.map((s: any, i: number) => ({
                    id: `sub-${index}-${i}`,
                    type: 'tool',
                    name: s.tool,
                    status: 'completed', // Default
                    input: s.args,
                    timestamp,
                    // Try to find matching result in subsequent logs?
                }))
            };
            
            // Try to find results for this group
            // Look ahead for "results" object with same structure or ID?
            // The user log shows: {"results": [...]} later
            
            // This is tricky without correlation IDs, but let's try to match by index or proximity
            // For now, push the group
            steps.push(groupStep);
        }
        
        // Case B: Result block for parallel execution
        else if (log.result && log.result.results && Array.isArray(log.result.results)) {
             // Find the last parallel group
             const lastGroup = steps.find(s => s.type === 'parallel_group' && !s.output);
             if (lastGroup && lastGroup.children) {
                 lastGroup.output = log.result;
                 // Update children with results
                 log.result.results.forEach((res: any, i: number) => {
                     if (lastGroup.children && lastGroup.children[i]) {
                         lastGroup.children[i].output = res;
                         if (res.ok === false) {
                             lastGroup.children[i].status = 'failed';
                             lastGroup.children[i].error = res.error;
                         } else {
                             lastGroup.children[i].status = 'completed';
                         }
                     }
                 });
             }
        }

        // Case C: Standard individual tool calls (if not handled by structured blocks)
        else if (!hasStructuredSteps && log.type === 'tool_call') {
            steps.push({
                id,
                type: 'tool',
                name: log.tool || 'Unknown Tool',
                status: 'running',
                input: log.args,
                timestamp
            });
        }
        else if (!hasStructuredSteps && log.type === 'tool_result') {
            const lastRunning = [...steps].reverse().find(s => s.status === 'running');
            if (lastRunning) {
                lastRunning.status = 'completed';
                lastRunning.output = log.result;
            }
        }
    });

    // Fallback: If no structured steps found, just map everything flat
    if (steps.length === 0 && logs.length > 0) {
        logs.forEach((log, index) => {
             if (log.type === 'tool_call') {
                 steps.push({
                    id: `s-${index}`,
                    type: 'tool',
                    name: log.tool || 'tool',
                    status: 'running',
                    input: log.args,
                    timestamp: log.timestamp || new Date().toISOString()
                 });
             } else if (log.type === 'tool_result') {
                 const match = [...steps].reverse().find(s => s.status === 'running');
                 if (match) {
                     match.status = 'completed';
                     match.output = log.result;
                 }
             }
        });
    }

    return steps;
  }, [logs]);

  if (trace.length === 0) {
    return (
        <div className="flex flex-col items-center justify-center h-64 text-theme-muted">
            <Activity className="w-8 h-8 mb-2 opacity-20" />
            <p className="text-sm opacity-50">No structured trace available.</p>
        </div>
    );
  }

  return (
    <div className="p-6 space-y-1 pb-20">
        {trace.map(step => (
            <TraceItem key={step.id} step={step} />
        ))}
    </div>
  );
};

// --- Logs View (Console) ---

const LogItem = ({ log }: { log: any }) => {
  const [expanded, setExpanded] = useState(false);
  const timestamp = log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : '';

  // Icon & Color
  let Icon = Terminal;
  let colorClass = "text-theme-muted";
  
  if (log.type === 'tool_call') {
    Icon = Bot;
    colorClass = "text-blue-400";
  } else if (log.type === 'tool_result') {
    Icon = CheckCircle2;
    colorClass = "text-emerald-400";
  } else if (log.error || (log.status === 'error')) {
    Icon = XCircle;
    colorClass = "text-red-400";
  }

  return (
    <div className="font-mono text-xs border-b border-theme-border/30 last:border-0">
        <div 
            className="flex items-start gap-3 p-2 hover:bg-white/5 cursor-pointer transition-colors"
            onClick={() => setExpanded(!expanded)}
        >
            <span className="text-theme-muted/50 shrink-0 min-w-[60px]">{timestamp}</span>
            <Icon className={clsx("w-3.5 h-3.5 mt-0.5 shrink-0", colorClass)} />
            <div className="flex-1 min-w-0 break-words">
                <div className="flex items-baseline gap-2">
                    <span className={clsx("font-bold uppercase tracking-wider text-[10px]", colorClass)}>
                        {log.tool || log.type}
                    </span>
                    <span className="text-theme-fg opacity-90">
                        {log.type === 'tool_call' ? 'Calling...' : 
                         log.type === 'tool_result' ? 'Completed' : 
                         JSON.stringify(log.message || log.args || log.result || '').slice(0, 100)}
                    </span>
                </div>
            </div>
        </div>
        {expanded && (
            <div className="px-12 pb-2">
                <div className="bg-black/30 p-2 rounded border border-white/5 overflow-x-auto text-[10px] custom-scrollbar">
                    <pre className="text-theme-muted">{JSON.stringify(log, null, 2)}</pre>
                </div>
            </div>
        )}
    </div>
  );
};

// --- Main Component ---

export const SubAgentDetails: React.FC<SubAgentDetailsProps> = ({ task, onBack, onUpdate, compact }) => {
  const [activeTab, setActiveTab] = useState<'trace' | 'logs' | 'result'>('trace');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-refresh
  useEffect(() => {
    if (task.status === 'running') {
      const interval = setInterval(async () => {
        try {
            const res = await fetch(`${AGENT_HTTP}/v1/subagents/${task.id}`);
            const data = await res.json();
            if (data.ok && data.task) onUpdate(data.task);
        } catch(e) { console.error(e); }
      }, 2000);
      return () => clearInterval(interval);
    }
  }, [task.status, task.id]);

  // Tab Button Helper
  const TabButton = ({ id, icon: Icon, label, count }: { id: typeof activeTab, icon: any, label: string, count?: number }) => (
    <button
      onClick={() => setActiveTab(id)}
      className={clsx(
        "flex items-center gap-2 px-4 py-3 text-xs font-medium border-b-2 transition-all relative",
        activeTab === id 
            ? "border-primary text-primary bg-primary/5" 
            : "border-transparent text-theme-muted hover:text-theme-fg hover:bg-theme-hover"
      )}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
      {count !== undefined && <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-theme-bg border border-theme-border text-[10px] text-theme-muted">{count}</span>}
    </button>
  );

  return (
    <div className="flex flex-col h-full bg-theme-card rounded-xl border border-theme shadow-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200">
      
      {/* 1. Header Area */}
      <div className="flex flex-col border-b border-theme bg-theme-bg/50">
        {/* Top Bar */}
        <div className="flex items-center gap-3 p-3">
            <button 
                onClick={onBack}
                className="p-1.5 rounded-md hover:bg-theme-hover text-theme-muted hover:text-theme-fg transition-colors"
            >
                <ArrowLeft className="w-4 h-4" />
            </button>
            
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                    <span className={clsx(
                        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border",
                        task.status === 'running' ? "text-amber-500 bg-amber-500/10 border-amber-500/20" :
                        task.status === 'completed' ? "text-emerald-500 bg-emerald-500/10 border-emerald-500/20" :
                        "text-red-500 bg-red-500/10 border-red-500/20"
                    )}>
                        <StatusIcon status={task.status} className="w-3 h-3" />
                        {task.status}
                    </span>
                    <span className="text-[10px] text-theme-muted font-mono flex items-center gap-1 px-1.5 py-0.5 rounded bg-theme-bg border border-theme-border">
                        <Cpu className="w-3 h-3" />
                        {task.model}
                    </span>
                    <span className="text-[10px] text-theme-muted ml-auto font-mono opacity-50">
                        {task.id.slice(0, 8)}
                    </span>
                </div>
                <h2 className="text-sm font-bold text-theme-fg truncate" title={task.objective}>{task.objective}</h2>
            </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center px-2 bg-theme-bg/30">
            <TabButton id="trace" icon={LayoutList} label="Trace" />
            <TabButton id="logs" icon={Terminal} label="Logs" count={task.logs.length} />
            <TabButton id="result" icon={FileText} label="Result" />
        </div>
      </div>

      {/* 2. Main Content Area */}
      <div className="flex-1 overflow-hidden relative bg-[#0d1117]">
        
        {/* Trace View */}
        {activeTab === 'trace' && (
            <div className="absolute inset-0 overflow-y-auto custom-scrollbar">
                <TraceView logs={task.logs} />
            </div>
        )}

        {/* Logs View */}
        {activeTab === 'logs' && (
            <div className="absolute inset-0 overflow-y-auto custom-scrollbar flex flex-col p-0">
                {task.logs.length === 0 ? (
                    <div className="m-auto text-theme-muted/50 italic">No logs available</div>
                ) : (
                    task.logs.map((log, i) => <LogItem key={i} log={log} />)
                )}
            </div>
        )}

        {/* Result View */}
        {activeTab === 'result' && (
            <div className="absolute inset-0 overflow-y-auto custom-scrollbar p-6">
                {task.result ? (
                    <div className="max-w-3xl mx-auto space-y-6">
                         {/* Result Content */}
                         {task.result.text ? (
                            <div className="prose prose-invert prose-sm max-w-none">
                                <ReactMarkdown>{task.result.text}</ReactMarkdown>
                            </div>
                         ) : (
                            <div className="p-4 rounded border border-theme-border bg-theme-bg text-theme-muted text-sm text-center">
                                No text output generated.
                            </div>
                         )}
                         
                         {/* Metadata Footer */}
                         <div className="pt-6 mt-6 border-t border-theme-border grid grid-cols-2 gap-4 text-xs text-theme-muted">
                            <div>
                                <div className="uppercase tracking-wider opacity-50 mb-1">Created</div>
                                {new Date(task.created_at).toLocaleString()}
                            </div>
                            <div>
                                <div className="uppercase tracking-wider opacity-50 mb-1">Finished</div>
                                {new Date(task.updated_at).toLocaleString()}
                            </div>
                            {task.result.usage && (
                                <div className="col-span-2">
                                    <div className="uppercase tracking-wider opacity-50 mb-1">Token Usage</div>
                                    <div className="font-mono">
                                        {JSON.stringify(task.result.usage)}
                                    </div>
                                </div>
                            )}
                         </div>
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center h-full text-theme-muted gap-3">
                        {task.status === 'running' ? (
                            <>
                                <Loader2 className="w-8 h-8 animate-spin text-primary opacity-50" />
                                <span className="text-sm">Generating result...</span>
                            </>
                        ) : (
                            <>
                                <FileText className="w-8 h-8 opacity-20" />
                                <span className="text-sm">No result available</span>
                            </>
                        )}
                    </div>
                )}
            </div>
        )}

      </div>
    </div>
  );
};
