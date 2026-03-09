import type { IncomingMessage, ServerResponse } from 'http';
import { randomBytes } from 'crypto';
import { upsertExternalAccount, getExternalAccount } from '../../supabase';
import { authenticateHttpLegacy, sendJson, sendAuthError } from '../../auth/http';
import { AuthErrorCode } from '../../auth';
import { WA_PHONE_NUMBER_ID, WA_ACCESS_TOKEN, WA_WEBHOOK_VERIFY_TOKEN } from '../../utils/config';

const WA_API = 'https://graph.facebook.com/v22.0';

export type WaMediaType = 'image' | 'audio' | 'video' | 'document' | 'sticker';

// ── Pending link codes ────────────────────────────────────────────────────────
// code -> { userId, expiresAt }
const pendingLinks = new Map<string, { userId: string; expiresAt: number }>();

function cleanExpiredLinks() {
  const now = Date.now();
  for (const [code, entry] of pendingLinks) {
    if (now > entry.expiresAt) pendingLinks.delete(code);
  }
}

// ── Cached bot display number ─────────────────────────────────────────────────
let cachedBotNumber: string | null = null;

async function getBotNumber(): Promise<string> {
  if (cachedBotNumber) return cachedBotNumber;
  if (!WA_PHONE_NUMBER_ID || !WA_ACCESS_TOKEN) return '';
  try {
    const res = await fetch(
      `${WA_API}/${WA_PHONE_NUMBER_ID}?fields=display_phone_number`,
      { headers: { 'Authorization': `Bearer ${WA_ACCESS_TOKEN}` } }
    );
    if (res.ok) {
      const j = await res.json() as any;
      const raw: string = j?.display_phone_number || '';
      // Normalize to E.164 digits only (for wa.me link)
      cachedBotNumber = raw.replace(/[^\d]/g, '');
    }
  } catch { /* ignore */ }
  return cachedBotNumber || '';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function waHeaders() {
  return {
    'Authorization': `Bearer ${WA_ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

function assertConfigured() {
  if (!WA_PHONE_NUMBER_ID || !WA_ACCESS_TOKEN) throw new Error('WhatsApp not configured on server.');
}

async function waPost(path: string, body: unknown): Promise<any> {
  assertConfigured();
  const res = await fetch(`${WA_API}/${WA_PHONE_NUMBER_ID}${path}`, {
    method: 'POST',
    headers: waHeaders(),
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json as any)?.error?.message || `WhatsApp API error (${res.status})`;
    throw new Error(msg);
  }
  return json;
}

// ── Message senders (exported for agent tools) ─────────────────────────────

export async function waSendTemplate(to: string, templateName = 'hello_world', langCode = 'en_US'): Promise<any> {
  return waPost('/messages', {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: { name: templateName, language: { code: langCode } },
  });
}

export async function waSendText(to: string, text: string, previewUrl = false): Promise<any> {
  return waPost('/messages', {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: text.slice(0, 4096), preview_url: previewUrl },
  });
}

export async function waSendMedia(
  to: string,
  type: WaMediaType,
  opts: { link?: string; id?: string; caption?: string; filename?: string }
): Promise<any> {
  const mediaBody: Record<string, any> = {};
  if (opts.link) mediaBody.link = opts.link;
  if (opts.id) mediaBody.id = opts.id;
  if (opts.caption) mediaBody.caption = opts.caption.slice(0, 1024);
  if (opts.filename && (type === 'document' || type === 'audio')) mediaBody.filename = opts.filename;

  return waPost('/messages', {
    messaging_product: 'whatsapp',
    to,
    type,
    [type]: mediaBody,
  });
}

export async function waSendReaction(to: string, messageId: string, emoji: string): Promise<any> {
  return waPost('/messages', {
    messaging_product: 'whatsapp',
    to,
    type: 'reaction',
    reaction: { message_id: messageId, emoji },
  });
}

export async function waMarkRead(messageId: string): Promise<any> {
  return waPost('/messages', {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: messageId,
  });
}

export async function waUploadMediaFromUrl(mediaUrl: string, mimeType: string): Promise<string> {
  assertConfigured();
  const fileRes = await fetch(mediaUrl);
  if (!fileRes.ok) throw new Error(`Failed to fetch media from URL (${fileRes.status})`);
  const buffer = Buffer.from(await fileRes.arrayBuffer());
  const filename = mediaUrl.split('/').pop()?.split('?')[0] || 'file';

  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mimeType);
  form.append('file', new Blob([buffer], { type: mimeType }), filename);

  const uploadRes = await fetch(`${WA_API}/${WA_PHONE_NUMBER_ID}/media`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${WA_ACCESS_TOKEN}` },
    body: form,
  });
  const uploadJson = await uploadRes.json().catch(() => ({}));
  if (!uploadRes.ok) {
    throw new Error((uploadJson as any)?.error?.message || `Media upload failed (${uploadRes.status})`);
  }
  return String((uploadJson as any).id);
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function handleWhatsAppRoutes(req: IncomingMessage, res: ServerResponse, parsedUrl: URL): Promise<boolean> {
  const { pathname } = parsedUrl;

  if (!pathname.startsWith('/integrations/whatsapp')) return false;

  // ── Status ────────────────────────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/integrations/whatsapp/status') {
    const auth = await authenticateHttpLegacy(req, parsedUrl);
    if (!auth.success || !auth.userId) {
      sendAuthError(res, auth.error || AuthErrorCode.UNAUTHORIZED, auth.message);
      return true;
    }
    const acc = await getExternalAccount(auth.userId, 'whatsapp');
    const meta = acc?.meta || {};
    sendJson(res, 200, {
      ok: true,
      connected: !!meta.connected,
      phone: meta.connected ? meta.phone : undefined,
    });
    return true;
  }

  // ── Connect: user enters their number, we send hello_world + store ──────────
  if (req.method === 'POST' && pathname === '/integrations/whatsapp/connect') {
    const auth = await authenticateHttpLegacy(req, parsedUrl);
    if (!auth.success || !auth.userId) {
      sendAuthError(res, auth.error || AuthErrorCode.UNAUTHORIZED, auth.message);
      return true;
    }
    if (!WA_PHONE_NUMBER_ID || !WA_ACCESS_TOKEN) {
      sendJson(res, 503, { ok: false, error: 'WhatsApp integration is not configured on the server.' });
      return true;
    }
    try {
      const body = JSON.parse(await readBody(req));
      const raw = String(body.phone || '').replace(/[^\d+]/g, '');
      const phone = raw.startsWith('+') ? raw.slice(1) : raw;
      if (!phone || phone.length < 7) {
        sendJson(res, 400, { ok: false, error: 'Invalid phone number. Include country code (e.g. +1...).' });
        return true;
      }
      await waSendTemplate(phone);
      const formatted = `+${phone}`;
      await upsertExternalAccount({
        userId: auth.userId,
        provider: 'whatsapp',
        access_token: 'connected',
        scopes: ['messaging'],
        meta: { phone: formatted, waId: phone, connected: true, connectedAt: new Date().toISOString() },
      });
      sendJson(res, 200, { ok: true, phone: formatted });
    } catch (e: any) {
      sendJson(res, 500, { ok: false, error: String(e?.message || e) });
    }
    return true;
  }

  // ── Initiate link: generate a code the user sends via WhatsApp ────────────
  if (req.method === 'POST' && pathname === '/integrations/whatsapp/initiate-link') {
    const auth = await authenticateHttpLegacy(req, parsedUrl);
    if (!auth.success || !auth.userId) {
      sendAuthError(res, auth.error || AuthErrorCode.UNAUTHORIZED, auth.message);
      return true;
    }
    if (!WA_PHONE_NUMBER_ID || !WA_ACCESS_TOKEN) {
      sendJson(res, 503, { ok: false, error: 'WhatsApp integration is not configured on the server.' });
      return true;
    }
    cleanExpiredLinks();
    // Remove any existing pending link for this user
    for (const [code, entry] of pendingLinks) {
      if (entry.userId === auth.userId) pendingLinks.delete(code);
    }
    // Generate a short, readable code: LINK-XXXXXX
    const code = 'LINK-' + randomBytes(3).toString('hex').toUpperCase();
    pendingLinks.set(code, { userId: auth.userId, expiresAt: Date.now() + 15 * 60 * 1000 });

    const botNumber = await getBotNumber();
    sendJson(res, 200, { ok: true, code, botNumber });
    return true;
  }

  // ── Meta Webhook Verification (GET) ──────────────────────────────────────
  if (req.method === 'GET' && pathname === '/integrations/whatsapp/webhook') {
    const mode = parsedUrl.searchParams.get('hub.mode');
    const token = parsedUrl.searchParams.get('hub.verify_token');
    const challenge = parsedUrl.searchParams.get('hub.challenge');

    if (mode === 'subscribe' && token === WA_WEBHOOK_VERIFY_TOKEN && challenge) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(challenge);
    } else {
      res.writeHead(403);
      res.end('Forbidden');
    }
    return true;
  }

  // ── Meta Webhook Events (POST) ────────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/integrations/whatsapp/webhook') {
    try {
      const body = JSON.parse(await readBody(req));
      const entry = body?.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;

      // Process incoming messages
      const messages: any[] = value?.messages || [];
      for (const msg of messages) {
        const from: string = msg?.from || '';       // sender's WhatsApp number (E.164 without +)
        const msgType: string = msg?.type || '';
        const msgId: string = msg?.id || '';

        // Extract text body
        let text = '';
        if (msgType === 'text') {
          text = String(msg?.text?.body || '').trim().toUpperCase();
        }

        // Check if this is a link code message
        if (text && pendingLinks.has(text)) {
          const linkEntry = pendingLinks.get(text)!;
          if (Date.now() <= linkEntry.expiresAt) {
            // Link the account
            const formattedPhone = `+${from}`;
            await upsertExternalAccount({
              userId: linkEntry.userId,
              provider: 'whatsapp',
              access_token: 'connected',
              scopes: ['messaging'],
              meta: {
                phone: formattedPhone,
                waId: from,
                connected: true,
                connectedAt: new Date().toISOString(),
              },
            });
            pendingLinks.delete(text);
            // Send a confirmation message back to the user
            try {
              await waSendText(from, '✅ Your WhatsApp is now linked to Stuard! You\'ll receive notifications and messages here.');
            } catch { /* best-effort */ }
            // Mark the linking message as read
            try { await waMarkRead(msgId); } catch { /* best-effort */ }
          }
        }
      }
    } catch (e: any) {
      console.error('[whatsapp] Webhook processing error:', e?.message || e);
    }
    // Always respond 200 to Meta
    sendJson(res, 200, { ok: true });
    return true;
  }

  // ── Disconnect ────────────────────────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/integrations/whatsapp/disconnect') {
    const auth = await authenticateHttpLegacy(req, parsedUrl);
    if (!auth.success || !auth.userId) {
      sendAuthError(res, auth.error || AuthErrorCode.UNAUTHORIZED, auth.message);
      return true;
    }
    try {
      const { deleteExternalAccount } = await import('../../supabase');
      await deleteExternalAccount(auth.userId, 'whatsapp', 'default');
      sendJson(res, 200, { ok: true });
    } catch (e: any) {
      sendJson(res, 500, { ok: false, error: String(e?.message || e) });
    }
    return true;
  }

  // ── Send text (proactive / agent) ─────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/integrations/whatsapp/send') {
    const auth = await authenticateHttpLegacy(req, parsedUrl);
    if (!auth.success || !auth.userId) {
      sendAuthError(res, auth.error || AuthErrorCode.UNAUTHORIZED, auth.message);
      return true;
    }
    if (!WA_PHONE_NUMBER_ID || !WA_ACCESS_TOKEN) {
      sendJson(res, 503, { ok: false, error: 'WhatsApp not configured.' });
      return true;
    }
    try {
      const reqBody = JSON.parse(await readBody(req));
      const acc = await getExternalAccount(auth.userId, 'whatsapp');
      const meta = acc?.meta || {};
      if (!meta.connected || !meta.waId) {
        sendJson(res, 400, { ok: false, error: 'No connected WhatsApp number.' });
        return true;
      }
      const result = await waSendText(meta.waId, String(reqBody.message || ''), !!reqBody.previewUrl);
      sendJson(res, 200, { ok: true, messageId: result?.messages?.[0]?.id });
    } catch (e: any) {
      sendJson(res, 500, { ok: false, error: String(e?.message || e) });
    }
    return true;
  }

  // ── Send media ────────────────────────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/integrations/whatsapp/send-media') {
    const auth = await authenticateHttpLegacy(req, parsedUrl);
    if (!auth.success || !auth.userId) {
      sendAuthError(res, auth.error || AuthErrorCode.UNAUTHORIZED, auth.message);
      return true;
    }
    if (!WA_PHONE_NUMBER_ID || !WA_ACCESS_TOKEN) {
      sendJson(res, 503, { ok: false, error: 'WhatsApp not configured.' });
      return true;
    }
    try {
      const reqBody = JSON.parse(await readBody(req));
      const acc = await getExternalAccount(auth.userId, 'whatsapp');
      const meta = acc?.meta || {};
      if (!meta.connected || !meta.waId) {
        sendJson(res, 400, { ok: false, error: 'No connected WhatsApp number.' });
        return true;
      }
      const type = (reqBody.type || 'image') as WaMediaType;
      if (!['image', 'audio', 'video', 'document', 'sticker'].includes(type)) {
        sendJson(res, 400, { ok: false, error: 'Invalid media type.' });
        return true;
      }
      const result = await waSendMedia(meta.waId, type, {
        link: reqBody.link,
        id: reqBody.id,
        caption: reqBody.caption,
        filename: reqBody.filename,
      });
      sendJson(res, 200, { ok: true, messageId: result?.messages?.[0]?.id });
    } catch (e: any) {
      sendJson(res, 500, { ok: false, error: String(e?.message || e) });
    }
    return true;
  }

  // ── Send reaction ─────────────────────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/integrations/whatsapp/react') {
    const auth = await authenticateHttpLegacy(req, parsedUrl);
    if (!auth.success || !auth.userId) {
      sendAuthError(res, auth.error || AuthErrorCode.UNAUTHORIZED, auth.message);
      return true;
    }
    if (!WA_PHONE_NUMBER_ID || !WA_ACCESS_TOKEN) {
      sendJson(res, 503, { ok: false, error: 'WhatsApp not configured.' });
      return true;
    }
    try {
      const reqBody = JSON.parse(await readBody(req));
      const acc = await getExternalAccount(auth.userId, 'whatsapp');
      const meta = acc?.meta || {};
      if (!meta.connected || !meta.waId) {
        sendJson(res, 400, { ok: false, error: 'No connected WhatsApp number.' });
        return true;
      }
      if (!reqBody.messageId || !reqBody.emoji) {
        sendJson(res, 400, { ok: false, error: 'messageId and emoji are required.' });
        return true;
      }
      await waSendReaction(meta.waId, reqBody.messageId, reqBody.emoji);
      sendJson(res, 200, { ok: true });
    } catch (e: any) {
      sendJson(res, 500, { ok: false, error: String(e?.message || e) });
    }
    return true;
  }

  // ── Mark message as read ──────────────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/integrations/whatsapp/mark-read') {
    const auth = await authenticateHttpLegacy(req, parsedUrl);
    if (!auth.success || !auth.userId) {
      sendAuthError(res, auth.error || AuthErrorCode.UNAUTHORIZED, auth.message);
      return true;
    }
    if (!WA_PHONE_NUMBER_ID || !WA_ACCESS_TOKEN) {
      sendJson(res, 503, { ok: false, error: 'WhatsApp not configured.' });
      return true;
    }
    try {
      const reqBody = JSON.parse(await readBody(req));
      if (!reqBody.messageId) {
        sendJson(res, 400, { ok: false, error: 'messageId is required.' });
        return true;
      }
      await waMarkRead(reqBody.messageId);
      sendJson(res, 200, { ok: true });
    } catch (e: any) {
      sendJson(res, 500, { ok: false, error: String(e?.message || e) });
    }
    return true;
  }

  return false;
}
