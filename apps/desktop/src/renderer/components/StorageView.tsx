import React, { useState, useCallback } from 'react';
import { clsx } from 'clsx';
import {
  HardDrive, Cloud, Upload, Download, RefreshCw, Loader2,
  CheckCircle2, AlertCircle, ArrowUpDown, FolderOpen, CreditCard,
  Clock, Check, ArrowRight,
} from 'lucide-react';
import { useStorage, type StoragePlan, type StorageInfo } from '../hooks/useStorage';
import { useRegisterHeaderActions } from './HeaderActions';
import { FileExplorer } from './FileExplorer';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatGb(gb: number): string {
  if (gb < 1) return `${Math.round(gb * 1024)} MB`;
  return `${parseFloat(gb.toFixed(1))} GB`;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Usage meter — single neutral fill; warms to amber/red only as it fills up.
// ─────────────────────────────────────────────────────────────────────────────

function UsageMeter({
  used, total, label, right, idle, idleNote,
}: {
  used: number;
  total: number;
  label: string;
  right?: string;
  idle?: boolean;
  idleNote?: string;
}) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const fill = pct > 95 ? 'bg-red-500' : pct > 80 ? 'bg-amber-500' : 'bg-primary';

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[14px] font-semibold text-theme-fg">{label}</span>
        <div className="flex items-center gap-2">
          {!idle && (
            <span className="text-[11px] font-semibold tabular-nums text-primary">{Math.round(pct)}%</span>
          )}
          {right && <span className="text-[12px] font-medium text-theme-muted tabular-nums">{right}</span>}
        </div>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full border border-[color:var(--dashboard-panel-border)] bg-[color:var(--dashboard-hover)]">
        {!idle && (
          <div
            className={clsx('h-full rounded-full transition-all duration-700 ease-out', fill)}
            style={{ width: `${pct}%`, minWidth: used > 0 ? '8px' : 0 }}
          />
        )}
      </div>
      {idle && idleNote && <p className="text-[12px] text-theme-muted">{idleNote}</p>}
    </div>
  );
}

