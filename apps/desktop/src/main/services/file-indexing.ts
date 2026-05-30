/**
 * Background File Indexing Service (Rust-powered)
 *
 * Drives the native `stuard-file-indexer` binary to keep the local file
 * index up to date. All filesystem crawling and search now happens in
 * Rust (not the Python agent or Electron's main thread), so the desktop
 * app no longer depends on the agent being available for launcher search.
 *
 * Semantic indexing (Gemini summaries + embeddings) is still optional and
 * only runs when the cloud AI endpoint is reachable; it does not block
 * basic file search.
 */

import { BrowserWindow, app } from "electron";
import * as path from "path";
import * as fs from "fs";
import logger from "../utils/logger";
import {
  addRoot as rustAddRoot,
  listRoots as rustListRoots,
  removeRoot as rustRemoveRoot,
  updateRoot as rustUpdateRoot,
  getStats as rustGetStats,
  scanRoot as rustScanRoot,
  searchFiles as rustSearchFiles,
  listFolder as rustListFolder,
  getPending as rustGetPending,
  updateEmbedding as rustUpdateEmbedding,
  markError as rustMarkError,
  clearEmbeddings as rustClearEmbeddings,
  isIndexerAvailable,
  resolveIndexerBinary,
  type IndexedRoot,
  type ScanProgress,
  type FileIndexStats,
  type FileSearchResult,
  type PendingFile,
  type SearchMode,
} from "./rust-file-indexer";

// ─────────────────────────────────────────────────────────
// Re-exports so existing callers keep their imports working
// ─────────────────────────────────────────────────────────

export type { IndexedRoot, ScanProgress, FileIndexStats, FileSearchResult, PendingFile, SearchMode };

interface ScanOptions {
  computeHashes?: boolean;
  maxFiles?: number;
}

// ─────────────────────────────────────────────────────────
// State tracking
// ─────────────────────────────────────────────────────────

let isScanning = false;
let currentScanRootId: string | null = null;
let lastScanProgress: ScanProgress | null = null;
const sessionReconciledRoots = new Set<string>();

