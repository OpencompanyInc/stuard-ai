import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import {
  Send, Loader2, Trash2, Bot, WifiOff,
  Check, ChevronDown, MessageSquare, Plus, Clock, X, Square, Search,
  Paperclip, File as FileIcon, AlertCircle,
} from 'lucide-react';
import { mergeStreamingText } from '@stuardai/chat-ui/streamMerge';
import { displayConversationTitle, isPlaceholderConversationTitle } from '@stuardai/chat-ui';
import { AskUserPrompt } from '@stuardai/chat-ui/AskUserPrompt';
import { appendReasoningChunk, appendTextChunk, applyToolCallUpdate } from '@stuardai/chat-ui/streamState';
import type { Message as ChatMessage, StreamChunk, ToolCall as VmToolCall } from '@stuardai/chat-ui/types';
import type { VmChatProps, VmConversationEntry } from './types';
import { createPortableVmMessageRenderer } from './messageRenderer';

type ConversationEntry = VmConversationEntry;

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

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function extractFinalText(event: any, fallback = ''): string {
  const result = event?.result;
  const nested = result?.result;
  return firstText(
    event?.text,
    event?.response,
    event?.message,
    event?.content,
    event?.data?.text,
    event?.data?.response,
    event?.data?.message,
    event?.data?.content,
    result?.text,
    result?.response,
    result?.message,
    result?.content,
    result?.output,
    nested?.text,
    nested?.response,
    nested?.message,
    nested?.content,
    nested?.output,
    fallback,
  );
}

function fallbackNoAssistantText(reason?: string): string {
  return reason
    ? `The VM stream ended without assistant text (${reason}).`
    : 'The VM stream ended without assistant text.';
}

