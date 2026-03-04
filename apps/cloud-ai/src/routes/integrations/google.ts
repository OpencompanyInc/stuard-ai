import type { IncomingMessage, ServerResponse } from 'http';
import { randomUUID, createHmac } from 'crypto';
import { upsertExternalAccount, getExternalAccount, listExternalAccounts } from '../../supabase';
import { authenticateHttpLegacy, requireAuth, sendJson, sendAuthError } from '../../auth/http';
import { AuthErrorCode } from '../../auth';
import { PUBLIC_BASE_URL, WEBSITE_BASE_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_PATH, INTEGRATION_STATE_SECRET } from '../../utils/config';
import { handleGoogleNativeTriggerRoutes } from './google-native-triggers';

// ---------------------------------------------------------------------------
// Granular scope mapping — each target gets ONLY its own scopes.
// When you enable Sheets, you only get spreadsheets permission.
// When you enable Drive, you only get drive permission. Etc.
// ---------------------------------------------------------------------------
const SCOPE_MAP: Record<string, string[]> = {
  drive:    ['https://www.googleapis.com/auth/drive'],
  calendar: ['https://www.googleapis.com/auth/calendar.events'],
  gmail:    ['https://www.googleapis.com/auth/gmail.modify'],
  tasks:    ['https://www.googleapis.com/auth/tasks'],
  sheets:   ['https://www.googleapis.com/auth/spreadsheets'],
  docs:     ['https://www.googleapis.com/auth/documents'],
};

function scopesForTarget(target: string): string[] {
  return SCOPE_MAP[(target || '').toLowerCase()] || [];
}

const normalize = (str: string) => str.split(/[ ,]+/).map(s => s.trim()).filter(Boolean);

