'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';

const CLOUD_API_URL = process.env.NEXT_PUBLIC_CLOUD_API_URL || 'https://api.stuard.ai';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('stuard_access_token') || null;
}

interface CloudChatProps {
  engine: any;
}

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  toolCalls?: Array<{ tool: string; status: string }>;
};

function humanizeToolName(tool: string): string {
  return tool
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export function CloudChat({ engine }: CloudChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Streaming state
  const [streamText, setStreamText] = useState('');
  const [streamReasoning, setStreamReasoning] = useState('');
  const [isReasoning, setIsReasoning] = useState(false);
  const [streamTools, setStreamTools] = useState<Array<{ tool: string; status: string }>>([]);
  const [statusMessage, setStatusMessage] = useState('');

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

    let accText = '';
    let accReasoning = '';
    let accTools: Array<{ tool: string; status: string }> = [];
    let gotFinal = false;
    let currentConvId = conversationId;

    try {
      const token = getToken();
      const res = await fetch(`${CLOUD_API_URL}/v1/vm/agent/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          message: text,
          conversationId: currentConvId || undefined,
        }),
      });

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

              case 'routing':
                setStatusMessage(event.model ? `Routing to ${event.model}...` : '');
                break;

              case 'final':
                gotFinal = true;
                if (event.conversationId) {
                  currentConvId = event.conversationId;
                  setConversationId(event.conversationId);
                }
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
                  setMessages(prev => [...prev, {
                    role: 'assistant',
                    content: accText || `Error: ${event.error || 'unknown'}`,
                    reasoning: accReasoning || undefined,
                    toolCalls: accTools.length > 0 ? accTools : undefined,
                  }]);
                }
                break;
            }
          }
        }

        if (!gotFinal && accText) {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: accText,
            reasoning: accReasoning || undefined,
            toolCalls: accTools.length > 0 ? accTools : undefined,
          }]);
        }
      } else {
        // Fallback: non-streaming JSON response
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
      inputRef.current?.focus();
    }
  }, [input, loading, conversationId]);

  if (engine.status !== 'running') {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center mb-3">
          <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
          </svg>
        </div>
        <p className="text-sm font-medium text-gray-700">Chat unavailable</p>
        <p className="text-xs text-gray-500 mt-1">Start your cloud engine to chat with your agent.</p>
      </div>
    );
  }

  const hasStreamContent = streamText || streamReasoning || streamTools.length > 0 || isReasoning;

  return (
    <div className="flex flex-col h-[600px] border border-gray-200 rounded-xl overflow-hidden bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50/50">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-500" />
          <span className="text-sm font-semibold text-gray-800">Stuard Agent</span>
        </div>
        {conversationId && (
          <button
            onClick={() => { setMessages([]); setConversationId(null); }}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            New chat
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <p className="text-sm text-gray-400">Send a message to start chatting with your cloud agent.</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className="max-w-[80%]">
              {/* Reasoning + tools */}
              {msg.role === 'assistant' && (msg.reasoning || msg.toolCalls?.length) && (
                <div className="mb-1.5 rounded-lg border border-gray-100 bg-gray-50/80 overflow-hidden">
                  <button
                    className="w-full px-3 py-1.5 text-left text-xs text-gray-400 font-medium"
                  >
                    Thought process
                  </button>
                  <div className="px-3 pb-2 space-y-1">
                    {msg.reasoning && (
                      <div className="max-h-24 overflow-y-auto text-xs text-gray-500 whitespace-pre-wrap leading-relaxed">
                        {msg.reasoning}
                      </div>
                    )}
                    {msg.toolCalls?.map((t, ti) => (
                      <div key={ti} className="flex items-center gap-1.5 text-xs text-gray-500">
                        <span className={`w-1.5 h-1.5 rounded-full ${t.status === 'completed' ? 'bg-green-400' : 'bg-yellow-400'}`} />
                        {humanizeToolName(t.tool)}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className={`px-3.5 py-2.5 rounded-2xl text-sm whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white rounded-br-md'
                  : 'bg-gray-100 text-gray-800 rounded-bl-md'
              }`}>
                {msg.content}
              </div>
            </div>
          </div>
        ))}

        {/* Live streaming */}
        {loading && hasStreamContent && (
          <div className="flex justify-start">
            <div className="max-w-[80%]">
              {(isReasoning || streamReasoning || streamTools.length > 0) && (
                <div className="mb-1.5 rounded-lg border border-gray-100 bg-gray-50/80 overflow-hidden">
                  <div className="px-3 py-1.5 text-xs text-gray-400 font-medium animate-pulse">
                    Thinking...
                  </div>
                  <div className="px-3 pb-2 space-y-1">
                    {(isReasoning || streamReasoning) && (
                      <div className="max-h-24 overflow-y-auto text-xs text-gray-500 whitespace-pre-wrap leading-relaxed">
                        {streamReasoning || '...'}
                      </div>
                    )}
                    {streamTools.map((t, ti) => (
                      <div key={ti} className="flex items-center gap-1.5 text-xs text-gray-500">
                        <span className={`w-1.5 h-1.5 rounded-full ${t.status === 'completed' ? 'bg-green-400' : 'bg-yellow-400 animate-pulse'}`} />
                        {humanizeToolName(t.tool)}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {streamText && (
                <div className="bg-gray-100 rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm whitespace-pre-wrap text-gray-800">
                  {streamText}
                  <span className="inline-block w-0.5 h-4 bg-gray-400 animate-pulse ml-0.5 align-middle" />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Status message (agent booting, loading memory, etc.) */}
        {loading && statusMessage && !hasStreamContent && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-2">
              <svg className="w-3.5 h-3.5 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span className="text-xs text-gray-500">{statusMessage}</span>
            </div>
          </div>
        )}

        {/* Simple loading dots */}
        {loading && !hasStreamContent && !statusMessage && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-100 px-4 py-3 bg-white">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Message your agent..."
            disabled={loading}
            className="flex-1 px-3.5 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 disabled:opacity-50 bg-gray-50 placeholder:text-gray-400"
            autoFocus
          />
          <button
            onClick={send}
            disabled={loading || !input.trim()}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