export function VmChat({
  engine,
  platform,
  MessageRenderer,
  ModelLogo,
  models,
  modelById,
  className,
  variant = 'default',
  renderInteractiveTool,
}: VmChatProps) {
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

  // Chat history state
  const [conversations, setConversations] = useState<ConversationEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [loadingConvId, setLoadingConvId] = useState<string | null>(null);
  const historyPanelRef = useRef<HTMLDivElement>(null);
  const [historyMaxHeight, setHistoryMaxHeight] = useState(384);

  const upsertConversationEntry = useCallback((conversation: Partial<ConversationEntry> & { id: string; incrementMessageCountBy?: number }) => {
    setConversations((prev) => {
      const existing = prev.find((entry) => entry.id === conversation.id);
      const nextEntry: ConversationEntry = {
        id: conversation.id,
        title: displayConversationTitle(conversation.title || existing?.title),
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

  const isRunning = engine?.status === 'running';

  // ── VM agent readiness ──────────────────────────────────────────────────
  // engine.status === 'running' only means the instance booted — the agent's
  // HTTP server on :7400 may still be coming up while desktop data finishes
  // syncing. When the platform can probe readiness, gate sending on it so a
  // message isn't fired into a half-started VM, and surface a clear "finishing
  // startup" state. Send unlocks the instant the agent answers. Fail-open after
  // a grace window so a missing/slow status endpoint can never lock the input.
  const hasReadyProbe = typeof platform.checkReady === 'function';
  const [agentReady, setAgentReady] = useState(false);
  const [readyNonce, setReadyNonce] = useState(0);
  const vmReady = isRunning && (hasReadyProbe ? agentReady : true);
  const vmStarting = isRunning && hasReadyProbe && !agentReady;

  useEffect(() => {
    if (!isRunning || !hasReadyProbe) {
      setAgentReady(false);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();
    const probe = async () => {
      if (cancelled) return;
      let ok = false;
      try { ok = await platform.checkReady!(); } catch { ok = false; }
      if (cancelled) return;
      // Ready when the agent answers, or fail-open after 30s so the user is
      // never permanently blocked (the send path handles a stray vm_starting).
      if (ok || Date.now() - startedAt > 30_000) { setAgentReady(true); return; }
      timer = setTimeout(probe, 2_500);
    };
    setAgentReady(false);
    probe();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [isRunning, hasReadyProbe, platform, readyNonce]);

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
    if (!platform.getDisplayName) return;
    void platform.getDisplayName().then((name) => {
      if (active) setDisplayName(name || 'there');
    }).catch(() => {});
    return () => { active = false; };
  }, [platform]);

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

  // Cap the history panel to the space actually available so it never runs off
  // the viewport. In the workspace variant it opens upward (`bottom-full`), so
  // on a short window a fixed height would otherwise overflow the top of the
  // screen — measure the room above/below the trigger and clamp to it.
  useEffect(() => {
    if (!showHistory) return;
    const measure = () => {
      const trigger = historyPanelRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const margin = 16;
      const available = variant === 'workspace'
        ? rect.top - margin // room above the trigger
        : window.innerHeight - rect.bottom - margin; // room below
      setHistoryMaxHeight(Math.max(160, Math.min(384, available)));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [showHistory, variant]);

  // Fetch conversation history — query all sources in parallel and merge.
  // Always preserves any in-memory entries (e.g. a just-sent chat) that the
  // backends haven't indexed yet, so the list never flashes empty after a send.
  const fetchHistory = useCallback(async () => {
    if (!isRunning) return;
    setHistoryLoading(true);
    try {
      const fetched = await platform.fetchConversations(30);
      setConversations((prev) => {
        const byId = new Map<string, ConversationEntry>();
        for (const entry of fetched) byId.set(entry.id, entry);
        for (const local of prev) {
          if (!byId.has(local.id)) byId.set(local.id, local);
        }
        return Array.from(byId.values())
          .sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime())
          .slice(0, 30);
      });
    } catch { /* silent */ }
    setHistoryLoading(false);
  }, [isRunning, platform]);

  useEffect(() => {
    if (isRunning && showHistory) {
      void fetchHistory();
    }
  }, [isRunning, showHistory, fetchHistory]);

  // Load a conversation from history — try VM relay, then cloud-ai, then Supabase
  const loadConversation = useCallback(async (convId: string) => {
    abortRef.current?.abort();
    setLoadingConvId(convId);

    const { messages: loaded } = await platform.loadConversationMessages(convId, 100);

    setStreamText('');
    setStreamReasoning('');
    setStreamTools([]);
    setStreamChunks([]);
    setAskUserPrompts([]);
    setLoading(false);
    conversationIdRef.current = convId;
    const conv = conversations.find(c => c.id === convId);
    conversationTitleRef.current = conv?.title || '';
    setMessages(loaded);

    setLoadingConvId(null);
    setShowHistory(false);
    requestAnimationFrame(() => scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight));
  }, [conversations, platform]);

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
    if (!text || loading || !vmReady) return;
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
    let finalSeen = false;
    let streamEndReason = '';

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

    const pushText = (chunk: string, options?: { nested?: boolean; subagentId?: string }) => {
      if (!chunk) return;
      if (!options?.nested) {
        accText = mergeStreamingText(accText, chunk);
        setStreamText(accText);
      }
      accChunks = appendTextChunk(accChunks, chunk, options);
      setStreamChunks([...accChunks]);
    };

    const pushReasoning = (chunk: string, nested = false, subagentId?: string) => {
      if (!chunk) return;
      if (!nested) {
        accReasoning = mergeStreamingText(accReasoning, chunk);
        setStreamReasoning(accReasoning);
      }
      accChunks = appendReasoningChunk(accChunks, chunk, nested, subagentId);
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
      const isAuto = selectedModel === 'auto';
      const meta = !isAuto ? modelById.get(selectedModel) : undefined;
      const modelTier = isAuto ? 'auto' : ((meta?.category as string) || (meta?.isReasoning ? 'smart' : 'balanced'));
      const explicitModelId = !isAuto ? selectedModel : undefined;

      const attachmentsPayload = readyAttachments.length > 0
        ? readyAttachments.map(a => ({
            type: 'file' as const,
            name: a.name,
            path: a.path,
            mimeType: a.mimeType,
            size: a.size,
            source: 'vm' as const,
          }))
        : undefined;
      const contextPaths = readyAttachments.length > 0
        ? readyAttachments.map(a => ({ path: a.path, name: a.name, isDirectory: false }))
        : undefined;

      const resp = await platform.openChatStream({
        message: text,
        conversationId: conversationIdRef.current || undefined,
        model: modelTier,
        modelId: explicitModelId,
        attachments: attachmentsPayload,
        contextPaths,
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

                if ((subEvent === 'delta' || subEvent === 'text') && subData.text) {
                  pushText(subData.text, { nested: true, subagentId: subagentId || undefined });
                } else if ((subEvent === 'reasoning' || subEvent === 'reasoning_start') && subData.text) {
                  pushReasoning(subData.text, true, subagentId || undefined);
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
                // The VM sends its answer as { type:'final', ok, result:{ text } }
                // (vm-agent.ts spreads `...result`), so the text can live at
                // event.result.text / event.result.result.text — not just
                // event.text/event.data.text. Reading only the latter showed a
                // blank "No response" whenever the answer arrived in the final
                // frame instead of as streamed deltas.
                finalSeen = true;
                streamEndReason = String(
                  event.result?.finishReason
                    || event.result?.result?.finishReason
                    || event.finishReason
                    || (event.aborted ? 'aborted' : '')
                    || streamEndReason,
                ).trim();
                const finalText = extractFinalText(event, accText);
                if (finalText) accText = finalText;
                if (event.conversationId) conversationIdRef.current = event.conversationId;
                break;
              }
              case 'error': {
                // A streamed error (vm-agent.ts writes { type:'error', error })
                // was previously ignored, so the turn committed a bare
                // "No response". Surface it, keeping any text already streamed.
                const errText = String(
                  event.error || event.data?.error || event.message || 'The VM agent hit an error.',
                ).trim();
                if (!accText) accText = `⚠️ ${errText}`;
                break;
              }
            }
          }
        }

        const thinkDuration = streamStartRef.current ? (Date.now() - streamStartRef.current) / 1000 : undefined;
        setMessages((prev) => [
          ...prev,
          {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            text: accText || fallbackNoAssistantText(finalSeen ? (streamEndReason || 'empty final') : 'stream closed before final'),
            timestamp: Date.now(),
            reasoning: accReasoning || undefined,
            toolCalls: accTools.length > 0 ? accTools : undefined,
            streamChunks: accChunks.length > 0 ? accChunks : undefined,
            reasoningDuration: thinkDuration,
          },
        ]);
      } else {
        // Non-streaming fallback (JSON response) — also covers fast-fail
        // statuses like 503 vm_starting, where `message` is user-friendly.
        const data = await resp.json() as any;
        // If we raced the VM still booting, resume the readiness probe so the
        // composer flips back to "starting" and re-enables the instant it's up.
        if (data?.error === 'vm_starting') setReadyNonce((n) => n + 1);
        const replyText = extractFinalText(data)
          || firstText(data?.error, data?.detail)
          || fallbackNoAssistantText('empty JSON response');
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
        // Only set the title from the AI-generated title we received during the
        // stream (`type:'title'` event) — never from the user's text. Otherwise
        // every chat in history would be labelled with the first user message
        // until the next refetch, which the user has flagged as a regression.
        const aiTitle = conversationTitleRef.current.trim();
        upsertConversationEntry({
          id: activeConversationId,
          ...(aiTitle ? { title: aiTitle } : {}),
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
  }, [input, loading, isRunning, selectedModel, modelById, fetchHistory, showHistory, upsertConversationEntry, pendingAttachments, platform]);

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

  const submitVmToolResult = useCallback(async (toolId: string, result: unknown) => {
    try {
      await platform.sendToolResult(toolId, result);
    } catch { /* best-effort */ }
  }, [platform]);

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
    if (picked.length === 0) return;

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
        const res = await platform.uploadFileToVm(placeholder.path, file);
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
  }, [platform]);

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

  const handleGenUIResponse = useCallback((toolId: string, result: unknown) => {
    void submitVmToolResult(toolId, result);
  }, [submitVmToolResult]);

  const EffectiveMessageRenderer = useMemo(() => {
    if (renderInteractiveTool) {
      return createPortableVmMessageRenderer({
        renderInteractiveTool: (tool, key) =>
          renderInteractiveTool(
            { id: tool.id, tool: tool.tool, status: tool.status, args: tool.args },
            key,
          ),
        getInteractiveContext: () => ({
          askUserPrompts,
          onAskUserRespond: handleAskUserRespond,
          onGenUIRespond: handleGenUIResponse,
        }),
      });
    }
    if (!MessageRenderer) {
      throw new Error('VmChat requires MessageRenderer when renderInteractiveTool is not provided');
    }
    return MessageRenderer;
  }, [
    MessageRenderer,
    renderInteractiveTool,
    askUserPrompts,
    handleAskUserRespond,
    handleGenUIResponse,
  ]);

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
        <div
          className={clsx(
            'absolute z-50 w-80 rounded-2xl border border-theme bg-theme-card shadow-elevate flex flex-col',
            variant === 'workspace' ? 'bottom-full left-0 mb-2' : 'right-0 top-full mt-1',
          )}
          style={{ maxHeight: historyMaxHeight }}
        >
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
                        <div className="text-xs font-medium text-theme-fg truncate">{displayConversationTitle(c.title)}</div>
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
        {selectedModelMeta?.logoUrl && ModelLogo && (
          <ModelLogo
            src={selectedModelMeta.logoUrl}
            alt={selectedModelMeta.provider}
            providerId={selectedModelMeta.providerId}
            className="w-3.5 h-3.5 rounded"
          />
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
              {m.logoUrl && ModelLogo ? (
                <ModelLogo
                  src={m.logoUrl}
                  alt={m.provider}
                  providerId={m.providerId}
                  className="w-5 h-5 rounded shrink-0"
                />
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

  const attachmentPickerInput = (
    <input
      ref={attachmentInputRef}
      type="file"
      multiple
      onChange={handleAttachmentFilesSelected}
      className="hidden"
    />
  );

  const composer = variant === 'workspace' ? (
    <div className="rounded-2xl border border-theme bg-theme-card/40 shadow-sm transition-colors focus-within:border-primary/40">
      {attachmentChips}
      <textarea
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={vmStarting ? 'Starting up your VM agent…' : 'Ask, run, or build anything...'}
        rows={1}
        className="w-full resize-none outline-none bg-transparent text-[13px] text-theme-fg placeholder:text-theme-muted/50 px-4 pt-3 pb-1 min-h-[38px] max-h-[120px] overflow-y-auto scrollbar-none disabled:opacity-60"
        style={{ scrollbarWidth: 'none' }}
        disabled={loading}
      />
      {attachmentPickerInput}
      <div className="flex items-center justify-between gap-2 px-3 pb-2.5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleAttachClick}
            disabled={loading || !isRunning}
            className="p-1.5 rounded-lg text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60 transition-colors disabled:opacity-40"
            title="Attach files to this VM chat"
          >
            <Paperclip className="w-3.5 h-3.5" />
          </button>
          {modelSelector}
          {historyButton}
          <span
            className={clsx('h-1.5 w-1.5 rounded-full ml-0.5', (loading || vmStarting) ? 'bg-amber-500 animate-pulse' : 'bg-green-500')}
            title={vmStarting ? 'VM agent is finishing startup…' : undefined}
          />
          {messages.length > 0 && (
            <button type="button" onClick={handleClear} className="p-1.5 rounded-lg text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60 transition-colors" title="Clear">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {loading && (
            <button
              type="button"
              onClick={handleStop}
              className="rounded-lg p-2 text-red-400 hover:bg-red-500/10 transition-colors"
              title="Stop"
            >
              <Square className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={sendMessage}
            disabled={!input.trim() || loading || isUploadingAny || !vmReady}
            className={clsx(
              'rounded-lg p-2 transition-colors',
              input.trim() && !loading && !isUploadingAny && vmReady
                ? 'bg-primary text-primary-fg hover:opacity-90'
                : 'bg-theme-hover/40 text-theme-muted/40',
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
        placeholder={vmStarting ? 'Starting up your VM agent…' : 'Type a message to the VM agent...'}
        rows={1}
        className="w-full resize-none outline-none max-h-32 bg-theme-hover/40 rounded-xl px-4 py-2.5 text-sm text-theme-fg placeholder-theme-muted/50 overflow-y-auto scrollbar-none disabled:opacity-60"
        style={{ minHeight: '40px', scrollbarWidth: 'none' }}
        disabled={loading}
      />
      {attachmentPickerInput}
      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleAttachClick}
            disabled={loading || !isRunning}
            className="dashboard-refresh-button inline-flex items-center gap-2 px-2.5 py-1.5 text-xs !rounded-xl disabled:opacity-40"
            title="Attach files to this VM chat"
          >
            <Paperclip className="w-3.5 h-3.5" /> Attach
          </button>
          {modelSelector}
          {historyButton}
          <div className="dashboard-pill flex items-center gap-2 px-2.5 py-1.5 text-xs text-theme-muted">
            <span className={clsx('h-2 w-2 rounded-full', (loading || vmStarting) ? 'bg-amber-500 animate-pulse' : 'bg-green-500')} />
            {loading ? (streamText ? 'Streaming' : 'Thinking') : vmStarting ? 'Starting up…' : 'Agent ready'}
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
            disabled={!input.trim() || loading || isUploadingAny || !vmReady}
            className={clsx(
              'inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm transition-colors',
              input.trim() && !loading && !isUploadingAny && vmReady ? 'bg-primary text-primary-fg hover:opacity-90' : 'bg-theme-hover/40 text-theme-muted/40',
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
    const st = String(engine?.status || '').toLowerCase();
    const starting = st === 'provisioning' || st === 'starting' || st === 'staging' || st === 'booting' || st === 'pending';
    return (
      <div className={clsx('flex flex-col items-center justify-center text-theme-muted/50 gap-3', className)}>
        {starting ? <Loader2 className="w-10 h-10 animate-spin" /> : <WifiOff className="w-10 h-10" />}
        <p className="text-sm font-semibold">{starting ? 'Starting up your VM…' : 'Cloud computer is not running'}</p>
        <p className="text-xs">
          {starting
            ? 'Syncing your chats & memory and booting the agent — this takes a moment.'
            : 'Start your Cloud Computer to chat with your cloud agent.'}
        </p>
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
                  <EffectiveMessageRenderer
                    key={msg.id}
                    role={msg.role === 'assistant' ? 'assistant' : 'user'}
                    text={msg.text}
                    reasoning={msg.reasoning}
                    reasoningDuration={msg.reasoningDuration}
                    toolCalls={msg.toolCalls}
                    streamChunks={msg.streamChunks}
                    attachments={msg.attachments}
                    onSubmitToolOutput={submitVmToolResult}
                    onGenUIResponse={handleGenUIResponse}
                  />
                ))}

                {loading && (
                  <EffectiveMessageRenderer
                    role="assistant"
                    text={streamText}
                    reasoning={streamReasoning || undefined}
                    toolCalls={streamTools}
                    streamChunks={streamChunks}
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
            <EffectiveMessageRenderer
              key={msg.id}
              role={msg.role === 'assistant' ? 'assistant' : 'user'}
              text={msg.text}
              reasoning={msg.reasoning}
              reasoningDuration={msg.reasoningDuration}
              toolCalls={msg.toolCalls}
              streamChunks={msg.streamChunks}
              attachments={msg.attachments}
              onSubmitToolOutput={submitVmToolResult}
              onGenUIResponse={handleGenUIResponse}
            />
          ))}

          {loading && (
            <EffectiveMessageRenderer
              role="assistant"
              text={streamText}
              reasoning={streamReasoning || undefined}
              toolCalls={streamTools}
              streamChunks={streamChunks}
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
