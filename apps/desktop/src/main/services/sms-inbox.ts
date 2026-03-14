import { app, net } from 'electron';
import WebSocket from 'ws';
import { randomUUID } from 'crypto';
import logger from '../utils/logger';
import { startAgentIfNeeded } from './agent';
import { execTool } from '../tools';
import type { RouterContext } from '../tools/types';
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
  provider?: string | null;
  reply_to_phone?: string | null;
  message_text?: string | null;
  mode?: SmsMode;
  preferred_model?: SmsPreferredModel;
  conversation_id?: string | null;
  reply_sent_at?: string | null;
  metadata?: any;
};

type SmsUserState = {
  mode: SmsMode;
  preferred_model: SmsPreferredModel;
  conversation_id: string | null;
  resume_conversation_id: string | null;
  last_reply_to_phone: string | null;
  proactive_message: string | null;
};

// Tools that need explicit SMS approval before the desktop executes them
const SMS_PERMISSION_TOOLS = new Set([
  'run_command', 'run_system_command', 'run_python_script', 'run_node_script',
  'capture_media', 'capture_screen', 'capture_system_audio',
  'terminal_create', 'terminal_send_input', 'terminal_send_raw', 'terminal_send_keys',
]);

type PendingToolPermission = {
  toolId: string;
  toolName: string;
  allow: (yes: boolean) => void;
};

// One pending tool permission per userId at a time
const pendingToolPermissions = new Map<string, PendingToolPermission>();

const MODEL_LABELS: Record<SmsPreferredModel, string> = {
  fast: 'Fast (Gemini Flash)',
  balanced: 'Balanced (GPT-5)',
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
    proactive_message: null,
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

function getCloudAiWsUrl(): string {
  if (process.env.CLOUD_AI_WS) return String(process.env.CLOUD_AI_WS).trim();
  const http = getCloudAiUrl().replace(/\/+$/, '');
  const ws = http.startsWith('https://')
    ? 'wss://' + http.slice(8)
    : 'ws://' + http.slice(http.startsWith('http://') ? 7 : 0);
  return ws.endsWith('/ws') ? ws : ws + '/ws';
}

async function sendSmsNotify(toPhone: string, text: string, provider?: string | null): Promise<void> {
  const session = getMainAuthSession();
  const token = session?.access_token;
  if (!token || !toPhone) return;
  try {
    const isWhatsApp = String(provider || '').toLowerCase() === 'whatsapp';
    const endpoint = isWhatsApp
      ? `${getCloudAiUrl()}/integrations/whatsapp/wa-notify`
      : `${getCloudAiUrl()}/integrations/telnyx/sms-notify`;
    const bodyPayload = isWhatsApp
      ? { waId: toPhone.replace(/^\+/, ''), text }
      : { to: toPhone, text };
    const resp = await net.fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(bodyPayload),
    });
    if (!resp.ok) logger.warn(`[sms-inbox] ${isWhatsApp ? 'wa' : 'sms'}-notify failed: ${resp.status}`);
  } catch (e: any) {
    logger.warn('[sms-inbox] notify error:', e?.message);
  }
}

// GSM-7 concatenated: 153 chars/segment × 10 segments = 1530
// Unicode concatenated:  67 chars/segment × 10 segments = 670
// WhatsApp: 4096 char limit
function truncateForSms(text: string, provider?: string | null): string {
  if (String(provider || '').toLowerCase() === 'whatsapp') {
    return text.slice(0, 4096);
  }
  const isUnicode = /[^\x00-\x7F]/.test(text);
  return text.slice(0, isUnicode ? 670 : 1530);
}

function stripMarkdownForSms(text: string): string {
  return text
    // Normalize common AI-generated Unicode chars to GSM-7 ASCII equivalents
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
    .replace(/\u2014|\u2015/g, '--')
    .replace(/\u2013/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u2022\u2023\u25E6\u2043\u00B7]/g, '-')
    .replace(/\u2212/g, '-')
    .replace(/\u00D7/g, 'x')
    // Markdown stripping
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
      .select('mode, preferred_model, conversation_id, resume_conversation_id, last_reply_to_phone, proactive_message')
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data) return defaultSmsState();
    return {
      mode: normalizeMode((data as any).mode),
      preferred_model: normalizeModel((data as any).preferred_model),
      conversation_id: (data as any).conversation_id ? String((data as any).conversation_id) : null,
      resume_conversation_id: (data as any).resume_conversation_id ? String((data as any).resume_conversation_id) : null,
      last_reply_to_phone: (data as any).last_reply_to_phone ? String((data as any).last_reply_to_phone) : null,
      proactive_message: (data as any).proactive_message ? String((data as any).proactive_message) : null,
    };
  } catch {
    return defaultSmsState();
  }
}

