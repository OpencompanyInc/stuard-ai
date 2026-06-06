/**
 * OAuth 2.0 connect + callback for custom ("bring your own client")
 * integrations built in the Integration Builder.
 *
 *   GET /integrations/custom/:slug/oauth/connect   — start consent (auth'd)
 *   GET /integrations/custom/oauth/callback         — provider redirect back
 *
 * Unlike the built-in providers (github/google/…), there is no pre-registered
 * Stuard OAuth app here: the user supplies their own client_id / client_secret
 * (stored as the integration's encrypted auth.fields) and the authorize/token
 * URLs in the manifest. This route is provider-agnostic — the slug, carried in
 * the HMAC-signed state, selects which deployed integration to act on.
 *
 * Tokens land server-side in custom_integrations.secrets_encrypted (the same
 * place the API-key path stores secrets), NOT in the device-local store — the
 * custom-integration executor runs server-side, so that's where it reads them.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { randomUUID, createHmac, timingSafeEqual } from 'crypto';
import { authenticateHttpLegacy, sendAuthError } from '../../auth/http';
import { AuthErrorCode } from '../../auth';
import {
  PUBLIC_BASE_URL,
  WEBSITE_BASE_URL,
  INTEGRATION_STATE_SECRET,
} from '../../utils/config';
import { getDecryptedSecrets, setOAuthTokens } from '../../integrations/installed-store';
import { exchangeCodeForTokens } from '../../integrations/oauth-refresh';
import { assertPublicHttpsUrl } from '../../integrations/declarative-executor';

const CALLBACK_PATH = '/integrations/custom/oauth/callback';
const CONNECT_RE = /^\/integrations\/custom\/([^/]+)\/oauth\/connect$/;

function redirectUriFor(): string {
  return `${PUBLIC_BASE_URL}${CALLBACK_PATH}`;
}

function signState(payload: string): string {
  return createHmac('sha256', INTEGRATION_STATE_SECRET).update(payload).digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    if (ba.length !== bb.length || ba.length === 0) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

function redirectError(res: ServerResponse, slug: string, message: string): void {
  res.writeHead(302, {
    Location: `${WEBSITE_BASE_URL}/integrations/error?provider=${encodeURIComponent(slug || 'integration')}&message=${encodeURIComponent(message)}`,
    'Cache-Control': 'no-store',
  });
  res.end();
}

export async function handleCustomOAuthRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parsedUrl: URL,
): Promise<boolean> {
  // ── Connect (authenticated) ────────────────────────────────────────────
  const connectMatch = CONNECT_RE.exec(parsedUrl.pathname);
  if (req.method === 'GET' && connectMatch) {
    const slug = decodeURIComponent(connectMatch[1] || '');
    try {
      const authResult = await authenticateHttpLegacy(req, parsedUrl);
      if (!authResult.success || !authResult.userId) {
        sendAuthError(res, authResult.error || AuthErrorCode.UNAUTHORIZED, authResult.message);
        return true;
      }
      const userId = authResult.userId;
      if (!PUBLIC_BASE_URL) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: false, error: 'server_not_configured' }));
        return true;
      }

      const resolved = await getDecryptedSecrets(userId, slug);
      if (!resolved) { redirectError(res, slug, 'Deploy this integration before connecting.'); return true; }
      const strat = resolved.manifest.auth?.strategy;
      if (!strat || strat.type !== 'oauth2') { redirectError(res, slug, 'This integration does not use OAuth.'); return true; }

      const clientId = resolved.secrets[strat.clientIdField];
      if (!clientId) { redirectError(res, slug, `Provide ${strat.clientIdField} (deploy with your OAuth client id) before connecting.`); return true; }

      const authorizeUrl = assertPublicHttpsUrl(strat.authorizeUrl, 'authorizeUrl');

      const nonce = randomUUID();
      const payload = `custom:${userId}:${slug}:${nonce}`;
      const state = Buffer.from(`${payload}:${signState(payload)}`).toString('base64url');

      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('client_id', clientId);
      authorizeUrl.searchParams.set('redirect_uri', redirectUriFor());
      authorizeUrl.searchParams.set('state', state);
      if (Array.isArray(strat.scopes) && strat.scopes.length) {
        authorizeUrl.searchParams.set('scope', strat.scopes.join(' '));
      }
      for (const [k, v] of Object.entries(strat.extraAuthParams || {})) {
        if (k && typeof v === 'string') authorizeUrl.searchParams.set(k, v);
      }

      res.writeHead(302, { Location: authorizeUrl.toString(), 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
      res.end();
      return true;
    } catch (e: any) {
      redirectError(res, slug, `Could not start OAuth: ${e?.message || 'failed'}`);
      return true;
    }
  }

  // ── Callback (provider redirect — no Bearer; trust the signed state) ────
  if (req.method === 'GET' && parsedUrl.pathname === CALLBACK_PATH) {
    let slug = '';
    try {
      const oauthError = parsedUrl.searchParams.get('error') || '';
      if (oauthError) {
        const desc = parsedUrl.searchParams.get('error_description') || oauthError;
        redirectError(res, slug, desc);
        return true;
      }
      const code = parsedUrl.searchParams.get('code') || '';
      const stateRaw = parsedUrl.searchParams.get('state') || '';
      if (!code || !stateRaw) { redirectError(res, slug, 'Missing code or state'); return true; }

      let decoded = '';
      try { decoded = Buffer.from(stateRaw, 'base64url').toString('utf8'); } catch {}
      // custom:{userId}:{slug}:{nonce}:{sig}
      const parts = decoded.split(':');
      if (parts.length !== 5 || parts[0] !== 'custom') { redirectError(res, slug, 'Invalid state'); return true; }
      const [, userId, slugFromState, nonce, sig] = parts;
      slug = slugFromState;
      const expected = signState(`custom:${userId}:${slug}:${nonce}`);
      if (!safeEqualHex(sig, expected)) { redirectError(res, slug, 'State verification failed'); return true; }

      const resolved = await getDecryptedSecrets(userId, slug);
      if (!resolved) { redirectError(res, slug, 'Integration is no longer deployed.'); return true; }
      const strat = resolved.manifest.auth?.strategy;
      if (!strat || strat.type !== 'oauth2') { redirectError(res, slug, 'This integration does not use OAuth.'); return true; }

      const clientId = resolved.secrets[strat.clientIdField];
      const clientSecret = resolved.secrets[strat.clientSecretField];
      if (!clientId || !clientSecret) { redirectError(res, slug, 'Missing OAuth client credentials — redeploy with them set.'); return true; }

      let tokens;
      try {
        tokens = await exchangeCodeForTokens({
          tokenUrl: strat.tokenUrl,
          clientId,
          clientSecret,
          code,
          redirectUri: redirectUriFor(),
        });
      } catch (e: any) {
        redirectError(res, slug, `Token exchange failed: ${e?.message || 'failed'}`);
        return true;
      }

      const stored = await setOAuthTokens(userId, slug, {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
      });
      if (!stored) { redirectError(res, slug, 'Could not store the token. Try connecting again.'); return true; }

      res.writeHead(302, {
        Location: `${WEBSITE_BASE_URL}/integrations/success?provider=${encodeURIComponent(slug)}`,
        'Cache-Control': 'no-store',
      });
      res.end();
      return true;
    } catch (e: any) {
      redirectError(res, slug, `Internal error: ${e?.message || 'failed'}`);
      return true;
    }
  }

  return false;
}
