import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ExternalLink,
  Loader2,
  AlertCircle,
  Zap,
  RefreshCw,
  Plus,
  Coins,
  CreditCard,
  ChevronLeft,
  ChevronRight,
  Globe,
  Bot,
  MessageSquare,
  HardDrive,
  Cpu,
  Shield,
  TrendingUp,
  Phone,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import {
  buildCreditsApiPath,
  getUsageSourceCategory,
  getUsageSourceLabel,
  normalizeUsageLogEntry,
  type UsageLogEntry,
} from "./BillingSettings.utils";

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
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
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

const CATEGORY_CONFIG: Record<
  string,
  { label: string; color: string; hex: string; icon: React.ElementType }
> = {
  inference: {
    label: "AI Inference",
    color: "bg-blue-500",
    hex: "#3b82f6",
    icon: Bot,
  },
  "inference:anthropic": {
    label: "Anthropic",
    color: "bg-orange-400",
    hex: "#da7756",
    icon: Bot,
  },
  "inference:openai": {
    label: "OpenAI",
    color: "bg-green-500",
    hex: "#10a37f",
    icon: Bot,
  },
  "inference:google": {
    label: "Google",
    color: "bg-blue-400",
    hex: "#4285f4",
    icon: Bot,
  },
  "inference:deepseek": {
    label: "DeepSeek",
    color: "bg-indigo-500",
    hex: "#6366f1",
    icon: Bot,
  },
  "inference:meta-llama": {
    label: "Meta Llama",
    color: "bg-blue-600",
    hex: "#1877f2",
    icon: Bot,
  },
  "inference:mistralai": {
    label: "Mistral",
    color: "bg-amber-400",
    hex: "#f59e0b",
    icon: Bot,
  },
  subagent: {
    label: "Delegated Agents",
    color: "bg-purple-500",
    hex: "#8b5cf6",
    icon: Globe,
  },
  compute: {
    label: "Cloud Compute",
    color: "bg-amber-500",
    hex: "#f59e0b",
    icon: Cpu,
  },
  storage: {
    label: "Storage",
    color: "bg-teal-500",
    hex: "#14b8a6",
    icon: HardDrive,
  },
  messaging: {
    label: "Messaging",
    color: "bg-rose-500",
    hex: "#f43f5e",
    icon: MessageSquare,
  },
  voice: {
    label: "Voice Calls",
    color: "bg-orange-500",
    hex: "#f97316",
    icon: Phone,
  },
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

const formatModel = (model: string): string => {
  if (!model || model === "unknown") return "Unknown";
  // Voice calls and messaging don't have a model
  if (model.startsWith("voice:")) return "-";
  if (model.startsWith("messaging:") || model === "telnyx" || model === "sms") return "-";
  // Shorten common model names
  return model
    .replace("anthropic/", "")
    .replace("openai/", "")
    .replace("google/", "")
    .replace("deepseek/", "");
};

const formatRelativeTime = (dateStr: string): string => {
  if (!dateStr) return "Unknown";
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "Unknown";
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

async function cloudApiFetch<T = any>(
  path: string,
  signal?: AbortSignal
): Promise<T | null> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;

  // Create a timeout that auto-aborts after 15s
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 15_000);
  // Forward parent abort to our controller so a single signal covers both
  if (signal) signal.addEventListener("abort", () => timeout.abort(), { once: true });

  try {
    const res = await fetch(`${CLOUD_AI_HTTP}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: timeout.signal,
    });
    const json = await res.json();
    return json?.ok ? json : null;
  } catch (e: any) {
    if (signal?.aborted) return null; // intentional abort, don't throw
    if (e?.name === "AbortError")
      throw new Error("Request timed out. Please check your connection and try again.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- Pie chart custom tooltip ---------- */
const PieTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.[0]) return null;
  const { name, value, payload: entry } = payload[0];
  return (
    <div className="bg-theme-card border border-theme rounded-lg px-3 py-2 shadow-lg">
      <p className="text-[11px] font-bold text-theme-fg">{name}</p>
      <p className="text-[10px] text-theme-muted">
        {Number(value).toFixed(2)} credits ({Number(entry.percent).toFixed(1)}%)
      </p>
    </div>
  );
};

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
  const [usageLogs, setUsageLogs] = useState<UsageLogEntry[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsPage, setLogsPage] = useState(0);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageLoaded, setUsageLoaded] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsLoaded, setLogsLoaded] = useState(false);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsLoaded, setProductsLoaded] = useState(false);

  const LOGS_PER_PAGE = 20;
  const mountedRef = useRef(true);
  const activeLogsRequestRef = useRef(0);
  const backgroundLoadAbortRef = useRef<AbortController | null>(null);
  const liveRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const convTitleCacheRef = useRef<Record<string, string>>({});

  useEffect(() => {
    mountedRef.current = true; // Reset on remount (React Strict Mode)
    return () => {
      mountedRef.current = false;
      backgroundLoadAbortRef.current?.abort();
      if (liveRefreshTimerRef.current) clearTimeout(liveRefreshTimerRef.current);
    };
  }, []);

  const billingPeriodStart = typeof creditSummary?.currentPeriodStart === "string"
    ? creditSummary.currentPeriodStart
    : null;

  const loadUsageBreakdown = useCallback(async (signal?: AbortSignal) => {
    setUsageLoading(true);
    try {
      const usageData = await cloudApiFetch<any>(
        buildCreditsApiPath("/v1/credits/usage", {
          since: billingPeriodStart,
        }),
        signal
      );
      if (!mountedRef.current || signal?.aborted) return;
      setUsageBreakdown(usageData?.breakdown || []);
    } finally {
      if (!mountedRef.current || signal?.aborted) return;
      setUsageLoading(false);
      setUsageLoaded(true);
    }
  }, [billingPeriodStart]);

  const loadLogs = useCallback(
    async (page: number, signal?: AbortSignal) => {
      const requestId = activeLogsRequestRef.current + 1;
      activeLogsRequestRef.current = requestId;
      setLogsLoading(true);
      try {
        const result = await cloudApiFetch<any>(
          buildCreditsApiPath("/v1/credits/logs", {
            limit: LOGS_PER_PAGE,
            offset: page * LOGS_PER_PAGE,
            since: billingPeriodStart,
          }),
          signal
        );
        if (
          mountedRef.current &&
          !signal?.aborted &&
          requestId === activeLogsRequestRef.current &&
          result
        ) {
          let normalizedLogs = Array.isArray(result.logs)
            ? result.logs.map(normalizeUsageLogEntry)
            : [];

          // Resolve conversation titles from local memory API
          const missingIds = normalizedLogs
            .map((l) => l.conversationId)
            .filter((id): id is string => !!id && !convTitleCacheRef.current[id]);
          if (missingIds.length > 0) {
            try {
              const convResult = await cloudApiFetch<any>(
                "/v1/memory/conversations?limit=200",
                signal
              );
              if (convResult?.conversations) {
                for (const c of convResult.conversations) {
                  const cid = c.id || c.conversation_id;
                  if (cid && c.title) convTitleCacheRef.current[cid] = c.title;
                }
              }
            } catch {}
          }
          normalizedLogs = normalizedLogs.map((log) =>
            log.conversationId && convTitleCacheRef.current[log.conversationId] && !log.chatName
              ? { ...log, chatName: convTitleCacheRef.current[log.conversationId] }
              : log
          );

          setUsageLogs(normalizedLogs);
          setLogsTotal(result.total || 0);
          setLogsPage(page);
        }
      } finally {
        if (!mountedRef.current || signal?.aborted) return;
        setLogsLoading(false);
        setLogsLoaded(true);
      }
    },
    [billingPeriodStart]
  );

  const loadProducts = useCallback(async () => {
    setProductsLoading(true);
    try {
      const productsResult = await window.desktopAPI?.billingListProducts?.();
      if (!mountedRef.current) return;
      if (productsResult?.ok && productsResult.products) {
        setProducts(productsResult.products);
      }
    } finally {
      if (!mountedRef.current) return;
      setProductsLoading(false);
      setProductsLoaded(true);
    }
  }, []);

  const loadData = useCallback(async () => {
    backgroundLoadAbortRef.current?.abort();
    const backgroundAbort = new AbortController();
    backgroundLoadAbortRef.current = backgroundAbort;

    // Hard failsafe: guarantee loading ends within 20s no matter what
    const failsafe = setTimeout(() => {
      if (mountedRef.current) {
        setLoading(false);
        setError("Loading timed out. Please try again.");
      }
    }, 20_000);

    try {
      setLoading(true);
      setError(null);
      setCreditSummary(null);
      setUsageBreakdown([]);
      setUsageLogs([]);
      setLogsTotal(0);
      setLogsPage(0);
      setProducts([]);
      setUsageLoaded(false);
      setLogsLoaded(false);
      setProductsLoaded(false);
      setUsageLoading(false);
      setLogsLoading(false);
      setProductsLoading(false);

      // Load persisted auto-refill preference (non-blocking)
      window.desktopAPI?.getPrefs?.().then((prefsResult: any) => {
        if (prefsResult?.ok && prefsResult.prefs?.autoRefillCredits !== undefined) {
          setAutoRefill(!!prefsResult.prefs.autoRefillCredits);
        }
      }).catch(() => {});

      // Get user session with a 5s timeout so it can't hang forever
      let session: any = null;
      try {
        const sessionResult = await Promise.race([
          supabase.auth.getSession(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Session check timed out")), 5_000)
          ),
        ]);
        session = sessionResult?.data?.session;
      } catch {
        // Session timed out or failed — show sign-in message
      }

      if (!session?.user?.email) {
        setError("Sign in to view billing information.");
        return;
      }

      setUserEmail(session.user.email);
      setUserId(session.user.id);

      // Only load credit summary — the fastest query. Everything else loads lazily.
      const creditsData = await cloudApiFetch<any>(
        "/v1/credits",
        backgroundAbort.signal
      );
      if (!mountedRef.current || backgroundAbort.signal.aborted) return;
      if (creditsData) {
        setCreditSummary(creditsData);
      } else {
        setError("Could not load billing data. The server may be temporarily unavailable.");
      }
    } catch (e: any) {
      if (!mountedRef.current || backgroundAbort.signal.aborted) return;
      setError(e?.message || "Failed to load billing information");
    } finally {
      clearTimeout(failsafe);
      setLoading(false);
    }
  }, []);

  // Lazy-load usage breakdown after credit summary is ready
  useEffect(() => {
    if (!creditSummary || usageLoaded || usageLoading) return;
    const abort = backgroundLoadAbortRef.current;
    loadUsageBreakdown(abort?.signal).catch(() => {});
  }, [creditSummary, usageLoaded, usageLoading, loadUsageBreakdown]);

  // Lazy-load logs after usage breakdown is ready
  useEffect(() => {
    if (!usageLoaded || logsLoaded || logsLoading) return;
    const abort = backgroundLoadAbortRef.current;
    loadLogs(0, abort?.signal).catch(() => {});
  }, [usageLoaded, logsLoaded, logsLoading, loadLogs]);

  // Lazy-load products after logs are ready
  useEffect(() => {
    if (!logsLoaded || productsLoaded || productsLoading) return;
    loadProducts().catch(() => {});
  }, [logsLoaded, productsLoaded, productsLoading, loadProducts]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const refreshLiveBilling = useCallback(async () => {
    const creditsData = await cloudApiFetch<any>("/v1/credits");
    if (!mountedRef.current || !creditsData) return;
    setCreditSummary(creditsData);
    if (usageLoaded) {
      await loadUsageBreakdown();
    }
    if (logsLoaded) {
      await loadLogs(logsPage);
    }
  }, [logsLoaded, logsPage, usageLoaded, loadLogs, loadUsageBreakdown]);

  useEffect(() => {
    if (!userId) return;

    const scheduleRefresh = () => {
      if (liveRefreshTimerRef.current) clearTimeout(liveRefreshTimerRef.current);
      liveRefreshTimerRef.current = setTimeout(() => {
        refreshLiveBilling().catch(() => {});
      }, 400);
    };

    const channel = supabase
      .channel(`billing-live:${userId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'usage_events',
        filter: `user_id=eq.${userId}`,
      }, scheduleRefresh)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'credit_grants',
        filter: `user_id=eq.${userId}`,
      }, scheduleRefresh)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'credit_grants',
        filter: `user_id=eq.${userId}`,
      }, scheduleRefresh)
      .subscribe();

    return () => {
      if (liveRefreshTimerRef.current) clearTimeout(liveRefreshTimerRef.current);
      void supabase.removeChannel(channel);
    };
  }, [refreshLiveBilling, userId]);

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

  // Derive a human label for unknown inference:provider categories
  const categoryLabel = (cat: string) => {
    if (cat.startsWith("inference:")) {
      const provider = cat.slice("inference:".length);
      return provider.charAt(0).toUpperCase() + provider.slice(1);
    }
    return cat.charAt(0).toUpperCase() + cat.slice(1);
  };

  // Pie chart data
  const pieData = usageBreakdown
    .filter((item) => item.credits > 0)
    .map((item) => {
      const config = CATEGORY_CONFIG[item.category] || {
        label: categoryLabel(item.category),
        hex: "#9ca3af",
      };
      const pct = usageTotal > 0
        ? Number(((item.credits / usageTotal) * 100).toFixed(1))
        : 0;
      return {
        name: config.label,
        value: item.credits,
        percent: pct,
        fill: config.hex,
      };
    });

  const totalLogsPages = Math.ceil(logsTotal / LOGS_PER_PAGE);

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
    <div className="space-y-6">
      {/* ── Main Card: Balance + Limits ── */}
      <div className="bg-theme-card rounded-theme-card border border-theme p-6 shadow-sm">
        <SectionHeader
          title="Billing & Credits"
          description="Manage your plan, credit balance, and add-ons."
        />

        {error && (
          <div className="flex items-center justify-between gap-3 p-3 bg-red-500/10 rounded-theme-button border border-red-500/20 mb-6">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
              <span className="text-sm text-red-500 font-medium">{error}</span>
            </div>
            <button
              onClick={() => { setError(null); loadData(); }}
              className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold text-red-600 hover:bg-red-500/10 transition-colors flex-shrink-0"
            >
              <RefreshCw className="w-3 h-3" />
              Retry
            </button>
          </div>
        )}

        {/* Empty state when credits couldn't be loaded */}
        {!creditSummary && !loading && !error && (
          <div className="text-center py-8 mb-6">
            <CreditCard className="w-6 h-6 text-theme-muted mx-auto mb-2" />
            <p className="text-sm text-theme-muted font-medium mb-3">
              Billing data unavailable.
            </p>
            <button
              onClick={loadData}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold text-primary border border-primary/30 hover:bg-primary/10 transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              Reload
            </button>
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
                    <div className="w-full bg-theme-bg rounded-full h-2.5">
                      <div
                        className={`h-2.5 rounded-full transition-all ${
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
                        {Number(creditSummary.used || 0).toLocaleString()}{" "}
                        used
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

        {/* ── Limits & Quota ── */}
        {creditSummary && !creditSummary.unlimited && (
          <div className="mb-6">
            <label className="block text-[10px] font-black text-theme-muted uppercase tracking-widest mb-3 ml-1">
              Plan Limits
            </label>
            <div className="p-4 bg-theme-hover rounded-theme-button border border-theme">
              <div className="grid grid-cols-3 gap-3">
                {/* Total limit */}
                <div className="text-center p-3 bg-theme-bg rounded-theme-button">
                  <Shield className="w-4 h-4 text-primary mx-auto mb-1" />
                  <p className="text-[10px] text-theme-muted font-bold uppercase">
                    Period Limit
                  </p>
                  <p className="text-sm font-black text-theme-fg">
                    {Number(creditSummary.limit || 0).toLocaleString()}
                  </p>
                </div>
                {/* Used */}
                <div className="text-center p-3 bg-theme-bg rounded-theme-button">
                  <TrendingUp className="w-4 h-4 text-amber-500 mx-auto mb-1" />
                  <p className="text-[10px] text-theme-muted font-bold uppercase">
                    Used
                  </p>
                  <p className="text-sm font-black text-theme-fg">
                    {Number(creditSummary.used || 0).toLocaleString()}
                  </p>
                </div>
                {/* Remaining */}
                <div className="text-center p-3 bg-theme-bg rounded-theme-button">
                  <Coins className="w-4 h-4 text-emerald-500 mx-auto mb-1" />
                  <p className="text-[10px] text-theme-muted font-bold uppercase">
                    Remaining
                  </p>
                  <p className="text-sm font-black text-theme-fg">
                    {Number(creditSummary.remaining || 0).toLocaleString()}
                  </p>
                </div>
              </div>

              {/* Warning banners */}
              {usagePercent >= 90 && (
                <div className="mt-3 p-2 bg-red-500/10 border border-red-500/20 rounded-theme-button flex items-center gap-2">
                  <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                  <span className="text-[11px] text-red-500 font-bold">
                    {usagePercent >= 100
                      ? "Credit limit reached! Purchase add-ons or upgrade your plan."
                      : "You've used over 90% of your credits this period."}
                  </span>
                </div>
              )}
              {usagePercent >= 70 && usagePercent < 90 && (
                <div className="mt-3 p-2 bg-amber-500/10 border border-amber-500/20 rounded-theme-button flex items-center gap-2">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                  <span className="text-[11px] text-amber-600 font-bold">
                    You've used {usagePercent}% of your credits this period.
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Usage Breakdown Card with Pie Chart ── */}
      {(usageLoading || usageLoaded || usageBreakdown.length > 0) && (
        <div className="bg-theme-card rounded-theme-card border border-theme p-6 shadow-sm">
          <label className="block text-[10px] font-black text-theme-muted uppercase tracking-widest mb-4 ml-1">
            Usage Breakdown
          </label>

          {usageLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
            </div>
          ) : usageBreakdown.length === 0 ? (
            <div className="text-center py-8">
              <Zap className="w-5 h-5 text-theme-muted mx-auto mb-2" />
              <p className="text-xs text-theme-muted font-medium">
                No usage breakdown available yet.
              </p>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row gap-4">
              {/* Pie Chart */}
              {pieData.length > 0 && (
                <div className="flex-shrink-0 w-full sm:w-[200px] h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={80}
                        paddingAngle={3}
                        dataKey="value"
                        nameKey="name"
                        strokeWidth={0}
                        label={({ cx, cy, midAngle, innerRadius: ir, outerRadius: or, percent: pct }: any) => {
                          const RADIAN = Math.PI / 180;
                          const radius = ir + (or - ir) * 0.5;
                          const x = cx + radius * Math.cos(-midAngle * RADIAN);
                          const y = cy + radius * Math.sin(-midAngle * RADIAN);
                          const displayPct = Math.round((pct ?? 0) * 100);
                          if (displayPct < 5) return null;
                          return (
                            <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={700}>
                              {displayPct}%
                            </text>
                          );
                        }}
                        labelLine={false}
                      >
                        {pieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.fill} />
                        ))}
                      </Pie>
                      <Tooltip content={<PieTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Category list */}
              <div className="flex-1 space-y-2">
                <div className="flex items-center justify-between text-[10px] text-theme-muted font-bold uppercase mb-1 px-1">
                  <span>Category</span>
                  <div className="flex gap-6">
                    <span className="w-14 text-right">Credits</span>
                    <span className="w-10 text-right">Count</span>
                  </div>
                </div>
                {usageBreakdown.map((item) => {
                  const config = CATEGORY_CONFIG[item.category] || {
                    label: categoryLabel(item.category),
                    color: "bg-gray-400",
                    hex: "#9ca3af",
                    icon: Zap,
                  };
                  const pct =
                    usageTotal > 0
                      ? ((item.credits / usageTotal) * 100).toFixed(1)
                      : "0";
                  const Icon = config.icon;
                  return (
                    <div
                      key={item.category}
                      className="flex items-center justify-between p-2 bg-theme-hover rounded-theme-button"
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-7 h-7 rounded-md flex items-center justify-center ${config.color}/20`}
                        >
                          <Icon
                            className="w-3.5 h-3.5"
                            style={{ color: config.hex }}
                          />
                        </div>
                        <div>
                          <span className="text-[12px] font-bold text-theme-fg">
                            {config.label}
                          </span>
                          <span className="text-[10px] text-theme-muted ml-2">
                            {pct}%
                          </span>
                        </div>
                      </div>
                      <div className="flex gap-6">
                        <span className="text-[12px] font-black text-theme-fg w-14 text-right">
                          {item.credits.toFixed(1)}
                        </span>
                        <span className="text-[11px] text-theme-muted w-10 text-right">
                          {item.count}
                        </span>
                      </div>
                    </div>
                  );
                })}
                {/* Total row */}
                <div className="flex items-center justify-between px-2 pt-2 border-t border-theme">
                  <span className="text-[11px] font-bold text-theme-muted">
                    Total
                  </span>
                  <div className="flex gap-6">
                    <span className="text-[12px] font-black text-theme-fg w-14 text-right">
                      {usageTotal.toFixed(1)}
                    </span>
                    <span className="text-[11px] text-theme-muted w-10 text-right">
                      {usageBreakdown.reduce((s, b) => s + b.count, 0)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Billing Logs Table ── */}
      <div className="bg-theme-card rounded-theme-card border border-theme p-6 shadow-sm">
        <label className="block text-[10px] font-black text-theme-muted uppercase tracking-widest mb-4 ml-1">
          Credit Usage Logs
        </label>

        {(!logsLoaded || logsLoading) && usageLogs.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
          </div>
        ) : usageLogs.length === 0 ? (
          <div className="text-center py-8">
            <Zap className="w-5 h-5 text-theme-muted mx-auto mb-2" />
            <p className="text-xs text-theme-muted font-medium">
              No usage events this period.
            </p>
          </div>
        ) : (
          <>
            {/* Table */}
            <div className="overflow-x-auto -mx-2">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-theme text-theme-muted font-bold uppercase">
                    <th className="text-left px-2 py-2">Type</th>
                    <th className="text-left px-2 py-2">Model</th>
                    <th className="text-left px-2 py-2">Chat</th>
                    <th className="text-right px-2 py-2">Credits</th>
                    <th className="text-right px-2 py-2">Tokens</th>
                    <th className="text-right px-2 py-2">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {usageLogs.map((log) => {
                    const sourceLabel = getUsageSourceLabel(
                      log.sourceType,
                      log.subagentKind,
                      log.sourceLabel
                    );
                    const sourceCategory = getUsageSourceCategory(
                      log.sourceType,
                      log.subagentKind
                    );
                    const catConfig = CATEGORY_CONFIG[sourceCategory] || {
                      hex: "#9ca3af",
                    };

                    return (
                      <tr
                        key={log.id}
                        className="border-b border-theme/50 hover:bg-theme-hover/50 transition-colors"
                      >
                        <td className="px-2 py-2">
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold"
                            style={{
                              backgroundColor: catConfig.hex + "18",
                              color: catConfig.hex,
                            }}
                          >
                            {sourceLabel}
                          </span>
                        </td>
                        <td className="px-2 py-2 font-mono text-theme-fg font-medium max-w-[120px] truncate">
                          {formatModel(log.model)}
                        </td>
                        <td className="px-2 py-2 text-theme-muted max-w-[150px] truncate">
                          {log.chatName || (
                            <span className="italic opacity-50">
                              Untitled
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right font-bold text-theme-fg tabular-nums">
                          {log.credits.toFixed(2)}
                        </td>
                        <td className="px-2 py-2 text-right text-theme-muted tabular-nums">
                          {log.totalTokens > 0
                            ? log.totalTokens.toLocaleString()
                            : "-"}
                        </td>
                        <td className="px-2 py-2 text-right text-theme-muted whitespace-nowrap">
                          {formatRelativeTime(log.createdAt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalLogsPages > 1 && (
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-theme">
                <span className="text-[10px] text-theme-muted font-medium">
                  {logsTotal} events total
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => loadLogs(logsPage - 1)}
                    disabled={logsPage === 0 || logsLoading}
                    className="p-1 rounded-md hover:bg-theme-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4 text-theme-muted" />
                  </button>
                  <span className="text-[10px] text-theme-muted font-bold tabular-nums">
                    {logsPage + 1} / {totalLogsPages}
                  </span>
                  <button
                    onClick={() => loadLogs(logsPage + 1)}
                    disabled={
                      logsPage >= totalLogsPages - 1 || logsLoading
                    }
                    className="p-1 rounded-md hover:bg-theme-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronRight className="w-4 h-4 text-theme-muted" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Auto-Refill + Add-Ons Card ── */}
      <div className="bg-theme-card rounded-theme-card border border-theme p-6 shadow-sm">
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
          {!productsLoaded || productsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
            </div>
          ) : creditPacks.length > 0 ? (
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
    </div>
  );
};
