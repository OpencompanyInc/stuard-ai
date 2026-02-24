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

// Optional profile field shared across all Google tools.
// When omitted (default), the default profile is used.
// Users can specify an alternative like "work" or "personal".
const profileField = z.string().optional().describe(
  'OAuth profile label to use (e.g. "work", "personal"). Omit to use the default profile.'
);

async function requireUserId(): Promise<string> {
  const secrets = getBridgeSecrets();
  const userId = String((secrets as any)?.userId || '');
  if (!userId) throw new Error('missing_user_context');
  return userId;
}

/**
 * Resolve which OAuth profile to use. Priority:
 * 1. Explicit profileLabel argument (from tool input)
 * 2. Profile set in bridge secrets context (from user instruction)
 * 3. undefined → getExternalAccount will use the default
 */
function resolveProfile(explicit?: string): string | undefined {
  if (explicit) return explicit;
  try {
    const secrets = getBridgeSecrets();
    return (secrets as any)?.googleProfile || (secrets as any)?.profile || undefined;
  } catch { return undefined; }
}

async function getGoogleAccountOrThrow(userId: string, profileLabel?: string) {
  const acc = await getExternalAccount(userId, 'google', profileLabel);
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

async function ensureConnectedAndScopes(required: string[], profileLabel?: string) {
  const secrets = getBridgeSecrets();
  const userId = String((secrets as any)?.userId || '');
  if (!userId) return { ok: false, error: 'missing_user_context' } as const;
  const profile = resolveProfile(profileLabel);
  const acc = await getExternalAccount(userId, 'google', profile);
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

async function googleAuthorizedFetch(url: string, init?: RequestInit, profileLabel?: string) {
  const userId = await requireUserId();
  const profile = resolveProfile(profileLabel);
  let acc = await getGoogleAccountOrThrow(userId, profile);
  let accessToken = await refreshGoogleTokenIfNeeded(userId, acc, acc.profile_label);

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
            profileLabel: acc.profile_label || 'default',
            accountEmail: acc.account_email || null,
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
  description: 'Send an email via Gmail with optional file attachments. Requires gmail.send.',
  inputSchema: z.object({
    to: z.array(z.string().email()).min(1),
    subject: z.string().min(1),
    body: z.string().min(1),
    contentType: z.enum(['text/plain', 'text/html']).default('text/plain'),
    from: z.string().optional().describe('Sender display name (e.g., "Stuard AI"). If not set, uses email address prefix.'),
    cc: z.array(z.string().email()).optional(),
    bcc: z.array(z.string().email()).optional(),
    attachments: z.array(z.object({
      path: z.string().describe('Local file path to attach'),
      filename: z.string().optional().describe('Override filename in email'),
    })).optional().describe('Files to attach to the email'),
    profile: profileField,
  }),
  execute: async (inputData, context) => {
    const { profile } = inputData as any;
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/gmail.send'], profile);
    if ((gate as any).ok !== true) return gate;
    const { to, subject, body, contentType, from, cc, bcc, attachments  } = inputData as any;
    
    const senderEmail = (gate as any).acc?.account_email || '';
    const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const mime = contentType || 'text/plain';
    
    // Build headers
    const headers: string[] = [
      `To: ${to.join(', ')}`,
      `Subject: ${subject}`,
    ];
    if (from && typeof from === 'string' && from.trim()) {
      const displayName = from.trim();
      if (senderEmail) {
        headers.push(`From: "${displayName}" <${senderEmail}>`);
      } else {
        headers.push(`From: ${displayName}`);
      }
    }
    if (cc?.length) headers.push(`Cc: ${cc.join(', ')}`);
    if (bcc?.length) headers.push(`Bcc: ${bcc.join(', ')}`);
    
    let rawMessage: string;
    
    // Check if we have attachments
    const attachmentList = Array.isArray(attachments) ? attachments : [];
    console.log(`[gmail_send_message] Sending email with ${attachmentList.length} attachment(s)`);
    
    let attachmentsIncluded = 0;
    const attachmentErrors: string[] = [];
    
    if (attachmentList.length === 0) {
      // Simple message without attachments
      headers.push(`Content-Type: ${mime}; charset=UTF-8`);
      rawMessage = `${headers.join('\r\n')}\r\n\r\n${body}`;
    } else {
      // Multipart message with attachments
      headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
      headers.push('MIME-Version: 1.0');
      
      const parts: string[] = [];
      
      // Body part
      parts.push(`--${boundary}`);
      parts.push(`Content-Type: ${mime}; charset=UTF-8`);
      parts.push('Content-Transfer-Encoding: 7bit');
      parts.push('');
      parts.push(body);
      
      // Attachment parts - read files via bridge
      const { execLocalTool, hasClientBridge } = await import('./bridge');
      const hasBridge = hasClientBridge();
      console.log(`[gmail_send_message] Client bridge available: ${hasBridge}`);
      
      for (const att of attachmentList) {
        const filePath = String(att.path || '');
        if (!filePath) {
          console.log(`[gmail_send_message] Skipping attachment with empty path`);
          continue;
        }
        
        // Get filename
        const pathParts = filePath.replace(/\\/g, '/').split('/');
        const filename = att.filename || pathParts[pathParts.length - 1] || 'attachment';
        console.log(`[gmail_send_message] Reading attachment: ${filename} from ${filePath}`);
        
        // Read file via local bridge using execLocalTool
        let fileContent: string | null = null;
        try {
          const result = await execLocalTool('read_file_base64', { path: filePath }, undefined, 30000, { silent: true });
          console.log(`[gmail_send_message] Read result for ${filename}: ok=${result?.ok}, hasData=${!!result?.data}, dataLen=${result?.data?.length || 0}`);
          
          if (result?.ok && result?.data) {
            fileContent = result.data;
          } else {
            const errMsg = result?.error || 'no data returned';
            console.error(`[gmail_send_message] Failed to read attachment ${filePath}:`, errMsg);
            attachmentErrors.push(`${filename}: ${errMsg}`);
          }
        } catch (e: any) {
          const errMsg = e?.message || String(e);
          console.error(`[gmail_send_message] Exception reading attachment ${filePath}:`, errMsg);
          attachmentErrors.push(`${filename}: ${errMsg}`);
        }
        
        if (fileContent) {
          attachmentsIncluded++;
          console.log(`[gmail_send_message] Adding attachment: ${filename} (${fileContent.length} bytes base64)`);
          // Guess MIME type from extension
          const ext = filename.split('.').pop()?.toLowerCase() || '';
          const mimeTypes: Record<string, string> = {
            'pdf': 'application/pdf',
            'doc': 'application/msword',
            'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'xls': 'application/vnd.ms-excel',
            'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'ppt': 'application/vnd.ms-powerpoint',
            'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'png': 'image/png',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'gif': 'image/gif',
            'webp': 'image/webp',
            'svg': 'image/svg+xml',
            'mp3': 'audio/mpeg',
            'wav': 'audio/wav',
            'mp4': 'video/mp4',
            'zip': 'application/zip',
            'txt': 'text/plain',
            'csv': 'text/csv',
            'json': 'application/json',
            'xml': 'application/xml',
            'html': 'text/html',
          };
          const attachMime = mimeTypes[ext] || 'application/octet-stream';
          
          parts.push(`--${boundary}`);
          parts.push(`Content-Type: ${attachMime}; name="${filename}"`);
          parts.push('Content-Transfer-Encoding: base64');
          parts.push(`Content-Disposition: attachment; filename="${filename}"`);
          parts.push('');
          // Split base64 into 76-char lines for RFC compliance
          const b64Lines = fileContent.match(/.{1,76}/g) || [fileContent];
          parts.push(b64Lines.join('\r\n'));
        }
      }
      
      // Close boundary
      parts.push(`--${boundary}--`);
      
      rawMessage = `${headers.join('\r\n')}\r\n\r\n${parts.join('\r\n')}`;
    }
    
    const raw = Buffer.from(rawMessage, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    console.log(`[gmail_send_message] Sending email, raw message length: ${raw.length}`);
    const data = await googleAuthorizedFetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      body: JSON.stringify({ raw }),
    } as any);
    
    console.log(`[gmail_send_message] Email sent successfully. Attachments: ${attachmentsIncluded}/${attachmentList.length}`);
    const returnResult: any = { 
      ok: true,
      message: data, 
      attachmentsRequested: attachmentList.length,
      attachmentsIncluded: attachmentList.length > 0 ? attachmentsIncluded : 0,
    };
    if (attachmentErrors.length > 0) {
      returnResult.attachmentErrors = attachmentErrors;
    }
    return returnResult;
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
    profile: profileField,
  }),
  execute: async (inputData, context) => {
    const { profile } = inputData as any;
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/gmail.readonly'], profile);
    if ((gate as any).ok !== true) return gate;
    const { q, labelIds, maxResults, includeSpamTrash  } = inputData as any;
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
    profile: profileField,
  }),
  execute: async (inputData, context) => {
    const { profile } = inputData as any;
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/calendar.events'], profile);
    if ((gate as any).ok !== true) return gate;
    const { calendarId, timeMin, timeMax, maxResults, singleEvents, orderBy  } = inputData as any;
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
  execute: async (inputData, context) => {
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/calendar.events']);
    if ((gate as any).ok !== true) return gate;
    const { calendarId, summary, description, location, start, end, timeZone, attendees, reminders  } = inputData as any;
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

export const calendar_delete_event = createTool({
  id: 'calendar_delete_event',
  description: 'Delete a Google Calendar event. Requires calendar.events.',
  inputSchema: z.object({
    calendarId: z.string().default('primary'),
    eventId: z.string().min(1),
    sendUpdates: z.enum(['all', 'externalOnly', 'none']).optional(),
  }),
  execute: async (inputData, context) => {
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/calendar.events']);
    if ((gate as any).ok !== true) return gate;
    const { calendarId, eventId, sendUpdates  } = inputData as any;

    const params = new URLSearchParams();
    if (sendUpdates) params.set('sendUpdates', String(sendUpdates));
    const qs = params.toString();

    await googleAuthorizedFetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId || 'primary')}/events/${encodeURIComponent(eventId)}${qs ? `?${qs}` : ''}`,
      {
        method: 'DELETE',
      } as any,
    );

    return { ok: true, calendarId: String(calendarId || 'primary'), eventId: String(eventId) };
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
  execute: async (inputData, context) => {
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/tasks']);
    if ((gate as any).ok !== true) return gate;
    let { tasklist, showCompleted, maxResults } = inputData as any;
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
    profile: profileField,
  }),
  execute: async (inputData, context) => {
    const { profile } = inputData as any;
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/drive.readonly'], profile);
    if ((gate as any).ok !== true) return gate;
    const { query, pageSize, orderBy, fields  } = inputData as any;
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
    profile: profileField,
  }),
  execute: async (inputData, context) => {
    const { profile } = inputData as any;
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/spreadsheets.readonly'], profile);
    if ((gate as any).ok !== true) return gate;
    const { spreadsheetId, range, majorDimension  } = inputData as any;
    const params = new URLSearchParams();
    if (majorDimension) params.set('majorDimension', majorDimension);
    const data = await googleAuthorizedFetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?${params.toString()}`);
    return { values: (data as any)?.values || [], range: (data as any)?.range, majorDimension: (data as any)?.majorDimension };
  },
});

