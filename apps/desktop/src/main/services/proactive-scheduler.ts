/**
 * Proactive Agent Scheduler
 *
 * Wakes up the agent on a configurable interval. Supports two execution targets:
 *   - local: sends directly to the Python agent via WebSocket (main process)
 *   - cloud: sends to the cloud VM via cloud-ai HTTP relay
 *
 * When the agent responds, sends a check-in notification through the custom
 * notification system (NotificationApp overlay). Users can reply directly
 * from the notification input, which relays back through IPC.
 */

import { Notification, BrowserWindow, desktopCapturer, net } from 'electron';
import WebSocket from 'ws';
import { proactiveService } from './proactive-service';
import { buildLocalProactiveHiddenContext, buildLocalProactivePrompt, buildUserFacingProactiveMessage, executeAgentToolRequest, extractAgentTextFromWsMessage, extractAgentToolRequest, splitProactiveStructuredContent } from './proactive-scheduler-utils';
import { getNotificationWindow, openNotificationWindow } from '../windows/window';
import logger from '../utils/logger';
import type { RouterContext } from '../tools/types';
import { loadSkills } from '../skills';

function getCloudAiHttpForTelnyx(): string {
  return String(
    process.env.CLOUD_AI_HTTP ||
    process.env.CLOUD_PUBLIC_URL ||
    process.env.VITE_CLOUD_AI_URL ||
    ''
  ).trim().replace(/\/+$/, '') || 'http://127.0.0.1:8082';
}

