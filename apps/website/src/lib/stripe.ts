import Stripe from 'stripe';

export function assertStripeConfigured() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('Stripe is not configured');
  }
}

export function getStripeServer(): Stripe {
  assertStripeConfigured();
  return new Stripe(process.env.STRIPE_SECRET_KEY as string, {
    apiVersion: '2025-08-27.basil',
  });
}

export function getBaseUrl(): string {
  const envUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    process.env.NEXT_PUBLIC_VERCEL_URL ||
    process.env.VERCEL_URL;

  if (envUrl) {
    const u = envUrl.startsWith('http') ? envUrl : `https://${envUrl}`;
    return u.replace(/\/$/, '');
  }

  return 'http://localhost:3000';
}
