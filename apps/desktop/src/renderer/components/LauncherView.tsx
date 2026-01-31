import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  Clipboard,
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
  MessageSquare,
  ListTodo,
  PanelRight,
  PanelLeft
} from 'lucide-react';
import type { UsePlannerDataResult, NextUpItem, PlannerTask } from '../hooks/usePlannerData';
import { CommandItem } from './CommandPalette';
import { clsx } from 'clsx';
import type { ChatMode, ChatModelsConfig } from '../hooks/usePreferences';
import { ModelSelector } from './ModelSelector';
import { useModelRegistry } from '../hooks/useModelRegistry';
import { SidebarTabsPanel } from './SidebarTabsPanel';
import { QuickShortcutsGrid, BookmarkEditor, useBookmarks, type Bookmark } from './QuickShortcuts';

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
  overlayMode?: 'compact' | 'sidebar' | 'window';

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

  // Internal Sidebar
  activeSidebarTab?: 'spaces' | 'canvas' | 'terminal';
  onCloseInternalSidebar?: () => void;
  onSwitchSidebarTab?: (tab: 'spaces' | 'canvas' | 'terminal') => void;
}

// Helper to get icon for next up item
const NextUpIcon: React.FC<{ type: NextUpItem['icon'] }> = ({ type }) => {
  switch (type) {
    case 'calendar': return <Calendar className="w-3.5 h-3.5 text-white" />;
    case 'bell': return <Bell className="w-3.5 h-3.5 text-white" />;
    case 'task': return <ListTodo className="w-3.5 h-3.5 text-white" />;
    default: return <Video className="w-3.5 h-3.5 text-white" />;
  }
};

