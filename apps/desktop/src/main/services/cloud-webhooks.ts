import WebSocket from 'ws';
import { app, net, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { handleCloudWebhookEvent } from '../workflows';
import logger from '../utils/logger';
import { notifyOrchestratorDone } from './agent-task-notifications';
import {
    getMainAccessToken,
    getMainSupabaseClient,
    getMainAuthSession,
    onMainAuthSessionChange,
} from './auth-session';
import { execTool } from '../tools/index';
import type { RouterContext } from '../tools/types';

let ws: WebSocket | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let isStarted = false;
let cloudWebhooksAuthUnsub: (() => void) | null = null;

// ── Agent Data Sync (VM ⇄ Desktop) ─────────────────────────────────────────
// When the VM uploads new agent data to GCS, cloud-ai notifies us via WS.
// We download the archive and extract it so the local Python agent picks up
// changes. Pushes from desktop go through the reverse path.
//
// All heavy I/O (tar create/extract, copying multi-MB DB files) MUST be
// async — the Electron main process is shared with the renderer's IPC, so
// any sync call here freezes the whole UI for the duration of the op.

type SyncJob = () => Promise<void>;
let _syncQueue: Promise<void> = Promise.resolve();
let _syncRunning = false;
let _lastPushSucceededAt = 0;
const MIN_PUSH_INTERVAL_MS = 30_000;

type AgentDataPushResult = {
    ok: boolean;
    skipped?: boolean;
    reason?: string;
    bytes?: number;
    error?: string;
};

type AgentDataPushOptions = {
    /** When true, skip export/archive/upload unless the cloud engine is running. */
    requireRunningVm?: boolean;
};

async function fetchCloudEngineStatus(token: string, apiBase: string): Promise<string | null> {
    try {
        const statusResp = await fetch(`${apiBase}/v1/cloud-engine/status`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` },
            signal: AbortSignal.timeout(8_000),
        });
        if (!statusResp.ok) return null;
        const statusData: any = await statusResp.json().catch(() => ({}));
        return String(statusData?.engine?.status || '') || null;
    } catch {
        return null;
    }
}

/**
 * Serialize all sync work (push + pull) on a single queue. Prevents races
 * where a download clobbers a fresh local write that hasn't uploaded yet,
 * and ensures the main process never has two tar processes running at once.
 */
function enqueueSync(label: string, job: SyncJob): Promise<void> {
    const next = _syncQueue.then(async () => {
        _syncRunning = true;
        broadcastSyncStatus({ phase: 'start', label });
        try {
            await job();
            broadcastSyncStatus({ phase: 'done', label });
        } catch (e: any) {
            logger.error(`[cloud-webhooks] Sync job '${label}' failed: ${e?.message}`);
            broadcastSyncStatus({ phase: 'error', label, error: String(e?.message || 'failed') });
        } finally {
            _syncRunning = false;
        }
    });
    _syncQueue = next.catch(() => undefined);
    return next;
}

function broadcastSyncStatus(payload: { phase: 'start' | 'done' | 'error'; label: string; error?: string }): void {
    try {
        for (const win of BrowserWindow.getAllWindows()) {
            try { win.webContents.send('agent:sync-status', payload); } catch { /* noop */ }
        }
    } catch { /* noop */ }
}

/**
 * Run a child process to completion. Replaces `execFileSync` so the main
 * thread can keep servicing IPC while tar runs.
 */
function runChild(cmd: string, args: string[], opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';
        let timer: NodeJS.Timeout | null = null;
        let aborted = false;
        if (opts.timeoutMs && opts.timeoutMs > 0) {
            timer = setTimeout(() => {
                aborted = true;
                try { child.kill('SIGKILL'); } catch { /* noop */ }
            }, opts.timeoutMs);
        }
        const onAbort = () => {
            aborted = true;
            try { child.kill('SIGKILL'); } catch { /* noop */ }
        };
        if (opts.signal) {
            if (opts.signal.aborted) onAbort();
            else opts.signal.addEventListener('abort', onAbort, { once: true });
        }
        child.stderr?.on('data', (d) => { stderr += d.toString(); });
        child.on('error', (e) => {
            if (timer) clearTimeout(timer);
            reject(e);
        });
        child.on('close', (code) => {
            if (timer) clearTimeout(timer);
            if (opts.signal) opts.signal.removeEventListener?.('abort', onAbort);
            if (aborted) return reject(new Error(`${cmd} aborted`));
            if (code === 0) return resolve();
            reject(new Error(`${cmd} exited ${code}: ${stderr.trim().slice(0, 500)}`));
        });
    });
}

async function pathExists(p: string): Promise<boolean> {
    try { await fsp.access(p); return true; } catch { return false; }
}

function getDesktopAgentDataDir(): string {
    if (process.env.AGENT_DATA_DIR) return process.env.AGENT_DATA_DIR;
    if (process.platform === 'win32') {
        const base = process.env.APPDATA || app.getPath('userData');
        return path.join(base, 'StuardAI', 'agent');
    } else if (process.platform === 'darwin') {
        return path.join(app.getPath('home'), 'Library', 'Application Support', 'StuardAI', 'agent');
    } else {
        const base = process.env.XDG_DATA_HOME || path.join(app.getPath('home'), '.local', 'share');
        return path.join(base, 'StuardAI', 'agent');
    }
}

/**
 * Forward a chat_sync event into the local Python agent's memory.db so the
 * conversation and messages become part of persistent history (not just the
 * in-memory sidebar list). Tolerates transient agent unavailability — the
 * periodic full memory.db sync will backfill if this fails.
 */
async function persistIncomingChatSync(msg: any): Promise<void> {
    const action = String(msg?.action || '');
    const conversationId = String(msg?.conversationId || '');
    if (!conversationId) return;

    const agentHttp = String(process.env.AGENT_HTTP || 'http://127.0.0.1:8765').replace(/\/+$/, '');
    const data = msg?.data || {};

    const execTool = async (tool: string, args: any): Promise<void> => {
        try {
            await fetch(`${agentHttp}/v1/tools/exec`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tool, args }),
                signal: AbortSignal.timeout(10_000),
            });
        } catch (e: any) {
            logger.warn(`[cloud-webhooks] chat_sync ${tool} failed: ${e?.message}`);
        }
    };

    if (action === 'new_conversation') {
        await execTool('conversation_create', {
            conversation_id: conversationId,
            title: data.title || undefined,
            model: data.model || undefined,
            source: 'stuard',
        });
    } else if (action === 'title_update' && typeof data.title === 'string' && data.title) {
        await execTool('conversation_update', {
            conversation_id: conversationId,
            title: data.title,
        });
    } else if (action === 'new_message' && typeof data.content === 'string' && data.content) {
        // message_add auto-creates the conversation if it doesn't exist yet.
        await execTool('message_add', {
            conversation_id: conversationId,
            role: data.role === 'user' ? 'user' : 'assistant',
            content: data.content,
        });
    }
}

/**
 * Download updated agent databases from GCS via cloud-ai signed URL.
 * Extracts knowledge.db, memory.db, etc. to the desktop agent data directory.
 * All filesystem and tar work is async — no main-thread blocking.
 */
async function handleAgentDataUpdated(msg?: any): Promise<void> {
    const token = await getAuthToken();
    if (!token) {
        logger.warn('[cloud-webhooks] No auth token for agent data download');
        return;
    }

    const apiBase = getCloudAiHttpBase();

    const downloadUrlResp = await fetch(`${apiBase}/v1/storage/agent-data-url`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
    });

    if (!downloadUrlResp.ok) {
        logger.warn(`[cloud-webhooks] Could not get agent data URL: ${downloadUrlResp.status}`);
        return;
    }

    const urlData = await downloadUrlResp.json() as any;
    const mode = String(msg?.mode || 'full').toLowerCase() === 'delta' ? 'delta' : 'full';
    const downloadUrl = mode === 'delta'
        ? (urlData.deltaDownloadUrl || urlData.downloadUrl)
        : urlData.downloadUrl;
    if (!downloadUrl) {
        logger.info('[cloud-webhooks] No agent data available in cloud storage');
        return;
    }

    const tmpDir = app.getPath('temp');
    const tmpFile = path.join(tmpDir, `agent-data-sync-${Date.now()}.tar.gz`);
    const tmpExtract = path.join(tmpDir, `agent-data-extract-${Date.now()}`);

    try {
        const dlResp = await fetch(downloadUrl, { signal: AbortSignal.timeout(10 * 60_000) });
        if (!dlResp.ok || !dlResp.body) {
            logger.error(`[cloud-webhooks] Agent data download failed: ${dlResp.status}`);
            return;
        }

        const { Readable } = await import('stream');
        const { pipeline } = await import('stream/promises');
        await pipeline(Readable.fromWeb(dlResp.body as any), fs.createWriteStream(tmpFile));

        const stats = await fsp.stat(tmpFile);
        logger.info(`[cloud-webhooks] Downloaded ${mode} agent data: ${stats.size} bytes`);

        const agentDir = getDesktopAgentDataDir();
        await fsp.mkdir(agentDir, { recursive: true });
        await fsp.mkdir(tmpExtract, { recursive: true });

        await runChild('tar', ['-xzf', tmpFile, '-C', tmpExtract], { timeoutMs: 300_000 });

        // Handle new format (agent/ prefix) vs legacy (flat files)
        const extractedAgentDir = path.join(tmpExtract, 'agent');
        const sourceDir = (await pathExists(extractedAgentDir)) ? extractedAgentDir : tmpExtract;

        // Merge-safe copy: only overwrite local file if incoming is newer.
        // Prevents a stale GCS snapshot from clobbering newer local writes
        // made since the last upload.
        const mergeCopy = async (src: string, dest: string): Promise<boolean> => {
            try {
                const srcStat = await fsp.stat(src);
                if (!srcStat.isFile()) return false;
                if (await pathExists(dest)) {
                    const destStat = await fsp.stat(dest);
                    if (destStat.size > 0 && destStat.mtimeMs >= srcStat.mtimeMs) {
                        return false;
                    }
                }
                await fsp.copyFile(src, dest);
                try { await fsp.utimes(dest, srcStat.atime, srcStat.mtime); } catch { /* best-effort */ }
                return true;
            } catch {
                return false;
            }
        };

        const dbFiles = new Set([
            'knowledge.db', 'memory.db', 'file_index.db', 'workflow.db',
            'knowledge.db-wal', 'knowledge.db-shm',
            'memory.db-wal', 'memory.db-shm',
            'file_index.db-wal', 'file_index.db-shm',
            'workflow.db-wal', 'workflow.db-shm',
        ]);
        let copied = 0;
        let skipped = 0;
        const entries = await fsp.readdir(sourceDir, { withFileTypes: true });
        for (const ent of entries) {
            if (!ent.isFile()) continue;
            if (!(dbFiles.has(ent.name) || ent.name.endsWith('.db'))) continue;
            const dest = path.join(agentDir, ent.name);
            const ok = await mergeCopy(path.join(sourceDir, ent.name), dest);
            if (ok) {
                copied++;
                try {
                    const destStat = await fsp.stat(dest);
                    _desktopMtimes.set(ent.name, destStat.mtimeMs);
                } catch { /* best-effort */ }
            } else {
                skipped++;
            }
        }

        // Install device keys from the archive when present (file-backed
        // fallback only — we never touch the OS keyring from here).
        const extractedKeysDir = path.join(tmpExtract, '.stuard_keys');
        if (await pathExists(extractedKeysDir)) {
            try {
                const keysDest = path.join(process.env.HOME || process.env.USERPROFILE || '', '.stuard', 'keys');
                await fsp.mkdir(keysDest, { recursive: true });
                const keyEntries = await fsp.readdir(extractedKeysDir, { withFileTypes: true });
                for (const ent of keyEntries) {
                    if (!ent.isFile()) continue;
                    const src = path.join(extractedKeysDir, ent.name);
                    const dst = path.join(keysDest, ent.name);
                    if (!(await pathExists(dst))) {
                        await fsp.copyFile(src, dst);
                    }
                }
                logger.info('[cloud-webhooks] Device keys installed from archive');
            } catch (e: any) {
                logger.warn(`[cloud-webhooks] Device-key install failed: ${e?.message}`);
            }
        }

        logger.info(`[cloud-webhooks] Agent data sync complete: ${copied} files updated, ${skipped} skipped (local newer) in ${agentDir}`);

        try {
            for (const win of BrowserWindow.getAllWindows()) {
                try { win.webContents.send('agent:data-synced', { source: 'vm', files: copied }); } catch { }
            }
        } catch { }
    } finally {
        await fsp.rm(tmpExtract, { recursive: true, force: true }).catch(() => undefined);
        await fsp.unlink(tmpFile).catch(() => undefined);
    }
}

/**
 * Upload desktop's agent databases to GCS and notify VM to pull them.
 * Called after local knowledge/memory changes to keep VM in sync.
 * All filesystem and tar work is async — no main-thread blocking.
 */
type AgentDataSyncMode = 'full' | 'delta' | 'manifest';

// ── Manifest diff (desktop→VM) ───────────────────────────────────────────────
// Before a push we ask the VM which DB files it already has (name+size+sha256)
// so we skip re-shipping byte-identical files — a warm restart shouldn't
// re-upload an unchanged file_index.db. memory.db is never manifest-diffed:
// it's a decrypted plaintext export the VM row-merges, so its bytes never match.
const MANIFEST_GROUPS: string[][] = [
    ['knowledge.db', 'knowledge.db-wal', 'knowledge.db-shm'],
    ['file_index.db', 'file_index.db-wal', 'file_index.db-shm'],
    ['workflow.db', 'workflow.db-wal', 'workflow.db-shm'],
];

/** Stream-hash a file in 1 MB chunks (matches the VM's algorithm). */
function fileSha256(filePath: string): string | null {
    try {
        const hash = createHash('sha256');
        const fd = fs.openSync(filePath, 'r');
        try {
            const buf = Buffer.allocUnsafe(1 << 20);
            let pos = 0;
            let bytesRead = 0;
            while ((bytesRead = fs.readSync(fd, buf, 0, buf.length, pos)) > 0) {
                hash.update(buf.subarray(0, bytesRead));
                pos += bytesRead;
            }
        } finally {
            fs.closeSync(fd);
        }
        return hash.digest('hex');
    } catch {
        return null;
    }
}

interface VmAgentDataManifest {
    files: Map<string, { size: number; sha256: string }>;
    memoryPresent: boolean;
}

async function fetchVmAgentDataManifest(
    token: string,
    apiBase: string,
): Promise<VmAgentDataManifest | null> {
    try {
        const resp = await fetch(`${apiBase}/v1/vm/relay`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({
                path: '/command',
                method: 'POST',
                body: { command: 'agent_data_manifest', args: {} },
                timeoutMs: 30_000,
            }),
            signal: AbortSignal.timeout(35_000),
        });
        if (!resp.ok) return null; // includes 503 vm_starting → caller ships all
        const data: any = await resp.json().catch(() => null);
        // The relay wraps the VM's /command body in `result`; the command itself
        // returns { ok, files, memoryPresent }.
        const inner = data?.result?.result ?? data?.result;
        const files = inner?.files;
        if (!Array.isArray(files)) return null;
        const map = new Map<string, { size: number; sha256: string }>();
        for (const f of files) {
            if (f && typeof f.name === 'string') {
                map.set(f.name, { size: Number(f.size) || 0, sha256: String(f.sha256 || '') });
            }
        }
        return { files: map, memoryPresent: inner?.memoryPresent === true };
    } catch {
        return null;
    }
}

/**
 * Manifest diff result. `skip` = agent-data file names the VM already has
 * byte-identical (so the push can omit them). `memoryPresent` = whether the VM
 * holds a non-empty memory.db (drives full vs incremental memory export).
 * Returns null when the manifest can't be fetched (VM unreachable / still
 * booting) — callers then ship all files (a normal full).
 */
async function computeManifestSkipSet(
    token: string,
    apiBase: string,
    agentDir: string,
): Promise<{ skip: Set<string>; memoryPresent: boolean } | null> {
    const manifest = await fetchVmAgentDataManifest(token, apiBase);
    if (!manifest) return null;
    const skip = new Set<string>();
    for (const group of MANIFEST_GROUPS) {
        let identical = true;
        for (const name of group) {
            const local = path.join(agentDir, name);
            const localExists = fs.existsSync(local);
            const vmEntry = manifest.files.get(name);
            if (!localExists && !vmEntry) continue;                       // neither side has it
            if (!localExists || !vmEntry) { identical = false; break; }   // one-sided → differs
            const st = fs.statSync(local);
            if (st.size !== vmEntry.size || fileSha256(local) !== vmEntry.sha256) {
                identical = false;
                break;
            }
        }
        if (identical) for (const name of group) skip.add(name);
    }
    return { skip, memoryPresent: manifest.memoryPresent };
}

// ── Row-level memory sync cursor ─────────────────────────────────────────────
// memory.db is exported as a decrypted plaintext copy the VM row-merges. Rather
// than re-export/ship the whole DB every push, we ask the Python agent for only
// the rows changed since this cursor (the newest content timestamp we last
// confirmed synced). Persisted next to memory.db so it survives desktop
// restarts. Reset/empty cursor → full export re-establishes the baseline.
const MEMORY_CURSOR_FILE = '.memory-sync-cursor';
// Force a full (non-incremental) memory export every Nth export as a safety
// net: covers a silently-reset VM and any timestamp edge (e.g. a DST offset
// flip) that a string-compared `since` could miss. ~5 min at the fast cadence.
const MEMORY_FULL_EVERY = 20;
let _memoryExportCount = 0;
// Whether we've confirmed the current VM holds a full memory.db this session.
// Incremental (partial) exports are only safe once a full baseline exists on
// the VM — otherwise the VM would adopt a partial export as its whole history.
// Reconciled from the manifest's memoryPresent and set after a full upload;
// in-memory, so a desktop restart re-establishes a full baseline first.
let _vmMemoryConfirmedPresent = false;

function readMemorySyncCursor(agentDir: string): string | null {
    try {
        const raw = fs.readFileSync(path.join(agentDir, MEMORY_CURSOR_FILE), 'utf8').trim();
        return raw || null;
    } catch {
        return null;
    }
}

function writeMemorySyncCursor(agentDir: string, cursor: string): void {
    try {
        fs.writeFileSync(path.join(agentDir, MEMORY_CURSOR_FILE), cursor, 'utf8');
    } catch (e: any) {
        logger.warn(`[cloud-webhooks] could not persist memory sync cursor: ${e?.message}`);
    }
}

function getChangedDesktopAgentDataFiles(agentDir: string): Set<string> {
    const filesToWatch = [
        'knowledge.db', 'knowledge.db-wal', 'knowledge.db-shm',
        'memory.db', 'memory.db-wal', 'memory.db-shm',
        'file_index.db', 'file_index.db-wal', 'file_index.db-shm',
        'workflow.db', 'workflow.db-wal', 'workflow.db-shm',
    ];
    const changed = new Set<string>();
    for (const name of filesToWatch) {
        const filePath = path.join(agentDir, name);
        if (!fs.existsSync(filePath)) continue;
        try {
            const mtime = fs.statSync(filePath).mtimeMs;
            const prev = _desktopMtimes.get(name);
            if (prev === undefined || mtime > prev) changed.add(name);
        } catch {
            changed.add(name);
        }
    }

    for (const group of [
        ['knowledge.db', 'knowledge.db-wal', 'knowledge.db-shm'],
        ['file_index.db', 'file_index.db-wal', 'file_index.db-shm'],
        ['workflow.db', 'workflow.db-wal', 'workflow.db-shm'],
    ]) {
        if (!group.some((name) => changed.has(name))) continue;
        for (const name of group) {
            if (fs.existsSync(path.join(agentDir, name))) changed.add(name);
        }
    }

    return changed;
}

async function performDesktopAgentDataPushToVM(
    mode: AgentDataSyncMode = 'full',
    opts: AgentDataPushOptions = {},
): Promise<AgentDataPushResult> {
    const token = await getAuthToken();
    if (!token) return { ok: false, error: 'not_authenticated' };

    const apiBase = getCloudAiHttpBase();
    const agentDir = getDesktopAgentDataDir();

    if (!(await pathExists(agentDir))) {
        logger.warn('[cloud-webhooks] Agent data dir does not exist');
        return { ok: false, error: 'agent_data_dir_missing' };
    }

    const changedNames = mode === 'delta' ? getChangedDesktopAgentDataFiles(agentDir) : new Set<string>();
    if (mode === 'delta' && changedNames.size === 0) {
        logger.info('[cloud-webhooks] Delta agent-data push skipped: no changed files');
        return { ok: true, skipped: true, reason: 'no_changed_files' };
    }

    if (opts.requireRunningVm) {
        const engineStatus = await fetchCloudEngineStatus(token, apiBase);
        if (engineStatus !== 'running') {
            logger.info(`[cloud-webhooks] Agent data push skipped: VM not running (${engineStatus || 'no engine'})`);
            return { ok: true, skipped: true, reason: 'engine_not_running' };
        }
    }

    // Manifest diff: when the VM is reachable, skip re-shipping DB files it
    // already has byte-identical (esp. an unchanged file_index.db on a warm
    // restart). null = couldn't reach the VM → ship everything (full).
    const manifest = mode === 'manifest'
        ? await computeManifestSkipSet(token, apiBase, agentDir)
        : null;
    const manifestSkip = manifest?.skip ?? null;
    // Only force a full memory export off the manifest when we actually reached
    // the VM and it reported no memory.db (fresh/reset). `undefined` = manifest
    // not fetched (delta) or VM unreachable → don't force; trust the cursor.
    const vmMemoryPresent: boolean | undefined = manifest ? manifest.memoryPresent : undefined;
    // Manifest pushes are partial archives the VM merge-copies, like a delta.
    const partialArchive = mode === 'delta' || mode === 'manifest';

    const tmpDir = app.getPath('temp');
    const stageDir = path.join(tmpDir, `agent-data-stage-${Date.now()}`);
    const stageAgentDir = path.join(stageDir, 'agent');
    const tmpFile = path.join(tmpDir, `agent-data-upload-${Date.now()}.tar.gz`);

    try {
        await fsp.mkdir(stageAgentDir, { recursive: true });

        // Mirror agent files into the stage (preserving mtime). memory.db is
        // special: the VM runs in plaintext mode and cannot decrypt
        // desktop-encrypted rows, so we substitute a decrypted plaintext
        // copy produced by the local Python agent.
        const MEMORY_DB_FILES = new Set(['memory.db', 'memory.db-wal', 'memory.db-shm']);
        const entries = await fsp.readdir(agentDir, { withFileTypes: true });
        await Promise.all(entries.map(async (ent) => {
            if (!ent.isFile()) return;
            if (ent.name === MEMORY_CURSOR_FILE) return; // desktop-local sync bookkeeping, never ship
            if (mode === 'delta' && !changedNames.has(ent.name)) return;
            if (manifestSkip && manifestSkip.has(ent.name)) return; // VM already has identical copy
            if (MEMORY_DB_FILES.has(ent.name)) return;
            const src = path.join(agentDir, ent.name);
            const dest = path.join(stageAgentDir, ent.name);
            try {
                const st = await fsp.stat(src);
                await fsp.copyFile(src, dest);
                try { await fsp.utimes(dest, st.atime, st.mtime); } catch { /* best-effort */ }
            } catch { /* skip unreadable */ }
        }));

        // Ask the local Python agent to export memory.db with all encrypted
        // columns decrypted and tagged as plaintext. The VM reads these rows
        // directly without needing the desktop's device key.
        const exportPath = path.join(stageAgentDir, 'memory.db');
        const shouldExportMemory = mode === 'full' || mode === 'manifest' || [...MEMORY_DB_FILES].some((name) => changedNames.has(name));

        // Row-level decision: export only memory.db rows changed since the
        // cursor, except when a full baseline must be (re)established — explicit
        // full, no cursor yet, the periodic safety net, a deploy/start push the
        // VM didn't confirm already holds memory.db, or a periodic push before
        // the baseline is confirmed for this VM. A partial export into a VM with
        // no baseline would be adopted as its whole history, so gate carefully.
        const cursor = readMemorySyncCursor(agentDir);
        if (mode === 'manifest') _vmMemoryConfirmedPresent = vmMemoryPresent === true;
        const forceFullMemory =
            mode === 'full'
            || !cursor
            || (_memoryExportCount % MEMORY_FULL_EVERY === 0)
            || (mode === 'manifest' && vmMemoryPresent !== true)
            || (mode === 'delta' && !_vmMemoryConfirmedPresent);
        const memorySince = (shouldExportMemory && !forceFullMemory) ? cursor : null;

        // Persisted/applied only after the upload succeeds, so a failed push
        // re-syncs the same rows next time instead of skipping them.
        let nextMemoryCursor: string | null = null;
        let exportedFullMemory = false;

        if (shouldExportMemory) {
            _memoryExportCount++;
            try {
                const agentHttp = String(process.env.AGENT_HTTP || 'http://127.0.0.1:8765').replace(/\/+$/, '');
                const resp = await fetch(`${agentHttp}/v1/tools/exec`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        tool: 'memory_export_plaintext',
                        args: memorySince
                            ? { output_path: exportPath, since: memorySince }
                            : { output_path: exportPath },
                    }),
                    signal: AbortSignal.timeout(120_000),
                });
                if (!resp.ok) {
                    logger.warn(`[cloud-webhooks] memory_export_plaintext HTTP ${resp.status}`);
                    const src = path.join(agentDir, 'memory.db');
                    if (await pathExists(src)) await fsp.copyFile(src, exportPath);
                } else {
                    const result: any = await resp.json().catch(() => ({ ok: false }));
                    if (!result?.ok) {
                        logger.warn(`[cloud-webhooks] memory_export_plaintext failed: ${result?.error || 'unknown'}`);
                        const src = path.join(agentDir, 'memory.db');
                        if (await pathExists(src)) await fsp.copyFile(src, exportPath);
                    } else {
                        if (typeof result.max_updated_at === 'string' && result.max_updated_at) {
                            nextMemoryCursor = result.max_updated_at;
                        }
                        exportedFullMemory = !memorySince;
                        logger.info(`[cloud-webhooks] memory.db exported ${memorySince ? 'incremental' : 'full'}: ${result.bytes || '?'} bytes, ${result.conversations || 0} convs, ${result.messages || 0} msgs`);
                    }
                }
                // Force a fresh mtime so the VM's merge-copy treats it as newer
                // than any legacy encrypted memory.db already on disk.
                try {
                    const now = new Date();
                    await fsp.utimes(exportPath, now, now);
                } catch { /* best-effort */ }
            } catch (e: any) {
                logger.warn(`[cloud-webhooks] memory.db plaintext export errored: ${e?.message}`);
            }
        }

        await runChild('tar', ['-czf', tmpFile, '-C', stageDir, '.'], { timeoutMs: 300_000 });

        const stats = await fsp.stat(tmpFile);
        logger.info(`[cloud-webhooks] Agent data ${mode} archive: ${stats.size} bytes`);

        const urlResp = await fetch(`${apiBase}/v1/storage/agent-data-url`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` },
            signal: AbortSignal.timeout(15_000),
        });

        if (!urlResp.ok) return { ok: false, error: `agent_data_url_http_${urlResp.status}` };
        const urlData = await urlResp.json() as any;
        // Upload to the delta object only if one is available; otherwise fall
        // back to the full object AND notify 'full' so the two stay consistent
        // (a 'delta' notify against a full-object upload would desync the VM).
        const useDelta = partialArchive && !!urlData.deltaUploadUrl;
        const uploadUrl = useDelta ? urlData.deltaUploadUrl : urlData.uploadUrl;
        if (!uploadUrl) return { ok: false, error: 'agent_data_url_missing' };

        const uploadResp = await fetch(uploadUrl, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/gzip',
                'Content-Length': String(stats.size),
            },
            body: fs.createReadStream(tmpFile) as any,
            duplex: 'half' as any,
            signal: AbortSignal.timeout(10 * 60_000),
        } as any);

        if (!uploadResp.ok) {
            logger.error(`[cloud-webhooks] Agent data upload failed: ${uploadResp.status}`);
            return { ok: false, error: `upload_http_${uploadResp.status}`, bytes: stats.size };
        }

        let shouldNotifyVm = true;
        let engineStatus = await fetchCloudEngineStatus(token, apiBase) || '';
        shouldNotifyVm = engineStatus === 'running';
        if (!shouldNotifyVm && !engineStatus) {
            logger.warn('[cloud-webhooks] Could not check VM status before agent-data notify');
        }

        let pushOutcome = 'uploaded to cloud storage';
        if (shouldNotifyVm) {
            const notifyResp = await fetch(`${apiBase}/v1/cloud-engine/push-agent-data`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({ mode: useDelta ? 'delta' : 'full' }),
                signal: AbortSignal.timeout(15_000),
            }).catch((e: any) => {
                logger.warn(`[cloud-webhooks] push-agent-data notify failed: ${e?.message}`);
                return null;
            });
            if (notifyResp?.ok) {
                pushOutcome = 'pushed to VM';
            } else if (notifyResp) {
                pushOutcome = 'uploaded to cloud storage; VM notify failed';
                logger.warn(`[cloud-webhooks] push-agent-data notify returned HTTP ${notifyResp.status}`);
            }
        } else {
            logger.info(`[cloud-webhooks] Agent data uploaded; VM notify skipped (${engineStatus || 'no running engine'})`);
        }

        _lastPushSucceededAt = Date.now();
        // Advance the row-level cursor only now that the export is safely in
        // cloud storage. A successful full export means the VM will hold a
        // complete memory.db, so subsequent pushes may go incremental.
        if (nextMemoryCursor) writeMemorySyncCursor(agentDir, nextMemoryCursor);
        if (exportedFullMemory) _vmMemoryConfirmedPresent = true;
        logger.info(`[cloud-webhooks] Desktop agent data ${mode} ${pushOutcome}`);
        return { ok: true, bytes: stats.size };
    } catch (e: any) {
        logger.error(`[cloud-webhooks] Push agent data to VM failed: ${e?.message}`);
        return { ok: false, error: e?.message || 'push_failed' };
    } finally {
        await fsp.rm(stageDir, { recursive: true, force: true }).catch(() => undefined);
        await fsp.unlink(tmpFile).catch(() => undefined);
    }
}

