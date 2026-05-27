/**
 * VM Agent — HTTP Server
 *
 * Full-featured Node.js HTTP service installed on each VM.
 * Provides headless desktop-equivalent functionality including:
 * - Agent chat & task execution via Python agent WS proxy
 * - Persistent memory storage with search
 * - Proactive scheduling and task management
 * - Workflow deployment and execution
 * - Terminal PTY sessions
 * - Desktop bridge for user PC tools
 *
 * Endpoints:
 *   GET  /health              — liveness probe
 *   POST /command             — execute a command (file ops, deploy, shell, snapshot)
 *   POST /agent/chat          — send chat message to agent (proxied to Python agent)
 *   POST /agent/execute       — execute headless agent task
 *   POST /terminal/open       — open a PTY session
 *   POST /terminal/data       — write to PTY
 *   POST /terminal/resize     — resize PTY
 *   POST /terminal/close      — close PTY
 *   POST /terminal/read       — poll PTY output buffer
 *   GET  /metrics             — system metrics
 *   POST /memory/*            — memory CRUD, search, sync
 *   POST /proactive/*         — proactive task management
 *   POST /sync/upload         — compress workspace → upload to GCS
 *   POST /sync/download       — download from GCS → extract to workspace
 */

import http from 'http';
import { randomUUID, randomBytes } from 'crypto';
import { createHmac, timingSafeEqual } from 'crypto';
import fs from 'fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { WebSocketServer, WebSocket } from 'ws';
import Database from 'better-sqlite3';
import { collectMetrics, initMetrics } from './metrics-collector';
import { ShellExecutor } from './shell-executor';
import { DeployExecutor } from './deploy-executor';
import { getVMMemoryStore, type MemoryEntry } from './vm-memory';
import { getVMProactiveScheduler } from './vm-proactive';
import { getVMBotScheduler, type VMBot } from './vm-bots';
import { handleVMBotMemoryCommand } from './vm-bot-memory';
import { saveSkills as saveVMSkills, loadSkills as loadVMSkills, getStats as getVMSkillsStats, type Skill as VMSkill } from './vm-skills';
import * as fileManager from './file-manager';
import { getAgentWs, sendToAgent, sendToAgentStreaming, buildVMMemoryContext, isAgentWsConnected, closeAgentWs, LOCAL_AGENT_WS_URL } from './vm-agent-ws';

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.STUARD_AGENT_PORT || 7400);
const VM_TOKEN = process.env.STUARD_VM_TOKEN || '';
const USER_ID = process.env.STUARD_USER_ID || '';
const AGENT_VERSION = '3.0.0';

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

const shellExecutor = new ShellExecutor();
const deployExecutor = new DeployExecutor();
// Python agent WS communication is shared via vm-agent-ws.ts
// (sendToAgent, getAgentWs, buildVMMemoryContext are imported above)

const AGENT_DATA_SYNC_IDLE_GRACE_MS = 10_000;
let _activeAgentOperations = 0;
let _lastAgentOperationEndedAt = 0;
let _deferredAgentDataDownloadArgs: any | null = null;
let _deferredAgentDataDownloadTimer: ReturnType<typeof setTimeout> | null = null;

function beginAgentOperation(): void {
  _activeAgentOperations++;
}

function endAgentOperation(): void {
  _activeAgentOperations = Math.max(0, _activeAgentOperations - 1);
  if (_activeAgentOperations === 0) {
    _lastAgentOperationEndedAt = Date.now();
    scheduleDeferredAgentDataDownloadIfIdle();
  }
}

function agentDataSyncDelayMs(): number {
  if (_activeAgentOperations > 0) return AGENT_DATA_SYNC_IDLE_GRACE_MS;
  if (!_lastAgentOperationEndedAt) return 0;
  return Math.max(0, AGENT_DATA_SYNC_IDLE_GRACE_MS - (Date.now() - _lastAgentOperationEndedAt));
}

function deferAgentDataDownload(args: any, reason: string): any {
  const mode = String(args?.mode || 'full').toLowerCase() === 'delta' ? 'delta' : 'full';
  _deferredAgentDataDownloadArgs = { ...(args || {}), direction: 'download', mode };
  scheduleDeferredAgentDataDownloadIfIdle();
  return { ok: true, direction: 'download', mode, deferred: true, reason };
}

function scheduleDeferredAgentDataDownloadIfIdle(): void {
  if (!_deferredAgentDataDownloadArgs || _deferredAgentDataDownloadTimer) return;
  const delay = Math.max(1_000, agentDataSyncDelayMs());
  _deferredAgentDataDownloadTimer = setTimeout(() => {
    _deferredAgentDataDownloadTimer = null;
    if (!_deferredAgentDataDownloadArgs) return;

    const waitMs = agentDataSyncDelayMs();
    if (waitMs > 0) {
      scheduleDeferredAgentDataDownloadIfIdle();
      return;
    }

    const args = _deferredAgentDataDownloadArgs;
    _deferredAgentDataDownloadArgs = null;
    syncAgentData(args)
      .then((result) => {
        if (result?.ok) console.log('[vm-agent] Deferred agent data download complete');
        else console.warn('[vm-agent] Deferred agent data download failed:', result?.error || 'unknown');
      })
      .catch((e: any) => {
        console.warn('[vm-agent] Deferred agent data download errored:', e?.message || e);
      });
  }, delay);
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth — verify HMAC bearer token on each request
//
// Each VM has its own unique secret (VM_TOKEN_SECRET env), generated at
// provisioning and injected via the startup script. Cloud-ai looks up
// this per-VM secret from the database and signs short-lived HMAC tokens.
//
// Compromising one VM's secret cannot forge tokens for any other VM.
// ─────────────────────────────────────────────────────────────────────────────

/** The per-VM HMAC secret (set at provisioning, unique to this VM). */
const VM_SECRET = process.env.VM_TOKEN_SECRET || '';

function verifyBearerToken(authHeader: string | undefined): boolean {
  // Dev mode — no secret configured, accept all requests
  if (!VM_SECRET && !VM_TOKEN) return true;

  const token = (authHeader || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return false;

  // 1. Accept exact match against the provisioned token (backwards compat for startup ping)
  if (VM_TOKEN && token === VM_TOKEN) return true;

  // 2. Verify HMAC-signed token from cloud-ai (format: base64url(payload).base64url(hmac))
  if (!VM_SECRET) return false;

  try {
    const dotIdx = token.indexOf('.');
    if (dotIdx < 1) return false;

    const encodedPayload = token.slice(0, dotIdx);
    const signature = token.slice(dotIdx + 1);

    // Decode and validate payload
    const raw = Buffer.from(encodedPayload, 'base64url').toString('utf-8');
    const payload = JSON.parse(raw) as { userId?: string; exp?: number; iat?: number; nonce?: string };

    // Verify it's for this user OR a system-level caller (e.g. health monitor)
    const SYSTEM_CALLERS = new Set(['cloud-ai-monitor', 'cloud-ai-system']);
    if (payload.userId !== USER_ID && !SYSTEM_CALLERS.has(payload.userId || '')) return false;

    // Check expiry (tokens are 5 min max)
    if (payload.exp && payload.exp < Date.now()) return false;

    // Verify HMAC signature using this VM's unique secret
    const expectedSig = createHmac('sha256', VM_SECRET).update(encodedPayload).digest('base64url');
    const sigBuf = Buffer.from(signature, 'base64url');
    const expectedBuf = Buffer.from(expectedSig, 'base64url');
    if (sigBuf.length !== expectedBuf.length) return false;
    return timingSafeEqual(sigBuf, expectedBuf);
  } catch {
    return false;
  }
}

/**
 * Mint a short-lived HMAC token so the Python agent can authenticate
 * with cloud-ai on behalf of this VM's user. Self-contained to avoid
 * pulling in vm-tokens.ts (and its transitive deps) into the bundle.
 */
function mintLocalVMToken(secret: string, userId: string): string {
  const payload = JSON.stringify({
    userId,
    instanceName: 'vm-chat',
    nonce: randomBytes(8).toString('hex'),
    iat: Date.now(),
    exp: Date.now() + 300_000, // 5 minutes
  });
  const encoded = Buffer.from(payload).toString('base64url');
  const sig = createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function authHeaderFromRequest(req: http.IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (header) return header;
  try {
    const parsed = new URL(req.url || '/', 'http://localhost');
    const token = parsed.searchParams.get('token');
    return token ? `Bearer ${token}` : undefined;
  } catch {
    return undefined;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP Helpers
// ─────────────────────────────────────────────────────────────────────────────

function json(res: http.ServerResponse, status: number, body: any): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readBody(req: http.IncomingMessage, maxBytes = 10 * 1024 * 1024): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) { reject(new Error('body_too_large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch { reject(new Error('invalid_json')); }
    });
    req.on('error', reject);
  });
}

async function uploadArchive(uploadUrl: string, archivePath: string): Promise<void> {
  const stats = fs.statSync(archivePath);
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(stats.size),
    },
    body: fs.createReadStream(archivePath) as any,
    duplex: 'half' as any,
  });
  if (!response.ok) {
    throw new Error(`gcs_upload_http_${response.status}`);
  }
}

async function downloadArchive(downloadUrl: string, outputPath: string): Promise<number> {
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`gcs_download_http_${response.status}`);
  }
  if (!response.body) {
    throw new Error('gcs_download_empty_body');
  }
  await pipeline(Readable.fromWeb(response.body as any), fs.createWriteStream(outputPath));
  return fs.statSync(outputPath).size;
}

// ─────────────────────────────────────────────────────────────────────────────
// Command Dispatch
// ─────────────────────────────────────────────────────────────────────────────

