import { dialog } from "electron";
import * as fs from "fs";
import path from "path";
import os from "os";
import zlib from "zlib";

export interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
}

/**
 * Lists files and directories in a given path.
 * Defaults to home directory if path is empty.
 * Resolves ~ to home directory.
 */
export async function listDirectory(dirPath?: string): Promise<DirectoryEntry[]> {
  const targetPath = dirPath ? dirPath.replace(/^~/, os.homedir()) : os.homedir();

  try {
    const entries = await fs.promises.readdir(targetPath, { withFileTypes: true });
    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    return entries.map(entry => ({
      name: entry.name,
      path: path.join(targetPath, entry.name),
      isDirectory: entry.isDirectory(),
      size: 0
    }));
  } catch (e) {
    console.error("Error listing directory:", e);
    return [];
  }
}

// Extensions we hand back as decoded UTF-8 text; everything else is returned
// base64 so the renderer can build a Blob (images, pdf, audio/video, xlsx…).
// CSV/TSV are text here — the Workspace data-table view parses them client-side.
const PREVIEW_TEXT_EXTS = new Set([
  'txt', 'md', 'markdown', 'log', 'csv', 'tsv',
  'json', 'jsonl', 'yaml', 'yml', 'toml', 'ini', 'env', 'cfg', 'conf',
  'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift',
  'c', 'cc', 'cpp', 'cxx', 'h', 'hpp', 'm', 'mm',
  'cs', 'php', 'pl', 'sh', 'bash', 'zsh', 'fish', 'ps1',
  'sql', 'graphql', 'gql',
  'xml', 'css', 'scss', 'sass', 'less', 'html', 'htm',
  'vue', 'svelte', 'astro',
  'lua', 'r', 'jl', 'dart', 'ex', 'exs', 'erl',
  'gitignore', 'dockerignore', 'editorconfig', 'dockerfile', 'makefile',
]);

// Cap raw preview reads so a giant binary can't balloon the renderer (base64 is
// ~1.37× the byte size on the wire). 48 MB covers typical images/PDF/sheets.
const MAX_PREVIEW_BYTES = 48 * 1024 * 1024;

export interface PreviewReadResult {
  content?: string;
  encoding?: 'utf-8' | 'base64';
  size: number;
  error?: string;
}

// Word (Office Open XML) documents — text-extracted for preview, no deps.
const WORD_DOC_EXTS = new Set(['docx', 'docm', 'dotx', 'dotm']);

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Extract one entry's bytes from a ZIP buffer via its central directory.
 * Reading the central directory (not local headers) keeps this correct even
 * when entries use streaming data descriptors.
 */
function readZipEntry(buf: Buffer, entryName: string): Buffer | null {
  const EOCD_SIG = 0x06054b50;
  let eocd = -1;
  const minPos = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= minPos; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const cdEntries = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);

  const CEN_SIG = 0x02014b50;
  const LOC_SIG = 0x04034b50;
  let p = cdOffset;
  for (let n = 0; n < cdEntries; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CEN_SIG) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (name === entryName) {
      if (buf.readUInt32LE(localOffset) !== LOC_SIG) return null;
      const locNameLen = buf.readUInt16LE(localOffset + 26);
      const locExtraLen = buf.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + locNameLen + locExtraLen;
      const data = buf.subarray(dataStart, dataStart + compSize);
      if (method === 0) return Buffer.from(data);
      if (method === 8) {
        try { return zlib.inflateRawSync(data); } catch { return null; }
      }
      return null;
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

/** Extract readable plain text from a .docx buffer (paragraphs, tabs, breaks). */
export function extractDocxText(buf: Buffer): string {
  const docXml = readZipEntry(buf, 'word/document.xml');
  if (!docXml) throw new Error('not a valid .docx (missing word/document.xml)');
  let s = docXml.toString('utf8');
  s = s.replace(/<w:p\b[^>]*\/>/g, '\n');
  s = s.replace(/<\/w:p>/g, '\n');
  s = s.replace(/<w:tab\b[^>]*\/?>/g, '\t');
  s = s.replace(/<w:(?:br|cr)\b[^>]*\/?>/g, '\n');
  s = s.replace(/<[^>]+>/g, '');
  s = decodeXmlEntities(s);
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Reads a local file for the Workspace file-preview pane. Text-like files come
 * back as UTF-8; everything else as base64 (the renderer turns it into a Blob
 * URL). Oversized files return an error instead of content so the UI can offer
 * "open in your app" rather than freezing.
 */
export async function readFileForPreview(filePath: string): Promise<PreviewReadResult> {
  if (!filePath || typeof filePath !== 'string') {
    return { size: 0, error: 'No file path provided' };
  }
  const resolved = filePath.replace(/^~/, os.homedir());
  try {
    const stat = await fs.promises.stat(resolved);
    if (stat.isDirectory()) return { size: 0, error: 'Path is a folder, not a file' };
    if (stat.size > MAX_PREVIEW_BYTES) {
      return { size: stat.size, error: `File is too large to preview (${(stat.size / 1024 / 1024).toFixed(1)} MB)` };
    }
    const extMatch = /\.([a-z0-9]+)$/i.exec(path.basename(resolved).toLowerCase());
    const ext = extMatch ? extMatch[1] : '';
    const baseName = path.basename(resolved).toLowerCase();
    if (WORD_DOC_EXTS.has(ext)) {
      try {
        const buf = await fs.promises.readFile(resolved);
        const text = extractDocxText(buf);
        return { content: text, encoding: 'utf-8', size: stat.size };
      } catch {
        // Fall through to base64 so the UI can still offer "open externally".
      }
    }
    const isText = PREVIEW_TEXT_EXTS.has(ext) || PREVIEW_TEXT_EXTS.has(baseName);
    if (isText) {
      const content = await fs.promises.readFile(resolved, { encoding: 'utf-8' });
      return { content, encoding: 'utf-8', size: stat.size };
    }
    const content = await fs.promises.readFile(resolved, { encoding: 'base64' });
    return { content, encoding: 'base64', size: stat.size };
  } catch (e: any) {
    return { size: 0, error: e?.code === 'ENOENT' ? 'File not found' : (e?.message || 'Could not read file') };
  }
}

/**
 * Opens a native picker and returns just the chosen file paths (no content) —
 * used by the Workspace "Open file" button, which then streams each file in
 * through readFileForPreview on demand.
 */
export async function pickFilesForPreview(): Promise<string[]> {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'All Files', extensions: ['*'] },
      { name: 'Documents', extensions: ['pdf', 'txt', 'md', 'csv', 'tsv', 'xlsx', 'xls', 'json'] },
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'] },
    ],
  });
  if (result.canceled || !result.filePaths.length) return [];
  return result.filePaths;
}

