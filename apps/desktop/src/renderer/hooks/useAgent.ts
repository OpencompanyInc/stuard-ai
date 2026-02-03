import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase, getValidAccessToken, ensureFreshToken, setupAutoRefresh } from '../auth/authManager';

const HIDDEN_TOOL_NAMES = new Set([
  'knowledge_get_identity',
  'knowledge_get_directives',
  'knowledge_get_bio',
  'knowledge_list_entities',
  'knowledge_search_facts',
  'knowledge_get_entity_context',

  // Pending memories (shown in dedicated UI, should not appear as tool pills)
  'pending_memory_create',
  'pending_memory_list',
  'pending_memory_get',
  'pending_memory_confirm',
  'pending_memory_reject',
  'pending_memory_delete',
]);

const HIDDEN_WRAPPER_TOOL_NAMES = new Set([
  'run_sequential',
  'run_parallel',
]);

// GenUI tools that render interactive UI and may require user response
const GENUI_TOOL_NAMES = new Set([
  // Decision & Input (blocking - wait for user response)
  'ask_confirmation',
  'show_choices',
  'pick_date',
  'request_files',
  'show_command', // Has "Run" button
  // Display only (non-blocking)
  'show_table',
  'show_info',
  'show_details',
  'show_files',
  'show_json',
  'show_link',
  'show_colors',
  'show_progress',
]);

// GenUI tools that block and wait for user interaction
const BLOCKING_GENUI_TOOLS = new Set([
  'ask_confirmation',
  'show_choices',
  'pick_date',
  'request_files',
  'show_command',
]);

export interface GenUIToolCall {
  id: string;
  tool: string;
  args: any;
  status: 'pending' | 'completed';
  result?: any;
}

interface ContextPath {
  path: string;
  name: string;
  isDirectory: boolean;
}

export interface ToolCall {
  id: string;
  tool: string;
  status: 'called' | 'running' | 'completed' | 'error';
  args?: any;
  result?: any;
  error?: any;
  timestamp: number;
  description?: string; // User-friendly description of what the tool is doing
}

export interface PendingMemory {
  id: string;
  original_text: string;
  proposed_action: string;
  proposed_key?: string;
  proposed_value: string;
  confidence_reason: string;
  entity_name?: string;
  created_at: string;
  status: string;
}

// Stream chunk types for interleaved display
export type StreamChunk =
  | { type: 'text'; content: string }
  | { type: 'reasoning'; content: string }
  | { type: 'tool'; tool: ToolCall };

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  reasoning?: string;
  reasoningDuration?: number; // in seconds
  toolCalls?: ToolCall[]; // Tool calls made during this response
  streamChunks?: StreamChunk[]; // Interleaved chunks for display
  timestamp?: number;
  contextPaths?: ContextPath[]; // Files/folders attached via @ mention
}

interface ProgressEvent {
  event: string;
  data: any;
}

interface AgentState {
  connected: boolean;
  connecting: boolean;
  status: string;
}

type AIPhase = 'disconnected' | 'connecting' | 'connected' | 'routing' | 'tool' | 'responding' | 'idle' | 'error';
interface AIStatus {
  phase: AIPhase;
  model?: string;
  tool?: string;
  toolStatus?: string;
  message?: string;
  statusText: string;
}

interface SendMessageOptions {
  text: string;
  attachments?: Array<{
    type: 'image' | 'file';
    name: string;
    data: string; // base64 or data URI
    mimeType?: string;
  }>;
  context?: Record<string, any>;
  contextPaths?: ContextPath[]; // Files/folders from @ mention
  mode?: string;
  modelId?: string;
  modelConfig?: any;
  silent?: boolean;
}

interface ConversationTab {
  id: string; // Unique client-side ID for the tab
  serverId: string | null; // The actual conversation ID from server (null if new/unsaved)
  title: string;
  messages: Message[];
  currentResponse: string;
  currentReasoning: string;
  currentToolCalls: ToolCall[]; // Tool calls for current streaming response
  currentStreamChunks: StreamChunk[]; // Interleaved chunks in order
  aiState: AIStatus;
  agentState: AgentState;
  lastError: { code: string; data?: any } | null;
}

interface UseAgentOptions {
  customAgentUrl?: string;
  onTitleUpdate?: (conversationId: string, title: string) => void;
}

