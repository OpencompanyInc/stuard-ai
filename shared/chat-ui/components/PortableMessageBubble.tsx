'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { AnimatePresence, motion } from 'framer-motion';
import { Archive, Check, ChevronRight, Copy } from 'lucide-react';
import { ChainOfThought, ChainOfThoughtContent, ChainOfThoughtHeader, ChainOfThoughtStep } from '../ai-elements/ChainOfThought';
import { Shimmer } from '../ai-elements/Shimmer';
import { AUDIO_EXTS, IMAGE_EXTS, extractFilePaths, formatSec, getFileExt, humanizeToolName, isFilePath } from '../helpers';
import { isRedundantStreamingUpdate, mergeStreamingText } from '../streamMerge';
import { convertLatexDelims, escapeCurrencyDollars } from '../text';
import type { Message, StreamChunk, ToolCall } from '../types';

const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'm4v']);

// GenUI tools that render their own custom UI block (not as tracepills).
const GENUI_TOOL_NAMES = new Set([
  'ask_confirmation',
  'show_choices',
  'request_files',
  'show_files',
  'show_form',
  'chat_ui',
]);

// Interactive tools that are inlined into the message body via the renderer prop.
const INTERACTIVE_TOOL_NAMES = new Set([
  ...GENUI_TOOL_NAMES,
  'ask_user',
]);

// Tools that should never appear in the chain of thought (internal/silent).
const HIDDEN_TOOL_NAMES = new Set<string>([
  'segment_create', 'segment_update', 'segment_end', 'segment_list',
  'segment_list_recent', 'segment_search', 'segment_get',
  'segment_build_topic_drawers', 'segment_search_drawers_by_embedding',
  'collection_summary_upsert', 'collection_summary_list', 'collection_summary_get',
  'memory_store', 'memory_recall', 'memory_update', 'memory_search', 'memory_stats',
  'conversation_create', 'conversation_get', 'conversation_list', 'conversation_update',
  'conversation_delete', 'conversation_search', 'conversation_get_spaces',
  'message_add', 'message_list',
  'agent_todo',
  'knowledge_add_fact', 'knowledge_update_fact', 'knowledge_build_context',
  'knowledge_get_directives', 'knowledge_get_identity',
  'planner_list_items',
  'subagent_spawn', 'subagent_update', 'subagent_status', 'subagent_list', 'subagent_stop',
  'get_tool_schema', 'search_tools', 'reply_to_subagent',
  'ask_user',
  ...GENUI_TOOL_NAMES,
]);

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

type TraceStatus = 'complete' | 'active' | 'pending' | 'error';

interface AssistantTraceStepData {
  id: string;
  kind: 'reasoning' | 'tool' | 'status';
  label: string;
  status: TraceStatus;
  content?: string;
  tool?: ToolCall;
  nested?: boolean;
  statusVariant?: 'compacting';
  statusMeta?: {
    round?: number;
    maxRounds?: number;
    tokensBefore?: number;
    tokensAfter?: number;
  };
}

type RenderBlock =
  | { type: 'text'; text: string }
  | { type: 'tool'; tool: ToolCall };

type ContentSegment =
  | { type: 'text'; value: string }
  | { type: 'image'; src: string }
  | { type: 'audio'; src: string }
  | { type: 'video'; src: string }
  | { type: 'youtube'; embedUrl: string };

export interface PortableMessageBubbleProps {
  message: Pick<Message, 'id' | 'role' | 'text' | 'reasoning' | 'reasoningDuration' | 'toolCalls' | 'streamChunks'>;
  isStreaming?: boolean;
  startedAt?: number;
  statusMessage?: string;
  className?: string;
  interactiveToolRenderer?: (tool: ToolCall, key: string) => React.ReactNode;
}

function normalizeMarkdownSpacing(input: string): string {
  const raw = String(input || '').replace(/\r\n/g, '\n');
  const parts = raw.split('```');
  const normalized = parts.map((part, index) => {
    if (index % 2 === 1) return part;
    return part.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  });
  return normalized.join('```');
}

function normalizeMarkdown(text: string): string {
  return normalizeMarkdownSpacing(convertLatexDelims(escapeCurrencyDollars(text)));
}

