import type {
  CloudDeployKind,
  CloudDeployment,
  CloudFileEntry,
  CloudJsonResponse,
  CloudComputeUsageResponse,
  VmBot,
  VmBotMemoryEntry,
  VmChatAttachment,
  VmPermissionsConfig,
  VmRelayOptions,
} from './types';
import type { CloudFetchOptions, CloudTransport, GetAccessToken } from './transport';

export interface CloudClient {
  transport: CloudTransport;
  directTransport: CloudTransport;
  getAccessToken: GetAccessToken;

  getCloudEngineStatus(opts?: CloudFetchOptions): Promise<CloudJsonResponse>;
  getCloudEngineTiers(): Promise<CloudJsonResponse>;
  provisionCloudEngine(
    tier: string,
    diskSizeGb: number,
    vcpus?: number,
    ramGb?: number,
    timezone?: string,
  ): Promise<CloudJsonResponse>;
  startCloudEngine(opts?: CloudFetchOptions): Promise<CloudJsonResponse>;
  stopCloudEngine(opts?: CloudFetchOptions): Promise<CloudJsonResponse>;
  deleteCloudEngine(opts?: CloudFetchOptions): Promise<CloudJsonResponse>;
  syncAgentData(): Promise<CloudJsonResponse>;
  pushAgentData(opts?: CloudFetchOptions): Promise<CloudJsonResponse>;
  syncOAuthToVm(): Promise<CloudJsonResponse>;
  syncBrowserProfileToVm(): Promise<CloudJsonResponse>;

  listFiles(path?: string): Promise<CloudJsonResponse & { entries?: CloudFileEntry[] }>;
  readFile(path: string): Promise<CloudJsonResponse & { content?: string; encoding?: string; size?: number }>;
  writeFile(path: string, content: string): Promise<CloudJsonResponse>;
  deleteFile(path: string): Promise<CloudJsonResponse>;
  renameFile(oldPath: string, newPath: string): Promise<CloudJsonResponse>;
  createDirectory(path: string): Promise<CloudJsonResponse>;
  uploadFileToVm(targetPath: string, file: File): Promise<CloudJsonResponse & { path?: string; size?: number }>;
  getServeUrl(path: string, sessionRef?: { current: { sid: string; expiresAt: number } | null }): Promise<string | null>;
  getPreviewUrl(port: number): Promise<{ url: string; sid: string; port: number; expiresAt: number } | null>;

  getMetrics(): Promise<CloudJsonResponse>;
  getMetricsHistory(hours?: number): Promise<CloudJsonResponse>;
  getHealthStatus(): Promise<CloudJsonResponse>;
  getComputeUsage(): Promise<CloudComputeUsageResponse>;

  createSnapshot(name: string, description?: string): Promise<CloudJsonResponse>;
  listSnapshots(): Promise<CloudJsonResponse>;
  getSnapshot(id: string): Promise<CloudJsonResponse>;
  restoreSnapshot(id: string): Promise<CloudJsonResponse>;
  deleteSnapshot(id: string): Promise<CloudJsonResponse>;

  sendVMAgentChat(message: string, conversationId?: string, model?: string): Promise<CloudJsonResponse>;
  openVMAgentChatStream(options: {
    message: string;
    conversationId?: string;
    model?: string;
    modelId?: string;
    attachments?: VmChatAttachment[];
    contextPaths?: Array<{ path: string; name: string; isDirectory: boolean }>;
    signal?: AbortSignal;
  }): Promise<Response>;
  getCloudConversations(limit?: number): Promise<CloudJsonResponse>;
  getCloudConversationMessages(conversationId: string, limit?: number): Promise<CloudJsonResponse>;
  sendVmToolResult(toolId: string, result: any): Promise<CloudJsonResponse>;

  vmRelay(options: VmRelayOptions): Promise<CloudJsonResponse>;
  sendVmCommand(command: string, args?: any, timeoutMs?: number): Promise<CloudJsonResponse>;
  /** Quick reachability check of the user's VM agent (GET /v1/vm/status). */
  getVMStatus(): Promise<CloudJsonResponse & { reachable?: boolean; agentVersion?: string | null; uptime?: number | null }>;

