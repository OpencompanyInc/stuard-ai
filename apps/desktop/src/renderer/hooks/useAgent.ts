import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase, getValidAccessToken, ensureFreshToken, setupAutoRefresh } from '../auth/authManager';
import type { ChatMode, ChatModelsConfig } from './usePreferences';
import {
  normalizeChatAttachments,
  serializeChatAttachment,
  type ChatAttachment,
} from '../utils/attachments';
import { mergeStreamingText } from '../utils/streamMerge';

const DEFAULT_TAB_CHAT_MODE: ChatMode = 'auto';
const DEFAULT_TAB_CHAT_MODELS: ChatModelsConfig = {
  fast: { allowed: [], default: 'deepseek/deepseek-chat' },
  balanced: { allowed: [], default: 'xai/grok-4-1-fast' },
  smart: { allowed: [], default: 'google/gemini-3.1-pro-preview' },
};

function cloneChatModelsConfig(cfg?: ChatModelsConfig | null): ChatModelsConfig {
  const source = cfg || DEFAULT_TAB_CHAT_MODELS;
  return {
    fast: {
      allowed: Array.isArray(source.fast?.allowed) ? [...source.fast.allowed] : [],
      default: typeof source.fast?.default === 'string' ? source.fast.default : DEFAULT_TAB_CHAT_MODELS.fast.default,
    },
    balanced: {
      allowed: Array.isArray(source.balanced?.allowed) ? [...source.balanced.allowed] : [],
      default: typeof source.balanced?.default === 'string' ? source.balanced.default : DEFAULT_TAB_CHAT_MODELS.balanced.default,
    },
    smart: {
      allowed: Array.isArray(source.smart?.allowed) ? [...source.smart.allowed] : [],
      default: typeof source.smart?.default === 'string' ? source.smart.default : DEFAULT_TAB_CHAT_MODELS.smart.default,
    },
  };
}

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

  // Internal memory/segment tools (run in background, should not affect status)
  'segment_build_topic_drawers',
  'segment_create',
  'segment_update',
  'segment_list',
  'segment_list_recent',
  'segment_search',
  'segment_search_drawers_by_embedding',
  'collection_summary_upsert',
  'collection_summary_list',
  'collection_summary_get',
  'conversation_create',
  'conversation_get',
  'conversation_update',
  'conversation_list',
  'conversation_search',
  'message_add',
  'message_list',
  'memory_stats',

  // Low-level binary I/O helpers used internally by analyze_media, OCR tools,
  // cloud-storage tools, etc. Their base64 payloads are huge and noisy in the
  // chain-of-thought trace.
  'read_file_binary',
  'read_file_base64',
  'upload_file_to_url',
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
  description?: string;
  liveOutput?: string;
  subagentId?: string;
  nested?: boolean;
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
| { type: 'text'; content: string; nested?: boolean; subagentId?: string }
| { type: 'reasoning'; content: string; nested?: boolean; subagentId?: string }
| { type: 'tool'; tool: ToolCall }
| {
  type: 'status';
  id?: string;
  variant?: 'compacting';
  label: string;
  state: 'active' | 'complete' | 'error';
  nested?: boolean;
  subagentId?: string;
  meta?: Record<string, any>;
};

// Hidden state for AI context - tracks IDs and tool results that should be remembered
// This is NOT rendered in the UI but sent to the AI for context continuity
export interface HiddenState {
  terminals: Map<string, { terminalId: string; command: string; status: 'running' | 'exited' | 'error'; exitCode?: number; createdAt: number; }>;
  subagents: Map<string, { taskId: string; objective: string; status: 'running' | 'completed' | 'failed' | 'cancelled'; result?: any; createdAt: number; }>;
  toolResults: Map<string, { toolCallId: string; tool: string; args: any; result: any; timestamp: number; }>;
  lastUpdated: number;
}

export interface HiddenStateSummary {
  terminals: Array<{ terminalId: string; command: string; status: string; exitCode?: number; }>;
  subagents: Array<{ taskId: string; objective: string; status: string; resultPreview?: string; }>;
  recentToolResults: Array<{ tool: string; resultPreview: string; timestamp: number; }>;
}

function getTerminalSessionId(payload: any): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;

  const directId = typeof payload.sessionId === 'string'
    ? payload.sessionId
    : typeof payload.terminalId === 'string'
      ? payload.terminalId
      : undefined;
  if (directId) return directId;

  const sessionId = typeof payload.session?.id === 'string' ? payload.session.id : undefined;
  return sessionId || undefined;
}

function getTerminalStatus(payload: any): 'running' | 'exited' | undefined {
  if (!payload || typeof payload !== 'object') return undefined;

  const sessionStatus = typeof payload.session?.status === 'string'
    ? payload.session.status.toLowerCase()
    : undefined;
  if (sessionStatus === 'running') return 'running';
  if (sessionStatus === 'exited') return 'exited';

  if (typeof payload.done === 'boolean') {
    return payload.done ? 'exited' : 'running';
  }

  return undefined;
}

function getRunningTerminalIds(toolCalls: ToolCall[]): string[] {
  const running = new Set<string>();

  for (const tc of toolCalls) {
    const toolName = String(tc.tool || '').trim();
    const result = tc.result;
    const args = tc.args;

    if (toolName === 'terminal_create' && tc.status === 'completed') {
      const sessionId = getTerminalSessionId(result);
      const status = getTerminalStatus(result);
      if (sessionId && status !== 'exited') {
        running.add(sessionId);
      }
      continue;
    }

    if (toolName === 'terminal_destroy' && tc.status === 'completed') {
      const sessionId = getTerminalSessionId(result) || (typeof args?.sessionId === 'string' ? args.sessionId : undefined);
      if (sessionId) running.delete(sessionId);
      continue;
    }

    if ((toolName === 'terminal_read' || toolName === 'terminal_wait_for' || toolName === 'terminal_get') && tc.status === 'completed') {
      const sessionId = getTerminalSessionId(result) || (typeof args?.sessionId === 'string' ? args.sessionId : undefined);
      const status = getTerminalStatus(result);
      if (!sessionId || !status) continue;
      if (status === 'exited') running.delete(sessionId);
      else running.add(sessionId);
    }
  }

  return Array.from(running);
}

export function createEmptyHiddenState(): HiddenState {
  return {
    terminals: new Map(),
    subagents: new Map(),
    toolResults: new Map(),
    lastUpdated: Date.now(),
  };
}

export function summarizeHiddenState(state: HiddenState, maxResults: number = 20): HiddenStateSummary {
  const terminals = Array.from(state.terminals.values()).map(t => ({
    terminalId: t.terminalId,
    command: t.command.slice(0, 100),
    status: t.status,
    exitCode: t.exitCode,
  }));
  const subagents = Array.from(state.subagents.values()).map(s => ({
    taskId: s.taskId,
    objective: s.objective.slice(0, 100),
    status: s.status,
    resultPreview: s.result ? JSON.stringify(s.result).slice(0, 200) : undefined,
  }));
  const toolResults = Array.from(state.toolResults.values())
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, maxResults)
    .map(r => ({
      tool: r.tool,
      resultPreview: JSON.stringify(r.result).slice(0, 300),
      timestamp: r.timestamp,
    }));
  return { terminals, subagents, recentToolResults: toolResults };
}

export function hiddenStateToContextString(state: HiddenState): string {
  const summary = summarizeHiddenState(state);
  const lines: string[] = ['[SESSION CONTEXT - IDs and recent tool results]'];
  
  if (summary.terminals.length > 0) {
    lines.push('\nActive Terminals:');
    for (const t of summary.terminals) {
      lines.push(`  - ${t.terminalId}: "${t.command}" (${t.status}${t.exitCode !== undefined ? `, exit: ${t.exitCode}` : ''})`);
    }
  }
  
  if (summary.subagents.length > 0) {
    lines.push('\nSubagent Tasks:');
    for (const s of summary.subagents) {
      lines.push(`  - ${s.taskId}: "${s.objective}" (${s.status}${s.resultPreview ? `, result: ${s.resultPreview}` : ''})`);
    }
  }
  
  if (summary.recentToolResults.length > 0) {
    lines.push('\nRecent Tool Results (use these instead of re-running):');
    for (const r of summary.recentToolResults.slice(0, 10)) {
      lines.push(`  - ${r.tool}: ${r.resultPreview}`);
    }
  }
  
  if (lines.length === 1) {
    return '';
  }
  
  lines.push('\n[END SESSION CONTEXT]');
  return lines.join('\n');
}

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
  attachments?: ChatAttachment[];
  modifiedFiles?: string[]; // Paths of files modified during this turn
  checkpointId?: string; // Checkpoint ID for reverting file changes
  reverted?: boolean; // Whether file changes have been reverted
  aborted?: boolean; // Whether the message was stopped/aborted
  // 'steer' marks user messages that were interjected mid-turn so the UI can
  // visually annotate them and split the surrounding chain-of-thought.
  kind?: 'message' | 'steer';
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
  attachments?: ChatAttachment[];
  context?: Record<string, any>;
  contextPaths?: ContextPath[]; // Files/folders from @ mention
  mode?: string;
  modelId?: string;
  modelConfig?: any;
  reasoningLevel?: 'none' | 'low' | 'medium' | 'high';
  silent?: boolean;
  targetTabId?: string;
  queueFront?: boolean;
}

type QueuedMessage = {
  id: string;
  text: string;
  timestamp: number;
  attachments?: ChatAttachment[];
  contextPaths?: ContextPath[];
  kind?: 'message' | 'steer';
  tabId?: string;
  requestId?: string;
};

type PendingSendItem = {
  id: string;
  text: string;
  timestamp: number;
  payload?: any;
  tabId?: string;
  requestId?: string;
  silent?: boolean;
  attachments?: ChatAttachment[];
  contextPaths?: ContextPath[];
};

type OutboundQueueItem = PendingSendItem & {
  payload: any;
  tabId: string;
};

interface ConversationTab {
  id: string; // Unique client-side ID for the tab
  serverId: string | null; // The actual conversation ID from server (null if new/unsaved)
  title: string;
  chatMode: ChatMode;
  chatModels: ChatModelsConfig;
  messages: Message[];
  currentResponse: string;
  currentReasoning: string;
  currentToolCalls: ToolCall[]; // Tool calls for current streaming response
  currentStreamChunks: StreamChunk[]; // Interleaved chunks in order
  aiState: AIStatus;
  agentState: AgentState;
  lastError: { code: string; data?: any } | null;
  hiddenState: HiddenState; // Session context for AI (not rendered in UI)
}

type DeferredDelegatedFinal = {
  requestId?: string;
  finalText: string;
  isAborted: boolean;
  reasoningDuration?: number;
  hadPartial: boolean;
  receivedAt: number;
};

function isPendingToolStatus(status?: string) {
  return status === 'called' || status === 'running';
}

function isDelegatedToolCall(tool?: ToolCall | null) {
  return Boolean(tool && (tool.tool === 'delegate' || tool.nested || !!tool.subagentId));
}

function hasPendingDelegatedToolWork(tab?: ConversationTab | null) {
  if (!tab) return false;
  if (tab.currentToolCalls.some((tool) => isDelegatedToolCall(tool) && isPendingToolStatus(tool.status))) {
    return true;
  }
  return tab.currentStreamChunks.some((chunk) => (
    (chunk.type === 'tool' && isDelegatedToolCall(chunk.tool) && isPendingToolStatus(chunk.tool.status)) ||
    (chunk.type === 'status' && chunk.nested === true && chunk.state === 'active')
  ));
}

interface UseAgentOptions {
  customAgentUrl?: string;
  onTitleUpdate?: (conversationId: string, title: string) => void;
  initialChatMode?: ChatMode;
  initialChatModels?: ChatModelsConfig;
}

