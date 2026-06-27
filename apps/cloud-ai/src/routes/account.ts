/**
 * Account Routes — Per-user secrets that any authenticated device can fetch.
 *
 * Currently exposes a single endpoint:
 *   GET /v1/account/sync-key
 *
 * Returns the user's deterministic 32-byte memory encryption key, derived via
 * HKDF-SHA256 from `STUARD_MASTER_KEY` and the authenticated user's id. Both
 * the desktop and the cloud VM call this and end up with the same key, so a
 * single AES-GCM encrypted memory.db is readable by either side without ever
 * touching plaintext on disk.
 *
 * Auth options (in priority order):
 *   1. Bearer Supabase JWT — used by desktop / website / browser clients.
 *   2. Bearer VM HMAC token — used by the user's cloud VM during boot, before
 *      it has a Supabase session of its own.
 *
 * The endpoint is stateless: same `user_id` always yields the same key, so
 * cloud-ai stores nothing. Rotation is a future-only `info` bump (`v1` → `v2`)
 * paired with a one-shot re-encrypt on the desktop.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { createHmac, hkdfSync } from 'crypto';
import { verifyToken, getCloudEngine } from '../supabase';
import { verifyVMToken } from '../services/vm-tokens';

const HKDF_INFO = 'stuard-memory-v1';
const KEY_BYTES = 32;

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(payload);
}

function loadMasterKey(): Buffer | null {
  const raw = String(process.env.STUARD_MASTER_KEY || '').trim();
  if (!raw) return null;

  // Accept either raw text (≥32 chars) or base64-encoded 32 bytes. Anything
  // shorter than 32 bytes is rejected so a misconfigured env doesn't silently
  // weaken every user's key.
  try {
    const decoded = Buffer.from(raw, 'base64');
    if (decoded.length >= KEY_BYTES) return decoded;
  } catch { /* not base64 */ }
  const utf = Buffer.from(raw, 'utf-8');
  if (utf.length >= KEY_BYTES) return utf;
  return null;
}

/**
 * Derive a user's memory key. Pure function: same inputs → same output.
 * `user_id` is used as HKDF salt so two users with similar internal state
 * still get cryptographically independent keys.
 */
function deriveUserKey(masterKey: Buffer, userId: string): Buffer {
  const ikm = masterKey;
  const salt = Buffer.from(userId, 'utf-8');
  const info = Buffer.from(HKDF_INFO, 'utf-8');
  return Buffer.from(hkdfSync('sha256', ikm, salt, info, KEY_BYTES));
}

async function authenticate(
  req: IncomingMessage,
): Promise<{ userId: string; via: 'jwt' | 'vm' } | null> {
  const auth = String(req.headers['authorization'] || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return null;

  // 1. Supabase JWT — desktop, website, browser.
  const user = await verifyToken(token);
  if (user?.userId) return { userId: user.userId, via: 'jwt' };

  // 2. VM HMAC token — only the user's own VM can mint this, since each VM
  //    has its own per-engine secret stored in cloud_engines.vm_secret. We
  //    extract the userId claim from the unverified payload, look up the
  //    engine for that user, then verify with that engine's secret.
  try {
    const [encodedPayload] = token.split('.');
    if (!encodedPayload) return null;
    const claimsJson = Buffer.from(encodedPayload, 'base64url').toString('utf-8');
    const claims = JSON.parse(claimsJson);
    const claimedUserId = String(claims?.userId || '').trim();
    if (!claimedUserId) return null;

    const engine = await getCloudEngine(claimedUserId);
    if (!engine?.vm_secret) return null;
    const verified = verifyVMToken(token, engine.vm_secret);
    if (verified?.userId !== claimedUserId) return null;

    return { userId: claimedUserId, via: 'vm' };
  } catch {
    return null;
  }
}

export async function handleAccountRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parsedUrl: URL,
): Promise<boolean> {
  const path = parsedUrl.pathname;
  const method = req.method || '';

  if (!path.startsWith('/v1/account/')) return false;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '600',
    });
    res.end();
    return true;
  }

  if (method === 'GET' && path === '/v1/account/sync-key') {
    const masterKey = loadMasterKey();
    if (!masterKey) {
      // Surface this loudly — without it, every device runs with no encryption
      // at all, which is exactly what we are trying to fix.
      console.error('[account] STUARD_MASTER_KEY is missing or shorter than 32 bytes');
      json(res, 500, { ok: false, error: 'server_misconfigured' });
      return true;
    }

    const auth = await authenticate(req);
    if (!auth) {
      json(res, 401, { ok: false, error: 'unauthorized' });
      return true;
    }

    const userKey = deriveUserKey(masterKey, auth.userId);
    json(res, 200, {
      ok: true,
      // The key is HKDF-derived, so callers can re-derive it themselves at any
      // time. We return it directly to keep both desktop and VM stateless.
      key: userKey.toString('base64'),
      info: HKDF_INFO,
      kdf: 'hkdf-sha256',
      length: KEY_BYTES,
    });

    // Best-effort scrub.
    userKey.fill(0);
    masterKey.fill(0);
    return true;
  }

  return false;
}
