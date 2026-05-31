/**
 * Rust File Indexer Bridge
 *
 * Spawns the native `stuard-file-indexer` binary for filesystem indexing.
 *
 * Performance model:
 * - A long-lived **daemon** process is kept open for read-heavy operations
 *   (search / list-folder / stats / list-roots). Every request is a single
 *   line of JSON on stdin; responses come back on stdout. This avoids the
 *   ~800ms Windows cold-spawn cost that was making launcher search feel
 *   broken for anything past the first keystroke.
 * - Write / long-running operations (scan, init, add-root, remove-root,
 *   update-root) use a one-shot spawn — they're infrequent and the daemon
 *   shouldn't be blocked on a minute-long crawl.
 */

import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { app } from "electron";
import { isDev } from "../env";
import logger from "../utils/logger";

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

export type RootSchedule = "off" | "hourly" | "daily" | "weekly" | "custom";
export type RootBackend = "generic" | "win32" | "rust";
export type WatchState = "inactive" | "active" | "error";

export interface IndexedRoot {
  id: string;
  path: string;
  enabled: boolean;
  schedule: RootSchedule;
  interval_hours: number | null;
  last_scan_at: string | null;
  next_scan_at: string | null;
  last_scan_id: number;
  backend: RootBackend;
  watch_state: WatchState;
  volume_serial: string | null;
  last_reconcile_at: string | null;
  exclude_globs: string | null;
  /** User opted this folder into semantic (embedding) search. */
  semantic?: boolean;
  /** Per-root semantic-index counts (from do_list_roots). */
  indexed_files?: number;
  pending_files?: number;
  created_at: string;
}

export interface ScanProgress {
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

export interface FileIndexStats {
  ok: boolean;
  roots: number;
  total_files: number;
  indexed_files: number;
  pending_files: number;
  folders: number;
  files_by_kind: Record<string, number>;
}

export interface FileSearchResult {
  id: string;
  root_id: string;
  path: string;
  filename: string;
  display_name: string;
  extension: string;
  kind: string;
  size: number;
  mtime_ms: number;
  content_hash: string | null;
  status: string;
  summary: string | null;
  keywords: string | null;
  indexed_at: string | null;
  preview_kind: string;
  preview_eligible: boolean;
  is_folder: boolean;
  icon_path: string;
  score: number;
  match_type: string;
  target_path?: string;
}

export type SearchMode = "quick" | "semantic" | "hybrid";

/** A crawled-but-not-yet-embedded file, as returned by the `get-pending` command. */
export interface PendingFile {
  id: string;
  path: string;
  filename: string;
  extension: string;
  kind: string;
  size: number;
}

// ─────────────────────────────────────────────────────────
// Binary + DB resolution
// ─────────────────────────────────────────────────────────

let cachedBinaryPath: string | null = null;
let cachedDbPath: string | null = null;
let initPromise: Promise<void> | null = null;

function getBinaryName(): string {
  return process.platform === "win32" ? "stuard-file-indexer.exe" : "stuard-file-indexer";
}

export function resolveIndexerBinary(): string | null {
  if (cachedBinaryPath && fs.existsSync(cachedBinaryPath)) {
    return cachedBinaryPath;
  }

  const override = process.env.STUARD_FILE_INDEXER;
  if (override && fs.existsSync(override)) {
    cachedBinaryPath = override;
    return override;
  }

  const name = getBinaryName();
  const candidates: string[] = [];

  if (isDev) {
    const cwd = process.cwd();
    const here = __dirname;
    for (const root of [cwd, here, path.resolve(here, "..", "..", "..", "..", "..")]) {
      candidates.push(
        path.resolve(root, "apps", "agent", "native", "file-indexer", "target", "release", name),
        path.resolve(root, "apps", "agent", "native", "file-indexer", "target", "debug", name),
        path.resolve(root, "..", "agent", "native", "file-indexer", "target", "release", name),
      );
    }
    candidates.push(path.resolve(cwd, "dist", name));
  }

  try {
    const resources = process.resourcesPath;
    if (resources) {
      candidates.push(path.join(resources, "agent", name));
      candidates.push(path.join(resources, name));
    }
  } catch {
    // dev
  }

  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        cachedBinaryPath = candidate;
        return candidate;
      }
    } catch {
      // skip
    }
  }

  return null;
}

