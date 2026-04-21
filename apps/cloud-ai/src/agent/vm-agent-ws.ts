/**
 * Shared Python Agent WebSocket communication for VM.
 *
 * Extracted so both vm-agent.ts and vm-proactive.ts can
 * call the Python agent without circular imports.
 */

import { WebSocket } from 'ws';
import { randomUUID } from 'crypto';

export const LOCAL_AGENT_WS_URL = process.env.STUARD_LOCAL_AGENT_WS || 'ws://127.0.0.1:8765/ws';
const DEFAULT_AGENT_WS_CONNECT_TIMEOUT_MS = 60_000;

let _agentWs: WebSocket | null = null;

function isOpenWebSocket(ws: WebSocket | null | undefined): ws is WebSocket {
  return ws?.readyState === WebSocket.OPEN;
}

/** Check if the Python agent WS is currently connected. */
export function isAgentWsConnected(): boolean {
  return isOpenWebSocket(_agentWs);
}

/** Close the Python agent WS connection (for cleanup on shutdown). */
export function closeAgentWs(): void {
  if (_agentWs) {
    try { _agentWs.close(); } catch {}
    _agentWs = null;
  }
}

let _agentWsConnecting = false;
const _agentPendingRequests = new Map<string, {
  resolve: (result: any) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

// Per-request stream listeners — registered by streamToAgent(), called for
// every intermediate WS message (progress/delta/routing/tool_event).
const _streamListeners = new Map<string, (msg: any) => void>();

/** Register a stream listener for a request ID. Called for every WS message. */
export function addStreamListener(id: string, listener: (msg: any) => void): void {
  _streamListeners.set(id, listener);
}

/** Remove a stream listener. */
export function removeStreamListener(id: string): void {
  _streamListeners.delete(id);
}

function _connectAgentWs(connectTimeoutMs = 10_000): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    _agentWsConnecting = true;
    const ws = new WebSocket(LOCAL_AGENT_WS_URL);
    let settled = false;
    let opened = false;

    const fail = (error: any) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      _agentWsConnecting = false;
      if (_agentWs === ws) _agentWs = null;
      try { ws.close(); } catch {}
      reject(error instanceof Error ? error : new Error(String(error || 'agent_ws_connect_failed')));
    };

    const timer = setTimeout(() => {
      try { ws.terminate(); } catch {
        try { ws.close(); } catch {}
      }
      fail(new Error('agent_ws_connect_timeout'));
    }, Math.max(1_000, connectTimeoutMs));

    ws.on('open', () => {
      if (settled) return;
      settled = true;
      opened = true;
      clearTimeout(timer);
      _agentWs = ws;
      _agentWsConnecting = false;
      console.log('[vm-agent-ws] Connected to Python agent WS');
      resolve(ws);
    });
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(String(data));
        // Stream listeners are keyed by the chat request id, which python echoes as
        // `requestId` on every message it forwards. For messages carrying their own
        // object id (e.g. tool_request has id=<toolCallId>, requestId=<chatId>), we
        // must prefer requestId for stream dispatch, and use id only for resolving
        // direct sendToAgent promises.
        const streamKey = msg.requestId || msg.id;
        const pendingKey = msg.id || msg.requestId;
        if (!streamKey && !pendingKey) return;

        // Forward to stream listener if registered (for streaming chat)
        if (streamKey) {
          const streamCb = _streamListeners.get(streamKey);
          if (streamCb) {
            try { streamCb(msg); } catch {}
          }
        }

        if (!pendingKey || !_agentPendingRequests.has(pendingKey)) return;
        // Only resolve on terminal messages — skip progress/delta/routing
        // events which arrive before the actual result.
        const t = String(msg.type || '').toLowerCase();
        if (t === 'progress' || t === 'delta' || t === 'routing' || t === 'tool_event' || t === 'tool_request') return;
        const pending = _agentPendingRequests.get(pendingKey)!;
        clearTimeout(pending.timer);
        _agentPendingRequests.delete(pendingKey);
        pending.resolve(msg);
      } catch { /* non-JSON message, ignore */ }
    });
    ws.on('close', () => {
      clearTimeout(timer);

      if (!opened) {
        fail(new Error('agent_ws_connect_closed'));
        return;
      }

      _agentWs = null;
      _agentWsConnecting = false;
      setTimeout(() => { getAgentWs().catch(() => {}); }, 5000);
    });
    ws.on('error', (err) => {
      if (!opened) {
        fail(err);
        return;
      }

      _agentWsConnecting = false;
      if (_agentWs === ws) _agentWs = null;
    });
  });
}

