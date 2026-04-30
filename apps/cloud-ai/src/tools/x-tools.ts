import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  getExternalAccount,
  upsertExternalAccount,
  logUsageEvent,
  checkAccess,
} from '../supabase';
import { getBridgeSecrets } from './bridge';
import { getResolvedBridgeSecrets } from './device/shared';
import {
  X_CLIENT_ID,
  X_CLIENT_SECRET,
  X_PRICE_USD_READ,
  X_PRICE_USD_POST,
  X_PRICE_USD_DM,
  X_PRICE_USD_USER,
} from '../utils/config';

const X_API = 'https://api.twitter.com/2';

const profileField = z.string().optional().describe(
  'OAuth profile label to use (e.g. "work", "personal"). Omit to use the default profile.'
);

function resolveProfile(explicit?: string): string | undefined {
  if (explicit) return explicit;
  try {
    const secrets = getBridgeSecrets() || getResolvedBridgeSecrets();
    return (secrets as any)?.xProfile || (secrets as any)?.profile || undefined;
  } catch { return undefined; }
}

function requireUserId(): string {
  const secrets = getBridgeSecrets() || getResolvedBridgeSecrets();
  const userId = String((secrets as any)?.userId || '');
  if (!userId) throw new Error('missing_user_context');
  return userId;
}

/**
 * Refresh an X OAuth 2.0 token using the refresh_token grant.
 * Public clients send client_id in the body; confidential clients use Basic auth.
 */
async function refreshXToken(userId: string, acc: any): Promise<string | null> {
  if (!acc?.refresh_token || !X_CLIENT_ID) return null;
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
    const body: Record<string, string> = {
      grant_type: 'refresh_token',
      refresh_token: String(acc.refresh_token),
      client_id: X_CLIENT_ID,
    };
    if (X_CLIENT_SECRET) {
      const basicAuth = Buffer.from(`${X_CLIENT_ID}:${X_CLIENT_SECRET}`).toString('base64');
      headers.Authorization = `Basic ${basicAuth}`;
    }
    const tokenRes = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers,
      body: new URLSearchParams(body),
    });
    const tBody: any = await (async () => { try { return await tokenRes.json(); } catch { return null; } })();
    if (tokenRes.ok && tBody?.access_token) {
      const newAccess = String(tBody.access_token);
      const expiresIn = Number(tBody.expires_in || 7200);
      const expires_at = new Date(Date.now() + expiresIn * 1000).toISOString();
      // X rotates refresh tokens — use the new one if returned
      const refresh_token = String(tBody.refresh_token || acc.refresh_token || '');
      const scopeStr = String(tBody.scope || '');
      const scopes = scopeStr ? scopeStr.split(' ').map((s: string) => s.trim()).filter(Boolean) : (Array.isArray(acc.scopes) ? acc.scopes : []);
      try {
        await upsertExternalAccount({
          userId,
          provider: 'x',
          access_token: newAccess,
          scopes,
          refresh_token: refresh_token || null,
          expires_at,
          meta: { token_type: tBody.token_type || 'bearer' },
          profileLabel: acc.profile_label || 'default',
          accountEmail: acc.account_email || null,
        });
      } catch {}
      return newAccess;
    }
  } catch {}
  return null;
}

/** Block the call if the user has no remaining credits. */
async function gateCredits(userId: string): Promise<void> {
  try {
    const access = await checkAccess(userId);
    if (!access.allowed) {
      throw new Error(access.reason === 'monthly_credit_limit_exceeded'
        ? 'No credits remaining. Top up your balance to use the X integration.'
        : (access.reason || 'credit_limit_exceeded'));
    }
  } catch (e: any) {
    if (e?.message?.includes('credits')) throw e;
    // If checkAccess itself fails (e.g. Supabase down), don't block — fail open.
  }
}

/** Charge the user for one X API call against the existing credits ledger. */
async function meterX(userId: string, opLabel: string, costUsd: number): Promise<void> {
  if (!(costUsd > 0)) return;
  try {
    await logUsageEvent(userId, null, `x-api/${opLabel}`, {
      costUsd,
      sourceType: 'integration',
      source_label: 'X (Twitter)',
      operation: opLabel,
    });
  } catch {}
}

