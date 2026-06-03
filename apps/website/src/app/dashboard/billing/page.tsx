'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Coins,
  CreditCard,
  ExternalLink,
  Loader2,
  RefreshCw,
  Sliders,
  Zap,
} from 'lucide-react';

/** Set true to re-enable Settings tab (auto-refill, budgets, metered limits). */
const BILLING_SETTINGS_UI_ENABLED = false;
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { useAuthContext } from '@/components/providers/AuthProvider';
import { getBillingAuthToken } from '@/lib/billingApi';
import { supabase } from '@/lib/supabaseClient';
import {
  categorizeModelForUsage,
  displayModelName,
  formatModel,
  formatRelativeTime,
  getCategoryDisplay,
  getUsageSourceCategory,
  getUsageSourceLabel,
  isNonBillableUsageEvent,
  normalizeUsageLogEntry,
  resolveBillingPeriodStart,
  creditUsageBarPercent,
  creditUsagePercent,
  isCreditExhausted,
  type UsageLogEntry,
} from '@/lib/billingUtils';
import {
  CREDIT_ANCHORS,
  MONTHLY_AMOUNT_MARKERS,
  MONTHLY_AMOUNT_MAX,
  MONTHLY_AMOUNT_MIN,
  TOP_UP_AMOUNTS,
  estimateCredits,
  planTierFromAmount,
  sliderMarkerPercent,
} from '@/lib/creditPricing';
import {
  DEFAULT_ADDON_AMOUNT_CENTS,
  POLAR_ADDON_IDS,
  POLAR_SUBSCRIPTION_ID,
} from '@/lib/polarProducts';

type CreditSummary = {
  ok?: boolean;
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
};

type UsageBreakdownItem = { category: string; credits: number; costUsd: number; count: number };

type BillingPrefs = {
  autoRefillEnabled: boolean;
  autoRefillThresholdCredits: number;
  autoRefillAmountCents: number;
  monthlyBudgetCents: number | null;
  hardSpendLimitCents: number | null;
};

type SubscriptionSummary = {
  id: string;
  status: string;
  amount: number | null;
  currency: string;
  currentPeriodEnd: string | null;
  productId: string | null;
  cancelAtPeriodEnd: boolean;
};

const LOGS_PER_PAGE = 20;

const ADDON_PACKS = TOP_UP_AMOUNTS.map((amount, index) => ({
  id: `addon_${amount}`,
  label: `$${amount}`,
  amount: amount * 100,
  productId: POLAR_ADDON_IDS[amount],
  credits: estimateCredits(amount).toLocaleString(),
  desc: ['Quick top-up', 'Standard pack', 'Popular choice', 'Power pack'][index],
}));

function formatCents(cents: number | null | undefined): string {
  if (cents == null) return '—';
  return `$${(cents / 100).toFixed(2)}`;
}

const PieTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.[0]) return null;
  const { name, value, payload: entry } = payload[0];
  return (
    <div className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 shadow-lg">
      <p className="text-[12px] font-bold text-white">{name}</p>
      <p className="text-[11px] text-neutral-400">
        {Number(value).toFixed(2)} credits ({Number(entry.pct).toFixed(1)}%)
      </p>
    </div>
  );
};

const ModelPieTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.[0]) return null;
  const { name, value, payload: entry } = payload[0];
  return (
    <div className="max-w-[200px] rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 shadow-lg">
      <p className="truncate text-[12px] font-bold text-white">{name}</p>
      <p className="text-[11px] text-neutral-400">{Number(value).toFixed(2)} credits · {Number(entry.pct).toFixed(1)}%</p>
      <p className="text-[11px] text-neutral-500">{entry.count} calls · ${Number(entry.costUsd).toFixed(4)}</p>
    </div>
  );
};

