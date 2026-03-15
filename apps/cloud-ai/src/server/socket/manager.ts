import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { writeLog } from '../../utils/logger';
import { handleClientToolMessage, withClientBridge } from '../../tools/bridge';
import { getTool } from '../../tools/tool-registry';
import { normalizeMessages } from '../../utils/messages';
import { verifyToken, checkAccess, incrementDailyRequestCounter, createConversation, addUserMessage, addAssistantMessage } from '../../supabase';
import { verifyAccessToken } from '../../auth';
import { registerWebhookClient, deliverQueuedWebhooks } from '../../webhooks/dispatch';
import { runAgent, abortAgent } from '../streaming/agent-runner';
import { PING_INTERVAL_MS } from '../../utils/config';
import { registerConnection, getDesktopWs, type ClientType } from '../../services/vm-bridge';
import { sendVMTerminalCommand } from '../../services/vm-command';
import { verifyVMToken } from '../../services/vm-tokens';

// State maps
const wsAlive = new WeakMap<WebSocket, boolean>();
const wsQueues = new WeakMap<WebSocket, Array<any>>();
const wsIsRunning = new WeakMap<WebSocket, boolean>();

// Configuration
const WS_MAX_PAYLOAD = Number(process.env.CLOUD_WS_MAX_PAYLOAD || 868435456);
const REQUIRE_AUTH = process.env.REQUIRE_AUTH === 'true';

export class SocketManager {
  private wss: WebSocketServer;
  private pingTimer: NodeJS.Timeout;