// ─── Google Sheets Write/Edit Tools ───

export const sheets_create_spreadsheet = createTool({
  id: 'sheets_create_spreadsheet',
  description: 'Create a new Google Sheets spreadsheet with optional initial sheets and data. Returns the spreadsheet ID and URL.',
  inputSchema: z.object({
    title: z.string().describe('Spreadsheet title'),
    sheets: z.array(z.object({
      title: z.string().describe('Sheet/tab name'),
      data: z.array(z.array(z.any())).optional().describe('Initial row data (array of rows, each row is array of cell values)'),
      columnWidths: z.array(z.object({
        startIndex: z.number(),
        endIndex: z.number(),
        width: z.number(),
      })).optional().describe('Custom column widths in pixels'),
      frozenRows: z.number().optional().describe('Number of rows to freeze at the top'),
      frozenColumns: z.number().optional().describe('Number of columns to freeze on the left'),
    })).optional().describe('Sheets/tabs to create. Defaults to one "Sheet1" if omitted.'),
    profile: profileField,
  }),
  execute: async (inputData, context) => {
    const { profile } = inputData as any;
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/spreadsheets'], profile);
    if ((gate as any).ok !== true) return gate;
    const { title, sheets: sheetDefs } = inputData as any;

    const sheetsPayload: any[] = (sheetDefs || [{ title: 'Sheet1' }]).map((s: any, i: number) => ({
      properties: {
        sheetId: i,
        title: s.title || `Sheet${i + 1}`,
        gridProperties: {
          ...(s.frozenRows ? { frozenRowCount: s.frozenRows } : {}),
          ...(s.frozenColumns ? { frozenColumnCount: s.frozenColumns } : {}),
        },
      },
    }));

    const body: any = {
      properties: { title },
      sheets: sheetsPayload,
    };

    const result = await googleAuthorizedFetch(
      'https://sheets.googleapis.com/v4/spreadsheets',
      { method: 'POST', body: JSON.stringify(body) },
      profile,
    );

    const spreadsheetId = (result as any)?.spreadsheetId;
    const spreadsheetUrl = (result as any)?.spreadsheetUrl;

    // Write initial data for each sheet if provided
    if (sheetDefs && spreadsheetId) {
      for (const s of sheetDefs) {
        if (s.data && Array.isArray(s.data) && s.data.length > 0) {
          await googleAuthorizedFetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(s.title || 'Sheet1')}?valueInputOption=USER_ENTERED`,
            { method: 'PUT', body: JSON.stringify({ values: s.data }) },
            profile,
          );
        }

        // Apply column widths
        if (s.columnWidths && Array.isArray(s.columnWidths) && s.columnWidths.length > 0) {
          const sheetIdx = sheetDefs.indexOf(s);
          const requests = s.columnWidths.map((cw: any) => ({
            updateDimensionProperties: {
              range: {
                sheetId: sheetIdx,
                dimension: 'COLUMNS',
                startIndex: cw.startIndex,
                endIndex: cw.endIndex,
              },
              properties: { pixelSize: cw.width },
              fields: 'pixelSize',
            },
          }));
          await googleAuthorizedFetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
            { method: 'POST', body: JSON.stringify({ requests }) },
            profile,
          );
        }
      }
    }

    return { spreadsheetId, spreadsheetUrl, title };
  },
});

export const sheets_write_range = createTool({
  id: 'sheets_write_range',
  description: 'Write values to a range in Google Sheets. Overwrites existing data in the range. Use USER_ENTERED to auto-parse numbers, dates, formulas.',
  inputSchema: z.object({
    spreadsheetId: z.string(),
    range: z.string().describe('A1 notation range, e.g. "Sheet1!A1:D10" or "Sheet1!A1"'),
    values: z.array(z.array(z.any())).describe('2D array of values (rows × columns)'),
    valueInputOption: z.enum(['RAW', 'USER_ENTERED']).default('USER_ENTERED').describe('RAW = literal values, USER_ENTERED = parse like typing in the UI (formulas, dates, numbers)'),
    profile: profileField,
  }),
  execute: async (inputData, context) => {
    const { profile } = inputData as any;
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/spreadsheets'], profile);
    if ((gate as any).ok !== true) return gate;
    const { spreadsheetId, range, values, valueInputOption } = inputData as any;
    const data = await googleAuthorizedFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=${encodeURIComponent(valueInputOption || 'USER_ENTERED')}`,
      { method: 'PUT', body: JSON.stringify({ values }) },
      profile,
    );
    return { updatedRange: (data as any)?.updatedRange, updatedRows: (data as any)?.updatedRows, updatedColumns: (data as any)?.updatedColumns, updatedCells: (data as any)?.updatedCells };
  },
});

export const sheets_append_rows = createTool({
  id: 'sheets_append_rows',
  description: 'Append rows after the last row with data in a Google Sheets range. Great for adding new records to an existing table.',
  inputSchema: z.object({
    spreadsheetId: z.string(),
    range: z.string().describe('Range to search for a table, e.g. "Sheet1!A:Z" or "Sheet1!A1"'),
    values: z.array(z.array(z.any())).describe('Rows to append (array of rows)'),
    valueInputOption: z.enum(['RAW', 'USER_ENTERED']).default('USER_ENTERED'),
    insertDataOption: z.enum(['OVERWRITE', 'INSERT_ROWS']).default('INSERT_ROWS').describe('INSERT_ROWS adds new rows, OVERWRITE writes over existing blank rows'),
    profile: profileField,
  }),
  execute: async (inputData, context) => {
    const { profile } = inputData as any;
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/spreadsheets'], profile);
    if ((gate as any).ok !== true) return gate;
    const { spreadsheetId, range, values, valueInputOption, insertDataOption } = inputData as any;
    const params = new URLSearchParams();
    params.set('valueInputOption', valueInputOption || 'USER_ENTERED');
    params.set('insertDataOption', insertDataOption || 'INSERT_ROWS');
    const data = await googleAuthorizedFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append?${params.toString()}`,
      { method: 'POST', body: JSON.stringify({ values }) },
      profile,
    );
    const updates = (data as any)?.updates;
    return { updatedRange: updates?.updatedRange, updatedRows: updates?.updatedRows, updatedCells: updates?.updatedCells };
  },
});

export const sheets_clear_range = createTool({
  id: 'sheets_clear_range',
  description: 'Clear values from a range in Google Sheets (keeps formatting, removes data).',
  inputSchema: z.object({
    spreadsheetId: z.string(),
    range: z.string().describe('A1 notation range to clear, e.g. "Sheet1!A2:Z"'),
    profile: profileField,
  }),
  execute: async (inputData, context) => {
    const { profile } = inputData as any;
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/spreadsheets'], profile);
    if ((gate as any).ok !== true) return gate;
    const { spreadsheetId, range } = inputData as any;
    const data = await googleAuthorizedFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:clear`,
      { method: 'POST', body: JSON.stringify({}) },
      profile,
    );
    return { clearedRange: (data as any)?.clearedRange };
  },
});