function ensureIndexerReady(): boolean {
  const bin = resolveIndexerBinary();
  if (!bin) {
    logger.warn(
      "[file-indexing] stuard-file-indexer binary not found — file indexing is disabled until the Rust binary is built (cargo build --release --manifest-path apps/agent/native/file-indexer/Cargo.toml)",
    );
    return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────
// Public API (backwards-compatible with the old agent-bridge version)
// ─────────────────────────────────────────────────────────

export async function listRoots(): Promise<IndexedRoot[]> {
  if (!ensureIndexerReady()) return [];
  try {
    return await rustListRoots();
  } catch (err) {
    logger.warn("[file-indexing] listRoots failed:", err);
    return [];
  }
}

export async function addRoot(
  rootPath: string,
  schedule: IndexedRoot["schedule"] = "daily",
  interval_hours?: number,
): Promise<IndexedRoot | null> {
  if (!ensureIndexerReady()) return null;
  try {
    return await rustAddRoot(rootPath, schedule, interval_hours);
  } catch (err) {
    logger.warn(`[file-indexing] addRoot(${rootPath}) failed:`, err);
    return null;
  }
}

export async function removeRoot(rootId: string): Promise<boolean> {
  if (!ensureIndexerReady()) return false;
  try {
    return await rustRemoveRoot(rootId);
  } catch (err) {
    logger.warn(`[file-indexing] removeRoot(${rootId}) failed:`, err);
    return false;
  }
}

export async function getStats(): Promise<FileIndexStats | null> {
  if (!ensureIndexerReady()) return null;
  return await rustGetStats();
}

export async function scanRoot(
  rootId: string,
  onProgress?: (progress: ScanProgress) => void,
  _options: ScanOptions = {},
): Promise<ScanProgress | null> {
  if (!ensureIndexerReady()) return null;
  if (isScanning) {
    logger.warn("[file-indexing] Scan already in progress");
    return null;
  }
  isScanning = true;
  currentScanRootId = rootId;
  try {
    logger.info(`[file-indexing] Starting Rust scan for root ${rootId}`);
    const progress = await rustScanRoot(rootId);
    if (progress) {
      lastScanProgress = progress;
      onProgress?.(progress);
      logger.info("[file-indexing] Scan complete:", progress);
    }
    return progress;
  } catch (err) {
    logger.error("[file-indexing] Scan failed:", err);
    return null;
  } finally {
    isScanning = false;
    currentScanRootId = null;
  }
}

export async function searchFiles(
  query: string,
  options: { kind?: string; limit?: number; rootId?: string; vector?: number[]; mode?: SearchMode } = {},
): Promise<FileSearchResult[]> {
  if (!ensureIndexerReady()) return [];
  return await rustSearchFiles(query, options);
}

// ─────────────────────────────────────────────────────────
// Semantic embeddings — pending queue + vector write-back
// ─────────────────────────────────────────────────────────

export async function getPendingFiles(rootId?: string, limit = 500): Promise<PendingFile[]> {
  if (!ensureIndexerReady()) return [];
  return await rustGetPending(rootId, limit);
}

export async function updateFileEmbedding(input: {
  fileId: string;
  vector: number[];
  summary?: string;
  keywords?: string;
  embeddingModel?: string;
}): Promise<boolean> {
  if (!ensureIndexerReady()) return false;
  return await rustUpdateEmbedding(input);
}

export async function markFileEmbeddingError(fileId: string, message: string): Promise<boolean> {
  if (!ensureIndexerReady()) return false;
  return await rustMarkError(fileId, message);
}

export async function setRootExcludes(rootId: string, excludeGlobs: string): Promise<boolean> {
  if (!ensureIndexerReady()) return false;
  return await rustUpdateRoot(rootId, { excludeGlobs });
}

/** Reset semantic embeddings (all folders, or one root) back to un-embedded. */
export async function clearEmbeddings(rootId?: string): Promise<{ ok: boolean; cleared: number; had_vectors: number }> {
  if (!ensureIndexerReady()) return { ok: false, cleared: 0, had_vectors: 0 };
  return await rustClearEmbeddings(rootId);
}

/** Toggle whether a root is opted into semantic (embedding) search. */
export async function setRootSemantic(rootId: string, on: boolean): Promise<boolean> {
  if (!ensureIndexerReady()) return false;
  return await rustUpdateRoot(rootId, { semantic: on });
}

/**
 * Mark a folder for semantic indexing. Reuses an existing index root if the path
 * is already crawled (e.g. an auto-added name-search root); otherwise registers
 * it as a new root so its files get discovered. Returns the (semantic) root.
 */
export async function addSemanticFolder(folderPath: string): Promise<IndexedRoot | null> {
  if (!ensureIndexerReady()) return null;
  const normalized = normalizeIndexedRootPath(folderPath);
  const existing = (await listRoots()).find(
    (r) => normalizeIndexedRootPath(r.path) === normalized,
  );
  if (existing) {
    await rustUpdateRoot(existing.id, { semantic: true });
    return { ...existing, semantic: true };
  }
  const root = await addRoot(folderPath, "daily");
  if (!root) return null;
  await rustUpdateRoot(root.id, { semantic: true });
  return { ...root, semantic: true };
}

/**
 * Update a root's schedule / enabled state in place. Unlike remove+add, this
 * preserves the folder's already-indexed files and embeddings (no re-scan, no
 * re-embedding).
 */
export async function updateRootConfig(
  rootId: string,
  opts: { enabled?: boolean; schedule?: IndexedRoot["schedule"]; intervalHours?: number },
): Promise<boolean> {
  if (!ensureIndexerReady()) return false;
  return await rustUpdateRoot(rootId, opts);
}

export async function listFolderContents(
  folderPath: string,
  options: { recursive?: boolean; limit?: number } = {},
): Promise<FileSearchResult[]> {
  if (!ensureIndexerReady()) return [];
  return await rustListFolder(folderPath, options);
}

export async function getPendingCount(): Promise<number> {
  const stats = await getStats();
  return stats?.pending_files ?? 0;
}

export function getScanStatus(): {
  isScanning: boolean;
  currentRootId: string | null;
  lastProgress: ScanProgress | null;
} {
  return {
    isScanning,
    currentRootId: currentScanRootId,
    lastProgress: lastScanProgress,
  };
}

// ─────────────────────────────────────────────────────────
// Schedule helpers
// ─────────────────────────────────────────────────────────

function isRootDueForScan(root: IndexedRoot): boolean {
  if (!root.enabled || root.schedule === "off") return false;
  if (!root.last_scan_at) return true;

  const lastScan = new Date(root.last_scan_at).getTime();
  const now = Date.now();
  const hourMs = 60 * 60 * 1000;

  switch (root.schedule) {
    case "hourly":
      return now - lastScan >= hourMs;
    case "daily":
      return now - lastScan >= 24 * hourMs;
    case "weekly":
      return now - lastScan >= 7 * 24 * hourMs;
    case "custom":
      if (root.interval_hours) {
        return now - lastScan >= root.interval_hours * hourMs;
      }
      return false;
    default:
      return false;
  }
}

function needsWindowsSessionReconcile(root: IndexedRoot): boolean {
  return process.platform === "win32" && root.enabled && !sessionReconciledRoots.has(root.id);
}

function needsWindowsSafetyRescan(root: IndexedRoot): boolean {
  if (process.platform !== "win32" || !root.enabled) return false;
  if (!root.last_reconcile_at) return true;
  const lastReconcile = new Date(root.last_reconcile_at).getTime();
  if (!Number.isFinite(lastReconcile)) return true;
  return Date.now() - lastReconcile >= 6 * 60 * 60 * 1000;
}

function normalizeIndexedRootPath(target: string | null | undefined): string | null {
  if (!target) return null;
  try {
    return path.resolve(target).replace(/[\\/]+/g, "\\").replace(/\\+$/, "").toLowerCase();
  } catch {
    return null;
  }
}

function isLegacyWindowsAppDiscoveryRoot(root: IndexedRoot): boolean {
  if (process.platform !== "win32" || !root?.path) return false;

  const homeDir = app.getPath("home");
  const legacyRoots = [
    process.env.ProgramFiles,
    process.env.ProgramW6432,
    process.env["ProgramFiles(x86)"],
    process.env.PROGRAMDATA
      ? path.join(process.env.PROGRAMDATA, "Microsoft", "Windows", "Start Menu", "Programs")
      : null,
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "Microsoft", "WindowsApps")
      : null,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Packages") : null,
    process.env.APPDATA
      ? path.join(process.env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs")
      : null,
    path.join(homeDir, "scoop", "apps"),
    path.join(homeDir, "scoop", "shims"),
  ]
    .map(normalizeIndexedRootPath)
    .filter((candidate): candidate is string => !!candidate);

  const normalizedRootPath = normalizeIndexedRootPath(root.path);
  if (!normalizedRootPath) return false;
  return legacyRoots.includes(normalizedRootPath);
}

function isNestedUnderIndexedRoot(root: IndexedRoot, roots: IndexedRoot[]): boolean {
  const normalizedRootPath = normalizeIndexedRootPath(root.path);
  if (!normalizedRootPath) return false;
  return roots.some((candidate) => {
    if (candidate.id === root.id || !candidate.enabled || candidate.schedule === "off") return false;
    const normalizedCandidatePath = normalizeIndexedRootPath(candidate.path);
    if (!normalizedCandidatePath || normalizedCandidatePath === normalizedRootPath) return false;
    return normalizedRootPath.startsWith(`${normalizedCandidatePath}\\`);
  });
}

function getDefaultUserFolders(): string[] {
  const folders: string[] = [];
  const homedir = app.getPath("home");

  // On Windows we want the entire home directory indexed so search finds
  // everything buried in sub-folders and hidden profile directories.
  if (process.platform === "win32") {
    try {
      if (homedir && fs.existsSync(homedir)) {
        return [homedir];
      }
    } catch {
      // fall through to narrower defaults
    }
  }

  const standardFolders = ["documents", "downloads", "desktop", "pictures", "music", "videos"];
  for (const folder of standardFolders) {
    try {
      const folderPath = app.getPath(folder as any);
      if (folderPath && fs.existsSync(folderPath)) {
        folders.push(folderPath);
      }
    } catch {
      // ignore missing platform-specific paths
    }
  }

  const commonDirs = [
    path.join(homedir, "Projects"),
    path.join(homedir, "Code"),
    path.join(homedir, "Development"),
    path.join(homedir, "Dev"),
    path.join(homedir, "Source"),
    path.join(homedir, "Repos"),
    path.join(homedir, "GitHub"),
    path.join(homedir, "Work"),
  ];
  for (const dir of commonDirs) {
    try {
      if (fs.existsSync(dir)) folders.push(dir);
    } catch {
      // ignore
    }
  }

  if (process.platform === "darwin") {
    const iCloudPath = path.join(homedir, "Library", "Mobile Documents", "com~apple~CloudDocs");
    try {
      if (fs.existsSync(iCloudPath)) folders.push(iCloudPath);
    } catch {
      // ignore
    }
  }

  if (process.platform === "linux") {
    const linuxDirs = [path.join(homedir, "snap"), path.join(homedir, ".local", "bin"), "/opt"];
    for (const d of linuxDirs) {
      try {
        if (fs.existsSync(d)) folders.push(d);
      } catch {
        // ignore
      }
    }
  }

  return [...new Set(folders)];
}

async function initializeDefaultFolders(): Promise<number> {
  try {
    const existingRoots = await listRoots();

    // Only auto-seed on a genuinely fresh start. Once the user has any roots,
    // they're curating the list themselves — re-adding defaults here would
    // silently resurrect folders they just deleted (the "delete doesn't work"
    // bug). The explicit "Auto-Setup Common Folders" button
    // (reinitializeDefaultFolders) still lets them re-seed on demand.
    if (existingRoots.length > 0) {
      return 0;
    }

    const existingPaths = new Set(existingRoots.map((r) => r.path.toLowerCase()));
    const defaultFolders = getDefaultUserFolders();
    logger.info(
      `[file-indexing] Checking ${defaultFolders.length} default folders against ${existingRoots.length} existing roots`,
    );

    let added = 0;
    const addedPaths = new Set<string>();

    for (const folder of defaultFolders) {
      const normalizedFolder = normalizeIndexedRootPath(folder);
      if (!normalizedFolder) continue;
      if (existingPaths.has(folder.toLowerCase())) continue;
      if (existingRoots.some((root) => {
        if (!root.enabled || root.schedule === "off") return false;
        const normalizedExisting = normalizeIndexedRootPath(root.path);
        return !!normalizedExisting && normalizedFolder.startsWith(`${normalizedExisting}\\`);
      })) {
        logger.info(`[file-indexing] Skipping nested default folder already covered: ${folder}`);
        continue;
      }
      if (addedPaths.has(folder.toLowerCase())) continue;

      try {
        const isDownloads = folder.toLowerCase().includes("downloads");
        const schedule = isDownloads ? "custom" : "daily";
        const interval = isDownloads ? 0.25 : undefined;
        const result = await addRoot(folder, schedule, interval);
        if (result) {
          logger.info(`[file-indexing] Added default folder: ${folder} (${schedule})`);
          added++;
          addedPaths.add(folder.toLowerCase());
        }
      } catch (e) {
        logger.warn(`[file-indexing] Failed to add ${folder}:`, e);
      }
    }

    return added;
  } catch (err) {
    logger.error("[file-indexing] Failed to initialize default folders:", err);
    return 0;
  }
}

// ─────────────────────────────────────────────────────────
// Scheduler / startup indexing
// ─────────────────────────────────────────────────────────

export async function runStartupIndexing(): Promise<void> {
  logger.info("[file-indexing] Starting background indexing (Rust backend)...");

  const available = await isIndexerAvailable();
  if (!available) {
    logger.warn(
      "[file-indexing] Rust file indexer unavailable — run `cargo build --release --manifest-path apps/agent/native/file-indexer/Cargo.toml`",
    );
    return;
  }

  try {
    const addedCount = await initializeDefaultFolders();
    if (addedCount > 0) {
      logger.info(`[file-indexing] Added ${addedCount} default folders for indexing`);
    }

    const roots = await listRoots();
    const skippedLegacyRootIds = new Set(
      roots.filter((root) => isLegacyWindowsAppDiscoveryRoot(root)).map((root) => root.id),
    );
    if (skippedLegacyRootIds.size > 0) {
      logger.info(
        `[file-indexing] Skipping ${skippedLegacyRootIds.size} legacy Windows app root(s) from background scanning`,
      );
    }
    const skippedNestedRootIds = new Set(
      roots.filter((root) => isNestedUnderIndexedRoot(root, roots)).map((root) => root.id),
    );
    if (skippedNestedRootIds.size > 0) {
      logger.info(
        `[file-indexing] Skipping ${skippedNestedRootIds.size} nested root(s) covered by broader indexed roots`,
      );
    }

    const dueRoots = roots.filter(
      (r) =>
        !skippedLegacyRootIds.has(r.id) &&
        !skippedNestedRootIds.has(r.id) &&
        r.enabled &&
        (isRootDueForScan(r) || needsWindowsSessionReconcile(r) || needsWindowsSafetyRescan(r)),
    );

    if (dueRoots.length === 0) {
      return;
    }

    logger.info(`[file-indexing] ${dueRoots.length} root(s) due for scanning`);

    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send("file-index:status", {
        status: "scanning",
        totalRoots: dueRoots.length,
        completedRoots: 0,
      });
    });

    let completedRoots = 0;
    for (const root of dueRoots) {
      logger.info(`[file-indexing] Scanning: ${root.path}`);
      const progress = await scanRoot(root.id, (p) => {
        BrowserWindow.getAllWindows().forEach((win) => {
          win.webContents.send("file-index:scan-progress", {
            rootId: root.id,
            path: root.path,
            progress: p,
          });
        });
      });
      completedRoots++;
      if (progress) {
        logger.info(
          `[file-indexing] Completed ${root.path}: ${progress.total_files} files, ${progress.new_files} new, ${progress.changed_files} changed, ${progress.deleted_files} removed`,
        );
      }
      if (process.platform === "win32") {
        sessionReconciledRoots.add(root.id);
      }
      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send("file-index:status", {
          status: "scanning",
          totalRoots: dueRoots.length,
          completedRoots,
          currentPath: root.path,
        });
      });
    }

    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send("file-index:status", {
        status: "complete",
        totalRoots: dueRoots.length,
        completedRoots: dueRoots.length,
      });
    });

    logger.info("[file-indexing] Background indexing complete");
  } catch (error) {
    logger.error("[file-indexing] Background indexing failed:", error);
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send("file-index:status", {
        status: "error",
        error: String(error),
      });
    });
  }
}

