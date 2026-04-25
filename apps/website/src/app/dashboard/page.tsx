'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuthContext } from '@/components/providers/AuthProvider';
import { supabase } from '@/lib/supabaseClient';
import {
  displayModelName,
  formatRelativeTime,
  isInferenceModel,
  isNonBillableUsageEvent,
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

        // 1. Profile for plan + billing period
        const { data: profile } = await supabase
          .from('profiles')
          .select('plan, current_period_start')
          .eq('id', userId)
          .maybeSingle();

        const periodStart = profile?.current_period_start
          ? new Date(profile.current_period_start)
          : new Date(now.getFullYear(), now.getMonth(), 1);

        const fetchFrom = periodStart < rangeStart ? periodStart : rangeStart;

        // 2. Parallel data fetches — all through RLS with user session
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

        // 3. Credit summary from grants
        const nowMs = Date.now();
        let totalCredits = 0;
        let totalRemaining = 0;
        for (const g of (rawGrants || []) as CreditGrant[]) {
          if (g.expires_at && Date.parse(g.expires_at) <= nowMs) continue;
          totalCredits += Number(g.total_credits) || 0;
          totalRemaining += Number(g.remaining_credits) || 0;
        }

        // 4. Process events
        const allEvents = (rawEvents || []) as UsageEvent[];
        const billable = allEvents.filter((e) => !isNonBillableUsageEvent({ model: e.model, raw: e.raw }));

        // Credits used + spend this billing period
        let creditsUsed = 0;
        let totalSpendUsd = 0;
        for (const e of billable) {
          if (new Date(e.created_at) >= periodStart) {
            creditsUsed += Number(e.credit_cost) || 0;
            totalSpendUsd += Number(e.cost_usd) || 0;
          }
        }
        creditsUsed = Math.ceil(creditsUsed);

        // 5. Recent activity — inference models only, clean names
        const inferenceEvents = billable.filter((e) => isInferenceModel(e.model));
        const recentActivity = inferenceEvents.slice(0, 5).map((e) => ({
          action: displayModelName(e.model || 'unknown'),
          target: `${Number(e.credit_cost || 0).toFixed(2)} credits`,
          time: formatRelativeTime(e.created_at),
        }));

        // 6. Usage series (last 14 days)
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

        // 7. Top models this period
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

  const usagePercent = useMemo(() => {
    if (!stats.creditsLimit) return 0;
    return Math.min(100, Math.round((stats.creditsUsed / stats.creditsLimit) * 100));
  }, [stats.creditsUsed, stats.creditsLimit]);

  const maxCredits = Math.max(...stats.usageSeries.map((p) => p.credits), 1);

  const MODEL_COLORS = ['#3b82f6', '#da7756', '#10a37f', '#6366f1', '#06b6d4'];
  const modelTotal = stats.topModels.reduce((s, m) => s + m.credits, 0);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Welcome back, {userName}</h1>
          <p className="text-sm text-gray-500 mt-1">Here&apos;s what&apos;s happening with your account.</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/download"
            className="inline-flex items-center px-3.5 py-2 text-[13px] font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <DownloadIcon className="w-3.5 h-3.5 mr-1.5 text-gray-400" />
            Download App
          </Link>
          <Link
            href="/dashboard/billing"
            className="inline-flex items-center px-3.5 py-2 text-[13px] font-medium text-white bg-gray-900 rounded-lg hover:bg-black transition-colors"
          >
            Manage Plan
          </Link>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-[13px] font-medium text-gray-500">Current Plan</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{loading ? '—' : planName}</p>
          <p className="text-[12px] text-gray-400 mt-1">Active subscription</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-[13px] font-medium text-gray-500">Available Credits</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">
            {loading ? '—' : stats.creditsRemaining.toLocaleString()}
          </p>
          <div className="mt-2.5">
            <div className="h-1.5 w-full rounded-full bg-gray-100">
              <div
                className={`h-full rounded-full transition-all ${usagePercent >= 90 ? 'bg-red-500' : usagePercent >= 70 ? 'bg-amber-500' : 'bg-gray-900'}`}
                style={{ width: `${usagePercent}%` }}
              />
            </div>
            <p className="text-[11px] text-gray-400 mt-1">
              {loading ? '' : `${stats.creditsUsed.toLocaleString()} of ${stats.creditsLimit.toLocaleString()} used`}
            </p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-[13px] font-medium text-gray-500">Total Conversations</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">
            {loading ? '—' : stats.activeWorkflows.toLocaleString()}
          </p>
          <p className="text-[12px] text-gray-400 mt-1">Active threads</p>
        </div>
      </div>

      {/* Usage Chart + Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Chart */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-[15px] font-semibold text-gray-900">Credit Usage</h2>
            <span className="text-[12px] text-gray-400">Last {DAYS_RANGE} days</span>
          </div>
          <div className="flex items-end gap-1 h-36">
            {loading
              ? Array.from({ length: DAYS_RANGE }).map((_, i) => (
                  <div key={i} className="flex-1 bg-gray-100 rounded-t-sm animate-pulse" style={{ height: '40%' }} />
                ))
              : stats.usageSeries.map((point) => {
                  const heightPct = maxCredits > 0
                    ? Math.max(point.credits > 0 ? 4 : 1, Math.round((point.credits / maxCredits) * 100))
                    : 1;
                  return (
                    <div
                      key={point.label}
                      className="group relative flex-1 rounded-t-sm bg-gray-900 hover:bg-gray-700 transition-colors cursor-default"
                      style={{ height: `${heightPct}%` }}
                    >
                      {point.credits > 0 && (
                        <span className="pointer-events-none absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                          {point.credits}
                        </span>
                      )}
                    </div>
                  );
                })}
          </div>
          <div className="flex gap-1 mt-2">
            {stats.usageSeries.map((point, i) => (
              <div key={point.label} className="flex-1 text-center">
                {i % 2 === 0 && (
                  <span className="text-[10px] text-gray-400">{point.label}</span>
                )}
              </div>
            ))}
          </div>

          <div className="mt-6 pt-5 border-t border-gray-100 grid grid-cols-3 gap-4">
            <div>
              <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Total Spend</p>
              <p className="text-lg font-semibold text-gray-900">${stats.totalSpendUsd.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Credit Limit</p>
              <p className="text-lg font-semibold text-gray-900">{stats.creditsLimit.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Credits Used</p>
              <p className="text-lg font-semibold text-gray-900">{stats.creditsUsed.toLocaleString()}</p>
            </div>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-gray-900">Recent Activity</h2>
            <Link href="/dashboard/billing?tab=logs" className="text-[11px] text-gray-400 hover:text-gray-700">
              See all →
            </Link>
          </div>
          {loading ? (
            <div className="divide-y divide-gray-100">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="px-5 py-3.5 flex items-center gap-3 animate-pulse">
                  <div className="w-1.5 h-1.5 rounded-full bg-gray-200 flex-shrink-0" />
                  <div className="flex-1">
                    <div className="h-2.5 w-24 bg-gray-200 rounded mb-1.5" />
                    <div className="h-2 w-16 bg-gray-100 rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : stats.recentActivity.length > 0 ? (
            <div className="divide-y divide-gray-100">
              {stats.recentActivity.map((item, i) => (
                <div key={i} className="px-5 py-3.5 flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-gray-900 truncate">{item.action}</p>
                      <p className="text-[11px] text-gray-400">{item.target}</p>
                    </div>
                  </div>
                  <span className="text-[11px] text-gray-400 flex-shrink-0 ml-2">{item.time}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400">
              <EmptyIcon className="w-8 h-8 mb-2 text-gray-300" />
              <p className="text-[13px]">No recent activity</p>
            </div>
          )}
        </div>
      </div>

      {/* Top Models */}
      {!loading && stats.topModels.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-[15px] font-semibold text-gray-900">Top Models This Period</h2>
              <p className="text-[12px] text-gray-400 mt-0.5">By credits consumed</p>
            </div>
            <Link href="/dashboard/billing" className="text-[12px] font-medium text-gray-500 hover:text-gray-900">
              Full breakdown →
            </Link>
          </div>
          <div className="space-y-2.5">
            {stats.topModels.map((m, i) => {
              const pct = modelTotal > 0 ? Math.round((m.credits / modelTotal) * 100) : 0;
              const color = MODEL_COLORS[i % MODEL_COLORS.length];
              return (
                <div key={m.model} className="flex items-center gap-3">
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[13px] font-medium text-gray-800 truncate">{displayModelName(m.model)}</span>
                      <span className="text-[12px] text-gray-500 ml-2 flex-shrink-0">
                        {m.credits.toFixed(1)} credits · {m.count} calls
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-gray-100">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, backgroundColor: color }}
                      />
                    </div>
                  </div>
                  <span className="text-[11px] font-bold text-gray-400 w-8 text-right">{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Quick start */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-gray-900 flex items-center justify-center flex-shrink-0">
            <DesktopIcon className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-[15px] font-semibold text-gray-900">Connect the Desktop App</h3>
            <p className="text-[13px] text-gray-500">Unlock the full power of Stuard by connecting your local environment.</p>
          </div>
        </div>
        <Link
          href="/download"
          className="inline-flex items-center px-4 py-2 text-[13px] font-medium text-white bg-gray-900 rounded-lg hover:bg-black transition-colors flex-shrink-0"
        >
          Download Now
        </Link>
      </div>
    </div>
  );
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </svg>
  );
}

function DesktopIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25A2.25 2.25 0 015.25 3h13.5A2.25 2.25 0 0121 5.25z" />
    </svg>
  );
}

function EmptyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0l-3-3m3 3l3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
    </svg>
  );
}
