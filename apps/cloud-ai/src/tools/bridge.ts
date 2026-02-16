import { WebSocket } from 'ws';
import { AsyncLocalStorage } from 'node:async_hooks';

const AGENT_WS = process.env.AGENT_WS || 'ws://127.0.0.1:8765/ws';
const AGENT_WS_MAX_PAYLOAD = Number(process.env.AGENT_WS_MAX_PAYLOAD || 268435456);

// Per-connection bridge context using AsyncLocalStorage, so tools can reuse the same WS
// and read ephemeral secrets (e.g., service access tokens) without logging them.
type BridgeStore = { ws: WebSocket; secrets?: Record<string, any> };
const bridgeALS = new AsyncLocalStorage<BridgeStore>();

// Pending tool requests per client WS
type Pending = { resolve: (v: any) => void; reject: (e: any) => void; writer?: WritableStreamDefaultWriter<any>; timeout?: NodeJS.Timeout; tool: string; silent?: boolean };
const pendingByWs = new WeakMap<WebSocket, Map<string, Pending>>();

function getPending(ws: WebSocket) {
  let m = pendingByWs.get(ws);
  if (!m) { m = new Map(); pendingByWs.set(ws, m); }
  return m;
}

export function withClientBridge(ws: WebSocket, fn: () => Promise<any> | any, secrets?: Record<string, any>) {
  // Ensure pending tool map is cleaned up when the WS closes
  ensureBridgeCleanupListener(ws);
  return bridgeALS.run({ ws, secrets }, fn as any);
}

// Track which WS connections already have a cleanup listener to avoid duplicate listeners
const _cleanupListeners = new WeakSet<WebSocket>();

function ensureBridgeCleanupListener(ws: WebSocket) {
  if (_cleanupListeners.has(ws)) return;
  _cleanupListeners.add(ws);
  ws.on('close', () => {
    const pending = pendingByWs.get(ws);
    if (!pending) return;
    // Clear all timeouts and reject all pending promises
    for (const [id, pend] of pending.entries()) {
      try { if (pend.timeout) clearTimeout(pend.timeout); } catch { }
      try { pend.resolve({ ok: false, error: 'bridge_closed' }); } catch { }
    }
    pending.clear();
  });
}

export function runWithSecrets<T>(secrets: Record<string, any>, fn: () => T): T {
  // Pass null as any for ws since we only care about secrets in this context
  return bridgeALS.run({ ws: null as any, secrets }, fn);
}

export function getBridgeWs(): WebSocket | undefined {
  try { return bridgeALS.getStore()?.ws as WebSocket | undefined; } catch { return undefined; }
}

export function getBridgeSecrets(): Record<string, any> | undefined {
  try { return bridgeALS.getStore()?.secrets; } catch { return undefined; }
}

export function hasClientBridge(): boolean {
  try {
    const ws = bridgeALS.getStore()?.ws as WebSocket | undefined;
    return !!ws && ws.readyState === WebSocket.OPEN;
  } catch {
    return false;
  }
}
const __writerQueues = new WeakMap<any, Promise<void>>();
async function __queueWriterWrite(writer: any, payload: any) {
  if (!writer || typeof writer.write !== 'function') return;
  const prev = __writerQueues.get(writer) || Promise.resolve();
  const next = prev.then(async () => {
    try { await writer.write(payload); } catch {}
  });
  __writerQueues.set(writer, next.catch(() => {}));
  return next;
}

// Exported helper so all modules share the same queue per writer instance
export async function safeToolWrite(writer: any, payload: any) {
  return __queueWriterWrite(writer, payload);
}

function send(ws: WebSocket, data: unknown) {
  try { ws.send(JSON.stringify(data)); } catch {}
}

export function handleClientToolMessage(ws: WebSocket, msg: any) {
  const type = String(msg?.type || '').toLowerCase();
  const id = String(msg?.id || '').trim();
  if (!id) return;
  const pend = getPending(ws).get(id);
  if (!pend) return;
  if (type === 'tool_event') {
    // Skip writing to stream for silent tool calls
    if (pend.silent) return;
    try {
      const safe: any = { ...msg };
      if (safe?.result && typeof safe.result === 'object') {
        const r = { ...(safe.result as any) };
        if (typeof r.data === 'string') { r.bytes = r.data.length; delete r.data; }
        safe.result = r;
      }
      (async () => {
        try { await __queueWriterWrite(pend.writer, { type: 'tool_event', tool: pend.tool, status: msg.status, ...safe }); } catch {}
      })();
    } catch {}
    return;
  }
  if (type === 'tool_result') {
    try { if (pend.timeout) clearTimeout(pend.timeout); } catch {}
    getPending(ws).delete(id);
    pend.resolve(msg.result);
    return;
  }
}

