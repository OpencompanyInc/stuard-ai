import { WebSocketServer, WebSocket } from 'ws';
import { BrowserWindow } from 'electron';
import { randomUUID } from 'crypto';
import logger from '../utils/logger';

let wss: WebSocketServer | null = null;
const connectedClients = new Set<WebSocket>();
const pendingRequests = new Map<string, { resolve: (val: any) => void, reject: (err: any) => void, timeout: NodeJS.Timeout }>();

// Listeners for status changes (dashboard polling)
type StatusListener = (status: { connected: boolean; clients: number }) => void;
const statusListeners = new Set<StatusListener>();
export function onBrowserStatusChange(fn: StatusListener) { statusListeners.add(fn); return () => statusListeners.delete(fn); }

function notifyStatusChange() {
    const status = getBrowserExtensionStatus();
    for (const fn of statusListeners) { try { fn(status); } catch {} }
    // Also notify all renderer windows
    for (const win of BrowserWindow.getAllWindows()) {
        try { win.webContents.send('browser-extension:status', status); } catch {}
    }
}

export function startBrowserExtensionServer(port: number = 18081) {
    if (wss) {
        logger.warn('[BrowserServer] Server already running');
        return;
    }

    try {
        wss = new WebSocketServer({ port, host: '127.0.0.1' });

        wss.on('listening', () => {
            logger.info(`[BrowserServer] Listening on 127.0.0.1:${port}`);
        });

        wss.on('connection', (ws) => {
            logger.info('[BrowserServer] New extension connection');
            connectedClients.add(ws);
            notifyStatusChange();

            ws.on('message', (message) => {
                try {
                    const str = message.toString();
                    const data = JSON.parse(str);

                    if (data.type === 'identify') {
                        logger.info(`[BrowserServer] Client identified as: ${data.client}`);
                    } else if (data.type === 'response' && data.requestId) {
                        const pending = pendingRequests.get(data.requestId);
                        if (pending) {
                            clearTimeout(pending.timeout);
                            pendingRequests.delete(data.requestId);
                            pending.resolve(data.payload);
                        }
                    } else if (data.type === 'chat_message' && data.text) {
                        // Forward chat message from extension to overlay
                        logger.info(`[BrowserServer] Chat from extension: ${data.text.substring(0, 80)}`);
                        for (const win of BrowserWindow.getAllWindows()) {
                            try {
                                win.webContents.send('browser-extension:chat', {
                                    text: data.text,
                                    messageId: data.messageId || randomUUID(),
                                    pageContext: data.pageContext,
                                });
                            } catch {}
                        }
                    }
                } catch (e) {
                    logger.error('[BrowserServer] Failed to handle message:', e);
                }
            });

            ws.on('close', () => {
                logger.info('[BrowserServer] Client disconnected');
                connectedClients.delete(ws);
                notifyStatusChange();
            });

            ws.on('error', (e) => {
                logger.error('[BrowserServer] Socket error:', e);
                connectedClients.delete(ws);
            });

            ws.send(JSON.stringify({ type: 'status', message: 'Connected to Stuard Desktop' }));
        });

        wss.on('error', (e) => {
            logger.error('[BrowserServer] Server error:', e);
        });

    } catch (e) {
        logger.error('[BrowserServer] Failed to start server:', e);
    }
}

export function stopBrowserExtensionServer() {
    if (wss) {
        wss.close();
        wss = null;
        logger.info('[BrowserServer] Server stopped');
    }
}

export function getBrowserExtensionStatus() {
    const clients = connectedClients.size;
    return {
        ok: true,
        connected: clients > 0,
        clients,
    };
}

/**
 * Send a request to the browser extension and wait for a response
 */
export async function sendRequestToBrowser(action: string, payload: any = {}, timeoutMs: number = 30000): Promise<any> {
    if (connectedClients.size === 0) {
        throw new Error('Browser extension not connected');
    }

    const requestId = randomUUID();
    const ws = Array.from(connectedClients)[0]; // Just use first for now

    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            pendingRequests.delete(requestId);
            reject(new Error(`Browser request timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        pendingRequests.set(requestId, { resolve, reject, timeout });

        ws.send(JSON.stringify({
            requestId,
            target: 'content',
            action,
            payload
        }));
    });
}

export function broadcastToBrowser(message: any) {
    for (const client of connectedClients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    }
}
