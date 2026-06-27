import { Polar } from '@polar-sh/sdk';
import { getSupabaseAdmin } from '../supabase';
import { writeLog } from '../utils/logger';

const ADDON_PACKS_CENTS: Array<{ cents: number; productId: string }> = [
  { cents: 500, productId: process.env.POLAR_ADDON_5_ID || process.env.NEXT_PUBLIC_POLAR_ADDON_5_ID || 'd4939807-bc62-4a29-8a87-affb910e134b' },
  { cents: 1000, productId: process.env.POLAR_ADDON_10_ID || process.env.NEXT_PUBLIC_POLAR_ADDON_10_ID || '7d67c4f0-f376-47cc-99a3-354011aae041' },
  { cents: 2500, productId: process.env.POLAR_ADDON_25_ID || process.env.NEXT_PUBLIC_POLAR_ADDON_25_ID || '463ff74b-4f26-44b7-8a80-af2d2cdc9a7a' },
  { cents: 5000, productId: process.env.POLAR_ADDON_50_ID || process.env.NEXT_PUBLIC_POLAR_ADDON_50_ID || '5516a18c-b03b-4ada-8b6a-599f2cc5b7e9' },
];

const ADDON_BASE_PRODUCT_ID = ADDON_PACKS_CENTS[0]?.productId || 'd4939807-bc62-4a29-8a87-affb910e134b';

const PENDING_TTL_MS = 6 * 60 * 60 * 1000;
const ATTEMPT_COOLDOWN_MS = 15 * 60 * 1000;

type AutoRefillProfile = {
  user_id?: string;
  id?: string;
  auto_refill_enabled?: boolean;
  auto_refill_threshold_credits?: number | string | null;
  auto_refill_amount_cents?: number | null;
  monthly_budget_cents?: number | null;
  hard_spend_limit_cents?: number | null;
  billing_customer_id?: string | null;
  auto_refill_pending_checkout_id?: string | null;
  auto_refill_pending_url?: string | null;
  auto_refill_pending_at?: string | null;
  auto_refill_last_attempt_at?: string | null;
  auto_refill_last_success_at?: string | null;
};

// Polar is always production — no sandbox path.
function getPolarClient(): Polar | null {
  const accessToken = (process.env.POLAR_ACCESS_TOKEN || '').trim();
  if (!accessToken) return null;
  return new Polar({ accessToken, server: 'production' });
}

async function fetchProfile(userId: string): Promise<AutoRefillProfile | null> {
  const sb = getSupabaseAdmin();
  if (!sb) return null;

  const columns = [
    'user_id',
    'auto_refill_enabled',
    'auto_refill_threshold_credits',
    'auto_refill_amount_cents',
    'monthly_budget_cents',
    'hard_spend_limit_cents',
    'billing_customer_id',
    'auto_refill_pending_checkout_id',
    'auto_refill_pending_url',
    'auto_refill_pending_at',
    'auto_refill_last_attempt_at',
    'auto_refill_last_success_at',
  ].join(',');

  const byUserId = await sb.from('profiles').select(columns).eq('user_id', userId).maybeSingle();
  if (byUserId.data) return byUserId.data as AutoRefillProfile;

  const byId = await sb.from('profiles').select(columns).eq('id', userId).maybeSingle();
  return (byId.data as AutoRefillProfile | null) ?? null;
}

async function updateProfile(userId: string, values: Record<string, unknown>): Promise<void> {
  const sb = getSupabaseAdmin();
  if (!sb) return;
  const payload = { ...values, updated_at: new Date().toISOString() };
  const byUserId = await sb.from('profiles').update(payload).eq('user_id', userId);
  if (!byUserId.error) return;
  await sb.from('profiles').update(payload).eq('id', userId);
}