export async function execLocalTool(tool: string, args: any, writer?: WritableStreamDefaultWriter<any>, timeoutMs = 300000, options?: { silent?: boolean; noFallback?: boolean }) {
  const silent = options?.silent ?? false;
  const noFallback = options?.noFallback ?? false;
  const store = bridgeALS.getStore();
  const forceDirect = !!(args && (args as any)._forceDirect);
  
  // Avoid leaking internal control flags over the wire
  const sendArgs = (() => {
    try {
      if (!args || typeof args !== 'object') return args;
      const { _forceDirect: _omit, ...rest } = args as any;
      return rest;
    } catch {
      return args;
    }
  })();
  // In-band bridge if we are inside an active client WS context
  const useBridge = !forceDirect && store?.ws && store.ws.readyState === WebSocket.OPEN;
  if (useBridge) {
    const id = `tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return new Promise<any>((resolve, reject) => {
      const pend: Pending = { resolve, reject, writer, tool, silent };
      const timer = setTimeout(() => {
        getPending(store.ws).delete(id);
        try {
          (async () => { try { await __queueWriterWrite(writer, { type: 'tool_event', tool, status: 'timeout', id }); } catch {} })();
        } catch {}
        resolve({ ok: false, error: 'timeout', timedOut: true });
      }, timeoutMs);
      pend.timeout = timer;
      getPending(store.ws).set(id, pend);
      // Notify tool called (await in microtask to avoid stream lock) - skip if silent
      if (!silent) {
        try {
          (async () => {
            try { await __queueWriterWrite(writer, { type: 'tool_event', tool, status: 'called', id, args: sendArgs }); } catch {}
          })();
        } catch {}
      }
      // Ask the client to execute locally
      send(store.ws, { type: 'tool_request', id, tool, args: sendArgs, silent });
    });
  }

  // Fallback: reach the local agent directly (useful in local dev)
  // Skip fallback if noFallback option is set (workflow tools should only use desktop bridge)
  if (noFallback) {
    return { ok: false, error: 'No desktop bridge available', workflows: [] };
  }

  return new Promise<any>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => { if (!settled) { settled = true; fn(); } };
    try {
      const ws = new WebSocket(AGENT_WS, { maxPayload: AGENT_WS_MAX_PAYLOAD });
      const id = `tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const timer = setTimeout(() => {
        try { ws.close(); } catch {}
        try { (async () => { try { await __queueWriterWrite(writer, { type: 'tool_event', tool, status: 'timeout', id }); } catch {} })(); } catch {}
        settle(() => resolve({ ok: false, error: 'timeout', timedOut: true }));
      }, timeoutMs);

      ws.on('open', async () => {
        const payload = { type: 'tool_exec', id, tool, args: sendArgs };
        ws.send(JSON.stringify(payload));
      });

      ws.on('message', async (buf) => {
        let msg: any;
        try {
          msg = JSON.parse(Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf));
        } catch {
          return;
        }
        const mtype = String(msg?.type || '').toLowerCase();

        if (mtype === 'tool_event' && msg.id === id) {
          try {
            const safeMsg: any = { ...msg };
            if (safeMsg?.result && typeof safeMsg.result === 'object') {
              const r = { ...(safeMsg.result as any) };
              if (typeof r.data === 'string') {
                r.bytes = r.data.length;
                delete r.data;
              }
              safeMsg.result = r;
            }
            await __queueWriterWrite(writer, { type: 'tool_event', tool, status: msg.status, ...safeMsg });
          } catch {}
        }

        if (mtype === 'tool_result' && msg.id === id) {
          clearTimeout(timer);
          try { ws.close(); } catch {}
          settle(() => resolve(msg.result));
        }

        if (mtype === 'error') {
          clearTimeout(timer);
          try { ws.close(); } catch {}
          settle(() => reject(new Error(msg.message || 'tool error')));
        }
      });

      ws.on('error', (e) => {
        clearTimeout(timer);
        try { ws.close(); } catch {}
        settle(() => reject(e));
      });
      ws.on('close', () => {
        // If the WS closes before we got a result, resolve with error instead of leaking
        clearTimeout(timer);
        settle(() => resolve({ ok: false, error: 'agent_connection_closed' }));
      });
    } catch (e) {
      settle(() => reject(e));
    }
  });
}
