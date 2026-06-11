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
