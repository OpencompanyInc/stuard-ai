import type { IncomingMessage, ServerResponse } from 'http';
import { randomUUID, createHmac, createHash, randomBytes } from 'crypto';
import { upsertExternalAccount, getExternalAccount, listExternalAccounts } from '../../supabase';
import { pushOAuthTokensToVM, storeOAuthTokensOnVM } from '../cloud-engine';
import { authenticateHttpLegacy, sendAuthError } from '../../auth/http';
import { AuthErrorCode } from '../../auth';
import {
  PUBLIC_BASE_URL,
  WEBSITE_BASE_URL,
  X_CLIENT_ID,
  X_CLIENT_SECRET,
  X_REDIRECT_PATH,
  INTEGRATION_STATE_SECRET,
} from '../../utils/config';

// Scopes cover read, post, like, DMs, and users/followers capability groups.
// offline.access is required to receive a refresh_token.
const X_SCOPES = [
  'tweet.read',
  'tweet.write',
  'users.read',
  'follows.read',
  'like.read',
  'like.write',
  'dm.read',
  'dm.write',
  'offline.access',
].join(' ');

// PKCE verifiers are short-lived. We hold them in-process keyed by nonce so the
// callback can finish the exchange. State HMAC ties them to the original user.
const _pkceVerifiers = new Map<string, { verifier: string; createdAt: number }>();
const PKCE_TTL_MS = 10 * 60 * 1000;
type OAuthStorageTarget = 'cloud' | 'vm';

function resolveStorageTarget(parsedUrl: URL): OAuthStorageTarget {
  const value = String(parsedUrl.searchParams.get('target') || parsedUrl.searchParams.get('store') || '').toLowerCase();
  return value === 'vm' ? 'vm' : 'cloud';
}

function rememberVerifier(nonce: string, verifier: string) {
  // Sweep expired entries opportunistically
  const cutoff = Date.now() - PKCE_TTL_MS;
  for (const [k, v] of _pkceVerifiers) if (v.createdAt < cutoff) _pkceVerifiers.delete(k);
  _pkceVerifiers.set(nonce, { verifier, createdAt: Date.now() });
}