function getExternalOpener() {
  return (href: string) => {
    if (!href || /^(javascript|vbscript):/i.test(href)) return;
    try {
      (window as any).desktopAPI?.openExternal?.(href);
      if (!(window as any).desktopAPI?.openExternal) {
        window.open(href, '_blank', 'noopener,noreferrer');
      }
    } catch {
      try {
        window.open(href, '_blank', 'noopener,noreferrer');
      } catch {}
    }
  };
}

function useMarkdownComponents() {
  return useMemo(() => ({
    p: ({ children, ...props }: any) => {
      const childArray = Array.isArray(children) ? children : [children];
      const isEmpty = childArray
        .filter((child: any) => child !== null && child !== undefined)
        .every((child: any) => typeof child === 'string' && String(child).trim().length === 0);

      if (isEmpty) return null;
      return <p className="mb-3 last:mb-0 leading-[1.7] text-theme-fg/95" {...props}>{children}</p>;
    },
    a: ({ href, children, ...props }: any) => (
      <a
        className="cursor-pointer font-medium text-primary underline decoration-primary/40 underline-offset-3 transition-all hover:text-primary hover:decoration-primary/70"
        href={href}
        onClick={(event: React.MouseEvent) => {
          if (typeof href === 'string') {
            event.preventDefault();
            getExternalOpener()(href);
          }
        }}
        {...props}
      >
        {children}
      </a>
    ),
    ul: (props: any) => <ul className="mb-3 list-disc space-y-1 pl-5 marker:text-theme-muted/60" {...props} />,
    ol: (props: any) => <ol className="mb-3 list-decimal space-y-1 pl-5 marker:text-theme-muted/60" {...props} />,
    li: (props: any) => <li className="leading-[1.6] text-theme-fg/95" {...props} />,
    blockquote: (props: any) => (
      <blockquote className="my-3 rounded-r-lg border-l-3 border-primary/35 bg-primary/5 py-1 pl-3" {...props}>
        <span className="italic leading-[1.6] text-theme-muted/90">{props.children}</span>
      </blockquote>
    ),
    h1: (props: any) => <h1 className="mb-3 mt-4 border-b border-theme/10 pb-1 text-xl font-bold text-theme-fg first:mt-0" {...props} />,
    h2: (props: any) => <h2 className="mb-2.5 mt-3.5 text-lg font-bold text-theme-fg first:mt-0" {...props} />,
    h3: (props: any) => <h3 className="mb-2 mt-3 text-base font-bold text-theme-fg/95 first:mt-0" {...props} />,
    h4: (props: any) => <h4 className="mb-1.5 mt-2.5 text-sm font-semibold text-theme-fg/90 first:mt-0" {...props} />,
    strong: (props: any) => <strong className="font-bold text-theme-fg" {...props} />,
    em: (props: any) => <em className="italic text-theme-fg/95" {...props} />,
    code: ({ className, children, ...props }: any) => {
      const isBlock = className?.startsWith('language-');
      if (isBlock) {
        return <code className={clsx(className, 'text-[12px]')} {...props}>{children}</code>;
      }
      return (
        <code className="rounded bg-theme-hover px-1.5 py-0.5 font-mono text-[12px] text-primary" {...props}>
          {children}
        </code>
      );
    },
    pre: ({ children, ...props }: any) => {
      let childProps: any = {};
      let codeContent = children;

      if (React.isValidElement(children)) {
        childProps = (children as any).props || {};
        codeContent = childProps.children;
      }

      const language = (childProps.className || '').replace('language-', '') || 'code';

      return (
        <div className="my-3 overflow-hidden rounded-xl border border-theme/10 bg-black/20">
          <div className="flex items-center justify-between border-b border-theme/10 bg-theme-card/30 px-3 py-1.5">
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-theme-muted">{language}</span>
            <CopyActionButton value={String(codeContent).replace(/\n$/, '')} className="text-[10px]" />
          </div>
          <pre className="overflow-x-auto p-3 text-[12px] leading-relaxed" {...props}>{children}</pre>
        </div>
      );
    },
    table: (props: any) => (
      <div className="my-3 overflow-x-auto rounded-lg border border-theme/10">
        <table className="min-w-full text-sm" {...props} />
      </div>
    ),
    th: (props: any) => <th className="border-b border-theme/10 bg-theme-card/30 px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-theme-muted" {...props} />,
    td: (props: any) => <td className="border-b border-theme/5 px-3 py-2 text-sm text-theme-fg/90" {...props} />,
    hr: () => <hr className="my-4 border-theme/10" />,
  }), []);
}