/**
 * Get or create a WebSocket connection to the local Python agent.
 * Retries with backoff for up to 60s after VM boot (Python agent may still be starting).
 */
export async function getAgentWs(connectTimeoutMs = DEFAULT_AGENT_WS_CONNECT_TIMEOUT_MS): Promise<WebSocket> {
  if (isOpenWebSocket(_agentWs)) return _agentWs;

  const deadline = Date.now() + Math.max(1_000, connectTimeoutMs);

  // If another caller is already connecting, wait for it
  if (_agentWsConnecting) {
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 250));
      if (isOpenWebSocket(_agentWs)) return _agentWs;
      if (!_agentWsConnecting) break; // connection attempt finished (success or fail)
    }
    if (isOpenWebSocket(_agentWs)) return _agentWs;
    throw new Error('agent_ws_connect_timeout');
  }

  // Retry connection with backoff — Python agent may still be installing deps
  let attempt = 1;
  while (Date.now() < deadline) {
    try {
      const remainingMs = deadline - Date.now();
      return await _connectAgentWs(Math.min(10_000, Math.max(1_000, remainingMs)));
    } catch (err: any) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        break;
      }

      const delay = Math.min(2000 + attempt * 1000, 8000, Math.max(250, remainingMs));
      console.warn(
        `[vm-agent-ws] Connection attempt ${attempt} failed: ${err?.message}. Retrying in ${delay}ms (${Math.ceil(remainingMs / 1000)}s remaining)...`,
      );
      await new Promise(r => setTimeout(r, delay));
      attempt += 1;
    }
  }

  throw new Error('agent_ws_connect_timeout');
}

/** Send a message to the Python agent and await a response. */
export async function sendToAgent(msg: Record<string, any>, timeoutMs = 120_000, connectTimeoutMs = DEFAULT_AGENT_WS_CONNECT_TIMEOUT_MS): Promise<any> {
  const ws = await getAgentWs(connectTimeoutMs);
  const id = msg.id || randomUUID();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      _agentPendingRequests.delete(id);
      reject(new Error('agent_response_timeout'));
    }, timeoutMs);

    _agentPendingRequests.set(id, { resolve, timer });
    ws.send(JSON.stringify({ ...msg, id, requestId: id }));
  });
}

/**
 * Send a message to the Python agent with streaming — calls `onEvent` for every
 * intermediate WS message (progress, delta, tool_event, etc.) and resolves when
 * the terminal response arrives.
 */
export async function sendToAgentStreaming(
  msg: Record<string, any>,
  onEvent: (event: any) => void,
  timeoutMs = 180_000,
  connectTimeoutMs = DEFAULT_AGENT_WS_CONNECT_TIMEOUT_MS,
): Promise<any> {
  const ws = await getAgentWs(connectTimeoutMs);
  const id = msg.id || randomUUID();

  // Register stream listener BEFORE sending so we don't miss early events
  addStreamListener(id, onEvent);

  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        _agentPendingRequests.delete(id);
        removeStreamListener(id);
        reject(new Error('agent_response_timeout'));
      }, timeoutMs);

      _agentPendingRequests.set(id, {
        resolve: (result: any) => {
          removeStreamListener(id);
          resolve(result);
        },
        timer,
      });
      ws.send(JSON.stringify({ ...msg, id, requestId: id }));
    });
  } catch (err) {
    removeStreamListener(id);
    throw err;
  }
}

