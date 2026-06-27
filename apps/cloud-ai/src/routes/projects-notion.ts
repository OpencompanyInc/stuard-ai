/**
 * Project ↔ Notion sync routes (desktop-driven).
 *
 * The desktop main process polls these on a timer (see desktop
 * services/project-notion-sync.ts) because the client bridge is per-request —
 * cloud-ai cannot push async results into the desktop's memory.db. The split:
 *
 *  - cloud-ai (here): talks to the Notion API (token refresh needs the client
 *    secret), normalizes pages/database rows to plain text, generates
 *    embeddings, and appends/updates pushed journal blocks.
 *  - desktop: owns the sync schedule, persists pulled items as project-scoped
 *    memories in the local agent DB, and stores sync state in
 *    projects.settings_json.notion.
 *
 * Token resolution: the desktop relays its device-local Notion token in the
 * request body (tokens are device-resident per the OAuth-local migration);
 * VM-stored accounts are the fallback. Refreshed tokens are returned to the
 * caller so the desktop can write them back to its local store.
 *
 * POST /v1/projects/notion/search  { query?, access_token?, refresh_token? }
 * POST /v1/projects/notion/sync    { project_id, notion: {...}, access_token?,
 *                                    refresh_token?, journal_entries? }
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { authenticateHttpLegacy, sendAuthError } from '../auth/http';
import { AuthErrorCode } from '../auth';
import { listVMOAuthAccountsForUser } from '../tools/vm-oauth';
import { NOTION_CLIENT_ID, NOTION_CLIENT_SECRET } from '../utils/config';
import { generateEmbedding } from '../memory/conversations';

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

const MAX_BLOCKS_PER_PAGE = 400;
const MAX_CHILD_PAGES = 15;
const MAX_DATABASE_ROWS = 50;
const MAX_PUSH_BLOCKS_PER_SYNC = 30;
const MAX_ITEM_CONTENT_CHARS = 12_000;

interface NotionTokens {
  access_token: string;
  refresh_token?: string | null;
}

interface PulledItem {
  notion_id: string;
  kind: 'page' | 'database_row';
  title: string;
  content: string;
  url: string | null;
  last_edited_time: string | null;
  embedding?: number[];
}

function json(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

async function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch { resolve({}); }
    });
  });
}

async function resolveTokens(userId: string, body: any): Promise<NotionTokens | null> {
  const bodyToken = String(body?.access_token || '').trim();
  if (bodyToken) {
    return { access_token: bodyToken, refresh_token: body?.refresh_token ? String(body.refresh_token) : null };
  }
  const profile = body?.notion?.profile ? String(body.notion.profile) : undefined;
  const accounts = await listVMOAuthAccountsForUser(userId, 'notion').catch(() => []);
  const acc = accounts.find((a) => !profile || a.profile_label === profile)
    || accounts.find((a) => a.is_default)
    || accounts[0]
    || null;
  if (!acc?.access_token) return null;
  return { access_token: acc.access_token, refresh_token: acc.refresh_token || null };
}

async function refreshNotionToken(refreshToken: string): Promise<NotionTokens | null> {
  if (!refreshToken || !NOTION_CLIENT_ID || !NOTION_CLIENT_SECRET) return null;
  try {
    const basicAuth = Buffer.from(`${NOTION_CLIENT_ID}:${NOTION_CLIENT_SECRET}`).toString('base64');
    const resp = await fetch(`${NOTION_API}/oauth/token`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Basic ${basicAuth}`,
      },
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    });
    const body: any = await resp.json().catch(() => null);
    if (resp.ok && body?.access_token) {
      return {
        access_token: String(body.access_token),
        refresh_token: String(body.refresh_token || refreshToken),
      };
    }
  } catch { /* fall through */ }
  return null;
}

/**
 * Stateful Notion client for one sync request: retries once with a refreshed
 * token on 401 and remembers the refreshed pair so the route can hand it back
 * to the desktop.
 */
