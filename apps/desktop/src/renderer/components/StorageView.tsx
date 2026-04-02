import React, { useState, useCallback, useRef, useMemo } from 'react';
import { clsx } from 'clsx';
import {
  HardDrive, Cloud, Upload, Download, Trash2, RefreshCw, Loader2,
  CheckCircle2, AlertCircle, ArrowUpDown, FolderOpen, File, FileText,
  Image, Film, Music, Archive, Code, Database, Zap, Shield, Crown,
  ChevronRight, X, Plus, Search, MoreVertical, ExternalLink, Clock
} from 'lucide-react';
import { useStorage, type StoragePlan, type UploadProgress, type StorageInfo, type CloudFileEntry } from '../hooks/useStorage';
import { FileExplorer } from './FileExplorer';
import { MediaLibraryView } from './MediaLibraryView';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatGb(gb: number): string {
  if (gb < 1) return `${(gb * 1024).toFixed(0)} MB`;
  return `${gb.toFixed(1)} GB`;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const d = new Date(dateStr);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return 'Just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86400_000)}d ago`;
}

function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'].includes(ext)) return Image;
  if (['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext)) return Film;
  if (['mp3', 'wav', 'ogg', 'flac', 'aac'].includes(ext)) return Music;
  if (['zip', 'tar', 'gz', 'rar', '7z', 'bz2'].includes(ext)) return Archive;
  if (['js', 'ts', 'py', 'rs', 'go', 'java', 'cpp', 'c', 'h', 'rb', 'sh', 'json', 'yaml', 'toml'].includes(ext)) return Code;
  if (['db', 'sqlite', 'sql'].includes(ext)) return Database;
  if (['md', 'txt', 'log', 'csv', 'xml', 'html', 'css'].includes(ext)) return FileText;
  return File;
}

const PLAN_BADGES: Record<string, { emoji: string; color: string }> = {
  free:    { emoji: '🌱', color: 'border-green-500/30 bg-green-500/5' },
  starter: { emoji: '⚡', color: 'border-blue-500/30 bg-blue-500/5' },
  pro:     { emoji: '🚀', color: 'border-purple-500/30 bg-purple-500/5' },
  power:   { emoji: '🔥', color: 'border-orange-500/30 bg-orange-500/5' },
  max:     { emoji: '👑', color: 'border-yellow-500/30 bg-yellow-500/5' },
};

// ─────────────────────────────────────────────────────────────────────────────
// Sub-Components
// ─────────────────────────────────────────────────────────────────────────────

function UsageBar({ used, total, label, color = 'bg-primary' }: { used: number; total: number; label: string; color?: string }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const isHigh = pct > 80;
  const isCritical = pct > 95;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-theme-muted font-medium">{label}</span>
        <span className={clsx("font-bold", isCritical ? "text-red-400" : isHigh ? "text-amber-400" : "text-theme-fg")}>
          {pct.toFixed(0)}%
        </span>
      </div>
      <div className="h-2 bg-theme-hover rounded-full overflow-hidden">
        <div
          className={clsx("h-full rounded-full transition-all duration-500", isCritical ? "bg-red-500" : isHigh ? "bg-amber-500" : color)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-theme-muted">
        <span>{formatGb(used)} used</span>
        <span>{formatGb(total)} total</span>
      </div>
    </div>
  );
}

function PlanCard({ plan, current, onSelect, purchasing }: { plan: StoragePlan; current: boolean; onSelect: () => void; purchasing: boolean }) {
  const badge = PLAN_BADGES[plan.id] || PLAN_BADGES.free;
  const isPopular = plan.id === 'pro';

  return (
    <button
      onClick={onSelect}
      disabled={current || purchasing}
      className={clsx(
        "relative flex flex-col p-4 rounded-2xl border-2 transition-all duration-300 text-left group",
        current
          ? "border-primary/40 bg-primary/5 ring-2 ring-primary/20 cursor-default"
          : "border-theme/10 bg-theme-card hover:border-primary/30 hover:bg-primary/5 hover:shadow-lg",
        purchasing && "opacity-50 cursor-wait"
      )}
    >
      {isPopular && !current && (
        <div className="absolute -top-2.5 right-3 px-2.5 py-0.5 text-[10px] font-black text-white bg-primary rounded-full shadow-lg">
          POPULAR
        </div>
      )}
      {current && (
        <div className="absolute -top-2.5 right-3 px-2.5 py-0.5 text-[10px] font-black text-white bg-green-600 rounded-full shadow-lg flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3" /> CURRENT
        </div>
      )}

      <div className="flex items-center gap-2 mb-3">
        <span className="text-xl">{badge.emoji}</span>
        <span className="font-bold text-theme-fg text-sm">{plan.name}</span>
      </div>

      <div className="flex items-baseline gap-1 mb-3">
        <span className="text-2xl font-black text-theme-fg">${plan.monthlyUsd.toFixed(2)}</span>
        <span className="text-xs text-theme-muted">/mo</span>
      </div>

      <div className="space-y-1.5 text-xs text-theme-muted">
        <div className="flex items-center gap-2">
          <HardDrive className="w-3.5 h-3.5 text-primary/60" />
          <span><strong className="text-theme-fg">{plan.hotDiskGb} GB</strong> hot disk</span>
        </div>
        <div className="flex items-center gap-2">
          <Cloud className="w-3.5 h-3.5 text-primary/60" />
          <span><strong className="text-theme-fg">{plan.coldStorageGb} GB</strong> cloud storage</span>
        </div>
      </div>

      {!current && (
        <div className="mt-3 pt-3 border-t border-theme/10 text-center">
          <span className="text-xs font-bold text-primary group-hover:text-primary-bright transition-colors">
            {purchasing ? 'Processing...' : 'Upgrade →'}
          </span>
        </div>
      )}
    </button>
  );
}

function UploadItem({ item }: { item: UploadProgress }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 bg-theme-hover/50 rounded-xl text-xs">
      {item.status === 'uploading' && <Loader2 className="w-3.5 h-3.5 text-primary animate-spin shrink-0" />}
      {item.status === 'done' && <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />}
      {item.status === 'error' && <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />}
      {item.status === 'pending' && <div className="w-3.5 h-3.5 rounded-full border-2 border-theme-muted/30 shrink-0" />}
      <span className="truncate flex-1 font-medium text-theme-fg">{item.filename}</span>
      <span className="text-theme-muted shrink-0">
        {item.status === 'uploading' ? `${item.percent}%` : item.status === 'done' ? formatBytes(item.total) : item.status === 'error' ? item.error : 'Waiting'}
      </span>
    </div>
  );
}

