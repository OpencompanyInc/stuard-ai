
import React, { useMemo, useState, useRef, useEffect, useCallback, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import clsx from 'clsx';
import { convertLatexDelims } from '../utils/text';
import 'katex/dist/katex.min.css';
import { ChevronRight, Folder, FileText, Play, ExternalLink, CheckCircle, XCircle, Loader2, Copy, Check, Terminal } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ToolCall, StreamChunk } from '../hooks/useAgent';

import { AudioPlayer } from './AudioPlayer';
import { LinkPreview } from './LinkPreview';
import { GenUIContainer } from './genui/GenUIContainer';

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
  // GenUI display tools (rendered as UI, don't need pill)
  ...GENUI_TOOL_NAMES,
]);



const ToolCallPill: React.FC<{ tool: ToolCall }> = ({ tool }) => {
  const status = tool.status || 'running';
  const isCompleted = status === 'completed';
  const isError = status === 'error';
  const [showDescription, setShowDescription] = useState(false);

  return (
    <div className="flex flex-col gap-1.5 my-1 group/tool">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex items-center gap-2.5 text-[12px] font-semibold tracking-tight w-fit"
      >
        <div className="flex items-center justify-center w-5.5 h-5.5">
          {isCompleted ? (
            <CheckCircle className="w-3.5 h-3.5" />
          ) : isError ? (
            <XCircle className="w-3.5 h-3.5" />
          ) : (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="capitalize text-black">{humanizeToolName(tool.tool)}</span>
        </div>

        <button
          onClick={() => setShowDescription(!showDescription)}
          className="flex items-center justify-center p-1 hover:bg-gray-100 rounded transition-colors"
        >
          <ChevronRight 
            className={`w-3.5 h-3.5 text-black transition-transform duration-200 ${
              showDescription ? 'rotate-90' : ''
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

      {showDescription && tool.args && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="ml-8 text-[11px] text-gray-600 font-normal"
        >
          {typeof tool.args === 'string' ? (
            <div className="flex flex-wrap gap-1 items-center">
              <span className="text-gray-500">Args:</span>
              {tool.args.split(',').map((arg, idx) => (
                <span key={idx} className="px-2 py-1 bg-gray-100 rounded text-gray-700 text-[10px] whitespace-nowrap">
                  {arg.trim()}
                </span>
              ))}
            </div>
          ) : Array.isArray(tool.args) ? (
            <div className="flex flex-wrap gap-1 items-center">
              <span className="text-gray-500">Items:</span>
              {tool.args.map((arg, idx) => (
                <span key={idx} className="px-2 py-1 bg-gray-100 rounded text-gray-700 text-[10px] whitespace-nowrap">
                  {typeof arg === 'string' ? arg : JSON.stringify(arg)}
                </span>
              ))}
            </div>
          ) : typeof tool.args === 'object' ? (
            <div className="flex flex-wrap gap-1 items-center">
              {Object.entries(tool.args).map(([key, value]) => (
                <div key={key} className="flex items-center gap-1 bg-gray-50 rounded px-2 py-1">
                  <span className="font-medium text-gray-800 text-[10px]">{key}:</span>
                  <span className="text-gray-700 text-[10px] whitespace-nowrap">
                    {typeof value === 'string' ? value : JSON.stringify(value)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <span className="text-gray-500">Value:</span>
              <span className="px-2 py-1 bg-gray-100 rounded text-gray-700 text-[10px] whitespace-nowrap">
                {String(tool.args)}
              </span>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
};

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
  // Handle Windows paths (C:\... or C:/...)
  if (/^[a-zA-Z]:[/\\]/.test(path)) {
    path = path.replace(/\\/g, '/');
    return `local-file:///${path}`;
  }
  // Handle Unix absolute paths
  if (path.startsWith('/')) {
    return `local-file://${path}`;
  }
  // Relative path - assume local
  return `local-file://${path.replace(/\\/g, '/')}`;
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

type ContentSegment =
  | { kind: 'text'; value: string }
  | { kind: 'image'; src: string }
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
      id: `genui-${Date.now()}-${genuiCounter++}`,
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
        id: `genui-loading-${Date.now()}`,
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
    t = normalizeMarkdownSpacing(convertLatexDelims(t));
    result.push({ kind: 'text', value: t });
  };

  const allMatches: Array<{ type: 'image' | 'audio' | 'youtube' | 'link_preview' | 'genui' | 'genui_loading'; start: number; end: number; data: any }> = [];

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
    const isAudio = /\.(wav|mp3|ogg|m4a|aac|webm)$/i.test(src);
    allMatches.push({
      type: isAudio ? 'audio' : 'image',
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
    normalizeMarkdownSpacing(text)
      .replace(/==([\s\S]*?)==/g, '[$1](#highlight)')
      .replace(/\+\+([\s\S]*?)\+\+/g, '[$1](#underline)')
  );
}

const MessageBubbleInner: React.FC<MessageBubbleProps> = ({ role, text, reasoning, reasoningDuration, toolCalls, streamChunks, isStreaming, contextPaths, onSubmitToolOutput, onGenUIResponse }) => {
  const [reasoningExpanded, setReasoningExpanded] = useState(false);
  const reasoningRef = useRef<HTMLDivElement>(null);
  const [genUIResults, setGenUIResults] = useState<Record<string, any>>({});
  const [copied, setCopied] = useState(false);

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
      return <p className="mb-2 last:mb-0 leading-[1.7] text-theme-fg/95 [&:where(li_&)]:mb-1" {...props}>{children}</p>;
    },
    // Image rendering - supports local paths and web URLs
    img: ({ node, src, alt, ...props }: any) => {
      // ReactMarkdown may pass the URL via node.url or node.properties.src
      const nodeUrl = (node && (node.url || (node.properties && node.properties.src))) || '';
      const finalSrc = src || nodeUrl || '';
      try {
        console.log('[MessageBubble] img node/url:', { src, nodeUrl, finalSrc });
      } catch { }
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
    ul: (props: any) => <ul className="list-disc pl-6 mb-3 space-y-1.5 marker:text-theme/60 marker:text-sm" {...props} />,
    ol: (props: any) => <ol className="list-decimal pl-6 mb-3 space-y-1.5 marker:text-theme/60 marker:text-sm marker:font-semibold" {...props} />,
    li: (props: any) => <li className="leading-[1.7] text-theme-fg/95 pl-1" {...props} />,
    blockquote: (props: any) => (
      <blockquote className="border-l-4 border-indigo-500/40 pl-4 my-3 py-2 bg-gradient-to-r from-indigo-500/10 to-transparent rounded-r-lg" {...props}>
        <span className="text-theme-muted/90 italic leading-[1.7]">{props.children}</span>
      </blockquote>
    ),
    h1: (props: any) => <h1 className="text-lg font-bold mb-3 mt-4 first:mt-0 tracking-tight text-theme-fg border-b border-theme/10 pb-2" {...props} />,
    h2: (props: any) => <h2 className="text-base font-bold mb-2.5 mt-3.5 first:mt-0 tracking-tight text-theme-fg" {...props} />,
    h3: (props: any) => <h3 className="text-sm font-bold mb-2 mt-3 first:mt-0 text-theme-fg/95" {...props} />,
    h4: (props: any) => <h4 className="text-sm font-semibold mb-1.5 mt-2.5 first:mt-0 text-theme-fg/90" {...props} />,
    h5: (props: any) => <h5 className="text-xs font-semibold mb-1 mt-2 first:mt-0 text-theme-fg/85 uppercase tracking-wide" {...props} />,
    h6: (props: any) => <h6 className="text-xs font-medium mb-1 mt-2 first:mt-0 text-theme-muted/80 uppercase tracking-wide" {...props} />,
    strong: (props: any) => <strong className="font-bold text-theme-fg" {...props} />,
    em: (props: any) => <em className="italic text-theme-fg/95" {...props} />,
    code: ({ inline, className, children, ...props }: any) => (
      inline
        ? <code className="bg-gradient-to-br from-slate-700/80 to-slate-800/80 text-slate-100 rounded-md px-2 py-0.5 font-mono text-[85%] align-middle font-semibold border border-slate-600/30 shadow-sm" {...props}>{children}</code>
        : <div className="my-4 rounded-xl overflow-hidden bg-gradient-to-br from-slate-900/95 to-slate-800/95 border border-slate-700/50 shadow-xl">
            <div className="bg-slate-800/50 px-4 py-2 border-b border-slate-700/50 flex items-center justify-between">
              <span className="text-xs text-slate-400 font-mono">{className?.replace('language-', '') || 'code'}</span>
              <div className="flex gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
                <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
                <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
              </div>
            </div>
            <div className="overflow-x-auto overflow-y-auto max-h-[400px] custom-scrollbar p-4">
              <code className={clsx(className, "font-mono text-[13px] block min-w-full leading-[1.7] text-slate-100")} {...props}>{children}</code>
            </div>
          </div>
    ),
    pre: (props: any) => <pre className="my-4" {...props} />,
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
        id: `genui-seg-${Date.now()}-${genuiCounter++}`,
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
          id: `genui-loading-${Date.now()}`,
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
      t = normalizeMarkdownSpacing(convertLatexDelims(t));
      result.push({ kind: 'text', value: t });
    };

    // Sort all matches by position
    const allMatches: Array<{ type: 'image' | 'audio' | 'youtube' | 'link_preview' | 'genui' | 'genui_loading'; start: number; end: number; data: any }> = [];

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
      const isAudio = /\.(wav|mp3|ogg|m4a|aac|webm)$/i.test(src);
      allMatches.push({
        type: isAudio ? 'audio' : 'image',
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
      "flex flex-col w-full mb-5"
    )}>
      {/* Reasoning indicator - only shown when no streamChunks (reasoning shown inline in streamChunks) */}
      {role === 'assistant' && hasReasoning && !hasStreamChunks && (
        <button
          onClick={() => setReasoningExpanded(!reasoningExpanded)}
          className="flex items-center gap-1.5 text-[11px] text-theme-muted hover:text-theme-fg transition-colors mb-1.5 ml-1 select-none font-bold uppercase tracking-widest pl-1"
        >
          <ChevronRight
            className={clsx(
              "w-3 h-3 transition-transform duration-200",
              reasoningExpanded && "rotate-90"
            )}
          />
          <span className="italic">
            {reasoningDuration
              ? `Thought for ${formatDuration(reasoningDuration)}`
              : 'View reasoning'
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
              className="pl-4 border-l-2 border-theme/20 max-h-48 overflow-y-auto scrollbar-hidden"
            >
              <div className="text-[12px] text-theme-muted leading-relaxed py-1 prose prose-sm max-w-none prose-p:my-1 prose-headings:text-theme-fg prose-headings:font-bold prose-headings:text-xs prose-code:text-primary prose-code:bg-theme-hover prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-[10px] prose-strong:text-theme-fg prose-ul:my-1 prose-ol:my-1 prose-li:my-0">
                <ReactMarkdown
                  remarkPlugins={[remarkMath, remarkGfm]}
                  rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}
                >
                  {normalizeMarkdownSpacing(convertLatexDelims(reasoning || ''))}
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
                return (
                  <div key={`r-${idx}`} className="max-w-[85%] md:max-w-[55%] text-[12px] text-theme-muted italic pl-3 border-l-2 border-theme/20 py-1 font-medium">
                    <ReactMarkdown
                      remarkPlugins={[remarkMath, remarkGfm]}
                      rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}
                    >
                      {normalizeMarkdownSpacing(convertLatexDelims(chunk.content))}
                    </ReactMarkdown>
                  </div>
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
              const chunkSegments = extractContentSegments(chunk.content);
              return (
                <div
                  key={`txt-${idx}`}
                  className={clsx(
                    "max-w-[85%] md:max-w-[55%]",
                    "rounded-[22px] px-5 py-3.5 shadow-xl backdrop-blur-md text-[16px] leading-relaxed transition-all",
                    "bg-theme-card/90 text-theme-fg rounded-tl-sm border border-theme/10"
                  )}
                >
                  <div className="select-text whitespace-pre-wrap break-normal font-medium">
                    {chunkSegments.map((seg, segIdx) => {
                      if (seg.kind === 'genui') {
                        const isCompleted = genUIResults[seg.id] !== undefined;
                        return (
                          <div key={`genui-${idx}-${segIdx}`} className="my-3">
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
            "rounded-2xl px-5 py-3.5 shadow-lg text-[15px] relative group/bubble leading-relaxed border transition-all",
            role === 'user'
              ? "bg-primary text-primary-fg border-primary shadow-primary/5 ml-auto max-w-[85%] md:max-w-[55%] min-w-[56px] font-bold"
              : "bg-theme-card text-theme-fg border-theme/10 mr-auto max-w-[85%] md:max-w-[55%] font-medium"
          )}>
            <div
              className="select-text whitespace-pre-wrap break-normal"
              aria-live={role === 'assistant' && isStreaming ? "polite" : "off"}
            >
              {segments.length === 0 ? (
                <ReactMarkdown
                  remarkPlugins={[remarkMath, remarkGfm]}
                  rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}
                  urlTransform={(url) => url}
                  components={markdownComponents}
                >
                  {normalizeMarkdownSpacing(convertLatexDelims(text))}
                </ReactMarkdown>
              ) : (
                segments.map((seg, idx) => {
                  if (seg.kind === 'genui') {
                    const isCompleted = genUIResults[seg.id] !== undefined;
                    return (
                      <div key={`genui-${idx}`} className="my-3">
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
              </div>
            )}
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
    </div>
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
    prevProps.streamChunks === nextProps.streamChunks
  );
});

export default MessageBubble;

