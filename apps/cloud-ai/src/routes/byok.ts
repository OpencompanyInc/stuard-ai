/**
 * BYOK (Bring Your Own Key) HTTP routes.
 *
 *   GET    /v1/byok/providers                  — list user's keys (metadata)
 *   PUT    /v1/byok/providers/:provider        — create or replace a key
 *   PATCH  /v1/byok/providers/:provider        — toggle enabled
 *   DELETE /v1/byok/providers/:provider        — delete a key
 *   POST   /v1/byok/providers/:provider/test   — validate the key (rate-limited)
 *
 * Plaintext key material is accepted on PUT bodies, but never returned by
 * any endpoint. Responses always carry only ProviderKeyPublic
 * (last_four + flags).
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { authenticateHttpLegacy, sendAuthError } from '../auth/http';
import { AuthErrorCode } from '../auth';
import {
  listProviderKeys,
  upsertProviderKey,
  setProviderKeyEnabled,
  deleteProviderKey,
  resolveProviderKeyWithSecret,
  writeAuditLog,
  findDuplicateByFingerprint,
  upsertCodexSubscription,
} from '../byok/storage';
import { invalidateUserCache } from '../byok/keys';
import { isProvider, type Provider } from '../byok/types';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, PATCH, DELETE, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

function writeJson(res: ServerResponse, status: number, obj: any): void {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    ...CORS,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return null; }
}

function clientIp(req: IncomingMessage): string | null {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0]?.trim();
  return xff || req.socket?.remoteAddress || null;
}

// ─── Test-endpoint rate limiter ────────────────────────────────────────────
// 10 calls per user per 5 minutes. In-process only — fine for a single
// cloud-ai instance; if we ever scale horizontally swap for Redis.
const TEST_WINDOW_MS = 5 * 60_000;
const TEST_MAX_CALLS = 10;
const testCalls = new Map<string, number[]>();

function allowTest(userId: string): boolean {
  const now = Date.now();
  const arr = (testCalls.get(userId) || []).filter((t) => now - t < TEST_WINDOW_MS);
  if (arr.length >= TEST_MAX_CALLS) {
    testCalls.set(userId, arr);
    return false;
  }
  arr.push(now);
  testCalls.set(userId, arr);
  return true;
}

// ─── Provider validation calls ─────────────────────────────────────────────
// Cheap "is this key alive?" probe per provider. Each helper returns
// { ok, status, message } and never throws.

async function probeAnthropic(apiKey: string): Promise<{ ok: boolean; status: number; message?: string }> {
  try {
    const r = await fetch('https://api.anthropic.com/v1/models', {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    });
    return { ok: r.ok, status: r.status, message: r.ok ? undefined : await r.text().then((t) => t.slice(0, 200)).catch(() => undefined) };
  } catch (e: any) {
    return { ok: false, status: 0, message: e?.message || 'network_error' };
  }
}

async function probeOpenAI(apiKey: string, baseUrl: string = 'https://api.openai.com/v1'): Promise<{ ok: boolean; status: number; message?: string }> {
  try {
    const url = `${baseUrl.replace(/\/+$/, '')}/models`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    return { ok: r.ok, status: r.status, message: r.ok ? undefined : await r.text().then((t) => t.slice(0, 200)).catch(() => undefined) };
  } catch (e: any) {
    return { ok: false, status: 0, message: e?.message || 'network_error' };
  }
}

async function probeGoogle(apiKey: string): Promise<{ ok: boolean; status: number; message?: string }> {
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
    return { ok: r.ok, status: r.status, message: r.ok ? undefined : await r.text().then((t) => t.slice(0, 200)).catch(() => undefined) };
  } catch (e: any) {
    return { ok: false, status: 0, message: e?.message || 'network_error' };
  }
}

async function probeOpenRouter(apiKey: string): Promise<{ ok: boolean; status: number; message?: string }> {
  try {
    const r = await fetch('https://openrouter.ai/api/v1/auth/key', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    return { ok: r.ok, status: r.status, message: r.ok ? undefined : await r.text().then((t) => t.slice(0, 200)).catch(() => undefined) };
  } catch (e: any) {
    return { ok: false, status: 0, message: e?.message || 'network_error' };
  }
}

async function probeXai(apiKey: string): Promise<{ ok: boolean; status: number; message?: string }> {
  // xAI exposes an OpenAI-compatible /v1/models endpoint.
  return probeOpenAI(apiKey, 'https://api.x.ai/v1');
}

async function runProviderProbe(provider: Provider, apiKey: string, baseUrl: string | null): Promise<{ ok: boolean; status: number; message?: string }> {
  switch (provider) {
    case 'anthropic': return probeAnthropic(apiKey);
    case 'openai': return probeOpenAI(apiKey);
    case 'google': return probeGoogle(apiKey);
    case 'openrouter': return probeOpenRouter(apiKey);
    case 'xai': return probeXai(apiKey);
    case 'openai_compatible':
      if (!baseUrl) return { ok: false, status: 0, message: 'base_url_required' };
      return probeOpenAI(apiKey, baseUrl);
    case 'codex_subscription':
      // Don't probe the ChatGPT backend with a fake request — quotas are
      // tight and the endpoint is undocumented. Treat "we have a token"
      // as enough for the UI's "Test" affordance.
      return { ok: !!apiKey, status: apiKey ? 200 : 401, message: apiKey ? 'token_present' : 'no_token' };
    default:
      return { ok: false, status: 0, message: 'unsupported_provider' };
  }
}

// ─── Router ────────────────────────────────────────────────────────────────

export async function handleByokRoutes(req: IncomingMessage, res: ServerResponse, parsedUrl: URL): Promise<boolean> {
  const path = String(parsedUrl.pathname || '');
  if (!path.startsWith('/v1/byok/')) return false;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return true;
  }

  const auth = await authenticateHttpLegacy(req, parsedUrl);
  if (!auth.success || !auth.userId) {
    sendAuthError(res, auth.error || AuthErrorCode.UNAUTHORIZED, auth.message);
    return true;
  }
  const userId = auth.userId;

  // POST /v1/byok/codex/import — desktop pushes tokens it read from
  // ~/.codex/auth.json. We never run our own OAuth for Codex; the local
  // `codex` CLI (OpenAI's official binary) handles that. Body shape:
  //   { access_token, refresh_token?, expires_at?, account_email? }
  if (req.method === 'POST' && path === '/v1/byok/codex/import') {
    const body = await readJson(req);
    if (!body || typeof body !== 'object') { writeJson(res, 400, { ok: false, error: 'invalid_json' }); return true; }
    const accessToken = String(body.access_token || body.accessToken || '').trim();
    if (!accessToken) { writeJson(res, 400, { ok: false, error: 'access_token_required' }); return true; }
    if (accessToken.length > 16384) { writeJson(res, 400, { ok: false, error: 'access_token_too_long' }); return true; }
    const refreshToken = typeof (body.refresh_token || body.refreshToken) === 'string'
      ? String(body.refresh_token || body.refreshToken).trim() || null
      : null;
    const expiresAt = typeof (body.expires_at || body.expiresAt) === 'string'
      ? String(body.expires_at || body.expiresAt)
      : null;
    const accountEmail = typeof (body.account_email || body.accountEmail) === 'string'
      ? String(body.account_email || body.accountEmail).trim() || null
      : null;
    try {
      const saved = await upsertCodexSubscription(userId, {
        accessToken,
        refreshToken,
        expiresAt,
        accountEmail,
      });
      invalidateUserCache(userId, 'codex_subscription');
      await writeAuditLog({
        userId,
        provider: 'codex_subscription',
        keyId: saved.id,
        action: 'codex_import',
        ip: clientIp(req),
        userAgent: String(req.headers['user-agent'] || '').slice(0, 200) || null,
        detail: { account_email: accountEmail, has_refresh: !!refreshToken },
      });
      writeJson(res, 200, { ok: true, key: saved });
    } catch (e: any) {
      console.error('[byok] codex import error:', e?.message || e);
      writeJson(res, 500, { ok: false, error: 'import_failed' });
    }
    return true;
  }

  // GET /v1/byok/providers
  if (req.method === 'GET' && path === '/v1/byok/providers') {
    try {
      const keys = await listProviderKeys(userId);
      writeJson(res, 200, { ok: true, keys });
    } catch (e: any) {
      console.error('[byok] list error:', e?.message || e);
      writeJson(res, 500, { ok: false, error: 'list_failed' });
    }
    return true;
  }

  // /v1/byok/providers/:provider[/test]
  const m = path.match(/^\/v1\/byok\/providers\/([a-z_]+)(?:\/(test))?$/);
  if (m) {
    const providerSlug = m[1];
    const sub = m[2];
    if (!isProvider(providerSlug)) {
      writeJson(res, 400, { ok: false, error: 'invalid_provider' });
      return true;
    }
    const provider = providerSlug as Provider;

    // PUT — create/replace
    if (req.method === 'PUT' && !sub) {
      const body = await readJson(req);
      if (!body || typeof body !== 'object') { writeJson(res, 400, { ok: false, error: 'invalid_json' }); return true; }
      const apiKey = String(body.apiKey || '').trim();
      if (!apiKey) { writeJson(res, 400, { ok: false, error: 'api_key_required' }); return true; }
      if (apiKey.length > 4096) { writeJson(res, 400, { ok: false, error: 'api_key_too_long' }); return true; }
      const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : null;
      if (provider === 'openai_compatible' && !baseUrl) {
        writeJson(res, 400, { ok: false, error: 'base_url_required' });
        return true;
      }
      const label = typeof body.label === 'string' ? body.label.trim() || 'default' : 'default';

      try {
        // Best-effort dup detection: warn, but don't block.
        const dup = await findDuplicateByFingerprint(userId, apiKey, provider, label).catch(() => null);

        const saved = await upsertProviderKey(userId, {
          provider,
          label,
          apiKey,
          baseUrl,
          enabled: typeof body.enabled === 'boolean' ? body.enabled : true,
          accountEmail: typeof body.accountEmail === 'string' ? body.accountEmail : null,
        });
        invalidateUserCache(userId, provider);
        await writeAuditLog({
          userId,
          provider,
          keyId: saved.id,
          action: 'create',
          ip: clientIp(req),
          userAgent: String(req.headers['user-agent'] || '').slice(0, 200) || null,
          detail: { label },
        });
        writeJson(res, 200, {
          ok: true,
          key: saved,
          duplicate: dup ? { provider: dup.provider, label: dup.label } : null,
        });
      } catch (e: any) {
        console.error('[byok] put error:', e?.message || e);
        writeJson(res, 500, { ok: false, error: e?.message || 'save_failed' });
      }
      return true;
    }

    // PATCH — toggle enabled
    if (req.method === 'PATCH' && !sub) {
      const body = await readJson(req);
      if (!body || typeof body !== 'object') { writeJson(res, 400, { ok: false, error: 'invalid_json' }); return true; }
      const enabled = !!body.enabled;
      const label = typeof body.label === 'string' ? body.label.trim() || 'default' : 'default';
      try {
        const updated = await setProviderKeyEnabled(userId, provider, enabled, label);
        if (!updated) { writeJson(res, 404, { ok: false, error: 'not_found' }); return true; }
        invalidateUserCache(userId, provider);
        await writeAuditLog({
          userId,
          provider,
          keyId: updated.id,
          action: enabled ? 'enable' : 'disable',
          ip: clientIp(req),
        });
        writeJson(res, 200, { ok: true, key: updated });
      } catch (e: any) {
        console.error('[byok] patch error:', e?.message || e);
        writeJson(res, 500, { ok: false, error: 'update_failed' });
      }
      return true;
    }

    // DELETE
    if (req.method === 'DELETE' && !sub) {
      const label = typeof parsedUrl.searchParams.get('label') === 'string'
        ? (parsedUrl.searchParams.get('label') || 'default')
        : 'default';
      try {
        const removed = await deleteProviderKey(userId, provider, label);
        invalidateUserCache(userId, provider);
        await writeAuditLog({
          userId,
          provider,
          action: 'delete',
          ip: clientIp(req),
          detail: { label, removed },
        });
        writeJson(res, 200, { ok: true, removed });
      } catch (e: any) {
        console.error('[byok] delete error:', e?.message || e);
        writeJson(res, 500, { ok: false, error: 'delete_failed' });
      }
      return true;
    }

    // POST /test — validate against the upstream provider
    if (req.method === 'POST' && sub === 'test') {
      if (!allowTest(userId)) {
        writeJson(res, 429, { ok: false, error: 'rate_limited', retryAfterSeconds: TEST_WINDOW_MS / 1000 });
        return true;
      }
      const label = typeof parsedUrl.searchParams.get('label') === 'string'
        ? (parsedUrl.searchParams.get('label') || 'default')
        : 'default';
      try {
        const resolved = await resolveProviderKeyWithSecret(userId, provider, label);
        if (!resolved) { writeJson(res, 404, { ok: false, error: 'no_key_or_disabled' }); return true; }
        const probe = await runProviderProbe(provider, resolved.apiKey, resolved.baseUrl);
        await writeAuditLog({
          userId,
          provider,
          keyId: resolved.id,
          action: 'test',
          ip: clientIp(req),
          detail: { ok: probe.ok, status: probe.status },
        });
        writeJson(res, probe.ok ? 200 : 400, {
          ok: probe.ok,
          status: probe.status,
          ...(probe.message && !probe.ok ? { message: probe.message } : {}),
        });
      } catch (e: any) {
        console.error('[byok] test error:', e?.message || e);
        writeJson(res, 500, { ok: false, error: 'test_failed' });
      }
      return true;
    }
  }

  return false;
}