async function handleCommand(command: string, args: any): Promise<any> {
  switch (command) {
    case 'file_list':
      return await fileManager.listDirectory(args.path || '.');
    case 'file_read':
      return await fileManager.readFile(args.path);
    case 'file_write':
      await fileManager.writeFile(args.path, args.content, args.encoding);
      return { success: true };
    case 'file_delete':
      await fileManager.deleteFile(args.path);
      return { success: true };
    case 'file_rename':
      await fileManager.renameFile(args.oldPath, args.newPath);
      return { success: true };
    case 'file_mkdir':
      await fileManager.mkdirFile(args.path);
      return { success: true };
    case 'file_stat':
      return await fileManager.statFile(args.path);
    case 'metrics':
      return collectMetrics();
    case 'snapshot_create':
      return await createSnapshotArchive(args.path || '/home/stuard');
    case 'snapshot_restore':
      return await restoreSnapshotArchive(args.url, args.path || '/home/stuard');
    case 'ping':
      return { pong: true, timestamp: Date.now(), agentVersion: AGENT_VERSION };

    // ── Deploy Commands ──────────────────────────────────────────────────
    case 'deploy_start':
      return await deployExecutor.start({
        deployId: args.deployId,
        downloadUrl: args.downloadUrl,
        kind: args.kind || 'workflow',
        name: args.name || 'unnamed',
        envVars: args.envVars || {},
        autoRestart: args.autoRestart ?? true,
        schedule: args.schedule || null,
        sourceWorkflowId: args.sourceWorkflowId || null,
        triggerBindings: Array.isArray(args.triggerBindings) ? args.triggerBindings : [],
        inlineBundle: args.inlineBundle || undefined,
      });
    case 'deploy_stop':
      return { stopped: deployExecutor.stop(args.deployId) };
    case 'deploy_cleanup':
      return { cleaned: deployExecutor.cleanup(args.deployId) };
    case 'deploy_trigger':
      return await deployExecutor.trigger(
        args.deployId,
        typeof args.triggerId === 'string' ? args.triggerId : undefined,
        args.payload,
        String(args.source || 'external')
      );
    case 'deploy_logs':
      return { logs: deployExecutor.getLogs(args.deployId, args.lines || 200) };
    case 'deploy_list':
      return { deploys: deployExecutor.list() };

    // ── Agent Chat & Execute ────────────────────────────────────────────
    case 'agent_chat':
      return await handleAgentChat(args);
    case 'agent_execute':
      return await handleAgentExecute(args);

    // ── Memory Commands ─────────────────────────────────────────────────
    case 'memory_add':
      return handleMemoryAdd(args);
    case 'memory_get':
      return handleMemoryGet(args);
    case 'memory_update':
      return handleMemoryUpdate(args);
    case 'memory_delete':
      return handleMemoryDelete(args);
    case 'memory_list':
      return handleMemoryList(args);
    case 'memory_search':
      return handleMemorySearch(args);
    case 'memory_topics':
      return handleMemoryTopics();
    case 'memory_stats':
      return handleMemoryStats();
    case 'memory_export':
      return handleMemoryExport();
    case 'memory_import':
      return handleMemoryImport(args);
    case 'memory_preferences_get':
      return handleMemoryPreferencesGet(args);
    case 'memory_preferences_set':
      return handleMemoryPreferencesSet(args);
    case 'memory_conversations_list':
      return handleMemoryConversationsList(args);
    case 'memory_conversations_add':
      return handleMemoryConversationsAdd(args);
    case 'memory_conversations_update':
      return handleMemoryConversationsUpdate(args);
    case 'memory_messages_list':
      return handleMemoryMessagesList(args);

    case 'tool_result': {
      const toolId = String(args.id || '').trim();
      if (!toolId) return { ok: false, error: 'missing tool id' };
      try {
        const ws = await getAgentWs();
        ws.send(JSON.stringify({ type: 'tool_result', id: toolId, result: args.result }));
        return { ok: true };
      } catch {
        return { ok: false, error: 'agent_ws_not_connected' };
      }
    }

    // ── Proactive Commands ──────────────────────────────────────────────
    case 'proactive_status':
      return handleProactiveStatus();
    case 'proactive_config':
      return handleProactiveConfig(args);
    case 'proactive_wakeup':
      return await handleProactiveWakeup();
    case 'proactive_tasks':
      return handleProactiveTasks(args);
    case 'proactive_task_add':
      return handleProactiveTaskAdd(args);
    case 'proactive_task_update':
      return handleProactiveTaskUpdate(args);
    case 'proactive_task_delete':
      return handleProactiveTaskDelete(args);

    // ── Agent Commands (multi-agent scheduler; legacy bots_* aliases kept) ─
    case 'agents_status':
    case 'bots_status':
      return handleBotsStatus();
    case 'agents_sync':
    case 'bots_sync':
      return handleBotsSync(args);
    case 'set_user_timezone':
      return handleSetUserTimezone(args);
    case 'get_user_timezone':
      return handleGetUserTimezone();
    case 'agents_run':
    case 'bots_run':
      return await handleBotsRun(args);
    case 'agents_list':
    case 'bots_list':
      return handleBotsList();
    case 'agents_delete':
    case 'bots_delete':
      return handleBotsDelete(args);
    case 'agent_memory_list':
    case 'agent_memory_create':
    case 'agent_memory_update':
    case 'agent_memory_delete':
    case 'agent_memory_log':
    case 'agent_memory_export':
    case 'agent_memory_replace':
    case 'agent_memory_merge':
    case 'bot_memory_list':
    case 'bot_memory_create':
    case 'bot_memory_update':
    case 'bot_memory_delete':
    case 'bot_memory_log':
    case 'bot_memory_export':
    case 'bot_memory_replace':
    case 'bot_memory_merge':
      return handleVMBotMemoryCommand(command, args);

    // ── Skills Sync (desktop is source of truth) ─────────────────────
    case 'skills_sync':
      return handleSkillsSync(args);
    case 'skills_status':
      return handleSkillsStatus();

    // ── Tool Execution (proxy to Python agent) ─────────────────────────
    case 'tool_exec':
      return await handleToolExec(args);

    // ── Database Sync ────────────────────────────────────────────────────
    case 'sync_agent_data': {
      const direction = String(args?.direction || 'upload').toLowerCase();
      const waitMs = agentDataSyncDelayMs();
      if (direction === 'download' && waitMs > 0) {
        return deferAgentDataDownload(args, _activeAgentOperations > 0 ? 'agent_busy' : 'agent_recently_active');
      }
      return await syncAgentData(args);
    }

    // ── OAuth Token Storage ──────────────────────────────────────────────
    case 'store_oauth_tokens':
      return storeOAuthTokens(args);
    case 'remove_oauth_tokens':
      return removeOAuthTokens(args);
    case 'get_oauth_token':
      return getOAuthToken(args);
    case 'oauth_list':
      return listOAuthTokensSafe();

    // ── Chat Sync (desktop→VM) ──────────────────────────────────────────
    case 'chat_sync':
      return handleChatSync(args);

    // ── Browser Profile Sync (desktop→VM) ────────────────────────────────
    case 'sync_browser_profile':
      return syncBrowserProfile(args);

    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent Chat & Execute Handlers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load prior turns for this conversation from the VM's local SQLite so cloud-ai
 * has the full multi-turn context. Without this, every chat request would arrive
 * at cloud-ai with only the new user message and the model would have no memory
 * of prior turns in the same conversation.
 */
async function loadLocalConversationHistory(
  conversationId: string,
  limit = 50,
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  try {
    const result = await sendToAgent({
      type: 'tool_exec',
      tool: 'message_list',
      args: { conversation_id: conversationId, limit },
    }, 5_000);
    const rows: any[] = result?.messages || result?.result?.messages || result?.result || [];
    if (!Array.isArray(rows)) return [];
    return rows
      .filter((m: any) => m && typeof m.content === 'string' && (m.role === 'user' || m.role === 'assistant'))
      .map((m: any) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
  } catch {
    return [];
  }
}

async function handleAgentChat(args: any): Promise<any> {
  const message = String(args.message || '').trim();
  if (!message) return { ok: false, error: 'empty_message' };

  const conversationId = args.conversationId || randomUUID();
  const model = args.model || 'balanced';

  beginAgentOperation();
  try {
    // Load history BEFORE storing the new user message so the prior-turn array
    // doesn't accidentally include the current message.
    const [memoryContext, priorHistory] = await Promise.all([
      buildVMMemoryContext(args.memoryQuery || message, args.queryEmbedding),
      loadLocalConversationHistory(conversationId, 50),
    ]);

    // Store user message in local DB (mirrors desktop's storeMessageLocally)
    sendToAgent({
      type: 'tool_exec',
      tool: 'message_add',
      args: { conversation_id: conversationId, role: 'user', content: message },
    }, 10_000).catch(() => {});

    // Forward chat to Python agent via WebSocket
    // Include a signed HMAC token so the Python agent can authenticate
    // with cloud-ai on behalf of this VM's user (enables integration tools)
    const vmAuth = VM_SECRET && USER_ID
      ? { vmToken: mintLocalVMToken(VM_SECRET, USER_ID), userId: USER_ID }
      : undefined;

    const messagesForCloud = [
      ...priorHistory,
      { role: 'user' as const, content: message },
    ];

    const result = await sendToAgent({
      type: 'chat',
      message,
      conversationId,
      model,
      messages: messagesForCloud,
      context: {
        isVM: true,
        userId: USER_ID,
        ...(args.context || {}),
      },
      memoryContext,
      ...(vmAuth ? { auth: vmAuth } : {}),
    }, 180_000); // 3 min timeout for chat

    // Store assistant response and process turn (mirrors desktop's post-response flow).
    // Cloud-ai's final WS frame is { type:'final', result:{ text, ... } }, which the
    // Python agent forwards verbatim — so the assistant text lives at result.result.text.
    const assistantText = String(result?.result?.text ?? result?.text ?? '').trim();
    if (assistantText) {
      processVMConversationTurn(conversationId, message, assistantText).catch((e) => {
        console.warn('[vm-agent] post-response memory processing failed:', e?.message);
      });
    }

    return { ok: true, conversationId, ...result };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'agent_chat_failed') };
  } finally {
    endAgentOperation();
  }
}

/**
 * Streaming variant of handleAgentChat — writes NDJSON lines to the HTTP response
 * as Python agent WS events arrive (progress, delta, reasoning, tool_event, final).
 */
async function handleAgentChatStream(args: any, res: import('http').ServerResponse): Promise<void> {
  const message = String(args.message || '').trim();
  if (!message) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'empty_message' }));
    return;
  }

  const conversationId = args.conversationId || randomUUID();
  const model = args.model || 'balanced';
  const modelId = typeof args.modelId === 'string' && args.modelId.trim() ? args.modelId.trim() : undefined;
  beginAgentOperation();

  // Set up NDJSON streaming response
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Content-Type-Options': 'nosniff',
  });

  const writeLine = (obj: any) => {
    try { if (!res.destroyed) res.write(JSON.stringify(obj) + '\n'); } catch {}
  };

  writeLine({ type: 'start', conversationId });

  try {
    // Load history BEFORE storing the new user message so the prior-turn array
    // doesn't accidentally include the current message.
    const [memoryContext, priorHistory] = await Promise.all([
      buildVMMemoryContext(args.memoryQuery || message, args.queryEmbedding),
      loadLocalConversationHistory(conversationId, 50),
    ]);

    // Pre-seed the in-memory store with an empty title so the AI title arriving
    // mid-stream (via the `t === 'title'` event below) can land on an existing
    // entry. Without this, updateConversation is a no-op and the AI title is
    // lost — the post-stream fallback would then permanently set the title to
    // the first user message.
    const memStorePre = getVMMemoryStore();
    if (!memStorePre.getConversation(conversationId)) {
      memStorePre.addConversation({
        id: conversationId,
        title: '',
        summary: message.slice(0, 200),
        model: model || 'balanced',
        source: 'agent',
        message_count: 0,
        topics: extractSimpleTopics(message),
      });
    }

    // Store user message
    sendToAgent({
      type: 'tool_exec',
      tool: 'message_add',
      args: { conversation_id: conversationId, role: 'user', content: message },
    }, 10_000).catch(() => {});
    emitChatSyncToDesktop('new_message', conversationId, { role: 'user', content: message });

    const vmAuth = VM_SECRET && USER_ID
      ? { vmToken: mintLocalVMToken(VM_SECRET, USER_ID), userId: USER_ID }
      : undefined;

    // Stream chat to Python agent — onEvent fires for every WS message
    const attachments = Array.isArray(args.attachments) ? args.attachments : undefined;
    const messagesForCloud = [
      ...priorHistory,
      { role: 'user' as const, content: message },
    ];
    const result = await sendToAgentStreaming(
      {
        type: 'chat',
        message,
        conversationId,
        model,
        ...(modelId ? { modelId } : {}),
        messages: messagesForCloud,
        context: { isVM: true, userId: USER_ID, ...(args.context || {}) },
        memoryContext,
        ...(attachments ? { attachments } : {}),
        ...(vmAuth ? { auth: vmAuth } : {}),
      },
      (event) => {
        const t = String(event.type || '').toLowerCase();
        if (t === 'progress' || t === 'delta') {
          // Python agent wraps tool events inside progress: {type:'progress', event:'tool_event', data:{...}}.
          // Unwrap known sub-events so the UI receives them as top-level typed events.
          const subEvent = String(event.event || '').toLowerCase();
          const subData = event.data || {};
          if (subEvent === 'tool_event') {
            writeLine({
              type: 'tool_event',
              tool: subData.tool,
              status: subData.status,
              data: subData,
            });
            return;
          }
          if (subEvent === 'tool_request') {
            writeLine({
              type: 'tool_request',
              id: subData.id,
              tool: subData.tool,
              args: subData.args,
            });
            return;
          }
          if (subEvent === 'subagent_event') {
            writeLine({
              type: 'subagent_event',
              subagentId: subData.subagentId,
              event: subData.event,
              data: subData.data ?? subData,
            });
            return;
          }
          writeLine({ type: 'progress', event: event.event || 'delta', data: event.data || { text: event.text } });
        } else if (t === 'routing') {
          writeLine({ type: 'routing', model: event.model, data: event.data });
        } else if (t === 'tool_event') {
          writeLine({ type: 'tool_event', tool: event.tool, status: event.status, data: event.data ?? event });
        } else if (t === 'tool_request') {
          writeLine({ type: 'tool_request', id: event.id, tool: event.tool, args: event.args });
        } else if (t === 'subagent_event') {
          writeLine({ type: 'subagent_event', subagentId: event.subagentId, event: event.event, data: event.data });
        } else if (t === 'conversation') {
          writeLine({ type: 'conversation', conversationId: event.conversationId });
        } else if (t === 'title') {
          writeLine({ type: 'title', title: event.title, conversationId: event.conversationId });
          if (event.title) {
            const aiTitle = String(event.title).trim();
            if (aiTitle) {
              // 1. Update VM in-memory store (will hit the pre-seeded entry above).
              getVMMemoryStore().updateConversation(conversationId, { title: aiTitle });
              // 2. Persist to local SQLite via the Python agent so list/refresh
              //    queries see the AI title even after restart.
              sendToAgent({
                type: 'tool_exec',
                tool: 'conversation_update',
                args: { conversation_id: conversationId, title: aiTitle },
              }, 5_000).catch(() => {});
              // 3. Mirror to desktop so its history list updates immediately.
              emitChatSyncToDesktop('title_update', conversationId, { title: aiTitle });
            }
          }
        }
      },
      180_000,
    );

    // Process turn in background (store assistant message, create segment, embeddings).
    // Cloud-ai's final WS frame is { type:'final', result:{ text, ... } }, which the
    // Python agent forwards verbatim — so the assistant text lives at result.result.text.
    const assistantText = String(result?.result?.text ?? result?.text ?? '').trim();
    if (assistantText) {
      processVMConversationTurn(conversationId, message, assistantText).catch((e) => {
        console.warn('[vm-agent] post-response memory processing failed:', e?.message);
      });
    }

    // Track conversation in VM memory store for history.
    // IMPORTANT: never overwrite the title here — the AI title arrives via the
    // mid-stream `t === 'title'` handler above. Setting message.slice() as the
    // title would clobber it (visible bug: chats listed as the user's first
    // message instead of the AI-generated title).
    const memStore2 = getVMMemoryStore();
    const existing = memStore2.getConversation(conversationId);
    if (existing) {
      memStore2.updateConversation(conversationId, {
        message_count: (existing.message_count || 0) + 2,
        summary: message.slice(0, 200),
      });
    } else {
      // Pre-seed should have created this entry already; this branch only fires
      // if memstore was wiped mid-stream. Leave title empty so the SQLite/AI
      // title wins on the next list query.
      memStore2.addConversation({
        id: conversationId,
        title: '',
        summary: message.slice(0, 200),
        model: model || 'balanced',
        source: 'agent',
        message_count: 2,
        topics: extractSimpleTopics(message),
      });
    }

    // Write final event
    writeLine({ type: 'final', ok: true, conversationId, ...result });

    // Trigger immediate sync to desktop so conversations appear without waiting for periodic sync
    scheduleQuickSync();
  } catch (e: any) {
    writeLine({ type: 'error', error: String(e?.message || 'agent_chat_failed') });
  } finally {
    endAgentOperation();
    res.end();
  }
}