function buildSmsHiddenContext(mode: SmsMode, proactiveMessage?: string | null): string {
  const modeMarker = mode === 'proactive' ? '[PROACTIVE FOLLOW-UP]' : '[SMS MODE]';
  const contextLine = mode === 'proactive'
    ? 'Context: the user is replying to a proactive check-in. Stay in that context unless they clearly change topic.'
    : 'Context: the user is chatting with you directly over SMS.';
  const lines = [
    modeMarker,
    'You are replying over SMS text message.',
    'Critical rules:',
    '- Plain text only. No markdown, headers, bullet syntax beyond plain text, backticks, or formatting markup.',
    '- Keep replies short. Aim for under 300 characters when possible. Hard limit 600 characters.',
    '- Use only plain ASCII characters. No smart quotes, em dashes, ellipsis glyphs, or other Unicode.',
    '- No GenUI or visual components.',
    '- Be warm, direct, and conversational.',
    contextLine,
  ];
  if (mode === 'proactive' && proactiveMessage) {
    lines.push(`Your original proactive message was:\n${proactiveMessage}`);
  }
  return lines.join('\n');
}

async function submitSmsReply(input: {
  queueItemId: string;
  replyText: string;
  mode: SmsMode;
  preferredModel: SmsPreferredModel;
  conversationId: string | null;
  resumeConversationId: string | null;
  provider?: string | null;
}): Promise<void> {
  const session = getMainAuthSession();
  const token = session?.access_token;
  if (!token) throw new Error('desktop_auth_missing');

  const isWhatsApp = String(input.provider || '').toLowerCase() === 'whatsapp';
  const endpoint = isWhatsApp
    ? `${getCloudAiUrl()}/integrations/whatsapp/wa-reply`
    : `${getCloudAiUrl()}/integrations/telnyx/sms-reply`;

  const resp = await net.fetch(endpoint, {
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
    case '/chat': {
      const wasProactive = state.mode === 'proactive';
      const keepConversation = !wasProactive && state.conversation_id;
      return {
        handled: true,
        replyText: wasProactive
          ? 'Switched to direct chat. Send /new to start a fresh thread or just keep texting.'
          : state.conversation_id
            ? 'Already in direct chat. Send /new to start a fresh thread.'
            : 'Switched to direct chat. Send a message to start.',
        nextState: {
          ...state,
          mode: 'agent',
          resume_conversation_id: keepConversation
            ? state.resume_conversation_id
            : (state.conversation_id || state.resume_conversation_id),
          conversation_id: keepConversation ? state.conversation_id : null,
          proactive_message: null,
        },
      };
    }

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

async function runSmsTurn(input: {
  text: string;
  mode: SmsMode;
  preferredModel: SmsPreferredModel;
  conversationId: string | null;
  userId: string;
  replyToPhone: string;
  proactiveMessage?: string | null;
  provider?: string | null;
}): Promise<{ replyText: string; conversationId: string | null }> {
  const session = getMainAuthSession();
  const token = session?.access_token;
  if (!token) throw new Error('desktop_auth_missing');

  // Ensure local agent is running for any local tool execution
  await startAgentIfNeeded();

  const wsUrl = getCloudAiWsUrl();
  const requestId = `sms-${randomUUID()}`;

  const toolCtx: RouterContext = {
    agentWsUrl: getLocalAgentWsUrl(),
    cloudAiUrl: getCloudAiUrl(),
    logFn: (msg) => logger.info(`[sms-tool] ${msg}`),
    accessToken: token,
  };

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
      // Clean up any pending permission for this user
      pendingToolPermissions.delete(input.userId);
      try { ws.removeAllListeners(); } catch { }
      try { ws.close(); } catch { }
      fn();
    };

    const wsSend = (msg: unknown) => {
      try { ws.send(JSON.stringify(msg)); } catch { }
    };

    try {
      ws = new WebSocket(wsUrl);
    } catch (e: any) {
      reject(new Error(`sms_cloud_ws_connect_failed: ${String(e?.message || e)}`));
      return;
    }

    connectTimeout = setTimeout(() => {
      finish(() => reject(new Error('sms_cloud_ws_connect_timeout')));
    }, 15000);

    runTimeout = setTimeout(() => {
      finish(() => reject(new Error('sms_agent_turn_timeout')));
    }, 5 * 60 * 1000);

    ws.on('open', () => {
      if (connectTimeout) clearTimeout(connectTimeout);
      try {
        wsSend({
          type: 'chat',
          requestId,
          text: input.text,
          model: input.preferredModel,
          conversationId: input.conversationId || undefined,
          hiddenContext: buildSmsHiddenContext(input.mode, input.proactiveMessage),
          auth: { accessToken: token },
        });
      } catch (e: any) {
        finish(() => reject(new Error(`sms_cloud_ws_send_failed: ${String(e?.message || e)}`)));
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

      // ── Tool request: act as the desktop tool bridge ──────────────────────
      if (type === 'tool_request') {
        const toolId = String(msg?.id || '');
        const toolName = String(msg?.tool || '');
        const args = msg?.args ?? {};
        if (!toolId || !toolName) return;

        if (SMS_PERMISSION_TOOLS.has(toolName)) {
          // Suspend run timeout while waiting for user response
          if (runTimeout) { clearTimeout(runTimeout); runTimeout = undefined; }

          const permissionTimer = setTimeout(() => {
            pendingToolPermissions.delete(input.userId);
            wsSend({ type: 'tool_result', id: toolId, result: { ok: false, error: 'permission_timeout' } });
          }, 15 * 60 * 1000);

          pendingToolPermissions.set(input.userId, {
            toolId,
            toolName,
            allow: (yes) => {
              clearTimeout(permissionTimer);
              if (!yes) {
                wsSend({ type: 'tool_result', id: toolId, result: { ok: false, error: 'permission_denied' } });
                return;
              }
              execTool(toolName, args, toolCtx)
                .then(result => wsSend({ type: 'tool_result', id: toolId, result }))
                .catch(e => wsSend({ type: 'tool_result', id: toolId, result: { ok: false, error: String(e?.message || e) } }));
            },
          });

          const argsPreview = JSON.stringify(args).slice(0, 120);
          void sendSmsNotify(
            input.replyToPhone,
            `Stuard wants to run: ${toolName}\n${argsPreview}\nReply YES to allow, NO to deny.`,
            input.provider,
          );
          return;
        }

        // Non-permission tool: execute and relay result immediately
        execTool(toolName, args, toolCtx)
          .then(result => wsSend({ type: 'tool_result', id: toolId, result }))
          .catch(e => wsSend({ type: 'tool_result', id: toolId, result: { ok: false, error: String(e?.message || e) } }));
        return;
      }

      if (type === 'final') {
        const result = msg?.result || {};
        const replyText = truncateForSms(stripMarkdownForSms(
          String(result?.text || result?.response || '').trim(),
        ), input.provider);
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
      finish(() => reject(new Error(`sms_cloud_ws_error: ${e.message}`)));
    });

    ws.on('close', () => {
      if (!done) {
        finish(() => reject(new Error('sms_cloud_ws_closed')));
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
    proactive_message: state.proactive_message || null,
  };

  const incomingText = String(item.message_text || '').trim();
  if (!incomingText) {
    await completeSmsItem(item.id);
    return;
  }

  // ── Tool permission response: user replied YES/NO to a running tool ───────
  const pendingPermission = pendingToolPermissions.get(userId);
  if (pendingPermission) {
    const normalized = incomingText.toLowerCase().trim();
    const isYes = normalized === 'yes' || normalized === 'y';
    const isNo = normalized === 'no' || normalized === 'n' || normalized === 'deny';
    if (isYes || isNo) {
      pendingToolPermissions.delete(userId);
      pendingPermission.allow(isYes);
      // The allow() call sends tool_result back over the open WS; just complete this queue item
      await completeSmsItem(item.id);
      return;
    }
    // Not a YES/NO — fall through; the permission stays pending
  }

  // ── SMS commands ──────────────────────────────────────────────────────────
  const itemProvider = item.provider || 'telnyx';
  const commandResult = handleSmsCommand(incomingText, effectiveState);
  if (commandResult.handled && commandResult.replyText && commandResult.nextState) {
    await submitSmsReply({
      queueItemId: item.id,
      replyText: commandResult.replyText,
      mode: commandResult.nextState.mode,
      preferredModel: commandResult.nextState.preferred_model,
      conversationId: commandResult.nextState.conversation_id,
      resumeConversationId: commandResult.nextState.resume_conversation_id,
      provider: itemProvider,
    });
    await completeSmsItem(item.id);
    return;
  }

  // ── Agent turn (direct cloud WS with full tool bridge) ───────────────────
  const replyToPhone = String(item.reply_to_phone || effectiveState.last_reply_to_phone || '');
  const turn = await runSmsTurn({
    text: incomingText,
    mode: effectiveState.mode,
    preferredModel: effectiveState.preferred_model,
    conversationId: effectiveState.conversation_id,
    userId,
    replyToPhone,
    proactiveMessage: effectiveState.proactive_message,
    provider: itemProvider,
  });
  if (!turn.replyText) throw new Error('sms_empty_agent_reply');

  await submitSmsReply({
    queueItemId: item.id,
    replyText: turn.replyText,
    mode: effectiveState.mode,
    preferredModel: effectiveState.preferred_model,
    conversationId: turn.conversationId,
    resumeConversationId: turn.conversationId || effectiveState.resume_conversation_id,
    provider: itemProvider,
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
      let item: SmsQueueItem | null;
      try {
        item = await claimNextSmsItem(userId);
      } catch (e: any) {
        logger.error('[sms-inbox] Failed to claim next SMS item:', e);
        break;
      }
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
  logger.info(`[sms-inbox] reconnectListener: client=${!!client} session=${!!session} userId=${userId} started=${started}`);
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

  const ch = client
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
      const newStatus = payload?.new?.status;
      if (newStatus === 'pending' || newStatus === 'failed') {
        void drainInbox('realtime-update');
      }
    });

  ch.subscribe((status: string) => {
    if (ch !== currentChannel) return; // stale channel removed intentionally, ignore
    logger.info(`[sms-inbox] Realtime channel status for ${userId}: ${status}`);
    if (status === 'SUBSCRIBED') {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      void drainInbox('subscribed');
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      logger.warn(`[sms-inbox] Realtime channel ${status} for ${userId} — reconnecting in 5s`);
      scheduleReconnect(5000);
    }
  });

  currentChannel = ch;
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
