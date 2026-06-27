import { app, net } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
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
import { registerIncomingMessagingMedia, type MediaLibraryItem } from './media-library';
import { WHATSAPP_INTEGRATION_ENABLED } from '../../../../../shared/integration-flags';

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

/**
 * Format tool args into a human-readable SMS description instead of raw JSON.
 */
function formatToolArgsForSms(toolName: string, args: any): string {
  try {
    if (toolName === 'capture_media') {
      const kind = String(args?.kind || 'photo');
      const mode = String(args?.mode || 'fixed');
      const dur = args?.duration ? ` for ${args.duration}s` : '';
      return `take a ${kind}${dur} (${mode} mode)`;
    }
    if (toolName === 'capture_screen') {
      return 'take a screenshot';
    }
    if (toolName === 'capture_system_audio') {
      const dur = args?.duration ? ` for ${args.duration}s` : '';
      return `record system audio${dur}`;
    }
    if (toolName === 'run_command') {
      const cmd = String(args?.command || '').slice(0, 80);
      return `run command: ${cmd}`;
    }
    if (toolName === 'run_python_script') {
      return 'run a Python script';
    }
    if (toolName.startsWith('terminal_')) {
      const action = toolName.replace('terminal_', '');
      return `terminal ${action}`;
    }
  } catch {}
  // Fallback
  return `${toolName}`;
}

