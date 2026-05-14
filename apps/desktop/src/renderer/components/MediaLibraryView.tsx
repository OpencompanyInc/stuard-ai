import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  File,
  Film,
  FolderOpen,
  Grid3X3,
  Image as ImageIcon,
  LayoutList,
  Loader2,
  MessageSquare,
  Mic,
  Monitor,
  Music,
  Pause,
  Play,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  useMediaLibrary,
  type MediaKind,
  type MediaLibraryItem,
} from '../hooks/useMediaLibrary';

/* ────────────────────────── Category System ────────────────────────── */

interface CategoryDef {
  id: string;
  label: string;
  icon: React.ElementType;
  color: string;
  match: (item: MediaLibraryItem) => boolean;
}

const CATEGORIES: CategoryDef[] = [
  { id: 'all', label: 'All Media', icon: Grid3X3, color: 'text-primary', match: () => true },
  { id: 'images', label: 'Images', icon: ImageIcon, color: 'text-blue-400', match: (i) => i.kind === 'image' && !i.source.includes('screenshot') && i.source !== 'generated' },
  { id: 'videos', label: 'Videos', icon: Film, color: 'text-purple-400', match: (i) => i.kind === 'video' && !i.source.includes('screen') },
  { id: 'audio', label: 'Audio', icon: Music, color: 'text-amber-400', match: (i) => i.kind === 'audio' },
  { id: 'recordings', label: 'Recordings', icon: Mic, color: 'text-red-400', match: (i) => ['audio-recordings', 'video-recordings'].includes(i.source) || i.classification?.toLowerCase().includes('capture') },
  { id: 'screenshots', label: 'Screenshots', icon: Monitor, color: 'text-cyan-400', match: (i) => i.source === 'screenshots' || i.classification === 'Screenshot' || i.source === 'screen-recordings' || i.source === 'screen-audio' },
  { id: 'generated', label: 'AI Generated', icon: Sparkles, color: 'text-violet-400', match: (i) => i.source === 'generated' || i.source === 'generated-audio' || i.classification?.toLowerCase().includes('generated') },
  { id: 'messages', label: 'Messages', icon: MessageSquare, color: 'text-green-400', match: (i) => i.source === 'message-media' || i.tags?.some((t) => ['telnyx', 'whatsapp', 'message-media'].includes(t)) },
  { id: 'misc', label: 'Other', icon: File, color: 'text-gray-400', match: (i) => !CATEGORIES.slice(1, -1).some((c) => c.match(i)) },
];

/* ────────────────────────── Helpers ────────────────────────── */

function bytes(value: number | null | undefined) {
  if (!value || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const scaled = value / Math.pow(1024, index);
  return `${scaled >= 10 || index === 0 ? scaled.toFixed(0) : scaled.toFixed(1)} ${units[index]}`;
}

function ago(value: string | null | undefined) {
  if (!value) return '';
  const diff = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(diff)) return '';
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
    generated: 'AI Generated',
    screenshots: 'Screenshots',
    'screen-recordings': 'Screen Recordings',
    'screen-audio': 'Screen Audio',
    'message-media': 'Messages',
    imports: 'Imported',
    photos: 'Photos',
    'audio-recordings': 'Audio Recordings',
    'video-recordings': 'Video Recordings',
    'generated-audio': 'AI Audio',
    misc: 'Miscellaneous',
  };
  return aliases[value] || label(value);
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

