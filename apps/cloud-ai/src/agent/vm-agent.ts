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
import { randomUUID } from 'crypto';
import { createHmac, timingSafeEqual } from 'crypto';
import fs from 'fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { WebSocketServer, WebSocket } from 'ws';
import { collectMetrics, initMetrics } from './metrics-collector';
import { ShellExecutor } from './shell-executor';
import { DeployExecutor } from './deploy-executor';
import { getVMMemoryStore, type MemoryEntry } from './vm-memory';
import { getVMProactiveScheduler } from './vm-proactive';
import * as fileManager from './file-manager';
import { getAgentWs, sendToAgent, buildVMMemoryContext, isAgentWsConnected, closeAgentWs, LOCAL_AGENT_WS_URL } from './vm-agent-ws';

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

    // ── Tool Execution (proxy to Python agent) ─────────────────────────
    case 'tool_exec':
      return await handleToolExec(args);

    // ── Database Sync ────────────────────────────────────────────────────
    case 'sync_agent_data':
      return await syncAgentData(args);

    // ── OAuth Token Storage ──────────────────────────────────────────────
    case 'store_oauth_tokens':
      return storeOAuthTokens(args);
    case 'get_oauth_token':
      return getOAuthToken(args);

    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent Chat & Execute Handlers
// ─────────────────────────────────────────────────────────────────────────────

async function handleAgentChat(args: any): Promise<any> {
  const message = String(args.message || '').trim();
  if (!message) return { ok: false, error: 'empty_message' };

  const conversationId = args.conversationId || randomUUID();
  const model = args.model || 'balanced';

  try {
    // Build memory context from the synced SQLite DB via Python agent.
    // Returns a formatted text string matching desktop's format.
    const memoryContext = await buildVMMemoryContext(
      args.memoryQuery || message,
      args.queryEmbedding,
    );

    // Store user message in local DB (mirrors desktop's storeMessageLocally)
    sendToAgent({
      type: 'tool_exec',
      tool: 'message_add',
      args: { conversation_id: conversationId, role: 'user', content: message },
    }, 10_000).catch(() => {});

    // Forward chat to Python agent via WebSocket
    const result = await sendToAgent({
      type: 'chat',
      message,
      conversationId,
      model,
      context: {
        isVM: true,
        userId: USER_ID,
        ...(args.context || {}),
      },
      memoryContext,
    }, 180_000); // 3 min timeout for chat

    // Store assistant response and process turn (mirrors desktop's post-response flow)
    const assistantText = result?.text || '';
    if (assistantText) {
      processVMConversationTurn(conversationId, message, assistantText).catch((e) => {
        console.warn('[vm-agent] post-response memory processing failed:', e?.message);
      });
    }

    return { ok: true, conversationId, ...result };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'agent_chat_failed') };
  }
}

async function handleToolExec(args: any): Promise<any> {
  const tool = String(args.tool || '').trim();
  if (!tool) return { ok: false, error: 'missing tool name' };

  try {
    const result = await sendToAgent({
      type: 'tool_exec',
      tool,
      args: args.args || {},
    }, 120_000);
    return result;
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'tool_exec_failed') };
  }
}

