/**
 * Declarative-integration executor.
 *
 * Takes (manifest, toolName, args, secrets) and makes the outbound HTTP
 * request described by the manifest's DeclarativeTool. The executor is
 * the only place where secrets enter outbound network calls; callers
 * never see raw fetch and never assemble headers themselves.
 *
 * Security invariants:
 *   1. Outbound host MUST match `manifest.outbound_hosts`. Localhost,
 *      RFC1918, link-local, and IPv6 ULA are rejected regardless of the
 *      allowlist contents.
 *   2. Templates may reference {{secrets.X}} only when X is a declared
 *      auth field. They may reference {{args.X}} only when X is in the
 *      tool's args.properties. Anything else throws.
 *   3. Errors must NOT include resolved secret values — the redactor
 *      strips known secret strings from any error surface.
 */

import type {
  IntegrationManifest,
  DeclarativeTool,
  AuthStrategy,
  RequestBody,
  ExecutorContext,
  ExecutorResult,
} from './types';

// ─── Public API ───────────────────────────────────────────────────────────

export class IntegrationExecutorError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'IntegrationExecutorError';
  }
}

/**
 * Execute a single tool from an integration manifest.
 *
 * @param fetchImpl Override for tests. Defaults to globalThis.fetch.
 */
export async function executeDeclarativeTool(
  manifest: IntegrationManifest,
  toolName: string,
  ctx: ExecutorContext,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<ExecutorResult> {
  const tool = manifest.tools.find(t => t.name === toolName);
  if (!tool) {
    throw new IntegrationExecutorError('unknown_tool', `No tool "${toolName}" in pack "${manifest.slug}"`);
  }

  const declaredArgs = new Set(Object.keys(tool.args.properties || {}));
  const declaredSecrets = new Set(manifest.auth.fields.map(f => f.name));
  const binder = makeBinder(ctx, declaredArgs, declaredSecrets);

  // Build URL
  const boundUrl = binder.bind(tool.request.urlTemplate);
  const url = new URL(boundUrl);
  enforceHostPolicy(url, manifest.outbound_hosts);

  // Apply auth (header or query) — gathers any auth header/query mutations
  applyAuth(manifest.auth.strategy, ctx.secrets, url, /* mutates */);

  // Manifest-declared query params — omit when arg is absent
  if (tool.request.query) {
    for (const [k, vTemplate] of Object.entries(tool.request.query)) {
      const v = binder.resolveTyped(vTemplate);
      if (v !== ABSENT && v !== '' && v != null) {
        url.searchParams.set(k, String(v));
      }
    }
  }

  // Headers — start with auth-injected ones, then merge manifest extras
  const headers = new Headers();
  applyAuthHeaders(manifest.auth.strategy, ctx.secrets, headers);
  if (tool.request.headers) {
    for (const [k, vTemplate] of Object.entries(tool.request.headers)) {
      const v = binder.resolveTyped(vTemplate);
      if (v !== ABSENT && v !== '' && v != null) {
        headers.set(k, String(v));
      }
    }
  }

  // Body
  const { body, contentType } = encodeBody(tool.request.body, binder);
  if (contentType && !headers.has('content-type')) {
    headers.set('content-type', contentType);
  }

  // Default Accept: application/json — most APIs prefer it.
  if (!headers.has('accept')) headers.set('accept', 'application/json');

  const t0 = Date.now();
  let response: Response;
  try {
    response = await fetchImpl(url.toString(), {
      method: tool.request.method,
      headers,
      body,
    });
  } catch (e: any) {
    const msg = redact(String(e?.message || e), ctx.secrets);
    return {
      ok: false,
      status: 0,
      body: null,
      headers: {},
      error: `Network error: ${msg}`,
      elapsed_ms: Date.now() - t0,
    };
  }

  const elapsed_ms = Date.now() - t0;
  const responseHeaders = pickSafeHeaders(response.headers);
  const responseBody = await readBody(response);

  if (!response.ok) {
    const mapped = tool.errorMap?.[response.status];
    const friendly = mapped ? bindResponseTemplate(mapped, responseBody) : undefined;
    return {
      ok: false,
      status: response.status,
      body: responseBody,
      headers: responseHeaders,
      error: friendly || `HTTP ${response.status} ${response.statusText}`,
      elapsed_ms,
    };
  }

  return {
    ok: true,
    status: response.status,
    body: responseBody,
    headers: responseHeaders,
    elapsed_ms,
  };
}

// ─── Template binding ─────────────────────────────────────────────────────

const TEMPLATE_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)\s*\}\}/g;
const WHOLE_TEMPLATE_RE = /^\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)\s*\}\}$/;

/**
 * Sentinel returned by binder.resolveTyped() when the referenced arg/secret
 * is absent. Lets callers (body/query/header encoders) decide whether to
 * omit the field or send empty string.
 */
const ABSENT = Symbol('absent');

interface Binder {
  /** String-substitution path — used inside URLs and mixed-template strings. Missing args resolve to "". */
  bind(template: string): string;
  /**
   * Whole-value substitution — used when a JSON value is exactly a single
   * `{{path}}` and we want to preserve its native type (array, number, …)
   * or omit it entirely. Returns ABSENT when the referenced arg is missing.
   */
  resolveTyped(template: string): any | typeof ABSENT;
}

