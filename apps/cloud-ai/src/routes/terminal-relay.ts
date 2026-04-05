/**
 * Terminal WebSocket Relay
 *
 * When a desktop client connects to ws://<cloud-ai>/terminal?token=<jwt>,
 * cloud-ai authenticates, opens a terminal session on the VM agent via HTTP,
 * then polls /terminal/read for output and relays back over the WebSocket.
 *
 * This is only used for the duration of a terminal session — no persistent
 * connection is maintained outside of active use.
 *
 * Flow:
 *   Desktop ←WS→ cloud-ai ←HTTP→ VM agent (port 7400)
 */

import type { IncomingMessage } from 'http';
import { WebSocket } from 'ws';
import { verifyToken } from '../supabase';
import { sendVMTerminalCommand } from '../services/vm-command';
import { writeLog } from '../utils/logger';

const POLL_INTERVAL_MS = 100;    // poll VM for output every 100ms
const MAX_IDLE_MS = 10 * 60_000; // close after 10 min idle
const WS_PING_MS = 25_000;      // protocol-level ping to keep proxies/LBs alive

export async function handleTerminalConnection(ws: WebSocket, req: IncomingMessage) {
  // Authenticate from query param
  const url = new URL(req.url || '/', 'http://localhost');
  const token = url.searchParams.get('token') || '';

  const user = token ? await verifyToken(token) : null;
  if (!user || !user.userId) {
    ws.send(JSON.stringify({ type: 'error', error: 'unauthorized' }));
    ws.close(4001, 'unauthorized');
    return;
  }

  const userId = user.userId;
  let sessionId: string | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let lastActivity = Date.now();

  writeLog('terminal_relay_open', { userId });

  // Open terminal on VM
  try {
    const result = await sendVMTerminalCommand(userId, 'open', {
      rows: 24,
      cols: 80,
    });
    if (!result.ok) {
      ws.send(JSON.stringify({ type: 'error', error: result.error || 'terminal_open_failed' }));
      ws.close(4002, 'terminal_open_failed');
      return;
    }
    sessionId = result.result?.sessionId || result.result?.terminalId || result.result?.id || null;
    if (!sessionId) {
      ws.send(JSON.stringify({ type: 'error', error: 'terminal_session_missing' }));
      ws.close(4002, 'terminal_session_missing');
      return;
    }
    ws.send(JSON.stringify({ type: 'terminal_opened', sessionId }));
  } catch (e: any) {
    ws.send(JSON.stringify({ type: 'error', error: e?.message || 'terminal_open_exception' }));
    ws.close(4002, 'terminal_open_exception');
    return;
  }

  const pollOutput = async () => {
    if (ws.readyState !== WebSocket.OPEN || !sessionId) return;
    try {
      const result = await sendVMTerminalCommand(userId, 'read', { sessionId });
      if (result.ok && result.result?.data) {
        ws.send(JSON.stringify({ type: 'terminal_data', data: result.result.data }));
      }
    } catch {
      // Ignore transient poll errors. The next poll will retry.
    }
  };

  // WebSocket-level ping to keep intermediate proxies / load balancers alive
  const wsPingTimer = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.ping(); } catch {}
    }
  }, WS_PING_MS);

  // Pull any initial shell prompt/output immediately after opening the PTY.
  await pollOutput();

  // Poll VM for terminal output
  pollTimer = setInterval(async () => {
    if (ws.readyState !== WebSocket.OPEN) return;

    // Check idle timeout
    if (Date.now() - lastActivity > MAX_IDLE_MS) {
      ws.send(JSON.stringify({ type: 'terminal_idle_timeout' }));
      cleanup();
      ws.close(4003, 'idle_timeout');
      return;
    }
    await pollOutput();
  }, POLL_INTERVAL_MS);

  // Handle incoming messages from desktop
  ws.on('message', async (buf) => {
    lastActivity = Date.now();

    let msg: any;
    try {
      msg = JSON.parse(Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf));
    } catch { return; }

    const kind = String(msg?.type || '').toLowerCase();

    if (kind === 'terminal_ping') {
      try {
        ws.send(JSON.stringify({ type: 'terminal_pong', ts: Date.now() }));
      } catch {}
    } else if (kind === 'terminal_data' && msg.data) {
      // Forward keystrokes to VM
      await sendVMTerminalCommand(userId, 'data', {
        sessionId,
        data: msg.data,
      }).catch(() => {});
    } else if (kind === 'terminal_resize' && msg.rows && msg.cols) {
      await sendVMTerminalCommand(userId, 'resize', {
        sessionId,
        rows: msg.rows,
        cols: msg.cols,
      }).catch(() => {});
    } else if (kind === 'terminal_close') {
      cleanup();
      ws.close(1000, 'user_closed');
    }
  });

  function cleanup() {
    clearInterval(wsPingTimer);
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    // Close terminal on VM (fire-and-forget)
    if (sessionId) {
      sendVMTerminalCommand(userId, 'close', { sessionId }).catch(() => {});
    }
    writeLog('terminal_relay_close', { userId, sessionId });
  }

  ws.on('close', () => cleanup());
  ws.on('error', () => cleanup());
}
