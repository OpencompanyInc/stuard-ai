import React, {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import TextareaAutosize from "react-textarea-autosize";
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  MicOff,
  Mic,
  Plus,
  AtSign,
  Upload,
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
  FolderSearch,
  MessageSquare,
  ListTodo,
  CheckCircle,
  CornerDownLeft,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { VoiceOrb, type VoiceState } from "../../../voice/VoiceOrb";
import type { TranscriptLine, VoiceModeState, VoiceToolEvent } from "../../../../hooks/useVoiceMode";
import { describeTool, friendlyVoiceState } from "../../../voice/voiceLabels";
import type {
  UsePlannerDataResult,
  NextUpItem,
  PlannerTask,
} from "../../../../hooks/usePlannerData";
import { CommandItem } from "../../../CommandPalette";
import { clsx } from "clsx";
import type {
  ChatMode,
  ChatModelsConfig,
  ModelSourcePreference,
  ReasoningLevel,
} from "../../../../hooks/usePreferences";
import { ModelSelector } from "../../../ModelSelector";
import { SidebarTabsPanel } from "../../shared/sidebar/SidebarTabsPanel";
import { ChatTabs } from "../window/parts/ChatTabs";
import { ChatHeaderActions } from "../window/parts/ChatHeaderActions";
import { ChatHeaderMenu } from "../window/parts/ChatHeaderMenu";
import {
  QuickShortcutsGrid,
  BookmarkEditor,
  useBookmarks,
  getTypeConfig,
  type Bookmark,
} from "../../../QuickShortcuts";
import { TasksView, type TaskSubTab } from "../../../TasksView";
import { SuggestedPrompts } from "../../../onboarding/SuggestedPrompts";
import { ContextItem } from "../../../FileNavigator";
import { FileNavigatorOverlay } from "../window/parts/FileNavigatorOverlay";
import { useFileNavigator } from "../../../../hooks/useFileNavigator";
import { CreditsLimitNotice } from "../../shared/CreditsLimitNotice";
import { AttachmentBar } from "../../shared/input/AttachmentBar";

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
  onDrop?: (e: React.DragEvent<HTMLDivElement>) => void;
  attachments?: Array<{ type: "image" | "file"; name: string; mimeType?: string; source?: string }>;
  onAttachFiles?: () => void;
  onAttachImages?: () => void;
  onRemoveAttachment?: (index: number) => void;
  accessToken?: string | null;
  overlayMode?: "compact" | "sidebar" | "window";

  // History Props
  chatMenuOpen: boolean;
  onChatMenuOpenChange: (open: boolean) => void;
  onNewChat: () => void;
  conversations?: Array<{ id: string; title?: string; created_at?: string }>;
  loadingConversations?: boolean;
  activeConversationId?: string | null;
  onSelectConversation?: (id: string) => void;
  onOpenDashboard: () => void;
  onToggleExpand: () => void;
  onCollapse?: () => void;

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
  modelSource?: ModelSourcePreference;
  onModelSourceChange?: (source: ModelSourcePreference) => void;
  reasoningLevel?: ReasoningLevel;
  onReasoningLevelChange?: (level: ReasoningLevel) => void;

  // Tabs
  tabs?: any[];
  activeTabId?: string;
  onSwitchTab?: (id: string) => void;
  onCloseTab?: (id: string) => void;
  onAddTab?: () => void;

  // Internal Sidebar
  activeSidebarTab?: "terminal" | "todo" | "projects";
  internalSidebarWidth?: number;
  onCloseInternalSidebar?: () => void;
  onSwitchSidebarTab?: (tab: "terminal" | "todo" | "projects") => void;
  onInternalSidebarResize?: (deltaX: number) => void;

  // Voice Mode
  voiceActive?: boolean;
  onToggleVoice?: () => void;
  voiceState?: VoiceModeState;
  voiceAudioLevel?: number;
  voiceMuted?: boolean;
  onVoiceMuteToggle?: () => void;
  voiceTranscripts?: TranscriptLine[];
  voiceActiveTool?: string | null;
  voiceActiveTools?: VoiceToolEvent[];
  voiceLastTool?: VoiceToolEvent | null;

  // @ context picker
  contextPaths?: ContextItem[];
  onAddContext?: (item: ContextItem) => void;
  onRemoveContext?: (index: number) => void;

  showCreditsLimitNotice?: boolean;
  onDismissCreditsLimitNotice?: () => void;
  onAddCredits?: () => void;
}

