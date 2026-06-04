import React, { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import clsx from "clsx";
import { User, Bot, AlertCircle, CheckCircle2, Sparkles, X, Undo2, Plus, History, Clock, Trash2, ExternalLink, Folder, Copy, Check, Shield, ArrowRight, Box } from "lucide-react";
import { ModelSelector } from "../../../components/ModelSelector";
import { AudioPlayer } from "../../../components/AudioPlayer";
import { Shimmer } from "../../../components/ai-elements/Shimmer";
import {
  ChainOfThought,
  ChainOfThoughtHeader,
  ChainOfThoughtContent,
  ChainOfThoughtStep,
} from "../../../components/ai-elements/ChainOfThought";
import type { Message, StreamItem, ToolEvent, WorkflowApprovalRequest } from "../../hooks/useWorkflowChat";
import { prepareMarkdownForDisplay } from "../../../utils/text";
import { displayConversationTitle } from "../../../utils/conversationTitle";

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
    <div className="flex items-center gap-1.5 wf-bg-overlay border wf-border-subtle rounded-md px-2 py-1.5 my-0.5">
      <span className="text-[10px] wf-fg-faint shrink-0">
        {isImage ? '🖼' : isAudio ? '🔊' : '📄'}
      </span>
      <span className="text-[10px] font-medium wf-fg-muted truncate max-w-[200px]" title={filePath}>
        {fileName}
      </span>
      <div className="flex items-center gap-0.5 ml-auto shrink-0">
        <button onClick={openFile} className="p-0.5 rounded wf-hover-bg transition-colors" title="Open file">
          <ExternalLink className="w-3 h-3 wf-fg-faint wf-hover-fg" />
        </button>
        <button onClick={revealInFolder} className="p-0.5 rounded wf-hover-bg transition-colors" title="Show in folder">
          <Folder className="w-3 h-3 wf-fg-faint wf-hover-fg" />
        </button>
        <button onClick={copyPath} className="p-0.5 rounded wf-hover-bg transition-colors" title="Copy path">
          {copied
            ? <Check className="w-3 h-3 text-emerald-400" />
            : <Copy className="w-3 h-3 wf-fg-faint wf-hover-fg" />
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
  let processed = prepareMarkdownForDisplay(content);
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
          className="w-full rounded-lg border wf-border-subtle shadow-sm bg-black/50 max-h-[400px]"
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
      <div className={`absolute inset-0 wf-bg-overlay rounded-lg animate-pulse ${loaded ? 'hidden' : 'block'}`} />
      <img
        src={mediaSrc}
        alt={alt || 'Image'}
        onLoad={() => setLoaded(true)}
        onError={() => {
          console.error(`[ChatMedia] Image load error: ${mediaSrc}`);
          setError(true);
        }}
        className={`max-w-full max-h-[240px] rounded-lg border wf-border-subtle shadow-sm object-contain bg-black/50 transition-all duration-300 ${loaded ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}
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

function getFilenameFromPath(p: string): string {
  return p.replace(/\\/g, '/').split('/').filter(Boolean).pop() || p;
}

// Inline code chip for tool args (filename, command, URL, etc.)
const InlineCodeChip: React.FC<{ children: React.ReactNode; title?: string; max?: number }> = ({ children, title, max = 56 }) => {
  const text = typeof children === 'string' ? children : String(children ?? '');
  const display = text.length > max ? `${text.slice(0, max - 1)}…` : text;
  return (
    <code
      title={title || (typeof children === 'string' ? children : undefined)}
      className="wf-bg-overlay wf-fg-muted px-[5px] py-[1px] rounded-md text-[10px] font-mono align-baseline border wf-border-subtle"
    >
      {display}
    </code>
  );
};

// Action-oriented label for a tool call (mirrors main agent CoT). Falls back to the
// humanized tool name when no recognizable args are present.
function getToolLabel(tool: string, args: any): React.ReactNode {
  const a = (args && typeof args === 'object') ? args : {};
  const path = typeof a.path === 'string' ? a.path : (typeof a.filePath === 'string' ? a.filePath : null);
  const filename = path ? getFilenameFromPath(path) : null;
  switch (tool) {
    case 'workspace_write_file':
    case 'write_file': {
      if (!filename) break;
      return <span>{a.append ? 'Appended to' : 'Wrote'} <InlineCodeChip title={path || undefined}>{filename}</InlineCodeChip></span>;
    }
    case 'workspace_read_file':
    case 'read_file':
    case 'file_read': {
      if (!filename) break;
      return <span>Read <InlineCodeChip title={path || undefined}>{filename}</InlineCodeChip></span>;
    }
    case 'workspace_delete_file':
    case 'delete_file': {
      if (!filename) break;
      return <span>Deleted <InlineCodeChip title={path || undefined}>{filename}</InlineCodeChip></span>;
    }
    case 'workspace_create_folder':
    case 'create_directory': {
      if (!filename) break;
      return <span>Created folder <InlineCodeChip title={path || undefined}>{filename}</InlineCodeChip></span>;
    }
    case 'workspace_list':
    case 'list_directory': {
      if (!filename) break;
      return <span>Listed <InlineCodeChip title={path || undefined}>{filename}</InlineCodeChip></span>;
    }
    case 'web_search': {
      const q = typeof a.query === 'string' ? a.query : (typeof a.q === 'string' ? a.q : null);
      return q ? <span>Searched the web for <InlineCodeChip max={48}>{q}</InlineCodeChip></span> : 'Searched the web';
    }
    case 'scrape_url': {
      const url = typeof a.url === 'string' ? a.url : null;
      if (!url) break;
      let host = url;
      try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { }
      return <span>Scraped <InlineCodeChip title={url}>{host}</InlineCodeChip></span>;
    }
    case 'run_command':
    case 'run_terminal_command': {
      const cmd = typeof a.command === 'string' ? a.command : null;
      return cmd ? <span>Ran <InlineCodeChip max={56}>{cmd}</InlineCodeChip></span> : 'Ran command';
    }
    case 'workflow_modify':
    case 'modify_workflow':
      return 'Modifying workflow';
    case 'create_workflow':
      return 'Creating workflow';
    case 'run_workflow':
    case 'invoke_workflow':
      return 'Running workflow';
    case 'analyze_media':
      return 'Analyzed media';
    case 'get_local_time':
      return 'Checked the time';
  }
  return formatToolName(tool);
}

const PermissionBar = ({
  approval,
  count,
  onRespond,
}: {
  approval: WorkflowApprovalRequest;
  count: number;
  onRespond: (id: string, allow: boolean) => void;
}) => {
  const args = approval.args || {};
  const path = String(args.path || args.filePath || args.folder || '').trim();
  return (
    <div className="mb-2 rounded-xl border border-amber-400/30 bg-amber-500/10 shadow-sm overflow-hidden">
      <div className="flex items-start gap-3 px-3 py-2.5">
        <div className="mt-0.5 rounded-lg border border-amber-400/30 bg-amber-400/15 p-1.5 text-amber-300">
          <Shield className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-200">Permission Required</div>
            {count > 1 && (
              <span className="rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[9px] font-medium text-amber-200">
                {count} pending
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[12px] leading-5 wf-fg">
            {approval.description || `${formatToolName(approval.tool)} needs approval.`}
          </div>
          {path && (
            <div className="mt-1 truncate rounded-md border wf-border-subtle wf-bg-sunken px-2 py-1 font-mono text-[10px] wf-fg-muted" title={path}>
              {path}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => onRespond(approval.id, false)}
            className="rounded-lg px-2.5 py-1.5 text-[11px] font-medium wf-fg-muted wf-hover-bg wf-hover-fg transition-colors"
          >
            Deny
          </button>
          <button
            type="button"
            onClick={() => onRespond(approval.id, true)}
            className="rounded-lg bg-amber-300 px-2.5 py-1.5 text-[11px] font-semibold text-black hover:bg-amber-200 transition-colors"
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  );
};

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

  const showSuccess = resultOk && (resultSpec || result?.changes || result?.diagram || result?.affectedFlow || result?.message);
  const showError = hasError && errorMessage;
  const showPending = !result;
  const showUnknown = result && !showSuccess && !showError;

  const canUndo = showSuccess && workflowBefore && onUndo;

  return (
    <div className="mt-3 flex flex-col gap-px text-[11px] border wf-border-subtle rounded-xl wf-bg-sunken overflow-hidden shadow-sm">
      <div className="wf-bg-overlay px-3 py-2 wf-fg-muted text-[10px] font-semibold uppercase tracking-wider border-b wf-border-subtle flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1 wf-bg-overlay rounded-md border wf-border-subtle shadow-sm">
            <Sparkles className="w-3 h-3 text-blue-400" />
          </div>
          {showSuccess ? 'Updates Applied' : showPending ? 'Applying Updates...' : 'Update Status'}
        </div>
        {canUndo && (
          <button
            type="button"
            onClick={() => onUndo(workflowBefore)}
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium wf-fg-muted hover:text-blue-400 hover:bg-blue-500/20 rounded-md transition-colors"
            title="Undo this change"
          >
            <Undo2 className="w-3 h-3" />
            Undo
          </button>
        )}
      </div>

      {instructions && (
        <div className="p-3 bg-transparent border-b wf-border-subtle whitespace-pre-wrap break-words wf-fg-muted">
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
          <div className="text-[11px] flex items-center gap-2 wf-fg-muted">
            <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            Processing workflow changes...
          </div>
        </div>
      )}

      {showUnknown && (() => {
        const filePaths = extractFilePaths(result);
        return (
          <div className="wf-bg-overlay wf-fg-muted p-3 whitespace-pre-wrap break-words">
            {filePaths.length > 0 && (
              <div className="flex flex-col gap-0.5 mb-2">
                {filePaths.map((fp) => <FilePathActions key={fp} filePath={fp} />)}
              </div>
            )}
            <div className="flex select-none wf-fg-faint mb-1 text-[9px] uppercase font-bold">Raw Result</div>
            <div className="text-[10px] font-mono max-h-24 overflow-y-auto scrollbar-minimal">
              {JSON.stringify(result, null, 2)}
            </div>
          </div>
        );
      })()}
    </div>
  );
};

// --- Custom Tool Output Renderers ---
// Mirrors the visual language of the main chat's ToolTraceContent: small
// chips/pills for metadata, dedicated cards per tool, mono-spaced previews,
// muted box backgrounds. Per-tool views surface the actually useful field
// instead of dumping JSON.

const PreviewBadge: React.FC<{ label: string; value: string; tone?: 'default' | 'accent' | 'success' | 'warn' }> = ({ label, value, tone = 'default' }) => {
  const toneStyle: Record<string, React.CSSProperties> = {
    default: {
      backgroundColor: 'color-mix(in srgb, var(--foreground-muted, #a6a6a6) 14%, transparent)',
      color: 'color-mix(in srgb, var(--foreground, #fff) 80%, transparent)',
    },
    accent: {
      backgroundColor: 'color-mix(in srgb, #3b82f6 20%, transparent)',
      color: '#60a5fa',
    },
    success: {
      backgroundColor: 'color-mix(in srgb, #10b981 18%, transparent)',
      color: '#6ee7b7',
    },
    warn: {
      backgroundColor: 'color-mix(in srgb, #f59e0b 20%, transparent)',
      color: '#fcd34d',
    },
  };
  return (
    <div
      className="inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] leading-5"
      style={toneStyle[tone]}
    >
      <span className="opacity-70">{label}</span>
      <span className="truncate font-medium">{value}</span>
    </div>
  );
};

// Visual node card used by inspect_workflow's node_flow / trigger_flow modes.
// Shows incoming wires as left-side arrows feeding into the focused node card,
// outgoing wires as right-side arrows exiting it. Tries to make the topology
// glanceable instead of forcing the user to mentally parse JSON.
const InspectNodeFlowCard: React.FC<{ flow: any; kind: 'node' | 'trigger' }> = ({ flow, kind }) => {
  const focusId: string = String(flow?.id || flow?.element?.id || flow?.element?.elementId || '');
  const element = flow?.element || flow;
  const type: string = String(element?.type || element?.tool || element?.kind || '');
  const name: string = String(element?.name || element?.label || '');
  const incoming = Array.isArray(flow?.incoming) ? flow.incoming : Array.isArray(flow?.incomingWires) ? flow.incomingWires : [];
  const outgoing = Array.isArray(flow?.outgoing) ? flow.outgoing : Array.isArray(flow?.outgoingWires) ? flow.outgoingWires : [];

  const wireLine = (w: any, side: 'in' | 'out') => {
    const other = side === 'in' ? (w?.from || w?.source || w?.id) : (w?.to || w?.target || w?.id);
    const guard = w?.guard || w?.condition || w?.classifications?.[0];
    return (
      <div className="flex items-center gap-1.5 py-0.5">
        {side === 'in' ? (
          <ArrowRight className="w-3 h-3 shrink-0" style={{ color: 'color-mix(in srgb, var(--foreground-muted, #a6a6a6) 60%, transparent)' }} />
        ) : (
          <ArrowRight className="w-3 h-3 shrink-0 rotate-0" style={{ color: 'color-mix(in srgb, #3b82f6 75%, transparent)' }} />
        )}
        <span className="font-mono text-[11px] wf-fg-muted truncate">{String(other || '?')}</span>
        {guard && (
          <span className="font-mono text-[10px] wf-fg-faint truncate" title={String(guard)}>
            [{typeof guard === 'string' ? guard : 'guard'}]
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-2">
      {incoming.length > 0 && (
        <div className="rounded-lg border wf-border-subtle wf-bg-sunken px-3 py-2">
          <div className="text-[9px] font-bold uppercase tracking-wider wf-fg-faint mb-1">Incoming · {incoming.length}</div>
          {incoming.slice(0, 6).map((w: any, i: number) => <div key={i}>{wireLine(w, 'in')}</div>)}
          {incoming.length > 6 && <div className="text-[10px] wf-fg-faint mt-0.5">… +{incoming.length - 6} more</div>}
        </div>
      )}

      <div
        className="rounded-xl px-3 py-2.5 shadow-sm"
        style={{
          backgroundColor: 'color-mix(in srgb, #3b82f6 14%, transparent)',
          border: '1px solid color-mix(in srgb, #3b82f6 35%, transparent)',
        }}
      >
        <div className="flex items-center gap-2">
          <Box className="w-3.5 h-3.5 shrink-0" style={{ color: '#60a5fa' }} />
          <span className="font-mono text-[12px] font-semibold" style={{ color: '#bfdbfe' }}>{focusId || '(unknown)'}</span>
          {kind === 'trigger' && <PreviewBadge label="kind" value="trigger" tone="accent" />}
        </div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {type && <PreviewBadge label="type" value={type} />}
          {name && name !== focusId && <PreviewBadge label="name" value={name} />}
        </div>
      </div>

      {outgoing.length > 0 && (
        <div className="rounded-lg border wf-border-subtle wf-bg-sunken px-3 py-2">
          <div className="text-[9px] font-bold uppercase tracking-wider wf-fg-faint mb-1">Outgoing · {outgoing.length}</div>
          {outgoing.slice(0, 6).map((w: any, i: number) => <div key={i}>{wireLine(w, 'out')}</div>)}
          {outgoing.length > 6 && <div className="text-[10px] wf-fg-faint mt-0.5">… +{outgoing.length - 6} more</div>}
        </div>
      )}

      {incoming.length === 0 && outgoing.length === 0 && (
        <div className="rounded-lg border wf-border-subtle wf-bg-sunken px-3 py-2 text-[11px] wf-fg-faint">
          No wires connected to this {kind}.
        </div>
      )}
    </div>
  );
};

const InspectWireCard: React.FC<{ wire: any }> = ({ wire }) => {
  const from = wire?.from || wire?.source || '?';
  const to = wire?.to || wire?.target || '?';
  const type = wire?.type || wire?.classifications?.[0];
  const guard = wire?.guard || wire?.condition;
  return (
    <div
      className="rounded-xl px-3 py-2.5"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--foreground-muted, #a6a6a6) 8%, transparent)',
        border: '1px solid color-mix(in srgb, var(--foreground-muted, #a6a6a6) 18%, transparent)',
      }}
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-[12px] wf-fg-muted truncate">{String(from)}</span>
        <ArrowRight className="w-3.5 h-3.5 shrink-0" style={{ color: '#60a5fa' }} />
        <span className="font-mono text-[12px] wf-fg truncate">{String(to)}</span>
      </div>
      {(type || guard) && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {type && <PreviewBadge label="type" value={String(type)} tone="accent" />}
          {guard && <PreviewBadge label="guard" value={typeof guard === 'string' ? guard : 'expression'} />}
        </div>
      )}
    </div>
  );
};

const InspectOverviewView: React.FC<{ result: any }> = ({ result }) => {
  const summary = typeof result?.summary === 'string' ? result.summary : '';
  const v = result?.validation;
  const errors = Array.isArray(v?.issues) ? v.issues.filter((i: any) => i?.type === 'error').length : 0;
  const warnings = Array.isArray(v?.issues) ? v.issues.filter((i: any) => i?.type === 'warning').length : 0;
  const t = result?.topology || {};
  const nodes = typeof t?.nodes === 'number' ? t.nodes : (Array.isArray(t?.nodes) ? t.nodes.length : undefined);
  const triggers = typeof t?.triggers === 'number' ? t.triggers : (Array.isArray(t?.triggers) ? t.triggers.length : undefined);
  const wires = typeof t?.wires === 'number' ? t.wires : (Array.isArray(t?.wires) ? t.wires.length : undefined);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {triggers !== undefined && <PreviewBadge label="triggers" value={String(triggers)} />}
        {nodes !== undefined && <PreviewBadge label="nodes" value={String(nodes)} />}
        {wires !== undefined && <PreviewBadge label="wires" value={String(wires)} />}
        {errors > 0 && <PreviewBadge label="errors" value={String(errors)} tone="warn" />}
        {warnings > 0 && <PreviewBadge label="warnings" value={String(warnings)} tone="warn" />}
        {errors === 0 && warnings === 0 && v && <PreviewBadge label="status" value="clean" tone="success" />}
      </div>
      {summary && (
        <div
          className="overflow-auto scrollbar-minimal rounded-lg px-3 py-2 text-[10.5px] leading-[1.55] max-h-64"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--foreground-muted, #a6a6a6) 10%, transparent)',
            border: '1px solid color-mix(in srgb, var(--foreground-muted, #a6a6a6) 15%, transparent)',
          }}
        >
          <pre className="font-mono whitespace-pre wf-fg-muted">{summary}</pre>
        </div>
      )}
    </div>
  );
};

const InspectWorkflowOutput: React.FC<{ args: any; result: any }> = ({ args, result }) => {
  const mode = String(args?.mode || 'overview');
  if (mode === 'overview') return <InspectOverviewView result={result} />;
  if (mode === 'node_flow' && result?.nodeFlow) return <InspectNodeFlowCard flow={result.nodeFlow} kind="node" />;
  if (mode === 'trigger_flow' && result?.triggerFlow) return <InspectNodeFlowCard flow={result.triggerFlow} kind="trigger" />;
  if (mode === 'wire' && result?.wire) return <InspectWireCard wire={result.wire} />;
  // Unknown mode but we got something — still try overview shape.
  if (typeof result?.summary === 'string') return <InspectOverviewView result={result} />;
  return null;
};

// Search-style tool outputs: render each hit as a small card with a title and
// optional snippet. Used by search_workflow_docs, search_workflow_nodes,
// search_tools, search_workflows. web_search gets its own favicon-chip view.
const SearchResultCard: React.FC<{ item: any }> = ({ item }) => {
  const title = String(item?.title || item?.name || item?.id || item?.label || item?.path || '').trim();
  const desc = String(item?.description || item?.snippet || item?.summary || item?.content || '').trim();
  const category = item?.category || item?.kind;
  return (
    <div
      className="rounded-lg px-2.5 py-1.5"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--foreground-muted, #a6a6a6) 8%, transparent)',
        border: '1px solid color-mix(in srgb, var(--foreground-muted, #a6a6a6) 14%, transparent)',
      }}
    >
      <div className="flex items-center gap-1.5">
        {title && <span className="text-[11.5px] font-semibold wf-fg truncate" title={title}>{title}</span>}
        {category && <PreviewBadge label="" value={String(category)} />}
      </div>
      {desc && (
        <div
          className="mt-0.5 text-[10.5px] leading-[1.5]"
          style={{ color: 'color-mix(in srgb, var(--foreground, #fff) 60%, transparent)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
        >
          {desc}
        </div>
      )}
    </div>
  );
};

const SearchResultsOutput: React.FC<{ result: any }> = ({ result }) => {
  const items: any[] = Array.isArray(result?.results) ? result.results
    : Array.isArray(result?.matches) ? result.matches
    : Array.isArray(result?.hits) ? result.hits
    : Array.isArray(result?.items) ? result.items
    : Array.isArray(result?.nodes) ? result.nodes
    : Array.isArray(result?.workflows) ? result.workflows
    : Array.isArray(result?.sections) ? result.sections
    : Array.isArray(result?.tools) ? result.tools
    : [];
  if (items.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <div className="text-[9px] font-bold uppercase tracking-wider wf-fg-faint">{items.length} result{items.length === 1 ? '' : 's'}</div>
      <div className="space-y-1">
        {items.slice(0, 6).map((it: any, i: number) => <SearchResultCard key={i} item={it} />)}
      </div>
      {items.length > 6 && <div className="text-[10px] wf-fg-faint">… +{items.length - 6} more</div>}
    </div>
  );
};

// Favicon-chip web search results, mirrors WebSearchSources from the main chat.
function faviconUrl(siteUrl: string): string {
  try {
    const host = new URL(siteUrl).hostname;
    return `https://www.google.com/s2/favicons?sz=32&domain=${host}`;
  } catch {
    return '';
  }
}

const WebSearchSourcesView: React.FC<{ query?: string; result: any }> = ({ query, result }) => {
  const arr: any[] = Array.isArray(result?.results) ? result.results
    : Array.isArray(result?.sources) ? result.sources
    : Array.isArray(result?.data) ? result.data
    : [];
  const sources = arr
    .filter((it): it is Record<string, any> => it && typeof it === 'object' && typeof it.url === 'string')
    .map((it) => ({ title: String(it.title || ''), url: String(it.url) }));
  if (sources.length === 0) return null;
  return (
    <div className="space-y-2">
      {query && <div className="text-[11.5px] wf-fg-muted">{query}</div>}
      <div className="flex flex-wrap gap-1.5">
        {sources.slice(0, 8).map((s) => {
          let host = s.url;
          try { host = new URL(s.url).hostname.replace(/^www\./, ''); } catch { }
          return (
            <a
              key={s.url}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10.5px] font-medium wf-fg-muted hover:opacity-80 transition-opacity"
              style={{ backgroundColor: 'color-mix(in srgb, var(--foreground-muted, #a6a6a6) 14%, transparent)' }}
              title={s.title || host}
            >
              <img src={faviconUrl(s.url)} alt="" className="h-3 w-3 rounded-sm" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              {host}
            </a>
          );
        })}
        {sources.length > 8 && <span className="self-center text-[10px] wf-fg-faint">+{sources.length - 8} more</span>}
      </div>
    </div>
  );
};

