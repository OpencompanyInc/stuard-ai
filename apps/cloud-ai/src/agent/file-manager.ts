/**
 * VM Agent — File Manager
 * 
 * Sandboxed file operations on the VM filesystem.
 * All paths are restricted to a configurable root directory.
 */

import fs from 'fs/promises';
import path from 'path';
import { Stats } from 'fs';

const SANDBOX_ROOT = process.env.STUARD_VM_ROOT || '/home/stuard';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB read limit

export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'symlink' | 'other';
  size: number;
  modified: string;
  permissions: string;
}

export interface FileStat {
  path: string;
  type: 'file' | 'directory' | 'symlink' | 'other';
  size: number;
  modified: string;
  created: string;
  permissions: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Path Safety
// ─────────────────────────────────────────────────────────────────────────────

function resolveSafe(userPath: string): string {
  const resolved = path.resolve(SANDBOX_ROOT, userPath);
  if (resolved !== SANDBOX_ROOT && !resolved.startsWith(SANDBOX_ROOT + path.sep)) {
    throw new Error('Access denied: path outside sandbox');
  }
  return resolved;
}

function typeFromStats(stats: Stats): 'file' | 'directory' | 'symlink' | 'other' {
  if (stats.isDirectory()) return 'directory';
  if (stats.isFile()) return 'file';
  if (stats.isSymbolicLink()) return 'symlink';
  return 'other';
}

function modeToString(mode: number): string {
  return '0' + (mode & 0o777).toString(8);
}

// ─────────────────────────────────────────────────────────────────────────────
// Operations
// ─────────────────────────────────────────────────────────────────────────────

export async function listDirectory(dirPath: string): Promise<FileEntry[]> {
  const resolved = resolveSafe(dirPath);
  const entries = await fs.readdir(resolved, { withFileTypes: true });
  const result: FileEntry[] = [];

  for (const entry of entries) {
    try {
      const fullPath = path.join(resolved, entry.name);
      const stats = await fs.stat(fullPath);
      result.push({
        name: entry.name,
        path: path.relative(SANDBOX_ROOT, fullPath),
        type: typeFromStats(stats),
        size: stats.size,
        modified: stats.mtime.toISOString(),
        permissions: modeToString(stats.mode),
      });
    } catch {
      // Skip entries we can't stat
    }
  }

  return result.sort((a, b) => {
    // Directories first, then alphabetical
    if (a.type === 'directory' && b.type !== 'directory') return -1;
    if (a.type !== 'directory' && b.type === 'directory') return 1;
    return a.name.localeCompare(b.name);
  });
}

export async function readFile(filePath: string): Promise<{ content: string; encoding: 'utf-8' | 'base64'; size: number }> {
  const resolved = resolveSafe(filePath);
  const stats = await fs.stat(resolved);

  if (!stats.isFile()) {
    throw new Error('Not a file');
  }
  if (stats.size > MAX_FILE_SIZE) {
    throw new Error(`File too large: ${stats.size} bytes (max ${MAX_FILE_SIZE})`);
  }

  const buffer = await fs.readFile(resolved);

  // Detect if binary
  const isBinary = buffer.includes(0);
  if (isBinary) {
    return { content: buffer.toString('base64'), encoding: 'base64', size: stats.size };
  }

  return { content: buffer.toString('utf-8'), encoding: 'utf-8', size: stats.size };
}

export async function writeFile(filePath: string, content: string, encoding: 'utf-8' | 'base64' = 'utf-8'): Promise<void> {
  const resolved = resolveSafe(filePath);
  // Ensure parent directory exists
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  const buffer = encoding === 'base64' ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf-8');
  await fs.writeFile(resolved, buffer);
}

export async function deleteFile(filePath: string): Promise<void> {
  const resolved = resolveSafe(filePath);
  const stats = await fs.stat(resolved);
  if (stats.isDirectory()) {
    await fs.rm(resolved, { recursive: true, force: true });
  } else {
    await fs.unlink(resolved);
  }
}

export async function renameFile(oldPath: string, newPath: string): Promise<void> {
  const resolvedOld = resolveSafe(oldPath);
  const resolvedNew = resolveSafe(newPath);
  await fs.rename(resolvedOld, resolvedNew);
}

export async function mkdirFile(dirPath: string): Promise<void> {
  const resolved = resolveSafe(dirPath);
  await fs.mkdir(resolved, { recursive: true });
}

export async function statFile(filePath: string): Promise<FileStat> {
  const resolved = resolveSafe(filePath);
  const stats = await fs.stat(resolved);
  return {
    path: path.relative(SANDBOX_ROOT, resolved),
    type: typeFromStats(stats),
    size: stats.size,
    modified: stats.mtime.toISOString(),
    created: stats.birthtime.toISOString(),
    permissions: modeToString(stats.mode),
  };
}
