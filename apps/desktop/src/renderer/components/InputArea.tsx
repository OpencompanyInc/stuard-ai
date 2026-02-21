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
import { Mic, LogIn, Video, Calendar, Bell, ListTodo, PanelRight, Search, Globe, Sparkles, FolderSearch, MessageSquare, Zap, Chrome, Github, PlayCircle, Command, Loader2, File as FileIconLucide, ExternalLink, Copy, Plus as PlusLucide, AppWindow, Folder, Image as ImageIconLucide, Film, Music, Code as CodeIcon, Archive, FileText, CloudDownload, Box, FolderLock, Shield, Eye, Pencil, Trash2, CheckCircle, FolderOpen, AlertTriangle } from 'lucide-react';
import { clsx } from 'clsx';
import QueuePanel from './QueuePanel';
import { FileNavigator, ContextItem, FileNavRef } from './FileNavigator';
import MessageBubble from './MessageBubble';
import { QuickShortcutsGrid, BookmarkEditor, useBookmarks, Bookmark } from './QuickShortcuts';
import stuardLogo from '@website-assets/logo.png';
import googleLogo from '../assets/icons/google.png';
import bingLogo from '../assets/icons/bing.png';
import duckduckgoLogo from '../assets/icons/duckduckgo.png';
import youtubeLogo from '../assets/icons/youtube.png';
import githubLogo from '../assets/icons/github.png';

import type { UrgencyLevel } from '../hooks/usePlannerData';
import { useWorkflows } from '../workflows/hooks/useWorkflows';
import { getMarketplaceApi } from '../utils/cloud';

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

  overlayMode?: 'compact' | 'sidebar' | 'window';

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

  miniOutputText?: string;
  miniOutputHasContent?: boolean;
  miniOutputStreaming?: boolean;
  showMiniOutput?: boolean;
  setShowMiniOutput?: React.Dispatch<React.SetStateAction<boolean>>;
  onSubmitToolOutput?: (id: string, result: any) => void;
  onGenUIResponse?: (component: string, result: any) => void;
}

// Helper component for attachments & context
const AttachmentBar = memo(({
  attachments,
  contextPaths,
  onRemoveAttachment,
  onRemoveContext
}: {
  attachments: Array<{ type: 'image' | 'file'; name: string }>;
  contextPaths?: ContextItem[];
  onRemoveAttachment: (index: number) => void;
  onRemoveContext: (index: number) => void;
}) => {
  if (attachments.length === 0 && (!contextPaths || contextPaths.length === 0)) return null;

  return (
    <div className="w-full flex flex-wrap gap-2 px-1 py-1 animate-in fade-in slide-in-from-bottom-1 duration-200 no-drag relative z-20">
      {/* Attachments */}
      {attachments.map((att, idx) => (
        <div
          key={`att-${idx}`}
          className="group relative flex items-center gap-2 pl-2 pr-7 py-1.5 rounded-xl bg-gray-200/50 border border-gray-300/30 hover:bg-gray-200/80 hover:border-gray-300/50 transition-all cursor-default select-none shadow-sm backdrop-blur-md"
        >
          {att.type === 'image' ? (
            <div className="w-5 h-5 rounded-md bg-purple-500/10 flex items-center justify-center text-purple-500">
              <ImageIconLucide className="w-3 h-3" />
            </div>
          ) : (
            <div className="w-5 h-5 rounded-md bg-blue-500/10 flex items-center justify-center text-blue-500">
              <FileIconLucide className="w-3 h-3" />
            </div>
          )}
          <span className="text-[11px] font-semibold text-theme-fg max-w-[120px] truncate">
            {att.name}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); onRemoveAttachment(idx); }}
            className="absolute right-1 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-lg text-theme-muted hover:text-red-500 hover:bg-red-500/10 transition-colors opacity-50 group-hover:opacity-100"
            title="Remove attachment"
          >
            <Cross2Icon className="w-3 h-3" />
          </button>
        </div>
      ))}

      {/* Context Paths */}
      {contextPaths?.map((c, i) => (
        <div
          key={c.path}
          className="group relative flex items-center gap-2 pl-2 pr-7 py-1.5 rounded-xl bg-primary/5 border border-primary/10 hover:bg-primary/10 hover:border-primary/20 transition-all cursor-default select-none shadow-sm backdrop-blur-md"
        >
          <div className="w-5 h-5 rounded-md bg-primary/10 flex items-center justify-center text-primary">
            {c.isDirectory ? (
              <Folder className="w-3 h-3" />
            ) : (
              <FileText className="w-3 h-3" />
            )}
          </div>
          <div className="flex flex-col leading-none justify-center">
            <span className="text-[11px] font-semibold text-theme-fg max-w-[120px] truncate">
              {c.name}
            </span>
            <span className="text-[9px] text-primary/70 font-medium truncate max-w-[100px] mt-0.5">
              Context
            </span>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onRemoveContext(i); }}
            className="absolute right-1 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-lg text-theme-muted hover:text-red-500 hover:bg-red-500/10 transition-colors opacity-50 group-hover:opacity-100"
            title="Remove context"
          >
            <Cross2Icon className="w-3 h-3" />
          </button>
        </div>
      ))}
    </div>
  );
});

