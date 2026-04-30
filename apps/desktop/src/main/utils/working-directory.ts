import fs from 'fs';
import os from 'os';
import path from 'path';

function expandHomeDirectory(input: string): string {
  if (input === '~') return os.homedir();
  if (input.startsWith('~/') || input.startsWith('~\\')) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

function resolveExistingDirectory(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined;

  const trimmed = input.trim();
  if (!trimmed) return undefined;

  const expanded = expandHomeDirectory(trimmed);
  if (expanded.includes('{{') && expanded.includes('}}')) {
    return undefined;
  }

  try {
    const resolved = path.resolve(expanded);
    if (!fs.existsSync(resolved)) return undefined;
    if (!fs.statSync(resolved).isDirectory()) return undefined;
    return resolved;
  } catch {
    return undefined;
  }
}

export function normalizeOptionalWorkingDirectory(input: unknown): string | undefined {
  return resolveExistingDirectory(input);
}

export function normalizeWorkingDirectory(input: unknown, fallbackCwd: string = process.cwd()): string {
  const fallback = resolveExistingDirectory(fallbackCwd) || process.cwd();
  return resolveExistingDirectory(input) || fallback;
}
