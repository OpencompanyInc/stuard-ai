import * as path from 'path';
import { app } from 'electron';

// Security: Allowed base directories for file operations
// Custom UIs can only read/write within these directories
function getAllowedBasePaths(): string[] {
  return [
    app.getPath('userData'),
    app.getPath('temp'),
    app.getPath('downloads'),
    app.getPath('documents'),
    app.getPath('desktop'),
  ];
}

// Security: Track user-approved paths per window session
const userApprovedPaths = new Map<number, Set<string>>();

export function approvePathForWindow(webContentsId: number, filePath: string): void {
  const resolved = path.resolve(filePath);
  if (!userApprovedPaths.has(webContentsId)) {
    userApprovedPaths.set(webContentsId, new Set());
  }
  userApprovedPaths.get(webContentsId)!.add(resolved);
}

export function isPathAllowed(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  const allowed = getAllowedBasePaths();
  return allowed.some(base => resolved.startsWith(path.resolve(base)));
}

export function isPathApprovedForWindow(webContentsId: number, filePath: string): boolean {
  const resolved = path.resolve(filePath);
  const approved = userApprovedPaths.get(webContentsId);
  if (!approved) return false;
  // Check exact match or if it's within an approved directory
  for (const approvedPath of approved) {
    if (resolved === approvedPath || resolved.startsWith(approvedPath + path.sep)) {
      return true;
    }
  }
  return false;
}