export async function pushDesktopAgentDataToVM(opts: AgentDataPushOptions = {}): Promise<AgentDataPushResult> {
    let result: AgentDataPushResult = { ok: false, error: 'not_started' };
    await enqueueSync('desktop-agent-data-push', async () => {
        // 'manifest' = ship only DB files the VM doesn't already have identical
        // (falls back to a full ship if the VM can't be reached yet).
        result = await performDesktopAgentDataPushToVM('manifest', opts);
        if (result.ok && !result.skipped) snapshotDesktopMtimes();
    });
    return result;
}

// ── Desktop Periodic Agent Data Sync (Desktop → GCS → VM) ──────────────────
// A tight mtime watcher pushes any local change within ~15s while a longer
// interval catches missed updates / WAL checkpoint drift. Pushes coalesce
// through the sync queue and hasDesktopAgentDataChanged guard so rapid
// successive writes don't fan out into duplicate uploads.
const DESKTOP_SYNC_INTERVAL_MS = 60_000; // slow-path safety net
const DESKTOP_FAST_SYNC_DEBOUNCE_MS = 15_000; // fast-path debounce after a change
const _desktopMtimes = new Map<string, number>();
let _desktopSyncTimer: NodeJS.Timeout | null = null;
let _desktopFastSyncTimer: NodeJS.Timeout | null = null;