async function xFetch(path: string, profileLabel?: string, init?: RequestInit) {
  const userId = requireUserId();
  const profile = resolveProfile(profileLabel);
  let acc = await getExternalAccount(userId, 'x', profile);
  if (!acc?.access_token) throw new Error('x_not_connected');

  let accessToken = acc.access_token;

  // Proactive refresh if within 5 minutes of expiry
  if (acc.expires_at) {
    const expiresAt = new Date(acc.expires_at).getTime();
    if (Date.now() > expiresAt - 5 * 60 * 1000) {
      const refreshed = await refreshXToken(userId, acc);
      if (refreshed) accessToken = refreshed;
    }
  }

  const doFetch = (token: string) => {
    const url = path.startsWith('http') ? path : `${X_API}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      ...(init?.headers as any),
    };
    return fetch(url, { ...init, headers });
  };

  let res = await doFetch(accessToken);

  // On 401, try one refresh
  if (res.status === 401 && acc.refresh_token) {
    const refreshed = await refreshXToken(userId, acc);
    if (refreshed) {
      accessToken = refreshed;
      res = await doFetch(accessToken);
    }
  }

  if (res.status === 429) {
    throw new Error('X rate limited. Please try again in a moment.');
  }

  let body: any = null;
  try { body = await res.json(); } catch {}

  if (!res.ok) {
    if (res.status === 401) {
      throw new Error('X authentication failed. Please reconnect X in Settings → Integrations.');
    }
    const msg = (body && (body.title || body.detail || body.message || body.error)) || `${res.status} ${res.statusText}`;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  return { body, userId };
}

// ── Read: search recent tweets ──

export const x_search_tweets = createTool({
  id: 'x_search_tweets',
  description: 'Search recent tweets/posts on X/Twitter matching a query. Returns up to 100 results from the last 7 days.',
  inputSchema: z.object({
    query: z.string().min(1).describe('Search query (supports operators like from:user, has:images, lang:en)'),
    max_results: z.number().int().min(10).max(100).default(20),
    profile: profileField,
  }),
  execute: async (inputData) => {
    const { query, max_results, profile } = inputData as any;
    const userId = requireUserId();
    await gateCredits(userId);
    const params = new URLSearchParams({
      query,
      max_results: String(max_results || 20),
      'tweet.fields': 'author_id,created_at,public_metrics,lang',
      'expansions': 'author_id',
      'user.fields': 'username,name',
    });
    const { body } = await xFetch(`/tweets/search/recent?${params}`, profile);
    const usersById = new Map<string, any>();
    for (const u of (body?.includes?.users || [])) usersById.set(u.id, u);
    const items = (body?.data || []).map((t: any) => {
      const u = usersById.get(t.author_id);
      return {
        id: t.id,
        text: t.text,
        author_id: t.author_id,
        author: u ? { username: u.username, name: u.name } : null,
        created_at: t.created_at,
        metrics: t.public_metrics,
        lang: t.lang,
        url: u ? `https://twitter.com/${u.username}/status/${t.id}` : `https://twitter.com/i/status/${t.id}`,
      };
    });
    await meterX(userId, 'search_tweets', X_PRICE_USD_READ);
    return { items, count: items.length, next_token: body?.meta?.next_token || null };
  },
});

// ── Read: a single user's recent timeline ──

