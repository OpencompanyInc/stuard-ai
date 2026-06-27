/**
 * Register/unregister native cloud triggers (X, Instagram social webhooks and
 * Google Gmail/Drive watches) with cloud-ai.
 * Used by workflow runtimes and bot/agent trigger dispatchers.
 */

import { net } from 'electron';
import logger from '../utils/logger';
import { getMainAccessToken } from './auth-session';
import { waitForAgentReady } from './agent';

export type SocialNativeTriggerType =
  | 'instagram.new_comment' | 'instagram.new_mention' | 'instagram.new_message'
  | 'x.new_mention' | 'x.new_comment' | 'x.new_dm' | 'x.new_follower' | 'x.user_post';

export type GoogleNativeTriggerType = 'gmail.new_email' | 'drive.new_file';

export function getCloudAiHttpBase(): string {
  return String(
    process.env.CLOUD_AI_HTTP ||
    process.env.CLOUD_PUBLIC_URL ||
    process.env.CLOUD_AI_URL ||
    'http://localhost:8082'
  ).trim().replace(/\/+$/, '');
}

function agentHttpBase(): string {
  return String(process.env.AGENT_HTTP || 'http://127.0.0.1:8765').replace(/\/+$/, '');
}

function parseOAuthTokenPayload(token: any): { accessToken: string; refreshToken: string | null } | undefined {
  if (!token || typeof token !== 'object') return undefined;
  const accessToken = String(token.accessToken || token.access_token || '').trim();
  if (!accessToken) return undefined;
  const refreshRaw = token.refreshToken ?? token.refresh_token ?? null;
  return {
    accessToken,
    refreshToken: refreshRaw ? String(refreshRaw) : null,
  };
}

async function execAgentOAuthTool(tool: string, args: Record<string, unknown>): Promise<any> {
  const resp = await net.fetch(`${agentHttpBase()}/v1/tools/exec`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool, args }),
  });
  const out: any = await resp.json().catch(() => ({}));
  if (!resp.ok) return { ok: false, error: `http_${resp.status}`, ...out };
  return out;
}

/**
 * Read the device-local X OAuth token from the agent store so it can be relayed
 * to cloud-ai at registration time. Registering an X trigger needs the user's
 * token once: cloud-ai uses it to derive the X user id and subscribe the account
 * to the app webhook, then drops it (never persisted). Tokens are device-resident
 * per the OAuth-local migration, so cloud-ai can no longer read them from Supabase.
 */
export async function getLocalXOAuth(profileLabel?: string): Promise<{ accessToken: string; refreshToken: string | null } | undefined> {
  const ready = await waitForAgentReady(8_000, 500);
  if (!ready) {
    logger.warn('[social-triggers] getLocalXOAuth: local agent not ready');
    return undefined;
  }

  const profileCandidates = Array.from(new Set(
    [profileLabel, 'default'].filter((value): value is string => !!String(value || '').trim()),
  ));

  for (let attempt = 0; attempt < 3; attempt++) {
    for (const profile of profileCandidates) {
      try {
        const out = await execAgentOAuthTool('get_oauth_token', {
          provider: 'x',
          ...(profile ? { profileLabel: profile } : {}),
        });
        if (out?.ok === false) continue;
        const parsed = parseOAuthTokenPayload(out?.token || out?.result?.token);
        if (parsed) return parsed;
      } catch (e: any) {
        logger.warn(`[social-triggers] getLocalXOAuth attempt ${attempt + 1} failed:`, e?.message || e);
      }
    }

    try {
      const listed = await execAgentOAuthTool('oauth_list', {});
      const tokens = listed?.tokens || listed?.result?.tokens;
      if (listed?.ok !== false && Array.isArray(tokens)) {
        const match = tokens.find((token: any) => {
          const provider = String(token?.provider || '').toLowerCase();
          if (provider !== 'x') return false;
          if (!profileLabel) return !!token?.isDefault || token?.profileLabel === 'default';
          return token?.profileLabel === profileLabel || !!token?.isDefault;
        }) || tokens.find((token: any) => String(token?.provider || '').toLowerCase() === 'x');
        const parsed = parseOAuthTokenPayload(match);
        if (parsed) return parsed;
      }
    } catch (e: any) {
      logger.warn(`[social-triggers] getLocalXOAuth oauth_list attempt ${attempt + 1} failed:`, e?.message || e);
    }

    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
    }
  }

  logger.warn('[social-triggers] getLocalXOAuth: no device-local X token found');
  return undefined;
}

/**
 * Persist a rotated X OAuth token back into the device-local agent store. When a
 * relayed token has expired, cloud-ai refreshes it during trigger registration
 * and returns the rotated pair (X rotates refresh tokens on use). Without this
 * write-back the local store would keep the now-invalidated refresh token and the
 * user's X tools would break until they reconnect.
 */
export async function persistRefreshedXOAuth(
  profileLabel: string | undefined,
  refreshed: { accessToken?: string; refreshToken?: string | null; expiresAt?: string | null; scopes?: string[] } | undefined,
): Promise<void> {
  const accessToken = String(refreshed?.accessToken || '').trim();
  if (!accessToken) return;
  try {
    await execAgentOAuthTool('store_oauth_tokens', {
      replace: false,
      tokens: [{
        provider: 'x',
        profileLabel: profileLabel || 'default',
        accessToken,
        refreshToken: refreshed?.refreshToken ?? null,
        expiresAt: refreshed?.expiresAt ?? null,
        scopes: Array.isArray(refreshed?.scopes) ? refreshed!.scopes : [],
      }],
    });
  } catch (e: any) {
    logger.warn('[social-triggers] persistRefreshedXOAuth failed:', e?.message || e);
  }
}

