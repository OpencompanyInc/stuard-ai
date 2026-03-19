import 'dotenv/config';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { getWorkflowAgent, WORKFLOW_SYSTEM_PROMPT } from './agents/workflow-agent';
import { getSkillAgent, SKILL_SYSTEM_PROMPT, setSessionSkill, clearSessionSkill } from './agents/skill-agent';
import { setSessionWorkflow, clearSessionWorkflow } from './tools/workflow';
import { withClientBridge, handleClientToolMessage } from './tools/bridge';
import { routeModel, type ModelChoice } from './router/model-router';
import { verifyAccessToken, AuthErrorCode } from './auth';
import { createConversation, addAssistantMessage, addUserMessage, getConversationMessages, logUsageEvent, checkAccess, incrementDailyRequestCounter, finishRun, setConversationTitle, getExternalAccount } from './supabase';
import { getDefaultModelForCategory, priceForModel } from './pricing';
import { buildProviderModel } from './utils/models';
import { randomUUID } from 'crypto';
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { google } from './utils/models';
import { handleHttpRoutes } from './routes';
import { PORT, ENABLE_ROUTING, REQUIRE_AUTH, MAX_STEPS_CAP, DEFAULT_MAX_STEPS, PING_INTERVAL_MS } from './utils/config';
import { writeLog } from './utils/logger';
import { sanitizeToolEvent, sanitizeSteps, redactSensitiveData, sanitizeToolResult } from './utils/sanitize';
import { normalizeMessages, contentToText, buildAttachmentParts, dataStringToBuffer } from './utils/messages';
import { modelSupportsMultimodal } from './routes/models';
import { buildKnowledgeContext } from './knowledge/retrieval';
import { ensureToolEmbeddings } from './tools/meta-tools';
import * as memoryService from './memory/conversations';
import {
  compactHistory,
  emergencyTruncate,
  getRecentWithinBudget,
  pruneToolOutputs,
} from './memory/context-compactor';
import { computeBudget, estimateTokens, shouldCompact } from './memory/token-budget';
import { registerWebhookClient, deliverQueuedWebhooks } from './webhooks/dispatch';
import { getOrCreateQueryEmbedding } from './utils/shared-embedding';
import { getRankedToolNames } from './utils/tool-ranking';
import { searchFiles } from './services/file-indexing';
import { normalizeUsage } from './utils/usage';
import { hasProactiveModeMarker, mergeForcedToolNames } from './tools/proactive-task-tools';

import { getAgentForQuery } from './agents/stuard/index';


import { startVMHealthMonitor } from './services/vm-health';
import { startBillingCron } from './services/compute-billing';
import { startReminderCron } from './services/cloud-reminders';
import { registerConnection, getDesktopWs, getConnectionInfo } from './services/vm-bridge';
import { verifyVMToken, mintVMToken } from './services/vm-tokens';
import { handleDesktopRelayResult } from './routes/desktop-tool-relay';
import { resolveVMBaseUrl, resolveVMSecret } from './services/vm-command';

// Configuration moved to utils/config

type TierChoice = 'auto' | ModelChoice;

function normalizeTierChoice(input: any): TierChoice {
  const raw = String(input || '').toLowerCase().trim();
  if (raw === 'deep') return 'smart';
  if (raw === 'smart') return 'smart';
  if (raw === 'balanced') return 'balanced';
  if (raw === 'fast') return 'fast';
  if (raw === 'auto') return 'auto';
  return 'balanced';
}

function pickDefaultModelId(modelConfig: any, tier: ModelChoice): string | undefined {
  try {
    const cfg = modelConfig && typeof modelConfig === 'object' ? modelConfig : null;
    const entry = cfg && (cfg as any)[tier];
    const d = entry && typeof entry.default === 'string' ? String(entry.default).trim() : '';
    return d || undefined;
  } catch {
    return undefined;
  }
}

function send(ws: WebSocket, data: unknown, requestId?: string) {
  try {
    // Include requestId in all messages for parallel routing
    const payload = requestId ? { ...data as object, requestId } : data;
    ws.send(JSON.stringify(payload));
  } catch { }
}

// Helper to check if a tool should be hidden from UI (SIS meta-tools, internal operations)
function isSISMetaTool(toolName: string): boolean {
  return toolName === 'sis_execute_tool' ||
    toolName === 'sis_search_tools' ||
    toolName === 'sis_list_categories' ||
    toolName === 'search_past_conversations' ||
    toolName === 'segment_search';
}

function truncateHistoryToolResult(result: unknown): unknown {
  if (typeof result !== 'string') return result;
  if (result.length <= 2000) return result;
  return result.slice(0, 1800) + `\n...[truncated, ${result.length} chars total]`;
}

function normalizeResponseHistoryMessage(msg: any): { role: 'assistant' | 'tool'; content: any } | null {
  if (!msg || typeof msg !== 'object') return null;
  const role = msg.role === 'assistant' || msg.role === 'tool' ? msg.role : null;
  if (!role) return null;

  if (typeof msg.content === 'string') {
    const text = msg.content.trim();
    return text ? { role, content: text } : null;
  }

  if (Array.isArray(msg.content)) {
    const content = msg.content
      .map((part: any) => {
        if (typeof part === 'string') return part;
        if (!part || typeof part !== 'object') return null;
        if (part.type === 'tool-result') {
          return { ...part, result: truncateHistoryToolResult(part.result) };
        }
        return { ...part };
      })
      .filter((part: any) => part !== null);

    return content.length > 0 ? { role, content } : null;
  }

  return null;
}

type IncomingSkillStep = {
  id: string;
  type: string;
  label: string;
  content: string;
  toolName?: string;
};

type IncomingSkill = {
  id: string;
  name: string;
  description: string;
  trigger: string;
  steps: IncomingSkillStep[];
  icon?: string;
  color?: string;
  isActive?: boolean;
};

function sanitizeIncomingSkills(rawSkills: any): IncomingSkill[] {
  if (!Array.isArray(rawSkills)) return [];
  const MAX_SKILLS = 30;
  const MAX_STEPS = 40;
  const trim = (value: unknown, maxLen: number = 4000): string => {
    const out = String(value ?? '').trim();
    return out.length > maxLen ? out.slice(0, maxLen) : out;
  };

  return rawSkills
    .slice(0, MAX_SKILLS)
    .map((raw): IncomingSkill | null => {
      if (!raw || typeof raw !== 'object') return null;
      const id = trim(raw.id, 256);
      const name = trim(raw.name, 256);
      if (!id || !name) return null;

      const steps = Array.isArray(raw.steps)
        ? raw.steps
          .slice(0, MAX_STEPS)
          .map((step: any): IncomingSkillStep | null => {
            if (!step || typeof step !== 'object') return null;
            const stepId = trim(step.id, 256);
            const type = trim(step.type, 64) || 'prompt';
            if (!stepId || !type) return null;
            const toolName = trim(step.toolName, 256);
            return {
              id: stepId,
              type,
              label: trim(step.label, 256),
              content: trim(step.content, 4000),
              ...(toolName ? { toolName } : {}),
            };
          })
          .filter((s: IncomingSkillStep | null): s is IncomingSkillStep => !!s)
        : [];

      return {
        id,
        name,
        description: trim(raw.description, 4000),
        trigger: trim(raw.trigger, 2000),
        steps,
        icon: trim(raw.icon, 64) || undefined,
        color: trim(raw.color, 64) || undefined,
        isActive: !!raw.isActive,
      };
    })
    .filter((s: IncomingSkill | null): s is IncomingSkill => !!s);
}

// Sanitizers moved to utils/sanitize

// Logging moved to utils/logger

// Message helpers moved to utils/messages

// Create HTTP server for Cloud Run health checks and attach WS on /ws
const server = http.createServer(async (req, res) => {
  const url = req.url || '/';
  let parsedUrl: URL;
  try { parsedUrl = new URL(url, 'http://localhost'); } catch { parsedUrl = new URL('http://localhost/'); }
  // CORS preflight support
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Filename, X-File-Path',
      'Access-Control-Max-Age': '600',
    });
    res.end();
    return;
  }
  if (await handleHttpRoutes(req, res, parsedUrl)) return;
  res.writeHead(404).end();
});


const WS_MAX_PAYLOAD = Number(process.env.CLOUD_WS_MAX_PAYLOAD || 868435456);
const wss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_PAYLOAD });
const vmProxyWss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_PAYLOAD });

function buildVmProxyUrl(baseUrl: string, token: string): string {
  const trimmed = String(baseUrl || '').replace(/\/+$/, '');
  const wsBase = trimmed.startsWith('https://')
    ? `wss://${trimmed.slice('https://'.length)}`
    : trimmed.startsWith('http://')
      ? `ws://${trimmed.slice('http://'.length)}`
      : trimmed;
  return `${wsBase}/ws?token=${encodeURIComponent(token)}`;
}

// WS keepalive: periodically ping clients; terminate if no pong
// PING_INTERVAL_MS is imported from utils/config
const wsAlive = new WeakMap<WebSocket, boolean>();
const pingTimer = setInterval(() => {
  try {
    wss.clients.forEach((client: WebSocket) => {
      const alive = wsAlive.get(client);
      if (alive === false) {
        writeLog('ws_terminate_due_to_no_pong');
        try { client.terminate(); } catch { }
        wsAlive.delete(client);
        return;
      }
      wsAlive.set(client, false);
      try { client.ping(); } catch { }
    });
  } catch { }
}, PING_INTERVAL_MS);
server.on('close', () => { try { clearInterval(pingTimer); } catch { } });

import { handleSpeechConnection } from './routes/speech';
import { handleTerminalConnection } from './routes/terminal-relay';
import { handleVoiceConnection } from './routes/voice-bridge';
import { telnyxBridgeWss } from './routes/integrations/telnyx-bridge';
import { verifyTelnyxConfig } from './routes/integrations/telnyx';
import { initVoiceProviders } from './voice';

initVoiceProviders();
verifyTelnyxConfig().catch(e => console.warn('[telnyx] Config verification failed:', e?.message));

server.on('upgrade', (req, socket, head) => {
  const url = req.url || '';
  if (url === '/ws' || url.startsWith('/ws?')) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else if (url.startsWith('/ws/telnyx-bridge')) {
    telnyxBridgeWss.handleUpgrade(req, socket, head, (ws) => {
      telnyxBridgeWss.emit('connection', ws, req);
    });
  } else if (url === '/vm/ws' || url.startsWith('/vm/ws?')) {
    (async () => {
      try {
        const parsed = new URL(url, 'http://localhost');
        const token = parsed.searchParams.get('token') || '';
        const authResult = token ? await verifyAccessToken(token) : null;
        if (!authResult?.success || !authResult.userId) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        const baseUrl = await resolveVMBaseUrl(authResult.userId);
        const vmSecret = await resolveVMSecret(authResult.userId);
        if (!baseUrl || !vmSecret) {
          socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
          socket.destroy();
          return;
        }

        const vmToken = mintVMToken(vmSecret, authResult.userId, 'cloud-ai-vm-ws');
        (req as any).__vmProxy = {
          userId: authResult.userId,
          vmUrl: buildVmProxyUrl(baseUrl, vmToken),
        };

        vmProxyWss.handleUpgrade(req, socket, head, (ws) => {
          vmProxyWss.emit('connection', ws, req);
        });
      } catch {
        try { socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n'); } catch {}
        socket.destroy();
      }
    })();
  } else if (url === '/speech' || url.startsWith('/speech?')) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      handleSpeechConnection(ws, req);
    });
  } else if (url === '/voice' || url.startsWith('/voice?')) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      handleVoiceConnection(ws, req);
    });
  } else if (url === '/terminal' || url.startsWith('/terminal?')) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      handleTerminalConnection(ws, req);
    });
  } else {
    socket.destroy();
  }
});