function DropZone({ onFiles, uploading }: { onFiles: (files: File[]) => void; uploading: boolean }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const items = Array.from(e.dataTransfer.files);
    if (items.length > 0) onFiles(items);
  }, [onFiles]);

  return (
    <div
      className={clsx(
        "border-2 border-dashed rounded-2xl p-8 text-center transition-all duration-300 cursor-pointer group",
        dragging
          ? "border-primary bg-primary/5 scale-[1.01]"
          : "border-theme/15 hover:border-primary/30 hover:bg-primary/3"
      )}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const items = Array.from(e.target.files || []);
          if (items.length > 0) onFiles(items);
          e.target.value = '';
        }}
      />
      <div className="flex flex-col items-center gap-3">
        {uploading ? (
          <Loader2 className="w-10 h-10 text-primary animate-spin" />
        ) : (
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/15 transition-colors">
            <Upload className="w-6 h-6 text-primary" />
          </div>
        )}
        <div>
          <p className="text-sm font-bold text-theme-fg">
            {uploading ? 'Uploading...' : 'Drop files here or click to browse'}
          </p>
          <p className="text-xs text-theme-muted mt-1">
            Files are stored securely in your Stuard cloud storage
          </p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tabs
// ─────────────────────────────────────────────────────────────────────────────

type StorageTab = 'overview' | 'media' | 'files' | 'sync' | 'plans';

// ─────────────────────────────────────────────────────────────────────────────
// Files Tab Sub-Component
// ─────────────────────────────────────────────────────────────────────────────

