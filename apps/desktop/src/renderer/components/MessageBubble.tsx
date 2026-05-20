
import React, { useMemo, useState, useRef, useEffect, useCallback, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import clsx from 'clsx';
import { isRedundantStreamingUpdate, mergeStreamingText } from '../utils/streamMerge';
import { convertLatexDelims, escapeCurrencyDollars } from '../utils/text';
import 'katex/dist/katex.min.css';
import { Archive, ChevronRight, Folder, FileText, Play, ExternalLink, CheckCircle, XCircle, Loader2, Copy, Check, Terminal, Pencil, Undo2, Redo2, X, Send, Users } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ToolCall, StreamChunk } from '../hooks/useAgent';

import { AudioPlayer } from './AudioPlayer';
import { AttachmentPreviewStrip } from './AttachmentPreview';
import { LinkPreview } from './LinkPreview';
import { GenUIContainer, GenUIErrorBoundary } from './genui';
import { useFileViewerOptional } from './file-viewer';
import { Shimmer } from './ai-elements/Shimmer';
import { useElapsedSeconds, useElapsedSecondsFine } from '../hooks/useSharedTicker';
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtStep,
} from './ai-elements/ChainOfThought';
import type { ChatAttachment } from '../utils/attachments';

// GenUI tools that render interactive UI components
const GENUI_TOOL_NAMES = new Set([
  // Decision & Input (blocking - wait for user response)
  'ask_confirmation',
  'show_choices',
  'request_files',
  'show_files',
  'show_form',
  // Inline custom React UI (blocking or non-blocking based on args)
  'chat_ui',
]);

// Tools that should be hidden from the chat UI (internal/silent tools)
const HIDDEN_TOOL_NAMES = new Set([
  // Segment tools (internal for conversation management)
  'segment_create',
  'segment_update',
  'segment_end',
  'segment_list',
  'segment_list_recent',
  'segment_search',
  'segment_get',
  'segment_build_topic_drawers',
  'segment_search_drawers_by_embedding',
  // Collection tools (internal background processing)
  'collection_summary_upsert',
  'collection_summary_list',
  'collection_summary_get',
  // Memory tools (internal)
  'memory_store',
  'memory_recall',
  'memory_update',
  'memory_search',
  'memory_stats',
  'conversation_create',
  'conversation_get',
  'conversation_list',
  'conversation_update',
  'conversation_delete',
  'conversation_search',
  'conversation_get_spaces',
  'message_add',
  'message_list',
  // Project-mode bookkeeping is represented by the active project UI, not
  // repeated tool pills in the chat trace.
  'list_projects',
  'enter_project_mode',
  'exit_project_mode',
  'project_create',
  'project_get',
  'project_list',
  'project_update',
  'project_delete',
  'conversation_set_project',
  'journal_add',
  'journal_list',
  'journal_delete',
  'memory_add',
  'memory_create',
  'memory_list',
  'memory_search',
  'project_search',
  // Agent internal tools
  'agent_todo',
  // Knowledge tools (internal)
  'knowledge_add_fact',
  'knowledge_update_fact',
  'knowledge_build_context',
  'knowledge_get_directives',
  'knowledge_get_identity',
  // Planner internal tools
  'planner_list_items',
  // Internal subagent management tools — spawn-style ones are surfaced as
  // delegation rectangles instead (see DELEGATION_TOOL_NAMES below).
  'subagent_update',
  'subagent_status',
  'subagent_list',
  'subagent_stop',
  // Internal meta-tools (invisible to user)
  'get_tool_schema',
  'search_tools',
  // Orchestrator reply tool (invisible to user)
  'reply_to_subagent',
  // ask_user renders inline prompt, not a tool pill
  'ask_user',
  // Low-level binary I/O helpers — only ever called transitively from
  // analyze_media / OCR / cloud-storage tools; the base64 payload is huge and
  // useless to display in the trace.
  'read_file_binary',
  'read_file_base64',
  'upload_file_to_url',
  // GenUI display tools (rendered as UI, don't need pill)
  ...GENUI_TOOL_NAMES,
]);



const ToolCallPill: React.FC<{ tool: ToolCall }> = ({ tool }) => {
  const status = tool.status || 'running';
  const isCompleted = status === 'completed';
  const isError = status === 'error';
  const [showDetails, setShowDetails] = useState(false);

  // execute_tool is a wrapper — show the actual tool being executed
  const resolvedToolName = tool.tool === 'execute_tool' && tool.args?.tool_name
    ? String(tool.args.tool_name)
    : tool.tool;

  // For subagent tools, show the objective/task instead of generic tool name
  const isSubagentTool = resolvedToolName === 'deploy_headless_agent';
  const subagentObjective = isSubagentTool && tool.args?.objective
    ? String(tool.args.objective).slice(0, 80) + (String(tool.args.objective).length > 80 ? '…' : '')
    : null;

  // For delegate tool, show the subagent kind and live status
  const isDelegation = resolvedToolName === 'delegate';
  const delegationLabel = isDelegation
    ? `${humanizeToolName(tool.args?.subagent || 'subagent')} agent`
    : null;

  // Use description from tool if available, objective for subagent tools, otherwise humanize tool name
  const displayText = delegationLabel || subagentObjective || tool.description || humanizeToolName(resolvedToolName);

  // Filter out internal IDs from display data
  const filterInternalIds = (obj: any): any => {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(filterInternalIds);
    const filtered: any = {};
    for (const [key, value] of Object.entries(obj)) {
      // Skip ID fields and description (already shown)
      if (/^(id|.*_id|.*Id|session.*|conversation.*|description)$/i.test(key)) continue;
      filtered[key] = filterInternalIds(value);
    }
    return Object.keys(filtered).length > 0 ? filtered : null;
  };

  // Format result for display
  const formatResult = (result: any): React.ReactNode => {
    if (!result) return <span className="text-gray-500 italic">No result</span>;

    // Extract file paths first — show them prominently with actions
    const filePaths = extractFilePaths(result);

    const filtered = filterInternalIds(result);
    if (!filtered && filePaths.length === 0) return <span className="text-green-600">✓ Success</span>;

    // Handle common result patterns
    if (filtered?.error) {
      return <span className="text-red-600">Error: {String(filtered.error)}</span>;
    }

    return (
      <div className="space-y-1">
        {filePaths.length > 0 && (
          <div className="flex flex-col gap-0.5">
            {filePaths.map((fp) => <FilePathActions key={fp} filePath={fp} />)}
          </div>
        )}
        {filtered && !(filtered.ok === true && Object.keys(filtered).length === 1 && filePaths.length > 0) && (
          <div className="flex flex-wrap gap-1 items-center">
            {Object.entries(filtered).slice(0, 5).map(([key, value]) => {
              // Skip keys whose values are file paths (already shown above)
              if (isFilePath(value)) return null;
              return (
                <div key={key} className="flex items-center gap-1 bg-green-50 border border-green-200 rounded px-2 py-1">
                  <span className="font-medium text-green-800 text-[10px]">{key}:</span>
                  <span className="text-green-700 text-[10px] max-w-[200px] truncate">
                    {typeof value === 'string' ? value : JSON.stringify(value)}
                  </span>
                </div>
              );
            })}
            {Object.keys(filtered).length > 5 && (
              <span className="text-gray-500 text-[10px]">+{Object.keys(filtered).length - 5} more</span>
            )}
          </div>
        )}
      </div>
    );
  };

  // Format args for display (filtered)
  const formatArgs = (args: any): React.ReactNode => {
    if (!args) return null;
    const filtered = filterInternalIds(args);
    if (!filtered || Object.keys(filtered).length === 0) return null;

    return (
      <div className="flex flex-wrap gap-1 items-center">
        {Object.entries(filtered).slice(0, 4).map(([key, value]) => (
          <div key={key} className="flex items-center gap-1 bg-gray-50 rounded px-2 py-1">
            <span className="font-medium text-gray-800 text-[10px]">{key}:</span>
            <span className="text-gray-700 text-[10px] max-w-[150px] truncate">
              {typeof value === 'string' ? value : JSON.stringify(value)}
            </span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-1.5 my-1 group/tool">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className={clsx(
          "flex items-center gap-2.5 text-[12px] font-semibold tracking-tight w-fit py-0.5 px-0.5 rounded-md",
          status === 'running' && "tool-glow-bar"
        )}
      >
        {/* Status indicator — small colored dot instead of icons */}
        <div className="flex items-center justify-center w-2 h-2">
          <span className={clsx(
            "block rounded-full transition-all duration-300",
            isCompleted ? "w-2 h-2 bg-emerald-500 tool-complete-fade" :
            isError ? "w-2 h-2 bg-red-500 tool-complete-fade" :
            "w-1.5 h-1.5 bg-primary animate-pulse"
          )} />
        </div>

        <div className="flex items-center gap-1.5">
          <span className={clsx(
            "transition-all duration-300",
            status === 'running' ? "tool-glow-sweep font-semibold" :
            isError ? "text-red-600" :
            "text-theme-fg tool-complete-fade"
          )}>
            {displayText}
          </span>
        </div>

        <button
          onClick={() => setShowDetails(!showDetails)}
          className="flex items-center justify-center p-1 hover:bg-gray-100 rounded transition-colors"
        >
          <ChevronRight
            className={`w-3.5 h-3.5 text-theme-fg transition-transform duration-200 ${showDetails ? 'rotate-90' : ''
              }`}
          />
        </button>
      </motion.div>

      {showDetails && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="ml-8 text-[11px] text-gray-600 font-normal"
        >
          {isCompleted && tool.result ? (
            // Show results for completed tools
            <div className="py-1" data-onboarding="tool-result">
              <span className="text-gray-500 text-[10px] font-medium uppercase mb-1 block">Result:</span>
              {formatResult(tool.result)}
            </div>
          ) : isError && tool.error ? (
            // Show error
            <div className="py-1 text-red-600">
              {typeof tool.error === 'string' ? tool.error : JSON.stringify(tool.error)}
            </div>
          ) : tool.args ? (
            // Show args for running tools
            <div className="py-1">
              {formatArgs(tool.args)}
            </div>
          ) : null}
        </motion.div>
      )}
    </div>
  );
};

// Inline reasoning block for streamChunks - collapsible with timer, auto-collapses
const InlineReasoningBlock: React.FC<{
  content: string;
  isStreaming?: boolean;
  isLastReasoning?: boolean; // true if this is the last reasoning chunk (for live timer)
  finalDuration?: number; // For historical messages - final duration in seconds
}> = memo(({ content, isStreaming, isLastReasoning, finalDuration }) => {
  const [expanded, setExpanded] = useState(!!isStreaming); // Start collapsed for history
  const [autoCollapsed, setAutoCollapsed] = useState(!isStreaming); // Already collapsed for history
  const contentRef = useRef<HTMLDivElement>(null);
  const mountTimeRef = useRef(Date.now());
  const autoCollapseRef = useRef<NodeJS.Timeout | null>(null);
  const [frozenElapsed, setFrozenElapsed] = useState<number | null>(
    finalDuration != null ? finalDuration : null,
  );

  const tickerActive = Boolean(isStreaming && isLastReasoning && finalDuration == null && frozenElapsed == null);
  const liveElapsed = useElapsedSecondsFine(mountTimeRef.current, tickerActive);

  // Once streaming stops, freeze the final elapsed once and stop ticking.
  useEffect(() => {
    if (!isStreaming && isLastReasoning && finalDuration == null && frozenElapsed == null) {
      setFrozenElapsed((Date.now() - mountTimeRef.current) / 1000);
    }
  }, [isStreaming, isLastReasoning, finalDuration, frozenElapsed]);

  const elapsed = finalDuration != null
    ? finalDuration
    : frozenElapsed != null
      ? frozenElapsed
      : liveElapsed;

  // Auto-collapse after 3s once content starts flowing (only during streaming)
  useEffect(() => {
    if (isStreaming && content.length > 20 && expanded && !autoCollapsed) {
      autoCollapseRef.current = setTimeout(() => {
        setExpanded(false);
        setAutoCollapsed(true);
      }, 3000);
    }
    return () => { if (autoCollapseRef.current) clearTimeout(autoCollapseRef.current); };
  }, [content, expanded, autoCollapsed, isStreaming]);

  // Auto-scroll when expanded
  useEffect(() => {
    if (expanded && contentRef.current && isStreaming) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [content, expanded, isStreaming]);

  const toggle = () => {
    setExpanded(e => !e);
    if (autoCollapseRef.current) {
      clearTimeout(autoCollapseRef.current);
      autoCollapseRef.current = null;
    }
  };

  const formatSec = (s: number) => {
    if (s < 60) return `${Math.floor(s)}s`;
    return `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s`;
  };

  // Use finalDuration for history, live elapsed for streaming
  const displayDuration = finalDuration || elapsed;
  const durationLabel = displayDuration > 0.5
    ? (isStreaming && isLastReasoning ? `Thinking ${formatSec(displayDuration)}` : `Thought for ${formatSec(displayDuration)}`)
    : (isStreaming && isLastReasoning ? 'Thinking...' : 'Reasoning');

  return (
    <div className="max-w-[85%] md:max-w-[55%] my-1">
      <button
        onClick={toggle}
        className="group flex items-center gap-1.5 text-[11px] text-neutral-400 hover:text-neutral-500 transition-colors select-none"
      >
        <ChevronRight
          className={`w-3 h-3 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
        />
        <span className="italic font-medium">{durationLabel}</span>
        {isStreaming && isLastReasoning && (
          <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
        )}
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div
              ref={contentRef}
              className="mt-1.5 pl-3 border-l-2 border-violet-200/60 max-h-36 overflow-y-auto custom-scrollbar"
            >
              <div className="text-[12px] text-neutral-400 leading-relaxed py-1 prose prose-sm max-w-none prose-p:my-1 prose-headings:text-neutral-300 prose-headings:font-bold prose-headings:text-xs prose-code:text-primary prose-code:bg-theme-hover prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-[10px] prose-strong:text-neutral-300 prose-ul:my-1 prose-ol:my-1 prose-li:my-0">
                <ReactMarkdown
                  remarkPlugins={[remarkMath, remarkGfm]}
                  rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}
                >
                  {normalizeMarkdownSpacing(convertLatexDelims(escapeCurrencyDollars(content)))}
                </ReactMarkdown>
                {isStreaming && isLastReasoning && (
                  <span className="inline-block w-[2px] h-3 bg-violet-300 ml-0.5 animate-[blink_1s_step-end_infinite] align-middle rounded-full" />
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

interface ContextPath {
  path: string;
  name: string;
  isDirectory: boolean;
}

interface MessageBubbleProps {
  role: 'user' | 'assistant';
  text: string;
  reasoning?: string;
  reasoningDuration?: number; // in seconds
  toolCalls?: ToolCall[]; // Tool calls made during this response
  streamChunks?: StreamChunk[]; // Interleaved chunks for inline display
  isStreaming?: boolean;
  onReasoningClick?: () => void;
  contextPaths?: ContextPath[];
  onSubmitToolOutput?: (id: string, result: any) => void;
  onGenUIResponse?: (component: string, result: any) => void; // For syntax-based GenUI (```genui:...) responses
  compact?: boolean;
  attachments?: ChatAttachment[];
  // Edit & Revert
  messageId?: string;
  onEditMessage?: (messageId: string, newText: string) => void;
  modifiedFiles?: string[];
  checkpointId?: string;
  reverted?: boolean;
  onRevertFiles?: (messageId: string) => boolean | void | Promise<boolean | void>;
  onRedoFiles?: (messageId: string) => boolean | void | Promise<boolean | void>;
}

// Convert local file path to local-file:// URL for Electron (custom protocol)
function toMediaSrc(src: string): string {
  if (!src) return '';
  // Already a web URL or data URI
  if (/^(https?:|data:)/i.test(src)) return src;
  // Already using local-file protocol
  if (/^local-file:/i.test(src)) return src;
  // Convert file:// to local-file://
  if (/^file:/i.test(src)) {
    return src.replace(/^file:/i, 'local-file:');
  }
  // Convert Windows/Unix path to local-file:// URL
  let path = src.trim();
  const encodePath = (inputPath: string, preserveDrive: boolean) => {
    const parts = inputPath.split('/');
    return parts
      .map((part, idx) => {
        if (preserveDrive && idx === 0 && /^[a-zA-Z]:$/.test(part)) return part;
        return encodeURIComponent(part);
      })
      .join('/');
  };
  // Handle Windows paths (C:\... or C:/...)
  if (/^[a-zA-Z]:[/\\]/.test(path)) {
    path = path.replace(/\\/g, '/');
    return `local-file:///${encodePath(path, true)}`;
  }
  // Handle Unix absolute paths
  if (path.startsWith('/')) {
    path = path.replace(/\\/g, '/');
    return `local-file://${encodePath(path, false)}`;
  }
  // Relative path - assume local
  path = path.replace(/\\/g, '/');
  return `local-file:///${encodePath(path, false)}`;
}

// Image component that handles loading states and local/web URLs (memoized)
const InlineImage: React.FC<{ src: string; alt?: string }> = memo(({ src, alt }) => {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imageSrc = toMediaSrc(src || '');

  if (error) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-red-500/10 border border-red-500/20 rounded-lg text-red-700 text-xs">
        <span>⚠️</span>
        <span>Failed: {error}</span>
      </span>
    );
  }

  return (
    <>
      <img
        src={imageSrc}
        alt={alt || 'Image'}
        onLoad={() => setLoaded(true)}
        onError={() => setError(`${src}`)}
        className={clsx(
          "block my-2 max-w-full max-h-[300px] rounded-xl border border-theme/10 shadow-lg object-contain transition-opacity duration-200",
          loaded ? "opacity-100" : "opacity-0"
        )}
      />
      {!loaded && !error && (
        <span className="inline-flex items-center gap-2 px-3 py-2 bg-theme-hover rounded-xl text-theme-muted text-xs">
          <span className="w-3 h-3 border-2 border-theme/10 border-t-primary rounded-full animate-spin" />
          Loading...
        </span>
      )}
    </>
  );
});

const InlineVideo: React.FC<{ src: string }> = memo(({ src }) => {
  const [error, setError] = useState<string | null>(null);
  const videoSrc = toMediaSrc(src || '');

  if (error) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-red-500/10 border border-red-500/20 rounded-lg text-red-700 text-xs">
        <span>⚠️</span>
        <span>Failed: {error}</span>
      </span>
    );
  }

  return (
    <video
      src={videoSrc}
      controls
      playsInline
      onError={(e) => {
        const code = e.currentTarget?.error?.code;
        console.error(`[InlineVideo] Failed(${code ?? 'unknown'}): "${src}" → "${videoSrc}"`);
        setError(`${src}`);
      }}
      className="block my-2 max-w-full max-h-[300px] rounded-xl border border-theme/10 shadow-lg bg-black"
    />
  );
});

