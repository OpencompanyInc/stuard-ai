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

const CLOUD_AI_HTTP = (window as any).__CLOUD_AI_HTTP__ || (import.meta as any).env?.VITE_CLOUD_AI_URL || "http://127.0.0.1:8082";

const SectionHeader = ({ title, description }: { title: string; description: string }) => (
  <div className="mb-6">
    <h3 className="text-xl font-stuard text-theme-fg tracking-tight">{title}</h3>
    <p className="text-sm text-theme-muted font-medium">{description}</p>
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

export const FileIndexSettings: React.FC = () => {
  const [roots, setRoots] = useState<IndexedRoot[]>([]);
  const [stats, setStats] = useState<IndexStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [addingFolder, setAddingFolder] = useState(false);
  const [semanticLimit, setSemanticLimit] = useState(500);
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

  useEffect(() => {
    loadData();

    // Subscribe to scan progress events
    const unsubProgress = api?.onFileIndexScanProgress?.((data: any) => {
      if (data?.progress) {
        setScanProgress(data.progress);
      }
    });

    // Subscribe to overall indexing status
    const unsubStatus = api?.onFileIndexStatus?.((data: IndexingStatus) => {
      setIndexingStatus(data);
      if (data.status === "complete") {
        // Reload data when complete
        loadData();
      }
    });

    // Subscribe to semantic indexing progress
    const unsubSemantic = api?.onFileIndexSemanticProgress?.((data: any) => {
      setSemanticProgress(data);
    });

    return () => {
      if (typeof unsubProgress === "function") unsubProgress();
      if (typeof unsubStatus === "function") unsubStatus();
      if (typeof unsubSemantic === "function") unsubSemantic();
    };
  }, [loadData, api]);

  const handleAddFolder = async () => {
    setAddingFolder(true);
    try {
      const result = await api?.pickFolder?.({ title: "Select folder to index" });
      if (result?.ok && result?.folders?.length > 0) {
        const folderPath = result.folders[0];
        const addResult = await api?.fileIndexAddRoot?.(folderPath, "daily");
        if (addResult?.ok) {
          await loadData();
          // Auto-scan the new folder
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
        // Auto-scan the newly added folders
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
      // Get authentication token from Supabase session
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session?.access_token) {
        setBatchStatus("Error: Not authenticated. Please log in first.");
        setProcessingBatch(false);
        setTimeout(() => setBatchStatus(null), 5000);
        return;
      }

      // Call desktop IPC to process semantic indexing
      const result = await api?.fileIndexProcessSemanticIndexing?.(session.access_token, semanticLimit);
      if (result?.ok) {
        const p = result.progress;
        setBatchStatus(`Completed: ${p.successful} succeeded, ${p.failed} failed`);
        // Reload data to update stats
        await loadData();
      } else {
        setBatchStatus(`Error: ${result?.error || "Unknown error"}`);
      }
    } catch (e: any) {
      setBatchStatus(`Error: ${e?.message || "Failed to process"}`);
    } finally {
      setProcessingBatch(false);
      setSemanticProgress(null);
      // Clear status after 5 seconds
      setTimeout(() => setBatchStatus(null), 5000);
    }
  };

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
      <SectionHeader
        title="File Search & Indexing"
        description="Index your folders to enable fast file search and AI-powered semantic search."
      />

      {/* Stats Overview */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="p-4 bg-theme-hover rounded-theme-button border border-theme">
            <div className="text-2xl font-bold text-theme-fg font-stuard">
              {formatNumber(stats.total_files)}
            </div>
            <div className="text-[11px] text-theme-muted font-bold uppercase tracking-wide">
              Total Files
            </div>
          </div>
          <div className="p-4 bg-theme-hover rounded-theme-button border border-theme">
            <div className="text-2xl font-bold text-emerald-500 font-stuard">
              {formatNumber(stats.indexed_files)}
            </div>
            <div className="text-[11px] text-theme-muted font-bold uppercase tracking-wide">
              Semantic Indexed
            </div>
          </div>
          <div className="p-4 bg-theme-hover rounded-theme-button border border-theme">
            <div className="text-2xl font-bold text-amber-500 font-stuard">
              {formatNumber(stats.pending_files)}
            </div>
            <div className="text-[11px] text-theme-muted font-bold uppercase tracking-wide">
              Pending Semantic
            </div>
          </div>
          <div className="p-4 bg-theme-hover rounded-theme-button border border-theme">
            <div className="text-2xl font-bold text-primary font-stuard">{stats.roots}</div>
            <div className="text-[11px] text-theme-muted font-bold uppercase tracking-wide">
              Indexed Folders
            </div>
          </div>
        </div>
      )}

      {/* File Types Breakdown */}
      {stats?.files_by_kind && Object.keys(stats.files_by_kind).length > 0 && (
        <div className="mb-6 p-4 bg-theme-hover rounded-theme-button border border-theme">
          <div className="text-[10px] text-theme-muted font-bold uppercase tracking-widest mb-3">
            Files by Type
          </div>
          <div className="flex flex-wrap gap-3">
            {Object.entries(stats.files_by_kind)
              .sort((a, b) => b[1] - a[1])
              .map(([kind, count]) => (
                <div key={kind} className="flex items-center gap-2 text-sm">
                  <KindIcon kind={kind} className="w-4 h-4 text-theme-muted" />
                  <span className="font-medium text-theme-fg capitalize">{kind}</span>
                  <span className="text-theme-muted font-bold">{formatNumber(count)}</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Global Indexing Status */}
      {indexingStatus.status === "scanning" && (
        <div className="mb-6 p-4 bg-primary/5 border border-primary/20 rounded-theme-button">
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-primary animate-spin" />
            <div className="flex-1">
              <div className="text-sm font-bold text-theme-fg">
                Indexing in progress...
              </div>
              <div className="text-xs text-theme-muted">
                {indexingStatus.completedRoots}/{indexingStatus.totalRoots} folders completed
                {indexingStatus.currentPath && (
                  <span className="ml-2 text-primary">• {indexingStatus.currentPath}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Indexed Folders List */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] text-theme-muted font-bold uppercase tracking-widest">
            Indexed Folders
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
                  <PlayCircle className="w-3.5 h-3.5" />
                )}
                Scan All
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

        {roots.length === 0 ? (
          <div className="p-8 bg-theme-hover rounded-theme-button border border-dashed border-theme text-center">
            <FolderSearch className="w-8 h-8 text-theme-muted mx-auto mb-3" />
            <div className="text-sm text-theme-fg font-medium mb-1">No folders indexed yet</div>
            <div className="text-xs text-theme-muted mb-4">
              Set up automatic indexing for your common folders, or add folders manually.
            </div>
            <button
              onClick={handleInitDefaults}
              disabled={initializingDefaults}
              className="flex items-center gap-2 px-4 py-2 mx-auto rounded-theme-button bg-primary text-primary-fg text-xs font-bold hover:opacity-90 transition-all disabled:opacity-50"
            >
              {initializingDefaults ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Wand2 className="w-4 h-4" />
              )}
              Setup Default Folders (Documents, Downloads, Desktop...)
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {roots.map((root) => (
              <div
                key={root.id}
                className="flex items-center gap-3 p-3 bg-theme-hover rounded-theme-button border border-theme group"
              >
                <FolderOpen className="w-5 h-5 text-primary flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-theme-fg truncate">{root.path}</div>
                  <div className="flex items-center gap-3 text-[11px] text-theme-muted">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatTime(root.last_scan_at)}
                    </span>
                    <span className="capitalize">{root.schedule}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleScan(root.id)}
                    disabled={scanning === root.id}
                    className="p-1.5 rounded-md hover:bg-theme-active text-theme-muted hover:text-theme-fg transition-colors"
                    title="Rescan folder"
                  >
                    {scanning === root.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <RefreshCw className="w-4 h-4" />
                    )}
                  </button>
                  <button
                    onClick={() => handleRemoveRoot(root.id)}
                    className="p-1.5 rounded-md hover:bg-red-500/10 text-theme-muted hover:text-red-500 transition-colors"
                    title="Remove from index"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Scan Progress */}
        {scanning && scanProgress && (
          <div className="mt-3 p-3 bg-primary/5 border border-primary/20 rounded-theme-button">
            <div className="flex items-center gap-2 text-sm text-primary font-medium">
              <Loader2 className="w-4 h-4 animate-spin" />
              Scanning... {scanProgress.total_files} files found
            </div>
            <div className="text-xs text-theme-muted mt-1">
              {scanProgress.new_files} new, {scanProgress.changed_files} changed,{" "}
              {scanProgress.deleted_files} deleted
            </div>
          </div>
        )}
      </div>

      {/* Semantic Indexing Section */}
      <div className="p-4 bg-theme-hover rounded-theme-button border border-theme">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-primary/10 rounded-md border border-primary/20">
            <Sparkles className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-bold text-theme-fg">Semantic Indexing</div>
            <div className="text-xs text-theme-muted mt-0.5 mb-3">
              Generate AI summaries and embeddings for deeper file search. Uses Gemini Batch API
              (50% cost savings, processes in ~24 hours).
            </div>

            {stats && stats.pending_files > 0 && (
              <div className="flex items-center gap-4 mb-3">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-theme-muted font-medium">Process up to:</label>
                  <select
                    value={semanticLimit}
                    onChange={(e) => setSemanticLimit(Number(e.target.value))}
                    className="px-2 py-1 rounded border border-theme bg-theme-card text-theme-fg text-xs font-medium"
                  >
                    <option value={100}>100 files</option>
                    <option value={250}>250 files</option>
                    <option value={500}>500 files</option>
                    <option value={1000}>1,000 files</option>
                    <option value={5000}>5,000 files</option>
                  </select>
                </div>
                <div className="text-xs text-theme-muted">
                  ({Math.min(semanticLimit, stats.pending_files)} of {stats.pending_files} pending)
                </div>
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                onClick={handleStartSemanticIndexing}
                disabled={processingBatch || !stats || stats.pending_files === 0}
                className="flex items-center gap-2 px-4 py-2 rounded-theme-button bg-primary text-primary-fg text-xs font-bold hover:opacity-90 transition-all disabled:opacity-50"
              >
                {processingBatch ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                Start Semantic Indexing
              </button>

              {semanticProgress && processingBatch && (
                <div className="flex items-center gap-2 text-xs text-theme-muted">
                  <span className="font-medium">
                    {semanticProgress.processed}/{semanticProgress.total}
                  </span>
                  {semanticProgress.currentFile && (
                    <span className="truncate max-w-[200px]" title={semanticProgress.currentFile}>
                      {semanticProgress.currentFile}
                    </span>
                  )}
                </div>
              )}

              {batchStatus && (
                <div
                  className={clsx(
                    "flex items-center gap-2 text-xs font-medium",
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
          </div>
        </div>
      </div>
    </div>
  );
};

export default FileIndexSettings;