export function resolveAddonCheckoutProduct(amountCents: number): {
  productId: string;
  chargeCents: number;
  useCustomPrice: boolean;
} {
  const normalized = Math.max(500, Math.trunc(amountCents));
  const exact = ADDON_PACKS_CENTS.find((pack) => pack.cents === normalized);
  if (exact) {
    return { productId: exact.productId, chargeCents: exact.cents, useCustomPrice: false };
  }

  const roundedUp = ADDON_PACKS_CENTS.find((pack) => pack.cents >= normalized);
  if (roundedUp) {
    return { productId: roundedUp.productId, chargeCents: roundedUp.cents, useCustomPrice: false };
  }

  return { productId: ADDON_BASE_PRODUCT_ID, chargeCents: normalized, useCustomPrice: true };
}

async function getRemainingCredits(userId: string): Promise<number> {
  const sb = getSupabaseAdmin();
  if (!sb) return 0;
  const now = Date.now();
  const { data } = await sb
    .from('credit_grants')
    .select('remaining_credits, expires_at')
    .eq('user_id', userId)
    .gt('remaining_credits', 0);

  let total = 0;
  for (const row of data || []) {
    const expiresAt = row?.expires_at ? Date.parse(String(row.expires_at)) : null;
    if (expiresAt && Number.isFinite(expiresAt) && expiresAt <= now) continue;
    total += Math.max(0, Number(row?.remaining_credits) || 0);
  }
  return total;
}

async function getAutoRefillSpendCentsThisMonth(userId: string): Promise<number> {
  const sb = getSupabaseAdmin();
  if (!sb) return 0;
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const { data } = await sb
    .from('credit_transactions')
    .select('amount_usd, metadata')
    .eq('user_id', userId)
    .eq('entry_type', 'grant')
    .eq('source_type', 'addon_purchase')
    .gte('created_at', monthStart);

  let totalCents = 0;
  for (const row of data || []) {
    const metadata = (row as any)?.metadata || {};
    if (metadata?.autoRefill !== true && metadata?.auto_refill !== true && metadata?.autoRefill !== 'true') continue;
    const usd = Number((row as any)?.amount_usd);
    if (Number.isFinite(usd) && usd > 0) {
      totalCents += Math.round(usd * 100);
      continue;
    }
  }
  return totalCents;
}

function hasFreshPending(profile: AutoRefillProfile, now = Date.now()): boolean {
  if (!profile.auto_refill_pending_checkout_id || !profile.auto_refill_pending_at) return false;
  const pendingAt = Date.parse(profile.auto_refill_pending_at);
  if (!Number.isFinite(pendingAt)) return false;
  return now - pendingAt < PENDING_TTL_MS;
}

function isWithinCooldown(profile: AutoRefillProfile, now = Date.now()): boolean {
  if (!profile.auto_refill_last_attempt_at) return false;
  const lastAttempt = Date.parse(profile.auto_refill_last_attempt_at);
  if (!Number.isFinite(lastAttempt)) return false;
  return now - lastAttempt < ATTEMPT_COOLDOWN_MS;
}

export async function clearAutoRefillPending(userId: string): Promise<void> {
  await updateProfile(userId, {
    auto_refill_pending_checkout_id: null,
    auto_refill_pending_url: null,
    auto_refill_pending_at: null,
  });
}

export async function markAutoRefillSuccess(_userId: string): Promise<void> {
  // DISABLED: auto-refill / billing settings greyed out in app UI.
  return;
  /*
  await updateProfile(userId, {
    auto_refill_pending_checkout_id: null,
    auto_refill_pending_url: null,
    auto_refill_pending_at: null,
    auto_refill_last_success_at: new Date().toISOString(),
  });
  */
}

export async function getAutoRefillPending(_userId: string): Promise<{
  pending: boolean;
  checkoutId?: string;
  url?: string;
  pendingAt?: string;
}> {
  // DISABLED: auto-refill / billing settings greyed out in app UI.
  return { pending: false };
  /*
  const profile = await fetchProfile(userId);
  if (!profile || !hasFreshPending(profile)) {
    return { pending: false };
  }
  return {
    pending: true,
    checkoutId: profile.auto_refill_pending_checkout_id || undefined,
    url: profile.auto_refill_pending_url || undefined,
    pendingAt: profile.auto_refill_pending_at || undefined,
  };
  */
}

