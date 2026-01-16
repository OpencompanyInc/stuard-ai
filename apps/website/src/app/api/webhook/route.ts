import { NextRequest, NextResponse } from 'next/server';
import { getStripeServer, assertStripeConfigured } from '@/lib/stripe';
import { createClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
export const runtime = 'nodejs';
export const config = {
  api: {
    bodyParser: false,
  },
};

function getRawBody(req: Request): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const reader = (req as Request & { body?: { getReader?: () => ReadableStreamDefaultReader<Uint8Array> } }).body?.getReader?.();
    if (!reader) return resolve(Buffer.from(''));
    const chunks: Uint8Array[] = [];
    const pump = (): Promise<void> => reader.read().then(({ done, value }) => {
      if (done) {
        resolve(Buffer.concat(chunks));
        return;
      }
      chunks.push(value);
      return pump();
    }).catch(reject);
    pump();
  });
}

export async function POST(req: NextRequest) {
  try {
    assertStripeConfigured();
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      return NextResponse.json({ error: 'Missing STRIPE_WEBHOOK_SECRET' }, { status: 500 });
    }

    const buf = await getRawBody(req);
    const sig = req.headers.get('stripe-signature') as string;

    const stripe = getStripeServer();
    let event;
    try {
      event = stripe.webhooks.constructEvent(buf, sig, webhookSecret);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Webhook signature verification failed';
      console.error('Webhook signature verification failed.', errorMessage);
      return new NextResponse(`Webhook Error: ${errorMessage}`, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId || null;
        const priceId = session.mode === 'subscription' ? session.line_items?.data?.[0]?.price?.id : null;
        // Fallback: use subscription to look up price if needed
        try {
          let planTier: 'free' | 'pro' | 'ultra' = 'free';
          const subscriptionId = session.subscription as string | undefined;
          if (subscriptionId) {
            const subscription = await stripe.subscriptions.retrieve(subscriptionId);
            const item = subscription.items.data[0];
            const price = item?.price?.id || '';
            planTier = mapPriceToTier(price);
          } else if (priceId) {
            planTier = mapPriceToTier(priceId);
          }

          if (userId) {
            await supabase.from('profiles').update({ plan: planTier }).eq('user_id', userId);
          }
        } catch (e) {
          console.error('Error updating plan tier after checkout', e);
        }
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.created':
      case 'customer.subscription.deleted': {
        // No-op: we currently rely on checkout.session.completed with metadata.userId to set plan.
        // Schema does not store stripe_customer_id; add it later if needed.
        break;
      }
      default:
        break;
    }

    return NextResponse.json({ received: true });
  } catch (err: unknown) {
    console.error('Webhook error', err);
    const errorMessage = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

function mapPriceToTier(priceId: string): 'free' | 'pro' | 'ultra' {
  const proPrice = process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO || '';
  const ultraPrice = process.env.NEXT_PUBLIC_STRIPE_PRICE_ULTRA || '';
  if (priceId === ultraPrice) return 'ultra';
  if (priceId === proPrice) return 'pro';
  return 'free';
}


