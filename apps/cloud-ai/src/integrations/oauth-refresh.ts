/**
 * OAuth 2.0 token exchange + refresh for custom ("bring your own client")
 * integrations.
 *
 * Two server-side operations, both POSTing application/x-www-form-urlencoded to
 * the provider's token endpoint:
 *   - exchangeCodeForTokens() — the authorization-code grant, run once by the
 *     OAuth callback right after consent.
 *   - refreshAccessToken()    — the refresh-token grant, run lazily before a
 *     tool call when the stored access token is near expiry.
 *
 * ensureFreshOAuthToken() is the entry point the run path / compiled tools use:
 * it mutates the in-memory secret bag in place (so repeated calls within one
 * request see the new token) AND persists the rotated tokens via setOAuthTokens.
 *
 * Security: the token URL is validated with assertPublicHttpsUrl (https + no
 * private/loopback host) so a hostile manifest can't SSRF the box through its
 * own token endpoint.
 */

import type { IntegrationManifest } from './types';
import {
  OAUTH_ACCESS_TOKEN_KEY,
  OAUTH_REFRESH_TOKEN_KEY,
  OAUTH_EXPIRES_AT_KEY,
} from './types';
import { assertPublicHttpsUrl } from './declarative-executor';
import { setOAuthTokens } from './installed-store';

export class OAuthError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'OAuthError';
  }
}

export interface OAuthTokenResult {
  accessToken: string;
  /** Null when the provider didn't return one (e.g. no offline access). */
  refreshToken: string | null;
  /** Epoch-ms expiry, or null when the provider omitted expires_in. */
  expiresAt: number | null;
}

/** Skew applied so we refresh slightly before the real expiry. */
const EXPIRY_SKEW_MS = 60_000;

function parseTokenBody(body: any): OAuthTokenResult | null {
  if (!body || typeof body !== 'object') return null;
  const accessToken = body.access_token ?? body.accessToken;
  if (!accessToken) return null;
  const refreshToken = body.refresh_token ?? body.refreshToken ?? null;
  const expiresIn = Number(body.expires_in ?? body.expiresIn ?? 0);
  const expiresAt = expiresIn > 0 ? Date.now() + expiresIn * 1000 : null;
  return {
    accessToken: String(accessToken),
    refreshToken: refreshToken ? String(refreshToken) : null,
    expiresAt,
  };
}

async function postToken(
  tokenUrl: string,
  params: Record<string, string>,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<OAuthTokenResult> {
  const url = assertPublicHttpsUrl(tokenUrl, 'tokenUrl');
  let res: Response;
  try {
    res = await fetchImpl(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams(params).toString(),
    });
  } catch (e: any) {
    throw new OAuthError('token_network_error', `Could not reach token endpoint: ${e?.message || e}`);
  }

  // Providers return either JSON or (legacy) form-encoded token bodies.
  const text = await res.text().catch(() => '');
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    try {
      body = Object.fromEntries(new URLSearchParams(text));
    } catch {
      body = null;
    }
  }

  if (!res.ok) {
    const msg = body?.error_description || body?.error || `${res.status} ${res.statusText}`;
    throw new OAuthError('token_exchange_failed', String(msg));
  }
  const parsed = parseTokenBody(body);
  if (!parsed) throw new OAuthError('no_access_token', 'Token endpoint returned no access_token');
  return parsed;
}

export async function exchangeCodeForTokens(opts: {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
}): Promise<OAuthTokenResult> {
  return postToken(
    opts.tokenUrl,
    {
      grant_type: 'authorization_code',
      code: opts.code,
      redirect_uri: opts.redirectUri,
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
    },
    opts.fetchImpl,
  );
}

export async function refreshAccessToken(opts: {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  fetchImpl?: typeof fetch;
}): Promise<OAuthTokenResult> {
  return postToken(
    opts.tokenUrl,
    {
      grant_type: 'refresh_token',
      refresh_token: opts.refreshToken,
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
    },
    opts.fetchImpl,
  );
}

/**
 * Ensure the secret bag carries a usable access token for an oauth2 manifest.
 *
 * No-op for any other strategy. When the stored token is still well within its
 * lifetime, returns the bag untouched. When it's near/past expiry and a refresh
 * token is present, refreshes, mutates the bag in place, and persists the new
 * tokens. On any failure it leaves the existing token in place — the executor's
 * upstream 401 is then the signal for the user to reconnect.
 */
export async function ensureFreshOAuthToken(
  userId: string,
  manifest: IntegrationManifest,
  secrets: Record<string, string>,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<Record<string, string>> {
  const strat = manifest.auth?.strategy;
  if (!strat || strat.type !== 'oauth2') return secrets;

  const access = secrets[OAUTH_ACCESS_TOKEN_KEY];
  const expiresAt = Number(secrets[OAUTH_EXPIRES_AT_KEY] || 0);

  // Fresh enough — use as-is. Also treat "token present, no known expiry" as
  // valid: some providers issue non-expiring tokens.
  if (access && (!expiresAt || expiresAt - Date.now() > EXPIRY_SKEW_MS)) return secrets;

  const refreshToken = secrets[OAUTH_REFRESH_TOKEN_KEY];
  if (!refreshToken) return secrets; // nothing to refresh with; let the call 401

  const clientId = secrets[strat.clientIdField];
  const clientSecret = secrets[strat.clientSecretField];
  if (!clientId || !clientSecret) return secrets;

  try {
    const next = await refreshAccessToken({
      tokenUrl: strat.tokenUrl,
      clientId,
      clientSecret,
      refreshToken,
      fetchImpl,
    });
    secrets[OAUTH_ACCESS_TOKEN_KEY] = next.accessToken;
    // Providers may rotate the refresh token; keep the old one if they don't.
    const rotatedRefresh = next.refreshToken ?? refreshToken;
    secrets[OAUTH_REFRESH_TOKEN_KEY] = rotatedRefresh;
    if (next.expiresAt) secrets[OAUTH_EXPIRES_AT_KEY] = String(next.expiresAt);
    await setOAuthTokens(userId, manifest.slug, {
      accessToken: next.accessToken,
      refreshToken: rotatedRefresh,
      expiresAt: next.expiresAt,
    });
  } catch {
    // Refresh failed (revoked grant, network, etc.). Leave the stale token so
    // the executor surfaces the provider's own 401 to the caller.
  }
  return secrets;
}
