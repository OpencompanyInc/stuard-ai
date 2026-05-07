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
  aggregateComputeBillingEvents,
  categorizeModelForUsage,
  getUsageSourceCategory,
  getUsageSourceLabel,
  isNonBillableUsageEvent,
  mergeUsageBreakdowns,
  normalizeComputeBillingLogEntry,
  normalizeUsageLogEntry,
  type ComputeBillingEventRow,
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
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
}

type BillingUser = {
  id: string;
  email?: string | null;
};

interface UsageBreakdownItem {
  category: string;
  credits: number;
  costUsd: number;
  count: number;
}

const CATEGORY_CONFIG: Record<
  string,
  { label: string; color: string; hex: string; icon: React.ElementType }
> = {
  subagent: { label: "Delegated Agents", color: "bg-purple-500", hex: "#8b5cf6", icon: Globe },
  compute: { label: "Cloud Compute", color: "bg-amber-500", hex: "#f59e0b", icon: Cpu },
  storage: { label: "Storage", color: "bg-teal-500", hex: "#14b8a6", icon: HardDrive },
  messaging: { label: "Messaging", color: "bg-rose-500", hex: "#f43f5e", icon: MessageSquare },
  voice: { label: "Voice Calls", color: "bg-orange-500", hex: "#f97316", icon: Phone },
};

const MODEL_COLORS: Array<{ color: string; hex: string }> = [
  { color: "bg-blue-500", hex: "#3b82f6" },
  { color: "bg-orange-400", hex: "#da7756" },
  { color: "bg-green-500", hex: "#10a37f" },
  { color: "bg-indigo-500", hex: "#6366f1" },
  { color: "bg-cyan-500", hex: "#06b6d4" },
  { color: "bg-amber-400", hex: "#f59e0b" },
  { color: "bg-violet-500", hex: "#8b5cf6" },
  { color: "bg-emerald-500", hex: "#10b981" },
  { color: "bg-sky-500", hex: "#0ea5e9" },
  { color: "bg-fuchsia-500", hex: "#d946ef" },
  { color: "bg-lime-500", hex: "#84cc16" },
  { color: "bg-rose-400", hex: "#fb7185" },
];

const modelColorCache = new Map<string, { color: string; hex: string }>();
let modelColorIdx = 0;

function getModelColor(category: string): { color: string; hex: string } {
  if (!modelColorCache.has(category)) {
    modelColorCache.set(category, MODEL_COLORS[modelColorIdx % MODEL_COLORS.length]);
    modelColorIdx += 1;
  }
  return modelColorCache.get(category)!;
}

function getCategoryConfig(category: string): { label: string; color: string; hex: string; icon: React.ElementType } {
  if (CATEGORY_CONFIG[category]) return CATEGORY_CONFIG[category];
  if (category.startsWith("inference:")) {
    const model = category.slice("inference:".length);
    const label = model.includes("/") ? model.split("/").slice(1).join("/") : model;
    const { color, hex } = getModelColor(category);
    return { label, color, hex, icon: Bot };
  }
  return { label: category, color: "bg-gray-400", hex: "#9ca3af", icon: Zap };
}

const SectionHeader = ({ title, description }: { title: string; description: string }) => (
  <div className="mb-6">
    <h3 className="text-xl font-stuard text-theme-fg tracking-tight">{title}</h3>
    <p className="text-sm text-theme-muted font-medium">{description}</p>
  </div>
);

const formatCurrency = (amount: number, currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(amount / 100);

const DETAIL_LOAD_DELAY_MS = 350;
const COMPUTE_BILLING_ROW_LIMIT = 1500;

const formatModel = (model: string): string => {
  if (!model || model === "unknown") return "Unknown";
  if (model.startsWith("voice:")) return "-";
  if (model.startsWith("messaging:") || model === "telnyx" || model === "sms") return "-";
  if (model.startsWith("compute:")) return model.slice("compute:".length);
  if (model === "compute") return "VM";
  if (model === "storage:hot") return "Hot storage";
  if (model === "storage:cold") return "Cold storage";
  if (model === "storage:purchase") return "Storage purchase";
  if (model.startsWith("storage:")) return "Storage";
  return model.replace("anthropic/", "").replace("openai/", "").replace("google/", "").replace("deepseek/", "");
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

const PieTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.[0]) return null;
  const { name, value, payload: entry } = payload[0];
  return (
    <div className="bg-theme-card border border-theme rounded-lg px-3 py-2 shadow-lg">
      <p className="text-[11px] font-bold text-theme-fg">{name}</p>
      <p className="text-[10px] text-theme-muted">
        {Number(value).toFixed(2)} credits ({Number(entry.pct).toFixed(1)}%)
      </p>
    </div>
  );
};

