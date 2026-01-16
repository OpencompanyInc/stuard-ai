import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getExternalAccount, upsertExternalAccount } from '../supabase';
import { getBridgeSecrets } from './bridge';
import { PUBLIC_BASE_URL as CFG_PUBLIC_BASE_URL, GOOGLE_CLIENT_ID as CFG_GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET as CFG_GOOGLE_CLIENT_SECRET } from '../utils/config';
import { refreshGoogleTokenIfNeeded } from '../routes/integrations/google-shared';

const GOOGLE_API = 'https://www.googleapis.com';
const GOOGLE_CLIENT_ID = CFG_GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = CFG_GOOGLE_CLIENT_SECRET || '';
const PUBLIC_BASE = CFG_PUBLIC_BASE_URL || 'http://localhost:8082';

async function requireUserId(): Promise<string> {
  const secrets = getBridgeSecrets();
  const userId = String((secrets as any)?.userId || '');
  if (!userId) throw new Error('missing_user_context');
  return userId;
}

async function getGoogleAccountOrThrow(userId: string) {
  const acc = await getExternalAccount(userId, 'google');
  if (!acc) throw new Error('google_not_connected');
  return acc;
}

function targetForScopes(required: string[]): string | '' {
  const s = required.join(' ');
  if (/gmail\./.test(s)) return 'gmail';
  if (/calendar\./.test(s)) return 'calendar';
  if (/drive(\.| |$)/.test(s)) return 'drive';
  if (/spreadsheets(\.| |$)/.test(s)) return 'sheets';
  if (/documents(\.| |$)/.test(s)) return 'docs';
  if (/tasks/.test(s)) return 'tasks';
  return '';
}

function buildConnectPath(required: string[]): string {
  const target = targetForScopes(required);
  if (target) return `/integrations/google/connect?target=${encodeURIComponent(target)}`;
  const scopes = encodeURIComponent(required.join(' '));
  return `/integrations/google/connect?scopes=${scopes}`;
}

const SCOPE_HIERARCHY: Record<string, string[]> = {
  'https://www.googleapis.com/auth/drive': ['https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/drive.file'],
  'https://www.googleapis.com/auth/documents': ['https://www.googleapis.com/auth/documents.readonly'],
  'https://www.googleapis.com/auth/spreadsheets': ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  'https://www.googleapis.com/auth/gmail.modify': ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'],
};

async function ensureConnectedAndScopes(required: string[]) {
  const secrets = getBridgeSecrets();
  const userId = String((secrets as any)?.userId || '');
  if (!userId) return { ok: false, error: 'missing_user_context' } as const;
  const acc = await getExternalAccount(userId, 'google');
  if (!acc) {
    const connectPath = buildConnectPath(required);
    return { ok: false, error: 'google_not_connected', connectPath, url: `${PUBLIC_BASE}${connectPath}` } as const;
  }
  
  const have = new Set<string>((Array.isArray(acc.scopes) ? acc.scopes : []).map((s) => String(s)));
  
  // Expand "have" scopes using hierarchy
  for (const s of Array.from(have)) {
    if (SCOPE_HIERARCHY[s]) {
      for (const sub of SCOPE_HIERARCHY[s]) have.add(sub);
    }
  }
  
  const missing = required.filter((s) => !have.has(s));
  if (missing.length > 0) {
    const connectPath = buildConnectPath(required);
    return { ok: false, error: 'missing_scopes', missing, connectPath, url: `${PUBLIC_BASE}${connectPath}` } as const;
  }
  return { ok: true, userId, acc } as const;
}

