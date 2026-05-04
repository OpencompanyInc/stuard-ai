import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { polar } from '@/lib/polar';
import { POLAR_SUBSCRIPTION_ID } from '@/lib/polarProducts';

export const runtime = 'nodejs';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function getAuthedUser(req: NextRequest) {
  const authHeader = req.headers.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) return null;
  const client = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

async function getUserSubscriptionId(userId: string): Promise<string | null> {
  const client = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data } = await client
    .from('profiles')
    .select('billing_subscription_id')
    .eq('id', userId)
    .maybeSingle();
  return data?.billing_subscription_id || null;
}

// GET /api/polar/subscription — current subscription for the user (includes amount)
export async function GET(req: NextRequest) {
  const user = await getAuthedUser(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const subscriptionId = await getUserSubscriptionId(user.id);
  if (!subscriptionId) {
    return NextResponse.json({ subscription: null });
  }

  try {
    const sub: any = await polar.subscriptions.get({ id: subscriptionId });
    return NextResponse.json({
      subscription: {
        id: sub.id,
        status: sub.status,
        amount: sub.amount ?? sub.price?.amount ?? null,
        currency: sub.currency || sub.price?.priceCurrency || 'usd',
        currentPeriodEnd: sub.currentPeriodEnd || sub.current_period_end || null,
        productId: sub.productId || sub.product_id || null,
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd ?? sub.cancel_at_period_end ?? false,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: 'failed_to_load_subscription', message: e?.message || 'unknown' },
      { status: 500 },
    );
  }
}

// PATCH /api/polar/subscription — switch the PWYW amount on an existing
// subscription. Polar's API does not allow updating the amount on an active
// pay-what-you-want subscription (the SubscriptionUpdate union only accepts
// productId / discountId / trialEnd / seats / currentBillingPeriodEnd /
// cancelAtPeriodEnd / revoke). So we schedule the current subscription to
// cancel at period end and return a checkout URL for the new amount. The
// webhook revokes the now-stale subscription once the new one becomes active
// (see /api/webhook).
export async function PATCH(req: NextRequest) {
  const user = await getAuthedUser(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const amount = Number(body?.amount);
  if (!Number.isFinite(amount) || amount < 500) {
    return NextResponse.json({ error: 'invalid_amount', message: 'Minimum $5 (500 cents).' }, { status: 400 });
  }

  const subscriptionId = await getUserSubscriptionId(user.id);
  if (!subscriptionId) {
    return NextResponse.json({ error: 'no_subscription' }, { status: 404 });
  }

  // Set the current subscription to cancel at the end of the period as a
  // fallback safety net: if the user completes the new checkout, the webhook
  // revokes it immediately; if they abandon checkout, it just expires
  // gracefully. Best-effort — failures here shouldn't block the redirect.
  try {
    await polar.subscriptions.update({
      id: subscriptionId,
      subscriptionUpdate: { cancelAtPeriodEnd: true } as any,
    });
  } catch (e: any) {
    console.warn('Polar subscription cancel-at-period-end before switch failed', {
      subscriptionId,
      message: e?.message,
    });
  }

  const productId = POLAR_SUBSCRIPTION_ID;
  if (!productId) {
    return NextResponse.json({ error: 'missing_product_id' }, { status: 500 });
  }

  const origin = req.headers.get('origin')
    || process.env.NEXT_PUBLIC_SITE_URL
    || new URL(req.url).origin;

  const qs = new URLSearchParams({
    products: productId,
    customerEmail: user.email || '',
    customerExternalId: user.id,
    metadata: JSON.stringify({ userId: user.id, replacesSubscriptionId: subscriptionId }),
    amount: String(Math.round(amount)),
  });

  return NextResponse.json({
    ok: true,
    url: `${origin}/api/polar/checkout?${qs.toString()}`,
  });
}

// DELETE /api/polar/subscription — cancel at period end (user keeps access
// through the end of the paid period, then the subscription expires).
// To cancel immediately (admin/refund flow), pass ?immediate=1.
export async function DELETE(req: NextRequest) {
  const user = await getAuthedUser(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const subscriptionId = await getUserSubscriptionId(user.id);
  if (!subscriptionId) {
    return NextResponse.json({ error: 'no_subscription' }, { status: 404 });
  }

  const url = new URL(req.url);
  const immediate = url.searchParams.get('immediate') === '1';

  try {
    if (immediate) {
      await polar.subscriptions.revoke({ id: subscriptionId });
    } else {
      await polar.subscriptions.update({
        id: subscriptionId,
        subscriptionUpdate: { cancelAtPeriodEnd: true } as any,
      });
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: 'failed_to_cancel', message: e?.message, details: e?.body },
      { status: 500 },
    );
  }
}

// POST /api/polar/subscription/resume — undo a pending cancellation
export async function POST(req: NextRequest) {
  const user = await getAuthedUser(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const url = new URL(req.url);
  if (url.searchParams.get('action') !== 'resume') {
    return NextResponse.json({ error: 'unknown_action' }, { status: 400 });
  }

  const subscriptionId = await getUserSubscriptionId(user.id);
  if (!subscriptionId) {
    return NextResponse.json({ error: 'no_subscription' }, { status: 404 });
  }

  try {
    await polar.subscriptions.update({
      id: subscriptionId,
      subscriptionUpdate: { cancelAtPeriodEnd: false } as any,
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: 'failed_to_resume', message: e?.message, details: e?.body },
      { status: 500 },
    );
  }
}