export const x_get_user_timeline = createTool({
  id: 'x_get_user_timeline',
  description: 'Fetch recent tweets/posts from a specific X/Twitter user timeline by username or user_id.',
  inputSchema: z.object({
    username: z.string().optional().describe('The @username of the user (without the @). Provide either this or user_id.'),
    user_id: z.string().optional().describe('The numeric X user_id. Provide either this or username.'),
    max_results: z.number().int().min(5).max(100).default(20),
    exclude_replies: z.boolean().default(false),
    exclude_retweets: z.boolean().default(false),
    profile: profileField,
  }),
  execute: async (inputData) => {
    const { username, user_id, max_results, exclude_replies, exclude_retweets, profile } = inputData as any;
    const userId = requireUserId();
    await gateCredits(userId);

    let targetId = user_id as string | undefined;
    if (!targetId) {
      if (!username) throw new Error('username_or_user_id_required');
      const lookup = await xFetch(`/users/by/username/${encodeURIComponent(username)}`, profile);
      targetId = lookup.body?.data?.id;
      if (!targetId) throw new Error(`x_user_not_found: ${username}`);
      // The lookup itself counts as a user-tier read
      await meterX(userId, 'lookup_user', X_PRICE_USD_USER);
    }

    const exclude: string[] = [];
    if (exclude_replies) exclude.push('replies');
    if (exclude_retweets) exclude.push('retweets');
    const params = new URLSearchParams({
      max_results: String(max_results || 20),
      'tweet.fields': 'created_at,public_metrics,lang,referenced_tweets',
    });
    if (exclude.length) params.set('exclude', exclude.join(','));

    const { body } = await xFetch(`/users/${targetId}/tweets?${params}`, profile);
    const items = (body?.data || []).map((t: any) => ({
      id: t.id,
      text: t.text,
      created_at: t.created_at,
      metrics: t.public_metrics,
      lang: t.lang,
      referenced: t.referenced_tweets || [],
    }));
    await meterX(userId, 'get_user_timeline', X_PRICE_USD_READ);
    return { user_id: targetId, items, count: items.length, next_token: body?.meta?.next_token || null };
  },
});

// ── Read: a single tweet ──

export const x_get_tweet = createTool({
  id: 'x_get_tweet',
  description: 'Fetch a single X/Twitter tweet/post by id with author info and metrics.',
  inputSchema: z.object({
    id: z.string().min(1).describe('The tweet id'),
    profile: profileField,
  }),
  execute: async (inputData) => {
    const { id, profile } = inputData as any;
    const userId = requireUserId();
    await gateCredits(userId);
    const params = new URLSearchParams({
      'tweet.fields': 'author_id,created_at,public_metrics,lang,referenced_tweets',
      'expansions': 'author_id',
      'user.fields': 'username,name',
    });
    const { body } = await xFetch(`/tweets/${encodeURIComponent(id)}?${params}`, profile);
    const t = body?.data;
    const author = body?.includes?.users?.[0];
    await meterX(userId, 'get_tweet', X_PRICE_USD_READ);
    return t ? {
      id: t.id,
      text: t.text,
      author_id: t.author_id,
      author: author ? { username: author.username, name: author.name } : null,
      created_at: t.created_at,
      metrics: t.public_metrics,
      lang: t.lang,
      referenced: t.referenced_tweets || [],
      url: author ? `https://twitter.com/${author.username}/status/${t.id}` : `https://twitter.com/i/status/${t.id}`,
    } : null;
  },
});

// ── Post: create a tweet (or reply) ──

