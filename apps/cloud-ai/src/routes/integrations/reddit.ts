import type { IncomingMessage, ServerResponse } from 'http';
import { randomUUID, createHmac } from 'crypto';
import { upsertExternalAccount, getExternalAccount, listExternalAccounts } from '../../supabase';
import { pushOAuthTokensToVM, storeOAuthTokensOnVM } from '../cloud-engine';
import { authenticateHttpLegacy, sendAuthError } from '../../auth/http';
import { AuthErrorCode } from '../../auth';
import {
  PUBLIC_BASE_URL,
  WEBSITE_BASE_URL,
  REDDIT_CLIENT_ID,
  REDDIT_CLIENT_SECRET,
  REDDIT_REDIRECT_PATH,
  INTEGRATION_STATE_SECRET,
} from '../../utils/config';

const REDDIT_SCOPES = 'identity read submit';
type OAuthStorageTarget = 'cloud' | 'vm';

function resolveStorageTarget(parsedUrl: URL): OAuthStorageTarget {
  const value = String(parsedUrl.searchParams.get('target') || parsedUrl.searchParams.get('store') || '').toLowerCase();
  return value === 'vm' ? 'vm' : 'cloud';
}

export async function handleRedditRoutes(req: IncomingMessage, res: ServerResponse, parsedUrl: URL): Promise<boolean> {
  // ── Status ──
  if (req.method === 'GET' && parsedUrl.pathname === '/integrations/reddit/status') {
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
        const accounts = await listExternalAccounts(userId, 'reddit');
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
      try { acc = await getExternalAccount(userId, 'reddit', profileLabel); connected = !!acc; } catch {}
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

  // ── Connect ──
  if (req.method === 'GET' && parsedUrl.pathname === '/integrations/reddit/connect') {
    try {
      const authResult = await authenticateHttpLegacy(req, parsedUrl);
      if (!authResult.success || !authResult.userId) {
        sendAuthError(res, authResult.error || AuthErrorCode.UNAUTHORIZED, authResult.message);
        return true;
      }
      const userId = authResult.userId;
      if (!PUBLIC_BASE_URL || !REDDIT_CLIENT_ID) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: false, error: 'server_not_configured' }));
        return true;
      }

      const profileLabel = parsedUrl.searchParams.get('profile') || 'default';
      const redirectUri = `${PUBLIC_BASE_URL}${REDDIT_REDIRECT_PATH}`;

      // State: reddit:{userId}:{nonce}:{profileLabel}:{storageTarget}:{sig}
      const nonce = randomUUID();
      const storageTarget = resolveStorageTarget(parsedUrl);
      const payload = `reddit:${userId}:${nonce}:${profileLabel}:${storageTarget}`;
      const sig = createHmac('sha256', INTEGRATION_STATE_SECRET).update(payload).digest('hex');
      const state = Buffer.from(`${payload}:${sig}`).toString('base64url');

      const authorize = new URL('https://www.reddit.com/api/v1/authorize');
      authorize.searchParams.set('client_id', REDDIT_CLIENT_ID);
      authorize.searchParams.set('response_type', 'code');
      authorize.searchParams.set('redirect_uri', redirectUri);
      authorize.searchParams.set('scope', REDDIT_SCOPES);
      authorize.searchParams.set('state', state);
      authorize.searchParams.set('duration', 'permanent'); // Required for refresh tokens
      res.writeHead(302, { Location: authorize.toString(), 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
      res.end();
      return true;
    } catch (e: any) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: false, error: 'internal_error', message: e?.message || 'failed' }));
      return true;
    }
  }

  // ── Callback ──
  if (req.method === 'GET' && parsedUrl.pathname === REDDIT_REDIRECT_PATH) {
    try {
      // Handle OAuth error responses
      const oauthError = parsedUrl.searchParams.get('error') || '';
      if (oauthError) {
        const oauthErrorDesc = parsedUrl.searchParams.get('error_description') || oauthError;
        console.warn('[reddit] OAuth error:', oauthError, oauthErrorDesc);
        res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=reddit&message=${encodeURIComponent(oauthErrorDesc)}`, 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }
      const code = parsedUrl.searchParams.get('code') || '';
      const stateRaw = parsedUrl.searchParams.get('state') || '';
      if (!code || !stateRaw) {
        console.warn('[reddit] Callback missing code or state. Query:', parsedUrl.search);
        res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=reddit&message=Missing code or state`, 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }
      let decoded = '';
      try { decoded = Buffer.from(stateRaw, 'base64url').toString('utf8'); } catch {}
      const parts = decoded.split(':');

      // VM-settings format: reddit:{userId}:{nonce}:{profileLabel}:{storageTarget}:{sig} (6 parts)
      // Format: reddit:{userId}:{nonce}:{profileLabel}:{sig} (5 parts)
      // Legacy: reddit:{userId}:{nonce}:{sig} (4 parts)
      let provider: string, userId: string, nonce: string, profileLabel: string, sig: string;
      let storageTarget: OAuthStorageTarget = 'cloud';
      if (parts.length >= 6) {
        provider = parts[0]; userId = parts[1]; nonce = parts[2]; profileLabel = parts[3]; storageTarget = parts[4] === 'vm' ? 'vm' : 'cloud'; sig = parts[5];
      } else if (parts.length >= 5) {
        provider = parts[0]; userId = parts[1]; nonce = parts[2]; profileLabel = parts[3]; sig = parts[4];
      } else if (parts.length === 4) {
        provider = parts[0]; userId = parts[1]; nonce = parts[2]; profileLabel = 'default'; sig = parts[3];
      } else {
        res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=reddit&message=Invalid state`, 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }

      const newPayload = parts.length >= 6
        ? `${provider}:${userId}:${nonce}:${profileLabel}:${storageTarget}`
        : `${provider}:${userId}:${nonce}:${profileLabel}`;
      const expectNew = createHmac('sha256', INTEGRATION_STATE_SECRET).update(newPayload).digest('hex');
      const oldPayload = `${provider}:${userId}:${nonce}`;
      const expectOld = createHmac('sha256', INTEGRATION_STATE_SECRET).update(oldPayload).digest('hex');

      if (provider !== 'reddit' || (sig !== expectNew && sig !== expectOld)) {
        res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=reddit&message=State verification failed`, 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }

      const redirectUri = `${PUBLIC_BASE_URL}${REDDIT_REDIRECT_PATH}`;

      // Reddit requires Basic Auth (client_id:client_secret base64) for token exchange
      const basicAuth = Buffer.from(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`).toString('base64');

      const tokenRes = await fetch('https://www.reddit.com/api/v1/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${basicAuth}`,
          'User-Agent': 'StuardAI/1.0 (cloud-ai integration)',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
        }),
      });
      const tokenBody: any = await (async () => { try { return await tokenRes.json(); } catch { return null; } })();
      if (!tokenRes.ok || !tokenBody?.access_token) {
        const msg = tokenBody?.error_description || tokenBody?.error || `${tokenRes.status} ${tokenRes.statusText}`;
        res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=reddit&message=${encodeURIComponent('Token exchange failed: ' + msg)}`, 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }

      const access_token = String(tokenBody.access_token);
      const refresh_token = tokenBody.refresh_token ? String(tokenBody.refresh_token) : null;
      const expires_in = tokenBody.expires_in ? Number(tokenBody.expires_in) : null;
      const scopeStr = String(tokenBody.scope || '');
      const scopes = scopeStr ? scopeStr.split(' ').map((s: string) => s.trim()).filter(Boolean) : [];
      const expiresAt = expires_in ? new Date(Date.now() + expires_in * 1000).toISOString() : null;

      // Fetch Reddit user profile for username
      let accountEmail: string | null = null;
      try {
        const userRes = await fetch('https://oauth.reddit.com/api/v1/me', {
          headers: {
            Authorization: `Bearer ${access_token}`,
            'User-Agent': 'StuardAI/1.0 (cloud-ai integration)',
          },
        });
        const user: any = await (async () => { try { return await userRes.json(); } catch { return null; } })();
        accountEmail = user?.name ? `u/${user.name}` : null;
      } catch {}

      if (storageTarget === 'vm') {
        const account = {
          userId,
          provider: 'reddit',
          access_token,
          scopes,
          refresh_token,
          expires_at: expiresAt,
          meta: { token_type: tokenBody.token_type || 'bearer', storage_target: 'vm' },
          profileLabel,
          accountEmail,
        };
        const vmResult = await storeOAuthTokensOnVM(userId, [{
          provider: 'reddit',
          profileLabel,
          isDefault: true,
          accessToken: access_token,
          refreshToken: refresh_token || null,
          expiresAt,
          scopes,
          accountEmail,
        }], { timeoutMs: 30_000, retry: true, replace: false });
        if (!vmResult.ok) {
          const message = vmResult.error === 'engine_not_running'
            ? 'Start the cloud engine, then connect Reddit again so the VM can store the token.'
            : `Could not store token on VM: ${vmResult.error || 'store_oauth_tokens_failed'}`;
          res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=reddit&message=${encodeURIComponent(message)}`, 'Cache-Control': 'no-store' });
          res.end();
          return true;
        }
        try {
          await upsertExternalAccount(account);
        } catch (saveErr: any) {
          console.error('[reddit] Failed to save VM token backup:', saveErr?.message || saveErr);
          res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=reddit&message=${encodeURIComponent('Connected on the VM, but could not save the durable backup: ' + (saveErr?.message || 'database error'))}`, 'Cache-Control': 'no-store' });
          res.end();
          return true;
        }
        res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/success?provider=reddit&profile=${encodeURIComponent(profileLabel)}&target=vm`, 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }

      try {
        await upsertExternalAccount({
          userId,
          provider: 'reddit',
          access_token,
          scopes,
          refresh_token,
          expires_at: expiresAt,
          meta: { token_type: tokenBody.token_type || 'bearer' },
          profileLabel,
          accountEmail,
        });
      } catch (saveErr: any) {
        console.error('[reddit] Failed to save token:', saveErr?.message || saveErr);
        res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=reddit&message=${encodeURIComponent('Could not save token: ' + (saveErr?.message || 'database error'))}`, 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }
      // Auto-sync OAuth tokens to running VM (fire-and-forget)
      pushOAuthTokensToVM(userId).catch(() => {});
      res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/success?provider=reddit&profile=${encodeURIComponent(profileLabel)}`, 'Cache-Control': 'no-store' });
      res.end();
      return true;
    } catch (e: any) {
      res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=reddit&message=${encodeURIComponent('Internal error: ' + (e?.message || 'failed'))}`, 'Cache-Control': 'no-store' });
      res.end();
      return true;
    }
  }

  return false;
}
