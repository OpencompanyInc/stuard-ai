import { app, net } from 'electron';
import WebSocket from 'ws';
import { randomUUID } from 'crypto';
import logger from '../utils/logger';
import { startAgentIfNeeded } from './agent';
import {
  getMainAuthSession,
  getMainSupabaseClient,
  onMainAuthSessionChange,
} from './auth-session';

type SmsMode = 'agent' | 'proactive';
type SmsPreferredModel = 'fast' | 'balanced' | 'smart' | 'research';

type SmsQueueItem = {
  id: string;
  user_id: string;
  reply_to_phone?: string | null;
  message_text?: string | null;
  mode?: SmsMode;
  preferred_model?: SmsPreferredModel;
  conversation_id?: string | null;
  reply_sent_at?: string | null;
};

type SmsUserState = {
  mode: SmsMode;
  preferred_model: SmsPreferredModel;
  conversation_id: string | null;
  resume_conversation_id: string | null;
  last_reply_to_phone: string | null;
};

const MODEL_LABELS: Record<SmsPreferredModel, string> = {
  fast: 'Fast (DeepSeek)',
  balanced: 'Balanced (Grok)',
  smart: 'Smart (Gemini)',
  research: 'Research',
};

const HELP_TEXT =
  'Stuard SMS commands:\n' +
  '/agent - switch to direct chat mode\n' +
  '/new - start a fresh thread\n' +
  '/resume - continue your last thread\n' +
  '/model [fast|balanced|smart|research] - view or switch model\n' +
  '/session - show current SMS state\n' +
  '/help - this list\n' +
  'Or just text me anything.';

let started = false;
let authUnsub: (() => void) | null = null;
let currentChannel: any = null;
let currentChannelUserId: string | null = null;
let draining = false;
let drainQueued = false;
let reconnectTimer: NodeJS.Timeout | null = null;

function defaultSmsState(): SmsUserState {
  return {
    mode: 'agent',
    preferred_model: 'balanced',
    conversation_id: null,
    resume_conversation_id: null,
    last_reply_to_phone: null,
  };
}

function getCloudAiUrl(): string {
  return String(
    process.env.CLOUD_AI_HTTP ||
    process.env.CLOUD_PUBLIC_URL ||
    process.env.VITE_CLOUD_AI_URL ||
    '',
  ).trim().replace(/\/+$/, '') || 'http://127.0.0.1:8082';
}

function getLocalAgentWsUrl(): string {
  const raw = String(process.env.AGENT_WS || process.env.AGENT_WS_URL || '').trim();
  if (raw) return raw.endsWith('/ws') ? raw : `${raw.replace(/\/+$/, '')}/ws`;
  return 'ws://127.0.0.1:8765/ws';
}

function stripMarkdownForSms(text: string): string {
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

function normalizeMode(mode: unknown): SmsMode {
  return String(mode || '').toLowerCase() === 'proactive' ? 'proactive' : 'agent';
}

function normalizeModel(model: unknown): SmsPreferredModel {
  const raw = String(model || '').toLowerCase().trim();
  if (raw === 'fast') return 'fast';
  if (raw === 'smart') return 'smart';
  if (raw === 'research') return 'research';
  return 'balanced';
}

async function loadSmsUserState(userId: string): Promise<SmsUserState> {
  const client = getMainSupabaseClient();
  if (!client) return defaultSmsState();
  try {
    const { data, error } = await client
      .from('sms_user_state')
      .select('mode, preferred_model, conversation_id, resume_conversation_id, last_reply_to_phone')
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data) return defaultSmsState();
    return {
      mode: normalizeMode((data as any).mode),
      preferred_model: normalizeModel((data as any).preferred_model),
      conversation_id: (data as any).conversation_id ? String((data as any).conversation_id) : null,
      resume_conversation_id: (data as any).resume_conversation_id ? String((data as any).resume_conversation_id) : null,
      last_reply_to_phone: (data as any).last_reply_to_phone ? String((data as any).last_reply_to_phone) : null,
    };
  } catch {
    return defaultSmsState();
  }
}

