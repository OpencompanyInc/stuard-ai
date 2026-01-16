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
  FileText
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
  if (item.urgency === 'soon') return 'text-amber-700';
  return 'text-neutral-700';
};

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
  ).slice(0, 5);

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
        limit: 8,
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
        limit: 8,
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

  const handleAddIndexFolder = useCallback(async () => {
    try {
      if (!window.desktopAPI?.pickFolder || !(window as any).desktopAPI?.execTool) return;
      const picked = await window.desktopAPI.pickFolder({ title: 'Select folders to index', multiple: true });
      const folders = picked?.ok && Array.isArray((picked as any).folders) ? (picked as any).folders : [];
      for (const f of folders) {
        const p = String(f?.path || '').trim();
        if (!p) continue;
        await (window as any).desktopAPI.execTool('file_index_add_root', { path: p, schedule: 'daily' });
      }
      await refreshIndexMeta();
    } catch { }
  }, [refreshIndexMeta]);

  const handleScanSelectedRoot = useCallback(async () => {
    try {
      if (!(window as any).desktopAPI?.execTool) return;
      const rid = String(selectedRootId || '').trim();
      if (!rid) return;
      await (window as any).desktopAPI.execTool('file_index_scan', { root_id: rid, compute_hashes: true });
      await refreshIndexMeta();
    } catch { }
  }, [refreshIndexMeta, selectedRootId]);

  const handleProcessPending = useCallback(async () => {
    const token = typeof accessToken === 'string' ? accessToken : '';
    if (!token) return;
    if (!(window as any).desktopAPI?.execTool) return;

    setProcessingPending(true);
    setProcessedPendingCount(0);
    try {
      const pendingRes = await (window as any).desktopAPI.execTool('file_index_get_pending', { limit: 20 });
      const files = pendingRes?.ok && Array.isArray(pendingRes.files) ? pendingRes.files : [];
      if (!files.length) {
        await refreshIndexMeta();
        return;
      }

      const prepared: Array<{ fileId: string; filename: string; summary: string; keywords: string; embeddingText: string } | null> = [];
      for (const f of files) {
        const fileId = String(f?.id || '').trim();
        const filePath = String(f?.path || '').trim();
        const filename = String(f?.filename || '').trim() || filePath;
        const kind = String(f?.kind || '').trim();
        if (!fileId || !filePath) { prepared.push(null); continue; }

        let summary = `${kind || 'file'}: ${filename}`;
        let keywords = [filename, kind].filter(Boolean).join(', ');

        try {
          if (kind === 'document' || kind === 'code') {
            const readRes = await (window as any).desktopAPI.execTool('read_file', { path: filePath, line_start: 1, line_end: 200 });
            const content = readRes?.ok ? String(readRes.content || '') : '';
            if (content) {
              const prompt = [
                'You are a file summarizer. Given a file\'s content, generate:',
                '1. A concise summary (2-4 sentences) describing what this file contains/does',
                '2. A comma-separated list of relevant keywords (5-15 keywords)',
                '',
                'Format your response EXACTLY as:',
                'SUMMARY: ...',
                'KEYWORDS: ...',
              ].join('\n');

              const resp = await fetch(`${String(CLOUD_AI_HTTP).replace(/\/$/, '')}/inference/ai/text`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt, input: `File: ${filename}\nType: ${kind}\n\n${content}`, temperature: 0.2, model: 'fast' }),
              });
              const j = await resp.json().catch(() => ({}));
              const text = (j && (j.text || j?.result?.text)) ? String(j.text || j?.result?.text) : '';
              const mSum = text.match(/SUMMARY:\s*(.+?)(?=KEYWORDS:|$)/is);
              const mKey = text.match(/KEYWORDS:\s*(.+?)$/is);
              if (mSum?.[1]) summary = mSum[1].trim();
              if (mKey?.[1]) keywords = mKey[1].trim();
            }
          }
        } catch {
          // keep metadata fallback
        }

        prepared.push({
          fileId,
          filename,
          summary,
          keywords,
          embeddingText: `${filename}\n${summary}\n${keywords}`,
        });
      }

      const texts = prepared.filter(Boolean).map((p) => (p as any).embeddingText as string);
      const embedResp = await fetch(`${String(CLOUD_AI_HTTP).replace(/\/$/, '')}/inference/ai/embed_many`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ texts, model: 'text-embedding-3-large' }),
      });
      const ej = await embedResp.json().catch(() => ({}));
      const embeddings = embedResp.ok && ej?.ok && Array.isArray(ej.embeddings) ? ej.embeddings : [];

      let embIdx = 0;
      for (const p of prepared) {
        if (!p) continue;
        const vec = Array.isArray(embeddings[embIdx]) ? embeddings[embIdx] : null;
        embIdx++;
        if (!vec) continue;

        await (window as any).desktopAPI.execTool('file_index_update', {
          file_id: p.fileId,
          summary: p.summary,
          keywords: p.keywords,
          vector: vec,
          summary_model: 'gemini-3-flash',
          embedding_model: 'text-embedding-3-large',
        });

        setProcessedPendingCount((c: number) => c + 1);
      }

      await refreshIndexMeta();
    } catch {
      // ignore
    } finally {
      setProcessingPending(false);
    }
  }, [CLOUD_AI_HTTP, accessToken, refreshIndexMeta]);

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

  // Build status text from next up item
  const displayStatus = nextUp 
    ? `${nextUp.title} ${nextUp.timeLabel}`
    : (statusText || 'Ready');

  return (
    <div 
      className={clsx(
        "flex flex-col h-full rounded-3xl overflow-hidden p-4 transition-all duration-300",
        translucentMode 
          ? "bg-theme-bg/25 backdrop-blur-2xl border border-theme/20" 
          : "bg-theme-card border border-theme/50"
      )}
    >
      {/* Header Status */}
      <div className="flex items-center gap-3 mb-4 px-2">
        <button
          type="button"
          onClick={() => {
            if (nextUp) {
              window.desktopAPI?.openDashboard?.({ tab: 'planner' });
            }
          }}
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
        
        <div className="flex-1" />
        
        {/* Top Right Actions */}
        <div className="flex items-center gap-2">
           {onToggleSidebar && (
             <button 
               onClick={onToggleSidebar}
               className={clsx(
                 "p-2 rounded-xl hover:scale-105 transition-transform",
                 sidebarOpen ? "bg-primary/10 text-primary" : "bg-theme-card text-theme-muted border border-theme/10"
               )}
               title="Spaces"
             >
               <LayoutGrid className="w-4 h-4" />
             </button>
           )}
           {/* Layout Menu */}
           <DropdownMenu.Root>
             <DropdownMenu.Trigger asChild>
               <button
                 type="button"
                 className="p-2 bg-theme-card border border-theme/10 rounded-xl hover:scale-105 transition-transform text-theme-muted hover:text-theme-fg"
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

           <button className="p-2 bg-theme-card border border-theme/10 rounded-xl hover:scale-105 transition-transform text-theme-muted hover:text-theme-fg" title="Workflows" onClick={() => (window as any).desktopAPI?.openWorkflows?.()}>
             <Wand2 className="w-4 h-4" />
           </button>
           <button 
             onClick={onOpenDashboard}
             className="p-2 bg-theme-card border border-theme/10 rounded-xl hover:scale-105 transition-transform text-theme-muted hover:text-theme-fg"
             title="Dashboard"
           >
             <Home className="w-4 h-4" />
           </button>
           
           {/* History Dropdown */}
           <DropdownMenu.Root open={chatMenuOpen} onOpenChange={onChatMenuOpenChange}>
            <DropdownMenu.Trigger asChild>
               <button 
                className={clsx(
                  "p-2 rounded-xl hover:scale-105 transition-transform border border-theme/10",
                  chatMenuOpen ? "bg-theme-active text-theme-fg" : "bg-theme-card text-theme-muted hover:text-theme-fg"
                )}
                title="History"
               >
                 <Clock className="w-4 h-4" />
               </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="DropdownContent z-[10002] w-64 bg-theme-card rounded-xl border border-theme p-1 shadow-2xl backdrop-blur-xl" sideOffset={8} align="end" collisionPadding={10}>
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

      {/* Input Bar */}
      <div className="flex items-center gap-2 mb-4">
        <div className="flex-1 min-h-[48px] bg-theme-hover/50 rounded-2xl flex items-center px-4 border border-theme focus-within:ring-2 ring-primary/20 transition-all">
          <Plus className="w-5 h-5 text-theme-muted mr-2" />
          <TextareaAutosize
            className="flex-1 bg-transparent outline-none text-theme-fg placeholder:text-theme-muted resize-none py-0 overflow-y-auto custom-scrollbar font-bold"
            placeholder={fileResults.length > 0 ? "Type to filter files..." : "Just ask Stuard"}
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
            maxRows={3}
          />
        </div>
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
          className={`h-12 w-12 rounded-2xl flex items-center justify-center transition-all hover:scale-105 active:scale-95 ${
            isRecording ? 'bg-red-500 text-white animate-pulse' : 'bg-primary text-primary-fg'
          }`}
        >
          <Mic className="w-5 h-5" />
        </button>
      </div>

      {/* Command List */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
        {(String(query || '').trim().length >= 2) && (
          <div className="bg-theme-card rounded-2xl px-4 py-3 border border-theme">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <Search className="w-4 h-4 text-primary" />
                <div className="text-[13px] font-bold text-theme-fg truncate uppercase tracking-widest">Files</div>
                <div className="text-[10px] text-theme-muted font-black uppercase flex items-center gap-2">
                  <span>{fileSearchMode === 'hybrid' ? 'Semantic' : 'Quick'}</span>
                  {fileResults.length > 0 && (
                    <>
                      <span className="w-1 h-1 rounded-full bg-theme-muted/50" />
                      <span className="text-primary">{fileResults.length} FOUND</span>
                    </>
                  )}
                </div>
                {(fileLoading || fileSemanticLoading) && (
                  <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  onClick={refreshIndexMeta}
                  className="p-1.5 rounded-lg hover:bg-theme-hover text-theme-muted"
                  title="Refresh index stats"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
                <button
                  onClick={handleAddIndexFolder}
                  className="p-1.5 rounded-lg hover:bg-theme-hover text-theme-muted"
                  title="Add folder to index"
                >
                  <FolderPlus className="w-4 h-4" />
                </button>
                <button
                  onClick={handleScanSelectedRoot}
                  disabled={!selectedRootId}
                  className={clsx(
                    "px-2 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest transition-colors",
                    selectedRootId ? "bg-primary text-primary-fg hover:opacity-90" : "bg-theme-hover text-theme-muted opacity-50"
                  )}
                  title={selectedRootId ? 'Scan selected root' : 'Select a root to scan'}
                >
                  Scan
                </button>
                <button
                  onClick={handleProcessPending}
                  disabled={processingPending || Number(indexStats?.pending_files || 0) <= 0 || !accessToken}
                  className={clsx(
                    "px-2 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest transition-colors",
                    (processingPending || Number(indexStats?.pending_files || 0) <= 0 || !accessToken)
                      ? "bg-theme-hover text-theme-muted opacity-50"
                      : "bg-emerald-500 text-white hover:bg-emerald-600"
                  )}
                  title={!accessToken ? 'Sign in to process pending files' : 'Generate summaries + embeddings for pending files'}
                >
                  {processingPending ? `Indexing ${processedPendingCount}` : 'Index'}
                </button>
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setSelectedRootId('')}
                className={clsx(
                  "text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full border transition-all",
                  !selectedRootId ? "bg-primary text-primary-fg border-primary" : "bg-theme-hover text-theme-muted border-theme hover:text-theme-fg"
                )}
              >
                All
              </button>
              {roots.slice(0, 4).map((r: any) => (
                <button
                  key={String(r.id)}
                  onClick={() => setSelectedRootId(String(r.id))}
                  className={clsx(
                    "text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full border transition-all max-w-[240px] truncate",
                    selectedRootId === String(r.id)
                      ? "bg-primary text-primary-fg border-primary"
                      : "bg-theme-hover text-theme-muted border-theme hover:text-theme-fg"
                  )}
                  title={String(r.path || '')}
                >
                  <Folder className="w-3 h-3 inline-block mr-1 -mt-[1px]" />
                  {String(r.path || '').split(/\\|\//).pop() || String(r.path || '')}
                </button>
              ))}
            </div>

            <div className="mt-3 text-[10px] text-theme-muted font-bold uppercase tracking-widest pl-1">
              Indexed: <span className="text-theme-fg font-black">{Number(indexStats?.indexed_files || 0)}</span> / {Number(indexStats?.total_files || 0)}
              {Number(indexStats?.pending_files || 0) > 0 && (
                <>
                  {' '}• Pending: <span className="text-amber-600 dark:text-amber-400 font-black">{Number(indexStats?.pending_files || 0)}</span>
                </>
              )}
            </div>

            {fileError && (
              <div className="mt-2 text-[11px] text-red-500 font-bold">{fileError}</div>
            )}

            <div className="mt-3 space-y-1">
              {fileResults.length === 0 ? (
                <div className="text-[11px] text-theme-muted italic py-3 text-center bg-theme-hover/20 rounded-xl border border-theme border-dashed">No file matches yet</div>
              ) : (
                fileResults.map((f: any) => {
                  const kind = String(f.kind || 'other').toLowerCase();
                  const getFileKindConfig = (k: string) => {
                    switch (k) {
                      case 'application': return { icon: AppWindow, color: 'text-primary', bg: 'bg-primary/10', label: 'APP' };
                      case 'folder': return { icon: Folder, color: 'text-theme-fg', bg: 'bg-theme-fg/10', label: 'FOLDER' };
                      case 'image': return { icon: ImageIcon, color: 'text-theme-fg', bg: 'bg-theme-fg/10', label: 'IMG' };
                      case 'video': return { icon: Film, color: 'text-theme-fg', bg: 'bg-theme-fg/10', label: 'VID' };
                      case 'audio': return { icon: Music, color: 'text-theme-fg', bg: 'bg-theme-fg/10', label: 'AUDIO' };
                      case 'code': return { icon: CodeIcon, color: 'text-theme-fg', bg: 'bg-theme-fg/10', label: 'CODE' };
                      case 'archive': return { icon: Archive, color: 'text-theme-muted', bg: 'bg-theme-muted/10', label: 'ZIP' };
                      case 'document': return { icon: FileText, color: 'text-theme-fg', bg: 'bg-theme-fg/10', label: 'DOC' };
                      default: return { icon: FileIcon, color: 'text-theme-muted', bg: 'bg-theme-muted/10', label: 'FILE' };
                    }
                  };
                  const cfg = getFileKindConfig(kind);
                  const Icon = cfg.icon;

                  return (
                    <div
                      key={String(f.id || f.path)}
                      onClick={() => handleOpenIndexedFile(String(f.path || ''))}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-theme-hover transition-all group/file border border-transparent hover:border-theme/50 cursor-pointer"
                    >
                      <div className={clsx("w-10 h-10 rounded-xl border border-theme/50 flex items-center justify-center flex-shrink-0 group-hover/file:scale-105 transition-transform", cfg.bg, cfg.color)}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <div className="text-[13px] font-bold text-theme-fg truncate">{String(f.filename || '').trim() || String(f.path || '')}</div>
                          <div className={clsx("text-[9px] font-black px-1.5 py-0.5 rounded-md uppercase tracking-wider opacity-70", cfg.bg, cfg.color)}>
                            {cfg.label}
                          </div>
                        </div>
                        <div className="text-[10px] text-theme-muted truncate font-medium flex items-center gap-1.5">
                          <span className="opacity-50">{kind === 'folder' ? 'Folder' : (String(f.extension || '').toUpperCase().replace('.', '') || 'FILE')}</span>
                          <span className="w-0.5 h-0.5 rounded-full bg-theme-muted opacity-50" />
                          <span className="truncate opacity-75">{String(f.path || '')}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0 opacity-0 group-hover/file:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopyPath(String(f.path || ''));
                          }}
                          className="p-1.5 rounded-lg bg-theme-card border border-theme text-theme-muted hover:text-theme-fg hover:bg-theme-hover transition-colors"
                          title="Copy path"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRevealIndexedFile(String(f.path || ''));
                          }}
                          className="p-1.5 rounded-lg bg-theme-card border border-theme text-theme-muted hover:text-theme-fg hover:bg-theme-hover transition-colors"
                          title="Show in folder"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                }))
              }
            </div>
          </div>
        )}

        {filteredCommands.map((cmd) => (
          <button
            key={cmd.id}
            onClick={cmd.run}
            className="w-full bg-theme-card hover:bg-theme-hover rounded-2xl px-5 py-4 flex items-center justify-between gap-4 transition-all border border-theme hover:-translate-y-0.5 group"
          >
            <div className="flex items-center gap-4 min-w-0">
              {cmd.icon ? (
                <div className="text-theme-muted group-hover:text-primary transition-colors">
                  {cmd.icon}
                </div>
              ) : (
                <div className="w-5 h-5 rounded bg-theme-muted/20" />
              )}
              <div className="text-[15px] text-theme-fg font-bold truncate">
                {cmd.title}
              </div>
            </div>
            
            <div className="flex items-center gap-4 flex-shrink-0">
              {cmd.description && (
                <span className="text-[12px] text-theme-muted italic group-hover:text-theme-muted/80 transition-colors font-medium">
                  {cmd.description}
                </span>
              )}
              {cmd.shortcut && (
                <div className="text-[10px] text-primary font-black uppercase tracking-widest bg-primary/10 px-2 py-1 rounded border border-primary/20">
                  {cmd.shortcut}
                </div>
              )}
            </div>
          </button>
        ))}
        
        {filteredCommands.length === 0 && (
          <div className="text-center text-theme-muted py-12 font-bold italic opacity-50">
            Type to search commands or ask Stuard
          </div>
        )}
      </div>

      {/* Footer with Tasks */}
      <div className="mt-4 flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button className="px-4 py-2 bg-theme-card rounded-full text-[11px] font-black uppercase tracking-widest text-theme-muted flex items-center gap-2 border border-theme hover:bg-theme-hover transition-all">
                <CheckSquare className="w-3.5 h-3.5 text-primary" />
                Tasks
                {tasksCount > 0 && (
                  <span className="bg-primary text-primary-fg text-[10px] px-2 py-0.5 rounded-full min-w-[20px] text-center font-black">{tasksCount}</span>
                )}
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content 
                className="DropdownContent z-[10002] w-72 bg-theme-card rounded-xl border border-theme p-2 shadow-2xl backdrop-blur-xl" 
                sideOffset={8} 
                align="start" 
                collisionPadding={10}
              >
                <div className="flex items-center justify-between mb-3 px-2 pt-1">
                  <span className="text-[11px] font-black text-theme-muted uppercase tracking-widest">Active Tasks</span>
                  <button 
                    onClick={onOpenDashboard}
                    className="text-[11px] font-black text-primary hover:opacity-80 uppercase tracking-widest flex items-center gap-1"
                  >
                    View Board <ChevronRight className="w-3 h-3" />
                  </button>
                </div>
                <div className="max-h-[200px] overflow-y-auto custom-scrollbar space-y-1.5">
                  {tasks.length === 0 ? (
                    <div className="px-2 py-4 text-[12px] text-theme-muted text-center italic font-medium bg-theme-hover/20 rounded-lg">No pending tasks</div>
                  ) : (
                    tasks.slice(0, 5).map(task => (
                      <div 
                        key={task.id}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-theme-hover transition-all border border-transparent hover:border-theme/50 group/task"
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
            onClick={onOpenDashboard}
            className="w-8 h-8 rounded-full bg-theme-card border border-theme flex items-center justify-center hover:bg-theme-hover text-theme-muted hover:text-primary transition-all"
            title="Add task"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <button 
          onClick={() => { try { (window as any).desktopAPI?.hide?.(); } catch {} }}
          className="w-8 h-8 rounded-full bg-theme-card border border-theme flex items-center justify-center hover:bg-red-500/10 text-red-400 hover:text-red-500 transition-all"
          title="Hide Stuard"
        >
          <Power className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
