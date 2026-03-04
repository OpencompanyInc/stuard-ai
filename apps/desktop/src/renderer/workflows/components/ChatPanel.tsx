import React, { useState, useRef, useEffect, useMemo } from "react";
import { PaperPlaneIcon, MagicWandIcon, Cross2Icon, PersonIcon, DesktopIcon, ClockIcon, PlusIcon, TrashIcon, ImageIcon } from "@radix-ui/react-icons";
import { Send, Sparkles, X, User, Bot, History, Plus, Trash2, Image as ImageIconLucide, AlertCircle, CheckCircle2, RotateCw, Zap, Clock, ArrowRight, Link, Unlink, Edit, FileText, Settings, Type } from "lucide-react";
import { designerModelToStuardSpec, specToDesignerModel } from "../utils/conversions";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { supabase } from "../../lib/supabaseClient";
import { ChatSession, formatSessionTime } from "../utils/chatStorage";
import { ReasoningBlock } from "../../components/ReasoningBlock";
import { AudioPlayer } from "../../components/AudioPlayer";

const HIDDEN_TOOL_NAMES = new Set([
  'knowledge_get_identity',
  'knowledge_get_directives',
  'knowledge_get_bio',
  'knowledge_list_entities',
  'knowledge_search_facts',
  'knowledge_get_entity_context',
  // Hide internal discovery tools from workflow agent
  'retrieve_tool_format',
  'search_tools',
  'get_tool_schema',
]);

// Convert local file path to file:// URL for Electron
function toMediaSrc(src: string): string {
  if (!src) return '';
  if (/^(https?:|data:|file:)/i.test(src)) return src;
  let path = src.trim();
  if (/^[a-zA-Z]:[/\\]/.test(path)) {
    path = path.replace(/\\/g, '/');
    const parts = path.split('/');
    const encodedPath = parts.map((p, i) => (i === 0 ? p : encodeURIComponent(p))).join('/');
    return `file:///${encodedPath}`;
  }
  if (path.startsWith('/')) {
    const encodedPath = path.split('/').map(p => encodeURIComponent(p)).join('/');
    return `file://${encodedPath}`;
  }
  const encodedPath = path.replace(/\\/g, '/').split('/').map(p => encodeURIComponent(p)).join('/');
  return `file:///${encodedPath}`;
}

// Pre-process text to convert <<...>> and raw audio paths to Markdown image syntax
// This allows us to intercept the 'img' component in ReactMarkdown and render AudioPlayer/ChatImage
function preprocessMessageContent(content: string): string {
  if (!content) return '';
  
  // 0. Escape dollar signs used for currency to prevent LaTeX parsing
  let processed = content.replace(/\$(\d[\d,]*\.?\d*)/g, '\\$$$1');
  
  // 1. Replace <<path>> with ![attachment](path)
  processed = processed.replace(/<<([^<>]+)>>/g, '![attachment](<$1>)');
  
  // 2. Replace raw audio paths with ![audio](path)
  // Look for standalone paths at start of line or preceded by whitespace
  // Regex matches: Drive:\... or /... ending in audio ext
  const rawAudioRegex = /(^|[\s\n])((?:[a-zA-Z]:\\[^<>:"|?*\n\r]+\.(?:wav|mp3|ogg|m4a|aac))|(?:\/[^<>:"|?*\n\r]+\.(?:wav|mp3|ogg|m4a|aac)))(?=$|[\s\n])/gmi;
  
  processed = processed.replace(rawAudioRegex, '$1![audio](<$2>)');
  
  return processed;
}