function hasDesktopAgentDataChanged(): boolean {
    const agentDir = getDesktopAgentDataDir();
    if (!fs.existsSync(agentDir)) return false;
    const filesToWatch = [
        'knowledge.db', 'knowledge.db-wal', 'knowledge.db-shm',
        'memory.db', 'memory.db-wal', 'memory.db-shm',
        'file_index.db', 'file_index.db-wal', 'file_index.db-shm',
        'workflow.db', 'workflow.db-wal', 'workflow.db-shm',
    ];
    for (const name of filesToWatch) {
        const filePath = path.join(agentDir, name);
        if (!fs.existsSync(filePath)) continue;
        try {
            const mtime = fs.statSync(filePath).mtimeMs;
            const prev = _desktopMtimes.get(name);
            if (prev === undefined || mtime > prev) return true;
        } catch { }
    }
    return false;
}

function snapshotDesktopMtimes(): void {
    const agentDir = getDesktopAgentDataDir();
    if (!fs.existsSync(agentDir)) return;
    const filesToWatch = [
        'knowledge.db', 'knowledge.db-wal', 'knowledge.db-shm',
        'memory.db', 'memory.db-wal', 'memory.db-shm',
        'file_index.db', 'file_index.db-wal', 'file_index.db-shm',
        'workflow.db', 'workflow.db-wal', 'workflow.db-shm',
    ];
    for (const name of filesToWatch) {
        const filePath = path.join(agentDir, name);
        if (fs.existsSync(filePath)) {
            try { _desktopMtimes.set(name, fs.statSync(filePath).mtimeMs); } catch { }
        }
    }
}