async function handleAgentExecute(args: any): Promise<any> {
  const task = String(args.task || args.prompt || '').trim();
  if (!task) return { ok: false, error: 'empty_task' };

  const outputSchema = args.outputSchema || null;
  const tools = args.tools || null;
  const model = args.model || 'balanced';

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
  // Store assistant message
  await sendToAgent({
    type: 'tool_exec',
    tool: 'message_add',
    args: { conversation_id: conversationId, role: 'assistant', content: assistantMessage },
  }, 10_000).catch(() => {});

  // Get existing segments to determine current state
  const segListResult = await sendToAgent({
    type: 'tool_exec',
    tool: 'segment_list',
    args: { conversation_id: conversationId },
  }, 10_000).catch(() => null);

  const existingSegments: any[] = segListResult?.segments || segListResult?.result || [];
  const lastSegment = existingSegments[existingSegments.length - 1] || null;

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

function handleMemoryConversationsList(args: any): any {
  return { ok: true, conversations: getVMMemoryStore().listConversations(args.limit || 50) };
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
  return { ok: true, conversation: conv };
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
// Agent Database Sync (SQLite databases ↔ GCS)
// ─────────────────────────────────────────────────────────────────────────────

const AGENT_DATA_DIR = process.env.AGENT_DATA_DIR || '/home/stuard/agent-data';
const GCS_BUCKET = process.env.STUARD_GCS_BUCKET || '';

/** Request signed GCS URLs from the cloud-ai backend (VM → backend auth via HMAC). */
async function requestSignedUrls(): Promise<{ uploadUrl?: string; downloadUrl?: string } | null> {
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
    return data.ok ? { uploadUrl: data.uploadUrl, downloadUrl: data.downloadUrl } : null;
  } catch (e: any) {
    console.warn('[vm-agent] Failed to get signed URLs:', e?.message);
    return null;
  }
}

async function syncAgentData(args: any): Promise<any> {
  const direction = String(args.direction || 'upload').toLowerCase();
  const { execFileSync } = require('child_process');

  if (direction === 'upload') {
    if (!fs.existsSync(AGENT_DATA_DIR)) return { ok: false, error: 'agent_data_dir_missing' };

    const archivePath = `/tmp/agent-data-sync-${Date.now()}.tar.gz`;
    try {
      execFileSync('tar', ['-czf', archivePath, '-C', AGENT_DATA_DIR, '.'], { timeout: 120_000 });
      const stats = fs.statSync(archivePath);

      // Get signed upload URL (from command args, or request from backend)
      let uploadUrl = args.uploadUrl;
      if (!uploadUrl) {
        const urls = await requestSignedUrls();
        uploadUrl = urls?.uploadUrl;
      }
      if (!uploadUrl) {
        try { fs.unlinkSync(archivePath); } catch {}
        return { ok: false, error: 'no_upload_url' };
      }

      // Upload directly to GCS via signed URL
      const archiveData = fs.readFileSync(archivePath);
      const resp = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/gzip' },
        body: archiveData,
        signal: AbortSignal.timeout(120_000),
      });
      try { fs.unlinkSync(archivePath); } catch {}
      if (!resp.ok) return { ok: false, error: `gcs_upload_http_${resp.status}` };

      console.log(`[vm-agent] Agent data uploaded via signed URL (${stats.size} bytes)`);
      return { ok: true, direction: 'upload', bytes: stats.size };
    } catch (e: any) {
      try { fs.unlinkSync(archivePath); } catch {}
      return { ok: false, error: e?.message || 'sync_upload_failed' };
    }
  } else if (direction === 'download') {
    // Get signed download URL (from command args, or request from backend)
    let downloadUrl = args.downloadUrl;
    if (!downloadUrl) {
      const urls = await requestSignedUrls();
      downloadUrl = urls?.downloadUrl;
    }
    if (!downloadUrl) return { ok: false, error: 'no_download_url' };

    const tempPath = `/tmp/agent-data-download-${Date.now()}.tar.gz`;
    const extractDir = `/tmp/agent-data-extract-${Date.now()}`;
    try {
      // Download from GCS via signed URL
      const resp = await fetch(downloadUrl, { signal: AbortSignal.timeout(120_000) });
      if (!resp.ok) return { ok: false, error: `download_http_${resp.status}` };
      const buffer = Buffer.from(await resp.arrayBuffer());
      fs.writeFileSync(tempPath, buffer);

      fs.mkdirSync(extractDir, { recursive: true });
      fs.mkdirSync(AGENT_DATA_DIR, { recursive: true });
      execFileSync('tar', ['-xzf', tempPath, '-C', extractDir], { timeout: 120_000 });

      // Handle new archive format (agent/knowledge.db, lancedb/..., workflow.db)
      const extractedAgentDir = `${extractDir}/agent`;
      if (fs.existsSync(extractedAgentDir)) {
        const agentFiles = fs.readdirSync(extractedAgentDir);
        for (const f of agentFiles) {
          fs.copyFileSync(`${extractedAgentDir}/${f}`, `${AGENT_DATA_DIR}/${f}`);
        }
        console.log(`[vm-agent] Restored ${agentFiles.length} files from new-format archive`);
      } else {
        const files = fs.readdirSync(extractDir);
        for (const f of files) {
          const src = `${extractDir}/${f}`;
          const st = fs.statSync(src);
          if (st.isFile()) fs.copyFileSync(src, `${AGENT_DATA_DIR}/${f}`);
        }
        console.log(`[vm-agent] Restored ${files.length} files from legacy archive`);
      }

      // Restore lancedb if present
      const extractedLancedb = `${extractDir}/lancedb`;
      if (fs.existsSync(extractedLancedb)) {
        const vmLancedb = `${process.env.STUARD_VM_ROOT || '/home/stuard'}/lancedb`;
        execFileSync('cp', ['-a', extractedLancedb, vmLancedb], { timeout: 30_000 });
        console.log(`[vm-agent] LanceDB embeddings restored to ${vmLancedb}`);
      }

      try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch {}
      try { fs.unlinkSync(tempPath); } catch {}

      const restored = fs.readdirSync(AGENT_DATA_DIR);
      console.log(`[vm-agent] Agent data dir now contains: ${restored.join(', ')}`);
      return { ok: true, direction: 'download', files: restored };
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
  _oauthTokens = tokens.map((t: any) => ({
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
  saveOAuthTokens();
  console.log(`[vm-agent] Stored ${_oauthTokens.length} OAuth tokens`);
  return { ok: true, count: _oauthTokens.length };
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

// Load tokens on startup
loadOAuthTokens();

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
      json(res, 200, { ok: true, result });
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

  if (parsed.pathname !== '/ws') {
    socket.destroy();
    return;
  }

  if (!verifyBearerToken(authHeaderFromRequest(req))) {
    try { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); } catch {}
    socket.destroy();
    return;
  }

  proxyWss.handleUpgrade(req, socket, head, (ws) => {
    proxyWss.emit('connection', ws, req);
  });
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

  initMetrics();

  // Initialize memory store
  const memStore = getVMMemoryStore();
  console.log(`[vm-agent] Memory store: ${memStore.getStats().totalMemories} memories, ${memStore.getStats().totalConversations} conversations`);

  // Initialize proactive scheduler
  const proactive = getVMProactiveScheduler();
  const proactiveConfig = proactive.getConfig();
  if (proactiveConfig.enabled) {
    proactive.start();
    console.log(`[vm-agent] Proactive scheduler: enabled (interval=${proactiveConfig.intervalMs}ms)`);
  } else {
    console.log('[vm-agent] Proactive scheduler: disabled (enable via proactive_config command)');
  }

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

    // Periodic agent database sync to GCS (every 30 minutes)
    if (GCS_BUCKET) {
      setInterval(() => {
        syncAgentData({ direction: 'upload' }).then((r) => {
          if (r.ok) console.log(`[vm-agent] Auto-synced agent data (${r.bytes} bytes)`);
        }).catch(() => {});
      }, 1800_000);
      console.log('[vm-agent] Agent data auto-sync: every 30 min');
    }
  });

  // Graceful shutdown
  const shutdown = async (sig: string) => {
    console.log(`[vm-agent] Received ${sig}, shutting down...`);
    deployExecutor.stopAll();
    shellExecutor.destroyAll();
    proactive.destroy();
    memStore.destroy();
    // Final sync of agent databases before exit
    if (GCS_BUCKET) {
      await syncAgentData({ direction: 'upload' }).catch(() => {});
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
