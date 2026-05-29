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
import { botService, DEFAULT_BOT_ID, type Bot, type BotConfig } from './bot-service';
import { botMemoryService } from './bot-memory-service';
import { intervalDelayMs } from '@stuardai/bots-core';
import { buildLocalProactiveHiddenContext, buildLocalProactivePrompt, buildProactiveSessionSummary, buildUserFacingProactiveMessage, cleanProactiveResponseText, executeAgentToolRequest, extractAgentTextFromWsMessage, extractAgentToolRequest, isProactiveSkipResponse, splitProactiveStructuredContent, type BotPermissionGate } from './proactive-scheduler-utils';
import { getNotificationWindow, openNotificationWindow } from '../windows/window';
import logger from '../utils/logger';
import type { RouterContext } from '../tools/types';
import { loadSkills } from '../skills';
import { getChatModelsSettings, type ChatModelsSettings } from '../settings';

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
const AGENT_RESPONSE_TIMEOUT_MS = 180_000;
const PROACTIVE_REPLY_TIMEOUT_MS = 120_000;

// Interval→delay math (incl. the 'random' check-in window) lives in
// @stuardai/bots-core/schedule, single-sourced with the VM scheduler.

let pollTimer: ReturnType<typeof setInterval> | null = null;
let isRunning = false;
/**
 * Tracks the active wake-up run for each bot (botId → runId). Multiple bots
 * may run concurrently (parallel mode); we just guard against the SAME bot
 * starting two overlapping runs.
 */
const runningRuns = new Map<string, string>();

/** Convenience: legacy callers that ask "is anything running?" */
function anyRunActive(): boolean {
  return runningRuns.size > 0;
}

/**
 * Resolves a bot + its effective config by id. Returns null if the bot does
 * not exist (which can happen briefly during deletion). Used everywhere
 * inside the scheduler so we never read from the legacy single-config path
 * for non-default bots.
 */
function resolveBotForRun(botId: string): { bot: Bot; config: BotConfig } | null {
  const bot = botService.get(botId);
  if (!bot) return null;
  const config = botService.resolveConfig(botId);
  if (!config) return null;
  return { bot, config };
}

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

/**
 * Build the per-agent permission gate for a local run from its config. The
 * gate decides whether a sensitive tool (write/delete files, run_command,
 * terminal) runs straight away or pops a blocking approval prompt — the same
 * allow/deny notification the main chat uses (requestToolApproval).
 */