async function sendTelnyxNotification(
  channel: 'sms' | 'call',
  message: string,
): Promise<void> {
  const token = await getAuthToken();
  if (!token) {
    logger.warn(`[proactive-scheduler] Cannot send ${channel}: not authenticated`);
    return;
  }
  const cloudUrl = getCloudAiHttpForTelnyx();
  const endpoint = channel === 'call'
    ? '/integrations/telnyx/proactive-call'
    : '/integrations/telnyx/proactive-sms';

  try {
    const resp = await net.fetch(`${cloudUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ message }),
    });
    const data = await resp.json() as any;
    if (!data.ok) {
      logger.warn(`[proactive-scheduler] Telnyx ${channel} failed:`, data.error);
    }
  } catch (e: any) {
    logger.warn(`[proactive-scheduler] Telnyx ${channel} error:`, e?.message);
  }
}

const POLL_INTERVAL_MS = 15_000;
const MAX_RANDOM_MS = 90 * 60_000;
const MIN_RANDOM_MS = 10 * 60_000;
const AGENT_RESPONSE_TIMEOUT_MS = 180_000;
const PROACTIVE_REPLY_TIMEOUT_MS = 120_000;

const INTERVAL_MS: Record<string, number> = {
  '10m': 10 * 60_000,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h': 60 * 60_000,
  '2h': 2 * 60 * 60_000,
};

let pollTimer: ReturnType<typeof setInterval> | null = null;
let isRunning = false;
let currentRunId: string | null = null;

// ─── Follow-up Conversation History (in-memory) ─────────────────────────────

interface ConversationTurn {
  role: 'agent' | 'user';
  text: string;
  at: string;
}

const conversationHistory = new Map<string, ConversationTurn[]>();
const MAX_CONVERSATION_TURNS = 20;
const CONVERSATION_TTL_MS = 30 * 60_000; // 30 minutes

function getConversation(wakeUpId: string): ConversationTurn[] {
  return conversationHistory.get(wakeUpId) || [];
}

function appendConversation(wakeUpId: string, role: 'agent' | 'user', text: string) {
  const turns = getConversation(wakeUpId);
  turns.push({ role, text, at: new Date().toISOString() });
  if (turns.length > MAX_CONVERSATION_TURNS) turns.splice(0, turns.length - MAX_CONVERSATION_TURNS);
  conversationHistory.set(wakeUpId, turns);
}

function pruneStaleConversations() {
  const cutoff = Date.now() - CONVERSATION_TTL_MS;
  for (const [id, turns] of conversationHistory) {
    const lastTurn = turns[turns.length - 1];
    if (!lastTurn || new Date(lastTurn.at).getTime() < cutoff) {
      conversationHistory.delete(id);
    }
  }
}

// ─── Agent WebSocket (main process, same pattern as stuards.ts) ─────────────

let agentWs: WebSocket | null = null;
let agentReady: Promise<WebSocket> | null = null;

function getAgentWsUrl() {
  const raw = String(process.env.AGENT_WS || '').trim();
  if (raw) return raw.endsWith('/ws') ? raw : (raw.replace(/\/$/, '') + '/ws');
  return 'ws://127.0.0.1:8765/ws';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getCloudAiUrl(): string {
  return String(
    process.env.CLOUD_AI_HTTP ||
    process.env.CLOUD_PUBLIC_URL ||
    process.env.VITE_CLOUD_AI_URL ||
    ''
  ).trim().replace(/\/+$/, '') || 'http://127.0.0.1:8082';
}

type ProactiveModelMode = 'auto' | 'fast' | 'balanced' | 'smart';

function normalizeProactiveModelMode(value: any): ProactiveModelMode {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'auto' || raw === 'fast' || raw === 'balanced' || raw === 'smart') return raw;
  return 'balanced';
}

function buildModelSelection(config: any): { model?: ProactiveModelMode; modelId?: string } {
  const model = normalizeProactiveModelMode(config?.modelMode);
  const modelId = String(config?.modelId || '').trim();
  return {
    model,
    modelId: modelId || undefined,
  };
}

function ensureAgentWs(): Promise<WebSocket> {
  if (agentWs && agentWs.readyState === WebSocket.OPEN) return Promise.resolve(agentWs);
  if (agentReady) return agentReady;

  agentReady = new Promise<WebSocket>((resolve, reject) => {
    try {
      const url = getAgentWsUrl();
      const ws = new WebSocket(url);
      ws.setMaxListeners(0);
      const to = setTimeout(() => {
        try { ws.terminate(); } catch { }
        agentReady = null;
        agentWs = null;
        reject(new Error('proactive_ws_timeout'));
      }, 10_000);

      ws.on('open', () => { clearTimeout(to); agentWs = ws; resolve(ws); });
      ws.on('error', (e: Error) => {
        clearTimeout(to);
        agentReady = null;
        agentWs = null;
        reject(e);
      });
      ws.on('close', () => { agentWs = null; agentReady = null; });
    } catch (e) { reject(e as any); }
  });
  return agentReady;
}

async function waitForAgentWs(maxWaitMs = 30_000): Promise<WebSocket> {
  const deadline = Date.now() + maxWaitMs;
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    try {
      return await ensureAgentWs();
    } catch (e) {
      lastError = e;
      agentReady = null;
      if (agentWs) {
        try { agentWs.terminate(); } catch { }
        agentWs = null;
      }
      const remainingMs = deadline - Date.now();
      if (remainingMs > 0) {
        await delay(Math.min(1000, remainingMs));
      }
    }
  }

  const message = String((lastError as any)?.message || 'local_agent_not_ready');
  throw new Error(message === 'proactive_ws_timeout' ? 'local_agent_not_ready' : `local_agent_not_ready: ${message}`);
}

// ─── Stage Definitions ──────────────────────────────────────────────────────

export type ProactiveStage =
  | 'initializing'
  | 'capturing-screen'
  | 'capturing-system-audio'
  | 'capturing-mic-audio'
  | 'gathering-context'
  | 'loading-tasks'
  | 'connecting'
  | 'thinking'
  | 'processing'
  | 'complete'
  | 'failed';

interface StageInfo {
  label: string;
  progress: number;
}

interface StagePayload {
  type: 'stage';
  logId: string;
  stage: ProactiveStage;
  label: string;
  progress: number;
  detail?: string;
  at: string;
}

const STAGE_META: Record<ProactiveStage, StageInfo> = {
  'initializing': { label: 'Initializing check-in...', progress: 5 },
  'capturing-screen': { label: 'Capturing screenshot...', progress: 15 },
  'capturing-system-audio': { label: 'Recording system audio...', progress: 20 },
  'capturing-mic-audio': { label: 'Recording microphone...', progress: 23 },
  'gathering-context': { label: 'Gathering context...', progress: 25 },
  'loading-tasks': { label: 'Loading queued tasks...', progress: 35 },
  'connecting': { label: 'Connecting to agent...', progress: 50 },
  'thinking': { label: 'Agent is thinking...', progress: 65 },
  'processing': { label: 'Processing response...', progress: 85 },
  'complete': { label: 'Check-in complete', progress: 100 },
  'failed': { label: 'Check-in failed', progress: 100 },
};

// ─── Notifications & Broadcasts ─────────────────────────────────────────────

function broadcastUpdate(payload: any) {
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('proactive-update', payload);
      }
    }
  } catch { }
}

function emitStage(logId: string, stage: ProactiveStage, detail?: string) {
  const meta = STAGE_META[stage];
  const stagePayload: StagePayload = {
    type: 'stage',
    logId,
    stage,
    label: meta.label,
    progress: meta.progress,
    detail,
    at: new Date().toISOString(),
  };

  proactiveService.appendWakeUpStage(logId, {
    stage,
    label: meta.label,
    progress: meta.progress,
    detail,
    at: stagePayload.at,
  });

  broadcastUpdate(stagePayload);

  const notifWin = getNotificationWindow();
  if (notifWin && !notifWin.isDestroyed()) {
    notifWin.webContents.send('proactive-progress', stagePayload);
  }
}

// ─── Notification-based Check-in ────────────────────────────────────────────

function sendCheckinNotification(wakeUpId: string, agentMessage: string, screenshotUsed: boolean, tasksCompleted: number, isFollowUp = false): void {
  const displayMessage = buildUserFacingProactiveMessage(agentMessage);
  const { message, structuredContent } = splitProactiveStructuredContent(displayMessage);

  // Track the agent message in conversation history
  appendConversation(wakeUpId, 'agent', message);

  // Ensure the notification overlay window is open (same pattern as deliverNotification)
  openNotificationWindow();
  const notifWin = getNotificationWindow();
  if (notifWin && !notifWin.isDestroyed()) {
    const send = () => {
      try {
        notifWin.webContents.send('proactive-checkin', {
          wakeUpId,
          agentMessage: message,
          structuredContent,
          screenshotUsed,
          tasksCompleted,
          isFollowUp,
        });
      } catch { }
    };

    if (notifWin.webContents.isLoadingMainFrame()) {
      notifWin.webContents.once('did-finish-load', send);
    } else {
      send();
    }
  } else {
    try {
      if (Notification.isSupported()) {
        new Notification({ title: 'Stuard - Check-in', body: message.slice(0, 200) || '' }).show();
      }
    } catch { }
  }
}

/**
 * Called when the user replies to a check-in notification.
 * Builds multi-turn conversation context and shows the response as a follow-up notification.
 */
export async function handleProactiveReply(wakeUpId: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const replyLogId = `${wakeUpId}_reply_${Date.now()}`;
  const startedAt = new Date().toISOString();

  // Mark the notification as engaged (user replied)
  proactiveService.markNotificationEngagement(wakeUpId, 'replied');

  try {
    pruneStaleConversations();

    const { config } = proactiveService.getConfig();
    const token = await getAuthToken();
    const modelSelection = buildModelSelection(config);
    let reply: string;

    // Log the follow-up as its own activity entry
    proactiveService.addWakeUpLog({
      id: replyLogId,
      startedAt,
      status: 'running',
      contextUsed: ['follow-up'],
      tasksProcessed: [],
      executionTarget: config.executionTarget,
      modelMode: modelSelection.model,
      modelId: modelSelection.modelId,
      timeoutMs: PROACTIVE_REPLY_TIMEOUT_MS,
      timedOut: false,
      stageHistory: [],
      parentWakeUpId: wakeUpId,
    });
    broadcastUpdate({
      type: 'wake-up-start',
      logId: replyLogId,
      startedAt,
      executionTarget: config.executionTarget,
      modelMode: modelSelection.model,
      modelId: modelSelection.modelId,
      timeoutMs: PROACTIVE_REPLY_TIMEOUT_MS,
      isFollowUp: true,
      parentWakeUpId: wakeUpId,
    });
    emitStage(replyLogId, 'initializing');

    // Track the user message in conversation
    appendConversation(wakeUpId, 'user', text);

    // Build multi-turn conversation context
    const turns = getConversation(wakeUpId);
    const conversationContext = turns
      .map(t => t.role === 'agent' ? `Stuard: ${t.text}` : `User: ${t.text}`)
      .join('\n\n');

    // Fallback: if conversation is empty (shouldn't happen), use the log
    const { logs } = proactiveService.getWakeUpLog(50);
    const prevLog = logs?.find(l => l.id === wakeUpId);
    const fallbackContext = prevLog?.agentMessage || prevLog?.partialResponse || 'I just checked in with you.';
    const contextToUse = conversationContext || `Stuard: ${fallbackContext}\n\nUser: ${text}`;

    const cloudPrompt = `[PROACTIVE FOLLOW-UP CONVERSATION]
Conversation so far:
"""
${contextToUse}
"""

Continue the conversation naturally. Be brief, warm, and helpful. This is a follow-up reply, not a new check-in. Return a normal plain markdown/text reply only. Do not use GenUI or interactive UI blocks.`;

    const localHiddenContext = `[PROACTIVE FOLLOW-UP] The user is replying in an ongoing conversation from a proactive check-in. Be helpful, friendly, and concise. Return only the final user-facing reply. Do not expose reasoning or internal planning. Return a normal plain markdown/text reply only. Do not use GenUI, interactive UI blocks, or JSON UI payloads.

Conversation so far:
"""
${contextToUse}
"""`;

    emitStage(replyLogId, 'connecting', config.executionTarget === 'cloud' ? 'cloud VM' : 'local agent');

    if (config.executionTarget === 'cloud') {
      emitStage(replyLogId, 'thinking', 'Cloud VM processing follow-up');
      const result = await executeCloud(replyLogId, {
        config: {
          instructions: 'The user is replying in an ongoing conversation from a proactive check-in. Be helpful, friendly, and concise. Return a normal plain markdown/text reply only. Do not use GenUI or interactive UI blocks.',
          modelMode: modelSelection.model,
          modelId: modelSelection.modelId || '',
        },
        prompt: cloudPrompt,
        context: {},
        tasks: proactiveService.getActiveTasks(),
      });
      reply = result.text;
    } else {
      emitStage(replyLogId, 'thinking', 'Local agent processing follow-up');
      const ws = await waitForAgentWs();
      const replyId = `${wakeUpId}_reply_${Date.now()}`;

      reply = await new Promise<string>((resolve) => {
        let resolved = false;
        const chunks: string[] = [];

        const timeout = setTimeout(() => {
          if (!resolved) { resolved = true; cleanup(); resolve(chunks.join('') || 'I got your message.'); }
        }, PROACTIVE_REPLY_TIMEOUT_MS);

        const cleanup = () => { clearTimeout(timeout); ws.off('message', onMessage); };

        const toolCtx: RouterContext = {
          agentWsUrl: getAgentWsUrl(),
          cloudAiUrl: getCloudAiUrl(),
          accessToken: token || undefined,
          logFn: (msg) => logger.info(`[proactive-scheduler reply] ${msg}`),
        };

        const onMessage = async (raw: WebSocket.RawData) => {
          if (resolved) return;
          try {
            const msg = JSON.parse(raw.toString('utf8'));

            const toolRequest = extractAgentToolRequest(msg);
            if (toolRequest) {
              const { execTool } = await import('../tools');
              const toolResult = await executeAgentToolRequest(toolRequest, toolCtx, execTool);
              try {
                ws.send(JSON.stringify(toolResult));
              } catch { }
              return;
            }

            if (msg?.requestId !== replyId) return;
            if (msg?.type === 'progress' && msg?.data?.text) chunks.push(msg.data.text);
            if (msg?.type === 'final' || msg?.type === 'proactive_result') {
              resolved = true; cleanup();
              resolve(extractAgentTextFromWsMessage(msg, chunks.join('') || 'I got your message.'));
            }
            if (msg?.type === 'error') {
              resolved = true; cleanup();
              resolve(`Sorry, something went wrong: ${msg.message || 'Unknown error'}`);
            }
          } catch { }
        };

        ws.on('message', onMessage);
        ws.send(JSON.stringify({
          type: 'chat',
          requestId: replyId,
          text,
          reasoningLevel: 'none',
          ...(modelSelection.model ? { model: modelSelection.model } : {}),
          ...(modelSelection.modelId ? { modelId: modelSelection.modelId } : {}),
          ...(token ? { auth: { accessToken: token } } : {}),
          hiddenContext: localHiddenContext,
        }));
      });
    }

    emitStage(replyLogId, 'processing');

    proactiveService.updateWakeUpLog(replyLogId, {
      completedAt: new Date().toISOString(),
      status: 'completed',
      agentMessage: reply,
      timedOut: false,
      usage: undefined,
      modelId: modelSelection.modelId || undefined,
    });
    emitStage(replyLogId, 'complete');

    broadcastUpdate({
      type: 'wake-up-complete',
      logId: replyLogId,
      agentMessage: reply,
      modelId: modelSelection.modelId || undefined,
      isFollowUp: true,
      parentWakeUpId: wakeUpId,
    });

    sendCheckinNotification(wakeUpId, reply, false, 0, true);
    return { ok: true };
  } catch (e: any) {
    logger.error('[proactive-scheduler] Reply failed:', e);
    emitStage(replyLogId, 'failed', String(e?.message || e));

    proactiveService.updateWakeUpLog(replyLogId, {
      completedAt: new Date().toISOString(),
      status: 'failed',
      agentMessage: '',
      timedOut: false,
      failureReason: String(e?.message || e),
    });

    broadcastUpdate({
      type: 'wake-up-complete',
      logId: replyLogId,
      agentMessage: '',
      isFollowUp: true,
      parentWakeUpId: wakeUpId,
      error: String(e?.message || e),
    });

    return { ok: false, error: String(e?.message || e) };
  }
}

// ─── Context Capture ────────────────────────────────────────────────────────

async function captureScreenshot(): Promise<string | null> {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1280, height: 720 },
    });
    if (sources.length > 0) {
      return sources[0].thumbnail.toDataURL();
    }
  } catch (e) {
    logger.warn('[proactive-scheduler] Screenshot capture failed:', e);
  }
  return null;
}

// ─── Schedule Helpers ───────────────────────────────────────────────────────

function computeNextWakeUp(interval: string): string | null {
  if (interval === 'manual') return null;
  const now = Date.now();
  if (interval === 'random') {
    const delay = MIN_RANDOM_MS + Math.random() * (MAX_RANDOM_MS - MIN_RANDOM_MS);
    return new Date(now + delay).toISOString();
  }
  const ms = INTERVAL_MS[interval];
  if (!ms) return null;
  return new Date(now + ms).toISOString();
}

function humanizeAgentToolName(tool: string): string {
  return String(tool || 'tool')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function sanitizeWakeUpValue(value: any, depth = 0): any {
  if (value === null || value === undefined) return value;
  if (depth >= 3) return '[truncated]';
  if (typeof value === 'string') return value.length > 600 ? `${value.slice(0, 600)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 12).map(item => sanitizeWakeUpValue(item, depth + 1));
  if (typeof value === 'object') {
    const entries = Object.entries(value).slice(0, 20);
    return Object.fromEntries(entries.map(([k, v]) => [k, sanitizeWakeUpValue(v, depth + 1)]));
  }
  return String(value);
}

function summarizeWakeUpValue(value: any): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value.length > 180 ? `${value.slice(0, 180)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.length > 0 ? `Array(${value.length})` : '[]';
  if (typeof value === 'object') {
    const entries = Object.entries(value).slice(0, 4);
    if (entries.length === 0) return '{}';
    return entries.map(([k, v]) => `${k}: ${summarizeWakeUpValue(v) ?? '…'}`).join(', ');
  }
  return String(value);
}

function appendAgentActivity(
  logId: string,
  kind: 'lifecycle' | 'routing' | 'reasoning' | 'tool' | 'status',
  event: string,
  label: string,
  detail?: string,
) {
  const activity = {
    id: `${event}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    kind,
    event,
    label,
    detail,
    at: new Date().toISOString(),
  };
  proactiveService.appendWakeUpActivity(logId, activity);
  broadcastUpdate({ type: 'agent-activity', logId, activity });
}