// Image component for local/web images in chat
export const ChatImage: React.FC<{ src: string; alt?: string }> = ({ src, alt }) => {
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState(false);
  const imageSrc = toMediaSrc(src || '');
  
  // Check if it's an audio file based on extension or alt text
  const isAudio = /\.(wav|mp3|ogg|m4a|aac)(\?|$)/i.test(imageSrc) || alt === 'audio';
  const isVideo = /\.(mp4|mov|m4v|webm)(\?|$)/i.test(imageSrc) || alt === 'video';
  
  if (isAudio) {
    return <AudioPlayer src={imageSrc} className="my-2 max-w-sm" />;
  }

  if (isVideo) {
    return (
      <span className="block my-2">
        <video
          src={imageSrc}
          controls
          playsInline
          onError={(e) => {
            const code = e.currentTarget?.error?.code;
            console.error(`[ChatImage video] Failed(${code ?? 'unknown'}): "${src}" → "${imageSrc}"`);
            setError(true);
          }}
          className="max-w-full max-h-[240px] rounded-lg border border-white/[0.08] shadow-sm object-contain bg-black"
        />
      </span>
    );
  }

  if (error) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-red-50 border border-red-100 rounded-md text-red-600 text-xs font-medium">
        <AlertCircle className="w-3 h-3" />
        Failed to load: {alt || 'Image'}
      </span>
    );
  }

  return (
    <span className="block my-2 relative group">
      <div className={`absolute inset-0 bg-white/[0.06] rounded-lg animate-pulse ${loaded ? 'hidden' : 'block'}`} />
      <img
        src={imageSrc}
        alt={alt || 'Image'}
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
        className={`max-w-full max-h-[240px] rounded-lg border border-white/[0.08] shadow-sm object-contain bg-white/[0.04] transition-all duration-300 ${loaded ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}
      />
    </span>
  );
};

interface ValidationError {
  type: 'error' | 'warning';
  message: string;
  nodeId?: string;
}

interface ChatPanelProps {
  model: any;
  onApplyModel: (model: any) => void;
  cloudAiHttp: string;
  onClose: () => void;
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  // Lifted state
  streamItems: StreamItem[];
  setStreamItems: React.Dispatch<React.SetStateAction<StreamItem[]>>;
  reasoningText: string;
  setReasoningText: React.Dispatch<React.SetStateAction<string>>;
  busy: boolean;
  setBusy: React.Dispatch<React.SetStateAction<boolean>>;
  showReasoning: boolean;
  setShowReasoning: React.Dispatch<React.SetStateAction<boolean>>;
  // Validation errors for debug context
  errors?: ValidationError[];
  // Session management
  pastSessions?: ChatSession[];
  showSessionHistory?: boolean;
  setShowSessionHistory?: React.Dispatch<React.SetStateAction<boolean>>;
  onNewSession?: () => void;
  onLoadSession?: (sessionId: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  // Controlled input
  inputValue?: string;
  onInputChange?: (value: string) => void;
  // UI Options
  hideCloseButton?: boolean;
}

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  images?: Array<{ path: string; name: string; dataUrl?: string; data?: string; mimeType?: string }>;
  parts?: StreamItem[];
  reasoning?: string;
  reasoningDuration?: number; // Duration in seconds for completed reasoning
}

export interface ToolEvent {
  ts: string;
  tool: string;
  status?: string;
  args?: any;
  argsText?: string; // Streaming buffer for JSON args
  id?: string;
  result?: any;
  workflowBefore?: any; // Snapshot of workflow before modification (for undo)
}

export type StreamItem =
  | { type: 'text'; content: string }
  | { type: 'tool'; event: ToolEvent };

// Helper to safely parse partial or full JSON args for workflow_modify
function parseModifyWorkflowArgs(jsonStr: string) {
  try {
    // Try full parse first
    return JSON.parse(jsonStr);
  } catch {
    // Fallback: try to regex extract instructions if valid JSON is not yet formed
    const result: any = {};

    // Extract instructions field for display
    const instrMatch = jsonStr.match(/"instructions"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (instrMatch) {
      try { result.instructions = JSON.parse(`"${instrMatch[1]}"`); } catch { }
    }

    return result;
  }
}

// Helper to format tool names for display
function formatToolName(name: string): string {
  if (name === 'workflow_modify' || name === 'modify_workflow') return 'Modify Workflow';
  if (name === 'create_workflow') return 'Create Workflow';
  if (name === 'execute_step' || name === 'test_step') return 'Test Step';
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Operation badge component
const OpBadge = ({ icon: Icon, color, children }: { icon: any; color: string; children: React.ReactNode }) => {
  const colors: Record<string, string> = {
    emerald: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    amber: 'bg-amber-100 text-amber-700 border-amber-200',
    red: 'bg-red-100 text-red-700 border-red-200',
    blue: 'bg-blue-100 text-blue-700 border-blue-200',
    indigo: 'bg-indigo-100 text-indigo-700 border-indigo-200',
    slate: 'bg-white/[0.06] text-white/70 border-white/[0.08]',
  };
  return (
    <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium border ${colors[color]}`}>
      <Icon className="w-3 h-3" />
      {children}
    </div>
  );
};

// Format a value for display (avoid raw JSON)
const formatValue = (val: any): string => {
  if (val === undefined || val === null) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (typeof val === 'object') {
    // For simple objects, show key=value pairs
    const entries = Object.entries(val).slice(0, 3);
    if (entries.length === 0) return '{}';
    const formatted = entries.map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(', ');
    return entries.length < Object.keys(val).length ? `${formatted}, ...` : formatted;
  }
  return String(val);
};

