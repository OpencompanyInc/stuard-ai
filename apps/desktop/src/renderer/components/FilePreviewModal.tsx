import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import {
  X, Download, Trash2, Loader2, AlertCircle, ChevronLeft, ChevronRight,
  ExternalLink, File as FileIcon, Share2,
} from 'lucide-react';
import { VideoPlayer } from './VideoPlayer';
import { getViewModalHost } from '../utils/viewModalHost';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface PreviewFile {
  name: string;        // display name: "video.mp4"
  fullPath: string;    // object path: "exports/video.mp4"
  size: number;
  updated: string;
  contentType: string;
}

export interface FilePreviewModalProps {
  file: PreviewFile;
  /** Files at the same folder level, for prev/next navigation. */
  siblings: PreviewFile[];
  getFileUrl: (objectName: string) => Promise<{ ok: boolean; url?: string; error?: string }>;
  onNavigate: (file: PreviewFile) => void;
  onShare?: (objectName: string) => void;
  onDownload: (objectName: string) => void;
  onDelete: (objectName: string) => void;
  onClose: () => void;
}

type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'other';

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif']);
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'm4v', 'mkv']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus']);
const TEXT_EXTS = new Set(['txt', 'md', 'log', 'csv', 'json', 'xml', 'html', 'yaml', 'toml', 'js', 'ts', 'py']);

export function getPreviewKind(name: string, contentType?: string): PreviewKind {
  const ct = (contentType || '').toLowerCase();
  if (ct.startsWith('image/')) return 'image';
  if (ct.startsWith('video/')) return 'video';
  if (ct.startsWith('audio/')) return 'audio';
  if (ct === 'application/pdf') return 'pdf';
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (ext === 'pdf') return 'pdf';
  if (TEXT_EXTS.has(ext)) return 'text';
  return 'other';
}