async function googleAuthorizedFetch(url: string, init?: RequestInit) {
  const userId = await requireUserId();
  let acc = await getGoogleAccountOrThrow(userId);
  let accessToken = await refreshGoogleTokenIfNeeded(userId, acc);

  async function doFetch(token: string) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers as any),
    };
    const fullUrl = url.startsWith('http') ? url : `${GOOGLE_API}${url}`;
    const res = await fetch(fullUrl, { ...init, headers });
    let body: any = null;
    try { body = await res.json(); } catch {}
    return { res, body } as const;
  }

  let { res, body } = await doFetch(accessToken);
  if (res.status === 401 && acc?.refresh_token && GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
    try {
      const params = new URLSearchParams();
      params.set('client_id', GOOGLE_CLIENT_ID);
      params.set('client_secret', GOOGLE_CLIENT_SECRET);
      params.set('grant_type', 'refresh_token');
      params.set('refresh_token', String(acc.refresh_token));
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      const tBody: any = await (async () => { try { return await tokenRes.json(); } catch { return null; } })();
      if (tokenRes.ok && tBody?.access_token) {
        const newAccess = String(tBody.access_token);
        const expiresIn = Number(tBody.expires_in || 3600);
        const expires_at = new Date(Date.now() + expiresIn * 1000).toISOString();
        const refresh_token = String(tBody.refresh_token || acc.refresh_token || '');
        try {
          await upsertExternalAccount({
            userId,
            provider: 'google',
            access_token: newAccess,
            scopes: Array.isArray(acc.scopes) ? acc.scopes : [],
            refresh_token: refresh_token || null,
            expires_at,
            meta: { token_type: tBody.token_type || (acc.meta?.token_type || 'Bearer') },
          });
        } catch {}
        acc = { ...acc, access_token: newAccess, expires_at, refresh_token };
        accessToken = newAccess;
        ({ res, body } = await doFetch(accessToken));
      }
    } catch {}
  }

  if (!res.ok) {
    const msg = (body && (body.error_description || body.error?.message || body.error || body.message)) || `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  return body;
}

export const google_get_userinfo = createTool({
  id: 'google_get_userinfo',
  description: 'Get Google account profile via oauth2 v3 userinfo.',
  inputSchema: z.object({}),
  execute: async () => {
    const me = await googleAuthorizedFetch('https://www.googleapis.com/oauth2/v3/userinfo');
    return { me };
  },
});

export const gmail_send_message = createTool({
  id: 'gmail_send_message',
  description: 'Send an email via Gmail. Requires gmail.send. Minimal RFC 2822 message is constructed.',
  inputSchema: z.object({
    to: z.array(z.string().email()).min(1),
    subject: z.string().min(1),
    body: z.string().min(1),
    contentType: z.enum(['text/plain', 'text/html']).default('text/plain'),
  }),
  execute: async ({ context }) => {
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/gmail.send']);
    if ((gate as any).ok !== true) return gate;
    const { to, subject, body, contentType } = context as any;
    const toLine = `To: ${to.join(', ')}`;
    const subjectLine = `Subject: ${subject}`;
    const mime = contentType || 'text/plain';
    const contentTypeLine = `Content-Type: ${mime}; charset=UTF-8`;
    const raw = Buffer.from(`${toLine}\n${subjectLine}\n${contentTypeLine}\n\n${body}`, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    const data = await googleAuthorizedFetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      body: JSON.stringify({ raw }),
    } as any);
    return { message: data };
  },
});

export const gmail_list_messages = createTool({
  id: 'gmail_list_messages',
  description: 'List Gmail messages. Requires gmail.readonly. Use optional query and labelIds.',
  inputSchema: z.object({
    q: z.string().optional(),
    labelIds: z.array(z.string()).optional(),
    maxResults: z.number().int().min(1).max(100).default(10),
    includeSpamTrash: z.boolean().optional(),
  }),
  execute: async ({ context }) => {
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/gmail.readonly']);
    if ((gate as any).ok !== true) return gate;
    const { q, labelIds, maxResults, includeSpamTrash } = context as any;
    const params = new URLSearchParams();
    if (typeof q === 'string' && q) params.set('q', q);
    if (Array.isArray(labelIds) && labelIds.length) for (const l of labelIds) params.append('labelIds', l);
    params.set('maxResults', String(maxResults || 10));
    if (typeof includeSpamTrash === 'boolean') params.set('includeSpamTrash', includeSpamTrash ? 'true' : 'false');
    const data = await googleAuthorizedFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params.toString()}`);
    const items = Array.isArray((data as any)?.messages) ? (data as any).messages : [];
    return { items, count: items.length, nextPageToken: (data as any)?.nextPageToken };
  },
});

