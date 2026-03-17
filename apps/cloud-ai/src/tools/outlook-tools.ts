import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getExternalAccessToken } from '../supabase';
import { getBridgeSecrets } from './bridge';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

// Optional profile field for all Outlook tools. Omit to use the default profile.
const profileField = z.string().optional().describe(
  'OAuth profile label to use (e.g. "work", "personal"). Omit to use the default profile.'
);

function resolveProfile(explicit?: string): string | undefined {
  if (explicit) return explicit;
  try {
    const secrets = getBridgeSecrets();
    return (secrets as any)?.outlookProfile || (secrets as any)?.profile || undefined;
  } catch { return undefined; }
}

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

/** Like graphFetch but returns raw Buffer (for attachment downloads). */
async function graphFetchBinary(path: string, accessToken: string): Promise<Buffer> {
  const url = path.startsWith('http') ? path : `${GRAPH_BASE}${path}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    let errBody: any = null;
    try { errBody = await res.json(); } catch {}
    const msg = errBody?.error?.message || `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function requireOutlookToken(profileLabel?: string): Promise<string> {
  const secrets = getBridgeSecrets();
  const userId = String((secrets as any)?.userId || '');
  if (!userId) throw new Error('missing_user_context');
  const profile = resolveProfile(profileLabel);
  const token = await getExternalAccessToken(userId, 'outlook', profile);
  if (!token) throw new Error('outlook_not_connected');
  return token;
}

// ─── MIME type helper ───
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
    webp: 'image/webp', svg: 'image/svg+xml',
    mp3: 'audio/mpeg', wav: 'audio/wav', mp4: 'video/mp4',
    zip: 'application/zip', txt: 'text/plain', csv: 'text/csv',
    json: 'application/json', xml: 'application/xml', html: 'text/html',
  };
  return m[ext] || 'application/octet-stream';
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROFILE
// ═══════════════════════════════════════════════════════════════════════════════

