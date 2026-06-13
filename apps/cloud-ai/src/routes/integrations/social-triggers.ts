/**
 * Social webhook triggers — Meta (Instagram) + X (Twitter).
 *
 * Mirrors the google-native-triggers pattern: workflows register a (workflowId, triggerId)
 * against the user's connected account, the provider pushes events to a single webhook URL,
 * and we fan those events back out to the right user via dispatchProviderWebhook.
 *
 * Receiver verification:
 *  - Meta: GET hub.challenge against META_WEBHOOK_VERIFY_TOKEN; POST signed with
 *    `x-hub-signature-256` = sha256 HMAC of the raw body using the app secret.
 *  - X v2: GET CRC challenge — respond with sha256 base64 HMAC of `crc_token`; POST signed
 *    with `x-twitter-webhooks-signature` = sha256 base64 HMAC of the raw body.
 *
 * NOTE: receiving events still requires the provider-side subscription to exist:
 *  - Meta: app subscribed to the webhook fields (App Dashboard) + per-account
 *    `POST /{ig-user-id}/subscribed_apps` (attempted best-effort on register).
 *  - X: app-level webhook (`POST /2/webhooks`) + per-user Account Activity
 *    subscription — both attempted best-effort on register; see
 *    ensureXWebhookRegistered() / ensureXUserSubscribed().
 *
 * Registrations are write-through persisted to Supabase (trigger_registrations)
 * and restored on boot via restoreSocialTriggerRegistrations(), so they survive
 * Cloud Run restarts/redeploys.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { createHmac, timingSafeEqual } from 'crypto';
import { requireAuth, sendJson } from '../../auth/http';
import { getExternalAccount } from '../../supabase';
import { dispatchProviderWebhook } from '../../webhooks/dispatch';
import {
  persistTriggerRegistration,
  deleteTriggerRegistration,
  loadTriggerRegistrations,
} from '../../webhooks/trigger-registration-store';
import { writeLog } from '../../utils/logger';
import {
  INSTAGRAM_APP_SECRET,
  META_APP_SECRET,
  FACEBOOK_APP_SECRET,
  META_WEBHOOK_VERIFY_TOKEN,
  PUBLIC_BASE_URL,
  X_CLIENT_ID,
  X_CLIENT_SECRET,
  X_WEBHOOK_SECRET,
} from '../../utils/config';
import { META_INTEGRATION_ENABLED } from '../../../../../shared/integration-flags';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Cache-Control': 'no-store',
};

export type SocialTriggerType =
  | 'instagram.new_comment'
  | 'instagram.new_mention'
  | 'instagram.new_message'
  | 'x.new_mention'
  | 'x.new_comment'
  | 'x.new_dm'
  | 'x.new_follower'
  | 'x.user_post';

type Provider = 'instagram' | 'x';

type Registration = {
  key: string;
  userId: string;
  workflowId: string;
  triggerId: string;
  type: SocialTriggerType;
  provider: Provider;
  externalId: string; // IG business account id / X user id — what the webhook payload is keyed by
  sourceKeys: string[];
  args: Record<string, any>;
};

// key -> registration
const regs = new Map<string, Registration>();
// `${provider}:${externalId}` -> Set<key>
const regsByExternalId = new Map<string, Set<string>>();

function persistReg(reg: Registration): void {
  void persistTriggerRegistration({
    kind: 'social',
    key: reg.key,
    userId: reg.userId,
    workflowId: reg.workflowId,
    triggerId: reg.triggerId,
    type: reg.type,
    data: {
      provider: reg.provider,
      externalId: reg.externalId,
      sourceKeys: reg.sourceKeys,
      args: reg.args,
    },
  });
}

/**
 * Rebuild the in-memory registries from Supabase so registrations survive
 * Cloud Run restarts/redeploys. Idempotent singleton: kicked off at server
 * boot and awaited by webhook handlers so events that land during the first
 * few hundred ms after a restart aren't dropped.
 */
