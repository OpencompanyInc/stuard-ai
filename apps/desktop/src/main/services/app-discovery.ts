/**
 * Native Application Discovery Service
 *
 * Discovers installed GUI applications using native OS APIs instead of
 * crawling directories and parsing .lnk/.desktop files.
 *
 * - Windows: PowerShell Get-StartApps (indexes UWP + Win32 apps)
 * - macOS:   mdfind Spotlight query for com.apple.application-bundle
 * - Linux:   XDG .desktop file scanning (the official standard)
 */

import { exec } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs";
import { app, BrowserWindow } from "electron";
import logger from "../utils/logger";

const execAsync = promisify(exec);

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

export interface DiscoveredApp {
  /** Display name shown to the user */
  name: string;
  /** Unique identifier: exe path on Win, .app path on Mac, .desktop path on Linux */
  id: string;
  /** How to launch this app (file path, shell: URI, or exec command) */
  launchTarget: string;
  /** Path to use for icon resolution  */
  iconHint: string;
  /** Source: "uwp" | "win32" | "spotlight" | "xdg" */
  source: string;
  /** Lower-cased, whitespace-normalized name for fast search */
  _searchName: string;
  /** Individual search tokens for fuzzy matching */
  _tokens: string[];
}

// ─────────────────────────────────────────────────────────
// Cache
// ─────────────────────────────────────────────────────────

let cachedApps: DiscoveredApp[] = [];
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Return the cached list or refresh if stale.
 */
export async function getInstalledApps(forceRefresh = false): Promise<DiscoveredApp[]> {
  if (!forceRefresh && cachedApps.length > 0 && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
    return cachedApps;
  }
  try {
    cachedApps = await discoverApps();
    cacheTimestamp = Date.now();
    logger.info(`[app-discovery] Discovered ${cachedApps.length} applications`);
  } catch (e) {
    logger.error("[app-discovery] Failed to discover apps:", e);
  }
  return cachedApps;
}

/**
 * Refresh the app cache in the background. Called on startup and periodically.
 */
export async function refreshAppCache(): Promise<void> {
  await getInstalledApps(true);
  // Notify renderers that the app list has changed
  BrowserWindow.getAllWindows().forEach((win) => {
    try {
      win.webContents.send("apps:updated", { count: cachedApps.length });
    } catch { /* window may be destroyed */ }
  });
}

// ─────────────────────────────────────────────────────────
// Platform dispatching
// ─────────────────────────────────────────────────────────

async function discoverApps(): Promise<DiscoveredApp[]> {
  switch (process.platform) {
    case "win32":
      return discoverWindows();
    case "darwin":
      return discoverMacOS();
    case "linux":
      return discoverLinux();
    default:
      return [];
  }
}

// ─────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────

/** Build search-optimized name fields */
function makeSearchFields(name: string): Pick<DiscoveredApp, "_searchName" | "_tokens"> {
  const normalized = name.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  return {
    _searchName: normalized,
    _tokens: normalized.split(" ").filter(Boolean),
  };
}

/**
 * For Squirrel-based apps (Discord, Slack, etc.) where the .lnk target is
 * Update.exe, find the actual app .exe inside the latest app-* subdirectory.
 * This is needed because Update.exe has a generic icon.
 */
function resolveSquirrelExe(updateExePath: string, appName: string): string {
  try {
    const dir = path.dirname(updateExePath);
    const baseName = path.basename(updateExePath).toLowerCase();
    if (baseName !== 'update.exe') return updateExePath;

    // Look for app-* directories (Squirrel convention)
    const entries = fs.readdirSync(dir).filter(e => e.startsWith('app-'));
    if (entries.length === 0) return updateExePath;

    // Sort by version descending to pick latest
    entries.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    const latestAppDir = path.join(dir, entries[0]);

    // Look for an exe matching the app name, or any non-Update exe
    const normalized = appName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const exes = fs.readdirSync(latestAppDir).filter(f => f.toLowerCase().endsWith('.exe'));

    // Prefer exact name match (e.g. Discord.exe for Discord)
    for (const exe of exes) {
      const exeBase = exe.toLowerCase().replace(/\.exe$/i, '').replace(/[^a-z0-9]/g, '');
      if (exeBase === normalized) return path.join(latestAppDir, exe);
    }
    // Fallback: first non-Update, non-squirrel exe
    for (const exe of exes) {
      const low = exe.toLowerCase();
      if (low !== 'update.exe' && !low.includes('squirrel') && !low.includes('unins')) {
        return path.join(latestAppDir, exe);
      }
    }
  } catch { /* permission denied, etc. */ }
  return updateExePath;
}

