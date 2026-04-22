/**
 * Cloud Engine API Client
 * 
 * API client with auth header injection for all cloud-engine endpoints.
 */

import { supabase } from './supabaseClient';
import { buildWebsiteCloudProxyPath, resolveBrowserCloudApiOrigin } from './cloudApiBase';

export async function getCloudAccessToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null;

  const storedToken = localStorage.getItem('stuard_access_token');
  if (storedToken) return storedToken;

  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  } catch {
    return null;
  }
}

async function buildHeaders(extra?: HeadersInit): Promise<Record<string, string>> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const t = await getCloudAccessToken();
  if (t) h['Authorization'] = `Bearer ${t}`;
  if (extra) {
    const entries = extra instanceof Headers ? Array.from(extra.entries()) : Object.entries(extra as Record<string, string>);
    for (const [k, v] of entries) h[k] = v;
  }
  return h;
}

async function apiFetch<T = any>(
  path: string,
  opts?: RequestInit & { timeoutMs?: number },
): Promise<T & { ok: boolean; error?: string }> {
  const timeout = opts?.timeoutMs ?? 15_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  // Allow caller to chain their own signal
  const signal = opts?.signal
    ? AbortSignal.any([opts.signal, controller.signal])
    : controller.signal;

  try {
    const { timeoutMs: _, ...fetchOpts } = opts ?? {} as any;
    const targetPath = buildWebsiteCloudProxyPath(path);
    const res = await fetch(targetPath, {
      ...fetchOpts,
      headers: await buildHeaders(fetchOpts?.headers),
      signal,
    });

    const raw = await res.text();
    const contentType = res.headers.get('content-type') || '';

    if (contentType.includes('application/json') || (raw.startsWith('{') || raw.startsWith('['))) {
      try {
        return JSON.parse(raw);
      } catch (parseErr: any) {
        return {
          ok: false,
          error: `upstream_invalid_json`,
          status: res.status,
          snippet: raw.slice(0, 160),
        } as any;
      }
    }

    return {
      ok: false,
      error: res.ok ? 'upstream_non_json' : `upstream_http_${res.status}`,
      status: res.status,
      snippet: raw.slice(0, 160).replace(/\s+/g, ' ').trim(),
      proxyPath: targetPath,
    } as any;
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      return { ok: false, error: 'request_timeout' } as any;
    }
    return { ok: false, error: e?.message || 'network_error' } as any;
  } finally {
    clearTimeout(timer);
  }
}

// ── Engine ─────────────────────────────────────────────────────────────────

export async function getCloudEngineStatus(opts?: RequestInit & { timeoutMs?: number }) {
  return apiFetch('/v1/cloud-engine/status', opts);
}

export async function getCloudEngineTiers() {
  return apiFetch('/v1/cloud-engine/tiers');
}

export async function provisionCloudEngine(tier: string, diskSizeGb: number, vcpus?: number, ramGb?: number) {
  const body: Record<string, any> = { tier, diskSizeGb };
  if (vcpus != null) body.vcpus = vcpus;
  if (ramGb != null) body.ramGb = ramGb;
  return apiFetch('/v1/cloud-engine/provision', {
    method: 'POST',
    body: JSON.stringify(body),
    timeoutMs: 120_000, // VM creation can take up to 2 minutes
  });
}

export async function startCloudEngine() {
  return apiFetch('/v1/cloud-engine/start', { method: 'POST' });
}

export async function stopCloudEngine() {
  return apiFetch('/v1/cloud-engine/stop', { method: 'POST' });
}

export async function deleteCloudEngine() {
  return apiFetch('/v1/cloud-engine', { method: 'DELETE' });
}

// ── Files ──────────────────────────────────────────────────────────────────

export async function listFiles(path: string = '.') {
  return apiFetch(`/v1/cloud-engine/files?path=${encodeURIComponent(path)}`);
}

export async function readFile(path: string) {
  return apiFetch(`/v1/cloud-engine/files/read?path=${encodeURIComponent(path)}`);
}

export async function writeFile(path: string, content: string) {
  return apiFetch('/v1/cloud-engine/files/write', {
    method: 'POST',
    body: JSON.stringify({ path, content }),
  });
}