async function handleToolExec(args: any): Promise<any> {
  const tool = String(args.tool || '').trim();
  if (!tool) return { ok: false, error: 'missing tool name' };

  beginAgentOperation();
  try {
    const result = await sendToAgent({
      type: 'tool_exec',
      tool,
      args: args.args || {},
    }, 120_000);
    return result;
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'tool_exec_failed') };
  } finally {
    endAgentOperation();
  }
}

async function handleAgentExecute(args: any): Promise<any> {
  const task = String(args.task || args.prompt || '').trim();
  if (!task) return { ok: false, error: 'empty_task' };

  const outputSchema = args.outputSchema || null;
  const tools = args.tools || null;
  const model = args.model || 'balanced';

  beginAgentOperation();
  try {
    const memoryContext = await buildVMMemoryContext(task, args.queryEmbedding);

    const result = await sendToAgent({
      type: 'tool_exec',
      tool: 'agent_execute',
      args: {
        task,
        outputSchema,
        allowedTools: tools,
        model,
        context: {
          isVM: true,
          userId: USER_ID,
          ...(args.context || {}),
        },
        memoryContext,
      },
    }, 300_000); // 5 min timeout for task execution

    return { ok: true, ...result };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'agent_execute_failed') };
  } finally {
    endAgentOperation();
  }
}

// buildVMMemoryContext is imported from vm-agent-ws.ts

/**
 * Post-response memory processing — mirrors the desktop's
 * storeMessageLocally + processConversationTurn pipeline.
 *
 * Stores the assistant message, then triggers the Python agent's
 * conversation segmentation (topic analysis, embedding generation).
 */
async function processVMConversationTurn(
  conversationId: string,
  userMessage: string,
  assistantMessage: string,
): Promise<void> {
  beginAgentOperation();
  try {
    // Store assistant message
    await sendToAgent({
      type: 'tool_exec',
      tool: 'message_add',
      args: { conversation_id: conversationId, role: 'assistant', content: assistantMessage },
    }, 10_000).catch(() => {});
    emitChatSyncToDesktop('new_message', conversationId, { role: 'assistant', content: assistantMessage });

    // Get existing segments to determine current state
    const segListResult = await sendToAgent({
      type: 'tool_exec',
      tool: 'segment_list',
      args: { conversation_id: conversationId },
    }, 10_000).catch(() => null);

    const existingSegments: any[] = segListResult?.segments || segListResult?.result || [];

    // Use a lightweight AI call via the Python agent to analyze the turn.
    // The Python agent's 'conversation_analyze_segment' may not exist, so we
    // create a summary ourselves and store a new segment when appropriate.
    // For simplicity, create/update a segment for every meaningful turn.
    const summaryText = `User: ${userMessage.slice(0, 200)}. Assistant: ${assistantMessage.slice(0, 200)}`;
    const topics = extractSimpleTopics(userMessage);

    // Generate embedding for the segment
    let segmentEmbedding: number[] | undefined;
    try {
      const embedText = `${summaryText} Topics: ${topics.join(', ')}`;
      const embedResult = await sendToAgent({
        type: 'tool_exec',
        tool: 'generate_embedding',
        args: { text: embedText },
      }, 15_000).catch(() => null);
      segmentEmbedding = embedResult?.embedding || embedResult?.result?.embedding;
    } catch { /* non-fatal */ }

    // Create a new segment for this turn
    const turnCount = existingSegments.length + 1;
    await sendToAgent({
      type: 'tool_exec',
      tool: 'segment_create',
      args: {
        conversation_id: conversationId,
        start_turn: turnCount,
        summary: summaryText.slice(0, 500),
        topics,
        ...(segmentEmbedding ? { embedding: segmentEmbedding } : {}),
      },
    }, 10_000).catch((e: any) => {
      console.warn('[vm-agent] segment_create failed:', e?.message);
    });

    console.log(`[vm-agent] Processed conversation turn: ${conversationId}, segments: ${turnCount}`);
  } finally {
    endAgentOperation();
  }
}

/** Extract simple topic keywords from text. */
function extractSimpleTopics(text: string): string[] {
  const words = text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/);
  const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
    'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
    'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by',
    'from', 'as', 'into', 'through', 'during', 'before', 'after', 'about', 'between',
    'out', 'up', 'down', 'it', 'its', 'this', 'that', 'these', 'those', 'i', 'me', 'my',
    'you', 'your', 'we', 'our', 'they', 'their', 'what', 'which', 'who', 'whom', 'how',
    'when', 'where', 'why', 'not', 'no', 'and', 'or', 'but', 'if', 'so', 'just', 'than',
    'too', 'very', 'hi', 'hello', 'hey', 'please', 'thanks', 'thank']);
  const freq = new Map<string, number>();
  for (const w of words) {
    if (w.length > 2 && !stopWords.has(w)) {
      freq.set(w, (freq.get(w) || 0) + 1);
    }
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([w]) => w);
}

// ─────────────────────────────────────────────────────────────────────────────
// Memory Handlers
// ─────────────────────────────────────────────────────────────────────────────

function handleMemoryAdd(args: any): any {
  const memStore = getVMMemoryStore();
  const entry = memStore.add({
    topic: String(args.topic || 'general'),
    content: String(args.content || ''),
    metadata: args.metadata || {},
    tags: Array.isArray(args.tags) ? args.tags : [],
    source: args.source || 'user',
    origin: args.origin || 'cloud_vm',
    importance: Number(args.importance ?? 5),
    expires_at: args.expires_at || null,
  });
  return { ok: true, memory: entry };
}

function handleMemoryGet(args: any): any {
  const memStore = getVMMemoryStore();
  const entry = memStore.get(args.id);
  return entry ? { ok: true, memory: entry } : { ok: false, error: 'not_found' };
}

function handleMemoryUpdate(args: any): any {
  const memStore = getVMMemoryStore();
  const entry = memStore.update(args.id, args.updates || {});
  return entry ? { ok: true, memory: entry } : { ok: false, error: 'not_found' };
}

function handleMemoryDelete(args: any): any {
  const memStore = getVMMemoryStore();
  const deleted = memStore.delete(args.id);
  return { ok: deleted, deleted };
}

function handleMemoryList(args: any): any {
  const memStore = getVMMemoryStore();
  const memories = memStore.list({
    topic: args.topic,
    source: args.source,
    tags: args.tags,
    limit: args.limit,
    offset: args.offset,
    minImportance: args.minImportance,
  });
  return { ok: true, memories, count: memories.length };
}

function handleMemorySearch(args: any): any {
  const memStore = getVMMemoryStore();
  const results = memStore.search(String(args.query || ''), args.limit || 20);
  return {
    ok: true,
    results: results.map(r => ({
      ...r.entry,
      score: r.score,
      matchedFields: r.matchedFields,
    })),
    count: results.length,
  };
}

function handleMemoryTopics(): any {
  return { ok: true, topics: getVMMemoryStore().getTopics() };
}

function handleMemoryStats(): any {
  return { ok: true, stats: getVMMemoryStore().getStats() };
}

function handleMemoryExport(): any {
  return { ok: true, data: getVMMemoryStore().exportAll() };
}

function handleMemoryImport(args: any): any {
  const result = getVMMemoryStore().importAll(args.data || {}, args.mode || 'merge');
  return { ok: true, ...result };
}

function handleMemoryPreferencesGet(args: any): any {
  const memStore = getVMMemoryStore();
  if (args.key) {
    return { ok: true, value: memStore.getPreference(args.key, args.default) };
  }
  return { ok: true, preferences: memStore.getPreferences() };
}

function handleMemoryPreferencesSet(args: any): any {
  const memStore = getVMMemoryStore();
  memStore.setPreference(String(args.key), args.value);
  return { ok: true };
}

async function handleMemoryConversationsList(args: any): Promise<any> {
  const limit = Number(args.limit) || 50;
  const source = typeof args.source === 'string' && args.source.trim() ? args.source.trim() : '';
  const isMainChatConversation = (c: any) => {
    const rowSource = String(c?.source || '').trim().toLowerCase();
    return !['workflow', 'skill', 'proactive', 'bot'].includes(rowSource);
  };

  // Always query both sources: VM in-memory (current boot) and Python SQLite (persisted history)
  const vmConvs = (getVMMemoryStore().listConversations(limit) || [])
    .filter((c: any) => source ? String(c?.source || '') === source : isMainChatConversation(c));

  let sqliteConvs: any[] = [];
  try {
    const result = await sendToAgent({
      type: 'tool_exec',
      tool: 'conversation_list',
      args: { limit, status: 'active', ...(source ? { source } : {}) },
    }, 10_000);
    const raw = result?.result?.conversations || result?.conversations || [];
    if (Array.isArray(raw)) {
      sqliteConvs = raw.filter((c: any) => source ? String(c?.source || '') === source : isMainChatConversation(c));
    }
  } catch { /* silent */ }

  // Merge by id. Python SQLite is canonical (has persisted counts/titles);
  // VM in-memory may hold the freshest title/count for the active conversation.
  const byId = new Map<string, any>();
  for (const c of sqliteConvs) if (c?.id) byId.set(String(c.id), { ...c });
  for (const c of vmConvs) {
    if (!c?.id) continue;
    const id = String(c.id);
    const existing = byId.get(id);
    if (!existing) { byId.set(id, { ...c }); continue; }
    const merged = { ...existing };
    // Prefer non-empty, non-"Untitled" title
    const vmTitle = typeof c.title === 'string' ? c.title.trim() : '';
    const exTitle = typeof existing.title === 'string' ? existing.title.trim() : '';
    if (vmTitle && vmTitle.toLowerCase() !== 'untitled' && (!exTitle || exTitle.toLowerCase() === 'untitled')) {
      merged.title = c.title;
    }
    // Prefer higher message_count (freshest)
    const vmCount = Number(c.message_count || 0);
    const exCount = Number(existing.message_count || 0);
    if (vmCount > exCount) merged.message_count = vmCount;
    // Prefer newer updated_at
    const vmUpd = c.updated_at ? new Date(c.updated_at).getTime() : 0;
    const exUpd = existing.updated_at ? new Date(existing.updated_at).getTime() : 0;
    if (vmUpd > exUpd) merged.updated_at = c.updated_at;
    byId.set(id, merged);
  }

  const merged = Array.from(byId.values()).sort((a, b) => {
    const ta = a.updated_at ? new Date(a.updated_at).getTime() : 0;
    const tb = b.updated_at ? new Date(b.updated_at).getTime() : 0;
    return tb - ta;
  }).slice(0, limit);

  return { ok: true, conversations: merged };
}

function handleMemoryConversationsAdd(args: any): any {
  const conv = getVMMemoryStore().addConversation({
    id: args.id || randomUUID(),
    title: String(args.title || ''),
    summary: String(args.summary || ''),
    model: String(args.model || ''),
    source: String(args.source || 'agent'),
    message_count: Number(args.message_count || 0),
    topics: Array.isArray(args.topics) ? args.topics : [],
  });
  emitChatSyncToDesktop('new_conversation', conv.id, {
    title: conv.title,
    model: conv.model || undefined,
  });
  return { ok: true, conversation: conv };
}

function handleMemoryConversationsUpdate(args: any): any {
  const id = String(args.id || '').trim();
  if (!id) return { ok: false, error: 'missing id' };
  const updates: any = {};
  if (args.title != null) updates.title = String(args.title);
  if (args.summary != null) updates.summary = String(args.summary);
  if (args.message_count != null) updates.message_count = Number(args.message_count);
  if (args.topics != null) updates.topics = args.topics;
  const conv = getVMMemoryStore().updateConversation(id, updates);
  if (!conv) return { ok: false, error: 'not_found' };
  if (args.title != null) {
    emitChatSyncToDesktop('title_update', id, { title: String(args.title) });
  }
  return { ok: true, conversation: conv };
}

