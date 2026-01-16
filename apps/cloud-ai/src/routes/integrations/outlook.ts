import type { IncomingMessage, ServerResponse } from 'http';
import { randomUUID, createHmac } from 'crypto';
import { upsertExternalAccount, getExternalAccount } from '../../supabase';
import { authenticateHttpLegacy, sendAuthError } from '../../auth/http';
import { AuthErrorCode } from '../../auth';
import { PUBLIC_BASE_URL, WEBSITE_BASE_URL, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_TENANT, MS_REDIRECT_PATH, INTEGRATION_STATE_SECRET } from '../../utils/config';

export async function handleOutlookRoutes(req: IncomingMessage, res: ServerResponse, parsedUrl: URL): Promise<boolean> {
  if (req.method === 'GET' && parsedUrl.pathname === '/integrations/outlook/status') {
    try {
      const authResult = await authenticateHttpLegacy(req, parsedUrl);
      if (!authResult.success || !authResult.userId) {
        sendAuthError(res, authResult.error || AuthErrorCode.UNAUTHORIZED, authResult.message);
        return true;
      }
      const authUser = { userId: authResult.userId, email: authResult.email };
      let connected = false;
      try { const acc = await getExternalAccount(authUser.userId, 'outlook'); connected = !!acc; } catch {}
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

  if (req.method === 'GET' && parsedUrl.pathname === '/integrations/outlook/connect') {
    try {
      const authResult = await authenticateHttpLegacy(req, parsedUrl);
      if (!authResult.success || !authResult.userId) {
        sendAuthError(res, authResult.error || AuthErrorCode.UNAUTHORIZED, authResult.message);
        return true;
      }
      const authUser = { userId: authResult.userId, email: authResult.email };
      if (!PUBLIC_BASE_URL || !MS_CLIENT_ID || !MS_CLIENT_SECRET) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: false, error: 'server_not_configured' }));
        return true;
      }
      const redirectUri = `${PUBLIC_BASE_URL}${MS_REDIRECT_PATH}`;
      const nonce = randomUUID();
      const payload = `outlook:${authUser.userId}:${nonce}`;
      const sig = createHmac('sha256', INTEGRATION_STATE_SECRET).update(payload).digest('hex');
      const state = Buffer.from(`${payload}:${sig}`).toString('base64url');
      const scopes = (process.env.MS_SCOPES || 'openid profile offline_access User.Read Mail.Read Mail.Send').split(',').map(s => s.trim()).filter(Boolean).join(' ');
      const authorize = new URL(`https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0/authorize`);
      authorize.searchParams.set('client_id', MS_CLIENT_ID);
      authorize.searchParams.set('redirect_uri', redirectUri);
      authorize.searchParams.set('scope', scopes);
      authorize.searchParams.set('state', state);
      authorize.searchParams.set('response_type', 'code');
      res.writeHead(302, { Location: authorize.toString(), 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
      res.end();
      return true;
    } catch (e: any) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: false, error: 'internal_error', message: e?.message || 'failed' }));
      return true;
    }
  }

  if (req.method === 'GET' && parsedUrl.pathname === MS_REDIRECT_PATH) {
    try {
      const code = parsedUrl.searchParams.get('code') || '';
      const stateRaw = parsedUrl.searchParams.get('state') || '';
      const error = parsedUrl.searchParams.get('error') || '';
      if (error) {
        const errorDesc = parsedUrl.searchParams.get('error_description') || error;
        res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=outlook&message=${encodeURIComponent(String(errorDesc))}`, 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }
      if (!code || !stateRaw) {
        res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=outlook&message=Missing code or state`, 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }
      let decoded = '';
      try { decoded = Buffer.from(stateRaw, 'base64url').toString('utf8'); } catch {}
      const parts = decoded.split(':');
      if (parts.length < 4) {
        res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=outlook&message=Invalid state`, 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }
      const provider = parts[0];
      const userId = parts[1];
      const nonce = parts[2];
      const sig = parts[3];
      const payload = `${provider}:${userId}:${nonce}`;
      const expect = createHmac('sha256', INTEGRATION_STATE_SECRET).update(payload).digest('hex');
      if (provider !== 'outlook' || sig !== expect) {
        res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=outlook&message=State verification failed`, 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }
      const redirectUri = `${PUBLIC_BASE_URL}${MS_REDIRECT_PATH}`;
      const tokenUrl = `https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0/token`;
      const tokenParams = new URLSearchParams();
      tokenParams.set('client_id', MS_CLIENT_ID);
      tokenParams.set('client_secret', MS_CLIENT_SECRET);
      tokenParams.set('grant_type', 'authorization_code');
      tokenParams.set('code', code);
      tokenParams.set('redirect_uri', redirectUri);
      const tokenRes = await fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: tokenParams.toString() });
      const tokenBody: any = await (async () => { try { return await tokenRes.json(); } catch { return null; } })();
      if (!tokenRes.ok || !tokenBody?.access_token) {
        const msg = tokenBody?.error_description || tokenBody?.error || `${tokenRes.status} ${tokenRes.statusText}`;
        res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=outlook&message=${encodeURIComponent('Token exchange failed: ' + msg)}`, 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }
      const access_token = String(tokenBody.access_token);
      const refresh_token = String(tokenBody.refresh_token || '');
      const expiresIn = Number(tokenBody.expires_in || 3600);
      const expires_at = new Date(Date.now() + expiresIn * 1000).toISOString();
      const scopeStr = String(tokenBody.scope || '');
      const scopes = scopeStr ? scopeStr.split(' ').map((s: string) => s.trim()).filter(Boolean) : [];
      try { await upsertExternalAccount({ userId, provider: 'outlook', access_token, scopes, refresh_token: refresh_token || null, expires_at, meta: { token_type: tokenBody.token_type || 'Bearer' } }); } catch {}
      let okSaved = false;
      try { const acc = await getExternalAccount(userId, 'outlook'); okSaved = !!acc; } catch { okSaved = false; }
      if (!okSaved) {
        res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=outlook&message=${encodeURIComponent('Could not save token. Ensure server is configured.')}`, 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }
      res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/success?provider=outlook`, 'Cache-Control': 'no-store' });
      res.end();
      return true;
    } catch (e: any) {
      res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=outlook&message=${encodeURIComponent('Internal error: ' + (e?.message || 'failed'))}`, 'Cache-Control': 'no-store' });
      res.end();
      return true;
    }
  }

  return false;
}
