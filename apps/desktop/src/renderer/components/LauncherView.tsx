import React, {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import TextareaAutosize from "react-textarea-autosize";
import {
  LayoutGrid,
  Mic,
  Plus,
  Video,
  X,
  Calendar,
  Bell,
  Folder,
  File as FileIcon,
  Loader2,
  Image as ImageIcon,
  Music,
  Code as CodeIcon,
  Archive,
  AppWindow,
  Film,
  FileText,
  Sparkles,
  Zap,
  MessageCircle,
  Grid3X3,
  FolderSearch,
  MessageSquare,
  ListTodo,
  CheckCircle,
} from "lucide-react";
import type {
  UsePlannerDataResult,
  NextUpItem,
  PlannerTask,
} from "../hooks/usePlannerData";
import { CommandItem } from "./CommandPalette";
import { clsx } from "clsx";
import type {
  ChatMode,
  ChatModelsConfig,
  ReasoningLevel,
} from "../hooks/usePreferences";
import { ModelSelector } from "./ModelSelector";
import { useModelRegistry } from "../hooks/useModelRegistry";
import { SidebarTabsPanel } from "./SidebarTabsPanel";
import { ChatTabs } from "./chat-view/ChatTabs";
import { ChatHeaderActions } from "./chat-view/ChatHeaderActions";
import {
  QuickShortcutsGrid,
  BookmarkEditor,
  useBookmarks,
  getTypeConfig,
  type Bookmark,
} from "./QuickShortcuts";
import { TasksView, type TaskSubTab } from "./TasksView";

interface LauncherViewProps {
  query: string;
  setQuery: (q: string) => void;
  onSend: () => void;
  commands: CommandItem[];
  statusText?: string;
  connectionStatus?: "connected" | "connecting" | "disconnected" | "error";
  onMicClick?: () => void;
  isRecording?: boolean;
  onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  accessToken?: string | null;
  overlayMode?: "compact" | "sidebar" | "window";

  // History Props
  conversations: any[];
  loadingConversations: boolean;
  onSelectConversation: (id: string) => void;
  chatMenuOpen: boolean;
  onChatMenuOpenChange: (open: boolean) => void;
  onNewChat: () => void;
  onOpenDashboard: () => void;
  onToggleExpand: () => void;
  onCollapse?: () => void;
  onDeleteConversation?: (id: string) => void;

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
  reasoningLevel?: ReasoningLevel;
  onReasoningLevelChange?: (level: ReasoningLevel) => void;

  // Tabs
  tabs?: any[];
  activeTabId?: string;
  onSwitchTab?: (id: string) => void;
  onCloseTab?: (id: string) => void;
  onAddTab?: () => void;

  // Internal Sidebar
  activeSidebarTab?: "spaces" | "canvas" | "terminal" | "tasks" | "browser" | "todo";
  onCloseInternalSidebar?: () => void;
  onSwitchSidebarTab?: (tab: "spaces" | "canvas" | "terminal" | "tasks" | "browser" | "todo") => void;
}

// Helper to get icon for next up item
const NextUpIcon: React.FC<{ type: NextUpItem["icon"] }> = ({ type }) => {
  switch (type) {
    case "calendar":
      return <Calendar className="w-3.5 h-3.5 text-white" />;
    case "bell":
      return <Bell className="w-3.5 h-3.5 text-white" />;
    case "task":
      return <ListTodo className="w-3.5 h-3.5 text-white" />;
    default:
      return <Video className="w-3.5 h-3.5 text-white" />;
  }
};

// Helper to get background color for next up item based on urgency
const getNextUpBgColor = (item: NextUpItem) => {
  if (item.urgency === "now") return "bg-red-500 animate-pulse";
  if (item.urgency === "soon") return "bg-amber-500";

  switch (item.icon) {
    case "calendar":
      return "bg-blue-500";
    case "bell":
      return "bg-amber-500";
    case "task":
      return "bg-emerald-500";
    default:
      return "bg-blue-500";
  }
};

// Helper to get text color based on urgency
const getNextUpTextColor = (item: NextUpItem) => {
  if (item.urgency === "now") return "text-red-600";
  if (item.urgency === "soon") return "text-amber-700 dark:text-amber-500";
  return "text-theme-fg";
};

const normalizeLauncherSearchText = (value: string): string =>
  String(value || "")
    .toLowerCase()
    .replace(/[/\\]+/g, " ")
    .replace(/[_\-.]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const shouldRunLauncherSemanticSearch = (query: string): boolean => {
  const normalized = normalizeLauncherSearchText(query);
  const compactLen = normalized.replace(/\s+/g, "").length;
  const tokenCount = normalized ? normalized.split(" ").length : 0;
  return tokenCount > 1 && compactLen >= 6;
};

// Quick action card data
const quickActions = [
  {
    id: "chat",
    label: "Chat",
    icon: MessageCircle,
    color: "from-violet-500 to-purple-600",
    bgLight: "bg-primary/10",
    textColor: "text-primary",
    description: "Start a conversation",
  },
  {
    id: "workflows",
    label: "Workflows",
    icon: Zap,
    color: "from-amber-500 to-orange-600",
    bgLight: "bg-amber-500/10",
    textColor: "text-amber-500",
    description: "Automate tasks",
  },
  {
    id: "files",
    label: "Files",
    icon: FolderSearch,
    color: "from-emerald-500 to-teal-600",
    bgLight: "bg-emerald-500/10",
    textColor: "text-emerald-500",
    description: "Search your files",
  },
  {
    id: "spaces",
    label: "Spaces",
    icon: Grid3X3,
    color: "from-blue-500 to-cyan-600",
    bgLight: "bg-blue-500/10",
    textColor: "text-blue-500",
    description: "Organize projects",
  },
  {
    id: "sidebar",
    label: "Sidebar",
    icon: LayoutGrid,
    color: "from-blue-500 to-cyan-600",
    bgLight: "bg-blue-500/10",
    textColor: "text-blue-500",
    description: "Toggle sidebar",
    hidden: true,
  },
  {
    id: "window",
    label: "Window",
    icon: AppWindow,
    color: "from-blue-500 to-cyan-600",
    bgLight: "bg-blue-500/10",
    textColor: "text-blue-500",
    description: "Toggle window",
    hidden: true,
  },
];

export const LauncherView: React.FC<LauncherViewProps> = ({
  query,
  setQuery,
  onSend,
  commands,
  statusText,
  connectionStatus = "connected",
  onMicClick,
  isRecording,
  onPaste,
  accessToken,
  overlayMode,
  conversations,
  loadingConversations,
  onSelectConversation,
  chatMenuOpen,
  onChatMenuOpenChange,
  onOpenDashboard,
  onToggleSidebar,
  sidebarOpen = false,
  plannerData,
  translucentMode = false,
  chatMode,
  onChatModeChange,
  chatModels,
  onChatModelsChange,
  reasoningLevel,
  onReasoningLevelChange,
  onCollapse,
  onDeleteConversation,
  tabs = [],
  activeTabId,
  onSwitchTab,
  onCloseTab,
  onAddTab,

  // Internal Sidebar
  activeSidebarTab = "spaces",
  onCloseInternalSidebar,
  onSwitchSidebarTab,
}) => {
  const { modelById } = useModelRegistry();
  const CLOUD_AI_HTTP =
    (window as any).__CLOUD_AI_HTTP__ ||
    (import.meta as any).env?.VITE_CLOUD_AI_URL ||
    "http://127.0.0.1:8082";
  const deferredQuery = useDeferredValue(query);
  const normalizedDeferredQuery = useMemo(
    () => String(deferredQuery || "").trim(),
    [deferredQuery],
  );

  const selectedModelId: string | "auto" =
    typeof chatMode === "string" && chatMode.trim()
      ? (chatMode.trim() as any)
      : "auto";
  const selectedModelLabel = (() => {
    if (selectedModelId === "auto") return "Auto";
    const m = modelById.get(selectedModelId);
    return m ? m.name : selectedModelId;
  })();
  const filteredCommands = useMemo(
    () =>
      commands
        .filter(
          (c) =>
            c.title
              .toLowerCase()
              .includes(normalizedDeferredQuery.toLowerCase()) ||
            (c.group &&
              c.group
                .toLowerCase()
                .includes(normalizedDeferredQuery.toLowerCase())),
        )
        .slice(0, 8),
    [commands, normalizedDeferredQuery],
  );

  const nextUp = plannerData?.nextUp;
  const [viewMode, setViewMode] = useState<"chat" | "tasks">("chat");
  const [tasksSubTab, setTasksSubTab] = useState<TaskSubTab>("todo");

  // Bookmarks
  const { bookmarks, saveBookmarks, executeBookmark } = useBookmarks();
  const [showBookmarkEditor, setShowBookmarkEditor] = useState(false);

  // Discovered apps for quick shortcuts (loaded once on mount)
  const [discoveredApps, setDiscoveredApps] = useState<any[]>([]);

  // File search / indexing state
  const [appResults, setAppResults] = useState<any[]>([]);
  const [fileResults, setFileResults] = useState<any[]>([]);
  const [fileSearchMode, setFileSearchMode] = useState<"quick" | "hybrid">(
    "quick",
  );
  const [fileLoading, setFileLoading] = useState(false);
  const [fileSemanticLoading, setFileSemanticLoading] = useState(false);
  const [fileError, setFileError] = useState("");
  const [indexStats, setIndexStats] = useState<any>(null);
  const [roots, setRoots] = useState<any[]>([]);
  const [selectedRootId, setSelectedRootId] = useState<string>("");
  const [processingPending, setProcessingPending] = useState(false);
  const [processedPendingCount, setProcessedPendingCount] = useState(0);

  const fileIconCacheRef = useRef<Record<string, string>>({});
  const [fileIconDataUrls, setFileIconDataUrls] = useState<
    Record<string, string>
  >({});
  const fileIconReqIdRef = useRef(0);

  const searchReqIdRef = useRef(0);
  const semanticReqIdRef = useRef(0);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const semanticDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const refreshIndexMeta = useCallback(async () => {
    try {
      if (!(window as any).desktopAPI?.execTool) return;
      const [r, s] = await Promise.all([
        (window as any).desktopAPI.execTool("file_index_list_roots", {
          enabled_only: true,
        }),
        (window as any).desktopAPI.execTool("file_index_stats", {}),
      ]);
      if (r?.ok && Array.isArray(r.roots)) setRoots(r.roots);
      if (s?.ok) setIndexStats(s);
    } catch {}
  }, []);

  useEffect(() => {
    refreshIndexMeta();
    // Load discovered apps for quick shortcuts and refresh again once
    // the startup icon warm-up completes in the main process.
    const loadApps = async (forceRefresh = false) => {
      try {
        const res = await (window as any).desktopAPI?.listApps?.(forceRefresh);
        const apps = res?.apps ?? res; // IPC returns { ok, apps } wrapper
        if (Array.isArray(apps) && apps.length > 0) {
          // Sort apps: prioritize popular/well-known apps, then alphabetical
          const POPULAR = new Set([
            "chrome",
            "google chrome",
            "firefox",
            "discord",
            "slack",
            "spotify",
            "visual studio code",
            "code",
            "teams",
            "microsoft teams",
            "telegram",
            "whatsapp",
            "notion",
            "figma",
            "steam",
            "obs studio",
            "obs",
            "postman",
            "terminal",
            "iterm",
            "warp",
            "arc",
            "brave",
            "edge",
            "microsoft edge",
            "safari",
            "zoom",
            "vlc",
            "git bash",
            "github desktop",
            "docker",
            "docker desktop",
            "cursor",
          ]);
          const sorted = [...apps].sort((a: any, b: any) => {
            const aName = String(a.name || "").toLowerCase();
            const bName = String(b.name || "").toLowerCase();
            const aPop = POPULAR.has(aName) ? 1 : 0;
            const bPop = POPULAR.has(bName) ? 1 : 0;
            if (aPop !== bPop) return bPop - aPop; // popular first
            // Prefer apps with icon hints (more likely to show icons)
            const aIcon = String(a.iconHint || "").trim() ? 1 : 0;
            const bIcon = String(b.iconHint || "").trim() ? 1 : 0;
            if (aIcon !== bIcon) return bIcon - aIcon;
            return aName.localeCompare(bName);
          });
          setDiscoveredApps(sorted);
        }
      } catch {}
    };
    loadApps();
    const unsub = (window as any).desktopAPI?.onAppsUpdated?.((data: any) => {
      if (data?.iconsReady) loadApps(false);
    });
    return () => {
      try {
        unsub?.();
      } catch {}
    };
  }, [refreshIndexMeta]);

  /** Unified search: hits app-discovery + file index in one call */
  const doUnifiedSearch = useCallback(async (q: string, rootId?: string) => {
    const api = (window as any).desktopAPI;
    if (!api?.unifiedSearch) {
      // Fallback to old file search if unified search not available
      if (!api?.execTool) return;
      const reqId = ++searchReqIdRef.current;
      setFileLoading(true);
      setFileError("");
      try {
        const res = await api.execTool("file_search", {
          query: q,
          mode: "quick",
          limit: 6,
          root_id: rootId || undefined,
        });
        if (searchReqIdRef.current !== reqId) return;
        if (res?.ok) {
          setFileResults(
            Array.isArray(res.results) ? res.results.slice(0, 6) : [],
          );
          setAppResults([]);
          setFileSearchMode("quick");
        } else {
          setFileResults([]);
          setAppResults([]);
          setFileError(String(res?.error || "search_failed"));
        }
      } catch (e: any) {
        if (searchReqIdRef.current !== reqId) return;
        setFileResults([]);
        setAppResults([]);
        setFileError(String(e?.message || "search_failed"));
      } finally {
        if (searchReqIdRef.current === reqId) setFileLoading(false);
      }
      return;
    }

    const reqId = ++searchReqIdRef.current;
    setFileLoading(true);
    setFileError("");
    try {
      const res = await api.unifiedSearch(q, {
        limit: 12,
        rootId: rootId || undefined,
        includeApps: true,
        includeFiles: true,
      });

      if (searchReqIdRef.current !== reqId) return;
      if (res?.ok && Array.isArray(res.results)) {
        // Split results: apps vs files
        const apps = res.results
          .filter((r: any) => r.source === "app-discovery")
          .slice(0, 5);
        const files = res.results
          .filter((r: any) => r.source !== "app-discovery")
          .slice(0, 8);
        setAppResults(apps);
        setFileResults(files);
        setFileSearchMode("quick");

        // Backfill indexed file results without delaying the instant app response.
        if (api?.execTool) {
          void (async () => {
            try {
              const indexed = await api.execTool("file_search", {
                query: q,
                mode: "quick",
                limit: 8,
                root_id: rootId || undefined,
              });
              if (searchReqIdRef.current !== reqId) return;
              if (!indexed?.ok) return;

              const indexedFiles = Array.isArray(indexed.results)
                ? indexed.results.slice(0, 8)
                : [];
              if (indexedFiles.length === 0) return;

              setFileResults(indexedFiles);
              setFileSearchMode("quick");
            } catch {
              // Keep the fast unified-search results if indexed backfill fails.
            }
          })();
        }
      } else {
        setAppResults([]);
        setFileResults([]);
        setFileError(String(res?.error || "search_failed"));
      }
    } catch (e: any) {
      if (searchReqIdRef.current !== reqId) return;
      setAppResults([]);
      setFileResults([]);
      setFileError(String(e?.message || "search_failed"));
    } finally {
      if (searchReqIdRef.current === reqId) setFileLoading(false);
    }
  }, []);

  const doSemanticRefine = useCallback(
    async (q: string, rootId?: string) => {
      const token = typeof accessToken === "string" ? accessToken : "";
      const indexed = Number(indexStats?.indexed_files || 0);
      if (!token || indexed <= 0 || !shouldRunLauncherSemanticSearch(q)) return;
      if (!(window as any).desktopAPI?.execTool) return;

      const reqId = ++semanticReqIdRef.current;
      setFileSemanticLoading(true);
      try {
        const resp = await fetch(
          `${String(CLOUD_AI_HTTP).replace(/\/$/, "")}/inference/ai/embed`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ text: q, model: "text-embedding-3-large" }),
          },
        );
        const j = await resp.json().catch(() => ({}));
        if (semanticReqIdRef.current !== reqId) return;
        if (!resp.ok || !j?.ok || !Array.isArray(j.embedding)) return;

        const res = await (window as any).desktopAPI.execTool("file_search", {
          query: q,
          vector: j.embedding,
          mode: "hybrid",
          limit: 4,
          root_id: rootId || undefined,
        });

        if (semanticReqIdRef.current !== reqId) return;
        if (res?.ok) {
          setFileResults(
            Array.isArray(res.results) ? res.results.slice(0, 8) : [],
          );
          setFileSearchMode("hybrid");
        }
      } catch {
        // ignore
      } finally {
        if (semanticReqIdRef.current === reqId) setFileSemanticLoading(false);
      }
    },
    [CLOUD_AI_HTTP, accessToken, indexStats?.indexed_files],
  );

  useEffect(() => {
    const q = normalizedDeferredQuery;
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = null;
    }
    if (semanticDebounceRef.current) {
      clearTimeout(semanticDebounceRef.current);
      semanticDebounceRef.current = null;
    }

    if (q.length < 2) {
      searchReqIdRef.current += 1;
      semanticReqIdRef.current += 1;
      setAppResults([]);
      setFileResults([]);
      setFileError("");
      setFileLoading(false);
      setFileSemanticLoading(false);
      return;
    }

    searchDebounceRef.current = setTimeout(() => {
      doUnifiedSearch(q, selectedRootId || undefined);
    }, 100);

    if (shouldRunLauncherSemanticSearch(q)) {
      semanticDebounceRef.current = setTimeout(() => {
        doSemanticRefine(q, selectedRootId || undefined);
      }, 900);
    }

    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      if (semanticDebounceRef.current)
        clearTimeout(semanticDebounceRef.current);
    };
  }, [
    normalizedDeferredQuery,
    selectedRootId,
    doUnifiedSearch,
    doSemanticRefine,
  ]);

  useEffect(() => {
    const api = (window as any).desktopAPI;
    if (!api?.getFileIcon) return;

    const uniquePaths = (values: string[]) =>
      Array.from(new Set(values.filter(Boolean)));

    const iconRequests: { displayPath: string; iconPaths: string[] }[] = [];
    for (const a of Array.isArray(appResults) ? appResults.slice(0, 5) : []) {
      if (!a) continue;
      const displayPath = String(a.path || a.name || "").trim();
      if (typeof a.iconDataUrl === "string" && a.iconDataUrl) {
        fileIconCacheRef.current[displayPath] = a.iconDataUrl;
        continue;
      }
      const iconHint = String(a.iconHint || "").trim();
      const launchTarget = String(a.launchTarget || "").trim();
      const candidates = uniquePaths([iconHint, launchTarget, displayPath]);
      if (!displayPath || candidates.length === 0) continue;
      iconRequests.push({ displayPath, iconPaths: candidates });
    }

    if (iconRequests.length === 0) return;

    const reqId = ++fileIconReqIdRef.current;
    (async () => {
      const updates: Record<string, string> = {};
      await Promise.all(
        iconRequests.map(async ({ displayPath, iconPaths }) => {
          if (fileIconCacheRef.current[displayPath]) return;
          for (const p of iconPaths) {
            if (!p) continue;
            const res = await api
              .getFileIcon(p, { size: "normal" })
              .catch(() => null);
            if (fileIconReqIdRef.current !== reqId) return;
            if (res?.ok && typeof res.dataUrl === "string" && res.dataUrl) {
              updates[displayPath] = res.dataUrl;
              return;
            }
          }
        }),
      );

      if (fileIconReqIdRef.current !== reqId) return;
      const keys = Object.keys(updates);
      if (keys.length === 0) return;

      for (const k of keys) {
        fileIconCacheRef.current[k] = updates[k];
      }
      setFileIconDataUrls((prev) => ({ ...prev, ...updates }));
    })();
  }, [appResults]);

  // Resolve icons for discovered apps shown in quick shortcuts
  useEffect(() => {
    const api = (window as any).desktopAPI;
    if (!api?.getFileIcon || discoveredApps.length === 0) return;

    (async () => {
      const updates: Record<string, string> = {};
      await Promise.all(
        discoveredApps.slice(0, 8).map(async (da: any) => {
          const key = String(da.id || "");
          if (!key || fileIconCacheRef.current[key]) return;
          if (typeof da.iconDataUrl === "string" && da.iconDataUrl) {
            updates[key] = da.iconDataUrl;
            return;
          }
          const iconPath = String(
            da.iconHint || da.launchTarget || da.id || "",
          ).trim();
          if (!iconPath) return;
          try {
            const res = await api.getFileIcon(iconPath, { size: "normal" });
            if (res?.ok && typeof res.dataUrl === "string" && res.dataUrl) {
              updates[key] = res.dataUrl;
            }
          } catch {}
        }),
      );

      const keys = Object.keys(updates);
      if (keys.length === 0) return;
      for (const k of keys) fileIconCacheRef.current[k] = updates[k];
      setFileIconDataUrls((prev) => ({ ...prev, ...updates }));
    })();
  }, [discoveredApps]);

  const handleOpenIndexedFile = useCallback(async (path: string) => {
    try {
      if (!(window as any).desktopAPI?.execTool) return;
      await (window as any).desktopAPI.execTool("open_file", { path });
    } catch {}
  }, []);

  const handleLaunchApp = useCallback(async (launchTarget: string) => {
    try {
      const api = (window as any).desktopAPI;
      if (api?.launchApp) {
        await api.launchApp(launchTarget);
      } else if (api?.execTool) {
        await api.execTool("open_file", { path: launchTarget });
      }
    } catch {}
  }, []);

  const handleQuickAction = useCallback(
    (actionId: string) => {
      switch (actionId) {
        case "workflows":
          (window as any).desktopAPI?.openWorkflows?.();
          break;
        case "spaces":
          onToggleSidebar?.();
          break;
        case "files":
          setQuery("@");
          break;
        case "chat":
        default:
          break;
      }
    },
    [onToggleSidebar, setQuery],
  );

  const displayStatus = nextUp
    ? `${nextUp.title} ${nextUp.timeLabel}`
    : statusText || "Ready";

  const hasQuery = String(query || "").trim().length >= 2;
  const showResults =
    hasQuery &&
    (filteredCommands.length > 0 ||
      fileResults.length > 0 ||
      appResults.length > 0);

  const getFileKindConfig = (k: string) => {
    switch (k) {
      case "application":
        return {
          icon: AppWindow,
          color: "text-blue-500",
          bg: "bg-blue-500/10",
          label: "APP",
        };
      case "folder":
        return {
          icon: Folder,
          color: "text-yellow-500",
          bg: "bg-yellow-500/10",
          label: "FOLDER",
        };
      case "image":
        return {
          icon: ImageIcon,
          color: "text-purple-500",
          bg: "bg-purple-500/10",
          label: "IMG",
        };
      case "video":
        return {
          icon: Film,
          color: "text-red-500",
          bg: "bg-red-500/10",
          label: "VID",
        };
      case "audio":
        return {
          icon: Music,
          color: "text-pink-500",
          bg: "bg-pink-500/10",
          label: "AUDIO",
        };
      case "code":
        return {
          icon: CodeIcon,
          color: "text-emerald-500",
          bg: "bg-emerald-500/10",
          label: "CODE",
        };
      case "archive":
        return {
          icon: Archive,
          color: "text-orange-500",
          bg: "bg-orange-500/10",
          label: "ZIP",
        };
      case "document":
        return {
          icon: FileText,
          color: "text-sky-500",
          bg: "bg-sky-500/10",
          label: "DOC",
        };
      default:
        return {
          icon: FileIcon,
          color: "text-theme-muted",
          bg: "bg-theme-muted/10",
          label: "FILE",
        };
    }
  };

  return (
    <div className="flex h-full min-w-0 overflow-hidden">
      {/* Internal Sidebar - outside main container for proper corner rendering */}
      <SidebarTabsPanel
        isOpen={sidebarOpen}
        onClose={onCloseInternalSidebar || (() => {})}
        activeTab={activeSidebarTab}
        onSwitchTab={onSwitchSidebarTab || (() => {})}
        translucentMode={translucentMode}
      />

      <div
        className={clsx(
          "flex-1 min-w-0 min-h-0 flex flex-col p-3 transition-all duration-300",
          sidebarOpen
            ? "rounded-r-[28px] rounded-l-none border-l-0 overflow-hidden"
            : "rounded-[28px] overflow-hidden",
          translucentMode
            ? "bg-theme-bg/25 backdrop-blur-2xl border border-theme/20"
            : "bg-theme-bg border border-theme/10",
        )}
      >
        <div
          className={clsx(
            "flex-1 min-h-0 flex flex-col overflow-hidden p-2",
            "rounded-[24px]",
            translucentMode
              ? "bg-theme-bg backdrop-blur-xl border border-theme/5"
              : "bg-theme-card border border-theme/10 shadow-sm",
          )}
        >
          {/* Top Header */}
          <div className="flex items-center justify-between px-2 py-2 border-b border-theme/10 bg-theme-hover/40 backdrop-blur-sm w-full min-w-0 shrink-0">
            <div className="flex-1 w-0 min-w-0 overflow-hidden mr-2">
              <ChatTabs
                tabs={tabs}
                activeTabId={activeTabId}
                onSwitchTab={onSwitchTab}
                onCloseTab={onCloseTab}
                onAddTab={onAddTab}
              />
            </div>
            <ChatHeaderActions
              onToggleSidebar={onToggleSidebar}
              sidebarOpen={sidebarOpen}
              onOpenDashboard={onOpenDashboard}
              onCollapse={onCollapse || (() => {})}
              overlayMode={overlayMode}
              chatMenuOpen={chatMenuOpen}
              onChatMenuOpenChange={onChatMenuOpenChange}
              conversations={conversations}
              loadingConversations={loadingConversations}
              onSelectConversation={onSelectConversation}
              onDeleteConversation={onDeleteConversation}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              onSwitchSidebarTab={onSwitchSidebarTab}
            />
          </div>

          {/* Main Content Area */}
          <div className="flex-1 flex flex-col items-center px-4 pb-3 overflow-y-auto custom-scrollbar">
            {viewMode === "tasks" ? (
              <div className="w-full flex-1 min-h-0 overflow-y-auto custom-scrollbar pt-3">
                <TasksView
                  compact
                  defaultSubTab={tasksSubTab}
                  onSubTabChange={setTasksSubTab}
                />
              </div>
            ) : (
              <div className="w-full max-w-xl flex flex-col flex-1">
                {/* Greeting */}
                <div className="text-center pt-4 pb-2 shrink-0">
                  <h1 className="text-lg font-bold text-theme-fg mb-1">
                    What can I help with?
                  </h1>
                  <p className="text-theme-muted text-xs font-medium">
                    Ask anything, search files, or run automations
                  </p>
                </div>

                {/* Quick Actions Grid */}
                {!showResults && (
                  <div className="grid grid-cols-4 gap-1.5 mb-3 shrink-0">
                    {quickActions.map((action) => (
                      <button
                        key={action.id}
                        onClick={() => handleQuickAction(action.id)}
                        className="group flex flex-col items-center gap-1.5 p-2.5 rounded-xl bg-transparent hover:bg-theme-hover/70 border border-theme/5 hover:border-theme/20 transition-all duration-200"
                      >
                        <div
                          className={clsx(
                            "w-5 h-5 rounded-lg flex items-center justify-center transition-all group-hover:scale-110",
                            action.bgLight,
                            action.textColor,
                          )}
                        >
                          <action.icon className="w-3 h-3" />
                        </div>
                        <span className="text-[10px] font-semibold text-theme-muted group-hover:text-theme-fg transition-colors">
                          {action.label}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Quick Shortcuts / Bookmarks */}
                {!showResults && (
                  <div className="bg-theme-hover/15 rounded-xl border border-theme/5 shrink-0">
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
                  <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-3 min-h-0">
                    <button
                      onClick={onSend}
                      className="w-full flex items-center gap-4 px-4 py-3 rounded-2xl hover:bg-theme-hover transition-all group border border-transparent hover:border-theme/30 relative overflow-hidden bg-theme-bg"
                    >
                      <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                      <div className="w-7 h-7 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 group-hover:scale-110 transition-all ring-1 ring-primary/20 group-hover:ring-primary/50 z-10">
                        <MessageSquare className="w-3.5 h-3.5 text-primary" />
                      </div>
                      <div className="flex-1 text-left z-10">
                        <div className="text-[13px] font-bold text-theme-fg group-hover:text-primary transition-colors">
                          Ask Stuard
                        </div>
                        <div className="text-[11px] text-theme-muted font-semibold">
                          Get an AI assistant response
                        </div>
                      </div>
                      <div className="text-[10px] font-bold text-theme-muted bg-theme-hover px-2.5 py-1.5 rounded-lg border border-theme/10 group-hover:bg-primary group-hover:text-primary-fg group-hover:border-primary transition-all z-10">
                        Enter
                      </div>
                    </button>

                    {/* Apps — always first */}
                    {appResults.length > 0 && (
                      <div className="bg-theme-bg/30 rounded-2xl border border-theme/20 p-4 shadow-sm">
                        <div className="flex items-center gap-2 mb-3">
                          <AppWindow className="w-4 h-4 text-blue-500" />
                          <span className="text-[11px] font-bold uppercase tracking-wider text-theme-muted">
                            Applications
                          </span>
                          {fileLoading && (
                            <Loader2 className="w-3 h-3 text-theme-muted animate-spin" />
                          )}
                        </div>
                        <div className="space-y-1">
                          {appResults.map((a: any) => {
                            const iconUrl =
                              a?.iconDataUrl ||
                              (a?.path
                                ? fileIconDataUrls[String(a.path)]
                                : undefined);
                            return (
                              <button
                                key={a.path || a.name}
                                onClick={() =>
                                  handleLaunchApp(a.launchTarget || a.path)
                                }
                                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-theme-hover transition-all group/app text-left border border-transparent hover:border-blue-500/30"
                              >
                                <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-blue-500/10 text-blue-500 border border-theme/20">
                                  {iconUrl ? (
                                    <img
                                      src={iconUrl}
                                      alt=""
                                      loading="lazy"
                                      className="w-5 h-5 object-contain"
                                    />
                                  ) : (
                                    <AppWindow className="w-3.5 h-3.5" />
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="text-[13px] font-semibold text-theme-fg truncate group-hover/app:text-blue-500 transition-colors">
                                    {a.display_name || a.name}
                                  </div>
                                </div>
                                <span className="text-[9px] font-bold text-blue-500/60 bg-blue-500/8 px-1.5 py-0.5 rounded-md uppercase">
                                  App
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Files — after apps */}
                    {fileResults.length > 0 && (
                      <div className="bg-theme-bg/30 rounded-2xl border border-theme/20 p-4 shadow-sm">
                        <div className="flex items-center gap-2 mb-3">
                          <FolderSearch className="w-4 h-4 text-emerald-500" />
                          <span className="text-[11px] font-bold uppercase tracking-wider text-theme-muted">
                            Files
                          </span>
                          {fileSemanticLoading && (
                            <Sparkles className="w-3 h-3 text-amber-500 animate-pulse" />
                          )}
                        </div>
                        <div className="space-y-1">
                          {fileResults.map((f: any) => {
                            const cfg = getFileKindConfig(
                              String(f.kind || "other").toLowerCase(),
                            );
                            const iconUrl =
                              String(f.kind || "other").toLowerCase() ===
                                "application" && f?.path
                                ? fileIconDataUrls[String(f.path)]
                                : undefined;
                            return (
                              <button
                                key={f.path}
                                onClick={() => handleOpenIndexedFile(f.path)}
                                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-theme-hover transition-all group/file text-left border border-transparent hover:border-theme/30"
                              >
                                <div
                                  className={clsx(
                                    "w-7 h-7 rounded-lg flex items-center justify-center border border-theme/20",
                                    cfg.bg,
                                    cfg.color,
                                  )}
                                >
                                  {iconUrl ? (
                                    <img
                                      src={iconUrl}
                                      alt=""
                                      loading="lazy"
                                      className="w-5 h-5 object-contain"
                                    />
                                  ) : (
                                    <cfg.icon className="w-3.5 h-3.5" />
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="text-[13px] font-semibold text-theme-fg truncate">
                                    {f.display_name || f.filename || f.path}
                                  </div>
                                </div>
                                <span
                                  className={clsx(
                                    "text-[9px] font-bold px-1.5 py-0.5 rounded-md uppercase",
                                    cfg.color,
                                    cfg.bg,
                                  )}
                                >
                                  {cfg.label}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Bottom Input Area - Integrated into the single card */}
          <div className="shrink-0 w-full max-w-3xl mx-auto mt-auto px-4 pb-4">
            {/* Compact-mode quick shortcuts row — apps first, then bookmarks */}
            {overlayMode === "compact" &&
              !showResults &&
              (discoveredApps.length > 0 || bookmarks.length > 0) && (
                <div className="flex items-center gap-1.5 mb-2 overflow-x-auto scrollbar-none">
                  {/* Discovered apps — always shown first */}
                  {discoveredApps.slice(0, 4).map((da: any) => {
                    const iconUrl =
                      da?.iconDataUrl || fileIconDataUrls[String(da.id || "")];
                    return (
                      <button
                        key={da.id}
                        onClick={() =>
                          handleLaunchApp(da.launchTarget || da.id)
                        }
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-blue-500/8 hover:bg-blue-500/15 border border-blue-500/15 hover:border-blue-500/30 transition-all shrink-0 group"
                        title={da.name}
                      >
                        {iconUrl ? (
                          <img
                            src={iconUrl}
                            alt=""
                            loading="lazy"
                            className="w-3.5 h-3.5 object-contain"
                          />
                        ) : (
                          <AppWindow className="w-3.5 h-3.5 text-blue-500" />
                        )}
                        <span className="text-[11px] font-semibold text-blue-500/80 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors truncate max-w-[80px]">
                          {da.name}
                        </span>
                      </button>
                    );
                  })}
                  {/* Bookmarks fill remaining slots */}
                  {bookmarks
                    .slice(
                      0,
                      Math.max(0, 5 - Math.min(discoveredApps.length, 4)),
                    )
                    .map((bm) => {
                      const cfg = getTypeConfig(bm.type);
                      const Icon = cfg.icon;
                      return (
                        <button
                          key={bm.id}
                          onClick={() => executeBookmark(bm)}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-theme-hover/30 hover:bg-theme-hover/70 border border-theme/10 hover:border-theme/30 transition-all shrink-0 group"
                          title={bm.target}
                        >
                          <Icon className={clsx("w-3.5 h-3.5", cfg.color)} />
                          <span className="text-[11px] font-semibold text-theme-muted group-hover:text-theme-fg transition-colors truncate max-w-[80px]">
                            {bm.name}
                          </span>
                        </button>
                      );
                    })}
                  <button
                    onClick={() => setShowBookmarkEditor(true)}
                    className="flex items-center gap-1 px-2 py-1.5 rounded-xl bg-theme-hover/20 hover:bg-theme-hover/50 border border-dashed border-theme/15 hover:border-primary/40 transition-all shrink-0"
                    title="Edit shortcuts"
                  >
                    <Plus className="w-3 h-3 text-theme-muted" />
                  </button>
                </div>
              )}
            <div
              className={clsx(
                "rounded-[28px] p-1 flex flex-col gap-1 shrink-0",
                translucentMode
                  ? "bg-theme-bg backdrop-blur-xl"
                  : "bg-theme-card",
              )}
            >
              <button
                type="button"
                onClick={() =>
                  nextUp &&
                  window.desktopAPI?.openDashboard?.({ tab: "planner" })
                }
                className={clsx(
                  "flex items-center justify-between gap-3 px-3 py-1 text-left",
                  nextUp &&
                    "cursor-pointer hover:opacity-80 transition-opacity",
                )}
                title={nextUp ? "View in Planner" : undefined}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {nextUp ? (
                    <div
                      className={clsx(
                        "w-5 h-5 rounded-full flex items-center justify-center shrink-0",
                        getNextUpBgColor(nextUp),
                      )}
                    >
                      <NextUpIcon type={nextUp.icon} />
                    </div>
                  ) : connectionStatus === "connecting" ? (
                    <div className="w-3.5 h-3.5 border-2 border-theme-muted/70 border-t-transparent rounded-full animate-spin shrink-0" />
                  ) : (
                    <CheckCircle
                      className={clsx(
                        "w-3.5 h-3.5 shrink-0",
                        connectionStatus === "error"
                          ? "text-red-500"
                          : "text-theme-muted",
                      )}
                    />
                  )}
                  <span
                    className={clsx(
                      "text-[11px] font-bold uppercase tracking-widest truncate",
                      nextUp
                        ? getNextUpTextColor(nextUp)
                        : connectionStatus === "connected"
                          ? "text-theme-muted"
                          : connectionStatus === "connecting"
                            ? "text-amber-700 dark:text-amber-500"
                            : connectionStatus === "error"
                              ? "text-red-600"
                              : "text-theme-muted",
                    )}
                  >
                    {displayStatus}
                  </span>
                </div>
                <span className="text-[11px] font-bold uppercase tracking-widest text-theme-muted truncate max-w-[180px]">
                  {selectedModelLabel}
                </span>
              </button>

              <div className="flex items-center gap-2 bg-theme-hover/50 rounded-[24px] p-1.5 pr-2 focus-within:ring-2 focus-within:ring-primary/10 transition-all border border-theme/5">
                <div className="flex-1 relative rounded-xl transition-all flex items-center">
                  <TextareaAutosize
                    className="w-full bg-transparent outline-none text-[15px] text-theme-fg placeholder:text-theme-muted font-semibold min-w-0 resize-none leading-5 py-2 overflow-y-auto custom-scrollbar px-3"
                    placeholder="Just ask Stuard"
                    value={query}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                      setQuery(e.target.value)
                    }
                    onPaste={onPaste}
                    onKeyDown={(
                      e: React.KeyboardEvent<HTMLTextAreaElement>,
                    ) => {
                      if ((e.nativeEvent as any)?.isComposing) return;
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        onSend();
                      }
                    }}
                    minRows={1}
                    maxRows={3}
                    autoFocus
                  />
                </div>

                <ModelSelector
                  selectedModelId={selectedModelId}
                  onSelectModel={(id) => onChatModeChange?.(id as any)}
                  reasoningLevel={reasoningLevel}
                  onReasoningLevelChange={onReasoningLevelChange}
                  side="top"
                  align="end"
                />

                <button
                  onClick={onMicClick}
                  className={clsx(
                    "h-10 w-10 rounded-[18px] flex items-center justify-center transition-all hover:scale-105 active:scale-95 flex-shrink-0",
                    isRecording
                      ? "bg-red-500 text-white animate-pulse"
                      : "bg-primary text-primary-fg hover:opacity-90",
                  )}
                >
                  <Mic className="w-5 h-5" />
                </button>
              </div>
            </div>
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
