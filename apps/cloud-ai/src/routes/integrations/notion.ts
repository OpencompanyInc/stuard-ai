import type { IncomingMessage, ServerResponse } from 'http';
import { randomUUID, createHmac } from 'crypto';
import { storeOAuthTokensOnVM } from '../cloud-engine';
import { stageTokensForClaim } from './oauth-claim-store';
import { listVMOAuthAccountsForUser } from '../../tools/vm-oauth';
import { authenticateHttpLegacy, sendAuthError } from '../../auth/http';
import { AuthErrorCode } from '../../auth';
import {
  PUBLIC_BASE_URL,
  WEBSITE_BASE_URL,
  NOTION_CLIENT_ID,
  NOTION_CLIENT_SECRET,
  NOTION_REDIRECT_PATH,
  INTEGRATION_STATE_SECRET,
} from '../../utils/config';

type OAuthStorageTarget = 'cloud' | 'vm';

function resolveStorageTarget(parsedUrl: URL): OAuthStorageTarget {
  const value = String(parsedUrl.searchParams.get('target') || parsedUrl.searchParams.get('store') || '').toLowerCase();
  return value === 'vm' ? 'vm' : 'cloud';
}

function notionBasicAuth(): string {
  return Buffer.from(`${NOTION_CLIENT_ID}:${NOTION_CLIENT_SECRET}`).toString('base64');
}

