import { useCallback, useEffect, useState } from 'react';

export type MediaKind = 'image' | 'video' | 'audio' | 'document' | 'unknown';
export type MediaSyncMode = 'local-only' | 'mirror-cloud';
export type MediaSyncStatus = 'local-only' | 'pending' | 'synced' | 'cloud-only' | 'failed';

export interface MediaLibraryItem {
  id: string;
  name: string;
  kind: MediaKind;
  source: string;
  classification: string;
  localPath: string | null;
  originalPath: string | null;
  remoteUrl: string | null;
  cloudObjectName: string | null;
  syncStatus: MediaSyncStatus;
  syncError: string | null;
  syncedAt: string | null;
  mimeType: string | null;
  extension: string | null;
  sizeBytes: number | null;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  metadata: Record<string, any>;
}

export interface MediaLibraryPrefs {
  syncMode: MediaSyncMode;
}

export interface MediaLibrarySummary {
  total: number;
  totalBytes: number;
  synced: number;
  pending: number;
  failed: number;
  cloudOnly: number;
  byKind: Record<MediaKind, number>;
  bySource: Record<string, number>;
}

function emptySummary(): MediaLibrarySummary {
  return {
    total: 0,
    totalBytes: 0,
    synced: 0,
    pending: 0,
    failed: 0,
    cloudOnly: 0,
    byKind: {
      image: 0,
      video: 0,
      audio: 0,
      document: 0,
      unknown: 0,
    },
    bySource: {},
  };
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return String(error || 'failed');
}

export function useMediaLibrary() {
  const [items, setItems] = useState<MediaLibraryItem[]>([]);
  const [summary, setSummary] = useState<MediaLibrarySummary>(emptySummary());
  const [prefs, setPrefs] = useState<MediaLibraryPrefs>({ syncMode: 'local-only' });
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [itemsResp, summaryResp, prefsResp] = await Promise.all([
        window.desktopAPI.mediaList(),
        window.desktopAPI.mediaSummary(),
        window.desktopAPI.mediaGetPrefs(),
      ]);

      if (!itemsResp.ok) throw new Error(itemsResp.error || 'Failed to load media');
      if (!summaryResp.ok) throw new Error(summaryResp.error || 'Failed to load media summary');
      if (!prefsResp.ok) throw new Error(prefsResp.error || 'Failed to load media preferences');

      setItems(Array.isArray(itemsResp.items) ? itemsResp.items : []);
      setSummary(summaryResp.summary || emptySummary());
      setPrefs(prefsResp.prefs || { syncMode: 'local-only' });
      setError(null);
    } catch (nextError) {
      setError(toErrorMessage(nextError));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const sync = useCallback(async (itemIds?: string[]) => {
    setSyncing(true);
    try {
      const resp = await window.desktopAPI.mediaSync(itemIds);
      if (!resp.ok) throw new Error(resp.error || 'Failed to sync media');
      if (Array.isArray(resp.items)) {
        setItems(resp.items);
      }
      await refresh(true);
      setError(null);
      return { ok: true, synced: resp.synced || 0, failed: resp.failed || 0 };
    } catch (nextError) {
      const message = toErrorMessage(nextError);
      setError(message);
      return { ok: false, error: message };
    } finally {
      setSyncing(false);
    }
  }, [refresh]);

  const updateSyncMode = useCallback(async (syncMode: MediaSyncMode) => {
    try {
      const resp = await window.desktopAPI.mediaUpdatePrefs({ syncMode });
      if (!resp.ok || !resp.prefs) throw new Error(resp.error || 'Failed to update sync mode');
      setPrefs(resp.prefs);
      setError(null);
      if (syncMode === 'mirror-cloud') {
        await sync();
      } else {
        await refresh(true);
      }
      return { ok: true, prefs: resp.prefs };
    } catch (nextError) {
      const message = toErrorMessage(nextError);
      setError(message);
      return { ok: false, error: message };
    }
  }, [refresh, sync]);

  const importPaths = useCallback(async (paths: string[]) => {
    setImporting(true);
    try {
      const uniquePaths = Array.from(new Set((paths || []).map((value) => String(value || '').trim()).filter(Boolean)));
      if (uniquePaths.length === 0) return { ok: true, items: [] as MediaLibraryItem[] };

      const resp = await window.desktopAPI.mediaImportPaths(uniquePaths);
      if (!resp.ok) throw new Error(resp.error || 'Failed to import media');
      await refresh(true);
      setError(null);
      return { ok: true, items: Array.isArray(resp.items) ? resp.items : [] };
    } catch (nextError) {
      const message = toErrorMessage(nextError);
      setError(message);
      return { ok: false, error: message };
    } finally {
      setImporting(false);
    }
  }, [refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void refresh(true);
      }
    }, 45_000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refresh(true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refresh]);

  return {
    items,
    summary,
    prefs,
    loading,
    syncing,
    importing,
    error,
    refresh,
    sync,
    updateSyncMode,
    importPaths,
  };
}
