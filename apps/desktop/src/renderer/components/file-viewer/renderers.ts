// Extension → mime / kind dispatch helpers used by the viewer pane.

export type RendererKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'html'
  | 'sheet'
  | 'text'
  | 'binary';

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico']);
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'mkv', 'm4v', 'ogv']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus']);
const PDF_EXTS = new Set(['pdf']);
const HTML_EXTS = new Set(['html', 'htm']);
// Tabular data → rendered as an interactive, sortable data table with summary
// stats (the Workspace "data analysis" view). CSV/TSV are plain text on disk;
// xlsx/xls are binary workbooks parsed client-side.
const SHEET_EXTS = new Set(['csv', 'tsv', 'xlsx', 'xls', 'xlsm']);
const TEXT_EXTS = new Set([
  'txt', 'md', 'markdown', 'log',
  'json', 'jsonl', 'yaml', 'yml', 'toml', 'ini', 'env', 'cfg', 'conf',
  'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift',
  'c', 'cc', 'cpp', 'cxx', 'h', 'hpp', 'm', 'mm',
  'cs', 'php', 'pl', 'sh', 'bash', 'zsh', 'fish', 'ps1',
  'sql', 'graphql', 'gql',
  'xml', 'css', 'scss', 'sass', 'less',
  'vue', 'svelte', 'astro',
  'lua', 'r', 'jl', 'dart', 'ex', 'exs', 'erl',
  'gitignore', 'dockerignore', 'editorconfig',
  'dockerfile', 'makefile',
]);

export function classifyByExt(ext: string): RendererKind {
  const e = (ext || '').toLowerCase();
  if (IMAGE_EXTS.has(e)) return 'image';
  if (VIDEO_EXTS.has(e)) return 'video';
  if (AUDIO_EXTS.has(e)) return 'audio';
  if (PDF_EXTS.has(e)) return 'pdf';
  if (HTML_EXTS.has(e)) return 'html';
  if (SHEET_EXTS.has(e)) return 'sheet';
  if (TEXT_EXTS.has(e)) return 'text';
  return 'binary';
}

/** True for binary spreadsheet workbooks (need a parser, not plain text). */
export function isBinarySheetExt(ext: string): boolean {
  const e = (ext || '').toLowerCase();
  return e === 'xlsx' || e === 'xls' || e === 'xlsm';
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', avif: 'image/avif', ico: 'image/x-icon',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska',
  m4v: 'video/x-m4v', ogv: 'video/ogg',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
  aac: 'audio/aac', flac: 'audio/flac', opus: 'audio/opus',
  pdf: 'application/pdf',
  csv: 'text/csv', tsv: 'text/tab-separated-values',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
};

export function mimeForExt(ext: string): string {
  return MIME_BY_EXT[(ext || '').toLowerCase()] || 'application/octet-stream';
}

/** Convert a base64 string to a Blob without using atob loops on huge files. */
export function base64ToBlob(base64: string, mime: string): Blob {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
