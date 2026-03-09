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
    ChevronRight,
    LayoutList,
    FileText,
    Activity,
    Globe,
    Code,
    Copy,
    Check
} from "lucide-react";
import { clsx } from 'clsx';
import ReactMarkdown from 'react-markdown';
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

const CopyButton = ({ text }: { text: string }) => {
    const [copied, setCopied] = useState(false);
    const handleCopy = (e: React.MouseEvent) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };
    return (
        <button
            onClick={handleCopy}
            className="p-1 rounded hover:bg-white/10 text-theme-muted hover:text-white transition-colors"
            title="Copy to clipboard"
        >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
        </button>
    );
};

const CodeBlock = ({ data, label }: { data: any, label?: string }) => {
    const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    return (
        <div className="mt-3 text-xs font-mono group/code">
            <div className="flex items-center justify-between mb-1.5 px-1">
                {label && <div className="text-[10px] uppercase tracking-wider text-theme-muted font-bold opacity-70">{label}</div>}
                <CopyButton text={text} />
            </div>
            <div className="bg-theme-bg rounded-lg border border-theme-border/50 p-3 overflow-x-auto custom-scrollbar shadow-inner">
                <pre className="text-theme-fg/80 whitespace-pre-wrap break-all leading-relaxed">
                    {text}
                </pre>
            </div>
        </div>
    );
};

// --- Trace View Component ---