function consumeVerifier(nonce: string): string | null {
  const entry = _pkceVerifiers.get(nonce);
  if (!entry) return null;
  _pkceVerifiers.delete(nonce);
  if (Date.now() - entry.createdAt > PKCE_TTL_MS) return null;
  return entry.verifier;
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generatePkcePair(): { verifier: string; challenge: string } {
  const verifier = base64UrlEncode(randomBytes(48)); // 64 chars
  const challenge = base64UrlEncode(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export async function handleXRoutes(req: IncomingMessage, res: ServerResponse, parsedUrl: URL): Promise<boolean> {
  // ── Status ──
  if (req.method === 'GET' && parsedUrl.pathname === '/integrations/x/status') {
    try {
      const authResult = await authenticateHttpLegacy(req, parsedUrl);
      if (!authResult.success || !authResult.userId) {
        sendAuthError(res, authResult.error || AuthErrorCode.UNAUTHORIZED, authResult.message);
        return true;
      }
      const userId = authResult.userId;
      const profileLabel = parsedUrl.searchParams.get('profile') || undefined;

      if (parsedUrl.searchParams.get('profiles') === '1') {
        const accounts = await listExternalAccounts(userId, 'x');
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
      try { acc = await getExternalAccount(userId, 'x', profileLabel); connected = !!acc; } catch {}
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
  if (req.method === 'GET' && parsedUrl.pathname === '/integrations/x/connect') {
    try {
      const authResult = await authenticateHttpLegacy(req, parsedUrl);
      if (!authResult.success || !authResult.userId) {
        sendAuthError(res, authResult.error || AuthErrorCode.UNAUTHORIZED, authResult.message);
        return true;
      }
      const userId = authResult.userId;
      if (!PUBLIC_BASE_URL || !X_CLIENT_ID) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: false, error: 'server_not_configured' }));
        return true;
      }

      const profileLabel = parsedUrl.searchParams.get('profile') || 'default';
      const redirectUri = `${PUBLIC_BASE_URL}${X_REDIRECT_PATH}`;

      // PKCE
      const { verifier, challenge } = generatePkcePair();

      // State: x:{userId}:{nonce}:{profileLabel}:{storageTarget}:{sig}
      const nonce = randomUUID();
      const storageTarget = resolveStorageTarget(parsedUrl);
      const payload = `x:${userId}:${nonce}:${profileLabel}:${storageTarget}`;
      const sig = createHmac('sha256', INTEGRATION_STATE_SECRET).update(payload).digest('hex');
      const state = Buffer.from(`${payload}:${sig}`).toString('base64url');

      // Stash the verifier keyed by nonce so the callback can complete PKCE
      rememberVerifier(nonce, verifier);

      const authorize = new URL('https://twitter.com/i/oauth2/authorize');
      authorize.searchParams.set('response_type', 'code');
      authorize.searchParams.set('client_id', X_CLIENT_ID);
      authorize.searchParams.set('redirect_uri', redirectUri);
      authorize.searchParams.set('scope', X_SCOPES);
      authorize.searchParams.set('state', state);
      authorize.searchParams.set('code_challenge', challenge);
      authorize.searchParams.set('code_challenge_method', 'S256');

      console.log('[x] /connect redirect_uri =', redirectUri);
      console.log('[x] /connect client_id    =', X_CLIENT_ID);
      console.log('[x] /connect scopes       =', X_SCOPES);

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
  if (req.method === 'GET' && parsedUrl.pathname === X_REDIRECT_PATH) {
    try {
      const oauthError = parsedUrl.searchParams.get('error') || '';
      if (oauthError) {
        const oauthErrorDesc = parsedUrl.searchParams.get('error_description') || oauthError;
        console.warn('[x] OAuth error:', oauthError, oauthErrorDesc);
        res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=x&message=${encodeURIComponent(oauthErrorDesc)}`, 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }
      const code = parsedUrl.searchParams.get('code') || '';
      const stateRaw = parsedUrl.searchParams.get('state') || '';
      if (!code || !stateRaw) {
        res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=x&message=Missing code or state`, 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }
      let decoded = '';
      try { decoded = Buffer.from(stateRaw, 'base64url').toString('utf8'); } catch {}
      const parts = decoded.split(':');
      if (parts.length < 5) {
        res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=x&message=Invalid state`, 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }
      let provider: string;
      let userId: string;
      let nonce: string;
      let profileLabel: string;
      let storageTarget: OAuthStorageTarget = 'cloud';
      let sig: string;
      if (parts.length >= 6) {
        [provider, userId, nonce, profileLabel] = parts;
        storageTarget = parts[4] === 'vm' ? 'vm' : 'cloud';
        sig = parts[5];
      } else {
        [provider, userId, nonce, profileLabel, sig] = parts;
      }
      const signedPayload = parts.length >= 6
        ? `${provider}:${userId}:${nonce}:${profileLabel}:${storageTarget}`
        : `${provider}:${userId}:${nonce}:${profileLabel}`;
      const expectSig = createHmac('sha256', INTEGRATION_STATE_SECRET)
        .update(signedPayload)
        .digest('hex');
      if (provider !== 'x' || sig !== expectSig) {
        res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=x&message=State verification failed`, 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }

      const verifier = consumeVerifier(nonce);
      if (!verifier) {
        res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=x&message=PKCE verifier expired`, 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }

      const redirectUri = `${PUBLIC_BASE_URL}${X_REDIRECT_PATH}`;

      // Token exchange. Confidential clients must send Basic auth; public clients
      // (PKCE-only) send client_id in the body. Support both.
      const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
      const tokenBody: Record<string, string> = {
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
        client_id: X_CLIENT_ID,
      };
      if (X_CLIENT_SECRET) {
        const basicAuth = Buffer.from(`${X_CLIENT_ID}:${X_CLIENT_SECRET}`).toString('base64');
        headers.Authorization = `Basic ${basicAuth}`;
      }

      const tokenRes = await fetch('https://api.twitter.com/2/oauth2/token', {
        method: 'POST',
        headers,
        body: new URLSearchParams(tokenBody),
      });
      const tBody: any = await (async () => { try { return await tokenRes.json(); } catch { return null; } })();
      if (!tokenRes.ok || !tBody?.access_token) {
        const msg = tBody?.error_description || tBody?.error || `${tokenRes.status} ${tokenRes.statusText}`;
        res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=x&message=${encodeURIComponent('Token exchange failed: ' + msg)}`, 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }

      const access_token = String(tBody.access_token);
      const refresh_token = tBody.refresh_token ? String(tBody.refresh_token) : null;
      const expires_in = tBody.expires_in ? Number(tBody.expires_in) : null;
      const scopeStr = String(tBody.scope || '');
      const scopes = scopeStr ? scopeStr.split(' ').map((s: string) => s.trim()).filter(Boolean) : [];
      const expiresAt = expires_in ? new Date(Date.now() + expires_in * 1000).toISOString() : null;

      // Fetch X user profile for the connected handle
      let accountEmail: string | null = null;
      try {
        const userRes = await fetch('https://api.twitter.com/2/users/me?user.fields=username', {
          headers: { Authorization: `Bearer ${access_token}` },
        });
        const user: any = await (async () => { try { return await userRes.json(); } catch { return null; } })();
        const handle = user?.data?.username;
        accountEmail = handle ? `@${handle}` : null;
      } catch {}

      if (storageTarget === 'vm') {
        const vmResult = await storeOAuthTokensOnVM(userId, [{
          provider: 'x',
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
            ? 'Start the cloud engine, then connect X again so the VM can store the token.'
            : `Could not store token on VM: ${vmResult.error || 'store_oauth_tokens_failed'}`;
          res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=x&message=${encodeURIComponent(message)}`, 'Cache-Control': 'no-store' });
          res.end();
          return true;
        }
        res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/success?provider=x&profile=${encodeURIComponent(profileLabel)}&target=vm`, 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }

      try {
        await upsertExternalAccount({
          userId,
          provider: 'x',
          access_token,
          scopes,
          refresh_token,
          expires_at: expiresAt,
          meta: { token_type: tBody.token_type || 'bearer' },
          profileLabel,
          accountEmail,
        });
      } catch (saveErr: any) {
        console.error('[x] Failed to save token:', saveErr?.message || saveErr);
        res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=x&message=${encodeURIComponent('Could not save token: ' + (saveErr?.message || 'database error'))}`, 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }
      pushOAuthTokensToVM(userId).catch(() => {});
      res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/success?provider=x&profile=${encodeURIComponent(profileLabel)}`, 'Cache-Control': 'no-store' });
      res.end();
      return true;
    } catch (e: any) {
      res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=x&message=${encodeURIComponent('Internal error: ' + (e?.message || 'failed'))}`, 'Cache-Control': 'no-store' });
      res.end();
      return true;
    }
  }

  return false;
}