export default function BillingPage() {
  const { user, userData, loading } = useAuthContext();

  const [creditSummary, setCreditSummary] = useState<CreditSummary | null>(null);
  const [creditsLoading, setCreditsLoading] = useState(true);
  const [usageBreakdown, setUsageBreakdown] = useState<UsageBreakdownItem[]>([]);
  const [usageLoading, setUsageLoading] = useState(false);
  const [modelBreakdown, setModelBreakdown] = useState<{ model: string; credits: number; costUsd: number; count: number }[]>([]);
  const [modelLoading, setModelLoading] = useState(false);
  const [usageLogs, setUsageLogs] = useState<UsageLogEntry[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsPage, setLogsPage] = useState(0);
  const [logsLoading, setLogsLoading] = useState(false);
  const [subscription, setSubscription] = useState<SubscriptionSummary | null>(null);
  const [subscriptionLoading, setSubscriptionLoading] = useState(true);

  const [prefs, setPrefs] = useState<BillingPrefs | null>(null);
  const [prefsLoading, setPrefsLoading] = useState(true);
  const [prefsSaving, setPrefsSaving] = useState(false);

  const [amount, setAmount] = useState(30);
  const [addonLoading, setAddonLoading] = useState<string | null>(null);
  const [isManaging, setIsManaging] = useState(false);
  const [isUpdatingSubscription, setIsUpdatingSubscription] = useState(false);
  const [isCancellingSubscription, setIsCancellingSubscription] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'usage' | 'logs' | 'settings'>('overview');

  const mountedRef = useRef(true);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  const currentPlan = useMemo(() => {
    const raw = String(creditSummary?.plan || userData?.plan || 'free').trim().toLowerCase();
    if (raw === 'free_trial' || raw === 'trial') return 'Free';
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }, [creditSummary?.plan, userData?.plan]);

  const billingPeriodStart = typeof creditSummary?.currentPeriodStart === 'string'
    ? creditSummary.currentPeriodStart
    : null;

  const isSubscribed = !!(subscription && subscription.status === 'active' && subscription.id);

  // ---------- Loaders ----------
  const loadCredits = useCallback(async () => {
    if (!user) { setCreditSummary(null); setCreditsLoading(false); return; }
    try {
      setCreditsLoading(true);
      const [{ data: profile }, { data: rawGrants }] = await Promise.all([
        supabase.from('profiles').select('plan, current_period_start, current_period_end').eq('id', user.id).maybeSingle(),
        supabase.from('credit_grants').select('source_type, total_credits, remaining_credits, expires_at').eq('user_id', user.id),
      ]);
      if (!mountedRef.current) return;

      const now = Date.now();
      let includedCredits = 0, includedRemaining = 0, addonCredits = 0, addonRemaining = 0;
      for (const g of rawGrants || []) {
        if (g.expires_at && Date.parse(g.expires_at) <= now) continue;
        const tc = Number(g.total_credits) || 0;
        const tr = Number(g.remaining_credits) || 0;
        if (String(g.source_type || '').toLowerCase() === 'subscription_cycle') {
          includedCredits += tc; includedRemaining += tr;
        } else {
          addonCredits += tc; addonRemaining += tr;
        }
      }

      const periodStart = profile?.current_period_start
        ? new Date(profile.current_period_start)
        : new Date(new Date().getFullYear(), new Date().getMonth(), 1);

      const { data: periodEvents } = await supabase
        .from('usage_events')
        .select('model, credit_cost, raw')
        .eq('user_id', user.id)
        .gte('created_at', periodStart.toISOString());

      let used = 0;
      for (const e of periodEvents || []) {
        if (isNonBillableUsageEvent({ model: (e as any).model, raw: (e as any).raw })) continue;
        used += Number((e as any).credit_cost) || 0;
      }

      if (!mountedRef.current) return;
      setCreditSummary({
        ok: true,
        plan: String(profile?.plan || 'Free'),
        limit: Math.ceil(includedCredits + addonCredits),
        used: Math.ceil(used),
        remaining: Math.ceil(includedRemaining + addonRemaining),
        unlimited: false,
        includedCredits: Math.ceil(includedCredits),
        includedRemaining: Math.ceil(includedRemaining),
        addonCredits: Math.ceil(addonCredits),
        addonRemaining: Math.ceil(addonRemaining),
        creditsPerUsd: 33,
        currentPeriodStart: profile?.current_period_start || periodStart.toISOString(),
        currentPeriodEnd: profile?.current_period_end || null,
      });
    } catch (e: any) {
      if (mountedRef.current) setError('Could not load credit balance.');
    } finally {
      if (mountedRef.current) setCreditsLoading(false);
    }
  }, [user]);

  const loadUsage = useCallback(async () => {
    if (!user) return;
    setUsageLoading(true);
    try {
      const since = resolveBillingPeriodStart(billingPeriodStart);
      const { data } = await supabase
        .from('usage_events')
        .select('model, cost_usd, credit_cost, raw')
        .eq('user_id', user.id)
        .gte('created_at', since.toISOString());
      if (!mountedRef.current) return;
      const buckets: Record<string, { credits: number; costUsd: number; count: number }> = {};
      for (const row of data || []) {
        if (isNonBillableUsageEvent({ model: (row as any).model, raw: (row as any).raw })) continue;
        const category = categorizeModelForUsage(String((row as any).model || 'unknown'));
        if (!buckets[category]) buckets[category] = { credits: 0, costUsd: 0, count: 0 };
        buckets[category].credits += Number((row as any).credit_cost) || 0;
        buckets[category].costUsd += Number((row as any).cost_usd) || 0;
        buckets[category].count += 1;
      }
      setUsageBreakdown(
        Object.entries(buckets).map(([category, v]) => ({
          category,
          credits: Number(v.credits.toFixed(2)),
          costUsd: Number(v.costUsd.toFixed(6)),
          count: v.count,
        })),
      );
    } finally {
      if (mountedRef.current) setUsageLoading(false);
    }
  }, [user, billingPeriodStart]);

  const loadModelBreakdown = useCallback(async () => {
    if (!user) return;
    setModelLoading(true);
    try {
      const since = resolveBillingPeriodStart(billingPeriodStart);
      const { data } = await supabase
        .from('usage_events')
        .select('model, cost_usd, credit_cost, raw')
        .eq('user_id', user.id)
        .gte('created_at', since.toISOString());
      if (!mountedRef.current) return;
      const buckets: Record<string, { credits: number; costUsd: number; count: number }> = {};
      for (const row of data || []) {
        if (isNonBillableUsageEvent({ model: (row as any).model, raw: (row as any).raw })) continue;
        const model = String((row as any).model || 'unknown');
        if (
          model.startsWith('voice:') || model.startsWith('messaging:') ||
          model.startsWith('compute') || model.startsWith('storage') ||
          model === 'telnyx' || model === 'sms' || model === 'whatsapp'
        ) continue;
        if (!buckets[model]) buckets[model] = { credits: 0, costUsd: 0, count: 0 };
        buckets[model].credits += Number((row as any).credit_cost) || 0;
        buckets[model].costUsd += Number((row as any).cost_usd) || 0;
        buckets[model].count += 1;
      }
      setModelBreakdown(
        Object.entries(buckets)
          .map(([model, v]) => ({
            model,
            credits: Number(v.credits.toFixed(2)),
            costUsd: Number(v.costUsd.toFixed(6)),
            count: v.count,
          }))
          .sort((a, b) => b.credits - a.credits),
      );
    } finally {
      if (mountedRef.current) setModelLoading(false);
    }
  }, [user, billingPeriodStart]);

  const loadLogs = useCallback(async (page: number) => {
    if (!user) return;
    setLogsLoading(true);
    try {
      const since = resolveBillingPeriodStart(billingPeriodStart);
      const fetchLimit = Math.max(LOGS_PER_PAGE * 8, 200);
      const { data } = await supabase
        .from('usage_events')
        .select('id, model, prompt_tokens, completion_tokens, total_tokens, cost_usd, credit_cost, conversation_id, raw, created_at')
        .eq('user_id', user.id)
        .gte('created_at', since.toISOString())
        .order('created_at', { ascending: false })
        .limit(fetchLimit);
      if (!mountedRef.current) return;

      const groups = new Map<string, any>();
      for (const row of data || []) {
        const raw = (row as any).raw && typeof (row as any).raw === 'object' ? (row as any).raw : {};
        if (isNonBillableUsageEvent({ model: (row as any).model, raw })) continue;
        const key = raw.sourceRef || raw.source_ref || (row as any).id;
        if (!groups.has(key)) {
          groups.set(key, {
            id: key, source_ref: key, model: (row as any).model,
            conversation_id: (row as any).conversation_id,
            source_type: raw.sourceType || raw.source_type || null,
            source_label: raw.source_label || raw.sourceLabel || null,
            subagent_kind: raw.subagentKind || raw.subagent_kind || null,
            prompt_tokens: 0, completion_tokens: 0, total_tokens: 0,
            cost_usd: 0, credit_cost: 0, step_count: 0, created_at: (row as any).created_at,
          });
        }
        const g = groups.get(key)!;
        g.prompt_tokens += Number((row as any).prompt_tokens || 0);
        g.completion_tokens += Number((row as any).completion_tokens || 0);
        g.total_tokens += Number((row as any).total_tokens || 0);
        g.cost_usd += Number((row as any).cost_usd || 0);
        g.credit_cost += Number((row as any).credit_cost || 0);
        g.step_count += 1;
        if ((row as any).created_at > g.created_at) g.created_at = (row as any).created_at;
      }
      const allGroups = Array.from(groups.values()).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      const logs = allGroups.slice(page * LOGS_PER_PAGE, (page + 1) * LOGS_PER_PAGE).map(normalizeUsageLogEntry);
      setUsageLogs(logs);
      setLogsTotal(allGroups.length);
      setLogsPage(page);
    } finally {
      if (mountedRef.current) setLogsLoading(false);
    }
  }, [user, billingPeriodStart]);

  const loadPrefs = useCallback(async () => {
    if (!BILLING_SETTINGS_UI_ENABLED) {
      setPrefsLoading(false);
      return;
    }
    if (!user) { setPrefsLoading(false); return; }
    setPrefsLoading(true);
    try {
      const token = await getBillingAuthToken();
      if (!token) return;
      const res = await fetch('/api/billing/prefs', {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (!mountedRef.current) return;
      setPrefs({
        autoRefillEnabled: Boolean(data.autoRefillEnabled),
        autoRefillThresholdCredits: Number(data.autoRefillThresholdCredits) || 100,
        autoRefillAmountCents: Number(data.autoRefillAmountCents) || DEFAULT_ADDON_AMOUNT_CENTS,
        monthlyBudgetCents: data.monthlyBudgetCents,
        hardSpendLimitCents: data.hardSpendLimitCents,
      });
    } catch {
      // network error or timeout — fall through to "could not load" state
    } finally {
      if (mountedRef.current) setPrefsLoading(false);
    }
  }, [user]);

  const loadSubscription = useCallback(async () => {
    if (!user) { setSubscriptionLoading(false); return; }
    setSubscriptionLoading(true);
    try {
      const token = await getBillingAuthToken();
      if (!token) { setSubscriptionLoading(false); return; }
      const res = await fetch('/api/polar/subscription', {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) { setSubscriptionLoading(false); return; }
      const data = await res.json();
      if (!mountedRef.current) return;
      setSubscription(data?.subscription || null);
      if (data?.subscription?.amount) setAmount(Math.round(data.subscription.amount / 100));
    } catch {
      // network error or timeout — leave subscription unset
    } finally {
      if (mountedRef.current) setSubscriptionLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadCredits();
  }, [loadCredits]);

  useEffect(() => {
    if (loading) return;
    loadPrefs();
    loadSubscription();
  }, [loading, loadPrefs, loadSubscription]);

  useEffect(() => {
    if (!creditSummary) return;
    loadUsage();
    loadModelBreakdown();
    loadLogs(0);
  }, [creditSummary, loadUsage, loadModelBreakdown, loadLogs]);

  // Realtime refresh on usage events / credit grant changes
  useEffect(() => {
    if (!user) return;
    const scheduleRefresh = () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => {
        loadCredits();
        loadUsage();
        loadModelBreakdown();
        loadLogs(logsPage);
      }, 400);
    };
    const channel = supabase
      .channel(`billing-live:${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'usage_events', filter: `user_id=eq.${user.id}` }, scheduleRefresh)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'credit_grants', filter: `user_id=eq.${user.id}` }, scheduleRefresh)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'credit_grants', filter: `user_id=eq.${user.id}` }, scheduleRefresh)
      .subscribe();
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      void supabase.removeChannel(channel);
    };
  }, [user, logsPage, loadCredits, loadUsage, loadModelBreakdown, loadLogs]);

  // ---------- Derived ----------
  const usageTotal = usageBreakdown.reduce((s, b) => s + b.credits, 0);
  const usagePercent = creditUsagePercent(creditSummary);
  const usageBarPercent = creditUsageBarPercent(creditSummary);
  const creditExhausted = isCreditExhausted(creditSummary);

  const pieData = usageBreakdown
    .filter((item) => item.credits > 0)
    .map((item) => {
      const cfg = getCategoryDisplay(item.category);
      const pct = usageTotal > 0 ? Number(((item.credits / usageTotal) * 100).toFixed(1)) : 0;
      return { name: cfg.label, value: item.credits, pct, fill: cfg.hex };
    });

  const totalLogsPages = Math.max(1, Math.ceil(logsTotal / LOGS_PER_PAGE));

  const MODEL_PIE_COLORS = [
    '#3b82f6', '#da7756', '#10a37f', '#6366f1', '#06b6d4', '#f59e0b',
    '#8b5cf6', '#10b981', '#0ea5e9', '#d946ef', '#84cc16', '#fb7185',
  ];
  const modelTotal = modelBreakdown.reduce((s, b) => s + b.credits, 0);
  const modelPieData = modelBreakdown.slice(0, 8).map((item, i) => ({
    name: displayModelName(item.model),
    value: item.credits,
    pct: modelTotal > 0 ? Number(((item.credits / modelTotal) * 100).toFixed(1)) : 0,
    fill: MODEL_PIE_COLORS[i % MODEL_PIE_COLORS.length],
    count: item.count,
    costUsd: item.costUsd,
    rawModel: item.model,
  }));

  const tier = useMemo(() => {
    switch (planTierFromAmount(amount)) {
      case 'power': return { name: 'Best rate', badge: '🐋 Most credits/dollar', color: 'text-amber-600' };
      case 'pro': return { name: 'Better rate', badge: 'More credits/dollar', color: 'text-gray-900' };
      default: return { name: 'Base rate', badge: 'Standard credits/dollar', color: 'text-gray-600' };
    }
  }, [amount]);

  const credits = useMemo(() => estimateCredits(amount), [amount]);

  // ---------- Actions ----------
  const handleCheckoutSubscription = () => {
    setError(null);
    if (!user) { setError('Please sign in to continue.'); return; }
    const metadata = JSON.stringify({ userId: user.id });
    const qs = new URLSearchParams({
      products: POLAR_SUBSCRIPTION_ID,
      customerEmail: user.email || '',
      customerExternalId: user.id,
      metadata,
      amount: String(Math.round(amount * 100)),
    });
    window.location.href = `/api/polar/checkout?${qs.toString()}`;
  };

  const handleAddonPurchase = (pack: typeof ADDON_PACKS[number]) => {
    setError(null);
    if (!user) { setError('Please sign in first.'); return; }
    if (!pack.productId) { setError('This pack is not available.'); return; }
    setAddonLoading(pack.id);
    const metadata = JSON.stringify({ userId: user.id, type: 'addon', packId: pack.id });
    const qs = new URLSearchParams({
      products: pack.productId,
      customerEmail: user.email || '',
      customerExternalId: user.id,
      metadata,
    });
    window.location.href = `/api/polar/checkout?${qs.toString()}`;
  };

  const handleUpdateSubscriptionAmount = async () => {
    setError(null);
    setIsUpdatingSubscription(true);
    try {
      const token = await getBillingAuthToken();
      if (!token) { setError('Missing session token.'); return; }
      const res = await fetch('/api/polar/subscription', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: Math.round(amount * 100) }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data?.message || data?.error || 'Failed to update amount.'); return; }
      // Polar's API doesn't allow updating the PWYW amount on an active
      // subscription, so the API responds with a fresh checkout URL for the
      // new amount. The webhook revokes the previous subscription once the
      // new one becomes active, so the user is never double-billed.
      if (data?.url) {
        window.location.href = data.url;
        return;
      }
      await loadSubscription();
      await loadCredits();
    } catch (e: any) {
      setError(e?.message || 'Failed to update amount.');
    } finally {
      setIsUpdatingSubscription(false);
    }
  };

  const handleManagePortal = async () => {
    setError(null);
    if (!user) { setError('Please sign in.'); return; }
    setIsManaging(true);
    try {
      const token = await getBillingAuthToken();
      if (!token) { setError('Missing session token.'); return; }
      const res = await fetch('/api/polar/portal', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!res.ok) { setError(data?.error || 'Failed to open portal.'); return; }
      if (data?.url) { window.location.href = data.url; return; }
      setError('No portal URL returned.');
    } finally {
      setIsManaging(false);
    }
  };

  const handleCancelSubscription = async () => {
    setError(null);
    setIsCancellingSubscription(true);
    try {
      const token = await getBillingAuthToken();
      if (!token) { setError('Missing session token.'); return; }
      const res = await fetch('/api/polar/subscription', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) { setError(data?.message || data?.error || 'Failed to cancel subscription.'); return; }
      setShowCancelConfirm(false);
      await loadSubscription();
    } catch (e: any) {
      setError(e?.message || 'Failed to cancel subscription.');
    } finally {
      setIsCancellingSubscription(false);
    }
  };

  const handleSavePrefs = async (next: Partial<BillingPrefs>) => {
    if (!BILLING_SETTINGS_UI_ENABLED) return;
    if (!prefs) return;
    const merged = { ...prefs, ...next };
    setPrefs(merged);
    setPrefsSaving(true);
    try {
      const token = await getBillingAuthToken();
      if (!token) { setError('Missing session token.'); return; }
      await fetch('/api/billing/prefs', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
    } finally {
      setPrefsSaving(false);
    }
  };

  // ---------- Render ----------
  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="dash-page-title">Billing & Credits</h1>
        <p className="dash-page-subtitle">Manage your subscription, credits, and usage.</p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <div className="flex items-center gap-2 ml-4">
            <button onClick={() => { setError(null); loadCredits(); }} className="underline font-medium">retry</button>
            <button onClick={() => setError(null)} className="underline">dismiss</button>
          </div>
        </div>
      )}

      {/* Balance card */}
      {creditsLoading && !creditSummary ? (
        <div className="dash-card p-6 animate-pulse">
          <div className="h-3 w-20 bg-gray-200 rounded mb-2" />
          <div className="h-8 w-32 bg-gray-200 rounded mb-1" />
          <div className="h-3 w-48 bg-gray-200 rounded" />
        </div>
      ) : creditSummary ? (
        <div className="dash-card p-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-5">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-lg bg-gray-900">
                <CreditCard className="w-5 h-5 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-[12px] font-medium text-gray-500 uppercase tracking-wide">Current Balance</p>
                  {!subscriptionLoading && isSubscribed && !subscription?.cancelAtPeriodEnd && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-[10px] font-semibold text-emerald-700">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                      Subscribed
                    </span>
                  )}
                  {!subscriptionLoading && subscription?.cancelAtPeriodEnd && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-[10px] font-semibold text-amber-700">
                      Cancels {subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd).toLocaleDateString() : 'at period end'}
                    </span>
                  )}
                </div>
                <p className="text-3xl font-bold text-gray-900">
                  {creditSummary.unlimited ? 'Unlimited' : Number(creditSummary.remaining || 0).toLocaleString()}
                  {!creditSummary.unlimited && <span className="text-sm font-medium text-gray-400 ml-2">credits</span>}
                </p>
                <p className="text-[12px] text-gray-500 mt-0.5">
                  <span className="font-semibold text-gray-700">{currentPlan}</span>
                  {isSubscribed && subscription?.amount != null && (
                    <span className="ml-2">· {formatCents(subscription.amount)}/mo</span>
                  )}
                </p>
              </div>
            </div>
            <button
              onClick={handleManagePortal}
              disabled={!user || isManaging || loading}
              className="dash-card-button dash-card-button--ghost !flex-none px-4 py-2.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isManaging ? 'Loading...' : 'Manage in Polar'}
            </button>
          </div>

          {!creditSummary.unlimited && creditSummary.limit && creditSummary.limit > 0 && (
            <div className="mt-5">
              <div className="flex justify-between text-[12px] text-gray-500 mb-1.5">
                <span>{Number(creditSummary.used || 0).toLocaleString()} used</span>
                <span>{Number(creditSummary.limit).toLocaleString()} total</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2.5">
                <div
                  className={`h-2.5 rounded-full transition-all ${usagePercent >= 90 ? 'bg-red-500' : usagePercent >= 70 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                  style={{ width: `${usageBarPercent}%` }}
                />
              </div>
            </div>
          )}

          <div className="mt-5 pt-5 border-t border-gray-100 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-gray-50 rounded-lg px-4 py-3">
              <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Available</p>
              <p className="text-xl font-semibold text-gray-900 mt-0.5">
                {creditSummary.unlimited ? 'Unlimited' : Number(creditSummary.remaining || 0).toLocaleString()}
              </p>
            </div>
            <div className="bg-gray-50 rounded-lg px-4 py-3">
              <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Subscription pool</p>
              <p className="text-xl font-semibold text-gray-900 mt-0.5">
                {Number(creditSummary.includedRemaining || 0).toLocaleString()}
              </p>
            </div>
            <div className="bg-gray-50 rounded-lg px-4 py-3">
              <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Add-on pool</p>
              <p className="text-xl font-semibold text-gray-900 mt-0.5">
                {Number(creditSummary.addonRemaining || 0).toLocaleString()}
              </p>
            </div>
          </div>

          {usagePercent >= 70 && (
            <div className={`mt-4 p-3 rounded-lg flex items-start gap-2 ${usagePercent >= 90 ? 'bg-red-50 border border-red-200' : 'bg-amber-50 border border-amber-200'}`}>
              <AlertCircle className={`w-4 h-4 flex-shrink-0 mt-0.5 ${usagePercent >= 90 ? 'text-red-500' : 'text-amber-500'}`} />
              <span className={`text-[12px] font-medium leading-snug min-w-0 ${usagePercent >= 90 ? 'text-red-700' : 'text-amber-700'}`}>
                {creditExhausted
                  ? 'Credit limit reached. Top up or upgrade to keep going.'
                  : `You've used ${usagePercent}% of this period's credits (${Number(creditSummary?.remaining || 0).toLocaleString()} remaining).`}
              </span>
            </div>
          )}
        </div>
      ) : null}

      {/* Tabs */}
      <div className="flex gap-1 bg-neutral-900/70 border border-neutral-800 rounded-lg p-1 w-fit overflow-x-auto">
        {([
          ['overview', 'Overview'],
          ['usage', 'Usage'],
          ['logs', 'History'],
          ['settings', 'Settings'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => id !== 'settings' && setActiveTab(id)}
            disabled={id === 'settings'}
            title={id === 'settings' ? 'Coming soon' : undefined}
            className={`px-4 py-2 text-[13px] font-medium rounded-md transition-colors whitespace-nowrap ${
              id === 'settings'
                ? 'text-neutral-600 cursor-not-allowed opacity-50'
                : activeTab === id
                  ? 'bg-neutral-800 text-white shadow-sm border border-neutral-700'
                  : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ---------- Overview tab ---------- */}
      {activeTab === 'overview' && (
        <>
          {/* Usage snapshot (top 3 categories + mini pie) */}
          {(usageLoading || usageBreakdown.length > 0) && (
            <div className="dash-card p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-[15px] font-semibold text-gray-900">Usage this period</h2>
                  <p className="text-[12px] text-gray-500">
                    {usageTotal.toFixed(1)} credits used across {usageBreakdown.reduce((s, b) => s + b.count, 0)} events.
                  </p>
                </div>
                <button
                  onClick={() => setActiveTab('usage')}
                  className="text-[12px] font-medium text-gray-500 hover:text-gray-900"
                >
                  See all →
                </button>
              </div>
              {usageLoading && usageBreakdown.length === 0 ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                </div>
              ) : usageBreakdown.length === 0 ? (
                <p className="text-[13px] text-gray-400">No usage yet this period.</p>
              ) : (
                <div className="flex flex-col sm:flex-row gap-5 items-center">
                  {pieData.length > 0 && (
                    <div className="flex-shrink-0 w-[160px] h-[160px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={pieData}
                            cx="50%"
                            cy="50%"
                            innerRadius={42}
                            outerRadius={70}
                            paddingAngle={2}
                            dataKey="value"
                            nameKey="name"
                            strokeWidth={0}
                            labelLine={false}
                          >
                            {pieData.map((entry, i) => (
                              <Cell key={`cell-${i}`} fill={entry.fill} />
                            ))}
                          </Pie>
                          <Tooltip content={<PieTooltip />} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                  <div className="flex-1 w-full space-y-1.5">
                    {usageBreakdown
                      .slice()
                      .sort((a, b) => b.credits - a.credits)
                      .slice(0, 4)
                      .map((item) => {
                        const cfg = getCategoryDisplay(item.category);
                        const pct = usageTotal > 0 ? ((item.credits / usageTotal) * 100).toFixed(1) : '0';
                        return (
                          <div key={item.category} className="flex items-center justify-between text-[12px]">
                            <div className="flex items-center gap-2">
                              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cfg.hex }} />
                              <span className="font-medium text-gray-700">{cfg.label}</span>
                              <span className="text-gray-400">({item.count})</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-gray-400 tabular-nums">{pct}%</span>
                              <span className="font-semibold text-gray-900 tabular-nums w-14 text-right">
                                {item.credits.toFixed(1)}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Subscription picker */}
          <div id="plans" className="dash-card p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <h2 className="text-[15px] font-semibold text-gray-900">
                    {isSubscribed ? 'Your monthly amount' : 'Choose your monthly amount'}
                  </h2>
                  {subscriptionLoading ? (
                    <span className="inline-block h-5 w-24 rounded-full bg-gray-100 animate-pulse" />
                  ) : isSubscribed ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-[11px] font-semibold text-emerald-700">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                      Active · {formatCents(subscription!.amount)}/mo
                    </span>
                  ) : null}
                </div>
                <p className="text-[12px] text-gray-500">
                  Pay what you want — not a plan. Higher amounts get more credits per dollar.
                </p>
              </div>
            </div>

            {subscription?.cancelAtPeriodEnd && (
              <div className="mb-4 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                  <span className="text-[13px] text-amber-800">
                    Subscription cancels at the end of this billing period
                    {subscription.currentPeriodEnd ? ` (${new Date(subscription.currentPeriodEnd).toLocaleDateString()})` : ''}.
                  </span>
                </div>
                <button
                  onClick={handleManagePortal}
                  disabled={isManaging}
                  className="ml-4 text-[12px] font-medium text-amber-700 underline whitespace-nowrap"
                >
                  {isManaging ? 'Loading…' : 'Resume →'}
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
              <div className="lg:col-span-3">
                <div className="rounded-lg border border-gray-100 bg-gray-50 p-5">
                  <div className="flex items-end justify-between mb-1">
                    <div>
                      <p className="text-[12px] text-gray-500">Your price</p>
                      <p className="text-3xl font-bold text-gray-900">{`$${amount}`}</p>
                      <p className="text-[12px] text-gray-500">per month</p>
                    </div>
                    <div className="text-right">
                      <p className={`text-xl font-semibold ${tier.color}`}>{tier.name}</p>
                      <span className="inline-flex mt-1 px-2 py-0.5 rounded-full bg-gray-900 text-[11px] font-medium text-white">
                        {tier.badge}
                      </span>
                    </div>
                  </div>
                  <div className="mt-5">
                    <input
                      type="range"
                      min={MONTHLY_AMOUNT_MIN}
                      max={MONTHLY_AMOUNT_MAX}
                      step={1}
                      value={amount}
                      onChange={(e) => setAmount(Number(e.target.value))}
                      className="w-full accent-gray-900"
                    />
                    <div className="relative mt-1 h-4 text-[11px] text-gray-400">
                      {MONTHLY_AMOUNT_MARKERS.map((marker) => {
                        const percent = sliderMarkerPercent(marker);
                        const translateX = percent === 0 ? '0%' : percent === 100 ? '-100%' : '-50%';
                        return (
                          <span
                            key={marker}
                            className="absolute top-0 whitespace-nowrap"
                            style={{ left: `${percent}%`, transform: `translateX(${translateX})` }}
                          >
                            {`$${marker}`}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 mt-4">
                  {[5, 10, 30, 60, 100].map((preset) => (
                    <button
                      key={preset}
                      onClick={() => setAmount(preset)}
                      className={`rounded-lg border px-3.5 py-2 text-[13px] font-medium transition-colors ${
                        amount === preset
                          ? 'border-gray-900 bg-gray-900 text-white'
                          : 'border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      {`$${preset}`}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 rounded-xl border border-gray-100 bg-gray-50 p-4">
                  {CREDIT_ANCHORS.slice(0, 4).map((anchor) => (
                    <div key={anchor.amount}>
                      <p className="text-[10px] uppercase tracking-wide text-gray-400">{`$${anchor.amount}/mo`}</p>
                      <p className="text-[13px] font-semibold text-gray-900 mt-1">{anchor.credits.toLocaleString()} credits</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="lg:col-span-2 flex flex-col">
                <div className="rounded-lg bg-gray-900 p-5 text-white mb-5">
                  <p className="text-[12px] text-gray-400">Monthly credits</p>
                  <p className="text-3xl font-bold mt-0.5">{credits.toLocaleString()}</p>
                  <p className="text-[12px] text-gray-400 mt-1">{`$${amount}/mo · credits roll over 30 days`}</p>
                </div>
                <div className="space-y-3 text-[13px] mb-5">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Credit rollover</span>
                    <span className="font-medium text-gray-900">30 days</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Change anytime</span>
                    <span className="font-medium text-gray-900">Instant</span>
                  </div>
                </div>
                <div className="mt-auto space-y-2">
                  {isSubscribed ? (
                    <>
                      <button
                        onClick={handleUpdateSubscriptionAmount}
                        disabled={isUpdatingSubscription || (subscription?.amount === Math.round(amount * 100))}
                        className="w-full py-2.5 text-[13px] font-medium text-white bg-gray-900 rounded-lg hover:bg-black transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {isUpdatingSubscription ? 'Redirecting…' : subscription?.amount === Math.round(amount * 100) ? `Current amount — $${amount}/mo` : `Switch to $${amount}/mo`}
                      </button>
                      {subscription?.amount !== Math.round(amount * 100) && (
                        <p className="text-[11px] text-gray-400 text-center">
                          Switches take effect immediately at checkout. Credits already in your balance carry over.
                        </p>
                      )}
                      {!subscription?.cancelAtPeriodEnd && (
                        <>
                          {showCancelConfirm ? (
                            <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-2">
                              <p className="text-[12px] text-red-700">Cancel your subscription? You keep access until the end of this billing period.</p>
                              <div className="flex gap-2">
                                <button
                                  onClick={handleCancelSubscription}
                                  disabled={isCancellingSubscription}
                                  className="flex-1 py-1.5 text-[12px] font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                                >
                                  {isCancellingSubscription ? 'Cancelling…' : 'Yes, cancel'}
                                </button>
                                <button
                                  onClick={() => setShowCancelConfirm(false)}
                                  className="dash-card-button dash-card-button--ghost flex-1 py-1.5 text-[12px]"
                                >
                                  Never mind
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              onClick={() => setShowCancelConfirm(true)}
                              className="w-full py-2 text-[12px] font-medium text-gray-400 hover:text-red-600 transition-colors"
                            >
                              Cancel subscription
                            </button>
                          )}
                        </>
                      )}
                    </>
                  ) : (
                    <button
                      onClick={handleCheckoutSubscription}
                      disabled={!user || loading}
                      className="w-full py-2.5 text-[13px] font-medium text-white bg-gray-900 rounded-lg hover:bg-black transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {`Subscribe $${amount}/mo`}
                    </button>
                  )}
                  {!isSubscribed && (
                    <p className="text-[11px] text-gray-400 text-center">Minimum $5/month. Cancel anytime.</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Add-on top-up */}
          <div className="dash-card p-6">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-[15px] font-semibold text-gray-900">Top up credits</h2>
                <p className="text-[12px] text-gray-500">One-time add-on packs. Credits never expire while your account is active.</p>
              </div>
              <Coins className="w-5 h-5 text-gray-400" />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {ADDON_PACKS.map((pack) => (
                <button
                  key={pack.id}
                  onClick={() => handleAddonPurchase(pack)}
                  disabled={!user || !!addonLoading}
                  className="p-4 rounded-xl border border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-all text-left group disabled:opacity-50"
                >
                  <div className="text-xl font-bold text-gray-900 group-hover:text-primary transition-colors">{pack.label}</div>
                  <div className="text-[12px] text-gray-500 mt-0.5">{pack.credits} credits</div>
                  <div className="text-[11px] text-gray-400 mt-1">{pack.desc}</div>
                  {addonLoading === pack.id && (
                    <div className="text-[11px] text-primary mt-1 font-medium">Redirecting…</div>
                  )}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ---------- Usage tab (pie + breakdown) ---------- */}
      {activeTab === 'usage' && (
        <div className="dash-card p-6">
          <h2 className="text-[15px] font-semibold text-gray-900 mb-4">Usage this period</h2>

          {usageLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
            </div>
          ) : usageBreakdown.length === 0 ? (
            <div className="text-center py-10">
              <Zap className="w-5 h-5 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-400">No usage yet this period.</p>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row gap-6">
              {pieData.length > 0 && (
                <div className="flex-shrink-0 w-full sm:w-[240px] h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={95}
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

              <div className="flex-1 space-y-1.5">
                {usageBreakdown.map((item) => {
                  const cfg = getCategoryDisplay(item.category);
                  const pct = usageTotal > 0 ? ((item.credits / usageTotal) * 100).toFixed(1) : '0';
                  return (
                    <div
                      key={item.category}
                      className="flex items-center justify-between px-3 py-2 rounded-lg"
                      style={{ backgroundColor: `${cfg.hex}0d` }}
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cfg.hex }} />
                        <span className="text-[13px] font-semibold text-gray-900">{cfg.label}</span>
                        <span className="text-[11px] text-gray-400">
                          {item.count} {item.count === 1 ? 'call' : 'calls'}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span
                          className="text-[10px] font-bold px-1.5 py-0.5 rounded-md"
                          style={{ backgroundColor: `${cfg.hex}18`, color: cfg.hex }}
                        >
                          {pct}%
                        </span>
                        <span className="text-[13px] font-bold text-gray-900 w-14 text-right tabular-nums">
                          {item.credits.toFixed(1)}
                        </span>
                      </div>
                    </div>
                  );
                })}
                <div className="flex items-center justify-between px-3 pt-2 mt-1 border-t border-gray-200">
                  <span className="text-[12px] font-bold text-gray-500">Total</span>
                  <span className="text-[13px] font-bold text-gray-900 w-14 text-right tabular-nums">{usageTotal.toFixed(1)}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---------- Model analytics (inside Usage tab, below category breakdown) ---------- */}
      {activeTab === 'usage' && (
        <div className="dash-card p-6">
          <h2 className="text-[15px] font-semibold text-gray-900 mb-1">Model Breakdown</h2>
          <p className="text-[12px] text-gray-400 mb-4">Credit usage by model this billing period.</p>

          {modelLoading && modelBreakdown.length === 0 ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
            </div>
          ) : modelBreakdown.length === 0 ? (
            <div className="text-center py-10">
              <Zap className="w-5 h-5 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-400">No model usage yet this period.</p>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row gap-6">
              {modelPieData.length > 0 && (
                <div className="flex-shrink-0 w-full sm:w-[240px] h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={modelPieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={95}
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
                          if (displayPct < 6) return null;
                          return (
                            <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={700}>
                              {displayPct}%
                            </text>
                          );
                        }}
                        labelLine={false}
                      >
                        {modelPieData.map((entry, index) => (
                          <Cell key={`model-cell-${index}`} fill={entry.fill} />
                        ))}
                      </Pie>
                      <Tooltip content={<ModelPieTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}

              <div className="flex-1 space-y-1.5 min-w-0">
                {modelBreakdown.map((item, i) => {
                  const fill = MODEL_PIE_COLORS[i % MODEL_PIE_COLORS.length];
                  const pct = modelTotal > 0 ? ((item.credits / modelTotal) * 100).toFixed(1) : '0';
                  const name = displayModelName(item.model);
                  return (
                    <div
                      key={item.model}
                      className="flex items-center justify-between px-3 py-2 rounded-lg"
                      style={{ backgroundColor: `${fill}0d` }}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: fill }} />
                        <span className="text-[13px] font-semibold text-gray-900 truncate">{name}</span>
                        <span className="text-[11px] text-gray-400 flex-shrink-0">
                          {item.count} {item.count === 1 ? 'call' : 'calls'}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <span
                          className="text-[10px] font-bold px-1.5 py-0.5 rounded-md"
                          style={{ backgroundColor: `${fill}18`, color: fill }}
                        >
                          {pct}%
                        </span>
                        <span className="text-[13px] font-bold text-gray-900 w-14 text-right tabular-nums">
                          {item.credits.toFixed(1)}
                        </span>
                      </div>
                    </div>
                  );
                })}
                <div className="flex items-center justify-between px-3 pt-2 mt-1 border-t border-gray-200">
                  <span className="text-[12px] font-bold text-gray-500">Total</span>
                  <span className="text-[13px] font-bold text-gray-900 w-14 text-right tabular-nums">{modelTotal.toFixed(1)}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---------- Logs tab ---------- */}
      {activeTab === 'logs' && (
        <div className="dash-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[15px] font-semibold text-gray-900">Credit usage logs</h2>
            <span className="text-[12px] text-gray-400">{logsTotal} events</span>
          </div>

          {logsLoading && usageLogs.length === 0 ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
            </div>
          ) : usageLogs.length === 0 ? (
            <div className="text-center py-10">
              <Zap className="w-5 h-5 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-400">No usage events this period.</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-gray-200 text-gray-400 font-bold uppercase text-[10px]">
                      <th className="text-left px-2 py-2">Type</th>
                      <th className="text-left px-2 py-2">Model</th>
                      <th className="text-right px-2 py-2">Credits</th>
                      <th className="text-right px-2 py-2">Tokens</th>
                      <th className="text-right px-2 py-2">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usageLogs.map((log) => {
                      const sourceLabel = getUsageSourceLabel(log.sourceType, log.subagentKind, log.sourceLabel);
                      const category = getUsageSourceCategory(log.sourceType, log.subagentKind);
                      const cfg = getCategoryDisplay(category);
                      return (
                        <tr key={log.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                          <td className="px-2 py-2">
                            <span
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold"
                              style={{ backgroundColor: `${cfg.hex}18`, color: cfg.hex }}
                            >
                              {sourceLabel}
                            </span>
                          </td>
                          <td className="px-2 py-2 font-mono text-gray-700 max-w-[160px] truncate">{formatModel(log.model)}</td>
                          <td className="px-2 py-2 text-right font-bold text-gray-900 tabular-nums">{log.credits.toFixed(2)}</td>
                          <td className="px-2 py-2 text-right text-gray-500 tabular-nums">
                            <div className="flex items-center justify-end gap-1.5">
                              {log.totalTokens > 0 ? log.totalTokens.toLocaleString() : '-'}
                              {log.stepCount > 1 && (
                                <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-gray-100 text-gray-500 tabular-nums">
                                  {log.stepCount}×
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-2 py-2 text-right text-gray-400 whitespace-nowrap">{formatRelativeTime(log.createdAt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {totalLogsPages > 1 && (
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-200">
                  <span className="text-[11px] text-gray-400">{logsTotal} events total</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => loadLogs(logsPage - 1)}
                      disabled={logsPage === 0 || logsLoading}
                      className="p-1 rounded-md hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ChevronLeft className="w-4 h-4 text-gray-500" />
                    </button>
                    <span className="text-[11px] text-gray-500 font-medium tabular-nums">
                      {logsPage + 1} / {totalLogsPages}
                    </span>
                    <button
                      onClick={() => loadLogs(logsPage + 1)}
                      disabled={logsPage >= totalLogsPages - 1 || logsLoading}
                      className="p-1 rounded-md hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ChevronRight className="w-4 h-4 text-gray-500" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {!BILLING_SETTINGS_UI_ENABLED && (
        <div className="dash-card p-6 opacity-50 pointer-events-none select-none">
          <p className="text-[13px] font-medium text-gray-500">Billing settings</p>
          <p className="text-[12px] text-gray-400 mt-1">
            Auto-refill, metered overage, and spend limits are temporarily unavailable.
          </p>
        </div>
      )}

      {BILLING_SETTINGS_UI_ENABLED && activeTab === 'settings' && prefsLoading && (
        <div className="dash-card p-6 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
        </div>
      )}

      {BILLING_SETTINGS_UI_ENABLED && activeTab === 'settings' && !prefsLoading && !prefs && (
        <div className="dash-card p-6 text-center text-sm text-gray-500">
          Could not load settings. Please refresh the page.
        </div>
      )}

      {/* ---------- Settings tab (auto-refill + limits) — disabled when BILLING_SETTINGS_UI_ENABLED is false ---------- */}
      {BILLING_SETTINGS_UI_ENABLED && activeTab === 'settings' && !prefsLoading && prefs && (
        <div className="space-y-4">
          <div className="dash-card p-6">
            <div className="flex items-center gap-2 mb-4">
              <RefreshCw className="w-4 h-4 text-gray-900" />
              <h2 className="text-[15px] font-semibold text-gray-900">Auto-refill</h2>
              {prefsSaving && <span className="text-[11px] text-gray-400">saving…</span>}
            </div>

            <label className="flex items-start gap-3 cursor-pointer mb-5">
              <input
                type="checkbox"
                checked={prefs.autoRefillEnabled}
                onChange={(e) => handleSavePrefs({ autoRefillEnabled: e.target.checked })}
                className="w-4 h-4 mt-0.5 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
              />
              <div>
                <p className="text-[13px] font-medium text-gray-900">Automatically top up when low</p>
                <p className="text-[12px] text-gray-500 mt-0.5">
                  When your balance drops below the threshold, we&apos;ll charge your saved payment method for an add-on pack so you never run out mid-conversation.
                </p>
              </div>
            </label>

            <div className={`grid grid-cols-1 md:grid-cols-2 gap-4 ${prefs.autoRefillEnabled ? '' : 'opacity-50 pointer-events-none'}`}>
              <div>
                <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">Trigger at (credits)</label>
                <input
                  type="number"
                  min={0}
                  step={10}
                  value={prefs.autoRefillThresholdCredits}
                  onChange={(e) => setPrefs({ ...prefs, autoRefillThresholdCredits: Number(e.target.value) })}
                  onBlur={() => handleSavePrefs({ autoRefillThresholdCredits: prefs.autoRefillThresholdCredits })}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-[13px] focus:outline-none focus:border-gray-900"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">Refill amount (USD)</label>
                <div className="flex flex-nowrap items-center gap-2">
                  <span className="text-gray-400 shrink-0">$</span>
                  <input
                    type="number"
                    min={5}
                    step={1}
                    value={Math.round(prefs.autoRefillAmountCents / 100)}
                    onChange={(e) => setPrefs({ ...prefs, autoRefillAmountCents: Math.max(500, Number(e.target.value) * 100) })}
                    onBlur={() => handleSavePrefs({ autoRefillAmountCents: prefs.autoRefillAmountCents })}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-[13px] focus:outline-none focus:border-gray-900"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="dash-card p-6">
            <div className="flex items-center gap-2 mb-4">
              <Sliders className="w-4 h-4 text-gray-900" />
              <h2 className="text-[15px] font-semibold text-gray-900">Budgets & limits</h2>
            </div>
            <p className="text-[12px] text-gray-500 mb-4">
              Optional. A soft budget notifies you at 70/90/100% of your spend; a hard limit blocks further usage until the next period.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">Monthly soft budget (USD)</label>
                <div className="flex flex-nowrap items-center gap-2">
                  <span className="text-gray-400 shrink-0">$</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={prefs.monthlyBudgetCents == null ? '' : Math.round(prefs.monthlyBudgetCents / 100)}
                    placeholder="No budget"
                    onChange={(e) => setPrefs({
                      ...prefs,
                      monthlyBudgetCents: e.target.value === '' ? null : Math.max(0, Number(e.target.value) * 100),
                    })}
                    onBlur={() => handleSavePrefs({ monthlyBudgetCents: prefs.monthlyBudgetCents })}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-[13px] focus:outline-none focus:border-gray-900"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">Hard limit (USD)</label>
                <div className="flex flex-nowrap items-center gap-2">
                  <span className="text-gray-400 shrink-0">$</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={prefs.hardSpendLimitCents == null ? '' : Math.round(prefs.hardSpendLimitCents / 100)}
                    placeholder="No limit"
                    onChange={(e) => setPrefs({
                      ...prefs,
                      hardSpendLimitCents: e.target.value === '' ? null : Math.max(0, Number(e.target.value) * 100),
                    })}
                    onBlur={() => handleSavePrefs({ hardSpendLimitCents: prefs.hardSpendLimitCents })}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-[13px] focus:outline-none focus:border-gray-900"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="dash-card p-6">
            <div className="flex items-center gap-2 mb-3">
              <ExternalLink className="w-4 h-4 text-gray-900" />
              <h2 className="text-[15px] font-semibold text-gray-900">Payment method & invoices</h2>
            </div>
            <p className="text-[12px] text-gray-500 mb-4">Managed by Polar. Update your card, view receipts, or cancel there.</p>
            <button
              onClick={handleManagePortal}
              disabled={!user || isManaging}
              className="dash-card-button dash-card-button--ghost !flex-none px-4 py-2 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2"
            >
              {isManaging ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
              Open Polar customer portal
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
