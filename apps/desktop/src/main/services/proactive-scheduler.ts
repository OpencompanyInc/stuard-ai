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
import { getNotificationWindow } from '../windows/window';
import logger from '../utils/logger';

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

const STAGE_META: Record<ProactiveStage, StageInfo> = {
  'initializing':     { label: 'Initializing check-in...', progress: 5 },
  'capturing-screen': { label: 'Capturing screenshot...',  progress: 15 },
  'gathering-context':{ label: 'Gathering context...',     progress: 25 },
  'loading-tasks':    { label: 'Loading queued tasks...',   progress: 35 },
  'connecting':       { label: 'Connecting to agent...',    progress: 50 },
  'thinking':         { label: 'Agent is thinking...',      progress: 65 },
  'processing':       { label: 'Processing response...',    progress: 85 },
  'complete':         { label: 'Check-in complete',         progress: 100 },
  'failed':           { label: 'Check-in failed',           progress: 100 },
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
  const stagePayload = { type: 'stage' as const, logId, stage, label: meta.label, progress: meta.progress, detail };

  broadcastUpdate(stagePayload);

  const notifWin = getNotificationWindow();
  if (notifWin && !notifWin.isDestroyed()) {
    notifWin.webContents.send('proactive-progress', stagePayload);
  }
}

// ─── Notification-based Check-in ────────────────────────────────────────────