type ContentSegment =
  | { kind: 'text'; value: string }
  | { kind: 'image'; src: string }
  | { kind: 'video'; src: string }
  | { kind: 'audio'; src: string }
  | { kind: 'youtube'; videoId: string; url: string }
  | { kind: 'link_preview'; url: string }
  | { kind: 'genui'; component: string; args: any; id: string }
  | { kind: 'genui_loading'; component: string; title?: string };

// Strip markdown formatting from text (for GenUI component labels)
function stripMarkdown(text: string): string {
  if (typeof text !== 'string') return text;
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')  // **bold** → bold
    .replace(/\*([^*]+)\*/g, '$1')      // *italic* → italic
    .replace(/__([^_]+)__/g, '$1')      // __bold__ → bold
    .replace(/_([^_]+)_/g, '$1')        // _italic_ → italic
    .replace(/~~([^~]+)~~/g, '$1')      // ~~strike~~ → strike
    .replace(/`([^`]+)`/g, '$1')        // `code` → code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'); // [text](url) → text
}

// Recursively strip markdown from all string values in an object
function stripMarkdownFromArgs(args: any): any {
  if (typeof args === 'string') return stripMarkdown(args);
  if (Array.isArray(args)) return args.map(stripMarkdownFromArgs);
  if (args && typeof args === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(args)) {
      result[key] = stripMarkdownFromArgs(value);
    }
    return result;
  }
  return args;
}

// Map genui:* component names to GenUIContainer tool names
const GENUI_COMPONENT_MAP: Record<string, string> = {
  'confirm': 'ask_confirmation',
  'confirmation': 'ask_confirmation',
  'choices': 'show_choices',
  'choice': 'show_choices',
  'files': 'request_files',
  'dropzone': 'request_files',
  'tree': 'show_files',
  'filetree': 'show_files',
  'form': 'show_form',
  'wizard': 'show_form',
  'survey': 'show_form',
  'form_wizard': 'show_form',
};

function extractContentSegments(inputText: string): ContentSegment[] {
  if (!inputText) return [];
  const result: ContentSegment[] = [];

  // Regex for genui code blocks: ```genui:component\n{json}\n```
  const genuiRegex = /```genui:(\w+)\s*\n([\s\S]*?)```/g;
  const genuiIncompleteRegex = /```genui:(\w+)\s*\n([\s\S]*)$/; // Matches incomplete block at end
  const mediaRegex = /<<([^<>]+)>>/g;
  const youtubeRegex = /https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?[^\s]*v=|shorts\/|live\/|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})[^\s]*/gi;
  // Standalone http/https links (not in brackets, not in quotes, bounded by whitespace/newlines)
  const linkPreviewRegex = /(?:^|\s)(https?:\/\/[^\s]+)(?:$|\s)/g;
  const rawAudioRegex = /(?:[a-zA-Z]:\\[^<>:"|?*\n\r]+\.(?:wav|mp3|ogg|m4a|aac|webm)|(?:\/[^<>:"|?*\n\r]+\.(?:wav|mp3|ogg|m4a|aac|webm)))(?=\s|$)/gi;

  // First pass: extract complete GenUI blocks
  const genuiMatches: { start: number; end: number; component: string; args: any; id: string; loading?: boolean; title?: string }[] = [];
  let genuiMatch;
  let genuiCounter = 0;
  while ((genuiMatch = genuiRegex.exec(inputText)) !== null) {
    const componentName = genuiMatch[1].toLowerCase();
    const jsonContent = genuiMatch[2].trim();
    let args = {};
    try {
      args = JSON.parse(jsonContent);
    } catch (e) {
      console.warn('[GenUI] Failed to parse JSON for', componentName, ':', e);
      continue;
    }
    const toolName = GENUI_COMPONENT_MAP[componentName] || componentName;
    genuiMatches.push({
      start: genuiMatch.index,
      end: genuiMatch.index + genuiMatch[0].length,
      component: toolName,
      args,
      id: `genui-${genuiMatch.index}-${genuiCounter++}`,
    });
  }

  // Check for incomplete GenUI block at the end (streaming)
  const incompleteMatch = inputText.match(genuiIncompleteRegex);
  if (incompleteMatch) {
    const incompleteStart = inputText.lastIndexOf('```genui:');
    const alreadyMatched = genuiMatches.some(m => m.start === incompleteStart);
    if (!alreadyMatched && incompleteStart >= 0) {
      const componentName = incompleteMatch[1].toLowerCase();
      const toolName = GENUI_COMPONENT_MAP[componentName] || componentName;
      let title: string | undefined;
      try {
        const partialJson = incompleteMatch[2];
        const titleMatch = partialJson.match(/"title"\s*:\s*"([^"]+)"/);
        if (titleMatch) title = titleMatch[1];
      } catch { }
      genuiMatches.push({
        start: incompleteStart,
        end: inputText.length,
        component: toolName,
        args: {},
        id: `genui-loading-${incompleteStart}`,
        loading: true,
        title,
      });
    }
  }

  const youtubeMatches: { start: number; end: number; videoId: string; url: string }[] = [];
  let ytMatch;
  while ((ytMatch = youtubeRegex.exec(inputText)) !== null) {
    const videoId = extractYouTubeVideoId(ytMatch[0]);
    if (videoId) {
      youtubeMatches.push({
        start: ytMatch.index,
        end: ytMatch.index + ytMatch[0].length,
        videoId,
        url: ytMatch[0],
      });
    }
  }

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  const processTextChunk = (chunk: string) => {
    if (!chunk) return;
    let t = chunk
      .replace(/==([\s\S]*?)==/g, '[$1](#highlight)')
      .replace(/\+\+([\s\S]*?)\+\+/g, '[$1](#underline)');
    t = normalizeMarkdownSpacing(convertLatexDelims(escapeCurrencyDollars(t)));
    result.push({ kind: 'text', value: t });
  };

  const allMatches: Array<{ type: 'image' | 'video' | 'audio' | 'youtube' | 'link_preview' | 'genui' | 'genui_loading'; start: number; end: number; data: any }> = [];

  // Add GenUI matches first (highest priority)
  for (const g of genuiMatches) {
    if (g.loading) {
      allMatches.push({
        type: 'genui_loading',
        start: g.start,
        end: g.end,
        data: { component: g.component, title: g.title },
      });
    } else {
      allMatches.push({
        type: 'genui',
        start: g.start,
        end: g.end,
        data: { component: g.component, args: g.args, id: g.id },
      });
    }
  }

  while ((match = mediaRegex.exec(inputText)) !== null) {
    const src = String(match[1] || '').trim();
    const isAudio = /\.(wav|mp3|ogg|m4a|aac)$/i.test(src);
    const isVideo = /\.(mp4|mov|m4v|webm)$/i.test(src);
    allMatches.push({
      type: isAudio ? 'audio' : isVideo ? 'video' : 'image',
      start: match.index,
      end: match.index + match[0].length,
      data: { src },
    });
  }

  while ((match = rawAudioRegex.exec(inputText)) !== null) {
    const src = match[0].trim();
    const overlap = allMatches.some(
      (m) =>
        (match!.index >= m.start && match!.index < m.end) ||
        (match!.index + src.length > m.start && match!.index + src.length <= m.end)
    );

    if (!overlap) {
      allMatches.push({
        type: 'audio',
        start: match.index,
        end: match.index + src.length,
        data: { src },
      });
    }
  }

  for (const yt of youtubeMatches) {
    const insideMedia = allMatches.some((m) => yt.start >= m.start && yt.end <= m.end);
    if (!insideMedia) {
      allMatches.push({
        type: 'youtube',
        start: yt.start,
        end: yt.end,
        data: { videoId: yt.videoId, url: yt.url },
      });
    }
  }

  while ((match = linkPreviewRegex.exec(inputText)) !== null) {
    const raw = String(match[1] || '').trim();
    if (!raw) continue;
    const urlStart = match.index + match[0].indexOf(raw);
    const urlEnd = urlStart + raw.length;
    const overlap = allMatches.some(
      (m) =>
        (urlStart >= m.start && urlStart < m.end) ||
        (urlEnd > m.start && urlEnd <= m.end) ||
        (urlStart <= m.start && urlEnd >= m.end)
    );
    if (!overlap) {
      allMatches.push({
        type: 'link_preview',
        start: urlStart,
        end: urlEnd,
        data: { url: raw },
      });
    }
  }

  allMatches.sort((a, b) => a.start - b.start);

  for (const m of allMatches) {
    if (m.start > lastIndex) {
      processTextChunk(inputText.slice(lastIndex, m.start));
    }
    if (m.type === 'genui') {
      result.push({ kind: 'genui', component: m.data.component, args: m.data.args, id: m.data.id });
    } else if (m.type === 'genui_loading') {
      result.push({ kind: 'genui_loading', component: m.data.component, title: m.data.title });
    } else if (m.type === 'image' && m.data.src) {
      result.push({ kind: 'image', src: m.data.src });
    } else if (m.type === 'video' && m.data.src) {
      result.push({ kind: 'video', src: m.data.src });
    } else if (m.type === 'audio' && m.data.src) {
      result.push({ kind: 'audio', src: m.data.src });
    } else if (m.type === 'youtube') {
      result.push({ kind: 'youtube', videoId: m.data.videoId, url: m.data.url });
    } else if (m.type === 'link_preview') {
      result.push({ kind: 'link_preview', url: m.data.url });
    }
    lastIndex = m.end;
  }

  if (lastIndex < inputText.length) {
    processTextChunk(inputText.slice(lastIndex));
  }

  return result;
}

