import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getExternalAccount, upsertExternalAccount } from '../supabase';
import { getBridgeSecrets } from './bridge';
import { REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET } from '../utils/config';

const REDDIT_API = 'https://oauth.reddit.com';

const profileField = z.string().optional().describe(
  'OAuth profile label to use (e.g. "work", "personal"). Omit to use the default profile.'
);

function resolveProfile(explicit?: string): string | undefined {
  if (explicit) return explicit;
  try {
    const secrets = getBridgeSecrets();
    return (secrets as any)?.redditProfile || (secrets as any)?.profile || undefined;
  } catch { return undefined; }
}

function requireUserId(): string {
  const secrets = getBridgeSecrets();
  const userId = String((secrets as any)?.userId || '');
  if (!userId) throw new Error('missing_user_context');
  return userId;
}

/**
 * Refresh a Reddit OAuth2 token using the refresh_token grant.
 * Reddit requires Basic Auth (client_id:client_secret) for token refresh.
 */
async function refreshRedditToken(userId: string, acc: any): Promise<string | null> {
  if (!acc?.refresh_token || !REDDIT_CLIENT_ID || !REDDIT_CLIENT_SECRET) return null;
  try {
    const basicAuth = Buffer.from(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`).toString('base64');
    const tokenRes = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuth}`,
        'User-Agent': 'StuardAI/1.0 (cloud-ai integration)',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: String(acc.refresh_token),
      }),
    });
    const tBody: any = await (async () => { try { return await tokenRes.json(); } catch { return null; } })();
    if (tokenRes.ok && tBody?.access_token) {
      const newAccess = String(tBody.access_token);
      const expiresIn = Number(tBody.expires_in || 3600);
      const expires_at = new Date(Date.now() + expiresIn * 1000).toISOString();
      // Reddit doesn't return a new refresh_token, keep the existing one
      const refresh_token = String(tBody.refresh_token || acc.refresh_token || '');
      const scopeStr = String(tBody.scope || '');
      const scopes = scopeStr ? scopeStr.split(' ').map((s: string) => s.trim()).filter(Boolean) : (Array.isArray(acc.scopes) ? acc.scopes : []);
      try {
        await upsertExternalAccount({
          userId,
          provider: 'reddit',
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

/**
 * Fetch from Reddit API with automatic token refresh on 401.
 */
async function redditFetch(path: string, profileLabel?: string, init?: RequestInit) {
  const userId = requireUserId();
  const profile = resolveProfile(profileLabel);
  let acc = await getExternalAccount(userId, 'reddit', profile);
  if (!acc?.access_token) throw new Error('reddit_not_connected');

  let accessToken = acc.access_token;

  // Proactively refresh if token is expired or about to expire (within 5 min)
  if (acc.expires_at) {
    const expiresAt = new Date(acc.expires_at).getTime();
    if (Date.now() > expiresAt - 5 * 60 * 1000) {
      const refreshed = await refreshRedditToken(userId, acc);
      if (refreshed) accessToken = refreshed;
    }
  }

  async function doFetch(token: string) {
    const url = path.startsWith('http') ? path : `${REDDIT_API}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'StuardAI/1.0 (cloud-ai integration)',
      ...(init?.headers as any),
    };
    return fetch(url, { ...init, headers });
  }

  let res = await doFetch(accessToken);

  // On 401, try refreshing the token once
  if (res.status === 401 && acc.refresh_token) {
    const refreshed = await refreshRedditToken(userId, acc);
    if (refreshed) {
      accessToken = refreshed;
      res = await doFetch(accessToken);
    }
  }

  if (res.status === 429) {
    throw new Error('Reddit rate limited (60 requests/minute). Please try again in a moment.');
  }

  let body: any = null;
  try { body = await res.json(); } catch {}

  if (!res.ok) {
    if (res.status === 401) {
      throw new Error('Reddit authentication failed. The token may have expired. Please reconnect Reddit in Settings → Integrations.');
    }
    const msg = (body && (body.message || body.error)) || `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  return body;
}

// ── Search Reddit ──

export const reddit_search = createTool({
  id: 'reddit_search',
  description: 'Search Reddit for posts. Can search globally or within a specific subreddit.',
  inputSchema: z.object({
    query: z.string().min(1).describe('Search query'),
    subreddit: z.string().optional().describe('Limit search to a specific subreddit (without r/ prefix)'),
    sort: z.enum(['relevance', 'hot', 'top', 'new', 'comments']).default('relevance').describe('Sort order'),
    time: z.enum(['hour', 'day', 'week', 'month', 'year', 'all']).default('all').describe('Time filter'),
    limit: z.number().int().min(1).max(100).default(25).describe('Number of results (1-100)'),
    profile: profileField,
  }),
  execute: async (inputData) => {
    const { query, subreddit, sort, time, limit, profile } = inputData as any;
    const params = new URLSearchParams({
      q: query,
      sort: sort || 'relevance',
      t: time || 'all',
      limit: String(limit || 25),
      raw_json: '1',
    });
    if (subreddit) params.set('restrict_sr', 'true');

    const prefix = subreddit ? `/r/${subreddit}` : '';
    const data = await redditFetch(`${prefix}/search?${params}`, profile);

    const items = (data?.data?.children || []).map((child: any) => {
      const p = child.data;
      return {
        id: p.id,
        title: p.title,
        subreddit: p.subreddit_name_prefixed,
        author: p.author,
        score: p.score,
        upvote_ratio: p.upvote_ratio,
        num_comments: p.num_comments,
        url: p.url,
        selftext: p.selftext ? p.selftext.substring(0, 500) : null,
        created_utc: new Date(p.created_utc * 1000).toISOString(),
        permalink: `https://reddit.com${p.permalink}`,
      };
    });
    return { items, count: items.length };
  },
});

// ── View Subreddit ──

export const reddit_view_subreddit = createTool({
  id: 'reddit_view_subreddit',
  description: 'View posts from a subreddit. Supports sorting by hot, new, top, or rising.',
  inputSchema: z.object({
    subreddit: z.string().min(1).describe('Subreddit name (without r/ prefix)'),
    sort: z.enum(['hot', 'new', 'top', 'rising']).default('hot').describe('Sort order'),
    time: z.enum(['hour', 'day', 'week', 'month', 'year', 'all']).default('day').optional().describe('Time filter (only applies when sort is "top")'),
    limit: z.number().int().min(1).max(100).default(25).describe('Number of posts (1-100)'),
    profile: profileField,
  }),
  execute: async (inputData) => {
    const { subreddit, sort, time, limit, profile } = inputData as any;
    const params = new URLSearchParams({
      limit: String(limit || 25),
      raw_json: '1',
    });
    if (sort === 'top' && time) params.set('t', time);

    const data = await redditFetch(`/r/${subreddit}/${sort || 'hot'}?${params}`, profile);

    const items = (data?.data?.children || []).map((child: any) => {
      const p = child.data;
      return {
        id: p.id,
        title: p.title,
        author: p.author,
        score: p.score,
        upvote_ratio: p.upvote_ratio,
        num_comments: p.num_comments,
        url: p.url,
        selftext: p.selftext ? p.selftext.substring(0, 500) : null,
        created_utc: new Date(p.created_utc * 1000).toISOString(),
        permalink: `https://reddit.com${p.permalink}`,
        is_self: p.is_self,
        link_flair_text: p.link_flair_text,
      };
    });
    return { items, count: items.length };
  },
});

// ── View Comments ──

export const reddit_view_comments = createTool({
  id: 'reddit_view_comments',
  description: 'View comments on a Reddit post.',
  inputSchema: z.object({
    subreddit: z.string().min(1).describe('Subreddit name (without r/ prefix)'),
    post_id: z.string().min(1).describe('The post ID (e.g. "abc123")'),
    sort: z.enum(['confidence', 'top', 'new', 'controversial', 'old', 'qa']).default('confidence').optional().describe('Comment sort order'),
    limit: z.number().int().min(1).max(100).default(25).describe('Number of top-level comments'),
    profile: profileField,
  }),
  execute: async (inputData) => {
    const { subreddit, post_id, sort, limit, profile } = inputData as any;
    const params = new URLSearchParams({
      limit: String(limit || 25),
      raw_json: '1',
    });
    if (sort) params.set('sort', sort);

    const data = await redditFetch(`/r/${subreddit}/comments/${post_id}?${params}`, profile);

    // Reddit returns [post, comments] array
    const post = data?.[0]?.data?.children?.[0]?.data;
    const comments = data?.[1]?.data?.children || [];

    return {
      post: post ? {
        id: post.id,
        title: post.title,
        author: post.author,
        score: post.score,
        selftext: post.selftext ? post.selftext.substring(0, 1000) : null,
      } : null,
      comments: comments
        .filter((c: any) => c.kind === 't1')
        .map((c: any) => {
          const d = c.data;
          return {
            id: d.id,
            author: d.author,
            body: d.body ? d.body.substring(0, 500) : null,
            score: d.score,
            created_utc: new Date(d.created_utc * 1000).toISOString(),
            replies_count: typeof d.replies === 'object' ? d.replies?.data?.children?.length || 0 : 0,
          };
        }),
    };
  },
});

// ── Create Post ──

export const reddit_create_post = createTool({
  id: 'reddit_create_post',
  description: 'Create a new post on a subreddit. Can be a text post (self) or a link post.',
  inputSchema: z.object({
    subreddit: z.string().min(1).describe('Subreddit to post in (without r/ prefix)'),
    title: z.string().min(1).max(300).describe('Post title (max 300 characters)'),
    kind: z.enum(['self', 'link']).describe('"self" for text post, "link" for link post'),
    text: z.string().optional().describe('Post body text (for self/text posts)'),
    url: z.string().url().optional().describe('URL (for link posts)'),
    profile: profileField,
  }),
  execute: async (inputData) => {
    const { subreddit, title, kind, text, url, profile } = inputData as any;

    const body: Record<string, string> = {
      sr: subreddit,
      title,
      kind,
      api_type: 'json',
    };
    if (kind === 'self' && text) body.text = text;
    if (kind === 'link' && url) body.url = url;

    const data = await redditFetch('/api/submit', profile, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    });

    const result = data?.json?.data;
    return {
      success: !data?.json?.errors?.length,
      id: result?.id,
      name: result?.name,
      url: result?.url,
      errors: data?.json?.errors || [],
    };
  },
});

// ── Comment / Reply ──

export const reddit_comment = createTool({
  id: 'reddit_comment',
  description: 'Post a comment on a Reddit post or reply to an existing comment. Use thing_id format: "t3_postId" for posts, "t1_commentId" for comment replies.',
  inputSchema: z.object({
    thing_id: z.string().min(1).describe('The fullname of the thing to reply to (e.g. "t3_abc123" for a post, "t1_xyz789" for a comment)'),
    text: z.string().min(1).describe('The comment/reply text (Markdown supported)'),
    profile: profileField,
  }),
  execute: async (inputData) => {
    const { thing_id, text, profile } = inputData as any;

    const data = await redditFetch('/api/comment', profile, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        thing_id,
        text,
        api_type: 'json',
      }).toString(),
    });

    const result = data?.json?.data?.things?.[0]?.data;
    return {
      success: !data?.json?.errors?.length,
      id: result?.id,
      name: result?.name,
      body: result?.body,
      errors: data?.json?.errors || [],
    };
  },
});
