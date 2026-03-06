
import React, { useMemo, useState, useRef, useEffect, useCallback, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import clsx from 'clsx';
import { convertLatexDelims, escapeCurrencyDollars } from '../utils/text';
import 'katex/dist/katex.min.css';
import { ChevronRight, Folder, FileText, Play, ExternalLink, CheckCircle, XCircle, Loader2, Copy, Check, Terminal, Pencil, Undo2, X, Send } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ToolCall, StreamChunk } from '../hooks/useAgent';

import { AudioPlayer } from './AudioPlayer';
import { LinkPreview } from './LinkPreview';
import { GenUIContainer, GenUIErrorBoundary } from './genui';

// GenUI tools that render interactive UI components
const GENUI_TOOL_NAMES = new Set([
  // Decision & Input (blocking - wait for user response)
  'ask_confirmation',
  'show_choices',
  'pick_date',
  'request_files',
  'show_command',
  // Display only (non-blocking)
  'show_table',
  'show_info',
  'show_details',
  'show_files',
  'show_json',
  'show_link',
  'show_colors',
  'show_progress',
  // Applications
  'show_email',
  'draft_email',
  // Integrations
  'connect_integration',
]);

// Tools that should be hidden from the chat UI (internal/silent tools)
const HIDDEN_TOOL_NAMES = new Set([
  // Segment tools (internal for conversation management)
  'segment_create',
  'segment_update',
  'segment_end',
  'segment_list',
  'segment_search',
  'segment_get',
  // Memory tools (internal)
  'memory_store',
  'memory_recall',
  'memory_update',
  'memory_search',
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
  // Internal meta-tools (invisible to user)
  'get_tool_schema',
  'search_tools',
  // ask_user renders inline prompt, not a tool pill
  'ask_user',
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
  // Use description from tool if available, otherwise humanize tool name
  const displayText = tool.description || humanizeToolName(resolvedToolName);

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
        className="flex items-center gap-2.5 text-[12px] font-semibold tracking-tight w-fit"
      >
        <div className="flex items-center justify-center w-5.5 h-5.5">
          {isCompleted ? (
            <CheckCircle className="w-3.5 h-3.5 text-green-600" />
          ) : isError ? (
            <XCircle className="w-3.5 h-3.5 text-red-500" />
          ) : (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-black">{displayText}</span>
        </div>

        <button
          onClick={() => setShowDetails(!showDetails)}
          className="flex items-center justify-center p-1 hover:bg-gray-100 rounded transition-colors"
        >
          <ChevronRight
            className={`w-3.5 h-3.5 text-black transition-transform duration-200 ${showDetails ? 'rotate-90' : ''
              }`}
          />
        </button>

        {status === 'running' && (
          <span className="flex items-center gap-0.5 text-black text-[10px] font-medium uppercase tracking-wider">
            <span className="w-1 h-1 rounded-full bg-current animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-1 h-1 rounded-full bg-current animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-1 h-1 rounded-full bg-current animate-bounce" style={{ animationDelay: '300ms' }} />
          </span>
        )}
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
  const [elapsed, setElapsed] = useState(finalDuration || 0);

  // Live timer while streaming
  useEffect(() => {
    if (!isStreaming || !isLastReasoning || finalDuration) return;
    const interval = setInterval(() => {
      setElapsed((Date.now() - mountTimeRef.current) / 1000);
    }, 100);
    return () => clearInterval(interval);
  }, [isStreaming, isLastReasoning, finalDuration]);

  // Final elapsed on complete (only if no finalDuration provided)
  useEffect(() => {
    if (!isStreaming && isLastReasoning && !finalDuration) {
      setElapsed((Date.now() - mountTimeRef.current) / 1000);
    }
  }, [isStreaming, isLastReasoning, finalDuration]);

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
  // Edit & Revert
  messageId?: string;
  onEditMessage?: (messageId: string, newText: string) => void;
  modifiedFiles?: string[];
  checkpointId?: string;
  reverted?: boolean;
  onRevertFiles?: (messageId: string) => void;
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

  // Log for debugging
  useEffect(() => {
    console.log(`[InlineImage] Loading: "${src}" → "${imageSrc}"`);
    // Warn about Unix paths on Windows
    if (src && src.startsWith('/') && !src.startsWith('//')) {
      console.warn('[InlineImage] WARNING: Unix-style path detected. This may not work on Windows:', src);
    }
  }, [src, imageSrc]);

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
        onLoad={() => {
          console.log(`[InlineImage] Loaded: "${imageSrc}"`);
          setLoaded(true);
        }}
        onError={() => {
          console.error(`[InlineImage] Failed: "${src}" → "${imageSrc}"`);
          setError(`${src}`);
        }}
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

  useEffect(() => {
    console.log(`[InlineVideo] Loading: "${src}" → "${videoSrc}"`);
  }, [src, videoSrc]);

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
  'date': 'pick_date',
  'datepicker': 'pick_date',
  'files': 'request_files',
  'dropzone': 'request_files',
  'table': 'show_table',
  'info': 'show_info',
  'details': 'show_details',
  'accordion': 'show_details',
  'tree': 'show_files',
  'filetree': 'show_files',
  'command': 'show_command',
  'terminal': 'show_command',
  'json': 'show_json',
  'link': 'show_link',
  'colors': 'show_colors',
  'palette': 'show_colors',
  'progress': 'show_progress',
  'slider': 'show_slider',
  'range': 'show_slider',
  'chart': 'show_chart',
  'graph': 'show_chart',
  'plot': 'show_chart',
  'email': 'show_email',
  'mail': 'show_email',
  // Agent tools
  'todo': 'agent_todo',
  'todolist': 'agent_todo',
  'todo_list': 'agent_todo',
  'tasks': 'agent_todo',
  // Integrations
  'integration': 'connect_integration',
  'integrations': 'connect_integration',
  'connect': 'connect_integration',
  'integration_connect': 'connect_integration',
  // Forms / Wizards
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
    const overlap = allMatches.some(
      (m) =>
        (match!.index >= m.start && match!.index < m.end) ||
        (match!.index + raw.length > m.start && match!.index + raw.length <= m.end)
    );
    if (!overlap) {
      allMatches.push({
        type: 'link_preview',
        start: match.index,
        end: match.index + raw.length,
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
    <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-md px-2 py-1.5 my-0.5 group/fp">
      <span className="text-[10px] text-gray-500 shrink-0">
        {isImage ? '🖼' : isAudio ? '🔊' : '📄'}
      </span>
      <span className="text-[10px] font-medium text-gray-700 truncate max-w-[200px]" title={filePath}>
        {fileName}
      </span>
      <div className="flex items-center gap-0.5 ml-auto shrink-0">
        <button
          onClick={openFile}
          className="p-0.5 rounded hover:bg-gray-200 transition-colors"
          title="Open file"
        >
          <ExternalLink className="w-3 h-3 text-gray-500 hover:text-gray-700" />
        </button>
        <button
          onClick={revealInFolder}
          className="p-0.5 rounded hover:bg-gray-200 transition-colors"
          title="Show in folder"
        >
          <Folder className="w-3 h-3 text-gray-500 hover:text-gray-700" />
        </button>
        <button
          onClick={copyPath}
          className="p-0.5 rounded hover:bg-gray-200 transition-colors"
          title="Copy path"
        >
          {copied
            ? <Check className="w-3 h-3 text-green-600" />
            : <Copy className="w-3 h-3 text-gray-500 hover:text-gray-700" />
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

const MessageBubbleInner: React.FC<MessageBubbleProps> = ({ role, text, reasoning, reasoningDuration, toolCalls, streamChunks, isStreaming, contextPaths, onSubmitToolOutput, onGenUIResponse, compact, messageId, onEditMessage, modifiedFiles, checkpointId, reverted, onRevertFiles }) => {
  const [reasoningExpanded, setReasoningExpanded] = useState(false);
  const reasoningRef = useRef<HTMLDivElement>(null);
  const [genUIResults, setGenUIResults] = useState<Record<string, any>>({});
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(text);
  const [isReverting, setIsReverting] = useState(false);
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
      await onRevertFiles(messageId);
    } finally {
      setIsReverting(false);
    }
  }, [messageId, onRevertFiles, isReverting]);

  const handleCopy = useCallback(() => {
    try {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  }, [text]);

  // Auto-scroll reasoning when expanded and streaming
  useEffect(() => {
    if (reasoningExpanded && reasoningRef.current && isStreaming) {
      reasoningRef.current.scrollTop = reasoningRef.current.scrollHeight;
    }
  }, [reasoning, reasoningExpanded, isStreaming]);

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
      <div className="overflow-x-auto my-3 rounded-xl border border-theme/20 shadow-sm">
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

  return (
    <div className={clsx(
      "flex flex-col w-full mb-5 group/msg"
    )}>
      {/* Reasoning indicator - only shown when no streamChunks (reasoning shown inline in streamChunks) */}
      {role === 'assistant' && hasReasoning && !hasStreamChunks && (
        <button
          onClick={() => setReasoningExpanded(!reasoningExpanded)}
          className="flex items-center gap-1.5 text-[11px] text-neutral-400 hover:text-neutral-500 transition-colors mb-1.5 ml-1 select-none pl-1"
        >
          <ChevronRight
            className={clsx(
              "w-3 h-3 transition-transform duration-200",
              reasoningExpanded && "rotate-90"
            )}
          />
          <span className="italic font-medium">
            {reasoningDuration
              ? `Thought for ${formatDuration(reasoningDuration)}`
              : 'Reasoning'
            }
          </span>
        </button>
      )}

      {/* Expanded reasoning content - only shown when no streamChunks */}
      <AnimatePresence initial={false}>
        {role === 'assistant' && hasReasoning && !hasStreamChunks && reasoningExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="w-full max-w-[85%] md:max-w-[55%] overflow-hidden mb-3"
          >
            <div
              ref={reasoningRef}
              className="pl-3 border-l-2 border-violet-200/60 max-h-36 overflow-y-auto custom-scrollbar"
            >
              <div className="text-[12px] text-theme-muted leading-relaxed py-1 prose prose-sm max-w-none prose-p:my-1 prose-headings:text-theme-fg prose-headings:font-bold prose-headings:text-xs prose-code:text-primary prose-code:bg-theme-hover prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-[10px] prose-strong:text-theme-fg prose-ul:my-1 prose-ol:my-1 prose-li:my-0">
                <ReactMarkdown
                  remarkPlugins={[remarkMath, remarkGfm]}
                  rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}
                >
                  {normalizeMarkdownSpacing(convertLatexDelims(escapeCurrencyDollars(reasoning || '')))}
                </ReactMarkdown>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>


      {/* Context paths indicator for user messages */}
      {role === 'user' && contextPaths && contextPaths.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-1.5 max-w-[90%] justify-end">
          {contextPaths.map((ctx, i) => (
            <div
              key={i}
              className="flex items-center gap-1 px-2 py-0.5 bg-violet-500/20 border border-violet-500/30 rounded-full text-[10px] text-violet-300"
              title={ctx.path}
            >
              {ctx.isDirectory ? (
                <Folder className="w-3 h-3" />
              ) : (
                <FileText className="w-3 h-3" />
              )}
              <span className="truncate max-w-[100px]">{ctx.name}</span>
            </div>
          ))}
        </div>
      )}

      {/* Main message content - renders streamChunks inline if available */}
      <div className="w-full flex flex-col space-y-2">
        {role === 'assistant' && streamChunks && streamChunks.length > 0 ? (
          <>
            {/* Render interleaved stream chunks */}
            {streamChunks.map((chunk, idx) => {
              if (chunk.type === 'reasoning') {
                // Check if this is the last reasoning chunk (for live timer)
                const isLastReasoning = !streamChunks.slice(idx + 1).some(c => c.type === 'reasoning');
                return (
                  <InlineReasoningBlock
                    key={`r-${idx}`}
                    content={chunk.content}
                    isStreaming={isStreaming}
                    isLastReasoning={isLastReasoning}
                    finalDuration={!isStreaming && isLastReasoning ? reasoningDuration : undefined}
                  />
                );
              }
              if (chunk.type === 'tool') {
                const tc = chunk.tool;
                const isGenUI = GENUI_TOOL_NAMES.has(tc.tool);
                const isHidden = HIDDEN_TOOL_NAMES.has(tc.tool);

                // Skip hidden tools (don't render anything)
                if (isHidden && !isGenUI) {
                  return null;
                }

                // Render GenUI components inline
                if (isGenUI) {
                  const isCompleted = tc.status === 'completed' || tc.status === 'error';
                  const resultForTool = genUIResults[tc.id] || tc.result;

                  return (
                    <div key={`genui-${idx}`} className="max-w-full">
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

                // Standard tool pill for non-GenUI tools
                return <ToolCallPill key={`t-${idx}`} tool={tc} />;
              }
              // Text chunk
              if (chunk.type === 'text') {
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
            {/* Copy + Revert buttons for assistant messages */}
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
                {reverted && (
                  <span className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-50 text-[10px] text-emerald-700 font-bold uppercase tracking-widest border border-emerald-200">
                    <CheckCircle className="w-3 h-3" />
                    <span>Reverted</span>
                  </span>
                )}
              </div>
            )}
          </div>
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
        {/* Modified files indicator */}
        {role === 'assistant' && modifiedFiles && modifiedFiles.length > 0 && !hasStreamChunks && (
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {modifiedFiles.map((f, i) => {
              const fileName = f.split(/[/\\]/).pop() || f;
              return (
                <span
                  key={i}
                  className={clsx(
                    "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border",
                    reverted
                      ? "bg-emerald-50 border-emerald-200 text-emerald-600"
                      : "bg-amber-50 border-amber-200 text-amber-700"
                  )}
                  title={f}
                >
                  <FileText className="w-3 h-3" />
                  <span className="truncate max-w-[120px]">{fileName}</span>
                  {reverted && <Undo2 className="w-2.5 h-2.5 ml-0.5" />}
                </span>
              );
            })}
          </div>
        )}
        {role === 'assistant' && !hasStreamChunks && hasToolCalls && (
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
  // For streaming messages, always re-render
  if (prevProps.isStreaming || nextProps.isStreaming) {
    return false;
  }
  // For non-streaming messages, only re-render if content changed
  return (
    prevProps.text === nextProps.text &&
    prevProps.role === nextProps.role &&
    prevProps.reasoning === nextProps.reasoning &&
    prevProps.reasoningDuration === nextProps.reasoningDuration &&
    prevProps.toolCalls === nextProps.toolCalls &&
    prevProps.streamChunks === nextProps.streamChunks &&
    prevProps.reverted === nextProps.reverted &&
    prevProps.messageId === nextProps.messageId
  );
});

export default MessageBubble;