let socialRestorePromise: Promise<number> | null = null;
export function restoreSocialTriggerRegistrations(): Promise<number> {
  if (!socialRestorePromise) {
    socialRestorePromise = doRestoreSocialTriggerRegistrations().catch((e) => {
      // Allow a retry on the next call rather than caching a failure forever.
      socialRestorePromise = null;
      throw e;
    });
  }
  return socialRestorePromise;
}

async function doRestoreSocialTriggerRegistrations(): Promise<number> {
  const rows = await loadTriggerRegistrations('social');
  let restored = 0;
  for (const row of rows) {
    const type = row.type as SocialTriggerType;
    if (!type.startsWith('instagram.') && !type.startsWith('x.')) continue;
    if (!META_INTEGRATION_ENABLED && type.startsWith('instagram.')) continue;
    const externalId = String(row.data?.externalId || '').trim();
    if (!externalId) continue;
    const provider = providerOf(type);
    const reg: Registration = {
      key: row.key,
      userId: row.userId,
      workflowId: row.workflowId,
      triggerId: row.triggerId,
      type,
      provider,
      externalId,
      sourceKeys: Array.isArray(row.data?.sourceKeys) && row.data.sourceKeys.length > 0
        ? row.data.sourceKeys.map((v: any) => String(v || '').trim()).filter(Boolean)
        : [defaultTriggerSourceKey(row.workflowId, row.triggerId)],
      args: row.data?.args && typeof row.data.args === 'object' ? row.data.args : {},
    };
    if (regs.has(reg.key)) continue;
    regs.set(reg.key, reg);
    indexExternalId(provider, externalId, reg.key);
    restored++;
  }
  if (restored > 0) writeLog('social_trigger_registrations_restored', { count: restored });
  return restored;
}

function providerOf(type: SocialTriggerType): Provider {
  return type.startsWith('x.') ? 'x' : 'instagram';
}

function nativeKey(userId: string, workflowId: string, triggerId: string): string {
  return `${userId}:${workflowId}:${triggerId}`;
}

function externalIndexKey(provider: Provider, externalId: string): string {
  return `${provider}:${String(externalId).trim()}`;
}

function defaultTriggerSourceKey(workflowId: string, triggerId: string): string {
  return `desktop:${workflowId}:${triggerId}`;
}

function normalizeSourceKey(sourceKey: string | undefined, workflowId: string, triggerId: string): string {
  return String(sourceKey || '').trim() || defaultTriggerSourceKey(workflowId, triggerId);
}

function addSourceKey(list: string[] | undefined, sourceKey: string): string[] {
  const next = new Set((list || []).map((v) => String(v || '').trim()).filter(Boolean));
  next.add(sourceKey);
  return Array.from(next);
}

function removeSourceKey(list: string[] | undefined, sourceKey: string): string[] {
  return (list || []).map((v) => String(v || '').trim()).filter((v) => v && v !== sourceKey);
}

function indexExternalId(provider: Provider, externalId: string, key: string) {
  const idx = externalIndexKey(provider, externalId);
  const set = regsByExternalId.get(idx) || new Set<string>();
  set.add(key);
  regsByExternalId.set(idx, set);
}

function deindexExternalId(provider: Provider, externalId: string, key: string) {
  const idx = externalIndexKey(provider, externalId);
  const set = regsByExternalId.get(idx);
  if (!set) return;
  set.delete(key);
  if (set.size === 0) regsByExternalId.delete(idx);
}

function registrationsForExternalId(provider: Provider, externalId: string, type?: SocialTriggerType): Registration[] {
  const set = regsByExternalId.get(externalIndexKey(provider, externalId));
  if (!set) return [];
  const out: Registration[] = [];
  for (const key of set) {
    const reg = regs.get(key);
    if (!reg) continue;
    if (type && reg.type !== type) continue;
    out.push(reg);
  }
  return out;
}

async function readRawBody(req: IncomingMessage): Promise<{ raw: string; json: any }> {
  return await new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: any) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let json: any = {};
      if (raw) { try { json = JSON.parse(raw); } catch { json = {}; } }
      resolve({ raw, json });
    });
    req.on('error', () => resolve({ raw: '', json: {} }));
  });
}

