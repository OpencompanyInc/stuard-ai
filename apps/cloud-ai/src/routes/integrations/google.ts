import type { IncomingMessage, ServerResponse } from 'http';
import { randomUUID, createHmac } from 'crypto';
import { upsertExternalAccount, getExternalAccount } from '../../supabase';
import { authenticateHttpLegacy, requireAuth, sendJson, sendAuthError } from '../../auth/http';
import { AuthErrorCode } from '../../auth';
import { PUBLIC_BASE_URL, WEBSITE_BASE_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_PATH, INTEGRATION_STATE_SECRET } from '../../utils/config';

export async function handleGoogleRoutes(req: IncomingMessage, res: ServerResponse, parsedUrl: URL): Promise<boolean> {
  // Status - prefer header auth, but allow legacy query param for migration
  if (req.method === 'GET' && parsedUrl.pathname === '/integrations/google/status') {
    try {
      const authResult = await authenticateHttpLegacy(req, parsedUrl);
      if (!authResult.success || !authResult.userId) {
        sendAuthError(res, authResult.error || AuthErrorCode.UNAUTHORIZED, authResult.message);
        return true;
      }
      const authUser = { userId: authResult.userId, email: authResult.email };
      let acc: any = null;
      let connected = false;
      try { acc = await getExternalAccount(authUser.userId, 'google'); connected = !!acc; } catch {}
      const target = parsedUrl.searchParams.get('target') || '';
      const rawScopes = parsedUrl.searchParams.get('scopes') || '';
      const normalize = (str: string) => str.split(/[ ,]+/).map(s => s.trim()).filter(Boolean);
      const scopesForTarget = (t: string): string[] => {
        switch ((t || '').toLowerCase()) {
          case 'drive': return ['https://www.googleapis.com/auth/drive.readonly'];
          case 'calendar': return ['https://www.googleapis.com/auth/calendar.events'];
          case 'gmail': return ['https://www.googleapis.com/auth/gmail.modify'];
          case 'tasks': return ['https://www.googleapis.com/auth/tasks'];
          case 'sheets': return ['https://www.googleapis.com/auth/spreadsheets.readonly'];
          case 'docs': return ['https://www.googleapis.com/auth/documents.readonly'];
          default: return [];
        }
      };
      const required = rawScopes ? normalize(rawScopes) : scopesForTarget(target);
      let hasScopes = connected;
      let missingScopes: string[] = [];
      try {
        const accScopes = Array.isArray(acc?.scopes) ? acc.scopes.map((s: any) => String(s)) : [];
        if (required.length > 0) {
          hasScopes = required.every((s) => accScopes.includes(s));
          missingScopes = required.filter((s) => !accScopes.includes(s));
        }
      } catch {}
      const body = JSON.stringify({ ok: true, connected: (required.length > 0 ? hasScopes : connected), hasScopes, missingScopes });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
      res.end(body);
      return true;
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: false, error: 'internal_error' }));
      return true;
    }
  }

  // Connect - requires query param token for browser redirect flow
  if (req.method === 'GET' && parsedUrl.pathname === '/integrations/google/connect') {
    try {
      const authResult = await authenticateHttpLegacy(req, parsedUrl);
      if (!authResult.success || !authResult.userId) {
        sendAuthError(res, authResult.error || AuthErrorCode.UNAUTHORIZED, authResult.message);
        return true;
      }
      const authUser = { userId: authResult.userId, email: authResult.email };
      if (!PUBLIC_BASE_URL || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: false, error: 'server_not_configured' }));
        return true;
      }
      const redirectUri = `${PUBLIC_BASE_URL}${GOOGLE_REDIRECT_PATH}`;
      const nonce = randomUUID();
      const payload = `google:${authUser.userId}:${nonce}`;
      const sig = createHmac('sha256', INTEGRATION_STATE_SECRET).update(payload).digest('hex');
      const state = Buffer.from(`${payload}:${sig}`).toString('base64url');
      const target = parsedUrl.searchParams.get('target') || '';
      const rawScopes = parsedUrl.searchParams.get('scopes') || '';
      const normalize = (str: string) => str.split(/[ ,]+/).map(s => s.trim()).filter(Boolean);
      const scopesForTarget = (t: string): string[] => {
        switch ((t || '').toLowerCase()) {
          case 'drive': return ['https://www.googleapis.com/auth/drive.readonly'];
          case 'calendar': return ['https://www.googleapis.com/auth/calendar.events'];
          case 'gmail': return ['https://www.googleapis.com/auth/gmail.modify'];
          case 'tasks': return ['https://www.googleapis.com/auth/tasks'];
          case 'sheets': return ['https://www.googleapis.com/auth/spreadsheets.readonly'];
          case 'docs': return ['https://www.googleapis.com/auth/documents.readonly'];
          default: return [];
        }
      };
      const identity = (process.env.GOOGLE_SCOPES || 'openid email profile https://www.googleapis.com/auth/userinfo.email')
        .split(',').map(s => s.trim()).filter(Boolean);
      let scopeList = rawScopes ? normalize(rawScopes) : scopesForTarget(target);
      scopeList = Array.from(new Set([ ...identity, ...scopeList ]));
      const scopes = scopeList.join(' ');
      const authorize = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authorize.searchParams.set('client_id', GOOGLE_CLIENT_ID);
      authorize.searchParams.set('redirect_uri', redirectUri);
      authorize.searchParams.set('response_type', 'code');
      authorize.searchParams.set('scope', scopes);
      authorize.searchParams.set('state', state);
      authorize.searchParams.set('access_type', 'offline');
      authorize.searchParams.set('include_granted_scopes', 'true');
      authorize.searchParams.set('prompt', 'consent');
      res.writeHead(302, { Location: authorize.toString(), 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
      res.end();
      return true;
    } catch (e: any) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: false, error: 'internal_error', message: e?.message || 'failed' }));
      return true;
    }
  }

  // Redirect callback
  if (req.method === 'GET' && parsedUrl.pathname === GOOGLE_REDIRECT_PATH) {
    try {
      const code = parsedUrl.searchParams.get('code') || '';
      const stateRaw = parsedUrl.searchParams.get('state') || '';
      if (!code || !stateRaw) {
        res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=google&message=Missing code or state`, 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }
      let decoded = '';
      try { decoded = Buffer.from(stateRaw, 'base64url').toString('utf8'); } catch {}
      const parts = decoded.split(':');
      if (parts.length < 4) {
        res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=google&message=Invalid state`, 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }
      const provider = parts[0];
      const userId = parts[1];
      const nonce = parts[2];
      const sig = parts[3];
      const payload = `${provider}:${userId}:${nonce}`;
      const expect = createHmac('sha256', INTEGRATION_STATE_SECRET).update(payload).digest('hex');
      if (provider !== 'google' || sig !== expect) {
        res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=google&message=State verification failed`, 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }
      const redirectUri = `${PUBLIC_BASE_URL}${GOOGLE_REDIRECT_PATH}`;
      const tokenUrl = 'https://oauth2.googleapis.com/token';
      const tokenParams = new URLSearchParams();
      tokenParams.set('client_id', GOOGLE_CLIENT_ID);
      tokenParams.set('client_secret', GOOGLE_CLIENT_SECRET);
      tokenParams.set('grant_type', 'authorization_code');
      tokenParams.set('code', code);
      tokenParams.set('redirect_uri', redirectUri);
      const tokenRes = await fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: tokenParams.toString() });
      const tokenBody: any = await (async () => { try { return await tokenRes.json(); } catch { return null; } })();
      if (!tokenRes.ok || !tokenBody?.access_token) {
        const msg = tokenBody?.error_description || tokenBody?.error || `${tokenRes.status} ${tokenRes.statusText}`;
        res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=google&message=${encodeURIComponent('Token exchange failed: ' + msg)}`, 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }
      const access_token = String(tokenBody.access_token);
      const refresh_token = String(tokenBody.refresh_token || '');
      const expiresIn = Number(tokenBody.expires_in || 3600);
      const expires_at = new Date(Date.now() + expiresIn * 1000).toISOString();
      const scopeStr = String(tokenBody.scope || '');
      let scopes = scopeStr ? scopeStr.split(' ').map((s: string) => s.trim()).filter(Boolean) : [];
      // Some Google token responses omit the scope field when unchanged. Attempt to fetch granted scopes.
      if (scopes.length === 0 && access_token) {
        try {
          const infoRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(access_token)}`);
          const info: any = await (async () => { try { return await infoRes.json(); } catch { return null; } })();
          const infoScope = String(info?.scope || '');
          if (infoRes.ok && infoScope) {
            scopes = infoScope.split(' ').map((s: string) => s.trim()).filter(Boolean);
          }
        } catch {}
      }
      try { await upsertExternalAccount({ userId, provider: 'google', access_token, scopes, refresh_token: refresh_token || null, expires_at, meta: { token_type: tokenBody.token_type || 'Bearer' } }); } catch {}
      let okSaved = false;
      try { const acc = await getExternalAccount(userId, 'google'); okSaved = !!acc; } catch { okSaved = false; }
      if (!okSaved) {
        res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=google&message=${encodeURIComponent('Could not save token. Ensure server is configured.')}`, 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }
      res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/success?provider=google`, 'Cache-Control': 'no-store' });
      res.end();
      return true;
    } catch (e: any) {
      res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=google&message=${encodeURIComponent('Internal error: ' + (e?.message || 'failed'))}`, 'Cache-Control': 'no-store' });
      res.end();
      return true;
    }
  }

  return false;
}
