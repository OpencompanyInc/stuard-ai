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
import { pingVMAgent } from './vm-command';
import { getComputeProvider } from './compute';
import { writeLog } from '../utils/logger';

interface HealthEntry {
  userId: string;
  lastPing: number;
  healthStatus: 'healthy' | 'unhealthy' | 'unreachable' | 'unknown';
  agentVersion: string;
  metrics: VMMetrics | null;
}

// In-memory health state per user
const healthMap = new Map<string, HealthEntry>();

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

export function getLatestMetrics(userId: string): VMMetrics | null {
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
        healthMap.set(engine.user_id, {
          userId: engine.user_id,
          lastPing: now,
          healthStatus: 'healthy',
          agentVersion: agentData.agentVersion || '',
          metrics: null, // metrics fetched separately if needed
        });
        await updateEngineHealth(engine.user_id, {
          last_heartbeat_at: new Date(now).toISOString(),
          health_status: 'healthy',
          agent_version: agentData.agentVersion || '',
        }).catch(() => {});
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
      }
    }
  } catch (e) {
    console.error('[vm-health] Health check error:', e);
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
