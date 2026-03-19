import type { IncomingMessage, ServerResponse } from 'http';
import { randomInt } from 'crypto';
import {
  upsertExternalAccount,
  getExternalAccount,
  findUserIdByPhone,
  enqueueSmsInboxItem,
  getSmsQueueItem,
  markSmsQueueReplySent,
  upsertSmsUserState,
  getSmsUserState,
  getCloudEngine,
  debitCredits,
  createConversation,
  addUserMessage,
  addAssistantMessage,
} from '../../supabase';
import { authenticateHttpLegacy, sendJson, sendAuthError } from '../../auth/http';
import { AuthErrorCode } from '../../auth';
import { TELNYX_API_KEY, TELNYX_FROM_NUMBER, TELNYX_MESSAGING_PROFILE_ID, CLOUD_PUBLIC_URL } from '../../utils/config';
import { stripMarkdownForSms, sendWelcomeSms, sendSmsRaw } from '../sms-utils';
import { sendVMCommand } from '../../services/vm-command';
import { messagingCreditCost } from '../../pricing';
import { getOrCreateQueryEmbedding } from '../../utils/shared-embedding';

const TELNYX_API = 'https://api.telnyx.com/v2';

// Track inbound calls that are pending streaming setup (for streaming.failed fallback)
const pendingInboundCalls = new Map<string, { fromNumber: string; answeredAt: number }>();

// Track call direction from call.initiated (Telnyx may not include direction in later events)
const callDirectionCache = new Map<string, string>();

// Pending verification maps (primary & secondary)
const pendingVerifications = new Map<string, { code: string; phone: string; expiresAt: number }>();
const pendingSecondaryVerifications = new Map<string, { code: string; phone: string; expiresAt: number }>();