function upsertAgentToolCall(logId: string, data: any) {
  let tool = String(data?.tool || 'tool');
  if (tool === 'execute_tool' && data?.args?.tool_name) {
    tool = String(data.args.tool_name);
  }

  const status = typeof data?.status === 'string' ? data.status : undefined;
  const toolCallId = String(data?.toolCallId || data?.id || `tc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
  const now = new Date().toISOString();
  const description = typeof data?.description === 'string' ? data.description : undefined;
  const args = sanitizeWakeUpValue(data?.args);
  const result = sanitizeWakeUpValue(data?.result);
  const error = data?.error ? String(data.error) : undefined;

  const toolCall = {
    id: toolCallId,
    tool,
    status,
    description,
    args,
    result,
    error,
    startedAt: now,
    updatedAt: now,
  };

  proactiveService.upsertWakeUpToolCall(logId, toolCall);
  broadcastUpdate({ type: 'agent-tool', logId, toolCall });

  const normalizedStatus = String(status || '').toLowerCase();
  if (normalizedStatus && !['delta', 'input_delta', 'input_stream_start', 'input_stream_end'].includes(normalizedStatus)) {
    let detail = description || summarizeWakeUpValue(args) || summarizeWakeUpValue(result) || error;
    if (normalizedStatus === 'completed' && !detail) detail = summarizeWakeUpValue(result);
    if ((normalizedStatus === 'error' || normalizedStatus === 'failed') && error) detail = error;
    appendAgentActivity(logId, 'tool', `tool_${normalizedStatus}`, `${humanizeAgentToolName(tool)} · ${normalizedStatus}`, detail);
  }
}

// ─── Local Agent Execution ──────────────────────────────────────────────────

interface WakeUpExecutionResult {
  text: string;
  partialResponse?: string;
  timedOut?: boolean;
  failureReason?: string;
  taskUpdates: Array<{ id: string; status: string; result?: string }>;
  newTasks: Array<{ title: string; instructions?: string; status?: string }>;
  usage?: any;
  modelId?: string;
  sessionSummary?: string;
  agentChannel?: string;
  agentUrgency?: string;
}

async function executeLocal(logId: string, payload: any): Promise<WakeUpExecutionResult> {
  const ws = await waitForAgentWs();
  const token = await getAuthToken();
  const modelSelection = buildModelSelection(payload?.config || {});
  const toolCtx: RouterContext = {
    agentWsUrl: getAgentWsUrl(),
    cloudAiUrl: getCloudAiUrl(),
    accessToken: token || undefined,
    logFn: (msg) => logger.info(`[proactive-scheduler] ${msg}`),
  };

  return new Promise<WakeUpExecutionResult>((resolve) => {
    let resolved = false;
    const chunks: string[] = [];
    let lastPublished = '';
    let lastPublishedAt = 0;
    let capturedSessionSummary: string | undefined;

    const publishPartialResponse = (force = false) => {
      const partialResponse = chunks.join('').trim();
      if (!partialResponse) return;
      const now = Date.now();
      if (!force && partialResponse === lastPublished) return;
      if (!force && partialResponse.length < lastPublished.length + 80 && now - lastPublishedAt < 1200) return;
      lastPublished = partialResponse;
      lastPublishedAt = now;
      proactiveService.updateWakeUpLog(logId, { partialResponse });
      broadcastUpdate({ type: 'agent-progress', logId, partialResponse });
    };

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        publishPartialResponse(true);
        cleanup();
        const partialResponse = chunks.join('').trim();
        const timeoutReason = `Agent did not respond within ${Math.round(AGENT_RESPONSE_TIMEOUT_MS / 1000)} seconds.`;
        resolve({
          text: partialResponse || timeoutReason,
          partialResponse: partialResponse || undefined,
          timedOut: true,
          failureReason: timeoutReason,
          taskUpdates: [],
          newTasks: [],
        });
      }
    }, AGENT_RESPONSE_TIMEOUT_MS);

    const cleanup = () => {
      clearTimeout(timeout);
      ws.off('message', onMessage);
    };

    const onMessage = async (raw: WebSocket.RawData) => {
      if (resolved) return;
      try {
        const msg = JSON.parse(raw.toString('utf8'));
        const toolRequest = extractAgentToolRequest(msg);
        if (toolRequest) {
          // Intercept write_session_summary — capture it locally without forwarding to execTool
          if (toolRequest.tool === 'write_session_summary') {
            const a = toolRequest.args || {};
            const parts: string[] = [];
            if (a.user_activity) parts.push(`Activity: ${a.user_activity}`);
            if (a.intervention) parts.push(`Intervention: ${a.intervention}`);
            if (a.pattern_notes) parts.push(`Patterns: ${a.pattern_notes}`);
            if (a.urgency_used) parts.push(`Urgency: ${a.urgency_used}`);
            if (parts.length > 0) capturedSessionSummary = parts.join(' | ');
            try { ws.send(JSON.stringify({ type: 'tool_result', id: toolRequest.id, result: { ok: true } })); } catch { }
            return;
          }
          const { execTool } = await import('../tools');
          const toolResult = await executeAgentToolRequest(toolRequest, toolCtx, execTool);
          try {
            ws.send(JSON.stringify(toolResult));
          } catch { }
          return;
        }

        const matchesRequest = msg?.requestId === logId || msg?.id === logId;
        if (!matchesRequest) return;

        if (msg?.type === 'progress') {
          const event = String(msg?.event || '').trim();
          const data = msg?.data || {};

          if (event === 'delta' && typeof data?.text === 'string') {
            chunks.push(data.text);
            publishPartialResponse();
          } else if (event === 'tool_event') {
            upsertAgentToolCall(logId, data);
          } else if (event === 'reasoning_start') {
            appendAgentActivity(logId, 'reasoning', 'reasoning_start', 'Reasoning started');
          } else if (event === 'reasoning' && typeof data?.text === 'string' && data.text) {
            proactiveService.appendWakeUpReasoning(logId, data.text);
            broadcastUpdate({ type: 'agent-reasoning', logId, textChunk: data.text });
          } else if (event === 'reasoning_end') {
            appendAgentActivity(logId, 'reasoning', 'reasoning_end', 'Reasoning finished');
          } else if (event === 'routing') {
            appendAgentActivity(logId, 'routing', 'routing', 'Model routed', summarizeWakeUpValue(data?.model || data));
          } else if (event === 'model') {
            appendAgentActivity(logId, 'routing', 'model', 'Model selected', summarizeWakeUpValue(data?.modelId || data?.tier || data));
          } else if (event === 'start') {
            appendAgentActivity(logId, 'lifecycle', 'start', 'Agent started');
          } else if (event === 'queued') {
            appendAgentActivity(logId, 'status', 'queued', 'Queued', summarizeWakeUpValue(data));
          } else if (event) {
            appendAgentActivity(logId, 'status', event, event.replace(/_/g, ' '), summarizeWakeUpValue(data));
          }
        }

        if (msg?.type === 'final') {
          resolved = true;
          if (typeof msg?.result?.reasoning === 'string' && msg.result.reasoning) {
            proactiveService.appendWakeUpReasoning(logId, msg.result.reasoning);
          }
          if (typeof msg?.result?.thinking === 'string' && msg.result.thinking) {
            proactiveService.appendWakeUpReasoning(logId, msg.result.thinking);
          }
          publishPartialResponse(true);
          cleanup();
          const finalUsage = msg?.result?.usage || msg?.usage || undefined;
          const finalModelId = typeof msg?.model === 'string' ? msg.model : (modelSelection.modelId || undefined);
          resolve({
            text: extractAgentTextFromWsMessage(msg, chunks.join('') || ''),
            partialResponse: chunks.join('').trim() || undefined,
            taskUpdates: [],
            newTasks: [],
            usage: finalUsage,
            modelId: finalModelId,
            sessionSummary: capturedSessionSummary,
          });
        }
        if (msg?.type === 'proactive_result') {
          resolved = true;
          publishPartialResponse(true);
          cleanup();
          resolve({
            text: extractAgentTextFromWsMessage(msg, chunks.join('') || ''),
            partialResponse: chunks.join('').trim() || undefined,
            taskUpdates: [],
            newTasks: [],
            sessionSummary: capturedSessionSummary,
          });
        }
        if (msg?.type === 'error') {
          resolved = true;
          publishPartialResponse(true);
          cleanup();
          resolve({
            text: `Error: ${msg.message || 'Unknown error'}`,
            partialResponse: chunks.join('').trim() || undefined,
            failureReason: String(msg.message || 'Unknown error'),
            taskUpdates: [],
            newTasks: [],
          });
        }
      } catch { }
    };

    ws.on('message', onMessage);

    const chatPayload = {
      type: 'chat',
      requestId: logId,
      text: buildLocalProactivePrompt(payload),
      reasoningLevel: 'none',
      ...(modelSelection.model ? { model: modelSelection.model } : {}),
      ...(modelSelection.modelId ? { modelId: modelSelection.modelId } : {}),
      ...(token ? { auth: { accessToken: token } } : {}),
      context: payload.context?.screenshot ? { screenshots: [payload.context.screenshot] } : undefined,
      hiddenContext: buildLocalProactiveHiddenContext(payload),
    };

    ws.send(JSON.stringify(chatPayload));
  });
}

// ─── Cloud VM Execution ─────────────────────────────────────────────────────

async function getAuthToken(): Promise<string | null> {
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        const token = await win.webContents.executeJavaScript(
          `(async () => { try { const { data } = await window.supabase?.auth?.getSession(); return data?.session?.access_token || null; } catch { return null; } })()`,
          true
        );
        if (token) return token;
      }
    }
  } catch { }
  return null;
}

interface CloudWakeUpResult {
  text: string;
  taskUpdates: Array<{ id: string; status: string; result?: string }>;
  newTasks: Array<{ title: string; instructions?: string; status?: string }>;
  deletedTaskIds: string[];
  timedOut?: boolean;
  failureReason?: string;
  usage?: any;
  modelId?: string;
  agentChannel?: string;
  agentUrgency?: string;
  sessionSummary?: string;
}

async function executeCloud(logId: string, payload: any): Promise<CloudWakeUpResult> {
  const token = await getAuthToken();
  if (!token) {
    return {
      text: 'Cloud execution failed: not authenticated. Please sign in.',
      taskUpdates: [],
      newTasks: [],
      deletedTaskIds: [],
      failureReason: 'Cloud execution failed: not authenticated.',
    };
  }

  const cloudUrl = getCloudAiUrl();
  const abortController = new AbortController();
  const requestTimeout = setTimeout(() => abortController.abort(), AGENT_RESPONSE_TIMEOUT_MS);

  try {
    // Load active skills to pass to cloud agent
    const activeSkills = loadSkills().filter(s => s.isActive);

    const body = JSON.stringify({
      tasks: payload.tasks || [],
      instructions: payload.config?.instructions || '',
      prompt: typeof payload.prompt === 'string' ? payload.prompt : undefined,
      allowedTools: Array.isArray(payload.config?.allowedTools) ? payload.config.allowedTools : [],
      modelMode: normalizeProactiveModelMode(payload.config?.modelMode),
      modelId: String(payload.config?.modelId || '').trim() || undefined,
      context: {
        screenshot: payload.context?.screenshot || null,
        systemAudio: payload.context?.systemAudio || false,
        micAudio: payload.context?.micAudio || false,
        openWindows: payload.context?.openWindows || [],
        recentSessionSummaries: payload.context?.recentSessionSummaries || [],
      },
      notificationChannels: payload.config?.notificationChannels || ['app'],
      notificationDigest: payload.context?.notificationDigest || [],
      skills: activeSkills.map(s => ({
        id: s.id,
        name: s.name,
        description: s.description,
        trigger: s.trigger,
        steps: s.steps,
        icon: s.icon,
        color: s.color,
        isActive: s.isActive,
      })),
    });

    const resp = await net.fetch(`${cloudUrl}/v1/proactive/wakeup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body,
      signal: abortController.signal,
    });

    const data = await resp.json() as any;
    clearTimeout(requestTimeout);
    return {
      text: data.text || (data.ok ? 'Cloud check-in completed.' : `Cloud execution failed: ${data.error || 'Unknown error'}`),
      taskUpdates: Array.isArray(data.taskUpdates) ? data.taskUpdates : [],
      newTasks: Array.isArray(data.newTasks) ? data.newTasks : [],
      deletedTaskIds: Array.isArray(data.deletedTaskIds) ? data.deletedTaskIds : [],
      failureReason: data.ok === false ? `Cloud execution failed: ${data.error || 'Unknown error'}` : undefined,
      usage: data.usage,
      modelId: typeof data.modelId === 'string' ? data.modelId : undefined,
      agentChannel: typeof data.agentChannel === 'string' ? data.agentChannel : undefined,
      agentUrgency: typeof data.agentUrgency === 'string' ? data.agentUrgency : undefined,
      sessionSummary: typeof data.sessionSummary === 'string' ? data.sessionSummary : undefined,
    };
  } catch (e: any) {
    clearTimeout(requestTimeout);
    logger.error('[proactive-scheduler] Cloud execution failed:', e);
    if (e?.name === 'AbortError') {
      return {
        text: `Cloud execution timed out after ${Math.round(AGENT_RESPONSE_TIMEOUT_MS / 1000)} seconds.`,
        taskUpdates: [],
        newTasks: [],
        deletedTaskIds: [],
        timedOut: true,
        failureReason: `Cloud execution timed out after ${Math.round(AGENT_RESPONSE_TIMEOUT_MS / 1000)} seconds.`,
      };
    }
    return {
      text: `Cloud execution failed: ${e.message || 'Connection error'}`,
      taskUpdates: [],
      newTasks: [],
      deletedTaskIds: [],
      failureReason: `Cloud execution failed: ${e.message || 'Connection error'}`,
    };
  }
}

