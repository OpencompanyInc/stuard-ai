import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import {
  Send, Loader2, Trash2, Bot, WifiOff,
  Check, ChevronDown, MessageSquare, Plus, Clock, X, Square, Search,
  Paperclip, File as FileIcon, AlertCircle,
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useModelRegistry } from '../hooks/useModelRegistry';
import { useCloudEngine } from '../hooks/useCloudEngine';
import type { ModelMeta } from '../hooks/usePreferences';
import { mergeStreamingText } from '../utils/streamMerge';
import MessageBubble from './MessageBubble';
import { AskUserPrompt } from './chat-view/AskUserPrompt';
import { appendReasoningChunk, appendTextChunk, applyToolCallUpdate } from '../../../../../shared/chat-ui/streamState';
import type { Message as ChatMessage, StreamChunk, ToolCall as VmToolCall } from '../../../../../shared/chat-ui/types';

const CLOUD_AI_HTTP = ((window as any).__CLOUD_AI_HTTP__ || (import.meta as any).env?.VITE_CLOUD_AI_URL || 'http://127.0.0.1:8082').replace(/\/+$/, '');

interface ConversationEntry {
  id: string;
  title: string;
  updated_at: string;
  message_count: number;
}

interface VmChatAttachment {
  id: string;
  name: string;
  path: string;
  size: number;
  mimeType?: string;
  uploading: boolean;
  error?: string;
  /** True when the user picked an existing VM file (no upload needed). */
  existing?: boolean;
}

