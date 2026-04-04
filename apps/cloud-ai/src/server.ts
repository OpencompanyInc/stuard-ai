import 'dotenv/config';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { getWorkflowAgent, WORKFLOW_SYSTEM_PROMPT } from './agents/workflow-agent';
import { setSessionWorkflow, clearSessionWorkflow } from './tools/workflow';
import { withClientBridge, handleClientToolMessage } from './tools/bridge';
import { routeModel, type ModelChoice } from './router/model-router';
import { verifyAccessToken, AuthErrorCode } from './auth';
import { createConversation, addAssistantMessage, addUserMessage, logUsageEvent, checkAccess, incrementDailyRequestCounter, finishRun, setConversationTitle, getExternalAccount, getConversationMessages } from './supabase';
import { getDefaultModelForCategory, priceForModel } from './pricing';
import { buildProviderModel } from './utils/models';
import { randomUUID } from 'crypto';
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { handleHttpRoutes } from './routes';
import { PORT, ENABLE_ROUTING, REQUIRE_AUTH, MAX_STEPS_CAP, DEFAULT_MAX_STEPS, PING_INTERVAL_MS } from './utils/config';
import { writeLog } from './utils/logger';
import { sanitizeToolEvent, sanitizeSteps } from './utils/sanitize';
import { normalizeMessages, contentToText, buildAttachmentParts } from './utils/messages';
import { buildKnowledgeContext } from './knowledge/retrieval';
import { ensureToolEmbeddings } from './tools/meta-tools';
import { warmupGroupCache } from './utils/tool-groups';
import * as memoryService from './memory/conversations';
import { compactHistory } from './memory/context-compactor';
import { registerWebhookClient, deliverQueuedWebhooks } from './webhooks/dispatch';
import { getOrCreateQueryEmbedding } from './utils/shared-embedding';
import { getRankedToolNames } from './utils/tool-ranking';
import { normalizeUsage } from './utils/usage';
// Skills are now injected into the system prompt via buildSystemInstructions (see agent-runner.ts)

import { getAgentForQuery } from './agents/stuard/index';
import { getOrchestratorAgent } from './orchestrator';

const _USE_ORCHESTRATOR = process.env.USE_ORCHESTRATOR === '1';

import { startVMHealthMonitor } from './services/vm-health';
import { registerConnection, getDesktopWs } from './services/vm-bridge';
import { verifyVMToken } from './services/vm-tokens';

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

// VM stream mirror: when processing a VM-auth'd chat, mirror streaming events
// to the user's desktop WS so they get real-time reasoning/text/tool events.
// WeakMap auto-cleans when the VM WS is garbage collected.
const _vmStreamMirrors = new WeakMap<WebSocket, WebSocket>();

/** Event types that should be mirrored to the desktop during VM streaming */
const MIRROR_EVENT_TYPES = new Set(['progress', 'final', 'title', 'conversation']);

function send(ws: WebSocket, data: unknown, requestId?: string) {
  try {
    // Include requestId in all messages for parallel routing
    const payload = requestId ? { ...data as object, requestId } : data;
    ws.send(JSON.stringify(payload));
  } catch { }

  // Mirror to desktop for VM→desktop stream relay
  const mirror = _vmStreamMirrors.get(ws);
  if (mirror && mirror.readyState === WebSocket.OPEN && mirror !== ws) {
    const d = data as any;
    if (d?.type && MIRROR_EVENT_TYPES.has(d.type)) {
      try {
        const mirrorPayload = {
          ...(requestId ? { ...d, requestId } : d),
          vmMirror: true,
        };
        mirror.send(JSON.stringify(mirrorPayload));
      } catch { }
    }
  }
}

