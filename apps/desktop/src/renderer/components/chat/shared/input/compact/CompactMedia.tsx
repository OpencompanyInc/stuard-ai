import React, { memo, useEffect, useState } from 'react';
import { ExternalLink, File, Globe, Link2, Play } from 'lucide-react';
import { AudioPlayer } from '../../../../AudioPlayer';
import { ScrollableImagePane } from '../../messages/MessageBubble/inline/ScrollableImagePane';
import { toMediaSrc, extractYouTubeVideoId, isImagePath, isImageUrl } from '../../messages/MessageBubble/helpers/media';
import { getFileExt, IMAGE_EXTS } from '../../messages/MessageBubble/helpers/filePaths';

const CARD_BORDER = 'rgb(var(--compact-pill-fg) / 0.18)';
const MUTED_FG = 'rgb(var(--compact-pill-fg-muted))';
const TEXT_FG = 'rgb(var(--compact-pill-fg))';
const SURFACE = 'rgb(var(--compact-pill-fg) / 0.05)';

const COMPACT_MEDIA_MAX = 168;

function displayNameFromSrc(src: string) {
  const raw = String(src || '').trim().replace(/^<|>$/g, '');
  try {
    if (/^https?:/i.test(raw)) {
      const url = new URL(raw);
      return decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || url.hostname || 'File');
    }
  } catch { /* ignore */ }
  try {
    return decodeURIComponent(raw.split(/[\\/]/).pop() || raw || 'File');
  } catch {
    return raw.split(/[\\/]/).pop() || raw || 'File';
  }
}

/** Compact image preview — scrollable, fits the ~372px response card. */
export const CompactImage: React.FC<{ src: string; alt?: string }> = memo(({ src, alt }) => (
  <div
    className="compact-media-image my-1 w-full overflow-hidden rounded-xl"
    style={{ border: `0.5px solid ${CARD_BORDER}`, background: SURFACE }}
  >
    <ScrollableImagePane src={src} alt={alt} maxHeight={COMPACT_MEDIA_MAX} bare />
  </div>
));

/** Compact inline video player. */
export const CompactVideo: React.FC<{ src: string }> = memo(({ src }) => {
  const [error, setError] = useState<string | null>(null);
  const videoSrc = toMediaSrc(src || '');

  if (error) {
    return (
      <div className="my-1 text-[11px]" style={{ color: MUTED_FG }}>
        Video unavailable
      </div>
    );
  }

  return (
    <video
      src={videoSrc}
      controls
      playsInline
      onError={() => setError(src)}
      className="compact-media-video my-1 block w-full rounded-xl"
      style={{
        maxHeight: COMPACT_MEDIA_MAX,
        border: `0.5px solid ${CARD_BORDER}`,
        background: 'rgb(var(--compact-pill-fg) / 0.08)',
      }}
    />
  );
});

/** Compact audio player wrapper. */
export const CompactAudio: React.FC<{ src: string }> = memo(({ src }) => (
  <div className="compact-media-audio my-1 w-full min-w-0">
    <AudioPlayer src={toMediaSrc(src)} />
  </div>
));

/** Compact file chip — name + open action, no full preview chrome. */
export const CompactFileChip: React.FC<{ src: string }> = memo(({ src }) => {
  const cleaned = String(src || '').trim().replace(/^<|>$/g, '');
  const ext = getFileExt(cleaned).toLowerCase();
  if (IMAGE_EXTS.has(ext) || isImagePath(cleaned) || isImageUrl(cleaned)) {
    return <CompactImage src={cleaned} alt={displayNameFromSrc(cleaned)} />;
  }

  const fileName = displayNameFromSrc(cleaned);
  const extLabel = ext.toUpperCase() || 'FILE';

  const open = () => {
    try {
      if (/^https?:/i.test(cleaned)) {
        (window as any).desktopAPI?.openExternal?.(cleaned);
      } else {
        ((window as any).desktopAPI?.openPath || (window as any).desktopAPI?.mediaOpenPath)?.(cleaned);
      }
    } catch { /* ignore */ }
  };

  return (
    <button
      type="button"
      onClick={open}
      className="compact-media-file my-1 flex w-full max-w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left transition-opacity hover:opacity-90"
      style={{
        border: `0.5px solid ${CARD_BORDER}`,
        background: SURFACE,
        color: TEXT_FG,
      }}
    >
      <span
        className="flex shrink-0 items-center justify-center rounded-lg"
        style={{
          width: 28,
          height: 28,
          background: 'rgb(var(--compact-pill-fg) / 0.08)',
          color: MUTED_FG,
        }}
      >
        <File style={{ width: 14, height: 14 }} strokeWidth={1.75} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium leading-4">{fileName}</span>
        <span className="block text-[10px] leading-4" style={{ color: MUTED_FG }}>{extLabel}</span>
      </span>
      <ExternalLink className="shrink-0" style={{ width: 12, height: 12, color: MUTED_FG }} strokeWidth={1.75} />
    </button>
  );
});

