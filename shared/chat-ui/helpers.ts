/**
 * Pure helpers shared between desktop and website chat UIs.
 * No DOM, no React, no platform coupling.
 */

export const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']);
export const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'flac', 'aac', 'opus', 'm4a']);

const FILE_PATH_RE = /^([a-zA-Z]:[/\\]|\/(?:tmp|var|home|Users)\/).+\.\w{1,5}$/;

export function getFileExt(p: string): string {
  return (p.match(/\.([a-zA-Z0-9]+)$/)?.[1] || '').toLowerCase();
}

export function isFilePath(v: unknown): v is string {
  return typeof v === 'string' && FILE_PATH_RE.test(v.trim());
}

/** Extract all file paths from a tool result (flat or nested in arrays/objects). */
export function extractFilePaths(result: any): string[] {
  const paths: string[] = [];
  if (!result || typeof result !== 'object') return paths;

  const walk = (obj: any) => {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) { obj.forEach(walk); return; }
    for (const [key, val] of Object.entries(obj)) {
      void key;
      if (isFilePath(val)) paths.push(val);
      else if (typeof val === 'object' && val) walk(val);
    }
  };
  walk(result);
  return [...new Set(paths)];
}

/** Humanize a tool name: "read_file" → "Read File", "runCommand" → "Run Command". */
export function humanizeToolName(tool: string): string {
  return tool
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/** Format seconds as "42s" or "1m 13s". */
export function formatSec(s: number): string {
  if (s < 60) return `${Math.floor(s)}s`;
  return `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s`;
}
