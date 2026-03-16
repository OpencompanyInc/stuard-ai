import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getExternalAccount } from '../supabase';
import { getBridgeSecrets } from './bridge';

const FACEBOOK_API = 'https://graph.facebook.com/v22.0';
const INSTAGRAM_API = 'https://graph.instagram.com/v22.0';
const THREADS_API = 'https://graph.threads.net/v1.0';

const profileField = z.string().optional().describe(
  'OAuth profile label to use (e.g. "work", "personal"). Omit to use the default profile.'
);

function resolveProfile(explicit?: string): string | undefined {
  if (explicit) return explicit;
  try {
    const secrets = getBridgeSecrets();
    return (secrets as any)?.profile || undefined;
  } catch {
    return undefined;
  }
}

function requireUserId(): string {
  const secrets = getBridgeSecrets();
  const userId = String((secrets as any)?.userId || '');
  if (!userId) throw new Error('missing_user_context');
  return userId;
}

async function requireConnectedAccount(provider: 'facebook' | 'instagram' | 'threads', profileLabel?: string) {
  const userId = requireUserId();
  const profile = resolveProfile(profileLabel);
  const acc = await getExternalAccount(userId, provider, profile);
  if (!acc?.access_token) throw new Error(`${provider}_not_connected`);
  return acc;
}

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null) as any;
  if (!res.ok) {
    const msg = body?.error?.message || body?.message || body?.error_description || `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  return body;
}

async function postForm(url: string, form: Record<string, string | number | boolean | undefined | null>) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(form)) {
    if (value === undefined || value === null || value === '') continue;
    body.set(key, String(value));
  }
  return fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
}

function pickExternalUserId(acc: any): string {
  return String(
    acc?.meta?.external_user_id ||
    acc?.meta?.profile?.id ||
    acc?.meta?.profile?.user_id ||
    ''
  ).trim();
}

async function getFacebookProfile(profileLabel?: string) {
  const acc = await requireConnectedAccount('facebook', profileLabel);
  const token = String(acc.access_token);
  const me = await fetchJson(`${FACEBOOK_API}/me?fields=id,name,email&access_token=${encodeURIComponent(token)}`);
  return { acc, token, me };
}

async function getFacebookPages(token: string) {
  const data = await fetchJson(
    `${FACEBOOK_API}/me/accounts?fields=id,name,access_token,category,tasks,picture{url},instagram_business_account{id,username}&access_token=${encodeURIComponent(token)}`
  );
  return Array.isArray(data?.data) ? data.data : [];
}

async function resolveFacebookPage(token: string, pageId?: string) {
  const pages = await getFacebookPages(token);
  if (pages.length === 0) {
    throw new Error('facebook_no_pages: No Facebook Pages were found for this account. To publish posts you need a Facebook Page connected to the app.');
  }
  const explicit = String(pageId || '').trim();
  if (explicit) {
    const matched = pages.find((page: any) => String(page?.id) === explicit);
    if (!matched) {
      throw new Error(`facebook_page_not_found: Could not find page ${explicit}. Call facebook_list_pages first.`);
    }
    return { page: matched, pages };
  }
  if (pages.length === 1) {
    return { page: pages[0], pages };
  }
  throw new Error('facebook_page_required: Multiple Facebook Pages are available. Call facebook_list_pages first and pass page_id.');
}

async function getInstagramProfile(profileLabel?: string) {
  const acc = await requireConnectedAccount('instagram', profileLabel);
  const token = String(acc.access_token);
  const userId = pickExternalUserId(acc);
  const profile = acc?.meta?.profile || await fetchJson(
    `${INSTAGRAM_API}/me?fields=id,user_id,username,name,account_type,profile_picture_url&access_token=${encodeURIComponent(token)}`
  );
  return { acc, token, userId: userId || String(profile?.id || profile?.user_id || '').trim(), profile };
}

async function getThreadsProfile(profileLabel?: string) {
  const acc = await requireConnectedAccount('threads', profileLabel);
  const token = String(acc.access_token);
  const profile = acc?.meta?.profile || await fetchJson(
    `${THREADS_API}/me?fields=id,username,name,threads_profile_picture_url,threads_biography&access_token=${encodeURIComponent(token)}`
  );
  return { acc, token, userId: String(profile?.id || pickExternalUserId(acc) || '').trim(), profile };
}

export const facebook_get_me = createTool({
  id: 'facebook_get_me',
  description: 'Get the connected Facebook profile and a list of Facebook Pages the user can manage.',
  inputSchema: z.object({ profile: profileField }),
  execute: async (inputData) => {
    const { profile } = inputData as any;
    const { me, token } = await getFacebookProfile(profile);
    const pages = await getFacebookPages(token);
    return {
      me,
      pages: pages.map((page: any) => ({
        id: page.id,
        name: page.name,
        category: page.category || null,
        tasks: Array.isArray(page.tasks) ? page.tasks : [],
        picture: page?.picture?.data?.url || null,
        instagram_business_account: page?.instagram_business_account || null,
      })),
      count: pages.length,
    };
  },
});

export const facebook_list_pages = createTool({
  id: 'facebook_list_pages',
  description: 'List Facebook Pages the connected user can manage. Use this before creating or reading Page posts.',
  inputSchema: z.object({ profile: profileField }),
  execute: async (inputData) => {
    const { profile } = inputData as any;
    const { token } = await getFacebookProfile(profile);
    const pages = await getFacebookPages(token);
    return {
      pages: pages.map((page: any) => ({
        id: page.id,
        name: page.name,
        category: page.category || null,
        tasks: Array.isArray(page.tasks) ? page.tasks : [],
        picture: page?.picture?.data?.url || null,
        instagram_business_account: page?.instagram_business_account || null,
      })),
      count: pages.length,
    };
  },
});

export const facebook_list_page_posts = createTool({
  id: 'facebook_list_page_posts',
  description: 'List posts from a Facebook Page. If the account has more than one Page, pass page_id.',
  inputSchema: z.object({
    page_id: z.string().optional().describe('Facebook Page ID. Required if the account manages multiple Pages.'),
    limit: z.number().int().min(1).max(100).default(10),
    profile: profileField,
  }),
  execute: async (inputData) => {
    const { page_id, limit, profile } = inputData as any;
    const { token } = await getFacebookProfile(profile);
    const { page } = await resolveFacebookPage(token, page_id);
    const data = await fetchJson(
      `${FACEBOOK_API}/${page.id}/posts?fields=id,message,created_time,permalink_url,full_picture,status_type&limit=${encodeURIComponent(String(limit || 10))}&access_token=${encodeURIComponent(String(page.access_token || ''))}`
    );
    const posts = Array.isArray(data?.data) ? data.data : [];
    return {
      page: { id: page.id, name: page.name },
      posts,
      count: posts.length,
      paging: data?.paging || null,
    };
  },
});

export const facebook_create_page_post = createTool({
  id: 'facebook_create_page_post',
  description: 'Create a post on a Facebook Page. Requires pages_manage_posts and a Page the connected user can manage.',
  inputSchema: z.object({
    page_id: z.string().optional().describe('Facebook Page ID. Required if the account manages multiple Pages.'),
    message: z.string().min(1).describe('The post text to publish.'),
    link: z.string().url().optional().describe('Optional link to include in the post.'),
    published: z.boolean().default(true),
    profile: profileField,
  }),
  execute: async (inputData) => {
    const { page_id, message, link, published, profile } = inputData as any;
    const { token } = await getFacebookProfile(profile);
    const { page } = await resolveFacebookPage(token, page_id);
    const created = await postForm(`${FACEBOOK_API}/${page.id}/feed`, {
      access_token: String(page.access_token || ''),
      message,
      link,
      published: published !== false,
    });
    let permalink_url: string | null = null;
    try {
      const postInfo = await fetchJson(`${FACEBOOK_API}/${created.id}?fields=permalink_url&access_token=${encodeURIComponent(String(page.access_token || ''))}`);
      permalink_url = postInfo?.permalink_url || null;
    } catch {}
    return {
      ok: true,
      id: created?.id || null,
      page: { id: page.id, name: page.name },
      permalink_url,
    };
  },
});

export const instagram_get_me = createTool({
  id: 'instagram_get_me',
  description: 'Get the connected Instagram professional account profile.',
  inputSchema: z.object({ profile: profileField }),
  execute: async (inputData) => {
    const { profile } = inputData as any;
    const { profile: me, userId } = await getInstagramProfile(profile);
    return { me, userId };
  },
});

export const instagram_list_media = createTool({
  id: 'instagram_list_media',
  description: 'List media from the connected Instagram professional account.',
  inputSchema: z.object({
    limit: z.number().int().min(1).max(100).default(10),
    profile: profileField,
  }),
  execute: async (inputData) => {
    const { limit, profile } = inputData as any;
    const { token, userId } = await getInstagramProfile(profile);
    if (!userId) throw new Error('instagram_user_missing: Could not resolve the Instagram account ID. Reconnect Instagram and try again.');
    const data = await fetchJson(
      `${INSTAGRAM_API}/${userId}/media?fields=id,caption,media_type,media_url,permalink,thumbnail_url,timestamp,username&limit=${encodeURIComponent(String(limit || 10))}&access_token=${encodeURIComponent(token)}`
    );
    const items = Array.isArray(data?.data) ? data.data : [];
    return { items, count: items.length, paging: data?.paging || null };
  },
});

export const instagram_publish_media = createTool({
  id: 'instagram_publish_media',
  description: 'Publish media to Instagram. Supports IMAGE, VIDEO, and REELS from public URLs.',
  inputSchema: z.object({
    media_type: z.enum(['IMAGE', 'VIDEO', 'REELS']).default('IMAGE'),
    image_url: z.string().url().optional().describe('Public image URL for IMAGE posts.'),
    video_url: z.string().url().optional().describe('Public video URL for VIDEO or REELS posts.'),
    caption: z.string().optional(),
    alt_text: z.string().optional(),
    thumb_offset: z.number().int().min(0).optional().describe('Thumbnail offset in ms for video posts.'),
    profile: profileField,
  }),
  execute: async (inputData) => {
    const { media_type, image_url, video_url, caption, alt_text, thumb_offset, profile } = inputData as any;
    const { token, userId } = await getInstagramProfile(profile);
    if (!userId) throw new Error('instagram_user_missing: Could not resolve the Instagram account ID. Reconnect Instagram and try again.');
    if (media_type === 'IMAGE' && !image_url) {
      throw new Error('instagram_image_url_required: image_url is required for IMAGE posts.');
    }
    if ((media_type === 'VIDEO' || media_type === 'REELS') && !video_url) {
      throw new Error('instagram_video_url_required: video_url is required for VIDEO and REELS posts.');
    }
    const container = await postForm(`${INSTAGRAM_API}/${userId}/media`, {
      access_token: token,
      media_type: media_type === 'IMAGE' ? undefined : media_type,
      image_url,
      video_url,
      caption,
      alt_text,
      thumb_offset,
    });
    const published = await postForm(`${INSTAGRAM_API}/${userId}/media_publish`, {
      access_token: token,
      creation_id: String(container?.id || ''),
    });
    return {
      ok: true,
      creation_id: container?.id || null,
      id: published?.id || null,
      media_type,
    };
  },
});

export const threads_get_me = createTool({
  id: 'threads_get_me',
  description: 'Get the connected Threads profile.',
  inputSchema: z.object({ profile: profileField }),
  execute: async (inputData) => {
    const { profile } = inputData as any;
    const { profile: me, userId } = await getThreadsProfile(profile);
    return { me, userId };
  },
});

export const threads_list_posts = createTool({
  id: 'threads_list_posts',
  description: 'List recent posts from the connected Threads profile.',
  inputSchema: z.object({
    limit: z.number().int().min(1).max(100).default(10),
    profile: profileField,
  }),
  execute: async (inputData) => {
    const { limit, profile } = inputData as any;
    const { token } = await getThreadsProfile(profile);
    const data = await fetchJson(
      `${THREADS_API}/me/threads?fields=id,media_type,text,permalink,timestamp,shortcode,username&limit=${encodeURIComponent(String(limit || 10))}&access_token=${encodeURIComponent(token)}`
    );
    const items = Array.isArray(data?.data) ? data.data : [];
    return { items, count: items.length, paging: data?.paging || null };
  },
});

export const threads_publish_post = createTool({
  id: 'threads_publish_post',
  description: 'Publish a text post to Threads.',
  inputSchema: z.object({
    text: z.string().min(1).max(500).describe('Text content for the Threads post.'),
    reply_control: z.enum(['everyone', 'accounts_you_follow', 'mentioned_only']).optional(),
    profile: profileField,
  }),
  execute: async (inputData) => {
    const { text, reply_control, profile } = inputData as any;
    const { token } = await getThreadsProfile(profile);
    const creation = await postForm(`${THREADS_API}/me/threads`, {
      media_type: 'TEXT',
      text,
      reply_control,
      access_token: token,
    });
    const published = await postForm(`${THREADS_API}/me/threads_publish`, {
      creation_id: String(creation?.id || ''),
      access_token: token,
    });
    return {
      ok: true,
      creation_id: creation?.id || null,
      id: published?.id || null,
      text,
    };
  },
});
