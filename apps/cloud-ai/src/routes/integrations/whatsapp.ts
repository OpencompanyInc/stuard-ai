import type { IncomingMessage, ServerResponse } from 'http';
import { randomBytes, createHmac, timingSafeEqual } from 'crypto';
import {
  upsertExternalAccount,
  getExternalAccount,
  findUserIdByWhatsApp,
  enqueueSmsInboxItem,
  getSmsUserState,
  upsertSmsUserState,
  getCloudEngine,
  getSmsQueueItem,
  markSmsQueueReplySent,
  debitCredits,
  createConversation,
  addUserMessage,
  addAssistantMessage,
  finishRun,
  setConversationTitle,
} from '../../supabase';
import { authenticateHttpLegacy, sendJson, sendAuthError } from '../../auth/http';
import { AuthErrorCode } from '../../auth';
import { WA_PHONE_NUMBER_ID, WA_ACCESS_TOKEN, WA_WEBHOOK_VERIFY_TOKEN, META_APP_SECRET } from '../../utils/config';
import { stripMarkdownForSms } from '../sms-utils';
import { sendVMCommand } from '../../services/vm-command';
import { messagingCreditCost } from '../../pricing';
import { MediaProcessor, fromWhatsApp } from '../../media';
import { runServerlessAgent } from '../serverless-agent';
import { getOrCreateQueryEmbedding } from '../../utils/shared-embedding';

const WA_API = 'https://graph.facebook.com/v22.0';

export type WaMediaType = 'image' | 'audio' | 'video' | 'document' | 'sticker';

// ── Inbound message dedup (prevents double-processing on Meta webhook retries) ──
// Meta uses at-least-once delivery. If our response takes too long, it retries.
// We track recent message IDs so the second delivery is a no-op.
const _recentMsgIds = new Set<string>();
function _markMsgProcessed(id: string): void {
  _recentMsgIds.add(id);
  setTimeout(() => _recentMsgIds.delete(id), 120_000); // forget after 2 min
}
function _isMsgDuplicate(id: string): boolean {
  return _recentMsgIds.has(id);
}

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

