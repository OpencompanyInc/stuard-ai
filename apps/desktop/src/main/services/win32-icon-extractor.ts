/**
 * Win32 Exe Icon Extractor (Windows)
 *
 * Electron's `app.getFileIcon` goes through SHGetFileInfo, which on Windows 11
 * sometimes returns the generic shell-document icon for legitimate .exes
 * (we hit this with Stuard AI's own exe: ExtractAssociatedIcon returned the
 * proper red logo, SHGetFileInfo returned the gray-document placeholder).
 *
 * This module batches `[System.Drawing.Icon]::ExtractAssociatedIcon` over the
 * full Win32 app list in a single PowerShell process, saves each extracted
 * icon as a PNG under userData, and mutates iconHint to point at the PNG so
 * downstream icon-cache.ts loads it via `nativeImage.createFromPath` (a path
 * Electron handles correctly).
 *
 * Cost: ~1.2s for ~200 apps once per startup, fully amortized across icon
 * resolutions for the rest of the session and across restarts via the cache.
 */

import { app } from "electron";
import { spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import logger from "../utils/logger";
import type { DiscoveredApp } from "./app-discovery";

const CACHE_FILE_NAME = "win32-icons-v1.json";
const CACHE_DIR_NAME = "win32-icons-v1";
const POWERSHELL_TIMEOUT_MS = 60_000;

interface CacheEntry {
  // PNG path on disk (relative to the cache dir)
  png: string;
  // Source exe fingerprint — invalidated when the exe is replaced (updates).
  mtimeMs: number;
  size: number;
}

interface CacheFile {
  generatedAt: number;
  // exe path (lowercased) → entry
  entries: Record<string, CacheEntry>;
}

function cacheDir(): string {
  return path.join(app.getPath("userData"), CACHE_DIR_NAME);
}

function cacheFilePath(): string {
  return path.join(app.getPath("userData"), CACHE_FILE_NAME);
}

function readCache(): CacheFile {
  try {
    const raw = fs.readFileSync(cacheFilePath(), "utf8");
    const parsed = JSON.parse(raw) as CacheFile;
    if (parsed && typeof parsed.entries === "object") return parsed;
  } catch {
    // missing or corrupt — fall through
  }
  return { generatedAt: Date.now(), entries: {} };
}

function writeCache(cache: CacheFile): void {
  try {
    fs.mkdirSync(path.dirname(cacheFilePath()), { recursive: true });
    fs.writeFileSync(cacheFilePath(), JSON.stringify(cache));
  } catch (e: any) {
    logger.warn("[win32-icon-extractor] Failed to write cache:", e?.message);
  }
}

function pngPathFor(exePath: string): string {
  // Hash gives us a filesystem-safe stable filename. Length + collision risk
  // are negligible at this app's scale.
  const hash = crypto.createHash("sha256").update(exePath.toLowerCase()).digest("hex").slice(0, 32);
  return path.join(cacheDir(), `${hash}.png`);
}

interface ExeJob {
  exe: string;
  pngPath: string;
}

/**
 * Run ONE PowerShell process that takes a list of exe paths via stdin and
 * extracts each one's associated icon to its destination PNG file. Returns
 * the set of exe paths that PowerShell reports as successfully extracted
 * (so callers can skip writing cache entries for failed ones).
 */
function runBatchExtract(jobs: ExeJob[]): Promise<Set<string>> {
  return new Promise((resolve) => {
    if (jobs.length === 0) return resolve(new Set());

    // Script consumes <exe>|<png> lines from stdin until EOF. We pass jobs via
    // stdin rather than a long flag because the cumulative path length blows
    // past the command-line cap with 200 apps.
    //
    // Note: `[Console]::In.ReadLine()` returns $null on EOF on Windows
    // PowerShell when stdin is a piped handle; `EndOfStream` does NOT update
    // reliably across the pipe and made the previous version hang ~100s
    // after the work was actually done.
    const psScript = [
      "$ErrorActionPreference = 'Continue'",
      "Add-Type -AssemblyName System.Drawing",
      "$ok = New-Object System.Collections.ArrayList",
      "while ($null -ne ($line = [Console]::In.ReadLine())) {",
      "  if (-not $line) { continue }",
      "  $parts = $line -split '\\|', 2",
      "  if ($parts.Count -lt 2) { continue }",
      "  $exe = $parts[0]",
      "  $out = $parts[1]",
      "  try {",
      "    if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { continue }",
      "    $ico = [System.Drawing.Icon]::ExtractAssociatedIcon($exe)",
      "    if (-not $ico) { continue }",
      "    $bmp = $ico.ToBitmap()",
      "    $dir = Split-Path -Parent $out",
      "    if ($dir -and -not (Test-Path -LiteralPath $dir)) { [void](New-Item -ItemType Directory -Path $dir -Force) }",
      "    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)",
      "    $bmp.Dispose()",
      "    $ico.Dispose()",
      "    [void]$ok.Add($exe)",
      "  } catch { }",
      "}",
      "$ok | ForEach-Object { Write-Output $_ }",
    ].join("\n");
    const encoded = Buffer.from(psScript, "utf16le").toString("base64");

    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
      { windowsHide: true },
    );

    let stdout = "";
    let settled = false;
    const done = (value: Set<string>) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
      logger.warn(
        `[win32-icon-extractor] PowerShell batch timed out after ${POWERSHELL_TIMEOUT_MS}ms (${jobs.length} jobs)`,
      );
      done(new Set());
    }, POWERSHELL_TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.on("error", (err: any) => {
      clearTimeout(timer);
      logger.warn("[win32-icon-extractor] spawn failed:", err?.message || err);
      done(new Set());
    });
    child.on("close", () => {
      clearTimeout(timer);
      const ok = new Set<string>();
      for (const line of stdout.split(/\r?\n/)) {
        const t = line.trim();
        if (t) ok.add(t.toLowerCase());
      }
      done(ok);
    });

    // Feed jobs over stdin so we don't blow the command-line length cap.
    try {
      for (const job of jobs) {
        child.stdin.write(`${job.exe}|${job.pngPath}\n`);
      }
      child.stdin.end();
    } catch (e: any) {
      logger.warn("[win32-icon-extractor] stdin write failed:", e?.message);
      try { child.kill(); } catch { /* ignore */ }
      done(new Set());
    }
  });
}

