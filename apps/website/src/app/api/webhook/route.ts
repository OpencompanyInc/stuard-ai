import { createClient } from '@supabase/supabase-js';
import { Webhooks } from '@polar-sh/nextjs';

export const runtime = 'nodejs';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const webhookSecret = process.env.POLAR_WEBHOOK_SECRET || '';

type PlanTier = 'free' | 'starter' | 'pro' | 'power';

const BASE_CREDITS_PER_USD = 33;

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

async function setPlan(userId: string, plan: PlanTier, monthlyCredits?: number | null) {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error('Missing Supabase env for webhook');
    return;
  }
  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
  const values: Record<string, any> = { plan };
  if (typeof monthlyCredits === 'number') {
    values.monthly_token_limit = monthlyCredits;
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

async function setCreditsFromAmount(userId: string, amountCents: number) {
  const amountDollars = amountCents / 100;
  const { plan, multiplier } = tierFromAmount(amountDollars);
  const credits = Math.max(0, Math.floor(amountDollars * BASE_CREDITS_PER_USD * multiplier));
  await setPlan(userId, plan, credits);
}

export const POST = webhookSecret
  ? Webhooks({
  webhookSecret,
  onOrderPaid: async (order: any) => {
    try {
      const userId = extractUserId(order);
      if (!userId) return;
      const amountCents = getAmountCents(order);
      if (amountCents) {
        await setCreditsFromAmount(userId, amountCents);
        return;
      }
      const plan = planFromProductId(order?.productId ?? order?.product_id);
      if (!plan) return;
      await setPlan(userId, plan, null);
    } catch (e) {
      console.error('Polar onOrderPaid error', e);
    }
  },
  onSubscriptionActive: async (subscription: any) => {
    try {
      const userId = extractUserId(subscription);
      if (!userId) return;
      const amountCents = getAmountCents(subscription);
      if (amountCents) {
        await setCreditsFromAmount(userId, amountCents);
        return;
      }
      const plan = planFromProductId(subscription?.productId ?? subscription?.product_id);
      if (!plan) return;
      await setPlan(userId, plan, null);
    } catch (e) {
      console.error('Polar onSubscriptionActive error', e);
    }
  },
  onSubscriptionUpdated: async (subscription: any) => {
    try {
      const userId = extractUserId(subscription);
      if (!userId) return;
      const amountCents = getAmountCents(subscription);
      if (amountCents) {
        await setCreditsFromAmount(userId, amountCents);
        return;
      }
      const plan = planFromProductId(subscription?.productId ?? subscription?.product_id);
      if (!plan) return;
      await setPlan(userId, plan, null);
    } catch (e) {
      console.error('Polar onSubscriptionUpdated error', e);
    }
  },
  onSubscriptionCanceled: async (subscription: any) => {
    try {
      const userId = extractUserId(subscription);
      if (!userId) return;
      await setPlan(userId, 'free', 0);
    } catch (e) {
      console.error('Polar onSubscriptionCanceled error', e);
    }
  },
  onSubscriptionRevoked: async (subscription: any) => {
    try {
      const userId = extractUserId(subscription);
      if (!userId) return;
      await setPlan(userId, 'free', 0);
    } catch (e) {
      console.error('Polar onSubscriptionRevoked error', e);
    }
  },
})
  : async () => {
  return new Response('Missing POLAR_WEBHOOK_SECRET', { status: 500 });
};