async function handleMemoryMessagesList(args: any): Promise<any> {
  const conversationId = String(args.conversation_id || '').trim();
  if (!conversationId) return { ok: false, error: 'missing conversation_id' };
  try {
    const result = await sendToAgent({
      type: 'tool_exec',
      tool: 'message_list',
      args: { conversation_id: conversationId, limit: Number(args.limit) || 100 },
    }, 15_000);
    return { ok: true, messages: result?.messages || result?.result?.messages || [] };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'message_list_failed', messages: [] };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Proactive Handlers
// ─────────────────────────────────────────────────────────────────────────────

function handleProactiveStatus(): any {
  return { ok: true, ...getVMProactiveScheduler().getStatus() };
}

function handleProactiveConfig(args: any): any {
  const scheduler = getVMProactiveScheduler();
  if (args.updates) {
    return { ok: true, config: scheduler.updateConfig(args.updates) };
  }
  return { ok: true, config: scheduler.getConfig() };
}

async function handleProactiveWakeup(): Promise<any> {
  const result = await getVMProactiveScheduler().wakeup();
  return { ok: true, result };
}

function handleProactiveTasks(args: any): any {
  return {
    ok: true,
    tasks: getVMProactiveScheduler().listTasks({
      status: args.status,
      priority: args.priority,
    }),
  };
}

function handleProactiveTaskAdd(args: any): any {
  const task = getVMProactiveScheduler().addTask({
    title: String(args.title || ''),
    description: String(args.description || ''),
    status: args.status || 'pending',
    priority: args.priority || 'medium',
    source: args.source || 'user',
    dueAt: args.dueAt,
    metadata: args.metadata,
  });
  return { ok: true, task };
}

function handleProactiveTaskUpdate(args: any): any {
  const task = getVMProactiveScheduler().updateTask(args.id, args.updates || {});
  return task ? { ok: true, task } : { ok: false, error: 'not_found' };
}

function handleProactiveTaskDelete(args: any): any {
  return { ok: getVMProactiveScheduler().deleteTask(args.id) };
}

// ─────────────────────────────────────────────────────────────────────────────
// User timezone — synced from the desktop on bot deploys so VM cron schedules
// and any process.env.TZ-aware code (vm-proactive quiet hours, vm-engine time
// tools, …) follow the user's *current* zone, not whatever was baked in at
// VM-provision time. Persisted so it survives agent restarts.
// ─────────────────────────────────────────────────────────────────────────────

const USER_CONFIG_PATH = process.env.STUARD_USER_CONFIG_PATH
  || `${process.env.AGENT_DATA_DIR || '/home/stuard/agent-data'}/user-config.json`;

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function loadUserConfig(): { timezone?: string } {
  try {
    if (!fs.existsSync(USER_CONFIG_PATH)) return {};
    const raw = JSON.parse(fs.readFileSync(USER_CONFIG_PATH, 'utf-8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function saveUserConfig(cfg: { timezone?: string }): void {
  try {
    const dir = USER_CONFIG_PATH.replace(/[/\\][^/\\]+$/, '');
    if (dir) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(USER_CONFIG_PATH, JSON.stringify(cfg, null, 2));
  } catch (e: any) {
    console.warn('[vm-agent] Failed to save user-config.json:', e?.message || e);
  }
}

/**
 * Apply a user-supplied IANA timezone to the running agent process and
 * persist it. Returns the applied tz, or null if the input was invalid.
 *
 * Note: process.env.TZ updates affect node-cron registrations made *after*
 * this call (vm-bots re-registers on every bots_sync). They don't reach
 * already-armed cron jobs.
 */
function applyUserTimezone(tz: string): string | null {
  const trimmed = String(tz || '').trim();
  if (!trimmed || !isValidTimezone(trimmed)) return null;
  if (process.env.TZ === trimmed && process.env.STUARD_USER_TIMEZONE === trimmed) {
    return trimmed;
  }
  process.env.TZ = trimmed;
  process.env.STUARD_USER_TIMEZONE = trimmed;
  saveUserConfig({ ...loadUserConfig(), timezone: trimmed });
  console.log(`[vm-agent] Applied user timezone: ${trimmed}`);
  return trimmed;
}

function restoreUserTimezone(): void {
  const tz = loadUserConfig().timezone;
  if (typeof tz === 'string' && tz.trim() && isValidTimezone(tz.trim())) {
    process.env.TZ = tz.trim();
    process.env.STUARD_USER_TIMEZONE = tz.trim();
    console.log(`[vm-agent] Restored user timezone from disk: ${tz.trim()}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bot Handlers (multi-bot scheduler)
// ─────────────────────────────────────────────────────────────────────────────

function handleBotsStatus(): any {
  return { ok: true, ...getVMBotScheduler().getStatus() };
}

function handleBotsSync(args: any): any {
  // Apply caller-supplied timezone *before* syncing so re-registered cron
  // jobs pick up the user's current zone instead of whatever was baked in
  // at provision time.
  if (typeof args?.timezone === 'string' && args.timezone.trim()) {
    applyUserTimezone(args.timezone.trim());
  }
  const incoming = Array.isArray(args?.bots) ? (args.bots as VMBot[]) : [];
  const bots = getVMBotScheduler().syncBots(incoming);
  return { ok: true, count: bots.length, timezone: process.env.TZ || null };
}

/**
 * VM-wide timezone setter. Updates process.env.TZ + persists to disk and
 * forces the bot scheduler to re-register every schedule.cron job so the
 * new zone is live immediately (without waiting for the next bot sync).
 *
 * Safe to call repeatedly — applyUserTimezone short-circuits when the tz
 * is already current.
 */
function handleSetUserTimezone(args: any): any {
  const tz = String(args?.timezone || '').trim();
  if (!tz) return { ok: false, error: 'missing_timezone' };
  const before = process.env.TZ || null;
  const applied = applyUserTimezone(tz);
  if (!applied) return { ok: false, error: 'invalid_timezone' };

  // If the zone actually changed, force cron jobs to pick it up now.
  if (before !== applied) {
    try {
      const scheduler = getVMBotScheduler();
      scheduler.syncBots(scheduler.listBots());
    } catch (e: any) {
      console.warn('[vm-agent] Cron re-register after tz change failed:', e?.message || e);
    }
  }
  return { ok: true, timezone: applied, changed: before !== applied };
}

function handleGetUserTimezone(): any {
  return {
    ok: true,
    timezone: process.env.TZ || null,
    persisted: loadUserConfig().timezone || null,
  };
}

function handleBotsRun(args: any): any {
  const id = String(args?.id || '');
  if (!id) return { ok: false, error: 'missing id' };
  return getVMBotScheduler().triggerBotManual(id);
}

function handleBotsList(): any {
  return { ok: true, bots: getVMBotScheduler().listBots() };
}

function handleBotsDelete(args: any): any {
  const id = String(args?.id || args?.agentId || args?.agent_id || args?.botId || args?.bot_id || '').trim();
  if (!id) return { ok: false, error: 'missing id' };
  return getVMBotScheduler().deleteBot(id);
}

// ─────────────────────────────────────────────────────────────────────────────
// Skills Sync Handlers
// ─────────────────────────────────────────────────────────────────────────────

function handleSkillsSync(args: any): any {
  const incoming = Array.isArray(args?.skills) ? (args.skills as VMSkill[]) : [];
  return saveVMSkills(incoming);
}

function handleSkillsStatus(): any {
  return { ok: true, ...getVMSkillsStats() };
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent Database Sync (SQLite databases ↔ GCS)
// ─────────────────────────────────────────────────────────────────────────────

const AGENT_DATA_DIR = process.env.AGENT_DATA_DIR || '/home/stuard/agent-data';
const GCS_BUCKET = process.env.STUARD_GCS_BUCKET || '';
const CLOUD_AI_URL = process.env.CLOUD_AI_URL || '';

// ── Agent Data Change Detection ──────────────────────────────────────────────
// Track file modification times to avoid syncing when nothing changed.
const SYNC_INTERVAL_MS = 5 * 60_000; // 5 minutes
const DB_FILES_TO_WATCH = [
  'knowledge.db', 'knowledge.db-wal', 'knowledge.db-shm',
  'memory.db', 'memory.db-wal', 'memory.db-shm',
  'file_index.db', 'file_index.db-wal', 'file_index.db-shm',
  'workflow.db', 'workflow.db-wal', 'workflow.db-shm',
];
const _lastSyncMtimes = new Map<string, number>();
let _syncInFlight = false;

type SqliteDb = Database.Database;
type SqliteRow = Record<string, any>;

const PLAINTEXT_PREFIX = 'pt1:';

function sqlIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`invalid sqlite identifier: ${name}`);
  }
  return `"${name}"`;
}

function tableExists(db: SqliteDb, table: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table);
  return Boolean(row);
}

function getColumns(db: SqliteDb, table: string): string[] {
  if (!tableExists(db, table)) return [];
  return (db.prepare(`PRAGMA table_info(${sqlIdent(table)})`).all() as Array<{ name: string }>)
    .map((col) => col.name)
    .filter(Boolean);
}

function commonColumns(src: SqliteDb, dest: SqliteDb, table: string): string[] {
  const destCols = new Set(getColumns(dest, table));
  return getColumns(src, table).filter((col) => destCols.has(col));
}

function parseSqlTime(value: unknown): number {
  const n = Date.parse(String(value || ''));
  return Number.isFinite(n) ? n : 0;
}

function hasUnreadableEncryptedFields(row: SqliteRow | undefined, columns: string[]): boolean {
  if (!row) return false;
  return columns.some((col) => {
    const value = row[col];
    return typeof value === 'string' && value.length > 0 && !value.startsWith(PLAINTEXT_PREFIX);
  });
}

function insertRow(db: SqliteDb, table: string, columns: string[], row: SqliteRow): void {
  if (columns.length === 0) return;
  const colSql = columns.map(sqlIdent).join(', ');
  const placeholders = columns.map(() => '?').join(', ');
  db.prepare(`INSERT INTO ${sqlIdent(table)} (${colSql}) VALUES (${placeholders})`)
    .run(...columns.map((col) => row[col] ?? null));
}

function copyRowsByColumn(
  src: SqliteDb,
  dest: SqliteDb,
  table: string,
  column: string,
  value: string,
): number {
  const columns = commonColumns(src, dest, table);
  if (columns.length === 0 || !columns.includes(column)) return 0;

  const rows = src
    .prepare(`SELECT * FROM ${sqlIdent(table)} WHERE ${sqlIdent(column)} = ?`)
    .all(value) as SqliteRow[];

  for (const row of rows) insertRow(dest, table, columns, row);
  return rows.length;
}

function mergeEntityTable(
  src: SqliteDb,
  dest: SqliteDb,
  table: string,
  pk: string,
  encryptedColumns: string[],
  updatedColumn = 'updated_at',
): { inserted: number; updated: number; skipped: number } {
  const columns = commonColumns(src, dest, table);
  if (columns.length === 0 || !columns.includes(pk)) return { inserted: 0, updated: 0, skipped: 0 };

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const rows = src.prepare(`SELECT * FROM ${sqlIdent(table)}`).all() as SqliteRow[];

  for (const row of rows) {
    const id = row[pk];
    if (id == null) continue;

    const local = dest
      .prepare(`SELECT * FROM ${sqlIdent(table)} WHERE ${sqlIdent(pk)} = ?`)
      .get(id) as SqliteRow | undefined;
    const shouldReplace = !local
      || parseSqlTime(row[updatedColumn]) >= parseSqlTime(local[updatedColumn])
      || (hasUnreadableEncryptedFields(local, encryptedColumns) && !hasUnreadableEncryptedFields(row, encryptedColumns));

    if (!shouldReplace) {
      skipped++;
      continue;
    }

    dest.prepare(`DELETE FROM ${sqlIdent(table)} WHERE ${sqlIdent(pk)} = ?`).run(id);
    insertRow(dest, table, columns, row);
    if (local) updated++;
    else inserted++;
  }

  return { inserted, updated, skipped };
}

function mergeMemoryDb(incomingPath: string, localPath: string): { ok: boolean; copied?: boolean; reason?: string; stats?: any; error?: string } {
  if (!fs.existsSync(incomingPath)) return { ok: false, error: 'incoming_memory_db_missing' };

  if (!fs.existsSync(localPath) || fs.statSync(localPath).size === 0) {
    fs.copyFileSync(incomingPath, localPath);
    return { ok: true, copied: true, reason: 'local_missing' };
  }

  let src: SqliteDb | null = null;
  let dest: SqliteDb | null = null;

  try {
    src = new Database(incomingPath, { readonly: true, fileMustExist: true });
    dest = new Database(localPath);

    if (!tableExists(src, 'conversations') || !tableExists(dest, 'conversations')) {
      fs.copyFileSync(incomingPath, localPath);
      return { ok: true, copied: true, reason: 'missing_conversations_table' };
    }

    const stats = {
      conversations: { inserted: 0, replaced: 0, skipped: 0 },
      messages: 0,
      segments: 0,
      spaces: { inserted: 0, updated: 0, skipped: 0 },
      spaceItems: { inserted: 0, updated: 0, skipped: 0 },
      collections: { inserted: 0, updated: 0, skipped: 0 },
      links: 0,
    };

    dest.pragma('foreign_keys = OFF');
    const tx = dest.transaction(() => {
      const conversationColumns = commonColumns(src!, dest!, 'conversations');
      const incomingConvs = src!.prepare('SELECT * FROM conversations').all() as SqliteRow[];

      for (const conv of incomingConvs) {
        const id = String(conv.id || '');
        if (!id) continue;

        const local = dest!
          .prepare('SELECT * FROM conversations WHERE id = ?')
          .get(id) as SqliteRow | undefined;
        const incomingIsReadable = !hasUnreadableEncryptedFields(conv, ['title_enc']);
        const localIsUnreadable = hasUnreadableEncryptedFields(local, ['title_enc']);
        // A NULL/empty title_enc renders as "Untitled" on the VM. If the
        // incoming row has a real plaintext title, prefer it even when
        // updated_at hasn't advanced — otherwise the user sees "Untitled" for
        // every freshly synced conversation.
        const incomingHasTitle = typeof conv.title_enc === 'string' && conv.title_enc.length > 0;
        const localHasTitle = typeof local?.title_enc === 'string' && (local.title_enc as string).length > 0;
        const shouldReplace = !local
          || parseSqlTime(conv.updated_at) >= parseSqlTime(local.updated_at)
          || (incomingIsReadable && localIsUnreadable)
          || (Number(conv.message_count || 0) > Number(local.message_count || 0) && localIsUnreadable)
          || (incomingHasTitle && !localHasTitle);

        if (!shouldReplace) {
          stats.conversations.skipped++;
          continue;
        }

        if (local) {
          dest!.prepare('DELETE FROM messages WHERE conversation_id = ?').run(id);
          dest!.prepare('DELETE FROM conversation_segments WHERE conversation_id = ?').run(id);
          if (tableExists(dest!, 'space_conversations')) {
            dest!.prepare('DELETE FROM space_conversations WHERE conversation_id = ?').run(id);
          }
          dest!.prepare('DELETE FROM conversations WHERE id = ?').run(id);
          stats.conversations.replaced++;
        } else {
          stats.conversations.inserted++;
        }

        insertRow(dest!, 'conversations', conversationColumns, conv);
        stats.messages += copyRowsByColumn(src!, dest!, 'messages', 'conversation_id', id);
        stats.segments += copyRowsByColumn(src!, dest!, 'conversation_segments', 'conversation_id', id);
        stats.links += copyRowsByColumn(src!, dest!, 'space_conversations', 'conversation_id', id);
      }

      stats.spaces = mergeEntityTable(src!, dest!, 'spaces', 'id', ['name_enc', 'description_enc']);
      stats.spaceItems = mergeEntityTable(src!, dest!, 'space_items', 'id', ['title_enc', 'content_enc', 'metadata_enc']);
      stats.collections = mergeEntityTable(src!, dest!, 'collection_summaries', 'topic', [], 'updated_at');

      const linkColumns = commonColumns(src!, dest!, 'space_conversations');
      if (linkColumns.length > 0) {
        const links = src!.prepare('SELECT * FROM space_conversations').all() as SqliteRow[];
        for (const link of links) {
          const exists = dest!
            .prepare('SELECT 1 FROM space_conversations WHERE space_id = ? AND conversation_id = ?')
            .get(link.space_id, link.conversation_id);
          if (!exists) {
            insertRow(dest!, 'space_conversations', linkColumns, link);
            stats.links++;
          }
        }
      }
    });

    tx();
    try { dest.pragma('foreign_keys = ON'); } catch { /* best-effort */ }
    try { dest.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* best-effort */ }
    return { ok: true, copied: false, reason: 'merged', stats };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'memory_db_merge_failed' };
  } finally {
    try { src?.close(); } catch { /* noop */ }
    try { dest?.close(); } catch { /* noop */ }
  }
}

/** Check if any agent data files have been modified since last sync. */
function hasAgentDataChanged(): boolean {
  try {
    for (const name of DB_FILES_TO_WATCH) {
      const filePath = `${AGENT_DATA_DIR}/${name}`;
      if (!fs.existsSync(filePath)) continue;
      const mtime = fs.statSync(filePath).mtimeMs;
      const prev = _lastSyncMtimes.get(name);
      if (prev === undefined || mtime > prev) return true;
    }
    // Also check lancedb directory
    const lanceDir = `${process.env.STUARD_VM_ROOT || '/home/stuard'}/lancedb`;
    if (fs.existsSync(lanceDir)) {
      const stat = fs.statSync(lanceDir);
      const prev = _lastSyncMtimes.get('lancedb');
      if (prev === undefined || stat.mtimeMs > prev) return true;
    }
  } catch { /* stat failure — assume changed */ return true; }
  return false;
}

/** Files that changed since the last successful VM-side agent-data sync. */
function getChangedAgentDataFiles(): string[] {
  const changed = new Set<string>();
  for (const name of DB_FILES_TO_WATCH) {
    const filePath = `${AGENT_DATA_DIR}/${name}`;
    if (!fs.existsSync(filePath)) continue;
    try {
      const mtime = fs.statSync(filePath).mtimeMs;
      const prev = _lastSyncMtimes.get(name);
      if (prev === undefined || mtime > prev) changed.add(name);
    } catch {
      changed.add(name);
    }
  }

  for (const group of [
    ['knowledge.db', 'knowledge.db-wal', 'knowledge.db-shm'],
    ['memory.db', 'memory.db-wal', 'memory.db-shm'],
    ['file_index.db', 'file_index.db-wal', 'file_index.db-shm'],
  ]) {
    if (!group.some((name) => changed.has(name))) continue;
    for (const name of group) {
      if (fs.existsSync(`${AGENT_DATA_DIR}/${name}`)) changed.add(name);
    }
  }

  return Array.from(changed);
}

/** Snapshot current mtimes so we know what we last synced. */
function snapshotMtimes(): void {
  try {
    for (const name of DB_FILES_TO_WATCH) {
      const filePath = `${AGENT_DATA_DIR}/${name}`;
      if (fs.existsSync(filePath)) {
        _lastSyncMtimes.set(name, fs.statSync(filePath).mtimeMs);
      }
    }
    const lanceDir = `${process.env.STUARD_VM_ROOT || '/home/stuard'}/lancedb`;
    if (fs.existsSync(lanceDir)) {
      _lastSyncMtimes.set('lancedb', fs.statSync(lanceDir).mtimeMs);
    }
  } catch {}
}

/**
 * Notify cloud-ai that the VM has uploaded new agent data.
 * Cloud-ai will relay this to the desktop if online.
 */
async function notifyAgentDataUploaded(mode: 'full' | 'delta' = 'full'): Promise<void> {
  if (!CLOUD_AI_URL || !VM_SECRET || !USER_ID) return;
  try {
    const payload = JSON.stringify({
      userId: USER_ID, instanceName: 'vm-agent-sync',
      nonce: Date.now().toString(36), iat: Date.now(), exp: Date.now() + 300_000,
    });
    const encodedPayload = Buffer.from(payload).toString('base64url');
    const signature = createHmac('sha256', VM_SECRET).update(encodedPayload).digest('base64url');
    const vmToken = `${encodedPayload}.${signature}`;

    await fetch(`${CLOUD_AI_URL}/v1/cloud-engine/vm/agent-data-updated`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: USER_ID, vmToken, mode }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e: any) {
    console.warn('[vm-agent] Failed to notify cloud-ai of agent data upload:', e?.message);
  }
}

/**
 * Fire-and-forget: relay a chat_sync event to the desktop via cloud-ai.
 * Used when the VM creates or updates conversation state so the desktop's
 * chat history stays in sync without waiting for a full memory.db upload.
 */
function emitChatSyncToDesktop(
  action: 'new_message' | 'new_conversation' | 'title_update',
  conversationId: string,
  data: { role?: 'user' | 'assistant'; content?: string; title?: string; model?: string },
): void {
  if (!CLOUD_AI_URL || !VM_SECRET || !USER_ID || !conversationId) return;
  const event = {
    type: 'chat_sync',
    action,
    conversationId,
    source: 'vm',
    data,
    timestamp: new Date().toISOString(),
  };
  (async () => {
    try {
      const payload = JSON.stringify({
        userId: USER_ID,
        nonce: Date.now().toString(36),
        iat: Date.now(),
        exp: Date.now() + 300_000,
      });
      const encodedPayload = Buffer.from(payload).toString('base64url');
      const signature = createHmac('sha256', VM_SECRET).update(encodedPayload).digest('base64url');
      const vmToken = `${encodedPayload}.${signature}`;

      await fetch(`${CLOUD_AI_URL}/v1/cloud-engine/vm/chat-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: USER_ID, vmToken, event }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e: any) {
      console.warn('[vm-agent] chat_sync emit failed:', e?.message);
    }
  })();
}

let _quickSyncTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Debounced quick sync — triggers 3s after last call to avoid
 * hammering GCS during rapid-fire chats.
 */
function scheduleQuickSync() {
  if (_quickSyncTimer) clearTimeout(_quickSyncTimer);
  _quickSyncTimer = setTimeout(() => {
    _quickSyncTimer = null;
    periodicAgentDataSync();
  }, 3_000);
}

/**
 * Periodic auto-sync: detect changes → upload to GCS → notify cloud-ai.
 * Runs every SYNC_INTERVAL_MS. Skips if no changes or sync already in flight.
 */
async function periodicAgentDataSync(): Promise<void> {
  if (_syncInFlight) return;
  if (agentDataSyncDelayMs() > 0) {
    scheduleQuickSync();
    return;
  }
  if (!hasAgentDataChanged()) return;

  _syncInFlight = true;
  try {
    const result = await syncAgentData({ direction: 'upload', mode: 'delta' });
    if (result.ok) {
      snapshotMtimes();
      console.log(`[vm-agent] Auto-synced agent data (${result.bytes} bytes)`);
      // Notify cloud-ai so it can tell the desktop
      await notifyAgentDataUploaded(result.mode === 'delta' ? 'delta' : 'full');
    }
  } catch (e: any) {
    console.warn('[vm-agent] Periodic sync failed:', e?.message);
  } finally {
    _syncInFlight = false;
  }
}

/** Request signed GCS URLs from the cloud-ai backend (VM → backend auth via HMAC). */
async function requestSignedUrls(): Promise<{ uploadUrl?: string; downloadUrl?: string; deltaUploadUrl?: string; deltaDownloadUrl?: string } | null> {
  const cloudAiUrl = process.env.CLOUD_AI_URL || '';
  if (!cloudAiUrl || !VM_SECRET || !USER_ID) return null;

  try {
    const payload = JSON.stringify({
      userId: USER_ID, instanceName: 'vm-agent-sync',
      nonce: Date.now().toString(36), iat: Date.now(), exp: Date.now() + 300_000,
    });
    const encodedPayload = Buffer.from(payload).toString('base64url');
    const signature = createHmac('sha256', VM_SECRET).update(encodedPayload).digest('base64url');
    const vmToken = `${encodedPayload}.${signature}`;

    const resp = await fetch(`${cloudAiUrl}/v1/cloud-engine/vm/agent-data-urls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: USER_ID, vmToken }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) return null;
    const data: any = await resp.json();
    return data.ok ? {
      uploadUrl: data.uploadUrl,
      downloadUrl: data.downloadUrl,
      deltaUploadUrl: data.deltaUploadUrl,
      deltaDownloadUrl: data.deltaDownloadUrl,
    } : null;
  } catch (e: any) {
    console.warn('[vm-agent] Failed to get signed URLs:', e?.message);
    return null;
  }
}

async function syncAgentData(args: any): Promise<any> {
  const direction = String(args.direction || 'upload').toLowerCase();
  const mode = String(args.mode || 'full').toLowerCase() === 'delta' ? 'delta' : 'full';
  const { execFileSync } = require('child_process');

  if (direction === 'upload') {
    if (!fs.existsSync(AGENT_DATA_DIR)) return { ok: false, error: 'agent_data_dir_missing' };

    const archivePath = `/tmp/agent-data-sync-${Date.now()}.tar.gz`;
    const fileListPath = `/tmp/agent-data-sync-files-${Date.now()}.txt`;
    try {
      if (mode === 'delta') {
        const changedFiles = getChangedAgentDataFiles().filter((name) => {
          const filePath = `${AGENT_DATA_DIR}/${name}`;
          return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
        });
        if (changedFiles.length === 0) {
          return { ok: true, direction: 'upload', mode: 'delta', bytes: 0, skipped: true, reason: 'no_changed_files' };
        }
        fs.writeFileSync(fileListPath, changedFiles.join('\n') + '\n');
        execFileSync('tar', ['-czf', archivePath, '-C', AGENT_DATA_DIR, '-T', fileListPath], { timeout: 300_000 });
      } else {
        execFileSync('tar', ['-czf', archivePath, '-C', AGENT_DATA_DIR, '.'], { timeout: 300_000 });
      }
      const stats = fs.statSync(archivePath);

      // Get signed upload URL (from command args, or request from backend)
      let uploadUrl = mode === 'delta'
        ? (args.deltaUploadUrl || args.uploadUrl)
        : args.uploadUrl;
      if (!uploadUrl) {
        const urls = await requestSignedUrls();
        uploadUrl = mode === 'delta' ? (urls?.deltaUploadUrl || urls?.uploadUrl) : urls?.uploadUrl;
      }
      if (!uploadUrl) {
        try { fs.unlinkSync(archivePath); } catch {}
        try { fs.unlinkSync(fileListPath); } catch {}
        return { ok: false, error: 'no_upload_url' };
      }

      // Stream upload to GCS via signed URL — never buffer full archive in memory
      const resp = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/gzip',
          'Content-Length': String(stats.size),
        },
        body: fs.createReadStream(archivePath) as any,
        duplex: 'half' as any,
        signal: AbortSignal.timeout(600_000),
      });
      try { fs.unlinkSync(archivePath); } catch {}
      try { fs.unlinkSync(fileListPath); } catch {}
      if (!resp.ok) return { ok: false, error: `gcs_upload_http_${resp.status}` };

      console.log(`[vm-agent] Agent data ${mode} uploaded via signed URL (${stats.size} bytes)`);
      return { ok: true, direction: 'upload', mode, bytes: stats.size };
    } catch (e: any) {
      try { fs.unlinkSync(archivePath); } catch {}
      try { fs.unlinkSync(fileListPath); } catch {}
      return { ok: false, error: e?.message || 'sync_upload_failed' };
    }
  } else if (direction === 'download') {
    // Get signed download URL (from command args, or request from backend)
    let downloadUrl = args.downloadUrl;
    if (!downloadUrl) {
      const urls = await requestSignedUrls();
      downloadUrl = mode === 'delta' ? (urls?.deltaDownloadUrl || urls?.downloadUrl) : urls?.downloadUrl;
    }
    if (!downloadUrl) return { ok: false, error: 'no_download_url' };

    const tempPath = `/tmp/agent-data-download-${Date.now()}.tar.gz`;
    const extractDir = `/tmp/agent-data-extract-${Date.now()}`;
    try {
      // Stream download from GCS — never buffer full archive in memory
      const resp = await fetch(downloadUrl, { signal: AbortSignal.timeout(600_000) });
      if (!resp.ok) return { ok: false, error: `download_http_${resp.status}` };
      if (!resp.body) return { ok: false, error: 'download_empty_body' };
      await pipeline(Readable.fromWeb(resp.body as any), fs.createWriteStream(tempPath));

      fs.mkdirSync(extractDir, { recursive: true });
      fs.mkdirSync(AGENT_DATA_DIR, { recursive: true });
      execFileSync('tar', ['-xzf', tempPath, '-C', extractDir], { timeout: 300_000 });

      // Merge-safe copy: only overwrite a destination file if the incoming one
      // is newer (mtime-based) OR the destination doesn't exist OR the
      // destination is empty. This prevents the classic "A syncs, then B syncs
      // stale data and clobbers A's newer changes" race while still letting an
      // initial sync populate an empty agent-data dir.
      const mergeCopy = (src: string, dest: string): { copied: boolean; reason: string } => {
        try {
          const srcStat = fs.statSync(src);
          if (!srcStat.isFile()) return { copied: false, reason: 'not_a_file' };
          if (fs.existsSync(dest)) {
            const destStat = fs.statSync(dest);
            if (destStat.size > 0 && destStat.mtimeMs >= srcStat.mtimeMs) {
              // Local is same-age or newer — keep local; leave the incoming
              // data available for a Python-side row-level merge later.
              return { copied: false, reason: 'local_newer_or_equal' };
            }
          }
          fs.copyFileSync(src, dest);
          // Preserve the incoming mtime so future syncs stay comparable
          try { fs.utimesSync(dest, srcStat.atime, srcStat.mtime); } catch { /* best-effort */ }
          return { copied: true, reason: 'copied' };
        } catch (e: any) {
          return { copied: false, reason: `error:${e?.message || 'copy_failed'}` };
        }
      };

      // Handle new archive format (agent/knowledge.db, lancedb/..., workflow.db)
      const extractedAgentDir = `${extractDir}/agent`;
      let copied = 0;
      let skipped = 0;
      if (fs.existsSync(extractedAgentDir)) {
        const agentFiles = fs.readdirSync(extractedAgentDir);
        for (const f of agentFiles) {
          if (f === 'memory.db-wal' || f === 'memory.db-shm') {
            skipped++;
            continue;
          }
          if (f === 'memory.db') {
            const result = mergeMemoryDb(`${extractedAgentDir}/${f}`, `${AGENT_DATA_DIR}/${f}`);
            if (result.ok) {
              if (result.copied) copied++; else copied++;
              console.log('[vm-agent] memory.db merged from agent-data archive:', JSON.stringify(result.stats || { reason: result.reason }));
            } else {
              console.warn('[vm-agent] memory.db merge failed; falling back to mtime copy:', result.error);
              const copiedResult = mergeCopy(`${extractedAgentDir}/${f}`, `${AGENT_DATA_DIR}/${f}`);
              if (copiedResult.copied) copied++; else skipped++;
            }
            continue;
          }
          const result = mergeCopy(`${extractedAgentDir}/${f}`, `${AGENT_DATA_DIR}/${f}`);
          if (result.copied) copied++; else skipped++;
        }
        console.log(`[vm-agent] New-format archive: ${copied} copied, ${skipped} skipped (kept local)`);
      } else {
        const files = fs.readdirSync(extractDir);
        for (const f of files) {
          const src = `${extractDir}/${f}`;
          const st = fs.statSync(src);
          if (!st.isFile()) continue;
          if (f === 'memory.db-wal' || f === 'memory.db-shm') {
            skipped++;
            continue;
          }
          if (f === 'memory.db') {
            const result = mergeMemoryDb(src, `${AGENT_DATA_DIR}/${f}`);
            if (result.ok) {
              if (result.copied) copied++; else copied++;
              console.log('[vm-agent] memory.db merged from legacy archive:', JSON.stringify(result.stats || { reason: result.reason }));
            } else {
              console.warn('[vm-agent] memory.db merge failed; falling back to mtime copy:', result.error);
              const copiedResult = mergeCopy(src, `${AGENT_DATA_DIR}/${f}`);
              if (copiedResult.copied) copied++; else skipped++;
            }
            continue;
          }
          const result = mergeCopy(src, `${AGENT_DATA_DIR}/${f}`);
          if (result.copied) copied++; else skipped++;
        }
        console.log(`[vm-agent] Legacy archive: ${copied} copied, ${skipped} skipped (kept local)`);
      }

      // Legacy archives may store workflow.db at archive root (outside agent/)
      const rootWorkflowDb = `${extractDir}/workflow.db`;
      if (fs.existsSync(rootWorkflowDb)) {
        const result = mergeCopy(rootWorkflowDb, `${AGENT_DATA_DIR}/workflow.db`);
        if (result.copied) copied++;
        else skipped++;
        console.log(`[vm-agent] workflow.db from archive root: ${result.reason}`);
      }

      // Restore device keys if the archive carries them — this is what lets
      // the VM actually *decrypt* rows written by the desktop. Without this,
      // memory.db exists on disk but lists as empty because each row is
      // AES-GCM encrypted with the desktop's local device key.
      const extractedKeysDir = `${extractDir}/.stuard_keys`;
      if (fs.existsSync(extractedKeysDir)) {
        try {
          const keysDest = `${require('os').homedir()}/.stuard/keys`;
          fs.mkdirSync(keysDest, { recursive: true, mode: 0o700 });
          for (const f of fs.readdirSync(extractedKeysDir)) {
            const src = `${extractedKeysDir}/${f}`;
            const dst = `${keysDest}/${f}`;
            if (!fs.statSync(src).isFile()) continue;
            // Only install if we don't already have a key; never overwrite a
            // pre-existing VM-local key silently.
            if (!fs.existsSync(dst)) {
              fs.copyFileSync(src, dst);
              try { fs.chmodSync(dst, 0o600); } catch { /* best-effort */ }
            }
          }
          console.log('[vm-agent] Device keys installed from archive');
        } catch (e: any) {
          console.warn('[vm-agent] Failed to install device keys:', e?.message);
        }
      }

      // Restore lancedb if present (vector store used by RAG; lancedb manages
      // its own manifest so a plain cp is acceptable here).
      const extractedLancedb = `${extractDir}/lancedb`;
      if (fs.existsSync(extractedLancedb)) {
        const vmLancedb = `${process.env.STUARD_VM_ROOT || '/home/stuard'}/lancedb`;
        execFileSync('cp', ['-a', extractedLancedb, vmLancedb], { timeout: 120_000 });
        console.log(`[vm-agent] LanceDB embeddings restored to ${vmLancedb}`);
      }

      try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch {}
      try { fs.unlinkSync(tempPath); } catch {}

      const restored = fs.readdirSync(AGENT_DATA_DIR);
      console.log(`[vm-agent] Agent data dir now contains: ${restored.join(', ')}`);
      return { ok: true, direction: 'download', mode, files: restored };
    } catch (e: any) {
      try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch {}
      try { fs.unlinkSync(tempPath); } catch {}
      return { ok: false, error: e?.message || 'sync_download_failed' };
    }
  }
  return { ok: false, error: 'invalid direction — use upload or download' };
}

// ─────────────────────────────────────────────────────────────────────────────
// OAuth Token Storage (synced from cloud-ai)
// ─────────────────────────────────────────────────────────────────────────────

const OAUTH_TOKENS_PATH = `${AGENT_DATA_DIR}/oauth-tokens.json`;

interface StoredOAuthToken {
  provider: string;
  profileLabel: string;
  isDefault: boolean;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  scopes: string[];
  accountEmail: string | null;
  syncedAt: string;
}

let _oauthTokens: StoredOAuthToken[] = [];

function loadOAuthTokens(): StoredOAuthToken[] {
  try {
    if (fs.existsSync(OAUTH_TOKENS_PATH)) {
      _oauthTokens = JSON.parse(fs.readFileSync(OAUTH_TOKENS_PATH, 'utf-8'));
    }
  } catch { _oauthTokens = []; }
  return _oauthTokens;
}

function saveOAuthTokens(): void {
  try {
    fs.mkdirSync(AGENT_DATA_DIR, { recursive: true });
    fs.writeFileSync(OAUTH_TOKENS_PATH, JSON.stringify(_oauthTokens, null, 2));
  } catch (e: any) {
    console.error('[vm-agent] Failed to save OAuth tokens:', e?.message);
  }
}

function storeOAuthTokens(args: any): any {
  const tokens = args.tokens;
  if (!Array.isArray(tokens)) return { ok: false, error: 'tokens must be an array' };

  const now = new Date().toISOString();
  const incoming: StoredOAuthToken[] = tokens.map((t: any) => ({
    provider: String(t.provider || ''),
    profileLabel: String(t.profileLabel || 'default'),
    isDefault: !!t.isDefault,
    accessToken: String(t.accessToken || ''),
    refreshToken: t.refreshToken || null,
    expiresAt: t.expiresAt || null,
    scopes: Array.isArray(t.scopes) ? t.scopes : [],
    accountEmail: t.accountEmail || null,
    syncedAt: now,
  }));
  if (args.replace === false) {
    if (_oauthTokens.length === 0) loadOAuthTokens();
    for (const next of incoming) {
      const previous = _oauthTokens.find((saved) =>
        next.provider.toLowerCase() === saved.provider.toLowerCase() &&
        next.profileLabel === saved.profileLabel
      );
      if (!previous) continue;
      if (!next.refreshToken && previous.refreshToken) next.refreshToken = previous.refreshToken;
      next.scopes = Array.from(new Set([
        ...(Array.isArray(previous.scopes) ? previous.scopes : []),
        ...(Array.isArray(next.scopes) ? next.scopes : []),
      ]));
    }
    const existing = _oauthTokens.filter((saved) => !incoming.some((next: StoredOAuthToken) =>
      next.provider.toLowerCase() === saved.provider.toLowerCase() &&
      next.profileLabel === saved.profileLabel
    ));
    _oauthTokens = [...existing, ...incoming];
  } else {
    _oauthTokens = incoming;
  }
  saveOAuthTokens();
  console.log(`[vm-agent] Stored ${_oauthTokens.length} OAuth tokens`);
  return { ok: true, count: _oauthTokens.length };
}

function removeOAuthTokens(args: any): any {
  const provider = String(args?.provider || '').trim().toLowerCase();
  const profileLabel = typeof args?.profileLabel === 'string' && args.profileLabel.trim()
    ? args.profileLabel.trim()
    : '';
  if (!provider) return { ok: false, error: 'provider_required' };

  loadOAuthTokens();
  const before = _oauthTokens.length;
  _oauthTokens = _oauthTokens.filter((token) => {
    const providerMatches = token.provider.toLowerCase() === provider;
    const profileMatches = !profileLabel || token.profileLabel === profileLabel;
    return !(providerMatches && profileMatches);
  });
  const removed = before - _oauthTokens.length;
  saveOAuthTokens();
  console.log(`[vm-agent] Removed ${removed} OAuth token(s) for ${provider}${profileLabel ? `/${profileLabel}` : ''}`);
  return { ok: true, removed, count: _oauthTokens.length };
}

function getOAuthToken(args: any): any {
  const provider = String(args.provider || '').toLowerCase();
  const profileLabel = args.profileLabel || 'default';

  if (_oauthTokens.length === 0) loadOAuthTokens();

  const match = _oauthTokens.find(t =>
    t.provider.toLowerCase() === provider &&
    (t.profileLabel === profileLabel || t.isDefault)
  );

  if (!match) return { ok: false, error: `no_token_for_${provider}` };
  return { ok: true, token: match };
}

/**
 * Return the VM-local OAuth token list with secrets stripped — used by the
 * VM Settings panel so users can see which integrations are *actually* on
 * the VM (vs. just connected on the desktop). Never returns access/refresh
 * tokens; only the metadata needed to render UI.
 */
function listOAuthTokensSafe(): any {
  if (_oauthTokens.length === 0) loadOAuthTokens();
  const now = Date.now();
  const tokens = _oauthTokens.map(t => {
    const expiresAtMs = t.expiresAt ? new Date(t.expiresAt).getTime() : null;
    const expired = expiresAtMs !== null && !isNaN(expiresAtMs) && expiresAtMs < now;
    return {
      provider: t.provider,
      profileLabel: t.profileLabel || 'default',
      isDefault: !!t.isDefault,
      accountEmail: t.accountEmail || null,
      scopes: Array.isArray(t.scopes) ? t.scopes : [],
      hasAccessToken: !!t.accessToken,
      hasRefreshToken: !!t.refreshToken,
      expiresAt: t.expiresAt || null,
      expired,
      syncedAt: t.syncedAt || null,
    };
  });
  return { ok: true, tokens, count: tokens.length };
}

// Load tokens on startup
loadOAuthTokens();

// ─────────────────────────────────────────────────────────────────────────────
// Browser Profile Sync (desktop→VM) — syncs default browser profile (cookies)
// ─────────────────────────────────────────────────────────────────────────────

const BROWSER_PROFILE_DIR = process.env.STUARD_BROWSER_PROFILE_DIR || '/home/stuard/browser-profiles';

function syncBrowserProfile(args: any): any {
  const profile = String(args.profile || 'default');
  const cookies = args.cookies; // array of CDP cookie objects

  if (!Array.isArray(cookies)) {
    return { ok: false, error: 'cookies must be an array' };
  }

  const profileDir = `${BROWSER_PROFILE_DIR}/${profile}`;
  try {
    fs.mkdirSync(profileDir, { recursive: true });

    // Write cookie backup in the same format the browser server expects
    // (stuard_cookies.json — restored on browser launch via CDP Network.setCookies)
    const cookiePath = `${profileDir}/stuard_cookies.json`;
    fs.writeFileSync(cookiePath, JSON.stringify(cookies), 'utf-8');

    console.log(`[vm-agent] Synced ${cookies.length} cookies to browser profile "${profile}"`);
    return { ok: true, profile, cookieCount: cookies.length };
  } catch (e: any) {
    console.error('[vm-agent] Failed to sync browser profile:', e?.message);
    return { ok: false, error: String(e?.message || 'sync_failed') };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Chat Sync (desktop→VM) — receives conversation updates from cloud-ai
// ─────────────────────────────────────────────────────────────────────────────

function handleChatSync(args: any): any {
  const { action, conversationId, data } = args || {};
  if (!conversationId) return { ok: false, error: 'missing_conversation_id' };

  if (action === 'new_conversation') {
    sendToAgent({
      type: 'tool_exec',
      tool: 'conversation_create',
      args: {
        conversation_id: conversationId,
        title: data?.title || undefined,
        model: data?.model || undefined,
        source: 'stuard',
      },
    }, 10_000).catch(() => {});
  } else if (action === 'new_message') {
    const role = data?.role || 'assistant';
    const content = data?.content || '';
    if (content) {
      // message_add auto-creates the conversation if it doesn't exist yet.
      sendToAgent({
        type: 'tool_exec',
        tool: 'message_add',
        args: { conversation_id: conversationId, role, content },
      }, 10_000).catch(() => {});
    }
  } else if (action === 'title_update' && data?.title) {
    sendToAgent({
      type: 'tool_exec',
      tool: 'conversation_update',
      args: { conversation_id: conversationId, title: data.title },
    }, 10_000).catch(() => {});
  }

  return { ok: true, action, conversationId };
}

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot Helpers (hardened — no shell interpolation)
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_SNAPSHOT_ROOTS = ['/home/stuard', '/opt/stuard'];

function validateSnapshotPath(p: string): string {
  const resolved = require('path').resolve(p);
  if (!ALLOWED_SNAPSHOT_ROOTS.some(root => resolved === root || resolved.startsWith(root + '/'))) {
    throw new Error(`Snapshot path outside allowed roots: ${resolved}`);
  }
  return resolved;
}

async function createSnapshotArchive(targetPath: string): Promise<{ archivePath: string; sizeBytes: number }> {
  const { execFileSync } = require('child_process');
  const fs = require('fs');
  const safePath = validateSnapshotPath(targetPath);
  const archivePath = `/tmp/snapshot-${Date.now()}.tar.gz`;
  execFileSync('tar', ['-czf', archivePath, '-C', safePath, '.'], { timeout: 300_000 });
  const stats = fs.statSync(archivePath);
  return { archivePath, sizeBytes: stats.size };
}

async function restoreSnapshotArchive(url: string, targetPath: string): Promise<{ success: boolean }> {
  const { execFileSync } = require('child_process');
  const fs = require('fs');
  const safePath = validateSnapshotPath(targetPath);
  const tempPath = `/tmp/restore-${Date.now()}.tar.gz`;

  await new Promise<void>((resolve, reject) => {
    const mod = url.startsWith('https') ? require('https') : require('http');
    const file = fs.createWriteStream(tempPath);
    const req = mod.get(url, (res: any) => {
      if (res.statusCode !== 200) {
        fs.unlinkSync(tempPath);
        return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    });
    req.on('error', (e: any) => {
      try { fs.unlinkSync(tempPath); } catch {}
      reject(e);
    });
    req.setTimeout(600_000, () => { req.destroy(); reject(new Error('Download timeout')); });
  });

  execFileSync('tar', ['-xzf', tempPath, '-C', safePath], { timeout: 300_000 });
  try { fs.unlinkSync(tempPath); } catch {}
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP Server
// ─────────────────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';
  const method = req.method || 'GET';

  // Health probe — no auth required
  if (method === 'GET' && url === '/health') {
    const memStore = getVMMemoryStore();
    const proactive = getVMProactiveScheduler();
    json(res, 200, {
      ok: true,
      agentVersion: AGENT_VERSION,
      userId: USER_ID,
      uptime: Math.round(process.uptime()),
      timestamp: Date.now(),
      capabilities: [
        'chat', 'execute', 'deploy', 'terminal', 'memory',
        'proactive', 'sync', 'desktop-bridge',
      ],
      memory: {
        totalMemories: memStore.getStats().totalMemories,
        totalConversations: memStore.getStats().totalConversations,
      },
      proactive: {
        enabled: proactive.getStatus().enabled,
        pendingTasks: proactive.getStatus().pendingTasks,
      },
      deploys: deployExecutor.list().length,
      pythonAgent: isAgentWsConnected() ? 'connected' : 'disconnected',
    });
    return;
  }

  // Auth check for all other endpoints
  const authHeader = authHeaderFromRequest(req);
  if (!verifyBearerToken(authHeader)) {
    json(res, 401, { ok: false, error: 'unauthorized' });
    return;
  }

  // ── Localhost preview proxy: /proxy/<port>/<path...> ────────────────
  // Streams the request straight to 127.0.0.1:<port>/<path> and pipes the
  // response back. Used by cloud-ai's /v1/cloud-engine/preview/* to surface
  // dev servers (Next.js, Vite, etc.) running inside the VM.
  if (url.startsWith('/proxy/')) {
    const m = url.match(/^\/proxy\/(\d+)(\/[^?]*)?(\?.*)?$/);
    if (!m) { json(res, 400, { ok: false, error: 'bad_proxy_url' }); return; }
    const port = Number(m[1]);
    const upstreamPath = (m[2] || '/') + (m[3] || '');
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      json(res, 400, { ok: false, error: 'bad_port' });
      return;
    }
    proxyToLocalhostHttp(req, res, port, upstreamPath);
    return;
  }

  // GET /metrics
  if (method === 'GET' && url === '/metrics') {
    try {
      const metrics = collectMetrics();
      json(res, 200, { ok: true, metrics, agentVersion: AGENT_VERSION, activeSessions: shellExecutor.getActiveSessions() });
    } catch (e: any) {
      json(res, 500, { ok: false, error: e?.message });
    }
    return;
  }

  // ── Agent Chat & Execute ─────────────────────────────────────────────

  // POST /agent/chat — send chat message to agent
  if (method === 'POST' && url === '/agent/chat') {
    try {
      const body = await readBody(req, 5 * 1024 * 1024);
      const result = await handleCommand('agent_chat', body);
      json(res, 200, { ok: true, result });
    } catch (e: any) {
      json(res, 500, { ok: false, error: e?.message || 'agent_chat_failed' });
    }
    return;
  }

  // POST /agent/chat/stream — streaming chat (NDJSON)
  if (method === 'POST' && url === '/agent/chat/stream') {
    try {
      const body = await readBody(req, 5 * 1024 * 1024);
      await handleAgentChatStream(body, res);
    } catch (e: any) {
      if (!res.headersSent) {
        json(res, 500, { ok: false, error: e?.message || 'agent_chat_stream_failed' });
      }
    }
    return;
  }

  // POST /agent/execute — execute headless agent task
  if (method === 'POST' && url === '/agent/execute') {
    try {
      const body = await readBody(req, 5 * 1024 * 1024);
      const result = await handleCommand('agent_execute', body);
      json(res, 200, { ok: true, result });
    } catch (e: any) {
      json(res, 500, { ok: false, error: e?.message || 'agent_execute_failed' });
    }
    return;
  }

  // ── Memory Endpoints ─────────────────────────────────────────────────

  if (method === 'POST' && url.startsWith('/memory/')) {
    try {
      const body = await readBody(req);
      const action = url.slice('/memory/'.length).replace(/\/$/, '');
      const command = `memory_${action.replace(/\//g, '_')}`;
      const result = await handleCommand(command, body);
      json(res, 200, { ok: true, result });
    } catch (e: any) {
      json(res, 500, { ok: false, error: e?.message || 'memory_operation_failed' });
    }
    return;
  }

  if (method === 'GET' && url === '/memory/stats') {
    try {
      const result = await handleCommand('memory_stats', {});
      json(res, 200, { ok: true, result });
    } catch (e: any) {
      json(res, 500, { ok: false, error: e?.message });
    }
    return;
  }

  if (method === 'GET' && url === '/memory/topics') {
    try {
      const result = await handleCommand('memory_topics', {});
      json(res, 200, { ok: true, result });
    } catch (e: any) {
      json(res, 500, { ok: false, error: e?.message });
    }
    return;
  }

  // ── Proactive Endpoints ──────────────────────────────────────────────

  if (method === 'GET' && url === '/proactive/status') {
    try {
      const result = await handleCommand('proactive_status', {});
      json(res, 200, { ok: true, result });
    } catch (e: any) {
      json(res, 500, { ok: false, error: e?.message });
    }
    return;
  }

  if (method === 'POST' && url.startsWith('/proactive/')) {
    try {
      const body = await readBody(req);
      const action = url.slice('/proactive/'.length).replace(/\/$/, '');
      const command = `proactive_${action.replace(/\//g, '_')}`;
      const result = await handleCommand(command, body);
      json(res, 200, { ok: true, result });
    } catch (e: any) {
      json(res, 500, { ok: false, error: e?.message || 'proactive_operation_failed' });
    }
    return;
  }

  // POST /command
  if (method === 'POST' && url === '/command') {
    try {
      const body = await readBody(req);
      const command = String(body.command || '');
      const args = body.args || {};
      if (!command) {
        json(res, 400, { ok: false, error: 'missing_command' });
        return;
      }
      const result = await handleCommand(command, args);
      // Propagate inner ok status so callers (cloud-ai sendVMCommand) see actual success/failure
      const innerOk = result && typeof result === 'object' && 'ok' in result ? !!result.ok : true;
      json(res, 200, { ok: innerOk, result, error: innerOk ? undefined : result?.error });
    } catch (e: any) {
      json(res, 500, { ok: false, error: e?.message || 'command_failed' });
    }
    return;
  }

  // ── Terminal endpoints ─────────────────────────────────────────────────

  // POST /terminal/open
  if (method === 'POST' && url === '/terminal/open') {
    try {
      const body = await readBody(req);
      const sessionId = body.sessionId || randomUUID();
      const session = await shellExecutor.create(sessionId, body.cols || 80, body.rows || 24);
      json(res, 200, { ok: true, sessionId, pid: session.pid });
    } catch (e: any) {
      json(res, 500, { ok: false, error: e?.message || 'terminal_open_failed' });
    }
    return;
  }

  // POST /terminal/data  (write input to terminal)
  if (method === 'POST' && url === '/terminal/data') {
    try {
      const body = await readBody(req);
      shellExecutor.write(body.sessionId, body.data);
      json(res, 200, { ok: true });
    } catch (e: any) {
      json(res, 500, { ok: false, error: e?.message });
    }
    return;
  }

  // POST /terminal/resize
  if (method === 'POST' && url === '/terminal/resize') {
    try {
      const body = await readBody(req);
      shellExecutor.resize(body.sessionId, body.cols, body.rows);
      json(res, 200, { ok: true });
    } catch (e: any) {
      json(res, 500, { ok: false, error: e?.message });
    }
    return;
  }

  // POST /terminal/close
  if (method === 'POST' && url === '/terminal/close') {
    try {
      const body = await readBody(req);
      shellExecutor.destroy(body.sessionId);
      json(res, 200, { ok: true });
    } catch (e: any) {
      json(res, 500, { ok: false, error: e?.message });
    }
    return;
  }

  // POST /terminal/read  (poll terminal output buffer)
  if (method === 'POST' && url === '/terminal/read') {
    try {
      const body = await readBody(req);
      const output = shellExecutor.readBuffer(body.sessionId);
      json(res, 200, { ok: true, data: output });
    } catch (e: any) {
      json(res, 500, { ok: false, error: e?.message });
    }
    return;
  }

  // ── Sync endpoints (hot disk ↔ GCS cold storage) ─────────────────────

  // POST /sync/upload — compress workspace and upload to GCS via signed URL
  if (method === 'POST' && url === '/sync/upload') {
    try {
      const body = await readBody(req);
      const { uploadUrl, objectName } = body;
      if (!uploadUrl) {
        json(res, 400, { ok: false, error: 'missing_upload_url' });
        return;
      }

      const { execFileSync } = require('child_process');
      const workspacePath = process.env.STUARD_WORKSPACE || '/home/stuard';
      const archivePath = `/tmp/sync-upload-${Date.now()}.tar.gz`;

      // Compress workspace
      console.log(`[vm-agent] Compressing workspace ${workspacePath} for sync upload...`);
      execFileSync('tar', ['-czf', archivePath, '-C', workspacePath, '.'], { timeout: 600_000 });
      const stats = fs.statSync(archivePath);
      console.log(`[vm-agent] Archive created: ${stats.size} bytes`);

      // Upload to GCS via signed URL without buffering the full archive in memory
      await uploadArchive(uploadUrl, archivePath);

      // Cleanup temp file
      try { fs.unlinkSync(archivePath); } catch {}

      console.log(`[vm-agent] Sync upload complete: ${objectName} (${stats.size} bytes)`);
      json(res, 200, { ok: true, objectName, bytes: stats.size });
    } catch (e: any) {
      console.error('[vm-agent] sync/upload error:', e?.message);
      json(res, 500, { ok: false, error: e?.message || 'sync_upload_failed' });
    }
    return;
  }

  // POST /sync/download — download backup from GCS and extract to workspace
  if (method === 'POST' && url === '/sync/download') {
    try {
      const body = await readBody(req);
      const { downloadUrl, objectName } = body;
      if (!downloadUrl) {
        json(res, 400, { ok: false, error: 'missing_download_url' });
        return;
      }

      const { execFileSync } = require('child_process');
      const workspacePath = process.env.STUARD_WORKSPACE || '/home/stuard';
      const tempPath = `/tmp/sync-download-${Date.now()}.tar.gz`;

      // Download from GCS via signed URL without materializing the full archive in memory
      console.log(`[vm-agent] Downloading backup ${objectName} for restore...`);
      const bytes = await downloadArchive(downloadUrl, tempPath);
      console.log(`[vm-agent] Downloaded ${bytes} bytes`);

      // Ensure workspace dir exists
      fs.mkdirSync(workspacePath, { recursive: true });

      // Extract to workspace
      execFileSync('tar', ['-xzf', tempPath, '-C', workspacePath], { timeout: 600_000 });
      try { fs.unlinkSync(tempPath); } catch {}

      // Bring back long-lived non-workflow deploys after cold restore.
      const restoredDeploys = await deployExecutor.restoreAll().catch((e: any) => ({
        restored: [] as string[],
        skipped: [] as string[],
        failed: [{ id: 'restore_all', error: String(e?.message || e) }],
      }));

      console.log(`[vm-agent] Sync restore complete: ${objectName}`);
      json(res, 200, { ok: true, objectName, bytes, restoredDeploys });
    } catch (e: any) {
      console.error('[vm-agent] sync/download error:', e?.message);
      json(res, 500, { ok: false, error: e?.message || 'sync_download_failed' });
    }
    return;
  }

  json(res, 404, { ok: false, error: 'not_found' });
});

const proxyWss = new WebSocketServer({ noServer: true });

// ─────────────────────────────────────────────────────────────────────────────
// Localhost preview proxy
//
// Forwards an inbound HTTP/WS request to 127.0.0.1:<port>/<path>. The cloud-ai
// preview route already authenticated the user; we trust the bearer token here
// and just pipe bytes. Headers (including Content-Length, Transfer-Encoding,
// streamed chunks) pass through untouched so SSE/long polls work.
// ─────────────────────────────────────────────────────────────────────────────

function proxyToLocalhostHttp(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  port: number,
  upstreamPath: string,
): void {
  const headers: http.OutgoingHttpHeaders = { ...req.headers };
  // Hop-by-hop headers must not be forwarded — and Host must be rewritten
  // to localhost so the upstream doesn't reject vhost-routed requests.
  delete headers['host'];
  delete headers['connection'];
  delete headers['keep-alive'];
  delete headers['proxy-authenticate'];
  delete headers['proxy-authorization'];
  delete headers['te'];
  delete headers['trailer'];
  delete headers['upgrade'];
  // Strip our own bearer token so the dev server doesn't see it.
  delete headers['authorization'];
  headers['host'] = `127.0.0.1:${port}`;

  const upstream = http.request({
    host: '127.0.0.1',
    port,
    method: req.method,
    path: upstreamPath,
    headers,
  });

  const cleanup = () => {
    try { upstream.destroy(); } catch {}
  };

  upstream.on('response', (upRes) => {
    const outHeaders = { ...upRes.headers };
    delete outHeaders['connection'];
    delete outHeaders['keep-alive'];
    delete outHeaders['transfer-encoding'];
    res.writeHead(upRes.statusCode || 502, upRes.statusMessage, outHeaders);
    upRes.pipe(res);
    upRes.on('error', cleanup);
  });

  upstream.on('error', (err: any) => {
    if (!res.headersSent) {
      json(res, 502, { ok: false, error: 'upstream_unavailable', detail: String(err?.message || err) });
    } else {
      try { res.end(); } catch {}
    }
  });

  res.on('close', cleanup);
  req.pipe(upstream);
}

function proxyToLocalhostWebSocket(
  req: http.IncomingMessage,
  socket: import('stream').Duplex,
  head: Buffer,
  port: number,
  upstreamPath: string,
): void {
  // Re-build the WS upgrade request and send it to the local dev server.
  // We use a raw socket so we can transparently relay handshake + frames
  // without needing a `ws` client to interpret them.
  const headerLines: string[] = [];
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (name.toLowerCase() === 'host') continue;
    if (name.toLowerCase() === 'authorization') continue;
    if (Array.isArray(value)) {
      for (const v of value) headerLines.push(`${name}: ${v}`);
    } else {
      headerLines.push(`${name}: ${value}`);
    }
  }
  headerLines.unshift(`Host: 127.0.0.1:${port}`);

  const handshake =
    `GET ${upstreamPath} HTTP/1.1\r\n` +
    headerLines.join('\r\n') +
    `\r\n\r\n`;

  const net = require('net') as typeof import('net');
  const upstream = net.connect(port, '127.0.0.1');

  const closeBoth = () => {
    try { upstream.destroy(); } catch {}
    try { socket.destroy(); } catch {}
  };

  upstream.on('connect', () => {
    upstream.write(handshake);
    if (head && head.length) upstream.write(head);
    socket.pipe(upstream);
    upstream.pipe(socket);
  });

  upstream.on('error', () => {
    try {
      socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    } catch {}
    closeBoth();
  });

  socket.on('error', closeBoth);
  socket.on('close', closeBoth);
  upstream.on('close', closeBoth);
}

proxyWss.on('connection', (clientWs) => {
  const upstreamWs = new WebSocket(LOCAL_AGENT_WS_URL);
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
    const frame = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
    if (upstreamOpen && upstreamWs.readyState === WebSocket.OPEN) {
      upstreamWs.send(frame, { binary: isBinary });
      return;
    }
    if (upstreamWs.readyState === WebSocket.CONNECTING) {
      pendingFrames.push({ data: frame, isBinary });
      return;
    }
    closeClient(1011, 'vm_local_agent_unavailable');
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
        clientWs.send(JSON.stringify({ type: 'error', message: `vm_local_agent_proxy_failed: ${String(err?.message || err)}` }));
      }
    } catch {}
    closeClient(1011, 'vm_local_agent_proxy_failed');
    closeUpstream();
  });
});

