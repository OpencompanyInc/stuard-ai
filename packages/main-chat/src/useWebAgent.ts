import { useCallback, useEffect, useRef, useState } from 'react';
import { mergeStreamingText } from '@stuardai/chat-ui/streamMerge';
import { appendReasoningChunk, appendTextChunk, applyToolCallUpdate } from '@stuardai/chat-ui/streamState';
import { serializeChatAttachment } from '@stuardai/chat-ui/attachments';
import type { ChatAttachment } from '@stuardai/chat-ui/attachments';
import type { Message as ChatMessage, ToolCall } from '@stuardai/chat-ui/types';
import type { IMainChatPlatform, MainChatConversationEntry, MainChatStreamPreview, UseWebAgentOptions, UseWebAgentResult } from './types';

function mapHistoryMessages(
  conversationId: string,
  rawMsgs: Array<Record<string, unknown>>,
): ChatMessage[] {
  return rawMsgs.map((m, i) => ({
    id: `${conversationId}-${i}`,
    role: m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user',
    text: String(m.content || m.text || ''),
    timestamp: m.created_at ? new Date(String(m.created_at)).getTime() : Date.now(),
  }));
}

export function useWebAgent(options: UseWebAgentOptions): UseWebAgentResult {
  const { platform } = options;
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [streamPreview, setStreamPreview] = useState<MainChatStreamPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversations, setConversations] = useState<MainChatConversationEntry[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState(options.model || 'auto');

  const wsRef = useRef<WebSocket | null>(null);
  const authedRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const activeRequestIdRef = useRef<string | null>(null);
  const streamTextRef = useRef('');
  const streamReasoningRef = useRef('');
  const streamToolsRef = useRef<ToolCall[]>([]);
  const streamChunksRef = useRef<ChatMessage['streamChunks']>([]);
  const reasoningStartRef = useRef<number | null>(null);
  const pendingPayloadRef = useRef<Record<string, unknown> | null>(null);

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  const bumpStreamPreview = useCallback(() => {
    setStreamPreview({
      text: streamTextRef.current,
      reasoning: streamReasoningRef.current || undefined,
      toolCalls: [...streamToolsRef.current],
      streamChunks: streamChunksRef.current?.length ? [...(streamChunksRef.current || [])] : undefined,
    });
  }, []);

  const resetStreamState = useCallback(() => {
    streamTextRef.current = '';
    streamReasoningRef.current = '';
    streamToolsRef.current = [];
    streamChunksRef.current = [];
    reasoningStartRef.current = null;
    activeRequestIdRef.current = null;
    setStreaming(false);
    setStreamPreview(null);
  }, []);

  const commitAssistantMessage = useCallback((finalText: string, aborted = false) => {
    const text = finalText || streamTextRef.current;
    const reasoningDuration = reasoningStartRef.current
      ? (Date.now() - reasoningStartRef.current) / 1000
      : undefined;
    const hasContent = Boolean(text.trim())
      || streamToolsRef.current.length > 0
      || (streamChunksRef.current?.length || 0) > 0;

    if (hasContent) {
      setMessages((prev) => [
        ...prev,
        {
          id: `asst-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          role: 'assistant',
          text: aborted && text ? `${text}\n\n*(Stopped)*` : text,
          reasoning: streamReasoningRef.current || undefined,
          reasoningDuration,
          toolCalls: streamToolsRef.current.length > 0 ? [...streamToolsRef.current] : undefined,
          streamChunks: streamChunksRef.current?.length ? [...(streamChunksRef.current || [])] : undefined,
          timestamp: Date.now(),
          aborted,
        },
      ]);
    }
    resetStreamState();
  }, [resetStreamState]);

  const refreshConversations = useCallback(async () => {
    try {
      const rows = await platform.fetchConversations(30);
      setConversations(rows);
    } catch {
      // ignore list failures in MVP
    }
  }, [platform]);

  const connect = useCallback(async () => {
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    setConnecting(true);
    setError(null);
    authedRef.current = false;

    try {
      const token = await platform.getAccessToken();
      if (!token) {
        setError('Sign in to chat with Stuard.');
        setConnecting(false);
        return;
      }

      const ws = new WebSocket(platform.resolveWebSocketUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'auth', accessToken: token }));
      };

      ws.onmessage = (event) => {
        let msg: any;
        try {
          msg = JSON.parse(String(event.data || '{}'));
        } catch {
          return;
        }

        if (msg.type === 'auth_result') {
          if (msg.ok) {
            authedRef.current = true;
            setConnected(true);
            setConnecting(false);
            setError(null);
            if (pendingPayloadRef.current) {
              const payload = pendingPayloadRef.current;
              pendingPayloadRef.current = null;
              ws.send(JSON.stringify(payload));
            }
          } else {
            setConnected(false);
            setConnecting(false);
            setError(msg.message || 'Authentication failed');
          }
          return;
        }

        const requestId = typeof msg.requestId === 'string' ? msg.requestId : undefined;
        if (requestId && activeRequestIdRef.current && requestId !== activeRequestIdRef.current) {
          return;
        }

        if (msg.type === 'progress') {
          const evt = msg as { event: string; data?: Record<string, unknown> };
          if (evt.event === 'delta') {
            setStreaming(true);
            const chunk = typeof evt.data?.text === 'string' ? evt.data.text : '';
            if (chunk) {
              streamTextRef.current = mergeStreamingText(streamTextRef.current, chunk);
              streamChunksRef.current = appendTextChunk(streamChunksRef.current || [], chunk);
              bumpStreamPreview();
            }
          } else if (evt.event === 'reasoning_start') {
            setStreaming(true);
            reasoningStartRef.current = Date.now();
            bumpStreamPreview();
          } else if (evt.event === 'reasoning') {
            setStreaming(true);
            const chunk = typeof evt.data?.text === 'string' ? evt.data.text : '';
            if (chunk) {
              streamReasoningRef.current = mergeStreamingText(streamReasoningRef.current, chunk);
              streamChunksRef.current = appendReasoningChunk(streamChunksRef.current || [], chunk);
              bumpStreamPreview();
            }
          } else if (evt.event === 'tool_event') {
            setStreaming(true);
            const data = evt.data || {};
            const toolCall: ToolCall = {
              id: String(data.toolCallId || data.id || `tc-${Date.now()}`),
              tool: String(data.tool || 'tool'),
              status: (data.status as ToolCall['status']) || 'running',
              args: data.args,
              result: data.result,
              error: data.error,
              timestamp: Date.now(),
              description: typeof data.description === 'string' ? data.description : undefined,
            };
            const updated = applyToolCallUpdate(
              streamToolsRef.current,
              streamChunksRef.current || [],
              toolCall,
            );
            streamToolsRef.current = updated.toolCalls;
            streamChunksRef.current = updated.streamChunks;
            bumpStreamPreview();
          }
          return;
        }

        if (msg.type === 'final') {
          const result = msg.result || {};
          const isAborted = msg.aborted === true || result.finishReason === 'aborted';
          const text = String(result.response || result.text || streamTextRef.current || '');
          if (typeof result.conversationId === 'string' && result.conversationId) {
            setConversationId(result.conversationId);
          }
          commitAssistantMessage(text, isAborted);
          void refreshConversations();
          return;
        }

        if (msg.type === 'error') {
          setError(String(msg.message || 'Chat error'));
          commitAssistantMessage(streamTextRef.current, true);
          return;
        }

        if (msg.type === 'stopped') {
          commitAssistantMessage(streamTextRef.current, true);
        }
      };

      ws.onerror = () => {
        setError('Connection error');
        setConnecting(false);
      };

      ws.onclose = () => {
        setConnected(false);
        setConnecting(false);
        authedRef.current = false;
        wsRef.current = null;
        if (!reconnectTimerRef.current) {
          reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null;
            void connect();
          }, 2000);
        }
      };
    } catch (e: any) {
      setConnecting(false);
      setError(String(e?.message || 'Failed to connect'));
    }
  }, [commitAssistantMessage, bumpStreamPreview, platform, refreshConversations]);

  useEffect(() => {
    void connect();
    void refreshConversations();
    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      try {
        wsRef.current?.close();
      } catch { /* ignore */ }
    };
  }, [connect, refreshConversations]);

  const sendMessage = useCallback(async (text: string, attachments: ChatAttachment[] = []) => {
    const trimmed = String(text || '').trim();
    const readyAttachments = attachments.filter((attachment) => attachment?.data);
    if (!trimmed && readyAttachments.length === 0) return;

    setError(null);
    resetStreamState();

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role: 'user',
      text: trimmed,
      attachments: readyAttachments.length > 0 ? readyAttachments : undefined,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);

    const hist = [...messages, userMsg]
      .slice(-50)
      .map((m) => ({
        role: m.role,
        content: m.text,
        ...(m.attachments?.length ? { attachments: m.attachments.map(serializeChatAttachment) } : {}),
      }));

    const token = await platform.getAccessToken();
    const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    activeRequestIdRef.current = requestId;
    setStreaming(true);
    setStreamPreview({ text: '', toolCalls: [] });

    const payload: Record<string, unknown> = {
      type: 'chat',
      requestId,
      text: trimmed,
      messages: hist,
      context: {},
      attachments: readyAttachments.map(serializeChatAttachment),
      contextPaths: [],
    };

    if (conversationIdRef.current) {
      payload.conversationId = conversationIdRef.current;
      payload.memory = { thread: conversationIdRef.current };
    }

    if (selectedModel && selectedModel !== 'auto') {
      payload.model = selectedModel;
    }
    if (options.modelId) {
      payload.modelId = options.modelId;
    }
    if (token) {
      payload.auth = { accessToken: token };
    }

    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN && authedRef.current) {
      ws.send(JSON.stringify(payload));
      return;
    }

    pendingPayloadRef.current = payload;
    await connect();
  }, [connect, messages, options.modelId, platform, resetStreamState, selectedModel]);

  const stopGeneration = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN && activeRequestIdRef.current) {
      ws.send(JSON.stringify({ type: 'stop', requestId: activeRequestIdRef.current }));
    }
    commitAssistantMessage(streamTextRef.current, true);
  }, [commitAssistantMessage]);

  const loadConversation = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    resetStreamState();
    try {
      const res = await platform.loadConversationMessages(id, 100);
      if (res.error) {
        setError(res.error);
        return;
      }
      setConversationId(id);
      setMessages(res.messages);
    } finally {
      setLoading(false);
    }
  }, [platform, resetStreamState]);

  const startNewConversation = useCallback(() => {
    setConversationId(null);
    setMessages([]);
    resetStreamState();
    setError(null);
  }, [resetStreamState]);

  return {
    connected,
    connecting,
    loading,
    streaming,
    streamPreview,
    error,
    messages,
    conversations,
    conversationId,
    selectedModel,
    setSelectedModel,
    sendMessage,
    stopGeneration,
    loadConversation,
    startNewConversation,
    refreshConversations,
  };
}