export function isPreviewable(name: string, contentType?: string): boolean {
  return getPreviewKind(name, contentType) !== 'other';
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal
// ─────────────────────────────────────────────────────────────────────────────

export function FilePreviewModal({
  file, siblings, getFileUrl, onNavigate, onShare, onDownload, onDelete, onClose,
}: FilePreviewModalProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Signed URLs are valid for ~1 hour; cache them so prev/next is instant.
  const urlCache = useRef<Map<string, string>>(new Map());
  // Files we already re-fetched a fresh URL for after a media load failure —
  // a cached signed URL may simply have expired, so retry once before erroring.
  const retriedFiles = useRef<Set<string>>(new Set());

  const kind = getPreviewKind(file.name, file.contentType);

  const previewable = siblings.filter(s => isPreviewable(s.name, s.contentType));
  const idx = previewable.findIndex(s => s.fullPath === file.fullPath);
  const prev = idx > 0 ? previewable[idx - 1] : null;
  const next = idx >= 0 && idx < previewable.length - 1 ? previewable[idx + 1] : null;

  // Fetch signed URL for the current file
  useEffect(() => {
    let cancelled = false;
    const cached = urlCache.current.get(file.fullPath);
    if (cached) {
      setUrl(cached);
      setLoading(false);
      setError(null);
      return;
    }
    setUrl(null);
    setLoading(true);
    setError(null);
    getFileUrl(file.fullPath).then(result => {
      if (cancelled) return;
      if (result.ok && result.url) {
        urlCache.current.set(file.fullPath, result.url);
        setUrl(result.url);
      } else {
        setError(result.error || 'Could not load file');
      }
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [file.fullPath, getFileUrl]);

  // Prefetch neighbours so arrow navigation feels instant
  useEffect(() => {
    for (const neighbour of [prev, next]) {
      if (neighbour && !urlCache.current.has(neighbour.fullPath)) {
        getFileUrl(neighbour.fullPath).then(result => {
          if (result.ok && result.url) urlCache.current.set(neighbour.fullPath, result.url);
        });
      }
    }
  }, [prev, next, getFileUrl]);

  // Keyboard: Esc close, arrows navigate
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'ArrowLeft' && prev) onNavigate(prev);
      if (e.key === 'ArrowRight' && next) onNavigate(next);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onClose, onNavigate, prev, next]);

  const openExternal = useCallback(() => {
    if (url) window.open(url, '_blank');
  }, [url]);

  // Media element failed to load the signed URL. Retry once with a fresh URL
  // (the cached one may have expired); after that, surface a real error
  // instead of leaving a blank modal.
  const handleMediaError = useCallback(() => {
    urlCache.current.delete(file.fullPath);
    if (retriedFiles.current.has(file.fullPath)) {
      setError('Could not load preview. Try downloading the file instead.');
      return;
    }
    retriedFiles.current.add(file.fullPath);
    setUrl(null);
    setLoading(true);
    getFileUrl(file.fullPath).then(result => {
      if (result.ok && result.url) {
        urlCache.current.set(file.fullPath, result.url);
        setUrl(result.url);
      } else {
        setError(result.error || 'Could not load preview');
      }
      setLoading(false);
    });
  }, [file.fullPath, getFileUrl]);

  // Portal into the dashboard content area so the backdrop covers the view,
  // not the whole dashboard chrome (falls back to a body portal elsewhere).
  const { host, positionClass } = getViewModalHost();
  return createPortal(
    <div
      className={clsx(positionClass, 'inset-0 z-50 flex flex-col bg-black/80 backdrop-blur-2xl animate-in fade-in duration-150')}
      onClick={onClose}
    >
      {/* ── Header ── */}
      <div
        className="flex items-center gap-3 px-4 py-3 shrink-0"
        onClick={e => e.stopPropagation()}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold text-white" title={file.name}>{file.name}</p>
          <p className="text-[11.5px] text-white/50">
            {formatBytes(file.size)}
            {previewable.length > 1 && idx >= 0 && <> · {idx + 1} of {previewable.length}</>}
          </p>
        </div>
        {onShare && (
          <button
            onClick={() => onShare(file.fullPath)}
            className="rounded-xl p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            title="Share"
          >
            <Share2 className="h-4 w-4" />
          </button>
        )}
        <button
          onClick={openExternal}
          disabled={!url}
          className="rounded-xl p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
          title="Open in browser"
        >
          <ExternalLink className="h-4 w-4" />
        </button>
        <button
          onClick={() => onDownload(file.fullPath)}
          className="rounded-xl p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          title="Download"
        >
          <Download className="h-4 w-4" />
        </button>
        <button
          onClick={() => onDelete(file.fullPath)}
          className="rounded-xl p-2 text-red-400/80 transition-colors hover:bg-red-500/15 hover:text-red-400"
          title="Delete"
        >
          <Trash2 className="h-4 w-4" />
        </button>
        <button
          onClick={onClose}
          className="rounded-xl p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          title="Close (Esc)"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* ── Body ── */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-14 pb-6">
        {/* Prev / Next */}
        {prev && (
          <button
            onClick={(e) => { e.stopPropagation(); onNavigate(prev); }}
            className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2.5 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
            title={prev.name}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}
        {next && (
          <button
            onClick={(e) => { e.stopPropagation(); onNavigate(next); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2.5 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
            title={next.name}
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        )}

        <div className="flex h-full w-full items-center justify-center" onClick={e => e.stopPropagation()}>
          {loading && (
            <div className="flex flex-col items-center gap-3 text-white/60">
              <Loader2 className="h-7 w-7 animate-spin" />
              <span className="text-[13px]">Loading preview…</span>
            </div>
          )}

          {!loading && error && (
            <div className="flex flex-col items-center gap-3 text-red-400">
              <AlertCircle className="h-7 w-7" />
              <span className="text-[13px]">{error}</span>
            </div>
          )}

          {!loading && !error && url && kind === 'image' && (
            <img
              src={url}
              alt={file.name}
              className="max-h-full max-w-full rounded-xl object-contain shadow-2xl"
              draggable={false}
              onError={handleMediaError}
            />
          )}

          {!loading && !error && url && kind === 'video' && (
            <VideoPlayer
              key={url}
              src={url}
              name={file.name}
              onError={handleMediaError}
            />
          )}

          {!loading && !error && url && kind === 'audio' && (
            <div className="flex w-full max-w-md flex-col items-center gap-5 rounded-2xl bg-white/5 px-8 py-10">
              <p className="truncate max-w-full text-[14px] font-medium text-white/90">{file.name}</p>
              <audio key={url} src={url} controls autoPlay className="w-full" onError={handleMediaError} />
            </div>
          )}

          {!loading && !error && url && (kind === 'pdf' || kind === 'text') && (
            <iframe
              src={url}
              title={file.name}
              className="h-full w-full max-w-4xl rounded-xl border-0 bg-white shadow-2xl"
              sandbox="allow-same-origin"
            />
          )}

          {!loading && !error && url && kind === 'other' && (
            <div className="flex flex-col items-center gap-4 text-white/70">
              <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-white/10">
                <FileIcon className="h-8 w-8" />
              </div>
              <span className="text-[13px]">No inline preview for this file type</span>
              <div className="flex gap-2">
                <button
                  onClick={() => onDownload(file.fullPath)}
                  className={clsx('inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-4 py-2',
                    'text-[12.5px] font-medium text-white transition-colors hover:bg-white/20')}
                >
                  <Download className="h-3.5 w-3.5" /> Download
                </button>
                <button
                  onClick={openExternal}
                  className={clsx('inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-4 py-2',
                    'text-[12.5px] font-medium text-white transition-colors hover:bg-white/20')}
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Open in browser
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    host,
  );
}
