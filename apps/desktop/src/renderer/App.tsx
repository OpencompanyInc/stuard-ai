import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import posthog from "posthog-js";
import "katex/dist/katex.min.css"; // Global Katex styles
import { useAgent } from "./hooks/useAgent";
import CommandPalette, { type CommandItem } from "./components/CommandPalette";
import HotkeysHelp from "./components/HotkeysHelp";
import { PermissionDialog } from "./components/PermissionDialog";
import InputArea from "./components/InputArea";
import type { ContextItem } from "./components/FileNavigator";
import { usePreferences } from "./hooks/usePreferences";
import { useModelRegistry } from "./hooks/useModelRegistry";
import "simplebar-react/dist/simplebar.min.css";
import "./scrollbar.css";
import { supabase } from "./lib/supabaseClient";
import { startBrowserSignIn } from "./auth/browserSignIn";
import { fetchRendererSyncPrefs } from "./utils/syncPrefs";
import OnboardingFlow from "./components/onboarding/OnboardingFlow";
import {
  OnboardingProvider,
  OnboardingTooltipContainer,
} from "./components/onboarding";
import EnvironmentBadge from "./components/EnvironmentBadge";
import { WorkflowOverlay } from "./components/WorkflowOverlay/WorkflowOverlay";
import {
  NotificationProvider,
  NotificationController,
} from "./components/NotificationSystem";

import { useSpeechToText } from "./hooks/useSpeechToText";
import { usePlannerData } from "./hooks/usePlannerData";
import { LauncherView } from "./components/LauncherView";
import { ChatView } from "./components/ChatView";
import {
  Mic,
  Plus,
  Layout,
  LayoutGrid,
  Maximize2,
  Minimize2,
  File,
  Image,
  Keyboard,
  RefreshCw,
  Power,
  Smile,
  MessageSquare,
  LogIn,
  Search,
  Globe,
  Zap,
  CloudDownload,
  ExternalLink,
  NotebookPen,
  Terminal,
  AppWindow,
} from "lucide-react";

import { useWorkflows } from "./workflows/hooks/useWorkflows";
import { agentFetchJson, resolveAgentEndpoints } from "./utils/agentEndpoints";
import { getMarketplaceApi } from "./utils/cloud";
import { getLatestAssistantContext } from "./utils/contextUsage";