class NotionClient {
  refreshed: NotionTokens | null = null;
  constructor(private tokens: NotionTokens) {}

  async fetch(path: string, init?: RequestInit): Promise<any> {
    const doFetch = (token: string) => fetch(path.startsWith('http') ? path : `${NOTION_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
        ...(init?.headers as any),
      },
    });

    let resp = await doFetch(this.tokens.access_token);
    if (resp.status === 401 && this.tokens.refresh_token) {
      const refreshed = await refreshNotionToken(this.tokens.refresh_token);
      if (refreshed) {
        this.tokens = refreshed;
        this.refreshed = refreshed;
        resp = await doFetch(refreshed.access_token);
      }
    }

    const body: any = await resp.json().catch(() => null);
    if (!resp.ok) {
      if (resp.status === 401) throw new Error('notion_auth_failed');
      const msg = (body && (body.message || body.code)) || `${resp.status} ${resp.statusText}`;
      throw new Error(String(msg));
    }
    return body;
  }
}

function richTextToPlain(richText: any): string {
  if (!Array.isArray(richText)) return '';
  return richText.map((t: any) => String(t?.plain_text ?? '')).join('');
}

function blockToText(block: any): string {
  const type = String(block?.type || '');
  const data = block?.[type];
  if (!data) return '';
  switch (type) {
    case 'heading_1': return `# ${richTextToPlain(data.rich_text)}`;
    case 'heading_2': return `## ${richTextToPlain(data.rich_text)}`;
    case 'heading_3': return `### ${richTextToPlain(data.rich_text)}`;
    case 'bulleted_list_item': return `- ${richTextToPlain(data.rich_text)}`;
    case 'numbered_list_item': return `1. ${richTextToPlain(data.rich_text)}`;
    case 'to_do': return `[${data.checked ? 'x' : ' '}] ${richTextToPlain(data.rich_text)}`;
    case 'quote': return `> ${richTextToPlain(data.rich_text)}`;
    case 'code': return '```\n' + richTextToPlain(data.rich_text) + '\n```';
    case 'callout':
    case 'toggle':
    case 'paragraph': return richTextToPlain(data.rich_text);
    case 'child_page': return ''; // surfaced as separate items
    case 'divider': return '---';
    case 'bookmark': return String(data.url || '');
    case 'equation': return String(data.expression || '');
    default: return data.rich_text ? richTextToPlain(data.rich_text) : '';
  }
}

function pagePropertiesToText(properties: any): string {
  if (!properties || typeof properties !== 'object') return '';
  const lines: string[] = [];
  for (const [name, prop] of Object.entries<any>(properties)) {
    if (!prop || prop.type === 'title') continue;
    let value = '';
    switch (prop.type) {
      case 'rich_text': value = richTextToPlain(prop.rich_text); break;
      case 'select': value = String(prop.select?.name || ''); break;
      case 'multi_select': value = (prop.multi_select || []).map((s: any) => s?.name).filter(Boolean).join(', '); break;
      case 'status': value = String(prop.status?.name || ''); break;
      case 'date': value = [prop.date?.start, prop.date?.end].filter(Boolean).join(' → '); break;
      case 'number': value = prop.number != null ? String(prop.number) : ''; break;
      case 'checkbox': value = prop.checkbox ? 'yes' : 'no'; break;
      case 'url': value = String(prop.url || ''); break;
      case 'email': value = String(prop.email || ''); break;
      case 'phone_number': value = String(prop.phone_number || ''); break;
      case 'people': value = (prop.people || []).map((p: any) => p?.name).filter(Boolean).join(', '); break;
      default: value = '';
    }
    if (value) lines.push(`${name}: ${value}`);
  }
  return lines.join('\n');
}

function pageTitle(page: any): string {
  const properties = page?.properties || {};
  for (const prop of Object.values<any>(properties)) {
    if (prop?.type === 'title') {
      const title = richTextToPlain(prop.title);
      if (title) return title;
    }
  }
  // Plain pages expose the title under properties.title as well, but cover
  // the child_page shape too.
  return String(page?.child_page?.title || 'Untitled');
}

/** Fetch a page's block children (paginated), returning text + child page ids. */
async function collectPageText(
  client: NotionClient,
  pageId: string,
  depth: number,
): Promise<{ text: string; childPageIds: string[] }> {
  const lines: string[] = [];
  const childPageIds: string[] = [];
  let blockCount = 0;

  async function walk(blockId: string, level: number): Promise<void> {
    let cursor: string | undefined;
    do {
      const params = new URLSearchParams({ page_size: '100' });
      if (cursor) params.set('start_cursor', cursor);
      const body = await client.fetch(`/blocks/${blockId}/children?${params.toString()}`);
      const results: any[] = Array.isArray(body?.results) ? body.results : [];
      for (const block of results) {
        if (blockCount >= MAX_BLOCKS_PER_PAGE) return;
        blockCount++;
        if (block?.type === 'child_page') {
          childPageIds.push(String(block.id));
          continue;
        }
        if (block?.type === 'child_database') continue;
        const text = blockToText(block);
        if (text) lines.push('  '.repeat(level) + text);
        if (block?.has_children && level < depth) {
          await walk(String(block.id), level + 1);
        }
      }
      cursor = body?.has_more ? String(body?.next_cursor || '') : undefined;
    } while (cursor && blockCount < MAX_BLOCKS_PER_PAGE);
  }

  await walk(pageId, 0);
  return { text: lines.join('\n'), childPageIds };
}

async function buildItemEmbedding(item: PulledItem): Promise<number[] | undefined> {
  try {
    const embedding = await generateEmbedding(`${item.title}\n\n${item.content}`.slice(0, 8000));
    return embedding.length > 0 ? embedding : undefined;
  } catch {
    return undefined;
  }
}

function newerThan(time: string | null, cursor: string | null): boolean {
  if (!cursor) return true;
  if (!time) return true;
  const t = Date.parse(time);
  const c = Date.parse(cursor);
  if (!Number.isFinite(t) || !Number.isFinite(c)) return true;
  return t > c;
}

/** Pull a linked page (plus direct child pages) as normalized items. */
async function pullPage(
  client: NotionClient,
  pageId: string,
  sinceIso: string | null,
): Promise<PulledItem[]> {
  const items: PulledItem[] = [];

  const page = await client.fetch(`/pages/${pageId}`);
  const rootEdited = String(page?.last_edited_time || '') || null;
  const { text, childPageIds } = await collectPageText(client, pageId, 2);

  if (newerThan(rootEdited, sinceIso)) {
    items.push({
      notion_id: String(page?.id || pageId),
      kind: 'page',
      title: pageTitle(page),
      content: text.slice(0, MAX_ITEM_CONTENT_CHARS),
      url: String(page?.url || '') || null,
      last_edited_time: rootEdited,
    });
  }

  for (const childId of childPageIds.slice(0, MAX_CHILD_PAGES)) {
    try {
      const child = await client.fetch(`/pages/${childId}`);
      const childEdited = String(child?.last_edited_time || '') || null;
      if (!newerThan(childEdited, sinceIso)) continue;
      const childContent = await collectPageText(client, childId, 1);
      items.push({
        notion_id: String(child?.id || childId),
        kind: 'page',
        title: pageTitle(child),
        content: childContent.text.slice(0, MAX_ITEM_CONTENT_CHARS),
        url: String(child?.url || '') || null,
        last_edited_time: childEdited,
      });
    } catch { /* child page may be inaccessible — skip */ }
  }

  return items;
}

/** Pull recently edited rows of a linked database as normalized items. */
async function pullDatabase(
  client: NotionClient,
  databaseId: string,
  sinceIso: string | null,
): Promise<PulledItem[]> {
  const body = await client.fetch(`/databases/${databaseId}/query`, {
    method: 'POST',
    body: JSON.stringify({
      page_size: MAX_DATABASE_ROWS,
      sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
    }),
  });

  const items: PulledItem[] = [];
  const rows: any[] = Array.isArray(body?.results) ? body.results : [];
  for (const row of rows) {
    const edited = String(row?.last_edited_time || '') || null;
    if (!newerThan(edited, sinceIso)) continue; // sorted desc — everything after is older
    const props = pagePropertiesToText(row?.properties);
    let blocks = '';
    try {
      blocks = (await collectPageText(client, String(row.id), 1)).text;
    } catch { /* row body unreadable — properties still useful */ }
    const content = [props, blocks].filter(Boolean).join('\n\n');
    items.push({
      notion_id: String(row.id),
      kind: 'database_row',
      title: pageTitle(row),
      content: content.slice(0, MAX_ITEM_CONTENT_CHARS),
      url: String(row?.url || '') || null,
      last_edited_time: edited,
    });
  }
  return items;
}

function journalEntryToNotionText(entry: any): string {
  const ts = String(entry?.ts || entry?.created_at || '').slice(0, 10);
  const type = String(entry?.type || 'note');
  const title = String(entry?.title || '').trim();
  const body = String(entry?.body || '').trim();
  const head = `${ts ? ts + ' — ' : ''}[${type}] ${title}`;
  return body ? `${head}\n${body}`.slice(0, 1900) : head.slice(0, 1900);
}

/**
 * Push journal entries to the linked page as paragraph blocks under a
 * "Stuard — Project Timeline" heading. Entries already pushed are updated in
 * place via their recorded block id (the auto-journal extends session entries,
 * so block text changes over time).
 */
async function pushJournal(
  client: NotionClient,
  pageId: string,
  entries: any[],
  state: { push_root_block_id?: string | null; pushed_entries?: Record<string, string> },
): Promise<{ pushed_entries: Record<string, string>; push_root_block_id: string | null; pushed: number; updated: number }> {
  const pushedEntries: Record<string, string> = { ...(state.pushed_entries || {}) };
  let rootBlockId = state.push_root_block_id || null;
  let pushed = 0;
  let updated = 0;

  if (!rootBlockId) {
    const created = await client.fetch(`/blocks/${pageId}/children`, {
      method: 'PATCH',
      body: JSON.stringify({
        children: [{
          object: 'block',
          type: 'heading_2',
          heading_2: { rich_text: [{ type: 'text', text: { content: 'Stuard — Project Timeline' } }] },
        }],
      }),
    });
    rootBlockId = String(created?.results?.[0]?.id || '') || null;
  }

  // Oldest first so the page reads chronologically.
  const ordered = [...entries].sort((a, b) =>
    Date.parse(String(a?.ts || a?.created_at || 0)) - Date.parse(String(b?.ts || b?.created_at || 0)));

  let writes = 0;
  for (const entry of ordered) {
    if (writes >= MAX_PUSH_BLOCKS_PER_SYNC) break;
    const entryId = String(entry?.id || '');
    if (!entryId) continue;

    const text = journalEntryToNotionText(entry);
    const existingBlockId = pushedEntries[entryId];

    if (existingBlockId) {
      // Only rewrite when the entry changed since it was pushed (the desktop
      // pre-filters, but stay defensive).
      try {
        await client.fetch(`/blocks/${existingBlockId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            paragraph: { rich_text: [{ type: 'text', text: { content: text } }] },
          }),
        });
        updated++;
        writes++;
      } catch {
        // Block deleted on the Notion side — drop the mapping so it re-pushes
        // next sync.
        delete pushedEntries[entryId];
      }
      continue;
    }

    try {
      const created = await client.fetch(`/blocks/${pageId}/children`, {
        method: 'PATCH',
        body: JSON.stringify({
          children: [{
            object: 'block',
            type: 'paragraph',
            paragraph: { rich_text: [{ type: 'text', text: { content: text } }] },
          }],
        }),
      });
      const blockId = String(created?.results?.[0]?.id || '');
      if (blockId) {
        pushedEntries[entryId] = blockId;
        pushed++;
        writes++;
      }
    } catch { /* tolerate per-entry failures */ }
  }

  return { pushed_entries: pushedEntries, push_root_block_id: rootBlockId, pushed, updated };
}

export async function handleProjectsNotionRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parsedUrl: URL,
): Promise<boolean> {
  const path = parsedUrl.pathname;
  if (!path.startsWith('/v1/projects/notion/')) return false;
  if (req.method !== 'POST') return false;

  const authResult = await authenticateHttpLegacy(req, parsedUrl);
  if (!authResult.success || !authResult.userId) {
    sendAuthError(res, authResult.error || AuthErrorCode.UNAUTHORIZED, authResult.message);
    return true;
  }
  const userId = authResult.userId;
  const body = await readBody(req);

  const tokens = await resolveTokens(userId, body);
  if (!tokens) {
    json(res, 200, { ok: false, error: 'notion_not_connected' });
    return true;
  }
  const client = new NotionClient(tokens);

  // ── Search pages/databases for the link picker ──────────────────────────
  if (path === '/v1/projects/notion/search') {
    try {
      const query = String(body?.query || '').trim();
      const result = await client.fetch('/search', {
        method: 'POST',
        body: JSON.stringify({
          ...(query ? { query } : {}),
          page_size: 20,
          sort: { direction: 'descending', timestamp: 'last_edited_time' },
        }),
      });
      const results = (Array.isArray(result?.results) ? result.results : []).map((r: any) => ({
        id: String(r?.id || ''),
        type: r?.object === 'database' ? 'database' : 'page',
        title: r?.object === 'database'
          ? (richTextToPlain(r?.title) || 'Untitled database')
          : pageTitle(r),
        url: String(r?.url || '') || null,
        icon: r?.icon?.emoji || null,
        last_edited_time: String(r?.last_edited_time || '') || null,
      })).filter((r: any) => r.id);
      json(res, 200, { ok: true, results, refreshed_tokens: client.refreshed });
    } catch (e: any) {
      json(res, 200, { ok: false, error: String(e?.message || e) });
    }
    return true;
  }

  // ── Sync (pull + optional push) ─────────────────────────────────────────
  if (path === '/v1/projects/notion/sync') {
    try {
      const notion = body?.notion || {};
      const pageId = String(notion.page_id || '').trim();
      const databaseId = String(notion.database_id || '').trim();
      if (!pageId && !databaseId) {
        json(res, 200, { ok: false, error: 'missing_notion_target' });
        return true;
      }
      const sinceIso = notion.last_pulled_at ? String(notion.last_pulled_at) : null;

      const items = databaseId
        ? await pullDatabase(client, databaseId, sinceIso)
        : await pullPage(client, pageId, sinceIso);

      // Embed pulled items so they participate in project_search.
      for (const item of items) {
        item.embedding = await buildItemEmbedding(item);
      }

      let push: Awaited<ReturnType<typeof pushJournal>> | null = null;
      let pushError: string | null = null;
      if (notion.push_enabled && Array.isArray(body?.journal_entries) && body.journal_entries.length > 0) {
        if (!pageId) {
          pushError = 'push_requires_page_target';
        } else {
          push = await pushJournal(client, pageId, body.journal_entries, {
            push_root_block_id: notion.push_root_block_id || null,
            pushed_entries: notion.pushed_entries || {},
          });
        }
      }

      json(res, 200, {
        ok: true,
        items,
        push,
        push_error: pushError,
        synced_at: new Date().toISOString(),
        refreshed_tokens: client.refreshed,
      });
    } catch (e: any) {
      const message = String(e?.message || e);
      json(res, 200, { ok: false, error: message, auth_failed: message === 'notion_auth_failed' });
    }
    return true;
  }

  return false;
}
