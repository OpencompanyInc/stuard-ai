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

import { STORAGE_PRICING, creditsFromUsd } from '../pricing';
import {
  getStorageUsage,
  upsertStorageUsage,
  insertBillingEvent,
  insertStoragePurchase,
  getCloudEngine,
  upsertCloudEngine,
} from '../supabase';
import { getUserStorageBytes } from './cold-storage';
import { getComputeProvider } from './compute';

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
    coldStorageGb: 1,
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
  hotUsedGb: number;       // actual usage on VM
  coldStorageBytes: number; // bytes in GCS
  coldQuotaGb: number;     // max cold storage
  lastSyncAt: string | null;
}

/**
 * Get a user's current storage info (plan, quotas, usage).
 */
export async function getUserStorageInfo(userId: string): Promise<UserStorageInfo> {
  const usage = await getStorageUsage(userId);
  const planId = (usage as any)?.storage_plan_id || 'free';
  const plan = STORAGE_PLANS[planId] || STORAGE_PLANS.free;

  const coldBytes = await getUserStorageBytes(userId).catch(() => Number(usage?.cold_storage_bytes || 0));

  return {
    planId,
    plan,
    hotDiskGb: plan.hotDiskGb,
    hotUsedGb: Number(usage?.hot_storage_gb || 0),
    coldStorageBytes: coldBytes,
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

  // Record the billing event (prorated for remaining month)
  const creditsToCharge = plan.monthlyCredits;
  const action = STORAGE_PLANS[currentPlanId] && plan.hotDiskGb > (STORAGE_PLANS[currentPlanId]?.hotDiskGb || 0)
    ? 'upgrade' as const
    : currentPlanId === 'free' ? 'purchase' as const : 'downgrade' as const;

  if (creditsToCharge > 0) {
    await insertBillingEvent(userId, 'storage_purchase', creditsToCharge, {
      plan_id: newPlanId,
      previous_plan_id: currentPlanId,
      hot_disk_gb: plan.hotDiskGb,
      cold_quota_gb: plan.coldStorageGb,
      monthly_usd: plan.monthlyUsd,
      action,
    });
  }

  // Record purchase audit log
  await insertStoragePurchase(userId, newPlanId, currentPlanId, creditsToCharge, action);

  // Update storage_usage with new plan info
  await upsertStorageUsage(userId, {
    hot_storage_gb: plan.hotDiskGb,
    storage_plan_id: newPlanId,
    storage_quota_gb: plan.hotDiskGb,
    cold_quota_gb: plan.coldStorageGb,
    plan_purchased_at: new Date().toISOString(),
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
// Hourly Billing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bill a user for their storage usage for the current hour.
 * Called by the billing cron alongside compute billing.
 */
export async function billStorageHourly(userId: string): Promise<void> {
  const info = await getUserStorageInfo(userId);
  const now = new Date();
  const hoursPerMonth = 730;

  // Hot storage billing (based on plan disk allocation)
  const hotMonthlyUsd = info.hotDiskGb * STORAGE_PRICING.hotPerGbMonthUsd;
  const hotHourlyUsd = hotMonthlyUsd / hoursPerMonth;
  const hotCredits = creditsFromUsd(hotHourlyUsd);

  if (hotCredits > 0) {
    await insertBillingEvent(userId, 'hot_storage', hotCredits, {
      hot_disk_gb: info.hotDiskGb,
      hourly_usd: hotHourlyUsd,
      plan_id: info.planId,
    }, now);
  }

  // Cold storage billing (based on actual GCS bytes)
  const coldGb = info.coldStorageBytes / (1024 * 1024 * 1024);
  const coldMonthlyUsd = coldGb * STORAGE_PRICING.coldPerGbMonthUsd;
  const coldHourlyUsd = coldMonthlyUsd / hoursPerMonth;
  const coldCredits = creditsFromUsd(coldHourlyUsd);

  if (coldCredits > 0) {
    await insertBillingEvent(userId, 'cold_storage', coldCredits, {
      cold_storage_gb: coldGb,
      hourly_usd: coldHourlyUsd,
    }, now);
  }
}