function buildSmsHiddenContext(mode: SmsMode): string {
  const modeMarker = mode === 'proactive' ? '[PROACTIVE FOLLOW-UP]' : '[SMS MODE]';
  const contextLine = mode === 'proactive'
    ? 'Context: the user is replying to a proactive check-in. Stay in that context unless they clearly change topic.'
    : 'Context: the user is chatting with you directly over SMS.';
  return [
    modeMarker,
    'You are replying over SMS text message.',
    'Critical rules:',
    '- Plain text only. No markdown, headers, bullet syntax beyond plain text, backticks, or formatting markup.',
    '- Keep replies short. Aim for under 300 characters when possible. Hard limit 1400 characters.',
    '- No GenUI or visual components.',
    '- Be warm, direct, and conversational.',
    contextLine,
  ].join('\n');
}

async function submitSmsReply(input: {
  queueItemId: string;
  replyText: string;
  mode: SmsMode;
  preferredModel: SmsPreferredModel;
  conversationId: string | null;
  resumeConversationId: string | null;
}): Promise<void> {
  const session = getMainAuthSession();
  const token = session?.access_token;
  if (!token) throw new Error('desktop_auth_missing');

  const resp = await net.fetch(`${getCloudAiUrl()}/integrations/telnyx/sms-reply`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      queueItemId: input.queueItemId,
      replyText: input.replyText,
      mode: input.mode,
      preferredModel: input.preferredModel,
      conversationId: input.conversationId,
      resumeConversationId: input.resumeConversationId,
    }),
  });
  const data = await resp.json().catch(() => ({} as any));
  if (!resp.ok || data?.ok === false) {
    throw new Error(String(data?.error || `sms_reply_failed_${resp.status}`));
  }
}

async function completeSmsItem(queueItemId: string): Promise<void> {
  const client = getMainSupabaseClient();
  if (!client) throw new Error('supabase_main_client_unavailable');
  const { error } = await client.rpc('complete_sms_item', {
    p_queue_id: queueItemId,
    p_redact_payload: true,
  });
  if (error) throw error;
}

async function failSmsItem(queueItemId: string, errorMessage: string): Promise<void> {
  const client = getMainSupabaseClient();
  if (!client) throw new Error('supabase_main_client_unavailable');
  const { error } = await client.rpc('fail_sms_item', {
    p_queue_id: queueItemId,
    p_error_message: String(errorMessage || 'processing_failed').slice(0, 1000),
  });
  if (error) throw error;
}

async function claimNextSmsItem(userId: string): Promise<SmsQueueItem | null> {
  const client = getMainSupabaseClient();
  if (!client) return null;
  const consumerId = `desktop-main:${app.getVersion()}:${process.pid}`;
  const { data, error } = await client.rpc('claim_next_sms_item', {
    p_user_id: userId,
    p_consumer_id: consumerId,
  });
  if (error) throw error;
  if (Array.isArray(data)) return (data[0] as SmsQueueItem) || null;
  return (data as SmsQueueItem) || null;
}

// ── SMS /commands are handled on desktop ─────────────────────────────────────
// Commands are instant state operations with no AI involvement.
// Keeping them local avoids cloud round-trips and gives instant replies.
function parseSmsCommand(inputText: string): { token: string; rest: string; isCommand: boolean } {
  const trimmed = String(inputText || '').trim();
  const firstToken = trimmed.split(/\s+/)[0].toLowerCase();
  const rest = trimmed.slice(firstToken.length).trim();
  const isBareWord = ['reset', 'clear', 'new'].includes(firstToken) && !rest;
  return {
    token: isBareWord ? `/${firstToken}` : firstToken,
    rest,
    isCommand: firstToken.startsWith('/') || trimmed === '?' || isBareWord,
  };
}