function StorageSummaryBar({
  info, lastSync, fileCount,
}: {
  info: StorageInfo | null;
  lastSync: string | null;
  fileCount: number;
}) {
  const coldUsedBytes = info?.coldStorageBytes || 0;
  const coldTotalGb = info?.coldQuotaGb || 0.25;
  const coldUsedGb = coldUsedBytes / (1024 * 1024 * 1024);
  const pct = coldTotalGb > 0 ? Math.min(100, (coldUsedGb / coldTotalGb) * 100) : 0;
  const fill = pct > 95 ? 'bg-red-500' : pct > 80 ? 'bg-amber-500' : 'bg-primary';

  return (
    <div className="dashboard-card flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3.5">
      <div className="flex min-w-[220px] flex-1 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
          <Cloud className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-semibold text-theme-fg">Cloud storage</span>
            <span className="text-[12px] font-medium tabular-nums text-theme-muted">
              {formatBytes(coldUsedBytes)} / {formatGb(coldTotalGb)}
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-[color:var(--dashboard-hover)]">
            <div
              className={clsx('h-full rounded-full transition-all duration-700', fill)}
              style={{ width: `${pct}%`, minWidth: coldUsedBytes > 0 ? '6px' : 0 }}
            />
          </div>
        </div>
      </div>

      <div className="hidden h-9 w-px shrink-0 bg-[color:var(--dashboard-panel-border)] sm:block" />

      <div className="text-[12px] text-theme-muted">
        <span className="font-semibold text-theme-fg">{info?.plan?.name || 'Free'}</span> plan
      </div>

      <div className="inline-flex items-center gap-1.5 text-[12px] text-theme-muted">
        <Clock className="h-3.5 w-3.5 shrink-0" />
        {timeAgo(lastSync)}
      </div>

      {fileCount > 0 && (
        <div className="text-[12px] font-medium text-theme-muted">
          {fileCount} file{fileCount === 1 ? '' : 's'}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Plan row — calm neutral list row; accent reserved for current / recommended.
// ─────────────────────────────────────────────────────────────────────────────

function PlanRow({
  plan, current, recommended, onSelect, purchasing,
}: {
  plan: StoragePlan;
  current: boolean;
  recommended: boolean;
  onSelect: () => void;
  purchasing: boolean;
}) {
  return (
    <div
      className={clsx(
        'relative flex flex-col gap-3 px-5 py-4 transition-colors sm:flex-row sm:items-center sm:gap-5',
        current ? 'bg-primary/[0.04]' : 'hover:bg-[color:var(--dashboard-hover)]',
      )}
    >
      {current && <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-primary" />}

      {/* Name + tags */}
      <div className="flex w-full items-center gap-2.5 sm:w-44 sm:shrink-0">
        <span className="text-[14px] font-semibold text-theme-fg tracking-tight">{plan.name}</span>
        {current && (
          <span className="dashboard-pill px-2 py-0.5 text-[10px] font-semibold text-theme-fg inline-flex items-center gap-1">
            <Check className="w-3 h-3" /> Current
          </span>
        )}
        {!current && recommended && (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold text-primary bg-primary/10 border border-primary/20">
            Recommended
          </span>
        )}
      </div>

      {/* Specs */}
      <div className="flex flex-1 flex-wrap items-center gap-x-6 gap-y-1.5">
        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-theme-muted">
          <HardDrive className="w-3.5 h-3.5 opacity-60" />
          <strong className="font-medium text-theme-fg">{formatGb(plan.hotDiskGb)}</strong> disk
        </span>
        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-theme-muted">
          <Cloud className="w-3.5 h-3.5 opacity-60" />
          <strong className="font-medium text-theme-fg">{formatGb(plan.coldStorageGb)}</strong> cloud
        </span>
      </div>

      {/* Price */}
      <div className="text-left sm:w-28 sm:text-right">
        {plan.monthlyCredits > 0 ? (
          <div className="text-[13px] text-theme-fg">
            <span className="font-semibold tabular-nums">{plan.monthlyCredits.toLocaleString()}</span>
            <span className="text-theme-muted"> cr/mo</span>
          </div>
        ) : (
          <div className="text-[13px] font-semibold text-theme-fg">Free</div>
        )}
      </div>

      {/* Action */}
      <div className="sm:w-28 sm:shrink-0 sm:text-right">
        {current ? (
          <span className="text-[12px] text-theme-muted">Active plan</span>
        ) : (
          <button
            onClick={onSelect}
            disabled={purchasing}
            className={clsx(
              'inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-[12.5px] font-medium transition-colors disabled:opacity-50',
              recommended
                ? 'dashboard-button-primary'
                : 'dashboard-card-muted text-theme-fg',
            )}
          >
            {purchasing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            Switch
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync action button
// ─────────────────────────────────────────────────────────────────────────────

function SyncButton({
  icon: Icon, title, subtitle, onClick, busy,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  onClick: () => void;
  busy: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="dashboard-card-muted group flex items-center gap-3 rounded-2xl px-4 py-3 text-left transition-colors disabled:opacity-50"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon className="w-4 h-4" />}
      </div>
      <div className="min-w-0">
        <div className="text-[14px] font-semibold text-theme-fg">{title}</div>
        <div className="truncate text-[12px] text-theme-muted">{subtitle}</div>
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tabs
// ─────────────────────────────────────────────────────────────────────────────

type StorageTab = 'overview' | 'files' | 'plans';

const TABS: { id: StorageTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'overview', label: 'Overview', icon: HardDrive },
  { id: 'files', label: 'Files', icon: FolderOpen },
  { id: 'plans', label: 'Plans', icon: CreditCard },
];

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

export function StorageView() {
  const {
    plans, info, syncStatus, files, loading, error, uploading, uploadQueue, syncing, purchasing,
    purchasePlan, uploadFile, downloadFile, getFileUrl, shareFile, deleteFile, createFolder, renameFile, fetchFiles,
    syncToCloud, syncFromCloud, refresh,
  } = useStorage();

  const [tab, setTab] = useState<StorageTab>('overview');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  // Publish the page's primary CTA into the single dashboard top bar.
  useRegisterHeaderActions([
    { id: 'storage-refresh', label: 'Refresh', icon: RefreshCw, onClick: refresh, loading, variant: 'secondary' },
  ], [loading, refresh]);

  const showFeedback = useCallback((msg: string) => {
    setActionFeedback(msg);
    setTimeout(() => setActionFeedback(null), 3000);
  }, []);

  const handleUpload = useCallback(async (uploadFiles: File[], folderPath?: string) => {
    for (const file of uploadFiles) {
      const result = await uploadFile(file, folderPath || '');
      if (result.ok) { showFeedback(`${file.name} uploaded`); fetchFiles(); }
    }
  }, [uploadFile, showFeedback, fetchFiles]);

  const handleDownload = useCallback(async (objectName: string) => {
    const result = await downloadFile(objectName);
    if (result.ok) showFeedback('Download started');
  }, [downloadFile, showFeedback]);

  const handleDelete = useCallback(async (objectName: string) => {
    const result = await deleteFile(objectName);
    if (result.ok) { showFeedback('File deleted'); setConfirmDelete(null); fetchFiles(); }
  }, [deleteFile, showFeedback, fetchFiles]);

  const handlePurchase = useCallback(async (planId: string) => {
    const result = await purchasePlan(planId);
    if (result.ok) showFeedback(`Switched to ${planId} plan`);
  }, [purchasePlan, showFeedback]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 text-theme-muted animate-spin" />
      </div>
    );
  }

  const currentPlanId = info?.planId || 'free';
  const hotUsed = info?.hotUsedGb ?? null;          // null = VM stopped / not reporting
  const hotTotal = info?.hotDiskGb || 5;
  const coldUsedBytes = info?.coldStorageBytes || 0;
  const coldUsedGb = coldUsedBytes / (1024 * 1024 * 1024);
  const coldTotalGb = info?.coldQuotaGb || 0.25;
  const fileBytes = info?.fileBytes ?? coldUsedBytes;
  const backupBytes = info?.backupBytes ?? 0;
  const lastSync = syncStatus?.lastSyncAt || info?.lastSyncAt || null;

  return (
    <div className="space-y-5 pb-6">
      {/* Toast / error */}
      {actionFeedback && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[13px] font-medium">
          <CheckCircle2 className="w-4 h-4 shrink-0" /> {actionFeedback}
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-[13px]">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      <StorageSummaryBar info={info} lastSync={lastSync} fileCount={files.length} />

      {/* Segmented tabs */}
      <div className="dashboard-segment inline-flex">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              'dashboard-segment-item inline-flex items-center gap-2',
              tab === t.id && 'is-active',
            )}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Overview ─────────────────────────────────────────────────────── */}
      {tab === 'overview' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Storage summary */}
          <div className="dashboard-card p-5 md:p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <HardDrive className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-[16px] font-semibold text-theme-fg tracking-tight">Storage</div>
                  <div className="text-[13px] text-theme-muted">{info?.plan?.name || 'Free'} plan</div>
                </div>
              </div>
              <button
                onClick={() => setTab('plans')}
                className="dashboard-pill inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-theme-fg"
              >
                Manage <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="space-y-4">
              <UsageMeter
                label="VM disk"
                used={hotUsed ?? 0}
                total={hotTotal}
                idle={hotUsed === null}
                idleNote="Usage shows while your VM is running"
                right={hotUsed === null ? `${formatGb(hotTotal)} allocated` : `${formatGb(hotUsed)} / ${formatGb(hotTotal)}`}
              />
              <UsageMeter
                label="Cloud storage"
                used={coldUsedGb}
                total={coldTotalGb}
                right={`${formatBytes(coldUsedBytes)} / ${formatGb(coldTotalGb)}`}
              />
            </div>

            {(fileBytes > 0 || backupBytes > 0) && (
              <div className="flex items-center gap-4 border-t border-[color:var(--dashboard-panel-border)] pt-3 text-[11.5px] text-theme-muted">
                <span>Your files <strong className="font-medium text-theme-fg">{formatBytes(fileBytes)}</strong></span>
                {backupBytes > 0 && <span>Backup <strong className="font-medium text-theme-fg">{formatBytes(backupBytes)}</strong></span>}
              </div>
            )}
          </div>

          {/* Sync */}
          <div className="dashboard-card p-5 md:p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <ArrowUpDown className="w-4 h-4" />
                </div>
                <div className="text-[16px] font-semibold text-theme-fg tracking-tight">Sync</div>
              </div>
              <span className="inline-flex items-center gap-1.5 text-[12px] text-theme-muted">
                <Clock className="w-3.5 h-3.5" /> {timeAgo(lastSync)}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-2.5">
              <SyncButton icon={Upload} title="Back up to cloud" subtitle="VM disk → cloud storage" onClick={syncToCloud} busy={syncing} />
              <SyncButton icon={Download} title="Restore to VM" subtitle="Cloud storage → VM disk" onClick={syncFromCloud} busy={syncing} />
            </div>

            <p className="text-[12px] leading-relaxed text-theme-muted">
              Your workspace auto-syncs when the VM starts and stops. Data in cloud storage
              survives VM restarts, so it's safe to stop your VM anytime.
            </p>
          </div>
        </div>
      )}

      {/* ── Files ────────────────────────────────────────────────────────── */}
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
          getFileUrl={getFileUrl}
          shareFile={shareFile}
          info={info as StorageInfo | null}
        />
      )}

      {/* ── Plans ────────────────────────────────────────────────────────── */}
      {tab === 'plans' && (
        <div className="space-y-4">
          <div className="dashboard-card overflow-hidden">
            <div className="flex items-center justify-between border-b border-[color:var(--dashboard-panel-border)] px-5 py-3.5">
              <span className="text-[13px] font-semibold text-theme-fg tracking-tight">Storage plans</span>
              <span className="text-[11.5px] text-theme-muted">Flat monthly fee · change anytime</span>
            </div>
            <div className="divide-y divide-[color:var(--dashboard-panel-border)]">
              {plans.map(plan => (
                <PlanRow
                  key={plan.id}
                  plan={plan}
                  current={currentPlanId === plan.id}
                  recommended={plan.id === 'pro'}
                  onSelect={() => handlePurchase(plan.id)}
                  purchasing={purchasing}
                />
              ))}
            </div>
          </div>

          <div className="dashboard-card p-5 text-[13px] leading-relaxed text-theme-muted">
            <span className="font-semibold text-theme-fg">How storage billing works</span>
            <ul className="mt-2.5 space-y-2">
              <li className="flex gap-2"><span className="text-theme-muted">•</span> Every account includes ~250&nbsp;MB of free cloud storage.</li>
              <li className="flex gap-2"><span className="text-theme-muted">•</span> Paid plans are a flat monthly credit fee for a bigger VM disk and more cloud storage — not metered by usage.</li>
              <li className="flex gap-2"><span className="text-theme-muted">•</span> Only your running VM (compute) is billed by the hour. Stopping it stops compute charges.</li>
              <li className="flex gap-2"><span className="text-theme-muted">•</span> Low on credits? There's a grace period before any downgrade — your files are never deleted.</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
