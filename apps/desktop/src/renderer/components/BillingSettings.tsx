import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  ChevronDown,
  Globe,
  Bot,
  MessageSquare,
  HardDrive,
  Cpu,
  Shield,
  Phone,
} from "lucide-react";
import { clsx } from "clsx";
import { supabase } from "../lib/supabaseClient";
import { getApiEndpoint } from "../utils/apiEndpoint";
import { openExternalUrl } from "../utils/billing";
import {
  aggregateComputeBillingEvents,
  buildUsageActivityBreakdown,
  categorizeModelForUsage,
  getUsageSourceCategory,
  getUsageSourceLabel,
  isNonBillableUsageEvent,
  mergeUsageBreakdowns,
  normalizeComputeBillingLogEntry,
  normalizeUsageLogEntry,
  isCreditExhausted,
  type ComputeBillingEventRow,
  type UsageActivityKey,
  type UsageActivityProvider,
  type UsageActivityRow,
  type UsageLogEntry,
} from "./BillingSettings.utils";
import { displayConversationTitle } from "../utils/conversationTitle";

/** Set true to re-enable auto-refill, budgets, and metered-limit settings UI. */
const BILLING_ADVANCED_SETTINGS_ENABLED = false;

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
  billingCustomerId?: string | null;
  billingSubscriptionId?: string | null;
  billingSubscriptionStatus?: string | null;
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

type BillingPrefs = {
  autoRefillEnabled: boolean;
  autoRefillThresholdCredits: number;
  autoRefillAmountCents: number;
  monthlyBudgetCents: number | null;
  hardSpendLimitCents: number | null;
};

type QuickCreditPack = {
  id: string;
  label: string;
  amountCents: number;
  productId: string;
  credits: number;
};

const DEFAULT_BILLING_PREFS: BillingPrefs = {
  autoRefillEnabled: false,
  autoRefillThresholdCredits: 100,
  autoRefillAmountCents: 1000,
  monthlyBudgetCents: null,
  hardSpendLimitCents: null,
};

type BillingCustomerSummary = {
  id: string;
  subscriptions?: Array<{ status?: string }>;
  orders?: Array<{ id: string }>;
};

const ACTIVE_BILLING_STATUSES = new Set(["active", "trialing", "switching", "past_due"]);

function customerHasBillingOnFile(customer: BillingCustomerSummary | null | undefined): boolean {
  if (!customer?.id) return false;
  if (Array.isArray(customer.orders) && customer.orders.length > 0) return true;
  return (customer.subscriptions || []).some((sub) =>
    ACTIVE_BILLING_STATUSES.has(String(sub?.status || "").trim().toLowerCase())
  );
}

const WEBSITE_BILLING_URL = "https://stuard.ai/dashboard/billing";

const QUICK_CREDIT_PACKS: QuickCreditPack[] = [
  { id: "addon_5", label: "$5", amountCents: 500, productId: "d4939807-bc62-4a29-8a87-affb910e134b", credits: 100 },
  { id: "addon_10", label: "$10", amountCents: 1000, productId: "7d67c4f0-f376-47cc-99a3-354011aae041", credits: 230 },
  { id: "addon_25", label: "$25", amountCents: 2500, productId: "463ff74b-4f26-44b7-8a80-af2d2cdc9a7a", credits: 585 },
  { id: "addon_50", label: "$50", amountCents: 5000, productId: "5516a18c-b03b-4ada-8b6a-599f2cc5b7e9", credits: 1170 },
];

const billingPrefsFromRow = (row: any): BillingPrefs => ({
  autoRefillEnabled: Boolean(row?.auto_refill_enabled ?? DEFAULT_BILLING_PREFS.autoRefillEnabled),
  autoRefillThresholdCredits: Number(row?.auto_refill_threshold_credits ?? DEFAULT_BILLING_PREFS.autoRefillThresholdCredits),
  autoRefillAmountCents: Number(row?.auto_refill_amount_cents ?? DEFAULT_BILLING_PREFS.autoRefillAmountCents),
  monthlyBudgetCents: row?.monthly_budget_cents == null ? null : Number(row.monthly_budget_cents),
  hardSpendLimitCents: row?.hard_spend_limit_cents == null ? null : Number(row.hard_spend_limit_cents),
});

const billingPrefsToRow = (prefs: Partial<BillingPrefs>) => {
  const row: Record<string, unknown> = {};
  if (typeof prefs.autoRefillEnabled === "boolean") row.auto_refill_enabled = prefs.autoRefillEnabled;
  if (Number.isFinite(prefs.autoRefillThresholdCredits)) {
    row.auto_refill_threshold_credits = Math.max(0, Math.trunc(Number(prefs.autoRefillThresholdCredits)));
  }
  if (Number.isFinite(prefs.autoRefillAmountCents)) {
    row.auto_refill_amount_cents = Math.max(500, Math.trunc(Number(prefs.autoRefillAmountCents)));
  }
  if (prefs.monthlyBudgetCents === null) row.monthly_budget_cents = null;
  else if (Number.isFinite(prefs.monthlyBudgetCents)) {
    row.monthly_budget_cents = Math.max(0, Math.trunc(Number(prefs.monthlyBudgetCents)));
  }
  if (prefs.hardSpendLimitCents === null) row.hard_spend_limit_cents = null;
  else if (Number.isFinite(prefs.hardSpendLimitCents)) {
    row.hard_spend_limit_cents = Math.max(0, Math.trunc(Number(prefs.hardSpendLimitCents)));
  }
  return row;
};