// ── Folder Permissions Button (compact popover near input bar) ─────────
const AGENT_HTTP_FP = (window as any).__AGENT_HTTP__ || "http://127.0.0.1:8765";
const FOLDER_PERMISSIONS_BASE_FP = `${AGENT_HTTP_FP}/v1/folder-permissions`;

interface FolderRule { id: string; path: string; permission: "read" | "write" | "both"; }

const FolderPermissionsButton: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [rules, setRules] = useState<FolderRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [selectedPerm, setSelectedPerm] = useState<"read" | "write" | "both">("both");
  const popoverRef = useRef<HTMLDivElement>(null);
  const api = (window as any).desktopAPI;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(FOLDER_PERMISSIONS_BASE_FP);
      const data = await res.json();
      if (data.ok) { setRules(data.rules || []); }
    } catch { } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (open) load(); }, [open, load]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleAdd = async () => {
    setAdding(true);
    try {
      const result = await api?.pickFolder?.({ title: "Select folder to allow" });
      if (result?.ok && result?.folders?.length > 0) {
        const folderPath = typeof result.folders[0] === 'string' ? result.folders[0] : result.folders[0]?.path;
        if (!folderPath) return;
        await fetch(`${FOLDER_PERMISSIONS_BASE_FP}/add`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: folderPath, permission: selectedPerm }),
        });
        await load();
      }
    } catch { } finally { setAdding(false); }
  };

  const handleRemove = async (id: string) => {
    try {
      await fetch(`${FOLDER_PERMISSIONS_BASE_FP}/remove`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      await load();
    } catch { }
  };

  const handlePermChange = async (rule: FolderRule, perm: string) => {
    try {
      await fetch(`${FOLDER_PERMISSIONS_BASE_FP}/add`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: rule.path, permission: perm }),
      });
      await load();
    } catch { }
  };

  const hasActiveRules = rules.length > 0;

  return (
    <div className="relative" ref={popoverRef}>
      <button
        className={clsx(
          "no-drag inline-flex items-center justify-center rounded-md transition-all h-7 w-7",
          hasActiveRules
            ? "text-emerald-500 bg-emerald-500/10 hover:bg-emerald-500/20"
            : "text-theme-fg/70 hover:text-theme-fg hover:bg-theme-hover"
        )}
        onClick={() => setOpen(!open)}
        title={hasActiveRules ? `Folder limiter: ${rules.length} folder(s) allowed` : "Folder permissions"}
      >
        {hasActiveRules ? <Shield className="w-3.5 h-3.5" /> : <FolderLock className="w-3.5 h-3.5" />}
      </button>

      {open && (
        <div
          className="absolute bottom-full right-0 mb-2 w-80 max-h-[400px] bg-theme-card rounded-xl border border-theme shadow-2xl backdrop-blur-xl z-[10001] overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-150"
          style={{ WebkitAppRegion: 'no-drag' } as any}
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-theme flex items-center gap-2">
            <FolderLock className="w-4 h-4 text-primary" />
            <span className="text-[13px] font-bold text-theme-fg">Folder Permissions</span>
          </div>

          <div className="p-3">
              {/* Add folder row */}
              <div className="flex items-center gap-2 mb-3">
                <div className="flex items-center gap-0.5 bg-theme-hover rounded-md border border-theme/50 p-0.5 flex-1">
                  {(["both", "read", "write"] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => setSelectedPerm(p)}
                      className={clsx(
                        "flex-1 text-[10px] font-bold py-1 px-1.5 rounded transition-all text-center",
                        selectedPerm === p
                          ? "bg-primary text-primary-fg shadow-sm"
                          : "text-theme-muted hover:text-theme-fg"
                      )}
                    >
                      {p === "both" ? "Full" : p === "read" ? "Read" : "Write"}
                    </button>
                  ))}
                </div>
                <button
                  onClick={handleAdd}
                  disabled={adding}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-fg text-[11px] font-bold hover:opacity-90 transition-all active:scale-95 disabled:opacity-50 flex-shrink-0"
                >
                  {adding ? <Loader2 className="w-3 h-3 animate-spin" /> : <PlusLucide className="w-3 h-3" />}
                  Add
                </button>
              </div>

              {/* Rules list */}
              {loading ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="w-5 h-5 animate-spin text-theme-muted" />
                </div>
              ) : rules.length === 0 ? (
                <div className="text-center py-6">
                  <FolderLock className="w-8 h-8 text-theme-muted/20 mx-auto mb-2" />
                  <div className="text-[11px] text-theme-muted font-medium">No folder rules yet</div>
                  <div className="text-[10px] text-theme-muted/60 mt-0.5">All folders accessible. Add folders to restrict.</div>
                </div>
              ) : (
                <div className="space-y-1.5 max-h-[220px] overflow-y-auto scrollbar-hidden">
                  {rules.map((rule) => (
                    <div
                      key={rule.id}
                      className="flex items-center gap-2 p-2 bg-theme-hover/50 rounded-lg border border-theme/30 group hover:bg-theme-hover transition-colors"
                    >
                      <FolderOpen className={clsx("w-3.5 h-3.5 flex-shrink-0",
                        rule.permission === "both" ? "text-emerald-500" :
                        rule.permission === "read" ? "text-blue-500" : "text-amber-500"
                      )} />
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-bold text-theme-fg truncate" title={rule.path}>
                          {rule.path.split(/[/\\]/).pop() || rule.path}
                        </div>
                        <div className="text-[9px] text-theme-muted truncate" title={rule.path}>
                          {rule.path}
                        </div>
                      </div>
                      <select
                        value={rule.permission}
                        onChange={(e) => handlePermChange(rule, e.target.value)}
                        className="text-[10px] font-bold bg-theme-card border border-theme/50 rounded px-1 py-0.5 text-theme-fg focus:outline-none cursor-pointer flex-shrink-0"
                      >
                        <option value="both">Full</option>
                        <option value="read">Read</option>
                        <option value="write">Write</option>
                      </select>
                      <button
                        onClick={() => handleRemove(rule.id)}
                        className="p-1 rounded text-theme-muted hover:text-red-500 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Info */}
              {rules.length > 0 && (
                <div className="mt-2 flex items-start gap-1.5 text-[10px] text-theme-muted/70">
                  <AlertTriangle className="w-3 h-3 text-amber-500/70 mt-px flex-shrink-0" />
                  <span>Only listed folders (and subfolders) are accessible to the agent.</span>
                </div>
              )}
          </div>
        </div>
      )}
    </div>
  );
};

const InputArea = forwardRef(function InputArea(
  {
    query, setQuery, onSend,
    attachments, onRemoveAttachment, onAttachFiles, onAttachImages,
    onPaste, onDrop,
    signedIn, onSignIn,
    conversationTitle, conversations, loadingConversations, onSelectConversation, onDeleteConversation, onNewChat, onStopGeneration, onChatMenuOpenChange, chatMenuOpen,
    expanded, onToggleExpand, onOpenDashboard, overlayMode, statusText, statusIcon, statusUrgency,
    connectionStatus,
    queueDepth, queuedMessages,
    isRecording, onMicClick,
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

    // Prefer above the input; if not enough room, show below
    let placement: 'top' | 'bottom' = 'top';
    let top = rect.top - 10;
    if (rect.top < 340) { // Increased threshold slightly
      placement = 'bottom';
      top = rect.bottom + 10;
    }

    setFileNavOverlay({ left, top, placement, width });
  }, [showFileNav]);

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
  const isExpandingRef = useRef(false);

  // Calculate the best placement based on available screen space
  const calculatePlacement = useCallback((): 'top' | 'bottom' => {
    try {
      const screenHeight = window?.screen?.availHeight || 1080;
      const windowTop = window?.screenY || window?.screenTop || 0;
      const windowHeight = window?.outerHeight || 140;
      const flipToTopThreshold = dropdownPlacement === 'bottom' ? 80 : 60;
      const flipToBottomThreshold = 160;

      // Space available below the window
      const spaceBelow = screenHeight - (windowTop + windowHeight);
      // Space available above the window
      const spaceAbove = windowTop;

      if (dropdownPlacement === 'bottom') {
        // Flip to top only when very low on screen
        if (spaceBelow < flipToTopThreshold && spaceAbove > spaceBelow) {
          return 'top';
        }
        return 'bottom';
      }
      // dropdownPlacement === 'top'
      if (spaceBelow > flipToBottomThreshold) {
        return 'bottom';
      }
      return 'top';
    } catch {
      return 'top';
    }
  }, [dropdownPlacement]);

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
    // baseHeight should match inputBarHeight (140 + inputBarGap)
    const hasAttachments = attachments.length > 0 || (contextPaths && contextPaths.length > 0);
    const attachmentHeight = hasAttachments ? 44 : 0;
    const baseHeight = 156 + miniHeight + attachmentHeight; // 140 + 16 gap + mini output + attachments
    const hasFileResults = fileResults.length > 0;
    const fileResultsHeight = hasFileResults ? Math.min(fileResults.length * 60 + 40, 300) : 0;

    // Calculate workflows height
    const hasWorkflows = filteredLocalWorkflows.length > 0 || marketplaceResults.length > 0;
    const workflowsHeight = hasWorkflows ? ((filteredLocalWorkflows.length + marketplaceResults.length) * 60 + 40) : 0;

    // Cap height to max 450px for scrolling
    const totalContentHeight = (showWebOptions ? 440 : 380) + fileResultsHeight + workflowsHeight;
    const dropdownHeight = Math.min(totalContentHeight, 450);

    const targetHeight = needsDropdown ? baseHeight + dropdownHeight : baseHeight;

    const finalHeight = Math.min(Math.max(100, targetHeight + extraHeight), 800);
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

    // Skip if no change
    if (heightChange === 0) return;

    prevWindowHeightRef.current = finalHeight;
    isExpandingRef.current = heightChange > 0;

    requestAnimationFrame(() => {
      // When placement is 'top' (dropdown above input), expand separate UPWARD
      // This keeps the input bar visually anchored at the bottom
      if (newPlacement === 'top' && heightChange !== 0) {
        // Use atomic setBounds to prevent visual jumping (teleportation)
        const currentOuterWidth = Math.round((window as any)?.outerWidth || 520);
        const targetWidth = overlayMode === 'compact' ? 520 : currentOuterWidth;
        const currentScreenX = window.screenX;
        const currentScreenY = window.screenY;

        // Calculate new Y position to anchor bottom
        const newY = currentScreenY - heightChange;

        window.desktopAPI?.setBounds?.({
          x: currentScreenX,
          y: newY,
          width: targetWidth,
          height: finalHeight
        });
      } else {
        // Standard resize (anchors top-left by default, which is correct for bottom placement)
        const currentOuterWidth = Math.round((window as any)?.outerWidth || 520);
        const targetWidth = overlayMode === 'compact' ? 520 : currentOuterWidth;
        window.desktopAPI?.resize?.(targetWidth, finalHeight);
      }
    });
  }, [expanded, showSearchOptions, showFileNav, showWebOptions, fileResults.length, calculatePlacement, showMiniOutput, miniOutputHasContent, typingActive, overlayMode]);

  // Update on dropdown state changes
  useEffect(() => {
    if (expanded) return;
    updateWindowSize();
  }, [expanded, updateWindowSize, showSearchOptions, showFileNav, showWebOptions, showMiniOutput, miniOutputHasContent, overlayMode, attachments.length, contextPaths?.length]);

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

  // Input bar height - must match the actual rendered height of the input section
  // Base: container p-2 (8px) + input card min-h (114px) + extra padding (~18px) = ~140px
  // Add gap for visual separation between dropdown and input bar
  const inputBarGap = 16;
  const hasAttachments = attachments.length > 0 || (contextPaths && contextPaths.length > 0);
  const attachmentOffset = hasAttachments ? 44 : 0;
  const inputBarHeight = 140 + extraInputHeight + inputBarGap + attachmentOffset;

  // Compact Mode
  if (!expanded) {
    const needsDropdown = showSearchOptions || showFileNav;
    const miniEnabled = !!(showMiniOutput && (miniOutputHasContent ?? !!(miniOutputText || '').trim()));
    const isTyping = query.trim().length > 0;
    const miniOpen = miniEnabled && !needsDropdown && !isTyping;
    return (
      <div className={clsx(
        "w-full h-full flex flex-col p-2 relative",
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
            <div className="bg-theme-bg rounded-[24px] border border-theme/20 overflow-hidden backdrop-blur-3xl shadow-lg shadow-black/10">
              <div className="p-3 border-b border-theme/10 bg-theme-bg/70">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-theme-muted px-1">
                    Quick Actions
                  </div>
                  <div className="text-[10px] text-theme-muted font-semibold bg-theme-active/50 px-2 py-0.5 rounded-full">
                    {query.length} chars
                  </div>
                </div>
              </div>
              <div className="p-2 space-y-1 max-h-[380px] overflow-y-auto custom-scrollbar">
                {/* Quick Shortcuts */}
                <QuickShortcutsGrid
                  bookmarks={bookmarks}
                  onExecute={executeBookmark}
                  onEdit={() => setShowBookmarkEditor(true)}
                  onAdd={() => setShowBookmarkEditor(true)}
                  maxVisible={6}
                  filter={query}
                />
              {/* Ask Stuard - Primary */}
                <button
                  onClick={() => handleSearchOption('chat')}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl bg-theme-bg border border-theme/10 shadow-sm hover:border-primary/30 hover:shadow-md transition-all group relative overflow-hidden"
                >
                  <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                  <div className="w-7 h-7 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 group-hover:scale-110 transition-all ring-1 ring-primary/20 group-hover:ring-primary/50 z-10">
                    <MessageSquare className="w-3.5 h-3.5 text-primary" />
                  </div>
                  <div className="flex-1 text-left z-10">
                    <div className="text-[13px] font-bold text-theme-fg group-hover:text-primary transition-colors">Ask Stuard</div>
                    <div className="text-[10px] text-theme-muted font-semibold">Get an AI assistant response</div>
                  </div>
                  <div className="text-[10px] font-bold text-theme-muted bg-theme-hover px-2 py-1 rounded-lg border border-theme/10 group-hover:bg-primary group-hover:text-primary-fg group-hover:border-primary transition-all z-10">Enter</div>
                </button>

                {/* File Results / Search */}
                {Array.isArray(fileResults) && fileResults.length > 0 ? (
                  <div className="space-y-1 mb-1">
                    <div className="px-3 py-1.5 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FolderSearch className="w-3.5 h-3.5 text-emerald-500" />
                        <span className="text-[11px] font-bold uppercase tracking-wider text-theme-muted">Files Found</span>
                        {fileSemanticLoading && <Loader2 className="w-3 h-3 text-primary animate-spin" />}
                      </div>
                      <div className="text-[10px] text-theme-muted font-semibold">
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
                        const iconUrl = f?.path ? fileIconDataUrls[String(f.path)] : undefined;

                        return (
                          <button
                            key={String(f.id || f.path || idx)}
                            onClick={() => handleAddFileAsContext(f)}
                            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-theme-bg/30 border border-theme/10 shadow-sm hover:border-primary/30 hover:shadow-md transition-all group text-left mb-1"
                          >
                            <div className={clsx("w-7 h-7 rounded-lg border border-theme/20 flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-all", cfg.bg, cfg.color)}>
                              {iconUrl ? (
                                <img src={iconUrl} alt="" className="w-3.5 h-3.5 object-contain" />
                              ) : (
                                <Icon className="w-3.5 h-3.5" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <div className={clsx("text-[13px] font-semibold text-theme-fg truncate transition-colors", cfg.color)}>
                                  {String(f.filename || f.name || '').trim() || String(f.path || '').split(/[/\\]/).pop() || 'Untitled'}
                                </div>
                                <div className={clsx("text-[9px] font-bold px-1.5 py-0.5 rounded-md uppercase tracking-wider opacity-70", cfg.bg, cfg.color)}>
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
                      className="w-full py-2 text-[10px] font-semibold text-theme-muted hover:text-primary transition-colors text-center border-t border-theme/5 mt-1"
                    >
                      Browse folders instead →
                    </button>
                  </div>
                ) : (
<button
onClick={() => handleSearchOption('files')}
className="w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl bg-theme-card/50 border border-theme/10 shadow-sm hover:border-primary/30 hover:shadow-md transition-all group"
>
<div className="w-7 h-7 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 group-hover:scale-110 transition-all ring-1 ring-primary/20 group-hover:ring-primary/50">
<FolderSearch className="w-3.5 h-3.5 text-primary" />
</div>
<div className="flex-1 text-left">
<div className="text-[12px] font-bold text-theme-fg group-hover:text-primary transition-colors">Search Files</div>
<div className="text-[9px] text-theme-muted font-semibold">
{fileLoading || fileSemanticLoading ? 'Searching...' : 'Find apps, docs, folders & more'}
</div>
</div>
<div className="text-[9px] font-bold text-primary-fg bg-theme-hover px-2 py-1 rounded-lg border border-theme/10 group-hover:bg-primary group-hover:text-primary-fg group-hover:border-primary transition-all">@</div>
</button>
)}

{/* Local Workflows & Marketplace */}
{(filteredLocalWorkflows.length > 0 || marketplaceResults.length > 0) && (
<div className="space-y-1 mb-1">
<div className="px-3 py-1.5 flex items-center justify-between">
<div className="flex items-center gap-2">
<Zap className="w-3.5 h-3.5 text-amber-500" />
<span className="text-[11px] font-bold uppercase tracking-wider text-theme-muted">Workflows</span>
{isMarketplaceSearching && <Loader2 className="w-3 h-3 text-primary animate-spin" />}
</div>
<div className="text-[10px] text-theme-muted font-semibold">
Actions
</div>
</div>

<div className="space-y-1">
{/* Local */}
{filteredLocalWorkflows.map(w => (
<button
key={w.id}
onClick={async () => {
try {
await window.desktopAPI?.workflowsRun?.(w.id);
window.desktopAPI?.hide?.();
(window as any).desktopAPI?.notify?.('Workflow Started', `Running ${w.name}...`);
} catch (e) {
console.error(e);
}
}}
className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-theme-card border border-theme/10 shadow-sm hover:border-primary/30 hover:shadow-md transition-all group text-left mb-1"
>
<div className="w-7 h-7 rounded-lg border border-theme/20 flex items-center justify-center flex-shrink-0 bg-amber-500/10 text-amber-500 group-hover:scale-105 transition-all">
<Zap className="w-3.5 h-3.5" />
</div>
<div className="min-w-0 flex-1">
<div className="text-[13px] font-semibold text-theme-fg truncate group-hover:text-amber-500 transition-colors">
{w.name || 'Untitled'}
</div>
<div className="text-[10px] text-theme-muted truncate font-medium">
Run Local Workflow
</div>
</div>
<PlayCircle className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-amber-500" />
</button>
))}

{/* Marketplace */}
{marketplaceResults.map(w => (
<button
key={w.slug}
onClick={() => {
window.desktopAPI?.openWorkflows?.({ marketplaceSlug: w.slug });
window.desktopAPI?.hide?.();
}}
className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-theme-card border border-theme/10 shadow-sm hover:border-primary/30 hover:shadow-md transition-all group text-left mb-1"
>
<div className="w-7 h-7 rounded-lg border border-theme/20 flex items-center justify-center flex-shrink-0 bg-indigo-500/10 text-indigo-500 group-hover:scale-105 transition-all">
<CloudDownload className="w-3.5 h-3.5" />
</div>
<div className="min-w-0 flex-1">
<div className="text-[13px] font-semibold text-theme-fg truncate group-hover:text-indigo-500 transition-colors">
{w.name}
</div>
<div className="text-[10px] text-theme-muted truncate font-medium">
Marketplace • {w.publisher_name || 'Community'}
</div>
</div>
<Zap className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-indigo-500" />
</button>
))}
</div>
</div>
)}

{/* Web Search - Expandable with multiple engines */}
<div className="rounded-2xl overflow-hidden bg-theme-card border border-theme/10 shadow-sm">
<div className="flex items-stretch">
{/* Main Action - Search with Default */}
<button
onClick={() => handleSearchOption('web', activeEngine.id)}
className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-theme-card border border-theme/10 shadow-sm hover:border-primary/30 hover:shadow-md transition-all group text-left mb-1"
>
<div className={clsx(
"w-7 h-7 rounded-lg flex items-center justify-center transition-all bg-theme-bg/50 group-hover:scale-110",
activeEngine.color
)}>
{activeEngine.icon}
</div>
<div className="flex-1">
<div className={clsx("text-[13px] font-bold transition-colors group-hover:text-theme-fg", activeEngine.color)}>
Search {activeEngine.name}
</div>
<div className="text-[10px] text-theme-muted font-semibold flex items-center gap-1.5">
<span>Ctrl + Enter</span>
<Command className="w-3 h-3 opacity-50" />
</div>
</div>
</button>

                    {/* Change Engine Trigger */}
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowWebOptions(!showWebOptions); }}
                      className={clsx(
                        "w-10 flex items-center justify-center border-l border-theme/10 hover:bg-theme-hover transition-all",
                        showWebOptions ? "bg-theme-hover/80 text-primary" : "text-theme-muted"
                      )}
                      title="Change Default Search Engine"
                    >
                      <ChevronDownIcon className={clsx("w-4 h-4 transition-transform duration-300", showWebOptions && "rotate-180")} />
                    </button>
                  </div>

                  {/* Search Engine Options */}
                  {showWebOptions && (
                    <div className="p-3 bg-theme-bg/30 border-t border-theme/10 grid grid-cols-5 gap-2 animate-in fade-in slide-in-from-top-1 duration-200">
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
                            "w-7 h-7 rounded-lg flex items-center justify-center text-xl shadow-sm transition-all duration-300",
                            "bg-theme-card border border-theme/10 group-hover/engine:border-transparent",
                            "group-hover/engine:scale-110 group-hover/engine:shadow-md"
                          )}>
                            {engine.icon}
                          </div>
                          <span className={clsx(
                            "text-[9px] font-black uppercase tracking-wider transition-colors",
                            "text-theme-muted group-hover/engine:text-theme-fg"
                          )}>{engine.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
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
        <div
          className={clsx(
            "drag w-full min-h-[114px] h-auto py-3 rounded-[28px] flex flex-col justify-center px-4 gap-2 transition-all duration-300",
            translucentMode
              ? "bg-gray-100/80 backdrop-blur-2xl border border-gray-300/50"
              : "bg-gray-100/90 border border-gray-200"
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
                      statusIcon === 'task' ? <ListTodo className="w-3 h-3 text-white" /> :
                        <CheckCircle className="w-3 h-3 text-white" />
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
              {overlayMode !== 'sidebar' && (
                <button
                  type="button"
                  className="w-8 h-8 rounded-[10px] bg-white border border-gray-200 text-theme-fg hover:bg-gray-200/50 hover:scale-105 active:scale-95 transition-all flex items-center justify-center"
                  title="Sidebar"
                  onClick={() => window.desktopAPI.setMode('sidebar')}
                >
                  <PanelRight className="w-3.5 h-3.5" />
                </button>
              )}
              {overlayMode !== 'window' && (
                <button
                  type="button"
                  className="w-8 h-8 rounded-[10px] bg-white border border-gray-200 text-theme-fg hover:bg-gray-200/50 hover:scale-105 active:scale-95 transition-all flex items-center justify-center"
                  title="Window"
                  onClick={() => window.desktopAPI.setMode('window')}
                >
                  <AppWindow className="w-3.5 h-3.5" />
                </button>
              )}

              {/* Dashboard / Home */}
              <button
                type="button"
                className="w-8 h-8 rounded-[10px] bg-white border border-gray-200 text-theme-fg hover:bg-gray-200/50 hover:scale-105 active:scale-95 transition-all flex items-center justify-center"
                title="Dashboard"
                onClick={onOpenDashboard}
              >
                <HomeIcon className="w-3.5 h-3.5" />
              </button>

            </div>
          </div>

          {/* Attachments Bar (Compact Mode) */}
          <AttachmentBar
            attachments={attachments}
            contextPaths={contextPaths}
            onRemoveAttachment={onRemoveAttachment}
            onRemoveContext={removeContext}
          />

          {/* Bottom Row: Input & Mic */}
          <div className="flex items-center gap-2.5 w-full no-drag">
            {!signedIn ? (
              <button
                onClick={onSignIn}
                className="no-drag flex-1 flex items-center justify-center gap-2 h-[42px] rounded-full bg-primary text-primary-fg font-semibold text-[14px] hover:opacity-90 transition-all active:scale-95"
              >
                <LogIn className="w-4 h-4" />
                <span>Sign in</span>
              </button>
            ) : (
              <div className="flex-1 relative min-h-[42px] bg-white rounded-[21px] border border-gray-200 flex items-center px-1.5 py-0.5 transition-all focus-within:ring-2 focus-within:ring-primary/20">
                {/* Plus / Attach Button */}
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <button
                      type="button"
                      className="w-8 h-8 rounded-full flex items-center justify-center bg-theme-hover/50 text-theme-fg/70 hover:text-theme-fg hover:bg-theme-hover transition-all active:scale-95 border border-theme/10"
                      title="Attach"
                    >
                      <PlusIcon className="w-4 h-4" />
                    </button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content className="DropdownContent z-[10001] min-w-[160px] bg-gray-50 rounded-xl border border-gray-200 p-1 shadow-2xl" sideOffset={8} align="start" collisionPadding={10}>
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
                  "flex-1 relative mx-1 transition-all flex items-center min-h-[36px]"
                )}>
                  <TextareaAutosize
                    ref={setTextareaRef}
                    value={query}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setQuery(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onPaste={onPaste}
                    onHeightChange={handleHeightChange}
                    placeholder={showFileNav ? "Type to filter..." : "Just ask Stuard"}
                    className={clsx(
                      "w-full bg-transparent outline-none text-[14px] leading-tight py-2 resize-none scrollbar-hidden font-semibold px-1",
                      "text-theme-fg placeholder:text-theme-muted"
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

        {/* Bookmark Editor Modal */}
        <BookmarkEditor
          isOpen={showBookmarkEditor}
          onClose={() => setShowBookmarkEditor(false)}
          bookmarks={bookmarks}
          onSave={saveBookmarks}
          workflows={localWorkflows.map(w => ({ id: w.id, name: w.name || 'Untitled' }))}
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