/** Filter out obvious non-app entries */
const EXCLUDE_PATTERNS = [
  /uninstall/i,
  /readme/i,
  /changelog/i,
  /license/i,
  /\.chm$/i,
  /\.url$/i,
  /\.txt$/i,
  /\.pdf$/i,
  /\.html?$/i,
  /release\s*notes/i,
  /what'?s\s*new/i,
  /user\s*guide/i,
  /documentation/i,
  /help\s*file/i,
];

function shouldExclude(name: string, id: string): boolean {
  const combined = `${name} ${id}`;
  return EXCLUDE_PATTERNS.some((p) => p.test(combined));
}

// ─────────────────────────────────────────────────────────
//  Windows: Get-StartApps
// ─────────────────────────────────────────────────────────

async function discoverWindows(): Promise<DiscoveredApp[]> {
  const apps: DiscoveredApp[] = [];
  const seen = new Set<string>();

  try {
    // Single PowerShell invocation that:
    // 1. Calls Get-StartApps for the authoritative list of apps
    // 2. Resolves .lnk targets from Start Menu dirs to get actual .exe paths for icons
    // We use -EncodedCommand to avoid all quoting/escaping headaches.
    const psScript = [
      '$lnk = @{}',
      '$wsh = New-Object -ComObject WScript.Shell',
      '$dirs = @(($env:APPDATA + "\\Microsoft\\Windows\\Start Menu\\Programs"),($env:ProgramData + "\\Microsoft\\Windows\\Start Menu\\Programs"))',
      'foreach ($d in $dirs) {',
      '  if (Test-Path $d) {',
      '    Get-ChildItem $d -Recurse -Filter "*.lnk" -ErrorAction SilentlyContinue | ForEach-Object {',
      '      try { $s = $wsh.CreateShortcut($_.FullName); if ($s.TargetPath) { $lnk[$_.BaseName.ToLower()] = $s.TargetPath } } catch {}',
      '    }',
      '  }',
      '}',
      'Get-StartApps | Select-Object -First 2000 | ForEach-Object {',
      '  $exe = ""',
      '  if ($_.AppID -match "^[a-zA-Z]:") { $exe = $_.AppID }',
      '  else { $k = $_.Name.ToLower(); if ($lnk.ContainsKey($k)) { $exe = $lnk[$k] } }',
      '  [PSCustomObject]@{ Name=$_.Name; AppID=$_.AppID; Exe=$exe }',
      '} | ConvertTo-Json -Compress',
    ].join('\n');

    // Encode as UTF-16LE base64 for -EncodedCommand
    const encoded = Buffer.from(psScript, 'utf16le').toString('base64');

    const { stdout } = await execAsync(
      `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
      { maxBuffer: 10 * 1024 * 1024, timeout: 30000 }
    );

    let raw: any[];
    try {
      const parsed = JSON.parse(stdout.trim());
      raw = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      logger.warn("[app-discovery] Failed to parse PowerShell JSON");
      return [];
    }

    for (const entry of raw) {
      const name = String(entry?.Name ?? "").trim();
      const appId = String(entry?.AppID ?? "").trim();
      const resolvedExe = String(entry?.Exe ?? "").trim();
      if (!name || !appId) continue;
      if (shouldExclude(name, appId)) continue;

      // De-duplicate by lower name
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      // Win32 apps have a path like "C:\...\foo.exe"
      // UWP apps have an AppID like "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App"
      const isAbsolutePath = /^[a-z]:\\/i.test(appId);
      const hasResolvedExe = /^[a-z]:\\/i.test(resolvedExe);

      let launchTarget: string;
      let iconHint: string;
      let source: string;

      if (isAbsolutePath) {
        // Direct .exe path — resolve Squirrel if needed
        launchTarget = appId;
        iconHint = resolveSquirrelExe(appId, name);
        source = "win32";
      } else if (hasResolvedExe) {
        // We resolved the actual .exe via Start Menu shortcut target
        launchTarget = `shell:AppsFolder\\${appId}`;
        iconHint = resolveSquirrelExe(resolvedExe, name);  // resolve Squirrel Update.exe → real app exe
        source = "win32";
      } else {
        // UWP / Store app — no .exe path, use shell:AppsFolder for launch
        launchTarget = `shell:AppsFolder\\${appId}`;
        iconHint = "";  // will use fallback icon
        source = "uwp";
      }

      apps.push({
        name,
        id: appId,
        launchTarget,
        iconHint,
        source,
        ...makeSearchFields(name),
      });
    }
  } catch (e: any) {
    logger.error("[app-discovery] Get-StartApps failed:", e?.message);
  }

  return apps;
}

// ─────────────────────────────────────────────────────────
//  macOS: mdfind (Spotlight)
// ─────────────────────────────────────────────────────────

async function discoverMacOS(): Promise<DiscoveredApp[]> {
  const apps: DiscoveredApp[] = [];
  const seen = new Set<string>();

  try {
    const { stdout } = await execAsync(
      `mdfind "kMDItemContentType == 'com.apple.application-bundle'" 2>/dev/null`,
      { maxBuffer: 10 * 1024 * 1024, timeout: 15000 }
    );

    const lines = stdout.split("\n").filter(Boolean);
    for (const appPath of lines) {
      const trimmed = appPath.trim();
      if (!trimmed || !trimmed.endsWith(".app")) continue;

      const name = path.basename(trimmed, ".app");
      if (!name) continue;
      if (shouldExclude(name, trimmed)) continue;

      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      apps.push({
        name,
        id: trimmed,
        launchTarget: trimmed,
        iconHint: trimmed,
        source: "spotlight",
        ...makeSearchFields(name),
      });
    }
  } catch (e: any) {
    logger.error("[app-discovery] mdfind failed:", e?.message);
    // Fallback: scan /Applications directly
    return discoverMacOsFallback();
  }

  return apps;
}

async function discoverMacOsFallback(): Promise<DiscoveredApp[]> {
  const apps: DiscoveredApp[] = [];
  const seen = new Set<string>();
  const dirs = ["/Applications", "/Applications/Utilities", path.join(app.getPath("home"), "Applications"), "/System/Applications"];

  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir)) continue;
      for (const entry of fs.readdirSync(dir)) {
        if (!entry.endsWith(".app")) continue;
        const name = entry.replace(/\.app$/, "");
        const key = name.toLowerCase();
        if (seen.has(key) || shouldExclude(name, entry)) continue;
        seen.add(key);
        const fullPath = path.join(dir, entry);
        apps.push({
          name,
          id: fullPath,
          launchTarget: fullPath,
          iconHint: fullPath,
          source: "spotlight",
          ...makeSearchFields(name),
        });
      }
    } catch { /* permission denied, etc. */ }
  }
  return apps;
}

// ─────────────────────────────────────────────────────────
//  Linux: XDG .desktop files
// ─────────────────────────────────────────────────────────

async function discoverLinux(): Promise<DiscoveredApp[]> {
  const apps: DiscoveredApp[] = [];
  const seen = new Set<string>();
  const homedir = app.getPath("home");

  const dirs = [
    "/usr/share/applications",
    "/usr/local/share/applications",
    path.join(homedir, ".local", "share", "applications"),
    "/var/lib/flatpak/exports/share/applications",
    path.join(homedir, ".local", "share", "flatpak", "exports", "share", "applications"),
    "/var/lib/snapd/desktop/applications",
  ];

  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir)) continue;
      for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith(".desktop")) continue;
        const fullPath = path.join(dir, file);
        try {
          const content = fs.readFileSync(fullPath, "utf-8");
          const entry = parseDesktopEntry(content);
          if (!entry) continue;
          if (entry.noDisplay || entry.hidden) continue;

          const name = entry.name;
          const key = name.toLowerCase();
          if (seen.has(key) || shouldExclude(name, file)) continue;
          seen.add(key);

          apps.push({
            name,
            id: fullPath,
            launchTarget: entry.exec,
            iconHint: entry.icon || "",
            source: "xdg",
            ...makeSearchFields(name),
          });
        } catch { /* unreadable desktop file */ }
      }
    } catch { /* permission denied */ }
  }

  return apps;
}

interface DesktopEntry {
  name: string;
  exec: string;
  icon: string;
  noDisplay: boolean;
  hidden: boolean;
}

function parseDesktopEntry(content: string): DesktopEntry | null {
  const lines = content.split("\n");
  let inSection = false;
  let name = "";
  let exec = "";
  let icon = "";
  let noDisplay = false;
  let hidden = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "[Desktop Entry]") {
      inSection = true;
      continue;
    }
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      if (inSection) break; // left [Desktop Entry] section
      continue;
    }
    if (!inSection) continue;

    if (trimmed.startsWith("Name=") && !name) {
      name = trimmed.slice(5).trim();
    } else if (trimmed.startsWith("Exec=")) {
      exec = trimmed.slice(5).trim().replace(/%[fFuUdDnNickvm]/g, "").trim();
    } else if (trimmed.startsWith("Icon=")) {
      icon = trimmed.slice(5).trim();
    } else if (trimmed.startsWith("NoDisplay=")) {
      noDisplay = trimmed.slice(10).trim().toLowerCase() === "true";
    } else if (trimmed.startsWith("Hidden=")) {
      hidden = trimmed.slice(7).trim().toLowerCase() === "true";
    }
  }

  if (!name || !exec) return null;
  return { name, exec, icon, noDisplay, hidden };
}
