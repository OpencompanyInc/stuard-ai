import { app, nativeImage } from "electron";
import * as fs from "fs";
import * as path from "path";
import logger from "../utils/logger";

type IconSize = "small" | "normal" | "large";

interface CachedIconEntry {
  expiresAt: number;
  ok: boolean;
  dataUrl?: string;
  error?: string;
}

interface WarmableAppIconTarget {
  id?: string;
  iconHint?: string;
  launchTarget?: string;
}

const SUCCESS_TTL_MS = 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 30 * 60 * 1000;
const fileIconCache = new Map<string, CachedIconEntry>();
const inFlightIconLoads = new Map<string, Promise<{ ok: boolean; dataUrl?: string; error?: string }>>();

function cacheKeyFor(filePath: string, size: IconSize = "normal"): string {
  return `${size}:${normalizeIconPath(filePath).toLowerCase()}`;
}

function normalizeIconPath(input: string): string {
  let value = String(input || "").trim();
  if (!value) return "";

  if (process.platform === "win32") {
    value = value.replace(/%([^%]+)%/g, (_match, name) => {
      const key = String(name || "").trim();
      return key ? String(process.env[key] ?? _match) : _match;
    });
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1).trim();
    }
    const resourceMatch = value.match(/^(.*?),\s*\d+$/);
    if (resourceMatch?.[1]) {
      value = resourceMatch[1].trim();
    }
  }

  return value;
}

function resolveSquirrelExecutable(updateExePath: string): string {
  try {
    if (!updateExePath.toLowerCase().endsWith("update.exe")) return updateExePath;
    const dir = path.dirname(updateExePath);
    const appDirs = fs.readdirSync(dir)
      .filter((entry) => entry.startsWith("app-"))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    if (appDirs.length === 0) return updateExePath;

    const latestDir = path.join(dir, appDirs[0]);
    const exes = fs.readdirSync(latestDir).filter((file) => (
      file.toLowerCase().endsWith(".exe")
      && file.toLowerCase() !== "update.exe"
      && !file.toLowerCase().includes("squirrel")
      && !file.toLowerCase().includes("unins")
    ));
    if (exes.length === 0) return updateExePath;
    return path.join(latestDir, exes[0]);
  } catch {
    return updateExePath;
  }
}

function isGenericIcon(image: Electron.NativeImage): boolean {
  const size = image.getSize();
  if (size.width < 2 || size.height < 2) return true;
  const buf = image.toBitmap();
  if (buf.length < 16) return true;
  const first = buf[0];
  let allSame = true;
  for (let i = 4; i < Math.min(buf.length, 400); i += 4) {
    if (buf[i] !== first) { allSame = false; break; }
  }
  return allSame;
}

async function loadFileIcon(filePath: string, size: IconSize = "normal"): Promise<{ ok: boolean; dataUrl?: string; error?: string }> {
  const cleaned = normalizeIconPath(filePath);
  if (!cleaned) return { ok: false, error: "invalid_path" };

  const lower = cleaned.toLowerCase();

  // .lnk shortcut files: Windows natively resolves the embedded icon
  if (process.platform === "win32" && lower.endsWith(".lnk")) {
    try {
      if (fs.existsSync(cleaned)) {
        const image = await app.getFileIcon(cleaned, { size });
        if (image && !image.isEmpty() && !isGenericIcon(image)) {
          return { ok: true, dataUrl: image.toDataURL() };
        }
      }
    } catch { /* fall through */ }
  }

  if (process.platform === "win32" && lower.endsWith("update.exe")) {
    try {
      const candidate = resolveSquirrelExecutable(cleaned);
      if (candidate && candidate !== cleaned) {
        const squirrelImage = await app.getFileIcon(candidate, { size });
        if (squirrelImage && !squirrelImage.isEmpty()) {
          return { ok: true, dataUrl: squirrelImage.toDataURL() };
        }
      }
    } catch { /* fall through */ }
  }

  if (lower.endsWith(".ico") || lower.endsWith(".png") || lower.endsWith(".bmp")) {
    try {
      if (fs.existsSync(cleaned)) {
        const image = nativeImage.createFromPath(cleaned);
        if (image && !image.isEmpty()) {
          return { ok: true, dataUrl: image.toDataURL() };
        }
      }
    } catch { /* fall through */ }
  }

  try {
    const image = await app.getFileIcon(cleaned, { size });
    if (image && !image.isEmpty()) {
      return { ok: true, dataUrl: image.toDataURL() };
    }
  } catch (error: any) {
    return { ok: false, error: String(error?.message || "failed") };
  }

  return { ok: false, error: "no_icon" };
}

