import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import {
  Send, Loader2, StopCircle, Trash2, Bot, User, WifiOff,
  ShieldCheck, ShieldAlert, Check, X, Terminal as TerminalIcon,
  FileEdit, AlertTriangle, ChevronDown, Copy,
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useModelRegistry } from '../hooks/useModelRegistry';
import { convertLatexDelims, escapeCurrencyDollars } from '../utils/text';

const CLOUD_AI_HTTP = (window as any).__CLOUD_AI_HTTP__ || (import.meta as any).env?.VITE_CLOUD_AI_URL || 'http://127.0.0.1:8082';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  timestamp: number;
}

interface ApprovalRequest {
  id: string;
  tool: string;
  args?: Record<string, any>;
  description?: string;
}

const TOOL_RISK: Record<string, 'high' | 'medium' | 'low'> = {
  run_command: 'high',
  write_file: 'medium',
  terminal_create: 'medium',
  terminal_send_input: 'medium',
  terminal_send_raw: 'medium',
  terminal_send_keys: 'medium',
  terminal_destroy: 'low',
};

function getToolIcon(tool: string) {
  if (tool.startsWith('terminal_')) return TerminalIcon;
  if (tool === 'write_file') return FileEdit;
  if (tool.includes('command')) return TerminalIcon;
  return AlertTriangle;
}

function normalizeMarkdownSpacing(input: string): string {
  const raw = String(input || '').replace(/\r\n/g, '\n');
  const parts = raw.split('```');
  const normalized = parts.map((part, idx) => {
    if (idx % 2 === 1) return part;
    return part.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  });
  return normalized.join('```');
}

function buildVmWsUrl(): string {
  const base = String(CLOUD_AI_HTTP).replace(/\/+$/, '');
  if (base.startsWith('https://')) {
    return `wss://${base.slice('https://'.length)}/ws`;
  }
  return `ws://${base.replace(/^http:\/\//, '')}/ws`;
}

