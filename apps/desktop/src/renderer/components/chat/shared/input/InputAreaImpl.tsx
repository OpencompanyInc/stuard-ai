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
import { Mic, MicOff, X, LogIn, Video, Calendar, Bell, ListTodo, PanelRight, Search, Globe, Sparkles, FolderSearch, MessageSquare, Zap, Chrome, Github, PlayCircle, Play, Command, Loader2, File as FileIconLucide, ExternalLink, Copy, Plus as PlusLucide, AppWindow, Folder, Image as ImageIconLucide, Film, Music, Code as CodeIcon, Archive, FileText, CloudDownload, Download, Paperclip, Box, FolderLock, Shield, Eye, Pencil, Trash2, CheckCircle, FolderOpen, AlertTriangle, CornerDownRight, AudioLines, Layout } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { VoiceMorphPill } from '../../../voice/VoiceMorphPill';
import type { VoiceToolEvent } from '../../../../hooks/useVoiceMode';
import { clsx } from 'clsx';
import QueuePanel from '../../../QueuePanel';
import { FileNavigator, ContextItem, FileNavRef } from '../../../FileNavigator';
import MessageBubble from '../messages/MessageBubble/MessageBubble';
import { QuickShortcutsGrid, BookmarkEditor, useBookmarks, Bookmark, getTypeConfig } from '../../../QuickShortcuts';
import stuardLogo from '@website-assets/logo.png';
import googleLogo from '../../../../assets/icons/google.png';
import bingLogo from '../../../../assets/icons/bing.png';
import duckduckgoLogo from '../../../../assets/icons/duckduckgo.png';
import youtubeLogo from '../../../../assets/icons/youtube.png';
import githubLogo from '../../../../assets/icons/github.png';

import type { UrgencyLevel } from '../../../../hooks/usePlannerData';
import { useStatusCarousel, type StatusItem } from '../../../../hooks/useStatusCarousel';
import { useWorkflows } from '../../../../workflows/hooks/useWorkflows';
import { getMarketplaceApi } from '../../../../utils/cloud';
import { chooseDropdownPlacement } from '../../../../utils/dropdownPlacement';

interface InputAreaProps {
  query: string;
  setQuery: (q: string) => void;
  onSend: () => void;
  onSteer?: () => void;
  attachments: Array<{ type: 'image' | 'file'; name: string }>;
  onRemoveAttachment: (index: number) => void;
  onAttachFiles: () => void;
  onAttachImages: () => void;
  onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;

  signedIn: boolean;
  onSignIn: () => void;

  // History / Conversations
  conversationTitle: string | null;
  conversations: any[];
  loadingConversations: boolean;
  onSelectConversation: (id: string) => void;
  onDeleteConversation?: (id: string) => void;
  onNewChat: () => void;
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
  showMiniOutput?: boolean;
  setShowMiniOutput?: React.Dispatch<React.SetStateAction<boolean>>;
  onSubmitToolOutput?: (id: string, result: any) => void;
  onGenUIResponse?: (component: string, result: any) => void;
}

import { normalizeInputSearchText, shouldRunInputSemanticSearch } from './search';
import { HighlightMatch } from './HighlightMatch';
import { getFileKindConfig } from './fileKind';
import { FIGMA_ROW_BASE, FIGMA_ROW_PRIMARY, FIGMA_ROW_WITH_ICON, FIGMA_KBD } from './styles';
import { AttachmentBar } from './AttachmentBar';
import { FolderPermissionsButton } from './FolderPermissionsButton';


