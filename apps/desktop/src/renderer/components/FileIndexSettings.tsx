import React, { useCallback, useEffect, useState } from "react";
import {
  FolderSearch,
  Plus,
  Trash2,
  RefreshCw,
  FileText,
  Image,
  Code,
  Film,
  Music,
  Archive,
  Box,
  Loader2,
  Clock,
  FolderOpen,
  Wand2,
  Search,
  ChevronRight,
  AppWindow,
} from "lucide-react";
import { clsx } from "clsx";

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

interface IndexingStatus {
  status: "idle" | "scanning" | "complete" | "error";
  totalRoots?: number;
  completedRoots?: number;
  currentPath?: string;
  error?: string;
}

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
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
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

const EXTENSION_GROUPS: { label: string; kind: string; extensions: string[] }[] = [
  { label: "Documents", kind: "document", extensions: [".pdf", ".docx", ".doc", ".txt", ".rtf", ".odt", ".pptx", ".xlsx", ".csv", ".md", ".epub"] },
  { label: "Code", kind: "code", extensions: [".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".cpp", ".c", ".h", ".rb", ".php", ".swift", ".kt", ".json", ".yaml", ".yml", ".toml", ".xml", ".html", ".css", ".scss", ".sql", ".sh", ".bat", ".ps1"] },
  { label: "Images", kind: "image", extensions: [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp", ".ico", ".tiff"] },
  { label: "Video", kind: "video", extensions: [".mp4", ".mkv", ".avi", ".mov", ".webm", ".flv", ".wmv"] },
  { label: "Audio", kind: "audio", extensions: [".mp3", ".wav", ".flac", ".aac", ".ogg", ".m4a", ".wma"] },
];

export const FileIndexSettings: React.FC = () => {
  const [roots, setRoots] = useState<IndexedRoot[]>([]);
  const [stats, setStats] = useState<IndexStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState<string | null>(null);
  const [addingFolder, setAddingFolder] = useState(false);
  const [indexingStatus, setIndexingStatus] = useState<IndexingStatus>({ status: "idle" });
  const [initializingDefaults, setInitializingDefaults] = useState(false);
  const [expandedFolderId, setExpandedFolderId] = useState<string | null>(null);

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

    const unsubStatus = api?.onFileIndexStatus?.((data: IndexingStatus) => {
      setIndexingStatus(data);
      if (data.status === "complete") {
        loadData();
      }
    });

    return () => {
      if (typeof unsubStatus === "function") unsubStatus();
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
    try {
      await api?.fileIndexScan?.(rootId);
      await loadData();
    } catch (e) {
      console.error("[FileIndexSettings] Scan error:", e);
    } finally {
      setScanning(null);
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

        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 bg-theme-hover rounded-xl border border-theme">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20">
                <Search className="w-4 h-4 text-blue-500" />
              </div>
              <div>
                <div className="text-sm font-bold text-theme-fg">Indexed Files</div>
                <div className="text-[10px] text-theme-muted">Filename and text search</div>
              </div>
            </div>
            <div className="text-3xl font-bold text-blue-500 font-stuard">
              {formatNumber(stats?.total_files || 0)}
            </div>
            <div className="text-[11px] text-theme-muted font-medium">files searchable</div>
          </div>

          <div className="p-4 bg-theme-hover rounded-xl border border-theme">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                <FolderOpen className="w-4 h-4 text-emerald-500" />
              </div>
              <div>
                <div className="text-sm font-bold text-theme-fg">Tracked Folders</div>
                <div className="text-[10px] text-theme-muted">Monitored for refresh and rescans</div>
              </div>
            </div>
            <div className="text-3xl font-bold text-emerald-500 font-stuard">
              {formatNumber(stats?.roots || roots.length)}
            </div>
            <div className="text-[11px] text-theme-muted font-medium">folders configured</div>
          </div>
        </div>
      </div>

      {indexingStatus.status === "scanning" && (
        <div className="mb-4 p-3 bg-blue-500/5 border border-blue-500/20 rounded-xl">
          <div className="flex items-center gap-3">
            <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
            <div className="flex-1">
              <div className="text-sm font-bold text-theme-fg">Scanning folders...</div>
              <div className="text-xs text-theme-muted">
                {indexingStatus.completedRoots}/{indexingStatus.totalRoots} folders
                {indexingStatus.currentPath && (
                  <span className="ml-2 truncate">- {indexingStatus.currentPath}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

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
            {roots.map((root) => {
              const isExpanded = expandedFolderId === root.id;
              const folderName = root.path.split(/[/\\]/).filter(Boolean).pop() || root.path;
              return (
                <div key={root.id} className="rounded-xl border border-theme overflow-hidden">
                  <div
                    className="flex items-center gap-3 p-2.5 bg-theme-hover group cursor-pointer"
                    onClick={() => setExpandedFolderId(isExpanded ? null : root.id)}
                  >
                    <FolderOpen className="w-4 h-4 text-primary flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-theme-fg truncate text-[13px]">{folderName}</div>
                      <div className="text-[10px] text-theme-muted truncate">{root.path}</div>
                      <div className="flex items-center gap-2 text-[10px] text-theme-muted mt-0.5">
                        <Clock className="w-3 h-3" />
                        <span>{formatTime(root.last_scan_at)}</span>
                        <span className="text-theme/50">|</span>
                        <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[9px] font-bold uppercase">{root.schedule}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleScan(root.id);
                        }}
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
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveRoot(root.id);
                        }}
                        className="p-1.5 rounded-md hover:bg-red-500/10 text-theme-muted hover:text-red-500 transition-colors"
                        title="Remove"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                      <ChevronRight className={clsx("w-3.5 h-3.5 text-theme-muted transition-transform", isExpanded && "rotate-90")} />
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="px-3 py-3 bg-theme-card border-t border-theme space-y-3">
                      <div>
                        <div className="text-[10px] font-bold text-theme-muted uppercase tracking-widest mb-1.5">Scan Schedule</div>
                        <div className="flex flex-wrap gap-1.5">
                          {(["off", "hourly", "daily", "weekly"] as const).map((sched) => (
                            <button
                              key={sched}
                              onClick={async () => {
                                try {
                                  await api?.fileIndexRemoveRoot?.(root.id);
                                  await api?.fileIndexAddRoot?.(root.path, sched);
                                  await loadData();
                                } catch {
                                }
                              }}
                              className={clsx(
                                "px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-all capitalize",
                                root.schedule === sched
                                  ? "bg-primary/10 border-primary/30 text-primary"
                                  : "bg-theme-hover border-theme text-theme-muted hover:text-theme-fg"
                              )}
                            >
                              {sched}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <div className="text-[10px] font-bold text-theme-muted uppercase tracking-widest mb-1.5">Indexed File Types</div>
                        <div className="flex flex-wrap gap-1.5">
                          {EXTENSION_GROUPS.map((group) => (
                            <div
                              key={group.kind}
                              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-theme-hover border border-theme text-[10px]"
                            >
                              <KindIcon kind={group.kind} className={clsx("w-3 h-3", KIND_COLORS[group.kind])} />
                              <span className="font-medium text-theme-fg">{group.label}</span>
                              <span className="text-theme-muted">({group.extensions.length})</span>
                            </div>
                          ))}
                        </div>
                        <p className="text-[9px] text-theme-muted mt-1.5">
                          Supported file types inside this folder are scanned for name and content search.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

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
