/**
 * Desktop Tool Relay — VM → Cloud-AI → Desktop
 *
 * Allows deployed workflows running on Cloud VMs to execute tools
 * that only work on the user's desktop PC (screenshots, mouse, keyboard, etc.).
 *
 * Flow:
 *   VM engine (HTTP POST) → cloud-ai /v1/vm/exec-desktop-tool → desktop WS → result
 *
 * Security:
 *   - VM auth: per-VM HMAC token + X-VM-User-Id header (no user tokens on VM)
 *   - Also accepts standard Supabase JWT for desktop/web clients
 *   - Only allows tools in the DESKTOP_RELAY_ALLOWLIST
 *   - Per-user rate limiting (60 req/min)
 *   - Desktop must be online (returns 503 if offline)
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { verifyToken } from '../supabase';
import { verifyVMAuthFromRequest } from '../services/vm-tokens';
import { getDesktopWs } from '../services/vm-bridge';
import { randomUUID } from 'crypto';

// ── Security: only relay these tools to the desktop ──────────────────────────
const DESKTOP_RELAY_ALLOWLIST = new Set([
  // Screen & input automation
  'take_screenshot', 'capture_screen', 'capture_media',
  'click_at', 'double_click', 'right_click', 'drag_to',
  'send_hotkey', 'type_text', 'press_key',
  'scroll_up', 'scroll_down', 'scroll_to',
  'mouse_move', 'mouse_click',
  // Window management
  'smart_focus', 'focus_window', 'list_windows', 'close_window',
  'minimize_window', 'maximize_window', 'resize_window',
  // Desktop-specific
  'open_url', 'open_file', 'open_application',
  'get_clipboard', 'set_clipboard',
  'send_notification', 'show_notification', 'show_dialog',
  // OCR / vision on desktop
  'ocr_screen', 'find_element', 'wait_for_element',
  // Python agent tools that need desktop context
  'run_python_script',
]);

// ── Per-user rate limiting ───────────────────────────────────────────────────
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 60; // max 60 relay requests per minute per user
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(userId);
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(userId, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  bucket.count++;
  return bucket.count <= RATE_LIMIT;
}

// Cleanup stale buckets
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateBuckets) {
    if (now > v.resetAt) rateBuckets.delete(k);
  }
}, 5 * 60_000).unref();

// ── Pending relay requests (waiting for desktop to respond) ──────────────────
interface PendingRelay {
  resolve: (result: any) => void;
  timer: NodeJS.Timeout;
  tool: string;
}

// userId → Map<requestId, PendingRelay>
const pendingRelays = new Map<string, Map<string, PendingRelay>>();

function getPendingMap(userId: string): Map<string, PendingRelay> {
  let m = pendingRelays.get(userId);
  if (!m) { m = new Map(); pendingRelays.set(userId, m); }
  return m;
}

/**
 * Called by the WS handler when the desktop sends back a tool_result for a relay request.
 * Returns true if the message was handled (was a pending relay result).
 */
export function handleDesktopRelayResult(userId: string, msg: any): boolean {
  const id = String(msg?.id || '');
  if (!id) return false;

  const pending = getPendingMap(userId);
  const relay = pending.get(id);
  if (!relay) return false;

  clearTimeout(relay.timer);
  pending.delete(id);
  relay.resolve(msg.result ?? { ok: true });
  return true;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function json(res: ServerResponse, status: number, body: any): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage, maxBytes = 2 * 1024 * 1024): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) { reject(new Error('body_too_large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

// ── Route Handler ────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 90_000;

export async function handleDesktopToolRelayRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parsedUrl: URL,
): Promise<boolean> {
  const { pathname } = parsedUrl;

  if (pathname !== '/v1/vm/exec-desktop-tool') return false;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-VM-User-Id',
      'Access-Control-Max-Age': '600',
    });
    res.end();
    return true;
  }

  if (req.method !== 'POST') {
    json(res, 405, { ok: false, error: 'method_not_allowed' });
    return true;
  }

  // Authenticate — supports two auth methods:
  // 1. Supabase JWT (from desktop/web clients): Authorization: Bearer <supabase_jwt>
  // 2. VM HMAC auth (from VM engines): Authorization: Bearer <hmac_token> + X-VM-User-Id: <userId>
  //    The VM never has the user's Supabase JWT. It uses its own per-VM HMAC secret.
  //    Cloud-ai verifies the HMAC against the per-VM secret stored in the DB.
  const authHeader = String(req.headers['authorization'] || '');
  const vmUserIdHeader = req.headers['x-vm-user-id'] as string | undefined;

  let user: { userId: string } | null = null;

  if (vmUserIdHeader) {
    // VM HMAC auth path — verify against per-VM secret
    user = await verifyVMAuthFromRequest(authHeader, vmUserIdHeader);
  } else {
    // Standard Supabase JWT path
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    user = token ? await verifyToken(token) : null;
  }

  if (!user) {
    json(res, 401, { ok: false, error: 'unauthorized' });
    return true;
  }

  // Rate limit
  if (!checkRateLimit(user.userId)) {
    json(res, 429, { ok: false, error: 'rate_limited' });
    return true;
  }

  // Parse request
  let body: any;
  try {
    body = await readBody(req);
  } catch {
    json(res, 400, { ok: false, error: 'invalid_body' });
    return true;
  }

  const toolName = String(body.tool || '').trim();
  const toolArgs = body.args || {};
  const timeoutMs = Math.min(Number(body.timeoutMs) || DEFAULT_TIMEOUT_MS, 120_000);

  if (!toolName) {
    json(res, 400, { ok: false, error: 'missing_tool_name' });
    return true;
  }

  // Security: only allow whitelisted tools
  if (!DESKTOP_RELAY_ALLOWLIST.has(toolName)) {
    json(res, 403, { ok: false, error: `tool_not_allowed_for_relay: ${toolName}` });
    return true;
  }

  // Find the user's desktop WS connection
  const desktopWs = getDesktopWs(user.userId);
  if (!desktopWs) {
    json(res, 503, {
      ok: false,
      error: 'desktop_offline',
      message: `The Stuard desktop app must be running to use '${toolName}'. This tool requires direct access to your PC.`,
    });
    return true;
  }

  // Send tool_request to desktop and wait for result
  const requestId = `relay-${randomUUID()}`;

  try {
    const result = await new Promise<any>((resolve) => {
      const timer = setTimeout(() => {
        getPendingMap(user.userId).delete(requestId);
        resolve({ ok: false, error: `desktop_tool_timeout: '${toolName}' did not respond within ${timeoutMs}ms` });
      }, timeoutMs);

      getPendingMap(user.userId).set(requestId, { resolve, timer, tool: toolName });

      // Send tool_request to the desktop WS
      try {
        desktopWs.send(JSON.stringify({
          type: 'tool_request',
          id: requestId,
          tool: toolName,
          args: toolArgs,
          source: 'vm-relay',
        }));
      } catch (sendErr: any) {
        clearTimeout(timer);
        getPendingMap(user.userId).delete(requestId);
        resolve({ ok: false, error: `desktop_send_failed: ${sendErr?.message}` });
      }
    });

    json(res, 200, { ok: true, result });
  } catch (e: any) {
    json(res, 500, { ok: false, error: e?.message || 'relay_failed' });
  }

  return true;
}