function formatTime(time: number) {
  if (!Number.isFinite(time) || time < 0) return '0:00';
  const m = Math.floor(time / 60);
  const s = Math.floor(time % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/* ────────────────────────── Inline Audio Player ────────────────────────── */

function InlineAudioPlayer({ src, name }: { src: string; name: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [muted, setMuted] = useState(false);
  const [err, setErr] = useState(false);

  const safeDur = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const safeCur = Number.isFinite(current) && current >= 0 ? current : 0;

  const toggle = () => {
    if (!ref.current) return;
    if (playing) { ref.current.pause(); } else {
      ref.current.play().catch(() => setErr(true));
    }
  };

  if (err) return <div className="flex items-center gap-2 text-sm text-red-400"><AlertCircle className="h-4 w-4" />Failed to load audio</div>;

  return (
    <div className="w-full max-w-lg space-y-4">
      <div className="flex items-center gap-4">
        <button onClick={toggle} className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary text-white shadow-lg transition hover:scale-105 active:scale-95">
          {playing ? <Pause className="h-6 w-6 fill-current" /> : <Play className="h-6 w-6 fill-current ml-0.5" />}
        </button>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="truncate text-sm font-medium text-theme-fg">{name}</p>
          <input type="range" min={0} max={safeDur || 1} value={safeDur > 0 ? Math.min(safeCur, safeDur) : 0} onChange={(e) => { if (ref.current && safeDur > 0) { ref.current.currentTime = parseFloat(e.target.value); setCurrent(parseFloat(e.target.value)); } }} className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-md" />
          <div className="flex items-center justify-between text-[11px] text-theme-muted font-mono">
            <span>{formatTime(safeCur)}</span>
            <span>{safeDur > 0 ? formatTime(safeDur) : '--:--'}</span>
          </div>
        </div>
        <button onClick={() => { if (ref.current) { ref.current.muted = !muted; setMuted(!muted); } }} className="p-2 text-theme-muted hover:text-theme-fg transition">
          {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
        </button>
      </div>
      <audio ref={ref} src={src} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onTimeUpdate={() => ref.current && setCurrent(ref.current.currentTime)} onLoadedMetadata={() => { if (ref.current) { const d = ref.current.duration; setDuration(Number.isFinite(d) ? d : 0); } }} onEnded={() => { setPlaying(false); setCurrent(0); if (ref.current) ref.current.currentTime = 0; }} onError={() => setErr(true)} className="hidden" />
    </div>
  );
}

/* ────────────────────────── Media Lightbox ────────────────────────── */

function MediaLightbox({
  item,
  items,
  onClose,
  onNavigate,
  onOpen,
  onReveal,
  onDelete,
}: {
  item: MediaLibraryItem;
  items: MediaLibraryItem[];
  onClose: () => void;
  onNavigate: (item: MediaLibraryItem) => void;
  onOpen: (item: MediaLibraryItem) => void;
  onReveal: (item: MediaLibraryItem) => void;
  onDelete: (item: MediaLibraryItem) => void;
}) {
  const idx = items.findIndex((i) => i.id === item.id);
  const prev = idx > 0 ? items[idx - 1] : null;
  const next = idx < items.length - 1 ? items[idx + 1] : null;
  const src = previewSrc(item);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && prev) onNavigate(prev);
      if (e.key === 'ArrowRight' && next) onNavigate(next);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [prev, next, onClose, onNavigate]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md" onClick={onClose}>
      <div className="relative flex h-full w-full max-w-[1600px] flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Top bar */}
        <div className="flex items-center justify-between px-6 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-[0.16em] text-white/50">{item.classification} — {sourceLabel(item.source)}</p>
            <h3 className="mt-1 truncate text-lg font-semibold text-white">{item.name}</h3>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/40">{bytes(item.sizeBytes)} — {ago(item.updatedAt || item.createdAt)}</span>
            <button onClick={() => onOpen(item)} className="rounded-xl bg-white/10 px-3 py-2 text-xs font-medium text-white/80 hover:bg-white/20 transition"><ExternalLink className="inline h-3.5 w-3.5 mr-1" />Open</button>
            {item.localPath && <button onClick={() => onReveal(item)} className="rounded-xl bg-white/10 px-3 py-2 text-xs font-medium text-white/80 hover:bg-white/20 transition"><FolderOpen className="inline h-3.5 w-3.5 mr-1" />Reveal</button>}
            <button onClick={() => onDelete(item)} className="rounded-xl bg-red-500/20 px-3 py-2 text-xs font-medium text-red-300 hover:bg-red-500/30 transition"><Trash2 className="inline h-3.5 w-3.5 mr-1" />Delete</button>
            <button onClick={onClose} className="rounded-full bg-white/10 p-2 text-white/70 hover:bg-white/20 hover:text-white transition"><X className="h-5 w-5" /></button>
          </div>
        </div>

        {/* Main viewer */}
        <div className="relative flex flex-1 items-center justify-center overflow-hidden px-16">
          {/* Prev button */}
          {prev && (
            <button onClick={() => onNavigate(prev)} className="absolute left-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/70 hover:bg-white/20 hover:text-white transition">
              <ChevronLeft className="h-6 w-6" />
            </button>
          )}

          {/* Content */}
          {item.kind === 'image' && src && (
            <img src={src} alt={item.name} className="max-h-[calc(100vh-180px)] max-w-full rounded-2xl object-contain shadow-2xl" />
          )}
          {item.kind === 'video' && src && (
            <video key={item.id} src={src} controls autoPlay playsInline className="max-h-[calc(100vh-180px)] max-w-full rounded-2xl bg-black object-contain shadow-2xl" />
          )}
          {item.kind === 'audio' && src && (
            <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur-sm">
              <div className="mb-4 flex justify-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-primary/20 text-primary">
                  <Music className="h-10 w-10" />
                </div>
              </div>
              <InlineAudioPlayer src={src} name={item.name} />
            </div>
          )}
          {(item.kind === 'document' || item.kind === 'unknown' || !src) && (
            <div className="flex max-w-md flex-col items-center gap-4 rounded-3xl border border-white/10 bg-white/5 px-10 py-12 text-center backdrop-blur-sm">
              <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-white/5 text-white/80">{kindIcon(item.kind, 'h-10 w-10')}</div>
              <p className="text-lg font-semibold text-white">{item.name}</p>
              <p className="text-sm text-white/50">Open with native app to view this file.</p>
            </div>
          )}

          {/* Next button */}
          {next && (
            <button onClick={() => onNavigate(next)} className="absolute right-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/70 hover:bg-white/20 hover:text-white transition">
              <ChevronRight className="h-6 w-6" />
            </button>
          )}
        </div>

        {/* Bottom info bar */}
        <div className="flex items-center justify-between px-6 py-3">
          <div className="flex flex-wrap gap-1.5">
            {item.tags.slice(0, 6).map((tag) => <span key={tag} className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] text-white/60">{label(tag)}</span>)}
          </div>
          <span className="text-xs text-white/30">{idx + 1} / {items.length}</span>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────── Thumbnail Card ────────────────────────── */

function MediaCard({ item, viewMode, onClick }: { item: MediaLibraryItem; viewMode: 'grid' | 'list'; onClick: () => void }) {
  const src = previewSrc(item);
  const hasVisualPreview = (item.kind === 'image' || item.kind === 'video') && !!src;

  if (viewMode === 'list') {
    return (
      <button type="button" onClick={onClick} className="dashboard-card flex items-center gap-4 p-3 text-left transition hover:bg-theme-hover/40">
        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-black/30">
          {item.kind === 'image' && src ? <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" /> : item.kind === 'video' && src ? <video src={src} muted preload="metadata" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-theme-muted">{kindIcon(item.kind, 'h-5 w-5')}</div>}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-theme-fg">{item.name}</p>
          <p className="mt-0.5 text-xs text-theme-muted">{item.classification} — {bytes(item.sizeBytes)} — {ago(item.updatedAt || item.createdAt)}</p>
        </div>
        <div className="shrink-0 text-theme-muted">{kindIcon(item.kind)}</div>
      </button>
    );
  }

  return (
    <button type="button" onClick={onClick} className="dashboard-card group overflow-hidden text-left transition-transform duration-200 hover:-translate-y-0.5">
      <div className="relative aspect-[4/3] overflow-hidden bg-black/30">
        {item.kind === 'image' && src ? <img src={src} alt={item.name} className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" loading="lazy" /> : null}
        {item.kind === 'video' && src ? (
          <div className="relative h-full w-full">
            <video src={src} muted playsInline preload="metadata" className="h-full w-full object-cover" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm"><Play className="h-5 w-5 fill-current ml-0.5" /></div>
            </div>
          </div>
        ) : null}
        {!hasVisualPreview ? (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-theme-hover/80 to-theme-hover/30">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-black/20 text-theme-muted">
              {kindIcon(item.kind, 'h-7 w-7')}
            </div>
          </div>
        ) : null}
        <div className="absolute left-2 top-2">
          <span className="rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-medium text-white/90 backdrop-blur-sm">{item.classification}</span>
        </div>
      </div>
      <div className="p-3">
        <p className="truncate text-sm font-medium text-theme-fg">{item.name}</p>
        <div className="mt-1.5 flex items-center gap-2 text-[11px] text-theme-muted">
          <span>{bytes(item.sizeBytes)}</span>
          <span className="opacity-40">·</span>
          <span>{ago(item.updatedAt || item.createdAt)}</span>
        </div>
      </div>
    </button>
  );
}

/* ────────────────────────── Main Component ────────────────────────── */

export function MediaLibraryView() {
  const { items, summary, prefs, loading, importing, error, refresh, importPaths, deleteItem, updateStorageRoot } = useMediaLibrary();
  const [query, setQuery] = useState('');
  const search = useDeferredValue(query.trim().toLowerCase());
  const [activeCategory, setActiveCategory] = useState('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [lightboxItem, setLightboxItem] = useState<MediaLibraryItem | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastRef = useRef<number | null>(null);

  const showToast = useCallback((message: string) => {
    if (toastRef.current !== null) window.clearTimeout(toastRef.current);
    setToast(message);
    toastRef.current = window.setTimeout(() => { setToast(null); toastRef.current = null; }, 3200);
  }, []);

  useEffect(() => () => { if (toastRef.current !== null) window.clearTimeout(toastRef.current); }, []);

  const activeCategoryDef = CATEGORIES.find((c) => c.id === activeCategory) || CATEGORIES[0];

  const filtered = useMemo(() => {
    let result = items;
    if (activeCategory !== 'all') {
      const cat = CATEGORIES.find((c) => c.id === activeCategory);
      if (cat) result = result.filter(cat.match);
    }
    if (search) {
      result = result.filter((item) =>
        [item.name, item.classification, item.source, ...(item.tags || [])].join(' ').toLowerCase().includes(search)
      );
    }
    return result;
  }, [items, activeCategory, search]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const cat of CATEGORIES) {
      counts[cat.id] = cat.id === 'all' ? items.length : items.filter(cat.match).length;
    }
    return counts;
  }, [items]);

  const importMedia = useCallback(async () => {
    const picked = await window.desktopAPI.pickFiles({ multiple: true, title: 'Import media into library' });
    if (!picked.ok) return showToast(picked.error || 'Could not open file picker');
    const paths = (picked.files || []).map((f) => f.path).filter(Boolean);
    if (paths.length === 0) return;
    const result = await importPaths(paths);
    if (!result.ok) return showToast(result.error || 'Import failed');
    showToast(`Imported ${result.items?.length || 0} item(s)`);
  }, [importPaths, showToast]);

  const openMediaFolder = useCallback(async () => {
    const root = prefs.resolvedStorageRootPath;
    if (!root) return;
    const result = await window.desktopAPI.mediaOpenPath(root);
    if (!result.ok) showToast(result.error || 'Could not open media folder');
  }, [prefs.resolvedStorageRootPath, showToast]);

  const changeMediaFolder = useCallback(async () => {
    const picked = await window.desktopAPI.pickFolder({ title: 'Choose media library folder' });
    if (!picked.ok) return showToast(picked.error || 'Could not open folder picker');
    const folder = picked.folders?.[0]?.path;
    if (!folder) return;
    const result = await updateStorageRoot(folder);
    if (!result.ok) return showToast(result.error || 'Could not update media folder');
    showToast('Media folder updated');
  }, [showToast, updateStorageRoot]);

  const resetMediaFolder = useCallback(async () => {
    const result = await updateStorageRoot(null);
    if (!result.ok) return showToast(result.error || 'Could not reset media folder');
    showToast('Media folder reset');
  }, [showToast, updateStorageRoot]);

  const openItem = useCallback(async (item: MediaLibraryItem) => {
    if (item.localPath) {
      const result = await window.desktopAPI.mediaOpenPath(item.localPath);
      if (!result.ok) showToast(result.error || 'Could not open');
      return;
    }
    if (item.remoteUrl) await window.desktopAPI.openExternal(item.remoteUrl);
  }, [showToast]);

  const revealItem = useCallback(async (item: MediaLibraryItem) => {
    if (!item.localPath) return;
    const result = await window.desktopAPI.showItemInFolder(item.localPath);
    if (!result.ok) showToast(result.error || 'Could not reveal');
  }, [showToast]);

  const handleDelete = useCallback(async (item: MediaLibraryItem) => {
    const result = await deleteItem(item.id);
    if (!result.ok) return showToast(result.error || 'Delete failed');
    showToast(`Deleted ${item.name}`);
    if (lightboxItem?.id === item.id) setLightboxItem(null);
  }, [deleteItem, lightboxItem, showToast]);

  if (loading) {
    return <div className="flex h-[48vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  return (
    <div className="flex gap-6">
      {/* ─── Category Sidebar ─── */}
      <div className="hidden w-52 shrink-0 lg:block">
        <div className="sticky top-0 space-y-1">
          {CATEGORIES.map((cat) => {
            const count = categoryCounts[cat.id] || 0;
            const Icon = cat.icon;
            const active = activeCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setActiveCategory(cat.id)}
                className={clsx(
                  'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition',
                  active ? 'bg-primary/10 text-primary font-medium' : 'text-theme-muted hover:bg-theme-hover/50 hover:text-theme-fg',
                )}
              >
                <Icon className={clsx('h-4 w-4 shrink-0', active ? 'text-primary' : cat.color)} />
                <span className="flex-1 truncate">{cat.label}</span>
                <span className={clsx('text-[11px] tabular-nums', active ? 'text-primary/70' : 'text-theme-muted/60')}>{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── Main Content ─── */}
      <div className="min-w-0 flex-1 space-y-4">
        {/* Toast & Error */}
        {toast && <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-300"><CheckCircle2 className="h-4 w-4 shrink-0" />{toast}</div>}
        {error && <div className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm text-red-300"><AlertCircle className="h-4 w-4 shrink-0" />{error}</div>}

        {/* Header / Search / Actions */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-theme-fg">{activeCategoryDef.label}</h2>
            <p className="text-xs text-theme-muted">{filtered.length} item{filtered.length !== 1 ? 's' : ''} — {bytes(summary.totalBytes)} total</p>
          </div>
          <div className="flex items-center gap-2">
            <label className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-theme-muted" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…" className="w-48 rounded-xl border border-theme/10 bg-theme-hover/50 py-2 pl-9 pr-3 text-sm text-theme-fg placeholder:text-theme-muted/60 focus:border-primary/40 focus:outline-none" />
            </label>
            <div className="flex rounded-lg border border-theme/10 bg-theme-hover/30">
              <button onClick={() => setViewMode('grid')} className={clsx('rounded-l-lg p-2 transition', viewMode === 'grid' ? 'bg-primary/10 text-primary' : 'text-theme-muted hover:text-theme-fg')}><Grid3X3 className="h-4 w-4" /></button>
              <button onClick={() => setViewMode('list')} className={clsx('rounded-r-lg p-2 transition', viewMode === 'list' ? 'bg-primary/10 text-primary' : 'text-theme-muted hover:text-theme-fg')}><LayoutList className="h-4 w-4" /></button>
            </div>
            <button onClick={() => void refresh()} className="rounded-xl bg-theme-hover/50 p-2 text-theme-muted hover:text-theme-fg transition"><RefreshCw className="h-4 w-4" /></button>
            <button onClick={() => void importMedia()} disabled={importing} className="flex items-center gap-1.5 rounded-xl bg-primary/10 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/20 transition disabled:opacity-50">
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}Import
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-theme/10 bg-theme-hover/25 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
          <button type="button" onClick={() => void openMediaFolder()} className="flex min-w-0 items-center gap-2 text-left text-xs text-theme-muted hover:text-theme-fg">
            <FolderOpen className="h-4 w-4 shrink-0 text-primary" />
            <span className="truncate">{prefs.resolvedStorageRootPath || 'Media folder not set'}</span>
          </button>
          <div className="flex shrink-0 items-center gap-2">
            {prefs.storageRootPath && (
              <button type="button" onClick={() => void resetMediaFolder()} className="rounded-lg px-2.5 py-1.5 text-xs text-theme-muted hover:bg-theme-hover hover:text-theme-fg">
                Reset
              </button>
            )}
            <button type="button" onClick={() => void changeMediaFolder()} className="rounded-lg bg-theme-hover/60 px-2.5 py-1.5 text-xs font-medium text-theme-fg hover:bg-theme-hover">
              Change Folder
            </button>
          </div>
        </div>

        {/* Mobile category tabs */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 lg:hidden">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const active = activeCategory === cat.id;
            return (
              <button key={cat.id} onClick={() => setActiveCategory(cat.id)} className={clsx('flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition', active ? 'bg-primary/10 text-primary' : 'bg-theme-hover/30 text-theme-muted hover:text-theme-fg')}>
                <Icon className="h-3.5 w-3.5" />{cat.label}
                <span className="opacity-50">{categoryCounts[cat.id] || 0}</span>
              </button>
            );
          })}
        </div>

        {/* Gallery */}
        {filtered.length === 0 ? (
          <div className="dashboard-card flex flex-col items-center justify-center p-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <FolderOpen className="h-8 w-8" />
            </div>
            <h3 className="mt-4 text-lg font-semibold text-theme-fg">No media here yet</h3>
            <p className="mt-2 max-w-md text-sm text-theme-muted">
              {activeCategory === 'all'
                ? 'Import files, take a screenshot, or generate an image to get started.'
                : `No ${activeCategoryDef.label.toLowerCase()} found. Try a different category or import media.`}
            </p>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {filtered.map((item) => (
              <MediaCard key={item.id} item={item} viewMode="grid" onClick={() => setLightboxItem(item)} />
            ))}
          </div>
        ) : (
          <div className="space-y-1.5">
            {filtered.map((item) => (
              <MediaCard key={item.id} item={item} viewMode="list" onClick={() => setLightboxItem(item)} />
            ))}
          </div>
        )}
      </div>

      {/* ─── Lightbox ─── */}
      {lightboxItem && (
        <MediaLightbox
          item={lightboxItem}
          items={filtered}
          onClose={() => setLightboxItem(null)}
          onNavigate={setLightboxItem}
          onOpen={openItem}
          onReveal={revealItem}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}
