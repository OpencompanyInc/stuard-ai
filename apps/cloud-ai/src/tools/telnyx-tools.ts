import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getExternalAccount, debitCredits } from '../supabase';
import { getBridgeSecrets } from './bridge';
import { TELNYX_API_KEY, TELNYX_FROM_NUMBER, TELNYX_MESSAGING_PROFILE_ID } from '../utils/config';
import { messagingCreditCost } from '../pricing';

const TELNYX_API = 'https://api.telnyx.com/v2';

async function requireUserId(): Promise<string> {
  const secrets = getBridgeSecrets();
  const userId = String((secrets as any)?.userId || '');
  if (!userId) throw new Error('missing_user_context');
  return userId;
}

async function getVerifiedPhone(userId: string): Promise<string> {
  const acc = await getExternalAccount(userId, 'telnyx');
  if (!acc) throw new Error('telnyx_not_connected: No verified phone number found. The user must verify their phone number in Integrations before using SMS/Call tools.');
  const meta = acc.meta || {};
  if (!meta.verified) throw new Error('telnyx_not_verified: Phone number has not been verified yet.');
  return meta.phone;
}

async function telnyxRequest(path: string, method: string, body?: any): Promise<any> {
  if (!TELNYX_API_KEY) throw new Error('Telnyx API key not configured on server.');
  const res = await fetch(`${TELNYX_API}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${TELNYX_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errMsg = (json as any)?.errors?.[0]?.detail || (json as any)?.error || res.statusText;
    throw new Error(`Telnyx API error (${res.status}): ${errMsg}`);
  }
  return json;
}

// ── Send SMS ────────────────────────────────────────────────────────────────

export const telnyx_send_sms = createTool({
  id: 'telnyx_send_sms',
  description: 'Send an SMS message to the user\'s verified phone number. Only works with verified numbers.',
  inputSchema: z.object({
    message: z.string().describe('The text message to send (max 1600 characters).'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    messageId: z.string().optional(),
    to: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (input) => {
    try {
      const userId = await requireUserId();
      const phone = await getVerifiedPhone(userId);

      const body: any = {
        from: TELNYX_FROM_NUMBER,
        to: phone,
        text: String(input.message || '').slice(0, 1600),
      };
      if (TELNYX_MESSAGING_PROFILE_ID) {
        body.messaging_profile_id = TELNYX_MESSAGING_PROFILE_ID;
      }

      const result = await telnyxRequest('/messages', 'POST', body);
      // Deduct messaging credits
      const credits = messagingCreditCost('telnyx');
      if (credits > 0) {
        debitCredits(userId, {
          sourceType: 'messaging:telnyx',
          sourceRef: `sms_tool:${result?.data?.id || Date.now()}`,
          credits,
          amountUsd: 0.004,
          metadata: { provider: 'telnyx', tool: 'telnyx_send_sms' },
        }).catch((e: any) => console.error('[telnyx-tools] credit deduction failed:', e?.message));
      }
      return {
        ok: true,
        messageId: result?.data?.id || '',
        to: phone,
      };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  },
});

// ── Make Call ────────────────────────────────────────────────────────────────

export const telnyx_make_call = createTool({
  id: 'telnyx_make_call',
  description: 'Make a voice call to the user\'s verified phone number and speak a message using TTS.',
  inputSchema: z.object({
    message: z.string().describe('The message to speak when the call is answered (text-to-speech).'),
    voice: z.enum(['female', 'male']).default('female').describe('TTS voice gender.'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    callControlId: z.string().optional(),
    to: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (input) => {
    try {
      const userId = await requireUserId();
      const phone = await getVerifiedPhone(userId);

      const callResult = await telnyxRequest('/calls', 'POST', {
        connection_id: process.env.TELNYX_SIP_CONNECTION_ID || '',
        to: phone,
        from: TELNYX_FROM_NUMBER,
        answering_machine_detection: 'detect',
        webhook_url: `${process.env.CLOUD_PUBLIC_URL || ''}/integrations/telnyx/call-webhook`,
        webhook_url_method: 'POST',
        custom_headers: [
          { name: 'X-Tts-Message', value: Buffer.from(input.message).toString('base64') },
          { name: 'X-Tts-Voice', value: input.voice || 'female' },
        ],
      });

      return {
        ok: true,
        callControlId: callResult?.data?.call_control_id || '',
        to: phone,
      };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  },
});

// ── Get Phone Status ────────────────────────────────────────────────────────

export const telnyx_phone_status = createTool({
  id: 'telnyx_phone_status',
  description: 'Check if the user has a verified phone number for SMS/Call notifications.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    ok: z.boolean(),
    verified: z.boolean(),
    phone: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async () => {
    try {
      const userId = await requireUserId();
      const acc = await getExternalAccount(userId, 'telnyx');
      if (!acc) return { ok: true, verified: false };
      const meta = acc.meta || {};
      return {
        ok: true,
        verified: !!meta.verified,
        phone: meta.verified ? meta.phone : undefined,
      };
    } catch (e: any) {
      return { ok: false, verified: false, error: String(e?.message || e) };
    }
  },
});
