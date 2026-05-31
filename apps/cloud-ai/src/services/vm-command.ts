/**
 * VM Command Relay
 *
 * Sends commands to VM agents via HTTP (on-demand, no persistent connection).
 * Cloud-ai looks up the VM's external IP from the DB and sends HTTP POSTs.
 *
 * Security: Each VM has its own unique HMAC secret (`vm_secret` in cloud_engines).
 * Tokens are minted per-request using that per-VM secret, so compromising one
 * VM cannot forge tokens for any other VM.
 */

import { getCloudEngine } from '../supabase';
import { getComputeProvider } from './compute';
import { mintVMToken } from './vm-tokens';

const DEFAULT_TIMEOUT_MS = 30_000;
export const VM_AGENT_PORT = 7400;
export const VM_COMMANDABLE_STATUSES = new Set(['running', 'provisioning', 'starting']);

/** Fallback secret used only in dev mode when no DB record exists. */
const DEV_FALLBACK_SECRET = 'dev-vm-token-secret';

export interface CommandResult {
  ok: boolean;
  result?: any;
  error?: string;
}

// ── Dev mode: use ngrok or local tunnel URL instead of real VM IP ───────────
// Set DEV_VM_URL=http://localhost:7400 or DEV_VM_URL=https://abc123.ngrok-free.app
// to route all VM traffic through a local/ngrok tunnel during development.
const DEV_VM_URL = process.env.DEV_VM_URL?.trim() || '';

// ── IP cache (avoids hitting GCP API on every command) ─────────────────────
const ipCache = new Map<string, { ip: string; ts: number }>();
const IP_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

// ── Per-VM secret cache (avoids hitting Supabase on every command) ──────────
const secretCache = new Map<string, { secret: string; ts: number }>();
const SECRET_CACHE_TTL_MS = 10 * 60 * 1000; // 10 min

// ── VM agent reachability cache ─────────────────────────────────────────────
// During VM startup the instance is "running"/"starting" but the agent's HTTP
// server on :7400 isn't answering yet. Without a gate, every relay/command
// fetch hangs until its (multi-second) timeout and returns a slow 504 — and
// because each holds an HTTP connection to cloud-ai open the whole time, a
// burst of startup polls (status/permissions/bots/conversations) saturates the
// client's per-host connection pool and starves the chat SSE ("no response,
// then works later"). A short cached health probe lets callers fast-fail.
//
// Positive results are trusted briefly (steady-state calls skip the probe);
// negative results are cached even more briefly so a boot-time pile-up backs
// off instead of each request re-probing a dead port.
const healthCache = new Map<string, { ok: boolean; ts: number }>();
const HEALTH_OK_TTL_MS = 10_000;  // trust a healthy agent for 10s
const HEALTH_FAIL_TTL_MS = 3_000; // back off doomed probes for 3s
const HEALTH_PROBE_TIMEOUT_MS = 2_500;

/**
 * Returns true when the user's VM agent is answering on :7400, using a short
 * cache so we neither re-probe on every call nor stampede a booting VM. Lets
 * relay/command callers return a fast `vm_starting` instead of a slow timeout.
 */
export async function isVMAgentReachableCached(userId: string): Promise<boolean> {
  if (DEV_VM_URL) return true; // dev tunnel is assumed up

  const now = Date.now();
  const cached = healthCache.get(userId);
  if (cached) {
    const ttl = cached.ok ? HEALTH_OK_TTL_MS : HEALTH_FAIL_TTL_MS;
    if (now - cached.ts < ttl) return cached.ok;
  }

  const ip = await resolveVMAddress(userId);
  if (!ip) {
    healthCache.set(userId, { ok: false, ts: now });
    return false;
  }
  const ping = await pingVMAgent(ip, HEALTH_PROBE_TIMEOUT_MS);
  healthCache.set(userId, { ok: ping.ok, ts: now });
  return ping.ok;
}

/**
 * Resolve the base URL for a user's VM agent.
 *
 * In dev mode (DEV_VM_URL set), always returns the dev URL — no GCE lookup.
 * In production, resolves external IP from DB/GCE and returns http://<ip>:7400.
 */
export async function resolveVMBaseUrl(userId: string): Promise<string | null> {
  // Dev tunnel shortcut
  if (DEV_VM_URL) return DEV_VM_URL.replace(/\/$/, '');

  const ip = await resolveVMAddress(userId);
  return ip ? `http://${ip}:${VM_AGENT_PORT}` : null;
}

