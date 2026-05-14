/**
 * BYOK API client — desktop-side.
 *
 * Security posture for the trip from this renderer to cloud-ai:
 *   1. **TLS required.** Plaintext API keys may only ever cross the wire
 *      over HTTPS. In production we refuse to PUT to a non-HTTPS base URL.
 *      A localhost dev base is allowed (loopback, no network exposure).
 *   2. **Bearer auth.** Every request carries the user's Supabase JWT in
 *      Authorization. No API call accepts the key without auth — the
 *      server's authenticateHttpLegacy gate runs first.
 *   3. **Plaintext is one-way.** The server NEVER returns the key in any
 *      response; only `last_four` + metadata. So this client only ever
 *      *sends* plaintext; it never *receives* it.
 *   4. **No logging.** We deliberately do not pass the apiKey through any
 *      console.* call, not even in error paths. Errors carry only the
 *      response status/code.
 *   5. **Input handling** (callers): use <input type="password">,
 *      autoComplete="off", spellCheck={false}; clear the field on submit.
 *   6. **No persistence.** Plaintext is held in component state only and
 *      never written to localStorage, IndexedDB, or any disk path.
 *   7. **CORS / CSRF.** cloud-ai requires Authorization headers, which
 *      browsers do not auto-attach (unlike cookies), so cross-origin CSRF
 *      is moot. The server's CORS allow-list further restricts origins.
 */

import { getCloudAiHttp } from './cloud';

export type ByokProvider =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'xai'
  | 'openrouter'
  | 'openai_compatible';

// Codex / ChatGPT-subscription auth is intentionally not a cloud BYOK
// provider — it's handled entirely on the desktop via @openai/codex-sdk
// against the user's local `codex` CLI install. See utils/codex-local.ts.

export interface ByokKey {
  id: string;
  provider: ByokProvider;
  label: string;
  enabled: boolean;
  last_four: string | null;
  base_url: string | null;
  account_email: string | null;
  /** Codex only: access-token expiry (cloud surfaces this so the desktop
   *  knows when to push fresh tokens from its local ~/.codex/auth.json). */
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
}

