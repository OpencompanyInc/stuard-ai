import { createClient } from '@supabase/supabase-js';
import { Webhooks } from '@polar-sh/nextjs';

export const runtime = 'nodejs';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const webhookSecret = process.env.POLAR_WEBHOOK_SECRET || '';

type PlanTier = 'free' | 'starter' | 'pro' | 'power';

function planFromProductId(productId: string | null | undefined): PlanTier | null {
  if (!productId) return null;
  const starter = process.env.NEXT_PUBLIC_POLAR_PRODUCT_STARTER_ID || '';
  const pro = process.env.NEXT_PUBLIC_POLAR_PRODUCT_PRO_ID || '';
  const power = process.env.NEXT_PUBLIC_POLAR_PRODUCT_POWER_ID || '';
  const free = process.env.NEXT_PUBLIC_POLAR_PRODUCT_FREE_ID || '';

  if (productId && starter && productId === starter) return 'starter';
  if (productId && pro && productId === pro) return 'pro';
  if (productId && power && productId === power) return 'power';
  if (productId && free && productId === free) return 'free';
  return null;
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

async function setPlan(userId: string, plan: PlanTier) {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error('Missing Supabase env for webhook');
    return;
  }
  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
  await supabase.from('profiles').update({ plan }).eq('user_id', userId);
}

export const POST = webhookSecret
  ? Webhooks({
  webhookSecret,
  onOrderPaid: async (order: any) => {
    try {
      const userId = extractUserId(order);
      const plan = planFromProductId(order?.productId ?? order?.product_id);
      if (!userId || !plan) return;
      await setPlan(userId, plan);
    } catch (e) {
      console.error('Polar onOrderPaid error', e);
    }
  },
  onSubscriptionActive: async (subscription: any) => {
    try {
      const userId = extractUserId(subscription);
      const plan = planFromProductId(subscription?.productId ?? subscription?.product_id);
      if (!userId || !plan) return;
      await setPlan(userId, plan);
    } catch (e) {
      console.error('Polar onSubscriptionActive error', e);
    }
  },
  onSubscriptionUpdated: async (subscription: any) => {
    try {
      const userId = extractUserId(subscription);
      const plan = planFromProductId(subscription?.productId ?? subscription?.product_id);
      if (!userId || !plan) return;
      await setPlan(userId, plan);
    } catch (e) {
      console.error('Polar onSubscriptionUpdated error', e);
    }
  },
  onSubscriptionCanceled: async (subscription: any) => {
    try {
      const userId = extractUserId(subscription);
      if (!userId) return;
      await setPlan(userId, 'free');
    } catch (e) {
      console.error('Polar onSubscriptionCanceled error', e);
    }
  },
  onSubscriptionRevoked: async (subscription: any) => {
    try {
      const userId = extractUserId(subscription);
      if (!userId) return;
      await setPlan(userId, 'free');
    } catch (e) {
      console.error('Polar onSubscriptionRevoked error', e);
    }
  },
})
  : async () => {
  return new Response('Missing POLAR_WEBHOOK_SECRET', { status: 500 });
};


