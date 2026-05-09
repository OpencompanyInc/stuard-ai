import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getExternalAccount, upsertExternalAccount, listExternalAccounts } from '../supabase';
import { getBridgeSecrets } from './bridge';
import { getResolvedBridgeSecrets } from './device/shared';
import { PUBLIC_BASE_URL as CFG_PUBLIC_BASE_URL, GOOGLE_CLIENT_ID as CFG_GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET as CFG_GOOGLE_CLIENT_SECRET } from '../utils/config';
import { refreshGoogleTokenIfNeeded } from '../routes/integrations/google-shared';
import { getVMOAuthAccount, listVMOAuthAccounts, shouldUseVMOAuth, storeVMOAuthAccount } from './vm-oauth';

const GOOGLE_API = 'https://www.googleapis.com';
const GOOGLE_CLIENT_ID = CFG_GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = CFG_GOOGLE_CLIENT_SECRET || '';
const PUBLIC_BASE = CFG_PUBLIC_BASE_URL || 'http://localhost:8082';

// Optional profile field shared across all Google tools.
// When omitted (default), the default profile is used.
// Users can specify an alternative like "work" or "personal".
const profileField = z.string().optional().describe(
  'Google account profile label. When the user has multiple Google accounts connected, pass the profile label (e.g. "work", "personal", "default") to target that specific account. Call google_list_profiles to see available profiles. If the user mentions a specific account or email, match it to the right profile.'
);

async function requireUserId(): Promise<string> {
  const secrets = getBridgeSecrets() || getResolvedBridgeSecrets();
  const userId = String((secrets as any)?.userId || '');
  if (!userId) {
    const keys = secrets ? Object.keys(secrets) : [];
    console.warn('[google-tools] missing_user_context — bridge secrets keys:', keys.join(',') || '(none)', '| secrets defined:', !!secrets);
    throw new Error('missing_user_context');
  }
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
    const secrets = getBridgeSecrets() || getResolvedBridgeSecrets();
    return (secrets as any)?.googleProfile || (secrets as any)?.profile || undefined;
  } catch { return undefined; }
}

async function getGoogleAccountOrThrow(userId: string, profileLabel?: string) {
  const acc = await getVMOAuthAccount('google', profileLabel) || await getExternalAccount(userId, 'google', profileLabel);
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
  if (/forms(\.| |$)/.test(s)) return 'forms';
  return '';
}

function buildConnectPath(required: string[]): string {
  const target = targetForScopes(required);
  const vmStore = shouldUseVMOAuth();
  if (target) return `/integrations/google/connect?target=${encodeURIComponent(target)}${vmStore ? '&store=vm' : ''}`;
  const scopes = encodeURIComponent(required.join(' '));
  return `/integrations/google/connect?scopes=${scopes}${vmStore ? '&store=vm' : ''}`;
}

const SCOPE_HIERARCHY: Record<string, string[]> = {
  'https://www.googleapis.com/auth/drive': ['https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/drive.file'],
  'https://www.googleapis.com/auth/documents': ['https://www.googleapis.com/auth/documents.readonly'],
  'https://www.googleapis.com/auth/spreadsheets': ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  'https://www.googleapis.com/auth/gmail.modify': ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'],
  'https://www.googleapis.com/auth/forms.body': ['https://www.googleapis.com/auth/forms.body.readonly'],
};

async function ensureConnectedAndScopes(required: string[], profileLabel?: string) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch (error: any) {
    if (String(error?.message || error) === 'missing_user_context') {
      return { ok: false, error: 'missing_user_context' } as const;
    }
    throw error;
  }
  const profile = resolveProfile(profileLabel);
  const acc = await getVMOAuthAccount('google', profile) || await getExternalAccount(userId, 'google', profile);
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
  let accessToken = acc.meta?.source === 'vm'
    ? acc.access_token
    : await refreshGoogleTokenIfNeeded(userId, acc, acc.profile_label);

  async function doFetch(token: string) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers as any),
    };
    const fullUrl = url.startsWith('http') ? url : `${GOOGLE_API}${url}`;
    const res = await fetch(fullUrl, { ...init, headers });
    let body: any = null;
    try { body = await res.json(); } catch { }
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
          if (acc.meta?.source === 'vm') {
            await storeVMOAuthAccount('google', {
              ...acc,
              access_token: newAccess,
              refresh_token: refresh_token || null,
              expires_at,
            });
          } else {
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
          }
        } catch { }
        acc = { ...acc, access_token: newAccess, expires_at, refresh_token };
        accessToken = newAccess;
        ({ res, body } = await doFetch(accessToken));
      }
    } catch { }
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
  inputSchema: z.object({
    profile: profileField,
  }),
  execute: async (inputData) => {
    const { profile } = inputData as any;
    const me = await googleAuthorizedFetch('https://www.googleapis.com/oauth2/v3/userinfo', undefined, profile);
    return { me };
  },
});

export const google_list_profiles = createTool({
  id: 'google_list_profiles',
  description: 'List all connected Google profiles/accounts for the current user. Returns profile labels and emails. IMPORTANT: Call this first when the user has multiple Google accounts to determine which profile label to pass to other Google tools (gmail_*, calendar_*, drive_*, etc.).',
  inputSchema: z.object({}),
  execute: async () => {
    const userId = await requireUserId();
    const accounts = shouldUseVMOAuth()
      ? await listVMOAuthAccounts('google')
      : await listExternalAccounts(userId, 'google');
    const profiles = accounts.map(a => ({
      profile: a.profile_label,
      isDefault: a.is_default,
      email: a.account_email || null,
      scopes: a.scopes,
    }));
    return { profiles };
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
    const { to, subject, body, contentType, from, cc, bcc, attachments } = inputData as any;

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
    } as any, profile);

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
  description: 'List Gmail messages with compact brief metadata. Requires gmail.readonly. Use optional query and labelIds.',
  inputSchema: z.object({
    q: z.string().optional(),
    labelIds: z.array(z.string()).optional(),
    maxResults: z.number().int().min(1).max(100).default(5),
    includeSpamTrash: z.boolean().optional(),
    profile: profileField,
  }),
  execute: async (inputData, context) => {
    const { profile } = inputData as any;
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/gmail.readonly'], profile);
    if ((gate as any).ok !== true) return gate;
    const { q, labelIds, maxResults, includeSpamTrash } = inputData as any;
    const params = new URLSearchParams();
    if (typeof q === 'string' && q) params.set('q', q);
    if (Array.isArray(labelIds) && labelIds.length) for (const l of labelIds) params.append('labelIds', l);
    params.set('maxResults', String(maxResults || 5));
    if (typeof includeSpamTrash === 'boolean') params.set('includeSpamTrash', includeSpamTrash ? 'true' : 'false');
    const data = await googleAuthorizedFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params.toString()}`, undefined, profile);
    const items = Array.isArray((data as any)?.messages) ? (data as any).messages : [];
    const briefItems = (
      await Promise.all(
        items.map(async (item: any) => {
          try {
            return await fetchGmailBriefMessage(String(item?.id || ''), profile);
          } catch {
            return null;
          }
        }),
      )
    ).filter(Boolean);
    return { items: briefItems, count: briefItems.length, nextPageToken: (data as any)?.nextPageToken };
  },
});

export const gmail_search_messages = createTool({
  id: 'gmail_search_messages',
  description: 'Search Gmail messages using Gmail search syntax. Compatibility alias for gmail_list_messages that requires a query string.',
  inputSchema: z.object({
    query: z.string().min(1).describe('Gmail search query, for example: from:alice@example.com newer_than:7d has:attachment'),
    labelIds: z.array(z.string()).optional(),
    maxResults: z.number().int().min(1).max(100).default(5),
    includeSpamTrash: z.boolean().optional(),
    profile: profileField,
  }),
  execute: async (inputData, context) => {
    const { query, ...rest } = inputData as any;
    return gmail_list_messages.execute?.({ ...rest, q: query }, context as any);
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
    const { calendarId, timeMin, timeMax, maxResults, singleEvents, orderBy } = inputData as any;
    const wantSingle = typeof singleEvents === 'boolean' ? singleEvents : true;
    // Google requires orderBy=startTime to be paired with singleEvents=true,
    // otherwise it 400s with "Bad Request".
    const safeOrder = !wantSingle && orderBy === 'startTime' ? 'updated' : (orderBy || 'startTime');
    const params = new URLSearchParams();
    if (timeMin) params.set('timeMin', toRfc3339(timeMin));
    if (timeMax) params.set('timeMax', toRfc3339(timeMax, /*endOfDay*/ true));
    params.set('maxResults', String(maxResults || 10));
    params.set('singleEvents', wantSingle ? 'true' : 'false');
    params.set('orderBy', safeOrder);
    const data = await googleAuthorizedFetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId || 'primary')}/events?${params.toString()}`);
    const items = Array.isArray((data as any)?.items) ? (data as any).items : [];
    return { items, count: items.length, nextPageToken: (data as any)?.nextPageToken };
  },
});

