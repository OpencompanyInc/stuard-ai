import 'dotenv/config';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { getWorkflowAgent } from './agents/workflow-agent';
import { withClientBridge, handleClientToolMessage } from './tools/bridge';
import { routeModel, type ModelChoice } from './router/model-router';
import { verifyAccessToken, AuthErrorCode } from './auth';
import { createConversation, addAssistantMessage, addUserMessage, logUsageEvent, checkAccess, incrementDailyRequestCounter, finishRun, setConversationTitle, getExternalAccount } from './supabase';
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
import * as memoryService from './memory/conversations';

import { getAgentForQuery } from './agents/stuard/index';


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
  } catch {}
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
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
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
        try { client.terminate(); } catch {}
        wsAlive.delete(client);
        return;
      }
      wsAlive.set(client, false);
      try { client.ping(); } catch {}
    });
  } catch {}
}, PING_INTERVAL_MS);
server.on('close', () => { try { clearInterval(pingTimer); } catch {} });

import { handleSpeechConnection } from './routes/speech';

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
  } else {
    socket.destroy();
  }
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
  } catch {}
});

// Increase HTTP keep-alive and headers timeouts to be friendly to long-lived WS
try {
  (server as any).keepAliveTimeout = Number(process.env.CLOUD_HTTP_KEEPALIVE_MS || 120000);
  (server as any).headersTimeout = Number(process.env.CLOUD_HTTP_HEADERS_TIMEOUT_MS || 120000);
} catch {}

// Store conversation history per connection
const conversations = new WeakMap<WebSocket, Array<any>>();
// Persist conversationId per connection for authenticated users
const wsConversations = new WeakMap<WebSocket, string>();
// Anonymous resource/thread IDs per connection for memory when not authenticated
const anonResources = new WeakMap<WebSocket, string>();
const anonThreads = new WeakMap<WebSocket, string>();
// Store abort controllers per WebSocket for stop/cancel functionality
const wsAbortControllers = new WeakMap<WebSocket, AbortController>();

// Note: Server-side queuing removed - client handles per-tab queuing via requestId routing

