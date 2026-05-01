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
import { warmDiscoveredAppIconCache } from "./icon-cache";
import { prewarmWindowsAppIcons } from "./app-icon-extractor";
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
let refreshInFlight: Promise<void> | null = null;

function notifyAppsUpdated(payload: { count: number; iconsReady?: boolean }) {
  BrowserWindow.getAllWindows().forEach((win) => {
    try {
      win.webContents.send("apps:updated", payload);
    } catch {
      // Window may already be destroyed.
    }
  });
}

/**
 * Return the cached list. If it is stale, refresh it in the background so
 * search never swaps a warmed icon list for raw Get-StartApps results.
 */
export async function getInstalledApps(forceRefresh = false): Promise<DiscoveredApp[]> {
  const hasCache = cachedApps.length > 0;
  const stale = Date.now() - cacheTimestamp >= CACHE_TTL_MS;

  if (!forceRefresh && hasCache) {
    if (stale && !refreshInFlight) {
      refreshAppCache().catch((e) => {
        logger.warn("[app-discovery] Background app refresh failed:", e?.message || e);
      });
    }
    return cachedApps;
  }

  if (refreshInFlight) {
    await refreshInFlight;
    return cachedApps;
  }

  await refreshAppCache();
  return cachedApps;
}

/**
 * Refresh the app cache in the background. Called on startup and periodically.
 */
export async function refreshAppCache(): Promise<void> {
  if (refreshInFlight) return refreshInFlight;

  // Publish the refreshed list only after icon hints and icon data are warmed.
  refreshInFlight = (async () => {
    let discovered: DiscoveredApp[] = [];
    try {
      discovered = await discoverApps();
      logger.info(`[app-discovery] Discovered ${discovered.length} applications`);
    } catch (e) {
      logger.error("[app-discovery] Failed to discover apps:", e);
      return;
    }

    notifyAppsUpdated({ count: discovered.length, iconsReady: false });

    try {
      await prewarmWindowsAppIcons(discovered);
    } catch (e: any) {
      logger.warn("[app-discovery] Shell COM icon prewarm failed:", e?.message);
    }

    try {
      await warmDiscoveredAppIconCache(discovered, { size: "normal" });
    } catch (e: any) {
      logger.warn("[app-discovery] Electron icon cache warm failed:", e?.message);
    }

    cachedApps = discovered;
    cacheTimestamp = Date.now();
    notifyAppsUpdated({ count: cachedApps.length, iconsReady: true });
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
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
      '      try {',
      '        $s = $wsh.CreateShortcut($_.FullName)',
      '        $lnk[$_.BaseName.ToLower()] = [PSCustomObject]@{',
      '          Target = ($s.TargetPath -as [string])',
      '          Link = $_.FullName',
      '          Icon = ($s.IconLocation -as [string])',
      '        }',
      '      } catch {}',
      '    }',
      '  }',
      '}',
      // UWP package logos: Get-AppxPackage exposes .Logo as a manifest reference, but the
      // actual file on disk is a scale-suffixed variant (e.g. StoreLogo.scale-100.png).
      // Resolve the closest-existing file so iconHint points at a real PNG that Electron's
      // nativeImage can read — shell:AppsFolder URIs cannot be resolved by getFileIcon.
      '$uwpLogos = @{}',
      'try {',
      '  Get-AppxPackage -ErrorAction SilentlyContinue | ForEach-Object {',
      '    $pfn = $_.PackageFamilyName',
      '    if (-not $pfn) { return }',
      '    $logo = $_.Logo -as [string]',
      '    if (-not $logo) { return }',
      '    if (-not (Test-Path -LiteralPath $logo)) {',
      '      $dir = Split-Path -Parent $logo',
      '      $base = [IO.Path]::GetFileNameWithoutExtension($logo)',
      '      if ($dir -and (Test-Path -LiteralPath $dir)) {',
      '        $alt = Get-ChildItem -LiteralPath $dir -Filter "$base.scale-*.png" -ErrorAction SilentlyContinue | Select-Object -First 1',
      '        if (-not $alt) { $alt = Get-ChildItem -LiteralPath $dir -Filter "$base.targetsize-*.png" -ErrorAction SilentlyContinue | Select-Object -First 1 }',
      '        if ($alt) { $logo = $alt.FullName }',
      '      }',
      '    }',
      '    if ($logo -and (Test-Path -LiteralPath $logo)) { $uwpLogos[$pfn.ToLower()] = $logo }',
      '  }',
      '} catch {}',
      'Get-StartApps | Select-Object -First 2000 | ForEach-Object {',
      '  $exe = ""',
      '  $link = ""',
      '  $icon = ""',
      '  if ($_.AppID -match "^[a-zA-Z]:") { $exe = $_.AppID }',
      '  $k = $_.Name.ToLower()',
      '  if ($lnk.ContainsKey($k)) {',
      '    $entry = $lnk[$k]',
      '    if ($entry.Target) { $exe = $entry.Target }',
      '    if ($entry.Link) { $link = $entry.Link }',
      '    if ($entry.Icon) { $icon = $entry.Icon }',
      '  }',
      // UWP AppID is "<PackageFamilyName>!<EntryPoint>" — match the family name to its logo.
      '  if ($_.AppID -match "^([^!]+)!") {',
      '    $pfn = $matches[1].ToLower()',
      '    if ($uwpLogos.ContainsKey($pfn)) { $icon = $uwpLogos[$pfn] }',
      '  }',
      '  [PSCustomObject]@{ Name=$_.Name; AppID=$_.AppID; Exe=$exe; Link=$link; Icon=$icon }',
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
      const shortcutPath = String(entry?.Link ?? "").trim();
      const iconLocation = String(entry?.Icon ?? "").trim();
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
        launchTarget = appId;
        // Prefer the real executable/icon resource for Win32 apps.
        iconHint = resolveSquirrelExe(appId, name) || iconLocation || shortcutPath || appId;
        source = "win32";
      } else if (hasResolvedExe) {
        launchTarget = `shell:AppsFolder\\${appId}`;
        // Shortcuts are still useful as a fallback, but many return a generic blank icon.
        iconHint = resolveSquirrelExe(resolvedExe, name) || iconLocation || shortcutPath || resolvedExe || launchTarget;
        source = "win32";
      } else {
        launchTarget = `shell:AppsFolder\\${appId}`;
        iconHint = iconLocation || shortcutPath || launchTarget;
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
