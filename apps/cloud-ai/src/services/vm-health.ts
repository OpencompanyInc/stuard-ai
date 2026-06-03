/**
 * VM Health Monitor
 *
 * Periodically pings VM agents via HTTP to track health,
 * syncs GCE status, and flushes metrics to DB.
 *
 * No persistent WebSocket — cloud-ai actively polls VMs.
 */

import { VM_HEALTH_CHECK_INTERVAL_MS, VM_HEALTH_STALE_THRESHOLD_MS } from '../utils/config';
import {
  getActiveCloudEngines,
  updateEngineHealth,
  insertMetricsBatch,
  type VMMetrics,
} from '../supabase';
import { pingVMAgent, fetchVMMetrics } from './vm-command';
import { getComputeProvider } from './compute';
import { writeLog } from '../utils/logger';
import { deliverQueuedVMChatEvents } from './chat-sync';
import { generateAgentDataDownloadUrl, generateAgentDataUploadUrl } from './cold-storage';
import { sendVMCommand } from './vm-command';
import { syncToCloud, getSyncStatus } from './sync-engine';

/** Desktop-friendly metrics format (field names match what the desktop UI expects). */
export interface DesktopMetrics {
  cpu: number;
  ram_used: number;    // bytes
  ram_total: number;   // bytes
  disk_used: number;   // bytes
  disk_total: number;  // bytes
  net_rx: number;      // bytes
  net_tx: number;      // bytes
}

interface HealthEntry {
  userId: string;
  lastPing: number;
  healthStatus: 'healthy' | 'unhealthy' | 'unreachable' | 'unknown';
  agentVersion: string;
  metrics: DesktopMetrics | null;
}

// In-memory health state per user
const healthMap = new Map<string, HealthEntry>();

// Tracks users we've already pulled agent-data into the VM for in this process
// lifetime. Stops us from re-pulling on every health-recovery (e.g. a transient
// network blip) which would clobber VM-side mutations made between blips.
// Cleared when the engine becomes inactive so a fresh VM gets a fresh pull.
const agentDataBootstrapped = new Set<string>();

// ── Periodic cold-storage backup ─────────────────────────────────────────────
// The VM only persisted to cold storage on a *graceful* stop/start/deploy. Any
// non-graceful lifecycle event in between — a crash, GCP preemption, OOM, or a
// recreate to pick up a new bundle — therefore rolled the workspace AND agent
// databases back to the last graceful checkpoint ("memory disappears after a
// while", uploaded files vanish). To bound that loss we push BOTH cold-storage
// objects on a fixed cadence while the VM is healthy, refreshing them together
// so the workspace copy of agent-data and the dedicated agent-data object never
// diverge. Both /sync/upload and `sync_agent_data` upload handlers already exist
// on deployed VMs, so this needs no new VM bundle.
const COLD_BACKUP_INTERVAL_MS = Number(
  process.env.VM_COLD_BACKUP_INTERVAL_MS || 30 * 60 * 1000,
); // 30 min
const coldBackupInFlight = new Set<string>();

// Metrics buffer — flushed to DB every FLUSH_INTERVAL_MS
const metricsBuffer: Array<{ user_id: string } & VMMetrics> = [];
const FLUSH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let healthTimer: NodeJS.Timeout | null = null;
let flushTimer: NodeJS.Timeout | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// Health Status Queries
// ─────────────────────────────────────────────────────────────────────────────

export function getHealthStatus(userId: string): HealthEntry | null {
  return healthMap.get(userId) || null;
}

export function getLatestMetrics(userId: string): DesktopMetrics | null {
  return healthMap.get(userId)?.metrics || null;
}

export function getAllHealthStatuses(): HealthEntry[] {
  return Array.from(healthMap.values());
}

// ─────────────────────────────────────────────────────────────────────────────
// Periodic Health Check (HTTP-based)
// ─────────────────────────────────────────────────────────────────────────────