function resolvePeriodDate(since: string | null): Date {
  return since && !Number.isNaN(Date.parse(since))
    ? new Date(since)
    : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
}

async function loadUsageBreakdownRows(uid: string, sinceIso: string): Promise<UsageBreakdownItem[]> {
  try {
    const { data, error } = await (supabase as any).rpc("get_usage_breakdown", {
      p_user_id: uid,
      p_since: sinceIso,
    });
    if (!error && Array.isArray(data)) {
      return data.map((row: any) => ({
        category: String(row?.category || "usage"),
        credits: Number(Number(row?.credits || 0).toFixed(2)),
        costUsd: Number(Number(row?.cost_usd || row?.costUsd || 0).toFixed(6)),
        count: Math.max(0, Number(row?.count ?? row?.event_count) || 0),
      }));
    }
  } catch {
    // Fall back to direct reads below.
  }

  const { data } = await supabase
    .from("usage_events")
    .select("model, cost_usd, credit_cost, raw")
    .eq("user_id", uid)
    .gte("created_at", sinceIso);

  const buckets: Record<string, { credits: number; costUsd: number; count: number }> = {};
  for (const row of (data as any[]) || []) {
    if (isNonBillableUsageEvent({ model: row.model, raw: row.raw })) continue;
    const category = categorizeModelForUsage(String(row.model || "unknown"));
    if (!buckets[category]) buckets[category] = { credits: 0, costUsd: 0, count: 0 };
    buckets[category].credits += Number(row.credit_cost) || 0;
    buckets[category].costUsd += Number(row.cost_usd) || 0;
    buckets[category].count += 1;
  }

  return Object.entries(buckets).map(([category, v]) => ({
    category,
    credits: Number(v.credits.toFixed(2)),
    costUsd: Number(v.costUsd.toFixed(6)),
    count: v.count,
  }));
}

async function loadUsageLogRows(
  uid: string,
  sinceIso: string,
  limit: number
): Promise<{ logs: UsageLogEntry[]; total: number }> {
  try {
    const { data, error } = await (supabase as any).rpc("get_usage_logs_aggregated", {
      p_user_id: uid,
      p_limit: limit,
      p_offset: 0,
      p_since: sinceIso,
    });
    if (!error && Array.isArray(data)) {
      const total = Number(data[0]?.total_count ?? data.length);
      return { logs: data.map(normalizeUsageLogEntry), total };
    }
  } catch {
    // Fall back to direct reads below.
  }

  const fetchLimit = Math.max(limit * 8, 200);
  const { data } = await supabase
    .from("usage_events")
    .select("id, model, prompt_tokens, completion_tokens, total_tokens, cost_usd, credit_cost, conversation_id, raw, created_at")
    .eq("user_id", uid)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(fetchLimit);

  const groups = new Map<string, any>();
  for (const row of (data as any[]) || []) {
    const raw = row.raw && typeof row.raw === "object" ? row.raw : {};
    if (isNonBillableUsageEvent({ model: row.model, raw })) continue;
    const key = raw.sourceRef || raw.source_ref || row.id;
    if (!groups.has(key)) {
      groups.set(key, {
        id: key, source_ref: key, model: row.model,
        conversation_id: row.conversation_id,
        source_type: raw.sourceType || raw.source_type || null,
        source_label: raw.source_label || raw.sourceLabel || null,
        subagent_kind: raw.subagentKind || raw.subagent_kind || null,
        prompt_tokens: 0, completion_tokens: 0, total_tokens: 0,
        cost_usd: 0, credit_cost: 0, step_count: 0, created_at: row.created_at,
      });
    }
    const g = groups.get(key)!;
    g.prompt_tokens += Number(row.prompt_tokens || 0);
    g.completion_tokens += Number(row.completion_tokens || 0);
    g.total_tokens += Number(row.total_tokens || 0);
    g.cost_usd += Number(row.cost_usd || 0);
    g.credit_cost += Number(row.credit_cost || 0);
    g.step_count += 1;
    if (row.created_at > g.created_at) g.created_at = row.created_at;
  }

  const allGroups = Array.from(groups.values()).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return { logs: allGroups.map(normalizeUsageLogEntry), total: allGroups.length };
}