export const calendar_list_events = createTool({
  id: 'calendar_list_events',
  description: 'List events from a Google Calendar. Requires calendar.events or calendar.readonly.',
  inputSchema: z.object({
    calendarId: z.string().default('primary'),
    timeMin: z.string().optional(),
    timeMax: z.string().optional(),
    maxResults: z.number().int().min(1).max(2500).default(10),
    singleEvents: z.boolean().default(true),
    orderBy: z.enum(['startTime', 'updated']).default('startTime'),
  }),
  execute: async ({ context }) => {
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/calendar.events']);
    if ((gate as any).ok !== true) return gate;
    const { calendarId, timeMin, timeMax, maxResults, singleEvents, orderBy } = context as any;
    const params = new URLSearchParams();
    if (timeMin) params.set('timeMin', timeMin);
    if (timeMax) params.set('timeMax', timeMax);
    params.set('maxResults', String(maxResults || 10));
    params.set('singleEvents', (typeof singleEvents === 'boolean' ? singleEvents : true) ? 'true' : 'false');
    params.set('orderBy', orderBy || 'startTime');
    const data = await googleAuthorizedFetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId || 'primary')}/events?${params.toString()}`);
    const items = Array.isArray((data as any)?.items) ? (data as any).items : [];
    return { items, count: items.length, nextPageToken: (data as any)?.nextPageToken };
  },
});

export const calendar_create_event = createTool({
  id: 'calendar_create_event',
  description: 'Create a Google Calendar event. Requires calendar.events. Supports date-time and all-day events.',
  inputSchema: z.object({
    calendarId: z.string().default('primary'),
    summary: z.string(),
    description: z.string().optional(),
    location: z.string().optional(),
    start: z.string().describe('ISO 8601 date/time or date (YYYY-MM-DD) for all-day'),
    end: z.string().describe('ISO 8601 date/time or date (YYYY-MM-DD) for all-day'),
    timeZone: z.string().optional(),
    attendees: z
      .array(
        z.object({
          email: z.string().email(),
          optional: z.boolean().optional(),
          displayName: z.string().optional(),
        }),
      )
      .optional(),
    reminders: z
      .object({
        useDefault: z.boolean().optional(),
        overrides: z
          .array(
            z.object({
              method: z.enum(['email', 'popup']),
              minutes: z.number().int().min(0),
            }),
          )
          .optional(),
      })
      .optional(),
  }),
  execute: async ({ context }) => {
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/calendar.events']);
    if ((gate as any).ok !== true) return gate;
    const { calendarId, summary, description, location, start, end, timeZone, attendees, reminders } = context as any;
    const isDateOnly = (s: string) => {
      try {
        const str = String(s || '');
        return /^\d{4}-\d{2}-\d{2}$/.test(str) && !/[Tt]/.test(str);
      } catch { return false; }
    };
    let adjEnd = end;
    if (isDateOnly(start) && isDateOnly(end) && String(start) === String(end)) {
      try {
        const d = new Date(String(start) + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + 1);
        const yyyy = d.getUTCFullYear();
        const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(d.getUTCDate()).padStart(2, '0');
        adjEnd = `${yyyy}-${mm}-${dd}`;
      } catch {}
    }
    const startField = isDateOnly(start)
      ? { date: start, ...(timeZone ? { timeZone } : {}) }
      : { dateTime: start, ...(timeZone ? { timeZone } : {}) };
    const endField = isDateOnly(adjEnd)
      ? { date: adjEnd, ...(timeZone ? { timeZone } : {}) }
      : { dateTime: adjEnd, ...(timeZone ? { timeZone } : {}) };
    const body: any = {
      summary,
      description,
      location,
      start: startField,
      end: endField,
    };
    if (Array.isArray(attendees) && attendees.length > 0) {
      body.attendees = attendees.map((a: any) => ({
        email: String(a.email),
        optional: typeof a.optional === 'boolean' ? a.optional : undefined,
        displayName: a.displayName ? String(a.displayName) : undefined,
      }));
    }
    if (reminders && typeof reminders === 'object') body.reminders = reminders;
    const data = await googleAuthorizedFetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId || 'primary')}/events`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      } as any,
    );
    return { event: data };
  },
});

