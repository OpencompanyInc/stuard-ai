/**
 * Hot Storage Service
 *
 * Manages per-user hot storage (PD-SSD disk on GCE VMs) and cold storage
 * (GCS bucket `stuard-user-data`). Users can purchase storage quotas in tiers —
 * hot storage is attached to their VM, cold storage persists when VMs are stopped.
 *
 * VM hot disk ↔ GCS cold storage sync is handled by sync-engine.ts.
 * This module handles quota management, plan upgrades, and billing.
 */

import { creditsFromUsd } from '../pricing';
import {
  getStorageUsage,
  upsertStorageUsage,
  insertStoragePurchase,
  getCloudEngine,
  upsertCloudEngine,
  debitCredits,
  getCreditSummary,
  getPaidStorageUsages,
  type StorageUsage,
} from '../supabase';
import { getUserStorageBreakdown } from './cold-storage';
import { getComputeProvider } from './compute';
import { getLatestMetrics } from './vm-health';

// ─────────────────────────────────────────────────────────────────────────────
// Storage Plans
// ─────────────────────────────────────────────────────────────────────────────

export interface StoragePlan {
  id: string;
  name: string;
  hotDiskGb: number;
  coldStorageGb: number;
  monthlyUsd: number;
  monthlyCredits: number;
}

export const STORAGE_PLANS: Record<string, StoragePlan> = {
  free: {
    id: 'free',
    name: 'Free',
    hotDiskGb: 5,
    coldStorageGb: 0.1, // ~100MB of free persistent storage for everyone
    monthlyUsd: 0,
    monthlyCredits: 0,
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    hotDiskGb: 10,
    coldStorageGb: 5,
    monthlyUsd: 1.50,
    monthlyCredits: creditsFromUsd(1.50),
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    hotDiskGb: 25,
    coldStorageGb: 15,
    monthlyUsd: 4.00,
    monthlyCredits: creditsFromUsd(4.00),
  },
  power: {
    id: 'power',
    name: 'Power',
    hotDiskGb: 50,
    coldStorageGb: 30,
    monthlyUsd: 8.00,
    monthlyCredits: creditsFromUsd(8.00),
  },
  max: {
    id: 'max',
    name: 'Max',
    hotDiskGb: 100,
    coldStorageGb: 60,
    monthlyUsd: 15.00,
    monthlyCredits: creditsFromUsd(15.00),
  },
};

export function getStoragePlan(planId: string): StoragePlan | null {
  return STORAGE_PLANS[planId] || null;
}

export function listStoragePlans(): StoragePlan[] {
  return Object.values(STORAGE_PLANS);
}

// ─────────────────────────────────────────────────────────────────────────────
// User Storage Quota
// ─────────────────────────────────────────────────────────────────────────────

export interface UserStorageInfo {
  planId: string;
  plan: StoragePlan;
  hotDiskGb: number;       // allocated hot disk size
  hotUsedGb: number | null; // actual VM disk usage; null when the VM isn't reporting (stopped)
  coldStorageBytes: number; // total bytes in GCS (files + system backup) — billed/quota
  fileBytes: number;        // user files only — what the dashboard file list shows
  backupBytes: number;      // Stuard-managed workspace backup
  coldQuotaGb: number;     // max cold storage
  lastSyncAt: string | null;
}

/**
 * Get a user's current storage info (plan, quotas, usage).
 * Creates a default storage_usage record if one doesn't exist.
 */
