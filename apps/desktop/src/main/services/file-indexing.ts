/**
 * Background File Indexing Service
 *
 * Runs at startup to scan indexed folders and keep the file index up to date.
 * Automatically indexes common user folders (like Windows Search).
 * Metadata indexing (filename, size, mtime) is done locally by the agent.
 * Semantic indexing (summaries, embeddings) is done via cloud Gemini batch API.
 */

import { ipcMain, BrowserWindow, app } from "electron";
import * as path from "path";
import * as fs from "fs";
import logger from "../utils/logger";

// Agent bridge for local tool execution
const getAgentHttp = () => {
  try {
    const raw = String(process.env.AGENT_HTTP || "http://127.0.0.1:8765");
    return raw.replace(/\/+$/, "");
  } catch {
    return "http://127.0.0.1:8765";
  }
};
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

// Track if agent is available
let agentAvailable = false;
let lastAgentCheck = 0;
const AGENT_CHECK_INTERVAL = 5000; // 5 seconds

interface IndexedRoot {
  id: string;
  path: string;
  enabled: boolean;
  schedule: "off" | "hourly" | "daily" | "weekly" | "custom";
  interval_hours: number | null;
  last_scan_at: string | null;
  next_scan_at: string | null;
  last_scan_id: number;
  created_at: string;
  // UI-only fields
  semantic_enabled?: boolean;
  semantic_limit?: number;
}

interface ScanProgress {
  total_dirs: number;
  scanned_dirs: number;
  total_files: number;
  new_files: number;
  changed_files: number;
  unchanged_files: number;
  skipped_files: number;
  deleted_files: number;
  moved_files: number;
  errors: number;
  elapsed_seconds: number;
  files_per_second: number;
}

interface IndexStats {
  roots: number;
  total_files: number;
  indexed_files: number;
  pending_files: number;
  folders: number;
  files_by_kind: Record<string, number>;
}

// State tracking
let isScanning = false;
let currentScanRootId: string | null = null;
let lastScanProgress: ScanProgress | null = null;

/**
 * Check if the agent is available
 */
