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

// ── VM Relay (generic on-demand HTTP proxy → user's VM agent) ──────────────

export interface VmRelayOptions {
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: any;
  timeoutMs?: number;
}

/**
 * Send a one-shot HTTP request to the user's VM agent through the cloud-ai
 * `/v1/vm/relay` endpoint. Mirrors the desktop's WebSocket-based commands
 * (permissions, terminal, memory, proactive, …) but stays inside the
 * browser-friendly HTTPS proxy.
 */
export async function vmRelay(options: VmRelayOptions) {
  return apiFetch<any>('/v1/vm/relay', {
    method: 'POST',
    body: JSON.stringify({
      path: options.path,
      method: options.method || 'POST',
      body: options.body || {},
      timeoutMs: options.timeoutMs || 15_000,
    }),
    timeoutMs: (options.timeoutMs || 15_000) + 5_000,
  });
}

/** Send a single VM `command` (the desktop equivalent of `sendVMCommand`). */
export async function sendVmCommand(command: string, args?: any, timeoutMs?: number) {
  return vmRelay({
    path: '/command',
    method: 'POST',
    body: { command, args: args || {} },
    timeoutMs: timeoutMs || 15_000,
  });
}

// ── Cloud Engine Integrations / Service status ─────────────────────────────

export async function getCloudVmIntegrations() {
  return apiFetch('/v1/cloud-engine/integrations');
}

// ── Cloud Engine Deployments ───────────────────────────────────────────────
//
// IMPORTANT: the cloud-ai backend (`apps/cloud-ai/src/routes/cloud-deploys.ts`)
// returns deployments under the `deployments` key (not `deploys`) and uses
// snake_case fields that mirror the desktop's CloudDeployment shape in
// `apps/desktop/src/renderer/hooks/useCloudEngine.ts`. Keep this in sync.

export type CloudDeployKind = 'workflow' | 'script' | 'project';
export type CloudDeployStatus =
  | 'pending'
  | 'uploading'
  | 'deploying'
  | 'running'
  | 'stopped'
  | 'failed'
  | 'completed';

export interface CloudDeploymentTriggerBinding {
  triggerId: string;
  type: string;
  mode?: string | null;
  args?: Record<string, any>;
}

export interface CloudDeployment {
  id: string;
  name: string;
  kind: CloudDeployKind;
  description: string | null;
  status: CloudDeployStatus | string;
  auto_restart: boolean;
  schedule: string | null;
  pid: number | null;
  logs_tail?: string | null;
  source_workflow_id?: string | null;
  trigger_bindings?: CloudDeploymentTriggerBinding[];
  timezone?: string | null;
  run_count?: number;
  last_run_at?: string | null;
  last_completed_at?: string | null;
  last_trigger_source?: string | null;
  error_message: string | null;
  started_at: string | null;
  stopped_at: string | null;
  created_at: string;
}

export async function listCloudDeployments() {
  return apiFetch<{ deployments?: CloudDeployment[] }>(
    '/v1/cloud-engine/deploys',
  );
}

export async function createCloudDeployment(payload: {
  name: string;
  kind: CloudDeployKind;
  description?: string;
  payload: any;
  envVars?: Record<string, string>;
  autoRestart?: boolean;
  schedule?: string;
}) {
  return apiFetch<{ deployment?: CloudDeployment }>(
    '/v1/cloud-engine/deploys',
    { method: 'POST', body: JSON.stringify(payload), timeoutMs: 60_000 },
  );
}

export async function getCloudDeployment(id: string) {
  return apiFetch<{ deployment?: CloudDeployment }>(
    `/v1/cloud-engine/deploys/${encodeURIComponent(id)}`,
  );
}

export async function getCloudDeploymentLogs(id: string, lines = 200) {
  return apiFetch<{ logs?: string; lines?: number }>(
    `/v1/cloud-engine/deploys/${encodeURIComponent(id)}/logs?lines=${lines}`,
  );
}

export async function stopCloudDeployment(id: string) {
  return apiFetch(
    `/v1/cloud-engine/deploys/${encodeURIComponent(id)}/stop`,
    { method: 'POST' },
  );
}

export async function restartCloudDeployment(id: string) {
  return apiFetch(
    `/v1/cloud-engine/deploys/${encodeURIComponent(id)}/restart`,
    { method: 'POST' },
  );
}