export const tasks_list = createTool({
  id: 'tasks_list',
  description: 'List tasks from Google Tasks. If tasklist is not provided, uses the first list.',
  inputSchema: z.object({
    tasklist: z.string().optional(),
    showCompleted: z.boolean().optional(),
    maxResults: z.number().int().min(1).max(100).default(10),
  }),
  execute: async ({ context }) => {
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/tasks']);
    if ((gate as any).ok !== true) return gate;
    let { tasklist, showCompleted, maxResults } = context as any;
    if (!tasklist) {
      const lists = await googleAuthorizedFetch('https://tasks.googleapis.com/tasks/v1/users/@me/lists');
      const first = Array.isArray((lists as any)?.items) ? (lists as any).items[0] : undefined;
      tasklist = first?.id || 'default';
    }
    const params = new URLSearchParams();
    params.set('maxResults', String(maxResults || 10));
    if (typeof showCompleted === 'boolean') params.set('showCompleted', showCompleted ? 'true' : 'false');
    const data = await googleAuthorizedFetch(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(tasklist)}/tasks?${params.toString()}`);
    const items = Array.isArray((data as any)?.items) ? (data as any).items : [];
    return { items, count: items.length, nextPageToken: (data as any)?.nextPageToken };
  },
});

export const drive_list_files = createTool({
  id: 'drive_list_files',
  description: 'List Google Drive files. Requires drive.readonly.',
  inputSchema: z.object({
    query: z.string().optional().describe('Search query using Google Drive query syntax'),
    pageSize: z.number().int().min(1).max(1000).default(20),
    orderBy: z.string().optional(),
    fields: z.string().optional(),
  }),
  execute: async ({ context }) => {
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/drive.readonly']);
    if ((gate as any).ok !== true) return gate;
    const { query, pageSize, orderBy, fields } = context as any;
    const params = new URLSearchParams();
    params.set('pageSize', String(pageSize || 20));
    if (query) params.set('q', query);
    if (orderBy) params.set('orderBy', orderBy);
    if (fields) params.set('fields', fields);
    const data = await googleAuthorizedFetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`);
    const files = Array.isArray((data as any)?.files) ? (data as any).files : [];
    return { files, count: files.length, nextPageToken: (data as any)?.nextPageToken };
  },
});

export const sheets_read_range = createTool({
  id: 'sheets_read_range',
  description: 'Read a range from Google Sheets. Requires spreadsheets.readonly.',
  inputSchema: z.object({
    spreadsheetId: z.string(),
    range: z.string(),
    majorDimension: z.enum(['ROWS', 'COLUMNS']).optional(),
  }),
  execute: async ({ context }) => {
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/spreadsheets.readonly']);
    if ((gate as any).ok !== true) return gate;
    const { spreadsheetId, range, majorDimension } = context as any;
    const params = new URLSearchParams();
    if (majorDimension) params.set('majorDimension', majorDimension);
    const data = await googleAuthorizedFetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?${params.toString()}`);
    return { values: (data as any)?.values || [], range: (data as any)?.range, majorDimension: (data as any)?.majorDimension };
  },
});

export const docs_get_document = createTool({
  id: 'docs_get_document',
  description: 'Get a Google Docs document metadata and content. Requires documents.readonly.',
  inputSchema: z.object({
    documentId: z.string(),
  }),
  execute: async ({ context }) => {
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/documents.readonly']);
    if ((gate as any).ok !== true) return gate;
    const { documentId } = context as any;
    const data = await googleAuthorizedFetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}`);
    return { document: data };
  },
});

