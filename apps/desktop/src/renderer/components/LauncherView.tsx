import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  Clipboard,
  Layout,
  LayoutGrid,
  Home,
  Clock,
  Maximize2,
  Mic,
  Power,
  Plus,
  Video,
  X,
  Calendar,
  Bell,
  CheckSquare,
  ChevronRight,
  FolderPlus,
  Folder,
  File as FileIcon,
  Search,
  RefreshCw,
  Loader2,
  Copy,
  ExternalLink,
  Wand2,
  Image as ImageIcon,
  Music,
  Code as CodeIcon,
  Archive,
  AppWindow,
  Film,
  FileText,
  Sparkles,
  Zap,
  ArrowRight,
  MessageCircle,
  Settings,
  Grid3X3,
  Send,
  FolderSearch,
  MessageSquare
} from 'lucide-react';
import type { UsePlannerDataResult, NextUpItem, PlannerTask } from '../hooks/usePlannerData';
import { CommandItem } from './CommandPalette';
import { clsx } from 'clsx';
import type { ChatMode, ChatModelsConfig } from '../hooks/usePreferences';
import { ModelSelector } from './ModelSelector';
import { useModelRegistry } from '../hooks/useModelRegistry';

interface LauncherViewProps {
  query: string;
  setQuery: (q: string) => void;
  onSend: () => void;
  commands: CommandItem[];
  statusText?: string;
  connectionStatus?: 'connected' | 'connecting' | 'disconnected' | 'error';
  onMicClick?: () => void;
  isRecording?: boolean;
  accessToken?: string | null;

  // History Props
  conversations: any[];
  loadingConversations: boolean;
  onSelectConversation: (id: string) => void;
  chatMenuOpen: boolean;
  onChatMenuOpenChange: (open: boolean) => void;
  onNewChat: () => void;
  onOpenDashboard: () => void;
  onToggleExpand: () => void;

  // Sidebar
  onToggleSidebar?: () => void;
  sidebarOpen?: boolean;

  // Planner Props
  plannerData?: UsePlannerDataResult;

  // Translucent mode
  translucentMode?: boolean;

  chatMode?: ChatMode;
  onChatModeChange?: (mode: ChatMode) => void;
  chatModels?: ChatModelsConfig;
  onChatModelsChange?: (cfg: ChatModelsConfig) => void;
}

// Helper to get icon for next up item
const NextUpIcon: React.FC<{ type: NextUpItem['icon'] }> = ({ type }) => {
  switch (type) {
    case 'calendar': return <Calendar className="w-3.5 h-3.5 text-white" />;
    case 'bell': return <Bell className="w-3.5 h-3.5 text-white" />;
    case 'task': return <CheckSquare className="w-3.5 h-3.5 text-white" />;
    default: return <Video className="w-3.5 h-3.5 text-white" />;
  }
};

// Helper to get background color for next up item based on urgency
const getNextUpBgColor = (item: NextUpItem) => {
  // Urgency takes precedence
  if (item.urgency === 'now') return 'bg-red-500 animate-pulse';
  if (item.urgency === 'soon') return 'bg-amber-500';

  // Default by type
  switch (item.icon) {
    case 'calendar': return 'bg-blue-500';
    case 'bell': return 'bg-amber-500';
    case 'task': return 'bg-emerald-500';
    default: return 'bg-blue-500';
  }
};

// Helper to get text color based on urgency
const getNextUpTextColor = (item: NextUpItem) => {
  if (item.urgency === 'now') return 'text-red-600';
  if (item.urgency === 'soon') return 'text-amber-700 dark:text-amber-500';
  return 'text-theme-fg';
};

// Quick action card data
const quickActions = [
  { id: 'chat', label: 'Chat', icon: MessageCircle, color: 'from-violet-500 to-purple-600', bgLight: 'bg-primary/10', textColor: 'text-primary', description: 'Start a conversation' },
  { id: 'workflows', label: 'Workflows', icon: Zap, color: 'from-amber-500 to-orange-600', bgLight: 'bg-amber-500/10', textColor: 'text-amber-500', description: 'Automate tasks' },
  { id: 'files', label: 'Files', icon: FolderSearch, color: 'from-emerald-500 to-teal-600', bgLight: 'bg-emerald-500/10', textColor: 'text-emerald-500', description: 'Search your files' },
  { id: 'spaces', label: 'Spaces', icon: Grid3X3, color: 'from-blue-500 to-cyan-600', bgLight: 'bg-blue-500/10', textColor: 'text-blue-500', description: 'Organize projects' },
];