// Tools that need explicit SMS approval before the desktop executes them
const SMS_PERMISSION_TOOLS = new Set([
  'run_command', 'run_python_script', 'run_node_script',
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
let currentChannelStatus: 'idle' | 'connecting' | 'subscribed' | 'closed' | 'error' | 'timed_out' = 'idle';
let draining = false;
let drainQueued = false;
let reconnectTimer: NodeJS.Timeout | null = null;

function mapRealtimeChannelStatus(status: string): typeof currentChannelStatus {
  switch (status) {
    case 'SUBSCRIBED':
      return 'subscribed';
    case 'CHANNEL_ERROR':
      return 'error';
    case 'TIMED_OUT':
      return 'timed_out';
    case 'CLOSED':
      return 'closed';
    default:
      return 'connecting';
  }
}

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

// ── Device-owned SMS thread pointer ──────────────────────────────────────────
// The conversation id for a text thread lives on the device, not in Supabase.
// Generating it here (and persisting the active pointer locally) means a text
// thread compounds into one conversation across turns without depending on a
// Supabase `sms_user_state` round-trip — that round-trip raced the next inbound
// webhook and made every text look like a brand-new chat. The conversation rows
// themselves sync to the VM via the normal desktop↔VM memory sync.
type LocalSmsThread = { conversationId: string | null; resumeConversationId: string | null };

const SMS_THREADS_FILE = path.join(app.getPath('userData'), 'sms-threads.json');
let smsThreadsCache: Record<string, LocalSmsThread> | null = null;

function loadLocalSmsThreads(): Record<string, LocalSmsThread> {
  if (smsThreadsCache) return smsThreadsCache;
  try {
    if (fs.existsSync(SMS_THREADS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SMS_THREADS_FILE, 'utf8'));
      if (data && typeof data === 'object') {
        smsThreadsCache = data as Record<string, LocalSmsThread>;
        return smsThreadsCache;
      }
    }
  } catch (e: any) {
    logger.warn('[sms-inbox] Failed to load local SMS threads:', e?.message);
  }
  smsThreadsCache = {};
  return smsThreadsCache;
}

function getLocalSmsThread(userId: string): LocalSmsThread {
  const all = loadLocalSmsThreads();
  return all[userId] || { conversationId: null, resumeConversationId: null };
}

function setLocalSmsThread(userId: string, patch: Partial<LocalSmsThread>): LocalSmsThread {
  const all = loadLocalSmsThreads();
  const next: LocalSmsThread = {
    conversationId: patch.conversationId !== undefined ? patch.conversationId : (all[userId]?.conversationId ?? null),
    resumeConversationId: patch.resumeConversationId !== undefined ? patch.resumeConversationId : (all[userId]?.resumeConversationId ?? null),
  };
  all[userId] = next;
  try {
    fs.mkdirSync(path.dirname(SMS_THREADS_FILE), { recursive: true });
    fs.writeFileSync(SMS_THREADS_FILE, JSON.stringify(all, null, 2), 'utf8');
  } catch (e: any) {
    logger.warn('[sms-inbox] Failed to persist local SMS thread:', e?.message);
  }
  return next;
}

/**
 * Load the full prior thread from the local encrypted SQLite so the cloud agent
 * sees real multi-turn context. The cloud's own getConversationMessages is a
 * privacy stub (message bodies never touch Supabase) and every SMS turn opens a
 * fresh WS, so without sending the history here every text looked like the first
 * message of a new chat.
 */
async function fetchLocalConversationMessages(
  conversationId: string,
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  const base = getLocalAgentHttpUrl();
  try {
    const resp = await net.fetch(`${base}/tools/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: 'message_list', args: { conversation_id: conversationId } }),
    });
    if (!resp.ok) return [];
    const data: any = await resp.json().catch(() => ({}));
    const rows: any[] = Array.isArray(data?.messages) ? data.messages : [];
    const out: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const m of rows) {
      const role = m?.role === 'assistant' ? 'assistant' : m?.role === 'user' ? 'user' : null;
      const content = typeof m?.content === 'string' ? m.content : '';
      if (role && content.trim()) out.push({ role, content });
    }
    // Bound the context window — SMS threads are short, but cap defensively.
    return out.slice(-40);
  } catch (e: any) {
    logger.warn('[sms-inbox] Failed to load local conversation history:', e?.message);
    return [];
  }
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

function getLocalAgentHttpUrl(): string {
  const ws = getLocalAgentWsUrl().replace(/\/ws$/, '');
  return ws.replace(/^wss?:\/\//, (m) => m.startsWith('wss') ? 'https://' : 'http://');
}

/**
 * After runSmsTurn completes, save the conversation turn to the local Python agent's
 * encrypted SQLite so it appears in the desktop conversation history and title search —
 * the same pipeline a normal desktop chat message goes through.
 *
 * cloud-ai tries to do this via the WS bridge, but runSmsTurn closes the WS immediately
 * on receiving `final`, so the bridge is gone when cloud-ai tries to call message_add.
 * We call the local agent HTTP API directly instead.
 */
async function ingestSmsConversationLocally(input: {
  conversationId: string;
  userText: string;
  assistantText: string;
  preferredModel: string;
  provider: string;
  isNewConversation: boolean;
}): Promise<void> {
  const base = getLocalAgentHttpUrl();
  const exec = async (tool: string, args: any): Promise<void> => {
    try {
      await net.fetch(`${base}/tools/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool, args }),
      });
    } catch { }
  };

  const title = input.isNewConversation
    ? String(input.userText || '').slice(0, 60).trim() || 'SMS conversation'
    : undefined;

  // Ensure conversation row exists (idempotent — returns existing if already there)
  await exec('conversation_create', {
    conversation_id: input.conversationId,
    model: input.preferredModel,
    source: 'stuard',
    ...(title ? { title } : {}),
  });

  // Save the user message then assistant response
  await exec('message_add', {
    conversation_id: input.conversationId,
    role: 'user',
    content: input.userText,
    metadata: { source: input.provider },
  });
  await exec('message_add', {
    conversation_id: input.conversationId,
    role: 'assistant',
    content: input.assistantText,
    metadata: { source: input.provider },
  });
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
  const isWhatsApp = String(provider || '').toLowerCase() === 'whatsapp';
  if (isWhatsApp && !WHATSAPP_INTEGRATION_ENABLED) return;
  try {
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
  const modeMarker = mode === 'proactive' ? '[PROACTIVE FOLLOW-UP]' : '[MOBILE MESSAGE]';
  const contextLine = mode === 'proactive'
    ? 'Context: the user is replying to a proactive check-in. Stay in that context unless they clearly change topic.'
    : 'Context: the user is chatting with you from their phone via SMS/WhatsApp.';
  const lines = [
    modeMarker,
    'The user sent this message from their mobile device via SMS or WhatsApp.',
    'IMPORTANT: Do NOT use markdown, LaTeX, bullet points, headers, bold/italic formatting, or code blocks.',
    'Write in plain text only. No asterisks, underscores, hashes, backticks, or any other formatting syntax.',
    'TEXTING STYLE: Reply like you are texting a close friend. Keep it casual, warm, and short — a sentence or two, the way people actually text. Contractions, lowercase, and the occasional emoji are fine. Skip greetings, sign-offs, and corporate phrasing; just get to the point.',
    'If you are working through something multi-step, it is good to fire off a quick heads-up first (e.g. "on it, checking now") before the answer — each thing you say is sent as its own separate text as you go.',
    'Be concise and direct. Your reply is sent as a text message.',
    contextLine,
  ];
  if (mode === 'proactive' && proactiveMessage) {
    lines.push(`Your original proactive message was:\n${proactiveMessage}`);
  }
  return lines.join('\n');
}

