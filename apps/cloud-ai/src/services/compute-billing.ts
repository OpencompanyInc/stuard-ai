import { COMPUTE_BILLING_INTERVAL_MS } from '../utils/config';
import {
  STORAGE_PRICING,
  creditsFromUsd,
  resolveComputeMachineSpec,
} from '../pricing';
import {
  getActiveCloudEngines,
  getStorageUsage,
  insertBillingEvent,
  logUsageEvent,
  updateCloudEngineStatus,
  type CloudEngine,
} from '../supabase';
import { getComputeProvider } from './compute';
import { syncToCloud } from './sync-engine';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const HOURS_PER_MONTH = 730;

// ─────────────────────────────────────────────────────────────────────────────
// Billing Cycle
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs a single billing cycle. Called hourly by the cron interval.
 * Iterates all non-deleted engines and deducts credits for:
 *  - Compute (if running)
 *  - Hot storage (always, while engine exists)
 *  - Cold storage (always, based on stored bytes)
 */
export async function runBillingCycle(): Promise<void> {
  const billingHour = new Date();
  // Truncate to the hour for idempotent billing
  billingHour.setMinutes(0, 0, 0);

  const engines = await getActiveCloudEngines();
  if (engines.length === 0) return;

  console.log(`[billing] Running billing cycle for ${engines.length} engine(s) at ${billingHour.toISOString()}`);

  for (const engine of engines) {
    try {
      await billEngine(engine, billingHour);
    } catch (err: any) {
      console.error(`[billing] Error billing engine for user ${engine.user_id}:`, err?.message);
    }
  }
}

