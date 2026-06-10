
import React, { useMemo, useState, useRef, useEffect, useCallback, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import clsx from 'clsx';
import { isRedundantStreamingUpdate, mergeStreamingText } from '../../../../../utils/streamMerge';
import { convertLatexDelims, escapeCurrencyDollars } from '../../../../../utils/text';
import 'katex/dist/katex.min.css';
import { Archive, ChevronRight, Folder, FileText, Play, ExternalLink, CheckCircle, XCircle, Loader2, Copy, Check, Terminal, Pencil, Undo2, Redo2, X, Send, Users, ArrowUpRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ToolCall, StreamChunk } from '../../../../../hooks/useAgent';

import { AudioPlayer } from '../../../../AudioPlayer';
import { AttachmentPreviewStrip } from '../../../../AttachmentPreview';
import { LinkPreview } from '../../../../LinkPreview';
import { GenUIContainer, GenUIErrorBoundary } from '../../../../genui';
import { useFileViewerOptional } from '../../../../file-viewer';
import { Shimmer } from '../../../../ai-elements/Shimmer';
import { useElapsedSeconds, useElapsedSecondsFine } from '../../../../../hooks/useSharedTicker';
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtStep,
} from '../../../../ai-elements/ChainOfThought';
import type { ChatAttachment } from '../../../../../utils/attachments';

import { GENUI_TOOL_NAMES, HIDDEN_TOOL_NAMES, GENUI_COMPONENT_MAP, EMAIL_GENUI_TOOL_NAMES } from './constants';
import { toMediaSrc, extractYouTubeVideoId, formatDuration } from './helpers/media';
import { stripMarkdown, stripMarkdownFromArgs, normalizeMarkdownSpacing, processCustomMarkdown } from './helpers/markdown';
import { FILE_PATH_RE, IMAGE_EXTS, AUDIO_EXTS, getFileExt, isFilePath, extractFilePaths, getFilenameFromPath } from './helpers/filePaths';
import { humanizeToolName, getQueryFromArgs, getAnalyzeMediaTarget } from './helpers/toolLabels';
import { InlineImage } from './inline/InlineImage';
import { InlineVideo } from './inline/InlineVideo';
import { InlineFilePreview } from './inline/InlineFilePreview';
import { InlineReasoningBlock } from './inline/InlineReasoningBlock';
import { YouTubeEmbed } from './inline/YouTubeEmbed';

