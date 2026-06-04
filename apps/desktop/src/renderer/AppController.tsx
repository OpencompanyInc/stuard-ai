import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import posthog from "posthog-js";
import 'katex/dist/katex.min.css'; // Global Katex styles
import { useAgent } from './hooks/useAgent';
import CommandPalette, { type CommandItem } from './components/CommandPalette';
import HotkeysHelp from './components/HotkeysHelp';
import { PermissionDialog } from './components/PermissionDialog';
import { AskUserPrompt } from '@stuardai/chat-ui/AskUserPrompt';
import InputArea from './components/chat/shared/input/InputArea';
import { clearTodoSnapshot } from './components/chat/shared/sidebar/agentTodoStore';
import type { ContextItem } from './components/FileNavigator';
import { usePreferences } from './hooks/usePreferences';
import { useModelRegistry } from './hooks/useModelRegistry';
import 'simplebar-react/dist/simplebar.min.css';
import './scrollbar.css';
import { supabase } from './lib/supabaseClient';
import { startBrowserSignIn } from './auth/browserSignIn';
import { useAppVoiceMode } from './hooks/useAppVoiceMode';
import { InteractiveTour } from './components/onboarding/InteractiveTour';
import { OnboardingProvider, OnboardingTooltipContainer } from './components/onboarding';
import { WorkflowOverlay } from './components/WorkflowOverlay/WorkflowOverlay';
import { NotificationProvider, NotificationController } from './components/NotificationSystem';
import {
  buildAttachmentMessageText,
  createClipboardDocumentAttachment,
  getChatAttachmentKind,
  normalizeChatAttachment,
  shouldConvertPasteToDocumentAttachment,
  type ChatAttachment,
} from './utils/attachments';
import { displayConversationTitle } from './utils/conversationTitle';

import { useSpeechToText } from './hooks/useSpeechToText';
import { usePlannerData } from './hooks/usePlannerData';
import { LauncherView } from './components/chat/modes/launcher/LauncherView';
import { ChatView } from './components/chat/modes/window/ChatView';
import { ToolBrandStack } from './components/chat/shared/input/ToolBrandStack';
import type { StatusItem } from './hooks/useStatusCarousel';
import { useActiveProject } from './hooks/useActiveProject';
import {
  INTERNAL_SIDEBAR_WIDTH_MAX,
  INTERNAL_SIDEBAR_WIDTH_MIN,
  useInternalSidebarWidth,
} from './hooks/useInternalSidebarWidth';
import { setConversationProject } from './hooks/useProjects';
import { ActiveProjectChip, ExitProjectToast } from './components/chat/modes/window/parts/ActiveProjectBar';
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
  Loader2,
  Sparkles
} from "lucide-react";

import { useWorkflows } from './workflows/hooks/useWorkflows';
import { getMarketplaceApi } from './utils/cloud';
import { filterCompactMarketplaceResults } from './utils/marketplaceSearch';

function dismissApprovalNotification(id: string) {
  try {
    (window as any).desktopAPI?.dismissNotification?.(id);
  } catch { }
}

const CLOUD_AI_HTTP = (window as any).__CLOUD_AI_HTTP__ || (import.meta as any).env?.VITE_CLOUD_AI_URL || 'http://127.0.0.1:8082';
const MONTHLY_CREDIT_LIMIT_EXCEEDED = 'monthly_credit_limit_exceeded';
const MAX_ATTACHMENT_BYTES = 65 * 1024 * 1024; // 65 MB

const ATTACHMENT_MIME_BY_EXT: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  aac: 'audio/aac',
  opus: 'audio/opus',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
};

function inferAttachmentMimeType(name: string, fallback?: string): string {
  const cleanFallback = String(fallback || '').trim();
  if (cleanFallback && cleanFallback !== 'application/octet-stream') return cleanFallback;
  const ext = String(name || '').split('.').pop()?.toLowerCase() || '';
  return ATTACHMENT_MIME_BY_EXT[ext] || cleanFallback || 'application/octet-stream';
}

function summarizeAttachmentNames(files: Array<{ name?: string }>): string {
  const names = files.map((file) => String(file?.name || '').trim()).filter(Boolean);
  if (names.length === 0) return 'attachment';
  if (names.length === 1) return names[0];
  return `${names.length} files`;
}

function formatAttachmentSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function getConversationRankTime(conversation: any): number {
  return new Date(conversation?.updated_at || conversation?.created_at || 0).getTime();
}

function sortConversationsByActivity(conversations: any[]): any[] {
  return [...conversations].sort((a, b) => getConversationRankTime(b) - getConversationRankTime(a));
}

