'use client';

import React, { useMemo, useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useAuthContext } from '@/components/providers/AuthProvider';
import { supabase } from '@/lib/supabaseClient';

export default function BillingPage() {
    const { user, userData, loading } = useAuthContext();
    const [isManaging, setIsManaging] = useState(false);
    const [upgradeLoadingId, setUpgradeLoadingId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const currentPlan = (() => {
        const raw = String(userData?.plan || 'free').trim().toLowerCase();
        if (raw === 'free_trial' || raw === 'trial') return 'free';
        if (raw === 'starter') return 'starter';
        if (raw === 'pro') return 'pro';
        if (raw === 'power') return 'power';
        return raw || 'free';
    })();

    const plans = useMemo(
        () => [
            {
                id: 'free',
                name: 'Free',
                productId: process.env.NEXT_PUBLIC_POLAR_PRODUCT_FREE_ID || undefined,
                price: '$0',
                period: '',
                description: 'Trial + BYOK friendly.',
                features: ['50 credits included', 'Desktop App Access', 'Cancel anytime'],
            },
            {
                id: 'starter',
                name: 'Starter',
                productId: process.env.NEXT_PUBLIC_POLAR_PRODUCT_STARTER_ID,
                price: '$10',
                period: '/month',
                description: 'For everyday assistance.',
                features: ['≈650 credits/mo', 'All models included', 'Standard support'],
            },
            {
                id: 'pro',
                name: 'Pro',
                productId: process.env.NEXT_PUBLIC_POLAR_PRODUCT_PRO_ID,
                price: '$45',
                period: '/month',
                description: 'For power users.',
                features: ['≈2,925 credits/mo', 'All models included', 'Priority support'],
                popular: true,
            },
            {
                id: 'power',
                name: 'Power',
                productId: process.env.NEXT_PUBLIC_POLAR_PRODUCT_POWER_ID,
                price: '$100',
                period: '/month',
                description: 'For maximum throughput.',
                features: ['≈6,500 credits/mo', 'All models included', 'Best support response times'],
            },
        ],
        []
    );

    const canManage = Boolean(user);
    const isFreePlan = currentPlan === 'free';

    const handleUpgrade = async (planId: string, productId?: string) => {
        setError(null);
        if (!user) {
            setError('Please sign in to upgrade.');
            return;
        }
        if (!productId) {
            setError('Missing Polar product id for this plan.');
            return;
        }
        setUpgradeLoadingId(planId);
        try {
            const metadata = JSON.stringify({ userId: user.id });
            const qs = new URLSearchParams({
                products: productId,
                customerEmail: user.email || '',
                customerExternalId: user.id,
                metadata,
            });
            window.location.href = `/api/polar/checkout?${qs.toString()}`;
        } catch (e: any) {
            setError(String(e?.message || 'Failed to start checkout.'));
        } finally {
            setUpgradeLoadingId(null);
        }
    };

    const handleManage = async () => {
        setError(null);

        if (isFreePlan) {
            document.getElementById('plans')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            return;
        }

        if (!user) {
            setError('Please sign in to manage your subscription.');
            return;
        }
        setIsManaging(true);
        try {
            const { data: sessionDataRes } = await supabase.auth.getSession();
            const token = sessionDataRes.session?.access_token;
            if (!token) {
                setError('Missing session token. Please sign in again.');
                return;
            }

            const response = await fetch('/api/polar/portal', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });
            const data = await response.json();
            if (!response.ok) {
                setError(data?.error || 'Failed to open customer portal.');
                return;
            }
            if (data?.url) {
                window.location.href = data.url;
                return;
            }
            setError('No portal URL returned.');
        } catch (e: any) {
            setError(String(e?.message || 'Failed to open customer portal.'));
        } finally {
            setIsManaging(false);
        }
    };

    return (
        <div className="space-y-8 max-w-6xl mx-auto">
            <div>
                <h1 className="text-3xl font-bold text-gray-900">Billing & Plans</h1>
                <p className="text-gray-500 mt-1">Manage your subscription and billing history.</p>
            </div>

            {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {error}
                </div>
            )}

            {/* Current Usage / Plan summary */}
            <Card className="bg-gradient-to-r from-gray-900 to-gray-800 text-white border-none shadow-lg">
                <CardContent className="p-8 flex flex-col md:flex-row items-center justify-between gap-6">
                    <div>
                        <h2 className="text-lg font-medium text-gray-300">Current Plan</h2>
                        <div className="text-4xl font-bold mt-1 capitalize">{currentPlan}</div>
                        <p className="text-gray-400 mt-2 text-sm">
                            {currentPlan === 'free' ? 'Upgrade to unlock more power.' : 'Thanks for being a subscriber.'}
                        </p>
                    </div>
                    <div className="flex flex-col items-end gap-3 w-full md:w-auto">
                        <Button
                            variant="outline"
                            className="bg-white/10 text-white border-white/20 hover:bg-white/20"
                            onClick={handleManage}
                            disabled={(!canManage && !isFreePlan) || isManaging || loading}
                            isLoading={isManaging}
                        >
                            {isFreePlan ? 'View Plans' : 'Manage Subscription'}
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Plans */}
            <div id="plans">
                <h2 className="text-xl font-bold text-gray-900 mb-6">Available Plans</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    {plans.map((plan) => {
                        const isCurrent = currentPlan === plan.id;
                        const isFree = plan.id === 'free';
                        return (
                            <Card
                                key={plan.name}
                                className={`flex flex-col ${plan.popular && !isCurrent ? 'border-blue-500 shadow-md ring-1 ring-blue-500' : 'border-gray-200'} ${isCurrent ? 'bg-gray-50/50 ring-2 ring-green-500 border-green-500' : ''}`}
                            >
                                <CardHeader>
                                    <div className="flex justify-between items-center mb-2">
                                        <CardTitle className="text-lg">{plan.name}</CardTitle>
                                        {plan.popular && !isCurrent && <span className="bg-blue-100 text-blue-700 text-xs px-2 py-1 rounded-full font-bold">Popular</span>}
                                        {isCurrent && <span className="bg-green-100 text-green-700 text-xs px-2 py-1 rounded-full font-bold">Current</span>}
                                    </div>
                                    <div className="flex items-baseline gap-1">
                                        <span className="text-3xl font-bold text-gray-900">{plan.price}</span>
                                        <span className="text-sm text-gray-500">{plan.period}</span>
                                    </div>
                                    <CardDescription>{plan.description}</CardDescription>
                                </CardHeader>
                                <CardContent className="flex-1 flex flex-col">
                                    <ul className="space-y-3 mb-6 flex-1">
                                        {plan.features.map((feature, i) => (
                                            <li key={i} className="flex items-center text-sm text-gray-600">
                                                <svg className="w-4 h-4 text-green-500 mr-2 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                </svg>
                                                {feature}
                                            </li>
                                        ))}
                                    </ul>
                                    <Button
                                        className="w-full"
                                        variant={isCurrent || isFree ? "outline" : "primary"}
                                        disabled={isCurrent || !user || loading || upgradeLoadingId === plan.id || isManaging}
                                        isLoading={isFree ? isManaging : upgradeLoadingId === plan.id}
                                        onClick={() => (isFree ? handleManage() : handleUpgrade(plan.id, plan.productId))}
                                    >
                                        {isCurrent ? 'Current Plan' : isFree ? 'Switch to Free' : 'Upgrade'}
                                    </Button>
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
