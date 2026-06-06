import { IMAGE_EXTS, getFileExt, isFilePath } from './filePaths';

/** A data:image URI, or an http(s) URL whose path ends in an image extension. */
export function isImageUrl(v: string): boolean {
  const s = v.trim();
  if (/^data:image\//i.test(s)) return true;
  if (/^https?:\/\//i.test(s)) return IMAGE_EXTS.has(getFileExt(s.split(/[?#]/)[0]));
  return false;
}

/** A local file path that points at an image. */
export function isImagePath(v: string): boolean {
  return isFilePath(v) && IMAGE_EXTS.has(getFileExt(v));
}

/**
 * Deep-walk a tool result (or args) and collect anything renderable as an image
 * thumbnail: image file paths, data:image URIs, and image URLs. When the
 * producing tool is known to emit an image (generate_image, screenshot, …) we
 * relax detection (`assumeImage`) so extensionless blob URLs from those tools
 * still preview. Dedupes and caps the count so the trace never floods.
 */
export function collectImageSources(
  value: any,
  opts: { assumeImage?: boolean; max?: number } = {},
): string[] {
  const { assumeImage = false, max = 6 } = opts;
  const out: string[] = [];
  const seen = new Set<string>();

  const accept = (s: string): boolean => {
    if (isImagePath(s) || isImageUrl(s)) return true;
    // For known image-producing tools, also accept a bare http(s) URL (no ext)
    // or any data: URI — the tool's whole job is to return that image.
    if (assumeImage && /^(https?:\/\/|data:)/i.test(s.trim())) return true;
    return false;
  };

  const walk = (obj: any) => {
    if (out.length >= max) return;
    if (typeof obj === 'string') {
      const s = obj.trim();
      if (s && accept(s) && !seen.has(s)) {
        seen.add(s);
        out.push(s);
      }
      return;
    }
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) { obj.forEach(walk); return; }
    for (const val of Object.values(obj)) walk(val);
  };

  walk(value);
  return out.slice(0, max);
}

export function toMediaSrc(src: string): string {
  if (!src) return '';
  // Already a web URL or data URI
  if (/^(https?:|data:)/i.test(src)) return src;
  // Already using local-file protocol
  if (/^local-file:/i.test(src)) return src;
  // Convert file:// to local-file://
  if (/^file:/i.test(src)) {
    return src.replace(/^file:/i, 'local-file:');
  }
  // Convert Windows/Unix path to local-file:// URL
  let path = src.trim();
  const encodePath = (inputPath: string, preserveDrive: boolean) => {
    const parts = inputPath.split('/');
    return parts
      .map((part, idx) => {
        if (preserveDrive && idx === 0 && /^[a-zA-Z]:$/.test(part)) return part;
        return encodeURIComponent(part);
      })
      .join('/');
  };
  // Handle Windows paths (C:\... or C:/...)
  if (/^[a-zA-Z]:[/\\]/.test(path)) {
    path = path.replace(/\\/g, '/');
    return `local-file:///${encodePath(path, true)}`;
  }
  // Handle Unix absolute paths
  if (path.startsWith('/')) {
    path = path.replace(/\\/g, '/');
    return `local-file://${encodePath(path, false)}`;
  }
  // Relative path - assume local
  path = path.replace(/\\/g, '/');
  return `local-file:///${encodePath(path, false)}`;
}

export function extractYouTubeVideoId(url: string): string | null {
  const patterns = [
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/watch\?.*v=([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/v\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/live\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

// Format seconds to human readable
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}m ${secs}s`;
}