export function resolveDbPath(): string {
  if (cachedDbPath) return cachedDbPath;

  if (process.env.STUARD_FILE_INDEX_DB) {
    cachedDbPath = process.env.STUARD_FILE_INDEX_DB;
    return cachedDbPath;
  }

  let dataDir: string;
  if (process.env.AGENT_DATA_DIR) {
    dataDir = process.env.AGENT_DATA_DIR;
  } else if (process.platform === "win32") {
    const base = process.env.APPDATA || path.join(app.getPath("home"), "AppData", "Roaming");
    dataDir = path.join(base, "StuardAI", "agent");
  } else if (process.platform === "darwin") {
    dataDir = path.join(app.getPath("home"), "Library", "Application Support", "StuardAI", "agent");
  } else {
    const base = process.env.XDG_DATA_HOME || path.join(app.getPath("home"), ".local", "share");
    dataDir = path.join(base, "StuardAI", "agent");
  }

  try {
    fs.mkdirSync(dataDir, { recursive: true });
  } catch {
    // ignore
  }
  cachedDbPath = path.join(dataDir, "file_index.db");
  return cachedDbPath;
}

// ─────────────────────────────────────────────────────────
// One-shot invocation helper (for scans, init, root CRUD)
// ─────────────────────────────────────────────────────────

interface RunOptions {
  timeoutMs?: number;
  cwd?: string;
}