export default function App() {
  // Refs
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const committedSpeechRef = useRef("");

  // State
  const [query, setQuery] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const {
    onboardingComplete,
    setOnboardingComplete,
    tourComplete,
    setTourComplete,
    tone,
    setTone,
    customTone,
    themeMode,
    setThemeMode,
    themeDarkShade,
    setThemeDarkShade,
    themeLightShade,
    setThemeLightShade,
    themeText,
    setThemeText,
    translucentMode,
    persona,
    wakewordEnabled,
    chatMode: defaultChatMode,
    chatModels: defaultChatModels,
  } = usePreferences();
  const { modelById } = useModelRegistry();
  const [reasoningLevel, setReasoningLevel] = useState<
    import("./hooks/usePreferences").ReasoningLevel
  >(() => {
    try {
      const v = localStorage.getItem("stuard.pref.reasoning_level");
      return v === "low" || v === "medium" ? v : "high";
    } catch {
      return "high";
    }
  });
  // Persist reasoning level
  useEffect(() => {
    try {
      localStorage.setItem("stuard.pref.reasoning_level", reasoningLevel);
    } catch {}
  }, [reasoningLevel]);
  const [showPalette, setShowPalette] = useState(false);
  const [showHotkeys, setShowHotkeys] = useState(false);
  const [updateState, setUpdateState] = useState<{
    status: string;
    info?: any;
  }>({ status: "idle" });

  // Workflows & Marketplace Search
  const { items: localWorkflows, refresh: refreshWorkflows } = useWorkflows();
  const [paletteQuery, setPaletteQuery] = useState("");
  const [marketplaceResults, setMarketplaceResults] = useState<CommandItem[]>(
    [],
  );
  const [paletteAppResults, setPaletteAppResults] = useState<CommandItem[]>([]);
  const [isMarketplaceSearching, setMarketplaceSearching] = useState(false);
  const [isPaletteAppSearching, setPaletteAppSearching] = useState(false);
  const marketplaceDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const paletteAppDebounceRef = useRef<NodeJS.Timeout | null>(null);

  // Marketplace Search Effect
  useEffect(() => {
    if (!showPalette) {
      setPaletteQuery("");
      setMarketplaceResults([]);
      return;
    }

    const q = paletteQuery.trim();
    if (!q || q.length < 2) {
      setMarketplaceResults([]);
      setMarketplaceSearching(false);
      return;
    }

    if (marketplaceDebounceRef.current)
      clearTimeout(marketplaceDebounceRef.current);

    setMarketplaceSearching(true);
    marketplaceDebounceRef.current = setTimeout(async () => {
      try {
        // Search marketplace
        const token = accessToken; // Use current access token if available
        const api = getMarketplaceApi(() => token);
        const res = await api.search({ query: q, limit: 5 });

        if (res.ok && res.results) {
          const items: CommandItem[] = res.results.map((w) => ({
            id: `market-${w.slug}`,
            title: w.name,
            description: w.description,
            group: "Marketplace",
            icon: <CloudDownload className="w-5 h-5" />,
            run: () => {
              window.desktopAPI.openWorkflows({ marketplaceSlug: w.slug });
            },
          }));
          setMarketplaceResults(items);
        }
      } catch (err) {
        console.error("Marketplace search failed", err);
      } finally {
        setMarketplaceSearching(false);
      }
    }, 500); // 500ms debounce

    return () => {
      if (marketplaceDebounceRef.current)
        clearTimeout(marketplaceDebounceRef.current);
    };
  }, [paletteQuery, showPalette, accessToken]);

  useEffect(() => {
    if (!showPalette) {
      setPaletteAppResults([]);
      setPaletteAppSearching(false);
      return;
    }

    const q = paletteQuery.trim();
    if (!q || q.length < 2) {
      setPaletteAppResults([]);
      setPaletteAppSearching(false);
      return;
    }

    if (paletteAppDebounceRef.current)
      clearTimeout(paletteAppDebounceRef.current);

    setPaletteAppSearching(true);
    paletteAppDebounceRef.current = setTimeout(async () => {
      try {
        const desktopApi = (window as any).desktopAPI;
        const res = await desktopApi?.unifiedSearch?.(q, {
          limit: 6,
          includeApps: true,
          includeFiles: false,
        });

        if (res?.ok && Array.isArray(res.results)) {
          const items: CommandItem[] = res.results
            .filter((item: any) => item?.source === "app-discovery")
            .slice(0, 6)
            .map((item: any) => ({
              id: `app-${String(item.launchTarget || item.path || item.name || Math.random())}`,
              title: String(item.name || item.display_name || "Application"),
              description: String(item.path || item.launchTarget || "Launch application"),
              group: "Applications",
              icon: <AppWindow className="w-5 h-5" />,
              run: async () => {
                try {
                  await desktopApi?.launchApp?.(item.launchTarget || item.path);
                } catch {}
              },
            }));
          setPaletteAppResults(items);
        } else {
          setPaletteAppResults([]);
        }
      } catch {
        setPaletteAppResults([]);
      } finally {
        setPaletteAppSearching(false);
      }
    }, 150);

    return () => {
      if (paletteAppDebounceRef.current)
        clearTimeout(paletteAppDebounceRef.current);
    };
  }, [paletteQuery, showPalette]);

  // UI State
  const [overlayMode, setOverlayMode] = useState<
    "compact" | "sidebar" | "window"
  >("compact");
  const [windowSize, setWindowSize] = useState({ width: 520, height: 130 });
  const [chatMenuOpen, setChatMenuOpen] = useState(false);
  const [conversationTitle, setConversationTitle] = useState<string | null>(
    null,
  );
  const [convList, setConvList] = useState<any[]>([]);
  const [loadingConvs, setLoadingConvs] = useState(false);
  const [attachments, setAttachments] = useState<
    Array<{
      type: "image" | "file";
      name: string;
      data: string;
      mimeType: string;
    }>
  >([]);
  const [approvalPrompt, setApprovalPrompt] = useState<{
    id: string;
    tool: string;
    args?: Record<string, any>;
    description?: string;
  } | null>(null);
  const activePermissionNotifsRef = useRef<Set<string>>(new Set());
  const [contextPaths, setContextPaths] = useState<ContextItem[]>([]);
  const [showMiniOutput, setShowMiniOutput] = useState(true);
  const activeConversationIdRef = useRef<string | null>(null);

  const overlayModeRef = useRef<"compact" | "sidebar" | "window">(overlayMode);
  const prevOverlayModeRef = useRef<"compact" | "sidebar" | "window">(
    overlayMode,
  );
  const modeBeforeDockRef = useRef<"compact" | "sidebar" | "window">("compact");

  useEffect(() => {
    overlayModeRef.current = overlayMode;
  }, [overlayMode]);

  useEffect(() => {
    const prev = prevOverlayModeRef.current;
    if (
      (overlayMode === "sidebar" || overlayMode === "window") &&
      prev !== "sidebar" &&
      prev !== "window"
    ) {
      modeBeforeDockRef.current = prev;
    }
    prevOverlayModeRef.current = overlayMode;
  }, [overlayMode]);

  // Reasoning/Thinking time tracking
  const [thinkingStartTime, setThinkingStartTime] = useState<
    number | undefined
  >(undefined);

  // Handle title updates from server - update conversation list in place
  const handleTitleUpdate = useCallback((cid: string, title: string) => {
    setConvList((prev) => {
      const exists = prev.some((c) => String(c.id) === String(cid));
      if (exists) {
        // Update existing conversation title
        return prev.map((c) =>
          String(c.id) === String(cid) ? { ...c, title } : c,
        );
      } else {
        // Add new conversation to the top of the list
        return [
          { id: cid, title, created_at: new Date().toISOString() },
          ...prev,
        ];
      }
    });
    if (String(activeConversationIdRef.current || "") === String(cid)) {
      setConversationTitle(title);
    }
  }, []);

  // Agent Hook
  const {
    messages,
    state,
    ai,
    currentResponse,
    currentReasoning,
    currentToolCalls,
    currentStreamChunks,
    sendMessage,
    stopGeneration,
    conversationId,
    newChat,
    loadConversation,
    deleteConversation,
    subscribeProgress,
    queueDepth,
    queuedMessages,
    cancelQueuedMessage,
    respondToApproval,
    lastError,
    execLocalTool,
    submitToolOutput,
    tabs,
    activeTabId,
    addTab,
    closeTab,
    switchTab,
    chatMode,
    setChatMode,
    chatModels,
    setChatModels,
    pendingMemories,
    confirmPendingMemory,
    rejectPendingMemory,
    editMessage,
    revertFiles,
    activeGenUITools,
    respondToGenUI,
    liveUsage,
  } = useAgent({
    onTitleUpdate: handleTitleUpdate,
    initialChatMode: defaultChatMode,
    initialChatModels: defaultChatModels,
  }) as any;

  useEffect(() => {
    activeConversationIdRef.current = conversationId || null;
  }, [conversationId]);

  // Speech Hook
  const {
    isRecording,
    transcript,
    interimTranscript,
    startRecording,
    stopRecording,
    clearTranscript,
    error: speechError,
  } = useSpeechToText();

  // Planner Hook
  const plannerData = usePlannerData(accessToken);

  const latestAgentContext = useMemo(
    () => getLatestAssistantContext(messages as any[]),
    [messages],
  );

  // Use live usage when streaming, fall back to last committed message usage
  const effectiveContextUsage = liveUsage
    ? { promptTokens: liveUsage.promptTokens, contextWindow: liveUsage.contextWindow }
    : latestAgentContext.usage;
  const effectiveContextModelId = liveUsage?.modelId || latestAgentContext.modelId;

  // Track when reasoning/thinking starts
  useEffect(() => {
    if (currentReasoning && !currentResponse && !thinkingStartTime) {
      setThinkingStartTime(Date.now());
    } else if (!currentReasoning || currentResponse) {
      setThinkingStartTime(undefined);
    }
  }, [currentReasoning, currentResponse, thinkingStartTime]);

  // --- Effects ---

  // Focus input on show
  useEffect(() => {
    // Safety check for API
    if (!window.desktopAPI) return;

    const unsubShow = window.desktopAPI.onShow(() => {
      setShowMiniOutput(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    });

    // Listen for open-chat requests (e.g. from Dashboard)
    const unsubOpen = window.desktopAPI.onOpenChat?.((id: string) => {
      if (id) {
        setOverlayMode("window");
        window.desktopAPI.setMode("window");
        loadConversation(id);
      }
    });
    return () => {
      try {
        unsubShow?.();
      } catch {}
      try {
        unsubOpen && unsubOpen();
      } catch {}
    };
  }, []);

  // Listen for chat messages from browser extension
  useEffect(() => {
    const unsub = (window as any).desktopAPI?.onBrowserExtensionChat?.(
      (data: { text: string; messageId: string; pageContext?: any }) => {
        if (data?.text) {
          // Inject page context into the message
          const contextNote = data.pageContext?.url
            ? `\n\n[Browser context: ${data.pageContext.title || ""} — ${data.pageContext.url}]`
            : "";
          sendMessage({
            text: data.text + contextNote,
            context: data.pageContext ? { browserPage: data.pageContext } : {},
          });
        }
      },
    );
    return () => {
      try {
        unsub?.();
      } catch {}
    };
  }, [sendMessage]);

  // Listen for resize events from main process
  useEffect(() => {
    const unsubResizing = window.desktopAPI?.onResizing?.((data) => {
      setWindowSize({ width: data.width, height: data.height });
    });
    const unsubResized = window.desktopAPI?.onResized?.((data) => {
      setWindowSize({ width: data.width, height: data.height });
    });
    const unsubModeChanged = window.desktopAPI?.onModeChanged?.((data) => {
      setOverlayMode(data.mode as any);
      setWindowSize({ width: data.width, height: data.height });
      // Close internal sidebar when switching to compact mode
      if (data.mode === "compact") {
        setInternalSidebarOpen(false);
      }
    });

    // Listen for internal sidebar state changes from main process
    const unsubInternalSidebar = (
      window.desktopAPI as any
    )?.onInternalSidebarChanged?.((data: { open: boolean; width: number }) => {
      setInternalSidebarOpen(data.open);
      setWindowSize((prev) => ({ ...prev, width: data.width }));
    });

    // Get initial size and internal sidebar state
    window.desktopAPI
      ?.getSize?.()
      .then((size: any) => {
        if (size) {
          setWindowSize({ width: size.width, height: size.height });
          setOverlayMode(size.mode as any);
        }
      })
      .catch(() => {});

    (window.desktopAPI as any)
      ?.getInternalSidebarState?.()
      .then((state: { open: boolean }) => {
        if (state && typeof state.open === "boolean") {
          setInternalSidebarOpen(state.open);
        }
      })
      .catch(() => {});

    return () => {
      try {
        unsubResizing?.();
      } catch {}
      try {
        unsubResized?.();
      } catch {}
      try {
        unsubModeChanged?.();
      } catch {}
      try {
        unsubInternalSidebar?.();
      } catch {}
    };
  }, []);

  // Theme sync
  useEffect(() => {
    const unsub = (window as any).desktopAPI?.onThemeUpdated?.((data: any) => {
      try {
        const m = data?.themeMode;
        if (
          m === "light" ||
          m === "dark" ||
          m === "custom" ||
          m === "default"
        ) {
          setThemeMode(m === "default" ? "light" : m);
        }
        if (typeof data?.themeDarkShade === "string")
          setThemeDarkShade(data.themeDarkShade);
        if (typeof data?.themeLightShade === "string")
          setThemeLightShade(data.themeLightShade);
        if (data?.themeText === "white" || data?.themeText === "black")
          setThemeText(data.themeText);
      } catch {}
    });
    return () => {
      try {
        typeof unsub === "function" && unsub();
      } catch {}
    };
  }, [setThemeMode, setThemeDarkShade, setThemeLightShade, setThemeText]);

  // Apply theme to document element
  useEffect(() => {
    const root = document.documentElement;
    if (themeMode === "dark" || themeMode === "custom") {
      root.setAttribute("data-theme", "dark");
      root.classList.add("dark");
    } else {
      root.setAttribute("data-theme", "light");
      root.classList.remove("dark");
    }

    // Apply custom theme colors if in custom mode
    if (themeMode === "custom") {
      root.style.setProperty("--custom-gradient-start", themeDarkShade);
      root.style.setProperty("--custom-gradient-end", themeLightShade);
      root.style.setProperty(
        "--custom-text-color",
        themeText === "white" ? "#ffffff" : "#000000",
      );
    } else {
      root.style.removeProperty("--custom-gradient-start");
      root.style.removeProperty("--custom-gradient-end");
      root.style.removeProperty("--custom-text-color");
    }

    // Also broadcast theme change to other windows if needed
    try {
      (window as any).desktopAPI?.broadcastTheme?.({
        themeMode,
        themeDarkShade,
        themeLightShade,
        themeText,
      });
    } catch {}
  }, [themeMode, themeDarkShade, themeLightShade, themeText]);

  // Listen for permission responses from the notification overlay window
  useEffect(() => {
    const unsub = (window as any).desktopAPI?.onPermissionResponse?.(
      (data: { id: string; allow: boolean }) => {
        if (!data?.id) return;
        respondToApproval(data.id, data.allow);
        activePermissionNotifsRef.current.delete(data.id);
        setApprovalPrompt((curr) =>
          curr && curr.id === data.id ? null : curr,
        );
      },
    );
    return () => {
      try {
        unsub?.();
      } catch {}
    };
  }, [respondToApproval]);

  // Open onboarding wizard window when not complete, hide overlay to show only wizard
  useEffect(() => {
    if (!onboardingComplete) {
      // Small delay to ensure window is ready and visible before opening onboarding
      const timer = setTimeout(() => {
        try {
          window.desktopAPI.openOnboarding();
          // window.desktopAPI.hide(); // Keep overlay visible so we don't lose context
        } catch {}
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [onboardingComplete]);

  // Show tour in overlay after wizard is done (legacy)
  const showTour = onboardingComplete && !tourComplete;

  // Ensure overlay is shown when tour starts
  useEffect(() => {
    if (showTour) {
      try {
        window.desktopAPI.show();
      } catch {}
    }
  }, [showTour]);

  // Keyboard navigation (Smooth Ctrl+Arrow)
  useEffect(() => {
    const pressed = new Set<string>();
    let rafId: number | null = null;
    let lastTs = 0;

    const stepLoop = (ts: number) => {
      if (!lastTs) lastTs = ts;
      const dt = (ts - lastTs) / 1000; // seconds
      lastTs = ts;

      const ctrl = pressed.has("Control");
      const shift = pressed.has("Shift");
      const up = pressed.has("ArrowUp");
      const down = pressed.has("ArrowDown");
      const left = pressed.has("ArrowLeft");
      const right = pressed.has("ArrowRight");

      let vx = 0,
        vy = 0;
      if (left) vx -= 1;
      if (right) vx += 1;
      if (up) vy -= 1;
      if (down) vy += 1;

      if (ctrl && (vx !== 0 || vy !== 0)) {
        // pixels per second
        const speed = shift ? 1500 : 900;
        // normalize diagonal
        const len = Math.hypot(vx, vy) || 1;
        vx /= len;
        vy /= len;
        const dx = Math.round(vx * speed * dt);
        const dy = Math.round(vy * speed * dt);
        if (dx !== 0 || dy !== 0) {
          window.desktopAPI.moveBy(dx, dy);
        }
        rafId = requestAnimationFrame(stepLoop);
      } else {
        rafId = null;
        lastTs = 0;
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const mode = overlayModeRef.current;
        if (mode === "sidebar" || mode === "window") {
          setShowMiniOutput(false);
          setOverlayMode("compact");
          try {
            window.desktopAPI.setMode("compact");
          } catch {}
          return;
        }
        setShowMiniOutput(false);
        window.desktopAPI.hide();
        return;
      }
      pressed.add(e.key);
      if (
        e.ctrlKey &&
        (e.key === "ArrowUp" ||
          e.key === "ArrowDown" ||
          e.key === "ArrowLeft" ||
          e.key === "ArrowRight")
      ) {
        e.preventDefault();
        if (rafId == null) rafId = requestAnimationFrame(stepLoop);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      pressed.delete(e.key);
      if (
        [
          "Control",
          "Shift",
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
        ].includes(e.key) &&
        rafId != null
      ) {
        // let the loop stop naturally next frame
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, []);

  // Global Hotkeys (F1, Ctrl+T)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F1" || (e.key === "/" && e.ctrlKey)) {
        if (showHotkeys) return;
        e.preventDefault();
        setShowPalette(true);
      }
      // Ctrl+T for new tab + focus input
      if (e.key === "t" && e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        addTab();
        setTimeout(() => inputRef.current?.focus(), 0);
      }
      // Ctrl+W to close current tab
      if (e.key === "w" && e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (tabs.length > 1) closeTab(activeTabId);
      }
      // Ctrl+Tab to cycle forward, Ctrl+Shift+Tab to cycle backward
      if (e.key === "Tab" && e.ctrlKey) {
        e.preventDefault();
        const currentIdx = tabs.findIndex((t: any) => t.id === activeTabId);
        if (e.shiftKey) {
          // Backward
          const prevIdx = currentIdx <= 0 ? tabs.length - 1 : currentIdx - 1;
          switchTab(tabs[prevIdx].id);
        } else {
          // Forward
          const nextIdx = currentIdx >= tabs.length - 1 ? 0 : currentIdx + 1;
          switchTab(tabs[nextIdx].id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showHotkeys, addTab, closeTab, tabs, activeTabId, switchTab]);

  // Agent Events (Approval, Canvas, Notifications)
  useEffect(() => {
    const unsub = subscribeProgress(async (evt: any) => {
      try {
        const d = evt.data || {};

        if (evt.event === "wakeword_detected") {
          try {
            window.desktopAPI.show();
            setOverlayMode("window");
            window.desktopAPI.setMode("window");
            setTimeout(() => inputRef.current?.focus(), 0);

            if (!isRecording) {
              // Check current auth state directly (not stale closure)
              const { data: sessionData } = await supabase.auth.getSession();
              const isCurrentlySignedIn = !!sessionData?.session;
              if (!isCurrentlySignedIn) {
                try {
                  (window as any).desktopAPI?.notify?.(
                    "Wakeword detected",
                    "Sign in to use voice.",
                  );
                } catch {}
                try {
                  handleSignIn();
                } catch {}
                return;
              }
              baseQueryRef.current = query;
              startRecording();
            }
          } catch {}
          return;
        }

        // Approval / Canvas / generic tool events (speech handled in a separate effect)
        if (evt.event === "tool_event") {
          const toolName = String(d.tool || "");
          if (toolName === "stream_speech") {
            // Speech-specific handling lives in a dedicated effect below
            return;
          }
          const status = String(d.status || "").toLowerCase();
          if (status === "approval_required") {
            const id = String(d.id || "");
            const tool = String(d.tool || "");
            const args =
              d.args && typeof d.args === "object" ? d.args : undefined;
            const description =
              typeof d.description === "string" ? d.description : undefined;
            if (id && tool) {
              setApprovalPrompt({ id, tool, args, description });
              activePermissionNotifsRef.current.add(id);
              // Send rich permission notification so users can approve from the notification overlay
              try {
                const notifWin = (window as any).desktopAPI;
                notifWin?.notify?.({
                  title: "Permission Required",
                  message:
                    description ||
                    `Stuard wants to use **${tool.replace(/_/g, " ")}**`,
                  variant: "warning",
                  position: "top-right",
                  duration: 0,
                  dismissible: false,
                  sound: true,
                  id: `permission-${id}`,
                  permissionRequest: { id, tool, args, description },
                });
              } catch {}
            }
          }
          if (status === "completed") {
            const id = String(d.id || "");
            setApprovalPrompt((curr) => (curr && curr.id === id ? null : curr));
            // Only dismiss the permission notification if one was actually shown for this tool call
            if (activePermissionNotifsRef.current.has(id)) {
              activePermissionNotifsRef.current.delete(id);
              try {
                (window as any).desktopAPI?.notify?.({
                  id: `permission-${id}`,
                  title: "",
                  duration: 1,
                  dismissible: true,
                });
              } catch {}
            }
          }

          // Canvas Actions
          if (toolName === "canvas_manager") {
            const kind = String(d.kind || "");
            if (kind === "canvas_action") {
              const action = String(d.action || "");
              if (action === "clear") await window.desktopAPI.canvasClear();
              else if (action === "create")
                d.canvas?.id &&
                  (await window.desktopAPI.canvasCreate(d.canvas));
              else if (action === "update")
                d.canvas?.id &&
                  (await window.desktopAPI.canvasUpdate(d.canvas));
              else if (action === "delete")
                d.id && (await window.desktopAPI.canvasDelete(String(d.id)));
              else if (action === "show")
                d.id && (await window.desktopAPI.canvasShow(String(d.id)));
              else if (action === "hide")
                d.id && (await window.desktopAPI.canvasHide(String(d.id)));
              else if (action === "focus")
                d.id && (await window.desktopAPI.canvasFocus(String(d.id)));
            }
          }
        }

        // Notifications - Handled by NotificationController
        /*
        if (evt.event === 'reminder_triggered') {
          const m = evt.data?.message || 'Reminder';
          await (window as any).desktopAPI?.notify?.('Reminder', String(m));
        }
        if (evt.event === 'notification') {
          const title = evt.data?.title || 'Notification';
          const body = evt.data?.body || '';
          await (window as any).desktopAPI?.notify?.(String(title), String(body));
        }
        */
      } catch {}
    });
    return () => {
      try {
        unsub?.();
      } catch {}
    };
  }, [subscribeProgress, isRecording]);

  // Wakeword service lifecycle
  useEffect(() => {
    if (!state?.connected) return;
    let canceled = false;
    const tryStart = async (retries = 5) => {
      for (let i = 0; i < retries && !canceled; i++) {
        try {
          if ((window as any).desktopAPI?.execTool) {
            if (wakewordEnabled) {
              await (window as any).desktopAPI.execTool("wakeword_start", {
                sensitivity: 0.7,
                cooldown: 1.0,
              });
            } else {
              await (window as any).desktopAPI.execTool("wakeword_stop", {});
            }
            return; // success
          }
        } catch {}
        // Wait a bit before retrying (desktopAPI might not be ready yet on startup)
        await new Promise((r) => setTimeout(r, 500));
      }
    };
    tryStart();
    return () => {
      canceled = true;
    };
  }, [wakewordEnabled, state?.connected]);

  // Auth & Updates
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setSignedIn(!!data?.session);
      setAccessToken(data?.session?.access_token || null);
      try {
        await window.desktopAPI.syncAuthSession(data?.session || null);
      } catch {}
      try {
        const s = await window.desktopAPI.updatesGetState();
        if (s && typeof s.status === "string") setUpdateState(s as any);
      } catch {}
    })();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSignedIn(!!session);
      setAccessToken(session?.access_token || null);
      try {
        await window.desktopAPI.syncAuthSession(session || null);
      } catch {}
    });
    const unsubUpd = window.desktopAPI?.onUpdatesState?.((s: any) => {
      try {
        if (s && typeof s.status === "string") setUpdateState(s);
      } catch {}
    });
    return () => {
      try {
        subscription.unsubscribe();
      } catch {}
      try {
        typeof unsubUpd === "function" && unsubUpd();
      } catch {}
    };
  }, []);

  // Conversation Title
  useEffect(() => {
    let timer: any = null;
    const loadTitle = async () => {
      try {
        if (!conversationId) {
          setConversationTitle(null);
          return;
        }
        // Try local agent first
        try {
          const json = await agentFetchJson(
            resolveAgentEndpoints(),
            `/v1/memory/conversations/${encodeURIComponent(conversationId)}`,
            { accessToken },
          );
          if (json.ok && json.conversation?.title) {
            setConversationTitle(
              String(json.conversation.title).trim() || null,
            );
            return;
          }
        } catch {}
        // Fallback to Supabase if signed in
        const syncPrefs = await fetchRendererSyncPrefs();
        if (signedIn && syncPrefs.sync_conversations) {
          const { data, error } = await supabase
            .from("conversations")
            .select("title")
            .eq("id", conversationId)
            .single();
          if (!error) {
            const t = (data as any)?.title;
            setConversationTitle(
              t && String(t).trim() ? String(t).trim() : null,
            );
          }
        }
      } catch {}
    };
    loadTitle();
    timer = setTimeout(loadTitle, 2000);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [accessToken, conversationId, signedIn]);

  // Fetch Conversations from local agent (works offline, no sign-in required)
  const fetchConversations = async () => {
    setLoadingConvs(true);
    let localConvs: any[] = [];

    // Primary: fetch from local agent which stores everything locally
    try {
      const json = await agentFetchJson(
        resolveAgentEndpoints(),
        "/v1/memory/conversations?limit=20&source=stuard",
        { accessToken },
      );
      if (json.ok && Array.isArray(json.conversations)) {
        localConvs = json.conversations.map((c: any) => ({
          id: c.id || c.conversation_id,
          title: c.title,
          created_at: c.created_at || c.updated_at,
        }));
      }
    } catch {
      // Agent not running, fall through
    }

    // Always merge Supabase conversations (includes SMS conversations
    // and any created when local agent wasn't running). Reading is not
    // gated by sync_conversations — that pref controls writing only.
    let cloudConvs: any[] = [];
    try {
      if (signedIn) {
        const { data, error } = await supabase
          .from("conversations")
          .select("id, title, created_at")
          .eq("source", "stuard")
          .order("created_at", { ascending: false })
          .limit(20);
        if (!error && Array.isArray(data)) {
          cloudConvs = data;
        }
      }
    } catch {}

    // Merge and deduplicate by ID, preferring local agent data
    const seenIds = new Set<string>();
    const merged: any[] = [];
    for (const c of localConvs) {
      if (c.id && !seenIds.has(String(c.id))) {
        seenIds.add(String(c.id));
        merged.push(c);
      }
    }
    for (const c of cloudConvs) {
      if (c.id && !seenIds.has(String(c.id))) {
        seenIds.add(String(c.id));
        merged.push(c);
      }
    }

    merged.sort(
      (a: any, b: any) =>
        new Date(b.created_at || 0).getTime() -
        new Date(a.created_at || 0).getTime(),
    );
    setConvList(merged.slice(0, 20));
    setLoadingConvs(false);
  };
  // --- Sidebar & Tabs State ---
  const [internalSidebarOpen, setInternalSidebarOpen] = useState(false);
  const [activeSidebarTab, setActiveSidebarTab] = useState<
    "spaces" | "canvas" | "terminal" | "tasks" | "browser" | "todo"
  >("spaces");

  useEffect(() => {
    if (chatMenuOpen) fetchConversations();
  }, [chatMenuOpen]);

  // Auto-open sidebar when agent uses browser (headed mode)
  useEffect(() => {
    const unsub = window.desktopAPI?.onBrowserActivity?.(() => {
      if (overlayModeRef.current === "sidebar" || overlayModeRef.current === "window") {
        setInternalSidebarOpen((prev) => {
          if (!prev) {
            try { (window.desktopAPI as any).toggleInternalSidebar?.(true); } catch {}
          }
          return true;
        });
        setActiveSidebarTab("browser");
      }
    });
    return () => { try { typeof unsub === 'function' && unsub(); } catch {} };
  }, []);

  // Auto-open sidebar when agent tasks are running
  const agentTaskAutoOpenedRef = useRef(false);
  useEffect(() => {
    if (overlayModeRef.current !== "sidebar" && overlayModeRef.current !== "window") return;

    const agentHttp = (window as any).__AGENT_HTTP__ || "http://127.0.0.1:8765";
    let cancelled = false;

    const checkAgentTasks = async () => {
      try {
        const res = await fetch(`${agentHttp}/v1/subagents/list?limit=5`);
        const data = await res.json();
        if (cancelled) return;
        if (data.ok && Array.isArray(data.tasks)) {
          const hasRunning = data.tasks.some((t: any) => t.status === "running");
          if (hasRunning && !agentTaskAutoOpenedRef.current) {
            agentTaskAutoOpenedRef.current = true;
            // Open sidebar if closed, and switch to tasks tab
            setInternalSidebarOpen((wasOpen) => {
              if (!wasOpen) {
                try { (window.desktopAPI as any).toggleInternalSidebar?.(true); } catch {}
                // Only set tab to tasks when freshly opening the sidebar
                setActiveSidebarTab("tasks");
              }
              // If already open, the SidebarTabsPanel handles tab switching internally
              return true;
            });
          }
          if (!hasRunning) {
            agentTaskAutoOpenedRef.current = false;
          }
        }
      } catch {
        // agent not available
      }
    };

    checkAgentTasks();
    const interval = setInterval(checkAgentTasks, 4000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // Auto-open sidebar when agent creates todo items
  useEffect(() => {
    const handler = () => {
      if (overlayModeRef.current === "sidebar" || overlayModeRef.current === "window") {
        setInternalSidebarOpen((prev) => {
          if (!prev) {
            try { (window.desktopAPI as any).toggleInternalSidebar?.(true); } catch {}
          }
          return true;
        });
        setActiveSidebarTab("todo");
      }
    };
    window.addEventListener('agent-todo-update', handler);
    return () => window.removeEventListener('agent-todo-update', handler);
  }, []);

  // --- Handlers (memoized to prevent unnecessary re-renders) ---

  const handleSignIn = useCallback(async () => await startBrowserSignIn(), []);

  const handleShowCompact = useCallback(() => {
    setOverlayMode("compact");
    window.desktopAPI.setMode("compact");
  }, []);

  const handleNewChat = useCallback(() => {
    newChat();
    setChatMenuOpen(false);
    setConversationTitle(null);
  }, [newChat]);

  const handleSelectConversation = useCallback(
    (id: string) => {
      let titleHint: string | undefined;
      try {
        const item = convList.find((c: any) => String(c.id) === String(id));
        if (item && typeof item.title === "string" && item.title.trim()) {
          titleHint = item.title.trim();
          setConversationTitle(item.title.trim());
        }
      } catch {}
      loadConversation(id, titleHint);
      setChatMenuOpen(false);
    },
    [convList, loadConversation],
  );

  const handleDeleteConversation = useCallback(
    async (id: string) => {
      try {
        // 1. Delete from local agent
        await deleteConversation(id);

        // 2. Delete from Supabase if signed in
        const syncPrefs = await fetchRendererSyncPrefs();
        if (signedIn && syncPrefs.sync_conversations) {
          await supabase.from("conversations").delete().eq("id", id);
        }

        // 3. Update local list
        setConvList((prev) => prev.filter((c) => String(c.id) !== String(id)));

        // 4. If it was the active conversation and we cleared it in useAgent, update title
        if (conversationId === id) {
          setConversationTitle(null);
        }

        try {
          (window as any).desktopAPI?.notify?.(
            "Deleted",
            "Conversation removed.",
          );
        } catch {}
      } catch (err) {
        console.error("Failed to delete conversation:", err);
      }
    },
    [deleteConversation, signedIn, conversationId],
  );

  // Use ref to avoid recreating handleSend on every render
  const handleSendRef = useRef<(overrideText?: string) => void>(() => {});

  handleSendRef.current = useCallback(
    (overrideText?: string) => {
      if (!signedIn) {
        handleSignIn();
        return;
      }
      const text = (
        typeof overrideText === "string" ? overrideText : query
      ).trim();
      if (!text && attachments.length === 0 && contextPaths.length === 0)
        return;

      const selected =
        typeof chatMode === "string" && chatMode.trim()
          ? chatMode.trim()
          : "auto";
      const isAuto = selected === "auto";
      const meta = !isAuto ? modelById.get(selected) : undefined;
      const modeToSend = isAuto
        ? "auto"
        : (meta?.category as any) || (meta?.isReasoning ? "smart" : "balanced");
      const modelIdToSend = !isAuto ? selected : undefined;

      // Build context with paths
      const contextData: Record<string, any> = {
        tone: tone === "custom" ? customTone : tone,
        tonePreset: tone,
        persona,
      };

      // Add file/folder paths as context
      if (contextPaths.length > 0) {
        contextData.paths = contextPaths.map((p) => ({
          path: p.path,
          name: p.name,
          isDirectory: p.isDirectory,
        }));
      }

      sendMessage({
        text:
          text ||
          (contextPaths.length > 0
            ? `Context: ${contextPaths.map((p) => p.name).join(", ")}`
            : "Attached files"),
        attachments: attachments.map((a) => ({
          type: a.type,
          name: a.name,
          data: a.data,
          mimeType: a.mimeType,
        })),
        context: contextData,
        contextPaths: contextPaths.length > 0 ? contextPaths : undefined,
        mode: modeToSend,
        modelId: typeof modelIdToSend === "string" ? modelIdToSend : undefined,
        reasoningLevel,
      });
      setQuery("");
      setAttachments([]);
      setContextPaths([]);
      // Clear speech transcript state so it doesn't re-sync stale text
      clearTranscript();
      baseQueryRef.current = "";
    },
    [
      signedIn,
      query,
      attachments,
      contextPaths,
      chatMode,
      chatModels,
      tone,
      customTone,
      persona,
      reasoningLevel,
      sendMessage,
      handleSignIn,
      clearTranscript,
    ],
  );

  // Stable callback ref for child components
  const handleSend = useCallback((overrideText?: string) => {
    handleSendRef.current(overrideText);
  }, []);

  // Handle GenUI responses (syntax-based GenUI like ```genui:choices)
  const handleGenUIResponse = useCallback(
    (component: string, result: any) => {
      // Format the selection as a follow-up message
      let responseText = "";

      if (result?.action === "connect" && result?.slug) {
        // For integration connect - the IntegrationConnect component handles the actual OAuth flow
        // Just notify the AI that the user connected
        responseText = `Connected integration: ${result.slug}`;
      } else if (result?.selectedId) {
        // For choices
        responseText = `Selected: ${result.selectedId}`;
      } else if (result?.confirmed !== undefined) {
        // For confirmation
        responseText = result.confirmed ? "Confirmed" : "Cancelled";
      } else if (result?.date) {
        // For date picker
        responseText = `Selected date: ${result.date}`;
      } else if (result?.files) {
        // For file dropzone
        responseText = `Attached ${result.files.length} file(s)`;
      } else if (result?.value !== undefined) {
        // For slider
        responseText = `Set value to: ${result.value}`;
      } else {
        // Generic fallback
        responseText = `Response: ${JSON.stringify(result)}`;
      }

      // Send as a follow-up message
      if (responseText && sendMessage) {
        sendMessage({
          text: responseText,
          attachments: [],
          context: { genui_response: true, component, result },
          silent: true,
        });
      }
    },
    [sendMessage],
  );

  // Base query before recording started
  const baseQueryRef = useRef("");

  // Sync speech to query
  useEffect(() => {
    if (isRecording) {
      const base = baseQueryRef.current;
      const t = (transcript || "").trim();
      const i = (interimTranscript || "").trim();
      const fullText = (() => {
        if (!t) return i;
        if (!i) return t;
        if (t === i) return t;
        // Avoid duplicate overlap when interim repeats committed words.
        if (i.startsWith(t) || i.includes(t)) return i;
        if (t.endsWith(i) || t.endsWith(` ${i}`)) return t;
        return `${t} ${i}`.trim();
      })();
      const spacer =
        base && /[a-z0-9]$/i.test(base) && /^[a-z0-9]/i.test(fullText)
          ? " "
          : base
            ? " "
            : "";
      const full = base + spacer + fullText;
      setQuery(full);

      // Auto-send check
      const pattern = /(?:send\s+(?:stuard|steward))[\.\!\?]?\s*$/i;
      if (pattern.test(full)) {
        const clean = full.replace(pattern, "").trim();
        setQuery(clean);
        stopRecording();
        setTimeout(() => handleSendRef.current(clean), 50);
      }
    }
  }, [transcript, interimTranscript, isRecording, stopRecording]);

  // Handle Speech Errors
  useEffect(() => {
    if (speechError) {
      try {
        (window as any).desktopAPI.notify("Speech Error", speechError);
      } catch {}
    }
  }, [speechError]);

  const handleMicClick = useCallback(async () => {
    if (isRecording) {
      stopRecording();
    } else {
      if (!signedIn) {
        handleSignIn();
        return;
      }
      baseQueryRef.current = query;
      startRecording();
    }
  }, [
    isRecording,
    signedIn,
    query,
    stopRecording,
    startRecording,
    handleSignIn,
  ]);

  // Attachments
  const fileToAttachment = (
    file: File,
  ): Promise<{
    type: "image" | "file";
    name: string;
    data: string;
    mimeType: string;
  }> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const result = String(reader.result || "");
          let base64 = "";
          let mimeType = file.type || "";
          if (result.startsWith("data:")) {
            const comma = result.indexOf(",");
            const header = result.slice(5, result.indexOf(";"));
            if (!mimeType) mimeType = header || "application/octet-stream";
            base64 = comma >= 0 ? result.slice(comma + 1) : "";
          } else {
            base64 = result;
          }
          const isImage =
            typeof mimeType === "string" &&
            mimeType.toLowerCase().startsWith("image/");
          const fallbackExt = isImage ? mimeType.split("/")[1] || "png" : "";
          const name =
            file.name && file.name.trim()
              ? file.name
              : isImage
                ? `pasted_image.${fallbackExt}`
                : "pasted_file";
          resolve({
            type: isImage ? "image" : "file",
            name,
            data: base64,
            mimeType: mimeType || "application/octet-stream",
          });
        } catch (e) {
          reject(e);
        }
      };
      reader.onerror = (e) => reject(e);
      reader.readAsDataURL(file);
    });
  };

  const addAttachmentsFromFiles = useCallback(
    async (files: File[] | FileList) => {
      const arr = Array.from(files);
      if (arr.length === 0) return;
      const atts = await Promise.all(arr.map(fileToAttachment));
      setAttachments((prev) => [...prev, ...atts]);
    },
    [],
  );

  const handleAttachFiles = useCallback(async () => {
    const files = await window.desktopAPI.selectFiles();
    if (files)
      setAttachments((prev) => [
        ...prev,
        ...files.map((f) => ({ type: "file" as const, ...f })),
      ]);
  }, []);

  const handleAttachImages = useCallback(async () => {
    const images = await window.desktopAPI.selectImages();
    if (images)
      setAttachments((prev) => [
        ...prev,
        ...images.map((i) => ({ type: "image" as const, ...i })),
      ]);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      try {
        // First check for URLs (for dragging links from browser)
        const uriList = e.dataTransfer?.getData("text/uri-list");
        const plainText = e.dataTransfer?.getData("text/plain");
        const htmlText = e.dataTransfer?.getData("text/html");

        // Helper to extract YouTube URL
        const extractYouTubeUrl = (text: string): string | null => {
          if (!text) return null;
          const patterns = [
            /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
            /(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
            /(?:https?:\/\/)?(?:www\.)?youtube\.com\/v\/([a-zA-Z0-9_-]{11})/,
            /(?:https?:\/\/)?youtu\.be\/([a-zA-Z0-9_-]{11})/,
            /(?:https?:\/\/)?(?:www\.)?youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
          ];
          for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) {
              const fullUrlMatch = text.match(/https?:\/\/[^\s<>"{}|\\^`[\]]+/);
              return fullUrlMatch
                ? fullUrlMatch[0]
                : `https://youtube.com/watch?v=${match[1]}`;
            }
          }
          return null;
        };

        // Helper to extract any URL
        const extractAnyUrl = (text: string): string | null => {
          if (!text) return null;
          const match = text.match(/https?:\/\/[^\s<>"{}|\\^`[\]]+/);
          return match ? match[0] : null;
        };

        // Try to extract URL from dropped data
        let droppedUrl: string | null = null;

        if (uriList) {
          droppedUrl = extractYouTubeUrl(uriList) || extractAnyUrl(uriList);
        }
        if (!droppedUrl && plainText) {
          droppedUrl = extractYouTubeUrl(plainText) || extractAnyUrl(plainText);
        }
        if (!droppedUrl && htmlText) {
          const hrefMatch = htmlText.match(/href=["']([^"']+)["']/);
          if (hrefMatch) {
            droppedUrl = extractYouTubeUrl(hrefMatch[1]) || hrefMatch[1];
          }
        }

        // If we found a URL, add it to the query
        if (droppedUrl) {
          setQuery((prev) => {
            const trimmed = prev.trim();
            return trimmed ? `${trimmed} ${droppedUrl}` : droppedUrl!;
          });
          return; // Don't process as file
        }

        // Fall back to file handling
        const files = e.dataTransfer?.files;
        if (files && files.length > 0) await addAttachmentsFromFiles(files);
      } catch {}
    },
    [addAttachmentsFromFiles],
  );

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      try {
        const cd = e.clipboardData;
        if (!cd) return;
        const files: File[] = Array.from(cd.items || [])
          .filter((it) => it.kind === "file")
          .map((it) => it.getAsFile())
          .filter((f): f is File => !!f);
        if (files.length === 0) return;
        const hasText = Array.from(cd.types || []).includes("text/plain");
        if (!hasText) e.preventDefault();
        await addAttachmentsFromFiles(files);
      } catch {}
    },
    [addAttachmentsFromFiles],
  );

  // Memoized callbacks for child components to prevent re-renders
  const handleOpenDashboard = useCallback(
    () => window.desktopAPI.openDashboard(),
    [],
  );
  const handleToggleSpaces = useCallback(
    () => window.desktopAPI.toggleSpaces(),
    [],
  );
  const handleRemoveContext = useCallback(
    (idx: number) =>
      setContextPaths((prev) => prev.filter((_, i) => i !== idx)),
    [],
  );
  const handleAddContext = useCallback(
    (item: ContextItem) =>
      setContextPaths((prev) =>
        prev.some((p) => p.path === item.path) ? prev : [...prev, item],
      ),
    [],
  );
  const handleRemoveAttachment = useCallback(
    (i: number) => setAttachments((p) => p.filter((_, idx) => idx !== i)),
    [],
  );

  const handleToggleInternalSidebar = useCallback(async () => {
    let currentOpen = internalSidebarOpen;

    try {
      const state = await (
        window.desktopAPI as any
      ).getInternalSidebarState?.();
      if (state && typeof state.open === "boolean") {
        currentOpen = state.open;
        if (currentOpen !== internalSidebarOpen) {
          setInternalSidebarOpen(currentOpen);
        }
      }
    } catch {}

    const nextState = !currentOpen;

    // Only expand/contract window in sidebar/window modes
    if (overlayMode === "sidebar" || overlayMode === "window") {
      // Let the main process handle window width expansion/contraction
      try {
        const result = await (window.desktopAPI as any).toggleInternalSidebar?.(
          nextState,
        );
        if (result) {
          setInternalSidebarOpen(result.open);
          return;
        }
      } catch (e) {
        console.warn("toggleInternalSidebar failed, falling back:", e);
      }
    }

    // Fallback: just toggle state without window resize
    setInternalSidebarOpen(nextState);
  }, [internalSidebarOpen, overlayMode]);

  const handleCloseInternalSidebar = useCallback(async () => {
    try {
      const state = await (
        window.desktopAPI as any
      ).getInternalSidebarState?.();
      if (state && state.open === false) {
        setInternalSidebarOpen(false);
        return;
      }
    } catch {}

    // Contract window width when closing sidebar
    if (overlayMode === "sidebar" || overlayMode === "window") {
      try {
        const result = await (window.desktopAPI as any).toggleInternalSidebar?.(
          false,
        );
        if (result) {
          setInternalSidebarOpen(result.open);
          return;
        }
      } catch (e) {
        console.warn("toggleInternalSidebar(close) failed:", e);
      }
    }
    setInternalSidebarOpen(false);
  }, [overlayMode]);
  const handleSwitchSidebarTab = useCallback(
    (tab: "spaces" | "canvas" | "terminal" | "tasks" | "browser" | "todo") => setActiveSidebarTab(tab),
    [],
  );

  const handleClosePalette = useCallback(() => setShowPalette(false), []);
  const handleCloseHotkeys = useCallback(() => setShowHotkeys(false), []);

  const statusLabel = useMemo(() => {
    const p = (ai?.phase || "").toString();
    if (p === "routing") {
      const m = (ai as any)?.model;
      return m ? `Routing (${m})` : "Routing...";
    }
    if (p === "responding") return "Responding...";
    if (p === "tool") {
      // Show description or humanized tool name from AI state
      const toolName = (ai as any)?.tool || "";
      const statusText = ai?.statusText || "";
      // If statusText contains tool info, use it; otherwise show humanized name
      if (statusText && statusText !== "Running tool...") return statusText;
      if (toolName) {
        const humanName = toolName
          .replace(/_/g, " ")
          .replace(/\b\w/g, (c: string) => c.toUpperCase());
        return `${humanName}...`;
      }
      return "Running tool...";
    }
    return ai?.statusText || "Ready";
  }, [ai]);

  // Determine if AI is currently streaming (for stop button)
  const isStreaming = useMemo(() => {
    const p = (ai?.phase || "").toString().toLowerCase();
    return p === "routing" || p === "responding" || p === "tool";
  }, [ai]);

  const inputStatusText = useMemo(() => {
    if (isRecording) return "Recording...";
    if (queueDepth > 0) return `Queued: ${queueDepth}`;
    if (state?.connecting) return "Connecting…";
    if (!state?.connected) {
      if (state?.status === "error") return "Connection error";
      return "Starting…";
    }
    // Check if AI is actively doing something (not idle states)
    const idleStates = ["ready", "idle", "connected", ""];
    const isIdle = idleStates.includes(statusLabel.toLowerCase());
    // Show AI status if active, otherwise show planner next up
    if (!isIdle) return statusLabel;
    // Show next upcoming event/task/reminder when idle
    if (plannerData?.nextUp) {
      return `${plannerData.nextUp.title} ${plannerData.nextUp.timeLabel}`;
    }
    return "Ready";
  }, [isRecording, queueDepth, statusLabel, plannerData?.nextUp]);

  // Compute status icon based on current state
  const inputStatusIcon = useMemo(():
    | "video"
    | "calendar"
    | "bell"
    | "task"
    | undefined => {
    const idleStates = ["ready", "idle", "connected", ""];
    const isIdle = idleStates.includes(statusLabel.toLowerCase());
    if (isRecording || queueDepth > 0 || !isIdle) return "video";
    if (plannerData?.nextUp) {
      const iconMap = {
        calendar: "calendar",
        bell: "bell",
        task: "task",
      } as const;
      return iconMap[plannerData.nextUp.icon] || "video";
    }
    return undefined;
  }, [isRecording, queueDepth, statusLabel, plannerData?.nextUp]);

  // Compute urgency level for visual indicators
  const inputStatusUrgency = useMemo(() => {
    const idleStates = ["ready", "idle", "connected", ""];
    const isIdle = idleStates.includes(statusLabel.toLowerCase());
    if (isRecording || queueDepth > 0 || !isIdle) return undefined;
    return plannerData?.nextUp?.urgency;
  }, [isRecording, queueDepth, statusLabel, plannerData?.nextUp?.urgency]);

  const connectionStatus = useMemo(():
    | "connected"
    | "connecting"
    | "disconnected"
    | "error" => {
    if (state?.connecting) return "connecting";
    if (state?.connected) return "connected";
    if (state?.status === "error") return "error";
    return "disconnected";
  }, [state?.connecting, state?.connected, state?.status]);

  const chatStatusText = useMemo(() => {
    if (connectionStatus === "connecting") return "Connecting…";
    if (connectionStatus === "disconnected") return "Offline";
    if (connectionStatus === "error") return "Connection error";
    return statusLabel;
  }, [connectionStatus, statusLabel]);

  const handleShowSidebar = useCallback(() => {
    setOverlayMode("sidebar");
    window.desktopAPI.setMode("sidebar");
  }, []);

  const handleShowWindow = useCallback(() => {
    setOverlayMode("window");
    window.desktopAPI.setMode("window");
  }, []);

  const handleCreateQuickNote = useCallback(async () => {
    const now = new Date().toISOString();
    const note = {
      id: `canvas_${Date.now()}`,
      title: "Quick Note",
      content: "",
      createdAt: now,
      updatedAt: now,
    };
    await window.desktopAPI?.canvasCreateDocument?.(note);
    await window.desktopAPI?.canvasCreate?.({
      id: note.id,
      title: note.title,
      content: note.content,
      template: "notes",
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      size: { width: 320, height: 220 },
    });
  }, []);

  const handleOpenQuickNotes = useCallback(async () => {
    const listResult = await window.desktopAPI?.canvasListDocuments?.();
    const documents = Array.isArray(listResult?.documents)
      ? listResult.documents
      : [];
    const latest = documents
      .slice()
      .sort((a: any, b: any) => {
        const aTime = new Date(a?.updatedAt || a?.createdAt || 0).getTime();
        const bTime = new Date(b?.updatedAt || b?.createdAt || 0).getTime();
        return bTime - aTime;
      })[0];

    if (latest?.id) {
      await window.desktopAPI?.canvasCreate?.({
        id: latest.id,
        title: latest.title || "Quick Note",
        content: latest.content || "",
        template: "notes",
        createdAt: latest.createdAt,
        updatedAt: latest.updatedAt,
        size: { width: 320, height: 220 },
      });
      return;
    }

    const now = new Date().toISOString();
    const note = {
      id: `canvas_${Date.now()}`,
      title: "Quick Note",
      content: "",
      createdAt: now,
      updatedAt: now,
    };
    await window.desktopAPI?.canvasCreateDocument?.(note);
    await window.desktopAPI?.canvasCreate?.({
      id: note.id,
      title: note.title,
      content: note.content,
      template: "notes",
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      size: { width: 320, height: 220 },
    });
  }, []);

  const handleOpenTerminal = useCallback(async () => {
    await window.desktopAPI?.openSidebar?.({ tab: "terminal", expanded: true });
  }, []);

  const handleOpenSpacesPanel = useCallback(async () => {
    await window.desktopAPI?.openSidebar?.({ tab: "spaces", expanded: true });
  }, []);

  const handleOpenWorkflowsPanel = useCallback(async () => {
    await window.desktopAPI?.openWorkflows?.();
  }, []);

  const commands = useMemo<CommandItem[]>(() => {
    const q = (paletteQuery || "").toLowerCase().trim();
    const staticItems: CommandItem[] = [
      {
        id: "new-chat",
        title: "New chat",
        description: "Start a fresh conversation",
        icon: <Plus className="w-5 h-5" />,
        run: handleNewChat,
      },
      {
        id: "open-dashboard",
        title: "Open dashboard",
        description: "View full dashboard",
        icon: <Layout className="w-5 h-5" />,
        shortcut: "Dash",
        run: () => window.desktopAPI.openDashboard(),
      },
      {
        id: "toggle-compact",
        title: "Compact layout",
        description: "Switch to compact layout",
        icon: <Minimize2 className="w-5 h-5" />,
        run: handleShowCompact,
      },
      {
        id: "toggle-sidebar",
        title: "Sidebar layout",
        description: "Switch to sidebar layout",
        icon: <Layout className="w-5 h-5" />,
        run: handleShowSidebar,
      },
      {
        id: "toggle-window",
        title: "Window layout",
        description: "Switch to window layout",
        icon: <Layout className="w-5 h-5" />,
        run: handleShowWindow,
      },

      {
        id: "new-quick-note",
        title: "New Quick Note",
        description: "Create and open a new quick note",
        icon: <NotebookPen className="w-5 h-5" />,
        group: "Launch",
        run: handleCreateQuickNote,
      },
      {
        id: "open-quick-notes",
        title: "Open Quick Notes",
        description: "Open your notes sidebar",
        icon: <NotebookPen className="w-5 h-5" />,
        group: "Launch",
        run: handleOpenQuickNotes,
      },
      {
        id: "open-terminal",
        title: "Open Terminal",
        description: "Launch the built-in terminal",
        icon: <Terminal className="w-5 h-5" />,
        group: "Launch",
        run: handleOpenTerminal,
      },
      {
        id: "open-spaces",
        title: "Open Spaces",
        description: "Open spaces and create a new space",
        icon: <LayoutGrid className="w-5 h-5" />,
        group: "Launch",
        run: handleOpenSpacesPanel,
      },
      {
        id: "open-workflows",
        title: "Open Workflows",
        description: "Open the workflows builder",
        icon: <Zap className="w-5 h-5" />,
        group: "Launch",
        run: handleOpenWorkflowsPanel,
      },
      {
        id: "attach-files",
        title: "Attach files",
        description: "Upload documents",
        icon: <File className="w-5 h-5" />,
        run: handleAttachFiles,
      },
      {
        id: "attach-images",
        title: "Attach images",
        description: "Upload images",
        icon: <Image className="w-5 h-5" />,
        run: handleAttachImages,
      },
      {
        id: "show-hotkeys",
        title: "Show hotkeys",
        description: "View keyboard shortcuts",
        icon: <Keyboard className="w-5 h-5" />,
        shortcut: "F1",
        run: () => setShowHotkeys(true),
      },
      {
        id: "rerun-onboarding",
        title: "Rerun onboarding",
        description: "Start the welcome tour again",
        icon: <RefreshCw className="w-5 h-5" />,
        run: () => {
          setOnboardingComplete(false);
          setTourComplete(false);
        },
      },
      {
        id: "hide-overlay",
        title: "Hide overlay",
        description: "Close Stuard window",
        icon: <Power className="w-5 h-5" />,
        shortcut: "Esc",
        run: () => window.desktopAPI.hide(),
      },
      {
        id: "tone-concise",
        title: "Tone: Concise",
        description: "Set response tone",
        icon: <MessageSquare className="w-5 h-5" />,
        group: "Tone & Persona",
        run: () => setTone("concise"),
      },
      {
        id: "tone-friendly",
        title: "Tone: Friendly",
        description: "Set response tone",
        icon: <Smile className="w-5 h-5" />,
        group: "Tone & Persona",
        run: () => setTone("friendly"),
      },
      {
        id: "google-search",
        title: "Google Search",
        description: "Search on Google in your browser",
        icon: <Globe className="w-5 h-5" />,
        run: () => {
          const trimmed = query.trim();
          const url = trimmed
            ? `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
            : "https://www.google.com";
          window.desktopAPI.openExternal(url);
          setQuery("");
        },
      },
      {
        id: "edge-search",
        title: "Edge Search",
        description: "Open and search using Microsoft Edge",
        icon: <Search className="w-5 h-5" />,
        run: () => {
          const trimmed = query.trim();
          const url = trimmed
            ? `microsoft-edge:https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
            : "microsoft-edge:https://www.google.com";
          window.desktopAPI.openExternal(url);
          setQuery("");
        },
      },
    ];
    if (!signedIn)
      staticItems.unshift({
        id: "sign-in",
        title: "Sign in",
        description: "Log in to your account",
        icon: <LogIn className="w-5 h-5" />,
        run: handleSignIn,
      });

    let items: CommandItem[] = [];
    if (q) {
      items = staticItems.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          (c.description && c.description.toLowerCase().includes(q)) ||
          (c.group && c.group.toLowerCase().includes(q)),
      );
    } else {
      items = staticItems;
    }

    // Local Workflows
    if (localWorkflows.length > 0) {
      const allLocals = localWorkflows.map((w) => ({
        id: `workflow-${w.id}`,
        title: w.name || "Untitled Workflow",
        description: "Run local workflow",
        group: "Local Workflows",
        icon: <Zap className="w-5 h-5" />,
        run: async () => {
          try {
            await window.desktopAPI?.workflowsRun?.(w.id);
            (window as any).desktopAPI?.notify?.(
              "Workflow Started",
              `Running ${w.name}...`,
            );
          } catch (e) {
            console.error(e);
          }
        },
      }));

      if (q) {
        items.push(
          ...allLocals.filter((w) => w.title.toLowerCase().includes(q)),
        );
      } else {
        items.push(...allLocals);
      }
    }

    // Marketplace Results
    if (marketplaceResults.length > 0) {
      items.push(...marketplaceResults);
    }

    if (paletteAppResults.length > 0) {
      items.push(...paletteAppResults);
    }

    return items;
  }, [
    signedIn,
    setOnboardingComplete,
    setTourComplete,
    setTone,
    localWorkflows,
    marketplaceResults,
    paletteAppResults,
    query,
    handleShowCompact,
    handleShowSidebar,
    handleShowWindow,
    handleNewChat,
    handleCreateQuickNote,
    handleOpenQuickNotes,
    handleOpenTerminal,
    handleOpenSpacesPanel,
    handleOpenWorkflowsPanel,
    handleAttachFiles,
    handleAttachImages,
  ]);

  const hasMessages = messages.length > 0;
  const showResizeGrips = overlayMode === "sidebar" || overlayMode === "window";

  const lastAssistantMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m?.role === "assistant") return m;
    }
    return null;
  }, [messages]);

  const miniOutputText = useMemo(() => {
    const streamingText = (currentResponse || "").trim();
    if (streamingText) return currentResponse || "";
    return lastAssistantMessage?.text || "";
  }, [currentResponse, lastAssistantMessage]);

  const miniOutputHasContent = useMemo(() => {
    const streamingText = (currentResponse || "").trim();
    if (streamingText) return true;
    return !!(lastAssistantMessage?.text || "").trim();
  }, [currentResponse, lastAssistantMessage?.text]);

  const lastAssistantIdRef = useRef<string | null>(null);
  useEffect(() => {
    const id = lastAssistantMessage?.id || null;
    if (id && id !== lastAssistantIdRef.current) {
      setShowMiniOutput(true);
    }
    lastAssistantIdRef.current = id;
  }, [lastAssistantMessage?.id]);

  const hadStreamingRef = useRef(false);
  useEffect(() => {
    const isStreamingNow = !!(currentResponse || "").trim();
    if (isStreamingNow && !hadStreamingRef.current) {
      setShowMiniOutput(true);
    }
    hadStreamingRef.current = isStreamingNow;
  }, [currentResponse]);

  return (
    <NotificationProvider>
      <NotificationController subscribeProgress={subscribeProgress} />
      <div className="w-full h-full text-sans overflow-hidden relative">
        {/* Resize handles for user-resizable window - invisible but draggable edges */}
        {showResizeGrips && (
          <>
            {/* Top edge */}
            <div
              className="absolute top-0 left-2 right-2 h-1 cursor-ns-resize z-[100]"
              style={{ WebkitAppRegion: "no-drag" } as any}
            />
            {/* Bottom edge */}
            <div
              className="absolute bottom-0 left-2 right-2 h-1 cursor-ns-resize z-[100]"
              style={{ WebkitAppRegion: "no-drag" } as any}
            />
            {/* Left edge */}
            <div
              className="absolute top-2 bottom-2 left-0 w-1 cursor-ew-resize z-[100]"
              style={{ WebkitAppRegion: "no-drag" } as any}
            />
            {/* Right edge */}
            <div
              className="absolute top-2 bottom-2 right-0 w-1 cursor-ew-resize z-[100]"
              style={{ WebkitAppRegion: "no-drag" } as any}
            />
            {/* Corner handles - larger for easier grabbing */}
            <div
              className="absolute top-0 left-0 w-3 h-3 cursor-nwse-resize z-[101]"
              style={{ WebkitAppRegion: "no-drag" } as any}
            />
            <div
              className="absolute top-0 right-0 w-3 h-3 cursor-nesw-resize z-[101]"
              style={{ WebkitAppRegion: "no-drag" } as any}
            />
            <div
              className="absolute bottom-0 left-0 w-3 h-3 cursor-nesw-resize z-[101]"
              style={{ WebkitAppRegion: "no-drag" } as any}
            />
            <div
              className="absolute bottom-0 right-0 w-3 h-3 cursor-nwse-resize z-[101]"
              style={{ WebkitAppRegion: "no-drag" } as any}
            />
          </>
        )}
        <div className="w-full h-full overflow-hidden transition-all duration-200 ease-out bg-transparent flex flex-col">
          {overlayMode === "sidebar" || overlayMode === "window" ? (
            <div className="relative h-full w-full p-4 overflow-hidden mode-transition overlay-responsive">
              {/* Resize indicator in bottom-right corner */}
              {showResizeGrips && (
                <div
                  className="resize-indicator"
                  title="Drag corner to resize"
                />
              )}
              {/* Main Content - Full Width */}
              <div className="flex flex-col h-full w-full relative smooth-resize">
                {/* Permission Approval Overlay */}
                {approvalPrompt && (
                  <PermissionDialog
                    isOpen={!!approvalPrompt}
                    tool={approvalPrompt.tool}
                    args={approvalPrompt.args}
                    description={approvalPrompt.description}
                    onAllow={() => {
                      respondToApproval(approvalPrompt.id, true);
                      activePermissionNotifsRef.current.delete(
                        approvalPrompt.id,
                      );
                      setApprovalPrompt(null);
                      // Dismiss the notification overlay version
                      try {
                        (window as any).desktopAPI?.notify?.({
                          id: `permission-${approvalPrompt.id}`,
                          title: "",
                          duration: 1,
                          dismissible: true,
                        });
                      } catch {}
                    }}
                    onDeny={() => {
                      respondToApproval(approvalPrompt.id, false);
                      activePermissionNotifsRef.current.delete(
                        approvalPrompt.id,
                      );
                      setApprovalPrompt(null);
                      // Dismiss the notification overlay version
                      try {
                        (window as any).desktopAPI?.notify?.({
                          id: `permission-${approvalPrompt.id}`,
                          title: "",
                          duration: 1,
                          dismissible: true,
                        });
                      } catch {}
                    }}
                  />
                )}

                {/* Environment Badge */}
                <EnvironmentBadge
                  variant="overlay"
                  className="absolute top-14 right-3 z-50 pointer-events-none"
                />

                {/* Error Notifications */}
                {lastError?.code === "monthly_credit_limit_exceeded" && (
                  <div className="absolute left-4 right-4 bottom-4 z-50 animate-in slide-in-from-bottom-2 duration-300">
                    <div className="rounded-lg border border-rose-500/30 bg-black/90 backdrop-blur-md p-4">
                      <h3 className="text-rose-400 font-semibold text-sm">
                        Monthly Credits Exceeded
                      </h3>
                      <p className="text-white/70 text-xs mt-1 mb-3">
                        You have used all your credits for this month.
                      </p>
                      <button
                        onClick={() => {
                          try {
                            (window as any).desktopAPI?.openExternal?.(
                              "https://stuard.ai/pricing",
                            );
                          } catch {}
                        }}
                        className="w-full py-1.5 bg-rose-500 hover:bg-rose-400 rounded text-xs text-black font-bold"
                      >
                        Upgrade Plan
                      </button>
                    </div>
                  </div>
                )}

                {/* Session Expired Notification */}
                {(lastError?.code === "session_expired" ||
                  lastError?.data?.requiresSignIn) && (
                  <div className="absolute left-4 right-4 bottom-4 z-50 animate-in slide-in-from-bottom-2 duration-300">
                    <div className="rounded-lg border border-amber-500/30 bg-black/90 backdrop-blur-md p-4">
                      <h3 className="text-amber-400 font-semibold text-sm">
                        Session Expired
                      </h3>
                      <p className="text-white/70 text-xs mt-1 mb-3">
                        Your session has expired. Please sign in again to
                        continue.
                      </p>
                      <button
                        onClick={handleSignIn}
                        className="w-full py-1.5 bg-amber-500 hover:bg-amber-400 rounded text-xs text-black font-bold flex items-center justify-center gap-2"
                      >
                        <LogIn className="w-3 h-3" />
                        Sign In
                      </button>
                    </div>
                  </div>
                )}

                {/* Session Refreshed Notification */}
                {lastError?.code === "session_refreshed" && (
                  <div className="absolute left-4 right-4 bottom-4 z-50 animate-in slide-in-from-bottom-2 duration-300">
                    <div className="rounded-lg border border-emerald-500/30 bg-black/90 backdrop-blur-md p-4">
                      <h3 className="text-emerald-400 font-semibold text-sm">
                        Session Refreshed
                      </h3>
                      <p className="text-white/70 text-xs mt-1">
                        Your session was refreshed. Please try your request
                        again.
                      </p>
                    </div>
                  </div>
                )}

                {/* View Switcher */}
                {hasMessages ? (
                  <ChatView
                    messages={messages}
                    currentResponse={currentResponse}
                    currentReasoning={currentReasoning}
                    currentToolCalls={currentToolCalls}
                    currentStreamChunks={currentStreamChunks}
                    thinkingStartTime={thinkingStartTime}
                    contextPaths={contextPaths}
                    onRemoveContext={handleRemoveContext}
                    onCollapse={handleShowCompact}
                    onOpenDashboard={handleOpenDashboard}
                    onNewChat={handleNewChat}
                    isRecording={isRecording}
                    onMicClick={handleMicClick}
                    conversations={convList}
                    loadingConversations={loadingConvs}
                    onSelectConversation={handleSelectConversation}
                    chatMenuOpen={chatMenuOpen}
                    onChatMenuOpenChange={setChatMenuOpen}
                    statusText={chatStatusText}
                    modelName={
                      typeof (ai as any)?.model === "string"
                        ? (ai as any).model
                        : ""
                    }
                    contextUsage={effectiveContextUsage}
                    contextModelId={
                      effectiveContextModelId ||
                      (typeof (ai as any)?.model === "string"
                        ? (ai as any).model
                        : undefined)
                    }
                    connectionStatus={connectionStatus}
                    chatMode={chatMode}
                    onChatModeChange={setChatMode as any}
                    chatModels={chatModels}
                    onChatModelsChange={setChatModels as any}
                    reasoningLevel={reasoningLevel}
                    onReasoningLevelChange={setReasoningLevel}
                    overlayMode={overlayMode}
                    tabs={tabs}
                    activeTabId={activeTabId}
                    onSwitchTab={switchTab}
                    onCloseTab={closeTab}
                    onAddTab={addTab}
                    translucentMode={translucentMode}
                    onSubmitToolOutput={submitToolOutput}
                    onGenUIResponse={handleGenUIResponse}
                    askUserPrompts={activeGenUITools}
                    onAskUserRespond={respondToGenUI}
                    onEditMessage={editMessage}
                    onRevertFiles={revertFiles}
                    pendingMemories={pendingMemories}
                    onConfirmPendingMemory={confirmPendingMemory}
                    onRejectPendingMemory={rejectPendingMemory}
                    onAddContext={handleAddContext}
                    attachments={attachments}
                    onRemoveAttachment={handleRemoveAttachment}
                    onAttachFiles={handleAttachFiles}
                    onAttachImages={handleAttachImages}
                    onPaste={handlePaste}
                    onDrop={handleDrop}
                    queueDepth={queueDepth}
                    queuedMessages={queuedMessages}
                    onCancelQueuedMessage={cancelQueuedMessage}
                    query={query}
                    setQuery={setQuery}
                    onSend={handleSend}
                    onStop={stopGeneration}
                    isStreaming={isStreaming}
                    internalSidebarOpen={internalSidebarOpen}
                    activeSidebarTab={activeSidebarTab}
                    onToggleInternalSidebar={handleToggleInternalSidebar}
                    onCloseInternalSidebar={handleCloseInternalSidebar}
                    onSwitchSidebarTab={handleSwitchSidebarTab}
                  />
                ) : (
                  <LauncherView
                    query={query}
                    setQuery={setQuery}
                    onSend={handleSend}
                    commands={commands}
                    statusText={inputStatusText}
                    connectionStatus={connectionStatus}
                    onMicClick={handleMicClick}
                    isRecording={isRecording}
                    onPaste={handlePaste}
                    accessToken={accessToken}
                    overlayMode={overlayMode}
                    conversations={convList}
                    loadingConversations={loadingConvs}
                    onSelectConversation={handleSelectConversation}
                    chatMenuOpen={chatMenuOpen}
                    onChatMenuOpenChange={setChatMenuOpen}
                    onNewChat={handleNewChat}
                    onOpenDashboard={handleOpenDashboard}
                    onCollapse={handleShowCompact}
                    onDeleteConversation={handleDeleteConversation}
                    onToggleExpand={handleShowWindow}
                    onToggleSidebar={handleToggleInternalSidebar}
                    sidebarOpen={internalSidebarOpen}
                    plannerData={plannerData}
                    translucentMode={translucentMode}
                    chatMode={chatMode}
                    onChatModeChange={setChatMode as any}
                    chatModels={chatModels}
                    onChatModelsChange={setChatModels as any}
                    reasoningLevel={reasoningLevel}
                    onReasoningLevelChange={setReasoningLevel}
                    tabs={tabs}
                    activeTabId={activeTabId}
                    onSwitchTab={switchTab}
                    onCloseTab={closeTab}
                    onAddTab={addTab}
                    // Internal Sidebar
                    activeSidebarTab={activeSidebarTab}
                    onCloseInternalSidebar={handleCloseInternalSidebar}
                    onSwitchSidebarTab={handleSwitchSidebarTab}
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col relative">
              {/* Environment Badge - compact mode (top-right) */}
              <EnvironmentBadge
                variant="minimal"
                className="absolute top-1 right-1 z-50"
              />
              <InputArea
                ref={inputRef}
                query={query}
                setQuery={setQuery}
                onSend={handleSend}
                attachments={attachments}
                onRemoveAttachment={handleRemoveAttachment}
                onAttachFiles={handleAttachFiles}
                onAttachImages={handleAttachImages}
                onPaste={handlePaste}
                onDrop={handleDrop}
                signedIn={signedIn}
                onSignIn={handleSignIn}
                conversationTitle={conversationTitle}
                conversations={convList}
                loadingConversations={loadingConvs}
                onSelectConversation={handleSelectConversation}
                onDeleteConversation={handleDeleteConversation}
                onNewChat={handleNewChat}
                onStopGeneration={stopGeneration}
                onChatMenuOpenChange={setChatMenuOpen}
                chatMenuOpen={chatMenuOpen}
                expanded={false}
                onToggleExpand={handleShowWindow}
                onOpenDashboard={handleOpenDashboard}
                overlayMode={overlayMode}
                statusText={inputStatusText}
                statusIcon={inputStatusIcon}
                statusUrgency={inputStatusUrgency}
                connectionStatus={connectionStatus}
                queueDepth={queueDepth}
                queuedMessages={queuedMessages}
                onCancelQueuedMessage={cancelQueuedMessage}
                isRecording={isRecording}
                onMicClick={handleMicClick}
                contextPaths={contextPaths}
                setContextPaths={setContextPaths}
                translucentMode={translucentMode}
                accessToken={accessToken}
                miniOutputText={miniOutputText}
                miniOutputHasContent={miniOutputHasContent}
                miniOutputStreaming={
                  isStreaming && !!(currentResponse || "").trim()
                }
                showMiniOutput={showMiniOutput}
                setShowMiniOutput={setShowMiniOutput}
                onSubmitToolOutput={submitToolOutput}
                onGenUIResponse={handleGenUIResponse}
                activeTabId={activeTabId}
              />
            </div>
          )}

          <CommandPalette
            open={showPalette}
            onClose={handleClosePalette}
            commands={commands}
            onQueryChange={setPaletteQuery}
            loading={isMarketplaceSearching || isPaletteAppSearching}
          />
          <HotkeysHelp open={showHotkeys} onClose={handleCloseHotkeys} />

          {/* Legacy spotlight tour (fallback for users who started old flow) */}
          {showTour && (
            <OnboardingFlow
              startAtTour={true}
              expanded={overlayMode === "sidebar" || overlayMode === "window"}
              onExpand={handleShowWindow}
              onComplete={() => setTourComplete(true)}
            />
          )}
        </div>

        {/* Stuard Workflow Overlay - renders native UI panels from automations */}
        <WorkflowOverlay />

        {/* Onboarding Tooltips */}
        <OnboardingTooltipContainer />
      </div>
    </NotificationProvider>
  );
}
