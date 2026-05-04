import { createClient } from '@supabase/supabase-js';
import { Webhooks } from '@polar-sh/nextjs';
import { creditsFromAmountCents } from '@/lib/creditPricing';
import { polar } from '@/lib/polar';
import { POLAR_ADDON_ID, POLAR_SUBSCRIPTION_ID } from '@/lib/polarProducts';

export const runtime = 'nodejs';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const webhookSecret = process.env.POLAR_WEBHOOK_SECRET || '';

type PlanTier = 'free' | 'starter' | 'pro' | 'power';
type GrantSourceType = 'subscription_cycle' | 'addon_purchase';

const supabase = supabaseUrl && supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey)
  : null;

function planFromProductId(productId: string | null | undefined): PlanTier | null {
  if (!productId) return null;
  // Legacy fixed-tier product IDs (kept for back-compat).
  const starter = process.env.NEXT_PUBLIC_POLAR_PRODUCT_STARTER_ID || '';
  const pro = process.env.NEXT_PUBLIC_POLAR_PRODUCT_PRO_ID || '';
  const power = process.env.NEXT_PUBLIC_POLAR_PRODUCT_POWER_ID || '';
  const free = process.env.NEXT_PUBLIC_POLAR_PRODUCT_FREE_ID || '';

  // New PWYW products — let amount drive the tier (return null so caller falls back).
  if (productId === POLAR_SUBSCRIPTION_ID) return null;
  if (productId === POLAR_ADDON_ID) return null;

  if (starter && productId === starter) return 'starter';
  if (pro && productId === pro) return 'pro';
  if (power && productId === power) return 'power';
  if (free && productId === free) return 'free';
  return null;
}