async function periodicDesktopAgentDataSync(): Promise<void> {
    if (_syncRunning) return;
    await enqueueSync('periodic-desktop-agent-data-push', syncDesktopAgentDataIfChanged);
}

async function syncDesktopAgentDataIfChanged(): Promise<void> {
    if (!hasDesktopAgentDataChanged()) return;
    const result = await performDesktopAgentDataPushToVM('delta', { requireRunningVm: true });
    if (result.ok && !result.skipped) snapshotDesktopMtimes();
}

function startDesktopAgentDataSync(): void {
    snapshotDesktopMtimes();
    _desktopSyncTimer = setInterval(() => {
        periodicDesktopAgentDataSync().catch((e: any) => {
            logger.warn(`[cloud-webhooks] Periodic desktop sync failed: ${e?.message}`);
        });
    }, DESKTOP_SYNC_INTERVAL_MS);
    logger.info(`[cloud-webhooks] Desktop agent data auto-sync: every ${DESKTOP_SYNC_INTERVAL_MS / 60_000} min (plus ${DESKTOP_FAST_SYNC_DEBOUNCE_MS / 1000}s debounced fast-path)`);
}

function stopDesktopAgentDataSync(): void {
    if (_desktopSyncTimer) {
        clearInterval(_desktopSyncTimer);
        _desktopSyncTimer = null;
    }
    if (_desktopFastSyncTimer) {
        clearTimeout(_desktopFastSyncTimer);
        _desktopFastSyncTimer = null;
    }
}

