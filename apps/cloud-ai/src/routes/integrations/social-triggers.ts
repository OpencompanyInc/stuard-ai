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
 *  - X: the app-level webhook must be created once via `POST /2/webhooks`, then a
 *    per-user subscription added. See ensureXWebhookRegistered() — flagged TODO.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { createHmac, timingSafeEqual } from 'crypto';
import { requireAuth, sendJson } from '../../auth/http';
import { getExternalAccount } from '../../supabase';
import { dispatchProviderWebhook } from '../../webhooks/dispatch';
import {
  INSTAGRAM_APP_SECRET,
  META_APP_SECRET,
  FACEBOOK_APP_SECRET,
  META_WEBHOOK_VERIFY_TOKEN,
  X_WEBHOOK_SECRET,
} from '../../utils/config';

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
};

// key -> registration
const regs = new Map<string, Registration>();
// `${provider}:${externalId}` -> Set<key>
const regsByExternalId = new Map<string, Set<string>>();

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

export async function registerSocialTrigger(
  userId: string,
  workflowId: string,
  triggerId: string,
  type: SocialTriggerType,
  args: any,
  sourceKey?: string,
) {
  const provider = providerOf(type);
  const key = nativeKey(userId, workflowId, triggerId);
  const normalizedSourceKey = normalizeSourceKey(sourceKey, workflowId, triggerId);
  const profileLabel = String(args?.profile || '').trim() || undefined;

  const existing = regs.get(key);
  if (existing) {
    existing.sourceKeys = addSourceKey(existing.sourceKeys, normalizedSourceKey);
    existing.type = type;
    regs.set(key, existing);
    indexExternalId(provider, existing.externalId, key);
    return { ok: true, registration: { type, workflowId, triggerId, externalId: existing.externalId } };
  }

  const externalId = await resolveExternalId(userId, provider, profileLabel);
  const reg: Registration = {
    key, userId, workflowId, triggerId, type, provider, externalId,
    sourceKeys: [normalizedSourceKey],
  };
  regs.set(key, reg);
  indexExternalId(provider, externalId, key);

  if (provider === 'instagram') {
    void ensureInstagramSubscribed(userId, externalId, profileLabel);
  }
  // TODO(x): ensure app-level webhook + per-user subscription via POST /2/webhooks + subscriptions.

  return { ok: true, registration: { type, workflowId, triggerId, externalId } };
}

export async function unregisterSocialTrigger(
  userId: string,
  workflowId: string,
  triggerId: string,
  sourceKey?: string,
) {
  const key = nativeKey(userId, workflowId, triggerId);
  const existing = regs.get(key);
  if (!existing) return { ok: true, removed: false };

  const normalizedSourceKey = normalizeSourceKey(sourceKey, workflowId, triggerId);
  const remaining = removeSourceKey(existing.sourceKeys, normalizedSourceKey);
  if (remaining.length > 0) {
    existing.sourceKeys = remaining;
    regs.set(key, existing);
    return { ok: true, removed: false, detached: true };
  }

  regs.delete(key);
  deindexExternalId(existing.provider, existing.externalId, key);
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
          reg.workflowId, reg.triggerId,
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
            reg.workflowId, reg.triggerId,
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

async function handleXEvents(payload: any): Promise<void> {
  const xUserId = String(payload?.for_user_id || payload?.for_user || '').trim();
  if (!xUserId) return;

  const dispatch = async (type: SocialTriggerType, events: any[]) => {
    if (!Array.isArray(events) || events.length === 0) return;
    const matches = registrationsForExternalId('x', xUserId, type);
    for (const reg of matches) {
      for (const ev of events) {
        await dispatchProviderWebhook(
          reg.userId, 'x', type,
          `x-${type}-${xUserId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          { event: type, xUserId, data: ev },
          reg.workflowId, reg.triggerId,
        );
      }
    }
  };

  // v2 + legacy Account Activity payload shapes.
  await dispatch('x.user_post', payload?.tweet_create_events || payload?.post_create_events || []);
  await dispatch('x.new_mention', payload?.mention_events || []);
  await dispatch('x.new_dm', payload?.direct_message_events || payload?.dm_events || []);
  await dispatch('x.new_follower', payload?.follow_events || []);

  // tweet_create_events that @-mention the user also fire new_mention when no dedicated array exists.
  const tweets: any[] = Array.isArray(payload?.tweet_create_events) ? payload.tweet_create_events : [];
  if (tweets.length > 0 && !Array.isArray(payload?.mention_events)) {
    const mentioning = tweets.filter((t) => {
      const mentions = t?.entities?.user_mentions || t?.entities?.mentions || [];
      return Array.isArray(mentions) && mentions.some((m: any) => String(m?.id_str || m?.id || '') === xUserId);
    });
    await dispatch('x.new_mention', mentioning);
  }
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
