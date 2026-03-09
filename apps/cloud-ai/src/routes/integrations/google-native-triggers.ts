import type { IncomingMessage, ServerResponse } from 'http';
import { randomUUID } from 'crypto';
import { requireAuth, sendJson } from '../../auth/http';
import { getExternalAccount } from '../../supabase';
import { refreshGoogleTokenIfNeeded } from './google-shared';
import { PUBLIC_BASE_URL } from '../../utils/config';
import { dispatchProviderWebhook } from '../../webhooks/dispatch';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Cache-Control': 'no-store',
};

type NativeTriggerType = 'gmail.new_email' | 'drive.new_file';

type GmailNativeRegistration = {
  key: string;
  userId: string;
  workflowId: string;
  triggerId: string;
  profileLabel: string;
  accountEmail: string;
  labelIds: string[];
  lastHistoryId: string;
  expirationMs?: number;
};

type DriveNativeRegistration = {
  key: string;
  userId: string;
  workflowId: string;
  triggerId: string;
  profileLabel: string;
  accountEmail: string;
  channelId: string;
  channelToken: string;
  resourceId: string;
  pageToken: string;
  includeFolders: boolean;
  onlyNew: boolean;
  registeredAtMs: number;
  expirationMs?: number;
};

const gmailRegs = new Map<string, GmailNativeRegistration>();
const gmailKeysByEmail = new Map<string, Set<string>>();
const driveRegs = new Map<string, DriveNativeRegistration>();
const driveRegKeyByChannelId = new Map<string, string>();
const RENEW_CHECK_MS = 30 * 60 * 1000;
const RENEW_WINDOW_MS = 12 * 60 * 60 * 1000;

function parseNumber(input: any): number | undefined {
  const n = Number(input);
  return Number.isFinite(n) ? n : undefined;
}

async function readJsonBody(req: IncomingMessage): Promise<any> {
  return await new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: any) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

function normalizeProfileLabel(input: any): string {
  const p = String(input || '').trim();
  return p || 'default';
}

function normalizeStringArray(input: any): string[] {
  if (!Array.isArray(input)) return [];
  return input.map((v) => String(v || '').trim()).filter(Boolean);
}

function nativeKey(userId: string, workflowId: string, triggerId: string): string {
  return `${userId}:${workflowId}:${triggerId}`;
}

function hasScope(acc: any, scope: string): boolean {
  const have = new Set<string>((Array.isArray(acc?.scopes) ? acc.scopes : []).map((s: any) => String(s)));
  if (have.has(scope)) return true;
  if (scope === 'https://www.googleapis.com/auth/gmail.readonly') {
    return have.has('https://www.googleapis.com/auth/gmail.modify') || have.has('https://www.googleapis.com/auth/gmail.metadata');
  }
  if (scope === 'https://www.googleapis.com/auth/drive.readonly') {
    return have.has('https://www.googleapis.com/auth/drive');
  }
  return false;
}

async function getGoogleTokenForProfile(userId: string, profileLabel: string) {
  const acc = await getExternalAccount(userId, 'google', profileLabel);
  if (!acc) throw new Error('google_not_connected');
  const accessToken = await refreshGoogleTokenIfNeeded(userId, acc, acc.profile_label || profileLabel);
  if (!accessToken) throw new Error('google_access_token_missing');
  return { acc, accessToken };
}

async function googleFetchJson(accessToken: string, url: string, init?: RequestInit): Promise<any> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    ...(init?.headers as any),
  };
  const resp = await fetch(url, { ...init, headers });
  const data: any = await (async () => { try { return await resp.json(); } catch { return null; } })();
  if (!resp.ok) {
    const msg = String(data?.error?.message || data?.error || `${resp.status} ${resp.statusText}`);
    const e: any = new Error(msg);
    e.status = resp.status;
    throw e;
  }
  return data;
}

function addGmailEmailIndex(email: string, key: string) {
  const k = String(email || '').trim().toLowerCase();
  if (!k) return;
  const existing = gmailKeysByEmail.get(k) || new Set<string>();
  existing.add(key);
  gmailKeysByEmail.set(k, existing);
}