function CopyActionButton({
  value,
  className,
  iconOnly = false,
}: {
  value: string;
  className?: string;
  iconOnly?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
        } catch {}
      }}
      className={clsx(
        'inline-flex items-center justify-center gap-1 rounded-md font-medium text-theme-muted transition-colors hover:bg-theme-hover hover:text-theme-fg',
        iconOnly ? 'h-7 w-7 text-[11px]' : 'px-2 py-1 text-[11px]',
        className,
      )}
      title={copied ? 'Copied' : 'Copy'}
    >
      {copied
        ? <Check className="h-3.5 w-3.5" style={{ color: 'var(--primary)' }} />
        : <Copy className="h-3.5 w-3.5" />}
      {iconOnly ? null : <span>{copied ? 'Copied' : 'Copy'}</span>}
    </button>
  );
}

function summarizeReasoningLabel(content: string): string {
  const plain = content
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`*_>#-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!plain) return 'Planning next moves';

  const sentence = plain.split(/[.?!]/)[0]?.trim() || plain;
  const summary = truncatePreviewText(sentence, 72);
  return summary.split(' ').length >= 2 ? summary : 'Planning next moves';
}

function compactReasoningTraceSteps(steps: AssistantTraceStepData[]): AssistantTraceStepData[] {
  const compacted: AssistantTraceStepData[] = [];

  for (const step of steps) {
    const last = compacted[compacted.length - 1];
    if (
      step.kind === 'reasoning'
      && last?.kind === 'reasoning'
      && step.content
      && last.content
      && Boolean(step.nested) === Boolean(last.nested)
      && isRedundantStreamingUpdate(last.content, step.content)
    ) {
      const mergedContent = mergeStreamingText(last.content, step.content);
      compacted[compacted.length - 1] = {
        ...last,
        id: step.id,
        label: summarizeReasoningLabel(mergedContent),
        status: step.status === 'active' ? 'active' : last.status,
        content: mergedContent,
        nested: step.nested,
      };
      continue;
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

function buildTraceSteps(
  streamChunks: StreamChunk[] | undefined,
  reasoning: string | undefined,
  toolCalls: ToolCall[] | undefined,
  canInlineInteractiveTools: boolean,
  isStreaming: boolean,
): AssistantTraceStepData[] {
  const shouldInlineTool = (tool: ToolCall) =>
    canInlineInteractiveTools && INTERACTIVE_TOOL_NAMES.has(tool.tool) && !!tool.args;
  const shouldHideTool = (tool: ToolCall) =>
    HIDDEN_TOOL_NAMES.has(tool.tool) || GENUI_TOOL_NAMES.has(tool.tool) || shouldInlineTool(tool);

  const steps: AssistantTraceStepData[] = [];

  if (streamChunks && streamChunks.length > 0) {
    const lastReasoningIndex = streamChunks.reduce(
      (lastIndex, chunk, index) => (chunk.type === 'reasoning' ? index : lastIndex),
      -1,
    );

    streamChunks.forEach((chunk, index) => {
      if (chunk.type === 'reasoning') {
        steps.push({
          id: `reasoning-${index}`,
          kind: 'reasoning',
          label: summarizeReasoningLabel(chunk.content),
          status: isStreaming && index === lastReasoningIndex ? 'active' : 'complete',
          content: chunk.content,
          nested: chunk.nested,
        });
        return;
      }

      if (chunk.type === 'tool') {
        const tc = chunk.tool;
        if (shouldHideTool(tc)) return;
        steps.push({
          id: tc.id || `tool-${index}`,
          kind: 'tool',
          label: tc.description || humanizeToolName(tc.tool),
          status: mapTraceStatus(tc, isStreaming),
          tool: tc,
          nested: isDelegatedToolCall(tc),
        });
        return;
      }

      if (chunk.type === 'status') {
        steps.push({
          id: chunk.id || `status-${index}`,
          kind: 'status',
          label: chunk.label,
          status: chunk.state === 'active' ? 'active' : 'complete',
          nested: chunk.nested,
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

  (toolCalls || []).forEach((tool, index) => {
    if (shouldHideTool(tool)) return;
    steps.push({
      id: tool.id || `tool-fallback-${index}`,
      kind: 'tool',
      label: tool.description || humanizeToolName(tool.tool),
      status: mapTraceStatus(tool, isStreaming),
      tool,
      nested: isDelegatedToolCall(tool),
    });
  });

  return compactReasoningTraceSteps(steps);
}

function buildRenderBlocks(
  role: Message['role'],
  text: string,
  toolCalls: ToolCall[] | undefined,
  streamChunks: StreamChunk[] | undefined,
  canInlineInteractiveTools: boolean,
): RenderBlock[] {
  if (role !== 'assistant') {
    return text ? [{ type: 'text', text }] : [];
  }

  const shouldInlineTool = (tool: ToolCall) => canInlineInteractiveTools && INTERACTIVE_TOOL_NAMES.has(tool.tool) && !!tool.args;

  if (streamChunks && streamChunks.length > 0) {
    const blocks: RenderBlock[] = [];
    let pendingText = '';

    const flushText = () => {
      if (!pendingText) return;
      blocks.push({ type: 'text', text: pendingText });
      pendingText = '';
    };

    for (const chunk of streamChunks) {
      if (chunk.type === 'text') {
        pendingText = mergeStreamingText(pendingText, chunk.content);
      }

      if (chunk.type === 'tool' && shouldInlineTool(chunk.tool)) {
        flushText();
        blocks.push({ type: 'tool', tool: chunk.tool });
      }
    }

    flushText();
    if (blocks.length > 0) return blocks;
  }

  const blocks: RenderBlock[] = [];
  for (const tool of toolCalls || []) {
    if (shouldInlineTool(tool)) {
      blocks.push({ type: 'tool', tool });
    }
  }
  if (text) {
    blocks.push({ type: 'text', text });
  }
  return blocks;
}

function getYoutubeEmbedUrl(value: string): string | null {
  const match = value.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/i);
  if (!match?.[1]) return null;
  return `https://www.youtube.com/embed/${match[1]}`;
}