// Markdown components for assistant messages
function useMarkdownComponents() {
  return useMemo(() => ({
    p: ({ children, ...props }: any) => {
      const childArr = Array.isArray(children) ? children : [children];
      const isEmpty = childArr
        .filter((c: any) => c !== null && c !== undefined)
        .every((c: any) => typeof c === 'string' && String(c).trim().length === 0);
      if (isEmpty) return null;
      return <p className="mb-3 last:mb-0 leading-[1.7] text-theme-fg/95" {...props}>{children}</p>;
    },
    a: ({ href, children, ...props }: any) => (
      <a
        className="text-indigo-400 underline underline-offset-3 decoration-indigo-400/40 hover:decoration-indigo-400/70 hover:text-indigo-300 cursor-pointer transition-all font-medium"
        href={href}
        onClick={(e: React.MouseEvent) => {
          if (typeof href === 'string' && !/^(javascript|vbscript):/i.test(href)) {
            e.preventDefault();
            try { (window as any).desktopAPI?.openExternal?.(href); } catch {}
          }
        }}
        {...props}
      >{children}</a>
    ),
    ul: (props: any) => <ul className="list-disc pl-5 mb-3 space-y-1 marker:text-theme/50" {...props} />,
    ol: (props: any) => <ol className="list-decimal pl-5 mb-3 space-y-1 marker:text-theme/50 marker:font-semibold" {...props} />,
    li: (props: any) => <li className="leading-[1.6] text-theme-fg/95 pl-0.5" {...props} />,
    blockquote: (props: any) => (
      <blockquote className="border-l-3 border-indigo-500/40 pl-3 my-3 py-1 bg-indigo-500/5 rounded-r-lg" {...props}>
        <span className="text-theme-muted/90 italic leading-[1.6]">{props.children}</span>
      </blockquote>
    ),
    h1: (props: any) => <h1 className="text-xl font-bold mb-3 mt-4 first:mt-0 text-theme-fg border-b border-theme/10 pb-1" {...props} />,
    h2: (props: any) => <h2 className="text-lg font-bold mb-2.5 mt-3.5 first:mt-0 text-theme-fg" {...props} />,
    h3: (props: any) => <h3 className="text-base font-bold mb-2 mt-3 first:mt-0 text-theme-fg/95" {...props} />,
    h4: (props: any) => <h4 className="text-sm font-semibold mb-1.5 mt-2.5 first:mt-0 text-theme-fg/90" {...props} />,
    strong: (props: any) => <strong className="font-bold text-theme-fg" {...props} />,
    em: (props: any) => <em className="italic text-theme-fg/95" {...props} />,
    code: ({ className, children, ...props }: any) => {
      const isBlock = className?.startsWith('language-');
      if (isBlock) {
        return <code className={clsx(className, 'text-[12px]')} {...props}>{children}</code>;
      }
      return (
        <code className="text-primary bg-theme-hover px-1.5 py-0.5 rounded text-[12px] font-mono" {...props}>
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
      const langClass = childProps.className || '';
      const language = langClass.replace('language-', '') || 'code';
      return (
        <div className="my-3 rounded-xl overflow-hidden border border-theme/10 bg-black/20">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-theme/10 bg-theme-card/20">
            <span className="text-[10px] text-theme-muted font-mono font-bold uppercase tracking-wider">{language}</span>
            <button
              onClick={() => navigator.clipboard.writeText(String(codeContent).replace(/\n$/, ''))}
              className="flex items-center gap-1 px-1.5 py-0.5 hover:bg-theme-hover rounded text-theme-muted hover:text-theme-fg text-[10px] transition-colors"
            >
              <Copy className="w-3 h-3" /> Copy
            </button>
          </div>
          <pre className="p-3 overflow-x-auto text-[12px] leading-relaxed" {...props}>{children}</pre>
        </div>
      );
    },
    table: (props: any) => (
      <div className="my-3 overflow-x-auto rounded-lg border border-theme/10">
        <table className="min-w-full text-sm" {...props} />
      </div>
    ),
    th: (props: any) => <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-theme-muted bg-theme-card/30 border-b border-theme/10" {...props} />,
    td: (props: any) => <td className="px-3 py-2 text-sm text-theme-fg/90 border-b border-theme/5" {...props} />,
    hr: () => <hr className="my-4 border-theme/10" />,
  }), []);
}

export function CloudVmChat({ engine, className }: { engine: any; className?: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [pendingApprovals, setPendingApprovals] = useState<ApprovalRequest[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('auto');
  const [showModelPicker, setShowModelPicker] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streamTextRef = useRef('');
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const mdComponents = useMarkdownComponents();

  const { models } = useModelRegistry();
  const isRunning = engine?.status === 'running';

  const selectedModelMeta = useMemo(() => {
    if (selectedModel === 'auto') return null;
    return models.find((m) => m.id === selectedModel) || null;
  }, [selectedModel, models]);

  // Close model picker on outside click
  useEffect(() => {
    if (!showModelPicker) return;
    const handler = (e: MouseEvent) => {
      if (modelPickerRef.current && !modelPickerRef.current.contains(e.target as Node)) {
        setShowModelPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showModelPicker]);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamText, pendingApprovals, scrollToBottom]);

  const connect = useCallback(async () => {
    if (!isRunning) return;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;

    let token: string | null = null;
    try {
      const { data } = await supabase.auth.getSession();
      token = data?.session?.access_token || null;
    } catch {}

    setStatus('connecting');
    const wsUrl = buildVmWsUrl();
    const urlWithAuth = token ? `${wsUrl}?token=${encodeURIComponent(token)}` : wsUrl;
    const ws = new WebSocket(urlWithAuth);

    ws.onopen = () => {
      setStatus('connected');
      if (token) {
        ws.send(JSON.stringify({ type: 'auth', accessToken: token }));
      }
    };

    ws.onclose = () => {
      setStatus('idle');
      wsRef.current = null;
    };

    ws.onerror = () => {
      setStatus('error');
      wsRef.current = null;
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === 'handshake') return;

        if (msg.type === 'progress') {
          const evt = msg as { event: string; data: any };

          if (evt.event === 'start') {
            setStreaming(true);
            streamTextRef.current = '';
            setStreamText('');
          } else if (evt.event === 'delta') {
            const chunk = typeof evt.data?.text === 'string' ? evt.data.text : '';
            if (chunk) {
              streamTextRef.current += chunk;
              setStreamText(streamTextRef.current);
            }
          } else if (evt.event === 'tool_event') {
            const toolData = evt.data || {};
            if (toolData.status === 'approval_required') {
              const approval: ApprovalRequest = {
                id: toolData.id || `approval-${Date.now()}`,
                tool: toolData.tool || 'unknown',
                args: toolData.args,
                description: toolData.description,
              };
              setPendingApprovals((prev) => [...prev, approval]);
            }
          }
        } else if (msg.type === 'final') {
          const result = msg.result || {};
          const text = result.response || result.text || streamTextRef.current || '';

          if (text.trim()) {
            setMessages((prev) => [
              ...prev,
              {
                id: `assistant-${Date.now()}`,
                role: 'assistant',
                text: text.trim(),
                timestamp: Date.now(),
              },
            ]);
          }

          setStreaming(false);
          setStreamText('');
          streamTextRef.current = '';
        } else if (msg.type === 'error') {
          const errText = msg.message || msg.error || 'Unknown error';
          setMessages((prev) => [
            ...prev,
            {
              id: `error-${Date.now()}`,
              role: 'assistant',
              text: `Error: ${errText}`,
              timestamp: Date.now(),
            },
          ]);
          setStreaming(false);
          setStreamText('');
          streamTextRef.current = '';
        }
      } catch {
        // ignore
      }
    };

    wsRef.current = ws;
  }, [isRunning]);

  useEffect(() => {
    if (isRunning) {
      connect();
    } else {
      wsRef.current?.close();
      wsRef.current = null;
      setStatus('idle');
    }
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [isRunning, connect]);

  const respondToApproval = useCallback((id: string, allow: boolean) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'approval_response', id, allow }));
    }
    setPendingApprovals((prev) => prev.filter((a) => a.id !== id));
    setMessages((prev) => [
      ...prev,
      {
        id: `perm-${Date.now()}`,
        role: 'system',
        text: allow ? `Approved: ${id}` : `Denied: ${id}`,
        timestamp: Date.now(),
      },
    ]);
  }, []);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      await connect();
      await new Promise((r) => setTimeout(r, 1000));
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        setMessages((prev) => [
          ...prev,
          {
            id: `error-${Date.now()}`,
            role: 'assistant',
            text: 'Could not connect to the VM agent. Make sure the engine is running.',
            timestamp: Date.now(),
          },
        ]);
        return;
      }
    }

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      text,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');

    const history = [...messages, userMsg].slice(-30).map((m) => ({
      role: m.role === 'system' ? 'assistant' : m.role,
      content: m.text,
    }));

    const payload: any = {
      type: 'chat',
      text,
      context: {},
      attachments: [],
      messages: history,
      clientIntegrations: ['browser_use'],
    };

    // Attach selected model
    if (selectedModel && selectedModel !== 'auto') {
      payload.modelId = selectedModel;
    }

    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data?.session?.access_token;
      if (accessToken) {
        payload.auth = { accessToken };
      }
    } catch {}

    wsRef.current.send(JSON.stringify(payload));
  }, [input, streaming, messages, connect, selectedModel]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    },
    [sendMessage],
  );

  const handleStop = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'stop' }));
    }
    setStreaming(false);
    setStreamText('');
    streamTextRef.current = '';
  }, []);

  const handleClear = useCallback(() => {
    setMessages([]);
    setStreamText('');
    streamTextRef.current = '';
    setPendingApprovals([]);
  }, []);

  // Render markdown content
  const renderMarkdown = (text: string) => (
    <ReactMarkdown
      remarkPlugins={[remarkMath, remarkGfm]}
      rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}
      components={mdComponents}
    >
      {normalizeMarkdownSpacing(convertLatexDelims(escapeCurrencyDollars(text)))}
    </ReactMarkdown>
  );

  if (!isRunning) {
    return (
      <div className={clsx('flex flex-col items-center justify-center text-theme-muted/50 gap-3', className)}>
        <WifiOff className="w-10 h-10" />
        <p className="text-sm font-semibold">Engine is not running</p>
        <p className="text-xs">Start your Cloud Engine to chat with the VM agent.</p>
      </div>
    );
  }

  return (
    <div className={clsx('flex flex-col rounded-2xl border border-theme/10 overflow-hidden', className)}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-theme/5 bg-theme-card/20">
        <Bot className="w-5 h-5 text-primary" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-theme-fg">VM Agent Chat</div>
          <div className="text-[10px] text-theme-muted">
            {engine?.instance_name || 'Cloud Engine'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Model Selector */}
          <div className="relative" ref={modelPickerRef}>
            <button
              onClick={() => setShowModelPicker((v) => !v)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-theme-hover/50 text-xs font-semibold text-theme-fg hover:bg-theme-hover transition-colors"
            >
              {selectedModelMeta?.logoUrl && (
                <img src={selectedModelMeta.logoUrl} className="w-3.5 h-3.5 rounded" alt="" />
              )}
              <span className="max-w-[100px] truncate">
                {selectedModel === 'auto' ? 'Auto' : selectedModelMeta?.name || selectedModel.split('/').pop()}
              </span>
              <ChevronDown className="w-3 h-3 text-theme-muted" />
            </button>

            {showModelPicker && (
              <div className="absolute right-0 top-full mt-1 z-50 w-64 max-h-72 overflow-y-auto rounded-xl border border-theme/10 bg-theme-card shadow-xl">
                <button
                  onClick={() => { setSelectedModel('auto'); setShowModelPicker(false); }}
                  className={clsx(
                    'w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-sm hover:bg-theme-hover/60 transition-colors',
                    selectedModel === 'auto' && 'bg-primary/10',
                  )}
                >
                  <span className="w-5 h-5 rounded bg-theme-hover flex items-center justify-center text-[10px] font-bold text-theme-muted">A</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-theme-fg">Auto</div>
                    <div className="text-[10px] text-theme-muted">Let the system choose</div>
                  </div>
                  {selectedModel === 'auto' && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
                </button>

                {models.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => { setSelectedModel(m.id); setShowModelPicker(false); }}
                    className={clsx(
                      'w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-theme-hover/60 transition-colors',
                      selectedModel === m.id && 'bg-primary/10',
                    )}
                  >
                    {m.logoUrl ? (
                      <img src={m.logoUrl} className="w-5 h-5 rounded shrink-0" alt="" />
                    ) : (
                      <span className="w-5 h-5 rounded bg-theme-hover flex items-center justify-center text-[9px] font-bold text-theme-muted shrink-0">
                        {(m.provider || '?')[0]}
                      </span>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-theme-fg truncate">{m.name}</div>
                      <div className="text-[10px] text-theme-muted truncate">{m.provider}</div>
                    </div>
                    {selectedModel === m.id && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Status dot */}
          <div className="flex items-center gap-1.5 text-xs text-theme-muted">
            <span
              className={clsx(
                'w-2 h-2 rounded-full',
                status === 'connected'
                  ? 'bg-green-500'
                  : status === 'connecting'
                    ? 'bg-yellow-500 animate-pulse'
                    : status === 'error'
                      ? 'bg-red-500'
                      : 'bg-gray-400',
              )}
            />
          </div>
          <button onClick={handleClear} className="p-1.5 rounded-lg text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60 transition-colors" title="Clear chat">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0 bg-theme-bg/30">
        <div className="px-4 py-3 space-y-4">
          {messages.length === 0 && !streaming && pendingApprovals.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-theme-muted/40">
              <Bot className="w-10 h-10 mb-3" />
              <p className="text-sm font-semibold">Chat with your VM agent</p>
              <p className="text-xs mt-1">Send a message to test the agent running on {engine?.instance_name || 'your engine'}</p>
            </div>
          )}

          {messages.map((msg) => {
            if (msg.role === 'system') {
              const isApproved = msg.text.startsWith('Approved:');
              return (
                <div key={msg.id} className="flex justify-center">
                  <div className={clsx(
                    'flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold',
                    isApproved ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500',
                  )}>
                    {isApproved ? <ShieldCheck className="w-3 h-3" /> : <ShieldAlert className="w-3 h-3" />}
                    {msg.text}
                  </div>
                </div>
              );
            }

            return (
              <div key={msg.id} className={clsx('flex gap-2.5', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                {msg.role === 'assistant' && (
                  <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <Bot className="w-4 h-4 text-primary" />
                  </div>
                )}
                <div
                  className={clsx(
                    'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
                    msg.role === 'user'
                      ? 'bg-primary text-primary-fg whitespace-pre-wrap break-words'
                      : 'bg-theme-card/50 text-theme-fg border border-theme/5 prose-vm',
                  )}
                >
                  {msg.role === 'assistant' ? renderMarkdown(msg.text) : msg.text}
                </div>
                {msg.role === 'user' && (
                  <div className="w-7 h-7 rounded-full bg-theme-hover/60 flex items-center justify-center shrink-0 mt-0.5">
                    <User className="w-4 h-4 text-theme-muted" />
                  </div>
                )}
              </div>
            );
          })}

          {/* Pending approval requests */}
          {pendingApprovals.map((approval) => {
            const risk = TOOL_RISK[approval.tool] || 'medium';
            const ToolIcon = getToolIcon(approval.tool);
            const riskColors = {
              high: { bg: 'bg-red-500/10', border: 'border-red-500/20', text: 'text-red-500', badge: 'bg-red-500' },
              medium: { bg: 'bg-amber-500/10', border: 'border-amber-500/20', text: 'text-amber-500', badge: 'bg-amber-500' },
              low: { bg: 'bg-blue-500/10', border: 'border-blue-500/20', text: 'text-blue-500', badge: 'bg-blue-500' },
            };
            const colors = riskColors[risk];

            return (
              <div key={approval.id} className={clsx('rounded-2xl border p-4', colors.bg, colors.border)}>
                <div className="flex items-start gap-3">
                  <div className={clsx('w-8 h-8 rounded-xl flex items-center justify-center shrink-0', colors.bg)}>
                    <ToolIcon className={clsx('w-4 h-4', colors.text)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-bold text-theme-fg">Permission Required</span>
                      <span className={clsx('text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full text-white', colors.badge)}>
                        {risk}
                      </span>
                    </div>
                    <div className="text-xs text-theme-muted mb-2">
                      {approval.description || `The agent wants to use ${approval.tool}`}
                    </div>
                    <div className="text-[11px] font-mono bg-black/10 rounded-lg px-2.5 py-1.5 text-theme-fg/80 mb-3 break-all">
                      <span className="text-theme-muted">tool:</span> {approval.tool}
                      {approval.args?.command && (
                        <>
                          <br />
                          <span className="text-theme-muted">cmd:</span> {String(approval.args.command).slice(0, 200)}
                        </>
                      )}
                      {approval.args?.path && (
                        <>
                          <br />
                          <span className="text-theme-muted">path:</span> {String(approval.args.path).slice(0, 200)}
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => respondToApproval(approval.id, true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 text-white text-xs font-bold hover:bg-green-700 transition-colors"
                      >
                        <Check className="w-3 h-3" /> Allow
                      </button>
                      <button
                        onClick={() => respondToApproval(approval.id, false)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600/10 text-red-500 text-xs font-bold hover:bg-red-600/20 transition-colors"
                      >
                        <X className="w-3 h-3" /> Deny
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Streaming response */}
          {streaming && (
            <div className="flex gap-2.5 justify-start">
              <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <Bot className="w-4 h-4 text-primary" />
              </div>
              <div className="max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed bg-theme-card/50 text-theme-fg border border-theme/5 prose-vm">
                {streamText ? renderMarkdown(streamText) : (
                  <span className="flex items-center gap-2 text-theme-muted">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Thinking...
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-theme/5 px-4 py-3 bg-theme-card/10">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message to the VM agent..."
            rows={1}
            className="flex-1 resize-none bg-theme-hover/40 rounded-xl px-4 py-2.5 text-sm text-theme-fg placeholder-theme-muted/50 outline-none focus:ring-2 focus:ring-primary/20 max-h-32 overflow-y-auto transition-shadow"
            style={{ minHeight: '40px' }}
            disabled={streaming}
          />
          {streaming ? (
            <button onClick={handleStop} className="p-2.5 rounded-xl bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors" title="Stop">
              <StopCircle className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={sendMessage}
              disabled={!input.trim()}
              className={clsx(
                'p-2.5 rounded-xl transition-colors',
                input.trim() ? 'bg-primary text-primary-fg hover:opacity-90' : 'bg-theme-hover/40 text-theme-muted/40',
              )}
              title="Send"
            >
              <Send className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