async function loadComputeBillingRows(uid: string, sinceIso: string, limit?: number): Promise<{
  rows: ComputeBillingEventRow[];
  total: number;
}> {
  let query = supabase
    .from("compute_billing_events")
    .select("id, event_type, credits_deducted, details, billing_hour, created_at")
    .eq("user_id", uid)
    .gte("billing_hour", sinceIso)
    .order("billing_hour", { ascending: false });

  query = query.limit(limit && limit > 0
    ? Math.min(limit, COMPUTE_BILLING_ROW_LIMIT)
    : COMPUTE_BILLING_ROW_LIMIT);

  const { data, error } = await query;
  if (error || !Array.isArray(data)) return { rows: [], total: 0 };
  return { rows: data as ComputeBillingEventRow[], total: data.length };
}

export const BillingSettings: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<Product[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoRefill, setAutoRefill] = useState(false);
  const [creditSummary, setCreditSummary] = useState<CreditSummary | null>(null);
  const [usageBreakdown, setUsageBreakdown] = useState<UsageBreakdownItem[]>([]);
  const [usageLogs, setUsageLogs] = useState<UsageLogEntry[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsPage, setLogsPage] = useState(0);
  const [usageLoading, setUsageLoading] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsLoaded, setLogsLoaded] = useState(false);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsLoaded, setProductsLoaded] = useState(false);

  const LOGS_PER_PAGE = 20;
  const mountedRef = useRef(true);
  const liveRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detailLoadTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const convTitleCacheRef = useRef<Record<string, string>>({});

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (liveRefreshTimerRef.current) clearTimeout(liveRefreshTimerRef.current);
      for (const timer of detailLoadTimersRef.current) clearTimeout(timer);
      detailLoadTimersRef.current = [];
    };
  }, []);

  const billingPeriodStart = typeof creditSummary?.currentPeriodStart === "string"
    ? creditSummary.currentPeriodStart
    : null;

  // ── Core credit loader — queries Supabase directly, no local server needed ──
  const loadCredits = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user as BillingUser | undefined;
    if (!user) return null;

    const [{ data: profile }, { data: rawGrants }] = await Promise.all([
      supabase.from("profiles").select("plan, current_period_start, current_period_end").eq("id", user.id).maybeSingle(),
      supabase.from("credit_grants").select("source_type, total_credits, remaining_credits, expires_at").eq("user_id", user.id),
    ]);

    const now = Date.now();
    let includedCredits = 0, includedRemaining = 0, addonCredits = 0, addonRemaining = 0;
    for (const g of (rawGrants as any[]) || []) {
      if (g.expires_at && Date.parse(g.expires_at) <= now) continue;
      const tc = Math.max(0, Number(g.total_credits) || 0);
      const tr = Math.max(0, Number(g.remaining_credits) || 0);
      if (String(g.source_type || "").toLowerCase() === "subscription_cycle") {
        includedCredits += tc; includedRemaining += tr;
      } else {
        addonCredits += tc; addonRemaining += tr;
      }
    }

    const periodStart = (profile as any)?.current_period_start
      ? new Date((profile as any).current_period_start)
      : new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    const totalCredits = includedCredits + addonCredits;
    const grantRemaining = includedRemaining + addonRemaining;
    const used = Math.max(0, totalCredits - grantRemaining);

    return {
      user,
      summary: {
        plan: String((profile as any)?.plan || "Free"),
        limit: Math.ceil(totalCredits),
        used: Math.ceil(used),
        remaining: Math.ceil(grantRemaining),
        unlimited: false,
        includedCredits: Math.ceil(includedCredits),
        includedRemaining: Math.ceil(includedRemaining),
        addonCredits: Math.ceil(addonCredits),
        addonRemaining: Math.ceil(addonRemaining),
        currentPeriodStart: (profile as any)?.current_period_start || periodStart.toISOString(),
        currentPeriodEnd: (profile as any)?.current_period_end || null,
      } as CreditSummary,
    };
  }, []);

  const loadUsageBreakdown = useCallback(async (uid: string, since: string | null) => {
    setUsageLoading(true);
    try {
      const start = resolvePeriodDate(since);
      const sinceIso = start.toISOString();
      const [usageRows, computeBilling] = await Promise.all([
        loadUsageBreakdownRows(uid, sinceIso),
        loadComputeBillingRows(uid, sinceIso),
      ]);

      if (!mountedRef.current) return;
      setUsageBreakdown(mergeUsageBreakdowns(
        usageRows,
        aggregateComputeBillingEvents(computeBilling.rows)
      ).filter((item) => item.credits > 0 || item.costUsd > 0));
    } finally {
      if (mountedRef.current) setUsageLoading(false);
    }
  }, []);

  const loadLogs = useCallback(async (uid: string, since: string | null, page: number) => {
    setLogsLoading(true);
    try {
      const start = resolvePeriodDate(since);
      const sinceIso = start.toISOString();
      const fetchLimit = Math.max((page + 1) * LOGS_PER_PAGE, LOGS_PER_PAGE);
      const [usageResult, computeBilling] = await Promise.all([
        loadUsageLogRows(uid, sinceIso, fetchLimit),
        loadComputeBillingRows(uid, sinceIso, fetchLimit),
      ]);

      if (!mountedRef.current) return;

      const allGroups = [
        ...usageResult.logs,
        ...computeBilling.rows.map(normalizeComputeBillingLogEntry),
      ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      const pageSlice = allGroups.slice(page * LOGS_PER_PAGE, (page + 1) * LOGS_PER_PAGE);

      // Apply cached conversation titles then resolve missing ones in background
      const applyCache = (rows: any[]) => rows.map((g) => {
        const conversationId = g.conversationId || g.conversation_id;
        const cached = conversationId ? convTitleCacheRef.current[conversationId] : null;
        return cached ? { ...g, chatName: cached, chat_name: cached } : g;
      });

      const normalizedLogs = applyCache(pageSlice).map((entry) => entry.createdAt ? entry as UsageLogEntry : normalizeUsageLogEntry(entry));
      setUsageLogs(normalizedLogs);
      setLogsTotal(usageResult.total + computeBilling.total);
      setLogsPage(page);
      setLogsLoaded(true);

      const missingIds = Array.from(new Set(
        pageSlice.map((g) => g.conversationId).filter((id): id is string => !!id && !convTitleCacheRef.current[id])
      ));
      if (missingIds.length > 0) {
        void supabase.from("conversations").select("id, title").in("id", missingIds).then(({ data: convData }) => {
          if (!Array.isArray(convData) || !mountedRef.current) return;
          let changed = false;
          for (const row of convData as Array<{ id?: string; title?: string | null }>) {
            const id = typeof row.id === "string" ? row.id : "";
            const title = typeof row.title === "string" ? row.title.trim() : "";
            if (id && title && !convTitleCacheRef.current[id]) {
              convTitleCacheRef.current[id] = title;
              changed = true;
            }
          }
          if (changed) {
            setUsageLogs((prev) => prev.map((log) => {
              const cached = log.conversationId ? convTitleCacheRef.current[log.conversationId] : null;
              return cached && !log.chatName ? { ...log, chatName: cached } : log;
            }));
          }
        });
      }
    } finally {
      if (mountedRef.current) setLogsLoading(false);
    }
  }, []);

  const loadProducts = useCallback(async () => {
    setProductsLoading(true);
    try {
      const result = await window.desktopAPI?.billingListProducts?.();
      if (!mountedRef.current) return;
      if (result?.ok && result.products) setProducts(result.products);
    } finally {
      if (mountedRef.current) { setProductsLoading(false); setProductsLoaded(true); }
    }
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    for (const timer of detailLoadTimersRef.current) clearTimeout(timer);
    detailLoadTimersRef.current = [];
    setCreditSummary(null);
    setUsageBreakdown([]);
    setUsageLogs([]);
    setLogsLoaded(false);
    convTitleCacheRef.current = {};
    setLogsTotal(0);
    setLogsPage(0);
    setProducts([]);
    setProductsLoaded(false);

    window.desktopAPI?.getPrefs?.().then((r: any) => {
      if (r?.ok && r.prefs?.autoRefillCredits !== undefined) setAutoRefill(!!r.prefs.autoRefillCredits);
    }).catch(() => {});

    try {
      const result = await loadCredits();
      if (!mountedRef.current) return;
      if (!result) {
        setError("Sign in to view billing information.");
        return;
      }
      const { user, summary } = result;
      setUserId(user.id);
      setUserEmail(user.email || null);
      setCreditSummary(summary);
      if (mountedRef.current) setLoading(false);
      const scheduleDetailLoad = (delay: number, run: () => void) => {
        const timer = setTimeout(() => {
          if (!mountedRef.current) return;
          run();
        }, delay);
        detailLoadTimersRef.current.push(timer);
      };
      const periodStart = summary.currentPeriodStart || null;
      // Detail sections are useful, but they should never block opening Billing.
      scheduleDetailLoad(DETAIL_LOAD_DELAY_MS, () => void loadUsageBreakdown(user.id, periodStart));
    } catch (e: any) {
      if (!mountedRef.current) return;
      setError(e?.message || "Failed to load billing information");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [loadCredits, loadUsageBreakdown, loadLogs, loadProducts]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Realtime refresh on usage/credit changes
  useEffect(() => {
    if (!userId) return;
    const scheduleRefresh = () => {
      if (liveRefreshTimerRef.current) clearTimeout(liveRefreshTimerRef.current);
      liveRefreshTimerRef.current = setTimeout(async () => {
        const result = await loadCredits().catch(() => null);
        if (!mountedRef.current || !result) return;
        setCreditSummary(result.summary);
        const since = result.summary.currentPeriodStart || null;
        void loadUsageBreakdown(result.user.id, since);
        if (logsLoaded) void loadLogs(result.user.id, since, logsPage);
      }, 400);
    };

    const channel = supabase
      .channel(`billing-live:${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "usage_events", filter: `user_id=eq.${userId}` }, scheduleRefresh)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "credit_grants", filter: `user_id=eq.${userId}` }, scheduleRefresh)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "credit_grants", filter: `user_id=eq.${userId}` }, scheduleRefresh)
      .subscribe();

    return () => {
      if (liveRefreshTimerRef.current) clearTimeout(liveRefreshTimerRef.current);
      void supabase.removeChannel(channel);
    };
  }, [userId, logsLoaded, logsPage, loadCredits, loadUsageBreakdown, loadLogs]);

  const creditPacks = products.filter((p) => !p.isRecurring);
  const usageTotal = usageBreakdown.reduce((s, b) => s + b.credits, 0);

  const currentPlan = (() => {
    const raw = String(creditSummary?.plan || "free").trim().toLowerCase();
    if (raw === "free_trial" || raw === "trial") return "Free";
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  })();

  const usagePercent =
    creditSummary && !creditSummary.unlimited && creditSummary.limit && creditSummary.limit > 0
      ? Math.min(100, Math.round(((creditSummary.used || 0) / creditSummary.limit) * 100))
      : 0;

  const pieData = usageBreakdown
    .filter((item) => item.credits > 0)
    .map((item) => {
      const config = getCategoryConfig(item.category);
      const pct = usageTotal > 0 ? Number(((item.credits / usageTotal) * 100).toFixed(1)) : 0;
      return { name: config.label, value: item.credits, pct, fill: config.hex };
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
      if (!result?.ok) setError(result?.error || "Failed to open purchase page");
    } catch (e: any) {
      setError(e?.message || "Failed to open purchase page");
    } finally {
      setActionLoading(null);
    }
  };

  const handleOpenWebsiteBilling = async () => {
    setActionLoading("website");
    try {
      await (window as any).desktopAPI?.openExternal?.("https://stuard.ai/dashboard/billing");
    } catch {
      window.open("https://stuard.ai/dashboard/billing", "_blank", "noopener,noreferrer");
    } finally {
      setActionLoading(null);
    }
  };

  const handleLoadLogs = () => {
    if (!userId || logsLoading) return;
    void loadLogs(userId, billingPeriodStart, logsPage);
  };

  const handleLoadProducts = () => {
    if (productsLoading || productsLoaded) return;
    void loadProducts();
  };

  return (
    <div className="space-y-6">
      {/* ── Main Card: Balance + Limits ── */}
      <div className="bg-theme-card rounded-theme-card border border-theme p-6 shadow-sm">
        <SectionHeader title="Billing & Credits" description="Manage your plan, credit balance, and add-ons." />

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

        {loading && !creditSummary && (
          <div className="flex items-center justify-center gap-3 py-10 text-sm text-theme-muted font-medium">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
            <span>Loading billing balance...</span>
          </div>
        )}

        {!creditSummary && !loading && !error && (
          <div className="text-center py-8 mb-6">
            <CreditCard className="w-6 h-6 text-theme-muted mx-auto mb-2" />
            <p className="text-sm text-theme-muted font-medium mb-3">Billing data unavailable.</p>
            <button
              onClick={loadData}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold text-primary border border-primary/30 hover:bg-primary/10 transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              Reload
            </button>
          </div>
        )}

        {creditSummary && (
          <div className="mb-6">
            <label className="block text-[10px] font-black text-theme-muted uppercase tracking-widest mb-3 ml-1">
              Current Balance
            </label>
            <div className="p-4 bg-theme-hover rounded-theme-button border border-theme">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-primary" />
                  <span className="text-[13px] font-bold text-theme-fg">{currentPlan} Plan</span>
                </div>
                <div className="text-right">
                  <span className="text-lg font-black text-theme-fg">
                    {creditSummary.unlimited ? "Unlimited" : Number(creditSummary.remaining || 0).toLocaleString()}
                  </span>
                  {!creditSummary.unlimited && (
                    <span className="text-[11px] text-theme-muted ml-1">credits remaining</span>
                  )}
                </div>
              </div>

              {!creditSummary.unlimited && creditSummary.limit && creditSummary.limit > 0 && (
                <div className="mb-3">
                  <div className="w-full bg-theme-bg rounded-full h-2.5">
                    <div
                      className={`h-2.5 rounded-full transition-all ${
                        usagePercent >= 90 ? "bg-red-500" : usagePercent >= 70 ? "bg-amber-500" : "bg-emerald-500"
                      }`}
                      style={{ width: `${usagePercent}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-theme-muted mt-1">
                    <span>{Number(creditSummary.used || 0).toLocaleString()} used</span>
                    <span>{Number(creditSummary.limit).toLocaleString()} total</span>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div className="p-2 bg-theme-bg rounded-theme-button">
                  <p className="text-[10px] text-theme-muted font-bold uppercase">Subscription</p>
                  <p className="text-sm font-bold text-theme-fg">
                    {Number(creditSummary.includedRemaining || 0).toLocaleString()}
                  </p>
                </div>
                <div className="p-2 bg-theme-bg rounded-theme-button">
                  <p className="text-[10px] text-theme-muted font-bold uppercase">Add-ons</p>
                  <p className="text-sm font-bold text-theme-fg">
                    {Number(creditSummary.addonRemaining || 0).toLocaleString()}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {creditSummary && !creditSummary.unlimited && (
          <div className="mb-6">
            <label className="block text-[10px] font-black text-theme-muted uppercase tracking-widest mb-3 ml-1">
              Plan Limits
            </label>
            <div className="p-4 bg-theme-hover rounded-theme-button border border-theme">
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center p-3 bg-theme-bg rounded-theme-button">
                  <Shield className="w-4 h-4 text-primary mx-auto mb-1" />
                  <p className="text-[10px] text-theme-muted font-bold uppercase">Period Limit</p>
                  <p className="text-sm font-black text-theme-fg">
                    {Number(creditSummary.limit || 0).toLocaleString()}
                  </p>
                </div>
                <div className="text-center p-3 bg-theme-bg rounded-theme-button">
                  <TrendingUp className="w-4 h-4 text-amber-500 mx-auto mb-1" />
                  <p className="text-[10px] text-theme-muted font-bold uppercase">Used</p>
                  <p className="text-sm font-black text-theme-fg">
                    {Number(creditSummary.used || 0).toLocaleString()}
                  </p>
                </div>
                <div className="text-center p-3 bg-theme-bg rounded-theme-button">
                  <Coins className="w-4 h-4 text-emerald-500 mx-auto mb-1" />
                  <p className="text-[10px] text-theme-muted font-bold uppercase">Remaining</p>
                  <p className="text-sm font-black text-theme-fg">
                    {Number(creditSummary.remaining || 0).toLocaleString()}
                  </p>
                </div>
              </div>

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

      {/* ── Usage Breakdown Card ── */}
      {(usageLoading || usageBreakdown.length > 0) && (
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
              <p className="text-xs text-theme-muted font-medium">No usage breakdown available yet.</p>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row gap-4">
              {pieData.length > 0 && (
                <div className="flex-shrink-0 w-full sm:w-[200px] h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%" cy="50%"
                        innerRadius={50} outerRadius={80}
                        paddingAngle={3}
                        dataKey="value" nameKey="name"
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

              <div className="flex-1 space-y-1.5">
                {usageBreakdown.map((item) => {
                  const config = getCategoryConfig(item.category);
                  const pct = usageTotal > 0 ? ((item.credits / usageTotal) * 100).toFixed(1) : "0";
                  return (
                    <div
                      key={item.category}
                      className="flex items-center justify-between px-3 py-2 rounded-lg transition-colors"
                      style={{ backgroundColor: config.hex + "0d" }}
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: config.hex }} />
                        <span className="text-[12px] font-semibold text-theme-fg">{config.label}</span>
                        <span className="text-[10px] text-theme-muted">
                          {item.count} {item.count === 1 ? "call" : "calls"}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span
                          className="text-[10px] font-bold px-1.5 py-0.5 rounded-md"
                          style={{ backgroundColor: config.hex + "18", color: config.hex }}
                        >
                          {pct}%
                        </span>
                        <span className="text-[12px] font-black text-theme-fg w-14 text-right tabular-nums">
                          {item.credits.toFixed(1)}
                        </span>
                      </div>
                    </div>
                  );
                })}
                <div className="flex items-center justify-between px-3 pt-2 mt-1 border-t border-theme">
                  <span className="text-[11px] font-bold text-theme-muted">Total</span>
                  <span className="text-[12px] font-black text-theme-fg w-14 text-right tabular-nums">
                    {usageTotal.toFixed(1)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Billing Logs Table ── */}
      {(creditSummary || !loading) && (
      <div className="bg-theme-card rounded-theme-card border border-theme p-6 shadow-sm">
        <label className="block text-[10px] font-black text-theme-muted uppercase tracking-widest mb-4 ml-1">
          Credit Usage Logs
        </label>

        {!logsLoaded && !logsLoading ? (
          <div className="text-center py-8">
            <Zap className="w-5 h-5 text-theme-muted mx-auto mb-2" />
            <p className="text-xs text-theme-muted font-medium mb-3">Usage logs load separately so Billing stays responsive.</p>
            <button
              onClick={handleLoadLogs}
              disabled={!userId}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold text-primary border border-primary/30 hover:bg-primary/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              Load usage logs
            </button>
          </div>
        ) : logsLoading && usageLogs.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
          </div>
        ) : usageLogs.length === 0 ? (
          <div className="text-center py-8">
            <Zap className="w-5 h-5 text-theme-muted mx-auto mb-2" />
            <p className="text-xs text-theme-muted font-medium">No usage events this period.</p>
          </div>
        ) : (
          <>
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
                    const sourceLabel = getUsageSourceLabel(log.sourceType, log.subagentKind, log.sourceLabel);
                    const sourceCategory = getUsageSourceCategory(log.sourceType, log.subagentKind);
                    const catConfig = getCategoryConfig(sourceCategory);
                    return (
                      <tr key={log.id} className="border-b border-theme/50 hover:bg-theme-hover/50 transition-colors">
                        <td className="px-2 py-2">
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold"
                            style={{ backgroundColor: catConfig.hex + "18", color: catConfig.hex }}
                          >
                            {sourceLabel}
                          </span>
                        </td>
                        <td className="px-2 py-2 font-mono text-theme-fg font-medium max-w-[120px] truncate">
                          {formatModel(log.model)}
                        </td>
                        <td className="px-2 py-2 text-theme-muted max-w-[150px] truncate">
                          {log.chatName || <span className="italic opacity-50">Untitled</span>}
                        </td>
                        <td className="px-2 py-2 text-right font-bold text-theme-fg tabular-nums">
                          {log.credits.toFixed(2)}
                        </td>
                        <td className="px-2 py-2 text-right text-theme-muted tabular-nums">
                          <div className="flex items-center justify-end gap-1.5">
                            {log.totalTokens > 0 ? log.totalTokens.toLocaleString() : "-"}
                            {log.stepCount > 1 && (
                              <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-theme-hover text-theme-muted tabular-nums">
                                {log.stepCount}×
                              </span>
                            )}
                          </div>
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

            {totalLogsPages > 1 && (
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-theme">
                <span className="text-[10px] text-theme-muted font-medium">{logsTotal} events total</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => userId && loadLogs(userId, billingPeriodStart, logsPage - 1)}
                    disabled={logsPage === 0 || logsLoading}
                    className="p-1 rounded-md hover:bg-theme-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4 text-theme-muted" />
                  </button>
                  <span className="text-[10px] text-theme-muted font-bold tabular-nums">
                    {logsPage + 1} / {totalLogsPages}
                  </span>
                  <button
                    onClick={() => userId && loadLogs(userId, billingPeriodStart, logsPage + 1)}
                    disabled={logsPage >= totalLogsPages - 1 || logsLoading}
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
      )}

      {/* ── Auto-Refill + Add-Ons Card ── */}
      {(creditSummary || !loading) && (
      <div className="bg-theme-card rounded-theme-card border border-theme p-6 shadow-sm">
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
                  <span className="text-[13px] font-bold text-theme-fg">Auto-refill credits</span>
                </div>
                <p className="text-[11px] text-theme-muted mt-1 font-medium">
                  Automatically purchase a credit pack when your balance runs low, so you never run out mid-conversation.
                </p>
              </div>
            </label>
          </div>
        </div>

        <div className="mb-6">
          <label className="block text-[10px] font-black text-theme-muted uppercase tracking-widest mb-3 ml-1">
            Purchase Add-On Credits
          </label>
          {!productsLoaded && !productsLoading ? (
            <div className="p-4 bg-theme-hover rounded-theme-button border border-theme text-center">
              <Coins className="w-5 h-5 text-theme-muted mx-auto mb-2" />
              <p className="text-xs text-theme-muted font-medium mb-3">Credit packs load separately from the main billing view.</p>
              <button
                onClick={handleLoadProducts}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold text-primary border border-primary/30 hover:bg-primary/10 transition-colors"
              >
                <RefreshCw className="w-3 h-3" />
                Load credit packs
              </button>
            </div>
          ) : productsLoading ? (
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
                    <p className="text-xs text-theme-muted mb-2">{product.description}</p>
                    {product.benefits.length > 0 && (
                      <ul className="text-xs text-theme-muted space-y-0.5 mb-2">
                        {product.benefits.slice(0, 3).map((benefit, i) => (
                          <li key={i} className="flex items-center gap-1">
                            <span className="text-emerald-500">+</span> {benefit}
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-primary">
                        {price ? formatCurrency(price.amount, price.currency) : "—"}
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
              <p className="text-xs text-theme-muted font-medium">No credit packs available right now.</p>
            </div>
          )}
        </div>

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
            Change your plan, view transaction history, and manage payment methods on the website.
          </p>
        </div>
      </div>
      )}
    </div>
  );
};