function getAmountCents(payload: any): number | null {
  // Order matters: pre-discount / committed-tier amounts come before
  // post-discount totals, so a 100%-off coupon still grants the right credits.
  const candidates = [
    payload?.subtotal_amount,
    payload?.subtotalAmount,
    payload?.prices?.[0]?.preset_amount,
    payload?.prices?.[0]?.presetAmount,
    payload?.prices?.[0]?.amount,
    payload?.product?.prices?.[0]?.preset_amount,
    payload?.product?.prices?.[0]?.presetAmount,
    payload?.product?.prices?.[0]?.amount,
    payload?.subscription?.amount,
    payload?.subscription?.prices?.[0]?.preset_amount,
    payload?.subscription?.prices?.[0]?.presetAmount,
    payload?.subscription?.prices?.[0]?.amount,
    payload?.items?.[0]?.amount,
    payload?.items?.[0]?.price?.amount,
    payload?.price?.amount,
    payload?.price?.amount_cents,
    payload?.price?.amountCents,
    payload?.amount,
    payload?.checkout?.amount,
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function getStringCandidate(...candidates: any[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return null;
}

function getIsoDateCandidate(...candidates: any[]): string | null {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const date = new Date(candidate);
    if (Number.isFinite(date.getTime())) return date.toISOString();
  }
  return null;
}

function extractProductId(obj: any): string | null {
  return getStringCandidate(
    obj?.productId,
    obj?.product_id,
    obj?.product?.id,
    obj?.checkout?.productId,
    obj?.checkout?.product_id,
    obj?.items?.[0]?.productId,
    obj?.items?.[0]?.product_id,
  );
}

function extractCustomerId(obj: any): string | null {
  return getStringCandidate(
    obj?.customerId,
    obj?.customer_id,
    obj?.customer?.id,
    obj?.checkout?.customerId,
    obj?.checkout?.customer_id,
  );
}

function extractSubscriptionId(obj: any): string | null {
  return getStringCandidate(
    obj?.subscriptionId,
    obj?.subscription_id,
    obj?.id,
    obj?.subscription?.id,
  );
}

function extractPeriodBounds(obj: any): { start: string | null; end: string | null } {
  return {
    start: getIsoDateCandidate(
      obj?.currentPeriodStart,
      obj?.current_period_start,
      obj?.periodStart,
      obj?.period_start,
      obj?.billingPeriodStart,
      obj?.billing_period_start,
    ),
    end: getIsoDateCandidate(
      obj?.currentPeriodEnd,
      obj?.current_period_end,
      obj?.periodEnd,
      obj?.period_end,
      obj?.billingPeriodEnd,
      obj?.billing_period_end,
      obj?.endsAt,
      obj?.ends_at,
    ),
  };
}

async function updateProfile(userId: string, values: Record<string, any>) {
  if (!supabase) {
    console.error('Missing Supabase env for webhook');
    return;
  }
  // Upsert so first-time subscribers (no profile row yet) don't silently no-op.
  const { error } = await supabase
    .from('profiles')
    .upsert({ id: userId, ...values, updated_at: new Date().toISOString() }, { onConflict: 'id' });
  if (error) console.error('Polar webhook profile upsert error', { userId, error: error.message });
}

async function upsertCreditGrant(input: {
  userId: string;
  sourceType: GrantSourceType;
  sourceRef: string;
  plan?: string | null;
  amountUsd?: number | null;
  totalCredits: number;
  expiresAt?: string | null;
  metadata?: any;
}) {
  if (!supabase) {
    console.error('Missing Supabase env for webhook');
    return;
  }
  const totalCredits = Math.max(0, Number(input.totalCredits || 0));
  if (!totalCredits) return;
  const { data: existing } = await supabase
    .from('credit_grants')
    .select('id, total_credits, remaining_credits')
    .eq('user_id', input.userId)
    .eq('source_type', input.sourceType)
    .eq('source_ref', input.sourceRef)
    .maybeSingle();

  let grant: any = null;
  if (existing?.id) {
    const consumed = Math.max(0, (Number(existing.total_credits) || 0) - (Number(existing.remaining_credits) || 0));
    const remainingCredits = Math.max(0, totalCredits - consumed);
    const { data } = await supabase
      .from('credit_grants')
      .update({
        plan: input.plan || null,
        amount_usd: input.amountUsd ?? null,
        total_credits: totalCredits,
        remaining_credits: remainingCredits,
        expires_at: input.expiresAt ?? null,
        metadata: input.metadata || {},
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select('id')
      .single();
    grant = data;
  } else {
    const { data } = await supabase
      .from('credit_grants')
      .insert({
        user_id: input.userId,
        source_type: input.sourceType,
        source_ref: input.sourceRef,
        plan: input.plan || null,
        amount_usd: input.amountUsd ?? null,
        total_credits: totalCredits,
        remaining_credits: totalCredits,
        expires_at: input.expiresAt ?? null,
        metadata: input.metadata || {},
      })
      .select('id')
      .single();
    grant = data;
  }

  if (grant?.id) {
    await supabase
      .from('credit_transactions')
      .upsert({
        user_id: input.userId,
        grant_id: grant.id,
        entry_type: 'grant',
        source_type: input.sourceType,
        source_ref: input.sourceRef,
        credits: totalCredits,
        amount_usd: input.amountUsd ?? null,
        metadata: input.metadata || {},
      }, { onConflict: 'user_id,grant_id,entry_type,source_type,source_ref' });
  }
}

async function getCurrentBillingSubscriptionId(userId: string): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase
    .from('profiles')
    .select('billing_subscription_id')
    .eq('id', userId)
    .maybeSingle();
  return (data as any)?.billing_subscription_id || null;
}

async function revokeStaleSubscription(staleSubscriptionId: string) {
  try {
    await polar.subscriptions.revoke({ id: staleSubscriptionId });
  } catch (e: any) {
    // 404 / already-canceled is fine; anything else just gets logged so the
    // new subscription activation isn't blocked.
    console.warn('Polar revoke stale subscription failed', {
      staleSubscriptionId,
      statusCode: e?.statusCode,
      message: e?.message,
    });
  }
}

async function applySubscriptionGrant(userId: string, payload: any, status: string) {
  const amountCents = getAmountCents(payload);
  const productId = extractProductId(payload);
  const subscriptionId = extractSubscriptionId(payload);
  const period = extractPeriodBounds(payload);
  const amount = amountCents ? creditsFromAmountCents(amountCents) : null;
  const plan = planFromProductId(productId) || amount?.plan || 'starter';
  const sourceRef = `${subscriptionId || productId || 'subscription'}:${period.end || period.start || 'current'}`;

  // If the user is already tied to a different subscription (e.g. they just
  // switched their PWYW amount via /api/polar/subscription PATCH), revoke the
  // previous one so they aren't double-billed. Polar's API doesn't support
  // updating a PWYW amount in place, so the only way to switch is replace.
  const existingSubId = await getCurrentBillingSubscriptionId(userId);
  if (
    existingSubId &&
    subscriptionId &&
    existingSubId !== subscriptionId &&
    status !== 'canceled' &&
    status !== 'revoked'
  ) {
    await revokeStaleSubscription(existingSubId);
  }

  if (amount) {
    const carryover = await computeCarryover(
      userId,
      subscriptionId,
      sourceRef,
      amount.credits,
    );
    const totalCredits = amount.credits + carryover.bonusCredits;
    await upsertCreditGrant({
      userId,
      sourceType: 'subscription_cycle',
      sourceRef,
      plan,
      amountUsd: amount.amountDollars,
      totalCredits,
      expiresAt: period.end,
      metadata: {
        productId,
        subscriptionId,
        currentPeriodStart: period.start,
        currentPeriodEnd: period.end,
        baseCredits: amount.credits,
        carryoverCredits: carryover.bonusCredits,
        carryoverKind: carryover.kind,
      },
    });
  }

  const values: Record<string, any> = {
    plan,
    billing_customer_id: extractCustomerId(payload),
    billing_subscription_id: subscriptionId,
    billing_product_id: productId,
    billing_subscription_status: status,
    current_period_start: period.start,
    current_period_end: period.end,
  };
  if (amount) values.monthly_token_limit = amount.credits;
  await updateProfile(userId, values);
}

/**
 * On renewal (new sourceRef): roll over 50% of the prior cycle's remaining
 * credits and zero out the prior grant's remaining_credits to avoid double-count.
 * On upgrade (same sourceRef, larger total): preserve leftover credits on top of
 * the new plan's allotment so users don't lose what they paid for.
 */
async function computeCarryover(
  userId: string,
  subscriptionId: string | null,
  sourceRef: string,
  newBaseCredits: number,
): Promise<{ bonusCredits: number; kind: 'renewal' | 'upgrade' | 'none' }> {
  if (!supabase || !subscriptionId) return { bonusCredits: 0, kind: 'none' };

  const { data: sameRef } = await supabase
    .from('credit_grants')
    .select('id, total_credits, remaining_credits, metadata')
    .eq('user_id', userId)
    .eq('source_type', 'subscription_cycle')
    .eq('source_ref', sourceRef)
    .maybeSingle();

  if (sameRef?.id) {
    const existingTotal = Number((sameRef as any).total_credits) || 0;
    const existingRemaining = Number((sameRef as any).remaining_credits) || 0;
    const existingBase = Number(((sameRef as any).metadata as any)?.baseCredits) || existingTotal;
    if (newBaseCredits > existingBase + 0.0001) {
      const consumed = Math.max(0, existingTotal - existingRemaining);
      const leftover = Math.max(0, existingBase - consumed);
      return { bonusCredits: leftover, kind: 'upgrade' };
    }
    return { bonusCredits: 0, kind: 'none' };
  }

  const { data: priorGrants } = await supabase
    .from('credit_grants')
    .select('id, total_credits, remaining_credits, metadata, created_at')
    .eq('user_id', userId)
    .eq('source_type', 'subscription_cycle')
    .order('created_at', { ascending: false })
    .limit(10);

  const prior = (priorGrants || []).find((g: any) => {
    const md = g.metadata || {};
    return md.subscriptionId === subscriptionId;
  });

  if (!prior) return { bonusCredits: 0, kind: 'none' };

  const priorRemaining = Math.max(0, Number((prior as any).remaining_credits) || 0);
  if (priorRemaining <= 0) return { bonusCredits: 0, kind: 'renewal' };
  const rollover = Math.floor(priorRemaining * 0.5);
  if (rollover <= 0) return { bonusCredits: 0, kind: 'renewal' };

  await supabase
    .from('credit_grants')
    .update({
      remaining_credits: 0,
      metadata: {
        ...((prior as any).metadata as any || {}),
        rolledOverTo: sourceRef,
        rolledOverCredits: rollover,
        rolledOverAt: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    })
    .eq('id', (prior as any).id);

  await supabase.from('credit_transactions').insert({
    user_id: userId,
    grant_id: (prior as any).id,
    entry_type: 'adjustment',
    source_type: 'subscription_cycle',
    source_ref: `${sourceRef}:rollover`,
    credits: -priorRemaining + rollover,
    metadata: {
      reason: 'rollover_to_next_cycle',
      newSourceRef: sourceRef,
      priorRemaining,
      rolloverCredits: rollover,
    },
  });

  return { bonusCredits: rollover, kind: 'renewal' };
}

async function applyAddonGrant(userId: string, payload: any) {
  const amountCents = getAmountCents(payload);
  if (!amountCents) return;
  const amount = creditsFromAmountCents(amountCents);
  const productId = extractProductId(payload);
  const orderRef = getStringCandidate(
    payload?.orderId,
    payload?.order_id,
    payload?.id,
    payload?.checkout?.id,
    payload?.checkout_id,
  ) || `${productId || 'addon'}:${amountCents}`;
  await upsertCreditGrant({
    userId,
    sourceType: 'addon_purchase',
    sourceRef: orderRef,
    amountUsd: amount.amountDollars,
    totalCredits: amount.credits,
    metadata: {
      productId,
      orderId: orderRef,
    },
  });
}

function extractUserId(obj: any): string | null {
  const candidates: any[] = [
    obj?.metadata?.userId,
    obj?.metadata?.user_id,
    obj?.checkout?.metadata?.userId,
    obj?.checkout?.metadata?.user_id,
    obj?.customer_metadata?.userId,
    obj?.customer_metadata?.user_id,
    obj?.customer?.metadata?.userId,
    obj?.customer?.metadata?.user_id,
  ];

  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }

  return null;
}

export const POST = webhookSecret
  ? Webhooks({
  webhookSecret,
  onOrderPaid: async (order: any) => {
    try {
      const userId = extractUserId(order);
      if (!userId) return;
      // One-time add-on orders have no associated subscription; orders that
      // belong to a subscription cycle are handled by onSubscription* hooks.
      if (extractSubscriptionId(order)) return;
      await applyAddonGrant(userId, order);
    } catch (e) {
      console.error('Polar onOrderPaid error', e);
    }
  },
  onSubscriptionActive: async (subscription: any) => {
    try {
      const userId = extractUserId(subscription);
      if (!userId) return;
      await applySubscriptionGrant(userId, subscription, getStringCandidate(subscription?.status, subscription?.subscription?.status) || 'active');
    } catch (e) {
      console.error('Polar onSubscriptionActive error', e);
    }
  },
  onSubscriptionUpdated: async (subscription: any) => {
    try {
      const userId = extractUserId(subscription);
      if (!userId) return;
      await applySubscriptionGrant(userId, subscription, getStringCandidate(subscription?.status, subscription?.subscription?.status) || 'active');
    } catch (e) {
      console.error('Polar onSubscriptionUpdated error', e);
    }
  },
  onSubscriptionCanceled: async (subscription: any) => {
    try {
      const userId = extractUserId(subscription);
      if (!userId) return;
      // Only act if the event is for the user's currently-bound subscription.
      // This skips stale events (e.g. the old sub being canceled mid-switch
      // to a new PWYW amount) so we don't overwrite the active billing row.
      const eventSubId = extractSubscriptionId(subscription);
      const currentSubId = await getCurrentBillingSubscriptionId(userId);
      if (!currentSubId || !eventSubId || currentSubId !== eventSubId) {
        return;
      }
      const period = extractPeriodBounds(subscription);
      await updateProfile(userId, {
        billing_customer_id: extractCustomerId(subscription),
        billing_subscription_id: eventSubId,
        billing_product_id: extractProductId(subscription),
        billing_subscription_status: 'canceled',
        current_period_start: period.start,
        current_period_end: period.end,
      });
    } catch (e) {
      console.error('Polar onSubscriptionCanceled error', e);
    }
  },
  onSubscriptionRevoked: async (subscription: any) => {
    try {
      const userId = extractUserId(subscription);
      if (!userId) return;
      // Same guard as onSubscriptionCanceled — only the user's currently-
      // bound subscription is allowed to downgrade them to free. The
      // /api/polar/subscription PATCH endpoint clears the subscription
      // marker before revoking, so a switch revoke is correctly ignored.
      const eventSubId = extractSubscriptionId(subscription);
      const currentSubId = await getCurrentBillingSubscriptionId(userId);
      if (!currentSubId || !eventSubId || currentSubId !== eventSubId) {
        return;
      }
      await updateProfile(userId, {
        plan: 'free',
        monthly_token_limit: 0,
        billing_customer_id: extractCustomerId(subscription),
        billing_subscription_id: eventSubId,
        billing_product_id: extractProductId(subscription),
        billing_subscription_status: 'revoked',
      });
    } catch (e) {
      console.error('Polar onSubscriptionRevoked error', e);
    }
  },
})
  : async () => {
  return new Response('Missing POLAR_WEBHOOK_SECRET', { status: 500 });
};