export function useAgent(options?: string | UseAgentOptions) {
  // Parse options (support legacy string format)
  const customAgentUrl = typeof options === 'string' ? options : options?.customAgentUrl;
  const initialChatMode = (typeof options === 'object' && typeof options?.initialChatMode === 'string' && options.initialChatMode.trim())
    ? options.initialChatMode.trim()
    : DEFAULT_TAB_CHAT_MODE;
  const initialChatModels = cloneChatModelsConfig((typeof options === 'object' ? options?.initialChatModels : undefined) || DEFAULT_TAB_CHAT_MODELS);
  const onTitleUpdateRef = useRef<((cid: string, title: string) => void) | undefined>();
  onTitleUpdateRef.current = typeof options === 'object' ? options?.onTitleUpdate : undefined;

  // Tabs State
  const [tabs, setTabs] = useState<ConversationTab[]>([{
    id: 'default',
    serverId: null,
    title: 'New Chat',
    chatMode: initialChatMode,
    chatModels: cloneChatModelsConfig(initialChatModels),
    messages: [],
    currentResponse: '',
    currentReasoning: '',
    currentToolCalls: [],
    currentStreamChunks: [],
    aiState: { phase: 'idle', statusText: 'Idle' },
    agentState: { connected: false, connecting: false, status: 'disconnected' },
    lastError: null,
    hiddenState: createEmptyHiddenState(),
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
  const chatMode = activeTab?.chatMode || initialChatMode;
  const chatModels = activeTab?.chatModels || initialChatModels;

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
  const setTabLastError = (tabId: string, err: { code: string; data?: any } | null) => {
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, lastError: err } : t));
  };
  const setChatMode = useCallback((mode: ChatMode) => {
    const targetTabId = activeTabIdRef.current;
    const nextMode = (typeof mode === 'string' && mode.trim()) ? mode.trim() : DEFAULT_TAB_CHAT_MODE;
    setTabs(prev => prev.map(t => t.id === targetTabId ? { ...t, chatMode: nextMode } : t));
  }, []);
  const setChatModels = useCallback((cfg: ChatModelsConfig) => {
    const targetTabId = activeTabIdRef.current;
    setTabs(prev => prev.map(t => t.id === targetTabId ? { ...t, chatModels: cloneChatModelsConfig(cfg || DEFAULT_TAB_CHAT_MODELS) } : t));
  }, []);

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
  // chat_ui: maps AI SDK tool call id → bridge pending id, so submitToolOutput resolves the bridge
  const chatUiLastTcIdRef = useRef<string | null>(null);
  const chatUiBridgeMapRef = useRef<Map<string, string>>(new Map());

  const [pendingMemories, setPendingMemories] = useState<PendingMemory[]>([]);
  const [activeGenUITools, setActiveGenUITools] = useState<GenUIToolCall[]>([]);
  const [queueDepth, setQueueDepth] = useState<number>(0);
  const queueDepthRef = useRef<number>(0);
  const waitingQueuedStartRef = useRef<boolean>(false);
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>([]);
  const queuedMessagesRef = useRef<QueuedMessage[]>([]);
  const sendMessageRef = useRef<(options: SendMessageOptions) => Promise<void>>(async () => {});
  // Tracks tabs whose current turn already has a partial assistant message committed
  // ahead of a steer interjection. When set, the 'final' handler must commit only the
  // post-steer chunks (t.currentResponse) instead of the server's full-turn finalText
  // to avoid duplicating the pre-steer content.
  const turnHadPartialCommitRef = useRef<Map<string, boolean>>(new Map());
  const pendingSendRef = useRef<PendingSendItem[]>([]);
  const outboundQueueRef = useRef<OutboundQueueItem[]>([]);
  const runningTabsRef = useRef<Set<string>>(new Set());
  const reasoningStartTimeRef = useRef<number | null>(null); // Track when reasoning started
  const lastStreamActivityRef = useRef<number>(0); // Watchdog: last time we received streaming data
  const modifiedFilesRef = useRef<Set<string>>(new Set()); // Track files modified in current turn
  const turnCheckpointIdRef = useRef<string | null>(null); // Checkpoint ID for current turn
  const activeSubagentsByTabRef = useRef<Map<string, Set<string>>>(new Map());
  const deferredDelegatedFinalsRef = useRef<Map<string, DeferredDelegatedFinal>>(new Map());

  // Last model selection used by sendMessage per tab, so fallback resends
  // (e.g. unhandled steers reposted after a turn ends) inherit the same model
  // instead of letting the server fall back to its default tier.
  type LastSendModelOptions = {
    mode?: string;
    modelId?: string;
    modelConfig?: any;
    reasoningLevel?: 'none' | 'low' | 'medium' | 'high';
    context?: Record<string, any>;
  };
  const lastSendOptionsRef = useRef<Map<string, LastSendModelOptions>>(new Map());

  // File-modifying tool names
  const FILE_MODIFYING_TOOLS = new Set([
    'write_file', 'write_file_base64', 'delete_file', 'move_file', 'copy_file',
    'workspace_write_file', 'workspace_delete_file', 'workspace_create_folder',
    'create_directory', 'edit_and_apply', 'edit_file', 'file_edit', 'patch_file',
    'run_command', 'run_system_command', 'run_python_script', 'run_node_script',
  ]);

  const getActiveSubagentCount = (tabId?: string | null) => {
    if (!tabId) return 0;
    return activeSubagentsByTabRef.current.get(tabId)?.size || 0;
  };

  const hasActiveOrPendingDelegatedWork = (tab?: ConversationTab | null) => {
    if (!tab) return false;
    return getActiveSubagentCount(tab.id) > 0 || hasPendingDelegatedToolWork(tab);
  };

  const markSubagentActive = (tabId: string, subagentId: string) => {
    if (!tabId || !subagentId) return;
    const set = activeSubagentsByTabRef.current.get(tabId) || new Set<string>();
    set.add(subagentId);
    activeSubagentsByTabRef.current.set(tabId, set);
  };

  const markSubagentFinished = (tabId: string, subagentId: string) => {
    if (!tabId || !subagentId) return;
    const set = activeSubagentsByTabRef.current.get(tabId);
    if (!set) return;
    set.delete(subagentId);
    if (set.size === 0) {
      activeSubagentsByTabRef.current.delete(tabId);
    }
  };

  // Tab Management
  const addTab = useCallback((tab: Partial<ConversationTab> = {}) => {
    const id = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const sourceTab = tabsRef.current.find(t => t.id === activeTabIdRef.current) || tabsRef.current[0];
    const newTab: ConversationTab = {
      id,
      serverId: null,
      title: 'New Chat',
      chatMode: sourceTab?.chatMode || initialChatMode,
      chatModels: cloneChatModelsConfig(sourceTab?.chatModels || initialChatModels),
      messages: [],
      currentResponse: '',
      currentReasoning: '',
      currentToolCalls: [],
      currentStreamChunks: [],
      aiState: { phase: 'idle', statusText: 'Idle' },
      agentState: { connected: state.connected, connecting: state.connecting, status: state.status },
      lastError: null,
      hiddenState: createEmptyHiddenState(),
      ...tab
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(id);
    return id;
  }, [state.connected, state.connecting, state.status, initialChatMode, initialChatModels]);

  const closeTab = useCallback((id: string) => {
    // Clean up request tracking for the closed tab
    runningTabsRef.current.delete(id);
    activeSubagentsByTabRef.current.delete(id);
    deferredDelegatedFinalsRef.current.delete(id);
    lastSendOptionsRef.current.delete(id);
    // Remove any requestId -> tabId mappings pointing to this tab
    for (const [reqId, tabId] of requestIdToTabRef.current.entries()) {
      if (tabId === id) {
        requestIdToTabRef.current.delete(reqId);
        // Tell the server to stop any active stream for this request
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          try { wsRef.current.send(JSON.stringify({ type: 'stop', requestId: reqId })); } catch { }
        }
      }
    }
    // Remove from pending response queue
    pendingResponseTabsRef.current = pendingResponseTabsRef.current.filter(t => t !== id);
    // Remove any outbound queue items for this tab
    outboundQueueRef.current = outboundQueueRef.current.filter(item => item.tabId !== id);
    pendingSendRef.current = pendingSendRef.current.filter(item => item.tabId !== id);

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
      const wsOpen = !!(wsRef.current && wsRef.current.readyState === WebSocket.OPEN);

      if (wsOpen) {
        const targetTabId = activeTabIdRef.current;
        let targetRequestId: string | undefined;
        for (const [reqId, tabId] of requestIdToTabRef.current.entries()) {
          if (tabId === targetTabId) { targetRequestId = reqId; break; }
        }
        const stopPayload: any = { type: 'stop' };
        if (targetRequestId) stopPayload.requestId = targetRequestId;
        wsRef.current!.send(JSON.stringify(stopPayload));
      }

      streamingRef.current = false;
      stoppedRef.current = true;
      if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
      deltaBufferRef.current = '';

      const targetTabId = activeTabIdRef.current;
      activeSubagentsByTabRef.current.delete(targetTabId);
      deferredDelegatedFinalsRef.current.delete(targetTabId);
      setTabs(prev => prev.map(t => {
        if (t.id !== targetTabId) return t;
        const hasWork = t.currentToolCalls.length > 0 || t.currentStreamChunks.length > 0 || t.currentResponse || t.currentReasoning;
        if (!hasWork) {
          return { ...t, aiState: { ...t.aiState, phase: 'idle', statusText: 'Stopped' } };
        }
        return {
          ...t,
          messages: [...t.messages, {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            role: 'assistant' as const,
            text: (t.currentResponse || '') + '\n\n*(Stopped)*',
            reasoning: t.currentReasoning || undefined,
            toolCalls: t.currentToolCalls.length > 0 ? [...t.currentToolCalls] : undefined,
            streamChunks: t.currentStreamChunks.length > 0 ? [...t.currentStreamChunks] : undefined,
            timestamp: Date.now(),
            aborted: true,
          }],
          currentResponse: '',
          currentReasoning: '',
          currentToolCalls: [],
          currentStreamChunks: [],
          aiState: { ...t.aiState, phase: 'idle', statusText: 'Stopped' },
        };
      }));

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

  const submitToolOutput = useCallback(async (tcId: string, result: any) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.warn('[agent] Cannot submit tool output: agent not connected');
      return;
    }
    // chat_ui uses a bridge whose pending is keyed by its own generated id (different from the
    // AI SDK's tool call id). Resolve via the mapped bridge id so the agent unblocks.
    const bridgeId = chatUiBridgeMapRef.current.get(tcId);
    if (bridgeId) {
      wsRef.current.send(JSON.stringify({ type: 'tool_result', id: bridgeId, result }));
      chatUiBridgeMapRef.current.delete(tcId);
      return;
    }
    wsRef.current.send(JSON.stringify({ type: 'tool_result', id: tcId, result }));
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
      next.requestId = requestId;
      pendingSendRef.current = pendingSendRef.current.map((item) =>
        item.id === next.id ? { ...item, requestId } : item
      );
      const nextQueuedMessages = queuedMessagesRef.current.map((item) =>
        item.id === next.id ? { ...item, requestId } : item
      );
      queuedMessagesRef.current = nextQueuedMessages;
      queueDepthRef.current = nextQueuedMessages.length;
      setQueuedMessages(nextQueuedMessages);
      setQueueDepth(nextQueuedMessages.length);

      // Set tracking refs
      streamingTabIdRef.current = targetTabId;
      activeRequestIdRef.current = requestId;
      // Add to pending response queue (legacy fallback)
      pendingResponseTabsRef.current.push(targetTabId);

      // If there were queued items visible for this tab, mark that the next start should promote from queue
      waitingQueuedStartRef.current = queuedMessagesRef.current.some((item) => item.kind !== 'steer' && item.tabId === targetTabId);
      // Mark this tab as running
      runningTabsRef.current.add(targetTabId);

      // Add requestId to payload for server to echo back
      const payload = { ...next.payload, requestId };

      stoppedRef.current = false;
      lastStreamActivityRef.current = Date.now();
      try { wsRef.current.send(JSON.stringify(payload)); } catch { }

      // Update this specific tab's AI state
      setTabs(prev => prev.map(t =>
        t.id === targetTabId ? { ...t, aiState: { phase: 'routing', statusText: 'Thinking…' } } : t
      ));

      // Try to send more messages for other tabs (parallel processing)
      tryDequeueAndSend();
    } catch { }
  }, []);

  const syncQueuedMessages = useCallback((updater: QueuedMessage[] | ((prev: QueuedMessage[]) => QueuedMessage[])) => {
    const prev = queuedMessagesRef.current;
    const next = typeof updater === 'function' ? updater(prev) : updater;
    queuedMessagesRef.current = next;
    queueDepthRef.current = next.length;
    setQueuedMessages(next);
    setQueueDepth(next.length);
  }, []);

  const cancelQueuedMessage = useCallback((id: string) => {
    if (!id) return;
    outboundQueueRef.current = outboundQueueRef.current.filter((item) => item.id !== id);
    pendingSendRef.current = pendingSendRef.current.filter((item) => item.id !== id);
    syncQueuedMessages((prev) => prev.filter((msg) => msg.id !== id));
  }, [syncQueuedMessages]);

  const getRequestIdForTab = useCallback((tabId: string): string | undefined => {
    for (const [rid, mappedTabId] of requestIdToTabRef.current.entries()) {
      if (mappedTabId === tabId) return rid;
    }
    return activeRequestIdRef.current || undefined;
  }, []);

  const queueSteeringMessage = useCallback((text: string): boolean => {
    const trimmed = String(text || '').trim();
    if (!trimmed) return false;

    const targetTabId = activeTabIdRef.current;
    if (!runningTabsRef.current.has(targetTabId)) return false;

    const requestId = getRequestIdForTab(targetTabId);
    if (!requestId) return false;

    const item: QueuedMessage = {
      id: `steer-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      text: trimmed,
      timestamp: Date.now(),
      kind: 'steer',
      tabId: targetTabId,
      requestId,
    };

    // Send the interjection to the server immediately. The server's prepareStep
    // runs synchronously after each step_finished, so deferring this send to the
    // step_finished event would lose the round-trip race and the next step would
    // drain an empty queue. Sending now lets the server stash the interjection
    // and pick it up on the next step boundary.
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({
          type: 'interjection',
          requestId,
          text: trimmed,
          timestamp: item.timestamp,
        }));
      } catch { }
    }

    syncQueuedMessages((prev) => [...prev, item]);
    setTabs(prev => prev.map(t =>
      t.id === targetTabId
        ? { ...t, aiState: { ...t.aiState, statusText: 'Steer queued for next step' } }
        : t
    ));
    setState((s) => ({ ...s, status: 'queued' }));
    return true;
  }, [getRequestIdForTab, syncQueuedMessages]);

  // Nudge a specific running delegated subagent. Unlike steerMessage (which
  // targets the orchestrator/main turn), this routes through the cloud WS to
  // the in-process steer queue for that subagentId and is drained at the
  // subagent's next step boundary (never mid-tool-call).
  const steerSubagent = useCallback((subagentId: string, text: string): boolean => {
    const trimmed = String(text || '').trim();
    if (!subagentId || !trimmed) return false;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(JSON.stringify({
        type: 'subagent_steer',
        subagentId,
        text: trimmed,
        timestamp: Date.now(),
      }));
      return true;
    } catch {
      return false;
    }
  }, []);

  // Expose globally so nested components (e.g. DelegationCard inside
  // MessageBubble) can call it without deep prop drilling. Matches the
  // existing window-based pattern (__AGENT_HTTP__).
  useEffect(() => {
    (window as any).__stuardSteerSubagent__ = steerSubagent;
    return () => {
      if ((window as any).__stuardSteerSubagent__ === steerSubagent) {
        delete (window as any).__stuardSteerSubagent__;
      }
    };
  }, [steerSubagent]);

  const flushQueuedSteeringMessages = useCallback((targetTabId: string, requestId?: string) => {
    // The interjection is sent to the server eagerly in queueSteeringMessage so it
    // races ahead of the next step's prepareStep. This routine handles only the
    // local chat-history commit at the step_finished boundary: move queued steers
    // for this turn into the chat alongside the interrupted CoT.
    const queued = queuedMessagesRef.current.filter((item) =>
      item.kind === 'steer'
      && item.tabId === targetTabId
      && (!requestId || item.requestId === requestId)
    );
    if (queued.length === 0) return;

    const sent: QueuedMessage[] = queued;
    const sentIds = new Set(sent.map((item) => item.id));
    syncQueuedMessages((prev) => prev.filter((item) => !sentIds.has(item.id)));
    setTabs(prev => prev.map(t => {
      if (t.id !== targetTabId) return t;

      // Commit any in-flight assistant work (the step that was just interrupted)
      // as its own assistant message ahead of the steer, so the chat order reads:
      //   [user] → [interrupted CoT] → [steer] → [next CoT]
      // rather than the steer landing before the CoT it was responding to.
      const hasInFlightWork =
        t.currentToolCalls.length > 0
        || t.currentStreamChunks.length > 0
        || Boolean(t.currentResponse)
        || Boolean(t.currentReasoning);

      const partialAssistant: Message[] = hasInFlightWork ? [{
        id: `partial-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: 'assistant' as const,
        text: t.currentResponse || '',
        reasoning: t.currentReasoning || undefined,
        toolCalls: t.currentToolCalls.length > 0 ? [...t.currentToolCalls] : undefined,
        streamChunks: t.currentStreamChunks.length > 0 ? [...t.currentStreamChunks] : undefined,
        timestamp: Date.now(),
      }] : [];

      const steeringMessages: Message[] = sent.map((item) => ({
        id: item.id,
        role: 'user' as const,
        text: item.text,
        timestamp: item.timestamp,
        kind: 'steer' as const,
      }));

      if (hasInFlightWork) {
        turnHadPartialCommitRef.current.set(t.id, true);
      }

      return {
        ...t,
        messages: [...t.messages, ...partialAssistant, ...steeringMessages],
        currentResponse: hasInFlightWork ? '' : t.currentResponse,
        currentReasoning: hasInFlightWork ? '' : t.currentReasoning,
        currentToolCalls: hasInFlightWork ? [] : t.currentToolCalls,
        currentStreamChunks: hasInFlightWork ? [] : t.currentStreamChunks,
        aiState: { ...t.aiState, statusText: 'Steer sent to next step' },
      };
    }));
  }, [syncQueuedMessages]);

  const finishCompletedTurn = (completedTabId: string, completedRequestId: string | undefined, isAborted: boolean) => {
    if (completedRequestId) {
      requestIdToTabRef.current.delete(completedRequestId);
      if (activeRequestIdRef.current === completedRequestId) {
        activeRequestIdRef.current = null;
      }
    }
    pendingSendRef.current = pendingSendRef.current.filter((item) =>
      completedRequestId ? item.requestId !== completedRequestId : item.tabId !== completedTabId
    );
    syncQueuedMessages((prev) => prev.filter((item) =>
      item.kind === 'steer'
        || (completedRequestId ? item.requestId !== completedRequestId : item.tabId !== completedTabId)
    ));
    const fifoIdx = pendingResponseTabsRef.current.indexOf(completedTabId);
    if (fifoIdx !== -1) pendingResponseTabsRef.current.splice(fifoIdx, 1);
    runningTabsRef.current.delete(completedTabId);
    turnHadPartialCommitRef.current.delete(completedTabId);
    if (streamingTabIdRef.current === completedTabId) {
      streamingTabIdRef.current = null;
    }

    const fallbackSteers = queuedMessagesRef.current.filter((item) =>
      item.kind === 'steer'
      && item.tabId === completedTabId
      && (completedRequestId ? item.requestId === completedRequestId : true)
    );
    if (!isAborted && fallbackSteers.length > 0) {
      const fallbackIds = new Set(fallbackSteers.map((item) => item.id));
      const fallbackText = fallbackSteers
        .map((item) => item.text.trim())
        .filter(Boolean)
        .join('\n\n');
      syncQueuedMessages((prev) => prev.filter((item) => !fallbackIds.has(item.id)));
      if (fallbackText) {
        const lastOpts = lastSendOptionsRef.current.get(completedTabId);
        setTimeout(() => {
          void sendMessageRef.current({
            text: fallbackText,
            targetTabId: completedTabId,
            queueFront: true,
            mode: lastOpts?.mode,
            modelId: lastOpts?.modelId,
            modelConfig: lastOpts?.modelConfig,
            reasoningLevel: lastOpts?.reasoningLevel,
            context: lastOpts?.context,
          });
        }, 0);
      } else {
        tryDequeueAndSend();
      }
    } else {
      tryDequeueAndSend();
    }
  };

  const commitDeferredDelegatedFinalIfReady = (tabId: string, requestId?: string, ignorePendingDelegatedTools = false) => {
    const deferred = deferredDelegatedFinalsRef.current.get(tabId);
    if (!deferred) return false;
    const currentTab = tabsRef.current.find(t => t.id === tabId);
    if (!currentTab) return false;
    if (getActiveSubagentCount(tabId) > 0) return false;
    if (!ignorePendingDelegatedTools && hasPendingDelegatedToolWork(currentTab)) return false;

    deferredDelegatedFinalsRef.current.delete(tabId);
    const completedRequestId = requestId || deferred.requestId;
    const turnModifiedFiles = modifiedFilesRef.current.size > 0
      ? Array.from(modifiedFilesRef.current)
      : undefined;
    const turnCheckpointId = turnCheckpointIdRef.current || undefined;
    modifiedFilesRef.current = new Set();
    turnCheckpointIdRef.current = null;
    streamingRef.current = false;
    stoppedRef.current = false;

    setTabs(prev => prev.map(t => {
      if (t.id !== tabId) return t;
      const displayText = (deferred.isAborted || deferred.hadPartial) && t.currentResponse
        ? t.currentResponse
        : (t.currentResponse || deferred.finalText);
      const hasAccumulatedWork = t.currentToolCalls.length > 0 || t.currentStreamChunks.length > 0 || t.currentReasoning;
      const shouldCommitMessage = displayText || hasAccumulatedWork;

      return {
        ...t,
        messages: shouldCommitMessage ? [...t.messages, {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          role: 'assistant' as const,
          text: (displayText || '') + (deferred.isAborted ? '\n\n*(Stopped)*' : ''),
          reasoning: t.currentReasoning || undefined,
          reasoningDuration: t.currentReasoning ? deferred.reasoningDuration : undefined,
          toolCalls: t.currentToolCalls.length > 0 ? [...t.currentToolCalls] : undefined,
          streamChunks: t.currentStreamChunks.length > 0 ? [...t.currentStreamChunks] : undefined,
          timestamp: Date.now(),
          aborted: deferred.isAborted,
          modifiedFiles: turnModifiedFiles,
          checkpointId: turnCheckpointId,
        }] : t.messages,
        currentResponse: '',
        currentReasoning: '',
        currentToolCalls: [],
        currentStreamChunks: [],
        aiState: { ...t.aiState, phase: 'idle', statusText: deferred.isAborted ? 'Stopped' : 'Idle' },
        agentState: { ...t.agentState, status: deferred.isAborted ? 'stopped' : 'idle' },
      };
    }));

    refreshPendingMemories();
    finishCompletedTurn(tabId, completedRequestId, deferred.isAborted);
    setTabLastError(tabId, null);
    return true;
  };

  const queueDeferredDelegatedFinalCheck = (tabId: string, requestId?: string, ignorePendingDelegatedTools = false) => {
    if (!deferredDelegatedFinalsRef.current.has(tabId)) return;
    setTimeout(() => { commitDeferredDelegatedFinalIfReady(tabId, requestId, ignorePendingDelegatedTools); }, 0);
    setTimeout(() => { commitDeferredDelegatedFinalIfReady(tabId, requestId, ignorePendingDelegatedTools); }, 100);
  };

  const agentHealthyRef = useRef<boolean>(false);

  const connect = useCallback(() => {
    const ready = wsRef.current?.readyState;
    if (ready === WebSocket.OPEN || ready === WebSocket.CONNECTING) return;

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
    const wsToHttp = (wsUrl: string) => {
      try {
        let base = wsUrl.replace(/\/ws\/?$/, '');
        if (base.startsWith('wss://')) base = 'https://' + base.slice(6);
        else if (base.startsWith('ws://')) base = 'http://' + base.slice(5);
        return base;
      } catch {
        return 'http://127.0.0.1:8765';
      }
    };
    const hinted = hintedWs || (hintedHttp ? httpToWs(hintedHttp) : '');
    const target = customAgentUrl || hinted || 'ws://127.0.0.1:8765/ws';
    const healthUrl = (hintedHttp || wsToHttp(target)) + '/health';

    if (!agentHealthyRef.current) {
      setState((s) => ({ ...s, connecting: true, status: 'connecting' }));
      setAI({ phase: 'connecting', statusText: 'Starting…' });
      fetch(healthUrl, { signal: AbortSignal.timeout(2000) })
        .then(r => {
          if (!r.ok) throw new Error('not ready');
          agentHealthyRef.current = true;
          connect();
        })
        .catch(() => {
          if (!reconnectTimerRef.current) {
            reconnectTimerRef.current = setTimeout(() => {
              reconnectTimerRef.current = null;
              connect();
            }, 1500);
          }
        });
      return;
    }

    setState((s) => ({ ...s, connecting: true, status: 'connecting' }));
    setAI({ phase: 'connecting', statusText: 'Connecting…' });

    try {
      const ws = new WebSocket(target);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[agent] Connected');
        setState({ connected: true, connecting: false, status: 'connected' });
        setAI({ phase: 'idle', statusText: 'Ready' });
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
          if (msg.type !== 'progress' && msg.type !== 'request') {
            console.log('[agent] Received:', msg.type);
          }

          if (msg.type === 'progress' || msg.type === 'final' || msg.type === 'subagent_event' || msg.type === 'stopped' || msg.type === 'queued') {
            lastStreamActivityRef.current = Date.now();
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

            // chat_ui renders inline in the message bubble (not via desktopAPI.execTool).
            // The bridge pending id differs from the AI SDK's tc.id, so we map them here.
            // submitToolOutput then resolves the bridge via the mapped id when user submits.
            if (tool === 'chat_ui') {
              const tcId = chatUiLastTcIdRef.current;
              if (tcId) {
                chatUiBridgeMapRef.current.set(tcId, id);
              }
              if (args?.blocking !== true) {
                if (wsRef.current?.readyState === WebSocket.OPEN) {
                  wsRef.current.send(JSON.stringify({ type: 'tool_result', id, result: { ok: true, displayed: true } }));
                }
              }
              // blocking=true: wait — user submits via ChatUIRenderer.onResult → submitToolOutput(tc.id)
              // which looks up chatUiBridgeMapRef and sends tool_result with the bridge id.
              return;
            }

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
          } else if (msg.type === 'request' && msg.event && String(msg.event).startsWith('unified_tasks_')) {
            // Handle unified_tasks requests from agent (broadcasted to all connected clients)
            const { id, event, data } = msg;
            (async () => {
              let result: any = { ok: false, error: 'unknown_event' };
              try {
                const api = (window as any).desktopAPI;
                if (event === 'unified_tasks_list') {
                  result = await api?.unifiedTasksList?.();
                } else if (event === 'unified_tasks_add') {
                  result = await api?.unifiedTasksAdd?.(data);
                } else if (event === 'unified_tasks_update') {
                  result = await api?.unifiedTasksUpdate?.(data);
                } else if (event === 'unified_tasks_delete') {
                  result = await api?.unifiedTasksDelete?.(data?.id);
                } else if (event === 'unified_tasks_get_task') {
                  result = await api?.unifiedTasksGet?.(data?.taskId);
                } else if (event === 'unified_tasks_get_pending') {
                  result = await api?.unifiedTasksGetPendingAssignments?.();
                } else if (event === 'unified_tasks_add_subtodo') {
                  result = await api?.unifiedTasksAddSubtodo?.(data?.taskId, data?.subtodo);
                } else if (event === 'unified_tasks_update_subtodo') {
                  result = await api?.unifiedTasksUpdateSubtodo?.(data?.taskId, data?.subtodoId, data?.updates);
                } else if (event === 'unified_tasks_toggle_subtodo') {
                  result = await api?.unifiedTasksToggleSubtodo?.(data?.taskId, data?.subtodoId);
                } else if (event === 'unified_tasks_delete_subtodo') {
                  result = await api?.unifiedTasksDeleteSubtodo?.(data?.taskId, data?.subtodoId);
                } else if (event === 'unified_tasks_add_agent_assignment') {
                  result = await api?.unifiedTasksAddReminder?.(data?.taskId, data?.assignment);
                } else if (event === 'unified_tasks_update_agent_assignment') {
                  result = await api?.unifiedTasksUpdateAgentAssignment?.(data?.taskId, data?.assignmentId, data?.updates);
                } else if (event === 'unified_tasks_delete_agent_assignment') {
                  result = await api?.unifiedTasksDeleteReminder?.(data?.taskId, data?.assignmentId);
                } else if (event === 'unified_tasks_mark_triggered') {
                  result = { ok: true };
                } else if (event === 'unified_tasks_mark_completed') {
                  result = await api?.unifiedTasksUpdateAgentAssignment?.(data?.taskId, data?.assignmentId, { status: 'completed' });
                }
              } catch (e: any) {
                result = { ok: false, error: String(e?.message || e) };
              }
              if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ type: 'response', id, data: result }));
              }
            })();
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
              const targetTabId = getTargetTabId();
              const requestId = typeof msg.requestId === 'string' ? msg.requestId : undefined;
              // Reset file tracking for new turn (checkpoint created lazily by backend on first file modification)
              modifiedFilesRef.current = new Set();
              turnCheckpointIdRef.current = null;
              // New turn — clear any partial-commit flag from a previous turn on this tab.
              turnHadPartialCommitRef.current.delete(targetTabId);

              // Promote only the pending message that belongs to this request.
              // A stopped turn can leave an older pending item behind; using FIFO
              // here lets a later tab accidentally render/send that stale message.
              const queuedIndex = queuedMessagesRef.current.findIndex((item) =>
                item.kind !== 'steer'
                && (requestId ? item.requestId === requestId : item.tabId === targetTabId)
              );
              const queuedMatch = queuedIndex >= 0 ? queuedMessagesRef.current[queuedIndex] : undefined;
              const pendingIndex = pendingSendRef.current.findIndex((item) =>
                requestId ? item.requestId === requestId : item.tabId === targetTabId
              );
              const pendingMatch = pendingIndex >= 0 ? pendingSendRef.current[pendingIndex] : undefined;
              const messageToPromote = queuedMatch || pendingMatch;

              if (messageToPromote) {
                pendingSendRef.current = pendingSendRef.current.filter((item) => item.id !== messageToPromote.id);
                if (queuedMatch) {
                  syncQueuedMessages((prev) => prev.filter((item) => item.id !== queuedMatch.id));
                }
                const promoteSilently = pendingMatch?.id === messageToPromote.id && pendingMatch.silent === true;
                if (!promoteSilently) {
                  updateStreamingTab(t => {
                    // Avoid duplicates if message was added optimistically.
                    if (t.messages.some(m => m.id === messageToPromote.id)) return t;
                    return {
                      ...t,
                      messages: [...t.messages, {
                        id: messageToPromote.id,
                        role: 'user',
                        text: messageToPromote.text,
                        timestamp: messageToPromote.timestamp,
                        attachments: messageToPromote.attachments,
                        contextPaths: messageToPromote.contextPaths,
                      }],
                    };
                  });
                }
              }
              waitingQueuedStartRef.current = false;
              setTabLastError(targetTabId, null);
            } else if (evt.event === 'ack') {
              // Server acknowledged receipt - show immediate feedback
              setStreamingAI((prev) => {
                if (prev.phase === 'tool') return prev;
                return { ...prev, phase: 'responding', statusText: 'Processing…' };
              });
              setState((s) => ({ ...s, status: 'processing' }));
            } else if (evt.event === 'reasoning_start') {
              console.log('[agent] Reasoning started');
              reasoningStartTimeRef.current = Date.now();
              // Add initial reasoning chunk so streaming bubble renders immediately with chain-of-thought
              updateStreamingTab(t => {
                const chunks = [...t.currentStreamChunks];
                const hasReasoningChunk = chunks.some(ch => ch.type === 'reasoning');
                if (!hasReasoningChunk) {
                  chunks.push({ type: 'reasoning' as const, content: '' });
                }
                return { ...t, currentStreamChunks: chunks };
              });
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
              if (chunk) {
                updateStreamingTab(t => {
                  const newReasoning = mergeStreamingText(t.currentReasoning, chunk);
                  const chunks = [...t.currentStreamChunks];
                  const lastChunk = chunks[chunks.length - 1];
                  if (lastChunk?.type === 'reasoning') {
                    chunks[chunks.length - 1] = {
                      type: 'reasoning',
                      content: mergeStreamingText(lastChunk.content, chunk),
                    };
                  } else {
                    chunks.push({ type: 'reasoning', content: chunk });
                  }
                  return { ...t, currentReasoning: newReasoning, currentStreamChunks: chunks };
                });
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
              const rawSubagentId = typeof evt.data?.subagentId === 'string'
                ? evt.data.subagentId.trim()
                : '';
              const isNestedToolEvent = evt.data?.nested === true || rawSubagentId.length > 0;
              const applyToolNesting = (toolCall: ToolCall, existing?: ToolCall): ToolCall => {
                const subagentId = rawSubagentId || existing?.subagentId;
                const nested = isNestedToolEvent || Boolean(existing?.nested) || Boolean(subagentId);
                return {
                  ...toolCall,
                  ...(subagentId ? { subagentId } : {}),
                  ...(nested ? { nested: true } : {}),
                };
              };
              const pendingToolMatchesEvent = (tc: ToolCall): boolean => {
                if (tc.tool !== tool || tc.status !== 'called') return false;
                const tcNested = Boolean(tc.nested || tc.subagentId);
                if (rawSubagentId) return tc.subagentId === rawSubagentId;
                if (isNestedToolEvent) return tcNested;
                return !tcNested;
              };

              const requestIdKey = String(msg.requestId || activeRequestIdRef.current || '');

              if (
                (tool === 'start_terminal' ||
                  tool === 'run_terminal_command' ||
                  tool === 'terminal_create' ||
                  tool === 'run_command') &&
                (normalizedStatus === 'called' || normalizedStatus === 'started')
              ) {
                try {
                  window.dispatchEvent(
                    new CustomEvent('agent-terminal-activity', { detail: evt.data?.args }),
                  );
                } catch {}
              }

              const updateHiddenStateForTool = (toolName: string, args: any, result: any) => {
                const now = Date.now();
                updateStreamingTab(t => {
                  const newHiddenState = { ...t.hiddenState, lastUpdated: now };
                  if (toolName === 'start_terminal' || toolName === 'run_terminal_command') {
                    const terminalId = result?.terminalId || result?.id || args?.terminalId;
                    if (terminalId) {
                      const termMap = new Map(t.hiddenState.terminals);
                      termMap.set(terminalId, {
                        terminalId,
                        command: args?.command || '',
                        status: 'running',
                        createdAt: now,
                      });
                      newHiddenState.terminals = termMap;
                    }
                  }
                  if (toolName === 'deploy_headless_agent') {
                    const taskId = result?.taskId || result?.id || args?.taskId;
                    if (taskId) {
                      const subagentMap = new Map(t.hiddenState.subagents);
                      subagentMap.set(taskId, {
                        taskId,
                        objective: args?.objective || args?.prompt || '',
                        status: 'running',
                        createdAt: now,
                      });
                      newHiddenState.subagents = subagentMap;
                    }
                  }
                  if (result?.terminalId && (result?.status === 'exited' || result?.done === true)) {
                    const termMap = new Map(t.hiddenState.terminals);
                    const existing = termMap.get(result.terminalId);
                    if (existing) {
                      termMap.set(result.terminalId, {
                        ...existing,
                        status: 'exited',
                        exitCode: result?.exitCode,
                      });
                      newHiddenState.terminals = termMap;
                    }
                  }
                  if (result?.taskId && (result?.status === 'completed' || result?.status === 'failed' || result?.status === 'cancelled')) {
                    const subagentMap = new Map(t.hiddenState.subagents);
                    const existing = subagentMap.get(result.taskId);
                    if (existing) {
                      subagentMap.set(result.taskId, {
                        ...existing,
                        status: result.status,
                        result: result?.result,
                      });
                      newHiddenState.subagents = subagentMap;
                    }
                  }
                  const resultMap = new Map(t.hiddenState.toolResults);
                  resultMap.set(toolCallId, {
                    toolCallId,
                    tool: toolName,
                    args,
                    result,
                    timestamp: now,
                  });
                  if (resultMap.size > 50) {
                    const entries = Array.from(resultMap.entries());
                    entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
                    resultMap.clear();
                    entries.slice(0, 50).forEach(([k, v]) => resultMap.set(k, v));
                  }
                  newHiddenState.toolResults = resultMap;
                  return { ...t, hiddenState: newHiddenState };
                });
              };

              const emitSyntheticTool = (toolName: string, syntheticId: string, status: ToolCall['status'], args?: any, result?: any, error?: any) => {
                updateStreamingTab(t => {
                  const existingIdx = t.currentToolCalls.findIndex(tc => tc.id === syntheticId);
                  const existing = existingIdx >= 0 ? t.currentToolCalls[existingIdx] : undefined;
                  const nextCall = applyToolNesting(
                    existing
                      ? { ...existing, tool: toolName, status, args: typeof args !== 'undefined' ? args : existing.args, result: typeof result !== 'undefined' ? result : existing.result, error: typeof error !== 'undefined' ? error : existing.error }
                      : { id: syntheticId, tool: toolName, status, args, result, error, timestamp: Date.now() },
                    existing,
                  );

                  const nextToolCalls = existingIdx >= 0
                    ? t.currentToolCalls.map(tc => tc.id === syntheticId ? nextCall : tc)
                    : [...t.currentToolCalls, nextCall];

                  const chunkExists = t.currentStreamChunks.some(ch => ch.type === 'tool' && ch.tool.id === syntheticId);
                  const nextChunks = chunkExists
                    ? t.currentStreamChunks.map(ch => (ch.type === 'tool' && ch.tool.id === syntheticId) ? { ...ch, tool: nextCall } : ch)
                    : [...t.currentStreamChunks, { type: 'tool' as const, tool: nextCall }];

                  return { ...t, currentToolCalls: nextToolCalls, currentStreamChunks: nextChunks };
                });
                if (status === 'completed' && result) {
                  updateHiddenStateForTool(toolName, args, result);
                }
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

              // Track chat_ui's AI SDK tool call id so tool_request can map it to the bridge id
              if (tool === 'chat_ui' && (normalizedStatus === 'called' || normalizedStatus === 'started') && evt.data?.toolCallId) {
                chatUiLastTcIdRef.current = evt.data.toolCallId;
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
                        tc.id === toolCallId || pendingToolMatchesEvent(tc)
                      );

                      if (existingIdx >= 0) {
                        // Already exists - just update args if needed, don't duplicate
                        return t;
                      }

                      // Add new tool call
                      const newCall = applyToolNesting({
                        id: toolCallId,
                        tool,
                        status: 'called',
                        args: d.args,
                        timestamp: Date.now(),
                        description: toolDescription,
                      });
                      return {
                        ...t,
                        currentToolCalls: [...t.currentToolCalls, newCall],
                        // Add tool chunk to stream for interleaved display
                        currentStreamChunks: [...t.currentStreamChunks, { type: 'tool' as const, tool: newCall }]
                      };
                    });
                  } else if (normalizedStatus === 'completed' || normalizedStatus === 'error' || normalizedStatus === 'failed' || normalizedStatus === 'timeout') {
                    // Update existing tool call with result in both arrays
                    const newStatus = normalizedStatus === 'completed' ? 'completed' : 'error';
                    const result = normalizedStatus === 'completed' ? d.result : undefined;
                    const error = normalizedStatus === 'completed' ? undefined : (normalizedStatus === 'timeout' ? (d.error || 'Tool timed out') : (d.error || d.result?.error || 'failed'));
                    
                    updateStreamingTab(t => {
                      // Find the matching tool call - prefer exact id match, fallback to tool name with pending status
                      const findMatch = (tc: ToolCall) =>
                        tc.id === toolCallId || pendingToolMatchesEvent(tc);

                      // Update hidden state for tool result tracking
                      const newHiddenState = { ...t.hiddenState, lastUpdated: Date.now() };
                      if (result) {
                        const resultMap = new Map(t.hiddenState.toolResults);
                        resultMap.set(toolCallId, {
                          toolCallId,
                          tool,
                          args: t.currentToolCalls.find(findMatch)?.args,
                          result,
                          timestamp: Date.now(),
                        });
                        if (resultMap.size > 50) {
                          const entries = Array.from(resultMap.entries());
                          entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
                          resultMap.clear();
                          entries.slice(0, 50).forEach(([k, v]) => resultMap.set(k, v));
                        }
                        newHiddenState.toolResults = resultMap;
                        
                        // Track terminal creation / lifecycle
                        if ((tool === 'start_terminal' || tool === 'run_terminal_command') && result?.terminalId) {
                          const termMap = new Map(t.hiddenState.terminals);
                          const existingArgs = t.currentToolCalls.find(findMatch)?.args;
                          termMap.set(result.terminalId, {
                            terminalId: result.terminalId,
                            command: existingArgs?.command || '',
                            status: result?.done ? 'exited' : 'running',
                            exitCode: result?.exitCode,
                            createdAt: Date.now(),
                          });
                          newHiddenState.terminals = termMap;
                        }
                        if (tool === 'terminal_create') {
                          const termMap = new Map(t.hiddenState.terminals);
                          const terminalId = getTerminalSessionId(result);
                          const existingArgs = t.currentToolCalls.find(findMatch)?.args;
                          if (terminalId) {
                            termMap.set(terminalId, {
                              terminalId,
                              command: existingArgs?.description || existingArgs?.command || '',
                              status: getTerminalStatus(result) || 'running',
                              exitCode: result?.session?.exitCode,
                              createdAt: Date.now(),
                            });
                            newHiddenState.terminals = termMap;
                          }
                        }
                        if (tool === 'terminal_read' || tool === 'terminal_wait_for' || tool === 'terminal_get') {
                          const termMap = new Map(t.hiddenState.terminals);
                          const terminalId = getTerminalSessionId(result) || t.currentToolCalls.find(findMatch)?.args?.sessionId;
                          if (terminalId && termMap.has(terminalId)) {
                            const prevTerm = termMap.get(terminalId)!;
                            termMap.set(terminalId, {
                              ...prevTerm,
                              status: getTerminalStatus(result) || prevTerm.status,
                              exitCode: typeof result?.exitCode === 'number' ? result.exitCode : prevTerm.exitCode,
                            });
                            newHiddenState.terminals = termMap;
                          }
                        }
                        if (tool === 'terminal_destroy') {
                          const termMap = new Map(t.hiddenState.terminals);
                          const terminalId = getTerminalSessionId(result) || t.currentToolCalls.find(findMatch)?.args?.sessionId;
                          if (terminalId && termMap.has(terminalId)) {
                            const prevTerm = termMap.get(terminalId)!;
                            termMap.set(terminalId, {
                              ...prevTerm,
                              status: 'exited',
                            });
                            newHiddenState.terminals = termMap;
                          }
                        }
                        // Track subagent creation
                        if (tool === 'deploy_headless_agent' && result?.taskId) {
                          const subagentMap = new Map(t.hiddenState.subagents);
                          const existingArgs = t.currentToolCalls.find(findMatch)?.args;
                          subagentMap.set(result.taskId, {
                            taskId: result.taskId,
                            objective: existingArgs?.objective || existingArgs?.prompt || '',
                            status: result?.status || 'running',
                            result: result?.result,
                            createdAt: Date.now(),
                          });
                          newHiddenState.subagents = subagentMap;
                        }

                        // Track file modifications for revert support
                        if (FILE_MODIFYING_TOOLS.has(tool) && normalizedStatus === 'completed') {
                          const existingArgs = t.currentToolCalls.find(findMatch)?.args || d.args;
                          const filePath =
                            existingArgs?.path ||
                            existingArgs?.dest ||
                            existingArgs?.src ||
                            existingArgs?.cwd ||
                            ((tool === 'run_command' || tool === 'run_system_command')
                              ? '[command_side_effects]'
                              : undefined);
                          if (filePath) {
                            modifiedFilesRef.current.add(String(filePath));
                          }
                        }
                      }

                      return {
                        ...t,
                        hiddenState: newHiddenState,
                        currentToolCalls: t.currentToolCalls.map(tc =>
                          findMatch(tc) ? applyToolNesting({ ...tc, status: newStatus, result, error }, tc) : tc
                        ),
                        // Update tool chunk in stream
                        currentStreamChunks: t.currentStreamChunks.map(chunk =>
                          chunk.type === 'tool' && findMatch(chunk.tool)
                            ? { ...chunk, tool: applyToolNesting({ ...chunk.tool, status: newStatus, result, error }, chunk.tool) }
                            : chunk
                        )
                      };
                    });

                    // Lazily fetch checkpoint ID on first file modification (backend creates it via ensure_active)
                    if (FILE_MODIFYING_TOOLS.has(tool) && normalizedStatus === 'completed' && !turnCheckpointIdRef.current) {
                      (async () => {
                        try {
                          if ((window as any).desktopAPI?.execTool) {
                            const listResult = await (window as any).desktopAPI.execTool('checkpoint_list', {});
                            if (listResult?.ok && listResult?.checkpoints?.length > 0) {
                              turnCheckpointIdRef.current = listResult.checkpoints[0].id;
                            }
                          }
                        } catch (e) {
                          console.warn('[agent] Failed to get turn checkpoint:', e);
                        }
                      })();
                    }
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
                // Don't let background tool events resurrect status after response is done
                const currentTab = tabsRef.current.find(t => t.id === getTargetTabId());
                const isTabIdle = currentTab?.aiState.phase === 'idle';
                if (!isTabIdle) {
                  if (normalizedStatus === 'completed' || normalizedStatus === 'error' || normalizedStatus === 'failed') {
                    setStreamingAI({ phase: 'responding', tool, toolStatus, statusText: 'Responding…' });
                  } else {
                    setStreamingAI({ phase: 'tool', tool, toolStatus, statusText: `🔧 ${humanTool} ${actionText}` });
                  }
                  setState((s) => ({ ...s, status: `tool:${toolStatus}` }));
                }
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
            } else if (evt.event === 'compacting') {
              const data = evt.data || {};
              const phase = data.phase === 'done' ? 'done' : 'start';
              const round = typeof data.round === 'number' ? data.round : undefined;
              const maxRounds = typeof data.maxRounds === 'number' ? data.maxRounds : undefined;
              const tokensBefore = typeof data.tokensBefore === 'number' ? data.tokensBefore : undefined;
              const tokensAfter = typeof data.tokensAfter === 'number' ? data.tokensAfter : undefined;
              const id = round != null ? `compacting-${round}` : 'compacting';
              const label = phase === 'done' ? 'Compacted context' : 'Compacting context';

              updateStreamingTab(t => {
                const chunks = [...t.currentStreamChunks];
                const existingIdx = chunks.findIndex(
                  (ch) => ch.type === 'status' && ch.id === id,
                );
                const nextChunk = {
                  type: 'status' as const,
                  id,
                  variant: 'compacting' as const,
                  label,
                  state: (phase === 'done' ? 'complete' : 'active') as 'active' | 'complete',
                  meta: {
                    round,
                    maxRounds,
                    tokensBefore,
                    tokensAfter,
                  },
                };
                if (existingIdx >= 0) {
                  const existing = chunks[existingIdx];
                  if (existing.type === 'status') {
                    chunks[existingIdx] = {
                      ...existing,
                      ...nextChunk,
                      meta: { ...existing.meta, ...nextChunk.meta },
                    };
                  }
                } else {
                  chunks.push(nextChunk);
                }
                return { ...t, currentStreamChunks: chunks };
              });
              setStreamingAI((prev) => ({
                ...prev,
                phase: 'responding',
                statusText: phase === 'done' ? 'Responding…' : 'Compacting context…',
              }));
              setState((s) => ({ ...s, status: phase === 'done' ? 'responding' : 'compacting' }));
            } else if (evt.event === 'interjection_applied') {
              flushQueuedSteeringMessages(getTargetTabId(), msg.requestId);
              setStreamingAI((prev) => ({
                ...prev,
                phase: prev.phase === 'idle' ? 'responding' : prev.phase,
                statusText: 'Steer applied',
              }));
              setState((s) => ({ ...s, status: 'steered' }));
            } else if (evt.event === 'step_finished') {
              flushQueuedSteeringMessages(getTargetTabId(), msg.requestId);
              setStreamingAI((prev) => ({
                ...prev,
                statusText: queuedMessagesRef.current.some((item) => item.kind === 'steer') ? 'Applying steer…' : prev.statusText,
              }));
            } else {
              setState((s) => ({ ...s, status: evt.event }));
            }
          } else if (msg.type === 'interjection_ack') {
            setStreamingAI((prev) => ({
              ...prev,
              statusText: msg.accepted === false ? 'Steer not applied' : 'Steer queued',
            }));
          } else if (msg.type === 'queued') {
            const pos = Number(msg.position || 0);
            const queuedText = msg.text || '';
            const queueId = msg.id || `q-${Date.now()}`;
            const queuedRequestId = typeof msg.requestId === 'string' ? msg.requestId : undefined;
            const targetTabId = getTargetTabId();
            const pendingIndex = pendingSendRef.current.findIndex((item) =>
              queuedRequestId ? item.requestId === queuedRequestId : item.tabId === targetTabId
            );
            const p = pendingIndex >= 0 ? pendingSendRef.current.splice(pendingIndex, 1)[0] : undefined;
            if (p?.silent) {
              return;
            }
            waitingQueuedStartRef.current = true;
            const visibleId = p?.id || queueId;
            const fullText = (p?.text && p.text.trim()) ? p.text : queuedText;
            const ts = typeof p?.timestamp === 'number' ? p!.timestamp : Date.now();
            syncQueuedMessages((prev) => {
              const exists = prev.find((m) => m.id === visibleId);
              if (exists) return prev;
              const nextList = [...prev, {
                id: visibleId,
                text: fullText,
                timestamp: ts,
                attachments: p?.attachments,
                contextPaths: p?.contextPaths,
                kind: 'message' as const,
                tabId: p?.tabId || targetTabId,
                requestId: queuedRequestId,
              }];
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

            // Update tab with final message
            // For aborted messages, use currentResponse if available (more up-to-date than server text)
            const finalText = isAborted
              ? (text || '') // Server sends partial text
              : text;

            // Always commit accumulated work into a message - even when text is empty
            // but tools were called or chunks streamed, so users see what happened.
            const completedTabId = getTargetTabId();
            const completedRequestId = typeof msg.requestId === 'string' ? msg.requestId : undefined;
            const currentStreamingTab = tabsRef.current.find(t => t.id === completedTabId);
            const keepTerminalStatus = !isAborted && !!currentStreamingTab && getRunningTerminalIds(currentStreamingTab.currentToolCalls).length > 0;
            const keepDelegatedStatus = !isAborted && !!currentStreamingTab && hasActiveOrPendingDelegatedWork(currentStreamingTab);
            // If we already committed a partial assistant message ahead of a steer
            // on this turn, the server's finalText still includes the pre-steer
            // content. Use only the local post-steer accumulation (t.currentResponse)
            // to avoid duplicating it.
            const hadPartial = turnHadPartialCommitRef.current.get(completedTabId) === true;
            if (keepDelegatedStatus) {
              if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
              deltaBufferRef.current = '';
              streamingRef.current = true;
              stoppedRef.current = false;
              reasoningStartTimeRef.current = null;
              lastStreamActivityRef.current = Date.now();
              deferredDelegatedFinalsRef.current.set(completedTabId, {
                requestId: completedRequestId,
                finalText,
                isAborted,
                reasoningDuration,
                hadPartial,
                receivedAt: Date.now(),
              });
              updateStreamingTab(t => ({
                ...t,
                agentState: { ...t.agentState, status: 'tool:subagent_running' },
                aiState: {
                  ...t.aiState,
                  phase: 'tool',
                  tool: 'delegate',
                  toolStatus: 'running',
                  statusText: 'Subagent still running',
                },
              }));
              if (activeTabIdRef.current === completedTabId) {
                setState((s) => ({ ...s, status: 'tool:subagent_running' }));
              }
              refreshPendingMemories();
              setTabLastError(completedTabId, null);
              return;
            }

            // Reset refs
            if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
            deltaBufferRef.current = '';
            streamingRef.current = false;
            stoppedRef.current = false; // Reset stopped flag for next request
            reasoningStartTimeRef.current = null; // Reset for next message

            // Capture modified files and checkpoint before committing
            const turnModifiedFiles = modifiedFilesRef.current.size > 0
              ? Array.from(modifiedFilesRef.current) : undefined;
            const turnCheckpointId = turnCheckpointIdRef.current || undefined;
            // Reset tracking for next turn
            modifiedFilesRef.current = new Set();
            turnCheckpointIdRef.current = null;

            updateStreamingTab(t => {
              // For aborted or post-partial turns, prefer the locally accumulated
              // response over the server's full-turn text.
              const displayText = (isAborted || hadPartial) && t.currentResponse
                ? t.currentResponse
                : finalText;
              const hasAccumulatedWork = t.currentToolCalls.length > 0 || t.currentStreamChunks.length > 0 || t.currentReasoning;

              // Commit a message if we have text OR if there was accumulated work (tool calls, reasoning, etc.)
              const shouldCommitMessage = displayText || hasAccumulatedWork;

              return {
                ...t,
                messages: shouldCommitMessage ? [...t.messages, {
                  id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  role: 'assistant',
                  text: (displayText || '') + (isAborted ? '\n\n*(Stopped)*' : ''),
                  reasoning: t.currentReasoning || undefined,
                  reasoningDuration: t.currentReasoning ? reasoningDuration : undefined,
                  toolCalls: t.currentToolCalls.length > 0 ? [...t.currentToolCalls] : undefined,
                  streamChunks: t.currentStreamChunks.length > 0 ? [...t.currentStreamChunks] : undefined,
                  timestamp: Date.now(),
                  aborted: isAborted,
                  modifiedFiles: turnModifiedFiles,
                  checkpointId: turnCheckpointId,
                }] : t.messages,
                currentResponse: '',
                currentReasoning: '',
                currentToolCalls: [],
                currentStreamChunks: [],
                aiState: keepTerminalStatus
                  ? { ...t.aiState, phase: 'tool', tool: 'terminal', toolStatus: 'running', statusText: 'Terminal still running' }
                  : { ...t.aiState, phase: 'idle', statusText: isAborted ? 'Stopped' : 'Idle' }
              };
            });

            setState((s) => ({ ...s, status: keepTerminalStatus ? 'tool:terminal_running' : 'idle' }));

            refreshPendingMemories();

            // Clean up request tracking and mark tab as no longer running
            finishCompletedTurn(completedTabId, completedRequestId, isAborted);
            setTabLastError(completedTabId, null);
          } else if (msg.type === 'stopped') {
            console.log('[agent] Stream stopped by server:', msg.success);
            streamingRef.current = false;
            stoppedRef.current = false;
            if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
            deltaBufferRef.current = '';
          } else if (msg.type === 'subagent_event') {
            if (stoppedRef.current) return;
            // Subagent events are sent directly by the runtime. If one arrives
            // after its parent turn has finalized, do not let it fall back to
            // the active tab and appear as a fresh orchestrator stream.
            if (msg.requestId && !requestIdToTabRef.current.has(msg.requestId)) return;
            const subEvt = msg as any;
            const eventType = subEvt.event || '';
            const data = subEvt.data || {};
            const subagentTrackingId = String(subEvt.subagentId || subEvt.runId || '').trim();
            const subagentTargetTabId = getTargetTabId();
            const isTerminalSubagentEvent = eventType === 'completed' || eventType === 'error' || eventType === 'cancelled';
            if (subagentTrackingId && !isTerminalSubagentEvent && eventType !== 'tool_result') {
              markSubagentActive(subagentTargetTabId, subagentTrackingId);
            }

            if (eventType === 'started') {
              const subagentId = subEvt.subagentId || '';
              const kind = typeof data.kind === 'string' && data.kind
                ? data.kind
                : typeof data.label === 'string' && data.label
                  ? data.label
                  : 'subagent';
              const id = `subagent-started-${subagentId || subEvt.runId || Date.now()}`;

              updateStreamingTab(t => {
                const chunks = [...t.currentStreamChunks];
                const existingIdx = chunks.findIndex(
                  (ch) => ch.type === 'status' && ch.id === id,
                );
                const nextChunk = {
                  type: 'status' as const,
                  id,
                  label: `${humanizeToolName(kind)} agent started`,
                  state: 'complete' as const,
                  nested: true,
                  subagentId,
                  meta: {
                    subagentKind: kind,
                    subagentLabel: typeof data.label === 'string' ? data.label : undefined,
                  },
                };
                if (existingIdx >= 0) {
                  chunks[existingIdx] = nextChunk;
                } else {
                  chunks.push(nextChunk);
                }
                return { ...t, currentStreamChunks: chunks };
              });
              setStreamingAI((prev) => ({
                ...prev,
                phase: 'responding',
                statusText: `${humanizeToolName(kind)} agent started…`
              }));
              setState((s) => ({ ...s, status: 'responding' }));
            } else if (eventType === 'delta') {
              const text = typeof data.text === 'string' ? data.text : '';
              if (text) {
                streamingRef.current = true;
                const subagentId = subEvt.subagentId || '';
                updateStreamingTab(t => {
                  // Subagent text is the delegated agent's narration to the
                  // orchestrator — do NOT merge into the parent's reply
                  // (currentResponse). Emit a nested text chunk so it renders
                  // inside the chain-of-thought / delegation card instead of
                  // leaking into the user-facing message bubble.
                  const chunks = [...t.currentStreamChunks];
                  const lastChunk = chunks[chunks.length - 1];
                  if (
                    lastChunk?.type === 'text' &&
                    lastChunk.nested === true &&
                    lastChunk.subagentId === subagentId
                  ) {
                    chunks[chunks.length - 1] = {
                      type: 'text',
                      content: lastChunk.content + text,
                      nested: true,
                      subagentId,
                    };
                  } else {
                    chunks.push({ type: 'text', content: text, nested: true, subagentId });
                  }
                  return { ...t, currentStreamChunks: chunks };
                });
                setStreamingAI((prev) => ({
                  ...prev,
                  phase: 'responding',
                  statusText: 'Subagent working…'
                }));
                setState((s) => ({ ...s, status: 'responding' }));
              }
            } else if (eventType === 'reasoning_start') {
              if (!reasoningStartTimeRef.current) {
                reasoningStartTimeRef.current = Date.now();
              }
              const subagentId = subEvt.subagentId || '';
              updateStreamingTab(t => {
                const chunks = [...t.currentStreamChunks];
                const lastChunk = chunks[chunks.length - 1];
                if (
                  lastChunk?.type !== 'reasoning' ||
                  lastChunk.nested !== true ||
                  lastChunk.subagentId !== subagentId
                ) {
                  chunks.push({ type: 'reasoning', content: '', nested: true, subagentId });
                }
                return { ...t, currentStreamChunks: chunks };
              });
              setStreamingAI((prev) => ({
                ...prev,
                phase: 'responding',
                statusText: 'Thinking…'
              }));
              setState((s) => ({ ...s, status: 'reasoning' }));
            } else if (eventType === 'reasoning') {
              const text = typeof data.text === 'string' ? data.text : '';
              if (text) {
                if (!reasoningStartTimeRef.current) {
                  reasoningStartTimeRef.current = Date.now();
                }
                const subagentId = subEvt.subagentId || '';
                updateStreamingTab(t => {
                  // Subagent reasoning belongs to the delegated agent — keep it
                  // out of the parent's `currentReasoning` so the parent's
                  // "Thought" panel doesn't mix in the subagent's CoT.
                  const chunks = [...t.currentStreamChunks];
                  const lastChunk = chunks[chunks.length - 1];
                  if (
                    lastChunk?.type === 'reasoning' &&
                    lastChunk.nested === true &&
                    lastChunk.subagentId === subagentId
                  ) {
                    chunks[chunks.length - 1] = {
                      type: 'reasoning',
                      content: mergeStreamingText(lastChunk.content, text),
                      nested: true,
                      subagentId,
                    };
                  } else {
                    chunks.push({ type: 'reasoning', content: text, nested: true, subagentId });
                  }
                  return { ...t, currentStreamChunks: chunks };
                });
                setStreamingAI((prev) => ({
                  ...prev,
                  phase: 'responding',
                  statusText: 'Subagent thinking…'
                }));
                setState((s) => ({ ...s, status: 'reasoning' }));
              }
            } else if (eventType === 'tool_call') {
              const toolName = data.tool || data.name || 'tool';
              const toolId = data.toolCallId || data.id || `sub-tc-${Date.now()}`;
              const subagentId = subEvt.subagentId || '';
              updateStreamingTab(t => {
                const existing = t.currentToolCalls.find(tc => tc.id === toolId);
                if (existing) {
                  const nextCall: ToolCall = {
                    ...existing,
                    tool: existing.tool || toolName,
                    args: typeof data.args !== 'undefined' ? data.args : existing.args,
                    description: existing.description || data.description || humanizeToolName(toolName),
                    subagentId: existing.subagentId || subagentId,
                    nested: true,
                  };
                  return {
                    ...t,
                    currentToolCalls: t.currentToolCalls.map(tc => tc.id === toolId ? nextCall : tc),
                    currentStreamChunks: t.currentStreamChunks.map(ch =>
                      ch.type === 'tool' && ch.tool.id === toolId
                        ? { ...ch, tool: { ...ch.tool, ...nextCall } }
                        : ch
                    ),
                  };
                }
                const newCall: ToolCall = {
                  id: toolId,
                  tool: toolName,
                  status: 'called',
                  args: data.args,
                  timestamp: Date.now(),
                  description: data.description || humanizeToolName(toolName),
                  subagentId,
                  nested: true,
                };
                return {
                  ...t,
                  currentToolCalls: [...t.currentToolCalls, newCall],
                  currentStreamChunks: [...t.currentStreamChunks, { type: 'tool' as const, tool: newCall }],
                };
              });
              setStreamingAI((prev) => ({
                ...prev,
                phase: 'tool',
                tool: toolName,
                toolStatus: 'running',
                statusText: `🔧 ${humanizeToolName(toolName)} running…`,
              }));
              setState((s) => ({ ...s, status: 'tool:running' }));
            } else if (eventType === 'tool_result') {
              const toolId = data.toolCallId || data.id || '';
              if (toolId) {
                const result = data.result;
                const rawStatus = typeof data.status === 'string' ? data.status.toLowerCase() : '';
                const isError =
                  rawStatus === 'error' ||
                  rawStatus === 'failed' ||
                  rawStatus === 'timeout' ||
                  typeof data.error !== 'undefined' ||
                  result?.ok === false;
                const nextStatus: ToolCall['status'] = isError ? 'error' : 'completed';
                const error = data.error || result?.error || (isError ? 'Tool failed' : undefined);
                const subagentId = subEvt.subagentId || '';
                const toolName = data.tool || data.name || data.toolName || 'tool';

                updateStreamingTab(t => {
                  const existing = t.currentToolCalls.find(tc => tc.id === toolId);
                  const nextCall: ToolCall = existing
                    ? {
                        ...existing,
                        tool: existing.tool || toolName,
                        status: nextStatus,
                        result: isError ? existing.result : result,
                        error,
                        subagentId: existing.subagentId || subagentId,
                        nested: true,
                      }
                    : {
                        id: toolId,
                        tool: toolName,
                        status: nextStatus,
                        args: data.args,
                        result: isError ? undefined : result,
                        error,
                        timestamp: Date.now(),
                        description: data.description || humanizeToolName(toolName),
                        subagentId,
                        nested: true,
                      };

                  const currentToolCalls = existing
                    ? t.currentToolCalls.map(tc => tc.id === toolId ? nextCall : tc)
                    : [...t.currentToolCalls, nextCall];

                  const hasChunk = t.currentStreamChunks.some(ch => ch.type === 'tool' && ch.tool.id === toolId);
                  const currentStreamChunks = hasChunk
                    ? t.currentStreamChunks.map(ch =>
                        ch.type === 'tool' && ch.tool.id === toolId
                          ? { ...ch, tool: { ...ch.tool, ...nextCall } }
                          : ch
                      )
                    : [...t.currentStreamChunks, { type: 'tool' as const, tool: nextCall }];

                  return { ...t, currentToolCalls, currentStreamChunks };
                });
              }
              setStreamingAI((prev) => ({
                ...prev,
                phase: 'responding',
                statusText: 'Responding…'
              }));
              setState((s) => ({ ...s, status: 'responding' }));
              queueDeferredDelegatedFinalCheck(subagentTargetTabId, typeof msg.requestId === 'string' ? msg.requestId : undefined);
            } else if (eventType === 'compacting') {
              const subagentId = subEvt.subagentId || '';
              const phase = data.phase === 'done' ? 'done' : 'start';
              const round = typeof data.round === 'number' ? data.round : undefined;
              const maxRounds = typeof data.maxRounds === 'number' ? data.maxRounds : undefined;
              const tokensBefore = typeof data.tokensBefore === 'number' ? data.tokensBefore : undefined;
              const tokensAfter = typeof data.tokensAfter === 'number' ? data.tokensAfter : undefined;
              const id = `compacting-${subagentId || 'sub'}-${round ?? 'x'}`;
              const label = phase === 'done' ? 'Subagent compacted context' : 'Subagent compacting context';

              updateStreamingTab(t => {
                const chunks = [...t.currentStreamChunks];
                const existingIdx = chunks.findIndex(
                  (ch) => ch.type === 'status' && ch.id === id,
                );
                const nextChunk = {
                  type: 'status' as const,
                  id,
                  variant: 'compacting' as const,
                  label,
                  state: (phase === 'done' ? 'complete' : 'active') as 'active' | 'complete',
                  nested: true,
                  subagentId,
                  meta: { round, maxRounds, tokensBefore, tokensAfter },
                };
                if (existingIdx >= 0) {
                  const existing = chunks[existingIdx];
                  if (existing.type === 'status') {
                    chunks[existingIdx] = {
                      ...existing,
                      ...nextChunk,
                      meta: { ...existing.meta, ...nextChunk.meta },
                    };
                  }
                } else {
                  chunks.push(nextChunk);
                }
                return { ...t, currentStreamChunks: chunks };
              });
              setStreamingAI((prev) => ({
                ...prev,
                phase: 'responding',
                statusText: phase === 'done' ? 'Responding…' : 'Compacting context…',
              }));
              setState((s) => ({ ...s, status: phase === 'done' ? 'responding' : 'compacting' }));
            } else if (eventType === 'retry' || eventType === 'error' || eventType === 'cancelled' || eventType === 'completed') {
              const subagentId = subEvt.subagentId || '';
              const id = `subagent-${eventType}-${subagentId || 'sub'}-${Date.now()}`;
              const reason = typeof data.reason === 'string'
                ? data.reason
                : typeof data.error === 'string'
                  ? data.error
                  : '';
              const label =
                eventType === 'retry'
                  ? 'Subagent retrying after tool error'
                  : eventType === 'error'
                    ? 'Subagent hit an error'
                    : eventType === 'cancelled'
                      ? 'Subagent cancelled'
                      : 'Subagent finished';
              const state: 'complete' | 'error' = eventType === 'error' || eventType === 'cancelled'
                ? 'error'
                : 'complete';

              updateStreamingTab(t => {
                const finishPendingCall = (toolCall: ToolCall): ToolCall => {
                  const belongsToSubagent = subagentId
                    ? toolCall.subagentId === subagentId
                    : Boolean(toolCall.nested || toolCall.subagentId);
                  if (!isTerminalSubagentEvent || !belongsToSubagent || !isPendingToolStatus(toolCall.status)) {
                    return toolCall;
                  }
                  return {
                    ...toolCall,
                    status: state === 'error' ? 'error' : 'completed',
                    error: state === 'error' ? (toolCall.error || reason || label) : toolCall.error,
                  };
                };
                const currentToolCalls = t.currentToolCalls.map(finishPendingCall);
                const currentStreamChunks = t.currentStreamChunks.map(chunk =>
                  chunk.type === 'tool'
                    ? { ...chunk, tool: finishPendingCall(chunk.tool) }
                    : chunk
                );
                return {
                  ...t,
                  currentToolCalls,
                  currentStreamChunks: [
                    ...currentStreamChunks,
                    {
                      type: 'status' as const,
                      id,
                      label: reason ? `${label}: ${reason}` : label,
                      state,
                      nested: true,
                      subagentId,
                    },
                  ],
                };
              });
              setStreamingAI((prev) => ({
                ...prev,
                phase: eventType === 'error' || eventType === 'cancelled' ? 'error' : 'responding',
                statusText: eventType === 'retry' ? 'Subagent retrying…' : eventType === 'completed' ? 'Responding…' : label,
              }));
              setState((s) => ({ ...s, status: eventType === 'retry' ? 'responding' : eventType }));
              if (isTerminalSubagentEvent) {
                if (subagentTrackingId) {
                  markSubagentFinished(subagentTargetTabId, subagentTrackingId);
                } else if (getActiveSubagentCount(subagentTargetTabId) <= 1) {
                  activeSubagentsByTabRef.current.delete(subagentTargetTabId);
                }
                if (getActiveSubagentCount(subagentTargetTabId) === 0) {
                  queueDeferredDelegatedFinalCheck(subagentTargetTabId, typeof msg.requestId === 'string' ? msg.requestId : undefined, true);
                }
              }
            }
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
              // Persist title to local agent DB so the dashboard history shows it
              try {
                const agentHttp = (window as any).__AGENT_HTTP__ || 'http://127.0.0.1:8765';
                fetch(`${agentHttp}/v1/memory/conversations/${encodeURIComponent(cidStr)}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ title: newTitle }),
                }).catch(() => {});
              } catch { }
            }
          } else if (msg.type === 'error') {
            console.error('[agent] Error:', msg.message, 'code:', msg.code);

            // Steer/interjection is auxiliary. If the server is older and doesn't
            // recognize the message type, don't blow up the in-progress chat —
            // log it and keep the stream alive. Steering will be a no-op until
            // the cloud-ai server is updated.
            const errMsg = String(msg.message || '');
            if (/unknown type:\s*(interjection|steer)/i.test(errMsg)
              || (msg.code && /interjection|steer/i.test(String(msg.code)))) {
              console.warn('[agent] Server rejected steer/interjection; chat continues. Update cloud-ai to enable mid-stream steering.');
              return;
            }

            const errorTabId = getTargetTabId();

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
                  setTabs(prev => prev.map(t => t.id === errorTabId ? { ...t, aiState: { phase: 'idle', statusText: 'Session refreshed - please retry' } } : t));
                  setTabLastError(errorTabId, { code: 'session_refreshed', data: { message: 'Your session was refreshed. Please try again.' } });
                } else {
                  console.log('[agent] Token refresh failed, user needs to sign in');
                  setTabs(prev => prev.map(t => t.id === errorTabId ? { ...t, aiState: { phase: 'error', message: 'Session expired', statusText: 'Please sign in again' } } : t));
                  setTabLastError(errorTabId, { code: 'session_expired', data: { requiresSignIn: true, message: 'Your session has expired. Please sign in again.' } });
                }
              }).catch(() => {
                setTabs(prev => prev.map(t => t.id === errorTabId ? { ...t, aiState: { phase: 'error', message: 'Session expired', statusText: 'Please sign in again' } } : t));
                setTabLastError(errorTabId, { code: 'session_expired', data: { requiresSignIn: true, message: 'Your session has expired. Please sign in again.' } });
              });
            } else {
              setStreamingAI({ phase: 'error', message: msg.message, statusText: `Error: ${msg.message}` });
              setTabLastError(errorTabId, { code: String(msg.message || ''), data: msg.data });
            }

            // Preserve any accumulated tool calls, stream chunks, and partial text
            // by committing them as an error assistant message instead of discarding them.
            updateStreamingTab(t => {
              const hasAccumulatedWork = t.currentToolCalls.length > 0 || t.currentStreamChunks.length > 0 || t.currentResponse || t.currentReasoning;
              const errorSuffix = `\n\n⚠️ *Error: ${msg.message || 'Something went wrong'}*`;

              if (hasAccumulatedWork) {
                // Commit partial work as an assistant message so it's not lost
                return {
                  ...t,
                  messages: [...t.messages, {
                    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    role: 'assistant',
                    text: (t.currentResponse || '').trim() + errorSuffix,
                    reasoning: t.currentReasoning || undefined,
                    toolCalls: t.currentToolCalls.length > 0 ? [...t.currentToolCalls] : undefined,
                    streamChunks: t.currentStreamChunks.length > 0 ? [...t.currentStreamChunks] : undefined,
                    timestamp: Date.now(),
                  }],
                  currentResponse: '',
                  currentReasoning: '',
                  currentToolCalls: [],
                  currentStreamChunks: [],
                };
              }
              // No accumulated work - just clear streaming state
              return { ...t, currentResponse: '', currentReasoning: '', currentToolCalls: [], currentStreamChunks: [] };
            });
            // Clean up request tracking and mark tab as no longer running
            const completedTabId = getTargetTabId();
            activeSubagentsByTabRef.current.delete(completedTabId);
            deferredDelegatedFinalsRef.current.delete(completedTabId);
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
        // onclose always fires after onerror — let it handle reconnect
      };

      ws.onclose = () => {
        // Guard: if a new WS was already created, don't clobber its state
        if (wsRef.current !== ws) return;
        console.log('[agent] Disconnected');
        agentHealthyRef.current = false;
        setTabs(prev => prev.map(t => {
          const hasWork = t.currentToolCalls.length > 0 || t.currentStreamChunks.length > 0 || t.currentResponse || t.currentReasoning;
          if (!hasWork) return { ...t, aiState: { ...t.aiState, phase: 'disconnected', statusText: 'Disconnected' } };
          return {
            ...t,
            messages: [...t.messages, {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              role: 'assistant' as const,
              text: (t.currentResponse || '') + '\n\n*(Disconnected)*',
              reasoning: t.currentReasoning || undefined,
              toolCalls: t.currentToolCalls.length > 0 ? [...t.currentToolCalls] : undefined,
              streamChunks: t.currentStreamChunks.length > 0 ? [...t.currentStreamChunks] : undefined,
              timestamp: Date.now(),
              aborted: true,
            }],
            currentResponse: '',
            currentReasoning: '',
            currentToolCalls: [],
            currentStreamChunks: [],
            aiState: { ...t.aiState, phase: 'disconnected', statusText: 'Disconnected' },
          };
        }));
        setState({ connected: false, connecting: false, status: 'disconnected' });
        wsRef.current = null;
        if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
        deltaBufferRef.current = '';
        streamingRef.current = false;
        stoppedRef.current = false;
        runningTabsRef.current.clear();
        pendingResponseTabsRef.current = [];
        waitingQueuedStartRef.current = false;
        // Clean up tracking maps to prevent memory leaks
        requestIdToTabRef.current.clear();
        activeRequestIdRef.current = null;
        streamingTabIdRef.current = null;
        streamingConversationIdRef.current = null;
        // Reject all pending tool promises so they don't leak
        for (const [id, resolve] of pendingToolsRef.current.entries()) {
          try { resolve({ ok: false, error: 'disconnected' }); } catch { }
        }
        pendingToolsRef.current.clear();
        // Clear wrapper tracking maps
        wrapperSequentialQueueRef.current.clear();
        wrapperSequentialCounterRef.current.clear();
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
        attachments: normalizeChatAttachments(options.attachments || []),
      };

      const targetTabId = options.targetTabId || activeTabIdRef.current;
      const isTabRunning = runningTabsRef.current.has(targetTabId);

      // Remember the model selection used for this tab so any later fallback
      // resend (e.g. unhandled steers reposted via sendMessageRef in
      // finishCompletedTurn) reuses the same model instead of letting the
      // server fall back to its default tier.
      const hasModelHint =
        (typeof options.mode === 'string' && options.mode) ||
        (typeof options.modelId === 'string' && options.modelId) ||
        (options.modelConfig && typeof options.modelConfig === 'object') ||
        (typeof options.reasoningLevel === 'string' && options.reasoningLevel);
      if (hasModelHint) {
        lastSendOptionsRef.current.set(targetTabId, {
          mode: options.mode,
          modelId: options.modelId,
          modelConfig: options.modelConfig,
          reasoningLevel: options.reasoningLevel,
          context: options.context,
        });
      }

      // Get active tab history BEFORE adding the new message
      const currentTab = tabsRef.current.find(t => t.id === targetTabId);
      const currentMsgs = currentTab?.messages || [];
      const currentAttachmentPayload = userMsg.attachments?.map((attachment) => serializeChatAttachment(attachment));

      // Build history with the new message (for sending to server)
      const hist = [...currentMsgs, userMsg]
        .slice(-50)
        .map((m) => {
          const msgDetails: any = { role: m.role === 'assistant' || m.role === 'system' ? m.role : 'user', content: m.text };
          if (Array.isArray(m.attachments) && m.attachments.length > 0 && m.id !== userMsg.id) {
            msgDetails.attachments = m.attachments.map((attachment) => serializeChatAttachment(attachment));
          }
          if (Array.isArray(m.toolCalls) && m.toolCalls.length > 0) {
            msgDetails.toolCalls = m.toolCalls;
          }
          return msgDetails;
        });

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
        attachments: currentAttachmentPayload || [],
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
      if (options.reasoningLevel && typeof options.reasoningLevel === 'string') {
        payload.reasoningLevel = options.reasoningLevel;
      }
      try {
        if (!payload.context || typeof payload.context !== 'object') payload.context = {};
        // Removed deviceId injection from memory system
      } catch { }
      
      // Include hidden state context for AI (terminals, subagents, recent tool results)
      const hiddenState = currentTab?.hiddenState;
      if (hiddenState) {
        const hiddenContext = hiddenStateToContextString(hiddenState);
        if (hiddenContext) {
          payload.hiddenContext = hiddenContext;
        }
        // Also send serializable summary for server-side processing
        payload.hiddenStateSummary = summarizeHiddenState(hiddenState);
      }
      
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
        silent: isSilent,
        attachments: userMsg.attachments,
        contextPaths: userMsg.contextPaths,
      };
      if (options.queueFront) {
        outboundQueueRef.current.unshift(pendingItem);
        pendingSendRef.current.unshift(pendingItem);
      } else {
        outboundQueueRef.current.push(pendingItem);
        pendingSendRef.current.push(pendingItem);
      }

      // If THIS TAB is currently running, mark status as queued for same-tab queuing
      if (isTabRunning) {
        syncQueuedMessages((prev) => {
          if (prev.some((msg) => msg.id === pendingItem.id)) return prev;
          return [...prev, {
            id: pendingItem.id,
            text: pendingItem.text,
            timestamp: pendingItem.timestamp,
            attachments: pendingItem.attachments,
            contextPaths: pendingItem.contextPaths,
            kind: 'message' as const,
            tabId: pendingItem.tabId,
          }];
        });
        setAI((prev) => ({ ...prev, statusText: `Queued (${Math.max(1, queueDepthRef.current)})` }));
        setState((s) => ({ ...s, status: 'queued' }));
      }
      // Always try to dequeue - it will send if this tab (or any other) is available
      tryDequeueAndSend();
      resetConversationNextRef.current = false;
    },
    [messages, activeTabId, tryDequeueAndSend, connect, syncQueuedMessages]
  );
  sendMessageRef.current = sendMessage;

  const newChat = useCallback(() => {
    addTab();
  }, [addTab]);

  // Edit a previously sent user message: truncate history at that point & resend with new text
  const editMessage = useCallback(async (
    messageId: string,
    newText: string,
    options?: {
      mode?: string;
      modelId?: string;
      modelConfig?: any;
      reasoningLevel?: 'none' | 'low' | 'medium' | 'high';
      context?: Record<string, any>;
    }
  ) => {
    const tab = tabsRef.current.find(t => t.id === activeTabIdRef.current);
    if (!tab) return;

    // Find the message index
    const msgIdx = tab.messages.findIndex(m => m.id === messageId);
    if (msgIdx < 0) return;
    const originalMsg = tab.messages[msgIdx];
    if (originalMsg.role !== 'user') return;

    // Automatically rollback all assistant-side filesystem changes after this point
    // (newest -> oldest to keep rollback ordering correct across checkpoints).
    const checkpointIdsToRestore = tab.messages
      .slice(msgIdx + 1)
      .filter(m => m.role === 'assistant' && !!m.checkpointId && !m.reverted)
      .map(m => String(m.checkpointId))
      .filter(Boolean)
      .reverse();

    if (checkpointIdsToRestore.length > 0) {
      const api = (window as any).desktopAPI;
      if (api?.execTool) {
        for (const checkpointId of checkpointIdsToRestore) {
          try {
            const res = await api.execTool('checkpoint_restore', { id: checkpointId });
            if (!res?.ok) {
              console.warn('[agent] Auto-revert checkpoint restore failed:', checkpointId, res);
            }
          } catch (e) {
            console.warn('[agent] Auto-revert checkpoint restore error:', checkpointId, e);
          }
        }
      }
    }

    // Truncate messages: keep everything before this message
    const truncated = tab.messages.slice(0, msgIdx);

    // Update tab with truncated messages
    setTabs(prev => prev.map(t =>
      t.id === tab.id ? { ...t, messages: truncated } : t
    ));

    // Resend with the new text, preserving original context and forwarding the
    // current model selection (mode/modelId/modelConfig/reasoningLevel) so the
    // edit doesn't fall back to the server's default tier.
    await sendMessage({
      text: newText,
      attachments: originalMsg.attachments,
      contextPaths: originalMsg.contextPaths,
      context: options?.context,
      mode: options?.mode,
      modelId: options?.modelId,
      modelConfig: options?.modelConfig,
      reasoningLevel: options?.reasoningLevel,
    });
  }, [sendMessage]);

  // Revert file changes made during a specific assistant message turn
  const revertFiles = useCallback(async (messageId: string): Promise<boolean> => {
    const tab = tabsRef.current.find(t => t.id === activeTabIdRef.current);
    if (!tab) return false;

    const msg = tab.messages.find(m => m.id === messageId);
    if (!msg || !msg.checkpointId) return false;

    try {
      if (!(window as any).desktopAPI?.execTool) return false;
      const result = await (window as any).desktopAPI.execTool('checkpoint_restore', { id: msg.checkpointId });
      if (result?.ok) {
        // Mark the message as reverted
        setTabs(prev => prev.map(t =>
          t.id === tab.id
            ? {
              ...t,
              messages: t.messages.map(m =>
                m.id === messageId ? { ...m, reverted: true } : m
              )
            }
            : t
        ));
        return true;
      }
      return false;
    } catch (e) {
      console.error('[agent] Failed to revert files:', e);
      return false;
    }
  }, []);

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

    const target = customAgentUrl ? customAgentUrl.replace('/ws', '') : 'http://127.0.0.1:8765';
    let loaded = false;

    // Try local agent first (works offline, no auth required)
    try {
      console.log('[useAgent] Fetching messages from local agent for conversation:', id);
      const resp = await fetch(`${target}/memory/conversations/${id}/messages?limit=200`);
      const json = await resp.json();
      if (json.ok && Array.isArray(json.messages) && json.messages.length > 0) {
        let lastModelLabel: string | undefined;
        const hist: Message[] = json.messages.map((r: any) => {
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
            attachments: normalizeChatAttachments(
              Array.isArray(r.attachments)
                ? r.attachments
                : (Array.isArray(meta?.attachments) ? meta.attachments : [])
            ),
            timestamp: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
          };
        });
        console.log('[useAgent] Loaded', hist.length, 'messages from local agent');
        setTabs(prev => prev.map(t => t.id === openedTabId ? { ...t, messages: hist, aiState: { ...t.aiState, model: lastModelLabel } } : t));
        loaded = true;
      }
    } catch (e) {
      console.warn('[useAgent] Local agent messages fetch failed, trying Supabase:', e);
    }

    // Fallback to Supabase if local agent didn't have the conversation
    if (!loaded) {
      try {
        const sessionToken = await getValidAccessToken();
        if (sessionToken) {
          const { data, error } = await supabase
            .from('messages')
            .select('role, content, metadata, created_at')
            .eq('conversation_id', id)
            .order('created_at', { ascending: true })
            .limit(200);
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
                attachments: normalizeChatAttachments(Array.isArray(meta?.attachments) ? meta.attachments : []),
                timestamp: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
              };
            });
            console.log('[useAgent] Loaded', hist.length, 'messages from Supabase');
            setTabs(prev => prev.map(t => t.id === openedTabId ? { ...t, messages: hist, aiState: { ...t.aiState, model: lastModelLabel } } : t));
          }
        }
      } catch (e) {
        console.error('[useAgent] Supabase loadConversation error:', e);
      }
    }

    // Load title — try local agent first, then Supabase
    try {
      const convResp = await fetch(`${target}/memory/conversations/${id}`);
      const convJson = await convResp.json();
      if (convJson.ok && convJson.conversation?.title) {
        const title = String(convJson.conversation.title).trim();
        if (title) {
          setTabs(prev => prev.map(t => t.id === openedTabId ? { ...t, title } : t));
          return; // Got title from local agent, done
        }
      }
    } catch { }
    // Fallback title from Supabase
    try {
      const sessionToken = await getValidAccessToken();
      if (sessionToken) {
        const { data: conv } = await supabase
          .from('conversations')
          .select('title')
          .eq('id', id)
          .single();
        const title = (conv as any)?.title;
        if (typeof title === 'string' && title.trim()) {
          setTabs(prev => prev.map(t => t.id === openedTabId ? { ...t, title: title.trim() } : t));
        }
      }
    } catch (e) {
      console.error('[useAgent] Title fetch error:', e);
    }
  }, [addTab, customAgentUrl]);

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

  // Watchdog: auto-commit stale streaming state when no messages arrive.
  // Delegated subagents can legitimately be quiet while a long local tool
  // (grep, file creation, command execution) is running, so give those turns a
  // much longer window and keep the delegated rectangle alive.
  useEffect(() => {
    const STALE_TIMEOUT_MS = 90_000;
    const DELEGATED_STALE_TIMEOUT_MS = 30 * 60_000;
    const CHECK_INTERVAL_MS = 15_000;

    const interval = setInterval(() => {
      const lastActivity = lastStreamActivityRef.current;
      if (!lastActivity) return;
      const phase = activeTab?.aiState?.phase;
      const isActive = phase === 'responding' || phase === 'tool' || phase === 'routing';
      if (!isActive) return;
      const staleTimeout = hasActiveOrPendingDelegatedWork(activeTab)
        ? DELEGATED_STALE_TIMEOUT_MS
        : STALE_TIMEOUT_MS;
      if (Date.now() - lastActivity < staleTimeout) return;

      console.log('[agent] Watchdog: stale stream detected, committing partial state');
      lastStreamActivityRef.current = 0;
      streamingRef.current = false;
      stoppedRef.current = false;
      if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
      deltaBufferRef.current = '';

      setTabs(prev => prev.map(t => {
        const tPhase = t.aiState?.phase;
        if (tPhase !== 'responding' && tPhase !== 'tool' && tPhase !== 'routing') return t;
        const hasWork = t.currentToolCalls.length > 0 || t.currentStreamChunks.length > 0 || t.currentResponse || t.currentReasoning;
        if (!hasWork) {
          return { ...t, aiState: { ...t.aiState, phase: 'idle', statusText: 'Idle' } };
        }
        return {
          ...t,
          messages: [...t.messages, {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            role: 'assistant' as const,
            text: (t.currentResponse || '') + '\n\n*(Connection lost)*',
            reasoning: t.currentReasoning || undefined,
            toolCalls: t.currentToolCalls.length > 0 ? [...t.currentToolCalls] : undefined,
            streamChunks: t.currentStreamChunks.length > 0 ? [...t.currentStreamChunks] : undefined,
            timestamp: Date.now(),
            aborted: true,
          }],
          currentResponse: '',
          currentReasoning: '',
          currentToolCalls: [],
          currentStreamChunks: [],
          aiState: { ...t.aiState, phase: 'idle', statusText: 'Idle' },
        };
      }));
      runningTabsRef.current.clear();
      activeSubagentsByTabRef.current.clear();
      deferredDelegatedFinalsRef.current.clear();
      pendingResponseTabsRef.current = [];
      requestIdToTabRef.current.clear();
      activeRequestIdRef.current = null;
      streamingTabIdRef.current = null;
    }, CHECK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [activeTab]);

  const reconcileTerminalState = useCallback((terminals: Array<{ requestId: string; result: { text: string; finishReason: string; aborted?: boolean; error?: boolean } }>) => {
    if (!terminals || terminals.length === 0) return;
    const terminalRequestIds = new Set(terminals.map(t => t.requestId));
    setTabs(prev => prev.map(t => {
      const tPhase = t.aiState?.phase;
      if (tPhase !== 'responding' && tPhase !== 'tool' && tPhase !== 'routing') return t;
      const hasWork = t.currentToolCalls.length > 0 || t.currentStreamChunks.length > 0 || t.currentResponse || t.currentReasoning;
      if (!hasWork) {
        return { ...t, aiState: { ...t.aiState, phase: 'idle', statusText: 'Idle' } };
      }
      return {
        ...t,
        messages: [...t.messages, {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          role: 'assistant' as const,
          text: (t.currentResponse || '') + '\n\n*(Recovered)*',
          reasoning: t.currentReasoning || undefined,
          toolCalls: t.currentToolCalls.length > 0 ? [...t.currentToolCalls] : undefined,
          streamChunks: t.currentStreamChunks.length > 0 ? [...t.currentStreamChunks] : undefined,
          timestamp: Date.now(),
          aborted: true,
        }],
        currentResponse: '',
        currentReasoning: '',
        currentToolCalls: [],
        currentStreamChunks: [],
        aiState: { ...t.aiState, phase: 'idle', statusText: 'Idle' },
      };
    }));
    for (const reqId of terminalRequestIds) {
      requestIdToTabRef.current.delete(reqId);
    }
    streamingRef.current = false;
    stoppedRef.current = false;
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
    steerMessage: queueSteeringMessage,
    steerSubagent,
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
    cancelQueuedMessage,
    respondToApproval,
    lastError,
    chatMode,
    setChatMode,
    chatModels,
    setChatModels,
    tabs,
    activeTabId,
    addTab,
    closeTab,
    switchTab,
    deleteConversation,
    // Edit & Revert
    editMessage,
    revertFiles,
    // GenUI support
    activeGenUITools,
    respondToGenUI,
    // Hidden state accessors
    hiddenState: activeTab?.hiddenState || createEmptyHiddenState(),
    getHiddenStateSummary: () => summarizeHiddenState(activeTab?.hiddenState || createEmptyHiddenState()),
    reconcileTerminalState,
  };
}