const CATEGORY_CONFIG: Record<
  string,
  { label: string; color: string; hex: string; icon: React.ElementType }
> = {
  subagent: { label: "Delegated Agents", color: "bg-purple-500", hex: "#8b5cf6", icon: Globe },
  compute: { label: "Cloud Compute", color: "bg-amber-500", hex: "#f59e0b", icon: Cpu },
  storage: { label: "Storage", color: "bg-teal-500", hex: "#14b8a6", icon: HardDrive },
  messaging: { label: "Messaging", color: "bg-rose-500", hex: "#f43f5e", icon: MessageSquare },
  voice: { label: "Voice Calls", color: "bg-orange-500", hex: "#f97316", icon: Phone },
  other: { label: "Other", color: "bg-gray-400", hex: "#9ca3af", icon: Zap },
};

const INFERENCE_PROVIDER_CONFIG: Record<string, { label: string; hex: string }> = {
  anthropic: { label: "Anthropic", hex: "#da7756" },
  openai: { label: "OpenAI", hex: "#10a37f" },
  google: { label: "Google", hex: "#4285f4" },
  deepseek: { label: "DeepSeek", hex: "#4d6bff" },
  meta: { label: "Meta", hex: "#0668E1" },
  mistral: { label: "Mistral", hex: "#f97316" },
  groq: { label: "Groq", hex: "#f55036" },
  ollama: { label: "Local models", hex: "#6366f1" },
  "x-ai": { label: "xAI", hex: "#111827" },
  cohere: { label: "Cohere", hex: "#39594d" },
  other: { label: "Other models", hex: "#9ca3af" },
};

function getCategoryConfig(category: string): { label: string; color: string; hex: string; icon: React.ElementType } {
  if (CATEGORY_CONFIG[category]) return CATEGORY_CONFIG[category];
  if (category.startsWith("inference:")) {
    const provider = category.slice("inference:".length);
    const providerConfig = INFERENCE_PROVIDER_CONFIG[provider] || INFERENCE_PROVIDER_CONFIG.other;
    return {
      label: providerConfig.label,
      color: "bg-blue-500",
      hex: providerConfig.hex,
      icon: Bot,
    };
  }
  return { label: category, color: "bg-gray-400", hex: "#9ca3af", icon: Zap };
}

/**
 * Top-level "what did you spend credits on" activities. These map to things a
 * user actually recognizes (chatting, delegating to agents, calls, storage)
 * rather than which model vendor happened to serve a request.
 */
const ACTIVITY_CONFIG: Record<
  UsageActivityKey,
  { label: string; description: string; hex: string; icon: React.ElementType }
> = {
  ai: { label: "Chat & AI models", description: "Assistant replies, tool calls, and reasoning", hex: "#d9573f", icon: Bot },
  subagent: { label: "Delegated agents", description: "Background agents working on your behalf", hex: "#a855f7", icon: Globe },
  compute: { label: "Cloud computer", description: "Your always-on VM runtime", hex: "#f59e0b", icon: Cpu },
  storage: { label: "Storage", description: "Files and memory kept in the cloud", hex: "#14b8a6", icon: HardDrive },
  messaging: { label: "Messaging", description: "SMS, WhatsApp, and Discord delivery", hex: "#3b82f6", icon: MessageSquare },
  voice: { label: "Voice calls", description: "Inbound and outbound phone calls", hex: "#ec4899", icon: Phone },
  other: { label: "Other", description: "Uncategorized usage", hex: "#9ca3af", icon: Zap },
};

const formatCreditsValue = (credits: number): string =>
  credits >= 100 ? Math.round(credits).toLocaleString() : credits.toFixed(1);

const formatSharePercent = (credits: number, total: number): string => {
  if (total <= 0 || credits <= 0) return "0%";
  const pct = (credits / total) * 100;
  if (pct < 0.1) return "<0.1%";
  if (pct < 10) return `${pct.toFixed(1)}%`;
  return `${Math.round(pct)}%`;
};

const BillingSectionHeader = ({ title, description }: { title: string; description?: string }) => (
  <div className="mb-5 border-b border-theme-sidebar pb-4">
    <h3 className="text-[18px] font-semibold font-stuard text-theme-fg tracking-tight">{title}</h3>
    {description ? <p className="text-[13px] text-theme-muted font-medium mt-1">{description}</p> : null}
  </div>
);