// Operation specific details - supports both old `operation` and new `op` params
const OperationDetails = ({ args }: { args: any }) => {
  const op = args.op || args.operation;
  
  switch (op) {
    case 'add_node':
      return (
        <div className="space-y-1.5">
          <OpBadge icon={Plus} color="emerald">Add Step</OpBadge>
          <div className="text-[12px] text-white/80 pl-1">
            <span className="font-semibold">{args.label || args.tool}</span>
            {args.tool && args.label && <span className="text-white/40 ml-1">({args.tool})</span>}
          </div>
          {args.args && Object.keys(args.args).length > 0 && (
            <div className="text-[10px] pl-1 space-y-0.5">
              {Object.entries(args.args).map(([k, v]) => (
                <div key={k} className="text-emerald-600">+ {k}: {formatValue(v)}</div>
              ))}
            </div>
          )}
          {args.connectFrom && (
            <div className="flex items-center gap-1 text-white/50 text-[10px] pl-1">
              <ArrowRight className="w-3 h-3" /> from {args.connectFrom}
            </div>
          )}
        </div>
      );

    case 'update_node':
      return (
        <div className="space-y-1.5">
          <OpBadge icon={Edit} color="blue">Update Step</OpBadge>
          <div className="text-[12px] text-white/80 pl-1">
            <span className="font-mono text-white/50">{args.nodeId}</span>
          </div>
          {(args.args || args.label || args.tool) && (
            <div className="text-[10px] pl-1 space-y-0.5">
              {args.label && <div className="text-emerald-600">+ label: "{args.label}"</div>}
              {args.tool && <div className="text-emerald-600">+ tool: {args.tool}</div>}
              {args.args && Object.entries(args.args).map(([k, v]) => (
                <div key={k} className="text-emerald-600">+ {k}: {formatValue(v)}</div>
              ))}
            </div>
          )}
        </div>
      );

    case 'remove_node':
      return (
        <div className="space-y-1.5">
          <OpBadge icon={Trash2} color="red">Remove Step</OpBadge>
          <div className="text-[12px] text-white/80 pl-1">
            <span className="font-mono text-red-600 line-through">{args.nodeId}</span>
          </div>
        </div>
      );

    case 'set_trigger':
    case 'replace_trigger':
    case 'add_trigger':
      const triggerType = args.triggerType || args.type;
      return (
        <div className="space-y-1.5">
          <OpBadge icon={Zap} color="amber">
            {op === 'add_trigger' ? 'Add Trigger' : 'Set Trigger'}
          </OpBadge>
          <div className="text-[12px] text-white/80 pl-1">
            <span className="font-semibold">{triggerType}</span>
          </div>
          {(args.triggerArgs || args.args) && Object.keys(args.triggerArgs || args.args).length > 0 && (
            <div className="text-[10px] pl-1 space-y-0.5">
              {Object.entries(args.triggerArgs || args.args).map(([k, v]) => (
                <div key={k} className="text-emerald-600">+ {k}: {formatValue(v)}</div>
              ))}
            </div>
          )}
        </div>
      );

    case 'add_wire':
    case 'connect':
      return (
        <div className="space-y-1.5">
          <OpBadge icon={Link} color="indigo">Connect</OpBadge>
          <div className="text-[12px] text-white/80 pl-1 flex items-center gap-1.5">
            <span className="font-mono bg-white/[0.06] px-1.5 py-0.5 rounded">{args.from}</span>
            <ArrowRight className="w-3 h-3 text-white/40" />
            <span className="font-mono bg-white/[0.06] px-1.5 py-0.5 rounded">{args.to}</span>
          </div>
          {args.guard && (
            <div className="text-[10px] text-amber-600 pl-1">
              guard: {formatValue(args.guard)}
            </div>
          )}
        </div>
      );

    case 'remove_wire':
    case 'disconnect':
      return (
        <div className="space-y-1.5">
          <OpBadge icon={Unlink} color="slate">Disconnect</OpBadge>
          <div className="text-[12px] text-white/80 pl-1 flex items-center gap-1.5">
            <span className="font-mono bg-red-50 text-red-600 px-1.5 py-0.5 rounded line-through">{args.from}</span>
            <ArrowRight className="w-3 h-3 text-slate-300" />
            <span className="font-mono bg-red-50 text-red-600 px-1.5 py-0.5 rounded line-through">{args.to}</span>
          </div>
        </div>
      );

    case 'set_path':
    case 'set':
      return (
        <div className="space-y-1.5">
          <OpBadge icon={Settings} color="slate">Set Value</OpBadge>
          <div className="text-[11px] pl-1 font-mono">
            <span className="text-white/50">{args.path}</span>
            <span className="text-white/40 mx-1">=</span>
            <span className="text-emerald-600">{formatValue(args.value)}</span>
          </div>
        </div>
      );

    case 'add_variable':
      return (
        <div className="space-y-1.5">
          <OpBadge icon={Plus} color="indigo">Add Variable</OpBadge>
          <div className="text-[12px] text-white/80 pl-1">
            <span className="font-mono">{args.varName}</span>
            <span className="text-white/40 ml-1">: {args.varType || 'string'}</span>
          </div>
          {args.varDefault !== undefined && (
            <div className="text-[10px] text-white/50 pl-1">default: {formatValue(args.varDefault)}</div>
          )}
        </div>
      );

    case 'rename':
      return (
        <div className="space-y-1.5">
          <OpBadge icon={Type} color="slate">Rename</OpBadge>
          <div className="text-[12px] text-white/80 pl-1">
            → <span className="font-semibold">{args.name}</span>
          </div>
        </div>
      );

    default:
      // Unknown operation - show generic info
      return (
        <div className="space-y-1.5">
          <OpBadge icon={Settings} color="slate">{op || 'Modify'}</OpBadge>
          <div className="text-[10px] pl-1 space-y-0.5">
            {Object.entries(args).map(([k, v]) => (
              <div key={k} className="text-white/70">
                <span className="font-semibold">{k}:</span> {formatValue(v)}
              </div>
            ))}
          </div>
        </div>
      );
  }
};

