import { useState, useEffect, useCallback, useRef } from 'react';
import {
  computeSyncState,
  createCloudClient,
  createDirectTransport,
  detectBrowserTimezone,
  mapBillingResponse,
  mapEngineResponse,
  type CloudBilling,
  type CloudDeployment,
  type CloudEngine,
  type CloudFileEntry,
  type CloudMetrics,
  type CloudSnapshot,
  type CloudSyncStatus,
  type DeployKind,
  type DeployStatus,
  type ProvisionStep,
  type SyncState,
} from '@stuardai/cloud-client';
import { getCloudAiHttp } from '../utils/cloud';
import { supabase } from '../lib/supabaseClient';

export type {
  ProvisionStep,
  CloudEngine,
  CloudMetrics,
  CloudSnapshot,
  CloudBilling,
  SyncState,
  CloudSyncStatus,
  CloudFileEntry,
  DeployKind,
  DeployStatus,
  CloudDeployment,
};

async function getAuthToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || null;
  } catch {
    return null;
  }
}

export const cloudClient = createCloudClient({
  transport: createDirectTransport({
    resolveBaseUrl: getCloudAiHttp,
    getAccessToken: getAuthToken,
    defaultTimeoutMs: 180_000,
  }),
  getAccessToken: getAuthToken,
});

interface EngineCache {
  engine: CloudEngine | null;
  metrics: CloudMetrics | null;
  billing: CloudBilling | null;
  syncStatus: CloudSyncStatus | null;
  snapshots: CloudSnapshot[];
  deployments: CloudDeployment[];
  ts: number;
}
let _cache: EngineCache | null = null;
const CACHE_MAX_AGE_MS = 60_000;

