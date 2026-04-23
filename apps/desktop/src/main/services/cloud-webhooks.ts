import WebSocket from 'ws';
import { app, net, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { handleCloudWebhookEvent } from '../workflows';
import logger from '../utils/logger';
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

// ── Agent Data Sync (VM → Desktop) ─────────────────────────────────────────
// When the VM uploads new agent data to GCS, cloud-ai notifies us via WS.
// We download the archive and extract it so the local Python agent picks up changes.

let _agentDataSyncInFlight = false;

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
            await fetch(`${agentHttp}/tools/exec`, {
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
 */
async function handleAgentDataUpdated(): Promise<void> {
    if (_agentDataSyncInFlight) {
        logger.info('[cloud-webhooks] Agent data sync already in flight, skipping');
        return;
    }
    _agentDataSyncInFlight = true;

    try {
        const token = await getAuthToken();
        if (!token) {
            logger.warn('[cloud-webhooks] No auth token for agent data download');
            return;
        }

        const apiBase = getCloudAiHttpBase();

        // 1. Get signed download URL from cloud-ai
        const urlResp = await fetch(`${apiBase}/v1/cloud-engine/sync-agent-data`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
            signal: AbortSignal.timeout(15_000),
        });

        // sync-agent-data tells the VM to download — we need the raw URLs instead
        // Use the agent-data-urls via a desktop-specific download path
        const downloadUrlResp = await fetch(`${apiBase}/v1/storage/agent-data-url`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` },
            signal: AbortSignal.timeout(15_000),
        });

        if (!downloadUrlResp.ok) {
            // Fallback: try requesting the agent data download URL from the VM sync endpoint
            logger.warn('[cloud-webhooks] Could not get agent data URL, trying alternative');
            return;
        }

        const { downloadUrl } = await downloadUrlResp.json() as any;
        if (!downloadUrl) {
            logger.info('[cloud-webhooks] No agent data available in cloud storage');
            return;
        }

        // 2. Stream download to temp file
        const tmpDir = app.getPath('temp');
        const tmpFile = path.join(tmpDir, `agent-data-sync-${Date.now()}.tar.gz`);

        const dlResp = await fetch(downloadUrl, { signal: AbortSignal.timeout(10 * 60_000) });
        if (!dlResp.ok || !dlResp.body) {
            logger.error(`[cloud-webhooks] Agent data download failed: ${dlResp.status}`);
            return;
        }

        const { Readable } = await import('stream');
        const { pipeline } = await import('stream/promises');
        await pipeline(Readable.fromWeb(dlResp.body as any), fs.createWriteStream(tmpFile));

        const stats = fs.statSync(tmpFile);
        logger.info(`[cloud-webhooks] Downloaded agent data: ${stats.size} bytes`);

        // 3. Extract to desktop agent data directory
        const agentDir = getDesktopAgentDataDir();
        fs.mkdirSync(agentDir, { recursive: true });

        const tmpExtract = path.join(tmpDir, `agent-data-extract-${Date.now()}`);
        fs.mkdirSync(tmpExtract, { recursive: true });

        const { execFileSync } = await import('child_process');
        // Use tar on unix, or built-in extraction on Windows
        if (process.platform === 'win32') {
            execFileSync('tar', ['-xzf', tmpFile, '-C', tmpExtract], { timeout: 300_000 });
        } else {
            execFileSync('tar', ['-xzf', tmpFile, '-C', tmpExtract], { timeout: 300_000 });
        }

        // Handle new format (agent/ prefix) vs legacy (flat files)
        const extractedAgentDir = path.join(tmpExtract, 'agent');
        const sourceDir = fs.existsSync(extractedAgentDir) ? extractedAgentDir : tmpExtract;

        // Merge-safe copy: only overwrite local file if incoming is newer.
        // Prevents a race where a stale GCS snapshot clobbers newer local
        // writes made since the last upload.
        const mergeCopy = (src: string, dest: string): boolean => {
            try {
                const srcStat = fs.statSync(src);
                if (!srcStat.isFile()) return false;
                if (fs.existsSync(dest)) {
                    const destStat = fs.statSync(dest);
                    if (destStat.size > 0 && destStat.mtimeMs >= srcStat.mtimeMs) {
                        return false; // keep the local (newer / equal) copy
                    }
                }
                fs.copyFileSync(src, dest);
                try { fs.utimesSync(dest, srcStat.atime, srcStat.mtime); } catch { /* best-effort */ }
                return true;
            } catch {
                return false;
            }
        };

        // Copy only DB files (don't overwrite other agent data)
        const dbFiles = ['knowledge.db', 'memory.db', 'knowledge.db-wal', 'knowledge.db-shm', 'memory.db-wal', 'memory.db-shm'];
        let copied = 0;
        let skipped = 0;
        for (const f of fs.readdirSync(sourceDir)) {
            const srcPath = path.join(sourceDir, f);
            if (fs.statSync(srcPath).isFile() && (dbFiles.includes(f) || f.endsWith('.db'))) {
                if (mergeCopy(srcPath, path.join(agentDir, f))) copied++; else skipped++;
            }
        }

        // Install device keys from the archive when present (file-backed
        // fallback only — we never touch the OS keyring from here).
        const extractedKeysDir = path.join(tmpExtract, '.stuard_keys');
        if (fs.existsSync(extractedKeysDir)) {
            try {
                const keysDest = path.join(process.env.HOME || process.env.USERPROFILE || '', '.stuard', 'keys');
                fs.mkdirSync(keysDest, { recursive: true });
                for (const f of fs.readdirSync(extractedKeysDir)) {
                    const src = path.join(extractedKeysDir, f);
                    const dst = path.join(keysDest, f);
                    if (!fs.statSync(src).isFile()) continue;
                    if (!fs.existsSync(dst)) {
                        fs.copyFileSync(src, dst);
                    }
                }
                logger.info('[cloud-webhooks] Device keys installed from archive');
            } catch (e: any) {
                logger.warn(`[cloud-webhooks] Device-key install failed: ${e?.message}`);
            }
        }

        // Cleanup temp files
        try { fs.rmSync(tmpExtract, { recursive: true, force: true }); } catch { }
        try { fs.unlinkSync(tmpFile); } catch { }

        logger.info(`[cloud-webhooks] Agent data sync complete: ${copied} files updated, ${skipped} skipped (local newer) in ${agentDir}`);

        // 4. Notify renderer that agent data was updated
        try {
            for (const win of BrowserWindow.getAllWindows()) {
                try { win.webContents.send('agent:data-synced', { source: 'vm', files: copied }); } catch { }
            }
        } catch { }

    } catch (e: any) {
        logger.error(`[cloud-webhooks] Agent data sync failed: ${e?.message}`);
    } finally {
        _agentDataSyncInFlight = false;
    }
}

/**
 * Upload desktop's agent databases to GCS and notify VM to pull them.
 * Called after local knowledge/memory changes to keep VM in sync.
 */
export async function pushDesktopAgentDataToVM(): Promise<boolean> {
    try {
        const token = await getAuthToken();
        if (!token) return false;

        const apiBase = getCloudAiHttpBase();
        const agentDir = getDesktopAgentDataDir();

        if (!fs.existsSync(agentDir)) {
            logger.warn('[cloud-webhooks] Agent data dir does not exist');
            return false;
        }

        // 1. Create tar.gz of agent data.
        //    Stage into a temp dir so we can optionally include device keys
        //    (from ~/.stuard/keys) — the VM needs these to decrypt rows
        //    written on the desktop. We never copy from the OS keyring; only
        //    the file-backed fallback is propagated.
        const tmpDir = app.getPath('temp');
        const stageDir = path.join(tmpDir, `agent-data-stage-${Date.now()}`);
        fs.mkdirSync(stageDir, { recursive: true });
        const stageAgentDir = path.join(stageDir, 'agent');
        fs.mkdirSync(stageAgentDir, { recursive: true });

        // Mirror agent files into the stage (preserving mtime).
        // memory.db is special: the VM runs in plaintext mode and cannot
        // decrypt desktop-encrypted rows, so we substitute a decrypted
        // plaintext copy produced by the local Python agent.
        const MEMORY_DB_FILES = new Set(['memory.db', 'memory.db-wal', 'memory.db-shm']);
        for (const f of fs.readdirSync(agentDir)) {
            if (MEMORY_DB_FILES.has(f)) continue; // handled below
            const src = path.join(agentDir, f);
            try {
                const st = fs.statSync(src);
                if (st.isFile()) {
                    fs.copyFileSync(src, path.join(stageAgentDir, f));
                    try { fs.utimesSync(path.join(stageAgentDir, f), st.atime, st.mtime); } catch { /* best-effort */ }
                }
            } catch { /* skip unreadable */ }
        }

        // Ask the local Python agent to export memory.db with all encrypted
        // columns decrypted and tagged as plaintext. The VM reads these rows
        // directly without needing the desktop's device key.
        try {
            const exportPath = path.join(stageAgentDir, 'memory.db');
            const agentHttp = String(process.env.AGENT_HTTP || 'http://127.0.0.1:8765').replace(/\/+$/, '');
            const resp = await fetch(`${agentHttp}/tools/exec`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tool: 'memory_export_plaintext',
                    args: { output_path: exportPath },
                }),
                signal: AbortSignal.timeout(120_000),
            });
            const result: any = await resp.json().catch(() => ({ ok: false }));
            if (!result?.ok) {
                logger.warn(`[cloud-webhooks] memory_export_plaintext failed: ${result?.error || 'unknown'}`);
                // Fall back to copying the encrypted memory.db — VM still
                // can't read it, but at least we don't ship a broken archive.
                const src = path.join(agentDir, 'memory.db');
                if (fs.existsSync(src)) {
                    fs.copyFileSync(src, exportPath);
                }
            } else {
                logger.info(`[cloud-webhooks] memory.db exported plaintext: ${result.bytes || '?'} bytes, ${result.conversations || 0} convs, ${result.messages || 0} msgs`);
            }
            // Force a fresh mtime so the VM's merge-copy treats it as newer
            // than any legacy encrypted memory.db already on disk.
            try {
                const now = new Date();
                fs.utimesSync(exportPath, now, now);
            } catch { /* best-effort */ }
        } catch (e: any) {
            logger.warn(`[cloud-webhooks] memory.db plaintext export errored: ${e?.message}`);
        }

        const tmpFile = path.join(tmpDir, `agent-data-upload-${Date.now()}.tar.gz`);
        const { execFileSync } = await import('child_process');
        execFileSync('tar', ['-czf', tmpFile, '-C', stageDir, '.'], { timeout: 300_000 });
        const stats = fs.statSync(tmpFile);
        try { fs.rmSync(stageDir, { recursive: true, force: true }); } catch { /* best-effort */ }
        logger.info(`[cloud-webhooks] Agent data archive: ${stats.size} bytes`);

        // 2. Get signed upload URL from cloud-ai
        const urlResp = await fetch(`${apiBase}/v1/storage/agent-data-url`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` },
            signal: AbortSignal.timeout(15_000),
        });

        if (!urlResp.ok) {
            try { fs.unlinkSync(tmpFile); } catch { }
            return false;
        }
        const { uploadUrl } = await urlResp.json() as any;
        if (!uploadUrl) {
            try { fs.unlinkSync(tmpFile); } catch { }
            return false;
        }

        // 3. Stream upload to GCS
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

        try { fs.unlinkSync(tmpFile); } catch { }

        if (!uploadResp.ok) {
            logger.error(`[cloud-webhooks] Agent data upload failed: ${uploadResp.status}`);
            return false;
        }

        // 4. Notify cloud-ai to tell VM to download
        await fetch(`${apiBase}/v1/cloud-engine/push-agent-data`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
            signal: AbortSignal.timeout(15_000),
        });

        logger.info('[cloud-webhooks] Desktop agent data pushed to VM');
        return true;
    } catch (e: any) {
        logger.error(`[cloud-webhooks] Push agent data to VM failed: ${e?.message}`);
        return false;
    }
}

