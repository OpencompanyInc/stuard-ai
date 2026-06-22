import { useEffect, useState } from 'react';

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg|avif|ico|tiff?|heic|heif)$/i;

/** True when a path points at an image file (by extension). */
export function isImagePath(path: string | undefined | null): boolean {
  return !!path && IMAGE_EXT_RE.test(String(path));
}

// Module-level cache so re-mounts / list re-renders don't re-fetch the same
// thumbnail. Keyed by absolute path; values are data URLs.
const previewCache = new Map<string, string>();

/**
 * Lazily resolve an image thumbnail (data URL) for a local file path via the
 * desktop `getFilePreview` bridge. Non-image paths resolve to null. Lets
 * path-based context (added via @-mention or "add as context") render the same
 * rich preview as an inline attachment instead of a bare filename chip.
 */
export function useFilePathPreview(path: string | undefined | null, enabled = true): string | null {
  const [dataUrl, setDataUrl] = useState<string | null>(() =>
    path && previewCache.has(path) ? previewCache.get(path)! : null,
  );

  useEffect(() => {
    if (!enabled || !isImagePath(path)) {
      setDataUrl(null);
      return;
    }
    const key = String(path);
    const cached = previewCache.get(key);
    if (cached) {
      setDataUrl(cached);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const api = (window as any).desktopAPI;
        if (!api?.getFilePreview) return;
        const res = await api.getFilePreview(key, { size: 'normal', preferThumbnail: true });
        if (cancelled) return;
        if (res?.ok && typeof res.dataUrl === 'string' && res.dataUrl) {
          previewCache.set(key, res.dataUrl);
          setDataUrl(res.dataUrl);
        }
      } catch {
        /* preview is best-effort; fall back to the icon */
      }
    })();
    return () => { cancelled = true; };
  }, [path, enabled]);

  return dataUrl;
}
