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

// Polar's `subscription.amount` reflects the *post-discount* charge, so a
// 100% off code makes it 0. For the dashboard we want the customer's chosen
// PWYW amount (the "plan price"), so fall through pre-discount fields first.
function pickAmountCents(sub: any): number | null {
  const candidates = [
    sub?.subtotalAmount,
    sub?.subtotal_amount,
    sub?.prices?.[0]?.preset_amount,
    sub?.prices?.[0]?.presetAmount,
    sub?.prices?.[0]?.amount,
    sub?.product?.prices?.[0]?.preset_amount,
    sub?.product?.prices?.[0]?.presetAmount,
    sub?.product?.prices?.[0]?.amount,
    sub?.amount,
    sub?.price?.amount,
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
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
        amount: pickAmountCents(sub),
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
// cancelAtPeriodEnd / revoke), and Polar checkout refuses to create a second
// active subscription for the same product ("You already have an active
// subscription"). So we:
//   1. revoke the current subscription immediately (frees up the product
//      slot in Polar so the new checkout is accepted),
//   2. return a checkout URL for the new amount.
// The previous cycle's `credit_grants` row is left untouched, so the user
// keeps the credits they already paid for until its original `expires_at`.
// The webhook's `onSubscriptionRevoked` guard prevents a redundant revoke
// event from downgrading the user once the new sub becomes active.
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

  // Clear the active subscription marker before revoking so the upcoming
  // `onSubscriptionRevoked` webhook event sees a non-matching profile and
  // skips its plan='free' downgrade — otherwise the user briefly lands on
  // the free plan while they're heading into the new checkout.
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  await supabaseAdmin
    .from('profiles')
    .update({
      billing_subscription_id: null,
      billing_subscription_status: 'switching',
      updated_at: new Date().toISOString(),
    })
    .eq('id', user.id);

  try {
    await polar.subscriptions.revoke({ id: subscriptionId });
  } catch (e: any) {
    // 404 / 410 is fine — the slot is free either way.
    const status = Number(e?.statusCode);
    if (status !== 404 && status !== 410) {
      return NextResponse.json(
        {
          error: 'failed_to_replace',
          message: e?.message || 'Could not cancel current subscription.',
          details: e?.body,
        },
        { status: 500 },
      );
    }
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
