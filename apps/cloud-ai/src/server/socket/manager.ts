import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { writeLog } from '../../utils/logger';
import { handleClientToolMessage, withClientBridge } from '../../tools/bridge';
import { getTool } from '../../tools/tool-registry';
import { normalizeMessages } from '../../utils/messages';
import { verifyToken, checkAccess, incrementDailyRequestCounter, createConversation, addUserMessage, addAssistantMessage } from '../../supabase';
import { runAgent, abortAgent } from '../streaming/agent-runner';
import { PING_INTERVAL_MS } from '../../utils/config';
import { registerConnection, getDesktopWs, type ClientType } from '../../services/vm-bridge';
import { sendVMTerminalCommand } from '../../services/vm-command';
import { verifyVMToken } from '../../services/vm-tokens';
import { enqueueInterjection } from './state';
import { enqueueSubagentSteer, isSubagentRunning } from '../../orchestrator/subagent-runtime';

// State maps
const wsAlive = new WeakMap<WebSocket, boolean>();
const wsQueues = new WeakMap<WebSocket, Array<any>>();
const wsIsRunning = new WeakMap<WebSocket, boolean>();
// Per-request tracking for parallel tab execution
const wsRunningRequests = new WeakMap<WebSocket, Set<string>>();

function getRunningRequests(ws: WebSocket): Set<string> {
  let s = wsRunningRequests.get(ws);
  if (!s) { s = new Set(); wsRunningRequests.set(ws, s); }
  return s;
}

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
    } catch {}

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
          sendVMTerminalCommand(userId, action, msg).catch(() => {});
        }
      } catch { }
      return;
    }

    // Handle stop/abort request
    if (kind === 'stop' || kind === 'abort') {
      const stopRequestId = msg?.requestId || undefined;
      const aborted = abortAgent(ws, stopRequestId);
      this.send(ws, { type: 'stopped', success: aborted, requestId: stopRequestId });
      return;
    }

    // Bridged tool execution: run a cloud tool WITH this WS as bridge context
    // so the tool can relay tool_request messages back to the client
    if (kind === 'exec_tool_bridged') {
      this.handleBridgedToolExec(ws, msg);
      return;
    }

    if (kind === 'interjection' || kind === 'steer') {
      const steerRequestId = typeof msg?.requestId === 'string' ? msg.requestId : undefined;
      const text = typeof msg?.text === 'string' ? msg.text : '';
      const depth = enqueueInterjection(ws, steerRequestId, text);
      this.send(ws, {
        type: 'interjection_ack',
        accepted: depth > 0,
        depth,
        message: depth > 0 ? 'queued for next step' : 'empty interjection',
        requestId: steerRequestId,
      });
      return;
    }

    if (kind === 'subagent_steer') {
      const subagentId = typeof msg?.subagentId === 'string' ? msg.subagentId.trim() : '';
      const text = typeof msg?.text === 'string' ? msg.text : '';
      const requestId = typeof msg?.requestId === 'string' ? msg.requestId : undefined;
      const subagentAlive = subagentId ? isSubagentRunning(subagentId) : false;
      const depth = subagentId && subagentAlive ? enqueueSubagentSteer(subagentId, text) : 0;
      let ackMessage: string;
      if (!subagentId) ackMessage = 'subagentId required';
      else if (!subagentAlive) ackMessage = 'subagent_not_running';
      else if (depth === 0) ackMessage = 'empty steer';
      else ackMessage = 'queued for next subagent step';
      this.send(ws, {
        type: 'subagent_steer_ack',
        subagentId,
        accepted: depth > 0,
        depth,
        message: ackMessage,
        requestId,
      });
      return;
    }

    if (kind !== 'chat') {
      this.send(ws, { type: 'error', message: `unknown type: ${kind}` });
      return;
    }

    // Queue logic — allow parallel requests from different tabs/conversations.
    // Only queue if the SAME conversationId already has a running request.
    const requestId = String(msg?.requestId || `sr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    const convId = String(msg?.conversationId || '');
    try {
      const running = getRunningRequests(ws);
      // Queue only when the same conversation is already processing
      if (convId && running.has(convId)) {
        const q = wsQueues.get(ws) || [];
        q.push(msg);
        wsQueues.set(ws, q);
        const messageText = String(msg?.text || '').slice(0, 120);
        const messageId = `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        this.send(ws, { type: 'queued', position: q.length, text: messageText, id: messageId, requestId });
        return;
      }
    } catch { }

    // Scoped send that tags every message with requestId for client-side tab routing
    const sendTagged = (data: unknown) => {
      try {
        const payload = typeof data === 'object' && data !== null ? { ...(data as any), requestId } : data;
        ws.send(JSON.stringify(payload));
      } catch { }
    };

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
          this.send(ws, { type: 'error', message: access.reason || 'access_denied', data: { plan: access.plan, limit: access.limit, used: access.used, remaining: access.remaining } });
          return;
        }
        try { await incrementDailyRequestCounter(authUser.userId); } catch { }
      }

      wsIsRunning.set(ws, true);
      if (convId) getRunningRequests(ws).add(convId);
      
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
      const forcePersist = !!msg.forcePersist;
      let conversationId = msg.conversationId || null;
      const userId = authUser?.userId || null;

      // Create or continue conversation
      if (userId) {
        if (!conversationId) {
          // New conversation
          conversationId = await createConversation(userId, userText, modelName, {
            mode: modelName,
            tier: modelName === 'auto' ? undefined : modelName,
            modelId: chosenModelId,
            modelSource: typeof msg?.modelSource === 'string' ? String(msg.modelSource).trim() : undefined,
          }, 'stuard', forcePersist);
          if (conversationId) {
            sendTagged({ type: 'conversation', conversationId });
          }
        } else {
          // Continuing conversation - store user message
          await addUserMessage(userId, conversationId, userText, {
            mode: modelName,
            tier: modelName === 'auto' ? undefined : modelName,
            modelId: chosenModelId,
            modelSource: typeof msg?.modelSource === 'string' ? String(msg.modelSource).trim() : undefined,
          }, forcePersist);
        }
      }

      const agentConfig = {
        text: userText,
        agent: msg.agent, // 'stuard' or 'workflow'
        model: modelName,
        modelId: chosenModelId,
        modelSource: typeof msg?.modelSource === 'string' ? String(msg.modelSource).trim() : undefined,
        modelConfig: (msg?.modelConfig && typeof msg.modelConfig === 'object') ? msg.modelConfig : undefined,
        reasoningLevel: typeof msg?.reasoningLevel === 'string' ? msg.reasoningLevel : undefined,
        integrations: msg.integrations,
        history: messages.slice(0, -1),
        userId,
        conversationId,
        context: msg.context || {}
      };

      try {
        // Route VM-triggered agents through the user's desktop bridge
        const isVmAgent = (ws as any).__clientType === 'vm-agent';
        let result: { text: string } | null;

        if (isVmAgent && userId) {
          const desktopWs = getDesktopWs(userId);
          if (!desktopWs) {
            sendTagged({
              type: 'error',
              message: 'desktop_offline',
              detail: 'Stuard desktop app must be running for device tools.',
            });
            wsIsRunning.set(ws, false);
            if (convId) getRunningRequests(ws).delete(convId);
            this.processNextInQueue(ws);
            return;
          }
          result = await runAgent(ws, agentConfig as any, desktopWs, requestId);
        } else {
          result = await runAgent(ws, agentConfig as any, undefined, requestId);
        }

        // Store assistant response
        if (userId && conversationId && result?.text) {
          await addAssistantMessage(userId, conversationId, result.text, {
            mode: modelName,
            tier: modelName === 'auto' ? undefined : modelName,
            modelId: chosenModelId,
            modelSource: typeof msg?.modelSource === 'string' ? String(msg.modelSource).trim() : undefined,
          }, forcePersist);
        }
      } finally {
        try { wsIsRunning.set(ws, false); } catch { }
        try { if (convId) getRunningRequests(ws).delete(convId); } catch { }
        this.processNextInQueue(ws);
      }

    } catch (e: any) {
      sendTagged({ type: 'error', message: e?.message || String(e) });
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