async function vmRelay(path: string, body?: any, method = 'POST', options?: { timeoutMs?: number }): Promise<any> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token || '';
    const resp = await fetch(`${CLOUD_AI_HTTP}/v1/vm/relay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ path, method, body, timeoutMs: options?.timeoutMs }),
    });
    return await resp.json();
  } catch {
    return { ok: false, error: 'relay_failed' };
  }
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
  const [modelSearch, setModelSearch] = useState('');
  const [displayName, setDisplayName] = useState('there');
  const conversationIdRef = useRef<string | null>(null);
  const conversationTitleRef = useRef<string>('');
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const modelSearchRef = useRef<HTMLInputElement>(null);

  // Streaming state
  const [streamText, setStreamText] = useState('');
  const [streamReasoning, setStreamReasoning] = useState('');
  const [streamTools, setStreamTools] = useState<VmToolCall[]>([]);
  const [streamChunks, setStreamChunks] = useState<StreamChunk[]>([]);
  const streamStartRef = useRef<number>(0);

  // ask_user inline prompts (rendered outside MessageBubble — bubble hides ask_user)
  const [askUserPrompts, setAskUserPrompts] = useState<Array<{ id: string; args: any; status: 'pending' | 'completed' }>>([]);

  // Pending attachments for the next outgoing message (uploaded to VM before send)
  const [pendingAttachments, setPendingAttachments] = useState<VmChatAttachment[]>([]);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);

  // File helpers from the cloud-engine hook so CloudVmChat can upload user
  // selected files into the VM workspace and reference them in messages.
  const { uploadFileToVm: uploadFileToVmApi } = useCloudEngine();

  // Chat history state
  const [conversations, setConversations] = useState<ConversationEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [loadingConvId, setLoadingConvId] = useState<string | null>(null);
  const historyPanelRef = useRef<HTMLDivElement>(null);

  const upsertConversationEntry = useCallback((conversation: Partial<ConversationEntry> & { id: string; incrementMessageCountBy?: number }) => {
    setConversations((prev) => {
      const existing = prev.find((entry) => entry.id === conversation.id);
      const nextEntry: ConversationEntry = {
        id: conversation.id,
        title: conversation.title || existing?.title || 'Untitled',
        updated_at: conversation.updated_at || new Date().toISOString(),
        message_count: conversation.message_count
          ?? Math.max(0, (existing?.message_count || 0) + (conversation.incrementMessageCountBy || 0)),
      };

      const next = existing
        ? prev.map((entry) => (entry.id === conversation.id ? { ...entry, ...nextEntry } : entry))
        : [nextEntry, ...prev];

      return next
        .sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime())
        .slice(0, 30);
    });
  }, []);

  const { models, modelById } = useModelRegistry();
  const isRunning = engine?.status === 'running';

  const selectedModelMeta = useMemo(() => {
    if (selectedModel === 'auto') return null;
    return models.find((m) => m.id === selectedModel) || null;
  }, [selectedModel, models]);

  const filteredModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    if (!query) return models;

    return models.filter((model) => {
      const haystack = [
        model.name,
        model.provider,
        model.id,
        model.category,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [modelSearch, models]);

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

  useEffect(() => {
    if (!showModelPicker) {
      setModelSearch('');
      return;
    }

    const timeout = window.setTimeout(() => modelSearchRef.current?.focus(), 40);
    return () => window.clearTimeout(timeout);
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

  // Fetch conversation history — query all sources in parallel and merge.
  // Always preserves any in-memory entries (e.g. a just-sent chat) that the
  // backends haven't indexed yet, so the list never flashes empty after a send.
  const fetchHistory = useCallback(async () => {
    if (!isRunning) return;
    setHistoryLoading(true);
    try {
      const sessionRes = await supabase.auth.getSession().catch(() => null);
      const token = sessionRes?.data?.session?.access_token || '';

      const [vmRes, cloudRes, supaRes] = await Promise.all([
        vmRelay('/memory/conversations_list', { limit: 30 }, 'POST', { timeoutMs: 4_000 })
          .catch(() => null),
        fetch(`${CLOUD_AI_HTTP}/v1/memory/conversations?limit=30&status=active`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
          .then((r) => r.json())
          .catch(() => null),
        (async () => {
          try {
            return await supabase
              .from('conversations')
              .select('id, title, created_at, updated_at, message_count, source')
              .neq('source', 'workflow')
              .order('updated_at', { ascending: false })
              .limit(30);
          } catch {
            return null;
          }
        })(),
      ]);

      const sources: any[][] = [];
      // Relay wraps as {ok,status,result: <vmBody>}; VM wraps as {ok, result: <handlerReturn>};
      // handler returns {ok, conversations}. So the real list is at result.result.conversations.
      const vmList = vmRes?.result?.result?.conversations
        || vmRes?.result?.conversations
        || vmRes?.conversations;
      if (Array.isArray(vmList)) sources.push(vmList);
      if (cloudRes?.ok && Array.isArray(cloudRes.conversations)) sources.push(cloudRes.conversations);
      if (supaRes && !supaRes.error && Array.isArray(supaRes.data)) sources.push(supaRes.data);

      const byId = new Map<string, ConversationEntry>();
      for (const list of sources) {
        for (const c of list) {
          if (!c || c.source === 'workflow') continue;
          const id = c.id || c.conversation_id;
          if (!id) continue;
          const entry: ConversationEntry = {
            id,
            title: c.title || 'Untitled',
            updated_at: c.updated_at || c.created_at || '',
            message_count: c.message_count || 0,
          };
          const existing = byId.get(id);
          if (!existing) {
            byId.set(id, entry);
            continue;
          }
          // Merge: prefer non-default title, keep max message_count, newest updated_at.
          const mergedTitle = existing.title && existing.title !== 'Untitled' ? existing.title : entry.title;
          const mergedUpdated = new Date(entry.updated_at || 0) > new Date(existing.updated_at || 0)
            ? entry.updated_at
            : existing.updated_at;
          byId.set(id, {
            id,
            title: mergedTitle,
            updated_at: mergedUpdated,
            message_count: Math.max(existing.message_count, entry.message_count),
          });
        }
      }

      setConversations((prev) => {
        // Preserve any local/optimistic entries not yet in any backend source.
        for (const local of prev) {
          if (!byId.has(local.id)) byId.set(local.id, local);
        }
        return Array.from(byId.values())
          .sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime())
          .slice(0, 30);
      });
    } catch { /* silent */ }
    setHistoryLoading(false);
  }, [isRunning]);

  useEffect(() => {
    if (isRunning && showHistory) {
      void fetchHistory();
    }
  }, [isRunning, showHistory, fetchHistory]);

  // Load a conversation from history — try VM relay, then cloud-ai, then Supabase
  const loadConversation = useCallback(async (convId: string) => {
    setLoadingConvId(convId);
    let rawMsgs: any[] = [];

    try {
      // 1. VM relay (Python agent DB) — double-wrapped: relay{result} → VM{result} → handler{messages}
      const res = await vmRelay('/memory/messages_list', { conversation_id: convId, limit: 100 }, 'POST', { timeoutMs: 5_000 });
      rawMsgs = res?.result?.result?.messages || res?.result?.messages || res?.messages || [];

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
        setStreamText('');
        setStreamReasoning('');
        setStreamTools([]);
        setStreamChunks([]);
        setAskUserPrompts([]);
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
    setStreamText('');
    setStreamReasoning('');
    setStreamTools([]);
    setStreamChunks([]);
    setAskUserPrompts([]);
    setPendingAttachments([]);
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
  }, [messages, loading, streamText, streamReasoning, streamTools, streamChunks, scrollToBottom]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || loading || !isRunning) return;
    if (pendingAttachments.some(a => a.uploading)) return;

    const readyAttachments = pendingAttachments.filter(a => !a.error && !a.uploading);

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      text,
      timestamp: Date.now(),
      attachments: readyAttachments.length > 0
        ? readyAttachments.map(a => ({
            type: 'file' as const,
            name: a.name,
            path: a.path,
            mimeType: a.mimeType,
            source: 'picker' as const,
          }))
        : undefined,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setPendingAttachments([]);
    setLoading(true);
    setStreamText('');
    setStreamReasoning('');
    setStreamTools([]);
    setStreamChunks([]);
    streamStartRef.current = Date.now();

    const abort = new AbortController();
    abortRef.current = abort;

    let accText = '';
    let accReasoning = '';
    let accTools: VmToolCall[] = [];
    let accChunks: StreamChunk[] = [];

    const normalizeToolStatus = (status: string | undefined): VmToolCall['status'] => {
      switch (String(status || '').toLowerCase()) {
        case 'completed':
        case 'result':
        case 'step_completed':
          return 'completed';
        case 'error':
        case 'failed':
        case 'timeout':
        case 'step_error':
          return 'error';
        case 'running':
        case 'started':
        case 'step_started':
          return 'running';
        default:
          return 'called';
      }
    };

    const pushText = (chunk: string) => {
      if (!chunk) return;
      accText = mergeStreamingText(accText, chunk);
      accChunks = appendTextChunk(accChunks, chunk);
      setStreamText(accText);
      setStreamChunks([...accChunks]);
    };

    const pushReasoning = (chunk: string, nested = false) => {
      if (!chunk) return;
      if (!nested) {
        accReasoning = mergeStreamingText(accReasoning, chunk);
        setStreamReasoning(accReasoning);
      }
      accChunks = appendReasoningChunk(accChunks, chunk, nested);
      setStreamChunks([...accChunks]);
    };

    const pushTool = (tool: VmToolCall) => {
      const next = applyToolCallUpdate(accTools, accChunks, {
        ...tool,
        timestamp: tool.timestamp || Date.now(),
      });
      accTools = next.toolCalls;
      accChunks = next.streamChunks;
      setStreamTools([...accTools]);
      setStreamChunks([...accChunks]);
    };

    // ask_user dedup: only one pending prompt at a time. If the server sends
    // a real id, match by id; otherwise treat any pending prompt as the match
    // so tool_request + tool_event for the same call don't render twice.
    const upsertAskUserPrompt = (id: string, args: any) => {
      setAskUserPrompts((prev) => {
        const byId = id ? prev.find((p) => p.id === id) : undefined;
        const byPending = byId ? undefined : prev.find((p) => p.status === 'pending');
        const match = byId || byPending;
        if (match) {
          return prev.map((p) => (p === match
            ? { ...p, id: id || p.id, args }
            : p));
        }
        return [...prev, { id: id || `ask-${Date.now()}`, args, status: 'pending' }];
      });
    };
    const completeAskUserPrompt = (id: string) => {
      setAskUserPrompts((prev) => prev.map((p) => {
        const matches = id ? p.id === id : p.status === 'pending';
        return matches ? { ...p, status: 'completed' as const } : p;
      }));
    };

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

      const attachmentsPayload = readyAttachments.length > 0
        ? readyAttachments.map(a => ({
            type: 'file',
            name: a.name,
            path: a.path,
            mimeType: a.mimeType,
            size: a.size,
            source: 'vm',
          }))
        : undefined;
      const contextPayload = readyAttachments.length > 0
        ? { paths: readyAttachments.map(a => ({ path: a.path, name: a.name, isDirectory: false })) }
        : undefined;

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
          attachments: attachmentsPayload,
          context: contextPayload,
        }),
        signal: abort.signal,
      });

      const contentType = resp.headers.get('content-type') || '';

      if (contentType.includes('text/event-stream') && resp.body) {
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
                  pushText(d.text || '');
                } else if (ev === 'reasoning' || ev === 'reasoning_start') {
                  pushReasoning(d.text || '');
                }
                break;
              }
              case 'tool_event': {
                const toolName = event.tool || event.data?.tool || '';
                const toolStatus = event.status || event.data?.status || '';
                const toolData = event.data || {};
                const toolId = toolData.id || toolData.toolCallId || event.id || '';
                if (toolName) {
                  const normalizedStatus = normalizeToolStatus(toolStatus);
                  const resolvedArgs = toolData.args ?? ((normalizedStatus === 'called' || normalizedStatus === 'running') ? toolData : undefined);
                  pushTool({
                    id: toolId,
                    tool: toolName,
                    status: normalizedStatus,
                    args: resolvedArgs,
                    result: toolData.result ?? (normalizedStatus === 'completed' ? toolData : undefined),
                    error: toolData.error ?? (normalizedStatus === 'error' ? toolData : undefined),
                    liveOutput: typeof toolData.liveOutput === 'string'
                      ? toolData.liveOutput
                      : typeof toolData.output === 'string'
                        ? toolData.output
                        : undefined,
                    timestamp: Date.now(),
                  });
                  if (toolName === 'ask_user' && resolvedArgs && (normalizedStatus === 'called' || normalizedStatus === 'running')) {
                    upsertAskUserPrompt(toolId, resolvedArgs);
                  } else if (toolName === 'ask_user' && (normalizedStatus === 'completed' || normalizedStatus === 'error')) {
                    completeAskUserPrompt(toolId);
                  }
                }
                break;
              }
              case 'tool_request': {
                const toolName = event.tool || '';
                const toolArgs = event.args || {};
                const toolId = event.id || '';
                if (toolName) {
                  pushTool({
                    id: toolId,
                    tool: toolName,
                    status: 'called',
                    args: toolArgs,
                    timestamp: Date.now(),
                  });
                  if (toolName === 'ask_user' && toolArgs) {
                    upsertAskUserPrompt(toolId, toolArgs);
                  }
                }
                break;
              }
              case 'subagent_event': {
                const subEvent = event.event || '';
                const subData = event.data || {};
                const subagentId = event.subagentId || subData.subagentId || '';

                if (subEvent === 'delta' && subData.text) {
                  pushText(subData.text);
                } else if ((subEvent === 'reasoning' || subEvent === 'reasoning_start') && subData.text) {
                  pushReasoning(subData.text, true);
                } else if (subEvent === 'tool_call') {
                  pushTool({
                    id: subData.toolCallId || subData.id || `${subagentId || 'subagent'}-${subData.tool || subData.name || 'tool'}`,
                    tool: subData.tool || subData.name || 'tool',
                    status: 'called',
                    args: subData.args,
                    timestamp: Date.now(),
                    subagentId: subagentId || undefined,
                    nested: true,
                  });
                } else if (subEvent === 'tool_result') {
                  pushTool({
                    id: subData.toolCallId || subData.id || `${subagentId || 'subagent'}-${subData.tool || subData.name || 'tool'}`,
                    tool: subData.tool || subData.name || 'tool',
                    status: subData.error ? 'error' : 'completed',
                    result: subData.result,
                    error: subData.error,
                    timestamp: Date.now(),
                    subagentId: subagentId || undefined,
                    nested: true,
                  });
                }
                break;
              }
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
                    upsertConversationEntry({
                      id: cid,
                      title: event.title,
                      updated_at: new Date().toISOString(),
                    });
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
            toolCalls: accTools.length > 0 ? accTools : undefined,
            streamChunks: accChunks.length > 0 ? accChunks : undefined,
            reasoningDuration: thinkDuration,
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
      const activeConversationId = conversationIdRef.current;
      if (activeConversationId) {
        const fallbackTitle = (conversationTitleRef.current || text.slice(0, 80) || 'Untitled').trim();
        conversationTitleRef.current = fallbackTitle;
        upsertConversationEntry({
          id: activeConversationId,
          title: fallbackTitle,
          updated_at: new Date().toISOString(),
          incrementMessageCountBy: 2,
        });
      }

      setLoading(false);
      setStreamText('');
      setStreamReasoning('');
      setStreamTools([]);
      setStreamChunks([]);
      abortRef.current = null;
      if (showHistory) {
        void fetchHistory();
      }
    }
  }, [input, loading, isRunning, selectedModel, modelById, fetchHistory, showHistory, upsertConversationEntry, pendingAttachments]);

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
    setStreamChunks([]);
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

  const handleAskUserRespond = useCallback((id: string, result: any) => {
    setAskUserPrompts((prev) => prev.map((p) => p.id === id ? { ...p, status: 'completed' as const } : p));
    void submitVmToolResult(id, result);
  }, [submitVmToolResult]);

  const handleClear = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setLoading(false);
    setStreamText('');
    setStreamReasoning('');
    setStreamTools([]);
    setStreamChunks([]);
    setAskUserPrompts([]);
    setPendingAttachments([]);
    conversationIdRef.current = null;
    conversationTitleRef.current = '';
  }, []);

  const applyPrompt = useCallback((text: string) => {
    setInput(text);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const handleAttachClick = useCallback(() => {
    if (!isRunning) return;
    attachmentInputRef.current?.click();
  }, [isRunning]);

  const removePendingAttachment = useCallback((id: string) => {
    setPendingAttachments(prev => prev.filter(a => a.id !== id));
  }, []);

  const handleAttachmentFilesSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const picked = Array.from(input.files || []);
    input.value = '';
    if (picked.length === 0 || !uploadFileToVmApi) return;

    // Each chat gets its own folder on the VM under chat-uploads/
    const convFolder = conversationIdRef.current || 'pending';
    const stamp = Date.now();

    const placeholders: VmChatAttachment[] = picked.map((file, idx) => ({
      id: `att-${stamp}-${idx}`,
      name: file.name,
      path: `chat-uploads/${convFolder}/${stamp}-${file.name}`,
      size: file.size,
      mimeType: file.type || undefined,
      uploading: true,
    }));

    setPendingAttachments(prev => [...prev, ...placeholders]);

    for (let i = 0; i < picked.length; i++) {
      const file = picked[i];
      const placeholder = placeholders[i];
      try {
        const res = await uploadFileToVmApi(placeholder.path, file);
        setPendingAttachments(prev => prev.map(a => {
          if (a.id !== placeholder.id) return a;
          if (!res.ok) {
            return { ...a, uploading: false, error: res.error || 'upload_failed' };
          }
          return { ...a, uploading: false };
        }));
      } catch (err: any) {
        setPendingAttachments(prev => prev.map(a =>
          a.id === placeholder.id
            ? { ...a, uploading: false, error: err?.message || 'upload_failed' }
            : a,
        ));
      }
    }
  }, [uploadFileToVmApi]);

  /** Add an existing VM file (picked from the file navigator) as a chat
   *  attachment without re-uploading it. */
  const attachExistingVmFile = useCallback((entry: { path: string; name: string; size?: number }) => {
    setPendingAttachments(prev => {
      if (prev.some(a => a.path === entry.path)) return prev;
      return [
        ...prev,
        {
          id: `ext-${Date.now()}-${entry.path}`,
          name: entry.name || entry.path.split('/').pop() || entry.path,
          path: entry.path,
          size: entry.size || 0,
          uploading: false,
          existing: true,
        },
      ];
    });
  }, []);

  // Expose the picker so the cloud file navigator can push files into the
  // active VM chat (desktop:openChat-like flow in the dashboard).
  useEffect(() => {
    (window as any).__cloudVmChatAttach = attachExistingVmFile;
    return () => {
      if ((window as any).__cloudVmChatAttach === attachExistingVmFile) {
        delete (window as any).__cloudVmChatAttach;
      }
    };
  }, [attachExistingVmFile]);

  const handleGenUIResponse = useCallback((component: string, result: any) => {
    void submitVmToolResult(component, result);
  }, [submitVmToolResult]);

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
        onClick={() => {
          setShowHistory((open) => {
            const next = !open;
            if (next) {
              void fetchHistory();
            }
            return next;
          });
        }}
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
            'absolute z-50 w-72 overflow-hidden rounded-2xl border border-theme bg-theme-card shadow-elevate',
            variant === 'workspace'
              ? 'bottom-full left-0 mb-2'
              : 'right-0 top-full mt-1',
          )}
        >
          <div className="border-b border-theme/10 px-3 py-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-theme-muted" />
              <input
                ref={modelSearchRef}
                type="text"
                value={modelSearch}
                onChange={(e) => setModelSearch(e.target.value)}
                placeholder="Search models..."
                className="w-full rounded-xl border border-theme/10 bg-theme-hover/40 py-2 pl-9 pr-3 text-xs text-theme-fg outline-none transition-colors placeholder:text-theme-muted/70 focus:border-primary/30 focus:bg-theme-hover/60"
              />
            </div>
          </div>

          <div className="max-h-72 overflow-y-auto scrollbar-none p-1">
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

          {filteredModels.map((m) => (
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

          {filteredModels.length === 0 && (
            <div className="px-3 py-8 text-center">
              <div className="text-xs font-medium text-theme-fg">No models found</div>
              <div className="mt-1 text-[10px] text-theme-muted">
                Try a provider, tier, or model ID.
              </div>
            </div>
          )}
          </div>
        </div>
      )}
    </div>
  );

  const hasPending = pendingAttachments.length > 0;
  const isUploadingAny = pendingAttachments.some(a => a.uploading);

  const attachmentChips = hasPending ? (
    <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2">
      {pendingAttachments.map(a => (
        <span
          key={a.id}
          className={clsx(
            'inline-flex items-center gap-1.5 max-w-[220px] rounded-lg border px-2 py-1 text-[10.5px]',
            a.error
              ? 'border-red-500/30 bg-red-500/10 text-red-400'
              : a.uploading
                ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                : 'border-theme/20 bg-theme-hover/50 text-theme-fg',
          )}
          title={a.error ? a.error : a.path}
        >
          {a.error ? (
            <AlertCircle className="w-3 h-3 shrink-0" />
          ) : a.uploading ? (
            <Loader2 className="w-3 h-3 shrink-0 animate-spin" />
          ) : (
            <FileIcon className="w-3 h-3 shrink-0" />
          )}
          <span className="truncate font-medium">{a.name}</span>
          {a.existing && (
            <span className="text-[9px] uppercase tracking-wide opacity-60">vm</span>
          )}
          <button
            type="button"
            onClick={() => removePendingAttachment(a.id)}
            className="ml-0.5 rounded text-theme-muted hover:text-theme-fg"
            title="Remove attachment"
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
    </div>
  ) : null;

  const attachmentPickerInput = uploadFileToVmApi ? (
    <input
      ref={attachmentInputRef}
      type="file"
      multiple
      onChange={handleAttachmentFilesSelected}
      className="hidden"
    />
  ) : null;

  const composer = variant === 'workspace' ? (
    <div className="rounded-2xl border border-theme/10 bg-theme-card/30 transition-colors focus-within:border-primary/30">
      {attachmentChips}
      <textarea
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask, run, or build anything..."
        rows={1}
        className="w-full resize-none outline-none bg-transparent text-[13px] text-theme-fg placeholder:text-theme-muted/50 px-4 pt-3 pb-1 min-h-[38px] max-h-[120px] overflow-y-auto scrollbar-none disabled:opacity-60"
        style={{ scrollbarWidth: 'none' }}
        disabled={loading}
      />
      {attachmentPickerInput}
      <div className="flex items-center justify-between gap-2 px-3 pb-2.5">
        <div className="flex items-center gap-1.5">
          {uploadFileToVmApi && (
            <button
              type="button"
              onClick={handleAttachClick}
              disabled={loading || !isRunning}
              className="p-1 rounded-lg text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60 transition-colors disabled:opacity-40"
              title="Attach files to this VM chat"
            >
              <Paperclip className="w-3.5 h-3.5" />
            </button>
          )}
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
            disabled={!input.trim() || loading || isUploadingAny}
            className={clsx(
              'rounded-lg p-1.5 transition-colors',
              input.trim() && !loading && !isUploadingAny
                ? 'bg-primary text-primary-fg hover:opacity-90'
                : 'text-theme-muted/30',
            )}
            title={isUploadingAny ? 'Uploading attachments...' : 'Send (Enter)'}
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
    </div>
  ) : (
    <div className="dashboard-card-muted p-4 !rounded-2xl">
      {attachmentChips}
      <textarea
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Type a message to the VM agent..."
        rows={1}
        className="w-full resize-none outline-none max-h-32 bg-theme-hover/40 rounded-xl px-4 py-2.5 text-sm text-theme-fg placeholder-theme-muted/50 overflow-y-auto scrollbar-none disabled:opacity-60"
        style={{ minHeight: '40px', scrollbarWidth: 'none' }}
        disabled={loading}
      />
      {attachmentPickerInput}
      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {uploadFileToVmApi && (
            <button
              type="button"
              onClick={handleAttachClick}
              disabled={loading || !isRunning}
              className="dashboard-refresh-button inline-flex items-center gap-2 px-2.5 py-1.5 text-xs !rounded-xl disabled:opacity-40"
              title="Attach files to this VM chat"
            >
              <Paperclip className="w-3.5 h-3.5" /> Attach
            </button>
          )}
          {modelSelector}
          {historyButton}
          <div className="dashboard-pill flex items-center gap-2 px-2.5 py-1.5 text-xs text-theme-muted">
            <span className={clsx('h-2 w-2 rounded-full', loading ? 'bg-amber-500 animate-pulse' : 'bg-green-500')} />
            {loading ? (streamText ? 'Streaming' : 'Thinking') : 'Agent ready'}
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
            disabled={!input.trim() || loading || isUploadingAny}
            className={clsx(
              'inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm transition-colors',
              input.trim() && !loading && !isUploadingAny ? 'bg-primary text-primary-fg hover:opacity-90' : 'bg-theme-hover/40 text-theme-muted/40',
            )}
            title={isUploadingAny ? 'Uploading attachments...' : 'Send'}
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
                  <MessageBubble
                    key={msg.id}
                    role={msg.role === 'assistant' ? 'assistant' : 'user'}
                    text={msg.text}
                    reasoning={msg.reasoning}
                    reasoningDuration={msg.reasoningDuration}
                    toolCalls={msg.toolCalls as any}
                    streamChunks={msg.streamChunks as any}
                    attachments={msg.attachments}
                    onSubmitToolOutput={submitVmToolResult}
                    onGenUIResponse={handleGenUIResponse}
                  />
                ))}

                {loading && (
                  <MessageBubble
                    role="assistant"
                    text={streamText}
                    reasoning={streamReasoning || undefined}
                    toolCalls={streamTools as any}
                    streamChunks={streamChunks as any}
                    isStreaming
                    onSubmitToolOutput={submitVmToolResult}
                    onGenUIResponse={handleGenUIResponse}
                  />
                )}

                {askUserPrompts.filter((p) => p.status === 'pending').map((p) => (
                  <AskUserPrompt key={p.id} prompt={{ id: p.id, args: p.args }} onRespond={handleAskUserRespond} />
                ))}
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
            <MessageBubble
              key={msg.id}
              role={msg.role === 'assistant' ? 'assistant' : 'user'}
              text={msg.text}
              reasoning={msg.reasoning}
              reasoningDuration={msg.reasoningDuration}
              toolCalls={msg.toolCalls as any}
              streamChunks={msg.streamChunks as any}
              attachments={msg.attachments}
              onSubmitToolOutput={submitVmToolResult}
              onGenUIResponse={handleGenUIResponse}
            />
          ))}

          {loading && (
            <MessageBubble
              role="assistant"
              text={streamText}
              reasoning={streamReasoning || undefined}
              toolCalls={streamTools as any}
              streamChunks={streamChunks as any}
              isStreaming
              onSubmitToolOutput={submitVmToolResult}
              onGenUIResponse={handleGenUIResponse}
            />
          )}

          {askUserPrompts.filter((p) => p.status === 'pending').map((p) => (
            <AskUserPrompt key={p.id} prompt={{ id: p.id, args: p.args }} onRespond={handleAskUserRespond} />
          ))}
        </div>
      </div>

      <div className="border-t border-theme/5 px-4 py-3 bg-theme-card/10">
        {composer}
      </div>
    </div>
  );
}
