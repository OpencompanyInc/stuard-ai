'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { clsx } from 'clsx';
import {
  Activity,
  AlertCircle,
  Bot as BotIcon,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Cpu,
  CreditCard,
  File as FileLucide,
  FolderOpen,
  FolderPlus,
  Globe,
  Link2,
  Loader2,
  MessageCircle,
  MessageSquare,
  Paperclip,
  Plus,
  PowerOff,
  RefreshCw,
  Rocket,
  RotateCcw,
  Scale,
  Search,
  Send,
  Server,
  Shield,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import {
  createDirectory,
  deleteCloudEngine,
  deleteFile,
  getCloudConversationMessages,
  getCloudConversations,
  listFiles,
  openVMAgentChatStream,
  sendVmToolResult,
  stopCloudEngine,
  uploadFileToVm,
} from '@/lib/cloudApi';
import { useAuthContext } from '@/components/providers/AuthProvider';
import { useCloudTerminal } from '@/hooks/useCloudTerminal';
import { useModelRegistry, type ModelMeta } from '@/hooks/useModelRegistry';
import { PortableMessageBubble } from '../../../../../../../shared/chat-ui/ui';
import { appendReasoningChunk, appendTextChunk, applyToolCallUpdate, upsertStatusChunk } from '../../../../../../../shared/chat-ui/streamState';
import { mergeStreamingText } from '../../../../../../../shared/chat-ui/streamMerge';
import type { Message as ChatMessage, StreamChunk, ToolCall } from '../../../../../../../shared/chat-ui/types';
import { AskUserPrompt } from '../../../../../../../shared/chat-ui/AskUserPrompt';
import { ChatUiBlock } from './ChatUiBlock';
import { CloudMonitoring } from './CloudMonitoring';
import { CloudBilling } from './CloudBilling';

interface CloudIDELayoutProps {
  engine: any;
  onRefresh: () => void | Promise<void>;
}

type ActivityView =
  | 'chat'
  | 'overview'
  | 'monitoring'
  | 'billing'
  | 'deploys'
  | 'integrations'
  | 'permissions'
  | 'bots'
  | 'automations';

type CloudRuntimeMode = 'normal' | 'developer';

type ViewItem = {
  id: ActivityView | 'files' | 'terminal';
  icon: any;
  label: string;
  toggle?: 'explorer' | 'terminal';
};

const MODE_STORAGE_KEY = 'cloud:runtime-mode';

const NORMAL_VIEW_ITEMS: ViewItem[] = [
  { id: 'chat', icon: MessageCircle, label: 'Chat' },
  { id: 'bots', icon: BotIcon, label: 'Bots' },
  { id: 'files', icon: FolderOpen, label: 'Files' },
  { id: 'automations', icon: Zap, label: 'Automations' },
];

const DEVELOPER_VIEW_ITEMS: ViewItem[] = [
  { id: 'files', icon: FolderOpen, label: 'Files', toggle: 'explorer' },
  { id: 'chat', icon: MessageCircle, label: 'Chat' },
  { id: 'overview', icon: Server, label: 'Overview' },
  { id: 'monitoring', icon: Activity, label: 'Monitoring' },
  { id: 'bots', icon: BotIcon, label: 'Bots' },
  { id: 'automations', icon: Zap, label: 'Automations' },
  { id: 'integrations', icon: Link2, label: 'Integrations' },
  { id: 'deploys', icon: Rocket, label: 'Deploys' },
  { id: 'billing', icon: CreditCard, label: 'Billing' },
  { id: 'permissions', icon: Shield, label: 'Permissions' },
  { id: 'terminal', icon: Terminal, label: 'Terminal', toggle: 'terminal' },
];

const MIN_TERMINAL_H = 140;
const MAX_TERMINAL_H = 500;
const DEFAULT_TERMINAL_H = 220;

interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'symlink' | 'other';
  size: number;
  modified: string;
}

interface ConversationEntry {
  id: string;
  title: string;
  updated_at: string;
  message_count: number;
}

const QUICK_PROMPTS = [
  'Review system health',
  'Summarize current deployments',
  'Inspect the runtime and open ports',
];

const PROVIDER_FALLBACK_ICONS: Record<string, React.ReactNode> = {
  'OpenAI': <span className="w-4 h-4 flex items-center justify-center text-[10px] font-bold bg-emerald-500 text-white rounded">O</span>,
  'Google': <span className="w-4 h-4 flex items-center justify-center text-[10px] font-bold bg-blue-500 text-white rounded">G</span>,
  'xAI': <span className="w-4 h-4 flex items-center justify-center text-[10px] font-bold bg-black text-white rounded italic">x</span>,
  'DeepSeek': <span className="w-4 h-4 flex items-center justify-center text-[10px] font-bold bg-blue-600 text-white rounded">D</span>,
  'Perplexity': <span className="w-4 h-4 flex items-center justify-center text-[10px] font-bold bg-cyan-500 text-white rounded">P</span>,
  'Anthropic': <span className="w-4 h-4 flex items-center justify-center text-[10px] font-bold bg-orange-500 text-white rounded">A</span>,
  'OpenRouter': <span className="w-4 h-4 flex items-center justify-center text-[10px] font-bold bg-purple-500 text-white rounded">R</span>,
};