function safeEqualHex(a: string, b: string): boolean {
  try {
    const ab = Buffer.from(a, 'utf8');
    const bb = Buffer.from(b, 'utf8');
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

/** Resolve the provider-side account id we'll receive events under for this user. */
async function resolveExternalId(userId: string, provider: Provider, profileLabel?: string): Promise<string> {
  const acc = await getExternalAccount(userId, provider, profileLabel);
  if (!acc) throw new Error(`${provider}_not_connected`);
  const externalId = String(
    acc?.meta?.external_user_id || acc?.meta?.profile?.id || acc?.meta?.profile?.user_id || ''
  ).trim();
  if (!externalId) throw new Error(`${provider}_external_id_missing`);
  return externalId;
}

/** Best-effort: subscribe this IG account to the app so Meta delivers webhook events for it. */
async function ensureInstagramSubscribed(userId: string, externalId: string, profileLabel?: string): Promise<void> {
  try {
    const acc = await getExternalAccount(userId, 'instagram', profileLabel);
    const token = String(acc?.access_token || '').trim();
    if (!token) return;
    await fetch(`https://graph.instagram.com/v22.0/${encodeURIComponent(externalId)}/subscribed_apps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ access_token: token }),
    });
  } catch {
    // Non-fatal: registration still works; events just won't flow until the subscription exists.
  }
}

// ---------------------------------------------------------------------------
// X (Twitter) provider-side subscription
//
// Receiving X events requires two provider-side resources beyond our receiver:
//  1. An app-level webhook (POST /2/webhooks) pointing at our /integrations/x/webhook
//     URL — created once per environment with an app-only bearer token.
//  2. A per-user Account Activity subscription
//     (POST /2/account_activity/webhooks/:id/subscriptions/all) using the
//     user's OAuth2 token.
// Both are best-effort: registration always succeeds locally; failures are
// logged and surfaced as hints so the desktop can tell the user what's missing.
// ---------------------------------------------------------------------------

const X_API_BASE = 'https://api.x.com';
let xAppBearerCache: { token: string; fetchedAt: number } | null = null;
let xWebhookIdCache: string | null = null;
const xSubscribedExternalIds = new Set<string>();

async function getXAppBearerToken(): Promise<string | null> {
  const envToken = String(process.env.X_BEARER_TOKEN || '').trim();
  if (envToken) return envToken;
  if (xAppBearerCache && Date.now() - xAppBearerCache.fetchedAt < 60 * 60 * 1000) {
    return xAppBearerCache.token;
  }
  // App-only bearer tokens are minted from the CONSUMER key/secret (OAuth 1.0a
  // app credentials) — X_WEBHOOK_SECRET already holds the consumer secret
  // (it also signs CRC/webhook payloads). The OAuth2 client pair is a last
  // resort and may be rejected by X.
  const consumerKey = String(process.env.X_CONSUMER_KEY || process.env.X_API_KEY || '').trim();
  const candidates: Array<[string, string]> = [];
  if (consumerKey && X_WEBHOOK_SECRET) candidates.push([consumerKey, X_WEBHOOK_SECRET]);
  if (X_CLIENT_ID && X_CLIENT_SECRET) candidates.push([X_CLIENT_ID, X_CLIENT_SECRET]);
  for (const [id, secret] of candidates) {
    try {
      const basic = Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`).toString('base64');
      const resp = await fetch(`${X_API_BASE}/oauth2/token`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ grant_type: 'client_credentials' }),
      });
      const body: any = await resp.json().catch(() => ({}));
      const token = String(body?.access_token || '').trim();
      if (resp.ok && token) {
        xAppBearerCache = { token, fetchedAt: Date.now() };
        return token;
      }
      writeLog('x_app_bearer_failed', { status: resp.status, error: body?.error || body?.title || null });
    } catch (e: any) {
      writeLog('x_app_bearer_failed', { error: String(e?.message || e) });
    }
  }
  return null;
}

