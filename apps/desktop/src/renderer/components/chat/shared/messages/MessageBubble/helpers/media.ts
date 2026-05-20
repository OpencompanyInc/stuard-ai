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
