/**
 * SMS Chat — Stuard agent over SMS
 *
 * Privacy model:
 *   All conversation history is stored LOCALLY on the user's desktop/VM.
 *   Supabase is used ONLY for phone number lookup (telnyx account).
 *   When the desktop is offline, sessions are ephemeral (in-memory, 30-min TTL).
 *   When the desktop is online, history is loaded from and saved to local memory.
 *
 * Session modes:
 *   proactive — last interaction was an automated proactive notification;
 *               user replies stay in that context.
 *   agent     — user explicitly switched to direct chat (/agent or /new).
 *
 * Commands:
 *   /help | ?     — list commands
 *   /agent        — switch to direct chat mode (clears proactive context)
 *   /new | /reset — clear session entirely
 *   /session      — show session status + current mode
 *
 * Call sendWelcomeSms(phone) after primary phone verification.
 */

import { runWithSecrets, withClientBridge, hasClientBridge } from '../tools/bridge';
import { getAgentForQuery } from '../agents/stuard';
import { getExternalAccount } from '../supabase';
import { TELNYX_API_KEY, TELNYX_FROM_NUMBER, TELNYX_MESSAGING_PROFILE_ID } from '../utils/config';
import { generateWithToolRecovery } from './proactive-utils';
import { getDesktopWs } from '../services/vm-bridge';
import * as localMemory from '../memory/conversations';

const TELNYX_API = 'https://api.telnyx.com/v2';

// ── Markdown → plain text ─────────────────────────────────────────────────────

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

// ── Session store (in-memory, 30-min TTL) ─────────────────────────────────────

export type SmsMode = 'proactive' | 'agent';

interface SmsMessage { role: 'user' | 'assistant'; content: string; }
interface SmsSession {
  messages: SmsMessage[];
  mode: SmsMode;
  lastActivity: number;
  /** Local memory conversation ID — only set when desktop was online at session start */
  conversationId?: string | null;
}

const SESSION_TTL_MS = 30 * 60 * 1000;
const sessions = new Map<string, SmsSession>();

function getSession(userId: string): SmsSession | null {
  const s = sessions.get(userId);
  if (!s || Date.now() - s.lastActivity > SESSION_TTL_MS) {
    sessions.delete(userId);
    return null;
  }
  return s;
}

export function appendSmsSession(
  userId: string,
  role: 'user' | 'assistant',
  content: string,
  mode?: SmsMode,
  conversationId?: string | null,
): void {
  const existing = getSession(userId);
  const messages = [...(existing?.messages ?? []), { role, content }].slice(-20);
  sessions.set(userId, {
    messages,
    mode: mode ?? existing?.mode ?? 'agent',
    lastActivity: Date.now(),
    conversationId: conversationId ?? existing?.conversationId ?? null,
  });
}

export function setSmsMode(userId: string, mode: SmsMode): void {
  const existing = getSession(userId);
  if (existing) {
    existing.mode = mode;
    existing.lastActivity = Date.now();
  }
}

export function clearSmsSession(userId: string): void {
  sessions.delete(userId);
}

function setSmsConversationId(userId: string, conversationId: string | null): void {
  const existing = getSession(userId);
  if (!existing) {
    sessions.set(userId, {
      messages: [],
      mode: 'agent',
      lastActivity: Date.now(),
      conversationId,
    });
    return;
  }
  existing.conversationId = conversationId;
  existing.lastActivity = Date.now();
}

// ── Send SMS ──────────────────────────────────────────────────────────────────

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

// ── Welcome message (sent once after primary phone verification) ──────────────

const WELCOME_MESSAGE =
  'Stuard AI ready on SMS. Text me anything — same agent as your desktop with all your tools and integrations.\n\n' +
  'Commands:\n' +
  '/agent — switch to direct chat mode\n' +
  '/new — clear conversation\n' +
  '/session — session status\n' +
  '/help — show this list';

export async function sendWelcomeSms(toPhone: string): Promise<void> {
  await sendSmsRaw(toPhone, WELCOME_MESSAGE).catch((e) =>
    console.error('[sms-chat] Welcome SMS failed:', e?.message)
  );
}

