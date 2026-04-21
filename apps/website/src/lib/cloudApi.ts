/**
 * Cloud Engine API Client
 * 
 * API client with auth header injection for all cloud-engine endpoints.
 */

import { supabase } from './supabaseClient';
import { buildWebsiteCloudProxyPath } from './cloudApiBase';

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
    const res = await fetch(buildWebsiteCloudProxyPath(path), {
      ...fetchOpts,
      headers: await buildHeaders(fetchOpts?.headers),
      signal,
    });
    const data = await res.json();
    return data;
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

export async function openVMAgentChatStream(options: {
  message: string;
  conversationId?: string;
  model?: string;
  modelId?: string;
  signal?: AbortSignal;
}) {
  const headers = await buildHeaders();

  return fetch(buildWebsiteCloudProxyPath('/v1/vm/agent/chat'), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      message: options.message,
      conversationId: options.conversationId,
      model: options.model,
      modelId: options.modelId,
    }),
    signal: options.signal,
  });
}