  constructor() {
    this.wss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_PAYLOAD });

    this.wss.on('connection', this.handleConnection.bind(this));

    // Setup heartbeat
    this.pingTimer = setInterval(() => {
      this.wss.clients.forEach((client: WebSocket) => {
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
    }, PING_INTERVAL_MS);
  }

  public handleUpgrade(req: IncomingMessage, socket: any, head: any) {
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.wss.emit('connection', ws, req);
    });
  }

  public cleanup() {
    clearInterval(this.pingTimer);
  }

  private send(ws: WebSocket, data: unknown) {
    try {
      ws.send(JSON.stringify(data));
    } catch { }
  }

  private handleConnection(ws: WebSocket, req: IncomingMessage) {
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

    this.send(ws, { type: 'handshake', origin: 'cloud-ai', message: 'connected' });
    wsQueues.set(ws, []);
    wsIsRunning.set(ws, false);
    writeLog('ws_connected');
    try { wsAlive.set(ws, true); } catch { }
    try { ws.on('pong', () => { try { wsAlive.set(ws, true); } catch { } }); } catch { }
    try { ws.on('close', () => { writeLog('ws_disconnected'); }); } catch { }

    ws.on('message', async (buf: WebSocket.RawData) => {
      await this.handleMessage(ws, buf);
    });
  }

  private async handleMessage(ws: WebSocket, buf: WebSocket.RawData) {
    let msg: any;
    try {
      msg = JSON.parse(Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf));
    } catch {
      this.send(ws, { type: 'error', message: 'invalid json' });
      return;
    }

    const kind = String(msg?.type || msg?.kind || '').toLowerCase();

    // Bridge passthrough: tool events/results coming from the client
    if (kind === 'tool_event' || kind === 'tool_result') {
      try { handleClientToolMessage(ws, msg); } catch { }
      return;
    }

    // ── User Terminal Messages → forward to VM via HTTP ─────────────────────
    if (kind === 'terminal_open' || kind === 'terminal_data' || kind === 'terminal_resize' || kind === 'terminal_close') {
      try {
        const userId = (ws as any).__userId;
        if (userId) {
          const action = kind.replace('terminal_', '') as 'open' | 'data' | 'resize' | 'close';
          sendVMTerminalCommand(userId, action, msg).catch(() => { });
        }
      } catch { }
      return;
    }

    // Handle stop/abort request
    if (kind === 'stop' || kind === 'abort') {
      const aborted = abortAgent(ws);
      this.send(ws, { type: 'stopped', success: aborted });
      return;
    }

    // Bridged tool execution: run a cloud tool WITH this WS as bridge context
    // so the tool can relay tool_request messages back to the client
    if (kind === 'exec_tool_bridged') {
      this.handleBridgedToolExec(ws, msg);
      return;
    }

    // Handle explicit auth message: client sends {type:'auth', accessToken:'...'} to register
    // for webhook delivery (Gmail Pub/Sub, Drive triggers, etc.) without needing to send a chat.
    if (kind === 'auth') {
      const token = String(msg?.accessToken || '').trim();
      if (!token) {
        this.send(ws, { type: 'auth_result', ok: false, error: 'missing_token' });
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
          this.send(ws, { type: 'auth_result', ok: true, queued: delivered });
          writeLog('ws_auth_message', { userId: authResult.userId, delivered });
        } else {
          this.send(ws, { type: 'auth_result', ok: false, error: 'invalid_token' });
        }
      } catch (e: any) {
        this.send(ws, { type: 'auth_result', ok: false, error: String(e?.message || 'auth_failed') });
      }
      return;
    }

    if (kind !== 'chat') {
      this.send(ws, { type: 'error', message: `unknown type: ${kind}` });
      return;
    }

    // Queue logic
    try {
      const runningNow = wsIsRunning.get(ws) === true;
      if (runningNow) {
        const q = wsQueues.get(ws) || [];
        q.push(msg);
        wsQueues.set(ws, q);
        const messageText = String(msg?.text || '').slice(0, 120);
        const messageId = `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        this.send(ws, { type: 'queued', position: q.length, text: messageText, id: messageId });
        return;
      }
    } catch { }

    // Auth & Processing
    const messages = normalizeMessages(msg);
    if (messages.length === 0) {
      this.send(ws, { type: 'error', message: 'empty prompt' });
      return;
    }

    try {
      const accessToken = String(msg?.auth?.accessToken || '');
      const authUser = accessToken ? await verifyToken(accessToken) : null;

      if (REQUIRE_AUTH && !authUser) {
        this.send(ws, { type: 'error', message: 'unauthorized' });
        return;
      }

      if (authUser) {
        // Register connection for VM ↔ Desktop relay
        const clientType = (ws as any).__clientType as string | undefined;
        if (clientType === 'desktop' || clientType === 'vm-agent') {
          registerConnection(ws, authUser.userId, clientType as ClientType);
        }

        const access = await checkAccess(authUser.userId);
        if (!access.allowed) {
          this.send(ws, { type: 'error', message: access.reason || 'access_denied', data: { plan: access.plan, limit: access.limit, used: access.used } });
          return;
        }
        try { await incrementDailyRequestCounter(authUser.userId); } catch { }
      }

      wsIsRunning.set(ws, true);

      // Determine agent configuration from message
      const userText = msg.text || (messages[messages.length - 1] as any).content || '';
      const normalizeTier = (v: any) => {
        const s = String(v || '').toLowerCase().trim();
        if (s === 'deep') return 'smart';
        if (s === 'smart') return 'smart';
        if (s === 'fast') return 'fast';
        if (s === 'balanced') return 'balanced';
        if (s === 'auto') return 'auto';
        return 'balanced';
      };
      const modelName = normalizeTier(msg.model || 'balanced');
      const modelId = typeof msg?.modelId === 'string' ? String(msg.modelId).trim() : '';
      const chosenModelId = modelId || undefined;
      let conversationId = msg.conversationId || null;
      const userId = authUser?.userId || null;

      // SMS-originated chats must always persist regardless of sync_conversations pref
      const hiddenCtx = String(msg.hiddenContext || '');
      const isSmsChat = hiddenCtx.includes('[SMS MODE]') || hiddenCtx.includes('[PROACTIVE FOLLOW-UP]');
      const forcePersist = isSmsChat;

      // Create or continue conversation
      if (userId) {
        if (!conversationId) {
          // New conversation
          conversationId = await createConversation(userId, userText, modelName, {
            mode: modelName,
            tier: modelName === 'auto' ? undefined : modelName,
            modelId: chosenModelId,
          }, 'stuard', forcePersist);
          if (conversationId) {
            this.send(ws, { type: 'conversation', conversationId });
          }
        } else {
          // Continuing conversation - store user message
          await addUserMessage(userId, conversationId, userText, {
            mode: modelName,
            tier: modelName === 'auto' ? undefined : modelName,
            modelId: chosenModelId,
          }, forcePersist);
        }
      }

      const agentConfig = {
        text: userText,
        agent: msg.agent, // 'stuard' or 'workflow'
        model: modelName,
        modelId: chosenModelId,
        modelConfig: (msg?.modelConfig && typeof msg.modelConfig === 'object') ? msg.modelConfig : undefined,
        reasoningLevel: typeof msg?.reasoningLevel === 'string' ? msg.reasoningLevel : undefined,
        integrations: msg.integrations,
        history: messages.slice(0, -1),
        userId,
        conversationId,
        context: {
          ...(msg.context || {}),
          // Pass through hiddenContext (e.g. SMS formatting instructions)
          ...(msg.hiddenContext ? { hiddenContext: String(msg.hiddenContext) } : {}),
        },
      };

      try {
        // Route VM-triggered agents through the user's desktop bridge
        const isVmAgent = (ws as any).__clientType === 'vm-agent';
        let result: { text: string } | null;

        if (isVmAgent && userId) {
          const desktopWs = getDesktopWs(userId);
          if (!desktopWs) {
            this.send(ws, {
              type: 'error',
              message: 'desktop_offline',
              detail: 'Stuard desktop app must be running for device tools.',
            });
            wsIsRunning.set(ws, false);
            this.processNextInQueue(ws);
            return;
          }
          result = await runAgent(ws, agentConfig as any, desktopWs);
        } else {
          result = await runAgent(ws, agentConfig as any);
        }

        // Store assistant response
        if (userId && conversationId && result?.text) {
          await addAssistantMessage(userId, conversationId, result.text, {
            mode: modelName,
            tier: modelName === 'auto' ? undefined : modelName,
            modelId: chosenModelId,
          }, forcePersist);
        }
      } finally {
        try { wsIsRunning.set(ws, false); } catch { }
        this.processNextInQueue(ws);
      }

    } catch (e: any) {
      this.send(ws, { type: 'error', message: e?.message || String(e) });
    }
  }

  /**
   * Handle bridged tool execution: run a cloud tool WITH this WS as bridge context.
   * This allows agent_node (and other agent tools) to relay tool_request messages
   * back to the desktop client for local tool execution (send_hotkey, run_command, etc.).
   */
  private async handleBridgedToolExec(ws: WebSocket, msg: any) {
    const reqId = String(msg?.id || `btool-${Date.now()}`);
    const toolName = String(msg?.tool || '').trim();
    const toolArgs = msg?.args || {};
    const accessToken = String(msg?.auth?.accessToken || '').trim();

    if (!toolName) {
      this.send(ws, { type: 'exec_tool_bridged_result', id: reqId, result: { ok: false, error: 'missing_tool_name' } });
      return;
    }

    // Auth check
    if (REQUIRE_AUTH && accessToken) {
      try {
        const authed = await verifyToken(accessToken);
        if (!authed) {
          this.send(ws, { type: 'exec_tool_bridged_result', id: reqId, result: { ok: false, error: 'unauthorized' } });
          return;
        }
      } catch {
        this.send(ws, { type: 'exec_tool_bridged_result', id: reqId, result: { ok: false, error: 'auth_failed' } });
        return;
      }
    }

    const tool = getTool(toolName);
    if (!tool || typeof tool.execute !== 'function') {
      this.send(ws, { type: 'exec_tool_bridged_result', id: reqId, result: { ok: false, error: `tool_not_found: ${toolName}` } });
      return;
    }

    writeLog(`bridged_tool_exec_start: ${toolName}`);

    try {
      // Run the tool with the WS as bridge context so execLocalTool works
      const secrets = accessToken ? { accessToken } : {};
      const result = await withClientBridge(ws, async () => {
        return await tool.execute!(toolArgs as any, {} as any);
      }, secrets);

      writeLog(`bridged_tool_exec_done: ${toolName}`);
      this.send(ws, { type: 'exec_tool_bridged_result', id: reqId, result });
    } catch (e: any) {
      writeLog(`bridged_tool_exec_error: ${toolName}: ${e?.message || e}`);
      this.send(ws, { type: 'exec_tool_bridged_result', id: reqId, result: { ok: false, error: e?.message || 'execution_failed' } });
    }
  }

  private processNextInQueue(ws: WebSocket) {
    try {
      const q = wsQueues.get(ws) || [];
      const next = q.shift();
      wsQueues.set(ws, q);
      if (next) {
        setImmediate(() => {
          try { ws.emit('message', Buffer.from(JSON.stringify(next)), false); } catch { }
        });
      }
    } catch { }
  }
}
