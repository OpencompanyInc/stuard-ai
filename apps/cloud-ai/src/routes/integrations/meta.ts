import type { IncomingMessage, ServerResponse } from 'http';
import { randomUUID, createHmac } from 'crypto';
import { upsertExternalAccount, getExternalAccount, listExternalAccounts } from '../../supabase';
import { pushOAuthTokensToVM, storeOAuthTokensOnVM } from '../cloud-engine';
import { authenticateHttpLegacy, sendAuthError } from '../../auth/http';
import { AuthErrorCode } from '../../auth';
import {
  PUBLIC_BASE_URL,
  WEBSITE_BASE_URL,
  INTEGRATION_STATE_SECRET,
  FACEBOOK_APP_ID,
  FACEBOOK_APP_SECRET,
  FACEBOOK_REDIRECT_PATH,
  INSTAGRAM_APP_ID,
  INSTAGRAM_APP_SECRET,
  INSTAGRAM_REDIRECT_PATH,
  THREADS_APP_ID,
  THREADS_APP_SECRET,
  THREADS_REDIRECT_PATH,
} from '../../utils/config';

type MetaProvider = 'facebook' | 'instagram' | 'threads';
type OAuthStorageTarget = 'cloud' | 'vm';

type TokenResult = {
  access_token: string;
  refresh_token?: string | null;
  expires_in?: number | null;
  scope?: string | null;
  token_type?: string | null;
  raw?: any;
};

type ProviderConfig = {
  provider: MetaProvider;
  clientId: string;
  clientSecret: string;
  redirectPath: string;
  authorizeUrl: string;
  requestedScopes: () => string;
  exchangeCode: (code: string, redirectUri: string) => Promise<TokenResult>;
  upgradeToken?: (accessToken: string) => Promise<Partial<TokenResult> | null>;
  fetchProfile: (accessToken: string) => Promise<any>;
  formatAccountLabel: (profile: any) => string | null;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
};