export async function getUserStorageInfo(userId: string): Promise<UserStorageInfo> {
  let usage = await getStorageUsage(userId);

  // Initialize storage_usage record for new users
  if (!usage) {
    const defaultPlan = STORAGE_PLANS.free;
    await upsertStorageUsage(userId, {
      storage_plan_id: 'free',
      hot_storage_gb: defaultPlan.hotDiskGb,
      cold_storage_bytes: 0,
      storage_quota_gb: defaultPlan.hotDiskGb,
      cold_quota_gb: defaultPlan.coldStorageGb,
    } as any);
    usage = await getStorageUsage(userId);
  }

  const planId = (usage as any)?.storage_plan_id || 'free';
  const plan = STORAGE_PLANS[planId] || STORAGE_PLANS.free;

  const breakdown = await getUserStorageBreakdown(userId).catch(() => {
    const fallback = Number(usage?.cold_storage_bytes || 0);
    return { totalBytes: fallback, fileBytes: fallback, backupBytes: 0 };
  });

  // hot_storage_gb in the DB is the ALLOCATED disk size (set during provision),
  // NOT actual disk usage. Use the VM's actual disk size from cloud_engines.
  const engine = await getCloudEngine(userId);
  const actualDiskGb = engine?.disk_size_gb || plan.hotDiskGb;

  // Real hot-disk usage comes from the VM's reported metrics. When the VM isn't
  // reporting (stopped, or this process hasn't pinged it yet) we return null so
  // the UI shows "—" instead of a fabricated, fluctuating number.
  let hotUsedGb: number | null = null;
  try {
    const metrics = getLatestMetrics(userId);
    if (metrics && metrics.disk_total > 0) {
      hotUsedGb = metrics.disk_used / (1024 * 1024 * 1024);
    }
  } catch { /* metrics unavailable — leave null */ }

  return {
    planId,
    plan,
    hotDiskGb: actualDiskGb,
    hotUsedGb,
    coldStorageBytes: breakdown.totalBytes,
    fileBytes: breakdown.fileBytes,
    backupBytes: breakdown.backupBytes,
    coldQuotaGb: plan.coldStorageGb,
    lastSyncAt: usage?.last_sync_at || null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Purchase / Upgrade Storage
// ─────────────────────────────────────────────────────────────────────────────

export interface PurchaseResult {
  ok: boolean;
  planId?: string;
  error?: string;
  creditsCharged?: number;
}

/**
 * Purchase or upgrade a user's storage plan.
 * Deducts credits for the billing cycle and updates the DB + VM disk size.
 */
export async function purchaseStoragePlan(
  userId: string,
  newPlanId: string,
): Promise<PurchaseResult> {
  const plan = STORAGE_PLANS[newPlanId];
  if (!plan) {
    return { ok: false, error: 'invalid_plan' };
  }

  // Get current plan
  const usage = await getStorageUsage(userId);
  const currentPlanId = (usage as any)?.storage_plan_id || 'free';

  if (currentPlanId === newPlanId) {
    return { ok: false, error: 'already_on_plan' };
  }

  // Cannot downgrade if current usage exceeds new plan limits
  const coldBytes = Number(usage?.cold_storage_bytes || 0);
  const coldGb = coldBytes / (1024 * 1024 * 1024);
  if (coldGb > plan.coldStorageGb) {
    return { ok: false, error: 'cold_storage_exceeds_plan_limit' };
  }

  // Charge the flat plan fee for the current month. Uses debitCredits (the
  // canonical balance path) so the charge actually consumes credits and is
  // deduped per (plan, calendar-month) — the same ref the monthly renewal uses,
  // so the purchase month is never double-charged.
  const creditsToCharge = plan.monthlyCredits;
  const action = STORAGE_PLANS[currentPlanId] && plan.hotDiskGb > (STORAGE_PLANS[currentPlanId]?.hotDiskGb || 0)
    ? 'upgrade' as const
    : currentPlanId === 'free' ? 'purchase' as const : 'downgrade' as const;
  const now = new Date();

  if (creditsToCharge > 0) {
    await debitCredits(userId, {
      sourceType: 'storage_plan',
      sourceRef: storageChargeRef(newPlanId, now),
      credits: creditsToCharge,
      amountUsd: plan.monthlyUsd,
      metadata: {
        plan_id: newPlanId,
        previous_plan_id: currentPlanId,
        hot_disk_gb: plan.hotDiskGb,
        cold_quota_gb: plan.coldStorageGb,
        action,
        kind: 'storage_purchase',
      },
    });
  }

  // Record purchase audit log
  await insertStoragePurchase(userId, newPlanId, currentPlanId, creditsToCharge, action);

  // Update storage_usage with new plan info + the billing period boundary.
  await upsertStorageUsage(userId, {
    hot_storage_gb: plan.hotDiskGb,
    storage_plan_id: newPlanId,
    storage_quota_gb: plan.hotDiskGb,
    cold_quota_gb: plan.coldStorageGb,
    plan_purchased_at: now.toISOString(),
    plan_expires_at: firstOfNextMonth(now).toISOString(),
  } as any);

  // If VM is running, resize the disk
  const engine = await getCloudEngine(userId);
  if (engine && (engine.status === 'running' || engine.status === 'stopped') && engine.instance_name) {
    try {
      const provider = getComputeProvider();
      await provider.resizeVMDisk(engine.instance_name, engine.zone, plan.hotDiskGb);
      await upsertCloudEngine(userId, { disk_size_gb: plan.hotDiskGb });
      console.log(`[hot-storage] Resized disk for user ${userId} to ${plan.hotDiskGb}GB`);
    } catch (err: any) {
      console.error(`[hot-storage] Disk resize failed for user ${userId}:`, err?.message);
      // Non-fatal — disk will be resized on next VM start
    }
  }

  console.log(`[hot-storage] User ${userId} upgraded to plan ${newPlanId} (${plan.hotDiskGb}GB hot, ${plan.coldStorageGb}GB cold)`);
  return { ok: true, planId: newPlanId, creditsCharged: creditsToCharge };
}

// ─────────────────────────────────────────────────────────────────────────────
// Quota Enforcement
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a user has exceeded their cold storage quota.
 */
export async function checkColdStorageQuota(userId: string): Promise<{
  withinQuota: boolean;
  usedBytes: number;
  quotaBytes: number;
  usedGb: number;
  quotaGb: number;
}> {
  const info = await getUserStorageInfo(userId);
  const quotaBytes = info.coldQuotaGb * 1024 * 1024 * 1024;
  const usedBytes = info.coldStorageBytes;

  return {
    withinQuota: usedBytes <= quotaBytes,
    usedBytes,
    quotaBytes,
    usedGb: usedBytes / (1024 * 1024 * 1024),
    quotaGb: info.coldQuotaGb,
  };
}

/**
 * Check if a user can upload a file of a given size to cold storage.
 */
export async function canUploadFile(userId: string, fileSizeBytes: number): Promise<{
  allowed: boolean;
  reason?: string;
}> {
  const quota = await checkColdStorageQuota(userId);
  if (quota.usedBytes + fileSizeBytes > quota.quotaBytes) {
    return {
      allowed: false,
      reason: `Upload would exceed cold storage quota (${quota.usedGb.toFixed(2)}GB / ${quota.quotaGb}GB used). Upgrade your storage plan.`,
    };
  }
  return { allowed: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Recurring Storage Billing (flat monthly plan fee + grace period)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Days a user keeps their storage plan (and data) after they can no longer
 * cover the monthly fee, before being downgraded to free. Data is NEVER deleted
 * by this flow — downgrade only tightens the quota going forward.
 */
const STORAGE_GRACE_DAYS = (() => {
  const n = Number(process.env.STORAGE_GRACE_DAYS);
  return Number.isFinite(n) && n > 0 ? n : 14;
})();

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function firstOfNextMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 1);
}

/** Idempotency key for a plan's charge in a given calendar month. */
function storageChargeRef(planId: string, d: Date): string {
  return `storage:${planId}:${monthKey(d)}`;
}

/**
 * Renew a single user's flat storage-plan fee for the current period, applying a
 * grace period when they can't pay. NEVER deletes user data — on grace expiry the
 * plan is downgraded to free (quota tightens; existing data is retained).
 *
 * Idempotent: the charge is deduped per (plan, calendar-month) by debitCredits,
 * so this is safe to call hourly and on every status poll.
 */
export async function billStoragePlanForUser(usage: StorageUsage, now = new Date()): Promise<void> {
  const planId = usage.storage_plan_id || 'free';
  const plan = STORAGE_PLANS[planId];
  // Free / unknown plans are never charged and never expire.
  if (!plan || plan.monthlyCredits <= 0) return;

  const userId = usage.user_id;
  const expiresAt = usage.plan_expires_at ? new Date(usage.plan_expires_at) : null;

  // Plans purchased before recurring billing existed have no period boundary.
  // Grandfather the current month (no charge) and start renewing next month.
  if (!expiresAt || isNaN(expiresAt.getTime())) {
    await upsertStorageUsage(userId, { plan_expires_at: firstOfNextMonth(now).toISOString() } as any);
    return;
  }

  // Current period still active — nothing to do.
  if (now < expiresAt) return;

  // Period ended → attempt to renew for the current calendar month.
  const summary = await getCreditSummary(userId);
  const canPay = summary.unlimited || summary.remaining >= plan.monthlyCredits;

  if (canPay) {
    await debitCredits(userId, {
      sourceType: 'storage_plan',
      sourceRef: storageChargeRef(planId, now),
      credits: plan.monthlyCredits,
      amountUsd: plan.monthlyUsd,
      metadata: {
        plan_id: planId,
        hot_disk_gb: plan.hotDiskGb,
        cold_quota_gb: plan.coldStorageGb,
        period: monthKey(now),
        kind: 'storage_renewal',
      },
    });
    await upsertStorageUsage(userId, { plan_expires_at: firstOfNextMonth(now).toISOString() } as any);
    console.log(`[hot-storage] Renewed storage plan ${planId} for user ${userId} (${plan.monthlyCredits} credits)`);
    return;
  }

  // Can't pay → grace window. Retain the plan + data until the deadline, then
  // downgrade to free (still without deleting anything).
  const graceDeadline = new Date(expiresAt.getTime() + STORAGE_GRACE_DAYS * 24 * 60 * 60 * 1000);
  if (now >= graceDeadline) {
    await downgradeToFreeStoragePlan(userId, planId);
    console.warn(`[hot-storage] Storage grace expired for user ${userId} — downgraded ${planId}→free (data retained)`);
  } else {
    console.warn(`[hot-storage] User ${userId} can't cover storage plan ${planId}; in grace until ${graceDeadline.toISOString()}`);
  }
}

/**
 * Downgrade a user to the free storage plan WITHOUT deleting any data. Existing
 * data above the free quota is retained, but new uploads are blocked until they
 * free space or re-subscribe (see canUploadFile). The VM disk is intentionally
 * not shrunk (shrinking a live disk is unsafe).
 */
export async function downgradeToFreeStoragePlan(userId: string, previousPlanId: string): Promise<void> {
  const free = STORAGE_PLANS.free;
  await upsertStorageUsage(userId, {
    storage_plan_id: 'free',
    hot_storage_gb: free.hotDiskGb,
    storage_quota_gb: free.hotDiskGb,
    cold_quota_gb: free.coldStorageGb,
    plan_expires_at: null,
    plan_purchased_at: null,
  } as any);
  await insertStoragePurchase(userId, 'free', previousPlanId, 0, 'downgrade');
}

/**
 * Renew every paid storage plan. Called hourly by the billing cron. Charges are
 * idempotent per calendar month, so running this every hour is safe.
 */
export async function runStorageBillingCycle(now = new Date()): Promise<void> {
  const usages = await getPaidStorageUsages();
  if (usages.length === 0) return;
  console.log(`[hot-storage] Storage billing cycle for ${usages.length} paid plan(s)`);
  for (const usage of usages) {
    try {
      await billStoragePlanForUser(usage, now);
    } catch (err: any) {
      console.error(`[hot-storage] Storage billing error for user ${usage.user_id}:`, err?.message);
    }
  }
}
