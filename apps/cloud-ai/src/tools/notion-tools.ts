import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getBridgeSecrets } from './bridge';
import { getResolvedBridgeSecrets } from './device/shared';
import { NOTION_CLIENT_ID, NOTION_CLIENT_SECRET } from '../utils/config';
import { getClientOAuthAccount, storeClientOAuthAccount } from './vm-oauth';

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

const profileField = z.string().optional().describe(
  'OAuth profile label to use (e.g. "work", "personal"). Omit to use the default profile.',
);

function resolveProfile(explicit?: string): string | undefined {
  if (explicit) return explicit;
  try {
    const secrets = getBridgeSecrets() || getResolvedBridgeSecrets();
    return (secrets as any)?.notionProfile || (secrets as any)?.profile || undefined;
  } catch { return undefined; }
}

async function refreshNotionToken(acc: any): Promise<string | null> {
  if (!acc?.refresh_token || !NOTION_CLIENT_ID || !NOTION_CLIENT_SECRET) return null;
  try {
    const basicAuth = Buffer.from(`${NOTION_CLIENT_ID}:${NOTION_CLIENT_SECRET}`).toString('base64');
    const tokenRes = await fetch(`${NOTION_API}/oauth/token`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Basic ${basicAuth}`,
      },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: String(acc.refresh_token),
      }),
    });
    const tBody: any = await (async () => { try { return await tokenRes.json(); } catch { return null; } })();
    if (tokenRes.ok && tBody?.access_token) {
      const newAccess = String(tBody.access_token);
      const refresh_token = String(tBody.refresh_token || acc.refresh_token || '');
      try {
        await storeClientOAuthAccount('notion', {
          access_token: newAccess,
          refresh_token: refresh_token || null,
          expires_at: null,
          scopes: Array.isArray(acc.scopes) ? acc.scopes : [],
          profile_label: acc.profile_label || 'default',
          account_email: acc.account_email || null,
        });
      } catch {}
      return newAccess;
    }
  } catch {}
  return null;
}

async function notionFetch(path: string, profileLabel?: string, init?: RequestInit) {
  const profile = resolveProfile(profileLabel);
  let acc = await getClientOAuthAccount('notion', profile);
  if (!acc?.access_token) throw new Error('notion_not_connected');

  let accessToken = acc.access_token;

  async function doFetch(token: string) {
    const url = path.startsWith('http') ? path : `${NOTION_API}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...(init?.headers as any),
    };
    return fetch(url, { ...init, headers });
  }

  let res = await doFetch(accessToken);

  if (res.status === 401 && acc.refresh_token) {
    const refreshed = await refreshNotionToken(acc);
    if (refreshed) {
      accessToken = refreshed;
      res = await doFetch(accessToken);
    }
  }

  let body: any = null;
  try { body = await res.json(); } catch {}

  if (!res.ok) {
    if (res.status === 401) {
      throw new Error('Notion authentication failed. Reconnect Notion in Settings → Integrations.');
    }
    const msg = (body && (body.message || body.error)) || `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  return body;
}

function richTextFromPlain(text: string) {
  return [{ type: 'text', text: { content: text } }];
}

// ─── Read content ─────────────────────────────────────────────────────────────

export const notion_get_me = createTool({
  id: 'notion_get_me',
  description: 'Get the authenticated Notion bot user and workspace connection info.',
  inputSchema: z.object({ profile: profileField }),
  execute: async (inputData) => {
    const { profile } = inputData as any;
    const me = await notionFetch('/users/me', profile);
    return { me };
  },
});

export const notion_search = createTool({
  id: 'notion_search',
  description: 'Search pages and databases shared with the connected Notion workspace.',
  inputSchema: z.object({
    profile: profileField,
    query: z.string().optional().describe('Search text. Omit or leave empty to list accessible items.'),
    page_size: z.number().int().min(1).max(100).default(25),
    filter: z.enum(['page', 'database']).optional().describe('Restrict results to pages or databases.'),
    start_cursor: z.string().optional(),
  }),
  execute: async (inputData) => {
    const { profile, query, page_size, filter, start_cursor } = inputData as any;
    const body: Record<string, any> = {
      page_size: page_size || 25,
    };
    if (query) body.query = query;
    if (filter) body.filter = { value: filter, property: 'object' };
    if (start_cursor) body.start_cursor = start_cursor;
    const result = await notionFetch('/search', profile, { method: 'POST', body: JSON.stringify(body) });
    return result;
  },
});

export const notion_get_page = createTool({
  id: 'notion_get_page',
  description: 'Retrieve a Notion page by id, including its properties.',
  inputSchema: z.object({
    profile: profileField,
    page_id: z.string().min(1).describe('Notion page UUID (with or without dashes).'),
  }),
  execute: async (inputData) => {
    const { profile, page_id } = inputData as any;
    const page = await notionFetch(`/pages/${encodeURIComponent(page_id)}`, profile);
    return { page };
  },
});

export const notion_get_database = createTool({
  id: 'notion_get_database',
  description: 'Retrieve a Notion database schema and metadata by id.',
  inputSchema: z.object({
    profile: profileField,
    database_id: z.string().min(1),
  }),
  execute: async (inputData) => {
    const { profile, database_id } = inputData as any;
    const database = await notionFetch(`/databases/${encodeURIComponent(database_id)}`, profile);
    return { database };
  },
});

export const notion_query_database = createTool({
  id: 'notion_query_database',
  description: 'Query rows from a Notion database. Returns pages (rows) with pagination.',
  inputSchema: z.object({
    profile: profileField,
    database_id: z.string().min(1),
    page_size: z.number().int().min(1).max(100).default(50),
    start_cursor: z.string().optional(),
    filter: z.record(z.string(), z.any()).optional().describe('Notion database filter object.'),
    sorts: z.array(z.record(z.string(), z.any())).optional().describe('Notion sort objects.'),
  }),
  execute: async (inputData) => {
    const { profile, database_id, page_size, start_cursor, filter, sorts } = inputData as any;
    const body: Record<string, any> = { page_size: page_size || 50 };
    if (start_cursor) body.start_cursor = start_cursor;
    if (filter) body.filter = filter;
    if (sorts) body.sorts = sorts;
    const result = await notionFetch(`/databases/${encodeURIComponent(database_id)}/query`, profile, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return result;
  },
});

export const notion_list_block_children = createTool({
  id: 'notion_list_block_children',
  description: 'List child blocks under a page or block (page content).',
  inputSchema: z.object({
    profile: profileField,
    block_id: z.string().min(1).describe('Page id or block id whose children to list.'),
    page_size: z.number().int().min(1).max(100).default(50),
    start_cursor: z.string().optional(),
  }),
  execute: async (inputData) => {
    const { profile, block_id, page_size, start_cursor } = inputData as any;
    const params = new URLSearchParams();
    params.set('page_size', String(page_size || 50));
    if (start_cursor) params.set('start_cursor', start_cursor);
    const result = await notionFetch(`/blocks/${encodeURIComponent(block_id)}/children?${params}`, profile);
    return result;
  },
});

export const notion_get_block = createTool({
  id: 'notion_get_block',
  description: 'Retrieve a single Notion block by id.',
  inputSchema: z.object({
    profile: profileField,
    block_id: z.string().min(1),
  }),
  execute: async (inputData) => {
    const { profile, block_id } = inputData as any;
    const block = await notionFetch(`/blocks/${encodeURIComponent(block_id)}`, profile);
    return { block };
  },
});

export const notion_list_comments = createTool({
  id: 'notion_list_comments',
  description: 'List comments on a Notion page or block.',
  inputSchema: z.object({
    profile: profileField,
    block_id: z.string().min(1).describe('Page or block id to list comments for.'),
    page_size: z.number().int().min(1).max(100).default(50),
    start_cursor: z.string().optional(),
  }),
  execute: async (inputData) => {
    const { profile, block_id, page_size, start_cursor } = inputData as any;
    const params = new URLSearchParams();
    params.set('block_id', block_id);
    params.set('page_size', String(page_size || 50));
    if (start_cursor) params.set('start_cursor', start_cursor);
    const result = await notionFetch(`/comments?${params}`, profile);
    return result;
  },
});

// ─── Update content ───────────────────────────────────────────────────────────

export const notion_update_page = createTool({
  id: 'notion_update_page',
  description: 'Update properties on an existing Notion page (e.g. title, status, dates).',
  inputSchema: z.object({
    profile: profileField,
    page_id: z.string().min(1),
    properties: z.record(z.string(), z.any()).describe('Notion properties object keyed by property name.'),
    archived: z.boolean().optional().describe('Set true to archive (trash) the page.'),
    icon: z.record(z.string(), z.any()).optional(),
    cover: z.record(z.string(), z.any()).optional(),
  }),
  execute: async (inputData) => {
    const { profile, page_id, properties, archived, icon, cover } = inputData as any;
    const body: Record<string, any> = { properties };
    if (archived !== undefined) body.archived = archived;
    if (icon) body.icon = icon;
    if (cover) body.cover = cover;
    const page = await notionFetch(`/pages/${encodeURIComponent(page_id)}`, profile, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    return { page };
  },
});

export const notion_update_block = createTool({
  id: 'notion_update_block',
  description: 'Update an existing Notion block (e.g. paragraph text, toggle, to-do checked state).',
  inputSchema: z.object({
    profile: profileField,
    block_id: z.string().min(1),
    type: z.string().min(1).describe('Block type key, e.g. paragraph, to_do, heading_1.'),
    payload: z.record(z.string(), z.any()).describe('Block-type payload object (e.g. { rich_text: [...] } for paragraph).'),
    archived: z.boolean().optional(),
  }),
  execute: async (inputData) => {
    const { profile, block_id, type, payload, archived } = inputData as any;
    const body: Record<string, any> = { [type]: payload };
    if (archived !== undefined) body.archived = archived;
    const block = await notionFetch(`/blocks/${encodeURIComponent(block_id)}`, profile, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    return { block };
  },
});

// ─── Insert content ───────────────────────────────────────────────────────────

export const notion_create_page = createTool({
  id: 'notion_create_page',
  description: 'Create a new Notion page under a parent page or as a row in a database.',
  inputSchema: z.object({
    profile: profileField,
    parent_type: z.enum(['page_id', 'database_id']),
    parent_id: z.string().min(1),
    title: z.string().optional().describe('Plain-text title when parent is a page or database Title property.'),
    properties: z.record(z.string(), z.any()).optional().describe('Full properties object (required for database parents beyond title).'),
    children: z.array(z.record(z.string(), z.any())).optional().describe('Optional initial block children.'),
  }),
  execute: async (inputData) => {
    const { profile, parent_type, parent_id, title, properties, children } = inputData as any;
    const body: Record<string, any> = {
      parent: { [parent_type]: parent_id },
    };
    if (properties) {
      body.properties = properties;
    } else if (title) {
      body.properties = {
        title: { title: richTextFromPlain(title) },
      };
    }
    if (children?.length) body.children = children;
    const page = await notionFetch('/pages', profile, { method: 'POST', body: JSON.stringify(body) });
    return { page };
  },
});

export const notion_append_blocks = createTool({
  id: 'notion_append_blocks',
  description: 'Append one or more blocks to a page or block (insert content).',
  inputSchema: z.object({
    profile: profileField,
    block_id: z.string().min(1).describe('Parent page or block id.'),
    children: z.array(z.record(z.string(), z.any())).min(1).describe('Array of Notion block objects to append.'),
  }),
  execute: async (inputData) => {
    const { profile, block_id, children } = inputData as any;
    const result = await notionFetch(`/blocks/${encodeURIComponent(block_id)}/children`, profile, {
      method: 'PATCH',
      body: JSON.stringify({ children }),
    });
    return result;
  },
});

export const notion_append_paragraph = createTool({
  id: 'notion_append_paragraph',
  description: 'Append a plain-text paragraph block to a Notion page.',
  inputSchema: z.object({
    profile: profileField,
    page_id: z.string().min(1),
    text: z.string().min(1),
  }),
  execute: async (inputData) => {
    const { profile, page_id, text } = inputData as any;
    const result = await notionFetch(`/blocks/${encodeURIComponent(page_id)}/children`, profile, {
      method: 'PATCH',
      body: JSON.stringify({
        children: [{
          object: 'block',
          type: 'paragraph',
          paragraph: { rich_text: richTextFromPlain(text) },
        }],
      }),
    });
    return result;
  },
});

// ─── Insert comments ──────────────────────────────────────────────────────────

export const notion_create_comment = createTool({
  id: 'notion_create_comment',
  description: 'Add a comment to a Notion page, block, or existing discussion thread.',
  inputSchema: z.object({
    profile: profileField,
    text: z.string().min(1).describe('Plain-text comment body.'),
    page_id: z.string().optional().describe('Parent page id (use one of page_id, block_id, or discussion_id).'),
    block_id: z.string().optional().describe('Parent block id.'),
    discussion_id: z.string().optional().describe('Existing discussion thread id to reply in.'),
  }),
  execute: async (inputData) => {
    const { profile, text, page_id, block_id, discussion_id } = inputData as any;
    const body: Record<string, any> = { rich_text: richTextFromPlain(text) };
    if (discussion_id) {
      body.discussion_id = discussion_id;
    } else if (page_id) {
      body.parent = { page_id };
    } else if (block_id) {
      body.parent = { block_id };
    } else {
      throw new Error('Provide page_id, block_id, or discussion_id');
    }
    const comment = await notionFetch('/comments', profile, { method: 'POST', body: JSON.stringify(body) });
    return { comment };
  },
});