function removeGmailEmailIndex(email: string, key: string) {
  const k = String(email || '').trim().toLowerCase();
  if (!k) return;
  const existing = gmailKeysByEmail.get(k);
  if (!existing) return;
  existing.delete(key);
  if (existing.size === 0) gmailKeysByEmail.delete(k);
}

async function registerGmailNativeTrigger(
  userId: string,
  workflowId: string,
  triggerId: string,
  args: any,
) {
  const key = nativeKey(userId, workflowId, triggerId);
  const profileLabel = normalizeProfileLabel(args?.profile);
  const { acc, accessToken } = await getGoogleTokenForProfile(userId, profileLabel);
  if (!hasScope(acc, 'https://www.googleapis.com/auth/gmail.readonly')) {
    throw new Error('missing_gmail_scope');
  }
  const accountEmail = String(acc?.account_email || '').trim().toLowerCase();
  if (!accountEmail) throw new Error('google_account_email_missing');
  const topicName = String(process.env.GOOGLE_GMAIL_PUBSUB_TOPIC || process.env.GMAIL_PUBSUB_TOPIC || '').trim();
  if (!topicName) throw new Error('gmail_pubsub_topic_not_configured');

  const labelIds = normalizeStringArray(args?.labelIds);
  const watchBody: any = {
    topicName,
    labelIds: labelIds.length > 0 ? labelIds : ['INBOX'],
  };
  if (typeof args?.labelFilterBehavior === 'string' && args.labelFilterBehavior.trim()) {
    watchBody.labelFilterBehavior = String(args.labelFilterBehavior).trim();
  }
  const watch = await googleFetchJson(
    accessToken,
    'https://gmail.googleapis.com/gmail/v1/users/me/watch',
    { method: 'POST', body: JSON.stringify(watchBody) }
  );

  const reg: GmailNativeRegistration = {
    key,
    userId,
    workflowId,
    triggerId,
    profileLabel,
    accountEmail,
    labelIds: watchBody.labelIds,
    lastHistoryId: String(watch?.historyId || ''),
    expirationMs: parseNumber(watch?.expiration),
  };

  const prev = gmailRegs.get(key);
  if (prev) removeGmailEmailIndex(prev.accountEmail, key);
  gmailRegs.set(key, reg);
  addGmailEmailIndex(accountEmail, key);

  return {
    ok: true,
    registration: {
      type: 'gmail.new_email',
      workflowId,
      triggerId,
      profile: profileLabel,
      email: accountEmail,
      labelIds: reg.labelIds,
      expiration: reg.expirationMs || null,
    },
  };
}

async function unregisterGmailNativeTrigger(userId: string, workflowId: string, triggerId: string) {
  const key = nativeKey(userId, workflowId, triggerId);
  const existing = gmailRegs.get(key);
  if (!existing) return { ok: true, removed: false };

  gmailRegs.delete(key);
  removeGmailEmailIndex(existing.accountEmail, key);

  // Gmail stop is account-wide. Only stop when no Gmail registrations remain
  // for this user/profile to avoid disabling other workflows.
  const hasSameProfileRemaining = Array.from(gmailRegs.values()).some(
    (r) => r.userId === userId && r.profileLabel === existing.profileLabel
  );
  if (!hasSameProfileRemaining) {
    try {
      const { accessToken } = await getGoogleTokenForProfile(userId, existing.profileLabel);
      await googleFetchJson(accessToken, 'https://gmail.googleapis.com/gmail/v1/users/me/stop', { method: 'POST', body: '{}' });
    } catch {
      // Best effort: registration is removed locally even if stop call fails.
    }
  }

  return { ok: true, removed: true };
}