const BillingToggle = ({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={clsx(
      "relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50 disabled:cursor-not-allowed",
      checked ? "bg-primary" : "bg-theme-active/70 border border-theme",
    )}
  >
    <span
      className={clsx(
        "inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-200",
        checked ? "translate-x-[1.15rem]" : "translate-x-0.5",
      )}
    />
  </button>
);

const BillingField = ({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) => (
  <div>
    <label className="block text-[11px] font-semibold text-theme-muted tracking-tight mb-1.5">{label}</label>
    {children}
    {hint ? <p className="mt-1 text-[11px] text-theme-muted leading-relaxed">{hint}</p> : null}
  </div>
);

const billingInputClass =
  "w-full px-3 py-2.5 rounded-xl border border-theme bg-theme-card text-theme-fg text-[13px] font-medium focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all shadow-sm placeholder:text-theme-muted disabled:opacity-50";

/** Single stacked bar that shows the whole period's spend composition at a glance. */
function UsageCompositionBar({ rows, total }: { rows: UsageActivityRow[]; total: number }) {
  if (total <= 0) return null;
  const segments = rows.filter((row) => row.credits > 0);
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-theme-hover ring-1 ring-inset ring-theme/60">
      {segments.map((row, idx) => {
        const cfg = ACTIVITY_CONFIG[row.key];
        const pct = (row.credits / total) * 100;
        return (
          <div
            key={row.key}
            className="h-full"
            style={{
              width: `${pct}%`,
              backgroundColor: cfg.hex,
              boxShadow: idx > 0 ? "inset 1.5px 0 0 var(--card-bg, rgba(0,0,0,0.25))" : undefined,
            }}
            title={`${cfg.label} · ${formatCreditsValue(row.credits)} credits`}
          />
        );
      })}
    </div>
  );
}

function ActivityProviderRow({ provider, total }: { provider: UsageActivityProvider; total: number }) {
  const config = getCategoryConfig(provider.category);
  return (
    <div className="flex items-center justify-between gap-3 pl-[2.75rem] pr-4 py-2">
      <div className="flex items-center gap-2 min-w-0">
        <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: config.hex }} />
        <span className="text-[12px] text-theme-muted font-medium truncate">{config.label}</span>
      </div>
      <div className="flex items-center gap-3 shrink-0 tabular-nums">
        <span className="text-[12px] text-theme-muted font-medium">{formatSharePercent(provider.credits, total)}</span>
        <span className="text-[12px] text-theme-fg font-semibold w-12 text-right">{formatCreditsValue(provider.credits)}</span>
      </div>
    </div>
  );
}