export function socialTriggerSourceKey(scope: string, ownerId: string, triggerId: string): string {
  return `${scope}:${ownerId}:${triggerId}`;
}

export async function registerSocialNativeTrigger(input: {
  ownerId: string;
  triggerId: string;
  type: SocialNativeTriggerType;
  args?: Record<string, any>;
  sourceKey: string;
}): Promise<{ ok: boolean; error?: string; hint?: string }> {
  const token = getMainAccessToken();
  if (!token) return { ok: false, error: 'missing_access_token' };

  const profileLabel = input.type.startsWith('x.')
    ? String((input.args as any)?.profile || '').trim() || undefined
    : undefined;

  try {
    const base = getCloudAiHttpBase();
    const MAX_RETRIES = input.type.startsWith('x.') ? 4 : 1;
    let lastError = 'register_failed';
    let lastHint: string | undefined;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const oauth = input.type.startsWith('x.')
        ? await getLocalXOAuth(profileLabel)
        : undefined;

      const resp = await net.fetch(`${base}/integrations/social/triggers/register`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowId: input.ownerId,
          triggerId: input.triggerId,
          type: input.type,
          args: input.args || {},
          source: input.sourceKey,
          ...(oauth ? { oauth } : {}),
        }),
      });
      const out: any = await resp.json().catch(() => ({}));
      if (resp.ok && out?.ok) {
        if (out.oauthRefreshed) void persistRefreshedXOAuth(profileLabel, out.oauthRefreshed);
        if (out.subscription && out.subscription.ok === false) {
          logger.warn(`[social-triggers] ${input.type} registered but X subscription failed: ${out.subscription.reason || out.subscription.status || 'unknown'} — events may not be delivered`);
        }
        return { ok: true };
      }

      lastError = String(out?.error || `http_${resp.status}`);
      lastHint = out?.hint;
      const retryable = input.type.startsWith('x.')
        && (lastError === 'x_not_connected' || lastError === 'x_external_id_missing' || !oauth);
      if (!retryable || attempt >= MAX_RETRIES - 1) break;
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }

    logger.warn(`[social-triggers] register ${input.type} failed for ${input.ownerId}/${input.triggerId}: ${lastError}`);
    return { ok: false, error: lastError, hint: lastHint };
  } catch (e: any) {
    const err = String(e?.message || 'register_failed');
    logger.warn(`[social-triggers] register ${input.type} failed for ${input.ownerId}/${input.triggerId}:`, e);
    return { ok: false, error: err };
  }
}

export async function unregisterSocialNativeTrigger(input: {
  ownerId: string;
  triggerId: string;
  sourceKey: string;
}): Promise<{ ok: boolean; error?: string }> {
  const token = getMainAccessToken();
  if (!token) return { ok: false, error: 'missing_access_token' };

  try {
    const base = getCloudAiHttpBase();
    const resp = await net.fetch(`${base}/integrations/social/triggers/unregister`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workflowId: input.ownerId,
        triggerId: input.triggerId,
        source: input.sourceKey,
      }),
    });
    const out: any = await resp.json().catch(() => ({}));
    if (!resp.ok || !out?.ok) {
      return { ok: false, error: String(out?.error || `http_${resp.status}`) };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'unregister_failed') };
  }
}

export async function registerGoogleNativeTriggerForOwner(input: {
  ownerId: string;
  triggerId: string;
  type: GoogleNativeTriggerType;
  args?: Record<string, any>;
  sourceKey: string;
}): Promise<{ ok: boolean; error?: string; hint?: string }> {
  const token = getMainAccessToken();
  if (!token) return { ok: false, error: 'missing_access_token' };

  try {
    const base = getCloudAiHttpBase();
    const resp = await net.fetch(`${base}/integrations/google/native-triggers/register`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workflowId: input.ownerId,
        triggerId: input.triggerId,
        type: input.type,
        args: input.args || {},
        source: input.sourceKey,
      }),
    });
    const out: any = await resp.json().catch(() => ({}));
    if (!resp.ok || !out?.ok) {
      const err = String(out?.error || `http_${resp.status}`);
      logger.warn(`[social-triggers] register ${input.type} failed for ${input.ownerId}/${input.triggerId}: ${err}`);
      return { ok: false, error: err, hint: out?.hint };
    }
    return { ok: true };
  } catch (e: any) {
    const err = String(e?.message || 'register_failed');
    logger.warn(`[social-triggers] register ${input.type} failed for ${input.ownerId}/${input.triggerId}:`, e);
    return { ok: false, error: err };
  }
}

export async function unregisterGoogleNativeTriggerForOwner(input: {
  ownerId: string;
  triggerId: string;
  type: GoogleNativeTriggerType;
  sourceKey: string;
}): Promise<{ ok: boolean; error?: string }> {
  const token = getMainAccessToken();
  if (!token) return { ok: false, error: 'missing_access_token' };

  try {
    const base = getCloudAiHttpBase();
    const resp = await net.fetch(`${base}/integrations/google/native-triggers/unregister`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workflowId: input.ownerId,
        triggerId: input.triggerId,
        type: input.type,
        source: input.sourceKey,
      }),
    });
    const out: any = await resp.json().catch(() => ({}));
    if (!resp.ok || !out?.ok) {
      return { ok: false, error: String(out?.error || `http_${resp.status}`) };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'unregister_failed') };
  }
}