function normalizePhone(raw: string): string {
  let digits = raw.replace(/[^\d+]/g, '');
  if (digits && !digits.startsWith('+')) digits = '+' + digits;
  return digits;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export async function telnyxSendSms(to: string, text: string): Promise<void> {
  if (!TELNYX_API_KEY || !TELNYX_FROM_NUMBER) throw new Error('Telnyx not configured');
  const body: any = { from: TELNYX_FROM_NUMBER, to, text };
  if (TELNYX_MESSAGING_PROFILE_ID) body.messaging_profile_id = TELNYX_MESSAGING_PROFILE_ID;
  const res = await fetch(`${TELNYX_API}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TELNYX_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any)?.errors?.[0]?.detail || `Telnyx SMS failed (${res.status})`);
  }
}

// ─── SMS Slash Command Handler ───────────────────────────────────────────────

const SMS_HELP_TEXT =
  'Stuard SMS Commands:\n' +
  '/vm - Route messages to Cloud VM agent\n' +
  '/desktop - Route messages to desktop agent\n' +
  '/auto - Auto-detect best agent (default)\n' +
  '/status - Show current routing & VM status\n' +
  '/model <fast|balanced|smart> - Set AI model\n' +
  '/agent - Switch to agent mode\n' +
  '/proactive - Switch to proactive mode\n' +
  '/new - Start a new conversation\n' +
  '/help - Show this help message';

async function handleSmsSlashCommand(userId: string, fromPhone: string, command: string): Promise<boolean> {
  const cmd = command.split(/\s+/)[0].toLowerCase();
  const arg = command.slice(cmd.length).trim();

  const reply = async (text: string) => {
    await sendSmsRaw(fromPhone, text).catch(() => {});
    await deductTelnyxCredit(userId);
  };

  switch (cmd) {
    case '/vm': {
      await upsertSmsUserState({ userId, agentTarget: 'vm' });
      await reply('SMS routing set to Cloud VM. Your messages will be handled by the VM agent.\n\nText /auto to switch back to automatic routing.');
      return true;
    }
    case '/desktop': {
      await upsertSmsUserState({ userId, agentTarget: 'desktop' });
      await reply('SMS routing set to Desktop. Your messages will be queued for the desktop agent.\n\nText /auto to switch back to automatic routing.');
      return true;
    }
    case '/auto': {
      await upsertSmsUserState({ userId, agentTarget: 'auto' });
      await reply('SMS routing set to Auto. Messages will try VM first, then fall back to desktop.\n\nText /status to check current routing.');
      return true;
    }
    case '/status': {
      const state = await getSmsUserState(userId);
      const engine = await getCloudEngine(userId);
      const vmStatus = engine?.status === 'running' ? 'Running' : engine?.status ? `${engine.status}` : 'Not provisioned';
      const targetLabel = { desktop: 'Desktop', vm: 'Cloud VM', auto: 'Auto (VM > Desktop)' }[state.agent_target] || 'Auto';
      const modeLabel = state.mode === 'proactive' ? 'Proactive' : 'Agent';
      await reply(
        `Stuard SMS Status:\n` +
        `Routing: ${targetLabel}\n` +
        `Mode: ${modeLabel}\n` +
        `Model: ${state.preferred_model}\n` +
        `Cloud VM: ${vmStatus}`
      );
      return true;
    }
    case '/model': {
      const model = arg.toLowerCase();
      if (['fast', 'balanced', 'smart', 'research'].includes(model)) {
        await upsertSmsUserState({ userId, preferredModel: model as any });
        await reply(`AI model set to "${model}".`);
      } else {
        await reply('Usage: /model <fast|balanced|smart|research>');
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
      await reply(SMS_HELP_TEXT);
      return true;
    }
    default:
      return false;
  }
}

async function deductTelnyxCredit(userId: string): Promise<void> {
  const credits = messagingCreditCost('telnyx');
  if (credits <= 0) return;
  try {
    await debitCredits(userId, {
      sourceType: 'messaging:telnyx',
      sourceRef: `sms_send:${Date.now()}`,
      credits,
      amountUsd: 0.004,
      metadata: { provider: 'telnyx' },
    });
  } catch (e: any) {
    console.error('[telnyx] credit deduction failed:', e?.message);
  }
}

export async function handleTelnyxRoutes(req: IncomingMessage, res: ServerResponse, parsedUrl: URL): Promise<boolean> {
  const { pathname } = parsedUrl;

  // ── Status: primary + secondary phone info ────────────────────────────────
  if (req.method === 'GET' && pathname === '/integrations/telnyx/status') {
    const auth = await authenticateHttpLegacy(req, parsedUrl);
    if (!auth.success || !auth.userId) {
      sendAuthError(res, auth.error || AuthErrorCode.UNAUTHORIZED, auth.message);
      return true;
    }
    const acc = await getExternalAccount(auth.userId, 'telnyx');
    const meta = acc?.meta || {};
    sendJson(res, 200, {
      ok: true,
      connected: !!meta.verified,
      phone: meta.verified ? meta.phone : undefined,
      phone2: meta.verified2 ? meta.phone2 : undefined,
    });
    return true;
  }

  // ── Request verification code (primary) ───────────────────────────────────
  if (req.method === 'POST' && pathname === '/integrations/telnyx/request-code') {
    const auth = await authenticateHttpLegacy(req, parsedUrl);
    if (!auth.success || !auth.userId) {
      sendAuthError(res, auth.error || AuthErrorCode.UNAUTHORIZED, auth.message);
      return true;
    }
    if (!TELNYX_API_KEY || !TELNYX_FROM_NUMBER) {
      sendJson(res, 503, { ok: false, error: 'Telnyx integration is not configured on the server.' });
      return true;
    }
    try {
      const body = JSON.parse(await readBody(req));
      const phone = normalizePhone(body.phone || '');
      if (!phone || phone.length < 10) {
        sendJson(res, 400, { ok: false, error: 'Invalid phone number. Include country code (e.g. +1...).' });
        return true;
      }
      const code = String(randomInt(100000, 999999));
      pendingVerifications.set(auth.userId, { code, phone, expiresAt: Date.now() + 10 * 60 * 1000 });
      await telnyxSendSms(phone, `Your Stuard verification code is: ${code}`);
      sendJson(res, 200, { ok: true, message: 'Verification code sent.' });
    } catch (e: any) {
      sendJson(res, 500, { ok: false, error: String(e?.message || e) });
    }
    return true;
  }

  // ── Verify code (primary) ─────────────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/integrations/telnyx/verify-code') {
    const auth = await authenticateHttpLegacy(req, parsedUrl);
    if (!auth.success || !auth.userId) {
      sendAuthError(res, auth.error || AuthErrorCode.UNAUTHORIZED, auth.message);
      return true;
    }
    try {
      const body = JSON.parse(await readBody(req));
      const userCode = String(body.code || '').trim();
      const pending = pendingVerifications.get(auth.userId);
      if (!pending) {
        sendJson(res, 400, { ok: false, error: 'No pending verification. Request a new code.' });
        return true;
      }
      if (Date.now() > pending.expiresAt) {
        pendingVerifications.delete(auth.userId);
        sendJson(res, 400, { ok: false, error: 'Verification code expired. Request a new one.' });
        return true;
      }
      if (userCode !== pending.code) {
        sendJson(res, 400, { ok: false, error: 'Incorrect code. Please try again.' });
        return true;
      }
      pendingVerifications.delete(auth.userId);

      // Preserve existing secondary phone if any
      const existing = await getExternalAccount(auth.userId, 'telnyx');
      const existingMeta = existing?.meta || {};

      await upsertExternalAccount({
        userId: auth.userId,
        provider: 'telnyx',
        access_token: 'verified',
        scopes: ['sms', 'voice'],
        meta: {
          ...existingMeta,
          phone: pending.phone,
          verified: true,
          verifiedAt: new Date().toISOString(),
        },
      });
      sendJson(res, 200, { ok: true, phone: pending.phone, verified: true });
      // Fire-and-forget welcome SMS
      sendWelcomeSms(pending.phone).catch(() => {});
    } catch (e: any) {
      sendJson(res, 500, { ok: false, error: String(e?.message || e) });
    }
    return true;
  }

  // ── Add / request code for secondary phone ────────────────────────────────
  if (req.method === 'POST' && pathname === '/integrations/telnyx/add-secondary') {
    const auth = await authenticateHttpLegacy(req, parsedUrl);
    if (!auth.success || !auth.userId) {
      sendAuthError(res, auth.error || AuthErrorCode.UNAUTHORIZED, auth.message);
      return true;
    }
    if (!TELNYX_API_KEY || !TELNYX_FROM_NUMBER) {
      sendJson(res, 503, { ok: false, error: 'Telnyx integration is not configured on the server.' });
      return true;
    }
    const acc = await getExternalAccount(auth.userId, 'telnyx');
    if (!acc?.meta?.verified) {
      sendJson(res, 400, { ok: false, error: 'Verify your primary phone number first.' });
      return true;
    }
    try {
      const body = JSON.parse(await readBody(req));
      const phone = normalizePhone(body.phone || '');
      if (!phone || phone.length < 10) {
        sendJson(res, 400, { ok: false, error: 'Invalid phone number. Include country code (e.g. +1...).' });
        return true;
      }
      const code = String(randomInt(100000, 999999));
      pendingSecondaryVerifications.set(auth.userId, { code, phone, expiresAt: Date.now() + 10 * 60 * 1000 });
      await telnyxSendSms(phone, `Your Stuard secondary number verification code is: ${code}`);
      sendJson(res, 200, { ok: true, message: 'Verification code sent to secondary number.' });
    } catch (e: any) {
      sendJson(res, 500, { ok: false, error: String(e?.message || e) });
    }
    return true;
  }

  // ── Verify secondary phone ────────────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/integrations/telnyx/verify-secondary') {
    const auth = await authenticateHttpLegacy(req, parsedUrl);
    if (!auth.success || !auth.userId) {
      sendAuthError(res, auth.error || AuthErrorCode.UNAUTHORIZED, auth.message);
      return true;
    }
    try {
      const body = JSON.parse(await readBody(req));
      const userCode = String(body.code || '').trim();
      const pending = pendingSecondaryVerifications.get(auth.userId);
      if (!pending) {
        sendJson(res, 400, { ok: false, error: 'No pending secondary verification. Request a new code.' });
        return true;
      }
      if (Date.now() > pending.expiresAt) {
        pendingSecondaryVerifications.delete(auth.userId);
        sendJson(res, 400, { ok: false, error: 'Code expired. Request a new one.' });
        return true;
      }
      if (userCode !== pending.code) {
        sendJson(res, 400, { ok: false, error: 'Incorrect code. Please try again.' });
        return true;
      }
      pendingSecondaryVerifications.delete(auth.userId);

      const existing = await getExternalAccount(auth.userId, 'telnyx');
      const existingMeta = existing?.meta || {};
      await upsertExternalAccount({
        userId: auth.userId,
        provider: 'telnyx',
        access_token: 'verified',
        scopes: ['sms', 'voice'],
        meta: {
          ...existingMeta,
          phone2: pending.phone,
          verified2: true,
          verifiedAt2: new Date().toISOString(),
        },
      });
      sendJson(res, 200, { ok: true, phone2: pending.phone, verified2: true });
    } catch (e: any) {
      sendJson(res, 500, { ok: false, error: String(e?.message || e) });
    }
    return true;
  }

  // ── Remove secondary phone ────────────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/integrations/telnyx/remove-secondary') {
    const auth = await authenticateHttpLegacy(req, parsedUrl);
    if (!auth.success || !auth.userId) {
      sendAuthError(res, auth.error || AuthErrorCode.UNAUTHORIZED, auth.message);
      return true;
    }
    try {
      const existing = await getExternalAccount(auth.userId, 'telnyx');
      const existingMeta = { ...(existing?.meta || {}) };
      delete existingMeta.phone2;
      delete existingMeta.verified2;
      delete existingMeta.verifiedAt2;
      await upsertExternalAccount({
        userId: auth.userId,
        provider: 'telnyx',
        access_token: existing?.access_token || 'verified',
        scopes: ['sms', 'voice'],
        meta: existingMeta,
      });
      sendJson(res, 200, { ok: true });
    } catch (e: any) {
      sendJson(res, 500, { ok: false, error: String(e?.message || e) });
    }
    return true;
  }

  // ── Disconnect / remove all ────────────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/integrations/telnyx/disconnect') {
    const auth = await authenticateHttpLegacy(req, parsedUrl);
    if (!auth.success || !auth.userId) {
      sendAuthError(res, auth.error || AuthErrorCode.UNAUTHORIZED, auth.message);
      return true;
    }
    try {
      const { deleteExternalAccount } = await import('../../supabase');
      await deleteExternalAccount(auth.userId, 'telnyx', 'default');
      sendJson(res, 200, { ok: true });
    } catch (e: any) {
      sendJson(res, 500, { ok: false, error: String(e?.message || e) });
    }
    return true;
  }

  // ── Proactive SMS (called by desktop scheduler) ────────────────────────────
  if (req.method === 'POST' && pathname === '/integrations/telnyx/proactive-sms') {
    const auth = await authenticateHttpLegacy(req, parsedUrl);
    if (!auth.success || !auth.userId) {
      sendAuthError(res, auth.error || AuthErrorCode.UNAUTHORIZED, auth.message);
      return true;
    }
    if (!TELNYX_API_KEY || !TELNYX_FROM_NUMBER) {
      sendJson(res, 503, { ok: false, error: 'Telnyx not configured.' });
      return true;
    }
    try {
      const body = JSON.parse(await readBody(req));
      const acc = await getExternalAccount(auth.userId, 'telnyx');
      const meta = acc?.meta || {};
      if (!meta.verified || !meta.phone) {
        sendJson(res, 400, { ok: false, error: 'No verified phone number.' });
        return true;
      }
      await telnyxSendSms(meta.phone, String(body.message || '').slice(0, 1600));
      await deductTelnyxCredit(auth.userId);
      sendJson(res, 200, { ok: true });
    } catch (e: any) {
      sendJson(res, 500, { ok: false, error: String(e?.message || e) });
    }
    return true;
  }

  // ── Proactive Call (called by desktop scheduler) ──────────────────────────
  if (req.method === 'POST' && pathname === '/integrations/telnyx/proactive-call') {
    const auth = await authenticateHttpLegacy(req, parsedUrl);
    if (!auth.success || !auth.userId) {
      sendAuthError(res, auth.error || AuthErrorCode.UNAUTHORIZED, auth.message);
      return true;
    }
    if (!TELNYX_API_KEY || !TELNYX_FROM_NUMBER) {
      sendJson(res, 503, { ok: false, error: 'Telnyx not configured.' });
      return true;
    }
    try {
      const body = JSON.parse(await readBody(req));
      const acc = await getExternalAccount(auth.userId, 'telnyx');
      const meta = acc?.meta || {};
      if (!meta.verified || !meta.phone) {
        sendJson(res, 400, { ok: false, error: 'No verified phone number.' });
        return true;
      }
      const callResult = await (await fetch(`${TELNYX_API}/calls`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TELNYX_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          connection_id: process.env.TELNYX_SIP_CONNECTION_ID || '',
          to: meta.phone,
          from: TELNYX_FROM_NUMBER,
          answering_machine_detection: 'detect',
          webhook_url: `${process.env.CLOUD_PUBLIC_URL || ''}/integrations/telnyx/call-webhook`,
          webhook_url_method: 'POST',
          custom_headers: [
            { name: 'X-Tts-Message', value: Buffer.from(String(body.message || 'Stuard check-in')).toString('base64') },
            { name: 'X-Tts-Voice', value: 'female' },
          ],
        }),
      })).json() as any;
      sendJson(res, 200, { ok: true, callControlId: callResult?.data?.call_control_id });
    } catch (e: any) {
      sendJson(res, 500, { ok: false, error: String(e?.message || e) });
    }
    return true;
  }

  // ── Desktop-owned SMS reply submission ─────────────────────────────────────
  // ── Outbound SMS notification (no queue item needed — used for mid-turn tool permission prompts)
  if (req.method === 'POST' && pathname === '/integrations/telnyx/sms-notify') {
    const auth = await authenticateHttpLegacy(req, parsedUrl);
    if (!auth.success || !auth.userId) {
      sendAuthError(res, auth.error || AuthErrorCode.UNAUTHORIZED, auth.message);
      return true;
    }
    try {
      const body = JSON.parse(await readBody(req));
      const toPhone = String(body?.to || '').trim();
      const text = stripMarkdownForSms(String(body?.text || '').trim()).slice(0, 1530);
      if (!toPhone || !text) {
        sendJson(res, 400, { ok: false, error: 'to and text are required.' });
        return true;
      }
      await telnyxSendSms(toPhone, text);
      await deductTelnyxCredit(auth.userId);
      sendJson(res, 200, { ok: true });
    } catch (e: any) {
      sendJson(res, 500, { ok: false, error: String(e?.message || e) });
    }
    return true;
  }

  if (req.method === 'POST' && pathname === '/integrations/telnyx/sms-reply') {
    const auth = await authenticateHttpLegacy(req, parsedUrl);
    if (!auth.success || !auth.userId) {
      sendAuthError(res, auth.error || AuthErrorCode.UNAUTHORIZED, auth.message);
      return true;
    }
    try {
      const body = JSON.parse(await readBody(req));
      const queueItemId = String(body?.queueItemId || '').trim();
      const replyText = stripMarkdownForSms(String(body?.replyText || '').trim()).slice(0, 1500);
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
      const targetPhone = normalizePhone(String(queueItem.reply_to_phone || body?.replyToPhone || ''));
      if (!targetPhone) {
        sendJson(res, 400, { ok: false, error: 'reply_to_phone_missing' });
        return true;
      }
      if (queueItem.reply_sent_at) {
        sendJson(res, 200, { ok: true, duplicate: true });
        return true;
      }

      await telnyxSendSms(targetPhone, replyText);
      await deductTelnyxCredit(auth.userId);
      await markSmsQueueReplySent(queueItemId).catch(() => false);
      await upsertSmsUserState({
        userId: auth.userId,
        mode: stateMode,
        preferredModel,
        conversationId,
        resumeConversationId,
        lastReplyToPhone: targetPhone,
        // Clear the stored proactive message when switching back to agent mode
        proactiveMessage: stateMode === 'agent' ? null : undefined,
      }).catch(() => false);
      sendJson(res, 200, { ok: true });
    } catch (e: any) {
      sendJson(res, 500, { ok: false, error: String(e?.message || e) });
    }
    return true;
  }

  // ── SMS Settings: get/set agent routing target ──────────────────────────
  if (req.method === 'GET' && pathname === '/integrations/telnyx/sms-settings') {
    const auth = await authenticateHttpLegacy(req, parsedUrl);
    if (!auth.success || !auth.userId) {
      sendAuthError(res, auth.error || AuthErrorCode.UNAUTHORIZED, auth.message);
      return true;
    }
    try {
      const state = await getSmsUserState(auth.userId);
      const engine = await getCloudEngine(auth.userId);
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

  if (req.method === 'POST' && pathname === '/integrations/telnyx/sms-settings') {
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

  // ── Incoming SMS webhook (Telnyx → Stuard) ───────────────────────────────
  // Configure this URL in the Telnyx portal as the messaging webhook:
  //   POST /webhooks/telnyx/sms
  if (req.method === 'POST' && pathname === '/webhooks/telnyx/sms') {
    try {
      const payload = JSON.parse(await readBody(req));
      const eventType: string = payload?.data?.event_type || '';

      if (eventType === 'message.received') {
        const msgPayload = payload?.data?.payload || {};
        const fromPhone = normalizePhone(String(msgPayload?.from?.phone_number || msgPayload?.from || ''));
        const inboundText: string = String(msgPayload?.text || '').trim();
        const providerMessageId = String(
          msgPayload?.id ||
          msgPayload?.record_id ||
          payload?.data?.id ||
          '',
        ).trim() || null;

        if (fromPhone && inboundText) {
          // Find which user owns this number (primary or secondary)
          const userId = await findUserIdByPhone(fromPhone);
          if (userId) {
            console.log('[telnyx] inbound SMS matched user', {
              fromPhone,
              userId,
              textPreview: inboundText.slice(0, 80),
            });

            // ── Handle slash commands ────────────────────────────────
            const trimmedLower = inboundText.toLowerCase().trim();
            if (trimmedLower.startsWith('/')) {
              const slashHandled = await handleSmsSlashCommand(userId, fromPhone, trimmedLower);
              if (slashHandled) {
                // Slash command was handled — don't route to agent
                sendJson(res, 200, { ok: true });
                return true;
              }
            }

            // ── Route based on user's agent_target setting ───────────
            const smsState = await getSmsUserState(userId);
            const target = smsState.agent_target;

            // Check if VM is actually deployed and running before trying it
            const engine = await getCloudEngine(userId);
            const vmRunning = !!(engine && engine.status === 'running');

            // Resolve effective target: if 'auto', pick based on what's available
            let effectiveTarget: 'vm' | 'desktop' = 'desktop';
            if (target === 'vm') {
              effectiveTarget = vmRunning ? 'vm' : 'desktop'; // fall back to desktop if VM not running
            } else if (target === 'auto') {
              effectiveTarget = vmRunning ? 'vm' : 'desktop';
            }

            console.log('[telnyx] SMS routing decision', {
              userId, configuredTarget: target, vmRunning, effectiveTarget,
            });

            let handled = false;

            if (effectiveTarget === 'vm') {
              // Relay to VM — generate embedding in cloud-ai so the VM can
              // run similarity search against its synced SQLite memory DB.
              try {
                // Generate embedding for the inbound text so the VM's Python agent
                // can do vector similarity search in its local SQLite DB.
                let queryEmbedding: number[] | undefined;
                try {
                  queryEmbedding = await getOrCreateQueryEmbedding(inboundText);
                } catch {
                  // Non-fatal: VM will still work with recent-segments fallback
                }

                // Ensure conversation is persisted in Supabase (forcePersist=true bypasses sync pref)
                let convId = smsState.conversation_id || null;
                if (!convId) {
                  convId = await createConversation(userId, inboundText, smsState.preferred_model || 'fast', {
                    mode: smsState.preferred_model || 'fast',
                  }, 'stuard', true);
                } else {
                  // Store the inbound user message
                  await addUserMessage(userId, convId, inboundText, {
                    mode: smsState.preferred_model || 'fast',
                  }, true);
                }

                const vmResult = await sendVMCommand(userId, 'agent_chat', {
                  message: inboundText,
                  conversationId: convId || undefined,
                  model: smsState.preferred_model || 'fast',
                  context: { source: 'sms', fromPhone },
                  memoryQuery: inboundText,
                  // Pass pre-computed embedding so VM can do similarity search locally
                  ...(queryEmbedding ? { queryEmbedding } : {}),
                }, 60_000);

                if (vmResult.ok && vmResult.result?.text) {
                  const replyText = stripMarkdownForSms(String(vmResult.result.text)).slice(0, 1500);
                  await sendSmsRaw(fromPhone, replyText).catch((e: any) => {
                    console.error('[telnyx] Failed to send VM agent SMS reply:', e?.message);
                  });
                  await deductTelnyxCredit(userId);
                  handled = true;

                  // Store assistant reply in Supabase for chat history visibility
                  const vmConvId = vmResult.result?.conversationId || convId;
                  if (vmConvId) {
                    await addAssistantMessage(userId, vmConvId, String(vmResult.result.text), {
                      mode: smsState.preferred_model || 'fast',
                    }, true);
                  }

                  // Track conversation ID returned by VM for next turn
                  if (vmConvId && vmConvId !== smsState.conversation_id) {
                    await upsertSmsUserState({ userId, conversationId: vmConvId });
                  }

                  console.log('[telnyx] SMS routed to VM', { userId, conversationId: vmConvId, responseLen: replyText.length });
                }
              } catch {
                // VM call failed at runtime — fall through to desktop
              }
            }

            // Desktop fallback (or primary desktop target)
            // Desktop inbox → desktop processSmsItem → cloud WS → agent handles
            // conversation state, memory, and multi-turn end-to-end.
            if (!handled) {
              if (target === 'vm' && !vmRunning) {
                // User explicitly chose VM but it's not deployed/running
                await sendSmsRaw(fromPhone,
                  'Your Cloud VM is not running. Start it from the desktop app, or text /auto to enable automatic routing.'
                ).catch(() => {});
                await deductTelnyxCredit(userId);
              } else {
                // Queue to desktop inbox — pass conversationId for multi-turn continuity
                const queued = await enqueueSmsInboxItem({
                  userId,
                  provider: 'telnyx',
                  providerMessageId,
                  fromPhone,
                  replyToPhone: fromPhone,
                  messageText: inboundText,
                  conversationId: smsState.conversation_id,
                  metadata: {
                    eventType,
                    receivedAt: new Date().toISOString(),
                  },
                });
                if (!queued) {
                  console.warn('[telnyx] inbound SMS could not be queued', {
                    fromPhone,
                    userId,
                    textPreview: inboundText.slice(0, 80),
                  });
                }
              }
            }
          } else {
            console.warn('[telnyx] inbound SMS did not match a verified user', {
              fromPhone,
              textPreview: inboundText.slice(0, 80),
            });
          }
        } else {
          console.warn('[telnyx] inbound SMS missing sender or text', {
            fromPhone,
            hasText: !!inboundText,
          });
        }
      }
    } catch (e: any) {
      console.error('[telnyx] Incoming SMS webhook error:', e?.message || e);
    }
    sendJson(res, 200, { ok: true });
    return true;
  }

  // ── Call webhook (Telnyx sends call events here) ──────────────────────────
  if (req.method === 'POST' && pathname === '/integrations/telnyx/call-webhook') {
    // Read body synchronously, then respond 200 immediately so Telnyx doesn't retry.
    // Process the event asynchronously after responding.
    let rawBody = '';
    try {
      rawBody = await readBody(req);
    } catch (e: any) {
      console.error('[telnyx] Failed to read webhook body:', e?.message);
    }

    // Respond 200 immediately — Telnyx expects fast acknowledgement
    sendJson(res, 200, { ok: true });

    // Process the call event asynchronously
    processCallWebhook(rawBody).catch((e: any) => {
      console.error('[telnyx] Call webhook processing error:', e?.message || e);
    });

    return true;
  }

  // ── MMS webhook (Telnyx sends inbound MMS/media messages here) ────────────
  if (req.method === 'POST' && pathname === '/webhooks/telnyx/mms') {
    try {
      const body = JSON.parse(await readBody(req));
      const eventType: string = body?.data?.event_type || '';

      if (eventType === 'message.received') {
        const payload = body?.data?.payload || {};
        const from: string = normalizePhone(payload?.from?.phone_number || '');
        const mediaItems: any[] = payload?.media || [];
        const text: string = payload?.text || '';
        const providerMessageId = String(payload?.id || '').trim() || null;

        if (from && mediaItems.length > 0) {
          const userId = await findUserIdByPhone(from);
          if (userId) {
            const smsState = await getSmsUserState(userId);
            const target = smsState.agent_target;
            const engine = await getCloudEngine(userId);
            const vmRunning = !!(engine && engine.status === 'running');

            let effectiveTarget: 'vm' | 'desktop' = 'desktop';
            if (target === 'vm') {
              effectiveTarget = vmRunning ? 'vm' : 'desktop';
            } else if (target === 'auto') {
              effectiveTarget = vmRunning ? 'vm' : 'desktop';
            }

            // Build a description of all media for routing/display
            const mediaDescriptions: string[] = [];
            for (const media of mediaItems) {
              const contentType = media?.content_type || 'image/jpeg';
              const mediaType = contentType.startsWith('image/') ? 'image'
                : contentType.startsWith('audio/') ? 'audio'
                : contentType.startsWith('video/') ? 'video'
                : 'document';
              mediaDescriptions.push(`[${mediaType} received]`);
            }
            const messageText = text || mediaDescriptions.join(' ');

            let handled = false;

            if (effectiveTarget === 'vm') {
              try {
                const vmResult = await sendVMCommand(userId, 'agent_chat', {
                  message: messageText,
                  conversationId: smsState.conversation_id || undefined,
                  model: smsState.preferred_model || 'fast',
                  context: {
                    source: 'mms',
                    fromPhone: from,
                    media: mediaItems.map((m: any) => ({
                      url: m?.url || '',
                      contentType: m?.content_type || 'image/jpeg',
                    })),
                  },
                }, 60_000);

                if (vmResult.ok && vmResult.result?.text) {
                  const replyText = stripMarkdownForSms(String(vmResult.result.text)).slice(0, 1500);
                  await sendSmsRaw(from, replyText).catch((e: any) => {
                    console.error('[telnyx] Failed to send VM agent MMS reply:', e?.message);
                  });
                  await deductTelnyxCredit(userId);
                  handled = true;

                  const vmConvId = vmResult.result?.conversationId || null;
                  if (vmConvId && vmConvId !== smsState.conversation_id) {
                    await upsertSmsUserState({ userId, conversationId: vmConvId });
                  }
                }
              } catch {
                // VM call failed — fall through to desktop
              }
            }

            if (!handled) {
              if (target === 'vm' && !vmRunning) {
                await sendSmsRaw(from,
                  'Your Cloud VM is not running. Start it from the desktop app, or text /auto to enable automatic routing.'
                ).catch(() => {});
                await deductTelnyxCredit(userId);
              } else {
                for (const media of mediaItems) {
                  const mediaUrl = media?.url || '';
                  const contentType = media?.content_type || 'image/jpeg';
                  const mediaType = contentType.startsWith('image/') ? 'image'
                    : contentType.startsWith('audio/') ? 'audio'
                    : contentType.startsWith('video/') ? 'video'
                    : 'document';

                  await enqueueSmsInboxItem({
                    userId,
                    provider: 'telnyx',
                    providerMessageId,
                    fromPhone: from,
                    replyToPhone: from,
                    messageText: text || `[${mediaType} received]`,
                    conversationId: smsState.conversation_id,
                    metadata: {
                      mediaUrl,
                      contentType,
                      mediaType,
                      receivedAt: new Date().toISOString(),
                    },
                  });
                }
              }
            }

            console.log('[telnyx] MMS received', { from, userId, mediaCount: mediaItems.length, effectiveTarget, handled });
          }
        }
      }
    } catch (e: any) {
      console.error('[telnyx] MMS webhook error:', e?.message || e);
    }
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}

/**
 * Process incoming Telnyx call control webhook events.
 *
 * Telnyx v2 call flow (single-step answer+stream):
 *   call.initiated  → answer the call with stream_url (answer + streaming in one API call)
 *   call.answered   → log confirmation
 *   streaming.started / streaming.failed → handle streaming lifecycle
 *   call.hangup     → cleanup
 */
async function processCallWebhook(rawBody: string): Promise<void> {
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.error('[telnyx] Failed to parse call webhook JSON');
    return;
  }

  const eventType: string =
    payload?.data?.event_type ||
    payload?.event_type ||
    '';
  const eventPayload = payload?.data?.payload || payload?.payload || {};
  const callControlId: string = eventPayload?.call_control_id || '';
  const direction: string = eventPayload?.direction || '';
  const fromNumber: string = eventPayload?.from || '';
  const toNumber: string = eventPayload?.to || '';

  console.log('[telnyx] Call webhook event', {
    eventType, callControlId: callControlId.slice(0, 24) + '…',
    direction, from: fromNumber, to: toNumber,
  });

  if (!callControlId) {
    console.warn('[telnyx] Call webhook missing call_control_id');
    return;
  }

  switch (eventType) {
    // ── Incoming call — answer with streaming in one step ────────────────
    case 'call.initiated': {
      // Cache direction for later events (Telnyx may omit it in call.answered)
      if (direction) callDirectionCache.set(callControlId, direction);

      if (direction !== 'incoming') {
        console.log('[telnyx] Outbound call.initiated tracked', { direction, callControlId: callControlId.slice(0, 24) });
        return;
      }

      pendingInboundCalls.set(callControlId, { fromNumber, answeredAt: Date.now() });

      console.log('[telnyx] Answering inbound call', { callControlId: callControlId.slice(0, 24), from: fromNumber });

      try {
        await answerWithStreaming(callControlId, fromNumber);
      } catch (e: any) {
        console.error('[telnyx] answerWithStreaming failed', { callControlId, error: e?.message });
        pendingInboundCalls.delete(callControlId);
      }
      break;
    }

    // ── Call answered — start streaming for outbound calls ──────────────
    case 'call.answered': {
      // Telnyx often omits direction in call.answered — use cached value from call.initiated
      const effectiveDirection = direction || callDirectionCache.get(callControlId) || '';
      callDirectionCache.delete(callControlId);
      const customHeaders: Array<{ name: string; value: string }> = eventPayload?.custom_headers || [];

      console.log('[telnyx] Call answered', {
        callControlId: callControlId.slice(0, 24),
        direction: effectiveDirection,
        rawDirection: direction,
        hasCustomHeaders: customHeaders.length > 0,
      });

      // For outbound calls, streaming wasn't started in the answer command
      // (since WE placed the call). We need to start it now.
      // Check direction AND custom headers as fallback (X-Voice-Bridge = AI call,
      // X-Tts-Message = proactive TTS call). Telnyx often omits direction in this event.
      const isOutbound = effectiveDirection === 'outgoing' ||
        (!effectiveDirection && customHeaders.some(h =>
          h.name === 'X-Voice-Bridge' || h.name === 'X-Tts-Message'));

      if (isOutbound) {
        const bridgeHeader = customHeaders.find(h => h.name === 'X-Voice-Bridge');
        const wsUrlHeader = customHeaders.find(h => h.name === 'X-Bridge-Ws-Url');
        const ttsHeader = customHeaders.find(h => h.name === 'X-Tts-Message');

        if (bridgeHeader?.value && wsUrlHeader?.value) {
          // AI voice call — start bidirectional streaming to the bridge WS
          const wsBaseUrl = Buffer.from(wsUrlHeader.value, 'base64').toString('utf8');
          const streamUrl = `${wsBaseUrl}?callControlId=${encodeURIComponent(callControlId)}&bridge=${encodeURIComponent(bridgeHeader.value)}`;

          console.log('[telnyx] Starting streaming for outbound call', {
            callControlId: callControlId.slice(0, 24),
            streamUrl: streamUrl.slice(0, 120),
          });

          const streamRes = await fetch(`${TELNYX_API}/calls/${callControlId}/actions/streaming_start`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              stream_url: streamUrl,
              stream_track: 'both_tracks',
              stream_bidirectional_mode: 'rtp',
              stream_bidirectional_codec: 'PCMU',
              send_silence_when_idle: true,
            }),
          });

          if (!streamRes.ok) {
            const errBody = await streamRes.text().catch(() => '');
            console.error('[telnyx] Failed to start outbound streaming', {
              status: streamRes.status, body: errBody.slice(0, 300), callControlId,
            });
            // Fallback: speak a message and hang up
            await fetch(`${TELNYX_API}/calls/${callControlId}/actions/speak`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                payload: 'Hello, this is Stuard AI. Voice streaming could not be started. Please try again later.',
                voice: 'female',
                language: 'en-US',
              }),
            }).catch(() => {});
          }
        } else if (ttsHeader?.value) {
          // Proactive TTS-only call — speak the message
          const ttsMessage = Buffer.from(ttsHeader.value, 'base64').toString('utf8');
          const ttsVoice = customHeaders.find(h => h.name === 'X-Tts-Voice')?.value || 'female';

          console.log('[telnyx] Speaking TTS for outbound proactive call', {
            callControlId: callControlId.slice(0, 24),
            messageLen: ttsMessage.length,
          });

          await fetch(`${TELNYX_API}/calls/${callControlId}/actions/speak`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              payload: ttsMessage,
              voice: ttsVoice,
              language: 'en-US',
            }),
          }).catch((e: any) => {
            console.error('[telnyx] TTS speak failed for proactive call:', e?.message);
          });
        } else {
          console.warn('[telnyx] Outbound call answered but no bridge or TTS config found in custom_headers', {
            callControlId: callControlId.slice(0, 24),
            headerNames: customHeaders.map(h => h.name),
          });
        }
      }
      break;
    }

    // ── Streaming lifecycle ──────────────────────────────────────────────
    case 'streaming.started': {
      console.log('[telnyx] Streaming started', { callControlId: callControlId.slice(0, 24) });
      pendingInboundCalls.delete(callControlId);
      break;
    }

    case 'streaming.failed': {
      console.error('[telnyx] Streaming failed', {
        callControlId: callControlId.slice(0, 24),
        reason: eventPayload?.streaming_failure_reason || 'unknown',
      });
      pendingInboundCalls.delete(callControlId);

      await fetch(`${TELNYX_API}/calls/${callControlId}/actions/speak`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payload: 'Hello, this is Stuard AI. Voice streaming could not be started. Please try calling again or send a text message.',
          voice: 'female',
          language: 'en-US',
        }),
      }).catch(() => {});
      break;
    }

    // ── Call ended ───────────────────────────────────────────────────────
    case 'call.hangup': {
      console.log('[telnyx] Call hung up', {
        callControlId: callControlId.slice(0, 24),
        hangupCause: eventPayload?.hangup_cause || 'unknown',
      });
      pendingInboundCalls.delete(callControlId);
      callDirectionCache.delete(callControlId);
      break;
    }

    // ── Speak completed (after TTS fallback) ────────────────────────────
    case 'call.speak.ended': {
      console.log('[telnyx] TTS speak ended, hanging up', { callControlId: callControlId.slice(0, 24) });
      await fetch(`${TELNYX_API}/calls/${callControlId}/actions/hangup`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
      }).catch(() => {});
      break;
    }

    default: {
      console.log('[telnyx] Unhandled call event', { eventType, callControlId: callControlId.slice(0, 24) });
      break;
    }
  }
}

/**
 * Answer an inbound call and start AI voice streaming in a single Telnyx API call.
 *
 * Per Telnyx docs, the answer command accepts stream_url + streaming params directly,
 * which answers the call AND initiates bidirectional WebSocket streaming in one step.
 * This eliminates a separate streaming_start round-trip and reduces latency.
 *
 * If no voice providers are configured, answers with TTS fallback instead.
 */
async function answerWithStreaming(callControlId: string, fromNumber: string): Promise<void> {
  const { getConfiguredProviders } = await import('../../voice');

  const userId = await findUserIdByPhone(normalizePhone(fromNumber));
  const configuredProviders = getConfiguredProviders();

  // Only allow calls from verified/connected users
  if (!userId) {
    console.log('[telnyx] Rejecting inbound call from unregistered number', { fromNumber });
    pendingInboundCalls.delete(callControlId);

    await fetch(`${TELNYX_API}/calls/${callControlId}/actions/answer`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    await new Promise(r => setTimeout(r, 500));
    await fetch(`${TELNYX_API}/calls/${callControlId}/actions/speak`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payload: 'Sorry, this number is not registered with Stuard AI. Please sign up and verify your phone number to use voice calls.',
        voice: 'female',
        language: 'en-US',
      }),
    });
    return;
  }

  if (configuredProviders.length === 0) {
    console.log('[telnyx] No voice providers configured, answering with TTS fallback');
    pendingInboundCalls.delete(callControlId);

    await fetch(`${TELNYX_API}/calls/${callControlId}/actions/answer`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    await new Promise(r => setTimeout(r, 500));
    await fetch(`${TELNYX_API}/calls/${callControlId}/actions/speak`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payload: 'Hello, this is Stuard AI. I cannot take voice calls right now. Please send a text message instead.',
        voice: 'female',
        language: 'en-US',
      }),
    });
    return;
  }

  // Pick the best provider for inbound calls — GPT-4o Realtime is the default
  const preferredOrder = ['openai-realtime', 'grok-realtime', 'gemini-live', 'elevenlabs'];
  let providerId = '';

  for (const id of preferredOrder) {
    const p = configuredProviders.find(cp => cp.id === id);
    if (!p) continue;

    if (id === 'elevenlabs') {
      const agentId = process.env.ELEVENLABS_INBOUND_AGENT_ID || process.env.ELEVENLABS_DEFAULT_AGENT_ID || '';
      if (!agentId) continue;
    }

    providerId = id;
    break;
  }

  if (!providerId) providerId = configuredProviders[0].id;

  console.log('[telnyx] Inbound call provider selection', {
    callControlId, fromNumber, providerId, userId,
    configured: configuredProviders.map(p => p.id),
  });

  // Build bridge config — system prompt and tools are loaded by the bridge
  // via buildVoiceContext() using the userId, so we don't hardcode prompts here.
  const bridgeConfig: Record<string, any> = {
    providerId,
    initialMessage: 'Hello! This is Stuard AI. How can I help you today?',
    direction: 'inbound',
    callerNumber: fromNumber,
    userId,
    metadata: { source: 'inbound_call', callerNumber: fromNumber },
  };

  if (providerId === 'elevenlabs') {
    bridgeConfig.agentId = process.env.ELEVENLABS_INBOUND_AGENT_ID || process.env.ELEVENLABS_DEFAULT_AGENT_ID;
  }

  if (providerId === 'openai-realtime' || providerId === 'grok-realtime') {
    bridgeConfig.voiceId = process.env.OPENAI_REALTIME_VOICE || 'alloy';
  }

  const bridgeB64 = Buffer.from(JSON.stringify(bridgeConfig)).toString('base64');
  const wsBaseUrl = (CLOUD_PUBLIC_URL || '').replace(/^http/, 'ws');
  const streamUrl = `${wsBaseUrl}/ws/telnyx-bridge?callControlId=${encodeURIComponent(callControlId)}&bridge=${encodeURIComponent(bridgeB64)}`;

  console.log('[telnyx] Answering with streaming', { callControlId, streamUrl: streamUrl.slice(0, 120), providerId });

  // Answer + start bidirectional streaming in a single API call
  const answerRes = await fetch(`${TELNYX_API}/calls/${callControlId}/actions/answer`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      stream_url: streamUrl,
      stream_track: 'both_tracks',
      stream_bidirectional_mode: 'rtp',
      stream_bidirectional_codec: 'PCMU',
      send_silence_when_idle: true,
    }),
  });

  const answerBody = await answerRes.text();
  console.log('[telnyx] Answer+stream response', {
    status: answerRes.status,
    body: answerBody.slice(0, 500),
    callControlId, fromNumber, providerId, userId,
  });

  if (!answerRes.ok) {
    console.error('[telnyx] Answer+stream failed', { status: answerRes.status, callControlId });
    pendingInboundCalls.delete(callControlId);

    // Last resort: try answering without streaming, then use TTS
    const plainAnswer = await fetch(`${TELNYX_API}/calls/${callControlId}/actions/answer`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).catch(() => null);

    if (plainAnswer?.ok) {
      await new Promise(r => setTimeout(r, 500));
      await fetch(`${TELNYX_API}/calls/${callControlId}/actions/speak`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payload: 'Hello, this is Stuard AI. Voice streaming is temporarily unavailable. Please try again later.',
          voice: 'female',
          language: 'en-US',
        }),
      }).catch(() => {});
    }
  }
}

/**
 * Verify Telnyx Call Control Application configuration on startup.
 * Ensures the webhook URL points to the correct Cloud Run URL.
 */
export async function verifyTelnyxConfig(): Promise<void> {
  if (!TELNYX_API_KEY || !CLOUD_PUBLIC_URL) {
    console.log('[telnyx] Skipping config verification (missing API key or CLOUD_PUBLIC_URL)');
    return;
  }

  const expectedWebhookUrl = `${CLOUD_PUBLIC_URL}/integrations/telnyx/call-webhook`;

  try {
    // List call control applications
    const res = await fetch(`${TELNYX_API}/call_control_applications`, {
      headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      console.warn('[telnyx] Failed to list call control apps:', res.status);
      return;
    }
    const data = await res.json() as any;
    const apps = data?.data || [];

    for (const app of apps) {
      if (app.webhook_event_url !== expectedWebhookUrl) {
        console.log('[telnyx] Updating Call Control App webhook URL', {
          appId: app.id,
          appName: app.application_name,
          oldUrl: app.webhook_event_url,
          newUrl: expectedWebhookUrl,
        });
        await fetch(`${TELNYX_API}/call_control_applications/${app.id}`, {
          method: 'PATCH',
          headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            webhook_event_url: expectedWebhookUrl,
            webhook_event_failover_url: expectedWebhookUrl,
          }),
        });
      } else {
        console.log('[telnyx] Call Control App webhook URL OK', {
          appId: app.id,
          appName: app.application_name,
          webhookUrl: app.webhook_event_url,
        });
      }
    }

    // Also verify phone number voice connection
    const phoneRes = await fetch(`${TELNYX_API}/phone_numbers?filter[phone_number]=${encodeURIComponent(TELNYX_FROM_NUMBER)}`, {
      headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
    });
    if (phoneRes.ok) {
      const phoneData = await phoneRes.json() as any;
      const phone = phoneData?.data?.[0];
      if (phone) {
        console.log('[telnyx] Phone number config', {
          number: phone.phone_number,
          status: phone.status,
          connectionId: phone.connection_id,
          connectionName: phone.connection_name,
          type: phone.phone_number_type,
        });
        if (!phone.connection_id) {
          console.warn('[telnyx] ⚠ Phone number has no voice connection! Inbound calls will not work.');
        }
      }
    }
  } catch (e: any) {
    console.warn('[telnyx] Config verification error:', e?.message);
  }
}
