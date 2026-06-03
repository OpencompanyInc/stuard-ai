import { COMPUTE_BILLING_INTERVAL_MS } from '../utils/config';
import {
  creditsFromUsd,
  resolveComputeMachineSpec,
} from '../pricing';
import {
  getActiveCloudEngines,
  getStorageUsage,
  insertBillingEvent,
  updateCloudEngineStatus,
  type CloudEngine,
} from '../supabase';
import { getComputeProvider } from './compute';
import { syncToCloud } from './sync-engine';
import { runStorageBillingCycle, billStoragePlanForUser } from './hot-storage';

// ─────────────────────────────────────────────────────────────────────────────
// Billing Cycle
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs a single billing cycle. Called hourly by the cron interval.
 * Iterates all non-deleted engines and deducts credits for compute (if running).
 *
 * Storage is NOT metered here: hot disk is a flat prepaid block (see
 * STORAGE_PLANS / purchaseStoragePlan in hot-storage.ts) and cold storage is
 * included with the plan, not billed by usage.
 */
export async function runBillingCycle(): Promise<void> {
  const billingHour = new Date();
  // Truncate to the hour for idempotent billing
  billingHour.setMinutes(0, 0, 0);

  const engines = await getActiveCloudEngines();

  if (engines.length > 0) {
    console.log(`[billing] Running billing cycle for ${engines.length} engine(s) at ${billingHour.toISOString()}`);
    for (const engine of engines) {
      try {
        await billEngine(engine, billingHour);
      } catch (err: any) {
        console.error(`[billing] Error billing engine for user ${engine.user_id}:`, err?.message);
      }
    }
  }

  // Flat monthly storage-plan fees are independent of engines, so renew them in
  // their own pass (idempotent per calendar month).
  try {
    await runStorageBillingCycle(new Date());
  } catch (err: any) {
    console.error('[billing] Storage billing cycle error:', err?.message || err);
  }
}

async function billEngine(engine: CloudEngine, billingHour: Date): Promise<void> {
  const userId = engine.user_id;

  const machineSpec = resolveComputeMachineSpec(engine.machine_type);
  const tierKey = machineSpec?.tier || 'custom';
  const hourlyUsd = machineSpec?.hourlyUsd ?? 0;
  const machineType = machineSpec?.machineType || engine.machine_type;

  // ── Compute billing (only when running) ──────────────────────────────────
  // Storage is intentionally not billed here — hot disk is a flat prepaid plan
  // block and cold storage is included with the plan (see hot-storage.ts).
  if (engine.status === 'running') {
    const computeCredits = creditsFromUsd(hourlyUsd);
    if (computeCredits > 0) {
      await insertBillingEvent(userId, 'compute', computeCredits, {
        tier: tierKey,
        machineType,
        hourlyUsd,
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
 * Catch up on any unbilled compute hours for a single engine.
 * Safe to call on every request — insertBillingEvent upserts by
 * (user_id, event_type, billing_hour) so duplicate calls are no-ops.
 *
 * Only compute is metered (storage is a flat prepaid plan fee), and compute is
 * billed only while running, from `started_at` (current running session). If the
 * engine isn't running there is nothing to catch up.
 *
 * The optional lookback cap is important for interactive status polling:
 * it prevents a single page load from replaying an entire month of missed
 * hours after a local restart or manual row edits.
 */
export async function catchUpBilling(
  engine: CloudEngine,
  options?: { maxBackfillHours?: number },
): Promise<void> {
  // Renew the flat storage-plan fee regardless of compute/running state. This is
  // idempotent (deduped per calendar month) and keeps storage billing correct on
  // Cloud Run, where the hourly setInterval cron is unreliable.
  try {
    const usage = await getStorageUsage(engine.user_id);
    if (usage) await billStoragePlanForUser(usage);
  } catch (err: any) {
    console.error(`[billing] Storage catch-up failed for user ${engine.user_id}:`, err?.message);
  }

  if (engine.status !== 'running' || !engine.started_at) return;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const truncateToHour = (d: Date) => {
    const h = new Date(d);
    h.setMinutes(0, 0, 0);
    return h;
  };

  const currentHour = truncateToHour(now);

  // Compute: bill from max(month_start, started_at)
  const started = new Date(engine.started_at);
  let computeFrom = truncateToHour(started > monthStart ? started : monthStart);

  const maxBackfillHours = Math.max(0, Math.floor(Number(options?.maxBackfillHours || 0)));
  if (maxBackfillHours > 0) {
    const lookbackStart = new Date(currentHour.getTime() - ((maxBackfillHours - 1) * 3_600_000));
    if (computeFrom < lookbackStart) computeFrom = lookbackStart;
  }

  const cursor = new Date(computeFrom);
  while (cursor <= currentHour) {
    try {
      await billEngine(engine, new Date(cursor));
    } catch (err: any) {
      console.error(`[billing] catchUp error for user ${engine.user_id} at ${cursor.toISOString()}:`, err?.message);
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