/**
 * Request a debounced agent-data push. Callers (conversation-finish hooks,
 * memory-writes, renderer IPCs) can fire-and-forget this whenever local
 * agent data changes; multiple requests within the debounce window coalesce
 * into a single upload.
 */
export function requestAgentDataPush(): void {
    if (_desktopFastSyncTimer) return; // already scheduled
    _desktopFastSyncTimer = setTimeout(async () => {
        _desktopFastSyncTimer = null;
        try {
            if (_syncRunning) return;
            await enqueueSync('fast-desktop-agent-data-push', syncDesktopAgentDataIfChanged);
        } catch (e: any) {
            logger.warn(`[cloud-webhooks] Fast-path desktop sync failed: ${e?.message}`);
        }
    }, DESKTOP_FAST_SYNC_DEBOUNCE_MS);
}

function getCloudAiHttpBase(): string {
    const url = String(
        process.env.CLOUD_AI_HTTP ||
        process.env.CLOUD_PUBLIC_URL ||
        process.env.VITE_CLOUD_AI_URL ||
        ''
    ).trim();
    return url ? url.replace(/\/+$/, '') : 'http://127.0.0.1:8082';
}

async function getAuthToken(): Promise<string | null> {
    const synced = getMainAccessToken();
    if (synced) return synced;
    try {
        const { BrowserWindow } = require('electron');
        for (const win of BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed()) {
                const token = await win.webContents.executeJavaScript(
                    `(async () => { try { const { data } = await window.supabase?.auth?.getSession(); return data?.session?.access_token || null; } catch { return null; } })()`,
                    true
                );
                if (token) return token;
            }
        }
    } catch { }
    return null;
}