// Coerce date-only inputs ("2026-04-29") to RFC 3339 timestamps so Google
// Calendar doesn't 400. Pass-through for already-formatted timestamps.
function toRfc3339(value: string, endOfDay = false): string {
  const s = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return endOfDay ? `${s}T23:59:59Z` : `${s}T00:00:00Z`;
  }
  return s;
}

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
    recurrence: z
      .array(z.string())
      .optional()
      .describe(
        'RFC 5545 recurrence rules array, e.g. ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR"]. ' +
        'Supported RRULE properties: FREQ (DAILY/WEEKLY/MONTHLY/YEARLY), INTERVAL, BYDAY, COUNT, UNTIL. ' +
        'Pass a single-element array for most cases.'
      ),
  }),
  execute: async (inputData, context) => {
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/calendar.events']);
    if ((gate as any).ok !== true) return gate;
    const { calendarId, summary, description, location, start, end, timeZone, attendees, reminders, recurrence } = inputData as any;
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
      } catch { }
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
    if (Array.isArray(recurrence) && recurrence.length > 0) body.recurrence = recurrence;
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
    const { calendarId, eventId, sendUpdates } = inputData as any;

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

export const calendar_update_event = createTool({
  id: 'calendar_update_event',
  description:
    'Update an existing Google Calendar event. Can modify title, time, description, location, attendees, reminders, and recurrence. ' +
    'For recurring events, use modificationScope to control which instances are updated: ' +
    '"single" (default) updates just this occurrence, "thisAndFollowing" updates from this instance forward, ' +
    '"all" updates all instances in the series.',
  inputSchema: z.object({
    calendarId: z.string().default('primary'),
    eventId: z.string().min(1).describe('The event ID to update.'),
    modificationScope: z
      .enum(['single', 'thisAndFollowing', 'all'])
      .optional()
      .default('single')
      .describe('For recurring events: "single" (default), "thisAndFollowing", or "all".'),
    summary: z.string().optional().describe('New event title.'),
    description: z.string().optional().describe('New description.'),
    location: z.string().optional().describe('New location.'),
    start: z.string().optional().describe('New start: ISO 8601 datetime or YYYY-MM-DD for all-day.'),
    end: z.string().optional().describe('New end: ISO 8601 datetime or YYYY-MM-DD for all-day.'),
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
    recurrence: z
      .array(z.string())
      .optional()
      .describe(
        'RFC 5545 recurrence rules, e.g. ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR"]. ' +
        'Pass an empty array [] to remove recurrence (make the event non-repeating).'
      ),
    sendUpdates: z.enum(['all', 'externalOnly', 'none']).optional().describe('Who to notify of the update.'),
    profile: profileField,
  }),
  execute: async (inputData, context) => {
    const { profile } = inputData as any;
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/calendar.events'], profile);
    if ((gate as any).ok !== true) return gate;
    const {
      calendarId, eventId, modificationScope, summary, description, location,
      start, end, timeZone, attendees, reminders, recurrence, sendUpdates,
    } = inputData as any;

    // First fetch the existing event to PATCH it (PATCH requires only changed fields)
    const existing: any = await googleAuthorizedFetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId || 'primary')}/events/${encodeURIComponent(eventId)}`,
    );

    if ((existing as any)?.error) {
      return { ok: false, error: (existing as any).error?.message || 'event_not_found' };
    }

    const isDateOnly = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !/[Tt]/.test(String(s || ''));

    const patch: any = {};
    if (summary !== undefined) patch.summary = summary;
    if (description !== undefined) patch.description = description;
    if (location !== undefined) patch.location = location;
    if (reminders !== undefined) patch.reminders = reminders;
    if (Array.isArray(recurrence)) patch.recurrence = recurrence;
    if (Array.isArray(attendees)) {
      patch.attendees = attendees.map((a: any) => ({
        email: String(a.email),
        optional: typeof a.optional === 'boolean' ? a.optional : undefined,
        displayName: a.displayName ? String(a.displayName) : undefined,
      }));
    }
    if (start !== undefined) {
      patch.start = isDateOnly(start)
        ? { date: start, ...(timeZone ? { timeZone } : {}) }
        : { dateTime: start, ...(timeZone ? { timeZone } : {}) };
    }
    if (end !== undefined) {
      patch.end = isDateOnly(end)
        ? { date: end, ...(timeZone ? { timeZone } : {}) }
        : { dateTime: end, ...(timeZone ? { timeZone } : {}) };
    }

    const scope = modificationScope || 'single';
    const params = new URLSearchParams();
    if (sendUpdates) params.set('sendUpdates', String(sendUpdates));

    let url: string;
    if (scope === 'all' && existing.recurringEventId) {
      // Update all instances: PATCH the master recurring event
      url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId || 'primary')}/events/${encodeURIComponent(existing.recurringEventId)}`;
    } else {
      url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId || 'primary')}/events/${encodeURIComponent(eventId)}`;
      if (scope === 'thisAndFollowing' && existing.originalStartTime) {
        // Use thisAndFollowing by POSTing an instance override to /move is not applicable here.
        // Instead we patch the instance with the changes; Google auto-detects 'thisAndFollowing' when recurrence is modified on an instance.
      }
    }

    const qs = params.toString();
    const result = await googleAuthorizedFetch(`${url}${qs ? `?${qs}` : ''}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    } as any);

    return { ok: true, event: result };
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
    const { query, pageSize, orderBy, fields } = inputData as any;
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

// ─── MIME type helper for Drive uploads ───
function guessMimeType(filename: string): string {
  const ext = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
  const m: Record<string, string> = {
    pdf: 'application/pdf', doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
    txt: 'text/plain', csv: 'text/csv', json: 'application/json',
    xml: 'application/xml', html: 'text/html', zip: 'application/zip',
    gz: 'application/gzip', tar: 'application/x-tar',
    py: 'text/x-python', js: 'text/javascript', ts: 'text/typescript',
  };
  return m[ext] || 'application/octet-stream';
}

async function googleAuthorizedBinaryFetch(url: string, profileLabel?: string): Promise<Buffer> {
  const userId = await requireUserId();
  const profile = resolveProfile(profileLabel);
  let acc = await getGoogleAccountOrThrow(userId, profile);
  let accessToken = acc.meta?.source === 'vm'
    ? acc.access_token
    : await refreshGoogleTokenIfNeeded(userId, acc, acc.profile_label);

  async function doFetch(token: string) {
    return fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  }

  let res = await doFetch(accessToken);
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
          if (acc.meta?.source === 'vm') {
            await storeVMOAuthAccount('google', {
              ...acc,
              access_token: newAccess,
              refresh_token: refresh_token || null,
              expires_at,
            });
          } else {
            await upsertExternalAccount({
              userId, provider: 'google', access_token: newAccess,
              scopes: Array.isArray(acc.scopes) ? acc.scopes : [],
              refresh_token: refresh_token || null, expires_at,
              meta: { token_type: tBody.token_type || (acc.meta?.token_type || 'Bearer') },
              profileLabel: acc.profile_label || 'default',
              accountEmail: acc.account_email || null,
            });
          }
        } catch { }
        accessToken = newAccess;
        res = await doFetch(accessToken);
      }
    } catch { }
  }

  if (!res.ok) {
    let errBody: any = null;
    try { errBody = await res.json(); } catch { }
    const msg = errBody?.error?.message || errBody?.error || `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  return Buffer.from(await res.arrayBuffer());
}

// ─── Google Drive Tools ───

export const drive_get_file = createTool({
  id: 'drive_get_file',
  description: 'Get metadata for a Google Drive file by ID. Returns name, size, mimeType, parents, permissions, etc.',
  inputSchema: z.object({
    fileId: z.string(),
    fields: z.string().optional().describe('Comma-separated fields to return (default: comprehensive set). Use "*" for all.'),
    profile: profileField,
  }),
  execute: async (inputData, context) => {
    const { fileId, fields, profile } = inputData as any;
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/drive.readonly'], profile);
    if ((gate as any).ok !== true) return gate;
    const f = fields || 'id,name,mimeType,size,createdTime,modifiedTime,parents,webViewLink,webContentLink,owners,shared,sharingUser,permissions,description,starred,trashed';
    const data = await googleAuthorizedFetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(f)}`,
      undefined, profile,
    );
    return { file: data };
  },
});