function classifyContentTarget(value: string): ContentSegment | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const youtubeEmbed = getYoutubeEmbedUrl(trimmed);
  if (youtubeEmbed) {
    return { type: 'youtube', embedUrl: youtubeEmbed };
  }

  const ext = getFileExt(trimmed);
  if (IMAGE_EXTS.has(ext)) return { type: 'image', src: trimmed };
  if (AUDIO_EXTS.has(ext)) return { type: 'audio', src: trimmed };
  if (VIDEO_EXTS.has(ext)) return { type: 'video', src: trimmed };

  return null;
}

function extractContentSegments(text: string): ContentSegment[] {
  if (!text) return [];

  const segments: ContentSegment[] = [];
  const markerRe = /<<([^>]+)>>/g;
  let lastIndex = 0;

  for (const match of text.matchAll(markerRe)) {
    const matchIndex = match.index ?? 0;
    if (matchIndex > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, matchIndex) });
    }

    const media = classifyContentTarget(match[1] || '');
    if (media) {
      segments.push(media);
    } else {
      segments.push({ type: 'text', value: match[0] });
    }

    lastIndex = matchIndex + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) });
  }

  return segments.length > 0 ? segments : [{ type: 'text', value: text }];
}

// ---------------- Tool result preview helpers (mirror desktop) ----------------

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
      if (/^(id|.*_id|.*Id|session.*|conversation.*|description)$/i.test(key)) continue;
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

function PreviewBadge({ label, value }: { label: string; value: string }) {
  return (
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
}

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
    .filter(
      (item): item is Record<string, unknown> =>
        typeof item === 'object' && item !== null && typeof (item as any).url === 'string',
    )
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

function WebSearchSources({
  query,
  sources,
}: {
  query?: string;
  sources: Array<{ title: string; url: string }>;
}) {
  return (
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
          try {
            hostname = new URL(source.url).hostname.replace(/^www\./, '');
          } catch {
            hostname = source.url;
          }
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
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
              {hostname}
            </a>
          );
        })}
        {sources.length > 8 ? (
          <span className="self-center text-[10px] text-theme-muted">+{sources.length - 8} more</span>
        ) : null}
      </div>
    </div>
  );
}

