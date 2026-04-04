import React, { useCallback, useEffect, useState } from "react";
import {
  ExternalLink,
  Loader2,
  AlertCircle,
  Zap,
  RefreshCw,
  Plus,
  Coins,
  CreditCard,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";

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

interface CreditSummary {
  plan?: string;
  limit?: number;
  used?: number;
  remaining?: number;
  unlimited?: boolean;
  includedCredits?: number;
  includedRemaining?: number;
  addonCredits?: number;
  addonRemaining?: number;
  creditsPerUsd?: number;
}

interface UsageBreakdownItem {
  category: string;
  credits: number;
  costUsd: number;
  count: number;
}

const CLOUD_AI_HTTP =
  (window as any).__CLOUD_AI_HTTP__ ||
  (import.meta as any).env?.VITE_CLOUD_AI_URL ||
  "http://127.0.0.1:8082";

const CATEGORY_CONFIG: Record<string, { label: string; color: string }> = {
  inference: { label: "AI Inference", color: "bg-blue-500" },
  subagent: { label: "Delegated Agents", color: "bg-purple-500" },
  compute: { label: "Cloud Compute", color: "bg-amber-500" },
  storage: { label: "Storage", color: "bg-teal-500" },
  messaging: { label: "Messaging", color: "bg-rose-500" },
};

const SectionHeader = ({
  title,
  description,
}: {
  title: string;
  description: string;
}) => (
  <div className="mb-6">
    <h3 className="text-xl font-stuard text-theme-fg tracking-tight">
      {title}
    </h3>
    <p className="text-sm text-theme-muted font-medium">{description}</p>
  </div>
);

const formatCurrency = (amount: number, currency: string) => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount / 100);
};