export const sheets_get_spreadsheet = createTool({
  id: 'sheets_get_spreadsheet',
  description: 'Get spreadsheet metadata: sheet names, grid dimensions, and properties. Useful to discover available sheets before reading or writing.',
  inputSchema: z.object({
    spreadsheetId: z.string(),
    profile: profileField,
  }),
  execute: async (inputData, context) => {
    const { profile } = inputData as any;
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/spreadsheets.readonly'], profile);
    if ((gate as any).ok !== true) return gate;
    const { spreadsheetId } = inputData as any;
    const data = await googleAuthorizedFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=properties,sheets.properties`,
      undefined,
      profile,
    );
    const sheets = ((data as any)?.sheets || []).map((s: any) => ({
      sheetId: s.properties?.sheetId,
      title: s.properties?.title,
      rowCount: s.properties?.gridProperties?.rowCount,
      columnCount: s.properties?.gridProperties?.columnCount,
      frozenRowCount: s.properties?.gridProperties?.frozenRowCount,
      frozenColumnCount: s.properties?.gridProperties?.frozenColumnCount,
    }));
    return { title: (data as any)?.properties?.title, locale: (data as any)?.properties?.locale, spreadsheetUrl: (data as any)?.spreadsheetUrl, sheets };
  },
});

export const sheets_add_sheet = createTool({
  id: 'sheets_add_sheet',
  description: 'Add a new sheet/tab to an existing spreadsheet.',
  inputSchema: z.object({
    spreadsheetId: z.string(),
    title: z.string().describe('Name for the new sheet/tab'),
    rowCount: z.number().optional().describe('Initial number of rows (default 1000)'),
    columnCount: z.number().optional().describe('Initial number of columns (default 26)'),
    frozenRows: z.number().optional(),
    frozenColumns: z.number().optional(),
    profile: profileField,
  }),
  execute: async (inputData, context) => {
    const { profile } = inputData as any;
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/spreadsheets'], profile);
    if ((gate as any).ok !== true) return gate;
    const { spreadsheetId, title, rowCount, columnCount, frozenRows, frozenColumns } = inputData as any;
    const data = await googleAuthorizedFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
      {
        method: 'POST',
        body: JSON.stringify({
          requests: [{
            addSheet: {
              properties: {
                title,
                gridProperties: {
                  ...(rowCount ? { rowCount } : {}),
                  ...(columnCount ? { columnCount } : {}),
                  ...(frozenRows ? { frozenRowCount: frozenRows } : {}),
                  ...(frozenColumns ? { frozenColumnCount: frozenColumns } : {}),
                },
              },
            },
          }],
        }),
      },
      profile,
    );
    const reply = (data as any)?.replies?.[0]?.addSheet?.properties;
    return { sheetId: reply?.sheetId, title: reply?.title };
  },
});

export const sheets_format_cells = createTool({
  id: 'sheets_format_cells',
  description: 'Format cells in Google Sheets: background color, text formatting, number format, borders, alignment, text wrap. Build appealing spreadsheets with headers, alternating row colors, and professional styling.',
  inputSchema: z.object({
    spreadsheetId: z.string(),
    sheetId: z.number().default(0).describe('Sheet ID (0 for first sheet). Use sheets_get_spreadsheet to find IDs.'),
    requests: z.array(z.object({
      type: z.enum([
        'repeatCell',
        'mergeCells',
        'autoResize',
        'updateBorders',
        'addConditionalFormatRule',
        'updateSheetProperties',
      ]).describe('Format operation type'),
      range: z.object({
        startRowIndex: z.number(),
        endRowIndex: z.number(),
        startColumnIndex: z.number(),
        endColumnIndex: z.number(),
      }).describe('Cell range (0-indexed)'),
      // repeatCell options
      backgroundColor: z.object({ red: z.number().min(0).max(1), green: z.number().min(0).max(1), blue: z.number().min(0).max(1), alpha: z.number().min(0).max(1).optional() }).optional(),
      foregroundColor: z.object({ red: z.number().min(0).max(1), green: z.number().min(0).max(1), blue: z.number().min(0).max(1), alpha: z.number().min(0).max(1).optional() }).optional(),
      bold: z.boolean().optional(),
      italic: z.boolean().optional(),
      strikethrough: z.boolean().optional(),
      fontSize: z.number().optional(),
      fontFamily: z.string().optional(),
      horizontalAlignment: z.enum(['LEFT', 'CENTER', 'RIGHT']).optional(),
      verticalAlignment: z.enum(['TOP', 'MIDDLE', 'BOTTOM']).optional(),
      wrapStrategy: z.enum(['OVERFLOW_CELL', 'CLIP', 'WRAP']).optional(),
      numberFormat: z.object({ type: z.enum(['TEXT', 'NUMBER', 'PERCENT', 'CURRENCY', 'DATE', 'TIME', 'DATE_TIME', 'SCIENTIFIC']), pattern: z.string().optional() }).optional(),
      // mergeCells
      mergeType: z.enum(['MERGE_ALL', 'MERGE_COLUMNS', 'MERGE_ROWS']).optional(),
      // borders
      borderStyle: z.enum(['DOTTED', 'DASHED', 'SOLID', 'SOLID_MEDIUM', 'SOLID_THICK', 'DOUBLE', 'NONE']).optional(),
      borderColor: z.object({ red: z.number().min(0).max(1), green: z.number().min(0).max(1), blue: z.number().min(0).max(1) }).optional(),
      borderSides: z.array(z.enum(['top', 'bottom', 'left', 'right', 'innerHorizontal', 'innerVertical'])).optional().describe('Which borders to apply'),
    })).describe('Array of formatting operations to apply'),
    profile: profileField,
  }),
  execute: async (inputData, context) => {
    const { profile } = inputData as any;
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/spreadsheets'], profile);
    if ((gate as any).ok !== true) return gate;
    const { spreadsheetId, sheetId, requests: fmtRequests } = inputData as any;

    const batchRequests: any[] = [];

    for (const req of fmtRequests) {
      const range = {
        sheetId: sheetId ?? 0,
        startRowIndex: req.range.startRowIndex,
        endRowIndex: req.range.endRowIndex,
        startColumnIndex: req.range.startColumnIndex,
        endColumnIndex: req.range.endColumnIndex,
      };

      if (req.type === 'repeatCell') {
        const cellFormat: any = {};
        const fields: string[] = [];

        if (req.backgroundColor) {
          cellFormat.backgroundColor = req.backgroundColor;
          fields.push('userEnteredFormat.backgroundColor');
        }
        if (req.foregroundColor || req.bold !== undefined || req.italic !== undefined || req.strikethrough !== undefined || req.fontSize || req.fontFamily) {
          cellFormat.textFormat = {};
          if (req.foregroundColor) { cellFormat.textFormat.foregroundColor = req.foregroundColor; fields.push('userEnteredFormat.textFormat.foregroundColor'); }
          if (req.bold !== undefined) { cellFormat.textFormat.bold = req.bold; fields.push('userEnteredFormat.textFormat.bold'); }
          if (req.italic !== undefined) { cellFormat.textFormat.italic = req.italic; fields.push('userEnteredFormat.textFormat.italic'); }
          if (req.strikethrough !== undefined) { cellFormat.textFormat.strikethrough = req.strikethrough; fields.push('userEnteredFormat.textFormat.strikethrough'); }
          if (req.fontSize) { cellFormat.textFormat.fontSize = req.fontSize; fields.push('userEnteredFormat.textFormat.fontSize'); }
          if (req.fontFamily) { cellFormat.textFormat.fontFamily = req.fontFamily; fields.push('userEnteredFormat.textFormat.fontFamily'); }
        }
        if (req.horizontalAlignment) { cellFormat.horizontalAlignment = req.horizontalAlignment; fields.push('userEnteredFormat.horizontalAlignment'); }
        if (req.verticalAlignment) { cellFormat.verticalAlignment = req.verticalAlignment; fields.push('userEnteredFormat.verticalAlignment'); }
        if (req.wrapStrategy) { cellFormat.wrapStrategy = req.wrapStrategy; fields.push('userEnteredFormat.wrapStrategy'); }
        if (req.numberFormat) { cellFormat.numberFormat = req.numberFormat; fields.push('userEnteredFormat.numberFormat'); }

        if (fields.length > 0) {
          batchRequests.push({
            repeatCell: {
              range,
              cell: { userEnteredFormat: cellFormat },
              fields: fields.join(','),
            },
          });
        }
      } else if (req.type === 'mergeCells') {
        batchRequests.push({
          mergeCells: {
            range,
            mergeType: req.mergeType || 'MERGE_ALL',
          },
        });
      } else if (req.type === 'autoResize') {
        batchRequests.push({
          autoResizeDimensions: {
            dimensions: {
              sheetId: sheetId ?? 0,
              dimension: 'COLUMNS',
              startIndex: req.range.startColumnIndex,
              endIndex: req.range.endColumnIndex,
            },
          },
        });
      } else if (req.type === 'updateBorders') {
        const borderSpec = {
          style: req.borderStyle || 'SOLID',
          color: req.borderColor || { red: 0, green: 0, blue: 0 },
        };
        const sides = req.borderSides || ['top', 'bottom', 'left', 'right'];
        const borders: any = {};
        for (const side of sides) borders[side] = borderSpec;
        batchRequests.push({
          updateBorders: { range, ...borders },
        });
      } else if (req.type === 'updateSheetProperties') {
        // Can freeze rows/columns
        const props: any = {};
        const gridFields: string[] = [];
        if (req.range.startRowIndex !== undefined) {
          props.gridProperties = { ...props.gridProperties, frozenRowCount: req.range.startRowIndex };
          gridFields.push('gridProperties.frozenRowCount');
        }
        batchRequests.push({
          updateSheetProperties: {
            properties: { sheetId: sheetId ?? 0, ...props },
            fields: gridFields.join(','),
          },
        });
      }
    }

    if (batchRequests.length === 0) return { ok: true, message: 'No formatting operations to apply' };

    const data = await googleAuthorizedFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
      { method: 'POST', body: JSON.stringify({ requests: batchRequests }) },
      profile,
    );
    return { ok: true, repliesCount: ((data as any)?.replies || []).length };
  },
});

export const sheets_batch_update_values = createTool({
  id: 'sheets_batch_update_values',
  description: 'Write values to multiple ranges in a single request. Efficient for updating several areas of a spreadsheet at once.',
  inputSchema: z.object({
    spreadsheetId: z.string(),
    data: z.array(z.object({
      range: z.string().describe('A1 notation range'),
      values: z.array(z.array(z.any())),
    })).describe('Array of range-values pairs to write'),
    valueInputOption: z.enum(['RAW', 'USER_ENTERED']).default('USER_ENTERED'),
    profile: profileField,
  }),
  execute: async (inputData, context) => {
    const { profile } = inputData as any;
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/spreadsheets'], profile);
    if ((gate as any).ok !== true) return gate;
    const { spreadsheetId, data: rangeData, valueInputOption } = inputData as any;
    const result = await googleAuthorizedFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`,
      {
        method: 'POST',
        body: JSON.stringify({
          valueInputOption: valueInputOption || 'USER_ENTERED',
          data: rangeData,
        }),
      },
      profile,
    );
    return {
      totalUpdatedRows: (result as any)?.totalUpdatedRows,
      totalUpdatedColumns: (result as any)?.totalUpdatedColumns,
      totalUpdatedCells: (result as any)?.totalUpdatedCells,
      totalUpdatedSheets: (result as any)?.totalUpdatedSheets,
    };
  },
});

