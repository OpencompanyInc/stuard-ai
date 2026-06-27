import type { IncomingMessage, ServerResponse } from 'http';
import { listExternalAccounts, setDefaultExternalAccount, deleteExternalAccount } from '../../supabase';
import { authenticateHttpLegacy, sendAuthError } from '../../auth/http';
import { AuthErrorCode } from '../../auth';

/**
 * Profile management endpoints:
 *   GET  /integrations/profiles?provider=google          — list all profiles for a provider
 *   GET  /integrations/profiles                          — list all profiles for ALL providers
 *   POST /integrations/profiles/default                  — set default profile  { provider, profile }
 *   DELETE /integrations/profiles?provider=google&profile=work — delete a profile
 */
export async function handleProfileRoutes(req: IncomingMessage, res: ServerResponse, parsedUrl: URL): Promise<boolean> {
  // Only handle /integrations/profiles paths
  if (!parsedUrl.pathname.startsWith('/integrations/profiles')) return false;

  const cors = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };

  // CORS preflight
  if (req.method === 'OPTIONS' && parsedUrl.pathname.startsWith('/integrations/profiles')) {
    res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Authorization,Content-Type' });
    res.end();
    return true;
  }

  // ── LIST PROFILES ────────────────────────────────────────────────────────
  if (req.method === 'GET' && parsedUrl.pathname === '/integrations/profiles') {
    try {
      const authResult = await authenticateHttpLegacy(req, parsedUrl);
      if (!authResult.success || !authResult.userId) {
        sendAuthError(res, authResult.error || AuthErrorCode.UNAUTHORIZED, authResult.message);
        return true;
      }
      const provider = parsedUrl.searchParams.get('provider') || undefined;
      const accounts = await listExternalAccounts(authResult.userId, provider);

      const profiles = accounts.map(a => ({
        provider: a.provider,
        profile: a.profile_label,
        isDefault: a.is_default,
        email: a.account_email || null,
        scopes: a.scopes,
        connected: true,
      }));

      const body = JSON.stringify({ ok: true, profiles });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...cors });
      res.end(body);
      return true;
    } catch (e: any) {
      res.writeHead(500, { 'Content-Type': 'application/json', ...cors });
      res.end(JSON.stringify({ ok: false, error: 'internal_error', message: e?.message || 'failed' }));
      return true;
    }
  }

  // ── SET DEFAULT ──────────────────────────────────────────────────────────
  if (req.method === 'POST' && parsedUrl.pathname === '/integrations/profiles/default') {
    try {
      const authResult = await authenticateHttpLegacy(req, parsedUrl);
      if (!authResult.success || !authResult.userId) {
        sendAuthError(res, authResult.error || AuthErrorCode.UNAUTHORIZED, authResult.message);
        return true;
      }

      // Parse JSON body
      const rawBody = await new Promise<string>((resolve) => {
        let data = '';
        req.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        req.on('end', () => resolve(data));
      });
      let parsed: any = {};
      try { parsed = JSON.parse(rawBody); } catch {}
      const provider = String(parsed?.provider || '').trim();
      const profileLabel = String(parsed?.profile || '').trim();

      if (!provider || !profileLabel) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...cors });
        res.end(JSON.stringify({ ok: false, error: 'missing_params', message: 'provider and profile are required' }));
        return true;
      }

      const ok = await setDefaultExternalAccount(authResult.userId, provider, profileLabel);
      const body = JSON.stringify({ ok });
      res.writeHead(ok ? 200 : 500, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...cors });
      res.end(body);
      return true;
    } catch (e: any) {
      res.writeHead(500, { 'Content-Type': 'application/json', ...cors });
      res.end(JSON.stringify({ ok: false, error: 'internal_error', message: e?.message || 'failed' }));
      return true;
    }
  }

  // ── DELETE PROFILE ───────────────────────────────────────────────────────
  if (req.method === 'DELETE' && parsedUrl.pathname === '/integrations/profiles') {
    try {
      const authResult = await authenticateHttpLegacy(req, parsedUrl);
      if (!authResult.success || !authResult.userId) {
        sendAuthError(res, authResult.error || AuthErrorCode.UNAUTHORIZED, authResult.message);
        return true;
      }

      const provider = parsedUrl.searchParams.get('provider') || '';
      const profileLabel = parsedUrl.searchParams.get('profile') || '';

      if (!provider || !profileLabel) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...cors });
        res.end(JSON.stringify({ ok: false, error: 'missing_params', message: 'provider and profile query params required' }));
        return true;
      }

      const ok = await deleteExternalAccount(authResult.userId, provider, profileLabel);
      const body = JSON.stringify({ ok });
      res.writeHead(ok ? 200 : 500, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...cors });
      res.end(body);
      return true;
    } catch (e: any) {
      res.writeHead(500, { 'Content-Type': 'application/json', ...cors });
      res.end(JSON.stringify({ ok: false, error: 'internal_error', message: e?.message || 'failed' }));
      return true;
    }
  }

  return false;
}