/**
 * Build memory context text for agent prompts — mirrors the desktop's
 * buildKnowledgeContext + segment search pipeline.
 *
 * Queries the local Python agent's SQLite DB for:
 *   [USER IDENTITY], [SYSTEM INSTRUCTIONS], [RELEVANT MEMORIES], [PAST CONTEXT]
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('memory_context_timeout')), timeoutMs);

    promise.then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function buildVMMemoryContextInternal(query: string, queryEmbedding?: number[], connectTimeoutMs = 6_000): Promise<string | undefined> {
  const sections: string[] = [];
  const hasEmbedding = queryEmbedding && queryEmbedding.length > 0;

  const [identityResult, directivesResult, factsResult, segmentResult, recentResult] = await Promise.all([
    sendToAgent({ type: 'tool_exec', tool: 'knowledge_get_identity', args: {} }, 10_000, connectTimeoutMs).catch(() => null),
    sendToAgent({ type: 'tool_exec', tool: 'knowledge_get_directives', args: {} }, 10_000, connectTimeoutMs).catch(() => null),
    hasEmbedding
      ? sendToAgent({ type: 'tool_exec', tool: 'knowledge_search_facts', args: { vector: queryEmbedding, limit: 4 } }, 10_000, connectTimeoutMs).catch(() => null)
      : Promise.resolve(null),
    hasEmbedding
      ? sendToAgent({ type: 'tool_exec', tool: 'segment_search', args: { embedding: queryEmbedding, limit: 3, threshold: 0.6 } }, 15_000, connectTimeoutMs).catch(() => null)
      : Promise.resolve(null),
    sendToAgent({ type: 'tool_exec', tool: 'segment_list_recent', args: { limit: 5 } }, 10_000, connectTimeoutMs).catch(() => null),
  ]);

  // Format identity
  const identityFacts: any[] = Array.isArray(identityResult) ? identityResult
    : (identityResult?.result && Array.isArray(identityResult.result) ? identityResult.result : []);
  if (identityFacts.length > 0) {
    const lines = ['[USER IDENTITY]'];
    for (const f of identityFacts) {
      const key = f.attribute_key || f.key || 'info';
      const text = f.text || f.value || '';
      if (text && !isPlaceholder(text)) {
        lines.push(`${formatKey(key)}: ${text}`);
      }
    }
    if (lines.length > 1) sections.push(lines.join('\n'));
  }

  // Format directives
  const directiveFacts: any[] = Array.isArray(directivesResult) ? directivesResult
    : (directivesResult?.result && Array.isArray(directivesResult.result) ? directivesResult.result : []);
  if (directiveFacts.length > 0) {
    const lines = ['[SYSTEM INSTRUCTIONS]'];
    for (const f of directiveFacts) {
      const text = f.text || f.value || '';
      if (text) lines.push(`- ${text}`);
    }
    if (lines.length > 1) sections.push(lines.join('\n'));
  }

  // Format global facts
  const factResults: any[] = Array.isArray(factsResult) ? factsResult
    : (factsResult?.result && Array.isArray(factsResult.result) ? factsResult.result
    : (factsResult?.results && Array.isArray(factsResult.results) ? factsResult.results : []));
  if (factResults.length > 0) {
    const lines = ['[RELEVANT MEMORIES]'];
    for (const r of factResults) {
      const text = r.text || r.fact?.text || '';
      if (text) lines.push(`- ${text}`);
    }
    if (lines.length > 1) sections.push(lines.join('\n'));
  }

  // Format segment matches
  const segments: any[] = segmentResult?.segments || segmentResult?.result || [];
  const filteredSegments = Array.isArray(segments)
    ? segments.filter((s: any) => (s.score ?? 1) >= 0.6).slice(0, 3)
    : [];
  if (filteredSegments.length > 0) {
    const lines = ['[PAST CONTEXT]'];
    for (const s of filteredSegments) {
      const summary = String(s.summary || s.segment?.summary || '').trim().slice(0, 100);
      if (summary) lines.push(`- ${summary}`);
    }
    if (lines.length > 1) sections.push(lines.join('\n'));
  }

  // Fall back to recent segments
  if (filteredSegments.length === 0) {
    const recent: any[] = recentResult?.segments || recentResult?.result || [];
    if (Array.isArray(recent) && recent.length > 0) {
      const lines = ['[RECENT CONTEXT]'];
      for (const s of recent.slice(0, 3)) {
        const summary = String(s.summary || '').trim().slice(0, 100);
        if (summary) lines.push(`- ${summary}`);
      }
      if (lines.length > 1) sections.push(lines.join('\n'));
    }
  }

  if (sections.length === 0) return undefined;
  return sections.join('\n\n');
}

export async function buildVMMemoryContext(
  query: string,
  queryEmbedding?: number[],
  options?: { connectTimeoutMs?: number; totalTimeoutMs?: number },
): Promise<string | undefined> {
  try {
    return await withTimeout(
      buildVMMemoryContextInternal(query, queryEmbedding, options?.connectTimeoutMs ?? 6_000),
      options?.totalTimeoutMs ?? 8_000,
    );
  } catch (error: any) {
    console.warn('[vm-agent-ws] Skipping memory context:', error?.message || 'memory_context_failed');
    return undefined;
  }
}

function isPlaceholder(text: string): boolean {
  const t = text.trim().toLowerCase();
  return t === '' || t === 'unknown' || t === 'n/a' || t === 'not set' || t.startsWith('[');
}

function formatKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