const GenericJSONOutput: React.FC<{ result: any }> = ({ result }) => {
  const text = useMemo(() => {
    try { return JSON.stringify(result, null, 2); } catch { return String(result ?? ''); }
  }, [result]);
  if (!text || text === 'null' || text === '{}') return null;
  return (
    <div
      className="overflow-auto scrollbar-minimal rounded-lg px-3 py-2 text-[10px] font-mono leading-[1.55] max-h-48 whitespace-pre"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--foreground-muted, #a6a6a6) 8%, transparent)',
        border: '1px solid color-mix(in srgb, var(--foreground-muted, #a6a6a6) 14%, transparent)',
        color: 'color-mix(in srgb, var(--foreground, #fff) 65%, transparent)',
      }}
    >
      {text}
    </div>
  );
};

// Dispatches to a tool-specific output renderer when the tool completed
// successfully. Falls back to a compact JSON view otherwise.
const ToolOutputView: React.FC<{ tool: string; args: any; result: any }> = ({ tool, args, result }) => {
  if (!result) return null;
  const t = tool.toLowerCase();
  if (t === 'inspect_workflow') {
    const view = <InspectWorkflowOutput args={args} result={result} />;
    if (view) return view;
  }
  if (t === 'web_search') {
    const view = <WebSearchSourcesView query={args?.query || args?.q} result={result} />;
    if (view) return view;
  }
  if (t === 'search_workflow_docs' || t === 'search_workflow_nodes' || t === 'search_tools' || t === 'search_workflows') {
    const view = <SearchResultsOutput result={result} />;
    if (view) return view;
  }
  return <GenericJSONOutput result={result} />;
};