export async function maybeTriggerAutoRefill(_userId: string): Promise<void> {
  // DISABLED: auto-refill / billing settings greyed out in app UI.
  return;
  /*
  if (!userId) return;

  try {
    const profile = await fetchProfile(userId);
    if (!profile?.auto_refill_enabled) return;

    const polar = getPolarClient();
    if (!polar) {
      writeLog('auto_refill_no_polar_client', { userId });
      return;
    }

    let customerId = profile.billing_customer_id || null;
    if (!customerId) {
      try {
        const customer = await polar.customers.getExternal({ externalId: userId });
        customerId = customer?.id || null;
        if (customerId) {
          await updateProfile(userId, { billing_customer_id: customerId });
        }
      } catch {
        customerId = null;
      }
    }
    if (!customerId) return;

    const threshold = Math.max(0, Number(profile.auto_refill_threshold_credits) || 0);
    const amountCents = Math.max(500, Math.trunc(Number(profile.auto_refill_amount_cents) || 1000));
    const remaining = await getRemainingCredits(userId);
    if (remaining > threshold) return;

    const now = Date.now();
    if (hasFreshPending(profile, now)) return;
    if (isWithinCooldown(profile, now)) return;

    const monthlyBudget = profile.monthly_budget_cents;
    if (monthlyBudget != null && Number.isFinite(Number(monthlyBudget))) {
      const spent = await getAutoRefillSpendCentsThisMonth(userId);
      if (spent + amountCents > Number(monthlyBudget)) {
        writeLog('auto_refill_budget_blocked', { userId, spent, amountCents, monthlyBudget });
        return;
      }
    }

    const hardLimit = profile.hard_spend_limit_cents;
    if (hardLimit != null && Number.isFinite(Number(hardLimit)) && amountCents > Number(hardLimit)) {
      writeLog('auto_refill_hard_limit_blocked', { userId, amountCents, hardLimit });
      return;
    }

    const { productId, chargeCents, useCustomPrice } = resolveAddonCheckoutProduct(amountCents);
    const successUrl = process.env.POLAR_SUCCESS_URL || 'https://stuard.ai/billing/success?checkout_id={CHECKOUT_ID}';

    const checkout = await polar.checkouts.create({
      products: [productId],
      customerId,
      externalCustomerId: userId,
      amount: useCustomPrice ? chargeCents : undefined,
      prices: useCustomPrice
        ? {
            [productId]: [{
              amountType: 'custom',
              presetAmount: chargeCents,
              minimumAmount: 500,
              maximumAmount: 50000,
            }],
          }
        : undefined,
      allowDiscountCodes: false,
      metadata: {
        userId,
        type: 'addon',
        autoRefill: 'true',
      },
      successUrl,
      returnUrl: process.env.POLAR_RETURN_URL || 'https://stuard.ai/dashboard/billing',
    });

    const checkoutId = checkout.id || null;
    const checkoutUrl = checkout.url || null;
    if (!checkoutId || !checkoutUrl) {
      writeLog('auto_refill_checkout_missing_url', { userId, checkoutId });
      return;
    }

    await updateProfile(userId, {
      auto_refill_pending_checkout_id: checkoutId,
      auto_refill_pending_url: checkoutUrl,
      auto_refill_pending_at: new Date().toISOString(),
      auto_refill_last_attempt_at: new Date().toISOString(),
    });

    writeLog('auto_refill_checkout_created', {
      userId,
      checkoutId,
      chargeCents,
      productId,
      remaining,
      threshold,
    });
  } catch (e: any) {
    writeLog('auto_refill_error', { userId, error: e?.message || String(e) });
  }
  */
}

export function scheduleAutoRefillCheck(_userId: string): void {
  // DISABLED: auto-refill / billing settings greyed out in app UI.
  return;
  // void maybeTriggerAutoRefill(userId);
}