export const outlook_get_me = createTool({
  id: 'outlook_get_me',
  description: 'Get current user profile from Microsoft Graph (/me). Requires User.Read scope.',
  inputSchema: z.object({ profile: profileField }),
  execute: async (inputData) => {
    const { profile } = inputData as any;
    const accessToken = await requireOutlookToken(profile);
    const me = await graphFetch('/me', accessToken);
    return { me };
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// MAIL – LIST / SEARCH / READ
// ═══════════════════════════════════════════════════════════════════════════════

export const outlook_list_messages = createTool({
  id: 'outlook_list_messages',
  description: 'List recent messages from Inbox (or specified folder). Requires Mail.Read scope.',
  inputSchema: z.object({
    profile: profileField,
    folder: z.string().default('Inbox'),
    top: z.number().int().min(1).max(50).default(10),
    select: z.array(z.string()).optional(),
  }),
  execute: async (inputData) => {
    const { profile, folder, top, select } = inputData as any;
    const accessToken = await requireOutlookToken(profile);
    const sel = Array.isArray(select) && select.length ? `$select=${select.join(',')}` : '';
    const query = [`$top=${Math.max(1, Math.min(50, Number(top || 10)))}`, `$orderby=receivedDateTime desc`, sel].filter(Boolean).join('&');
    const path = folder && folder !== 'Inbox'
      ? `/me/mailFolders/${encodeURIComponent(folder)}/messages?${query}`
      : `/me/mailFolders/Inbox/messages?${query}`;
    const data = await graphFetch(path, accessToken, { headers: { Prefer: 'outlook.body-content-type="text"' } });
    const items = Array.isArray(data?.value) ? data.value : [];
    return { items, count: items.length };
  },
});

export const outlook_search_messages = createTool({
  id: 'outlook_search_messages',
  description: 'Search messages with Graph $search. Requires Mail.Read scope. Use simple keywords (from:, subject:, body:).',
  inputSchema: z.object({
    profile: profileField,
    query: z.string(),
    top: z.number().int().min(1).max(25).default(10),
  }),
  execute: async (inputData) => {
    const { profile, query, top } = inputData as any;
    const accessToken = await requireOutlookToken(profile);
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
    const items = Array.isArray(data?.value) ? data.value : [];
    return { items, count: items.length };
  },
});

export const outlook_get_message = createTool({
  id: 'outlook_get_message',
  description: 'Get a single Outlook message by ID with full body content and attachment metadata. Requires Mail.Read scope.',
  inputSchema: z.object({
    id: z.string().min(1).describe('The message ID'),
    profile: profileField,
  }),
  execute: async (inputData) => {
    const { id, profile } = inputData as any;
    const accessToken = await requireOutlookToken(profile);
    const data = await graphFetch(
      `/me/messages/${encodeURIComponent(id)}?$expand=attachments`,
      accessToken,
      { headers: { Prefer: 'outlook.body-content-type="text"' } },
    );
    const attachments = Array.isArray(data?.attachments)
      ? data.attachments.map((a: any) => ({
          id: a.id,
          name: a.name,
          contentType: a.contentType,
          size: a.size,
          isInline: a.isInline || false,
        }))
      : [];
    return {
      message: {
        id: data.id,
        conversationId: data.conversationId,
        subject: data.subject,
        from: data.from?.emailAddress,
        toRecipients: data.toRecipients?.map((r: any) => r.emailAddress),
        ccRecipients: data.ccRecipients?.map((r: any) => r.emailAddress),
        receivedDateTime: data.receivedDateTime,
        isRead: data.isRead,
        body: data.body?.content,
        bodyPreview: data.bodyPreview,
        hasAttachments: data.hasAttachments,
        attachments,
      },
    };
  },
});

export const outlook_list_recent_brief = createTool({
  id: 'outlook_list_recent_brief',
  description: 'List the most recent Outlook messages with brief info (from, subject, date, snippet). Requires Mail.Read scope.',
  inputSchema: z.object({
    maxResults: z.number().int().min(1).max(25).default(5),
    profile: profileField,
  }),
  execute: async (inputData) => {
    const { maxResults, profile } = inputData as any;
    const accessToken = await requireOutlookToken(profile);
    const n = Math.max(1, Math.min(25, Number(maxResults || 5)));
    const data = await graphFetch(
      `/me/mailFolders/Inbox/messages?$top=${n}&$orderby=receivedDateTime desc&$select=id,subject,from,receivedDateTime,bodyPreview,isRead`,
      accessToken,
    );
    const items = Array.isArray(data?.value) ? data.value.map((m: any) => ({
      id: m.id,
      from: m.from?.emailAddress,
      subject: m.subject,
      date: m.receivedDateTime,
      snippet: m.bodyPreview,
      isRead: m.isRead,
    })) : [];
    return { items, count: items.length };
  },
});

export const outlook_list_folders = createTool({
  id: 'outlook_list_folders',
  description: 'List mail folders (Inbox, Sent Items, Drafts, Archive, etc.). Requires Mail.Read scope.',
  inputSchema: z.object({ profile: profileField }),
  execute: async (inputData) => {
    const { profile } = inputData as any;
    const accessToken = await requireOutlookToken(profile);
    const data = await graphFetch('/me/mailFolders?$top=50', accessToken);
    const folders = Array.isArray(data?.value) ? data.value.map((f: any) => ({
      id: f.id,
      displayName: f.displayName,
      totalItemCount: f.totalItemCount,
      unreadItemCount: f.unreadItemCount,
    })) : [];
    return { folders, count: folders.length };
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// MAIL – SEND / REPLY / FORWARD
// ═══════════════════════════════════════════════════════════════════════════════

export const outlook_send_mail = createTool({
  id: 'outlook_send_mail',
  description: 'Send an email via Microsoft Graph with optional cc/bcc and file attachments. Requires Mail.Send scope.',
  inputSchema: z.object({
    profile: profileField,
    to: z.array(z.string().email()).min(1),
    subject: z.string().min(1),
    body: z.string().min(1),
    contentType: z.enum(['Text', 'HTML']).default('Text'),
    cc: z.array(z.string().email()).optional(),
    bcc: z.array(z.string().email()).optional(),
    attachments: z.array(z.object({
      path: z.string().describe('Local file path to attach'),
      filename: z.string().optional().describe('Override filename in email'),
    })).optional().describe('Files to attach to the email'),
  }),
  execute: async (inputData) => {
    const { profile, to, subject, body, contentType, cc, bcc, attachments } = inputData as any;
    const accessToken = await requireOutlookToken(profile);

    const message: any = {
      subject,
      body: { contentType, content: body },
      toRecipients: to.map((addr: string) => ({ emailAddress: { address: addr } })),
    };
    if (cc?.length) message.ccRecipients = cc.map((addr: string) => ({ emailAddress: { address: addr } }));
    if (bcc?.length) message.bccRecipients = bcc.map((addr: string) => ({ emailAddress: { address: addr } }));

    // Handle attachments
    const attachmentList = Array.isArray(attachments) ? attachments : [];
    let attachmentsIncluded = 0;
    const attachmentErrors: string[] = [];

    if (attachmentList.length > 0) {
      const { execLocalTool, hasClientBridge } = await import('./bridge');
      if (!hasClientBridge()) {
        attachmentErrors.push('No client bridge available to read local files');
      } else {
        message.attachments = [];
        for (const att of attachmentList) {
          const filePath = String(att.path || '');
          if (!filePath) continue;
          const pathParts = filePath.replace(/\\/g, '/').split('/');
          const filename = att.filename || pathParts[pathParts.length - 1] || 'attachment';
          try {
            const result = await execLocalTool('read_file_base64', { path: filePath }, undefined, 30000, { silent: true });
            if (result?.ok && result?.data) {
              message.attachments.push({
                '@odata.type': '#microsoft.graph.fileAttachment',
                name: filename,
                contentType: guessMimeType(filename),
                contentBytes: result.data,
              });
              attachmentsIncluded++;
            } else {
              attachmentErrors.push(`${filename}: ${result?.error || 'no data returned'}`);
            }
          } catch (e: any) {
            attachmentErrors.push(`${filename}: ${e?.message || String(e)}`);
          }
        }
      }
    }

    await graphFetch('/me/sendMail', accessToken, {
      method: 'POST',
      body: JSON.stringify({ message, saveToSentItems: true }),
    });

    const result: any = { ok: true, attachmentsRequested: attachmentList.length, attachmentsIncluded };
    if (attachmentErrors.length > 0) result.attachmentErrors = attachmentErrors;
    return result;
  },
});

export const outlook_reply_message = createTool({
  id: 'outlook_reply_message',
  description: 'Reply to an Outlook message. Set replyAll to true to reply to all recipients. Requires Mail.ReadWrite scope.',
  inputSchema: z.object({
    id: z.string().min(1).describe('The message ID to reply to'),
    comment: z.string().min(1).describe('The reply body text'),
    contentType: z.enum(['Text', 'HTML']).default('Text'),
    replyAll: z.boolean().default(false).describe('Reply to all recipients'),
    profile: profileField,
  }),
  execute: async (inputData) => {
    const { id, comment, contentType, replyAll, profile } = inputData as any;
    const accessToken = await requireOutlookToken(profile);
    const endpoint = replyAll
      ? `/me/messages/${encodeURIComponent(id)}/replyAll`
      : `/me/messages/${encodeURIComponent(id)}/reply`;
    await graphFetch(endpoint, accessToken, {
      method: 'POST',
      body: JSON.stringify({
        message: { body: { contentType: contentType || 'Text', content: comment } },
        comment,
      }),
    });
    return { ok: true };
  },
});

export const outlook_forward_message = createTool({
  id: 'outlook_forward_message',
  description: 'Forward an Outlook message to other recipients. Requires Mail.ReadWrite scope.',
  inputSchema: z.object({
    id: z.string().min(1).describe('The message ID to forward'),
    to: z.array(z.string().email()).min(1),
    comment: z.string().optional().describe('Optional text to add above the forwarded message'),
    profile: profileField,
  }),
  execute: async (inputData) => {
    const { id, to, comment, profile } = inputData as any;
    const accessToken = await requireOutlookToken(profile);
    await graphFetch(`/me/messages/${encodeURIComponent(id)}/forward`, accessToken, {
      method: 'POST',
      body: JSON.stringify({
        toRecipients: to.map((addr: string) => ({ emailAddress: { address: addr } })),
        comment: comment || '',
      }),
    });
    return { ok: true };
  },
});

export const outlook_create_draft = createTool({
  id: 'outlook_create_draft',
  description: 'Create a draft message in Outlook. Requires Mail.ReadWrite scope.',
  inputSchema: z.object({
    to: z.array(z.string().email()).min(1),
    subject: z.string().min(1),
    body: z.string().min(1),
    contentType: z.enum(['Text', 'HTML']).default('Text'),
    cc: z.array(z.string().email()).optional(),
    bcc: z.array(z.string().email()).optional(),
    profile: profileField,
  }),
  execute: async (inputData) => {
    const { to, subject, body, contentType, cc, bcc, profile } = inputData as any;
    const accessToken = await requireOutlookToken(profile);
    const message: any = {
      subject,
      body: { contentType, content: body },
      toRecipients: to.map((addr: string) => ({ emailAddress: { address: addr } })),
    };
    if (cc?.length) message.ccRecipients = cc.map((addr: string) => ({ emailAddress: { address: addr } }));
    if (bcc?.length) message.bccRecipients = bcc.map((addr: string) => ({ emailAddress: { address: addr } }));
    const data = await graphFetch('/me/messages', accessToken, {
      method: 'POST',
      body: JSON.stringify(message),
    });
    return { ok: true, draft: { id: data.id, subject: data.subject } };
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// MAIL – MODIFY / DELETE / MOVE
// ═══════════════════════════════════════════════════════════════════════════════

export const outlook_mark_as_read = createTool({
  id: 'outlook_mark_as_read',
  description: 'Mark an Outlook message as read. Requires Mail.ReadWrite scope.',
  inputSchema: z.object({
    id: z.string().min(1),
    profile: profileField,
  }),
  execute: async (inputData) => {
    const { id, profile } = inputData as any;
    const accessToken = await requireOutlookToken(profile);
    await graphFetch(`/me/messages/${encodeURIComponent(id)}`, accessToken, {
      method: 'PATCH',
      body: JSON.stringify({ isRead: true }),
    });
    return { ok: true };
  },
});

export const outlook_mark_as_unread = createTool({
  id: 'outlook_mark_as_unread',
  description: 'Mark an Outlook message as unread. Requires Mail.ReadWrite scope.',
  inputSchema: z.object({
    id: z.string().min(1),
    profile: profileField,
  }),
  execute: async (inputData) => {
    const { id, profile } = inputData as any;
    const accessToken = await requireOutlookToken(profile);
    await graphFetch(`/me/messages/${encodeURIComponent(id)}`, accessToken, {
      method: 'PATCH',
      body: JSON.stringify({ isRead: false }),
    });
    return { ok: true };
  },
});

export const outlook_archive_message = createTool({
  id: 'outlook_archive_message',
  description: 'Move an Outlook message to the Archive folder. Requires Mail.ReadWrite scope.',
  inputSchema: z.object({
    id: z.string().min(1),
    profile: profileField,
  }),
  execute: async (inputData) => {
    const { id, profile } = inputData as any;
    const accessToken = await requireOutlookToken(profile);
    // Get the Archive folder ID
    const folders = await graphFetch('/me/mailFolders?$filter=displayName eq \'Archive\'', accessToken);
    const archiveFolder = Array.isArray(folders?.value) && folders.value.length > 0 ? folders.value[0] : null;
    if (!archiveFolder) throw new Error('Archive folder not found');
    const data = await graphFetch(`/me/messages/${encodeURIComponent(id)}/move`, accessToken, {
      method: 'POST',
      body: JSON.stringify({ destinationId: archiveFolder.id }),
    });
    return { ok: true, newId: data.id };
  },
});

export const outlook_move_message = createTool({
  id: 'outlook_move_message',
  description: 'Move an Outlook message to a different folder. Requires Mail.ReadWrite scope. Use outlook_list_folders to get folder IDs.',
  inputSchema: z.object({
    id: z.string().min(1).describe('The message ID'),
    destinationId: z.string().min(1).describe('Target folder ID (use outlook_list_folders to find IDs)'),
    profile: profileField,
  }),
  execute: async (inputData) => {
    const { id, destinationId, profile } = inputData as any;
    const accessToken = await requireOutlookToken(profile);
    const data = await graphFetch(`/me/messages/${encodeURIComponent(id)}/move`, accessToken, {
      method: 'POST',
      body: JSON.stringify({ destinationId }),
    });
    return { ok: true, newId: data.id };
  },
});

export const outlook_delete_message = createTool({
  id: 'outlook_delete_message',
  description: 'Delete an Outlook message permanently. Requires Mail.ReadWrite scope.',
  inputSchema: z.object({
    id: z.string().min(1),
    profile: profileField,
  }),
  execute: async (inputData) => {
    const { id, profile } = inputData as any;
    const accessToken = await requireOutlookToken(profile);
    await graphFetch(`/me/messages/${encodeURIComponent(id)}`, accessToken, { method: 'DELETE' });
    return { ok: true };
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// MAIL – ATTACHMENTS
// ═══════════════════════════════════════════════════════════════════════════════

export const outlook_download_attachment = createTool({
  id: 'outlook_download_attachment',
  description: 'Download an Outlook message attachment to a local file. Requires Mail.Read scope.',
  inputSchema: z.object({
    messageId: z.string().min(1),
    attachmentId: z.string().min(1),
    path: z.string().describe('Local path to save the file to'),
    profile: profileField,
  }),
  execute: async (inputData) => {
    const { messageId, attachmentId, path, profile } = inputData as any;
    const accessToken = await requireOutlookToken(profile);

    const data = await graphFetch(
      `/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
      accessToken,
    );

    if (!data?.contentBytes) throw new Error('No content in attachment');

    const { execLocalTool, hasClientBridge } = await import('./bridge');
    if (!hasClientBridge()) return { ok: false, error: 'No client bridge available to save file locally' };

    const res = await execLocalTool('write_file_base64', { path, content: data.contentBytes }, undefined, 60000, { silent: true });
    if (!res?.ok) return { ok: false, error: res?.error || 'Failed to write file' };

    return { ok: true, path, name: data.name, size: data.size };
  },
});

export const outlook_retrieve_messages_with_attachments = createTool({
  id: 'outlook_retrieve_messages_with_attachments',
  description: 'Retrieve Outlook messages with optional attachment download. Supports search filtering and automatic download to a local folder.',
  inputSchema: z.object({
    query: z.string().optional().describe('Search query (from:, subject:, body:, hasAttachments:true)'),
    folder: z.string().default('Inbox'),
    maxResults: z.number().int().min(1).max(50).default(10),
    downloadAttachments: z.boolean().default(false).describe('Whether to download attachments to local disk'),
    downloadPath: z.string().optional().describe('Local folder path to save attachments (required if downloadAttachments is true)'),
    filterAttachmentTypes: z.array(z.string()).optional().describe('Filter by MIME types (e.g. ["application/pdf", "image/*"])'),
    maxAttachmentSize: z.number().optional().describe('Max attachment size in MB to download'),
    profile: profileField,
  }),
  execute: async (inputData) => {
    const { query, folder, maxResults, downloadAttachments, downloadPath, filterAttachmentTypes, maxAttachmentSize, profile } = inputData as any;
    const accessToken = await requireOutlookToken(profile);

    // Step 1: List messages
    const n = Math.max(1, Math.min(50, Number(maxResults || 10)));
    let path: string;
    if (query) {
      const params = new URLSearchParams();
      params.set('$search', `"${query}"`);
      params.set('$top', String(n));
      path = `/me/messages?${params.toString()}`;
    } else {
      const f = folder && folder !== 'Inbox' ? folder : 'Inbox';
      path = `/me/mailFolders/${encodeURIComponent(f)}/messages?$top=${n}&$orderby=receivedDateTime desc`;
    }

    const listData = await graphFetch(path, accessToken, {
      headers: { Prefer: 'outlook.body-content-type="text"', 'Consistency-Level': 'eventual' },
    });
    const messages = Array.isArray(listData?.value) ? listData.value : [];
    if (messages.length === 0) return { messages: [], count: 0, attachmentsDownloaded: 0 };

    const { execLocalTool, hasClientBridge } = await import('./bridge');
    const hasBridge = hasClientBridge();

    // Step 2: Get full details + attachments for each message
    const results: any[] = [];
    let totalAttachmentsDownloaded = 0;

    for (const msgRef of messages) {
      try {
        const msgId = String(msgRef.id);
        const data = await graphFetch(
          `/me/messages/${encodeURIComponent(msgId)}?$expand=attachments`,
          accessToken,
          { headers: { Prefer: 'outlook.body-content-type="text"' } },
        );

        const attachments = Array.isArray(data?.attachments) ? data.attachments : [];
        const messageData: any = {
          id: data.id,
          conversationId: data.conversationId,
          subject: data.subject,
          from: data.from?.emailAddress,
          toRecipients: data.toRecipients?.map((r: any) => r.emailAddress),
          receivedDateTime: data.receivedDateTime,
          isRead: data.isRead,
          bodyPreview: data.bodyPreview,
          body: data.body?.content,
          hasAttachments: data.hasAttachments,
          attachments: attachments.map((a: any) => ({
            id: a.id,
            name: a.name,
            contentType: a.contentType,
            size: a.size,
            isInline: a.isInline || false,
          })),
        };

        // Step 3: Download attachments if requested
        if (downloadAttachments && hasBridge && downloadPath && attachments.length > 0) {
          const downloaded: any[] = [];
          for (const att of attachments) {
            if (att.isInline) continue;
            // MIME type filter
            if (filterAttachmentTypes?.length) {
              const matches = filterAttachmentTypes.some((type: string) => {
                if (type.endsWith('/*')) return att.contentType?.startsWith(type.replace('/*', '/'));
                return att.contentType === type;
              });
              if (!matches) continue;
            }
            // Size filter
            const sizeMB = (att.size || 0) / (1024 * 1024);
            if (maxAttachmentSize && sizeMB > maxAttachmentSize) {
              downloaded.push({ filename: att.name, skipped: true, reason: `Size ${sizeMB.toFixed(2)}MB exceeds limit` });
              continue;
            }
            try {
              if (!att.contentBytes) {
                // Need to fetch individually
                const attData = await graphFetch(
                  `/me/messages/${encodeURIComponent(msgId)}/attachments/${encodeURIComponent(att.id)}`,
                  accessToken,
                );
                att.contentBytes = attData?.contentBytes;
              }
              if (att.contentBytes) {
                const safeFilename = (att.name || 'attachment').replace(/[<>:"/\\|?*]/g, '_');
                const filePath = `${downloadPath.replace(/\\/g, '/').replace(/\/$/, '')}/${safeFilename}`;
                const writeRes = await execLocalTool('write_file_base64', { path: filePath, content: att.contentBytes }, undefined, 60000, { silent: true });
                if (writeRes?.ok) {
                  downloaded.push({ filename: att.name, localPath: filePath, size: att.size, contentType: att.contentType });
                  totalAttachmentsDownloaded++;
                } else {
                  downloaded.push({ filename: att.name, error: writeRes?.error || 'Failed to write' });
                }
              }
            } catch (err: any) {
              downloaded.push({ filename: att.name, error: err?.message || 'Download failed' });
            }
          }
          messageData.downloadedAttachments = downloaded;
        } else if (downloadAttachments && !hasBridge) {
          messageData.downloadWarning = 'No client bridge available; attachments metadata only';
        }

        results.push(messageData);
      } catch (err) {
        console.error(`[outlook_retrieve_messages_with_attachments] Failed to process message:`, err);
      }
    }

    return { messages: results, count: results.length, attachmentsDownloaded: totalAttachmentsDownloaded };
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// CALENDAR
// ═══════════════════════════════════════════════════════════════════════════════

export const outlook_calendar_list_events = createTool({
  id: 'outlook_calendar_list_events',
  description: 'List events from Outlook Calendar. Requires Calendars.Read or Calendars.ReadWrite scope.',
  inputSchema: z.object({
    calendarId: z.string().optional().describe('Calendar ID. Omit for the default calendar.'),
    timeMin: z.string().optional().describe('Start of time range (ISO 8601)'),
    timeMax: z.string().optional().describe('End of time range (ISO 8601)'),
    maxResults: z.number().int().min(1).max(100).default(10),
    orderBy: z.enum(['start/dateTime', 'start/dateTime desc']).optional().default('start/dateTime'),
    profile: profileField,
  }),
  execute: async (inputData) => {
    const { calendarId, timeMin, timeMax, maxResults, orderBy, profile } = inputData as any;
    const accessToken = await requireOutlookToken(profile);

    // Use calendarView for time-range queries (expands recurrences), plain events otherwise
    const calBase = calendarId ? `/me/calendars/${encodeURIComponent(calendarId)}` : '/me';
    const n = Math.max(1, Math.min(100, Number(maxResults || 10)));

    let path: string;
    if (timeMin && timeMax) {
      // calendarView automatically expands recurring events
      const params = new URLSearchParams();
      params.set('startDateTime', timeMin);
      params.set('endDateTime', timeMax);
      params.set('$top', String(n));
      params.set('$orderby', orderBy || 'start/dateTime');
      path = `${calBase}/calendarView?${params.toString()}`;
    } else {
      const params = new URLSearchParams();
      params.set('$top', String(n));
      params.set('$orderby', orderBy || 'start/dateTime');
      if (timeMin) params.set('$filter', `start/dateTime ge '${timeMin}'`);
      path = `${calBase}/events?${params.toString()}`;
    }

    const data = await graphFetch(path, accessToken, {
      headers: { Prefer: `outlook.timezone="UTC", outlook.body-content-type="text"` },
    });
    const items = Array.isArray(data?.value) ? data.value.map((e: any) => ({
      id: e.id,
      subject: e.subject,
      start: e.start,
      end: e.end,
      location: e.location?.displayName,
      isAllDay: e.isAllDay,
      organizer: e.organizer?.emailAddress,
      attendees: e.attendees?.map((a: any) => ({
        email: a.emailAddress?.address,
        name: a.emailAddress?.name,
        status: a.status?.response,
      })),
      bodyPreview: e.bodyPreview,
      webLink: e.webLink,
      recurrence: e.recurrence,
      isCancelled: e.isCancelled,
    })) : [];
    return { items, count: items.length };
  },
});

export const outlook_calendar_create_event = createTool({
  id: 'outlook_calendar_create_event',
  description: 'Create an Outlook Calendar event. Supports date-time and all-day events, attendees, recurrence. Requires Calendars.ReadWrite scope.',
  inputSchema: z.object({
    calendarId: z.string().optional().describe('Calendar ID. Omit for default calendar.'),
    subject: z.string().min(1),
    body: z.string().optional(),
    contentType: z.enum(['Text', 'HTML']).default('Text'),
    location: z.string().optional(),
    start: z.string().describe('ISO 8601 date-time or date (YYYY-MM-DD) for all-day'),
    end: z.string().describe('ISO 8601 date-time or date (YYYY-MM-DD) for all-day'),
    timeZone: z.string().optional().default('UTC'),
    isAllDay: z.boolean().optional(),
    attendees: z.array(z.object({
      email: z.string().email(),
      name: z.string().optional(),
      type: z.enum(['required', 'optional', 'resource']).optional().default('required'),
    })).optional(),
    recurrence: z.object({
      pattern: z.object({
        type: z.enum(['daily', 'weekly', 'absoluteMonthly', 'relativeMonthly', 'absoluteYearly', 'relativeYearly']),
        interval: z.number().int().min(1).default(1),
        daysOfWeek: z.array(z.enum(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'])).optional(),
        dayOfMonth: z.number().int().optional(),
        month: z.number().int().optional(),
      }),
      range: z.object({
        type: z.enum(['endDate', 'noEnd', 'numbered']),
        startDate: z.string().describe('YYYY-MM-DD'),
        endDate: z.string().optional().describe('YYYY-MM-DD (for endDate type)'),
        numberOfOccurrences: z.number().int().optional().describe('For numbered type'),
      }),
    }).optional().describe('Recurrence pattern for repeating events'),
    reminderMinutesBefore: z.number().int().min(0).optional(),
    profile: profileField,
  }),
  execute: async (inputData) => {
    const { calendarId, subject, body: bodyText, contentType, location, start, end, timeZone, isAllDay, attendees, recurrence, reminderMinutesBefore, profile } = inputData as any;
    const accessToken = await requireOutlookToken(profile);

    const isDateOnly = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
    const allDay = isAllDay || (isDateOnly(start) && isDateOnly(end));
    const tz = timeZone || 'UTC';

    const event: any = {
      subject,
      start: allDay ? { dateTime: `${start}T00:00:00`, timeZone: tz } : { dateTime: start, timeZone: tz },
      end: allDay ? { dateTime: `${end}T00:00:00`, timeZone: tz } : { dateTime: end, timeZone: tz },
      isAllDay: allDay,
    };
    if (bodyText) event.body = { contentType: contentType || 'Text', content: bodyText };
    if (location) event.location = { displayName: location };
    if (Array.isArray(attendees) && attendees.length > 0) {
      event.attendees = attendees.map((a: any) => ({
        emailAddress: { address: a.email, name: a.name || undefined },
        type: a.type || 'required',
      }));
    }
    if (recurrence) event.recurrence = recurrence;
    if (typeof reminderMinutesBefore === 'number') {
      event.isReminderOn = true;
      event.reminderMinutesBeforeStart = reminderMinutesBefore;
    }

    const calBase = calendarId ? `/me/calendars/${encodeURIComponent(calendarId)}` : '/me';
    const data = await graphFetch(`${calBase}/events`, accessToken, {
      method: 'POST',
      body: JSON.stringify(event),
    });
    return { event: { id: data.id, subject: data.subject, start: data.start, end: data.end, webLink: data.webLink } };
  },
});

export const outlook_calendar_update_event = createTool({
  id: 'outlook_calendar_update_event',
  description: 'Update an existing Outlook Calendar event. Only provided fields are changed. Requires Calendars.ReadWrite scope.',
  inputSchema: z.object({
    eventId: z.string().min(1),
    subject: z.string().optional(),
    body: z.string().optional(),
    contentType: z.enum(['Text', 'HTML']).optional(),
    location: z.string().optional(),
    start: z.string().optional().describe('ISO 8601 date-time'),
    end: z.string().optional().describe('ISO 8601 date-time'),
    timeZone: z.string().optional(),
    isAllDay: z.boolean().optional(),
    attendees: z.array(z.object({
      email: z.string().email(),
      name: z.string().optional(),
      type: z.enum(['required', 'optional', 'resource']).optional(),
    })).optional(),
    reminderMinutesBefore: z.number().int().min(0).optional(),
    profile: profileField,
  }),
  execute: async (inputData) => {
    const { eventId, subject, body: bodyText, contentType, location, start, end, timeZone, isAllDay, attendees, reminderMinutesBefore, profile } = inputData as any;
    const accessToken = await requireOutlookToken(profile);
    const tz = timeZone || 'UTC';

    const patch: any = {};
    if (subject !== undefined) patch.subject = subject;
    if (bodyText !== undefined) patch.body = { contentType: contentType || 'Text', content: bodyText };
    if (location !== undefined) patch.location = { displayName: location };
    if (start !== undefined) patch.start = { dateTime: start, timeZone: tz };
    if (end !== undefined) patch.end = { dateTime: end, timeZone: tz };
    if (isAllDay !== undefined) patch.isAllDay = isAllDay;
    if (Array.isArray(attendees)) {
      patch.attendees = attendees.map((a: any) => ({
        emailAddress: { address: a.email, name: a.name || undefined },
        type: a.type || 'required',
      }));
    }
    if (typeof reminderMinutesBefore === 'number') {
      patch.isReminderOn = true;
      patch.reminderMinutesBeforeStart = reminderMinutesBefore;
    }

    const data = await graphFetch(`/me/events/${encodeURIComponent(eventId)}`, accessToken, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    return { ok: true, event: { id: data.id, subject: data.subject, start: data.start, end: data.end, webLink: data.webLink } };
  },
});

export const outlook_calendar_delete_event = createTool({
  id: 'outlook_calendar_delete_event',
  description: 'Delete an Outlook Calendar event. Requires Calendars.ReadWrite scope.',
  inputSchema: z.object({
    eventId: z.string().min(1),
    profile: profileField,
  }),
  execute: async (inputData) => {
    const { eventId, profile } = inputData as any;
    const accessToken = await requireOutlookToken(profile);
    await graphFetch(`/me/events/${encodeURIComponent(eventId)}`, accessToken, { method: 'DELETE' });
    return { ok: true, eventId };
  },
});