// --- Chain of Thought (assistant trace) ---
// Single collapsible container per assistant message that holds reasoning
// chunks and tool calls in the order they occurred. Mirrors the main chat's
// AssistantTracePanel (apps/desktop/src/renderer/components/MessageBubble.tsx).

type WfTraceStep =
  | { kind: 'reasoning'; id: string; content: string; status: 'active' | 'complete' }
  | { kind: 'tool'; id: string; evt: ToolEvent };

function summarizeReasoningLabel(content: string, fallback = 'Planning next moves'): string {
  const plain = content
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`*_>#-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return fallback;
  const sentence = plain.split(/[.?!]/)[0]?.trim() || plain;
  if (sentence.split(' ').length < 2) return fallback;
  return sentence.length > 72 ? `${sentence.slice(0, 71)}…` : sentence;
}

function formatDurationSec(s: number): string {
  if (s < 60) return `${Math.floor(s)}s`;
  return `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s`;
}

// Per-step row that renders a tool call inside the chain of thought.
const WfToolStep: React.FC<{
  evt: ToolEvent;
  isLast: boolean;
  isStreaming: boolean;
  onUndo?: (snapshot: any) => void;
}> = ({ evt, isLast, isStreaming, onUndo }) => {
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
  const status = String(evt.status || '').toLowerCase();
  const isCompleted = status === 'completed' && !resultFailed;
  const isErrored = status === 'error' || status === 'failed' || resultFailed;
  const isActive = !isCompleted && !isErrored;

  const stepStatus: 'active' | 'complete' | 'error' = isErrored ? 'error' : isCompleted ? 'complete' : 'active';
  const richLabel = getToolLabel(rawTool || evt.tool, args);

  return (
    <ChainOfThoughtStep
      status={stepStatus}
      isLast={isLast}
      label={
        isActive && isStreaming ? (
          <Shimmer as="span" duration={2.4} spread={3}>{richLabel as any}</Shimmer>
        ) : (richLabel as any)
      }
    >
      {isModify ? (
        <ModifyWorkflowView
          args={args}
          result={evt.result}
          workflowBefore={evt.workflowBefore}
          onUndo={onUndo}
        />
      ) : isErrored && (evt.result?.error || resultFailed) ? (
        <div
          className="rounded-lg px-3 py-2 text-[11px] leading-relaxed flex gap-2"
          style={{ backgroundColor: 'color-mix(in srgb, #ef4444 12%, transparent)', color: '#fca5a5' }}
        >
          <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
          <span>{evt.result?.error || 'Tool failed'}</span>
        </div>
      ) : isCompleted && evt.result ? (
        <ToolOutputView tool={rawTool || evt.tool} args={args} result={evt.result} />
      ) : null}

      {/* File paths surface as quick-action chips below the tool body */}
      {evt.result && (() => {
        const filePaths = extractFilePaths(evt.result);
        return filePaths.length > 0 ? (
          <div className="mt-1.5 flex flex-col gap-0.5">
            {filePaths.map((fp) => <FilePathActions key={fp} filePath={fp} />)}
          </div>
        ) : null;
      })()}
    </ChainOfThoughtStep>
  );
};

// Per-step row for reasoning content. Renders the prose in a muted box,
// just like the main chat's reasoning steps.
const WfReasoningStep: React.FC<{
  content: string;
  isLast: boolean;
  isStreaming: boolean;
  isLastReasoning: boolean;
}> = ({ content, isLast, isStreaming, isLastReasoning }) => {
  const active = isStreaming && isLastReasoning;
  const label = summarizeReasoningLabel(content);
  return (
    <ChainOfThoughtStep
      status={active ? 'active' : 'complete'}
      isLast={isLast}
      label={
        active ? (
          <Shimmer as="span" duration={2.4} spread={3}>{label}</Shimmer>
        ) : label
      }
    >
      {content && (
        <div
          className="scrollbar-none max-h-40 overflow-y-auto rounded-lg px-3 py-2 text-[11px] leading-relaxed break-words prose prose-sm max-w-none prose-p:my-1 prose-headings:font-semibold prose-headings:text-[12px] prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-[10px] prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-pre:p-2 prose-pre:rounded-md prose-pre:text-[10px] prose-strong:font-semibold"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--foreground-muted, #a6a6a6) 10%, transparent)',
            color: 'color-mix(in srgb, var(--foreground, #fff) 62%, transparent)',
          }}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}
          >
            {content}
          </ReactMarkdown>
        </div>
      )}
    </ChainOfThoughtStep>
  );
};

const WorkflowAssistantTrace: React.FC<{
  parts: StreamItem[];
  reasoningText?: string;
  reasoningDuration?: number;
  isStreaming: boolean;
  defaultOpen?: boolean;
  onUndo?: (snapshot: any) => void;
}> = ({ parts, reasoningText, reasoningDuration, isStreaming, defaultOpen, onUndo }) => {
  const steps = useMemo<WfTraceStep[]>(() => {
    const out: WfTraceStep[] = [];
    let lastReasoningIdx = -1;
    parts.forEach((it, i) => {
      if (it.type === 'reasoning') {
        out.push({ kind: 'reasoning', id: `r-${i}`, content: it.content, status: 'complete' });
        lastReasoningIdx = out.length - 1;
      } else if (it.type === 'tool') {
        out.push({ kind: 'tool', id: it.event.id || `t-${i}`, evt: it.event });
      }
    });
    // Fallback when only a flat reasoning string is available (legacy messages).
    if (out.length === 0 && reasoningText && reasoningText.trim()) {
      out.push({ kind: 'reasoning', id: 'r-legacy', content: reasoningText, status: 'complete' });
    }
    // Mark only the last reasoning chunk as 'active' if streaming.
    if (isStreaming && lastReasoningIdx >= 0) {
      const last = out[lastReasoningIdx];
      if (last.kind === 'reasoning') last.status = 'active';
    }
    return out;
  }, [parts, reasoningText, isStreaming]);

  if (steps.length === 0) return null;

  const lastReasoningIdx = steps.reduce((acc, s, i) => (s.kind === 'reasoning' ? i : acc), -1);

  const headerLabel = isStreaming
    ? 'Thinking…'
    : reasoningDuration
      ? `Thought for ${formatDurationSec(reasoningDuration)}`
      : 'Thought';

  return (
    <ChainOfThought defaultOpen={defaultOpen ?? isStreaming} className="w-full">
      <ChainOfThoughtHeader>
        <span className="text-[12.5px] wf-fg-muted">
          {isStreaming ? <Shimmer as="span" duration={2.4} spread={3}>{headerLabel}</Shimmer> : headerLabel}
        </span>
      </ChainOfThoughtHeader>
      <ChainOfThoughtContent>
        {steps.map((step, idx) => {
          const isLast = idx === steps.length - 1;
          if (step.kind === 'reasoning') {
            return (
              <WfReasoningStep
                key={step.id}
                content={step.content}
                isLast={isLast}
                isStreaming={isStreaming}
                isLastReasoning={idx === lastReasoningIdx}
              />
            );
          }
          return (
            <WfToolStep
              key={step.id}
              evt={step.evt}
              isLast={isLast}
              isStreaming={isStreaming}
              onUndo={onUndo}
            />
          );
        })}
      </ChainOfThoughtContent>
    </ChainOfThought>
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
  pendingApprovals = [],
  onRespondToApproval,
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
  pendingApprovals?: WorkflowApprovalRequest[];
  onRespondToApproval?: (id: string, allow: boolean) => void;
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
        <div className="border-b wf-border-subtle wf-bg-sunken max-h-64 overflow-y-auto scrollbar-minimal shadow-inner">
          <div className="px-3 py-2 text-[10px] font-semibold wf-fg-faint uppercase tracking-wider border-b wf-border-subtle">
            Past Conversations
          </div>
          {pastSessions.map((session) => (
            <div
              key={session.id}
              className="group px-3 py-2.5 wf-hover-bg border-b wf-border-subtle last:border-0 cursor-pointer flex items-start justify-between gap-2 transition-colors"
              onClick={() => onLoadSession && onLoadSession(session.id)}
            >
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-medium wf-fg truncate mb-0.5">
                  {displayConversationTitle(session.title, session.messages.find((m) => m.role === 'user')?.content)}
                </div>
                <div className="text-[10px] wf-fg-faint flex items-center gap-1.5">
                  <Clock className="w-3 h-3" />
                  {formatSessionTime(session.updatedAt)}
                  <span className="w-0.5 h-0.5 rounded-full wf-fg-faint opacity-50" />
                  {session.messages.length} msgs
                </div>
              </div>
              {onDeleteSession && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm('Delete this conversation?')) onDeleteSession(session.id);
                  }}
                  className="p-1 wf-fg-faint hover:text-red-400 hover:bg-red-500/20 rounded opacity-0 group-hover:opacity-100 transition-all"
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
                ? 'wf-bg-overlay wf-border-subtle wf-fg-muted'
                : 'bg-blue-500/20 border-blue-500/30 text-blue-400'}`}>
              {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
            </div>

            <div className={`flex flex-col gap-1.5 max-w-[90%] min-w-0 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              {msg.images && msg.images.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-1 justify-end">
                  {msg.images.map((img, idx) => {
                    const src = img.dataUrl || toMediaSrc(img.path);
                    const isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(src) || (img.mimeType && img.mimeType.startsWith('video/'));

                    return (
                      <div key={idx} className="relative rounded-lg overflow-hidden border wf-border-subtle shadow-sm max-w-[200px] wf-bg-overlay">
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

              {/* Assistant chain-of-thought renders ABOVE the final text so the
                  reasoning/tool trace reads top-down and the answer lands at
                  the bottom of the bubble (closer to the input). */}
              {msg.role === 'assistant' && ((msg.parts && msg.parts.length > 0) || (msg.reasoning && msg.reasoning.trim())) && (
                <div className="w-full mb-1.5">
                  <WorkflowAssistantTrace
                    parts={(msg.parts || []) as StreamItem[]}
                    reasoningText={msg.reasoning}
                    isStreaming={false}
                    onUndo={onUndo}
                  />
                </div>
              )}

              <div className={`px-4 py-3 rounded-3xl shadow-sm text-[13px] leading-relaxed break-words min-w-0 max-w-full
                ${msg.role === 'user'
                  ? 'wf-bg-elevated wf-fg rounded-tr-sm border wf-border-subtle'
                  : 'wf-bg-sunken border wf-border-subtle wf-fg rounded-tl-sm'}`}>
                <div className="markdown-body min-w-0 break-words">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}
                    components={{
                      img: (props) => <ChatMedia {...props as any} />,
                      p: ({ children }) => <p className="mb-2 last:mb-0 leading-[1.7]">{children}</p>,
                      a: ({ node, ...props }) => <a {...props} className="text-blue-400 hover:text-blue-300 underline underline-offset-2 decoration-blue-500/30 hover:decoration-blue-500/50 transition-all" target="_blank" rel="noopener noreferrer" />,
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
                          <div className="my-4 rounded-xl overflow-hidden wf-bg-overlay border wf-border-subtle shadow-sm flex flex-col">
                            <div className="wf-bg-overlay px-4 py-2 border-b wf-border-subtle flex items-center justify-between">
                              <span className="text-xs wf-fg-muted font-mono uppercase tracking-wider">{language}</span>
                              <div className="flex gap-1.5">
                                <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
                                <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
                                <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
                              </div>
                            </div>
                            <div className="overflow-x-auto overflow-y-auto max-h-[400px] custom-scrollbar p-4 wf-bg-sunken">
                              <code className={clsx(className, "font-mono text-[13px] inline-block min-w-full leading-[1.7] wf-fg whitespace-pre tab-4")} {...childProps}>{codeContent}</code>
                            </div>
                          </div>
                        );
                      },
                      code: ({ className, children, ...props }: any) => {
                        const isInline = !String(className).includes('language-');
                        return isInline ? (
                          <code className="wf-bg-overlay wf-fg px-[6px] py-[2px] rounded-md text-[85%] font-mono font-medium border wf-border-subtle shadow-sm align-middle break-words" {...props}>
                            {children}
                          </code>
                        ) : (
                          <code className={className} {...props}>
                            {children}
                          </code>
                        );
                      },
                      ul: (props) => <ul className="list-disc pl-6 mb-3 space-y-1.5 marker:wf-fg-faint marker:text-sm" {...props} />,
                      ol: (props) => <ol className="list-decimal pl-6 mb-3 space-y-1.5 marker:wf-fg-faint marker:text-sm marker:font-medium" {...props} />,
                      li: (props) => <li className="leading-[1.7] pl-1" {...props} />,
                      blockquote: (props) => (
                        <blockquote className="border-l-4 border-blue-500/40 pl-4 my-3 py-2 bg-gradient-to-r from-blue-500/10 to-transparent rounded-r-lg" {...props}>
                          <span className="wf-fg-muted italic leading-[1.7]">{props.children}</span>
                        </blockquote>
                      ),
                      h1: (props) => <h1 className="text-lg font-bold mb-3 mt-4 first:mt-0 tracking-tight border-b wf-border-subtle pb-2" {...props} />,
                      h2: (props) => <h2 className="text-base font-bold mb-2.5 mt-3.5 first:mt-0 tracking-tight" {...props} />,
                      h3: (props) => <h3 className="text-sm font-bold mb-2 mt-3 first:mt-0" {...props} />,
                      h4: (props) => <h4 className="text-sm font-semibold mb-1.5 mt-2.5 first:mt-0" {...props} />,
                      strong: (props) => <strong className="font-bold wf-fg" {...props} />,
                      em: (props) => <em className="italic opacity-90" {...props} />,
                      table: (props) => (
                        <div className="overflow-x-auto my-3 rounded-xl border wf-border-subtle shadow-sm">
                          <table className="min-w-full divide-y divide-white/[0.06] text-sm" {...props} />
                        </div>
                      ),
                      thead: (props) => <thead className="wf-bg-sunken" {...props} />,
                      tbody: (props) => <tbody className="divide-y divide-white/[0.04] bg-transparent" {...props} />,
                      tr: (props) => <tr className="hover:wf-bg-overlay transition-colors" {...props} />,
                      th: (props) => <th className="px-4 py-2.5 text-left font-bold uppercase tracking-wider text-[11px] wf-fg-muted" {...props} />,
                      td: (props) => <td className="px-4 py-2.5 whitespace-pre-wrap" {...props} />,
                      hr: (props) => <hr className="my-4 wf-border-subtle" {...props} />,
                    }}
                  >
                    {preprocessMessageContent(msg.content)}
                  </ReactMarkdown>
                </div>
              </div>

            </div>
          </div>
        ))}

        {(streamItems.length > 0 || busy || reasoningText) && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-blue-600 border border-blue-700 wf-fg flex items-center justify-center shrink-0 shadow-sm mt-0.5">
              <Bot className="w-4 h-4" />
            </div>
            <div className="flex flex-col gap-2 max-w-[90%] w-full">
              {pendingApprovals.length > 0 && onRespondToApproval && (
                <PermissionBar
                  approval={pendingApprovals[0]}
                  count={pendingApprovals.length}
                  onRespond={onRespondToApproval}
                />
              )}

              {/* Unified chain-of-thought: reasoning + tool calls inside a
                  collapsible "Thinking…" container. Text deltas render below
                  the trace as their own assistant bubble. */}
              {(streamItems.some(it => it.type !== 'text') || reasoningText) ? (
                <WorkflowAssistantTrace
                  parts={streamItems.filter(it => it.type !== 'text')}
                  reasoningText={reasoningText}
                  isStreaming={busy}
                  defaultOpen={busy}
                  onUndo={onUndo}
                />
              ) : busy && !streamItems.some(it => it.type === 'text') ? (
                <div className="flex items-center gap-1.5 py-1 text-[12.5px] wf-fg-muted">
                  <span
                    className="block w-1.5 h-1.5 shrink-0 rounded-full animate-pulse"
                    style={{ backgroundColor: 'color-mix(in srgb, var(--foreground-muted, #a6a6a6) 60%, transparent)' }}
                  />
                  <Shimmer as="span" duration={2.4} spread={3}>Thinking…</Shimmer>
                </div>
              ) : null}

              {(() => {
                return streamItems.map((item, i) => (
                  item.type === 'reasoning' || item.type === 'tool' ? null : item.type === 'text' ? (
                  <div key={i} className="px-4 py-3 rounded-3xl rounded-tl-sm wf-bg-sunken border wf-border-subtle wf-fg shadow-sm text-[13px] leading-relaxed break-words min-w-0 max-w-full">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm, remarkMath]}
                      rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}
                      components={{
                        img: (props) => <ChatMedia {...props as any} />,
                        p: ({ children }) => <p className="mb-2 last:mb-0 leading-[1.7]">{children}</p>,
                        a: ({ node, ...props }) => <a {...props} className="text-blue-400 hover:text-blue-300 underline underline-offset-2 decoration-blue-500/30 hover:decoration-blue-500/50 transition-all" target="_blank" rel="noopener noreferrer" />,
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
                            <div className="my-4 rounded-xl overflow-hidden bg-black/60 border wf-border-subtle shadow-xl flex flex-col">
                              <div className="wf-bg-overlay px-4 py-2 border-b wf-border-subtle flex items-center justify-between">
                                <span className="text-xs wf-fg-faint font-mono uppercase tracking-wider">{language}</span>
                                <div className="flex gap-1.5">
                                  <div className="w-2.5 h-2.5 rounded-full bg-red-500/40" />
                                  <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/40" />
                                  <div className="w-2.5 h-2.5 rounded-full bg-green-500/40" />
                                </div>
                            </div>
                            <div className="overflow-x-auto overflow-y-auto max-h-[400px] custom-scrollbar p-4 wf-bg-sunken">
                              <code className={clsx(className, "font-mono text-[13px] inline-block min-w-full leading-[1.7] wf-fg whitespace-pre tab-4")} {...childProps}>{codeContent}</code>
                            </div>
                          </div>
                        );
                      },
                      code: ({ className, children, ...props }: any) => (
                        <code className="wf-bg-overlay wf-fg px-[6px] py-[2px] rounded-md text-[85%] font-mono font-medium border wf-border-subtle shadow-sm align-middle break-words" {...props}>
                          {children}
                        </code>
                      ),
                        ul: (props) => <ul className="list-disc pl-6 mb-3 space-y-1.5 marker:wf-fg-faint marker:text-sm" {...props} />,
                        ol: (props) => <ol className="list-decimal pl-6 mb-3 space-y-1.5 marker:wf-fg-faint marker:text-sm marker:font-medium" {...props} />,
                        li: (props) => <li className="leading-[1.7] pl-1" {...props} />,
                        blockquote: (props) => (
                          <blockquote className="border-l-4 border-blue-500/40 pl-4 my-3 py-2 bg-gradient-to-r from-blue-500/10 to-transparent rounded-r-lg" {...props}>
                            <span className="wf-fg-muted italic leading-[1.7]">{props.children}</span>
                          </blockquote>
                        ),
                        h1: (props) => <h1 className="text-lg font-bold mb-3 mt-4 first:mt-0 tracking-tight border-b wf-border-subtle pb-2" {...props} />,
                        h2: (props) => <h2 className="text-base font-bold mb-2.5 mt-3.5 first:mt-0 tracking-tight" {...props} />,
                        h3: (props) => <h3 className="text-sm font-bold mb-2 mt-3 first:mt-0" {...props} />,
                        h4: (props) => <h4 className="text-sm font-semibold mb-1.5 mt-2.5 first:mt-0" {...props} />,
                        strong: (props) => <strong className="font-bold wf-fg" {...props} />,
                        em: (props) => <em className="italic opacity-90" {...props} />,
                        table: (props) => (
                          <div className="overflow-x-auto my-3 rounded-xl border wf-border-subtle shadow-sm">
                            <table className="min-w-full divide-y divide-white/[0.06] text-sm" {...props} />
                          </div>
                        ),
                        thead: (props) => <thead className="wf-bg-sunken" {...props} />,
                        tbody: (props) => <tbody className="divide-y divide-white/[0.04] bg-transparent" {...props} />,
                        tr: (props) => <tr className="hover:wf-bg-overlay transition-colors" {...props} />,
                        th: (props) => <th className="px-4 py-2.5 text-left font-bold uppercase tracking-wider text-[11px] wf-fg-muted" {...props} />,
                        td: (props) => <td className="px-4 py-2.5 whitespace-pre-wrap" {...props} />,
                        hr: (props) => <hr className="my-4 wf-border-subtle" {...props} />,
                      }}
                    >
                      {preprocessMessageContent(item.content)}
                    </ReactMarkdown>
                  </div>
                ) : null
                ));
              })()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
