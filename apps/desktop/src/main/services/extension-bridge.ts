/**
 * Browser Extension Bridge (desktop side)
 *
 * Hosts a loopback WebSocket server that the Stuard Browser Connector (MV3
 * extension) connects to. The desktop's browser_ext_* tool handlers call
 * `sendExtensionCommand()` to drive the user's REAL browser (read the page they're
 * looking at, run scripts, organize tabs) — distinct from browser_use_*, which
 * drives a separate sandboxed Chrome.
 *
 *   extension SW ──(ws 127.0.0.1)──► this server ──► browser_ext_* handlers
 *
 * Security:
 *  - Bound to 127.0.0.1 only.
 *  - The WebSocket upgrade is rejected unless Origin is `chrome-extension://…`
 *    (a malicious web page's WS handshake carries an http(s) origin → blocked).
 *  - A pairing token (persisted in userData, shown in Settings) must match before
 *    any command is accepted, so a *different* extension can't hijack the bridge.
 *
 * Reliability: app-level ping/pong keeps the extension's MV3 service worker warm
 * (inbound JSON wakes its onmessage handler, resetting the 30s idle timer).
 */

import { WebSocketServer, WebSocket, type RawData } from 'ws';
import type { IncomingMessage } from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { app, BrowserWindow } from 'electron';
import logger from '../utils/logger';

// Keep in sync with apps/browser-extension/src/shared/protocol.ts
const BRIDGE_PORTS = [18791, 18792, 18793, 18794, 18795];
const PROTOCOL_VERSION = 1;
const PING_INTERVAL_MS = 20_000;
const PONG_GRACE_MS = 30_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;

type PendingCommand = {
  resolve: (value: any) => void;
  timer: NodeJS.Timeout;
};

type ExtConnection = {
  ws: WebSocket;
  extId: string;
  version: string;
  browser: string;
  paired: boolean;
  lastPong: number;
};

let server: WebSocketServer | undefined;
let activePort = 0;
let pairingToken = '';
let active: ExtConnection | null = null;
const pending = new Map<string, PendingCommand>();

export interface ExtensionBridgeInfo {
  running: boolean;
  port: number;
  connected: boolean;
  paired: boolean;
  extId: string | null;
  browser: string | null;
  version: string | null;
  pairingToken: string;
}

// ── Token persistence (mirrors mcp-local-server) ─────────────────────────────

function tokenPath(): string {
  return path.join(app.getPath('userData'), 'extension-bridge.json');
}

function ensurePairingToken(): string {
  if (pairingToken) return pairingToken;
  try {
    const parsed = JSON.parse(fs.readFileSync(tokenPath(), 'utf-8'));
    if (parsed?.token && typeof parsed.token === 'string') {
      pairingToken = parsed.token;
      return pairingToken;
    }
  } catch { /* not created yet */ }
  pairingToken = `stuext_${crypto.randomBytes(20).toString('hex')}`;
  try {
    fs.writeFileSync(tokenPath(), JSON.stringify({ token: pairingToken }, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    });
  } catch (e: any) {
    logger.warn?.(`[ext-bridge] could not persist pairing token: ${e?.message || e}`);
  }
  return pairingToken;
}

// ── Connection lifecycle ─────────────────────────────────────────────────────

function broadcastState() {
  const info = getExtensionBridgeInfo();
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('extension-bridge:state', info);
    }
  } catch { /* noop */ }
}

function sendTo(ws: WebSocket, obj: unknown) {
  if (ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify(obj)); } catch { /* noop */ }
  }
}

function handleHello(ws: WebSocket, msg: any, ipAllowed: boolean) {
  const token = String(msg?.token || '');
  const paired = ipAllowed && !!token && token === ensurePairingToken();

  // Replace any previous connection — only one browser is bridged at a time.
  if (active && active.ws !== ws) {
    try { active.ws.close(); } catch { /* noop */ }
  }
  active = {
    ws,
    extId: String(msg?.extId || ''),
    version: String(msg?.version || ''),
    browser: String(msg?.browser || ''),
    paired,
    lastPong: Date.now(),
  };

  sendTo(ws, {
    type: 'welcome',
    paired,
    needPairing: !paired,
    serverVersion: app.getVersion?.() || '',
  });

  if (paired) logger.info?.(`[ext-bridge] paired with ${active.browser} extension ${active.extId.slice(0, 8)}`);
  else logger.info?.('[ext-bridge] extension connected but not paired (awaiting pairing key)');
  broadcastState();
}

function handleResult(msg: any) {
  const id = String(msg?.id || '');
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  clearTimeout(p.timer);
  p.resolve({ ok: msg?.ok !== false, result: msg?.result, error: msg?.error });
}