export function startCloudWebhooks() {
    if (isStarted) return;
    isStarted = true;
    connect();
    startDesktopAgentDataSync();

    // Re-auth (or reconnect) the main WS whenever the user's Supabase session
    // changes — typically after sign-in. Without this the WS that opened
    // pre-auth would stay anonymous forever and `getDesktopWs(userId)` on the
    // cloud would never resolve, breaking voice tool calls and context.
    if (!cloudWebhooksAuthUnsub) {
        cloudWebhooksAuthUnsub = onMainAuthSessionChange(async () => {
            const token = await getAuthToken();
            if (!token) return;
            if (ws?.readyState === WebSocket.OPEN) {
                try { ws.send(JSON.stringify({ type: 'auth', accessToken: token })); } catch { }
            } else {
                connect();
            }
        });
    }
}

export function stopCloudWebhooks() {
    isStarted = false;
    stopDesktopAgentDataSync();
    if (cloudWebhooksAuthUnsub) {
        try { cloudWebhooksAuthUnsub(); } catch { }
        cloudWebhooksAuthUnsub = null;
    }
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (ws) {
        try { ws.removeAllListeners(); } catch { }
        try { ws.close(); } catch { }
        ws = null;
    }
}

/**
 * Handle a tool_request message from cloud-ai (VM → desktop relay).
 * Executes the tool locally and sends back a tool_result on the same WS.
 */