async function checkAgentAvailable(): Promise<boolean> {
  const now = Date.now();
  if (agentAvailable && now - lastAgentCheck < AGENT_CHECK_INTERVAL) {
    return true;
  }

  try {
    const resp = await fetch(`${getAgentHttp()}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(2000),
    });
    agentAvailable = resp.ok;
    lastAgentCheck = now;
    return agentAvailable;
  } catch {
    agentAvailable = false;
    lastAgentCheck = now;
    return false;
  }
}

/**
 * Wait for agent to become available
 */
async function waitForAgent(maxWaitMs: number = 10000): Promise<boolean> {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    if (await checkAgentAvailable()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

/**
 * Execute a tool on the local agent with retry logic
 */
async function execAgentTool(tool: string, args: Record<string, any>): Promise<any> {
  // First check if agent is available
  if (!await checkAgentAvailable()) {
    logger.debug(`[file-indexing] Agent not available for ${tool}`);
    return null;
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const resp = await fetch(`${getAgentHttp()}/v1/tools/exec`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool, args }),
        signal: AbortSignal.timeout(30000), // 30 second timeout
      });
      if (!resp.ok) {
        throw new Error(`Agent returned ${resp.status}`);
      }
      agentAvailable = true;
      return await resp.json();
    } catch (error: any) {
      const isLastAttempt = attempt === MAX_RETRIES;
      if (error?.name === 'AbortError' || error?.cause?.code === 'ECONNREFUSED') {
        agentAvailable = false;
      }

      if (isLastAttempt) {
        logger.error(`[file-indexing] Failed to exec ${tool} after ${MAX_RETRIES} attempts:`, error);
        return null;
      }

      logger.debug(`[file-indexing] Retrying ${tool} (attempt ${attempt + 1}/${MAX_RETRIES})`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
  return null;
}

/**
 * Get all indexed roots
 */
export async function listRoots(): Promise<IndexedRoot[]> {
  const result = await execAgentTool("file_index_list_roots", {});
  return result?.roots || [];
}

/**
 * Add a new indexed root folder
 */
export async function addRoot(
  path: string,
  schedule: "off" | "hourly" | "daily" | "weekly" | "custom" = "daily",
  interval_hours?: number
): Promise<IndexedRoot | null> {
  const args: Record<string, any> = { path, schedule };
  if (interval_hours !== undefined) {
    args.interval_hours = interval_hours;
  }
  const result = await execAgentTool("file_index_add_root", args);
  if (result?.ok) {
    return result.root;
  }
  return null;
}

/**
 * Remove an indexed root
 */
export async function removeRoot(rootId: string): Promise<boolean> {
  const result = await execAgentTool("file_index_remove_root", { root_id: rootId });
  return result?.ok === true;
}

/**
 * Get indexing statistics
 */
export async function getStats(): Promise<IndexStats | null> {
  const result = await execAgentTool("file_index_stats", {});
  if (result && result?.ok !== false) {
    return result;
  }
  return null;
}

/**
 * Scan a specific root folder
 */
export async function scanRoot(
  rootId: string,
  onProgress?: (progress: ScanProgress) => void
): Promise<ScanProgress | null> {
  if (isScanning) {
    logger.warn("[file-indexing] Scan already in progress");
    return null;
  }

  isScanning = true;
  currentScanRootId = rootId;

  try {
    logger.info(`[file-indexing] Starting scan for root ${rootId}`);
    const result = await execAgentTool("file_index_scan", { root_id: rootId });

    if (result?.ok && result?.progress) {
      lastScanProgress = result.progress;
      onProgress?.(result.progress);
      logger.info(`[file-indexing] Scan complete:`, result.progress);
      return result.progress;
    }
    return null;
  } catch (error) {
    logger.error("[file-indexing] Scan failed:", error);
    return null;
  } finally {
    isScanning = false;
    currentScanRootId = null;
  }
}

/**
 * Check if a root is due for scanning based on its schedule
 */
function isRootDueForScan(root: IndexedRoot): boolean {
  if (!root.enabled || root.schedule === "off") {
    return false;
  }

  if (!root.last_scan_at) {
    // Never scanned, so it's due
    return true;
  }

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

/**
 * Get default user folders to index (like Windows Search)
 */
function getDefaultUserFolders(): string[] {
  const folders: string[] = [];
  const homedir = app.getPath("home");

  // Standard user folders
  const standardFolders = [
    "documents",
    "downloads",
    "desktop",
    "pictures",
    "music",
    "videos",
  ];

  for (const folder of standardFolders) {
    try {
      const folderPath = app.getPath(folder as any);
      if (folderPath && fs.existsSync(folderPath)) {
        folders.push(folderPath);
      }
    } catch {
      // Some paths may not exist on all platforms
    }
  }

  // Common project/code directories
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
      if (fs.existsSync(dir)) {
        folders.push(dir);
      }
    } catch {
      // Ignore access errors
    }
  }

  // ══════════════════════════════════════════════════════════
  // WINDOWS-SPECIFIC FOLDERS
  // ══════════════════════════════════════════════════════════
  if (process.platform === "win32") {
    // OneDrive folders
    const oneDrivePaths = [
      path.join(homedir, "OneDrive"),
      path.join(homedir, "OneDrive - Personal"),
      process.env.OneDrive,
      process.env.OneDriveConsumer,
    ].filter(Boolean) as string[];

    for (const oneDrive of oneDrivePaths) {
      try {
        if (fs.existsSync(oneDrive)) {
          const subFolders = ["Documents", "Desktop", "Pictures"];
          for (const sub of subFolders) {
            const subPath = path.join(oneDrive, sub);
            if (fs.existsSync(subPath) && !folders.includes(subPath)) {
              folders.push(subPath);
            }
          }
          if (!folders.includes(oneDrive)) {
            folders.push(oneDrive);
          }
        }
      } catch { /* Ignore */ }
    }

    // NOTE: Start Menu, Program Files, UWP apps, and Scoop are no longer indexed here.
    // Application discovery is handled by app-discovery.ts using native OS APIs
    // (Get-StartApps on Windows, mdfind on macOS, XDG .desktop on Linux).
  }

  // ══════════════════════════════════════════════════════════
  // MACOS-SPECIFIC FOLDERS
  // ══════════════════════════════════════════════════════════
  if (process.platform === "darwin") {
    const iCloudPath = path.join(homedir, "Library", "Mobile Documents", "com~apple~CloudDocs");
    try {
      if (fs.existsSync(iCloudPath)) folders.push(iCloudPath);
    } catch { /* Ignore */ }

    // NOTE: /Applications directories are no longer indexed here.
    // Application discovery is handled by app-discovery.ts via mdfind (Spotlight).
  }

  // ══════════════════════════════════════════════════════════
  // LINUX-SPECIFIC FOLDERS
  // ══════════════════════════════════════════════════════════
  if (process.platform === "linux") {
    // NOTE: .desktop file directories are no longer indexed here.
    // Application discovery is handled by app-discovery.ts via XDG scanning.

    // Common Linux project paths (keep these — they're user files, not apps)
    const linuxDirs = [
      path.join(homedir, "snap"),
      path.join(homedir, ".local", "bin"),
      "/opt",
    ];
    for (const d of linuxDirs) {
      try {
        if (fs.existsSync(d)) folders.push(d);
      } catch { /* Ignore */ }
    }
  }

  // Remove duplicates
  return [...new Set(folders)];
}

/**
 * Initialize default indexed folders if none exist
 */
async function initializeDefaultFolders(): Promise<number> {
  try {
    const existingRoots = await listRoots();
    const existingPaths = new Set(existingRoots.map(r => r.path.toLowerCase()));

    const defaultFolders = getDefaultUserFolders();
    logger.info(`[file-indexing] Checking ${defaultFolders.length} default folders against ${existingRoots.length} existing roots`);

    let added = 0;
    const addedPaths = new Set<string>();

    for (const folder of defaultFolders) {
      // Skip if already exists
      if (existingPaths.has(folder.toLowerCase())) {
        continue;
      }
      
      // Skip if already added in this session
      if (addedPaths.has(folder.toLowerCase())) {
        continue;
      }

      try {
        // Use frequent scanning for Downloads (15 mins), daily for others
        const isDownloads = folder.toLowerCase().includes("downloads");
        const schedule = isDownloads ? "custom" : "daily";
        const interval = isDownloads ? 0.25 : undefined; // 15 mins for downloads
        
        let result = await addRoot(folder, schedule, interval);

        if (result) {
          logger.info(`[file-indexing] Added default folder: ${folder} (${schedule}${interval ? ' ' + interval + 'h' : ''})`);
          added++;
          addedPaths.add(folder.toLowerCase());
        }
      } catch (e) {
        logger.warn(`[file-indexing] Failed to add ${folder}:`, e);
      }
    }

    return added;
  } catch (error) {
    logger.error("[file-indexing] Failed to initialize default folders:", error);
    return 0;
  }
}

/**
 * Run startup indexing - initializes default folders and scans all due roots
 */
export async function runStartupIndexing(): Promise<void> {
  logger.info("[file-indexing] Starting background indexing...");

  try {
    // Wait for agent to be available (up to 30 seconds)
    logger.info("[file-indexing] Waiting for agent to be ready...");
    const agentReady = await waitForAgent(30000);
    if (!agentReady) {
      logger.warn("[file-indexing] Agent not available, skipping background indexing");
      return;
    }
    logger.info(`[file-indexing] Agent is ready`);

    // First, initialize default folders if this is first run
    const addedCount = await initializeDefaultFolders();
    if (addedCount > 0) {
      logger.info(`[file-indexing] Added ${addedCount} default folders for indexing`);
    }

    // Get all roots and filter for those due for scanning
    const roots = await listRoots();
    const dueRoots = roots.filter((r) => r.enabled && isRootDueForScan(r));

    if (dueRoots.length === 0) {
      // logger.debug("[file-indexing] No roots due for scanning");
      return;
    }

    logger.info(`[file-indexing] ${dueRoots.length} root(s) due for scanning`);

    // Notify renderer that indexing is starting
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send("file-index:status", {
        status: "scanning",
        totalRoots: dueRoots.length,
        completedRoots: 0,
      });
    });

    // Scan each due root sequentially (to avoid overwhelming the system)
    let completedRoots = 0;
    for (const root of dueRoots) {
      logger.info(`[file-indexing] Scanning: ${root.path}`);

      const progress = await scanRoot(root.id, (p) => {
        // Emit progress to renderer
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
        logger.info(`[file-indexing] Completed ${root.path}: ${progress.total_files} files, ${progress.new_files} new`);
      }

      // Update overall progress
      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send("file-index:status", {
          status: "scanning",
          totalRoots: dueRoots.length,
          completedRoots,
          currentPath: root.path,
        });
      });
    }

    // Notify completion
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

    // Notify error
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send("file-index:status", {
        status: "error",
        error: String(error),
      });
    });
  }
}

/**
 * Search indexed files
 */
export async function searchFiles(
  query: string,
  options: {
    kind?: string;
    limit?: number;
    rootId?: string;
  } = {}
): Promise<any[]> {
  const result = await execAgentTool("file_search", {
    query,
    kind: options.kind,
    limit: options.limit || 50,
    root_id: options.rootId,
  });
  return result?.files || [];
}

/**
 * Get pending files count (files needing semantic indexing)
 */
export async function getPendingCount(): Promise<number> {
  const stats = await getStats();
  return stats?.pending_files || 0;
}

/**
 * Get current scanning status
 */
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

/**
 * Reset and reinitialize default folders
 * Useful if user wants to start fresh
 */
export async function reinitializeDefaultFolders(): Promise<{ added: number; folders: string[] }> {
  // Wait for agent to be available first
  const agentReady = await waitForAgent(15000);
  if (!agentReady) {
    logger.warn("[file-indexing] Agent not available for reinitializeDefaultFolders");
    return { added: 0, folders: [] };
  }

  const folders = getDefaultUserFolders();
  let added = 0;

  // Get existing roots ONCE, not in the loop
  const existing = await listRoots();
  const existingPaths = new Set(existing.map((r) => r.path.toLowerCase()));

  for (const folder of folders) {
    try {
      // Check if already exists using the cached set
      if (existingPaths.has(folder.toLowerCase())) {
        continue;
      }

      const result = await addRoot(folder, "daily");
      if (result) {
        added++;
        existingPaths.add(folder.toLowerCase()); // Update cache
      }
    } catch (e) {
      logger.warn(`[file-indexing] Failed to add ${folder}:`, e);
    }
  }

  return { added, folders };
}

/**
 * Start the background indexing scheduler
 * Checks for due roots every 10 minutes
 */
let schedulerInterval: NodeJS.Timeout | null = null;

export function startIndexingScheduler() {
  if (schedulerInterval) return;
  
  logger.info("[file-indexing] Starting indexing scheduler (every 10m)");
  
  // Run immediately (with slight delay for startup)
  setTimeout(() => {
    runStartupIndexing().catch(err => logger.error("[file-indexing] Initial scheduler run failed:", err));
  }, 10000);

  // Then every 10 minutes
  schedulerInterval = setInterval(() => {
    runStartupIndexing().catch(err => logger.error("[file-indexing] Scheduler run failed:", err));
  }, 10 * 60 * 1000); 
}

/**
 * Stop the scheduler
 */
export function stopIndexingScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SEMANTIC INDEXING
// ═══════════════════════════════════════════════════════════════════════════════

const CLOUD_AI_HTTP = process.env.CLOUD_AI_HTTP || process.env.CLOUD_PUBLIC_URL || process.env.VITE_CLOUD_AI_URL || "http://127.0.0.1:8082";
const EMBEDDING_MODEL = "text-embedding-3-large";
const SUMMARY_MODEL = "gemini-2.5-flash";

// Max file size for multimodal processing
const MAX_MEDIA_SIZE = 500 * 1024 * 1024;  // 500MB for all media types

interface PendingFile {
  id: string;
  path: string;
  filename: string;
  extension: string;
  kind: string;
  size: number;
}

interface SemanticProgress {
  total: number;
  processed: number;
  successful: number;
  failed: number;
  currentFile?: string;
}

// File type categories
const MULTIMODAL_EXTENSIONS = new Set([
  // Images
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.heic', '.heif',
  // Audio
  '.mp3', '.wav', '.m4a', '.flac', '.ogg', '.aac',
  // Video
  '.mp4', '.mov', '.webm', '.mkv', '.avi',
  // PDF
  '.pdf',
]);

const TEXT_READABLE_KINDS = new Set(['document', 'code']);

const METADATA_ONLY_EXTENSIONS = new Set([
  '.exe', '.dll', '.so', '.dylib', '.msi', '.dmg', '.app',
  '.iso', '.vmdk', '.vdi', '.vhd', '.dmp', '.bak',
  '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2',
  '.lnk', '.url',
]);

const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.heic': 'image/heic', '.heif': 'image/heif',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.aac': 'audio/aac',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
  '.pdf': 'application/pdf',
};

/**
 * Read file content as text via agent
 */
async function readFileContent(filePath: string, maxLines: number = 500): Promise<string | null> {
  const result = await execAgentTool("read_file", { path: filePath, line_start: 1, line_end: maxLines });
  if (result?.ok && result?.content) {
    return String(result.content);
  }
  return null;
}

/**
 * Read file as base64 via agent
 */
async function readFileBase64(filePath: string): Promise<string | null> {
  const result = await execAgentTool("read_file_binary", { path: filePath });
  if (result?.ok && result?.data) {
    return result.data;  // Agent returns 'data' field for base64
  }
  return null;
}

/**
 * Check if file is within size limit for multimodal processing
 */
function isWithinMediaSizeLimit(size: number): boolean {
  return size <= MAX_MEDIA_SIZE;
}

/**
 * Generate summary via cloud AI - supports both text and multimodal
 */
async function generateSummary(
  file: PendingFile,
  token: string,
  content?: { text?: string; base64?: string; mimeType?: string }
): Promise<{ summary: string; keywords: string } | null> {
  try {
    const body: Record<string, any> = { filename: file.filename };

    if (content?.base64 && content?.mimeType) {
      // Multimodal: send as attachment
      body.data = content.base64;
      body.mimeType = content.mimeType;
    } else if (content?.text) {
      // Text content
      body.text = content.text;
    } else {
      return null;
    }

    const resp = await fetch(`${CLOUD_AI_HTTP}/inference/ai/summarize-file`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(300000), // 5 minutes for large files
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      logger.warn(`[file-indexing] Summary API error: ${resp.status} - ${errText}`);
      return null;
    }

    const data = await resp.json();
    if (!data?.ok) {
      logger.warn(`[file-indexing] Summary API returned error: ${data?.error}`);
      return null;
    }

    return {
      summary: data.summary || `File: ${file.filename}`,
      keywords: data.keywords || file.filename.replace(/[._-]/g, ", "),
    };
  } catch (error) {
    logger.warn(`[file-indexing] Summary generation failed for ${file.filename}:`, error);
    return null;
  }
}

/**
 * Generate embedding via cloud AI
 */
async function generateEmbedding(text: string, token: string): Promise<number[] | null> {
  try {
    const resp = await fetch(`${CLOUD_AI_HTTP}/inference/ai/embed`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        text: text,  // Cloud endpoint expects 'text', not 'input'
        model: EMBEDDING_MODEL,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      logger.warn(`[file-indexing] Embedding API error: ${resp.status}`);
      return null;
    }

    const data = await resp.json();
    return data?.embedding || null;
  } catch (error) {
    logger.warn(`[file-indexing] Embedding generation failed:`, error);
    return null;
  }
}

/**
 * Update file index entry with semantic data
 */
async function updateSemanticIndex(
  fileId: string,
  summary: string,
  keywords: string,
  vector: number[]
): Promise<boolean> {
  const result = await execAgentTool("file_index_update", {
    file_id: fileId,
    summary,
    keywords,
    vector,
    summary_model: SUMMARY_MODEL,
    embedding_model: EMBEDDING_MODEL,
  });
  return result?.ok === true;
}

/**
 * Process a single file for semantic indexing
 */
async function processFileSemanticIndexing(
  file: PendingFile,
  token: string
): Promise<{ success: boolean; error?: string }> {
  try {
    let summary: string;
    let keywords: string;
    const ext = file.extension.toLowerCase();

    // Strategy 1: Metadata-only files (binaries, archives, etc.)
    if (METADATA_ONLY_EXTENSIONS.has(ext)) {
      const sizeKB = Math.round(file.size / 1024);
      summary = `${file.kind} file: ${file.filename} (${sizeKB}KB)`;
      keywords = [file.filename.replace(/[._-]/g, " "), ext.replace(".", ""), file.kind].join(", ");
    }
    // Strategy 2: Multimodal files (images, audio, video, PDF)
    else if (MULTIMODAL_EXTENSIONS.has(ext)) {
      if (!isWithinMediaSizeLimit(file.size)) {
        // Too large for multimodal (>500MB), use metadata
        const sizeMB = Math.round(file.size / 1024 / 1024);
        summary = `${file.kind} file: ${file.filename} (${sizeMB}MB - too large for analysis)`;
        keywords = [file.filename.replace(/[._-]/g, " "), ext.replace(".", ""), file.kind].join(", ");
      } else {
        // Read as base64 and send to AI
        const base64 = await readFileBase64(file.path);
        const mimeType = MIME_TYPES[ext] || "application/octet-stream";

        if (base64) {
          const summaryResult = await generateSummary(file, token, { base64, mimeType });
          if (summaryResult) {
            summary = summaryResult.summary;
            keywords = summaryResult.keywords;
          } else {
            summary = `${file.kind} file: ${file.filename}`;
            keywords = file.filename.replace(/[._-]/g, ", ");
          }
        } else {
          summary = `${file.kind} file: ${file.filename}`;
          keywords = file.filename.replace(/[._-]/g, ", ");
        }
      }
    }
    // Strategy 3: Text-readable files (code, documents, etc.)
    else if (TEXT_READABLE_KINDS.has(file.kind)) {
      const textContent = await readFileContent(file.path);

      if (textContent) {
        const summaryResult = await generateSummary(file, token, { text: textContent });
        if (summaryResult) {
          summary = summaryResult.summary;
          keywords = summaryResult.keywords;
        } else {
          summary = `${file.kind} file: ${file.filename}`;
          keywords = file.filename.replace(/[._-]/g, ", ");
        }
      } else {
        summary = `${file.kind} file: ${file.filename}`;
        keywords = file.filename.replace(/[._-]/g, ", ");
      }
    }
    // Strategy 4: Everything else - metadata only
    else {
      const sizeKB = Math.round(file.size / 1024);
      summary = `${file.kind} file: ${file.filename} (${sizeKB}KB)`;
      keywords = [file.filename.replace(/[._-]/g, " "), ext.replace(".", ""), file.kind].join(", ");
    }

    // Generate embedding from the summary
    const embeddingText = `${file.filename}\n${summary}\n${keywords}`;
    const vector = await generateEmbedding(embeddingText, token);

    if (!vector) {
      return { success: false, error: "Failed to generate embedding" };
    }

    // Update local index
    const updated = await updateSemanticIndex(file.id, summary, keywords, vector);
    return { success: updated, error: updated ? undefined : "Failed to update index" };
  } catch (error: any) {
    return { success: false, error: error?.message || "Unknown error" };
  }
}

/**
 * Process pending files for semantic indexing with parallel requests
 */
export async function processSemanticIndexing(
  token: string,
  limit: number = 50,
  onProgress?: (progress: SemanticProgress) => void
): Promise<SemanticProgress> {
  const CONCURRENCY = 5; // Process 5 files in parallel

  const progress: SemanticProgress = {
    total: 0,
    processed: 0,
    successful: 0,
    failed: 0,
  };

  try {
    // Check agent availability
    if (!await waitForAgent(10000)) {
      throw new Error("Agent not available");
    }

    // Get pending files
    const pendingResult = await execAgentTool("file_index_get_pending", { limit });
    if (!pendingResult?.ok || !pendingResult?.files) {
      logger.warn("[file-indexing] No pending files or failed to get pending");
      return progress;
    }

    const files: PendingFile[] = pendingResult.files;
    progress.total = files.length;
    onProgress?.(progress);

    if (files.length === 0) {
      return progress;
    }

    logger.info(`[file-indexing] Processing ${files.length} files for semantic indexing (concurrency: ${CONCURRENCY})`);

    // Process files in parallel batches
    for (let i = 0; i < files.length; i += CONCURRENCY) {
      const batch = files.slice(i, i + CONCURRENCY);

      // Update progress with current batch
      progress.currentFile = batch.map(f => f.filename).join(", ");
      onProgress?.(progress);

      // Process batch in parallel
      const results = await Promise.all(
        batch.map(file => processFileSemanticIndexing(file, token))
      );

      // Update progress
      for (const result of results) {
        if (result.success) {
          progress.successful++;
        } else {
          progress.failed++;
          logger.warn(`[file-indexing] File failed: ${result.error}`);
        }
        progress.processed++;
      }

      onProgress?.(progress);
    }

    progress.currentFile = undefined;
    logger.info(`[file-indexing] Semantic indexing complete: ${progress.successful} succeeded, ${progress.failed} failed`);
    return progress;
  } catch (error) {
    logger.error("[file-indexing] Semantic indexing failed:", error);
    throw error;
  }
}

// Export for IPC registration
export const fileIndexingHandlers = {
  listRoots,
  addRoot,
  removeRoot,
  getStats,
  scanRoot,
  searchFiles,
  getPendingCount,
  getScanStatus,
  runStartupIndexing,
  reinitializeDefaultFolders,
  startIndexingScheduler,
  stopIndexingScheduler,
  processSemanticIndexing,
};
