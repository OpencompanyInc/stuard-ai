import React, { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import clsx from "clsx";
import { User, Bot, AlertCircle, CheckCircle2, RotateCw, Zap, Sparkles, X, Undo2, Plus, History, Clock, Trash2, ExternalLink, Folder, Copy, Check } from "lucide-react";
import { ModelSelector } from "../../../components/ModelSelector";
import { AudioPlayer } from "../../../components/AudioPlayer";
import { ReasoningBlock } from "../../../components/ReasoningBlock";
import type { Message, StreamItem, ToolEvent } from "../../hooks/useWorkflowChat";

// --- Helpers ---

// --- File path detection & actions for tool results ---
const FILE_PATH_RE = /^([a-zA-Z]:[/\\]|\/(?:tmp|var|home|Users)\/).+\.\w{1,5}$/;
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'flac', 'aac', 'opus', 'm4a']);

function isFilePath(v: unknown): v is string {
  return typeof v === 'string' && FILE_PATH_RE.test(v.trim());
}

function extractFilePaths(result: any): string[] {
  const paths: string[] = [];
  if (!result || typeof result !== 'object') return paths;
  const walk = (obj: any) => {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) { obj.forEach(walk); return; }
    for (const [, val] of Object.entries(obj)) {
      if (isFilePath(val)) paths.push(val as string);
      else if (typeof val === 'object' && val) walk(val);
    }
  };
  walk(result);
  return [...new Set(paths)];
}

const FilePathActions: React.FC<{ filePath: string }> = ({ filePath }) => {
  const [copied, setCopied] = React.useState(false);
  const ext = (filePath.match(/\.([a-zA-Z0-9]+)$/)?.[1] || '').toLowerCase();
  const isImage = IMAGE_EXTS.has(ext);
  const isAudio = AUDIO_EXTS.has(ext);
  const fileName = filePath.split(/[/\\]/).pop() || filePath;

  const copyPath = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(filePath);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const openFile = (e: React.MouseEvent) => {
    e.stopPropagation();
    try { (window as any).desktopAPI?.openPath?.(filePath); } catch {}
  };
  const revealInFolder = (e: React.MouseEvent) => {
    e.stopPropagation();
    try { (window as any).desktopAPI?.showItemInFolder?.(filePath); } catch {}
  };

  return (
    <div className="flex items-center gap-1.5 bg-white/[0.04] border border-white/[0.08] rounded-md px-2 py-1.5 my-0.5">
      <span className="text-[10px] text-white/40 shrink-0">
        {isImage ? '🖼' : isAudio ? '🔊' : '📄'}
      </span>
      <span className="text-[10px] font-medium text-white/70 truncate max-w-[200px]" title={filePath}>
        {fileName}
      </span>
      <div className="flex items-center gap-0.5 ml-auto shrink-0">
        <button onClick={openFile} className="p-0.5 rounded hover:bg-white/10 transition-colors" title="Open file">
          <ExternalLink className="w-3 h-3 text-white/40 hover:text-white/70" />
        </button>
        <button onClick={revealInFolder} className="p-0.5 rounded hover:bg-white/10 transition-colors" title="Show in folder">
          <Folder className="w-3 h-3 text-white/40 hover:text-white/70" />
        </button>
        <button onClick={copyPath} className="p-0.5 rounded hover:bg-white/10 transition-colors" title="Copy path">
          {copied
            ? <Check className="w-3 h-3 text-emerald-400" />
            : <Copy className="w-3 h-3 text-white/40 hover:text-white/70" />
          }
        </button>
      </div>
    </div>
  );
};

function toMediaSrc(src: string): string {
  if (!src) return '';
  if (/^(https?:|data:|file:)/i.test(src)) return src;
  let path = src.trim();

  // Handle Windows paths
  if (/^[a-zA-Z]:[/\\]/.test(path)) {
    path = path.replace(/\\/g, '/');
    const parts = path.split('/');
    // Encode parts but preserve drive letter colon
    const encodedPath = parts.map((p, i) => i === 0 ? p : encodeURIComponent(p)).join('/');
    return `file:///${encodedPath}`;
  }

  if (path.startsWith('/')) {
    const encodedPath = path.split('/').map(p => encodeURIComponent(p)).join('/');
    return `file://${encodedPath}`;
  }

  // Fallback
  return `file:///${path.replace(/\\/g, '/').split('/').map(p => encodeURIComponent(p)).join('/')}`;
}