export const drive_upload_file = createTool({
  id: 'drive_upload_file',
  description: 'Upload a local file to Google Drive. Reads the file from the user\'s machine via bridge and uploads it. Supports optional folder placement and Google Workspace conversion.',
  inputSchema: z.object({
    path: z.string().describe('Local file path to upload'),
    name: z.string().optional().describe('Override filename in Drive (defaults to original filename)'),
    folderId: z.string().optional().describe('Parent folder ID in Drive. Omit for root.'),
    mimeType: z.string().optional().describe('Override MIME type (auto-detected from extension if omitted)'),
    convertToGoogleFormat: z.boolean().optional().describe('Convert to Google Docs/Sheets/Slides format on upload (e.g. .docx → Google Doc, .xlsx → Google Sheet)'),
    description: z.string().optional(),
    profile: profileField,
  }),
  execute: async (inputData, context) => {
    const { path, name, folderId, mimeType, convertToGoogleFormat, description, profile } = inputData as any;
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/drive.file'], profile);
    if ((gate as any).ok !== true) return gate;

    const { execLocalTool, hasClientBridge } = await import('./bridge');
    if (!hasClientBridge()) return { ok: false, error: 'No client bridge available to read local files' };

    const result = await execLocalTool('read_file_base64', { path }, undefined, 60000, { silent: true });
    if (!result?.ok || !result?.data) {
      return { ok: false, error: result?.error || 'Failed to read file' };
    }

    const fileBase64: string = result.data;
    const originalFilename = path.replace(/\\/g, '/').split('/').pop() || 'file';
    const fileName = name || originalFilename;
    const fileMime = mimeType || guessMimeType(fileName);

    const metadata: any = { name: fileName };
    if (folderId) metadata.parents = [folderId];
    if (description) metadata.description = description;

    const boundary = `drive_upload_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const metadataJson = JSON.stringify(metadata);
    const multipartBody = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      metadataJson,
      `--${boundary}`,
      `Content-Type: ${fileMime}`,
      'Content-Transfer-Encoding: base64',
      '',
      fileBase64,
      `--${boundary}--`,
    ].join('\r\n');

    let uploadUrl = `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
    if (convertToGoogleFormat) uploadUrl += '&convert=true';

    const data = await googleAuthorizedFetch(uploadUrl, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` } as any,
      body: multipartBody,
    }, profile);

    return {
      ok: true,
      file: {
        id: (data as any)?.id,
        name: (data as any)?.name,
        mimeType: (data as any)?.mimeType,
        webViewLink: (data as any)?.webViewLink,
      },
    };
  },
});

export const drive_download_file = createTool({
  id: 'drive_download_file',
  description: 'Download a Google Drive file to the user\'s local machine. For Google Workspace files (Docs/Sheets/Slides), use drive_export_file instead.',
  inputSchema: z.object({
    fileId: z.string(),
    path: z.string().describe('Local path to save the downloaded file'),
    profile: profileField,
  }),
  execute: async (inputData, context) => {
    const { fileId, path, profile } = inputData as any;
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/drive.readonly'], profile);
    if ((gate as any).ok !== true) return gate;

    const { execLocalTool, hasClientBridge } = await import('./bridge');
    if (!hasClientBridge()) return { ok: false, error: 'No client bridge available to save files locally' };

    const buffer = await googleAuthorizedBinaryFetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
      profile,
    );

    const b64 = buffer.toString('base64');
    const res = await execLocalTool('write_file_base64', { path, content: b64 }, undefined, 60000, { silent: true });
    if (!res?.ok) return { ok: false, error: res?.error || 'Failed to write file' };

    return { ok: true, path, size: buffer.length };
  },
});

export const drive_export_file = createTool({
  id: 'drive_export_file',
  description: 'Export a Google Workspace file (Docs, Sheets, Slides, Drawings) to a different format and save locally. Use this instead of drive_download_file for Google-native files.',
  inputSchema: z.object({
    fileId: z.string(),
    path: z.string().describe('Local path to save the exported file'),
    exportMimeType: z.enum([
      'application/pdf',
      'text/plain',
      'text/html',
      'text/csv',
      'text/tab-separated-values',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/rtf',
      'application/zip',
      'image/png',
      'image/jpeg',
      'image/svg+xml',
      'application/epub+zip',
    ]).describe('Target format. Common: PDF for any, DOCX for Docs, XLSX for Sheets, PPTX for Slides, CSV for single-sheet export.'),
    profile: profileField,
  }),
  execute: async (inputData, context) => {
    const { fileId, path, exportMimeType, profile } = inputData as any;
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/drive.readonly'], profile);
    if ((gate as any).ok !== true) return gate;

    const { execLocalTool, hasClientBridge } = await import('./bridge');
    if (!hasClientBridge()) return { ok: false, error: 'No client bridge available to save files locally' };

    const buffer = await googleAuthorizedBinaryFetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportMimeType)}`,
      profile,
    );

    const b64 = buffer.toString('base64');
    const res = await execLocalTool('write_file_base64', { path, content: b64 }, undefined, 60000, { silent: true });
    if (!res?.ok) return { ok: false, error: res?.error || 'Failed to write file' };

    return { ok: true, path, size: buffer.length, exportMimeType };
  },
});

export const drive_create_folder = createTool({
  id: 'drive_create_folder',
  description: 'Create a folder in Google Drive.',
  inputSchema: z.object({
    name: z.string(),
    parentId: z.string().optional().describe('Parent folder ID. Omit for root.'),
    description: z.string().optional(),
    profile: profileField,
  }),
  execute: async (inputData, context) => {
    const { name, parentId, description, profile } = inputData as any;
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/drive.file'], profile);
    if ((gate as any).ok !== true) return gate;

    const metadata: any = {
      name,
      mimeType: 'application/vnd.google-apps.folder',
    };
    if (parentId) metadata.parents = [parentId];
    if (description) metadata.description = description;

    const data = await googleAuthorizedFetch(
      'https://www.googleapis.com/drive/v3/files',
      { method: 'POST', body: JSON.stringify(metadata) },
      profile,
    );
    return { folder: { id: (data as any)?.id, name: (data as any)?.name, webViewLink: (data as any)?.webViewLink } };
  },
});

export const drive_delete_file = createTool({
  id: 'drive_delete_file',
  description: 'Delete a file or folder from Google Drive permanently (bypasses trash). Use drive_trash_file to move to trash instead.',
  inputSchema: z.object({
    fileId: z.string(),
    profile: profileField,
  }),
  execute: async (inputData, context) => {
    const { fileId, profile } = inputData as any;
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/drive'], profile);
    if ((gate as any).ok !== true) return gate;

    await googleAuthorizedFetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
      { method: 'DELETE' },
      profile,
    );
    return { ok: true, deleted: fileId };
  },
});

export const drive_trash_file = createTool({
  id: 'drive_trash_file',
  description: 'Move a file or folder to Google Drive trash (recoverable). Use drive_delete_file for permanent deletion.',
  inputSchema: z.object({
    fileId: z.string(),
    profile: profileField,
  }),
  execute: async (inputData, context) => {
    const { fileId, profile } = inputData as any;
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/drive'], profile);
    if ((gate as any).ok !== true) return gate;

    const data = await googleAuthorizedFetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
      { method: 'PATCH', body: JSON.stringify({ trashed: true }) },
      profile,
    );
    return { ok: true, trashed: fileId, name: (data as any)?.name };
  },
});

export const drive_move_file = createTool({
  id: 'drive_move_file',
  description: 'Move a file or folder to a different parent folder in Google Drive.',
  inputSchema: z.object({
    fileId: z.string(),
    newParentId: z.string().describe('Target folder ID'),
    removeFromCurrentParents: z.boolean().default(true).describe('Remove from all current parents (default true for a true "move")'),
    profile: profileField,
  }),
  execute: async (inputData, context) => {
    const { fileId, newParentId, removeFromCurrentParents, profile } = inputData as any;
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/drive'], profile);
    if ((gate as any).ok !== true) return gate;

    let removeParents = '';
    if (removeFromCurrentParents !== false) {
      const meta = await googleAuthorizedFetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=parents`,
        undefined, profile,
      );
      removeParents = (Array.isArray((meta as any)?.parents) ? (meta as any).parents : []).join(',');
    }

    const params = new URLSearchParams();
    params.set('addParents', newParentId);
    if (removeParents) params.set('removeParents', removeParents);

    const data = await googleAuthorizedFetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?${params.toString()}`,
      { method: 'PATCH', body: JSON.stringify({}) },
      profile,
    );
    return { ok: true, file: { id: (data as any)?.id, name: (data as any)?.name, parents: (data as any)?.parents } };
  },
});