export const x_post_tweet = createTool({
  id: 'x_post_tweet',
  description: 'Post a new tweet/post on X/Twitter. Optionally reply to an existing tweet by passing reply_to_tweet_id.',
  inputSchema: z.object({
    text: z.string().min(1).max(280).describe('Tweet text (max 280 characters)'),
    reply_to_tweet_id: z.string().optional().describe('If set, post this tweet as a reply to the given tweet id.'),
    profile: profileField,
  }),
  execute: async (inputData) => {
    const { text, reply_to_tweet_id, profile } = inputData as any;
    const userId = requireUserId();
    await gateCredits(userId);
    const payload: any = { text };
    if (reply_to_tweet_id) payload.reply = { in_reply_to_tweet_id: String(reply_to_tweet_id) };
    const { body } = await xFetch(`/tweets`, profile, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    await meterX(userId, reply_to_tweet_id ? 'reply_tweet' : 'post_tweet', X_PRICE_USD_POST);
    return {
      id: body?.data?.id || null,
      text: body?.data?.text || text,
      url: body?.data?.id ? `https://twitter.com/i/status/${body.data.id}` : null,
    };
  },
});

// ── Post: delete a tweet ──

export const x_delete_tweet = createTool({
  id: 'x_delete_tweet',
  description: 'Delete one of your X/Twitter tweets/posts by id.',
  inputSchema: z.object({
    id: z.string().min(1).describe('The tweet id to delete'),
    profile: profileField,
  }),
  execute: async (inputData) => {
    const { id, profile } = inputData as any;
    const userId = requireUserId();
    await gateCredits(userId);
    const { body } = await xFetch(`/tweets/${encodeURIComponent(id)}`, profile, { method: 'DELETE' });
    await meterX(userId, 'delete_tweet', X_PRICE_USD_READ);
    return { deleted: !!body?.data?.deleted };
  },
});

// ── DM: send a direct message ──

export const x_send_dm = createTool({
  id: 'x_send_dm',
  description: 'Send a direct message (DM) on X/Twitter to another user. Pass either recipient_id (X user_id) or recipient_username.',
  inputSchema: z.object({
    recipient_id: z.string().optional().describe('Numeric X user_id of the recipient'),
    recipient_username: z.string().optional().describe('@username of the recipient (without @)'),
    text: z.string().min(1).max(10000).describe('Message text'),
    profile: profileField,
  }),
  execute: async (inputData) => {
    const { recipient_id, recipient_username, text, profile } = inputData as any;
    const userId = requireUserId();
    await gateCredits(userId);
    let targetId = recipient_id as string | undefined;
    if (!targetId) {
      if (!recipient_username) throw new Error('recipient_required');
      const lookup = await xFetch(`/users/by/username/${encodeURIComponent(recipient_username)}`, profile);
      targetId = lookup.body?.data?.id;
      if (!targetId) throw new Error(`x_user_not_found: ${recipient_username}`);
      await meterX(userId, 'lookup_user', X_PRICE_USD_USER);
    }
    const { body } = await xFetch(`/dm_conversations/with/${targetId}/messages`, profile, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    await meterX(userId, 'send_dm', X_PRICE_USD_DM);
    return {
      dm_event_id: body?.data?.dm_event_id || null,
      conversation_id: body?.data?.dm_conversation_id || null,
    };
  },
});

// ── DM: list events in a conversation ──

export const x_list_dms = createTool({
  id: 'x_list_dms',
  description: 'List recent X/Twitter direct message (DM) events from a conversation with another user.',
  inputSchema: z.object({
    conversation_id: z.string().optional().describe('Existing dm_conversation_id'),
    participant_id: z.string().optional().describe('X user_id of the other participant (resolved to a 1:1 conversation)'),
    max_results: z.number().int().min(5).max(100).default(20),
    profile: profileField,
  }),
  execute: async (inputData) => {
    const { conversation_id, participant_id, max_results, profile } = inputData as any;
    const userId = requireUserId();
    await gateCredits(userId);
    const params = new URLSearchParams({
      max_results: String(max_results || 20),
      'dm_event.fields': 'id,text,created_at,sender_id,event_type',
    });
    let path: string;
    if (conversation_id) {
      path = `/dm_conversations/${encodeURIComponent(conversation_id)}/dm_events?${params}`;
    } else if (participant_id) {
      path = `/dm_conversations/with/${encodeURIComponent(participant_id)}/dm_events?${params}`;
    } else {
      throw new Error('conversation_id_or_participant_id_required');
    }
    const { body } = await xFetch(path, profile);
    const events = (body?.data || []).map((e: any) => ({
      id: e.id,
      text: e.text,
      sender_id: e.sender_id,
      created_at: e.created_at,
      event_type: e.event_type,
    }));
    await meterX(userId, 'list_dms', X_PRICE_USD_READ);
    return { events, count: events.length, next_token: body?.meta?.next_token || null };
  },
});

// ── User: lookup user info ──

export const x_get_user = createTool({
  id: 'x_get_user',
  description: 'Look up an X/Twitter user profile by username or user_id. Returns id, name, bio, public metrics.',
  inputSchema: z.object({
    username: z.string().optional().describe('@username (without @)'),
    user_id: z.string().optional().describe('Numeric user_id'),
    profile: profileField,
  }),
  execute: async (inputData) => {
    const { username, user_id, profile } = inputData as any;
    const userId = requireUserId();
    await gateCredits(userId);
    const fields = 'description,public_metrics,verified,profile_image_url,created_at,location';
    let path: string;
    if (user_id) {
      path = `/users/${encodeURIComponent(user_id)}?user.fields=${fields}`;
    } else if (username) {
      path = `/users/by/username/${encodeURIComponent(username)}?user.fields=${fields}`;
    } else {
      throw new Error('username_or_user_id_required');
    }
    const { body } = await xFetch(path, profile);
    const u = body?.data;
    await meterX(userId, 'get_user', X_PRICE_USD_USER);
    return u ? {
      id: u.id,
      username: u.username,
      name: u.name,
      description: u.description,
      verified: u.verified,
      location: u.location,
      profile_image_url: u.profile_image_url,
      created_at: u.created_at,
      metrics: u.public_metrics,
      url: `https://twitter.com/${u.username}`,
    } : null;
  },
});

// ── User: followers / following lists ──

export const x_list_followers = createTool({
  id: 'x_list_followers',
  description: 'List followers of an X/Twitter user. Returns up to max_results follower profiles.',
  inputSchema: z.object({
    username: z.string().optional().describe('@username (without @)'),
    user_id: z.string().optional().describe('Numeric user_id'),
    max_results: z.number().int().min(10).max(1000).default(100),
    profile: profileField,
  }),
  execute: async (inputData) => {
    const { username, user_id, max_results, profile } = inputData as any;
    const userId = requireUserId();
    await gateCredits(userId);

    let targetId = user_id as string | undefined;
    if (!targetId) {
      if (!username) throw new Error('username_or_user_id_required');
      const lookup = await xFetch(`/users/by/username/${encodeURIComponent(username)}`, profile);
      targetId = lookup.body?.data?.id;
      if (!targetId) throw new Error(`x_user_not_found: ${username}`);
      await meterX(userId, 'lookup_user', X_PRICE_USD_USER);
    }
    const params = new URLSearchParams({
      max_results: String(max_results || 100),
      'user.fields': 'description,public_metrics,verified',
    });
    const { body } = await xFetch(`/users/${targetId}/followers?${params}`, profile);
    const items = (body?.data || []).map((u: any) => ({
      id: u.id,
      username: u.username,
      name: u.name,
      verified: u.verified,
      metrics: u.public_metrics,
    }));
    await meterX(userId, 'list_followers', X_PRICE_USD_USER);
    return { user_id: targetId, items, count: items.length, next_token: body?.meta?.next_token || null };
  },
});

export const x_list_following = createTool({
  id: 'x_list_following',
  description: 'List the accounts an X/Twitter user is following.',
  inputSchema: z.object({
    username: z.string().optional().describe('@username (without @)'),
    user_id: z.string().optional().describe('Numeric user_id'),
    max_results: z.number().int().min(10).max(1000).default(100),
    profile: profileField,
  }),
  execute: async (inputData) => {
    const { username, user_id, max_results, profile } = inputData as any;
    const userId = requireUserId();
    await gateCredits(userId);

    let targetId = user_id as string | undefined;
    if (!targetId) {
      if (!username) throw new Error('username_or_user_id_required');
      const lookup = await xFetch(`/users/by/username/${encodeURIComponent(username)}`, profile);
      targetId = lookup.body?.data?.id;
      if (!targetId) throw new Error(`x_user_not_found: ${username}`);
      await meterX(userId, 'lookup_user', X_PRICE_USD_USER);
    }
    const params = new URLSearchParams({
      max_results: String(max_results || 100),
      'user.fields': 'description,public_metrics,verified',
    });
    const { body } = await xFetch(`/users/${targetId}/following?${params}`, profile);
    const items = (body?.data || []).map((u: any) => ({
      id: u.id,
      username: u.username,
      name: u.name,
      verified: u.verified,
      metrics: u.public_metrics,
    }));
    await meterX(userId, 'list_following', X_PRICE_USD_USER);
    return { user_id: targetId, items, count: items.length, next_token: body?.meta?.next_token || null };
  },
});
