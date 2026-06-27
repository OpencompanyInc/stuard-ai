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
]);

// Convert local file path to file:// URL for Electron
function toMediaSrc(src: string): string {
  if (!src) return '';
  if (/^(https?:|data:|file:)/i.test(src)) return src;
  let path = src.trim();
  if (/^[a-zA-Z]:[/\\]/.test(path)) {
    path = path.replace(/\\/g, '/');
    return `file:///${path}`;
  }
  if (path.startsWith('/')) return `file://${path}`;
  return `file:///${path.replace(/\\/g, '/')}`;
}

// Pre-process text to convert <<...>> and raw audio paths to Markdown image syntax
// This allows us to intercept the 'img' component in ReactMarkdown and render AudioPlayer/ChatImage
function preprocessMessageContent(content: string): string {
  if (!content) return '';
  
  // 1. Replace <<path>> with ![attachment](path)
  let processed = content.replace(/<<([^<>]+)>>/g, '![attachment]($1)');
  
  // 2. Replace raw audio paths with ![audio](path)
  // Look for standalone paths at start of line or preceded by whitespace
  // Regex matches: Drive:\... or /... ending in audio ext
  const rawAudioRegex = /(^|[\s\n])((?:[a-zA-Z]:\\[^<>:"|?*\n\r]+\.(?:wav|mp3|ogg|m4a|aac|webm))|(?:\/[^<>:"|?*\n\r]+\.(?:wav|mp3|ogg|m4a|aac|webm)))(?=$|[\s\n])/gmi;
  
  processed = processed.replace(rawAudioRegex, '$1![audio]($2)');
  
  return processed;
}

