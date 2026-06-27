
import React, { forwardRef, useState, useEffect, useRef, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
import TextareaAutosize from 'react-textarea-autosize';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  FileIcon,
  ImageIcon,
  ClockIcon,
  Cross2Icon,
  ChevronDownIcon,
  ChevronUpIcon,
  HomeIcon,
  PlusIcon
} from "@radix-ui/react-icons";
import { Mic, LogIn, Video, Calendar, Bell, CheckSquare, Layout, Search, Globe, Sparkles, FolderSearch, MessageSquare, Zap, Chrome, Github, PlayCircle, Command, Loader2, File as FileIconLucide, ExternalLink, Copy, Plus as PlusLucide, AppWindow, Folder, Image as ImageIconLucide, Film, Music, Code as CodeIcon, Archive, FileText } from 'lucide-react';
import { clsx } from 'clsx';
import QueuePanel from './QueuePanel';
import { FileNavigator, ContextItem, FileNavRef } from './FileNavigator';
import stuardLogo from '@website-assets/logo.png';
import googleLogo from '../assets/icons/google.png';
import bingLogo from '../assets/icons/bing.png';
import duckduckgoLogo from '../assets/icons/duckduckgo.png';
import youtubeLogo from '../assets/icons/youtube.png';
import githubLogo from '../assets/icons/github.png';

import type { UrgencyLevel } from '../hooks/usePlannerData';

interface InputAreaProps {
  query: string;
  setQuery: (q: string) => void;
  onSend: () => void;
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

  // Optional: compact-mode status row text
  statusText?: string;
  statusIcon?: 'video' | 'calendar' | 'bell' | 'task';
  statusUrgency?: UrgencyLevel;
  connectionStatus?: 'connected' | 'connecting' | 'disconnected' | 'error';

  // Queue
  queueDepth: number;
  queuedMessages: any[];

  // Speech
  isRecording?: boolean;
  onMicClick?: () => void;

  // Context Paths (for @ mentions)
  contextPaths?: ContextItem[];
  setContextPaths?: React.Dispatch<React.SetStateAction<ContextItem[]>>;

  // Translucent mode
  translucentMode?: boolean;

  // Access token for semantic search
  accessToken?: string | null;
}