// Extract YouTube video ID from URL
function extractYouTubeVideoId(url: string): string | null {
  const patterns = [
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/watch\?.*v=([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/v\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/live\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

// YouTube embed component with oEmbed fetch (memoized)
interface YouTubeEmbedProps {
  videoId: string;
  url: string;
}

const YouTubeEmbed: React.FC<YouTubeEmbedProps> = memo(({ videoId, url }) => {
  const [data, setData] = useState<{ title: string; author: string; thumbnail: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetchInfo = async () => {
      try {
        // Use YouTube oEmbed API (no key needed)
        const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
        const res = await fetch(oembedUrl);
        if (!res.ok) throw new Error('Failed to fetch');
        const json = await res.json();
        if (!cancelled) {
          setData({
            title: json.title || 'YouTube Video',
            author: json.author_name || '',
            thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
          });
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          // Fallback - just show basic embed
          setData({
            title: 'YouTube Video',
            author: '',
            thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
          });
          setLoading(false);
        }
      }
    };
    fetchInfo();
    return () => { cancelled = true; };
  }, [videoId]);

  const handleClick = () => {
    try {
      (window as any).desktopAPI.openExternal(url);
    } catch {
      window.open(url, '_blank');
    }
  };

  if (loading) {
    return (
      <div className="my-2 w-full max-w-[320px] bg-black/30 rounded-xl border border-white/10 p-3 animate-pulse">
        <div className="aspect-video bg-white/5 rounded-lg mb-2" />
        <div className="h-4 bg-white/10 rounded w-3/4 mb-1" />
        <div className="h-3 bg-white/5 rounded w-1/2" />
      </div>
    );
  }

  return (
    <div
      onClick={handleClick}
      className="my-2 w-full max-w-[320px] bg-gradient-to-br from-red-600/10 to-black/30 rounded-xl border border-red-500/20 overflow-hidden cursor-pointer hover:border-red-500/40 hover:from-red-600/15 transition-all group shadow-lg"
    >
      {/* Thumbnail */}
      <div className="relative aspect-video bg-black">
        <img
          src={data?.thumbnail}
          alt={data?.title}
          className="w-full h-full object-cover"
        />
        {/* Play overlay */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/30 transition-colors">
          <div className="w-14 h-10 bg-red-600 rounded-xl flex items-center justify-center shadow-lg group-hover:bg-red-500 group-hover:scale-105 transition-all">
            <Play className="w-5 h-5 text-white fill-white ml-0.5" />
          </div>
        </div>
        {/* YouTube badge */}
        <div className="absolute bottom-2 right-2 px-1.5 py-0.5 bg-black/70 rounded text-[10px] text-white/80 font-medium">
          YouTube
        </div>
      </div>
      {/* Info */}
      <div className="p-3">
        <h4 className="text-sm font-medium text-white/90 line-clamp-2 leading-snug group-hover:text-white transition-colors">
          {data?.title}
        </h4>
        {data?.author && (
          <p className="text-xs text-white/50 mt-1 flex items-center gap-1">
            <span className="truncate">{data.author}</span>
            <ExternalLink className="w-3 h-3 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
          </p>
        )}
      </div>
    </div>
  );
});

// Format seconds to human readable
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}m ${secs}s`;
}

// Detect file paths in tool results and render copy/open actions
const FILE_PATH_RE = /^([a-zA-Z]:[/\\]|\/(?:tmp|var|home|Users)\/).+\.\w{1,5}$/;
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'flac', 'aac', 'opus', 'm4a']);

function getFileExt(p: string): string {
  return (p.match(/\.([a-zA-Z0-9]+)$/)?.[1] || '').toLowerCase();
}

function isFilePath(v: unknown): v is string {
  return typeof v === 'string' && FILE_PATH_RE.test(v.trim());
}

/** Extract all file paths from a tool result (flat or nested in arrays/objects) */
function extractFilePaths(result: any): string[] {
  const paths: string[] = [];
  if (!result || typeof result !== 'object') return paths;

  const walk = (obj: any) => {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) { obj.forEach(walk); return; }
    for (const [key, val] of Object.entries(obj)) {
      if (isFilePath(val)) paths.push(val);
      else if (typeof val === 'object' && val) walk(val);
    }
  };
  walk(result);
  return [...new Set(paths)];
}

const FilePathActions: React.FC<{ filePath: string }> = ({ filePath }) => {
  const [copied, setCopied] = React.useState(false);
  const ext = getFileExt(filePath);
  const isImage = IMAGE_EXTS.has(ext);
  const isAudio = AUDIO_EXTS.has(ext);
  const fileName = filePath.split(/[/\\]/).pop() || filePath;
  const kindLabel = isImage ? 'image' : isAudio ? 'audio' : ext ? ext.toUpperCase() : 'file';

  // When mounted inside a FileViewerProvider (VM/cloud chat), the open action
  // routes to the viewer pane. Outside the provider (regular desktop chat),
  // it falls back to opening the file in the OS app.
  const fileViewer = useFileViewerOptional();

  const copyPath = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(filePath);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const openFile = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (fileViewer) {
      fileViewer.openFile({ path: filePath, source: 'vm', name: fileName });
      return;
    }
    try { (window as any).desktopAPI?.openPath?.(filePath); } catch {}
  };

  const revealInFolder = (e: React.MouseEvent) => {
    e.stopPropagation();
    try { (window as any).desktopAPI?.showItemInFolder?.(filePath); } catch {}
  };

  return (
    <div className="my-0.5 flex items-center gap-2 rounded-lg border border-theme/10 bg-transparent px-2.5 py-1.5">
      <span className="shrink-0 rounded-full border border-theme/10 px-1.5 py-0.5 text-[9px] font-medium text-theme-muted">
        {kindLabel}
      </span>
      <span className="max-w-[200px] truncate text-[10px] font-medium text-theme-fg/85" title={filePath}>
        {fileName}
      </span>
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <button
          onClick={openFile}
          className="rounded p-0.5 text-theme-muted transition-colors hover:bg-theme-hover/20 hover:text-theme-fg"
          title="Open file"
        >
          <ExternalLink className="h-3 w-3" />
        </button>
        <button
          onClick={revealInFolder}
          className="rounded p-0.5 text-theme-muted transition-colors hover:bg-theme-hover/20 hover:text-theme-fg"
          title="Show in folder"
        >
          <Folder className="h-3 w-3" />
        </button>
        <button
          onClick={copyPath}
          className="rounded p-0.5 text-theme-muted transition-colors hover:bg-theme-hover/20 hover:text-theme-fg"
          title="Copy path"
        >
          {copied
            ? <Check className="h-3 w-3 text-green-600" />
            : <Copy className="h-3 w-3" />
          }
        </button>
      </div>
    </div>
  );
};

// Humanize tool name - removes underscores, capitalizes words, makes it readable
function humanizeToolName(tool: string): string {
  return tool
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase to spaces
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function getFilenameFromPath(p: string): string {
  return p.split(/[/\\]/).pop() || p;
}

// A subtle inline `code`-styled chip used inside step labels to highlight the
// argument that matters most (file path, command, query). Kept small so it
// blends with the surrounding label text.
const InlineCodeChip: React.FC<{ children: React.ReactNode; title?: string; max?: number }> = ({ children, title, max = 60 }) => {
  const text = typeof children === 'string' ? children : String(children ?? '');
  const display = text.length > max ? text.slice(0, max - 1) + '…' : text;
  return (
    <code
      className="rounded px-1 py-px font-mono text-[11.5px] align-baseline"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--sidebar-item-hover) 60%, transparent)',
        color: 'color-mix(in srgb, var(--foreground) 88%, transparent)',
        wordBreak: 'break-all',
      }}
      title={title || (text !== display ? text : undefined)}
    >
      {display}
    </code>
  );
};

function getQueryFromArgs(args: Record<string, any>): string | null {
  const candidates = ['query', 'search_term', 'q', 'pattern'];
  for (const k of candidates) {
    if (typeof args[k] === 'string' && args[k].trim()) return args[k].trim();
  }
  return null;
}

function getAnalyzeMediaTarget(args: Record<string, any>): string | null {
  const sources = Array.isArray(args.sources) ? args.sources : [];
  if (sources.length === 0) return null;
  if (sources.length === 1) {
    const src = sources[0] || {};
    if (src.captureScreen) return 'screen capture';
    if (typeof src.path === 'string') return getFilenameFromPath(src.path);
    if (typeof src.url === 'string') {
      try { return new URL(src.url).hostname.replace(/^www\./, ''); } catch { return src.url; }
    }
    return 'media';
  }
  return `${sources.length} media files`;
}

// Build a richer, action-oriented label for the chain-of-thought trace row.
// For known tools we surface the most relevant argument (file path, command,
// query) inline so the user can scan the trace without expanding each step.
// Falls back to the AI-supplied description / humanized tool name otherwise.
function getToolStepLabel(tool: ToolCall): React.ReactNode {
  const args = (tool.args || {}) as Record<string, any>;
  const path = typeof args.path === 'string' ? args.path : null;
  const filename = path ? getFilenameFromPath(path) : null;

  switch (tool.tool) {
    case 'write_file':
    case 'workspace_write_file': {
      if (!filename) break;
      const verb = args.append ? 'Appended to' : 'Wrote';
      return <span>{verb} <InlineCodeChip title={path || undefined}>{filename}</InlineCodeChip></span>;
    }
    case 'file_edit': {
      if (!filename) break;
      const mode = typeof args.mode === 'string' ? args.mode : 'replace';
      const verb = mode === 'delete' ? 'Removed from' : mode === 'insert_before' || mode === 'insert_after' ? 'Inserted into' : 'Edited';
      return <span>{verb} <InlineCodeChip title={path || undefined}>{filename}</InlineCodeChip></span>;
    }
    case 'read_file':
    case 'file_read':
    case 'workspace_read_file': {
      if (!filename) break;
      const ls = Number(args.line_start);
      const le = Number(args.line_end);
      const range = Number.isFinite(ls) && Number.isFinite(le) ? ` (L${ls}–${le})` : '';
      return <span>Read <InlineCodeChip title={path || undefined}>{filename}</InlineCodeChip>{range}</span>;
    }
    case 'list_directory':
    case 'workspace_list': {
      if (!filename) break;
      return <span>Listed <InlineCodeChip title={path || undefined}>{filename}</InlineCodeChip></span>;
    }
    case 'create_directory': {
      if (!filename) break;
      return <span>Created folder <InlineCodeChip title={path || undefined}>{filename}</InlineCodeChip></span>;
    }
    case 'delete_file': {
      if (!filename) break;
      return <span>Deleted <InlineCodeChip title={path || undefined}>{filename}</InlineCodeChip></span>;
    }
    case 'move_file':
    case 'copy_file': {
      const src = typeof args.src === 'string' ? getFilenameFromPath(args.src) : null;
      const dest = typeof args.dest === 'string' ? getFilenameFromPath(args.dest) : null;
      if (!src && !dest) break;
      const verb = tool.tool === 'copy_file' ? 'Copied' : 'Moved';
      return (
        <span>
          {verb} <InlineCodeChip title={args.src}>{src || '?'}</InlineCodeChip>
          {' '}<span className="opacity-60">→</span>{' '}
          <InlineCodeChip title={args.dest}>{dest || '?'}</InlineCodeChip>
        </span>
      );
    }
    case 'open_file': {
      if (!filename) break;
      return <span>Opened <InlineCodeChip title={path || undefined}>{filename}</InlineCodeChip></span>;
    }
    case 'analyze_media': {
      const target = getAnalyzeMediaTarget(args);
      return target
        ? <span>Analyzed <InlineCodeChip>{target}</InlineCodeChip></span>
        : 'Analyzed media';
    }
    case 'web_search': {
      const q = getQueryFromArgs(args);
      return q ? <span>Searched the web for <InlineCodeChip max={48}>{q}</InlineCodeChip></span> : 'Searched the web';
    }
    case 'scrape_url': {
      const url = typeof args.url === 'string' ? args.url : (typeof args.target === 'string' ? args.target : null);
      if (!url) break;
      let host = url;
      try { host = new URL(url).hostname.replace(/^www\./, ''); } catch {}
      return <span>Scraped <InlineCodeChip title={url}>{host}</InlineCodeChip></span>;
    }
    case 'glob': {
      const pat = typeof args.pattern === 'string' ? args.pattern : null;
      return pat ? <span>Searched files <InlineCodeChip max={48}>{pat}</InlineCodeChip></span> : 'Searched files';
    }
    case 'grep': {
      const pat = typeof args.pattern === 'string' ? args.pattern : null;
      return pat ? <span>Searched code <InlineCodeChip max={48}>{pat}</InlineCodeChip></span> : 'Searched code';
    }
    case 'run_command':
    case 'run_terminal_command':
    case 'start_terminal':
    case 'terminal_create': {
      const cmd = typeof args.command === 'string' ? args.command : null;
      return cmd ? <span>Ran <InlineCodeChip max={64}>{cmd}</InlineCodeChip></span> : 'Ran command';
    }
    case 'run_python_script':
    case 'run_node_script': {
      const lang = tool.tool === 'run_python_script' ? 'Python' : 'Node';
      const code = typeof args.code === 'string' ? args.code : (typeof args.script === 'string' ? args.script : null);
      const firstLine = code ? code.split('\n').find((l: string) => l.trim().length > 0) || '' : '';
      return firstLine
        ? <span>Ran {lang} <InlineCodeChip max={56}>{firstLine.trim()}</InlineCodeChip></span>
        : `Ran ${lang} script`;
    }
    case 'capture_screen':
    case 'take_screenshot':
      return 'Captured screen';
    case 'browser_use_navigate': {
      const url = typeof args.url === 'string' ? args.url : null;
      if (!url) break;
      let host = url;
      try { host = new URL(url).hostname.replace(/^www\./, ''); } catch {}
      return <span>Navigated to <InlineCodeChip title={url}>{host}</InlineCodeChip></span>;
    }
    case 'browser_use_click': {
      const sel = typeof args.selector === 'string' ? args.selector : (typeof args.text === 'string' ? args.text : null);
      return sel ? <span>Clicked <InlineCodeChip max={48}>{sel}</InlineCodeChip></span> : 'Clicked element';
    }
  }

  return tool.description || humanizeToolName(tool.tool);
}

type TraceStatus = 'complete' | 'active' | 'pending' | 'error';

interface AssistantTraceStepData {
  id: string;
  kind: 'reasoning' | 'tool' | 'status' | 'text';
  label: React.ReactNode;
  status: TraceStatus;
  content?: string;
  tool?: ToolCall;
  nested?: boolean;
  subagentId?: string;
  subagentKind?: string;
  statusVariant?: 'compacting';
  statusMeta?: {
    round?: number;
    maxRounds?: number;
    tokensBefore?: number;
    tokensAfter?: number;
    subagentKind?: string;
    subagentLabel?: string;
  };
}

const TOOL_GROUP_LABELS: Record<string, { singular: string; plural: string }> = {
  list_directory: { singular: 'Listed directory', plural: 'Listed {n} directories' },
  read_file: { singular: 'Read file', plural: 'Read {n} files' },
  file_read: { singular: 'Read file', plural: 'Read {n} files' },
  write_file: { singular: 'Wrote file', plural: 'Wrote {n} files' },
  file_edit: { singular: 'Edited file', plural: 'Edited {n} files' },
  search_local_workflows: { singular: 'Searched workflows', plural: 'Searched {n} workflows' },
  web_search: { singular: 'Searched the web', plural: 'Ran {n} web searches' },
  scrape_url: { singular: 'Scraped URL', plural: 'Scraped {n} URLs' },
  glob: { singular: 'Searched files', plural: 'Ran {n} file searches' },
  grep: { singular: 'Searched code', plural: 'Ran {n} code searches' },
  run_command: { singular: 'Ran command', plural: 'Ran {n} commands' },
  capture_screen: { singular: 'Captured screen', plural: 'Captured {n} screenshots' },
  browser_use_screenshot: { singular: 'Took screenshot', plural: 'Took {n} screenshots' },
  browser_use_analyze_screenshot: { singular: 'Analyzed browser screenshot', plural: 'Analyzed {n} browser screenshots' },
  browser_use_navigate: { singular: 'Navigated', plural: 'Navigated {n} pages' },
  browser_use_click: { singular: 'Clicked element', plural: 'Clicked {n} elements' },
};

function getGroupLabel(toolName: string, count: number): string {
  const entry = TOOL_GROUP_LABELS[toolName];
  if (!entry) {
    const humanized = humanizeToolName(toolName);
    return count === 1 ? humanized : `${humanized} ×${count}`;
  }
  return count === 1 ? entry.singular : entry.plural.replace('{n}', String(count));
}

function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(Math.round(n));
}

const StatusTraceMeta: React.FC<{
  meta: NonNullable<AssistantTraceStepData['statusMeta']>;
}> = ({ meta }) => {
  const { round, maxRounds, tokensBefore, tokensAfter } = meta;
  const hasRound = typeof round === 'number' && typeof maxRounds === 'number';
  const hasTokens = typeof tokensBefore === 'number' && tokensBefore > 0;
  const hasDelta = typeof tokensAfter === 'number' && tokensAfter > 0 && hasTokens;
  if (!hasRound && !hasTokens) return null;

  return (
    <div
      className="rounded-lg px-3 py-2 text-[11px] leading-relaxed"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--sidebar-item-hover) 25%, transparent)',
        color: 'color-mix(in srgb, var(--foreground) 62%, transparent)',
      }}
    >
      {hasRound ? <div>Round {round} of {maxRounds}</div> : null}
      {hasDelta ? (
        <div>
          {formatTokenCount(tokensBefore!)} <span className="opacity-60">→</span> {formatTokenCount(tokensAfter!)} tokens
        </div>
      ) : hasTokens ? (
        <div>{formatTokenCount(tokensBefore!)} tokens</div>
      ) : null}
    </div>
  );
};

const CollapsibleToolGroup: React.FC<{
  toolName: string;
  steps: { step: AssistantTraceStepData; idx: number }[];
  totalSteps: number;
}> = ({ toolName, steps, totalSteps }) => {
  const [expanded, setExpanded] = useState(false);
  const allComplete = steps.every(({ step }) => step.status === 'complete');
  const anyActive = steps.some(({ step }) => step.status === 'active');
  const groupStatus: TraceStatus = anyActive ? 'active' : allComplete ? 'complete' : 'pending';
  const label = getGroupLabel(toolName, steps.length);

  return (
    <div>
      <ChainOfThoughtStep
        status={groupStatus}
        isLast={steps[steps.length - 1].idx === totalSteps - 1 && !expanded}
        label={
          <button
            type="button"
            className="flex items-center gap-1.5 text-left"
            onClick={() => setExpanded(!expanded)}
          >
            <ChevronRight
              className={clsx(
                'h-3 w-3 shrink-0 transition-transform duration-150',
                expanded && 'rotate-90',
              )}
              style={{ color: 'color-mix(in srgb, var(--foreground-muted) 50%, transparent)' }}
            />
            {groupStatus === 'active' ? (
              <Shimmer as="span" duration={2} spread={3}>{label}</Shimmer>
            ) : (
              <span>{label}</span>
            )}
          </button>
        }
      />
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="overflow-hidden ml-3 border-l-[1.5px] pl-3"
            style={{ borderColor: 'color-mix(in srgb, var(--foreground-muted) 15%, transparent)' }}
          >
            {steps.map(({ step, idx }) => (
              <ChainOfThoughtStep
                key={step.id}
                status={step.status}
                isLast={idx === totalSteps - 1}
                label={step.status === 'active' ? (
                  <Shimmer as="span" duration={2} spread={3}>{step.label}</Shimmer>
                ) : step.label}
              >
                {step.kind === 'tool' && step.tool ? (
                  <ToolTraceContent tool={step.tool} />
                ) : null}
              </ChainOfThoughtStep>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// Tool names that represent delegation to a subagent — rendered as a distinct rectangle card
// so long-running delegated work is easy to track at a glance.
// `delegate` is the orchestrator's specialised-subagent tool; `deploy_headless_agent`
// is the general user-facing background-agent tool. Those are the only two real
// spawn entry points — every other name (subagent_create, spawn_agent, run_subagent,
// deploy_subagent) was a dead alias.
const DELEGATION_TOOL_NAMES = new Set(['delegate', 'deploy_headless_agent', 'route_to_workflow_agent']);

function resolveToolName(tool: ToolCall): string {
  return tool.tool === 'execute_tool' && tool.args?.tool_name
    ? String(tool.args.tool_name)
    : tool.tool;
}

function isDelegationToolCall(tool: ToolCall): boolean {
  return DELEGATION_TOOL_NAMES.has(resolveToolName(tool));
}

type DelegationTask = { subagent: string; instruction?: string };

function extractDelegationTasks(tool: ToolCall): DelegationTask[] {
  const args = (tool.args || {}) as Record<string, any>;
  const toolName = resolveToolName(tool);
  // `delegate` uses args.tasks[] with {subagent, instruction}
  if (Array.isArray(args.tasks) && args.tasks.length > 0) {
    return args.tasks.map((t: any) => ({
      subagent: String(t?.subagent ?? 'subagent'),
      instruction: typeof t?.instruction === 'string' ? t.instruction : undefined,
    }));
  }
  // `route_to_workflow_agent` — kind is implicit in the tool name
  const kind = toolName === 'route_to_workflow_agent'
    ? 'workflow'
    : (args.subagent || args.kind || args.agent || args.agent_kind || 'subagent');
  // `deploy_headless_agent` — flat args
  const instruction = args.objective || args.task || args.prompt || args.instruction;
  return [{
    subagent: String(kind),
    instruction: typeof instruction === 'string' ? instruction : undefined,
  }];
}

function normalizeSubagentName(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+agent$/i, '')
    .replace(/[\s-]+/g, '_');
}

function getStepLabelText(label: React.ReactNode): string {
  return typeof label === 'string' ? label : '';
}

function deriveDelegationStatus(parentStatus: TraceStatus, childSteps: AssistantTraceStepData[]): TraceStatus {
  if (childSteps.some((child) => child.status === 'error')) return 'error';

  const terminalLabel = childSteps
    .map((child) => getStepLabelText(child.label).toLowerCase())
    .find((label) => label.includes('subagent finished') || label.includes('subagent hit an error') || label.includes('subagent cancelled'));

  if (terminalLabel?.includes('error') || terminalLabel?.includes('cancelled')) return 'error';
  if (terminalLabel?.includes('finished')) return 'complete';
  if (childSteps.some((child) => child.status === 'active' || child.status === 'pending')) return 'active';
  return parentStatus;
}

function buildDelegationTaskStep(
  parentStep: AssistantTraceStepData,
  task: DelegationTask,
  taskIndex: number,
  childSteps: AssistantTraceStepData[],
): AssistantTraceStepData {
  const parentTool = parentStep.tool!;
  const { tasks: _tasks, ...restArgs } = (parentTool.args || {}) as Record<string, any>;
  const instructionArgs = task.instruction ? { instruction: task.instruction } : {};
  const taskTool: ToolCall = {
    ...parentTool,
    id: `${parentTool.id || parentStep.id}:task-${taskIndex}`,
    args: {
      ...restArgs,
      subagent: task.subagent,
      ...instructionArgs,
    },
  };

  return {
    ...parentStep,
    id: `${parentStep.id}:task-${taskIndex}`,
    status: deriveDelegationStatus(parentStep.status, childSteps),
    tool: taskTool,
  };
}

function assignDelegationChildrenToTasks(
  tasks: DelegationTask[],
  childEntries: Array<{ step: AssistantTraceStepData; idx: number }>,
): Array<{ children: AssistantTraceStepData[]; lastChildIdx: number }> {
  const groupsBySubagent = new Map<string, Array<{ step: AssistantTraceStepData; idx: number }>>();
  const unassigned: Array<{ step: AssistantTraceStepData; idx: number }> = [];

  for (const entry of childEntries) {
    const subagentId = entry.step.subagentId?.trim();
    if (!subagentId) {
      unassigned.push(entry);
      continue;
    }
    const group = groupsBySubagent.get(subagentId) || [];
    group.push(entry);
    groupsBySubagent.set(subagentId, group);
  }

  const assignments = tasks.map(() => ({ children: [] as AssistantTraceStepData[], lastChildIdx: -1 }));
  const usedTaskIndexes = new Set<number>();
  const deferredGroups: Array<Array<{ step: AssistantTraceStepData; idx: number }>> = [];

  const findAvailableTaskByKind = (kind: string): number => {
    const normalizedKind = normalizeSubagentName(kind);
    if (!normalizedKind) return -1;

    const matches = tasks
      .map((task, index) => ({ index, task }))
      .filter(({ index, task }) => !usedTaskIndexes.has(index) && normalizeSubagentName(task.subagent) === normalizedKind);

    return matches.length === 1 ? matches[0].index : -1;
  };

  for (const group of groupsBySubagent.values()) {
    const kind = group.find(({ step }) => step.subagentKind || step.statusMeta?.subagentKind)?.step.subagentKind
      || group.find(({ step }) => step.statusMeta?.subagentKind)?.step.statusMeta?.subagentKind
      || '';
    const taskIndex = findAvailableTaskByKind(kind);
    if (taskIndex >= 0) {
      assignments[taskIndex].children.push(...group.map(({ step }) => step));
      assignments[taskIndex].lastChildIdx = Math.max(assignments[taskIndex].lastChildIdx, ...group.map(({ idx }) => idx));
      usedTaskIndexes.add(taskIndex);
    } else {
      deferredGroups.push(group);
    }
  }

  for (const group of deferredGroups) {
    const taskIndex = tasks.findIndex((_, index) => !usedTaskIndexes.has(index));
    const targetIndex = taskIndex >= 0 ? taskIndex : Math.max(0, tasks.length - 1);
    assignments[targetIndex].children.push(...group.map(({ step }) => step));
    assignments[targetIndex].lastChildIdx = Math.max(assignments[targetIndex].lastChildIdx, ...group.map(({ idx }) => idx));
    usedTaskIndexes.add(targetIndex);
  }

  if (unassigned.length > 0 && assignments.length > 0) {
    assignments[0].children.push(...unassigned.map(({ step }) => step));
    assignments[0].lastChildIdx = Math.max(assignments[0].lastChildIdx, ...unassigned.map(({ idx }) => idx));
  }

  return assignments;
}


const DelegationCard: React.FC<{
  step: AssistantTraceStepData;
  childSteps: AssistantTraceStepData[];
  isLast: boolean;
}> = memo(({ step, childSteps, isLast }) => {
  const tool = step.tool!;
  const status = step.status;
  const tasks = useMemo(() => extractDelegationTasks(tool), [tool]);
  const isRunning = status === 'active';
  const isError = status === 'error';
  const isComplete = status === 'complete';

  const toolChildCount = childSteps.filter(c => c.kind === 'tool').length;

  // Auto-expand while running so progress is visible, auto-collapse once done.
  const [expanded, setExpanded] = useState(isRunning || isError);
  const prevRunningRef = useRef(isRunning);
  useEffect(() => {
    if (prevRunningRef.current && !isRunning && !isError) {
      setExpanded(false);
    }
    prevRunningRef.current = isRunning;
  }, [isRunning, isError]);

  // Live elapsed ticker while running — backed by the shared ticker bus so N
  // running delegation cards share a single interval instead of one each.
  const elapsedSec = useElapsedSeconds(tool.timestamp, isRunning);


  const agentLabel = tasks.length === 1
    ? `${humanizeToolName(tasks[0].subagent)} agent`
    : `${tasks.length} agents`;

  const hasWorkflowTask = tasks.some(t => normalizeSubagentName(t.subagent) === 'workflow');
  // Scan child trace steps for a completed create_workflow OR load_workflow
  // call and surface its workflow id, so "Open in Studio" can deep-link
  // instead of dumping the user on the workflow list. Either tool is a
  // valid signal that the workflow exists on disk and is in session.
  const targetWorkflowId = useMemo<string | null>(() => {
    if (!hasWorkflowTask) return null;
    const readSpecId = (raw: unknown): string | null => {
      if (!raw) return null;
      let val: any = raw;
      if (typeof val === 'string') {
        try { val = JSON.parse(val); } catch { return null; }
      }
      if (typeof val !== 'object' || val === null) return null;
      if (typeof val.workflowId === 'string' && val.workflowId) return val.workflowId;
      if (typeof val.id === 'string' && val.id.startsWith('flow_')) return val.id;
      if (val.spec && typeof val.spec.id === 'string' && val.spec.id) return val.spec.id;
      return null;
    };
    // Walk in reverse so the most-recent create/load wins if the agent did
    // both in one run (e.g. load → modify → create-derivative).
    for (let i = childSteps.length - 1; i >= 0; i--) {
      const c = childSteps[i];
      const t = c.tool;
      if (!t || c.kind !== 'tool') continue;
      const name = resolveToolName(t);
      if (name !== 'create_workflow' && name !== 'load_workflow') continue;
      // Only deep-link once the tool has actually finished — both create
      // and load mutate session/disk in their execute step, so completion
      // is the safe signal that the file is openable.
      if (t.status !== 'completed') continue;
      const fromResult = readSpecId(t.result);
      if (fromResult) return fromResult;
      const fromArgs = t.args?.workflowId || t.args?.spec?.id || t.args?.tool_args?.spec?.id;
      if (typeof fromArgs === 'string' && fromArgs) return fromArgs;
    }
    return null;
  }, [hasWorkflowTask, childSteps]);

  const statusText = isError
    ? 'Failed'
    : isRunning
      ? (toolChildCount > 0 ? `Working · ${toolChildCount} action${toolChildCount === 1 ? '' : 's'}` : 'Working…')
      : `Done · ${toolChildCount} action${toolChildCount === 1 ? '' : 's'}`;

  const borderColor = isError
    ? 'color-mix(in srgb, var(--destructive) 35%, transparent)'
    : isRunning
      ? 'color-mix(in srgb, var(--primary) 35%, transparent)'
      : 'color-mix(in srgb, var(--foreground-muted) 18%, transparent)';

  return (
    <div className={clsx('w-full', isLast ? 'mb-0' : 'mb-4')}>
      <div
        className="rounded-xl border overflow-hidden"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--sidebar-item-hover) 18%, transparent)',
          borderColor,
        }}
      >
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors"
        >
          <div
            className="mt-0.5 shrink-0 flex h-5 w-5 items-center justify-center rounded-md"
            style={{
              backgroundColor: isRunning
                ? 'color-mix(in srgb, var(--primary) 18%, transparent)'
                : 'color-mix(in srgb, var(--sidebar-item-hover) 70%, transparent)',
            }}
          >
            <Users
              className="h-3 w-3"
              style={{
                color: isRunning
                  ? 'color-mix(in srgb, var(--primary) 95%, transparent)'
                  : 'color-mix(in srgb, var(--foreground) 65%, transparent)',
              }}
            />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="text-[12px] font-medium"
                style={{ color: 'color-mix(in srgb, var(--foreground) 82%, transparent)' }}
              >
                {isRunning ? (
                  <Shimmer as="span" duration={2} spread={3}>{agentLabel}</Shimmer>
                ) : agentLabel}
              </span>
              <span
                className="text-[10px] tabular-nums"
                style={{ color: 'color-mix(in srgb, var(--foreground-muted) 85%, transparent)' }}
              >
                {statusText}
                {elapsedSec > 0 ? ` · ${formatDuration(elapsedSec)}` : ''}
              </span>
            </div>
            {tasks.length === 1 && tasks[0].instruction ? (
              <div
                className="mt-0.5 text-[11px] leading-snug line-clamp-2"
                style={{ color: 'color-mix(in srgb, var(--foreground) 58%, transparent)' }}
                title={tasks[0].instruction}
              >
                {tasks[0].instruction}
              </div>
            ) : null}
            {tasks.length > 1 ? (
              <div className="mt-1 flex flex-wrap gap-1">
                {tasks.map((t, i) => (
                  <span
                    key={`${t.subagent}-${i}`}
                    className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px]"
                    style={{
                      backgroundColor: 'color-mix(in srgb, var(--sidebar-item-hover) 65%, transparent)',
                      color: 'color-mix(in srgb, var(--foreground) 70%, transparent)',
                    }}
                    title={t.instruction}
                  >
                    {humanizeToolName(t.subagent)}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <div className="mt-0.5 flex shrink-0 items-center gap-1.5">
            {hasWorkflowTask && targetWorkflowId ? (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  try { window.desktopAPI?.openWorkflows({ workflowId: targetWorkflowId }); } catch {}
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    try { window.desktopAPI?.openWorkflows({ workflowId: targetWorkflowId }); } catch {}
                  }
                }}
                className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors cursor-pointer"
                style={{
                  backgroundColor: 'color-mix(in srgb, var(--primary) 14%, transparent)',
                  color: 'color-mix(in srgb, var(--primary) 95%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--primary) 28%, transparent)',
                }}
                title={`Open ${targetWorkflowId} in Workflow Studio`}
              >
                <ExternalLink className="h-3 w-3" />
                Open in Studio
              </span>
            ) : null}
            {isRunning ? (
              <Loader2
                className="h-3.5 w-3.5 animate-spin"
                style={{ color: 'color-mix(in srgb, var(--primary) 90%, transparent)' }}
              />
            ) : isError ? (
              <XCircle className="h-3.5 w-3.5 text-red-500" />
            ) : isComplete ? (
              <CheckCircle
                className="h-3.5 w-3.5"
                style={{ color: 'color-mix(in srgb, var(--foreground-muted) 70%, transparent)' }}
              />
            ) : null}
            <ChevronRight
              className={clsx(
                'h-3.5 w-3.5 transition-transform duration-200',
                expanded && 'rotate-90',
              )}
              style={{ color: 'color-mix(in srgb, var(--foreground-muted) 55%, transparent)' }}
            />
          </div>
        </button>

        <AnimatePresence initial={false}>
          {expanded && childSteps.length > 0 ? (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="overflow-hidden"
            >
              <div
                className="border-t px-3 pt-2.5 pb-1"
                style={{ borderColor: 'color-mix(in srgb, var(--foreground-muted) 12%, transparent)' }}
              >
                {childSteps.map((child, idx) => (
                  <ChainOfThoughtStep
                    key={child.id}
                    status={child.status}
                    isLast={idx === childSteps.length - 1}
                    label={
                      child.status === 'active' ? (
                        <Shimmer as="span" duration={2} spread={3}>{child.label}</Shimmer>
                      ) : child.label
                    }
                  >
                    {(child.kind === 'reasoning' || child.kind === 'text') && child.content ? (
                      <div
                        className="scrollbar-none max-h-40 overflow-y-auto rounded-lg px-3 py-2 text-[11px] leading-relaxed break-words prose prose-sm max-w-none prose-p:my-1 prose-headings:font-semibold prose-headings:text-[12px] prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-[10px] prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-pre:p-2 prose-pre:rounded-md prose-pre:text-[10px] prose-strong:font-semibold"
                        style={{
                          backgroundColor: 'color-mix(in srgb, var(--sidebar-item-hover) 25%, transparent)',
                          color: 'color-mix(in srgb, var(--foreground) 62%, transparent)',
                        }}
                      >
                        <ReactMarkdown
                          remarkPlugins={[remarkMath, remarkGfm]}
                          rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}
                        >
                          {normalizeMarkdownSpacing(convertLatexDelims(escapeCurrencyDollars(child.content)))}
                        </ReactMarkdown>
                      </div>
                    ) : null}
                    {child.kind === 'tool' && child.tool ? (
                      <ToolTraceContent tool={child.tool} />
                    ) : null}
                  </ChainOfThoughtStep>
                ))}
                {/* Inline steer input removed — running subagents are now nudged
                    via the main composer's steer-target dropdown so there's a
                    single place to talk to delegated agents. */}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
});

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function filterToolPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value
      .map((item) => filterToolPayload(item))
      .filter((item) => item !== null && item !== undefined);
    return items.length > 0 ? items : null;
  }

  if (isPlainRecord(value)) {
    const filtered: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (/^(id|.*_id|.*Id|session.*|conversation.*|description)$/i.test(key)) {
        continue;
      }
      const next = filterToolPayload(entry);
      if (next !== null && next !== undefined) {
        filtered[key] = next;
      }
    }
    return Object.keys(filtered).length > 0 ? filtered : null;
  }

  return value;
}

function truncatePreviewText(text: string, max = 96): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

function summarizePreviewValue(value: unknown): string {
  if (typeof value === 'string') return truncatePreviewText(value, 88);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.length === 1 ? '1 item' : `${value.length} items`;
  if (isPlainRecord(value)) {
    if (typeof value.status === 'string') return truncatePreviewText(value.status, 64);
    if (typeof value.path === 'string') return truncatePreviewText(value.path, 72);
    const count = Object.keys(value).length;
    return count === 1 ? '1 field' : `${count} fields`;
  }
  return 'No data';
}

function shouldShowRawDetails(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length > 5 || value.some((item) => typeof item === 'object' && item !== null);
  }

  if (isPlainRecord(value)) {
    const entries = Object.values(value);
    return (
      Object.keys(value).length > 5 ||
      entries.some((entry) => {
        if (typeof entry === 'string') return entry.length > 140;
        return Array.isArray(entry) || isPlainRecord(entry);
      })
    );
  }

  return false;
}

const PreviewBadge: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div
    className="inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px]"
    style={{
      backgroundColor: 'color-mix(in srgb, var(--sidebar-item-hover) 50%, transparent)',
      color: 'var(--foreground)',
    }}
  >
    <span className="text-theme-muted">{label}:</span>
    <span className="truncate font-medium">{value}</span>
  </div>
);

function extractSearchSources(result: unknown): Array<{ title: string; url: string; snippet?: string }> | null {
  if (!result || typeof result !== 'object') return null;
  const obj = result as Record<string, unknown>;

  let items: unknown[] | null = null;
  if (Array.isArray(obj.results)) items = obj.results;
  else if (Array.isArray(obj.sources)) items = obj.sources;
  else if (Array.isArray(obj.data)) items = obj.data;
  else if (Array.isArray(result)) items = result as unknown[];

  if (!items || items.length === 0) return null;

  const sources = items
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null && typeof (item as any).url === 'string')
    .map((item) => ({
      title: typeof item.title === 'string' ? item.title : '',
      url: item.url as string,
      snippet: typeof item.snippet === 'string' ? item.snippet : undefined,
    }));

  return sources.length > 0 ? sources : null;
}

function faviconUrl(siteUrl: string): string {
  try {
    const host = new URL(siteUrl).hostname;
    return `https://www.google.com/s2/favicons?sz=32&domain=${host}`;
  } catch {
    return '';
  }
}

const WebSearchSources: React.FC<{
  query?: string;
  sources: Array<{ title: string; url: string }>;
}> = ({ query, sources }) => (
  <div className="space-y-2">
    {query ? (
      <div
        className="text-[12px] leading-relaxed"
        style={{ color: 'color-mix(in srgb, var(--foreground) 60%, transparent)' }}
      >
        {query}
      </div>
    ) : null}
    <div className="flex flex-wrap gap-1.5">
      {sources.slice(0, 8).map((source) => {
        let hostname = '';
        try { hostname = new URL(source.url).hostname.replace(/^www\./, ''); } catch { hostname = source.url; }
        return (
          <a
            key={source.url}
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium text-theme-muted transition-opacity hover:opacity-80"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--sidebar-item-hover) 55%, transparent)',
            }}
            title={source.title || hostname}
          >
            <img
              src={faviconUrl(source.url)}
              alt=""
              className="h-3 w-3 rounded-sm"
              loading="lazy"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
            {hostname}
          </a>
        );
      })}
      {sources.length > 8 && (
        <span className="self-center text-[10px] text-theme-muted">+{sources.length - 8} more</span>
      )}
    </div>
  </div>
);