export const drive_copy_file = createTool({
  id: 'drive_copy_file',
  description: 'Copy a file in Google Drive. Optionally place the copy in a different folder or rename it.',
  inputSchema: z.object({
    fileId: z.string(),
    name: z.string().optional().describe('Name for the copy (defaults to "Copy of <original>")'),
    folderId: z.string().optional().describe('Target folder ID for the copy'),
    profile: profileField,
  }),
  execute: async (inputData, context) => {
    const { fileId, name, folderId, profile } = inputData as any;
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/drive'], profile);
    if ((gate as any).ok !== true) return gate;

    const body: any = {};
    if (name) body.name = name;
    if (folderId) body.parents = [folderId];

    const data = await googleAuthorizedFetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/copy`,
      { method: 'POST', body: JSON.stringify(body) },
      profile,
    );
    return { file: { id: (data as any)?.id, name: (data as any)?.name, mimeType: (data as any)?.mimeType, webViewLink: (data as any)?.webViewLink } };
  },
});

export const drive_rename_file = createTool({
  id: 'drive_rename_file',
  description: 'Rename a file or folder in Google Drive.',
  inputSchema: z.object({
    fileId: z.string(),
    name: z.string(),
    profile: profileField,
  }),
  execute: async (inputData, context) => {
    const { fileId, name, profile } = inputData as any;
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/drive'], profile);
    if ((gate as any).ok !== true) return gate;

    const data = await googleAuthorizedFetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
      { method: 'PATCH', body: JSON.stringify({ name }) },
      profile,
    );
    return { ok: true, file: { id: (data as any)?.id, name: (data as any)?.name } };
  },
});

export const drive_share_file = createTool({
  id: 'drive_share_file',
  description: 'Share a file or folder in Google Drive by creating a permission. Can share with specific users, groups, domains, or make it public.',
  inputSchema: z.object({
    fileId: z.string(),
    role: z.enum(['reader', 'commenter', 'writer', 'organizer', 'fileOrganizer', 'owner']).describe('Permission level'),
    type: z.enum(['user', 'group', 'domain', 'anyone']).describe('"user" or "group" requires emailAddress. "domain" requires domain. "anyone" makes it public.'),
    emailAddress: z.string().optional().describe('Required for type "user" or "group"'),
    domain: z.string().optional().describe('Required for type "domain"'),
    sendNotificationEmail: z.boolean().default(true),
    emailMessage: z.string().optional().describe('Custom message in the sharing notification email'),
    profile: profileField,
  }),
  execute: async (inputData, context) => {
    const { fileId, role, type, emailAddress, domain, sendNotificationEmail, emailMessage, profile } = inputData as any;
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/drive'], profile);
    if ((gate as any).ok !== true) return gate;

    const permission: any = { role, type };
    if (emailAddress) permission.emailAddress = emailAddress;
    if (domain) permission.domain = domain;

    const params = new URLSearchParams();
    if (sendNotificationEmail === false) params.set('sendNotificationEmail', 'false');
    if (emailMessage) params.set('emailMessage', emailMessage);

    const data = await googleAuthorizedFetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions?${params.toString()}`,
      { method: 'POST', body: JSON.stringify(permission) },
      profile,
    );
    return { ok: true, permission: { id: (data as any)?.id, role: (data as any)?.role, type: (data as any)?.type, emailAddress: (data as any)?.emailAddress } };
  },
});

export const drive_list_permissions = createTool({
  id: 'drive_list_permissions',
  description: 'List permissions (sharing settings) for a Google Drive file or folder.',
  inputSchema: z.object({
    fileId: z.string(),
    profile: profileField,
  }),
  execute: async (inputData, context) => {
    const { fileId, profile } = inputData as any;
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/drive.readonly'], profile);
    if ((gate as any).ok !== true) return gate;

    const data = await googleAuthorizedFetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions?fields=permissions(id,role,type,emailAddress,domain,displayName)`,
      undefined, profile,
    );
    return { permissions: (data as any)?.permissions || [] };
  },
});

export const drive_remove_permission = createTool({
  id: 'drive_remove_permission',
  description: 'Remove a sharing permission from a Google Drive file. Use drive_list_permissions to find permission IDs.',
  inputSchema: z.object({
    fileId: z.string(),
    permissionId: z.string(),
    profile: profileField,
  }),
  execute: async (inputData, context) => {
    const { fileId, permissionId, profile } = inputData as any;
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/drive'], profile);
    if ((gate as any).ok !== true) return gate;

    await googleAuthorizedFetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(permissionId)}`,
      { method: 'DELETE' },
      profile,
    );
    return { ok: true, removed: permissionId };
  },
});

export const drive_create_file = createTool({
  id: 'drive_create_file',
  description: 'Create a new file in Google Drive with text content directly (no local file needed). Good for creating text, JSON, CSV, or HTML files.',
  inputSchema: z.object({
    name: z.string(),
    content: z.string().describe('Text content for the file'),
    mimeType: z.string().default('text/plain').describe('MIME type of the file content'),
    folderId: z.string().optional().describe('Parent folder ID. Omit for root.'),
    description: z.string().optional(),
    profile: profileField,
  }),
  execute: async (inputData, context) => {
    const { name, content, mimeType, folderId, description, profile } = inputData as any;
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/drive.file'], profile);
    if ((gate as any).ok !== true) return gate;

    const metadata: any = { name };
    if (folderId) metadata.parents = [folderId];
    if (description) metadata.description = description;

    const boundary = `drive_create_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const multipartBody = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      `Content-Type: ${mimeType || 'text/plain'}; charset=UTF-8`,
      '',
      content,
      `--${boundary}--`,
    ].join('\r\n');

    const data = await googleAuthorizedFetch(
      `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`,
      {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` } as any,
        body: multipartBody,
      },
      profile,
    );

    return { file: { id: (data as any)?.id, name: (data as any)?.name, mimeType: (data as any)?.mimeType, webViewLink: (data as any)?.webViewLink } };
  },
});

export const drive_update_file = createTool({
  id: 'drive_update_file',
  description: 'Update/replace the content of an existing file in Google Drive using a local file. The file metadata (name, etc.) stays the same unless you also patch it.',
  inputSchema: z.object({
    fileId: z.string(),
    path: z.string().describe('Local file path with new content'),
    mimeType: z.string().optional().describe('Override MIME type (auto-detected if omitted)'),
    name: z.string().optional().describe('Optionally rename the file at the same time'),
    profile: profileField,
  }),
  execute: async (inputData, context) => {
    const { fileId, path, mimeType, name, profile } = inputData as any;
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/drive.file'], profile);
    if ((gate as any).ok !== true) return gate;

    const { execLocalTool, hasClientBridge } = await import('./bridge');
    if (!hasClientBridge()) return { ok: false, error: 'No client bridge available to read local files' };

    const result = await execLocalTool('read_file_base64', { path }, undefined, 60000, { silent: true });
    if (!result?.ok || !result?.data) return { ok: false, error: result?.error || 'Failed to read file' };

    const originalFilename = path.replace(/\\/g, '/').split('/').pop() || 'file';
    const fileMime = mimeType || guessMimeType(originalFilename);

    const metadata: any = {};
    if (name) metadata.name = name;

    const boundary = `drive_update_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const multipartBody = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      `Content-Type: ${fileMime}`,
      'Content-Transfer-Encoding: base64',
      '',
      result.data,
      `--${boundary}--`,
    ].join('\r\n');

    const data = await googleAuthorizedFetch(
      `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=multipart`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` } as any,
        body: multipartBody,
      },
      profile,
    );

    return { ok: true, file: { id: (data as any)?.id, name: (data as any)?.name, mimeType: (data as any)?.mimeType } };
  },
});

