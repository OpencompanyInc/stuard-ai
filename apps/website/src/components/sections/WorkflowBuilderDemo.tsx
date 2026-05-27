"use client";

import { useState, useEffect, useMemo } from 'react';
import { validateDesignerModel } from '@stuardai/workflow-core/compiler';
import { Stuard } from '@stuardai/workflow-core/builder';
import type { DesignerModel } from '@stuardai/workflow-core/types';

// --- Types ---
interface Node {
  id: string;
  type: "trigger" | "action" | "condition";
  label: string;
  subLabel: string;
  icon: string;
  x: number;
  y: number;
  status: "pending" | "building" | "idle" | "running" | "completed" | "error";
  config?: Record<string, string>;
}

interface Wire {
  from: string;
  to: string;
  status: "pending" | "building" | "idle" | "active";
}

interface Log {
  id: string;
  timestamp: string;
  message: string;
  type: "info" | "success" | "wait";
}

// --- Constants ---
const FULL_NODES: Node[] = [
  { 
    id: "trigger", type: "trigger", label: "Daily Schedule", subLabel: "Every day at 9:00 AM", 
    icon: "clock", x: 40, y: 40, status: "pending",
    config: { time: "09:00", timezone: "UTC" }
  },
  { 
    id: "scrape", type: "action", label: "Scrape Data", subLabel: "Get Hacker News top posts", 
    icon: "globe", x: 40, y: 140, status: "pending",
    config: { url: "news.ycombinator.com", selector: ".titleline" }
  },
  { 
    id: "ai", type: "action", label: "Summarize", subLabel: "Gemini 1.5 Flash", 
    icon: "brain", x: 40, y: 240, status: "pending",
    config: { model: "gemini-1.5-flash", prompt: "Summarize tech trends..." }
  },
  { 
    id: "email", type: "action", label: "Send Briefing", subLabel: "Email to team", 
    icon: "mail", x: 240, y: 240, status: "pending",
    config: { to: "team@company.com", subject: "Daily Tech Brief" }
  },
];

const FULL_WIRES: Wire[] = [
  { from: "trigger", to: "scrape", status: "pending" },
  { from: "scrape", to: "ai", status: "pending" },
  { from: "ai", to: "email", status: "pending" },
];

const NODE_WIDTH = 160;
const NODE_HEIGHT = 64;
const PROMPT_TEXT = "Create a workflow that checks Hacker News daily and emails me a summary.";

// --- Helper Icons ---
const Icons: Record<string, React.FC<{ className?: string }>> = {
  clock: ({ className }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
  ),
  globe: ({ className }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
  ),
  brain: ({ className }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M12 2a4 4 0 0 1 4 4v1a3 3 0 0 1 3 3v1a3 3 0 0 1-1 5.5V18a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4v-1.5A3 3 0 0 1 5 11v-1a3 3 0 0 1 3-3V6a4 4 0 0 1 4-4z"/></svg>
  ),
  mail: ({ className }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
  ),
};