function getHeader(headers: Array<{ name?: string; value?: string }> | undefined, key: string): string {
  try {
    const h = (headers || []).find((x: any) => String(x?.name || '').toLowerCase() === key.toLowerCase());
    return h && typeof h.value === 'string' ? h.value : '';
  } catch {
    return '';
  }
}

function decodeBase64Url(data?: string): string {
  try {
    if (!data) return '';
    const norm = data.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(norm, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function extractBody(payload: any): { html?: string; text?: string } {
  const out: { html?: string; text?: string } = {};
  try {
    const pushPart = (p: any) => {
      const mt = String(p?.mimeType || '');
      const data = decodeBase64Url(p?.body?.data || '');
      if (!data) return;
      if (/text\/html/i.test(mt)) {
        if (!out.html || data.length > (out.html?.length || 0)) out.html = data;
      } else if (/text\/plain/i.test(mt)) {
        if (!out.text || data.length > (out.text?.length || 0)) out.text = data;
      }
    };

    const walk = (node: any) => {
      if (!node) return;
      if (node.body?.data && /text\//i.test(String(node.mimeType || ''))) pushPart(node);
      const parts = Array.isArray(node.parts) ? node.parts : [];
      for (const part of parts) {
        if (part.body?.data && /text\//i.test(String(part.mimeType || ''))) pushPart(part);
        if (Array.isArray(part.parts) && part.parts.length) walk(part);
      }
    };

    walk(payload);
  } catch {}
  return out;
}

export const gmail_get_message_brief = createTool({
  id: 'gmail_get_message_brief',
  description: 'Get a Gmail message brief (from, subject, date, snippet) by ID. Requires gmail.readonly.',
  inputSchema: z.object({ id: z.string() }),
  execute: async ({ context }) => {
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/gmail.readonly']);
    if ((gate as any).ok !== true) return gate;
    const { id } = context as any;
    const data = await googleAuthorizedFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
    const headers = (data?.payload?.headers || []) as Array<{ name?: string; value?: string }>;
    const brief = {
      id: String(data?.id || id),
      threadId: String(data?.threadId || ''),
      from: getHeader(headers, 'From'),
      subject: getHeader(headers, 'Subject'),
      date: getHeader(headers, 'Date'),
      snippet: String(data?.snippet || ''),
      labelIds: Array.isArray(data?.labelIds) ? data.labelIds : [],
    };
    return { message: brief };
  },
});

export const gmail_get_message_full = createTool({
  id: 'gmail_get_message_full',
  description: 'Get a Gmail message with full content (headers, snippet, decoded text/html body) by ID. Requires gmail.readonly.',
  inputSchema: z.object({ id: z.string() }),
  execute: async ({ context }) => {
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/gmail.readonly']);
    if ((gate as any).ok !== true) return gate;
    const { id } = context as any;
    const data = await googleAuthorizedFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`);
    const headers = (data?.payload?.headers || []) as Array<{ name?: string; value?: string }>;
    const body = extractBody(data?.payload);
    const full = {
      id: String(data?.id || id),
      threadId: String(data?.threadId || ''),
      from: getHeader(headers, 'From'),
      subject: getHeader(headers, 'Subject'),
      date: getHeader(headers, 'Date'),
      snippet: String(data?.snippet || ''),
      labelIds: Array.isArray(data?.labelIds) ? data.labelIds : [],
      sizeEstimate: typeof data?.sizeEstimate === 'number' ? data.sizeEstimate : undefined,
      body,
    };
    return { message: full };
  },
});

export const gmail_get_messages_brief = createTool({
  id: 'gmail_get_messages_brief',
  description: 'Get brief info (from, subject, date, snippet) for multiple Gmail message IDs. Requires gmail.readonly.',
  inputSchema: z.object({ ids: z.array(z.string()).min(1).max(50) }),
  execute: async ({ context }) => {
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/gmail.readonly']);
    if ((gate as any).ok !== true) return gate;
    const { ids } = context as any;
    const results: any[] = [];
    for (const id of ids) {
      try {
        const d = await googleAuthorizedFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
        const headers = (d?.payload?.headers || []) as Array<{ name?: string; value?: string }>;
        results.push({
          id: String(d?.id || id),
          threadId: String(d?.threadId || ''),
          from: getHeader(headers, 'From'),
          subject: getHeader(headers, 'Subject'),
          date: getHeader(headers, 'Date'),
          snippet: String(d?.snippet || ''),
          labelIds: Array.isArray(d?.labelIds) ? d.labelIds : [],
        });
      } catch {}
    }
    return { items: results, count: results.length };
  },
});

export const gmail_list_recent_brief = createTool({
  id: 'gmail_list_recent_brief',
  description: 'List the most recent Gmail messages with brief info (from, subject, date, snippet). Requires gmail.readonly.',
  inputSchema: z.object({ maxResults: z.number().int().min(1).max(25).default(5) }),
  execute: async ({ context }) => {
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/gmail.readonly']);
    if ((gate as any).ok !== true) return gate;
    const { maxResults } = context as any;
    const list = await googleAuthorizedFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${encodeURIComponent(String(maxResults || 5))}`);
    const ids = Array.isArray((list as any)?.messages) ? (list as any).messages.map((m: any) => String(m.id)) : [];
    const results: any[] = [];
    for (const id of ids) {
      try {
        const d = await googleAuthorizedFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
        const headers = (d?.payload?.headers || []) as Array<{ name?: string; value?: string }>;
        results.push({
          id: String(d?.id || id),
          threadId: String(d?.threadId || ''),
          from: getHeader(headers, 'From'),
          subject: getHeader(headers, 'Subject'),
          date: getHeader(headers, 'Date'),
          snippet: String(d?.snippet || ''),
          labelIds: Array.isArray(d?.labelIds) ? d.labelIds : [],
        });
      } catch {}
    }
    return { items: results, count: results.length };
  },
});

export const gmail_get_most_recent_full = createTool({
  id: 'gmail_get_most_recent_full',
  description: 'Get the most recent Gmail message with full content (decoded text/html). Requires gmail.readonly.',
  inputSchema: z.object({ labelIds: z.array(z.string()).optional() }),
  execute: async ({ context }) => {
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/gmail.readonly']);
    if ((gate as any).ok !== true) return gate;
    const { labelIds } = context as any;
    const params = new URLSearchParams();
    params.set('maxResults', '1');
    const labels = Array.isArray(labelIds) && labelIds.length ? labelIds : ['INBOX'];
    for (const l of labels) params.append('labelIds', String(l));
    const list = await googleAuthorizedFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params.toString()}`);
    const firstId = Array.isArray((list as any)?.messages) && (list as any).messages.length > 0 ? String((list as any).messages[0].id) : '';
    if (!firstId) return { ok: true, message: null };
    const data = await googleAuthorizedFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(firstId)}?format=full`);
    const headers = (data?.payload?.headers || []) as Array<{ name?: string; value?: string }>;
    const body = extractBody(data?.payload);
    const full = {
      id: String(data?.id || firstId),
      threadId: String(data?.threadId || ''),
      from: getHeader(headers, 'From'),
      subject: getHeader(headers, 'Subject'),
      date: getHeader(headers, 'Date'),
      snippet: String(data?.snippet || ''),
      labelIds: Array.isArray(data?.labelIds) ? data.labelIds : [],
      sizeEstimate: typeof data?.sizeEstimate === 'number' ? data.sizeEstimate : undefined,
      body,
    };
    return { message: full };
  },
});

export const docs_create_document = createTool({
  id: 'docs_create_document',
  description: 'Create a new Google Doc. Requires documents scope.',
  inputSchema: z.object({
    title: z.string().min(1),
  }),
  execute: async ({ context }) => {
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/documents']);
    if ((gate as any).ok !== true) return gate;
    const { title } = context as any;
    const data = await googleAuthorizedFetch('https://docs.googleapis.com/v1/documents', {
      method: 'POST',
      body: JSON.stringify({ title }),
    });
    return { document: data };
  },
});

export const gmail_modify_message = createTool({
  id: 'gmail_modify_message',
  description: 'Modify Gmail message labels (mark as read/unread, archive, etc.). Requires gmail.modify.',
  inputSchema: z.object({
    id: z.string(),
    addLabelIds: z.array(z.string()).optional(),
    removeLabelIds: z.array(z.string()).optional(),
  }),
  execute: async ({ context }) => {
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/gmail.modify']);
    if ((gate as any).ok !== true) return gate;
    const { id, addLabelIds, removeLabelIds } = context as any;
    const body: any = {};
    if (Array.isArray(addLabelIds) && addLabelIds.length > 0) body.addLabelIds = addLabelIds;
    if (Array.isArray(removeLabelIds) && removeLabelIds.length > 0) body.removeLabelIds = removeLabelIds;
    const data = await googleAuthorizedFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}/modify`, {
      method: 'POST',
      body: JSON.stringify(body),
    } as any);
    return { message: data };
  },
});

export const gmail_delete_message = createTool({
  id: 'gmail_delete_message',
  description: 'Delete a Gmail message permanently. Requires gmail.modify.',
  inputSchema: z.object({ id: z.string() }),
  execute: async ({ context }) => {
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/gmail.modify']);
    if ((gate as any).ok !== true) return gate;
    const { id } = context as any;
    const data = await googleAuthorizedFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    } as any);
    return { ok: true };
  },
});

export const gmail_archive_message = createTool({
  id: 'gmail_archive_message',
  description: 'Archive a Gmail message (remove from inbox). Requires gmail.modify.',
  inputSchema: z.object({ id: z.string() }),
  execute: async ({ context }) => {
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/gmail.modify']);
    if ((gate as any).ok !== true) return gate;
    const { id } = context as any;
    const body = { removeLabelIds: ['INBOX'] };
    const data = await googleAuthorizedFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}/modify`, {
      method: 'POST',
      body: JSON.stringify(body),
    } as any);
    return { message: data };
  },
});