export const sheets_delete_rows_columns = createTool({
  id: 'sheets_delete_rows_columns',
  description: 'Delete rows or columns from a Google Sheet.',
  inputSchema: z.object({
    spreadsheetId: z.string(),
    sheetId: z.number().default(0).describe('Sheet ID (0 for first sheet)'),
    dimension: z.enum(['ROWS', 'COLUMNS']).describe('Whether to delete rows or columns'),
    startIndex: z.number().describe('0-based start index (inclusive)'),
    endIndex: z.number().describe('0-based end index (exclusive)'),
    profile: profileField,
  }),
  execute: async (inputData, context) => {
    const { profile } = inputData as any;
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/spreadsheets'], profile);
    if ((gate as any).ok !== true) return gate;
    const { spreadsheetId, sheetId, dimension, startIndex, endIndex } = inputData as any;
    const data = await googleAuthorizedFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
      {
        method: 'POST',
        body: JSON.stringify({
          requests: [{
            deleteDimension: {
              range: {
                sheetId: sheetId ?? 0,
                dimension,
                startIndex,
                endIndex,
              },
            },
          }],
        }),
      },
      profile,
    );
    return { ok: true, deleted: `${dimension} ${startIndex}-${endIndex}` };
  },
});

export const sheets_sort_range = createTool({
  id: 'sheets_sort_range',
  description: 'Sort a range of data in Google Sheets by one or more columns.',
  inputSchema: z.object({
    spreadsheetId: z.string(),
    sheetId: z.number().default(0),
    range: z.object({
      startRowIndex: z.number(),
      endRowIndex: z.number(),
      startColumnIndex: z.number(),
      endColumnIndex: z.number(),
    }).describe('0-indexed range to sort'),
    sortSpecs: z.array(z.object({
      dimensionIndex: z.number().describe('0-indexed column to sort by'),
      sortOrder: z.enum(['ASCENDING', 'DESCENDING']).default('ASCENDING'),
    })).describe('Columns to sort by, in priority order'),
    profile: profileField,
  }),
  execute: async (inputData, context) => {
    const { profile } = inputData as any;
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/spreadsheets'], profile);
    if ((gate as any).ok !== true) return gate;
    const { spreadsheetId, sheetId, range, sortSpecs } = inputData as any;
    const data = await googleAuthorizedFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
      {
        method: 'POST',
        body: JSON.stringify({
          requests: [{
            sortRange: {
              range: { sheetId: sheetId ?? 0, ...range },
              sortSpecs,
            },
          }],
        }),
      },
      profile,
    );
    return { ok: true };
  },
});