wss.on('connection', (ws: WebSocket) => {
  send(ws, { type: 'handshake', origin: 'cloud-ai', message: 'connected' });
  conversations.set(ws, []);
  writeLog('ws_connected');
  try { wsAlive.set(ws, true); } catch {}
  try { ws.on('pong', () => { try { wsAlive.set(ws, true); } catch {} }); } catch {}
  try { ws.on('close', () => { writeLog('ws_disconnected'); }); } catch {}

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
      try { handleClientToolMessage(ws, msg); } catch {}
      return;
    }
    // Handle stop/abort request to cancel ongoing stream
    if (kind === 'stop' || kind === 'abort') {
      const controller = wsAbortControllers.get(ws);
      if (controller) {
        console.log('[cloud-ai] Aborting stream by user request');
        controller.abort();
        wsAbortControllers.delete(ws);
        send(ws, { type: 'stopped', success: true });
      } else {
        send(ws, { type: 'stopped', success: false, message: 'no active stream' });
      }
      return;
    }
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
        try { delete incomingCtx.outlookAccessToken; } catch {}
        try { (msg as any).context = incomingCtx; } catch {}
      }
      // Capture deviceId (non-secret) to target a specific desktop instance for memory jobs
      try { (msg as any).__deviceId = typeof incomingCtx?.deviceId === 'string' ? incomingCtx.deviceId : undefined; } catch {}
    } catch {}

    const secretBag: any = { ...(secrets || {}) };

    // Run EVERYTHING in background (don't await) to allow parallel processing across tabs
    // This moves auth, routing, and agent setup into the non-blocking bridge context
    withClientBridge(ws, async () => {
      let abortController: AbortController | null = null;
      let aggregatedText = '';
      let routedTier: ModelChoice = 'balanced';
      let chosenModelId: string | undefined;
      let conversationId: string | null = null;
      try {
        const messages = normalizeMessages(msg);
        const providedMessages = Array.isArray((msg as any)?.messages) ? (msg as any).messages : undefined;
        if (messages.length === 0) {
          send(ws, { type: 'error', message: 'empty prompt' }, requestId);
          return;
        }

        const accessToken = String(msg?.auth?.accessToken || '');
        const authResult = accessToken ? await verifyAccessToken(accessToken) : null;
        const authUser = authResult?.success ? { userId: authResult.userId!, email: authResult.email } : null;
        
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
            send(ws, { type: 'error', message: access.reason || 'access_denied', data: { plan: access.plan, limit: access.limit, used: access.used } }, requestId);
            return;
          }
          // Count this chat request towards daily usage
          try { await incrementDailyRequestCounter(authUser.userId); } catch {}
        }

        const requestedMode = normalizeTierChoice((msg as any)?.model);
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
        } catch {}

        let enabledIntegrations: string[] = [];
        let mcpTools: Record<string, any> = {};
        
        if (authUser) {
          // Check integrations
          const providers = ['github', 'google', 'outlook'];
          try {
            const checks = await Promise.all(providers.map(p => getExternalAccount(authUser.userId, p)));
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

        // Get conversation history for this connection
        const history = conversations.get(ws) || [];
        
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

        // Determine which agent/model to use
        const agentType = String((msg as any)?.agent || 'stuard').toLowerCase();
        const modelLabel = agentType === 'workflow' ? 'gemini-3-pro-preview' : (chosenModelId || routedTier);

        // Select agent based on type
        let agent: any;
        if (agentType === 'workflow') {
          try {
            agent = getWorkflowAgent();
            console.log('[cloud-ai] Using workflow agent (Gemini 3 Pro Preview)');
          } catch (e: any) {
            console.error('[cloud-ai] Failed to get workflow agent:', e.message);
            send(ws, { type: 'error', message: 'Workflow agent unavailable: ' + e.message }, requestId);
            return;
          }
        } else {
          agent = await getAgentForQuery(routedTier, prompt, undefined, enabledIntegrations, mcpTools, chosenModelId);
        }

        let conversationCreatedNow = false;
        if (authUser) {
          const resetRequested = !!(msg as any)?.resetConversation;
          if (resetRequested) {
            try { wsConversations.delete(ws); } catch {}
          }
          const requestedId = typeof (msg as any)?.conversationId === 'string' ? String((msg as any).conversationId).trim() : '';
          if (requestedId) {
            conversationId = requestedId;
          } else {
            conversationId = await createConversation(
              authUser.userId,
              prompt,
              modelLabel,
              { mode: requestedMode, tier: routedTier, modelId: chosenModelId }
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
        
        // Track metadata for persistence (reasoning, tools, stream chunks)
        let aggregatedReasoning = '';
        let reasoningStartTime: number | null = null;
        const toolCallsMap = new Map<string, any>(); // Track tool calls by ID
        type StreamChunk = { type: 'text'; content: string } | { type: 'reasoning'; content: string } | { type: 'tool'; tool: any };
        const streamChunks: StreamChunk[] = [];

        // Persist this user turn for ongoing conversations (first turn already stored on creation)
        if (authUser && conversationId && !conversationCreatedNow) {
          try {
            await addUserMessage(authUser.userId, conversationId, prompt, {
              mode: requestedMode,
              tier: routedTier,
              modelId: chosenModelId,
            });
          } catch {}
        }
        
        // Determine maxSteps for this run (per-message override -> env/default), with a safety cap
        // Workflow agent needs more steps for tool discovery and testing
        const reqMaxStepsRaw = (msg as any)?.maxSteps ?? (msg as any)?.limits?.maxSteps;
        let maxSteps = agentType === 'workflow' ? 60 : DEFAULT_MAX_STEPS;
        try {
          const n = Number(reqMaxStepsRaw);
          if (!isNaN(n) && n > 0) maxSteps = Math.min(n, MAX_STEPS_CAP);
        } catch {}

        // Prepend server time context (non-blocking - don't wait for client)
        try {
          const now = new Date();
          const timeMsg = `Current time: ${now.toISOString()}`;
          inputMessages = [{ role: 'system', content: timeMsg }, ...inputMessages];
        } catch {}

        // Add context paths (files/folders referenced via @) to system context
        try {
          const incomingCtx: any = (msg as any)?.context || {};
          const paths: Array<{ path: string; name: string; isDirectory: boolean }> = Array.isArray(incomingCtx?.paths) ? incomingCtx.paths : [];
          if (paths.length > 0) {
            const pathLines = paths.map(p => `- ${p.isDirectory ? '📁' : '📄'} ${p.name}: ${p.path}`).join('\n');
            const contextMsg = `The user is referencing these files/folders:\n${pathLines}\n\nYou can use the read_file or list_directory tools to access their contents if needed.`;
            inputMessages = [{ role: 'system', content: contextMsg }, ...inputMessages];
            console.log('[cloud-ai] Context paths added:', paths.length, 'items');
          }
        } catch {}


        // Apply user's persona and tone/style preferences if provided by the client
        try {
          const ctx: any = (msg as any)?.context || {};
          const personaRaw = typeof ctx?.persona === 'string' ? ctx.persona : '';
          const presetRaw = typeof ctx?.tonePreset === 'string' ? ctx.tonePreset : '';
          const preset = presetRaw ? String(presetRaw).toLowerCase() : '';
          const rawTone = typeof ctx?.tone === 'string' ? String(ctx.tone) : '';
          // Persona guidelines
          const persona = (personaRaw || '').trim();
          if (persona) {
            const personaMsg = `Behavior guidelines: ${persona}`;
            inputMessages = [{ role: 'system', content: personaMsg }, ...inputMessages];
          }
          // Tone guidelines
          let note = '';
          if (preset === 'custom' && rawTone.trim()) {
            note = `Tone & style: ${rawTone.trim()}`;
          } else if (preset) {
            const desc = preset === 'concise'
              ? 'Be brief and direct. Prefer short sentences and bullet lists.'
              : preset === 'friendly'
              ? 'Use a warm, approachable tone.'
              : preset === 'formal'
              ? 'Use a polite, professional tone.'
              : preset === 'technical'
              ? 'Be precise and technical; include implementation details when helpful.'
              : `Use a ${preset} tone.`;
            note = `Tone & style: ${desc}`;
          } else if (rawTone.trim()) {
            note = `Tone & style: ${rawTone.trim()}`;
          }
          if (note) {
            inputMessages = [{ role: 'system', content: note }, ...inputMessages];
          }
        } catch {}

        // Retrieve knowledge context and inject into messages
        try {
          const knowledgeCtx = await buildKnowledgeContext(prompt, {
            includeIdentity: true,
            includeDirectives: true,
            includeBio: true,
            maxGlobalFacts: 8,
            detectEntities: true,
          });
          if (knowledgeCtx.text.trim()) {
            console.log('[cloud-ai] Knowledge context retrieved:', {
              length: knowledgeCtx.text.length,
              entities: knowledgeCtx.detectedEntities,
              hasIdentity: knowledgeCtx.lenses.identity.length > 0,
              hasDirectives: knowledgeCtx.lenses.directives.length > 0,
              hasBio: knowledgeCtx.lenses.bio.length > 0,
              globalFacts: knowledgeCtx.lenses.globalSearch.length,
            });
            inputMessages = [{ role: 'system', content: knowledgeCtx.text }, ...inputMessages];
          }
        } catch (knowledgeErr) {
          console.error('[cloud-ai] Knowledge context retrieval failed:', knowledgeErr);
        }

        // Semantic search over past conversation segments (summary + conversation id)
        try {
          const query = String(prompt || '').trim();
          if (query) {
            const matches = await memoryService.searchSegments(query, { limit: 6, threshold: 0.5 });
            const similar = matches.filter(({ score }) => score >= 0.5);
            if (similar.length > 0) {
              const lines = ['[SIMILAR CONVERSATIONS]'];
              for (const { segment } of similar) {
                const summary = String(segment.summary || '').trim();
                if (!summary) continue;
                lines.push(`- ${segment.conversation_id}: ${summary}`);
              }
              if (lines.length > 1) {
                inputMessages = [{ role: 'system', content: lines.join('\n') }, ...inputMessages];
              }
            }
          }
        } catch (searchErr) {
          console.error('[cloud-ai] Semantic conversation search failed:', searchErr);
        }

        // Log system prompt for debugging
        const systemMessages = inputMessages.filter((m: any) => m.role === 'system');
        if (systemMessages.length > 0) {
          console.log('[cloud-ai] System prompt:', {
            sections: systemMessages.length,
            totalLength: systemMessages.reduce((sum: number, m: any) => sum + String(m.content || '').length, 0),
            preview: systemMessages.map((m: any) => ({
              type: String(m.content || '').split('\n')[0],
              length: String(m.content || '').length,
            })),
          });
          console.log('[cloud-ai] Full system prompt:', systemMessages.map((m: any) => m.content).join('\n\n---\n\n'));
        }

        // Provider options (keep minimal; do not enable thinking/reasoning streams)
        const providerOptions: any = {};

        // Enable thinking for Google Gemini 3 models to support tool calling with thought signatures.
        // Gemini 3 models require thought parts to be preserved and passed back with function responses.
        if (chosenModelId?.includes('google/gemini-3') || modelLabel?.includes('google/gemini-3')) {
          providerOptions.google = {
            thinkingConfig: {
              includeThoughts: true,
              thinkingLevel: 'high',
            },
          };
        }

        // Create AbortController for this stream so it can be cancelled
        abortController = new AbortController();
        wsAbortControllers.set(ws, abortController);

        // fast/balanced use Grok models that don't support reasoningEffort
        const stream: any = await agent.stream(inputMessages, {
          memory: { resource, thread },
          maxSteps,
          providerOptions,
          abortSignal: abortController.signal,
          onFinish: async ({ text, steps, finishReason, usage }: any) => {
            try {
              console.log('[cloud-ai] onFinish reason:', finishReason, 'usage:', usage);
            } catch {}
            let finalText = String(text || '').trim();
            if (!finalText && aggregatedText) {
              finalText = aggregatedText.trim();
            }
            writeLog('stream_finish', { finishReason, usage, textLength: finalText.length, sawToolCall, sawAnyTextDelta });
            history.push({ role: 'assistant', content: finalText });
            conversations.set(ws, history);
            if (authUser && conversationId) {
              // Build metadata for persistence
              const toolCallsList = Array.from(toolCallsMap.values());
              // Filter out SIS meta-tools from saved metadata
              const filteredToolCalls = toolCallsList.filter(tc => !isSISMetaTool(tc.tool));
              const metadata = {
                mode: requestedMode,
                tier: routedTier,
                modelId: chosenModelId,
                toolCalls: filteredToolCalls.length > 0 ? filteredToolCalls : undefined,
                streamChunks: streamChunks.length > 0 ? streamChunks : undefined,
              };
              try { await addAssistantMessage(authUser.userId, conversationId, finalText, metadata); } catch {}
            }

            const stepsSafe = typeof steps !== 'undefined' ? sanitizeSteps(steps) : steps;
            send(ws, { type: 'final', origin: 'cloud-ai', model: chosenModelId || routedTier, conversationId, result: { text: finalText, steps: stepsSafe, finishReason, usage } }, requestId);
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
              } catch {}
            }
            if (authUser) { try { await logUsageEvent(authUser.userId, conversationId, chosenModelId || routedTier, usage); } catch {} try { if (conversationId) await finishRun(authUser.userId, conversationId, finalText || ''); } catch {} }
            
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
        });

        const hasFull = !!(stream as any)?.fullStream;
        const fullStream = (stream as any)?.fullStream || stream;
        try { console.log('[cloud-ai] Stream obtained. hasFullStream:', hasFull, 'type:', typeof fullStream); } catch {}
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
                
                // Reasoning/Thinking events (disabled - do not forward or store)
                case 'reasoning-start':
                case 'thinking-start':
                case 'reasoning-delta':
                case 'thinking-delta':
                case 'reasoning-end':
                case 'thinking-end':
                case 'reasoning-signature':
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
                  
                case 'finish':
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

        // Check if we broke out of the loop due to abort
        if (abortController?.signal.aborted) {
          console.log('[cloud-ai] Stream aborted by user (loop break)');
          wsAbortControllers.delete(ws);
          const partialText = aggregatedText ? aggregatedText.trim() : '';
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

        // Clean up abort controller after stream completes
        wsAbortControllers.delete(ws);
      } catch (e: any) {
        // Clean up abort controller on error
        wsAbortControllers.delete(ws);

        // Handle abort errors specifically
        if (e?.name === 'AbortError' || abortController?.signal.aborted) {
          console.log('[cloud-ai] Stream aborted by user');
          const partialText = aggregatedText ? aggregatedText.trim() : '';
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
          } catch {}

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
          } catch {}

          const finalText = `Tool call failed: ${errMsg}. Please retry.`;
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

        send(ws, { type: 'error', message: e?.message || String(e) }, requestId);
      }
    }, secretBag);
    // Don't await - allow parallel processing
  }); // end ws.on('message')
}); // end wss.on('connection')