export class ByokError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function assertSecureForPlaintext(baseUrl: string): void {
  // Allow http://localhost / http://127.0.0.1 in dev. Anything else over
  // plain http is a refusal — better a hard error than a silently-leaked
  // key on someone's coffeeshop wi-fi.
  let parsed: URL;
  try { parsed = new URL(baseUrl); } catch {
    throw new ByokError('cloud_ai_url_invalid', 0, 'invalid_base_url');
  }
  if (parsed.protocol === 'https:') return;
  const host = parsed.hostname.toLowerCase();
  const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (parsed.protocol === 'http:' && isLoopback) return;
  throw new ByokError(
    'Refusing to send an API key over an unencrypted connection.',
    0,
    'insecure_transport',
  );
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

/** Sanitize a server error response into a ByokError without exposing key material. */
async function toError(resp: Response): Promise<ByokError> {
  let code = `http_${resp.status}`;
  let message = resp.statusText || 'request_failed';
  try {
    const j = await resp.json();
    if (j && typeof j === 'object') {
      if (typeof j.error === 'string') code = j.error;
      if (typeof j.message === 'string') message = j.message;
    }
  } catch {}
  return new ByokError(message, resp.status, code);
}

export interface ByokClient {
  list(): Promise<ByokKey[]>;
  save(input: {
    provider: ByokProvider;
    apiKey: string;
    baseUrl?: string | null;
    label?: string;
    enabled?: boolean;
    accountEmail?: string | null;
  }): Promise<{ key: ByokKey; duplicate: { provider: ByokProvider; label: string } | null }>;
  toggle(provider: ByokProvider, enabled: boolean, label?: string): Promise<ByokKey>;
  remove(provider: ByokProvider, label?: string): Promise<boolean>;
  test(provider: ByokProvider, label?: string): Promise<{ ok: boolean; status: number; message?: string }>;
}

/**
 * Build a BYOK client. `getToken` is called per-request so it always picks
 * up the freshest Supabase access token.
 */
export function createByokClient(getToken: () => Promise<string | null>): ByokClient {
  const baseUrl = getCloudAiHttp();

  async function authedFetch(method: string, path: string, body?: any, opts?: { sensitive?: boolean }): Promise<Response> {
    if (opts?.sensitive) assertSecureForPlaintext(baseUrl);
    const token = await getToken();
    if (!token) throw new ByokError('not_authenticated', 401, 'not_authenticated');
    const init: RequestInit = {
      method,
      headers: authHeaders(token),
      cache: 'no-store',
      credentials: 'omit',
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    return fetch(`${baseUrl}${path}`, init);
  }

  return {
    async list() {
      const r = await authedFetch('GET', '/v1/byok/providers');
      if (!r.ok) throw await toError(r);
      const j = await r.json();
      return Array.isArray(j?.keys) ? (j.keys as ByokKey[]) : [];
    },

    async save(input) {
      const provider = input.provider;
      const apiKey = String(input.apiKey || '').trim();
      if (!apiKey) throw new ByokError('api_key_required', 400, 'api_key_required');
      const r = await authedFetch('PUT', `/v1/byok/providers/${provider}`, {
        apiKey,
        baseUrl: input.baseUrl || null,
        label: input.label || 'default',
        enabled: input.enabled !== false,
        accountEmail: input.accountEmail || null,
      }, { sensitive: true });
      if (!r.ok) throw await toError(r);
      const j = await r.json();
      return { key: j.key as ByokKey, duplicate: j.duplicate || null };
    },

    async toggle(provider, enabled, label = 'default') {
      const r = await authedFetch('PATCH', `/v1/byok/providers/${provider}`, { enabled, label });
      if (!r.ok) throw await toError(r);
      const j = await r.json();
      return j.key as ByokKey;
    },

    async remove(provider, label = 'default') {
      const r = await authedFetch('DELETE', `/v1/byok/providers/${provider}?label=${encodeURIComponent(label)}`);
      if (!r.ok) throw await toError(r);
      const j = await r.json();
      return !!j?.removed;
    },

    async test(provider, label = 'default') {
      const r = await authedFetch('POST', `/v1/byok/providers/${provider}/test?label=${encodeURIComponent(label)}`);
      const j = await r.json().catch(() => ({}));
      return {
        ok: !!j?.ok,
        status: typeof j?.status === 'number' ? j.status : r.status,
        message: typeof j?.message === 'string' ? j.message : undefined,
      };
    },
  };
}

/** Provider display metadata for the UI. Order is the order shown in Settings. */
export const PROVIDER_DISPLAY: Array<{
  provider: ByokProvider;
  name: string;
  hint: string;
  keyHint: string;
  needsBaseUrl: boolean;
}> = [
  { provider: 'anthropic',          name: 'Anthropic',         hint: 'Claude (claude.ai/console)',       keyHint: 'sk-ant-…', needsBaseUrl: false },
  { provider: 'openai',             name: 'OpenAI',            hint: 'platform.openai.com',               keyHint: 'sk-…',     needsBaseUrl: false },
  { provider: 'google',             name: 'Google (Gemini)',   hint: 'aistudio.google.com',               keyHint: 'AIza…',    needsBaseUrl: false },
  { provider: 'xai',                name: 'xAI (Grok)',        hint: 'console.x.ai',                      keyHint: 'xai-…',    needsBaseUrl: false },
  { provider: 'openrouter',         name: 'OpenRouter',        hint: 'openrouter.ai/keys',                keyHint: 'sk-or-…',  needsBaseUrl: false },
  { provider: 'openai_compatible',  name: 'OpenAI-compatible', hint: 'Any /v1/chat/completions endpoint', keyHint: 'sk-…',     needsBaseUrl: true  },
];
