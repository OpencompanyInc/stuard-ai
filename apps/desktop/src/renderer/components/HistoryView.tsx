
import React from "react";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { clsx } from 'clsx';
import { convertLatexDelims, escapeCurrencyDollars } from '../utils/text';
import { Search, Clock, Trash2, Loader2 } from "lucide-react";

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

function getMessageReasoning(message: any): string | undefined {
  if (typeof message?.reasoning === 'string' && message.reasoning.trim()) return message.reasoning;
  if (typeof message?.metadata?.reasoning === 'string' && message.metadata.reasoning.trim()) return message.metadata.reasoning;
  return undefined;
}

function getMessageToolCalls(message: any): any[] {
  if (Array.isArray(message?.toolCalls)) return message.toolCalls;
  if (Array.isArray(message?.metadata?.toolCalls)) return message.metadata.toolCalls;
  if (Array.isArray(message?.tool_calls)) return message.tool_calls;
  return [];
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
  return (
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
                        {c.title || "Untitled Conversation"}
                      </div>
                      <div className={clsx("text-[11px] mt-1 flex items-center gap-1 transition-colors", isActive ? "text-theme-muted" : "text-theme-muted")}>
                        <Clock className="w-3 h-3" />
                        {new Date(c.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    {onDeleteConversation && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (window.confirm("Are you sure you want to delete this conversation?")) {
                            onDeleteConversation(c.id);
                          }
                        }}
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
                  {selectedConversation.title || "Untitled Conversation"}
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
                convMessages.map((m, i) => (
                  <div key={i} className={clsx("flex", m.role === 'user' ? "justify-end" : "justify-start")}>
                    <div className={clsx(
                      "max-w-[85%] rounded-theme-card px-4 py-3 text-[13px] leading-relaxed shadow-sm border",
                      m.role === 'user'
                        ? "bg-primary text-primary-fg border-primary"
                        : "bg-theme-card text-theme-fg border-theme"
                    )}>
                      <div className={clsx("prose prose-sm max-w-none break-words", m.role === 'user' ? "prose-invert" : "")}>
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
                                  <code className="bg-slate-100 text-slate-800 px-[6px] py-[2px] rounded-md text-[85%] font-mono font-medium border border-slate-200 shadow-sm align-middle" {...props}>
                                      {children}
                                  </code>
                              ) : (
                                  <pre className="block p-3 rounded-lg bg-white border border-slate-200 shadow-sm overflow-x-auto font-mono whitespace-pre tab-4 leading-[1.7] my-2">
                                      <code className={clsx(className, "text-[12px] text-slate-800")} {...props}>
                                          {children}
                                      </code>
                                  </pre>
                              )
                            }
                          }}
                        >
                          {normalizeMarkdownSpacing(convertLatexDelims(escapeCurrencyDollars(getMessageText(m))))}
                        </ReactMarkdown>
                      </div>
                      {getMessageReasoning(m) && (
                        <details className="mt-3 rounded-lg border border-theme bg-theme-bg/60 px-3 py-2">
                          <summary className="cursor-pointer text-[11px] font-medium text-theme-muted">Reasoning</summary>
                          <div className="mt-2 text-[12px] whitespace-pre-wrap text-theme-muted leading-relaxed">
                            {getMessageReasoning(m)}
                          </div>
                        </details>
                      )}
                      {getMessageToolCalls(m).length > 0 && (
                        <details className="mt-3 rounded-lg border border-theme bg-theme-bg/60 px-3 py-2">
                          <summary className="cursor-pointer text-[11px] font-medium text-theme-muted">
                            Tool calls ({getMessageToolCalls(m).length})
                          </summary>
                          <div className="mt-2 space-y-2">
                            {getMessageToolCalls(m).map((tool: any, toolIdx: number) => (
                              <div key={tool.id || toolIdx} className="rounded-md border border-theme bg-theme-card px-2.5 py-2">
                                <div className="text-[12px] font-medium text-theme-fg">
                                  {tool.tool || tool.name || 'Tool'}
                                </div>
                                {tool.status && (
                                  <div className="text-[11px] text-theme-muted mt-0.5">{tool.status}</div>
                                )}
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                  </div>
                ))
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
  );
};