function handleSmsCommand(
  rawText: string,
  state: SmsUserState,
): { handled: boolean; replyText?: string; nextState?: SmsUserState } {
  const { token, rest, isCommand } = parseSmsCommand(rawText);
  if (!isCommand) return { handled: false };

  switch (token) {
    case '/help':
    case '/commands':
    case '/menu':
    case '?':
      return { handled: true, replyText: HELP_TEXT, nextState: state };

    case '/agent':
    case '/chat':
      return {
        handled: true,
        replyText: state.conversation_id || state.resume_conversation_id
          ? 'Switched to direct chat. Your next message starts a fresh agent thread. Send /resume to jump back to the last one.'
          : 'Switched to direct chat. Your next message starts a fresh agent thread.',
        nextState: {
          ...state,
          mode: 'agent',
          resume_conversation_id: state.conversation_id || state.resume_conversation_id,
          conversation_id: null,
        },
      };

    case '/new':
    case '/reset':
    case '/clear':
      return {
        handled: true,
        replyText: state.conversation_id || state.resume_conversation_id
          ? 'Started a fresh thread. Send /resume if you want to jump back to your last conversation.'
          : 'Started a fresh thread. What can I help you with?',
        nextState: {
          ...state,
          mode: 'agent',
          resume_conversation_id: state.conversation_id || state.resume_conversation_id,
          conversation_id: null,
        },
      };

    case '/resume': {
      const resumeId = state.conversation_id || state.resume_conversation_id;
      if (!resumeId) {
        return {
          handled: true,
          replyText: 'There is no previous SMS thread to resume yet. Send a message to start one.',
          nextState: state,
        };
      }
      const alreadyActive = !!state.conversation_id && state.conversation_id === resumeId;
      return {
        handled: true,
        replyText: alreadyActive
          ? 'You are already in your current SMS thread. Keep going.'
          : 'Resumed your last SMS thread. Keep going.',
        nextState: {
          ...state,
          mode: 'agent',
          conversation_id: resumeId,
          resume_conversation_id: resumeId,
        },
      };
    }

    case '/model': {
      const choice = normalizeModel(rest);
      if (!rest) {
        return {
          handled: true,
          replyText: `Current model: ${MODEL_LABELS[state.preferred_model]}\nOptions: /model fast | /model balanced | /model smart | /model research`,
          nextState: state,
        };
      }
      const raw = String(rest || '').trim().toLowerCase();
      if (!['fast', 'balanced', 'smart', 'research'].includes(raw)) {
        return {
          handled: true,
          replyText: 'Unknown model. Use: /model fast, /model balanced, /model smart, or /model research',
          nextState: state,
        };
      }
      return {
        handled: true,
        replyText: `Model switched to ${MODEL_LABELS[choice]}.`,
        nextState: { ...state, preferred_model: choice },
      };
    }

    case '/session':
    case '/status':
      return {
        handled: true,
        replyText: `Mode: ${state.mode === 'proactive' ? 'proactive reply' : 'direct chat'} | Model: ${MODEL_LABELS[state.preferred_model]} | ${state.conversation_id ? 'active thread linked' : 'next reply starts fresh'}${state.resume_conversation_id ? ' | /resume available' : ''}`,
        nextState: state,
      };

    default:
      return { handled: false };
  }
}