// ── SMS hint for the agent ────────────────────────────────────────────────────

function buildSmsHint(mode: SmsMode): string {
  const base =
    'You are replying via SMS text message. ' +
    'Plain text only — no markdown, asterisks, hashtags, or backticks. ' +
    'Keep replies under 300 characters when possible (hard limit 1400). ' +
    'Be direct and conversational.';
  if (mode === 'proactive') {
    return (
      base +
      ' The user is replying to an automated check-in you sent. ' +
      'Stay in that context unless they ask for something else.'
    );
  }
  return base + ' The user is chatting with you directly as their personal AI assistant.';
}

// ── Local memory helpers (run inside bridge context) ─────────────────────────

const SMS_CONV_TITLE_PREFIX = 'SMS:';

/**
 * Find the most recent active SMS conversation in local memory, or create a new one.
 * Must be called from within a bridge context (desktop online).
 */
async function getOrCreateLocalSmsConversation(
  mode: SmsMode,
  existingId?: string | null,
): Promise<string | null> {
  // Try to resume existing conversation from this session
  if (existingId) {
    const conv = await localMemory.getConversation(existingId).catch(() => null);
    if (conv && conv.status === 'active') return conv.id;
  }

  // Look for a recent SMS conversation (updated in last 2 hours)
  const recent = await localMemory.listConversations({ status: 'active', limit: 10 }).catch(() => []);
  const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
  const smsConv = recent.find(
    (c) => c.title?.startsWith(SMS_CONV_TITLE_PREFIX) && new Date(c.updated_at).getTime() > twoHoursAgo,
  );
  if (smsConv) return smsConv.id;

  // Create a new SMS conversation
  const source = mode === 'proactive' ? 'proactive' : 'stuard';
  const title = `${SMS_CONV_TITLE_PREFIX} ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  const conv = await localMemory.createConversation(title, 'balanced', undefined, source).catch(() => null);
  return conv?.id ?? null;
}

// ── Agent caller ──────────────────────────────────────────────────────────────

async function runAgent(
  userId: string,
  toPhone: string,
  userMessage: string,
  mode: SmsMode,
  session: SmsSession | null,
): Promise<void> {
  const run = async () => {
    const online = hasClientBridge();
    let conversationId = session?.conversationId ?? null;
    let history: SmsMessage[] = session?.messages?.filter((m) => m.role === 'user' || m.role === 'assistant') ?? [];

    // ── Load / persist history from local memory (desktop online) ──────────
    if (online) {
      conversationId = await getOrCreateLocalSmsConversation(mode, conversationId);
      if (conversationId) {
        setSmsConversationId(userId, conversationId);

        // Load full history from local DB (overrides stale in-memory session)
        const msgs = await localMemory.getMessages(conversationId, { limit: 20 }).catch(() => []);
        if (msgs.length > 0) {
          history = msgs
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
        }

        // Persist the incoming user message
        await localMemory.addMessage(conversationId, 'user', userMessage, {
          metadata: { mode, source: 'sms' },
        }).catch(() => {});
      }
    }

    // ── Resolve enabled integrations ────────────────────────────────────────
    const providers = ['github', 'google', 'outlook'];
    const checks = await Promise.allSettled(providers.map((p) => getExternalAccount(userId, p)));
    const enabledIntegrations = providers.filter((_, i) => {
      const r = checks[i];
      return r.status === 'fulfilled' && !!r.value;
    });

    // ── Run agent ───────────────────────────────────────────────────────────
    const agent = await getAgentForQuery('balanced', userMessage, undefined, enabledIntegrations);

    const baseMessages = [
      { role: 'system' as const, content: buildSmsHint(mode) },
      ...history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      { role: 'user' as const, content: userMessage },
    ];

    try {
      const response: any = await generateWithToolRecovery({
        agent: agent as any,
        baseMessages,
        maxSteps: 8,
        maxRetries: 2,
      });
      const reply = stripMarkdownForSms(response?.text ?? '');
      if (reply) {
        appendSmsSession(userId, 'assistant', reply, mode, conversationId);

        // Persist the assistant reply locally
        if (online && conversationId) {
          await localMemory.addMessage(conversationId, 'assistant', reply, {
            metadata: { mode, source: 'sms' },
          }).catch(() => {});
        }

        await sendSmsRaw(toPhone, reply);
      }
    } catch (e: any) {
      console.error('[sms-chat] Agent error:', e?.message ?? e);
      await sendSmsRaw(toPhone, 'Something went wrong. Try again or send /new.').catch(() => {});
    }
  };

  const desktopWs = getDesktopWs(userId);
  if (desktopWs) {
    await withClientBridge(desktopWs, run, { userId });
  } else {
    await runWithSecrets({ userId }, run);
  }
}

// ── Command dispatcher ────────────────────────────────────────────────────────

const HELP_TEXT =
  'Stuard SMS commands:\n' +
  '/agent — switch to direct chat (clears proactive context)\n' +
  '/new — clear conversation\n' +
  '/session — show session status\n' +
  '/help — show this list\n' +
  'Or just text me anything.';

async function dispatchCommand(token: string, userId: string, toPhone: string): Promise<boolean> {
  switch (token) {
    case '/help':
    case '/commands':
    case '?':
      await sendSmsRaw(toPhone, HELP_TEXT);
      return true;

    case '/agent':
    case '/chat': {
      clearSmsSession(userId);
      sessions.set(userId, { messages: [], mode: 'agent', lastActivity: Date.now(), conversationId: null });
      await sendSmsRaw(toPhone, 'Switched to direct chat. What can I help you with?');
      return true;
    }

    case '/new':
    case '/reset':
    case '/clear':
      clearSmsSession(userId);
      await sendSmsRaw(toPhone, 'Conversation cleared. What can I help you with?');
      return true;

    case '/session':
    case '/status': {
      const s = getSession(userId);
      if (!s) {
        await sendSmsRaw(toPhone, 'No active session. Just text me to start.');
      } else {
        const minsAgo = Math.round((Date.now() - s.lastActivity) / 60_000);
        const modeLabel = s.mode === 'proactive' ? 'proactive reply' : 'direct chat';
        const memLabel = s.conversationId ? ' (history saved locally)' : ' (desktop offline — ephemeral)';
        await sendSmsRaw(
          toPhone,
          `Mode: ${modeLabel} | ${s.messages.length} messages | last active ${minsAgo} min ago${memLabel}.\n/agent to chat directly, /new to clear.`,
        );
      }
      return true;
    }

    default:
      return false;
  }
}

// ── Main inbound handler ───────────────────────────────────────────────────────

export async function handleInboundSms(userId: string, userMessage: string, replyToPhone?: string): Promise<void> {
  // Supabase used only for phone number lookup
  const acc = await getExternalAccount(userId, 'telnyx');
  const fallbackPhone = String(acc?.meta?.phone ?? '');
  const secondaryPhone = String(acc?.meta?.phone2 ?? '');
  const toPhone =
    replyToPhone && (replyToPhone === fallbackPhone || replyToPhone === secondaryPhone)
      ? replyToPhone
      : fallbackPhone;
  if (!toPhone) {
    console.error('[sms-chat] No verified phone for user', userId);
    return;
  }

  const trimmed = userMessage.trim();
  const firstToken = trimmed.split(/\s+/)[0].toLowerCase();
  const isBareWord = ['reset', 'clear', 'new'].includes(firstToken) && trimmed === firstToken;
  const isCommand = firstToken.startsWith('/') || trimmed === '?' || isBareWord;

  if (isCommand) {
    const handled = await dispatchCommand(isBareWord ? `/${firstToken}` : firstToken, userId, toPhone);
    if (handled) return;
    // Unknown command — fall through to agent
  }

  const session = getSession(userId);
  const mode: SmsMode = session?.mode ?? 'agent';

  // Append to in-memory session immediately (agent run will update with persisted conversationId)
  appendSmsSession(userId, 'user', trimmed, mode, session?.conversationId ?? null);

  await runAgent(userId, toPhone, trimmed, mode, getSession(userId));
}
