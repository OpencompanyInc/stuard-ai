/**
 * Snapshot Manager
 * 
 * Orchestrates snapshot creation and restoration:
 * - Create: commands VM agent → tar.gz → GCS signed URL upload
 * - Restore: GCS signed URL download → VM agent extracts
 */

import { randomUUID } from 'crypto';
import { Storage } from '@google-cloud/storage';
import {
  createSnapshot,
  updateSnapshotStatus,
  getSnapshot,
  deleteSnapshot as dbDeleteSnapshot,
  type VMSnapshot,
} from '../supabase';
import { sendVMCommand } from './vm-command';
import { CLOUD_ENGINE_BUCKET } from '../utils/config';

const SNAPSHOT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// ─────────────────────────────────────────────────────────────────────────────
// GCS Helpers (signed URLs)
// ─────────────────────────────────────────────────────────────────────────────

let _storage: Storage | null = null;
function getStorage(): Storage {
  if (!_storage) _storage = new Storage();
  return _storage;
}

async function getSignedUploadUrl(objectName: string): Promise<string> {
  const bucket = getStorage().bucket(CLOUD_ENGINE_BUCKET);
  const file = bucket.file(objectName);
  const [url] = await file.getSignedUrl({
    version: 'v4',
    action: 'write',
    expires: Date.now() + 30 * 60 * 1000, // 30 min
    contentType: 'application/gzip',
  });
  return url;
}

async function getSignedDownloadUrl(objectName: string): Promise<string> {
  const bucket = getStorage().bucket(CLOUD_ENGINE_BUCKET);
  const file = bucket.file(objectName);
  const [url] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + 30 * 60 * 1000,
  });
  return url;
}

async function deleteGcsObject(objectName: string): Promise<void> {
  await getStorage().bucket(CLOUD_ENGINE_BUCKET).file(objectName).delete({ ignoreNotFound: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot Operations
// ─────────────────────────────────────────────────────────────────────────────

export async function createUserSnapshot(
  userId: string,
  name: string,
  description?: string,
): Promise<VMSnapshot | null> {
  // Create DB record
  const snapshot = await createSnapshot(userId, name, description);
  if (!snapshot) return null;

  const objectName = `snapshots/${userId}/${snapshot.id}.tar.gz`;

  try {
    // Step 1: Tell VM agent to create archive
    const archiveResult = await sendVMCommand(userId, 'snapshot_create', {
      path: '/home/stuard',
    }, SNAPSHOT_TIMEOUT_MS);

    if (!archiveResult.ok) {
      await updateSnapshotStatus(snapshot.id, 'failed');
      return snapshot;
    }

    // Step 2: Get signed upload URL and tell agent to upload
    const uploadUrl = await getSignedUploadUrl(objectName);
    const uploadResult = await sendVMCommand(userId, 'snapshot_upload', {
      archivePath: archiveResult.result?.archivePath,
      uploadUrl,
    }, SNAPSHOT_TIMEOUT_MS);

    if (!uploadResult.ok) {
      await updateSnapshotStatus(snapshot.id, 'failed');
      return snapshot;
    }

    // Step 3: Mark as ready
    await updateSnapshotStatus(snapshot.id, 'ready', {
      size_bytes: archiveResult.result?.sizeBytes || 0,
      gcs_object_name: objectName,
      completed_at: new Date().toISOString(),
    });

    return { ...snapshot, status: 'ready', gcs_object_name: objectName };
  } catch (e) {
    await updateSnapshotStatus(snapshot.id, 'failed');
    return snapshot;
  }
}

export async function restoreUserSnapshot(
  userId: string,
  snapshotId: string,
): Promise<{ success: boolean; error?: string }> {
  const snapshot = await getSnapshot(userId, snapshotId);
  if (!snapshot) return { success: false, error: 'snapshot_not_found' };
  if (snapshot.status !== 'ready') return { success: false, error: 'snapshot_not_ready' };
  if (!snapshot.gcs_object_name) return { success: false, error: 'snapshot_no_object' };

  try {
    await updateSnapshotStatus(snapshotId, 'restoring');

    // Get signed download URL
    const downloadUrl = await getSignedDownloadUrl(snapshot.gcs_object_name);

    // Tell VM agent to download and extract
    const result = await sendVMCommand(userId, 'snapshot_restore', {
      url: downloadUrl,
      path: '/home/stuard',
    }, SNAPSHOT_TIMEOUT_MS);

    if (!result.ok) {
      await updateSnapshotStatus(snapshotId, 'ready');
      return { success: false, error: result.error || 'restore_failed' };
    }

    await updateSnapshotStatus(snapshotId, 'ready');
    return { success: true };
  } catch (e: any) {
    await updateSnapshotStatus(snapshotId, 'ready');
    return { success: false, error: e?.message || 'restore_error' };
  }
}

export async function deleteUserSnapshot(
  userId: string,
  snapshotId: string,
): Promise<{ success: boolean; error?: string }> {
  const snapshot = await getSnapshot(userId, snapshotId);
  if (!snapshot) return { success: false, error: 'snapshot_not_found' };

  // Delete from GCS
  if (snapshot.gcs_object_name) {
    await deleteGcsObject(snapshot.gcs_object_name);
  }

  // Mark as deleted in DB
  await dbDeleteSnapshot(snapshotId);
  return { success: true };
}
