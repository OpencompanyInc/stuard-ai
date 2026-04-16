/**
 * UWP App Icon Resolver (Windows)
 *
 * Resolves per-app icons for installed UWP/Store apps by parsing each
 * package's AppxManifest.xml — the same source Windows itself uses to render
 * Start Menu tiles, so this is the most reliable path available without
 * admin rights.
 *
 * For each package we read <uap:VisualElements Square44x44Logo="..." /> on
 * every <Application> entry, then resolve the relative logo path to a real
 * PNG on disk (UWP stores per-scale variants like Logo.scale-200.png rather
 * than the bare filename in the manifest).
 *
 * The discovered (AppID → PNG path) map is cached on disk so subsequent
 * launches can skip the PowerShell scan unless invalidated.
 *
 * Win32 apps are skipped entirely — their iconHint already points at a real
 * .exe that Electron's nativeImage handles natively.
 */

import { app } from "electron";
import { exec } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs";
import logger from "../utils/logger";
import type { DiscoveredApp } from "./app-discovery";

const execAsync = promisify(exec);

const CACHE_FILE_NAME = "uwp-icons-v1.json";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 1 day — apps rarely move once installed
const POWERSHELL_TIMEOUT_MS = 60_000;
const POWERSHELL_BUFFER = 32 * 1024 * 1024;

interface CacheFile {
  generatedAt: number;
  // Lower-cased AppID → absolute PNG path
  icons: Record<string, string>;
}

function cacheFilePath(): string {
  return path.join(app.getPath("userData"), CACHE_FILE_NAME);
}

