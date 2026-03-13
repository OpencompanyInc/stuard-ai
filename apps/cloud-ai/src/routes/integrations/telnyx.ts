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
} from '../../supabase';
import { authenticateHttpLegacy, sendJson, sendAuthError } from '../../auth/http';
import { AuthErrorCode } from '../../auth';
import { TELNYX_API_KEY, TELNYX_FROM_NUMBER, TELNYX_MESSAGING_PROFILE_ID } from '../../utils/config';
import { stripMarkdownForSms, sendWelcomeSms, sendSmsRaw } from '../sms-utils';
import { sendVMCommand } from '../../services/vm-command';

const TELNYX_API = 'https://api.telnyx.com/v2';

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

async function telnyxSendSms(to: string, text: string): Promise<void> {
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

  switch (cmd) {
    case '/vm': {
      await upsertSmsUserState({ userId, agentTarget: 'vm' });
      await sendSmsRaw(fromPhone, 'SMS routing set to Cloud VM. Your messages will be handled by the VM agent.\n\nText /auto to switch back to automatic routing.').catch(() => {});
      return true;
    }
    case '/desktop': {
      await upsertSmsUserState({ userId, agentTarget: 'desktop' });
      await sendSmsRaw(fromPhone, 'SMS routing set to Desktop. Your messages will be queued for the desktop agent.\n\nText /auto to switch back to automatic routing.').catch(() => {});
      return true;
    }
    case '/auto': {
      await upsertSmsUserState({ userId, agentTarget: 'auto' });
      await sendSmsRaw(fromPhone, 'SMS routing set to Auto. Messages will try VM first, then fall back to desktop.\n\nText /status to check current routing.').catch(() => {});
      return true;
    }
    case '/status': {
      const state = await getSmsUserState(userId);
      const engine = await getCloudEngine(userId);
      const vmStatus = engine?.status === 'running' ? 'Running' : engine?.status ? `${engine.status}` : 'Not provisioned';
      const targetLabel = { desktop: 'Desktop', vm: 'Cloud VM', auto: 'Auto (VM > Desktop)' }[state.agent_target] || 'Auto';
      const modeLabel = state.mode === 'proactive' ? 'Proactive' : 'Agent';
      await sendSmsRaw(fromPhone,
        `Stuard SMS Status:\n` +
        `Routing: ${targetLabel}\n` +
        `Mode: ${modeLabel}\n` +
        `Model: ${state.preferred_model}\n` +
        `Cloud VM: ${vmStatus}`
      ).catch(() => {});
      return true;
    }
    case '/model': {
      const model = arg.toLowerCase();
      if (['fast', 'balanced', 'smart', 'research'].includes(model)) {
        await upsertSmsUserState({ userId, preferredModel: model as any });
        await sendSmsRaw(fromPhone, `AI model set to "${model}".`).catch(() => {});
      } else {
        await sendSmsRaw(fromPhone, 'Usage: /model <fast|balanced|smart|research>').catch(() => {});
      }
      return true;
    }
    case '/agent': {
      await upsertSmsUserState({ userId, mode: 'agent', proactiveMessage: null });
      await sendSmsRaw(fromPhone, 'Switched to Agent mode.').catch(() => {});
      return true;
    }
    case '/proactive': {
      await upsertSmsUserState({ userId, mode: 'proactive' });
      await sendSmsRaw(fromPhone, 'Switched to Proactive mode. You will receive proactive notifications.').catch(() => {});
      return true;
    }
    case '/new': {
      await upsertSmsUserState({ userId, conversationId: null, resumeConversationId: null });
      await sendSmsRaw(fromPhone, 'New conversation started. Previous context cleared.').catch(() => {});
      return true;
    }
    case '/help': {
      await sendSmsRaw(fromPhone, SMS_HELP_TEXT).catch(() => {});
      return true;
    }
    default:
      return false;
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
              // Relay to VM — the VM owns conversation state, memory, and multi-turn.
              // We just pass the conversationId and forward the reply as SMS.
              try {
                const vmResult = await sendVMCommand(userId, 'agent_chat', {
                  message: inboundText,
                  conversationId: smsState.conversation_id || undefined,
                  model: smsState.preferred_model || 'fast',
                  context: { source: 'sms', fromPhone },
                }, 60_000);

                if (vmResult.ok && vmResult.result?.text) {
                  const replyText = stripMarkdownForSms(String(vmResult.result.text)).slice(0, 1500);
                  await sendSmsRaw(fromPhone, replyText).catch((e: any) => {
                    console.error('[telnyx] Failed to send VM agent SMS reply:', e?.message);
                  });
                  handled = true;
                  
                  // Track conversation ID returned by VM for next turn
                  const vmConvId = vmResult.result?.conversationId || null;
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
    try {
      const body = JSON.parse(await readBody(req));
      const eventType: string = body?.data?.event_type || '';
      const callControlId: string = body?.data?.payload?.call_control_id || '';
      const direction: string = body?.data?.payload?.direction || '';

      // Inbound call: answer it, then speak a greeting
      if (eventType === 'call.initiated' && direction === 'inbound' && callControlId) {
        await fetch(`${TELNYX_API}/calls/${callControlId}/actions/answer`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TELNYX_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        });
      }

      // Call answered (outbound TTS) or after answering inbound
      if (eventType === 'call.answered' && callControlId) {
        const customHeaders: any[] = body?.data?.payload?.custom_headers || [];
        const ttsHeader = customHeaders.find((h: any) => h.name === 'X-Tts-Message');
        const voiceHeader = customHeaders.find((h: any) => h.name === 'X-Tts-Voice');
        const message = ttsHeader
          ? Buffer.from(ttsHeader.value, 'base64').toString('utf8')
          : direction === 'inbound'
            ? 'Hello, this is Stuard AI. How can I help you? Please send me a text message and I will respond shortly.'
            : 'Hello from Stuard AI.';
        const voice = voiceHeader?.value || 'female';
        await fetch(`${TELNYX_API}/calls/${callControlId}/actions/speak`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TELNYX_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            payload: message,
            voice: voice === 'male' ? 'male' : 'female',
            language: 'en-US',
          }),
        });
      }

      // TTS finished: hang up
      if (eventType === 'call.speak.ended' && callControlId) {
        await fetch(`${TELNYX_API}/calls/${callControlId}/actions/hangup`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TELNYX_API_KEY}`,
            'Content-Type': 'application/json',
          },
        });
      }
    } catch (e: any) {
      console.error('[telnyx] Call webhook error:', e?.message || e);
    }
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}
