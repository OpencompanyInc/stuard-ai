/**
 * Deploy Manager
 *
 * Orchestrates deploying workflows, scripts, and projects to Cloud VMs.
 *
 * Deploy flow:
 * 1. Validate workflow/payload and store metadata in Supabase
 * 2. Upload workflow bundle to GCS
 * 3. Send deploy command to VM agent via WebSocket
 * 4. Agent downloads bundle, installs deps, starts the process
 * 5. Status updates flow back via heartbeat/command_result
 */

import { randomUUID } from 'crypto';
import { Storage } from '@google-cloud/storage';
import { CLOUD_ENGINE_BUCKET } from '../utils/config';
import { sendVMCommand } from './vm-command';
import { supabaseAdmin, hasSupabase } from '../supabase';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

const RETRYABLE_STORAGE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const RETRYABLE_STORAGE_ERROR_CODES = new Set([
  'EAI_AGAIN',
  'ENOTFOUND',
  'ECONNRESET',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ECONNREFUSED',
  'EPIPE',
]);

export type DeployKind = 'workflow' | 'script' | 'project';
export type DeployStatus = 'pending' | 'uploading' | 'deploying' | 'running' | 'stopped' | 'failed' | 'completed';

export interface DeployRequest {
  name: string;
  kind: DeployKind;
  description?: string;
  /** Workflow JSON, script content, or project manifest */
  payload: any;
  /** Environment variables to inject */
  envVars?: Record<string, string>;
  /** Auto-restart on crash */
  autoRestart?: boolean;
  /** Schedule cron expression (optional — for scheduled workflows) */
  schedule?: string;
}

export interface Deployment {
  id: string;
  user_id: string;
  name: string;
  kind: DeployKind;
  description: string | null;
  status: DeployStatus;
  gcs_object_name: string | null;
  env_vars: Record<string, string>;
  auto_restart: boolean;
  schedule: string | null;
  pid: number | null;
  logs_tail: string | null;
  error_message: string | null;
  started_at: string | null;
  stopped_at: string | null;
  created_at: string;
  updated_at: string;
}

// Deploy command timeout (2 min for install + start)
const DEPLOY_TIMEOUT_MS = 2 * 60 * 1000;
const DEPLOY_TABLE = 'vm_deployments';

// ─────────────────────────────────────────────────────────────────────────────
// GCS
// ─────────────────────────────────────────────────────────────────────────────

let _storage: Storage | null = null;
function getStorage(): Storage {
  if (!_storage) _storage = new Storage();
  return _storage;
}

export function isRetryableStorageError(error: any): boolean {
  const code = String(error?.code || error?.cause?.code || '').toUpperCase();
  const statusCode = Number(
    error?.statusCode
    || error?.status
    || error?.response?.status
    || error?.cause?.statusCode
    || error?.cause?.status
    || 0,
  );
  const message = String(error?.message || error?.cause?.message || '');
  if (RETRYABLE_STORAGE_STATUS_CODES.has(statusCode)) return true;
  if (RETRYABLE_STORAGE_ERROR_CODES.has(code)) return true;
  return /EAI_AGAIN|ENOTFOUND|ECONNRESET|ETIMEDOUT|socket hang up|network timeout|storage\.googleapis\.com/i.test(message);
}