const InputArea = forwardRef<HTMLTextAreaElement, InputAreaProps>(({
  query, setQuery, onSend,
  attachments, onRemoveAttachment, onAttachFiles, onAttachImages,
  onPaste, onDrop,
  signedIn, onSignIn,
  conversationTitle, conversations, loadingConversations, onSelectConversation, onDeleteConversation, onNewChat, onStopGeneration, onChatMenuOpenChange, chatMenuOpen,
  expanded, onToggleExpand, onOpenDashboard, statusText, statusIcon, statusUrgency,
  connectionStatus,
  queueDepth, queuedMessages,
  isRecording, onMicClick,
  contextPaths, setContextPaths,
  translucentMode = false,
  accessToken
}, ref) => {

  const conn = connectionStatus || 'connected';
  const isConnSpinner = conn === 'connecting';

  // Cloud AI URL for embeddings
  const CLOUD_AI_HTTP = (window as any).__CLOUD_AI_HTTP__ || (import.meta as any).env?.VITE_CLOUD_AI_URL || "http://127.0.0.1:8082";

  // File search state for quick actions
  const [fileResults, setFileResults] = useState<any[]>([]);
  const [fileSearchMode, setFileSearchMode] = useState<'quick' | 'hybrid'>('quick');
  const [fileLoading, setFileLoading] = useState(false);
  const [fileSemanticLoading, setFileSemanticLoading] = useState(false);
  const [fileError, setFileError] = useState('');
  const [indexStats, setIndexStats] = useState<any>(null);

  const searchReqIdRef = useRef(0);
  const semanticReqIdRef = useRef(0);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const semanticDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Ref for File Navigator to control selection
  const fileNavRef = useRef<FileNavRef>(null);

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

  // Quick file search by filename
  const doQuickFileSearch = useCallback(async (q: string) => {
    if (!(window as any).desktopAPI?.execTool) return;
    const reqId = ++searchReqIdRef.current;
    setFileLoading(true);
    setFileError('');
    try {
      const res = await (window as any).desktopAPI.execTool('file_search', {
        query: q,
        mode: 'quick',
        limit: 6,
      });

      if (searchReqIdRef.current !== reqId) return;
      if (res?.ok) {
        setFileResults(Array.isArray(res.results) ? res.results : []);
        setFileSearchMode('quick');
      } else {
        setFileResults([]);
        setFileError(String(res?.error || 'Search failed'));
      }
    } catch (e: any) {
      if (searchReqIdRef.current !== reqId) return;
      setFileResults([]);
      setFileError(String(e?.message || 'Search failed'));
    } finally {
      if (searchReqIdRef.current === reqId) setFileLoading(false);
    }
  }, []);

  // Semantic/hybrid file search
  const doSemanticRefine = useCallback(async (q: string) => {
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
      setFileError('');
      setFileLoading(false);
      setFileSemanticLoading(false);
      return;
    }

    // Quick search (instant-ish)
    searchDebounceRef.current = setTimeout(() => {
      doQuickFileSearch(q);
    }, 150);

    // Semantic refine (slower, only if embeddings exist)
    semanticDebounceRef.current = setTimeout(() => {
      doSemanticRefine(q);
    }, 650);

    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      if (semanticDebounceRef.current) clearTimeout(semanticDebounceRef.current);
    };
  }, [query, expanded, doQuickFileSearch, doSemanticRefine]);

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
    navigator.clipboard.writeText(path).catch(() => {});
  }, []);

  // Keep a local ref so we can position the @ overlay in expanded mode using a portal
  const localTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const setTextareaRef = useCallback((node: HTMLTextAreaElement | null) => {
    localTextareaRef.current = node;
    if (typeof ref === 'function') {
      ref(node);
    } else if (ref && typeof ref === 'object') {
      (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
    }
  }, [ref]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Web Search Shortcut (Ctrl+Enter)
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
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
  }, [onSend, query, setQuery]);

  // File Navigation State for @ mentions
  const [showFileNav, setShowFileNav] = useState(false);
  const [fileNavFilter, setFileNavFilter] = useState("");
  const fileNavDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [fileNavOverlay, setFileNavOverlay] = useState<null | {
    left: number;
    top: number;
    placement: 'top' | 'bottom';
    width: number;
  }>(null);

  const updateFileNavOverlayPos = useCallback(() => {
    if (!expanded || !showFileNav) return;
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

    // Prefer above the input; if not enough room, show below
    let placement: 'top' | 'bottom' = 'top';
    let top = rect.top - 10;
    if (rect.top < 340) { // Increased threshold slightly
      placement = 'bottom';
      top = rect.bottom + 10;
    }

    setFileNavOverlay({ left, top, placement, width });
  }, [expanded, showFileNav]);

  useEffect(() => {
    if (!expanded || !showFileNav) return;
    updateFileNavOverlayPos();

    const handler = () => updateFileNavOverlayPos();
    window.addEventListener('resize', handler);
    // capture=true catches scroll events from nested containers too
    window.addEventListener('scroll', handler, true);
    return () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('scroll', handler, true);
    };
  }, [expanded, showFileNav, updateFileNavOverlayPos]);

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
    if (!expanded || !showFileNav) return;
    updateFileNavOverlayPos();
  }, [expanded, showFileNav, fileNavFilter, updateFileNavOverlayPos]);

  const removeContext = useCallback((index: number) => {
    if (setContextPaths) {
      setContextPaths(prev => prev.filter((_, i) => i !== index));
    }
  }, [setContextPaths]);

  // Show search options dropdown when user has typed something (not @ mentions)
  const showSearchOptions = !expanded && query.trim().length >= 2 && !showFileNav;

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
  const isExpandingRef = useRef(false);

  // Calculate the best placement based on available screen space
  const calculatePlacement = useCallback((): 'top' | 'bottom' => {
    try {
      const screenHeight = window?.screen?.availHeight || 1080;
      const windowTop = window?.screenY || window?.screenTop || 0;
      const windowHeight = window?.outerHeight || 140;
      const flipThreshold = 80; // Further reduced so it flips very low on screen

      // Space available below the window
      const spaceBelow = screenHeight - (windowTop + windowHeight);
      // Space available above the window
      const spaceAbove = windowTop;

      // Flip to top only when very low on screen
      if (spaceBelow < flipThreshold && spaceAbove > spaceBelow) {
        return 'top';
      }
      return 'bottom';
    } catch {
      return 'top';
    }
  }, []);

  // Handle window resizing based on content with smart placement
  const updateWindowSize = useCallback(() => {
    if (expanded) return;

    const height = currentTextareaHeightRef.current;
    const baseTextareaHeight = 36;
    const extraHeight = Math.max(0, height - baseTextareaHeight);

    // Calculate target height
    // baseHeight should match inputBarHeight (140 + inputBarGap)
    const baseHeight = 156; // 140 + 16 gap
    const hasFileResults = fileResults.length > 0;
    const fileResultsHeight = hasFileResults ? Math.min(fileResults.length * 60 + 40, 300) : 0;
    const dropdownHeight = (showWebOptions ? 440 : 380) + fileResultsHeight;
    const needsDropdown = showSearchOptions || showFileNav;
    const targetHeight = needsDropdown ? baseHeight + dropdownHeight : baseHeight;

    const finalHeight = Math.min(Math.max(100, targetHeight + extraHeight), 800);
    const prevHeight = prevWindowHeightRef.current;
    const heightChange = finalHeight - prevHeight;

    if (extraHeight !== extraInputHeightRef.current) {
      extraInputHeightRef.current = extraHeight;
      setExtraInputHeight(extraHeight);
    }

    // Determine placement BEFORE resizing
    const newPlacement = needsDropdown ? calculatePlacement() : 'top';
    setDropdownPlacement(newPlacement);

    // Skip if no change
    if (heightChange === 0) return;

    prevWindowHeightRef.current = finalHeight;
    isExpandingRef.current = heightChange > 0;

    requestAnimationFrame(() => {
      // When placement is 'top' (dropdown above input), expand UPWARD
      // This keeps the input bar visually anchored at the bottom
      if (newPlacement === 'top' && heightChange !== 0) {
        // Move window up by the height change so expansion goes upward
        window.desktopAPI?.moveBy?.(0, -heightChange);
      }
      // Resize after move to ensure smooth animation
      window.desktopAPI?.resize?.(520, finalHeight);
    });
  }, [expanded, showSearchOptions, showFileNav, showWebOptions, fileResults.length, calculatePlacement]);

  // Update on dropdown state changes
  useEffect(() => {
    if (expanded) return;
    updateWindowSize();
  }, [expanded, updateWindowSize, showSearchOptions, showFileNav, showWebOptions]);

  // Recalculate placement when window moves
  useEffect(() => {
    if (expanded) return;

    const handleWindowMove = () => {
      if (showSearchOptions || showFileNav) {
        const newPlacement = calculatePlacement();
        if (newPlacement !== dropdownPlacement) {
          setDropdownPlacement(newPlacement);
        }
      }
    };

    // Check periodically while dropdown is open (window move events aren't reliable in Electron)
    let interval: ReturnType<typeof setInterval> | null = null;
    if (showSearchOptions || showFileNav) {
      interval = setInterval(handleWindowMove, 200);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [expanded, showSearchOptions, showFileNav, calculatePlacement, dropdownPlacement]);

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

  // Input bar height - must match the actual rendered height of the input section
  // Base: container p-2 (8px) + input card min-h (114px) + extra padding (~18px) = ~140px
  // Add gap for visual separation between dropdown and input bar
  const inputBarGap = 16;
  const inputBarHeight = 140 + extraInputHeight + inputBarGap;

  // Compact Mode
  if (!expanded) {
    return (
      <div className={clsx(
        "w-full h-full flex flex-col p-2 relative transition-all duration-300",
        dropdownPlacement === 'top' ? "justify-end pb-3" : "justify-start pt-2"
      )}>
        {/* Search Options Dropdown - shows when typing */}
        {showSearchOptions && typeof document !== 'undefined' && document.body && createPortal(
          <div
            className={clsx(
              "fixed left-1/2 -translate-x-1/2 z-[100000] w-[92%] max-w-[480px] animate-in fade-in duration-200",
              dropdownPlacement === 'top' ? "slide-in-from-bottom-centered mb-3" : "slide-in-from-top-centered mt-2"
            )}
            style={{
              // Position dropdown based on placement with proper spacing
              bottom: dropdownPlacement === 'top' ? `${inputBarHeight}px` : 'auto',
              top: dropdownPlacement === 'bottom' ? `${inputBarHeight - 8}px` : 'auto',
            }}
          >
            <div className="bg-theme-card rounded-[24px] border border-theme/50 overflow-hidden backdrop-blur-3xl shadow-2xl">
              <div className="p-3 border-b border-theme/10 bg-theme-hover/20">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-black uppercase tracking-[0.2em] text-theme-muted px-1">
                    Quick Actions
                  </div>
                  <div className="text-[10px] text-theme-muted font-bold bg-theme-active/50 px-2 py-0.5 rounded-full">
                    {query.length} chars
                  </div>
                </div>
              </div>
              <div className="p-2 space-y-1">
                {/* Ask Stuard - Primary */}
                <button
                  onClick={() => handleSearchOption('chat')}
                  className="w-full flex items-center gap-4 px-4 py-3 rounded-2xl hover:bg-theme-hover transition-all group border border-transparent hover:border-theme/30 relative overflow-hidden"
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

                {/* File Results / Search */}
                {Array.isArray(fileResults) && fileResults.length > 0 ? (
                  <div className="space-y-1 mb-1">
                    <div className="px-3 py-1.5 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FolderSearch className="w-3.5 h-3.5 text-emerald-500" />
                        <span className="text-[11px] font-black uppercase tracking-wider text-theme-muted">Files Found</span>
                        {fileSemanticLoading && <Loader2 className="w-3 h-3 text-primary animate-spin" />}
                      </div>
                      <div className="text-[10px] text-theme-muted font-bold">
                        {fileSearchMode === 'hybrid' ? 'Semantic' : 'Quick'}
                      </div>
                    </div>
                    <div className="max-h-[240px] overflow-y-auto custom-scrollbar px-1 space-y-1">
                      {fileResults.map((f: any, idx: number) => {
                        if (!f) return null;
                        const kind = String(f.kind || 'other').toLowerCase();
                        const getFileKindConfig = (k: string) => {
                          switch (k) {
                            case 'application': return { icon: AppWindow, color: 'text-blue-500', bg: 'bg-blue-500/10', label: 'APP' };
                            case 'folder': return { icon: Folder, color: 'text-yellow-500', bg: 'bg-yellow-500/10', label: 'FOLDER' };
                            case 'image': return { icon: ImageIconLucide, color: 'text-purple-500', bg: 'bg-purple-500/10', label: 'IMG' };
                            case 'video': return { icon: Film, color: 'text-red-500', bg: 'bg-red-500/10', label: 'VID' };
                            case 'audio': return { icon: Music, color: 'text-pink-500', bg: 'bg-pink-500/10', label: 'AUDIO' };
                            case 'code': return { icon: CodeIcon, color: 'text-emerald-500', bg: 'bg-emerald-500/10', label: 'CODE' };
                            case 'archive': return { icon: Archive, color: 'text-orange-500', bg: 'bg-orange-500/10', label: 'ZIP' };
                            case 'document': return { icon: FileText, color: 'text-sky-500', bg: 'bg-sky-500/10', label: 'DOC' };
                            default: return { icon: FileIconLucide, color: 'text-theme-muted', bg: 'bg-theme-muted/10', label: 'FILE' };
                          }
                        };
                        const cfg = getFileKindConfig(kind);
                        const Icon = cfg.icon;

                        return (
                          <button
                            key={String(f.id || f.path || idx)}
                            onClick={() => handleAddFileAsContext(f)}
                            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-theme-hover transition-all group border border-transparent hover:border-theme/30 text-left"
                          >
                            <div className={clsx("w-8 h-8 rounded-lg border border-theme/20 flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-all", cfg.bg, cfg.color)}>
                              <Icon className="w-4 h-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <div className={clsx("text-[13px] font-bold text-theme-fg truncate transition-colors", cfg.color)}>
                                  {String(f.filename || f.name || '').trim() || String(f.path || '').split(/[/\\]/).pop() || 'Untitled'}
                                </div>
                                <div className={clsx("text-[9px] font-black px-1.5 py-0.5 rounded-md uppercase tracking-wider opacity-70", cfg.bg, cfg.color)}>
                                  {cfg.label}
                                </div>
                              </div>
                              <div className="text-[10px] text-theme-muted truncate font-medium">
                                {String(f.path || '')}
                              </div>
                            </div>
                            <PlusLucide className={clsx("w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity", cfg.color)} />
                          </button>
                        );
                      })}
                    </div>
                    <button
                      onClick={() => setQuery('@' + query)}
                      className="w-full py-2 text-[10px] font-bold text-theme-muted hover:text-primary transition-colors text-center border-t border-theme/5 mt-1"
                    >
                      Browse folders instead →
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => handleSearchOption('files')}
                    className="w-full flex items-center gap-4 px-4 py-3 rounded-2xl hover:bg-theme-hover transition-all group border border-transparent hover:border-theme/30"
                  >
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 group-hover:scale-110 transition-all ring-1 ring-primary/20 group-hover:ring-primary/50">
                      <FolderSearch className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1 text-left">
                      <div className="text-[14px] font-black text-theme-fg group-hover:text-primary transition-colors">Search Files</div>
                      <div className="text-[11px] text-theme-muted font-bold">
                        {fileLoading || fileSemanticLoading ? 'Searching...' : 'Find apps, docs, folders & more'}
                      </div>
                    </div>
                    <div className="text-[10px] font-black text-primary-fg bg-theme-hover px-2.5 py-1.5 rounded-lg border border-theme/10 group-hover:bg-primary group-hover:text-primary-fg group-hover:border-primary transition-all">@</div>
                  </button>
                )}

                {/* Web Search - Expandable with multiple engines */}
                <div className="rounded-2xl overflow-hidden bg-theme-hover/10 border border-theme/5">
                  <div className="flex items-stretch">
                    {/* Main Action - Search with Default */}
                    <button
                      onClick={() => handleSearchOption('web', activeEngine.id)}
                      className="flex-1 flex items-center gap-4 px-4 py-3 hover:bg-theme-hover transition-all group relative overflow-hidden text-left"
                    >
                      <div className={clsx("absolute inset-y-0 left-0 w-1", activeEngine.bg)} />
                      <div className={clsx(
                        "w-10 h-10 rounded-xl flex items-center justify-center transition-all bg-theme-bg/50 group-hover:scale-110",
                        activeEngine.color
                      )}>
                        {activeEngine.icon}
                      </div>
                      <div className="flex-1">
                        <div className={clsx("text-[14px] font-black transition-colors group-hover:text-theme-fg", activeEngine.color)}>
                          Search {activeEngine.name}
                        </div>
                        <div className="text-[11px] text-theme-muted font-bold flex items-center gap-1.5">
                          <span>Ctrl + Enter</span>
                          <Command className="w-3 h-3 opacity-50" />
                        </div>
                      </div>
                    </button>

                    {/* Change Engine Trigger */}
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowWebOptions(!showWebOptions); }}
                      className={clsx(
                        "w-12 flex items-center justify-center border-l border-theme/10 hover:bg-theme-hover transition-all",
                        showWebOptions ? "bg-theme-hover/80 text-primary" : "text-theme-muted"
                      )}
                      title="Change Default Search Engine"
                    >
                      <ChevronDownIcon className={clsx("w-4 h-4 transition-transform duration-300", showWebOptions && "rotate-180")} />
                    </button>
                  </div>

                  {/* Search Engine Options */}
                  {showWebOptions && (
                    <div className="p-3 bg-theme-hover/5 border-t border-theme/5 grid grid-cols-5 gap-2 animate-in fade-in slide-in-from-top-1 duration-200">
                      {searchEngines.map((engine) => (
                        <button
                          key={engine.id}
                          onClick={() => handleSetDefaultEngine(engine.id)}
                          className={clsx(
                            "relative flex flex-col items-center gap-2 p-2 rounded-xl transition-all group/engine overflow-hidden",
                            engine.id === defaultEngineId ? "bg-theme-active ring-1 ring-primary/50 border-primary/20" : "hover:bg-theme-hover border-transparent hover:border-theme/10",
                            "hover:scale-105 active:scale-95",
                            "hover:shadow-lg hover:shadow-black/5"
                          )}
                          title={`Search ${engine.name}`}
                        >
                          {/* Background Glow */}
                          <div className={clsx(
                            "absolute inset-0 opacity-0 group-hover/engine:opacity-20 transition-opacity duration-300",
                            engine.bg
                          )} />

                          <div className={clsx(
                            "w-10 h-10 rounded-xl flex items-center justify-center text-xl shadow-sm transition-all duration-300",
                            "bg-theme-card border border-theme/10 group-hover/engine:border-transparent",
                            "group-hover/engine:scale-110 group-hover/engine:shadow-md"
                          )}>
                            {engine.icon}
                          </div>
                          <span className={clsx(
                            "text-[10px] font-black uppercase tracking-wider transition-colors",
                            "text-theme-muted group-hover/engine:text-theme-fg"
                          )}>{engine.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Quick Actions */}
                <button
                  onClick={() => handleSearchOption('quick')}
                  className="w-full flex items-center gap-4 px-4 py-3 rounded-2xl hover:bg-theme-hover transition-all group border border-transparent hover:border-theme/30"
                >
                  <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center group-hover:bg-amber-500/20 group-hover:scale-110 transition-all ring-1 ring-amber-500/20 group-hover:ring-amber-500/50">
                    <Zap className="w-5 h-5 text-amber-500" />
                  </div>
                  <div className="flex-1 text-left">
                    <div className="text-[14px] font-black text-theme-fg group-hover:text-amber-500 transition-colors">More Actions</div>
                    <div className="text-[11px] text-theme-muted font-bold">Full list of commands & shortcuts</div>
                  </div>
                  <div className="text-[10px] font-black text-theme-muted bg-theme-hover px-2.5 py-1.5 rounded-lg border border-theme/10 group-hover:bg-amber-500 group-hover:text-white group-hover:border-amber-500 transition-all">Tab</div>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* File Navigator Overlay - positioned at top level to avoid clipping */}
        {showFileNav && typeof document !== 'undefined' && document.body && createPortal(
          <div
            className={clsx(
              "fixed left-1/2 -translate-x-1/2 z-[100000] w-[92%] max-w-[480px] animate-in fade-in duration-200",
              dropdownPlacement === 'top' ? "slide-in-from-bottom-centered mb-3" : "slide-in-from-top-centered mt-2"
            )}
            style={{
              // Position dropdown based on placement with proper spacing
              bottom: dropdownPlacement === 'top' ? `${inputBarHeight}px` : 'auto',
              top: dropdownPlacement === 'bottom' ? `${inputBarHeight - 8}px` : 'auto',
            }}
          >
            <FileNavigator
              ref={fileNavRef}
              onSelect={handleFileSelect}
              onClose={() => setShowFileNav(false)}
              onNavigate={handleNavigate}
              filter={fileNavFilter}
            />
          </div>,
          document.body
        )}
        <div
          className={clsx(
            "drag w-full min-h-[114px] h-auto py-3 rounded-[28px] flex flex-col justify-center px-4 gap-2 transition-all duration-300",
            translucentMode
              ? "bg-theme-bg/25 backdrop-blur-2xl border border-theme/20"
              : "bg-theme-card border border-theme/50"
          )}
          onDragOver={(e) => { e.preventDefault(); try { e.dataTransfer.dropEffect = 'copy'; } catch { } }}
          onDrop={onDrop}
        >
          {/* Top Row: Status & Actions */}
          <div className="flex items-center justify-between w-full pl-1">
            <button
              type="button"
              onClick={() => {
                // Open dashboard with planner tab when status shows a calendar/reminder/task item
                if (statusIcon === 'calendar' || statusIcon === 'bell' || statusIcon === 'task') {
                  window.desktopAPI?.openDashboard?.({ tab: 'planner' });
                }
              }}
              className={clsx(
                "flex items-center gap-2.5 min-w-0 overflow-hidden mr-2 no-drag",
                (statusIcon === 'calendar' || statusIcon === 'bell' || statusIcon === 'task') && "cursor-pointer hover:opacity-80 transition-opacity"
              )}
              title={statusIcon === 'calendar' || statusIcon === 'bell' || statusIcon === 'task' ? 'View in Planner' : undefined}
            >
              <div className={clsx(
                "w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 transition-all",
                conn === 'connecting' ? 'bg-amber-500 animate-pulse' :
                  (conn === 'disconnected' ? 'bg-theme-muted/50' :
                    (conn === 'error' ? 'bg-red-500' :
                      statusUrgency === 'now' ? 'bg-red-500 animate-pulse' :
                        statusUrgency === 'soon' ? 'bg-amber-500' :
                          statusIcon === 'calendar' ? 'bg-primary' :
                            statusIcon === 'bell' ? 'bg-amber-500' :
                              statusIcon === 'task' ? 'bg-emerald-500' : 'bg-primary'
                    ))
              )}>
                {isConnSpinner ? (
                  <div className="w-3 h-3 border-2 border-white/90 border-t-transparent rounded-full animate-spin" />
                ) : (
                  statusIcon === 'calendar' ? <Calendar className="w-3 h-3 text-white" /> :
                    statusIcon === 'bell' ? <Bell className="w-3 h-3 text-white" /> :
                      statusIcon === 'task' ? <CheckSquare className="w-3 h-3 text-white" /> :
                        <Video className="w-3 h-3 text-white" />
                )}
              </div>
              <div className={clsx(
                "text-[13px] font-medium truncate select-none transition-colors",
                statusUrgency === 'now' ? 'text-red-600' :
                  statusUrgency === 'soon' ? 'text-amber-700 dark:text-amber-500' : 'text-theme-fg'
              )}>
                {statusText || 'Ready'}
              </div>
            </button>

            <div className="flex items-center gap-2 no-drag flex-shrink-0">
              {/* Layout Menu */}
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button
                    type="button"
                    className="w-8 h-8 rounded-[10px] bg-theme-card border border-theme/10 text-theme-fg hover:bg-theme-hover hover:scale-105 active:scale-95 transition-all flex items-center justify-center"
                    title="Layout"
                  >
                    <Layout className="w-3.5 h-3.5" />
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content className="DropdownContent z-[10001] w-48 bg-theme-card rounded-xl border border-theme p-1 shadow-2xl backdrop-blur-xl" sideOffset={10} align="end" collisionPadding={10}>
                    <DropdownMenu.Item
                      onSelect={() => window.desktopAPI.setMode('compact')}
                      className="text-[13px] text-theme-fg flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-theme-hover outline-none cursor-pointer transition-colors"
                    >
                      <div className="w-4 h-4 border-2 border-current rounded opacity-50" />
                      <span>Compact</span>
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      onSelect={() => window.desktopAPI.setMode('expanded')}
                      className="text-[13px] text-theme-fg flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-theme-hover outline-none cursor-pointer transition-colors"
                    >
                      <div className="w-4 h-6 border-2 border-current rounded opacity-50" />
                      <span>Expanded</span>
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

              {/* Dashboard / Home */}
              <button
                type="button"
                className="w-8 h-8 rounded-[10px] bg-theme-card border border-theme/10 text-theme-fg hover:bg-theme-hover hover:scale-105 active:scale-95 transition-all flex items-center justify-center"
                title="Dashboard"
                onClick={onOpenDashboard}
              >
                <HomeIcon className="w-3.5 h-3.5" />
              </button>

              {/* History */}
              <DropdownMenu.Root open={chatMenuOpen} onOpenChange={onChatMenuOpenChange}>
                <DropdownMenu.Trigger asChild>
                  <button
                    type="button"
                    className={clsx(
                      "w-8 h-8 rounded-[10px] border border-theme/10 transition-all flex items-center justify-center hover:scale-105 active:scale-95",
                      chatMenuOpen ? "bg-theme-active text-theme-fg" : "bg-theme-card text-theme-fg hover:bg-theme-hover",
                    )}
                    title="Chat history"
                  >
                    <ClockIcon className="w-3.5 h-3.5" />
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content className="DropdownContent z-[10001] w-72 bg-theme-card rounded-xl border border-theme p-1 shadow-2xl backdrop-blur-xl" sideOffset={10} align="end" collisionPadding={10}>
                    <DropdownMenu.Item
                      onSelect={onNewChat}
                      className="text-[13px] text-primary font-bold flex items-center gap-2 px-3 py-2.5 rounded-lg hover:bg-theme-hover outline-none cursor-pointer transition-colors mb-1"
                    >
                      <PlusIcon className="w-3.5 h-3.5" />
                      <span>New chat</span>
                    </DropdownMenu.Item>

                    <div className="h-px bg-theme border-none my-1 opacity-50" />

                    <div className={clsx(
                      "overflow-y-auto custom-scrollbar",
                      expanded ? "max-h-[calc(100vh-240px)]" : "max-h-[80px]"
                    )}>
                      {loadingConversations ? (
                        <div className="px-3 py-2 text-[12px] text-theme-muted">Loading...</div>
                      ) : conversations.length === 0 ? (
                        <div className="px-3 py-2 text-[12px] text-theme-muted italic">No recent chats</div>
                      ) : (
                        conversations.map(c => (
                          <DropdownMenu.Item
                            key={c.id}
                            onSelect={() => onSelectConversation(String(c.id))}
                            className="text-[13px] text-theme-fg flex flex-col px-3 py-2.5 rounded-lg hover:bg-theme-hover outline-none cursor-pointer transition-colors"
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

          {/* Bottom Row: Input & Mic */}
          <div className="flex items-center gap-2.5 w-full no-drag">
            {!signedIn ? (
              <button
                onClick={onSignIn}
                className="no-drag flex-1 flex items-center justify-center gap-2 h-[42px] rounded-full bg-primary text-primary-fg font-bold text-[14px] hover:opacity-90 transition-all active:scale-[0.99]"
              >
                <LogIn className="w-4 h-4" />
                <span>Sign in</span>
              </button>
            ) : (
              <div className="flex-1 relative h-[42px] bg-theme-card rounded-full border border-theme/50 flex items-center px-1.5 transition-all focus-within:ring-2 focus-within:ring-primary/20">
                {/* Plus / Attach Button */}
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <button
                      type="button"
                      className="w-8 h-8 rounded-full flex items-center justify-center text-theme-muted hover:text-theme-fg hover:bg-theme-hover transition-colors"
                      title="Attach"
                    >
                      <PlusIcon className="w-4 h-4 rounded-full border border-current p-0.5" />
                    </button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content className="DropdownContent z-[10001] min-w-[160px] bg-theme-card rounded-xl border border-theme p-1 shadow-2xl" sideOffset={8} align="start" collisionPadding={10}>
                      <DropdownMenu.Item
                        onSelect={onAttachFiles}
                        className="group text-[13px] text-theme-fg font-bold flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-theme-hover outline-none cursor-pointer transition-colors"
                      >
                        <FileIcon className="w-3.5 h-3.5 text-primary opacity-70" />
                        <span>Attach files</span>
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        onSelect={onAttachImages}
                        className="group text-[13px] text-theme-fg font-bold flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-theme-hover outline-none cursor-pointer transition-colors"
                      >
                        <ImageIcon className="w-3.5 h-3.5 text-primary opacity-70" />
                        <span>Attach images</span>
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>

                {/* Input Field */}
                <div className={clsx(
                  "flex-1 relative mx-1 rounded-lg transition-all flex items-center min-h-[36px]",
                  showFileNav && "ring-2 ring-primary/40 bg-primary/5"
                )}>
                  <TextareaAutosize
                    ref={setTextareaRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onPaste={onPaste}
                    onHeightChange={handleHeightChange}
                    placeholder={showFileNav ? "Type to filter..." : "Just ask Stuard"}
                    className={clsx(
                      "w-full bg-transparent outline-none text-[14px] leading-tight py-2 resize-none scrollbar-hidden font-bold px-1",
                      showFileNav ? "text-primary placeholder:text-primary/40" : "text-theme-fg placeholder:text-theme-muted"
                    )}
                    minRows={1}
                    maxRows={5}
                  />
                </div>
              </div>
            )}

            {/* Mic Button */}
            {onMicClick && (
              <button
                type="button"
                className={clsx(
                  "no-drag h-[42px] w-[42px] rounded-[14px] flex-shrink-0 inline-flex items-center justify-center transition-all active:scale-95",
                  isRecording ? "bg-red-500 text-white animate-pulse" : "bg-primary text-primary-fg hover:opacity-90"
                )}
                onClick={onMicClick}
                title={isRecording ? "Stop recording" : "Start recording"}
              >
                <Mic className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
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
        {/* Attachments & Context Bar */}
        {(attachments.length > 0 || (contextPaths && contextPaths.length > 0)) && (
          <div className="px-3 py-2 flex flex-wrap gap-2 no-drag border-b border-theme/10">
            {/* File/Image Attachments */}
            {attachments.map((att, idx) => (
              <div
                key={`att-${idx}`}
                className="group flex items-center gap-1.5 px-2.5 py-1.5 bg-theme-active/50 hover:bg-theme-active rounded-lg text-[11px] text-theme-fg shadow-sm animate-in fade-in zoom-in duration-200 transition-colors border border-theme/10"
              >
                {att.type === 'image' ? <ImageIcon className="w-3.5 h-3.5 text-primary" /> : <FileIcon className="w-3.5 h-3.5 text-emerald-500" />}
                <span className="max-w-[120px] truncate font-bold">{att.name}</span>
                <button
                  onClick={() => onRemoveAttachment(idx)}
                  className="ml-0.5 text-theme-muted hover:text-theme-fg hover:bg-theme-hover rounded p-0.5 transition-colors opacity-0 group-hover:opacity-100"
                  title="Remove"
                >
                  <Cross2Icon className="w-3 h-3" />
                </button>
              </div>
            ))}

            {/* Context Paths (Files/Folders from @ mention) */}
            {contextPaths && contextPaths.map((c, i) => (
              <div
                key={c.path}
                className="group flex items-center gap-1.5 px-2.5 py-1.5 bg-primary/10 hover:bg-primary/20 border border-primary/30 rounded-lg text-[11px] text-theme-fg shadow-sm animate-in fade-in zoom-in duration-200 transition-colors"
                title={c.path}
              >
                <span className="text-primary">{c.isDirectory ? '📁' : '📄'}</span>
                <span className="max-w-[120px] truncate font-bold">{c.name}</span>
                <button
                  type="button"
                  onClick={() => removeContext(i)}
                  className="ml-0.5 text-theme-muted hover:text-theme-fg hover:bg-theme-hover rounded p-0.5 transition-colors opacity-0 group-hover:opacity-100"
                  title="Remove context"
                >
                  <Cross2Icon className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Input & Tools Row */}
        <div
          className="px-3 py-2 flex items-center gap-2 relative"
          onDragOver={(e) => { e.preventDefault(); try { e.dataTransfer.dropEffect = 'copy'; } catch { } }}
          onDrop={onDrop}
        >
          <QueuePanel messages={queuedMessages} queueDepth={queueDepth} />

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
                  className="group text-[13px] text-theme-fg font-bold flex items-center gap-2 px-3 py-2 rounded hover:bg-theme-hover outline-none cursor-pointer transition-colors"
                >
                  <FileIcon className="w-3.5 h-3.5 text-primary opacity-70 group-hover:opacity-100" />
                  <span>Attach files</span>
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onSelect={onAttachImages}
                  className="group text-[13px] text-theme-fg font-bold flex items-center gap-2 px-3 py-2 rounded hover:bg-theme-hover outline-none cursor-pointer transition-colors"
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
              className="no-drag flex-1 flex items-center justify-center gap-2 py-2.5 bg-primary text-primary-fg font-bold text-[13px] rounded-lg shadow-md transition-all active:scale-[0.98] hover:opacity-90"
            >
              <LogIn className="w-4 h-4" />
              <span>Sign in to get started</span>
            </button>
          ) : (
            <div id="stuard-input-area" className={clsx(
              "relative flex-1 min-w-0 rounded-3xl transition-all flex items-center",
              showFileNav && "ring-2 ring-primary/50 ring-offset-1 ring-offset-transparent"
            )}>
              <TextareaAutosize
                ref={setTextareaRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={onPaste}
                placeholder={showFileNav ? "Type to filter context..." : "Just ask Stuard"}
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
              >
                <Mic className="w-3.5 h-3.5" />
              </button>
            )}
            <div className="w-px h-4 bg-theme/20 mx-0.5" />

            {/* Chat History */}
            <DropdownMenu.Root open={chatMenuOpen} onOpenChange={onChatMenuOpenChange}>
              <DropdownMenu.Trigger asChild>
                <button
                  id="stuard-history-btn"
                  className={clsx(
                    "no-drag inline-flex items-center justify-center rounded-md transition-all text-theme-fg/70 hover:text-theme-fg h-7 px-2 text-[12px] font-bold gap-1 max-w-[120px]",
                    chatMenuOpen ? "bg-theme-active text-theme-fg" : "hover:bg-theme-hover"
                  )}
                  title="Conversation History"
                >
                  <span className="truncate">{conversationTitle || 'Chat'}</span>
                  <ChevronDownIcon className="w-3 h-3 opacity-50" />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className="DropdownContent z-[10001] w-64 bg-theme-card rounded-lg border border-theme p-1 shadow-2xl backdrop-blur-xl" sideOffset={5} align="end" collisionPadding={10}>
                  <DropdownMenu.Item
                    onSelect={onNewChat}
                    className="text-[13px] text-primary font-bold flex items-center gap-2 px-3 py-2 rounded hover:bg-theme-hover outline-none cursor-pointer transition-colors mb-1"
                  >
                    <PlusIcon className="w-3.5 h-3.5" />
                    <span>New chat</span>
                  </DropdownMenu.Item>

                  <div className="h-px bg-theme opacity-50 my-1" />

                  <div className="max-h-[calc(100vh-200px)] overflow-y-auto custom-scrollbar">
                    {loadingConversations ? (
                      <div className="px-3 py-2 text-[12px] text-theme-muted">Loading...</div>
                    ) : conversations.length === 0 ? (
                      <div className="px-3 py-2 text-[12px] text-theme-muted italic">No recent chats</div>
                    ) : (
                      conversations.map(c => (
                        <DropdownMenu.Item
                          key={c.id}
                          onSelect={() => onSelectConversation(String(c.id))}
                          className="text-[13px] text-theme-fg flex flex-col px-3 py-2.5 rounded hover:bg-theme-hover outline-none cursor-pointer transition-colors border-l-2 border-transparent hover:border-primary/50"
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

            <div className="w-px h-4 bg-theme/20 mx-0.5" />

            {/* Dashboard Link */}
            <button
              id="stuard-dashboard-btn"
              className="no-drag inline-flex items-center justify-center rounded-md hover:bg-theme-hover transition-all text-theme-fg/70 hover:text-theme-fg h-7 w-7"
              onClick={onOpenDashboard}
              title="Dashboard"
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