const ToolPayloadPreview: React.FC<{
  data: unknown;
  emptyLabel: string;
  toolName?: string;
  toolArgs?: unknown;
}> = ({ data, emptyLabel, toolName, toolArgs }) => {
  const filtered = filterToolPayload(data);

  if (toolName === 'web_search' && filtered) {
    const sources = extractSearchSources(filtered);
    if (sources) {
      let query: string | undefined;
      if (toolArgs && typeof toolArgs === 'object') {
        const args = toolArgs as Record<string, unknown>;
        if (typeof args.query === 'string') query = args.query;
        else if (typeof args.search_term === 'string') query = args.search_term;
        else if (typeof args.q === 'string') query = args.q;
      }
      return <WebSearchSources query={query} sources={sources} />;
    }
  }

  if (filtered === null || filtered === undefined) {
    return (
      <div className="text-[11px] text-theme-muted">
        {emptyLabel}
      </div>
    );
  }

  if (typeof filtered === 'string') {
    if (isFilePath(filtered)) {
      return <FilePathActions filePath={filtered} />;
    }

    return (
      <div
        className="rounded-lg px-3 py-2 text-[11px] leading-relaxed whitespace-pre-wrap break-words"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--sidebar-item-hover) 25%, transparent)',
          color: 'color-mix(in srgb, var(--foreground) 75%, transparent)',
        }}
      >
        {truncatePreviewText(filtered, 300)}
      </div>
    );
  }

  if (typeof filtered === 'number' || typeof filtered === 'boolean') {
    return <PreviewBadge label="Value" value={String(filtered)} />;
  }

  if (Array.isArray(filtered)) {
    if (filtered.every((item) => item === null || ['string', 'number', 'boolean'].includes(typeof item))) {
      return (
        <div className="flex flex-wrap gap-1.5">
          {filtered.slice(0, 6).map((item, index) => (
            <PreviewBadge key={`${String(item)}-${index}`} label={`Item ${index + 1}`} value={String(item)} />
          ))}
          {filtered.length > 6 ? (
            <span className="text-[10px] text-theme-muted">+{filtered.length - 6} more</span>
          ) : null}
        </div>
      );
    }
  }

  const filePaths = extractFilePaths(filtered);
  const rows: Array<{ key: string; value: string }> = [];
  const longText: Array<{ key: string; value: string }> = [];

  if (Array.isArray(filtered)) {
    rows.push({ key: 'items', value: String(filtered.length) });
  } else if (isPlainRecord(filtered)) {
    for (const [key, value] of Object.entries(filtered)) {
      if (isFilePath(value)) continue;

      if (typeof value === 'string' && value.length > 120 && longText.length === 0) {
        longText.push({ key, value });
        continue;
      }

      rows.push({ key, value: summarizePreviewValue(value) });
    }
  }

  return (
    <div className="space-y-2">
      {filePaths.length > 0 ? (
        <div className="flex flex-col gap-1">
          {filePaths.map((filePath) => (
            <FilePathActions key={filePath} filePath={filePath} />
          ))}
        </div>
      ) : null}

      {longText.map((entry) => (
        <div
          key={entry.key}
          className="rounded-lg px-3 py-2 text-[11px] leading-relaxed"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--sidebar-item-hover) 25%, transparent)',
            color: 'color-mix(in srgb, var(--foreground) 75%, transparent)',
          }}
        >
          <div className="mb-1 text-[10px] text-theme-muted">
            {humanizeToolName(entry.key)}
          </div>
          <div className="whitespace-pre-wrap break-words">
            {truncatePreviewText(entry.value, 240)}
          </div>
        </div>
      ))}

      {rows.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {rows.slice(0, 6).map((row) => (
            <PreviewBadge
              key={`${row.key}-${row.value}`}
              label={humanizeToolName(row.key)}
              value={row.value}
            />
          ))}
          {rows.length > 6 ? (
            <span className="text-[10px] text-theme-muted">+{rows.length - 6} more</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

const MAX_DIFF_LINES_PER_SIDE = 24;
const MAX_FILE_SNIPPET_LINES = 18;

// Render a unified-style diff for file_edit's old_string → new_string. Each
// removed line is shown red with `-`, each added line green with `+`.
const FileEditDiffPreview: React.FC<{
  oldText: string;
  newText: string;
  mode?: string;
  description?: string;
}> = ({ oldText, newText, mode, description }) => {
  const oldLines = (oldText || '').split('\n');
  const newLines = (newText || '').split('\n');

  const renderSide = (lines: string[], sign: '-' | '+', sideLabel: string) => {
    const shown = lines.slice(0, MAX_DIFF_LINES_PER_SIDE);
    const overflow = lines.length - shown.length;
    const isMinus = sign === '-';
    const lineColor = isMinus ? 'rgb(248,113,113)' : 'rgb(74,222,128)';
    const lineBg = isMinus
      ? 'color-mix(in srgb, rgb(248,113,113) 12%, transparent)'
      : 'color-mix(in srgb, rgb(74,222,128) 10%, transparent)';
    return (
      <>
        {shown.map((line, i) => (
          <div key={`${sign}-${i}`} className="flex" style={{ backgroundColor: lineBg }}>
            <span
              className="w-4 shrink-0 select-none text-center"
              style={{ color: lineColor, opacity: 0.85 }}
            >
              {sign}
            </span>
            <span
              className="flex-1 whitespace-pre-wrap break-all px-1.5"
              style={{ color: lineColor }}
            >
              {line || '\u00A0'}
            </span>
          </div>
        ))}
        {overflow > 0 ? (
          <div
            className="px-2 py-0.5 text-[10px]"
            style={{ color: 'color-mix(in srgb, var(--foreground-muted) 80%, transparent)' }}
          >
            … {overflow} more {sideLabel} line{overflow === 1 ? '' : 's'}
          </div>
        ) : null}
      </>
    );
  };

  const isInsert = mode === 'insert_before' || mode === 'insert_after';
  const isDelete = mode === 'delete';

  return (
    <div className="space-y-1.5">
      {description ? (
        <div
          className="text-[11px] leading-snug"
          style={{ color: 'color-mix(in srgb, var(--foreground) 60%, transparent)' }}
        >
          {description}
        </div>
      ) : null}
      <div
        className="overflow-hidden rounded-lg font-mono text-[11px] leading-[1.55]"
        style={{
          border: '1px solid color-mix(in srgb, var(--foreground-muted) 14%, transparent)',
          backgroundColor: 'color-mix(in srgb, var(--sidebar-item-hover) 18%, transparent)',
        }}
      >
        <div className="py-0.5">
          {!isInsert ? renderSide(oldLines, '-', 'removed') : null}
          {!isDelete ? renderSide(newLines, '+', 'added') : null}
        </div>
      </div>
    </div>
  );
};

// Render a write_file payload: file actions row + a short content preview.
const WriteFilePreview: React.FC<{
  path?: string;
  content?: string;
  description?: string;
  appended?: boolean;
}> = ({ path, content, description, appended }) => {
  const lines = (content || '').split('\n');
  const shown = lines.slice(0, MAX_FILE_SNIPPET_LINES).join('\n');
  const overflow = lines.length - Math.min(lines.length, MAX_FILE_SNIPPET_LINES);
  const bytes = (content || '').length;
  const sizeLabel = bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;

  return (
    <div className="space-y-1.5">
      {description ? (
        <div
          className="text-[11px] leading-snug"
          style={{ color: 'color-mix(in srgb, var(--foreground) 60%, transparent)' }}
        >
          {description}
        </div>
      ) : null}
      {path ? <FilePathActions filePath={path} /> : null}
      {content ? (
        <div
          className="overflow-hidden rounded-lg font-mono text-[11px] leading-[1.55]"
          style={{
            border: '1px solid color-mix(in srgb, var(--foreground-muted) 14%, transparent)',
            backgroundColor: 'color-mix(in srgb, var(--sidebar-item-hover) 18%, transparent)',
          }}
        >
          <div
            className="flex items-center justify-between px-2.5 py-1 text-[10px]"
            style={{
              color: 'color-mix(in srgb, var(--foreground-muted) 90%, transparent)',
              backgroundColor: 'color-mix(in srgb, var(--sidebar-item-hover) 35%, transparent)',
            }}
          >
            <span>{appended ? 'Appended' : 'Content'} · {lines.length} line{lines.length === 1 ? '' : 's'} · {sizeLabel}</span>
          </div>
          <pre className="whitespace-pre-wrap break-all px-2.5 py-1.5 m-0">
            {shown}
            {overflow > 0 ? `\n… +${overflow} more line${overflow === 1 ? '' : 's'}` : ''}
          </pre>
        </div>
      ) : null}
    </div>
  );
};

// Render a read_file completion: file actions + small metadata badges.
const ReadFilePreview: React.FC<{
  path?: string;
  result: any;
}> = ({ path, result }) => {
  const r = (result && typeof result === 'object') ? result as Record<string, any> : {};
  const ok = r.ok !== false;
  const totalLines = typeof r.total_lines === 'number' ? r.total_lines : null;
  const lineStart = typeof r.line_start === 'number' ? r.line_start : null;
  const lineEnd = typeof r.line_end === 'number' ? r.line_end : null;
  const linesReturned = typeof r.lines_returned === 'number' ? r.lines_returned : null;
  const truncated = r.truncated === true;
  const mime = typeof r.mime_type === 'string' ? r.mime_type : null;
  const docType = typeof r.document_type === 'string' ? r.document_type : null;
  const errMsg = typeof r.error === 'string' ? r.error : (typeof r.message === 'string' && !ok ? r.message : null);

  const badges: Array<{ label: string; value: string }> = [];
  if (totalLines !== null) badges.push({ label: 'Total', value: `${totalLines} lines` });
  if (lineStart !== null && lineEnd !== null) badges.push({ label: 'Range', value: `L${lineStart}–${lineEnd}` });
  else if (linesReturned !== null) badges.push({ label: 'Returned', value: `${linesReturned} lines` });
  if (mime) badges.push({ label: 'Type', value: mime });
  if (docType && docType !== mime) badges.push({ label: 'Doc', value: docType });
  if (truncated) badges.push({ label: 'Status', value: 'Truncated' });

  return (
    <div className="space-y-1.5">
      {path ? <FilePathActions filePath={path} /> : null}
      {errMsg ? (
        <div
          className="rounded-lg px-3 py-2 text-[11px] leading-relaxed text-red-500/90"
          style={{ backgroundColor: 'color-mix(in srgb, var(--destructive) 8%, transparent)' }}
        >
          {errMsg}
        </div>
      ) : null}
      {badges.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {badges.map((b) => (
            <PreviewBadge key={`${b.label}-${b.value}`} label={b.label} value={b.value} />
          ))}
        </div>
      ) : null}
    </div>
  );
};

// Render an analyze_media completion: just the model summary text. Hides the
// raw input (sources may include base64 / very long URLs we don't want to dump
// in the trace).
const AnalyzeMediaPreview: React.FC<{
  args: Record<string, any>;
  result: any;
}> = ({ args, result }) => {
  const summary = typeof result?.summary === 'string'
    ? result.summary
    : (typeof result === 'string' ? result : '');
  const sources = Array.isArray(args?.sources) ? args.sources : [];
  const filePaths = sources
    .map((s: any) => (typeof s?.path === 'string' ? s.path : null))
    .filter((p: string | null): p is string => !!p && isFilePath(p));
  const task = typeof args?.task === 'string' ? args.task : '';

  return (
    <div className="space-y-1.5">
      {task ? (
        <div
          className="text-[11px] leading-snug italic"
          style={{ color: 'color-mix(in srgb, var(--foreground) 55%, transparent)' }}
        >
          {truncatePreviewText(task, 160)}
        </div>
      ) : null}
      {filePaths.length > 0 ? (
        <div className="flex flex-col gap-1">
          {filePaths.map((p: string) => <FilePathActions key={p} filePath={p} />)}
        </div>
      ) : null}
      {summary ? (
        <div
          className="rounded-lg px-3 py-2 text-[11.5px] leading-relaxed whitespace-pre-wrap break-words"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--sidebar-item-hover) 25%, transparent)',
            color: 'color-mix(in srgb, var(--foreground) 80%, transparent)',
          }}
        >
          {summary}
        </div>
      ) : (
        <div className="text-[11px] text-theme-muted">No summary returned.</div>
      )}
    </div>
  );
};