export const drive_search_files = createTool({
  id: 'drive_search_files',
  description: 'Search Google Drive with full-text search across file names and content. Returns file metadata. More convenient than drive_list_files for simple text searches.',
  inputSchema: z.object({
    query: z.string().describe('Search text (searches file names and content)'),
    pageSize: z.number().int().min(1).max(100).default(20),
    fileType: z.enum(['document', 'spreadsheet', 'presentation', 'form', 'drawing', 'pdf', 'image', 'video', 'audio', 'folder', 'any']).default('any').describe('Filter by file type'),
    trashedOnly: z.boolean().optional().describe('Search only in trash'),
    sharedWithMe: z.boolean().optional().describe('Search only files shared with me'),
    profile: profileField,
  }),
  execute: async (inputData, context) => {
    const { query, pageSize, fileType, trashedOnly, sharedWithMe, profile } = inputData as any;
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/drive.readonly'], profile);
    if ((gate as any).ok !== true) return gate;

    const typeMimeMap: Record<string, string> = {
      document: 'application/vnd.google-apps.document',
      spreadsheet: 'application/vnd.google-apps.spreadsheet',
      presentation: 'application/vnd.google-apps.presentation',
      form: 'application/vnd.google-apps.form',
      drawing: 'application/vnd.google-apps.drawing',
      pdf: 'application/pdf',
      folder: 'application/vnd.google-apps.folder',
    };

    const clauses: string[] = [];
    clauses.push(`fullText contains '${query.replace(/'/g, "\\'")}'`);

    if (fileType && fileType !== 'any') {
      if (typeMimeMap[fileType]) {
        clauses.push(`mimeType = '${typeMimeMap[fileType]}'`);
      } else if (fileType === 'image') {
        clauses.push(`mimeType contains 'image/'`);
      } else if (fileType === 'video') {
        clauses.push(`mimeType contains 'video/'`);
      } else if (fileType === 'audio') {
        clauses.push(`mimeType contains 'audio/'`);
      }
    }

    if (trashedOnly) clauses.push('trashed = true');
    else clauses.push('trashed = false');

    if (sharedWithMe) clauses.push('sharedWithMe = true');

    const q = clauses.join(' and ');
    const params = new URLSearchParams();
    params.set('q', q);
    params.set('pageSize', String(pageSize || 20));
    params.set('fields', 'files(id,name,mimeType,size,modifiedTime,webViewLink,owners,shared),nextPageToken');

    const data = await googleAuthorizedFetch(
      `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
      undefined, profile,
    );
    const files = Array.isArray((data as any)?.files) ? (data as any).files : [];
    return { files, count: files.length, query: q, nextPageToken: (data as any)?.nextPageToken };
  },
});

export const drive_get_storage_quota = createTool({
  id: 'drive_get_storage_quota',
  description: 'Get Google Drive storage usage and quota information.',
  inputSchema: z.object({ profile: profileField }),
  execute: async (inputData, context) => {
    const { profile } = inputData as any;
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/drive.readonly'], profile);
    if ((gate as any).ok !== true) return gate;

    const data = await googleAuthorizedFetch(
      'https://www.googleapis.com/drive/v3/about?fields=storageQuota,user',
      undefined, profile,
    );
    const sq = (data as any)?.storageQuota || {};
    return {
      user: (data as any)?.user,
      storage: {
        limit: sq.limit ? `${(Number(sq.limit) / (1024 ** 3)).toFixed(2)} GB` : 'unlimited',
        usage: sq.usage ? `${(Number(sq.usage) / (1024 ** 3)).toFixed(2)} GB` : '0 GB',
        usageInDrive: sq.usageInDrive ? `${(Number(sq.usageInDrive) / (1024 ** 3)).toFixed(2)} GB` : '0 GB',
        usageInDriveTrash: sq.usageInDriveTrash ? `${(Number(sq.usageInDriveTrash) / (1024 ** 3)).toFixed(2)} GB` : '0 GB',
      },
    };
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
    const { spreadsheetId, range, majorDimension } = inputData as any;
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
    const { documentId } = inputData as any;
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

const GMAIL_FROM_MAX_CHARS = 120;
const GMAIL_SUBJECT_MAX_CHARS = 160;
const GMAIL_SNIPPET_MAX_CHARS = 180;
const GMAIL_BODY_TEXT_MAX_CHARS = 1200;
const GMAIL_BODY_HTML_MAX_CHARS = 300;
const GMAIL_GIST_MAX_CHARS = 320;
const GMAIL_ATTACHMENTS_MAX_ITEMS = 8;
const GMAIL_COMPACT_LABELS = new Set([
  'UNREAD',
  'INBOX',
  'IMPORTANT',
  'STARRED',
  'SENT',
  'DRAFT',
  'TRASH',
  'SPAM',
]);

function truncateGmailText(value: any, maxChars: number): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > maxChars ? text.slice(0, Math.max(0, maxChars - 3)) + '...' : text;
}

function compactGmailLabelIds(labelIds: any): string[] {
  const labels = Array.isArray(labelIds) ? labelIds.map((label) => String(label || '')) : [];
  return labels.filter((label) => GMAIL_COMPACT_LABELS.has(label));
}

function htmlToTextPreview(html: string): string {
  return truncateGmailText(
    String(html || '')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>'),
    GMAIL_BODY_TEXT_MAX_CHARS,
  );
}

function normalizeGmailGistText(value: any): string {
  return String(value || '')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitGmailGistSegments(value: string): string[] {
  return normalizeGmailGistText(value)
    .split(/(?<=[.!?])\s+|\s*[•·]\s+|\s{2,}/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function isLowSignalGmailSegment(segment: string): boolean {
  const text = segment.toLowerCase();
  if (text.length < 24) return true;
  if (/^(view|open|click|tap)\b/.test(text) && text.length < 80) return true;
  if (/unsubscribe|manage preferences|email preferences|privacy policy|terms of service|all rights reserved/.test(text)) return true;
  if (/follow us|facebook|instagram|linkedin|twitter|tiktok|youtube/.test(text)) return true;
  if (/no-reply|do not reply|sent from my/.test(text)) return true;
  if (/^https?:\/\//.test(text)) return true;
  return false;
}

function buildGmailGist(brief: { subject?: string; snippet?: string }, body: { html?: string; text?: string }) {
  const bodyText = normalizeGmailGistText(body?.text || htmlToTextPreview(body?.html || ''));
  const candidates = [
    ...splitGmailGistSegments(brief?.snippet || ''),
    ...splitGmailGistSegments(bodyText).slice(0, 8),
  ];

  const seen = new Set<string>();
  const selected: string[] = [];

  for (const candidate of candidates) {
    const cleaned = truncateGmailText(candidate, 180);
    const normalized = cleaned.toLowerCase();
    if (!cleaned) continue;
    if (isLowSignalGmailSegment(cleaned)) continue;
    if (normalized === String(brief?.subject || '').trim().toLowerCase()) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    selected.push(cleaned);
    if (selected.length >= 2) break;
  }

  const summary = selected.join(' ');
  if (summary) return truncateGmailText(summary, GMAIL_GIST_MAX_CHARS);

  if (brief?.snippet) return truncateGmailText(brief.snippet, GMAIL_GIST_MAX_CHARS);
  if (bodyText) return truncateGmailText(bodyText, GMAIL_GIST_MAX_CHARS);
  return truncateGmailText(brief?.subject || '', GMAIL_GIST_MAX_CHARS);
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
  } catch { }
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
  } catch { }
  return out;
}

function buildGmailBriefMessage(data: any, fallbackId: string) {
  const headers = (data?.payload?.headers || []) as Array<{ name?: string; value?: string }>;
  const labelIds = compactGmailLabelIds(data?.labelIds);
  return {
    id: String(data?.id || fallbackId),
    threadId: String(data?.threadId || ''),
    from: truncateGmailText(getHeader(headers, 'From'), GMAIL_FROM_MAX_CHARS),
    subject: truncateGmailText(getHeader(headers, 'Subject'), GMAIL_SUBJECT_MAX_CHARS),
    date: getHeader(headers, 'Date'),
    snippet: truncateGmailText(data?.snippet || '', GMAIL_SNIPPET_MAX_CHARS),
    labelIds,
    unread: labelIds.includes('UNREAD'),
  };
}

function buildCompactGmailBody(body: { html?: string; text?: string }) {
  const text = truncateGmailText(body?.text || '', GMAIL_BODY_TEXT_MAX_CHARS);
  const html = truncateGmailText(body?.html || '', GMAIL_BODY_HTML_MAX_CHARS);
  const fallbackText = !text && html ? htmlToTextPreview(html) : '';
  const preferredText = text || fallbackText;

  return {
    ...(preferredText ? { text: preferredText } : {}),
    ...(!preferredText && html ? { html } : {}),
    truncated: Boolean((body?.text || '').length > GMAIL_BODY_TEXT_MAX_CHARS || (body?.html || '').length > GMAIL_BODY_HTML_MAX_CHARS),
  };
}

function buildCompactGmailAttachments(payload: any) {
  const allAttachments = extractAttachments(payload);
  return {
    attachmentCount: allAttachments.length,
    attachments: allAttachments.slice(0, GMAIL_ATTACHMENTS_MAX_ITEMS).map((attachment) => ({
      filename: truncateGmailText(attachment.filename, 80),
      mimeType: attachment.mimeType,
      size: attachment.size,
      attachmentId: attachment.attachmentId,
    })),
    attachmentsTruncated: allAttachments.length > GMAIL_ATTACHMENTS_MAX_ITEMS,
  };
}

function buildCompactGmailFullMessage(data: any, fallbackId: string) {
  const body = extractBody(data?.payload);
  const compactBody = buildCompactGmailBody(body);
  const compactAttachments = buildCompactGmailAttachments(data?.payload);
  const brief = buildGmailBriefMessage(data, fallbackId);
  return {
    ...brief,
    gist: buildGmailGist(brief, body),
    sizeEstimate: typeof data?.sizeEstimate === 'number' ? data.sizeEstimate : undefined,
    body: compactBody,
    attachmentCount: compactAttachments.attachmentCount,
    attachments: compactAttachments.attachments,
    attachmentsTruncated: compactAttachments.attachmentsTruncated,
  };
}

async function fetchGmailBriefMessage(id: string, profile?: string) {
  const data = await googleAuthorizedFetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
    undefined,
    profile,
  );
  return buildGmailBriefMessage(data, id);
}

export const gmail_get_message_brief = createTool({
  id: 'gmail_get_message_brief',
  description: 'Get a Gmail message brief (from, subject, date, snippet) by ID. Requires gmail.readonly.',
  inputSchema: z.object({ id: z.string(), profile: profileField }),
  execute: async (inputData, context) => {
    const { id, profile } = inputData as any;
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/gmail.readonly'], profile);
    if ((gate as any).ok !== true) return gate;
    return { message: await fetchGmailBriefMessage(id, profile) };
  },
});

export const gmail_get_message_full = createTool({
  id: 'gmail_get_message_full',
  description: 'Get a Gmail message with a compact gist, trimmed body preview, and attachment metadata by ID. Requires gmail.readonly.',
  inputSchema: z.object({ id: z.string(), profile: profileField }),
  execute: async (inputData, context) => {
    const { id, profile } = inputData as any;
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/gmail.readonly'], profile);
    if ((gate as any).ok !== true) return gate;
    const data = await googleAuthorizedFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`, undefined, profile);
    return { message: buildCompactGmailFullMessage(data, id) };
  },
});

