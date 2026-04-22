/**
 * VM Agent Routes — Cloud-AI side
 *
 * Provides high-level endpoints for interacting with the VM agent:
 * - Chat with synced Stuard agent on VM
 * - Execute headless tasks on VM
 * - Sync memories between cloud and VM
 * - Manage proactive scheduling on VM
 * - Desktop bridge relay for VM-initiated desktop tool calls
 *
 * These routes sit in cloud-ai and proxy to the user's VM agent,
 * adding authentication, memory sync, and desktop bridging.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { verifyToken, getCloudEngine } from '../supabase';
import { sendVMCommand, resolveVMBaseUrl, resolveVMSecret } from '../services/vm-command';
import { mintVMToken } from '../services/vm-tokens';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function json(res: ServerResponse, status: number, body: any): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage, maxBytes = 5 * 1024 * 1024): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) { reject(new Error('body_too_large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

async function authenticate(req: IncomingMessage, res: ServerResponse): Promise<{ userId: string } | null> {
  const auth = String(req.headers['authorization'] || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const user = token ? await verifyToken(token) : null;
  if (!user) { json(res, 401, { ok: false, error: 'unauthorized' }); return null; }
  return user;
}

async function requireRunningEngine(userId: string, res: ServerResponse): Promise<boolean> {
  const engine = await getCloudEngine(userId);
  if (!engine || engine.status !== 'running') {
    json(res, 409, {
      ok: false,
      error: 'engine_not_running',
      message: 'Cloud Engine must be running to use VM agent features',
    });
    return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Route Handler
// ─────────────────────────────────────────────────────────────────────────────

export async function handleVMAgentRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parsedUrl: URL,
): Promise<boolean> {
  const path = parsedUrl.pathname;
  const method = req.method || '';

  if (!path.startsWith('/v1/vm/agent')) return false;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    });
    res.end();
    return true;
  }

  // ── POST /v1/vm/agent/chat — Chat with Stuard agent on VM (SSE streaming) ──
  if (method === 'POST' && path === '/v1/vm/agent/chat') {
    const user = await authenticate(req, res);
    if (!user) return true;
    if (!await requireRunningEngine(user.userId, res)) return true;

    try {
      const body = await readBody(req);
      const message = String(body.message || '').trim();
      if (!message) {
        json(res, 400, { ok: false, error: 'message_required' });
        return true;
      }

      const base = await resolveVMBaseUrl(user.userId);
      if (!base) {
        json(res, 502, { ok: false, error: 'vm_not_reachable' });
        return true;
      }

      const secret = await resolveVMSecret(user.userId);
      const token = mintVMToken(secret, user.userId, 'cloud-ai-chat');

      // Proxy to VM agent's streaming endpoint — returns NDJSON.
      // We DO NOT wrap the entire stream in a hard timeout; SSE responses can
      // legitimately last several minutes for tool-heavy turns. Instead we
      // abort the upstream fetch when the client disconnects (handled below).
      const controller = new AbortController();
      // If the client closes the SSE early (navigated away, refreshed, etc.)
      // propagate the cancellation upstream so the VM can stop work.
      const onClientClose = () => { try { controller.abort(); } catch {} };
      try { req.on('close', onClientClose); } catch {}

      const vmResp = await fetch(`${base}/agent/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          message,
          conversationId: body.conversationId,
          model: body.model || 'balanced',
          modelId: body.modelId,
          context: body.context,
          attachments: Array.isArray(body.attachments) ? body.attachments : undefined,
          memoryQuery: body.memoryQuery,
        }),
        signal: controller.signal,
      });

      if (!vmResp.ok || !vmResp.body) {
        const errBody = await vmResp.text().catch(() => '');
        json(res, vmResp.status || 502, { ok: false, error: 'agent_chat_failed', detail: errBody });
        return true;
      }

      // Stream NDJSON from VM → SSE to client
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'X-Content-Type-Options': 'nosniff',
        'X-Accel-Buffering': 'no',
      });

      const reader = vmResp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // Heartbeat keeps proxies (Vercel, Cloudflare, NGINX) from killing an
      // idle SSE connection during long tool calls.
      const keepAlive = setInterval(() => {
        try { if (!res.writableEnded) res.write(`: ping ${Date.now()}\n\n`); } catch {}
      }, 15_000);

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // keep incomplete line in buffer

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            // Forward as SSE event
            res.write(`data: ${trimmed}\n\n`);
          }
        }
        // Flush remaining buffer
        if (buffer.trim()) {
          res.write(`data: ${buffer.trim()}\n\n`);
        }
      } catch (streamErr: any) {
        if (streamErr?.name !== 'AbortError') {
          try { res.write(`data: ${JSON.stringify({ type: 'error', error: 'stream_interrupted' })}\n\n`); } catch {}
        }
      } finally {
        try { clearInterval(keepAlive); } catch {}
        try { req.off('close', onClientClose); } catch {}
        try { res.end(); } catch {}
      }
    } catch (e: any) {
      if (!res.headersSent) {
        json(res, 500, { ok: false, error: e?.message || 'agent_chat_failed' });
      } else {
        try { res.end(); } catch {}
      }
    }
    return true;
  }

  // ── POST /v1/vm/agent/execute — Execute headless task on VM ───────────────
  if (method === 'POST' && path === '/v1/vm/agent/execute') {
    const user = await authenticate(req, res);
    if (!user) return true;
    if (!await requireRunningEngine(user.userId, res)) return true;

    try {
      const body = await readBody(req);
      const task = String(body.task || body.prompt || '').trim();
      if (!task) {
        json(res, 400, { ok: false, error: 'task_required' });
        return true;
      }

      const result = await sendVMCommand(user.userId, 'agent_execute', {
        task,
        outputSchema: body.outputSchema,
        tools: body.tools,
        model: body.model || 'balanced',
        context: body.context,
      }, 300_000); // 5 min timeout

      if (!result.ok) {
        json(res, 502, { ok: false, error: result.error || 'agent_execute_failed' });
        return true;
      }

      json(res, 200, { ok: true, ...result.result });
    } catch (e: any) {
      json(res, 500, { ok: false, error: e?.message || 'agent_execute_failed' });
    }
    return true;
  }

  // ── POST /v1/vm/agent/memory/sync — Sync memories to/from VM ──────────────
  if (method === 'POST' && path === '/v1/vm/agent/memory/sync') {
    const user = await authenticate(req, res);
    if (!user) return true;
    if (!await requireRunningEngine(user.userId, res)) return true;

    try {
      const body = await readBody(req);
      const direction = String(body.direction || 'to_vm'); // 'to_vm' or 'from_vm'

      if (direction === 'to_vm') {
        // Push memories to VM
        const data = body.data || {};
        const result = await sendVMCommand(user.userId, 'memory_import', {
          data,
          mode: body.mode || 'merge',
        }, 60_000);

        json(res, 200, { ok: true, direction: 'to_vm', ...result.result });
      } else {
        // Pull memories from VM
        const result = await sendVMCommand(user.userId, 'memory_export', {}, 60_000);
        if (!result.ok) {
          json(res, 502, { ok: false, error: result.error || 'memory_export_failed' });
          return true;
        }
        json(res, 200, { ok: true, direction: 'from_vm', data: result.result?.data });
      }
    } catch (e: any) {
      json(res, 500, { ok: false, error: e?.message || 'memory_sync_failed' });
    }
    return true;
  }

  // ── GET /v1/vm/agent/memory/search — Search VM memories ───────────────────
  if (method === 'POST' && path === '/v1/vm/agent/memory/search') {
    const user = await authenticate(req, res);
    if (!user) return true;
    if (!await requireRunningEngine(user.userId, res)) return true;

    try {
      const body = await readBody(req);
      const result = await sendVMCommand(user.userId, 'memory_search', {
        query: body.query,
        limit: body.limit,
      }, 15_000);

      json(res, 200, { ok: true, ...result.result });
    } catch (e: any) {
      json(res, 500, { ok: false, error: e?.message || 'memory_search_failed' });
    }
    return true;
  }

  // ── GET /v1/vm/agent/status — Get VM agent comprehensive status ───────────
  if (method === 'GET' && path === '/v1/vm/agent/status') {
    const user = await authenticate(req, res);
    if (!user) return true;

    const engine = await getCloudEngine(user.userId);
    if (!engine || engine.status !== 'running') {
      json(res, 200, { ok: true, engine: null, status: 'offline' });
      return true;
    }

    try {
      // Fetch health from VM agent
      const base = await resolveVMBaseUrl(user.userId);
      if (!base) {
        json(res, 200, { ok: true, status: 'unreachable' });
        return true;
      }

      const secret = await resolveVMSecret(user.userId);
      const token = mintVMToken(secret, user.userId, 'cloud-ai-status');

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);

      const resp = await fetch(`${base}/health`, {
        headers: { 'Authorization': `Bearer ${token}` },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!resp.ok) {
        json(res, 200, { ok: true, status: 'unhealthy', httpStatus: resp.status });
        return true;
      }

      const health = await resp.json() as any;

      // Also fetch proactive status
      const proactiveResult = await sendVMCommand(user.userId, 'proactive_status', {}, 10_000).catch(() => ({ ok: false, result: null, error: 'timeout' } as const));
      const memoryResult = await sendVMCommand(user.userId, 'memory_stats', {}, 10_000).catch(() => ({ ok: false, result: null, error: 'timeout' } as const));

      json(res, 200, {
        ok: true,
        status: 'online',
        agent: health,
        proactive: proactiveResult.ok ? proactiveResult.result : null,
        memory: memoryResult.ok ? memoryResult.result : null,
        engine: {
          instanceName: engine.instance_name,
          zone: engine.zone,
          machineType: engine.machine_type,
          diskSizeGb: engine.disk_size_gb,
        },
      });
    } catch (e: any) {
      json(res, 200, { ok: true, status: 'error', error: e?.message });
    }
    return true;
  }

  // ── POST /v1/vm/agent/proactive/configure — Configure proactive on VM ─────
  if (method === 'POST' && path === '/v1/vm/agent/proactive/configure') {
    const user = await authenticate(req, res);
    if (!user) return true;
    if (!await requireRunningEngine(user.userId, res)) return true;

    try {
      const body = await readBody(req);
      const result = await sendVMCommand(user.userId, 'proactive_config', {
        updates: body,
      }, 15_000);

      json(res, 200, { ok: true, ...result.result });
    } catch (e: any) {
      json(res, 500, { ok: false, error: e?.message || 'proactive_config_failed' });
    }
    return true;
  }

  // ── POST /v1/vm/agent/proactive/wakeup — Trigger proactive wakeup on VM ──
  if (method === 'POST' && path === '/v1/vm/agent/proactive/wakeup') {
    const user = await authenticate(req, res);
    if (!user) return true;
    if (!await requireRunningEngine(user.userId, res)) return true;

    try {
      const result = await sendVMCommand(user.userId, 'proactive_wakeup', {}, 180_000);
      json(res, 200, { ok: true, ...result.result });
    } catch (e: any) {
      json(res, 500, { ok: false, error: e?.message || 'proactive_wakeup_failed' });
    }
    return true;
  }

  return false;
}