export async function reinitializeDefaultFolders(): Promise<{ added: number; folders: string[] }> {
  if (!ensureIndexerReady()) return { added: 0, folders: [] };

  const folders = getDefaultUserFolders();
  let added = 0;
  const existing = await listRoots();
  const existingPaths = new Set(existing.map((r) => r.path.toLowerCase()));

  for (const folder of folders) {
    try {
      const normalizedFolder = normalizeIndexedRootPath(folder);
      if (!normalizedFolder) continue;
      if (existingPaths.has(folder.toLowerCase())) continue;
      if (existing.some((root) => {
        if (!root.enabled || root.schedule === "off") return false;
        const normalizedExisting = normalizeIndexedRootPath(root.path);
        return !!normalizedExisting && normalizedFolder.startsWith(`${normalizedExisting}\\`);
      })) {
        logger.info(`[file-indexing] Skipping nested default folder already covered: ${folder}`);
        continue;
      }
      const result = await addRoot(folder, "daily");
      if (result) {
        added++;
        existingPaths.add(folder.toLowerCase());
      }
    } catch (e) {
      logger.warn(`[file-indexing] Failed to add ${folder}:`, e);
    }
  }

  return { added, folders };
}

let schedulerInterval: NodeJS.Timeout | null = null;

export function startIndexingScheduler() {
  if (schedulerInterval) return;
  logger.info("[file-indexing] Starting indexing scheduler (every 10m)");
  setTimeout(() => {
    runStartupIndexing().catch((err) => logger.error("[file-indexing] Initial scheduler run failed:", err));
  }, 10000);
  schedulerInterval = setInterval(() => {
    runStartupIndexing().catch((err) => logger.error("[file-indexing] Scheduler run failed:", err));
  }, 10 * 60 * 1000);
}

