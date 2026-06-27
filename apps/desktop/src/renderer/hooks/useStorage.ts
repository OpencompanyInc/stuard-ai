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
  hotUsedGb: number | null;   // null when the VM isn't reporting usage (stopped)
  coldStorageBytes: number;   // total: files + system backup
  fileBytes: number;          // user files only (matches the Files list)
  backupBytes: number;        // Stuard-managed workspace backup
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
  id: string;
  filename: string;
  loaded: number;
  total: number;
  percent: number;
  status: 'pending' | 'uploading' | 'done' | 'error';
  error?: string;
}

export type ShareMode = 'public' | 'ttl' | 'private';

export interface ShareOptions {
  /** Custom short-link slug (e.g. "demo-video" → stuard.../s/demo-video). */
  linkName?: string;
  /** "attachment" makes the link download immediately instead of previewing. */
  disposition?: 'inline' | 'attachment';
}

export interface ShareResult {
  ok: boolean;
  mode?: ShareMode;
  url?: string;
  shortUrl?: string;
  slug?: string;
  expiresAt?: string;
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
          hotUsedGb: data.hotUsedGb ?? null,
          coldStorageBytes: data.coldStorageBytes,
          fileBytes: data.fileBytes ?? data.coldStorageBytes,
          backupBytes: data.backupBytes ?? 0,
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
      } else if (data.error) {
        console.warn('[useStorage] fetchFiles failed:', data.error);
      }
    } catch (e: any) {
      console.warn('[useStorage] fetchFiles error:', e?.message);
    }
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
  // Routes through the main process via IPC so uploads can use Node's fetch
  // with a raw Buffer body. Avoids two renderer-side limits that were causing
  // "Failed to fetch" and "Invalid string length" on large files:
  //   - Electron net.fetch can't reliably send Blob/File request bodies
  //   - V8 caps strings at ~512MB, breaking base64 of large files
  // Falls back to JSON+base64 in the unlikely case the IPC bridge isn't loaded.
  const uploadFile = useCallback(async (file: File, folderPath = '') => {
    const filename = file.name;
    const uploadId = `up-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const progress: UploadProgress = {
      id: uploadId,
      filename,
      loaded: 0,
      total: file.size,
      percent: 0,
      status: 'pending',
    };
    setUploadQueue(prev => [...prev, progress]);
    setUploading(true);

    try {
      setUploadQueue(prev =>
        prev.map(p => p.id === uploadId ? { ...p, status: 'uploading' } : p)
      );

      const token = await getAuthToken();
      const buf = await file.arrayBuffer();
      const ipcUpload = (window as any).desktopAPI?.cloudStorageUpload;

      let data: any;

      if (typeof ipcUpload === 'function') {
        data = await ipcUpload({
          buffer: buf,
          filename,
          folderPath: folderPath || '',
          contentType: file.type || 'application/octet-stream',
          token: token || undefined,
          uploadId,
        });
      } else {
        // Fallback for non-Electron contexts (e.g. browser-only dev): JSON+base64.
        const bytes = new Uint8Array(buf);
        const CHUNK = 0x8000;
        const parts: string[] = [];
        for (let i = 0; i < bytes.length; i += CHUNK) {
          let bin = '';
          const slice = bytes.subarray(i, i + CHUNK);
          for (let j = 0; j < slice.length; j++) bin += String.fromCharCode(slice[j]);
          parts.push(btoa(bin));
        }
        const b64data = parts.join('');

        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const uploadResp = await fetch(`${CLOUD_AI_HTTP}/v1/cloud-storage/upload`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            filename,
            data: b64data,
            folder: folderPath || '',
            contentType: file.type || 'application/octet-stream',
          }),
        });
        data = await uploadResp.json();
        if (!uploadResp.ok) data = { ...data, ok: false };
      }

      if (!data?.ok) {
        const errMsg = data?.message || data?.error || 'Upload failed';
        setUploadQueue(prev =>
          prev.map(p => p.id === uploadId ? { ...p, status: 'error', error: errMsg } : p)
        );
        return { ok: false, error: errMsg };
      }

      setUploadQueue(prev =>
        prev.map(p => p.id === uploadId ? { ...p, status: 'done', percent: 100, loaded: file.size } : p)
      );

      await fetchInfo();
      await fetchQuota();
      return { ok: true, objectName: data.objectName };
    } catch (e: any) {
      setUploadQueue(prev =>
        prev.map(p => p.id === uploadId ? { ...p, status: 'error', error: e?.message || 'Upload failed' } : p)
      );
      return { ok: false, error: e?.message };
    } finally {
      setUploading(false);
    }
  }, [fetchInfo, fetchQuota]);

  // Live byte progress from the main-process streaming upload.
  useEffect(() => {
    const subscribe = (window as any).desktopAPI?.onCloudStorageUploadProgress;
    if (typeof subscribe !== 'function') return;
    const unsubscribe = subscribe((p: { uploadId: string; loaded: number; total: number }) => {
      setUploadQueue(prev =>
        prev.map(item =>
          item.id === p.uploadId && item.status === 'uploading'
            ? {
                ...item,
                loaded: p.loaded,
                total: p.total || item.total,
                percent: p.total > 0 ? Math.min(100, Math.round((p.loaded / p.total) * 100)) : 0,
              }
            : item,
        ),
      );
    });
    return () => { try { unsubscribe?.(); } catch { } };
  }, []);
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

  // ── Get File URL (signed, for in-app preview — does NOT open a browser) ──
  const getFileUrl = useCallback(async (objectName: string): Promise<{ ok: boolean; url?: string; error?: string }> => {
    try {
      const data = await cloudFetch('/v1/cloud-storage/download-url', {
        method: 'POST',
        body: JSON.stringify({ objectName }),
      });
      if (data.ok && data.downloadUrl) return { ok: true, url: data.downloadUrl };
      return { ok: false, error: data.error || 'Failed to get file URL' };
    } catch (e: any) {
      return { ok: false, error: e?.message };
    }
  }, []);

  // ── Share File (public permanent link / expiring TTL link / revoke) ──────
  const shareFile = useCallback(async (objectName: string, mode: ShareMode, ttlHours?: number, opts?: ShareOptions): Promise<ShareResult> => {
    try {
      const data = await cloudFetch('/v1/cloud-storage/share-url', {
        method: 'POST',
        body: JSON.stringify({
          objectName,
          mode,
          ...(mode === 'ttl' ? { ttlHours: ttlHours || 24 } : {}),
          ...(opts?.linkName ? { linkName: opts.linkName } : {}),
          ...(opts?.disposition ? { disposition: opts.disposition } : {}),
        }),
      });
      if (data.ok) return { ok: true, mode: data.mode, url: data.url, shortUrl: data.shortUrl, slug: data.slug, expiresAt: data.expiresAt };
      return { ok: false, error: data.message || data.error || 'Failed to create share link' };
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
      await Promise.all([fetchPlans(), fetchInfo(), fetchQuota(), fetchSyncStatus(), fetchFiles()]);
    } catch (e: any) {
      console.error('[useStorage] refresh failed:', e?.message);
      setError('Could not load storage data');
    }
    setLoading(false);
  }, [fetchPlans, fetchInfo, fetchQuota, fetchSyncStatus, fetchFiles]);

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
    purchasePlan, uploadFile, downloadFile, getFileUrl, shareFile, deleteFile, createFolder, renameFile,
    syncToCloud, syncFromCloud, clearUploadQueue, refresh,
  };
}