export async function handleNotionRoutes(req: IncomingMessage, res: ServerResponse, parsedUrl: URL): Promise<boolean> {
  if (req.method === 'GET' && parsedUrl.pathname === '/integrations/notion/status') {
    try {
      const authResult = await authenticateHttpLegacy(req, parsedUrl);
      if (!authResult.success || !authResult.userId) {
        sendAuthError(res, authResult.error || AuthErrorCode.UNAUTHORIZED, authResult.message);
        return true;
      }
      const userId = authResult.userId;
      const profileLabel = parsedUrl.searchParams.get('profile') || undefined;

      const vmAccounts = await listVMOAuthAccountsForUser(userId, 'notion').catch(() => []);

      if (parsedUrl.searchParams.get('profiles') === '1') {
        const profiles = vmAccounts.map(a => ({
          profile: a.profile_label,
          isDefault: a.is_default,
          email: a.account_email || null,
          scopes: a.scopes,
          connected: true,
        }));
        const body = JSON.stringify({ ok: true, profiles, deviceLocal: vmAccounts.length === 0 });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
        res.end(body);
        return true;
      }

      const acc: any = vmAccounts.find(a => !profileLabel || a.profile_label === profileLabel)
        || (profileLabel ? null : vmAccounts.find(a => a.is_default) || vmAccounts[0] || null);
      const connected = !!acc;
      const body = JSON.stringify({
        ok: true,
        connected,
        deviceLocal: vmAccounts.length === 0,
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

  if (req.method === 'GET' && parsedUrl.pathname === '/integrations/notion/connect') {
    try {
      const authResult = await authenticateHttpLegacy(req, parsedUrl);
      if (!authResult.success || !authResult.userId) {
        sendAuthError(res, authResult.error || AuthErrorCode.UNAUTHORIZED, authResult.message);
        return true;
      }
      const userId = authResult.userId;
      if (!PUBLIC_BASE_URL || !NOTION_CLIENT_ID) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: false, error: 'server_not_configured' }));
        return true;
      }

      const profileLabel = parsedUrl.searchParams.get('profile') || 'default';
      const redirectUri = `${PUBLIC_BASE_URL}${NOTION_REDIRECT_PATH}`;

      const nonce = randomUUID();
      const storageTarget = resolveStorageTarget(parsedUrl);
      const payload = `notion:${userId}:${nonce}:${profileLabel}:${storageTarget}`;
      const sig = createHmac('sha256', INTEGRATION_STATE_SECRET).update(payload).digest('hex');
      const state = Buffer.from(`${payload}:${sig}`).toString('base64url');

      const authorize = new URL('https://api.notion.com/v1/oauth/authorize');
      authorize.searchParams.set('client_id', NOTION_CLIENT_ID);
      authorize.searchParams.set('redirect_uri', redirectUri);
      authorize.searchParams.set('response_type', 'code');
      authorize.searchParams.set('owner', 'user');
      authorize.searchParams.set('state', state);

      res.writeHead(302, { Location: authorize.toString(), 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
      res.end();
      return true;
    } catch (e: any) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: false, error: 'internal_error', message: e?.message || 'failed' }));
      return true;
    }
  }

  if (req.method === 'GET' && parsedUrl.pathname === NOTION_REDIRECT_PATH) {
    try {
      const oauthError = parsedUrl.searchParams.get('error') || '';
      if (oauthError) {
        const oauthErrorDesc = parsedUrl.searchParams.get('error_description') || oauthError;
        console.warn('[notion] OAuth error:', oauthError, oauthErrorDesc);
        res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=notion&message=${encodeURIComponent(oauthErrorDesc)}`, 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }
      const code = parsedUrl.searchParams.get('code') || '';
      const stateRaw = parsedUrl.searchParams.get('state') || '';
      if (!code || !stateRaw) {
        res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=notion&message=Missing code or state`, 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }
      let decoded = '';
      try { decoded = Buffer.from(stateRaw, 'base64url').toString('utf8'); } catch {}
      const parts = decoded.split(':');

      let provider: string, userId: string, nonce: string, profileLabel: string, sig: string;
      let storageTarget: OAuthStorageTarget = 'cloud';
      if (parts.length >= 6) {
        provider = parts[0]; userId = parts[1]; nonce = parts[2]; profileLabel = parts[3]; storageTarget = parts[4] === 'vm' ? 'vm' : 'cloud'; sig = parts[5];
      } else if (parts.length >= 5) {
        provider = parts[0]; userId = parts[1]; nonce = parts[2]; profileLabel = parts[3]; sig = parts[4];
      } else if (parts.length === 4) {
        provider = parts[0]; userId = parts[1]; nonce = parts[2]; profileLabel = 'default'; sig = parts[3];
      } else {
        res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=notion&message=Invalid state`, 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }

      const newPayload = parts.length >= 6
        ? `${provider}:${userId}:${nonce}:${profileLabel}:${storageTarget}`
        : `${provider}:${userId}:${nonce}:${profileLabel}`;
      const expectNew = createHmac('sha256', INTEGRATION_STATE_SECRET).update(newPayload).digest('hex');
      const oldPayload = `${provider}:${userId}:${nonce}`;
      const expectOld = createHmac('sha256', INTEGRATION_STATE_SECRET).update(oldPayload).digest('hex');

      if (provider !== 'notion' || (sig !== expectNew && sig !== expectOld)) {
        res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=notion&message=State verification failed`, 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }

      const redirectUri = `${PUBLIC_BASE_URL}${NOTION_REDIRECT_PATH}`;
      const tokenRes = await fetch('https://api.notion.com/v1/oauth/token', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Basic ${notionBasicAuth()}`,
        },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
        }),
      });
      const tokenBody: any = await (async () => { try { return await tokenRes.json(); } catch { return null; } })();
      if (!tokenRes.ok || !tokenBody?.access_token) {
        const msg = tokenBody?.error_description || tokenBody?.error || `${tokenRes.status} ${tokenRes.statusText}`;
        res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=notion&message=${encodeURIComponent('Token exchange failed: ' + msg)}`, 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }

      const access_token = String(tokenBody.access_token);
      const refresh_token = tokenBody.refresh_token ? String(tokenBody.refresh_token) : null;
      const accountEmail = String(tokenBody.workspace_name || tokenBody.owner?.user?.name || tokenBody.owner?.user?.email || '') || null;

      if (storageTarget === 'vm') {
        const vmResult = await storeOAuthTokensOnVM(userId, [{
          provider: 'notion',
          profileLabel,
          isDefault: true,
          accessToken: access_token,
          refreshToken: refresh_token,
          expiresAt: null,
          scopes: [],
          accountEmail,
        }], { timeoutMs: 30_000, retry: true, replace: false });
        if (!vmResult.ok) {
          const message = vmResult.error === 'engine_not_running'
            ? 'Start the cloud engine, then connect Notion again so the VM can store the token.'
            : `Could not store token on VM: ${vmResult.error || 'store_oauth_tokens_failed'}`;
          res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=notion&message=${encodeURIComponent(message)}`, 'Cache-Control': 'no-store' });
          res.end();
          return true;
        }
        res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/success?provider=notion&profile=${encodeURIComponent(profileLabel)}&target=vm`, 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }

      stageTokensForClaim(userId, [{
        provider: 'notion',
        profileLabel,
        isDefault: true,
        accessToken: access_token,
        refreshToken: refresh_token,
        expiresAt: null,
        scopes: [],
        accountEmail,
      }]);
      res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/success?provider=notion&profile=${encodeURIComponent(profileLabel)}`, 'Cache-Control': 'no-store' });
      res.end();
      return true;
    } catch (e: any) {
      res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=notion&message=${encodeURIComponent('Internal error: ' + (e?.message || 'failed'))}`, 'Cache-Control': 'no-store' });
      res.end();
      return true;
    }
  }

  return false;
}