function sendCheckinNotification(wakeUpId: string, agentMessage: string, screenshotUsed: boolean, tasksCompleted: number): void {
  const notifWin = getNotificationWindow();
  if (notifWin && !notifWin.isDestroyed()) {
    notifWin.webContents.send('proactive-checkin', {
      wakeUpId,
      agentMessage,
      screenshotUsed,
      tasksCompleted,
    });
  } else {
    try {
      if (Notification.isSupported()) {
        new Notification({ title: 'Stuard - Check-in', body: agentMessage.slice(0, 200) || '' }).show();
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

    if (config.executionTarget === 'cloud') {
      const result = await executeCloud(`${wakeUpId}_reply`, {
        config: {
          instructions: 'The user is replying to your proactive check-in. Be helpful, friendly, and concise.',
          modelMode: modelSelection.model,
          modelId: modelSelection.modelId || '',
        },
        prompt: `[PROACTIVE REPLY]\nUser: ${text}\n\nRespond briefly, warmly, and helpfully.`,
        context: {},
        tasks: [],
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

        const onMessage = (raw: WebSocket.RawData) => {
          if (resolved) return;
          try {
            const msg = JSON.parse(raw.toString('utf8'));
            if (msg?.requestId !== replyId) return;
            if (msg?.type === 'progress' && msg?.data?.text) chunks.push(msg.data.text);
            if (msg?.type === 'final' || msg?.type === 'proactive_result') {
              resolved = true; cleanup();
              resolve(msg?.message?.text || msg?.text || msg?.message || chunks.join('') || 'I got your message.');
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
          ...(modelSelection.model ? { model: modelSelection.model } : {}),
          ...(modelSelection.modelId ? { modelId: modelSelection.modelId } : {}),
          ...(token ? { auth: { accessToken: token } } : {}),
          hiddenContext: '[PROACTIVE REPLY] The user is replying to your proactive check-in. Be helpful, friendly, and concise.',
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

// ─── Local Agent Execution ──────────────────────────────────────────────────

async function executeLocal(logId: string, payload: any): Promise<string> {
  const ws = await ensureAgentWs();
  const token = await getAuthToken();
  const modelSelection = buildModelSelection(payload?.config || {});

  return new Promise<string>((resolve) => {
    let resolved = false;
    const chunks: string[] = [];

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve(chunks.join('') || 'Agent did not respond within the time limit.');
      }
    }, AGENT_RESPONSE_TIMEOUT_MS);

    const cleanup = () => {
      clearTimeout(timeout);
      ws.off('message', onMessage);
    };

    const onMessage = (raw: WebSocket.RawData) => {
      if (resolved) return;
      try {
        const msg = JSON.parse(raw.toString('utf8'));

        if (msg?.type === 'progress' && msg?.data?.text && msg?.requestId === logId) {
          chunks.push(msg.data.text);
        }
        if (msg?.type === 'final' && msg?.requestId === logId) {
          resolved = true;
          cleanup();
          resolve(msg?.message?.text || msg?.text || chunks.join('') || '');
        }
        if (msg?.type === 'proactive_result' && msg?.id === logId) {
          resolved = true;
          cleanup();
          resolve(msg.message || msg.result || '');
        }
        if (msg?.type === 'error' && msg?.requestId === logId) {
          resolved = true;
          cleanup();
          resolve(`Error: ${msg.message || 'Unknown error'}`);
        }
      } catch { }
    };

    ws.on('message', onMessage);

    const chatPayload = {
      type: 'chat',
      requestId: logId,
      text: buildPrompt(payload),
      ...(modelSelection.model ? { model: modelSelection.model } : {}),
      ...(modelSelection.modelId ? { modelId: modelSelection.modelId } : {}),
      ...(token ? { auth: { accessToken: token } } : {}),
      context: payload.context?.screenshot ? { screenshots: [payload.context.screenshot] } : undefined,
      hiddenContext: `[PROACTIVE MODE] The user has enabled proactive check-ins. ${payload.config?.instructions || ''}`,
      hiddenStateSummary: payload.tasks?.length
        ? `Queued tasks to work on:\n${payload.tasks.map((t: any) => `- ${t.title}: ${t.instructions}`).join('\n')}`
        : undefined,
    };

    ws.send(JSON.stringify(chatPayload));
  });
}

function buildPrompt(payload: any): string {
  const parts: string[] = [];
  parts.push('[Proactive Check-in]');

  if (payload.config?.instructions) {
    parts.push(payload.config.instructions);
  } else {
    parts.push('Check in on the user. See if they need help with anything.');
  }

  if (payload.tasks?.length) {
    parts.push('\nQueued tasks:');
    for (const t of payload.tasks) {
      parts.push(`- ${t.title}${t.instructions ? ': ' + t.instructions : ''}`);
    }
  }

  if (payload.context?.screenshot) {
    parts.push('\n(A screenshot of the user\'s current screen is attached.)');
  }

  parts.push('\nRespond concisely. If nothing needs attention, say so briefly.');
  return parts.join('\n');
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
}

async function executeCloud(logId: string, payload: any): Promise<CloudWakeUpResult> {
  const token = await getAuthToken();
  if (!token) return { text: 'Cloud execution failed: not authenticated. Please sign in.', taskUpdates: [], newTasks: [] };

  const cloudUrl = getCloudAiUrl();

  try {
    const body = JSON.stringify({
      tasks: payload.tasks || [],
      instructions: payload.config?.instructions || '',
      modelMode: normalizeProactiveModelMode(payload.config?.modelMode),
      modelId: String(payload.config?.modelId || '').trim() || undefined,
      context: {
        screenshot: !!payload.context?.screenshot,
        systemAudio: payload.context?.systemAudio || false,
        micAudio: payload.context?.micAudio || false,
      },
    });

    const resp = await net.fetch(`${cloudUrl}/v1/proactive/wakeup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body,
    });

    const data = await resp.json() as any;
    return {
      text: data.text || (data.ok ? 'Cloud check-in completed.' : `Cloud execution failed: ${data.error || 'Unknown error'}`),
      taskUpdates: Array.isArray(data.taskUpdates) ? data.taskUpdates : [],
      newTasks: Array.isArray(data.newTasks) ? data.newTasks : [],
    };
  } catch (e: any) {
    logger.error('[proactive-scheduler] Cloud execution failed:', e);
    return { text: `Cloud execution failed: ${e.message || 'Connection error'}`, taskUpdates: [], newTasks: [] };
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
  let screenshotData: string | null = null;

  try {
    logger.info(`[proactive-scheduler] Starting wake-up (target: ${config.executionTarget})`);
    emitStage(logId, 'initializing');

    proactiveService.addWakeUpLog({
      id: logId,
      startedAt: new Date().toISOString(),
      status: 'running',
      contextUsed: [],
      tasksProcessed: [],
    });

    // Capture context
    if (config.contextPermissions.screenshot) {
      emitStage(logId, 'capturing-screen');
      screenshotData = await captureScreenshot();
      if (screenshotData) contextUsed.push('screenshot');
    }
    if (config.contextPermissions.systemAudio) contextUsed.push('systemAudio');
    if (config.contextPermissions.micAudio) contextUsed.push('micAudio');

    if (contextUsed.length > 0) {
      emitStage(logId, 'gathering-context', contextUsed.join(', '));
    }

    // Get all active tasks (queued + in_progress) — agent manages lifecycle via tools
    const activeTasks = proactiveService.getActiveTasks();
    const taskIds = activeTasks.map(t => t.id);

    if (activeTasks.length > 0) {
      emitStage(logId, 'loading-tasks', `${activeTasks.length} task${activeTasks.length === 1 ? '' : 's'}`);
    }

    // No auto in_progress marking — the agent controls task status via kanban tools

    const wakeUpPayload = {
      config: {
        instructions: config.instructions,
        allowedTools: config.allowedTools,
        modelMode: normalizeProactiveModelMode((config as any).modelMode),
        modelId: String((config as any).modelId || '').trim(),
      },
      context: {
        screenshot: screenshotData,
        systemAudio: config.contextPermissions.systemAudio,
        micAudio: config.contextPermissions.micAudio,
      },
      tasks: activeTasks.map(t => ({
        id: t.id,
        title: t.title,
        instructions: t.instructions,
        status: t.status,
      })),
    };

    const targetLabel = config.executionTarget === 'cloud' ? 'cloud VM' : 'local agent';
    emitStage(logId, 'connecting', targetLabel);

    // Execute on the appropriate target
    let agentMessage: string;
    if (config.executionTarget === 'cloud') {
      emitStage(logId, 'thinking', 'Cloud VM processing');
      const result = await executeCloud(logId, wakeUpPayload);
      agentMessage = result.text;

      // Apply agent-returned mutations
      if (result.taskUpdates.length > 0) {
        proactiveService.applyTaskUpdates(result.taskUpdates as any);
      }
      if (result.newTasks.length > 0) {
        proactiveService.applyNewTasks(result.newTasks as any);
      }
    } else {
      emitStage(logId, 'thinking', 'Local agent processing');
      agentMessage = await executeLocal(logId, wakeUpPayload);
      // Local path: no tool support yet, tasks remain in current state
    }

    emitStage(logId, 'processing');

    // No auto-complete — agent already managed task status via tools

    proactiveService.updateWakeUpLog(logId, {
      completedAt: new Date().toISOString(),
      status: 'completed',
      contextUsed,
      tasksProcessed: taskIds,
      agentMessage,
    });

    proactiveService.setLastWakeUp(new Date().toISOString());
    emitStage(logId, 'complete');

    if (agentMessage) {
      const channels: string[] = config.notificationChannels || ['app'];
      if (channels.includes('app')) {
        sendCheckinNotification(logId, agentMessage, contextUsed.includes('screenshot'), taskIds.length);
      }
      if (channels.includes('sms')) {
        sendTelnyxNotification('sms', `Stuard Check-in: ${agentMessage.slice(0, 1500)}`).catch(() => {});
      }
      if (channels.includes('call')) {
        sendTelnyxNotification('call', agentMessage.slice(0, 500)).catch(() => {});
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
      agentMessage: String(e.message || e),
    });
    broadcastUpdate({ type: 'wake-up-failed', logId, error: String(e.message || e) });
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
