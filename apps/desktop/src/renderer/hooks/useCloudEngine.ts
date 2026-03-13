import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';

const CLOUD_AI_HTTP = (window as any).__CLOUD_AI_HTTP__ || (import.meta as any).env?.VITE_CLOUD_AI_URL || 'http://127.0.0.1:8082';

export interface CloudEngine {
  id: string;
  user_id: string;
  instance_name: string;
  zone: string;
  tier: string;
  status: 'provisioning' | 'running' | 'stopped' | 'terminated' | 'error';
  disk_size_gb: number;
  vcpus?: number;
  ram_gb?: number;
  created_at: string;
  last_heartbeat_at?: string;
  health_status?: string;
  external_ip?: string;
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

export function useCloudEngine() {
  const [engine, setEngine] = useState<CloudEngine | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<CloudMetrics | null>(null);
  const [billing, setBilling] = useState<CloudBilling | null>(null);
  const [snapshots, setSnapshots] = useState<CloudSnapshot[]>([]);
  const [deployments, setDeployments] = useState<CloudDeployment[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchEngine = useCallback(async () => {
    try {
      const data = await cloudFetch('/v1/cloud-engine/status');
      if (data.ok && data.engine) {
        // Map camelCase server response to our snake_case interface
        const e = data.engine;
        setEngine({
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
          last_heartbeat_at: e.last_heartbeat_at || e.lastHeartbeatAt,
          health_status: e.health_status || e.healthStatus,
          external_ip: e.external_ip || e.externalIp,
        });
        // Extract billing from status response
        if (data.billing) {
          setBilling({
            total_credits_used: data.billing.total_credits_used ?? data.billing.totalCreditsUsed ?? 0,
            compute_credits: data.billing.compute_credits ?? data.billing.computeCredits ?? 0,
            storage_credits: data.billing.storage_credits ?? data.billing.storageCredits ?? 0,
            current_tier: data.billing.current_tier ?? data.billing.currentTier ?? e.tier,
            engine_status: e.status,
            hours_this_month: data.billing.hours_this_month ?? data.billing.hoursThisMonth ?? 0,
          });
        }
        setError(null);
      } else if (data.ok && !data.engine) {
        setEngine(null);
        setBilling(null);
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
      }
    } catch {
      // Silently fail — metrics are optional
    }
  }, []);

  const provision = useCallback(async (tier: string, diskSizeGb: number, vcpus?: number, ramGb?: number) => {
    setLoading(true);
    setError(null);
    try {
      // Upload agent databases (knowledge.db, memory.db) to GCS before provisioning
      // so the VM starts with the user's full memory and knowledge graph
      try {
        const token = await getAuthToken();
        if (token && (window as any).desktopAPI?.uploadAgentData) {
          const uploadResult = await (window as any).desktopAPI.uploadAgentData(CLOUD_AI_HTTP, token);
          if (uploadResult?.ok) {
            console.log('[cloud-engine] Agent data uploaded for VM sync', uploadResult);
          }
        }
      } catch (e) {
        console.warn('[cloud-engine] Agent data upload failed (non-fatal):', e);
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
        // Sync OAuth tokens to VM after provisioning (fire-and-forget)
        cloudFetch('/v1/cloud-engine/sync-oauth-to-vm', { method: 'POST' }).catch(() => {});
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
      // Upload latest agent data before starting
      try {
        const token = await getAuthToken();
        if (token && (window as any).desktopAPI?.uploadAgentData) {
          await (window as any).desktopAPI.uploadAgentData(CLOUD_AI_HTTP, token);
        }
      } catch {}

      const data = await cloudFetch('/v1/cloud-engine/start', { method: 'POST' });
      if (data.ok) {
        await fetchEngine();
        // Sync OAuth tokens after start (fire-and-forget)
        cloudFetch('/v1/cloud-engine/sync-oauth-to-vm', { method: 'POST' }).catch(() => {});
      }
      else setError(data.error || 'Failed to start engine');
    } catch {
      setError('Connection failed');
    }
  }, [fetchEngine]);

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
      if (data.ok) { setEngine(null); setMetrics(null); setBilling(null); setSnapshots([]); setError(null); }
      else setError(data.message || data.error || 'Failed to delete engine');
    } catch {
      setError('Connection failed');
    }
  }, []);

  // Snapshot ops
  const fetchSnapshots = useCallback(async () => {
    try {
      const data = await cloudFetch('/v1/cloud-engine/snapshots');
      if (data.ok) setSnapshots(data.snapshots || []);
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
      if (data.ok) setDeployments(data.deployments || []);
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
    fetchEngine();
  }, [fetchEngine]);

  useEffect(() => {
    if (engine?.status === 'running') {
      fetchMetrics();
      pollRef.current = setInterval(() => {
        fetchEngine();
        fetchMetrics();
      }, 30_000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [engine?.status, fetchEngine, fetchMetrics]);

  // Load snapshots + deployments when engine exists
  useEffect(() => {
    if (engine) {
      fetchSnapshots();
      fetchDeployments();
    }
  }, [engine?.id, fetchSnapshots, fetchDeployments]);

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