  getCloudVmIntegrations(): Promise<CloudJsonResponse>;
  getCloudSyncPreferences(): Promise<CloudJsonResponse>;

  listCloudDeployments(): Promise<CloudJsonResponse & { deployments?: CloudDeployment[] }>;
  createCloudDeployment(payload: {
    name: string;
    kind: CloudDeployKind;
    description?: string;
    payload: any;
    envVars?: Record<string, string>;
    autoRestart?: boolean;
    schedule?: string;
  }): Promise<CloudJsonResponse & { deployment?: CloudDeployment }>;
  getCloudDeployment(id: string): Promise<CloudJsonResponse & { deployment?: CloudDeployment }>;
  getCloudDeploymentLogs(id: string, lines?: number): Promise<CloudJsonResponse & { logs?: string }>;
  stopCloudDeployment(id: string): Promise<CloudJsonResponse>;
  restartCloudDeployment(id: string): Promise<CloudJsonResponse>;
  deleteCloudDeployment(id: string): Promise<CloudJsonResponse>;

  getVmPermissions(): Promise<CloudJsonResponse>;
  setVmPermissions(config: VmPermissionsConfig): Promise<CloudJsonResponse>;
  getVmBotsStatus(): Promise<CloudJsonResponse & { bots?: VmBot[] }>;
  listVmBots(): Promise<CloudJsonResponse>;
  runVmBot(botId: string): Promise<CloudJsonResponse>;
  deleteVmBot(botId: string): Promise<CloudJsonResponse>;
  exportVmBotMemory(botId: string): Promise<CloudJsonResponse & {
    memory?: { facts?: VmBotMemoryEntry[]; runs?: VmBotMemoryEntry[]; tasks?: VmBotMemoryEntry[] };
    facts?: VmBotMemoryEntry[];
    runs?: VmBotMemoryEntry[];
    tasks?: VmBotMemoryEntry[];
  }>;
}

async function encodeFileBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
  }
  return typeof btoa === 'function'
    ? btoa(binary)
    : Buffer.from(binary, 'binary').toString('base64');
}