const PROVIDERS: ProviderConfig[] = [
  {
    provider: 'facebook',
    clientId: FACEBOOK_APP_ID,
    clientSecret: FACEBOOK_APP_SECRET,
    redirectPath: FACEBOOK_REDIRECT_PATH,
    authorizeUrl: 'https://www.facebook.com/v22.0/dialog/oauth',
    requestedScopes: () => process.env.FACEBOOK_SCOPES || 'public_profile,email,pages_show_list,pages_read_engagement,pages_manage_posts,pages_manage_engagement,pages_messaging,pages_manage_metadata',
    exchangeCode: async (code, redirectUri) => {
      const tokenUrl = new URL('https://graph.facebook.com/v22.0/oauth/access_token');
      tokenUrl.searchParams.set('client_id', FACEBOOK_APP_ID);
      tokenUrl.searchParams.set('client_secret', FACEBOOK_APP_SECRET);
      tokenUrl.searchParams.set('redirect_uri', redirectUri);
      tokenUrl.searchParams.set('code', code);
      const res = await fetch(tokenUrl.toString());
      const body = await res.json().catch(() => null) as any;
      if (!res.ok || !body?.access_token) {
        const msg = body?.error?.message || body?.error_description || `${res.status} ${res.statusText}`;
        throw new Error(`Token exchange failed: ${msg}`);
      }
      return {
        access_token: String(body.access_token),
        expires_in: body.expires_in ? Number(body.expires_in) : null,
        token_type: body.token_type ? String(body.token_type) : 'bearer',
        raw: body,
      };
    },
    upgradeToken: async (accessToken) => {
      const tokenUrl = new URL('https://graph.facebook.com/v22.0/oauth/access_token');
      tokenUrl.searchParams.set('grant_type', 'fb_exchange_token');
      tokenUrl.searchParams.set('client_id', FACEBOOK_APP_ID);
      tokenUrl.searchParams.set('client_secret', FACEBOOK_APP_SECRET);
      tokenUrl.searchParams.set('fb_exchange_token', accessToken);
      const res = await fetch(tokenUrl.toString());
      const body = await res.json().catch(() => null) as any;
      if (!res.ok || !body?.access_token) return null;
      return {
        access_token: String(body.access_token),
        expires_in: body.expires_in ? Number(body.expires_in) : null,
        token_type: body.token_type ? String(body.token_type) : 'bearer',
        raw: body,
      };
    },
    fetchProfile: async (accessToken) => {
      const profileUrl = new URL('https://graph.facebook.com/me');
      profileUrl.searchParams.set('fields', 'id,name,email');
      profileUrl.searchParams.set('access_token', accessToken);
      const res = await fetch(profileUrl.toString());
      const body = await res.json().catch(() => null) as any;
      if (!res.ok || !body?.id) {
        const msg = body?.error?.message || `${res.status} ${res.statusText}`;
        throw new Error(`Profile lookup failed: ${msg}`);
      }
      return body;
    },
    formatAccountLabel: (profile) => String(profile?.email || profile?.name || profile?.id || '').trim() || null,
  },
  {
    provider: 'instagram',
    clientId: INSTAGRAM_APP_ID,
    clientSecret: INSTAGRAM_APP_SECRET,
    redirectPath: INSTAGRAM_REDIRECT_PATH,
    // New Instagram API with Instagram Login (replaces deprecated Basic Display API)
    authorizeUrl: 'https://www.instagram.com/oauth/authorize/',
    requestedScopes: () => process.env.INSTAGRAM_SCOPES || 'instagram_business_basic,instagram_business_content_publish,instagram_business_manage_comments,instagram_business_manage_messages',
    exchangeCode: async (code, redirectUri) => {
      const res = await fetch('https://api.instagram.com/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: INSTAGRAM_APP_ID,
          client_secret: INSTAGRAM_APP_SECRET,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
          code,
        }),
      });
      const body = await res.json().catch(() => null) as any;
      if (!res.ok || !body?.access_token) {
        const msg = body?.error_message || body?.error_type || body?.error || `${res.status} ${res.statusText}`;
        throw new Error(`Token exchange failed: ${msg}`);
      }
      return {
        access_token: String(body.access_token),
        expires_in: body.expires_in ? Number(body.expires_in) : null,
        token_type: 'bearer',
        raw: body,
      };
    },
    upgradeToken: async (accessToken) => {
      const tokenUrl = new URL('https://graph.instagram.com/access_token');
      tokenUrl.searchParams.set('grant_type', 'ig_exchange_token');
      tokenUrl.searchParams.set('client_secret', INSTAGRAM_APP_SECRET);
      tokenUrl.searchParams.set('access_token', accessToken);
      const res = await fetch(tokenUrl.toString());
      const body = await res.json().catch(() => null) as any;
      if (!res.ok || !body?.access_token) return null;
      return {
        access_token: String(body.access_token),
        expires_in: body.expires_in ? Number(body.expires_in) : null,
        token_type: body.token_type ? String(body.token_type) : 'bearer',
        raw: body,
      };
    },
    fetchProfile: async (accessToken) => {
      const profileUrl = new URL('https://graph.instagram.com/v22.0/me');
      profileUrl.searchParams.set('fields', 'id,user_id,username,name,account_type,profile_picture_url');
      profileUrl.searchParams.set('access_token', accessToken);
      const res = await fetch(profileUrl.toString());
      const body = await res.json().catch(() => null) as any;
      if (!res.ok || (!body?.id && !body?.user_id)) {
        const msg = body?.error?.message || `${res.status} ${res.statusText}`;
        throw new Error(`Profile lookup failed: ${msg}`);
      }
      return body;
    },
    formatAccountLabel: (profile) => {
      const username = String(profile?.username || '').trim();
      return username ? `@${username}` : String(profile?.id || '').trim() || null;
    },
  },
  {
    provider: 'threads',
    clientId: THREADS_APP_ID,
    clientSecret: THREADS_APP_SECRET,
    redirectPath: THREADS_REDIRECT_PATH,
    authorizeUrl: 'https://threads.net/oauth/authorize',
    requestedScopes: () => process.env.THREADS_SCOPES || 'threads_basic,threads_content_publish,threads_manage_replies',
    exchangeCode: async (code, redirectUri) => {
      const res = await fetch('https://graph.threads.net/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: THREADS_APP_ID,
          client_secret: THREADS_APP_SECRET,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
          code,
        }),
      });
      const body = await res.json().catch(() => null) as any;
      if (!res.ok || !body?.access_token) {
        const msg = body?.error?.message || body?.error_description || body?.error || `${res.status} ${res.statusText}`;
        throw new Error(`Token exchange failed: ${msg}`);
      }
      return {
        access_token: String(body.access_token),
        expires_in: body.expires_in ? Number(body.expires_in) : null,
        token_type: body.token_type ? String(body.token_type) : 'bearer',
        raw: body,
      };
    },
    upgradeToken: async (accessToken) => {
      const tokenUrl = new URL('https://graph.threads.net/access_token');
      tokenUrl.searchParams.set('grant_type', 'th_exchange_token');
      tokenUrl.searchParams.set('client_secret', THREADS_APP_SECRET);
      tokenUrl.searchParams.set('access_token', accessToken);
      const res = await fetch(tokenUrl.toString());
      const body = await res.json().catch(() => null) as any;
      if (!res.ok || !body?.access_token) return null;
      return {
        access_token: String(body.access_token),
        expires_in: body.expires_in ? Number(body.expires_in) : null,
        token_type: body.token_type ? String(body.token_type) : 'bearer',
        raw: body,
      };
    },
    fetchProfile: async (accessToken) => {
      const profileUrl = new URL('https://graph.threads.net/v1.0/me');
      profileUrl.searchParams.set('fields', 'id,username,name,threads_profile_picture_url,threads_biography');
      profileUrl.searchParams.set('access_token', accessToken);
      const res = await fetch(profileUrl.toString());
      const body = await res.json().catch(() => null) as any;
      if (!res.ok || !body?.id) {
        const msg = body?.error?.message || `${res.status} ${res.statusText}`;
        throw new Error(`Profile lookup failed: ${msg}`);
      }
      return body;
    },
    formatAccountLabel: (profile) => {
      const username = String(profile?.username || '').trim();
      return username ? `@${username}` : String(profile?.name || profile?.id || '').trim() || null;
    },
  },
];

