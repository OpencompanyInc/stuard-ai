import { dialog } from "electron";
import * as fs from "fs";
import path from "path";
import os from "os";

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
