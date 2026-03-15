/**
 * Shared Python Agent WebSocket communication for VM.
 *
 * Extracted so both vm-agent.ts and vm-proactive.ts can
 * call the Python agent without circular imports.
 */

import { WebSocket } from 'ws';
import { randomUUID } from 'crypto';

export const LOCAL_AGENT_WS_URL = process.env.STUARD_LOCAL_AGENT_WS || 'ws://127.0.0.1:8765/ws';

let _agentWs: WebSocket | null = null;

/** Check if the Python agent WS is currently connected. */
export function isAgentWsConnected(): boolean {
  return _agentWs?.readyState === WebSocket.OPEN;
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

export function getAgentWs(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    if (_agentWs?.readyState === WebSocket.OPEN) {
      return resolve(_agentWs);
    }
    if (_agentWsConnecting) {
      const check = setInterval(() => {
        if (_agentWs?.readyState === WebSocket.OPEN) {
          clearInterval(check);
          resolve(_agentWs);
        }
      }, 100);
      setTimeout(() => { clearInterval(check); reject(new Error('agent_ws_connect_timeout')); }, 10_000);
      return;
    }

    _agentWsConnecting = true;
    const ws = new WebSocket(LOCAL_AGENT_WS_URL);
    ws.on('open', () => {
      _agentWs = ws;
      _agentWsConnecting = false;
      console.log('[vm-agent-ws] Connected to Python agent WS');
      resolve(ws);
    });
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(String(data));
        const id = msg.id || msg.requestId;
        if (id && _agentPendingRequests.has(id)) {
          const pending = _agentPendingRequests.get(id)!;
          clearTimeout(pending.timer);
          _agentPendingRequests.delete(id);
          pending.resolve(msg);
        }
      } catch { /* non-JSON message, ignore */ }
    });
    ws.on('close', () => {
      _agentWs = null;
      _agentWsConnecting = false;
      setTimeout(() => { getAgentWs().catch(() => {}); }, 5000);
    });
    ws.on('error', (err) => {
      _agentWsConnecting = false;
      if (_agentWs === ws) _agentWs = null;
      reject(err);
    });
  });
}

/** Send a message to the Python agent and await a response. */
export async function sendToAgent(msg: Record<string, any>, timeoutMs = 120_000): Promise<any> {
  const ws = await getAgentWs();
  const id = msg.id || randomUUID();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      _agentPendingRequests.delete(id);
      reject(new Error('agent_response_timeout'));
    }, timeoutMs);

    _agentPendingRequests.set(id, { resolve, timer });
    ws.send(JSON.stringify({ ...msg, id }));
  });
}

/**
 * Build memory context text for agent prompts — mirrors the desktop's
 * buildKnowledgeContext + segment search pipeline.
 *
 * Queries the local Python agent's SQLite DB for:
 *   [USER IDENTITY], [SYSTEM INSTRUCTIONS], [RELEVANT MEMORIES], [PAST CONTEXT]
 */
export async function buildVMMemoryContext(query: string, queryEmbedding?: number[]): Promise<string | undefined> {
  const sections: string[] = [];
  const hasEmbedding = queryEmbedding && queryEmbedding.length > 0;

  const [identityResult, directivesResult, factsResult, segmentResult, recentResult] = await Promise.all([
    sendToAgent({ type: 'tool_exec', tool: 'knowledge_get_identity', args: {} }, 10_000).catch(() => null),
    sendToAgent({ type: 'tool_exec', tool: 'knowledge_get_directives', args: {} }, 10_000).catch(() => null),
    hasEmbedding
      ? sendToAgent({ type: 'tool_exec', tool: 'knowledge_search_facts', args: { vector: queryEmbedding, limit: 4 } }, 10_000).catch(() => null)
      : Promise.resolve(null),
    hasEmbedding
      ? sendToAgent({ type: 'tool_exec', tool: 'segment_search', args: { embedding: queryEmbedding, limit: 3, threshold: 0.6 } }, 15_000).catch(() => null)
      : Promise.resolve(null),
    sendToAgent({ type: 'tool_exec', tool: 'segment_list_recent', args: { limit: 5 } }, 10_000).catch(() => null),
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

function isPlaceholder(text: string): boolean {
  const t = text.trim().toLowerCase();
  return t === '' || t === 'unknown' || t === 'n/a' || t === 'not set' || t.startsWith('[');
}

function formatKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