async function runHealthCheck(): Promise<void> {
  try {
    const engines = await getActiveCloudEngines();

    for (const engine of engines) {
      if (engine.status !== 'running') continue;

      // Ensure we have an external IP
      let ip = engine.external_ip || null;
      if (!ip && engine.instance_name && engine.zone) {
        try {
          const provider = getComputeProvider();
          ip = await provider.getVMExternalIP(engine.instance_name, engine.zone);
          if (ip) {
            await updateEngineHealth(engine.user_id, { external_ip: ip }).catch(() => {});
          }
        } catch { /* non-fatal */ }
      }

      if (!ip) {
        // Can't reach VM — mark unreachable
        healthMap.set(engine.user_id, {
          userId: engine.user_id,
          lastPing: 0,
          healthStatus: 'unreachable',
          agentVersion: '',
          metrics: null,
        });
        await updateEngineHealth(engine.user_id, { health_status: 'unreachable' }).catch(() => {});
        continue;
      }

      // Ping the VM agent via HTTP
      const pingResult = await pingVMAgent(ip);
      const now = Date.now();

      if (pingResult.ok) {
        const agentData = pingResult.result || {};
        const prevStatus = healthMap.get(engine.user_id)?.healthStatus;
        // Transitioning from non-healthy → healthy means the VM just came
        // online (or recovered). Drain any queued desktop→VM chat-sync events
        // so prior conversations and titles land on the VM without waiting
        // for a fresh user action.
        if (prevStatus !== 'healthy') {
          deliverQueuedVMChatEvents(engine.user_id).catch((e: any) => {
            writeLog('chat_sync_drain_failed', { userId: engine.user_id, error: e?.message });
          });

          // Bootstrap: tell the VM to pull the latest desktop-exported agent
          // data from GCS once per VM lifetime. The desktop may have uploaded
          // the bundle while the VM was offline, so we can't rely on the
          // desktop noticing the transition.
          if (!agentDataBootstrapped.has(engine.user_id)) {
            agentDataBootstrapped.add(engine.user_id);
            void (async () => {
              try {
                const urlResult = await generateAgentDataDownloadUrl(engine.user_id);
                if (!urlResult) {
                  writeLog('agent_data_bootstrap_skip', { userId: engine.user_id, reason: 'no_bundle' });
                  return;
                }
                const cmdResult = await sendVMCommand(
                  engine.user_id,
                  'sync_agent_data',
                  { direction: 'download', downloadUrl: urlResult.downloadUrl },
                  10 * 60_000,
                );
                writeLog('agent_data_bootstrap', {
                  userId: engine.user_id,
                  ok: !!cmdResult?.ok,
                  error: cmdResult?.error,
                });
              } catch (e: any) {
                // Failed bootstrap — allow a retry on next non-healthy → healthy transition.
                agentDataBootstrapped.delete(engine.user_id);
                writeLog('agent_data_bootstrap_failed', { userId: engine.user_id, error: e?.message });
              }
            })();
          }
        }

        // Fetch actual metrics from VM agent
        let vmMetrics: DesktopMetrics | null = null;
        try {
          const metricsResult = await fetchVMMetrics(ip, engine.user_id);
          if (metricsResult.ok && metricsResult.result?.metrics) {
            const m = metricsResult.result.metrics;
            vmMetrics = {
              cpu: m.cpu_percent ?? 0,
              ram_used: (m.memory_used_mb ?? 0) * 1024 * 1024, // convert MB → bytes
              ram_total: (m.memory_total_mb ?? 0) * 1024 * 1024,
              disk_used: (m.disk_used_gb ?? 0) * 1024 * 1024 * 1024, // convert GB → bytes
              disk_total: (m.disk_total_gb ?? 0) * 1024 * 1024 * 1024,
              net_rx: m.network_rx_bytes ?? 0,
              net_tx: m.network_tx_bytes ?? 0,
            };
            // Buffer for DB flush (convert to DB schema format)
            metricsBuffer.push({
              user_id: engine.user_id,
              cpu_percent: m.cpu_percent ?? 0,
              memory_percent: m.memory_percent ?? 0,
              memory_used_mb: m.memory_used_mb ?? 0,
              memory_total_mb: m.memory_total_mb ?? 0,
              disk_percent: m.disk_percent ?? 0,
              disk_used_gb: m.disk_used_gb ?? 0,
              disk_total_gb: m.disk_total_gb ?? 0,
              network_rx_bytes: m.network_rx_bytes ?? 0,
              network_tx_bytes: m.network_tx_bytes ?? 0,
            });
          }
        } catch {
          // Non-fatal — metrics are best-effort
        }

        healthMap.set(engine.user_id, {
          userId: engine.user_id,
          lastPing: now,
          healthStatus: 'healthy',
          agentVersion: agentData.agentVersion || '',
          metrics: vmMetrics,
        });
        await updateEngineHealth(engine.user_id, {
          last_heartbeat_at: new Date(now).toISOString(),
          health_status: 'healthy',
          agent_version: agentData.agentVersion || '',
        }).catch(() => {});

        // Steady-state only (already healthy last cycle): push a periodic
        // cold-storage checkpoint. Skipped on the non-healthy → healthy
        // transition cycle so it never races the agent-data bootstrap *pull*
        // above (which runs exactly on that transition).
        if (prevStatus === 'healthy') {
          void maybeBackupToColdStorage(engine.user_id);
        }
      } else {
        const prev = healthMap.get(engine.user_id);
        const newStatus = prev?.lastPing && (now - prev.lastPing < VM_HEALTH_STALE_THRESHOLD_MS)
          ? 'unhealthy' : 'unreachable';

        healthMap.set(engine.user_id, {
          userId: engine.user_id,
          lastPing: prev?.lastPing || 0,
          healthStatus: newStatus,
          agentVersion: prev?.agentVersion || '',
          metrics: prev?.metrics || null,
        });

        await updateEngineHealth(engine.user_id, { health_status: newStatus }).catch(() => {});
        writeLog(`vm_health_ping_failed userId=${engine.user_id} error=${pingResult.error}`);
      }
    }

    // Clean up entries for users whose engines are no longer active
    const activeUserIds = new Set(engines.map(e => e.user_id));
    for (const [userId] of healthMap) {
      if (!activeUserIds.has(userId)) {
        healthMap.delete(userId);
        agentDataBootstrapped.delete(userId);
      }
    }
  } catch (e) {
    console.error('[vm-health] Health check error:', e);
  }
}