export const gmail_download_attachment = createTool({
  id: 'gmail_download_attachment',
  description: 'Download a Gmail attachment to a local file. Requires gmail.readonly.',
  inputSchema: z.object({
    messageId: z.string(),
    attachmentId: z.string(),
    path: z.string().describe('Local path to save the file to'),
    profile: profileField,
  }),
  execute: async (inputData, context) => {
    const { messageId, attachmentId, path, profile } = inputData as any;
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/gmail.readonly'], profile);
    if ((gate as any).ok !== true) return gate;

    const data = await googleAuthorizedFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`, undefined, profile);

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
  inputSchema: z.object({ ids: z.array(z.string()).min(1).max(50), profile: profileField }),
  execute: async (inputData, context) => {
    const { ids, profile } = inputData as any;
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/gmail.readonly'], profile);
    if ((gate as any).ok !== true) return gate;
    const results = (
      await Promise.all(
        ids.map(async (id: string) => {
          try {
            return await fetchGmailBriefMessage(String(id), profile);
          } catch {
            return null;
          }
        }),
      )
    ).filter(Boolean);
    return { items: results, count: results.length };
  },
});

export const gmail_list_recent_brief = createTool({
  id: 'gmail_list_recent_brief',
  description: 'List the most recent Gmail messages with brief info (from, subject, date, snippet). Requires gmail.readonly.',
  inputSchema: z.object({ maxResults: z.number().int().min(1).max(25).default(5), profile: profileField }),
  execute: async (inputData, context) => {
    const { maxResults, profile } = inputData as any;
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/gmail.readonly'], profile);
    if ((gate as any).ok !== true) return gate;
    const list = await googleAuthorizedFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${encodeURIComponent(String(maxResults || 5))}`, undefined, profile);
    const ids = Array.isArray((list as any)?.messages) ? (list as any).messages.map((m: any) => String(m.id)) : [];
    const results = (
      await Promise.all(
        ids.map(async (id: string) => {
          try {
            return await fetchGmailBriefMessage(String(id), profile);
          } catch {
            return null;
          }
        }),
      )
    ).filter(Boolean);
    return { items: results, count: results.length };
  },
});

export const gmail_get_most_recent_full = createTool({
  id: 'gmail_get_most_recent_full',
  description: 'Get the most recent Gmail message with a compact gist, trimmed body preview, and attachment metadata. Requires gmail.readonly.',
  inputSchema: z.object({ labelIds: z.array(z.string()).optional(), profile: profileField }),
  execute: async (inputData, context) => {
    const { labelIds, profile } = inputData as any;
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/gmail.readonly'], profile);
    if ((gate as any).ok !== true) return gate;
    const params = new URLSearchParams();
    params.set('maxResults', '1');
    const labels = Array.isArray(labelIds) && labelIds.length ? labelIds : ['INBOX'];
    for (const l of labels) params.append('labelIds', String(l));
    const list = await googleAuthorizedFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params.toString()}`, undefined, profile);
    const firstId = Array.isArray((list as any)?.messages) && (list as any).messages.length > 0 ? String((list as any).messages[0].id) : '';
    if (!firstId) return { ok: true, message: null };
    const data = await googleAuthorizedFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(firstId)}?format=full`, undefined, profile);
    return { message: buildCompactGmailFullMessage(data, firstId) };
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
    const { title } = inputData as any;
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
    profile: profileField,
  }),
  execute: async (inputData, context) => {
    const { id, addLabelIds, removeLabelIds, profile } = inputData as any;
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/gmail.modify'], profile);
    if ((gate as any).ok !== true) return gate;
    const body: any = {};
    if (Array.isArray(addLabelIds) && addLabelIds.length > 0) body.addLabelIds = addLabelIds;
    if (Array.isArray(removeLabelIds) && removeLabelIds.length > 0) body.removeLabelIds = removeLabelIds;
    const data = await googleAuthorizedFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}/modify`, {
      method: 'POST',
      body: JSON.stringify(body),
    } as any, profile);
    return { message: data };
  },
});

export const gmail_delete_message = createTool({
  id: 'gmail_delete_message',
  description: 'Delete a Gmail message permanently. Requires gmail.modify.',
  inputSchema: z.object({ id: z.string(), profile: profileField }),
  execute: async (inputData, context) => {
    const { id, profile } = inputData as any;
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/gmail.modify'], profile);
    if ((gate as any).ok !== true) return gate;
    const data = await googleAuthorizedFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    } as any, profile);
    return { ok: true };
  },
});

export const gmail_archive_message = createTool({
  id: 'gmail_archive_message',
  description: 'Archive a Gmail message (remove from inbox). Requires gmail.modify.',
  inputSchema: z.object({ id: z.string(), profile: profileField }),
  execute: async (inputData, context) => {
    const { id, profile } = inputData as any;
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/gmail.modify'], profile);
    if ((gate as any).ok !== true) return gate;
    const body = { removeLabelIds: ['INBOX'] };
    const data = await googleAuthorizedFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}/modify`, {
      method: 'POST',
      body: JSON.stringify(body),
    } as any, profile);
    return { message: data };
  },
});

