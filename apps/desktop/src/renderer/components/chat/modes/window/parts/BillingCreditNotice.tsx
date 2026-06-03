import React, { useMemo, useState } from "react";
import { creditUsageBarPercent } from "../../../../BillingSettings.utils";
import {
  AlertTriangle,
  CreditCard,
  ExternalLink,
  Loader2,
  Sparkles,
  X,
  Zap,
} from "lucide-react";

interface CreditSummary {
  plan?: string;
  limit?: number;
  used?: number;
  remaining?: number;
  unlimited?: boolean;
  currentPeriodEnd?: string;
  addonRemaining?: number;
}

interface BillingCustomer {
  id: string;
  email: string;
}

interface BillingProduct {
  id: string;
  name: string;
  description: string;
  isRecurring: boolean;
  prices: Array<{
    id: string;
    amount: number;
    currency: string;
    type: string;
    recurringInterval?: string;
  }>;
}

interface BillingCreditNoticeProps {
  mode: "low" | "exceeded";
  summary: CreditSummary | null;
  customer: BillingCustomer | null;
  products: BillingProduct[];
  loading?: boolean;
  error?: string | null;
  onDismiss: () => void;
  onOpenPricing: () => Promise<void>;
  onManageBilling: () => Promise<void>;
  onBuyCredits: () => Promise<void>;
}

function formatCredits(value?: number): string {
  const safe = Number(value || 0);
  if (!Number.isFinite(safe)) return "0";
  return Math.max(0, Math.round(safe)).toLocaleString("en-US");
}

function formatResetDate(value?: string): string {
  if (!value) return "at the next billing reset";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "at the next billing reset";
  return `on ${date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })}`;
}

function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: String(currency || "USD").toUpperCase(),
    maximumFractionDigits: 0,
  }).format(amount / 100);
}

