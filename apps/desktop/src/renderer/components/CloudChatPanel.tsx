import React, { useState, useRef, useEffect, useCallback } from 'react';
import { clsx } from 'clsx';
import { Send, Loader2, MessageSquare, RotateCcw } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { Shimmer } from './ai-elements/Shimmer';
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtStep,
} from './ai-elements/ChainOfThought';

const CLOUD_AI_HTTP = (window as any).__CLOUD_AI_HTTP__ || (import.meta as any).env?.VITE_CLOUD_AI_URL || 'http://127.0.0.1:8082';

interface CloudChatPanelProps {
  engine: any;
  className?: string;
}

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  toolCalls?: Array<{ tool: string; status: string; args?: any; result?: any }>;
};

function humanizeToolName(tool: string): string {
  return tool
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

async function sendAgentChat(
  message: string,
  conversationId?: string,
): Promise<{ ok: boolean; text?: string; conversationId?: string; error?: string }> {
  try {
    let token = '';
    try {
      const { data } = await supabase.auth.getSession();
      token = data?.session?.access_token || '';
    } catch {}

    const res = await fetch(`${CLOUD_AI_HTTP}/v1/vm/agent/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ message, conversationId }),
    });
    return await res.json();
  } catch (e: any) {
    return { ok: false, error: e?.message || 'connection_failed' };
  }
}

export const CloudChatPanel: React.FC<CloudChatPanelProps> = ({ engine, className }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Streaming state (from VM stream mirror via IPC)
  const [streamText, setStreamText] = useState('');
  const [streamReasoning, setStreamReasoning] = useState('');
  const [isReasoning, setIsReasoning] = useState(false);
  const [streamTools, setStreamTools] = useState<Array<{ tool: string; status: string }>>([]);
  const streamReceivedFinal = useRef(false);
  // Refs mirror the latest stream state so the IPC callback (registered once) always
  // reads current values without needing to re-register on every state change.
  const streamTextRef = useRef('');
  const streamReasoningRef = useRef('');
  const streamToolsRef = useRef<Array<{ tool: string; status: string }>>([]);
  const messageAddedRef = useRef(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, streamText, streamReasoning, streamTools]);

  // Listen for VM stream mirror events via IPC.
  // Registered ONCE (empty deps) — refs provide access to latest values
  // without triggering re-registration on every delta/reasoning update.
  useEffect(() => {
    const clearStreamRefs = () => {
      streamTextRef.current = '';
      streamReasoningRef.current = '';
      streamToolsRef.current = [];
    };

    const updateToolState = (updater: (prev: Array<{ tool: string; status: string }>) => Array<{ tool: string; status: string }>) => {
      setStreamTools(prev => {
        const next = updater(prev);
        streamToolsRef.current = next;
        return next;
      });
    };

    const unsub = (window as any).desktopAPI?.onVMStreamEvent?.((event: any) => {
      if (!event?.vmMirror) return;

      if (event.type === 'progress') {
        const ev = event.event;
        const data = event.data || {};

        switch (ev) {
          case 'start':
            // Stream starting — clear any previous stream state
            clearStreamRefs();
            setStreamText('');
            setStreamReasoning('');
            setStreamTools([]);
            setIsReasoning(false);
            break;

          case 'delta':
            if (data.text) {
              streamTextRef.current += data.text;
              setStreamText(prev => prev + data.text);
            }
            break;

          case 'reasoning_start':
          case 'reasoning':
            setIsReasoning(true);
            if (data.text) {
              streamReasoningRef.current += data.text;
              setStreamReasoning(prev => prev + data.text);
            }
            break;

          case 'reasoning_end':
            setIsReasoning(false);
            break;

          case 'tool_event':
            if (data.tool) {
              updateToolState(prev => {
                const existing = prev.findIndex(t => t.tool === data.tool && t.status === 'called');
                if (data.status === 'completed' && existing >= 0) {
                  return prev.map((t, i) => i === existing ? { ...t, status: 'completed' } : t);
                }
                if (data.status === 'called') {
                  return [...prev, { tool: data.tool, status: 'called' }];
                }
                return prev;
              });
            }
            break;
        }
      } else if (event.type === 'subagent_event') {
        // Subagent streaming events from delegation (browser, file_ops, etc.)
        // NOTE: text deltas and reasoning from subagents arrive as subagent_event
        // (not duplicated as progress events — see subagent-runtime.ts).
        const ev = event.event;
        const data = event.data || {};

        switch (ev) {
          case 'started':
            // Subagent started — show as an active tool step
            updateToolState(prev => [
              ...prev,
              { tool: `delegate:${data.kind || data.label || 'task'}`, status: 'called' },
            ]);
            break;

          case 'delta':
            if (data.text) {
              streamTextRef.current += data.text;
              setStreamText(prev => prev + data.text);
            }
            break;

          case 'reasoning_start':
          case 'reasoning':
            setIsReasoning(true);
            if (data.text) {
              streamReasoningRef.current += data.text;
              setStreamReasoning(prev => prev + data.text);
            }
            break;

          case 'reasoning_end':
            setIsReasoning(false);
            break;

          case 'tool_call':
            if (data.tool) {
              updateToolState(prev => [...prev, { tool: data.tool, status: 'called' }]);
            }
            break;

          case 'tool_result':
            if (data.tool) {
              updateToolState(prev => {
                const existing = prev.findIndex(t => t.tool === data.tool && t.status === 'called');
                if (existing >= 0) {
                  return prev.map((t, i) => i === existing ? { ...t, status: 'completed' } : t);
                }
                return prev;
              });
            }
            break;

          case 'completed':
            // Mark the delegate step as completed
            updateToolState(prev =>
              prev.map(t =>
                t.tool.startsWith('delegate:') && t.status === 'called'
                  ? { ...t, status: 'completed' }
                  : t,
              ),
            );
            break;
        }
      } else if (event.type === 'final') {
        // Streaming complete — finalize the message from stream data.
        // Read from refs for the latest accumulated values (not stale closures).
        streamReceivedFinal.current = true;
        if (messageAddedRef.current) return; // HTTP fallback already added a message
        messageAddedRef.current = true;

        const finalText = event.result?.text || streamTextRef.current || '';
        const finalReasoning = streamReasoningRef.current || undefined;
        const finalTools = streamToolsRef.current.length > 0
          ? streamToolsRef.current.map(t => ({ tool: t.tool, status: t.status }))
          : undefined;

        if (finalText) {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: finalText,
            reasoning: finalReasoning,
            toolCalls: finalTools,
          }]);
        }

        if (event.conversationId) {
          setConversationId(event.conversationId);
        }

        // Clear streaming state
        clearStreamRefs();
        setStreamText('');
        setStreamReasoning('');
        setStreamTools([]);
        setIsReasoning(false);
      } else if (event.type === 'conversation' && event.conversationId) {
        setConversationId(event.conversationId);
      }
    });
    return () => { try { unsub?.(); } catch {} };
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setLoading(true);
    streamReceivedFinal.current = false;
    messageAddedRef.current = false;

    // Clear stream state for new message
    streamTextRef.current = '';
    streamReasoningRef.current = '';
    streamToolsRef.current = [];
    setStreamText('');
    setStreamReasoning('');
    setStreamTools([]);
    setIsReasoning(false);

    try {
      const res = await sendAgentChat(text, conversationId || undefined);

      // Only use HTTP response as fallback if streaming didn't deliver the final message
      if (!streamReceivedFinal.current && !messageAddedRef.current) {
        messageAddedRef.current = true;
        if (res.ok && res.text) {
          setMessages(prev => [...prev, { role: 'assistant', content: res.text! }]);
          if (res.conversationId) setConversationId(res.conversationId);
        } else {
          setMessages(prev => [
            ...prev,
            { role: 'assistant', content: res.error || 'Failed to get a response.' },
          ]);
        }
      } else {
        // Streaming already delivered the final — just update conversationId if needed
        if (res.conversationId) setConversationId(res.conversationId);
      }
    } catch {
      if (!streamReceivedFinal.current && !messageAddedRef.current) {
        messageAddedRef.current = true;
        setMessages(prev => [...prev, { role: 'assistant', content: 'Connection error.' }]);
      }
    } finally {
      setLoading(false);
      setStreamText('');
      setStreamReasoning('');
      setStreamTools([]);
      setIsReasoning(false);
      inputRef.current?.focus();
    }
  }, [input, loading, conversationId]);

  if (engine.status !== 'running') {
    return (
      <div className={clsx('flex flex-col items-center justify-center h-full py-8', className)}>
        <MessageSquare className="w-5 h-5 text-theme-muted/30 mb-2" />
        <div className="text-[10px] text-theme-muted font-medium">Resume your engine to chat</div>
      </div>
    );
  }

  const hasStreamContent = streamText || streamReasoning || streamTools.length > 0 || isReasoning;

  return (
    <div className={clsx('flex flex-col h-full', className)}>
      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-2">
        {messages.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <MessageSquare className="w-5 h-5 text-theme-muted/20 mb-2" />
            <p className="text-[10px] text-theme-muted">Chat with your cloud agent</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className="max-w-[85%]">
              {/* Reasoning + tool calls block */}
              {msg.role === 'assistant' && (msg.reasoning || msg.toolCalls?.length) && (() => {
                const steps = [
                  ...(msg.reasoning ? [{ type: 'reasoning' as const }] : []),
                  ...(msg.toolCalls || []).map((t, i) => ({ type: 'tool' as const, tool: t, idx: i })),
                ];
                return (
                  <ChainOfThought className="mb-1">
                    <ChainOfThoughtHeader>
                      <span className="text-[11px] text-theme-muted">Thought</span>
                    </ChainOfThoughtHeader>
                    <ChainOfThoughtContent>
                      {steps.map((step, si) => {
                        if (step.type === 'reasoning') {
                          return (
                            <ChainOfThoughtStep
                              key="reasoning"
                              label="Reasoning"
                              status="complete"
                              isLast={si === steps.length - 1}
                            >
                              <div
                                className="scrollbar-none max-h-28 overflow-y-auto rounded-lg px-3 py-2 text-[10px] leading-relaxed whitespace-pre-wrap break-words"
                                style={{
                                  backgroundColor: 'color-mix(in srgb, var(--sidebar-item-hover) 25%, transparent)',
                                  color: 'color-mix(in srgb, var(--foreground) 62%, transparent)',
                                }}
                              >
                                {msg.reasoning}
                              </div>
                            </ChainOfThoughtStep>
                          );
                        }
                        const t = step.tool!;
                        return (
                          <ChainOfThoughtStep
                            key={`${t.tool}-${step.idx}`}
                            label={humanizeToolName(t.tool)}
                            status={t.status === 'completed' ? 'complete' : 'active'}
                            isLast={si === steps.length - 1}
                          />
                        );
                      })}
                    </ChainOfThoughtContent>
                  </ChainOfThought>
                );
              })()}
              <div
                className={clsx(
                  'px-2.5 py-1.5 rounded-xl text-[11px] leading-relaxed whitespace-pre-wrap',
                  msg.role === 'user'
                    ? 'bg-primary text-primary-fg rounded-br-sm'
                    : 'bg-theme-card/50 border border-theme/10 text-theme-fg rounded-bl-sm',
                )}
              >
                {msg.content}
              </div>
            </div>
          </div>
        ))}

        {/* Live streaming indicator */}
        {loading && hasStreamContent && (
          <div className="flex justify-start">
            <div className="max-w-[85%]">
              {(isReasoning || streamReasoning || streamTools.length > 0) && (() => {
                const allSteps = [
                  ...(isReasoning || streamReasoning ? [{ type: 'reasoning' as const }] : []),
                  ...streamTools.map((t, i) => ({ type: 'tool' as const, tool: t, idx: i })),
                ];
                return (
                  <ChainOfThought defaultOpen className="mb-2">
                    <ChainOfThoughtHeader>
                      <Shimmer as="span" className="text-[11px] text-theme-muted" duration={1.8} spread={3}>
                        Thinking...
                      </Shimmer>
                    </ChainOfThoughtHeader>
                    <ChainOfThoughtContent>
                      {allSteps.map((step, si) => {
                        if (step.type === 'reasoning') {
                          return (
                            <ChainOfThoughtStep
                              key="reasoning"
                              label={
                                isReasoning ? (
                                  <Shimmer as="span" duration={2} spread={3}>Reasoning</Shimmer>
                                ) : 'Reasoning'
                              }
                              status={isReasoning ? 'active' : 'complete'}
                              isLast={si === allSteps.length - 1}
                            >
                              {streamReasoning ? (
                                <div
                                  className="scrollbar-none max-h-28 overflow-y-auto rounded-lg px-3 py-2 text-[10px] leading-relaxed whitespace-pre-wrap break-words"
                                  style={{
                                    backgroundColor: 'color-mix(in srgb, var(--sidebar-item-hover) 25%, transparent)',
                                    color: 'color-mix(in srgb, var(--foreground) 62%, transparent)',
                                  }}
                                >
                                  {streamReasoning}
                                </div>
                              ) : null}
                            </ChainOfThoughtStep>
                          );
                        }
                        const t = step.tool!;
                        return (
                          <ChainOfThoughtStep
                            key={`${t.tool}-${step.idx}`}
                            label={t.status === 'completed' ? humanizeToolName(t.tool) : (
                              <Shimmer as="span" duration={2} spread={3}>
                                {humanizeToolName(t.tool)}
                              </Shimmer>
                            )}
                            status={t.status === 'completed' ? 'complete' : 'active'}
                            isLast={si === allSteps.length - 1}
                          />
                        );
                      })}
                    </ChainOfThoughtContent>
                  </ChainOfThought>
                );
              })()}
              {/* Live text */}
              {streamText && (
                <div className="bg-theme-card/50 border border-theme/10 rounded-xl rounded-bl-sm px-2.5 py-1.5 text-[11px] leading-relaxed whitespace-pre-wrap text-theme-fg">
                  {streamText}
                  <span className="inline-block w-1 h-3 bg-theme-muted/50 animate-pulse ml-0.5 rounded-sm" />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Simple loading dots when no stream events yet */}
        {loading && !hasStreamContent && (
          <div className="flex justify-start">
            <div className="bg-theme-card/50 border border-theme/10 rounded-xl rounded-bl-sm px-3 py-2">
              <div className="flex gap-1 items-center">
                <span className="w-1.5 h-1.5 bg-theme-muted/50 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 bg-theme-muted/50 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-theme-muted/50 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-theme/10 px-2 py-2">
        <div className="flex gap-1.5">
          {conversationId && (
            <button
              onClick={() => {
                setMessages([]);
                setConversationId(null);
              }}
              className="p-1.5 rounded-lg text-theme-muted hover:text-theme-fg hover:bg-theme-hover transition-all"
              title="New chat"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          )}
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Message..."
            disabled={loading}
            className="flex-1 min-w-0 px-2.5 py-1.5 text-[11px] bg-theme-card/30 border border-theme/10 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/20 text-theme-fg placeholder:text-theme-muted/50 disabled:opacity-50"
            autoFocus
          />
          <button
            onClick={send}
            disabled={loading || !input.trim()}
            className="p-1.5 rounded-lg bg-primary text-primary-fg disabled:opacity-30 transition-all hover:opacity-90"
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
          </button>
        </div>
      </div>
    </div>
  );
};