function makeBinder(
  ctx: ExecutorContext,
  declaredArgs: Set<string>,
  declaredSecrets: Set<string>,
): Binder {
  function resolvePath(path: string): any | typeof ABSENT {
    const [root, ...rest] = path.split('.');
    if (root === 'secrets') {
      const field = rest.join('.');
      if (!declaredSecrets.has(field)) {
        throw new IntegrationExecutorError(
          'undeclared_secret',
          `Template references {{secrets.${field}}} but no such field is declared in auth.fields`,
        );
      }
      const v = ctx.secrets[field];
      if (v == null) {
        throw new IntegrationExecutorError(
          'missing_secret',
          `Secret "${field}" is declared but not supplied`,
        );
      }
      return v;
    }
    if (root === 'args') {
      if (rest.length === 0 || !declaredArgs.has(rest[0])) {
        throw new IntegrationExecutorError(
          'undeclared_arg',
          `Template references {{args.${rest.join('.')}}} but no such arg is declared`,
        );
      }
      const v = digPath(ctx.args, rest);
      return v == null ? ABSENT : v;
    }
    throw new IntegrationExecutorError(
      'unknown_template_root',
      `Unknown template root "${root}" — only {{secrets.*}} and {{args.*}} are allowed`,
    );
  }

  return {
    bind(template: string): string {
      if (!template) return template;
      return template.replace(TEMPLATE_RE, (_, path: string) => {
        const v = resolvePath(path);
        return v === ABSENT ? '' : String(v);
      });
    },
    resolveTyped(template: string): any | typeof ABSENT {
      const whole = WHOLE_TEMPLATE_RE.exec(template);
      if (whole) return resolvePath(whole[1]);
      // Mixed template — produce a string, but a string that's empty when
      // every referenced arg is absent so the caller can omit the field.
      let anyResolved = false;
      const out = template.replace(TEMPLATE_RE, (_, path: string) => {
        const v = resolvePath(path);
        if (v === ABSENT) return '';
        anyResolved = true;
        return String(v);
      });
      return anyResolved ? out : ABSENT;
    },
  };
}

export const __ABSENT = ABSENT;

function digPath(obj: any, path: string[]): any {
  let cur: any = obj;
  for (const p of path) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

// ─── Auth injection ───────────────────────────────────────────────────────

function applyAuthHeaders(strategy: AuthStrategy, secrets: Record<string, string>, headers: Headers): void {
  switch (strategy.type) {
    case 'bearer': {
      const token = secrets[strategy.tokenField];
      if (!token) throw new IntegrationExecutorError('missing_secret', `Auth field "${strategy.tokenField}" not supplied`);
      const headerName = strategy.headerName || 'Authorization';
      const scheme = strategy.scheme || 'Bearer';
      headers.set(headerName, `${scheme} ${token}`);
      return;
    }
    case 'apiKey': {
      if (strategy.in === 'header') {
        const key = secrets[strategy.keyField];
        if (!key) throw new IntegrationExecutorError('missing_secret', `Auth field "${strategy.keyField}" not supplied`);
        headers.set(strategy.headerName, (strategy.prefix || '') + key);
      }
      // query-style apiKey is handled in applyAuth() below
      return;
    }
    case 'basic': {
      const u = secrets[strategy.userField] || '';
      const p = secrets[strategy.passField] || '';
      if (!u && !p) throw new IntegrationExecutorError('missing_secret', `Basic-auth credentials not supplied`);
      const b64 = Buffer.from(`${u}:${p}`, 'utf8').toString('base64');
      headers.set('Authorization', `Basic ${b64}`);
      return;
    }
    case 'none':
      return;
  }
}

function applyAuth(strategy: AuthStrategy, secrets: Record<string, string>, url: URL, _mutates?: void): void {
  if (strategy.type === 'apiKey' && strategy.in === 'query') {
    const key = secrets[strategy.keyField];
    if (!key) throw new IntegrationExecutorError('missing_secret', `Auth field "${strategy.keyField}" not supplied`);
    url.searchParams.set(strategy.paramName, key);
  }
}

// ─── Body encoding ────────────────────────────────────────────────────────

function encodeBody(
  body: RequestBody | undefined,
  binder: Binder,
): { body: string | undefined; contentType?: string } {
  if (!body || body.kind === 'none') return { body: undefined };

  if (body.kind === 'json') {
    // Walk the JSON value; for each string leaf, resolve via typed binder
    // so whole-value templates preserve their native type (array, number)
    // and absent args drop their key entirely.
    const bound = deepBindJsonValue(body.value, binder);
    // Top-level might itself collapse to ABSENT (rare); send {} in that case.
    const payload = bound === ABSENT ? {} : bound;
    return { body: JSON.stringify(payload), contentType: 'application/json' };
  }

  if (body.kind === 'form') {
    const params = new URLSearchParams();
    for (const [k, vTemplate] of Object.entries(body.fields)) {
      const v = binder.resolveTyped(vTemplate);
      if (v === ABSENT || v === '' || v == null) continue;
      // Form fields stringify arrays and objects, but Stripe expects bracket
      // notation for that — at v1 we only encode scalars. If a manifest
      // needs Stripe-style nested forms it should use a json body.
      params.set(k, String(v));
    }
    const encoded = params.toString();
    return {
      body: encoded || undefined,
      contentType: 'application/x-www-form-urlencoded',
    };
  }

  if (body.kind === 'text') {
    return { body: binder.bind(body.value), contentType: body.contentType };
  }

  return { body: undefined };
}

/**
 * Walk a JSON value template tree. Rules:
 *   - String that is exactly `{{path}}` → typed substitution (array stays an array,
 *     etc.) or ABSENT when the referenced arg/secret is missing.
 *   - String with mixed templating → bound string, or ABSENT when every
 *     reference is missing.
 *   - Object → drop keys whose value resolves to ABSENT.
 *   - Array → drop ABSENT entries (so an array of templates collapses cleanly).
 *   - Other primitives → pass through.
 */
function deepBindJsonValue(value: any, binder: Binder): any {
  if (typeof value === 'string') return binder.resolveTyped(value);
  if (Array.isArray(value)) {
    const out: any[] = [];
    for (const v of value) {
      const r = deepBindJsonValue(v, binder);
      if (r !== ABSENT) out.push(r);
    }
    return out;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    let kept = 0;
    for (const [k, v] of Object.entries(value)) {
      const r = deepBindJsonValue(v, binder);
      if (r !== ABSENT) {
        out[k] = r;
        kept++;
      }
    }
    // An object where every field collapsed is itself absent.
    return kept === 0 ? ABSENT : out;
  }
  return value;
}

// ─── Host policy ──────────────────────────────────────────────────────────

const PRIVATE_IPV4 = [
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^127\./,
  /^169\.254\./,           // link-local
  /^0\./,                  // unspecified
];

function isPrivateOrLoopback(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost') return true;
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd')) return true; // IPv6 loopback / ULA
  if (h.startsWith('fe80')) return true;                                     // IPv6 link-local
  // crude IPv4 check
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    return PRIVATE_IPV4.some(re => re.test(h));
  }
  return false;
}

