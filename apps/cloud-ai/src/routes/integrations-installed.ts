/**
 * HTTP routes for DEPLOYED custom integrations (persisted, per-user).
 *
 *   GET    /v1/integrations/installed            — list deployed integrations (no secrets)
 *   POST   /v1/integrations/installed            — deploy/update { manifest, secrets?, enabled? }
 *   POST   /v1/integrations/installed/:slug/enabled — toggle { enabled }
 *   DELETE /v1/integrations/installed/:slug       — uninstall
 *   POST   /v1/integrations/run                   — execute { slug|name, toolName?, args? } server-side
 *
 * Unlike the draft routes (integrations-draft.ts), the manifest + credentials
 * are stored in the custom_integrations table with envelope-encrypted secrets.
 * The /run route resolves secrets server-side so workflow nodes never put
 * credentials on the wire.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { authenticateHttpLegacy, sendAuthError } from '../auth/http';
import { AuthErrorCode } from '../auth';
import {
  executeDeclarativeTool,
  IntegrationExecutorError,
} from '../integrations/declarative-executor';
import type { IntegrationManifest } from '../integrations/types';
import {
  listInstalled,
  upsertInstalled,
  setEnabled,
  removeInstalled,
  getDecryptedSecrets,
  getEnabledWithSecrets,
} from '../integrations/installed-store';
import { compiledToolName } from '../integrations/compile-tools';
import { ensureFreshOAuthToken } from '../integrations/oauth-refresh';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
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

function validateManifestShape(m: any): string | null {
  if (!m || typeof m !== 'object') return 'manifest must be an object';
  if (typeof m.slug !== 'string' || !m.slug) return 'manifest.slug is required';
  if (typeof m.version !== 'string' || !m.version) return 'manifest.version is required';
  if (!m.auth || typeof m.auth !== 'object') return 'manifest.auth is required';
  if (!Array.isArray(m.auth.fields)) return 'manifest.auth.fields must be an array';
  if (!m.auth.strategy || typeof m.auth.strategy !== 'object') return 'manifest.auth.strategy is required';
  if (!Array.isArray(m.outbound_hosts) || m.outbound_hosts.length === 0) {
    return 'manifest.outbound_hosts must be a non-empty array';
  }
  if (!Array.isArray(m.tools) || m.tools.length === 0) return 'manifest.tools must be a non-empty array';
  return null;
}

function sanitizeSecrets(s: any, fields: any[]): Record<string, string> {
  const allowed = new Set<string>();
  for (const f of fields) if (f && typeof f.name === 'string') allowed.add(f.name);
  const out: Record<string, string> = {};
  if (!s || typeof s !== 'object') return out;
  for (const [k, v] of Object.entries(s)) {
    if (allowed.has(k) && typeof v === 'string' && v.length > 0) out[k] = v;
  }
  return out;
}

export async function handleIntegrationsInstalledRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parsedUrl: URL,
): Promise<boolean> {
  const path = parsedUrl.pathname;
  const isInstalled = path === '/v1/integrations/installed' || path.startsWith('/v1/integrations/installed/');
  const isRun = path === '/v1/integrations/run';
  if (!isInstalled && !isRun) return false;

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

  try {
    // ── /v1/integrations/run ───────────────────────────────────────────────
    if (isRun) {
      if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'method_not_allowed' }); return true; }
      const body = await readJson(req);
      if (!body) { writeJson(res, 400, { ok: false, error: 'invalid_json' }); return true; }
      const args = (body.args && typeof body.args === 'object' && !Array.isArray(body.args)) ? body.args : {};

      let slug: string | null = typeof body.slug === 'string' ? body.slug : null;
      let toolName: string | null = typeof body.toolName === 'string' ? body.toolName : null;

      // Resolve a compiled tool name (`${slug}_${tool}`) when slug/toolName not given.
      if ((!slug || !toolName) && typeof body.name === 'string' && body.name) {
        const integrations = await getEnabledWithSecrets(userId);
        for (const integ of integrations) {
          const match = (integ.manifest.tools || []).find((t) => compiledToolName(integ.slug, t.name) === body.name);
          if (match) { slug = integ.slug; toolName = match.name; break; }
        }
      }
      if (!slug || !toolName) { writeJson(res, 400, { ok: false, error: 'missing_tool', detail: 'provide {slug, toolName} or a compiled {name}' }); return true; }

      const resolved = await getDecryptedSecrets(userId, slug);
      if (!resolved) { writeJson(res, 404, { ok: false, error: 'not_installed', detail: `No enabled integration "${slug}"` }); return true; }
      // For oauth2 integrations, refresh the access token if it's near expiry
      // before the call (no-op for every other auth strategy).
      const secrets = await ensureFreshOAuthToken(userId, resolved.manifest, resolved.secrets);
      const result = await executeDeclarativeTool(resolved.manifest, toolName, { secrets, args });
      writeJson(res, 200, { ok: true, result });
      return true;
    }

    // ── /v1/integrations/installed/:slug(/enabled) ─────────────────────────
    if (path !== '/v1/integrations/installed') {
      const rest = path.slice('/v1/integrations/installed/'.length);
      const [rawSlug, sub] = rest.split('/');
      const slug = decodeURIComponent(rawSlug || '');
      if (!slug) { writeJson(res, 400, { ok: false, error: 'missing_slug' }); return true; }

      if (sub === 'enabled' && req.method === 'POST') {
        const body = await readJson(req);
        const enabled = !!body?.enabled;
        const ok = await setEnabled(userId, slug, enabled);
        writeJson(res, ok ? 200 : 500, ok ? { ok: true, slug, enabled } : { ok: false, error: 'update_failed' });
        return true;
      }
      if (!sub && req.method === 'DELETE') {
        const ok = await removeInstalled(userId, slug);
        writeJson(res, ok ? 200 : 500, ok ? { ok: true, slug } : { ok: false, error: 'delete_failed' });
        return true;
      }
      writeJson(res, 405, { ok: false, error: 'method_not_allowed' });
      return true;
    }

    // ── /v1/integrations/installed (collection) ────────────────────────────
    if (req.method === 'GET') {
      const integrations = await listInstalled(userId);
      writeJson(res, 200, { ok: true, integrations });
      return true;
    }
    if (req.method === 'POST') {
      const body = await readJson(req);
      if (!body) { writeJson(res, 400, { ok: false, error: 'invalid_json' }); return true; }
      const manifest = body.manifest as IntegrationManifest | undefined;
      const shapeErr = validateManifestShape(manifest);
      if (shapeErr) { writeJson(res, 400, { ok: false, error: 'invalid_manifest', detail: shapeErr }); return true; }
      const secrets = sanitizeSecrets(body.secrets, manifest!.auth.fields);
      const enabled = body.enabled === undefined ? true : !!body.enabled;
      const saved = await upsertInstalled(userId, manifest!, secrets, enabled);
      writeJson(res, 200, { ok: true, integration: saved });
      return true;
    }
    writeJson(res, 405, { ok: false, error: 'method_not_allowed' });
    return true;
  } catch (e: any) {
    if (e instanceof IntegrationExecutorError) {
      writeJson(res, 400, { ok: false, error: e.code, detail: e.message });
    } else {
      writeJson(res, 500, { ok: false, error: 'integration_route_error', detail: e?.message || String(e) });
    }
    return true;
  }
}