export const BillingCreditNotice: React.FC<BillingCreditNoticeProps> = ({
  mode,
  summary,
  customer,
  products,
  loading = false,
  error,
  onDismiss,
  onOpenPricing,
  onManageBilling,
  onBuyCredits,
}) => {
  const [actionLoading, setActionLoading] = useState<
    "pricing" | "portal" | "credits" | null
  >(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const addonProduct = useMemo(() => {
    return [...products]
      .filter((product) => !product.isRecurring)
      .sort((a, b) => {
        const aPrice = Number(a.prices?.[0]?.amount || 0);
        const bPrice = Number(b.prices?.[0]?.amount || 0);
        return aPrice - bPrice;
      })[0];
  }, [products]);

  const planLabel = String(summary?.plan || "free")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
  const limit = Math.max(0, Number(summary?.limit || 0));
  const used = Math.max(0, Number(summary?.used || 0));
  const remaining = Math.max(0, Number(summary?.remaining || 0));
  const hasLimitData = !!summary?.unlimited || limit > 0;
  const usagePct = creditUsageBarPercent({ limit, remaining, used });
  const hasBilling = !!customer?.id;
  const title =
    mode === "exceeded"
      ? "Monthly credit limit reached"
      : "Monthly credits are running low";
  const body =
    mode === "exceeded"
      ? hasLimitData
        ? `You have used ${formatCredits(used)} of ${formatCredits(limit)} credits for this billing period.`
        : "You have used all credits for this billing period."
      : hasLimitData
        ? `You have ${formatCredits(remaining)} credits left out of ${formatCredits(limit)} this billing period.`
        : "You are getting close to your monthly credit limit.";
  const helperText = hasBilling
    ? addonProduct
      ? `Buy a credit pack now or open billing. Resets ${formatResetDate(summary?.currentPeriodEnd)}.`
      : `Open billing to manage your plan. Resets ${formatResetDate(summary?.currentPeriodEnd)}.`
    : `Connect billing to keep going. Resets ${formatResetDate(summary?.currentPeriodEnd)}.`;
  const packPrice = addonProduct?.prices?.[0]
    ? formatCurrency(
        addonProduct.prices[0].amount,
        addonProduct.prices[0].currency,
      )
    : null;

  const runAction = async (
    key: "pricing" | "portal" | "credits",
    action: () => Promise<void>,
  ) => {
    setActionError(null);
    setActionLoading(key);
    try {
      await action();
      onDismiss();
    } catch (err: any) {
      setActionError(String(err?.message || "Unable to open billing flow."));
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="absolute left-4 right-4 bottom-4 z-50 animate-in slide-in-from-bottom-2 duration-300">
      <div className="overflow-hidden rounded-2xl border border-rose-400/20 bg-[linear-gradient(145deg,rgba(13,16,22,0.96),rgba(7,9,14,0.94))] shadow-[0_18px_60px_rgba(0,0,0,0.45)] backdrop-blur-xl">
        <div className="border-b border-white/8 bg-[radial-gradient(circle_at_top_left,rgba(251,146,60,0.2),transparent_40%),radial-gradient(circle_at_top_right,rgba(244,63,94,0.18),transparent_35%)] p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div
                className={`mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl border ${
                  mode === "exceeded"
                    ? "border-rose-400/25 bg-rose-500/12 text-rose-300"
                    : "border-amber-400/25 bg-amber-500/12 text-amber-200"
                }`}
              >
                {mode === "exceeded" ? (
                  <AlertTriangle className="h-5 w-5" />
                ) : (
                  <Sparkles className="h-5 w-5" />
                )}
              </div>
              <div>
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-white/60">
                    {planLabel}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-medium text-white/55">
                    Monthly credits
                  </span>
                </div>
                <h3 className="text-sm font-semibold text-white">{title}</h3>
                <p className="mt-1 text-xs leading-5 text-white/72">{body}</p>
              </div>
            </div>

            <button
              onClick={onDismiss}
              className="rounded-full border border-white/10 bg-white/5 p-1.5 text-white/55 transition hover:bg-white/10 hover:text-white"
              aria-label="Dismiss credit notice"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="space-y-4 p-4">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-[0.18em] text-white/45">
                Used
              </div>
              <div className="mt-1 text-sm font-semibold text-white">
                {hasLimitData ? formatCredits(used) : "--"}
              </div>
            </div>
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-[0.18em] text-white/45">
                Limit
              </div>
              <div className="mt-1 text-sm font-semibold text-white">
                {summary?.unlimited
                  ? "Unlimited"
                  : hasLimitData
                    ? formatCredits(limit)
                    : "--"}
              </div>
            </div>
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-[0.18em] text-white/45">
                Left
              </div>
              <div className="mt-1 text-sm font-semibold text-white">
                {summary?.unlimited
                  ? "Unlimited"
                  : hasLimitData
                    ? formatCredits(remaining)
                    : "--"}
              </div>
            </div>
          </div>

          {!summary?.unlimited && limit > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between text-[11px] text-white/52">
                <span>Usage this billing period</span>
                <span>{Math.min(100, Math.round(usagePct))}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/8">
                <div
                  className={`h-full rounded-full transition-all ${
                    mode === "exceeded" ? "bg-rose-400" : "bg-amber-300"
                  }`}
                  style={{ width: `${Math.min(100, usagePct)}%` }}
                />
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-3">
            <div className="flex items-start gap-2">
              <Zap className="mt-0.5 h-4 w-4 text-amber-300" />
              <div className="min-w-0">
                <p className="text-xs leading-5 text-white/70">{helperText}</p>
                {hasBilling && addonProduct && (
                  <p className="mt-1 text-[11px] text-white/50">
                    Suggested pack:{" "}
                    <span className="font-semibold text-white/78">
                      {addonProduct.name}
                    </span>
                    {packPrice ? ` for ${packPrice}` : ""}
                  </p>
                )}
              </div>
            </div>
          </div>

          {(error || actionError) && (
            <div className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              {actionError || error}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {hasBilling && addonProduct ? (
              <button
                onClick={() => runAction("credits", onBuyCredits)}
                disabled={loading || !!actionLoading}
                className="inline-flex items-center gap-2 rounded-xl bg-white px-3.5 py-2 text-xs font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {actionLoading === "credits" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Zap className="h-4 w-4" />
                )}
                Buy more credits
              </button>
            ) : (
              <button
                onClick={() => runAction("pricing", onOpenPricing)}
                disabled={loading || !!actionLoading}
                className="inline-flex items-center gap-2 rounded-xl bg-white px-3.5 py-2 text-xs font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {actionLoading === "pricing" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ExternalLink className="h-4 w-4" />
                )}
                Connect billing
              </button>
            )}

            {hasBilling ? (
              <button
                onClick={() => runAction("portal", onManageBilling)}
                disabled={loading || !!actionLoading}
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-white/[0.09] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {actionLoading === "portal" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CreditCard className="h-4 w-4" />
                )}
                Manage billing
              </button>
            ) : (
              <button
                onClick={() => runAction("pricing", onOpenPricing)}
                disabled={loading || !!actionLoading}
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-white/[0.09] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {actionLoading === "pricing" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ExternalLink className="h-4 w-4" />
                )}
                View pricing
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
