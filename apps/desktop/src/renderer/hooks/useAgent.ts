import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase, getValidAccessToken, getFastAccessToken, ensureFreshToken, setupAutoRefresh } from '../auth/authManager';
import { agentFetchJson, resolveAgentEndpoints } from '../utils/agentEndpoints';
import type { ChatMode, ChatModelsConfig } from './usePreferences';

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
  'knowledge_add_fact',
  'knowledge_upsert_core',
  'knowledge_find_entity',
  'knowledge_create_entity',
  'knowledge_upsert_procedural',

  // Pending memories (shown in dedicated UI, should not appear as tool pills)
  'pending_memory_create',
  'pending_memory_list',
  'pending_memory_get',
  'pending_memory_confirm',
  'pending_memory_reject',
  'pending_memory_delete',

  // Internal subagent lifecycle tools (track in hidden state only)
  'subagent_spawn',
  'subagent_update',
  'subagent_status',
  'subagent_list',
  'subagent_stop',
  'subagent_create',
  'run_subagent',
  'spawn_agent',

  // Internal meta-tools (invisible to user)
  'get_tool_schema',
  'search_tools',
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
  'show_form',
]);

// GenUI tools that block and wait for user interaction
const BLOCKING_GENUI_TOOLS = new Set([
  'ask_confirmation',
  'show_choices',
  'pick_date',
  'request_files',
  'show_command',
  'show_form',
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

function normalizeChatError(input: { code?: any; message?: any; data?: any }): { code: string; userMessage: string; rawMessage: string } {
  const rawCode = String(input?.code || input?.data?.code || '').trim().toLowerCase();
  const rawMessage = String(input?.message || input?.data?.message || '').trim();
  const nestedError = String(input?.data?.error || '').trim();
  const combined = `${rawCode} ${rawMessage} ${nestedError}`.toLowerCase();

  if (rawCode === 'monthly_credit_limit_exceeded') {
    return {
      code: rawCode,
      userMessage: 'Monthly credit limit reached. Please upgrade your plan or wait for the next reset.',
      rawMessage,
    };
  }
  if (combined.includes('unknown_tool') || combined.includes('unknown tool') || combined.includes('tool not found')) {
    return {
      code: 'unknown_tool',
      userMessage: 'The assistant tried to use a tool that is unavailable in this environment.',
      rawMessage,
    };
  }
  if (combined.includes('invalid_json') || (combined.includes('tool call') && combined.includes('json'))) {
    return {
      code: 'invalid_tool_input',
      userMessage: 'The AI generated an invalid tool call. Please retry your request.',
      rawMessage,
    };
  }
  if (combined.includes('timeout') || combined.includes('timed out')) {
    return {
      code: 'timeout',
      userMessage: 'The request timed out before completion. Please try again.',
      rawMessage,
    };
  }
  if (combined.includes('network') || combined.includes('websocket') || combined.includes('fetch failed') || combined.includes('econn')) {
    return {
      code: 'network_error',
      userMessage: 'Connection issue while talking to the AI service. Please retry in a moment.',
      rawMessage,
    };
  }
  return {
    code: rawCode || 'agent_error',
    userMessage: rawMessage || 'Something went wrong while processing your request.',
    rawMessage,
  };
}

function getLoadedConversationTime(value: { created_at?: string; timestamp?: number } | null | undefined): number {
  const direct = typeof value?.timestamp === 'number' ? value.timestamp : NaN;
  if (Number.isFinite(direct)) return direct;
  const parsed = Date.parse(String(value?.created_at || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function repairLoadedConversationRows<T extends { role?: string; turn_index?: number; created_at?: string; timestamp?: number }>(rows: T[]): T[] {
  const sorted = [...rows].sort((a, b) => {
    const aTurn = Number(a?.turn_index);
    const bTurn = Number(b?.turn_index);
    const aHasTurn = Number.isFinite(aTurn);
    const bHasTurn = Number.isFinite(bTurn);

    if (aHasTurn || bHasTurn) {
      if (aHasTurn && bHasTurn && aTurn !== bTurn) return aTurn - bTurn;
      if (aHasTurn !== bHasTurn) return aHasTurn ? -1 : 1;
    }

    return getLoadedConversationTime(a) - getLoadedConversationTime(b);
  });

  const messageIndices = sorted
    .map((row, index) => ({
      index,
      role: row?.role === 'assistant' || row?.role === 'user' ? row.role : null,
    }))
    .filter((item): item is { index: number; role: 'assistant' | 'user' } => item.role === 'assistant' || item.role === 'user');

  if (messageIndices.length < 2 || messageIndices[0].role !== 'assistant' || messageIndices[1].role !== 'user') {
    return sorted;
  }

  let checkedPairs = 0;
  let reversedPairs = 0;
  for (let i = 0; i + 1 < messageIndices.length; i += 2) {
    checkedPairs += 1;
    if (messageIndices[i].role === 'assistant' && messageIndices[i + 1].role === 'user') {
      reversedPairs += 1;
    }
  }

  if (reversedPairs < Math.max(1, Math.ceil(checkedPairs / 2))) {
    return sorted;
  }

  const repaired = [...sorted];
  for (let i = 0; i + 1 < messageIndices.length; i += 2) {
    const first = messageIndices[i];
    const second = messageIndices[i + 1];
    if (first.role === 'assistant' && second.role === 'user') {
      [repaired[first.index], repaired[second.index]] = [repaired[second.index], repaired[first.index]];
    }
  }

  return repaired;
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  reasoning?: string;
  reasoningDuration?: number; // in seconds
  toolCalls?: ToolCall[]; // Tool calls made during this response
  streamChunks?: StreamChunk[]; // Interleaved chunks for display
  usage?: Record<string, any>;
  modelId?: string;
  timestamp?: number;
  contextPaths?: ContextPath[]; // Files/folders attached via @ mention
  modifiedFiles?: string[]; // Paths of files modified during this turn
  checkpointId?: string; // Checkpoint ID for reverting file changes
  reverted?: boolean; // Whether file changes have been reverted
  aborted?: boolean; // Whether the message was stopped/aborted
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
  reasoningLevel?: 'none' | 'low' | 'medium' | 'high';
  silent?: boolean;
}

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
  liveUsage: { promptTokens: number; completionTokens: number; totalTokens: number; contextWindow?: number; modelId?: string } | null; // Live token usage updated mid-stream
  aiState: AIStatus;
  agentState: AgentState;
  lastError: { code: string; data?: any } | null;
  hiddenState: HiddenState; // Session context for AI (not rendered in UI)
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
    liveUsage: null,
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
    // Persist to localStorage so it survives restart
    try { localStorage.setItem('stuard.pref.chat_mode', JSON.stringify(nextMode)); } catch { }
  }, []);
  const setChatModels = useCallback((cfg: ChatModelsConfig) => {
    const targetTabId = activeTabIdRef.current;
    setTabs(prev => prev.map(t => t.id === targetTabId ? { ...t, chatModels: cloneChatModelsConfig(cfg || DEFAULT_TAB_CHAT_MODELS) } : t));
    // Persist to localStorage so it survives restart
    try { localStorage.setItem('stuard.pref.chat_models', JSON.stringify(cfg || DEFAULT_TAB_CHAT_MODELS)); } catch { }
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
  const modifiedFilesRef = useRef<Set<string>>(new Set()); // Track files modified in current turn
  const turnCheckpointIdRef = useRef<string | null>(null); // Checkpoint ID for current turn
  const turnCheckpointPromiseRef = useRef<Promise<string | null> | null>(null);
  const activeSkillsCacheRef = useRef<any[]>([]);

  // File-modifying tool names
  const FILE_MODIFYING_TOOLS = new Set([
    'write_file', 'write_file_base64', 'delete_file', 'move_file', 'copy_file',
    'create_directory', 'edit_and_apply', 'edit_file', 'file_edit', 'patch_file',
    'run_command', 'run_system_command', 'run_python_script', 'run_node_script',
  ]);

  const ensureTurnCheckpoint = useCallback(async (): Promise<string | null> => {
    if (turnCheckpointIdRef.current) {
      return turnCheckpointIdRef.current;
    }
    if (turnCheckpointPromiseRef.current) {
      return await turnCheckpointPromiseRef.current;
    }

    const promise = (async () => {
      try {
        if ((window as any).desktopAPI?.execTool) {
          const cpResult = await (window as any).desktopAPI.execTool('checkpoint_create', { name: 'auto_turn' });
          if (cpResult?.ok && cpResult?.id) {
            turnCheckpointIdRef.current = cpResult.id;
            return cpResult.id as string;
          }
        }
      } catch (e) {
        console.warn('[agent] Failed to create turn checkpoint:', e);
      }
      return null;
    })();

    turnCheckpointPromiseRef.current = promise;
    const id = await promise;
    if (turnCheckpointPromiseRef.current === promise) {
      turnCheckpointPromiseRef.current = null;
    }
    return id;
  }, []);

  const mapActiveSkills = useCallback((skillsRes: any) => {
    if (!skillsRes?.ok || !Array.isArray(skillsRes.skills)) {
      return [];
    }
    return skillsRes.skills
      .filter((s: any) => s?.isActive)
      .slice(0, 20)
      .map((s: any) => ({
        id: String(s?.id || '').trim(),
        name: String(s?.name || '').trim(),
        description: String(s?.description || '').trim(),
        trigger: String(s?.trigger || '').trim(),
        icon: typeof s?.icon === 'string' ? s.icon : undefined,
        color: typeof s?.color === 'string' ? s.color : undefined,
        isActive: true,
        steps: Array.isArray(s?.steps)
          ? s.steps.slice(0, 30).map((step: any) => {
            const toolName = String(step?.toolName || '').trim();
            return {
              id: String(step?.id || '').trim(),
              type: String(step?.type || 'prompt').trim() || 'prompt',
              label: String(step?.label || '').trim(),
              content: String(step?.content || '').trim(),
              ...(toolName ? { toolName } : {}),
            };
          }).filter((step: any) => step.id && step.type)
          : [],
      }))
      .filter((s: any) => s.id && s.name);
  }, []);

  const refreshActiveSkillsCache = useCallback(async () => {
    try {
      const skillsRes = await window.desktopAPI?.skillsList?.().catch(() => null);
      activeSkillsCacheRef.current = mapActiveSkills(skillsRes);
    } catch {
    }
    return activeSkillsCacheRef.current;
  }, [mapActiveSkills]);

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
      liveUsage: null,
      aiState: { phase: 'idle', statusText: 'Idle' },
      agentState: { connected: state.connected, connecting: state.connecting, status: state.status },
      lastError: null,
      hiddenState: createEmptyHiddenState(),
      ...tab
    };
    tabsRef.current = [...tabsRef.current, newTab];
    activeTabIdRef.current = id;
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(id);
    return id;
  }, [state.connected, state.connecting, state.status, initialChatMode, initialChatModels]);

  const closeTab = useCallback((id: string) => {
    // Clean up request tracking for the closed tab
    runningTabsRef.current.delete(id);
    // Clean up session-scoped folder permissions for this tab
    const agentHttp = (window as any).__AGENT_HTTP__ || "http://127.0.0.1:8765";
    fetch(`${agentHttp}/v1/folder-permissions/clear-session`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: id }),
    }).catch(() => {});
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
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return false;
      // Find the requestId for the active tab so the server aborts only THAT stream
      const targetTabId = activeTabIdRef.current;
      let targetRequestId: string | undefined;
      for (const [reqId, tabId] of requestIdToTabRef.current.entries()) {
        if (tabId === targetTabId) { targetRequestId = reqId; break; }
      }
      const stopPayload: any = { type: 'stop' };
      if (targetRequestId) stopPayload.requestId = targetRequestId;
      wsRef.current.send(JSON.stringify(stopPayload));
      // Clear streaming state and mark as stopped to ignore further chunks
      streamingRef.current = false;
      stoppedRef.current = true;
      setAI({ phase: 'idle', statusText: 'Stopped' });
      return true;
    } catch {
      return false;
    }
  }, []);

  const cancelQueuedMessage = useCallback((msgId: string) => {
    setQueuedMessages((prev) => {
      const nextList = prev.filter(m => m.id !== msgId);
      setQueueDepth(nextList.length);
      queueDepthRef.current = nextList.length;
      return nextList;
    });

    outboundQueueRef.current = outboundQueueRef.current.filter(m => m.id !== msgId);
    pendingSendRef.current = pendingSendRef.current.filter(m => m.id !== msgId);

    // If the queue is now empty and we were waiting for queued start, reset
    if (queueDepthRef.current === 0) {
      waitingQueuedStartRef.current = false;
      // If we are not currently running anything, reset status
      if (!runningTabsRef.current.has(activeTabIdRef.current)) {
        setState((s) => ({ ...s, status: 'idle' }));
        setAI((prev) => ({ ...prev, statusText: 'Online' }));
      }
    } else {
      // Update queued count text if still queued
      if (runningTabsRef.current.has(activeTabIdRef.current)) {
        setAI((prev) => ({ ...prev, statusText: `Queued (${queueDepthRef.current})` }));
      }
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
      const agentEndpoints = resolveAgentEndpoints(customAgentUrl);
      const result = await agentFetchJson(
        agentEndpoints,
        `/v1/memory/conversations/${encodeURIComponent(id)}`,
        {
          method: 'DELETE',
          accessToken: agentEndpoints.usesVmRelay ? await getValidAccessToken() : null,
        },
      );
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
                liveUsage: null,
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
      if (runningTabsRef.current.size > 0) return;

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
    } catch { }
  }, []);

  const connect = useCallback(async () => {
    const ready = wsRef.current?.readyState;
    if (ready === WebSocket.OPEN || ready === WebSocket.CONNECTING) return;

    setState((s) => ({ ...s, connecting: true, status: 'connecting' }));
    setAI({ phase: 'connecting', statusText: 'Connecting…' });

    try {
      const target = resolveAgentEndpoints(customAgentUrl).wsUrl;
      // Append auth token to WS URL so the server can immediately register
      // this connection for webhook delivery (Gmail Pub/Sub, Drive, etc.)
      // without waiting for a chat message to be sent.
      let wsUrl = target;
      try {
        const token = await getFastAccessToken();
        if (token) {
          const sep = wsUrl.includes('?') ? '&' : '?';
          wsUrl = `${wsUrl}${sep}client=desktop&token=${encodeURIComponent(token)}`;
        }
      } catch { }
      const ws = new WebSocket(wsUrl);
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
          // Suppress very high-frequency request/response spam in console.
          if (msg.type !== 'progress' && msg.type !== 'request' && msg.type !== 'response') {
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

          const setStreamingState = (fn: AgentState | ((prev: AgentState) => AgentState)) => {
            updateStreamingTab(t => ({ ...t, agentState: typeof fn === 'function' ? fn(t.agentState) : fn }));
          };

          const setStreamingAI = (fn: AIStatus | ((prev: AIStatus) => AIStatus)) => {
            updateStreamingTab(t => ({ ...t, aiState: typeof fn === 'function' ? fn(t.aiState) : fn }));
          };

          const hasTrackedRequestId = typeof msg.requestId === 'string' && requestIdToTabRef.current.has(msg.requestId);
          const isStrictlyRoutedStreamMessage = msg.type === 'progress' || msg.type === 'final' || msg.type === 'error' || msg.type === 'stopped';

          if (isStrictlyRoutedStreamMessage && !hasTrackedRequestId) {
            console.log('[agent] Ignoring untracked stream message:', msg.type, msg.requestId || '(no requestId)');
            return;
          }

          if (msg.type === 'handshake') {
            console.log('[agent] Handshake:', msg.message);
            // Send auth message immediately so the server registers this connection
            // for webhook delivery (Gmail Pub/Sub, Drive triggers, etc.)
            (async () => {
              try {
                const token = await getFastAccessToken();
                if (token && wsRef.current?.readyState === WebSocket.OPEN) {
                  wsRef.current.send(JSON.stringify({ type: 'auth', accessToken: token }));
                }
              } catch { }
            })();
          } else if (msg.type === 'auth_result') {
            // Server confirmed webhook registration
            if (msg.ok) {
              console.log('[agent] Auth registered for webhooks', msg.queued > 0 ? `(${msg.queued} queued delivered)` : '');
            }
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

            // ask_user tool: add to activeGenUITools for inline chat rendering
            if (tool === 'ask_user') {
              console.log('[agent] ask_user tool request received:', args);
              setActiveGenUITools(prev => {
                if (prev.some(t => t.id === id)) return prev;
                return [...prev, { id, tool: 'ask_user', args, status: 'pending' }];
              });
              return; // Wait for respondToGenUI to send result back
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
                  if (FILE_MODIFYING_TOOLS.has(String(tool)) && !turnCheckpointIdRef.current) {
                    await ensureTurnCheckpoint();
                  }

                  // Execute via Main process
                  let result: any = {
                    ok: false,
                    error: 'unknown_tool',
                    message: `Tool "${String(tool)}" is not available in this chat context.`,
                  };

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
                      const execResult = await (window as any).desktopAPI.execTool(tool, args);
                      result = execResult ?? {
                        ok: false,
                        error: 'tool_execution_failed',
                        message: `Tool "${String(tool)}" returned no response.`,
                      };
                    } else {
                      result = {
                        ok: false,
                        error: 'bridge_unavailable',
                        message: 'Desktop bridge is unavailable, so local tools cannot run.',
                      };
                    }
                  }

                  // Send result back
                  if (wsRef.current?.readyState === WebSocket.OPEN) {
                    wsRef.current.send(JSON.stringify({ type: 'tool_result', id, result }));
                  }
                } catch (err: any) {
                  if (wsRef.current?.readyState === WebSocket.OPEN) {
                    wsRef.current.send(JSON.stringify({
                      type: 'tool_result',
                      id,
                      result: {
                        ok: false,
                        error: 'tool_execution_failed',
                        message: String(err?.message || err),
                      }
                    }));
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
              setStreamingState((s) => ({ ...s, status: s.status.startsWith('tool:') ? s.status : 'routing' }));
            } else if (evt.event === 'model') {
              const modelId = typeof evt.data?.modelId === 'string' ? evt.data.modelId : undefined;
              const tier = typeof evt.data?.tier === 'string' ? evt.data.tier : undefined;
              const label = modelId || tier;
              if (label) {
                setStreamingAI((prev) => ({ ...prev, model: label }));
              }
            } else if (evt.event === 'start') {
              streamingConversationIdRef.current = conversationIdRef.current;
              // Reset per-turn file tracking. Checkpoints are created lazily only
              // when a file-modifying tool is actually invoked.
              modifiedFilesRef.current = new Set();
              turnCheckpointIdRef.current = null;
              turnCheckpointPromiseRef.current = null;
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
              setTabLastError(getTargetTabId(), null);
            } else if (evt.event === 'ack') {
              // Server acknowledged receipt - show immediate feedback
              setStreamingAI((prev) => {
                if (prev.phase === 'tool') return prev;
                return { ...prev, phase: 'responding', statusText: 'Processing…' };
              });
              setStreamingState((s) => ({ ...s, status: 'processing' }));
            } else if (evt.event === 'reasoning_start') {
              // Reasoning started - track timing
              console.log('[agent] Reasoning started');
              reasoningStartTimeRef.current = Date.now();
              setStreamingAI((prev) => {
                if (prev.phase === 'tool') return prev;
                return { ...prev, phase: 'responding', statusText: 'Thinking…' };
              });
              setStreamingState((s) => ({ ...s, status: 'reasoning' }));
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
              setStreamingState((s) => ({ ...s, status: 'reasoning' }));
            } else if (evt.event === 'reasoning_end') {
              // Reasoning ended
              console.log('[agent] Reasoning ended');
            } else if (evt.event === 'tool_event') {
              // Ignore tool events if we've explicitly stopped
              if (stoppedRef.current) {
                console.log('[agent] Ignoring tool_event after stop');
                return;
              }
              let tool = String(evt.data?.tool || 'tool');
              // execute_tool is a wrapper — show the actual tool being executed
              if (tool === 'execute_tool' && evt.data?.args?.tool_name) {
                tool = String(evt.data.args.tool_name);
              }
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
                  if (toolName === 'subagent_create' || toolName === 'run_subagent' || toolName === 'spawn_agent') {
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
                    setStreamingState((s) => ({ ...s, status: `tool:running` }));
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
                    const result = normalizedStatus === 'completed' ? d.result : undefined;
                    const error = normalizedStatus === 'completed' ? undefined : (d.error || d.result?.error || 'failed');

                    updateStreamingTab(t => {
                      // Find the matching tool call - prefer exact id match, fallback to tool name with pending status
                      const findMatch = (tc: ToolCall) =>
                        tc.id === toolCallId || (tc.tool === tool && tc.status === 'called');

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

                        // Track terminal creation
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
                        // Track subagent creation
                        if ((tool === 'subagent_create' || tool === 'run_subagent' || tool === 'spawn_agent') && result?.taskId) {
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
                setStreamingState((s) => ({ ...s, status: `tool:${toolStatus}` }));
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
              setStreamingState((s) => ({ ...s, status: 'responding' }));
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
            } else if (evt.event === 'usage_update') {
              // Live token usage update from server (emitted on each step finish + after compaction)
              const d = evt.data || {};
              const promptTokens = typeof d.promptTokens === 'number' ? d.promptTokens : 0;
              const completionTokens = typeof d.completionTokens === 'number' ? d.completionTokens : 0;
              const totalTokens = typeof d.totalTokens === 'number' ? d.totalTokens : promptTokens + completionTokens;
              const contextWindow = typeof d.contextWindow === 'number' ? d.contextWindow : undefined;
              const modelId = typeof d.modelId === 'string' ? d.modelId : undefined;
              updateStreamingTab(t => ({
                ...t,
                liveUsage: { promptTokens, completionTokens, totalTokens, contextWindow, modelId },
              }));
            } else {
              setStreamingState((s) => ({ ...s, status: evt.event }));
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
            setStreamingState((s) => ({ ...s, status: 'queued' }));
          } else if (msg.type === 'final') {
            const result = msg.result || {};
            const isAborted = msg.aborted === true || result.finishReason === 'aborted';
            const text = result.response || result.text || '';
            const finalUsage = result.usage && typeof result.usage === 'object' ? result.usage : undefined;
            const finalModelId = typeof result.modelId === 'string'
              ? result.modelId
              : typeof msg.model === 'string'
                ? msg.model
                : undefined;

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

            // Capture modified files and checkpoint before committing
            const turnModifiedFiles = modifiedFilesRef.current.size > 0
              ? Array.from(modifiedFilesRef.current) : undefined;
            const turnCheckpointId = turnCheckpointIdRef.current || undefined;
            // Reset tracking for next turn
            modifiedFilesRef.current = new Set();
            turnCheckpointIdRef.current = null;
            turnCheckpointPromiseRef.current = null;

            // Always commit accumulated work into a message - even when text is empty
            // but tools were called or chunks streamed, so users see what happened.
            updateStreamingTab(t => {
              // For aborted, prefer the current streamed response over server text
              const displayText = isAborted && t.currentResponse ? t.currentResponse : finalText;
              const hasAccumulatedWork = t.currentToolCalls.length > 0 || t.currentStreamChunks.length > 0 || t.currentReasoning;

              // Finalize any tool calls still in 'called' status (they'd show perpetual spinners otherwise)
              const finalizedToolCalls = t.currentToolCalls.map(tc =>
                tc.status === 'called'
                  ? { ...tc, status: (isAborted ? 'error' : 'completed') as 'error' | 'completed', error: isAborted ? 'Stopped' : undefined }
                  : tc
              );
              const finalizedStreamChunks = t.currentStreamChunks.map(chunk =>
                chunk.type === 'tool' && chunk.tool?.status === 'called'
                  ? { ...chunk, tool: { ...chunk.tool, status: (isAborted ? 'error' : 'completed') as 'error' | 'completed', error: isAborted ? 'Stopped' : undefined } }
                  : chunk
              );

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
                  toolCalls: finalizedToolCalls.length > 0 ? finalizedToolCalls : undefined,
                  streamChunks: finalizedStreamChunks.length > 0 ? finalizedStreamChunks : undefined,
                  usage: finalUsage,
                  modelId: finalModelId || t.aiState.model,
                  timestamp: Date.now(),
                  aborted: isAborted,
                  modifiedFiles: turnModifiedFiles,
                  checkpointId: turnCheckpointId,
                }] : t.messages,
                currentResponse: '',
                currentReasoning: '',
                currentToolCalls: [],
                currentStreamChunks: [],
                liveUsage: null,
                aiState: { ...t.aiState, phase: 'idle', statusText: isAborted ? 'Stopped' : 'Idle' }
              };
            });

            setStreamingState((s) => ({ ...s, status: 'idle' }));

            refreshPendingMemories();

            // Clean up request tracking and mark tab as no longer running
            const completedTabId = getTargetTabId();
            if (msg.requestId) {
              requestIdToTabRef.current.delete(msg.requestId);
              if (activeRequestIdRef.current === msg.requestId) {
                activeRequestIdRef.current = null;
              }
            }
            // Also remove from legacy FIFO queue if present
            const fifoIdx = pendingResponseTabsRef.current.indexOf(completedTabId);
            if (fifoIdx !== -1) pendingResponseTabsRef.current.splice(fifoIdx, 1);
            runningTabsRef.current.delete(completedTabId);
            tryDequeueAndSend();
            setTabLastError(completedTabId, null);
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
            const errorTabId = getTargetTabId();
            const normalizedError = normalizeChatError({ code: msg.code, message: msg.message, data: msg.data });

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
              setStreamingAI({ phase: 'error', message: normalizedError.userMessage, statusText: `Error: ${normalizedError.userMessage}` });
              setTabLastError(errorTabId, {
                code: normalizedError.code,
                data: { ...(msg.data || {}), message: normalizedError.userMessage, rawMessage: normalizedError.rawMessage }
              });
            }
            setStreamingState((s) => ({ ...s, status: 'error' }));

            // Preserve any accumulated tool calls, stream chunks, and partial text
            // by committing them as an error assistant message instead of discarding them.
            updateStreamingTab(t => {
              const hasAccumulatedWork = t.currentToolCalls.length > 0 || t.currentStreamChunks.length > 0 || t.currentResponse || t.currentReasoning;
              const errorSuffix = `\n\n⚠️ *Error: ${normalizedError.userMessage}*`;

              // Mark any tool calls still in 'called' status as 'error' so they don't show perpetual spinners
              const finalizedToolCalls = t.currentToolCalls.map(tc =>
                tc.status === 'called' ? { ...tc, status: 'error' as const, error: normalizedError.userMessage } : tc
              );
              const finalizedStreamChunks = t.currentStreamChunks.map(chunk =>
                chunk.type === 'tool' && chunk.tool?.status === 'called'
                  ? { ...chunk, tool: { ...chunk.tool, status: 'error' as const, error: normalizedError.userMessage } }
                  : chunk
              );

              if (hasAccumulatedWork) {
                // Commit partial work as an assistant message so it's not lost
                return {
                  ...t,
                  messages: [...t.messages, {
                    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    role: 'assistant',
                    text: (t.currentResponse || '').trim() + errorSuffix,
                    reasoning: t.currentReasoning || undefined,
                    toolCalls: finalizedToolCalls.length > 0 ? finalizedToolCalls : undefined,
                    streamChunks: finalizedStreamChunks.length > 0 ? finalizedStreamChunks : undefined,
                    timestamp: Date.now(),
                  }],
                  currentResponse: '',
                  currentReasoning: '',
                  currentToolCalls: [],
                  currentStreamChunks: [],
                  liveUsage: null,
                };
              }
              // No accumulated work - still commit a visible assistant error message
              return {
                ...t,
                messages: [...t.messages, {
                  id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  role: 'assistant',
                  text: `⚠️ ${normalizedError.userMessage}`,
                  timestamp: Date.now(),
                }],
                currentResponse: '',
                currentReasoning: '',
                currentToolCalls: [],
                currentStreamChunks: [],
                liveUsage: null,
              };
            });
            // Clean up request tracking and mark tab as no longer running
            const completedTabId = getTargetTabId();
            if (msg.requestId) {
              requestIdToTabRef.current.delete(msg.requestId);
              if (activeRequestIdRef.current === msg.requestId) {
                activeRequestIdRef.current = null;
              }
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
      };

      const targetTabId = activeTabIdRef.current;
      const isTabRunning = runningTabsRef.current.has(targetTabId);

      // Get active tab history BEFORE adding the new message
      const currentTab = tabsRef.current.find(t => t.id === targetTabId);
      const currentMsgs = currentTab?.messages || [];

      // Build history with the new message (for sending to server)
      const hist = [...currentMsgs, userMsg]
        .slice(-50)
        .map((m) => {
          const msgDetails: any = { role: m.role === 'assistant' || m.role === 'system' ? m.role : 'user', content: m.text };
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

      if (!isTabRunning) {
        setTabs(prev => prev.map(t =>
          t.id === targetTabId ? { ...t, aiState: { phase: 'routing', statusText: wsReady ? 'Preparing...' : 'Connecting...' } } : t
        ));
      }

      const accessTokenPromise = getFastAccessToken();
      void refreshActiveSkillsCache();

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
      if (options.reasoningLevel && typeof options.reasoningLevel === 'string') {
        payload.reasoningLevel = options.reasoningLevel;
      }
      try {
        if (!payload.context || typeof payload.context !== 'object') payload.context = {};
        // Removed deviceId injection from memory system
      } catch { }

      // Send desktop-side connected integrations so the cloud loads the right tools
      try {
        const raw = localStorage.getItem('integrations.connected');
        if (raw) {
          const map = JSON.parse(raw);
          const clientIntegrations = Object.keys(map).filter(k => map[k] === true);
          if (clientIntegrations.length > 0) {
            payload.clientIntegrations = clientIntegrations;
          }
        }
      } catch { }

      const activeSkills = activeSkillsCacheRef.current;
      if (activeSkills.length > 0) {
        payload.context.skills = activeSkills;
      }

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
      const shouldResetConversation = resetConversationNextRef.current || (!targetConversationId && (currentTab?.messages.length ?? 0) <= 1);
      if (shouldResetConversation) {
        payload.resetConversation = true;
      }
      const accessToken = await accessTokenPromise;
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
      // and add to queuedMessages so the QueuePanel UI shows the queued item
      if (isTabRunning && !isSilent) {
        const newQueueItem = { id: userMsg.id, text: userMsg.text, timestamp: userMsg.timestamp! };
        setQueuedMessages((prev) => {
          const nextList = [...prev, newQueueItem];
          queueDepthRef.current = nextList.length;
          setQueueDepth(nextList.length);
          return nextList;
        });
        waitingQueuedStartRef.current = true;
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

  // Edit a previously sent user message: truncate history at that point & resend with new text
  const editMessage = useCallback(async (messageId: string, newText: string) => {
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
    // Sync ref immediately so sendMessage reads the truncated history (setTabs is async)
    tabsRef.current = tabsRef.current.map(t =>
      t.id === tab.id ? { ...t, messages: truncated } : t
    );

    // Resend with the new text, preserving original context
    await sendMessage({
      text: newText,
      contextPaths: originalMsg.contextPaths,
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

  const loadConversation = useCallback(async (id: string, titleHint?: string) => {
    console.log('[useAgent] loadConversation called with id:', id);

    const existing = tabsRef.current.find(t => t.serverId === id);
    if (existing) {
      console.log('[useAgent] Conversation already open, switching to tab:', existing.id);
      setActiveTabId(existing.id);
      return;
    }

    const initialTitle = typeof titleHint === 'string' && titleHint.trim() ? titleHint.trim() : 'Loading…';
    const openedTabId = addTab({ serverId: id, title: initialTitle, messages: [] });
    console.log('[useAgent] Created new tab:', openedTabId);

    const agentEndpoints = resolveAgentEndpoints(customAgentUrl);
    let loaded = false;

    const buildLoadedMessages = (rows: any[]): { hist: Message[]; lastModelLabel?: string } => {
      const orderedRows = repairLoadedConversationRows(rows);
      let lastModelLabel: string | undefined;
      const hist: Message[] = orderedRows.map((r: any) => {
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
          usage: meta.usage && typeof meta.usage === 'object' ? meta.usage : undefined,
          modelId: typeof meta?.modelId === 'string'
            ? meta.modelId
            : typeof meta?.tier === 'string'
              ? meta.tier
              : undefined,
          contextPaths: Array.isArray(meta?.contextPaths) ? meta.contextPaths : undefined,
          timestamp: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
        };
      });
      return { hist, lastModelLabel };
    };

    try {
      console.log('[useAgent] Fetching messages from local agent for conversation:', id);
      const json = await agentFetchJson(
        agentEndpoints,
        `/v1/memory/conversations/${encodeURIComponent(id)}/messages?limit=200`,
        {
          accessToken: agentEndpoints.usesVmRelay ? await getValidAccessToken() : null,
        },
      );
      if (json.ok && Array.isArray(json.messages)) {
        const { hist, lastModelLabel } = buildLoadedMessages(json.messages as any[]);
        console.log('[useAgent] Loaded', hist.length, 'messages from local agent');
        setTabs(prev => prev.map(t => t.id === openedTabId ? { ...t, messages: hist, aiState: { ...t.aiState, model: lastModelLabel } } : t));
        loaded = true;
      }
    } catch (e) {
      console.warn('[useAgent] Local agent messages fetch failed, trying Supabase:', e);
    }

    if (!loaded) {
      try {
        // Always try Supabase fallback when local agent fails — reading
        // conversation history should not be gated by sync_conversations pref
        // (that pref controls writing new conversations to cloud, not reading).
        const sessionToken = await getValidAccessToken();
        if (sessionToken) {
          const { data, error } = await supabase
            .from('messages')
            .select('role, content, metadata, created_at')
            .eq('conversation_id', id)
            .order('created_at', { ascending: true })
            .limit(200);
          if (!error && Array.isArray(data)) {
            const { hist, lastModelLabel } = buildLoadedMessages(data as any[]);
            console.log('[useAgent] Loaded', hist.length, 'messages from Supabase');
            setTabs(prev => prev.map(t => t.id === openedTabId ? { ...t, messages: hist, aiState: { ...t.aiState, model: lastModelLabel } } : t));
          }
        }
      } catch (e) {
        console.error('[useAgent] Supabase loadConversation error:', e);
      }
    }

    try {
      const convJson = await agentFetchJson(
        agentEndpoints,
        `/v1/memory/conversations/${encodeURIComponent(id)}`,
        {
          accessToken: agentEndpoints.usesVmRelay ? await getValidAccessToken() : null,
        },
      );
      if (convJson.ok && convJson.conversation?.title) {
        const title = String(convJson.conversation.title).trim();
        if (title) {
          setTabs(prev => prev.map(t => t.id === openedTabId ? { ...t, title } : t));
          return;
        }
      }
    } catch { }

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
    void refreshActiveSkillsCache();
    return () => {
      disconnect();
      cleanupAutoRefresh();
    };
  }, [connect, disconnect, refreshActiveSkillsCache]);

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
    liveUsage: activeTab?.liveUsage || null,
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
  };
}