function xWebhookCallbackUrl(): string {
  const base = String(PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  return base ? `${base}/integrations/x/webhook` : '';
}

/** Ensure the app-level X webhook exists; returns its id or null. */
async function ensureXWebhookRegistered(): Promise<string | null> {
  if (xWebhookIdCache) return xWebhookIdCache;
  const callbackUrl = xWebhookCallbackUrl();
  if (!callbackUrl || !X_WEBHOOK_SECRET) {
    writeLog('x_webhook_ensure_skipped', { reason: !callbackUrl ? 'no_public_base_url' : 'no_webhook_secret' });
    return null;
  }
  const bearer = await getXAppBearerToken();
  if (!bearer) return null;

  try {
    const listResp = await fetch(`${X_API_BASE}/2/webhooks`, {
      headers: { Authorization: `Bearer ${bearer}` },
    });
    const listBody: any = await listResp.json().catch(() => ({}));
    if (listResp.ok) {
      const hooks: any[] = Array.isArray(listBody?.data) ? listBody.data : [];
      const existing = hooks.find((h: any) => String(h?.url || '') === callbackUrl);
      if (existing?.id) {
        xWebhookIdCache = String(existing.id);
        return xWebhookIdCache;
      }
    }

    const createResp = await fetch(`${X_API_BASE}/2/webhooks`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: callbackUrl }),
    });
    const createBody: any = await createResp.json().catch(() => ({}));
    const id = String(createBody?.data?.id || createBody?.id || '').trim();
    if (createResp.ok && id) {
      xWebhookIdCache = id;
      writeLog('x_webhook_created', { id, url: callbackUrl });
      return id;
    }
    writeLog('x_webhook_create_failed', {
      status: createResp.status,
      error: createBody?.detail || createBody?.title || createBody?.errors?.[0]?.message || null,
    });
  } catch (e: any) {
    writeLog('x_webhook_create_failed', { error: String(e?.message || e) });
  }
  return null;
}