export function useCloudEngine() {
  const [engine, setEngine] = useState<CloudEngine | null>(_cache?.engine ?? null);
  const [loading, setLoading] = useState(!_cache);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<CloudMetrics | null>(_cache?.metrics ?? null);
  const [billing, setBilling] = useState<CloudBilling | null>(_cache?.billing ?? null);
  const [syncStatus, setSyncStatus] = useState<CloudSyncStatus | null>(_cache?.syncStatus ?? null);
  const [isSyncing, setIsSyncing] = useState(false);
  const isSyncingRef = useRef(false);
  const [snapshots, setSnapshots] = useState<CloudSnapshot[]>(_cache?.snapshots ?? []);
  const [deployments, setDeployments] = useState<CloudDeployment[]>(_cache?.deployments ?? []);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [documentVisible, setDocumentVisible] = useState(() => document.visibilityState === 'visible');
  const lastTzSyncedStatusRef = useRef<string | null>(null);
  const viewSessionRef = useRef<{ sid: string; expiresAt: number } | null>(null);

  useEffect(() => {
    const onVisibilityChange = () => setDocumentVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  const fetchEngine = useCallback(async () => {
    try {
      const data = await cloudClient.getCloudEngineStatus();
      if (data.ok && data.engine) {
        const mapped = mapEngineResponse(data.engine)!;
        setEngine(mapped);
        const mappedBilling = mapBillingResponse(data.billing, mapped);
        if (mappedBilling) setBilling(mappedBilling);

        let mappedSync: CloudSyncStatus | null = null;
        if (data.sync) {
          mappedSync = computeSyncState(data.sync, isSyncingRef.current);
          setSyncStatus(mappedSync);
        }

        _cache = {
          ...(_cache || { snapshots: [], deployments: [], syncStatus: null }),
          engine: mapped,
          billing: mappedBilling ?? _cache?.billing ?? null,
          syncStatus: mappedSync ?? _cache?.syncStatus ?? null,
          metrics: _cache?.metrics ?? null,
          snapshots: _cache?.snapshots ?? [],
          deployments: _cache?.deployments ?? [],
          ts: Date.now(),
        };
        setError(null);

        if (mapped.status === 'running' && lastTzSyncedStatusRef.current !== 'running') {
          (window as any).desktopAPI?.vmSyncTimezone?.().catch(() => {});
        }
        lastTzSyncedStatusRef.current = mapped.status;
      } else if (data.ok && !data.engine) {
        setEngine(null);
        setBilling(null);
        _cache = null;
        lastTzSyncedStatusRef.current = null;
        setError(null);
      } else {
        setError(data.message || data.error || 'Could not load cloud engine status');
      }
    } catch {
      setError('Unable to connect to Stuard Cloud. Check your internet connection.');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchMetrics = useCallback(async () => {
    try {
      const data = await cloudClient.getMetrics();
      if (data.ok && data.metrics) {
        setMetrics(data.metrics);
        if (_cache) { _cache.metrics = data.metrics; _cache.ts = Date.now(); }
      }
    } catch {
      // optional
    }
  }, []);

  const provision = useCallback(async (tier: string, diskSizeGb: number, vcpus?: number, ramGb?: number) => {
    setLoading(true);
    setError(null);
    setIsSyncing(true);
    isSyncingRef.current = true;
    setSyncStatus(prev => ({
      state: 'syncing',
      lastSyncAt: prev?.lastSyncAt ?? null,
      vm: prev?.vm ?? null,
      desktop: prev?.desktop ?? null,
    }));
    try {
      try {
        const token = await getAuthToken();
        if (token && window.desktopAPI?.uploadAgentData) {
          console.log('[cloud-engine] Uploading chat titles, history, and memories for VM sync...');
          const uploadResult = await window.desktopAPI.uploadAgentData(getCloudAiHttp(), token);
          if (uploadResult?.ok) {
            if (uploadResult.skipped) {
              console.log('[cloud-engine] Agent data upload skipped:', uploadResult.reason);
            } else {
              const mb = uploadResult.bytes ? (uploadResult.bytes / 1024 / 1024).toFixed(1) : '?';
              console.log(`[cloud-engine] Agent data uploaded: ${mb} MB (chats + memories)`);
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

      const data = await cloudClient.provisionCloudEngine(
        tier,
        diskSizeGb,
        vcpus,
        ramGb,
        detectBrowserTimezone(),
      );
      if (data.ok) {
        let pushOk = false;
        for (let attempt = 0; attempt < 3 && !pushOk; attempt++) {
          if (attempt > 0) await new Promise(r => setTimeout(r, 2000 * attempt));
          try {
            const pushResult = await cloudClient.pushAgentData();
            pushOk = !!pushResult?.ok;
            if (!pushOk) {
              console.warn(`[cloud-engine] push-agent-data attempt ${attempt + 1} failed:`, pushResult?.error || pushResult?.message);
            }
          } catch (e: any) {
            console.warn(`[cloud-engine] push-agent-data attempt ${attempt + 1} threw:`, e?.message);
          }
        }
        if (!pushOk) {
          console.error('[cloud-engine] push-agent-data exhausted retries — VM may show empty chat history until next manual sync');
        }
        cloudClient.syncOAuthToVm().catch(() => {});
        cloudClient.syncBrowserProfileToVm().catch(() => {});
        await fetchEngine();
      } else {
        setError(data.message || data.error || 'Could not create your cloud engine. Please try again.');
      }
    } catch {
      setError('Unable to reach Stuard Cloud. Please check your internet and try again.');
    } finally {
      setIsSyncing(false);
      isSyncingRef.current = false;
      setLoading(false);
    }
  }, [fetchEngine]);

  const start = useCallback(async () => {
    setError(null);
    setEngine(prev => prev ? { ...prev, status: 'starting' } : prev);
    if (_cache?.engine) { _cache.engine = { ..._cache.engine, status: 'starting' }; _cache.ts = Date.now(); }

    try {
      try {
        const token = await getAuthToken();
        if (token && window.desktopAPI?.uploadAgentData) {
          console.log('[cloud-engine] Uploading agent data before start...');
          await window.desktopAPI.uploadAgentData(getCloudAiHttp(), token);
        }
      } catch (e) {
        console.warn('[cloud-engine] Pre-start agent data upload failed:', e);
      }

      const data = await cloudClient.startCloudEngine();
      if (data.ok) {
        await fetchEngine();
      } else if (data.error === 'timeout') {
        await fetchEngine();
      } else {
        setError(data.message || data.error || 'Failed to start engine');
        try {
          const s = await cloudClient.getCloudEngineStatus();
          if (s.ok && s.engine) setEngine(prev => prev ? { ...prev, status: s.engine.status || prev.status } : prev);
        } catch {}
      }
    } catch {
      setError('Unable to reach Stuard Cloud. Check your connection and try again.');
      try {
        const s = await cloudClient.getCloudEngineStatus();
        if (s.ok && s.engine) setEngine(prev => prev ? { ...prev, status: s.engine.status || prev.status } : prev);
      } catch {}
    }
  }, [fetchEngine]);

  const syncData = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    setIsSyncing(true);
    isSyncingRef.current = true;
    setSyncStatus(prev => prev ? { ...prev, state: 'syncing' } : { state: 'syncing', lastSyncAt: null, vm: null, desktop: null });
    try {
      const token = await getAuthToken();
      if (token && window.desktopAPI?.uploadAgentData) {
        console.log('[cloud-engine] Uploading agent data for sync...');
        const uploadResult = await window.desktopAPI.uploadAgentData(getCloudAiHttp(), token);
        if (!uploadResult?.ok && !uploadResult?.skipped) {
          setIsSyncing(false);
          isSyncingRef.current = false;
          setSyncStatus(prev => prev ? { ...prev, state: 'out_of_sync' } : null);
          return { ok: false, error: 'Failed to upload agent data' };
        }
      }

      const syncResult = await cloudClient.syncAgentData();
      if (syncResult.ok) {
        console.log('[cloud-engine] Agent data synced to VM');
      } else {
        console.warn('[cloud-engine] Agent data sync failed:', syncResult.error);
      }

      cloudClient.syncOAuthToVm().catch(() => {});
      cloudClient.syncBrowserProfileToVm().catch(() => {});

      setIsSyncing(false);
      isSyncingRef.current = false;
      await fetchEngine();
      return syncResult;
    } catch (e: any) {
      setIsSyncing(false);
      isSyncingRef.current = false;
      setSyncStatus(prev => prev ? { ...prev, state: 'out_of_sync' } : null);
      return { ok: false, error: e?.message || 'sync_failed' };
    }
  }, [fetchEngine]);

  const stop = useCallback(async () => {
    setError(null);
    setEngine(prev => prev ? { ...prev, status: 'stopping' } : prev);
    if (_cache?.engine) { _cache.engine = { ..._cache.engine, status: 'stopping' }; _cache.ts = Date.now(); }

    try {
      const data = await cloudClient.stopCloudEngine();
      if (data.ok) {
        await fetchEngine();
      } else if (data.error === 'timeout') {
        await fetchEngine();
      } else {
        setError(data.message || data.error || 'Failed to pause engine');
        try {
          const s = await cloudClient.getCloudEngineStatus();
          if (s.ok && s.engine) setEngine(prev => prev ? { ...prev, status: s.engine.status || prev.status } : prev);
        } catch {}
      }
    } catch {
      setError('Unable to reach Stuard Cloud. Check your connection and try again.');
      try {
        const s = await cloudClient.getCloudEngineStatus();
        if (s.ok && s.engine) setEngine(prev => prev ? { ...prev, status: s.engine.status || prev.status } : prev);
      } catch {}
    }
  }, [fetchEngine]);

  const destroy = useCallback(async () => {
    setError(null);
    try {
      const data = await cloudClient.deleteCloudEngine();
      if (data.ok) {
        setEngine(null);
        setMetrics(null);
        setBilling(null);
        setSnapshots([]);
        setError(null);
        _cache = null;
      } else {
        setError(data.message || data.error || 'Failed to delete engine');
      }
    } catch {
      setError('Unable to reach Stuard Cloud. Check your connection and try again.');
    }
  }, []);

  const fetchSnapshots = useCallback(async () => {
    try {
      const data = await cloudClient.listSnapshots();
      if (data.ok) {
        const snaps = data.snapshots || [];
        setSnapshots(snaps);
        if (_cache) { _cache.snapshots = snaps; _cache.ts = Date.now(); }
      }
    } catch { /* silent */ }
  }, []);

  const createSnapshot = useCallback(async (name: string, description?: string) => {
    const data = await cloudClient.createSnapshot(name, description);
    if (data.ok) await fetchSnapshots();
    return data;
  }, [fetchSnapshots]);

  const restoreSnapshot = useCallback(async (id: string) => {
    const data = await cloudClient.restoreSnapshot(id);
    if (data.ok) await fetchSnapshots();
    return data;
  }, [fetchSnapshots]);

  const deleteSnapshot = useCallback(async (id: string) => {
    const data = await cloudClient.deleteSnapshot(id);
    if (data.ok) await fetchSnapshots();
    return data;
  }, [fetchSnapshots]);

  const listFiles = useCallback(async (path: string): Promise<CloudFileEntry[]> => {
    const data = await cloudClient.listFiles(path);
    return data.ok ? (data.entries || []) : [];
  }, []);

  const readFile = useCallback(async (path: string): Promise<string | null> => {
    const data = await cloudClient.readFile(path);
    return data.ok ? (data.content ?? null) : null;
  }, []);

  const readFileFull = useCallback(async (
    path: string,
  ): Promise<{ content: string; encoding: 'utf-8' | 'base64'; size: number } | null> => {
    const data = await cloudClient.readFile(path);
    if (!data.ok) return null;
    return {
      content: data.content || '',
      encoding: data.encoding === 'base64' ? 'base64' : 'utf-8',
      size: typeof data.size === 'number' ? data.size : 0,
    };
  }, []);

  const getServeUrl = useCallback(async (path: string): Promise<string | null> => {
    return cloudClient.getServeUrl(path, viewSessionRef);
  }, []);

  const getPreviewUrl = useCallback(async (port: number) => cloudClient.getPreviewUrl(port), []);

  const writeFile = useCallback(async (path: string, content: string) => cloudClient.writeFile(path, content), []);
  const deleteFile = useCallback(async (path: string) => cloudClient.deleteFile(path), []);
  const renameFile = useCallback(async (oldPath: string, newPath: string) => cloudClient.renameFile(oldPath, newPath), []);
  const createDirectory = useCallback(async (path: string) => cloudClient.createDirectory(path), []);
  const uploadFileToVm = useCallback(async (targetPath: string, file: File) => cloudClient.uploadFileToVm(targetPath, file), []);

  const fetchDeployments = useCallback(async () => {
    try {
      const data = await cloudClient.listCloudDeployments();
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
    const data = await cloudClient.createCloudDeployment(opts);
    if (data.ok) await fetchDeployments();
    return data;
  }, [fetchDeployments]);

  const stopDeployment = useCallback(async (id: string) => {
    const data = await cloudClient.stopCloudDeployment(id);
    if (data.ok) await fetchDeployments();
    return data;
  }, [fetchDeployments]);

  const restartDeployment = useCallback(async (id: string) => {
    const data = await cloudClient.restartCloudDeployment(id);
    if (data.ok) await fetchDeployments();
    return data;
  }, [fetchDeployments]);

  const deleteDeployment = useCallback(async (id: string) => {
    const data = await cloudClient.deleteCloudDeployment(id);
    if (data.ok) await fetchDeployments();
    return data;
  }, [fetchDeployments]);

  const getDeployLogs = useCallback(async (id: string, lines = 200): Promise<string> => {
    const data = await cloudClient.getCloudDeploymentLogs(id, lines);
    return data.ok ? (data.logs || '') : '';
  }, []);

  useEffect(() => {
    if (!documentVisible) {
      setLoading(false);
      return;
    }
    const cacheIsFresh = _cache && (Date.now() - _cache.ts) < CACHE_MAX_AGE_MS;
    if (!cacheIsFresh) fetchEngine();
    else setLoading(false);
  }, [documentVisible, fetchEngine]);

  useEffect(() => {
    if (!documentVisible) return;
    const status = engine?.status;
    if (!status) return;

    const isTransitional = status === 'provisioning' || status === 'starting' || status === 'stopping';
    const isRunning = status === 'running';
    const isBooting = isRunning && (engine?.health_status === 'unreachable' || engine?.health_status === 'unknown');

    if (isRunning && !isBooting) fetchMetrics();

    const interval = (isTransitional || isBooting) ? 5_000 : 30_000;
    if (isRunning || isTransitional) {
      pollRef.current = setInterval(() => {
        fetchEngine();
        if (isRunning && !isBooting) fetchMetrics();
      }, interval);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [documentVisible, engine?.status, engine?.health_status, fetchEngine, fetchMetrics]);

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
    syncStatus,
    isSyncing,
    snapshots,
    deployments,
    provision,
    start,
    stop,
    destroy,
    syncData,
    listFiles,
    readFile,
    readFileFull,
    getServeUrl,
    getPreviewUrl,
    writeFile,
    deleteFile,
    renameFile,
    createDirectory,
    uploadFileToVm,
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
