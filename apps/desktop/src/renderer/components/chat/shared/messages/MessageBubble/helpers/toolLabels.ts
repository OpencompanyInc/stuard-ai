import { getFilenameFromPath } from './filePaths';

// Humanize tool name - removes underscores, capitalizes words, makes it readable
export function humanizeToolName(tool: string): string {
  return tool
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase to spaces
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export function getQueryFromArgs(args: Record<string, any>): string | null {
  const candidates = ['query', 'search_term', 'q', 'pattern'];
  for (const k of candidates) {
    if (typeof args[k] === 'string' && args[k].trim()) return args[k].trim();
  }
  return null;
}

export function getAnalyzeMediaTarget(args: Record<string, any>): string | null {
  const sources = Array.isArray(args.sources) ? args.sources : [];
  if (sources.length === 0) return null;
  if (sources.length === 1) {
    const src = sources[0] || {};
    if (src.captureScreen) return 'screen capture';
    if (typeof src.path === 'string') return getFilenameFromPath(src.path);
    if (typeof src.url === 'string') {
      try { return new URL(src.url).hostname.replace(/^www\./, ''); } catch { return src.url; }
    }
    return 'media';
  }
  return `${sources.length} media files`;
}
