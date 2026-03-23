import type { IncomingMessage, ServerResponse } from 'http';
import { randomUUID, createHmac } from 'crypto';
import { upsertExternalAccount, getExternalAccount, listExternalAccounts } from '../../supabase';
import { authenticateHttpLegacy, sendAuthError } from '../../auth/http';
import { AuthErrorCode } from '../../auth';
import {
  PUBLIC_BASE_URL,
  WEBSITE_BASE_URL,
  DISCORD_CLIENT_ID,
  DISCORD_CLIENT_SECRET,
  DISCORD_REDIRECT_PATH,
  INTEGRATION_STATE_SECRET,
} from '../../utils/config';

// Valid Discord OAuth2 scopes
// See https://discord.com/developers/docs/topics/oauth2#shared-resources-oauth2-scopes
const DISCORD_SCOPES = 'identify guilds guilds.members.read';

export async function handleDiscordRoutes(req: IncomingMessage, res: ServerResponse, parsedUrl: URL): Promise<boolean> {
  // ── Status ──
  if (req.method === 'GET' && parsedUrl.pathname === '/integrations/discord/status') {
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
        const accounts = await listExternalAccounts(userId, 'discord');
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
      try { acc = await getExternalAccount(userId, 'discord', profileLabel); connected = !!acc; } catch { }
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
  if (req.method === 'GET' && parsedUrl.pathname === '/integrations/discord/connect') {
    try {
      const authResult = await authenticateHttpLegacy(req, parsedUrl);
      if (!authResult.success || !authResult.userId) {
        sendAuthError(res, authResult.error || AuthErrorCode.UNAUTHORIZED, authResult.message);
        return true;
      }
      const userId = authResult.userId;
      if (!PUBLIC_BASE_URL || !DISCORD_CLIENT_ID) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: false, error: 'server_not_configured' }));
        return true;
      }

      const profileLabel = parsedUrl.searchParams.get('profile') || 'default';
      const redirectUri = `${PUBLIC_BASE_URL}${DISCORD_REDIRECT_PATH}`;

      // State: discord:{userId}:{nonce}:{profileLabel}:{sig}
      const nonce = randomUUID();
      const payload = `discord:${userId}:${nonce}:${profileLabel}`;
      const sig = createHmac('sha256', INTEGRATION_STATE_SECRET).update(payload).digest('hex');
      const state = Buffer.from(`${payload}:${sig}`).toString('base64url');

      const authorize = new URL('https://discord.com/oauth2/authorize');
      authorize.searchParams.set('client_id', DISCORD_CLIENT_ID);
      authorize.searchParams.set('response_type', 'code');
      authorize.searchParams.set('redirect_uri', redirectUri);
      authorize.searchParams.set('scope', DISCORD_SCOPES);
      authorize.searchParams.set('state', state);
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

  // ── Callback ──
  if (req.method === 'GET' && parsedUrl.pathname === DISCORD_REDIRECT_PATH) {
    try {
      // Handle OAuth error responses (e.g. user denied access, redirect_uri mismatch)
      const oauthError = parsedUrl.searchParams.get('error') || '';
      if (oauthError) {
        const oauthErrorDesc = parsedUrl.searchParams.get('error_description') || oauthError;
        console.warn('[discord] OAuth error:', oauthError, oauthErrorDesc);
        res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=discord&message=${encodeURIComponent(oauthErrorDesc)}`, 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }
      const code = parsedUrl.searchParams.get('code') || '';
      const stateRaw = parsedUrl.searchParams.get('state') || '';
      if (!code || !stateRaw) {
        console.warn('[discord] Callback missing code or state. Query:', parsedUrl.search);
        res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=discord&message=Missing code or state`, 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }
      let decoded = '';
      try { decoded = Buffer.from(stateRaw, 'base64url').toString('utf8'); } catch { }
      const parts = decoded.split(':');

      // Format: discord:{userId}:{nonce}:{profileLabel}:{sig} (5 parts)
      // Legacy: discord:{userId}:{nonce}:{sig} (4 parts)
      let provider: string, userId: string, nonce: string, profileLabel: string, sig: string;
      if (parts.length >= 5) {
        provider = parts[0]; userId = parts[1]; nonce = parts[2]; profileLabel = parts[3]; sig = parts[4];
      } else if (parts.length === 4) {
        provider = parts[0]; userId = parts[1]; nonce = parts[2]; profileLabel = 'default'; sig = parts[3];
      } else {
        res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=discord&message=Invalid state`, 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }

      const newPayload = `${provider}:${userId}:${nonce}:${profileLabel}`;
      const expectNew = createHmac('sha256', INTEGRATION_STATE_SECRET).update(newPayload).digest('hex');
      const oldPayload = `${provider}:${userId}:${nonce}`;
      const expectOld = createHmac('sha256', INTEGRATION_STATE_SECRET).update(oldPayload).digest('hex');

      if (provider !== 'discord' || (sig !== expectNew && sig !== expectOld)) {
        res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=discord&message=State verification failed`, 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }

      const redirectUri = `${PUBLIC_BASE_URL}${DISCORD_REDIRECT_PATH}`;

      // Exchange code for token — Discord uses form-encoded POST with client_id+secret in body
      const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: DISCORD_CLIENT_ID,
          client_secret: DISCORD_CLIENT_SECRET,
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
        }),
      });
      const tokenBody: any = await (async () => { try { return await tokenRes.json(); } catch { return null; } })();
      if (!tokenRes.ok || !tokenBody?.access_token) {
        const msg = tokenBody?.error_description || tokenBody?.error || `${tokenRes.status} ${tokenRes.statusText}`;
        res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=discord&message=${encodeURIComponent('Token exchange failed: ' + msg)}`, 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }

      const access_token = String(tokenBody.access_token);
      const refresh_token = tokenBody.refresh_token ? String(tokenBody.refresh_token) : null;
      const expires_in = tokenBody.expires_in ? Number(tokenBody.expires_in) : null;
      const scopeStr = String(tokenBody.scope || '');
      const scopes = scopeStr ? scopeStr.split(' ').map((s: string) => s.trim()).filter(Boolean) : [];

      // Fetch Discord user profile
      let accountEmail: string | null = null;
      let discordUserId: string | null = null;
      let discordUsername: string | null = null;
      let discordAvatar: string | null = null;
      try {
        const userRes = await fetch('https://discord.com/api/v10/users/@me', {
          headers: { Authorization: `Bearer ${access_token}`, 'User-Agent': 'StuardAI-Cloud' },
        });
        const user: any = await (async () => { try { return await userRes.json(); } catch { return null; } })();
        accountEmail = String(user?.email || user?.username || '') || null;
        discordUserId = user?.id ? String(user.id) : null;
        discordUsername = user?.username ? String(user.username) : null;
        discordAvatar = user?.avatar ? String(user.avatar) : null;
      } catch { }

      try {
        await upsertExternalAccount({
          userId,
          provider: 'discord',
          access_token,
          scopes,
          refresh_token,
          expires_at: expires_in ? new Date(Date.now() + expires_in * 1000).toISOString() : null,
          meta: {
            token_type: tokenBody.token_type || 'Bearer',
            ...(discordUserId ? { discord_user_id: discordUserId } : {}),
            ...(discordUsername ? { discord_username: discordUsername } : {}),
            ...(discordAvatar ? { discord_avatar: discordAvatar } : {}),
          },
          profileLabel,
          accountEmail,
        });
      } catch (saveErr: any) {
        console.error('[discord] Failed to save token:', saveErr?.message || saveErr);
        res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=discord&message=${encodeURIComponent('Could not save token: ' + (saveErr?.message || 'database error'))}`, 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }
      res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/success?provider=discord&profile=${encodeURIComponent(profileLabel)}`, 'Cache-Control': 'no-store' });
      res.end();
      return true;
    } catch (e: any) {
      res.writeHead(302, { Location: `${WEBSITE_BASE_URL}/integrations/error?provider=discord&message=${encodeURIComponent('Internal error: ' + (e?.message || 'failed'))}`, 'Cache-Control': 'no-store' });
      res.end();
      return true;
    }
  }

  return false;
}
