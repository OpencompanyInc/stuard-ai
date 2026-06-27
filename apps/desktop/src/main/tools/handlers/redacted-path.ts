import fs from 'node:fs';
import path from 'node:path';

const REDACTION_MARKER_RE = /(?:\[redacted\]|<redacted>|\*{3,})/ig;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasRedactionMarker(value: string): boolean {
  return REDACTION_MARKER_RE.test(value);
}

function buildRedactedNameRegex(name: string): RegExp | null {
  REDACTION_MARKER_RE.lastIndex = 0;
  if (!hasRedactionMarker(name)) return null;
  REDACTION_MARKER_RE.lastIndex = 0;
  const pattern = `^${name.split(REDACTION_MARKER_RE).map(escapeRegExp).join('.+?')}$`;
  return new RegExp(pattern, process.platform === 'win32' ? 'i' : '');
}

function statMtime(filePath: string): number {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Recover a real file path when a display-redacted path accidentally reaches
 * tool execution. This is intentionally local and conservative: it only
 * searches the already specified directory and only returns a filename whose
 * visible prefix/suffix match the redacted placeholder.
 */
export function resolveRedactedFilePath(inputPath: string): { path: string; recovered: boolean } {
  const originalPath = String(inputPath || '').trim();
  if (!originalPath) return { path: originalPath, recovered: false };

  try {
    if (fs.existsSync(originalPath)) return { path: originalPath, recovered: false };
  } catch {}

  REDACTION_MARKER_RE.lastIndex = 0;
  if (!hasRedactionMarker(originalPath)) return { path: originalPath, recovered: false };

  const dir = path.dirname(originalPath);
  const base = path.basename(originalPath);
  const nameRegex = buildRedactedNameRegex(base);
  if (!nameRegex) return { path: originalPath, recovered: false };

  try {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      return { path: originalPath, recovered: false };
    }

    const candidates = fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && nameRegex.test(entry.name))
      .map((entry) => path.join(dir, entry.name))
      .sort((a, b) => statMtime(b) - statMtime(a));

    if (candidates.length > 0) {
      return { path: candidates[0], recovered: true };
    }
  } catch {}

  return { path: originalPath, recovered: false };
}
