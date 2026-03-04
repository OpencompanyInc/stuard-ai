import type { IncomingMessage, ServerResponse } from 'http';
import { randomInt } from 'crypto';
import { upsertExternalAccount, getExternalAccount } from '../../supabase';
import { authenticateHttpLegacy, sendJson, sendAuthError } from '../../auth/http';
import { AuthErrorCode } from '../../auth';
import { TELNYX_API_KEY, TELNYX_FROM_NUMBER, TELNYX_MESSAGING_PROFILE_ID } from '../../utils/config';

const TELNYX_API = 'https://api.telnyx.com/v2';

const pendingVerifications = new Map<string, { code: string; phone: string; expiresAt: number }>();

function normalizePhone(raw: string): string {
  let digits = raw.replace(/[^\d+]/g, '');
  if (!digits.startsWith('+')) digits = '+' + digits;
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
  const body: any = {
    from: TELNYX_FROM_NUMBER,
    to,
    text,
  };
  if (TELNYX_MESSAGING_PROFILE_ID) {
    body.messaging_profile_id = TELNYX_MESSAGING_PROFILE_ID;
  }
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

export async function handleTelnyxRoutes(req: IncomingMessage, res: ServerResponse, parsedUrl: URL): Promise<boolean> {
  const { pathname } = parsedUrl;

  // ── Status: check if user has verified phone ─────────────────────────────
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
    });
    return true;
  }

  // ── Request verification code ─────────────────────────────────────────────
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
      pendingVerifications.set(auth.userId, {
        code,
        phone,
        expiresAt: Date.now() + 10 * 60 * 1000,
      });

      await telnyxSendSms(phone, `Your Stuard verification code is: ${code}`);

      sendJson(res, 200, { ok: true, message: 'Verification code sent.' });
    } catch (e: any) {
      sendJson(res, 500, { ok: false, error: String(e?.message || e) });
    }
    return true;
  }

  // ── Verify code and store phone ───────────────────────────────────────────
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

      await upsertExternalAccount({
        userId: auth.userId,
        provider: 'telnyx',
        access_token: 'verified',
        scopes: ['sms', 'voice'],
        meta: {
          phone: pending.phone,
          verified: true,
          verifiedAt: new Date().toISOString(),
        },
      });

      sendJson(res, 200, { ok: true, phone: pending.phone, verified: true });
    } catch (e: any) {
      sendJson(res, 500, { ok: false, error: String(e?.message || e) });
    }
    return true;
  }

  // ── Disconnect / remove verified phone ────────────────────────────────────
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

  // ── Call webhook (Telnyx sends call events here) ──────────────────────────
  if (req.method === 'POST' && pathname === '/integrations/telnyx/call-webhook') {
    try {
      const body = JSON.parse(await readBody(req));
      const eventType = body?.data?.event_type;
      const callControlId = body?.data?.payload?.call_control_id;

      if (eventType === 'call.answered' && callControlId) {
        const customHeaders = body?.data?.payload?.custom_headers || [];
        const ttsHeader = customHeaders.find((h: any) => h.name === 'X-Tts-Message');
        const voiceHeader = customHeaders.find((h: any) => h.name === 'X-Tts-Voice');
        const message = ttsHeader ? Buffer.from(ttsHeader.value, 'base64').toString('utf8') : 'Hello from Stuard AI.';
        const voice = voiceHeader?.value || 'female';

        await fetch(`https://api.telnyx.com/v2/calls/${callControlId}/actions/speak`, {
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

      if (eventType === 'call.speak.ended' && callControlId) {
        await fetch(`https://api.telnyx.com/v2/calls/${callControlId}/actions/hangup`, {
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