// Helper to check if a tool should be hidden from UI (SIS meta-tools, internal operations)
function isSISMetaTool(toolName: string): boolean {
  return toolName === 'sis_execute_tool' ||
    toolName === 'sis_search_tools' ||
    toolName === 'sis_list_categories' ||
    toolName === 'search_past_conversations' ||
    toolName === 'segment_search';
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
import { telnyxBridgeWss } from './routes/integrations/telnyx-bridge';
import { initVoiceProviders } from './voice';

// Register all voice providers (OpenAI Realtime, ElevenLabs, Grok, Gemini Live)
initVoiceProviders();

server.on('upgrade', (req, socket, head) => {
  const url = req.url || '';
  if (url === '/ws' || url.startsWith('/ws?')) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else if (url === '/speech' || url.startsWith('/speech?')) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      handleSpeechConnection(ws, req);
    });
  } else if (url === '/terminal' || url.startsWith('/terminal?')) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      handleTerminalConnection(ws, req);
    });
  } else if (url.startsWith('/ws/telnyx-bridge')) {
    telnyxBridgeWss.handleUpgrade(req, socket, head, (ws) => {
      telnyxBridgeWss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

server.listen(PORT, () => {
  // console.log(`[cloud-ai] HTTP listening on http://0.0.0.0:${PORT}`);
  // console.log(`[cloud-ai] WS endpoint at ws://<host>:${PORT}/ws`);
  // console.log(`[cloud-ai] Model routing: ${ENABLE_ROUTING ? 'enabled (Gemini)' : 'disabled (gpt-5-medium)'}`);

  // Warm up semantic group cache (lightweight SELECT, no embeddings)
  try {
    warmupGroupCache();
  } catch { }

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
});

// Increase HTTP keep-alive and headers timeouts to be friendly to long-lived WS
try {
  (server as any).keepAliveTimeout = Number(process.env.CLOUD_HTTP_KEEPALIVE_MS || 120000);
  (server as any).headersTimeout = Number(process.env.CLOUD_HTTP_HEADERS_TIMEOUT_MS || 120000);
} catch { }

// Store conversation history per connection
const conversations = new WeakMap<WebSocket, Array<any>>();
// Persist conversationId per connection for authenticated users
const wsConversations = new WeakMap<WebSocket, string>();
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
  try {
    const rawUrl = String(req?.url || '');
    const qIndex = rawUrl.indexOf('?');
    if (qIndex >= 0) {
      const search = rawUrl.slice(qIndex + 1);
      const parts = search.split('&');
      for (const part of parts) {
        const [k, v] = part.split('=');
        if (decodeURIComponent(k || '') === 'client') {
          (ws as any).__clientType = decodeURIComponent(v || '');
          break;
        }
      }
    }
  } catch { }

  send(ws, { type: 'handshake', origin: 'cloud-ai', message: 'connected' });
  conversations.set(ws, []);
  writeLog('ws_connected');
  try { wsAlive.set(ws, true); } catch { }
  try { ws.on('pong', () => { try { wsAlive.set(ws, true); } catch { } }); } catch { }
  try { ws.on('close', () => {
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
    try { wsConversations.delete(ws); } catch { }
    try { anonResources.delete(ws); } catch { }
    try { anonThreads.delete(ws); } catch { }
  }); } catch { }

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
        try { initToolRegistry(); } catch {}

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
            } catch {}
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

    // Handle auth messages (from cloud-webhooks desktop connection)
    // Registers the WS for webhook delivery, chat sync, and VM stream mirroring
    if (kind === 'auth') {
      const token = String(msg?.accessToken || msg?.auth?.accessToken || '');
      if (!token) { send(ws, { type: 'auth_result', ok: false }); return; }
      try {
        const authResult = await verifyAccessToken(token);
        if (authResult?.success && authResult.userId) {
          registerConnection(ws, authResult.userId, 'desktop');
          registerWebhookClient(authResult.userId, ws);
          // Deliver queued webhooks
          let queuedCount = 0;
          try {
            queuedCount = await deliverQueuedWebhooks(authResult.userId, ws);
          } catch { }
          // Deliver queued chat sync events
          try {
            const { deliverQueuedChatEvents } = await import('./services/chat-sync');
            const chatDelivered = await deliverQueuedChatEvents(authResult.userId, ws);
            queuedCount += chatDelivered;
          } catch { }
          send(ws, { type: 'auth_result', ok: true, queued: queuedCount });
        } else {
          send(ws, { type: 'auth_result', ok: false });
        }
      } catch {
        send(ws, { type: 'auth_result', ok: false });
      }
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
    try {
      const incomingSkills = Array.isArray((msg as any)?.context?.skills) ? (msg as any).context.skills : [];
      if (incomingSkills.length > 0) {
        secretBag.__skills = incomingSkills;
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
      // Hoisted so the outer catch block can persist partial work on error
      let authUser: { userId: string; email?: string } | null = null;
      let requestedMode: TierChoice = 'balanced';
      const toolCallsMap = new Map<string, any>();
      type StreamChunk = { type: 'text'; content: string } | { type: 'reasoning'; content: string } | { type: 'tool'; tool: any };
      const streamChunks: StreamChunk[] = [];
      let aggregatedReasoning = '';
      let reasoningStartTime: number | null = null;
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
        // Track auth method so chat sync uses verified source, not spoofable context flags
        let authViaVMToken = false;

        // Fallback: authenticate VM agent via HMAC token (no Supabase JWT on VMs)
        if (!authUser && msg?.auth?.vmToken) {
          const claimedUserId = String(msg.auth.userId || (msg as any)?.context?.userId || '');
          if (claimedUserId) {
            try {
              const { resolveVMSecret } = await import('./services/vm-command');
              const secret = await resolveVMSecret(claimedUserId);
              if (secret) {
                const payload = verifyVMToken(msg.auth.vmToken, secret);
                if (payload && payload.userId === claimedUserId) {
                  authUser = { userId: claimedUserId };
                  authViaVMToken = true;
                }
              }
            } catch {}
          }
        }

        // Update secretBag with userId if authenticated
        if (authUser?.userId) secretBag.userId = authUser.userId;

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
            send(ws, { type: 'error', message: access.reason || 'access_denied', data: { plan: access.plan, limit: access.limit, used: access.used, remaining: access.remaining } }, requestId);
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

          // Deliver any queued chat sync events (VM→desktop) on reconnect
          try {
            const { deliverQueuedChatEvents } = await import('./services/chat-sync');
            const chatDelivered = await deliverQueuedChatEvents(authUser.userId, ws);
            if (chatDelivered > 0) {
              writeLog('queued_chat_events_delivered', { userId: authUser.userId, count: chatDelivered });
            }
          } catch { }
        }

        // VM stream mirror: relay streaming events to the desktop so the user
        // sees real-time reasoning/text/tool calls from VM chats.
        // Skip for SMS-originated chats (no desktop UI to mirror to).
        if (authViaVMToken && authUser && !(msg as any)?.mobileSource) {
          const desktopWs = getDesktopWs(authUser.userId);
          if (desktopWs && desktopWs !== ws && desktopWs.readyState === WebSocket.OPEN) {
            _vmStreamMirrors.set(ws, desktopWs);
          }
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

        // Propagate model selection to bridge secrets so subagents inherit it
        secretBag.__modelTier = routedTier;
        if (chosenModelId) secretBag.__modelId = chosenModelId;

        let enabledIntegrations: string[] = [];
        let mcpTools: Record<string, any> = {};

        if (authUser) {
          const _au = authUser; // local const for TS narrowing (authUser is `let`)
          // Check integrations
          const providers = ['github', 'google', 'outlook'];
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

        // Merge client-reported integrations (e.g. browser_use from desktop/VM)
        const clientIntegrations = (msg as any)?.clientIntegrations;
        if (Array.isArray(clientIntegrations)) {
          const existing = new Set(enabledIntegrations);
          for (const ci of clientIntegrations) {
            if (typeof ci === 'string' && ci && !existing.has(ci)) {
              enabledIntegrations.push(ci);
              existing.add(ci);
            }
          }
        }

        // Get conversation history for this connection
        const history = conversations.get(ws) || [];

        // If a conversationId was provided but in-memory history is empty,
        // load prior messages from Supabase so multi-turn context is preserved
        // (e.g., SMS where each message opens a new WebSocket connection).
        if (conversationId && history.length === 0 && authUser) {
          try {
            const priorMsgs = await getConversationMessages(authUser.userId, conversationId, 20);
            for (const pm of priorMsgs) {
              if (pm.role === 'user' || pm.role === 'assistant') {
                history.push({ role: pm.role, content: pm.content });
              }
            }
            if (history.length > 0) {
              conversations.set(ws, history);
              console.log(`[cloud-ai] Loaded ${history.length} prior messages from Supabase for conversation ${conversationId}`);
            }
          } catch (e: any) {
            console.warn('[cloud-ai] Failed to load conversation history from Supabase:', e?.message);
          }
        }

        // Add new user messages to history
        const newUserMsgs = messages.filter(m => m.role === 'user');
        for (const userMsg of newUserMsgs) {
          if (!history.find((h: any) => h.role === 'user' && h.content === userMsg.content)) {
            history.push(userMsg);
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

        const inferredWorkflow =
          clientType === 'workflow_ui' ||
          clientType === 'workflow' ||
          clientType === 'workflows' ||
          ctxMode === 'workflow_architect' ||
          ctxMode === 'workflow';

        const agentType =
          rawAgentLower === 'workflow' ||
            rawAgentLower === 'workflow_agent' ||
            rawAgentLower === 'workflow-architect' ||
            rawAgentLower === 'workflow_architect'
            ? 'workflow'
            : inferredWorkflow
              ? 'workflow'
              : 'stuard';

        const workflowModelId = agentType === 'workflow'
          ? (
            (typeof (msg as any)?.modelId === 'string' && String((msg as any).modelId).trim())
              ? String((msg as any).modelId).trim()
              : (process.env.WORKFLOW_MODEL_ID || 'google/gemini-3-pro-preview')
          )
          : undefined;

        const modelLabel = agentType === 'workflow' ? (workflowModelId || 'google/gemini-3-pro-preview') : (chosenModelId || routedTier);

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
                const topN = Number(process.env.SIS_RANKED_TOPN || '5');
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

          agent = _USE_ORCHESTRATOR
            ? getOrchestratorAgent(routedTier, enabledIntegrations, mcpTools, chosenModelId)
            : await getAgentForQuery(routedTier, prompt, undefined, enabledIntegrations, mcpTools, chosenModelId, rankedToolNames);
        }

        let conversationCreatedNow = false;
        // Mobile-originated messages (SMS/WhatsApp routed to desktop) must always
        // persist conversations regardless of sync_conversations preference.
        const forcePersist = !!(msg as any)?.forcePersist;
        const mobileSource: string | undefined = typeof (msg as any)?.mobileSource === 'string' ? (msg as any).mobileSource : undefined;
        if (authUser) {
          const resetRequested = !!(msg as any)?.resetConversation;
          if (resetRequested) {
            try { wsConversations.delete(ws); } catch { }
          }
          const requestedId = typeof (msg as any)?.conversationId === 'string' ? String((msg as any).conversationId).trim() : '';
          if (requestedId) {
            conversationId = requestedId;
          } else {
            conversationId = await createConversation(
              authUser.userId,
              prompt,
              modelLabel,
              { mode: requestedMode, tier: routedTier, modelId: chosenModelId, contextPaths: contextPathsForMeta },
              agentType === 'workflow' ? 'workflow' : 'stuard',
              forcePersist,
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

        const recentHistory = history.slice(-50) as any[];
        let inputMessages: any[] = (providedMessages && providedMessages.length > 0)
          ? [...providedMessages]
          : [...recentHistory, { role: 'user', content: prompt }];

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
        const attachmentParts = buildAttachmentParts([...attachments, ...imageAttachments]);
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
        // Track whether the model produced any text deltas or invoked tools
        let sawAnyTextDelta = false;
        let sawToolCall = false;
        aggregatedText = '';

        // Reset reasoning tracking for this turn (variables hoisted above try block)
        aggregatedReasoning = '';
        reasoningStartTime = null;
        // toolCallsMap and streamChunks are hoisted above the try block

        // Persist this user turn for ongoing conversations (first turn already stored on creation)
        if (authUser && conversationId && !conversationCreatedNow) {
          try {
            await addUserMessage(authUser.userId, conversationId, prompt, {
              mode: requestedMode,
              tier: routedTier,
              modelId: chosenModelId,
              contextPaths: contextPathsForMeta,
            }, forcePersist);
          } catch { }
        }

        // Determine maxSteps for this run (per-message override -> env/default), with a safety cap
        // Workflow agent needs more steps for tool discovery and testing
        const reqMaxStepsRaw = (msg as any)?.maxSteps ?? (msg as any)?.limits?.maxSteps;
        let maxSteps = agentType === 'workflow' ? 60 : DEFAULT_MAX_STEPS;
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
        } catch { }

        // Skills are now injected directly into the system prompt via buildSystemInstructions

        // Inject hidden state context (terminals, subagents, recent tool results) - NOT rendered in UI
        try {
          const hiddenContext: string | undefined = (msg as any)?.hiddenContext;
          if (hiddenContext && typeof hiddenContext === 'string' && hiddenContext.trim()) {
            inputMessages = [{ role: 'system', content: hiddenContext }, ...inputMessages];
          }
        } catch { }

        // Retrieve knowledge context and similar conversations, inject into messages
        if (agentType !== 'workflow') {
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

              const [knowledgeCtx, segmentMatches] = await Promise.all([
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



        // ─── TOKEN BREAKDOWN DIAGNOSTIC ─────────────────────────────────
        // Detailed per-component token estimation to identify bloat sources.
        // Rough estimate: 1 token ≈ 4 chars for English text, ~3 chars for JSON/schemas.
        try {
          const systemMessages = inputMessages.filter((m: any) => m.role === 'system');
          const userMessages = inputMessages.filter((m: any) => m.role === 'user');
          const assistantMessages = inputMessages.filter((m: any) => m.role === 'assistant');
          const toolMessages = inputMessages.filter((m: any) => m.role === 'tool');

          const charCount = (msgs: any[]) => msgs.reduce((sum: number, m: any) => {
            const c = m.content;
            if (typeof c === 'string') return sum + c.length;
            if (Array.isArray(c)) return sum + c.reduce((s: number, p: any) => s + String(p?.text || JSON.stringify(p) || '').length, 0);
            return sum + JSON.stringify(c || '').length;
          }, 0);

          const systemChars = charCount(systemMessages);
          const userChars = charCount(userMessages);
          const assistantChars = charCount(assistantMessages);
          const toolChars = charCount(toolMessages);

          // Estimate tool definition tokens (JSON schemas are denser, ~3 chars/token)
          // Read from __diagTools attached in getAgent/getAgentForQuery (Mastra doesn't expose these)
          const agentTools = (agent as any)?.__diagTools || agent?.tools || {};
          const toolNames = Object.keys(agentTools);
          let toolSchemaChars = 0;
          const perToolSizes: { name: string; chars: number; tokEst: number }[] = [];
          for (const [name, tool] of Object.entries(agentTools)) {
            try {
              const desc = String((tool as any)?.description || '').length;
              const params = JSON.stringify((tool as any)?.parameters || (tool as any)?.inputSchema || {}).length;
              const total = desc + params + name.length + 20;
              toolSchemaChars += total;
              perToolSizes.push({ name, chars: total, tokEst: Math.round(total / 3) });
            } catch { toolSchemaChars += 200; perToolSizes.push({ name, chars: 200, tokEst: 67 }); }
          }
          perToolSizes.sort((a, b) => b.chars - a.chars);

          // Agent system instructions (separate from inputMessages system msgs)
          let agentInstructionChars = 0;
          try {
            const instr = (agent as any)?.__diagInstructions || (agent as any)?.instructions;
            if (typeof instr === 'string') agentInstructionChars = instr.length;
            else if (Array.isArray(instr)) agentInstructionChars = instr.reduce((s: number, i: any) => s + String(i?.content || JSON.stringify(i) || '').length, 0);
          } catch {}

          const totalMsgChars = systemChars + userChars + assistantChars + toolChars;

          console.log(`[cloud-ai] ═══ TOKEN BREAKDOWN (estimated) ═══`);
          console.log(`[cloud-ai]   Agent instructions:  ~${Math.round(agentInstructionChars / 4)} tok (${agentInstructionChars} chars)`);
          console.log(`[cloud-ai]   Tool definitions:    ~${Math.round(toolSchemaChars / 3)} tok (${toolNames.length} tools, ${toolSchemaChars} chars)`);
          console.log(`[cloud-ai]   System messages:     ~${Math.round(systemChars / 4)} tok (${systemMessages.length} msgs, ${systemChars} chars)`);
          console.log(`[cloud-ai]   User messages:       ~${Math.round(userChars / 4)} tok (${userMessages.length} msgs, ${userChars} chars)`);
          console.log(`[cloud-ai]   Assistant messages:   ~${Math.round(assistantChars / 4)} tok (${assistantMessages.length} msgs, ${assistantChars} chars)`);
          console.log(`[cloud-ai]   Tool result messages: ~${Math.round(toolChars / 4)} tok (${toolMessages.length} msgs, ${toolChars} chars)`);
          console.log(`[cloud-ai]   ─────────────────────────────────`);
          console.log(`[cloud-ai]   TOTAL est:           ~${Math.round(agentInstructionChars / 4 + toolSchemaChars / 3 + totalMsgChars / 4)} tok`);
          console.log(`[cloud-ai]   ─── Per-tool schema sizes (desc) ───`);
          for (const t of perToolSizes) {
            console.log(`[cloud-ai]     ${t.name.padEnd(35)} ~${String(t.tokEst).padStart(5)} tok (${t.chars} chars)`);
          }
          console.log(`[cloud-ai] ═══════════════════════════════════`);
        } catch (diagErr) {
          console.warn('[cloud-ai] Token breakdown diagnostic failed:', diagErr);
        }

        // Provider options
        const providerOptions: any = {};
        const reasoningLevel: string = (['none', 'low', 'medium', 'high'].includes(String((msg as any)?.reasoningLevel || '')))
          ? String((msg as any).reasoningLevel)
          : 'high';

        // ---------- Google Gemini thinking ----------
        // Enable thinking for Google Gemini models that support it (2.5+, 3+).
        // Gemini 3 models require thought parts to be preserved and passed back with function responses.
        const isGeminiThinking =
          (agentType === 'workflow' && typeof workflowModelId === 'string' && (workflowModelId.includes('google/gemini-3') || workflowModelId.includes('google/gemini-2.5'))) ||
          chosenModelId?.includes('google/gemini-3') ||
          chosenModelId?.includes('google/gemini-2.5') ||
          modelLabel?.includes('google/gemini-3') ||
          modelLabel?.includes('gemini-3') ||
          modelLabel?.includes('google/gemini-2.5') ||
          modelLabel?.includes('gemini-2.5');

        if (isGeminiThinking) {
          providerOptions.google = {
            thinkingConfig: {
              includeThoughts: reasoningLevel !== 'none',
              thinkingLevel: reasoningLevel as 'none' | 'low' | 'medium' | 'high',
            },
          };
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
          // Only set for models known to support reasoning effort (o-series, gpt-5-pro, gpt-5.1+)
          const modelPart = (chosenModelId || modelLabel || '').split('/').pop() || '';
          const supportsEffort = /^(o[1-9]|gpt-5-pro|gpt-5\.1)/.test(modelPart);
          if (supportsEffort && reasoningLevel !== 'none') {
            providerOptions.openai = {
              ...(providerOptions.openai || {}),
              reasoningEffort: reasoningLevel as 'low' | 'medium' | 'high',
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
        let stepCount = 0;
        let cumulativeInputTokens = 0;
        const activeToolNames: string[] | undefined = (agent as any).__activeToolNames;
        const streamOptions: any = {
          maxSteps,
          providerOptions,
          abortSignal: abortController.signal,
          ...(activeToolNames ? { activeTools: activeToolNames } : {}),
          onStepFinish: (stepData: any) => {
            stepCount++;
            const stepUsage = stepData?.usage;
            const normalized = stepUsage ? normalizeUsage(stepUsage) : null;
            if (normalized) cumulativeInputTokens += normalized.promptTokens;
            // Mastra wraps tool calls in { type, runId, from, payload } — dig into payload
            const rawCalls = stepData?.toolCalls || stepData?.tool_calls || [];
            const extractToolName = (tc: any) =>
              tc?.toolName || tc?.tool_name || tc?.name || tc?.function?.name
              || tc?.payload?.toolName || tc?.payload?.tool_name || tc?.payload?.name
              || '?';
            const toolNames = (Array.isArray(rawCalls) ? rawCalls : []).map(extractToolName).join(', ');
            // Also check toolResults for tool names if toolCalls is empty
            const rawResults = stepData?.toolResults || stepData?.tool_results || [];
            const resultToolNames = (!toolNames || toolNames === '?') && Array.isArray(rawResults)
              ? rawResults.map((tr: any) => extractToolName(tr)).join(', ')
              : '';
            const finalToolNames = (toolNames && toolNames !== '?') ? toolNames : resultToolNames;
            // Log raw keys on first step for debugging
            if (stepCount === 1) {
              const keys = Object.keys(stepData || {});
              console.log(`[cloud-ai] ── Step 1 raw keys: ${keys.join(', ')}`);
              if (rawCalls.length > 0) console.log(`[cloud-ai]    toolCalls[0] keys: ${Object.keys(rawCalls[0] || {}).join(', ')}`);
              if (rawResults.length > 0) console.log(`[cloud-ai]    toolResults[0] keys: ${Object.keys(rawResults[0] || {}).join(', ')}`);
            }
            const inputTok = normalized ? `input: ${normalized.promptTokens} tok | output: ${normalized.completionTokens} tok | cached: ${normalized.cachedPromptTokens || 0} tok | cumulative input: ${cumulativeInputTokens} tok` : 'no usage';
            console.log(`[cloud-ai] ── Step ${stepCount} ── ${inputTok}${finalToolNames ? ` | tools: ${finalToolNames}` : ''}`);
          },
          onFinish: async ({ text, steps, finishReason, usage }: any) => {
            if (didSendFinal) {
              try { if (hardTimeout) clearTimeout(hardTimeout); } catch { }
              return;
            }
            didSendFinal = true;
            try { if (hardTimeout) clearTimeout(hardTimeout); } catch { }
            const normalizedUsage = normalizeUsage(usage);
            try {
              console.log('[cloud-ai] onFinish reason:', finishReason, 'usage:', normalizedUsage);
            } catch { }
            let finalText = String(text || '').trim();
            if (!finalText && aggregatedText) {
              finalText = aggregatedText.trim();
            }
            writeLog('stream_finish', { finishReason, usage: normalizedUsage, textLength: finalText.length, sawToolCall, sawAnyTextDelta });
            
            // ── Persist tool calls + results in history so the LLM remembers what it did ──
            const completedToolCalls = Array.from(toolCallsMap.values()).filter(tc => tc.status === 'completed');
            if (completedToolCalls.length > 0) {
              // Build AI SDK-compatible tool-call / tool-result message pairs
              // This lets the LLM see its own previous actions in subsequent turns
              const toolCallParts = completedToolCalls.map(tc => ({
                type: 'tool-call' as const,
                toolCallId: tc.id,
                toolName: tc.tool,
                args: tc.args || {},
              }));
              history.push({ role: 'assistant', content: toolCallParts });

              for (const tc of completedToolCalls) {
                // Truncate large results to avoid blowing up the context window
                let resultStr = typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result ?? '');
                if (resultStr.length > 2000) {
                  resultStr = resultStr.slice(0, 1800) + '\n...[truncated, ' + resultStr.length + ' chars total]';
                }
                history.push({
                  role: 'tool',
                  content: [{ type: 'tool-result', toolCallId: tc.id, toolName: tc.tool, result: resultStr }],
                });
              }
            }

            // Final assistant text
            if (finalText) {
              history.push({ role: 'assistant', content: finalText });
            }
            
            // Auto-compact: summarize older messages, truncate large tool results
            // This runs asynchronously — fire-and-forget since we already have the final text
            compactHistory(history).then(() => {
              conversations.set(ws, history);
            }).catch((err) => {
              console.warn('[cloud-ai] Compaction failed:', err);
              // Fallback: hard cap at 60
              if (history.length > 60) history.splice(0, history.length - 60);
              conversations.set(ws, history);
            });
            if (authUser && conversationId) {
              // Build metadata for persistence
              const toolCallsList = Array.from(toolCallsMap.values());
              // Filter out SIS meta-tools from saved metadata
              const filteredToolCalls = toolCallsList.filter(tc => !isSISMetaTool(tc.tool));
              const metadata = {
                mode: requestedMode,
                tier: routedTier,
                modelId: chosenModelId,
                reasoning: aggregatedReasoning || undefined,
                reasoningDuration: reasoningStartTime ? (Date.now() - reasoningStartTime) / 1000 : undefined,
                toolCalls: filteredToolCalls.length > 0 ? filteredToolCalls : undefined,
                streamChunks: streamChunks.length > 0 ? streamChunks : undefined,
              };
              try { await addAssistantMessage(authUser.userId, conversationId, finalText, metadata); } catch { }
            }

            const stepsSafe = typeof steps !== 'undefined' ? sanitizeSteps(steps) : steps;
            send(ws, { type: 'final', origin: 'cloud-ai', model: chosenModelId || routedTier, conversationId, result: { text: finalText, steps: stepsSafe, finishReason, usage: normalizedUsage } }, requestId);
            // Derive VM source from verified auth method, not client-controlled context flag
            const isVMChat = authViaVMToken;
            if (authUser && conversationId && conversationCreatedNow) {
              // Only generate title for new conversations
              try {
                const titlePrompt = `You will create a short, descriptive chat thread title from the user's question and the assistant's answer. At most 6 words. No quotes or punctuation.
User: ${prompt}\nAssistant: ${finalText}\n\nTitle:`;
                const titleModelId = getDefaultModelForCategory('fast');
                const titleModel = buildProviderModel(titleModelId);
                const tRes = await generateText({ model: titleModel as any, prompt: titlePrompt, temperature: 0.2 });
                let title = String((tRes as any)?.text || '').trim();
                title = title.replace(/^"+|"+$/g, '').replace(/[\.\!?]+$/g, '').slice(0, 80);
                await setConversationTitle(authUser.userId, conversationId, title);
                // Send title update to client
                send(ws, { type: 'title', conversationId, title }, requestId);
                // Relay title to the other side (VM↔desktop)
                try {
                  const { relayChatEvent } = await import('./services/chat-sync');
                  relayChatEvent(authUser.userId, {
                    type: 'chat_sync',
                    action: 'title_update',
                    conversationId,
                    source: isVMChat ? 'vm' : 'desktop',
                    data: { title },
                    timestamp: new Date().toISOString(),
                  }).catch(() => {});
                } catch { }
              } catch { }
            }
            if (authUser) { try { await logUsageEvent(authUser.userId, conversationId, chosenModelId || routedTier, normalizedUsage); } catch { } try { if (conversationId) await finishRun(authUser.userId, conversationId, finalText || ''); } catch { } }

            // Chat Sync: relay conversation event to the other side (VM↔desktop)
            if (authUser && conversationId) {
              try {
                const { relayChatEvent } = await import('./services/chat-sync');
                relayChatEvent(authUser.userId, {
                  type: 'chat_sync',
                  action: conversationCreatedNow ? 'new_conversation' : 'new_message',
                  conversationId,
                  source: isVMChat ? 'vm' : 'desktop',
                  data: {
                    role: 'assistant',
                    content: finalText,
                    model: chosenModelId || routedTier,
                    metadata: { tier: routedTier, modelId: chosenModelId },
                  },
                  timestamp: new Date().toISOString(),
                }).catch(() => {});
              } catch { }
            }

            // Knowledge Graph Ingestion - extract and store knowledge from conversation
            // Skip for VM chats — the VM agent handles its own knowledge ingestion locally
            if (!isVMChat) try {
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

            // Auto-Skill Generation - analyze conversation for teachable patterns
            try {
              const { analyzeForAutoSkill } = await import('./knowledge');
              const fullHistoryCopy = [...history];
              analyzeForAutoSkill(fullHistoryCopy, conversationId ?? undefined, normalizedUsage?.totalTokens).then((draft) => {
                if (draft) {
                  console.log(`[cloud-ai] Auto-skill created: "${draft.name}" (${draft.steps.length} steps, confidence=${draft.confidence})`);
                  writeLog('auto_skill_generated', { name: draft.name, confidence: draft.confidence, steps: draft.steps.length });
                }
              }).catch((err) => {
                console.error('[cloud-ai] Auto-skill analysis failed:', err);
              });
            } catch (autoSkillErr) {
              console.error('[cloud-ai] Auto-skill import failed:', autoSkillErr);
            }

            // Local Memory Storage - store conversation locally with encryption
            try {
              const localConvId = conversationId || resource;

              // Store the user message locally
              if (prompt) {
                memoryService.storeMessageLocally(localConvId, 'user', prompt).catch((err) => {
                  console.error('[cloud-ai] Failed to store user message locally:', err);
                });
              }

              // Store the assistant response locally
              if (finalText) {
                memoryService.storeMessageLocally(localConvId, 'assistant', finalText).catch((err) => {
                  console.error('[cloud-ai] Failed to store assistant message locally:', err);
                });
              }

              // Process conversation turn (segmentation, embeddings, etc.)
              const fullHistory = [...history];
              memoryService.processConversationTurn(localConvId, fullHistory).catch((err) => {
                console.error('[cloud-ai] Local memory processing failed:', err);
              });
            } catch (memoryErr) {
              console.error('[cloud-ai] Local memory storage import failed:', memoryErr);
            }
          },
        };

        if (agentType !== 'workflow') {
          streamOptions.memory = { resource, thread };
        }

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
                      aggregatedReasoning += reasoningText;
                      send(ws, { type: 'progress', event: 'reasoning', data: { text: reasoningText } }, requestId);
                    }
                    handledChunk = true;
                    break;
                  }

                  case 'reasoning-end':
                  case 'thinking-end': {
                    // Persist accumulated reasoning as a stream chunk
                    if (aggregatedReasoning) {
                      streamChunks.push({ type: 'reasoning', content: aggregatedReasoning });
                    }
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

                    // Track tool call
                    const toolCall = { id: toolCallId, tool: toolName, status: 'called', args: toolArgs, timestamp: Date.now() };
                    toolCallsMap.set(toolCallId, toolCall);
                    streamChunks.push({ type: 'tool', tool: { ...toolCall } });

                    // Only send to UI if not a SIS meta-tool
                    if (!isSISMetaTool(toolName)) {
                      send(ws, { type: 'progress', event: 'tool_event', data: { tool: toolName, status: 'called', toolCallId, args: toolArgs } }, requestId);
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

                    // Update tool call with result
                    const existingCall = toolCallsMap.get(toolCallId);
                    if (existingCall) {
                      existingCall.status = 'completed';
                      existingCall.result = toolResult;
                      // Update in streamChunks
                      for (const sc of streamChunks) {
                        if (sc.type === 'tool' && sc.tool.id === toolCallId) {
                          sc.tool.status = 'completed';
                          sc.tool.result = toolResult;
                          break;
                        }
                      }
                    }

                    // Only send to UI if not a SIS meta-tool
                    if (!isSISMetaTool(toolName)) {
                      send(ws, { type: 'progress', event: 'tool_event', data: { tool: toolName, status: 'completed', toolCallId, result: toolResult } }, requestId);
                    }
                    handledChunk = true;
                    break;
                  }

                  case 'finish': {
                    const text =
                      (chunk as any)?.payload?.text ||
                      (chunk as any)?.payload?.response?.text ||
                      (chunk as any)?.text ||
                      '';
                    if (typeof text === 'string' && text) {
                      sawAnyTextDelta = true;
                      aggregatedText += text;
                      const lastChunk = streamChunks[streamChunks.length - 1];
                      if (lastChunk?.type === 'text') {
                        lastChunk.content += text;
                      } else {
                        streamChunks.push({ type: 'text', content: text });
                      }
                    }
                    handledChunk = true;
                    break;
                  }

                  case 'step-finish':
                  case 'step-start':
                  case 'response-metadata':
                    // Control chunks - don't need to forward to UI
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
                  console.log(`[cloud-ai] Tool called: ${toolCall.name}`, toolCall.args);

                  // Only send to UI if not a SIS meta-tool
                  if (!isSISMetaTool(toolCall.name)) {
                    send(ws, { type: 'progress', event: 'tool_event', data: { tool: toolCall.name, status: 'called', args: toolCall.args } }, requestId);
                  }
                  writeLog('tool_call', { name: toolCall.name });
                }
                const toolResult = (chunk as any)?.toolResult;
                if (toolResult) {
                  sawToolCall = true;
                  console.log(`[cloud-ai] Tool result:`, toolResult);
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
              const toolCallsList = Array.from(toolCallsMap.values()).filter(tc => !isSISMetaTool(tc.tool));
              const metadata = {
                mode: requestedMode, tier: routedTier, modelId: chosenModelId,
                reasoning: aggregatedReasoning || undefined,
                reasoningDuration: reasoningStartTime ? (Date.now() - reasoningStartTime) / 1000 : undefined,
                toolCalls: toolCallsList.length > 0 ? toolCallsList : undefined,
                streamChunks: streamChunks.length > 0 ? streamChunks : undefined,
                finishReason: 'error',
              };
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
        if (abortController?.signal.aborted) {
          console.log('[cloud-ai] Stream aborted by user (loop break)');
          didSendFinal = true;
          try { if (hardTimeout) clearTimeout(hardTimeout); } catch { }
          deleteAbortController(ws, requestId);
          const partialText = aggregatedText ? aggregatedText.trim() : '';

          // Persist partial work even on abort so conversation history isn't lost
          if (authUser && conversationId && partialText) {
            try {
              const toolCallsList = Array.from(toolCallsMap.values()).filter(tc => !isSISMetaTool(tc.tool));
              const metadata = {
                mode: requestedMode, tier: routedTier, modelId: chosenModelId,
                reasoning: aggregatedReasoning || undefined,
                reasoningDuration: reasoningStartTime ? (Date.now() - reasoningStartTime) / 1000 : undefined,
                toolCalls: toolCallsList.length > 0 ? toolCallsList : undefined,
                streamChunks: streamChunks.length > 0 ? streamChunks : undefined,
                finishReason: 'aborted',
              };
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

          if (emptyOutput && agentType === 'workflow' && typeof (agent as any)?.generate === 'function') {
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
          const partialText = aggregatedText ? aggregatedText.trim() : '';

          // Persist partial work on abort
          if (authUser && conversationId && partialText) {
            try {
              const toolCallsList = Array.from(toolCallsMap.values()).filter(tc => !isSISMetaTool(tc.tool));
              const metadata = {
                mode: requestedMode, tier: routedTier, modelId: chosenModelId,
                reasoning: aggregatedReasoning || undefined,
                reasoningDuration: reasoningStartTime ? (Date.now() - reasoningStartTime) / 1000 : undefined,
                toolCalls: toolCallsList.length > 0 ? toolCallsList : undefined,
                streamChunks: streamChunks.length > 0 ? streamChunks : undefined,
                finishReason: 'aborted',
              };
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

          // Persist partial work on tool parse error
          if (authUser && conversationId) {
            try {
              const toolCallsList = Array.from(toolCallsMap.values()).filter(tc => !isSISMetaTool(tc.tool));
              const metadata = {
                mode: requestedMode, tier: routedTier, modelId: chosenModelId,
                reasoning: aggregatedReasoning || undefined,
                reasoningDuration: reasoningStartTime ? (Date.now() - reasoningStartTime) / 1000 : undefined,
                toolCalls: toolCallsList.length > 0 ? toolCallsList : undefined,
                streamChunks: streamChunks.length > 0 ? streamChunks : undefined,
                finishReason: 'error',
              };
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
          return;
        }

        // Persist partial work on generic errors too
        if (authUser && conversationId) {
          try {
            const errorText = aggregatedText ? aggregatedText.trim() : `Error: ${e?.message || String(e)}`;
            const toolCallsList = Array.from(toolCallsMap.values()).filter(tc => !isSISMetaTool(tc.tool));
            const metadata = {
              mode: requestedMode, tier: routedTier, modelId: chosenModelId,
              reasoning: aggregatedReasoning || undefined,
              reasoningDuration: reasoningStartTime ? (Date.now() - reasoningStartTime) / 1000 : undefined,
              toolCalls: toolCallsList.length > 0 ? toolCallsList : undefined,
              streamChunks: streamChunks.length > 0 ? streamChunks : undefined,
              finishReason: 'error',
            };
            await addAssistantMessage(authUser.userId, conversationId, errorText, metadata);
          } catch { }
        }

        send(ws, { type: 'error', message: e?.message || String(e) }, requestId);
      }
    }, secretBag);
    // Don't await - allow parallel processing
  }); // end ws.on('message')
}); // end wss.on('connection')
