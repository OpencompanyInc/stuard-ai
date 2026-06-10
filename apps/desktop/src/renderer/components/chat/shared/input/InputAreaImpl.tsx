import React, { forwardRef, useState, useEffect, useRef, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
import TextareaAutosize from 'react-textarea-autosize';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  FileIcon,
  ImageIcon,
  Cross2Icon,
  ChevronDownIcon,
  ChevronUpIcon,
  HomeIcon,
  PlusIcon
} from "@radix-ui/react-icons";
import { Mic, MicOff, X, LogIn, Video, Calendar, Bell, ListTodo, PanelRight, Search, Globe, FolderSearch, MessageSquare, Zap, Chrome, Github, PlayCircle, Play, Command, Loader2, File as FileIconLucide, ExternalLink, Copy, Plus as PlusLucide, AppWindow, Folder, Image as ImageIconLucide, Film, Music, Code as CodeIcon, Archive, FileText, CloudDownload, Download, Paperclip, Box, FolderLock, Shield, Eye, Pencil, Trash2, CheckCircle, FolderOpen, AlertTriangle, CornerDownRight, AudioLines, Layout } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { VoiceMorphPill } from '../../../voice/VoiceMorphPill';
import type { VoiceToolEvent } from '../../../../hooks/useVoiceMode';
import { clsx } from 'clsx';
import QueuePanel from '../../../QueuePanel';
import { FileNavigator, ContextItem, FileNavRef } from '../../../FileNavigator';
import { QuickShortcutsGrid, BookmarkEditor, useBookmarks, Bookmark, getTypeConfig } from '../../../QuickShortcuts';
import stuardLogo from '@website-assets/logo.png';
import googleLogo from '../../../../assets/icons/google.png';
import bingLogo from '../../../../assets/icons/bing.png';
import duckduckgoLogo from '../../../../assets/icons/duckduckgo.png';
import youtubeLogo from '../../../../assets/icons/youtube.png';
import githubLogo from '../../../../assets/icons/github.svg';
import wikipediaLogo from '../../../../assets/icons/wikipedia.png';
import merriamWebsterLogo from '../../../../assets/icons/merriam-webster.png';

import type { UrgencyLevel } from '../../../../hooks/usePlannerData';
import { useStatusCarousel, type StatusItem } from '../../../../hooks/useStatusCarousel';
import { useWorkflows } from '../../../../workflows/hooks/useWorkflows';
import { getMarketplaceApi } from '../../../../utils/cloud';
import { filterCompactMarketplaceResults } from '../../../../utils/marketplaceSearch';
import {
  filterCompactStuardNav,
  openWorkflowInStudio,
  runDeployedWorkflow,
  type CompactStuardNavItem,
} from '../../../../utils/compactStuardNav';
import { displayConversationTitle } from '../../../../utils/conversationTitle';
import { chooseDropdownPlacement } from '../../../../utils/dropdownPlacement';
import { TabHistoryMenu, estimateCompactTabMenuHeight, type ConversationHistoryItem } from '../TabHistoryMenu';
import { useChatTabs } from '../ChatTabsContext';
import {
  filterFileSearchResults,
  mergeHybridAndQuickFileResults,
} from '../fileSearchMerge';
import type { ChatAttachment } from '../../../../utils/attachments';

interface InputAreaProps {
  query: string;
  setQuery: (q: string) => void;
  onSend: () => void;
  /** Compact mode: Tab sends with fast tier, skipping memory I/O. */
  onQuickSend?: () => void;
  /** Compact mode: Ctrl+Shift+Enter captures the screen (Stuard excluded) and sends it. */
  onScreenshotSend?: () => void;
  onSteer?: () => void;
  attachments: ChatAttachment[];
  onRemoveAttachment: (index: number) => void;
  onAttachFiles: () => void;
  onAttachImages: () => void;
  onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;

  signedIn: boolean;
  onSignIn: () => void;

  // History
  conversationTitle: string | null;
  conversations?: ConversationHistoryItem[];
  loadingConversations?: boolean;
  activeConversationId?: string | null;
  onSelectConversation?: (id: string) => void;
  onNewChat?: () => void;
  onStopGeneration?: () => void;
  onChatMenuOpenChange: (open: boolean) => void;
  chatMenuOpen: boolean;

  // View Control
  expanded: boolean;
  onToggleExpand: () => void;
  onOpenDashboard: () => void;

  overlayMode?: 'compact' | 'sidebar' | 'window';

  // Optional: compact-mode status row text
  statusText?: string;
  statusIcon?: 'video' | 'calendar' | 'bell' | 'task' | 'ai' | 'mic' | 'queue';
  statusUrgency?: UrgencyLevel;
  statusMinutesUntil?: number;
  /**
   * Optional carousel of status items rotated above the input bar.
   * If omitted, falls back to building a single-item list from
   * statusText/statusIcon/statusUrgency for backwards compatibility.
   */
  statusItems?: StatusItem[];
  connectionStatus?: 'connected' | 'connecting' | 'disconnected' | 'error';

  // Queue
  queueDepth: number;
  queuedMessages: any[];
  onCancelQueuedMessage?: (id: string) => void;

  // Speech
  isRecording?: boolean;
  onMicClick?: () => void;

  // Voice Mode (real-time conversation)
  voiceActive?: boolean;
  onToggleVoice?: () => void;
  voiceState?: 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking';
  voiceAudioLevel?: number;
  voiceMuted?: boolean;
  onVoiceMuteToggle?: () => void;
  voiceTranscripts?: Array<{ id: number; role: 'user' | 'assistant'; text: string; isFinal: boolean; timestamp: number }>;
  voiceActiveTool?: string | null;
  voiceActiveTools?: VoiceToolEvent[];
  voiceLastTool?: VoiceToolEvent | null;

  // Context Paths (for @ mentions)
  contextPaths?: ContextItem[];
  setContextPaths?: React.Dispatch<React.SetStateAction<ContextItem[]>>;

  // Translucent mode
  translucentMode?: boolean;

  // Access token for semantic search
  accessToken?: string | null;

  miniOutputText?: string;
  miniOutputHasContent?: boolean;
  miniOutputStreaming?: boolean;
  miniOutputPrompt?: string;
  miniOutputUserAttachments?: import('../../../../utils/attachments').ChatAttachment[];
  showMiniOutput?: boolean;
  setShowMiniOutput?: React.Dispatch<React.SetStateAction<boolean>>;
  /** In-flight tool calls from the current assistant turn — feeds compact brand chips. */
  currentToolCalls?: ReadonlyArray<{ id: string; tool: string; status: 'called' | 'running' | 'completed' | 'error' }>;
  /** In-flight reasoning/thinking text for compact response panel. */
  currentReasoning?: string;
  onSubmitToolOutput?: (id: string, result: any) => void;
  onGenUIResponse?: (component: string, result: any) => void;

  /** When true, compact mode shows the animated thinking border instead of the AI sparkle status pill. */
  isAiWorking?: boolean;

  /** Background AI tasks — drives the compact task counter. */
  backgroundTaskCount?: number;
  /** Per-tab snapshots for the compact hub. */
  compactHubTabs?: import('./compact/CompactHub').CompactHubTab[];
}

import { normalizeInputSearchText, shouldRunInputSemanticSearch } from './search';
import { HighlightMatch } from './HighlightMatch';
import { getFileKindConfig } from './fileKind';
import { FIGMA_ROW_BASE, FIGMA_ROW_PRIMARY, FIGMA_ROW_WITH_ICON, FIGMA_KBD } from './styles';
import { AttachmentBar } from './AttachmentBar';
import { IntegrationSuggestionView } from './suggestions/IntegrationSuggestionChip';
import { useIntegrationSuggestion } from './suggestions/useIntegrationSuggestion';
import { FolderPermissionsButton } from './FolderPermissionsButton';
import { CompactSearchDropdown } from './compact/CompactSearchDropdown';
import { qaError, qaLog, qaWarn } from './compact/compactQuickActionsDebug';
import { CompactStatusPill } from './compact/CompactStatusPill';
import { CompactInputPill } from './compact/CompactInputPill';
import { CompactDragCorner } from './compact/CompactDragCorner';
import { CompactTitleBar } from './compact/CompactTitleBar';
import { CompactFileNavPortal } from './compact/CompactFileNavPortal';
import {
  COMPACT_DROPDOWN_MAX_HEIGHT,
  COMPACT_OVERLAY_DROPDOWN_GAP,
  COMPACT_WINDOW_DROPDOWN_MARGIN,
  compactWindowResizeAnchor,
} from './compact/compactOverlayLayout';
import { CompactHub, COMPACT_HUB_PEEK_VISIBLE } from './compact/CompactHub';
import { COMPACT_RESPONSE_PANEL_MAX_HEIGHT } from './CompactResponsePanel';

const COMPACT_TITLE_BUMP_HEIGHT = 24;
const COMPACT_TITLE_BUMP_OVERLAP = 10;
/** Net vertical space the centered title bump adds above the input pill. */
const COMPACT_TITLE_BAR_HEIGHT = COMPACT_TITLE_BUMP_HEIGHT - COMPACT_TITLE_BUMP_OVERLAP + 2;
/** Fallback before the response panel reports its first measured height. */
const COMPACT_QUICK_RESPONSE_MIN_HEIGHT = 96;
/** Extra clearance before a dropdown is considered too close to a screen edge. */
const COMPACT_DROPDOWN_FLIP_MARGIN = 144;
/** Room advantage required before overflow can override the current side. */
const COMPACT_DROPDOWN_ROOM_HYSTERESIS = 0;
/** Gap between response panel bottom and input bar + top shadow clearance. */
const COMPACT_QUICK_RESPONSE_CHROME = 20;

type CompactSearchEngineId =
  | 'google'
  | 'bing'
  | 'duckduckgo'
  | 'youtube'
  | 'github'
  | 'merriam'
  | 'wikipedia';

const COMPACT_SEARCH_ENGINE_IDS = new Set<string>([
  'google',
  'bing',
  'duckduckgo',
  'youtube',
  'github',
  'merriam',
  'wikipedia',
]);

function normalizeCompactSearchEngineId(id: string | null | undefined): CompactSearchEngineId {
  return COMPACT_SEARCH_ENGINE_IDS.has(id || '')
    ? (id as CompactSearchEngineId)
    : 'google';
}

function compactSearchUrl(engineId: string | null | undefined, query: string): string {
  const id = normalizeCompactSearchEngineId(engineId);
  const q = query.trim();
  const encoded = encodeURIComponent(q);
  switch (id) {
    case 'bing':
      return q ? `https://www.bing.com/search?q=${encoded}` : 'https://www.bing.com/';
    case 'duckduckgo':
      return q ? `https://duckduckgo.com/?q=${encoded}` : 'https://duckduckgo.com/';
    case 'youtube':
      return q ? `https://www.youtube.com/results?search_query=${encoded}` : 'https://www.youtube.com/';
    case 'github':
      return q ? `https://github.com/search?q=${encoded}` : 'https://github.com/search';
    case 'merriam':
      return q ? `https://www.merriam-webster.com/dictionary/${encoded}` : 'https://www.merriam-webster.com/';
    case 'wikipedia':
      return q ? `https://en.wikipedia.org/w/index.php?search=${encoded}` : 'https://en.wikipedia.org/';
    case 'google':
    default:
      return q ? `https://www.google.com/search?q=${encoded}` : 'https://www.google.com/';
  }
}