export async function waGetMediaUrl(mediaId: string): Promise<{ url: string; mimeType: string; sha256?: string; fileSize?: number }> {
  assertConfigured();
  const res = await fetch(`${WA_API}/${mediaId}`, {
    headers: { 'Authorization': `Bearer ${WA_ACCESS_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Failed to get media info (${res.status})`);
  const data = await res.json() as any;
  return { url: data.url, mimeType: data.mime_type, sha256: data.sha256, fileSize: data.file_size };
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
      const rawBody = await readBody(req);

      // Verify HMAC-SHA256 signature so forged payloads can't trigger agent
      // runs or burn credits. Meta signs every POST with META_APP_SECRET.
      if (META_APP_SECRET) {
        const sigHeader = String(req.headers['x-hub-signature-256'] || '');
        const expected = 'sha256=' + createHmac('sha256', META_APP_SECRET).update(rawBody).digest('hex');
        let valid = false;
        try {
          const a = Buffer.from(sigHeader);
          const b = Buffer.from(expected);
          valid = a.length === b.length && timingSafeEqual(a, b);
        } catch { valid = false; }
        if (!valid) {
          console.warn('[whatsapp] webhook signature mismatch — dropping');
          sendJson(res, 401, { ok: false, error: 'invalid_signature' });
          return true;
        }
      }

      const body = JSON.parse(rawBody);
      const entry = body?.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;

      // Process incoming messages
      const messages: any[] = value?.messages || [];
      for (const msg of messages) {
        const from: string = msg?.from || '';       // sender's WhatsApp number (E.164 without +)
        const msgType: string = msg?.type || '';
        const msgId: string = msg?.id || '';

        // Dedup: skip if we've already processed this message (Meta webhook retry)
        if (msgId && _isMsgDuplicate(msgId)) {
          console.log('[whatsapp] skipping duplicate message', { msgId, from });
          continue;
        }
        if (msgId) _markMsgProcessed(msgId);

        // Extract text body or build a description for media messages
        let text = '';
        let mediaId: string | undefined;
        let mediaMimeType: string | undefined;
        let mediaCaption: string | undefined;

        if (msgType === 'text') {
          text = String(msg?.text?.body || '').trim();
        } else if (msgType === 'image') {
          mediaId = String(msg?.image?.id || '');
          mediaMimeType = String(msg?.image?.mime_type || 'image/jpeg');
          mediaCaption = msg?.image?.caption ? String(msg.image.caption) : undefined;
          // Use caption as the text (the actual image will be attached separately)
          text = mediaCaption || '[Image received]';
        } else if (msgType === 'audio') {
          mediaId = String(msg?.audio?.id || '');
          mediaMimeType = String(msg?.audio?.mime_type || 'audio/ogg');
          text = '[Voice note received]';
        } else if (msgType === 'video') {
          mediaId = String(msg?.video?.id || '');
          mediaMimeType = String(msg?.video?.mime_type || 'video/mp4');
          mediaCaption = msg?.video?.caption ? String(msg.video.caption) : undefined;
          text = mediaCaption || '[Video received]';
        } else if (msgType === 'document') {
          mediaId = String(msg?.document?.id || '');
          mediaMimeType = String(msg?.document?.mime_type || 'application/octet-stream');
          const docName = msg?.document?.filename ? String(msg.document.filename) : 'document';
          text = `[Document received: ${docName}]`;
        } else if (msgType === 'sticker') {
          mediaId = String(msg?.sticker?.id || '');
          text = '[Sticker received]';
        }

        // ── Process media through unified MediaProcessor ─────────────
        let mediaAttachments: any[] = [];
        let mediaSuppText = '';
        if (mediaId) {
          try {
            const inbound = fromWhatsApp(
              mediaId,
              mediaMimeType || 'application/octet-stream',
              mediaCaption,
              msgType === 'document' ? (msg?.document?.filename || undefined) : undefined,
            );
            const result = await MediaProcessor.process(inbound);
            mediaAttachments = result.attachments;
            mediaSuppText = result.supplementaryText;
            // Build text: caption + any supplementary text (transcriptions, etc.)
            // For images/videos: text is already the caption from above
            // For audio: supplementary text contains the transcription
            if (mediaSuppText) {
              text = [mediaCaption || '', mediaSuppText].filter(Boolean).join('\n') || text;
            }
          } catch (e: any) {
            console.error('[whatsapp] MediaProcessor failed:', e?.message);
          }
        }

        if (!from || !text) continue;

        // Mark message as read
        try { await waMarkRead(msgId); } catch { /* best-effort */ }

        // Check if this is a link code message (case-insensitive)
        const textUpper = text.toUpperCase();
        if (pendingLinks.has(textUpper)) {
          const linkEntry = pendingLinks.get(textUpper)!;
          if (Date.now() <= linkEntry.expiresAt) {
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
            pendingLinks.delete(textUpper);
            try {
              await waSendText(from, '✅ Your WhatsApp is now linked to Stuard! You\'ll receive notifications and messages here.');
            } catch { /* best-effort */ }
            continue; // link code handled, skip normal processing
          }
        }

        // ── Regular incoming message: route to agent ────────────────────────
        const userId = await findUserIdByWhatsApp(from);
        if (!userId) {
          console.warn('[whatsapp] inbound message did not match a connected user', {
            from,
            textPreview: text.slice(0, 80),
          });
          continue;
        }

        console.log('[whatsapp] inbound message matched user', {
          from,
          userId,
          textPreview: text.slice(0, 80),
        });

        // ── Handle slash commands ──────────────────────────────────────────
        const trimmedLower = text.toLowerCase().trim();
        if (trimmedLower.startsWith('/')) {
          const slashHandled = await handleWaSlashCommand(userId, from, trimmedLower);
          if (slashHandled) continue;
        }

        // ── Route based on user's agent_target setting ─────────────────────
        const [smsState, engine] = await Promise.all([
          getSmsUserState(userId),
          getCloudEngine(userId),
        ]);
        const target = smsState.agent_target;
        const vmRunning = !!(engine && engine.status === 'running');

        let effectiveTarget: 'vm' | 'cloud' | 'desktop' = 'desktop';
        if (target === 'vm') {
          effectiveTarget = vmRunning ? 'vm' : 'cloud';
        } else if (target === 'cloud') {
          effectiveTarget = 'cloud';
        } else if (target === 'auto') {
          effectiveTarget = vmRunning ? 'vm' : 'cloud';
        }

        console.log('[whatsapp] message routing decision', {
          userId, configuredTarget: target, vmRunning, effectiveTarget,
        });

        let handled = false;

        if (effectiveTarget === 'vm') {
          try {
            // Generate embedding in cloud-ai so the VM can run similarity
            // search against its synced SQLite memory DB — mirrors the SMS
            // path so WhatsApp has the same memory context as website chats.
            let queryEmbedding: number[] | undefined;
            try {
              queryEmbedding = await getOrCreateQueryEmbedding(text);
            } catch {
              // Non-fatal: VM will still work with recent-segments fallback
            }

            // Persist conversation in Supabase (same as Telnyx VM route)
            let waConvId = smsState.conversation_id || null;
            let waConvCreatedNow = false;
            if (!waConvId) {
              waConvId = await createConversation(userId, text, smsState.preferred_model || 'fast', {
                mode: smsState.preferred_model || 'fast',
              }, 'stuard', true);
              if (waConvId) waConvCreatedNow = true;
            } else {
              await addUserMessage(userId, waConvId, text, {
                mode: smsState.preferred_model || 'fast',
              }, true);
            }

            const vmResult = await sendVMCommand(userId, 'agent_chat', {
              message: text,
              conversationId: waConvId || undefined,
              model: smsState.preferred_model || 'fast',
              context: { source: 'whatsapp', fromWaId: from },
              memoryQuery: text,
              ...(queryEmbedding ? { queryEmbedding } : {}),
              ...(mediaAttachments.length > 0 ? { attachments: mediaAttachments } : {}),
            }, 60_000);

            if (vmResult.ok && vmResult.result?.text) {
              const vmResponseText = String(vmResult.result.text);
              const replyText = stripMarkdownForSms(vmResponseText).slice(0, 4096);
              await waSendText(from, replyText).catch((e: any) => {
                console.error('[whatsapp] Failed to send VM agent reply:', e?.message);
              });
              await deductWhatsAppCredit(userId);
              handled = true;

              const vmConvId = vmResult.result?.conversationId || waConvId;
              if (vmConvId) {
                await addAssistantMessage(userId, vmConvId, vmResponseText, {
                  mode: smsState.preferred_model || 'fast',
                }, true);
                try { await finishRun(userId, vmConvId, vmResponseText); } catch { }
                if (waConvCreatedNow) {
                  try { await setConversationTitle(userId, vmConvId, text.slice(0, 80), true); } catch { }
                }
              }
              if (vmConvId && vmConvId !== smsState.conversation_id) {
                await upsertSmsUserState({ userId, conversationId: vmConvId });
              }

              console.log('[whatsapp] message routed to VM', { userId, conversationId: vmConvId, responseLen: replyText.length });
            }
          } catch {
            // VM call failed — fall through to cloud
          }
        }

        // ── Cloud serverless handler for WhatsApp ──────────────────────
        if (!handled && (effectiveTarget === 'cloud' || (effectiveTarget === 'vm' && !vmRunning))) {
          try {
            const cloudResult = await runServerlessAgent({
              userId,
              message: text,
              conversationId: smsState.conversation_id,
              model: smsState.preferred_model || 'fast',
              source: 'whatsapp',
              attachments: mediaAttachments.length > 0 ? mediaAttachments : undefined,
            });

            if (cloudResult.ok && cloudResult.text) {
              const replyText = stripMarkdownForSms(cloudResult.text).slice(0, 4096);
              await waSendText(from, replyText).catch((e: any) => {
                console.error('[whatsapp] Failed to send cloud agent reply:', e?.message);
              });
              await deductWhatsAppCredit(userId);
              handled = true;

              if (cloudResult.conversationId && cloudResult.conversationId !== smsState.conversation_id) {
                await upsertSmsUserState({ userId, conversationId: cloudResult.conversationId });
              }

              console.log('[whatsapp] message routed to cloud', { userId, conversationId: cloudResult.conversationId, responseLen: replyText.length });
            }
          } catch (e: any) {
            console.error('[whatsapp] Cloud agent failed:', e?.message);
          }
        }

        // Desktop fallback (or primary desktop target)
        if (!handled) {
          if (target === 'vm' && !vmRunning) {
            await waSendText(from,
              'Your Cloud VM is not running. Text /cloud to use cloud mode, or /auto for automatic routing.'
            ).catch(() => {});
            await deductWhatsAppCredit(userId);
          } else if (effectiveTarget === 'desktop' || target === 'desktop') {
            const queued = await enqueueSmsInboxItem({
              userId,
              provider: 'whatsapp',
              providerMessageId: msgId || null,
              fromPhone: `+${from}`,
              replyToPhone: `+${from}`,
              messageText: text,
              conversationId: smsState.conversation_id,
              metadata: {
                waId: from,
                msgType,
                ...(mediaAttachments.length > 0 ? { processedAttachments: mediaAttachments } : {}),
                ...(mediaCaption ? { mediaCaption } : {}),
                receivedAt: new Date().toISOString(),
              },
            });
            if (!queued) {
              console.warn('[whatsapp] inbound message could not be queued', {
                from,
                userId,
                textPreview: text.slice(0, 80),
              });
            }
          }
        }
      }

      // ── Inbound calls (WhatsApp Business Calling API) ────────────────────
      // We don't accept the call (no audio bridge yet); we let it ring out and
      // send a fallback text so the caller gets an immediate response.
      const incomingCalls: any[] = value?.calls || [];
      for (const call of incomingCalls) {
        const callEvent: string = call?.event || '';
        const callId: string = call?.id || '';
        const callFrom: string = call?.from || '';
        const callDirection: string = call?.direction || '';

        const dedupKey = `call:${callId}:${callEvent}`;
        if (callId && _isMsgDuplicate(dedupKey)) {
          console.log('[whatsapp] skipping duplicate call event', { callId, event: callEvent });
          continue;
        }
        if (callId) _markMsgProcessed(dedupKey);

        console.log('[whatsapp] call event', {
          event: callEvent,
          callId: callId.slice(0, 24),
          from: callFrom,
          direction: callDirection,
        });

        // Only react to user-initiated connect events
        if (callEvent !== 'connect' || !callFrom) continue;

        const callUserId = await findUserIdByWhatsApp(callFrom);
        if (!callUserId) {
          console.warn('[whatsapp] inbound call from unlinked number', { from: callFrom });
          continue;
        }

        try {
          await waSendText(
            callFrom,
            "Sorry, I can't take voice calls here yet — but I'm right here over text. " +
            "Send your message and I'll reply right away."
          );
          await deductWhatsAppCredit(callUserId);
        } catch (e: any) {
          console.error('[whatsapp] call-fallback text failed:', e?.message);
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

  // ── Desktop-owned WhatsApp reply submission ─────────────────────────────
  if (req.method === 'POST' && pathname === '/integrations/whatsapp/wa-reply') {
    const auth = await authenticateHttpLegacy(req, parsedUrl);
    if (!auth.success || !auth.userId) {
      sendAuthError(res, auth.error || AuthErrorCode.UNAUTHORIZED, auth.message);
      return true;
    }
    try {
      const body = JSON.parse(await readBody(req));
      const queueItemId = String(body?.queueItemId || '').trim();
      const replyText = stripMarkdownForSms(String(body?.replyText || '').trim()).slice(0, 4096);
      const stateMode = body?.mode;
      const preferredModel = body?.preferredModel;
      const conversationId = typeof body?.conversationId === 'string' ? body.conversationId.trim() || null : undefined;
      const resumeConversationId = typeof body?.resumeConversationId === 'string' ? body.resumeConversationId.trim() || null : undefined;
      if (!queueItemId || !replyText) {
        sendJson(res, 400, { ok: false, error: 'queueItemId and replyText are required.' });
        return true;
      }

      const queueItem = await getSmsQueueItem(queueItemId);
      if (!queueItem || queueItem.user_id !== auth.userId) {
        sendJson(res, 404, { ok: false, error: 'sms_queue_item_not_found' });
        return true;
      }
      // Extract waId from metadata or from_phone
      const waId = String(
        (queueItem.metadata as any)?.waId ||
        (queueItem.from_phone || '').replace(/^\+/, '')
      );
      if (!waId) {
        sendJson(res, 400, { ok: false, error: 'wa_id_missing' });
        return true;
      }
      if (queueItem.reply_sent_at) {
        sendJson(res, 200, { ok: true, duplicate: true });
        return true;
      }

      await waSendText(waId, replyText);
      await deductWhatsAppCredit(auth.userId);
      await markSmsQueueReplySent(queueItemId).catch(() => false);
      await upsertSmsUserState({
        userId: auth.userId,
        mode: stateMode,
        preferredModel,
        conversationId,
        resumeConversationId,
        proactiveMessage: stateMode === 'agent' ? null : undefined,
      }).catch(() => false);
      sendJson(res, 200, { ok: true });
    } catch (e: any) {
      sendJson(res, 500, { ok: false, error: String(e?.message || e) });
    }
    return true;
  }

  // ── Outbound WhatsApp notification (tool permission prompts, etc.) ──────
  if (req.method === 'POST' && pathname === '/integrations/whatsapp/wa-notify') {
    const auth = await authenticateHttpLegacy(req, parsedUrl);
    if (!auth.success || !auth.userId) {
      sendAuthError(res, auth.error || AuthErrorCode.UNAUTHORIZED, auth.message);
      return true;
    }
    try {
      const body = JSON.parse(await readBody(req));
      const waId = String(body?.waId || body?.to || '').replace(/^\+/, '').trim();
      const text = stripMarkdownForSms(String(body?.text || '').trim()).slice(0, 4096);
      if (!waId || !text) {
        sendJson(res, 400, { ok: false, error: 'waId (or to) and text are required.' });
        return true;
      }
      await waSendText(waId, text);
      await deductWhatsAppCredit(auth.userId);
      sendJson(res, 200, { ok: true });
    } catch (e: any) {
      sendJson(res, 500, { ok: false, error: String(e?.message || e) });
    }
    return true;
  }

  // ── WhatsApp Settings: get/set agent routing target ─────────────────────
  if (req.method === 'GET' && pathname === '/integrations/whatsapp/wa-settings') {
    const auth = await authenticateHttpLegacy(req, parsedUrl);
    if (!auth.success || !auth.userId) {
      sendAuthError(res, auth.error || AuthErrorCode.UNAUTHORIZED, auth.message);
      return true;
    }
    try {
      const [state, engine] = await Promise.all([
        getSmsUserState(auth.userId),
        getCloudEngine(auth.userId),
      ]);
      sendJson(res, 200, {
        ok: true,
        agentTarget: state.agent_target,
        mode: state.mode,
        preferredModel: state.preferred_model,
        vmAvailable: !!(engine && engine.status === 'running'),
      });
    } catch (e: any) {
      sendJson(res, 500, { ok: false, error: String(e?.message || e) });
    }
    return true;
  }

  if (req.method === 'POST' && pathname === '/integrations/whatsapp/wa-settings') {
    const auth = await authenticateHttpLegacy(req, parsedUrl);
    if (!auth.success || !auth.userId) {
      sendAuthError(res, auth.error || AuthErrorCode.UNAUTHORIZED, auth.message);
      return true;
    }
    try {
      const body = JSON.parse(await readBody(req));
      const updates: Parameters<typeof upsertSmsUserState>[0] = { userId: auth.userId };
      if (body.agentTarget !== undefined) updates.agentTarget = body.agentTarget;
      if (body.mode !== undefined) updates.mode = body.mode;
      if (body.preferredModel !== undefined) updates.preferredModel = body.preferredModel;
      await upsertSmsUserState(updates);
      const state = await getSmsUserState(auth.userId);
      sendJson(res, 200, {
        ok: true,
        agentTarget: state.agent_target,
        mode: state.mode,
        preferredModel: state.preferred_model,
      });
    } catch (e: any) {
      sendJson(res, 500, { ok: false, error: String(e?.message || e) });
    }
    return true;
  }

  return false;
}

// ── WhatsApp Slash Command Handler ────────────────────────────────────────────

const WA_HELP_TEXT =
  'Stuard WhatsApp Commands:\n' +
  '/vm - Route messages to Cloud VM agent\n' +
  '/desktop - Route messages to desktop agent\n' +
  '/cloud - Route messages to cloud (no VM needed)\n' +
  '/auto - Auto-detect best agent (default)\n' +
  '/status - Show current routing & VM status\n' +
  '/model <fast|balanced|smart> - Set AI model\n' +
  '/agent - Switch to agent mode\n' +
  '/proactive - Switch to proactive mode\n' +
  '/new - Start a new conversation\n' +
  '/help - Show this help message';

async function handleWaSlashCommand(userId: string, waId: string, command: string): Promise<boolean> {
  const cmd = command.split(/\s+/)[0].toLowerCase();
  const arg = command.slice(cmd.length).trim();

  const reply = async (text: string) => {
    await waSendText(waId, text).catch(() => {});
    await deductWhatsAppCredit(userId);
  };

  switch (cmd) {
    case '/vm': {
      await upsertSmsUserState({ userId, agentTarget: 'vm' });
      await reply('Routing set to Cloud VM. Your messages will be handled by the VM agent.\n\nText /auto to switch back to automatic routing.');
      return true;
    }
    case '/desktop': {
      await upsertSmsUserState({ userId, agentTarget: 'desktop' });
      await reply('Routing set to Desktop. Your messages will be queued for the desktop agent.\n\nText /auto to switch back to automatic routing.');
      return true;
    }
    case '/cloud': {
      await upsertSmsUserState({ userId, agentTarget: 'cloud' });
      await reply('Routing set to Cloud. Messages handled directly in the cloud — no VM or desktop needed.\n\nText /auto to switch back to automatic routing.');
      return true;
    }
    case '/auto': {
      await upsertSmsUserState({ userId, agentTarget: 'auto' });
      await reply('Routing set to Auto. Messages will try VM first, then cloud, then desktop.\n\nText /status to check current routing.');
      return true;
    }
    case '/status': {
      const [state, engine] = await Promise.all([
        getSmsUserState(userId),
        getCloudEngine(userId),
      ]);
      const vmStatus = engine?.status === 'running' ? 'Running' : engine?.status ? `${engine.status}` : 'Not provisioned';
      const targetLabel = { desktop: 'Desktop', vm: 'Cloud VM', cloud: 'Cloud (serverless)', auto: 'Auto (VM > Cloud > Desktop)' }[state.agent_target] || 'Auto';
      const modeLabel = state.mode === 'proactive' ? 'Proactive' : 'Agent';
      await reply(
        `Stuard Status:\n` +
        `Routing: ${targetLabel}\n` +
        `Mode: ${modeLabel}\n` +
        `Model: ${state.preferred_model}\n` +
        `Cloud VM: ${vmStatus}`
      );
      return true;
    }
    case '/model': {
      const model = arg.toLowerCase();
      if (!model) {
        const s = await getSmsUserState(userId);
        await reply(
          `Current model: ${s.preferred_model}\n` +
            'Set: /model fast | /model balanced | /model smart | /model research',
        );
        return true;
      }
      if (['fast', 'balanced', 'smart', 'research'].includes(model)) {
        const s = await upsertSmsUserState({ userId, preferredModel: model as any });
        await reply(`Saved. Your messaging model is now ${s.preferred_model} (stored in cloud).`);
      } else {
        await reply('Usage: /model <fast|balanced|smart|research> or /model to see current');
      }
      return true;
    }
    case '/agent': {
      await upsertSmsUserState({ userId, mode: 'agent', proactiveMessage: null });
      await reply('Switched to Agent mode.');
      return true;
    }
    case '/proactive': {
      await upsertSmsUserState({ userId, mode: 'proactive' });
      await reply('Switched to Proactive mode. You will receive proactive notifications.');
      return true;
    }
    case '/new': {
      await upsertSmsUserState({ userId, conversationId: null, resumeConversationId: null });
      await reply('New conversation started. Previous context cleared.');
      return true;
    }
    case '/help': {
      await reply(WA_HELP_TEXT);
      return true;
    }
    default:
      return false;
  }
}

// ── Credit deduction helper ──────────────────────────────────────────────────

async function deductWhatsAppCredit(userId: string): Promise<void> {
  const credits = messagingCreditCost('whatsapp');
  if (credits <= 0) return;
  try {
    await debitCredits(userId, {
      sourceType: 'messaging:whatsapp',
      sourceRef: `wa_send:${Date.now()}`,
      credits,
      amountUsd: 0.005,
      metadata: { provider: 'whatsapp' },
    });
  } catch (e: any) {
    console.error('[whatsapp] credit deduction failed:', e?.message);
  }
}