vmProxyWss.on('connection', (clientWs: WebSocket, req: any) => {
  const vmUrl = String(req?.__vmProxy?.vmUrl || '').trim();
  if (!vmUrl) {
    try {
      clientWs.send(JSON.stringify({ type: 'error', message: 'vm_not_reachable' }));
      clientWs.close(1011, 'vm_not_reachable');
    } catch {}
    return;
  }

  const upstreamWs = new WebSocket(vmUrl, { maxPayload: WS_MAX_PAYLOAD });
  const pendingFrames: Array<{ data: Buffer; isBinary: boolean }> = [];
  let upstreamOpen = false;

  const flushPending = () => {
    if (!upstreamOpen) return;
    while (pendingFrames.length > 0) {
      const frame = pendingFrames.shift();
      if (!frame) continue;
      upstreamWs.send(frame.data, { binary: frame.isBinary });
    }
  };

  const closeClient = (code?: number, reason?: string) => {
    try {
      if (clientWs.readyState === WebSocket.OPEN || clientWs.readyState === WebSocket.CONNECTING) {
        clientWs.close(code, reason);
      }
    } catch {
      try { clientWs.terminate(); } catch {}
    }
  };

  const closeUpstream = () => {
    try {
      if (upstreamWs.readyState === WebSocket.OPEN || upstreamWs.readyState === WebSocket.CONNECTING) {
        upstreamWs.close();
      }
    } catch {
      try { upstreamWs.terminate(); } catch {}
    }
  };

  clientWs.on('message', (data, isBinary) => {
    const frame = Buffer.isBuffer(data)
      ? data
      : Array.isArray(data)
        ? Buffer.concat(data)
        : Buffer.from(data as ArrayBuffer);
    if (upstreamOpen && upstreamWs.readyState === WebSocket.OPEN) {
      upstreamWs.send(frame, { binary: isBinary });
      return;
    }
    if (upstreamWs.readyState === WebSocket.CONNECTING) {
      pendingFrames.push({ data: frame, isBinary });
      return;
    }
    closeClient(1011, 'vm_proxy_unavailable');
  });

  clientWs.on('close', () => {
    closeUpstream();
  });

  clientWs.on('error', () => {
    closeUpstream();
  });

  upstreamWs.on('open', () => {
    upstreamOpen = true;
    flushPending();
  });

  upstreamWs.on('message', (data, isBinary) => {
    try {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(data, { binary: isBinary });
      }
    } catch {
      closeUpstream();
      closeClient();
    }
  });

  upstreamWs.on('close', (code, reason) => {
    closeClient(code, reason.toString());
  });

  upstreamWs.on('error', (err: any) => {
    try {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ type: 'error', message: `vm_proxy_failed: ${String(err?.message || err)}` }));
      }
    } catch {}
    closeClient(1011, 'vm_proxy_failed');
    closeUpstream();
  });
});

server.listen(PORT, () => {
  // console.log(`[cloud-ai] HTTP listening on http://0.0.0.0:${PORT}`);
  // console.log(`[cloud-ai] WS endpoint at ws://<host>:${PORT}/ws`);
  // console.log(`[cloud-ai] Model routing: ${ENABLE_ROUTING ? 'enabled (Gemini)' : 'disabled (gpt-5-medium)'}`);

  // Optional: eager tool embedding sync on startup (disabled by default to avoid embedding costs)
  try {
    const eager = String(process.env.CLOUD_EAGER_TOOL_EMBEDDINGS_SYNC || '').trim().toLowerCase();
    if (eager === '1' || eager === 'true' || eager === 'yes') {
      console.log('[cloud-ai] Eager tool embeddings sync enabled');
      ensureToolEmbeddings()
        .then(() => console.log('[cloud-ai] Tool embeddings sync complete'))
        .catch((e) => console.warn('[cloud-ai] Tool embeddings sync failed', e));
    }
  } catch { }

  // Start VM health monitoring
  try {
    startVMHealthMonitor();
    console.log('[cloud-ai] VM health monitor started');
  } catch (e) {
    console.warn('[cloud-ai] VM health monitor failed to start:', e);
  }

  // Start compute billing cron (fallback — primary billing is on-demand in status endpoint)
  try {
    startBillingCron();
  } catch (e) {
    console.warn('[cloud-ai] Billing cron failed to start:', e);
  }

  // Start cloud reminder cron (polls for due reminders and sends SMS/WhatsApp)
  try {
    startReminderCron();
  } catch (e) {
    console.warn('[cloud-ai] Reminder cron failed to start:', e);
  }
});

// Increase HTTP keep-alive and headers timeouts to be friendly to long-lived WS
try {
  (server as any).keepAliveTimeout = Number(process.env.CLOUD_HTTP_KEEPALIVE_MS || 120000);
  (server as any).headersTimeout = Number(process.env.CLOUD_HTTP_HEADERS_TIMEOUT_MS || 120000);
} catch { }

// Store conversation history per connection per conversation.
// Keyed by WS -> Map<conversationKey, messages[]> so multiple tabs on the same
// persistent WebSocket don't bleed history into each other.
const conversations = new WeakMap<WebSocket, Map<string, Array<any>>>();

function getConversationHistory(ws: WebSocket, convKey: string): Array<any> {
  let convMap = conversations.get(ws);
  if (!convMap) { convMap = new Map(); conversations.set(ws, convMap); }
  let history = convMap.get(convKey);
  if (!history) { history = []; convMap.set(convKey, history); }
  return history;
}

// Anonymous resource/thread IDs per connection for memory when not authenticated
const anonResources = new WeakMap<WebSocket, string>();
const anonThreads = new WeakMap<WebSocket, string>();
// Store abort controllers per WebSocket per-request for stop/cancel functionality
// Key: WS -> Map<requestId, AbortController> so parallel requests each get their own controller
const wsAbortControllers = new WeakMap<WebSocket, Map<string, AbortController>>();

function getAbortMap(ws: WebSocket): Map<string, AbortController> {
  let m = wsAbortControllers.get(ws);
  if (!m) { m = new Map(); wsAbortControllers.set(ws, m); }
  return m;
}

function setAbortController(ws: WebSocket, requestId: string | undefined, controller: AbortController) {
  const key = requestId || '__default__';
  getAbortMap(ws).set(key, controller);
}

function deleteAbortController(ws: WebSocket, requestId: string | undefined) {
  const key = requestId || '__default__';
  const m = wsAbortControllers.get(ws);
  if (m) { m.delete(key); if (m.size === 0) wsAbortControllers.delete(ws); }
}

function abortAndCleanup(ws: WebSocket, requestId: string | undefined) {
  const key = requestId || '__default__';
  const m = wsAbortControllers.get(ws);
  if (!m) return false;
  const controller = m.get(key);
  if (controller) {
    controller.abort();
    m.delete(key);
    if (m.size === 0) wsAbortControllers.delete(ws);
    return true;
  }
  return false;
}

// Note: Server-side queuing removed - client handles per-tab queuing via requestId routing