const LIVE_OUTPUT_TOOL_NAMES = new Set([
  'run_command',
  'run_python_script',
  'run_node_script',
]);

const LiveOutputPanel: React.FC<{ output: string; toolName: string }> = ({ output, toolName }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Tail-follow: keep the latest output line visible as new chunks stream in.
    el.scrollTop = el.scrollHeight;
  }, [output]);

  // Cap rendered text — useAgent.ts already trims to ~16KB, but a defensive
  // slice keeps DOM cheap if a future caller forwards a larger payload.
  const display = output.length > 16 * 1024
    ? output.slice(output.length - 16 * 1024)
    : output;

  return (
    <div className="overflow-hidden rounded-md border border-white/5"
      style={{ backgroundColor: 'color-mix(in srgb, var(--sidebar-item-hover) 40%, transparent)' }}
    >
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-white/5">
        <Terminal className="h-3 w-3 text-theme-muted" />
        <span className="text-[10px] font-medium text-theme-muted uppercase tracking-wide">
          {toolName === 'run_command' ? 'output' : toolName}
        </span>
        <Loader2 className="ml-auto h-3 w-3 animate-spin text-theme-muted" />
      </div>
      <div
        ref={ref}
        className="scrollbar-thin font-mono text-[10.5px] leading-[1.45] px-2.5 py-1.5 overflow-y-auto whitespace-pre-wrap break-all"
        style={{
          maxHeight: 160,
          color: 'color-mix(in srgb, var(--foreground) 78%, transparent)',
        }}
      >
        {display || <span className="opacity-50">Waiting for output…</span>}
      </div>
    </div>
  );
};

const ToolTraceContent: React.FC<{ tool: ToolCall }> = memo(({ tool }) => {
  if (tool.status === 'error') {
    const errorText =
      typeof tool.error === 'string'
        ? tool.error
        : JSON.stringify(tool.error || 'Tool failed', null, 2);

    return (
      <div className="rounded-lg px-3 py-2 text-[11px] leading-relaxed text-red-500/90 whitespace-pre-wrap break-words"
        style={{ backgroundColor: 'color-mix(in srgb, var(--destructive) 8%, transparent)' }}
      >
        {errorText}
      </div>
    );
  }

  if (
    (tool.status === 'running' || tool.status === 'called')
    && LIVE_OUTPUT_TOOL_NAMES.has(tool.tool)
  ) {
    return <LiveOutputPanel output={tool.liveOutput || ''} toolName={tool.tool} />;
  }

  if (tool.status === 'completed') {
    const args = (tool.args || {}) as Record<string, any>;

    if (tool.tool === 'file_edit') {
      return (
        <FileEditDiffPreview
          oldText={String(args.old_string ?? '')}
          newText={String(args.new_string ?? '')}
          mode={typeof args.mode === 'string' ? args.mode : undefined}
          description={typeof args.description === 'string' ? args.description : undefined}
        />
      );
    }

    if (tool.tool === 'write_file' || tool.tool === 'workspace_write_file') {
      return (
        <WriteFilePreview
          path={typeof args.path === 'string' ? args.path : undefined}
          content={typeof args.content === 'string' ? args.content : undefined}
          description={typeof args.description === 'string' ? args.description : undefined}
          appended={Boolean(args.append)}
        />
      );
    }

    if (
      tool.tool === 'read_file'
      || tool.tool === 'file_read'
      || tool.tool === 'workspace_read_file'
    ) {
      return (
        <ReadFilePreview
          path={typeof args.path === 'string' ? args.path : undefined}
          result={tool.result}
        />
      );
    }

    if (tool.tool === 'analyze_media' || tool.tool === 'browser_use_analyze_screenshot') {
      return <AnalyzeMediaPreview args={args} result={tool.result} />;
    }

    return (
      <ToolPayloadPreview
        data={tool.result}
        toolName={tool.tool}
        toolArgs={tool.args}
        emptyLabel=""
      />
    );
  }

  return null;
});

