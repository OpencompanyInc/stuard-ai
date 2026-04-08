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
import { ModelSelector } from './ModelSelector';
import { useModelRegistry } from '../hooks/useModelRegistry';
import type { ModelMeta } from '../hooks/usePreferences';

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

export const CloudChatPanel: React.FC<CloudChatPanelProps> = ({ engine, className }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Model selection
  const [selectedModelId, setSelectedModelId] = useState<string | 'auto'>('auto');
  const { modelById } = useModelRegistry();

  // Streaming state
  const [streamText, setStreamText] = useState('');
  const [streamReasoning, setStreamReasoning] = useState('');
  const [isReasoning, setIsReasoning] = useState(false);
  const [streamTools, setStreamTools] = useState<Array<{ tool: string; status: string }>>([]);
  const [statusMessage, setStatusMessage] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, streamText, streamReasoning, streamTools, statusMessage]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setLoading(true);
    setStreamText('');
    setStreamReasoning('');
    setStreamTools([]);
    setIsReasoning(false);
    setStatusMessage('Connecting to agent...');

    const abort = new AbortController();
    abortRef.current = abort;

    let accText = '';
    let accReasoning = '';
    let accTools: Array<{ tool: string; status: string }> = [];
    let gotFinal = false;
    let currentConvId = conversationId;

    try {
      let token = '';
      try {
        const { data } = await supabase.auth.getSession();
        token = data?.session?.access_token || '';
      } catch {}

      const isAuto = selectedModelId === 'auto';
      const meta: ModelMeta | undefined = !isAuto ? modelById.get(selectedModelId) : undefined;
      const modelTier = isAuto ? 'auto' : ((meta?.category as string) || (meta?.isReasoning ? 'smart' : 'balanced'));
      const explicitModelId = !isAuto ? selectedModelId : undefined;

      const res = await fetch(`${CLOUD_AI_HTTP}/v1/vm/agent/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          message: text,
          conversationId: currentConvId || undefined,
          model: modelTier,
          modelId: explicitModelId,
        }),
        signal: abort.signal,
      });

      // Check if we got SSE streaming response
      const contentType = res.headers.get('content-type') || '';

      if (contentType.includes('text/event-stream') && res.body) {
        setStatusMessage('');
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            // SSE lines are prefixed with "data: "
            const jsonStr = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed;
            if (!jsonStr) continue;

            let event: any;
            try { event = JSON.parse(jsonStr); } catch { continue; }

            switch (event.type) {
              case 'start':
                if (event.conversationId) {
                  currentConvId = event.conversationId;
                  setConversationId(event.conversationId);
                }
                break;

              case 'status':
                setStatusMessage(event.message || '');
                break;

              case 'progress': {
                setStatusMessage('');
                const ev = event.event || '';
                const data = event.data || {};
                if (ev === 'delta' || ev === 'text') {
                  const chunk = data.text || '';
                  if (chunk) {
                    accText += chunk;
                    setStreamText(accText);
                  }
                } else if (ev === 'reasoning_start' || ev === 'reasoning') {
                  setIsReasoning(true);
                  if (data.text) {
                    accReasoning += data.text;
                    setStreamReasoning(accReasoning);
                  }
                } else if (ev === 'reasoning_end') {
                  setIsReasoning(false);
                } else if (ev === 'start') {
                  // Stream starting, clear state
                  setStatusMessage('');
                }
                break;
              }

              case 'tool_event': {
                setStatusMessage('');
                const tool = event.tool || event.data?.tool;
                const status = event.status || event.data?.status || 'called';
                if (tool) {
                  if (status === 'completed' || status === 'result') {
                    accTools = accTools.map(t =>
                      t.tool === tool && t.status === 'called' ? { ...t, status: 'completed' } : t,
                    );
                  } else {
                    accTools = [...accTools, { tool, status: 'called' }];
                  }
                  setStreamTools([...accTools]);
                }
                break;
              }

              case 'subagent_event': {
                setStatusMessage('');
                const subEvent = event.event || '';
                const subData = event.data || {};
                if (subEvent === 'delta') {
                  const chunk = subData.text || '';
                  if (chunk) {
                    accText += chunk;
                    setStreamText(accText);
                  }
                } else if (subEvent === 'reasoning' || subEvent === 'reasoning_start') {
                  setIsReasoning(true);
                  if (subData.text) {
                    accReasoning += subData.text;
                    setStreamReasoning(accReasoning);
                  }
                } else if (subEvent === 'reasoning_end') {
                  setIsReasoning(false);
                } else if (subEvent === 'tool_call') {
                  const toolName = subData.tool || subData.name || 'tool';
                  accTools = [...accTools, { tool: toolName, status: 'called' }];
                  setStreamTools([...accTools]);
                } else if (subEvent === 'tool_result') {
                  const toolName = subData.tool || '';
                  if (toolName) {
                    accTools = accTools.map(t =>
                      t.tool === toolName && t.status === 'called' ? { ...t, status: 'completed' } : t,
                    );
                    setStreamTools([...accTools]);
                  }
                }
                break;
              }

              case 'routing':
                setStatusMessage(event.model ? `Routing to ${event.model}...` : '');
                break;

              case 'final':
                gotFinal = true;
                if (event.conversationId) {
                  currentConvId = event.conversationId;
                  setConversationId(event.conversationId);
                }
                // Use accumulated text or the final text from the event
                const finalText = accText || event.text || '';
                if (finalText) {
                  setMessages(prev => [...prev, {
                    role: 'assistant',
                    content: finalText,
                    reasoning: accReasoning || undefined,
                    toolCalls: accTools.length > 0 ? accTools : undefined,
                  }]);
                }
                break;

              case 'error':
                if (!gotFinal) {
                  gotFinal = true;
                  const errorText = accText || event.error || 'Agent error';
                  setMessages(prev => [...prev, {
                    role: 'assistant',
                    content: accText ? accText : `Error: ${event.error || 'unknown'}`,
                    reasoning: accReasoning || undefined,
                    toolCalls: accTools.length > 0 ? accTools : undefined,
                  }]);
                }
                break;
            }
          }
        }

        // If we accumulated text but never got a 'final' event, add the message
        if (!gotFinal && accText) {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: accText,
            reasoning: accReasoning || undefined,
            toolCalls: accTools.length > 0 ? accTools : undefined,
          }]);
        }
      } else {
        // Fallback: non-streaming JSON response (old VM agent without /agent/chat/stream)
        setStatusMessage('');
        const data = await res.json();
        if (data.ok && (data.text || data.result?.text)) {
          const txt = data.text || data.result?.text || '';
          setMessages(prev => [...prev, { role: 'assistant', content: txt }]);
          if (data.conversationId || data.result?.conversationId) {
            setConversationId(data.conversationId || data.result?.conversationId);
          }
        } else {
          const errMsg = data.error || 'Failed to get a response.';
          // Show a helpful message for agent boot timeout
          const isBootTimeout = errMsg.includes('agent_ws_connect_timeout');
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: isBootTimeout
              ? 'The AI agent is still starting up on your cloud engine. This usually takes 1-2 minutes after provisioning. Please try again shortly.'
              : errMsg,
          }]);
        }
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      // Show accumulated text if we have it
      if (accText) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: accText,
          reasoning: accReasoning || undefined,
          toolCalls: accTools.length > 0 ? accTools : undefined,
        }]);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: 'Connection error. Please try again.' }]);
      }
    } finally {
      setLoading(false);
      setStreamText('');
      setStreamReasoning('');
      setStreamTools([]);
      setIsReasoning(false);
      setStatusMessage('');
      abortRef.current = null;
      inputRef.current?.focus();
    }
  }, [input, loading, conversationId, selectedModelId, modelById]);

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

        {/* Status message (agent booting, loading memory, etc.) */}
        {loading && statusMessage && !hasStreamContent && (
          <div className="flex justify-start">
            <div className="bg-theme-card/50 border border-theme/10 rounded-xl rounded-bl-sm px-3 py-2 flex items-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin text-theme-muted/60" />
              <span className="text-[10px] text-theme-muted">{statusMessage}</span>
            </div>
          </div>
        )}

        {/* Simple loading dots when no stream events and no status yet */}
        {loading && !hasStreamContent && !statusMessage && (
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
        <div className="flex items-center gap-1.5 mb-1">
          <ModelSelector
            selectedModelId={selectedModelId}
            onSelectModel={(id) => setSelectedModelId(id)}
            side="top"
            variant="glass"
            className="text-[10px]"
          />
          {conversationId && (
            <button
              onClick={() => {
                setMessages([]);
                setConversationId(null);
              }}
              className="ml-auto p-1 rounded-md text-theme-muted hover:text-theme-fg hover:bg-theme-hover transition-all"
              title="New chat"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          )}
        </div>
        <div className="flex gap-1.5">
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
