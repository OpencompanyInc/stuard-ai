import WebSocket from 'ws';
import { app, net, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { handleCloudWebhookEvent } from '../workflows';
import logger from '../utils/logger';
import { getMainAccessToken } from './auth-session';
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

        // Copy only DB files (don't overwrite other agent data)
        const dbFiles = ['knowledge.db', 'memory.db', 'knowledge.db-wal', 'knowledge.db-shm', 'memory.db-wal', 'memory.db-shm'];
        let copied = 0;
        for (const f of fs.readdirSync(sourceDir)) {
            const srcPath = path.join(sourceDir, f);
            if (fs.statSync(srcPath).isFile() && (dbFiles.includes(f) || f.endsWith('.db'))) {
                fs.copyFileSync(srcPath, path.join(agentDir, f));
                copied++;
            }
        }

        // Cleanup temp files
        try { fs.rmSync(tmpExtract, { recursive: true, force: true }); } catch { }
        try { fs.unlinkSync(tmpFile); } catch { }

        logger.info(`[cloud-webhooks] Agent data sync complete: ${copied} files updated in ${agentDir}`);

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

        // 1. Create tar.gz of agent data
        const tmpDir = app.getPath('temp');
        const tmpFile = path.join(tmpDir, `agent-data-upload-${Date.now()}.tar.gz`);

        const { execFileSync } = await import('child_process');
        execFileSync('tar', ['-czf', tmpFile, '-C', agentDir, '.'], { timeout: 300_000 });
        const stats = fs.statSync(tmpFile);
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
// Every 5 minutes, check if local knowledge.db/memory.db changed and push to GCS.
const DESKTOP_SYNC_INTERVAL_MS = 5 * 60_000;
const _desktopMtimes = new Map<string, number>();
let _desktopSyncTimer: NodeJS.Timeout | null = null;

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
    logger.info(`[cloud-webhooks] Desktop agent data auto-sync: every ${DESKTOP_SYNC_INTERVAL_MS / 60_000} min`);
}

function stopDesktopAgentDataSync(): void {
    if (_desktopSyncTimer) {
        clearInterval(_desktopSyncTimer);
        _desktopSyncTimer = null;
    }
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