function sendJson(res: ServerResponse, status: number, payload: any) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    ...corsHeaders,
  });
  res.end(body);
}

function redirect(res: ServerResponse, location: string) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

function parseScopes(value?: string | null): string[] {
  return String(value || '')
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function resolveStorageTarget(parsedUrl: URL): OAuthStorageTarget {
  const value = String(parsedUrl.searchParams.get('target') || parsedUrl.searchParams.get('store') || '').toLowerCase();
  return value === 'vm' ? 'vm' : 'cloud';
}

function buildState(provider: MetaProvider, userId: string, profileLabel: string, storageTarget: OAuthStorageTarget): string {
  const nonce = randomUUID();
  const payload = `${provider}:${userId}:${nonce}:${profileLabel}:${storageTarget}`;
  const sig = createHmac('sha256', INTEGRATION_STATE_SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}:${sig}`).toString('base64url');
}

function verifyState(stateRaw: string): { provider: MetaProvider; userId: string; profileLabel: string; storageTarget: OAuthStorageTarget } | null {
  let decoded = '';
  try {
    decoded = Buffer.from(stateRaw, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const parts = decoded.split(':');
  if (parts.length < 5) return null;
  const provider = parts[0];
  const userId = parts[1];
  const nonce = parts[2];
  const profileLabel = parts[3];
  const storageTarget: OAuthStorageTarget = parts.length >= 6 && parts[4] === 'vm' ? 'vm' : 'cloud';
  const sig = parts.length >= 6 ? parts[5] : parts[4];
  if (provider !== 'facebook' && provider !== 'instagram' && provider !== 'threads') return null;
  const payload = parts.length >= 6
    ? `${provider}:${userId}:${nonce}:${profileLabel}:${storageTarget}`
    : `${provider}:${userId}:${nonce}:${profileLabel}`;
  const expected = createHmac('sha256', INTEGRATION_STATE_SECRET).update(payload).digest('hex');
  if (sig !== expected) return null;
  return { provider: provider as MetaProvider, userId, profileLabel, storageTarget };
}

function getProviderByRoute(pathname: string): ProviderConfig | null {
  return PROVIDERS.find((cfg) => (
    pathname === `/integrations/${cfg.provider}/status` ||
    pathname === `/integrations/${cfg.provider}/connect` ||
    pathname === cfg.redirectPath
  )) || null;
}

export async function handleMetaRoutes(req: IncomingMessage, res: ServerResponse, parsedUrl: URL): Promise<boolean> {
  const cfg = getProviderByRoute(parsedUrl.pathname);
  if (!cfg) return false;

  if (req.method === 'GET' && parsedUrl.pathname === `/integrations/${cfg.provider}/status`) {
    try {
      const authResult = await authenticateHttpLegacy(req, parsedUrl);
      if (!authResult.success || !authResult.userId) {
        sendAuthError(res, authResult.error || AuthErrorCode.UNAUTHORIZED, authResult.message);
        return true;
      }
      const userId = authResult.userId;
      const profileLabel = parsedUrl.searchParams.get('profile') || undefined;

      if (parsedUrl.searchParams.get('profiles') === '1') {
        const accounts = await listExternalAccounts(userId, cfg.provider);
        sendJson(res, 200, {
          ok: true,
          profiles: accounts.map((account) => ({
            profile: account.profile_label,
            isDefault: account.is_default,
            email: account.account_email || null,
            scopes: account.scopes,
            connected: true,
          })),
        });
        return true;
      }

      let acc: any = null;
      try {
        acc = await getExternalAccount(userId, cfg.provider, profileLabel);
      } catch {}

      sendJson(res, 200, {
        ok: true,
        connected: !!acc,
        profile: acc?.profile_label || null,
        isDefault: acc?.is_default ?? null,
        email: acc?.account_email || null,
      });
      return true;
    } catch (e: any) {
      sendJson(res, 500, { ok: false, error: 'internal_error', message: e?.message || 'failed' });
      return true;
    }
  }

  if (req.method === 'GET' && parsedUrl.pathname === `/integrations/${cfg.provider}/connect`) {
    try {
      const authResult = await authenticateHttpLegacy(req, parsedUrl);
      if (!authResult.success || !authResult.userId) {
        sendAuthError(res, authResult.error || AuthErrorCode.UNAUTHORIZED, authResult.message);
        return true;
      }
      if (!PUBLIC_BASE_URL || !cfg.clientId || !cfg.clientSecret) {
        sendJson(res, 500, { ok: false, error: 'server_not_configured' });
        return true;
      }

      const profileLabel = parsedUrl.searchParams.get('profile') || 'default';
      const redirectUri = `${PUBLIC_BASE_URL}${cfg.redirectPath}`;
      const state = buildState(cfg.provider, authResult.userId, profileLabel, resolveStorageTarget(parsedUrl));
      const authorize = new URL(cfg.authorizeUrl);
      authorize.searchParams.set('client_id', cfg.clientId);
      authorize.searchParams.set('redirect_uri', redirectUri);
      authorize.searchParams.set('scope', cfg.requestedScopes());
      authorize.searchParams.set('state', state);
      authorize.searchParams.set('response_type', 'code');
      redirect(res, authorize.toString());
      return true;
    } catch (e: any) {
      sendJson(res, 500, { ok: false, error: 'internal_error', message: e?.message || 'failed' });
      return true;
    }
  }

  if (req.method === 'GET' && parsedUrl.pathname === cfg.redirectPath) {
    try {
      const oauthError = parsedUrl.searchParams.get('error') || '';
      if (oauthError) {
        const oauthErrorDesc = parsedUrl.searchParams.get('error_description') || oauthError;
        redirect(res, `${WEBSITE_BASE_URL}/integrations/error?provider=${encodeURIComponent(cfg.provider)}&message=${encodeURIComponent(oauthErrorDesc)}`);
        return true;
      }

      const code = parsedUrl.searchParams.get('code') || '';
      const stateRaw = parsedUrl.searchParams.get('state') || '';
      if (!code || !stateRaw) {
        redirect(res, `${WEBSITE_BASE_URL}/integrations/error?provider=${encodeURIComponent(cfg.provider)}&message=${encodeURIComponent('Missing code or state')}`);
        return true;
      }

      const verified = verifyState(stateRaw);
      if (!verified || verified.provider !== cfg.provider) {
        redirect(res, `${WEBSITE_BASE_URL}/integrations/error?provider=${encodeURIComponent(cfg.provider)}&message=${encodeURIComponent('State verification failed')}`);
        return true;
      }

      const redirectUri = `${PUBLIC_BASE_URL}${cfg.redirectPath}`;
      let token = await cfg.exchangeCode(code, redirectUri);
      if (cfg.upgradeToken) {
        try {
          const upgraded = await cfg.upgradeToken(token.access_token);
          if (upgraded?.access_token) token = { ...token, ...upgraded };
        } catch {}
      }

      const profile = await cfg.fetchProfile(token.access_token);
      const scopes = parseScopes(token.scope).length > 0 ? parseScopes(token.scope) : parseScopes(cfg.requestedScopes());
      const expiresAt = token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null;
      const accountEmail = cfg.formatAccountLabel(profile);

      if (verified.storageTarget === 'vm') {
        const account = {
          userId: verified.userId,
          provider: cfg.provider,
          access_token: token.access_token,
          scopes,
          refresh_token: token.refresh_token ?? null,
          expires_at: expiresAt,
          meta: {
            token_type: token.token_type || 'bearer',
            external_user_id: profile?.id || profile?.user_id || token.raw?.user_id || null,
            profile,
            provider: cfg.provider,
            storage_target: 'vm',
          },
          profileLabel: verified.profileLabel,
          accountEmail,
        };
        const vmResult = await storeOAuthTokensOnVM(verified.userId, [{
          provider: cfg.provider,
          profileLabel: verified.profileLabel,
          isDefault: true,
          accessToken: token.access_token,
          refreshToken: token.refresh_token ?? null,
          expiresAt,
          scopes,
          accountEmail,
        }], { timeoutMs: 30_000, retry: true, replace: false });
        if (!vmResult.ok) {
          const message = vmResult.error === 'engine_not_running'
            ? `Start the cloud engine, then connect ${cfg.provider} again so the VM can store the token.`
            : `Could not store token on VM: ${vmResult.error || 'store_oauth_tokens_failed'}`;
          redirect(res, `${WEBSITE_BASE_URL}/integrations/error?provider=${encodeURIComponent(cfg.provider)}&message=${encodeURIComponent(message)}`);
          return true;
        }
        try {
          await upsertExternalAccount(account);
        } catch (saveErr: any) {
          console.error(`[${cfg.provider}] Failed to save VM token backup:`, saveErr?.message || saveErr);
          redirect(res, `${WEBSITE_BASE_URL}/integrations/error?provider=${encodeURIComponent(cfg.provider)}&message=${encodeURIComponent('Connected on the VM, but could not save the durable backup: ' + (saveErr?.message || 'database error'))}`);
          return true;
        }
        redirect(res, `${WEBSITE_BASE_URL}/integrations/success?provider=${encodeURIComponent(cfg.provider)}&profile=${encodeURIComponent(verified.profileLabel)}&target=vm`);
        return true;
      }

      await upsertExternalAccount({
        userId: verified.userId,
        provider: cfg.provider,
        access_token: token.access_token,
        scopes,
        refresh_token: token.refresh_token ?? null,
        expires_at: expiresAt,
        meta: {
          token_type: token.token_type || 'bearer',
          external_user_id: profile?.id || profile?.user_id || token.raw?.user_id || null,
          profile,
          provider: cfg.provider,
        },
        profileLabel: verified.profileLabel,
        accountEmail,
      });

      // Auto-sync OAuth tokens to running VM (fire-and-forget)
      pushOAuthTokensToVM(verified.userId).catch(() => {});

      redirect(res, `${WEBSITE_BASE_URL}/integrations/success?provider=${encodeURIComponent(cfg.provider)}&profile=${encodeURIComponent(verified.profileLabel)}`);
      return true;
    } catch (e: any) {
      redirect(res, `${WEBSITE_BASE_URL}/integrations/error?provider=${encodeURIComponent(cfg.provider)}&message=${encodeURIComponent('Internal error: ' + (e?.message || 'failed'))}`);
      return true;
    }
  }

  return false;
}