async function cloudApiFetch<T = any>(path: string): Promise<T | null> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return null;
    const res = await fetch(`${CLOUD_AI_HTTP}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();
    return json?.ok ? json : null;
  } catch {
    return null;
  }
}

export const BillingSettings: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<Product[]>([]);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoRefill, setAutoRefill] = useState(false);
  const [creditSummary, setCreditSummary] = useState<CreditSummary | null>(
    null
  );
  const [usageBreakdown, setUsageBreakdown] = useState<UsageBreakdownItem[]>(
    []
  );

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Load persisted auto-refill preference
      const prefsResult = await window.desktopAPI?.getPrefs?.();
      if (
        prefsResult?.ok &&
        prefsResult.prefs?.autoRefillCredits !== undefined
      ) {
        setAutoRefill(!!prefsResult.prefs.autoRefillCredits);
      }

      // Get user session
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user?.email) {
        setLoading(false);
        return;
      }

      setUserEmail(session.user.email);
      setUserId(session.user.id);

      // Load all data in parallel
      const [productsResult, creditsData, usageData] = await Promise.all([
        window.desktopAPI?.billingListProducts?.(),
        cloudApiFetch<any>("/v1/credits"),
        cloudApiFetch<any>("/v1/credits/usage"),
      ]);

      if (productsResult?.ok && productsResult.products) {
        setProducts(productsResult.products);
      }
      if (creditsData) {
        setCreditSummary(creditsData);
      }
      if (usageData?.breakdown) {
        setUsageBreakdown(usageData.breakdown);
      }
    } catch (e: any) {
      setError(e?.message || "Failed to load billing information");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const creditPacks = products.filter((p) => !p.isRecurring);
  const usageTotal = usageBreakdown.reduce((s, b) => s + b.credits, 0);

  const currentPlan = (() => {
    const raw = String(creditSummary?.plan || "free")
      .trim()
      .toLowerCase();
    if (raw === "free_trial" || raw === "trial") return "Free";
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  })();

  const usagePercent =
    creditSummary &&
    !creditSummary.unlimited &&
    creditSummary.limit &&
    creditSummary.limit > 0
      ? Math.min(
          100,
          Math.round(
            ((creditSummary.used || 0) / creditSummary.limit) * 100
          )
        )
      : 0;

  const handleAutoRefillToggle = async (enabled: boolean) => {
    setAutoRefill(enabled);
    try {
      await window.desktopAPI?.setPrefs?.({ autoRefillCredits: enabled });
    } catch {
      setAutoRefill(!enabled);
    }
  };

  const handlePurchaseCredits = async (productId: string) => {
    if (!userEmail) return;
    setActionLoading(productId);
    try {
      const result = await window.desktopAPI?.billingPurchaseCredits?.({
        productId,
        email: userEmail,
        userId: userId || undefined,
      });
      if (!result?.ok) {
        setError(result?.error || "Failed to open purchase page");
      }
    } catch (e: any) {
      setError(e?.message || "Failed to open purchase page");
    } finally {
      setActionLoading(null);
    }
  };

  const handleOpenWebsiteBilling = async () => {
    setActionLoading("website");
    try {
      await (window as any).desktopAPI?.openExternal?.(
        "https://stuard.ai/dashboard/billing"
      );
    } catch {
      window.open(
        "https://stuard.ai/dashboard/billing",
        "_blank",
        "noopener,noreferrer"
      );
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="bg-theme-card rounded-theme-card border border-theme p-6 shadow-sm mb-8">
        <SectionHeader
          title="Billing & Credits"
          description="Manage your plan, credit balance, and add-ons."
        />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-theme-card rounded-theme-card border border-theme p-6 shadow-sm mb-8">
      <SectionHeader
        title="Billing & Credits"
        description="Manage your plan, credit balance, and add-ons."
      />

      {error && (
        <div className="flex items-center gap-3 p-3 bg-red-500/10 rounded-theme-button border border-red-500/20 mb-6">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
          <span className="text-sm text-red-500 font-medium">{error}</span>
        </div>
      )}

      {/* Plan & Balance Overview */}
      {creditSummary && (
        <div className="mb-6">
          <label className="block text-[10px] font-black text-theme-muted uppercase tracking-widest mb-3 ml-1">
            Current Balance
          </label>

          <div className="p-4 bg-theme-hover rounded-theme-button border border-theme">
            {/* Plan badge + remaining */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-primary" />
                <span className="text-[13px] font-bold text-theme-fg">
                  {currentPlan} Plan
                </span>
              </div>
              <div className="text-right">
                <span className="text-lg font-black text-theme-fg">
                  {creditSummary.unlimited
                    ? "Unlimited"
                    : Number(
                        creditSummary.remaining || 0
                      ).toLocaleString()}
                </span>
                {!creditSummary.unlimited && (
                  <span className="text-[11px] text-theme-muted ml-1">
                    credits remaining
                  </span>
                )}
              </div>
            </div>

            {/* Usage progress bar */}
            {!creditSummary.unlimited &&
              creditSummary.limit &&
              creditSummary.limit > 0 && (
                <div className="mb-3">
                  <div className="w-full bg-theme-bg rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all ${
                        usagePercent >= 90
                          ? "bg-red-500"
                          : usagePercent >= 70
                          ? "bg-amber-500"
                          : "bg-emerald-500"
                      }`}
                      style={{ width: `${usagePercent}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-theme-muted mt-1">
                    <span>
                      {Number(creditSummary.used || 0).toLocaleString()} used
                    </span>
                    <span>
                      {Number(creditSummary.limit).toLocaleString()} total
                    </span>
                  </div>
                </div>
              )}

            {/* Pool breakdown */}
            <div className="grid grid-cols-2 gap-2">
              <div className="p-2 bg-theme-bg rounded-theme-button">
                <p className="text-[10px] text-theme-muted font-bold uppercase">
                  Subscription
                </p>
                <p className="text-sm font-bold text-theme-fg">
                  {Number(
                    creditSummary.includedRemaining || 0
                  ).toLocaleString()}
                </p>
              </div>
              <div className="p-2 bg-theme-bg rounded-theme-button">
                <p className="text-[10px] text-theme-muted font-bold uppercase">
                  Add-ons
                </p>
                <p className="text-sm font-bold text-theme-fg">
                  {Number(
                    creditSummary.addonRemaining || 0
                  ).toLocaleString()}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Usage Breakdown */}
      {usageBreakdown.length > 0 && (
        <div className="mb-6">
          <label className="block text-[10px] font-black text-theme-muted uppercase tracking-widest mb-3 ml-1">
            Usage This Period
          </label>
          <div className="p-4 bg-theme-hover rounded-theme-button border border-theme">
            {/* Stacked bar */}
            <div className="flex w-full h-2 rounded-full overflow-hidden bg-theme-bg mb-3">
              {usageBreakdown.map((item) => {
                const pct =
                  usageTotal > 0 ? (item.credits / usageTotal) * 100 : 0;
                if (pct < 1) return null;
                const config = CATEGORY_CONFIG[item.category] || {
                  color: "bg-gray-400",
                };
                return (
                  <div
                    key={item.category}
                    className={`${config.color}`}
                    style={{ width: `${pct}%` }}
                  />
                );
              })}
            </div>

            {/* Legend */}
            <div className="space-y-1.5">
              {usageBreakdown.map((item) => {
                const config = CATEGORY_CONFIG[item.category] || {
                  label: item.category,
                  color: "bg-gray-400",
                };
                return (
                  <div
                    key={item.category}
                    className="flex items-center justify-between text-[11px]"
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-2 h-2 rounded-sm ${config.color}`}
                      />
                      <span className="text-theme-muted font-medium">
                        {config.label}
                      </span>
                    </div>
                    <span className="font-bold text-theme-fg">
                      {item.credits.toFixed(1)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Auto-Refill Credits */}
      <div className="mb-6">
        <label className="block text-[10px] font-black text-theme-muted uppercase tracking-widest mb-3 ml-1">
          Auto-Refill
        </label>
        <div className="p-4 bg-theme-hover rounded-theme-button border border-theme">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefill}
              onChange={(e) => handleAutoRefillToggle(e.target.checked)}
              className="w-4 h-4 mt-0.5 rounded border-theme bg-theme-card text-primary focus:ring-primary"
            />
            <div>
              <div className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-primary" />
                <span className="text-[13px] font-bold text-theme-fg">
                  Auto-refill credits
                </span>
              </div>
              <p className="text-[11px] text-theme-muted mt-1 font-medium">
                Automatically purchase a credit pack when your balance runs
                low, so you never run out mid-conversation.
              </p>
            </div>
          </label>
        </div>
      </div>

      {/* Purchase Add-On Credits */}
      <div className="mb-6">
        <label className="block text-[10px] font-black text-theme-muted uppercase tracking-widest mb-3 ml-1">
          Purchase Add-On Credits
        </label>
        {creditPacks.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {creditPacks.map((product) => {
              const price = product.prices[0];
              return (
                <button
                  key={product.id}
                  onClick={() => handlePurchaseCredits(product.id)}
                  disabled={!!actionLoading || !userEmail}
                  className="p-4 rounded-theme-button border border-theme bg-theme-bg hover:bg-theme-hover transition-all text-left group"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Coins className="w-4 h-4 text-primary group-hover:scale-110 transition-transform" />
                    <span className="font-bold text-theme-fg text-sm group-hover:text-primary transition-colors">
                      {product.name}
                    </span>
                  </div>
                  <p className="text-xs text-theme-muted mb-2">
                    {product.description}
                  </p>
                  {product.benefits.length > 0 && (
                    <ul className="text-xs text-theme-muted space-y-0.5 mb-2">
                      {product.benefits.slice(0, 3).map((benefit, i) => (
                        <li key={i} className="flex items-center gap-1">
                          <span className="text-emerald-500">+</span>{" "}
                          {benefit}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-primary">
                      {price
                        ? formatCurrency(price.amount, price.currency)
                        : "\u2014"}
                    </span>
                    {actionLoading === product.id ? (
                      <Loader2 className="w-4 h-4 animate-spin text-primary" />
                    ) : (
                      <Plus className="w-4 h-4 text-theme-muted group-hover:text-primary transition-colors" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="p-4 bg-theme-hover rounded-theme-button border border-theme text-center">
            <Zap className="w-5 h-5 text-theme-muted mx-auto mb-2" />
            <p className="text-xs text-theme-muted font-medium">
              No credit packs available right now.
            </p>
          </div>
        )}
      </div>

      {/* Manage Billing on Website */}
      <div className="pt-4 border-t border-theme">
        <button
          onClick={handleOpenWebsiteBilling}
          disabled={actionLoading === "website"}
          className="flex items-center gap-2 px-4 py-2 rounded-theme-button border border-theme text-theme-fg text-sm font-bold hover:bg-theme-hover transition-all"
        >
          {actionLoading === "website" ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <ExternalLink className="w-4 h-4" />
          )}
          Manage billing & usage history on stuard.ai
        </button>
        <p className="text-[11px] text-theme-muted mt-2 ml-1 font-medium">
          Change your plan, view transaction history, and manage payment
          methods on the website.
        </p>
      </div>
    </div>
  );
};