async function runLocalSmsTurn(input: {
  text: string;
  mode: SmsMode;
  preferredModel: SmsPreferredModel;
  conversationId: string | null;
}): Promise<{ replyText: string; conversationId: string | null }> {
  const session = getMainAuthSession();
  const token = session?.access_token;
  if (!token) throw new Error('desktop_auth_missing');

  await startAgentIfNeeded();
  const wsUrl = getLocalAgentWsUrl();
  const requestId = `sms-${randomUUID()}`;

  return await new Promise((resolve, reject) => {
    let conversationId = input.conversationId || null;
    let done = false;
    let connectTimeout: NodeJS.Timeout | undefined;
    let runTimeout: NodeJS.Timeout | undefined;
    let ws: WebSocket;

    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      if (connectTimeout) clearTimeout(connectTimeout);
      if (runTimeout) clearTimeout(runTimeout);
      try { ws.removeAllListeners(); } catch { }
      try { ws.close(); } catch { }
      fn();
    };

    try {
      ws = new WebSocket(wsUrl);
    } catch (e: any) {
      reject(new Error(`sms_agent_ws_connect_failed: ${String(e?.message || e)}`));
      return;
    }

    connectTimeout = setTimeout(() => {
      finish(() => reject(new Error('sms_agent_ws_connect_timeout')));
    }, 15000);

    runTimeout = setTimeout(() => {
      finish(() => reject(new Error('sms_agent_turn_timeout')));
    }, 5 * 60 * 1000);

    ws.on('open', () => {
      if (connectTimeout) clearTimeout(connectTimeout);
      try {
        ws.send(JSON.stringify({
          type: 'chat',
          requestId,
          text: input.text,
          model: input.preferredModel,
          conversationId: input.conversationId || undefined,
          hiddenContext: buildSmsHiddenContext(input.mode),
          auth: { accessToken: token },
        }));
      } catch (e: any) {
        finish(() => reject(new Error(`sms_agent_ws_send_failed: ${String(e?.message || e)}`)));
      }
    });

    ws.on('message', (raw: WebSocket.RawData) => {
      let msg: any;
      try {
        msg = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw));
      } catch {
        return;
      }

      const type = String(msg?.type || '').toLowerCase();
      if (type === 'conversation' && msg?.conversationId) {
        conversationId = String(msg.conversationId);
        return;
      }
      if (type === 'final') {
        const result = msg?.result || {};
        const replyText = stripMarkdownForSms(
          String(result?.text || result?.response || '').trim(),
        ).slice(0, 1500);
        const nextConversationId = msg?.conversationId
          ? String(msg.conversationId)
          : conversationId;
        finish(() => resolve({ replyText, conversationId: nextConversationId || null }));
        return;
      }
      if (type === 'error') {
        finish(() => reject(new Error(String(msg?.message || 'sms_agent_error'))));
      }
    });

    ws.on('error', (e: Error) => {
      finish(() => reject(new Error(`sms_agent_ws_error: ${e.message}`)));
    });

    ws.on('close', () => {
      if (!done) {
        finish(() => reject(new Error('sms_agent_ws_closed')));
      }
    });
  });
}

async function processSmsItem(item: SmsQueueItem): Promise<void> {
  const userId = String(item.user_id || '').trim();
  if (!userId) throw new Error('sms_queue_user_missing');
  if (item.reply_sent_at) {
    await completeSmsItem(item.id);
    return;
  }

  const state = await loadSmsUserState(userId);
  const effectiveState: SmsUserState = {
    mode: normalizeMode(item.mode ?? state.mode),
    preferred_model: normalizeModel(item.preferred_model ?? state.preferred_model),
    conversation_id: state.conversation_id || item.conversation_id || null,
    resume_conversation_id: state.resume_conversation_id || state.conversation_id || item.conversation_id || null,
    last_reply_to_phone: state.last_reply_to_phone || item.reply_to_phone || null,
  };

  const incomingText = String(item.message_text || '').trim();
  if (!incomingText) {
    await completeSmsItem(item.id);
    return;
  }

  const commandResult = handleSmsCommand(incomingText, effectiveState);
  if (commandResult.handled && commandResult.replyText && commandResult.nextState) {
    await submitSmsReply({
      queueItemId: item.id,
      replyText: commandResult.replyText,
      mode: commandResult.nextState.mode,
      preferredModel: commandResult.nextState.preferred_model,
      conversationId: commandResult.nextState.conversation_id,
      resumeConversationId: commandResult.nextState.resume_conversation_id,
    });
    await completeSmsItem(item.id);
    return;
  }

  const turn = await runLocalSmsTurn({
    text: incomingText,
    mode: effectiveState.mode,
    preferredModel: effectiveState.preferred_model,
    conversationId: effectiveState.conversation_id,
  });
  if (!turn.replyText) {
    throw new Error('sms_empty_agent_reply');
  }

  await submitSmsReply({
    queueItemId: item.id,
    replyText: turn.replyText,
    mode: effectiveState.mode,
    preferredModel: effectiveState.preferred_model,
    conversationId: turn.conversationId,
    resumeConversationId: turn.conversationId || effectiveState.resume_conversation_id,
  });
  await completeSmsItem(item.id);
}