function matchesHost(hostname: string, pattern: string): boolean {
  const h = hostname.toLowerCase();
  const p = pattern.toLowerCase();
  if (p === h) return true;
  if (p.startsWith('*.')) {
    const tail = p.slice(2);
    return h === tail || h.endsWith('.' + tail);
  }
  return false;
}

function enforceHostPolicy(url: URL, allowlist: string[]): void {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new IntegrationExecutorError('blocked_protocol', `Protocol ${url.protocol} is not allowed`);
  }
  if (isPrivateOrLoopback(url.hostname)) {
    throw new IntegrationExecutorError('blocked_private_host', `Host ${url.hostname} is private/loopback and never allowed`);
  }
  if (!allowlist.some(p => matchesHost(url.hostname, p))) {
    throw new IntegrationExecutorError(
      'host_not_allowlisted',
      `Host ${url.hostname} is not in the manifest's outbound_hosts allowlist`,
    );
  }
}

// ─── Response shaping ─────────────────────────────────────────────────────

const SAFE_RESPONSE_HEADERS = new Set([
  'content-type', 'content-length', 'etag', 'last-modified',
  'link', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset',
  'retry-after', 'x-request-id', 'x-rate-limit-limit', 'x-rate-limit-remaining',
]);

function pickSafeHeaders(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((value, key) => {
    if (SAFE_RESPONSE_HEADERS.has(key.toLowerCase())) out[key.toLowerCase()] = value;
  });
  return out;
}

async function readBody(response: Response): Promise<any> {
  const ct = response.headers.get('content-type') || '';
  if (response.status === 204) return null;
  if (ct.includes('application/json')) {
    try { return await response.json(); } catch { return null; }
  }
  // Fall back to text — most error responses are plaintext or HTML.
  try { return await response.text(); } catch { return null; }
}

/**
 * Templates inside errorMap entries can reference response body fields,
 * e.g. "{{response.error.message}}". We only support a tiny path syntax
 * here — manifests can't shell out via this.
 */
function bindResponseTemplate(tpl: string, body: any): string {
  return tpl.replace(/\{\{\s*response\.([a-zA-Z_][a-zA-Z0-9_.]*)\s*\}\}/g, (_, path: string) => {
    const v = digPath(body, path.split('.'));
    return v == null ? '' : String(v);
  });
}

// ─── Redaction ────────────────────────────────────────────────────────────

function redact(text: string, secrets: Record<string, string>): string {
  let out = text;
  for (const v of Object.values(secrets)) {
    if (!v || v.length < 4) continue;
    out = out.split(v).join('•••');
  }
  return out;
}

// ─── Test-only exports ────────────────────────────────────────────────────

export const __test = {
  ABSENT,
  isPrivateOrLoopback,
  matchesHost,
  enforceHostPolicy,
  makeBinder,
  encodeBody,
  deepBindJsonValue,
  redact,
};