export async function deleteFile(path: string) {
  return apiFetch(`/v1/cloud-engine/files?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
}

export async function renameFile(oldPath: string, newPath: string) {
  return apiFetch('/v1/cloud-engine/files/rename', {
    method: 'POST',
    body: JSON.stringify({ oldPath, newPath }),
  });
}

export async function createDirectory(path: string) {
  return apiFetch('/v1/cloud-engine/files/mkdir', {
    method: 'POST',
    body: JSON.stringify({ path }),
  });
}

/**
 * Upload a binary or text File to the user's VM workspace.
 * Reads the file in the browser, base64-encodes it, then POSTs to the
 * cloud-ai files/upload endpoint which writes it on the VM.
 */
export async function uploadFileToVm(targetPath: string, file: File) {
  const buffer = await file.arrayBuffer();
  // Convert ArrayBuffer → base64 in chunks to avoid call-stack limits on large files
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)) as any);
  }
  const contentBase64 = typeof btoa === 'function' ? btoa(binary) : Buffer.from(binary, 'binary').toString('base64');
  return apiFetch<{ path?: string; size?: number }>('/v1/cloud-engine/files/upload', {
    method: 'POST',
    body: JSON.stringify({ path: targetPath, contentBase64 }),
    timeoutMs: 5 * 60_000,
  });
}

// ── Monitoring ─────────────────────────────────────────────────────────────

export async function getMetrics() {
  return apiFetch('/v1/cloud-engine/metrics');
}

export async function getMetricsHistory(hours = 24) {
  return apiFetch(`/v1/cloud-engine/metrics/history?hours=${hours}`);
}

export async function getHealthStatus() {
  return apiFetch('/v1/cloud-engine/health');
}

// ── Snapshots ──────────────────────────────────────────────────────────────

export async function createSnapshot(name: string, description?: string) {
  return apiFetch('/v1/cloud-engine/snapshots', {
    method: 'POST',
    body: JSON.stringify({ name, description }),
  });
}

export async function listSnapshots() {
  return apiFetch('/v1/cloud-engine/snapshots');
}

export async function getSnapshot(id: string) {
  return apiFetch(`/v1/cloud-engine/snapshots/${id}`);
}

export async function restoreSnapshot(id: string) {
  return apiFetch(`/v1/cloud-engine/snapshots/${id}/restore`, { method: 'POST' });
}

export async function deleteSnapshot(id: string) {
  return apiFetch(`/v1/cloud-engine/snapshots/${id}`, { method: 'DELETE' });
}

// ── Billing ────────────────────────────────────────────────────────────────

export async function getComputeUsage() {
  const data = await getCloudEngineStatus();
  if (!data.ok) return data;
  return {
    ok: true,
    ...(data.billing || {}),
    current_tier: data.billing?.current_tier || data.engine?.tier,
    engine_status: data.billing?.engine_status || data.engine?.status,
  };
}

// ── VM Agent Chat ──────────────────────────────────────────────────────────

export async function sendVMAgentChat(message: string, conversationId?: string, model?: string) {
  return apiFetch<{ text?: string; conversationId?: string }>('/v1/vm/agent/chat', {
    method: 'POST',
    body: JSON.stringify({ message, conversationId, model }),
    timeoutMs: 180_000, // 3 min — agent can take a while
  });
}

export interface VmChatAttachment {
  type?: string;
  name: string;
  path: string;
  mimeType?: string;
  size?: number;
}

export async function openVMAgentChatStream(options: {
  message: string;
  conversationId?: string;
  model?: string;
  modelId?: string;
  attachments?: VmChatAttachment[];
  contextPaths?: Array<{ path: string; name: string; isDirectory: boolean }>;
  signal?: AbortSignal;
}) {
  // Hit cloud-ai directly so SSE streams aren't buffered by the Next.js proxy.
  // Matches the desktop CloudVmChat pattern. Cloud-ai exposes CORS for browsers.
  const token = await getCloudAccessToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const context = options.contextPaths && options.contextPaths.length > 0
    ? { paths: options.contextPaths }
    : undefined;

  const base = resolveBrowserCloudApiOrigin();
  return fetch(`${base}/v1/vm/agent/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      message: options.message,
      conversationId: options.conversationId,
      model: options.model,
      modelId: options.modelId,
      attachments: options.attachments,
      context,
    }),
    signal: options.signal,
  });
}

export async function getCloudConversations(limit = 30) {
  return apiFetch(`/v1/memory/conversations?limit=${limit}&status=active`);
}

export async function getCloudConversationMessages(conversationId: string, limit = 100) {
  return apiFetch(`/v1/memory/conversations/${encodeURIComponent(conversationId)}/messages?limit=${limit}`);
}

export async function sendVmToolResult(toolId: string, result: any) {
  // Same direct-to-cloud-ai pattern as the desktop relay so the VM agent
  // receives ask_user / tool responses without going through the Next proxy.
  const token = await getCloudAccessToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const base = resolveBrowserCloudApiOrigin();
  try {
    const resp = await fetch(`${base}/v1/vm/relay`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        path: '/command',
        method: 'POST',
        body: {
          command: 'tool_result',
          args: { id: toolId, result },
        },
        timeoutMs: 30_000,
      }),
    });
    return await resp.json();
  } catch (e: any) {
    return { ok: false, error: e?.message || 'relay_failed' };
  }
}
