'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuthContext } from '@/components/providers/AuthProvider';
import { supabase } from '@/lib/supabaseClient';
import {
  BRAND_CHART_COLORS,
  displayModelName,
  formatRelativeTime,
  isInferenceModel,
  isNonBillableUsageEvent,
  creditUsagePercent,
  creditUsageBarPercent,
} from '@/lib/billingUtils';

type UsageEvent = {
  credit_cost?: number | null;
  cost_usd?: number | null;
  created_at: string;
  model?: string | null;
  raw?: Record<string, any> | null;
};

type CreditGrant = {
  source_type: string | null;
  total_credits: number;
  remaining_credits: number;
  expires_at: string | null;
};

const DAYS_RANGE = 14;

export default function DashboardPage() {
  const { user, userData } = useAuthContext();
  const userId = user?.id || '';
  const userName = userData?.displayName || user?.email?.split('@')[0] || 'User';

  const [stats, setStats] = useState({
    creditsUsed: 0,
    creditsLimit: 0,
    creditsRemaining: 0,
    plan: '',
    activeWorkflows: 0,
    recentActivity: [] as Array<{ action: string; target: string; time: string }>,
    usageSeries: [] as Array<{ label: string; credits: number }>,
    totalSpendUsd: 0,
    topModels: [] as Array<{ model: string; credits: number; count: number }>,
  });
  const [loading, setLoading] = useState(true);
  const isActiveRef = useRef(true);

  useEffect(() => {
    isActiveRef.current = true;
    return () => { isActiveRef.current = false; };
  }, []);

  useEffect(() => {
    if (!userId) { setLoading(false); return; }

    async function loadStats() {
      try {
        setLoading(true);
        const now = new Date();
        const rangeStart = new Date(now);
        rangeStart.setDate(rangeStart.getDate() - (DAYS_RANGE - 1));
        rangeStart.setHours(0, 0, 0, 0);

        const { data: profile } = await supabase
          .from('profiles')
          .select('plan, current_period_start')
          .eq('id', userId)
          .maybeSingle();

        const periodStart = profile?.current_period_start
          ? new Date(profile.current_period_start)
          : new Date(now.getFullYear(), now.getMonth(), 1);

        const fetchFrom = periodStart < rangeStart ? periodStart : rangeStart;

        const [{ data: rawEvents }, { data: rawGrants }, { count: workflowCount }] = await Promise.all([
          supabase
            .from('usage_events')
            .select('cost_usd, credit_cost, created_at, model, raw')
            .eq('user_id', userId)
            .gte('created_at', fetchFrom.toISOString())
            .order('created_at', { ascending: false })
            .limit(2000),
          supabase
            .from('credit_grants')
            .select('source_type, total_credits, remaining_credits, expires_at')
            .eq('user_id', userId),
          supabase
            .from('conversations')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId),
        ]);

        if (!isActiveRef.current) return;

        const nowMs = Date.now();
        let totalCredits = 0;
        let totalRemaining = 0;
        for (const g of (rawGrants || []) as CreditGrant[]) {
          if (g.expires_at && Date.parse(g.expires_at) <= nowMs) continue;
          totalCredits += Number(g.total_credits) || 0;
          totalRemaining += Number(g.remaining_credits) || 0;
        }

        const allEvents = (rawEvents || []) as UsageEvent[];
        const billable = allEvents.filter((e) => !isNonBillableUsageEvent({ model: e.model, raw: e.raw }));

        let creditsUsed = 0;
        let totalSpendUsd = 0;
        for (const e of billable) {
          if (new Date(e.created_at) >= periodStart) {
            creditsUsed += Number(e.credit_cost) || 0;
            totalSpendUsd += Number(e.cost_usd) || 0;
          }
        }
        creditsUsed = Math.ceil(creditsUsed);

        const inferenceEvents = billable.filter((e) => isInferenceModel(e.model));
        const recentActivity = inferenceEvents.slice(0, 6).map((e) => ({
          action: displayModelName(e.model || 'unknown'),
          target: `${Number(e.credit_cost || 0).toFixed(2)} credits`,
          time: formatRelativeTime(e.created_at),
        }));

        const seriesMap = new Map<string, number>();
        for (let i = 0; i < DAYS_RANGE; i++) {
          const day = new Date(rangeStart);
          day.setDate(rangeStart.getDate() + i);
          seriesMap.set(day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), 0);
        }
        for (const e of billable) {
          const d = new Date(e.created_at);
          if (d >= rangeStart) {
            const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            if (seriesMap.has(label)) {
              seriesMap.set(label, (seriesMap.get(label) || 0) + (Number(e.credit_cost) || 0));
            }
          }
        }
        const usageSeries = Array.from(seriesMap.entries()).map(([label, credits]) => ({
          label,
          credits: Math.ceil(credits),
        }));

        const modelBuckets: Record<string, { credits: number; count: number }> = {};
        for (const e of billable) {
          if (new Date(e.created_at) < periodStart) continue;
          const model = String(e.model || 'unknown');
          if (!isInferenceModel(model)) continue;
          if (!modelBuckets[model]) modelBuckets[model] = { credits: 0, count: 0 };
          modelBuckets[model].credits += Number(e.credit_cost) || 0;
          modelBuckets[model].count += 1;
        }
        const topModels = Object.entries(modelBuckets)
          .sort(([, a], [, b]) => b.credits - a.credits)
          .slice(0, 4)
          .map(([model, s]) => ({ model, credits: s.credits, count: s.count }));

        if (!isActiveRef.current) return;
        setStats({
          creditsUsed,
          creditsLimit: Math.ceil(totalCredits),
          creditsRemaining: Math.ceil(totalRemaining),
          plan: String(profile?.plan || userData?.plan || 'Free'),
          activeWorkflows: workflowCount || 0,
          recentActivity,
          usageSeries,
          totalSpendUsd,
          topModels,
        });
      } catch (e) {
        console.error('Failed to load dashboard stats', e);
      } finally {
        if (isActiveRef.current) setLoading(false);
      }
    }

    loadStats();
  }, [userId, userData?.plan]);

  const planName = useMemo(() => {
    const p = stats.plan || userData?.plan || 'free';
    return p.charAt(0).toUpperCase() + p.slice(1);
  }, [stats.plan, userData?.plan]);

  const creditSummaryLike = useMemo(
    () => ({
      limit: stats.creditsLimit,
      remaining: stats.creditsRemaining,
      used: stats.creditsUsed,
    }),
    [stats.creditsLimit, stats.creditsRemaining, stats.creditsUsed],
  );
  const usagePercent = useMemo(() => creditUsagePercent(creditSummaryLike), [creditSummaryLike]);
  const usageBarPercent = useMemo(() => creditUsageBarPercent(creditSummaryLike), [creditSummaryLike]);

  const remainingPercent = Math.max(0, 100 - usageBarPercent);
  const maxCredits = Math.max(...stats.usageSeries.map((p) => p.credits), 1);

  return (
    <div className="space-y-5">
      {/* Welcome header */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[20px] sm:text-[22px] font-semibold tracking-tight text-white">
            Welcome back, <span className="text-neutral-400 font-medium">{userName}</span>
          </h1>
          <p className="text-[12.5px] text-neutral-500 mt-1">
            Here&apos;s what&apos;s happening with your account.
          </p>
        </div>
        <span className="hidden sm:inline-flex dash-badge flex-shrink-0">{planName} plan</span>
      </div>

      {/* Top row: Available Credits | Total Conversations | Recent Activity (spans 2 rows) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Available Credits */}
        <StatCard
          title="Available Credits"
          badge={planName}
          value={loading ? '—' : stats.creditsRemaining.toLocaleString()}
          subtitle="Remaining"
          progressPercent={remainingPercent}
          footnote={
            loading
              ? ''
              : `${stats.creditsUsed.toLocaleString()} of ${stats.creditsLimit.toLocaleString()} used this period`
          }
          actions={
            <>
              <Link href="/dashboard/billing?tab=credits" className="dash-card-button dash-card-button--ghost">
                Buy Credits
              </Link>
              <Link href="/pricing" className="dash-card-button dash-card-button--primary">
                Upgrade to Pro
              </Link>
            </>
          }
        />

        {/* Total Conversations */}
        <StatCard
          title="Total Conversations"
          value={loading ? '—' : stats.activeWorkflows.toLocaleString()}
          subtitle="Active threads"
          progressPercent={Math.min(100, stats.activeWorkflows * 5)}
          accent="#F59E0B"
          footnote={
            loading
              ? ''
              : stats.activeWorkflows > 0
                ? `${stats.activeWorkflows} ${stats.activeWorkflows === 1 ? 'thread' : 'threads'} so far`
                : 'Start a conversation to see it here'
          }
        />

        {/* Recent Activity — spans 2 rows on lg */}
        <div className="dash-card lg:row-span-2 flex flex-col">
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <h2 className="text-[13px] font-semibold text-white">Recent Activities</h2>
            <Link
              href="/dashboard/billing?tab=logs"
              className="text-[11px] text-neutral-400 hover:text-white"
            >
              View all
            </Link>
          </div>
          <div className="px-4 pb-4 flex-1 overflow-y-auto dash-scroll" style={{ maxHeight: 420 }}>
            {loading ? (
              <div className="space-y-2.5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-2.5 animate-pulse">
                    <div className="w-1.5 h-1.5 rounded-full bg-neutral-800 flex-shrink-0" />
                    <div className="flex-1 space-y-1">
                      <div className="h-2 w-28 bg-neutral-800 rounded" />
                      <div className="h-1.5 w-16 bg-neutral-900 rounded" />
                    </div>
                  </div>
                ))}
              </div>
            ) : stats.recentActivity.length > 0 ? (
              <ul className="divide-y divide-neutral-800/70">
                {stats.recentActivity.map((item, i) => (
                  <li key={i} className="py-2.5 flex items-start gap-2.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-neutral-600 mt-1.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-medium text-neutral-100 truncate">{item.action}</p>
                      <p className="text-[10px] text-neutral-500 mt-0.5">{item.target}</p>
                    </div>
                    <span className="text-[10px] text-neutral-500 whitespace-nowrap mt-0.5">
                      {item.time}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex flex-col items-center justify-center text-neutral-500 py-10">
                <EmptyIcon className="w-6 h-6 mb-2 text-neutral-700" />
                <p className="text-[12px]">No recent activity</p>
                <p className="text-[10px] text-neutral-600 mt-1">
                  Your inference calls will appear here
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Credit Usage chart — spans 2 cols */}
        <div className="dash-card lg:col-span-2 p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-[13px] font-semibold text-white">Credit Usage</h2>
              <p className="text-[10px] text-neutral-500 mt-0.5">Last {DAYS_RANGE} days</p>
            </div>
            <span className="dash-badge">{planName}</span>
          </div>

          <div className="flex items-end gap-1 h-24 sm:h-28">
            {loading
              ? Array.from({ length: DAYS_RANGE }).map((_, i) => (
                  <div
                    key={i}
                    className="flex-1 bg-neutral-800 rounded animate-pulse"
                    style={{ height: `${30 + (i % 5) * 12}%` }}
                  />
                ))
              : stats.usageSeries.map((point) => {
                  const heightPct =
                    maxCredits > 0
                      ? Math.max(point.credits > 0 ? 6 : 2, Math.round((point.credits / maxCredits) * 100))
                      : 2;
                  return (
                    <div
                      key={point.label}
                      className="group relative flex-1 rounded bg-gradient-to-t from-[#FF383C] to-[#FF6B6E] hover:from-[#FF4D52] hover:to-[#FF8082] transition-colors cursor-default"
                      style={{ height: `${heightPct}%`, minHeight: 3 }}
                    >
                      {point.credits > 0 && (
                        <span className="pointer-events-none absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] text-neutral-300 bg-neutral-900 border border-neutral-700 rounded px-1.5 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                          {point.credits} credits
                        </span>
                      )}
                    </div>
                  );
                })}
          </div>

          <div className="flex gap-1 mt-1.5">
            {stats.usageSeries.map((point, i) => (
              <div key={point.label} className="flex-1 text-center">
                {i % 3 === 0 && (
                  <span className="text-[9px] text-neutral-600">{point.label}</span>
                )}
              </div>
            ))}
          </div>

          <div className="mt-3 pt-3 border-t border-neutral-800/70 grid grid-cols-3 gap-3">
            <FootStat label="Total Spend" value={`$${stats.totalSpendUsd.toFixed(2)}`} />
            <FootStat label="Credit Limit" value={stats.creditsLimit.toLocaleString()} />
            <FootStat label="Credits Used" value={stats.creditsUsed.toLocaleString()} />
          </div>

          <div className="mt-3 flex gap-2">
            <Link href="/dashboard/billing?tab=credits" className="dash-card-button dash-card-button--ghost">
              Buy Credits
            </Link>
            <Link href="/pricing" className="dash-card-button dash-card-button--primary">
              Upgrade to Pro
            </Link>
          </div>
        </div>
      </div>

      {/* Top Models */}
      {!loading && stats.topModels.length > 0 && (
        <div className="dash-card p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-[13px] font-semibold text-white">Top Models This Period</h2>
              <p className="text-[10px] text-neutral-500 mt-0.5">By credits consumed</p>
            </div>
            <Link href="/dashboard/billing" className="text-[11px] text-neutral-400 hover:text-white">
              Full breakdown
            </Link>
          </div>
          <ModelBars topModels={stats.topModels} />
        </div>
      )}
    </div>
  );
}

// ── Small components ────────────────────────────────────────────────────────

function StatCard({
  title,
  badge,
  value,
  subtitle,
  progressPercent,
  footnote,
  actions,
  accent = '#FF383C',
}: {
  title: string;
  badge?: string;
  value: string;
  subtitle?: string;
  progressPercent?: number;
  footnote?: string;
  actions?: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="dash-card p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-[13px] font-semibold text-white">{title}</h2>
        {badge && <span className="dash-badge">{badge}</span>}
      </div>

      <div className="flex flex-col items-start gap-1.5">
        <div className="flex flex-col items-start gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
          <span className="text-[28px] sm:text-[32px] font-semibold leading-none text-white tracking-tight tabular-nums">
            {value}
          </span>
          {subtitle && (
            <span className="text-[11px] font-medium text-neutral-500">{subtitle}</span>
          )}
        </div>

        {typeof progressPercent === 'number' && (
          <div className="w-full mt-1">
            <div className="h-1 w-full rounded-full bg-neutral-800/80 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.max(2, Math.min(100, progressPercent))}%`,
                  background: `linear-gradient(90deg, ${accent}, ${accent}aa)`,
                }}
              />
            </div>
          </div>
        )}

        {footnote && (
          <p className="text-[10px] text-neutral-500 mt-0.5">{footnote}</p>
        )}
      </div>

      {actions && <div className="flex gap-2 mt-auto">{actions}</div>}
    </div>
  );
}

function FootStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9px] font-medium text-neutral-500 uppercase tracking-wide">{label}</p>
      <p className="text-[13px] font-semibold text-white mt-0.5">{value}</p>
    </div>
  );
}

function ModelBars({
  topModels,
}: {
  topModels: Array<{ model: string; credits: number; count: number }>;
}) {
  const MODEL_COLORS = BRAND_CHART_COLORS;
  const modelTotal = topModels.reduce((s, m) => s + m.credits, 0);

  return (
    <div className="space-y-2.5">
      {topModels.map((m, i) => {
        const pct = modelTotal > 0 ? Math.round((m.credits / modelTotal) * 100) : 0;
        const color = MODEL_COLORS[i % MODEL_COLORS.length];
        return (
          <div key={m.model} className="flex items-center gap-2.5">
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[12px] font-medium text-neutral-100 truncate">
                  {displayModelName(m.model)}
                </span>
                <span className="text-[10px] text-neutral-500 ml-2 flex-shrink-0">
                  {m.credits.toFixed(1)} credits · {m.count} calls
                </span>
              </div>
              <div className="h-1 w-full rounded-full bg-neutral-800/80 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${pct}%`, backgroundColor: color }}
                />
              </div>
            </div>
            <span className="text-[10px] font-semibold text-neutral-500 w-8 text-right">{pct}%</span>
          </div>
        );
      })}
    </div>
  );
}

function EmptyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0l-3-3m3 3l3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z"
      />
    </svg>
  );
}