const TIER_DEFAULTS: Record<'fast' | 'balanced' | 'smart' | 'research', string> = {
  fast: 'deepseek/deepseek-chat',
  balanced: 'xai/grok-4-1-fast',
  smart: 'google/gemini-2.5-pro',
  research: 'perplexity/sonar-pro',
};

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededShuffle<T>(arr: T[], seed: string): T[] {
  const out = [...arr];
  let x = hashString(seed) || 1;
  const rnd = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 0xffffffff; };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function CloudIDELayout({ engine, onRefresh }: CloudIDELayoutProps) {
  const { user, userData } = useAuthContext();
  const { models, modelById } = useModelRegistry();

  const [mode, setModeState] = useState<CloudRuntimeMode>(() => {
    if (typeof window === 'undefined') return 'normal';
    const stored = window.localStorage?.getItem(MODE_STORAGE_KEY);
    return stored === 'developer' ? 'developer' : 'normal';
  });
  const setMode = useCallback((next: CloudRuntimeMode) => {
    setModeState(next);
    try { window.localStorage?.setItem(MODE_STORAGE_KEY, next); } catch { /* noop */ }
  }, []);

  const [activeView, setActiveView] = useState<ActivityView>('chat');
  const [filePanelOpen, setFilePanelOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(DEFAULT_TERMINAL_H);
  const [pauseLoading, setPauseLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const items = useMemo(
    () => (mode === 'normal' ? NORMAL_VIEW_ITEMS : DEVELOPER_VIEW_ITEMS),
    [mode],
  );

  useEffect(() => {
    const allowed = items.filter((i) => !i.toggle).map((i) => i.id);
    if (!allowed.includes(activeView)) setActiveView('chat');
  }, [items, activeView]);

  useEffect(() => {
    if (mode === 'normal') {
      setFilePanelOpen(false);
      setTerminalOpen(false);
    }
  }, [mode]);

  const handlePause = useCallback(async () => {
    setPauseLoading(true);
    try {
      await stopCloudEngine();
      await onRefresh();
    } catch (e) {
      console.error('Failed to pause engine:', e);
    } finally {
      setPauseLoading(false);
    }
  }, [onRefresh]);

  const handleDelete = useCallback(async () => {
    if (typeof window === 'undefined') return;
    if (!window.confirm('Permanently delete your cloud engine and all its data? This cannot be undone.')) return;
    setDeleteLoading(true);
    try {
      await deleteCloudEngine();
      await onRefresh();
    } catch (e) {
      console.error('Failed to delete engine:', e);
    } finally {
      setDeleteLoading(false);
    }
  }, [onRefresh]);

  const handleTerminalResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = terminalHeight;
    const onMove = (ev: MouseEvent) => {
      const delta = startY - ev.clientY;
      setTerminalHeight(Math.max(MIN_TERMINAL_H, Math.min(MAX_TERMINAL_H, startH + delta)));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [terminalHeight]);

  const activeLabel = useMemo(
    () => items.find((item) => item.id === activeView)?.label ?? 'Chat',
    [items, activeView],
  );

  const planLabel = String(engine?.tier || 'cloud').replace(/^\w/, (c: string) => c.toUpperCase());
  const machineLabel =
    engine?.vcpus && engine?.ram_gb
      ? `${engine.vcpus} vCPU / ${engine.ram_gb} GB`
      : 'Runtime';

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const conversationTitleRef = useRef<string>('');
  const [streamText, setStreamText] = useState('');
  const [streamReasoning, setStreamReasoning] = useState('');
  const [streamTools, setStreamTools] = useState<ToolCall[]>([]);
  const [streamChunks, setStreamChunks] = useState<StreamChunk[]>([]);
  const [askUserPrompts, setAskUserPrompts] = useState<Array<{ id: string; args: any; status: 'pending' | 'completed' }>>([]);
  const streamStartRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Model selector
  const [selectedModel, setSelectedModel] = useState<string>('auto');
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const modelSearchRef = useRef<HTMLInputElement>(null);

  // History panel
  const [conversations, setConversations] = useState<ConversationEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [loadingConvId, setLoadingConvId] = useState<string | null>(null);
  const historyPanelRef = useRef<HTMLDivElement>(null);

  // File tree
  const [dirContents, setDirContents] = useState<Record<string, FileEntry[]>>({});
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());
  const [fileActionError, setFileActionError] = useState<string | null>(null);
  const [uploadingFileName, setUploadingFileName] = useState<string | null>(null);
  const fileUploadInputRef = useRef<HTMLInputElement | null>(null);
  const fileUploadTargetDirRef = useRef<string>('.');

  // Pending chat attachments (files on the VM that will be referenced with the next message)
  interface VmChatPendingAttachment {
    id: string;
    name: string;
    path: string;
    size?: number;
    mimeType?: string;
    uploading?: boolean;
    error?: string;
  }
  const [pendingAttachments, setPendingAttachments] = useState<VmChatPendingAttachment[]>([]);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);

  const termContainerRef = useRef<HTMLDivElement>(null);
  const { connected, connect, sendData, resize, onData, close } = useCloudTerminal();

  const isRunning = engine?.status === 'running';

  const displayName =
    userData?.displayName ||
    (user as any)?.user_metadata?.full_name ||
    (user as any)?.user_metadata?.fullName ||
    user?.email?.split('@')[0] ||
    'there';
  const firstName = String(displayName).split(/\s+/)[0] || 'there';

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  }, []);

  const selectedModelMeta = useMemo((): ModelMeta | null => {
    if (selectedModel === 'auto') return null;
    return modelById.get(selectedModel) || null;
  }, [selectedModel, modelById]);

  const filteredModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    if (!query) return models;
    return models.filter((m) =>
      [m.name, m.provider, m.id, m.category].filter(Boolean).join(' ').toLowerCase().includes(query),
    );
  }, [modelSearch, models]);

  const groupedModels = useMemo(() => {
    if (modelSearch.trim()) return null;
    const today = new Date();
    const seedDay = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const build = (tier: 'fast' | 'balanced' | 'smart' | 'research') => {
      const list = tier === 'fast'
        ? models.filter((m) => m.category === 'fast' && !m.isReasoning)
        : models.filter((m) => m.category === tier);
      if (!list.length) return [] as typeof models;
      const def = list.find((m) => m.id === TIER_DEFAULTS[tier]) || list[0];
      const rest = seededShuffle(list.filter((m) => m.id !== def.id), `${seedDay}:${tier}`);
      return [def, ...rest.slice(0, 2)];
    };
    return { fast: build('fast'), balanced: build('balanced'), smart: build('smart'), research: build('research') };
  }, [modelSearch, models]);

  // ── Close pickers on outside click ────────────────────────────────────────

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
    if (!showModelPicker) { setModelSearch(''); return; }
    const t = window.setTimeout(() => modelSearchRef.current?.focus(), 40);
    return () => window.clearTimeout(t);
  }, [showModelPicker]);

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

  // ── Scroll ─────────────────────────────────────────────────────────────────

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, chatLoading, streamText, streamReasoning, streamTools, streamChunks, askUserPrompts, scrollToBottom]);

  // ── File tree ──────────────────────────────────────────────────────────────

  const loadDir = useCallback(async (path: string) => {
    setLoadingDirs((prev) => new Set(prev).add(path));
    try {
      const data = await listFiles(path);
      if (data.ok) setDirContents((prev) => ({ ...prev, [path]: data.entries || [] }));
    } finally {
      setLoadingDirs((prev) => { const next = new Set(prev); next.delete(path); return next; });
    }
  }, []);

  useEffect(() => {
    if (isRunning) void loadDir('.');
  }, [isRunning, loadDir]);

  const triggerUploadInto = useCallback((dirPath: string) => {
    fileUploadTargetDirRef.current = dirPath || '.';
    setFileActionError(null);
    fileUploadInputRef.current?.click();
  }, []);

  const handleFileUploadSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    const dir = fileUploadTargetDirRef.current || '.';
    setFileActionError(null);
    for (const file of files) {
      const targetPath = dir === '.' ? file.name : `${dir}/${file.name}`;
      setUploadingFileName(file.name);
      try {
        const res = await uploadFileToVm(targetPath, file);
        if (!res?.ok) {
          setFileActionError(res?.error || `Failed to upload ${file.name}`);
        }
      } catch (err: any) {
        setFileActionError(err?.message || `Failed to upload ${file.name}`);
      }
    }
    setUploadingFileName(null);
    void loadDir(dir);
  }, [loadDir]);

  const handleCreateDir = useCallback(async (parentDir: string) => {
    const name = typeof window !== 'undefined' ? window.prompt('New folder name:') : null;
    if (!name) return;
    const path = parentDir === '.' ? name : `${parentDir}/${name}`;
    setFileActionError(null);
    try {
      const res = await createDirectory(path);
      if (!res?.ok) setFileActionError(res?.error || 'Failed to create folder');
    } catch (err: any) {
      setFileActionError(err?.message || 'Failed to create folder');
    }
    void loadDir(parentDir);
  }, [loadDir]);

  const handleDeleteEntry = useCallback(async (entry: FileEntry) => {
    if (typeof window !== 'undefined' && !window.confirm(`Delete ${entry.path}?`)) return;
    setFileActionError(null);
    try {
      const res = await deleteFile(entry.path);
      if (!res?.ok) setFileActionError(res?.error || `Failed to delete ${entry.name}`);
    } catch (err: any) {
      setFileActionError(err?.message || `Failed to delete ${entry.name}`);
    }
    const parent = entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : '.';
    void loadDir(parent || '.');
  }, [loadDir]);

  // ── Pending attachments (VM chat) ──────────────────────────────────────────

  const addExistingFileAttachment = useCallback((entry: { name: string; path: string; size?: number }) => {
    setPendingAttachments((prev) => {
      if (prev.some((a) => a.path === entry.path)) return prev;
      return [...prev, { id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: entry.name, path: entry.path, size: entry.size }];
    });
    setActiveView('chat');
  }, []);

  const removePendingAttachment = useCallback((id: string) => {
    setPendingAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const handleAttachClick = useCallback(() => {
    attachmentInputRef.current?.click();
  }, []);

  const handleAttachmentFilesSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    for (const file of files) {
      const id = `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const targetPath = `uploads/${file.name}`;
      setPendingAttachments((prev) => [...prev, { id, name: file.name, path: targetPath, size: file.size, mimeType: file.type, uploading: true }]);
      try {
        const res = await uploadFileToVm(targetPath, file);
        if (!res?.ok) {
          setPendingAttachments((prev) => prev.map((a) => a.id === id ? { ...a, uploading: false, error: res?.error || 'upload_failed' } : a));
        } else {
          setPendingAttachments((prev) => prev.map((a) => a.id === id ? { ...a, uploading: false, path: res.path || targetPath, size: res.size ?? a.size } : a));
        }
      } catch (err: any) {
        setPendingAttachments((prev) => prev.map((a) => a.id === id ? { ...a, uploading: false, error: err?.message || 'upload_failed' } : a));
      }
    }
    // Refresh the explorer once uploads settle
    void loadDir('.');
  }, [loadDir]);

  // ── Terminal ───────────────────────────────────────────────────────────────

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!terminalOpen || !termContainerRef.current || !isRunning) return;
    let term: any, fitAddon: any, ro: ResizeObserver | null = null;
    let disposeInput: { dispose: () => void } | undefined;
    let disposeWs: (() => void) | undefined;
    let disposed = false;

    const init = async () => {
      try {
        const { Terminal } = await import('@xterm/xterm');
        const { FitAddon } = await import('@xterm/addon-fit');
        const { WebLinksAddon } = await import('@xterm/addon-web-links');
        await import('@xterm/xterm/css/xterm.css');
        if (disposed) return;
        term = new Terminal({
          fontFamily: '"JetBrains Mono", "Fira Code", monospace',
          fontSize: 13,
          theme: {
            background: '#0f172a',
            foreground: '#e2e8f0',
            cursor: '#e2e8f0',
            cursorAccent: '#0f172a',
            selectionBackground: 'rgba(0, 122, 255, 0.35)',
          },
          cursorBlink: true,
        });
        fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.loadAddon(new WebLinksAddon());
        term.open(termContainerRef.current!);
        fitAddon.fit();
        disposeInput = term.onData((data: string) => sendData(data));
        onData((data: string) => term.write(data));
        disposeWs = connect({ cols: term.cols, rows: term.rows });
        ro = new ResizeObserver(() => { if (!disposed) { fitAddon.fit(); resize(term.cols, term.rows); } });
        ro.observe(termContainerRef.current!);
      } catch (error) {
        if (!disposed) console.error('Terminal init failed:', error);
      }
    };

    void init();
    return () => {
      disposed = true;
      ro?.disconnect();
      disposeInput?.dispose();
      disposeWs?.();
      term?.dispose();
      close();
    };
  }, [terminalOpen, isRunning, close, connect, onData, resize, sendData]);

  // ── History ────────────────────────────────────────────────────────────────

  const upsertConversation = useCallback((entry: Partial<ConversationEntry> & { id: string; incrementBy?: number }) => {
    setConversations((prev) => {
      const existing = prev.find((c) => c.id === entry.id);
      const next: ConversationEntry = {
        id: entry.id,
        title: entry.title || existing?.title || 'Untitled',
        updated_at: entry.updated_at || new Date().toISOString(),
        message_count: entry.message_count ?? Math.max(0, (existing?.message_count || 0) + (entry.incrementBy || 0)),
      };
      return (existing
        ? prev.map((c) => (c.id === entry.id ? { ...c, ...next } : c))
        : [next, ...prev]
      ).sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()).slice(0, 30);
    });
  }, []);

  const fetchHistory = useCallback(async () => {
    if (!isRunning) return;
    setHistoryLoading(true);
    try {
      const res = await getCloudConversations(30);
      if (res.ok && Array.isArray(res.conversations)) {
        setConversations((prev) => {
          const byId = new Map<string, ConversationEntry>();
          for (const c of res.conversations as any[]) {
            if (!c?.id) continue;
            byId.set(c.id, {
              id: c.id,
              title: c.title || 'Untitled',
              updated_at: c.updated_at || c.created_at || '',
              message_count: c.message_count || 0,
            });
          }
          for (const local of prev) {
            if (!byId.has(local.id)) byId.set(local.id, local);
          }
          return Array.from(byId.values())
            .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
            .slice(0, 30);
        });
      }
    } catch {}
    setHistoryLoading(false);
  }, [isRunning]);

  useEffect(() => {
    if (isRunning && showHistory) void fetchHistory();
  }, [isRunning, showHistory, fetchHistory]);

  const loadConversation = useCallback(async (convId: string) => {
    setLoadingConvId(convId);
    try {
      const res = await getCloudConversationMessages(convId, 100);
      const rawMsgs: any[] = res.ok && Array.isArray(res.messages) ? res.messages : [];
      if (rawMsgs.length > 0) {
        const loaded: ChatMessage[] = rawMsgs.map((m: any, i: number) => ({
          id: `${convId}-${i}`,
          role: m.role === 'assistant' ? 'assistant' as const : 'user' as const,
          text: String(m.content || m.text || ''),
          timestamp: m.created_at ? new Date(m.created_at).getTime() : Date.now(),
        }));
        setStreamText(''); setStreamReasoning(''); setStreamTools([]); setStreamChunks([]); setAskUserPrompts([]);
        setMessages(loaded);
        setConversationId(convId);
        const conv = conversations.find((c) => c.id === convId);
        if (conv) conversationTitleRef.current = conv.title;
      }
    } catch {}
    setLoadingConvId(null);
    setShowHistory(false);
    scrollToBottom();
  }, [conversations, scrollToBottom]);

  const startNewChat = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]); setChatLoading(false);
    setStreamText(''); setStreamReasoning(''); setStreamTools([]); setStreamChunks([]); setAskUserPrompts([]);
    setConversationId(null); conversationTitleRef.current = '';
    setShowHistory(false);
    setPendingAttachments([]);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const formatTimeAgo = (dateStr: string) => {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  // ── Chat ───────────────────────────────────────────────────────────────────

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setChatLoading(false);
    setStreamText(''); setStreamReasoning(''); setStreamTools([]); setStreamChunks([]);
  }, []);

  const handleClear = useCallback(() => {
    handleStop();
    setMessages([]); setConversationId(null); conversationTitleRef.current = ''; setAskUserPrompts([]);
    setPendingAttachments([]);
  }, [handleStop]);

  const applyPrompt = useCallback((prompt: string) => {
    setInput(prompt);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const handleAskUserRespond = useCallback((id: string, result: any) => {
    setAskUserPrompts((prev) => prev.map((p) => (p.id === id ? { ...p, status: 'completed' } : p)));
    void sendVmToolResult(id, result);
  }, []);

  const handleGenUIRespond = useCallback((toolId: string, result: any) => {
    void sendVmToolResult(toolId, result);
  }, []);

  const interactiveToolRenderer = useCallback(
    (tool: ToolCall, key: string): React.ReactNode => {
      if (tool.tool === 'ask_user') {
        const tracked = askUserPrompts.find((p) => p.id === tool.id);
        const isPending = tool.status !== 'completed' && tool.status !== 'error'
          && (!tracked || tracked.status === 'pending');
        if (!isPending) return null;
        return (
          <AskUserPrompt
            key={key}
            prompt={{ id: tool.id, args: tool.args }}
            onRespond={handleAskUserRespond}
          />
        );
      }
      if (tool.tool === 'chat_ui') {
        return <ChatUiBlock key={key} tool={tool} />;
      }
      // Fallback for other GenUI tools (ask_confirmation, show_choices, ...).
      // Render the same AskUserPrompt with normalized args when status is pending.
      if (tool.status !== 'completed' && tool.status !== 'error') {
        return (
          <AskUserPrompt
            key={key}
            prompt={{ id: tool.id, args: tool.args }}
            onRespond={handleGenUIRespond}
          />
        );
      }
      return null;
    },
    [askUserPrompts, handleAskUserRespond, handleGenUIRespond],
  );

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || chatLoading) return;
    if (pendingAttachments.some((a) => a.uploading)) return;

    const readyAttachments = pendingAttachments.filter((a) => !a.error && !a.uploading);

    const controller = new AbortController();
    abortRef.current = controller;

    setInput('');
    setMessages((prev) => [...prev, {
      id: `user-${Date.now()}`,
      role: 'user',
      text,
      timestamp: Date.now(),
      attachments: readyAttachments.length > 0
        ? readyAttachments.map((a) => ({
            type: 'file' as const,
            name: a.name,
            path: a.path,
            mimeType: a.mimeType,
            source: 'picker' as const,
          }))
        : undefined,
    }]);
    setPendingAttachments([]);
    setChatLoading(true);
    setStreamText(''); setStreamReasoning(''); setStreamTools([]); setStreamChunks([]);
    streamStartRef.current = Date.now();

    let accText = '', accReasoning = '';
    let accTools: ToolCall[] = [], accChunks: StreamChunk[] = [];
    let gotFinal = false;

    const normalizeToolStatus = (s?: string): ToolCall['status'] => {
      switch (String(s || '').toLowerCase()) {
        case 'completed': case 'result': case 'step_completed': return 'completed';
        case 'error': case 'failed': case 'timeout': case 'step_error': return 'error';
        case 'running': case 'started': case 'step_started': return 'running';
        default: return 'called';
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
      if (!nested) { accReasoning = mergeStreamingText(accReasoning, chunk); setStreamReasoning(accReasoning); }
      accChunks = appendReasoningChunk(accChunks, chunk, nested);
      setStreamChunks([...accChunks]);
    };

    const pushTool = (tool: ToolCall) => {
      const next = applyToolCallUpdate(accTools, accChunks, { ...tool, timestamp: tool.timestamp || Date.now() });
      accTools = next.toolCalls; accChunks = next.streamChunks;
      setStreamTools([...accTools]); setStreamChunks([...accChunks]);
    };

    const upsertAskUser = (id: string, args: any) => {
      setAskUserPrompts((prev) => {
        const byId = id ? prev.find((p) => p.id === id) : undefined;
        const byPending = byId ? undefined : prev.find((p) => p.status === 'pending');
        const match = byId || byPending;
        if (match) return prev.map((p) => (p === match ? { ...p, id: id || p.id, args } : p));
        return [...prev, { id: id || `ask-${Date.now()}`, args, status: 'pending' }];
      });
    };

    const completeAskUser = (id: string) => {
      setAskUserPrompts((prev) => prev.map((p) => {
        const matches = id ? p.id === id : p.status === 'pending';
        return matches ? { ...p, status: 'completed' as const } : p;
      }));
    };

    // Derive model tier and explicit model id
    const isAuto = selectedModel === 'auto';
    const meta: ModelMeta | undefined = !isAuto ? modelById.get(selectedModel) : undefined;
    const modelTier = isAuto ? 'auto' : ((meta?.category as string) || (meta?.isReasoning ? 'smart' : 'balanced'));
    const explicitModelId = !isAuto ? selectedModel : undefined;

    try {
      const attachmentsPayload = readyAttachments.length > 0
        ? readyAttachments.map((a) => ({
            type: 'file',
            name: a.name,
            path: a.path,
            mimeType: a.mimeType,
            size: a.size,
            source: 'vm',
          }))
        : undefined;
      const contextPaths = readyAttachments.length > 0
        ? readyAttachments.map((a) => ({ path: a.path, name: a.name, isDirectory: false }))
        : undefined;

      const res = await openVMAgentChatStream({
        message: text,
        conversationId: conversationId || undefined,
        model: modelTier,
        modelId: explicitModelId,
        attachments: attachmentsPayload,
        contextPaths,
        signal: controller.signal,
      });

      const contentType = res.headers.get('content-type') || '';

      if (contentType.includes('text/event-stream') && res.body) {
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
              case 'conversation':
                if (event.conversationId) setConversationId(event.conversationId);
                break;

              case 'title':
                if (event.title) {
                  conversationTitleRef.current = event.title;
                  const cid = event.conversationId || conversationId;
                  if (cid) upsertConversation({ id: cid, title: event.title, updated_at: new Date().toISOString() });
                }
                break;

              case 'progress': {
                const ev = event.event || '';
                const d = event.data || {};
                if (ev === 'delta' || ev === 'text') pushText(d.text || '');
                else if (ev === 'reasoning' || ev === 'reasoning_start') pushReasoning(d.text || '');
                else if (ev === 'compacting') {
                  const phase = d.phase === 'done' ? 'done' : 'start';
                  const round = typeof d.round === 'number' ? d.round : undefined;
                  const id = round != null ? `compacting-${round}` : 'compacting';
                  accChunks = upsertStatusChunk(accChunks, {
                    type: 'status',
                    id,
                    variant: 'compacting',
                    label: phase === 'done' ? 'Compacted context' : 'Compacting context',
                    state: phase === 'done' ? 'complete' : 'active',
                    meta: {
                      round,
                      maxRounds: typeof d.maxRounds === 'number' ? d.maxRounds : undefined,
                      tokensBefore: typeof d.tokensBefore === 'number' ? d.tokensBefore : undefined,
                      tokensAfter: typeof d.tokensAfter === 'number' ? d.tokensAfter : undefined,
                    },
                  });
                  setStreamChunks([...accChunks]);
                }
                break;
              }

              case 'tool_event': {
                const toolName = event.tool || event.data?.tool || '';
                const toolStatus = event.status || event.data?.status || '';
                const toolData = event.data || {};
                const toolId = toolData.id || toolData.toolCallId || event.id || '';
                if (toolName) {
                  const ns = normalizeToolStatus(toolStatus);
                  const resolvedArgs = toolData.args ?? ((ns === 'called' || ns === 'running') ? toolData : undefined);
                  pushTool({
                    id: toolId, tool: toolName, status: ns,
                    args: resolvedArgs,
                    result: toolData.result ?? (ns === 'completed' ? toolData : undefined),
                    error: toolData.error ?? (ns === 'error' ? toolData : undefined),
                    liveOutput: typeof toolData.liveOutput === 'string' ? toolData.liveOutput
                      : typeof toolData.output === 'string' ? toolData.output : undefined,
                    timestamp: Date.now(),
                  });
                  if (toolName === 'ask_user' && resolvedArgs && (ns === 'called' || ns === 'running')) {
                    upsertAskUser(toolId, resolvedArgs);
                  } else if (toolName === 'ask_user' && (ns === 'completed' || ns === 'error')) {
                    completeAskUser(toolId);
                  }
                }
                break;
              }

              case 'tool_request': {
                const toolName = event.tool || '';
                const toolArgs = event.args || {};
                const toolId = event.id || '';
                if (toolName) {
                  pushTool({ id: toolId, tool: toolName, status: 'called', args: toolArgs, timestamp: Date.now() });
                  if (toolName === 'ask_user' && toolArgs) upsertAskUser(toolId, toolArgs);
                }
                break;
              }

              case 'subagent_event': {
                const subEvent = event.event || '';
                const subData = event.data || {};
                const subagentId = event.subagentId || subData.subagentId || '';
                if ((subEvent === 'delta' || subEvent === 'reasoning' || subEvent === 'reasoning_start') && subData.text) {
                  pushReasoning(subData.text, true);
                } else if (subEvent === 'compacting') {
                  const phase = subData.phase === 'done' ? 'done' : 'start';
                  const round = typeof subData.round === 'number' ? subData.round : undefined;
                  const id = `compacting-${subagentId || 'sub'}-${round ?? 'x'}`;
                  accChunks = upsertStatusChunk(accChunks, {
                    type: 'status',
                    id,
                    variant: 'compacting',
                    label: phase === 'done' ? 'Subagent compacted context' : 'Subagent compacting context',
                    state: phase === 'done' ? 'complete' : 'active',
                    nested: true,
                    meta: {
                      round,
                      maxRounds: typeof subData.maxRounds === 'number' ? subData.maxRounds : undefined,
                      tokensBefore: typeof subData.tokensBefore === 'number' ? subData.tokensBefore : undefined,
                      tokensAfter: typeof subData.tokensAfter === 'number' ? subData.tokensAfter : undefined,
                    },
                  });
                  setStreamChunks([...accChunks]);
                } else if (subEvent === 'tool_call') {
                  pushTool({
                    id: subData.toolCallId || subData.id || `${subagentId || 'subagent'}-${subData.tool || 'tool'}`,
                    tool: subData.tool || subData.name || 'tool', status: 'called',
                    args: subData.args, timestamp: Date.now(), subagentId: subagentId || undefined, nested: true,
                  });
                } else if (subEvent === 'tool_result') {
                  pushTool({
                    id: subData.toolCallId || subData.id || `${subagentId || 'subagent'}-${subData.tool || 'tool'}`,
                    tool: subData.tool || subData.name || 'tool',
                    status: subData.error ? 'error' : 'completed',
                    result: subData.result, error: subData.error, timestamp: Date.now(),
                    subagentId: subagentId || undefined, nested: true,
                  });
                }
                break;
              }

              case 'final':
                gotFinal = true;
                if (event.conversationId) setConversationId(event.conversationId);
                if (event.text || event.data?.text) accText = event.text || event.data?.text || accText;
                break;

              case 'error':
                gotFinal = true;
                setMessages((prev) => [...prev, {
                  id: `assistant-error-${Date.now()}`, role: 'assistant',
                  text: accText || `Error: ${event.error || 'unknown'}`,
                  reasoning: accReasoning || undefined,
                  toolCalls: accTools.length > 0 ? accTools : undefined,
                  streamChunks: accChunks.length > 0 ? accChunks : undefined,
                }]);
                accText = ''; accReasoning = ''; accTools = []; accChunks = [];
                break;
            }
          }
        }

        if (!gotFinal || accText || accReasoning || accTools.length > 0) {
          setMessages((prev) => [...prev, {
            id: `assistant-${Date.now()}`, role: 'assistant',
            text: accText || 'No response',
            reasoning: accReasoning || undefined,
            reasoningDuration: streamStartRef.current ? (Date.now() - streamStartRef.current) / 1000 : undefined,
            toolCalls: accTools.length > 0 ? accTools : undefined,
            streamChunks: accChunks.length > 0 ? accChunks : undefined,
          }]);
        }

        const cid = conversationId;
        if (cid) {
          const fallbackTitle = (conversationTitleRef.current || text.slice(0, 80) || 'Untitled').trim();
          conversationTitleRef.current = fallbackTitle;
          upsertConversation({ id: cid, title: fallbackTitle, updated_at: new Date().toISOString(), incrementBy: 2 });
        }
      } else {
        const data = await res.json() as any;
        const replyText = String(data?.text || data?.result?.text || data?.error || 'Something went wrong.').trim();
        setMessages((prev) => [...prev, { id: `assistant-${Date.now()}`, role: 'assistant', text: replyText }]);
        if (data?.conversationId) setConversationId(data.conversationId);
      }
    } catch (error: any) {
      if (error?.name === 'AbortError') return;
      setMessages((prev) => [...prev, {
        id: `assistant-error-${Date.now()}`, role: 'assistant', text: 'Connection error. Please try again.',
      }]);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setChatLoading(false);
      setStreamText(''); setStreamReasoning(''); setStreamTools([]); setStreamChunks([]);
      inputRef.current?.focus();
    }
  }, [chatLoading, conversationId, input, selectedModel, modelById, upsertConversation, pendingAttachments]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendMessage(); }
  }, [sendMessage]);

  // ── File tree toggle ───────────────────────────────────────────────────────

  const toggleDir = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) { next.delete(path); } else { next.add(path); if (!dirContents[path]) void loadDir(path); }
      return next;
    });
  }, [dirContents, loadDir]);

  // ── Model selector ─────────────────────────────────────────────────────────

  const renderModelIcon = (m: import('@/hooks/useModelRegistry').ModelMeta, size: 'sm' | 'md' = 'sm') => {
    const sz = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';
    if (m.logoUrl) return <img src={m.logoUrl} className={clsx(sz, 'rounded object-contain')} alt="" />;
    return PROVIDER_FALLBACK_ICONS[m.provider] || <Cpu className={clsx(size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4', 'text-theme-muted')} />;
  };

  const modelSelector = (
    <div className="relative" ref={modelPickerRef}>
      <button
        type="button"
        onClick={() => setShowModelPicker((v) => !v)}
        className="dashboard-refresh-button inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs !rounded-xl"
      >
        <div className="flex h-4 w-4 items-center justify-center shrink-0">
          {selectedModel === 'auto'
            ? <Sparkles className="h-3.5 w-3.5 text-primary" />
            : selectedModelMeta ? renderModelIcon(selectedModelMeta) : <Cpu className="h-3.5 w-3.5 text-theme-muted" />}
        </div>
        <span className="max-w-[110px] truncate font-semibold">
          {selectedModel === 'auto' ? 'Auto' : (selectedModelMeta?.name || selectedModel.split('/').pop())}
        </span>
        <ChevronDown className={clsx('h-3 w-3 text-theme-muted transition-transform', showModelPicker && 'rotate-180')} />
      </button>

      {showModelPicker && (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-[360px] overflow-hidden rounded-2xl border border-theme bg-theme-card/95 shadow-elevate backdrop-blur-xl">
          {/* Search */}
          <div className="border-b border-theme/10 bg-theme-bg/50 px-3 py-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-theme-muted" />
              <input
                ref={modelSearchRef}
                type="text"
                value={modelSearch}
                onChange={(e) => setModelSearch(e.target.value)}
                placeholder="Search any model..."
                className="w-full rounded-xl border-none bg-theme-hover/50 py-2 pl-10 pr-3 text-sm font-medium text-theme-fg outline-none ring-1 ring-theme/5 transition-all placeholder:text-theme-muted/70 focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </div>

          <div className="max-h-[360px] overflow-y-auto p-2 custom-scrollbar">
            {modelSearch.trim() ? (
              /* ── Flat search results ── */
              <>
                {filteredModels.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => { setSelectedModel(m.id); setShowModelPicker(false); }}
                    className={clsx(
                      'flex w-full items-center gap-3 rounded-2xl p-2 text-left transition-all border border-transparent',
                      selectedModel === m.id ? 'bg-primary/10 border-primary/20' : 'hover:bg-theme-hover',
                    )}
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-theme-bg border border-theme/10 shadow-sm">
                      {renderModelIcon(m, 'md')}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-bold text-theme-fg">{m.name}</div>
                      <div className="truncate text-[10px] font-bold uppercase tracking-tighter text-theme-muted opacity-70">{m.provider}</div>
                    </div>
                    {selectedModel === m.id
                      ? <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary shadow-sm"><Check className="h-2.5 w-2.5 text-primary-fg" /></div>
                      : <ChevronRight className="h-4 w-4 shrink-0 text-theme-muted opacity-30" />}
                  </button>
                ))}
                {filteredModels.length === 0 && (
                  <div className="px-3 py-12 text-center">
                    <Search className="mx-auto mb-3 h-8 w-8 text-theme-muted opacity-40" />
                    <div className="text-xs font-medium text-theme-fg">No models found</div>
                    <div className="mt-1 text-[10px] text-theme-muted">Try a provider name, tier, or model ID.</div>
                  </div>
                )}
              </>
            ) : (
              /* ── Grouped default view ── */
              <div className="flex flex-col gap-4">
                {/* Auto */}
                <div className="px-1">
                  <button
                    type="button"
                    onClick={() => { setSelectedModel('auto'); setShowModelPicker(false); }}
                    className={clsx(
                      'flex w-full items-center gap-3 rounded-xl p-2 text-left transition-all border border-transparent',
                      selectedModel === 'auto' ? 'bg-primary/10 border-primary/20' : 'hover:bg-theme-hover',
                    )}
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 shadow-sm">
                      <Sparkles className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-bold text-theme-fg">Automatic Routing</div>
                      <div className="text-[10px] text-theme-muted">Best model for each task</div>
                    </div>
                    {selectedModel === 'auto' && <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary shadow-sm"><Check className="h-2.5 w-2.5 text-primary-fg" /></div>}
                  </button>
                </div>

                {/* Fast */}
                {groupedModels && groupedModels.fast.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2 px-2 mb-1">
                      <Zap className="h-3 w-3 text-amber-500" />
                      <span className="text-[10px] font-bold uppercase tracking-wider text-theme-muted">Fast & Efficient</span>
                    </div>
                    {groupedModels.fast.map((m) => (
                      <button key={m.id} type="button" onClick={() => { setSelectedModel(m.id); setShowModelPicker(false); }}
                        className={clsx('flex w-full items-center gap-3 rounded-2xl p-2 text-left transition-all border border-transparent', selectedModel === m.id ? 'bg-primary/10 border-primary/20' : 'hover:bg-theme-hover')}>
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-theme-bg border border-theme/10 shadow-sm">{renderModelIcon(m, 'md')}</div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-bold text-theme-fg">{m.name}</div>
                          <div className="truncate text-[10px] font-bold uppercase tracking-tighter text-theme-muted opacity-70">{m.provider}</div>
                        </div>
                        {selectedModel === m.id ? <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary shadow-sm"><Check className="h-2.5 w-2.5 text-primary-fg" /></div> : <ChevronRight className="h-4 w-4 shrink-0 text-theme-muted opacity-0 group-hover:opacity-30" />}
                      </button>
                    ))}
                  </div>
                )}

                {/* Balanced */}
                {groupedModels && groupedModels.balanced.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2 px-2 mb-1">
                      <Scale className="h-3 w-3 text-emerald-500" />
                      <span className="text-[10px] font-bold uppercase tracking-wider text-theme-muted">Balanced</span>
                    </div>
                    {groupedModels.balanced.map((m) => (
                      <button key={m.id} type="button" onClick={() => { setSelectedModel(m.id); setShowModelPicker(false); }}
                        className={clsx('flex w-full items-center gap-3 rounded-2xl p-2 text-left transition-all border border-transparent', selectedModel === m.id ? 'bg-primary/10 border-primary/20' : 'hover:bg-theme-hover')}>
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-theme-bg border border-theme/10 shadow-sm">{renderModelIcon(m, 'md')}</div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-bold text-theme-fg">{m.name}</div>
                          <div className="truncate text-[10px] font-bold uppercase tracking-tighter text-theme-muted opacity-70">{m.provider}</div>
                        </div>
                        {selectedModel === m.id ? <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary shadow-sm"><Check className="h-2.5 w-2.5 text-primary-fg" /></div> : <ChevronRight className="h-4 w-4 shrink-0 text-theme-muted opacity-0" />}
                      </button>
                    ))}
                  </div>
                )}

                {/* Smart */}
                {groupedModels && groupedModels.smart.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2 px-2 mb-1">
                      <Brain className="h-3 w-3 text-purple-500" />
                      <span className="text-[10px] font-bold uppercase tracking-wider text-theme-muted">Intelligence</span>
                    </div>
                    {groupedModels.smart.map((m) => (
                      <button key={m.id} type="button" onClick={() => { setSelectedModel(m.id); setShowModelPicker(false); }}
                        className={clsx('flex w-full items-center gap-3 rounded-2xl p-2 text-left transition-all border border-transparent', selectedModel === m.id ? 'bg-primary/10 border-primary/20' : 'hover:bg-theme-hover')}>
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-theme-bg border border-theme/10 shadow-sm">{renderModelIcon(m, 'md')}</div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-bold text-theme-fg">{m.name}</div>
                          <div className="truncate text-[10px] font-bold uppercase tracking-tighter text-theme-muted opacity-70">{m.provider}{m.isReasoning ? ' · Reasoning' : ''}</div>
                        </div>
                        {selectedModel === m.id ? <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary shadow-sm"><Check className="h-2.5 w-2.5 text-primary-fg" /></div> : <ChevronRight className="h-4 w-4 shrink-0 text-theme-muted opacity-0" />}
                      </button>
                    ))}
                  </div>
                )}

                {/* Research */}
                {groupedModels && groupedModels.research.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2 px-2 mb-1">
                      <Globe className="h-3 w-3 text-cyan-500" />
                      <span className="text-[10px] font-bold uppercase tracking-wider text-theme-muted">Research</span>
                    </div>
                    {groupedModels.research.map((m) => (
                      <button key={m.id} type="button" onClick={() => { setSelectedModel(m.id); setShowModelPicker(false); }}
                        className={clsx('flex w-full items-center gap-3 rounded-2xl p-2 text-left transition-all border border-transparent', selectedModel === m.id ? 'bg-primary/10 border-primary/20' : 'hover:bg-theme-hover')}>
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-theme-bg border border-theme/10 shadow-sm">{renderModelIcon(m, 'md')}</div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-bold text-theme-fg">{m.name}</div>
                          <div className="truncate text-[10px] font-bold uppercase tracking-tighter text-theme-muted opacity-70">{m.provider}</div>
                        </div>
                        {selectedModel === m.id ? <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary shadow-sm"><Check className="h-2.5 w-2.5 text-primary-fg" /></div> : <ChevronRight className="h-4 w-4 shrink-0 text-theme-muted opacity-0" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-theme/10 bg-theme-bg/50 px-3 py-2 flex items-center justify-end">
            <span className="text-[10px] text-theme-muted italic">{models.length} models available</span>
          </div>
        </div>
      )}
    </div>
  );

  // ── History button ─────────────────────────────────────────────────────────

  const historyButton = (
    <div className="relative" ref={historyPanelRef}>
      <button
        type="button"
        onClick={() => setShowHistory((open) => { if (!open) void fetchHistory(); return !open; })}
        className="dashboard-refresh-button inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs !rounded-xl"
        title="Chat history"
      >
        <Clock className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">History</span>
      </button>

      {showHistory && (
        <div className="absolute bottom-full left-0 z-50 mb-2 flex max-h-96 w-80 flex-col rounded-2xl border border-theme bg-theme-card shadow-elevate">
          <div className="flex items-center justify-between gap-2 border-b border-theme/10 px-3 py-2.5">
            <span className="text-xs font-semibold text-theme-fg">Conversations</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => { startNewChat(); setShowHistory(false); }}
                className="inline-flex items-center gap-1 rounded-lg bg-primary/10 px-2 py-1 text-[10px] text-primary transition-colors hover:bg-primary/20"
              >
                <Plus className="h-3 w-3" /> New
              </button>
              <button type="button" onClick={() => setShowHistory(false)} className="rounded p-0.5 text-theme-muted hover:text-theme-fg">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-1" style={{ scrollbarWidth: 'none' }}>
            {historyLoading && conversations.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-4 w-4 animate-spin text-theme-muted" />
              </div>
            ) : conversations.length === 0 ? (
              <div className="py-8 text-center text-[11px] italic text-theme-muted">No conversations yet</div>
            ) : (
              conversations.map((c) => {
                const isActive = conversationId === c.id;
                const isLoadingConv = loadingConvId === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => void loadConversation(c.id)}
                    disabled={isLoadingConv}
                    className={clsx(
                      'w-full rounded-xl px-3 py-2.5 text-left transition-colors',
                      isActive ? 'bg-primary/10' : 'hover:bg-theme-hover/60',
                    )}
                  >
                    <div className="flex items-start gap-2">
                      {isLoadingConv ? (
                        <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                      ) : (
                        <MessageSquare className={clsx('mt-0.5 h-3.5 w-3.5 shrink-0', isActive ? 'text-primary' : 'text-theme-muted')} />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-theme-fg">{c.title}</div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-theme-muted">
                          {c.message_count > 0 && <span>{c.message_count} msgs</span>}
                          {c.updated_at && <span>{formatTimeAgo(c.updated_at)}</span>}
                        </div>
                      </div>
                      {isActive && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
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

  // ── Composer ───────────────────────────────────────────────────────────────

  const isUploadingAny = pendingAttachments.some((a) => a.uploading);

  const composer = (
    <div className="rounded-2xl border border-theme/10 bg-theme-card/30 transition-colors focus-within:border-primary/30">
      {pendingAttachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
          {pendingAttachments.map((a) => (
            <div
              key={a.id}
              className={clsx(
                'inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px]',
                a.error
                  ? 'border-red-500/30 bg-red-500/10 text-red-400'
                  : a.uploading
                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-500'
                    : 'border-theme/20 bg-theme-hover/40 text-theme-fg',
              )}
            >
              {a.uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : a.error ? <AlertCircle className="h-3 w-3" /> : <FileLucide className="h-3 w-3" />}
              <span className="max-w-[180px] truncate" title={a.path}>{a.name}</span>
              <button
                type="button"
                onClick={() => removePendingAttachment(a.id)}
                className="text-current/60 hover:text-current"
                title="Remove"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <textarea
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask, run, or build anything..."
        rows={1}
        disabled={chatLoading}
        className="min-h-[38px] max-h-[120px] w-full resize-none overflow-y-auto bg-transparent px-4 pb-1 pt-3 text-[13px] text-theme-fg outline-none placeholder:text-theme-muted/50 disabled:opacity-60"
        style={{ scrollbarWidth: 'none' }}
      />
      <input
        ref={attachmentInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleAttachmentFilesSelected}
      />
      <div className="flex items-center justify-between gap-2 px-3 pb-2.5">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleAttachClick}
            disabled={chatLoading || !isRunning}
            className="rounded-lg p-1 text-theme-muted transition-colors hover:bg-theme-hover/60 hover:text-theme-fg disabled:opacity-40"
            title="Attach files"
          >
            <Paperclip className="h-3.5 w-3.5" />
          </button>
          {modelSelector}
          {historyButton}
          <span className={clsx('ml-1 h-1.5 w-1.5 rounded-full', chatLoading ? 'animate-pulse bg-amber-500' : 'bg-green-500')} />
          {messages.length > 0 && (
            <button
              type="button"
              onClick={handleClear}
              className="ml-1 rounded-lg p-1 text-theme-muted transition-colors hover:bg-theme-hover/60 hover:text-theme-fg"
              title="Clear"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          {chatLoading && (
            <button
              type="button"
              onClick={handleStop}
              className="rounded-lg p-1.5 text-red-400 transition-colors hover:bg-red-500/10"
              title="Stop"
            >
              <Square className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => void sendMessage()}
            disabled={chatLoading || !input.trim() || isUploadingAny}
            className={clsx(
              'rounded-lg p-1.5 transition-colors',
              input.trim() && !chatLoading && !isUploadingAny ? 'bg-primary text-primary-fg hover:opacity-90' : 'text-theme-muted/30',
            )}
            title={isUploadingAny ? 'Uploading attachments…' : 'Send (Enter)'}
          >
            {chatLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  const renderTree = (entries: FileEntry[], depth = 0): React.ReactNode => {
    return [...entries]
      .sort((a, b) => {
        if (a.type === 'directory' && b.type !== 'directory') return -1;
        if (a.type !== 'directory' && b.type === 'directory') return 1;
        return a.name.localeCompare(b.name);
      })
      .map((entry) => {
        const isDir = entry.type === 'directory';
        const isExpanded = expandedDirs.has(entry.path);
        const children = dirContents[entry.path];
        const isLoading = loadingDirs.has(entry.path);
        return (
          <div key={entry.path} className="group/entry">
            <div
              className="ide-tree-item group relative flex items-center"
              style={{ paddingLeft: `${8 + depth * 16}px` }}
            >
              <button
                onClick={() => {
                  if (isDir) toggleDir(entry.path);
                  else addExistingFileAttachment({ name: entry.name, path: entry.path, size: entry.size });
                }}
                className="flex flex-1 items-center gap-1 min-w-0 bg-transparent border-none p-0 text-left cursor-pointer"
                title={isDir ? 'Expand/collapse' : 'Attach file to chat'}
              >
                {isDir ? (
                  <svg className={`ide-tree-chevron ${isExpanded ? 'ide-tree-chevron-open' : ''}`} viewBox="0 0 24 24" fill="currentColor">
                    <path d="M9 6l6 6-6 6z" />
                  </svg>
                ) : (
                  <span className="ide-tree-spacer" />
                )}
                {isDir ? <FolderIcon /> : <FileIcon name={entry.name} />}
                <span className="truncate">{entry.name}</span>
              </button>
              <div className="ml-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity pr-1.5">
                {isDir && (
                  <>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); triggerUploadInto(entry.path); }}
                      className="rounded p-0.5 text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60"
                      title="Upload files here"
                    >
                      <Upload className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); void handleCreateDir(entry.path); }}
                      className="rounded p-0.5 text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60"
                      title="New folder"
                    >
                      <FolderPlus className="h-3 w-3" />
                    </button>
                  </>
                )}
                {!isDir && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); addExistingFileAttachment({ name: entry.name, path: entry.path, size: entry.size }); }}
                    className="rounded p-0.5 text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60"
                    title="Attach to chat"
                  >
                    <Paperclip className="h-3 w-3" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); void handleDeleteEntry(entry); }}
                  className="rounded p-0.5 text-red-400 hover:text-red-500 hover:bg-red-500/10"
                  title="Delete"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
            {isDir && isExpanded && (
              isLoading
                ? <div className="ide-tree-loading" style={{ paddingLeft: `${24 + depth * 16}px` }}>Loading...</div>
                : children ? renderTree(children, depth + 1) : null
            )}
          </div>
        );
      });
  };

  // ── Active view content ────────────────────────────────────────────────────

  const chatView = (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="custom-scrollbar flex-1 min-h-0 overflow-y-auto">
        {messages.length === 0 && !chatLoading && !streamText && streamChunks.length === 0 ? (
          <div className="flex min-h-full items-end justify-center px-6 pb-8">
            <div className="w-full max-w-[680px]">
              <div className="mb-8 text-center">
                <div className="text-[10px] font-medium uppercase tracking-[0.22em] text-theme-muted">Cloud Agent</div>
                <h2 className="mx-auto mt-4 max-w-[580px] text-2xl font-semibold tracking-tight text-theme-fg">
                  {greeting}, {firstName}
                </h2>
                <p className="mx-auto mt-2 max-w-[480px] text-[13px] leading-6 text-theme-muted">
                  Inspect files, run commands, deploy services, or ask anything.
                </p>
              </div>

              <div className="mx-auto max-w-[640px]">
                {composer}
              </div>

              <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                {QUICK_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => applyPrompt(prompt)}
                    className="rounded-lg px-2.5 py-1.5 text-[11px] text-theme-muted transition-colors hover:bg-theme-hover hover:text-theme-fg"
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
                <PortableMessageBubble
                  key={msg.id}
                  message={msg}
                  interactiveToolRenderer={interactiveToolRenderer}
                />
              ))}

              {chatLoading && (
                <PortableMessageBubble
                  message={{
                    id: 'streaming',
                    role: 'assistant',
                    text: streamText,
                    reasoning: streamReasoning || undefined,
                    toolCalls: streamTools.length > 0 ? streamTools : undefined,
                    streamChunks: streamChunks.length > 0 ? streamChunks : undefined,
                  }}
                  isStreaming
                  startedAt={streamStartRef.current}
                  interactiveToolRenderer={interactiveToolRenderer}
                />
              )}

              {/* Fallback: any pending ask_user prompts not anchored to a live
                  message bubble (e.g. arrived after stream ended) */}
              {askUserPrompts
                .filter((p) => p.status === 'pending')
                .filter((p) => {
                  const referenced =
                    streamTools.some((t) => t.id === p.id)
                    || messages.some((m) => m.toolCalls?.some((t) => t.id === p.id));
                  return !referenced;
                })
                .map((p) => (
                  <AskUserPrompt
                    key={p.id}
                    prompt={{ id: p.id, args: p.args }}
                    onRespond={handleAskUserRespond}
                  />
                ))}
            </div>
          </div>
        )}
      </div>

      {(messages.length > 0 || chatLoading) && (
        <div className="border-t border-theme bg-theme-card px-6 pb-4 pt-3">
          <div className="mx-auto max-w-[820px]">
            {composer}
          </div>
        </div>
      )}
    </div>
  );

  const overviewView = (
    <div className="custom-scrollbar h-full overflow-y-auto px-6 py-6">
      <div className="mx-auto max-w-4xl space-y-5">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-theme-fg">Engine overview</h2>
          <p className="mt-1 text-sm text-theme-muted">Live status, machine specs, and connectivity.</p>
        </div>

        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-12 md:col-span-5 rounded-2xl border border-theme bg-theme-card p-5">
            <h3 className="mb-4 text-[10px] font-semibold uppercase tracking-[0.12em] text-theme-muted">Machine</h3>
            <dl className="space-y-3 text-[13px]">
              <OverviewRow icon={Server} label="Name" value={engine?.instance_name || '—'} mono />
              <OverviewRow icon={Globe} label="Region" value={engine?.zone || '—'} />
              <OverviewRow icon={Cpu} label="Plan" value={planLabel} />
              <OverviewRow icon={Cpu} label="Machine" value={machineLabel} />
              <OverviewRow icon={Server} label="Storage" value={engine?.disk_size_gb ? `${engine.disk_size_gb} GB` : '—'} />
              {engine?.external_ip && <OverviewRow icon={Globe} label="Address" value={engine.external_ip} mono />}
              {engine?.created_at && <OverviewRow icon={Clock} label="Created" value={new Date(engine.created_at).toLocaleDateString()} />}
            </dl>
          </div>

          <div className="col-span-12 md:col-span-7 rounded-2xl border border-theme bg-theme-card p-5">
            <h3 className="mb-4 text-[10px] font-semibold uppercase tracking-[0.12em] text-theme-muted">Status</h3>
            <div className="grid grid-cols-2 gap-3">
              <StatusPillSmall
                label="AI Agent"
                connected={engine?.health_status === 'healthy'}
                detail={engine?.health_status === 'healthy' ? 'Connected and ready' : 'Not connected'}
              />
              <StatusPillSmall
                label="Heartbeat"
                connected={!!engine?.last_heartbeat_at}
                detail={engine?.last_heartbeat_at ? `Last: ${new Date(engine.last_heartbeat_at).toLocaleTimeString()}` : 'Waiting...'}
              />
              <StatusPillSmall
                label="Network"
                connected={!!engine?.external_ip}
                detail={engine?.external_ip || 'Assigning...'}
              />
              <StatusPillSmall
                label="Engine"
                connected={engine?.status === 'running'}
                detail={engine?.status || 'unknown'}
              />
            </div>
            <div className="mt-5 rounded-xl bg-theme-hover/40 p-3 text-[11px] text-theme-muted">
              Manage your engine from the top bar. Use the activity bar on the left to switch between chat,
              files, monitoring, and more. Some panels (deployments, integrations, permissions) are managed
              from the Stuard desktop app.
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const monitoringView = <CloudMonitoring engine={engine} />;
  const billingView = <CloudBilling />;
  const botsView = (
    <DesktopOnlyView
      icon={BotIcon}
      title="Bots"
      description="Configure background agents that run on your cloud VM 24/7. Bots are configured from the Stuard desktop app."
    />
  );
  const automationsView = (
    <DesktopOnlyView
      icon={Zap}
      title="Automations on VM"
      description="Workflows, scripts, and projects deployed to this cloud VM. Push new automations from the Stuard desktop app — they'll run here independently of your laptop."
    />
  );
  const integrationsView = (
    <DesktopOnlyView
      icon={Link2}
      title="VM Integrations"
      description="Connect this cloud VM to GitHub, Notion, Slack, Google, and more. Manage integrations from the Stuard desktop app."
    />
  );
  const deploysView = (
    <DesktopOnlyView
      icon={Rocket}
      title="Deployments"
      description="Push and manage workflow / project deployments running on this cloud VM. Deploy and monitor from the Stuard desktop app."
    />
  );
  const permissionsView = (
    <DesktopOnlyView
      icon={Shield}
      title="VM Permissions"
      description="Control what tools and resources the cloud agent can access. Permissions are configured from the Stuard desktop app."
    />
  );

  const viewMap: Record<ActivityView, React.ReactNode> = {
    chat: chatView,
    overview: overviewView,
    monitoring: <div className="custom-scrollbar h-full overflow-y-auto px-6 py-6">{monitoringView}</div>,
    billing: <div className="custom-scrollbar h-full overflow-y-auto px-6 py-6">{billingView}</div>,
    deploys: deploysView,
    integrations: integrationsView,
    permissions: permissionsView,
    bots: botsView,
    automations: automationsView,
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const explorerPanel = (
    <>
      <div className="ide-file-panel-header">
        <span className="ide-panel-title">Workspace</span>
        <div className="flex items-center gap-1">
          <button onClick={() => triggerUploadInto('.')} className="ide-panel-action" title="Upload files to workspace">
            <Upload className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => void handleCreateDir('.')} className="ide-panel-action" title="New folder">
            <FolderPlus className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => void loadDir('.')} className="ide-panel-action" title="Refresh files">
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {(fileActionError || uploadingFileName) && (
        <div className="px-3 py-1.5 text-[10px] border-b border-theme/10 space-y-0.5">
          {uploadingFileName && (
            <div className="flex items-center gap-1.5 text-theme-muted">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span className="truncate">Uploading {uploadingFileName}…</span>
            </div>
          )}
          {fileActionError && (
            <div className="flex items-start gap-1.5 text-red-400">
              <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
              <span className="truncate">{fileActionError}</span>
              <button className="ml-auto text-theme-muted hover:text-theme-fg" onClick={() => setFileActionError(null)}>
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>
      )}
      <div className="ide-file-tree">
        {dirContents['.'] ? renderTree(dirContents['.']) : (
          <div className="ide-tree-loading" style={{ paddingLeft: '16px' }}>Loading files...</div>
        )}
      </div>
    </>
  );

  return (
    <div className="cloud-ide">
      {/* Activity Bar */}
      <aside className="ide-activity-bar">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive =
            item.toggle === 'explorer'
              ? filePanelOpen
              : item.toggle === 'terminal'
                ? terminalOpen
                : activeView === (item.id as ActivityView);
          return (
            <button
              key={item.id}
              type="button"
              title={item.label}
              onClick={() => {
                if (item.toggle === 'explorer') { setFilePanelOpen((v) => !v); return; }
                if (item.toggle === 'terminal') { setTerminalOpen((v) => !v); return; }
                setActiveView(item.id as ActivityView);
              }}
              className={clsx('ide-activity-btn', isActive && 'ide-activity-btn-active')}
            >
              <Icon className="h-4 w-4" />
            </button>
          );
        })}
        <div className="flex-1" />
        <div title={`Engine: ${engine?.status || 'unknown'}`} className="flex h-8 w-8 items-center justify-center">
          <span className="h-2 w-2 rounded-full bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.4)]" />
        </div>
      </aside>

      {/* Explorer (developer mode only — Normal mode renders Files in main pane) */}
      {mode === 'developer' && filePanelOpen && (
        <aside className="ide-file-panel">
          {explorerPanel}
          <input
            ref={fileUploadInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileUploadSelected}
          />
        </aside>
      )}

      {/* Main content */}
      <section className="ide-main flex-1 min-w-0">
        {/* Top bar */}
        <header className="ide-topbar">
          <div className="ide-topbar-title min-w-0">
            <span className="truncate text-theme-muted">{engine?.instance_name || 'Cloud Engine'}</span>
            <span className="text-theme-muted/40">/</span>
            <strong className="truncate">{activeLabel}</strong>
            {mode === 'developer' && (
              <>
                <span className="hidden text-theme-muted/40 sm:inline">·</span>
                <span className="hidden truncate text-theme-muted sm:inline">{planLabel} · {machineLabel}</span>
              </>
            )}
          </div>
          <div className="ide-topbar-actions">
            {/* Mode toggle pill */}
            <div className="mr-2 inline-flex items-center rounded-full bg-theme-hover/40 p-0.5 text-[10px] font-bold">
              <button
                type="button"
                onClick={() => setMode('normal')}
                className={clsx(
                  'px-2.5 py-1 rounded-full transition-colors',
                  mode === 'normal'
                    ? 'bg-theme-card text-theme-fg shadow-sm'
                    : 'text-theme-muted hover:text-theme-fg',
                )}
              >
                Normal
              </button>
              <button
                type="button"
                onClick={() => setMode('developer')}
                className={clsx(
                  'px-2.5 py-1 rounded-full transition-colors',
                  mode === 'developer'
                    ? 'bg-theme-card text-theme-fg shadow-sm'
                    : 'text-theme-muted hover:text-theme-fg',
                )}
              >
                Developer
              </button>
            </div>

            {mode === 'developer' && (
              <div className="ide-topbar-pill">
                <span className="dot" />
                {engine?.status === 'running' ? 'Running' : (engine?.status || 'Unknown')}
              </div>
            )}

            <button
              type="button"
              className="ide-topbar-btn"
              onClick={onRefresh}
              title="Refresh status"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className="ide-topbar-btn"
              onClick={() => void handlePause()}
              disabled={pauseLoading}
              title={mode === 'normal' ? 'Pause your cloud' : 'Pause engine'}
            >
              {pauseLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PowerOff className="h-3.5 w-3.5" />}
            </button>
            {mode === 'developer' && (
              <button
                type="button"
                className="ide-topbar-btn ide-topbar-btn-danger"
                onClick={() => void handleDelete()}
                disabled={deleteLoading}
                title="Delete engine"
              >
                {deleteLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </button>
            )}
          </div>
        </header>

        {/* Active view */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {(activeView as string) === 'files' ? (
            <div className="flex h-full flex-col bg-theme-card">
              {explorerPanel}
              <input
                ref={fileUploadInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFileUploadSelected}
              />
            </div>
          ) : (
            viewMap[activeView]
          )}
        </div>

        {/* Terminal dock — developer mode only */}
        {mode === 'developer' && terminalOpen && (
          <div className="ide-terminal-panel" style={{ height: terminalHeight }}>
            <div
              className="h-[3px] cursor-ns-resize bg-transparent transition-colors hover:bg-primary/30"
              onMouseDown={handleTerminalResize}
            />
            <div className="ide-terminal-header">
              <div className="ide-terminal-header-left">
                <Terminal className="h-3 w-3 text-theme-muted" />
                <span className="ide-panel-title">Terminal</span>
                <span className={`ide-status-dot ${connected ? 'ide-status-dot-green' : ''}`} />
              </div>
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  className="ide-panel-action"
                  onClick={() => setTerminalHeight((h) => h === MIN_TERMINAL_H ? DEFAULT_TERMINAL_H : MIN_TERMINAL_H)}
                  title={terminalHeight === MIN_TERMINAL_H ? 'Expand' : 'Minimize'}
                >
                  {terminalHeight === MIN_TERMINAL_H ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </button>
                <button onClick={() => setTerminalOpen(false)} className="ide-panel-action" title="Close terminal">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <div ref={termContainerRef} className="ide-terminal-body" />
          </div>
        )}
      </section>
    </div>
  );
}

function OverviewRow({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon: any;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-theme-muted">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="text-[12px]">{label}</span>
      </div>
      <span
        className={clsx(
          'truncate text-right text-theme-fg',
          mono ? 'font-mono text-[12px]' : 'text-[12px] font-medium',
        )}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

function StatusPillSmall({
  label,
  connected,
  detail,
}: {
  label: string;
  connected: boolean;
  detail?: string;
}) {
  return (
    <div className="rounded-xl border border-theme bg-theme-hover/30 p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-theme-muted">
        <span
          className={clsx(
            'h-1.5 w-1.5 rounded-full',
            connected ? 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.4)]' : 'bg-theme-muted/40',
          )}
        />
        {label}
      </div>
      <div className="mt-1 truncate text-[12px] font-medium text-theme-fg" title={detail}>
        {detail || (connected ? 'Connected' : 'Disconnected')}
      </div>
    </div>
  );
}

function DesktopOnlyView({
  icon: Icon,
  title,
  description,
}: {
  icon: any;
  title: string;
  description: string;
}) {
  return (
    <div className="flex h-full items-center justify-center px-6 py-10">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <h2 className="mt-4 text-lg font-semibold text-theme-fg">{title}</h2>
        <p className="mt-2 text-[13px] leading-6 text-theme-muted">{description}</p>
        <a
          href="/download"
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-theme-fg px-4 py-2 text-[12px] font-semibold text-theme-bg transition hover:opacity-90"
          style={{ background: 'var(--ide-text)', color: 'var(--ide-bg)' }}
        >
          Open in Stuard Desktop
        </a>
      </div>
    </div>
  );
}

function FolderIcon() {
  return (
    <svg className="ide-tree-icon ide-tree-icon-folder" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2z" />
    </svg>
  );
}

function FileIcon({ name }: { name: string }) {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const colorMap: Record<string, string> = {
    ts: '#3178c6', tsx: '#3178c6', js: '#f7df1e', jsx: '#f7df1e', py: '#3776ab',
    json: '#a8b1c2', md: '#519aba', css: '#264de4', html: '#e34c26',
    yml: '#cb171e', yaml: '#cb171e', sh: '#89e051', bash: '#89e051',
  };
  return (
    <svg className="ide-tree-icon" viewBox="0 0 24 24" fill="none" stroke={colorMap[ext] || 'var(--ide-text-dim)'} strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  );
}