import { NextUpIcon, getNextUpBgColor, getNextUpTextColor } from './NextUp';
import { LauncherGreeting } from './LauncherGreeting';
import { normalizeLauncherSearchText, shouldRunLauncherSemanticSearch } from './search';
import { quickActions } from './quickActions';

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
  onDrop,
  attachments = [],
  onAttachFiles,
  onAttachImages,
  onRemoveAttachment,
  accessToken,
  overlayMode,
  chatMenuOpen,
  onChatMenuOpenChange,
  onNewChat,
  conversations = [],
  loadingConversations = false,
  activeConversationId,
  onSelectConversation = () => {},
  onOpenDashboard,
  onToggleSidebar,
  sidebarOpen = false,
  plannerData,
  translucentMode = false,
  chatMode,
  onChatModeChange,
  chatModels,
  onChatModelsChange,
  modelSource = "stuard",
  onModelSourceChange,
  reasoningLevel,
  onReasoningLevelChange,
  onCollapse,
  tabs = [],
  activeTabId,
  onSwitchTab,
  onCloseTab,
  onAddTab,

  // Internal Sidebar
  activeSidebarTab = "projects",
  internalSidebarWidth = 304,
  onCloseInternalSidebar,
  onSwitchSidebarTab,
  onInternalSidebarResize,

  // Voice
  voiceActive = false,
  onToggleVoice,
  voiceState = "idle",
  voiceAudioLevel = 0,
  voiceMuted = false,
  onVoiceMuteToggle,
  voiceTranscripts = [],
  voiceActiveTool,
  voiceActiveTools = [],
  voiceLastTool = null,
  contextPaths = [],
  onAddContext,
  onRemoveContext,
  showCreditsLimitNotice = false,
  onDismissCreditsLimitNotice,
  onAddCredits,
}) => {
  const {
    showFileNav,
    fileNavFilter,
    fileNavOverlay,
    textareaRef,
    fileNavRef,
    handleFileSelect,
    handleNavigate,
    handleCloseFileNav,
    handleOpenFileNav,
  } = useFileNavigator({ query, setQuery, onAddContext });

  const dragCounterRef = useRef(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current++;
    if (dragCounterRef.current === 1) setIsDragOver(true);
  }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragOver(false);
    }
  }, []);
  const handleDropWrapped = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragOver(false);
    onDrop?.(e);
  }, [onDrop]);

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
          .filter((r: any) => r.source !== "app-discovery" && String(r.kind || "").toLowerCase() !== "application")
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
                ? indexed.results
                    .filter((r: any) => String(r?.kind || "").toLowerCase() !== "application")
                    .slice(0, 8)
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
            body: JSON.stringify({ text: q, model: "google/gemini-embedding-2-preview" }),
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
            Array.isArray(res.results)
              ? res.results
                  .filter((r: any) => String(r?.kind || "").toLowerCase() !== "application")
                  .slice(0, 8)
              : [],
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

  useEffect(() => {
    const api = (window as any).desktopAPI;
    if (!api?.getFilePreview || fileResults.length === 0) return;

    const uniquePaths = (values: string[]) =>
      Array.from(new Set(values.filter(Boolean)));

    const reqId = ++fileIconReqIdRef.current;
    (async () => {
      const updates: Record<string, string> = {};
      await Promise.all(
        fileResults.slice(0, 8).map(async (f: any) => {
          if (String(f?.kind || "").toLowerCase() === "application") return;
          const key = String(f?.path || "").trim();
          if (!key || fileIconCacheRef.current[key]) return;

          const preferThumbnail = String(f?.preview_kind || "icon") === "thumbnail";
          const candidates = preferThumbnail
            ? [key]
            : uniquePaths([
                String(f?.icon_path || "").trim(),
                String(f?.target_path || "").trim(),
                key,
              ]);

          for (const candidate of candidates) {
            try {
              const res = await api.getFilePreview(candidate, {
                size: "normal",
                preferThumbnail,
              });
              if (fileIconReqIdRef.current !== reqId) return;
              if (res?.ok && typeof res.dataUrl === "string" && res.dataUrl) {
                updates[key] = res.dataUrl;
                return;
              }
            } catch {}
          }
        }),
      );

      if (fileIconReqIdRef.current !== reqId) return;
      const keys = Object.keys(updates);
      if (keys.length === 0) return;
      for (const k of keys) fileIconCacheRef.current[k] = updates[k];
      setFileIconDataUrls((prev) => ({ ...prev, ...updates }));
    })();
  }, [fileResults]);

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
        case "files":
          setQuery("@");
          break;
        case "tasks":
          setViewMode("tasks");
          break;
        case "add":
          setShowBookmarkEditor(true);
          break;
        case "chat":
        default:
          setViewMode("chat");
          break;
      }
    },
    [setQuery],
  );

  // Voice status overrides default status when voice is active
  const latestVoiceLine = voiceTranscripts[voiceTranscripts.length - 1];
  const topVoiceTool = voiceActiveTools[voiceActiveTools.length - 1];
  const voiceFriendlyStatus = topVoiceTool
    ? topVoiceTool.label
    : voiceActiveTool
      ? describeTool(voiceActiveTool).label
      : friendlyVoiceState(voiceState as any);
  const voiceFriendlyDetail = topVoiceTool?.detail;
  const voiceStatusText = voiceActive
    ? (voiceActiveTool
        ? `Using ${voiceActiveTool.replace(/_/g, " ")}\u2026`
        : voiceState === "connecting"
          ? "Connecting\u2026"
          : voiceState === "thinking"
            ? "Thinking\u2026"
            : voiceState === "speaking"
              ? "Speaking"
              : voiceState === "listening"
                ? "Listening"
                : "Voice")
    : null;

  const displayStatus = voiceStatusText
    ? voiceStatusText
    : nextUp
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

  const isCompact = overlayMode === "compact";
  const isWindowMode = overlayMode === "window";

  // Shared input pieces — reused by the compact single-row and the window/sidebar
  // two-row layouts so the textarea (and its keydown wiring) lives in one place.
  const inputTextarea = (
    <TextareaAutosize
      ref={textareaRef}
      className={clsx(
        "w-full bg-transparent outline-none text-theme-fg placeholder:text-theme-muted/70 min-w-0 resize-none overflow-y-auto scrollbar-minimal",
        isCompact
          ? "text-[14px] font-normal leading-5 py-1.5 px-1"
          : "text-[14px] font-normal leading-5 py-1 px-1",
      )}
      placeholder="Just ask Stuard"
      value={query}
      onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setQuery(e.target.value)}
      onPaste={onPaste}
      onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if ((e.nativeEvent as any)?.isComposing) return;
        if (showFileNav && fileNavRef.current) {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            fileNavRef.current.moveSelection(1);
            return;
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            fileNavRef.current.moveSelection(-1);
            return;
          }
          if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            fileNavRef.current.selectCurrent();
            return;
          }
          if (e.key === "Escape") {
            e.preventDefault();
            handleCloseFileNav();
            return;
          }
          if (e.key === " ") {
            const added = fileNavRef.current.addCurrent();
            if (added) e.preventDefault();
            return;
          }
        }
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          onSend();
        }
      }}
      minRows={1}
      maxRows={isCompact ? 2 : 4}
      autoFocus
    />
  );

  const attachMenu = (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="w-9 h-9 rounded-[12px] flex items-center justify-center hover:bg-pill-fg/10 transition-colors text-pill-fg/80 hover:text-pill-fg shrink-0"
          title="Attach"
        >
          <Plus className="w-5 h-5" strokeWidth={1.75} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="DropdownContent z-[10005] min-w-[200px] bg-pill-bg rounded-xl border border-pill-fg/10 p-1 shadow-[var(--compact-pill-shadow)]"
          sideOffset={8}
          align="start"
          collisionPadding={10}
        >
          <DropdownMenu.Item
            onSelect={() => handleOpenFileNav()}
            className="group text-[13px] text-pill-fg/90 flex items-center gap-2 px-3 py-2.5 rounded-lg outline-none transition-colors hover:bg-pill-fg/10 cursor-pointer"
          >
            <AtSign className="w-4 h-4 opacity-70" strokeWidth={2.2} />
            <span className="flex-1">Add context</span>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={() => onAttachFiles?.()}
            className={clsx(
              "group text-[13px] text-pill-fg/90 flex items-center gap-2 px-3 py-2.5 rounded-lg outline-none transition-colors",
              onAttachFiles ? "hover:bg-pill-fg/10 cursor-pointer" : "opacity-40 cursor-not-allowed",
            )}
          >
            <FileIcon className="w-4 h-4 opacity-70" />
            <span>Attach files</span>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={() => onAttachImages?.()}
            className={clsx(
              "group text-[13px] text-pill-fg/90 flex items-center gap-2 px-3 py-2.5 rounded-lg outline-none transition-colors",
              onAttachImages ? "hover:bg-pill-fg/10 cursor-pointer" : "opacity-40 cursor-not-allowed",
            )}
          >
            <ImageIcon className="w-4 h-4 opacity-70" />
            <span>Attach images</span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );

  const modelSelectorNode = (
    <ModelSelector
      selectedModelId={selectedModelId}
      onSelectModel={(id) => onChatModeChange?.(id as any)}
      modelSource={modelSource}
      onModelSourceChange={onModelSourceChange}
      reasoningLevel={reasoningLevel}
      onReasoningLevelChange={onReasoningLevelChange}
      side="top"
      align="end"
    />
  );

  return (
    <>
      <FileNavigatorOverlay
        ref={fileNavRef}
        showFileNav={showFileNav}
        fileNavOverlay={fileNavOverlay}
        fileNavFilter={fileNavFilter}
        onSelect={handleFileSelect}
        onClose={handleCloseFileNav}
        onNavigate={handleNavigate}
      />
    <div className="flex h-full min-w-0 overflow-hidden">
      {/* Internal Sidebar - outside main container for proper corner rendering */}
      <SidebarTabsPanel
        isOpen={sidebarOpen}
        onClose={onCloseInternalSidebar || (() => {})}
        activeTab={activeSidebarTab}
        onSwitchTab={onSwitchSidebarTab || (() => {})}
        translucentMode={translucentMode}
        width={internalSidebarWidth}
        onResize={onInternalSidebarResize}
      />

      <div
        className={clsx(
          "flex-1 min-w-0 min-h-0 flex flex-col transition-all duration-300 border border-theme overflow-hidden",
          !isCompact && "launcher-compact-skin",
          isCompact ? "p-1.5" : "p-4",
          sidebarOpen
            ? (isCompact
                ? "rounded-r-2xl rounded-l-none border-l-0"
                : "rounded-r-[32px] rounded-l-none border-l-0")
            : (isCompact ? "rounded-2xl" : "rounded-[32px]"),
          translucentMode
            ? "bg-theme-bg backdrop-blur-2xl"
            : "bg-theme-bg",
        )}
        style={{
          background: translucentMode
            ? "color-mix(in srgb, var(--background) 76%, transparent)"
            : undefined,
          boxShadow: isCompact ? "0 8px 24px rgba(15, 23, 42, 0.10)" : undefined,
        }}
      >
        <div
          className={clsx(
            "flex-1 min-h-0 flex flex-col overflow-hidden",
            isCompact
              ? "rounded-xl p-1"
              : "gap-3",
            isCompact && translucentMode
              ? "bg-theme-bg backdrop-blur-xl"
              : "",
          )}
          style={{
            background: isCompact && translucentMode
              ? "color-mix(in srgb, var(--card-bg) 84%, transparent)"
              : undefined,
          }}
        >
          {/* Top Header */}
          <div
            className={clsx(
              "flex items-center justify-between w-full min-w-0 shrink-0",
              isCompact
                ? "px-2 py-1"
                : "px-0.5",
            )}
          >
            <div className="flex-1 w-0 min-w-0 overflow-hidden mr-2">
              <ChatTabs
                tabs={tabs}
                activeTabId={activeTabId}
                onSwitchTab={onSwitchTab}
                onCloseTab={onCloseTab}
                onAddTab={onAddTab}
              />
            </div>
            {isCompact ? (
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
                activeConversationId={activeConversationId}
                onSelectConversation={onSelectConversation}
                onNewChat={onNewChat}
              />
            ) : (
              <ChatHeaderMenu
                chatMenuOpen={chatMenuOpen}
                onChatMenuOpenChange={onChatMenuOpenChange}
                conversations={conversations}
                loadingConversations={loadingConversations}
                activeConversationId={activeConversationId}
                onSelectConversation={onSelectConversation}
                onNewChat={onNewChat}
                onOpenDashboard={onOpenDashboard}
                onToggleSidebar={onToggleSidebar}
                sidebarOpen={sidebarOpen}
                onCollapse={onCollapse}
              />
            )}
          </div>

          {/* Main Content Area â€” hidden in compact mode (no vertical room) */}
          {!isCompact && (
          <div className="flex-1 min-h-0 flex flex-col overflow-y-auto scrollbar-minimal">
            {viewMode === "tasks" ? (
              <div className="w-full flex-1 min-h-0 overflow-y-auto scrollbar-minimal">
                <TasksView
                  compact
                  defaultSubTab={tasksSubTab}
                  onSubTabChange={setTasksSubTab}
                />
              </div>
            ) : showResults ? (
                  <div className="flex-1 overflow-y-auto scrollbar-minimal pr-1 space-y-2 min-h-0">
                    <button
                      onClick={onSend}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-[14px] hover:bg-theme-active transition-colors group border border-theme bg-theme-card text-left"
                    >
                      <div className="w-7 h-7 rounded-[10px] bg-primary/15 flex items-center justify-center shrink-0">
                        <MessageSquare className="w-3.5 h-3.5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-semibold text-theme-fg">
                          Ask Stuard
                        </div>
                        <div className="text-[11px] text-theme-muted truncate">
                          Get an AI assistant response
                        </div>
                      </div>
                      <span className="text-[10px] font-semibold text-theme-muted bg-theme-active px-2 py-1 rounded-md shrink-0">
                        Enter
                      </span>
                    </button>

                    {/* Apps â€” always first */}
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
                                <div
                                  className={clsx(
                                    "w-7 h-7 rounded-lg flex items-center justify-center",
                                    iconUrl
                                      ? "bg-transparent border-transparent"
                                      : "bg-blue-500/10 text-blue-500 border border-theme/20",
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

                    {/* Files â€” after apps */}
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
                              f?.path ? fileIconDataUrls[String(f.path)] : undefined;
                            const isThumbnail =
                              String(f?.preview_kind || "icon") === "thumbnail";
                            return (
                              <button
                                key={f.path}
                                onClick={() => handleOpenIndexedFile(f.path)}
                                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-theme-hover transition-all group/file text-left border border-transparent hover:border-theme/30"
                              >
                                <div
                                  className={clsx(
                                    "w-7 h-7 rounded-lg flex items-center justify-center",
                                    iconUrl
                                      ? "bg-transparent border-transparent"
                                      : [cfg.bg, cfg.color, "border border-theme/20"],
                                    isThumbnail && "overflow-hidden",
                                  )}
                                >
                                  {iconUrl ? (
                                    <img
                                      src={iconUrl}
                                      alt=""
                                      loading="lazy"
                                      className={clsx(
                                        isThumbnail
                                          ? "w-full h-full object-cover"
                                          : "w-5 h-5 object-contain",
                                      )}
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
            ) : (
              <LauncherGreeting
                accessToken={accessToken}
                onSelectSuggestion={setQuery}
              />
            )}
          </div>
          )}

          {/* Bottom Input Area - Integrated into the single card */}
          <div
            className={clsx(
              "shrink-0 w-full mt-auto flex flex-col gap-2",
              isCompact ? "px-1.5 pb-1" : "w-full",
            )}
          >
            <button
              type="button"
              onClick={() =>
                nextUp &&
                window.desktopAPI?.openDashboard?.({ tab: "planner" })
              }
              className={clsx(
                "input-status-float text-left justify-start",
                nextUp &&
                  "cursor-pointer hover:opacity-90 transition-opacity",
              )}
              title={nextUp ? "View in Planner" : undefined}
            >
              <div className="flex items-center gap-2 min-w-0">
                {nextUp ? (
                  <div
                    className={clsx(
                      "rounded-full flex items-center justify-center shrink-0",
                      isCompact ? "w-3.5 h-3.5" : "w-5 h-5",
                      getNextUpBgColor(nextUp),
                    )}
                  >
                    <NextUpIcon type={nextUp.icon} />
                  </div>
                ) : connectionStatus === "connecting" ? (
                  <div className="w-3 h-3 border-2 border-theme-muted/70 border-t-transparent rounded-full animate-spin shrink-0" />
                ) : connectionStatus === "error" ? (
                  <span
                    className={clsx(
                      "rounded-full shrink-0 bg-red-500",
                      isCompact ? "w-1.5 h-1.5" : "w-2 h-2",
                    )}
                  />
                ) : voiceActive ? (
                  <span
                    className={clsx(
                      "rounded-full shrink-0 bg-emerald-500 animate-pulse",
                      isCompact ? "w-1.5 h-1.5" : "w-2 h-2",
                    )}
                  />
                ) : null}
                <span
                  className={clsx(
                    "truncate",
                    isCompact
                      ? "text-[10px] font-medium tracking-wide"
                      : "text-[11px] font-bold uppercase tracking-widest",
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
            </button>

            <div
              className={clsx(
                "flex flex-col shrink-0 relative",
                isCompact
                  ? "gap-0.5"
                  : clsx(
                      "launcher-input-surface rounded-[16px] p-2.5 gap-1.5 border border-theme/20",
                      translucentMode
                        ? "bg-theme-bg/80 backdrop-blur-xl"
                        : "bg-theme-input",
                      isDragOver && "ring-2 ring-primary/50 ring-offset-1 ring-offset-transparent",
                    ),
              )}
              onDragOver={(e) => {
                e.preventDefault();
                try { e.dataTransfer.dropEffect = "copy"; } catch { }
              }}
              onDragEnter={onDrop ? handleDragEnter : undefined}
              onDragLeave={onDrop ? handleDragLeave : undefined}
              onDrop={onDrop ? handleDropWrapped : undefined}
            >
              {!isCompact && isDragOver && (
                <div className="absolute inset-0 z-50 rounded-[16px] bg-primary/10 border-2 border-dashed border-primary/40 flex items-center justify-center pointer-events-none">
                  <div className="flex items-center gap-2 text-primary font-semibold text-sm">
                    <Upload className="w-5 h-5" />
                    <span>Drop files, images, or links here</span>
                  </div>
                </div>
              )}
              <CreditsLimitNotice
                open={showCreditsLimitNotice}
                onDismiss={onDismissCreditsLimitNotice || (() => {})}
                onAddCredits={onAddCredits || onOpenDashboard}
              />

              {voiceActive ? (
                <motion.div layout className="flex flex-col gap-1.5 relative">
                  {/* Audio-reactive halo behind the strip */}
                  <motion.div
                    aria-hidden
                    className="pointer-events-none absolute inset-0 -z-10 rounded-[30px]"
                    animate={{
                      boxShadow: voiceState === "listening"
                        ? `0 0 ${24 + voiceAudioLevel * 32}px rgba(56,189,248,0.22), 0 0 ${48 + voiceAudioLevel * 28}px rgba(56,189,248,0.18)`
                        : voiceState === "speaking"
                          ? `0 0 ${28 + voiceAudioLevel * 32}px rgba(167,139,250,0.24), 0 0 ${56 + voiceAudioLevel * 28}px rgba(167,139,250,0.18)`
                          : voiceState === "thinking"
                            ? "0 0 28px rgba(251,191,36,0.22), 0 0 56px rgba(251,191,36,0.18)"
                            : "0 0 24px rgba(99,102,241,0.18), 0 0 48px rgba(99,102,241,0.14)",
                    }}
                    transition={{ duration: 0.4, ease: "easeOut" }}
                  />
                  <motion.div
                    layout
                    className={clsx(
                      "flex items-center gap-2 transition-colors duration-300 backdrop-blur-xl",
                      isCompact
                        ? "bg-theme-hover/50 rounded-xl px-2 py-1 border border-theme/15"
                        : "bg-theme-hover/55 rounded-[14px] p-1.5 pr-2 border border-theme/10",
                    )}
                  >
                    <motion.div
                      layout
                      initial={{ scale: 0.85 }}
                      animate={{ scale: 1 }}
                      transition={{ type: "spring", stiffness: 380, damping: 28 }}
                      className="flex-shrink-0 flex items-center justify-center"
                      style={{ width: isCompact ? 32 : 40, height: isCompact ? 32 : 40 }}
                    >
                      <VoiceOrb
                        state={(voiceState === "connecting" ? "thinking" : voiceState) as VoiceState}
                        audioLevel={voiceAudioLevel}
                        size={isCompact ? 32 : 40}
                      />
                    </motion.div>
                    <div className="flex-1 min-w-0 px-1 flex flex-col justify-center">
                      <AnimatePresence mode="wait">
                        {latestVoiceLine?.text ? (
                          <motion.p
                            key={`t-${latestVoiceLine.id}`}
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -3 }}
                            transition={{ duration: 0.18 }}
                            className={clsx(
                              "leading-snug truncate",
                              isCompact ? "text-[12px]" : "text-[13px]",
                              latestVoiceLine.role === "user"
                                ? "text-theme-fg font-medium"
                                : "text-theme-fg/70 italic",
                              !latestVoiceLine.isFinal && "opacity-70",
                            )}
                          >
                            {latestVoiceLine.text}
                          </motion.p>
                        ) : (
                          <motion.div
                            key={`s-${voiceFriendlyStatus}-${voiceFriendlyDetail || ""}`}
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -3 }}
                            transition={{ duration: 0.22 }}
                            className="flex items-center gap-1.5 min-w-0"
                          >
                            {(topVoiceTool || voiceActiveTool) && (
                              <Loader2 size={11} className="animate-spin text-theme-muted flex-shrink-0" />
                            )}
                            <span
                              className={clsx(
                                "text-theme-fg/85 font-medium tracking-wide truncate",
                                isCompact ? "text-[11.5px]" : "text-[13px]",
                              )}
                            >
                              {voiceFriendlyStatus}
                            </span>
                            {voiceFriendlyDetail && (
                              <span
                                className={clsx(
                                  "text-theme-muted truncate",
                                  isCompact ? "text-[10.5px]" : "text-[12px]",
                                )}
                              >
                                {voiceFriendlyDetail}
                              </span>
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                    <button
                      onClick={onVoiceMuteToggle}
                      title={voiceMuted ? "Unmute" : "Mute"}
                      className={clsx(
                        "rounded-lg flex items-center justify-center transition-all flex-shrink-0",
                        isCompact ? "h-7 w-7" : "h-9 w-9 rounded-[16px]",
                        voiceMuted
                          ? "bg-red-500/15 text-red-500"
                          : "text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60",
                      )}
                    >
                      {voiceMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      onClick={onToggleVoice}
                      title="Exit voice mode"
                      className={clsx(
                        "rounded-lg flex items-center justify-center text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60 transition-all flex-shrink-0",
                        isCompact ? "h-7 w-7" : "h-9 w-9 rounded-[16px]",
                      )}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </motion.div>

                  <AnimatePresence>
                    {voiceActiveTools.length > 0 && (
                      <motion.div
                        key="lv-tool-rail"
                        initial={{ opacity: 0, y: -4, height: 0 }}
                        animate={{ opacity: 1, y: 0, height: "auto" }}
                        exit={{ opacity: 0, y: -4, height: 0 }}
                        transition={{ duration: 0.25, ease: "easeOut" }}
                        className="overflow-hidden"
                      >
                        <div className="flex flex-wrap gap-1.5 px-1">
                          {voiceActiveTools.map((t) => (
                            <motion.div
                              key={t.callId}
                              layout
                              initial={{ opacity: 0, scale: 0.9, y: 4 }}
                              animate={{ opacity: 1, scale: 1, y: 0 }}
                              exit={{ opacity: 0, scale: 0.9, y: -4 }}
                              transition={{ duration: 0.2 }}
                              className="inline-flex items-center gap-1.5 rounded-full border border-theme/15 bg-theme-hover/60 backdrop-blur-md px-2.5 py-1 shadow-sm"
                            >
                              {t.name === "delegate" ? (
                                <Sparkles size={10} className="text-violet-500/80" />
                              ) : (
                                <Loader2 size={10} className="animate-spin text-theme-muted" />
                              )}
                              <span className="text-[11px] text-theme-fg/85 font-medium tracking-wide">
                                {t.label}
                              </span>
                              {t.detail && (
                                <span className="text-[10.5px] text-theme-muted truncate max-w-[160px]">
                                  {t.detail}
                                </span>
                              )}
                            </motion.div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {!isCompact && onRemoveAttachment && (
                    <AttachmentBar
                      attachments={attachments}
                      contextPaths={contextPaths}
                      onRemoveAttachment={onRemoveAttachment}
                      onRemoveContext={(idx) => onRemoveContext?.(idx)}
                    />
                  )}
                  {isCompact && contextPaths.length > 0 && (
                    <div className="flex flex-wrap gap-1 px-1">
                      {contextPaths.map((ctx, idx) => {
                        const Icon = ctx.type === "bot"
                          ? Sparkles
                          : ctx.isDirectory
                            ? Folder
                            : FileIcon;
                        return (
                          <span
                            key={`lc-${idx}-${ctx.path}`}
                            className="group inline-flex items-center gap-1 pl-1.5 pr-1 py-0.5 bg-theme-hover/60 hover:bg-theme-active rounded-md text-[11px] text-theme-fg border border-theme/10 max-w-[200px]"
                            title={ctx.path}
                          >
                            <Icon className="w-3 h-3 shrink-0 text-theme-muted" strokeWidth={2} />
                            <span className="truncate font-semibold">{ctx.name}</span>
                            {onRemoveContext && (
                              <button
                                type="button"
                                onClick={() => onRemoveContext(idx)}
                                className="ml-0.5 text-theme-muted hover:text-theme-fg hover:bg-theme-card rounded-sm p-0.5 transition-colors opacity-60 group-hover:opacity-100"
                                title={`Remove ${ctx.name}`}
                              >
                                <X className="w-2.5 h-2.5" strokeWidth={2.5} />
                              </button>
                            )}
                          </span>
                        );
                      })}
                    </div>
                  )}
                <div
                  className={clsx(
                    "flex flex-col transition-all",
                    isCompact
                      ? "gap-1 bg-theme-hover/40 rounded-xl px-2 py-1.5 border border-theme/10 focus-within:border-primary/30 focus-within:bg-theme-hover/60"
                      : "gap-1.5 px-0.5",
                  )}
                >
                  <div className="min-w-0 w-full">
                    <TextareaAutosize
                      ref={textareaRef}
                      className={clsx(
                        "w-full bg-transparent outline-none text-theme-fg placeholder:text-theme-muted/80 min-w-0 resize-none overflow-y-auto scrollbar-minimal",
                        isCompact
                          ? "text-[14px] font-normal leading-5 py-1 px-1"
                          : "text-[14px] font-normal leading-5 py-1 px-2",
                      )}
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
                        if (showFileNav && fileNavRef.current) {
                          if (e.key === "ArrowDown") {
                            e.preventDefault();
                            fileNavRef.current.moveSelection(1);
                            return;
                          }
                          if (e.key === "ArrowUp") {
                            e.preventDefault();
                            fileNavRef.current.moveSelection(-1);
                            return;
                          }
                          if (e.key === "Enter" || e.key === "Tab") {
                            e.preventDefault();
                            fileNavRef.current.selectCurrent();
                            return;
                          }
                          if (e.key === "Escape") {
                            e.preventDefault();
                            handleCloseFileNav();
                            return;
                          }
                          if (e.key === " ") {
                            const added = fileNavRef.current.addCurrent();
                            if (added) e.preventDefault();
                            return;
                          }
                        }
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          onSend();
                        }
                      }}
                      minRows={1}
                      maxRows={isCompact ? 2 : 3}
                      autoFocus
                    />
                  </div>

                  <div className="flex items-center gap-2 w-full min-w-0">
                  {!isCompact && (
                    <DropdownMenu.Root>
                      <DropdownMenu.Trigger asChild>
                        <button
                          type="button"
                          className="w-9 h-9 rounded-[12px] flex items-center justify-center hover:bg-pill-fg/10 transition-colors text-pill-fg/80 hover:text-pill-fg shrink-0"
                          title="Attach"
                        >
                          <Plus className="w-5 h-5" strokeWidth={1.75} />
                        </button>
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Portal>
                        <DropdownMenu.Content
                          className="DropdownContent z-[10005] min-w-[200px] bg-pill-bg rounded-xl border border-pill-fg/10 p-1 shadow-[var(--compact-pill-shadow)]"
                          sideOffset={8}
                          align="start"
                          collisionPadding={10}
                        >
                          <DropdownMenu.Item
                            onSelect={() => handleOpenFileNav()}
                            className="group text-[13px] text-pill-fg/90 flex items-center gap-2 px-3 py-2.5 rounded-lg outline-none transition-colors hover:bg-pill-fg/10 cursor-pointer"
                          >
                            <AtSign className="w-4 h-4 opacity-70" strokeWidth={2.2} />
                            <span className="flex-1">Add context</span>
                          </DropdownMenu.Item>
                          <DropdownMenu.Item
                            onSelect={() => onAttachFiles?.()}
                            className={clsx(
                              "group text-[13px] text-pill-fg/90 flex items-center gap-2 px-3 py-2.5 rounded-lg outline-none transition-colors",
                              onAttachFiles ? "hover:bg-pill-fg/10 cursor-pointer" : "opacity-40 cursor-not-allowed",
                            )}
                          >
                            <FileIcon className="w-4 h-4 opacity-70" />
                            <span>Attach files</span>
                          </DropdownMenu.Item>
                          <DropdownMenu.Item
                            onSelect={() => onAttachImages?.()}
                            className={clsx(
                              "group text-[13px] text-pill-fg/90 flex items-center gap-2 px-3 py-2.5 rounded-lg outline-none transition-colors",
                              onAttachImages ? "hover:bg-pill-fg/10 cursor-pointer" : "opacity-40 cursor-not-allowed",
                            )}
                          >
                            <ImageIcon className="w-4 h-4 opacity-70" />
                            <span>Attach images</span>
                          </DropdownMenu.Item>
                        </DropdownMenu.Content>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Root>
                  )}
                  <div className="ml-auto flex items-center gap-2 shrink-0">
                  <ModelSelector
                    selectedModelId={selectedModelId}
                    onSelectModel={(id) => onChatModeChange?.(id as any)}
                    modelSource={modelSource}
                    onModelSourceChange={onModelSourceChange}
                    reasoningLevel={reasoningLevel}
                    onReasoningLevelChange={onReasoningLevelChange}
                    side="top"
                    align="end"
                  />

                  {!isCompact && query.trim() && (
                    <button
                      type="button"
                      onClick={onSend}
                      title="Send"
                      aria-label="Send message"
                      className="h-9 w-9 rounded-[12px] flex items-center justify-center transition-all hover:scale-105 active:scale-95 flex-shrink-0 bg-primary text-primary-fg hover:opacity-90"
                    >
                      <CornerDownLeft className="w-4 h-4" />
                    </button>
                  )}
                  </div>
                  </div>
                </div>
                </div>
              )}
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
    </>
  );
};