const InputArea = forwardRef(function InputArea(
  {
    query, setQuery, onSend, onSteer,
    attachments, onRemoveAttachment, onAttachFiles, onAttachImages,
    onPaste, onDrop,
    signedIn, onSignIn,
    conversationTitle, conversations, loadingConversations, onSelectConversation, onDeleteConversation, onNewChat, onStopGeneration, onChatMenuOpenChange, chatMenuOpen,
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
    showMiniOutput,
    setShowMiniOutput,
    onSubmitToolOutput,
    onGenUIResponse,
  }: InputAreaProps,
  ref: React.ForwardedRef<HTMLTextAreaElement>
) {

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

  // Ref for File Navigator to control selection
  const fileNavRef = useRef<FileNavRef>(null);
  // Ref to track showFileNav inside handleKeyDown (declared later as state)
  const showFileNavRef = useRef(false);

  // Selection state for the search-options dropdown (arrow keys / hover)
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedIndexRef = useRef(0);
  const selectableItemsRef = useRef<{ key: string; onSelect: () => void }[]>([]);
  const showSearchOptionsRef = useRef(false);
  useEffect(() => { selectedIndexRef.current = selectedIndex; }, [selectedIndex]);

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
        const res = await api.search({ query: q, limit: 3 });
        if (res.ok && res.results) {
          setMarketplaceResults(res.results);
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
      (w.name || '').toLowerCase().includes(q)
    ).slice(0, 3);
  }, [localWorkflows, query]);

  const matchingBookmarks = React.useMemo(() => {
    const q = (query || '').toLowerCase().trim();
    if (!q || q.length < 2) return [] as Bookmark[];
    return bookmarks.filter(b =>
      (b.name || '').toLowerCase().includes(q) ||
      (b.target || '').toLowerCase().includes(q)
    ).slice(0, 4);
  }, [bookmarks, query]);

  // Built-in Stuard commands (Studio, Dashboard) — surfaced at the top of
  // the dropdown so they always outrank app/file matches when the query is
  // even loosely related.
  type StuardCommand = {
    id: 'studio' | 'dashboard';
    title: string;
    subtitle: string;
    icon: React.ComponentType<any>;
    tile: string;
    keywords: string[];
    run: () => void;
  };
  const stuardCommands = React.useMemo<StuardCommand[]>(() => {
    const q = (query || '').toLowerCase().trim();
    if (!q || q.length < 2) return [];
    const all: StuardCommand[] = [
      {
        id: 'studio',
        title: 'Stuard Studio',
        subtitle: 'Open the workflow studio',
        icon: Sparkles,
        tile: '#7C3AED',
        keywords: ['stuard', 'studio', 'workflow', 'workflows', 'automation', 'automate', 'builder', 'skill', 'skills'],
        run: () => {
          try { (window as any).desktopAPI?.openWorkflows?.(); } catch {}
          try { (window as any).desktopAPI?.hide?.(); } catch {}
        },
      },
      {
        id: 'dashboard',
        title: 'Dashboard',
        subtitle: 'Open the Stuard dashboard',
        icon: Layout,
        tile: '#2563EB',
        keywords: ['stuard', 'dashboard', 'dash', 'home', 'overview', 'planner', 'panel'],
        run: () => {
          try { (window as any).desktopAPI?.openDashboard?.(); } catch {}
          try { (window as any).desktopAPI?.hide?.(); } catch {}
        },
      },
    ];
    return all.filter(c =>
      c.title.toLowerCase().includes(q) ||
      c.keywords.some(k => k.includes(q) || q.includes(k))
    );
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
          const isStuardSelf = (r: any) => {
            const name = String(r?.name || r?.display_name || '').toLowerCase();
            return name === 'stuard' || name === 'stuard ai' || name.startsWith('stuard ai');
          };
          const apps = res.results.filter((r: any) => r.source === 'app-discovery' && !isStuardSelf(r));
          const files = res.results.filter((r: any) => (
            r.source !== 'app-discovery' &&
            String(r.kind || '').toLowerCase() !== 'application'
          ));
          setAppResults(apps);
          setFileResults(files);
          setFileSearchMode('quick');
        } else {
          setAppResults([]);
          setFileResults([]);
          setFileError(String(res?.error || 'Search failed'));
        }
      } catch (e: any) {
        if (searchReqIdRef.current !== reqId) return;
        setAppResults([]);
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
        setFileResults(Array.isArray(res.results)
          ? res.results.filter((r: any) => String(r?.kind || '').toLowerCase() !== 'application')
          : []);
        setAppResults([]);
        setFileSearchMode('quick');
      } else {
        setFileResults([]);
        setAppResults([]);
        setFileError(String(res?.error || 'Search failed'));
      }
    } catch (e: any) {
      if (searchReqIdRef.current !== reqId) return;
      setFileResults([]);
      setAppResults([]);
      setFileError(String(e?.message || 'Search failed'));
    } finally {
      if (searchReqIdRef.current === reqId) setFileLoading(false);
    }
  }, []);

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
        body: JSON.stringify({ text: q, model: 'google/gemini-embedding-2-preview' }),
      });
      const j = await resp.json().catch(() => ({}));
      if (semanticReqIdRef.current !== reqId) return;
      if (!resp.ok || !j?.ok || !Array.isArray(j.embedding)) return;

      const res = await (window as any).desktopAPI.execTool('file_search', {
        query: q,
        vector: j.embedding,
        mode: 'hybrid',
        limit: 6,
      });

      if (semanticReqIdRef.current !== reqId) return;
      if (res?.ok) {
        setFileResults(Array.isArray(res.results)
          ? res.results.filter((r: any) => String(r?.kind || '').toLowerCase() !== 'application')
          : []);
        setFileSearchMode('hybrid');
      }
    } catch {
      // ignore
    } finally {
      if (semanticReqIdRef.current === reqId) setFileSemanticLoading(false);
    }
  }, [CLOUD_AI_HTTP, accessToken, indexStats?.indexed_files]);

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
      setFileResults([]);
      setAppResults([]);
      setFileError('');
      setFileLoading(false);
      setFileSemanticLoading(false);
      return;
    }

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
  const handleLaunchApp = useCallback(async (launchTarget: string) => {
    try {
      const api = (window as any).desktopAPI;
      if (api?.launchApp) {
        await api.launchApp(launchTarget);
      } else if (api?.execTool) {
        await api.execTool('open_file', { path: launchTarget });
      }
      (window as any).desktopAPI?.hide?.();
    } catch { }
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

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
          setSelectedIndex(next);
          return;
        }
      }
    }

    // Enter to select current item in file nav
    if (e.key === 'Enter' && !e.shiftKey && showFileNavRef.current && fileNavRef.current) {
      e.preventDefault();
      fileNavRef.current.selectCurrent();
      return;
    }

    // Enter to select highlighted dropdown row when search-options is open
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && showSearchOptionsRef.current) {
      const item = selectableItemsRef.current[selectedIndexRef.current];
      if (item) {
        e.preventDefault();
        item.onSelect();
        return;
      }
    }

    // Escape to close dropdowns
    if (e.key === 'Escape') {
      if (showFileNavRef.current) {
        e.preventDefault();
        setShowFileNav(false);
        setFileNavFilter("");
        return;
      }
    }

    // Web Search Shortcut (Ctrl+Enter)
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
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
      const engineId = savedEngine || 'google';
      const q = query.trim();

      // Define engines map temporarily here or move searchEngines out of render
      // For safety, let's just construct the URL manually or find it if we move the config up.
      // To avoid duplication, let's just trigger the search action directly if we can access the list.
      // We will move searchEngines definition UP or duplicat minimal logic.

      let url = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
      if (engineId === 'bing') url = `https://www.bing.com/search?q=${encodeURIComponent(q)}`;
      if (engineId === 'duckduckgo') url = `https://duckduckgo.com/?q=${encodeURIComponent(q)}`;
      if (engineId === 'youtube') url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
      if (engineId === 'github') url = `https://github.com/search?q=${encodeURIComponent(q)}`;

      if (q) {
        window.desktopAPI?.openExternal?.(url);
        setQuery("");
        window.desktopAPI?.hide?.();
      } else {
        window.desktopAPI?.openExternal?.(url); // Open homepage
      }
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  }, [onSend, onSteer, query, setQuery, miniOutputStreaming]);

  // File Navigation State for @ mentions
  const [showFileNav, setShowFileNav] = useState(false);
  const [fileNavFilter, setFileNavFilter] = useState("");
  const fileNavDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep ref in sync for handleKeyDown
  useEffect(() => { showFileNavRef.current = showFileNav; }, [showFileNav]);

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
  const typingActive = query.trim().length > 0;

  // State for expanded web search options - must be defined before updateWindowSize
  const [showWebOptions, setShowWebOptions] = useState(false);
  const [defaultEngineId, setDefaultEngineId] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('stuard_default_search_engine') || 'google';
    }
    return 'google';
  });

  const handleSetDefaultEngine = useCallback((id: string) => {
    setDefaultEngineId(id);
    localStorage.setItem('stuard_default_search_engine', id);
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
  const prevWindowHeightRef = useRef(140);
  const prevWindowWidthRef = useRef(366);
  const isExpandingRef = useRef(false);

  const calculatePlacement = useCallback((): 'top' | 'bottom' => {
    try {
      const screenHeight = window?.screen?.availHeight || 1080;
      const windowTop = window?.screenY || window?.screenTop || 0;
      const windowHeight = window?.outerHeight || 140;
      const flipToTopThreshold = dropdownPlacement === 'bottom' ? 80 : 60;
      const flipToBottomThreshold = 160;
      const spaceBelow = screenHeight - (windowTop + windowHeight);
      const spaceAbove = windowTop;

      if (dropdownPlacement === 'bottom') {
        if (spaceBelow < flipToTopThreshold && spaceAbove > spaceBelow) {
          return 'top';
        }
        return 'bottom';
      }

      if (spaceBelow > flipToBottomThreshold) {
        return 'bottom';
      }
      return 'top';
    } catch {
      return 'top';
    }
  }, [dropdownPlacement]);

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
      return [{
        id: `legacy-${statusIcon}`,
        text: statusText,
        icon: statusIcon,
        urgency: statusUrgency,
        priority: 100,
      }];
    }
    return [];
  }, [statusItems, statusText, statusIcon, statusUrgency]);

  const { current: currentStatusItem, count: statusItemCount } = useStatusCarousel(
    effectiveStatusItems,
    { intervalMs: 10_000, paused: statusExpanded },
  );

  // Handle window resizing based on content with smart placement
  const updateWindowSize = useCallback(() => {
    if (expanded) return;

    const needsDropdown = showSearchOptions || showFileNav;
    const miniEnabled = !!(showMiniOutput && (miniOutputHasContent ?? !!(miniOutputText || '').trim()));
    const miniHeight = miniEnabled && !needsDropdown && !typingActive ? 300 : 0;

    const height = currentTextareaHeightRef.current;
    const baseTextareaHeight = 36;
    const extraHeight = Math.max(0, height - baseTextareaHeight);

    // Calculate target height
    // Compact native window is 366x62; the visible pill hugs 360x56 inside a 3px safe edge.
    const hasAttachments = attachments.length > 0 || (contextPaths && contextPaths.length > 0);
    const attachmentHeight = hasAttachments ? 44 : 0;
    const showStatusPill = overlayMode === 'compact' && statusItemCount > 0;
    const statusPillHeight = showStatusPill ? 40 : 0;
    const baseHeight = (overlayMode === 'compact' ? 62 : 156) + miniHeight + attachmentHeight + statusPillHeight;
    const searchDropdownHeight = 480;
    const fileNavDropdownHeight = 400;
    const dropdownHeight = showFileNav
      ? fileNavDropdownHeight
      : showSearchOptions
        ? searchDropdownHeight
        : 0;

    const targetHeight = needsDropdown ? baseHeight + dropdownHeight : baseHeight;

    const minWindowHeight = overlayMode === 'compact' ? 62 : 100;
    const finalHeight = Math.min(Math.max(minWindowHeight, targetHeight + extraHeight), 650);
    const prevHeight = prevWindowHeightRef.current;
    const heightChange = finalHeight - prevHeight;

    if (extraHeight !== extraInputHeightRef.current) {
      extraInputHeightRef.current = extraHeight;
      setExtraInputHeight(extraHeight);
    }

    // Determine placement BEFORE resizing
    const needsOverlay = needsDropdown || miniEnabled;
    const newPlacement = needsOverlay ? calculatePlacement() : dropdownPlacement;
    setDropdownPlacement(newPlacement);

    // Skip if no height change (width is now fixed in compact mode, so width never changes)
    if (heightChange === 0) return;

    prevWindowHeightRef.current = finalHeight;
    isExpandingRef.current = heightChange > 0;

    requestAnimationFrame(() => {
      const currentOuterWidth = Math.round((window as any)?.outerWidth || 520);
      const targetWidth = overlayMode === 'compact' ? 520 : currentOuterWidth;
      const widthChange = targetWidth - prevWindowWidthRef.current;
      prevWindowWidthRef.current = targetWidth;

      // When placement is 'top' (dropdown above input), expand separate UPWARD
      // This keeps the input bar visually anchored at the bottom.
      // Also shift X by half the width delta so the centered pill doesn't visually slide.
      if (newPlacement === 'top' && heightChange !== 0) {
        const currentScreenX = window.screenX;
        const currentScreenY = window.screenY;
        const newY = currentScreenY - heightChange;
        const newX = currentScreenX - Math.round(widthChange / 2);

        window.desktopAPI?.setBounds?.({
          x: newX,
          y: newY,
          width: targetWidth,
          height: finalHeight,
        });
      } else if (widthChange !== 0) {
        // Bottom placement: anchor top, but still recenter horizontally on width change.
        const currentScreenX = window.screenX;
        const currentScreenY = window.screenY;
        const newX = currentScreenX - Math.round(widthChange / 2);
        window.desktopAPI?.setBounds?.({
          x: newX,
          y: currentScreenY,
          width: targetWidth,
          height: finalHeight,
        });
      } else {
        window.desktopAPI?.resize?.(targetWidth, finalHeight);
      }
    });
  }, [expanded, showSearchOptions, showFileNav, showWebOptions, calculatePlacement, showMiniOutput, miniOutputHasContent, typingActive, overlayMode, attachments.length, contextPaths?.length, statusItemCount]);

  // Update on dropdown state changes
  useEffect(() => {
    if (expanded) return;
    updateWindowSize();
  }, [expanded, updateWindowSize, showSearchOptions, showFileNav, showWebOptions, showMiniOutput, miniOutputHasContent, overlayMode, attachments.length, contextPaths?.length, statusItemCount]);

  // Recalculate placement when window moves
  useEffect(() => {
    if (expanded) return;

    const handleWindowMove = () => {
      if (showSearchOptions || showFileNav || (showMiniOutput && miniOutputHasContent)) {
        const newPlacement = calculatePlacement();
        if (newPlacement !== dropdownPlacement) {
          setDropdownPlacement(newPlacement);
        }
      }
    };

    // Check periodically while dropdown is open (window move events aren't reliable in Electron)
    let interval: ReturnType<typeof setInterval> | null = null;
    if (showSearchOptions || showFileNav || (showMiniOutput && miniOutputHasContent)) {
      interval = setInterval(handleWindowMove, 200);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [expanded, showSearchOptions, showFileNav, calculatePlacement, dropdownPlacement, showMiniOutput, miniOutputHasContent, attachments.length, contextPaths?.length]);

  // Handle height change for auto-expansion in compact mode
  const handleHeightChange = useCallback((height: number) => {
    currentTextareaHeightRef.current = height;
    updateWindowSize();
  }, [updateWindowSize]);

  // Search engines configuration
  const searchEngines = [
    { id: 'google', name: 'Google', icon: <img src={googleLogo} className="w-5 h-5 object-contain" alt="Google" />, color: 'text-blue-500', bg: 'bg-blue-500', ring: 'ring-blue-500/20', url: (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q)}` },
    { id: 'bing', name: 'Bing', icon: <img src={bingLogo} className="w-5 h-5 object-contain" alt="Bing" />, color: 'text-cyan-500', bg: 'bg-cyan-500', ring: 'ring-cyan-500/20', url: (q: string) => `https://www.bing.com/search?q=${encodeURIComponent(q)}` },
    { id: 'duckduckgo', name: 'DuckDuckGo', icon: <img src={duckduckgoLogo} className="w-5 h-5 object-contain" alt="DuckDuckGo" />, color: 'text-orange-500', bg: 'bg-orange-500', ring: 'ring-orange-500/20', url: (q: string) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}` },
    { id: 'youtube', name: 'YouTube', icon: <img src={youtubeLogo} className="w-5 h-5 object-contain" alt="YouTube" />, color: 'text-red-500', bg: 'bg-red-500', ring: 'ring-red-500/20', url: (q: string) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}` },
    { id: 'github', name: 'GitHub', icon: <img src={githubLogo} className="w-5 h-5 object-contain" alt="GitHub" />, color: 'text-purple-500', bg: 'bg-purple-500', ring: 'ring-purple-500/20', url: (q: string) => `https://github.com/search?q=${encodeURIComponent(q)}` },
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
      if (q) {
        window.desktopAPI?.openExternal?.(engine.url(q));
        setQuery("");
        window.desktopAPI?.hide?.();
      } else {
        window.desktopAPI?.openExternal?.(engine.url(''));
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
        onSelect: () => { handleLaunchApp(a.launchTarget || a.path); setQuery(''); },
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
    filteredLocalWorkflows.forEach((w) => {
      items.push({
        key: `wf-${w.id}`,
        onSelect: async () => {
          try {
            await window.desktopAPI?.workflowsRun?.(w.id);
            window.desktopAPI?.hide?.();
            (window as any).desktopAPI?.notify?.('Workflow Started', `Running ${w.name}...`);
          } catch (e) { console.error(e); }
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
    filteredLocalWorkflows,
    marketplaceResults,
    activeEngine.id,
    handleSearchOption,
    handleLaunchApp,
    handleAddFileAsContext,
    executeBookmark,
    setQuery,
  ]);

  // Keep refs in sync so handleKeyDown (memoized) sees fresh values.
  useEffect(() => { selectableItemsRef.current = dropdownSelection.items; }, [dropdownSelection.items]);
  useEffect(() => { showSearchOptionsRef.current = showSearchOptions; }, [showSearchOptions]);

  // Reset selection to first item whenever the item list changes or the dropdown reopens.
  useEffect(() => {
    setSelectedIndex(0);
  }, [dropdownSelection.items.length, showSearchOptions]);

  // Input bar height - must match the actual rendered height of the input section
  // Base: container p-2 (8px) + input card min-h (114px) + extra padding (~18px) = ~140px
  // Add gap for visual separation between dropdown and input bar
  const inputBarGap = 8;
  const hasAttachments = attachments.length > 0 || (contextPaths && contextPaths.length > 0);
  const attachmentOffset = hasAttachments ? 44 : 0;
  void statusMinutesUntil; // reserved for future tighter gating

  const hasStatusPill = overlayMode === 'compact' && !!currentStatusItem;
  const statusPillOffset = hasStatusPill ? 40 : 0;
  const baseInputBarHeight = overlayMode === 'compact' ? 62 : 140;
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
  }, [onToggleExpand]);

  // Compact Mode
  if (!expanded) {
    const needsDropdown = showSearchOptions || showFileNav;
    const miniEnabled = !!(showMiniOutput && (miniOutputHasContent ?? !!(miniOutputText || '').trim()));
    const isTyping = query.trim().length > 0;
    const miniOpen = miniEnabled && !needsDropdown && !isTyping;
    const compactSearchDropdownMaxHeight = 480;
    const compactSearchDropdownScrollHeight = compactSearchDropdownMaxHeight;
    const compactFileNavMaxHeight = 400;

    // Drag visual: input bar nudges + scales slightly as the corner is pulled.
    // Capped low so it stays subtle; pop on snap is a touch larger.
    const cornerDragMag = Math.hypot(cornerDrag.x, cornerDrag.y);
    const cornerScale = cornerSnapping ? 1.06 : Math.min(1 + cornerDragMag / 900, 1.04);
    const cornerTranslateX = cornerSnapping ? 0 : Math.min(cornerDrag.x / 6, 6);
    const cornerTranslateY = cornerSnapping ? 0 : Math.min(cornerDrag.y / 6, 6);
    const cornerActive = cornerDragMag > 0 || cornerSnapping;
    return (
      <div className={clsx(
        "w-full h-full flex flex-col relative p-[3px]",
        dropdownPlacement === 'top' ? "justify-end" : "justify-start"
      )}>
        {/* Search Options Dropdown - shows when typing */}
        {showSearchOptions && typeof document !== 'undefined' && document.body && createPortal(
          <div
            className={clsx(
              "fixed left-1/2 -translate-x-1/2 z-[100000] w-[96%] max-w-[560px] animate-in fade-in duration-200",
              dropdownPlacement === 'top' ? "slide-in-from-bottom-centered mb-3" : "slide-in-from-top-centered mt-2"
            )}
            style={{
              bottom: dropdownPlacement === 'top' ? `${inputBarHeight}px` : 'auto',
              top: dropdownPlacement === 'bottom' ? `${inputBarHeight - 8}px` : 'auto',
            }}
          >
            <div
              className="overflow-hidden flex flex-col"
              style={{
                maxHeight: compactSearchDropdownMaxHeight,
                background: '#171717',
                borderRadius: 12,
                boxShadow: '0 2px 6px rgba(0, 0, 0, 0.18)',
              }}
            >
              <div
                className="flex flex-col overflow-y-auto custom-scrollbar"
                style={{ padding: 16, gap: 12, maxHeight: compactSearchDropdownScrollHeight }}
              >
                {/* QUICK ACTIONS */}
                <div className="flex flex-col" style={{ gap: 8 }}>
                  <div style={{ fontSize: 10, lineHeight: '14px', color: '#FFFFFF', fontWeight: 400 }}>
                    Quick Actions
                  </div>

                  {/* Ask Stuard */}
                  {(() => {
                    const rowIdx = dropdownSelection.offsets.askStuard;
                    const isSel = selectedIndex === rowIdx;
                    return (
                      <button
                        onMouseEnter={() => setSelectedIndex(rowIdx)}
                        onClick={() => handleSearchOption('chat')}
                        className="w-full flex items-center"
                        style={{ ...(isSel ? FIGMA_ROW_PRIMARY : FIGMA_ROW_BASE), gap: 10 }}
                      >
                        <div className="flex-1 min-w-0 flex flex-col items-start text-left" style={{ gap: 6 }}>
                          <div className="truncate w-full" style={{ fontSize: 12, lineHeight: '16px', color: '#FFFFFF' }}>
                            &ldquo;{query.trim()}&rdquo;
                          </div>
                          <div className="truncate w-full" style={{ fontSize: 10, lineHeight: '14px', color: '#A3A3A3' }}>
                            Ask Stuard
                          </div>
                        </div>
                        <span className="shrink-0" style={{ ...FIGMA_KBD, fontSize: 10, lineHeight: '14px' }}>
                          Enter
                        </span>
                      </button>
                    );
                  })()}

                  {/* Search Engine */}
                  {(() => {
                    const rowIdx = dropdownSelection.offsets.webSearch;
                    const isSel = selectedIndex === rowIdx;
                    return (
                      <button
                        onMouseEnter={() => setSelectedIndex(rowIdx)}
                        onClick={() => handleSearchOption('web', activeEngine.id)}
                        className="w-full flex items-center"
                        style={{ ...(isSel ? FIGMA_ROW_PRIMARY : FIGMA_ROW_BASE), gap: 10 }}
                      >
                        <div className="flex-1 min-w-0 flex flex-col items-start text-left" style={{ gap: 6 }}>
                          <div className="truncate w-full" style={{ fontSize: 12, lineHeight: '16px', color: '#FFFFFF' }}>
                            &ldquo;{query.trim()}&rdquo;
                          </div>
                          <div className="truncate w-full" style={{ fontSize: 10, lineHeight: '14px', color: '#A3A3A3' }}>
                            Search {activeEngine.name}
                          </div>
                        </div>
                        <span className="shrink-0" style={{ ...FIGMA_KBD, fontSize: 10, lineHeight: '14px' }}>
                          Ctrl + Enter
                        </span>
                      </button>
                    );
                  })()}
                </div>

                {/* STUARD — built-in commands (Studio, Dashboard) ranked at the top */}
                {stuardCommands.length > 0 && (
                  <div className="flex flex-col" style={{ gap: 8 }}>
                    <div style={{ fontSize: 10, lineHeight: '14px', color: '#FFFFFF', fontWeight: 400 }}>
                      Stuard
                    </div>

                    {stuardCommands.map((c, idx) => {
                      const Icon = c.icon;
                      const rowIdx = dropdownSelection.offsets.stuardCommandsStart + idx;
                      const isSel = selectedIndex === rowIdx;
                      return (
                        <button
                          key={`cmd-${c.id}`}
                          onMouseEnter={() => setSelectedIndex(rowIdx)}
                          onClick={() => { c.run(); setQuery(''); }}
                          className="w-full flex items-center text-left"
                          style={{ ...(isSel ? FIGMA_ROW_PRIMARY : FIGMA_ROW_BASE), padding: '6px 8px 6px 6px', gap: 6 }}
                        >
                          <div
                            className="flex items-center justify-center shrink-0"
                            style={{ width: 36, height: 36, borderRadius: 4, background: c.tile }}
                          >
                            <Icon className="w-4 h-4" strokeWidth={1.75} />
                          </div>
                          <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 6 }}>
                            <div className="truncate" style={{ fontSize: 12, lineHeight: '16px', color: '#FFFFFF' }}>
                              <HighlightMatch text={c.title} query={query} />
                            </div>
                            <div className="truncate" style={{ fontSize: 10, lineHeight: '14px', color: '#A3A3A3' }}>
                              {c.subtitle}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* APPLICATIONS */}
                {appResults.length > 0 && (
                  <div className="flex flex-col" style={{ gap: 8 }}>
                    <div style={{ fontSize: 10, lineHeight: '14px', color: '#FFFFFF', fontWeight: 400 }}>
                      Applications
                      {fileLoading && <Loader2 className="inline-block ml-2 w-3 h-3 align-middle text-theme-muted animate-spin" />}
                    </div>

                    {appResults.map((a: any, idx: number) => {
                      const iconUrl = a?.iconDataUrl || (a?.path ? fileIconDataUrls[String(a.path)] : undefined);
                      const name = String(a.name || '');
                      const rowIdx = dropdownSelection.offsets.appsStart + idx;
                      const isSel = selectedIndex === rowIdx;
                      return (
                        <button
                          key={`app-${a.path || idx}`}
                          onMouseEnter={() => setSelectedIndex(rowIdx)}
                          onClick={() => { handleLaunchApp(a.launchTarget || a.path); setQuery(''); }}
                          className="w-full flex items-center text-left"
                          style={{ ...(isSel ? FIGMA_ROW_PRIMARY : FIGMA_ROW_BASE), padding: '6px 8px 6px 6px', gap: 6 }}
                        >
                          <div
                            className="flex items-center justify-center shrink-0 overflow-hidden"
                            style={{ width: 36, height: 36, borderRadius: 4, background: iconUrl ? 'rgba(64, 64, 64, 0.5)' : '#3B82F6' }}
                          >
                            {iconUrl ? (
                              <img src={iconUrl} alt="" className="w-7 h-7 object-contain" />
                            ) : (
                              <AppWindow className="w-4 h-4 text-white" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 6 }}>
                            <div className="truncate" style={{ fontSize: 12, lineHeight: '16px', color: '#FFFFFF' }}>
                              <HighlightMatch text={name} query={query} />
                            </div>
                            <div className="truncate" style={{ fontSize: 10, lineHeight: '14px', color: '#A3A3A3' }}>
                              open {name}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* SHORTCUTS — user bookmarks */}
                {matchingBookmarks.length > 0 && (
                  <div className="flex flex-col" style={{ gap: 8 }}>
                    <div style={{ fontSize: 10, lineHeight: '14px', color: '#FFFFFF', fontWeight: 400 }}>
                      Shortcuts
                    </div>

                    {matchingBookmarks.map((bm, idx) => {
                      const cfg = getTypeConfig(bm.type);
                      const Icon = cfg.icon;
                      const rowIdx = dropdownSelection.offsets.bookmarksStart + idx;
                      const isSel = selectedIndex === rowIdx;
                      return (
                        <button
                          key={`bm-${bm.id}`}
                          onMouseEnter={() => setSelectedIndex(rowIdx)}
                          onClick={() => executeBookmark(bm)}
                          className="w-full flex items-center text-left"
                          style={{ ...(isSel ? FIGMA_ROW_PRIMARY : FIGMA_ROW_BASE), padding: '6px 8px 6px 6px', gap: 6 }}
                        >
                          <div
                            className="flex items-center justify-center shrink-0"
                            style={{ width: 36, height: 36, borderRadius: 4, background: 'rgba(64, 64, 64, 0.5)' }}
                          >
                            <Icon className={clsx('w-4 h-4', cfg.color)} />
                          </div>
                          <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 6 }}>
                            <div className="truncate" style={{ fontSize: 12, lineHeight: '16px', color: '#FFFFFF' }}>
                              <HighlightMatch text={bm.name} query={query} />
                            </div>
                            <div className="truncate" style={{ fontSize: 10, lineHeight: '14px', color: '#A3A3A3' }}>
                              open {bm.name}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* FILES */}
                {Array.isArray(fileResults) && fileResults.length > 0 && (
                  <div className="flex flex-col" style={{ gap: 8 }}>
                    <div style={{ fontSize: 10, lineHeight: '14px', color: '#FFFFFF', fontWeight: 400 }}>
                      Files
                      {fileSemanticLoading && <Loader2 className="inline-block ml-2 w-3 h-3 align-middle text-theme-muted animate-spin" />}
                    </div>

                    {fileResults.slice(0, 6).map((f: any, idx: number) => {
                      if (!f) return null;
                      const kind = String(f.kind || 'other').toLowerCase();
                      const cfg = getFileKindConfig(kind);
                      const iconUrl = f?.path ? fileIconDataUrls[String(f.path)] : undefined;
                      const isThumbnail = String(f.preview_kind || 'icon') === 'thumbnail';
                      const fileName = String(f.display_name || f.filename || f.name || '').trim() ||
                        String(f.path || '').split(/[/\\]/).pop() || 'Untitled';
                      const fullPath = String(f.path || f.target_path || '');
                      const showThumbnail = iconUrl && isThumbnail;
                      const rowIdx = dropdownSelection.offsets.filesStart + idx;
                      const isSel = selectedIndex === rowIdx;
                      return (
                        <button
                          key={String(f.id || f.path || idx)}
                          onMouseEnter={() => setSelectedIndex(rowIdx)}
                          onClick={() => {
                            if (kind === 'application') {
                              (window as any).desktopAPI?.openPath?.(String(f.path));
                              (window as any).desktopAPI?.hide?.();
                              setQuery('');
                            } else {
                              handleAddFileAsContext(f);
                            }
                          }}
                          className="w-full flex items-center text-left"
                          style={{ ...(isSel ? FIGMA_ROW_PRIMARY : FIGMA_ROW_BASE), padding: '6px 8px 6px 6px', gap: 6 }}
                        >
                          <div
                            className="flex items-center justify-center shrink-0 overflow-hidden"
                            style={{
                              width: 36,
                              height: 36,
                              borderRadius: 4,
                              background: showThumbnail ? 'rgba(64, 64, 64, 0.5)' : cfg.tile,
                            }}
                          >
                            {showThumbnail ? (
                              <img src={iconUrl} alt="" className="w-full h-full object-cover" />
                            ) : iconUrl ? (
                              <img src={iconUrl} alt="" className="w-7 h-7 object-contain" />
                            ) : kind === 'folder' ? (
                              <Folder className="w-5 h-5 text-white" />
                            ) : (
                              <span style={{ fontSize: 10, lineHeight: '14px', color: '#FFFFFF', fontWeight: 600 }}>
                                {cfg.label}
                              </span>
                            )}
                          </div>
                          <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 6 }}>
                            <div className="truncate" style={{ fontSize: 12, lineHeight: '16px', color: '#FFFFFF' }}>
                              <HighlightMatch text={fileName} query={query} />
                            </div>
                            <div className="truncate" style={{ fontSize: 8, lineHeight: '14px', color: '#A3A3A3' }}>
                              {fullPath}
                            </div>
                          </div>
                          <span
                            className="shrink-0 flex items-center justify-center"
                            style={{ padding: '3px 6px', color: '#A3A3A3' }}
                            title={kind === 'application' ? 'Open' : 'Attach'}
                          >
                            {kind === 'application' ? (
                              <ExternalLink className="w-4 h-4" strokeWidth={1.75} />
                            ) : (
                              <Paperclip className="w-4 h-4" strokeWidth={1.75} />
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* WORKFLOWS — header always present (shows "No workflows" when empty) */}
                <div className="flex flex-col" style={{ gap: 8 }}>
                  <div style={{ fontSize: 10, lineHeight: '14px', color: '#FFFFFF', fontWeight: 400 }}>
                    {(filteredLocalWorkflows.length === 0 && marketplaceResults.length === 0)
                      ? 'No workflows'
                      : 'Workflows'}
                    {isMarketplaceSearching && <Loader2 className="inline-block ml-2 w-3 h-3 align-middle text-theme-muted animate-spin" />}
                  </div>

                  {filteredLocalWorkflows.map((w, idx) => {
                    const rowIdx = dropdownSelection.offsets.workflowsStart + idx;
                    const isSel = selectedIndex === rowIdx;
                    return (
                    <button
                      key={w.id}
                      onMouseEnter={() => setSelectedIndex(rowIdx)}
                      onClick={async () => {
                        try {
                          await window.desktopAPI?.workflowsRun?.(w.id);
                          window.desktopAPI?.hide?.();
                          (window as any).desktopAPI?.notify?.('Workflow Started', `Running ${w.name}...`);
                        } catch (e) { console.error(e); }
                      }}
                      className="w-full flex items-center text-left"
                      style={{ ...(isSel ? FIGMA_ROW_PRIMARY : FIGMA_ROW_BASE), padding: '6px 8px 6px 6px', gap: 6 }}
                    >
                      <div
                        className="flex items-center justify-center shrink-0"
                        style={{ width: 36, height: 36, borderRadius: 4, background: '#F59E0B' }}
                      >
                        <Zap className="w-4 h-4 text-white" />
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 6 }}>
                        <div className="truncate" style={{ fontSize: 12, lineHeight: '16px', color: '#FFFFFF' }}>
                          <HighlightMatch text={w.name || 'Untitled'} query={query} />
                        </div>
                        <div className="truncate" style={{ fontSize: 10, lineHeight: '14px', color: '#A3A3A3' }}>
                          Run local workflow
                        </div>
                      </div>
                      <span
                        className="shrink-0 flex items-center justify-center"
                        style={{ padding: '3px 6px', color: '#A3A3A3' }}
                        title="Run"
                      >
                        <Play className="w-4 h-4" strokeWidth={1.75} />
                      </span>
                    </button>
                    );
                  })}

                  {marketplaceResults.map((w, idx) => {
                    const rowIdx = dropdownSelection.offsets.marketplaceStart + idx;
                    const isSel = selectedIndex === rowIdx;
                    return (
                    <button
                      key={w.slug}
                      onMouseEnter={() => setSelectedIndex(rowIdx)}
                      onClick={() => {
                        window.desktopAPI?.openWorkflows?.({ marketplaceSlug: w.slug });
                        window.desktopAPI?.hide?.();
                      }}
                      className="w-full flex items-center text-left"
                      style={{ ...(isSel ? FIGMA_ROW_PRIMARY : FIGMA_ROW_BASE), padding: '6px 8px 6px 6px', gap: 6 }}
                    >
                      <div
                        className="flex items-center justify-center shrink-0"
                        style={{ width: 36, height: 36, borderRadius: 4, background: '#6366F1' }}
                      >
                        <CloudDownload className="w-4 h-4 text-white" />
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 6 }}>
                        <div className="truncate" style={{ fontSize: 12, lineHeight: '16px', color: '#FFFFFF' }}>
                          <HighlightMatch text={w.name} query={query} />
                        </div>
                        <div className="truncate" style={{ fontSize: 10, lineHeight: '14px', color: '#A3A3A3' }}>
                          Marketplace • {w.publisher_name || 'Community'}
                        </div>
                      </div>
                      <span
                        className="shrink-0 flex items-center justify-center"
                        style={{ padding: '3px 6px', color: '#A3A3A3' }}
                        title="Install"
                      >
                        <Download className="w-4 h-4" strokeWidth={1.75} />
                      </span>
                    </button>
                    );
                  })}
                </div>

              </div>
            </div>
          </div>,
          document.body
        )}

        {showFileNav && typeof document !== 'undefined' && document.body && createPortal(
          <div
            className={clsx(
              "fixed left-1/2 -translate-x-1/2 z-[100000] w-[92%] max-w-[520px] animate-in fade-in duration-200",
              dropdownPlacement === 'top' ? "slide-in-from-bottom-centered mb-3" : "slide-in-from-top-centered mt-2"
            )}
            style={{
              bottom: dropdownPlacement === 'top' ? `${inputBarHeight}px` : 'auto',
              top: dropdownPlacement === 'bottom' ? `${inputBarHeight - 8}px` : 'auto',
            }}
          >
            <div style={{ maxHeight: compactFileNavMaxHeight }} className="overflow-hidden">
              <FileNavigator
                ref={fileNavRef}
                onSelect={handleFileSelect}
                onClose={() => setShowFileNav(false)}
                onNavigate={handleNavigate}
                filter={fileNavFilter}
              />
            </div>
          </div>,
          document.body
        )}

        {/* Quick Answer Dropdown - behaves like suggestion dropdown (top/bottom placement) */}
        {miniOpen && typeof document !== 'undefined' && document.body && createPortal(
          <div
            className={clsx(
              "fixed left-1/2 -translate-x-1/2 z-[99999] w-[92%] max-w-[520px]",
              "animate-in fade-in duration-200",
              dropdownPlacement === 'top' ? "slide-in-from-bottom-centered mb-3" : "slide-in-from-top-centered mt-2"
            )}
            style={{
              bottom: dropdownPlacement === 'top' ? `${inputBarHeight}px` : 'auto',
              top: dropdownPlacement === 'bottom' ? `${inputBarHeight - 8}px` : 'auto',
            }}
          >
            <div className={clsx(
              translucentMode
                ? "rounded-[24px] bg-theme-bg backdrop-blur-2xl border border-theme/20"
                : "rounded-[24px] bg-theme-bg border border-theme/20",
              "shadow-lg shadow-black/10 overflow-hidden"
            )}>
              <div className="flex items-center justify-between px-4 py-3 border-b border-theme/10 bg-theme-bg">
                <div className="text-[11px] font-bold uppercase tracking-widest text-theme-muted">
                  Quick answer
                </div>
                <button
                  type="button"
                  className="w-7 h-7 rounded-[10px] bg-theme-bg border border-theme/10 text-theme-muted hover:text-theme-fg hover:bg-theme-hover transition-all flex items-center justify-center"
                  title="Hide"
                  onClick={() => setShowMiniOutput?.(false)}
                >
                  <Cross2Icon className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="max-h-[220px] overflow-y-auto overflow-x-hidden custom-scrollbar">
                <MessageBubble
                  role="assistant"
                  text={miniOutputText || ''}
                  isStreaming={!!miniOutputStreaming}
                  reasoning={undefined}
                  toolCalls={undefined}
                  streamChunks={undefined}
                  onSubmitToolOutput={onSubmitToolOutput}
                  onGenUIResponse={onGenUIResponse}
                  compact={true}
                />
              </div>
            </div>
          </div>,
          document.body
        )}
        {(() => {
          if (!hasStatusPill || !currentStatusItem) return null;
          const item = currentStatusItem;
          const iconKey = item.icon;
          const IconCmp = iconKey === 'video' ? Video
            : iconKey === 'calendar' ? Calendar
            : iconKey === 'bell' ? Bell
            : iconKey === 'task' ? ListTodo
            : iconKey === 'weather' ? Sparkles
            : iconKey === 'slack' ? MessageSquare
            : iconKey === 'ai' ? Loader2
            : iconKey === 'mic' ? Mic
            : iconKey === 'queue' ? Loader2
            : null;
          // Icon color: explicit override > urgency > type-based default.
          const iconColor = item.iconColor
            ?? (item.urgency === 'now'
              ? '#FF383C'
              : item.urgency === 'soon'
                ? '#F59E0B'
                : iconKey === 'bell'
                  ? '#F59E0B'         // reminders → yellow/amber
                  : iconKey === 'calendar'
                    ? '#3B82F6'       // meetings → blue
                    : iconKey === 'task'
                      ? '#10B981'     // tasks → emerald
                      : iconKey === 'weather'
                        ? '#60A5FA'   // weather → sky
                        : iconKey === 'slack'
                          ? '#A855F7' // slack → violet
                          : iconKey === 'ai'
                            ? '#A78BFA' // AI working → soft violet
                            : iconKey === 'mic'
                              ? '#FF383C' // recording → red
                              : iconKey === 'queue'
                                ? '#60A5FA' // queued → sky
                                : '#FFFFFF');
          const urgencyGlow = item.urgency === 'now'
            ? '0 0 12px rgba(255, 56, 60, 0.35)'
            : item.urgency === 'soon'
              ? '0 0 12px rgba(245, 158, 11, 0.3)'
              : undefined;
          const flipTransition = { duration: 0.32, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] };
          return (
            <div className="w-full mx-auto flex" style={{ maxWidth: 360, marginBottom: 8 }}>
              <motion.button
                type="button"
                layout
                transition={{ type: 'spring', stiffness: 320, damping: 30, mass: 0.7 }}
                className={clsx(
                  "no-drag flex items-center min-w-0 cursor-pointer outline-none",
                  item.urgency === 'now' && "animate-pulse",
                )}
                style={{
                  backgroundColor: '#171717',
                  borderRadius: 12,
                  padding: 8,
                  gap: 8,
                  height: 32,
                  maxWidth: '100%',
                  boxShadow: urgencyGlow,
                }}
                onMouseEnter={() => setStatusHovered(true)}
                onMouseLeave={() => setStatusHovered(false)}
                onFocus={() => setStatusHovered(true)}
                onBlur={() => setStatusHovered(false)}
                onClick={() => {
                  if (item.onClick) { try { item.onClick(); } catch {} return; }
                  setStatusPinned((v) => !v);
                }}
                title={item.ariaLabel || item.text}
                aria-expanded={statusExpanded}
                aria-label={item.ariaLabel || item.text}
              >
                {/* Icon flip: each item's icon enters from below and the
                    outgoing one rises upward, like a digital flap clock. */}
                <div
                  className="relative flex items-center justify-center flex-shrink-0 overflow-hidden"
                  style={{ width: 16, height: 16 }}
                >
                  <AnimatePresence initial={false} mode="popLayout">
                    <motion.span
                      key={`icon-${item.id}`}
                      className="absolute inset-0 flex items-center justify-center"
                      initial={{ y: '100%', opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      exit={{ y: '-100%', opacity: 0 }}
                      transition={flipTransition}
                    >
                      {iconKey === 'custom' && item.iconNode
                        ? item.iconNode
                        : IconCmp
                          ? <IconCmp className={clsx('w-4 h-4', (iconKey === 'queue' || iconKey === 'ai') && 'animate-spin')} strokeWidth={1.75} style={{ color: iconColor }} />
                          : null}
                    </motion.span>
                  </AnimatePresence>
                </div>
                <AnimatePresence initial={false}>
                  {statusExpanded && (
                    <motion.div
                      key="status-text-wrap"
                      className="overflow-hidden whitespace-nowrap relative"
                      initial={{ opacity: 0, width: 0, marginLeft: -8 }}
                      animate={{ opacity: 1, width: 'auto', marginLeft: 0 }}
                      exit={{ opacity: 0, width: 0, marginLeft: -8 }}
                      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                      style={{ height: 16 }}
                    >
                      <AnimatePresence initial={false} mode="popLayout">
                        <motion.span
                          key={`text-${item.id}`}
                          className="text-white block whitespace-nowrap"
                          initial={{ y: '100%', opacity: 0 }}
                          animate={{ y: 0, opacity: 1 }}
                          exit={{ y: '-100%', opacity: 0 }}
                          transition={flipTransition}
                          style={{
                            fontSize: 12,
                            lineHeight: '16px',
                            fontFamily: "'General Sans', 'Inter', 'Figtree', sans-serif",
                            fontWeight: 400,
                          }}
                        >
                          {item.text}
                        </motion.span>
                      </AnimatePresence>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.button>
            </div>
          );
        })()}
        <div
          className={clsx(
            "w-full mx-auto relative",
            cornerActive ? "transition-transform duration-150 ease-out" : "transition-all duration-300",
          )}
          style={{
            maxWidth: 360,
            transform: cornerActive
              ? `translate(${cornerTranslateX}px, ${cornerTranslateY}px) scale(${cornerScale})`
              : undefined,
            transformOrigin: 'bottom right',
          }}
        >
        <div
          className="drag w-full min-h-[56px] h-auto rounded-[18px] flex flex-col justify-center relative overflow-hidden isolate"
          style={{
            zIndex: 1,
            padding: 10,
            gap: 8,
            backgroundColor: "#171717",
          }}
          onDragOver={(e) => { e.preventDefault(); try { e.dataTransfer.dropEffect = 'copy'; } catch { } }}
          onDrop={onDrop}
        >
          {/* Pill content sits above the translucent surface. */}
          <div className="relative w-full flex flex-col gap-2" style={{ zIndex: 2 }}>
          {/* Attachments only render when there's something to show */}
          {(attachments.length > 0 || (contextPaths?.length ?? 0) > 0) && (
            <AttachmentBar
              attachments={attachments}
              contextPaths={contextPaths}
              onRemoveAttachment={onRemoveAttachment}
              onRemoveContext={removeContext}
            />
          )}

          {/* Single row: +, input, voice */}
          <div className="flex items-center w-full no-drag" style={{ gap: 10, height: 36 }}>
            {!signedIn ? (
              <button
                onClick={onSignIn}
                className="no-drag flex-1 flex items-center justify-center gap-2 h-9 rounded-xl bg-primary text-primary-fg font-semibold text-[12px] hover:opacity-90 transition-all active:scale-95"
              >
                <LogIn className="w-4 h-4" />
                <span>Sign in</span>
              </button>
            ) : (
              <>
                {/* + (attach) */}
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <button
                      type="button"
                      className="w-6 h-6 flex items-center justify-center text-white/90 hover:text-white transition-colors flex-shrink-0"
                      title="Attach"
                    >
                      <PlusLucide className="w-6 h-6" strokeWidth={1.5} />
                    </button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content className="DropdownContent z-[10001] min-w-[160px] bg-[rgb(23,23,23)]/85 backdrop-blur-xl rounded-xl border border-white/10 p-1 shadow-2xl" sideOffset={8} align="start" collisionPadding={10}>
                      <DropdownMenu.Item
                        onSelect={onAttachFiles}
                        className="group text-[13px] text-white/90 flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/10 outline-none cursor-pointer transition-colors"
                      >
                        <FileIcon className="w-3.5 h-3.5 opacity-70" />
                        <span>Attach files</span>
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        onSelect={onAttachImages}
                        className="group text-[13px] text-white/90 flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/10 outline-none cursor-pointer transition-colors"
                      >
                        <ImageIcon className="w-3.5 h-3.5 opacity-70" />
                        <span>Attach images</span>
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>

                {/* Input */}
                <div
                  className="flex-1 relative flex items-center justify-center min-h-[36px] rounded-[12px]"
                  style={{ padding: 6, gap: 4 }}
                >
                  <TextareaAutosize
                    ref={setTextareaRef}
                    value={query}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setQuery(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onPaste={onPaste}
                    onHeightChange={handleHeightChange}
                    placeholder={showFileNav ? "Type to filter..." : miniOutputStreaming ? "Ask next or steer current step" : "Ask anything"}
                    className={clsx(
                      "w-full bg-transparent outline-none text-[12px] leading-4 p-0 resize-none scrollbar-hidden font-normal text-white placeholder:text-white",
                      query.length > 0 ? "text-left" : "text-center"
                    )}
                    style={{ fontFamily: "'General Sans', 'Inter', 'Figtree', sans-serif" }}
                    minRows={1}
                    maxRows={5}
                  />
                </div>

                {miniOutputStreaming && onSteer && query.trim() && (
                  <button
                    type="button"
                    className="w-8 h-8 rounded-[10px] flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10 transition-all active:scale-95 flex-shrink-0"
                    title="Steer current step"
                    onClick={onSteer}
                  >
                    <CornerDownRight className="w-4 h-4" />
                  </button>
                )}

                {/* Voice */}
                <button
                  type="button"
                  className={clsx(
                    "w-8 h-8 rounded-[10px] flex items-center justify-center transition-all active:scale-95 flex-shrink-0",
                    voiceActive ? "bg-white/15 text-white" : "text-white/85 hover:text-white hover:bg-white/10"
                  )}
                  title={voiceActive ? "Stop voice" : "Start voice"}
                  onClick={onToggleVoice}
                >
                  <AudioLines className="w-4 h-4" strokeWidth={1.5} />
                </button>
              </>
            )}
          </div>
          </div>

        </div>

          {/* Drag-to-expand corner handle — a thick red arc hugging the
              OUTSIDE of the bar's bottom-right corner, reading as a resize
              grip clipped to the bar's exterior. Lives as a sibling of the
              bar (not inside it) so the bar's overflow:hidden no longer
              shaves off the stroke. The arc is drawn with radius
              barCornerRadius + strokeWidth/2 around the bar's corner-curve
              center, so the inner edge of the stroke meets the bar's outer
              edge curve exactly and the stroke extends outward from there. */}
          <button
            type="button"
            className="no-drag absolute"
            style={{
              right: -8,
              bottom: -8,
              width: 52,
              height: 52,
              padding: 0,
              border: 'none',
              background: 'transparent',
              cursor: 'nwse-resize',
              zIndex: 4,
              transform: cornerActive ? 'scale(1.12)' : 'scale(1)',
              transformOrigin: 'bottom right',
              transition: 'transform 160ms ease-out, filter 160ms ease-out',
              filter: cornerActive ? 'brightness(1.15)' : 'none',
            }}
            onPointerDown={handleCornerPointerDown}
            title="Drag to expand"
            aria-label="Drag to expand to window mode"
          >
            <svg width="52" height="52" viewBox="0 0 52 52" style={{ display: 'block', overflow: 'visible' }}>
              {/* Button is 52×52 at right:-8 / bottom:-8, so SVG (44, 44)
                  lands on the bar's exterior bottom-right corner and the
                  bar's corner-curve center (18px in from each edge) lands
                  at SVG (26, 26). Path radius 22 around that center → the
                  8px stroke spans radius 18 (= bar's outer edge curve) to
                  26 (= 8px outside the bar). Outer stroke pixels reach
                  SVG (52, 26) and (26, 52) — exactly at the SVG bounds,
                  with `overflow: visible` covering any sub-pixel spill. */}
              <path
                d="M 47 26 A 21 21 0 0 1 26 47"
                stroke="#FF383C"
                strokeWidth="6"
                strokeLinecap="butt"
                fill="none"
              />
            </svg>
          </button>
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
                placeholder={showFileNav ? "Type to filter context..." : miniOutputStreaming ? "Ask next or steer current step" : "Just ask Stuard"}
                className={clsx(
                  "no-drag w-full outline-none text-[13px] leading-normal placeholder:truncate rounded-3xl px-5 py-2 resize-none scrollbar-hidden transition-colors overflow-hidden font-medium",
                  showFileNav
                    ? "bg-primary/5 text-primary placeholder:text-primary/40"
                    : "bg-theme-hover/50 text-theme-fg border border-theme/50 placeholder:text-theme-muted focus:bg-theme-hover"
                )}
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
            {/* Mic Button */}
            {onMicClick && (
              <button
                id="stuard-mic-btn"
                className={clsx(
                  "no-drag inline-flex items-center justify-center rounded-md transition-all h-7 w-7",
                  isRecording ? "text-red-500 animate-pulse bg-red-500/10" : "text-theme-fg/70 hover:text-theme-fg hover:bg-theme-hover"
                )}
                onClick={onMicClick}
                title={isRecording ? "Stop recording" : "Start recording"}
                data-onboarding="mic-btn"
              >
                <Mic className="w-3.5 h-3.5" />
              </button>
            )}
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