export const LauncherView: React.FC<LauncherViewProps> = ({
  query,
  setQuery,
  onSend,
  commands,
  statusText,
  connectionStatus = 'connected',
  onMicClick,
  isRecording,
  accessToken,
  conversations,
  loadingConversations,
  onSelectConversation,
  chatMenuOpen,
  onChatMenuOpenChange,
  onNewChat,
  onOpenDashboard,
  onToggleExpand,
  onToggleSidebar,
  sidebarOpen,
  plannerData,
  translucentMode = false,
  chatMode = 'auto',
  onChatModeChange,
  chatModels,
  onChatModelsChange
}) => {
  const { modelById } = useModelRegistry();
  const CLOUD_AI_HTTP = (window as any).__CLOUD_AI_HTTP__ || (import.meta as any).env?.VITE_CLOUD_AI_URL || "http://127.0.0.1:8082";

  const selectedModelId: string | 'auto' = (typeof chatMode === 'string' && chatMode.trim()) ? (chatMode.trim() as any) : 'auto';
  const selectedModelLabel = (() => {
    if (selectedModelId === 'auto') return 'Auto';
    const m = modelById.get(selectedModelId);
    return m ? m.name : selectedModelId;
  })();
  const filteredCommands = commands.filter(c =>
    c.title.toLowerCase().includes(query.toLowerCase()) ||
    (c.group && c.group.toLowerCase().includes(query.toLowerCase()))
  ).slice(0, 8);

  const nextUp = plannerData?.nextUp;
  const tasksCount = plannerData?.tasksCount ?? 0;
  const tasks = plannerData?.tasks ?? [];

  const showConnSpinner = connectionStatus === 'connecting';

  // File search / indexing state
  const [fileResults, setFileResults] = useState<any[]>([]);
  const [fileSearchMode, setFileSearchMode] = useState<'quick' | 'hybrid'>('quick');
  const [fileLoading, setFileLoading] = useState(false);
  const [fileSemanticLoading, setFileSemanticLoading] = useState(false);
  const [fileError, setFileError] = useState('');
  const [indexStats, setIndexStats] = useState<any>(null);
  const [roots, setRoots] = useState<any[]>([]);
  const [selectedRootId, setSelectedRootId] = useState<string>('');
  const [processingPending, setProcessingPending] = useState(false);
  const [processedPendingCount, setProcessedPendingCount] = useState(0);

  const searchReqIdRef = useRef(0);
  const semanticReqIdRef = useRef(0);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const semanticDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshIndexMeta = useCallback(async () => {
    try {
      if (!(window as any).desktopAPI?.execTool) return;
      const [r, s] = await Promise.all([
        (window as any).desktopAPI.execTool('file_index_list_roots', { enabled_only: true }),
        (window as any).desktopAPI.execTool('file_index_stats', {}),
      ]);
      if (r?.ok && Array.isArray(r.roots)) setRoots(r.roots);
      if (s?.ok) setIndexStats(s);
    } catch { }
  }, []);

  useEffect(() => {
    refreshIndexMeta();
  }, [refreshIndexMeta]);

  const doQuickFileSearch = useCallback(async (q: string, rootId?: string) => {
    if (!(window as any).desktopAPI?.execTool) return;
    const reqId = ++searchReqIdRef.current;
    setFileLoading(true);
    setFileError('');
    try {
      const res = await (window as any).desktopAPI.execTool('file_search', {
        query: q,
        mode: 'quick',
        limit: 6,
        root_id: rootId || undefined,
      });

      if (searchReqIdRef.current !== reqId) return;
      if (res?.ok) {
        setFileResults(Array.isArray(res.results) ? res.results : []);
        setFileSearchMode('quick');
      } else {
        setFileResults([]);
        setFileError(String(res?.error || 'file_search_failed'));
      }
    } catch (e: any) {
      if (searchReqIdRef.current !== reqId) return;
      setFileResults([]);
      setFileError(String(e?.message || 'file_search_failed'));
    } finally {
      if (searchReqIdRef.current === reqId) setFileLoading(false);
    }
  }, []);

  const doSemanticRefine = useCallback(async (q: string, rootId?: string) => {
    const token = typeof accessToken === 'string' ? accessToken : '';
    const indexed = Number(indexStats?.indexed_files || 0);
    if (!token || indexed <= 0) return;
    if (!(window as any).desktopAPI?.execTool) return;

    const reqId = ++semanticReqIdRef.current;
    setFileSemanticLoading(true);
    try {
      const resp = await fetch(`${String(CLOUD_AI_HTTP).replace(/\/$/, '')}/inference/ai/embed`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ text: q, model: 'text-embedding-3-large' }),
      });
      const j = await resp.json().catch(() => ({}));
      if (semanticReqIdRef.current !== reqId) return;
      if (!resp.ok || !j?.ok || !Array.isArray(j.embedding)) return;

      const res = await (window as any).desktopAPI.execTool('file_search', {
        query: q,
        vector: j.embedding,
        mode: 'hybrid',
        limit: 6,
        root_id: rootId || undefined,
      });

      if (semanticReqIdRef.current !== reqId) return;
      if (res?.ok) {
        setFileResults(Array.isArray(res.results) ? res.results : []);
        setFileSearchMode('hybrid');
      }
    } catch {
      // ignore
    } finally {
      if (semanticReqIdRef.current === reqId) setFileSemanticLoading(false);
    }
  }, [CLOUD_AI_HTTP, accessToken, indexStats?.indexed_files]);

  useEffect(() => {
    const q = String(query || '').trim();
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = null;
    }
    if (semanticDebounceRef.current) {
      clearTimeout(semanticDebounceRef.current);
      semanticDebounceRef.current = null;
    }

    if (q.length < 2) {
      setFileResults([]);
      setFileError('');
      setFileLoading(false);
      setFileSemanticLoading(false);
      return;
    }

    // Quick search (instant-ish)
    searchDebounceRef.current = setTimeout(() => {
      doQuickFileSearch(q, selectedRootId || undefined);
    }, 150);

    // Semantic refine (slower, only if embeddings exist)
    semanticDebounceRef.current = setTimeout(() => {
      doSemanticRefine(q, selectedRootId || undefined);
    }, 650);

    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      if (semanticDebounceRef.current) clearTimeout(semanticDebounceRef.current);
    };
  }, [query, selectedRootId, doQuickFileSearch, doSemanticRefine]);

  const handleOpenIndexedFile = useCallback(async (path: string) => {
    try {
      if (!(window as any).desktopAPI?.execTool) return;
      await (window as any).desktopAPI.execTool('open_file', { path });
    } catch { }
  }, []);

  const handleRevealIndexedFile = useCallback(async (path: string) => {
    try {
      await window.desktopAPI?.showItemInFolder?.(path);
    } catch { }
  }, []);

  const handleCopyPath = useCallback(async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
    } catch { }
  }, []);

  const handleQuickAction = useCallback((actionId: string) => {
    switch (actionId) {
      case 'workflows':
        (window as any).desktopAPI?.openWorkflows?.();
        break;
      case 'spaces':
        onToggleSidebar?.();
        break;
      case 'files':
        setQuery('@');
        break;
      case 'chat':
      default:
        // Focus the input
        break;
    }
  }, [onToggleSidebar, setQuery]);

  // Build status text from next up item
  const displayStatus = nextUp
    ? `${nextUp.title} ${nextUp.timeLabel}`
    : (statusText || 'Ready');

  const hasQuery = String(query || '').trim().length >= 2;
  const showResults = hasQuery && (filteredCommands.length > 0 || fileResults.length > 0);

  const getFileKindConfig = (k: string) => {
    switch (k) {
      case 'application': return { icon: AppWindow, color: 'text-blue-500', bg: 'bg-blue-500/10', label: 'APP' };
      case 'folder': return { icon: Folder, color: 'text-yellow-500', bg: 'bg-yellow-500/10', label: 'FOLDER' };
      case 'image': return { icon: ImageIcon, color: 'text-purple-500', bg: 'bg-purple-500/10', label: 'IMG' };
      case 'video': return { icon: Film, color: 'text-red-500', bg: 'bg-red-500/10', label: 'VID' };
      case 'audio': return { icon: Music, color: 'text-pink-500', bg: 'bg-pink-500/10', label: 'AUDIO' };
      case 'code': return { icon: CodeIcon, color: 'text-emerald-500', bg: 'bg-emerald-500/10', label: 'CODE' };
      case 'archive': return { icon: Archive, color: 'text-orange-500', bg: 'bg-orange-500/10', label: 'ZIP' };
      case 'document': return { icon: FileText, color: 'text-sky-500', bg: 'bg-sky-500/10', label: 'DOC' };
      default: return { icon: FileIcon, color: 'text-theme-muted', bg: 'bg-theme-muted/10', label: 'FILE' };
    }
  };

  return (
    <div
      className={clsx(
        "flex flex-col h-full overflow-hidden transition-all duration-300 rounded-3xl shadow-2xl",
        translucentMode
          ? "bg-theme-bg/25 backdrop-blur-2xl border border-theme/20"
          : "bg-theme-card border border-theme/50"
      )}
    >
      {/* Top Bar */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-theme/10">
        {/* Status */}
        <button
          type="button"
          onClick={() => nextUp && window.desktopAPI?.openDashboard?.({ tab: 'planner' })}
          className={clsx(
            "flex items-center gap-3 min-w-0",
            nextUp && "cursor-pointer hover:opacity-80 transition-opacity"
          )}
          title={nextUp ? 'View in Planner' : undefined}
        >
          <div className={clsx(
            "w-6 h-6 rounded-full flex items-center justify-center transition-all",
            nextUp ? getNextUpBgColor(nextUp) : (
              connectionStatus === 'connected' ? 'bg-primary' :
                connectionStatus === 'connecting' ? 'bg-amber-500 animate-pulse' :
                  connectionStatus === 'error' ? 'bg-red-500' :
                    'bg-theme-muted/50'
            )
          )}>
            {nextUp ? <NextUpIcon type={nextUp.icon} /> : (
              showConnSpinner ? <div className="w-3.5 h-3.5 border-2 border-white/90 border-t-transparent rounded-full animate-spin" /> :
                <Video className="w-3.5 h-3.5 text-white" />
            )}
          </div>
          <span className={clsx(
            "font-bold text-sm truncate transition-colors",
            nextUp ? getNextUpTextColor(nextUp) : (
              connectionStatus === 'connected' ? 'text-theme-fg' :
                connectionStatus === 'connecting' ? 'text-amber-700 dark:text-amber-500' :
                  connectionStatus === 'error' ? 'text-red-600' :
                    'text-theme-muted'
            )
          )}>
            {displayStatus}
          </span>
        </button>

        {/* Right Actions */}
        <div className="flex items-center gap-2">
          {onToggleSidebar && (
            <button
              onClick={onToggleSidebar}
              className={clsx(
                "p-2 rounded-xl hover:scale-105 transition-transform border border-theme/10",
                sidebarOpen ? "bg-primary/10 text-primary" : "bg-theme-card text-theme-muted hover:text-theme-fg hover:bg-theme-hover"
              )}
              title="Spaces"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
          )}

          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                className="p-2 bg-theme-card border border-theme/10 rounded-xl hover:scale-105 transition-transform text-theme-muted hover:text-theme-fg hover:bg-theme-hover"
                title="Layout"
              >
                <Layout className="w-4 h-4" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="DropdownContent z-[10002] w-48 bg-theme-card rounded-xl border border-theme p-1 shadow-2xl backdrop-blur-xl" sideOffset={10} align="end" collisionPadding={10}>
                <DropdownMenu.Item
                  onSelect={() => window.desktopAPI.setMode('compact')}
                  className="text-[13px] text-theme-fg flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-theme-hover outline-none cursor-pointer transition-colors"
                >
                  <div className="w-4 h-4 border-2 border-current rounded opacity-50" />
                  <span>Compact</span>
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onSelect={() => window.desktopAPI.setMode('sidebar')}
                  className="text-[13px] text-theme-fg flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-theme-hover outline-none cursor-pointer transition-colors"
                >
                  <div className="w-2 h-4 border-2 border-current rounded opacity-50" />
                  <span>Sidebar</span>
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onSelect={() => window.desktopAPI.setMode('window')}
                  className="text-[13px] text-theme-fg flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-theme-hover outline-none cursor-pointer transition-colors"
                >
                  <div className="w-6 h-4 border-2 border-current rounded opacity-50" />
                  <span>Window</span>
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>

          <button
            onClick={() => (window as any).desktopAPI?.openWorkflows?.()}
            className="p-2 bg-theme-card border border-theme/10 rounded-xl hover:scale-105 transition-transform text-theme-muted hover:text-theme-fg hover:bg-theme-hover"
            title="Workflows"
          >
            <Wand2 className="w-4 h-4" />
          </button>

          <button
            onClick={onOpenDashboard}
            className="p-2 bg-theme-card border border-theme/10 rounded-xl hover:scale-105 transition-transform text-theme-muted hover:text-theme-fg hover:bg-theme-hover"
            title="Dashboard"
          >
            <Home className="w-4 h-4" />
          </button>

          <DropdownMenu.Root open={chatMenuOpen} onOpenChange={onChatMenuOpenChange}>
            <DropdownMenu.Trigger asChild>
              <button
                className={clsx(
                  "p-2 rounded-xl border border-theme/10 transition-all hover:scale-105",
                  chatMenuOpen ? "bg-theme-active text-theme-fg" : "bg-theme-card text-theme-muted hover:text-theme-fg hover:bg-theme-hover"
                )}
                title="History"
              >
                <Clock className="w-4 h-4" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="DropdownContent z-[10002] w-72 bg-theme-card rounded-xl border border-theme p-2 shadow-2xl backdrop-blur-xl" sideOffset={8} align="end" collisionPadding={10}>
                <DropdownMenu.Item
                  onSelect={onNewChat}
                  className="text-[13px] text-primary font-bold flex items-center gap-2 px-3 py-2.5 rounded-lg hover:bg-theme-hover outline-none cursor-pointer transition-colors mb-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>New chat</span>
                </DropdownMenu.Item>

                <div className="h-px bg-theme opacity-50 my-1" />

                <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
                  {loadingConversations ? (
                    <div className="px-3 py-2 text-[12px] text-theme-muted">Loading...</div>
                  ) : conversations.length === 0 ? (
                    <div className="px-3 py-2 text-[12px] text-theme-muted italic">No recent chats</div>
                  ) : (
                    conversations.map(c => (
                      <DropdownMenu.Item
                        key={c.id}
                        onSelect={() => onSelectConversation(String(c.id))}
                        className="text-[13px] text-theme-fg flex flex-col px-3 py-2.5 rounded-lg hover:bg-theme-hover outline-none cursor-pointer transition-colors border-l-2 border-transparent hover:border-primary/50"
                      >
                        <span className="truncate w-full font-bold">{c.title || 'Untitled Chat'}</span>
                        <span className="text-[10px] text-theme-muted font-bold mt-0.5">{c.created_at ? new Date(c.created_at).toLocaleDateString() : ''}</span>
                      </DropdownMenu.Item>
                    ))
                  )}
                </div>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-5 pb-5 overflow-hidden">
        {/* Hero Section */}
        <div className="w-full max-w-2xl flex flex-col h-full">
          {/* Greeting */}
          <div className="text-center py-6 shrink-0">
            <h1 className="text-2xl font-black text-theme-fg mb-2">
              What can I help with?
            </h1>
            <p className="text-theme-muted text-sm font-medium">
              Ask anything, search files, or run automations
            </p>
          </div>

          {/* Search Input */}
          <div className="relative group mb-5 shrink-0">
            <div className={clsx(
              "relative flex items-center gap-3 px-4 py-3 rounded-2xl transition-all duration-300",
              "bg-theme-hover/50 border border-theme",
              "group-focus-within:bg-theme-active/50 group-focus-within:border-primary/30 group-focus-within:ring-2 group-focus-within:ring-primary/10"
            )}>
              <Search className="w-5 h-5 text-theme-muted flex-shrink-0" />
              <TextareaAutosize
                className="flex-1 bg-transparent outline-none text-theme-fg placeholder:text-theme-muted resize-none py-0 overflow-y-auto font-bold text-[15px]"
                placeholder="Ask Stuard anything..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.nativeEvent as any)?.isComposing) return;
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    onSend();
                  }
                }}
                minRows={1}
                maxRows={4}
              />
              <div className="flex items-center gap-2 flex-shrink-0">
                <ModelSelector
                  selectedModelId={selectedModelId}
                  onSelectModel={(id) => {
                    try { onChatModeChange?.(id as any); } catch { }
                  }}
                  side="top"
                  align="end"
                />
                <button
                  onClick={onMicClick}
                  className={clsx(
                    "p-2.5 rounded-xl transition-all hover:scale-105 active:scale-95",
                    isRecording
                      ? "bg-red-500 text-white animate-pulse"
                      : "bg-theme-hover border border-theme/10 text-theme-muted hover:text-theme-fg"
                  )}
                >
                  <Mic className="w-4 h-4" />
                </button>
                <button
                  onClick={onSend}
                  disabled={!query.trim()}
                  className={clsx(
                    "p-2.5 rounded-xl transition-all hover:scale-105 active:scale-95",
                    query.trim()
                      ? "bg-primary text-primary-fg"
                      : "bg-theme-hover/50 text-theme-muted/50 cursor-not-allowed"
                  )}
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Quick Actions Grid - Only show when no results */}
          {!showResults && (
            <div className="grid grid-cols-4 gap-3 mb-5 shrink-0">
              {quickActions.map((action) => (
                <button
                  key={action.id}
                  onClick={() => handleQuickAction(action.id)}
                  className="group flex flex-col items-center gap-2.5 p-4 rounded-2xl bg-theme-hover/30 hover:bg-theme-hover border border-theme/10 hover:border-theme/30 transition-all duration-300 hover:-translate-y-0.5"
                >
                  <div className={clsx(
                    "w-10 h-10 rounded-xl flex items-center justify-center transition-all group-hover:scale-110",
                    action.bgLight, action.textColor
                  )}>
                    <action.icon className="w-5 h-5" />
                  </div>
                  <span className="text-xs font-bold text-theme-muted group-hover:text-theme-fg transition-colors">{action.label}</span>
                </button>
              ))}
            </div>
          )}

          {/* Results - Scrollable area */}
          {showResults && (
            <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-4 min-h-0">
              {/* Ask Stuard - Primary */}
              <button
                onClick={onSend}
                className="w-full flex items-center gap-4 px-4 py-3 rounded-2xl hover:bg-theme-hover transition-all group border border-transparent hover:border-theme/30 relative overflow-hidden bg-theme-hover/30"
              >
                <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 group-hover:scale-110 transition-all ring-1 ring-primary/20 group-hover:ring-primary/50 z-10">
                  <MessageSquare className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 text-left z-10">
                  <div className="text-[14px] font-black text-theme-fg group-hover:text-primary transition-colors">Ask Stuard</div>
                  <div className="text-[11px] text-theme-muted font-bold">Get an AI assistant response</div>
                </div>
                <div className="text-[10px] font-black text-theme-muted bg-theme-hover px-2.5 py-1.5 rounded-lg border border-theme/10 group-hover:bg-primary group-hover:text-primary-fg group-hover:border-primary transition-all z-10">Enter</div>
              </button>

              {/* File Results */}
              {fileResults.length > 0 && (
                <div className="bg-theme-hover/30 rounded-2xl border border-theme/10 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <FolderSearch className="w-4 h-4 text-emerald-500" />
                    <span className="text-[11px] font-black uppercase tracking-wider text-theme-muted">Files Found</span>
                    {(fileLoading || fileSemanticLoading) && (
                      <Loader2 className="w-3 h-3 text-primary animate-spin" />
                    )}
                    <span className="text-[10px] text-theme-muted font-bold ml-auto">{fileSearchMode === 'hybrid' ? 'Semantic' : 'Quick'}</span>
                  </div>
                  <div className="space-y-1">
                    {fileResults.map((f: any) => {
                      const kind = String(f.kind || 'other').toLowerCase();
                      const cfg = getFileKindConfig(kind);
                      const Icon = cfg.icon;
                      return (
                        <button
                          key={String(f.id || f.path)}
                          onClick={() => handleOpenIndexedFile(String(f.path || ''))}
                          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-theme-hover transition-all group/file text-left border border-transparent hover:border-theme/30"
                        >
                          <div className={clsx("w-9 h-9 rounded-lg flex items-center justify-center border border-theme/20", cfg.bg, cfg.color)}>
                            <Icon className="w-4 h-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-[13px] font-bold text-theme-fg truncate">{String(f.filename || '').trim() || String(f.path || '')}</div>
                            <div className="text-[10px] text-theme-muted truncate font-medium">{String(f.path || '')}</div>
                          </div>
                          <ExternalLink className="w-3.5 h-3.5 text-theme-muted opacity-0 group-hover/file:opacity-100 transition-opacity" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Command Results */}
              {filteredCommands.length > 0 && (
                <div className="bg-theme-hover/30 rounded-2xl border border-theme/10 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Zap className="w-4 h-4 text-amber-500" />
                    <span className="text-[11px] font-black uppercase tracking-wider text-theme-muted">Actions</span>
                  </div>
                  <div className="space-y-1">
                    {filteredCommands.map((cmd) => (
                      <button
                        key={cmd.id}
                        onClick={cmd.run}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-theme-hover transition-all group/cmd text-left border border-transparent hover:border-theme/30"
                      >
                        <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-theme-active/50 text-theme-muted group-hover/cmd:text-primary transition-colors border border-theme/10">
                          {cmd.icon || <Zap className="w-4 h-4" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-bold text-theme-fg">{cmd.title}</div>
                          {cmd.description && (
                            <div className="text-[10px] text-theme-muted font-medium">{cmd.description}</div>
                          )}
                        </div>
                        {cmd.shortcut && (
                          <div className="text-[10px] text-primary font-black bg-primary/10 px-2 py-1 rounded border border-primary/20">
                            {cmd.shortcut}
                          </div>
                        )}
                        <ArrowRight className="w-3.5 h-3.5 text-theme-muted opacity-0 group-hover/cmd:opacity-100 transition-opacity" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Tasks Bar */}
      <div className="shrink-0 flex items-center justify-between px-5 pb-4">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className="flex items-center gap-2 px-4 py-2 rounded-xl bg-theme-hover/30 hover:bg-theme-hover border border-theme/10 transition-all text-sm text-theme-muted hover:text-theme-fg">
              <CheckSquare className="w-4 h-4 text-primary" />
              <span className="font-bold">Tasks</span>
              {tasksCount > 0 && (
                <span className="bg-primary text-primary-fg text-[10px] px-1.5 py-0.5 rounded-full min-w-[18px] text-center font-black">{tasksCount}</span>
              )}
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="DropdownContent z-[10002] w-72 bg-theme-card rounded-xl border border-theme p-3 shadow-2xl backdrop-blur-xl"
              sideOffset={8}
              align="start"
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] font-black text-theme-muted uppercase tracking-wider">Active Tasks</span>
                <button
                  onClick={onOpenDashboard}
                  className="text-[11px] font-black text-primary hover:text-primary/80 uppercase tracking-wider flex items-center gap-1"
                >
                  View All <ChevronRight className="w-3 h-3" />
                </button>
              </div>
              <div className="max-h-[200px] overflow-y-auto custom-scrollbar space-y-1">
                {tasks.length === 0 ? (
                  <div className="px-2 py-4 text-[12px] text-theme-muted text-center italic bg-theme-hover/20 rounded-lg">No pending tasks</div>
                ) : (
                  tasks.slice(0, 5).map(task => (
                    <div
                      key={task.id}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-theme-hover transition-all group/task"
                    >
                      <div className={clsx(
                        "w-2.5 h-2.5 rounded-full flex-shrink-0",
                        task.priority === 'high' ? 'bg-red-500' :
                          task.priority === 'low' ? 'bg-theme-muted/30' : 'bg-primary'
                      )} />
                      <span className="text-[13px] text-theme-fg font-bold truncate flex-1 group-hover/task:text-primary transition-colors">{task.title}</span>
                      {task.due && (
                        <span className="text-[10px] text-theme-muted font-black uppercase flex-shrink-0 bg-theme-hover/50 px-1.5 py-0.5 rounded">
                          {new Date(task.due).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                        </span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>

        <button
          onClick={() => { try { (window as any).desktopAPI?.hide?.(); } catch { } }}
          className="p-2 rounded-xl bg-theme-hover/30 hover:bg-red-500/10 border border-theme/10 hover:border-red-500/20 text-theme-muted hover:text-red-500 transition-all"
          title="Hide Stuard"
        >
          <Power className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