async function registerDriveNativeTrigger(
  userId: string,
  workflowId: string,
  triggerId: string,
  args: any,
) {
  const key = nativeKey(userId, workflowId, triggerId);
  const profileLabel = normalizeProfileLabel(args?.profile);
  const { acc, accessToken } = await getGoogleTokenForProfile(userId, profileLabel);
  if (!hasScope(acc, 'https://www.googleapis.com/auth/drive.readonly')) {
    throw new Error('missing_drive_scope');
  }
  const accountEmail = String(acc?.account_email || '').trim().toLowerCase();
  if (!accountEmail) throw new Error('google_account_email_missing');

  const callbackBase = String(PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!callbackBase) throw new Error('public_base_url_not_configured');
  const callbackUrl = `${callbackBase}/integrations/google/native-triggers/drive/notify`;

  const tokenRes = await googleFetchJson(
    accessToken,
    'https://www.googleapis.com/drive/v3/changes/startPageToken?supportsAllDrives=true&includeItemsFromAllDrives=true'
  );
  const pageToken = String(tokenRes?.startPageToken || '');
  if (!pageToken) throw new Error('drive_start_page_token_missing');

  const channelId = `stuard-drive-${randomUUID()}`;
  const channelToken = `tok-${randomUUID()}`;
  const expirationMs = Date.now() + (6 * 24 * 60 * 60 * 1000); // 6 days
  const watchUrl =
    `https://www.googleapis.com/drive/v3/changes/watch` +
    `?pageToken=${encodeURIComponent(pageToken)}` +
    `&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  const watchRes = await googleFetchJson(accessToken, watchUrl, {
    method: 'POST',
    body: JSON.stringify({
      id: channelId,
      type: 'web_hook',
      address: callbackUrl,
      token: channelToken,
      expiration: String(expirationMs),
    }),
  });

  const reg: DriveNativeRegistration = {
    key,
    userId,
    workflowId,
    triggerId,
    profileLabel,
    accountEmail,
    channelId,
    channelToken,
    resourceId: String(watchRes?.resourceId || ''),
    pageToken,
    includeFolders: Boolean(args?.includeFolders),
    onlyNew: args?.onlyNew !== false,
    registeredAtMs: Date.now(),
    expirationMs: parseNumber(watchRes?.expiration) || expirationMs,
  };
  if (!reg.resourceId) throw new Error('drive_watch_resource_id_missing');

  const prev = driveRegs.get(key);
  if (prev) {
    driveRegKeyByChannelId.delete(prev.channelId);
    try {
      await googleFetchJson(accessToken, 'https://www.googleapis.com/drive/v3/channels/stop', {
        method: 'POST',
        body: JSON.stringify({
          id: prev.channelId,
          resourceId: prev.resourceId,
        }),
      });
    } catch {
      // Best effort cleanup for replaced registrations.
    }
  }
  driveRegs.set(key, reg);
  driveRegKeyByChannelId.set(reg.channelId, key);

  return {
    ok: true,
    registration: {
      type: 'drive.new_file',
      workflowId,
      triggerId,
      profile: profileLabel,
      email: accountEmail,
      channelId: reg.channelId,
      expiration: reg.expirationMs || null,
      onlyNew: reg.onlyNew,
      includeFolders: reg.includeFolders,
    },
  };
}

async function unregisterDriveNativeTrigger(userId: string, workflowId: string, triggerId: string) {
  const key = nativeKey(userId, workflowId, triggerId);
  const existing = driveRegs.get(key);
  if (!existing) return { ok: true, removed: false };

  driveRegs.delete(key);
  driveRegKeyByChannelId.delete(existing.channelId);
  try {
    const { accessToken } = await getGoogleTokenForProfile(userId, existing.profileLabel);
    await googleFetchJson(accessToken, 'https://www.googleapis.com/drive/v3/channels/stop', {
      method: 'POST',
      body: JSON.stringify({
        id: existing.channelId,
        resourceId: existing.resourceId,
      }),
    });
  } catch {
    // Best effort stop.
  }

  return { ok: true, removed: true };
}

async function fetchGmailMetadata(accessToken: string, messageId: string) {
  const qs = new URLSearchParams();
  qs.set('format', 'metadata');
  qs.append('metadataHeaders', 'From');
  qs.append('metadataHeaders', 'Subject');
  qs.append('metadataHeaders', 'Date');
  qs.append('metadataHeaders', 'To');
  const data = await googleFetchJson(
    accessToken,
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?${qs.toString()}`
  );
  const headers: Array<{ name?: string; value?: string }> =
    Array.isArray(data?.payload?.headers) ? data.payload.headers : [];
  const headerMap = new Map<string, string>();
  for (const h of headers) {
    const k = String(h?.name || '').toLowerCase();
    if (!k) continue;
    headerMap.set(k, String(h?.value || ''));
  }
  return {
    id: String(data?.id || messageId),
    threadId: String(data?.threadId || ''),
    snippet: String(data?.snippet || ''),
    from: headerMap.get('from') || '',
    to: headerMap.get('to') || '',
    subject: headerMap.get('subject') || '',
    date: headerMap.get('date') || '',
    internalDate: String(data?.internalDate || ''),
  };
}

