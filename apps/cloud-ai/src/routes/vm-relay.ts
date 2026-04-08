/**
 * VM Relay Route — On-Demand HTTP Proxy
 *
 * Allows the desktop app (or any authenticated client) to send arbitrary
 * requests to a user's VM agent through cloud-ai.
 *
 * Flow:  Desktop → cloud-ai (auth + relay) → VM agent → response → Desktop
 *
 * Routes:
 *   POST /v1/vm/relay   – Forward a request to the VM
 *   GET  /v1/vm/status   – Quick VM agent health check
 *
 * Body for relay:
 *   { path: "/command", method?: "POST", body?: any, timeoutMs?: number }
 *
 * This is the "on-demand HTTP" pattern — no persistent connection needed.
 * For terminal sessions, the desktop still uses WebSocket through the
 * existing socket manager (terminal_open/data/resize/close).
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { verifyToken } from '../supabase';
import { resolveVMBaseUrl, resolveVMSecret, pingVMAgent, resolveVMAddress, VM_AGENT_PORT } from '../services/vm-command';
import { mintVMToken } from '../services/vm-tokens';

// ── Security: allowed VM agent paths (strict allowlist) ─────────────────────
const ALLOWED_VM_PATHS: RegExp[] = [
  /^\/command$/,
  /^\/health$/,
  /^\/metrics$/,
  // Terminal
  /^\/terminal\/open$/,
  /^\/terminal\/data$/,
  /^\/terminal\/resize$/,
  /^\/terminal\/close$/,
  /^\/terminal\/read$/,
  // Sync
  /^\/sync\/upload$/,
  /^\/sync\/download$/,
  // Agent chat & execute
  /^\/agent\/chat$/,
  /^\/agent\/chat\/stream$/,
  /^\/agent\/execute$/,
  // Memory
  /^\/memory\/add$/,
  /^\/memory\/get$/,
  /^\/memory\/update$/,
  /^\/memory\/delete$/,
  /^\/memory\/list$/,
  /^\/memory\/search$/,
  /^\/memory\/topics$/,
  /^\/memory\/stats$/,
  /^\/memory\/export$/,
  /^\/memory\/import$/,
  /^\/memory\/preferences_get$/,
  /^\/memory\/preferences_set$/,
  /^\/memory\/conversations_list$/,
  /^\/memory\/conversations_add$/,
  // Proactive
  /^\/proactive\/status$/,
  /^\/proactive\/config$/,
  /^\/proactive\/wakeup$/,
  /^\/proactive\/tasks$/,
  /^\/proactive\/task_add$/,
  /^\/proactive\/task_update$/,
  /^\/proactive\/task_delete$/,
  // Legacy memory paths
  /^\/v1\/memory\/conversations(?:\?.*)?$/,
  /^\/v1\/memory\/conversations\/[^/?#]+(?:\?.*)?$/,
  /^\/v1\/memory\/conversations\/[^/?#]+\/messages(?:\?.*)?$/,
];

function isAllowedVmPath(vmPath: string): boolean {
  return ALLOWED_VM_PATHS.some((pattern) => pattern.test(vmPath));
}

// ── Security: allowed HTTP methods ──────────────────────────────────────────
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE']);

// ── Security: per-user rate limiting ────────────────────────────────────────
const RATE_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT = 120;        // max 120 relay requests per minute per user
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

// Cleanup stale rate buckets every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateBuckets) {
    if (now > v.resetAt) rateBuckets.delete(k);
  }
}, 5 * 60_000).unref();

// ── Security: CORS origin allowlist ─────────────────────────────────────────
const ALLOWED_ORIGINS = new Set([
  'http://localhost:5173',   // Vite dev
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://stuard.ai',
  'https://www.stuard.ai',
  'https://app.stuard.ai',
  'https://beta-api.stuard.ai',
]);

function getCorsOrigin(req: IncomingMessage): string {
  const origin = String(req.headers['origin'] || '');
  // Electron: no origin header → allow (same-origin)
  if (!origin) return '*';
  // Allow listed origins
  if (ALLOWED_ORIGINS.has(origin)) return origin;
  // Allow any *.stuard.ai subdomain
  try {
    const u = new URL(origin);
    if (u.hostname.endsWith('.stuard.ai') && u.protocol === 'https:') return origin;
  } catch {}
  return '';
}

const MAX_RELAY_BODY_BYTES = 5 * 1024 * 1024; // 5 MB max relay body

function json(res: ServerResponse, status: number, data: unknown, req?: IncomingMessage) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  if (req) {
    const origin = getCorsOrigin(req);
    if (origin) headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  } else {
    headers['Access-Control-Allow-Origin'] = '*';
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage, maxBytes = MAX_RELAY_BODY_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const timeout = setTimeout(() => {
      req.destroy();
      reject(new Error('body_read_timeout'));
    }, 30_000);
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) {
        clearTimeout(timeout);
        req.destroy();
        reject(new Error('body_too_large'));
        return;
      }
      chunks.push(Buffer.from(c));
    });
    req.on('end', () => {
      clearTimeout(timeout);
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (e) => {
      clearTimeout(timeout);
      reject(e);
    });
  });
}

function extractToken(req: IncomingMessage): string {
  const auth = String(req.headers['authorization'] || '');
  return auth.startsWith('Bearer ') ? auth.slice(7) : '';
}

async function authenticate(req: IncomingMessage, res: ServerResponse): Promise<{ userId: string } | null> {
  const token = extractToken(req);
  const user = token ? await verifyToken(token) : null;
  if (!user) {
    json(res, 401, { error: 'unauthorized' }, req);
    return null;
  }
  return user;
}

export async function handleVMRelayRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parsedUrl: URL,
): Promise<boolean> {
  const { pathname } = parsedUrl;

  // ── CORS preflight ────────────────────────────────────────────────────────
  if (req.method === 'OPTIONS' && (pathname === '/v1/vm/relay' || pathname === '/v1/vm/status')) {
    const origin = getCorsOrigin(req);
    if (!origin) { res.writeHead(403).end(); return true; }
    res.writeHead(204, {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '600',
      'Vary': 'Origin',
    });
    res.end();
    return true;
  }

  // ── POST /v1/vm/relay — forward request to VM ────────────────────────────
  if (pathname === '/v1/vm/relay' && req.method === 'POST') {
    const user = await authenticate(req, res);
    if (!user) return true;

    // Rate limit
    if (!checkRateLimit(user.userId)) {
      json(res, 429, { error: 'rate_limited', retryAfterMs: RATE_WINDOW_MS }, req);
      return true;
    }

    let body: any;
    try {
      body = JSON.parse(await readBody(req));
    } catch (e: any) {
      const errMsg = e?.message === 'body_too_large' ? 'body_too_large' : 'invalid_json';
      json(res, 400, { error: errMsg }, req);
      return true;
    }

    const vmPath = String(body.path || '').trim();
    if (!vmPath || !vmPath.startsWith('/')) {
      json(res, 400, { error: 'missing_or_invalid_path' }, req);
      return true;
    }

    // ── SECURITY: strict path allowlist (prevents SSRF to metadata/internal services) ──
    if (!isAllowedVmPath(vmPath)) {
      json(res, 403, { error: 'path_not_allowed' }, req);
      return true;
    }

    const method = String(body.method || 'POST').toUpperCase();
    // ── SECURITY: only safe HTTP methods ──
    if (!ALLOWED_METHODS.has(method)) {
      json(res, 400, { error: 'method_not_allowed' }, req);
      return true;
    }

    // Agent/chat paths need longer timeouts
    const isLongRunning = vmPath.startsWith('/agent/') || vmPath === '/proactive/wakeup';
    const defaultTimeout = isLongRunning ? 180_000 : 30_000;
    const maxTimeout = isLongRunning ? 300_000 : 120_000;
    const timeoutMs = Math.min(Number(body.timeoutMs) || defaultTimeout, maxTimeout);

    const base = await resolveVMBaseUrl(user.userId);
    if (!base) {
      json(res, 502, { error: 'vm_not_reachable' }, req);
      return true;
    }

    const url = `${base}${vmPath}`;
    const secret = await resolveVMSecret(user.userId);
    const token = mintVMToken(secret, user.userId, 'cloud-ai-relay');

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const fetchOpts: RequestInit = {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        signal: controller.signal,
      };

      // Attach body for non-GET requests  
      if (method !== 'GET' && method !== 'HEAD' && body.body !== undefined) {
        fetchOpts.body = typeof body.body === 'string' ? body.body : JSON.stringify(body.body);
      }

      const vmResp = await fetch(url, fetchOpts);
      clearTimeout(timer);

      // Try to parse JSON response, fallback to text
      const contentType = vmResp.headers.get('content-type') || '';
      let result: any;
      if (contentType.includes('application/json')) {
        result = await vmResp.json();
      } else {
        result = { text: await vmResp.text() };
      }

      json(res, vmResp.status, {
        ok: vmResp.ok,
        status: vmResp.status,
        result,
      }, req);
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        json(res, 504, { error: 'relay_timeout' }, req);
      } else {
        // Don't leak internal error details
        json(res, 502, { error: 'relay_failed' }, req);
      }
    }
    return true;
  }

  // ── GET /v1/vm/status — quick health check of user's VM agent ────────────
  if (pathname === '/v1/vm/status' && req.method === 'GET') {
    const user = await authenticate(req, res);
    if (!user) return true;

    const ip = await resolveVMAddress(user.userId);
    if (!ip) {
      json(res, 200, { reachable: false, error: 'no_ip' }, req);
      return true;
    }

    const ping = await pingVMAgent(ip);
    // ── SECURITY: don't expose raw VM IP to client ──
    json(res, 200, {
      reachable: ping.ok,
      agentVersion: ping.result?.version || null,
      uptime: ping.result?.uptime || null,
    }, req);
    return true;
  }

  return false;
}