/**
 * Extract icons for every Win32 app whose iconHint is an .exe path, save the
 * result as a PNG under userData, and mutate iconHint to point at the PNG.
 *
 * Cached: a per-exe (mtimeMs, size) fingerprint invalidates the entry when
 * Windows replaces the exe (app updates), without paying a full re-scan when
 * nothing changed.
 */
export async function prewarmWin32AppIcons(apps: DiscoveredApp[]): Promise<void> {
  if (process.platform !== "win32" || apps.length === 0) return;

  fs.mkdirSync(cacheDir(), { recursive: true });
  const cache = readCache();
  const newEntries: Record<string, CacheEntry> = {};
  const jobs: ExeJob[] = [];
  // Track which apps map to which exe so we can replay the mutation step
  // once extraction is done.
  const exeToApps = new Map<string, DiscoveredApp[]>();

  for (const a of apps) {
    if (a?.source !== "win32") continue;
    const exe = String(a.iconHint || "").trim();
    if (!exe || !exe.toLowerCase().endsWith(".exe")) continue;

    let stat: fs.Stats;
    try {
      stat = fs.statSync(exe);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;

    const lower = exe.toLowerCase();
    const existing = cache.entries[lower];
    const fingerprintsMatch =
      existing
      && existing.size === stat.size
      && Math.trunc(existing.mtimeMs) === Math.trunc(stat.mtimeMs);

    const pngPath = pngPathFor(exe);

    // Reuse cached PNG if its source exe is unchanged AND the PNG still exists.
    if (fingerprintsMatch && fs.existsSync(pngPath)) {
      newEntries[lower] = existing;
      a.iconHint = pngPath;
      continue;
    }

    // Group apps by exe so we don't queue duplicate extraction work when
    // multiple AppIDs share the same .exe (rare but possible).
    if (!exeToApps.has(lower)) {
      exeToApps.set(lower, []);
      jobs.push({ exe, pngPath });
    }
    exeToApps.get(lower)!.push(a);
    // Stash the fingerprint we'll need to record on success.
    newEntries[lower] = { png: pngPath, mtimeMs: stat.mtimeMs, size: stat.size };
  }

  if (jobs.length === 0) {
    writeCache({ generatedAt: Date.now(), entries: newEntries });
    return;
  }

  logger.info(`[win32-icon-extractor] Extracting ${jobs.length} Win32 icons via PowerShell`);
  const start = Date.now();
  const extracted = await runBatchExtract(jobs);
  const elapsed = Date.now() - start;
  logger.info(
    `[win32-icon-extractor] Extracted ${extracted.size}/${jobs.length} icons in ${elapsed}ms`,
  );

  // Apply iconHint for successfully-extracted apps. Drop tentative cache
  // entries for any exe PS couldn't process (e.g. permission denied) so we
  // try again next launch instead of poisoning the cache with bad mappings.
  for (const job of jobs) {
    const lower = job.exe.toLowerCase();
    if (!extracted.has(lower)) {
      delete newEntries[lower];
      continue;
    }
    const targetApps = exeToApps.get(lower);
    if (!targetApps) continue;
    for (const a of targetApps) {
      a.iconHint = job.pngPath;
    }
  }

  writeCache({ generatedAt: Date.now(), entries: newEntries });
}
