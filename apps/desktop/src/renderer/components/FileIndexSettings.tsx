import React, { useEffect, useState, useCallback } from "react";
import {
  FolderSearch,
  Plus,
  Trash2,
  RefreshCw,
  HardDrive,
  FileText,
  Image,
  Code,
  Film,
  Music,
  Archive,
  Box,
  Loader2,
  ChevronDown,
  Sparkles,
  Clock,
  AlertCircle,
  CheckCircle,
  FolderOpen,
  Wand2,
  PlayCircle,
  Search,
  Brain,
  Zap,
  Filter,
  X,
  ChevronRight,
  File,
  AppWindow,
} from "lucide-react";
import { clsx } from "clsx";
import { supabase } from "../lib/supabaseClient";

interface IndexedRoot {
  id: string;
  path: string;
  enabled: boolean;
  schedule: "off" | "hourly" | "daily" | "weekly" | "custom";
  interval_hours: number | null;
  last_scan_at: string | null;
  created_at: string;
}

interface IndexStats {
  roots: number;
  total_files: number;
  indexed_files: number;
  pending_files: number;
  folders: number;
  files_by_kind: Record<string, number>;
}

interface ScanProgress {
  total_files: number;
  new_files: number;
  changed_files: number;
  deleted_files: number;
  elapsed_seconds: number;
}

interface SemanticFile {
  id: string;
  path: string;
  filename: string;
  kind: string;
  status: "pending" | "indexed" | "stale" | "error";
  summary?: string;
  indexed_at?: string;
}

const CLOUD_AI_HTTP = (window as any).__CLOUD_AI_HTTP__ || (import.meta as any).env?.VITE_CLOUD_AI_URL || "http://127.0.0.1:8082";

const SectionHeader = ({ title, description, icon: Icon }: { title: string; description: string; icon?: React.ComponentType<{ className?: string }> }) => (
  <div className="mb-4">
    <div className="flex items-center gap-2">
      {Icon && <Icon className="w-5 h-5 text-primary" />}
      <h3 className="text-lg font-stuard text-theme-fg tracking-tight">{title}</h3>
    </div>
    <p className="text-sm text-theme-muted font-medium mt-0.5">{description}</p>
  </div>
);

const KindIcon: React.FC<{ kind: string; className?: string }> = ({ kind, className = "w-4 h-4" }) => {
  switch (kind) {
    case "document":
      return <FileText className={className} />;
    case "image":
      return <Image className={className} />;
    case "code":
      return <Code className={className} />;
    case "video":
      return <Film className={className} />;
    case "audio":
      return <Music className={className} />;
    case "archive":
      return <Archive className={className} />;
    case "application":
      return <AppWindow className={className} />;
    case "folder":
      return <FolderOpen className={className} />;
    default:
      return <Box className={className} />;
  }
};

const formatNumber = (n: number): string => {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return n.toString();
};