export function useAppController() {
  // Refs
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const committedSpeechRef = useRef("");

  // State
  const [query, setQuery] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const { onboardingComplete, setOnboardingComplete, tourComplete, setTourComplete, tone, setTone, customTone, themeMode, setThemeMode, themeDarkShade, setThemeDarkShade, themeLightShade, setThemeLightShade, themeText, setThemeText, translucentMode, persona, wakewordEnabled, wakewordSensitivity, chatMode: defaultChatMode, setChatMode: setDefaultChatMode, chatModels: defaultChatModels, setChatModels: setDefaultChatModels, modelSource, setModelSource } = usePreferences();
  const { modelById } = useModelRegistry();
  const [reasoningLevel, setReasoningLevel] = useState<import('./hooks/usePreferences').ReasoningLevel>(() => {
    try { const v = localStorage.getItem('stuard.pref.reasoning_level'); return (v === 'low' || v === 'medium') ? v : 'high'; } catch { return 'high'; }
  });
  // Persist reasoning level
  useEffect(() => { try { localStorage.setItem('stuard.pref.reasoning_level', reasoningLevel); } catch {} }, [reasoningLevel]);
  const [showPalette, setShowPalette] = useState(false);
  const [showHotkeys, setShowHotkeys] = useState(false);
  const [updateState, setUpdateState] = useState<{ status: string; info?: any }>({ status: 'idle' });

  // Workflows & Marketplace Search
  const { items: localWorkflows, refresh: refreshWorkflows } = useWorkflows();
  const [paletteQuery, setPaletteQuery] = useState("");
  const [marketplaceResults, setMarketplaceResults] = useState<CommandItem[]>([]);
  const [isMarketplaceSearching, setMarketplaceSearching] = useState(false);
  const marketplaceDebounceRef = useRef<NodeJS.Timeout | null>(null);

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

    if (marketplaceDebounceRef.current) clearTimeout(marketplaceDebounceRef.current);

    setMarketplaceSearching(true);
    marketplaceDebounceRef.current = setTimeout(async () => {
      try {
        // Search marketplace
        const token = accessToken; // Use current access token if available
        const api = getMarketplaceApi(() => token);
        const res = await api.search({ query: q, limit: 5 });

        if (res.ok && res.results) {
          const filtered = filterCompactMarketplaceResults(res.results, q, { max: 5 });
          const items: CommandItem[] = filtered.map(w => ({
            id: `market-${w.slug}`,
            title: w.name,
            description: w.description,
            group: 'Marketplace',
            icon: <CloudDownload className="w-5 h-5" />,
            run: () => {
              window.desktopAPI.openWorkflows({ marketplaceSlug: w.slug });
            }
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
      if (marketplaceDebounceRef.current) clearTimeout(marketplaceDebounceRef.current);
    };
  }, [paletteQuery, showPalette, accessToken]);

  // UI State
  const [overlayMode, setOverlayMode] = useState<'compact' | 'sidebar' | 'window'>('compact');
  const [windowSize, setWindowSize] = useState({ width: 520, height: 130 });
  const [chatMenuOpen, setChatMenuOpen] = useState(false);
  const [conversationTitle, setConversationTitle] = useState<string | null>(null);
  const [convList, setConvList] = useState<any[]>([]);
  const [loadingConvs, setLoadingConvs] = useState(false);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [approvalQueue, setApprovalQueue] = useState<Array<{ id: string; tool: string; args?: Record<string, any>; description?: string }>>([]);
  const [askUserPrompt, setAskUserPrompt] = useState<{ id: string; args: any } | null>(null);
  const [contextPaths, setContextPaths] = useState<ContextItem[]>([]);
  const [overlayVisible, setOverlayVisible] = useState(true);

  const showAttachmentStatus = (message: string, notify = false) => {
    setUpdateState(prev => ({
      ...prev,
      info: { ...(prev.info || {}), attachmentStatus: message },
    }));
    if (notify) {
      try { (window as any).desktopAPI?.notify?.('Attachment', message); } catch { }
    }
    if (message) {
      window.setTimeout(() => {
        setUpdateState(prev => {
          if (prev.info?.attachmentStatus !== message) return prev;
          return { ...prev, info: { ...(prev.info || {}), attachmentStatus: '' } };
        });
      }, 3500);
    }
  };

  // Track whether the main window is focused/active
  const windowFocusedRef = useRef(document.hasFocus());
  useEffect(() => {
    const onFocus = () => { windowFocusedRef.current = true; };
    const onBlur = () => { windowFocusedRef.current = false; };
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    return () => { window.removeEventListener('focus', onFocus); window.removeEventListener('blur', onBlur); };
  }, []);

  // Listen for in-app ask_user prompts from main process
  useEffect(() => {
    const cleanup = (window as any).desktopAPI?.onAskUserShow?.((data: { promptId: string; args: any }) => {
      if (data?.promptId) {
        setAskUserPrompt({ id: data.promptId, args: data.args });
      }
    });
    return () => { cleanup?.(); };
  }, []);

  const [showMiniOutput, setShowMiniOutput] = useState(false);

  const overlayModeRef = useRef<'compact' | 'sidebar' | 'window'>(overlayMode);
  const prevOverlayModeRef = useRef<'compact' | 'sidebar' | 'window'>(overlayMode);
  const modeBeforeDockRef = useRef<'compact' | 'sidebar' | 'window'>('compact');

  useEffect(() => {
    overlayModeRef.current = overlayMode;
  }, [overlayMode]);

  useEffect(() => {
    const prev = prevOverlayModeRef.current;
    if ((overlayMode === 'sidebar' || overlayMode === 'window') && prev !== 'sidebar' && prev !== 'window') {
      modeBeforeDockRef.current = prev;
    }
    prevOverlayModeRef.current = overlayMode;
  }, [overlayMode]);

  // Reasoning/Thinking time tracking
  const [thinkingStartTime, setThinkingStartTime] = useState<number | undefined>(undefined);

  // Handle title updates from server - update conversation list in place
  const handleTitleUpdate = useCallback((cid: string, title: string) => {
    setConvList(prev => {
      const exists = prev.some(c => String(c.id) === String(cid));
      if (exists) {
        // Update existing conversation title
        return prev.map(c => String(c.id) === String(cid) ? { ...c, title } : c);
      } else {
        // Add new conversation to the top of the list
        const timestamp = new Date().toISOString();
        return [{ id: cid, title, created_at: timestamp, updated_at: timestamp }, ...prev];
      }
    });
    setConversationTitle(title);
  }, []);

  const handleConversationActivity = useCallback((cid: string, updatedAt?: string) => {
    const timestamp = updatedAt || new Date().toISOString();
    setConvList(prev => {
      const existing = prev.find(c => String(c.id) === String(cid));
      const next = existing
        ? { ...existing, updated_at: timestamp }
        : { id: cid, title: conversationTitle?.trim() || 'New conversation', created_at: timestamp, updated_at: timestamp };
      return [next, ...prev.filter(c => String(c.id) !== String(cid))].slice(0, 20);
    });
  }, [conversationTitle]);

  // Agent Hook
  const {
    messages, state, ai, currentResponse, currentReasoning, currentToolCalls, currentStreamChunks,
    sendMessage, steerMessage, steerSubagent, activeSubagentsByTab, stopGeneration, conversationId, newChat, loadConversation, deleteConversation,
    subscribeProgress, queueDepth, queuedMessages, cancelQueuedMessage, respondToApproval, lastError, clearLastError, execLocalTool, submitToolOutput,
    tabs, activeTabId, addTab, closeTab, switchTab,
    chatMode, setChatMode, chatModels, setChatModels,
    pendingMemories, confirmPendingMemory, rejectPendingMemory,
    editMessage, revertFiles, redoFiles,
    reconcileTerminalState,
  } = useAgent({
    onTitleUpdate: handleTitleUpdate,
    onConversationActivity: handleConversationActivity,
    initialChatMode: defaultChatMode,
    initialChatModels: defaultChatModels,
  }) as any;

  // Selected target for the next steer message in the main composer. 'orchestrator'
  // (the default) routes through queueSteeringMessage; any other value is a
  // delegated subagentId routed through steerSubagent. The list of active
  // cloud subagents per tab come from useAgent. Local Python/headless subagents
  // are discovered lower in ChatView, so only auto-reset stale cloud ids here.
  const [steerTarget, setSteerTarget] = useState<string>('orchestrator');
  const activeSubagentsForTab: Array<{ id: string; kind: string }> = useMemo(() => {
    const list = (activeSubagentsByTab as Record<string, Array<{ id: string; kind: string }>>)?.[activeTabId] || [];
    return list;
  }, [activeSubagentsByTab, activeTabId]);
  useEffect(() => {
    setSteerTarget('orchestrator');
  }, [activeTabId]);
  useEffect(() => {
    if (steerTarget.startsWith('sa-') && !activeSubagentsForTab.some(s => s.id === steerTarget)) {
      setSteerTarget('orchestrator');
    }
  }, [steerTarget, activeSubagentsForTab]);

  useEffect(() => {
    setChatModels(defaultChatModels);
  }, [defaultChatModels, setChatModels]);

  useEffect(() => {
    if (typeof chatMode === 'string' && chatMode.startsWith('codex/')) {
      setChatMode(`openai/${chatMode.slice('codex/'.length)}` as any);
      setModelSource('subscription');
    }
  }, [chatMode, setChatMode, setModelSource]);

  // Persist launcher model choice across tabs/restarts. useAgent's setters only
  // touch per-tab state; pair them with the preferences setters so the next
  // tab/session opens on the same model.
  const handleChatModeChange = useCallback((mode: any) => {
    setChatMode(mode);
    try { setDefaultChatMode(mode); } catch { }
  }, [setChatMode, setDefaultChatMode]);
  const handleChatModelsChange = useCallback((cfg: any) => {
    setChatModels(cfg);
    try { setDefaultChatModels(cfg); } catch { }
  }, [setChatModels, setDefaultChatModels]);

  // Listen for approval responses from notification overlay (when permission was handled out-of-app)
  useEffect(() => {
    const cleanup = (window as any).desktopAPI?.onApprovalResponse?.((data: { id: string; allow: boolean }) => {
      if (data?.id) {
        dismissApprovalNotification(data.id);
        respondToApproval(data.id, data.allow);
        setApprovalQueue((q) => q.filter((p) => p.id !== data.id));
      }
    });
    return () => { cleanup?.(); };
  }, [respondToApproval]);

  // Reconcile approval queue & request state from server on reconnect
  useEffect(() => {
    const cleanup = (window as any).desktopAPI?.onRunStateSync?.((sync: any) => {
      if (!sync) return;
      const serverApprovals: Array<{ id: string; tool: string; args?: Record<string, any>; description?: string }> = Array.isArray(sync.pendingApprovals) ? sync.pendingApprovals : [];
      if (serverApprovals.length > 0) {
        setApprovalQueue((prev) => {
          const ids = new Set(prev.map((p) => p.id));
          const merged = [...prev];
          for (const sa of serverApprovals) {
            if (!ids.has(sa.id)) {
              merged.push({ id: sa.id, tool: sa.tool, args: sa.args, description: sa.description });
              try {
                const toolLabel = sa.tool.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
                (window as any).desktopAPI?.notify?.({
                  id: sa.id,
                  title: 'Permission Required',
                  message: sa.description || `Stuard wants to use ${toolLabel}`,
                  variant: 'warning',
                  duration: 0,
                  sound: true,
                  permissionRequest: { id: sa.id, tool: sa.tool, args: sa.args, description: sa.description },
                });
              } catch { }
            }
          }
          return merged;
        });
      }
      const terminals: Array<{ requestId: string; result: any }> = Array.isArray(sync.terminals) ? sync.terminals : [];
      if (terminals.length > 0) {
        setApprovalQueue([]);
        reconcileTerminalState(terminals);
      }
    });
    return () => { cleanup?.(); };
  }, [reconcileTerminalState]);

  // Speech Hook
  const { isRecording, transcript, interimTranscript, startRecording, stopRecording, clearTranscript, error: speechError } = useSpeechToText();

  const { voice, voiceActive, handleToggleVoice, handleWakewordDetected } = useAppVoiceMode({ signedIn, overlayVisible });

  // Planner Hook
  const plannerData = usePlannerData(accessToken);

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
      setOverlayVisible(true);
      setShowMiniOutput(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    });
    const unsubHide = window.desktopAPI.onHide?.(() => {
      setOverlayVisible(false);
    });

    // Listen for open-chat requests (e.g. from Dashboard)
    const unsubOpen = window.desktopAPI.onOpenChat?.((id: string) => {
      if (id) {
        setOverlayMode('window');
        window.desktopAPI.setMode('window');
        loadConversation(id);
      }
    });
    return () => {
      try { unsubShow?.(); } catch { }
      try { unsubHide?.(); } catch { }
      try { unsubOpen && unsubOpen(); } catch { }
    };
  }, []);

  // Listen for chat sync events from VM (pushed via cloud-ai)
  useEffect(() => {
    const unsub = (window as any).desktopAPI?.onChatSyncEvent?.((event: any) => {
      if (!event?.conversationId) return;
      if (event.action === 'new_conversation' || event.action === 'new_message') {
        // Refresh conversation list so new/updated conversations appear
        setConvList(prev => {
          // If conversation already exists, bump it to the top
          const existing = prev.find(c => String(c.id) === String(event.conversationId));
          if (existing) {
            return [{ ...existing, updated_at: event.timestamp || existing.updated_at || existing.created_at }, ...prev.filter(c => String(c.id) !== String(event.conversationId))];
          }
          // New conversation - prepend it
          return [{ id: event.conversationId, title: event.data?.title || 'New conversation', created_at: event.timestamp, updated_at: event.timestamp }, ...prev].slice(0, 20);
        });
      } else if (event.action === 'title_update' && event.data?.title) {
        setConvList(prev => prev.map(c =>
          String(c.id) === String(event.conversationId)
            ? { ...c, title: event.data.title }
            : c
        ));
      }
    });
    return () => { try { unsub?.(); } catch {} };
  }, []);

  /* Legacy browser extension bridge removed.
    const unsub = undefined;
      if (data?.text) {
        // Inject page context into the message
        const contextNote = data.pageContext?.url
          ? `\n\n[Browser context: ${data.pageContext.title || ''} â€” ${data.pageContext.url}]`
          : '';
        sendMessage({
          text: data.text + contextNote,
          context: data.pageContext ? { browserPage: data.pageContext } : {},
        });
      }
    });
    return () => { try { unsub?.(); } catch {} };
  */

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
      if (data.mode === 'compact') {
        setInternalSidebarOpen(false);
      }
      // Window/sidebar modes are fully interactive (not click-through overlay)
      if (data.mode === 'window' || data.mode === 'sidebar') {
        try { window.desktopAPI?.setIgnoreMouseEvents?.(false); } catch { }
      }
    });

    // Listen for internal sidebar state changes from main process
    const unsubInternalSidebar = (window.desktopAPI as any)?.onInternalSidebarChanged?.((data: { open: boolean; width: number; panelWidth?: number }) => {
      setInternalSidebarOpen(data.open);
      setWindowSize(prev => ({ ...prev, width: data.width }));
      if (typeof data.panelWidth === 'number' && Number.isFinite(data.panelWidth)) {
        setInternalSidebarWidth(data.panelWidth);
      }
    });

    // Get initial size
    window.desktopAPI?.getSize?.().then((size: any) => {
      if (size) {
        setWindowSize({ width: size.width, height: size.height });
        setOverlayMode(size.mode as any);
      }
    }).catch(() => { });

    return () => {
      try { unsubResizing?.(); } catch { }
      try { unsubResized?.(); } catch { }
      try { unsubModeChanged?.(); } catch { }
      try { unsubInternalSidebar?.(); } catch { }
    };
  }, []);

  // Theme sync
  useEffect(() => {
    const unsub = (window as any).desktopAPI?.onThemeUpdated?.((data: any) => {
      try {
        const m = data?.themeMode;
        if (m === 'light' || m === 'dark' || m === 'custom' || m === 'default') {
          setThemeMode(m === 'dark' || m === 'custom' ? 'dark' : 'light');
        }
        if (typeof data?.themeDarkShade === 'string') setThemeDarkShade(data.themeDarkShade);
        if (typeof data?.themeLightShade === 'string') setThemeLightShade(data.themeLightShade);
        if (data?.themeText === 'white' || data?.themeText === 'black') setThemeText(data.themeText);
      } catch { }
    });
    return () => { try { (typeof unsub === 'function') && unsub(); } catch { } };
  }, [setThemeMode, setThemeDarkShade, setThemeLightShade, setThemeText]);

  // Apply theme to document element
  useEffect(() => {
    const root = document.documentElement;
    if (themeMode === 'dark') {
      root.setAttribute('data-theme', 'dark');
      root.classList.add('dark');
    } else {
      root.setAttribute('data-theme', 'light');
      root.classList.remove('dark');
    }

    root.style.removeProperty('--custom-gradient-start');
    root.style.removeProperty('--custom-gradient-end');
    root.style.removeProperty('--custom-text-color');

    // Also broadcast theme change to other windows if needed
    try { (window as any).desktopAPI?.broadcastTheme?.({ themeMode, themeDarkShade, themeLightShade, themeText }); } catch { }
  }, [themeMode, themeDarkShade, themeLightShade, themeText]);

  // Open onboarding wizard window when not complete, hide overlay to show only wizard
  useEffect(() => {
    if (!onboardingComplete) {
      // Small delay to ensure window is ready and visible before opening onboarding
      const timer = setTimeout(() => {
        try {
          window.desktopAPI.openOnboarding();
          // window.desktopAPI.hide(); // Keep overlay visible so we don't lose context
        } catch { }
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [onboardingComplete]);

  // Show tour in overlay after wizard is done
  const showTour = onboardingComplete && !tourComplete;

  // Ensure overlay is shown when tour starts
  useEffect(() => {
    if (showTour) {
      try { window.desktopAPI.show(); } catch { }
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

      const ctrl = pressed.has('Control');
      const shift = pressed.has('Shift');
      const up = pressed.has('ArrowUp');
      const down = pressed.has('ArrowDown');
      const left = pressed.has('ArrowLeft');
      const right = pressed.has('ArrowRight');

      let vx = 0, vy = 0;
      if (left) vx -= 1;
      if (right) vx += 1;
      if (up) vy -= 1;
      if (down) vy += 1;

      if (ctrl && (vx !== 0 || vy !== 0)) {
        // pixels per second
        const speed = shift ? 1500 : 900;
        // normalize diagonal
        const len = Math.hypot(vx, vy) || 1;
        vx /= len; vy /= len;
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
      if (e.key === 'Escape') {
        const mode = overlayModeRef.current;
        if (mode === 'sidebar' || mode === 'window') {
          setShowMiniOutput(false);
          setOverlayMode('compact');
          try { window.desktopAPI.setMode('compact'); } catch { }
          return;
        }
        setShowMiniOutput(false);
        window.desktopAPI.hide();
        return;
      }
      pressed.add(e.key);
      if (e.ctrlKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        if (rafId == null) rafId = requestAnimationFrame(stepLoop);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      pressed.delete(e.key);
      if (['Control', 'Shift', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && rafId != null) {
        // let the loop stop naturally next frame
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, []);

  // Global Hotkeys (Ctrl+T, Ctrl+W, Ctrl+Tab)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl+T for new tab + focus input
      if (e.key === 't' && e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        addTab();
        setTimeout(() => inputRef.current?.focus(), 0);
      }
      // Ctrl+W to close current tab
      if (e.key === 'w' && e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (tabs.length > 1) closeTab(activeTabId);
      }
      // Ctrl+Tab to cycle forward, Ctrl+Shift+Tab to cycle backward
      if (e.key === 'Tab' && e.ctrlKey) {
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
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [addTab, closeTab, tabs, activeTabId, switchTab]);

  // Agent Events (Approval, Canvas, Notifications)
  useEffect(() => {
    const unsub = subscribeProgress(async (evt: any) => {
      try {
        const d = evt.data || {};

        if (evt.event === 'wakeword_detected') {
          await handleWakewordDetected();
          return;
        }

        // Approval / Canvas / generic tool events (speech handled in a separate effect)
        if (evt.event === 'tool_event') {
          const toolName = String(d.tool || '');
          if (toolName === 'stream_speech') {
            // Speech-specific handling lives in a dedicated effect below
            return;
          }
          const status = String(d.status || '').toLowerCase();
          if (status === 'approval_required') {
            const id = String(d.id || '');
            const tool = String(d.tool || '');
            const args = (d.args && typeof d.args === 'object') ? d.args : undefined;
            const description = typeof d.description === 'string' ? d.description : undefined;
            if (id && tool) {
              setApprovalQueue((q) => q.some((p) => p.id === id) ? q : [...q, { id, tool, args, description }]);
              const toolLabel = tool.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
              try {
                (window as any).desktopAPI?.notify?.({
                  id,
                  title: 'Permission Required',
                  message: description || `Stuard wants to use ${toolLabel}`,
                  variant: 'warning',
                  duration: 0,
                  sound: true,
                  permissionRequest: { id, tool, args, description },
                });
              } catch { }
            }
          }
          if (status === 'completed') {
            const id = String(d.id || '');
            if (id) dismissApprovalNotification(id);
            setApprovalQueue((q) => q.filter((p) => p.id !== id));
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
      } catch { }
    });
    return () => { try { unsub?.(); } catch { } };
  }, [subscribeProgress, handleWakewordDetected]);

  // Wakeword service lifecycle
  useEffect(() => {
    if (!state?.connected) return;
    let canceled = false;
    const tryStart = async (retries = 5) => {
      for (let i = 0; i < retries && !canceled; i++) {
        try {
          if ((window as any).desktopAPI?.execTool) {
            if (wakewordEnabled) {
              await (window as any).desktopAPI.execTool('wakeword_start', { sensitivity: wakewordSensitivity, cooldown: 1.5, triggerCount: 8 });
            } else {
              await (window as any).desktopAPI.execTool('wakeword_stop', {});
            }
            return; // success
          }
        } catch { }
        // Wait a bit before retrying (desktopAPI might not be ready yet on startup)
        await new Promise(r => setTimeout(r, 500));
      }
    };
    tryStart();
    return () => { canceled = true; };
  }, [wakewordEnabled, wakewordSensitivity, state?.connected]);

  // Auth & Updates
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setSignedIn(!!data?.session);
      setAccessToken(data?.session?.access_token || null);
      try { await window.desktopAPI?.syncAuthSession?.(data?.session ?? null); } catch { }
      try { const s = await window.desktopAPI.updatesGetState(); if (s && typeof s.status === 'string') setUpdateState(s as any); } catch { }
    })();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(!!session);
      setAccessToken(session?.access_token || null);
      try { window.desktopAPI?.syncAuthSession?.(session ?? null); } catch { }
    });
    const unsubUpd = window.desktopAPI?.onUpdatesState?.((s: any) => { try { if (s && typeof s.status === 'string') setUpdateState(s); } catch { } });
    return () => { try { subscription.unsubscribe(); } catch { }; try { (typeof unsubUpd === 'function') && unsubUpd(); } catch { } };
  }, []);

  // Conversation Title
  useEffect(() => {
    let timer: any = null;
    const loadTitle = async () => {
      try {
        if (!conversationId) { setConversationTitle(null); return; }
        // Try local agent first
        try {
          const resp = await fetch(`http://127.0.0.1:8765/v1/memory/conversations/${conversationId}`);
          const json = await resp.json();
          if (json.ok && json.conversation?.title) {
            setConversationTitle(String(json.conversation.title).trim() || null);
            return;
          }
        } catch { }
        // Fallback to Supabase if signed in
        if (signedIn) {
          const { data, error } = await supabase
            .from('conversations')
            .select('title')
            .eq('id', conversationId)
            .single();
          if (!error) {
            const t = (data as any)?.title;
            setConversationTitle(t && String(t).trim() ? String(t).trim() : null);
          }
        }
      } catch { }
    };
    loadTitle();
    timer = setTimeout(loadTitle, 2000);
    return () => { if (timer) clearTimeout(timer); };
  }, [conversationId, signedIn]);

  // Fetch Conversations from local agent (works offline, no sign-in required)
  const fetchConversations = async () => {
    setLoadingConvs(true);
    try {
      // Primary: fetch from local agent which stores everything locally
      const resp = await fetch('http://127.0.0.1:8765/v1/memory/conversations?limit=20');
      const json = await resp.json();
      if (json.ok && Array.isArray(json.conversations)) {
        const convs = json.conversations
          .filter((c: any) => !['workflow', 'skill', 'proactive', 'bot'].includes(String(c.source || '').toLowerCase()))
          .map((c: any) => ({
            id: c.id || c.conversation_id,
            title: displayConversationTitle(c.title),
            created_at: c.created_at || c.updated_at,
            updated_at: c.updated_at || c.created_at,
          }))
          .sort((a: any, b: any) => getConversationRankTime(b) - getConversationRankTime(a))
          .slice(0, 20);
        if (convs.length > 0 || !signedIn) {
          setConvList(convs);
          setLoadingConvs(false);
          return;
        }
      }
    } catch {
      // Agent not running, fall through
    }
    // Fallback: try Supabase if signed in
    try {
      if (signedIn) {
        let { data, error } = await supabase
          .from('conversations')
          .select('id, title, created_at, updated_at')
          .not('source', 'in', '("workflow","skill","proactive","bot")')
          .order('updated_at', { ascending: false })
          .limit(20);

        if (error) {
          const legacy = await supabase
            .from('conversations')
            .select('id, title, created_at')
            .not('source', 'in', '("workflow","skill","proactive","bot")')
            .order('created_at', { ascending: false })
            .limit(20);
          data = (legacy.data || []).map((row: { id: string; title?: string; created_at: string; updated_at?: string }) => ({
            id: row.id,
            title: displayConversationTitle(row.title),
            created_at: row.created_at,
            updated_at: row.updated_at ?? row.created_at,
          }));
          error = legacy.error;
        }

        if (error) {
          const oldestSchema = await supabase
            .from('conversations')
            .select('id, title, created_at')
            .order('created_at', { ascending: false })
            .limit(20);
          data = (oldestSchema.data || []).map((row: { id: string; title?: string; created_at: string; updated_at?: string }) => ({
            id: row.id,
            title: displayConversationTitle(row.title),
            created_at: row.created_at,
            updated_at: row.updated_at ?? row.created_at,
          }));
          error = oldestSchema.error;
        }

        if (!error) { setConvList(Array.isArray(data) ? sortConversationsByActivity(data) : []); }
      }
    } catch { }
    setLoadingConvs(false);
  };

  useEffect(() => {
    if (chatMenuOpen) {
      void fetchConversations();
    }
  }, [chatMenuOpen, signedIn]);

  // --- Sidebar & Tabs State ---
  const [internalSidebarOpen, setInternalSidebarOpen] = useState(false);
  const [activeSidebarTab, setActiveSidebarTab] = useState<'terminal' | 'todo' | 'projects'>('projects');
  const { width: internalSidebarWidth, setWidth: setInternalSidebarWidth } = useInternalSidebarWidth();
  const internalSidebarWidthRef = useRef(internalSidebarWidth);
  internalSidebarWidthRef.current = internalSidebarWidth;

  const handleSignIn = useCallback(async () => await startBrowserSignIn(), []);

  const handleShowCompact = useCallback(() => {
    setOverlayMode('compact');
    window.desktopAPI.setMode('compact');
  }, []);

  const handleNewChat = useCallback(() => {
    newChat();
    setChatMenuOpen(false);
    setConversationTitle(null);
    // Drop the previous chat's agent plan so the To-Do panel starts clean.
    clearTodoSnapshot();
  }, [newChat]);

  const handleSelectConversation = useCallback((id: string) => {
    try {
      const item = convList.find((c: any) => String(c.id) === String(id));
      if (item) setConversationTitle(displayConversationTitle(item.title));
    } catch { }
    loadConversation(id);
    setChatMenuOpen(false);
    // The agent plan is session-scoped and ephemeral — don't carry it into a
    // different conversation.
    clearTodoSnapshot();
  }, [convList, loadConversation]);

  const handleDeleteConversation = useCallback(async (id: string) => {
    try {
      // 1. Delete from local agent
      await deleteConversation(id);

      // 2. Delete from Supabase if signed in
      if (signedIn) {
        await supabase.from('conversations').delete().eq('id', id);
      }

      // 3. Update local list
      setConvList(prev => prev.filter(c => String(c.id) !== String(id)));

      // 4. If it was the active conversation and we cleared it in useAgent, update title
      if (conversationId === id) {
        setConversationTitle(null);
      }

      try { (window as any).desktopAPI?.notify?.('Deleted', 'Conversation removed.'); } catch { }
    } catch (err) {
      console.error('Failed to delete conversation:', err);
    }
  }, [deleteConversation, signedIn, conversationId]);

  const canSteerCurrentTurn =
    ai?.phase === 'routing' ||
    ai?.phase === 'tool' ||
    ai?.phase === 'responding' ||
    Boolean(currentResponse || currentReasoning || currentToolCalls?.length);

  // Use ref to avoid recreating handleSend on every render
  const handleSendRef = useRef<(overrideText?: string, sendOptions?: { quick?: boolean }) => void>(() => { });

  handleSendRef.current = useCallback((overrideText?: string, sendOptions?: { quick?: boolean }) => {
    if (!signedIn) { handleSignIn(); return; }
    const text = (typeof overrideText === 'string' ? overrideText : query).trim();
    if (!text && attachments.length === 0 && contextPaths.length === 0) return;

    const isQuick = sendOptions?.quick === true;

    const unreadableAttachment = attachments.find((attachment) => !attachment.data || !String(attachment.data).trim());
    if (unreadableAttachment) {
      showAttachmentStatus(`Couldn't send ${unreadableAttachment.name}: file data is missing`, true);
      return;
    }

    const tooLargeAttachment = attachments.find((attachment) => {
      const data = typeof attachment.data === 'string' ? attachment.data : '';
      return data.length > Math.ceil(MAX_ATTACHMENT_BYTES * 4 / 3);
    });
    if (tooLargeAttachment) {
      showAttachmentStatus(`Couldn't send ${tooLargeAttachment.name}: max file size is 65 MB`, true);
      return;
    }

    if (attachments.some((attachment) => getChatAttachmentKind(attachment) === 'audio')) {
      showAttachmentStatus('Sending audio attachment...');
    }

    if (lastError?.code === MONTHLY_CREDIT_LIMIT_EXCEEDED) {
      clearLastError?.();
    }

    let modeToSend: string;
    let modelIdToSend: string | undefined;
    let reasoningToSend = reasoningLevel;

    if (isQuick) {
      modeToSend = 'fast';
      modelIdToSend = typeof chatModels?.fast?.default === 'string' && chatModels.fast.default.trim()
        ? chatModels.fast.default.trim()
        : undefined;
      reasoningToSend = 'none';
    } else {
      const selected = (typeof chatMode === 'string' && chatMode.trim()) ? chatMode.trim() : 'auto';
      const isAuto = selected === 'auto';
      const meta = !isAuto ? modelById.get(selected) : undefined;
      modeToSend = isAuto ? 'auto' : ((meta?.category as any) || (meta?.isReasoning ? 'smart' : 'balanced'));
      modelIdToSend = !isAuto ? selected : undefined;
    }

    // Build modelConfig from chatModels so server knows tier defaults
    const modelConfigToSend = chatModels ? {
      fast: { default: chatModels.fast?.default },
      balanced: { default: chatModels.balanced?.default },
      smart: { default: chatModels.smart?.default },
    } : undefined;

    // Build context with paths
    const contextData: Record<string, any> = {
      tone: (tone === 'custom' ? customTone : tone),
      tonePreset: tone,
      persona
    };

    // Add file/folder paths as context
    if (contextPaths.length > 0) {
      contextData.paths = contextPaths.map(p => ({
        path: p.path,
        name: p.name,
        isDirectory: p.isDirectory,
        type: p.type,
        metadata: p.metadata,
      }));
    }

    const doSend = (skills: any[]) => {
      if (skills.length > 0) contextData.skills = skills;
      if (isQuick) contextData.quickResponse = true;
      const fallbackText = buildAttachmentMessageText(attachments, contextPaths);
      sendMessage({
        text: text || fallbackText || 'Attached files',
        attachments: attachments.map(a => ({
          type: a.type,
          name: a.name,
          data: a.data,
          mimeType: a.mimeType,
          path: a.path,
          source: a.source,
          previewText: a.previewText,
          lineCount: a.lineCount,
          charCount: a.charCount,
        })),
        context: contextData,
        contextPaths: contextPaths.length > 0 ? contextPaths : undefined,
        mode: modeToSend,
        modelId: typeof modelIdToSend === 'string' ? modelIdToSend : undefined,
        modelSource,
        modelConfig: modelConfigToSend,
        reasoningLevel: reasoningToSend,
        skipMemoryIngestion: isQuick,
      });
      setQuery("");
      setAttachments([]);
      setContextPaths([]);
      // Clear speech transcript state so it doesn't re-sync stale text
      clearTranscript();
      baseQueryRef.current = "";
    };

    // Quick sends fire immediately — no skills round-trip (saves ~50–200 ms).
    if (isQuick) {
      doSend([]);
      return;
    }

    // Attach active skills so the agent has them in its system prompt
    Promise.resolve()
      .then(() => (window as any).desktopAPI?.skillsList?.())
      .then((res: any) => (res?.skills || []).filter((s: any) => s.isActive !== false))
      .catch(() => [])
      .then((skills: any[]) => doSend(skills));
  }, [signedIn, query, attachments, contextPaths, chatMode, chatModels, modelById, modelSource, tone, customTone, persona, reasoningLevel, sendMessage, handleSignIn, clearTranscript, lastError, clearLastError]);

  // Stable callback ref for child components
  const handleSend = useCallback((overrideText?: string) => {
    handleSendRef.current(overrideText);
  }, []);

  const handleQuickSend = useCallback((overrideText?: string) => {
    handleSendRef.current(overrideText, { quick: true });
  }, []);

  // Wrap editMessage so resends use the currently-selected model (matches handleSend),
  // instead of letting the server fall back to its default tier (e.g. "balanced").
  const handleEditMessage = useCallback((messageId: string, newText: string) => {
    const selected = (typeof chatMode === 'string' && chatMode.trim()) ? chatMode.trim() : 'auto';
    const isAuto = selected === 'auto';
    const meta = !isAuto ? modelById.get(selected) : undefined;
    const mode = isAuto ? 'auto' : ((meta?.category as any) || (meta?.isReasoning ? 'smart' : 'balanced'));
    const modelId = !isAuto ? selected : undefined;
    const modelConfig = chatModels ? {
      fast: { default: chatModels.fast?.default },
      balanced: { default: chatModels.balanced?.default },
      smart: { default: chatModels.smart?.default },
    } : undefined;
    const context: Record<string, any> = {
      tone: (tone === 'custom' ? customTone : tone),
      tonePreset: tone,
      persona,
    };
    return editMessage(messageId, newText, {
      mode,
      modelId,
      modelSource,
      modelConfig,
      reasoningLevel,
      context,
    });
  }, [chatMode, chatModels, modelById, modelSource, tone, customTone, persona, reasoningLevel, editMessage]);

  const handleSteer = useCallback(() => {
    if (!signedIn) { handleSignIn(); return; }
    const text = query.trim();
    if (!text || attachments.length > 0 || contextPaths.length > 0 || !canSteerCurrentTurn) return;

    // Route to a delegated subagent when one is selected as the target,
    // otherwise nudge the orchestrator with the normal interjection flow.
    const targetedSubagent = steerTarget !== 'orchestrator'
      ? activeSubagentsForTab.find(s => s.id === steerTarget)
      : undefined;
    const ok = targetedSubagent
      ? Boolean(steerSubagent?.(targetedSubagent.id, text, { kind: targetedSubagent.kind, tabId: activeTabId }))
      : Boolean(steerMessage?.(text));
    if (ok) {
      setQuery("");
      clearTranscript();
      baseQueryRef.current = "";
    }
  }, [signedIn, query, attachments.length, contextPaths.length, canSteerCurrentTurn, steerMessage, steerSubagent, steerTarget, activeSubagentsForTab, activeTabId, handleSignIn, clearTranscript]);

  // Handle GenUI responses (syntax-based GenUI like ```genui:choices)
  const handleGenUIResponse = useCallback((component: string, result: any) => {
    // Format the selection as a follow-up message
    let responseText = '';

    if (result?.action === 'connect' && result?.slug) {
      // For integration connect - the IntegrationConnect component handles the actual OAuth flow
      // Just notify the AI that the user connected
      responseText = `Connected integration: ${result.slug}`;
    } else if (result?.selectedId) {
      // For choices
      responseText = `Selected: ${result.selectedId}`;
    } else if (result?.confirmed !== undefined) {
      // For confirmation
      responseText = result.confirmed ? 'Confirmed' : 'Cancelled';
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
        silent: true
      });
    }
  }, [sendMessage]);

  // Base query before recording started
  const baseQueryRef = useRef("");

  // Sync speech to query
  useEffect(() => {
    if (isRecording) {
      const base = baseQueryRef.current;
      const tSpacer = (transcript && /[a-z0-9]$/i.test(transcript) && /^[a-z0-9]/i.test(interimTranscript)) ? ' ' : '';
      const fullText = transcript + tSpacer + interimTranscript;
      const spacer = (base && /[a-z0-9]$/i.test(base) && /^[a-z0-9]/i.test(fullText)) ? ' ' : (base ? ' ' : '');
      const full = base + spacer + fullText;
      setQuery(full);

      // Auto-send check
      const pattern = /(?:send\s+(?:stuard|steward))[\.\!\?]?\s*$/i;
      if (pattern.test(full)) {
        const clean = full.replace(pattern, '').trim();
        setQuery(clean);
        stopRecording();
        setTimeout(() => handleSendRef.current(clean), 50);
      }
    }
  }, [transcript, interimTranscript, isRecording, stopRecording]);

  // Handle Speech Errors
  useEffect(() => {
    if (speechError) {
      try { (window as any).desktopAPI.notify('Speech Error', speechError); } catch { }
    }
  }, [speechError]);

  const handleMicClick = useCallback(async () => {
    if (isRecording) {
      stopRecording();
    } else {
      if (!signedIn) { handleSignIn(); return; }
      baseQueryRef.current = query;
      startRecording();
    }
  }, [isRecording, signedIn, query, stopRecording, startRecording, handleSignIn]);

  // Attachments
  const fileToAttachment = (
    file: File,
    source: ChatAttachment['source'] = 'clipboard-file',
  ): Promise<ChatAttachment> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const result = String(reader.result || '');
          let base64 = '';
          let mimeType = inferAttachmentMimeType(file.name, file.type || '');
          if (result.startsWith('data:')) {
            const comma = result.indexOf(',');
            const header = result.slice(5, result.indexOf(';'));
            mimeType = inferAttachmentMimeType(file.name, mimeType || header || 'application/octet-stream');
            base64 = comma >= 0 ? result.slice(comma + 1) : '';
          } else {
            base64 = result;
          }
          const isImage = typeof mimeType === 'string' && mimeType.toLowerCase().startsWith('image/');
          const fallbackExt = isImage ? (mimeType.split('/')[1] || 'png') : '';
          const name = file.name && file.name.trim() ? file.name : (isImage ? `pasted_image.${fallbackExt}` : 'pasted_file');
          resolve(normalizeChatAttachment({
            type: isImage ? 'image' : 'file',
            name,
            data: base64,
            mimeType: mimeType || 'application/octet-stream',
            source,
          }));
        } catch (e) { reject(e); }
      };
      reader.onerror = (e) => reject(e);
      reader.readAsDataURL(file);
    });
  };

  const addAttachmentsFromFiles = useCallback(async (
    files: File[] | FileList,
    source: ChatAttachment['source'] = 'clipboard-file',
  ) => {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    showAttachmentStatus(`Attaching ${summarizeAttachmentNames(arr)}...`);
    const tooLarge = arr.filter(f => f.size > MAX_ATTACHMENT_BYTES);
    const valid = arr.filter(f => f.size <= MAX_ATTACHMENT_BYTES);
    if (tooLarge.length > 0) {
      const names = tooLarge.map(f => `${f.name} (${formatAttachmentSize(f.size)})`).join(', ');
      showAttachmentStatus(`Skipped large file${tooLarge.length === 1 ? '' : 's'}: max 65 MB`, true);
      try { alert(`File too large (max 65 MB): ${names}`); } catch { }
      if (valid.length === 0) return;
    }
    const results = await Promise.allSettled(valid.map((file) => fileToAttachment(file, source)));
    const atts = results
      .filter((result): result is PromiseFulfilledResult<ChatAttachment> => result.status === 'fulfilled')
      .map((result) => result.value);
    const failed = results.length - atts.length;
    if (atts.length > 0) {
      setAttachments((prev) => [...prev, ...atts]);
      showAttachmentStatus(`Attached ${summarizeAttachmentNames(atts)}`);
    }
    if (failed > 0) {
      showAttachmentStatus(`Couldn't attach ${failed} file${failed === 1 ? '' : 's'}`, true);
    }
  }, []);

  const handleAttachFiles = useCallback(async () => {
    try {
      showAttachmentStatus('Opening file picker...');
      const files = await window.desktopAPI.selectFiles();
      if (!files || files.length === 0) {
        showAttachmentStatus('');
        return;
      }
      const normalized = files.map(f => normalizeChatAttachment({
        type: 'file' as const,
        ...f,
        mimeType: inferAttachmentMimeType(f.name, f.mimeType),
      }));
      setAttachments(prev => [...prev, ...normalized]);
      showAttachmentStatus(`Attached ${summarizeAttachmentNames(normalized)}`);
    } catch (error: any) {
      showAttachmentStatus(`Couldn't attach file: ${String(error?.message || 'unknown error')}`, true);
    }
  }, []);

  const handleAttachImages = useCallback(async () => {
    try {
      showAttachmentStatus('Opening image picker...');
      const images = await window.desktopAPI.selectImages();
      if (!images || images.length === 0) {
        showAttachmentStatus('');
        return;
      }
      const normalized = images.map(i => normalizeChatAttachment({ type: 'image' as const, ...i }));
      setAttachments(prev => [...prev, ...normalized]);
      showAttachmentStatus(`Attached ${summarizeAttachmentNames(normalized)}`);
    } catch (error: any) {
      showAttachmentStatus(`Couldn't attach image: ${String(error?.message || 'unknown error')}`, true);
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    try {
      // First check for URLs (for dragging links from browser)
      const uriList = e.dataTransfer?.getData('text/uri-list');
      const plainText = e.dataTransfer?.getData('text/plain');
      const htmlText = e.dataTransfer?.getData('text/html');

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
            return fullUrlMatch ? fullUrlMatch[0] : `https://youtube.com/watch?v=${match[1]}`;
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
        setQuery(prev => {
          const trimmed = prev.trim();
          return trimmed ? `${trimmed} ${droppedUrl}` : droppedUrl!;
        });
        return; // Don't process as file
      }

      // Fall back to file handling
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) await addAttachmentsFromFiles(files, 'drop');
    } catch (error: any) {
      showAttachmentStatus(`Drop failed: ${String(error?.message || 'could not read file')}`, true);
    }
  }, [addAttachmentsFromFiles]);

  const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    try {
      const cd = e.clipboardData;
      if (!cd) return;
      const files: File[] = Array.from(cd.items || []).filter((it) => it.kind === 'file').map((it) => it.getAsFile()).filter((f): f is File => !!f);
      if (files.length > 0) {
        const hasText = Array.from(cd.types || []).includes('text/plain');
        if (!hasText) e.preventDefault();
        await addAttachmentsFromFiles(files, 'clipboard-file');
        return;
      }

      const text = cd.getData('text/plain');
      if (shouldConvertPasteToDocumentAttachment(text)) {
        e.preventDefault();
        setAttachments((prev) => [...prev, createClipboardDocumentAttachment(text)]);
        showAttachmentStatus('Attached pasted text');
      }
    } catch (error: any) {
      showAttachmentStatus(`Paste failed: ${String(error?.message || 'could not read clipboard')}`, true);
    }
  }, [addAttachmentsFromFiles]);

  // Memoized callbacks for child components to prevent re-renders
  const handleOpenDashboard = useCallback(() => window.desktopAPI.openDashboard(), []);
  const handleOpenBilling = useCallback(() => {
    try {
      window.desktopAPI.openDashboard({ tab: 'settings' });
    } catch {
      try {
        (window as any).desktopAPI?.openExternal?.('https://stuard.ai/dashboard/billing');
      } catch { }
    }
  }, []);

  const showCreditsLimitNotice = lastError?.code === MONTHLY_CREDIT_LIMIT_EXCEEDED;
  const handleDismissCreditsLimitNotice = useCallback(() => {
    clearLastError?.();
  }, [clearLastError]);

  const refreshCreditsAndClearNotice = useCallback(async () => {
    if (!showCreditsLimitNotice) return;
    try {
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      if (!token) return;
      const resp = await fetch(`${String(CLOUD_AI_HTTP).replace(/\/$/, '')}/v1/credits`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await resp.json();
      if (j?.ok && (j.unlimited || (Number(j.remaining) || 0) > 0)) {
        clearLastError?.();
      }
    } catch { }
  }, [showCreditsLimitNotice, clearLastError]);

  useEffect(() => {
    if (!showCreditsLimitNotice) return;
    const onFocus = () => { void refreshCreditsAndClearNotice(); };
    window.addEventListener('focus', onFocus);
    const interval = setInterval(() => { void refreshCreditsAndClearNotice(); }, 15000);
    void refreshCreditsAndClearNotice();
    return () => {
      window.removeEventListener('focus', onFocus);
      clearInterval(interval);
    };
  }, [showCreditsLimitNotice, refreshCreditsAndClearNotice]);
  const handleToggleSpaces = useCallback(() => window.desktopAPI.toggleSpaces(), []);
  const handleRemoveContext = useCallback((idx: number) => setContextPaths(prev => prev.filter((_, i) => i !== idx)), []);
  const handleAddContext = useCallback((item: ContextItem) => setContextPaths(prev => prev.some(p => p.path === item.path) ? prev : [...prev, item]), []);
  const handleRemoveAttachment = useCallback((i: number) => setAttachments(p => p.filter((_, idx) => idx !== i)), []);

  const handleToggleInternalSidebar = useCallback(async () => {
    const nextState = !internalSidebarOpen;

    // Only expand/contract window in sidebar/window modes
    if (overlayMode === 'sidebar' || overlayMode === 'window') {
      // Let the main process handle window width expansion/contraction
      try {
        const result = await (window.desktopAPI as any).toggleInternalSidebar?.(nextState, internalSidebarWidthRef.current);
        if (result) {
          setInternalSidebarOpen(result.open);
          if (typeof result.panelWidth === 'number') {
            setInternalSidebarWidth(result.panelWidth);
          }
          return;
        }
      } catch (e) {
        console.warn('toggleInternalSidebar failed, falling back:', e);
      }
    }

    // Fallback: just toggle state without window resize
    setInternalSidebarOpen(nextState);
  }, [internalSidebarOpen, overlayMode, setInternalSidebarWidth]);

  const handleCloseInternalSidebar = useCallback(async () => {
    // Contract window width when closing sidebar
    if (overlayMode === 'sidebar' || overlayMode === 'window') {
      try {
        const result = await (window.desktopAPI as any).toggleInternalSidebar?.(false, internalSidebarWidthRef.current);
        if (result) {
          setInternalSidebarOpen(result.open);
          return;
        }
      } catch (e) {
        console.warn('toggleInternalSidebar(close) failed:', e);
      }
    }
    setInternalSidebarOpen(false);
  }, [overlayMode]);

  const handleInternalSidebarResize = useCallback((delta: number) => {
    const next = Math.max(
      INTERNAL_SIDEBAR_WIDTH_MIN,
      Math.min(INTERNAL_SIDEBAR_WIDTH_MAX, internalSidebarWidthRef.current + delta),
    );
    if (next === internalSidebarWidthRef.current) return;

    setInternalSidebarWidth(next);

    if (internalSidebarOpen && (overlayMode === 'sidebar' || overlayMode === 'window')) {
      void (window.desktopAPI as any).resizeInternalSidebar?.(next);
    }
  }, [internalSidebarOpen, overlayMode, setInternalSidebarWidth]);
  const handleSwitchSidebarTab = useCallback((tab: 'terminal' | 'todo' | 'projects') => setActiveSidebarTab(tab), []);

  // Auto-open sidebar when an agent runs a terminal command, starts a headed
  // CLI session, or creates a to-do list. The sidebar opens to the relevant tab.
  useEffect(() => {
    if (overlayMode !== 'window' && overlayMode !== 'sidebar') return;

    const openSidebarToTab = async (tab: 'terminal' | 'todo') => {
      // Only claim the tab when we actually open the panel. Once it's open the
      // SidebarTabsPanel owns tab switching (once per burst, respecting manual
      // choice) — re-setting it on every streamed update would yank the user
      // back to this tab repeatedly.
      if (internalSidebarOpen) return;
      setActiveSidebarTab(tab);
      try {
        const result = await (window.desktopAPI as any).toggleInternalSidebar?.(true, internalSidebarWidthRef.current);
        if (result) {
          setInternalSidebarOpen(result.open);
          return;
        }
      } catch {}
      setInternalSidebarOpen(true);
    };

    const handleTodo = () => { void openSidebarToTab('todo'); };
    const handleTerminal = () => { void openSidebarToTab('terminal'); };

    window.addEventListener('agent-todo-update', handleTodo);
    window.addEventListener('agent-terminal-activity', handleTerminal);

    const unsubCli = window.desktopAPI?.onCliAgentSessionStarted?.(() => {
      window.dispatchEvent(new CustomEvent('agent-terminal-activity'));
      void openSidebarToTab('terminal');
    });

    return () => {
      window.removeEventListener('agent-todo-update', handleTodo);
      window.removeEventListener('agent-terminal-activity', handleTerminal);
      unsubCli?.();
    };
  }, [overlayMode, internalSidebarOpen]);

  const handleClosePalette = useCallback(() => setShowPalette(false), []);
  const handleCloseHotkeys = useCallback(() => setShowHotkeys(false), []);

  const statusLabel = useMemo(() => {
    const p = (ai?.phase || '').toString();
    if (p === 'routing') {
      const m = (ai as any)?.model;
      return m ? `Routing (${m})` : 'Routing...';
    }
    if (p === 'responding') return 'Responding...';
    if (p === 'tool') {
      // Show description or humanized tool name from AI state
      const toolName = (ai as any)?.tool || '';
      const statusText = ai?.statusText || '';
      // If statusText contains tool info, use it; otherwise show humanized name
      if (statusText && statusText !== 'Running tool...') return statusText;
      if (toolName) {
        const humanName = toolName.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
        return `${humanName}...`;
      }
      return 'Running tool...';
    }
    return ai?.statusText || 'Ready';
  }, [ai]);

  // Determine if AI is currently streaming (for stop button)
  const isStreaming = useMemo(() => {
    const p = (ai?.phase || '').toString().toLowerCase();
    // Include delegated-subagent phases so the delegation rectangle stays
    // in the active (red) state after the orchestrator turn ends.
    return p === 'routing' || p === 'responding' || p === 'tool' || p.includes('subagent');
  }, [ai]);

  // Project Mode — resolve the project stamped on the current conversation
  // and surface it as a chat lock-in (accent border + sticky bar + chip).
  const { project: activeProject, refresh: refreshActiveProject } = useActiveProject(
    conversationId,
    isStreaming,
  );
  const [exitedProject, setExitedProject] = useState<typeof activeProject>(null);
  const handleExitProjectMode = useCallback(async () => {
    if (!conversationId || !activeProject) return;
    const snapshot = activeProject;
    await setConversationProject(conversationId, null);
    setExitedProject(snapshot);
    window.dispatchEvent(new CustomEvent('project-mode-changed'));
  }, [conversationId, activeProject]);
  const handleUndoExit = useCallback(async () => {
    if (!conversationId || !exitedProject) return;
    await setConversationProject(conversationId, exitedProject.id);
    setExitedProject(null);
    window.dispatchEvent(new CustomEvent('project-mode-changed'));
  }, [conversationId, exitedProject]);
  const handleOpenProjectHome = useCallback(() => {
    try {
      (window as any).desktopAPI?.openSidebar?.({ tab: 'projects', expanded: true });
    } catch { /* ignore */ }
  }, []);

  const inputStatusText = useMemo(() => {
    const attachmentStatus = typeof updateState.info?.attachmentStatus === 'string'
      ? updateState.info.attachmentStatus
      : '';
    if (isRecording) return 'Recording...';
    if (queueDepth > 0) return `Queued: ${queueDepth}`;
    if (attachmentStatus) return attachmentStatus;
    if (state?.connecting) return 'Connecting\u2026';
    if (!state?.connected) {
      if (state?.status === 'error') return 'Connection error';
      return 'Starting\u2026';
    }
    // Check if AI is actively doing something (not idle states)
    const idleStates = ['ready', 'idle', 'connected', ''];
    const isIdle = idleStates.includes(statusLabel.toLowerCase());
    // Show AI status if active, otherwise show planner next up
    if (!isIdle) return statusLabel;
    // Show next upcoming event/task/reminder when idle
    if (plannerData?.nextUp) {
      return `${plannerData.nextUp.title} ${plannerData.nextUp.timeLabel}`;
    }
    if (messages.length > 0) return '';
    return 'Ready';
  }, [isRecording, queueDepth, updateState.info, statusLabel, plannerData?.nextUp, messages.length]);

  // AI is "working" only for actual inference phases — NOT connection setup.
  // Connecting/starting/disconnected/error should not surface the video icon.
  const isAiWorking = useMemo(() => {
    const p = (ai?.phase || '').toString();
    return p === 'routing' || p === 'responding' || p === 'tool';
  }, [ai?.phase]);

  const WORKING_PHASES = useMemo(() => new Set(['routing', 'responding', 'tool']), []);

  /** Active AI work across tabs, queue, and delegated subagents — feeds compact task counter. */
  const backgroundTaskCount = useMemo(() => {
    let count = 0;
    for (const tab of tabs) {
      if (WORKING_PHASES.has(tab.aiState?.phase || '')) count++;
    }
    count += queueDepth;
    for (const list of Object.values(activeSubagentsByTab || {})) {
      count += Array.isArray(list) ? list.length : 0;
    }
    return count;
  }, [tabs, queueDepth, activeSubagentsByTab, WORKING_PHASES]);

  /** Per-tab snapshot for the compact hub task list. */
  const compactHubTabs = useMemo(() => {
    return (tabs as Array<{
      id: string;
      title: string;
      messages: Array<{ role: string; text?: string }>;
      currentResponse: string;
      aiState: { phase: string; statusText: string };
    }>).map((tab) => {
      const lastMsg = tab.messages[tab.messages.length - 1];
      const lastUser = [...tab.messages].reverse().find((m) => m.role === 'user');
      const streaming = !!(tab.currentResponse || '').trim();
      const preview = streaming
        ? tab.currentResponse
        : lastMsg?.role === 'assistant'
          ? String(lastMsg.text || '')
          : '';
      return {
        id: tab.id,
        title: tab.title?.trim() || 'Chat',
        isWorking: WORKING_PHASES.has(tab.aiState?.phase || ''),
        statusText: tab.aiState?.statusText || 'Idle',
        userPrompt: String(lastUser?.text || '').trim(),
        assistantText: String(preview || '').trim(),
        isStreaming: streaming && tab.id === activeTabId,
      };
    });
  }, [tabs, activeTabId, WORKING_PHASES]);

  // Compute status icon based on current state
  const inputStatusIcon = useMemo((): 'video' | 'calendar' | 'bell' | 'task' | 'ai' | 'mic' | 'queue' | undefined => {
    if (isRecording) return 'mic';
    if (queueDepth > 0) return 'queue';
    if (isAiWorking) return 'ai';
    if (plannerData?.nextUp) {
      const iconMap = { calendar: 'calendar', bell: 'bell', task: 'task' } as const;
      return iconMap[plannerData.nextUp.icon];
    }
    return undefined;
  }, [isRecording, queueDepth, isAiWorking, plannerData?.nextUp]);

  // Compute urgency level for visual indicators
  const inputStatusUrgency = useMemo(() => {
    if (isRecording || queueDepth > 0 || isAiWorking) return undefined;
    return plannerData?.nextUp?.urgency;
  }, [isRecording, queueDepth, isAiWorking, plannerData?.nextUp?.urgency]);

  // Minutes until the next planner item (for time-windowed visibility).
  const inputStatusMinutesUntil = useMemo(() => {
    if (isRecording || queueDepth > 0 || isAiWorking) return undefined;
    return plannerData?.nextUp?.minutesUntil;
  }, [isRecording, queueDepth, isAiWorking, plannerData?.nextUp?.minutesUntil]);

  // While the agent is responding/running tools, swap the single spinner in
  // the compact status pill for a horizontal stack of brand logos — one per
  // unique integration touched in this response (icons accumulate and stay
  // visible until the response completes, so the user sees the full work
  // footprint). Empty array = legacy statusText/statusIcon fallback.
  const inputStatusItems = useMemo<StatusItem[]>(() => {
    if (!isAiWorking) return [];
    const calls = currentToolCalls || [];
    if (calls.length === 0) return [];
    return [{
      id: 'tool-brand-stack',
      text: statusLabel,
      icon: 'custom',
      iconNode: <ToolBrandStack toolCalls={calls} />,
      priority: 200,
      pin: true,
      ariaLabel: statusLabel,
    }];
  }, [isAiWorking, currentToolCalls, statusLabel]);

  const connectionStatus = useMemo((): 'connected' | 'connecting' | 'disconnected' | 'error' => {
    if (state?.connecting) return 'connecting';
    if (state?.connected) return 'connected';
    if (state?.status === 'error') return 'error';
    return 'disconnected';
  }, [state?.connecting, state?.connected, state?.status]);

  const chatStatusText = useMemo(() => {
    if (connectionStatus === 'connecting') {
      const aiText = ai?.statusText;
      if (aiText === 'Starting\u2026') return 'Starting\u2026';
      return 'Connecting\u2026';
    }
    if (connectionStatus === 'disconnected') return 'Offline';
    if (connectionStatus === 'error') return 'Connection error';
    const label = statusLabel;
    if (messages.length > 0) {
      const idle = ['ready', 'idle'];
      if (idle.includes(label.toLowerCase())) return '';
    }
    return label;
  }, [connectionStatus, statusLabel, ai?.statusText, messages.length]);

  const handleShowSidebar = useCallback(() => {
    setOverlayMode('sidebar');
    window.desktopAPI.setMode('sidebar');
  }, []);

  const handleShowWindow = useCallback(() => {
    setOverlayMode('window');
    window.desktopAPI.setMode('window');
    try { window.desktopAPI?.setIgnoreMouseEvents?.(false); } catch { }
  }, []);

  const commands = useMemo<CommandItem[]>(() => {
    const q = (paletteQuery || '').toLowerCase().trim();
    const staticItems: CommandItem[] = [
      { id: 'new-chat', title: 'New chat', description: 'Start a fresh conversation', icon: <Plus className="w-5 h-5" />, run: handleNewChat },
      { id: 'open-dashboard', title: 'Open dashboard', description: 'View full dashboard', icon: <Layout className="w-5 h-5" />, shortcut: 'Dash', run: () => window.desktopAPI.openDashboard() },
      { id: 'toggle-compact', title: 'Compact layout', description: 'Switch to compact layout', icon: <Minimize2 className="w-5 h-5" />, run: handleShowCompact },
      { id: 'toggle-sidebar', title: 'Sidebar layout', description: 'Switch to sidebar layout', icon: <Layout className="w-5 h-5" />, run: handleShowSidebar },
      { id: 'toggle-window', title: 'Window layout', description: 'Switch to window layout', icon: <Layout className="w-5 h-5" />, run: handleShowWindow },

      { id: 'toggle-spaces', title: 'Spaces', description: 'Toggle spaces sidebar', icon: <LayoutGrid className="w-5 h-5" />, run: () => window.desktopAPI.toggleSpaces() },
      { id: 'attach-files', title: 'Attach files', description: 'Upload documents', icon: <File className="w-5 h-5" />, run: handleAttachFiles },
      { id: 'attach-images', title: 'Attach images', description: 'Upload images', icon: <Image className="w-5 h-5" />, run: handleAttachImages },
      {
        id: 'start-screen-snip',
        title: 'Start screen snip',
        description: 'Open Windows screen snip',
        icon: <Image className="w-5 h-5" />,
        run: async () => {
          await window.desktopAPI.startOverlayScreenSnip?.();
        }
      },
      { id: 'show-hotkeys', title: 'Show hotkeys', description: 'View keyboard shortcuts', icon: <Keyboard className="w-5 h-5" />, run: () => setShowHotkeys(true) },
      { id: 'rerun-onboarding', title: 'Rerun onboarding', description: 'Start the welcome tour again', icon: <RefreshCw className="w-5 h-5" />, run: () => { setOnboardingComplete(false); setTourComplete(false); } },
      { id: 'hide-overlay', title: 'Hide overlay', description: 'Close Stuard window', icon: <Power className="w-5 h-5" />, shortcut: 'Esc', run: () => window.desktopAPI.hide() },
      { id: 'tone-concise', title: 'Tone: Concise', description: 'Set response tone', icon: <MessageSquare className="w-5 h-5" />, group: 'Tone & Persona', run: () => setTone('concise') },
      { id: 'tone-friendly', title: 'Tone: Friendly', description: 'Set response tone', icon: <Smile className="w-5 h-5" />, group: 'Tone & Persona', run: () => setTone('friendly') },
      {
        id: 'google-search',
        title: 'Google Search',
        description: 'Search on Google in your browser',
        icon: <Globe className="w-5 h-5" />,
        run: () => {
          const trimmed = query.trim();
          const url = trimmed ? `https://www.google.com/search?q=${encodeURIComponent(trimmed)}` : 'https://www.google.com';
          window.desktopAPI.openExternal(url);
          setQuery('');
        }
      },
      {
        id: 'edge-search',
        title: 'Edge Search',
        description: 'Open and search using Microsoft Edge',
        icon: <Search className="w-5 h-5" />,
        run: () => {
          const trimmed = query.trim();
          const url = trimmed ? `microsoft-edge:https://www.google.com/search?q=${encodeURIComponent(trimmed)}` : 'microsoft-edge:https://www.google.com';
          window.desktopAPI.openExternal(url);
          setQuery('');
        }
      },
    ];
    if (!signedIn) staticItems.unshift({ id: 'sign-in', title: 'Sign in', description: 'Log in to your account', icon: <LogIn className="w-5 h-5" />, run: handleSignIn });

    let items: CommandItem[] = [];
    if (q) {
      items = staticItems.filter(c =>
        c.title.toLowerCase().includes(q) ||
        (c.description && c.description.toLowerCase().includes(q)) ||
        (c.group && c.group.toLowerCase().includes(q))
      );
    } else {
      items = staticItems;
    }

    // Local Workflows
    if (localWorkflows.length > 0) {
      const allLocals = localWorkflows.map(w => ({
        id: `workflow-${w.id}`,
        title: w.name || 'Untitled Workflow',
        description: 'Run local workflow',
        group: 'Local Workflows',
        icon: <Zap className="w-5 h-5" />,
        run: async () => {
          try {
            await window.desktopAPI?.workflowsRun?.(w.id);
            (window as any).desktopAPI?.notify?.('Workflow Started', `Running ${w.name}...`);
          } catch (e) {
            console.error(e);
          }
        }
      }));

      if (q) {
        items.push(...allLocals.filter(w => w.title.toLowerCase().includes(q)));
      } else {
        items.push(...allLocals);
      }
    }

    // Marketplace Results
    if (marketplaceResults.length > 0) {
      items.push(...marketplaceResults);
    }

    return items;
  }, [signedIn, setOnboardingComplete, setTourComplete, setTone, localWorkflows, marketplaceResults, query, handleShowCompact, handleShowSidebar, handleShowWindow, handleNewChat, handleAttachFiles, handleAttachImages]);

  const hasMessages = messages.length > 0;
  const showResizeGrips = overlayMode === 'sidebar' || overlayMode === 'window';

  const lastAssistantMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m?.role === 'assistant') return m;
    }
    return null;
  }, [messages]);

  const miniOutputText = useMemo(() => {
    const streamingText = (currentResponse || '').trim();
    if (streamingText) return currentResponse || '';
    const lastMsg = messages[messages.length - 1];
    if (isAiWorking || lastMsg?.role === 'user') return '';
    return lastAssistantMessage?.text || '';
  }, [currentResponse, lastAssistantMessage, messages, isAiWorking]);

  const miniOutputHasContent = useMemo(() => {
    const streamingText = (currentResponse || '').trim();
    if (streamingText) return true;
    const lastMsg = messages[messages.length - 1];
    if (isAiWorking || lastMsg?.role === 'user') return false;
    return !!(lastAssistantMessage?.text || '').trim();
  }, [currentResponse, lastAssistantMessage?.text, messages, isAiWorking]);

  const miniOutputStreaming = useMemo(
    () => !!(currentResponse || '').trim(),
    [currentResponse],
  );

  const miniOutputPrompt = useMemo(() => {
    const lastUser = [...messages].reverse().find((m) => m?.role === 'user');
    const lastMsg = messages[messages.length - 1];
    const inFlight =
      !!(currentResponse || '').trim()
      || !!(currentReasoning || '').trim()
      || isAiWorking
      || lastMsg?.role === 'user';

    if (inFlight && lastUser) {
      return String(lastUser.text || '').trim();
    }

    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === 'assistant') {
        for (let j = i - 1; j >= 0; j--) {
          if (messages[j]?.role === 'user') return String(messages[j].text || '').trim();
        }
        return '';
      }
    }

    return lastUser ? String(lastUser.text || '').trim() : '';
  }, [messages, currentResponse, currentReasoning, isAiWorking]);

  const lastAssistantIdRef = useRef<string | null>(null);
  useEffect(() => {
    lastAssistantIdRef.current = lastAssistantMessage?.id || null;
  }, [lastAssistantMessage?.id]);

  const hadStreamingRef = useRef(false);
  useEffect(() => {
    hadStreamingRef.current = !!(currentResponse || '').trim();
  }, [currentResponse]);

  return {
    subscribeProgress,
    exitedProject,
    handleUndoExit,
    setExitedProject,
    overlayVisible,
    showResizeGrips,
    overlayMode,
    approvalQueue,
    respondToApproval,
    setApprovalQueue,
    askUserPrompt,
    setAskUserPrompt,
    lastError,
    showCreditsLimitNotice,
    onDismissCreditsLimitNotice: handleDismissCreditsLimitNotice,
    onAddCredits: handleOpenBilling,
    handleSignIn,
    hasMessages,
    messages,
    currentResponse,
    currentReasoning,
    currentToolCalls,
    currentStreamChunks,
    thinkingStartTime,
    contextPaths,
    setContextPaths,
    handleRemoveContext,
    handleShowCompact,
    handleOpenDashboard,
    handleNewChat,
    handleToggleVoice,
    voice,
    convList,
    loadingConvs,
    handleSelectConversation,
    chatMenuOpen,
    setChatMenuOpen,
    chatStatusText,
    ai,
    connectionStatus,
    chatMode,
    handleChatModeChange,
    chatModels,
    handleChatModelsChange,
    modelSource,
    setModelSource,
    reasoningLevel,
    setReasoningLevel,
    tabs,
    activeTabId,
    switchTab,
    closeTab,
    addTab,
    translucentMode,
    submitToolOutput,
    handleGenUIResponse,
    handleEditMessage,
    revertFiles,
    redoFiles,
    pendingMemories,
    confirmPendingMemory,
    rejectPendingMemory,
    handleAddContext,
    attachments,
    handleRemoveAttachment,
    handleAttachFiles,
    handleAttachImages,
    handleDrop,
    queueDepth,
    queuedMessages,
    cancelQueuedMessage,
    query,
    setQuery,
    handleSend,
    handleQuickSend,
    handleSteer,
    stopGeneration,
    isStreaming,
    activeSubagentsForTab,
    steerTarget,
    setSteerTarget,
    internalSidebarOpen,
    internalSidebarWidth,
    activeSidebarTab,
    handleToggleInternalSidebar,
    handleCloseInternalSidebar,
    handleSwitchSidebarTab,
    handleInternalSidebarResize,
    activeProject,
    conversationId,
    handleExitProjectMode,
    handleOpenProjectHome,
    inputRef,
    handlePaste,
    signedIn,
    conversationTitle,
    handleDeleteConversation,
    inputStatusText,
    inputStatusIcon,
    inputStatusUrgency,
    inputStatusMinutesUntil,
    inputStatusItems,
    isRecording,
    handleMicClick,
    accessToken,
    plannerData,
    commands,
    showPalette,
    handleClosePalette,
    setPaletteQuery,
    isMarketplaceSearching,
    showHotkeys,
    handleCloseHotkeys,
    showTour,
    setTourComplete,
    handleShowWindow,
    updateState,
    miniOutputText,
    miniOutputHasContent,
    miniOutputStreaming,
    miniOutputPrompt,
    showMiniOutput,
    setShowMiniOutput,
    backgroundTaskCount,
    compactHubTabs,
  };
}
