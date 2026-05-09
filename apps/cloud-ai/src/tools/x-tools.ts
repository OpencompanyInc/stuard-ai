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
import { getVMOAuthAccount, storeVMOAuthAccount } from './vm-oauth';

const X_API = 'https://api.twitter.com/2';

const profileField = z.string().optional().describe(
  'OAuth profile label to use (e.g. "work", "personal"). Omit to use the default profile.'
);

const tweetFields = 'author_id,created_at,public_metrics,lang,referenced_tweets,conversation_id,in_reply_to_user_id';
const userFields = 'username,name,verified,profile_image_url';

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
        if (acc.meta?.source === 'vm') {
          await storeVMOAuthAccount('x', {
            ...acc,
            access_token: newAccess,
            refresh_token: refresh_token || null,
            expires_at,
            scopes,
          });
        } else {
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
        }
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
  let acc = await getVMOAuthAccount('x', profile) || await getExternalAccount(userId, 'x', profile);
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

function cleanUsername(username?: string): string | undefined {
  const cleaned = String(username || '').trim().replace(/^@+/, '');
  return cleaned || undefined;
}

function firstRepliedToId(tweet: any): string | null {
  const ref = (tweet?.referenced_tweets || []).find((r: any) => r?.type === 'replied_to');
  return ref?.id || null;
}

function buildUsersById(body: any): Map<string, any> {
  const usersById = new Map<string, any>();
  for (const u of (body?.includes?.users || [])) usersById.set(u.id, u);
  return usersById;
}

function formatTweet(t: any, usersById: Map<string, any>) {
  const author = usersById.get(t.author_id);
  return {
    id: t.id,
    text: t.text,
    author_id: t.author_id,
    author: author ? {
      username: author.username,
      name: author.name,
      verified: author.verified,
      profile_image_url: author.profile_image_url,
    } : null,
    created_at: t.created_at,
    metrics: t.public_metrics,
    lang: t.lang,
    conversation_id: t.conversation_id,
    in_reply_to_user_id: t.in_reply_to_user_id,
    in_reply_to_tweet_id: firstRepliedToId(t),
    referenced: t.referenced_tweets || [],
    url: author ? `https://twitter.com/${author.username}/status/${t.id}` : `https://twitter.com/i/status/${t.id}`,
  };
}

