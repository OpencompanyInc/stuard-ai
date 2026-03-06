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
import { buildLocalProactiveHiddenContext, buildLocalProactivePrompt, buildUserFacingProactiveMessage, executeAgentToolRequest, extractAgentTextFromWsMessage, extractAgentToolRequest } from './proactive-scheduler-utils';
import { getNotificationWindow } from '../windows/window';
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

// ─── Agent WebSocket (main process, same pattern as stuards.ts) ─────────────

let agentWs: WebSocket | null = null;
let agentReady: Promise<WebSocket> | null = null;

function getAgentWsUrl() {
  const raw = String(process.env.AGENT_WS || '').trim();
  if (raw) return raw.endsWith('/ws') ? raw : (raw.replace(/\/$/, '') + '/ws');
  return 'ws://127.0.0.1:8765/ws';
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
      const to = setTimeout(() => {
        try { ws.terminate(); } catch { }
        reject(new Error('proactive_ws_timeout'));
      }, 10_000);

      ws.on('open', () => { clearTimeout(to); agentWs = ws; resolve(ws); });
      ws.on('error', (e: Error) => { clearTimeout(to); reject(e); });
      ws.on('close', () => { agentWs = null; agentReady = null; });
    } catch (e) { reject(e as any); }
  });
  return agentReady;
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

function sendCheckinNotification(wakeUpId: string, agentMessage: string, screenshotUsed: boolean, tasksCompleted: number): void {
  const displayMessage = buildUserFacingProactiveMessage(agentMessage);
  const notifWin = getNotificationWindow();
  if (notifWin && !notifWin.isDestroyed()) {
    notifWin.webContents.send('proactive-checkin', {
      wakeUpId,
      agentMessage: displayMessage,
      screenshotUsed,
      tasksCompleted,
    });
  } else {
    try {
      if (Notification.isSupported()) {
        new Notification({ title: 'Stuard - Check-in', body: displayMessage.slice(0, 200) || '' }).show();
      }
    } catch { }
  }
}

/**
 * Called when the user replies to a check-in notification.
 * Sends the reply to the agent and shows the response as a new notification.
 */
export async function handleProactiveReply(wakeUpId: string, text: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { config } = proactiveService.getConfig();
    const token = await getAuthToken();
    const modelSelection = buildModelSelection(config);
    let reply: string;

    const { logs } = proactiveService.getWakeUpLog(50);
    const prevLog = logs?.find(l => l.id === wakeUpId);
    const prevAgentMessage = prevLog?.agentMessage || prevLog?.partialResponse || 'I just checked in with you.';

    const cloudPrompt = `[PROACTIVE REPLY]
Previous Check-in Message:
"""
${prevAgentMessage}
"""

User Reply:
${text}

Respond briefly, warmly, and helpfully.`;

    const localHiddenContext = `[PROACTIVE REPLY] The user is replying to your proactive check-in. Be helpful, friendly, and concise. Return only the final user-facing reply. Do not expose reasoning or internal planning.

Previous Check-in Message:
"""
${prevAgentMessage}
"""`;

    if (config.executionTarget === 'cloud') {
      const result = await executeCloud(`${wakeUpId}_reply`, {
        config: {
          instructions: 'The user is replying to your proactive check-in. Be helpful, friendly, and concise.',
          modelMode: modelSelection.model,
          modelId: modelSelection.modelId || '',
        },
        prompt: cloudPrompt,
        context: {},
        tasks: proactiveService.getActiveTasks(),
      });
      reply = result.text;
    } else {
      const ws = await ensureAgentWs();
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

    sendCheckinNotification(wakeUpId, reply, false, 0);
    return { ok: true };
  } catch (e: any) {
    logger.error('[proactive-scheduler] Reply failed:', e);
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
}

async function executeLocal(logId: string, payload: any): Promise<WakeUpExecutionResult> {
  const ws = await ensureAgentWs();
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
          resolve({
            text: extractAgentTextFromWsMessage(msg, chunks.join('') || ''),
            partialResponse: chunks.join('').trim() || undefined,
            taskUpdates: [],
            newTasks: [],
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
      },
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

    if (config.contextPermissions.systemAudio || config.contextPermissions.micAudio) {
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
    });

    proactiveService.setLastWakeUp(new Date().toISOString());
    emitStage(logId, 'complete');

    if (agentMessage) {
      const channels: string[] = config.notificationChannels || ['app'];
      if (channels.includes('app')) {
        sendCheckinNotification(logId, agentMessage, contextUsed.includes('screenshot'), taskIds.length);
      }
      if (channels.includes('sms')) {
        sendTelnyxNotification('sms', `Stuard Check-in: ${agentMessage.slice(0, 1500)}`).catch(() => { });
      }
      if (channels.includes('call')) {
        sendTelnyxNotification('call', agentMessage.slice(0, 500)).catch(() => { });
      }
    }

    broadcastUpdate({ type: 'wake-up-complete', logId, agentMessage });
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