function summarizeReasoningLabel(content: string, fallback: string = 'Planning next moves'): string {
  const plain = content
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`*_>#-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!plain) return fallback;

  const sentence = plain.split(/[.?!]/)[0]?.trim() || plain;
  const summary = truncatePreviewText(sentence, 72);
  return summary.split(' ').length >= 2 ? summary : fallback;
}

// Fallback label used when a nested subagent reply has no summarizable content
// yet (empty stream, single-token, or symbols-only). Kept distinct so the UI
// still conveys "this came from a subagent" in that rare case.
const SUBAGENT_REPLY_FALLBACK = 'Subagent reply';

function getStreamingStepFallback(step: AssistantTraceStepData): string {
  return step.kind === 'text' ? SUBAGENT_REPLY_FALLBACK : 'Planning next moves';
}

function tryMergeStreamingStep(
  last: AssistantTraceStepData,
  step: AssistantTraceStepData,
): AssistantTraceStepData | null {
  if (last.kind !== step.kind) return null;
  if (step.kind !== 'reasoning' && step.kind !== 'text') return null;
  if (!step.content || !last.content) return null;
  if (Boolean(step.nested) !== Boolean(last.nested)) return null;
  if (step.subagentId !== last.subagentId) return null;
  if (!isRedundantStreamingUpdate(last.content, step.content)) return null;

  const mergedContent = mergeStreamingText(last.content, step.content);
  return {
    ...last,
    id: step.id,
    label: summarizeReasoningLabel(mergedContent, getStreamingStepFallback(step)),
    status: step.status === 'active' ? 'active' : last.status,
    content: mergedContent,
    nested: step.nested,
    subagentId: step.subagentId,
    subagentKind: step.subagentKind,
  };
}

function compactReasoningTraceSteps(steps: AssistantTraceStepData[]): AssistantTraceStepData[] {
  const compacted: AssistantTraceStepData[] = [];

  for (const step of steps) {
    const last = compacted[compacted.length - 1];
    if (last) {
      const merged = tryMergeStreamingStep(last, step);
      if (merged) {
        compacted[compacted.length - 1] = merged;
        continue;
      }
    }

    compacted.push(step);
  }

  return compacted;
}

function mapTraceStatus(tool: ToolCall, isStreaming?: boolean): TraceStatus {
  if (tool.status === 'completed') return 'complete';
  if (tool.status === 'error') return 'error';
  if (tool.status === 'running') return 'active';
  return isStreaming ? 'active' : 'pending';
}

function isDelegatedToolCall(tool: ToolCall): boolean {
  if (tool.nested) return true;
  if (typeof tool.subagentId === 'string' && tool.subagentId.trim().length > 0) return true;
  if (typeof tool.id !== 'string') return false;
  return (
    tool.id.startsWith('subagent:') ||
    tool.id.startsWith('subagent-') ||
    tool.id.startsWith('sub-tc-')
  );
}

function isTopLevelDuplicateOfNestedTool(tool: ToolCall, streamChunks?: StreamChunk[]): boolean {
  if (isDelegatedToolCall(tool) || !streamChunks?.length) return false;
  // Match by id first — fast path for the standard case where the orchestrator
  // and subagent share a toolCallId. When ids diverge (AI-SDK toolCallId vs
  // bridge-issued id for the same logical tool), fall back to matching by
  // tool name within close temporal range, so the subagent's tool call doesn't
  // also render in the orchestrator's chain-of-thought outside the rectangle.
  return streamChunks.some((chunk) => {
    if (chunk.type !== 'tool' || !isDelegatedToolCall(chunk.tool)) return false;
    if (tool.id && chunk.tool.id === tool.id) return true;
    if (chunk.tool.tool !== tool.tool) return false;
    const a = typeof tool.timestamp === 'number' ? tool.timestamp : 0;
    const b = typeof chunk.tool.timestamp === 'number' ? chunk.tool.timestamp : 0;
    if (!a || !b) return true; // no timestamps — assume same logical call
    return Math.abs(a - b) < 30_000; // 30s window covers slow bridge round-trips
  });
}

function isTopLevelDuplicateOfNestedText(
  chunk: Extract<StreamChunk, { type: 'text' }>,
  streamChunks?: StreamChunk[],
): boolean {
  if (chunk.nested || !chunk.content.trim() || !streamChunks?.length) return false;
  return streamChunks.some((candidate) => {
    if (candidate.type !== 'text' || !candidate.nested || !candidate.content.trim()) return false;
    return isRedundantStreamingUpdate(candidate.content, chunk.content)
      || isRedundantStreamingUpdate(chunk.content, candidate.content);
  });
}

const AssistantTracePanel: React.FC<{
  reasoning?: string;
  reasoningDuration?: number;
  toolCalls?: ToolCall[];
  streamChunks?: StreamChunk[];
  isStreaming?: boolean;
  defaultOpen?: boolean;
}> = ({
  reasoning,
  reasoningDuration,
  toolCalls,
  streamChunks,
  isStreaming,
  defaultOpen,
}) => {
  const traceSteps = useMemo<AssistantTraceStepData[]>(() => {
    const steps: AssistantTraceStepData[] = [];

    if (streamChunks && streamChunks.length > 0) {
      const lastReasoningIndex = streamChunks.reduce((lastIndex, chunk, index) => (
        chunk.type === 'reasoning' ? index : lastIndex
      ), -1);
      const lastNestedTextIndex = streamChunks.reduce((lastIndex, chunk, index) => (
        chunk.type === 'text' && chunk.nested ? index : lastIndex
      ), -1);

      streamChunks.forEach((chunk, index) => {
        if (chunk.type === 'reasoning') {
          steps.push({
            id: `reasoning-${index}`,
            kind: 'reasoning',
            label: summarizeReasoningLabel(chunk.content),
            status: isStreaming && index === lastReasoningIndex ? 'active' : 'complete',
            content: chunk.content,
            nested: chunk.nested,
            subagentId: chunk.subagentId,
          });
          return;
        }

        // Nested text = a delegated subagent's narration to the orchestrator.
        // Render it inside the chain-of-thought with a live summary of the
        // subagent's prose as the label (mirroring how reasoning/thought tokens
        // display), rather than a static "Subagent reply" tag.
        if (chunk.type === 'text' && chunk.nested) {
          steps.push({
            id: `nested-text-${index}`,
            kind: 'text',
            label: summarizeReasoningLabel(chunk.content, SUBAGENT_REPLY_FALLBACK),
            status: isStreaming && index === lastNestedTextIndex ? 'active' : 'complete',
            content: chunk.content,
            nested: true,
            subagentId: chunk.subagentId,
          });
          return;
        }

        if (chunk.type === 'tool') {
          const tc = chunk.tool;
          if (isTopLevelDuplicateOfNestedTool(tc, streamChunks)) return;
          if (HIDDEN_TOOL_NAMES.has(tc.tool) || GENUI_TOOL_NAMES.has(tc.tool)) return;

          steps.push({
            id: tc.id || `tool-${index}`,
            kind: 'tool',
            label: getToolStepLabel(tc),
            status: mapTraceStatus(tc, isStreaming),
            tool: tc,
            nested: isDelegatedToolCall(tc),
            subagentId: tc.subagentId,
          });
          return;
        }

        if (chunk.type === 'status') {
          steps.push({
            id: chunk.id || `status-${index}`,
            kind: 'status',
            label: chunk.label,
            status: chunk.state === 'error' ? 'error' : chunk.state === 'active' ? 'active' : 'complete',
            nested: chunk.nested,
            subagentId: chunk.subagentId,
            subagentKind: typeof chunk.meta?.subagentKind === 'string' ? chunk.meta.subagentKind : undefined,
            statusVariant: chunk.variant,
            statusMeta: chunk.meta,
          });
        }
      });

      return compactReasoningTraceSteps(steps);
    }

    if (reasoning && reasoning.trim().length > 0) {
      steps.push({
        id: 'reasoning-fallback',
        kind: 'reasoning',
        label: summarizeReasoningLabel(reasoning),
        status: 'complete',
        content: reasoning,
      });
    }

    (toolCalls || [])
      .filter((tool) => !HIDDEN_TOOL_NAMES.has(tool.tool) && !GENUI_TOOL_NAMES.has(tool.tool))
      .forEach((tool, index) => {
        steps.push({
          id: tool.id || `tool-fallback-${index}`,
          kind: 'tool',
          label: getToolStepLabel(tool),
          status: mapTraceStatus(tool, isStreaming),
          tool,
          nested: isDelegatedToolCall(tool),
          subagentId: tool.subagentId,
        });
      });

    return compactReasoningTraceSteps(steps);
  }, [isStreaming, reasoning, streamChunks, toolCalls]);

  // Build the display tree out of traceSteps in a useMemo so that streaming
  // ticks (which flip `isStreaming`/timer state in ancestors) don't re-walk
  // the O(N) DisplayItem/nestGroups graph on every render. Only traceSteps
  // identity actually controls structure here.
  const renderedTraceTree = useMemo(() => {
          // Build display items: group consecutive same-tool calls, separate nested vs orchestrator,
          // and wrap delegation tool calls with their subagent children into a single rectangle card.
          type DisplayItem =
            | { type: 'step'; step: AssistantTraceStepData; idx: number; nested: boolean }
            | { type: 'tool-group'; toolName: string; steps: { step: AssistantTraceStepData; idx: number }[]; nested: boolean }
            | { type: 'delegation'; step: AssistantTraceStepData; idx: number; children: AssistantTraceStepData[]; lastChildIdx: number };

          const items: DisplayItem[] = [];
          const consumedNestedIndexes = new Set<number>();
          let i = 0;
          while (i < traceSteps.length) {
            if (consumedNestedIndexes.has(i)) {
              i++;
              continue;
            }
            const step = traceSteps[i];
            const isNested = Boolean(step.nested);

            // Top-level delegation tool: absorb later nested subagent steps as
            // children. Long tool calls can time out and let orchestrator
            // reasoning interleave before the subagent's final updates arrive,
            // so this cannot require strict adjacency.
            if (!isNested && step.kind === 'tool' && step.tool && isDelegationToolCall(step.tool)) {
              const childEntries: Array<{ step: AssistantTraceStepData; idx: number }> = [];
              let lastChildIdx = i;
              let j = i + 1;
              while (j < traceSteps.length) {
                const candidate = traceSteps[j];
                if (
                  !candidate.nested &&
                  candidate.kind === 'tool' &&
                  candidate.tool &&
                  isDelegationToolCall(candidate.tool)
                ) {
                  break;
                }
                if (candidate.nested) {
                  childEntries.push({ step: candidate, idx: j });
                  consumedNestedIndexes.add(j);
                  lastChildIdx = j;
                }
                j++;
              }
              const tasks = extractDelegationTasks(step.tool);
              if (tasks.length > 1) {
                const taskAssignments = assignDelegationChildrenToTasks(tasks, childEntries);
                taskAssignments.forEach((assignment, taskIndex) => {
                  items.push({
                    type: 'delegation',
                    step: buildDelegationTaskStep(step, tasks[taskIndex], taskIndex, assignment.children),
                    idx: i,
                    children: assignment.children,
                    lastChildIdx: assignment.lastChildIdx >= 0 ? assignment.lastChildIdx : i,
                  });
                });
              } else {
                const children = childEntries.map(({ step: child }) => child);
                items.push({
                  type: 'delegation',
                  step,
                  idx: i,
                  children,
                  lastChildIdx,
                });
              }
              i++;
              continue;
            }

            // Try to group consecutive tool steps with the same tool name and same nesting level
            if (step.kind === 'tool' && step.tool) {
              const toolName = step.tool.tool;
              const groupSteps: { step: AssistantTraceStepData; idx: number }[] = [{ step, idx: i }];
              let j = i + 1;
              while (j < traceSteps.length) {
                const next = traceSteps[j];
                if (next.kind === 'tool' && next.tool?.tool === toolName && Boolean(next.nested) === isNested) {
                  groupSteps.push({ step: next, idx: j });
                  j++;
                } else {
                  break;
                }
              }
              if (groupSteps.length >= 2) {
                items.push({ type: 'tool-group', toolName, steps: groupSteps, nested: isNested });
              } else {
                items.push({ type: 'step', step, idx: i, nested: isNested });
              }
              i = j;
            } else {
              items.push({ type: 'step', step, idx: i, nested: isNested });
              i++;
            }
          }

          // Group consecutive items by nested flag for indentation (delegation items render top-level)
          const itemNested = (item: DisplayItem): boolean =>
            item.type === 'delegation' ? false : item.nested;
          type NestGroup = { nested: boolean; items: DisplayItem[] };
          const nestGroups: NestGroup[] = [];
          for (const item of items) {
            const nested = itemNested(item);
            const last = nestGroups[nestGroups.length - 1];
            if (last && last.nested === nested) {
              last.items.push(item);
            } else {
              nestGroups.push({ nested, items: [item] });
            }
          }

          const renderItem = (item: DisplayItem, key: string) => {
            if (item.type === 'tool-group') {
              return (
                <CollapsibleToolGroup
                  key={key}
                  toolName={item.toolName}
                  steps={item.steps}
                  totalSteps={traceSteps.length}
                />
              );
            }
            if (item.type === 'delegation') {
              const lastTraceIdx = item.children.length > 0 ? item.lastChildIdx : item.idx;
              return (
                <DelegationCard
                  key={item.step.id}
                  step={item.step}
                  childSteps={item.children}
                  isLast={lastTraceIdx === traceSteps.length - 1}
                />
              );
            }
            const { step, idx } = item;
            const statusLabelNode = step.kind === 'status' ? (
              <span className="flex items-center gap-1.5">
                <Archive
                  className="h-3 w-3 shrink-0"
                  style={{ color: 'color-mix(in srgb, var(--foreground-muted) 60%, transparent)' }}
                />
                <span>{step.label}</span>
              </span>
            ) : null;
            return (
              <ChainOfThoughtStep
                key={step.id}
                status={step.status}
                isLast={idx === traceSteps.length - 1}
                label={
                  step.status === 'active' ? (
                    <Shimmer as="span" duration={2} spread={3}>{statusLabelNode || step.label}</Shimmer>
                  ) : (statusLabelNode || step.label)
                }
              >
                {(step.kind === 'reasoning' || step.kind === 'text') && step.content ? (
                  <div
                    className="scrollbar-none max-h-40 overflow-y-auto rounded-lg px-3 py-2 text-[11px] leading-relaxed break-words prose prose-sm max-w-none prose-p:my-1 prose-headings:font-semibold prose-headings:text-[12px] prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-[10px] prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-pre:p-2 prose-pre:rounded-md prose-pre:text-[10px] prose-strong:font-semibold"
                    style={{
                      backgroundColor: 'color-mix(in srgb, var(--sidebar-item-hover) 25%, transparent)',
                      color: 'color-mix(in srgb, var(--foreground) 62%, transparent)',
                    }}
                  >
                    <ReactMarkdown
                      remarkPlugins={[remarkMath, remarkGfm]}
                      rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}
                    >
                      {normalizeMarkdownSpacing(convertLatexDelims(escapeCurrencyDollars(step.content)))}
                    </ReactMarkdown>
                  </div>
                ) : null}
                {step.kind === 'tool' && step.tool ? (
                  <ToolTraceContent tool={step.tool} />
                ) : null}
                {step.kind === 'status' && step.statusMeta ? (
                  <StatusTraceMeta meta={step.statusMeta} />
                ) : null}
              </ChainOfThoughtStep>
            );
          };

          return nestGroups.map((group, gIdx) => {
            const rendered = group.items.map((item, iIdx) =>
              renderItem(item, `${gIdx}-${iIdx}`)
            );

            if (group.nested) {
              return (
                <div
                  key={`nested-${gIdx}`}
                  className="ml-5 border-l-[1.5px] pl-4 py-1"
                  style={{
                    borderColor: 'color-mix(in srgb, var(--foreground-muted) 18%, transparent)',
                  }}
                >
                  {rendered}
                </div>
              );
            }

            return <React.Fragment key={`group-${gIdx}`}>{rendered}</React.Fragment>;
          });
  }, [traceSteps]);

  if (traceSteps.length === 0) return null;

  const headerLabel = isStreaming
    ? 'Thinking...'
    : reasoningDuration
      ? `Thought for ${formatDuration(reasoningDuration)}`
      : 'Thought';

  return (
    <ChainOfThought
      defaultOpen={Boolean(defaultOpen)}
      className="mb-3 mr-auto w-full max-w-[85%] md:max-w-[60%]"
    >
      <ChainOfThoughtHeader>
        <span className="text-[13px] text-theme-muted">{headerLabel}</span>
      </ChainOfThoughtHeader>

      <ChainOfThoughtContent>
        {renderedTraceTree}
      </ChainOfThoughtContent>
    </ChainOfThought>
  );
};

function normalizeMarkdownSpacing(input: string): string {
  const raw = String(input || '').replace(/\r\n/g, '\n');
  const parts = raw.split('```');
  const normalized = parts.map((part, idx) => {
    if (idx % 2 === 1) return part;
    return part
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n');
  });
  return normalized.join('```');
}

// Process text for custom markdown extensions (==highlight==, ++underline++)
function processCustomMarkdown(text: string): string {
  return convertLatexDelims(
    escapeCurrencyDollars(
      normalizeMarkdownSpacing(text)
        .replace(/==([\s\S]*?)==/g, '[$1](#highlight)')
        .replace(/\+\+([\s\S]*?)\+\+/g, '[$1](#underline)')
    )
  );
}