export const gmail_mark_as_read = createTool({
  id: 'gmail_mark_as_read',
  description: 'Mark a Gmail message as read (remove UNREAD label). Requires gmail.modify.',
  inputSchema: z.object({ id: z.string() }),
  execute: async ({ context }) => {
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/gmail.modify']);
    if ((gate as any).ok !== true) return gate;
    const { id } = context as any;
    const body = { removeLabelIds: ['UNREAD'] };
    const data = await googleAuthorizedFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}/modify`, {
      method: 'POST',
      body: JSON.stringify(body),
    } as any);
    return { message: data };
  },
});

export const gmail_mark_as_unread = createTool({
  id: 'gmail_mark_as_unread',
  description: 'Mark a Gmail message as unread (add UNREAD label). Requires gmail.modify.',
  inputSchema: z.object({ id: z.string() }),
  execute: async ({ context }) => {
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/gmail.modify']);
    if ((gate as any).ok !== true) return gate;
    const { id } = context as any;
    const body = { addLabelIds: ['UNREAD'] };
    const data = await googleAuthorizedFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}/modify`, {
      method: 'POST',
      body: JSON.stringify(body),
    } as any);
    return { message: data };
  },
});

export const docs_write_text = createTool({
  id: 'docs_write_text',
  description: 'Write text to a Google Doc. Requires documents scope. Appends by default, or specify index.',
  inputSchema: z.object({
    documentId: z.string(),
    text: z.string().min(1),
    index: z.number().int().min(1).optional(),
  }),
  execute: async ({ context }) => {
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/documents']);
    if ((gate as any).ok !== true) return gate;
    const { documentId, text, index } = context as any;
    
    const location = typeof index === 'number' 
      ? { index } 
      : undefined;
    
    const endOfSegmentLocation = typeof index !== 'number'
      ? { segmentId: '' }
      : undefined;

    const requests = [
      {
        insertText: {
          text,
          ...(location ? { location } : {}),
          ...(endOfSegmentLocation ? { endOfSegmentLocation } : {}),
        },
      },
    ];

    const data = await googleAuthorizedFetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests }),
    });
    return { result: data };
  },
});