/** Compact link preview card — uses compact-pill tokens instead of window dark chrome. */
export const CompactLinkPreview: React.FC<{ url: string }> = memo(({ url }) => {
  const [data, setData] = useState<{
    title?: string;
    description?: string;
    image?: string;
    siteName?: string;
    favicon?: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [imageError, setImageError] = useState(false);
  const [faviconError, setFaviconError] = useState(false);

  const buildFallback = (rawUrl: string) => {
    try {
      const u = new URL(rawUrl);
      const host = u.hostname.replace(/^www\./, '') || rawUrl;
      return {
        title: host,
        siteName: host,
        description: '',
        image: '',
        favicon: `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=64`,
      };
    } catch {
      return { title: rawUrl, siteName: rawUrl, description: '', image: '', favicon: '' };
    }
  };

  useEffect(() => {
    let cancelled = false;
    const fetchPreview = async () => {
      try {
        setLoading(true);
        setImageError(false);
        setFaviconError(false);
        const res = await window.desktopAPI.getLinkPreview(url);
        if (!cancelled) {
          const fallback = buildFallback(url);
          if (res.ok && res.data) {
            setData({
              ...fallback,
              ...res.data,
              title: res.data.title || fallback.title,
              siteName: res.data.siteName || fallback.siteName,
              favicon: (res.data as any).favicon || fallback.favicon,
            });
          } else {
            setData(fallback);
          }
        }
      } catch {
        if (!cancelled) setData(buildFallback(url));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    if (url) fetchPreview();
    return () => { cancelled = true; };
  }, [url]);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    window.desktopAPI.openExternal(url);
  };

  if (!url) return null;

  if (loading) {
    return (
      <div
        className="compact-media-link my-1 w-full animate-pulse rounded-xl p-2.5"
        style={{ border: `0.5px solid ${CARD_BORDER}`, background: SURFACE }}
      >
        <div className="mb-2 aspect-[2/1] rounded-lg" style={{ background: 'rgb(var(--compact-pill-fg) / 0.08)' }} />
        <div className="h-3 rounded w-3/4 mb-1" style={{ background: 'rgb(var(--compact-pill-fg) / 0.08)' }} />
        <div className="h-2.5 rounded w-1/2" style={{ background: 'rgb(var(--compact-pill-fg) / 0.06)' }} />
      </div>
    );
  }

  const view = data || buildFallback(url);
  const hasImage = view.image && !imageError;

  return (
    <div
      onClick={handleClick}
      className="compact-media-link my-1 w-full cursor-pointer overflow-hidden rounded-xl transition-opacity hover:opacity-95"
      style={{ border: `0.5px solid ${CARD_BORDER}`, background: SURFACE }}
    >
      {hasImage && (
        <div className="relative aspect-[2/1] overflow-hidden" style={{ background: 'rgb(var(--compact-pill-fg) / 0.06)' }}>
          <img
            src={view.image}
            alt={view.title}
            referrerPolicy="no-referrer"
            onError={() => setImageError(true)}
            className="h-full w-full object-cover"
          />
          <div
            className="absolute bottom-1.5 left-1.5 flex max-w-[calc(100%-12px)] items-center gap-1 rounded-md px-1.5 py-0.5"
            style={{ background: 'rgb(var(--compact-pill-bg) / 0.88)', color: TEXT_FG }}
          >
            {view.favicon && !faviconError ? (
              <img src={view.favicon} alt="" className="h-3 w-3 rounded-sm" onError={() => setFaviconError(true)} />
            ) : (
              <Globe className="h-3 w-3" style={{ color: MUTED_FG }} />
            )}
            <span className="truncate text-[9px] font-medium">{view.siteName}</span>
          </div>
        </div>
      )}
      <div className="p-2.5">
        {!hasImage && (
          <div className="mb-1.5 flex items-center gap-1.5">
            {view.favicon && !faviconError ? (
              <img src={view.favicon} alt="" className="h-4 w-4 rounded" onError={() => setFaviconError(true)} />
            ) : (
              <Link2 className="h-3.5 w-3.5" style={{ color: MUTED_FG }} />
            )}
            <span className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: MUTED_FG }}>
              {view.siteName}
            </span>
          </div>
        )}
        <h4 className="line-clamp-2 text-[12px] font-medium leading-4" style={{ color: TEXT_FG }}>
          {view.title || url}
        </h4>
        {view.description && (
          <p className="mt-1 line-clamp-2 text-[10px] leading-4" style={{ color: MUTED_FG }}>
            {view.description}
          </p>
        )}
      </div>
    </div>
  );
});