export default function WorkflowBuilderDemo() {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [wires, setWires] = useState<Wire[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [phase, setPhase] = useState<"idle" | "typing" | "processing" | "building" | "running" | "finished">("idle");
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [showThinking, setShowThinking] = useState(false);

  const demoValidation = useMemo(() => {
    const model: DesignerModel = {
      id: 'demo_hn_briefing',
      name: 'Hacker News Daily Briefing',
      version: '1',
      triggers: [{ id: 'trigger_0', type: 'schedule.cron', label: 'Daily Schedule', args: { cron: '0 9 * * *' }, position: { x: 40, y: 40 } }],
      nodes: FULL_NODES.filter((n) => n.type === 'action').map((node, index) => ({
        id: node.id,
        type: 'local.tool',
        tool: node.id === 'scrape' ? 'scrape_url' : node.id === 'ai' ? 'cloud_ai_vision' : 'gmail_send',
        label: node.label,
        args: node.config || {},
        position: { x: node.x, y: node.y || 60 + index * 100 },
      })),
      wires: FULL_WIRES.map((wire) => ({ from: wire.from, to: wire.to })),
    };
    const issues = validateDesignerModel(model);
    const errors = issues.filter((issue) => issue.type === 'error').length;
    const warnings = issues.filter((issue) => issue.type === 'warning').length;
    const fluentSpec = Stuard.workflow('Hacker News Daily Briefing')
      .onSchedule('0 9 * * *')
      .step(['scrape_url', { url: 'https://news.ycombinator.com' }])
      .step(['cloud_ai_vision', { prompt: 'Summarize tech trends' }])
      .step(['gmail_send', { to: 'team@company.com', subject: 'Daily Tech Brief' }])
      .build();
    return { errors, warnings, fluentStepCount: fluentSpec.steps?.length ?? 0 };
  }, []);

  // --- Animation Loop ---
  useEffect(() => {
    let isCancelled = false;

    const addLog = (msg: string, type: Log["type"] = "info") => {
      setLogs(prev => [...prev.slice(-4), { // Keep last 5 logs
        id: Math.random().toString(36),
        timestamp: new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        message: msg,
        type
      }]);
    };

    const runSequence = async () => {
      // 0. Reset State
      setNodes([]);
      setWires([]);
      setLogs([]);
      setChatInput("");
      setShowThinking(false);
      setPhase("idle");
      await new Promise(r => setTimeout(r, 1000));

      // 1. Typing Phase
      setPhase("typing");
      for (let i = 0; i <= PROMPT_TEXT.length; i++) {
        if (isCancelled) return;
        setChatInput(PROMPT_TEXT.slice(0, i));
        await new Promise(r => setTimeout(r, 30 + Math.random() * 20)); // Random typing speed
      }
      await new Promise(r => setTimeout(r, 600));

      // 2. Processing Phase
      if (isCancelled) return;
      setPhase("processing");
      setShowThinking(true);
      await new Promise(r => setTimeout(r, 1500));
      setShowThinking(false);

      // 3. Build Nodes Phase
      if (isCancelled) return;
      setPhase("building");
      addLog("Initializing workflow builder...", "info");
      await new Promise(r => setTimeout(r, 500));

      for (const nodeTemplate of FULL_NODES) {
        if (isCancelled) return;
        setActiveNodeId(nodeTemplate.id);
        addLog(`Adding node: ${nodeTemplate.label}`, "info");
        
        // "Building" state (ghost/fade in)
        setNodes(prev => [...prev, { ...nodeTemplate, status: "building" }]);
        await new Promise(r => setTimeout(r, 300));
        
        // "Idle" state (solid)
        setNodes(prev => prev.map(n => n.id === nodeTemplate.id ? { ...n, status: "idle" } : n));
        await new Promise(r => setTimeout(r, 100));
      }
      setActiveNodeId(null);

      // 4. Connect Wires Phase
      await new Promise(r => setTimeout(r, 300));
      
      for (const wireTemplate of FULL_WIRES) {
        if (isCancelled) return;
        addLog(`Connecting ${wireTemplate.from} -> ${wireTemplate.to}...`, "info");
        setWires(prev => [...prev, { ...wireTemplate, status: "building" }]);
        await new Promise(r => setTimeout(r, 200));
        
        // Solidify wire
        setWires(prev => {
           const newWires = [...prev];
           newWires[newWires.length - 1].status = "idle";
           return newWires;
        });
        await new Promise(r => setTimeout(r, 100));
      }

      // 5. Execution Loop Phase
      if (isCancelled) return;
      setPhase("running");
      addLog("Workflow built. Starting execution...", "success");
      await new Promise(r => setTimeout(r, 1000));

      while (!isCancelled) {
        setLogs([]); // Clear logs for clean run
        addLog("Trigger event received", "info");
        
        for (const node of FULL_NODES) {
            if (isCancelled) break;

            // Activate Node
            setNodes(prev => prev.map(n => n.id === node.id ? { ...n, status: "running" } : n));
            setActiveNodeId(node.id);
            addLog(`Executing: ${node.label}...`, "wait");
            
            // Activate incoming wires
            setWires(prev => prev.map(w => w.to === node.id ? { ...w, status: "active" } : w));

            await new Promise(r => setTimeout(r, 800)); // Work duration

            // Complete Node
            setNodes(prev => prev.map(n => n.id === node.id ? { ...n, status: "completed" } : n));
            // Deactivate wires
            setWires(prev => prev.map(w => w.to === node.id ? { ...w, status: "idle" } : w));
            
            addLog(`Completed: ${node.label}`, "success");
            await new Promise(r => setTimeout(r, 200));
        }

        // Wait before restarting loop
        await new Promise(r => setTimeout(r, 3000));
        if (isCancelled) return;
        
        // Reset nodes to idle for next run, but keep them on screen
        setNodes(prev => prev.map(n => ({ ...n, status: "idle" })));
        setActiveNodeId(null);
        
        // Optional: If we want to restart the whole demo (typing again), we would break here and recall runSequence.
        // For now, let's just loop execution to keep the "result" visible.
      }
    };

    runSequence();

    return () => {
      isCancelled = true;
    };
  }, []);

  return (
    <div className="flex w-full h-full bg-slate-50 rounded-2xl overflow-hidden border border-slate-200 shadow-inner font-sans relative">
        {/* Background Grid */}
        <div 
            className="absolute inset-0 pointer-events-none opacity-[0.03]"
            style={{ 
                backgroundImage: 'linear-gradient(#000 1px, transparent 1px), linear-gradient(90deg, #000 1px, transparent 1px)', 
                backgroundSize: '20px 20px' 
            }}
        />

        {/* Main Canvas */}
        <div className="flex-1 relative overflow-hidden">
            
            {/* Wires Layer */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none z-0">
                {wires.map((wire, i) => {
                    const fromNode = nodes.find(n => n.id === wire.from) || FULL_NODES.find(n => n.id === wire.from);
                    const toNode = nodes.find(n => n.id === wire.to) || FULL_NODES.find(n => n.id === wire.to);
                    if (!fromNode || !toNode) return null;

                    const x1 = fromNode.x + NODE_WIDTH / 2;
                    const y1 = fromNode.y + NODE_HEIGHT / 2;
                    const x2 = toNode.x + NODE_WIDTH / 2;
                    const y2 = toNode.y + NODE_HEIGHT / 2;
                    
                    const cp1x = x1;
                    const cp1y = y1 + 50;
                    const cp2x = x2;
                    const cp2y = y2 - 50;
                    const d = `M ${x1} ${y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`;

                    const isActive = wire.status === "active";
                    const isBuilding = wire.status === "building";

                    return (
                        <g key={i}>
                            <path 
                                d={d} 
                                stroke="#cbd5e1" 
                                strokeWidth="2" 
                                fill="none" 
                                strokeDasharray={isBuilding ? "5,5" : "none"}
                                className="transition-all duration-300"
                            />
                            {isActive && (
                                <path 
                                    d={d} 
                                    stroke="#10b981" 
                                    strokeWidth="2" 
                                    fill="none" 
                                    strokeDasharray="10, 10"
                                >
                                    <animate attributeName="stroke-dashoffset" from="20" to="0" dur="0.5s" repeatCount="indefinite" />
                                </path>
                            )}
                        </g>
                    );
                })}
            </svg>

            {/* Nodes Layer */}
            {nodes.map(node => {
                const Icon = Icons[node.icon];
                const isRunning = node.status === "running";
                const isBuilding = node.status === "building";
                
                return (
                    <div
                        key={node.id}
                        className={`absolute rounded-xl border bg-white shadow-sm p-3 flex items-center gap-3 transition-all duration-500
                            ${isBuilding ? 'scale-90 opacity-0 translate-y-4' : 'scale-100 opacity-100 translate-y-0'}
                            ${isRunning ? 'border-emerald-500 ring-2 ring-emerald-100 shadow-md' : 'border-slate-200'}
                        `}
                        style={{ 
                            left: node.x, 
                            top: node.y, 
                            width: NODE_WIDTH, 
                            height: NODE_HEIGHT,
                        }}
                    >
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0
                            ${node.type === 'trigger' ? 'bg-amber-500' : 'bg-indigo-600'}
                        `}>
                            {Icon && <Icon className="w-5 h-5" />}
                        </div>
                        <div className="min-w-0">
                            <div className="text-xs font-semibold text-slate-800 truncate">{node.label}</div>
                            <div className="text-[10px] text-slate-500 truncate">{node.subLabel}</div>
                        </div>
                        
                        {/* Status Indicator */}
                        {node.status === 'completed' && (
                            <div className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full border-2 border-white flex items-center justify-center animate-fade-in">
                                <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                            </div>
                        )}
                    </div>
                );
            })}

            {/* Chat Overlay */}
            <div className={`absolute bottom-4 left-4 right-4 transition-all duration-500 ${phase === 'running' ? 'translate-y-[120%] opacity-50' : 'translate-y-0 opacity-100'}`}>
                <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-4 max-w-md mx-auto relative overflow-hidden">
                    
                    {/* Processing State Overlay */}
                    {showThinking && (
                        <div className="absolute inset-0 bg-white/90 backdrop-blur-sm z-10 flex items-center justify-center gap-2">
                             <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                             <span className="text-sm font-medium text-indigo-600">Generating workflow...</span>
                        </div>
                    )}

                    <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shrink-0">
                             <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                        </div>
                        <div className="flex-1 min-h-[40px] flex items-center">
                             {chatInput ? (
                                 <p className="text-sm text-slate-800 leading-relaxed font-medium">
                                     {chatInput}
                                     {phase === 'typing' && <span className="inline-block w-1.5 h-4 ml-1 bg-indigo-500 animate-pulse align-middle"></span>}
                                 </p>
                             ) : (
                                 <span className="text-sm text-slate-400 italic">Describe a tool to build...</span>
                             )}
                        </div>
                    </div>
                </div>
            </div>

        </div>

        {/* Right Sidebar: Properties / Logs */}
        <div className="w-48 bg-white border-l border-slate-200 flex flex-col z-10 transition-colors duration-300">
            {/* Header */}
            <div className="h-10 border-b border-slate-100 flex items-center px-3 bg-slate-50">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    {phase === "running" ? "Live Logs" : "Builder Output"}
                </span>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {/* Empty State */}
                {phase === 'idle' || phase === 'typing' ? (
                     <div className="h-full flex flex-col items-center justify-center text-center p-4 opacity-50">
                        <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center mb-2">
                            <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/></svg>
                        </div>
                        <p className="text-[10px] text-slate-400">Waiting for instructions...</p>
                    </div>
                ) : (phase === "running" || phase === "finished") ? (
                    // Logs View
                    <div className="space-y-2">
                        {logs.map(log => (
                            <div key={log.id} className="text-[10px] font-mono animate-fade-in duration-300">
                                <span className="text-slate-400 mr-2">[{log.timestamp}]</span>
                                <span className={
                                    log.type === 'success' ? 'text-emerald-600' : 
                                    log.type === 'wait' ? 'text-amber-600' : 'text-slate-600'
                                }>
                                    {log.message}
                                </span>
                            </div>
                        ))}
                    </div>
                ) : (
                    // Builder/Properties View
                    activeNodeId ? (
                         <div className="space-y-3 animate-fade-in duration-200">
                            {(() => {
                                const node = FULL_NODES.find(n => n.id === activeNodeId);
                                if (!node) return null;
                                return (
                                    <>
                                        <div className="pb-2 border-b border-slate-100">
                                            <div className="text-xs font-bold text-slate-800">{node.label}</div>
                                            <div className="text-[10px] text-slate-500">{node.type}</div>
                                        </div>
                                        {node.config && Object.entries(node.config).map(([k, v]) => (
                                            <div key={k}>
                                                <div className="text-[9px] font-medium text-slate-400 uppercase mb-0.5">{k}</div>
                                                <div className="text-[10px] text-slate-700 bg-slate-50 p-1.5 rounded border border-slate-100 break-all">
                                                    {v}
                                                </div>
                                            </div>
                                        ))}
                                    </>
                                );
                            })()}
                         </div>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-center p-4">
                             <div className="w-2 h-2 bg-indigo-500 rounded-full animate-ping mb-2" />
                            <p className="text-[10px] text-slate-400">Building components...</p>
                        </div>
                    )
                )}
            </div>
            
            {/* Footer */}
             <div className="p-2 border-t border-slate-100 bg-slate-50/50">
                <div className="flex items-center gap-1.5">
                    <div className={`w-1.5 h-1.5 rounded-full ${phase === 'running' ? 'bg-emerald-500 animate-pulse' : phase === 'processing' ? 'bg-indigo-500 animate-bounce' : 'bg-slate-300'}`} />
                    <span className="text-[10px] font-medium text-slate-500 capitalize">{phase}</span>
                    {phase === 'finished' ? (
                      <span className="ml-auto text-[10px] text-slate-400">
                        workflow-core: {demoValidation.errors} errors, {demoValidation.warnings} warnings
                      </span>
                    ) : null}
                </div>
            </div>
        </div>
    </div>
  );
}