async function getAuthenticatedXUser(profile?: string): Promise<{ id: string; username?: string; name?: string }> {
  const { body } = await xFetch(`/users/me?user.fields=username,name`, profile);
  const me = body?.data;
  if (!me?.id) throw new Error('x_user_not_found: could not resolve authenticated X user');
  return { id: me.id, username: me.username, name: me.name };
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

// ── Read: comments / replies ──

export const x_get_comments = createTool({
  id: 'x_get_comments',
  description: 'Get X/Twitter comments/replies with filters. For a post, pass post_id. For account mentions, pass username or user_id. Supports filters like from_username, to_username, mentioned_username, lang, since_id, date range, and minimum engagement.',
  inputSchema: z.object({
    post_id: z.string().optional().describe('Post/comment id whose reply thread should be searched. With only_direct_replies=true, returns direct replies to this id.'),
    conversation_id: z.string().optional().describe('Conversation/root post id. Use this when you already know the conversation id.'),
    username: z.string().optional().describe('Account username whose mentions/comments should be fetched when post_id/conversation_id/query are omitted.'),
    user_id: z.string().optional().describe('Account user id whose mentions/comments should be fetched when post_id/conversation_id/query are omitted.'),
    query: z.string().optional().describe('Additional X search query terms/operators to AND with the filters.'),
    from_username: z.string().optional().describe('Only comments authored by this username.'),
    to_username: z.string().optional().describe('Only replies addressed to this username.'),
    mentioned_username: z.string().optional().describe('Only posts mentioning this username.'),
    lang: z.string().optional().describe('Language operator, e.g. en, es.'),
    contains_text: z.string().optional().describe('Local case-insensitive text filter applied after X returns results.'),
    min_likes: z.number().int().min(0).optional(),
    min_replies: z.number().int().min(0).optional(),
    min_retweets: z.number().int().min(0).optional(),
    only_direct_replies: z.boolean().default(false).describe('When post_id is set, only keep comments whose replied-to tweet id equals post_id.'),
    exclude_retweets: z.boolean().default(true),
    exclude_quotes: z.boolean().default(false),
    start_time: z.string().optional().describe('Oldest timestamp, ISO 8601.'),
    end_time: z.string().optional().describe('Newest timestamp, ISO 8601.'),
    since_id: z.string().optional().describe('Return posts newer than this id. Useful for polling.'),
    until_id: z.string().optional().describe('Return posts older than this id.'),
    next_token: z.string().optional().describe('Pagination token from a previous call.'),
    max_results: z.number().int().min(5).max(100).default(20),
    profile: profileField,
  }),
  execute: async (inputData) => {
    const {
      post_id,
      conversation_id,
      username,
      user_id,
      query,
      from_username,
      to_username,
      mentioned_username,
      lang,
      contains_text,
      min_likes,
      min_replies,
      min_retweets,
      only_direct_replies,
      exclude_retweets,
      exclude_quotes,
      start_time,
      end_time,
      since_id,
      until_id,
      next_token,
      max_results,
      profile,
    } = inputData as any;

    const userId = requireUserId();
    await gateCredits(userId);

    const useSearch = !!(post_id || conversation_id || query || from_username || to_username || mentioned_username || lang);
    let body: any;
    let mode: 'search' | 'mentions' = 'search';

    if (useSearch) {
      const searchParts: string[] = [];
      let threadId = conversation_id || post_id;
      if (post_id && only_direct_replies && !conversation_id) {
        const context = await xFetch(`/tweets/${encodeURIComponent(post_id)}?tweet.fields=conversation_id`, profile);
        threadId = context.body?.data?.conversation_id || post_id;
        await meterX(userId, 'get_comment_context', X_PRICE_USD_READ);
      }
      if (threadId) searchParts.push(`conversation_id:${threadId}`);
      if (query) searchParts.push(String(query));
      const from = cleanUsername(from_username);
      const to = cleanUsername(to_username);
      const mention = cleanUsername(mentioned_username);
      if (from) searchParts.push(`from:${from}`);
      if (to) searchParts.push(`to:${to}`);
      if (mention) searchParts.push(`@${mention}`);
      if (lang) searchParts.push(`lang:${lang}`);
      if (threadId || only_direct_replies) searchParts.push('is:reply');
      if (exclude_retweets !== false) searchParts.push('-is:retweet');
      if (exclude_quotes) searchParts.push('-is:quote');
      if (!searchParts.length) throw new Error('x_comments_filter_required');

      const params = new URLSearchParams({
        query: searchParts.join(' '),
        max_results: String(Math.max(10, Number(max_results || 20))),
        'tweet.fields': tweetFields,
        'expansions': 'author_id',
        'user.fields': userFields,
      });
      if (start_time) params.set('start_time', start_time);
      if (end_time) params.set('end_time', end_time);
      if (since_id) params.set('since_id', since_id);
      if (until_id) params.set('until_id', until_id);
      if (next_token) params.set('next_token', next_token);
      const result = await xFetch(`/tweets/search/recent?${params}`, profile);
      body = result.body;
      await meterX(userId, 'get_comments_search', X_PRICE_USD_READ);
    } else {
      mode = 'mentions';
      let targetId = user_id as string | undefined;
      if (!targetId) {
        const clean = cleanUsername(username);
        if (!clean) {
          const me = await getAuthenticatedXUser(profile);
          targetId = me.id;
          await meterX(userId, 'lookup_authenticated_user', X_PRICE_USD_USER);
        } else {
          const lookup = await xFetch(`/users/by/username/${encodeURIComponent(clean)}`, profile);
          targetId = lookup.body?.data?.id;
          if (!targetId) throw new Error(`x_user_not_found: ${clean}`);
          await meterX(userId, 'lookup_user', X_PRICE_USD_USER);
        }
      }

      const params = new URLSearchParams({
        max_results: String(max_results || 20),
        'tweet.fields': tweetFields,
        'expansions': 'author_id',
        'user.fields': userFields,
      });
      if (start_time) params.set('start_time', start_time);
      if (end_time) params.set('end_time', end_time);
      if (since_id) params.set('since_id', since_id);
      if (until_id) params.set('until_id', until_id);
      if (next_token) params.set('pagination_token', next_token);
      const result = await xFetch(`/users/${targetId}/mentions?${params}`, profile);
      body = result.body;
      await meterX(userId, 'get_comments_mentions', X_PRICE_USD_READ);
    }

    const usersById = buildUsersById(body);
    let items = (body?.data || []).map((t: any) => formatTweet(t, usersById));
    if (post_id && only_direct_replies) {
      items = items.filter((t: any) => t.in_reply_to_tweet_id === String(post_id));
    }
    if (contains_text) {
      const needle = String(contains_text).toLowerCase();
      items = items.filter((t: any) => String(t.text || '').toLowerCase().includes(needle));
    }
    if (typeof min_likes === 'number') {
      items = items.filter((t: any) => Number(t.metrics?.like_count || 0) >= min_likes);
    }
    if (typeof min_replies === 'number') {
      items = items.filter((t: any) => Number(t.metrics?.reply_count || 0) >= min_replies);
    }
    if (typeof min_retweets === 'number') {
      items = items.filter((t: any) => Number(t.metrics?.retweet_count || 0) >= min_retweets);
    }

    return {
      mode,
      items,
      count: items.length,
      next_token: body?.meta?.next_token || null,
      result_count: body?.meta?.result_count ?? items.length,
    };
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

// ── Post: comment on a post ──

export const x_comment_on_post = createTool({
  id: 'x_comment_on_post',
  description: 'Comment on an X/Twitter post by posting a reply to the post id.',
  inputSchema: z.object({
    post_id: z.string().min(1).describe('The post id to comment on.'),
    text: z.string().min(1).max(280).describe('Comment text (max 280 characters).'),
    profile: profileField,
  }),
  execute: async (inputData) => {
    const { post_id, text, profile } = inputData as any;
    const userId = requireUserId();
    await gateCredits(userId);
    const { body } = await xFetch(`/tweets`, profile, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        reply: { in_reply_to_tweet_id: String(post_id) },
      }),
    });
    await meterX(userId, 'comment_on_post', X_PRICE_USD_POST);
    return {
      id: body?.data?.id || null,
      text: body?.data?.text || text,
      in_reply_to_tweet_id: String(post_id),
      url: body?.data?.id ? `https://twitter.com/i/status/${body.data.id}` : null,
    };
  },
});

// ── Post: reply to a comment ──

export const x_reply_to_comment = createTool({
  id: 'x_reply_to_comment',
  description: 'Reply to an X/Twitter comment/reply by comment id.',
  inputSchema: z.object({
    comment_id: z.string().min(1).describe('The comment/reply post id to reply to.'),
    text: z.string().min(1).max(280).describe('Reply text (max 280 characters).'),
    profile: profileField,
  }),
  execute: async (inputData) => {
    const { comment_id, text, profile } = inputData as any;
    const userId = requireUserId();
    await gateCredits(userId);
    const { body } = await xFetch(`/tweets`, profile, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        reply: { in_reply_to_tweet_id: String(comment_id) },
      }),
    });
    await meterX(userId, 'reply_comment', X_PRICE_USD_POST);
    return {
      id: body?.data?.id || null,
      text: body?.data?.text || text,
      in_reply_to_tweet_id: String(comment_id),
      url: body?.data?.id ? `https://twitter.com/i/status/${body.data.id}` : null,
    };
  },
});

// ── Like: like a comment/post ──

export const x_like_comment = createTool({
  id: 'x_like_comment',
  description: 'Like an X/Twitter comment/reply by id. This works for any Post id, including top-level posts.',
  inputSchema: z.object({
    comment_id: z.string().min(1).describe('The comment/reply post id to like.'),
    profile: profileField,
  }),
  execute: async (inputData) => {
    const { comment_id, profile } = inputData as any;
    const userId = requireUserId();
    await gateCredits(userId);
    const me = await getAuthenticatedXUser(profile);
    await meterX(userId, 'lookup_authenticated_user', X_PRICE_USD_USER);
    const { body } = await xFetch(`/users/${encodeURIComponent(me.id)}/likes`, profile, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tweet_id: String(comment_id) }),
    });
    await meterX(userId, 'like_comment', X_PRICE_USD_POST);
    return {
      liked: !!body?.data?.liked,
      comment_id: String(comment_id),
      user_id: me.id,
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