export const sheets_auto_resize = createTool({
  id: 'sheets_auto_resize',
  description: 'Auto-resize columns or rows to fit their content in Google Sheets.',
  inputSchema: z.object({
    spreadsheetId: z.string(),
    sheetId: z.number().default(0),
    dimension: z.enum(['ROWS', 'COLUMNS']).default('COLUMNS'),
    startIndex: z.number().default(0).describe('0-based start index'),
    endIndex: z.number().describe('0-based end index (exclusive)'),
    profile: profileField,
  }),
  execute: async (inputData, context) => {
    const { profile } = inputData as any;
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/spreadsheets'], profile);
    if ((gate as any).ok !== true) return gate;
    const { spreadsheetId, sheetId, dimension, startIndex, endIndex } = inputData as any;
    const data = await googleAuthorizedFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
      {
        method: 'POST',
        body: JSON.stringify({
          requests: [{
            autoResizeDimensions: {
              dimensions: {
                sheetId: sheetId ?? 0,
                dimension: dimension || 'COLUMNS',
                startIndex: startIndex ?? 0,
                endIndex,
              },
            },
          }],
        }),
      },
      profile,
    );
    return { ok: true };
  },
});

export const docs_get_document = createTool({
  id: 'docs_get_document',
  description: 'Get a Google Docs document metadata and content. Requires documents.readonly.',
  inputSchema: z.object({
    documentId: z.string(),
  }),
  execute: async (inputData, context) => {
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/documents.readonly']);
    if ((gate as any).ok !== true) return gate;
    const { documentId  } = inputData as any;
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

function extractAttachments(payload: any): Array<{ filename: string; mimeType: string; size: number; attachmentId: string }> {
  const out: Array<{ filename: string; mimeType: string; size: number; attachmentId: string }> = [];
  try {
    const walk = (node: any) => {
      if (!node) return;
      if (node.filename && node.body?.attachmentId) {
        out.push({
          filename: node.filename,
          mimeType: node.mimeType || 'application/octet-stream',
          size: Number(node.body.size || 0),
          attachmentId: node.body.attachmentId,
        });
      }
      const parts = Array.isArray(node.parts) ? node.parts : [];
      for (const part of parts) walk(part);
    };
    walk(payload);
  } catch {}
  return out;
}

export const gmail_get_message_brief = createTool({
  id: 'gmail_get_message_brief',
  description: 'Get a Gmail message brief (from, subject, date, snippet) by ID. Requires gmail.readonly.',
  inputSchema: z.object({ id: z.string() }),
  execute: async (inputData, context) => {
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/gmail.readonly']);
    if ((gate as any).ok !== true) return gate;
    const { id  } = inputData as any;
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
  description: 'Get a Gmail message with full content (headers, snippet, decoded text/html body, attachments) by ID. Requires gmail.readonly.',
  inputSchema: z.object({ id: z.string() }),
  execute: async (inputData, context) => {
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/gmail.readonly']);
    if ((gate as any).ok !== true) return gate;
    const { id  } = inputData as any;
    const data = await googleAuthorizedFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`);
    const headers = (data?.payload?.headers || []) as Array<{ name?: string; value?: string }>;
    const body = extractBody(data?.payload);
    const attachments = extractAttachments(data?.payload);
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
      attachments,
    };
    return { message: full };
  },
});

export const gmail_download_attachment = createTool({
  id: 'gmail_download_attachment',
  description: 'Download a Gmail attachment to a local file. Requires gmail.readonly.',
  inputSchema: z.object({
    messageId: z.string(),
    attachmentId: z.string(),
    path: z.string().describe('Local path to save the file to'),
  }),
  execute: async (inputData, context) => {
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/gmail.readonly']);
    if ((gate as any).ok !== true) return gate;
    const { messageId, attachmentId, path } = inputData as any;

    const data = await googleAuthorizedFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`);
    
    // data.data is base64url encoded
    let b64 = String((data as any)?.data || '');
    b64 = b64.replace(/-/g, '+').replace(/_/g, '/');

    const { execLocalTool, hasClientBridge } = await import('./bridge');
    if (!hasClientBridge()) {
        return { ok: false, error: 'No client bridge available to save file locally' };
    }

    const res = await execLocalTool('write_file_base64', { path, content: b64 });
    if (!res.ok) {
        return { ok: false, error: res.error || 'Failed to write file' };
    }

    return { ok: true, path, size: (data as any)?.size };
  },
});

export const gmail_get_messages_brief = createTool({
  id: 'gmail_get_messages_brief',
  description: 'Get brief info (from, subject, date, snippet) for multiple Gmail message IDs. Requires gmail.readonly.',
  inputSchema: z.object({ ids: z.array(z.string()).min(1).max(50) }),
  execute: async (inputData, context) => {
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/gmail.readonly']);
    if ((gate as any).ok !== true) return gate;
    const { ids  } = inputData as any;
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
  execute: async (inputData, context) => {
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/gmail.readonly']);
    if ((gate as any).ok !== true) return gate;
    const { maxResults  } = inputData as any;
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
  execute: async (inputData, context) => {
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/gmail.readonly']);
    if ((gate as any).ok !== true) return gate;
    const { labelIds  } = inputData as any;
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
  execute: async (inputData, context) => {
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/documents']);
    if ((gate as any).ok !== true) return gate;
    const { title  } = inputData as any;
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
  execute: async (inputData, context) => {
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/gmail.modify']);
    if ((gate as any).ok !== true) return gate;
    const { id, addLabelIds, removeLabelIds  } = inputData as any;
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
  execute: async (inputData, context) => {
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/gmail.modify']);
    if ((gate as any).ok !== true) return gate;
    const { id  } = inputData as any;
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
  execute: async (inputData, context) => {
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/gmail.modify']);
    if ((gate as any).ok !== true) return gate;
    const { id  } = inputData as any;
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
  execute: async (inputData, context) => {
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/gmail.modify']);
    if ((gate as any).ok !== true) return gate;
    const { id  } = inputData as any;
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
  execute: async (inputData, context) => {
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/gmail.modify']);
    if ((gate as any).ok !== true) return gate;
    const { id  } = inputData as any;
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
  execute: async (inputData, context) => {
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/documents']);
    if ((gate as any).ok !== true) return gate;
    const { documentId, text, index  } = inputData as any;
    
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

export const gmail_retrieve_messages_with_attachments = createTool({
  id: 'gmail_retrieve_messages_with_attachments',
  description: 'Retrieve Gmail messages with optional attachment download. Supports query filters and automatically downloads attachments to a specified folder.',
  inputSchema: z.object({
    q: z.string().optional().describe('Gmail search query (e.g., "has:attachment", "from:someone@example.com")'),
    labelIds: z.array(z.string()).optional().describe('Filter by label IDs like INBOX, SENT, etc.'),
    maxResults: z.number().int().min(1).max(50).default(10).describe('Maximum number of messages to retrieve'),
    includeSpamTrash: z.boolean().optional().describe('Include messages from spam/trash'),
    downloadAttachments: z.boolean().default(false).describe('Whether to download attachments to local disk'),
    downloadPath: z.string().optional().describe('Local folder path to save attachments (required if downloadAttachments is true)'),
    filterAttachmentTypes: z.array(z.string()).optional().describe('Filter by MIME types (e.g., ["application/pdf", "image/*"])'),
    maxAttachmentSize: z.number().optional().describe('Max attachment size in MB to download'),
  }),
  execute: async (inputData, context) => {
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/gmail.readonly']);
    if ((gate as any).ok !== true) return gate;

    const { 
      q, 
      labelIds, 
      maxResults, 
      includeSpamTrash, 
      downloadAttachments,
      downloadPath,
      filterAttachmentTypes,
      maxAttachmentSize,
    } = inputData as any;

    // Step 1: List messages
    const listParams = new URLSearchParams();
    if (typeof q === 'string' && q) listParams.set('q', q);
    if (Array.isArray(labelIds) && labelIds.length) {
      for (const l of labelIds) listParams.append('labelIds', l);
    }
    listParams.set('maxResults', String(maxResults || 10));
    if (typeof includeSpamTrash === 'boolean') {
      listParams.set('includeSpamTrash', includeSpamTrash ? 'true' : 'false');
    }

    const listData = await googleAuthorizedFetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?${listParams.toString()}`
    );
    const messages = Array.isArray((listData as any)?.messages) ? (listData as any).messages : [];

    if (messages.length === 0) {
      return { messages: [], count: 0, attachmentsDownloaded: 0 };
    }

    // Import bridge for file operations
    const { execLocalTool, hasClientBridge } = await import('./bridge');
    const hasBridge = hasClientBridge();

    // Step 2: Get full details for each message including attachments
    const results: any[] = [];
    let totalAttachmentsDownloaded = 0;

    for (const msgRef of messages) {
      try {
        const msgId = String(msgRef.id);
        const data = await googleAuthorizedFetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(msgId)}?format=full`
        );
        
        const headers = (data?.payload?.headers || []) as Array<{ name?: string; value?: string }>;
        const body = extractBody(data?.payload);
        const attachments = extractAttachments(data?.payload);

        const messageData: any = {
          id: String(data?.id || msgId),
          threadId: String(data?.threadId || ''),
          from: getHeader(headers, 'From'),
          to: getHeader(headers, 'To'),
          subject: getHeader(headers, 'Subject'),
          date: getHeader(headers, 'Date'),
          snippet: String(data?.snippet || ''),
          labelIds: Array.isArray(data?.labelIds) ? data.labelIds : [],
          sizeEstimate: typeof data?.sizeEstimate === 'number' ? data.sizeEstimate : undefined,
          body,
          attachments: attachments.map(att => ({
            filename: att.filename,
            mimeType: att.mimeType,
            size: att.size,
            attachmentId: att.attachmentId,
          })),
        };

        // Step 3: Download attachments if requested
        if (downloadAttachments && hasBridge && downloadPath && attachments.length > 0) {
          const downloaded: any[] = [];
          
          for (const att of attachments) {
            // Check MIME type filter
            if (filterAttachmentTypes && filterAttachmentTypes.length > 0) {
              const matches = filterAttachmentTypes.some((type: string) => {
                if (type.endsWith('/*')) {
                  return att.mimeType.startsWith(type.replace('/*', '/'));
                }
                return att.mimeType === type;
              });
              if (!matches) continue;
            }

            // Check size limit
            const sizeMB = att.size / (1024 * 1024);
            if (maxAttachmentSize && sizeMB > maxAttachmentSize) {
              downloaded.push({
                filename: att.filename,
                skipped: true,
                reason: `Size ${sizeMB.toFixed(2)}MB exceeds limit of ${maxAttachmentSize}MB`,
              });
              continue;
            }

            try {
              // Download from Gmail
              const attData = await googleAuthorizedFetch(
                `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(msgId)}/attachments/${encodeURIComponent(att.attachmentId)}`
              );
              
              let b64 = String((attData as any)?.data || '');
              b64 = b64.replace(/-/g, '+').replace(/_/g, '/');

              // Sanitize filename and construct full path
              const safeFilename = att.filename.replace(/[<>:"/\\|?*]/g, '_');
              const filePath = `${downloadPath.replace(/\\/g, '/').replace(/\/$/, '')}/${safeFilename}`;

              // Save via bridge
              const writeRes = await execLocalTool('write_file_base64', { 
                path: filePath, 
                content: b64 
              }, undefined, 60000, { silent: true });

              if (writeRes.ok) {
                downloaded.push({
                  filename: att.filename,
                  localPath: filePath,
                  size: att.size,
                  mimeType: att.mimeType,
                });
                totalAttachmentsDownloaded++;
              } else {
                downloaded.push({
                  filename: att.filename,
                  error: writeRes.error || 'Failed to write file',
                });
              }
            } catch (err: any) {
              downloaded.push({
                filename: att.filename,
                error: err?.message || 'Download failed',
              });
            }
          }

          messageData.downloadedAttachments = downloaded;
        } else if (downloadAttachments && !hasBridge) {
          messageData.downloadWarning = 'No client bridge available; attachments metadata only';
        }

        results.push(messageData);
      } catch (err) {
        // Skip failed messages but continue processing others
        console.error(`[gmail_retrieve_messages_with_attachments] Failed to process message:`, err);
      }
    }

    return {
      messages: results,
      count: results.length,
      attachmentsDownloaded: totalAttachmentsDownloaded,
      query: q || null,
    };
  },
});
