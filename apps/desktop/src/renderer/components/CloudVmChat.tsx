import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import {
  Send, Loader2, Trash2, Bot, User, WifiOff,
  Check, ChevronDown, Copy, MessageSquare, Plus, Clock, X, Square,
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useModelRegistry } from '../hooks/useModelRegistry';
import type { ModelMeta } from '../hooks/usePreferences';
import { mergeStreamingText } from '../utils/streamMerge';
import { convertLatexDelims, escapeCurrencyDollars } from '../utils/text';
import { Shimmer } from './ai-elements/Shimmer';
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtStep,
} from './ai-elements/ChainOfThought';
import { GenUIContainer, GenUIErrorBoundary } from './genui';
import { AskUserPrompt } from './chat-view/AskUserPrompt';

const CLOUD_AI_HTTP = ((window as any).__CLOUD_AI_HTTP__ || (import.meta as any).env?.VITE_CLOUD_AI_URL || 'http://127.0.0.1:8082').replace(/\/+$/, '');

const GENUI_TOOLS = new Set([
  'ask_confirmation', 'show_choices', 'request_files', 'show_files', 'show_form', 'chat_ui',
]);

const INTERACTIVE_TOOLS = new Set([...GENUI_TOOLS, 'ask_user']);

function humanizeToolName(tool: string): string {
  return tool
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

function formatDuration(seconds: number): string {
  if (seconds < 1) return '<1s';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

const StreamingTracePanel: React.FC<{
  reasoning: string;
  tools: Array<{ tool: string; status: string; args?: any }>;
  statusMessage: string;
  startTime: number;
  isStreaming: boolean;
}> = React.memo(({ reasoning, tools, statusMessage, startTime, isStreaming }) => {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!isStreaming) return;
    const interval = setInterval(() => {
      setElapsed((Date.now() - (startTime || Date.now())) / 1000);
    }, 100);
    return () => clearInterval(interval);
  }, [startTime, isStreaming]);

  // Freeze final elapsed when streaming stops
  useEffect(() => {
    if (!isStreaming && startTime) {
      setElapsed((Date.now() - startTime) / 1000);
    }
  }, [isStreaming, startTime]);

  const nonInteractiveTools = tools.filter(t => !INTERACTIVE_TOOLS.has(t.tool));
  const hasContent = reasoning.trim().length > 0 || nonInteractiveTools.length > 0;
  const headerLabel = isStreaming
    ? `Thinking\u2026 ${formatDuration(elapsed)}`
    : `Thought for ${formatDuration(elapsed)}`;

  return (
    <ChainOfThought defaultOpen={isStreaming} className="w-full max-w-[85%] md:max-w-[60%] mb-3">
      <ChainOfThoughtHeader>
        {isStreaming ? (
          <Shimmer as="span" className="text-[13px] text-theme-muted" duration={1.8} spread={3}>
            {headerLabel}
          </Shimmer>
        ) : (
          <span className="text-[13px] text-theme-muted">{headerLabel}</span>
        )}
      </ChainOfThoughtHeader>

      {hasContent && (
        <ChainOfThoughtContent>
          {reasoning.trim().length > 0 && (
            <ChainOfThoughtStep
              label={
                isStreaming
                  ? <Shimmer as="span" duration={2} spread={3}>Reasoning</Shimmer>
                  : 'Reasoning'
              }
              status={isStreaming ? 'active' : 'complete'}
              isLast={tools.length === 0}
            >
              <div
                className="scrollbar-none max-h-40 overflow-y-auto rounded-lg px-3 py-2 text-[11px] leading-relaxed whitespace-pre-wrap break-words"
                style={{
                  backgroundColor: 'color-mix(in srgb, var(--sidebar-item-hover) 25%, transparent)',
                  color: 'color-mix(in srgb, var(--foreground) 62%, transparent)',
                }}
              >
                {reasoning}
                {isStreaming && (
                  <span className="inline-block w-[2px] h-3 bg-violet-300 ml-0.5 animate-[blink_1s_step-end_infinite] align-middle rounded-full" />
                )}
              </div>
            </ChainOfThoughtStep>
          )}

          {nonInteractiveTools.map((t, i) => (
            <ChainOfThoughtStep
              key={`${t.tool}-${i}`}
              label={
                t.status === 'completed'
                  ? humanizeToolName(t.tool)
                  : <Shimmer as="span" duration={2} spread={3}>{humanizeToolName(t.tool)}</Shimmer>
              }
              status={t.status === 'completed' ? 'complete' : 'active'}
              isLast={i === nonInteractiveTools.length - 1}
            />
          ))}
        </ChainOfThoughtContent>
      )}

      {!hasContent && isStreaming && (
        <ChainOfThoughtContent>
          <ChainOfThoughtStep
            label={
              <Shimmer as="span" duration={2} spread={3}>{statusMessage || 'Planning next moves'}</Shimmer>
            }
            status="active"
            isLast
          />
        </ChainOfThoughtContent>
      )}
    </ChainOfThought>
  );
});

