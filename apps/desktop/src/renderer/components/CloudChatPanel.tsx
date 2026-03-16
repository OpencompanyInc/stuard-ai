import React, { useState, useRef, useEffect, useCallback } from 'react';
import { clsx } from 'clsx';
import { Send, Loader2, MessageSquare, RotateCcw } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

const CLOUD_AI_HTTP = (window as any).__CLOUD_AI_HTTP__ || (import.meta as any).env?.VITE_CLOUD_AI_URL || 'http://127.0.0.1:8082';

interface CloudChatPanelProps {
  engine: any;
  className?: string;
}

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setLoading(true);

    try {
      const res = await sendAgentChat(text, conversationId || undefined);
      if (res.ok && res.text) {
        setMessages(prev => [...prev, { role: 'assistant', content: res.text! }]);
        if (res.conversationId) setConversationId(res.conversationId);
      } else {
        setMessages(prev => [
          ...prev,
          { role: 'assistant', content: res.error || 'Failed to get a response.' },
        ]);
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Connection error.' }]);
    } finally {
      setLoading(false);
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
            <div
              className={clsx(
                'max-w-[85%] px-2.5 py-1.5 rounded-xl text-[11px] leading-relaxed whitespace-pre-wrap',
                msg.role === 'user'
                  ? 'bg-primary text-primary-fg rounded-br-sm'
                  : 'bg-theme-card/50 border border-theme/10 text-theme-fg rounded-bl-sm',
              )}
            >
              {msg.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-theme-card/50 border border-theme/10 rounded-xl rounded-bl-sm px-3 py-2">
              <div className="flex gap-1 items-center">
                <span
                  className="w-1.5 h-1.5 bg-theme-muted/50 rounded-full animate-bounce"
                  style={{ animationDelay: '0ms' }}
                />
                <span
                  className="w-1.5 h-1.5 bg-theme-muted/50 rounded-full animate-bounce"
                  style={{ animationDelay: '150ms' }}
                />
                <span
                  className="w-1.5 h-1.5 bg-theme-muted/50 rounded-full animate-bounce"
                  style={{ animationDelay: '300ms' }}
                />
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