export async function deleteCloudDeployment(id: string) {
  return apiFetch(
    `/v1/cloud-engine/deploys/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  );
}

// ── Permissions (lives on the VM agent, accessed through relay) ────────────

export interface VmPermissionsConfig {
  mode: 'auto' | 'manual' | 'selective';
  auto_approve: string[];
  always_require: string[];
}

export async function getVmPermissions() {
  return vmRelay({
    path: '/command',
    method: 'POST',
    body: { command: 'permissions_get', args: {} },
    timeoutMs: 10_000,
  });
}

export async function setVmPermissions(config: VmPermissionsConfig) {
  return vmRelay({
    path: '/command',
    method: 'POST',
    body: { command: 'permissions_set', args: { config } },
    timeoutMs: 10_000,
  });
}

// ── Agents (runtime status from the VM scheduler) ──────────────────────────

export interface VmBotTrigger {
  id: string;
  type: 'schedule.interval' | 'schedule.cron' | 'webhook' | 'gmail.new_email' | 'manual' | string;
  args?: Record<string, any>;
  enabled?: boolean;
}

export interface VmBotConfig {
  interval?: string;
  modelMode?: 'auto' | 'fast' | 'balanced' | 'smart';
  modelId?: string;
  instructions?: string;
  allowedTools?: string[];
  notificationChannels?: string[];
  memoryEnabled?: boolean;
  skillIds?: string[];
  skills?: Array<{
    id: string;
    name: string;
    description?: string;
    trigger?: string;
    icon?: string;
    color?: string;
    isActive?: boolean;
  }>;
}

export interface VmBot {
  id: string;
  name?: string;
  emoji?: string;
  status?: 'paused' | 'running' | 'errored' | string;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  lastOutcome?: 'success' | 'partial' | 'failed' | string;
  lastError?: string | null;
  isRunning?: boolean;
  triggers?: VmBotTrigger[];
  config?: VmBotConfig;
}

export async function getVmBotsStatus() {
  // POST /v1/agent/status -> { ok, bots: [...] } (no agentId returns the full list).
  // The status endpoint returns runtime info only; for full bot config use
  // `listVmBots()` below.
  return apiFetch<{ bots?: VmBot[] }>('/v1/agent/status', {
    method: 'POST',
    body: JSON.stringify({}),
    timeoutMs: 15_000,
  });
}

/**
 * Pull the full deployed-agent list (including instructions, triggers, config)
 * directly from the VM scheduler via the relay. The `/v1/agent/status` endpoint
 * only returns a runtime snapshot — this command returns configured agents.
 */
export async function listVmBots() {
  return sendVmCommand('agents_list', {}, 15_000);
}

export async function runVmBot(botId: string) {
  return apiFetch('/v1/agent/run', {
    method: 'POST',
    body: JSON.stringify({ agentId: botId }),
    timeoutMs: 30_000,
  });
}

export async function deleteVmBot(botId: string) {
  return apiFetch('/v1/agent/delete', {
    method: 'POST',
    body: JSON.stringify({ agentId: botId }),
    timeoutMs: 20_000,
  });
}

export const getVmAgentsStatus = getVmBotsStatus;
export const listVmAgents = listVmBots;
export const runVmAgent = runVmBot;
export const deleteVmAgent = deleteVmBot;

export interface VmBotMemoryEntry {
  id?: string;
  text?: string;
  content?: string;
  createdAt?: string;
  updatedAt?: string;
  origin?: string;
  [key: string]: any;
}

/** Pull the VM-local kanban / memory snapshot for a single agent. */
export async function exportVmBotMemory(botId: string) {
  return apiFetch<{
    memory?: { facts?: VmBotMemoryEntry[]; runs?: VmBotMemoryEntry[]; tasks?: VmBotMemoryEntry[] };
    facts?: VmBotMemoryEntry[];
    runs?: VmBotMemoryEntry[];
    tasks?: VmBotMemoryEntry[];
  }>('/v1/agent/memory/export', {
    method: 'POST',
    body: JSON.stringify({ agentId: botId }),
    timeoutMs: 20_000,
  });
}

export const exportVmAgentMemory = exportVmBotMemory;

// ── Sync prefs (cloud → VM data sync settings) ─────────────────────────────

export async function getCloudSyncPreferences() {
  return apiFetch('/v1/cloud-engine/status'); // sync prefs are bundled into engine status
}
