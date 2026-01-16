import { NextRequest, NextResponse } from 'next/server';
import { getStripeServer, assertStripeConfigured, getBaseUrl } from '@/lib/stripe';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    assertStripeConfigured();
    const body = await req.json();
    const { priceId, customerEmail, userId } = body || {};

    if (!priceId) {
      return NextResponse.json({ error: 'Missing priceId' }, { status: 400 });
    }

    // Create checkout session
    const stripe = getStripeServer();
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        { price: priceId, quantity: 1 },
      ],
      allow_promotion_codes: true,
      customer_email: customerEmail,
      metadata: {
        userId: userId || '',
      },
      success_url: `${getBaseUrl()}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${getBaseUrl()}/billing/canceled`,
    });

    return NextResponse.json({ id: session.id, url: session.url });
  } catch (err: unknown) {
    console.error('Checkout session error', err);
    const errorMessage = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}


