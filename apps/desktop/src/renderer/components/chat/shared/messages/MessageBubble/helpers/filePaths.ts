// Detect file paths in tool results and render copy/open actions
export const FILE_PATH_RE = /^([a-zA-Z]:[/\\]|\/(?:tmp|var|home|Users)\/).+\.\w{1,5}$/;
export const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']);
export const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'flac', 'aac', 'opus', 'm4a']);

export function getFileExt(p: string): string {
  return (p.match(/\.([a-zA-Z0-9]+)$/)?.[1] || '').toLowerCase();
}

export function isFilePath(v: unknown): v is string {
  return typeof v === 'string' && FILE_PATH_RE.test(v.trim());
}

/** Extract all file paths from a tool result (flat or nested in arrays/objects) */
export function extractFilePaths(result: any): string[] {
  const paths: string[] = [];
  if (!result || typeof result !== 'object') return paths;

  const walk = (obj: any) => {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) { obj.forEach(walk); return; }
    for (const [key, val] of Object.entries(obj)) {
      if (isFilePath(val)) paths.push(val);
      else if (typeof val === 'object' && val) walk(val);
    }
  };
  walk(result);
  return [...new Set(paths)];
}

export function getFilenameFromPath(p: string): string {
  return p.split(/[/\\]/).pop() || p;
}
