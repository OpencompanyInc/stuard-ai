
import React from "react";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { clsx } from 'clsx';
import { convertLatexDelims, escapeCurrencyDollars } from '../utils/text';
import { displayConversationTitle } from '../utils/conversationTitle';
import { Search, Clock, Trash2, Loader2, Cloud, Monitor } from "lucide-react";
import { useConfirm } from './ConfirmDialog';
import type { StreamChunk, ToolCall } from '../hooks/useAgent';
import { AssistantTracePanel } from './chat/shared/messages/MessageBubble/tools/AssistantTracePanel';

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

function getMessageText(message: any): string {
  if (typeof message?.content === 'string') return message.content;
  if (typeof message?.text === 'string') return message.text;
  if (message?.content !== undefined) return JSON.stringify(message.content);
  return '';
}

function getMessageMetadata(message: any): Record<string, any> {
  return message?.metadata && typeof message.metadata === 'object' ? message.metadata : {};
}

function getMessageReasoning(message: any): string | undefined {
  const meta = getMessageMetadata(message);
  if (typeof message?.reasoning === 'string' && message.reasoning.trim()) return message.reasoning;
  if (typeof meta.reasoning === 'string' && meta.reasoning.trim()) return meta.reasoning;
  return undefined;
}

function getMessageReasoningDuration(message: any): number | undefined {
  const meta = getMessageMetadata(message);
  const duration = message?.reasoningDuration ?? meta.reasoningDuration;
  return typeof duration === 'number' && Number.isFinite(duration) ? duration : undefined;
}

function getMessageToolCalls(message: any): ToolCall[] {
  const meta = getMessageMetadata(message);
  if (Array.isArray(message?.toolCalls)) return message.toolCalls;
  if (Array.isArray(meta.toolCalls)) return meta.toolCalls;
  if (Array.isArray(message?.tool_calls)) return message.tool_calls;
  return [];
}

function getMessageStreamChunks(message: any): StreamChunk[] | undefined {
  const meta = getMessageMetadata(message);
  if (Array.isArray(message?.streamChunks)) return message.streamChunks;
  if (Array.isArray(meta.streamChunks)) return meta.streamChunks;
  return undefined;
}

function messageHasTraceSteps(message: any): boolean {
  if (message?.role !== 'assistant') return false;
  const reasoning = getMessageReasoning(message);
  const toolCalls = getMessageToolCalls(message);
  const streamChunks = getMessageStreamChunks(message);
  if (reasoning?.trim()) return true;
  if (toolCalls.length > 0) return true;
  return Boolean(streamChunks?.some((chunk) => (
    chunk.type === 'reasoning' ||
    chunk.type === 'tool' ||
    chunk.type === 'status' ||
    (chunk.type === 'text' && chunk.nested)
  )));
}

