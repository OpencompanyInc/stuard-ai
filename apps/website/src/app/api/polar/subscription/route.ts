import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { polar } from '@/lib/polar';

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

// PATCH /api/polar/subscription — update PWYW amount on an existing subscription
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

  try {
    const sub: any = await polar.subscriptions.update({
      id: subscriptionId,
      subscriptionUpdate: { amount } as any,
    });
    return NextResponse.json({
      ok: true,
      subscription: {
        id: sub.id,
        status: sub.status,
        amount: sub.amount ?? sub.price?.amount ?? amount,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        error: 'failed_to_update',
        message: e?.message,
        details: e?.body,
      },
      { status: 500 },
    );
  }
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
