import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getExternalAccessToken } from '../supabase';
import { getBridgeSecrets } from './bridge';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

async function graphFetch(path: string, accessToken: string, init?: RequestInit) {
  const url = path.startsWith('http') ? path : `${GRAPH_BASE}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    ...(init?.headers as any),
  };
  const res = await fetch(url, { ...init, headers });
  let body: any = null;
  try { body = await res.json(); } catch {}
  if (!res.ok) {
    const msg = body?.error?.message || `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  return body;
}

async function requireOutlookToken(): Promise<string> {
  const secrets = getBridgeSecrets();
  const userId = String((secrets as any)?.userId || '');
  if (!userId) throw new Error('missing_user_context');
  const token = await getExternalAccessToken(userId, 'outlook');
  if (!token) throw new Error('outlook_not_connected');
  return token;
}

export const outlook_get_me = createTool({
  id: 'outlook_get_me',
  description: 'Get current user profile from Microsoft Graph (/me). Requires User.Read scope.',
  inputSchema: z.object({}),
  execute: async () => {
    const accessToken = await requireOutlookToken();
    const me = await graphFetch('/me', accessToken);
    return { me };
  },
});

export const outlook_list_messages = createTool({
  id: 'outlook_list_messages',
  description: 'List recent messages from Inbox (or specified folder). Requires Mail.Read scope.',
  inputSchema: z.object({
    folder: z.string().default('Inbox'),
    top: z.number().int().min(1).max(50).default(10),
    select: z.array(z.string()).optional(),
  }),
  execute: async ({ context }) => {
    const accessToken = await requireOutlookToken();
    const { folder, top, select } = context as { folder?: string; top?: number; select?: string[] };
    const sel = Array.isArray(select) && select.length ? `$select=${select.join(',')}` : '';
    const query = [`$top=${Math.max(1, Math.min(50, Number(top || 10)))}`, `$orderby=receivedDateTime desc`, sel].filter(Boolean).join('&');
    const path = folder && folder !== 'Inbox'
      ? `/me/mailFolders/${encodeURIComponent(folder)}/messages?${query}`
      : `/me/mailFolders/Inbox/messages?${query}`;
    const data = await graphFetch(path, accessToken, { headers: { Prefer: 'outlook.body-content-type="text"' } });
    const items = Array.isArray((data as any)?.value) ? (data as any).value : [];
    return { items, count: items.length };
  },
});

export const outlook_search_messages = createTool({
  id: 'outlook_search_messages',
  description: 'Search messages with Graph $search. Requires Mail.Read scope. Use simple keywords (from:, subject:, body:).',
  inputSchema: z.object({
    query: z.string(),
    top: z.number().int().min(1).max(25).default(10),
  }),
  execute: async ({ context }) => {
    const accessToken = await requireOutlookToken();
    const { query, top } = context as { query: string; top?: number };
    const params = new URLSearchParams();
    params.set('$search', `"${query}"`);
    params.set('$top', String(Math.max(1, Math.min(25, Number(top || 10)))));
    const path = `/me/messages?${params.toString()}`;
    const data = await graphFetch(path, accessToken, {
      headers: {
        Prefer: 'outlook.body-content-type="text"',
        'Consistency-Level': 'eventual',
      },
    });
    const items = Array.isArray((data as any)?.value) ? (data as any).value : [];
    return { items, count: items.length };
  },
});

export const outlook_send_mail = createTool({
  id: 'outlook_send_mail',
  description: 'Send an email via Microsoft Graph. Requires Mail.Send or Mail.ReadWrite scope.',
  inputSchema: z.object({
    to: z.array(z.string().email()).min(1),
    subject: z.string().min(1),
    body: z.string().min(1),
    contentType: z.enum(['Text', 'HTML']).default('Text'),
  }),
  execute: async ({ context }) => {
    const accessToken = await requireOutlookToken();
    const { to, subject, body, contentType } = context as { to: string[]; subject: string; body: string; contentType: 'Text' | 'HTML' };
    const payload = {
      message: {
        subject,
        body: { contentType, content: body },
        toRecipients: to.map((addr) => ({ emailAddress: { address: addr } })),
      },
      saveToSentItems: true,
    };
    await graphFetch('/me/sendMail', accessToken, { method: 'POST', body: JSON.stringify(payload) });
    return { ok: true };
  },
});
