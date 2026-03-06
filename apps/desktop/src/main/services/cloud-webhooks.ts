import WebSocket from 'ws';
import { net } from 'electron';
import { handleCloudWebhookEvent } from '../workflows';
import logger from '../utils/logger';

let ws: WebSocket | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let isStarted = false;

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
}

export function stopCloudWebhooks() {
    isStarted = false;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (ws) {
        try { ws.removeAllListeners(); } catch { }
        try { ws.close(); } catch { }
        ws = null;
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
                } else if (msg.type === 'handshake') {
                    // Check for token and auth if we haven't already
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