function toBigIntSafe(v: any): bigint {
  try { return BigInt(String(v || '0')); } catch { return 0n; }
}

function maxHistoryId(a: string, b: string): string {
  return toBigIntSafe(a) >= toBigIntSafe(b) ? a : b;
}

function shouldRenew(expirationMs?: number): boolean {
  if (!expirationMs) return false;
  return expirationMs <= (Date.now() + RENEW_WINDOW_MS);
}

async function renewGmailRegistration(reg: GmailNativeRegistration): Promise<void> {
  const topicName = String(process.env.GOOGLE_GMAIL_PUBSUB_TOPIC || process.env.GMAIL_PUBSUB_TOPIC || '').trim();
  if (!topicName) return;
  const { accessToken } = await getGoogleTokenForProfile(reg.userId, reg.profileLabel);
  const watch = await googleFetchJson(
    accessToken,
    'https://gmail.googleapis.com/gmail/v1/users/me/watch',
    {
      method: 'POST',
      body: JSON.stringify({
        topicName,
        labelIds: Array.isArray(reg.labelIds) && reg.labelIds.length > 0 ? reg.labelIds : ['INBOX'],
      }),
    }
  );
  reg.expirationMs = parseNumber(watch?.expiration);
  if (watch?.historyId) reg.lastHistoryId = maxHistoryId(reg.lastHistoryId, String(watch.historyId));
  gmailRegs.set(reg.key, reg);
}