function FilePathChip({ filePath }: { filePath: string }) {
  const [copied, setCopied] = useState(false);
  const ext = getFileExt(filePath);
  const isImage = IMAGE_EXTS.has(ext);
  const isAudio = AUDIO_EXTS.has(ext);
  const fileName = filePath.split(/[/\\]/).pop() || filePath;
  const kindLabel = isImage ? 'image' : isAudio ? 'audio' : ext ? ext.toUpperCase() : 'file';

  const copyPath = (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      navigator.clipboard.writeText(filePath);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <div className="my-0.5 flex items-center gap-2 rounded-lg border border-theme/10 bg-transparent px-2.5 py-1.5">
      <span className="shrink-0 rounded-full border border-theme/10 px-1.5 py-0.5 text-[9px] font-medium text-theme-muted">
        {kindLabel}
      </span>
      <span className="max-w-[220px] truncate text-[10px] font-medium text-theme-fg/85" title={filePath}>
        {fileName}
      </span>
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          onClick={copyPath}
          className="rounded p-0.5 text-theme-muted transition-colors hover:bg-theme-hover/40 hover:text-theme-fg"
          title="Copy path"
        >
          {copied ? (
            <Check className="h-3 w-3" style={{ color: 'var(--primary)' }} />
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </button>
      </div>
    </div>
  );
}

function ToolPayloadPreview({
  data,
  emptyLabel,
  toolName,
  toolArgs,
}: {
  data: unknown;
  emptyLabel: string;
  toolName?: string;
  toolArgs?: unknown;
}) {
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
    return <div className="text-[11px] text-theme-muted">{emptyLabel}</div>;
  }

  if (typeof filtered === 'string') {
    if (isFilePath(filtered)) {
      return <FilePathChip filePath={filtered} />;
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
            <FilePathChip key={filePath} filePath={filePath} />
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
          <div className="mb-1 text-[10px] text-theme-muted">{humanizeToolName(entry.key)}</div>
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
}

function ToolTraceContent({ tool }: { tool: ToolCall }) {
  if (tool.status === 'error') {
    const errorText =
      typeof tool.error === 'string'
        ? tool.error
        : JSON.stringify(tool.error || 'Tool failed', null, 2);

    return (
      <div
        className="rounded-lg px-3 py-2 text-[11px] leading-relaxed text-red-500/90 whitespace-pre-wrap break-words"
        style={{ backgroundColor: 'color-mix(in srgb, var(--destructive) 8%, transparent)' }}
      >
        {errorText}
      </div>
    );
  }

  if (tool.status === 'completed') {
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
}

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

function StatusTraceMeta({
  meta,
}: {
  meta: NonNullable<AssistantTraceStepData['statusMeta']>;
}) {
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
      {hasRound ? (
        <div>Round {round} of {maxRounds}</div>
      ) : null}
      {hasDelta ? (
        <div>
          {formatTokenCount(tokensBefore!)} <span className="opacity-60">→</span> {formatTokenCount(tokensAfter!)} tokens
        </div>
      ) : hasTokens ? (
        <div>{formatTokenCount(tokensBefore!)} tokens</div>
      ) : null}
    </div>
  );
}

function CollapsibleToolGroup({
  toolName,
  steps,
  totalSteps,
}: {
  toolName: string;
  steps: { step: AssistantTraceStepData; idx: number }[];
  totalSteps: number;
}) {
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
              <Shimmer as="span" duration={2} spread={3}>
                {label}
              </Shimmer>
            ) : (
              <span>{label}</span>
            )}
          </button>
        }
      />
      <AnimatePresence initial={false}>
        {expanded ? (
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
                label={
                  step.status === 'active' ? (
                    <Shimmer as="span" duration={2} spread={3}>
                      {step.label}
                    </Shimmer>
                  ) : (
                    step.label
                  )
                }
              >
                {step.kind === 'tool' && step.tool ? <ToolTraceContent tool={step.tool} /> : null}
              </ChainOfThoughtStep>
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function AssistantTracePanel({
  steps,
  isStreaming,
  startedAt,
  duration,
  statusMessage,
}: {
  steps: AssistantTraceStepData[];
  isStreaming: boolean;
  startedAt?: number;
  duration?: number;
  statusMessage?: string;
}) {
  const [elapsed, setElapsed] = useState(duration || 0);

  useEffect(() => {
    if (!isStreaming || !startedAt) return;
    const interval = window.setInterval(() => {
      setElapsed((Date.now() - startedAt) / 1000);
    }, 100);
    return () => window.clearInterval(interval);
  }, [isStreaming, startedAt]);

  useEffect(() => {
    if (typeof duration === 'number') {
      setElapsed(duration);
      return;
    }
    if (!isStreaming && startedAt) {
      setElapsed((Date.now() - startedAt) / 1000);
    }
  }, [duration, isStreaming, startedAt]);

  if (steps.length === 0 && !statusMessage) return null;

  const headerLabel = isStreaming
    ? elapsed > 0
      ? `Thinking… ${formatSec(Math.max(0, elapsed))}`
      : 'Thinking…'
    : duration || elapsed
      ? `Thought for ${formatSec(Math.max(0, elapsed))}`
      : 'Thought';

  return (
    <ChainOfThought
      defaultOpen={isStreaming}
      className="mb-3 mr-auto w-full max-w-[85%] md:max-w-[60%]"
    >
      <ChainOfThoughtHeader>
        {isStreaming ? (
          <Shimmer as="span" className="text-[13px] text-theme-muted" duration={1.8} spread={3}>
            {headerLabel}
          </Shimmer>
        ) : (
          <span className="text-[13px] text-theme-muted">{headerLabel}</span>
        )}
      </ChainOfThoughtHeader>

      {steps.length > 0 ? (
        <ChainOfThoughtContent>
          {(() => {
            type DisplayItem =
              | { type: 'step'; step: AssistantTraceStepData; idx: number; nested: boolean }
              | {
                  type: 'tool-group';
                  toolName: string;
                  steps: { step: AssistantTraceStepData; idx: number }[];
                  nested: boolean;
                };

            const items: DisplayItem[] = [];
            let i = 0;
            while (i < steps.length) {
              const step = steps[i];
              const isNested = Boolean(step.nested);

              if (step.kind === 'tool' && step.tool) {
                const toolName = step.tool.tool;
                const groupSteps: { step: AssistantTraceStepData; idx: number }[] = [
                  { step, idx: i },
                ];
                let j = i + 1;
                while (j < steps.length) {
                  const next = steps[j];
                  if (
                    next.kind === 'tool' &&
                    next.tool?.tool === toolName &&
                    Boolean(next.nested) === isNested
                  ) {
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

            type NestGroup = { nested: boolean; items: DisplayItem[] };
            const nestGroups: NestGroup[] = [];
            for (const item of items) {
              const last = nestGroups[nestGroups.length - 1];
              if (last && last.nested === item.nested) {
                last.items.push(item);
              } else {
                nestGroups.push({ nested: item.nested, items: [item] });
              }
            }

            const renderItem = (item: DisplayItem, key: string) => {
              if (item.type === 'tool-group') {
                return (
                  <CollapsibleToolGroup
                    key={key}
                    toolName={item.toolName}
                    steps={item.steps}
                    totalSteps={steps.length}
                  />
                );
              }
              const { step, idx } = item;
              const isStatusStep = step.kind === 'status';
              const statusLabelNode = isStatusStep ? (
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
                  isLast={idx === steps.length - 1}
                  label={
                    step.status === 'active' ? (
                      <Shimmer as="span" duration={2} spread={3}>
                        {statusLabelNode || step.label}
                      </Shimmer>
                    ) : (
                      statusLabelNode || step.label
                    )
                  }
                >
                  {step.kind === 'reasoning' && step.content ? (
                    <div
                      className="scrollbar-none max-h-40 overflow-y-auto rounded-lg px-3 py-2 text-[11px] leading-relaxed whitespace-pre-wrap break-words"
                      style={{
                        backgroundColor: 'color-mix(in srgb, var(--sidebar-item-hover) 25%, transparent)',
                        color: 'color-mix(in srgb, var(--foreground) 62%, transparent)',
                      }}
                    >
                      {step.content}
                    </div>
                  ) : null}
                  {step.kind === 'tool' && step.tool ? <ToolTraceContent tool={step.tool} /> : null}
                  {step.kind === 'status' && step.statusMeta ? <StatusTraceMeta meta={step.statusMeta} /> : null}
                </ChainOfThoughtStep>
              );
            };

            return nestGroups.map((group, gIdx) => {
              const rendered = group.items.map((item, iIdx) =>
                renderItem(item, `${gIdx}-${iIdx}`),
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
          })()}
        </ChainOfThoughtContent>
      ) : isStreaming && statusMessage ? (
        <ChainOfThoughtContent>
          <ChainOfThoughtStep
            label={
              <Shimmer as="span" duration={2} spread={3}>
                {statusMessage}
              </Shimmer>
            }
            status="active"
            isLast
          />
        </ChainOfThoughtContent>
      ) : null}
    </ChainOfThought>
  );
}

function AssistantTextBlock({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  const mdComponents = useMarkdownComponents();
  const segments = useMemo(() => extractContentSegments(text), [text]);

  return (
    <div className="group relative w-full max-w-[85%] rounded-2xl border border-theme bg-theme-card px-4 py-3 text-[13px] leading-[1.7] text-theme-fg shadow-sm">
      <CopyActionButton
        value={text}
        iconOnly
        className="absolute right-1.5 top-1.5 opacity-0 transition-opacity group-hover:opacity-100"
      />

      <div className="space-y-3">
        {segments.map((segment, index) => {
          if (segment.type === 'text') {
            if (!segment.value.trim()) return null;
            return (
              <ReactMarkdown
                key={`text-${index}`}
                remarkPlugins={[remarkMath, remarkGfm]}
                rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}
                components={mdComponents}
              >
                {normalizeMarkdown(segment.value)}
              </ReactMarkdown>
            );
          }

          if (segment.type === 'image') {
            return <img key={`image-${index}`} src={segment.src} alt="" className="max-h-[420px] w-full rounded-xl border border-theme/10 bg-theme-bg/40 object-contain" />;
          }

          if (segment.type === 'audio') {
            return <audio key={`audio-${index}`} src={segment.src} controls className="w-full" preload="metadata" />;
          }

          if (segment.type === 'video') {
            return <video key={`video-${index}`} src={segment.src} controls className="max-h-[420px] w-full rounded-xl border border-theme/10 bg-theme-bg/40" preload="metadata" />;
          }

          return (
            <div key={`youtube-${index}`} className="overflow-hidden rounded-xl border border-theme/10 bg-theme-bg/40">
              <iframe
                src={segment.embedUrl}
                title="Embedded video"
                className="aspect-video w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          );
        })}

        {isStreaming ? <span className="inline-block h-4 w-0.5 rounded-full bg-primary/60 align-middle animate-pulse" /> : null}
      </div>
    </div>
  );
}

export function PortableMessageBubble({
  message,
  isStreaming = false,
  startedAt,
  statusMessage,
  className,
  interactiveToolRenderer,
}: PortableMessageBubbleProps) {
  const canInlineInteractiveTools = typeof interactiveToolRenderer === 'function';
  const traceSteps = useMemo(
    () => buildTraceSteps(message.streamChunks, message.reasoning, message.toolCalls, canInlineInteractiveTools, isStreaming),
    [message.reasoning, message.streamChunks, message.toolCalls, canInlineInteractiveTools, isStreaming],
  );
  const blocks = useMemo(
    () => buildRenderBlocks(message.role, message.text, message.toolCalls, message.streamChunks, canInlineInteractiveTools),
    [message.role, message.text, message.toolCalls, message.streamChunks, canInlineInteractiveTools],
  );

  if (message.role === 'system') {
    return (
      <div className={clsx('flex w-full justify-center', className)}>
        <div className="rounded-full border border-theme/10 bg-theme-hover/40 px-3 py-1.5 text-[11px] text-theme-muted">
          {message.text}
        </div>
      </div>
    );
  }

  return (
    <div className={clsx('flex w-full flex-col gap-3', message.role === 'user' ? 'items-end' : 'items-start', className)}>
      {message.role === 'assistant' ? (
        <AssistantTracePanel
          steps={traceSteps}
          isStreaming={isStreaming}
          startedAt={startedAt}
          duration={message.reasoningDuration}
          statusMessage={statusMessage}
        />
      ) : null}

      {blocks.map((block, index) => {
        if (block.type === 'tool') {
          const key = `${block.tool.id || block.tool.tool}-${index}`;
          return interactiveToolRenderer ? (
            <div key={key} className="w-full max-w-[85%]">
              {interactiveToolRenderer(block.tool, key)}
            </div>
          ) : null;
        }

        if (message.role === 'user') {
          return (
            <div
              key={`text-${index}`}
              className="ml-auto w-fit min-w-[56px] max-w-[85%] rounded-2xl border border-primary bg-primary px-4 py-2.5 text-[13px] font-semibold leading-relaxed text-primary-fg whitespace-pre-wrap break-words shadow-primary/5"
            >
              {block.text}
            </div>
          );
        }

        const isLastTextBlock = isStreaming && index === blocks.length - 1;
        return <AssistantTextBlock key={`text-${index}`} text={block.text} isStreaming={isLastTextBlock} />;
      })}
    </div>
  );
}
