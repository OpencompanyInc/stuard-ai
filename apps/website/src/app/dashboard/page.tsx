'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useAuthContext } from '@/components/providers/AuthProvider';
import { supabase } from '@/lib/supabaseClient';

export default function DashboardPage() {
    const { user, userData } = useAuthContext();
    const userName = userData?.displayName || user?.email?.split('@')[0] || 'User';

    const [stats, setStats] = useState({
        creditsUsed: 0,
        creditsLimit: 5000, // Default trial limit
        activeWorkflows: 0,
        recentActivity: [] as any[]
    });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user) return;

        async function loadStats() {
            try {
                // 1. Fetch usage for current month
                const now = new Date();
                const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

                const { data: usageEvents } = await supabase
                    .from('usage_events')
                    .select('cost_usd, created_at')
                    .eq('user_id', user!.id)
                    .gte('created_at', startOfMonth);

                // Calculate total credits used (assuming 1 credit = $0.01 or similar, adjusting simply to count matches)
                // Adjust logic based on your actual credit system. Here strictly summing cost_usd * 100 as credits
                const totalCostUsd = usageEvents?.reduce((acc, curr) => acc + (curr.cost_usd || 0), 0) || 0;
                const creditsUsed = Math.ceil(totalCostUsd * 100);

                // 2. Fetch active workflows (conversations)
                const { count: workflowCount } = await supabase
                    .from('conversations')
                    .select('*', { count: 'exact', head: true })
                    .eq('user_id', user!.id);

                // 3. Recent Activity (mix of usage and other events if available, for now just recent usage)
                const recent = usageEvents?.slice(0, 5).map(e => ({
                    action: 'AI Interaction',
                    target: `$${e.cost_usd} cost`,
                    time: new Date(e.created_at).toLocaleDateString(),
                    status: 'success'
                })) || [];

                setStats({
                    creditsUsed,
                    creditsLimit: userData?.plan === 'pro' ? 50000 : userData?.plan === 'starter' ? 10000 : 500, // Mock limits based on plan
                    activeWorkflows: workflowCount || 0,
                    recentActivity: recent
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
    const planColor = userData?.plan === 'pro' || userData?.plan === 'power' ? 'bg-violet-500' : 'bg-emerald-500';

    return (
        <div className="space-y-8 max-w-6xl mx-auto">
            {/* Welcome Section */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900">Welcome back, {userName}</h1>
                    <p className="text-gray-500 mt-1">Here&apos;s what&apos;s happening with your agents today.</p>
                </div>
                <div className="flex gap-3">
                    <Link href="/download">
                        <Button variant="outline" className="bg-white">Download App</Button>
                    </Link>
                    <Button disabled>New Workflow</Button>
                </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Plan Card */}
                <Card className="border-none shadow-md overflow-hidden relative group hover:shadow-lg transition-all">
                    <div className={`absolute top-0 left-0 w-1.5 h-full ${planColor}`} />
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-gray-500 uppercase tracking-wider">Current Plan</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-gray-900 mb-1">{planName}</div>
                        <p className="text-sm text-gray-400">Active</p>
                    </CardContent>
                </Card>

                {/* Credits Card */}
                <Card className="border-none shadow-md overflow-hidden relative group hover:shadow-lg transition-all">
                    <div className="absolute top-0 left-0 w-1.5 h-full bg-blue-500" />
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-gray-500 uppercase tracking-wider">Credits Used</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-gray-900 mb-1">
                            {loading ? '...' : stats.creditsUsed.toLocaleString()}
                        </div>
                        <p className="text-sm text-gray-400">of {stats.creditsLimit.toLocaleString()} monthly limit</p>
                    </CardContent>
                </Card>

                {/* Automations Card */}
                <Card className="border-none shadow-md overflow-hidden relative group hover:shadow-lg transition-all">
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
                {/* Recent Activity */}
                <div className="lg:col-span-2 space-y-6">
                    <div className="flex items-center justify-between">
                        <h2 className="text-xl font-bold text-gray-900">Recent Activity</h2>
                    </div>
                    <Card className="border-gray-200 bg-white shadow-sm min-h-[200px]">
                        {stats.recentActivity.length > 0 ? (
                            <div className="divide-y divide-gray-100">
                                {stats.recentActivity.map((item, i) => (
                                    <div key={i} className="p-4 flex items-center justify-between hover:bg-gray-50 transition-colors">
                                        <div className="flex items-center gap-4">
                                            <div className="w-2 h-2 rounded-full bg-green-500" />
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
                </div>

                {/* Quick Actions / Getting Started */}
                <div className="space-y-6">
                    <h2 className="text-xl font-bold text-gray-900">Quick Actions</h2>
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