import type { ContentSegment, ContextPath } from './types';
import { extractContentSegments } from './helpers/content';
import { isTopLevelDuplicateOfNestedText } from './helpers/trace';
import { unwrapExecuteTool } from './helpers/executeTool';
import { ToolCallPill } from './tools/ToolCallPill';
import { AssistantTracePanel } from './tools/AssistantTracePanel';
import { useMessageMarkdownComponents } from './hooks/useMessageMarkdownComponents';



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

  const markdownComponents = useMessageMarkdownComponents(role);

  const segments = useMemo<ContentSegment[]>(() => extractContentSegments(text), [text]);
  const isEmailOnlyUserMessage = role === 'user' && segments.length > 0
    && segments.every((seg) => seg.kind === 'genui' && EMAIL_GENUI_TOOL_NAMES.has(seg.component));

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
  const inlineChatUiBubbleClass = "w-full max-w-[560px] mr-auto";

  return (
    <div className={clsx(
      "flex flex-col w-full min-w-0 max-w-full mb-5 group/msg"
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
        <div className={clsx(
          "mb-2 flex",
          role === 'user' ? 'justify-end pr-1' : 'justify-start pl-1',
        )}>
          <AttachmentPreviewStrip
            attachments={attachments}
            layout="wrap"
            align={role === 'user' ? 'right' : 'left'}
          />
        </div>
      )}

      {/* Main message content - renders streamChunks inline if available */}
      <div className="w-full min-w-0 flex flex-col space-y-2">
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
                const tc = unwrapExecuteTool(chunk.tool);
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
                      "w-fit max-w-[85%] text-[15px] leading-relaxed text-theme-fg font-normal px-0 py-1",
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
                        if (seg.kind === 'file') {
                          return <InlineFilePreview key={`file-${idx}-${segIdx}`} src={seg.src} />;
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
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-theme-hover/50 hover:bg-theme-hover text-[10px] text-theme-muted hover:text-theme-fg transition-all font-bold uppercase tracking-widest"
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
          shouldRenderTextBubble ? (() => {
            const bubbleClassName = clsx(
              "text-[15px] relative group/bubble leading-relaxed transition-colors",
              compact
                ? "w-full max-w-full bg-transparent px-4 py-3 text-theme-fg"
                : clsx(
                  "min-w-0 max-w-[85%]",
                  role === 'user'
                    ? (isEditing
                      ? "rounded-2xl px-4 py-3 bg-theme-input text-theme-fg w-full font-medium"
                      : isEmailOnlyUserMessage
                        ? "rounded-2xl px-0 py-0 bg-transparent text-theme-fg w-fit font-medium mr-2"
                        : "rounded-2xl px-5 py-3.5 bg-theme-user-bubble text-theme-fg w-fit font-medium mr-2")
                    : "bg-transparent text-theme-fg w-fit font-normal px-0 py-1 ml-2",
                ),
            );

            const bubble = (
            <div className={bubbleClassName}>
            {/* Edit mode for user messages */}
            {role === 'user' && isEditing ? (
              <div className="flex flex-col gap-2 w-full min-w-0">
                <textarea
                  ref={editTextareaRef}
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={handleEditKeyDown}
                  className="w-full bg-theme-bg text-theme-fg rounded-xl px-3 py-2.5 text-[14px] font-medium leading-relaxed outline-none border border-theme/20 focus:border-theme/40 focus:ring-2 focus:ring-theme/10 placeholder:text-theme-muted resize-none min-h-[112px] max-h-[260px] overflow-y-auto scrollbar-minimal"
                  rows={4}
                  placeholder="Edit your message..."
                />
                <div className="flex items-center gap-2 justify-end">
                  <button
                    onClick={handleEditCancel}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold text-theme-muted hover:text-theme-fg hover:bg-theme-hover/50 transition-colors"
                  >
                    <X className="w-3 h-3" />
                    Cancel
                  </button>
                  <button
                    onClick={handleEditSubmit}
                    disabled={!editText.trim() || editText.trim() === text.trim()}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-theme-hover hover:bg-theme-active text-theme-fg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Send className="w-3 h-3" />
                    Send
                  </button>
                </div>
              </div>
            ) : (
              <div
                className="select-text whitespace-pre-wrap break-words min-w-0 overflow-x-auto"
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
                    if (seg.kind === 'file') {
                      return <InlineFilePreview key={`file-${idx}`} src={seg.src} />;
                    }
                    if (seg.kind === 'youtube') {
                      return <YouTubeEmbed key={`yt-${idx}`} videoId={seg.videoId} url={seg.url} />;
                    }
                    if (seg.kind === 'link_preview') {
                      return <LinkPreview key={`lp-${idx}`} url={seg.url} />;
                    }
                    if (seg.kind === 'report_button') {
                      return (
                        <button
                          key={`report-${idx}`}
                          onClick={() => window.dispatchEvent(new CustomEvent('open-research-report'))}
                          className="my-2 inline-flex items-center gap-2.5 pl-2.5 pr-3.5 h-9 rounded-xl border text-[12.5px] font-semibold transition-colors"
                          style={{
                            backgroundColor: 'color-mix(in srgb, #06b6d4 12%, transparent)',
                            borderColor: 'color-mix(in srgb, #06b6d4 33%, transparent)',
                            color: '#06b6d4',
                          }}
                          title="Open the full research report"
                        >
                          <FileText className="w-4 h-4" strokeWidth={1.75} />
                          <span>{seg.title ? `Open report: ${seg.title}` : 'Open full report'}</span>
                          <ArrowUpRight className="w-3.5 h-3.5 opacity-70" strokeWidth={2} />
                        </button>
                      );
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
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-theme-hover/50 hover:bg-theme-hover text-[10px] text-theme-muted hover:text-theme-fg transition-all font-bold uppercase tracking-widest"
                  title="Copy response"
                >
                  {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
                {modifiedFiles && modifiedFiles.length > 0 && checkpointId && onRevertFiles && messageId && !reverted && (
                  <button
                    onClick={handleRevert}
                    disabled={isReverting}
                    className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-500/10 hover:bg-amber-500/15 text-[10px] text-amber-700 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300 transition-all font-bold uppercase tracking-widest disabled:opacity-50"
                    title={`Revert ${modifiedFiles.length} file change(s)`}
                  >
                    {isReverting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Undo2 className="w-3 h-3" />}
                    <span>{isReverting ? 'Reverting...' : `Revert ${modifiedFiles.length} file(s)`}</span>
                  </button>
                )}
                {reverted && modifiedFiles && modifiedFiles.length > 0 && checkpointId && (
                  <div className="flex items-center gap-1.5">
                    <span className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-500/10 text-[10px] text-emerald-700 dark:text-emerald-400 font-bold uppercase tracking-widest">
                      <CheckCircle className="w-3 h-3" />
                      <span>Reverted</span>
                    </span>
                    {onRedoFiles && messageId && (
                      <button
                        onClick={handleRedo}
                        disabled={isRedoing}
                        className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-blue-500/10 hover:bg-blue-500/15 text-[10px] text-blue-700 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-all font-bold uppercase tracking-widest disabled:opacity-50"
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
                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                        : "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                    )}
                  >
                    {actionFeedback.type === 'reverted' ? <Undo2 className="w-3 h-3" /> : <Redo2 className="w-3 h-3" />}
                    {actionFeedback.count} file(s) {actionFeedback.type}
                  </motion.span>
                )}
              </div>
            )}
            </div>
            );

            if (role === 'user' && !compact) {
              return (
                <div className="flex justify-end w-full min-w-0 pr-2">
                  {bubble}
                </div>
              );
            }

            if (role === 'assistant' && !compact) {
              return (
                <div className="flex justify-start w-full min-w-0 pl-1">
                  {bubble}
                </div>
              );
            }

            return bubble;
          })() : null
        )}
        {/* Edit icon for user messages — outside bubble, in the gap */}
        {role === 'user' && !isEditing && !isStreaming && messageId && onEditMessage && (
          <div className="flex justify-end mt-1 pr-1 opacity-0 group-hover/msg:opacity-100 transition-opacity duration-150">
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
          <div className="flex justify-end w-full min-w-0 mt-1.5 pr-1">
            <div className="flex flex-wrap gap-1 justify-end max-w-[85%] min-w-0">
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
                    "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] transition-colors",
                    reverted
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 line-through decoration-emerald-400/50"
                      : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
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