export function useAgent(options?: string | UseAgentOptions) {
  // Parse options (support legacy string format)
  const customAgentUrl = typeof options === 'string' ? options : options?.customAgentUrl;
  const onTitleUpdateRef = useRef<((cid: string, title: string) => void) | undefined>();
  onTitleUpdateRef.current = typeof options === 'object' ? options?.onTitleUpdate : undefined;

  // Tabs State
  const [tabs, setTabs] = useState<ConversationTab[]>([{
    id: 'default',
    serverId: null,
    title: 'New Chat',
    messages: [],
    currentResponse: '',
    currentReasoning: '',
    currentToolCalls: [],
    currentStreamChunks: [],
    aiState: { phase: 'idle', statusText: 'Idle' },
    agentState: { connected: false, connecting: false, status: 'disconnected' },
    lastError: null
  }]);
  const [activeTabId, setActiveTabId] = useState<string>('default');
  const activeTabIdRef = useRef<string>(activeTabId);
  const tabsRef = useRef<ConversationTab[]>(tabs);

  // Sync refs
  useEffect(() => { tabsRef.current = tabs; }, [tabs]);
  useEffect(() => { activeTabIdRef.current = activeTabId; }, [activeTabId]);

  // Helper to get active tab from ref (for callbacks)
  const getActiveTabRef = useCallback(() => {
    return tabsRef.current.find(t => t.id === activeTabIdRef.current) || tabsRef.current[0];
  }, []);

  // Get active tab directly from state (for render - avoids stale ref issue)
  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0];

  // Legacy state accessors (mapped to active tab - derived from STATE not ref)
  const messages = activeTab?.messages || [];
  const currentResponse = activeTab?.currentResponse || '';
  const currentReasoning = activeTab?.currentReasoning || '';
  const currentToolCalls = activeTab?.currentToolCalls || [];
  const currentStreamChunks = activeTab?.currentStreamChunks || [];
  const ai = activeTab?.aiState || { phase: 'idle', statusText: 'Idle' };
  const state = activeTab?.agentState || { connected: false, connecting: false, status: 'disconnected' };
  const conversationId = activeTab?.serverId || null;
  const lastError = activeTab?.lastError || null;

  // Legacy setters (update active tab)
  const setMessages = (fn: Message[] | ((prev: Message[]) => Message[])) => {
    setTabs(prev => prev.map(t => {
      if (t.id === activeTabId) {
        const newMsgs = typeof fn === 'function' ? fn(t.messages) : fn;
        return { ...t, messages: newMsgs };
      }
      return t;
    }));
  };
  const setCurrentResponse = (fn: string | ((prev: string) => string)) => {
    setTabs(prev => prev.map(t => {
      if (t.id === activeTabId) {
        const newResp = typeof fn === 'function' ? fn(t.currentResponse) : fn;
        return { ...t, currentResponse: newResp };
      }
      return t;
    }));
  };
  const setCurrentReasoning = (fn: string | ((prev: string) => string)) => {
    setTabs(prev => prev.map(t => {
      if (t.id === activeTabId) {
        const newReas = typeof fn === 'function' ? fn(t.currentReasoning) : fn;
        return { ...t, currentReasoning: newReas };
      }
      return t;
    }));
  };
  const setAI = (fn: AIStatus | ((prev: AIStatus) => AIStatus)) => {
    setTabs(prev => prev.map(t => {
      if (t.id === activeTabId) {
        const newAi = typeof fn === 'function' ? fn(t.aiState) : fn;
        return { ...t, aiState: newAi };
      }
      return t;
    }));
  };
  const setState = (fn: AgentState | ((prev: AgentState) => AgentState)) => {
    setTabs(prev => prev.map(t => {
      if (t.id === activeTabId) {
        const newState = typeof fn === 'function' ? fn(t.agentState) : fn;
        return { ...t, agentState: newState };
      }
      return t;
    }));
  };
  const setConversationId = (id: string | null) => {
    setTabs(prev => prev.map(t => {
      if (t.id === activeTabId) return { ...t, serverId: id };
      return t;
    }));
  };
  const setLastError = (err: { code: string; data?: any } | null) => {
    setTabs(prev => prev.map(t => {
      if (t.id === activeTabId) return { ...t, lastError: err };
      return t;
    }));
  };

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef<number>(0);
  const BASE_RECONNECT_DELAY = 1000;
  const MAX_RECONNECT_DELAY = 30000;
  const resetConversationNextRef = useRef<boolean>(false);
  const deltaBufferRef = useRef<string>('');
  const flushTimerRef = useRef<NodeJS.Timeout | null>(null);
  const streamingRef = useRef<boolean>(false);
  const stoppedRef = useRef<boolean>(false); // Track if user explicitly stopped - ignore further chunks until final
  const streamingConversationIdRef = useRef<string | null>(null); // Track which conversation we're streaming to
  const streamingTabIdRef = useRef<string | null>(null); // Track which tab initiated the stream
  const pendingResponseTabsRef = useRef<string[]>([]); // Queue of tabs waiting for responses (FIFO) - legacy
  const requestIdToTabRef = useRef<Map<string, string>>(new Map()); // Map requestId -> tabId for parallel routing
  const activeRequestIdRef = useRef<string | null>(null); // Current request being processed (for non-requestId messages)
  const conversationIdRef = useRef<string | null>(null); // Mirror of conversationId state for sync access
  const progressHandlersRef = useRef<Set<(evt: ProgressEvent) => void>>(new Set());
  const pendingToolsRef = useRef<Map<string, (res: any) => void>>(new Map());

  const wrapperSequentialQueueRef = useRef<Map<string, string[]>>(new Map());
  const wrapperSequentialCounterRef = useRef<Map<string, number>>(new Map());

  const [pendingMemories, setPendingMemories] = useState<PendingMemory[]>([]);
  const [activeGenUITools, setActiveGenUITools] = useState<GenUIToolCall[]>([]);
  const [queueDepth, setQueueDepth] = useState<number>(0);
  const queueDepthRef = useRef<number>(0);
  const waitingQueuedStartRef = useRef<boolean>(false);
  const [queuedMessages, setQueuedMessages] = useState<Array<{ id: string; text: string; timestamp: number }>>([]);
  const queuedMessagesRef = useRef<Array<{ id: string; text: string; timestamp: number }>>([]);
  const pendingSendRef = useRef<Array<{ id: string; text: string; timestamp: number; payload?: any; tabId?: string; silent?: boolean }>>([]);
  const outboundQueueRef = useRef<Array<{ id: string; text: string; timestamp: number; payload: any; tabId: string }>>([]);
  const runningTabsRef = useRef<Set<string>>(new Set());
  const reasoningStartTimeRef = useRef<number | null>(null); // Track when reasoning started

  // Tab Management
  const addTab = useCallback((tab: Partial<ConversationTab> = {}) => {
    const id = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const newTab: ConversationTab = {
      id,
      serverId: null,
      title: 'New Chat',
      messages: [],
      currentResponse: '',
      currentReasoning: '',
      currentToolCalls: [],
      currentStreamChunks: [],
      aiState: { phase: 'idle', statusText: 'Idle' },
      agentState: { connected: state.connected, connecting: state.connecting, status: state.status },
      lastError: null,
      ...tab
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(id);
    return id;
  }, [state.connected, state.connecting, state.status]);

  const closeTab = useCallback((id: string) => {
    setTabs(prev => {
      if (prev.length <= 1) return prev; // Prevent closing last tab
      const next = prev.filter(t => t.id !== id);
      if (activeTabId === id) {
        setActiveTabId(next[next.length - 1].id);
      }
      return next;
    });
  }, [activeTabId]);

  const switchTab = useCallback((id: string) => {
    if (tabsRef.current.some(t => t.id === id)) {
      setActiveTabId(id);
    }
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) return;
    flushTimerRef.current = setTimeout(() => {
      const buf = deltaBufferRef.current;
      if (buf) {
        setCurrentResponse((prev) => prev + buf);
        deltaBufferRef.current = '';
      }
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    }, 50);
  }, []);

  const respondToApproval = useCallback(async (id: string, allow: boolean): Promise<boolean> => {
    try {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return false;
      const payload = { type: 'approval_response', id, allow } as any;
      wsRef.current.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }, []);

  const stopGeneration = useCallback((): boolean => {
    try {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return false;
      wsRef.current.send(JSON.stringify({ type: 'stop' }));
      // Clear streaming state and mark as stopped to ignore further chunks
      streamingRef.current = false;
      stoppedRef.current = true;
      setAI({ phase: 'idle', statusText: 'Stopped' });
      return true;
    } catch {
      return false;
    }
  }, []);

  const execLocalTool = useCallback(async (tool: string, args: any): Promise<any> => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      throw new Error('agent not connected');
    }
    const id = `tool-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const payload = { type: 'tool_exec', id, tool, args } as any;
    return new Promise<any>((resolve) => {
      pendingToolsRef.current.set(id, resolve);
      wsRef.current!.send(JSON.stringify(payload));
    });
  }, []);

  const refreshPendingMemories = useCallback(async () => {
    try {
      const result = await execLocalTool('pending_memory_list', { limit: 10 });
      if (Array.isArray(result)) {
        setPendingMemories(result as any);
      }
    } catch { }
  }, [execLocalTool]);

  const confirmPendingMemory = useCallback(async (id: string) => {
    try {
      await execLocalTool('pending_memory_confirm', { id });
    } catch { }
    await refreshPendingMemories();
  }, [execLocalTool, refreshPendingMemories]);

  const rejectPendingMemory = useCallback(async (id: string) => {
    try {
      await execLocalTool('pending_memory_reject', { id });
    } catch { }
    await refreshPendingMemories();
  }, [execLocalTool, refreshPendingMemories]);

  const submitToolOutput = useCallback(async (id: string, result: any) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.warn('[agent] Cannot submit tool output: agent not connected');
      return;
    }
    const payload = { type: 'tool_result', id, result };
    wsRef.current.send(JSON.stringify(payload));
  }, []);

  // Respond to a GenUI tool call (e.g., user clicked Confirm, selected a choice, etc.)
  const respondToGenUI = useCallback((toolCallId: string, result: any) => {
    console.log('[agent] Responding to GenUI tool:', toolCallId, result);

    // Send result back to server
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'tool_result',
        id: toolCallId,
        result
      }));
    }

    // Update state to mark as completed
    setActiveGenUITools(prev =>
      prev.map(t => t.id === toolCallId ? { ...t, status: 'completed', result } : t)
    );

    // Remove from active list after a short delay (for animation)
    setTimeout(() => {
      setActiveGenUITools(prev => prev.filter(t => t.id !== toolCallId));
    }, 300);
  }, []);

  const deleteConversation = useCallback(async (id: string) => {
    try {
      const target = customAgentUrl ? customAgentUrl.replace('/ws', '') : 'http://127.0.0.1:8765';
      const resp = await fetch(`${target}/memory/conversations/${id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      const result = await resp.json();
      if (result.ok) {
        // If the deleted conversation is in a tab, clear it or close it
        setTabs(prev => {
          const next = prev.map(t => {
            if (t.serverId === id) {
              return {
                ...t,
                serverId: null,
                title: 'New Chat',
                messages: [],
                currentResponse: '',
                currentReasoning: '',
                currentToolCalls: [],
                currentStreamChunks: [],
                lastError: null
              };
            }
            return t;
          });
          return next;
        });
        return { ok: true };
      }
      return { ok: false, error: result.error };
    } catch (err) {
      console.error('[agent] deleteConversation failed:', err);
      return { ok: false, error: String(err) };
    }
  }, [customAgentUrl, refreshPendingMemories]);

  const subscribeProgress = useCallback((fn: (evt: ProgressEvent) => void) => {
    progressHandlersRef.current.add(fn);
    return () => {
      try { progressHandlersRef.current.delete(fn); } catch { }
    };
  }, []);

  const humanizeToolName = (tool: string) => {
    return tool
      .replace(/_/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase to spaces
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
  };

  const tryDequeueAndSend = useCallback(() => {
    try {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

      // Find the next queued item for a tab that isn't already running
      const nextIdx = outboundQueueRef.current.findIndex(item => !runningTabsRef.current.has(item.tabId));
      if (nextIdx === -1) return;

      const next = outboundQueueRef.current.splice(nextIdx, 1)[0];
      if (!next) return;

      const targetTabId = next.tabId;

      // Generate a unique requestId to track this request/response pair
      const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      requestIdToTabRef.current.set(requestId, targetTabId);

      // Set tracking refs
      streamingTabIdRef.current = targetTabId;
      activeRequestIdRef.current = requestId;
      // Add to pending response queue (legacy fallback)
      pendingResponseTabsRef.current.push(targetTabId);

      // If there were queued items visible for this tab, mark that the next start should promote from queue
      waitingQueuedStartRef.current = queuedMessagesRef.current.length > 0;
      // Mark this tab as running
      runningTabsRef.current.add(targetTabId);

      // Add requestId to payload for server to echo back
      const payload = { ...next.payload, requestId };

      // Reset stopped flag for new request
      stoppedRef.current = false;
      try { wsRef.current.send(JSON.stringify(payload)); } catch { }

      // Update this specific tab's AI state
      setTabs(prev => prev.map(t =>
        t.id === targetTabId ? { ...t, aiState: { phase: 'routing', statusText: 'Thinking…' } } : t
      ));

      // Try to send more messages for other tabs (parallel processing)
      tryDequeueAndSend();
    } catch { }
  }, []);

  const connect = useCallback(() => {
    const ready = wsRef.current?.readyState;
    if (ready === WebSocket.OPEN || ready === WebSocket.CONNECTING) return;

    setState((s) => ({ ...s, connecting: true, status: 'connecting' }));
    setAI({ phase: 'connecting', statusText: 'Connecting…' });

    try {
      const w: any = window as any;
      const hintedWs = String(w.__AGENT_WS__ || '').trim();
      const hintedHttp = String(w.__AGENT_HTTP__ || '').trim();
      const httpToWs = (httpUrl: string) => {
        try {
          let wsBase = httpUrl.replace(/\/+$/, '');
          if (wsBase.startsWith('https://')) wsBase = 'wss://' + wsBase.slice('https://'.length);
          else if (wsBase.startsWith('http://')) wsBase = 'ws://' + wsBase.slice('http://'.length);
          if (!wsBase.endsWith('/ws')) wsBase = wsBase + '/ws';
          return wsBase;
        } catch {
          return '';
        }
      };
      const hinted = hintedWs || (hintedHttp ? httpToWs(hintedHttp) : '');
      const target = customAgentUrl || hinted || 'ws://127.0.0.1:8765/ws';
      const ws = new WebSocket(target);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[agent] Connected');
        setState({ connected: true, connecting: false, status: 'connected' });
        setAI({ phase: 'connected', statusText: 'Connected' });
        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
        reconnectAttemptsRef.current = 0;
        refreshPendingMemories();
        tryDequeueAndSend();
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type !== 'progress') {
            console.log('[agent] Received:', msg.type);
          }

          // Determine target tab from requestId (parallel routing) or fallback to FIFO queue
          const getTargetTabId = (): string => {
            // First try requestId-based routing for parallel processing
            if (msg.requestId && requestIdToTabRef.current.has(msg.requestId)) {
              return requestIdToTabRef.current.get(msg.requestId)!;
            }
            // Fallback to legacy FIFO queue
            return pendingResponseTabsRef.current[0] || streamingTabIdRef.current || activeTabIdRef.current;
          };

          // Helper to update the tab receiving this specific response
          const updateStreamingTab = (updater: (t: ConversationTab) => ConversationTab) => {
            const id = getTargetTabId();
            setTabs(prev => prev.map(t => t.id === id ? updater(t) : t));
          };

          const setStreamingAI = (fn: AIStatus | ((prev: AIStatus) => AIStatus)) => {
            updateStreamingTab(t => ({ ...t, aiState: typeof fn === 'function' ? fn(t.aiState) : fn }));
          };

          if (msg.type === 'handshake') {
            console.log('[agent] Handshake:', msg.message);
          } else if (msg.type === 'webhook_trigger' || msg.type === 'provider_webhook') {
            // Cloud webhook received - forward to main process to trigger workflow
            console.log('[agent] Cloud webhook received:', msg.type, msg);
            if ((window as any).desktopAPI?.handleCloudWebhook) {
              (window as any).desktopAPI.handleCloudWebhook(msg).catch((err: any) => {
                console.error('[agent] Failed to handle cloud webhook:', err);
              });
            }
          } else if (msg.type === 'tool_request') {
            // Handle server-side tool execution requests (e.g. get_local_time)
            // This is critical for the "Bridge" to work without blocking
            const { id, tool, args } = msg;

            // If it's a GenUI tool, add to activeGenUITools for UI rendering
            if (tool && GENUI_TOOL_NAMES.has(tool)) {
              console.log('[agent] GenUI tool request received:', tool, args);

              // Add to activeGenUITools for UI to render
              setActiveGenUITools(prev => {
                // Avoid duplicates
                if (prev.some(t => t.id === id)) return prev;
                return [...prev, { id, tool, args, status: 'pending' }];
              });

              // For non-blocking tools, auto-respond immediately
              if (!BLOCKING_GENUI_TOOLS.has(tool)) {
                console.log('[agent] Auto-responding to non-blocking GenUI tool:', tool);
                if (wsRef.current?.readyState === WebSocket.OPEN) {
                  wsRef.current.send(JSON.stringify({
                    type: 'tool_result',
                    id,
                    result: { displayed: true }
                  }));
                }
                // Mark as completed
                setActiveGenUITools(prev =>
                  prev.map(t => t.id === id ? { ...t, status: 'completed' } : t)
                );
              }
              return;
            }

            if (id && tool) {
              (async () => {
                try {
                  // Execute via Main process
                  let result = { ok: false, error: 'unknown_tool' };

                  // Handle simple client-side tools directly if needed, or delegate all to main
                  if (tool === 'get_local_time') {
                    const now = new Date();
                    const pad = (n: number) => n.toString().padStart(2, '0');
                    const offset = -now.getTimezoneOffset();
                    result = {
                      ok: true,
                      iso: now.toISOString(),
                      time: now.toLocaleTimeString(),
                      date: now.toLocaleDateString(),
                      tzName: Intl.DateTimeFormat().resolvedOptions().timeZone,
                      offsetMinutes: offset
                    } as any;
                  } else {
                    // Delegate to main process
                    if ((window as any).desktopAPI?.execTool) {
                      result = await (window as any).desktopAPI.execTool(tool, args);
                    }
                  }

                  // Send result back
                  if (wsRef.current?.readyState === WebSocket.OPEN) {
                    wsRef.current.send(JSON.stringify({ type: 'tool_result', id, result }));
                  }
                } catch (err: any) {
                  if (wsRef.current?.readyState === WebSocket.OPEN) {
                    wsRef.current.send(JSON.stringify({ type: 'tool_result', id, result: { ok: false, error: String(err.message || err) } }));
                  }
                }
              })();
            }
          } else if (msg.type === 'progress') {
            const evt = msg as { event: string; data: any };

            if (evt.event === 'routing') {
              const modelIndex = typeof evt.data?.m === 'number' ? evt.data.m : undefined;
              setStreamingAI((prev) => {
                if (prev.phase === 'tool' || prev.phase === 'responding') return prev;
                return { phase: 'routing', model: typeof modelIndex === 'number' ? String(modelIndex) : undefined, statusText: 'Thinking…' };
              });
              setState((s) => ({ ...s, status: s.status.startsWith('tool:') ? s.status : 'routing' }));
            } else if (evt.event === 'model') {
              const modelId = typeof evt.data?.modelId === 'string' ? evt.data.modelId : undefined;
              const tier = typeof evt.data?.tier === 'string' ? evt.data.tier : undefined;
              const label = modelId || tier;
              if (label) {
                setStreamingAI((prev) => ({ ...prev, model: label }));
              }
            } else if (evt.event === 'start') {
              streamingConversationIdRef.current = conversationIdRef.current;
              // Promote appropriate user message into chat when processing actually starts
              if (waitingQueuedStartRef.current && queueDepthRef.current > 0) {
                const first = queuedMessagesRef.current[0];
                if (first) {
                  updateStreamingTab(t => ({ ...t, messages: [...t.messages, { id: first.id, role: 'user', text: first.text, timestamp: first.timestamp }] }));
                }
                setQueuedMessages((prev) => {
                  const nextList = prev.slice(1);
                  const nd = nextList.length;
                  queueDepthRef.current = nd;
                  setQueueDepth(nd);
                  return nextList;
                });
                waitingQueuedStartRef.current = false;
              } else {
                const p = pendingSendRef.current.shift();
                if (p) {
                  if (!p.silent) {
                    updateStreamingTab(t => {
                      // Avoid duplicates if message was added optimistically
                      if (t.messages.some(m => m.id === p.id)) return t;
                      return { ...t, messages: [...t.messages, { id: p.id, role: 'user', text: p.text, timestamp: p.timestamp }] };
                    });
                  }
                }
              }
              setLastError(null);
            } else if (evt.event === 'reasoning_start') {
              // Reasoning started - track timing
              console.log('[agent] Reasoning started');
              reasoningStartTimeRef.current = Date.now();
              setStreamingAI((prev) => {
                if (prev.phase === 'tool') return prev;
                return { ...prev, phase: 'responding', statusText: 'Thinking…' };
              });
              setState((s) => ({ ...s, status: 'reasoning' }));
            } else if (evt.event === 'reasoning') {
              // Set start time if not set (in case reasoning_start wasn't received)
              if (!reasoningStartTimeRef.current) {
                reasoningStartTimeRef.current = Date.now();
              }
              const chunk = typeof evt.data?.text === 'string' ? evt.data.text : '';
              const isFinal = evt.data?.final === true;
              if (chunk) {
                if (isFinal) {
                  // Final reasoning - replace if current is empty, otherwise only set if different
                  updateStreamingTab(t => {
                    // If we already have streaming reasoning, keep it (more complete)
                    // If not, use the final reasoning
                    if (!t.currentReasoning.trim()) {
                      return { ...t, currentReasoning: chunk };
                    }
                    return t;
                  });
                } else {
                  updateStreamingTab(t => {
                    // Append to currentReasoning
                    const newReasoning = t.currentReasoning + chunk;
                    // Also update stream chunks - append to last reasoning chunk or create new
                    const chunks = [...t.currentStreamChunks];
                    const lastChunk = chunks[chunks.length - 1];
                    if (lastChunk?.type === 'reasoning') {
                      chunks[chunks.length - 1] = { type: 'reasoning', content: lastChunk.content + chunk };
                    } else {
                      chunks.push({ type: 'reasoning', content: chunk });
                    }
                    return { ...t, currentReasoning: newReasoning, currentStreamChunks: chunks };
                  });
                }
              }
              setStreamingAI((prev) => {
                if (prev.phase === 'tool') return prev;
                return { ...prev, phase: 'responding', statusText: 'Thinking…' };
              });
              setState((s) => ({ ...s, status: 'reasoning' }));
            } else if (evt.event === 'reasoning_end') {
              // Reasoning ended
              console.log('[agent] Reasoning ended');
            } else if (evt.event === 'tool_event') {
              // Ignore tool events if we've explicitly stopped
              if (stoppedRef.current) {
                console.log('[agent] Ignoring tool_event after stop');
                return;
              }
              const tool = String(evt.data?.tool || 'tool');
              const toolStatus = evt.data?.status || '';
              const humanTool = humanizeToolName(tool);
              const normalizedStatus = typeof toolStatus === 'string' ? toolStatus.toLowerCase() : '';
              const toolCallId = evt.data?.toolCallId || evt.data?.id || `tc-${Date.now()}`;
              // Get description from args.description or generate from tool name
              // Truncate long descriptions to max 60 chars for better UX
              const rawDescription = evt.data?.args?.description || evt.data?.description || '';
              const toolDescription = rawDescription && rawDescription.length > 60
                ? rawDescription.slice(0, 57) + '...'
                : rawDescription || humanTool;
              const isHiddenTool = HIDDEN_TOOL_NAMES.has(tool) || HIDDEN_WRAPPER_TOOL_NAMES.has(tool);

              const requestIdKey = String(msg.requestId || activeRequestIdRef.current || '');

              const emitSyntheticTool = (toolName: string, syntheticId: string, status: ToolCall['status'], args?: any, result?: any, error?: any) => {
                updateStreamingTab(t => {
                  const existingIdx = t.currentToolCalls.findIndex(tc => tc.id === syntheticId);
                  const existing = existingIdx >= 0 ? t.currentToolCalls[existingIdx] : undefined;
                  const nextCall: ToolCall = existing
                    ? { ...existing, tool: toolName, status, args: typeof args !== 'undefined' ? args : existing.args, result: typeof result !== 'undefined' ? result : existing.result, error: typeof error !== 'undefined' ? error : existing.error }
                    : { id: syntheticId, tool: toolName, status, args, result, error, timestamp: Date.now() };

                  const nextToolCalls = existingIdx >= 0
                    ? t.currentToolCalls.map(tc => tc.id === syntheticId ? nextCall : tc)
                    : [...t.currentToolCalls, nextCall];

                  const chunkExists = t.currentStreamChunks.some(ch => ch.type === 'tool' && ch.tool.id === syntheticId);
                  const nextChunks = chunkExists
                    ? t.currentStreamChunks.map(ch => (ch.type === 'tool' && ch.tool.id === syntheticId) ? { ...ch, tool: nextCall } : ch)
                    : [...t.currentStreamChunks, { type: 'tool' as const, tool: nextCall }];

                  return { ...t, currentToolCalls: nextToolCalls, currentStreamChunks: nextChunks };
                });
              };

              if (HIDDEN_WRAPPER_TOOL_NAMES.has(tool)) {
                const step = evt.data?.step;
                const stepTool = String(step?.tool || '').trim();
                if (stepTool) {
                  const isParallelIndex = typeof step?.index === 'number' ? step.index : undefined;
                  const wrapperKey = `${requestIdKey}:${tool}`;

                  if (normalizedStatus === 'step_started') {
                    let syntheticId: string;
                    if (typeof isParallelIndex === 'number') {
                      syntheticId = `wrap-${wrapperKey}:${isParallelIndex}`;
                    } else {
                      const cur = wrapperSequentialCounterRef.current.get(wrapperKey) || 0;
                      wrapperSequentialCounterRef.current.set(wrapperKey, cur + 1);
                      syntheticId = `wrap-${wrapperKey}:${cur}`;
                      const q = wrapperSequentialQueueRef.current.get(wrapperKey) || [];
                      q.push(syntheticId);
                      wrapperSequentialQueueRef.current.set(wrapperKey, q);
                    }

                    emitSyntheticTool(stepTool, syntheticId, 'called', evt.data?.args);
                    setStreamingAI({ phase: 'tool', tool: stepTool, toolStatus: 'running', statusText: `🔧 ${humanizeToolName(stepTool)} running…` });
                    setState((s) => ({ ...s, status: `tool:running` }));
                  } else if (normalizedStatus === 'step_completed' || normalizedStatus === 'step_error') {
                    const syntheticId = typeof isParallelIndex === 'number'
                      ? `wrap-${wrapperKey}:${isParallelIndex}`
                      : (() => {
                        const q = wrapperSequentialQueueRef.current.get(wrapperKey) || [];
                        const id = q.length > 0 ? q.shift()! : `wrap-${wrapperKey}:unknown`;
                        wrapperSequentialQueueRef.current.set(wrapperKey, q);
                        return id;
                      })();

                    const st: ToolCall['status'] = normalizedStatus === 'step_completed' ? 'completed' : 'error';
                    emitSyntheticTool(stepTool, syntheticId, st, undefined, normalizedStatus === 'step_completed' ? evt.data?.result : undefined, normalizedStatus === 'step_completed' ? undefined : (evt.data?.error || 'failed'));
                  } else if (normalizedStatus === 'completed') {
                    wrapperSequentialQueueRef.current.delete(wrapperKey);
                    wrapperSequentialCounterRef.current.delete(wrapperKey);
                  }
                }
                return;
              }

              // Track tool calls in currentToolCalls array AND currentStreamChunks
              // Deduplicate: only add if not already present, update if exists
              try {
                const d = evt.data || {};
                if (!isHiddenTool) {
                  if (normalizedStatus === 'called' || normalizedStatus === 'started') {
                    updateStreamingTab(t => {
                      // Check if this tool call already exists (by id or by tool name with pending status)
                      const existingIdx = t.currentToolCalls.findIndex(tc =>
                        tc.id === toolCallId || (tc.tool === tool && tc.status === 'called')
                      );

                      if (existingIdx >= 0) {
                        // Already exists - just update args if needed, don't duplicate
                        return t;
                      }

                      // Add new tool call
                      const newCall: ToolCall = {
                        id: toolCallId,
                        tool,
                        status: 'called',
                        args: d.args,
                        timestamp: Date.now(),
                        description: toolDescription,
                      };
                      return {
                        ...t,
                        currentToolCalls: [...t.currentToolCalls, newCall],
                        // Add tool chunk to stream for interleaved display
                        currentStreamChunks: [...t.currentStreamChunks, { type: 'tool' as const, tool: newCall }]
                      };
                    });
                  } else if (normalizedStatus === 'completed' || normalizedStatus === 'error' || normalizedStatus === 'failed') {
                    // Update existing tool call with result in both arrays
                    const newStatus = normalizedStatus === 'completed' ? 'completed' : 'error';
                    updateStreamingTab(t => {
                      // Find the matching tool call - prefer exact id match, fallback to tool name with pending status
                      const findMatch = (tc: ToolCall) =>
                        tc.id === toolCallId || (tc.tool === tool && tc.status === 'called');

                      const result = normalizedStatus === 'completed' ? d.result : undefined;
                      const error = normalizedStatus === 'completed' ? undefined : (d.error || d.result?.error || 'failed');

                      return {
                        ...t,
                        currentToolCalls: t.currentToolCalls.map(tc =>
                          findMatch(tc) ? { ...tc, status: newStatus, result, error } : tc
                        ),
                        // Update tool chunk in stream
                        currentStreamChunks: t.currentStreamChunks.map(chunk =>
                          chunk.type === 'tool' && findMatch(chunk.tool)
                            ? { ...chunk, tool: { ...chunk.tool, status: newStatus, result, error } }
                            : chunk
                        )
                      };
                    });
                  }
                }
              } catch { }

              let actionText = toolStatus;
              if (normalizedStatus === 'called' || normalizedStatus === 'started') actionText = 'running…';
              else if (normalizedStatus === 'completed') actionText = 'done';
              else if (normalizedStatus === 'executing') actionText = 'executing…';
              else if (normalizedStatus === 'progress') actionText = 'in progress…';
              else if (normalizedStatus === 'input_stream_start' || normalizedStatus === 'input_delta') actionText = 'preparing…';
              else if (normalizedStatus === 'input_stream_end') actionText = 'executing…';

              if (msg.type === 'tool_event') {
                const evt: ProgressEvent = { event: 'tool_event', data: msg };
                progressHandlersRef.current.forEach((fn) => { try { fn(evt); } catch { } });
              } else if (msg.type === 'tool_result') {
                const evt: ProgressEvent = { event: 'tool_result', data: msg };
                progressHandlersRef.current.forEach((fn) => { try { fn(evt); } catch { } });
                const id = String(msg.id || '');
                const resolver = id ? pendingToolsRef.current.get(id) : undefined;
                if (resolver) {
                  try { resolver(msg.result); } catch { }
                  pendingToolsRef.current.delete(id);
                }
              }

              if (!isHiddenTool) {
                if (normalizedStatus === 'completed' || normalizedStatus === 'error' || normalizedStatus === 'failed') {
                  setStreamingAI({ phase: 'responding', tool, toolStatus, statusText: 'Responding…' });
                } else {
                  setStreamingAI({ phase: 'tool', tool, toolStatus, statusText: `🔧 ${humanTool} ${actionText}` });
                }
                setState((s) => ({ ...s, status: `tool:${toolStatus}` }));
              }
            } else if (evt.event === 'delta') {
              // Ignore deltas if we've explicitly stopped - the abort signal was sent
              if (stoppedRef.current) {
                console.log('[agent] Ignoring delta after stop');
                return;
              }
              setStreamingAI((prev) => {
                if (prev.phase === 'tool' && prev.toolStatus && prev.toolStatus !== 'completed' && prev.toolStatus !== 'error' && prev.toolStatus !== 'failed') {
                  const base = (prev.statusText || '').replace(/ \u2022 streaming$/i, '').replace(/ • streaming$/i, '');
                  return { ...prev, statusText: `${base} • streaming` };
                }
                return { ...prev, phase: 'responding', statusText: 'Responding…' };
              });
              setState((s) => ({ ...s, status: 'responding' }));
              const chunk = typeof evt.data?.text === 'string' ? evt.data.text : '';
              if (chunk) {
                streamingRef.current = true;
                updateStreamingTab(t => {
                  // Append to currentResponse
                  const newResponse = t.currentResponse + chunk;
                  // Also update stream chunks - append to last text chunk or create new
                  const chunks = [...t.currentStreamChunks];
                  const lastChunk = chunks[chunks.length - 1];
                  if (lastChunk?.type === 'text') {
                    chunks[chunks.length - 1] = { type: 'text', content: lastChunk.content + chunk };
                  } else {
                    chunks.push({ type: 'text', content: chunk });
                  }
                  return { ...t, currentResponse: newResponse, currentStreamChunks: chunks };
                });
              }
            } else {
              setState((s) => ({ ...s, status: evt.event }));
            }
          } else if (msg.type === 'queued') {
            const pos = Number(msg.position || 0);
            const queuedText = msg.text || '';
            const queueId = msg.id || `q-${Date.now()}`;
            const peek = pendingSendRef.current[0];
            if (peek?.silent) {
              return;
            }
            const p = pendingSendRef.current.shift();
            waitingQueuedStartRef.current = true;
            const fullText = (p?.text && p.text.trim()) ? p.text : queuedText;
            const ts = typeof p?.timestamp === 'number' ? p!.timestamp : Date.now();
            setQueuedMessages((prev) => {
              const exists = prev.find((m) => m.id === queueId);
              if (exists) return prev;
              const nextList = [...prev, { id: queueId, text: fullText, timestamp: ts }];
              const nd = nextList.length;
              queueDepthRef.current = nd;
              return nextList;
            });
            setStreamingAI((prev) => ({ ...prev, statusText: (Number.isFinite(pos) && pos > 0) ? `Queued (${pos})` : 'Queued' }));
            setState((s) => ({ ...s, status: 'queued' }));
          } else if (msg.type === 'final') {
            const result = msg.result || {};
            const isAborted = msg.aborted === true || result.finishReason === 'aborted';
            const text = result.response || result.text || '';

            // Calculate reasoning duration if we have a start time
            const reasoningDuration = reasoningStartTimeRef.current
              ? (Date.now() - reasoningStartTimeRef.current) / 1000
              : undefined;

            // Reset refs
            if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
            deltaBufferRef.current = '';
            streamingRef.current = false;
            stoppedRef.current = false; // Reset stopped flag for next request
            reasoningStartTimeRef.current = null; // Reset for next message

            // Update tab with final message
            // For aborted messages, use currentResponse if available (more up-to-date than server text)
            const finalText = isAborted
              ? (text || '') // Server sends partial text
              : text;

            if (finalText || isAborted) {
              updateStreamingTab(t => {
                // For aborted, prefer the current streamed response over server text
                const displayText = isAborted && t.currentResponse ? t.currentResponse : finalText;
                return {
                  ...t,
                  messages: displayText ? [...t.messages, {
                    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    role: 'assistant',
                    text: displayText + (isAborted ? '\n\n*(Stopped)*' : ''),
                    reasoning: t.currentReasoning,
                    reasoningDuration: t.currentReasoning ? reasoningDuration : undefined,
                    toolCalls: t.currentToolCalls.length > 0 ? [...t.currentToolCalls] : undefined,
                    streamChunks: t.currentStreamChunks.length > 0 ? [...t.currentStreamChunks] : undefined,
                    timestamp: Date.now(),
                    aborted: isAborted,
                  }] : t.messages,
                  currentResponse: '',
                  currentReasoning: '',
                  currentToolCalls: [],
                  currentStreamChunks: [],
                  aiState: { ...t.aiState, phase: 'idle', statusText: isAborted ? 'Stopped' : 'Idle' }
                };
              });
            } else {
              updateStreamingTab(t => ({
                ...t,
                currentResponse: '',
                currentReasoning: '',
                currentToolCalls: [],
                currentStreamChunks: [],
                aiState: { ...t.aiState, phase: 'idle', statusText: 'Idle' }
              }));
            }

            setState((s) => ({ ...s, status: 'idle' }));

            refreshPendingMemories();

            // Clean up request tracking and mark tab as no longer running
            const completedTabId = getTargetTabId();
            if (msg.requestId) {
              requestIdToTabRef.current.delete(msg.requestId);
            }
            // Also remove from legacy FIFO queue if present
            const fifoIdx = pendingResponseTabsRef.current.indexOf(completedTabId);
            if (fifoIdx !== -1) pendingResponseTabsRef.current.splice(fifoIdx, 1);
            runningTabsRef.current.delete(completedTabId);
            tryDequeueAndSend();
            setLastError(null);
          } else if (msg.type === 'stopped') {
            // Server acknowledged the stop request
            console.log('[agent] Stream stopped by server:', msg.success);
            // Clear streaming state - the 'final' message with aborted=true will follow
            streamingRef.current = false;
            if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
            deltaBufferRef.current = '';
          } else if (msg.type === 'conversation') {
            const cid = msg.conversationId;
            const cidStr = (cid !== null && cid !== undefined) ? String(cid) : '';
            if (cidStr) {
              console.log('[agent] New conversation:', cidStr);
              updateStreamingTab(t => ({ ...t, serverId: cidStr }));
              streamingConversationIdRef.current = cidStr;
            }
          } else if (msg.type === 'title') {
            // Update tab title when server generates one
            const cid = msg.conversationId;
            const newTitle = msg.title;
            const cidStr = (cid !== null && cid !== undefined) ? String(cid) : '';
            if (cidStr && newTitle && typeof newTitle === 'string') {
              console.log('[agent] Title update:', cidStr, newTitle);
              setTabs(prev => {
                const matches = prev.some(t => String(t.serverId || '') === String(cidStr));
                if (matches) {
                  return prev.map(t => String(t.serverId || '') === String(cidStr) ? { ...t, title: newTitle } : t);
                }
                // Fallback: if serverId hasn't been set yet (race with `conversation` event),
                // apply title to the streaming tab and also set its serverId.
                const streamingTabId = streamingTabIdRef.current || activeTabIdRef.current;
                return prev.map(t => t.id === streamingTabId ? { ...t, serverId: t.serverId || cidStr, title: newTitle } : t);
              });
              try {
                // Ensure refs are aligned in case `conversation` event was missed
                streamingConversationIdRef.current = cidStr;
              } catch { }
              // Notify parent about title update so it can update conversation list
              try { onTitleUpdateRef.current?.(cidStr, newTitle); } catch { }
            }
          } else if (msg.type === 'error') {
            console.error('[agent] Error:', msg.message, 'code:', msg.code);

            // Check for auth errors that require re-authentication
            const errorCode = msg.code || msg.message || '';
            const requiresReauth = msg.data?.requiresReauth === true ||
              errorCode === 'expired_token' ||
              errorCode === 'invalid_token' ||
              errorCode.includes('expired');

            if (requiresReauth) {
              console.log('[agent] Token expired, attempting refresh...');
              // Try to refresh the token
              ensureFreshToken().then((session) => {
                if (session) {
                  console.log('[agent] Token refreshed, user should retry');
                  setStreamingAI({ phase: 'idle', statusText: 'Session refreshed - please retry' });
                  setLastError({ code: 'session_refreshed', data: { message: 'Your session was refreshed. Please try again.' } });
                } else {
                  console.log('[agent] Token refresh failed, user needs to sign in');
                  setStreamingAI({ phase: 'error', message: 'Session expired', statusText: 'Please sign in again' });
                  setLastError({ code: 'session_expired', data: { requiresSignIn: true, message: 'Your session has expired. Please sign in again.' } });
                }
              }).catch(() => {
                setStreamingAI({ phase: 'error', message: 'Session expired', statusText: 'Please sign in again' });
                setLastError({ code: 'session_expired', data: { requiresSignIn: true, message: 'Your session has expired. Please sign in again.' } });
              });
            } else {
              setStreamingAI({ phase: 'error', message: msg.message, statusText: `Error: ${msg.message}` });
              setLastError({ code: String(msg.message || ''), data: msg.data });
            }

            updateStreamingTab(t => ({ ...t, currentResponse: '', currentReasoning: '', currentToolCalls: [], currentStreamChunks: [] }));
            // Clean up request tracking and mark tab as no longer running
            const completedTabId = getTargetTabId();
            if (msg.requestId) {
              requestIdToTabRef.current.delete(msg.requestId);
            }
            const fifoIdx = pendingResponseTabsRef.current.indexOf(completedTabId);
            if (fifoIdx !== -1) pendingResponseTabsRef.current.splice(fifoIdx, 1);
            runningTabsRef.current.delete(completedTabId);
            tryDequeueAndSend();
          }
          try {
            if (msg.type === 'progress') {
              const evt = msg as { event: string; data: any } as ProgressEvent;
              progressHandlersRef.current.forEach((fn) => {
                try { fn(evt); } catch { }
              });
            }
          } catch { }
        } catch (err) {
          console.error('[agent] Parse error:', err);
        }
      };

      ws.onerror = (err) => {
        console.error('[agent] WebSocket error:', err);
        setState((s) => ({ ...s, connected: false, connecting: false, status: 'error' }));
        setAI({ phase: 'error', statusText: 'Connection error' });
        if (!reconnectTimerRef.current) {
          const attempt = (reconnectAttemptsRef.current || 0) + 1;
          reconnectAttemptsRef.current = attempt;
          const delay = Math.min(BASE_RECONNECT_DELAY * Math.pow(2, attempt - 1), MAX_RECONNECT_DELAY);
          reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null;
            connect();
          }, delay);
        }
      };

      ws.onclose = () => {
        console.log('[agent] Disconnected');
        setState({ connected: false, connecting: false, status: 'disconnected' });
        setAI({ phase: 'disconnected', statusText: 'Disconnected' });
        wsRef.current = null;
        if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
        deltaBufferRef.current = '';
        streamingRef.current = false;
        runningTabsRef.current.clear();
        pendingResponseTabsRef.current = [];
        waitingQueuedStartRef.current = false;
        if (!reconnectTimerRef.current) {
          const attempt = (reconnectAttemptsRef.current || 0) + 1;
          reconnectAttemptsRef.current = attempt;
          const jitter = Math.random() * 250;
          const delay = Math.min(BASE_RECONNECT_DELAY * Math.pow(2, attempt - 1), MAX_RECONNECT_DELAY) + jitter;
          reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null;
            console.log('[agent] Attempting reconnect...');
            connect();
          }, delay);
        }
      };
    } catch (err) {
      console.error('[agent] Connection failed:', err);
      setState({ connected: false, connecting: false, status: 'error' });
    }
  }, [customAgentUrl]);

  const disconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setState({ connected: false, connecting: false, status: 'disconnected' });
  }, []);

  const sendMessage = useCallback(
    async (options: SendMessageOptions) => {
      const wsReady = !!wsRef.current && wsRef.current.readyState === WebSocket.OPEN;
      if (!wsReady) {
        try { connect(); } catch { }
      }

      const isSilent = options.silent === true;

      const userMsg: Message = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: 'user',
        text: options.text,
        timestamp: Date.now(),
        contextPaths: options.contextPaths,
      };

      const targetTabId = activeTabId;
      const isTabRunning = runningTabsRef.current.has(targetTabId);

      // Get active tab history BEFORE adding the new message
      const currentTab = tabsRef.current.find(t => t.id === targetTabId);
      const currentMsgs = currentTab?.messages || [];

      // Build history with the new message (for sending to server)
      const hist = [...currentMsgs, userMsg]
        .slice(-50)
        .map((m) => ({ role: m.role === 'assistant' || m.role === 'system' ? m.role : 'user', content: m.text }));

      // If this tab is not currently running, show the user's message immediately
      // The message will NOT be re-added on progress:start because it's already in the tab
      // Use setTabs directly with targetTabId to avoid issues if active tab changes
      if (!isTabRunning && !isSilent) {
        setTabs(prev => prev.map(t =>
          t.id === targetTabId ? { ...t, messages: [...t.messages, userMsg] } : t
        ));
      }

      // Use auth manager to get a fresh token (proactively refreshes if expiring soon)
      const accessToken = await getValidAccessToken();

      const payload: any = {
        type: 'chat',
        text: options.text,
        context: options.context || {},
        attachments: options.attachments || [],
        contextPaths: options.contextPaths || [],
      };
      if (typeof options.mode === 'string' && options.mode) {
        payload.model = options.mode;
      }
      if (typeof options.modelId === 'string' && options.modelId) {
        payload.modelId = options.modelId;
      }
      if (options.modelConfig && typeof options.modelConfig === 'object') {
        payload.modelConfig = options.modelConfig;
      }
      try {
        if (!payload.context || typeof payload.context !== 'object') payload.context = {};
        // Removed deviceId injection from memory system
      } catch { }
      if (hist.length > 0) {
        payload.messages = hist;
      }

      // Use the target tab's serverId, not the potentially stale conversationId from closure
      const targetConversationId = currentTab?.serverId || null;
      if (targetConversationId) {
        payload.conversationId = targetConversationId;
        payload.memory = { ...(payload.memory || {}), thread: targetConversationId };
      }
      if (resetConversationNextRef.current) {
        payload.resetConversation = true;
      }
      if (accessToken) {
        payload.auth = { accessToken };
      }
      // Enqueue locally; only send when idle
      const pendingItem = {
        id: userMsg.id,
        text: userMsg.text,
        timestamp: userMsg.timestamp!,
        payload,
        tabId: targetTabId,
        silent: isSilent
      };
      outboundQueueRef.current.push(pendingItem);
      pendingSendRef.current.push(pendingItem);

      // If THIS TAB is currently running, mark status as queued for same-tab queuing
      if (isTabRunning) {
        setAI((prev) => ({ ...prev, statusText: `Queued (${Math.max(1, queueDepthRef.current + 1)})` }));
        setState((s) => ({ ...s, status: 'queued' }));
      }
      // Always try to dequeue - it will send if this tab (or any other) is available
      tryDequeueAndSend();
      resetConversationNextRef.current = false;
    },
    [messages, activeTabId, tryDequeueAndSend, connect]
  );

  const newChat = useCallback(() => {
    addTab();
  }, [addTab]);

  const loadConversation = useCallback(async (id: string) => {
    console.log('[useAgent] loadConversation called with id:', id);

    // Check if already open
    const existing = tabsRef.current.find(t => t.serverId === id);
    if (existing) {
      console.log('[useAgent] Conversation already open, switching to tab:', existing.id);
      setActiveTabId(existing.id);
      return;
    }

    // Open a tab immediately so the click always has visible effect,
    // then hydrate messages/title in the background.
    const openedTabId = addTab({ serverId: id, title: 'Chat', messages: [] });
    console.log('[useAgent] Created new tab:', openedTabId);

    try {
      const sessionToken = await getValidAccessToken();
      console.log('[useAgent] Session check:', sessionToken ? 'authenticated' : 'no session');
      if (!sessionToken) return;

      console.log('[useAgent] Fetching messages for conversation:', id);
      const { data, error } = await supabase
        .from('messages')
        .select('role, content, metadata, created_at')
        .eq('conversation_id', id)
        .order('created_at', { ascending: true })
        .limit(200);

      console.log('[useAgent] Messages query result:', { error, count: data?.length ?? 0 });
      if (error) {
        console.error('[useAgent] Messages query error:', error);
      }

      if (!error && Array.isArray(data)) {
        let lastModelLabel: string | undefined;
        const hist: Message[] = (data as any[]).map((r: any) => {
          const meta = r.metadata || {};
          try {
            const label = (typeof meta?.modelId === 'string' && meta.modelId.trim())
              ? meta.modelId.trim()
              : (typeof meta?.tier === 'string' && meta.tier.trim())
                ? meta.tier.trim()
                : undefined;
            if (label) lastModelLabel = label;
          } catch { }
          return {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            role: (r.role === 'assistant' ? 'assistant' : r.role === 'system' ? 'system' : 'user'),
            text: String(r.content || ''),
            reasoning: meta.reasoning,
            reasoningDuration: meta.reasoningDuration,
            toolCalls: meta.toolCalls,
            streamChunks: meta.streamChunks,
            contextPaths: Array.isArray(meta?.contextPaths) ? meta.contextPaths : undefined,
            timestamp: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
          };
        });

        console.log('[useAgent] Loaded', hist.length, 'messages');
        setTabs(prev => prev.map(t => t.id === openedTabId ? { ...t, messages: hist, aiState: { ...t.aiState, model: lastModelLabel } } : t));
      }

      try {
        const { data: conv } = await supabase
          .from('conversations')
          .select('title')
          .eq('id', id)
          .single();
        const title = (conv as any)?.title;
        console.log('[useAgent] Conversation title:', title);
        if (typeof title === 'string' && title.trim()) {
          setTabs(prev => prev.map(t => t.id === openedTabId ? { ...t, title: title.trim() } : t));
        }
      } catch (e) {
        console.error('[useAgent] Title fetch error:', e);
      }
    } catch (e) {
      console.error('[useAgent] loadConversation error:', e);
    }
  }, [addTab]);

  useEffect(() => {
    connect();
    // Set up automatic token refresh
    const cleanupAutoRefresh = setupAutoRefresh();
    return () => {
      disconnect();
      cleanupAutoRefresh();
    };
  }, []);

  useEffect(() => {
    const bumpReconnect = () => {
      try {
        const ws = wsRef.current;
        const ready = ws ? ws.readyState : WebSocket.CLOSED;
        if ((ready !== WebSocket.OPEN && ready !== WebSocket.CONNECTING) && !state.connecting) {
          if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
          reconnectAttemptsRef.current = 0;
          connect();
        }
      } catch { }
    };
    try { window.addEventListener('online', bumpReconnect); } catch { }
    try { window.addEventListener('focus', bumpReconnect); } catch { }
    let onVis: any;
    try {
      onVis = () => { if (document.visibilityState === 'visible') bumpReconnect(); };
      document.addEventListener('visibilitychange', onVis);
    } catch { }
    return () => {
      try { window.removeEventListener('online', bumpReconnect); } catch { }
      try { window.removeEventListener('focus', bumpReconnect); } catch { }
      try { document.removeEventListener('visibilitychange', onVis); } catch { }
    };
  }, [state.connecting, connect]);

  useEffect(() => {
    queueDepthRef.current = queueDepth;
  }, [queueDepth]);

  useEffect(() => {
    queuedMessagesRef.current = queuedMessages;
  }, [queuedMessages]);

  // Start a fresh thread on first message after the app opens
  useEffect(() => {
    resetConversationNextRef.current = true;
  }, []);

  return {
    messages,
    state,
    ai,
    currentResponse,
    currentReasoning,
    currentToolCalls,
    currentStreamChunks,
    sendMessage,
    stopGeneration,
    connect,
    disconnect,
    conversationId,
    newChat,
    loadConversation,
    subscribeProgress,
    execLocalTool,
    submitToolOutput,
    pendingMemories,
    refreshPendingMemories,
    confirmPendingMemory,
    rejectPendingMemory,
    queueDepth,
    queuedMessages,
    respondToApproval,
    lastError,
    tabs,
    activeTabId,
    addTab,
    closeTab,
    switchTab,
    deleteConversation,
    // GenUI support
    activeGenUITools,
    respondToGenUI,
  };
}