// UpdateWorkflowView shows the changes being applied - cleaner diff-style
const UpdateWorkflowView = ({ args, result }: { args: any, result?: any }) => {
  const resultWorkflow = result?.workflow;
  const resultChanges = result?.changes || result?.message;
  const rawError = result?.error;
  
  const resultOk = result?.ok === true;
  const resultFailed = result?.ok === false;
  const errorMessage = rawError || (resultFailed ? 'Update failed' : null);

  const showSuccess = resultOk && !errorMessage;
  const showError = !!errorMessage;
  const showPending = !result;

  // Determine status color
  const statusBg = showSuccess ? 'bg-emerald-500' : showError ? 'bg-red-500' : 'bg-indigo-500';

  return (
    <div className="mt-2 mb-3 rounded-xl border border-white/[0.08] bg-white/[0.04] shadow-sm overflow-hidden max-w-sm">
      {/* Compact header with status indicator */}
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-50/50 border-b border-white/[0.04]">
        <div className={`w-2 h-2 rounded-full ${statusBg} ${showPending ? 'animate-pulse' : ''}`} />
        <span className="text-[11px] font-medium text-white/70">
          {showPending ? 'Applying...' : showSuccess ? 'Applied' : showError ? 'Failed' : 'Update'}
        </span>
      </div>

      {/* Operation details */}
      <div className="px-3 py-2.5">
        <OperationDetails args={args} />
      </div>

      {/* Error message */}
      {showError && (
        <div className="px-3 py-2 bg-red-50 border-t border-red-100">
          <div className="flex items-start gap-2 text-[11px] text-red-700">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        </div>
      )}

      {/* Success summary */}
      {showSuccess && resultChanges && (
        <div className="px-3 py-2 bg-emerald-50/50 border-t border-emerald-100">
          <div className="flex items-start gap-2 text-[11px] text-emerald-700">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{resultChanges}</span>
          </div>
        </div>
      )}

      {/* Workflow stats badge */}
      {showSuccess && resultWorkflow && (
        <div className="px-3 py-1.5 bg-slate-50/50 border-t border-white/[0.04] flex items-center gap-2 text-[10px] text-white/50">
          <span className="flex items-center gap-1">
            <Zap className="w-3 h-3 text-amber-500" />
            {resultWorkflow.triggers?.length || 0}
          </span>
          <span className="flex items-center gap-1">
            <FileText className="w-3 h-3 text-indigo-500" />
            {resultWorkflow.nodes?.length || 0}
          </span>
          <span className="flex items-center gap-1">
            <Link className="w-3 h-3 text-white/40" />
            {resultWorkflow.wires?.length || 0}
          </span>
        </div>
      )}
    </div>
  );
};