export function peekCachedFileIcon(pathsToTry: string[], size: IconSize = "normal"): string | undefined {
  for (const rawPath of pathsToTry) {
    const normalized = normalizeIconPath(rawPath);
    if (!normalized) continue;
    const entry = fileIconCache.get(cacheKeyFor(normalized, size));
    if (!entry) continue;
    if (entry.expiresAt <= Date.now()) {
      fileIconCache.delete(cacheKeyFor(normalized, size));
      continue;
    }
    if (entry.ok && entry.dataUrl) return entry.dataUrl;
  }
  return undefined;
}

export async function getFileIconCached(
  filePath: string,
  options?: { size?: IconSize }
): Promise<{ ok: boolean; dataUrl?: string; error?: string }> {
  const size = options?.size || "normal";
  const normalized = normalizeIconPath(filePath);
  if (!normalized) return { ok: false, error: "invalid_path" };

  const key = cacheKeyFor(normalized, size);
  const cached = fileIconCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.ok
      ? { ok: true, dataUrl: cached.dataUrl }
      : { ok: false, error: cached.error || "no_icon" };
  }

  const inFlight = inFlightIconLoads.get(key);
  if (inFlight) return inFlight;

  const loadPromise = (async () => {
    const result = await loadFileIcon(normalized, size);
    fileIconCache.set(key, {
      expiresAt: Date.now() + (result.ok ? SUCCESS_TTL_MS : MISS_TTL_MS),
      ok: result.ok,
      dataUrl: result.dataUrl,
      error: result.error,
    });
    if (fileIconCache.size > 5000) {
      const oldestKey = fileIconCache.keys().next().value;
      if (oldestKey) fileIconCache.delete(oldestKey);
    }
    return result;
  })();

  inFlightIconLoads.set(key, loadPromise);
  try {
    return await loadPromise;
  } catch (error: any) {
    const result = { ok: false as const, error: String(error?.message || "failed") };
    fileIconCache.set(key, {
      expiresAt: Date.now() + MISS_TTL_MS,
      ok: false,
      error: result.error,
    });
    return result;
  } finally {
    inFlightIconLoads.delete(key);
  }
}

export async function warmFileIconCache(pathsToTry: string[], options?: { size?: IconSize }): Promise<void> {
  const size = options?.size || "normal";
  const uniquePaths = Array.from(new Set(pathsToTry.map(normalizeIconPath).filter(Boolean)));
  if (uniquePaths.length === 0) return;

  const concurrency = 6;
  for (let index = 0; index < uniquePaths.length; index += concurrency) {
    const batch = uniquePaths.slice(index, index + concurrency);
    await Promise.all(batch.map(async (iconPath) => {
      try {
        await getFileIconCached(iconPath, { size });
      } catch {
        // Misses are cached; no action needed here.
      }
    }));
  }
}

export async function warmDiscoveredAppIconCache(
  apps: WarmableAppIconTarget[],
  options?: { size?: IconSize }
): Promise<void> {
  const size = options?.size || "normal";
  const seen = new Set<string>();
  const tasks: string[] = [];

  for (const appTarget of apps) {
    if (!appTarget) continue;
    const candidates = [appTarget.iconHint, appTarget.launchTarget, appTarget.id].filter(Boolean) as string[];
    for (const raw of candidates) {
      const norm = normalizeIconPath(raw);
      if (!norm) continue;
      const key = norm.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      tasks.push(norm);
    }
  }

  if (tasks.length === 0) return;

  const concurrency = 10;
  for (let i = 0; i < tasks.length; i += concurrency) {
    const batch = tasks.slice(i, i + concurrency);
    await Promise.all(batch.map(async (iconPath) => {
      try {
        await getFileIconCached(iconPath, { size });
      } catch { /* cached as miss */ }
    }));
  }
}
