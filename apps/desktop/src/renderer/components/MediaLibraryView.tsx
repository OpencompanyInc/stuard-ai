import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  ExternalLink,
  File,
  Film,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  Music,
  RefreshCw,
  Search,
  Upload,
  X,
} from 'lucide-react';
import { AudioPlayer } from './AudioPlayer';
import {
  useMediaLibrary,
  type MediaKind,
  type MediaLibraryItem,
  type MediaSyncMode,
  type MediaSyncStatus,
} from '../hooks/useMediaLibrary';

type FilterValue<T extends string> = T | 'all';

const syncBadge: Record<MediaSyncStatus, string> = {
  'local-only': 'bg-amber-500/10 text-amber-200 border-amber-400/20',
  pending: 'bg-blue-500/10 text-blue-200 border-blue-400/20',
  synced: 'bg-emerald-500/10 text-emerald-200 border-emerald-400/20',
  'cloud-only': 'bg-sky-500/10 text-sky-200 border-sky-400/20',
  failed: 'bg-red-500/10 text-red-200 border-red-400/20',
};

const kindOptions: Array<{ value: FilterValue<MediaKind>; label: string }> = [
  { value: 'all', label: 'All media' },
  { value: 'image', label: 'Images' },
  { value: 'video', label: 'Video' },
  { value: 'audio', label: 'Audio' },
  { value: 'document', label: 'Documents' },
  { value: 'unknown', label: 'Other' },
];

const syncOptions: Array<{ value: FilterValue<MediaSyncStatus>; label: string }> = [
  { value: 'all', label: 'Any sync state' },
  { value: 'local-only', label: 'Local only' },
  { value: 'pending', label: 'Pending sync' },
  { value: 'synced', label: 'Synced' },
  { value: 'cloud-only', label: 'Cloud only' },
  { value: 'failed', label: 'Sync failed' },
];

function bytes(value: number | null | undefined) {
  if (!value || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const scaled = value / Math.pow(1024, index);
  return `${scaled >= 10 || index === 0 ? scaled.toFixed(0) : scaled.toFixed(1)} ${units[index]}`;
}

function ago(value: string | null | undefined) {
  if (!value) return 'Unknown';
  const diff = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(diff)) return 'Unknown';
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(value).toLocaleDateString();
}

function label(value: string) {
  return String(value || '').split(/[-_\s]+/).filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join(' ');
}

function sourceLabel(value: string) {
  const aliases: Record<string, string> = {
    generated: 'Generated',
    screenshots: 'Screenshots',
    'screen-recordings': 'Screen recordings',
    'screen-audio': 'Screen audio',
    'message-media': 'Telnyx / MMS',
    imports: 'Imports',
    photos: 'Photos',
    'audio-recordings': 'Audio recordings',
    'video-recordings': 'Video recordings',
    'generated-audio': 'Generated audio',
  };
  return aliases[value] || label(value);
}

function syncLabel(value: MediaSyncStatus) {
  return value === 'local-only' ? 'Local only' : value === 'cloud-only' ? 'Cloud only' : label(value);
}