function runIndexer<T = any>(
  subcommand: string,
  flags: Record<string, string | number | boolean | undefined> = {},
  options: RunOptions = {},
): Promise<T> {
  const binary = resolveIndexerBinary();
  if (!binary) {
    return Promise.reject(
      new Error(
        `[rust-file-indexer] Binary not found. Build it with: cargo build --release --manifest-path apps/agent/native/file-indexer/Cargo.toml`,
      ),
    );
  }
  const dbPath = resolveDbPath();

  const args: string[] = [subcommand, "--db", dbPath];
  for (const [key, value] of Object.entries(flags)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "boolean") {
      if (value) args.push(`--${key}`);
      continue;
    }
    args.push(`--${key}`, String(value));
  }

  const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
  return new Promise<T>((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let finished = false;

    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      try { child.kill(); } catch { /* ignore */ }
      reject(new Error(`[rust-file-indexer] ${subcommand} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (err: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code: number) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);

      const lastLine = stdout.trim().split(/\r?\n/).filter(Boolean).pop() || "";
      if (!lastLine) {
        reject(
          new Error(
            `[rust-file-indexer] ${subcommand} exited with code ${code} and no stdout (stderr: ${stderr.trim() || "<empty>"})`,
          ),
        );
        return;
      }
      try {
        const parsed = JSON.parse(lastLine);
        if (code !== 0 && parsed && parsed.ok === false) {
          reject(new Error(`[rust-file-indexer] ${subcommand} failed: ${parsed.error || code}`));
          return;
        }
        resolve(parsed as T);
      } catch (e: any) {
        reject(
          new Error(
            `[rust-file-indexer] ${subcommand} produced non-JSON output (code=${code}): ${lastLine.slice(0, 200)}`,
          ),
        );
      }
    });
  });
}

// ─────────────────────────────────────────────────────────
// Daemon (one long-lived Rust process, JSON-RPC over stdio)
// ─────────────────────────────────────────────────────────

interface Pending {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

class IndexerDaemon {
  private child: ChildProcessWithoutNullStreams | null = null;
  private startPromise: Promise<void> | null = null;
  private pending = new Map<string, Pending>();
  private buffer = "";
  private nextId = 1;

  private async ensureStarted(): Promise<void> {
    if (this.child && !this.child.killed) return;
    if (this.startPromise) return this.startPromise;

    this.startPromise = new Promise<void>((resolve, reject) => {
      const binary = resolveIndexerBinary();
      if (!binary) {
        this.startPromise = null;
        reject(new Error("[rust-file-indexer] binary not found"));
        return;
      }
      const dbPath = resolveDbPath();
      logger.info(`[rust-file-indexer] Starting daemon: ${binary} daemon --db ${dbPath}`);

      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(binary, ["daemon", "--db", dbPath], {
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        });
      } catch (err: any) {
        this.startPromise = null;
        reject(err);
        return;
      }

      this.child = child;

      let readySeen = false;
      const onData = (chunk: Buffer) => {
        this.buffer += chunk.toString("utf8");
        let newlineIdx: number;
        while ((newlineIdx = this.buffer.indexOf("\n")) !== -1) {
          const line = this.buffer.slice(0, newlineIdx).trim();
          this.buffer = this.buffer.slice(newlineIdx + 1);
          if (!line) continue;
          let parsed: any;
          try {
            parsed = JSON.parse(line);
          } catch {
            logger.warn("[rust-file-indexer] daemon: non-JSON line:", line.slice(0, 200));
            continue;
          }
          if (!readySeen && parsed?.ready === true) {
            readySeen = true;
            resolve();
            continue;
          }
          const id = parsed?.id != null ? String(parsed.id) : null;
          if (id && this.pending.has(id)) {
            const p = this.pending.get(id)!;
            this.pending.delete(id);
            clearTimeout(p.timer);
            p.resolve(parsed);
          }
        }
      };

      child.stdout.on("data", onData);
      child.stderr.on("data", (c: Buffer) => {
        const text = c.toString("utf8").trim();
        if (text) logger.warn("[rust-file-indexer] daemon stderr:", text);
      });
      child.on("error", (err: Error) => {
        logger.warn("[rust-file-indexer] daemon error:", err.message);
        this.cleanup(err);
      });
      child.on("close", (code) => {
        logger.warn(`[rust-file-indexer] daemon exited (code=${code})`);
        this.cleanup(new Error(`daemon exited with code ${code}`));
      });

      // Fail fast if the daemon never prints its ready line.
      setTimeout(() => {
        if (!readySeen) {
          this.startPromise = null;
          try { child.kill(); } catch { /* ignore */ }
          reject(new Error("[rust-file-indexer] daemon did not become ready in 10s"));
        }
      }, 10_000);
    });

    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  private cleanup(err: Error) {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
    this.child = null;
  }

  async call<T = any>(cmd: string, args: Record<string, any>, timeoutMs = 5000): Promise<T> {
    await this.ensureStarted();
    const child = this.child!;
    const id = String(this.nextId++);
    const payload = JSON.stringify({ id, cmd, args }) + "\n";

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`[rust-file-indexer] daemon ${cmd} timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        child.stdin.write(payload);
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(err as Error);
      }
    });
  }

  isAlive(): boolean {
    return !!this.child && !this.child.killed;
  }

  shutdown() {
    const child = this.child;
    this.cleanup(new Error("shutdown"));
    if (child) {
      try { child.stdin.end(); } catch { /* ignore */ }
      try { child.kill(); } catch { /* ignore */ }
    }
  }
}

const daemon = new IndexerDaemon();

export function shutdownRustFileIndexer(): void {
  daemon.shutdown();
}

// ─────────────────────────────────────────────────────────
// init gate
// ─────────────────────────────────────────────────────────

async function ensureInitialized(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      await runIndexer<{ ok: boolean }>("init", {}, { timeoutMs: 60_000 });
    } catch (err) {
      logger.warn("[rust-file-indexer] init failed:", err);
      initPromise = null;
      throw err;
    }
  })();
  return initPromise;
}

// ─────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────

export async function isIndexerAvailable(): Promise<boolean> {
  if (!resolveIndexerBinary()) return false;
  try {
    await ensureInitialized();
    return true;
  } catch {
    return false;
  }
}

