/**
 * Register/unregister native cloud triggers (X, Instagram social webhooks and
 * Google Gmail/Drive watches) with cloud-ai.
 * Used by workflow runtimes and bot/agent trigger dispatchers.
 */

import { net } from 'electron';
import logger from '../utils/logger';
import { getMainAccessToken } from './auth-session';

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

/**
 * Read the device-local X OAuth token from the agent store so it can be relayed
 * to cloud-ai at registration time. Registering an X trigger needs the user's
 * token once: cloud-ai uses it to derive the X user id and subscribe the account
 * to the app webhook, then drops it (never persisted). Tokens are device-resident
 * per the OAuth-local migration, so cloud-ai can no longer read them from Supabase.
 */
export async function getLocalXOAuth(profileLabel?: string): Promise<{ accessToken: string; refreshToken: string | null } | undefined> {
  try {
    const resp = await net.fetch(`${agentHttpBase()}/v1/tools/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: 'get_oauth_token', args: { provider: 'x', ...(profileLabel ? { profileLabel } : {}) } }),
    });
    const out: any = await resp.json().catch(() => ({}));
    const token = out?.token || out?.result?.token;
    const accessToken = String(token?.accessToken || '').trim();
    if (!resp.ok || !accessToken) return undefined;
    return { accessToken, refreshToken: token?.refreshToken ? String(token.refreshToken) : null };
  } catch {
    return undefined;
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

  // X triggers need the user's X token once for the per-user webhook
  // subscription. Relay the device-local token so cloud-ai doesn't depend on
  // Supabase; it uses the token transiently and never stores it.
  const oauth = input.type.startsWith('x.')
    ? await getLocalXOAuth(String((input.args as any)?.profile || '').trim() || undefined)
    : undefined;

  try {
    const base = getCloudAiHttpBase();
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