async function billEngine(engine: CloudEngine, billingHour: Date): Promise<void> {
  const userId = engine.user_id;

  const machineSpec = resolveComputeMachineSpec(engine.machine_type);
  const tierKey = machineSpec?.tier || 'custom';
  const hourlyUsd = machineSpec?.hourlyUsd ?? 0;
  const machineType = machineSpec?.machineType || engine.machine_type;

  // ── Compute billing (only when running) ──────────────────────────────────
  if (engine.status === 'running') {
    const computeCredits = creditsFromUsd(hourlyUsd);
    if (computeCredits > 0) {
      await insertBillingEvent(userId, 'compute', computeCredits, {
        tier: tierKey,
        machineType,
        hourlyUsd,
      }, billingHour);

      // Also log to usage_events for unified credit tracking
      await logUsageEvent(userId, null, 'cloud_compute', {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        costUsd: hourlyUsd,
      });
    }
  }

  // ── Hot storage billing (24/7 while engine exists) ───────────────────────
  const hotGb = engine.disk_size_gb;
  const hotHourlyUsd = (hotGb * STORAGE_PRICING.hotPerGbMonthUsd) / HOURS_PER_MONTH;
  const hotCredits = creditsFromUsd(hotHourlyUsd);
  if (hotCredits > 0) {
    await insertBillingEvent(userId, 'hot_storage', hotCredits, {
      diskSizeGb: hotGb,
      hourlyUsd: hotHourlyUsd,
    }, billingHour);
  }

  // ── Cold storage billing (24/7 based on stored bytes) ────────────────────
  const storageUsage = await getStorageUsage(userId);
  const coldBytes = Number(storageUsage?.cold_storage_bytes || 0);
  if (coldBytes > 0) {
    const coldGb = coldBytes / (1024 * 1024 * 1024);
    const coldHourlyUsd = (coldGb * STORAGE_PRICING.coldPerGbMonthUsd) / HOURS_PER_MONTH;
    const coldCredits = creditsFromUsd(coldHourlyUsd);
    if (coldCredits > 0) {
      await insertBillingEvent(userId, 'cold_storage', coldCredits, {
        coldBytes,
        coldGb: Number(coldGb.toFixed(4)),
        hourlyUsd: coldHourlyUsd,
      }, billingHour);
    }
  }

  // ── Auto-stop on zero credits ────────────────────────────────────────────
  // Check if user is out of credits; if so, gracefully stop their VM
  if (engine.status === 'running') {
    try {
      const { checkAccess } = await import('../supabase');
      const access = await checkAccess(userId);
      if (!access.allowed) {
        console.warn(`[billing] User ${userId} out of credits — auto-stopping VM`);
        const provider = getComputeProvider();
        await syncToCloud(userId);
        await provider.stopVM(engine.instance_name, engine.zone);
        await updateCloudEngineStatus(userId, 'stopped', 'running', {
          stopped_at: new Date().toISOString(),
        });
      }
    } catch (err: any) {
      console.error(`[billing] Auto-stop check failed for user ${userId}:`, err?.message);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// On-demand catch-up billing (for Cloud Run where setInterval is unreliable)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Catch up on any unbilled hours for a single engine.
 * Safe to call on every request — insertBillingEvent upserts by
 * (user_id, event_type, billing_hour) so duplicate calls are no-ops.
 *
 * Compute is only billed from `started_at` (current running session).
 * Storage is billed from `created_at` or month start, whichever is later.
 */
export async function catchUpBilling(engine: CloudEngine): Promise<void> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const truncateToHour = (d: Date) => {
    const h = new Date(d);
    h.setMinutes(0, 0, 0);
    return h;
  };

  const currentHour = truncateToHour(now);

  // Storage: bill from max(month_start, created_at)
  const engineCreated = engine.created_at ? new Date(engine.created_at) : now;
  const storageFrom = truncateToHour(engineCreated > monthStart ? engineCreated : monthStart);

  // Compute: only bill from started_at if currently running
  let computeFrom: Date | null = null;
  if (engine.status === 'running' && engine.started_at) {
    const started = new Date(engine.started_at);
    computeFrom = truncateToHour(started > monthStart ? started : monthStart);
  }

  // Walk each hour and bill appropriately
  const cursor = new Date(storageFrom);
  while (cursor <= currentHour) {
    const billingHour = new Date(cursor);
    const inComputeWindow = computeFrom && cursor >= computeFrom;

    try {
      // Build a view of the engine with the correct status for this hour
      const engineForHour = inComputeWindow
        ? engine
        : { ...engine, status: 'stopped' }; // suppress compute billing outside running window
      await billEngine(engineForHour, billingHour);
    } catch (err: any) {
      console.error(`[billing] catchUp error for user ${engine.user_id} at ${billingHour.toISOString()}:`, err?.message);
    }
    cursor.setTime(cursor.getTime() + 3_600_000);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Usage Aggregation
// ─────────────────────────────────────────────────────────────────────────────

export interface ComputeUsageSummary {
  compute: number;
  hotStorage: number;
  coldStorage: number;
  total: number;
}

/**
 * Aggregate compute billing events for a user from a given month start.
 */
export async function getUserComputeUsage(
  userId: string,
  monthStart?: Date,
): Promise<ComputeUsageSummary> {
  // Import here to avoid circular dependency at module load time
  const { getSupabaseService } = await import('../supabase');
  const supabase = getSupabaseService();
  if (!supabase) return { compute: 0, hotStorage: 0, coldStorage: 0, total: 0 };

  const start = monthStart || new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  try {
    const { data, error } = await supabase
      .from('compute_billing_events')
      .select('event_type, credits_deducted')
      .eq('user_id', userId)
      .gte('created_at', start.toISOString());

    if (error || !data) return { compute: 0, hotStorage: 0, coldStorage: 0, total: 0 };

    let compute = 0;
    let hotStorage = 0;
    let coldStorage = 0;

    for (const row of data as any[]) {
      const credits = Number(row.credits_deducted || 0);
      switch (row.event_type) {
        case 'compute':
          compute += credits;
          break;
        case 'hot_storage':
          hotStorage += credits;
          break;
        case 'cold_storage':
          coldStorage += credits;
          break;
      }
    }

    return { compute, hotStorage, coldStorage, total: compute + hotStorage + coldStorage };
  } catch {
    return { compute: 0, hotStorage: 0, coldStorage: 0, total: 0 };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cron Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

let billingInterval: ReturnType<typeof setInterval> | null = null;

export function startBillingCron(): void {
  if (billingInterval) return; // already running
  console.log(`[billing] Starting compute billing cron (interval: ${COMPUTE_BILLING_INTERVAL_MS}ms)`);
  billingInterval = setInterval(() => {
    runBillingCycle().catch((err) => {
      console.error('[billing] Billing cycle error:', err?.message || err);
    });
  }, COMPUTE_BILLING_INTERVAL_MS);
  // Don't prevent process exit
  if (billingInterval.unref) billingInterval.unref();
}

export function stopBillingCron(): void {
  if (billingInterval) {
    clearInterval(billingInterval);
    billingInterval = null;
    console.log('[billing] Billing cron stopped');
  }
}