export async function listRoots(): Promise<IndexedRoot[]> {
  await ensureInitialized();
  // list-roots overlays per-root semantic counts (a path-range scan over the
  // index). On the very first call after launch the page cache is cold, so 5s
  // was too tight and routinely tripped the spawn fallback. Give it real
  // headroom — the covering index keeps the warm case well under 100ms.
  try {
    const res = await daemon.call<{ ok: boolean; roots: IndexedRoot[] }>("list-roots", {}, 12_000);
    return res?.roots || [];
  } catch (err) {
    // If the daemon is alive but was just slow, a fresh one-shot spawn re-pays
    // the ~800ms Windows cold-start tax AND re-runs the same scan — the user
    // ends up waiting twice. The first (timed-out) call has already warmed the
    // OS file cache, so a second daemon call is the fast path. Only fall back
    // to spawn when the daemon is genuinely dead.
    if (daemon.isAlive()) {
      logger.warn("[rust-file-indexer] list-roots slow on live daemon; retrying on daemon:", err);
      try {
        const res = await daemon.call<{ ok: boolean; roots: IndexedRoot[] }>("list-roots", {}, 20_000);
        return res?.roots || [];
      } catch (err2) {
        logger.warn("[rust-file-indexer] list-roots daemon retry failed:", err2);
      }
    }
    logger.warn("[rust-file-indexer] list-roots via daemon failed, falling back to spawn:", err);
    const res = await runIndexer<{ ok: boolean; roots: IndexedRoot[] }>("list-roots", {});
    return res?.roots || [];
  }
}

export async function addRoot(
  rootPath: string,
  schedule: RootSchedule = "daily",
  intervalHours?: number,
): Promise<IndexedRoot | null> {
  await ensureInitialized();
  const res = await runIndexer<{ ok: boolean; root: IndexedRoot }>("add-root", {
    path: rootPath,
    schedule,
    "interval-hours": intervalHours,
  });
  return res?.ok ? res.root : null;
}

export async function removeRoot(rootId: string): Promise<boolean> {
  await ensureInitialized();
  const res = await runIndexer<{ ok: boolean }>("remove-root", { "root-id": rootId });
  return !!res?.ok;
}

export async function updateRoot(
  rootId: string,
  opts: { enabled?: boolean; schedule?: RootSchedule; intervalHours?: number; excludeGlobs?: string; semantic?: boolean },
): Promise<boolean> {
  await ensureInitialized();
  const res = await runIndexer<{ ok: boolean }>("update-root", {
    "root-id": rootId,
    enabled: opts.enabled === undefined ? undefined : (opts.enabled ? "1" : "0"),
    schedule: opts.schedule,
    "interval-hours": opts.intervalHours,
    "exclude-globs": opts.excludeGlobs,
    semantic: opts.semantic === undefined ? undefined : (opts.semantic ? "1" : "0"),
  });
  return !!res?.ok;
}

// ─────────────────────────────────────────────────────────
// Semantic embeddings (pending queue + vector write-back)
// ─────────────────────────────────────────────────────────

/** Files crawled but not yet embedded (status pending/stale). */
export async function getPending(rootId?: string, limit = 500): Promise<PendingFile[]> {
  await ensureInitialized();
  try {
    const res = await daemon.call<{ ok: boolean; files: PendingFile[] }>(
      "get-pending",
      { root_id: rootId, limit },
      15_000,
    );
    return res?.files || [];
  } catch (err) {
    logger.warn("[rust-file-indexer] get-pending via daemon failed, falling back to spawn:", err);
    const res = await runIndexer<{ ok: boolean; files: PendingFile[] }>("get-pending", {
      "root-id": rootId,
      limit,
    }).catch(() => null);
    return res?.files || [];
  }
}

/** Write an embedding (+ summary/keywords) back to a file and mark it indexed. */
export async function updateEmbedding(input: {
  fileId: string;
  vector: number[];
  summary?: string;
  keywords?: string;
  embeddingModel?: string;
}): Promise<boolean> {
  await ensureInitialized();
  const res = await daemon.call<{ ok: boolean }>(
    "update-embedding",
    {
      file_id: input.fileId,
      vector: input.vector,
      summary: input.summary,
      keywords: input.keywords,
      embedding_model: input.embeddingModel,
    },
    20_000,
  );
  return !!res?.ok;
}

/** Mark a file as errored so it leaves the pending queue. */
export async function markError(fileId: string, message: string): Promise<boolean> {
  await ensureInitialized();
  const res = await daemon.call<{ ok: boolean }>(
    "mark-error",
    { file_id: fileId, error_message: message },
    10_000,
  );
  return !!res?.ok;
}

