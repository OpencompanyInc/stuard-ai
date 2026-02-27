import {
  generateUserUploadUrl,
  generateUserDownloadUrl,
  getBackupObjectName,
  getUserStorageBytes,
} from './cold-storage';
import { getStorageUsage, upsertStorageUsage } from '../supabase';
import { resolveVMAddress, resolveVMSecret, VM_AGENT_PORT } from './vm-command';
import { mintVMToken } from './vm-tokens';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SyncResult {
  success: boolean;
  objectName: string;
  bytes: number;
  uploadUrl?: string;
  error?: string;
}

export interface RestoreResult {
  success: boolean;
  objectName: string;
  downloadUrl?: string;
  error?: string;
}

export interface SyncStatus {
  lastSyncAt: string | null;
  backupObjectName: string | null;
  coldStorageBytes: number;
  hotStorageGb: number;
  quotaGb: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync to Cloud (VM hot disk → GCS cold storage)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Called on VM shutdown or periodic sync. Tells the VM agent to compress
 * the workspace and upload to GCS via a signed URL.
 *
 * Flow:
 *  1. Cloud-ai generates a signed upload URL for `stuard-user-data/{userId}/memory_backup.tar.gz`
 *  2. Cloud-ai POSTs the URL to VM agent at /sync/upload
 *  3. VM agent compresses workspace → uploads to GCS
 *  4. Cloud-ai updates storage_usage in the DB
 */
export async function syncToCloud(userId: string): Promise<SyncResult> {
  const objectName = getBackupObjectName(userId);

  try {
    const { uploadUrl } = await generateUserUploadUrl(userId, 'memory_backup.tar.gz');
    console.log(`[sync-engine] Initiating upload sync for user ${userId}`);

    // Tell the VM agent to compress & upload
    const vmIp = await resolveVMAddress(userId);
    if (vmIp) {
      const secret = await resolveVMSecret(userId);
      const token = mintVMToken(secret, userId, 'cloud-ai-sync');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5 * 60_000); // 5 min for large uploads
      try {
        const resp = await fetch(`http://${vmIp}:${VM_AGENT_PORT}/sync/upload`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ uploadUrl, objectName }),
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!resp.ok) {
          const body = await resp.text().catch(() => '');
          console.error(`[sync-engine] VM upload failed (${resp.status}): ${body}`);
          return { success: false, objectName, bytes: 0, error: `vm_upload_http_${resp.status}` };
        }
      } catch (e: any) {
        clearTimeout(timer);
        if (e?.name === 'AbortError') {
          return { success: false, objectName, bytes: 0, error: 'vm_upload_timeout' };
        }
        throw e;
      }
    }

    // Verify bytes uploaded and update DB
    const bytes = await getUserStorageBytes(userId);
    await upsertStorageUsage(userId, {
      backup_object_name: objectName,
      cold_storage_bytes: bytes,
      last_sync_at: new Date().toISOString(),
    });

    console.log(`[sync-engine] Upload sync complete for user ${userId}: ${bytes} bytes`);
    return { success: true, objectName, bytes };
  } catch (err: any) {
    console.error(`[sync-engine] syncToCloud failed for user ${userId}:`, err?.message);
    return { success: false, objectName, bytes: 0, error: err?.message || 'sync_failed' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Restore from Cloud (GCS cold storage → VM hot disk)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Called on VM startup. Generates a signed download URL and tells the
 * VM agent to fetch + extract the backup onto the hot disk.
 *
 * Flow:
 *  1. Cloud-ai generates a signed download URL
 *  2. Cloud-ai POSTs URL to VM agent at /sync/download
 *  3. VM agent downloads → extracts to workspace
 */
export async function restoreFromCloud(userId: string): Promise<RestoreResult> {
  const objectName = getBackupObjectName(userId);

  try {
    const { downloadUrl } = await generateUserDownloadUrl(userId, objectName);
    console.log(`[sync-engine] Initiating restore for user ${userId}`);

    // Tell the VM agent to download & extract
    const vmIp = await resolveVMAddress(userId);
    if (vmIp) {
      const secret = await resolveVMSecret(userId);
      const token = mintVMToken(secret, userId, 'cloud-ai-sync');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5 * 60_000);
      try {
        const resp = await fetch(`http://${vmIp}:${VM_AGENT_PORT}/sync/download`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ downloadUrl, objectName }),
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!resp.ok) {
          const body = await resp.text().catch(() => '');
          console.error(`[sync-engine] VM restore failed (${resp.status}): ${body}`);
          return { success: false, objectName, error: `vm_restore_http_${resp.status}` };
        }
      } catch (e: any) {
        clearTimeout(timer);
        if (e?.name === 'AbortError') {
          return { success: false, objectName, error: 'vm_restore_timeout' };
        }
        throw e;
      }
    }

    console.log(`[sync-engine] Restore complete for user ${userId}`);
    return { success: true, objectName, downloadUrl };
  } catch (err: any) {
    console.error(`[sync-engine] restoreFromCloud failed for user ${userId}:`, err?.message);
    return { success: false, objectName, error: err?.message || 'restore_failed' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync Status
// ─────────────────────────────────────────────────────────────────────────────

export async function getSyncStatus(userId: string): Promise<SyncStatus> {
  const usage = await getStorageUsage(userId);
  return {
    lastSyncAt: usage?.last_sync_at || null,
    backupObjectName: usage?.backup_object_name || null,
    coldStorageBytes: Number(usage?.cold_storage_bytes || 0),
    hotStorageGb: Number(usage?.hot_storage_gb || 0),
    quotaGb: Number((usage as any)?.storage_quota_gb || 0),
  };
}