interface HistoryViewProps {
  conversations: any[];
  conversationsLoading: boolean;
  selectedConversation: any | null;
  setSelectedConversation: (conv: any | null) => void;
  convMessages: any[];
  convLoading: boolean;
  onDeleteConversation?: (id: string) => void;
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  conversations,
  conversationsLoading,
  selectedConversation,
  setSelectedConversation,
  convMessages,
  convLoading,
  onDeleteConversation,
}) => {
  const [confirm, confirmDialog] = useConfirm();

  const handleDeleteClick = async (e: React.MouseEvent, conversationId: string) => {
    e.stopPropagation();
    const ok = await confirm({
      title: 'Delete conversation?',
      message: 'This conversation and its messages will be permanently removed. This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (ok) onDeleteConversation?.(conversationId);
  };

  return (
    <>
    {confirmDialog}
    <div className="h-[calc(100vh-140px)] flex gap-6">
      {/* Sidebar List */}
      <div className="w-80 flex flex-col bg-theme-card rounded-theme-card border border-theme overflow-hidden shadow-sm">
        <div className="p-3 border-b border-theme bg-theme-card">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-theme-muted" />
            <input
              placeholder="Search history..."
              className="w-full pl-9 pr-3 py-2 rounded-theme-button border border-theme bg-theme-hover text-theme-fg text-[13px] focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors placeholder:text-theme-muted"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-0.5 bg-transparent">
          {conversationsLoading && conversations.length === 0 ? (
            <div className="py-8 flex items-center justify-center">
              <Loader2 className="w-4 h-4 animate-spin text-theme-muted" />
            </div>
          ) : conversations.length === 0 ? (
            <div className="py-8 text-center text-[13px] text-theme-muted italic">No conversations found</div>
          ) : (
            conversations.map((c) => {
              const isActive = selectedConversation?.id === c.id;
              const isVm = c.origin === 'cloud_vm';
              return (
                <button
                  key={c.id}
                  onClick={() => setSelectedConversation(c)}
                  onDoubleClick={() => (window as any).desktopAPI?.openChat?.(c.id)}
                  className={clsx(
                    "w-full text-left px-3 py-3 rounded-theme-button transition-all border group",
                    isActive
                      ? "bg-theme-active text-theme-fg border-theme"
                      : "bg-transparent text-theme-fg border-transparent hover:bg-theme-hover"
                  )}
                >
                  <div className="flex justify-between items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className={clsx("font-medium text-[13px] truncate transition-colors", isActive ? "text-theme-fg" : "text-theme-fg")}>
                        {displayConversationTitle(c.title)}
                      </div>
                      <div className={clsx("text-[11px] mt-1 flex items-center gap-2 transition-colors", isActive ? "text-theme-muted" : "text-theme-muted")}>
                        <span className="inline-flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(c.updated_at || c.created_at).toLocaleDateString()}
                        </span>
                        <span
                          className={clsx(
                            "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-semibold uppercase tracking-wide",
                            isVm
                              ? "bg-sky-500/10 text-sky-500 dark:text-sky-300"
                              : "bg-theme-hover text-theme-muted",
                          )}
                          title={isVm ? 'Conversation from your Cloud Computer' : 'Conversation from this desktop'}
                        >
                          {isVm ? <Cloud className="w-2.5 h-2.5" /> : <Monitor className="w-2.5 h-2.5" />}
                          {isVm ? 'VM' : 'Desktop'}
                        </span>
                      </div>
                    </div>
                    {onDeleteConversation && (
                      <button
                        onClick={(e) => handleDeleteClick(e, c.id)}
                        className={clsx(
                          "p-1.5 rounded-theme-button transition-all opacity-0 group-hover:opacity-100",
                          isActive ? "text-theme-muted hover:text-red-400 hover:bg-theme-hover" : "text-theme-muted hover:text-red-400 hover:bg-theme-hover"
                        )}
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 bg-theme-card rounded-theme-card border border-theme shadow-sm overflow-hidden flex flex-col relative">
        {selectedConversation ? (
          <>
            <div className="px-6 py-4 border-b border-theme bg-theme-card flex justify-between items-center">
              <div>
                <h2 className="font-semibold text-theme-fg text-[15px]">
                  {displayConversationTitle(selectedConversation.title)}
                </h2>
                <div className="text-[12px] text-theme-muted mt-0.5">
                  {new Date(selectedConversation.created_at).toLocaleString()} • {convMessages.length} messages
                </div>
              </div>
              <button
                onClick={() => (window as any).desktopAPI?.openChat?.(selectedConversation.id)}
                className="flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-fg hover:opacity-90 rounded-theme-button text-[12px] font-medium transition-all shadow-sm"
              >
                <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                Open in Chat
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6 bg-theme-bg">
              {convLoading ? (
                <div className="flex items-center justify-center h-full text-theme-muted text-[13px]">Loading messages...</div>
              ) : convMessages.length === 0 ? (
                <div className="flex items-center justify-center h-full text-theme-muted text-[13px] italic">No messages in this conversation.</div>
              ) : (
                convMessages.map((m, i) => {
                  const isUser = m.role === 'user';
                  const hasTrace = messageHasTraceSteps(m);
                  const messageText = normalizeMarkdownSpacing(
                    convertLatexDelims(escapeCurrencyDollars(getMessageText(m))),
                  );
                  const showTextBubble = Boolean(messageText.trim());

                  return (
                    <div
                      key={i}
                      className={clsx(
                        'flex flex-col w-full min-w-0',
                        isUser ? 'items-end' : 'items-start',
                      )}
                    >
                      {!isUser && hasTrace && (
                        <div className="mb-3 w-full max-w-[85%]">
                          <AssistantTracePanel
                            reasoning={getMessageReasoning(m)}
                            reasoningDuration={getMessageReasoningDuration(m)}
                            toolCalls={getMessageToolCalls(m)}
                            streamChunks={getMessageStreamChunks(m)}
                            defaultOpen={!showTextBubble}
                          />
                        </div>
                      )}
                      {showTextBubble && (
                        <div
                          className={clsx(
                            'max-w-[85%] rounded-theme-card px-4 py-3 text-[13px] leading-relaxed shadow-sm border',
                            isUser
                              ? 'bg-primary text-primary-fg border-primary'
                              : 'bg-theme-card text-theme-fg border-theme',
                          )}
                        >
                          <div className={clsx('prose prose-sm max-w-none break-words', isUser ? 'prose-invert' : '')}>
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm, remarkMath]}
                              rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}
                              components={{
                                p: ({ children, ...props }: any) => {
                                  const childArr = Array.isArray(children) ? children : [children];
                                  const isEmpty = childArr
                                    .filter((c) => c !== null && c !== undefined)
                                    .every((c) => typeof c === 'string' && String(c).trim().length === 0);
                                  if (isEmpty) return null;
                                  return <p {...props}>{children}</p>;
                                },
                                code: ({ node, inline, className, children, ...props }: any) => {
                                  return inline ? (
                                    <code className="bg-theme-hover text-theme-fg px-[6px] py-[2px] rounded-md text-[85%] font-mono font-medium border border-theme shadow-sm align-middle" {...props}>
                                      {children}
                                    </code>
                                  ) : (
                                    <pre className="block p-3 rounded-lg bg-theme-card border border-theme shadow-sm overflow-x-auto font-mono whitespace-pre tab-4 leading-[1.7] my-2">
                                      <code className={clsx(className, 'text-[12px] text-theme-fg')} {...props}>
                                        {children}
                                      </code>
                                    </pre>
                                  );
                                },
                              }}
                            >
                              {messageText}
                            </ReactMarkdown>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-theme-muted">
            <div className="w-16 h-16 rounded-theme-card bg-theme-hover flex items-center justify-center mb-6 border border-theme">
              <Clock className="w-8 h-8 opacity-50 text-theme-muted" />
            </div>
            <p className="text-[14px] font-medium">Select a conversation to view history</p>
          </div>
        )}
      </div>
    </div>
    </>
  );
};