// Image component for local/web images in chat
export const ChatImage: React.FC<{ src: string; alt?: string }> = ({ src, alt }) => {
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState(false);
  const imageSrc = toMediaSrc(src || '');
  
  // Check if it's an audio file based on extension or alt text
  const isAudio = /\.(wav|mp3|ogg|m4a|aac|webm)(\?|$)/i.test(imageSrc) || alt === 'audio';
  
  if (isAudio) {
    return <AudioPlayer src={imageSrc} className="my-2 max-w-sm" />;
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
      <div className={`absolute inset-0 bg-slate-100 rounded-lg animate-pulse ${loaded ? 'hidden' : 'block'}`} />
      <img
        src={imageSrc}
        alt={alt || 'Image'}
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
        className={`max-w-full max-h-[240px] rounded-lg border border-slate-200 shadow-sm object-contain bg-white transition-all duration-300 ${loaded ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}
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
  if (name === 'workflow_modify') return 'Modify Workflow';
  if (name === 'create_workflow') return 'Create Workflow';
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Operation specific details
const OperationDetails = ({ args }: { args: any }) => {
  const { operation } = args;
  
  switch (operation) {
    case 'add_node':
      return (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-emerald-700 font-medium">
            <div className="p-1 bg-emerald-100 rounded text-emerald-600">
              <Plus className="w-3 h-3" />
            </div>
            <span>Adding step: <span className="text-slate-900">{args.label || args.tool}</span></span>
          </div>
          {args.connectFrom && (
            <div className="flex items-center gap-1.5 text-slate-500 pl-8 text-[10px]">
              <Link className="w-3 h-3" />
              <span>Connecting from {args.connectFrom}</span>
            </div>
          )}
        </div>
      );
    case 'add_trigger':
      return (
        <div className="flex items-center gap-2 text-emerald-700 font-medium">
          <div className="p-1 bg-emerald-100 rounded text-emerald-600">
            <Zap className="w-3 h-3" />
          </div>
          <span>Adding trigger: <span className="text-slate-900">{args.type}</span></span>
        </div>
      );
    case 'replace_trigger':
      return (
        <div className="flex items-center gap-2 text-amber-700 font-medium">
          <div className="p-1 bg-amber-100 rounded text-amber-600">
            <RotateCw className="w-3 h-3" />
          </div>
          <span>Changing trigger to: <span className="text-slate-900">{args.type}</span></span>
        </div>
      );
    case 'connect':
      return (
        <div className="flex items-center gap-2 text-indigo-700 font-medium">
          <div className="p-1 bg-indigo-100 rounded text-indigo-600">
            <Link className="w-3 h-3" />
          </div>
          <span>Connecting <span className="text-slate-900">{args.from}</span> to <span className="text-slate-900">{args.to}</span></span>
        </div>
      );
    case 'disconnect':
      return (
        <div className="flex items-center gap-2 text-slate-600 font-medium">
          <div className="p-1 bg-slate-100 rounded text-slate-500">
            <Unlink className="w-3 h-3" />
          </div>
          <span>Disconnecting <span className="text-slate-900">{args.from}</span> from <span className="text-slate-900">{args.to}</span></span>
        </div>
      );
    case 'remove_node':
      return (
        <div className="flex items-center gap-2 text-red-700 font-medium">
          <div className="p-1 bg-red-100 rounded text-red-600">
            <Trash2 className="w-3 h-3" />
          </div>
          <span>Removing step: <span className="text-slate-900">{args.nodeId}</span></span>
        </div>
      );
    case 'update_node':
      return (
        <div className="flex items-center gap-2 text-blue-700 font-medium">
          <div className="p-1 bg-blue-100 rounded text-blue-600">
            <Edit className="w-3 h-3" />
          </div>
          <span>Updating step: <span className="text-slate-900">{args.nodeId}</span></span>
        </div>
      );
    case 'rename':
      return (
        <div className="flex items-center gap-2 text-slate-700 font-medium">
          <div className="p-1 bg-slate-100 rounded text-slate-600">
            <Type className="w-3 h-3" />
          </div>
          <span>Renaming to: <span className="text-slate-900">{args.name}</span></span>
        </div>
      );
    default:
      // Fallback for low-level ops
      return (
        <div className="flex items-center gap-2 text-slate-600 font-medium">
          <div className="p-1 bg-slate-100 rounded text-slate-500">
            <Settings className="w-3 h-3" />
          </div>
          <span>{args.operation || 'Modifying'}: <span className="text-slate-900">{args.path}</span></span>
        </div>
      );
  }
};

// UpdateWorkflowView shows the changes being applied
const UpdateWorkflowView = ({ args, result }: { args: any, result?: any }) => {
  const resultWorkflow = result?.workflow;
  const resultChanges = result?.changes;
  const rawError = result?.error;
  const errorDetails = result?.errorDetails;
  
  // Handle old-style create_workflow result
  const resultSpec = result?.spec;
  const diff = result?.diff as Array<{ type: '+' | '-'; text: string }> | undefined;
  
  const resultError = typeof rawError === 'string' && rawError.trim().length > 0 ? rawError : undefined;
  const resultOk = result?.ok === true || result?.ok === 'true';
  const resultFailed = result?.ok === false || result?.ok === 'false';

  const hasError = resultError || resultFailed;
  const errorMessage = resultError || (resultFailed ? 'Update failed' : null);

  const showSuccess = resultOk;
  const showError = hasError && errorMessage;
  const showPending = !result;

  return (
    <div className="mt-3 flex flex-col gap-px text-[11px] border border-slate-200 rounded-lg bg-white overflow-hidden shadow-sm max-w-md">
      {/* Header */}
      <div className="bg-slate-50/80 px-3 py-2 text-slate-700 text-[10px] font-semibold uppercase tracking-wider border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1 bg-white rounded-md border border-slate-200 shadow-sm">
            <Sparkles className="w-3 h-3 text-indigo-500" />
          </div>
          <span>Workflow Update</span>
        </div>
        {showSuccess && <span className="text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">Applied</span>}
        {showError && <span className="text-red-600 bg-red-50 px-1.5 py-0.5 rounded border border-red-100">Failed</span>}
      </div>

      {/* Operation Request */}
      <div className="px-3 py-2.5 bg-white border-b border-slate-50">
        <OperationDetails args={args} />
      </div>

      {/* Error State */}
      {showError && (
        <div className="bg-red-50/50 text-red-800 p-3 border-b border-red-100">
          <div className="flex gap-2">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="font-semibold text-[10px] uppercase mb-1 text-red-600">Error</div>
              <div className="text-[11px] opacity-90 whitespace-pre-wrap">{errorMessage}</div>
              {errorDetails?.validationErrors && (
                <div className="mt-2 space-y-0.5">
                  {errorDetails.validationErrors.map((err: string, i: number) => (
                    <div key={i} className="text-[10px] font-mono bg-red-100/50 px-2 py-0.5 rounded">
                      <span className="text-red-600 font-bold mr-1">-</span>{err}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Success State */}
      {showSuccess && (
        <div className="bg-emerald-50/30 text-emerald-900 p-3">
          {/* Summary of changes */}
          {resultChanges && (
            <div className="flex gap-2 mb-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-[10px] uppercase mb-0.5 text-emerald-600">Changes</div>
                <div className="text-[11px] opacity-90">{resultChanges}</div>
              </div>
            </div>
          )}

          {/* Workflow Stats */}
          {(resultWorkflow || resultSpec) && (
            <div className="mt-2 flex items-center gap-3 text-[10px] text-slate-500 font-medium">
              <span className="flex items-center gap-1 bg-white px-1.5 py-0.5 rounded border border-slate-100">
                <Zap className="w-3 h-3 text-amber-500" />
                {(resultWorkflow?.triggers?.length || resultSpec?.triggers?.length || 0)} Triggers
              </span>
              <span className="flex items-center gap-1 bg-white px-1.5 py-0.5 rounded border border-slate-100">
                <FileText className="w-3 h-3 text-indigo-500" />
                {(resultWorkflow?.nodes?.length || resultSpec?.nodes?.length || 0)} Steps
              </span>
            </div>
          )}

          {/* Legacy Diff View (for create_workflow) */}
          {diff && diff.length > 0 && (
            <div className="mt-2 pt-2 border-t border-emerald-100">
              <div className="font-mono text-[11px] space-y-0.5">
                {diff.map((line, i) => (
                  <div
                    key={i}
                    className={`px-2 py-0.5 rounded ${
                      line.type === '+'
                        ? 'bg-emerald-100/50 text-emerald-800'
                        : 'bg-red-100/50 text-red-800'
                    }`}
                  >
                    <span className="font-bold mr-1">{line.type}</span>
                    {line.text}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Pending State */}
      {showPending && (
        <div className="bg-white p-3">
          <div className="text-[11px] flex items-center gap-2 text-slate-500">
            <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
            Applying changes to workflow...
          </div>
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
    <div className="mt-3 flex flex-col gap-px text-[11px] border border-slate-200 rounded-lg bg-white overflow-hidden shadow-sm max-w-md">
      {/* Header */}
      <div className="bg-slate-50/80 px-3 py-2 text-slate-700 text-[10px] font-semibold uppercase tracking-wider border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1 bg-white rounded-md border border-slate-200 shadow-sm">
            <Zap className="w-3 h-3 text-indigo-500" />
          </div>
          <span>Test Run</span>
        </div>
        {isSuccess && <span className="text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">Passed</span>}
        {isFailed && <span className="text-red-600 bg-red-50 px-1.5 py-0.5 rounded border border-red-100">Failed</span>}
        {isRunning && <span className="text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100 flex items-center gap-1"><RotateCw className="w-3 h-3 animate-spin" />Running</span>}
      </div>

      {/* Tool Being Tested */}
      <div className="px-3 py-2.5 bg-white border-b border-slate-50">
        <div className="flex items-center gap-2 text-slate-700 font-medium">
          <div className="p-1 bg-indigo-100 rounded text-indigo-600">
            <Zap className="w-3 h-3" />
          </div>
          <span>Testing: <span className="text-slate-900 font-semibold">{formatToolName(testedTool)}</span></span>
        </div>
        {Object.keys(testedArgs).length > 0 && (
          <div className="mt-2 text-[10px] font-mono text-slate-500 bg-slate-50 rounded p-2 max-h-20 overflow-y-auto scrollbar-light">
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
                {duration && <span className="text-slate-400 font-normal">{duration}ms</span>}
              </div>
              <div className="text-[11px] bg-white rounded p-2 border border-emerald-100 font-mono overflow-x-auto max-h-40 scrollbar-light">
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
        <div className="bg-slate-50/50 p-3 border-t border-slate-100">
          <div className="font-semibold text-[10px] uppercase mb-2 text-slate-600">Assertions</div>
          <div className="space-y-1">
            {assertions.map((a: any, i: number) => (
              <div key={i} className={`flex items-center gap-2 text-[11px] ${a.passed ? 'text-emerald-700' : 'text-red-700'}`}>
                {a.passed ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                <span className="font-medium">{a.type}</span>
                {a.message && <span className="text-slate-500">— {a.message}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Running State */}
      {isRunning && (
        <div className="bg-white p-3">
          <div className="text-[11px] flex items-center gap-2 text-slate-500">
            <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
            Executing {formatToolName(testedTool)}...
          </div>
        </div>
      )}
    </div>
  );
};

export const ToolCallItem = ({ evt }: { evt: ToolEvent }) => {
  const isWorkflowTool = evt.tool === 'workflow_modify' || evt.tool === 'create_workflow';
  const isTestStep = evt.tool === 'test_step';
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

  return (
    <div className={`mb-3 rounded-lg border ${resultFailed ? 'border-amber-200 bg-amber-50/30' : 'border-slate-200 bg-white'} shadow-sm overflow-hidden transition-all group`}>
      <div className={`px-3 py-2 ${resultFailed ? 'bg-amber-50' : 'bg-slate-50/50'} flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <div className={`w-6 h-6 rounded-md flex items-center justify-center text-[10px] border shadow-sm ${resultFailed ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-white text-indigo-600 border-slate-200'}`}>
            <Zap className="w-3 h-3" />
          </div>
          <span className="text-[11px] font-semibold text-slate-700">{formatToolName(evt.tool)}</span>
        </div>
        <span className={`text-[10px] font-medium flex items-center gap-1.5 opacity-80 ${statusColor}`}>
          {statusIcon}
        </span>
      </div>

      <div className="px-3 py-2 hidden group-hover:block transition-all border-t border-slate-100">
        {resultFailed && resultError && (
          <div className="mb-2 p-2 bg-amber-50 border border-amber-100 rounded text-amber-800 text-[11px] flex gap-2">
            <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">Error:</span> {resultError}
            </div>
          </div>
        )}
        <div className="text-[10px] font-mono text-slate-500 whitespace-pre-wrap break-all max-h-32 overflow-y-auto scrollbar-light">
          {JSON.stringify(args, null, 2)}
        </div>
      </div>
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
      <div className="h-12 border-b border-slate-200/80 flex items-center justify-between px-4 bg-white/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 bg-indigo-50 rounded-lg flex items-center justify-center border border-indigo-100">
            <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
          </div>
          <span className="font-semibold text-[13px] text-slate-800">Architect</span>
        </div>
        <div className="flex items-center gap-1">
          {onNewSession && (
            <button
              onClick={onNewSession}
              title="New chat"
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
            >
              <Plus className="w-4 h-4" />
            </button>
          )}
          {setShowSessionHistory && pastSessions.length > 0 && (
            <button
              onClick={() => setShowSessionHistory(!showSessionHistory)}
              title="Chat history"
              className={`p-1.5 rounded-md transition-colors ${showSessionHistory ? 'text-indigo-600 bg-indigo-50' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'}`}
            >
              <History className="w-4 h-4" />
            </button>
          )}
          {!hideCloseButton && (
            <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
      
      {/* Session History Dropdown */}
      {showSessionHistory && pastSessions.length > 0 && (
        <div className="border-b border-slate-200 bg-slate-50/50 max-h-64 overflow-y-auto scrollbar-minimal shadow-inner">
          {pastSessions.map((session) => (
            <div
              key={session.id}
              className="group px-4 py-3 hover:bg-white border-b border-slate-100 last:border-0 cursor-pointer flex items-start justify-between gap-3 transition-colors"
              onClick={() => onLoadSession && onLoadSession(session.id)}
            >
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-medium text-slate-700 truncate mb-0.5">
                  {session.title}
                </div>
                <div className="text-[10px] text-slate-400 flex items-center gap-1.5">
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
                ? 'bg-slate-100 border-slate-200 text-slate-600' 
                : 'bg-indigo-600 border-indigo-700 text-white'}`}>
              {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
            </div>
            
            <div className={`flex flex-col gap-1.5 max-w-[85%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              {msg.images && msg.images.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-1 justify-end">
                  {msg.images.map((img, idx) => (
                    <div key={idx} className="relative rounded-lg overflow-hidden border border-slate-200 shadow-sm max-w-[200px]">
                      <img src={img.dataUrl || toMediaSrc(img.path)} alt="Attached" className="max-h-48 object-cover" />
                    </div>
                  ))}
                </div>
              )}
              
              <div className={`px-4 py-3 rounded-2xl shadow-sm text-sm leading-relaxed
                ${msg.role === 'user' 
                  ? 'bg-slate-900 text-white rounded-tr-sm' 
                  : 'bg-white border border-slate-200 text-slate-700 rounded-tl-sm'}`}>
                <div className="markdown-body">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[rehypeKatex]}
                  components={{
                    img: (props) => <ChatImage {...props as any} />,
                    p: ({children}) => <p className="mb-2 last:mb-0">{children}</p>,
                    a: ({node, ...props}) => <a {...props} className="text-indigo-500 hover:underline" target="_blank" rel="noopener noreferrer" />,
                    code: ({node, className, children, ...props}) => {
                      const match = /language-(\w+)/.exec(className || '')
                      return !String(className).includes('language-') ? (
                        <code className={`${msg.role === 'user' ? 'bg-slate-800' : 'bg-slate-100'} px-1.5 py-0.5 rounded text-[12px] font-mono`} {...props}>
                          {children}
                        </code>
                      ) : (
                        <code className={className} {...props}>
                          {children}
                        </code>
                      )
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
                  <div key={i} className="px-4 py-3 rounded-2xl rounded-tl-sm bg-white border border-slate-200 text-slate-700 shadow-sm text-sm leading-relaxed">
                    <ReactMarkdown 
                      remarkPlugins={[remarkGfm, remarkMath]} 
                      rehypePlugins={[rehypeKatex]}
                      components={{
                        img: (props) => <ChatImage {...props as any} />,
                        p: ({children}) => <p className="mb-2 last:mb-0">{children}</p>,
                        a: ({node, ...props}) => <a {...props} className="text-indigo-500 hover:underline" target="_blank" rel="noopener noreferrer" />,
                        code: ({node, className, children, ...props}) => (
                          <code className="bg-slate-100 px-1.5 py-0.5 rounded text-[12px] font-mono" {...props}>
                            {children}
                          </code>
                        )
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
                <div className="flex items-center gap-2 text-slate-400 text-xs px-2 py-1">
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