async function handleToolRequest(msg: any, socket: WebSocket): Promise<void> {
    const { id, tool, args } = msg;
    if (!id || !tool) {
        logger.warn(`[cloud-webhooks] tool_request missing id or tool`);
        return;
    }

    logger.info(`[cloud-webhooks] tool_request: ${tool} (id=${id})`);

    const proactiveBotId = typeof args?.__proactiveBotId === 'string' && args.__proactiveBotId.trim()
        ? args.__proactiveBotId.trim()
        : (typeof args?.proactiveBotId === 'string' && args.proactiveBotId.trim() ? args.proactiveBotId.trim() : undefined);
    const toolArgs = (() => {
        if (!args || typeof args !== 'object') return args || {};
        const { __proactiveBotId, proactiveBotId: _proactiveBotId, __userId: _userId, ...rest } = args;
        return rest;
    })();

    const ctx: RouterContext = {
        agentWsUrl: 'ws://127.0.0.1:8765/ws',
        cloudAiUrl: getCloudAiHttpBase(),
        logFn: (m: string) => logger.info(`[cloud-webhooks][tool] ${m}`),
        proactiveBotId,
    };

    try {
        const result = await execTool(tool, toolArgs, ctx);
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'tool_result', id, result }));
        }
    } catch (e: any) {
        logger.error(`[cloud-webhooks] tool_request error (${tool}): ${e?.message}`);
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: 'tool_result',
                id,
                result: { ok: false, error: e?.message || 'tool_execution_failed' },
            }));
        }
    }
}

async function connect() {
    if (!isStarted) return;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        return;
    }

    let wsUrl = getCloudAiHttpBase();
    if (wsUrl.startsWith('https://')) {
        wsUrl = 'wss://' + wsUrl.slice('https://'.length);
    } else if (wsUrl.startsWith('http://')) {
        wsUrl = 'ws://' + wsUrl.slice('http://'.length);
    }
    wsUrl += '/ws?client=desktop';

    logger.info(`[cloud-webhooks] Connecting to ${wsUrl}...`);

    try {
        ws = new WebSocket(wsUrl);

        ws.on('open', async () => {
            logger.info(`[cloud-webhooks] Connected.`);
            // Authenticate to receive webhooks
            const token = await getAuthToken();
            if (token && ws?.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'auth', accessToken: token }));
            }
        });

        ws.on('message', (data: WebSocket.RawData) => {
            try {
                const msg = JSON.parse(data.toString('utf8'));
                if (msg.type === 'auth_result') {
                    logger.info(`[cloud-webhooks] Auth result: ${msg.ok ? 'success' : 'failed'} (queued: ${msg.queued || 0})`);
                } else if (msg.type === 'webhook_trigger' || msg.type === 'provider_webhook') {
                    logger.info(`[cloud-webhooks] Received webhook event: ${msg.type}`);
                    handleCloudWebhookEvent(msg);
                } else if (msg.type === 'tool_request') {
                    handleToolRequest(msg, ws!);
                } else if (msg.type === 'chat_sync') {
                    logger.info(`[cloud-webhooks] Chat sync: ${msg.action} conv=${msg.conversationId} from=${msg.source}`);
                    // Persist to the local Python agent so the conversation
                    // appears in sidebar history and survives a restart.
                    persistIncomingChatSync(msg).catch((e: any) => {
                        logger.warn(`[cloud-webhooks] persistIncomingChatSync failed: ${e?.message}`);
                    });
                    try {
                        for (const win of BrowserWindow.getAllWindows()) {
                            try { win.webContents.send('chat:sync-event', msg); } catch { }
                        }
                    } catch { }
                } else if (msg.vmMirror && (msg.type === 'progress' || msg.type === 'final' || msg.type === 'conversation' || msg.type === 'title' || msg.type === 'subagent_event')) {
                    if (msg.type === 'final') {
                        try { notifyOrchestratorDone(msg); } catch { }
                    }
                    // VM stream mirror — relay real-time streaming events to renderer
                    try {
                        for (const win of BrowserWindow.getAllWindows()) {
                            try { win.webContents.send('vm:stream-event', msg); } catch { }
                        }
                    } catch { }
                } else if (
                    msg.type === 'subagent_event' ||
                    msg.type === 'subagent_question' ||
                    msg.type === 'subagent_answer' ||
                    msg.type === 'subagent_complete'
                ) {
                    // Relay subagent protocol messages to renderer for UI updates
                    try {
                        for (const win of BrowserWindow.getAllWindows()) {
                            try { win.webContents.send('subagent:message', msg); } catch { }
                        }
                    } catch { }
                } else if (msg.type === 'agent_data_updated') {
                    // VM uploaded new agent databases to GCS — download to desktop
                    logger.info(`[cloud-webhooks] Agent data updated from ${msg.source || 'vm'} (${msg.mode || 'full'})`);
                    enqueueSync('vm-agent-data-pull', () => handleAgentDataUpdated(msg)).catch((e: any) => {
                        logger.error(`[cloud-webhooks] Agent data sync failed: ${e?.message}`);
                    });
                } else if (msg.type === 'run_state_sync') {
                    logger.info(`[cloud-webhooks] Run state sync: approvals=${msg.pendingApprovals?.length || 0} terminals=${msg.terminals?.length || 0}`);
                    try {
                        for (const win of BrowserWindow.getAllWindows()) {
                            try { win.webContents.send('run-state:sync', msg); } catch { }
                        }
                    } catch { }
                } else if (msg.type === 'handshake') {
                    getAuthToken().then(token => {
                        if (token && ws?.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({ type: 'auth', accessToken: token }));
                        }
                    });
                }
            } catch (e: any) {
                logger.error(`[cloud-webhooks] Parse error: ${e?.message}`);
            }
        });

        ws.on('close', () => {
            logger.info(`[cloud-webhooks] Disconnected. Reconnecting in 5s...`);
            ws = null;
            if (isStarted) {
                reconnectTimer = setTimeout(connect, 5000);
            }
        });

        ws.on('error', (err: Error) => {
            logger.error(`[cloud-webhooks] WS Error: ${err.message}`);
            if (ws) {
                try { ws.close(); } catch { }
            }
        });

    } catch (err: any) {
        logger.error(`[cloud-webhooks] Connection setup error: ${err.message}`);
        if (isStarted) {
            reconnectTimer = setTimeout(connect, 5000);
        }
    }
}

