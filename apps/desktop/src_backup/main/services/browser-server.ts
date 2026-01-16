import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger';

let wss: WebSocketServer | null = null;
const connectedClients = new Set<WebSocket>();
const pendingRequests = new Map<string, { resolve: (val: any) => void, reject: (err: any) => void, timeout: NodeJS.Timeout }>();

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
                    }
                } catch (e) {
                    logger.error('[BrowserServer] Failed to handle message:', e);
                }
            });

            ws.on('close', () => {
                logger.info('[BrowserServer] Client disconnected');
                connectedClients.delete(ws);
            });

            ws.on('error', (e) => {
                logger.error('[BrowserServer] Socket error:', e);
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

/**
 * Send a request to the browser extension and wait for a response
 */
export async function sendRequestToBrowser(action: string, payload: any = {}, timeoutMs: number = 30000): Promise<any> {
    if (connectedClients.size === 0) {
        throw new Error('Browser extension not connected');
    }

    const requestId = uuidv4();
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