function buildBotPermissionGate(config: any, botName: string): BotPermissionGate {
  const mode: BotPermissionGate['mode'] =
    config?.permissionMode === 'auto' || config?.permissionMode === 'manual' || config?.permissionMode === 'selective'
      ? config.permissionMode
      : 'selective';
  const autoApprove = Array.isArray(config?.autoApproveTools)
    ? config.autoApproveTools.map((x: any) => String(x || '').trim().toLowerCase()).filter(Boolean)
    : [];
  const label = String(botName || '').trim() || 'Your agent';
  return {
    mode,
    autoApprove,
    requestApproval: async (toolName: string, args: any) => {
      try {
        const { requestToolApproval } = await import('./tool-approval');
        const human = String(toolName || 'a tool').replace(/_/g, ' ');
        return await requestToolApproval({
          id: `bot-approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          tool: toolName,
          toolOriginal: toolName,
          approvalArgs: args && typeof args === 'object' ? args : undefined,
          description: `${label} wants to use ${human}.`,
          timeoutMs: 55_000,
        });
      } catch {
        return false;
      }
    },
  };
}

function buildModelSelection(config: any): { model?: ProactiveModelMode; modelId?: string; modelConfig?: ChatModelsSettings } {
  const model = normalizeProactiveModelMode(config?.modelMode);
  const explicitModelId = String(config?.modelId || '').trim();
  const modelConfig = getChatModelsSettings();
  const tierDefault = model === 'auto' ? '' : modelConfig[model]?.default || '';
  return {
    model,
    modelId: explicitModelId || tierDefault || undefined,
    modelConfig,
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
  proactiveService.markNotificationEngagement(wakeUpId, 'replied', { replyText: text });

  // Resolve which bot owns the original wake-up. Replies must use the same
  // bot's config so the model/personality/tools match what said the message.
  let botId = DEFAULT_BOT_ID;
  try {
    const { logs } = proactiveService.getWakeUpLog(200);
    const originLog = logs.find(l => l.id === wakeUpId);
    if (originLog?.botId) botId = originLog.botId;
  } catch { /* fall through to default */ }

  try {
    pruneStaleConversations();

    const config = botService.resolveConfig(botId);
    if (!config) return { ok: false, error: 'bot_not_found' };
    const bot = botService.get(botId);
    const botName = bot?.name || 'Stuard bot';
    const token = await getAuthToken();
    const modelSelection = buildModelSelection(config);
    let reply: string;

    // Log the follow-up as its own activity entry, scoped to the same bot.
    proactiveService.addWakeUpLog({
      id: replyLogId,
      botId,
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
      botId,
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

    const allowedToolsNote = Array.isArray(config.allowedTools) && config.allowedTools.length > 0
      ? `\n\nAdded non-internal tools for this agent: ${config.allowedTools.join(', ')}.\nAll other non-internal tools are not part of this agent. Exact tools add only that tool; prefixes like x_ add a family only when explicitly listed. Your default toolkit (proactive_task_*, bot_memory_*, search_past_conversations, get_conversation_context) remains available regardless.\nIf asked what tools you have, list only those added tools plus the default toolkit. If asked to change your kanban, use bot_memory_* and verify ok=true before saying it was done.`
      : `\n\nAdded non-internal tools for this agent: (none).\nIf asked what tools you have, list only your default toolkit (proactive_task_*, bot_memory_*, search_past_conversations, get_conversation_context). Do not answer with a generic Stuard main-chat capability list. If asked to change your kanban, use bot_memory_* and verify ok=true before saying it was done.`;

    const localHiddenContext = `[PROACTIVE FOLLOW-UP] The user is replying in an ongoing conversation from a proactive check-in. Be helpful, friendly, and concise. Return only the final user-facing reply. Do not expose reasoning or internal planning. Return a normal plain markdown/text reply only. Do not use GenUI, interactive UI blocks, or JSON UI payloads.${allowedToolsNote}

Conversation so far:
"""
${contextToUse}
"""`;

    emitStage(replyLogId, 'connecting', config.executionTarget === 'cloud' ? 'cloud VM' : 'local agent');

    if (config.executionTarget === 'cloud') {
      emitStage(replyLogId, 'thinking', 'Cloud VM processing follow-up');
      const result = await executeCloud(replyLogId, {
        botId,
        botName,
        config: {
          instructions: 'The user is replying in an ongoing conversation from a proactive check-in. Be helpful, friendly, and concise. Return a normal plain markdown/text reply only. Do not use GenUI or interactive UI blocks.',
          allowedTools: config.allowedTools,
          modelMode: modelSelection.model,
          modelId: modelSelection.modelId || '',
          modelConfig: modelSelection.modelConfig,
        },
        prompt: cloudPrompt,
        context: {},
        tasks: proactiveService.getActiveTasks(botId),
      });
      reply = cleanProactiveResponseText(result.text);
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
          proactiveBotId: botId,
          preapproved: true,
        };
        const permissionGate = buildBotPermissionGate(config, botName);

        const onMessage = async (raw: WebSocket.RawData) => {
          if (resolved) return;
          try {
            const msg = JSON.parse(raw.toString('utf8'));

            const toolRequest = extractAgentToolRequest(msg);
            if (toolRequest) {
              const { execTool } = await import('../tools');
              const toolResult = await executeAgentToolRequest(
                toolRequest,
                toolCtx,
                execTool,
                Array.isArray(config.allowedTools) ? config.allowedTools : [],
                permissionGate,
              );
              try {
                ws.send(JSON.stringify(toolResult));
              } catch { }
              return;
            }

            if (msg?.requestId !== replyId) return;
            if (msg?.type === 'progress' && msg?.data?.text) chunks.push(msg.data.text);
            if (msg?.type === 'final' || msg?.type === 'proactive_result') {
              resolved = true; cleanup();
              resolve(cleanProactiveResponseText(extractAgentTextFromWsMessage(msg, chunks.join('') || 'I got your message.')));
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
          agent: 'bot',
          requestId: replyId,
          text,
          reasoningLevel: 'none',
          ...(modelSelection.model ? { model: modelSelection.model } : {}),
          ...(modelSelection.modelId ? { modelId: modelSelection.modelId } : {}),
          ...(modelSelection.modelConfig ? { modelConfig: modelSelection.modelConfig } : {}),
          ...(token ? { auth: { accessToken: token } } : {}),
          context: {
            mode: 'bot',
            botId,
            botName,
            proactiveBotId: botId,
            allowedTools: Array.isArray(config.allowedTools) ? config.allowedTools : [],
          },
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
  const ms = intervalDelayMs(interval);
  if (ms === null) return null;
  return new Date(Date.now() + ms).toISOString();
}

function humanizeAgentToolName(tool: string): string {
  return String(tool || 'tool')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function sanitizeWakeUpValue(value: any, depth = 0): any {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.length > 600 ? `${value.slice(0, 600)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  // Only collapse nested containers past the depth cap — primitives above are safe
  // to surface at any depth (e.g. delegate({tasks:[{subagent,instruction,context}]})
  // has strings at depth 3 that must render, not show as "[truncated]").
  if (depth >= 3) return '[truncated]';
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
    // Tools invoked during this run (e.g. proactive_task_create) inherit the
    // botId so kanban mutations are scoped to the calling bot.
    proactiveBotId: typeof payload?.botId === 'string' ? payload.botId : undefined,
    // The per-agent gate below is authoritative for bot runs — tell the local
    // tool bridge not to pop a second Python-side approval prompt.
    preapproved: true,
  };
  const permissionGate = buildBotPermissionGate(
    payload?.config || {},
    typeof payload?.botName === 'string' ? payload.botName : '',
  );

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

    // Idle-reset timer: the 180s budget is per-silence, not per-run. Any matching message
    // (progress, tool_request, subagent_event, final, etc.) resets it. This lets delegation
    // subagents run long-form without tripping the check-in budget, while still failing fast
    // if the stream goes truly quiet.
    let timeout: NodeJS.Timeout | null = null;
    const onIdleTimeout = () => {
      if (resolved) return;
      resolved = true;
      publishPartialResponse(true);
      cleanup();
      const partialResponse = chunks.join('').trim();
      const timeoutReason = `Agent went silent for ${Math.round(AGENT_RESPONSE_TIMEOUT_MS / 1000)} seconds.`;
      resolve({
        text: cleanProactiveResponseText(partialResponse) || timeoutReason,
        partialResponse: partialResponse || undefined,
        timedOut: true,
        failureReason: timeoutReason,
        taskUpdates: [],
        newTasks: [],
      });
    };
    const resetIdleTimer = () => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(onIdleTimeout, AGENT_RESPONSE_TIMEOUT_MS);
    };
    resetIdleTimer();

    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      ws.off('message', onMessage);
    };

    const onMessage = async (raw: WebSocket.RawData) => {
      if (resolved) return;
      try {
        const msg = JSON.parse(raw.toString('utf8'));
        const toolRequest = extractAgentToolRequest(msg);
        const matchesRequest = msg?.requestId === logId || msg?.id === logId;
        // Keep the idle timer alive on any activity for this run — tool_request frames
        // don't carry requestId, and subagent_event frames use non-progress types that
        // the handlers below ignore. Without this reset, a delegate call that takes
        // longer than 180s would trip the timeout even though the stream is active.
        if (toolRequest || matchesRequest || String(msg?.type || '').startsWith('subagent_')) {
          resetIdleTimer();
        }
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
          const toolResult = await executeAgentToolRequest(
            toolRequest,
            toolCtx,
            execTool,
            Array.isArray(payload?.config?.allowedTools) ? payload.config.allowedTools : [],
            permissionGate,
          );
          try {
            ws.send(JSON.stringify(toolResult));
          } catch { }
          return;
        }

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
            text: cleanProactiveResponseText(extractAgentTextFromWsMessage(msg, chunks.join('') || '')),
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
            text: cleanProactiveResponseText(extractAgentTextFromWsMessage(msg, chunks.join('') || '')),
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
      agent: 'bot',
      requestId: logId,
      text: buildLocalProactivePrompt(payload),
      reasoningLevel: 'none',
      ...(modelSelection.model ? { model: modelSelection.model } : {}),
      ...(modelSelection.modelId ? { modelId: modelSelection.modelId } : {}),
      ...(modelSelection.modelConfig ? { modelConfig: modelSelection.modelConfig } : {}),
      ...(token ? { auth: { accessToken: token } } : {}),
      context: {
        ...(payload.context?.screenshot ? { screenshots: [payload.context.screenshot] } : {}),
        mode: 'bot',
        botId: typeof payload.botId === 'string' ? payload.botId : '',
        botName: typeof payload.botName === 'string' ? payload.botName : '',
        proactiveBotId: typeof payload.botId === 'string' ? payload.botId : '',
        allowedTools: Array.isArray(payload?.config?.allowedTools) ? payload.config.allowedTools : [],
      },
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
    // Load active skills, narrowed to this bot's per-bot selection (mirrors
    // the local-path filtering above). The bot's skillIds list arrives via
    // payload.skills (already filtered), so we resolve full skill objects
    // from the global active set by id-membership.
    const payloadSkillIds = Array.isArray(payload.skills)
      ? payload.skills.map((s: any) => String(s?.id || '')).filter(Boolean)
      : null;
    const allActiveSkills = loadSkills().filter(s => s.isActive);
    const activeSkills = payloadSkillIds === null
      ? allActiveSkills
      : allActiveSkills.filter(s => payloadSkillIds.includes(s.id));

    const body = JSON.stringify({
      botId: typeof payload.botId === 'string' ? payload.botId : undefined,
      botName: typeof payload.botName === 'string' ? payload.botName : undefined,
      tasks: payload.tasks || [],
      instructions: payload.config?.instructions || '',
      // The bot's private kanban gets its own field so the cloud can render
      // it under a clear header (rather than mashed into "user instructions")
      // and reinforce the bot_memory_* tool guidance separately.
      kanbanContext: typeof payload.kanbanContext === 'string' ? payload.kanbanContext : undefined,
      prompt: typeof payload.prompt === 'string' ? payload.prompt : undefined,
      allowedTools: Array.isArray(payload.config?.allowedTools) ? payload.config.allowedTools : [],
      modelMode: normalizeProactiveModelMode(payload.config?.modelMode),
      modelId: String(payload.config?.modelId || '').trim() || undefined,
      modelConfig: payload.config?.modelConfig && typeof payload.config.modelConfig === 'object'
        ? payload.config.modelConfig
        : undefined,
      context: {
        screenshot: payload.context?.screenshot || null,
        systemAudio: payload.context?.systemAudio || false,
        micAudio: payload.context?.micAudio || false,
        openWindows: payload.context?.openWindows || [],
        recentSessionSummaries: payload.context?.recentSessionSummaries || [],
        triggerPayload: payload.context?.triggerPayload || null,
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

async function executeWakeUp(opts: {
  botId?: string;
  manual?: boolean;
  triggerId?: string;
  /** Optional payload from the trigger source (e.g. webhook body, email metadata). */
  triggerPayload?: any;
} = {}) {
  const botId = opts.botId || DEFAULT_BOT_ID;
  const triggerId = opts.triggerId;

  // Same-bot reentrancy guard. Different bots can run in parallel.
  if (runningRuns.has(botId)) {
    logger.debug(`[proactive-scheduler] Skipping wake-up for ${botId}, already running`);
    return;
  }

  const resolved = resolveBotForRun(botId);
  if (!resolved) {
    logger.warn(`[proactive-scheduler] Cannot run wake-up: bot ${botId} not found`);
    return;
  }
  const { bot, config } = resolved;

  // Manual triggers (e.g. "Run Once" from the UI) intentionally bypass the
  // running-status check so users can test a paused bot without flipping it on.
  if (bot.status !== 'running' && !opts.manual) return;

  const logId = `pwake_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  runningRuns.set(botId, logId);

  const contextUsed: string[] = [];
  let taskIds: string[] = [];
  let screenshotData: string | null = null;
  let openWindows: Array<{ id?: number; title: string }> = [];
  const startedAt = new Date().toISOString();
  const modelSelection = buildModelSelection(config);

  // Age out stale "pending" notifications as "ignored" (user never replied).
  // Scoped per bot so one bot's history doesn't get cleared by another's run.
  try {
    const recentNotifs = proactiveService.getRecentNotifications(20, { botId });
    for (const n of recentNotifs) {
      if (n.engagement === 'pending' && n.channel !== 'skip') {
        proactiveService.markNotificationEngagement(n.wakeUpId, 'ignored');
      }
    }
  } catch { }

  try {
    logger.info(`[proactive-scheduler] Starting wake-up for ${botId} (target: ${config.executionTarget})`);

    proactiveService.addWakeUpLog({
      id: logId,
      botId,
      triggerId,
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
      botId,
      triggerId,
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
        proactiveBotId: botId,
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
    try {
      const { execListOpenWindows } = await import('../tools/handlers/electron');
      const toolCtx: RouterContext = {
        agentWsUrl: getAgentWsUrl(),
        cloudAiUrl: getCloudAiUrl(),
        logFn: (msg: string) => logger.debug(`[proactive-scheduler] ${msg}`),
        proactiveBotId: botId,
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

    // Load recent session summaries for pattern awareness (per-bot memory).
    const recentSessionSummaries = proactiveService.getRecentSessionSummaries(5, { botId });

    // Load notification digest so the agent knows what it recently said.
    const notificationDigest = proactiveService.getNotificationDigest(8, { botId });

    // Get all active tasks (queued + in_progress) — agent manages lifecycle via tools.
    const activeTasks = proactiveService.getActiveTasks(botId);
    taskIds = activeTasks.map(t => t.id);

    if (activeTasks.length > 0) {
      emitStage(logId, 'loading-tasks', `${activeTasks.length} task${activeTasks.length === 1 ? '' : 's'}`);
    }

    // No auto in_progress marking — the agent controls task status via kanban tools

    // Load active skills for context, narrowed to this bot's selection.
    // skillIds === undefined → legacy behavior (all globally-active skills).
    // skillIds === []        → opt-out (no skills available to this bot).
    // skillIds === [...ids]  → only those skills (intersected with active).
    const allActiveSkills = loadSkills().filter(s => s.isActive);
    const botSkillIds = (config as any).skillIds as string[] | undefined;
    const activeSkills = botSkillIds === undefined
      ? allActiveSkills
      : allActiveSkills.filter(s => botSkillIds.includes(s.id));

    // Compose what the agent sees as its system context:
    //   - focusInstructions = identity + user-curated facts + today's focus
    //   - kanbanSection     = the bot's private kanban + recent run log
    // We keep them in separate fields so each path can render them under
    // clear headings (`## USER INSTRUCTIONS` vs `## YOUR PRIVATE KANBAN`)
    // instead of dumping everything into one undifferentiated blob.
    if (config.memoryEnabled) {
      botMemoryService.updateProfile(botId, {
        name: bot.name,
        systemPrompt: bot.systemPrompt || '',
        preferences: bot.storedFacts || '',
      });
    }
    const kanbanSection = config.memoryEnabled ? botMemoryService.formatForPrompt(botId) : '';
    const focusInstructions = [
      bot.systemPrompt?.trim() ? `# Identity & objective\n${bot.systemPrompt.trim()}` : '',
      config.memoryEnabled && bot.storedFacts?.trim() ? `# Things to remember\n${bot.storedFacts.trim()}` : '',
      config.instructions?.trim() ? `# Today's focus\n${config.instructions.trim()}` : '',
    ].filter(Boolean).join('\n\n');

    const wakeUpPayload = {
      botId,
      botName: bot.name,
      config: {
        instructions: focusInstructions,
        allowedTools: config.allowedTools,
        modelMode: normalizeProactiveModelMode((config as any).modelMode),
        modelId: String((config as any).modelId || '').trim(),
        modelConfig: modelSelection.modelConfig,
        // Per-bot tool autonomy — read by executeLocal's approval gate.
        permissionMode: config.permissionMode,
        autoApproveTools: config.autoApproveTools,
      },
      kanbanContext: kanbanSection || undefined,
      context: {
        screenshot: screenshotData,
        systemAudio: systemAudioData,
        micAudio: micAudioData,
        openWindows,
        recentSessionSummaries,
        notificationDigest,
        triggerPayload: opts.triggerPayload,
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

      // Apply agent-returned mutations (scoped to the running bot).
      if (executionResult.taskUpdates.length > 0) {
        proactiveService.applyTaskUpdates(executionResult.taskUpdates as any);
      }
      if (executionResult.newTasks.length > 0) {
        proactiveService.applyNewTasks(executionResult.newTasks as any, { botId });
      }
      // Apply deletions from cloud agent.
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

    // The prompt asks the agent to reply with just "skip" when it has nothing
    // to say. Treat that sentinel as silence — clear the message and force the
    // skip channel so the user never sees a notification literally reading "skip"
    // (and the wake-up log records an empty message rather than "skip").
    if (isProactiveSkipResponse(agentMessage)) {
      logger.info('[proactive-scheduler] Agent returned skip sentinel — suppressing notification');
      agentMessage = '';
      executionResult.agentChannel = 'skip';
    }

    // Broadcast task board refresh so UI updates immediately. Send the bot's
    // own task list so per-bot views can refresh in place.
    const updatedTasks = proactiveService.listTasks({ botId, limit: 500 });
    broadcastUpdate({ type: 'tasks-refreshed', botId, tasks: updatedTasks.tasks });

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

    // Stamp lastRunAt on the bot row.
    const lastRunAt = new Date().toISOString();
    botService.recordRun(botId, { lastRunAt });
    emitStage(logId, 'complete');

    // Use agent's urgency-based channel choice if available, otherwise fall back to configured channels
    const agentChannel = executionResult.agentChannel;
    const agentUrgency = executionResult.agentUrgency;

    let channels: string[] = config.notificationChannels || ['app'];
    if (agentMessage) {
      if (agentChannel === 'skip') {
        channels = [];
        logger.info(`[proactive-scheduler] Agent chose to skip notification (urgency: ${agentUrgency})`);
      } else if (agentChannel && agentChannel !== 'app') {
        // Agent chose an elevated channel (sms/call/whatsapp) — always include 'app' so the custom UI notification fires too
        channels = ['app', agentChannel];
        logger.info(`[proactive-scheduler] Agent chose channel: ${agentChannel} (urgency: ${agentUrgency})`);
      }
    }

    const primaryChannel = agentMessage ? (channels[0] || 'skip') : (agentChannel === 'skip' ? 'skip' : undefined);
    const sessionSummary = buildProactiveSessionSummary({
      existingSummary: executionResult.sessionSummary,
      openWindows,
      agentMessage,
      taskCount: activeTasks.length,
      skipped: !agentMessage || channels.length === 0 || primaryChannel === 'skip',
      failureReason: executionResult.failureReason,
      timedOut: executionResult.timedOut,
    });
    proactiveService.addSessionSummary(sessionSummary, {
      wakeUpId: logId,
      botId,
      notificationEngagement: primaryChannel && primaryChannel !== 'skip' ? 'pending' : undefined,
    });

    if (agentMessage) {
      if (channels.includes('app')) {
        sendCheckinNotification(logId, agentMessage, contextUsed.includes('screenshot'), taskIds.length);
      }
      if (channels.includes('sms')) {
        sendTelnyxNotification('sms', `Stuard Check-in: ${agentMessage.slice(0, 1500)}`).catch(() => { });
      }
      if (channels.includes('call')) {
        sendTelnyxNotification('call', agentMessage.slice(0, 500)).catch(() => { });
      }

      const primaryChannel = channels[0] || 'skip';
      if (primaryChannel !== 'skip') {
        proactiveService.logNotification({
          wakeUpId: logId,
          botId,
          message: agentMessage.slice(0, 300),
          channel: primaryChannel,
          urgency: agentUrgency || 'normal',
          engagement: 'pending',
        });
      }
    } else if (agentChannel === 'skip') {
      proactiveService.logNotification({
        wakeUpId: logId,
        botId,
        message: '(skipped — nothing new)',
        channel: 'skip',
        urgency: agentUrgency || 'low',
        engagement: 'ignored',
      });
    }

    broadcastUpdate({
      type: 'wake-up-complete',
      logId,
      botId,
      agentMessage,
      usage: executionResult.usage,
      modelId: executionResult.modelId || modelSelection.modelId || undefined,
    });

    // Auto-append a run-log entry to the bot's private memory so its next run
    // can see what just happened. Bots can also append richer entries
    // mid-run via the bot_memory tool; this is the always-on safety net.
    try {
      const summary = (agentMessage || executionResult.partialResponse || '(no agent message)')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 280);
      botMemoryService.appendRunLog(botId, {
        summary,
        outcome: executionResult.partialResponse && !agentMessage ? 'partial' : 'success',
      });
      try {
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) win.webContents.send('bot-memory-changed', { botId });
        }
      } catch { }
    } catch (e) {
      logger.warn('[proactive-scheduler] Failed to append run log:', e);
    }
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
    proactiveService.addSessionSummary(buildProactiveSessionSummary({
      openWindows,
      failureReason: String(e.message || e),
      timedOut: !!e?.timedOut,
    }), { wakeUpId: logId, botId });
    broadcastUpdate({ type: 'wake-up-failed', logId, botId, error: String(e.message || e), timedOut: !!e?.timedOut });
    // Append a failure run-log entry so the bot can see the error context next run.
    try {
      const reason = String(e?.userFacingMessage || e?.message || e).replace(/\s+/g, ' ').trim().slice(0, 280);
      botMemoryService.appendRunLog(botId, {
        summary: e?.timedOut ? `Timed out: ${reason}` : `Failed: ${reason}`,
        outcome: 'failed',
      });
      try {
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) win.webContents.send('bot-memory-changed', { botId });
        }
      } catch { }
    } catch (logErr) {
      logger.warn('[proactive-scheduler] Failed to append failure run log:', logErr);
    }
  } finally {
    runningRuns.delete(botId);

    // Reschedule the bot's interval-based trigger. Cron and webhook triggers
    // self-manage; we only roll forward the `nextRunAt` here. Paused bots
    // and bots with no interval trigger get a null nextRunAt (silent).
    const freshBot = botService.get(botId);
    const intervalTrigger = freshBot?.triggers.find(t =>
      t.type === 'schedule.interval' && t.enabled !== false,
    );
    const every = intervalTrigger ? String(intervalTrigger.args?.every || '30m') : null;
    if (freshBot && freshBot.status === 'running' && every && every !== 'manual') {
      const next = computeNextWakeUp(every);
      botService.recordRun(botId, { nextRunAt: next });
      broadcastUpdate({ type: 'next-wakeup-scheduled', botId, nextWakeUpAt: next });
    } else {
      botService.recordRun(botId, { nextRunAt: null });
    }
  }
}

/**
 * Public entry point used by the bot-trigger-dispatcher (cron jobs) and the
 * cloud webhook relay. Equivalent to `triggerManualWakeUp` for the manual
 * case but lets external callers identify which trigger fired.
 */
export function executeWakeUpForBot(opts: {
  botId: string;
  triggerId?: string;
  triggerPayload?: any;
  manual?: boolean;
}): void {
  if (!opts.botId) return;
  if (runningRuns.has(opts.botId)) {
    logger.debug(`[proactive-scheduler] Skipping fire for ${opts.botId} (${opts.triggerId}); already running`);
    return;
  }
  executeWakeUp(opts);
}

// ─── Polling ────────────────────────────────────────────────────────────────

function checkSchedule() {
  try {
    const bots = botService.list();
    for (const bot of bots) {
      // Only running bots get scheduled. Paused/errored bots are quiescent.
      if (bot.status !== 'running') continue;
      if (runningRuns.has(bot.id)) continue;

      // Find the bot's interval-based trigger (at most one per bot in v1).
      // Cron triggers are handled by the bot-trigger-dispatcher's node-cron
      // jobs; webhook/gmail triggers fire from the cloud relay.
      const intervalTrigger = bot.triggers.find(t =>
        t.type === 'schedule.interval' && t.enabled !== false,
      );
      if (!intervalTrigger) continue;

      const every = String(intervalTrigger.args?.every || '30m');
      if (every === 'manual') continue;

      // Initialize nextRunAt if it hasn't been set yet (first time the bot
      // becomes running, or trigger was just added).
      if (!bot.nextRunAt) {
        const next = computeNextWakeUp(every);
        botService.recordRun(bot.id, { nextRunAt: next });
        continue;
      }

      const nextTime = new Date(bot.nextRunAt).getTime();
      if (isNaN(nextTime)) continue;

      if (Date.now() >= nextTime) {
        executeWakeUp({ botId: bot.id, triggerId: intervalTrigger.id });
      }
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

export function triggerManualWakeUp(botId?: string) {
  const targetBotId = botId || DEFAULT_BOT_ID;
  if (runningRuns.has(targetBotId)) {
    return { ok: false, error: `Already running a check-in for ${targetBotId}` };
  }
  if (!botService.get(targetBotId)) {
    return { ok: false, error: 'Agent not found' };
  }
  executeWakeUp({ botId: targetBotId, manual: true });
  return { ok: true, botId: targetBotId, target: 'local' as const };
}

/**
 * Forward a manual run to the VM via `/v1/bot/run` instead of executing
 * locally. Used by the Cloud Engine Run buttons so clicks inside the VM
 * workspace fire the VM (which is what the user sees in the VM logs and
 * the kanban memory the VM writes), not the desktop's proactive-scheduler.
 */
export async function triggerVmWakeUp(botId: string): Promise<{ ok: boolean; error?: string; target: 'vm' }> {
  const id = String(botId || '').trim();
  if (!id) return { ok: false, error: 'bot_id_required', target: 'vm' };
  const bot = botService.get(id);
  if (!bot) return { ok: false, error: 'Agent not found', target: 'vm' };
  if (!bot.vmDeployedAt) {
    // Caller should not be exposing the VM-run path for a bot that hasn't
    // been deployed; surface that explicitly so the UI can fall back.
    return { ok: false, error: 'bot_not_deployed_to_vm', target: 'vm' };
  }
  const token = await getAuthToken();
  if (!token) return { ok: false, error: 'not_authenticated', target: 'vm' };
  const cloudUrl = getCloudAiUrl();
  try {
    const url = `${cloudUrl}/v1/bot/run`;
    const resp = await net.fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ botId: id }),
    });
    // 404 happens when cloud-ai hasn't been redeployed with the new
    // /v1/bot/run route yet. Surface that distinctly so the UI can hint at
    // a redeploy instead of just saying "VM unreachable".
    if (resp.status === 404) {
      logger.warn(`[proactive-scheduler] VM run for ${id}: ${url} returned 404 — cloud-ai needs a redeploy with the /v1/bot/run route`);
      return { ok: false, error: 'http_404', target: 'vm' };
    }
    const data = await resp.json().catch(() => ({})) as any;
    if (!resp.ok || data?.ok === false) {
      const err = String(data?.error || `http_${resp.status}`);
      logger.warn(`[proactive-scheduler] VM run for ${id} failed: ${err}`);
      return { ok: false, error: err, target: 'vm' };
    }
    logger.info(`[proactive-scheduler] VM run for ${id} accepted`);
    return { ok: true, target: 'vm' };
  } catch (e: any) {
    logger.warn(`[proactive-scheduler] VM run for ${id} error:`, e?.message || e);
    return { ok: false, error: String(e?.message || 'vm_unreachable'), target: 'vm' };
  }
}

export function isProactiveSchedulerRunning() {
  return isRunning;
}