async function renewDriveRegistration(reg: DriveNativeRegistration): Promise<void> {
  const callbackBase = String(PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!callbackBase) return;
  const callbackUrl = `${callbackBase}/integrations/google/native-triggers/drive/notify`;
  const { accessToken } = await getGoogleTokenForProfile(reg.userId, reg.profileLabel);
  const nextChannelId = `stuard-drive-${randomUUID()}`;
  const nextChannelToken = `tok-${randomUUID()}`;
  const nextExpirationMs = Date.now() + (6 * 24 * 60 * 60 * 1000);
  const watchUrl =
    `https://www.googleapis.com/drive/v3/changes/watch` +
    `?pageToken=${encodeURIComponent(reg.pageToken)}` +
    `&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  const watchRes = await googleFetchJson(accessToken, watchUrl, {
    method: 'POST',
    body: JSON.stringify({
      id: nextChannelId,
      type: 'web_hook',
      address: callbackUrl,
      token: nextChannelToken,
      expiration: String(nextExpirationMs),
    }),
  });

  try {
    await googleFetchJson(accessToken, 'https://www.googleapis.com/drive/v3/channels/stop', {
      method: 'POST',
      body: JSON.stringify({
        id: reg.channelId,
        resourceId: reg.resourceId,
      }),
    });
  } catch {
    // Best effort old channel cleanup.
  }

  driveRegKeyByChannelId.delete(reg.channelId);
  reg.channelId = nextChannelId;
  reg.channelToken = nextChannelToken;
  reg.resourceId = String(watchRes?.resourceId || reg.resourceId);
  reg.expirationMs = parseNumber(watchRes?.expiration) || nextExpirationMs;
  driveRegs.set(reg.key, reg);
  driveRegKeyByChannelId.set(reg.channelId, reg.key);
}

async function renewExpiringNativeRegistrations(): Promise<void> {
  const gmailList = Array.from(gmailRegs.values());
  for (const reg of gmailList) {
    if (!shouldRenew(reg.expirationMs)) continue;
    try { await renewGmailRegistration(reg); } catch { }
  }
  const driveList = Array.from(driveRegs.values());
  for (const reg of driveList) {
    if (!shouldRenew(reg.expirationMs)) continue;
    try { await renewDriveRegistration(reg); } catch { }
  }
}

setInterval(() => {
  void renewExpiringNativeRegistrations();
}, RENEW_CHECK_MS).unref();

async function handleGmailPush(emailAddress: string, historyId: string) {
  const emailKey = String(emailAddress || '').trim().toLowerCase();
  if (!emailKey || !historyId) return;
  const regKeys = Array.from(gmailKeysByEmail.get(emailKey) || []);
  if (regKeys.length === 0) return;

  for (const key of regKeys) {
    const reg = gmailRegs.get(key);
    if (!reg) continue;
    if (toBigIntSafe(historyId) <= toBigIntSafe(reg.lastHistoryId)) continue;
    try {
      const { accessToken } = await getGoogleTokenForProfile(reg.userId, reg.profileLabel);
      const historyUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/history');
      historyUrl.searchParams.set('startHistoryId', String(reg.lastHistoryId));
      historyUrl.searchParams.set('historyTypes', 'messageAdded');
      historyUrl.searchParams.set('maxResults', '100');
      const historyData = await googleFetchJson(accessToken, historyUrl.toString());
      const histories: any[] = Array.isArray(historyData?.history) ? historyData.history : [];
      const msgIds = new Set<string>();
      for (const h of histories) {
        const added = Array.isArray(h?.messagesAdded) ? h.messagesAdded : [];
        for (const it of added) {
          const id = String(it?.message?.id || '').trim();
          if (id) msgIds.add(id);
        }
      }

      for (const messageId of msgIds) {
        let message: any = { id: messageId };
        try { message = await fetchGmailMetadata(accessToken, messageId); } catch { }
        await dispatchProviderWebhook(
          reg.userId,
          'google',
          'gmail.new_email',
          `google-gmail-${Date.now()}-${messageId}`,
          {
            event: 'new_email',
            historyId: String(historyId),
            emailAddress: reg.accountEmail,
            profile: reg.profileLabel,
            messageId,
            message,
          },
          reg.workflowId,
          reg.triggerId
        );
      }

      reg.lastHistoryId = String(historyId);
      gmailRegs.set(key, reg);
    } catch (e: any) {
      // If history cursor is stale, reset to the latest cursor to recover.
      if (Number((e as any)?.status || 0) === 404) {
        reg.lastHistoryId = String(historyId);
        gmailRegs.set(key, reg);
      }
    }
  }
}

async function handleDrivePush(reg: DriveNativeRegistration) {
  const { accessToken } = await getGoogleTokenForProfile(reg.userId, reg.profileLabel);
  let pageToken = reg.pageToken;
  let latestPageToken = pageToken;

  while (pageToken) {
    const url = new URL('https://www.googleapis.com/drive/v3/changes');
    url.searchParams.set('pageToken', pageToken);
    url.searchParams.set('supportsAllDrives', 'true');
    url.searchParams.set('includeItemsFromAllDrives', 'true');
    url.searchParams.set('pageSize', '100');
    url.searchParams.set('fields', 'nextPageToken,newStartPageToken,changes(fileId,removed,time,file(id,name,mimeType,createdTime,modifiedTime,webViewLink,trashed,parents))');
    const data = await googleFetchJson(accessToken, url.toString());
    const changes: any[] = Array.isArray(data?.changes) ? data.changes : [];

    for (const change of changes) {
      if (change?.removed) continue;
      const file = change?.file;
      const fileId = String(file?.id || change?.fileId || '').trim();
      if (!file || !fileId) continue;
      if (String(file?.trashed || '') === 'true' || file?.trashed === true) continue;
      if (!reg.includeFolders && String(file?.mimeType || '') === 'application/vnd.google-apps.folder') continue;

      if (reg.onlyNew) {
        const createdMs = Date.parse(String(file?.createdTime || ''));
        if (!Number.isFinite(createdMs) || createdMs < (reg.registeredAtMs - 15_000)) {
          continue;
        }
      }

      await dispatchProviderWebhook(
        reg.userId,
        'google',
        'drive.new_file',
        `google-drive-${Date.now()}-${fileId}`,
        {
          event: 'new_file',
          profile: reg.profileLabel,
          fileId,
          file,
          changeTime: String(change?.time || ''),
        },
        reg.workflowId,
        reg.triggerId
      );
    }

    const nextPage = String(data?.nextPageToken || '').trim();
    const newStartPageToken = String(data?.newStartPageToken || '').trim();
    if (newStartPageToken) latestPageToken = newStartPageToken;
    else if (nextPage) latestPageToken = nextPage;
    pageToken = nextPage;
  }

  reg.pageToken = latestPageToken;
  driveRegs.set(reg.key, reg);
}

export async function handleGoogleNativeTriggerRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parsedUrl: URL
): Promise<boolean> {
  const pathname = parsedUrl.pathname || '';
  const method = String(req.method || 'GET').toUpperCase();

  if (
    method === 'OPTIONS' &&
    (
      pathname.startsWith('/integrations/google/native-triggers') ||
      pathname.startsWith('/integrations/google/native-triggers/gmail/notify') ||
      pathname.startsWith('/integrations/google/native-triggers/drive/notify')
    )
  ) {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return true;
  }

  if (method === 'POST' && pathname === '/integrations/google/native-triggers/register') {
    const auth = await requireAuth(req, res, { rateLimit: true });
    if (!auth?.success || !auth.userId) return true;
    const body = await readJsonBody(req);
    const type = String(body?.type || '').trim() as NativeTriggerType;
    const workflowId = String(body?.workflowId || '').trim();
    const triggerId = String(body?.triggerId || '').trim();
    const args = body?.args || {};
    if (!workflowId || !triggerId) {
      sendJson(res, 400, { ok: false, error: 'workflowId_and_triggerId_required' });
      return true;
    }
    try {
      if (type === 'gmail.new_email') {
        const out = await registerGmailNativeTrigger(auth.userId, workflowId, triggerId, args);
        sendJson(res, 200, out);
        return true;
      }
      if (type === 'drive.new_file') {
        const out = await registerDriveNativeTrigger(auth.userId, workflowId, triggerId, args);
        sendJson(res, 200, out);
        return true;
      }
      sendJson(res, 400, { ok: false, error: 'unsupported_trigger_type' });
      return true;
    } catch (e: any) {
      const msg = String(e?.message || 'register_failed');
      console.error(`[NativeTriggers] register ${type} failed for user=${auth.userId} workflow=${workflowId}:`, msg);
      const detail: Record<string, any> = { ok: false, error: msg };
      if (msg === 'gmail_pubsub_topic_not_configured') {
        detail.hint = 'Set GOOGLE_GMAIL_PUBSUB_TOPIC env var on the cloud server (e.g. projects/my-project/topics/gmail-push)';
      } else if (msg === 'missing_gmail_scope') {
        detail.hint = 'Reconnect your Google account with Gmail permissions enabled';
      } else if (msg === 'missing_drive_scope') {
        detail.hint = 'Reconnect your Google account with Google Drive permissions enabled';
      } else if (msg === 'google_not_connected') {
        detail.hint = 'Connect a Google account in Settings > Integrations first';
      } else if (msg === 'google_access_token_missing') {
        detail.hint = 'Google token refresh failed — try reconnecting your Google account';
      } else if (msg === 'google_account_email_missing') {
        detail.hint = 'Google account is missing email — reconnect with email scope';
      } else if (msg.toLowerCase().includes('pub/sub') || msg.toLowerCase().includes('pubsub') || msg.toLowerCase().includes('topic')) {
        detail.hint = 'Check that gmail-api-push@system.gserviceaccount.com has Pub/Sub Publisher role on your topic';
      }
      sendJson(res, 400, detail);
      return true;
    }
  }

  if (method === 'POST' && pathname === '/integrations/google/native-triggers/unregister') {
    const auth = await requireAuth(req, res, { rateLimit: true });
    if (!auth?.success || !auth.userId) return true;
    const body = await readJsonBody(req);
    const type = String(body?.type || '').trim() as NativeTriggerType;
    const workflowId = String(body?.workflowId || '').trim();
    const triggerId = String(body?.triggerId || '').trim();
    if (!workflowId || !triggerId) {
      sendJson(res, 400, { ok: false, error: 'workflowId_and_triggerId_required' });
      return true;
    }
    try {
      if (type === 'gmail.new_email') {
        const out = await unregisterGmailNativeTrigger(auth.userId, workflowId, triggerId);
        sendJson(res, 200, out);
        return true;
      }
      if (type === 'drive.new_file') {
        const out = await unregisterDriveNativeTrigger(auth.userId, workflowId, triggerId);
        sendJson(res, 200, out);
        return true;
      }
      sendJson(res, 400, { ok: false, error: 'unsupported_trigger_type' });
      return true;
    } catch (e: any) {
      sendJson(res, 400, { ok: false, error: String(e?.message || 'unregister_failed') });
      return true;
    }
  }

  if (method === 'POST' && pathname === '/integrations/google/native-triggers/gmail/notify') {
    const body = await readJsonBody(req);
    const messageData = String(body?.message?.data || '').trim();
    if (!messageData) {
      sendJson(res, 200, { ok: true, ignored: 'missing_message_data' });
      return true;
    }
    let decodedPayload: any = null;
    try {
      const norm = messageData.replace(/-/g, '+').replace(/_/g, '/');
      const padded = norm + '='.repeat((4 - (norm.length % 4)) % 4);
      decodedPayload = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
    } catch {
      sendJson(res, 200, { ok: true, ignored: 'invalid_message_data' });
      return true;
    }
    const emailAddress = String(decodedPayload?.emailAddress || '').trim().toLowerCase();
    const historyId = String(decodedPayload?.historyId || '').trim();
    if (!emailAddress || !historyId) {
      sendJson(res, 200, { ok: true, ignored: 'missing_email_or_history' });
      return true;
    }
    // Fire-and-forget to keep Pub/Sub acknowledgment latency low.
    void handleGmailPush(emailAddress, historyId);
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (method === 'POST' && pathname === '/integrations/google/native-triggers/drive/notify') {
    const channelId = String(req.headers['x-goog-channel-id'] || '').trim();
    const channelToken = String(req.headers['x-goog-channel-token'] || '').trim();
    const resourceState = String(req.headers['x-goog-resource-state'] || '').trim().toLowerCase();
    if (!channelId) {
      sendJson(res, 200, { ok: true, ignored: 'missing_channel_id' });
      return true;
    }
    const regKey = driveRegKeyByChannelId.get(channelId);
    const reg = regKey ? driveRegs.get(regKey) : undefined;
    if (!reg) {
      sendJson(res, 200, { ok: true, ignored: 'unknown_channel' });
      return true;
    }
    if (reg.channelToken && channelToken && reg.channelToken !== channelToken) {
      sendJson(res, 403, { ok: false, error: 'invalid_channel_token' });
      return true;
    }
    if (resourceState === 'sync') {
      sendJson(res, 200, { ok: true, synced: true });
      return true;
    }
    void handleDrivePush(reg).catch(() => {});
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}
