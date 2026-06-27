import React, { useEffect, useState } from "react";
import { CreditCard, ExternalLink, Loader2, Package, Crown, AlertCircle, Zap } from "lucide-react";
import { supabase } from "../lib/supabaseClient";

interface Subscription {
  id: string;
  status: string;
  productId: string;
  productName: string;
  currentPeriodEnd?: string;
}

interface CustomerInfo {
  id: string;
  email: string;
  subscriptions: Subscription[];
  orders: Array<{
    id: string;
    amount: number;
    currency: string;
    createdAt: string;
  }>;
}

interface Product {
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

const SectionHeader = ({ title, description }: { title: string; description: string }) => (
  <div className="mb-6">
    <h3 className="text-xl font-stuard text-theme-fg tracking-tight">{title}</h3>
    <p className="text-sm text-theme-muted font-medium">{description}</p>
  </div>
);

const formatCurrency = (amount: number, currency: string) => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount / 100);
};

const formatDate = (dateStr?: string) => {
  if (!dateStr) return "N/A";
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

export const BillingSettings: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [customer, setCustomer] = useState<CustomerInfo | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadBillingData = async () => {
      try {
        setLoading(true);
        setError(null);

        // Get user session
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user?.email) {
          setLoading(false);
          return;
        }

        setUserEmail(session.user.email);
        setUserId(session.user.id);

        // Load customer info and products in parallel
        const [customerResult, productsResult] = await Promise.all([
          window.desktopAPI?.billingGetCustomer?.(session.user.email),
          window.desktopAPI?.billingListProducts?.(),
        ]);

        if (customerResult?.ok && customerResult.customer) {
          setCustomer(customerResult.customer);
        }

        if (productsResult?.ok && productsResult.products) {
          setProducts(productsResult.products);
        }
      } catch (e: any) {
        setError(e?.message || "Failed to load billing information");
      } finally {
        setLoading(false);
      }
    };

    loadBillingData();
  }, []);

  const handlePurchase = async (productId: string) => {
    if (!userEmail) return;
    setActionLoading(productId);
    try {
      const result = await window.desktopAPI?.billingCreateCheckout?.({
        productId,
        customerEmail: userEmail,
        userId: userId || undefined,
      });
      if (!result?.ok) {
        setError(result?.error || "Failed to create checkout");
      }
    } catch (e: any) {
      setError(e?.message || "Failed to create checkout");
    } finally {
      setActionLoading(null);
    }
  };

  const handleManageBilling = async () => {
    if (!customer?.id) return;
    setActionLoading("portal");
    try {
      const result = await window.desktopAPI?.billingOpenPortal?.(customer.id);
      if (!result?.ok) {
        setError(result?.error || "Failed to open billing portal");
      }
    } catch (e: any) {
      setError(e?.message || "Failed to open billing portal");
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="bg-theme-card rounded-theme-card border border-theme p-6 shadow-sm mb-8">
        <SectionHeader title="Billing" description="Manage your subscription and billing." />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  if (!userEmail) {
    return (
      <div className="bg-theme-card rounded-theme-card border border-theme p-6 shadow-sm mb-8">
        <SectionHeader title="Billing" description="Manage your subscription and billing." />
        <div className="flex items-center gap-3 p-4 bg-amber-500/10 rounded-theme-button border border-amber-500/20">
          <AlertCircle className="w-5 h-5 text-amber-500" />
          <div>
            <div className="font-bold text-theme-fg text-sm">Sign in required</div>
            <div className="text-xs text-theme-muted">Please sign in to manage your billing.</div>
          </div>
        </div>
      </div>
    );
  }

  const activeSubscription = customer?.subscriptions?.find(
    (s) => s.status === "active" || s.status === "trialing"
  );

  return (
    <div className="bg-theme-card rounded-theme-card border border-theme p-6 shadow-sm mb-8">
      <SectionHeader title="Billing" description="Manage your subscription and billing." />

      {error && (
        <div className="flex items-center gap-3 p-3 bg-red-500/10 rounded-theme-button border border-red-500/20 mb-6">
          <AlertCircle className="w-4 h-4 text-red-500" />
          <span className="text-sm text-red-500 font-medium">{error}</span>
        </div>
      )}

      {/* Current Plan */}
      <div className="mb-6">
        <label className="block text-[10px] font-black text-theme-muted uppercase tracking-widest mb-3 ml-1">
          Current Plan
        </label>
        <div className="p-4 bg-theme-hover rounded-theme-button border border-theme">
          {activeSubscription ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg border border-primary/20">
                  <Crown className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <div className="font-bold text-theme-fg">{activeSubscription.productName}</div>
                  <div className="text-xs text-theme-muted">
                    {activeSubscription.status === "trialing" && "Trial - "}
                    Renews {formatDate(activeSubscription.currentPeriodEnd)}
                  </div>
                </div>
              </div>
              <span className="px-2 py-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-bold rounded-full border border-emerald-500/20">
                Active
              </span>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-theme-active rounded-lg border border-theme">
                  <Package className="w-5 h-5 text-theme-muted" />
                </div>
                <div>
                  <div className="font-bold text-theme-fg">Free Plan</div>
                  <div className="text-xs text-theme-muted">Limited features</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Manage Billing Button */}
      {customer && (
        <div className="mb-6">
          <button
            onClick={handleManageBilling}
            disabled={actionLoading === "portal"}
            className="flex items-center gap-2 px-4 py-2 rounded-theme-button border border-theme text-theme-fg text-sm font-bold hover:bg-theme-hover transition-all"
          >
            {actionLoading === "portal" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <CreditCard className="w-4 h-4" />
            )}
            Manage Billing
            <ExternalLink className="w-3 h-3 text-theme-muted" />
          </button>
        </div>
      )}

      {/* Available Plans */}
      {products.length > 0 && (
        <div>
          <label className="block text-[10px] font-black text-theme-muted uppercase tracking-widest mb-3 ml-1">
            {activeSubscription ? "Change Plan" : "Upgrade"}
          </label>
          <div className="grid gap-4">
            {products
              .filter((p) => p.isRecurring)
              .map((product) => {
                const price = product.prices[0];
                const isCurrentPlan = activeSubscription?.productId === product.id;

                return (
                  <div
                    key={product.id}
                    className={`p-4 rounded-theme-card border-2 transition-all ${
                      isCurrentPlan
                        ? "border-primary/50 bg-primary/5"
                        : "border-theme hover:border-primary/30 bg-theme-bg"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Zap className={`w-4 h-4 ${isCurrentPlan ? "text-primary" : "text-theme-muted"}`} />
                          <span className="font-bold text-theme-fg">{product.name}</span>
                          {isCurrentPlan && (
                            <span className="px-2 py-0.5 bg-primary/10 text-primary text-[10px] font-bold rounded-full">
                              Current
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-theme-muted mb-2">{product.description}</p>
                        {product.benefits.length > 0 && (
                          <ul className="text-xs text-theme-muted space-y-1">
                            {product.benefits.slice(0, 3).map((benefit, i) => (
                              <li key={i} className="flex items-center gap-1">
                                <span className="text-emerald-500">•</span> {benefit}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-theme-fg">
                          {price ? formatCurrency(price.amount, price.currency) : "Contact us"}
                        </div>
                        {price?.recurringInterval && (
                          <div className="text-xs text-theme-muted">/{price.recurringInterval}</div>
                        )}
                        {!isCurrentPlan && (
                          <button
                            onClick={() => handlePurchase(product.id)}
                            disabled={!!actionLoading}
                            className="mt-2 px-3 py-1.5 rounded-theme-button bg-primary text-primary-fg text-xs font-bold hover:opacity-90 transition-all disabled:opacity-50"
                          >
                            {actionLoading === product.id ? (
                              <Loader2 className="w-3 h-3 animate-spin mx-auto" />
                            ) : (
                              "Subscribe"
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Credit Packs */}
      {products.filter((p) => !p.isRecurring).length > 0 && (
        <div className="mt-6">
          <label className="block text-[10px] font-black text-theme-muted uppercase tracking-widest mb-3 ml-1">
            Credit Packs
          </label>
          <div className="grid grid-cols-2 gap-3">
            {products
              .filter((p) => !p.isRecurring)
              .map((product) => {
                const price = product.prices[0];
                return (
                  <button
                    key={product.id}
                    onClick={() => handlePurchase(product.id)}
                    disabled={!!actionLoading}
                    className="p-3 rounded-theme-button border border-theme bg-theme-bg hover:bg-theme-hover transition-all text-left group"
                  >
                    <div className="font-bold text-theme-fg text-sm group-hover:text-primary transition-colors">
                      {product.name}
                    </div>
                    <div className="text-xs text-theme-muted">{product.description}</div>
                    <div className="mt-2 font-bold text-primary">
                      {price ? formatCurrency(price.amount, price.currency) : "Contact us"}
                    </div>
                  </button>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
};
