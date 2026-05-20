/**
 * Test-phase HTTP routes for DRAFT custom-integration manifests.
 *
 *   POST /v1/integrations/run-draft   — execute one tool from a draft manifest
 *   POST /v1/integrations/ping-draft  — run the manifest's `ping` probe
 *
 * Drafts are NOT persisted. The manifest, secrets, args travel in the
 * request body (TLS) and are dropped after the call returns. Once the
 * encrypted vault lands, the desktop UI moves to a /v1/integrations/run
 * variant that takes (slug, tool, args) and resolves secrets server-side;
 * the executor stays the same so the manifest format is what's being
 * validated here.
 *
 * Security:
 *   - Auth required (same pattern as byok routes).
 *   - The executor enforces host allowlist + localhost/RFC1918 block
 *     unconditionally, so a draft cannot SSRF the cloud-ai box.
 *   - Errors are surfaced verbatim from the executor; the redactor inside
 *     the executor strips known secret strings before message construction.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { authenticateHttpLegacy, sendAuthError } from '../auth/http';
import { AuthErrorCode } from '../auth';
import {
  executeDeclarativeTool,
  IntegrationExecutorError,
} from '../integrations/declarative-executor';
import type { IntegrationManifest } from '../integrations/types';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

/**
 * Minimal shape check so the executor doesn't blow up on `manifest.tools[…]`
 * before we've even confirmed `tools` is an array. We deliberately do NOT
 * over-validate here — the executor's own undeclared-secret / undeclared-arg
 * / host-allowlist errors are the useful feedback signal for the author.
 */
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
  if (!Array.isArray(m.tools)) return 'manifest.tools must be an array';
  return null;
}

function sanitizeSecrets(s: any, fields: any[]): Record<string, string> {
  // Allow only declared field names through to the executor. Anything else
  // would either be ignored (best case) or template-resolvable from a
  // sloppy manifest (worst case) — drop them.
  const allowed = new Set<string>();
  for (const f of fields) if (f && typeof f.name === 'string') allowed.add(f.name);

  const out: Record<string, string> = {};
  if (!s || typeof s !== 'object') return out;
  for (const [k, v] of Object.entries(s)) {
    if (allowed.has(k) && typeof v === 'string' && v.length > 0) {
      out[k] = v;
    }
  }
  return out;
}

export async function handleIntegrationsDraftRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parsedUrl: URL,
): Promise<boolean> {
  const path = parsedUrl.pathname;

  if (!path.startsWith('/v1/integrations/')) return false;
  const isRun = path === '/v1/integrations/run-draft';
  const isPing = path === '/v1/integrations/ping-draft';
  if (!isRun && !isPing) return false;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return true;
  }

  if (req.method !== 'POST') {
    writeJson(res, 405, { ok: false, error: 'method_not_allowed' });
    return true;
  }

  const auth = await authenticateHttpLegacy(req, parsedUrl);
  if (!auth.success || !auth.userId) {
    sendAuthError(res, auth.error || AuthErrorCode.UNAUTHORIZED, auth.message);
    return true;
  }

  const body = await readJson(req);
  if (!body) {
    writeJson(res, 400, { ok: false, error: 'invalid_json' });
    return true;
  }

  const manifest = body.manifest as IntegrationManifest | undefined;
  const shapeErr = validateManifestShape(manifest);
  if (shapeErr) {
    writeJson(res, 400, { ok: false, error: 'invalid_manifest', detail: shapeErr });
    return true;
  }
  const secrets = sanitizeSecrets(body.secrets, manifest!.auth.fields);

  try {
    if (isPing) {
      if (!manifest!.ping) {
        writeJson(res, 400, { ok: false, error: 'no_ping', detail: 'manifest has no `ping` block' });
        return true;
      }
      // Run ping as a synthetic tool — reuses the same executor path.
      const synthetic: IntegrationManifest = {
        ...manifest!,
        tools: [
          {
            name: '__ping__',
            description: 'Ping probe',
            args: { type: 'object', properties: {} },
            request: {
              method: manifest!.ping.method,
              urlTemplate: manifest!.ping.urlTemplate,
              headers: manifest!.ping.headers,
            },
          },
        ],
      };
      const result = await executeDeclarativeTool(synthetic, '__ping__', { secrets, args: {} });
      writeJson(res, 200, { ok: true, result });
      return true;
    }

    // run-draft
    const toolName = typeof body.toolName === 'string' ? body.toolName : null;
    if (!toolName) {
      writeJson(res, 400, { ok: false, error: 'missing_tool_name' });
      return true;
    }
    const args = (body.args && typeof body.args === 'object' && !Array.isArray(body.args))
      ? body.args
      : {};

    const result = await executeDeclarativeTool(manifest!, toolName, { secrets, args });
    writeJson(res, 200, { ok: true, result });
    return true;
  } catch (e: any) {
    if (e instanceof IntegrationExecutorError) {
      writeJson(res, 400, { ok: false, error: e.code, detail: e.message });
    } else {
      writeJson(res, 500, { ok: false, error: 'executor_fatal', detail: e?.message || String(e) });
    }
    return true;
  }
}
