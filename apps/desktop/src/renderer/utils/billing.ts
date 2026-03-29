export interface BillingSubscription {
  id: string;
  status: string;
  productId: string;
  productName: string;
  currentPeriodEnd?: string;
}

export interface BillingCustomerInfo {
  id: string;
  email: string;
  subscriptions: BillingSubscription[];
  orders: Array<{
    id: string;
    amount: number;
    currency: string;
    createdAt: string;
  }>;
}

export interface BillingProduct {
  id: string;
  name: string;
  description: string;
  prices: Array<{
    id: string;
    amount: number;
    currency: string;
    type: string;
    recurringInterval?: string;
  }>;
  isRecurring: boolean;
  benefits: string[];
}

export interface BillingProfileSummary {
  plan?: string;
  currentPeriodEnd?: string;
  billingCustomerId?: string | null;
  billingSubscriptionId?: string | null;
  billingProductId?: string | null;
  billingSubscriptionStatus?: string | null;
}

export const DEFAULT_BILLING_PRODUCTS: BillingProduct[] = [
  {
    id: "prod_free",
    name: "Free",
    description: "Get started with trial credits or bring your own keys.",
    isRecurring: false,
    benefits: [
      "$0.50 trial credit included",
      "Unlimited usage with BYOK",
      "Voice & text interaction",
      "Local data storage",
    ],
    prices: [{ id: "price_free", amount: 0, currency: "usd", type: "one_time" }],
  },
  {
    id: "prod_starter",
    name: "Starter",
    description: "For everyday AI assistance.",
    isRecurring: true,
    benefits: ["≈650 credits per month", "All AI models included", "Priority support"],
    prices: [{ id: "price_starter_mo", amount: 1000, currency: "usd", type: "recurring", recurringInterval: "month" }],
  },
  {
    id: "prod_pro",
    name: "Pro",
    description: "For power users requiring higher limits.",
    isRecurring: true,
    benefits: ["≈2,925 credits per month", "All AI models included", "Advanced doc processing"],
    prices: [{ id: "price_pro_mo", amount: 4500, currency: "usd", type: "recurring", recurringInterval: "month" }],
  },
  {
    id: "prod_power",
    name: "Power",
    description: "Maximum capabilities and fastest processing.",
    isRecurring: true,
    benefits: ["≈6,500 credits per month", "All AI models included", "Best support response"],
    prices: [{ id: "price_power_mo", amount: 10000, currency: "usd", type: "recurring", recurringInterval: "month" }],
  },
];

export function deriveBillingCustomer(
  email: string | null | undefined,
  summary: BillingProfileSummary | null | undefined,
): BillingCustomerInfo | null {
  const billingCustomerId = String(summary?.billingCustomerId || "").trim();
  const safeEmail = String(email || "").trim();
  if (!billingCustomerId || !safeEmail) return null;

  const subscriptionStatus = String(summary?.billingSubscriptionStatus || "").trim();
  const plan = String(summary?.plan || "").trim();
  const billingProductId = String(summary?.billingProductId || "").trim();
  const billingSubscriptionId = String(summary?.billingSubscriptionId || "").trim();

  const subscriptions: BillingSubscription[] =
    subscriptionStatus && plan && plan.toLowerCase() !== "free"
      ? [
          {
            id: billingSubscriptionId || `sub-${billingCustomerId}`,
            status: subscriptionStatus,
            productId: billingProductId || plan.toLowerCase(),
            productName: plan.replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()),
            currentPeriodEnd: summary?.currentPeriodEnd,
          },
        ]
      : [];

  return {
    id: billingCustomerId,
    email: safeEmail,
    subscriptions,
    orders: [],
  };
}

export async function openExternalUrl(url: string): Promise<void> {
  try {
    await (window as any).desktopAPI?.openExternal?.(url);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