function onConnection(ws: WebSocket, req: IncomingMessage) {
  // Defense in depth: only loopback peers (the server already binds 127.0.0.1).
  const remote = req.socket.remoteAddress || '';
  const ipAllowed = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  if (!ipAllowed) {
    try { ws.close(); } catch { /* noop */ }
    return;
  }

  ws.on('message', (data: RawData) => {
    let msg: any;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    switch (msg?.type) {
      case 'hello':
        if (msg.protocol !== PROTOCOL_VERSION) {
          sendTo(ws, { type: 'welcome', paired: false, needPairing: true });
          return;
        }
        handleHello(ws, msg, ipAllowed);
        return;
      case 'pong':
        if (active && active.ws === ws) active.lastPong = Date.now();
        return;
      case 'result':
        handleResult(msg);
        return;
    }
  });

  ws.on('close', () => {
    if (active && active.ws === ws) {
      active = null;
      broadcastState();
    }
  });
  ws.on('error', () => { /* close handler runs next */ });
}

let heartbeat: NodeJS.Timeout | undefined;
function startHeartbeat() {
  stopHeartbeat();
  heartbeat = setInterval(() => {
    if (!active) return;
    if (Date.now() - active.lastPong > PONG_GRACE_MS) {
      try { active.ws.terminate(); } catch { /* noop */ }
      active = null;
      broadcastState();
      return;
    }
    sendTo(active.ws, { type: 'ping', ts: Date.now() });
  }, PING_INTERVAL_MS);
}
function stopHeartbeat() {
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = undefined;
}

function listenOn(ports: number[]): void {
  if (!ports.length) {
    logger.error?.('[ext-bridge] no free port in range — extension bridge disabled');
    return;
  }
  const [port, ...rest] = ports;
  const wss = new WebSocketServer({
    host: '127.0.0.1',
    port,
    // Reject any handshake whose Origin is not a browser extension.
    verifyClient: (info: { origin?: string; req: IncomingMessage }) => {
      const origin = info.origin || (info.req.headers.origin as string) || '';
      return origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://');
    },
  });

  wss.on('listening', () => {
    server = wss;
    activePort = port;
    ensurePairingToken();
    startHeartbeat();
    logger.info?.(`[ext-bridge] listening on ws://127.0.0.1:${activePort}/stuard-extension`);
    broadcastState();
  });

  wss.on('connection', onConnection);

  wss.on('error', (err: any) => {
    if (err?.code === 'EADDRINUSE') {
      logger.warn?.(`[ext-bridge] port ${port} in use, trying next`);
      try { wss.close(); } catch { /* noop */ }
      listenOn(rest);
      return;
    }
    logger.error?.(`[ext-bridge] server error: ${err?.message || err}`);
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

export function startExtensionBridge(): void {
  if (server) return;
  try {
    ensurePairingToken();
    listenOn([...BRIDGE_PORTS]);
  } catch (err: any) {
    logger.error?.(`[ext-bridge] failed to start: ${err?.message || err}`);
  }
}

export function stopExtensionBridge(): void {
  stopHeartbeat();
  for (const [, p] of pending) {
    clearTimeout(p.timer);
    p.resolve({ ok: false, error: 'extension_bridge_stopped' });
  }
  pending.clear();
  try { active?.ws.close(); } catch { /* noop */ }
  active = null;
  try { server?.close(); } catch { /* noop */ }
  server = undefined;
  activePort = 0;
}

/** True when a paired extension is connected and ready to take commands. */
export function isExtensionConnected(): boolean {
  return !!active && active.paired && active.ws.readyState === WebSocket.OPEN;
}

export function getExtensionBridgeInfo(): ExtensionBridgeInfo {
  return {
    running: !!server,
    port: activePort,
    connected: !!active && active.ws.readyState === WebSocket.OPEN,
    paired: !!active?.paired,
    extId: active?.extId || null,
    browser: active?.browser || null,
    version: active?.version || null,
    pairingToken: server ? ensurePairingToken() : '',
  };
}

/** Unpacked extension folder for "Load unpacked" in chrome://extensions. */
export function getExtensionDistPath(): string {
  const candidates = [
    path.join(app.getAppPath(), '..', 'browser-extension', 'dist'),
    path.join(app.getAppPath(), '..', '..', 'browser-extension', 'dist'),
    path.join(process.cwd(), 'apps', 'browser-extension', 'dist'),
  ];
  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, 'manifest.json'))) return dir;
    } catch { /* try next */ }
  }
  return candidates[0];
}

/**
 * Send a command to the connected extension and await its result.
 * Returns `{ ok, result?, error? }`. Never throws.
 */
export function sendExtensionCommand(
  action: string,
  payload: Record<string, any> = {},
  timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
): Promise<{ ok: boolean; result?: any; error?: string }> {
  if (!isExtensionConnected() || !active) {
    return Promise.resolve({
      ok: false,
      error: 'extension_not_connected: open your browser with the Stuard Browser Connector installed and paired.',
    });
  }

  const id = crypto.randomBytes(12).toString('hex');
  const conn = active;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ ok: false, error: `extension_timeout after ${timeoutMs}ms` });
    }, timeoutMs);
    pending.set(id, { resolve, timer });
    sendTo(conn.ws, { type: 'command', id, action, payload, timeoutMs });
  });
}