async function readCache(): Promise<CacheFile | null> {
  try {
    const raw = await fs.promises.readFile(cacheFilePath(), "utf8");
    const parsed = JSON.parse(raw) as CacheFile;
    if (!parsed?.icons || typeof parsed.generatedAt !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeCache(cache: CacheFile): Promise<void> {
  try {
    await fs.promises.writeFile(cacheFilePath(), JSON.stringify(cache), "utf8");
  } catch (e: any) {
    logger.warn("[app-icon-extractor] Failed to persist UWP icon cache:", e?.message);
  }
}

/**
 * Mutate iconHint on each UWP app to point at the resolved PNG, when one is
 * known. Win32 apps are left alone.
 */
function applyIcons(apps: DiscoveredApp[], icons: Record<string, string>): number {
  let updated = 0;
  for (const a of apps) {
    if (!a?.id) continue;
    if (a.source !== "uwp") continue;
    const png = icons[a.id.toLowerCase()];
    if (png && a.iconHint !== png) {
      a.iconHint = png;
      updated++;
    }
  }
  return updated;
}

export async function prewarmWindowsAppIcons(apps: DiscoveredApp[]): Promise<void> {
  if (process.platform !== "win32" || apps.length === 0) return;

  // Use the on-disk cache immediately if it's fresh — avoids a multi-second
  // Get-AppxPackage scan on every startup.
  const cached = await readCache();
  const cacheFresh = cached && Date.now() - cached.generatedAt < CACHE_TTL_MS;
  if (cached) {
    const applied = applyIcons(apps, cached.icons);
    if (applied) logger.info(`[app-icon-extractor] Applied ${applied} cached UWP icons`);
  }

  if (cacheFresh) return;

  logger.info("[app-icon-extractor] Refreshing UWP icon map via AppxManifest scan");

  const fresh = await scanUwpManifests();
  if (!fresh) return;

  const applied = applyIcons(apps, fresh);
  logger.info(`[app-icon-extractor] Resolved ${Object.keys(fresh).length} UWP icons (${applied} newly applied)`);

  await writeCache({ generatedAt: Date.now(), icons: fresh });
}

/**
 * Run the PowerShell scan and return a lower-cased AppID → PNG path map, or
 * null on failure. Only apps with a resolvable on-disk PNG are included.
 */
async function scanUwpManifests(): Promise<Record<string, string> | null> {
  const psScript = buildPowerShellScript();
  const encoded = Buffer.from(psScript, "utf16le").toString("base64");

  let stdout: string;
  try {
    const result = await execAsync(
      `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
      { maxBuffer: POWERSHELL_BUFFER, timeout: POWERSHELL_TIMEOUT_MS }
    );
    stdout = result.stdout;
  } catch (e: any) {
    logger.warn("[app-icon-extractor] AppxManifest scan failed:", e?.message || e);
    return null;
  }

  const trimmed = stdout.trim();
  if (!trimmed) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (e: any) {
    logger.warn("[app-icon-extractor] Failed to parse manifest scan output:", e?.message);
    return null;
  }

  // ConvertTo-Json wraps single-entry results as an object; multi-entry as an
  // array of {AppID, Png}. Normalize both shapes into the lookup map.
  const out: Record<string, string> = {};
  const list = Array.isArray(parsed) ? parsed : [parsed];
  for (const entry of list) {
    const appId = String((entry as any)?.AppID ?? "").trim();
    const png = String((entry as any)?.Png ?? "").trim();
    if (!appId || !png) continue;
    out[appId.toLowerCase()] = png;
  }
  return out;
}

/**
 * PowerShell script that walks every installed AppxPackage's manifest and
 * emits {AppID, Png} pairs. Per-app logos take precedence over the package
 * Logo because they're what Windows actually shows in the Start Menu.
 *
 * Scale-variant resolution: the manifest stores e.g. "Assets\Square44x44Logo.png"
 * but on disk that file is split into Square44x44Logo.scale-100.png,
 * scale-200.png, targetsize-32.png, etc. We probe in preference order until
 * we find one that exists.
 */
function buildPowerShellScript(): string {
  return [
    "$ErrorActionPreference = 'Continue'",
    "$ProgressPreference = 'SilentlyContinue'",
    "",
    // Helper: given an install location and a relative logo path from the
    // manifest, return the first matching file on disk or $null.
    "function Resolve-LogoFile($installRoot, $relativePath) {",
    "  if (-not $installRoot -or -not $relativePath) { return $null }",
    // Manifests sometimes use forward slashes; normalize.
    "  $relativePath = $relativePath -replace '/', '\\'",
    "  $abs = Join-Path $installRoot $relativePath",
    "  if (Test-Path -LiteralPath $abs -PathType Leaf) { return $abs }",
    "  $dir = Split-Path -Parent $abs",
    "  $base = [IO.Path]::GetFileNameWithoutExtension($abs)",
    "  $ext = [IO.Path]::GetExtension($abs)",
    "  if (-not $ext) { $ext = '.png' }",
    "  if (-not (Test-Path -LiteralPath $dir -PathType Container)) { return $null }",
    // Preferred scales for ~64px display target: scale-200 first (high-DPI
    // friendly), then 100, then larger fallbacks.
    "  $scales = @('scale-200', 'scale-100', 'scale-150', 'scale-125', 'scale-400', 'scale-300')",
    "  foreach ($s in $scales) {",
    "    $candidate = Join-Path $dir ($base + '.' + $s + $ext)",
    "    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }",
    "  }",
    // targetsize-* variants (used by some packages instead of scale-*).
    "  $targetSizes = @('targetsize-48', 'targetsize-32', 'targetsize-64', 'targetsize-96', 'targetsize-256')",
    "  foreach ($t in $targetSizes) {",
    "    $candidate = Join-Path $dir ($base + '.' + $t + $ext)",
    "    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }",
    "  }",
    // Last resort: any file matching base.*ext in the directory.
    "  try {",
    "    $any = Get-ChildItem -LiteralPath $dir -Filter ($base + '*' + $ext) -File -ErrorAction SilentlyContinue | Select-Object -First 1",
    "    if ($any) { return $any.FullName }",
    "  } catch {}",
    "  return $null",
    "}",
    "",
    "$results = New-Object System.Collections.ArrayList",
    "Get-AppxPackage -ErrorAction SilentlyContinue | ForEach-Object {",
    "  $pkg = $_",
    "  $pfn = $pkg.PackageFamilyName",
    "  $loc = $pkg.InstallLocation",
    "  if (-not $pfn -or -not $loc) { return }",
    "  $manifestPath = Join-Path $loc 'AppxManifest.xml'",
    "  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { return }",
    "  try {",
    "    [xml]$xml = Get-Content -LiteralPath $manifestPath -Raw -ErrorAction Stop",
    "  } catch { return }",
    "  $ns = New-Object System.Xml.XmlNamespaceManager $xml.NameTable",
    "  $ns.AddNamespace('a',   'http://schemas.microsoft.com/appx/manifest/foundation/windows10')",
    "  $ns.AddNamespace('uap', 'http://schemas.microsoft.com/appx/manifest/uap/windows10')",
    "  $appNodes = $xml.SelectNodes('//a:Applications/a:Application', $ns)",
    "  if (-not $appNodes) { return }",
    "  foreach ($appNode in $appNodes) {",
    "    $entryId = $appNode.GetAttribute('Id')",
    "    if (-not $entryId) { continue }",
    "    $fullId = $pfn + '!' + $entryId",
    "    $vis = $appNode.SelectSingleNode('uap:VisualElements', $ns)",
    // Probe in preferred order: Square44x44 (Start Menu small) is best for our
    // ~64px launcher rendering, then 71/150 as fallbacks.
    "    $logoCandidates = @()",
    "    if ($vis) {",
    "      $logoCandidates += $vis.GetAttribute('Square44x44Logo')",
    "      $logoCandidates += $vis.GetAttribute('Square71x71Logo')",
    "      $logoCandidates += $vis.GetAttribute('Square150x150Logo')",
    "    }",
    "    $resolved = $null",
    "    foreach ($cand in $logoCandidates) {",
    "      if ([string]::IsNullOrWhiteSpace($cand)) { continue }",
    "      $resolved = Resolve-LogoFile $loc $cand",
    "      if ($resolved) { break }",
    "    }",
    "    if ($resolved) {",
    "      [void]$results.Add([PSCustomObject]@{ AppID = $fullId; Png = $resolved })",
    "    }",
    "  }",
    "}",
    "$results | ConvertTo-Json -Compress",
  ].join("\n");
}
