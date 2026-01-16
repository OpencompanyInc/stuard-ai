/**
 * useSharedSpaces Hook
 * 
 * React hook for managing shared spaces - syncing local spaces to cloud
 * and sharing them with other users via email.
 */

import { useState, useCallback, useEffect } from 'react';
import { createSharedSpacesApi, SharedSpace, SpaceShare } from '../utils/cloud';

interface UseSharedSpacesOptions {
  getToken: () => string | null;
  autoFetch?: boolean;
}

interface UseSharedSpacesReturn {
  // State
  syncedSpaces: SharedSpace[];
  sharedWithMe: SpaceShare[];
  loading: boolean;
  error: string | null;
  
  // Actions
  syncSpace: (data: {
    local_space_id: string;
    name_encrypted: string;
    description_encrypted?: string;
    type: string;
    icon?: string;
    color?: string;
    items_encrypted?: string;
    checksum: string;
  }) => Promise<{ ok: boolean; shared_space_id?: string; error?: string }>;
  
  shareSpace: (spaceId: string, email: string, options?: {
    permission?: 'read' | 'write' | 'admin';
    share_key_encrypted?: string;
    expires_at?: string;
  }) => Promise<{ ok: boolean; share?: SpaceShare; error?: string }>;
  
  revokeShare: (spaceId: string, shareId: string) => Promise<{ ok: boolean; error?: string }>;
  
  acceptShare: (shareId: string) => Promise<{ ok: boolean; error?: string }>;
  
  deleteSpace: (spaceId: string) => Promise<{ ok: boolean; error?: string }>;
  
  getSpaceShares: (spaceId: string) => Promise<SpaceShare[]>;
  
  getFullSpace: (spaceId: string) => Promise<SharedSpace | null>;
  
  refresh: () => Promise<void>;
}

export function useSharedSpaces(options: UseSharedSpacesOptions): UseSharedSpacesReturn {
  const { getToken, autoFetch = true } = options;
  
  const [syncedSpaces, setSyncedSpaces] = useState<SharedSpace[]>([]);
  const [sharedWithMe, setSharedWithMe] = useState<SpaceShare[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const api = createSharedSpacesApi(getToken);
  
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      const [syncedResult, sharedResult] = await Promise.all([
        api.listSyncedSpaces(),
        api.listSharedWithMe(),
      ]);
      
      if (syncedResult.ok) {
        setSyncedSpaces(syncedResult.spaces || []);
      } else {
        setError(syncedResult.error || 'Failed to fetch synced spaces');
      }
      
      if (sharedResult.ok) {
        setSharedWithMe(sharedResult.shares || []);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [api]);
  
  useEffect(() => {
    if (autoFetch && getToken()) {
      refresh();
    }
  }, [autoFetch, refresh]);
  
  const syncSpace = useCallback(async (data: Parameters<typeof api.syncSpace>[0]) => {
    const result = await api.syncSpace(data);
    if (result.ok) {
      await refresh();
    }
    return result;
  }, [api, refresh]);
  
  const shareSpace = useCallback(async (
    spaceId: string,
    email: string,
    shareOptions?: Parameters<typeof api.shareSpace>[2]
  ) => {
    return api.shareSpace(spaceId, email, shareOptions);
  }, [api]);
  
  const revokeShare = useCallback(async (spaceId: string, shareId: string) => {
    return api.revokeShare(spaceId, shareId);
  }, [api]);
  
  const acceptShare = useCallback(async (shareId: string) => {
    const result = await api.acceptShare(shareId);
    if (result.ok) {
      await refresh();
    }
    return result;
  }, [api, refresh]);
  
  const deleteSpace = useCallback(async (spaceId: string) => {
    const result = await api.deleteSpace(spaceId);
    if (result.ok) {
      await refresh();
    }
    return result;
  }, [api, refresh]);
  
  const getSpaceShares = useCallback(async (spaceId: string) => {
    const result = await api.listShares(spaceId);
    return result.ok ? result.shares : [];
  }, [api]);
  
  const getFullSpace = useCallback(async (spaceId: string) => {
    const result = await api.getSpace(spaceId);
    return result.ok ? result.space || null : null;
  }, [api]);
  
  return {
    syncedSpaces,
    sharedWithMe,
    loading,
    error,
    syncSpace,
    shareSpace,
    revokeShare,
    acceptShare,
    deleteSpace,
    getSpaceShares,
    getFullSpace,
    refresh,
  };
}

export default useSharedSpaces;