export const gmail_mark_as_read = createTool({
  id: 'gmail_mark_as_read',
  description: 'Mark a Gmail message as read (remove UNREAD label). Requires gmail.modify.',
  inputSchema: z.object({ id: z.string(), profile: profileField }),
  execute: async (inputData, context) => {
    const { id, profile } = inputData as any;
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/gmail.modify'], profile);
    if ((gate as any).ok !== true) return gate;
    const body = { removeLabelIds: ['UNREAD'] };
    const data = await googleAuthorizedFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}/modify`, {
      method: 'POST',
      body: JSON.stringify(body),
    } as any, profile);
    return { message: data };
  },
});

export const gmail_mark_as_unread = createTool({
  id: 'gmail_mark_as_unread',
  description: 'Mark a Gmail message as unread (add UNREAD label). Requires gmail.modify.',
  inputSchema: z.object({ id: z.string(), profile: profileField }),
  execute: async (inputData, context) => {
    const { id, profile } = inputData as any;
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/gmail.modify'], profile);
    if ((gate as any).ok !== true) return gate;
    const body = { addLabelIds: ['UNREAD'] };
    const data = await googleAuthorizedFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}/modify`, {
      method: 'POST',
      body: JSON.stringify(body),
    } as any, profile);
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
    const { documentId, text, index } = inputData as any;

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
    profile: profileField,
  }),
  execute: async (inputData, context) => {
    const gate = await ensureConnectedAndScopes(['https://www.googleapis.com/auth/gmail.readonly'], (inputData as any)?.profile);
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
      profile,
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
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?${listParams.toString()}`,
      undefined,
      profile,
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
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(msgId)}?format=full`,
          undefined,
          profile,
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
                `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(msgId)}/attachments/${encodeURIComponent(att.attachmentId)}`,
                undefined,
                profile,
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

// ─── Google Forms Tools ───

const FORMS_SCOPE = 'https://www.googleapis.com/auth/forms.body';
const FORMS_READONLY_SCOPE = 'https://www.googleapis.com/auth/forms.body.readonly';
const FORMS_RESPONSES_SCOPE = 'https://www.googleapis.com/auth/forms.responses.readonly';

export const forms_create = createTool({
  id: 'forms_create',
  description: 'Create a new Google Form with a title. After creation, use forms_add_questions to add questions.',
  inputSchema: z.object({
    title: z.string().describe('Form title displayed to respondents'),
    documentTitle: z.string().optional().describe('Internal document title in Drive (defaults to form title)'),
    description: z.string().optional().describe('Form description shown below the title'),
    profile: profileField,
  }),
  execute: async (inputData, context) => {
    const { title, documentTitle, description, profile } = inputData as any;
    const gate = await ensureConnectedAndScopes([FORMS_SCOPE], profile);
    if ((gate as any).ok !== true) return gate;

    // Step 1: Create the form
    const data = await googleAuthorizedFetch(
      'https://forms.googleapis.com/v1/forms',
      { method: 'POST', body: JSON.stringify({ info: { title, documentTitle: documentTitle || title } }) },
      profile,
    );

    const formId = (data as any)?.formId;
    const responderUri = (data as any)?.responderUri;

    // Step 2: Set description if provided
    if (description && formId) {
      try {
        await googleAuthorizedFetch(
          `https://forms.googleapis.com/v1/forms/${encodeURIComponent(formId)}:batchUpdate`,
          {
            method: 'POST',
            body: JSON.stringify({
              requests: [{ updateFormInfo: { info: { description }, updateMask: 'description' } }],
            }),
          },
          profile,
        );
      } catch { }
    }

    return { formId, title, responderUri, editUrl: `https://docs.google.com/forms/d/${formId}/edit` };
  },
});

export const forms_get = createTool({
  id: 'forms_get',
  description: 'Get a Google Form structure: title, description, questions, settings. Useful to inspect an existing form.',
  inputSchema: z.object({
    formId: z.string(),
    profile: profileField,
  }),
  execute: async (inputData, context) => {
    const { formId, profile } = inputData as any;
    const gate = await ensureConnectedAndScopes([FORMS_READONLY_SCOPE], profile);
    if ((gate as any).ok !== true) return gate;

    const data = await googleAuthorizedFetch(
      `https://forms.googleapis.com/v1/forms/${encodeURIComponent(formId)}`,
      undefined, profile,
    );
    return { form: data };
  },
});

export const forms_add_questions = createTool({
  id: 'forms_add_questions',
  description: `Add questions to a Google Form. Supports all question types: short text, paragraph, multiple choice, checkbox, dropdown, linear scale, date, time, file upload, and grid.

Example questions array:
[
  { "title": "Your name?", "type": "SHORT_TEXT", "required": true },
  { "title": "Feedback", "type": "PARAGRAPH" },
  { "title": "Favorite color?", "type": "MULTIPLE_CHOICE", "options": ["Red", "Blue", "Green"] },
  { "title": "Select all that apply", "type": "CHECKBOX", "options": ["A", "B", "C"] },
  { "title": "Rate 1-5", "type": "LINEAR_SCALE", "low": 1, "high": 5, "lowLabel": "Poor", "highLabel": "Excellent" },
  { "title": "Date of birth", "type": "DATE" }
]`,
  inputSchema: z.object({
    formId: z.string(),
    questions: z.array(z.object({
      title: z.string(),
      description: z.string().optional(),
      required: z.boolean().optional(),
      type: z.enum([
        'SHORT_TEXT', 'PARAGRAPH',
        'MULTIPLE_CHOICE', 'CHECKBOX', 'DROPDOWN',
        'LINEAR_SCALE', 'DATE', 'TIME',
        'CHECKBOX_GRID', 'MULTIPLE_CHOICE_GRID',
      ]),
      options: z.array(z.string()).optional().describe('Options for MULTIPLE_CHOICE, CHECKBOX, DROPDOWN'),
      low: z.number().optional().describe('Low end for LINEAR_SCALE (default 1)'),
      high: z.number().optional().describe('High end for LINEAR_SCALE (default 5)'),
      lowLabel: z.string().optional().describe('Label for low end'),
      highLabel: z.string().optional().describe('Label for high end'),
      rowLabels: z.array(z.string()).optional().describe('Row labels for grid questions'),
      columnLabels: z.array(z.string()).optional().describe('Column labels for grid questions'),
      includeYear: z.boolean().optional().describe('Include year in DATE questions'),
      includeTime: z.boolean().optional().describe('Include time in DATE questions'),
    })),
    insertAtIndex: z.number().optional().describe('0-based index to insert at (appends to end if omitted)'),
    profile: profileField,
  }),
  execute: async (inputData, context) => {
    const { formId, questions, insertAtIndex, profile } = inputData as any;
    const gate = await ensureConnectedAndScopes([FORMS_SCOPE], profile);
    if ((gate as any).ok !== true) return gate;

    const requests: any[] = [];

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const idx = typeof insertAtIndex === 'number' ? insertAtIndex + i : i;

      let questionItem: any = {};

      const buildChoiceQuestion = (type: string) => ({
        choiceQuestion: {
          type,
          options: (q.options || []).map((o: string) => ({ value: o })),
        },
      });

      switch (q.type) {
        case 'SHORT_TEXT':
          questionItem = { textQuestion: { paragraph: false } };
          break;
        case 'PARAGRAPH':
          questionItem = { textQuestion: { paragraph: true } };
          break;
        case 'MULTIPLE_CHOICE':
          questionItem = buildChoiceQuestion('RADIO');
          break;
        case 'CHECKBOX':
          questionItem = buildChoiceQuestion('CHECKBOX');
          break;
        case 'DROPDOWN':
          questionItem = buildChoiceQuestion('DROP_DOWN');
          break;
        case 'LINEAR_SCALE':
          questionItem = {
            scaleQuestion: {
              low: q.low ?? 1,
              high: q.high ?? 5,
              lowLabel: q.lowLabel || '',
              highLabel: q.highLabel || '',
            },
          };
          break;
        case 'DATE':
          questionItem = {
            dateQuestion: {
              includeYear: q.includeYear !== false,
              includeTime: q.includeTime === true,
            },
          };
          break;
        case 'TIME':
          questionItem = { timeQuestion: { duration: false } };
          break;
        case 'CHECKBOX_GRID':
        case 'MULTIPLE_CHOICE_GRID':
          questionItem = {
            rowQuestion: {
              title: q.title,
            },
            ...((q.type === 'CHECKBOX_GRID')
              ? { choiceQuestion: { type: 'CHECKBOX', options: (q.columnLabels || []).map((c: string) => ({ value: c })) } }
              : { choiceQuestion: { type: 'RADIO', options: (q.columnLabels || []).map((c: string) => ({ value: c })) } }),
          };
          // Grid questions use questionGroupItem instead of questionItem
          requests.push({
            createItem: {
              item: {
                title: q.title,
                description: q.description || undefined,
                questionGroupItem: {
                  grid: {
                    columns: {
                      type: q.type === 'CHECKBOX_GRID' ? 'CHECKBOX' : 'RADIO',
                      options: (q.columnLabels || []).map((c: string) => ({ value: c })),
                    },
                  },
                  questions: (q.rowLabels || []).map((r: string) => ({
                    required: q.required || false,
                    rowQuestion: { title: r },
                  })),
                },
              },
              location: { index: idx },
            },
          });
          continue; // skip the normal push below
      }

      requests.push({
        createItem: {
          item: {
            title: q.title,
            description: q.description || undefined,
            questionItem: {
              question: {
                required: q.required || false,
                ...questionItem,
              },
            },
          },
          location: { index: idx },
        },
      });
    }

    const data = await googleAuthorizedFetch(
      `https://forms.googleapis.com/v1/forms/${encodeURIComponent(formId)}:batchUpdate`,
      { method: 'POST', body: JSON.stringify({ requests }) },
      profile,
    );

    return { ok: true, questionsAdded: questions.length, replies: (data as any)?.replies?.length || 0 };
  },
});

export const forms_update_settings = createTool({
  id: 'forms_update_settings',
  description: 'Update Google Form settings: quiz mode, collect email, response limits, confirmation message, etc.',
  inputSchema: z.object({
    formId: z.string(),
    isQuiz: z.boolean().optional().describe('Enable quiz mode (allows point values and correct answers)'),
    collectEmail: z.boolean().optional().describe('Collect respondent email addresses'),
    limitOneResponsePerUser: z.boolean().optional().describe('Limit to one response per user'),
    confirmationMessage: z.string().optional().describe('Message shown after form submission'),
    profile: profileField,
  }),
  execute: async (inputData, context) => {
    const { formId, isQuiz, collectEmail, limitOneResponsePerUser, confirmationMessage, profile } = inputData as any;
    const gate = await ensureConnectedAndScopes([FORMS_SCOPE], profile);
    if ((gate as any).ok !== true) return gate;

    const requests: any[] = [];

    // Quiz mode
    if (typeof isQuiz === 'boolean') {
      requests.push({
        updateSettings: {
          settings: { quizSettings: { isQuiz } },
          updateMask: 'quizSettings.isQuiz',
        },
      });
    }

    // Form info updates (confirmation message)
    if (confirmationMessage) {
      requests.push({
        updateFormInfo: {
          info: { description: confirmationMessage },
          updateMask: 'description',
        },
      });
    }

    if (requests.length === 0) return { ok: true, message: 'No settings to update' };

    const data = await googleAuthorizedFetch(
      `https://forms.googleapis.com/v1/forms/${encodeURIComponent(formId)}:batchUpdate`,
      { method: 'POST', body: JSON.stringify({ requests }) },
      profile,
    );
    return { ok: true, updated: requests.length };
  },
});