export function getMimeType(ext: string): string {
  const mimeMap: Record<string, string> = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    txt: 'text/plain',
    md: 'text/markdown',
    json: 'application/json',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    flac: 'audio/flac',
    aac: 'audio/aac',
    opus: 'audio/opus',
    m4a: 'audio/mp4',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
  };
  return mimeMap[ext.toLowerCase()] || 'application/octet-stream';
}

const MAX_ATTACHMENT_BYTES = 65 * 1024 * 1024; // 65 MB

export async function selectFiles() {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'All Files', extensions: ['*'] },
      { name: 'Documents', extensions: ['pdf', 'doc', 'docx', 'txt', 'md'] },
    ],
  });
  if (result.canceled || !result.filePaths.length) return null;
  const files: any[] = [];
  const skipped: string[] = [];
  for (const filePath of result.filePaths) {
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > MAX_ATTACHMENT_BYTES) {
        skipped.push(`${path.basename(filePath)} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
        continue;
      }
      const data = fs.readFileSync(filePath, { encoding: 'base64' });
      const ext = path.extname(filePath).slice(1);
      const mimeType = getMimeType(ext);
      files.push({ name: path.basename(filePath), path: filePath, data, mimeType });
    } catch {}
  }
  if (skipped.length > 0) {
    dialog.showMessageBoxSync({ type: 'warning', title: 'File too large', message: `Skipped (max 65 MB): ${skipped.join(', ')}` });
  }
  return files.length > 0 ? files : null;
}

export async function selectImages() {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [ { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] } ],
  });
  if (result.canceled || !result.filePaths.length) return null;
  const images: any[] = [];
  const skipped: string[] = [];
  for (const filePath of result.filePaths) {
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > MAX_ATTACHMENT_BYTES) {
        skipped.push(`${path.basename(filePath)} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
        continue;
      }
      const data = fs.readFileSync(filePath, { encoding: 'base64' });
      const ext = path.extname(filePath).slice(1).toLowerCase();
      const mimeType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
      images.push({ name: path.basename(filePath), path: filePath, data, mimeType });
    } catch {}
  }
  if (skipped.length > 0) {
    dialog.showMessageBoxSync({ type: 'warning', title: 'File too large', message: `Skipped (max 65 MB): ${skipped.join(', ')}` });
  }
  return images.length > 0 ? images : null;
}

export async function selectFolder(options?: { title?: string; multiple?: boolean }) {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', ...(options?.multiple ? (['multiSelections'] as any) : [])],
    title: options?.title,
  });
  if (result.canceled || !result.filePaths.length) return null;
  const folders = result.filePaths.map((p) => ({ path: p }));
  return folders.length > 0 ? folders : null;
}
