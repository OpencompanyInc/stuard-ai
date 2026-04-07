import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';

const CLOUD_AI_HTTP = (window as any).__CLOUD_AI_HTTP__ || (import.meta as any).env?.VITE_CLOUD_AI_URL || 'http://127.0.0.1:8082';

export type ProvisionStep = 'vm_creating' | 'vm_created' | 'waiting_ip' | 'waiting_agent' | 'restoring_data' | 'syncing_agent' | 'syncing_integrations' | 'finalizing';

export interface CloudEngine {
  id: string;
  user_id: string;
  instance_name: string;
  zone: string;
  tier: string;
  status: 'provisioning' | 'starting' | 'running' | 'stopping' | 'stopped' | 'terminated' | 'error';
  disk_size_gb: number;
  vcpus?: number;
  ram_gb?: number;
  created_at: string;
  last_heartbeat_at?: string;
  health_status?: string;
  external_ip?: string;
  provision_step?: ProvisionStep | null;
}

export interface CloudMetrics {
  cpu: number;
  ram_used: number;
  ram_total: number;
  disk_used: number;
  disk_total: number;
  net_rx: number;
  net_tx: number;
}

export interface CloudSnapshot {
  id: string;
  name: string;
  description?: string;
  status: string;
  size_bytes?: number;
  created_at: string;
}

export interface CloudBilling {
  total_credits_used: number;
  compute_credits: number;
  storage_credits: number;
  current_tier?: string;
  engine_status?: string;
  hours_this_month?: number;
}

export interface CloudFileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'symlink' | 'other';
  size: number;
  modified: string;
}

export type DeployKind = 'workflow' | 'script' | 'project';
export type DeployStatus = 'pending' | 'uploading' | 'deploying' | 'running' | 'stopped' | 'failed' | 'completed';

export interface CloudDeployment {
  id: string;
  name: string;
  kind: DeployKind;
  description: string | null;
  status: DeployStatus;
  auto_restart: boolean;
  schedule: string | null;
  pid: number | null;
  error_message: string | null;
  started_at: string | null;
  stopped_at: string | null;
  created_at: string;
}

async function getAuthToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || null;
  } catch {
    return null;
  }
}