interface VmToolCall {
  tool: string;
  status: string;
  args?: any;
  result?: any;
  id?: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  timestamp: number;
  reasoning?: string;
  tools?: VmToolCall[];
  thinkDuration?: number;
}

interface ConversationEntry {
  id: string;
  title: string;
  updated_at: string;
  message_count: number;
}

async function vmRelay(path: string, body?: any, method = 'POST'): Promise<any> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token || '';
    const resp = await fetch(`${CLOUD_AI_HTTP}/v1/vm/relay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ path, method, body }),
    });
    return await resp.json();
  } catch {
    return { ok: false, error: 'relay_failed' };
  }
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

export function CloudVmChat({
  engine,
  className,
  variant = 'default',
}: {
  engine: any;
  className?: string;
  variant?: 'default' | 'workspace';
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>('auto');
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [displayName, setDisplayName] = useState('there');
  const conversationIdRef = useRef<string | null>(null);
  const conversationTitleRef = useRef<string>('');
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const mdComponents = useMarkdownComponents();

  // Streaming state
  const [streamText, setStreamText] = useState('');
  const [streamReasoning, setStreamReasoning] = useState('');
  const [streamTools, setStreamTools] = useState<VmToolCall[]>([]);
  const [statusMessage, setStatusMessage] = useState('');
  const streamStartRef = useRef<number>(0);

  // GenUI / ask_user state
  const [genUIResults, setGenUIResults] = useState<Record<string, any>>({});

  // Chat history state
  const [conversations, setConversations] = useState<ConversationEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [loadingConvId, setLoadingConvId] = useState<string | null>(null);
  const historyPanelRef = useRef<HTMLDivElement>(null);

  const { models, modelById } = useModelRegistry();
  const isRunning = engine?.status === 'running';

  const selectedModelMeta = useMemo(() => {
    if (selectedModel === 'auto') return null;
    return models.find((m) => m.id === selectedModel) || null;
  }, [selectedModel, models]);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  }, []);

  const quickPrompts = useMemo(
    () => [
      'Review system health',
      'Summarize current deployments',
      'Help me inspect the runtime',
    ],
    [],
  );

  useEffect(() => {
    let active = true;

    supabase.auth.getUser().then(({ data }) => {
      if (!active) return;

      const user = data?.user;
      const rawName =
        user?.user_metadata?.full_name ||
        user?.user_metadata?.name ||
        user?.email?.split('@')[0] ||
        'there';

      setDisplayName(String(rawName).split(/\s+/)[0] || 'there');
    }).catch(() => {});

    return () => {
      active = false;
    };
  }, []);

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

  // Close history panel on outside click
  useEffect(() => {
    if (!showHistory) return;
    const handler = (e: MouseEvent) => {
      if (historyPanelRef.current && !historyPanelRef.current.contains(e.target as Node)) {
        setShowHistory(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showHistory]);

  // Fetch conversation history — try multiple sources
  const fetchHistory = useCallback(async () => {
    if (!isRunning) return;
    setHistoryLoading(true);
    try {
      // 1. Try VM memory store first (fast, in-memory)
      const vmRes = await vmRelay('/memory/conversations_list', { limit: 30 });
      let rawConvs: any[] = vmRes?.result?.conversations || vmRes?.conversations || [];

      // 2. If empty, try the cloud-ai memory API (reads from Supabase / local DB)
      if (rawConvs.length === 0) {
        try {
          const { data } = await supabase.auth.getSession();
          const token = data?.session?.access_token || '';
          const fallbackRes = await fetch(`${CLOUD_AI_HTTP}/v1/memory/conversations?limit=30&status=active`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          const fallbackData = await fallbackRes.json();
          if (fallbackData.ok && Array.isArray(fallbackData.conversations)) {
            rawConvs = fallbackData.conversations;
          }
        } catch { /* silent */ }
      }

      // 3. Also try Supabase directly as last resort
      if (rawConvs.length === 0) {
        try {
          const { data, error } = await supabase
            .from('conversations')
            .select('id, title, created_at, updated_at, message_count')
            .neq('source', 'workflow')
            .order('updated_at', { ascending: false })
            .limit(30);
          if (!error && Array.isArray(data)) rawConvs = data;
        } catch { /* silent */ }
      }

      const convs: ConversationEntry[] = rawConvs
        .filter((c: any) => c.source !== 'workflow')
        .map((c: any) => ({
          id: c.id || c.conversation_id,
          title: c.title || 'Untitled',
          updated_at: c.updated_at || c.created_at || '',
          message_count: c.message_count || 0,
        }))
        .sort((a: ConversationEntry, b: ConversationEntry) =>
          new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime(),
        );
      setConversations(convs);
    } catch { /* silent */ }
    setHistoryLoading(false);
  }, [isRunning]);

  useEffect(() => {
    if (isRunning) fetchHistory();
  }, [isRunning, fetchHistory]);

  // Load a conversation from history — try VM relay, then cloud-ai, then Supabase
  const loadConversation = useCallback(async (convId: string) => {
    setLoadingConvId(convId);
    let rawMsgs: any[] = [];

    try {
      // 1. VM relay (Python agent DB)
      const res = await vmRelay('/memory/messages_list', { conversation_id: convId, limit: 100 });
      rawMsgs = res?.result?.messages || res?.messages || [];

      // 2. Cloud-ai memory API
      if (rawMsgs.length === 0) {
        try {
          const { data } = await supabase.auth.getSession();
          const token = data?.session?.access_token || '';
          const resp = await fetch(`${CLOUD_AI_HTTP}/v1/memory/conversations/${encodeURIComponent(convId)}/messages?limit=100`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          const d = await resp.json();
          if (d.ok && Array.isArray(d.messages)) rawMsgs = d.messages;
        } catch { /* silent */ }
      }

      // 3. Supabase direct
      if (rawMsgs.length === 0) {
        try {
          const { data, error } = await supabase
            .from('messages')
            .select('role, content, created_at')
            .eq('conversation_id', convId)
            .order('created_at', { ascending: true })
            .limit(100);
          if (!error && Array.isArray(data)) rawMsgs = data;
        } catch { /* silent */ }
      }

      if (rawMsgs.length > 0) {
        const loaded: ChatMessage[] = rawMsgs.map((m: any, i: number) => ({
          id: `${convId}-${i}`,
          role: m.role === 'assistant' ? 'assistant' as const : 'user' as const,
          text: String(m.content || m.text || ''),
          timestamp: m.created_at ? new Date(m.created_at).getTime() : Date.now() - (rawMsgs.length - i) * 1000,
        }));
        setMessages(loaded);
        conversationIdRef.current = convId;
        const conv = conversations.find(c => c.id === convId);
        if (conv) conversationTitleRef.current = conv.title;
      }
    } catch { /* silent */ }

    setLoadingConvId(null);
    setShowHistory(false);
    requestAnimationFrame(() => scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight));
  }, [conversations]);

  // Start a new chat
  const startNewChat = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setLoading(false);
    conversationIdRef.current = null;
    conversationTitleRef.current = '';
    setShowHistory(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading, streamText, streamReasoning, streamTools, scrollToBottom]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || loading || !isRunning) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      text,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    setStreamText('');
    setStreamReasoning('');
    setStreamTools([]);
    setStatusMessage('Connecting...');
    streamStartRef.current = Date.now();

    const abort = new AbortController();
    abortRef.current = abort;

    let accText = '';
    let accReasoning = '';
    let accTools: VmToolCall[] = [];

    try {
      let token = '';
      try {
        const { data } = await supabase.auth.getSession();
        token = data?.session?.access_token || '';
      } catch {}

      // Derive tier + explicit modelId
      const isAuto = selectedModel === 'auto';
      const meta: ModelMeta | undefined = !isAuto ? modelById.get(selectedModel) : undefined;
      const modelTier = isAuto ? 'auto' : ((meta?.category as string) || (meta?.isReasoning ? 'smart' : 'balanced'));
      const explicitModelId = !isAuto ? selectedModel : undefined;

      const resp = await fetch(`${CLOUD_AI_HTTP}/v1/vm/agent/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          message: text,
          conversationId: conversationIdRef.current || undefined,
          model: modelTier,
          modelId: explicitModelId,
        }),
        signal: abort.signal,
      });

      const contentType = resp.headers.get('content-type') || '';

      if (contentType.includes('text/event-stream') && resp.body) {
        setStatusMessage('');
        const reader = resp.body.getReader();
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
              case 'progress': {
                const ev = event.event || '';
                const d = event.data || {};
                if (ev === 'delta') {
                  const chunk = d.text || '';
                  if (chunk) { accText += chunk; setStreamText(accText); }
                } else if (ev === 'reasoning' || ev === 'reasoning_start') {
                  if (d.text) {
                    accReasoning = mergeStreamingText(accReasoning, d.text);
                    setStreamReasoning(accReasoning);
                  }
                }
                break;
              }
              case 'tool_event': {
                const toolName = event.tool || '';
                const toolStatus = event.status || '';
                const toolData = event.data || {};
                const toolId = toolData.id || toolData.toolCallId || event.id || '';
                if (toolName) {
                  if (toolStatus === 'called' || toolStatus === 'running' || toolStatus === 'started') {
                    accTools = [...accTools, { tool: toolName, status: 'called', args: toolData.args || toolData, id: toolId }];
                  } else if (toolStatus === 'completed' || toolStatus === 'result') {
                    accTools = accTools.map(t =>
                      t.tool === toolName && t.status === 'called'
                        ? { ...t, status: 'completed', result: toolData.result || toolData }
                        : t,
                    );
                  } else {
                    accTools = accTools.map(t =>
                      t.tool === toolName && t.status === 'called'
                        ? { ...t, status: toolStatus || 'completed' }
                        : t,
                    );
                  }
                  setStreamTools([...accTools]);
                }
                break;
              }
              case 'tool_request': {
                const toolName = event.tool || '';
                const toolArgs = event.args || {};
                const toolId = event.id || `tr-${Date.now()}`;
                if (toolName) {
                  accTools = [...accTools, { tool: toolName, status: 'called', args: toolArgs, id: toolId }];
                  setStreamTools([...accTools]);
                }
                break;
              }
              case 'subagent_event': {
                const subEvent = event.event || '';
                const subData = event.data || {};
                if (subEvent === 'delta' && subData.text) { accText += subData.text; setStreamText(accText); }
                else if ((subEvent === 'reasoning' || subEvent === 'reasoning_start') && subData.text) {
                  accReasoning = mergeStreamingText(accReasoning, subData.text);
                  setStreamReasoning(accReasoning);
                }
                else if (subEvent === 'tool_call') { accTools = [...accTools, { tool: subData.tool || subData.name || 'tool', status: 'called' }]; setStreamTools([...accTools]); }
                else if (subEvent === 'tool_result') {
                  const tn = subData.tool || '';
                  if (tn) { accTools = accTools.map(t => t.tool === tn && t.status === 'called' ? { ...t, status: 'completed' } : t); setStreamTools([...accTools]); }
                }
                break;
              }
              case 'routing':
                setStatusMessage(event.model ? `Routing → ${event.model}` : '');
                break;
              case 'status':
                setStatusMessage(event.message || '');
                break;
              case 'start':
                if (event.conversationId) conversationIdRef.current = event.conversationId;
                break;
              case 'conversation':
                if (event.conversationId) conversationIdRef.current = event.conversationId;
                break;
              case 'title':
                if (event.title) {
                  conversationTitleRef.current = event.title;
                  const cid = event.conversationId || conversationIdRef.current;
                  if (cid) {
                    setConversations(prev => prev.map(c => c.id === cid ? { ...c, title: event.title } : c));
                  }
                }
                break;
              case 'final': {
                const finalText = event.text || event.data?.text || accText;
                if (finalText) accText = finalText;
                if (event.conversationId) conversationIdRef.current = event.conversationId;
                break;
              }
            }
          }
        }

        const thinkDuration = streamStartRef.current ? (Date.now() - streamStartRef.current) / 1000 : undefined;
        setMessages((prev) => [
          ...prev,
          {
            id: `assistant-${Date.now()}`, role: 'assistant', text: accText || 'No response', timestamp: Date.now(),
            reasoning: accReasoning || undefined,
            tools: accTools.length > 0 ? accTools : undefined,
            thinkDuration,
          },
        ]);
      } else {
        // Non-streaming fallback (JSON response)
        const data = await resp.json() as any;
        const replyText = String(data?.text || data?.result?.text || data?.error || 'No response').trim();
        if (data?.conversationId) conversationIdRef.current = data.conversationId;
        setMessages((prev) => [
          ...prev,
          { id: `assistant-${Date.now()}`, role: 'assistant', text: replyText, timestamp: Date.now() },
        ]);
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      setMessages((prev) => [
        ...prev,
        { id: `error-${Date.now()}`, role: 'assistant', text: `Error: ${e?.message || 'Failed to reach VM agent'}`, timestamp: Date.now() },
      ]);
    } finally {
      setLoading(false);
      setStreamText('');
      setStreamReasoning('');
      setStreamTools([]);
      setStatusMessage('');
      abortRef.current = null;
      fetchHistory();
    }
  }, [input, loading, isRunning, selectedModel, modelById, fetchHistory]);

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
    abortRef.current?.abort();
    setLoading(false);
    setStreamText('');
    setStreamReasoning('');
    setStreamTools([]);
    setStatusMessage('');
    abortRef.current = null;
  }, []);

  const submitVmToolResult = useCallback(async (toolId: string, result: any) => {
    try {
      await vmRelay('/command', {
        command: 'tool_result',
        args: { id: toolId, result },
      });
    } catch { /* best-effort */ }
  }, []);

  const handleClear = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setLoading(false);
    conversationIdRef.current = null;
    conversationTitleRef.current = '';
  }, []);

  const applyPrompt = useCallback((text: string) => {
    setInput(text);
    requestAnimationFrame(() => inputRef.current?.focus());
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

  const formatTimeAgo = (dateStr: string) => {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  };

  const historyButton = (
    <div className="relative" ref={historyPanelRef}>
      <button
        type="button"
        onClick={() => { setShowHistory(v => !v); if (!showHistory) fetchHistory(); }}
        className="dashboard-refresh-button inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs !rounded-xl"
        title="Chat history"
      >
        <Clock className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">History</span>
      </button>

      {showHistory && (
        <div className={clsx(
          'absolute z-50 w-80 max-h-96 rounded-2xl border border-theme bg-theme-card shadow-elevate flex flex-col',
          variant === 'workspace' ? 'bottom-full left-0 mb-2' : 'right-0 top-full mt-1',
        )}>
          <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-theme/10">
            <span className="text-xs font-semibold text-theme-fg">Conversations</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => { startNewChat(); setShowHistory(false); }}
                className="inline-flex items-center gap-1 px-2 py-1 text-[10px] rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
              >
                <Plus className="w-3 h-3" /> New
              </button>
              <button type="button" onClick={() => setShowHistory(false)} className="p-0.5 rounded text-theme-muted hover:text-theme-fg">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-none p-1">
            {historyLoading && conversations.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-4 h-4 animate-spin text-theme-muted" />
              </div>
            ) : conversations.length === 0 ? (
              <div className="py-8 text-center text-[11px] text-theme-muted italic">No conversations yet</div>
            ) : (
              conversations.map(c => {
                const isActive = conversationIdRef.current === c.id;
                const isLoading = loadingConvId === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => loadConversation(c.id)}
                    disabled={isLoading}
                    className={clsx(
                      'w-full text-left px-3 py-2.5 rounded-xl transition-colors group',
                      isActive ? 'bg-primary/10' : 'hover:bg-theme-hover/60',
                    )}
                  >
                    <div className="flex items-start gap-2">
                      {isLoading ? (
                        <Loader2 className="w-3.5 h-3.5 mt-0.5 shrink-0 animate-spin text-primary" />
                      ) : (
                        <MessageSquare className={clsx('w-3.5 h-3.5 mt-0.5 shrink-0', isActive ? 'text-primary' : 'text-theme-muted')} />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-theme-fg truncate">{c.title}</div>
                        <div className="text-[10px] text-theme-muted mt-0.5 flex items-center gap-1.5">
                          {c.message_count > 0 && <span>{c.message_count} msgs</span>}
                          {c.updated_at && <span>{formatTimeAgo(c.updated_at)}</span>}
                        </div>
                      </div>
                      {isActive && <span className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );

  const modelSelector = (
    <div className="relative" ref={modelPickerRef}>
      <button
        type="button"
        onClick={() => setShowModelPicker(v => !v)}
        className="dashboard-refresh-button inline-flex items-center gap-2 px-3 py-1.5 text-xs !rounded-xl"
      >
        {selectedModelMeta?.logoUrl && (
          <img src={selectedModelMeta.logoUrl} className="w-3.5 h-3.5 rounded" alt="" />
        )}
        <span className="max-w-[120px] truncate">
          {selectedModel === 'auto' ? 'Auto' : selectedModelMeta?.name || selectedModel.split('/').pop()}
        </span>
        <ChevronDown className="w-3 h-3 text-theme-muted" />
      </button>

      {showModelPicker && (
        <div
          className={clsx(
            'absolute z-50 max-h-72 w-72 overflow-y-auto scrollbar-none rounded-2xl border border-theme bg-theme-card shadow-elevate p-1',
            variant === 'workspace'
              ? 'bottom-full left-0 mb-2'
              : 'right-0 top-full mt-1',
          )}
        >
          <button
            type="button"
            onClick={() => { setSelectedModel('auto'); setShowModelPicker(false); }}
            className={clsx(
              'w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-sm rounded-xl hover:bg-theme-hover/60 transition-colors',
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
              type="button"
              key={m.id}
              onClick={() => { setSelectedModel(m.id); setShowModelPicker(false); }}
              className={clsx(
                'w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left hover:bg-theme-hover/60 transition-colors',
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
  );

  const composer = variant === 'workspace' ? (
    <div className="rounded-2xl border border-theme/10 bg-theme-card/30 transition-colors focus-within:border-primary/30">
      <textarea
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask, run, or build anything..."
        rows={1}
        className="w-full resize-none outline-none bg-transparent text-[13px] text-theme-fg placeholder:text-theme-muted/50 px-4 pt-3 pb-1 min-h-[38px] max-h-[120px] overflow-y-auto disabled:opacity-60"
        disabled={loading}
      />
      <div className="flex items-center justify-between gap-2 px-3 pb-2.5">
        <div className="flex items-center gap-1.5">
          {modelSelector}
          {historyButton}
          <span className={clsx('h-1.5 w-1.5 rounded-full ml-1', loading ? 'bg-amber-500 animate-pulse' : 'bg-green-500')} />
          {messages.length > 0 && (
            <button type="button" onClick={handleClear} className="p-1 rounded-lg text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60 transition-colors ml-1" title="Clear">
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          {loading && (
            <button
              type="button"
              onClick={handleStop}
              className="rounded-lg p-1.5 text-red-400 hover:bg-red-500/10 transition-colors"
              title="Stop"
            >
              <Square className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={sendMessage}
            disabled={!input.trim() || loading}
            className={clsx(
              'rounded-lg p-1.5 transition-colors',
              input.trim() && !loading
                ? 'bg-primary text-primary-fg hover:opacity-90'
                : 'text-theme-muted/30',
            )}
            title="Send (Enter)"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
    </div>
  ) : (
    <div className="dashboard-card-muted p-4 !rounded-2xl">
      <textarea
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Type a message to the VM agent..."
        rows={1}
        className="w-full resize-none outline-none max-h-32 bg-theme-hover/40 rounded-xl px-4 py-2.5 text-sm text-theme-fg placeholder-theme-muted/50 overflow-y-auto disabled:opacity-60"
        style={{ minHeight: '40px' }}
        disabled={loading}
      />
      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {modelSelector}
          {historyButton}
          <div className="dashboard-pill flex items-center gap-2 px-2.5 py-1.5 text-xs text-theme-muted">
            <span className={clsx('h-2 w-2 rounded-full', loading ? 'bg-amber-500 animate-pulse' : 'bg-green-500')} />
            {loading ? (statusMessage || (streamText ? 'Streaming' : 'Thinking')) : 'Agent ready'}
          </div>
          {messages.length > 0 && (
            <button type="button" onClick={handleClear} className="dashboard-refresh-button inline-flex items-center gap-2 px-2.5 py-1.5 text-xs !rounded-xl">
              <Trash2 className="w-3.5 h-3.5" /> Clear
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {loading && (
            <button
              type="button"
              onClick={handleStop}
              className="inline-flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
              title="Stop"
            >
              <Square className="w-4 h-4" /> Stop
            </button>
          )}
          <button
            type="button"
            onClick={sendMessage}
            disabled={!input.trim() || loading}
            className={clsx(
              'inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm transition-colors',
              input.trim() && !loading ? 'bg-primary text-primary-fg hover:opacity-90' : 'bg-theme-hover/40 text-theme-muted/40',
            )}
            title="Send"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Send
          </button>
        </div>
      </div>
    </div>
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

  if (variant === 'workspace') {
    return (
      <div className={clsx('flex h-full flex-col', className)}>
        <div ref={scrollRef} className="custom-scrollbar flex-1 min-h-0 overflow-y-auto">
          {messages.length === 0 && !loading ? (
            <div className="flex min-h-full items-end justify-center px-6 pb-8">
              <div className="w-full max-w-[680px]">
                <div className="text-center mb-8">
                  <div className="text-[10px] uppercase tracking-[0.22em] text-theme-muted font-medium">Cloud Agent</div>
                  <h2 className="mx-auto mt-4 max-w-[580px] text-2xl font-semibold tracking-tight text-theme-fg">
                    {greeting}, {displayName}
                  </h2>
                  <p className="mx-auto mt-2 max-w-[480px] text-[13px] leading-6 text-theme-muted">
                    Inspect files, run commands, deploy services, or ask anything.
                  </p>
                </div>

                <div className="mx-auto max-w-[640px]">
                  {composer}
                </div>

                <div className="flex justify-center gap-1.5 flex-wrap mt-4">
                  {quickPrompts.map(prompt => (
                    <button
                      type="button"
                      key={prompt}
                      onClick={() => applyPrompt(prompt)}
                      className="px-2.5 py-1.5 text-[11px] text-theme-muted hover:text-theme-fg rounded-lg hover:bg-theme-hover/60 transition-colors"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="px-6 py-5">
              <div className="mx-auto flex max-w-[760px] flex-col gap-4">
                {messages.map((msg) => (
                  <div key={msg.id} className="flex flex-col w-full">
                    {/* Trace panel for completed assistant messages */}
                    {msg.role === 'assistant' && (msg.reasoning || (msg.tools && msg.tools.length > 0)) && (
                      <StreamingTracePanel
                        reasoning={msg.reasoning || ''}
                        tools={msg.tools || []}
                        statusMessage=""
                        startTime={msg.timestamp - (msg.thinkDuration ? msg.thinkDuration * 1000 : 0)}
                        isStreaming={false}
                      />
                    )}
                    {/* GenUI tools for completed messages */}
                    {msg.role === 'assistant' && msg.tools?.filter(t => INTERACTIVE_TOOLS.has(t.tool) && t.args).map((tc, i) => (
                      <div key={`genui-${msg.id}-${i}`} className="max-w-[85%] ml-9 mb-2">
                        <GenUIErrorBoundary componentName={tc.tool}>
                          {tc.tool === 'ask_user' ? (
                            <AskUserPrompt
                              prompt={{ id: tc.id || `ask-${i}`, args: tc.args }}
                              onRespond={(id, result) => {
                                setGenUIResults(prev => ({ ...prev, [id]: result }));
                                submitVmToolResult(id, result);
                              }}
                            />
                          ) : (
                            <GenUIContainer
                              toolName={tc.tool}
                              args={tc.args}
                              isCompleted={tc.status === 'completed' || !!genUIResults[tc.id || `g-${i}`]}
                              result={genUIResults[tc.id || `g-${i}`] || tc.result}
                              onResult={(result) => {
                                const tid = tc.id || `g-${i}`;
                                setGenUIResults(prev => ({ ...prev, [tid]: result }));
                                submitVmToolResult(tid, result);
                              }}
                            />
                          )}
                        </GenUIErrorBoundary>
                      </div>
                    ))}
                    <div className={clsx('flex gap-2.5', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                      {msg.role === 'assistant' && (
                        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                          <Bot className="h-3.5 w-3.5 text-primary" />
                        </div>
                      )}
                      <div
                        className={clsx(
                          'max-w-[80%] rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed',
                          msg.role === 'user'
                            ? 'bg-primary/12 text-theme-fg whitespace-pre-wrap break-words'
                            : 'bg-theme-card/40 prose-vm text-theme-fg',
                        )}
                      >
                        {msg.role === 'assistant' ? renderMarkdown(msg.text) : msg.text}
                      </div>
                      {msg.role === 'user' && (
                        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-theme-hover/60">
                          <User className="h-3.5 w-3.5 text-theme-muted" />
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {/* Live streaming: trace panel, GenUI tools, text */}
                {loading && (
                  <>
                    {(streamReasoning || streamTools.length > 0 || !streamText) && (
                      <StreamingTracePanel
                        reasoning={streamReasoning}
                        tools={streamTools}
                        statusMessage={statusMessage}
                        startTime={streamStartRef.current}
                        isStreaming
                      />
                    )}
                    {/* Live GenUI tools */}
                    {streamTools.filter(t => INTERACTIVE_TOOLS.has(t.tool) && t.args).map((tc, i) => (
                      <div key={`live-genui-${i}`} className="max-w-[85%] ml-9 mb-2">
                        <GenUIErrorBoundary componentName={tc.tool}>
                          {tc.tool === 'ask_user' ? (
                            <AskUserPrompt
                              prompt={{ id: tc.id || `live-ask-${i}`, args: tc.args }}
                              onRespond={(id, result) => {
                                setGenUIResults(prev => ({ ...prev, [id]: result }));
                                submitVmToolResult(id, result);
                              }}
                            />
                          ) : (
                            <GenUIContainer
                              toolName={tc.tool}
                              args={tc.args}
                              isCompleted={!!genUIResults[tc.id || `live-g-${i}`]}
                              result={genUIResults[tc.id || `live-g-${i}`]}
                              onResult={(result) => {
                                const tid = tc.id || `live-g-${i}`;
                                setGenUIResults(prev => ({ ...prev, [tid]: result }));
                                submitVmToolResult(tid, result);
                              }}
                            />
                          )}
                        </GenUIErrorBoundary>
                      </div>
                    ))}
                    {streamText && (
                      <div className="flex gap-2.5 justify-start">
                        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                          <Bot className="h-3.5 w-3.5 text-primary" />
                        </div>
                        <div className="max-w-[80%] rounded-2xl px-4 py-2.5 text-[13px] bg-theme-card/40 text-theme-fg">
                          {renderMarkdown(streamText)}
                          <span className="inline-block w-[2px] h-3.5 bg-primary/50 ml-0.5 animate-[blink_1s_step-end_infinite] align-middle rounded-full" />
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {(messages.length > 0 || loading) && (
          <div className="px-6 pb-4 pt-3">
            <div className="mx-auto max-w-[820px]">
              {composer}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={clsx('flex flex-col rounded-2xl border border-theme/10 overflow-hidden', className)}>
      <div className="flex items-center gap-3 px-4 py-3 border-b border-theme/5 bg-theme-card/20">
        <Bot className="w-5 h-5 text-primary" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-theme-fg">VM Agent Chat</div>
          <div className="text-[10px] text-theme-muted">
            {engine?.instance_name || 'Cloud Engine'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {modelSelector}
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0 bg-theme-bg/30">
        <div className="px-4 py-3 space-y-4">
          {messages.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center py-16 text-theme-muted/40">
              <Bot className="w-10 h-10 mb-3" />
              <p className="text-sm font-semibold">Chat with your VM agent</p>
              <p className="text-xs mt-1">Send a message to test the agent running on {engine?.instance_name || 'your engine'}</p>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} className="flex flex-col w-full gap-1">
              {msg.role === 'assistant' && (msg.reasoning || (msg.tools && msg.tools.length > 0)) && (
                <StreamingTracePanel
                  reasoning={msg.reasoning || ''}
                  tools={msg.tools || []}
                  statusMessage=""
                  startTime={msg.timestamp - (msg.thinkDuration ? msg.thinkDuration * 1000 : 0)}
                  isStreaming={false}
                />
              )}
              {/* GenUI tools */}
              {msg.role === 'assistant' && msg.tools?.filter(t => INTERACTIVE_TOOLS.has(t.tool) && t.args).map((tc, i) => (
                <div key={`genui-${msg.id}-${i}`} className="max-w-[85%] ml-9 mb-1">
                  <GenUIErrorBoundary componentName={tc.tool}>
                    {tc.tool === 'ask_user' ? (
                      <AskUserPrompt
                        prompt={{ id: tc.id || `ask-${i}`, args: tc.args }}
                        onRespond={(id, result) => {
                          setGenUIResults(prev => ({ ...prev, [id]: result }));
                          submitVmToolResult(id, result);
                        }}
                      />
                    ) : (
                      <GenUIContainer
                        toolName={tc.tool}
                        args={tc.args}
                        isCompleted={tc.status === 'completed' || !!genUIResults[tc.id || `g-${i}`]}
                        result={genUIResults[tc.id || `g-${i}`] || tc.result}
                        onResult={(result) => {
                          const tid = tc.id || `g-${i}`;
                          setGenUIResults(prev => ({ ...prev, [tid]: result }));
                          submitVmToolResult(tid, result);
                        }}
                      />
                    )}
                  </GenUIErrorBoundary>
                </div>
              ))}
              <div className={clsx('flex gap-2.5', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
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
            </div>
          ))}

          {loading && (
            <>
              {(streamReasoning || streamTools.length > 0 || !streamText) && (
                <StreamingTracePanel
                  reasoning={streamReasoning}
                  tools={streamTools}
                  statusMessage={statusMessage}
                  startTime={streamStartRef.current}
                  isStreaming
                />
              )}
              {streamTools.filter(t => INTERACTIVE_TOOLS.has(t.tool) && t.args).map((tc, i) => (
                <div key={`live-genui-d-${i}`} className="max-w-[85%] ml-9 mb-1">
                  <GenUIErrorBoundary componentName={tc.tool}>
                    {tc.tool === 'ask_user' ? (
                      <AskUserPrompt
                        prompt={{ id: tc.id || `live-ask-${i}`, args: tc.args }}
                        onRespond={(id, result) => {
                          setGenUIResults(prev => ({ ...prev, [id]: result }));
                          submitVmToolResult(id, result);
                        }}
                      />
                    ) : (
                      <GenUIContainer
                        toolName={tc.tool}
                        args={tc.args}
                        isCompleted={!!genUIResults[tc.id || `live-g-${i}`]}
                        result={genUIResults[tc.id || `live-g-${i}`]}
                        onResult={(result) => {
                          const tid = tc.id || `live-g-${i}`;
                          setGenUIResults(prev => ({ ...prev, [tid]: result }));
                          submitVmToolResult(tid, result);
                        }}
                      />
                    )}
                  </GenUIErrorBoundary>
                </div>
              ))}
              {streamText && (
                <div className="flex gap-2.5 justify-start">
                  <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <Bot className="w-4 h-4 text-primary" />
                  </div>
                  <div className="max-w-[85%] rounded-2xl px-4 py-2.5 text-sm bg-theme-card/50 border border-theme/5 text-theme-fg">
                    {renderMarkdown(streamText)}
                    <span className="inline-block w-[2px] h-3.5 bg-primary/50 ml-0.5 animate-[blink_1s_step-end_infinite] align-middle rounded-full" />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="border-t border-theme/5 px-4 py-3 bg-theme-card/10">
        {composer}
      </div>
    </div>
  );
}