export function createCloudClient(options: {
  transport: CloudTransport;
  directTransport?: CloudTransport;
  getAccessToken: GetAccessToken;
}): CloudClient {
  const { transport, getAccessToken } = options;
  const directTransport = options.directTransport ?? transport;

  const api = <T extends CloudJsonResponse = CloudJsonResponse>(
    path: string,
    opts?: CloudFetchOptions,
  ) => transport.fetchJson<T>(path, opts);

  return {
    transport,
    directTransport,
    getAccessToken,

    getCloudEngineStatus: (opts) => api('/v1/cloud-engine/status', opts),
    getCloudEngineTiers: () => api('/v1/cloud-engine/tiers'),
    provisionCloudEngine: (tier, diskSizeGb, vcpus, ramGb, timezone) => {
      const body: Record<string, any> = { tier, diskSizeGb };
      if (vcpus != null) body.vcpus = vcpus;
      if (ramGb != null) body.ramGb = ramGb;
      if (timezone) body.timezone = timezone;
      return api('/v1/cloud-engine/provision', {
        method: 'POST',
        body: JSON.stringify(body),
        timeoutMs: 120_000,
      });
    },
    startCloudEngine: (opts) => api('/v1/cloud-engine/start', { method: 'POST', timeoutMs: 300_000, ...opts }),
    stopCloudEngine: (opts) => api('/v1/cloud-engine/stop', { method: 'POST', timeoutMs: 300_000, ...opts }),
    deleteCloudEngine: (opts) => api('/v1/cloud-engine', { method: 'DELETE', timeoutMs: 300_000, ...opts }),
    syncAgentData: () => api('/v1/cloud-engine/sync-agent-data', { method: 'POST' }),
    pushAgentData: (opts) => api('/v1/cloud-engine/push-agent-data', { method: 'POST', timeoutMs: 10 * 60_000, ...opts }),
    syncOAuthToVm: () => api('/v1/cloud-engine/sync-oauth-to-vm', { method: 'POST' }),
    syncBrowserProfileToVm: () => api('/v1/cloud-engine/sync-browser-profile-to-vm', { method: 'POST' }),

    listFiles: (path = '.') => api(`/v1/cloud-engine/files?path=${encodeURIComponent(path)}`),
    readFile: (path) => api(`/v1/cloud-engine/files/read?path=${encodeURIComponent(path)}`),
    writeFile: (path, content) => api('/v1/cloud-engine/files/write', {
      method: 'POST',
      body: JSON.stringify({ path, content }),
    }),
    deleteFile: (path) => api(`/v1/cloud-engine/files?path=${encodeURIComponent(path)}`, { method: 'DELETE' }),
    renameFile: (oldPath, newPath) => api('/v1/cloud-engine/files/rename', {
      method: 'POST',
      body: JSON.stringify({ oldPath, newPath }),
    }),
    createDirectory: (path) => api('/v1/cloud-engine/files/mkdir', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),
    uploadFileToVm: async (targetPath, file) => {
      const contentBase64 = await encodeFileBase64(file);
      return api('/v1/cloud-engine/files/upload', {
        method: 'POST',
        body: JSON.stringify({ path: targetPath, contentBase64 }),
        timeoutMs: 5 * 60_000,
      });
    },
    getServeUrl: async (path, sessionRef) => {
      const now = Date.now();
      const cur = sessionRef?.current ?? null;
      let sess = cur && cur.expiresAt - now > 30_000 ? cur : null;
      if (!sess) {
        const data = await api('/v1/cloud-engine/files/view-session', { method: 'POST' });
        if (!data?.ok || !data.sid) return null;
        sess = { sid: data.sid as string, expiresAt: Number(data.expiresAt) || (now + 5 * 60_000) };
        if (sessionRef) sessionRef.current = sess;
      }
      const segments = path.split('/').map(encodeURIComponent).join('/');
      return directTransport.resolveUrl(`/v1/cloud-engine/files/serve/${sess.sid}/${segments}`);
    },
    getPreviewUrl: async (port) => {
      if (!Number.isFinite(port) || port < 1 || port > 65535) return null;
      const data = await api('/v1/cloud-engine/preview/start', {
        method: 'POST',
        body: JSON.stringify({ port }),
      });
      if (!data?.ok || !data.sid) return null;
      const relPath: string = data.url || `/v1/cloud-engine/preview/${data.sid}/${port}/`;
      return {
        url: directTransport.resolveUrl(relPath),
        sid: String(data.sid),
        port: Number(data.port) || port,
        expiresAt: Number(data.expiresAt) || (Date.now() + 5 * 60_000),
      };
    },

    getMetrics: () => api('/v1/cloud-engine/metrics'),
    getMetricsHistory: (hours = 24) => api(`/v1/cloud-engine/metrics/history?hours=${hours}`),
    getHealthStatus: () => api('/v1/cloud-engine/health'),
    getComputeUsage: async () => {
      const data = await api('/v1/cloud-engine/status');
      if (!data.ok) return data;
      return {
        ok: true,
        ...(data.billing || {}),
        current_tier: data.billing?.current_tier || data.engine?.tier,
        engine_status: data.billing?.engine_status || data.engine?.status,
      };
    },

    createSnapshot: (name, description) => api('/v1/cloud-engine/snapshots', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    }),
    listSnapshots: () => api('/v1/cloud-engine/snapshots'),
    getSnapshot: (id) => api(`/v1/cloud-engine/snapshots/${id}`),
    restoreSnapshot: (id) => api(`/v1/cloud-engine/snapshots/${id}/restore`, { method: 'POST' }),
    deleteSnapshot: (id) => api(`/v1/cloud-engine/snapshots/${id}`, { method: 'DELETE' }),

    sendVMAgentChat: (message, conversationId, model) => api('/v1/vm/agent/chat', {
      method: 'POST',
      body: JSON.stringify({ message, conversationId, model }),
      timeoutMs: 180_000,
    }),
    openVMAgentChatStream: async (options) => {
      const token = await getAccessToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const context = options.contextPaths && options.contextPaths.length > 0
        ? { paths: options.contextPaths }
        : undefined;
      return fetch(directTransport.resolveUrl('/v1/vm/agent/chat'), {
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
    },
    getCloudConversations: (limit = 30) => api(`/v1/memory/conversations?limit=${limit}&status=active`),
    getCloudConversationMessages: (conversationId, limit = 100) =>
      api(`/v1/memory/conversations/${encodeURIComponent(conversationId)}/messages?limit=${limit}`),
    getVMStatus: () => api('/v1/vm/status', { timeoutMs: 8_000 }),
    sendVmToolResult: async (toolId, result) => {
      const token = await getAccessToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      try {
        const resp = await fetch(directTransport.resolveUrl('/v1/vm/relay'), {
          method: 'POST',
          headers,
          body: JSON.stringify({
            path: '/command',
            method: 'POST',
            body: { command: 'tool_result', args: { id: toolId, result } },
            timeoutMs: 30_000,
          }),
        });
        return await resp.json();
      } catch (e: any) {
        return { ok: false, error: e?.message || 'relay_failed' };
      }
    },

    vmRelay: (options) => api('/v1/vm/relay', {
      method: 'POST',
      body: JSON.stringify({
        path: options.path,
        method: options.method || 'POST',
        body: options.body || {},
        timeoutMs: options.timeoutMs || 15_000,
      }),
      timeoutMs: (options.timeoutMs || 15_000) + 5_000,
    }),
    sendVmCommand: (command, args, timeoutMs) => api('/v1/vm/relay', {
      method: 'POST',
      body: JSON.stringify({
        path: '/command',
        method: 'POST',
        body: { command, args: args || {} },
        timeoutMs: timeoutMs || 15_000,
      }),
      timeoutMs: (timeoutMs || 15_000) + 5_000,
    }),

    getCloudVmIntegrations: () => api('/v1/cloud-engine/integrations'),
    getCloudSyncPreferences: () => api('/v1/cloud-engine/status'),

    listCloudDeployments: () => api('/v1/cloud-engine/deploys'),
    createCloudDeployment: (payload) => api('/v1/cloud-engine/deploys', {
      method: 'POST',
      body: JSON.stringify(payload),
      timeoutMs: 60_000,
    }),
    getCloudDeployment: (id) => api(`/v1/cloud-engine/deploys/${encodeURIComponent(id)}`),
    getCloudDeploymentLogs: (id, lines = 200) =>
      api(`/v1/cloud-engine/deploys/${encodeURIComponent(id)}/logs?lines=${lines}`),
    stopCloudDeployment: (id) => api(`/v1/cloud-engine/deploys/${encodeURIComponent(id)}/stop`, { method: 'POST' }),
    restartCloudDeployment: (id) => api(`/v1/cloud-engine/deploys/${encodeURIComponent(id)}/restart`, { method: 'POST' }),
    deleteCloudDeployment: (id) => api(`/v1/cloud-engine/deploys/${encodeURIComponent(id)}`, { method: 'DELETE' }),

    getVmPermissions: () => api('/v1/vm/relay', {
      method: 'POST',
      body: JSON.stringify({ path: '/command', method: 'POST', body: { command: 'permissions_get', args: {} }, timeoutMs: 10_000 }),
      timeoutMs: 15_000,
    }),
    setVmPermissions: (config) => api('/v1/vm/relay', {
      method: 'POST',
      body: JSON.stringify({
        path: '/command',
        method: 'POST',
        body: { command: 'permissions_set', args: { config } },
        timeoutMs: 10_000,
      }),
      timeoutMs: 15_000,
    }),
    getVmBotsStatus: () => api('/v1/agent/status', { method: 'POST', body: JSON.stringify({}), timeoutMs: 15_000 }),
    listVmBots: () => api('/v1/vm/relay', {
      method: 'POST',
      body: JSON.stringify({ path: '/command', method: 'POST', body: { command: 'agents_list', args: {} }, timeoutMs: 15_000 }),
      timeoutMs: 20_000,
    }),
    runVmBot: (botId) => api('/v1/agent/run', { method: 'POST', body: JSON.stringify({ agentId: botId }), timeoutMs: 30_000 }),
    deleteVmBot: (botId) => api('/v1/agent/delete', { method: 'POST', body: JSON.stringify({ agentId: botId }), timeoutMs: 20_000 }),
    exportVmBotMemory: (botId) => api('/v1/agent/memory/export', {
      method: 'POST',
      body: JSON.stringify({ agentId: botId }),
      timeoutMs: 20_000,
    }),
  };
}