export async function handleGoogleRoutes(req: IncomingMessage, res: ServerResponse, parsedUrl: URL): Promise<boolean> {
  if (await handleGoogleNativeTriggerRoutes(req, res, parsedUrl)) return true;

  // Status - prefer header auth, but allow legacy query param for migration
  if (req.method === 'GET' && parsedUrl.pathname === '/integrations/google/status') {
    try {
      const authResult = await authenticateHttpLegacy(req, parsedUrl);
      if (!authResult.success || !authResult.userId) {
        sendAuthError(res, authResult.error || AuthErrorCode.UNAUTHORIZED, authResult.message);
        return true;
      }
      const userId = authResult.userId;

      const target = parsedUrl.searchParams.get('target') || '';
      const rawScopes = parsedUrl.searchParams.get('scopes') || '';
      const profileLabel = parsedUrl.searchParams.get('profile') || undefined;

      // If ?profiles=1, return all connected profiles for Google
      if (parsedUrl.searchParams.get('profiles') === '1') {
        const accounts = await listExternalAccounts(userId, 'google');
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

      let acc: any = null;
      let connected = false;
      try { acc = await getExternalAccount(userId, 'google', profileLabel); connected = !!acc; } catch {}

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

      const body = JSON.stringify({
        ok: true,
        // A Google account is considered connected if the account exists AND
        // has the required scopes. But `accountConnected` tells the frontend
        // the account itself is linked (even if this specific product's scopes
        // haven't been granted yet), avoiding the confusing "disconnected" state.
        connected: hasScopes,
        accountConnected: connected,
        hasScopes,
        missingScopes,
        grantedScopes: Array.isArray(acc?.scopes) ? acc.scopes : [],
        profile: acc?.profile_label || null,
        isDefault: acc?.is_default ?? null,
        email: acc?.account_email || null,
      });
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
      const userId = authResult.userId;
      if (!PUBLIC_BASE_URL || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: false, error: 'server_not_configured' }));
        return true;
      }

      const redirectUri = `${PUBLIC_BASE_URL}${GOOGLE_REDIRECT_PATH}`;
      const target = parsedUrl.searchParams.get('target') || '';
      const rawScopes = parsedUrl.searchParams.get('scopes') || '';
      const profileLabel = parsedUrl.searchParams.get('profile') || 'default';

      // Build state: google:{userId}:{nonce}:{profileLabel}:{sig}
      const nonce = randomUUID();
      const payload = `google:${userId}:${nonce}:${profileLabel}`;
      const sig = createHmac('sha256', INTEGRATION_STATE_SECRET).update(payload).digest('hex');
      const state = Buffer.from(`${payload}:${sig}`).toString('base64url');

      // Identity scopes (always needed for email/profile)
      const identity = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/userinfo.email'];

      // Build ONLY the scopes for the requested target — nothing more
      let targetScopes = rawScopes ? normalize(rawScopes) : scopesForTarget(target);
      const scopeList = Array.from(new Set([...identity, ...targetScopes]));
      const scopes = scopeList.join(' ');

      const authorize = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authorize.searchParams.set('client_id', GOOGLE_CLIENT_ID);
      authorize.searchParams.set('redirect_uri', redirectUri);
      authorize.searchParams.set('response_type', 'code');
      authorize.searchParams.set('scope', scopes);
      authorize.searchParams.set('state', state);
      authorize.searchParams.set('access_type', 'offline');
      // Include previously-granted scopes so reconnecting for a new product
      // doesn't revoke existing scopes (e.g. Drive when adding Gmail)
      authorize.searchParams.set('include_granted_scopes', 'true');

      // For new non-default profiles, select_account lets the user pick
      // which Google account to link. consent ensures refresh token.
      if (profileLabel !== 'default') {
        authorize.searchParams.set('prompt', 'select_account consent');
      } else {
        authorize.searchParams.set('prompt', 'consent');
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

  // Redirect callback
  if (req.method === 'GET' && parsedUrl.pathname === GOOGLE_REDIRECT_PATH) {
    try {
      // Handle OAuth error responses (e.g. user denied access, redirect_uri mismatch)
      const oauthError = parsedUrl.searchParams.get('error') || '';
      if (oauthError) {
        const oauthErrorDesc = parsedUrl.searchParams.get('error_description') || oauthError;
        console.warn('[google] OAuth error:', oauthError, oauthErrorDesc);
        res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=google&message=${encodeURIComponent(oauthErrorDesc)}`, 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }
      const code = parsedUrl.searchParams.get('code') || '';
      const stateRaw = parsedUrl.searchParams.get('state') || '';
      if (!code || !stateRaw) {
        console.warn('[google] Callback missing code or state. Query:', parsedUrl.search);
        res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=google&message=Missing code or state`, 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }
      let decoded = '';
      try { decoded = Buffer.from(stateRaw, 'base64url').toString('utf8'); } catch {}
      const parts = decoded.split(':');

      // New format: google:{userId}:{nonce}:{profileLabel}:{sig} (5 parts)
      // Old format: google:{userId}:{nonce}:{sig} (4 parts) — backward compat
      let provider: string, userId: string, nonce: string, profileLabel: string, sig: string;
      if (parts.length >= 5) {
        provider = parts[0]; userId = parts[1]; nonce = parts[2]; profileLabel = parts[3]; sig = parts[4];
      } else if (parts.length === 4) {
        provider = parts[0]; userId = parts[1]; nonce = parts[2]; profileLabel = 'default'; sig = parts[3];
      } else {
        res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=google&message=Invalid state`, 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }

      // Verify HMAC against new format first, then old for backward compat
      const newPayload = `${provider}:${userId}:${nonce}:${profileLabel}`;
      const expectNew = createHmac('sha256', INTEGRATION_STATE_SECRET).update(newPayload).digest('hex');
      const oldPayload = `${provider}:${userId}:${nonce}`;
      const expectOld = createHmac('sha256', INTEGRATION_STATE_SECRET).update(oldPayload).digest('hex');

      if (provider !== 'google' || (sig !== expectNew && sig !== expectOld)) {
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

      // Fetch granted scopes if token response omitted them
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

      // Fetch the Google account email so we can display it in the UI
      let accountEmail: string | null = null;
      try {
        const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${access_token}` },
        });
        const userInfo: any = await (async () => { try { return await userInfoRes.json(); } catch { return null; } })();
        accountEmail = String(userInfo?.email || '') || null;
      } catch {}

      // ─── Merge scopes with existing ones so connecting a new Google product
      //     doesn't wipe out scopes from previously-connected products ───
      let mergedScopes = scopes;
      let finalRefreshToken = refresh_token || null;
      try {
        const existing = await getExternalAccount(userId, 'google', profileLabel);
        if (existing) {
          const existingScopes = Array.isArray(existing.scopes) ? existing.scopes.map(String) : [];
          mergedScopes = Array.from(new Set([...existingScopes, ...scopes]));
          // Preserve the existing refresh token if Google didn't return a new one
          if (!finalRefreshToken && existing.refresh_token) {
            finalRefreshToken = existing.refresh_token;
          }
        }
      } catch {}

      try { await upsertExternalAccount({ userId, provider: 'google', access_token, scopes: mergedScopes, refresh_token: finalRefreshToken, expires_at, meta: { token_type: tokenBody.token_type || 'Bearer' }, profileLabel, accountEmail }); } catch (saveErr: any) {
        console.error('[google] Failed to save token:', saveErr?.message || saveErr);
        res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=google&message=${encodeURIComponent('Could not save token: ' + (saveErr?.message || 'database error'))}`, 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }
      res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/success?provider=google&profile=${encodeURIComponent(profileLabel)}`, 'Cache-Control': 'no-store' });
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