const MessageBubbleInner: React.FC<MessageBubbleProps> = ({ role, text, reasoning, reasoningDuration, toolCalls, streamChunks, isStreaming, contextPaths, attachments, onSubmitToolOutput, onGenUIResponse, compact, messageId, onEditMessage, modifiedFiles, checkpointId, reverted, onRevertFiles, onRedoFiles }) => {
  const [genUIResults, setGenUIResults] = useState<Record<string, any>>({});
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(text);
  const [isReverting, setIsReverting] = useState(false);
  const [isRedoing, setIsRedoing] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<{ type: 'reverted' | 'redone'; count: number } | null>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus textarea when entering edit mode
  useEffect(() => {
    if (isEditing && editTextareaRef.current) {
      editTextareaRef.current.focus();
      editTextareaRef.current.setSelectionRange(editText.length, editText.length);
    }
  }, [isEditing]);

  // Keep draft synced with latest message text when not editing
  useEffect(() => {
    if (!isEditing) {
      setEditText(text);
    }
  }, [text, isEditing]);

  const handleEditSubmit = useCallback(() => {
    if (!messageId || !onEditMessage || !editText.trim()) return;
    onEditMessage(messageId, editText.trim());
    setIsEditing(false);
  }, [messageId, onEditMessage, editText]);

  const handleEditCancel = useCallback(() => {
    setEditText(text);
    setIsEditing(false);
  }, [text]);

  const handleEditKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleEditSubmit();
    } else if (e.key === 'Escape') {
      handleEditCancel();
    }
  }, [handleEditSubmit, handleEditCancel]);

  const handleRevert = useCallback(async () => {
    if (!messageId || !onRevertFiles || isReverting) return;
    setIsReverting(true);
    try {
      const ok = await onRevertFiles(messageId);
      if (ok) {
        setActionFeedback({ type: 'reverted', count: modifiedFiles?.length || 0 });
        setTimeout(() => setActionFeedback(null), 3000);
      }
    } finally {
      setIsReverting(false);
    }
  }, [messageId, onRevertFiles, isReverting, modifiedFiles]);

  const handleRedo = useCallback(async () => {
    if (!messageId || !onRedoFiles || isRedoing) return;
    setIsRedoing(true);
    try {
      const ok = await onRedoFiles(messageId);
      if (ok) {
        setActionFeedback({ type: 'redone', count: modifiedFiles?.length || 0 });
        setTimeout(() => setActionFeedback(null), 3000);
      }
    } finally {
      setIsRedoing(false);
    }
  }, [messageId, onRedoFiles, isRedoing, modifiedFiles]);

  const handleCopy = useCallback(() => {
    try {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  }, [text]);

  const markdownComponents = useMemo(() => ({
    p: ({ children, ...props }: any) => {
      const childArr = Array.isArray(children) ? children : [children];
      const isEmpty = childArr
        .filter((c) => c !== null && c !== undefined)
        .every((c) => typeof c === 'string' && String(c).trim().length === 0);
      if (isEmpty) return null;
      return <p className="mb-4 last:mb-0 leading-[1.7] text-theme-fg/95 [&:where(li_&)]:mb-1" {...props}>{children}</p>;
    },
    // Image rendering - supports local paths and web URLs
    img: ({ node, src, alt, ...props }: any) => {
      // ReactMarkdown may pass the URL via node.url or node.properties.src
      const nodeUrl = (node && (node.url || (node.properties && node.properties.src))) || '';
      const finalSrc = src || nodeUrl || '';
      try {
        console.log('[MessageBubble] img node/url:', { src, nodeUrl, finalSrc });
      } catch { }
      const isAudio = /\.(wav|mp3|ogg|m4a|aac)(\?|$)/i.test(finalSrc) || alt === 'audio';
      const isVideo = /\.(mp4|mov|m4v|webm)(\?|$)/i.test(finalSrc) || alt === 'video';
      if (isAudio) return <AudioPlayer src={toMediaSrc(finalSrc)} />;
      if (isVideo) return <InlineVideo src={finalSrc} />;
      return <InlineImage src={finalSrc} alt={alt} />;
    },
    a: ({ href, children, ...props }: any) => {
      // Handle highlight marker (==text==)
      if (href === '#highlight' || href === '?highlight') {
        return <span className="bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-md font-semibold border border-amber-500/30">{children}</span>;
      }
      // Handle underline marker (++text++)
      if (href === '#underline' || href === '?underline') {
        return <span className="underline decoration-2 decoration-sky-400/70 underline-offset-3 text-sky-300/90 font-medium">{children}</span>;
      }
      // Use white/light text for user bubbles (blue background), blue for assistant
      const linkClass = role === 'user'
        ? "text-white/95 underline underline-offset-3 decoration-white/50 hover:decoration-white/80 hover:text-white cursor-pointer transition-all font-medium"
        : "text-indigo-400 underline underline-offset-3 decoration-indigo-400/40 hover:decoration-indigo-400/70 hover:text-indigo-300 cursor-pointer transition-all font-medium";
      return (
        <a
          className={linkClass}
          href={href}
          onClick={(e) => {
            if (typeof href === 'string' && !/^(javascript|vbscript):/i.test(href)) {
              e.preventDefault();
              e.stopPropagation();
              try { (window as any).desktopAPI.openExternal(href); } catch { }
            }
          }}
          {...props}
        >{children}</a>
      );
    },
    ul: (props: any) => <ul className="list-disc pl-6 mb-4 space-y-1.5 marker:text-theme/60 marker:text-sm" {...props} />,
    ol: (props: any) => <ol className="list-decimal pl-6 mb-4 space-y-1.5 marker:text-theme/60 marker:text-sm marker:font-semibold" {...props} />,
    li: (props: any) => <li className="leading-[1.7] text-theme-fg/95 pl-1" {...props} />,
    blockquote: (props: any) => (
      <blockquote className="border-l-4 border-indigo-500/40 pl-4 my-4 py-2 bg-gradient-to-r from-indigo-500/10 to-transparent rounded-r-lg" {...props}>
        <span className="text-theme-muted/90 italic leading-[1.7]">{props.children}</span>
      </blockquote>
    ),
    h1: (props: any) => <h1 className="text-2xl font-bold mb-4 mt-6 first:mt-0 tracking-tight text-theme-fg border-b border-theme/10 pb-2" {...props} />,
    h2: (props: any) => <h2 className="text-xl font-bold mb-3 mt-5 first:mt-0 tracking-tight text-theme-fg border-b border-theme/10 pb-1" {...props} />,
    h3: (props: any) => <h3 className="text-lg font-bold mb-2.5 mt-4 first:mt-0 text-theme-fg/95" {...props} />,
    h4: (props: any) => <h4 className="text-base font-semibold mb-2 mt-3 first:mt-0 text-theme-fg/90" {...props} />,
    h5: (props: any) => <h5 className="text-sm font-semibold mb-1.5 mt-2.5 first:mt-0 text-theme-fg/85" {...props} />,
    h6: (props: any) => <h6 className="text-xs font-semibold mb-1 mt-2.5 first:mt-0 text-theme-muted/80 uppercase tracking-wide" {...props} />,
    strong: (props: any) => <strong className="font-bold text-theme-fg" {...props} />,
    em: (props: any) => <em className="italic text-theme-fg/95" {...props} />,
    pre: ({ children, ...props }: any) => {
      // Handle block code wrapped in <pre>
      // children is the <code> element
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
        <div className="my-4 rounded-xl overflow-hidden bg-white border border-slate-200 shadow-sm w-full max-w-full group/codeblock flex flex-col">
          <div className="bg-slate-50 px-4 py-2 border-b border-slate-200 flex items-center justify-between select-none">
            <span className="text-xs text-slate-500 font-mono font-bold uppercase tracking-wider">{language}</span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  const code = String(codeContent).replace(/\n$/, '');
                  navigator.clipboard.writeText(code);
                }}
                className="flex items-center gap-1.5 px-2 py-1 hover:bg-slate-200 rounded-md transition-colors text-slate-500 hover:text-slate-700 text-[10px] font-medium uppercase tracking-wider"
                title="Copy code"
              >
                <Copy className="w-3 h-3" />
                Copy
              </button>
            </div>
          </div>
          <div className="relative w-full overflow-hidden">
            <div className="overflow-x-auto overflow-y-auto max-h-[400px] custom-scrollbar p-4 w-full bg-white">
              <code
                className={clsx(className, "font-mono text-[13px] inline-block min-w-full leading-[1.7] text-slate-800 whitespace-pre tab-4")}
                {...childProps}
              >
                {codeContent}
              </code>
            </div>
          </div>
        </div>
      );
    },
    code: ({ className, children, ...props }: any) => {
      // Inline code
      return <code className="bg-slate-100 border border-slate-200 text-slate-800 rounded-md px-[6px] py-[2px] font-mono text-[0.85em] font-medium align-middle" {...props}>{children}</code>;
    },
    table: (props: any) => (
      <div className="overflow-x-auto scrollbar-none my-3 rounded-xl border border-theme/20 shadow-sm">
        <table className="min-w-full divide-y divide-theme/15 text-sm" {...props} />
      </div>
    ),
    thead: (props: any) => <thead className="bg-gradient-to-b from-theme-hover/60 to-theme-hover/40" {...props} />,
    tbody: (props: any) => <tbody className="divide-y divide-theme/10 bg-theme-bg/30" {...props} />,
    tr: (props: any) => <tr className="hover:bg-theme-hover/40 transition-colors" {...props} />,
    th: (props: any) => <th className="px-4 py-2.5 text-left font-bold text-theme-fg uppercase tracking-wider text-[11px]" {...props} />,
    td: (props: any) => <td className="px-4 py-2.5 text-theme-fg/90 whitespace-pre-wrap" {...props} />,
    hr: (props: any) => <hr className="my-4 border-theme/15" {...props} />,
    del: (props: any) => <del className="line-through text-theme-muted/60 decoration-2" {...props} />,
    sup: (props: any) => <sup className="text-[75%] align-super text-theme-muted/80" {...props} />,
    sub: (props: any) => <sub className="text-[75%] align-sub text-theme-muted/80" {...props} />,
  }), [role]);

  const segments = useMemo<ContentSegment[]>(() => {
    if (!text) return [];
    const result: ContentSegment[] = [];

    // Regex for genui code blocks, media, YouTube, and raw audio paths
    const genuiRegex = /```genui:(\w+)\s*\n([\s\S]*?)```/g;
    const genuiIncompleteRegex = /```genui:(\w+)\s*\n([\s\S]*)$/; // Matches incomplete block at end
    const mediaRegex = /<<([^<>]+)>>/g;

    const youtubeRegex = /https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?[^\s]*v=|shorts\/|live\/|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})[^\s]*/gi;
    const linkPreviewRegex = /(?:^|\s)(https?:\/\/[^\s]+)(?:$|\s)/g;
    const rawAudioRegex = /(?:[a-zA-Z]:\\[^<>:"|?*\n\r]+\.(?:wav|mp3|ogg|m4a|aac|webm)|(?:\/[^<>:"|?*\n\r]+\.(?:wav|mp3|ogg|m4a|aac|webm)))(?=\s|$)/gi;

    // First pass: extract complete GenUI blocks
    const genuiMatches: { start: number; end: number; component: string; args: any; id: string; loading?: boolean; title?: string }[] = [];
    let genuiMatch;
    let genuiCounter = 0;
    while ((genuiMatch = genuiRegex.exec(text)) !== null) {
      const componentName = genuiMatch[1].toLowerCase();
      const jsonContent = genuiMatch[2].trim();
      let args = {};
      try {
        args = JSON.parse(jsonContent);
      } catch (e) {
        console.warn('[GenUI] Failed to parse JSON for', componentName, ':', e);
        continue;
      }
      const toolName = GENUI_COMPONENT_MAP[componentName] || componentName;
      genuiMatches.push({
        start: genuiMatch.index,
        end: genuiMatch.index + genuiMatch[0].length,
        component: toolName,
        args,
        id: `genui-seg-${genuiMatch.index}-${genuiCounter++}`,
      });
    }

    // Check for incomplete GenUI block at the end (streaming)
    const incompleteMatch = text.match(genuiIncompleteRegex);
    if (incompleteMatch) {
      const incompleteStart = text.lastIndexOf('```genui:');
      // Make sure this isn't already matched as a complete block
      const alreadyMatched = genuiMatches.some(m => m.start === incompleteStart);
      if (!alreadyMatched && incompleteStart >= 0) {
        const componentName = incompleteMatch[1].toLowerCase();
        const toolName = GENUI_COMPONENT_MAP[componentName] || componentName;
        // Try to extract title from partial JSON if possible
        let title: string | undefined;
        try {
          const partialJson = incompleteMatch[2];
          const titleMatch = partialJson.match(/"title"\s*:\s*"([^"]+)"/);
          if (titleMatch) title = titleMatch[1];
        } catch { }
        genuiMatches.push({
          start: incompleteStart,
          end: text.length,
          component: toolName,
          args: {},
          id: `genui-loading-${incompleteStart}`,
          loading: true,
          title,
        });
      }
    }

    // Extract YouTube URLs
    const youtubeMatches: { start: number; end: number; videoId: string; url: string }[] = [];
    let ytMatch;
    while ((ytMatch = youtubeRegex.exec(text)) !== null) {
      const videoId = extractYouTubeVideoId(ytMatch[0]);
      if (videoId) {
        youtubeMatches.push({
          start: ytMatch.index,
          end: ytMatch.index + ytMatch[0].length,
          videoId,
          url: ytMatch[0],
        });
      }
    }

    // Second pass: process text with media and YouTube
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    const processTextChunk = (chunk: string) => {
      if (!chunk) return;
      let t = chunk
        .replace(/==([\s\S]*?)==/g, '[$1](#highlight)')
        .replace(/\+\+([\s\S]*?)\+\+/g, '[$1](#underline)');
      t = normalizeMarkdownSpacing(convertLatexDelims(escapeCurrencyDollars(t)));
      result.push({ kind: 'text', value: t });
    };

    // Sort all matches by position
    const allMatches: Array<{ type: 'image' | 'video' | 'audio' | 'youtube' | 'link_preview' | 'genui' | 'genui_loading'; start: number; end: number; data: any }> = [];

    // Add GenUI matches first (highest priority)
    for (const g of genuiMatches) {
      if (g.loading) {
        allMatches.push({
          type: 'genui_loading',
          start: g.start,
          end: g.end,
          data: { component: g.component, title: g.title },
        });
      } else {
        allMatches.push({
          type: 'genui',
          start: g.start,
          end: g.end,
          data: { component: g.component, args: g.args, id: g.id },
        });
      }
    }

    // Add media matches (<<...>>)
    while ((match = mediaRegex.exec(text)) !== null) {
      const src = String(match[1] || '').trim();
      const isAudio = /\.(wav|mp3|ogg|m4a|aac)$/i.test(src);
      const isVideo = /\.(mp4|mov|m4v|webm)$/i.test(src);
      allMatches.push({
        type: isAudio ? 'audio' : isVideo ? 'video' : 'image',
        start: match.index,
        end: match.index + match[0].length,
        data: { src },
      });
    }

    // Add raw audio path matches (avoid duplicates if they were inside << >>)
    while ((match = rawAudioRegex.exec(text)) !== null) {
      const src = match[0].trim();
      // Check if this match overlaps with existing matches
      const overlap = allMatches.some(m =>
        (match!.index >= m.start && match!.index < m.end) ||
        (match!.index + src.length > m.start && match!.index + src.length <= m.end)
      );

      if (!overlap) {
        allMatches.push({
          type: 'audio',
          start: match.index,
          end: match.index + src.length,
          data: { src }
        });
      }
    }

    // Add YouTube matches (skip if inside << >>)
    for (const yt of youtubeMatches) {
      const insideMedia = allMatches.some(m => yt.start >= m.start && yt.end <= m.end);
      if (!insideMedia) {
        allMatches.push({
          type: 'youtube',
          start: yt.start,
          end: yt.end,
          data: { videoId: yt.videoId, url: yt.url },
        });
      }
    }

    // Add link preview matches (skip if overlapping with other matches like YouTube)
    while ((match = linkPreviewRegex.exec(text)) !== null) {
      const raw = String(match[1] || '').trim();
      if (!raw) continue;
      // Calculate actual URL position (match[1] is the captured group)
      const urlStart = match.index + match[0].indexOf(raw);
      const urlEnd = urlStart + raw.length;
      // Skip if overlapping with existing matches
      const overlap = allMatches.some(
        (m) =>
          (urlStart >= m.start && urlStart < m.end) ||
          (urlEnd > m.start && urlEnd <= m.end) ||
          (urlStart <= m.start && urlEnd >= m.end)
      );
      if (!overlap) {
        allMatches.push({
          type: 'link_preview',
          start: urlStart,
          end: urlEnd,
          data: { url: raw },
        });
      }
    }

    // Sort by start position
    allMatches.sort((a, b) => a.start - b.start);

    // Process in order
    for (const m of allMatches) {
      if (m.start > lastIndex) {
        processTextChunk(text.slice(lastIndex, m.start));
      }
      if (m.type === 'genui') {
        result.push({ kind: 'genui', component: m.data.component, args: m.data.args, id: m.data.id });
      } else if (m.type === 'genui_loading') {
        result.push({ kind: 'genui_loading', component: m.data.component, title: m.data.title });
      } else if (m.type === 'image' && m.data.src) {
        result.push({ kind: 'image', src: m.data.src });
      } else if (m.type === 'video' && m.data.src) {
        result.push({ kind: 'video', src: m.data.src });
      } else if (m.type === 'audio' && m.data.src) {
        result.push({ kind: 'audio', src: m.data.src });
      } else if (m.type === 'youtube') {
        result.push({ kind: 'youtube', videoId: m.data.videoId, url: m.data.url });
      } else if (m.type === 'link_preview') {
        result.push({ kind: 'link_preview', url: m.data.url });
      }
      lastIndex = m.end;
    }

    // Remaining text
    if (lastIndex < text.length) {
      processTextChunk(text.slice(lastIndex));
    }

    return result;
  }, [text]);

  const hasReasoning = reasoning && reasoning.trim().length > 0;
  const hasToolCalls = toolCalls && toolCalls.length > 0;
  const hasStreamChunks = streamChunks && streamChunks.length > 0;
  const hasTraceSteps = role === 'assistant' && (
    hasReasoning ||
    hasToolCalls ||
    Boolean(streamChunks?.some((chunk) => (
      chunk.type === 'reasoning' ||
      chunk.type === 'tool' ||
      chunk.type === 'status' ||
      (chunk.type === 'text' && chunk.nested)
    )))
  );
  const shouldRenderTextBubble = compact || role !== 'user' || isEditing || Boolean(text.trim()) || segments.length > 0;
  const inlineChatUiBubbleClass = "w-full max-w-[85%] mr-auto";

  return (
    <div className={clsx(
      "flex flex-col w-full mb-5 group/msg"
    )}>
      {role === 'assistant' && hasTraceSteps && (
        <AssistantTracePanel
          reasoning={reasoning}
          reasoningDuration={reasoningDuration}
          toolCalls={toolCalls}
          streamChunks={streamChunks}
          isStreaming={isStreaming}
          defaultOpen={Boolean(isStreaming || !text.trim())}
        />
      )}


      {attachments && attachments.length > 0 && (
        <div className={clsx("mb-2 flex", role === 'user' ? 'justify-end' : 'justify-start')}>
          <AttachmentPreviewStrip
            attachments={attachments}
            layout="wrap"
            align={role === 'user' ? 'right' : 'left'}
          />
        </div>
      )}

      {/* Main message content - renders streamChunks inline if available */}
      <div className="w-full flex flex-col space-y-2">
        {role === 'assistant' && streamChunks && streamChunks.length > 0 ? (
          <>
            {/* Render interleaved stream chunks */}
            {streamChunks.map((chunk, idx) => {
              if (chunk.type === 'reasoning') return null;
              // Subagent narration belongs in the chain-of-thought, not the
              // user-facing bubble — those are rendered as 'text' steps inside
              // AssistantTracePanel / DelegationCard with markdown.
              if (chunk.type === 'text' && chunk.nested) return null;
              if (chunk.type === 'tool') {
                const tc = chunk.tool;
                const isGenUI = GENUI_TOOL_NAMES.has(tc.tool);
                const isHidden = HIDDEN_TOOL_NAMES.has(tc.tool);

                // Skip hidden tools (don't render anything)
                if (isHidden && !isGenUI) return null;

                // Render GenUI components inline
                if (isGenUI) {
                  const isCompleted = tc.status === 'completed' || tc.status === 'error';
                  const resultForTool = genUIResults[tc.id] || tc.result;
                  const wrapperClassName = tc.tool === 'chat_ui' ? inlineChatUiBubbleClass : 'max-w-full';

                  return (
                    <div key={`genui-${idx}`} className={wrapperClassName}>
                      <GenUIContainer
                        toolName={tc.tool}
                        args={tc.args || {}}
                        isCompleted={isCompleted}
                        result={resultForTool}
                        onResult={(result) => {
                          setGenUIResults(prev => ({ ...prev, [tc.id]: result }));
                          if (onSubmitToolOutput) {
                            onSubmitToolOutput(tc.id, result);
                          }
                        }}
                      />
                    </div>
                  );
                }

                return null;
              }
              // Text chunk
              if (chunk.type === 'text') {
                if (isTopLevelDuplicateOfNestedText(chunk, streamChunks)) return null;
                const chunkSegments = extractContentSegments(chunk.content);
                return (
                  <div
                    key={`txt-${idx}`}
                    className={clsx(
                      "w-fit",
                      "rounded-[22px] px-5 py-3.5 backdrop-blur-md text-[16px] leading-relaxed transition-all",
                      "bg-gray-100 text-gray-900 rounded-tl-sm",
                      "max-w-[85%]"
                    )}
                  >
                    <div className="select-text whitespace-pre-wrap font-medium break-words">
                      {chunkSegments.map((seg, segIdx) => {
                        if (seg.kind === 'genui') {
                          // Route agent_todo to sidebar instead of rendering inline
                          if (seg.component === 'agent_todo' && seg.args?.items) {
                            window.dispatchEvent(new CustomEvent('agent-todo-update', { detail: seg.args }));
                            return null;
                          }
                          const isCompleted = genUIResults[seg.id] !== undefined;
                          return (
                            <div key={`genui-${idx}-${segIdx}`} className="my-3">
                              <GenUIErrorBoundary componentName={seg.component}>
                                <GenUIContainer
                                  toolName={seg.component}
                                  args={stripMarkdownFromArgs(seg.args)}
                                  isCompleted={isCompleted}
                                  result={genUIResults[seg.id]}
                                  onResult={(result) => {
                                    // Update local state
                                    setGenUIResults(prev => ({ ...prev, [seg.id]: result }));
                                    // For syntax-based GenUI, trigger a follow-up message to the AI
                                    if (onGenUIResponse) {
                                      onGenUIResponse(seg.component, result);
                                    }
                                  }}
                                />
                              </GenUIErrorBoundary>
                            </div>
                          );
                        }
                        if (seg.kind === 'genui_loading') {
                          // Hide agent_todo loading skeleton from chat (shows in sidebar)
                          if (seg.component === 'agent_todo') return null;
                          return (
                            <div key={`genui-loading-${idx}-${segIdx}`} className="my-3 p-5 border border-theme/20 rounded-xl bg-theme-hover/30 animate-pulse shadow-inner">
                              <div className="flex items-center gap-3">
                                <Loader2 className="w-4 h-4 text-primary animate-spin" />
                                <span className="text-[11px] font-black uppercase tracking-widest text-theme-muted">
                                  {seg.title || humanizeToolName(seg.component) || 'Loading component...'}
                                </span>
                              </div>
                              <div className="mt-4 space-y-2">
                                <div className="h-3 bg-theme-muted/20 rounded-full w-3/4" />
                                <div className="h-3 bg-theme-muted/10 rounded-full w-1/2" />
                              </div>
                            </div>
                          );
                        }
                        if (seg.kind === 'image') {
                          return <InlineImage key={`img-${idx}-${segIdx}`} src={seg.src} />;
                        }
                        if (seg.kind === 'video') {
                          return <InlineVideo key={`vid-${idx}-${segIdx}`} src={seg.src} />;
                        }
                        if (seg.kind === 'audio') {
                          return <AudioPlayer key={`aud-${idx}-${segIdx}`} src={toMediaSrc(seg.src)} />;
                        }
                        if (seg.kind === 'youtube') {
                          return <YouTubeEmbed key={`yt-${idx}-${segIdx}`} videoId={seg.videoId} url={seg.url} />;
                        }
                        if (seg.kind === 'link_preview') {
                          return <LinkPreview key={`lp-${idx}-${segIdx}`} url={seg.url} />;
                        }
                        if (seg.kind === 'text') {
                          return (
                            <ReactMarkdown
                              key={`md-${idx}-${segIdx}`}
                              remarkPlugins={[remarkMath, remarkGfm]}
                              rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}
                              urlTransform={(url) => url}
                              components={markdownComponents}
                            >
                              {seg.value}
                            </ReactMarkdown>
                          );
                        }

                        return null;
                      })}
                    </div>
                  </div>
                );
              }
              return null;
            })}
            {role === 'assistant' && !isStreaming && streamChunks && streamChunks.length > 0 && (
              <div className="flex items-center gap-2 mt-1 opacity-0 group-hover/bubble:opacity-100 transition-opacity ml-1">
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-theme-hover/50 hover:bg-theme-hover text-[10px] text-theme-muted hover:text-theme-fg transition-all font-bold uppercase tracking-widest border border-theme/10"
                  title="Copy response"
                >
                  {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            )}
          </>
        ) : (
          // Fallback to single bubble for user messages or when no streamChunks
          shouldRenderTextBubble ? (
            <div className={clsx(
              "text-[15px] relative group/bubble leading-relaxed transition-colors",
              compact
                ? "w-full max-w-full bg-transparent px-4 py-3 text-theme-fg"
                : clsx(
                  "rounded-2xl px-5 py-3.5",
                  role === 'user'
                    ? (isEditing
                      ? "bg-primary text-primary-fg border-primary shadow-primary/5 ml-auto w-full max-w-[85%] font-semibold"
                      : "bg-primary text-primary-fg border-primary shadow-primary/5 ml-auto w-fit max-w-[85%] min-w-[56px] font-semibold")
                    : "bg-gray-100 text-gray-900 mr-auto w-fit max-w-[85%] font-medium"
                )
            )}>
            {/* Edit mode for user messages */}
            {role === 'user' && isEditing ? (
              <div className="flex flex-col gap-2 w-full min-w-0">
                <textarea
                  ref={editTextareaRef}
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={handleEditKeyDown}
                  className="w-full bg-white/20 text-primary-fg rounded-xl px-3 py-2.5 text-[14px] font-medium leading-relaxed outline-none border border-white/30 focus:border-white/50 focus:ring-2 focus:ring-white/20 placeholder:text-primary-fg/50 resize-none min-h-[112px] max-h-[260px] overflow-y-auto scrollbar-minimal"
                  rows={4}
                  placeholder="Edit your message..."
                />
                <div className="flex items-center gap-2 justify-end">
                  <button
                    onClick={handleEditCancel}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold text-primary-fg/70 hover:text-primary-fg hover:bg-white/10 transition-colors"
                  >
                    <X className="w-3 h-3" />
                    Cancel
                  </button>
                  <button
                    onClick={handleEditSubmit}
                    disabled={!editText.trim() || editText.trim() === text.trim()}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-white/20 hover:bg-white/30 text-primary-fg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Send className="w-3 h-3" />
                    Send
                  </button>
                </div>
              </div>
            ) : (
              <div
                className="select-text whitespace-pre-wrap break-words"
                aria-live={role === 'assistant' && isStreaming ? "polite" : "off"}
              >
                {segments.length === 0 ? (
                  <ReactMarkdown
                    remarkPlugins={[remarkMath, remarkGfm]}
                    rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}
                    urlTransform={(url) => url}
                    components={markdownComponents}
                  >
                    {normalizeMarkdownSpacing(convertLatexDelims(escapeCurrencyDollars(text)))}
                  </ReactMarkdown>
                ) : (
                  segments.map((seg, idx) => {
                    if (seg.kind === 'genui') {
                      // Route agent_todo to sidebar instead of rendering inline
                      if (seg.component === 'agent_todo' && seg.args?.items) {
                        window.dispatchEvent(new CustomEvent('agent-todo-update', { detail: seg.args }));
                        return null;
                      }
                      const isCompleted = genUIResults[seg.id] !== undefined;
                      return (
                        <div key={`genui-${idx}`} className="my-3">
                          <GenUIErrorBoundary componentName={seg.component}>
                            <GenUIContainer
                              toolName={seg.component}
                              args={stripMarkdownFromArgs(seg.args)}
                              isCompleted={isCompleted}
                              result={genUIResults[seg.id]}
                              onResult={(result) => {
                                // Update local state
                                setGenUIResults(prev => ({ ...prev, [seg.id]: result }));
                                // For syntax-based GenUI, trigger a follow-up message to the AI
                                if (onGenUIResponse) {
                                  onGenUIResponse(seg.component, result);
                                }
                              }}
                            />
                          </GenUIErrorBoundary>
                        </div>
                      );
                    }
                    if (seg.kind === 'genui_loading') {
                      // Hide agent_todo loading skeleton from chat (shows in sidebar)
                      if (seg.component === 'agent_todo') return null;
                      return (
                        <div key={`genui-loading-${idx}`} className="my-3 p-5 border border-theme/20 rounded-xl bg-theme-hover/30 animate-pulse shadow-inner">
                          <div className="flex items-center gap-3">
                            <Loader2 className="w-4 h-4 text-primary animate-spin" />
                            <span className="text-[11px] font-black uppercase tracking-widest text-theme-muted">
                              {seg.title || humanizeToolName(seg.component) || 'Loading component...'}
                            </span>
                          </div>
                          <div className="mt-4 space-y-2">
                            <div className="h-3 bg-theme-muted/20 rounded-full w-3/4" />
                            <div className="h-3 bg-theme-muted/10 rounded-full w-1/2" />
                          </div>
                        </div>
                      );
                    }
                    if (seg.kind === 'image') {
                      return <InlineImage key={`img-${idx}`} src={seg.src} />;
                    }
                    if (seg.kind === 'video') {
                      return <InlineVideo key={`vid-${idx}`} src={seg.src} />;
                    }
                    if (seg.kind === 'audio') {
                      return <AudioPlayer key={`aud-${idx}`} src={toMediaSrc(seg.src)} />;
                    }
                    if (seg.kind === 'youtube') {
                      return <YouTubeEmbed key={`yt-${idx}`} videoId={seg.videoId} url={seg.url} />;
                    }
                    if (seg.kind === 'link_preview') {
                      return <LinkPreview key={`lp-${idx}`} url={seg.url} />;
                    }
                    if (seg.kind === 'text') {
                      return (
                        <ReactMarkdown
                          key={`md-${idx}`}
                          remarkPlugins={[remarkMath, remarkGfm]}
                          rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}
                          urlTransform={(url) => url}
                          components={markdownComponents}
                        >
                          {seg.value}
                        </ReactMarkdown>
                      );
                    }

                    return null;
                  })
                )}
              </div>
            )}
            {/* Copy + Revert/Redo buttons for assistant messages */}
            {role === 'assistant' && !isStreaming && (
              <div className="flex items-center gap-2 mt-2 opacity-0 group-hover/bubble:opacity-100 transition-opacity">
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-theme-hover/50 hover:bg-theme-hover text-[10px] text-theme-muted hover:text-theme-fg transition-all font-bold uppercase tracking-widest border border-theme/10"
                  title="Copy response"
                >
                  {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
                {modifiedFiles && modifiedFiles.length > 0 && checkpointId && onRevertFiles && messageId && !reverted && (
                  <button
                    onClick={handleRevert}
                    disabled={isReverting}
                    className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-50 hover:bg-amber-100 text-[10px] text-amber-700 hover:text-amber-800 transition-all font-bold uppercase tracking-widest border border-amber-200 disabled:opacity-50"
                    title={`Revert ${modifiedFiles.length} file change(s)`}
                  >
                    {isReverting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Undo2 className="w-3 h-3" />}
                    <span>{isReverting ? 'Reverting...' : `Revert ${modifiedFiles.length} file(s)`}</span>
                  </button>
                )}
                {reverted && modifiedFiles && modifiedFiles.length > 0 && checkpointId && (
                  <div className="flex items-center gap-1.5">
                    <span className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-50 text-[10px] text-emerald-700 font-bold uppercase tracking-widest border border-emerald-200">
                      <CheckCircle className="w-3 h-3" />
                      <span>Reverted</span>
                    </span>
                    {onRedoFiles && messageId && (
                      <button
                        onClick={handleRedo}
                        disabled={isRedoing}
                        className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-blue-50 hover:bg-blue-100 text-[10px] text-blue-700 hover:text-blue-800 transition-all font-bold uppercase tracking-widest border border-blue-200 disabled:opacity-50"
                        title={`Re-apply ${modifiedFiles.length} file change(s)`}
                      >
                        {isRedoing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Redo2 className="w-3 h-3" />}
                        <span>{isRedoing ? 'Re-applying...' : 'Redo'}</span>
                      </button>
                    )}
                  </div>
                )}
                {actionFeedback && (
                  <motion.span
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    className={clsx(
                      "flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold",
                      actionFeedback.type === 'reverted'
                        ? "bg-emerald-50 text-emerald-600 border border-emerald-200"
                        : "bg-blue-50 text-blue-600 border border-blue-200"
                    )}
                  >
                    {actionFeedback.type === 'reverted' ? <Undo2 className="w-3 h-3" /> : <Redo2 className="w-3 h-3" />}
                    {actionFeedback.count} file(s) {actionFeedback.type}
                  </motion.span>
                )}
              </div>
            )}
            </div>
          ) : null
        )}
        {/* Edit icon for user messages — outside bubble, in the gap */}
        {role === 'user' && !isEditing && !isStreaming && messageId && onEditMessage && (
          <div className="flex justify-end mt-1 opacity-0 group-hover/msg:opacity-100 transition-opacity duration-150">
            <button
              onClick={() => { setEditText(text); setIsEditing(true); }}
              className="relative group/edit p-1 rounded-md text-theme-muted/50 hover:text-theme-fg hover:bg-theme-hover/50 transition-all active:scale-90"
              aria-label="Edit message"
            >
              <Pencil className="w-3 h-3" />
              {/* Tooltip */}
              <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-0.5 rounded-md bg-gray-900 text-white text-[10px] font-bold whitespace-nowrap opacity-0 group-hover/edit:opacity-100 transition-opacity pointer-events-none shadow-lg">
                Edit
              </span>
            </button>
          </div>
        )}
        {/* Context indicator for user messages — subtle, right-aligned */}
        {role === 'user' && contextPaths && contextPaths.length > 0 && (
          <div className="flex flex-wrap gap-1 justify-end mt-1.5 max-w-[85%] ml-auto">
            {contextPaths.map((ctx, i) => {
              const Icon = ctx.isDirectory ? Folder : FileText;
              return (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-theme-hover/60 text-theme-muted text-[10px] font-semibold border border-theme/10 max-w-[160px]"
                  title={ctx.path}
                >
                  <Icon className="w-3 h-3 shrink-0" strokeWidth={2} />
                  <span className="truncate">{ctx.name}</span>
                </span>
              );
            })}
          </div>
        )}
        {/* Modified files indicator */}
        {role === 'assistant' && modifiedFiles && modifiedFiles.length > 0 && !hasStreamChunks && (
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {modifiedFiles.map((f, i) => {
              const fileName = f.split(/[/\\]/).pop() || f;
              return (
                <span
                  key={i}
                  className={clsx(
                    "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border transition-colors",
                    reverted
                      ? "bg-emerald-50 border-emerald-200 text-emerald-600 line-through decoration-emerald-400/50"
                      : "bg-amber-50 border-amber-200 text-amber-700"
                  )}
                  title={reverted ? `${f} (reverted)` : f}
                >
                  <FileText className="w-3 h-3" />
                  <span className="truncate max-w-[120px]">{fileName}</span>
                  {reverted && <Undo2 className="w-2.5 h-2.5 ml-0.5" />}
                </span>
              );
            })}
          </div>
        )}
        {role === 'assistant' && !hasStreamChunks && hasToolCalls && !hasTraceSteps && (
          <div className="flex flex-wrap gap-2 mt-1">
            {toolCalls
              .filter(tc => !HIDDEN_TOOL_NAMES.has(tc.tool))
              .map((tc, idx) => (
                <ToolCallPill key={tc.id || idx} tool={tc} />
              ))}
          </div>
        )}
        {role === 'assistant' && isStreaming && (
          <span className="inline-block w-[3px] h-4 bg-primary ml-1 animate-[blink_1s_step-end_infinite] align-middle rounded-full shadow-sm shadow-primary/20" />
        )}
      </div>
    </div >
  );
};

// Memoized export for performance - only re-renders when props actually change
const MessageBubble = memo(MessageBubbleInner, (prevProps, nextProps) => {
  if (prevProps.isStreaming || nextProps.isStreaming) {
    return false;
  }
  return (
    prevProps.text === nextProps.text &&
    prevProps.role === nextProps.role &&
    prevProps.reasoning === nextProps.reasoning &&
    prevProps.reasoningDuration === nextProps.reasoningDuration &&
    prevProps.toolCalls === nextProps.toolCalls &&
    prevProps.streamChunks === nextProps.streamChunks &&
    prevProps.reverted === nextProps.reverted &&
    prevProps.messageId === nextProps.messageId &&
    prevProps.onRedoFiles === nextProps.onRedoFiles
  );
});

export default MessageBubble;