/**
 * Build a context note listing the local paths of media the user just sent
 * (already downloaded into the media library). Handed to the agent alongside
 * the transcript/summary so it can re-open the real file (read_file /
 * analyze_media) or send it back via telnyx_send_mms { path } — extra reference
 * beyond just the meaning.
 */
function buildLocalMediaContext(items: MediaLibraryItem[]): string {
  const lines = (items || [])
    .filter((it) => it && it.localPath)
    .map((it) => `- ${it.kind || 'file'} (${it.mimeType || 'unknown'}): ${it.localPath}`);
  if (lines.length === 0) return '';
  return [
    'ATTACHED MEDIA (saved on this device): the file(s) the user sent were downloaded locally. Re-open them with read_file / analyze_media, or send one back with telnyx_send_mms { path }. Local path(s):',
    ...lines,
  ].join('\n');
}

async function submitSmsReply(input: {
  queueItemId: string;
  replyText: string;
  mode: SmsMode;
  preferredModel: SmsPreferredModel;
  conversationId: string | null;
  resumeConversationId: string | null;
  provider?: string | null;
  /** True when the reply was already streamed live via /sms-notify — finalize
   *  state only, don't re-send or re-charge the carrier fee. */
  alreadyDelivered?: boolean;
}): Promise<void> {
  const session = getMainAuthSession();
  const token = session?.access_token;
  if (!token) throw new Error('desktop_auth_missing');

  const isWhatsApp = String(input.provider || '').toLowerCase() === 'whatsapp';
  if (isWhatsApp && !WHATSAPP_INTEGRATION_ENABLED) {
    throw new Error('whatsapp_integration_disabled');
  }
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
      alreadyDelivered: input.alreadyDelivered === true,
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
  /** Full prior thread (oldest→newest) so the cloud agent has real multi-turn
   *  context. The current user message is appended below. */
  priorMessages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  userId: string;
  replyToPhone: string;
  proactiveMessage?: string | null;
  provider?: string | null;
  attachments?: any[];
  /** Local file paths of media the user sent (already downloaded), surfaced to
   *  the agent as extra reference beyond the transcript/summary. */
  localMediaContext?: string;
}): Promise<{ replyText: string; fullReplyText: string; conversationId: string | null; alreadyDelivered: boolean; segmentsSent: number }> {
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

  return await new Promise<{ replyText: string; fullReplyText: string; conversationId: string | null; alreadyDelivered: boolean; segmentsSent: number }>((resolve, reject) => {
    let conversationId = input.conversationId || null;
    let done = false;
    let connectTimeout: NodeJS.Timeout | undefined;
    let runTimeout: NodeJS.Timeout | undefined;
    let ws: WebSocket;

    // ── Live "buddy texting" broadcast ───────────────────────────────────────
    // As the agent streams, accumulate assistant text into the current segment
    // and flush it as its own SMS at each natural boundary (right before a tool
    // call, and at the end). Thinking/reasoning tokens are never sent. Sends are
    // serialized through sendChain so the bubbles arrive in order without
    // blocking the WS message loop.
    let currentSegment = '';
    let segmentsSent = 0;
    let sendChain: Promise<void> = Promise.resolve();

    const flushSegment = () => {
      const text = truncateForSms(stripMarkdownForSms(currentSegment), input.provider);
      currentSegment = '';
      if (!text.trim()) return;
      segmentsSent++;
      sendChain = sendChain
        .catch(() => {})
        .then(() => sendSmsNotify(input.replyToPhone, text, input.provider));
    };

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
        // Send the full prior thread + this turn so the cloud uses real
        // multi-turn context (it reads `messages` directly; its server-side
        // history hydration is a no-op for mobile — bodies aren't in Supabase).
        const priorMessages = Array.isArray(input.priorMessages) ? input.priorMessages : [];
        const chatMessages = [...priorMessages, { role: 'user', content: input.text }];
        wsSend({
          type: 'chat',
          requestId,
          messages: chatMessages,
          text: input.text,
          model: input.preferredModel,
          conversationId: input.conversationId || undefined,
          hiddenContext: [
            buildSmsHiddenContext(input.mode, input.proactiveMessage),
            input.localMediaContext,
          ].filter(Boolean).join('\n\n'),
          auth: { accessToken: token },
          // Signal to cloud WS that this is a mobile-originated message:
          // - forcePersist: bypass sync_conversations pref (SMS convos must always save)
          // - mobileSource: provider name so cloud can generate title and finishRun
          // - mobileLocalPersist: the desktop stores message rows itself
          //   (ingestSmsConversationLocally), so the cloud should skip the
          //   duplicate store but still run the post-turn analysis over the
          //   persistent desktop bridge (segmentation, auto-journal, title).
          forcePersist: true,
          mobileSource: input.provider || 'sms',
          mobileLocalPersist: true,
          ...(input.attachments && input.attachments.length > 0 ? { attachments: input.attachments } : {}),
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

      // ── Streaming text → live per-thought SMS broadcast ───────────────────
      if (type === 'progress') {
        const event = String(msg?.event || '');
        if (event === 'delta') {
          currentSegment += String(msg?.data?.text || '');
        } else if (event === 'tool_event' && String(msg?.data?.status || '') === 'called') {
          // Model is about to act — text out whatever it just said as its own bubble.
          flushSegment();
        }
        // reasoning / reasoning_start / reasoning_end (thinking tokens) and all
        // other progress events are intentionally ignored — never texted.
        return;
      }

      // ── Tool request: act as the desktop tool bridge ──────────────────────
      if (type === 'tool_request') {
        const toolId = String(msg?.id || '');
        const toolName = String(msg?.tool || '');
        const args = msg?.args ?? {};
        if (!toolId || !toolName) return;

        // Send any preamble ("on it, grabbing that now") before the tool runs.
        flushSegment();

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

          const argsPreview = formatToolArgsForSms(toolName, args);
          void sendSmsNotify(
            input.replyToPhone,
            `Stuard wants to: ${argsPreview}\nReply YES to allow, NO to deny.`,
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
        const fullReplyText = String(result?.text || result?.response || '').trim();
        const replyText = truncateForSms(stripMarkdownForSms(fullReplyText), input.provider);
        const nextConversationId = msg?.conversationId
          ? String(msg.conversationId)
          : conversationId;
        // Flush the closing thought (text after the last tool call). If the model
        // never streamed any deltas (non-streaming fallback), segmentsSent stays 0
        // and the caller sends `replyText` the normal way instead.
        flushSegment();
        const alreadyDelivered = segmentsSent > 0;
        // Resolve synchronously (claims `done`, so the cloud closing the WS can't
        // race in and reject). The queued bubbles keep sending in order on
        // sendChain — they're independent HTTP calls, no need to await them here.
        finish(() => resolve({
          replyText,
          fullReplyText,
          conversationId: nextConversationId || null,
          alreadyDelivered,
          segmentsSent,
        }));
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

  // Conversation identity is device-owned. Seed the local pointer once from any
  // existing Supabase pointer so threads in flight before this change carry over,
  // then treat the local store as the source of truth from here on.
  let localThread = getLocalSmsThread(userId);
  if (!localThread.conversationId && (state.conversation_id || item.conversation_id)) {
    localThread = setLocalSmsThread(userId, {
      conversationId: state.conversation_id || item.conversation_id || null,
      resumeConversationId: state.resume_conversation_id || state.conversation_id || item.conversation_id || null,
    });
  }

  const effectiveState: SmsUserState = {
    mode: normalizeMode(item.mode ?? state.mode),
    preferred_model: normalizeModel(item.preferred_model ?? state.preferred_model),
    conversation_id: localThread.conversationId,
    resume_conversation_id: localThread.resumeConversationId || localThread.conversationId,
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
    // Commands like /new and /resume change which thread is active — persist the
    // pointer locally (device-owned) so the next text compounds correctly.
    setLocalSmsThread(userId, {
      conversationId: commandResult.nextState.conversation_id,
      resumeConversationId: commandResult.nextState.resume_conversation_id,
    });
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

  // Extract processed media from queue metadata (populated by cloud-ai MediaProcessor).
  // - processedAttachments: images/documents the model sees directly (vision).
  // - incomingMediaFiles: extra binaries (e.g. voice-note audio) NOT sent to the
  //   model inline, persisted only so the agent gets a real local file path.
  const processedAttachments = Array.isArray(item.metadata?.processedAttachments)
    ? item.metadata.processedAttachments
    : [];
  const incomingMediaFiles = Array.isArray(item.metadata?.incomingMediaFiles)
    ? item.metadata.incomingMediaFiles
    : [];

  // Save every inbound media file locally and capture the resulting paths so we
  // can hand them to the agent for extra reference (re-open / analyze / send
  // back) — not just the transcript/summary. Awaited (not fire-and-forget) so
  // the paths are ready for this turn; failures degrade gracefully.
  let savedMedia: MediaLibraryItem[] = [];
  const mediaToSave = [...processedAttachments, ...incomingMediaFiles];
  if (mediaToSave.length > 0) {
    try {
      savedMedia = await registerIncomingMessagingMedia(String(itemProvider || 'telnyx'), mediaToSave);
    } catch (error) {
      logger.warn('[sms-inbox] Failed to ingest message media:', error);
    }
  }
  const localMediaContext = buildLocalMediaContext(savedMedia);

  // Resolve the device-owned conversation id. A brand-new thread gets its UUID
  // generated here so the id is stable across turns (no Supabase round-trip) and
  // the next inbound text compounds into the same conversation.
  const isNewConversation = !effectiveState.conversation_id;
  const conversationId = effectiveState.conversation_id || randomUUID();

  // Load the prior thread so the cloud agent has real multi-turn context.
  const priorMessages = isNewConversation
    ? []
    : await fetchLocalConversationMessages(conversationId);

  const turn = await runSmsTurn({
    text: incomingText,
    mode: effectiveState.mode,
    preferredModel: effectiveState.preferred_model,
    conversationId,
    priorMessages,
    userId,
    replyToPhone,
    proactiveMessage: effectiveState.proactive_message,
    provider: itemProvider,
    attachments: processedAttachments.length > 0 ? processedAttachments : undefined,
    localMediaContext: localMediaContext || undefined,
  });
  if (!turn.replyText && !turn.alreadyDelivered) throw new Error('sms_empty_agent_reply');

  // Persist the device-owned thread pointer so the next text compounds in.
  setLocalSmsThread(userId, { conversationId, resumeConversationId: conversationId });

  // Ingest into local SQLite so this conversation appears in desktop history +
  // title search and compounds into one chat — the same pipeline a desktop
  // message uses. Fire-and-forget: local storage failures must not block the reply.
  void ingestSmsConversationLocally({
    conversationId,
    userText: incomingText,
    assistantText: turn.fullReplyText || turn.replyText,
    preferredModel: effectiveState.preferred_model,
    provider: itemProvider,
    isNewConversation,
  }).catch((e) => logger.warn('[sms-inbox] Local ingest failed:', e?.message));

  await submitSmsReply({
    queueItemId: item.id,
    replyText: turn.replyText,
    mode: effectiveState.mode,
    preferredModel: effectiveState.preferred_model,
    conversationId,
    resumeConversationId: conversationId,
    provider: itemProvider,
    alreadyDelivered: turn.alreadyDelivered,
  });
  await completeSmsItem(item.id);
}

/**
 * When the main drain loop is blocked inside runSmsTurn() waiting for a tool
 * permission, the user's YES/NO reply sits in the queue but can't be processed
 * (draining=true). This function breaks that deadlock by claiming the next
 * queue item and resolving the pending permission directly.
 */
async function tryResolvePermissionFromQueue(): Promise<boolean> {
  const session = getMainAuthSession();
  const userId = session?.user?.id || null;
  if (!userId) return false;

  const pending = pendingToolPermissions.get(userId);
  if (!pending) return false;

  let item: SmsQueueItem | null;
  try {
    item = await claimNextSmsItem(userId);
  } catch {
    return false;
  }
  if (!item) return false;

  const text = String(item.message_text || '').toLowerCase().trim();
  const isYes = text === 'yes' || text === 'y';
  const isNo = text === 'no' || text === 'n' || text === 'deny';

  if (isYes || isNo) {
    logger.info(`[sms-inbox] Resolved tool permission from queue: ${isYes ? 'YES' : 'NO'} for ${pending.toolName}`);
    pendingToolPermissions.delete(userId);
    pending.allow(isYes);
    try { await completeSmsItem(item.id); } catch {}
    return true;
  }

  // Not a YES/NO response — fail the item so it gets retried after the
  // current turn finishes (or the permission times out).
  try { await failSmsItem(item.id, 'pending_tool_permission'); } catch {}
  return false;
}

async function drainInbox(reason: string): Promise<void> {
  if (draining) {
    // DEADLOCK FIX: When a tool permission is pending, the main drain loop is
    // blocked inside runSmsTurn() waiting for the user's YES/NO reply. But that
    // reply is queued and can't be processed because draining=true. Break the
    // deadlock by resolving the permission directly from the queue.
    if (pendingToolPermissions.size > 0) {
      const resolved = await tryResolvePermissionFromQueue();
      if (resolved) return; // runSmsTurn will continue and drain will finish naturally
    }
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

  if (
    started
    && session
    && userId
    && currentChannel
    && currentChannelUserId === userId
    && (currentChannelStatus === 'connecting' || currentChannelStatus === 'subscribed')
  ) {
    void drainInbox('auth-sync');
    return;
  }

  if (currentChannel) {
    try { await client.removeChannel(currentChannel); } catch { }
    currentChannel = null;
    currentChannelUserId = null;
    currentChannelStatus = 'idle';
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

  currentChannel = ch;
  currentChannelUserId = userId;
  currentChannelStatus = 'connecting';

  ch.subscribe((status: string) => {
    if (ch !== currentChannel) return; // stale channel removed intentionally, ignore
    currentChannelStatus = mapRealtimeChannelStatus(status);
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
  currentChannelStatus = 'idle';
}

export function getSmsInboxStatus(): { started: boolean; subscribedUserId: string | null; draining: boolean } {
  return {
    started,
    subscribedUserId: currentChannelUserId,
    draining,
  };
}