function FilesTab({
  files, filesLoaded, fetchFiles, uploading, uploadQueue, handleUpload,
  handleDownload, handleDelete, confirmDelete, setConfirmDelete,
  searchQuery, setSearchQuery, info,
}: {
  files: CloudFileEntry[];
  filesLoaded: boolean;
  fetchFiles: () => void;
  uploading: boolean;
  uploadQueue: UploadProgress[];
  handleUpload: (files: File[]) => void;
  handleDownload: (objectName: string) => void;
  handleDelete: (objectName: string) => void;
  confirmDelete: string | null;
  setConfirmDelete: (v: string | null) => void;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  info: StorageInfo | null;
}) {
  // Load files on first render
  React.useEffect(() => {
    if (!filesLoaded) fetchFiles();
  }, [filesLoaded, fetchFiles]);

  const filtered = files.filter(f =>
    !searchQuery || f.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <DropZone onFiles={handleUpload} uploading={uploading} />

      {uploadQueue.length > 0 && (
        <div className="space-y-1.5">
          {uploadQueue.map((item, i) => <UploadItem key={i} item={item} />)}
        </div>
      )}

      {/* Search + Refresh */}
      <div className="flex items-center gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-theme-muted" />
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Filter files..."
            className="w-full pl-9 pr-3 py-2 bg-theme-hover/50 border border-theme/10 rounded-xl text-xs text-theme-fg placeholder:text-theme-muted/50 focus:outline-none focus:border-primary/40"
          />
        </div>
        <button onClick={fetchFiles} className="p-2 rounded-xl hover:bg-theme-hover text-theme-muted hover:text-theme-fg transition-colors">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* File List */}
      {filtered.length === 0 ? (
        <div className="p-6 rounded-2xl border border-theme/10 bg-theme-card text-center">
          <FolderOpen className="w-10 h-10 text-theme-muted/30 mx-auto mb-3" />
          <p className="text-sm text-theme-muted font-medium">
            {files.length === 0 ? 'No files yet. Upload files above.' : 'No files matching your search.'}
          </p>
          <p className="text-xs text-theme-muted/60 mt-1">
            Files are stored in your GCS bucket and accessible from your VM.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-theme/10 bg-theme-card overflow-hidden">
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-4 py-2 border-b border-theme/10 text-[10px] font-black text-theme-muted uppercase tracking-wider">
            <span>Name</span>
            <span>Size</span>
            <span>Modified</span>
            <span></span>
          </div>
          <div className="divide-y divide-theme/5 max-h-[400px] overflow-y-auto custom-scrollbar">
            {filtered.map((file) => {
              const userId = info?.planId ? '' : ''; // prefix already stripped server-side
              const fullObjectName = `${file.name}`; // name is relative to user prefix
              const Icon = getFileIcon(file.name);

              return (
                <div key={file.name} className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-center px-4 py-2.5 hover:bg-theme-hover/50 transition-colors group">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Icon className="w-4 h-4 text-theme-muted/60 shrink-0" />
                    <span className="text-xs font-medium text-theme-fg truncate">{file.name}</span>
                  </div>
                  <span className="text-[11px] text-theme-muted tabular-nums whitespace-nowrap">{formatBytes(file.size)}</span>
                  <span className="text-[11px] text-theme-muted whitespace-nowrap">{timeAgo(file.updated)}</span>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleDownload(fullObjectName)}
                      className="p-1 rounded-lg hover:bg-primary/10 text-theme-muted hover:text-primary transition-colors"
                      title="Download"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    {confirmDelete === fullObjectName ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleDelete(fullObjectName)}
                          className="px-1.5 py-0.5 rounded text-[10px] font-bold text-red-400 bg-red-500/10 hover:bg-red-500/20 transition-colors"
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => setConfirmDelete(null)}
                          className="p-0.5 rounded text-theme-muted hover:text-theme-fg transition-colors"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDelete(fullObjectName)}
                        className="p-1 rounded-lg hover:bg-red-500/10 text-theme-muted hover:text-red-400 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="px-4 py-2 border-t border-theme/10 text-[10px] text-theme-muted">
            {filtered.length} file{filtered.length === 1 ? '' : 's'} · {formatBytes(filtered.reduce((s, f) => s + f.size, 0))} total
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function StorageView() {
  const {
    plans, info, quota, syncStatus, files, loading, error, uploading, uploadQueue, syncing, purchasing,
    purchasePlan, uploadFile, downloadFile, deleteFile, createFolder, renameFile, fetchFiles,
    syncToCloud, syncFromCloud, clearUploadQueue, refresh,
  } = useStorage();

  const [tab, setTab] = useState<StorageTab>('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [filesLoaded, setFilesLoaded] = useState(false);

  const showFeedback = useCallback((msg: string) => {
    setActionFeedback(msg);
    setTimeout(() => setActionFeedback(null), 3000);
  }, []);

  const handleUpload = useCallback(async (uploadFiles: File[], folderPath?: string) => {
    for (const file of uploadFiles) {
      const result = await uploadFile(file, folderPath || '');
      if (result.ok) {
        showFeedback(`${file.name} uploaded successfully`);
        fetchFiles();
      }
    }
  }, [uploadFile, showFeedback, fetchFiles]);

  const handleDownload = useCallback(async (objectName: string) => {
    const result = await downloadFile(objectName);
    if (result.ok) showFeedback('Download started');
  }, [downloadFile, showFeedback]);

  const handleDelete = useCallback(async (objectName: string) => {
    const result = await deleteFile(objectName);
    if (result.ok) {
      showFeedback('File deleted');
      setConfirmDelete(null);
      fetchFiles();
    }
  }, [deleteFile, showFeedback, fetchFiles]);

  const handlePurchase = useCallback(async (planId: string) => {
    const result = await purchasePlan(planId);
    if (result.ok) showFeedback(`Upgraded to ${planId} plan!`);
  }, [purchasePlan, showFeedback]);

  // ── Loading State ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    );
  }

  const currentPlanId = info?.planId || 'free';
  const badge = PLAN_BADGES[currentPlanId] || PLAN_BADGES.free;
  const hotUsed = info?.hotUsedGb || 0;
  const hotTotal = info?.hotDiskGb || 5;
  const coldUsedBytes = info?.coldStorageBytes || 0;
  const coldUsedGb = coldUsedBytes / (1024 * 1024 * 1024);
  const coldTotalGb = info?.coldQuotaGb || 1;

  return (
    <div className="space-y-6">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-black text-theme-fg tracking-tight flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center">
              <HardDrive className="w-5 h-5 text-primary" />
            </div>
            Storage
          </h2>
          <p className="text-sm text-theme-muted mt-1">Manage your hot disk, cloud storage, and media library</p>
        </div>
        <button
          onClick={refresh}
          className="p-2.5 rounded-xl hover:bg-theme-hover transition-colors text-theme-muted hover:text-theme-fg"
        >
          <RefreshCw className="w-4.5 h-4.5" />
        </button>
      </div>

      {/* ── Feedback Toast ────────────────────────────────────────────────── */}
      {actionFeedback && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-green-600/10 border border-green-500/20 text-green-400 rounded-xl text-sm font-medium animate-in slide-in-from-top-2">
          <CheckCircle2 className="w-4 h-4" />
          {actionFeedback}
        </div>
      )}

      {/* ── Error Banner ──────────────────────────────────────────────────── */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-red-600/10 border border-red-500/20 text-red-400 rounded-xl text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* ── Tab Bar ───────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 p-1 bg-theme-hover/50 rounded-xl w-fit">
        {[
          { id: 'overview' as StorageTab, label: 'Overview', icon: HardDrive },
          { id: 'media' as StorageTab, label: 'Media', icon: Image },
          { id: 'files' as StorageTab, label: 'Files', icon: FolderOpen },
          { id: 'sync' as StorageTab, label: 'Sync', icon: ArrowUpDown },
          { id: 'plans' as StorageTab, label: 'Plans', icon: Crown },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all duration-200",
              tab === t.id
                ? "bg-theme-bg text-theme-fg shadow-sm"
                : "text-theme-muted hover:text-theme-fg"
            )}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Overview Tab ──────────────────────────────────────────────────── */}
      {tab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Current Plan Card */}
          <div className={clsx("p-5 rounded-2xl border", badge.color)}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="text-xl">{badge.emoji}</span>
                <span className="font-black text-theme-fg text-lg">{info?.plan?.name || 'Free'} Plan</span>
              </div>
              <button
                onClick={() => setTab('plans')}
                className="text-xs font-bold text-primary hover:text-primary-bright transition-colors"
              >
                Upgrade →
              </button>
            </div>
            <div className="space-y-4">
              <UsageBar used={hotUsed} total={hotTotal} label="Hot Disk (VM)" color="bg-orange-500" />
              <UsageBar used={coldUsedGb} total={coldTotalGb} label="Cloud Storage (GCS)" color="bg-blue-500" />
            </div>
          </div>

          {/* Quick Sync Card */}
          <div className="p-5 rounded-2xl border border-theme/10 bg-theme-card">
            <div className="flex items-center gap-2 mb-4">
              <ArrowUpDown className="w-4 h-4 text-primary" />
              <span className="font-bold text-theme-fg">VM ↔ Cloud Sync</span>
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs text-theme-muted">
                <Clock className="w-3.5 h-3.5" />
                <span>Last sync: <strong className="text-theme-fg">{timeAgo(syncStatus?.lastSyncAt || info?.lastSyncAt || null)}</strong></span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={syncToCloud}
                  disabled={syncing}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 bg-primary/10 hover:bg-primary/15 text-primary rounded-xl text-xs font-bold transition-all disabled:opacity-50"
                >
                  {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  VM → Cloud
                </button>
                <button
                  onClick={syncFromCloud}
                  disabled={syncing}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 bg-theme-hover hover:bg-theme-active text-theme-fg rounded-xl text-xs font-bold transition-all disabled:opacity-50"
                >
                  {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  Cloud → VM
                </button>
              </div>
            </div>

            {/* Quick Stats */}
            <div className="mt-4 pt-4 border-t border-theme/10 grid grid-cols-2 gap-3">
              <div className="text-center">
                <div className="text-lg font-black text-theme-fg">{formatGb(hotTotal)}</div>
                <div className="text-[10px] text-theme-muted font-bold uppercase">Hot Disk</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-black text-theme-fg">{formatBytes(coldUsedBytes)}</div>
                <div className="text-[10px] text-theme-muted font-bold uppercase">Cloud Used</div>
              </div>
            </div>
          </div>

          {/* Upload Zone */}
          <div className="lg:col-span-2">
            <DropZone onFiles={handleUpload} uploading={uploading} />
            {uploadQueue.length > 0 && (
              <div className="mt-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-theme-muted">Uploads</span>
                  <button onClick={clearUploadQueue} className="text-[10px] text-theme-muted hover:text-theme-fg">Clear</button>
                </div>
                {uploadQueue.map((item, i) => <UploadItem key={i} item={item} />)}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Media Tab ─────────────────────────────────────────────────────── */}
      {tab === 'media' && <MediaLibraryView />}

      {/* ── Files Tab ─────────────────────────────────────────────────────── */}
      {tab === 'files' && (
        <FileExplorer
          files={files}
          loading={loading}
          fetchFiles={fetchFiles}
          uploading={uploading}
          uploadQueue={uploadQueue}
          onUpload={handleUpload}
          onDownload={handleDownload}
          onDelete={handleDelete}
          onCreateFolder={createFolder}
          onRename={renameFile}
          info={info}
        />
      )}

      {/* ── Sync Tab ──────────────────────────────────────────────────────── */}
      {tab === 'sync' && (
        <div className="space-y-4">
          {/* Sync Diagram */}
          <div className="p-6 rounded-2xl border border-theme/10 bg-theme-card">
            <div className="flex items-center justify-center gap-4">
              <div className="flex flex-col items-center gap-2 text-center">
                <div className="w-16 h-16 rounded-2xl bg-orange-500/10 flex items-center justify-center border border-orange-500/20">
                  <HardDrive className="w-7 h-7 text-orange-500" />
                </div>
                <div>
                  <div className="font-bold text-xs text-theme-fg">VM Hot Disk</div>
                  <div className="text-[10px] text-theme-muted">{formatGb(hotTotal)} PD-SSD</div>
                </div>
              </div>

              <div className="flex flex-col items-center gap-1">
                <ArrowUpDown className={clsx("w-6 h-6 transition-colors", syncing ? "text-primary animate-pulse" : "text-theme-muted/30")} />
                <div className="text-[10px] text-theme-muted font-bold">SYNC</div>
              </div>

              <div className="flex flex-col items-center gap-2 text-center">
                <div className="w-16 h-16 rounded-2xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                  <Cloud className="w-7 h-7 text-blue-500" />
                </div>
                <div>
                  <div className="font-bold text-xs text-theme-fg">Cloud Storage</div>
                  <div className="text-[10px] text-theme-muted">{formatBytes(coldUsedBytes)} / {formatGb(coldTotalGb)}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Sync Actions */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button
              onClick={syncToCloud}
              disabled={syncing}
              className="p-5 rounded-2xl border border-theme/10 bg-theme-card hover:border-primary/30 hover:bg-primary/3 transition-all text-left group disabled:opacity-50"
            >
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                  <Upload className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <div className="font-bold text-sm text-theme-fg">Backup to Cloud</div>
                  <div className="text-xs text-theme-muted">VM hot disk → GCS cold storage</div>
                </div>
              </div>
              <p className="text-xs text-theme-muted leading-relaxed">
                Compress your VM workspace and upload it to cloud storage. Your data persists even when the VM is stopped.
              </p>
            </button>

            <button
              onClick={syncFromCloud}
              disabled={syncing}
              className="p-5 rounded-2xl border border-theme/10 bg-theme-card hover:border-blue-500/30 hover:bg-blue-500/3 transition-all text-left group disabled:opacity-50"
            >
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center group-hover:bg-blue-500/20 transition-colors">
                  <Download className="w-5 h-5 text-blue-500" />
                </div>
                <div>
                  <div className="font-bold text-sm text-theme-fg">Restore to VM</div>
                  <div className="text-xs text-theme-muted">GCS cold storage → VM hot disk</div>
                </div>
              </div>
              <p className="text-xs text-theme-muted leading-relaxed">
                Download your backup from cloud storage and extract it onto the VM. Use after starting a VM or to reset.
              </p>
            </button>
          </div>

          {/* Sync Info */}
          <div className="p-4 rounded-2xl bg-theme-hover/30 border border-theme/5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
              <div>
                <div className="text-sm font-black text-theme-fg">{timeAgo(syncStatus?.lastSyncAt || null)}</div>
                <div className="text-[10px] text-theme-muted font-bold uppercase mt-0.5">Last Sync</div>
              </div>
              <div>
                <div className="text-sm font-black text-theme-fg">{formatBytes(coldUsedBytes)}</div>
                <div className="text-[10px] text-theme-muted font-bold uppercase mt-0.5">Cloud Used</div>
              </div>
              <div>
                <div className="text-sm font-black text-theme-fg">{formatGb(hotTotal)}</div>
                <div className="text-[10px] text-theme-muted font-bold uppercase mt-0.5">Hot Disk</div>
              </div>
              <div>
                <div className="text-sm font-black text-theme-fg">{syncStatus?.backupObjectName ? '✓' : '—'}</div>
                <div className="text-[10px] text-theme-muted font-bold uppercase mt-0.5">Backup</div>
              </div>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-blue-500/5 border border-blue-500/10 text-xs text-blue-300/80 leading-relaxed">
            <strong>Auto-sync:</strong> When your VM starts, it automatically restores the latest backup from cloud storage.
            When it stops, it backs up your workspace. You can also trigger manual syncs anytime.
          </div>
        </div>
      )}

      {/* ── Plans Tab ─────────────────────────────────────────────────────── */}
      {tab === 'plans' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
            {plans.map(plan => (
              <PlanCard
                key={plan.id}
                plan={plan}
                current={currentPlanId === plan.id}
                onSelect={() => handlePurchase(plan.id)}
                purchasing={purchasing}
              />
            ))}
          </div>

          <div className="p-4 rounded-xl bg-theme-hover/30 border border-theme/5 text-xs text-theme-muted leading-relaxed">
            <strong className="text-theme-fg">How storage works:</strong>
            <ul className="mt-2 space-y-1 list-disc list-inside">
              <li><strong>Hot disk</strong> is a fast PD-SSD attached to your VM — your live workspace</li>
              <li><strong>Cloud storage</strong> is GCS-backed persistent storage — survives VM stop/start</li>
              <li>Your workspace auto-syncs between hot disk and cloud storage on VM start/stop</li>
              <li>Credits are billed monthly for your plan tier</li>
              <li>You can upgrade anytime — disk resizes automatically</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
