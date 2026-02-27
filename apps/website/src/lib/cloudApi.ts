/**
 * Cloud Engine API Client
 * 
 * API client with auth header injection for all cloud-engine endpoints.
 */

const CLOUD_API_URL = process.env.NEXT_PUBLIC_CLOUD_API_URL || 'https://api.stuard.ai';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  // Try to get from cookie or local storage
  return localStorage.getItem('stuard_access_token') || null;
}

function buildHeaders(extra?: HeadersInit): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const t = getToken();
  if (t) h['Authorization'] = `Bearer ${t}`;
  if (extra) {
    const entries = extra instanceof Headers ? Array.from(extra.entries()) : Object.entries(extra as Record<string, string>);
    for (const [k, v] of entries) h[k] = v;
  }
  return h;
}

async function apiFetch<T = any>(path: string, opts?: RequestInit): Promise<T & { ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${CLOUD_API_URL}${path}`, {
      ...opts,
      headers: buildHeaders(opts?.headers),
    });
    const data = await res.json();
    return data;
  } catch (e: any) {
    return { ok: false, error: e?.message || 'network_error' } as any;
  }
}

// ── Engine ─────────────────────────────────────────────────────────────────

export async function getCloudEngineStatus() {
  return apiFetch('/v1/cloud-engine/status');
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
  return getCloudEngineStatus(); // billing data included in status
}