async function cloudFetch(path: string, opts?: RequestInit) {
  const token = await getAuthToken();
  const headers: Record<string, string> = {
    ...(opts?.headers as Record<string, string> || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (opts?.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

  const resp = await fetch(`${CLOUD_AI_HTTP}${path}`, { ...opts, headers });
  return resp.json();
}

// ── Module-level cache so tab re-mounts are instant ──────────────────
interface EngineCache {
  engine: CloudEngine | null;
  metrics: CloudMetrics | null;
  billing: CloudBilling | null;
  snapshots: CloudSnapshot[];
  deployments: CloudDeployment[];
  ts: number; // last update timestamp
}
let _cache: EngineCache | null = null;
const CACHE_MAX_AGE_MS = 60_000; // consider stale after 60s

export function useCloudEngine() {
  const [engine, setEngine] = useState<CloudEngine | null>(_cache?.engine ?? null);
  const [loading, setLoading] = useState(!_cache);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<CloudMetrics | null>(_cache?.metrics ?? null);
  const [billing, setBilling] = useState<CloudBilling | null>(_cache?.billing ?? null);
  const [snapshots, setSnapshots] = useState<CloudSnapshot[]>(_cache?.snapshots ?? []);
  const [deployments, setDeployments] = useState<CloudDeployment[]>(_cache?.deployments ?? []);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [documentVisible, setDocumentVisible] = useState(() => document.visibilityState === 'visible');

  useEffect(() => {
    const onVisibilityChange = () => setDocumentVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  const fetchEngine = useCallback(async () => {
    try {
      const data = await cloudFetch('/v1/cloud-engine/status');
      if (data.ok && data.engine) {
        // Map camelCase server response to our snake_case interface
        const e = data.engine;
        const mapped: CloudEngine = {
          id: e.id || '',
          user_id: e.user_id || e.userId || '',
          instance_name: e.instance_name || e.instanceName || '',
          zone: e.zone || '',
          tier: e.tier || e.machineType || '',
          status: e.status || 'stopped',
          disk_size_gb: e.disk_size_gb ?? e.diskSizeGb ?? 0,
          vcpus: e.vcpus,
          ram_gb: e.ram_gb ?? e.ramGb,
          created_at: e.created_at || e.createdAt || '',
          last_heartbeat_at: e.last_heartbeat_at || e.lastHeartbeat || e.lastHeartbeatAt,
          health_status: e.health_status || e.healthStatus,
          external_ip: e.external_ip || e.externalIp,
          provision_step: e.provision_step || e.provisionStep || null,
        };
        setEngine(mapped);
        // Extract billing from status response
        let mappedBilling: CloudBilling | null = null;
        if (data.billing) {
          mappedBilling = {
            total_credits_used: data.billing.total_credits_used ?? data.billing.totalCreditsUsed ?? 0,
            compute_credits: data.billing.compute_credits ?? data.billing.computeCredits ?? 0,
            storage_credits: data.billing.storage_credits ?? data.billing.storageCredits ?? 0,
            current_tier: data.billing.current_tier ?? data.billing.currentTier ?? e.tier,
            engine_status: e.status,
            hours_this_month: data.billing.hours_this_month ?? data.billing.hoursThisMonth ?? 0,
          };
          setBilling(mappedBilling);
        }
        // Update module cache
        _cache = { ...(_cache || { snapshots: [], deployments: [] }), engine: mapped, billing: mappedBilling ?? _cache?.billing ?? null, metrics: _cache?.metrics ?? null, snapshots: _cache?.snapshots ?? [], deployments: _cache?.deployments ?? [], ts: Date.now() };
        setError(null);
      } else if (data.ok && !data.engine) {
        setEngine(null);
        setBilling(null);
        _cache = null;
        setError(null);
      } else {
        setError(data.message || data.error || 'Could not load cloud engine status');
      }
    } catch (e: any) {
      setError('Unable to connect to Stuard Cloud. Check your internet connection.');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchMetrics = useCallback(async () => {
    try {
      const data = await cloudFetch('/v1/cloud-engine/metrics');
      if (data.ok && data.metrics) {
        setMetrics(data.metrics);
        if (_cache) { _cache.metrics = data.metrics; _cache.ts = Date.now(); }
      }
    } catch {
      // Silently fail — metrics are optional
    }
  }, []);

  const provision = useCallback(async (tier: string, diskSizeGb: number, vcpus?: number, ramGb?: number) => {
    setLoading(true);
    setError(null);
    try {
      // Upload agent databases (knowledge.db, memory.db, tasks.db, vault.db, lancedb)
      // to GCS before provisioning so the VM starts with the user's full memory
      let agentDataUploaded = false;
      try {
        const token = await getAuthToken();
        if (token && window.desktopAPI?.uploadAgentData) {
          console.log('[cloud-engine] Uploading agent data for VM sync...');
          const uploadResult = await window.desktopAPI.uploadAgentData(CLOUD_AI_HTTP, token);
          if (uploadResult?.ok) {
            agentDataUploaded = !uploadResult.skipped;
            if (uploadResult.skipped) {
              console.log('[cloud-engine] Agent data upload skipped:', uploadResult.reason);
            } else {
              const mb = uploadResult.bytes ? (uploadResult.bytes / 1024 / 1024).toFixed(1) : '?';
              console.log(`[cloud-engine] Agent data uploaded: ${mb} MB`);
            }
          } else {
            console.error('[cloud-engine] Agent data upload FAILED:', uploadResult?.error || uploadResult);
          }
        } else {
          console.log('[cloud-engine] Skipping agent data upload — no desktopAPI or no token');
        }
      } catch (e) {
        console.error('[cloud-engine] Agent data upload error (non-fatal):', e);
      }

      const body: any = { tier, diskSizeGb };
      if (vcpus) body.vcpus = vcpus;
      if (ramGb) body.ramGb = ramGb;
      const data = await cloudFetch('/v1/cloud-engine/provision', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (data.ok) {
        await fetchEngine();
      } else {
        setError(data.message || data.error || 'Could not create your cloud engine. Please try again.');
      }
    } catch (e: any) {
      setError('Connection failed. Please check your internet and try again.');
    } finally {
      setLoading(false);
    }
  }, [fetchEngine]);

  const start = useCallback(async () => {
    try {
      // Upload latest agent data before starting so it's available for restore
      try {
        const token = await getAuthToken();
        if (token && window.desktopAPI?.uploadAgentData) {
          console.log('[cloud-engine] Uploading agent data before start...');
          await window.desktopAPI.uploadAgentData(CLOUD_AI_HTTP, token);
        }
      } catch (e) {
        console.warn('[cloud-engine] Pre-start agent data upload failed:', e);
      }

      const data = await cloudFetch('/v1/cloud-engine/start', { method: 'POST' });
      if (data.ok) {
        await fetchEngine();
      }
      else setError(data.error || 'Failed to start engine');
    } catch {
      setError('Connection failed');
    }
  }, [fetchEngine]);

  /** Manually sync local agent data (memories, knowledge) to the running VM */
  const syncData = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      // 1. Upload latest agent databases to GCS
      const token = await getAuthToken();
      if (token && window.desktopAPI?.uploadAgentData) {
        console.log('[cloud-engine] Uploading agent data for sync...');
        const uploadResult = await window.desktopAPI.uploadAgentData(CLOUD_AI_HTTP, token);
        if (!uploadResult?.ok && !uploadResult?.skipped) {
          return { ok: false, error: 'Failed to upload agent data' };
        }
      }

      // 2. Tell VM to download agent data from GCS
      const syncResult = await cloudFetch('/v1/cloud-engine/sync-agent-data', {
        method: 'POST',
      });

      if (syncResult.ok) {
        console.log('[cloud-engine] Agent data synced to VM');
      } else {
        console.warn('[cloud-engine] Agent data sync failed:', syncResult.error);
      }

      // 3. Also sync OAuth tokens and browser cookies
      cloudFetch('/v1/cloud-engine/sync-oauth-to-vm', { method: 'POST' }).catch(() => {});
      cloudFetch('/v1/cloud-engine/sync-browser-profile-to-vm', { method: 'POST' }).catch(() => {});

      return syncResult;
    } catch (e: any) {
      return { ok: false, error: e?.message || 'sync_failed' };
    }
  }, []);

  const stop = useCallback(async () => {
    try {
      const data = await cloudFetch('/v1/cloud-engine/stop', { method: 'POST' });
      if (data.ok) await fetchEngine();
      else setError(data.error || 'Failed to stop engine');
    } catch {
      setError('Connection failed');
    }
  }, [fetchEngine]);

  const destroy = useCallback(async () => {
    try {
      const data = await cloudFetch('/v1/cloud-engine', { method: 'DELETE' });
      if (data.ok) { setEngine(null); setMetrics(null); setBilling(null); setSnapshots([]); setError(null); _cache = null; }
      else setError(data.message || data.error || 'Failed to delete engine');
    } catch {
      setError('Connection failed');
    }
  }, []);

  // Snapshot ops
  const fetchSnapshots = useCallback(async () => {
    try {
      const data = await cloudFetch('/v1/cloud-engine/snapshots');
      if (data.ok) {
        const snaps = data.snapshots || [];
        setSnapshots(snaps);
        if (_cache) { _cache.snapshots = snaps; _cache.ts = Date.now(); }
      }
    } catch { /* silent */ }
  }, []);

  const createSnapshot = useCallback(async (name: string, description?: string) => {
    const data = await cloudFetch('/v1/cloud-engine/snapshots', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    });
    if (data.ok) await fetchSnapshots();
    return data;
  }, [fetchSnapshots]);

  const restoreSnapshot = useCallback(async (id: string) => {
    const data = await cloudFetch(`/v1/cloud-engine/snapshots/${id}/restore`, { method: 'POST' });
    if (data.ok) await fetchSnapshots();
    return data;
  }, [fetchSnapshots]);

  const deleteSnapshot = useCallback(async (id: string) => {
    const data = await cloudFetch(`/v1/cloud-engine/snapshots/${id}`, { method: 'DELETE' });
    if (data.ok) await fetchSnapshots();
    return data;
  }, [fetchSnapshots]);

  // File ops
  const listFiles = useCallback(async (path: string): Promise<CloudFileEntry[]> => {
    const data = await cloudFetch(`/v1/cloud-engine/files?path=${encodeURIComponent(path)}`);
    return data.ok ? (data.entries || []) : [];
  }, []);

  const readFile = useCallback(async (path: string): Promise<string | null> => {
    const data = await cloudFetch(`/v1/cloud-engine/files/read?path=${encodeURIComponent(path)}`);
    return data.ok ? data.content : null;
  }, []);

  // ── Deploy ops ───────────────────────────────────────────────────────────
  const fetchDeployments = useCallback(async () => {
    try {
      const data = await cloudFetch('/v1/cloud-engine/deploys');
      if (data.ok) {
        const deps = data.deployments || [];
        setDeployments(deps);
        if (_cache) { _cache.deployments = deps; _cache.ts = Date.now(); }
      }
    } catch { /* silent */ }
  }, []);

  const createDeployment = useCallback(async (opts: {
    name: string;
    kind: DeployKind;
    description?: string;
    payload: any;
    envVars?: Record<string, string>;
    autoRestart?: boolean;
    schedule?: string;
  }) => {
    const data = await cloudFetch('/v1/cloud-engine/deploys', {
      method: 'POST',
      body: JSON.stringify(opts),
    });
    if (data.ok) await fetchDeployments();
    return data;
  }, [fetchDeployments]);

  const stopDeployment = useCallback(async (id: string) => {
    const data = await cloudFetch(`/v1/cloud-engine/deploys/${id}/stop`, { method: 'POST' });
    if (data.ok) await fetchDeployments();
    return data;
  }, [fetchDeployments]);

  const restartDeployment = useCallback(async (id: string) => {
    const data = await cloudFetch(`/v1/cloud-engine/deploys/${id}/restart`, { method: 'POST' });
    if (data.ok) await fetchDeployments();
    return data;
  }, [fetchDeployments]);

  const deleteDeployment = useCallback(async (id: string) => {
    const data = await cloudFetch(`/v1/cloud-engine/deploys/${id}`, { method: 'DELETE' });
    if (data.ok) await fetchDeployments();
    return data;
  }, [fetchDeployments]);

  const getDeployLogs = useCallback(async (id: string, lines = 200): Promise<string> => {
    const data = await cloudFetch(`/v1/cloud-engine/deploys/${id}/logs?lines=${lines}`);
    return data.ok ? (data.logs || '') : '';
  }, []);

  // Initial load + polling
  useEffect(() => {
    if (!documentVisible) {
      setLoading(false);
      return;
    }

    const cacheIsFresh = _cache && (Date.now() - _cache.ts) < CACHE_MAX_AGE_MS;
    if (!cacheIsFresh) {
      fetchEngine();
    } else {
      setLoading(false);
    }
  }, [documentVisible, fetchEngine]);

  useEffect(() => {
    if (!documentVisible) return;

    const status = engine?.status;
    if (!status) return;

    const isTransitional = status === 'provisioning' || status === 'starting' || status === 'stopping';
    const isRunning = status === 'running';
    const isBooting = isRunning && (engine?.health_status === 'unreachable' || engine?.health_status === 'unknown');

    if (isRunning && !isBooting) fetchMetrics();

    // Poll faster during transitional states or when agent is still booting (5s)
    const interval = (isTransitional || isBooting) ? 5_000 : 30_000;

    if (isRunning || isTransitional) {
      pollRef.current = setInterval(() => {
        fetchEngine();
        if (isRunning && !isBooting) fetchMetrics();
      }, interval);
    }

    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [documentVisible, engine?.status, engine?.health_status, fetchEngine, fetchMetrics]);

  // Load snapshots + deployments when engine is running (not during provisioning/starting)
  useEffect(() => {
    if (!documentVisible) return;

    if (engine && engine.status === 'running') {
      fetchSnapshots();
      fetchDeployments();
    }
  }, [documentVisible, engine?.id, engine?.status, fetchSnapshots, fetchDeployments]);

  return {
    engine,
    loading,
    error,
    metrics,
    billing,
    snapshots,
    deployments,
    provision,
    start,
    stop,
    destroy,
    syncData,
    listFiles,
    readFile,
    refresh: fetchEngine,
    fetchSnapshots,
    createSnapshot,
    restoreSnapshot,
    deleteSnapshot,
    fetchDeployments,
    createDeployment,
    stopDeployment,
    restartDeployment,
    deleteDeployment,
    getDeployLogs,
  };
}