/**
 * Push the VM's workspace and agent databases to cold storage if the last
 * checkpoint is older than COLD_BACKUP_INTERVAL_MS. Fire-and-forget; safe to
 * call every health cycle.
 *
 * `last_sync_at` (updated by syncToCloud and the stop/start paths) is the
 * cross-instance guard: with multiple Cloud Run instances each running their
 * own health monitor, whichever backs up first advances the timestamp and the
 * others skip. The in-flight set guards against overlap within one instance.
 */
async function maybeBackupToColdStorage(userId: string): Promise<void> {
  if (coldBackupInFlight.has(userId)) return;

  try {
    const status = await getSyncStatus(userId);
    const last = status.lastSyncAt ? Date.parse(status.lastSyncAt) : 0;
    if (last && Date.now() - last < COLD_BACKUP_INTERVAL_MS) return;
  } catch {
    // Can't read the cursor — fall through and back up (prefer over-backup to
    // a silent data-loss window).
  }

  coldBackupInFlight.add(userId);
  try {
    // 1. Workspace → {userId}/memory_backup.tar.gz (also bumps last_sync_at).
    const workspace = await syncToCloud(userId);

    // 2. Refresh the full agent-data object — the restore-of-record used on a
    //    recreate/crash. Done in the same pass as the workspace backup so the
    //    two copies of the agent DBs stay consistent. Pass the upload URL so the
    //    VM needn't round-trip back to mint one.
    let agentOk = false;
    let agentErr: string | undefined;
    try {
      const { uploadUrl } = await generateAgentDataUploadUrl(userId);
      const result = await sendVMCommand(
        userId,
        'sync_agent_data',
        { direction: 'upload', mode: 'full', uploadUrl },
        10 * 60_000,
      );
      agentOk = Boolean(result?.ok);
      agentErr = result?.error;
    } catch (e: any) {
      agentErr = e?.message || 'agent_data_upload_failed';
    }

    writeLog('vm_cold_backup', {
      userId,
      workspaceOk: workspace.success,
      workspaceBytes: workspace.bytes,
      workspaceErr: workspace.success ? undefined : workspace.error,
      agentOk,
      agentErr,
    });
  } catch (e: any) {
    writeLog('vm_cold_backup_failed', { userId, error: e?.message });
  } finally {
    coldBackupInFlight.delete(userId);
  }
}



// ─────────────────────────────────────────────────────────────────────────────
// Metrics Flush
// ─────────────────────────────────────────────────────────────────────────────

async function flushMetrics(): Promise<void> {
  if (metricsBuffer.length === 0) return;
  try {
    const batch = metricsBuffer.splice(0, metricsBuffer.length);
    await insertMetricsBatch(batch);
  } catch (e) {
    console.error('[vm-health] Metrics flush error:', e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

export function startVMHealthMonitor(): void {
  console.log(`[vm-health] Starting HTTP health monitor (check every ${VM_HEALTH_CHECK_INTERVAL_MS}ms)`);

  // Run health check periodically
  healthTimer = setInterval(runHealthCheck, VM_HEALTH_CHECK_INTERVAL_MS);

  // Flush metrics to DB periodically
  flushTimer = setInterval(flushMetrics, FLUSH_INTERVAL_MS);

  // Run initial health check
  runHealthCheck().catch(() => {});
}

export function stopVMHealthMonitor(): void {
  if (healthTimer) { clearInterval(healthTimer); healthTimer = null; }
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
  // Final flush
  flushMetrics().catch(() => {});
}