export function stopIndexingScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}

// ─────────────────────────────────────────────────────────
// Semantic indexing (cloud-AI, optional)
// ─────────────────────────────────────────────────────────
//
// This is intentionally a stub for now: the basic file search pipeline no
// longer depends on the Python agent or cloud AI. Semantic enrichment
// (Gemini summaries + embeddings) can be re-added on top of the Rust
// indexer in a follow-up change — it is not required for launcher search
// to work, which is what users actually see.
//

interface SemanticProgress {
  total: number;
  processed: number;
  successful: number;
  failed: number;
  currentFile?: string;
}

export async function processSemanticIndexing(
  _token: string,
  _limit: number = 50,
  _onProgress?: (progress: SemanticProgress) => void,
): Promise<SemanticProgress> {
  logger.info("[file-indexing] Semantic indexing is disabled in the Rust-direct backend.");
  return { total: 0, processed: 0, successful: 0, failed: 0 };
}

// ─────────────────────────────────────────────────────────
// Exports for IPC registration
// ─────────────────────────────────────────────────────────

export const fileIndexingHandlers = {
  listRoots,
  addRoot,
  removeRoot,
  getStats,
  scanRoot,
  searchFiles,
  listFolderContents,
  getPendingCount,
  getScanStatus,
  runStartupIndexing,
  reinitializeDefaultFolders,
  startIndexingScheduler,
  stopIndexingScheduler,
  processSemanticIndexing,
  getPendingFiles,
  updateFileEmbedding,
  markFileEmbeddingError,
  setRootExcludes,
  updateRootConfig,
  clearEmbeddings,
  setRootSemantic,
  addSemanticFolder,
};