const TraceItem = ({ step, isLast }: { step: TraceStep, isLast: boolean }) => {
    const [expanded, setExpanded] = useState(step.status === 'failed' || step.status === 'running');

    // Icon based on tool/step type
    let StepIcon = Activity;
    if (step.name.includes('web_search')) StepIcon = Globe;
    else if (step.name.includes('code') || step.name.includes('edit')) StepIcon = Code;
    else if (step.name === 'RUN_PARALLEL') StepIcon = LayoutList;
    else if (step.name.includes('terminal')) StepIcon = Terminal;

    return (
        <div className="relative pl-8">
            {/* Timeline Line */}
            {!isLast && (
                <div className="absolute left-[11px] top-8 bottom-[-8px] w-px bg-theme-border/50" />
            )}

            {/* Step Header */}
            <div className="relative mb-2">
                {/* Timeline Dot/Icon */}
                <div className={clsx(
                    "absolute -left-[27px] top-1 w-6 h-6 rounded-full border flex items-center justify-center z-10 box-border transition-colors duration-300",
                    step.status === 'running' ? "bg-theme-bg border-blue-500 text-blue-500 shadow-[0_0_10px_-2px_rgba(59,130,246,0.3)]" :
                        step.status === 'completed' ? "bg-theme-bg border-emerald-500 text-emerald-500" :
                            step.status === 'failed' ? "bg-theme-bg border-red-500 text-red-500" :
                                "bg-theme-bg border-theme-border text-theme-muted"
                )}>
                    {step.status === 'running' ? (
                        <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                    ) : (
                        <StepIcon className="w-3 h-3" />
                    )}
                </div>

                <div
                    className={clsx(
                        "flex flex-col rounded-lg border transition-all cursor-pointer overflow-hidden",
                        step.status === 'running' ? "bg-theme-active border-theme-active-border shadow-sm" : "bg-theme-card border-theme hover:border-theme-hover"
                    )}
                    onClick={() => setExpanded(!expanded)}
                >
                    {/* Header Row */}
                    <div className="flex items-center gap-3 p-3 select-none">
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                                <span className={clsx(
                                    "font-semibold text-sm truncate",
                                    step.status === 'failed' ? "text-red-400" : "text-theme-fg"
                                )}>
                                    {step.name}
                                </span>
                                {step.status === 'failed' && (
                                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/10 text-red-400">FAILED</span>
                                )}
                            </div>
                            {/* Quick Preview or Duration */}
                            <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-[10px] text-theme-muted font-mono opacity-60">
                                    {new Date(step.timestamp).toLocaleTimeString()}
                                </span>
                                {!expanded && step.input && (
                                    <span className="text-xs text-theme-muted truncate opacity-50 max-w-[200px] border-l border-theme-border pl-2">
                                        {typeof step.input === 'object' ? Object.keys(step.input).join(', ') : '...'}
                                    </span>
                                )}
                            </div>
                        </div>

                        <ChevronRight className={clsx("w-4 h-4 text-theme-muted transition-transform duration-200", expanded && "rotate-90")} />
                    </div>

                    {/* Expanded Details */}
                    {expanded && (
                        <div className="px-3 pb-3 pt-0 animate-in slide-in-from-top-1 duration-200">
                            <div className="h-px bg-theme-border/50 w-full mb-3" />

                            <div className="space-y-4">
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
                                    <div className="space-y-4 mt-4 pl-2">
                                        <div className="text-[10px] uppercase tracking-wider text-theme-muted font-bold opacity-70 mb-2">Parallel Steps</div>
                                        {step.children.map((child, i) => (
                                            <TraceItem key={child.id} step={child} isLast={i === (step.children?.length || 0) - 1} />
                                        ))}
                                    </div>
                                )}

                                {step.output && <CodeBlock data={step.output} label="Output" />}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const TraceView = ({ logs }: { logs: any[] }) => {
    // Parse logs into structured trace
    const trace = useMemo(() => {
        const steps: TraceStep[] = [];
        let hasStructuredSteps = false;

        logs.forEach((log, index) => {
            const timestamp = log.timestamp || new Date().toISOString();
            const id = `step-${index}`;

            // Case A: Parallel Groups (structured logs)
            if (log.args && log.args.steps && Array.isArray(log.args.steps)) {
                hasStructuredSteps = true;
                const groupStep: TraceStep = {
                    id: `group-${index}`,
                    type: 'parallel_group',
                    name: 'Parallel Execution',
                    status: 'completed',
                    timestamp,
                    input: { count: log.args.steps.length },
                    children: log.args.steps.map((s: any, i: number) => ({
                        id: `sub-${index}-${i}`,
                        type: 'tool',
                        name: s.tool,
                        status: 'completed',
                        input: s.args,
                        timestamp,
                    }))
                };
                steps.push(groupStep);
            }

            // Case B: Parallel Results
            else if (log.result && log.result.results && Array.isArray(log.result.results)) {
                const lastGroup = steps.find(s => s.type === 'parallel_group' && !s.output);
                if (lastGroup && lastGroup.children) {
                    lastGroup.output = log.result;
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

            // Case C: Standard Tool Calls
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

        // Fallback if no specific format detected
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

    const endRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom initially
    useEffect(() => {
        if (trace.length > 0) {
            endRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [trace.length]);

    if (trace.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-theme-muted pb-20">
                <Activity className="w-10 h-10 mb-3 opacity-10" />
                <p className="text-sm opacity-50 font-medium">No activity recorded yet.</p>
            </div>
        );
    }

    return (
        <div className="p-6 space-y-0.5 pb-20 max-w-3xl mx-auto">
            {trace.map((step, i) => (
                <TraceItem key={step.id} step={step} isLast={i === trace.length - 1} />
            ))}
            <div ref={endRef} />
        </div>
    );
};

// --- Logs View (Console) ---

const LogItem = ({ log }: { log: any }) => {
    const [expanded, setExpanded] = useState(false);
    const timestamp = log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : '';

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
        <div className="font-mono text-xs border-b border-theme-border/30 last:border-0 hover:bg-white/5 transition-colors">
            <div
                className="flex items-start gap-3 p-2.5 cursor-pointer"
                onClick={() => setExpanded(!expanded)}
            >
                <span className="text-theme-muted/40 shrink-0 min-w-[65px] text-[10px] pt-0.5">{timestamp}</span>
                <Icon className={clsx("w-3.5 h-3.5 mt-0.5 shrink-0", colorClass)} />
                <div className="flex-1 min-w-0 break-words">
                    <div className="flex items-baseline gap-2">
                        <span className={clsx("font-bold uppercase tracking-wider text-[10px] opacity-80", colorClass)}>
                            {log.tool || log.type}
                        </span>
                        <span className="text-theme-fg opacity-90 leading-tight">
                            {log.type === 'tool_call' ? 'Calling...' :
                                log.type === 'tool_result' ? 'Completed' :
                                    typeof log.message === 'string' ? log.message :
                                        JSON.stringify(log.message || log.args || log.result || '').slice(0, 150)}
                        </span>
                    </div>
                </div>
            </div>
            {expanded && (
                <div className="px-12 pb-3">
                    <div className="bg-theme-bg p-3 rounded border border-theme-border/50 overflow-x-auto text-[10px] custom-scrollbar text-theme-fg/80">
                        <pre className="">{JSON.stringify(log, null, 2)}</pre>
                    </div>
                </div>
            )}
        </div>
    );
};

// --- Main Component ---

export const SubAgentDetails: React.FC<SubAgentDetailsProps> = ({ task, onBack, onUpdate, compact }) => {
    const [activeTab, setActiveTab] = useState<'trace' | 'logs' | 'result'>('trace');
    const { modelById } = useModelRegistry();
    const contextMetrics = useMemo(() => buildContextUsageMetrics({
        usage: task.result?.usage,
        modelId: task.model,
        modelById,
    }), [modelById, task.model, task.result?.usage]);

    // Auto-refresh
    useEffect(() => {
        if (task.status === 'running') {
            const interval = setInterval(async () => {
                try {
                    const res = await fetch(`${AGENT_HTTP}/v1/subagents/${task.id}`);
                    const data = await res.json();
                    if (data.ok && data.task) onUpdate(data.task);
                } catch (e) { console.error(e); }
            }, 2000);
            return () => clearInterval(interval);
        }
    }, [task.status, task.id]);

    const TabButton = ({ id, icon: Icon, label, count }: { id: typeof activeTab, icon: any, label: string, count?: number }) => (
        <button
            onClick={() => setActiveTab(id)}
            className={clsx(
                "flex items-center gap-2 px-6 py-3 text-xs font-medium border-b-2 transition-all relative",
                activeTab === id
                    ? "border-primary text-primary bg-primary/5"
                    : "border-transparent text-theme-muted hover:text-theme-fg hover:bg-theme-hover"
            )}
        >
            <Icon className="w-4 h-4" />
            {label}
            {count !== undefined && <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-theme-bg border border-theme-border text-[10px] text-theme-muted">{count}</span>}
        </button>
    );

    return (
        <div className="flex flex-col h-full bg-theme-card relative">

            {/* 1. Header Area */}
            <div className="flex flex-col border-b border-theme bg-theme-bg/50 backdrop-blur-sm z-10 sticky top-0">
                <div className="flex items-start gap-4 p-4">
                    <button
                        onClick={onBack}
                        className="mt-1 p-2 rounded-lg hover:bg-theme-hover text-theme-muted hover:text-theme-fg transition-colors border border-transparent hover:border-theme-border"
                        title="Go Back"
                    >
                        <ArrowLeft className="w-4 h-4" />
                    </button>

                    <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex items-center gap-3">
                            <span className={clsx(
                                "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border shadow-sm",
                                task.status === 'running' ? "text-blue-500 bg-blue-500/10 border-blue-500/20" :
                                    task.status === 'completed' ? "text-emerald-500 bg-emerald-500/10 border-emerald-500/20" :
                                        "text-red-500 bg-red-500/10 border-red-500/20"
                            )}>
                                <StatusIcon status={task.status} className="w-3 h-3" />
                                {task.status}
                            </span>
                            <span className="text-[10px] text-theme-muted font-mono flex items-center gap-1.5 px-2 py-1 rounded bg-theme-bg border border-theme-border">
                                <Cpu className="w-3 h-3" />
                                {task.model}
                            </span>
                            <ContextUsageIndicator metrics={contextMetrics} compact />
                            <span className="text-[10px] text-theme-muted font-mono opacity-50 ml-auto">
                                ID: {task.id.slice(0, 8)}
                            </span>
                        </div>
                        <h2 className="text-lg font-bold text-theme-fg leading-relaxed tracking-tight">
                            {task.objective}
                        </h2>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex items-center px-4 bg-theme-bg/30 border-t border-white/5">
                    <TabButton id="trace" icon={LayoutList} label="Activity" />
                    <TabButton id="logs" icon={Terminal} label="Logs" count={task.logs.length} />
                    <TabButton id="result" icon={FileText} label="Result" />
                </div>
            </div>

            {/* 2. Main Content Area */}
            <div className="flex-1 overflow-hidden relative bg-theme-bg/30">

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
                    <div className="absolute inset-0 overflow-y-auto custom-scrollbar p-8">
                        {task.result ? (
                            <div className="max-w-3xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                {/* Result Content */}
                                <div className="bg-theme-card border border-theme-border rounded-xl p-6 shadow-sm">
                                    {task.result.text ? (
                                        <div className="prose prose-invert max-w-none prose-p:leading-relaxed prose-headings:font-stuard">
                                            <ReactMarkdown>{task.result.text}</ReactMarkdown>
                                        </div>
                                    ) : (
                                        <div className="text-theme-muted text-sm text-center py-8 italic">
                                            No text output generated.
                                        </div>
                                    )}
                                </div>

                                {/* Metadata Footer */}
                                <div className="grid grid-cols-2 gap-6 p-6 rounded-xl border border-dashed border-theme-border bg-theme-bg/30 text-xs text-theme-muted">
                                    <div>
                                        <div className="uppercase tracking-wider opacity-50 mb-1.5 font-bold">Started</div>
                                        <div className="font-mono">{new Date(task.created_at).toLocaleString()}</div>
                                    </div>
                                    <div>
                                        <div className="uppercase tracking-wider opacity-50 mb-1.5 font-bold">Finished</div>
                                        <div className="font-mono">{new Date(task.updated_at).toLocaleString()}</div>
                                    </div>
                                    {task.result.usage && (
                                        <div className="col-span-2 pt-4 border-t border-white/5">
                                            <div className="uppercase tracking-wider opacity-50 mb-2 font-bold">Token Usage</div>
                                            <div className="flex flex-col gap-3">
                                                <ContextUsageIndicator metrics={contextMetrics} />
                                                <div className="font-mono bg-black/20 p-2 rounded border border-white/5 inline-block max-w-full overflow-x-auto">
                                                    {JSON.stringify(task.result.usage, null, 2)}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full text-theme-muted gap-4">
                                {task.status === 'running' ? (
                                    <>
                                        <div className="p-4 bg-theme-hover rounded-full">
                                            <Loader2 className="w-8 h-8 animate-spin text-primary" />
                                        </div>
                                        <span className="text-sm font-medium">Generating result...</span>
                                    </>
                                ) : (
                                    <>
                                        <FileText className="w-12 h-12 opacity-10" />
                                        <span className="text-sm opacity-50">No result available</span>
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