/** Best-effort: add a per-user Account Activity subscription for this X account. */
async function ensureXUserSubscribed(userId: string, externalId: string, profileLabel?: string): Promise<void> {
  if (xSubscribedExternalIds.has(externalId)) return;
  const webhookId = await ensureXWebhookRegistered();
  if (!webhookId) return;
  try {
    const acc = await getExternalAccount(userId, 'x', profileLabel);
    const token = String(acc?.access_token || '').trim();
    if (!token) return;
    const resp = await fetch(`${X_API_BASE}/2/account_activity/webhooks/${encodeURIComponent(webhookId)}/subscriptions/all`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (resp.ok) {
      xSubscribedExternalIds.add(externalId);
      writeLog('x_user_subscribed', { externalId, webhookId });
      return;
    }
    const body: any = await resp.json().catch(() => ({}));
    // 409 = already subscribed — treat as success.
    if (resp.status === 409) {
      xSubscribedExternalIds.add(externalId);
      return;
    }
    writeLog('x_user_subscribe_failed', {
      externalId,
      status: resp.status,
      error: body?.detail || body?.title || body?.errors?.[0]?.message || null,
    });
  } catch (e: any) {
    writeLog('x_user_subscribe_failed', { externalId, error: String(e?.message || e) });
  }
}

export async function registerSocialTrigger(
  userId: string,
  workflowId: string,
  triggerId: string,
  type: SocialTriggerType,
  args: any,
  sourceKey?: string,
) {
  // Make sure persisted registrations are loaded first so a re-register right
  // after a restart merges source keys instead of clobbering them.
  await restoreSocialTriggerRegistrations().catch(() => {});
  const provider = providerOf(type);
  const key = nativeKey(userId, workflowId, triggerId);
  const normalizedSourceKey = normalizeSourceKey(sourceKey, workflowId, triggerId);
  const profileLabel = String(args?.profile || '').trim() || undefined;

  const existing = regs.get(key);
  if (existing) {
    existing.sourceKeys = addSourceKey(existing.sourceKeys, normalizedSourceKey);
    existing.type = type;
    existing.args = { ...(args || {}) };
    regs.set(key, existing);
    indexExternalId(provider, existing.externalId, key);
    persistReg(existing);
    return { ok: true, registration: { type, workflowId, triggerId, externalId: existing.externalId, args: existing.args } };
  }

  const externalId = await resolveExternalId(userId, provider, profileLabel);
  const reg: Registration = {
    key, userId, workflowId, triggerId, type, provider, externalId,
    sourceKeys: [normalizedSourceKey],
    args: { ...(args || {}) },
  };
  regs.set(key, reg);
  indexExternalId(provider, externalId, key);
  persistReg(reg);

  if (provider === 'instagram') {
    void ensureInstagramSubscribed(userId, externalId, profileLabel);
  } else if (provider === 'x') {
    void ensureXUserSubscribed(userId, externalId, profileLabel);
  }

  return { ok: true, registration: { type, workflowId, triggerId, externalId, args: reg.args } };
}

export async function unregisterSocialTrigger(
  userId: string,
  workflowId: string,
  triggerId: string,
  sourceKey?: string,
) {
  await restoreSocialTriggerRegistrations().catch(() => {});
  const key = nativeKey(userId, workflowId, triggerId);
  const existing = regs.get(key);
  if (!existing) return { ok: true, removed: false };

  const normalizedSourceKey = normalizeSourceKey(sourceKey, workflowId, triggerId);
  const remaining = removeSourceKey(existing.sourceKeys, normalizedSourceKey);
  if (remaining.length > 0) {
    existing.sourceKeys = remaining;
    regs.set(key, existing);
    persistReg(existing);
    return { ok: true, removed: false, detached: true };
  }

  regs.delete(key);
  deindexExternalId(existing.provider, existing.externalId, key);
  void deleteTriggerRegistration('social', key);
  return { ok: true, removed: true };
}

// ---------------------------------------------------------------------------
// Meta (Instagram) webhook receiver
// ---------------------------------------------------------------------------

function verifyMetaSignature(raw: string, header: string): boolean {
  const provided = String(header || '').trim();
  if (!provided.startsWith('sha256=')) return false;
  const sig = provided.slice('sha256='.length);
  const secrets = [INSTAGRAM_APP_SECRET, META_APP_SECRET, FACEBOOK_APP_SECRET].filter(Boolean);
  for (const secret of secrets) {
    const expected = createHmac('sha256', secret).update(raw, 'utf8').digest('hex');
    if (safeEqualHex(sig, expected)) return true;
  }
  return false;
}

function instagramTypeForField(field: string): SocialTriggerType | null {
  const f = String(field || '').toLowerCase();
  if (f === 'comments') return 'instagram.new_comment';
  if (f === 'mentions' || f === 'mention') return 'instagram.new_mention';
  if (f === 'messages' || f === 'messaging') return 'instagram.new_message';
  return null;
}

async function handleInstagramEvents(payload: any): Promise<void> {
  await restoreSocialTriggerRegistrations().catch(() => {});
  const entries: any[] = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const entry of entries) {
    const igId = String(entry?.id || '').trim();
    if (!igId) continue;

    // Field-based changes (comments, mentions)
    const changes: any[] = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const type = instagramTypeForField(change?.field);
      if (!type) continue;
      const matches = registrationsForExternalId('instagram', igId, type);
      for (const reg of matches) {
        await dispatchProviderWebhook(
          reg.userId, 'instagram', type,
          `ig-${type}-${igId}-${Date.now()}`,
          { event: type, igAccountId: igId, field: change?.field, value: change?.value },
          reg.workflowId, reg.triggerId, reg.sourceKeys,
        );
      }
    }

    // Messaging events (DMs)
    const messaging: any[] = Array.isArray(entry?.messaging) ? entry.messaging : [];
    if (messaging.length > 0) {
      const matches = registrationsForExternalId('instagram', igId, 'instagram.new_message');
      for (const reg of matches) {
        for (const msg of messaging) {
          await dispatchProviderWebhook(
            reg.userId, 'instagram', 'instagram.new_message',
            `ig-message-${igId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            { event: 'instagram.new_message', igAccountId: igId, messaging: msg },
            reg.workflowId, reg.triggerId, reg.sourceKeys,
          );
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// X (Twitter) v2 webhook receiver
// ---------------------------------------------------------------------------

function xCrcResponse(crcToken: string): string {
  return 'sha256=' + createHmac('sha256', X_WEBHOOK_SECRET).update(crcToken, 'utf8').digest('base64');
}

function verifyXSignature(raw: string, header: string): boolean {
  const provided = String(header || '').trim();
  if (!provided.startsWith('sha256=') || !X_WEBHOOK_SECRET) return false;
  const expected = 'sha256=' + createHmac('sha256', X_WEBHOOK_SECRET).update(raw, 'utf8').digest('base64');
  return safeEqualHex(provided, expected);
}

function xTweetAuthorId(tweet: any): string {
  return String(tweet?.user?.id_str || tweet?.user?.id || tweet?.author_id || '').trim();
}

function xInReplyToUserId(tweet: any): string | null {
  const id = tweet?.in_reply_to_user_id_str ?? tweet?.in_reply_to_user_id;
  return id != null && String(id).trim() ? String(id).trim() : null;
}

function xInReplyToStatusId(tweet: any): string | null {
  const direct = tweet?.in_reply_to_status_id_str ?? tweet?.in_reply_to_status_id;
  if (direct != null && String(direct).trim()) return String(direct).trim();
  const ref = (tweet?.referenced_tweets || []).find((r: any) => r?.type === 'replied_to');
  return ref?.id ? String(ref.id).trim() : null;
}

function isXRetweet(tweet: any): boolean {
  if (tweet?.retweeted_status) return true;
  return (tweet?.referenced_tweets || []).some((r: any) => r?.type === 'retweeted');
}

/** Reply addressed to the subscribed user (comment on their post or reply to their comment). */
export function isXReplyToUser(tweet: any, xUserId: string): boolean {
  if (!tweet || isXRetweet(tweet)) return false;
  if (xTweetAuthorId(tweet) === xUserId) return false;
  if (xInReplyToUserId(tweet) !== xUserId) return false;
  return !!xInReplyToStatusId(tweet);
}

/** New top-level post authored by the subscribed user (not a reply or retweet). */
export function isXUserPost(tweet: any, xUserId: string): boolean {
  if (!tweet || isXRetweet(tweet)) return false;
  if (xTweetAuthorId(tweet) !== xUserId) return false;
  return !xInReplyToStatusId(tweet);
}

/** @-mention of the subscribed user that is not a threaded reply. */
export function isXMentionOfUser(tweet: any, xUserId: string): boolean {
  if (!tweet || isXRetweet(tweet)) return false;
  if (isXReplyToUser(tweet, xUserId)) return false;
  const mentions = tweet?.entities?.user_mentions || tweet?.entities?.mentions || [];
  if (!Array.isArray(mentions)) return false;
  return mentions.some((m: any) => String(m?.id_str || m?.id || '') === xUserId);
}

/** Split Account Activity tweet_create_events into user posts, comments, and mentions. */
export function classifyXTweets(tweets: any[], xUserId: string): {
  userPosts: any[];
  comments: any[];
  mentions: any[];
} {
  const userPosts: any[] = [];
  const comments: any[] = [];
  const mentions: any[] = [];

  for (const tweet of tweets) {
    if (!tweet || typeof tweet !== 'object') continue;
    if (isXUserPost(tweet, xUserId)) {
      userPosts.push(tweet);
      continue;
    }
    if (isXReplyToUser(tweet, xUserId)) {
      comments.push(tweet);
      continue;
    }
    if (isXMentionOfUser(tweet, xUserId)) {
      mentions.push(tweet);
    }
  }

  return { userPosts, comments, mentions };
}

function cleanXUsername(username?: string): string | undefined {
  const cleaned = String(username || '').trim().replace(/^@+/, '');
  return cleaned || undefined;
}

/** Accept a numeric post id or an x.com status URL. */
export function normalizeXPostId(input?: string): string | undefined {
  const raw = String(input || '').trim();
  if (!raw) return undefined;
  const urlMatch = raw.match(/status\/(\d+)/i);
  if (urlMatch?.[1]) return urlMatch[1];
  return raw;
}

function xConversationId(tweet: any): string | null {
  const id = tweet?.conversation_id;
  return id != null && String(id).trim() ? String(id).trim() : null;
}

function xTweetAuthorUsername(tweet: any): string | undefined {
  return cleanXUsername(tweet?.user?.screen_name || tweet?.user?.username);
}

/** True when the comment belongs to the configured post filter. */
export function matchesXPostFilter(tweet: any, postId: string, onlyDirect: boolean): boolean {
  const pid = String(postId).trim();
  if (!pid) return true;
  const replyTo = xInReplyToStatusId(tweet);
  if (onlyDirect) return replyTo === pid;
  if (replyTo === pid) return true;
  return xConversationId(tweet) === pid;
}

/** Apply x.new_comment trigger args before dispatching a webhook event. */
export function xCommentMatchesTriggerArgs(tweet: any, args: Record<string, any> | undefined): boolean {
  const postId = normalizeXPostId(args?.post_id);
  if (postId && !matchesXPostFilter(tweet, postId, args?.only_direct_post_replies === true)) {
    return false;
  }

  const from = cleanXUsername(args?.from_username);
  if (from && xTweetAuthorUsername(tweet) !== from) {
    return false;
  }

  const needle = String(args?.contains_text || '').trim();
  if (needle && !String(tweet?.text || '').toLowerCase().includes(needle.toLowerCase())) {
    return false;
  }

  return true;
}

function eventMatchesRegistrationFilters(
  type: SocialTriggerType,
  event: any,
  args: Record<string, any> | undefined,
): boolean {
  if (type === 'x.new_comment') {
    return xCommentMatchesTriggerArgs(event, args);
  }
  return true;
}

async function handleXEvents(payload: any): Promise<void> {
  await restoreSocialTriggerRegistrations().catch(() => {});
  const xUserId = String(payload?.for_user_id || payload?.for_user || '').trim();
  if (!xUserId) return;

  const dispatch = async (type: SocialTriggerType, events: any[]) => {
    if (!Array.isArray(events) || events.length === 0) return;
    const matches = registrationsForExternalId('x', xUserId, type);
    for (const reg of matches) {
      for (const ev of events) {
        if (!eventMatchesRegistrationFilters(type, ev, reg.args)) continue;
        await dispatchProviderWebhook(
          reg.userId, 'x', type,
          `x-${type}-${xUserId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          { event: type, xUserId, data: ev },
          reg.workflowId, reg.triggerId, reg.sourceKeys,
        );
      }
    }
  };

  const tweets: any[] = [
    ...(Array.isArray(payload?.tweet_create_events) ? payload.tweet_create_events : []),
    ...(Array.isArray(payload?.post_create_events) ? payload.post_create_events : []),
  ];
  const { userPosts, comments, mentions } = classifyXTweets(tweets, xUserId);

  await dispatch('x.user_post', userPosts);
  await dispatch('x.new_comment', comments);

  const mentionEvents: any[] = Array.isArray(payload?.mention_events) ? payload.mention_events : [];
  await dispatch('x.new_mention', mentionEvents.length > 0 ? mentionEvents : mentions);
  await dispatch('x.new_dm', payload?.direct_message_events || payload?.dm_events || []);
  await dispatch('x.new_follower', payload?.follow_events || []);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function handleSocialTriggerRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parsedUrl: URL,
): Promise<boolean> {
  const pathname = parsedUrl.pathname || '';
  const method = String(req.method || 'GET').toUpperCase();

  const OWNED = (
    pathname === '/integrations/social/triggers/register' ||
    pathname === '/integrations/social/triggers/unregister' ||
    pathname === '/integrations/meta/webhook' ||
    pathname === '/integrations/x/webhook'
  );
  if (!OWNED) return false;

  if (method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return true;
  }

  // --- Meta webhook verification (GET) ---
  if (method === 'GET' && pathname === '/integrations/meta/webhook') {
    if (!META_INTEGRATION_ENABLED) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return true;
    }
    const mode = parsedUrl.searchParams.get('hub.mode') || '';
    const token = parsedUrl.searchParams.get('hub.verify_token') || '';
    const challenge = parsedUrl.searchParams.get('hub.challenge') || '';
    if (mode === 'subscribe' && token && token === META_WEBHOOK_VERIFY_TOKEN) {
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      res.end(challenge);
      return true;
    }
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('forbidden');
    return true;
  }

  // --- Meta webhook events (POST) ---
  if (method === 'POST' && pathname === '/integrations/meta/webhook') {
    if (!META_INTEGRATION_ENABLED) {
      sendJson(res, 404, { ok: false, error: 'not_found' });
      return true;
    }
    const { raw, json } = await readRawBody(req);
    const sig = String(req.headers['x-hub-signature-256'] || '');
    if (!verifyMetaSignature(raw, sig)) {
      sendJson(res, 403, { ok: false, error: 'invalid_signature' });
      return true;
    }
    // Ack fast; process out of band so Meta doesn't retry on slow handlers.
    void handleInstagramEvents(json).catch(() => {});
    sendJson(res, 200, { ok: true });
    return true;
  }

  // --- X webhook CRC challenge (GET) ---
  if (method === 'GET' && pathname === '/integrations/x/webhook') {
    const crcToken = parsedUrl.searchParams.get('crc_token') || '';
    if (!crcToken || !X_WEBHOOK_SECRET) {
      sendJson(res, 400, { ok: false, error: 'missing_crc_token_or_secret' });
      return true;
    }
    sendJson(res, 200, { response_token: xCrcResponse(crcToken) });
    return true;
  }

  // --- X webhook events (POST) ---
  if (method === 'POST' && pathname === '/integrations/x/webhook') {
    const { raw, json } = await readRawBody(req);
    const sig = String(req.headers['x-twitter-webhooks-signature'] || '');
    if (!verifyXSignature(raw, sig)) {
      sendJson(res, 403, { ok: false, error: 'invalid_signature' });
      return true;
    }
    void handleXEvents(json).catch(() => {});
    sendJson(res, 200, { ok: true });
    return true;
  }

  // --- register / unregister (authenticated) ---
  if (method === 'POST' && pathname === '/integrations/social/triggers/register') {
    const auth = await requireAuth(req, res, { rateLimit: true });
    if (!auth?.success || !auth.userId) return true;
    const { json: body } = await readRawBody(req);
    const type = String(body?.type || '').trim() as SocialTriggerType;
    const workflowId = String(body?.workflowId || '').trim();
    const triggerId = String(body?.triggerId || '').trim();
    const source = String(body?.source || '').trim() || undefined;
    if (!workflowId || !triggerId) {
      sendJson(res, 400, { ok: false, error: 'workflowId_and_triggerId_required' });
      return true;
    }
    if (!type.startsWith('instagram.') && !type.startsWith('x.')) {
      sendJson(res, 400, { ok: false, error: 'unsupported_trigger_type' });
      return true;
    }
    if (!META_INTEGRATION_ENABLED && type.startsWith('instagram.')) {
      sendJson(res, 400, { ok: false, error: 'instagram_triggers_disabled' });
      return true;
    }
    try {
      const out = await registerSocialTrigger(auth.userId, workflowId, triggerId, type, body?.args || {}, source);
      sendJson(res, 200, out);
    } catch (e: any) {
      const msg = String(e?.message || 'register_failed');
      const detail: Record<string, any> = { ok: false, error: msg };
      if (msg.endsWith('_not_connected')) detail.hint = 'Connect the account in Settings > Integrations first';
      else if (msg.endsWith('_external_id_missing')) detail.hint = 'Reconnect the account so its id is stored';
      sendJson(res, 400, detail);
    }
    return true;
  }

  if (method === 'POST' && pathname === '/integrations/social/triggers/unregister') {
    const auth = await requireAuth(req, res, { rateLimit: true });
    if (!auth?.success || !auth.userId) return true;
    const { json: body } = await readRawBody(req);
    const workflowId = String(body?.workflowId || '').trim();
    const triggerId = String(body?.triggerId || '').trim();
    const source = String(body?.source || '').trim() || undefined;
    if (!workflowId || !triggerId) {
      sendJson(res, 400, { ok: false, error: 'workflowId_and_triggerId_required' });
      return true;
    }
    try {
      const out = await unregisterSocialTrigger(auth.userId, workflowId, triggerId, source);
      sendJson(res, 200, out);
    } catch (e: any) {
      sendJson(res, 400, { ok: false, error: String(e?.message || 'unregister_failed') });
    }
    return true;
  }

  return false;
}