// ── Voice Bridge via Supabase Realtime ──────────────────────────────────────
// When cloud-ai starts a voice call for this user, it inserts a row into
// `voice_bridge_requests`. We pick that up via Realtime, open a per-session
// WS to cloud-ai, and act as the local tool bridge for the duration of the call.

const VOICE_BRIDGE_TABLE = 'voice_bridge_requests';
let voiceBridgeChannel: any = null;
let voiceBridgeChannelUserId: string | null = null;
let voiceBridgeChannelStatus: 'idle' | 'connecting' | 'subscribed' | 'closed' | 'error' | 'timed_out' = 'idle';
let voiceBridgeAuthUnsub: (() => void) | null = null;
const activeVoiceBridges = new Map<string, WebSocket>();

function mapVoiceBridgeChannelStatus(status: string): typeof voiceBridgeChannelStatus {
    switch (status) {
        case 'SUBSCRIBED':
            return 'subscribed';
        case 'CHANNEL_ERROR':
            return 'error';
        case 'TIMED_OUT':
            return 'timed_out';
        case 'CLOSED':
            return 'closed';
        default:
            return 'connecting';
    }
}

function getCloudAiWsUrl(): string {
    const http = getCloudAiHttpBase().replace(/\/+$/, '');
    const wsProto = http.startsWith('https://') ? 'wss://' : 'ws://';
    const host = http.replace(/^https?:\/\//, '');
    return `${wsProto}${host}/ws`;
}

export function openVoiceBridge(sessionId: string): void {
    if (activeVoiceBridges.has(sessionId)) return;

    const token = getMainAccessToken();
    if (!token) {
        logger.warn(`[voice-bridge] No auth token, cannot open bridge for ${sessionId}`);
        return;
    }

    const wsUrl = `${getCloudAiWsUrl()}?client=desktop&voice_session=${encodeURIComponent(sessionId)}`;
    logger.info(`[voice-bridge] Opening bridge WS for session ${sessionId}`);

    let bridgeWs: WebSocket;
    try {
        bridgeWs = new WebSocket(wsUrl);
    } catch (e: any) {
        logger.error(`[voice-bridge] WS creation failed: ${e?.message}`);
        return;
    }

    activeVoiceBridges.set(sessionId, bridgeWs);

    bridgeWs.on('open', () => {
        logger.info(`[voice-bridge] Connected for session ${sessionId}, authenticating...`);
        try {
            bridgeWs.send(JSON.stringify({ type: 'auth', accessToken: token }));
        } catch { }
    });

    bridgeWs.on('message', (data: WebSocket.RawData) => {
        try {
            const msg = JSON.parse(data.toString('utf8'));
            if (msg.type === 'auth_result') {
                logger.info(`[voice-bridge] Auth ${msg.ok ? 'ok' : 'failed'} for session ${sessionId}`);
                return;
            }
            if (msg.type === 'tool_request') {
                handleToolRequest(msg, bridgeWs);
                return;
            }
            if (msg.type === 'handshake') {
                return;
            }
        } catch (e: any) {
            logger.error(`[voice-bridge] Message parse error: ${e?.message}`);
        }
    });

    bridgeWs.on('close', () => {
        logger.info(`[voice-bridge] Bridge WS closed for session ${sessionId}`);
        activeVoiceBridges.delete(sessionId);
    });

    bridgeWs.on('error', (err: Error) => {
        logger.error(`[voice-bridge] Bridge WS error for ${sessionId}: ${err.message}`);
        activeVoiceBridges.delete(sessionId);
        try { bridgeWs.close(); } catch { }
    });
}

function handleVoiceBridgeRealtime(payload: any): void {
    const row = payload?.new;
    if (!row || row.status !== 'pending') return;

    const sessionId = String(row.session_id || '');
    if (!sessionId) return;

    logger.info(`[voice-bridge] Realtime INSERT: session_id=${sessionId} channel=${row.channel}`);
    openVoiceBridge(sessionId);
}

async function startVoiceBridgeListener(): Promise<void> {
    const client = getMainSupabaseClient();
    const session = getMainAuthSession();
    const userId = session?.user?.id;
    if (!client || !userId) return;

    if (
        voiceBridgeChannel
        && voiceBridgeChannelUserId === userId
        && (voiceBridgeChannelStatus === 'connecting' || voiceBridgeChannelStatus === 'subscribed')
    ) {
        return;
    }

    if (voiceBridgeChannel) {
        try { await client.removeChannel(voiceBridgeChannel); } catch { }
        voiceBridgeChannel = null;
        voiceBridgeChannelUserId = null;
        voiceBridgeChannelStatus = 'idle';
    }

    try { client.realtime.setAuth(session.access_token); } catch { }

    const ch = client
        .channel(`voice-bridge:${userId}`)
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: VOICE_BRIDGE_TABLE,
            filter: `user_id=eq.${userId}`,
        }, handleVoiceBridgeRealtime);

    voiceBridgeChannel = ch;
    voiceBridgeChannelUserId = userId;
    voiceBridgeChannelStatus = 'connecting';

    ch.subscribe((status: string) => {
        if (ch !== voiceBridgeChannel) return;
        voiceBridgeChannelStatus = mapVoiceBridgeChannelStatus(status);
        if (status === 'SUBSCRIBED') {
            logger.info(`[voice-bridge] Realtime subscribed for ${userId}`);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            logger.warn(`[voice-bridge] Realtime channel ${status}, will retry on next auth change`);
        }
    });
}

function stopVoiceBridgeListener(): void {
    if (voiceBridgeAuthUnsub) {
        try { voiceBridgeAuthUnsub(); } catch { }
        voiceBridgeAuthUnsub = null;
    }
    const client = getMainSupabaseClient();
    if (client && voiceBridgeChannel) {
        try { client.removeChannel(voiceBridgeChannel); } catch { }
    }
    voiceBridgeChannel = null;
    voiceBridgeChannelUserId = null;
    voiceBridgeChannelStatus = 'idle';
    for (const [, bridgeWs] of activeVoiceBridges) {
        try { bridgeWs.close(); } catch { }
    }
    activeVoiceBridges.clear();
}

export function startVoiceBridgeService(): void {
    voiceBridgeAuthUnsub = onMainAuthSessionChange(() => {
        void startVoiceBridgeListener();
    });
    void startVoiceBridgeListener();
}

export function stopVoiceBridgeService(): void {
    stopVoiceBridgeListener();
}