wss.on('connection', (ws: WebSocket, req: any) => {
  let connectToken = '';
  try {
    const rawUrl = String(req?.url || '');
    const qIndex = rawUrl.indexOf('?');
    if (qIndex >= 0) {
      const search = rawUrl.slice(qIndex + 1);
      const parts = search.split('&');
      for (const part of parts) {
        const [k, v] = part.split('=');
        const key = decodeURIComponent(k || '');
        const val = decodeURIComponent(v || '');
        if (key === 'client') {
          (ws as any).__clientType = val;
        } else if (key === 'token') {
          connectToken = val;
        }
      }
    }
  } catch { }

  // If an auth token was provided in the URL, verify it and immediately
  // register this connection for webhook delivery (Gmail Pub/Sub, Drive, etc.)
  // so triggers work even before the user sends a chat message.
  if (connectToken) {
    (async () => {
      try {
        const authResult = await verifyAccessToken(connectToken);
        if (authResult?.success && authResult.userId) {
          (ws as any).__userId = authResult.userId;
          registerWebhookClient(authResult.userId, ws);
          // Also register as a desktop connection for VM relay
          try {
            const ct = (ws as any).__clientType || 'desktop';
            if (ct !== 'vm-agent') registerConnection(ws, authResult.userId, 'desktop');
          } catch { }
          // Deliver any queued webhooks that accumulated while offline
          const delivered = await deliverQueuedWebhooks(authResult.userId, ws);
          if (delivered > 0) {
            writeLog('connect_queued_webhooks_delivered', { userId: authResult.userId, count: delivered });
          }
          writeLog('ws_auth_on_connect', { userId: authResult.userId });
        }
      } catch (e) {
        writeLog('ws_auth_on_connect_failed', { error: String((e as any)?.message || e) });
      }
    })();
  }

  send(ws, { type: 'handshake', origin: 'cloud-ai', message: 'connected' });
  conversations.set(ws, new Map());
  writeLog('ws_connected');
  try { wsAlive.set(ws, true); } catch { }
  try { ws.on('pong', () => { try { wsAlive.set(ws, true); } catch { } }); } catch { }
  try {
    ws.on('close', () => {
      writeLog('ws_disconnected');
      // Clean up all abort controllers for this connection to prevent leaks
      try {
        const m = wsAbortControllers.get(ws);
        if (m) {
          for (const [, controller] of m) { try { controller.abort(); } catch { } }
          m.clear();
          wsAbortControllers.delete(ws);
        }
      } catch { }
      // Clear conversation history reference
      try { conversations.delete(ws); } catch { }
      try { anonResources.delete(ws); } catch { }
      try { anonThreads.delete(ws); } catch { }
    });
  } catch { }

  ws.on('message', async (buf: WebSocket.RawData) => {
    let msg: any;
    try {
      msg = JSON.parse(Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf));
    } catch {
      send(ws, { type: 'error', message: 'invalid json' });
      return;
    }

    const kind = String(msg?.type || '').toLowerCase();
    // Bridge passthrough: tool events/results coming from the client to resolve pending execLocalTool
    if (kind === 'tool_event' || kind === 'tool_result') {
      try { handleClientToolMessage(ws, msg); } catch { }
      // Also check if this is a result for a VM→desktop relay request
      if (kind === 'tool_result') {
        try {
          const connInfo = getConnectionInfo(ws);
          if (connInfo?.userId) handleDesktopRelayResult(connInfo.userId, msg);
        } catch { }
      }
      return;
    }
    // Handle explicit auth message: client sends {type:'auth', accessToken:'...'} to register
    // for webhook delivery (Gmail Pub/Sub, Drive triggers, etc.) without needing to send a chat.
    if (kind === 'auth') {
      const token = String(msg?.accessToken || '').trim();
      if (!token) {
        send(ws, { type: 'auth_result', ok: false, error: 'missing_token' });
        return;
      }
      try {
        const authResult = await verifyAccessToken(token);
        if (authResult?.success && authResult.userId) {
          (ws as any).__userId = authResult.userId;
          registerWebhookClient(authResult.userId, ws);
          try {
            const ct = (ws as any).__clientType || 'desktop';
            if (ct !== 'vm-agent') registerConnection(ws, authResult.userId, 'desktop');
          } catch { }
          const delivered = await deliverQueuedWebhooks(authResult.userId, ws);
          send(ws, { type: 'auth_result', ok: true, queued: delivered });
          writeLog('ws_auth_message', { userId: authResult.userId, delivered });
        } else {
          send(ws, { type: 'auth_result', ok: false, error: 'invalid_token' });
        }
      } catch (e) {
        send(ws, { type: 'auth_result', ok: false, error: String((e as any)?.message || 'auth_failed') });
      }
      return;
    }
    // Handle stop/abort request to cancel ongoing stream
    if (kind === 'stop' || kind === 'abort') {
      // Support per-request stop via requestId, or stop all if no requestId
      const stopRequestId = typeof msg?.requestId === 'string' ? msg.requestId : undefined;
      if (stopRequestId) {
        const aborted = abortAndCleanup(ws, stopRequestId);
        console.log(`[cloud-ai] Aborting stream for requestId=${stopRequestId}: ${aborted}`);
        send(ws, { type: 'stopped', success: aborted, requestId: stopRequestId });
      } else {
        // No requestId — abort ALL active streams on this WS (backwards compat)
        const m = wsAbortControllers.get(ws);
        if (m && m.size > 0) {
          console.log(`[cloud-ai] Aborting ALL ${m.size} stream(s) by user request`);
          for (const [, controller] of m) {
            try { controller.abort(); } catch { }
          }
          m.clear();
          wsAbortControllers.delete(ws);
          send(ws, { type: 'stopped', success: true });
        } else {
          send(ws, { type: 'stopped', success: false, message: 'no active stream' });
        }
      }
      return;
    }
    // Bridged tool execution: run a cloud tool WITH this WS as bridge context
    // so agent_node (and other agent tools) can relay tool_request messages back to the desktop
    if (kind === 'exec_tool_bridged') {
      (async () => {
        const reqId = String(msg?.id || `btool-${Date.now()}`);
        const toolName = String(msg?.tool || '').trim();
        const toolArgs = msg?.args || {};
        const accessToken = String(msg?.auth?.accessToken || '').trim();

        if (!toolName) {
          send(ws, { type: 'exec_tool_bridged_result', id: reqId, result: { ok: false, error: 'missing_tool_name' } });
          return;
        }

        // Lazy import to avoid circular dependencies
        const { getTool } = await import('./tools/tool-registry');
        const { initToolRegistry } = await import('./tools/meta-tools');
        // Ensure tools are registered
        try { initToolRegistry(); } catch { }

        const tool = getTool(toolName);
        if (!tool || typeof (tool as any).execute !== 'function') {
          send(ws, { type: 'exec_tool_bridged_result', id: reqId, result: { ok: false, error: `tool_not_found: ${toolName}` } });
          return;
        }

        writeLog(`bridged_tool_exec_start: ${toolName}`);
        try {
          const secrets: Record<string, any> = {};
          if (accessToken) {
            try {
              const authResult = await verifyAccessToken(accessToken);
              if (authResult?.success && authResult.userId) {
                secrets.userId = authResult.userId;
              }
            } catch { }
          }

          const result = await withClientBridge(ws, async () => {
            return await (tool as any).execute(toolArgs, {} as any);
          }, secrets);

          writeLog(`bridged_tool_exec_done: ${toolName}`);
          send(ws, { type: 'exec_tool_bridged_result', id: reqId, result });
        } catch (e: any) {
          writeLog(`bridged_tool_exec_error: ${toolName}: ${e?.message || e}`);
          send(ws, { type: 'exec_tool_bridged_result', id: reqId, result: { ok: false, error: e?.message || 'execution_failed' } });
        }
      })();
      return;
    }

    // Unknown types → error
    if (kind !== 'chat') {
      send(ws, { type: 'error', message: `unknown type: ${kind}` });
      return;
    }

    // Extract requestId for parallel routing (client uses this to route responses to correct tab)
    const requestId = typeof msg?.requestId === 'string' ? msg.requestId : undefined;

    // Extract ephemeral secrets from client-provided context early to pass to bridge
    let secrets: Record<string, any> | undefined;
    try {
      const incomingCtx: any = (msg as any)?.context || {};
      const oat = incomingCtx?.outlookAccessToken;
      if (typeof oat === 'string' && oat) {
        secrets = { outlookAccessToken: oat };
        try { delete incomingCtx.outlookAccessToken; } catch { }
        try { (msg as any).context = incomingCtx; } catch { }
      }
      // Capture deviceId (non-secret) to target a specific desktop instance for memory jobs
      try { (msg as any).__deviceId = typeof incomingCtx?.deviceId === 'string' ? incomingCtx.deviceId : undefined; } catch { }
    } catch { }

    const secretBag: any = { ...(secrets || {}) };

    // Store active skills in bridge secrets so get_skill_info can return full step details.
    let activeSkillsFromContext: IncomingSkill[] = [];
    try {
      const incomingCtx: any = (msg as any)?.context || {};
      activeSkillsFromContext = sanitizeIncomingSkills(incomingCtx?.skills);
      if (activeSkillsFromContext.length > 0) {
        secretBag.__skills = activeSkillsFromContext;
      }
    } catch { }

    // Run EVERYTHING in background (don't await) to allow parallel processing across tabs
    // This moves auth, routing, and agent setup into the non-blocking bridge context
    withClientBridge(ws, async () => {
      let abortController: AbortController | null = null;
      let hardTimeout: NodeJS.Timeout | null = null;
      let didSendFinal = false;
      let aggregatedText = '';
      let routedTier: ModelChoice = 'balanced';
      let chosenModelId: string | undefined;
      let conversationId: string | null = null;
      let modelLabel: string | undefined;
      let latestUsage: ReturnType<typeof normalizeUsage> | undefined;
      // Hoisted so the outer catch block can persist partial work on error
      let authUser: { userId: string; email?: string } | null = null;
      let requestedMode: TierChoice = 'balanced';
      const toolCallsMap = new Map<string, any>();
      type StreamChunk = { type: 'text'; content: string } | { type: 'reasoning'; content: string } | { type: 'tool'; tool: any };
      const streamChunks: StreamChunk[] = [];
      let aggregatedReasoning = '';
      let reasoningStartTime: number | null = null;
      const buildAssistantMetadata = (finishReasonOverride?: string) => {
        const filteredToolCalls = Array.from(toolCallsMap.values()).filter(tc => !isSISMetaTool(tc.tool));
        const reasoningDuration = reasoningStartTime && aggregatedReasoning
          ? Math.max(0, (Date.now() - reasoningStartTime) / 1000)
          : undefined;
        return {
          mode: requestedMode,
          tier: routedTier,
          modelId: modelLabel || chosenModelId,
          reasoning: aggregatedReasoning || undefined,
          reasoningDuration,
          toolCalls: filteredToolCalls.length > 0 ? filteredToolCalls : undefined,
          streamChunks: streamChunks.length > 0 ? streamChunks : undefined,
          finishReason: finishReasonOverride,
          usage: latestUsage,
        };
      };
      try {
        const messages = normalizeMessages(msg);
        const providedMessages = Array.isArray((msg as any)?.messages) ? (msg as any).messages : undefined;
        if (messages.length === 0) {
          send(ws, { type: 'error', message: 'empty prompt' }, requestId);
          return;
        }

        const accessToken = String(msg?.auth?.accessToken || '');
        const authResult = accessToken ? await verifyAccessToken(accessToken) : null;
        authUser = authResult?.success ? { userId: authResult.userId!, email: authResult.email } : null;

        // Update secretBag with userId and accessToken if authenticated
        if (authUser?.userId) secretBag.userId = authUser.userId;
        if (accessToken) secretBag.accessToken = accessToken;

        if (REQUIRE_AUTH && !authUser) {
          // Provide specific error codes for client-side handling
          const errorCode = authResult?.error || AuthErrorCode.UNAUTHORIZED;
          const errorMessage = authResult?.message || 'unauthorized';
          send(ws, {
            type: 'error',
            message: errorMessage,
            code: errorCode,
            data: { requiresReauth: errorCode === AuthErrorCode.EXPIRED_TOKEN }
          }, requestId);
          return;
        }

        if (authUser) {
          const access = await checkAccess(authUser.userId);
          if (!access.allowed) {
            send(ws, { type: 'error', message: access.reason || 'access_denied', data: { plan: access.plan, limit: access.limit, used: access.used } }, requestId);
            return;
          }
          // Count this chat request towards daily usage
          try { await incrementDailyRequestCounter(authUser.userId); } catch { }

          // Register for webhook delivery and deliver any queued webhooks
          try {
            registerWebhookClient(authUser.userId, ws);
            const delivered = await deliverQueuedWebhooks(authUser.userId, ws);
            if (delivered > 0) {
              writeLog('queued_webhooks_delivered', { userId: authUser.userId, count: delivered });
            }
          } catch { }

          // Register this WS as a desktop connection so VM agent relay works
          try {
            const ct = (ws as any).__clientType || 'desktop';
            if (ct !== 'vm-agent') registerConnection(ws, authUser.userId, 'desktop');
          } catch { }
        }

        requestedMode = normalizeTierChoice((msg as any)?.model);
        let routed: { model: ModelChoice; modelIndex: number; layerIndexes: number[] } = {
          model: 'balanced',
          modelIndex: 1,
          layerIndexes: [],
        };
        if (requestedMode === 'auto') {
          if (ENABLE_ROUTING) {
            const context = msg?.context || {};
            // Provide a text-only view of messages for the router
            const routerMsgs = messages.map((m: any) => ({ role: m.role, content: contentToText(m.content) }));
            routed = await routeModel({
              messages: routerMsgs,
              contextSize: JSON.stringify(context).length,
              hasAttachments: Array.isArray(msg?.attachments) && msg.attachments.length > 0,
              recentTools: context?.recent_tools || [],
            });
            routedTier = routed.model;
            send(ws, { type: 'progress', event: 'routing', data: { m: routed.modelIndex, l: routed.layerIndexes } }, requestId);
            writeLog('routing', { m: routed.modelIndex, l: routed.layerIndexes });
          } else {
            routedTier = 'balanced';
          }
        } else {
          routedTier = requestedMode;
        }

        chosenModelId =
          (typeof (msg as any)?.modelId === 'string' && String((msg as any).modelId).trim())
            ? String((msg as any).modelId).trim()
            : pickDefaultModelId((msg as any)?.modelConfig, routedTier);

        try {
          send(ws, { type: 'progress', event: 'model', data: { tier: routedTier, modelId: chosenModelId } }, requestId);
        } catch { }

        let enabledIntegrations: string[] = [];
        let mcpTools: Record<string, any> = {};

        if (authUser) {
          const _au = authUser; // local const for TS narrowing (authUser is `let`)
          // Check integrations
          const providers = ['github', 'google', 'outlook', 'facebook', 'instagram', 'threads', 'whatsapp'];
          try {
            const checks = await Promise.all(providers.map(p => getExternalAccount(_au.userId, p)));
            enabledIntegrations = providers.filter((_, i) => !!checks[i]);
          } catch (e) {
            // ignore
          }

          // Load MCP tools from connected integrations (Notion, Linear, Stripe)
          try {
            const { getConnectedMCPIntegrations, getMCPToolsForIntegrations } = await import('./mcp');
            const connected = await getConnectedMCPIntegrations(authUser.userId);
            if (connected.length > 0) {
              mcpTools = await getMCPToolsForIntegrations(authUser.userId, connected);
              console.log(`[cloud-ai] Loaded ${Object.keys(mcpTools).length} MCP tools from ${connected.length} integrations`);
            }
          } catch (e) {
            console.warn('[cloud-ai] Failed to load MCP tools:', e);
          }
        }

        // Merge desktop-reported integrations (browser_use, ollama, telnyx, etc.)
        // outside auth gate so local desktop tools work even when user isn't signed in.
        const clientIntegrations = Array.isArray((msg as any)?.clientIntegrations)
          ? (msg as any).clientIntegrations.filter((v: any) => typeof v === 'string')
          : [];
        for (const ci of clientIntegrations) {
          if (!enabledIntegrations.includes(ci)) enabledIntegrations.push(ci);
        }

        // Get conversation history keyed by conversationId (per-tab isolation).
        // Falls back to requestId or default key for anonymous/legacy clients.
        const clientConvId = typeof (msg as any)?.conversationId === 'string' ? String((msg as any).conversationId).trim() : '';
        const historyKey = clientConvId || requestId || '__default__';
        const history = getConversationHistory(ws, historyKey);

        // Hydrate from Supabase when reconnecting to an existing conversation on a
        // fresh WebSocket (e.g. each SMS turn opens a new WS). Without this, the AI
        // would lose all prior context because in-memory history is per-connection.
        let hydratedFromSupabase = false;
        if (history.length === 0 && clientConvId && authUser) {
          try {
            const stored = await getConversationMessages(authUser.userId, clientConvId, 50);
            if (stored.length > 0) {
              for (const m of stored) history.push(m);
              hydratedFromSupabase = true;
            }
          } catch { }
        }

        // Add new user messages to history for future turns on this persistent WS.
        // Skip when we just hydrated from Supabase — the current user message will be
        // appended separately to inputMessages to avoid duplication.
        if (!hydratedFromSupabase) {
          const newUserMsgs = messages.filter(m => m.role === 'user');
          for (const userMsg of newUserMsgs) {
            if (!history.find((h: any) => h.role === 'user' && h.content === userMsg.content)) {
              history.push(userMsg);
            }
          }
        }

        // Use the last user message as the prompt (text-only)
        const lastUserMsg = messages.filter((m) => m.role === 'user').slice(-1)[0];
        const prompt = contentToText(lastUserMsg?.content);

        if (!prompt) {
          send(ws, { type: 'error', message: 'no user message found' }, requestId);
          return;
        }

        // Send immediate acknowledgment to reduce perceived latency
        send(ws, { type: 'progress', event: 'ack', data: { ts: Date.now() } }, requestId);

        // Kick off embedding early (memoized promise - will be reused by knowledge/memory later)
        // This runs in parallel with agent selection and other setup
        const earlyEmbeddingPromise = process.env.SIS_PARALLEL_EMBEDDINGS === '1'
          ? getOrCreateQueryEmbedding(prompt).catch(() => null)
          : null;

        // Determine which agent/model to use
        const rawAgent = typeof (msg as any)?.agent === 'string' ? String((msg as any).agent) : '';
        const rawAgentLower = rawAgent.toLowerCase().trim();
        const clientType = typeof (ws as any)?.__clientType === 'string' ? String((ws as any).__clientType).toLowerCase().trim() : '';
        const ctxMode = typeof (msg as any)?.context?.mode === 'string' ? String((msg as any).context.mode).toLowerCase().trim() : '';
        const hiddenContextRaw = typeof (msg as any)?.hiddenContext === 'string' ? String((msg as any).hiddenContext) : '';

        const inferredWorkflow =
          clientType === 'workflow_ui' ||
          clientType === 'workflow' ||
          clientType === 'workflows' ||
          ctxMode === 'workflow_architect' ||
          ctxMode === 'workflow';

        const inferredSkill =
          clientType === 'skill_ui' ||
          ctxMode === 'skill_architect' ||
          ctxMode === 'skill';

        const agentType: 'workflow' | 'skill' | 'stuard' =
          rawAgentLower === 'workflow' ||
            rawAgentLower === 'workflow_agent' ||
            rawAgentLower === 'workflow-architect' ||
            rawAgentLower === 'workflow_architect'
            ? 'workflow'
            : rawAgentLower === 'skill' ||
              rawAgentLower === 'skill_agent' ||
              rawAgentLower === 'skill-architect' ||
              rawAgentLower === 'skill_architect'
              ? 'skill'
              : inferredWorkflow
                ? 'workflow'
                : inferredSkill
                  ? 'skill'
                  : 'stuard';

        const conversationSource: 'stuard' | 'workflow' | 'skill' | 'proactive' =
          hiddenContextRaw.includes('[PROACTIVE MODE]') || hiddenContextRaw.includes('[PROACTIVE FOLLOW-UP]')
            ? 'proactive'
            : agentType === 'workflow'
              ? 'workflow'
              : agentType === 'skill'
                ? 'skill'
                : 'stuard';

        const workflowModelId = agentType === 'workflow'
          ? (
            (typeof (msg as any)?.modelId === 'string' && String((msg as any).modelId).trim())
              ? String((msg as any).modelId).trim()
              : (process.env.WORKFLOW_MODEL_ID || 'google/gemini-3-pro-preview')
          )
          : undefined;

        const skillModelIdForLabel = agentType === 'skill'
          ? (
            (typeof (msg as any)?.modelId === 'string' && String((msg as any).modelId).trim())
              ? String((msg as any).modelId).trim()
              : (process.env.WORKFLOW_MODEL_ID || 'google/gemini-3-pro-preview')
          )
          : undefined;
        modelLabel = agentType === 'workflow'
          ? (workflowModelId || 'google/gemini-3-pro-preview')
          : agentType === 'skill'
            ? (skillModelIdForLabel || 'google/gemini-3-pro-preview')
            : (chosenModelId || routedTier);

        const incomingCtxForMeta: any = (msg as any)?.context || {};
        const contextPathsForMeta = Array.isArray(incomingCtxForMeta?.paths) ? incomingCtxForMeta.paths : undefined;

        // Select agent based on type
        let agent: any;
        if (agentType === 'workflow') {
          try {
            agent = getWorkflowAgent(workflowModelId);
            console.log('[cloud-ai] Using workflow agent', { rawAgent, clientType, ctxMode, modelId: workflowModelId });

            // Pre-store workflow in session for modify_workflow tool
            // Prefer explicit workflow from payload context (no parsing needed)
            clearSessionWorkflow();
            const incomingCtx = (msg as any)?.context || {};
            const directWorkflow = incomingCtx?.workflow;
            let sessionLoaded = false;
            if (directWorkflow && typeof directWorkflow === 'object' && !Array.isArray(directWorkflow)) {
              setSessionWorkflow(directWorkflow);
              sessionLoaded = true;
              console.log('[cloud-ai] Pre-stored workflow from context:', { id: directWorkflow.id, nodes: directWorkflow.nodes?.length, triggers: directWorkflow.triggers?.length });
            }

            // Log workspace path info if provided by client
            const workspacePath = incomingCtx?.workspacePath;
            if (workspacePath) {
              console.log('[cloud-ai] Workflow workspace path:', workspacePath);
            }

            // Fallback: Extract workflow JSON from system context message
            if (!sessionLoaded) {
              const workflowMsg = providedMessages?.find((m: any) =>
                m?.role === 'system' &&
                typeof m?.content === 'string' &&
                m.content.includes('CURRENT WORKFLOW')
              );
              if (workflowMsg && typeof workflowMsg.content === 'string') {
                const content = workflowMsg.content;
                // Find "CURRENT WORKFLOW" marker and extract the JSON that follows
                const marker = content.indexOf('CURRENT WORKFLOW');
                if (marker >= 0) {
                  // Find the first { after the marker
                  const jsonStart = content.indexOf('{', marker);
                  if (jsonStart >= 0) {
                    // Count brackets to find matching }, ignoring braces inside strings
                    let depth = 0;
                    let jsonEnd = -1;
                    let inString = false;
                    let escaped = false;
                    for (let i = jsonStart; i < content.length; i++) {
                      const ch = content[i];
                      if (escaped) {
                        escaped = false;
                        continue;
                      }
                      if (ch === '\\' && inString) {
                        escaped = true;
                        continue;
                      }
                      if (ch === '"') {
                        inString = !inString;
                        continue;
                      }
                      if (inString) continue;
                      if (ch === '{') depth++;
                      else if (ch === '}') {
                        depth--;
                        if (depth === 0) {
                          jsonEnd = i + 1;
                          break;
                        }
                      }
                    }
                    if (jsonEnd > jsonStart) {
                      const jsonStr = content.slice(jsonStart, jsonEnd);
                      try {
                        const workflowJson = JSON.parse(jsonStr);
                        if (workflowJson && (workflowJson.id || workflowJson.triggers || workflowJson.nodes)) {
                          setSessionWorkflow(workflowJson);
                          console.log('[cloud-ai] Pre-stored workflow in session:', { id: workflowJson.id, nodes: workflowJson.nodes?.length, triggers: workflowJson.triggers?.length });
                        }
                      } catch (parseErr) {
                        console.warn('[cloud-ai] Failed to parse workflow JSON:', parseErr);
                      }
                    }
                  }
                }
              }
            }
          } catch (e: any) {
            console.error('[cloud-ai] Failed to get workflow agent:', e.message);
            send(ws, { type: 'error', message: 'Workflow agent unavailable: ' + e.message }, requestId);
            return;
          }
        } else if (agentType === 'skill') {
          try {
            const skillModelId =
              (typeof (msg as any)?.modelId === 'string' && String((msg as any).modelId).trim())
                ? String((msg as any).modelId).trim()
                : (process.env.WORKFLOW_MODEL_ID || 'google/gemini-3-pro-preview');
            agent = getSkillAgent(skillModelId);
            console.log('[cloud-ai] Using skill agent', { rawAgent, clientType, ctxMode, modelId: skillModelId });

            // Pre-store skill in session for modify_skill tool
            clearSessionSkill();
            const incomingCtx = (msg as any)?.context || {};
            const directSkill = incomingCtx?.skill;
            let sessionLoaded = false;
            if (directSkill && typeof directSkill === 'object' && !Array.isArray(directSkill)) {
              setSessionSkill(directSkill);
              sessionLoaded = true;
              console.log('[cloud-ai] Pre-stored skill from context:', { id: directSkill.id, name: directSkill.name, steps: directSkill.steps?.length });
            }

            // Fallback: Extract skill JSON from system context message
            if (!sessionLoaded) {
              const skillMsg = providedMessages?.find((m: any) =>
                m?.role === 'system' &&
                typeof m?.content === 'string' &&
                m.content.includes('CURRENT SKILL')
              );
              if (skillMsg && typeof skillMsg.content === 'string') {
                const content = skillMsg.content;
                const marker = content.indexOf('CURRENT SKILL');
                if (marker >= 0) {
                  const jsonStart = content.indexOf('{', marker);
                  if (jsonStart >= 0) {
                    let depth = 0;
                    let jsonEnd = -1;
                    let inString = false;
                    let escaped = false;
                    for (let i = jsonStart; i < content.length; i++) {
                      const ch = content[i];
                      if (escaped) {
                        escaped = false;
                        continue;
                      }
                      if (ch === '\\' && inString) {
                        escaped = true;
                        continue;
                      }
                      if (ch === '"') {
                        inString = !inString;
                        continue;
                      }
                      if (inString) continue;
                      if (ch === '{') depth++;
                      else if (ch === '}') {
                        depth--;
                        if (depth === 0) {
                          jsonEnd = i + 1;
                          break;
                        }
                      }
                    }
                    if (jsonEnd > jsonStart) {
                      const jsonStr = content.slice(jsonStart, jsonEnd);
                      try {
                        const skillJson = JSON.parse(jsonStr);
                        if (skillJson && (skillJson.id || skillJson.name || skillJson.steps)) {
                          setSessionSkill(skillJson);
                          console.log('[cloud-ai] Pre-stored skill in session:', { id: skillJson.id, name: skillJson.name, steps: skillJson.steps?.length });
                        }
                      } catch (parseErr) {
                        console.warn('[cloud-ai] Failed to parse skill JSON:', parseErr);
                      }
                    }
                  }
                }
              }
            }
          } catch (e: any) {
            console.error('[cloud-ai] Failed to get skill agent:', e.message);
            send(ws, { type: 'error', message: 'Skill agent unavailable: ' + e.message }, requestId);
            return;
          }
        } else {
          // ─── Parallel embedding + tool ranking pipeline ───────────────
          // Always attempt embedding-based tool ranking. The embedding is
          // memoized and reused by knowledge/memory retrieval later, so
          // this is essentially free. Falls back to static Tier 1 if
          // embedding or Supabase is unavailable.
          let rankedToolNames: string[] | undefined;

          if (prompt) {
            try {
              const queryEmbedding = await getOrCreateQueryEmbedding(prompt);
              if (queryEmbedding && queryEmbedding.length > 0) {
                const topN = Number(process.env.SIS_RANKED_TOPN || '7');
                rankedToolNames = await getRankedToolNames(queryEmbedding, enabledIntegrations, topN);
                if (process.env.SIS_DEBUG === '1') {
                  console.log(`[tool-rank] Ranked ${rankedToolNames.length} tools: ${rankedToolNames.join(', ')}`);
                }
              }
            } catch (e: any) {
              // Graceful fallback — static Tier 1 tools still loaded
              if (process.env.SIS_DEBUG === '1') {
                console.warn('[tool-rank] Ranking failed, using static Tier 1:', e.message);
              }
            }
          }

          if (hasProactiveModeMarker((msg as any)?.hiddenContext)) {
            rankedToolNames = mergeForcedToolNames(rankedToolNames);
          }

          agent = await getAgentForQuery(routedTier, prompt, undefined, enabledIntegrations, mcpTools, chosenModelId, rankedToolNames);
        }

        let conversationCreatedNow = false;
        const resetRequested = !!(msg as any)?.resetConversation;
        if (resetRequested) {
          // Clear this conversation's history (not other tabs)
          try {
            const convMap = conversations.get(ws);
            if (convMap && historyKey) convMap.delete(historyKey);
          } catch { }
          try { anonThreads.delete(ws); } catch { }
          // Re-fetch a clean history array after reset
          history.length = 0;
        }
        if (authUser) {
          const requestedId = typeof (msg as any)?.conversationId === 'string' ? String((msg as any).conversationId).trim() : '';
          if (requestedId) {
            conversationId = requestedId;
          } else {
            conversationId = await createConversation(
              authUser.userId,
              prompt,
              modelLabel,
              { mode: requestedMode, tier: routedTier, modelId: chosenModelId, contextPaths: contextPathsForMeta },
              conversationSource
            ) as any;
            if (conversationId) {
              conversationCreatedNow = true;
              // Immediately notify client of new conversation ID so it can be used for subsequent messages
              send(ws, { type: 'conversation', conversationId }, requestId);
            }
          }
        }

        console.log('[cloud-ai] Starting stream with model:', modelLabel);
        writeLog('stream_start', { model: modelLabel, conversationId });
        // Configure memory context: resource = user id (or per-connection anon id), thread = conversation id (or per-connection thread)
        let resource = authUser?.userId || '';
        if (!resource) {
          resource = anonResources.get(ws) || '';
          if (!resource) {
            resource = 'anon-' + randomUUID();
            anonResources.set(ws, resource);
          }
        }

        let thread = '';
        // Prefer Supabase conversation thread when available
        if (conversationId) {
          thread = conversationId;
        } else {
          thread = anonThreads.get(ws) || '';
          if (!thread) {
            thread = 'ws-' + randomUUID();
            anonThreads.set(ws, thread);
          }
        }

        // Allow client to override memory context when they manage threads/resources (e.g., Python agent)
        const incomingMem: any = (msg as any)?.memory || {};
        if (incomingMem && typeof incomingMem.resource === 'string' && incomingMem.resource.trim()) {
          resource = incomingMem.resource.trim();
        }
        if (incomingMem && typeof incomingMem.thread === 'string' && incomingMem.thread.trim()) {
          thread = incomingMem.thread.trim();
        }

        if (conversationSource === 'stuard' && !conversationId && thread) {
          send(ws, { type: 'conversation', conversationId: thread }, requestId);
        }

        const budgetModelId = modelLabel || chosenModelId || routedTier;
        const budget = computeBudget(budgetModelId);
        const historySource = (providedMessages && providedMessages.length > 0)
          ? (providedMessages as any[])
          : (history as any[]);

        pruneToolOutputs(historySource, budget);

        if (!providedMessages || providedMessages.length === 0) {
          const preEstimate = estimateTokens(history as any[]);
          if (preEstimate.totalTokens > budget.historyBudget) {
            emergencyTruncate(history as any[], budget);
          }
        }

        const recentHistory = getRecentWithinBudget(historySource, budget) as any[];
        let inputMessages: any[] = (providedMessages && providedMessages.length > 0)
          ? [...recentHistory]
          : [...recentHistory, { role: 'user', content: prompt }];

        // When we hydrated from Supabase, the current user message was deferred to
        // avoid duplication in inputMessages. Now push it into history for future
        // turns on this same WS connection (important for persistent desktop WS).
        if (hydratedFromSupabase) {
          const newUserMsgs = messages.filter(m => m.role === 'user');
          for (const userMsg of newUserMsgs) {
            if (!history.find((h: any) => h.role === 'user' && h.content === userMsg.content)) {
              history.push(userMsg);
            }
          }
        }

        // If attachments or images are present, attach them to the last user message as multimodal parts
        const attachments = Array.isArray((msg as any)?.attachments) ? (msg as any).attachments : [];
        // Also handle images array from workflow chat (convert to attachment format)
        const images = Array.isArray((msg as any)?.images) ? (msg as any).images : [];
        const imageAttachments = images.map((img: any) => ({
          type: 'image',
          name: img?.name,
          mimeType: img?.mimeType || 'image/png',
          data: img?.data, // base64
        }));
        const allAttachments = [...attachments, ...imageAttachments];

        if (allAttachments.length > 0) {
          // Check if the chosen model supports multimodal input
          const isMultimodal = chosenModelId ? await modelSupportsMultimodal(chosenModelId) : true;

          if (isMultimodal) {
            // Model supports multimodal — attach directly as content parts
            const attachmentParts = buildAttachmentParts(allAttachments);
            if (attachmentParts.length > 0) {
              let idx = -1;
              for (let i = inputMessages.length - 1; i >= 0; i--) {
                const r = inputMessages[i]?.role;
                if (r === 'user') { idx = i; break; }
              }
              if (idx >= 0) {
                const c = inputMessages[idx]?.content;
                const baseParts = Array.isArray(c) ? c : [{ type: 'text', text: typeof c === 'string' ? c : '' }];
                inputMessages[idx] = { ...inputMessages[idx], content: [...baseParts, ...attachmentParts] };
              } else {
                inputMessages.push({ role: 'user', content: [{ type: 'text', text: prompt || 'Attached files' }, ...attachmentParts] });
              }
            }
          } else {
            // Model does NOT support multimodal — pre-analyze with Gemini and inject as text
            try {
              send(ws, { type: 'progress', event: 'status', data: { text: 'Analyzing attached media...' } }, requestId);

              const mediaParts: any[] = [{ type: 'text', text: `Analyze the following ${allAttachments.length} file(s) in detail. For images describe what you see. For PDFs/documents extract key content. For audio/video describe the content. Provide a thorough analysis.` }];
              for (const a of allAttachments) {
                const dataStr = typeof a?.data === 'string' ? a.data : '';
                const mimeType = typeof a?.mimeType === 'string' ? a.mimeType : 'application/octet-stream';
                if (!dataStr) continue;
                const { buffer, mediaTypeHint } = dataStringToBuffer(dataStr);
                const mt = mimeType || mediaTypeHint || 'application/octet-stream';
                if (buffer && buffer.length > 0) {
                  mediaParts.push({ type: 'file', data: buffer, mediaType: mt });
                }
              }

              const analysisResult = await generateText({
                model: google('gemini-2.5-flash') as any,
                messages: [{ role: 'user' as const, content: mediaParts }],
                temperature: 0.2,
              });

              const analysisText = analysisResult.text?.trim() || 'Unable to analyze the attached media.';
              const fileNames = allAttachments.map((a: any) => a?.name || 'file').join(', ');
              const injectedText = `\n\n[Attached files analyzed: ${fileNames}]\n\n${analysisText}`;

              // Inject the analysis text into the last user message
              let idx = -1;
              for (let i = inputMessages.length - 1; i >= 0; i--) {
                if (inputMessages[i]?.role === 'user') { idx = i; break; }
              }
              if (idx >= 0) {
                const c = inputMessages[idx]?.content;
                const existingText = typeof c === 'string' ? c : (Array.isArray(c) ? c.filter((p: any) => p?.type === 'text').map((p: any) => p.text).join('\n') : '');
                inputMessages[idx] = { ...inputMessages[idx], content: existingText + injectedText };
              } else {
                inputMessages.push({ role: 'user', content: (prompt || 'Attached files') + injectedText });
              }
            } catch (analyzeErr) {
              console.error('[cloud-ai] Failed to pre-analyze attachments for non-multimodal model:', analyzeErr);
              // Fallback: still try sending as multimodal parts (might fail, but better than losing data)
              const attachmentParts = buildAttachmentParts(allAttachments);
              if (attachmentParts.length > 0) {
                let idx = -1;
                for (let i = inputMessages.length - 1; i >= 0; i--) {
                  if (inputMessages[i]?.role === 'user') { idx = i; break; }
                }
                if (idx >= 0) {
                  const c = inputMessages[idx]?.content;
                  const baseParts = Array.isArray(c) ? c : [{ type: 'text', text: typeof c === 'string' ? c : '' }];
                  inputMessages[idx] = { ...inputMessages[idx], content: [...baseParts, ...attachmentParts] };
                } else {
                  inputMessages.push({ role: 'user', content: [{ type: 'text', text: prompt || 'Attached files' }, ...attachmentParts] });
                }
              }
            }
          }
        }
        // Track whether the model produced any text deltas or invoked tools
        let sawAnyTextDelta = false;
        let sawToolCall = false;
        aggregatedText = '';
        // toolCallsMap and streamChunks are hoisted above the try block

        // Persist this user turn for ongoing conversations (first turn already stored on creation)
        if (authUser && conversationId && !conversationCreatedNow) {
          try {
            await addUserMessage(authUser.userId, conversationId, prompt, {
              mode: requestedMode,
              tier: routedTier,
              modelId: chosenModelId,
              contextPaths: contextPathsForMeta,
            });
          } catch { }
        }

        // Determine maxSteps for this run (per-message override -> env/default), with a safety cap
        // Workflow agent needs more steps for tool discovery and testing
        const reqMaxStepsRaw = (msg as any)?.maxSteps ?? (msg as any)?.limits?.maxSteps;
        let maxSteps = (agentType === 'workflow' || agentType === 'skill') ? 60 : DEFAULT_MAX_STEPS;
        try {
          const n = Number(reqMaxStepsRaw);
          if (!isNaN(n) && n > 0) maxSteps = Math.min(n, MAX_STEPS_CAP);
        } catch { }

        // ─── Build ONE compact system context message ────────────────────
        // Consolidate time, paths, integrations, persona/tone into a single
        // system message to reduce per-message framing overhead.
        try {
          const contextParts: string[] = [];

          // Time
          contextParts.push(`Time: ${new Date().toISOString()}`);

          // Integrations
          if (enabledIntegrations.length > 0) {
            contextParts.push(`Integrations: ${enabledIntegrations.join(', ')}`);
          }

          // Context paths (@-mentions)
          const incomingCtx: any = (msg as any)?.context || {};
          const paths: Array<{ path: string; name: string; isDirectory: boolean }> = Array.isArray(incomingCtx?.paths) ? incomingCtx.paths : [];
          if (paths.length > 0) {
            const pathLines = paths.map(p => `${p.isDirectory ? '📁' : '📄'} ${p.name}: ${p.path}`).join(', ');
            contextParts.push(`Referenced: ${pathLines}`);
          }

          // Persona / tone
          const personaRaw = typeof incomingCtx?.persona === 'string' ? incomingCtx.persona.trim() : '';
          const presetRaw = typeof incomingCtx?.tonePreset === 'string' ? incomingCtx.tonePreset : '';
          const rawTone = typeof incomingCtx?.tone === 'string' ? incomingCtx.tone.trim() : '';
          if (personaRaw) contextParts.push(`Persona: ${personaRaw}`);
          const preset = (presetRaw || '').toLowerCase();
          if (preset === 'custom' && rawTone) {
            contextParts.push(`Tone: ${rawTone}`);
          } else if (preset && preset !== 'default') {
            contextParts.push(`Tone: ${preset}`);
          } else if (rawTone) {
            contextParts.push(`Tone: ${rawTone}`);
          }

          if (contextParts.length > 0) {
            inputMessages = [{ role: 'system', content: contextParts.join(' | ') }, ...inputMessages];
          }

          // Inject active skills into system prompt
          if (activeSkillsFromContext.length > 0) {
            const skillLines = activeSkillsFromContext.map((s) => {
              const tools = s.steps
                .map((step) => String(step.toolName || '').trim())
                .filter(Boolean);
              const uniqueTools = Array.from(new Set(tools)).slice(0, 5);
              const toolsSuffix = uniqueTools.length > 0 ? ` | tools: ${uniqueTools.join(', ')}` : '';
              return `• ${s.name} — ${s.description} (trigger: ${s.trigger}) | steps: ${s.steps.length}${toolsSuffix}`;
            }).join('\n');
            const skillsBlock = `[ACTIVE SKILLS]
The user has configured these reusable skills.
Treat each skill as guidance (a playbook), not a strict script.
When a request matches a skill, do this:
1) Call get_skill_info with skill_name (or skill_id) to load the full skill.
2) Use the returned steps as recommended order and tool-calling guidance.
3) Adapt step order/tool usage when context requires it, while staying aligned with the skill intent.
4) Keep the user informed as you progress.
${skillLines}`;
            inputMessages = [{ role: 'system', content: skillsBlock }, ...inputMessages];
          }
        } catch { }

        // Inject hidden state context (terminals, subagents, recent tool results) - NOT rendered in UI
        try {
          const hiddenContext: string | undefined = (msg as any)?.hiddenContext;
          if (hiddenContext && typeof hiddenContext === 'string' && hiddenContext.trim()) {
            inputMessages = [{ role: 'system', content: hiddenContext }, ...inputMessages];
          }
        } catch { }

        // Retrieve knowledge context and similar conversations, inject into messages
        if (agentType !== 'workflow' && agentType !== 'skill') {
          // ─── Parallel knowledge + memory retrieval ───────────────────
          // When SIS_PARALLEL_EMBEDDINGS=1, reuse the shared embedding
          // so knowledge and memory search run in parallel without
          // duplicate OpenAI embedding calls.
          const useParallelEmbeddings = process.env.SIS_PARALLEL_EMBEDDINGS === '1';

          // Token budget for knowledge context (chars, not tokens — ~4 chars/token)
          const KNOWLEDGE_MAX_CHARS = 2000;

          if (useParallelEmbeddings && prompt) {
            try {
              const queryEmbedding = await getOrCreateQueryEmbedding(prompt);

              const [knowledgeCtx, segmentMatches, fileMatches] = await Promise.all([
                buildKnowledgeContext(prompt, {
                  includeIdentity: true,
                  includeDirectives: true,
                  includeBio: false,
                  maxGlobalFacts: 4,
                  detectEntities: true,
                  queryEmbedding,
                }).catch(() => null),
                memoryService.searchSegmentsByEmbedding(queryEmbedding, { limit: 3, threshold: 0.6 })
                  .catch(() => [] as Awaited<ReturnType<typeof memoryService.searchSegmentsByEmbedding>>),
                searchFiles(prompt, { mode: 'semantic', limit: 5 })
                  .catch(() => null),
              ]);

              // Build ONE merged context block
              const ctxParts: string[] = [];
              if (knowledgeCtx && knowledgeCtx.text.trim()) {
                ctxParts.push(knowledgeCtx.text.trim().slice(0, KNOWLEDGE_MAX_CHARS));
              }
              if (segmentMatches.length > 0) {
                const similar = segmentMatches.filter(({ score }) => score >= 0.6).slice(0, 3);
                if (similar.length > 0) {
                  const lines = ['[PAST CONTEXT]'];
                  for (const { segment } of similar) {
                    const summary = String(segment.summary || '').trim().slice(0, 100);
                    if (summary) lines.push(`- ${summary}`);
                  }
                  if (lines.length > 1) ctxParts.push(lines.join('\n'));
                }
              }
              // Inject relevant file results from semantic search
              if (fileMatches?.ok && Array.isArray(fileMatches.results) && fileMatches.results.length > 0) {
                const topFiles = fileMatches.results.slice(0, 5);
                const lines = ['[RELEVANT FILES]'];
                for (const f of topFiles) {
                  const name = f.filename || f.path || '';
                  const score = typeof f.score === 'number' ? ` (${(f.score * 100).toFixed(0)}%)` : '';
                  const summary = f.summary ? ` — ${String(f.summary).slice(0, 80)}` : '';
                  lines.push(`- ${name}${score}${summary}`);
                }
                if (lines.length > 1) ctxParts.push(lines.join('\n'));
              }
              if (ctxParts.length > 0) {
                inputMessages = [{ role: 'system', content: ctxParts.join('\n\n') }, ...inputMessages];
              }
            } catch (parallelErr) {
              console.error('[cloud-ai] Parallel knowledge/memory pipeline failed:', parallelErr);
            }
          } else {
            // ─── Legacy sequential path ──
            const ctxParts: string[] = [];
            try {
              const knowledgeCtx = await buildKnowledgeContext(prompt, {
                includeIdentity: true,
                includeDirectives: true,
                includeBio: false,
                maxGlobalFacts: 4,
                detectEntities: true,
              });
              if (knowledgeCtx.text.trim()) {
                ctxParts.push(knowledgeCtx.text.trim().slice(0, KNOWLEDGE_MAX_CHARS));
              }
            } catch { }

            try {
              const query = String(prompt || '').trim();
              if (query) {
                const matches = await memoryService.searchSegments(query, { limit: 3, threshold: 0.6 });
                const similar = matches.filter(({ score }) => score >= 0.6).slice(0, 3);
                if (similar.length > 0) {
                  const lines = ['[PAST CONTEXT]'];
                  for (const { segment } of similar) {
                    const summary = String(segment.summary || '').trim().slice(0, 100);
                    if (summary) lines.push(`- ${summary}`);
                  }
                  if (lines.length > 1) ctxParts.push(lines.join('\n'));
                }
              }
            } catch { }

            if (ctxParts.length > 0) {
              inputMessages = [{ role: 'system', content: ctxParts.join('\n\n') }, ...inputMessages];
            }
          }
        }



        // Log system prompt size for debugging (compact log, no full dump)
        const systemMessages = inputMessages.filter((m: any) => m.role === 'system');
        if (systemMessages.length > 0) {
          const totalChars = systemMessages.reduce((sum: number, m: any) => sum + String(m.content || '').length, 0);
          console.log(`[cloud-ai] System context: ${systemMessages.length} msgs, ~${totalChars} chars, ~${Math.round(totalChars / 4)} tokens est.`);
        }

        // Provider options
        const providerOptions: any = {};
        const reasoningLevel: string = (['none', 'low', 'medium', 'high'].includes(String((msg as any)?.reasoningLevel || '')))
          ? String((msg as any).reasoningLevel)
          : 'high';

        // ---------- Google Gemini thinking ----------
        // Enable thinking for Google Gemini models that support it (2.5+, 3+).
        // Gemini 3 models require thought parts to be preserved and passed back with function responses.
        const resolvedGoogleModelId =
          typeof workflowModelId === 'string' && workflowModelId.startsWith('google/')
            ? workflowModelId
            : (chosenModelId?.startsWith('google/') ? chosenModelId : (modelLabel?.startsWith('google/') ? modelLabel : ''));
        const isGemini3 = resolvedGoogleModelId.includes('google/gemini-3');
        const isGemini25 = resolvedGoogleModelId.includes('google/gemini-2.5');
        const isGeminiThinking =
          isGemini3 ||
          isGemini25 ||
          (agentType === 'workflow' && typeof workflowModelId === 'string' && (workflowModelId.includes('google/gemini-3') || workflowModelId.includes('google/gemini-2.5'))) ||
          chosenModelId?.includes('google/gemini-3') ||
          chosenModelId?.includes('google/gemini-2.5') ||
          modelLabel?.includes('google/gemini-3') ||
          modelLabel?.includes('gemini-3') ||
          modelLabel?.includes('google/gemini-2.5') ||
          modelLabel?.includes('gemini-2.5');

        if (isGeminiThinking) {
          if (isGemini25) {
            const gemini25Budget: Record<'none' | 'low' | 'medium' | 'high', number> = {
              none: 0,
              low: 1024,
              medium: 8192,
              high: 24576,
            };
            providerOptions.google = {
              thinkingConfig: {
                includeThoughts: reasoningLevel !== 'none',
                thinkingBudget: gemini25Budget[reasoningLevel as 'none' | 'low' | 'medium' | 'high'],
              },
            };
          } else if (isGemini3 && reasoningLevel !== 'none') {
            providerOptions.google = {
              thinkingConfig: {
                includeThoughts: true,
                thinkingLevel: reasoningLevel as 'low' | 'medium' | 'high',
              },
            };
          }
        }

        // ---------- Anthropic thinking ----------
        if (
          chosenModelId?.includes('anthropic/') ||
          modelLabel?.includes('anthropic/')
        ) {
          if (reasoningLevel === 'none') {
            providerOptions.anthropic = {
              ...(providerOptions.anthropic || {}),
              thinking: { type: 'disabled' },
            };
          } else {
            const anthropicBudget: Record<string, number | undefined> = {
              low: 5000,
              medium: 16384,
              high: undefined, // no cap — model default (max)
            };
            const budgetTokens = anthropicBudget[reasoningLevel];
            providerOptions.anthropic = {
              ...(providerOptions.anthropic || {}),
              sendReasoning: true,
              thinking: budgetTokens
                ? { type: 'enabled', budgetTokens }
                : { type: 'enabled' },
            };
          }
        }

        // ---------- OpenAI reasoning effort ----------
        if (
          chosenModelId?.includes('openai/') ||
          modelLabel?.includes('openai/')
        ) {
          const modelPart = (chosenModelId || modelLabel || '').split('/').pop() || '';
          const supportsEffort = /^(o[1-9]|gpt-5(?:$|[-.]))/.test(modelPart);
          if (supportsEffort) {
            providerOptions.openai = {
              ...(providerOptions.openai || {}),
              reasoningEffort: reasoningLevel as 'none' | 'low' | 'medium' | 'high',
            };
          }
        }

        // Create AbortController for this stream so it can be cancelled
        abortController = new AbortController();
        setAbortController(ws, requestId, abortController);
        const hardTimeoutMs = (() => {
          const raw = Number(process.env.CLOUD_CHAT_HARD_TIMEOUT_MS || process.env.CLOUD_STREAM_HARD_TIMEOUT_MS || '');
          if (!isNaN(raw) && raw > 0) return raw;
          return agentType === 'workflow' ? 12 * 60 * 1000 : 8 * 60 * 1000;
        })();
        hardTimeout = setTimeout(() => {
          if (didSendFinal) return;
          didSendFinal = true;
          try { abortController?.abort(); } catch { }
          try { deleteAbortController(ws, requestId); } catch { }
          const timeoutText = (aggregatedText || '').trim() || 'Request timed out. Please retry.';
          send(
            ws,
            {
              type: 'final',
              origin: 'cloud-ai',
              model: chosenModelId || routedTier,
              conversationId,
              result: { text: timeoutText, steps: [], finishReason: 'timeout' },
              timedOut: true,
            },
            requestId
          );
        }, hardTimeoutMs);

        // fast/balanced use Grok models that don't support reasoningEffort
        const streamOptions: any = {
          maxSteps,
          providerOptions,
          abortSignal: abortController.signal,
          onStepFinish: ({ usage: stepUsage }: any) => {
            if (!stepUsage) return;
            const normalized = normalizeUsage(stepUsage);
            cumulativeInputTokens += normalized.promptTokens;
            try {
              send(ws, {
                type: 'progress',
                event: 'usage_update',
                data: {
                  promptTokens: cumulativeInputTokens,
                  completionTokens: normalized.completionTokens || 0,
                  totalTokens: cumulativeInputTokens + (normalized.completionTokens || 0),
                  contextWindow: budget.contextWindow,
                  modelId: chosenModelId || routedTier,
                },
              }, requestId);
            } catch { }
          },
          onFinish: async ({ text, steps, finishReason, usage, response }: any) => {
            // Re-establish bridge context — the AI SDK invokes onFinish
            // from a different async context, so the AsyncLocalStorage
            // store set by withClientBridge is no longer available.
            return withClientBridge(ws, async () => {
            if (didSendFinal) {
              try { if (hardTimeout) clearTimeout(hardTimeout); } catch { }
              return;
            }
            didSendFinal = true;
            try { if (hardTimeout) clearTimeout(hardTimeout); } catch { }
            const normalizedUsage = normalizeUsage(usage);
            latestUsage = normalizedUsage;
            try {
              console.log('[cloud-ai] onFinish reason:', finishReason, 'usage:', normalizedUsage);
            } catch { }
            let finalText = String(text || '').trim();
            if (!finalText && aggregatedText) {
              finalText = aggregatedText.trim();
            }
            writeLog('stream_finish', { finishReason, usage: normalizedUsage, textLength: finalText.length, sawToolCall, sawAnyTextDelta });

            // Persist the provider-generated response messages when available.
            // This preserves structured assistant content such as reasoning parts
            // and provider-specific tool-call continuity data across turns.
            const responseMessages = Array.isArray(response?.messages)
              ? response.messages
                .map((msg: any) => normalizeResponseHistoryMessage(msg))
                .filter((msg: { role: 'assistant' | 'tool'; content: any } | null): msg is { role: 'assistant' | 'tool'; content: any } => !!msg)
              : [];

            if (responseMessages.length > 0) {
              history.push(...responseMessages);
            } else {
              // Fallback: persist tool activity plus the reasoning/text we observed
              // from the stream so later turns can still see prior internal work.
              const completedToolCalls = Array.from(toolCallsMap.values()).filter(tc => tc.status === 'completed');
              if (completedToolCalls.length > 0) {
                const toolCallParts = completedToolCalls.map(tc => ({
                  type: 'tool-call' as const,
                  toolCallId: tc.id,
                  toolName: tc.tool,
                  args: tc.args || {},
                }));
                history.push({ role: 'assistant', content: toolCallParts });

                for (const tc of completedToolCalls) {
                  let resultStr = typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result ?? '');
                  resultStr = String(truncateHistoryToolResult(resultStr));
                  history.push({
                    role: 'tool',
                    content: [{ type: 'tool-result', toolCallId: tc.id, toolName: tc.tool, result: resultStr }],
                  });
                }
              }

              const assistantParts: any[] = [];
              if (aggregatedReasoning) {
                assistantParts.push({ type: 'reasoning', text: aggregatedReasoning });
              }
              if (finalText) {
                assistantParts.push({ type: 'text', text: finalText });
              }

              if (assistantParts.length === 1 && assistantParts[0]?.type === 'text') {
                history.push({ role: 'assistant', content: finalText });
              } else if (assistantParts.length > 0) {
                history.push({ role: 'assistant', content: assistantParts });
              }
            }

            // Layer 0 always runs after each turn, even when full summarization is unnecessary.
            const compactionModelId = modelLabel || chosenModelId || routedTier;
            const compactionBudget = computeBudget(compactionModelId);
            pruneToolOutputs(history as any[], compactionBudget);

            if (estimateTokens(history as any[]).totalTokens > compactionBudget.historyBudget) {
              emergencyTruncate(history as any[], compactionBudget);
            }

            const compactionCheck = shouldCompact(history as any[], compactionModelId);
            if (compactionCheck.shouldCompact) {
              compactHistory(history, compactionModelId).then(() => {
                // history array is mutated in-place, already stored in the per-conversation Map
                console.log(`[compactor] Compacted: ${estimateTokens(history as any[]).totalTokens} tokens remaining`);
              }).catch((err) => {
                console.warn('[cloud-ai] Compaction failed, emergency truncating:', err);
                emergencyTruncate(history as any[], compactionCheck.budget);
              });
            }
            if (authUser && conversationId) {
              // Build metadata for persistence
              const metadata = buildAssistantMetadata(finishReason);
              try { await addAssistantMessage(authUser.userId, conversationId, finalText, metadata); } catch { }
            }

            const stepsSafe = typeof steps !== 'undefined' ? sanitizeSteps(steps) : steps;
            send(ws, { type: 'final', origin: 'cloud-ai', model: chosenModelId || routedTier, conversationId, result: { text: finalText, steps: stepsSafe, finishReason, usage: normalizedUsage } }, requestId);
            const titleConversationId = conversationId || (conversationSource === 'stuard' ? thread : '');
            const shouldGenerateTitle = !!(titleConversationId && (conversationCreatedNow || (conversationSource === 'stuard' && resetRequested)));
            if (shouldGenerateTitle) {
              // Only generate title for newly-started conversations/threads
              try {
                const titlePrompt = `You will create a short, descriptive chat thread title from the user's question and the assistant's answer. At most 6 words. No quotes or punctuation.
User: ${prompt}\nAssistant: ${finalText}\n\nTitle:`;
                const titleModelId = getDefaultModelForCategory('fast');
                const titleModel = buildProviderModel(titleModelId);
                const tRes = await generateText({ model: titleModel as any, prompt: titlePrompt, temperature: 0.2 });
                let title = String((tRes as any)?.text || '').trim();
                title = title.replace(/^"+|"+$/g, '').replace(/[\.\!?]+$/g, '').slice(0, 80);
                if (authUser && conversationId) {
                  await setConversationTitle(authUser.userId, conversationId, title);
                }
                if (conversationSource === 'stuard') {
                  try {
                    await memoryService.ensureLocalConversation(titleConversationId, modelLabel, conversationSource);
                    await memoryService.updateConversation(titleConversationId, { title });
                  } catch { }
                }
                // Send title update to client
                send(ws, { type: 'title', conversationId: titleConversationId, title }, requestId);
              } catch { }
            }
            if (authUser) { try { await logUsageEvent(authUser.userId, conversationId, chosenModelId || routedTier, normalizedUsage); } catch { } try { if (conversationId) await finishRun(authUser.userId, conversationId, finalText || ''); } catch { } }

            // Knowledge Graph Ingestion - extract and store knowledge from conversation
            try {
              const { ingestConversationTurn } = await import('./knowledge');
              // Run ingestion in background (don't block response)
              // Pass the full conversation thread so the model has context for updates
              const fullHistory = [...history]; // includes all prior messages + the new assistant response
              console.log('[cloud-ai] Starting knowledge ingestion, history length:', fullHistory.length);
              ingestConversationTurn(fullHistory).then(({ extracted, executed }) => {
                console.log('[cloud-ai] Knowledge ingestion complete:', {
                  actionsExtracted: extracted.actions.length,
                  actionsSucceeded: executed.success,
                  actionsFailed: executed.failed,
                  actions: extracted.actions.map((a: any) => a.action),
                });
                if (extracted.actions.length > 0) {
                  writeLog('knowledge_ingested', {
                    actionsExtracted: extracted.actions.length,
                    actionsSucceeded: executed.success,
                    actionsFailed: executed.failed,
                  });
                }
              }).catch((err) => {
                console.error('[cloud-ai] Knowledge ingestion failed:', err);
              });
            } catch (ingestionErr) {
              console.error('[cloud-ai] Knowledge ingestion import failed:', ingestionErr);
            }

            // Local Memory Storage - store conversation locally with encryption
            try {
              if (conversationSource === 'stuard' || conversationSource === 'proactive') {
                const localConvId = conversationId || thread;

                // Store the user message locally
                if (prompt) {
                  await memoryService.storeMessageLocally(localConvId, 'user', prompt, {
                    metadata: {
                      mode: requestedMode,
                      tier: routedTier,
                      modelId: chosenModelId,
                      contextPaths: contextPathsForMeta,
                    },
                    model: modelLabel,
                    source: conversationSource,
                  });
                }

                // Store the assistant response locally
                if (finalText) {
                  await memoryService.storeMessageLocally(localConvId, 'assistant', finalText, {
                    metadata: buildAssistantMetadata(finishReason),
                    model: modelLabel,
                    source: conversationSource,
                  });
                }

                // Process conversation turn (segmentation, embeddings, etc.)
                const fullHistory = [...history];
                memoryService.processConversationTurn(localConvId, fullHistory).catch((err) => {
                  console.error('[cloud-ai] Local memory processing failed:', err);
                });
              }
            } catch (memoryErr) {
              console.error('[cloud-ai] Local memory storage import failed:', memoryErr);
            }

            }); // end withClientBridge re-wrap for onFinish
          },
        };

        if (agentType !== 'workflow' && agentType !== 'skill') {
          streamOptions.memory = { resource, thread };
        }

        // Send initial token estimate so the UI can show context usage from the start
        try {
          const initialEstimate = estimateTokens(inputMessages as any[]);
          send(ws, {
            type: 'progress',
            event: 'usage_update',
            data: {
              promptTokens: initialEstimate.totalTokens,
              completionTokens: 0,
              totalTokens: initialEstimate.totalTokens,
              contextWindow: budget.contextWindow,
              modelId: chosenModelId || routedTier,
            },
          }, requestId);
        } catch { }

        let cumulativeInputTokens = 0;

        const stream: any = await agent.stream(inputMessages, streamOptions);

        const hasFull = !!(stream as any)?.fullStream;
        const fullStream = (stream as any)?.fullStream || stream;
        try { console.log('[cloud-ai] Stream obtained. hasFullStream:', hasFull, 'type:', typeof fullStream); } catch { }

        let streamIterationError: any = null;
        try {
          for await (const chunk of fullStream as any) {
            // Check if aborted - break loop immediately
            if (abortController.signal.aborted) {
              console.log('[cloud-ai] Stream loop detected abort, breaking');
              break;
            }
            try {
              const chunkKeys = Object.keys(chunk || {});
              const evType = (chunk as any)?.type;
              if (process.env.CLOUD_DEBUG_STREAM === '1' && chunkKeys.length > 0 && !(chunk as any).textDelta) {
                console.log('[cloud-ai] Stream chunk keys:', chunkKeys, chunk);
              }
              let handledChunk = false;
              let sentToolEventTopLevel = false;

              // Handle Mastra chunk types explicitly
              if (evType) {
                switch (evType) {
                  case 'start':
                    send(ws, { type: 'progress', event: 'start', data: {} }, requestId);
                    handledChunk = true;
                    break;

                  // Text streaming (actual response content)
                  case 'text-delta': {
                    const text = (chunk as any)?.payload?.text || (chunk as any)?.text || '';
                    if (text) {
                      sawAnyTextDelta = true;
                      aggregatedText += text;
                      // Track in streamChunks - append to last text chunk or create new
                      const lastChunk = streamChunks[streamChunks.length - 1];
                      if (lastChunk?.type === 'text') {
                        lastChunk.content += text;
                      } else {
                        streamChunks.push({ type: 'text', content: text });
                      }
                      send(ws, { type: 'progress', event: 'delta', data: { text } }, requestId);
                      writeLog('delta', { length: text.length });
                    }
                    handledChunk = true;
                    break;
                  }

                  // Reasoning/Thinking events - forward to client for display
                  case 'reasoning-start':
                  case 'thinking-start': {
                    if (!reasoningStartTime) reasoningStartTime = Date.now();
                    send(ws, { type: 'progress', event: 'reasoning_start', data: { id: (chunk as any)?.payload?.id } }, requestId);
                    handledChunk = true;
                    break;
                  }

                  case 'reasoning-delta':
                  case 'thinking-delta': {
                    const reasoningText = (chunk as any)?.payload?.text || (chunk as any)?.textDelta || (typeof (chunk as any)?.payload === 'string' ? (chunk as any).payload : '');
                    if (reasoningText) {
                      if (!reasoningStartTime) reasoningStartTime = Date.now();
                      aggregatedReasoning += reasoningText;
                      const lastReasoningChunk = streamChunks[streamChunks.length - 1];
                      if (lastReasoningChunk?.type === 'reasoning') {
                        lastReasoningChunk.content += reasoningText;
                      } else {
                        streamChunks.push({ type: 'reasoning', content: reasoningText });
                      }
                      send(ws, { type: 'progress', event: 'reasoning', data: { text: reasoningText } }, requestId);
                    }
                    handledChunk = true;
                    break;
                  }

                  case 'reasoning-end':
                  case 'thinking-end': {
                    send(ws, { type: 'progress', event: 'reasoning_end', data: { id: (chunk as any)?.payload?.id } }, requestId);
                    handledChunk = true;
                    break;
                  }

                  case 'reasoning-signature':
                    // Metadata only, no need to forward
                    handledChunk = true;
                    break;

                  case 'tool_event':
                    sawToolCall = true;
                    const safeEvt = sanitizeToolEvent(chunk);
                    // Log workflow_modify events for debugging immediate application
                    if (safeEvt?.tool === 'workflow_modify' && safeEvt?.status === 'completed') {
                      console.log('[cloud-ai] Forwarding workflow_modify completed event with result:', {
                        hasResult: !!safeEvt?.result,
                        hasWorkflow: !!safeEvt?.result?.workflow,
                        changes: safeEvt?.result?.changes
                      });
                    }
                    send(ws, { type: 'progress', event: 'tool_event', data: safeEvt }, requestId);
                    writeLog('tool_event', { source: 'top-level', tool: safeEvt?.tool, status: safeEvt?.status });
                    sentToolEventTopLevel = true;
                    handledChunk = true;
                    break;

                  case 'tool-call': {
                    sawToolCall = true;
                    const toolName = (chunk as any)?.payload?.toolName || 'tool';
                    const toolCallId = (chunk as any)?.payload?.toolCallId || `tc-${Date.now()}`;
                    const toolArgs = (chunk as any)?.payload?.args;
                    const safeToolArgs = redactSensitiveData(toolArgs);

                    // Track tool call
                    const toolCall = { id: toolCallId, tool: toolName, status: 'called', args: safeToolArgs, timestamp: Date.now() };
                    toolCallsMap.set(toolCallId, toolCall);
                    streamChunks.push({ type: 'tool', tool: { ...toolCall } });

                    // Only send to UI if not a SIS meta-tool
                    if (!isSISMetaTool(toolName)) {
                      send(ws, { type: 'progress', event: 'tool_event', data: { tool: toolName, status: 'called', toolCallId, args: safeToolArgs } }, requestId);
                    }
                    writeLog('tool_call', { name: toolName });
                    handledChunk = true;
                    break;
                  }

                  case 'tool-result': {
                    sawToolCall = true;
                    const toolName = (chunk as any)?.payload?.toolName || 'tool';
                    const toolCallId = (chunk as any)?.payload?.toolCallId || '';
                    const toolResult = (chunk as any)?.payload?.result;
                    const safeToolResult = sanitizeToolResult(toolResult);

                    // Update tool call with result
                    const existingCall = toolCallsMap.get(toolCallId);
                    if (existingCall) {
                      existingCall.status = 'completed';
                      existingCall.result = safeToolResult;
                      // Update in streamChunks
                      for (const sc of streamChunks) {
                        if (sc.type === 'tool' && sc.tool.id === toolCallId) {
                          sc.tool.status = 'completed';
                          sc.tool.result = safeToolResult;
                          break;
                        }
                      }
                    }

                    // Only send to UI if not a SIS meta-tool
                    if (!isSISMetaTool(toolName)) {
                      send(ws, { type: 'progress', event: 'tool_event', data: { tool: toolName, status: 'completed', toolCallId, result: safeToolResult } }, requestId);
                    }
                    handledChunk = true;
                    break;
                  }

                  case 'finish': {
                    // The finish event contains the COMPLETE response text.
                    // Only use it as a fallback if no text-delta events were received,
                    // otherwise we'd duplicate the already-streamed content.
                    const text =
                      (chunk as any)?.payload?.text ||
                      (chunk as any)?.payload?.response?.text ||
                      (chunk as any)?.text ||
                      '';
                    if (typeof text === 'string' && text && !sawAnyTextDelta) {
                      sawAnyTextDelta = true;
                      aggregatedText = text;
                      streamChunks.push({ type: 'text', content: text });
                    }
                    handledChunk = true;
                    break;
                  }

                  case 'step-finish':
                  case 'step-start':
                  case 'response-metadata':
                    // Control chunks - usage_update is emitted via onStepFinish callback
                    handledChunk = true;
                    break;
                }
              }

              // Fallback for legacy/alternative formats (only if not already handled)
              if (!handledChunk) {
                // Log unhandled chunk types for debugging (helps identify missing handlers)
                if (evType && process.env.CLOUD_DEBUG_STREAM === '1') {
                  console.log('[cloud-ai] Unhandled chunk type:', evType, JSON.stringify(chunk).slice(0, 300));
                }

                let textDelta: string | undefined;
                if (typeof (chunk as any) === 'string') {
                  textDelta = chunk as any;
                } else if (typeof (chunk as any)?.textDelta === 'string') {
                  textDelta = (chunk as any).textDelta;
                } else if (typeof (chunk as any)?.delta === 'string') {
                  textDelta = (chunk as any).delta;
                } else if (typeof (chunk as any)?.text === 'string') {
                  textDelta = (chunk as any).text;
                }
                // Note: We no longer extract from payload.text here as that could catch reasoning
                if (textDelta && textDelta.length > 0) {
                  sawAnyTextDelta = true;
                  aggregatedText += textDelta;
                  if (process.env.CLOUD_DEBUG_DELTA === '1') { console.log('[cloud-ai] Delta length:', textDelta.length, 'preview:', textDelta.slice(0, 80)); }
                  send(ws, { type: 'progress', event: 'delta', data: { text: textDelta } }, requestId);
                  writeLog('delta', { length: textDelta.length });
                }
              }
              // Legacy AI SDK toolCall/toolResult shapes (only if not already handled)
              if (!handledChunk) {
                const toolCall = (chunk as any)?.toolCall;
                if (toolCall?.name) {
                  sawToolCall = true;
                  const safeToolArgs = redactSensitiveData(toolCall.args);
                  console.log(`[cloud-ai] Tool called: ${toolCall.name}`, safeToolArgs);

                  // Only send to UI if not a SIS meta-tool
                  if (!isSISMetaTool(toolCall.name)) {
                    send(ws, { type: 'progress', event: 'tool_event', data: { tool: toolCall.name, status: 'called', args: safeToolArgs } }, requestId);
                  }
                  writeLog('tool_call', { name: toolCall.name });
                }
                const toolResult = (chunk as any)?.toolResult;
                if (toolResult) {
                  sawToolCall = true;
                  console.log(`[cloud-ai] Tool result:`, sanitizeToolResult(toolResult));
                }
              }
            } catch (e) {
              console.error('[cloud-ai] Stream chunk error:', e);
              writeLog('stream_chunk_error', { message: (e as any)?.message || String(e) });
            }
          }
        } catch (e: any) {
          streamIterationError = e;
          console.error('[cloud-ai] Stream iteration error:', e);
          writeLog('stream_iteration_error', { message: e?.message || String(e) });
        }

        if (streamIterationError && !didSendFinal) {
          didSendFinal = true;
          try { if (hardTimeout) clearTimeout(hardTimeout); } catch { }
          deleteAbortController(ws, requestId);
          const msgText = String(streamIterationError?.message || streamIterationError || 'Agent stream failed');
          const errorFinalText = aggregatedText ? aggregatedText.trim() : `Error: ${msgText}`;

          // Persist partial work (tool calls, text) even on error
          if (authUser && conversationId) {
            try {
              const metadata = buildAssistantMetadata('error');
              await addAssistantMessage(authUser.userId, conversationId, errorFinalText, metadata);
            } catch { }
          }

          send(
            ws,
            {
              type: 'final',
              origin: 'cloud-ai',
              model: chosenModelId || routedTier,
              conversationId,
              result: { text: errorFinalText, steps: [], finishReason: 'error' },
              error: true,
            },
            requestId
          );
          return;
        }

        if (!didSendFinal) {
          try {
            const maybe = (stream as any)?.text;
            const maybeText =
              typeof maybe === 'string'
                ? maybe
                : maybe && typeof maybe?.then === 'function'
                  ? await maybe
                  : '';
            if (!aggregatedText && typeof maybeText === 'string' && maybeText.trim()) {
              aggregatedText = maybeText;
            }
          } catch { }
        }

        // Check if we broke out of the loop due to abort
        if (abortController?.signal.aborted && !didSendFinal) {
          console.log('[cloud-ai] Stream aborted by user (loop break)');
          didSendFinal = true;
          try { if (hardTimeout) clearTimeout(hardTimeout); } catch { }
          deleteAbortController(ws, requestId);
          const partialText = aggregatedText ? aggregatedText.trim() : '';

          // Persist partial work even on abort so conversation history isn't lost
          if (authUser && conversationId && partialText) {
            try {
              const metadata = buildAssistantMetadata('aborted');
              await addAssistantMessage(authUser.userId, conversationId, partialText, metadata);
            } catch { }
          }

          send(
            ws,
            {
              type: 'final',
              origin: 'cloud-ai',
              model: chosenModelId || routedTier,
              conversationId,
              result: { text: partialText || '(Stopped)', steps: [], finishReason: 'aborted' },
              aborted: true,
            },
            requestId
          );
          return;
        }

        if (!didSendFinal) {
          let finalText = aggregatedText ? aggregatedText.trim() : '';
          let emptyOutput = !finalText && !sawAnyTextDelta && !sawToolCall;

          if (emptyOutput && (agentType === 'workflow' || agentType === 'skill') && typeof (agent as any)?.generate === 'function') {
            try {
              const genRes: any = await (agent as any).generate(inputMessages);
              const genText = String(genRes?.text || '').trim();
              if (genText) {
                finalText = genText;
                emptyOutput = false;
              }
            } catch { }
          }

          if (!didSendFinal) {
            didSendFinal = true;
            try { if (hardTimeout) clearTimeout(hardTimeout); } catch { }
            send(
              ws,
              {
                type: 'final',
                origin: 'cloud-ai',
                model: chosenModelId || routedTier,
                conversationId,
                result: {
                  text: emptyOutput ? 'Error: Model returned no output. Please retry.' : finalText,
                  steps: [],
                  finishReason: emptyOutput ? 'empty' : 'done'
                },
                error: emptyOutput ? true : undefined,
              },
              requestId
            );
          }
        }

        // Clean up abort controller after stream completes
        try { if (hardTimeout) clearTimeout(hardTimeout); } catch { }
        deleteAbortController(ws, requestId);
      } catch (e: any) {
        try { if (hardTimeout) clearTimeout(hardTimeout); } catch { }
        // Clean up abort controller on error
        deleteAbortController(ws, requestId);

        // Handle abort errors specifically
        if (e?.name === 'AbortError' || abortController?.signal.aborted) {
          console.log('[cloud-ai] Stream aborted by user');
          if (!didSendFinal) {
            didSendFinal = true;
            const partialText = aggregatedText ? aggregatedText.trim() : '';

            // Persist partial work on abort
            if (authUser && conversationId && partialText) {
              try {
                const metadata = buildAssistantMetadata('aborted');
                await addAssistantMessage(authUser.userId, conversationId, partialText, metadata);
              } catch { }
            }

            send(ws, {
              type: 'final',
              origin: 'cloud-ai',
              model: chosenModelId || routedTier,
              conversationId,
              result: { text: partialText || '(Stopped)', steps: [], finishReason: 'aborted' },
              aborted: true
            }, requestId);
          }
          return;
        }

        // Handle errors inside the background task
        console.error('[cloud-ai] Stream error:', e);

        const toolCallParseError =
          e &&
          typeof e === 'object' &&
          typeof (e as any).input === 'string' &&
          ((e as any).error instanceof SyntaxError || String((e as any).error || '').includes('SyntaxError'));

        if (toolCallParseError) {
          const errMsg = String((e as any)?.error?.message || 'Invalid JSON in tool call input');
          const inputPreview = String((e as any).input || '').slice(0, 2000);
          const toolCallId = `tc-parse-${Date.now()}`;

          try {
            writeLog('tool_call_parse_error', {
              message: errMsg,
              inputChars: typeof (e as any).input === 'string' ? (e as any).input.length : undefined,
            });
          } catch { }

          try {
            send(
              ws,
              {
                type: 'progress',
                event: 'tool_event',
                data: {
                  tool: 'tool_call',
                  status: 'error',
                  toolCallId,
                  error: 'invalid_json',
                  message: errMsg,
                  inputPreview,
                },
              },
              requestId
            );
          } catch { }

          const finalText = `Tool call failed: ${errMsg}. Please retry.`;

          // Persist partial work on tool parse error (only if not already persisted)
          if (!didSendFinal) {
            didSendFinal = true;
            if (authUser && conversationId) {
              try {
                const metadata = buildAssistantMetadata('error');
                await addAssistantMessage(authUser.userId, conversationId, finalText, metadata);
              } catch { }
            }

            send(
              ws,
              {
                type: 'final',
                origin: 'cloud-ai',
                result: { text: finalText, steps: [], finishReason: 'error' },
              },
              requestId
            );
          }
          return;
        }

        // Check for tool hallucination errors (model tried to call a non-existent tool)
        const isToolHallucination = (() => {
          if (!e || typeof e !== 'object') return null;
          const eName = String((e as any).name || '');
          const eMsg = String((e as any).message || '');
          if (eName === 'AI_NoSuchToolError' || eName === 'NoSuchToolError' || eMsg.includes('is not a tool')) {
            return { toolName: (e as any).toolName || eMsg.match(/[Tt]ool\s+['"`](\w+)['"`]/)?.[1] || 'unknown', message: eMsg };
          }
          if (eName === 'AI_InvalidToolArgumentsError' || eName === 'InvalidToolArgumentsError') {
            return { toolName: (e as any).toolName || 'unknown', message: eMsg };
          }
          const lower = eMsg.toLowerCase();
          if ((lower.includes('tool') && (lower.includes('not found') || lower.includes('does not exist') || lower.includes('unknown tool'))) || lower.includes('no such tool')) {
            return { toolName: (e as any).toolName || eMsg.match(/[Tt]ool\s+['"`](\w+)['"`]/)?.[1] || 'unknown', message: eMsg };
          }
          return null;
        })();

        if (isToolHallucination) {
          const toolCallId = `tc-hallucinated-${Date.now()}`;
          console.warn(`[cloud-ai] Tool hallucination: "${isToolHallucination.toolName}"`);

          try {
            writeLog('tool_hallucination', { toolName: isToolHallucination.toolName, message: isToolHallucination.message });
          } catch { }

          // Show the hallucinated tool as an error pill in the UI
          try {
            send(ws, {
              type: 'progress',
              event: 'tool_event',
              data: {
                tool: isToolHallucination.toolName,
                status: 'called',
                toolCallId,
                args: {},
                description: `${isToolHallucination.toolName} (hallucinated)`,
              }
            }, requestId);
            send(ws, {
              type: 'progress',
              event: 'tool_event',
              data: {
                tool: isToolHallucination.toolName,
                status: 'error',
                toolCallId,
                error: `Tool "${isToolHallucination.toolName}" does not exist. The model tried to call a non-existent tool.`,
              }
            }, requestId);
          } catch { }

          const errorText = aggregatedText
            ? aggregatedText.trim() + `\n\nI attempted to use a tool called "${isToolHallucination.toolName}" that doesn't exist. Please try rephrasing your request.`
            : `I attempted to use a tool called "${isToolHallucination.toolName}" that doesn't exist. Please try rephrasing your request.`;

          if (!didSendFinal) {
            didSendFinal = true;
            if (authUser && conversationId) {
              try {
                const metadata = buildAssistantMetadata('error');
                await addAssistantMessage(authUser.userId, conversationId, errorText, metadata);
              } catch { }
            }
            send(ws, {
              type: 'final',
              origin: 'cloud-ai',
              result: { text: errorText, steps: [], finishReason: 'error' },
            }, requestId);
          }
          return;
        }

        // Persist partial work on generic errors too (only if not already persisted)
        if (!didSendFinal && authUser && conversationId) {
          didSendFinal = true;
          try {
            const errorText = aggregatedText ? aggregatedText.trim() : `Error: ${e?.message || String(e)}`;
            const metadata = buildAssistantMetadata('error');
            await addAssistantMessage(authUser.userId, conversationId, errorText, metadata);
          } catch { }
        }

        send(ws, { type: 'error', message: e?.message || String(e) }, requestId);
      }
    }, secretBag);
    // Don't await - allow parallel processing
  }); // end ws.on('message')
}); // end wss.on('connection')