export const forms_list_responses = createTool({
  id: 'forms_list_responses',
  description: 'List all responses to a Google Form. Returns each response with answers mapped to question IDs.',
  inputSchema: z.object({
    formId: z.string(),
    pageSize: z.number().int().min(1).max(5000).optional().describe('Max responses to return (default all)'),
    pageToken: z.string().optional(),
    filter: z.string().optional().describe('Filter expression, e.g. "timestamp >= 2024-01-01T00:00:00Z"'),
    profile: profileField,
  }),
  execute: async (inputData, context) => {
    const { formId, pageSize, pageToken, filter, profile } = inputData as any;
    const gate = await ensureConnectedAndScopes([FORMS_RESPONSES_SCOPE], profile);
    if ((gate as any).ok !== true) return gate;

    const params = new URLSearchParams();
    if (pageSize) params.set('pageSize', String(pageSize));
    if (pageToken) params.set('pageToken', pageToken);
    if (filter) params.set('filter', filter);

    const data = await googleAuthorizedFetch(
      `https://forms.googleapis.com/v1/forms/${encodeURIComponent(formId)}/responses?${params.toString()}`,
      undefined, profile,
    );

    const responses = Array.isArray((data as any)?.responses) ? (data as any).responses : [];
    return {
      responses,
      count: responses.length,
      nextPageToken: (data as any)?.nextPageToken || null,
    };
  },
});

export const forms_get_response = createTool({
  id: 'forms_get_response',
  description: 'Get a single form response by response ID.',
  inputSchema: z.object({
    formId: z.string(),
    responseId: z.string(),
    profile: profileField,
  }),
  execute: async (inputData, context) => {
    const { formId, responseId, profile } = inputData as any;
    const gate = await ensureConnectedAndScopes([FORMS_RESPONSES_SCOPE], profile);
    if ((gate as any).ok !== true) return gate;

    const data = await googleAuthorizedFetch(
      `https://forms.googleapis.com/v1/forms/${encodeURIComponent(formId)}/responses/${encodeURIComponent(responseId)}`,
      undefined, profile,
    );
    return { response: data };
  },
});

export const forms_get_responses_summary = createTool({
  id: 'forms_get_responses_summary',
  description: 'Get a summary of all form responses with question titles mapped to answers. More user-friendly than raw forms_list_responses.',
  inputSchema: z.object({
    formId: z.string(),
    maxResponses: z.number().int().min(1).max(1000).default(100),
    profile: profileField,
  }),
  execute: async (inputData, context) => {
    const { formId, maxResponses, profile } = inputData as any;
    const gate = await ensureConnectedAndScopes([FORMS_READONLY_SCOPE, FORMS_RESPONSES_SCOPE], profile);
    if ((gate as any).ok !== true) return gate;

    // Get the form structure to map question IDs to titles
    const formData = await googleAuthorizedFetch(
      `https://forms.googleapis.com/v1/forms/${encodeURIComponent(formId)}`,
      undefined, profile,
    );

    const questionMap: Record<string, string> = {};
    const items = Array.isArray((formData as any)?.items) ? (formData as any).items : [];
    for (const item of items) {
      if (item.questionItem?.question?.questionId) {
        questionMap[item.questionItem.question.questionId] = item.title || 'Untitled';
      }
      if (item.questionGroupItem?.questions) {
        for (const q of item.questionGroupItem.questions) {
          if (q.questionId) {
            questionMap[q.questionId] = `${item.title || 'Grid'} - ${q.rowQuestion?.title || 'Row'}`;
          }
        }
      }
    }

    // Get responses
    const params = new URLSearchParams();
    params.set('pageSize', String(maxResponses));
    const respData = await googleAuthorizedFetch(
      `https://forms.googleapis.com/v1/forms/${encodeURIComponent(formId)}/responses?${params.toString()}`,
      undefined, profile,
    );

    const responses = Array.isArray((respData as any)?.responses) ? (respData as any).responses : [];

    // Map responses to human-readable format
    const mapped = responses.map((r: any) => {
      const answers: Record<string, any> = {};
      const rawAnswers = r.answers || {};
      for (const [qId, answer] of Object.entries(rawAnswers)) {
        const questionTitle = questionMap[qId] || qId;
        const a = answer as any;
        if (a.textAnswers?.answers) {
          const vals = a.textAnswers.answers.map((v: any) => v.value);
          answers[questionTitle] = vals.length === 1 ? vals[0] : vals;
        } else if (a.fileUploadAnswers?.answers) {
          answers[questionTitle] = a.fileUploadAnswers.answers.map((f: any) => ({ fileId: f.fileId, filename: f.fileName, mimeType: f.mimeType }));
        } else {
          answers[questionTitle] = a;
        }
      }
      return {
        responseId: r.responseId,
        createTime: r.createTime,
        lastSubmittedTime: r.lastSubmittedTime,
        respondentEmail: r.respondentEmail || null,
        answers,
      };
    });

    return {
      formTitle: (formData as any)?.info?.title || '',
      totalResponses: mapped.length,
      responses: mapped,
      questionMap,
    };
  },
});

export const forms_delete_question = createTool({
  id: 'forms_delete_question',
  description: 'Delete a question/item from a Google Form by its index.',
  inputSchema: z.object({
    formId: z.string(),
    index: z.number().int().min(0).describe('0-based index of the item to delete. Use forms_get to see items.'),
    profile: profileField,
  }),
  execute: async (inputData, context) => {
    const { formId, index, profile } = inputData as any;
    const gate = await ensureConnectedAndScopes([FORMS_SCOPE], profile);
    if ((gate as any).ok !== true) return gate;

    // We need the item ID to delete it — get the form first
    const formData = await googleAuthorizedFetch(
      `https://forms.googleapis.com/v1/forms/${encodeURIComponent(formId)}`,
      undefined, profile,
    );

    const items = Array.isArray((formData as any)?.items) ? (formData as any).items : [];
    if (index >= items.length) return { ok: false, error: `Index ${index} out of range (form has ${items.length} items)` };

    const itemId = items[index]?.itemId;
    if (!itemId) return { ok: false, error: 'Could not find item ID' };

    const data = await googleAuthorizedFetch(
      `https://forms.googleapis.com/v1/forms/${encodeURIComponent(formId)}:batchUpdate`,
      {
        method: 'POST',
        body: JSON.stringify({
          requests: [{ deleteItem: { location: { index } } }],
        }),
      },
      profile,
    );
    return { ok: true, deletedIndex: index };
  },
});

export const forms_update_question = createTool({
  id: 'forms_update_question',
  description: 'Update an existing question in a Google Form: change title, description, options, or required flag.',
  inputSchema: z.object({
    formId: z.string(),
    index: z.number().int().min(0).describe('0-based index of the item to update'),
    title: z.string().optional(),
    description: z.string().optional(),
    required: z.boolean().optional(),
    options: z.array(z.string()).optional().describe('Replace options for choice-type questions'),
    profile: profileField,
  }),
  execute: async (inputData, context) => {
    const { formId, index, title, description, required, options, profile } = inputData as any;
    const gate = await ensureConnectedAndScopes([FORMS_SCOPE], profile);
    if ((gate as any).ok !== true) return gate;

    // Get the current form to know the item structure
    const formData = await googleAuthorizedFetch(
      `https://forms.googleapis.com/v1/forms/${encodeURIComponent(formId)}`,
      undefined, profile,
    );

    const items = Array.isArray((formData as any)?.items) ? (formData as any).items : [];
    if (index >= items.length) return { ok: false, error: `Index ${index} out of range (form has ${items.length} items)` };

    const currentItem = items[index];
    const requests: any[] = [];

    // Build update request
    const updatedItem: any = { ...currentItem };
    const updateMask: string[] = [];

    if (title !== undefined) {
      updatedItem.title = title;
      updateMask.push('title');
    }
    if (description !== undefined) {
      updatedItem.description = description;
      updateMask.push('description');
    }
    if (required !== undefined && updatedItem.questionItem?.question) {
      updatedItem.questionItem.question.required = required;
      updateMask.push('questionItem.question.required');
    }
    if (options && updatedItem.questionItem?.question?.choiceQuestion) {
      updatedItem.questionItem.question.choiceQuestion.options = options.map((o: string) => ({ value: o }));
      updateMask.push('questionItem.question.choiceQuestion.options');
    }

    if (updateMask.length === 0) return { ok: true, message: 'Nothing to update' };

    requests.push({
      updateItem: {
        item: updatedItem,
        location: { index },
        updateMask: updateMask.join(','),
      },
    });

    const data = await googleAuthorizedFetch(
      `https://forms.googleapis.com/v1/forms/${encodeURIComponent(formId)}:batchUpdate`,
      { method: 'POST', body: JSON.stringify({ requests }) },
      profile,
    );
    return { ok: true, updatedFields: updateMask };
  },
});
