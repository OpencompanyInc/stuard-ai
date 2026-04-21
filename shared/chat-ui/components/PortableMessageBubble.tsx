'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { Check, Copy } from 'lucide-react';
import { ChainOfThought, ChainOfThoughtContent, ChainOfThoughtHeader, ChainOfThoughtStep } from '../ai-elements/ChainOfThought';
import { Shimmer } from '../ai-elements/Shimmer';
import { AUDIO_EXTS, IMAGE_EXTS, extractFilePaths, formatSec, getFileExt, humanizeToolName } from '../helpers';
import { mergeStreamingText } from '../streamMerge';
import { convertLatexDelims, escapeCurrencyDollars } from '../text';
import type { Message, StreamChunk, ToolCall } from '../types';

const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'm4v']);

const INTERACTIVE_TOOL_NAMES = new Set([
  'ask_confirmation',
  'show_choices',
  'request_files',
  'show_files',
  'show_form',
  'chat_ui',
  'ask_user',
]);

type RenderBlock =
  | { type: 'text'; text: string }
  | { type: 'tool'; tool: ToolCall };

type TraceStep =
  | { type: 'reasoning'; content: string; nested?: boolean }
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

function CopyActionButton({ value, className }: { value: string; className?: string }) {
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
        'inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-theme-muted transition-colors hover:bg-theme-hover hover:text-theme-fg',
        className,
      )}
      title="Copy"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
      <span>{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
}

function stringifyPreview(value: any, maxLength = 700): string {
  if (value == null) return '';
  if (typeof value === 'string') {
    return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
  }

  try {
    const text = JSON.stringify(value, null, 2);
    return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
  } catch {
    const text = String(value);
    return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
  }
}

function buildTraceSteps(
  streamChunks: StreamChunk[] | undefined,
  reasoning: string | undefined,
  toolCalls: ToolCall[] | undefined,
  canInlineInteractiveTools: boolean,
): TraceStep[] {
  const shouldInlineTool = (tool: ToolCall) => canInlineInteractiveTools && INTERACTIVE_TOOL_NAMES.has(tool.tool) && !!tool.args;

  if (streamChunks && streamChunks.length > 0) {
    const steps: TraceStep[] = [];

    for (const chunk of streamChunks) {
      if (chunk.type === 'reasoning') {
        const last = steps[steps.length - 1];
        if (last?.type === 'reasoning' && Boolean(last.nested) === Boolean(chunk.nested)) {
          last.content = mergeStreamingText(last.content, chunk.content);
        } else {
          steps.push({ type: 'reasoning', content: chunk.content, nested: chunk.nested });
        }
      }

      if (chunk.type === 'tool' && !shouldInlineTool(chunk.tool)) {
        steps.push({ type: 'tool', tool: chunk.tool });
      }
    }

    return steps;
  }

  const steps: TraceStep[] = [];
  if (reasoning?.trim()) {
    steps.push({ type: 'reasoning', content: reasoning, nested: false });
  }
  for (const tool of toolCalls || []) {
    if (!shouldInlineTool(tool)) {
      steps.push({ type: 'tool', tool });
    }
  }
  return steps;
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

function PreviewCard({ title, value }: { title: string; value: any }) {
  const preview = stringifyPreview(value);
  if (!preview) return null;

  return (
    <div className="overflow-hidden rounded-xl border border-theme/10 bg-theme-hover/40">
      <div className="border-b border-theme/10 bg-theme-card/20 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-theme-muted">
        {title}
      </div>
      <pre className="overflow-x-auto px-3 py-2 text-[11px] leading-relaxed text-theme-fg/90 whitespace-pre-wrap break-words">{preview}</pre>
    </div>
  );
}

function ToolTraceContent({ tool }: { tool: ToolCall }) {
  const filePaths = useMemo(() => extractFilePaths(tool.result), [tool.result]);

  return (
    <div className="space-y-2.5">
      {tool.description ? (
        <div className="text-[11px] leading-relaxed text-theme-muted">{tool.description}</div>
      ) : null}
      {tool.args != null ? <PreviewCard title="Arguments" value={tool.args} /> : null}
      {tool.liveOutput ? <PreviewCard title="Live Output" value={tool.liveOutput} /> : null}
      {tool.result != null ? <PreviewCard title={tool.status === 'error' ? 'Error' : 'Result'} value={tool.result} /> : null}
      {tool.error != null ? <PreviewCard title="Error" value={tool.error} /> : null}
      {filePaths.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {filePaths.map((path) => (
            <div key={path} className="inline-flex items-center gap-2 rounded-full border border-theme/10 bg-theme-hover/40 px-3 py-1.5 text-[11px] text-theme-fg">
              <span className="max-w-[280px] truncate">{path}</span>
              <CopyActionButton value={path} className="px-1.5 py-0.5 text-[10px]" />
            </div>
          ))}
        </div>
      ) : null}
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
  steps: TraceStep[];
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
    ? `Thinking… ${formatSec(Math.max(0, elapsed))}`
    : `Thought for ${formatSec(Math.max(0, elapsed))}`;

  return (
    <ChainOfThought defaultOpen={isStreaming} className="w-full max-w-[85%]">
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
          {steps.map((step, index) => {
            const isLast = index === steps.length - 1;

            if (step.type === 'reasoning') {
              return (
                <ChainOfThoughtStep
                  key={`reasoning-${index}`}
                  label={step.nested ? 'Delegated reasoning' : 'Reasoning'}
                  status={isStreaming && isLast ? 'active' : 'complete'}
                  isLast={isLast}
                  className={step.nested ? 'ml-4' : undefined}
                >
                  <div className="max-h-44 overflow-y-auto rounded-xl border border-theme/10 bg-theme-hover/40 px-3 py-2 text-[11px] leading-relaxed text-theme-fg/90 whitespace-pre-wrap break-words">
                    {step.content}
                    {isStreaming && isLast ? (
                      <span className="ml-1 inline-block h-3.5 w-0.5 rounded-full bg-primary/60 align-middle animate-pulse" />
                    ) : null}
                  </div>
                </ChainOfThoughtStep>
              );
            }

            return (
              <ChainOfThoughtStep
                key={step.tool.id || `${step.tool.tool}-${index}`}
                label={(step.tool.nested || step.tool.subagentId ? 'Delegated · ' : '') + humanizeToolName(step.tool.tool)}
                status={step.tool.status === 'error' ? 'error' : step.tool.status === 'completed' ? 'complete' : 'active'}
                isLast={isLast}
                className={step.tool.nested || step.tool.subagentId ? 'ml-4' : undefined}
              >
                <ToolTraceContent tool={step.tool} />
              </ChainOfThoughtStep>
            );
          })}
        </ChainOfThoughtContent>
      ) : isStreaming && statusMessage ? (
        <ChainOfThoughtContent>
          <ChainOfThoughtStep
            label={<Shimmer as="span" duration={2} spread={3}>{statusMessage}</Shimmer>}
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
      <CopyActionButton value={text} className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100" />

      <div className="space-y-3 pr-10">
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
    () => buildTraceSteps(message.streamChunks, message.reasoning, message.toolCalls, canInlineInteractiveTools),
    [message.reasoning, message.streamChunks, message.toolCalls, canInlineInteractiveTools],
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