// Helper to get background color for next up item based on urgency
const getNextUpBgColor = (item: NextUpItem) => {
  if (item.urgency === 'now') return 'bg-red-500 animate-pulse';
  if (item.urgency === 'soon') return 'bg-amber-500';

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
  { id: 'sidebar', label: 'Sidebar', icon: LayoutGrid, color: 'from-blue-500 to-cyan-600', bgLight: 'bg-blue-500/10', textColor: 'text-blue-500', description: 'Toggle sidebar', hidden: true },
  { id: 'window', label: 'Window', icon: AppWindow, color: 'from-blue-500 to-cyan-600', bgLight: 'bg-blue-500/10', textColor: 'text-blue-500', description: 'Toggle window', hidden: true },
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
  overlayMode,
  conversations,
  loadingConversations,
  onSelectConversation,
  chatMenuOpen,
  onChatMenuOpenChange,
  onNewChat,
  onOpenDashboard,
  onToggleExpand,
  onToggleSidebar,
  sidebarOpen = false,
  plannerData,
  translucentMode = false,
  chatMode,
  onChatModeChange,
  chatModels,
  onChatModelsChange,

  // Internal Sidebar
  activeSidebarTab = 'spaces',
  onCloseInternalSidebar,
  onSwitchSidebarTab,
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

  // Bookmarks
  const { bookmarks, saveBookmarks, executeBookmark } = useBookmarks();
  const [showBookmarkEditor, setShowBookmarkEditor] = useState(false);

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

  const fileIconCacheRef = useRef<Record<string, string>>({});
  const [fileIconDataUrls, setFileIconDataUrls] = useState<Record<string, string>>({});
  const fileIconReqIdRef = useRef(0);

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

    searchDebounceRef.current = setTimeout(() => {
      doQuickFileSearch(q, selectedRootId || undefined);
    }, 150);

    semanticDebounceRef.current = setTimeout(() => {
      doSemanticRefine(q, selectedRootId || undefined);
    }, 650);

    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      if (semanticDebounceRef.current) clearTimeout(semanticDebounceRef.current);
    };
  }, [query, selectedRootId, doQuickFileSearch, doSemanticRefine]);

  useEffect(() => {
    const api = (window as any).desktopAPI;
    if (!api?.getFileIcon) return;

    const paths = Array.from(new Set(
      (Array.isArray(fileResults) ? fileResults : [])
        .filter((f: any) => f && String(f.kind || '').toLowerCase() === 'application')
        .map((f: any) => String(f.path || '').trim())
        .filter((p: string) => !!p)
    ));
    if (paths.length === 0) return;

    const reqId = ++fileIconReqIdRef.current;
    (async () => {
      const updates: Record<string, string> = {};
      await Promise.all(
        paths.map(async (p: string) => {
          if (fileIconCacheRef.current[p]) return;
          const res = await api.getFileIcon(p, { size: 'small' }).catch(() => null);
          if (fileIconReqIdRef.current !== reqId) return;
          if (res?.ok && typeof res.dataUrl === 'string' && res.dataUrl) {
            updates[p] = res.dataUrl;
          }
        })
      );

      if (fileIconReqIdRef.current !== reqId) return;
      const keys = Object.keys(updates);
      if (keys.length === 0) return;

      for (const k of keys) {
        fileIconCacheRef.current[k] = updates[k];
      }
      setFileIconDataUrls(prev => ({ ...prev, ...updates }));
    })();
  }, [fileResults]);

  const handleOpenIndexedFile = useCallback(async (path: string) => {
    try {
      if (!(window as any).desktopAPI?.execTool) return;
      await (window as any).desktopAPI.execTool('open_file', { path });
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
        break;
    }
  }, [onToggleSidebar, setQuery]);

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
    <div className="flex h-full overflow-hidden">
      {/* Internal Sidebar - outside main container for proper corner rendering */}
      <SidebarTabsPanel
        isOpen={sidebarOpen}
        onClose={onCloseInternalSidebar || (() => { })}
        activeTab={activeSidebarTab}
        onSwitchTab={onSwitchSidebarTab || (() => { })}
        translucentMode={translucentMode}
      />

      <div
        className={clsx(
          "flex-1 flex flex-col overflow-hidden transition-all duration-300",
          // Seamless sidebar: no left rounding when sidebar is open
          sidebarOpen ? "rounded-r-3xl rounded-l-none border-l-0" : "rounded-3xl",
          translucentMode
            ? "bg-theme-bg/25 backdrop-blur-2xl border border-theme/20"
            : "bg-theme-card border border-theme/50"
        )}
      >
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Top Bar */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-theme/10 shrink-0">
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
                "font-semibold text-sm truncate transition-colors",
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
              {/* Internal Sidebar toggle for window/sidebar modes */}
              {(overlayMode === 'window' || overlayMode === 'sidebar') && onToggleSidebar && (
                <button
                  onClick={onToggleSidebar}
                  className={clsx(
                    "p-2 rounded-xl hover:scale-105 transition-transform border border-theme/10",
                    sidebarOpen ? "bg-primary/10 text-primary border-primary/20" : "bg-theme-card text-theme-muted hover:text-theme-fg hover:bg-theme-hover"
                  )}
                  title="Sidebar (Spaces, Canvas, Terminal)"
                >
                  <PanelLeft className="w-4 h-4" />
                </button>
              )}

              {overlayMode !== 'sidebar' && (
                <button
                  onClick={() => window.desktopAPI.setMode('sidebar')}
                  className="p-2 bg-theme-card border border-theme/10 rounded-xl hover:scale-105 transition-transform text-theme-muted hover:text-theme-fg hover:bg-theme-hover"
                  title="Sidebar Mode"
                >
                  <PanelRight className="w-4 h-4" />
                </button>
              )}

              {overlayMode !== 'window' && (
                <button
                  onClick={onToggleExpand}
                  className="p-2 bg-theme-card border border-theme/10 rounded-xl hover:scale-105 transition-transform text-theme-muted hover:text-theme-fg hover:bg-theme-hover"
                  title="Window Mode"
                >
                  <AppWindow className="w-4 h-4" />
                </button>
              )}

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
                      className="text-[13px] text-primary font-semibold flex items-center gap-2 px-3 py-2.5 rounded-lg hover:bg-theme-hover outline-none cursor-pointer transition-colors mb-1"
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
                            <span className="truncate w-full font-semibold">{c.title || 'Untitled Chat'}</span>
                            <span className="text-[10px] text-theme-muted font-medium mt-0.5">{c.created_at ? new Date(c.created_at).toLocaleDateString() : ''}</span>
                          </DropdownMenu.Item>
                        ))
                      )}
                    </div>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>
          </div>

          {/* Main Content Area */}
          <div className="flex-1 flex flex-col items-center justify-center px-5 pb-5 overflow-hidden">
            <div className="w-full max-w-2xl flex flex-col h-full">
              {/* Greeting */}
              <div className="text-center py-6 shrink-0">
                <h1 className="text-2xl font-bold text-theme-fg mb-2">What can I help with?</h1>
                <p className="text-theme-muted text-sm font-medium">Ask anything, search files, or run automations</p>
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
                    className="flex-1 bg-transparent outline-none text-theme-fg placeholder:text-theme-muted resize-none py-0 overflow-y-auto font-semibold text-[15px]"
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
                      onSelectModel={(id) => onChatModeChange?.(id as any)}
                      side="bottom"
                      align="end"
                    />
                    <button
                      onClick={onMicClick}
                      className={clsx(
                        "p-2.5 rounded-xl transition-all hover:scale-105 active:scale-95",
                        isRecording ? "bg-red-500 text-white animate-pulse" : "bg-theme-hover border border-theme/10 text-theme-muted hover:text-theme-fg"
                      )}
                    >
                      <Mic className="w-4 h-4" />
                    </button>
                    <button
                      onClick={onSend}
                      disabled={!query.trim()}
                      className={clsx(
                        "p-2.5 rounded-xl transition-all hover:scale-105 active:scale-95",
                        query.trim() ? "bg-primary text-primary-fg" : "bg-theme-hover/50 text-theme-muted/50 cursor-not-allowed"
                      )}
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Quick Actions Grid */}
              {!showResults && (
                <div className="grid grid-cols-4 gap-3 mb-4 shrink-0">
                  {quickActions.map((action) => (
                    <button
                      key={action.id}
                      onClick={() => handleQuickAction(action.id)}
                      className="group flex flex-col items-center gap-2.5 p-4 rounded-2xl bg-theme-hover/30 hover:bg-theme-hover border border-theme/10 hover:border-theme/30 transition-all duration-300 hover:-translate-y-0.5"
                    >
                      <div className={clsx("w-10 h-10 rounded-xl flex items-center justify-center transition-all group-hover:scale-110", action.bgLight, action.textColor)}>
                        <action.icon className="w-5 h-5" />
                      </div>
                      <span className="text-xs font-semibold text-theme-muted group-hover:text-theme-fg transition-colors">{action.label}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Quick Shortcuts / Bookmarks */}
              {!showResults && (
                <div className="bg-theme-hover/20 rounded-2xl border border-theme/10 shrink-0">
                  <QuickShortcutsGrid
                    bookmarks={bookmarks}
                    onExecute={executeBookmark}
                    onEdit={() => setShowBookmarkEditor(true)}
                    onAdd={() => setShowBookmarkEditor(true)}
                    maxVisible={6}
                  />
                </div>
              )}

              {/* Results */}
              {showResults && (
                <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-4 min-h-0">
                  <button onClick={onSend} className="w-full flex items-center gap-4 px-4 py-3 rounded-2xl hover:bg-theme-hover transition-all group border border-transparent hover:border-theme/30 relative overflow-hidden bg-theme-hover/30">
                    <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 group-hover:scale-110 transition-all ring-1 ring-primary/20 group-hover:ring-primary/50 z-10">
                      <MessageSquare className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1 text-left z-10">
                      <div className="text-[14px] font-bold text-theme-fg group-hover:text-primary transition-colors">Ask Stuard</div>
                      <div className="text-[11px] text-theme-muted font-semibold">Get an AI assistant response</div>
                    </div>
                    <div className="text-[10px] font-bold text-theme-muted bg-theme-hover px-2.5 py-1.5 rounded-lg border border-theme/10 group-hover:bg-primary group-hover:text-primary-fg group-hover:border-primary transition-all z-10">Enter</div>
                  </button>

                  {fileResults.length > 0 && (
                    <div className="bg-theme-hover/30 rounded-2xl border border-theme/10 p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <FolderSearch className="w-4 h-4 text-emerald-500" />
                        <span className="text-[11px] font-bold uppercase tracking-wider text-theme-muted">Files Found</span>
                      </div>
                      <div className="space-y-1">
                        {fileResults.map((f: any) => {
                          const cfg = getFileKindConfig(String(f.kind || 'other').toLowerCase());
                          return (
                            <button key={f.path} onClick={() => handleOpenIndexedFile(f.path)} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-theme-hover transition-all group/file text-left border border-transparent hover:border-theme/30">
                              <div className={clsx("w-9 h-9 rounded-lg flex items-center justify-center border border-theme/20", cfg.bg, cfg.color)}>
                                <cfg.icon className="w-4 h-4" />
                              </div>
                              <div className="min-w-0 flex-1 text-[13px] font-semibold text-theme-fg truncate">{f.filename || f.path}</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Bottom Bar */}
          <div className="shrink-0 flex items-center justify-between px-5 pb-4">
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button className="flex items-center gap-2 px-4 py-2 rounded-xl bg-theme-hover/30 hover:bg-theme-hover border border-theme/10 transition-all text-sm text-theme-muted hover:text-theme-fg">
                  <ListTodo className="w-4 h-4 text-primary" />
                  <span className="font-semibold">Tasks</span>
                  {tasksCount > 0 && <span className="bg-primary text-primary-fg text-[10px] px-1.5 py-0.5 rounded-full min-w-[18px] text-center font-bold">{tasksCount}</span>}
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className="DropdownContent z-[10002] w-80 bg-theme-card rounded-xl border border-theme p-3 shadow-2xl backdrop-blur-xl" sideOffset={8} align="start">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[11px] font-bold text-theme-muted uppercase tracking-wider">Active Tasks</span>
                    <button
                      onClick={() => window.desktopAPI?.openDashboard?.({ tab: 'tasks' })}
                      className="text-[10px] font-bold text-primary hover:text-primary/80 transition-colors"
                    >
                      View All
                    </button>
                  </div>
                  <div className="max-h-[280px] overflow-y-auto custom-scrollbar space-y-1.5">
                    {tasks.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-8 text-center">
                        <div className="w-12 h-12 bg-theme-muted/5 rounded-full flex items-center justify-center mb-3">
                          <ListTodo className="w-6 h-6 text-theme-muted/30" />
                        </div>
                        <p className="text-[12px] text-theme-muted">No pending tasks</p>
                        <p className="text-[10px] text-theme-muted/70 mt-1">Add tasks from the dashboard</p>
                      </div>
                    ) : tasks.slice(0, 6).map(task => {
                      const isOverdue = task.due && new Date(task.due) < new Date();
                      const priorityColors: Record<string, string> = {
                        urgent: 'text-red-500 bg-red-500/10',
                        high: 'text-orange-500 bg-orange-500/10',
                        normal: 'text-blue-500 bg-blue-500/10',
                        low: 'text-theme-muted bg-theme-muted/10',
                      };
                      return (
                        <div 
                          key={task.id} 
                          className="flex items-start gap-3 p-2.5 rounded-xl hover:bg-theme-hover/50 transition-all group/task border border-transparent hover:border-theme/10"
                        >
                          <div className={clsx(
                            "mt-0.5 w-4 h-4 rounded-full border-[1.5px] flex items-center justify-center shrink-0 transition-colors",
                            "border-theme-muted/30 hover:border-primary cursor-pointer"
                          )}>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-[12px] text-theme-fg font-semibold truncate">
                                {task.title}
                              </span>
                              {task.priority && task.priority !== 'normal' && task.priority !== 'low' && (
                                <span className={clsx(
                                  "text-[8px] px-1.5 py-0.5 rounded-full font-bold uppercase",
                                  priorityColors[task.priority] || priorityColors.normal
                                )}>
                                  {task.priority}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-[10px] text-theme-muted">
                              {task.due && (
                                <span className={clsx(
                                  "flex items-center gap-1",
                                  isOverdue && "text-red-500"
                                )}>
                                  <Calendar className="w-3 h-3" />
                                  {new Date(task.due).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                </span>
                              )}
                              {(task.subTodosTotal || 0) > 0 && (
                                <span className="flex items-center gap-1">
                                  <ListTodo className="w-3 h-3" />
                                  {task.subTodosCompleted || 0}/{task.subTodosTotal}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {tasks.length > 6 && (
                      <button
                        onClick={() => window.desktopAPI?.openDashboard?.({ tab: 'tasks' })}
                        className="w-full text-center text-[11px] font-semibold text-primary hover:text-primary/80 py-2 transition-colors"
                      >
                        +{tasks.length - 6} more tasks
                      </button>
                    )}
                  </div>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
            <button onClick={() => (window as any).desktopAPI?.hide?.()} className="p-2 rounded-xl bg-theme-hover/30 hover:bg-red-500/10 border border-theme/10 text-theme-muted hover:text-red-500 transition-all">
              <Power className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Bookmark Editor Modal */}
      <BookmarkEditor
        isOpen={showBookmarkEditor}
        onClose={() => setShowBookmarkEditor(false)}
        bookmarks={bookmarks}
        onSave={saveBookmarks}
      />
    </div>
  );
};