async function drainInbox(reason: string): Promise<void> {
  if (draining) {
    drainQueued = true;
    return;
  }

  const session = getMainAuthSession();
  const userId = session?.user?.id || null;
  if (!userId) return;

  draining = true;
  try {
    while (started) {
      const item = await claimNextSmsItem(userId);
      if (!item) break;
      try {
        logger.info(`[sms-inbox] Processing item ${item.id} (${reason})`);
        await processSmsItem(item);
      } catch (e: any) {
        logger.error('[sms-inbox] Failed to process queue item:', e);
        try { await failSmsItem(item.id, String(e?.message || e)); } catch { }
      }
    }
  } finally {
    draining = false;
    if (drainQueued) {
      drainQueued = false;
      void drainInbox('queued-rerun');
    }
  }
}

function scheduleReconnect(delayMs: number): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (!started) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (started) void reconnectListener();
  }, delayMs);
}

async function reconnectListener(): Promise<void> {
  const client = getMainSupabaseClient();
  const session = getMainAuthSession();
  const userId = session?.user?.id || null;
  if (!client) return;

  if (currentChannel) {
    try { await client.removeChannel(currentChannel); } catch { }
    currentChannel = null;
    currentChannelUserId = null;
  }

  if (!started || !session || !userId) return;

  try { client.realtime.setAuth(session.access_token); } catch { }

  // Drain any messages that arrived while we were disconnected or
  // that were already pending when we first start up.
  void drainInbox('auth-sync');

  currentChannel = client
    .channel(`sms-inbox:${userId}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'sms_inbox_queue',
      filter: `user_id=eq.${userId}`,
    }, (payload: any) => {
      logger.info(`[sms-inbox] Realtime INSERT for ${userId}, item ${payload?.new?.id}`);
      void drainInbox('realtime');
    })
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'sms_inbox_queue',
      filter: `user_id=eq.${userId}`,
    }, (payload: any) => {
      // Re-drain if a failed item becomes retryable (status back to pending/failed)
      const newStatus = payload?.new?.status;
      if (newStatus === 'pending' || newStatus === 'failed') {
        void drainInbox('realtime-update');
      }
    });

  currentChannel.subscribe((status: string) => {
    logger.info(`[sms-inbox] Realtime channel status for ${userId}: ${status}`);
    if (status === 'SUBSCRIBED') {
      // Drain any items that arrived between disconnect and now.
      void drainInbox('subscribed');
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      logger.warn(`[sms-inbox] Realtime channel ${status} for ${userId} — reconnecting in 5s`);
      scheduleReconnect(5000);
    }
  });

  currentChannelUserId = userId;
}

export function startSmsInbox(): void {
  if (started) return;
  started = true;
  authUnsub = onMainAuthSessionChange(() => {
    void reconnectListener();
  });
  void reconnectListener();
}

export function stopSmsInbox(): void {
  started = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (authUnsub) {
    try { authUnsub(); } catch { }
    authUnsub = null;
  }
  const client = getMainSupabaseClient();
  if (client && currentChannel) {
    try { client.removeChannel(currentChannel); } catch { }
  }
  currentChannel = null;
  currentChannelUserId = null;
}

export function getSmsInboxStatus(): { started: boolean; subscribedUserId: string | null; draining: boolean } {
  return {
    started,
    subscribedUserId: currentChannelUserId,
    draining,
  };
}
