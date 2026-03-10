/**
 * SMS helpers shared by inbound queueing, proactive SMS, and reply submission.
 *
 * SMS execution now belongs to the desktop app. Cloud-ai only formats and sends
 * SMS payloads and welcomes newly-verified users.
 */

import { TELNYX_API_KEY, TELNYX_FROM_NUMBER, TELNYX_MESSAGING_PROFILE_ID } from '../utils/config';

const TELNYX_API = 'https://api.telnyx.com/v2';

export function stripMarkdownForSms(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```[^\n]*\n?/g, '').replace(/```$/g, '').trim())
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_\n]+)_/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[\t ]*[-*+]\s+/gm, '• ')
    .replace(/^[\t ]*\d+\.\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function sendSmsRaw(to: string, text: string): Promise<void> {
  if (!TELNYX_API_KEY || !TELNYX_FROM_NUMBER) throw new Error('Telnyx not configured');
  const body: any = { from: TELNYX_FROM_NUMBER, to, text: text.slice(0, 1500) };
  if (TELNYX_MESSAGING_PROFILE_ID) body.messaging_profile_id = TELNYX_MESSAGING_PROFILE_ID;
  const res = await fetch(`${TELNYX_API}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any)?.errors?.[0]?.detail ?? `SMS failed (${res.status})`);
  }
}

const WELCOME_MESSAGE =
  'Stuard AI ready on SMS. Text me anything and your desktop agent will pick it up.\n\n' +
  'Commands: /agent /new /model /session /help';

export async function sendWelcomeSms(toPhone: string): Promise<void> {
  await sendSmsRaw(toPhone, WELCOME_MESSAGE).catch((e) =>
    console.error('[sms-utils] Welcome SMS failed:', e?.message)
  );
}