// ─── Main Wake-Up Flow ──────────────────────────────────────────────────────

async function executeWakeUp() {
  if (currentRunId) {
    logger.debug('[proactive-scheduler] Skipping wake-up, already running');
    return;
  }

  const { config } = proactiveService.getConfig();
  if (!config.enabled) return;

  const logId = `pwake_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  currentRunId = logId;

  const contextUsed: string[] = [];
  let taskIds: string[] = [];
  let screenshotData: string | null = null;
  const startedAt = new Date().toISOString();
  const modelSelection = buildModelSelection(config);

  // Age out stale "pending" notifications as "ignored" (user never replied)
  try {
    const recentNotifs = proactiveService.getRecentNotifications(20);
    for (const n of recentNotifs) {
      if (n.engagement === 'pending' && n.channel !== 'skip') {
        proactiveService.markNotificationEngagement(n.wakeUpId, 'ignored');
      }
    }
  } catch { }

  try {
    logger.info(`[proactive-scheduler] Starting wake-up (target: ${config.executionTarget})`);

    proactiveService.addWakeUpLog({
      id: logId,
      startedAt,
      status: 'running',
      contextUsed: [],
      tasksProcessed: [],
      executionTarget: config.executionTarget,
      modelMode: modelSelection.model,
      modelId: modelSelection.modelId,
      timeoutMs: AGENT_RESPONSE_TIMEOUT_MS,
      timedOut: false,
      stageHistory: [],
    });
    broadcastUpdate({
      type: 'wake-up-start',
      logId,
      startedAt,
      executionTarget: config.executionTarget,
      modelMode: modelSelection.model,
      modelId: modelSelection.modelId,
      timeoutMs: AGENT_RESPONSE_TIMEOUT_MS,
    });
    emitStage(logId, 'initializing');

    // Capture context
    if (config.contextPermissions.screenshot) {
      emitStage(logId, 'capturing-screen');
      screenshotData = await captureScreenshot();
      if (screenshotData) contextUsed.push('screenshot');
    }

    let systemAudioData: string | null = null;
    let micAudioData: string | null = null;
    let localAgentReadyForCapture = false;

    if (config.contextPermissions.systemAudio || config.contextPermissions.micAudio) {
      try {
        await waitForAgentWs(30_000);
        localAgentReadyForCapture = true;
      } catch (e: any) {
        logger.warn(`[proactive-scheduler] local agent not ready for audio capture, skipping audio context: ${String(e?.message || e)}`);
      }
    }

    if (localAgentReadyForCapture && (config.contextPermissions.systemAudio || config.contextPermissions.micAudio)) {
      const { execLocalTool } = await import('../tools/handlers/local');
      const fs = await import('fs/promises');
      const toolCtx: RouterContext = {
        agentWsUrl: getAgentWsUrl(),
        cloudAiUrl: getCloudAiUrl(),
        logFn: (msg) => logger.info(`[proactive-scheduler] ${msg}`),
      };

      if (config.contextPermissions.systemAudio) {
        emitStage(logId, 'capturing-system-audio', 'Listening to system audio...');
        try {
          const res = await execLocalTool('capture_system_audio', { durationMs: 3000 }, toolCtx, 10000);
          if (res?.ok && res.filePath) {
            const buf = await fs.readFile(res.filePath);
            systemAudioData = `data:audio/wav;base64,${buf.toString('base64')}`;
            await fs.unlink(res.filePath).catch(() => { });
            contextUsed.push('systemAudio');
          }
        } catch (e) {
          logger.warn('[proactive-scheduler] system audio capture failed:', e);
        }
      }

      if (config.contextPermissions.micAudio) {
        emitStage(logId, 'capturing-mic-audio', 'Listening to microphone...');
        try {
          const res = await execLocalTool('capture_media', { kind: 'audio', durationMs: 3000 }, toolCtx, 10000);
          if (res?.ok && res.filePath) {
            const buf = await fs.readFile(res.filePath);
            micAudioData = `data:audio/wav;base64,${buf.toString('base64')}`;
            await fs.unlink(res.filePath).catch(() => { });
            contextUsed.push('micAudio');
          }
        } catch (e) {
          logger.warn('[proactive-scheduler] mic audio capture failed:', e);
        }
      }
    }

    if (contextUsed.length > 0) {
      emitStage(logId, 'gathering-context', contextUsed.join(', '));
    }

    // Capture open windows for situational awareness
    let openWindows: Array<{ id?: number; title: string }> = [];
    try {
      const { execListOpenWindows } = await import('../tools/handlers/electron');
      const toolCtx: RouterContext = {
        agentWsUrl: getAgentWsUrl(),
        cloudAiUrl: getCloudAiUrl(),
        logFn: (msg: string) => logger.debug(`[proactive-scheduler] ${msg}`),
      };
      const winResult = await execListOpenWindows({}, toolCtx);
      if (winResult?.ok && Array.isArray(winResult.windows)) {
        openWindows = winResult.windows
          .filter((w: any) => {
            const title = String(w?.title || '').toLowerCase();
            // Filter out Stuard's own windows and system chrome
            return title && !title.includes('stuard') && !title.includes('electron');
          })
          .map((w: any) => ({ id: w.id, title: String(w.title) }));
        if (openWindows.length > 0) contextUsed.push('openWindows');
      }
    } catch (e) {
      logger.debug('[proactive-scheduler] open windows capture failed:', e);
    }

    // Load recent session summaries for pattern awareness
    const recentSessionSummaries = proactiveService.getRecentSessionSummaries(10);

    // Load notification digest so the agent knows what it recently said
    const notificationDigest = proactiveService.getNotificationDigest(8);

    // Get all active tasks (queued + in_progress) — agent manages lifecycle via tools
    const activeTasks = proactiveService.getActiveTasks();
    taskIds = activeTasks.map(t => t.id);

    if (activeTasks.length > 0) {
      emitStage(logId, 'loading-tasks', `${activeTasks.length} task${activeTasks.length === 1 ? '' : 's'}`);
    }

    // No auto in_progress marking — the agent controls task status via kanban tools

    // Load active skills for context
    const activeSkills = loadSkills().filter(s => s.isActive);

    const wakeUpPayload = {
      config: {
        instructions: config.instructions,
        allowedTools: config.allowedTools,
        modelMode: normalizeProactiveModelMode((config as any).modelMode),
        modelId: String((config as any).modelId || '').trim(),
      },
      context: {
        screenshot: screenshotData,
        systemAudio: systemAudioData,
        micAudio: micAudioData,
        openWindows,
        recentSessionSummaries,
        notificationDigest,
      },
      tasks: activeTasks.map(t => ({
        id: t.id,
        title: t.title,
        instructions: t.instructions,
        status: t.status,
      })),
      skills: activeSkills.map(s => ({
        id: s.id,
        name: s.name,
        description: s.description,
        trigger: s.trigger,
      })),
    };

    const targetLabel = config.executionTarget === 'cloud' ? 'cloud VM' : 'local agent';
    emitStage(logId, 'connecting', targetLabel);

    // Execute on the appropriate target
    let agentMessage: string;
    let executionResult: WakeUpExecutionResult;
    if (config.executionTarget === 'cloud') {
      emitStage(logId, 'thinking', 'Cloud VM processing');
      executionResult = await executeCloud(logId, wakeUpPayload);
      agentMessage = executionResult.text;

      // Apply agent-returned mutations
      if (executionResult.taskUpdates.length > 0) {
        proactiveService.applyTaskUpdates(executionResult.taskUpdates as any);
      }
      if (executionResult.newTasks.length > 0) {
        proactiveService.applyNewTasks(executionResult.newTasks as any);
      }
      // Apply deletions from cloud agent
      if (Array.isArray((executionResult as any).deletedTaskIds)) {
        for (const taskId of (executionResult as any).deletedTaskIds) {
          proactiveService.deleteTask(String(taskId));
        }
      }
    } else {
      emitStage(logId, 'thinking', 'Local agent processing');
      executionResult = await executeLocal(logId, wakeUpPayload);
      agentMessage = executionResult.text;
      // Local path executes desktop-backed tool calls inline, so task-board mutations
      // are applied immediately by the proactive task handlers.
    }

    // Broadcast task board refresh so UI updates immediately
    const updatedTasks = proactiveService.listTasks();
    broadcastUpdate({ type: 'tasks-refreshed', tasks: updatedTasks.tasks });

    if (executionResult.partialResponse) {
      proactiveService.updateWakeUpLog(logId, { partialResponse: executionResult.partialResponse });
    }
    if (executionResult.failureReason) {
      const error = new Error(executionResult.failureReason) as Error & {
        partialResponse?: string;
        timedOut?: boolean;
        userFacingMessage?: string;
      };
      error.partialResponse = executionResult.partialResponse;
      error.timedOut = executionResult.timedOut;
      error.userFacingMessage = executionResult.text;
      throw error;
    }

    emitStage(logId, 'processing');

    // No auto-complete — agent already managed task status via tools

    proactiveService.updateWakeUpLog(logId, {
      completedAt: new Date().toISOString(),
      status: 'completed',
      contextUsed,
      tasksProcessed: taskIds,
      agentMessage,
      partialResponse: executionResult.partialResponse,
      timedOut: false,
      failureReason: undefined,
      usage: executionResult.usage,
      modelId: executionResult.modelId || modelSelection.modelId || undefined,
    });

    proactiveService.setLastWakeUp(new Date().toISOString());
    emitStage(logId, 'complete');

    // Persist session summary from the agent
    if (executionResult.sessionSummary) {
      proactiveService.addSessionSummary(executionResult.sessionSummary);
    }

    // Use agent's urgency-based channel choice if available, otherwise fall back to configured channels
    const agentChannel = executionResult.agentChannel;
    const agentUrgency = executionResult.agentUrgency;

    if (agentMessage) {
      let channels: string[] = config.notificationChannels || ['app'];

      // If the agent chose to skip notification, respect that
      if (agentChannel === 'skip') {
        channels = [];
        logger.info(`[proactive-scheduler] Agent chose to skip notification (urgency: ${agentUrgency})`);
      } else if (agentChannel && agentChannel !== 'app') {
        // Agent chose an elevated channel (sms/call/whatsapp) — always include 'app' so the custom UI notification fires too
        channels = ['app', agentChannel];
        logger.info(`[proactive-scheduler] Agent chose channel: ${agentChannel} (urgency: ${agentUrgency})`);
      }

      if (channels.includes('app')) {
        sendCheckinNotification(logId, agentMessage, contextUsed.includes('screenshot'), taskIds.length);
      }
      if (channels.includes('sms')) {
        sendTelnyxNotification('sms', `Stuard Check-in: ${agentMessage.slice(0, 1500)}`).catch(() => { });
      }
      if (channels.includes('call')) {
        sendTelnyxNotification('call', agentMessage.slice(0, 500)).catch(() => { });
      }

      // Log the notification for dedup and engagement tracking
      const primaryChannel = channels[0] || 'skip';
      if (primaryChannel !== 'skip') {
        proactiveService.logNotification({
          wakeUpId: logId,
          message: agentMessage.slice(0, 300),
          channel: primaryChannel,
          urgency: agentUrgency || 'normal',
          engagement: 'pending',
        });
      }
    } else if (agentChannel === 'skip') {
      // Agent explicitly chose to stay silent — still log it so we track the skip
      proactiveService.logNotification({
        wakeUpId: logId,
        message: '(skipped — nothing new)',
        channel: 'skip',
        urgency: agentUrgency || 'low',
        engagement: 'ignored',
      });
    }

    broadcastUpdate({
      type: 'wake-up-complete',
      logId,
      agentMessage,
      usage: executionResult.usage,
      modelId: executionResult.modelId || modelSelection.modelId || undefined,
    });
    logger.info(`[proactive-scheduler] Wake-up complete: ${agentMessage?.slice(0, 100) || '(no message)'}`);
  } catch (e: any) {
    logger.error('[proactive-scheduler] Wake-up failed:', e);
    emitStage(logId, 'failed', String(e.message || e));

    proactiveService.updateWakeUpLog(logId, {
      completedAt: new Date().toISOString(),
      status: 'failed',
      contextUsed,
      tasksProcessed: taskIds,
      agentMessage: String(e.userFacingMessage || e.message || e),
      partialResponse: typeof e?.partialResponse === 'string' ? e.partialResponse : undefined,
      timedOut: !!e?.timedOut,
      failureReason: String(e.message || e),
    });
    broadcastUpdate({ type: 'wake-up-failed', logId, error: String(e.message || e), timedOut: !!e?.timedOut });
  } finally {
    currentRunId = null;

    const freshConfig = proactiveService.getConfig().config;
    if (freshConfig.enabled) {
      const next = computeNextWakeUp(freshConfig.interval);
      proactiveService.setNextWakeUp(next);
      broadcastUpdate({ type: 'next-wakeup-scheduled', nextWakeUpAt: next });
    }
  }
}

// ─── Polling ────────────────────────────────────────────────────────────────

function checkSchedule() {
  try {
    const { config } = proactiveService.getConfig();
    if (!config.enabled || config.interval === 'manual') return;
    if (currentRunId) return;

    const nextAt = config.nextWakeUpAt;
    if (!nextAt) {
      const next = computeNextWakeUp(config.interval);
      proactiveService.setNextWakeUp(next);
      return;
    }

    const nextTime = new Date(nextAt).getTime();
    if (isNaN(nextTime)) return;

    if (Date.now() >= nextTime) {
      executeWakeUp();
    }
  } catch (e) {
    logger.warn('[proactive-scheduler] Check failed:', e);
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function startProactiveScheduler() {
  if (isRunning) return;
  isRunning = true;
  logger.info('[proactive-scheduler] Starting proactive scheduler');

  setTimeout(() => checkSchedule(), 5000);
  pollTimer = setInterval(() => checkSchedule(), POLL_INTERVAL_MS);
}

export function stopProactiveScheduler() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  isRunning = false;
  if (agentWs) {
    try { agentWs.close(); } catch { }
    agentWs = null;
    agentReady = null;
  }
  logger.info('[proactive-scheduler] Stopped proactive scheduler');
}

export function triggerManualWakeUp() {
  if (currentRunId) return { ok: false, error: 'Already running a check-in' };
  executeWakeUp();
  return { ok: true };
}

export function isProactiveSchedulerRunning() {
  return isRunning;
}
