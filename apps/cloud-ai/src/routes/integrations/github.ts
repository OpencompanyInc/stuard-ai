import type { IncomingMessage, ServerResponse } from 'http';
import { randomUUID, createHmac } from 'crypto';
import { upsertExternalAccount, getExternalAccount } from '../../supabase';
import { authenticateHttpLegacy, sendAuthError } from '../../auth/http';
import { AuthErrorCode } from '../../auth';
import { PUBLIC_BASE_URL, WEBSITE_BASE_URL, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_REDIRECT_PATH, INTEGRATION_STATE_SECRET } from '../../utils/config';

export async function handleGithubRoutes(req: IncomingMessage, res: ServerResponse, parsedUrl: URL): Promise<boolean> {
  if (req.method === 'GET' && parsedUrl.pathname === '/integrations/github/status') {
    try {
      const authResult = await authenticateHttpLegacy(req, parsedUrl);
      if (!authResult.success || !authResult.userId) {
        sendAuthError(res, authResult.error || AuthErrorCode.UNAUTHORIZED, authResult.message);
        return true;
      }
      const authUser = { userId: authResult.userId, email: authResult.email };
      let connected = false;
      try { const acc = await getExternalAccount(authUser.userId, 'github'); connected = !!acc; } catch {}
      const body = JSON.stringify({ ok: true, connected });
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(body);
      return true;
    } catch (e: any) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: false, error: 'internal_error', message: e?.message || 'failed' }));
      return true;
    }
  }

  if (req.method === 'GET' && parsedUrl.pathname === '/integrations/github/connect') {
    try {
      const authResult = await authenticateHttpLegacy(req, parsedUrl);
      if (!authResult.success || !authResult.userId) {
        sendAuthError(res, authResult.error || AuthErrorCode.UNAUTHORIZED, authResult.message);
        return true;
      }
      const authUser = { userId: authResult.userId, email: authResult.email };
      if (!PUBLIC_BASE_URL || !GITHUB_CLIENT_ID) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: false, error: 'server_not_configured' }));
        return true;
      }
      const redirectUri = `${PUBLIC_BASE_URL}${GITHUB_REDIRECT_PATH}`;
      const nonce = randomUUID();
      const payload = `github:${authUser.userId}:${nonce}`;
      const sig = createHmac('sha256', INTEGRATION_STATE_SECRET).update(payload).digest('hex');
      const state = Buffer.from(`${payload}:${sig}`).toString('base64url');
      const scopes = (process.env.GITHUB_SCOPES || 'read:user,repo').split(',').map(s => s.trim()).filter(Boolean).join(' ');
      const authorize = new URL('https://github.com/login/oauth/authorize');
      authorize.searchParams.set('client_id', GITHUB_CLIENT_ID);
      authorize.searchParams.set('redirect_uri', redirectUri);
      authorize.searchParams.set('scope', scopes);
      authorize.searchParams.set('state', state);
      authorize.searchParams.set('allow_signup', 'false');
      res.writeHead(302, { Location: authorize.toString(), 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
      res.end();
      return true;
    } catch (e: any) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: false, error: 'internal_error', message: e?.message || 'failed' }));
      return true;
    }
  }

  if (req.method === 'GET' && parsedUrl.pathname === GITHUB_REDIRECT_PATH) {
    try {
      const code = parsedUrl.searchParams.get('code') || '';
      const stateRaw = parsedUrl.searchParams.get('state') || '';
      if (!code || !stateRaw) {
        res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=github&message=Missing code or state`, 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }
      let decoded = '';
      try { decoded = Buffer.from(stateRaw, 'base64url').toString('utf8'); } catch {}
      const parts = decoded.split(':');
      if (parts.length < 4) {
        res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=github&message=Invalid state`, 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }
      const provider = parts[0];
      const userId = parts[1];
      const nonce = parts[2];
      const sig = parts[3];
      const payload = `${provider}:${userId}:${nonce}`;
      const expect = createHmac('sha256', INTEGRATION_STATE_SECRET).update(payload).digest('hex');
      if (provider !== 'github' || sig !== expect) {
        res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=github&message=State verification failed`, 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }
      const redirectUri = `${PUBLIC_BASE_URL}${GITHUB_REDIRECT_PATH}`;
      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, client_secret: GITHUB_CLIENT_SECRET, code, redirect_uri: redirectUri, state: stateRaw }),
      });
      const tokenBody: any = await (async () => { try { return await tokenRes.json(); } catch { return null; } })();
      if (!tokenRes.ok || !tokenBody?.access_token) {
        const msg = tokenBody?.error_description || tokenBody?.error || `${tokenRes.status} ${tokenRes.statusText}`;
        res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=github&message=${encodeURIComponent('Token exchange failed: ' + msg)}`, 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }
      const access_token = String(tokenBody.access_token);
      const scopeStr = String(tokenBody.scope || '');
      const scopes = scopeStr ? scopeStr.split(',').map((s: string) => s.trim()).filter(Boolean) : [];
      try { await upsertExternalAccount({ userId, provider: 'github', access_token, scopes, refresh_token: null, expires_at: null, meta: { token_type: tokenBody.token_type || 'bearer' } }); } catch {}
      let okSaved = false;
      try { const acc = await getExternalAccount(userId, 'github'); okSaved = !!acc; } catch { okSaved = false; }
      if (!okSaved) {
        res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=github&message=${encodeURIComponent('Could not save token. Ensure server is configured.')}`, 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }
      res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/success?provider=github`, 'Cache-Control': 'no-store' });
      res.end();
      return true;
    } catch (e: any) {
      res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=github&message=${encodeURIComponent('Internal error: ' + (e?.message || 'failed'))}`, 'Cache-Control': 'no-store' });
      res.end();
      return true;
    }
  }

  return false;
}