/** Compact YouTube card with thumbnail preview. */
export const CompactYouTubeEmbed: React.FC<{ videoId: string; url: string }> = memo(({ videoId, url }) => {
  const [data, setData] = useState<{ title: string; author: string; thumbnail: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetchInfo = async () => {
      try {
        const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
        const res = await fetch(oembedUrl);
        if (!res.ok) throw new Error('Failed');
        const json = await res.json();
        if (!cancelled) {
          setData({
            title: json.title || 'YouTube Video',
            author: json.author_name || '',
            thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
          });
        }
      } catch {
        if (!cancelled) {
          setData({
            title: 'YouTube Video',
            author: '',
            thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchInfo();
    return () => { cancelled = true; };
  }, [videoId]);

  const handleClick = () => {
    try {
      (window as any).desktopAPI.openExternal(url);
    } catch {
      window.open(url, '_blank');
    }
  };

  if (loading) {
    return (
      <div
        className="compact-media-youtube my-1 w-full animate-pulse rounded-xl p-2"
        style={{ border: `0.5px solid ${CARD_BORDER}`, background: SURFACE }}
      >
        <div className="aspect-video rounded-lg" style={{ background: 'rgb(var(--compact-pill-fg) / 0.08)' }} />
      </div>
    );
  }

  return (
    <div
      onClick={handleClick}
      className="compact-media-youtube my-1 w-full cursor-pointer overflow-hidden rounded-xl transition-opacity hover:opacity-95"
      style={{ border: `0.5px solid ${CARD_BORDER}`, background: SURFACE }}
    >
      <div className="relative aspect-video" style={{ background: 'rgb(var(--compact-pill-fg) / 0.06)' }}>
        <img src={data?.thumbnail} alt={data?.title} className="h-full w-full object-cover" />
        <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgb(var(--compact-pill-fg) / 0.12)' }}>
          <div
            className="flex h-8 w-11 items-center justify-center rounded-lg"
            style={{ background: '#dc2626' }}
          >
            <Play className="ml-0.5 h-4 w-4 fill-white text-white" />
          </div>
        </div>
      </div>
      <div className="p-2.5">
        <h4 className="line-clamp-2 text-[12px] font-medium leading-4" style={{ color: TEXT_FG }}>
          {data?.title}
        </h4>
        {data?.author && (
          <p className="mt-0.5 truncate text-[10px]" style={{ color: MUTED_FG }}>{data.author}</p>
        )}
      </div>
    </div>
  );
});

/** Resolve markdown / link media to the right compact preview component. */
export function renderCompactMediaFromUrl(src: string, alt?: string, opts?: { links?: boolean }): React.ReactNode {
  const trimmed = String(src || '').trim();
  if (!trimmed) return null;

  const ytId = extractYouTubeVideoId(trimmed);
  if (ytId) return <CompactYouTubeEmbed videoId={ytId} url={trimmed} />;

  if (/\.(wav|mp3|ogg|m4a|aac|flac|opus)(\?|$)/i.test(trimmed) || alt === 'audio' || /^data:audio\//i.test(trimmed)) {
    return <CompactAudio src={trimmed} />;
  }
  if (/\.(mp4|mov|m4v|webm)(\?|$)/i.test(trimmed) || alt === 'video' || /^data:video\//i.test(trimmed)) {
    return <CompactVideo src={trimmed} />;
  }
  if (/\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/i.test(trimmed) || alt === 'image' || /^data:image\//i.test(trimmed) || isImageUrl(trimmed) || isImagePath(trimmed)) {
    return <CompactImage src={trimmed} alt={alt} />;
  }
  if (opts?.links && /^https?:\/\//i.test(trimmed)) {
    return <CompactLinkPreview url={trimmed} />;
  }
  return null;
}
