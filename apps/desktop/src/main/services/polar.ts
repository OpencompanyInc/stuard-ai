import { Polar } from "@polar-sh/sdk";
import { shell } from "electron";

// Polar SDK client - uses environment variable for access token
const getPolarClient = (): Polar | null => {
  const accessToken = process.env.POLAR_ACCESS_TOKEN || '';
  if (!accessToken) {
    return null;
  }
  return new Polar({ accessToken });
};

export interface PolarCheckoutOptions {
  productId: string;
  customerEmail?: string;
  userId?: string;
  successUrl?: string;
}

export interface PolarCustomerInfo {
  id: string;
  email: string;
  subscriptions: Array<{
    id: string;
    status: string;
    productId: string;
    productName: string;
    currentPeriodEnd?: string;
  }>;
  orders: Array<{
    id: string;
    amount: number;
    currency: string;
    createdAt: string;
  }>;
}

/**
 * Create a checkout session and open in browser
 */
export async function createCheckout(options: PolarCheckoutOptions): Promise<{ ok: boolean; url?: string; error?: string }> {
  try {
    const polar = getPolarClient();
    if (!polar) return { ok: false, error: 'Billing not configured' };

    const result = await polar.checkouts.create({
      products: [options.productId],
      successUrl: options.successUrl || process.env.POLAR_SUCCESS_URL || 'https://stuard.ai/billing/success?checkout_id={CHECKOUT_ID}',
      customerEmail: options.customerEmail,
      metadata: options.userId ? { userId: options.userId } : undefined,
    });

    if (result.url) {
      // Open checkout URL in the default browser
      await shell.openExternal(result.url);
      return { ok: true, url: result.url };
    }

    return { ok: false, error: 'No checkout URL returned' };
  } catch (e: any) {
    console.error('[polar] createCheckout error:', e);
    return { ok: false, error: String(e?.message || 'Failed to create checkout') };
  }
}

/**
 * Get customer information by email
 */
export async function getCustomer(email: string): Promise<{ ok: boolean; customer?: PolarCustomerInfo; error?: string }> {
  try {
    const polar = getPolarClient();
    if (!polar) return { ok: false, error: 'Billing not configured' };

    // List customers by email
    const customers = await polar.customers.list({
      email,
    });

    if (!customers.result.items.length) {
      return { ok: true, customer: undefined };
    }

    const customer = customers.result.items[0];

    // Get subscriptions
    const subscriptions = await polar.subscriptions.list({
      customerId: customer.id,
    });

    // Get orders
    const orders = await polar.orders.list({
      customerId: customer.id,
    });

    return {
      ok: true,
      customer: {
        id: customer.id,
        email: customer.email,
        subscriptions: subscriptions.result.items.map((sub: any) => ({
          id: sub.id,
          status: sub.status,
          productId: sub.productId,
          productName: sub.product?.name || 'Unknown',
          currentPeriodEnd: sub.currentPeriodEnd,
        })),
        orders: orders.result.items.map((order: any) => ({
          id: order.id,
          amount: order.amount,
          currency: order.currency,
          createdAt: order.createdAt,
        })),
      },
    };
  } catch (e: any) {
    console.error('[polar] getCustomer error:', e);
    return { ok: false, error: String(e?.message || 'Failed to get customer') };
  }
}

/**
 * List available products/prices for purchase
 */
export async function listProducts(): Promise<{ ok: boolean; products?: any[]; error?: string }> {
  try {
    const polar = getPolarClient();
    if (!polar) return { ok: false, error: 'Billing not configured' };

    const products = await polar.products.list({
      isArchived: false,
    });

    return {
      ok: true,
      products: products.result.items.map((p: any) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        prices: p.prices?.map((price: any) => ({
          id: price.id,
          amount: price.priceAmount,
          currency: price.priceCurrency,
          type: price.type,
          recurringInterval: price.recurringInterval,
        })) || [],
        isRecurring: p.isRecurring,
        benefits: p.benefits?.map((b: any) => b.description) || [],
      })),
    };
  } catch (e: any) {
    console.error('[polar] listProducts error:', e);
    return { ok: false, error: String(e?.message || 'Failed to list products') };
  }
}

/**
 * Create a customer portal session for billing management
 */
export async function openCustomerPortal(customerId: string): Promise<{ ok: boolean; url?: string; error?: string }> {
  try {
    const polar = getPolarClient();
    if (!polar) return { ok: false, error: 'Billing not configured' };

    const session = await polar.customerSessions.create({
      customerId,
    });

    if (session.customerPortalUrl) {
      await shell.openExternal(session.customerPortalUrl);
      return { ok: true, url: session.customerPortalUrl };
    }

    return { ok: false, error: 'No portal URL returned' };
  } catch (e: any) {
    console.error('[polar] openCustomerPortal error:', e);
    return { ok: false, error: String(e?.message || 'Failed to open customer portal') };
  }
}

/**
 * Quick checkout for purchasing extra credits
 */
export async function purchaseCredits(options: {
  productId: string;
  email: string;
  userId?: string;
}): Promise<{ ok: boolean; url?: string; error?: string }> {
  return createCheckout({
    productId: options.productId,
    customerEmail: options.email,
    userId: options.userId,
    successUrl: 'https://stuard.ai/billing/success?checkout_id={CHECKOUT_ID}&type=credits',
  });
}