const InputArea = forwardRef(function InputArea(
  {
    query, setQuery, onSend, onQuickSend, onScreenshotSend, onSteer,
    attachments, onRemoveAttachment, onAttachFiles, onAttachImages,
    onPaste, onDrop,
    signedIn, onSignIn,
    conversationTitle, conversations = [], loadingConversations = false,
    activeConversationId, onSelectConversation = () => {}, onNewChat = () => {},
    onStopGeneration, onChatMenuOpenChange, chatMenuOpen,
    expanded, onToggleExpand, onOpenDashboard, overlayMode, statusText, statusIcon, statusUrgency, statusMinutesUntil, statusItems,
    connectionStatus,
    queueDepth, queuedMessages, onCancelQueuedMessage,
    isRecording, onMicClick,
    voiceActive = false,
    onToggleVoice,
    voiceState = 'idle',
    voiceAudioLevel = 0,
    voiceMuted = false,
    onVoiceMuteToggle,
    voiceTranscripts = [],
    voiceActiveTool,
    voiceActiveTools = [],
    voiceLastTool = null,
    contextPaths, setContextPaths,
    translucentMode = false,
    accessToken,
    miniOutputText,
    miniOutputHasContent,
    miniOutputStreaming,
    miniOutputPrompt = '',
    miniOutputUserAttachments = [],
    showMiniOutput,
    setShowMiniOutput,
    currentToolCalls,
    currentReasoning = '',
    onSubmitToolOutput,
    onGenUIResponse,
    isAiWorking = false,
    backgroundTaskCount = 0,
    compactHubTabs = [],
  }: InputAreaProps,
  ref: React.ForwardedRef<HTMLTextAreaElement>
) {

  const { tabs: openTabs, activeTabId, switchTab } = useChatTabs();

  const conn = connectionStatus || 'connected';
  const isConnSpinner = conn === 'connecting';

  // Cloud AI URL for embeddings
  const CLOUD_AI_HTTP = (window as any).__CLOUD_AI_HTTP__ || (import.meta as any).env?.VITE_CLOUD_AI_URL || "http://127.0.0.1:8082";

  // File search state for quick actions
  const [appResults, setAppResults] = useState<any[]>([]);
  const [fileResults, setFileResults] = useState<any[]>([]);
  const [fileSearchMode, setFileSearchMode] = useState<'quick' | 'hybrid'>('quick');
  const [fileLoading, setFileLoading] = useState(false);
  const [fileSemanticLoading, setFileSemanticLoading] = useState(false);
  const [fileError, setFileError] = useState('');
  const [indexStats, setIndexStats] = useState<any>(null);

  const fileIconCacheRef = useRef<Record<string, string>>({});
  const [fileIconDataUrls, setFileIconDataUrls] = useState<Record<string, string>>({});
  const fileIconReqIdRef = useRef(0);

  const searchReqIdRef = useRef(0);
  const semanticReqIdRef = useRef(0);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const semanticDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const FILE_SEARCH_RESULT_LIMIT = 12;
  const quickFileResultsRef = useRef<any[]>([]);
  const hybridFileResultsRef = useRef<any[]>([]);

  const applyMergedFileResults = useCallback(() => {
    setFileResults(
      mergeHybridAndQuickFileResults(
        hybridFileResultsRef.current,
        quickFileResultsRef.current,
        FILE_SEARCH_RESULT_LIMIT,
      ),
    );
    setFileSearchMode(
      hybridFileResultsRef.current.length > 0 ? 'hybrid' : 'quick',
    );
  }, []);

  // Ref for File Navigator to control selection
  const fileNavRef = useRef<FileNavRef>(null);
  // Ref to track showFileNav inside handleKeyDown (declared later as state)
  const showFileNavRef = useRef(false);

  // Selection state for the search-options dropdown (arrow keys / hover).
  // selectedIndexRef must stay in sync immediately — handleKeyDown reads it on
  // Enter; a useEffect-only sync lags hover/arrow updates so Enter can fire
  // "Ask Stuard" while an application row looks highlighted.
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedIndexRef = useRef(0);
  const selectableItemsRef = useRef<{ key: string; onSelect: () => void }[]>([]);
  const showSearchOptionsRef = useRef(false);
  const commitDropdownSelectionRef = useRef<(source?: string) => boolean>(() => false);
  const lastDropdownCommitAtRef = useRef(0);
  const setSelectedIndexSynced = useCallback((value: number | ((prev: number) => number)) => {
    if (typeof value === 'function') {
      setSelectedIndex((prev) => {
        const next = value(prev);
        selectedIndexRef.current = next;
        return next;
      });
    } else {
      selectedIndexRef.current = value;
      setSelectedIndex(value);
    }
  }, []);

  // Load index stats on mount
  useEffect(() => {
    const loadIndexStats = async () => {
      try {
        if (!(window as any).desktopAPI?.execTool) return;
        const s = await (window as any).desktopAPI.execTool('file_index_stats', {});
        if (s?.ok) setIndexStats(s);
      } catch { }
    };
    loadIndexStats();
  }, []);

  // Workflows & Marketplace
  const { items: localWorkflows } = useWorkflows();
  const [marketplaceResults, setMarketplaceResults] = useState<any[]>([]);
  const [isMarketplaceSearching, setMarketplaceSearching] = useState(false);
  const marketplaceDebounceRef = useRef<NodeJS.Timeout | null>(null);

  // Quick Shortcuts / Bookmarks
  const { bookmarks, saveBookmarks, executeBookmark } = useBookmarks();
  const [showBookmarkEditor, setShowBookmarkEditor] = useState(false);

  // Search Marketplace
  useEffect(() => {
    // Only search if not expanded and query length >= 2
    if (expanded) return;

    const q = String(query || '').trim();
    if (marketplaceDebounceRef.current) {
      clearTimeout(marketplaceDebounceRef.current);
      marketplaceDebounceRef.current = null;
    }

    if (q.length < 2) {
      setMarketplaceResults([]);
      setMarketplaceSearching(false);
      return;
    }

    setMarketplaceSearching(true);
    marketplaceDebounceRef.current = setTimeout(async () => {
      try {
        const token = accessToken ?? null;
        const api = getMarketplaceApi(() => token);
        // Ask the server for a small over-fetch so the client-side similarity
        // cutoff still leaves enough rows to fill the 3-slot dropdown.
        const res = await api.search({ query: q, limit: 8 });
        if (res.ok && res.results) {
          setMarketplaceResults(filterCompactMarketplaceResults(res.results as any[], q));
        } else {
          setMarketplaceResults([]);
        }
      } catch {
        setMarketplaceResults([]);
      } finally {
        setMarketplaceSearching(false);
      }
    }, 600);

    return () => {
      if (marketplaceDebounceRef.current) clearTimeout(marketplaceDebounceRef.current);
    };
  }, [query, expanded, accessToken]);

  const filteredLocalWorkflows = React.useMemo(() => {
    const q = (query || '').toLowerCase().trim();
    if (!q || q.length < 2) return [];
    return localWorkflows.filter(w =>
      (w.name || '').toLowerCase().includes(q) ||
      w.id.toLowerCase().includes(q)
    ).slice(0, 5);
  }, [localWorkflows, query]);

  const [workflowDeployMap, setWorkflowDeployMap] = useState<Record<string, { deployed: boolean; running: boolean }>>({});

  useEffect(() => {
    if (filteredLocalWorkflows.length === 0) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        filteredLocalWorkflows.map(async (w) => {
          try {
            const status = await (window as any).desktopAPI?.workflowsGetDeployStatus?.(w.id);
            return [
              w.id,
              {
                deployed: Boolean(status?.deployed),
                running: Boolean(status?.running),
              },
            ] as const;
          } catch {
            return [w.id, { deployed: false, running: false }] as const;
          }
        })
      );
      if (!cancelled) {
        setWorkflowDeployMap((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
      }
    })();
    return () => { cancelled = true; };
  }, [filteredLocalWorkflows]);

  type CompactWorkflowHit = {
    id: string;
    name?: string;
    deployed: boolean;
    running: boolean;
  };

  const compactWorkflowHits = React.useMemo<CompactWorkflowHit[]>(() => {
    return filteredLocalWorkflows.map((w) => ({
      id: w.id,
      name: w.name,
      deployed: workflowDeployMap[w.id]?.deployed ?? false,
      running: workflowDeployMap[w.id]?.running ?? false,
    }));
  }, [filteredLocalWorkflows, workflowDeployMap]);

  const matchingBookmarks = React.useMemo(() => {
    const q = (query || '').toLowerCase().trim();
    if (!q || q.length < 2) return [] as Bookmark[];
    return bookmarks.filter(b =>
      (b.name || '').toLowerCase().includes(q) ||
      (b.target || '').toLowerCase().includes(q)
    ).slice(0, 4);
  }, [bookmarks, query]);

  const stuardCommands = React.useMemo<CompactStuardNavItem[]>(() => {
    return filterCompactStuardNav(query, 10);
  }, [query]);


  // Quick file search by filename — uses unified search (apps + files)
  const doQuickFileSearch = useCallback(async (q: string) => {
    const api = (window as any).desktopAPI;
    // Prefer unified search (includes app discovery + fuzzy matching)
    if (api?.unifiedSearch) {
      const reqId = ++searchReqIdRef.current;
      setFileLoading(true);
      setFileError('');
      try {
        const res = await api.unifiedSearch(q, {
          limit: 12,
          includeApps: true,
          includeFiles: true,
        });
        if (searchReqIdRef.current !== reqId) return;
        if (res?.ok && Array.isArray(res.results)) {
          // We used to filter out Stuard AI itself here on the theory that
          // it's redundant when you're already in the app. Removed: users
          // expect to see it (consistent with full launcher view, and lets
          // them focus an existing instance from the compact dropdown).
          const apps = res.results.filter((r: any) => r.source === 'app-discovery');
          const files = res.results.filter((r: any) => (
            r.source !== 'app-discovery' &&
            String(r.kind || '').toLowerCase() !== 'application'
          ));
          setAppResults(apps);
          quickFileResultsRef.current = files;
          applyMergedFileResults();
          qaLog('search:unified_results', {
            query: q,
            appCount: apps.length,
            fileCount: files.length,
            apps: apps.slice(0, 8).map((a: any) => ({
              name: a.name,
              launchTarget: a.launchTarget,
              path: a.path,
            })),
          });
        } else {
          setAppResults([]);
          quickFileResultsRef.current = [];
          hybridFileResultsRef.current = [];
          setFileResults([]);
          setFileError(String(res?.error || 'Search failed'));
        }
      } catch (e: any) {
        if (searchReqIdRef.current !== reqId) return;
        setAppResults([]);
        quickFileResultsRef.current = [];
        hybridFileResultsRef.current = [];
        setFileResults([]);
        setFileError(String(e?.message || 'Search failed'));
      } finally {
        if (searchReqIdRef.current === reqId) setFileLoading(false);
      }
      return;
    }
    // Fallback to old file-only search
    if (!api?.execTool) return;
    const reqId = ++searchReqIdRef.current;
    setFileLoading(true);
    setFileError('');
    try {
      const res = await api.execTool('file_search', {
        query: q,
        mode: 'quick',
        limit: 6,
      });

      if (searchReqIdRef.current !== reqId) return;
      if (res?.ok) {
        quickFileResultsRef.current = filterFileSearchResults(res.results);
        hybridFileResultsRef.current = [];
        applyMergedFileResults();
        setAppResults([]);
      } else {
        quickFileResultsRef.current = [];
        hybridFileResultsRef.current = [];
        setFileResults([]);
        setAppResults([]);
        setFileError(String(res?.error || 'Search failed'));
      }
    } catch (e: any) {
      if (searchReqIdRef.current !== reqId) return;
      quickFileResultsRef.current = [];
      hybridFileResultsRef.current = [];
      setFileResults([]);
      setAppResults([]);
      setFileError(String(e?.message || 'Search failed'));
    } finally {
      if (searchReqIdRef.current === reqId) setFileLoading(false);
    }
  }, [applyMergedFileResults]);

  // Semantic/hybrid file search
  const doSemanticRefine = useCallback(async (q: string) => {
    const token = typeof accessToken === 'string' ? accessToken : '';
    const indexed = Number(indexStats?.indexed_files || 0);
    if (!token || indexed <= 0 || !shouldRunInputSemanticSearch(q)) return;
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
        body: JSON.stringify({ text: q, model: 'google/gemini-embedding-2-preview', outputDimensionality: 3072 }),
      });
      const j = await resp.json().catch(() => ({}));
      if (semanticReqIdRef.current !== reqId) return;
      if (!resp.ok || !j?.ok || !Array.isArray(j.embedding)) return;

      const res = await (window as any).desktopAPI.execTool('file_search', {
        query: q,
        vector: j.embedding,
        mode: 'hybrid',
        limit: 10,
      });

      if (semanticReqIdRef.current !== reqId) return;
      if (res?.ok) {
        hybridFileResultsRef.current = filterFileSearchResults(res.results);
        applyMergedFileResults();
      }
    } catch {
      // ignore
    } finally {
      if (semanticReqIdRef.current === reqId) setFileSemanticLoading(false);
    }
  }, [CLOUD_AI_HTTP, accessToken, indexStats?.indexed_files, applyMergedFileResults]);

  // Trigger file search when query changes
  useEffect(() => {
    // Only search if not expanded and query length >= 2
    if (expanded) return;

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
      quickFileResultsRef.current = [];
      hybridFileResultsRef.current = [];
      setFileResults([]);
      setAppResults([]);
      setFileError('');
      setFileLoading(false);
      setFileSemanticLoading(false);
      return;
    }

    hybridFileResultsRef.current = [];

    // Quick search (instant-ish)
    searchDebounceRef.current = setTimeout(() => {
      doQuickFileSearch(q);
    }, 150);

    if (shouldRunInputSemanticSearch(q)) {
      // Semantic refine (slower, only if embeddings exist and the query is broad enough)
      semanticDebounceRef.current = setTimeout(() => {
        doSemanticRefine(q);
      }, 650);
    } else {
      // Cancel any older semantic request so quick-search results stay visible
      semanticReqIdRef.current += 1;
      setFileSemanticLoading(false);
    }

    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      if (semanticDebounceRef.current) clearTimeout(semanticDebounceRef.current);
    };
  }, [query, expanded, doQuickFileSearch, doSemanticRefine]);

  useEffect(() => {
    const api = (window as any).desktopAPI;
    if (!api?.getFileIcon && !api?.getFilePreview) return;

    const uniquePaths = (values: string[]) => Array.from(new Set(values.filter(Boolean)));
    const iconRequests: { displayPath: string; pathsToTry: string[]; preferThumbnail: boolean }[] = [];
    // App results (from unified search / app-discovery)
    for (const a of (Array.isArray(appResults) ? appResults : [])) {
      if (!a) continue;
      const filePath = String(a.path || '').trim();
      const iconHint = String(a.iconHint || a.launchTarget || '').trim();
      if (!filePath) continue;
      if (typeof a.iconDataUrl === 'string' && a.iconDataUrl) {
        fileIconCacheRef.current[filePath] = a.iconDataUrl;
        continue;
      }
      if (iconHint || filePath) {
        iconRequests.push({
          displayPath: filePath,
          pathsToTry: uniquePaths([iconHint || filePath, filePath]),
          preferThumbnail: false,
        });
      }
    }
    // File results
    for (const f of (Array.isArray(fileResults) ? fileResults : [])) {
      if (!f) continue;
      const kindLower = String(f.kind || '').toLowerCase();
      if (kindLower === 'application') continue;
      // Skip folders — Windows shell icons for folders often come with ugly
      // overlays (lock, sync, etc.). The lucide Folder icon looks far cleaner.
      if (kindLower === 'folder' || f.is_folder === true) continue;
      const filePath = String(f.path || '').trim();
      if (!filePath) continue;
      const preferThumbnail = String(f.preview_kind || 'icon') === 'thumbnail';
      iconRequests.push({
        displayPath: filePath,
        pathsToTry: preferThumbnail
          ? [filePath]
          : uniquePaths([
              String(f.icon_path || '').trim(),
              String(f.target_path || '').trim(),
              filePath,
            ]),
        preferThumbnail,
      });
    }
    if (iconRequests.length === 0) return;

    const reqId = ++fileIconReqIdRef.current;
    (async () => {
      const updates: Record<string, string> = {};
      await Promise.all(
        iconRequests.map(async ({ displayPath, pathsToTry, preferThumbnail }) => {
          if (fileIconCacheRef.current[displayPath]) return;
          for (const p of pathsToTry) {
            const res = await (api.getFilePreview
              ? api.getFilePreview(p, { size: 'normal', preferThumbnail })
              : api.getFileIcon(p, { size: 'normal' })
            ).catch(() => null);
            if (fileIconReqIdRef.current !== reqId) return;
            if (res?.ok && typeof res.dataUrl === 'string' && res.dataUrl) {
              updates[displayPath] = res.dataUrl;
              return;
            }
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
  }, [fileResults, appResults]);

  // Handle launching an app from search results
  const handleLaunchApp = useCallback(async (launchTarget: string, source = 'unknown') => {
    const target = String(launchTarget || '').trim();
    qaLog('launchApp:start', { source, target: target || '(empty)' });
    try {
      if (!target) {
        qaWarn('launchApp:skip', { source, reason: 'empty_target' });
        return;
      }
      const api = (window as any).desktopAPI;
      let result: unknown;
      if (api?.launchApp) {
        qaLog('launchApp:invoke', { source, method: 'desktopAPI.launchApp' });
        result = await api.launchApp(target);
      } else if (api?.execTool) {
        qaLog('launchApp:invoke', { source, method: 'desktopAPI.execTool.open_file' });
        result = await api.execTool('open_file', { path: target });
      } else {
        qaWarn('launchApp:skip', { source, reason: 'no_launch_api' });
        return;
      }
      qaLog('launchApp:result', { source, target, result });
    } catch (err) {
      qaError('launchApp:error', err, { source, target });
    } finally {
      if (target) {
        qaLog('launchApp:hide_overlay', { source, target });
        (window as any).desktopAPI?.hide?.();
      }
    }
  }, []);

  // Handle adding a file result as context
  const handleAddFileAsContext = useCallback((file: any) => {
    const path = String(file.path || '').trim();
    const filename = String(file.filename || '').trim() || path.split(/[/\\]/).pop() || path;

    if (contextPaths && setContextPaths && !contextPaths.some(c => c.path === path)) {
      setContextPaths(prev => [...prev, {
        path,
        name: filename,
        isDirectory: false,
        type: 'file'
      }]);
    }
    setFileResults([]);
    setQuery('');
  }, [contextPaths, setContextPaths, setQuery]);

  // Handle opening a file
  const handleOpenFile = useCallback((path: string) => {
    (window as any).desktopAPI?.openPath?.(path);
  }, []);

  // Handle copying file path
  const handleCopyPath = useCallback((path: string) => {
    navigator.clipboard.writeText(path).catch(() => { });
  }, []);

  // Keep a local ref so we can position the @ overlay in expanded mode using a portal
  const localTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const dropdownGap = 12;
  const setTextareaRef = useCallback((node: HTMLTextAreaElement | null) => {
    localTextareaRef.current = node;
    if (typeof ref === 'function') {
      ref(node);
    } else if (ref && typeof ref === 'object') {
      (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
    }
  }, [ref]);

  const [compactHubOpen, setCompactHubOpen] = useState(false);
  const compactHubOpenRef = useRef(false);
  const hubResizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userDismissedHubRef = useRef(false);
  const wasStreamingRef = useRef(false);
  const lastQuickSendAtRef = useRef(0);
  const [quickResponseHeight, setQuickResponseHeight] = useState(0);
  const quickResponseHeightRef = useRef(0);
  useEffect(() => { compactHubOpenRef.current = compactHubOpen; }, [compactHubOpen]);

  const openCompactHub = useCallback((force = false) => {
    if (expanded || overlayMode !== 'compact') return;
    if (!force && userDismissedHubRef.current) return;
    userDismissedHubRef.current = false;
    setCompactHubOpen(true);
  }, [expanded, overlayMode]);

  const closeCompactHub = useCallback(() => {
    userDismissedHubRef.current = true;
    setCompactHubOpen(false);
  }, []);

  const handleQuickResponseHeightChange = useCallback((height: number) => {
    const next = Math.max(0, Math.ceil(height));
    if (next === quickResponseHeightRef.current) return;
    quickResponseHeightRef.current = next;
    setQuickResponseHeight(next);
  }, []);

  useEffect(() => {
    if (!compactHubOpen) {
      quickResponseHeightRef.current = 0;
      setQuickResponseHeight(0);
    }
  }, [compactHubOpen]);

  const showHubPeek = React.useMemo(() => {
    if (!signedIn) return false;
    // Active turn uses the response panel — no peek strip or reserved gap.
    if (compactHubOpen || isAiWorking || !!miniOutputStreaming) return false;
    return (
      backgroundTaskCount > 0
      || compactHubTabs.some((t) => t.isWorking || t.assistantText || t.userPrompt)
      || compactHubTabs.length > 1
      || !!(miniOutputText || '').trim()
      || !!miniOutputHasContent
    );
  }, [signedIn, backgroundTaskCount, compactHubTabs, miniOutputStreaming, miniOutputText, miniOutputHasContent, compactHubOpen, isAiWorking]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const isEnter = e.key === 'Enter' || e.code === 'NumpadEnter';

    // Arrow key navigation for dropdowns
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (showFileNavRef.current && fileNavRef.current) {
        e.preventDefault();
        fileNavRef.current.moveSelection(e.key === 'ArrowDown' ? 1 : -1);
        return;
      }
      if (showSearchOptionsRef.current) {
        const total = selectableItemsRef.current.length;
        if (total > 0) {
          e.preventDefault();
          const delta = e.key === 'ArrowDown' ? 1 : -1;
          const next = (selectedIndexRef.current + delta + total) % total;
          const rowKey = selectableItemsRef.current[next]?.key;
          qaLog('keydown:arrow', {
            handler: 'textarea',
            direction: e.key,
            from: selectedIndexRef.current,
            to: next,
            total,
            rowKey,
          });
          setSelectedIndexSynced(next);
          return;
        }
        qaWarn('keydown:arrow', { handler: 'textarea', reason: 'no_selectable_items', total });
      }
    }

    // Enter to select current item in file nav
    if (isEnter && !e.shiftKey && showFileNavRef.current && fileNavRef.current) {
      qaLog('keydown:enter', { handler: 'textarea', branch: 'file_nav' });
      e.preventDefault();
      fileNavRef.current.selectCurrent();
      return;
    }

    // Enter to select highlighted dropdown row when search-options is open.
    if (isEnter && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      const committed = commitDropdownSelectionRef.current('textarea-keydown');
      qaLog('keydown:enter', {
        handler: 'textarea',
        branch: 'quick_actions_commit',
        showSearchOptionsRef: showSearchOptionsRef.current,
        selectableCount: selectableItemsRef.current.length,
        selectedIndex: selectedIndexRef.current,
        committed,
      });
      if (committed) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }

    // Escape to close dropdowns or hub
    if (e.key === 'Escape') {
      if (showFileNavRef.current) {
        e.preventDefault();
        setShowFileNav(false);
        setFileNavFilter("");
        return;
      }
      if (compactHubOpenRef.current) {
        e.preventDefault();
        closeCompactHub();
        return;
      }
    }

    // Ctrl/Cmd+Tab cycles chat tabs (Ctrl+Shift+Tab goes backwards). Must be
    // handled before the plain-Tab quick-send below so the modifier isn't
    // swallowed as a quick search.
    if (e.key === 'Tab' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      e.stopPropagation();
      if (openTabs.length > 1 && activeTabId) {
        const idx = openTabs.findIndex((t) => t.id === activeTabId);
        if (idx !== -1) {
          const dir = e.shiftKey ? -1 : 1;
          const next = openTabs[(idx + dir + openTabs.length) % openTabs.length];
          if (next) switchTab(next.id);
        }
      }
      return;
    }

    // Tab = quick send (compact mode only) — always intercept; never cycle pill icons.
    // Plain Tab only (Ctrl/Cmd+Tab is tab-cycling, handled above).
    if (
      overlayMode === 'compact'
      && e.key === 'Tab'
      && !e.shiftKey
      && !e.ctrlKey
      && !e.metaKey
      && !showFileNavRef.current
      && onQuickSend
    ) {
      e.preventDefault();
      e.stopPropagation();
      const now = Date.now();
      if (now - lastQuickSendAtRef.current < 250) return;
      lastQuickSendAtRef.current = now;
      userDismissedHubRef.current = false;
      openCompactHub(true);
      onQuickSend();
      return;
    }

    // Screenshot & send (Ctrl/Cmd+Shift+Enter) — capture the screen with Stuard
    // excluded from the frame (content-protection) and send it as an image.
    // Compact mode only; must run before the plain Ctrl+Enter branch below.
    if (isEnter && e.shiftKey && (e.ctrlKey || e.metaKey)) {
      if (overlayMode === 'compact' && onScreenshotSend) {
        qaLog('keydown:enter', { handler: 'textarea', branch: 'ctrl_shift_enter_screenshot' });
        e.preventDefault();
        e.stopPropagation();
        userDismissedHubRef.current = false;
        openCompactHub(true);
        onScreenshotSend();
        return;
      }
    }

    // Web Search Shortcut (Ctrl+Enter) — steer when streaming, otherwise open search
    if (isEnter && (e.ctrlKey || e.metaKey)) {
      qaLog('keydown:enter', { handler: 'textarea', branch: 'ctrl_enter_web_or_steer' });
      e.preventDefault();
      if (miniOutputStreaming && onSteer && query.trim()) {
        onSteer();
        return;
      }
      // We need to access the current default engine here, but states in callbacks can be stale
      // Using a ref or just reading from localStorage is safer for this quick patch, 
      // but simpler is to trust the closure if this callback is recreated when state changes.
      // However, handleKeyDown has [onSend] dependency. 
      // Let's dispatch a custom event or just trigger the search via a dedicated handler that we'll Expose/Use.
      // Ideally, we'd call the search function directly.
      const savedEngine = typeof window !== 'undefined' ? localStorage.getItem('stuard_default_search_engine') : 'google';
      const engineId = normalizeCompactSearchEngineId(savedEngine);
      const q = query.trim();
      const url = compactSearchUrl(engineId, q);

      if (q) {
        window.desktopAPI?.openExternal?.(url);
        setQuery("");
        window.desktopAPI?.hide?.();
      } else {
        window.desktopAPI?.openExternal?.(url);
      }
      return;
    }

    if (isEnter && !e.shiftKey) {
      qaLog('keydown:enter', {
        handler: 'textarea',
        branch: 'fallback_onSend',
        showSearchOptionsRef: showSearchOptionsRef.current,
        selectableCount: selectableItemsRef.current.length,
        query: query.trim(),
      });
      e.preventDefault();
      userDismissedHubRef.current = false;
      openCompactHub(true);
      onSend();
    }
  }, [onSend, onQuickSend, onScreenshotSend, onSteer, query, setQuery, miniOutputStreaming, openCompactHub, closeCompactHub, overlayMode, openTabs, activeTabId, switchTab, setSelectedIndexSynced]);

  // File Navigation State for @ mentions
  const [showFileNav, setShowFileNav] = useState(false);
  const [fileNavFilter, setFileNavFilter] = useState("");
  const fileNavDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep ref in sync for handleKeyDown
  useEffect(() => { showFileNavRef.current = showFileNav; }, [showFileNav]);

  // Inline integration suggestion — one controller drives both the expanded chip
  // and the compact search-dropdown row.
  const integrationSuggestion = useIntegrationSuggestion({
    query,
    accessToken,
    enabled: !showFileNav,
  });

  const [fileNavOverlay, setFileNavOverlay] = useState<null | {
    left: number;
    top: number;
    placement: 'top' | 'bottom';
    width: number;
  }>(null);

  const updateFileNavOverlayPos = useCallback(() => {
    if (!showFileNav) return;
    const el = localTextareaRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const margin = 10;
    // Match input width, but respect screen bounds and max width
    const width = Math.min(Math.max(300, rect.width), 600);

    const left = Math.min(
      Math.max(rect.left, margin),
      Math.max(margin, window.innerWidth - width - margin),
    );

    const spaceAbove = rect.top - margin;
    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const placement = chooseDropdownPlacement({
      currentPlacement: fileNavOverlay?.placement ?? 'bottom',
      spaceAbove,
      spaceBelow,
      minComfortableSpace: 280,
      hysteresis: 36,
    });
    const top = placement === 'top' ? rect.top - dropdownGap : rect.bottom + dropdownGap;

    setFileNavOverlay({ left, top, placement, width });
  }, [dropdownGap, fileNavOverlay?.placement, showFileNav]);

  useEffect(() => {
    if (!showFileNav) return;
    updateFileNavOverlayPos();

    const handler = () => updateFileNavOverlayPos();
    window.addEventListener('resize', handler);
    // capture=true catches scroll events from nested containers too
    window.addEventListener('scroll', handler, true);
    return () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('scroll', handler, true);
    };
  }, [showFileNav, updateFileNavOverlayPos]);

  useEffect(() => {
    // Debounce the file navigator check to avoid expensive updates on every keystroke
    if (fileNavDebounceRef.current) {
      clearTimeout(fileNavDebounceRef.current);
    }

    fileNavDebounceRef.current = setTimeout(() => {
      // Find the last @ in the query
      const lastAt = query.lastIndexOf("@");

      if (lastAt === -1) {
        // No @ found, close navigator
        setShowFileNav(false);
        setFileNavFilter("");
        return;
      }

      // Get text after @
      const afterAt = query.substring(lastAt + 1);

      // Just a bare @ at the end -> open navigator with no filter
      if (afterAt.length === 0) {
        const charBeforeBare = lastAt > 0 ? query[lastAt - 1] : " ";
        if (charBeforeBare === " " || charBeforeBare === "\n" || lastAt === 0) {
          setShowFileNav(true);
          setFileNavFilter("");
        } else {
          setShowFileNav(false);
          setFileNavFilter("");
        }
        return;
      }

      // If there's any whitespace after @, close navigator (user is done/ignoring it)
      if (/\s/.test(afterAt)) {
        setShowFileNav(false);
        setFileNavFilter("");
        return;
      }

      // Check if @ is at start or preceded by whitespace (valid trigger)
      const charBefore = lastAt > 0 ? query[lastAt - 1] : " ";
      if (charBefore === " " || charBefore === "\n" || lastAt === 0) {
        setShowFileNav(true);
        setFileNavFilter(afterAt); // Text after @ becomes the filter
      } else {
        setShowFileNav(false);
        setFileNavFilter("");
      }
    }, 100); // 100ms debounce

    return () => {
      if (fileNavDebounceRef.current) {
        clearTimeout(fileNavDebounceRef.current);
      }
    };
  }, [query]);

  const handleFileSelect = useCallback((item: ContextItem) => {
    // Remove the @ and any filter text from query
    const lastAt = query.lastIndexOf("@");
    if (lastAt >= 0) {
      setQuery(query.substring(0, lastAt).trimEnd());
    }
    // Add to context paths if not already present
    if (contextPaths && setContextPaths && !contextPaths.some(c => c.path === item.path)) {
      setContextPaths(prev => [...prev, item]);
    }
    setShowFileNav(false);
    setFileNavFilter("");
  }, [query, contextPaths, setContextPaths, setQuery]);

  const handleNavigate = useCallback((path: string) => {
    const lastAt = query.lastIndexOf("@");
    if (lastAt >= 0) {
      // Replace everything after the last @ with the new path
      const newQuery = query.substring(0, lastAt + 1) + path;
      setQuery(newQuery);
      // We rely on the useEffect to update the filter state
    }
  }, [query, setQuery]);

  // Reposition the expanded-mode overlay when the filter changes (typing after @)
  useEffect(() => {
    if (!showFileNav) return;
    updateFileNavOverlayPos();
  }, [showFileNav, fileNavFilter, updateFileNavOverlayPos]);

  const removeContext = useCallback((index: number) => {
    if (setContextPaths) {
      setContextPaths(prev => prev.filter((_, i) => i !== index));
    }
  }, [setContextPaths]);

  // Show search options dropdown when user has typed something (not @ mentions)
  const showSearchOptions = !expanded && query.trim().length >= 2 && !showFileNav;
  showSearchOptionsRef.current = showSearchOptions;
  const typingActive = query.trim().length > 0;

  // Auto-open quick response when the assistant starts streaming.
  useEffect(() => {
    const streaming = !!miniOutputStreaming;
    const streamingStarted = streaming && !wasStreamingRef.current;
    wasStreamingRef.current = streaming;

    if (!streamingStarted || expanded || overlayMode !== 'compact') return;
    if (showSearchOptions || showFileNav) return;
    openCompactHub(true);
  }, [miniOutputStreaming, expanded, overlayMode, showSearchOptions, showFileNav, openCompactHub]);

  // Auto-open when AI work begins (voice / other send paths).
  useEffect(() => {
    if (!isAiWorking || expanded || overlayMode !== 'compact') return;
    if (showSearchOptions || showFileNav) return;
    openCompactHub();
  }, [isAiWorking, expanded, overlayMode, showSearchOptions, showFileNav, openCompactHub]);

  // State for expanded web search options - must be defined before updateWindowSize
  const [showWebOptions, setShowWebOptions] = useState(false);
  const [defaultEngineId, setDefaultEngineId] = useState(() => {
    if (typeof window !== 'undefined') {
      return normalizeCompactSearchEngineId(localStorage.getItem('stuard_default_search_engine'));
    }
    return 'google';
  });

  const handleSetDefaultEngine = useCallback((id: string) => {
    const nextId = normalizeCompactSearchEngineId(id);
    setDefaultEngineId(nextId);
    localStorage.setItem('stuard_default_search_engine', nextId);
    setShowWebOptions(false);
  }, []);

  // Reset web options when search options close
  useEffect(() => {
    if (!showSearchOptions) {
      setShowWebOptions(false);
    }
  }, [showSearchOptions]);

  const [extraInputHeight, setExtraInputHeight] = useState(0);
  const extraInputHeightRef = useRef(0);
  const currentTextareaHeightRef = useRef(36);
  const [dropdownPlacement, setDropdownPlacement] = useState<'top' | 'bottom'>('top');
  const dropdownPlacementRef = useRef<'top' | 'bottom'>('top');
  /**
   * Placement we last applied an anchor for. When this differs from the
   * placement we're about to apply, the input bar needs to physically swap
   * window edges — that's the only path that uses raw setBounds; everything
   * else goes through `overlay:resize` with the appropriate anchor and lets
   * the main process do the math.
   */
  const lastAppliedPlacementRef = useRef<'top' | 'bottom'>('top');
  /** Locked placement while ANY overlay (dropdown / hub / peek) is visible. */
  const lockedOverlayPlacementRef = useRef<'top' | 'bottom' | null>(null);
  /** Locked dropdown reserve so async results don't resize the window. */
  const lockedOverlayHeightRef = useRef(0);
  const [lockedOverlayHeight, setLockedOverlayHeight] = useState(0);
  /** Last (w, h, anchor) tuple we asked main-process for — dedupes IPC spam. */
  const lastSentBoundsRef = useRef<{ w: number; h: number; anchor: 'top' | 'bottom' } | null>(null);
  /**
   * Coalesces updateWindowSize calls within a single animation frame into one
   * IPC. A keystroke can trigger updateWindowSize 3-5 times in the same render
   * cycle (useEffect dep changes + textarea remeasure + ...). Each call here
   * cancels the previous RAF and schedules a new one; only the last fires.
   */
  const pendingResizeRafRef = useRef<number | null>(null);
  const pendingVisualPlacementTimerRef = useRef<number | null>(null);
  const compactMousePassthroughRef = useRef(false);
  const lastPlacementFlipAtRef = useRef(0);
  const COMPACT_WINDOW_PY = 14;

  const calculatePlacement = useCallback((): 'top' | 'bottom' => {
    try {
      const screenTop = (window?.screen as any)?.availTop ?? 0;
      const screenHeight = window?.screen?.availHeight || 1080;
      const screenBottom = screenTop + screenHeight;
      const screenCenter = screenTop + screenHeight / 2;

      const windowTop = window?.screenY || window?.screenTop || 0;
      const windowHeight = window?.outerHeight || 88;
      const hasContextForPlacement = (contextPaths && contextPaths.length > 0);
      const inputBarHeightForPlacement = 88
        + extraInputHeightRef.current
        + 8
        + (hasContextForPlacement ? 44 : 0);

      const currentPlacement = dropdownPlacementRef.current;

      // Where the input bar actually sits on screen. Prefer a LIVE DOM measure
      // of the pill: it's placement-independent, so the estimate doesn't jump
      // when we flip. The old estimate derived the bar position FROM the current
      // placement, so each flip moved the estimate and could immediately flip it
      // back — that feedback loop is what made the dropdown thrash at mid-screen.
      let barTop: number;
      let barBottom: number;
      const rect = localTextareaRef.current?.getBoundingClientRect();
      if (rect && rect.height > 0) {
        const barScreenTop = windowTop + rect.top;
        // The pill is a little taller than the textarea — pad to roughly its box.
        barTop = barScreenTop - 10;
        barBottom = barScreenTop + rect.height + 10;
      } else {
        const inputTop = currentPlacement === 'top'
          ? windowTop + windowHeight - COMPACT_WINDOW_PY - inputBarHeightForPlacement
          : windowTop + COMPACT_WINDOW_PY;
        barTop = inputTop;
        barBottom = inputTop + inputBarHeightForPlacement;
      }
      const barCenter = (barTop + barBottom) / 2;

      // Hold briefly after a flip so the window reposition can settle before we
      // re-evaluate on the next animation-frame move checks. Keep this short:
      // at Ctrl+Arrow speeds, 220ms lets the panel travel visibly past an edge.
      if (Date.now() - lastPlacementFlipAtRef.current < 72) {
        return currentPlacement;
      }

      const needsDropdownForPlacement = showSearchOptions || showFileNav;
      const overlayPanel = document.querySelector<HTMLElement>('[data-compact-overlay-panel="true"]');
      const overlayRect = overlayPanel?.getBoundingClientRect();
      const dropdownHeightForPlacement = needsDropdownForPlacement
        ? Math.min(
            COMPACT_DROPDOWN_MAX_HEIGHT,
            Math.max(96, overlayRect?.height || lockedOverlayHeightRef.current || COMPACT_DROPDOWN_MAX_HEIGHT),
          )
        : 0;
      const neededDropdownRoom = dropdownHeightForPlacement + COMPACT_OVERLAY_DROPDOWN_GAP;
      const roomAbove = Math.max(0, barTop - screenTop - COMPACT_DROPDOWN_FLIP_MARGIN);
      const roomBelow = Math.max(0, screenBottom - barBottom - COMPACT_DROPDOWN_FLIP_MARGIN);
      const fitsAbove = roomAbove >= neededDropdownRoom;
      const fitsBelow = roomBelow >= neededDropdownRoom;

      // Primary signal: which half of the screen the bar is in, with a deadband
      // so the middle does NOT flip. Bar in the TOP half -> open downward
      // ('bottom'); bar in the BOTTOM half -> open upward ('top'). The deadband is
      // only crossed when the bar is clearly on one side, which is what stops the
      // rapid flip-flop while the bar sits near the middle.
      const deadband = Math.min(140, screenHeight * 0.1);
      let next: 'top' | 'bottom' = currentPlacement;
      if (currentPlacement === 'top') {
        if (barCenter < screenCenter - deadband) next = 'bottom';
      } else {
        if (barCenter > screenCenter + deadband) next = 'top';
      }

      // Second trigger: edge overflow. This is intentionally based on the
      // CURRENT side, not the tentative `next` side. If neither side can fit the
      // full 560px panel, blindly flipping on "!fits" causes ping-pong. We only
      // let overflow override when the other side fits, or has a meaningful room
      // advantage.
      if (
        currentPlacement === 'top'
        && !fitsAbove
        && (fitsBelow || roomBelow > roomAbove + COMPACT_DROPDOWN_ROOM_HYSTERESIS)
      ) {
        next = 'bottom';
      } else if (
        currentPlacement === 'bottom'
        && !fitsBelow
        && (fitsAbove || roomAbove > roomBelow + COMPACT_DROPDOWN_ROOM_HYSTERESIS)
      ) {
        next = 'top';
      }

      return next;
    } catch {
      return 'top';
    }
  }, [attachments.length, contextPaths, showSearchOptions, showFileNav]);

  // Max room the OS will actually let the dropdown occupy, given the current
  // window position and chosen growth direction. The dropdown is portaled to
  // document.body, so anything past the OS-clamped window edge gets clipped
  // — overflow-y-auto can't save it. We cap to this AND the app-level cap.
  //
  // CAP_WINDOW_H must match MODE_SIZE_CONSTRAINTS.compact.maxH in the main
  // process (window.ts). If they drift, the renderer asks for more height
  // than the OS will grant, Electron silently clamps, and the anchor='bottom'
  // dy math in setOverlaySize teleports the pill upward by the clamped delta
  // every single resize. They MUST agree.
  const CAP_WINDOW_H = 760;
  const computeMaxDropdownH = useCallback((placement: 'top' | 'bottom', inputBarH: number): number => {
    try {
      const screenAvailTop = (window?.screen as any)?.availTop ?? 0;
      const screenAvailH = window?.screen?.availHeight ?? 900;
      const screenAvailBottom = screenAvailTop + screenAvailH;
      const winTop = window?.screenY ?? window?.screenTop ?? 0;
      let inputTop: number;
      const rect = localTextareaRef.current?.getBoundingClientRect();
      if (rect && rect.height > 0) {
        inputTop = winTop + rect.top - 10;
      } else {
        const winH = window?.outerHeight ?? CAP_WINDOW_H;
        const currentPlacement = dropdownPlacementRef.current;
        inputTop = currentPlacement === 'top'
          ? winTop + winH - COMPACT_WINDOW_PY - inputBarH
          : winTop + COMPACT_WINDOW_PY;
      }
      const inputBottom = inputTop + inputBarH;
      const roomForDropdown = placement === 'top'
        ? inputTop - screenAvailTop
        : screenAvailBottom - inputBottom;
      return Math.max(
        96,
        Math.min(COMPACT_DROPDOWN_MAX_HEIGHT, roomForDropdown - COMPACT_WINDOW_DROPDOWN_MARGIN),
      );
    } catch {
      return 480;
    }
  }, []);

  // Expand/collapse state for the compact status pill. Lifted above
  // updateWindowSize because the carousel feed (driven by these states)
  // determines the pill height and thus the window height.
  const [statusHovered, setStatusHovered] = useState(false);
  const [statusPinned, setStatusPinned] = useState(false);
  const statusExpanded = statusHovered || statusPinned;

  // Build the carousel feed: explicit `statusItems` prop wins; otherwise fall
  // back to a 1-item list synthesised from the legacy single-pill props so
  // existing call sites keep working until they register providers themselves.
  const effectiveStatusItems = React.useMemo<StatusItem[]>(() => {
    if (Array.isArray(statusItems) && statusItems.length > 0) return statusItems;
    if (statusText && statusIcon) {
      // Thinking is shown via the compact pill glow border, not the sparkle pill.
      if (statusIcon === 'ai' && isAiWorking) return [];
      return [{
        id: `legacy-${statusIcon}`,
        text: statusText,
        icon: statusIcon,
        urgency: statusUrgency,
        priority: 100,
      }];
    }
    return [];
  }, [statusItems, statusText, statusIcon, statusUrgency, isAiWorking]);

  const { current: currentStatusItem, count: statusItemCount } = useStatusCarousel(
    effectiveStatusItems,
    { intervalMs: 10_000, paused: statusExpanded },
  );

  // === Window sizing / anchoring ====================================
  //
  // The compact overlay has to grow/shrink the OS window every time the
  // dropdown opens, the textarea reflows, async file results arrive, or the
  // peek shows up. Each of those events fires updateWindowSize.
  //
  // Anchoring rule:
  //   placement='bottom' (dropdown below input bar) → input bar at WINDOW TOP
  //     → anchor 'top' : main-process keeps window TOP edge fixed.
  //   placement='top'    (dropdown above input bar) → input bar at WINDOW BOTTOM
  //     → anchor 'bottom' : main-process keeps window BOTTOM edge fixed.
  //
  // Either way the input bar stays at the same screen Y. That's the whole
  // point of the anchor IPC — the renderer doesn't have to compute Y from
  // (possibly-stale) window.screenY, and concurrent updates can't drift.
  //
  // The ONLY path that uses raw setBounds is a placement flip (the user
  // dragged the window past the screen-midline hysteresis while a dropdown
  // is open). For that one-shot translation we read window.screenY and emit
  // exactly one setBounds; subsequent resizes return to the anchored path.
  // ===================================================================
  const updateWindowSize = useCallback(() => {
    if (expanded) return;
    if (overlayMode !== 'compact') return;
    const api = (window as any).desktopAPI;
    if (!api) return;

    // Coalesce multiple calls in the same frame. The body below executes once
    // per RAF with the freshest closure (this useCallback rebinds on dep
    // change, so the latest invocation captures latest state).
    if (pendingResizeRafRef.current !== null) {
      cancelAnimationFrame(pendingResizeRafRef.current);
    }
    pendingResizeRafRef.current = requestAnimationFrame(() => {
      pendingResizeRafRef.current = null;
      runResize();
    });

    function runResize() {
    const needsDropdown = showSearchOptions || showFileNav;
    const needsOverlay = needsDropdown || compactHubOpen || showHubPeek;

    const height = currentTextareaHeightRef.current;
    const baseTextareaHeight = 36;
    const extraHeight = Math.max(0, height - baseTextareaHeight);

    const hasContextRows = (contextPaths && contextPaths.length > 0);
    const attachmentHeight = hasContextRows ? 44 : 0;
    const showStatusPill = statusItemCount > 0;
    const statusPillHeight = showStatusPill ? 40 : 0;
    const compactTitleBarHeight = 0; // compact title bar is currently always hidden
    const baseHeight = 88 + attachmentHeight + statusPillHeight + compactTitleBarHeight;

    if (extraHeight !== extraInputHeightRef.current) {
      extraInputHeightRef.current = extraHeight;
      setExtraInputHeight(extraHeight);
    }

    const inputBarHeightForCalc = 88
      + extraHeight + 8 /* inputBarGap */
      + attachmentHeight + statusPillHeight + compactTitleBarHeight;

    // --- 1. Decide placement -------------------------------------------------
    // Lock placement whenever ANY overlay is visible. While locked, the
    // placement does NOT recompute on every render — that's what causes the
    // teleport. The placement only changes either (a) when the user drags the
    // window across the screen-midline hysteresis (handled by
    // applyPlacementOnMove updating the lock) or (b) when no overlay is up.
    if (needsOverlay) {
      if (!lockedOverlayPlacementRef.current) {
        lockedOverlayPlacementRef.current = calculatePlacement();
      }
    } else if (lockedOverlayPlacementRef.current) {
      lockedOverlayPlacementRef.current = null;
    }

    // Dropdown reserve is locked only while the dropdown is showing — peek/hub
    // don't need a fixed reserve since their height is driven by content.
    if (needsDropdown) {
      if (!lockedOverlayHeightRef.current) {
        const maxH = Math.min(
          COMPACT_DROPDOWN_MAX_HEIGHT,
          Math.max(
            computeMaxDropdownH('top', inputBarHeightForCalc),
            computeMaxDropdownH('bottom', inputBarHeightForCalc),
          ),
        );
        lockedOverlayHeightRef.current = maxH;
        setLockedOverlayHeight(maxH);
      }
    } else if (lockedOverlayHeightRef.current) {
      lockedOverlayHeightRef.current = 0;
      setLockedOverlayHeight(0);
    }

    const placement = lockedOverlayPlacementRef.current
      ?? calculatePlacement();

    if (placement !== dropdownPlacementRef.current) {
      dropdownPlacementRef.current = placement;
      setDropdownPlacement(placement);
    }

    // --- 2. Compute target dimensions ---------------------------------------
    const maxDropdownH = computeMaxDropdownH(placement, inputBarHeightForCalc);
    const dropdownHeight = needsDropdown
      ? (lockedOverlayHeightRef.current || Math.min(COMPACT_DROPDOWN_MAX_HEIGHT, maxDropdownH))
      : 0;

    const dropdownEdgeMargin = COMPACT_WINDOW_DROPDOWN_MARGIN;
    const peekEdgeMargin = 8;
    const quickResponseOpen = compactHubOpen && !needsDropdown;
    const hubPeekVisible = showHubPeek && !compactHubOpen && !needsDropdown;
    const quickResponsePanelHeight = quickResponseOpen
      ? Math.min(
          Math.max(
            quickResponseHeight || COMPACT_QUICK_RESPONSE_MIN_HEIGHT,
            COMPACT_QUICK_RESPONSE_MIN_HEIGHT,
          ),
          COMPACT_RESPONSE_PANEL_MAX_HEIGHT,
          maxDropdownH,
        )
      : 0;
    const quickResponseReserve = quickResponseOpen
      ? quickResponsePanelHeight + COMPACT_QUICK_RESPONSE_CHROME
      : 0;

    const contentHeight = needsDropdown
      ? inputBarHeightForCalc + dropdownHeight + dropdownEdgeMargin
      : quickResponseOpen
        ? inputBarHeightForCalc + quickResponseReserve
        : hubPeekVisible
          ? inputBarHeightForCalc + COMPACT_HUB_PEEK_VISIBLE + peekEdgeMargin
          : baseHeight;

    // Bottom-half rewrite: when placement='top', the dropdown renders above
    // the pill, so any native resize is a move+resize of a transparent window.
    // That is the Windows one-frame "reload" flash. Keep the compact window
    // at its stable max height for this orientation, including while idle, and
    // let search/file dropdowns mount inside that already-sized canvas.
    let targetHeight = placement === 'top' ? CAP_WINDOW_H : contentHeight;

    const minWindowHeight = 88 + compactTitleBarHeight;
    const usesInputBarCalc = needsDropdown || quickResponseOpen || hubPeekVisible;
    const finalHeight = Math.min(
      Math.max(minWindowHeight, usesInputBarCalc ? targetHeight : targetHeight + extraHeight),
      CAP_WINDOW_H,
    );
    const roundedW = 520;
    const roundedH = Math.round(finalHeight);

    // --- 3. Choose anchor & dispatch ----------------------------------------
    const anchor = compactWindowResizeAnchor(placement);
    const placementChanged = placement !== lastAppliedPlacementRef.current;
    const last = lastSentBoundsRef.current;

    // Placement flip: rare (only on user-initiated drag across the midline
    // while an overlay is open). We need to physically move the window so
    // the input bar lands at the same screen Y under the new orientation.
    // First-ever call (last == null) is NOT a flip even if the default
    // lastAppliedPlacementRef diverges from calculatePlacement — the window
    // is still at baseline height and the pill is visually centered, so
    // anchored resize alone preserves position.
    if (placementChanged && last) {
      const currentScreenX = window.screenX;
      const currentScreenY = window.screenY;
      const liveOuterH = Math.round(window.outerHeight || roundedH);
      const oldAnchor = compactWindowResizeAnchor(lastAppliedPlacementRef.current);
      // Where the input bar's TOP edge sits on screen right now.
      const inputBarTopY = oldAnchor === 'top'
        ? currentScreenY + COMPACT_WINDOW_PY
        : currentScreenY + liveOuterH - COMPACT_WINDOW_PY - inputBarHeightForCalc;
      // Window Y such that input bar lands at that same screen Y under the
      // new placement.
      const targetY = anchor === 'top'
        ? inputBarTopY - COMPACT_WINDOW_PY
        : inputBarTopY - roundedH + COMPACT_WINDOW_PY + inputBarHeightForCalc;
      try {
        api.setBounds?.({
          x: Math.round(currentScreenX),
          y: Math.round(targetY),
          width: roundedW,
          height: roundedH,
          anchor,
        });
      } catch {}
      lastAppliedPlacementRef.current = placement;
      lastSentBoundsRef.current = { w: roundedW, h: roundedH, anchor };
      return;
    }

    // Common case: same placement → atomic anchored resize in main process.
    if (last && last.w === roundedW && last.h === roundedH && last.anchor === anchor) {
      // Width/height/anchor unchanged → main process would no-op anyway.
      // Skip the IPC round-trip.
      lastAppliedPlacementRef.current = placement;
      return;
    }
    lastSentBoundsRef.current = { w: roundedW, h: roundedH, anchor };
    lastAppliedPlacementRef.current = placement;
    try { api.resize?.(roundedW, roundedH, anchor); } catch {}
    } // end runResize
  }, [
    expanded,
    overlayMode,
    showSearchOptions,
    showFileNav,
    calculatePlacement,
    computeMaxDropdownH,
    attachments.length,
    contextPaths?.length,
    statusItemCount,
    compactHubOpen,
    showHubPeek,
    quickResponseHeight,
  ]);

  // Cancel any pending RAF on unmount.
  useEffect(() => () => {
    if (pendingResizeRafRef.current !== null) {
      cancelAnimationFrame(pendingResizeRafRef.current);
      pendingResizeRafRef.current = null;
    }
    if (pendingVisualPlacementTimerRef.current !== null) {
      window.clearTimeout(pendingVisualPlacementTimerRef.current);
      pendingVisualPlacementTimerRef.current = null;
    }
  }, []);

  const setCompactMousePassthrough = useCallback((ignore: boolean) => {
    if (compactMousePassthroughRef.current === ignore) return;
    compactMousePassthroughRef.current = ignore;
    try {
      window.desktopAPI?.setIgnoreMouseEvents?.(ignore, ignore ? { forward: true } : undefined);
    } catch {}
  }, []);

  useEffect(() => {
    if (expanded || overlayMode !== 'compact') {
      setCompactMousePassthrough(false);
      return;
    }

    const updatePassthrough = (event: MouseEvent) => {
      const el = document.elementFromPoint(event.clientX, event.clientY);
      const interactive = !!el?.closest?.(
        '[data-compact-hit-area="true"], [data-radix-popper-content-wrapper]',
      );
      setCompactMousePassthrough(!interactive);
    };

    window.addEventListener('mousemove', updatePassthrough);
    window.addEventListener('mousedown', updatePassthrough, true);
    return () => {
      window.removeEventListener('mousemove', updatePassthrough);
      window.removeEventListener('mousedown', updatePassthrough, true);
      setCompactMousePassthrough(false);
    };
  }, [expanded, overlayMode, setCompactMousePassthrough]);

  // Hub open → resize immediately; hub close → wait for exit animation so the
  // pill doesn't jump while the panel is still sliding away.
  useEffect(() => {
    if (expanded || overlayMode !== 'compact') return;

    if (hubResizeTimerRef.current) {
      clearTimeout(hubResizeTimerRef.current);
      hubResizeTimerRef.current = null;
    }

    if (compactHubOpen) {
      updateWindowSize();
    } else {
      hubResizeTimerRef.current = setTimeout(() => {
        updateWindowSize();
        hubResizeTimerRef.current = null;
      }, 240);
    }

    return () => {
      if (hubResizeTimerRef.current) {
        clearTimeout(hubResizeTimerRef.current);
        hubResizeTimerRef.current = null;
      }
    };
  }, [compactHubOpen, expanded, overlayMode, updateWindowSize]);

  // Update on dropdown / peek / content changes — not on every stream tick.
  useEffect(() => {
    if (expanded) return;
    updateWindowSize();
  }, [
    expanded,
    updateWindowSize,
    showSearchOptions,
    showFileNav,
    overlayMode,
    attachments.length,
    contextPaths?.length,
    statusItemCount,
    showHubPeek,
    quickResponseHeight,
  ]);

  // Drag-detection: the user can move the window via the title-bar drag
  // region, which Electron doesn't surface as a DOM event. While a dropdown is
  // open we check on each animation frame so placement can flip before the
  // native window edge clips the portal.
  const applyPlacementOnMove = useCallback(() => {
    if (expanded || overlayMode !== 'compact') return;
    const nextPlacement = calculatePlacement();
    const lockedP = lockedOverlayPlacementRef.current;
    const currentPlacement = lockedP ?? dropdownPlacementRef.current;
    if (nextPlacement !== currentPlacement) {
      // Window crossed the hysteresis boundary — re-lock placement and
      // refresh the dropdown reserve for the new direction.
      if (lockedP) {
        lockedOverlayPlacementRef.current = nextPlacement;
      }
      lastPlacementFlipAtRef.current = Date.now();
      dropdownPlacementRef.current = nextPlacement;
      const inputBarHeightForCalc = 88
        + extraInputHeightRef.current + 8
        + ((contextPaths && contextPaths.length > 0) ? 44 : 0)
        + (statusItemCount > 0 ? 40 : 0);
      if (lockedOverlayHeightRef.current) {
        const maxH = Math.min(
          COMPACT_DROPDOWN_MAX_HEIGHT,
          Math.max(
            computeMaxDropdownH('top', inputBarHeightForCalc),
            computeMaxDropdownH('bottom', inputBarHeightForCalc),
          ),
        );
        lockedOverlayHeightRef.current = maxH;
        setLockedOverlayHeight(maxH);
      }
      updateWindowSize();
      if (pendingVisualPlacementTimerRef.current !== null) {
        window.clearTimeout(pendingVisualPlacementTimerRef.current);
      }
      pendingVisualPlacementTimerRef.current = window.setTimeout(() => {
        pendingVisualPlacementTimerRef.current = null;
        setDropdownPlacement(nextPlacement);
      }, 48);
    }
  }, [
    expanded,
    overlayMode,
    showSearchOptions,
    showFileNav,
    compactHubOpen,
    showHubPeek,
    calculatePlacement,
    computeMaxDropdownH,
    attachments.length,
    contextPaths,
    statusItemCount,
    updateWindowSize,
  ]);

  useEffect(() => {
    if (expanded || overlayMode !== 'compact') return;
    // Ctrl+Arrow moves the window at 900–1500px/s. A slow poll lets the dropdown
    // slide well past the screen edge before the flip catches up, so while a
    // flippable overlay is open we re-check placement on every frame (~16ms) and
    // it can't visibly overshoot. Idle (no overlay) falls back to a cheap poll.
    const overlayOpen = showSearchOptions || showFileNav || compactHubOpen;
    if (!overlayOpen) {
      const interval = setInterval(applyPlacementOnMove, 150);
      return () => clearInterval(interval);
    }
    let rafId = 0;
    let lastX = window.screenX;
    let lastY = window.screenY;
    const tick = () => {
      // window.screenX/Y are cheap (no layout). Only run the placement check
      // (which measures the bar via getBoundingClientRect) when the window has
      // actually moved, so an idle-open dropdown doesn't thrash layout at 60fps.
      const x = window.screenX;
      const y = window.screenY;
      if (x !== lastX || y !== lastY) {
        lastX = x;
        lastY = y;
        applyPlacementOnMove();
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [
    expanded,
    overlayMode,
    showSearchOptions,
    showFileNav,
    compactHubOpen,
    showHubPeek,
    applyPlacementOnMove,
  ]);

  // Handle height change for auto-expansion in compact mode
  const handleHeightChange = useCallback((height: number) => {
    currentTextareaHeightRef.current = height;
    updateWindowSize();
  }, [updateWindowSize]);

  // Search engines configuration. Lucide-iconed entries sit alongside the
  // image-logo brands; the engine picker chip accepts either as a ReactNode.
  const searchEngines = [
    { id: 'google', name: 'Google', icon: <img src={googleLogo} className="w-5 h-5 object-contain" alt="Google" />, color: 'text-blue-500', bg: 'bg-blue-500', ring: 'ring-blue-500/20', url: (q: string) => compactSearchUrl('google', q) },
    { id: 'bing', name: 'Bing', icon: <img src={bingLogo} className="w-5 h-5 object-contain" alt="Bing" />, color: 'text-cyan-500', bg: 'bg-cyan-500', ring: 'ring-cyan-500/20', url: (q: string) => compactSearchUrl('bing', q) },
    { id: 'duckduckgo', name: 'DuckDuckGo', icon: <img src={duckduckgoLogo} className="w-5 h-5 object-contain" alt="DuckDuckGo" />, color: 'text-orange-500', bg: 'bg-orange-500', ring: 'ring-orange-500/20', url: (q: string) => compactSearchUrl('duckduckgo', q) },
    { id: 'youtube', name: 'YouTube', icon: <img src={youtubeLogo} className="w-5 h-5 object-contain" alt="YouTube" />, color: 'text-red-500', bg: 'bg-red-500', ring: 'ring-red-500/20', url: (q: string) => compactSearchUrl('youtube', q) },
    { id: 'github', name: 'GitHub', icon: <img src={githubLogo} className="w-5 h-5 object-contain" alt="GitHub" />, color: 'text-purple-500', bg: 'bg-purple-500', ring: 'ring-purple-500/20', url: (q: string) => compactSearchUrl('github', q) },
    { id: 'merriam', name: 'Merriam-Webster', icon: <img src={merriamWebsterLogo} className="w-5 h-5 object-contain" alt="Merriam-Webster" />, color: 'text-rose-500', bg: 'bg-rose-500', ring: 'ring-rose-500/20', url: (q: string) => compactSearchUrl('merriam', q) },
    { id: 'wikipedia', name: 'Wikipedia', icon: <img src={wikipediaLogo} className="w-5 h-5 object-contain" alt="Wikipedia" />, color: 'text-slate-300', bg: 'bg-slate-500', ring: 'ring-slate-500/20', url: (q: string) => compactSearchUrl('wikipedia', q) },
  ];

  const activeEngine = searchEngines.find(e => e.id === defaultEngineId) || searchEngines[0];

  // Handle search option selection
  const handleSearchOption = useCallback((type: 'chat' | 'files' | 'web' | 'quick', engineId?: string) => {
    if (type === 'files') {
      // Manual trigger for file search if needed (already automatic now)
      const q = query.trim();
      if (q.length >= 2) {
        doQuickFileSearch(q);
        doSemanticRefine(q);
      }
    } else if (type === 'web') {
      const q = query.trim();
      const engine = searchEngines.find(e => e.id === engineId) || searchEngines[0];
      const url = engine.url(q);
      if (q) {
        window.desktopAPI?.openExternal?.(url);
        setQuery("");
        window.desktopAPI?.hide?.();
      } else {
        window.desktopAPI?.openExternal?.(url);
      }
      setShowWebOptions(false);
    } else if (type === 'quick') {
      // Quick action - expand to show commands
      onToggleExpand();
    } else {
      // Regular chat - just send
      onSend();
    }
  }, [query, setQuery, onSend, onToggleExpand, doQuickFileSearch, doSemanticRefine]);

  // Flat selectable items for the search-options dropdown (drives arrow-key + hover selection).
  // Must mirror the JSX render order so each row's index matches.
  const dropdownSelection = React.useMemo(() => {
    const items: { key: string; onSelect: () => void }[] = [];
    items.push({ key: 'ask-stuard', onSelect: () => handleSearchOption('chat') });
    items.push({ key: 'web-search', onSelect: () => handleSearchOption('web', activeEngine.id) });

    const stuardCommandsStart = items.length;
    stuardCommands.forEach((c) => {
      items.push({ key: `cmd-${c.id}`, onSelect: () => { c.run(); setQuery(''); } });
    });

    const appsStart = items.length;
    appResults.forEach((a: any, idx: number) => {
      items.push({
        key: `app-${a.path || a.name || idx}`,
        onSelect: () => {
          qaLog('click:app_row', {
            name: a.name,
            launchTarget: a.launchTarget,
            path: a.path,
          });
          void handleLaunchApp(a.launchTarget || a.path, 'click');
          setQuery('');
        },
      });
    });
    const bookmarksStart = items.length;
    matchingBookmarks.forEach((bm) => {
      items.push({ key: `bm-${bm.id}`, onSelect: () => executeBookmark(bm) });
    });

    const filesStart = items.length;
    const visibleFiles = (Array.isArray(fileResults) ? fileResults : []).slice(0, 6);
    visibleFiles.forEach((f: any, idx: number) => {
      items.push({
        key: `file-${f.id || f.path || idx}`,
        onSelect: () => {
          const kind = String(f?.kind || 'other').toLowerCase();
          if (kind === 'application') {
            (window as any).desktopAPI?.openPath?.(String(f.path));
            (window as any).desktopAPI?.hide?.();
            setQuery('');
          } else {
            handleAddFileAsContext(f);
          }
        },
      });
    });

    const workflowsStart = items.length;
    compactWorkflowHits.forEach((w) => {
      items.push({
        key: `wf-${w.id}`,
        onSelect: () => {
          if (w.deployed) {
            void runDeployedWorkflow(w.id, w.name);
          } else {
            openWorkflowInStudio(w.id);
          }
          setQuery('');
        },
      });
    });
    const marketplaceStart = items.length;
    marketplaceResults.forEach((w) => {
      items.push({
        key: `mp-${w.slug}`,
        onSelect: () => {
          window.desktopAPI?.openWorkflows?.({ marketplaceSlug: w.slug });
          window.desktopAPI?.hide?.();
        },
      });
    });

    return {
      items,
      offsets: { askStuard: 0, webSearch: 1, stuardCommandsStart, appsStart, bookmarksStart, filesStart, workflowsStart, marketplaceStart },
    };
  }, [
    stuardCommands,
    appResults,
    matchingBookmarks,
    fileResults,
    compactWorkflowHits,
    marketplaceResults,
    activeEngine.id,
    handleSearchOption,
    handleLaunchApp,
    handleAddFileAsContext,
    executeBookmark,
    setQuery,
  ]);

  // Keep dropdown row refs in sync during render (not useEffect) so Enter/arrow
  // handlers see the same rows the portal is showing, including apps that just loaded.
  selectableItemsRef.current = dropdownSelection.items;
  commitDropdownSelectionRef.current = (source = 'unknown') => {
    const { items, offsets } = dropdownSelection;
    const snapshot = {
      source,
      showSearchOptions,
      showSearchOptionsRef: showSearchOptionsRef.current,
      selectedIndex: selectedIndexRef.current,
      itemCount: items.length,
      itemKeys: items.map((i) => i.key),
      appsStart: offsets.appsStart,
      appCount: appResults.length,
      apps: appResults.slice(0, 8).map((a: any) => ({
        name: a.name,
        launchTarget: a.launchTarget,
        path: a.path,
      })),
    };

    if (!showSearchOptions) {
      qaWarn('commit:abort', { ...snapshot, reason: 'showSearchOptions_false' });
      return false;
    }
    const now = Date.now();
    if (now - lastDropdownCommitAtRef.current < 80) {
      qaLog('commit:debounced', snapshot);
      return true;
    }
    if (items.length === 0) {
      qaWarn('commit:abort', { ...snapshot, reason: 'no_items' });
      return false;
    }
    const idx = Math.min(Math.max(selectedIndexRef.current, 0), items.length - 1);
    const row = items[idx];
    if (!row) {
      qaWarn('commit:abort', { ...snapshot, reason: 'row_missing', idx });
      return false;
    }

    qaLog('commit:row', { ...snapshot, idx, rowKey: row.key });

    // Applications: launch from live appResults (same path as click) so Enter
    // cannot drift from a stale onSelect closure when results stream in.
    if (row.key.startsWith('app-')) {
      const appIdx = idx - offsets.appsStart;
      const app = appResults[appIdx];
      const target = String(app?.launchTarget || app?.path || '').trim();
      if (app && target) {
        lastDropdownCommitAtRef.current = now;
        qaLog('commit:launch_app', {
          source,
          idx,
          appIdx,
          rowKey: row.key,
          name: app.name,
          target,
        });
        void handleLaunchApp(target, `enter:${source}`);
        setQuery('');
        return true;
      }
      qaWarn('commit:app_fallback_onSelect', {
        source,
        idx,
        appIdx,
        rowKey: row.key,
        app: app
          ? { name: app.name, launchTarget: app.launchTarget, path: app.path }
          : null,
        reason: !app ? 'app_missing' : 'empty_target',
      });
    }

    lastDropdownCommitAtRef.current = now;
    qaLog('commit:onSelect', { source, idx, rowKey: row.key });
    row.onSelect();
    return true;
  };

  // Compact overlay: capture Enter at window level when the search dropdown is
  // open so it still commits even if the React tree reorders or swallows bubbling.
  useEffect(() => {
    if (expanded || overlayMode !== 'compact' || !showSearchOptions) return;
    qaLog('listener:window_capture', { attached: true, overlayMode, query: query.trim() });
    const onWindowKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.code !== 'NumpadEnter') return;
      if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement;
      const inCompactHitArea = !!(el instanceof HTMLElement && el.closest('[data-compact-hit-area]'));
      const isTextarea = el instanceof HTMLTextAreaElement;
      if (!isTextarea || !inCompactHitArea) {
        qaLog('listener:window_capture:skip', {
          key: e.key,
          code: e.code,
          activeTag: el?.tagName,
          isTextarea,
          inCompactHitArea,
          defaultPrevented: e.defaultPrevented,
        });
        return;
      }
      if (e.defaultPrevented) {
        qaLog('listener:window_capture:skip', { reason: 'already_prevented' });
        return;
      }
      const committed = commitDropdownSelectionRef.current('window-capture');
      qaLog('listener:window_capture:enter', { committed, defaultPrevented: e.defaultPrevented });
      if (!committed) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onWindowKeyDown, true);
    return () => {
      qaLog('listener:window_capture', { attached: false });
      window.removeEventListener('keydown', onWindowKeyDown, true);
    };
  }, [showSearchOptions, expanded, overlayMode, query]);

  useEffect(() => {
    if (overlayMode !== 'compact') return;
    qaLog('dropdown:visibility', {
      showSearchOptions,
      query: query.trim(),
      showFileNav,
      expanded,
      itemCount: dropdownSelection.items.length,
      selectedIndex: selectedIndexRef.current,
      appCount: appResults.length,
    });
  }, [
    overlayMode,
    showSearchOptions,
    query,
    showFileNav,
    expanded,
    dropdownSelection.items.length,
    appResults.length,
  ]);

  // Reset the highlight to the first row when the dropdown opens or the query
  // changes. Intentionally NOT keyed on item-list length: async results (files,
  // marketplace, icons) stream in a beat after the apps, and resetting on every
  // length change used to snap the highlight off an app the user had just
  // arrow-keyed to — so Enter hit "Ask Stuard" and dismissed instead of launching.
  useEffect(() => {
    setSelectedIndexSynced(0);
  }, [query, showSearchOptions, setSelectedIndexSynced]);

  // As results stream in/out, keep the selection in range without losing the
  // user's spot (clamp rather than reset to 0).
  useEffect(() => {
    const total = dropdownSelection.items.length;
    setSelectedIndexSynced((i) => (total === 0 ? 0 : Math.min(i, total - 1)));
  }, [dropdownSelection.items.length, setSelectedIndexSynced]);

  // Input bar height - must match the actual rendered height of the input section
  // Base: container p-2 (8px) + input card min-h (114px) + extra padding (~18px) = ~140px
  // Add gap for visual separation between dropdown and input bar
  const inputBarGap = 8;
  const hasContextRows = (contextPaths && contextPaths.length > 0);
  const attachmentOffset = hasContextRows ? 44 : 0;
  void statusMinutesUntil; // reserved for future tighter gating

  const hasStatusPill = overlayMode === 'compact' && !!currentStatusItem;
  const statusPillOffset = hasStatusPill ? 40 : 0;
  const showCompactTitleBar = false;
  const compactTitleBarOffset = showCompactTitleBar ? COMPACT_TITLE_BAR_HEIGHT : 0;
  const compactTitleText =
    displayConversationTitle(openTabs.find((tab) => tab.id === activeTabId)?.title)
    || displayConversationTitle(conversationTitle)
    || (isAiWorking ? 'Working…' : 'Chat');
  const baseInputBarHeight = (overlayMode === 'compact' ? 88 : 140) + compactTitleBarOffset;
  const inputBarHeight = baseInputBarHeight + extraInputHeight + inputBarGap + attachmentOffset + statusPillOffset;

  // Collapse expand state when the pill itself is no longer rendered.
  useEffect(() => {
    if (!hasStatusPill) {
      setStatusHovered(false);
      setStatusPinned(false);
    }
  }, [hasStatusPill]);

  // Drag-corner state: a small grip at the input bar's bottom-right that the
  // user can pull to snap the overlay into window mode. Tracked here (not in
  // the compact-mode branch below) so the listeners survive re-renders.
  const cornerDragStartRef = useRef<{ x: number; y: number } | null>(null);
  const [cornerDrag, setCornerDrag] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [cornerSnapping, setCornerSnapping] = useState(false);

  const handleCornerPointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    cornerDragStartRef.current = { x: e.clientX, y: e.clientY };

    const onMove = (ev: PointerEvent) => {
      const start = cornerDragStartRef.current;
      if (!start) return;
      setCornerDrag({
        x: Math.max(0, ev.clientX - start.x),
        y: Math.max(0, ev.clientY - start.y),
      });
    };

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };

    const onUp = (ev: PointerEvent) => {
      const start = cornerDragStartRef.current;
      cornerDragStartRef.current = null;
      cleanup();
      if (!start) { setCornerDrag({ x: 0, y: 0 }); return; }
      const dx = Math.max(0, ev.clientX - start.x);
      const dy = Math.max(0, ev.clientY - start.y);
      const distance = Math.hypot(dx, dy);

      if (distance >= 36) {
        // Past threshold → brief overshoot, then expand. The 220ms gives
        // the bar a satisfying "pop" before the actual mode switch fires.
        setCornerSnapping(true);
        setCornerDrag({ x: 0, y: 0 });
        closeCompactHub();
        window.setTimeout(() => {
          setCornerSnapping(false);
          try { onToggleExpand(); } catch {}
        }, 220);
      } else {
        // Spring back to rest.
        setCornerDrag({ x: 0, y: 0 });
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, [onToggleExpand, closeCompactHub]);

  // Compact Mode
  if (!expanded) {
    const needsDropdown = showSearchOptions || showFileNav;
    // Cap dropdown height to the room actually available between the input bar
    // and the OS-clamped window edge in the current placement direction. The
    // dropdown is portaled to document.body, so anything past the native window
    // edge gets clipped by the OS — overflow-y-auto can't save it. Mirrors the
    // same calculation in updateWindowSize() so window-size and CSS-cap agree.
    const availableForDropdown = computeMaxDropdownH(dropdownPlacement, inputBarHeight);
    const compactOverlayMaxHeight = lockedOverlayHeight
      || Math.min(COMPACT_DROPDOWN_MAX_HEIGHT, availableForDropdown);
    const compactSearchDropdownMaxHeight = compactOverlayMaxHeight;
    const compactSearchDropdownScrollHeight = compactOverlayMaxHeight;
    const compactFileNavMaxHeight = compactOverlayMaxHeight;

    // Drag visual: input bar nudges + scales slightly as the corner is pulled.
    // Capped low so it stays subtle; pop on snap is a touch larger.
    const cornerDragMag = Math.hypot(cornerDrag.x, cornerDrag.y);
    const cornerScale = cornerSnapping ? 1.06 : Math.min(1 + cornerDragMag / 900, 1.04);
    const cornerTranslateX = cornerSnapping ? 0 : Math.min(cornerDrag.x / 6, 6);
    const cornerTranslateY = cornerSnapping ? 0 : Math.min(cornerDrag.y / 6, 6);
    const cornerActive = cornerDragMag > 0 || cornerSnapping;
    const showThinkingGlow = isAiWorking;
    return (
      <div className={clsx(
        "w-full h-full flex flex-col relative px-[3px] py-[14px]",
        dropdownPlacement === 'top' ? "justify-end" : "justify-start"
      )}>
        {/* Search Options Dropdown - shows when typing */}
        {showSearchOptions && (
          <CompactSearchDropdown
            placement={dropdownPlacement}
            inputBarHeight={inputBarHeight}
            maxHeight={compactSearchDropdownMaxHeight}
            scrollHeight={compactSearchDropdownScrollHeight}
            suggestionSlot={<IntegrationSuggestionView controller={integrationSuggestion} compact />}
            query={query}
            setQuery={setQuery}
            selectedIndex={selectedIndex}
            setSelectedIndex={setSelectedIndexSynced}
            offsets={dropdownSelection.offsets}
            onAskStuard={() => handleSearchOption('chat')}
            onWebSearch={() => handleSearchOption('web', activeEngine.id)}
            onScreenshotSend={overlayMode === 'compact' ? onScreenshotSend : undefined}
            activeEngineName={activeEngine.name}
            searchEngines={searchEngines.map((e) => ({
              id: e.id,
              name: e.name,
              icon: e.icon,
            }))}
            activeEngineId={activeEngine.id}
            onSelectEngine={handleSetDefaultEngine}
            stuardCommands={stuardCommands}
            appResults={appResults}
            fileLoading={fileLoading}
            fileIconDataUrls={fileIconDataUrls}
            onLaunchApp={(target) => {
              qaLog('click:app_portal', { target });
              void handleLaunchApp(target, 'portal-click');
            }}
            matchingBookmarks={matchingBookmarks}
            onExecuteBookmark={executeBookmark}
            fileResults={fileResults}
            fileSemanticLoading={fileSemanticLoading}
            onAddFileAsContext={handleAddFileAsContext}
            filteredLocalWorkflows={compactWorkflowHits}
            marketplaceResults={marketplaceResults}
            isMarketplaceSearching={isMarketplaceSearching}
          />
        )}

        {showFileNav && (
          <CompactFileNavPortal
            placement={dropdownPlacement}
            inputBarHeight={inputBarHeight}
            maxHeight={compactFileNavMaxHeight}
            fileNavRef={fileNavRef}
            filter={fileNavFilter}
            onSelect={handleFileSelect}
            onClose={() => setShowFileNav(false)}
            onNavigate={handleNavigate}
          />
        )}

        {hasStatusPill && currentStatusItem && (
          <div data-compact-hit-area="true">
            <CompactStatusPill
              item={currentStatusItem}
              statusExpanded={statusExpanded}
              onHoverChange={setStatusHovered}
              onClick={(item) => {
                if (item.onClick) { try { item.onClick(); } catch {} return; }
                setStatusPinned((v) => !v);
              }}
            />
          </div>
        )}
        <div
          data-compact-hit-area="true"
          className={clsx(
            "w-full mx-auto relative overflow-visible",
            cornerActive ? "transition-transform duration-150 ease-out" : "transition-all duration-300",
          )}
          style={{
            maxWidth: 420,
            transform: cornerActive
              ? `translate(${cornerTranslateX}px, ${cornerTranslateY}px) scale(${cornerScale})`
              : undefined,
            transformOrigin: 'bottom right',
          }}
        >
        <CompactHub
          expanded={compactHubOpen && !needsDropdown}
          showPeek={showHubPeek && !needsDropdown}
          backgroundTaskCount={backgroundTaskCount}
          tabs={compactHubTabs}
          activeTabId={activeTabId}
          onPeekClick={() => openCompactHub(true)}
          onClose={closeCompactHub}
          onExpand={() => {
            closeCompactHub();
            onToggleExpand();
          }}
          userPrompt={miniOutputPrompt || ''}
          userAttachments={miniOutputUserAttachments}
          assistantText={miniOutputText || ''}
          isStreaming={!!miniOutputStreaming}
          isAiWorking={isAiWorking}
          reasoningText={currentReasoning || ''}
          toolCalls={currentToolCalls}
          translucentMode={translucentMode}
          inputBarHeight={inputBarHeight}
          placement={dropdownPlacement}
          onQuickResponseHeightChange={handleQuickResponseHeightChange}
        >
        <div
          className="w-full relative z-[5]"
          onKeyDownCapture={(e) => {
            const isEnter = e.key === 'Enter' || e.code === 'NumpadEnter';
            if (!isEnter || !showSearchOptions) return;
            if (e.shiftKey || e.ctrlKey || e.metaKey) return;
            const committed = commitDropdownSelectionRef.current('pill-capture');
            qaLog('keydown:enter', {
              handler: 'pill-capture',
              committed,
              showSearchOptions,
            });
            if (!committed) return;
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <CompactTitleBar
            show={showCompactTitleBar}
            bumpHeight={COMPACT_TITLE_BUMP_HEIGHT}
            overlap={COMPACT_TITLE_BUMP_OVERLAP}
            title={compactTitleText}
            isAiWorking={isAiWorking}
            chatMenuOpen={chatMenuOpen}
            onChatMenuOpenChange={onChatMenuOpenChange}
            conversations={conversations}
            loadingConversations={loadingConversations}
            activeConversationId={activeConversationId}
            onSelectConversation={onSelectConversation}
            onNewChat={onNewChat}
          />
          <CompactInputPill
            showThinkingGlow={showThinkingGlow}
            signedIn={signedIn}
            onSignIn={onSignIn}
            attachments={attachments}
            contextPaths={contextPaths}
            onRemoveAttachment={onRemoveAttachment}
            onRemoveContext={removeContext}
            onAttachFiles={onAttachFiles}
            onAttachImages={onAttachImages}
            onScreenshotSend={onScreenshotSend}
            onDrop={onDrop}
            textareaRef={setTextareaRef}
            query={query}
            setQuery={setQuery}
            onKeyDown={handleKeyDown}
            onPaste={onPaste}
            onHeightChange={handleHeightChange}
            placeholder={
              showFileNav
                ? 'Type to filter...'
                : miniOutputStreaming
                  ? 'Queue after this turn…'
                  : isAiWorking
                    ? ''
                    : 'Just Ask Stuard'
            }
            typingHint={
              showFileNav || miniOutputStreaming || isAiWorking
                ? undefined
                : 'Tab for quick answer'
            }
            miniOutputStreaming={!!miniOutputStreaming}
            isAiWorking={isAiWorking}
            onSteer={onSteer}
            voiceActive={voiceActive}
            onToggleVoice={onToggleVoice}
          />
        </div>
        </CompactHub>

          <CompactDragCorner onPointerDown={handleCornerPointerDown} active={cornerActive} />
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
  }

  // Expanded Mode
  const expandedOverlayPortal = (expanded && showFileNav && fileNavOverlay)
    ? createPortal(
      <div
        style={{
          position: 'fixed',
          left: fileNavOverlay.left,
          top: fileNavOverlay.top,
          width: fileNavOverlay.width,
          transform: fileNavOverlay.placement === 'top' ? 'translateY(-100%)' : undefined,
          zIndex: 100000,
        }}
      >
        <FileNavigator
          onSelect={handleFileSelect}
          onClose={() => setShowFileNav(false)}
          onNavigate={handleNavigate}
          filter={fileNavFilter}
        />
      </div>,
      document.body
    )
    : null;

  return (
    <>
      {expandedOverlayPortal}
      <div className="flex flex-col bg-transparent">
        {/* Attachments & Context Bar (Expanded Mode) */}
        <div className="px-2">
          <AttachmentBar
            attachments={attachments}
            contextPaths={contextPaths}
            onRemoveAttachment={onRemoveAttachment}
            onRemoveContext={removeContext}
          />
          <IntegrationSuggestionView controller={integrationSuggestion} />
        </div>

        {/* Input & Tools Row */}
        <div
          className="px-3 py-2 flex items-center gap-2 relative"
          onDragOver={(e) => { e.preventDefault(); try { e.dataTransfer.dropEffect = 'copy'; } catch { } }}
          onDrop={onDrop}
        >
          <QueuePanel messages={queuedMessages} queueDepth={queueDepth} onCancelMessage={onCancelQueuedMessage} />

          {/* Attachment Menu */}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                id="stuard-attach-btn"
                className="no-drag flex-shrink-0 inline-flex items-center justify-center rounded-lg bg-theme-hover/50 hover:bg-theme-hover transition-all text-theme-fg/70 hover:text-theme-fg h-8 w-8 active:scale-95 border border-theme/10"
                title="Attach items"
              >
                <PlusIcon className="w-4 h-4" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="DropdownContent z-[10001] min-w-[160px] bg-theme-card rounded-lg border border-theme p-1 shadow-xl backdrop-blur-xl" sideOffset={5} align="start" collisionPadding={10}>
                <DropdownMenu.Item
                  onSelect={onAttachFiles}
                  className="group text-[13px] text-theme-fg font-semibold flex items-center gap-2 px-3 py-2 rounded hover:bg-theme-hover outline-none cursor-pointer transition-colors"
                >
                  <FileIcon className="w-3.5 h-3.5 text-primary opacity-70 group-hover:opacity-100" />
                  <span>Attach files</span>
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onSelect={onAttachImages}
                  className="group text-[13px] text-theme-fg font-semibold flex items-center gap-2 px-3 py-2 rounded hover:bg-theme-hover outline-none cursor-pointer transition-colors"
                >
                  <ImageIcon className="w-3.5 h-3.5 text-primary opacity-70 group-hover:opacity-100" />
                  <span>Attach images</span>
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>

          {/* Text Input or Sign In */}
          {!signedIn ? (
            <button
              onClick={onSignIn}
              className="no-drag flex-1 flex items-center justify-center gap-2 py-2.5 bg-primary text-primary-fg font-semibold text-[13px] rounded-lg shadow-md transition-all active:scale-[0.98] hover:opacity-90"
            >
              <LogIn className="w-4 h-4" />
              <span>Sign in to get started</span>
            </button>
          ) : (
            <div id="stuard-input-area" className={clsx(
              "relative flex-1 min-w-0 rounded-3xl transition-all flex items-center"
            )}>
              <TextareaAutosize
                ref={setTextareaRef}
                data-onboarding="input-area"
                value={query}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={onPaste}
                placeholder={showFileNav ? "Type to filter context..." : miniOutputStreaming ? "Queue after this turn…" : "Just ask Stuard"}
                className={clsx(
                  "no-drag w-full outline-none text-[13px] leading-normal placeholder:truncate rounded-3xl px-5 py-2 resize-none scrollbar-hidden transition-colors overflow-hidden font-medium",
                  showFileNav
                    ? "text-primary placeholder:text-theme-muted/50"
                    : "bg-theme-hover/50 text-theme-fg border border-theme/50 placeholder:text-theme-muted focus:bg-theme-hover"
                )}
                style={showFileNav ? { background: 'color-mix(in srgb, var(--primary) 6%, transparent)' } : undefined}
                maxRows={query.length > 0 ? 6 : 1}
                minRows={1}
              />
            </div>
          )}

          {/* Right Actions Group */}
          <div className="flex items-center gap-1 bg-theme-hover/50 border border-theme/10 rounded-lg p-0.5 h-8">
            {/* Folder Permissions */}
            <FolderPermissionsButton />
            <div className="w-px h-4 bg-theme/20 mx-0.5" />

            {/* Dashboard Link */}
            <button
              id="stuard-dashboard-btn"
              className="no-drag inline-flex items-center justify-center rounded-md hover:bg-theme-hover transition-all text-theme-fg/70 hover:text-theme-fg h-7 w-7"
              onClick={onOpenDashboard}
              title="Dashboard"
              data-onboarding="expand-btn"
            >
              <HomeIcon className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
});

InputArea.displayName = "InputArea";

export default memo(InputArea);