export async function resolveVMAddress(userId: string): Promise<string | null> {
  // Dev mode: extract host from DEV_VM_URL
  if (DEV_VM_URL) {
    try {
      const u = new URL(DEV_VM_URL);
      return u.hostname;
    } catch { return null; }
  }

  // Check cache
  const cached = ipCache.get(userId);
  if (cached && Date.now() - cached.ts < IP_CACHE_TTL_MS) return cached.ip;

  // Look up engine record
  const engine = await getCloudEngine(userId);
  if (!engine || !VM_COMMANDABLE_STATUSES.has(String(engine.status || ''))) return null;

  // Use stored external_ip first
  let ip = engine.external_ip || null;

  // Fallback: fetch fresh IP from GCE
  if (!ip && engine.instance_name && engine.zone) {
    try {
      const provider = getComputeProvider();
      ip = await provider.getVMExternalIP(engine.instance_name, engine.zone);
    } catch { /* non-fatal */ }
  }

  if (ip) {
    ipCache.set(userId, { ip, ts: Date.now() });
  }

  return ip;
}

/**
 * Resolve the per-VM HMAC secret for a user's engine.
 * Cached for 10 min to avoid DB round-trips on every command.
 */
export async function resolveVMSecret(userId: string): Promise<string> {
  if (DEV_VM_URL) return DEV_FALLBACK_SECRET;

  const cached = secretCache.get(userId);
  if (cached && Date.now() - cached.ts < SECRET_CACHE_TTL_MS) return cached.secret;

  const engine = await getCloudEngine(userId);
  const secret = engine?.vm_secret || DEV_FALLBACK_SECRET;
  secretCache.set(userId, { secret, ts: Date.now() });
  return secret;
}

/** Invalidate cached IP (e.g. on VM stop/start). */
export function invalidateVMIPCache(userId: string): void {
  ipCache.delete(userId);
  secretCache.delete(userId);
  healthCache.delete(userId);
}

/**
 * Send a command to a user's VM agent via HTTP POST and await the response.
 */
export async function sendVMCommand(
  userId: string,
  command: string,
  args?: any,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<CommandResult> {
  const base = await resolveVMBaseUrl(userId);
  if (!base) {
    return { ok: false, error: 'vm_not_reachable' };
  }

  const url = `${base}/command`;
  const secret = await resolveVMSecret(userId);
  const token = mintVMToken(secret, userId, 'cloud-ai-command');

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ command, args: args || {} }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    const data = await resp.json() as any;
    return { ok: !!data.ok, result: data.result, error: data.error };
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      return { ok: false, error: 'command_timeout' };
    }
    return { ok: false, error: e?.message || 'http_request_failed' };
  }
}

/**
 * Send a terminal command to a VM agent (open/data/resize/close/read).
 */
export async function sendVMTerminalCommand(
  userId: string,
  action: 'open' | 'data' | 'resize' | 'close' | 'read',
  payload: any,
): Promise<CommandResult> {
  const base = await resolveVMBaseUrl(userId);
  if (!base) return { ok: false, error: 'vm_not_reachable' };

  const url = `${base}/terminal/${action}`;
  const secret = await resolveVMSecret(userId);
  const token = mintVMToken(secret, userId, 'cloud-ai-terminal');

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timer);

    const data = await resp.json() as any;
    return { ok: !!data.ok, result: data, error: data.error };
  } catch (e: any) {
    if (e?.name === 'AbortError') return { ok: false, error: 'terminal_timeout' };
    return { ok: false, error: e?.message || 'terminal_request_failed' };
  }
}

/**
 * Ping a VM agent's health endpoint directly.
 */
export async function pingVMAgent(ip: string, timeoutMs = 10_000): Promise<CommandResult> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const resp = await fetch(`http://${ip}:${VM_AGENT_PORT}/health`, {
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!resp.ok) return { ok: false, error: `http_${resp.status}` };
    const data = await resp.json() as any;
    return { ok: true, result: data };
  } catch (e: any) {
    if (e?.name === 'AbortError') return { ok: false, error: 'ping_timeout' };
    return { ok: false, error: e?.message || 'ping_failed' };
  }
}

/**
 * Fetch real-time metrics from a VM agent's /metrics endpoint.
 * Requires auth token (unlike /health).
 * 
 * @param ip       The VM's external IP address.
 * @param userId   The owner of this VM (used to look up per-VM secret).
 */
export async function fetchVMMetrics(ip: string, userId: string, timeoutMs = 10_000): Promise<CommandResult> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    // Mint a token using the per-VM secret — the VM agent verifies the HMAC
    const secret = await resolveVMSecret(userId);
    const token = mintVMToken(secret, userId, 'cloud-ai-monitor');

    const resp = await fetch(`http://${ip}:${VM_AGENT_PORT}/metrics`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!resp.ok) return { ok: false, error: `http_${resp.status}` };
    const data = await resp.json() as any;
    return { ok: true, result: data };
  } catch (e: any) {
    if (e?.name === 'AbortError') return { ok: false, error: 'metrics_timeout' };
    return { ok: false, error: e?.message || 'metrics_fetch_failed' };
  }
}

