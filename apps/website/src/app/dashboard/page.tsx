'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuthContext } from '@/components/providers/AuthProvider';
import { supabase } from '@/lib/supabaseClient';

type UsageEvent = {
    credit_cost?: number | null;
    cost_usd: number | null;
    created_at: string;
    model?: string | null;
};

type CreditSummaryResponse = {
    ok?: boolean;
    plan?: string;
    limit?: number;
    used?: number;
    remaining?: number;
    unlimited?: boolean;
    creditsPerUsd?: number;
};

const CREDITS_PER_USD = 33;
const DAYS_RANGE = 14;
const CLOUD_API_URL = process.env.NEXT_PUBLIC_CLOUD_API_URL || 'https://api.stuard.ai';

export default function DashboardPage() {
    const { user, userData } = useAuthContext();
    const userId = user?.id || '';
    const userName = userData?.displayName || user?.email?.split('@')[0] || 'User';
    const planFallbackRef = useRef('');

    useEffect(() => {
        planFallbackRef.current = String(userData?.plan || '');
    }, [userData?.plan]);

    const [stats, setStats] = useState({
        creditsUsed: 0,
        creditsLimit: 0,
        creditsRemaining: 0,
        unlimited: false,
        plan: '',
        activeWorkflows: 0,
        recentActivity: [] as Array<{ action: string; target: string; time: string }>,
        usageSeries: [] as Array<{ label: string; credits: number }>,
        totalSpendUsd: 0,
    });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let isActive = true;

        if (!userId) {
            setLoading(false);
            return () => { isActive = false; };
        }

        async function loadStats() {
            try {
                if (isActive) setLoading(true);
                const now = new Date();
                const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
                const rangeStart = new Date();
                rangeStart.setDate(rangeStart.getDate() - (DAYS_RANGE - 1));
                rangeStart.setHours(0, 0, 0, 0);
                const { data: sessionDataRes } = await supabase.auth.getSession();
                const token = sessionDataRes.session?.access_token || '';

                const [{ data: usageEvents }, creditsResponse, { count: workflowCount }] = await Promise.all([
                    supabase
                        .from('usage_events')
                        .select('cost_usd, credit_cost, created_at, model')
                        .eq('user_id', userId)
                        .gte('created_at', startOfMonth),
                    token
                        ? fetch(`${CLOUD_API_URL}/v1/credits`, {
                            headers: { Authorization: `Bearer ${token}` },
                        }).then((res) => res.json()).catch(() => null)
                        : Promise.resolve(null),
                    supabase
                        .from('conversations')
                        .select('*', { count: 'exact', head: true })
                        .eq('user_id', userId)
                ]);

                const usageList = (usageEvents || []) as UsageEvent[];
                const totalCostUsd = usageList.reduce((acc, curr) => acc + (curr.cost_usd || 0), 0);
                const summary = (creditsResponse && (creditsResponse as CreditSummaryResponse).ok)
                    ? creditsResponse as CreditSummaryResponse
                    : null;
                const creditsUsed = summary ? Number(summary.used || 0) : Math.ceil(totalCostUsd * CREDITS_PER_USD);
                const creditsLimit = summary ? Number(summary.limit || 0) : 0;
                const creditsRemaining = summary ? Number(summary.remaining || 0) : Math.max(0, creditsLimit - creditsUsed);
                const unlimited = Boolean(summary?.unlimited);

                const recent = usageList
                    .slice()
                    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                    .slice(0, 5)
                    .map(e => ({
                        action: e.model ? `Model ${e.model}` : 'AI Interaction',
                        target: e.cost_usd ? `$${e.cost_usd.toFixed(4)} cost` : 'Usage logged',
                        time: new Date(e.created_at).toLocaleDateString(),
                    }));

                const seriesMap = new Map<string, number>();
                for (let i = 0; i < DAYS_RANGE; i += 1) {
                    const day = new Date(rangeStart);
                    day.setDate(rangeStart.getDate() + i);
                    const label = day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                    seriesMap.set(label, 0);
                }
                usageList.forEach(event => {
                    const date = new Date(event.created_at);
                    if (date >= rangeStart) {
                        const label = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                        const credits = Number(event.credit_cost || 0) > 0
                            ? Math.ceil(Number(event.credit_cost || 0))
                            : Math.ceil((event.cost_usd || 0) * CREDITS_PER_USD);
                        seriesMap.set(label, (seriesMap.get(label) || 0) + credits);
                    }
                });
                const usageSeries = Array.from(seriesMap.entries()).map(([label, credits]) => ({ label, credits }));

                if (!isActive) return;

                setStats({
                    creditsUsed,
                    creditsLimit,
                    creditsRemaining,
                    unlimited,
                    plan: String(summary?.plan || planFallbackRef.current || ''),
                    activeWorkflows: workflowCount || 0,
                    recentActivity: recent,
                    usageSeries,
                    totalSpendUsd: totalCostUsd,
                });
            } catch (e) {
                console.error('Failed to load dashboard stats', e);
            } finally {
                if (isActive) setLoading(false);
            }
        }

        loadStats();
        return () => { isActive = false; };
    }, [userId]);

    const resolvedPlan = stats.plan || userData?.plan || 'free';
    const planName = resolvedPlan ? (resolvedPlan.charAt(0).toUpperCase() + resolvedPlan.slice(1)) : 'Free';
    const usagePercent = useMemo(() => {
        if (stats.unlimited || !stats.creditsLimit) return 0;
        return Math.min(100, Math.round((stats.creditsUsed / stats.creditsLimit) * 100));
    }, [stats.creditsUsed, stats.creditsLimit, stats.unlimited]);

    const maxCredits = Math.max(...stats.usageSeries.map(p => p.credits), 1);

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
                    <p className="text-2xl font-bold text-gray-900 mt-1">{planName}</p>
                    <p className="text-[12px] text-gray-400 mt-1">Active subscription</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <p className="text-[13px] font-medium text-gray-500">Available Credits</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">
                        {loading ? '—' : (stats.unlimited ? 'Unlimited' : stats.creditsRemaining.toLocaleString())}
                    </p>
                    <div className="mt-2.5">
                        <div className="h-1.5 w-full rounded-full bg-gray-100">
                            <div
                                className="h-full rounded-full bg-gray-900 transition-all"
                                style={{ width: `${usagePercent}%` }}
                            />
                        </div>
                        <p className="text-[11px] text-gray-400 mt-1">
                            {stats.unlimited ? 'Unlimited' : `${stats.creditsUsed.toLocaleString()} of ${stats.creditsLimit.toLocaleString()} used`}
                        </p>
                    </div>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <p className="text-[13px] font-medium text-gray-500">Total Conversations</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">
                        {loading ? '—' : stats.activeWorkflows}
                    </p>
                    <p className="text-[12px] text-gray-400 mt-1">Active threads</p>
                </div>
            </div>

            {/* Usage Chart + Activity */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Chart */}
                <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-6">
                    <div className="flex items-center justify-between mb-6">
                        <h2 className="text-[15px] font-semibold text-gray-900">Usage</h2>
                        <span className="text-[12px] text-gray-400">Last {DAYS_RANGE} days</span>
                    </div>
                    <div className="flex items-end gap-1.5 h-36">
                        {stats.usageSeries.map((point) => {
                            const heightPct = maxCredits > 0 ? Math.max(4, (point.credits / maxCredits) * 100) : 4;
                            return (
                                <div key={point.label} className="flex-1 flex flex-col items-center gap-1.5 group">
                                    <div className="relative w-full flex justify-center">
                                        <span className="absolute -top-5 text-[10px] text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity">
                                            {point.credits}
                                        </span>
                                        <div
                                            className="w-full max-w-[28px] rounded-md bg-gray-900 transition-all group-hover:bg-gray-700"
                                            style={{ height: `${heightPct}%`, minHeight: '4px' }}
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    <div className="flex gap-1.5 mt-2">
                        {stats.usageSeries.map((point, i) => (
                            <div key={point.label} className="flex-1 text-center">
                                {i % 2 === 0 && (
                                    <span className="text-[10px] text-gray-400">{point.label}</span>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Summary row */}
                    <div className="mt-6 pt-5 border-t border-gray-100 grid grid-cols-3 gap-4">
                        <div>
                            <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Total Spend</p>
                            <p className="text-lg font-semibold text-gray-900">${stats.totalSpendUsd.toFixed(2)}</p>
                        </div>
                        <div>
                            <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Monthly Limit</p>
                            <p className="text-lg font-semibold text-gray-900">
                                {stats.unlimited ? 'Unlimited' : stats.creditsLimit.toLocaleString()}
                            </p>
                        </div>
                        <div>
                            <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Credits Used</p>
                            <p className="text-lg font-semibold text-gray-900">{stats.creditsUsed.toLocaleString()}</p>
                        </div>
                    </div>
                </div>

                {/* Recent Activity */}
                <div className="bg-white rounded-xl border border-gray-200">
                    <div className="px-5 py-4 border-b border-gray-100">
                        <h2 className="text-[15px] font-semibold text-gray-900">Recent Activity</h2>
                    </div>
                    {stats.recentActivity.length > 0 ? (
                        <div className="divide-y divide-gray-100">
                            {stats.recentActivity.map((item, i) => (
                                <div key={i} className="px-5 py-3.5 flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                                        <div>
                                            <p className="text-[13px] font-medium text-gray-900">{item.action}</p>
                                            <p className="text-[11px] text-gray-400">{item.target}</p>
                                        </div>
                                    </div>
                                    <span className="text-[11px] text-gray-400 flex-shrink-0">{item.time}</span>
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