/**
 * Wipe semantic state (vectors/summary/keywords) and flip embedded rows back to
 * pending so they can be re-embedded. Optionally scoped to one root. Uses a
 * one-shot spawn since it can touch many rows.
 */
export async function clearEmbeddings(
  rootId?: string,
): Promise<{ ok: boolean; cleared: number; had_vectors: number }> {
  await ensureInitialized();
  const res = await runIndexer<{ ok: boolean; cleared: number; had_vectors: number }>(
    "clear-embeddings",
    { "root-id": rootId },
    { timeoutMs: 10 * 60 * 1000 },
  );
  return res || { ok: false, cleared: 0, had_vectors: 0 };
}

export async function scanRoot(rootId: string, workers?: number): Promise<ScanProgress | null> {
  await ensureInitialized();
  const res = await runIndexer<{ ok: boolean; progress: ScanProgress }>(
    "scan",
    { "root-id": rootId, workers },
    { timeoutMs: 30 * 60 * 1000 },
  );
  if (!res?.ok) return null;
  return res.progress;
}

export async function getStats(): Promise<FileIndexStats | null> {
  await ensureInitialized();
  try {
    return await daemon.call<FileIndexStats>("stats", {}, 5000);
  } catch {
    return await runIndexer<FileIndexStats>("stats", {}).catch(() => null);
  }
}

export async function searchFiles(
  query: string,
  options: { kind?: string; limit?: number; rootId?: string; vector?: number[]; mode?: SearchMode } = {},
): Promise<FileSearchResult[]> {
  await ensureInitialized();
  const hasVector = Array.isArray(options.vector) && options.vector.length > 0;
  const args: Record<string, any> = {
    query,
    limit: options.limit ?? 50,
  };
  if (options.kind) args.kind = options.kind;
  if (options.rootId) args.root_id = options.rootId;
  if (hasVector) args.vector = options.vector;
  if (options.mode) args.mode = options.mode;

  // The daemon now holds a long-lived SQLite connection and caps FTS token
  // count, so queries that previously timed out at 5s now complete in under
  // 100ms. 8s leaves headroom for the very first cold-cache query on a
  // multi-million-row index without making typo'd searches feel laggy.
  // A vector (semantic/hybrid) query brute-forces cosine over the embedded
  // subset, so it gets a wider timeout.
  const timeoutMs = hasVector ? 15_000 : 8000;
  try {
    const res = await daemon.call<{ ok: boolean; results: FileSearchResult[] }>("search", args, timeoutMs);
    return res?.results || [];
  } catch (err) {
    // Only fall back to a one-shot spawn if the daemon is actually broken —
    // not just slow. Spawning re-pays the ~800ms Windows cold-start tax, and
    // when the daemon is alive-but-busy the redundant spawn doubles load.
    if (daemon.isAlive()) {
      logger.warn("[rust-file-indexer] daemon search timed out (alive); returning empty:", err);
      return [];
    }
    logger.warn("[rust-file-indexer] search via daemon failed, falling back to spawn:", err);
    try {
      const res = await runIndexer<{ ok: boolean; results: FileSearchResult[] }>("search", {
        query,
        limit: options.limit ?? 50,
        kind: options.kind,
        "root-id": options.rootId,
      }, { timeoutMs: 10_000 });
      return res?.results || [];
    } catch (err2) {
      logger.warn("[rust-file-indexer] search spawn fallback also failed:", err2);
      return [];
    }
  }
}

export async function listFolder(
  folderPath: string,
  options: { recursive?: boolean; limit?: number } = {},
): Promise<FileSearchResult[]> {
  await ensureInitialized();
  try {
    const res = await daemon.call<{ ok: boolean; results: FileSearchResult[] }>(
      "list-folder",
      { path: folderPath, recursive: !!options.recursive, limit: options.limit ?? 200 },
      10_000,
    );
    return res?.results || [];
  } catch (err) {
    logger.warn("[rust-file-indexer] list-folder failed:", err);
    return [];
  }
}
