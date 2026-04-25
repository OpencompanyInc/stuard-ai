// Polar product IDs for the credits/billing system.
//
// The new system uses two pay-what-you-want Polar products:
//   - SUBSCRIPTION_ID: recurring monthly PWYW credits
//   - ADDON_ID: one-time PWYW add-on credit top-up
//
// Env vars override the defaults so we can swap to sandbox IDs without code changes.

export const POLAR_SUBSCRIPTION_ID =
  process.env.NEXT_PUBLIC_POLAR_SUBSCRIPTION_ID ||
  process.env.NEXT_PUBLIC_POLAR_PRODUCT_PAYG_ID ||
  '22f2eb79-766c-402c-9e5b-2d48c7b099fb';

export const POLAR_ADDON_IDS: Record<number, string> = {
  5:  process.env.NEXT_PUBLIC_POLAR_ADDON_5_ID  || 'd4939807-bc62-4a29-8a87-affb910e134b',
  10: process.env.NEXT_PUBLIC_POLAR_ADDON_10_ID || '7d67c4f0-f376-47cc-99a3-354011aae041',
  25: process.env.NEXT_PUBLIC_POLAR_ADDON_25_ID || '463ff74b-4f26-44b7-8a80-af2d2cdc9a7a',
  50: process.env.NEXT_PUBLIC_POLAR_ADDON_50_ID || '5516a18c-b03b-4ada-8b6a-599f2cc5b7e9',
};

// Legacy single-ID export kept for back-compat
export const POLAR_ADDON_ID = POLAR_ADDON_IDS[10];

// Default PWYW anchor (cents) used when the user hasn't touched the slider
export const DEFAULT_SUBSCRIPTION_AMOUNT_CENTS = 3000; // $30
export const DEFAULT_ADDON_AMOUNT_CENTS = 1000; // $10

export function isSubscriptionProduct(productId: string | null | undefined): boolean {
  return !!productId && productId === POLAR_SUBSCRIPTION_ID;
}

export function isAddonProduct(productId: string | null | undefined): boolean {
  return !!productId && productId === POLAR_ADDON_ID;
}
