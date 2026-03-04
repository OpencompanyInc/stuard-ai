import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';

const CLOUD_AI_HTTP = (window as any).__CLOUD_AI_HTTP__ || (import.meta as any).env?.VITE_CLOUD_AI_URL || 'http://127.0.0.1:8082';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface StoragePlan {
  id: string;
  name: string;
  hotDiskGb: number;
  coldStorageGb: number;
  monthlyUsd: number;
  monthlyCredits: number;
}

export interface StorageInfo {
  planId: string;
  plan: StoragePlan;
  hotDiskGb: number;
  hotUsedGb: number;
  coldStorageBytes: number;
  coldQuotaGb: number;
  lastSyncAt: string | null;
}

export interface StorageQuota {
  withinQuota: boolean;
  usedBytes: number;
  quotaBytes: number;
  usedGb: number;
  quotaGb: number;
}

export interface SyncStatus {
  lastSyncAt: string | null;
  backupObjectName: string | null;
  coldStorageBytes: number;
  hotStorageGb: number;
  quotaGb: number;
}

export interface CloudFileEntry {
  name: string;
  size: number;
  updated: string;
  contentType: string;
}

export interface UploadProgress {
  filename: string;
  loaded: number;
  total: number;
  percent: number;
  status: 'pending' | 'uploading' | 'done' | 'error';
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth Fetch
// ─────────────────────────────────────────────────────────────────────────────

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
  if (opts?.body && typeof opts.body === 'string' && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

  const resp = await fetch(`${CLOUD_AI_HTTP}${path}`, { ...opts, headers });
  return resp.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useStorage() {
  const [plans, setPlans] = useState<StoragePlan[]>([]);
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const [quota, setQuota] = useState<StorageQuota | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [files, setFiles] = useState<CloudFileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadQueue, setUploadQueue] = useState<UploadProgress[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [purchasing, setPurchasing] = useState(false);

  // ── Fetch Plans ──────────────────────────────────────────────────────────
  const fetchPlans = useCallback(async () => {
    try {
      const data = await cloudFetch('/v1/storage/plans');
      if (data.ok && data.plans) setPlans(data.plans);
    } catch {}
  }, []);

  // ── Fetch Storage Info ───────────────────────────────────────────────────
  const fetchInfo = useCallback(async () => {
    try {
      const data = await cloudFetch('/v1/storage/info');
      if (data.ok) {
        setInfo({
          planId: data.planId,
          plan: data.plan,
          hotDiskGb: data.hotDiskGb,
          hotUsedGb: data.hotUsedGb,
          coldStorageBytes: data.coldStorageBytes,
          coldQuotaGb: data.coldQuotaGb,
          lastSyncAt: data.lastSyncAt,
        });
        setError(null);
      } else {
        console.warn('[useStorage] fetchInfo failed:', data.error);
        setError(data.error || 'Could not load storage info');
      }
    } catch (e: any) {
      console.error('[useStorage] fetchInfo exception:', e?.message);
      setError('Could not connect to storage service');
    }
  }, []);

  // ── Fetch Quota ──────────────────────────────────────────────────────────
  const fetchQuota = useCallback(async () => {
    try {
      const data = await cloudFetch('/v1/storage/quota');
      if (data.ok) setQuota(data);
    } catch {}
  }, []);

  // ── Fetch Sync Status ───────────────────────────────────────────────────
  const fetchSyncStatus = useCallback(async () => {
    try {
      const data = await cloudFetch('/v1/storage/sync-status');
      if (data.ok) setSyncStatus(data);
    } catch {}
  }, []);

  // ── Fetch Cloud Files (from GCS) ──────────────────────────────────────────
  const fetchFiles = useCallback(async (prefix = '') => {
    try {
      const qs = prefix ? `?prefix=${encodeURIComponent(prefix)}` : '';
      const data = await cloudFetch(`/v1/cloud-storage/files${qs}`);
      if (data.ok && data.files) {
        setFiles(data.files);
      }
    } catch {}
  }, []);

  // ── Purchase Plan ────────────────────────────────────────────────────────
  const purchasePlan = useCallback(async (planId: string) => {
    setPurchasing(true);
    setError(null);
    try {
      const data = await cloudFetch('/v1/storage/purchase', {
        method: 'POST',
        body: JSON.stringify({ planId }),
      });
      if (data.ok) {
        await fetchInfo();
        await fetchQuota();
        return { ok: true };
      } else {
        setError(data.error || 'Purchase failed');
        return { ok: false, error: data.error };
      }
    } catch (e: any) {
      setError('Connection failed');
      return { ok: false, error: 'connection_error' };
    } finally {
      setPurchasing(false);
    }
  }, [fetchInfo, fetchQuota]);

  // ── Upload File ──────────────────────────────────────────────────────────
  const uploadFile = useCallback(async (file: File, folderPath = '') => {
    const filename = file.name;
    const progress: UploadProgress = {
      filename,
      loaded: 0,
      total: file.size,
      percent: 0,
      status: 'pending',
    };
    setUploadQueue(prev => [...prev, progress]);
    setUploading(true);

    try {
      // Upload directly through cloud-ai proxy (avoids GCS CORS issues)
      setUploadQueue(prev =>
        prev.map(p => p.filename === filename ? { ...p, status: 'uploading' } : p)
      );

      const token = await getAuthToken();
      const headers: Record<string, string> = {
        'X-Filename': filename,
        'Content-Type': file.type || 'application/octet-stream',
      };
      if (folderPath) headers['X-File-Path'] = folderPath;
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const uploadResp = await fetch(`${CLOUD_AI_HTTP}/v1/cloud-storage/upload`, {
        method: 'POST',
        headers,
        body: file,
      });

      const data = await uploadResp.json();

      if (!uploadResp.ok || !data.ok) {
        const errMsg = data.message || data.error || `Upload failed: ${uploadResp.status}`;
        setUploadQueue(prev =>
          prev.map(p => p.filename === filename ? { ...p, status: 'error', error: errMsg } : p)
        );
        return { ok: false, error: errMsg };
      }

      setUploadQueue(prev =>
        prev.map(p => p.filename === filename ? { ...p, status: 'done', percent: 100, loaded: file.size } : p)
      );

      // Refresh storage info after upload
      await fetchInfo();
      await fetchQuota();
      return { ok: true, objectName: data.objectName };
    } catch (e: any) {
      setUploadQueue(prev =>
        prev.map(p => p.filename === filename ? { ...p, status: 'error', error: e?.message || 'Upload failed' } : p)
      );
      return { ok: false, error: e?.message };
    } finally {
      setUploading(false);
    }
  }, [fetchInfo, fetchQuota]);
  // ── Create Folder ────────────────────────────────────────────────────────────
  const createFolder = useCallback(async (folderPath: string) => {
    try {
      const data = await cloudFetch('/v1/cloud-storage/create-folder', {
        method: 'POST',
        body: JSON.stringify({ path: folderPath }),
      });
      return data;
    } catch (e: any) {
      return { ok: false, error: e?.message };
    }
  }, []);

  // ── Rename / Move File ───────────────────────────────────────────────────────
  const renameFile = useCallback(async (oldName: string, newName: string) => {
    try {
      const data = await cloudFetch('/v1/cloud-storage/rename', {
        method: 'POST',
        body: JSON.stringify({ oldName, newName }),
      });
      return data;
    } catch (e: any) {
      return { ok: false, error: e?.message };
    }
  }, []);
  // ── Download File ────────────────────────────────────────────────────────
  const downloadFile = useCallback(async (objectName: string) => {
    try {
      const data = await cloudFetch('/v1/cloud-storage/download-url', {
        method: 'POST',
        body: JSON.stringify({ objectName }),
      });
      if (data.ok && data.downloadUrl) {
        // Open in browser or trigger download
        window.open(data.downloadUrl, '_blank');
        return { ok: true };
      }
      return { ok: false, error: data.error || 'Failed to get download URL' };
    } catch (e: any) {
      return { ok: false, error: e?.message };
    }
  }, []);

  // ── Delete File ──────────────────────────────────────────────────────────
  const deleteFile = useCallback(async (objectName: string) => {
    try {
      const data = await cloudFetch('/v1/cloud-storage/file', {
        method: 'DELETE',
        body: JSON.stringify({ objectName }),
        headers: { 'Content-Type': 'application/json' },
      });
      if (data.ok) {
        await fetchInfo();
        await fetchQuota();
        return { ok: true };
      }
      return { ok: false, error: data.error };
    } catch (e: any) {
      return { ok: false, error: e?.message };
    }
  }, [fetchInfo, fetchQuota]);

  // ── Sync ─────────────────────────────────────────────────────────────────
  const syncToCloud = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      console.log('[useStorage] Starting sync to cloud...');
      const data = await cloudFetch('/v1/storage/sync', {
        method: 'POST',
        body: JSON.stringify({ direction: 'upload' }),
      });
      if (data.ok) {
        console.log('[useStorage] Sync to cloud successful');
        await fetchSyncStatus();
        await fetchInfo();
      } else {
        console.warn('[useStorage] Sync to cloud failed:', data.error);
        setError(data.error || 'Sync to cloud failed');
      }
      return data;
    } catch (e: any) {
      console.error('[useStorage] Sync to cloud exception:', e?.message);
      setError('Could not sync to cloud');
      return { ok: false, error: e?.message };
    } finally {
      setSyncing(false);
    }
  }, [fetchSyncStatus, fetchInfo]);

  const syncFromCloud = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      console.log('[useStorage] Starting sync from cloud...');
      const data = await cloudFetch('/v1/storage/sync', {
        method: 'POST',
        body: JSON.stringify({ direction: 'download' }),
      });
      if (data.ok) {
        console.log('[useStorage] Sync from cloud successful');
        await fetchSyncStatus();
        await fetchInfo();
      } else {
        console.warn('[useStorage] Sync from cloud failed:', data.error);
        setError(data.error || 'Sync from cloud failed');
      }
      return data;
    } catch (e: any) {
      console.error('[useStorage] Sync from cloud exception:', e?.message);
      setError('Could not sync from cloud');
      return { ok: false, error: e?.message };
    } finally {
      setSyncing(false);
    }
  }, [fetchSyncStatus, fetchInfo]);

  // ── Clear Upload Queue ───────────────────────────────────────────────────
  const clearUploadQueue = useCallback(() => {
    setUploadQueue(prev => prev.filter(p => p.status === 'uploading'));
  }, []);

  // ── Initial Load ─────────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([fetchPlans(), fetchInfo(), fetchQuota(), fetchSyncStatus()]);
    } catch (e: any) {
      console.error('[useStorage] refresh failed:', e?.message);
      setError('Could not load storage data');
    }
    setLoading(false);
  }, [fetchPlans, fetchInfo, fetchQuota, fetchSyncStatus]);

  // Initial load
  useEffect(() => {
    refresh();
  }, []);

  // Periodic refresh every 60 seconds when tab is visible
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    
    const startRefresh = () => {
      interval = setInterval(() => {
        if (document.visibilityState === 'visible') {
          fetchInfo();
          fetchSyncStatus();
        }
      }, 60_000);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Refresh immediately when tab becomes visible
        fetchInfo();
        fetchSyncStatus();
      }
    };

    startRefresh();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (interval) clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchInfo, fetchSyncStatus]);

  return {
    // State
    plans, info, quota, syncStatus, files, loading, error, uploading, uploadQueue, syncing, purchasing,
    // Actions
    fetchPlans, fetchInfo, fetchQuota, fetchSyncStatus, fetchFiles,
    purchasePlan, uploadFile, downloadFile, deleteFile, createFolder, renameFile,
    syncToCloud, syncFromCloud, clearUploadQueue, refresh,
  };
}
