import { createClient } from '@supabase/supabase-js';
import { Webhooks } from '@polar-sh/nextjs';

export const runtime = 'nodejs';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const webhookSecret = process.env.POLAR_WEBHOOK_SECRET || '';

type PlanTier = 'free' | 'starter' | 'pro' | 'power';
type GrantSourceType = 'subscription_cycle' | 'addon_purchase';

const BASE_CREDITS_PER_USD = 33;
const supabase = supabaseUrl && supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey)
  : null;

function planFromProductId(productId: string | null | undefined): PlanTier | null {
  if (!productId) return null;
  const payg = process.env.NEXT_PUBLIC_POLAR_PRODUCT_PAYG_ID || '';
  const starter = process.env.NEXT_PUBLIC_POLAR_PRODUCT_STARTER_ID || '';
  const pro = process.env.NEXT_PUBLIC_POLAR_PRODUCT_PRO_ID || '';
  const power = process.env.NEXT_PUBLIC_POLAR_PRODUCT_POWER_ID || '';
  const free = process.env.NEXT_PUBLIC_POLAR_PRODUCT_FREE_ID || '';

  if (productId && payg && productId === payg) return null;
  if (productId && starter && productId === starter) return 'starter';
  if (productId && pro && productId === pro) return 'pro';
  if (productId && power && productId === power) return 'power';
  if (productId && free && productId === free) return 'free';
  return null;
}

function getAmountCents(payload: any): number | null {
  const candidates = [
    payload?.amount,
    payload?.price?.amount,
    payload?.price?.amount_cents,
    payload?.price?.amountCents,
    payload?.items?.[0]?.price?.amount,
    payload?.items?.[0]?.amount,
    payload?.checkout?.amount,
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function tierFromAmount(amountDollars: number): { plan: PlanTier; multiplier: number } {
  if (amountDollars >= 100) return { plan: 'power', multiplier: 2.0 };
  if (amountDollars >= 30) return { plan: 'pro', multiplier: 1.5 };
  return { plan: 'starter', multiplier: 1.0 };
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

function creditsFromAmount(amountCents: number): { amountDollars: number; plan: PlanTier; credits: number; multiplier: number } {
  const amountDollars = amountCents / 100;
  const { plan, multiplier } = tierFromAmount(amountDollars);
  return {
    amountDollars,
    plan,
    multiplier,
    credits: Math.max(0, Math.floor(amountDollars * BASE_CREDITS_PER_USD * multiplier)),
  };
}

async function updateProfile(userId: string, values: Record<string, any>) {
  if (!supabase) {
    console.error('Missing Supabase env for webhook');
    return;
  }
  const { error: byUserIdError } = await supabase
    .from('profiles')
    .update(values)
    .eq('user_id', userId);
  if (byUserIdError) {
    await supabase
      .from('profiles')
      .update(values)
      .eq('id', userId);
  }
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

async function applySubscriptionGrant(userId: string, payload: any, status: string) {
  const amountCents = getAmountCents(payload);
  const productId = extractProductId(payload);
  const subscriptionId = extractSubscriptionId(payload);
  const period = extractPeriodBounds(payload);
  const amount = amountCents ? creditsFromAmount(amountCents) : null;
  const plan = planFromProductId(productId) || amount?.plan || 'starter';
  const sourceRef = `${subscriptionId || productId || 'subscription'}:${period.end || period.start || 'current'}`;

  if (amount) {
    await upsertCreditGrant({
      userId,
      sourceType: 'subscription_cycle',
      sourceRef,
      plan,
      amountUsd: amount.amountDollars,
      totalCredits: amount.credits,
      expiresAt: period.end,
      metadata: {
        productId,
        subscriptionId,
        currentPeriodStart: period.start,
        currentPeriodEnd: period.end,
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

async function applyAddonGrant(userId: string, payload: any) {
  const amountCents = getAmountCents(payload);
  if (!amountCents) return;
  const amount = creditsFromAmount(amountCents);
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
      const period = extractPeriodBounds(subscription);
      await updateProfile(userId, {
        billing_customer_id: extractCustomerId(subscription),
        billing_subscription_id: extractSubscriptionId(subscription),
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
      await updateProfile(userId, {
        plan: 'free',
        monthly_token_limit: 0,
        billing_customer_id: extractCustomerId(subscription),
        billing_subscription_id: extractSubscriptionId(subscription),
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