function preprocessMessageContent(content: string): string {
  if (!content) return '';
  // Escape dollar signs used for currency to prevent LaTeX parsing
  let processed = content.replace(/\$(\d[\d,]*\.?\d*)/g, '\\$$$1');
  processed = processed.replace(/<<([^<>]+)>>/g, '![attachment](<$1>)');

  // Comprehensive regex for media paths (Windows and Unix)
  // Matches files ending in common media extensions that are not already in markdown
  const mediaPathRegex = /(^|[\s\n])(?!!\[)((?:[a-zA-Z]:\\[^<>:"|?*\n\r]+|(?:\/[^<>:"|?*\n\r]+))\.(?:mp4|webm|mov|wav|mp3|ogg|m4a|aac|png|jpg|jpeg|gif|webp))(?=$|[\s\n])/gmi;

  processed = processed.replace(mediaPathRegex, (match, prefix, path) => {
    const ext = path.toLowerCase().split('.').pop();
    let type = 'image';
    if (['mp4', 'webm', 'mov'].includes(ext)) type = 'video';
    else if (['wav', 'mp3', 'ogg', 'm4a', 'aac'].includes(ext)) type = 'audio';
    return `${prefix}![${type}](<${path}>)`;
  });

  return processed;
}

const ChatMedia: React.FC<{ src: string; alt?: string }> = ({ src, alt }) => {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const mediaSrc = toMediaSrc(src || '');

  const isAudio = /\.(wav|mp3|ogg|m4a|aac)(\?|$)/i.test(mediaSrc) || alt === 'audio';
  const isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(mediaSrc) || alt === 'video';
  const isImage = !isAudio && !isVideo;

  if (error) {
    const fileName = decodeURIComponent(src.split(/[/\\]/).pop() || 'File');
    return (
      <div className="flex items-center gap-2 p-3 my-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs max-w-sm">
        <AlertCircle className="w-4 h-4 shrink-0" />
        <div className="flex flex-col truncate">
          <span className="font-semibold uppercase text-[9px] opacity-70">Failed to load {alt || 'Media'}</span>
          <span className="truncate" title={src}>{fileName}</span>
        </div>
      </div>
    );
  }

  if (isAudio) {
    return <AudioPlayer src={mediaSrc} className="my-2 max-w-sm" />;
  }

  if (isVideo) {
    return (
      <span className="block my-2 relative group max-w-2xl">
        <video
          src={mediaSrc}
          controls
          preload="metadata"
          crossOrigin="anonymous"
          className="w-full rounded-lg border border-white/[0.08] shadow-sm bg-black/50 max-h-[400px]"
          onError={(e) => {
            console.error(`[ChatMedia] Video load error for ${mediaSrc}:`, e.currentTarget.error);
            setError(true);
          }}
        />
      </span>
    );
  }

  return (
    <span className="block my-2 relative group">
      <div className={`absolute inset-0 bg-white/[0.04] rounded-lg animate-pulse ${loaded ? 'hidden' : 'block'}`} />
      <img
        src={mediaSrc}
        alt={alt || 'Image'}
        onLoad={() => setLoaded(true)}
        onError={() => {
          console.error(`[ChatMedia] Image load error: ${mediaSrc}`);
          setError(true);
        }}
        className={`max-w-full max-h-[240px] rounded-lg border border-white/[0.08] shadow-sm object-contain bg-black/50 transition-all duration-300 ${loaded ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}
      />
    </span>
  );
};

// --- Tool Rendering ---

function parseModifyWorkflowArgs(jsonStr: string) {
  try {
    return JSON.parse(jsonStr);
  } catch {
    const result: any = {};
    const instrMatch = jsonStr.match(/"instructions"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (instrMatch) {
      try { result.instructions = JSON.parse(`"${instrMatch[1]}"`); } catch { }
    }
    return result;
  }
}

function formatToolName(name: string): string {
  if (name === 'workflow_modify' || name === 'modify_workflow') return 'Modify Workflow';
  if (name === 'create_workflow') return 'Create Workflow';
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

const ModifyWorkflowView = ({
  args,
  result,
  workflowBefore,
  onUndo
}: {
  args: any;
  result?: any;
  workflowBefore?: any;
  onUndo?: (snapshot: any) => void;
}) => {
  const instructions = args?.instructions;
  const resultSpec = result?.spec || result?.workflow;
  const rawError = result?.error;
  const resultError = typeof rawError === 'string' && rawError.trim().length > 0 ? rawError : undefined;
  const resultOk = result?.ok === true || result?.ok === 'true';
  const resultFailed = result?.ok === false || result?.ok === 'false';

  const hasError = resultError || resultFailed;
  const errorMessage = resultError || (resultFailed ? 'Modification failed' : null);

  const showSuccess = resultOk && (resultSpec || result?.changes);
  const showError = hasError && errorMessage;
  const showPending = !result;
  const showUnknown = result && !showSuccess && !showError;

  const canUndo = showSuccess && workflowBefore && onUndo;

  return (
    <div className="mt-3 flex flex-col gap-px text-[11px] border border-white/[0.08] rounded-xl bg-black/20 overflow-hidden shadow-sm">
      <div className="bg-white/[0.02] px-3 py-2 text-white/60 text-[10px] font-semibold uppercase tracking-wider border-b border-white/[0.04] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1 bg-white/[0.04] rounded-md border border-white/[0.06] shadow-sm">
            <Sparkles className="w-3 h-3 text-blue-400" />
          </div>
          {showSuccess ? 'Updates Applied' : showPending ? 'Applying Updates...' : 'Update Status'}
        </div>
        {canUndo && (
          <button
            type="button"
            onClick={() => onUndo(workflowBefore)}
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-white/50 hover:text-blue-400 hover:bg-blue-500/20 rounded-md transition-colors"
            title="Undo this change"
          >
            <Undo2 className="w-3 h-3" />
            Undo
          </button>
        )}
      </div>

      {instructions && (
        <div className="p-3 bg-transparent border-b border-white/[0.04] whitespace-pre-wrap break-words text-white/70">
          <div className="text-[11px] leading-relaxed">{instructions}</div>
        </div>
      )}

      {showError && (
        <div className="bg-red-500/10 text-red-400 p-3 border-b border-red-500/20 whitespace-pre-wrap break-words flex gap-2">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-[10px] uppercase mb-0.5 text-red-500">Failed</div>
            <div className="text-[11px] opacity-90">{errorMessage}</div>
          </div>
        </div>
      )}

      {showSuccess && (
        <div className="bg-emerald-500/10 text-emerald-400 p-3 whitespace-pre-wrap break-words flex gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-[10px] uppercase mb-0.5 text-emerald-500">Success</div>
            <div className="text-[11px] opacity-90">
              {result?.message ? (
                <span>{result.message}</span>
              ) : (
                <span>Updates applied successfully</span>
              )}
            </div>
          </div>
        </div>
      )}

      {showPending && (
        <div className="bg-transparent p-3 whitespace-pre-wrap break-words">
          <div className="text-[11px] flex items-center gap-2 text-white/50">
            <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
            Processing workflow changes...
          </div>
        </div>
      )}

      {showUnknown && (() => {
        const filePaths = extractFilePaths(result);
        return (
          <div className="bg-white/[0.02] text-white/60 p-3 whitespace-pre-wrap break-words">
            {filePaths.length > 0 && (
              <div className="flex flex-col gap-0.5 mb-2">
                {filePaths.map((fp) => <FilePathActions key={fp} filePath={fp} />)}
              </div>
            )}
            <div className="flex select-none text-white/30 mb-1 text-[9px] uppercase font-bold">Raw Result</div>
            <div className="text-[10px] font-mono max-h-24 overflow-y-auto scrollbar-minimal">
              {JSON.stringify(result, null, 2)}
            </div>
          </div>
        );
      })()}
    </div>
  );
};

const ToolCallItem = ({ evt, onUndo }: { evt: ToolEvent; onUndo?: (snapshot: any) => void }) => {
  // execute_tool is a wrapper — show the actual tool being executed
  const rawTool = evt.tool === 'execute_tool' && (evt.args?.tool_name || evt.argsText)
    ? (evt.args?.tool_name || (() => { try { return JSON.parse(evt.argsText || '{}').tool_name; } catch { return evt.tool; } })())
    : evt.tool;
  const toolName = (rawTool || '').toLowerCase().trim();
  const isModify = toolName === 'workflow_modify' || toolName === 'modify_workflow' || toolName === 'create_workflow';
  const args = useMemo(() => {
    if (evt.args) return evt.args;
    if (evt.argsText) {
      if (isModify) return parseModifyWorkflowArgs(evt.argsText);
      try { return JSON.parse(evt.argsText); } catch { return {}; }
    }
    return {};
  }, [evt.args, evt.argsText, isModify]);

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
    isModify && isRunning ? (
      <span className="inline-flex items-center justify-center">
        <RotateCw className="w-3 h-3 animate-spin" />
      </span>
    ) :
      resultFailed ? <AlertCircle className="w-3 h-3" /> :
        evt.status === 'completed' ? <CheckCircle2 className="w-3 h-3" /> :
          evt.status === 'error' || evt.status === 'failed' ? <X className="w-3 h-3" /> :
            <RotateCw className="w-3 h-3" />;

  if (isModify) {
    return (
      <div className="mb-4">
        <ModifyWorkflowView
          args={args}
          result={evt.result}
          workflowBefore={evt.workflowBefore}
          onUndo={onUndo}
        />
      </div>
    );
  }

  return (
    <div className={`mb-3 rounded-xl border ${resultFailed ? 'border-amber-500/30 bg-amber-500/10' : 'border-white/[0.06] bg-black/20'} shadow-sm overflow-hidden transition-all group`}>
      <div className={`px-3 py-2 ${resultFailed ? 'bg-amber-500/20' : 'bg-white/[0.02]'} flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <div className={`w-6 h-6 rounded-md flex items-center justify-center text-[10px] border shadow-sm ${resultFailed ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' : 'bg-white/[0.04] text-indigo-400 border-white/[0.08]'}`}>
            <Zap className="w-3 h-3" />
          </div>
          <span className="text-[11px] font-semibold text-white/80">{formatToolName(rawTool || evt.tool)}</span>
        </div>
        <span className={`text-[10px] font-medium flex items-center gap-1.5 opacity-80 ${statusColor}`}>
          {statusIcon}
        </span>
      </div>

      <div className="px-3 py-2 hidden group-hover:block transition-all border-t border-white/[0.04]">
        {resultFailed && resultError && (
          <div className="mb-2 p-2 bg-amber-500/10 border border-amber-500/20 rounded text-amber-400 text-[11px] flex gap-2">
            <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">Error:</span> {resultError}
            </div>
          </div>
        )}
        <div className="text-[10px] font-mono text-white/50 whitespace-pre-wrap break-all max-h-32 overflow-y-auto scrollbar-minimal">
          {JSON.stringify(args, null, 2)}
        </div>
        {evt.result && (() => {
          const filePaths = extractFilePaths(evt.result);
          return filePaths.length > 0 ? (
            <div className="flex flex-col gap-0.5 mt-2">
              {filePaths.map((fp) => <FilePathActions key={fp} filePath={fp} />)}
            </div>
          ) : null;
        })()}
      </div>
    </div>
  );
};

// --- Main Component ---

interface ChatSession {
  id: string;
  workflowId: string;
  messages: { role: string; content: string }[];
  createdAt: string;
  updatedAt: string;
  title?: string;
}

function formatSessionTime(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function ChatHistory({
  messages,
  streamItems,
  reasoningText,
  showReasoning,
  setShowReasoning,
  busy,
  onUndo,
  // Session management
  pastSessions = [],
  showSessionHistory = false,
  setShowSessionHistory,
  onNewSession,
  onLoadSession,
  onDeleteSession,
}: {
  messages: Message[];
  streamItems: StreamItem[];
  reasoningText: string;
  showReasoning: boolean;
  setShowReasoning: (v: boolean) => void;
  busy: boolean;
  onUndo?: (snapshot: any) => void;
  // Session management
  pastSessions?: ChatSession[];
  showSessionHistory?: boolean;
  setShowSessionHistory?: (show: boolean) => void;
  onNewSession?: () => void;
  onLoadSession?: (sessionId: string) => void;
  onDeleteSession?: (sessionId: string) => void;
}) {
  return (
    <div className="flex flex-col h-full min-h-0 bg-transparent">
      {/* Session History Panel */}
      {showSessionHistory && pastSessions.length > 0 && (
        <div className="border-b border-white/[0.06] bg-black/20 max-h-64 overflow-y-auto scrollbar-minimal shadow-inner">
          <div className="px-3 py-2 text-[10px] font-semibold text-white/40 uppercase tracking-wider border-b border-white/[0.04]">
            Past Conversations
          </div>
          {pastSessions.map((session) => (
            <div
              key={session.id}
              className="group px-3 py-2.5 hover:bg-white/[0.04] border-b border-white/[0.04] last:border-0 cursor-pointer flex items-start justify-between gap-2 transition-colors"
              onClick={() => onLoadSession && onLoadSession(session.id)}
            >
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-medium text-white/80 truncate mb-0.5">
                  {session.title || 'Untitled conversation'}
                </div>
                <div className="text-[10px] text-white/40 flex items-center gap-1.5">
                  <Clock className="w-3 h-3" />
                  {formatSessionTime(session.updatedAt)}
                  <span className="w-0.5 h-0.5 rounded-full bg-white/20" />
                  {session.messages.length} msgs
                </div>
              </div>
              {onDeleteSession && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm('Delete this conversation?')) onDeleteSession(session.id);
                  }}
                  className="p-1 text-white/30 hover:text-red-400 hover:bg-red-500/20 rounded opacity-0 group-hover:opacity-100 transition-all"
                  title="Delete conversation"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto scrollbar-minimal px-4 py-4 space-y-5">
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 border shadow-sm mt-0.5
              ${msg.role === 'user'
                ? 'bg-white/[0.06] border-white/[0.1] text-white/70'
                : 'bg-indigo-500/20 border-indigo-500/30 text-indigo-400'}`}>
              {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
            </div>

            <div className={`flex flex-col gap-1.5 max-w-[90%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              {msg.images && msg.images.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-1 justify-end">
                  {msg.images.map((img, idx) => {
                    const src = img.dataUrl || toMediaSrc(img.path);
                    const isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(src) || (img.mimeType && img.mimeType.startsWith('video/'));

                    return (
                      <div key={idx} className="relative rounded-lg overflow-hidden border border-white/[0.08] shadow-sm max-w-[200px] bg-white/[0.06]">
                        {isVideo ? (
                          <video src={src} className="max-h-48 w-full object-cover" controls={false} muted onMouseOver={e => e.currentTarget.play()} onMouseOut={e => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }} />
                        ) : (
                          <img src={src} alt="Attached" className="max-h-48 object-cover" />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className={`px-4 py-3 rounded-3xl shadow-sm text-[13px] leading-relaxed
                ${msg.role === 'user'
                  ? 'bg-white/[0.08] text-white rounded-tr-sm border border-white/[0.04]'
                  : 'bg-black/20 border border-white/[0.04] text-white/90 rounded-tl-sm'}`}>
                <div className="markdown-body">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[rehypeKatex]}
                    components={{
                      img: (props) => <ChatMedia {...props as any} />,
                      p: ({ children }) => <p className="mb-2 last:mb-0 leading-[1.7]">{children}</p>,
                      a: ({ node, ...props }) => <a {...props} className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2 decoration-indigo-500/30 hover:decoration-indigo-500/50 transition-all" target="_blank" rel="noopener noreferrer" />,
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
                        const language = className.replace('language-', '') || 'code';
                        
                        return (
                          <div className="my-4 rounded-xl overflow-hidden bg-white/[0.04] border border-white/[0.08] shadow-sm flex flex-col">
                            <div className="bg-white/[0.06] px-4 py-2 border-b border-white/[0.08] flex items-center justify-between">
                              <span className="text-xs text-white/50 font-mono uppercase tracking-wider">{language}</span>
                              <div className="flex gap-1.5">
                                <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
                                <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
                                <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
                              </div>
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
                      },
                      ul: (props) => <ul className="list-disc pl-6 mb-3 space-y-1.5 marker:text-white/30 marker:text-sm" {...props} />,
                      ol: (props) => <ol className="list-decimal pl-6 mb-3 space-y-1.5 marker:text-white/30 marker:text-sm marker:font-medium" {...props} />,
                      li: (props) => <li className="leading-[1.7] pl-1" {...props} />,
                      blockquote: (props) => (
                        <blockquote className="border-l-4 border-indigo-500/40 pl-4 my-3 py-2 bg-gradient-to-r from-indigo-500/10 to-transparent rounded-r-lg" {...props}>
                          <span className="text-white/60 italic leading-[1.7]">{props.children}</span>
                        </blockquote>
                      ),
                      h1: (props) => <h1 className="text-lg font-bold mb-3 mt-4 first:mt-0 tracking-tight border-b border-white/[0.06] pb-2" {...props} />,
                      h2: (props) => <h2 className="text-base font-bold mb-2.5 mt-3.5 first:mt-0 tracking-tight" {...props} />,
                      h3: (props) => <h3 className="text-sm font-bold mb-2 mt-3 first:mt-0" {...props} />,
                      h4: (props) => <h4 className="text-sm font-semibold mb-1.5 mt-2.5 first:mt-0" {...props} />,
                      strong: (props) => <strong className="font-bold text-white" {...props} />,
                      em: (props) => <em className="italic opacity-90" {...props} />,
                      table: (props) => (
                        <div className="overflow-x-auto my-3 rounded-xl border border-white/[0.06] shadow-sm">
                          <table className="min-w-full divide-y divide-white/[0.06] text-sm" {...props} />
                        </div>
                      ),
                      thead: (props) => <thead className="bg-black/20" {...props} />,
                      tbody: (props) => <tbody className="divide-y divide-white/[0.04] bg-transparent" {...props} />,
                      tr: (props) => <tr className="hover:bg-white/[0.02] transition-colors" {...props} />,
                      th: (props) => <th className="px-4 py-2.5 text-left font-bold uppercase tracking-wider text-[11px] text-white/50" {...props} />,
                      td: (props) => <td className="px-4 py-2.5 whitespace-pre-wrap" {...props} />,
                      hr: (props) => <hr className="my-4 border-white/[0.06]" {...props} />,
                    }}
                  >
                    {preprocessMessageContent(msg.content)}
                  </ReactMarkdown>
                </div>
              </div>

              {msg.reasoning && (
                <div className="w-full">
                  <ReasoningBlock
                    text={msg.reasoning}
                    isOpen={false}
                    onToggle={() => { }}
                    isComplete={true}
                  />
                </div>
              )}

              {msg.parts && msg.parts.length > 0 && (
                <div className="w-full space-y-2 mt-1">
                  {msg.parts
                    .filter(p => p.type === 'tool')
                    .map((p: any, idx) => (
                      <ToolCallItem key={idx} evt={p.event} onUndo={onUndo} />
                    ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {(streamItems.length > 0 || busy || reasoningText) && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-indigo-600 border border-indigo-700 text-white flex items-center justify-center shrink-0 shadow-sm mt-0.5">
              <Bot className="w-4 h-4" />
            </div>
            <div className="flex flex-col gap-2 max-w-[90%] w-full">
              {reasoningText && (
                <ReasoningBlock
                  text={reasoningText}
                  isOpen={!!(reasoningText && busy)}
                  onToggle={() => setShowReasoning(!showReasoning)}
                  isComplete={!busy}
                />
              )}

              {streamItems.map((item, i) => (
                item.type === 'text' ? (
                  <div key={i} className="px-4 py-3 rounded-3xl rounded-tl-sm bg-black/20 border border-white/[0.04] text-white/90 shadow-sm text-[13px] leading-relaxed">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm, remarkMath]}
                      rehypePlugins={[rehypeKatex]}
                      components={{
                        img: (props) => <ChatMedia {...props as any} />,
                        p: ({ children }) => <p className="mb-2 last:mb-0 leading-[1.7]">{children}</p>,
                        a: ({ node, ...props }) => <a {...props} className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2 decoration-indigo-500/30 hover:decoration-indigo-500/50 transition-all" target="_blank" rel="noopener noreferrer" />,
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
                          const language = className.replace('language-', '') || 'code';
                          
                          return (
                            <div className="my-4 rounded-xl overflow-hidden bg-black/60 border border-white/[0.08] shadow-xl flex flex-col">
                              <div className="bg-white/[0.02] px-4 py-2 border-b border-white/[0.06] flex items-center justify-between">
                                <span className="text-xs text-white/40 font-mono uppercase tracking-wider">{language}</span>
                                <div className="flex gap-1.5">
                                  <div className="w-2.5 h-2.5 rounded-full bg-red-500/40" />
                                  <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/40" />
                                  <div className="w-2.5 h-2.5 rounded-full bg-green-500/40" />
                                </div>
                            </div>
                            <div className="overflow-x-auto overflow-y-auto max-h-[400px] custom-scrollbar p-4 bg-slate-50/50">
                              <code className={clsx(className, "font-mono text-[13px] inline-block min-w-full leading-[1.7] text-white/90 whitespace-pre tab-4")} {...childProps}>{codeContent}</code>
                            </div>
                          </div>
                        );
                      },
                      code: ({ className, children, ...props }: any) => (
                        <code className="bg-white/[0.06] text-white/90 px-[6px] py-[2px] rounded-md text-[85%] font-mono font-medium border border-white/[0.08] shadow-sm align-middle" {...props}>
                          {children}
                        </code>
                      ),
                        ul: (props) => <ul className="list-disc pl-6 mb-3 space-y-1.5 marker:text-white/30 marker:text-sm" {...props} />,
                        ol: (props) => <ol className="list-decimal pl-6 mb-3 space-y-1.5 marker:text-white/30 marker:text-sm marker:font-medium" {...props} />,
                        li: (props) => <li className="leading-[1.7] pl-1" {...props} />,
                        blockquote: (props) => (
                          <blockquote className="border-l-4 border-indigo-500/40 pl-4 my-3 py-2 bg-gradient-to-r from-indigo-500/10 to-transparent rounded-r-lg" {...props}>
                            <span className="text-white/60 italic leading-[1.7]">{props.children}</span>
                          </blockquote>
                        ),
                        h1: (props) => <h1 className="text-lg font-bold mb-3 mt-4 first:mt-0 tracking-tight border-b border-white/[0.06] pb-2" {...props} />,
                        h2: (props) => <h2 className="text-base font-bold mb-2.5 mt-3.5 first:mt-0 tracking-tight" {...props} />,
                        h3: (props) => <h3 className="text-sm font-bold mb-2 mt-3 first:mt-0" {...props} />,
                        h4: (props) => <h4 className="text-sm font-semibold mb-1.5 mt-2.5 first:mt-0" {...props} />,
                        strong: (props) => <strong className="font-bold text-white" {...props} />,
                        em: (props) => <em className="italic opacity-90" {...props} />,
                        table: (props) => (
                          <div className="overflow-x-auto my-3 rounded-xl border border-white/[0.06] shadow-sm">
                            <table className="min-w-full divide-y divide-white/[0.06] text-sm" {...props} />
                          </div>
                        ),
                        thead: (props) => <thead className="bg-black/20" {...props} />,
                        tbody: (props) => <tbody className="divide-y divide-white/[0.04] bg-transparent" {...props} />,
                        tr: (props) => <tr className="hover:bg-white/[0.02] transition-colors" {...props} />,
                        th: (props) => <th className="px-4 py-2.5 text-left font-bold uppercase tracking-wider text-[11px] text-white/50" {...props} />,
                        td: (props) => <td className="px-4 py-2.5 whitespace-pre-wrap" {...props} />,
                        hr: (props) => <hr className="my-4 border-white/[0.06]" {...props} />,
                      }}
                    >
                      {preprocessMessageContent(item.content)}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <ToolCallItem key={i} evt={item.event} onUndo={onUndo} />
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
      </div>
    </div>
  );
}