// ── Desktop Periodic Agent Data Sync (Desktop → GCS → VM) ──────────────────
// A tight mtime watcher pushes any local change within ~15s while a longer
// interval catches missed updates / WAL checkpoint drift. Pushes coalesce
// through the _agentDataSyncInFlight / hasDesktopAgentDataChanged guards so
// rapid successive writes don't fan out into duplicate uploads.
const DESKTOP_SYNC_INTERVAL_MS = 60_000; // slow-path safety net
const DESKTOP_FAST_SYNC_DEBOUNCE_MS = 15_000; // fast-path debounce after a change
const _desktopMtimes = new Map<string, number>();
let _desktopSyncTimer: NodeJS.Timeout | null = null;
let _desktopFastSyncTimer: NodeJS.Timeout | null = null;

function hasDesktopAgentDataChanged(): boolean {
    const agentDir = getDesktopAgentDataDir();
    if (!fs.existsSync(agentDir)) return false;
    const filesToWatch = ['knowledge.db', 'memory.db', 'file_index.db', 'knowledge.db-wal', 'memory.db-wal', 'file_index.db-wal'];
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
    const filesToWatch = ['knowledge.db', 'memory.db', 'file_index.db', 'knowledge.db-wal', 'memory.db-wal', 'file_index.db-wal'];
    for (const name of filesToWatch) {
        const filePath = path.join(agentDir, name);
        if (fs.existsSync(filePath)) {
            try { _desktopMtimes.set(name, fs.statSync(filePath).mtimeMs); } catch { }
        }
    }
}

async function periodicDesktopAgentDataSync(): Promise<void> {
    if (_agentDataSyncInFlight) return;
    if (!hasDesktopAgentDataChanged()) return;
    const ok = await pushDesktopAgentDataToVM();
    if (ok) snapshotDesktopMtimes();
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
            if (!hasDesktopAgentDataChanged()) return;
            const ok = await pushDesktopAgentDataToVM();
            if (ok) snapshotDesktopMtimes();
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
}

export function stopCloudWebhooks() {
    isStarted = false;
    stopDesktopAgentDataSync();
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

    const ctx: RouterContext = {
        agentWsUrl: 'ws://127.0.0.1:8765/ws',
        cloudAiUrl: getCloudAiHttpBase(),
        logFn: (m: string) => logger.info(`[cloud-webhooks][tool] ${m}`),
    };

    try {
        const result = await execTool(tool, args || {}, ctx);
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
                    logger.info(`[cloud-webhooks] Agent data updated from ${msg.source || 'vm'}`);
                    handleAgentDataUpdated().catch((e: any) => {
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

function openVoiceBridge(sessionId: string): void {
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