server.on('upgrade', (req, socket, head) => {
  let parsed: URL;
  try {
    parsed = new URL(req.url || '/', 'http://localhost');
  } catch {
    socket.destroy();
    return;
  }

  // Auth gate for all upgrades.
  if (!verifyBearerToken(authHeaderFromRequest(req))) {
    try { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); } catch {}
    socket.destroy();
    return;
  }

  // Localhost preview proxy upgrade — forwards WS frames to 127.0.0.1:<port>.
  // HMR (Next/Vite/CRA) relies on this.
  const proxyMatch = parsed.pathname.match(/^\/proxy\/(\d+)(\/.*)?$/);
  if (proxyMatch) {
    const port = Number(proxyMatch[1]);
    const upstreamPath = (proxyMatch[2] || '/') + (parsed.search || '');
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      try { socket.write('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch {}
      socket.destroy();
      return;
    }
    proxyToLocalhostWebSocket(req, socket, head, port, upstreamPath);
    return;
  }

  if (parsed.pathname === '/ws') {
    proxyWss.handleUpgrade(req, socket, head, (ws) => {
      proxyWss.emit('connection', ws, req);
    });
    return;
  }

  socket.destroy();
});

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────────────────────────

export function startAgent(): void {
  console.log('[vm-agent] ═══════════════════════════════════════════════');
  console.log('[vm-agent] Starting Stuard VM Agent v' + AGENT_VERSION);
  console.log('[vm-agent] ═══════════════════════════════════════════════');
  console.log(`[vm-agent] User: ${USER_ID}`);
  console.log(`[vm-agent] HTTP server on port ${PORT}`);
  console.log(`[vm-agent] Python agent WS: ${LOCAL_AGENT_WS_URL}`);

  // Restore the last desktop-pushed timezone before any scheduler boots — the
  // bot scheduler reads process.env.TZ when registering cron jobs in start().
  restoreUserTimezone();

  initMetrics();

  // Initialize memory store
  const memStore = getVMMemoryStore();
  console.log(`[vm-agent] Memory store: ${memStore.getStats().totalMemories} memories, ${memStore.getStats().totalConversations} conversations`);

  // Initialize proactive scheduler (legacy single-config path; will retire
  // once all users have migrated to the multi-bot scheduler below).
  const proactive = getVMProactiveScheduler();
  const proactiveConfig = proactive.getConfig();
  if (proactiveConfig.enabled) {
    proactive.start();
    console.log(`[vm-agent] Proactive scheduler: enabled (interval=${proactiveConfig.intervalMs}ms)`);
  } else {
    console.log('[vm-agent] Proactive scheduler: disabled (enable via proactive_config command)');
  }

  // Initialize multi-bot scheduler — runs every cloud-target bot the desktop
  // has synced via the `bots_sync` command on its own intervals/cron triggers.
  const botScheduler = getVMBotScheduler();
  botScheduler.start();
  const botStatus = botScheduler.getStatus();
  console.log(`[vm-agent] Bot scheduler: started (${botStatus.botCount} bot${botStatus.botCount === 1 ? '' : 's'} loaded)`);

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[vm-agent] Listening on http://0.0.0.0:${PORT}`);

    // Connect to Python agent WS (non-blocking)
    getAgentWs().catch(() => {
      console.warn('[vm-agent] Python agent not yet available — will retry automatically');
    });

    // Restore deployments
    deployExecutor.restoreAll()
      .then((summary) => {
        if (summary.restored.length > 0 || summary.failed.length > 0) {
          console.log(`[vm-agent] Deploy restore: restored=${summary.restored.length} skipped=${summary.skipped.length} failed=${summary.failed.length}`);
        }
      })
      .catch((e: any) => {
        console.warn(`[vm-agent] Initial deploy restore failed: ${String(e?.message || e)}`);
      });

    // Periodic cleanup of expired memories (every hour)
    setInterval(() => {
      const removed = memStore.cleanupExpired();
      if (removed > 0) {
        console.log(`[vm-agent] Cleaned up ${removed} expired memories`);
      }
    }, 3600_000);

    // Periodic agent database sync to GCS — change-detection based (every 5 min)
    // Only uploads when knowledge.db/memory.db/lancedb have actually changed,
    // then notifies cloud-ai so it can relay to the desktop for bidirectional sync.
    snapshotMtimes(); // baseline after initial restore
    setInterval(() => periodicAgentDataSync(), SYNC_INTERVAL_MS);
    console.log(`[vm-agent] Agent data auto-sync: every ${SYNC_INTERVAL_MS / 60_000} min (change-detection)`);
  });

  // Graceful shutdown
  const shutdown = async (sig: string) => {
    console.log(`[vm-agent] Received ${sig}, shutting down...`);
    deployExecutor.stopAll();
    shellExecutor.destroyAll();
    proactive.destroy();
    botScheduler.destroy();
    memStore.destroy();
    // Final sync of agent databases before exit
    if (GCS_BUCKET) {
      await syncAgentData({ direction: 'upload', mode: 'delta' }).catch(() => {});
      console.log('[vm-agent] Final agent data sync complete');
    }
    closeAgentWs();
    server.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Auto-start if run directly
if (require.main === module) {
  startAgent();
}
