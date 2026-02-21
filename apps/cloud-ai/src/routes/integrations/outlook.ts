import type { IncomingMessage, ServerResponse } from 'http';
import { randomUUID, createHmac } from 'crypto';
import { upsertExternalAccount, getExternalAccount, listExternalAccounts } from '../../supabase';
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
      const userId = authResult.userId;
      const profileLabel = parsedUrl.searchParams.get('profile') || undefined;

      // List all profiles
      if (parsedUrl.searchParams.get('profiles') === '1') {
        const accounts = await listExternalAccounts(userId, 'outlook');
        const profiles = accounts.map(a => ({
          profile: a.profile_label,
          isDefault: a.is_default,
          email: a.account_email || null,
          scopes: a.scopes,
          connected: true,
        }));
        const body = JSON.stringify({ ok: true, profiles });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
        res.end(body);
        return true;
      }

      let connected = false;
      let acc: any = null;
      try { acc = await getExternalAccount(userId, 'outlook', profileLabel); connected = !!acc; } catch {}
      const body = JSON.stringify({
        ok: true,
        connected,
        profile: acc?.profile_label || null,
        isDefault: acc?.is_default ?? null,
        email: acc?.account_email || null,
      });
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
      const userId = authResult.userId;
      if (!PUBLIC_BASE_URL || !MS_CLIENT_ID || !MS_CLIENT_SECRET) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: false, error: 'server_not_configured' }));
        return true;
      }

      const profileLabel = parsedUrl.searchParams.get('profile') || 'default';
      const redirectUri = `${PUBLIC_BASE_URL}${MS_REDIRECT_PATH}`;

      // State: outlook:{userId}:{nonce}:{profileLabel}:{sig}
      const nonce = randomUUID();
      const payload = `outlook:${userId}:${nonce}:${profileLabel}`;
      const sig = createHmac('sha256', INTEGRATION_STATE_SECRET).update(payload).digest('hex');
      const state = Buffer.from(`${payload}:${sig}`).toString('base64url');

      const scopes = (process.env.MS_SCOPES || 'openid profile offline_access User.Read Mail.Read Mail.Send').split(',').map(s => s.trim()).filter(Boolean).join(' ');
      const authorize = new URL(`https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0/authorize`);
      authorize.searchParams.set('client_id', MS_CLIENT_ID);
      authorize.searchParams.set('redirect_uri', redirectUri);
      authorize.searchParams.set('scope', scopes);
      authorize.searchParams.set('state', state);
      authorize.searchParams.set('response_type', 'code');

      // For new profiles, prompt account selection
      if (profileLabel !== 'default') {
        authorize.searchParams.set('prompt', 'select_account');
      }

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

      // New: outlook:{userId}:{nonce}:{profileLabel}:{sig} (5 parts)
      // Old: outlook:{userId}:{nonce}:{sig} (4 parts)
      let provider: string, userId: string, nonce: string, profileLabel: string, sig: string;
      if (parts.length >= 5) {
        provider = parts[0]; userId = parts[1]; nonce = parts[2]; profileLabel = parts[3]; sig = parts[4];
      } else if (parts.length === 4) {
        provider = parts[0]; userId = parts[1]; nonce = parts[2]; profileLabel = 'default'; sig = parts[3];
      } else {
        res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=outlook&message=Invalid state`, 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }

      const newPayload = `${provider}:${userId}:${nonce}:${profileLabel}`;
      const expectNew = createHmac('sha256', INTEGRATION_STATE_SECRET).update(newPayload).digest('hex');
      const oldPayload = `${provider}:${userId}:${nonce}`;
      const expectOld = createHmac('sha256', INTEGRATION_STATE_SECRET).update(oldPayload).digest('hex');

      if (provider !== 'outlook' || (sig !== expectNew && sig !== expectOld)) {
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

      // Fetch Microsoft user email for display
      let accountEmail: string | null = null;
      try {
        const meRes = await fetch('https://graph.microsoft.com/v1.0/me', {
          headers: { Authorization: `Bearer ${access_token}` },
        });
        const me: any = await (async () => { try { return await meRes.json(); } catch { return null; } })();
        accountEmail = String(me?.mail || me?.userPrincipalName || '') || null;
      } catch {}

      try { await upsertExternalAccount({ userId, provider: 'outlook', access_token, scopes, refresh_token: refresh_token || null, expires_at, meta: { token_type: tokenBody.token_type || 'Bearer' }, profileLabel, accountEmail }); } catch (saveErr: any) {
        console.error('[outlook] Failed to save token:', saveErr?.message || saveErr);
        res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=outlook&message=${encodeURIComponent('Could not save token: ' + (saveErr?.message || 'database error'))}`, 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }
      res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/success?provider=outlook&profile=${encodeURIComponent(profileLabel)}`, 'Cache-Control': 'no-store' });
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