/** One calm, scannable list row per activity, with an optional AI-model drill-down. */
function UsageActivityRowItem({
  row,
  total,
  expanded,
  onToggle,
}: {
  row: UsageActivityRow;
  total: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const cfg = ACTIVITY_CONFIG[row.key];
  const Icon = cfg.icon;
  const providers = row.providers?.filter((p) => p.credits > 0) ?? [];
  const expandable = row.key === "ai" && providers.length > 1;

  const headerInner = (
    <>
      <div className="flex items-center gap-3 min-w-0">
        <span className="relative flex h-8 w-8 items-center justify-center rounded-lg border border-theme bg-theme-card shrink-0">
          <Icon className="w-4 h-4" style={{ color: cfg.hex }} />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] font-semibold text-theme-fg tracking-tight truncate">{cfg.label}</span>
            {expandable && (
              <ChevronDown
                className={clsx("w-3.5 h-3.5 text-theme-muted transition-transform", expanded ? "rotate-180" : "")}
              />
            )}
          </div>
          <div className="text-[11px] text-theme-muted truncate">{cfg.description}</div>
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0 tabular-nums">
        <span className="text-[12px] text-theme-muted font-medium w-12 text-right">{formatSharePercent(row.credits, total)}</span>
        <span className="text-[14px] font-semibold text-theme-fg w-14 text-right">{formatCreditsValue(row.credits)}</span>
      </div>
    </>
  );

  return (
    <div>
      {expandable ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--sidebar-item-hover)_55%,transparent)]"
        >
          {headerInner}
        </button>
      ) : (
        <div className="flex items-center justify-between gap-3 px-4 py-3">{headerInner}</div>
      )}
      {expandable && expanded && (
        <div className="pb-1.5 bg-[color-mix(in_srgb,var(--sidebar-item-hover)_45%,transparent)]">
          {providers.map((provider) => (
            <ActivityProviderRow key={provider.category} provider={provider} total={total} />
          ))}
        </div>
      )}
    </div>
  );
}

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
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [billingPrefs, setBillingPrefs] = useState<BillingPrefs | null>(null);
  const [billingCustomer, setBillingCustomer] = useState<BillingCustomerSummary | null>(null);
  const [billingCustomerLoading, setBillingCustomerLoading] = useState(false);
  const [billingCustomerChecked, setBillingCustomerChecked] = useState(false);
  const [prefsLoading, setPrefsLoading] = useState(false);
  const [prefsSaving, setPrefsSaving] = useState(false);
  const [creditSummary, setCreditSummary] = useState<CreditSummary | null>(null);
  const [usageBreakdown, setUsageBreakdown] = useState<UsageBreakdownItem[]>([]);
  const [usageLogs, setUsageLogs] = useState<UsageLogEntry[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsPage, setLogsPage] = useState(0);
  const [usageLoading, setUsageLoading] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsLoaded, setLogsLoaded] = useState(false);
  const [expandedActivity, setExpandedActivity] = useState<UsageActivityKey | null>(null);

  const LOGS_PER_PAGE = 20;
  const mountedRef = useRef(true);
  const liveRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detailLoadTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const convTitleCacheRef = useRef<Record<string, string>>({});
  const autoRefillOpenedRef = useRef<Set<string>>(new Set());
  const [autoRefillPendingUrl, setAutoRefillPendingUrl] = useState<string | null>(null);

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
      supabase
        .from("profiles")
        .select("plan, current_period_start, current_period_end, billing_customer_id, billing_subscription_id, billing_subscription_status")
        .eq("id", user.id)
        .maybeSingle(),
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

    const summary = {
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
      billingCustomerId: (profile as any)?.billing_customer_id || null,
      billingSubscriptionId: (profile as any)?.billing_subscription_id || null,
      billingSubscriptionStatus: (profile as any)?.billing_subscription_status || null,
    } as CreditSummary;

    // Prefer the canonical server summary (GET /v1/credits) for the credit numbers
    // so Billing matches the dashboard Overview exactly. The server applies the
    // free-plan monthly-limit fallback when there's no grant row (the direct
    // Supabase math above collapses grant-less free accounts to 0). Billing IDs
    // stay from the profile row (the endpoint doesn't return them).
    try {
      const apiBase = getApiEndpoint().replace(/\/+$/, "");
      const creditsResp = session?.access_token
        ? await fetch(`${apiBase}/v1/credits`, {
            headers: { Authorization: `Bearer ${session.access_token}`, Accept: "application/json" },
            signal: AbortSignal.timeout(15_000),
          })
        : null;
      const j: any = creditsResp?.ok ? await creditsResp.json().catch(() => null) : null;
      if (j && j.ok) {
        const unlimited = !!j.unlimited;
        summary.plan = String(j.plan || summary.plan);
        summary.unlimited = unlimited;
        summary.limit = unlimited ? 0 : Math.max(0, Math.ceil(Number(j.limit) || 0));
        summary.used = Math.max(0, Math.ceil(Number(j.used) || 0));
        summary.remaining = unlimited ? 0 : Math.max(0, Math.ceil(Number(j.remaining) || 0));
        summary.includedCredits = Math.max(0, Math.ceil(Number(j.includedCredits) || 0));
        summary.includedRemaining = Math.max(0, Math.ceil(Number(j.includedRemaining) || 0));
        summary.addonCredits = Math.max(0, Math.ceil(Number(j.addonCredits) || 0));
        summary.addonRemaining = Math.max(0, Math.ceil(Number(j.addonRemaining) || 0));
        if (j.currentPeriodStart) summary.currentPeriodStart = String(j.currentPeriodStart);
        if (j.currentPeriodEnd) summary.currentPeriodEnd = String(j.currentPeriodEnd);
      }
    } catch { /* offline — keep the local Supabase-derived summary */ }

    return { user, summary };
  }, []);

  const loadBillingPrefs = useCallback(async (uid: string) => {
    if (!BILLING_ADVANCED_SETTINGS_ENABLED) {
      setBillingPrefs(DEFAULT_BILLING_PREFS);
      setPrefsLoading(false);
      return;
    }
    setPrefsLoading(true);
    try {
      const { data, error: prefsError } = await supabase
        .from("profiles")
        .select("auto_refill_enabled, auto_refill_threshold_credits, auto_refill_amount_cents, monthly_budget_cents, hard_spend_limit_cents")
        .eq("id", uid)
        .maybeSingle();
      if (prefsError) throw prefsError;
      if (!mountedRef.current) return;
      setBillingPrefs(billingPrefsFromRow(data));
    } catch {
      if (mountedRef.current) setBillingPrefs(DEFAULT_BILLING_PREFS);
    } finally {
      if (mountedRef.current) setPrefsLoading(false);
    }
  }, []);

  const loadBillingCustomer = useCallback(async (email: string) => {
    setBillingCustomerLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        if (mountedRef.current) setBillingCustomer(null);
        return;
      }

      const apiBase = getApiEndpoint().replace(/\/+$/, "");
      const response = await fetch(
        `${apiBase}/v1/billing/customer?email=${encodeURIComponent(email)}`,
        {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
          signal: AbortSignal.timeout(15_000),
        },
      );
      const result = await response.json().catch(() => null);
      if (!mountedRef.current) return;

      if (response.ok && result?.ok && result.customer?.id) {
        setBillingCustomer(result.customer as BillingCustomerSummary);
      } else {
        setBillingCustomer(null);
      }
    } catch {
      if (mountedRef.current) setBillingCustomer(null);
    } finally {
      if (mountedRef.current) {
        setBillingCustomerLoading(false);
        setBillingCustomerChecked(true);
      }
    }
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
    setBillingPrefs(null);
    setBillingCustomer(null);
    setBillingCustomerChecked(false);

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
      void loadBillingPrefs(user.id);
      if (user.email) void loadBillingCustomer(user.email);
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
  }, [loadCredits, loadUsageBreakdown, loadBillingPrefs, loadBillingCustomer]);

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

  const activityBreakdown = useMemo(
    () => buildUsageActivityBreakdown(usageBreakdown),
    [usageBreakdown],
  );
  const displayTotal = activityBreakdown.reduce((sum, item) => sum + item.credits, 0);

  const currentPlan = (() => {
    const raw = String(creditSummary?.plan || "free").trim().toLowerCase();
    if (raw === "free_trial" || raw === "trial") return "Free";
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  })();
  const planKey = currentPlan.trim().toLowerCase();
  const subscriptionStatus = String(creditSummary?.billingSubscriptionStatus || "").trim().toLowerCase();
  const periodEndsAt = creditSummary?.currentPeriodEnd ? Date.parse(creditSummary.currentPeriodEnd) : 0;
  const hasActivePaidPlan =
    !["", "free", "free_trial", "trial"].includes(planKey) &&
    (
      Number(creditSummary?.includedCredits || 0) > 0 ||
      !Number.isNaN(periodEndsAt) && periodEndsAt > Date.now() ||
      ["active", "trialing", "switching"].includes(subscriptionStatus)
    );
  const hasProfileBilling = Boolean(
    creditSummary?.billingCustomerId ||
    creditSummary?.billingSubscriptionId ||
    ACTIVE_BILLING_STATUSES.has(subscriptionStatus) ||
    hasActivePaidPlan
  );
  const hasPolarBilling = customerHasBillingOnFile(billingCustomer);
  const hasPurchasedAddons = Number(creditSummary?.addonCredits || 0) > 0;
  const hasBillingAccount = Boolean(
    hasProfileBilling ||
    hasPolarBilling ||
    billingCustomer?.id ||
    hasPurchasedAddons
  );
  const showPaymentMethodNeeded = billingCustomerChecked && !hasBillingAccount;

  const pollAutoRefillPending = useCallback(async () => {
    if (!userId) return;
    const prefs = billingPrefs || DEFAULT_BILLING_PREFS;
    if (!prefs.autoRefillEnabled || !hasBillingAccount) {
      setAutoRefillPendingUrl(null);
      return;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;

      const apiBase = getApiEndpoint().replace(/\/+$/, "");
      const response = await fetch(`${apiBase}/v1/billing/auto-refill/pending`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      const result = await response.json().catch(() => null);
      if (!mountedRef.current || !response.ok || !result?.ok) return;

      if (result.pending && result.url) {
        setAutoRefillPendingUrl(result.url);
        const checkoutKey = String(result.checkoutId || result.url);
        if (!autoRefillOpenedRef.current.has(checkoutKey)) {
          autoRefillOpenedRef.current.add(checkoutKey);
          void openExternalUrl(result.url);
        }
      } else {
        setAutoRefillPendingUrl(null);
      }
    } catch {
      // Non-fatal — will retry on next poll.
    }
  }, [userId, billingPrefs, hasBillingAccount]);

  useEffect(() => {
    if (!BILLING_ADVANCED_SETTINGS_ENABLED) return;
    if (!userId || !billingPrefs?.autoRefillEnabled || !hasBillingAccount) return;
    void pollAutoRefillPending();
    const timer = setInterval(() => void pollAutoRefillPending(), 30_000);
    return () => clearInterval(timer);
  }, [userId, billingPrefs?.autoRefillEnabled, hasBillingAccount, pollAutoRefillPending]);

  const remainingCredits = Math.max(0, Number(creditSummary?.remaining || 0));
  const usedCredits = Math.max(0, Number(creditSummary?.used || 0));
  // The profile's `limit` can be a stale/nominal monthly cap that doesn't match
  // the active grants (used + remaining) — surfacing it alongside them made the
  // bar and caption disagree. Derive the period pool from what's actually
  // accounted for so every figure in this card reconciles.
  const accountedTotal =
    usedCredits + remainingCredits > 0
      ? usedCredits + remainingCredits
      : Math.max(0, Number(creditSummary?.limit || 0));
  const usagePercent =
    accountedTotal > 0 ? Math.min(100, Math.round((usedCredits / accountedTotal) * 100)) : 0;
  const usageBarPercent =
    accountedTotal <= 0
      ? 0
      : remainingCredits > 0
        ? Math.min(99.5, (usedCredits / accountedTotal) * 100)
        : 100;
  const creditExhausted = isCreditExhausted(creditSummary);

  const periodResetLabel = (() => {
    const end = creditSummary?.currentPeriodEnd ? Date.parse(creditSummary.currentPeriodEnd) : NaN;
    if (!Number.isFinite(end)) return null;
    const days = Math.ceil((end - Date.now()) / 86_400_000);
    if (days < 0) return null;
    if (days === 0) return "Resets today";
    if (days === 1) return "Resets tomorrow";
    if (days <= 31) return `Resets in ${days} days`;
    return `Resets ${new Date(end).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  })();

  const totalLogsPages = Math.ceil(logsTotal / LOGS_PER_PAGE);

  const handleSaveBillingPrefs = async (next: Partial<BillingPrefs>) => {
    if (!BILLING_ADVANCED_SETTINGS_ENABLED) return;
    if (!userId) return;
    const previous = billingPrefs || DEFAULT_BILLING_PREFS;
    const merged = { ...previous, ...next };
    setBillingPrefs(merged);
    setPrefsSaving(true);
    try {
      const row = billingPrefsToRow(next);
      if (Object.keys(row).length === 0) return;
      const { error: prefsError } = await supabase.from("profiles").update(row).eq("id", userId);
      if (prefsError) throw prefsError;
    } catch (e: any) {
      setBillingPrefs(previous);
      setError(e?.message || "Failed to save billing settings");
    } finally {
      setPrefsSaving(false);
    }
  };

  const buildWebsiteCheckoutUrl = (pack: QuickCreditPack) => {
    const qs = new URLSearchParams({
      products: pack.productId,
      customerEmail: userEmail || "",
      customerExternalId: userId || "",
      metadata: JSON.stringify({ userId, type: "addon", packId: pack.id }),
    });
    return `https://stuard.ai/api/polar/checkout?${qs.toString()}`;
  };

  const handleQuickTopUp = async (pack: QuickCreditPack) => {
    if (!userEmail) return;
    setActionLoading(pack.id);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Missing session token");

      const apiBase = getApiEndpoint().replace(/\/+$/, "");
      const response = await fetch(`${apiBase}/v1/billing/checkout`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ productId: pack.productId }),
        signal: AbortSignal.timeout(15_000),
      });

      const result = await response.json().catch(() => null);
      if (response.ok && result?.ok && result.url) {
        await openExternalUrl(result.url);
      } else {
        await openExternalUrl(buildWebsiteCheckoutUrl(pack));
      }
    } catch (e: any) {
      if (e?.message === "Missing session token") {
        setError(e.message);
      } else {
        await openExternalUrl(buildWebsiteCheckoutUrl(pack));
        return;
      }
    } finally {
      setActionLoading(null);
    }
  };

  const handleOpenWebsiteBilling = async () => {
    setActionLoading("website");
    try {
      await openExternalUrl(WEBSITE_BILLING_URL);
    } catch (e: any) {
      setError(e?.message || "Failed to open billing page");
    } finally {
      setActionLoading(null);
    }
  };

  const handleLoadLogs = () => {
    if (!userId || logsLoading) return;
    void loadLogs(userId, billingPeriodStart, logsPage);
  };

  const prefs = billingPrefs || DEFAULT_BILLING_PREFS;
  const autoRefillDisabled =
    prefsLoading ||
    !billingPrefs ||
    (!hasBillingAccount && (billingCustomerChecked || !userEmail));

  return (
    <div className="space-y-6">
      {/* ── Main Card: Balance + Limits ── */}
      <div className="dashboard-card p-6">
        <BillingSectionHeader title="Billing & Credits" description="Manage your plan, credit balance, and add-ons." />

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
          <div className="space-y-3">
            {/* Hero balance — one source of truth for the period */}
            <div className="rounded-2xl border border-theme bg-[color-mix(in_srgb,var(--sidebar-item-hover)_35%,transparent)] p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-theme bg-theme-card shrink-0">
                    <CreditCard className="w-[18px] h-[18px] text-primary" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[14px] font-semibold text-theme-fg tracking-tight">{currentPlan} plan</span>
                      {periodResetLabel && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border border-theme bg-theme-card text-theme-muted">
                          {periodResetLabel}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-theme-muted mt-0.5">Current billing period</div>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[28px] leading-none font-semibold text-theme-fg tabular-nums">
                    {creditSummary.unlimited ? "Unlimited" : remainingCredits.toLocaleString()}
                  </div>
                  {!creditSummary.unlimited && (
                    <div className="text-[11px] text-theme-muted mt-1.5">credits remaining</div>
                  )}
                </div>
              </div>

              {!creditSummary.unlimited && accountedTotal > 0 && (
                <div className="mt-5">
                  <div className="w-full bg-theme-card rounded-full h-2.5 overflow-hidden border border-theme">
                    <div
                      className={clsx(
                        "h-full rounded-full transition-all",
                        usagePercent >= 90 ? "bg-red-500" : usagePercent >= 70 ? "bg-amber-500" : "bg-primary",
                      )}
                      style={{ width: `${usageBarPercent}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between mt-2 text-[11px] text-theme-muted">
                    <span>
                      <span className="font-semibold text-theme-fg tabular-nums">{usedCredits.toLocaleString()}</span> used
                    </span>
                    <span>
                      <span className="font-semibold text-theme-fg tabular-nums">{remainingCredits.toLocaleString()}</span> remaining
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Where the remaining balance comes from */}
            {!creditSummary.unlimited && (
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-theme bg-theme-card px-4 py-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Shield className="w-4 h-4 text-primary shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold text-theme-fg leading-tight">Subscription</p>
                      <p className="text-[10px] text-theme-muted">credits left</p>
                    </div>
                  </div>
                  <p className="text-[17px] font-semibold text-theme-fg tabular-nums shrink-0">
                    {Number(creditSummary.includedRemaining || 0).toLocaleString()}
                  </p>
                </div>
                <div className="rounded-xl border border-theme bg-theme-card px-4 py-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Coins className="w-4 h-4 text-emerald-500 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold text-theme-fg leading-tight">Add-ons</p>
                      <p className="text-[10px] text-theme-muted">credits left</p>
                    </div>
                  </div>
                  <p className="text-[17px] font-semibold text-theme-fg tabular-nums shrink-0">
                    {Number(creditSummary.addonRemaining || 0).toLocaleString()}
                  </p>
                </div>
              </div>
            )}

            {/* Low-balance nudge */}
            {!creditSummary.unlimited && usagePercent >= 90 && (
              <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                <span className="text-[12px] text-red-500 font-medium leading-snug min-w-0">
                  {creditExhausted
                    ? "You're out of credits. Add a top-up below or upgrade your plan to keep going."
                    : `Almost out — ${remainingCredits.toLocaleString()} credits left this period. Top up below to avoid interruptions.`}
                </span>
              </div>
            )}
            {!creditSummary.unlimited && usagePercent >= 70 && usagePercent < 90 && (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                <span className="text-[12px] text-amber-600 font-medium leading-snug min-w-0">
                  You've used {usagePercent}% of your credits this period.
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Usage Breakdown Card ── */}
      {(usageLoading || usageBreakdown.length > 0) && (
        <div className="dashboard-card p-6">
          <BillingSectionHeader
            title="Where your credits went"
            description="Grouped by what you used this billing period — expand Chat & AI models to see the split by model."
          />

          {usageLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
            </div>
          ) : activityBreakdown.length === 0 || displayTotal <= 0 ? (
            <div className="text-center py-8 rounded-xl border border-theme bg-theme-hover/30">
              <Zap className="w-5 h-5 text-theme-muted mx-auto mb-2" />
              <p className="text-[13px] text-theme-muted font-medium">No usage yet this period.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <UsageCompositionBar rows={activityBreakdown} total={displayTotal} />

              <div className="rounded-xl border border-theme bg-[color-mix(in_srgb,var(--sidebar-item-hover)_30%,transparent)] divide-y divide-theme-sidebar overflow-hidden">
                {activityBreakdown.map((row) => (
                  <UsageActivityRowItem
                    key={row.key}
                    row={row}
                    total={displayTotal}
                    expanded={expandedActivity === row.key}
                    onToggle={() =>
                      setExpandedActivity((prev) => (prev === row.key ? null : row.key))
                    }
                  />
                ))}
              </div>

              <div className="flex items-baseline justify-between px-1">
                <span className="text-[12px] font-semibold text-theme-muted">Total this period</span>
                <span className="text-[15px] font-semibold text-theme-fg tabular-nums">
                  {displayTotal.toFixed(1)} <span className="text-[12px] font-medium text-theme-muted">credits</span>
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Billing Logs Table ── */}
      {(creditSummary || !loading) && (
      <div className="dashboard-card p-6">
        <BillingSectionHeader
          title="Credit usage logs"
          description="Detailed events load on demand so billing stays responsive."
        />

        {!logsLoaded && !logsLoading ? (
          <div className="text-center py-8">
            <Zap className="w-5 h-5 text-theme-muted mx-auto mb-2" />
            <p className="text-xs text-theme-muted font-medium mb-3">Usage logs load separately so Billing stays responsive.</p>
            <button
              onClick={handleLoadLogs}
              disabled={!userId}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[12px] font-semibold text-primary border border-primary/30 hover:bg-primary/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
                      <tr key={log.id} className="border-b border-theme-sidebar hover:bg-theme-hover/50 transition-colors">
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
                          {displayConversationTitle(log.chatName)}
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
      <div className="dashboard-card p-6 space-y-6">
        {!BILLING_ADVANCED_SETTINGS_ENABLED && (
          <div className="rounded-xl border border-theme bg-theme-hover/30 p-5 opacity-50 pointer-events-none select-none">
            <h3 className="text-[15px] font-semibold text-theme-fg tracking-tight">Billing settings</h3>
            <p className="text-[12px] text-theme-muted mt-2 leading-relaxed">
              Auto-refill, metered overage, and spend limits are temporarily unavailable. Use one-time top-ups below or manage your plan on stuard.ai.
            </p>
          </div>
        )}

        {BILLING_ADVANCED_SETTINGS_ENABLED && (
        <>
        <div>
          <div className="flex items-start justify-between gap-3 mb-4 border-b border-theme-sidebar pb-4">
            <div>
              <h3 className="text-[18px] font-semibold font-stuard text-theme-fg tracking-tight">Auto-refill</h3>
              <p className="text-[13px] text-theme-muted font-medium mt-1">Top up automatically when your balance runs low.</p>
            </div>
            {(prefsLoading || prefsSaving) && (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-theme-muted font-medium shrink-0 mt-1">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {prefsSaving ? "Saving" : "Loading"}
              </span>
            )}
          </div>

          <div className={clsx(
            "rounded-xl border p-4 transition-colors",
            prefs.autoRefillEnabled && hasBillingAccount ? "border-primary/20 bg-primary/5" : "border-theme bg-theme-hover/40",
            autoRefillDisabled && "opacity-70",
          )}>
            <div className="flex items-center gap-4">
              <span className={clsx(
                "flex h-9 w-9 items-center justify-center rounded-xl border shrink-0",
                prefs.autoRefillEnabled && hasBillingAccount ? "border-primary/30 bg-primary/10 text-primary" : "border-theme bg-theme-card text-theme-muted",
              )}>
                <RefreshCw className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] font-semibold text-theme-fg tracking-tight">Auto-refill credits</span>
                  {!showPaymentMethodNeeded && billingCustomerLoading && !hasProfileBilling && (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-theme-hover text-theme-muted">
                      Checking payment method...
                    </span>
                  )}
                  {showPaymentMethodNeeded && (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600">
                      Payment method needed
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-theme-muted mt-0.5 leading-relaxed">
                  When credits drop below your threshold, we create a Polar checkout and open it for a quick one-tap confirm.
                </p>
              </div>
              <BillingToggle
                checked={prefs.autoRefillEnabled && hasBillingAccount}
                onChange={(value) => handleSaveBillingPrefs({ autoRefillEnabled: value })}
                disabled={autoRefillDisabled}
              />
            </div>

            <div className={clsx(
              "grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4 pt-4 border-t border-theme-sidebar",
              prefs.autoRefillEnabled && hasBillingAccount ? "" : "opacity-50 pointer-events-none",
            )}>
              <BillingField label="Trigger at" hint="Refill when balance falls below this amount.">
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    step={10}
                    value={prefs.autoRefillThresholdCredits}
                    onChange={(e) => setBillingPrefs({ ...prefs, autoRefillThresholdCredits: Number(e.target.value) })}
                    onBlur={() => handleSaveBillingPrefs({ autoRefillThresholdCredits: prefs.autoRefillThresholdCredits })}
                    className={billingInputClass}
                  />
                  <span className="text-[12px] text-theme-muted font-medium shrink-0">credits</span>
                </div>
              </BillingField>
              <BillingField label="Refill amount" hint="Minimum $5. Uses your existing add-on packs or a custom amount.">
                <div className="flex flex-nowrap items-center gap-2">
                  <span className="text-theme-muted font-medium shrink-0">$</span>
                  <input
                    type="number"
                    min={5}
                    step={1}
                    value={Math.round(prefs.autoRefillAmountCents / 100)}
                    onChange={(e) => setBillingPrefs({ ...prefs, autoRefillAmountCents: Math.max(500, Number(e.target.value) * 100) })}
                    onBlur={() => handleSaveBillingPrefs({ autoRefillAmountCents: prefs.autoRefillAmountCents })}
                    className={billingInputClass}
                  />
                </div>
              </BillingField>
            </div>

            {autoRefillPendingUrl && prefs.autoRefillEnabled && hasBillingAccount && (
              <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
                <p className="text-[12px] text-amber-700 font-medium">
                  Low credits — confirm your auto-refill to add more.
                </p>
                <button
                  type="button"
                  onClick={() => void openExternalUrl(autoRefillPendingUrl)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-amber-800 border border-amber-500/40 hover:bg-amber-500/10 transition-colors shrink-0"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Confirm refill
                </button>
              </div>
            )}

            {showPaymentMethodNeeded && (
              <button
                onClick={handleOpenWebsiteBilling}
                disabled={actionLoading === "website"}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[12px] font-semibold text-primary border border-primary/30 hover:bg-primary/10 disabled:opacity-40 transition-colors"
              >
                {actionLoading === "website" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5" />}
                Connect payment method
              </button>
            )}
          </div>
        </div>

        <div>
          <BillingSectionHeader
            title="Budgets & limits"
            description="Shared with stuard.ai and applied across desktop and web."
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <BillingField label="Monthly soft budget" hint="Leave blank for no soft budget.">
              <div className="flex flex-nowrap items-center gap-2">
                <span className="text-theme-muted font-medium shrink-0">$</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={prefs.monthlyBudgetCents == null ? "" : Math.round(prefs.monthlyBudgetCents / 100)}
                  placeholder="No budget"
                  onChange={(e) => setBillingPrefs({
                    ...prefs,
                    monthlyBudgetCents: e.target.value === "" ? null : Math.max(0, Number(e.target.value) * 100),
                  })}
                  onBlur={() => handleSaveBillingPrefs({ monthlyBudgetCents: prefs.monthlyBudgetCents })}
                  disabled={!billingPrefs}
                  className={billingInputClass}
                />
              </div>
            </BillingField>
            <BillingField label="Hard limit" hint="Leave blank for no hard cap.">
              <div className="flex flex-nowrap items-center gap-2">
                <span className="text-theme-muted font-medium shrink-0">$</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={prefs.hardSpendLimitCents == null ? "" : Math.round(prefs.hardSpendLimitCents / 100)}
                  placeholder="No limit"
                  onChange={(e) => setBillingPrefs({
                    ...prefs,
                    hardSpendLimitCents: e.target.value === "" ? null : Math.max(0, Number(e.target.value) * 100),
                  })}
                  onBlur={() => handleSaveBillingPrefs({ hardSpendLimitCents: prefs.hardSpendLimitCents })}
                  disabled={!billingPrefs}
                  className={billingInputClass}
                />
              </div>
            </BillingField>
          </div>
        </div>
        </>
        )}

        <div>
          <BillingSectionHeader title="One-time top-up" description="Add credits instantly without changing your plan." />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {QUICK_CREDIT_PACKS.map((pack) => (
              <button
                key={pack.id}
                onClick={() => handleQuickTopUp(pack)}
                disabled={!!actionLoading || !userEmail}
                className="rounded-xl border border-theme bg-theme-hover/40 p-4 text-left transition-all hover:bg-theme-hover hover:border-theme disabled:opacity-50 disabled:cursor-not-allowed group"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[18px] font-semibold text-theme-fg group-hover:text-primary transition-colors">
                    {pack.label}
                  </span>
                  {actionLoading === pack.id ? (
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                  ) : (
                    <Plus className="w-4 h-4 text-theme-muted group-hover:text-primary transition-colors" />
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-theme-muted font-medium mt-2">
                  <Coins className="w-3 h-3" />
                  {pack.credits.toLocaleString()} credits
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="pt-4 border-t border-theme-sidebar">
          <button
            onClick={handleOpenWebsiteBilling}
            disabled={actionLoading === "website"}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-theme bg-theme-card text-theme-fg text-[13px] font-semibold hover:bg-theme-hover transition-all"
          >
            {actionLoading === "website" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ExternalLink className="w-4 h-4" />
            )}
            Manage billing on stuard.ai
          </button>
          <p className="text-[11px] text-theme-muted mt-2 leading-relaxed">
            Change your plan, view transaction history, and manage payment methods on the website.
          </p>
        </div>
      </div>
      )}
    </div>
  );
};