// Test Step Result View - shows the actual tool execution result
const TestStepResultView = ({ args, result }: { args: any, result?: any }) => {
  const testedTool = args?.tool || 'unknown';
  const testedArgs = args?.args || {};
  const isRunning = !result;
  const isSuccess = result?.ok === true;
  const isFailed = result?.ok === false;
  const duration = result?.duration;
  const toolResult = result?.result;
  const assertions = result?.assertions;
  const error = result?.error;

  return (
    <div className="mt-3 flex flex-col gap-px text-[11px] border border-white/[0.08] rounded-lg bg-white/[0.04] overflow-hidden shadow-sm max-w-md">
      {/* Header */}
      <div className="bg-slate-50/80 px-3 py-2 text-white/80 text-[10px] font-semibold uppercase tracking-wider border-b border-white/[0.04] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1 bg-white/[0.04] rounded-md border border-white/[0.08] shadow-sm">
            <Zap className="w-3 h-3 text-indigo-500" />
          </div>
          <span>Test Run</span>
        </div>
        {isSuccess && <span className="text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">Passed</span>}
        {isFailed && <span className="text-red-600 bg-red-50 px-1.5 py-0.5 rounded border border-red-100">Failed</span>}
        {isRunning && <span className="text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100 flex items-center gap-1"><RotateCw className="w-3 h-3 animate-spin" />Running</span>}
      </div>

      {/* Tool Being Tested */}
      <div className="px-3 py-2.5 bg-white/[0.04] border-b border-slate-50">
        <div className="flex items-center gap-2 text-white/80 font-medium">
          <div className="p-1 bg-indigo-100 rounded text-indigo-600">
            <Zap className="w-3 h-3" />
          </div>
          <span>Testing: <span className="text-white font-semibold">{formatToolName(testedTool)}</span></span>
        </div>
        {Object.keys(testedArgs).length > 0 && (
          <div className="mt-2 text-[10px] font-mono text-white/50 bg-white/[0.06] rounded p-2 max-h-20 overflow-y-auto scrollbar-light">
            {JSON.stringify(testedArgs, null, 2)}
          </div>
        )}
      </div>

      {/* Error State */}
      {error && (
        <div className="bg-red-50/50 text-red-800 p-3 border-b border-red-100">
          <div className="flex gap-2">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="font-semibold text-[10px] uppercase mb-1 text-red-600">Error</div>
              <div className="text-[11px] opacity-90 whitespace-pre-wrap">{error}</div>
            </div>
          </div>
        </div>
      )}

      {/* Success State - Show Result */}
      {toolResult !== undefined && (
        <div className="bg-emerald-50/30 text-emerald-900 p-3">
          <div className="flex gap-2 mb-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="font-semibold text-[10px] uppercase mb-1 text-emerald-600 flex items-center justify-between">
                <span>Result</span>
                {duration && <span className="text-white/40 font-normal">{duration}ms</span>}
              </div>
              <div className="text-[11px] bg-white/[0.04] rounded p-2 border border-emerald-100 font-mono overflow-x-auto max-h-40 scrollbar-light">
                <pre className="whitespace-pre-wrap break-all">
                  {typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Assertions */}
      {assertions && assertions.length > 0 && (
        <div className="bg-slate-50/50 p-3 border-t border-white/[0.04]">
          <div className="font-semibold text-[10px] uppercase mb-2 text-white/70">Assertions</div>
          <div className="space-y-1">
            {assertions.map((a: any, i: number) => (
              <div key={i} className={`flex items-center gap-2 text-[11px] ${a.passed ? 'text-emerald-700' : 'text-red-700'}`}>
                {a.passed ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                <span className="font-medium">{a.type}</span>
                {a.message && <span className="text-white/50">— {a.message}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Running State */}
      {isRunning && (
        <div className="bg-white/[0.04] p-3">
          <div className="text-[11px] flex items-center gap-2 text-white/50">
            <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
            Executing {formatToolName(testedTool)}...
          </div>
        </div>
      )}
    </div>
  );
};

export const ToolCallItem = ({ evt }: { evt: ToolEvent }) => {
  const toolName = (evt.tool || '').toLowerCase().trim();
  const isWorkflowTool = toolName === 'workflow_modify' || toolName === 'modify_workflow' || toolName === 'create_workflow';
  const isTestStep = toolName === 'test_step' || toolName === 'execute_step';
  const args = useMemo(() => {
    if (evt.args) return evt.args;
    if (evt.argsText) {
      if (isWorkflowTool) return parseModifyWorkflowArgs(evt.argsText);
      try { return JSON.parse(evt.argsText); } catch { return {}; }
    }
    return {};
  }, [evt.args, evt.argsText, isWorkflowTool]);

  // Check if the result indicates a failure
  const resultFailed = evt.result && evt.result.ok === false;
  const resultError = evt.result?.error;

  const statusColor =
    resultFailed ? 'text-amber-600' :
      evt.status === 'completed' ? 'text-emerald-600' :
        evt.status === 'error' || evt.status === 'failed' ? 'text-red-600' :
          'text-indigo-600';

  const isRunning =
    !resultFailed && evt.status !== 'completed' && evt.status !== 'error' && evt.status !== 'failed';

  const statusIcon =
    isWorkflowTool && isRunning ? (
      <span className="inline-flex items-center justify-center">
        <RotateCw className="w-3 h-3 animate-spin" />
      </span>
    ) :
      resultFailed ? <AlertCircle className="w-3 h-3" /> :
        evt.status === 'completed' ? <CheckCircle2 className="w-3 h-3" /> :
          evt.status === 'error' || evt.status === 'failed' ? <X className="w-3 h-3" /> :
            <RotateCw className="w-3 h-3" />;

  const statusText = resultFailed ? 'failed' : (evt.status || 'running');

  // Specialized display for workflow tools
  if (isWorkflowTool) {
    return (
       <div className="mb-4">
         <UpdateWorkflowView args={args} result={evt.result} />
       </div>
   );
  }

  // Specialized display for test_step
  if (isTestStep) {
    return (
      <div className="mb-4">
        <TestStepResultView args={args} result={evt.result} />
      </div>
    );
  }

  // Generate human-readable summary for tool results
  const getToolSummary = (toolName: string, toolArgs: any, result: any): string | null => {
    const ok = result?.ok;
    
    // File operations
    if (toolName === 'write_file' || toolName === 'create_file') {
      const path = toolArgs?.path || toolArgs?.filePath || '';
      const fileName = path.split(/[/\\]/).pop() || path;
      return ok ? `Created ${fileName}` : `Failed to create ${fileName}`;
    }
    if (toolName === 'read_file') {
      const path = toolArgs?.path || toolArgs?.filePath || '';
      const fileName = path.split(/[/\\]/).pop() || path;
      const lines = result?.lines || result?.content?.split('\n')?.length;
      return ok ? `Read ${fileName}${lines ? ` (${lines} lines)` : ''}` : `Failed to read ${fileName}`;
    }
    if (toolName === 'delete_file') {
      return ok ? 'File deleted' : 'Delete failed';
    }
    
    // Search/list operations
    if (toolName === 'list_workflows' || toolName === 'list_local_workflows') {
      const count = result?.workflows?.length || 0;
      return `Found ${count} workflow${count !== 1 ? 's' : ''}`;
    }
    if (toolName === 'search_tools') {
      const count = result?.tools?.length || result?.results?.length || 0;
      return `Found ${count} tool${count !== 1 ? 's' : ''}`;
    }
    
    // Custom UI
    if (toolName === 'custom_ui') {
      const action = result?.action;
      if (action === 'submit') return 'User submitted form';
      if (action === 'cancel' || action === 'close') return 'User closed window';
      return result?.ok ? 'Window shown' : 'Failed to show window';
    }
    
    // Variable operations  
    if (toolName === 'set_variable') {
      return `Set ${toolArgs?.name} = ${JSON.stringify(toolArgs?.value)}`;
    }
    if (toolName === 'get_variable') {
      return `${toolArgs?.name} = ${JSON.stringify(result?.value ?? toolArgs?.default ?? 'undefined')}`;
    }
    if (toolName === 'toggle_variable') {
      return `Toggled ${toolArgs?.name} → ${result?.value}`;
    }
    
    // Web/API operations
    if (toolName === 'web_search') {
      const count = result?.results?.length || 0;
      return `Found ${count} result${count !== 1 ? 's' : ''}`;
    }
    if (toolName === 'scrape_url') {
      return ok ? 'Page scraped' : 'Scrape failed';
    }
    
    // AI operations
    if (toolName === 'ai_inference') {
      const hasResponse = result?.text || result?.response || result?.content || result?.embedding;
      return hasResponse ? 'AI responded' : (ok ? 'Completed' : 'Failed');
    }
    
    // Media operations
    if (toolName === 'capture_media') {
      return ok ? `Recording ${toolArgs?.kind || 'media'}` : 'Capture failed';
    }
    if (toolName === 'stop_capture') {
      return ok ? 'Recording stopped' : 'Stop failed';
    }
    if (toolName === 'text_to_speech') {
      return ok ? 'Audio generated' : 'TTS failed';
    }
    
    // Clipboard
    if (toolName === 'get_clipboard_content') {
      const len = result?.content?.length || 0;
      return ok ? `Clipboard: ${len} chars` : 'Failed';
    }
    if (toolName === 'set_clipboard_content') {
      return ok ? 'Copied to clipboard' : 'Copy failed';
    }
    
    // Generic fallback - show ok/error status
    if (ok === true) return 'Completed';
    if (ok === false) return result?.error ? `Error: ${result.error}` : 'Failed';
    return null;
  };

  const summary = evt.result ? getToolSummary(evt.tool, args, evt.result) : null;
  const [showDetails, setShowDetails] = React.useState(false);

  return (
    <div className={`mb-3 rounded-lg border ${resultFailed ? 'border-amber-200 bg-amber-50/30' : 'border-white/[0.08] bg-white/[0.04]'} shadow-sm overflow-hidden transition-all`}>
      <div 
        className={`px-3 py-2 ${resultFailed ? 'bg-amber-50' : 'bg-slate-50/50'} flex items-center justify-between cursor-pointer hover:bg-slate-100/50 transition-colors`}
        onClick={() => setShowDetails(!showDetails)}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className={`w-6 h-6 rounded-md flex items-center justify-center text-[10px] border shadow-sm shrink-0 ${resultFailed ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-white/[0.04] text-indigo-600 border-white/[0.08]'}`}>
            <Zap className="w-3 h-3" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-[11px] font-semibold text-white/80">{formatToolName(evt.tool)}</span>
            {summary && (
              <span className={`text-[10px] truncate ${resultFailed ? 'text-amber-600' : 'text-white/50'}`}>
                {summary}
              </span>
            )}
          </div>
        </div>
        <span className={`text-[10px] font-medium flex items-center gap-1.5 opacity-80 shrink-0 ${statusColor}`}>
          {statusIcon}
        </span>
      </div>

      {showDetails && (
        <div className="px-3 py-2 border-t border-white/[0.04] bg-slate-50/30">
          {resultFailed && resultError && (
            <div className="mb-2 p-2 bg-amber-50 border border-amber-100 rounded text-amber-800 text-[11px] flex gap-2">
              <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold">Error:</span> {resultError}
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <div className="text-[9px] font-semibold text-white/40 uppercase tracking-wider">Args</div>
            <div className="text-[10px] font-mono text-white/70 whitespace-pre-wrap break-all max-h-24 overflow-y-auto scrollbar-light bg-white/[0.04] rounded p-2 border border-white/[0.04]">
              {JSON.stringify(args, null, 2)}
            </div>
            {evt.result && (
              <>
                <div className="text-[9px] font-semibold text-white/40 uppercase tracking-wider mt-2">Result</div>
                <div className="text-[10px] font-mono text-white/70 whitespace-pre-wrap break-all max-h-24 overflow-y-auto scrollbar-light bg-white/[0.04] rounded p-2 border border-white/[0.04]">
                  {JSON.stringify(evt.result, null, 2)}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export function ChatPanel({
  model,
  onApplyModel,
  cloudAiHttp,
  onClose,
  messages,
  setMessages,
  streamItems,
  setStreamItems,
  reasoningText,
  setReasoningText,
  busy,
  setBusy,
  showReasoning,
  setShowReasoning,
  // Validation errors
  errors = [],
  // Session management
  pastSessions = [],
  showSessionHistory = false,
  setShowSessionHistory,
  onNewSession,
  onLoadSession,
  onDeleteSession,
  inputValue,
  onInputChange,
  hideCloseButton
}: ChatPanelProps) {
  // Initialize with welcome message if empty
  useEffect(() => {
    if (messages.length === 0) {
      setMessages([{ role: 'assistant', content: 'Hi! I\'m your Workflow Architect. Describe what you want to change or add to this workflow.' }]);
    }
  }, []);
  const [internalInput, setInternalInput] = useState("");
  const input = inputValue !== undefined ? inputValue : internalInput;
  const setInput = onInputChange || setInternalInput;

  const [attachedImages, setAttachedImages] = useState<Array<{ path: string; name: string; dataUrl?: string; data?: string; mimeType?: string }>>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamItems, reasoningText, showReasoning]);

  return (
    <div className="flex flex-col h-full w-full bg-[#fdfdfd] font-sans overflow-hidden">
      <div className="h-12 border-b border-white/[0.08] flex items-center justify-between px-4 bg-white/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 bg-blue-50 rounded-lg flex items-center justify-center border border-blue-100">
            <Sparkles className="w-3.5 h-3.5 text-blue-600" />
          </div>
          <span className="font-semibold text-[13px] text-white/90">Architect</span>
        </div>
        <div className="flex items-center gap-1">
          {onNewSession && (
            <button
              onClick={onNewSession}
              title="New chat"
              className="p-1.5 text-white/40 hover:text-white/80 hover:bg-white/[0.1] rounded-md transition-colors"
            >
              <Plus className="w-4 h-4" />
            </button>
          )}
          {setShowSessionHistory && pastSessions.length > 0 && (
            <button
              onClick={() => setShowSessionHistory(!showSessionHistory)}
              title="Chat history"
              className={`p-1.5 rounded-md transition-colors ${showSessionHistory ? 'text-blue-600 bg-blue-50' : 'text-white/40 hover:text-white/80 hover:bg-white/[0.1]'}`}
            >
              <History className="w-4 h-4" />
            </button>
          )}
          {!hideCloseButton && (
            <button onClick={onClose} className="p-1.5 text-white/40 hover:text-white/80 hover:bg-white/[0.1] rounded-md transition-colors">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
      
      {/* Session History Dropdown */}
      {showSessionHistory && pastSessions.length > 0 && (
        <div className="border-b border-white/[0.08] bg-slate-50/50 max-h-64 overflow-y-auto scrollbar-minimal shadow-inner">
          {pastSessions.map((session) => (
            <div
              key={session.id}
              className="group px-4 py-3 hover:bg-white/[0.04] border-b border-white/[0.04] last:border-0 cursor-pointer flex items-start justify-between gap-3 transition-colors"
              onClick={() => onLoadSession && onLoadSession(session.id)}
            >
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-medium text-white/80 truncate mb-0.5">
                  {session.title}
                </div>
                <div className="text-[10px] text-white/40 flex items-center gap-1.5">
                  <Clock className="w-3 h-3" />
                  {formatSessionTime(session.updatedAt)}
                  <span className="w-0.5 h-0.5 rounded-full bg-slate-300" />
                  {session.messages.length} msgs
                </div>
              </div>
              {onDeleteSession && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm('Delete this session?')) onDeleteSession(session.id);
                  }}
                  className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-md opacity-0 group-hover:opacity-100 transition-all"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto scrollbar-light p-4 space-y-5 bg-[#fdfdfd]">
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 border shadow-sm mt-0.5
              ${msg.role === 'user' 
                ? 'bg-white/[0.06] border-white/[0.08] text-white/70' 
                : 'bg-indigo-600 border-indigo-700 text-white'}`}>
              {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
            </div>
            
            <div className={`flex flex-col gap-1.5 max-w-[85%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              {msg.images && msg.images.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-1 justify-end">
                  {msg.images.map((img, idx) => (
                    <div key={idx} className="relative rounded-lg overflow-hidden border border-white/[0.08] shadow-sm max-w-[200px]">
                      <img src={img.dataUrl || toMediaSrc(img.path)} alt="Attached" className="max-h-48 object-cover" />
                    </div>
                  ))}
                </div>
              )}
              
              <div className={`px-4 py-3 rounded-2xl shadow-sm text-sm leading-relaxed
                ${msg.role === 'user' 
                  ? 'bg-slate-900 text-white rounded-tr-sm' 
                  : 'bg-white/[0.04] border border-white/[0.08] text-white/80 rounded-tl-sm'}`}>
                <div className="markdown-body">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[rehypeKatex]}
                  components={{
                    img: (props) => <ChatImage {...props as any} />,
                    p: ({children}) => <p className="mb-2 last:mb-0">{children}</p>,
                    a: ({node, ...props}) => <a {...props} className="text-indigo-500 hover:underline" target="_blank" rel="noopener noreferrer" />,
                    pre: ({ children, ...props }: any) => {
                      let childProps: any = {};
                      let codeContent = children;
                      if (React.isValidElement(children)) {
                        childProps = children.props || {};
                        codeContent = childProps.children;
                      } else if (Array.isArray(children) && children.length === 1 && React.isValidElement(children[0])) {
                        childProps = children[0].props || {};
                        codeContent = childProps.children;
                      }

                      const className = childProps.className || '';
                      
                      return (
                        <div className="my-4 rounded-xl overflow-hidden bg-white/[0.04] border border-white/[0.08] shadow-sm flex flex-col">
                          <div className="bg-white/[0.06] px-4 py-2 border-b border-white/[0.08] flex items-center justify-between">
                            <span className="text-xs text-white/50 font-mono uppercase tracking-wider">{className.replace('language-', '') || 'code'}</span>
                          </div>
                          <div className="overflow-x-auto overflow-y-auto max-h-[400px] custom-scrollbar p-4 bg-slate-50/50">
                            <code className={clsx(className, "font-mono text-[13px] inline-block min-w-full leading-[1.7] text-white/90 whitespace-pre tab-4")} {...childProps}>{codeContent}</code>
                          </div>
                        </div>
                      );
                    },
                    code: ({ className, children, ...props }: any) => {
                      const isInline = !String(className).includes('language-');
                      return isInline ? (
                        <code className="bg-white/[0.06] text-white/90 px-[6px] py-[2px] rounded-md text-[85%] font-mono font-medium border border-white/[0.08] shadow-sm align-middle" {...props}>
                          {children}
                        </code>
                      ) : (
                        <code className={className} {...props}>
                          {children}
                        </code>
                      );
                    }
                  }}
                >
                  {preprocessMessageContent(msg.content)}
                </ReactMarkdown>
                </div>
              </div>

              {/* Show reasoning if present in history */}
              {msg.reasoning && (
                <div className="w-full">
                  <ReasoningBlock 
                    text={msg.reasoning} 
                    isOpen={false} 
                    onToggle={() => {}} // History items don't toggle state
                    isComplete={true}
                    duration={msg.reasoningDuration}
                  />
                </div>
              )}

              {/* Show tool calls from history */}
              {msg.parts && msg.parts.length > 0 && (
                <div className="w-full space-y-2 mt-1">
                  {msg.parts
                    .filter(p => p.type === 'tool')
                    .map((p: any, idx) => (
                      <ToolCallItem key={idx} evt={p.event} />
                    ))
                  }
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Current Streaming Response */}
        {(streamItems.length > 0 || busy || reasoningText) && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-indigo-600 border border-indigo-700 text-white flex items-center justify-center shrink-0 shadow-sm mt-0.5">
              <Bot className="w-4 h-4" />
            </div>
            <div className="flex flex-col gap-2 max-w-[85%] w-full">
              {/* Reasoning Block */}
              {(reasoningText || showReasoning) && (
                <ReasoningBlock 
                  text={reasoningText} 
                  isOpen={showReasoning} 
                  onToggle={() => setShowReasoning(!showReasoning)} 
                  isComplete={!busy}
                />
              )}

              {/* Tools & Content */}
              {streamItems.map((item, i) => (
                item.type === 'text' ? (
                  <div key={i} className="px-4 py-3 rounded-2xl rounded-tl-sm bg-white/[0.04] border border-white/[0.08] text-white/80 shadow-sm text-sm leading-relaxed">
                    <ReactMarkdown 
                      remarkPlugins={[remarkGfm, remarkMath]} 
                      rehypePlugins={[rehypeKatex]}
                      components={{
                        img: (props) => <ChatImage {...props as any} />,
                        p: ({children}) => <p className="mb-2 last:mb-0">{children}</p>,
                        a: ({node, ...props}) => <a {...props} className="text-indigo-500 hover:underline" target="_blank" rel="noopener noreferrer" />,
                        pre: ({ children, ...props }: any) => {
                          let childProps: any = {};
                          let codeContent = children;
                          if (React.isValidElement(children)) {
                            childProps = children.props || {};
                            codeContent = childProps.children;
                          } else if (Array.isArray(children) && children.length === 1 && React.isValidElement(children[0])) {
                            childProps = children[0].props || {};
                            codeContent = childProps.children;
                          }

                          const className = childProps.className || '';
                          
                          return (
                        <div className="my-4 rounded-xl overflow-hidden bg-white/[0.04] border border-white/[0.08] shadow-sm flex flex-col">
                          <div className="bg-white/[0.06] px-4 py-2 border-b border-white/[0.08] flex items-center justify-between">
                            <span className="text-xs text-white/50 font-mono uppercase tracking-wider">{className.replace('language-', '') || 'code'}</span>
                          </div>
                          <div className="overflow-x-auto overflow-y-auto max-h-[400px] custom-scrollbar p-4 bg-slate-50/50">
                            <code className={clsx(className, "font-mono text-[13px] inline-block min-w-full leading-[1.7] text-white/90 whitespace-pre tab-4")} {...childProps}>{codeContent}</code>
                          </div>
                        </div>
                          );
                        },
                        code: ({ className, children, ...props }: any) => {
                          const isInline = !String(className).includes('language-');
                          return isInline ? (
                            <code className="bg-white/[0.06] text-white/90 px-[6px] py-[2px] rounded-md text-[85%] font-mono font-medium border border-white/[0.08] shadow-sm align-middle" {...props}>
                              {children}
                            </code>
                          ) : (
                            <code className={className} {...props}>
                              {children}
                            </code>
                          );
                        }
                      }}
                    >
                      {preprocessMessageContent(item.content)}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <ToolCallItem key={i} evt={item.event} />
                )
              ))}
              
              {busy && streamItems.length === 0 && !reasoningText && (
                <div className="flex items-center gap-2 text-white/40 text-xs px-2 py-1">
                  <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" />
                  <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce delay-75" />
                  <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce delay-150" />
                </div>
              )}
            </div>
          </div>
        )}
        
        {errors.length > 0 && (
          <div className="mx-auto my-4 max-w-sm">
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 shadow-sm">
              <div className="flex items-center gap-2 text-amber-800 font-medium text-xs mb-2">
                <AlertCircle className="w-3.5 h-3.5" />
                <span>Workflow Issues Detected</span>
              </div>
              <ul className="space-y-1">
                {errors.slice(0, 3).map((e, i) => (
                  <li key={i} className="text-[11px] text-amber-700 flex items-start gap-1.5">
                    <span className="mt-1 w-1 h-1 rounded-full bg-amber-400 shrink-0" />
                    {e.message}
                  </li>
                ))}
                {errors.length > 3 && (
                  <li className="text-[10px] text-amber-600 pl-2.5">
                    + {errors.length - 3} more issues
                  </li>
                )}
              </ul>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}