const formatTime = (iso: string | null): string => {
  if (!iso) return "Never";
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

interface IndexingStatus {
  status: "idle" | "scanning" | "complete" | "error";
  totalRoots?: number;
  completedRoots?: number;
  currentPath?: string;
  error?: string;
}

const KIND_OPTIONS = [
  { kind: "document", label: "Documents", desc: "PDFs, Word, text files" },
  { kind: "code", label: "Code", desc: "Scripts, configs, markup" },
  { kind: "image", label: "Images", desc: "Photos, screenshots, graphics" },
  { kind: "video", label: "Video", desc: "Movies, clips, recordings" },
  { kind: "audio", label: "Audio", desc: "Music, podcasts, voice notes" },
];

const KIND_COLORS: Record<string, string> = {
  document: "text-sky-500",
  code: "text-emerald-500",
  image: "text-purple-500",
  video: "text-red-500",
  audio: "text-pink-500",
  archive: "text-orange-500",
  application: "text-blue-500",
  other: "text-theme-muted",
};

export const FileIndexSettings: React.FC = () => {
  const [roots, setRoots] = useState<IndexedRoot[]>([]);
  const [stats, setStats] = useState<IndexStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [addingFolder, setAddingFolder] = useState(false);
  const [semanticLimit, setSemanticLimit] = useState(100);
  const [processingBatch, setProcessingBatch] = useState(false);
  const [batchStatus, setBatchStatus] = useState<string | null>(null);
  const [indexingStatus, setIndexingStatus] = useState<IndexingStatus>({ status: "idle" });
  const [initializingDefaults, setInitializingDefaults] = useState(false);
  const [semanticProgress, setSemanticProgress] = useState<{
    total: number;
    processed: number;
    successful: number;
    failed: number;
    currentFile?: string;
  } | null>(null);

  // Semantic file selection
  const [showSemanticManager, setShowSemanticManager] = useState(false);
  const [semanticFiles, setSemanticFiles] = useState<SemanticFile[]>([]);
  const [semanticFilter, setSemanticFilter] = useState<"all" | "pending" | "indexed">("pending");
  const [semanticKindFilter, setSemanticKindFilter] = useState<string | null>(null);
  const [loadingSemanticFiles, setLoadingSemanticFiles] = useState(false);
  const [selectedKinds, setSelectedKinds] = useState<Set<string>>(new Set(["document", "code", "image"]));

  const api = (window as any).desktopAPI;

  const loadData = useCallback(async () => {
    try {
      const [rootsRes, statsRes] = await Promise.all([
        api?.fileIndexListRoots?.(),
        api?.fileIndexGetStats?.(),
      ]);
      if (rootsRes?.ok) setRoots(rootsRes.roots || []);
      if (statsRes?.ok) setStats(statsRes.stats || null);
    } catch (e) {
      console.error("[FileIndexSettings] Load error:", e);
    } finally {
      setLoading(false);
    }
  }, [api]);

  const loadSemanticFiles = useCallback(async () => {
    setLoadingSemanticFiles(true);
    try {
      const res = await api?.execTool?.("file_search", {
        mode: "quick",
        limit: 500,
      });
      if (res?.ok && res.results) {
        setSemanticFiles(
          res.results.map((f: any) => ({
            id: f.id,
            path: f.path,
            filename: f.filename,
            kind: f.kind,
            status: f.status || (f.summary ? "indexed" : "pending"),
            summary: f.summary,
            indexed_at: f.indexed_at,
          }))
        );
      }
    } catch (e) {
      console.error("[FileIndexSettings] Load semantic files error:", e);
    } finally {
      setLoadingSemanticFiles(false);
    }
  }, [api]);

  useEffect(() => {
    loadData();

    const unsubProgress = api?.onFileIndexScanProgress?.((data: any) => {
      if (data?.progress) {
        setScanProgress(data.progress);
      }
    });

    const unsubStatus = api?.onFileIndexStatus?.((data: IndexingStatus) => {
      setIndexingStatus(data);
      if (data.status === "complete") {
        loadData();
      }
    });

    const unsubSemantic = api?.onFileIndexSemanticProgress?.((data: any) => {
      setSemanticProgress(data);
    });

    return () => {
      if (typeof unsubProgress === "function") unsubProgress();
      if (typeof unsubStatus === "function") unsubStatus();
      if (typeof unsubSemantic === "function") unsubSemantic();
    };
  }, [loadData, api]);

  useEffect(() => {
    if (showSemanticManager) {
      loadSemanticFiles();
    }
  }, [showSemanticManager, loadSemanticFiles]);

  const handleAddFolder = async () => {
    setAddingFolder(true);
    try {
      const result = await api?.pickFolder?.({ title: "Select folder to index" });
      if (result?.ok && result?.folders?.length > 0) {
        const folderPath = result.folders[0];
        const addResult = await api?.fileIndexAddRoot?.(folderPath, "daily");
        if (addResult?.ok) {
          await loadData();
          if (addResult.root?.id) {
            handleScan(addResult.root.id);
          }
        }
      }
    } catch (e) {
      console.error("[FileIndexSettings] Add folder error:", e);
    } finally {
      setAddingFolder(false);
    }
  };

  const handleRemoveRoot = async (rootId: string) => {
    try {
      const result = await api?.fileIndexRemoveRoot?.(rootId);
      if (result?.ok) {
        await loadData();
      }
    } catch (e) {
      console.error("[FileIndexSettings] Remove root error:", e);
    }
  };

  const handleScan = async (rootId: string) => {
    setScanning(rootId);
    setScanProgress(null);
    try {
      await api?.fileIndexScan?.(rootId);
      await loadData();
    } catch (e) {
      console.error("[FileIndexSettings] Scan error:", e);
    } finally {
      setScanning(null);
      setScanProgress(null);
    }
  };

  const handleInitDefaults = async () => {
    setInitializingDefaults(true);
    try {
      const result = await api?.fileIndexInitDefaults?.();
      if (result?.ok) {
        await loadData();
        if (result.added > 0) {
          await api?.fileIndexScanAll?.();
        }
      }
    } catch (e) {
      console.error("[FileIndexSettings] Init defaults error:", e);
    } finally {
      setInitializingDefaults(false);
    }
  };

  const handleScanAll = async () => {
    try {
      await api?.fileIndexScanAll?.();
    } catch (e) {
      console.error("[FileIndexSettings] Scan all error:", e);
    }
  };

  const handleStartSemanticIndexing = async () => {
    setProcessingBatch(true);
    setSemanticProgress(null);
    setBatchStatus("Starting semantic indexing...");
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session?.access_token) {
        setBatchStatus("Error: Not authenticated. Please log in first.");
        setProcessingBatch(false);
        setTimeout(() => setBatchStatus(null), 5000);
        return;
      }

      const result = await api?.fileIndexProcessSemanticIndexing?.(session.access_token, semanticLimit);
      if (result?.ok) {
        const p = result.progress;
        setBatchStatus(`Completed: ${p.successful} succeeded, ${p.failed} failed`);
        await loadData();
        if (showSemanticManager) {
          loadSemanticFiles();
        }
      } else {
        setBatchStatus(`Error: ${result?.error || "Unknown error"}`);
      }
    } catch (e: any) {
      setBatchStatus(`Error: ${e?.message || "Failed to process"}`);
    } finally {
      setProcessingBatch(false);
      setSemanticProgress(null);
      setTimeout(() => setBatchStatus(null), 5000);
    }
  };

  const toggleKind = (kind: string) => {
    setSelectedKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) {
        next.delete(kind);
      } else {
        next.add(kind);
      }
      return next;
    });
  };

  const filteredSemanticFiles = semanticFiles.filter((f) => {
    if (semanticFilter === "pending" && f.status !== "pending" && f.status !== "stale") return false;
    if (semanticFilter === "indexed" && f.status !== "indexed") return false;
    if (semanticKindFilter && f.kind !== semanticKindFilter) return false;
    return true;
  });

  const pendingByKind = semanticFiles.reduce(
    (acc, f) => {
      if (f.status === "pending" || f.status === "stale") {
        acc[f.kind] = (acc[f.kind] || 0) + 1;
      }
      return acc;
    },
    {} as Record<string, number>
  );

  const indexedByKind = semanticFiles.reduce(
    (acc, f) => {
      if (f.status === "indexed") {
        acc[f.kind] = (acc[f.kind] || 0) + 1;
      }
      return acc;
    },
    {} as Record<string, number>
  );

  if (loading) {
    return (
      <div className="bg-theme-card rounded-theme-card border border-theme p-6 shadow-sm mb-6">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-theme-muted" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-theme-card rounded-theme-card border border-theme p-6 shadow-sm mb-6">
      {/* Hero Stats */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-stuard text-theme-fg tracking-tight">File Index</h2>
            <p className="text-sm text-theme-muted font-medium">Search files by name or content</p>
          </div>
          <div className="flex items-center gap-2">
            {roots.length > 0 && (
              <button
                onClick={handleScanAll}
                disabled={indexingStatus.status === "scanning"}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-theme-button border border-theme text-theme-fg text-[11px] font-bold hover:bg-theme-hover transition-all disabled:opacity-50"
              >
                {indexingStatus.status === "scanning" ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                Refresh
              </button>
            )}
            <button
              onClick={handleAddFolder}
              disabled={addingFolder}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-theme-button bg-primary text-primary-fg text-[11px] font-bold hover:opacity-90 transition-all disabled:opacity-50"
            >
              {addingFolder ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Plus className="w-3.5 h-3.5" />
              )}
              Add Folder
            </button>
          </div>
        </div>

        {/* Two-column stats */}
        <div className="grid grid-cols-2 gap-4">
          {/* Left: Lexical Index */}
          <div className="p-4 bg-theme-hover rounded-xl border border-theme">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20">
                <Search className="w-4 h-4 text-blue-500" />
              </div>
              <div>
                <div className="text-sm font-bold text-theme-fg">Lexical Index</div>
                <div className="text-[10px] text-theme-muted">Fast filename & keyword search</div>
              </div>
            </div>
            <div className="text-3xl font-bold text-blue-500 font-stuard">
              {formatNumber(stats?.total_files || 0)}
            </div>
            <div className="text-[11px] text-theme-muted font-medium">files indexed</div>
          </div>

          {/* Right: Semantic Index */}
          <div className="p-4 bg-theme-hover rounded-xl border border-theme">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20">
                <Brain className="w-4 h-4 text-purple-500" />
              </div>
              <div>
                <div className="text-sm font-bold text-theme-fg">Semantic Index</div>
                <div className="text-[10px] text-theme-muted">AI-powered content search</div>
              </div>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-purple-500 font-stuard">
                {formatNumber(stats?.indexed_files || 0)}
              </span>
              {stats && stats.pending_files > 0 && (
                <span className="text-sm text-amber-500 font-medium">
                  +{formatNumber(stats.pending_files)} pending
                </span>
              )}
            </div>
            <div className="text-[11px] text-theme-muted font-medium">files with AI embeddings</div>
          </div>
        </div>
      </div>

      {/* Global Indexing Status */}
      {indexingStatus.status === "scanning" && (
        <div className="mb-4 p-3 bg-blue-500/5 border border-blue-500/20 rounded-xl">
          <div className="flex items-center gap-3">
            <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
            <div className="flex-1">
              <div className="text-sm font-bold text-theme-fg">Scanning folders...</div>
              <div className="text-xs text-theme-muted">
                {indexingStatus.completedRoots}/{indexingStatus.totalRoots} folders
                {indexingStatus.currentPath && (
                  <span className="ml-2 truncate">• {indexingStatus.currentPath}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Indexed Folders */}
      <div className="mb-6">
        <div className="text-[10px] text-theme-muted font-bold uppercase tracking-widest mb-2">
          Indexed Folders ({roots.length})
        </div>

        {roots.length === 0 ? (
          <div className="p-6 bg-theme-hover rounded-xl border border-dashed border-theme text-center">
            <FolderSearch className="w-7 h-7 text-theme-muted mx-auto mb-2" />
            <div className="text-sm text-theme-fg font-medium mb-1">No folders indexed</div>
            <div className="text-xs text-theme-muted mb-3">
              Add folders to search their contents
            </div>
            <button
              onClick={handleInitDefaults}
              disabled={initializingDefaults}
              className="flex items-center gap-2 px-4 py-2 mx-auto rounded-xl bg-primary text-primary-fg text-xs font-bold hover:opacity-90 transition-all disabled:opacity-50"
            >
              {initializingDefaults ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Wand2 className="w-4 h-4" />
              )}
              Auto-Setup Common Folders
            </button>
          </div>
        ) : (
          <div className="space-y-1.5">
            {roots.map((root) => (
              <div
                key={root.id}
                className="flex items-center gap-3 p-2.5 bg-theme-hover rounded-lg border border-theme group"
              >
                <FolderOpen className="w-4 h-4 text-primary flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-theme-fg truncate text-[13px]">{root.path}</div>
                  <div className="flex items-center gap-2 text-[10px] text-theme-muted">
                    <span>{formatTime(root.last_scan_at)}</span>
                    <span className="text-theme/50">•</span>
                    <span className="capitalize">{root.schedule}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleScan(root.id)}
                    disabled={scanning === root.id}
                    className="p-1.5 rounded-md hover:bg-theme-active text-theme-muted hover:text-theme-fg transition-colors"
                    title="Rescan"
                  >
                    {scanning === root.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                  </button>
                  <button
                    onClick={() => handleRemoveRoot(root.id)}
                    className="p-1.5 rounded-md hover:bg-red-500/10 text-theme-muted hover:text-red-500 transition-colors"
                    title="Remove"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Semantic Indexing Section */}
      <div className="border-t border-theme pt-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-purple-500" />
            <span className="text-sm font-bold text-theme-fg">Semantic Indexing</span>
          </div>
          <button
            onClick={() => setShowSemanticManager(!showSemanticManager)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-theme-muted hover:text-theme-fg hover:bg-theme-hover transition-all"
          >
            <Filter className="w-3.5 h-3.5" />
            Manage
            <ChevronRight className={clsx("w-3.5 h-3.5 transition-transform", showSemanticManager && "rotate-90")} />
          </button>
        </div>

        {/* Semantic Manager Panel */}
        {showSemanticManager && (
          <div className="mb-4 p-4 bg-theme-hover rounded-xl border border-theme">
            <div className="text-xs text-theme-muted mb-3">
              Choose which file types to semantically index. AI will analyze content and create searchable embeddings.
            </div>

            {/* Kind Selection */}
            <div className="flex flex-wrap gap-2 mb-3">
              {KIND_OPTIONS.map((opt) => {
                const pending = pendingByKind[opt.kind] || 0;
                const indexed = indexedByKind[opt.kind] || 0;
                const isSelected = selectedKinds.has(opt.kind);
                const colorClass = KIND_COLORS[opt.kind] || "text-theme-muted";

                return (
                  <button
                    key={opt.kind}
                    onClick={() => toggleKind(opt.kind)}
                    className={clsx(
                      "flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-bold transition-all",
                      isSelected
                        ? "bg-primary/10 border-primary/30 text-primary"
                        : "bg-theme-card border-theme text-theme-muted hover:border-primary/20"
                    )}
                  >
                    <KindIcon kind={opt.kind} className={clsx("w-3.5 h-3.5", colorClass)} />
                    <span>{opt.label}</span>
                    {(pending > 0 || indexed > 0) && (
                      <span className="text-[10px] opacity-70">
                        ({indexed}✓, {pending}⏳)
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* File List Preview */}
            <div className="border-t border-theme pt-3 mt-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <select
                    value={semanticFilter}
                    onChange={(e) => setSemanticFilter(e.target.value as any)}
                    className="px-2 py-1 rounded border border-theme bg-theme-card text-xs font-medium text-theme-fg"
                  >
                    <option value="pending">Pending ({stats?.pending_files || 0})</option>
                    <option value="indexed">Indexed ({stats?.indexed_files || 0})</option>
                    <option value="all">All Files</option>
                  </select>
                </div>
                {loadingSemanticFiles && <Loader2 className="w-3.5 h-3.5 animate-spin text-theme-muted" />}
              </div>

              <div className="max-h-48 overflow-y-auto space-y-1 scrollbar-hidden">
                {filteredSemanticFiles.slice(0, 50).map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-theme-card/50 text-xs"
                  >
                    <KindIcon kind={f.kind} className={clsx("w-3.5 h-3.5 flex-shrink-0", KIND_COLORS[f.kind])} />
                    <span className="truncate flex-1 text-theme-fg">{f.filename}</span>
                    <span
                      className={clsx(
                        "px-1.5 py-0.5 rounded text-[9px] font-bold",
                        f.status === "indexed"
                          ? "bg-emerald-500/10 text-emerald-500"
                          : f.status === "error"
                          ? "bg-red-500/10 text-red-500"
                          : "bg-amber-500/10 text-amber-500"
                      )}
                    >
                      {f.status === "indexed" ? "✓" : f.status === "error" ? "!" : "⏳"}
                    </span>
                  </div>
                ))}
                {filteredSemanticFiles.length === 0 && (
                  <div className="text-center py-4 text-xs text-theme-muted">No files match the filter</div>
                )}
                {filteredSemanticFiles.length > 50 && (
                  <div className="text-center py-2 text-xs text-theme-muted">
                    +{filteredSemanticFiles.length - 50} more files
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Progress / Batch Controls */}
        {stats && stats.pending_files > 0 && (
          <div className="p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-500" />
                <span className="text-sm font-bold text-theme-fg">
                  {formatNumber(stats.pending_files)} files pending semantic indexing
                </span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <label className="text-xs text-theme-muted font-medium">Process:</label>
                <select
                  value={semanticLimit}
                  onChange={(e) => setSemanticLimit(Number(e.target.value))}
                  className="px-2 py-1 rounded border border-theme bg-theme-card text-theme-fg text-xs font-medium"
                >
                  <option value={100}>100 files</option>
                  <option value={250}>250 files</option>
                  <option value={500}>500 files</option>
                  <option value={1000}>1,000 files</option>
                </select>
              </div>
              <button
                onClick={handleStartSemanticIndexing}
                disabled={processingBatch}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-500 text-white text-xs font-bold hover:bg-purple-600 transition-all disabled:opacity-50"
              >
                {processingBatch ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Start Indexing
                  </>
                )}
              </button>
            </div>

            {semanticProgress && processingBatch && (
              <div className="mt-2 flex items-center gap-2 text-xs text-theme-muted">
                <span className="font-medium">
                  {semanticProgress.processed}/{semanticProgress.total}
                </span>
                {semanticProgress.currentFile && (
                  <span className="truncate max-w-[200px]">{semanticProgress.currentFile}</span>
                )}
              </div>
            )}

            {batchStatus && (
              <div
                className={clsx(
                  "mt-2 flex items-center gap-2 text-xs font-medium",
                  batchStatus.startsWith("Error") ? "text-red-500" : "text-emerald-500"
                )}
              >
                {batchStatus.startsWith("Error") ? (
                  <AlertCircle className="w-4 h-4" />
                ) : (
                  <CheckCircle className="w-4 h-4" />
                )}
                {batchStatus}
              </div>
            )}
          </div>
        )}

        {stats && stats.pending_files === 0 && stats.indexed_files > 0 && (
          <div className="p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-xl">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-500" />
              <span className="text-sm font-bold text-theme-fg">All indexed files have semantic embeddings</span>
            </div>
          </div>
        )}
      </div>

      {/* Files by Type */}
      {stats?.files_by_kind && Object.keys(stats.files_by_kind).length > 0 && (
        <div className="border-t border-theme pt-4 mt-4">
          <div className="text-[10px] text-theme-muted font-bold uppercase tracking-widest mb-2">
            Files by Type
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(stats.files_by_kind)
              .sort((a, b) => b[1] - a[1])
              .map(([kind, count]) => (
                <div
                  key={kind}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-theme-hover border border-theme"
                >
                  <KindIcon kind={kind} className={clsx("w-3.5 h-3.5", KIND_COLORS[kind] || "text-theme-muted")} />
                  <span className="text-xs font-medium text-theme-fg capitalize">{kind}</span>
                  <span className="text-xs text-theme-muted font-bold">{formatNumber(count)}</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default FileIndexSettings;