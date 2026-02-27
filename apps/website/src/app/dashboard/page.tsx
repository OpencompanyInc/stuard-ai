'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useAuthContext } from '@/components/providers/AuthProvider';
import { supabase } from '@/lib/supabaseClient';

type UsageEvent = {
    cost_usd: number | null;
    created_at: string;
    model?: string | null;
};

const CREDITS_PER_USD = 33;
const DAYS_RANGE = 14;

export default function DashboardPage() {
    const { user, userData } = useAuthContext();
    const userName = userData?.displayName || user?.email?.split('@')[0] || 'User';

    const [stats, setStats] = useState({
        creditsUsed: 0,
        creditsLimit: 0,
        activeWorkflows: 0,
        recentActivity: [] as Array<{ action: string; target: string; time: string }>,
        usageSeries: [] as Array<{ label: string; credits: number }>,
        totalSpendUsd: 0,
    });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user) return;

        async function loadStats() {
            try {
                const now = new Date();
                const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
                const rangeStart = new Date();
                rangeStart.setDate(rangeStart.getDate() - (DAYS_RANGE - 1));
                rangeStart.setHours(0, 0, 0, 0);

                const [{ data: usageEvents }, { data: profile }, { count: workflowCount }] = await Promise.all([
                    supabase
                        .from('usage_events')
                        .select('cost_usd, created_at, model')
                        .eq('user_id', user!.id)
                        .gte('created_at', startOfMonth),
                    supabase
                        .from('profiles')
                        .select('monthly_token_limit')
                        .eq('id', user!.id)
                        .single(),
                    supabase
                        .from('conversations')
                        .select('*', { count: 'exact', head: true })
                        .eq('user_id', user!.id)
                ]);

                const usageList = (usageEvents || []) as UsageEvent[];
                const totalCostUsd = usageList.reduce((acc, curr) => acc + (curr.cost_usd || 0), 0);
                const creditsUsed = Math.ceil(totalCostUsd * CREDITS_PER_USD);
                const creditsLimit = Number(profile?.monthly_token_limit ?? 0);

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
                        const credits = Math.ceil((event.cost_usd || 0) * CREDITS_PER_USD);
                        seriesMap.set(label, (seriesMap.get(label) || 0) + credits);
                    }
                });
                const usageSeries = Array.from(seriesMap.entries()).map(([label, credits]) => ({ label, credits }));

                setStats({
                    creditsUsed,
                    creditsLimit,
                    activeWorkflows: workflowCount || 0,
                    recentActivity: recent,
                    usageSeries,
                    totalSpendUsd: totalCostUsd,
                });
            } catch (e) {
                console.error('Failed to load dashboard stats', e);
            } finally {
                setLoading(false);
            }
        }

        loadStats();
    }, [user, userData?.plan]);

    const planName = userData?.plan ? (userData.plan.charAt(0).toUpperCase() + userData.plan.slice(1)) : 'Free Trial';
    const planColor = userData?.plan === 'pro' || userData?.plan === 'power' ? 'bg-indigo-500' : 'bg-emerald-500';
    const usagePercent = useMemo(() => {
        if (!stats.creditsLimit) return 0;
        return Math.min(100, Math.round((stats.creditsUsed / stats.creditsLimit) * 100));
    }, [stats.creditsUsed, stats.creditsLimit]);

    return (
        <div className="space-y-10 max-w-6xl mx-auto">
            {/* Welcome Section */}
            <div className="flex flex-col gap-6 md:flex-row md:items-center justify-between">
                <div>
                    <p className="text-sm font-semibold text-blue-600">Dashboard Overview</p>
                    <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mt-2">Welcome back, {userName}</h1>
                    <p className="text-gray-500 mt-2">Track your credits, activity, and monthly usage at a glance.</p>
                </div>
                <div className="flex flex-wrap gap-3">
                    <Link href="/download">
                        <Button variant="outline" className="bg-white">Download App</Button>
                    </Link>
                    <Link href="/dashboard/billing">
                        <Button className="gradient-primary border-0 rounded-lg text-white font-bold px-6">Manage Plan</Button>
                    </Link>
                </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Plan Card */}
                <Card className="border border-black/5 shadow-sm bg-white/80 backdrop-blur-md overflow-hidden relative group hover:shadow-md transition-all">
                    <div className={`absolute top-0 left-0 w-1.5 h-full ${planColor}`} />
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-gray-500 uppercase tracking-wider">Current Plan</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-gray-900 mb-1">{planName}</div>
                        <p className="text-sm text-gray-400">Active subscription</p>
                    </CardContent>
                </Card>

                {/* Credits Card */}
                <Card className="border border-black/5 shadow-sm bg-white/80 backdrop-blur-md overflow-hidden relative group hover:shadow-md transition-all">
                    <div className="absolute top-0 left-0 w-1.5 h-full bg-blue-500" />
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-gray-500 uppercase tracking-wider">Credits Used</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-gray-900 mb-1">
                            {loading ? '...' : stats.creditsUsed.toLocaleString()}
                        </div>
                        <p className="text-sm text-gray-400">of {stats.creditsLimit.toLocaleString()} monthly limit</p>
                        <div className="mt-4 h-2 w-full rounded-full bg-gray-100">
                            <div className="h-full rounded-full gradient-primary" style={{ width: `${usagePercent}%` }} />
                        </div>
                    </CardContent>
                </Card>

                {/* Automations Card */}
                <Card className="border border-black/5 shadow-sm bg-white/80 backdrop-blur-md overflow-hidden relative group hover:shadow-md transition-all">
                    <div className="absolute top-0 left-0 w-1.5 h-full bg-indigo-500" />
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-gray-500 uppercase tracking-wider">Total Conversations</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-gray-900 mb-1">
                            {loading ? '...' : stats.activeWorkflows}
                        </div>
                        <p className="text-sm text-gray-400">Active threads</p>
                    </CardContent>
                </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-6">
                    <div className="flex items-center justify-between">
                        <h2 className="text-xl font-bold text-gray-900">Usage Analytics</h2>
                        <span className="text-sm text-gray-400">Last {DAYS_RANGE} days</span>
                    </div>
                    <Card className="border-black/5 bg-white/80 backdrop-blur-md shadow-sm">
                        <CardContent className="pt-6">
                            <div className="flex items-end gap-2 h-40">
                                {stats.usageSeries.map((point) => (
                                    <div key={point.label} className="flex-1 flex flex-col items-center gap-2">
                                        <div
                                            className="w-full rounded-lg bg-gradient-to-t from-blue-500 via-indigo-500 to-purple-500"
                                            style={{ height: `${Math.min(100, Math.max(6, point.credits))}%` }}
                                        />
                                        <span className="text-[11px] text-gray-400">{point.label}</span>
                                    </div>
                                ))}
                            </div>
                            <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="rounded-2xl bg-gray-50 px-4 py-3">
                                    <p className="text-xs uppercase text-gray-400">Total Spend</p>
                                    <p className="text-lg font-semibold text-gray-900">${stats.totalSpendUsd.toFixed(2)}</p>
                                </div>
                                <div className="rounded-2xl bg-gray-50 px-4 py-3">
                                    <p className="text-xs uppercase text-gray-400">Credits Used</p>
                                    <p className="text-lg font-semibold text-gray-900">{stats.creditsUsed.toLocaleString()}</p>
                                </div>
                                <div className="rounded-2xl bg-gray-50 px-4 py-3">
                                    <p className="text-xs uppercase text-gray-400">Monthly Limit</p>
                                    <p className="text-lg font-semibold text-gray-900">{stats.creditsLimit.toLocaleString()}</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Recent Activity */}
                {/* Quick Actions / Getting Started */}
                <div className="space-y-6">
                    <h2 className="text-xl font-bold text-gray-900">Recent Activity</h2>
                    <Card className="border-black/5 bg-white/80 backdrop-blur-md shadow-sm min-h-[200px]">
                        {stats.recentActivity.length > 0 ? (
                            <div className="divide-y divide-gray-100">
                                {stats.recentActivity.map((item, i) => (
                                    <div key={i} className="p-4 flex items-center justify-between hover:bg-gray-50 transition-colors">
                                        <div className="flex items-center gap-4">
                                            <div className="w-2 h-2 rounded-full bg-emerald-500" />
                                            <div>
                                                <p className="text-sm font-medium text-gray-900">{item.action}</p>
                                                <p className="text-xs text-gray-500">{item.target}</p>
                                            </div>
                                        </div>
                                        <span className="text-xs text-gray-400">{item.time}</span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full py-12 text-gray-400">
                                <p>No recent activity found.</p>
                            </div>
                        )}
                    </Card>
                    <Card className="bg-gradient-to-br from-gray-900 to-gray-800 text-white border-none shadow-xl">
                        <CardContent className="pt-6">
                            <h3 className="font-bold text-lg mb-2">Connect Desktop App</h3>
                            <p className="text-gray-400 text-sm mb-6">
                                Unlock the full power of Stuard by connecting your local environment.
                            </p>
                            <div className="space-y-3">
                                <Link href="/download" className="block">
                                    <Button variant="secondary" className="w-full bg-white text-gray-900 hover:bg-gray-100 border-none">
                                        Download Now
                                    </Button>
                                </Link>
                                <div className="text-center">
                                    <Link href="/docs" className="text-xs text-gray-400 hover:text-white">Read Documentation</Link>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