function mediaSrc(value: string) {
  if (!value) return '';
  if (/^(https?:|data:|local-file:)/i.test(value)) return value;
  if (/^file:/i.test(value)) return value.replace(/^file:/i, 'local-file:');
  const normalized = value.replace(/\\/g, '/');
  const encodePath = (input: string, keepDrive: boolean) => input.split('/').map((part, index) => {
    if (keepDrive && index === 0 && /^[a-zA-Z]:$/.test(part)) return part;
    return encodeURIComponent(part);
  }).join('/');
  if (/^[a-zA-Z]:\//.test(normalized)) return `local-file:///${encodePath(normalized, true)}`;
  if (normalized.startsWith('/')) return `local-file://${encodePath(normalized, false)}`;
  return `local-file:///${encodePath(normalized, false)}`;
}

function previewSrc(item: MediaLibraryItem) {
  return item.localPath ? mediaSrc(item.localPath) : (item.remoteUrl || '');
}

function kindIcon(kind: MediaKind, className = 'h-4 w-4') {
  if (kind === 'image') return <ImageIcon className={className} />;
  if (kind === 'video') return <Film className={className} />;
  if (kind === 'audio') return <Music className={className} />;
  return <File className={className} />;
}

export function MediaLibraryView() {
  const { items, summary, prefs, loading, syncing, importing, error, refresh, sync, updateSyncMode, importPaths } = useMediaLibrary();
  const [query, setQuery] = useState('');
  const search = useDeferredValue(query.trim().toLowerCase());
  const [kindFilter, setKindFilter] = useState<FilterValue<MediaKind>>('all');
  const [sourceFilter, setSourceFilter] = useState<FilterValue<string>>('all');
  const [syncFilter, setSyncFilter] = useState<FilterValue<MediaSyncStatus>>('all');
  const [classificationFilter, setClassificationFilter] = useState<FilterValue<string>>('all');
  const [selected, setSelected] = useState<MediaLibraryItem | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastRef = useRef<number | null>(null);

  const showToast = useCallback((message: string) => {
    if (toastRef.current !== null) window.clearTimeout(toastRef.current);
    setToast(message);
    toastRef.current = window.setTimeout(() => {
      setToast(null);
      toastRef.current = null;
    }, 3200);
  }, []);

  useEffect(() => () => {
    if (toastRef.current !== null) window.clearTimeout(toastRef.current);
  }, []);

  const sources = useMemo(() => ['all', ...Array.from(new Set(items.map((item) => item.source))).sort()], [items]);
  const classifications = useMemo(() => ['all', ...Array.from(new Set(items.map((item) => item.classification))).sort()], [items]);
  const filtered = useMemo(() => items.filter((item) => {
    if (kindFilter !== 'all' && item.kind !== kindFilter) return false;
    if (sourceFilter !== 'all' && item.source !== sourceFilter) return false;
    if (syncFilter !== 'all' && item.syncStatus !== syncFilter) return false;
    if (classificationFilter !== 'all' && item.classification !== classificationFilter) return false;
    if (!search) return true;
    return [item.name, item.classification, item.source, ...(item.tags || [])].join(' ').toLowerCase().includes(search);
  }), [items, kindFilter, sourceFilter, syncFilter, classificationFilter, search]);

  const importMedia = useCallback(async () => {
    const picked = await window.desktopAPI.pickFiles({ multiple: true, title: 'Import media into library' });
    if (!picked.ok) return showToast(picked.error || 'Could not open file picker');
    const paths = (picked.files || []).map((file) => file.path).filter(Boolean);
    if (paths.length === 0) return;
    const result = await importPaths(paths);
    if (!result.ok) return showToast(result.error || 'Import failed');
    const importedCount = result.items?.length || 0;
    showToast(importedCount > 0 ? `Imported ${importedCount} media item${importedCount === 1 ? '' : 's'}` : 'No new media imported');
  }, [importPaths, showToast]);

  const syncAll = useCallback(async () => {
    const result = await sync();
    if (!result.ok) return showToast(result.error || 'Sync failed');
    if ((result.synced || 0) > 0) return showToast(`Synced ${result.synced} media item${result.synced === 1 ? '' : 's'} to Stuard`);
    showToast((result.failed || 0) > 0 ? `Sync finished with ${result.failed} failed item${result.failed === 1 ? '' : 's'}` : 'Media library is already up to date');
  }, [showToast, sync]);

  const setMode = useCallback(async (mode: MediaSyncMode) => {
    const result = await updateSyncMode(mode);
    if (!result.ok) return showToast(result.error || 'Could not update sync mode');
    showToast(mode === 'mirror-cloud' ? 'Stuard mirroring enabled' : 'Media library set to local-only');
  }, [showToast, updateSyncMode]);

  const openItem = useCallback(async (item: MediaLibraryItem) => {
    if (item.localPath) {
      const result = await window.desktopAPI.mediaOpenPath(item.localPath);
      if (!result.ok) showToast(result.error || 'Could not open media');
      return;
    }
    if (item.remoteUrl) await window.desktopAPI.openExternal(item.remoteUrl);
  }, [showToast]);

  const revealItem = useCallback(async (item: MediaLibraryItem) => {
    if (!item.localPath) return;
    const result = await window.desktopAPI.showItemInFolder(item.localPath);
    if (!result.ok) showToast(result.error || 'Could not reveal file');
  }, [showToast]);

  const syncItem = useCallback(async (item: MediaLibraryItem) => {
    const result = await sync([item.id]);
    if (!result.ok) return showToast(result.error || `Could not sync ${item.name}`);
    showToast((result.synced || 0) > 0 ? `Synced ${item.name}` : `${item.name} is already synced`);
  }, [showToast, sync]);

  if (loading) {
    return <div className="flex h-[48vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="dashboard-card-accent border border-[color:var(--dashboard-panel-border)] p-6">
        <div className="relative z-10 flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-theme-muted">
              <ImageIcon className="h-3.5 w-3.5 text-primary" />
              Unified Media
            </div>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-theme-fg">Generated images, recordings, screenshots, and message attachments in one gallery.</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-theme-muted">Stuard can keep media local or mirror library copies into Stuard storage. Telnyx MMS and other incoming attachments land here too when they are captured by the app.</p>
          </div>
          <div className="dashboard-card w-full max-w-md p-4">
            <p className="text-sm font-semibold text-theme-fg">Storage mode</p>
            <p className="mt-1 text-xs text-theme-muted">{prefs.syncMode === 'mirror-cloud' ? 'New media is mirrored to Stuard storage.' : 'Media stays local until you sync it.'}</p>
            <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-theme-hover/40 p-1">
              {(['local-only', 'mirror-cloud'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => void setMode(mode)}
                  disabled={syncing}
                  className={clsx('rounded-[16px] px-4 py-3 text-left transition-all', prefs.syncMode === mode ? 'bg-theme-bg text-theme-fg shadow-sm' : 'text-theme-muted hover:bg-white/5 hover:text-theme-fg')}
                >
                  <div className="text-xs font-semibold">{mode === 'local-only' ? 'Local only' : 'Mirror to Stuard'}</div>
                  <div className="mt-1 text-[11px] leading-5 opacity-80">{mode === 'local-only' ? 'Keep files on this device.' : 'Push library copies to cloud storage.'}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {toast && <div className="flex items-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200"><CheckCircle2 className="h-4 w-4 shrink-0" />{toast}</div>}
      {error && <div className="flex items-center gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200"><AlertCircle className="h-4 w-4 shrink-0" />{error}</div>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="dashboard-card p-4"><div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-theme-muted">Assets</div><div className="mt-2 text-2xl font-semibold text-theme-fg">{summary.total}</div><div className="mt-1 text-xs text-theme-muted">{filtered.length} visible with current filters</div></div>
        <div className="dashboard-card p-4"><div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-theme-muted">Library Size</div><div className="mt-2 text-2xl font-semibold text-theme-fg">{bytes(summary.totalBytes)}</div><div className="mt-1 text-xs text-theme-muted">Managed library copies on disk</div></div>
        <div className="dashboard-card p-4"><div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-theme-muted">Synced</div><div className="mt-2 text-2xl font-semibold text-theme-fg">{summary.synced}</div><div className="mt-1 text-xs text-theme-muted">{summary.pending} pending, {summary.failed} failed</div></div>
        <div className="dashboard-card p-4"><div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-theme-muted">Sources</div><div className="mt-2 text-2xl font-semibold text-theme-fg">{Object.keys(summary.bySource || {}).length}</div><div className="mt-1 text-xs text-theme-muted">{Object.entries(summary.bySource || {}).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([name, count]) => `${sourceLabel(name)} ${count}`).join(' | ') || 'No sources yet'}</div></div>
      </div>

      <div className="dashboard-card p-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="grid flex-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
            <label className="relative block xl:col-span-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-theme-muted" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search names, tags, or sources" className="w-full rounded-2xl border border-theme/10 bg-theme-hover/50 py-3 pl-10 pr-4 text-sm text-theme-fg placeholder:text-theme-muted/70 focus:border-primary/40 focus:outline-none" />
            </label>
            <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as FilterValue<MediaKind>)} className="rounded-2xl border border-theme/10 bg-theme-hover/50 px-4 py-3 text-sm text-theme-fg focus:border-primary/40 focus:outline-none">{kindOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
            <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} className="rounded-2xl border border-theme/10 bg-theme-hover/50 px-4 py-3 text-sm text-theme-fg focus:border-primary/40 focus:outline-none">{sources.map((option) => <option key={option} value={option}>{option === 'all' ? 'Any source' : sourceLabel(option)}</option>)}</select>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-2">
              <select value={syncFilter} onChange={(event) => setSyncFilter(event.target.value as FilterValue<MediaSyncStatus>)} className="rounded-2xl border border-theme/10 bg-theme-hover/50 px-4 py-3 text-sm text-theme-fg focus:border-primary/40 focus:outline-none">{syncOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
              <select value={classificationFilter} onChange={(event) => setClassificationFilter(event.target.value)} className="rounded-2xl border border-theme/10 bg-theme-hover/50 px-4 py-3 text-sm text-theme-fg focus:border-primary/40 focus:outline-none">{classifications.map((option) => <option key={option} value={option}>{option === 'all' ? 'Any classification' : option}</option>)}</select>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void refresh()} className="dashboard-button-secondary flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-medium"><RefreshCw className="h-4 w-4" />Refresh</button>
            <button type="button" onClick={() => void importMedia()} disabled={importing} className="dashboard-button-secondary flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-medium disabled:opacity-60">{importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}Import</button>
            <button type="button" onClick={() => void syncAll()} disabled={syncing} className="dashboard-button-primary flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold disabled:opacity-60">{syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}Sync to Stuard</button>
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="dashboard-card p-12 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[24px] bg-primary/10 text-primary">
            <FolderOpen className="h-8 w-8" />
          </div>
          <h3 className="mt-5 text-xl font-semibold text-theme-fg">No media matches these filters.</h3>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-theme-muted">Import something, clear a filter, or create a screenshot to populate the gallery.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {filtered.map((item) => {
            const src = previewSrc(item);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelected(item)}
                className="dashboard-card overflow-hidden text-left transition-transform duration-200 hover:-translate-y-1"
              >
                <div className="relative aspect-[4/3] overflow-hidden bg-black/30">
                  {item.kind === 'image' && src ? <img src={src} alt={item.name} className="h-full w-full object-cover" loading="lazy" /> : null}
                  {item.kind === 'video' && src ? <video src={src} muted playsInline preload="metadata" className="h-full w-full object-cover" /> : null}
                  {(item.kind === 'audio' || !src || (item.kind !== 'image' && item.kind !== 'video')) ? (
                    <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_top,color-mix(in_srgb,var(--primary)_18%,transparent),transparent_55%),linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))]">
                      <div className="flex flex-col items-center gap-3 text-theme-fg/80">
                        <div className="flex h-16 w-16 items-center justify-center rounded-3xl border border-white/10 bg-black/20">
                          {kindIcon(item.kind, 'h-8 w-8')}
                        </div>
                        <span className="text-xs font-medium text-theme-muted">{item.kind === 'audio' ? 'Audio preview' : 'Preview unavailable'}</span>
                      </div>
                    </div>
                  ) : null}
                  <div className="absolute left-3 top-3">
                    <span className="rounded-full border border-white/10 bg-black/35 px-2.5 py-1 text-[11px] font-medium text-white/90 backdrop-blur-sm">{item.classification}</span>
                  </div>
                  <div className="absolute right-3 top-3">
                    <span className={clsx('rounded-full border px-2.5 py-1 text-[11px] font-medium backdrop-blur-sm', syncBadge[item.syncStatus])}>{syncLabel(item.syncStatus)}</span>
                  </div>
                </div>

                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-theme-muted">{sourceLabel(item.source)}</p>
                      <h3 className="mt-1 truncate text-base font-semibold text-theme-fg">{item.name}</h3>
                    </div>
                    <div className="mt-1 rounded-xl bg-primary/10 p-2 text-primary">{kindIcon(item.kind)}</div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-theme-muted">
                    <span>{bytes(item.sizeBytes)}</span>
                    <span>|</span>
                    <span>{ago(item.updatedAt || item.createdAt)}</span>
                    {item.tags.slice(0, 2).map((tag) => <span key={tag} className="rounded-full bg-theme-hover/60 px-2 py-1">{label(tag)}</span>)}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" onClick={(event) => { event.stopPropagation(); void openItem(item); }} className="dashboard-button-secondary rounded-xl px-3 py-2 text-xs font-medium">Open</button>
                    {item.localPath ? <button type="button" onClick={(event) => { event.stopPropagation(); void revealItem(item); }} className="dashboard-button-secondary rounded-xl px-3 py-2 text-xs font-medium">Reveal</button> : null}
                    {item.localPath && item.syncStatus !== 'synced' && prefs.syncMode === 'mirror-cloud' ? <button type="button" onClick={(event) => { event.stopPropagation(); void syncItem(item); }} className="dashboard-button-primary rounded-xl px-3 py-2 text-xs font-medium">Sync now</button> : null}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selected ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setSelected(null)}>
          <div className="dashboard-card relative max-h-[92vh] w-full max-w-6xl overflow-hidden" onClick={(event) => event.stopPropagation()}>
            <button type="button" onClick={() => setSelected(null)} className="absolute right-4 top-4 z-10 rounded-full bg-black/40 p-2 text-white/80 backdrop-blur-sm transition hover:text-white">
              <X className="h-4 w-4" />
            </button>

            <div className="grid max-h-[92vh] lg:grid-cols-[minmax(0,1.6fr)_360px]">
              <div className="flex min-h-[420px] items-center justify-center bg-[radial-gradient(circle_at_top,color-mix(in_srgb,var(--primary)_16%,transparent),transparent_55%),#0b0b0c] p-6">
                {selected.kind === 'image' && previewSrc(selected) ? <img src={previewSrc(selected)} alt={selected.name} className="max-h-[70vh] max-w-full rounded-[24px] object-contain shadow-2xl" /> : null}
                {selected.kind === 'video' && previewSrc(selected) ? <video src={previewSrc(selected)} controls playsInline className="max-h-[70vh] w-full rounded-[24px] bg-black object-contain shadow-2xl" /> : null}
                {selected.kind === 'audio' && previewSrc(selected) ? <AudioPlayer src={previewSrc(selected)} className="max-w-xl" /> : null}
                {(selected.kind === 'document' || selected.kind === 'unknown' || !previewSrc(selected)) ? (
                  <div className="flex max-w-md flex-col items-center gap-4 rounded-[28px] border border-white/10 bg-white/5 px-10 py-12 text-center">
                    <div className="flex h-20 w-20 items-center justify-center rounded-[28px] bg-white/5 text-theme-fg">{kindIcon(selected.kind, 'h-10 w-10')}</div>
                    <div>
                      <p className="text-lg font-semibold text-theme-fg">{selected.name}</p>
                      <p className="mt-2 text-sm text-theme-muted">Open the original file to inspect this media item in its native app.</p>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="overflow-y-auto border-l border-theme/10 p-6">
                <p className="text-[11px] uppercase tracking-[0.18em] text-theme-muted">{selected.classification}</p>
                <h3 className="mt-2 text-2xl font-semibold text-theme-fg">{selected.name}</h3>
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="rounded-full bg-theme-hover/60 px-3 py-1 text-xs text-theme-fg">{sourceLabel(selected.source)}</span>
                  <span className={clsx('rounded-full border px-3 py-1 text-xs', syncBadge[selected.syncStatus])}>{syncLabel(selected.syncStatus)}</span>
                </div>

                <div className="mt-6 space-y-1">
                  <div className="flex items-start justify-between gap-3 border-b border-white/5 py-2 text-sm"><span className="text-theme-muted">Kind</span><span className="text-right text-theme-fg">{label(selected.kind)}</span></div>
                  <div className="flex items-start justify-between gap-3 border-b border-white/5 py-2 text-sm"><span className="text-theme-muted">Created</span><span className="text-right text-theme-fg">{new Date(selected.createdAt).toLocaleString()}</span></div>
                  <div className="flex items-start justify-between gap-3 border-b border-white/5 py-2 text-sm"><span className="text-theme-muted">Updated</span><span className="text-right text-theme-fg">{new Date(selected.updatedAt || selected.createdAt).toLocaleString()}</span></div>
                  <div className="flex items-start justify-between gap-3 border-b border-white/5 py-2 text-sm"><span className="text-theme-muted">Size</span><span className="text-right text-theme-fg">{bytes(selected.sizeBytes)}</span></div>
                  <div className="flex items-start justify-between gap-3 border-b border-white/5 py-2 text-sm"><span className="text-theme-muted">Extension</span><span className="text-right text-theme-fg">{selected.extension || 'Unknown'}</span></div>
                  <div className="flex items-start justify-between gap-3 border-b border-white/5 py-2 text-sm"><span className="text-theme-muted">Synced</span><span className="text-right text-theme-fg">{selected.syncedAt ? new Date(selected.syncedAt).toLocaleString() : 'Not yet'}</span></div>
                </div>

                {selected.tags.length > 0 ? <div className="mt-6 flex flex-wrap gap-2">{selected.tags.map((tag) => <span key={tag} className="rounded-full bg-theme-hover/60 px-3 py-1 text-xs text-theme-fg">{label(tag)}</span>)}</div> : null}
                {selected.syncError ? <div className="mt-6 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200"><div className="flex items-center gap-2"><AlertCircle className="h-4 w-4 shrink-0" /><span>{selected.syncError}</span></div></div> : null}

                <div className="mt-6 space-y-2">
                  <button type="button" onClick={() => void openItem(selected)} className="dashboard-button-primary flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold"><ExternalLink className="h-4 w-4" />Open media</button>
                  {selected.localPath ? <button type="button" onClick={() => void revealItem(selected)} className="dashboard-button-secondary flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-medium"><FolderOpen className="h-4 w-4" />Reveal in folder</button> : null}
                  {selected.localPath && selected.syncStatus !== 'synced' && prefs.syncMode === 'mirror-cloud' ? <button type="button" onClick={() => void syncItem(selected)} className="dashboard-button-secondary flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-medium"><Cloud className="h-4 w-4" />Sync this item</button> : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