async function withStorageRetry<T>(label: string, fn: () => Promise<T>, maxAttempts = 4): Promise<T> {
  let lastError: any;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      if (attempt >= maxAttempts || !isRetryableStorageError(error)) {
        throw error;
      }
      const delayMs = Math.min(750 * Math.pow(2, attempt - 1) + Math.round(Math.random() * 250), 5000);
      console.warn(`[deploy-manager] ${label} attempt ${attempt}/${maxAttempts} failed: ${error?.message || error}. Retrying in ${delayMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

function deployObjectName(userId: string, deployId: string): string {
  return `deploys/${userId}/${deployId}/bundle.json`;
}

async function uploadDeployBundle(userId: string, deployId: string, payload: any): Promise<string> {
  const objectName = deployObjectName(userId, deployId);
  const bucket = getStorage().bucket(CLOUD_ENGINE_BUCKET);
  const file = bucket.file(objectName);
  const content = JSON.stringify(payload, null, 2);
  await withStorageRetry('upload deploy bundle', () => file.save(content, { contentType: 'application/json', resumable: false }));
  return objectName;
}

async function getSignedDeployUrl(objectName: string): Promise<string> {
  const bucket = getStorage().bucket(CLOUD_ENGINE_BUCKET);
  const file = bucket.file(objectName);
  const [url] = await withStorageRetry('generate deploy signed url', () => file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + 30 * 60 * 1000,
  }));
  return url;
}

async function deleteDeployObject(objectName: string): Promise<void> {
  try {
    await getStorage().bucket(CLOUD_ENGINE_BUCKET).file(objectName).delete({ ignoreNotFound: true });
  } catch { /* ignore */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// Supabase CRUD
// ─────────────────────────────────────────────────────────────────────────────

async function insertDeployment(userId: string, req: DeployRequest, gcsObject: string | null): Promise<Deployment> {
  const id = randomUUID();
  const row = {
    id,
    user_id: userId,
    name: req.name,
    kind: req.kind,
    description: req.description || null,
    status: 'pending' as DeployStatus,
    gcs_object_name: gcsObject,
    env_vars: req.envVars || {},
    auto_restart: req.autoRestart ?? true,
    schedule: req.schedule || null,
    pid: null,
    logs_tail: null,
    error_message: null,
    started_at: null,
    stopped_at: null,
  };
  const { data, error } = await supabaseAdmin.from(DEPLOY_TABLE).insert(row).select().single();
  if (error) throw new Error(`DB insert failed: ${error.message}`);
  return data as Deployment;
}

async function updateDeployStatus(
  deployId: string,
  status: DeployStatus,
  extra?: Partial<Pick<Deployment, 'pid' | 'logs_tail' | 'error_message' | 'started_at' | 'stopped_at'>>,
): Promise<void> {
  const updates: any = { status, updated_at: new Date().toISOString(), ...extra };
  const { error } = await supabaseAdmin.from(DEPLOY_TABLE).update(updates).eq('id', deployId);
  if (error) console.error(`[deploy-manager] update status error:`, error.message);
}

export async function getDeployment(userId: string, deployId: string): Promise<Deployment | null> {
  const { data } = await supabaseAdmin.from(DEPLOY_TABLE).select('*').eq('id', deployId).eq('user_id', userId).single();
  return (data as Deployment) || null;
}

export async function listDeployments(userId: string): Promise<Deployment[]> {
  const { data } = await supabaseAdmin
    .from(DEPLOY_TABLE)
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  return (data as Deployment[]) || [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Deploy Operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create and start a new deployment on the user's Cloud VM.
 */
export async function createDeployment(userId: string, req: DeployRequest): Promise<Deployment> {
  const deployId = randomUUID();
  let gcsObject: string | null = null;

  const bundlePayload = {
    id: deployId,
    kind: req.kind,
    name: req.name,
    payload: req.payload,
    envVars: req.envVars || {},
    autoRestart: req.autoRestart ?? true,
    schedule: req.schedule || null,
  };

  // 1. Try uploading bundle to GCS (non-fatal — falls back to inline delivery)
  let gcsUploadOk = false;
  try {
    gcsObject = await uploadDeployBundle(userId, deployId, bundlePayload);
    gcsUploadOk = true;
  } catch (e: any) {
    console.warn(`[deploy-manager] GCS upload failed, will send bundle inline: ${e?.message || e}`);
  }

  // 2. Save to DB
  const deployment = await insertDeployment(userId, { ...req }, gcsObject);
  await supabaseAdmin.from(DEPLOY_TABLE).update({ id: deployId, gcs_object_name: gcsObject }).eq('id', deployment.id);
  const finalDeploy = { ...deployment, id: deployId, gcs_object_name: gcsObject };

  // 3. Trigger deploy on VM
  try {
    await updateDeployStatus(deployId, 'uploading');

    // Resolve signed download URL if GCS upload succeeded
    let downloadUrl = '';
    if (gcsUploadOk && gcsObject) {
      try {
        downloadUrl = await getSignedDeployUrl(gcsObject);
      } catch (e: any) {
        console.warn(`[deploy-manager] Signed URL generation failed, will send bundle inline: ${e?.message || e}`);
      }
    }

    await updateDeployStatus(deployId, 'deploying');

    const deployArgs: any = {
      deployId,
      downloadUrl,
      kind: req.kind,
      name: req.name,
      envVars: req.envVars || {},
      autoRestart: req.autoRestart ?? true,
      schedule: req.schedule || null,
    };

    // Send bundle inline when GCS path is unavailable
    if (!downloadUrl) {
      deployArgs.inlineBundle = bundlePayload;
    }

    const result = await sendVMCommand(userId, 'deploy_start', deployArgs, DEPLOY_TIMEOUT_MS);

    if (!result.ok) {
      await updateDeployStatus(deployId, 'failed', { error_message: result.error || 'deploy_command_failed' });
      return { ...finalDeploy, status: 'failed', error_message: result.error || 'deploy_command_failed' };
    }

    await updateDeployStatus(deployId, 'running', {
      pid: result.result?.pid || null,
      started_at: new Date().toISOString(),
    });

    return { ...finalDeploy, status: 'running', pid: result.result?.pid || null, started_at: new Date().toISOString() };
  } catch (e: any) {
    await updateDeployStatus(deployId, 'failed', { error_message: e?.message });
    return { ...finalDeploy, status: 'failed', error_message: e?.message };
  }
}

/**
 * Stop a running deployment.
 */
export async function stopDeployment(userId: string, deployId: string): Promise<{ success: boolean; error?: string }> {
  const deploy = await getDeployment(userId, deployId);
  if (!deploy) return { success: false, error: 'not_found' };
  if (deploy.status !== 'running') return { success: false, error: `Cannot stop deployment in '${deploy.status}' state` };

  const result = await sendVMCommand(userId, 'deploy_stop', { deployId }, 30_000);
  if (!result.ok) return { success: false, error: result.error || 'stop_failed' };

  await updateDeployStatus(deployId, 'stopped', { stopped_at: new Date().toISOString() });
  return { success: true };
}

/**
 * Restart a stopped/failed deployment.
 */
export async function restartDeployment(userId: string, deployId: string): Promise<{ success: boolean; error?: string }> {
  const deploy = await getDeployment(userId, deployId);
  if (!deploy) return { success: false, error: 'not_found' };
  if (deploy.status !== 'stopped' && deploy.status !== 'failed' && deploy.status !== 'completed') {
    return { success: false, error: `Cannot restart deployment in '${deploy.status}' state` };
  }
  if (!deploy.gcs_object_name) return { success: false, error: 'no_bundle' };

  try {
    await updateDeployStatus(deployId, 'deploying');

    let downloadUrl = '';
    try {
      downloadUrl = await getSignedDeployUrl(deploy.gcs_object_name);
    } catch (e: any) {
      console.warn(`[deploy-manager] Restart signed URL failed, VM will use cached bundle: ${e?.message || e}`);
    }

    const result = await sendVMCommand(userId, 'deploy_start', {
      deployId,
      downloadUrl,
      kind: deploy.kind,
      name: deploy.name,
      envVars: deploy.env_vars || {},
      autoRestart: deploy.auto_restart,
      schedule: deploy.schedule,
    }, DEPLOY_TIMEOUT_MS);

    if (!result.ok) {
      await updateDeployStatus(deployId, 'failed', { error_message: result.error });
      return { success: false, error: result.error };
    }

    await updateDeployStatus(deployId, 'running', {
      pid: result.result?.pid || null,
      started_at: new Date().toISOString(),
      error_message: null,
    });
    return { success: true };
  } catch (e: any) {
    await updateDeployStatus(deployId, 'failed', { error_message: e?.message });
    return { success: false, error: e?.message };
  }
}

/**
 * Delete a deployment — stop if running, remove from DB, clean GCS.
 */
export async function deleteDeployment(userId: string, deployId: string): Promise<{ success: boolean; error?: string }> {
  const deploy = await getDeployment(userId, deployId);
  if (!deploy) return { success: false, error: 'not_found' };

  // Stop if running
  if (deploy.status === 'running') {
    await sendVMCommand(userId, 'deploy_stop', { deployId }, 15_000).catch(() => {});
  }

  // Tell agent to clean up local files
  await sendVMCommand(userId, 'deploy_cleanup', { deployId }, 15_000).catch(() => {});

  // Remove GCS bundle
  if (deploy.gcs_object_name) {
    await deleteDeployObject(deploy.gcs_object_name);
  }

  // Delete from DB
  const { error } = await supabaseAdmin.from(DEPLOY_TABLE).delete().eq('id', deployId).eq('user_id', userId);
  if (error) return { success: false, error: error.message };
  return { success: true };
}

/**
 * Fetch logs for a deployment via the VM agent.
 */
export async function getDeployLogs(userId: string, deployId: string, lines = 200): Promise<{ ok: boolean; logs?: string; error?: string }> {
  const result = await sendVMCommand(userId, 'deploy_logs', { deployId, lines }, 15_000);
  if (!result.ok) return { ok: false, error: result.error || 'logs_unavailable' };
  return { ok: true, logs: result.result?.logs || '' };
}
