import type { CloudBilling, CloudEngine, CloudSyncStatus, SyncState } from './types';

export function mapEngineResponse(raw: any): CloudEngine | null {
  if (!raw) return null;
  return {
    id: raw.id || '',
    user_id: raw.user_id || raw.userId || '',
    instance_name: raw.instance_name || raw.instanceName || '',
    zone: raw.zone || '',
    tier: raw.tier || raw.machineType || '',
    status: raw.status || 'stopped',
    disk_size_gb: raw.disk_size_gb ?? raw.diskSizeGb ?? 0,
    vcpus: raw.vcpus,
    ram_gb: raw.ram_gb ?? raw.ramGb,
    created_at: raw.created_at || raw.createdAt || '',
    last_heartbeat_at: raw.last_heartbeat_at || raw.lastHeartbeat || raw.lastHeartbeatAt,
    health_status: raw.health_status || raw.healthStatus,
    external_ip: raw.external_ip || raw.externalIp,
    provision_step: raw.provision_step || raw.provisionStep || null,
  };
}

export function mapBillingResponse(raw: any, engine?: CloudEngine | null): CloudBilling | null {
  if (!raw) return null;
  return {
    total_credits_used: raw.total_credits_used ?? raw.totalCreditsUsed ?? 0,
    compute_credits: raw.compute_credits ?? raw.computeCredits ?? 0,
    storage_credits: raw.storage_credits ?? raw.storageCredits ?? 0,
    current_tier: raw.current_tier ?? raw.currentTier ?? engine?.tier,
    engine_status: engine?.status,
    hours_this_month: raw.hours_this_month ?? raw.hoursThisMonth ?? 0,
  };
}

export function computeSyncState(
  syncData: { lastSyncAt: string | null; vm: any; desktop: any } | null,
  isSyncing: boolean,
): CloudSyncStatus {
  if (isSyncing) {
    return {
      state: 'syncing',
      lastSyncAt: syncData?.lastSyncAt ?? null,
      vm: syncData?.vm ?? null,
      desktop: syncData?.desktop ?? null,
    };
  }
  if (!syncData || (!syncData.vm && !syncData.desktop)) {
    return {
      state: 'unknown',
      lastSyncAt: syncData?.lastSyncAt ?? null,
      vm: null,
      desktop: null,
    };
  }
  if (syncData.vm && syncData.desktop) {
    const lastSync = syncData.lastSyncAt ? new Date(syncData.lastSyncAt).getTime() : 0;
    const staleThresholdMs = 10 * 60 * 1000;
    const isStale = !syncData.lastSyncAt || (Date.now() - lastSync > staleThresholdMs);
    if (isStale) {
      return {
        state: 'out_of_sync',
        lastSyncAt: syncData.lastSyncAt,
        vm: syncData.vm,
        desktop: syncData.desktop,
      };
    }
    return {
      state: 'synced',
      lastSyncAt: syncData.lastSyncAt,
      vm: syncData.vm,
      desktop: syncData.desktop,
    };
  }
  return {
    state: 'out_of_sync',
    lastSyncAt: syncData.lastSyncAt ?? null,
    vm: syncData.vm ?? null,
    desktop: syncData.desktop ?? null,
  };
}

export function isSyncState(value: string | undefined): value is SyncState {
  return value === 'synced' || value === 'out_of_sync' || value === 'syncing' || value === 'unknown';
}
