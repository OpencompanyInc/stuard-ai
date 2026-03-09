'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useAuthContext } from '@/components/providers/AuthProvider';
import { supabase } from '@/lib/supabaseClient';

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
};

const CLOUD_API_URL = process.env.NEXT_PUBLIC_CLOUD_API_URL || 'https://api.stuard.ai';

export default function BillingPage() {
    const { user, userData, loading } = useAuthContext();
    const [isManaging, setIsManaging] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [amount, setAmount] = useState(30);
    const [creditSummary, setCreditSummary] = useState<CreditSummary | null>(null);
    const [creditsLoading, setCreditsLoading] = useState(true);

    useEffect(() => {
        let isActive = true;
        async function loadCredits() {
            if (!user) {
                if (isActive) {
                    setCreditSummary(null);
                    setCreditsLoading(false);
                }
                return;
            }
            try {
                setCreditsLoading(true);
                const { data: sessionDataRes } = await supabase.auth.getSession();
                const token = sessionDataRes.session?.access_token;
                if (!token) {
                    if (isActive) setCreditsLoading(false);
                    return;
                }
                const res = await fetch(`${CLOUD_API_URL}/v1/credits`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                const data = await res.json();
                if (isActive && data?.ok) {
                    setCreditSummary(data);
                }
            } catch (e: any) {
                if (isActive) setError((prev) => prev || String(e?.message || 'Failed to load credits.'));
            } finally {
                if (isActive) setCreditsLoading(false);
            }
        }
        loadCredits();
        return () => {
            isActive = false;
        };
    }, [user]);

    const currentPlan = (() => {
        const raw = String(creditSummary?.plan || userData?.plan || 'free').trim().toLowerCase();
        if (raw === 'free_trial' || raw === 'trial') return 'free';
        if (raw === 'starter') return 'starter';
        if (raw === 'pro') return 'pro';
        if (raw === 'power') return 'power';
        return raw || 'free';
    })();

    const payWhatYouWantProductId =
        process.env.NEXT_PUBLIC_POLAR_PRODUCT_PAYG_ID ||
        process.env.NEXT_PUBLIC_POLAR_PRODUCT_PRO_ID ||
        process.env.NEXT_PUBLIC_POLAR_PRODUCT_STARTER_ID;

    const baseRate = 33;
    const tier = useMemo(() => {
        if (amount >= 100) {
            return { name: 'Whale', multiplier: 2.0, badge: '2.0x Credits', accent: 'text-amber-600' };
        }
        if (amount >= 30) {
            return { name: 'Pro', multiplier: 1.5, badge: '1.5x Credits', accent: 'text-indigo-600' };
        }
        return { name: 'Starter', multiplier: 1.0, badge: 'Standard Rate', accent: 'text-emerald-600' };
    }, [amount]);

    const credits = Math.floor(amount * baseRate * tier.multiplier);

    const canManage = Boolean(user);
    const isFreePlan = currentPlan === 'free';

    const handleCheckout = async () => {
        setError(null);
        if (!user) {
            setError('Please sign in to upgrade.');
            return;
        }
        if (!payWhatYouWantProductId) {
            setError('Missing Polar product id for pay-what-you-want pricing.');
            return;
        }
        try {
            const metadata = JSON.stringify({ userId: user.id });
            const qs = new URLSearchParams({
                products: payWhatYouWantProductId,
                customerEmail: user.email || '',
                customerExternalId: user.id,
                metadata,
                amount: String(Math.round(amount * 100)),
            });
            window.location.href = `/api/polar/checkout?${qs.toString()}`;
        } catch (e: any) {
            setError(String(e?.message || 'Failed to start checkout.'));
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
                        {creditSummary && (
                            <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                                <div className="rounded-xl bg-white/10 px-4 py-3">
                                    <div className="text-gray-300">Available now</div>
                                    <div className="text-xl font-semibold text-white">
                                        {creditSummary.unlimited ? 'Unlimited' : Number(creditSummary.remaining || 0).toLocaleString()}
                                    </div>
                                </div>
                                <div className="rounded-xl bg-white/10 px-4 py-3">
                                    <div className="text-gray-300">Subscription pool</div>
                                    <div className="text-xl font-semibold text-white">{Number(creditSummary.includedRemaining || 0).toLocaleString()}</div>
                                </div>
                                <div className="rounded-xl bg-white/10 px-4 py-3">
                                    <div className="text-gray-300">Add-on pool</div>
                                    <div className="text-xl font-semibold text-white">{Number(creditSummary.addonRemaining || 0).toLocaleString()}</div>
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="flex flex-col items-end gap-3 w-full md:w-auto">
                        <Button
                            variant="outline"
                            className="bg-white/10 text-white border-white/20 hover:bg-white/20"
                            onClick={handleManage}
                            disabled={(!canManage && !isFreePlan) || isManaging || loading || creditsLoading}
                            isLoading={isManaging}
                        >
                            {isFreePlan ? 'View Plans' : 'Manage Subscription'}
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Plans */}
            <div id="plans">
                <h2 className="text-xl font-bold text-gray-900 mb-6">Choose your monthly amount</h2>
                <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-6">
                    <Card className="border border-black/5 shadow-sm bg-white/80 backdrop-blur-md">
                        <CardHeader>
                            <CardTitle className="text-lg">Pick your price</CardTitle>
                            <CardDescription>Pay what you want. Minimum $5. Credits roll over for 30 days.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="rounded-2xl border border-gray-200 bg-gradient-to-br from-white via-white to-indigo-50 p-6">
                                <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                                    <div>
                                        <p className="text-sm text-gray-500">Your price</p>
                                        <div className="text-4xl font-bold text-gray-900">${amount}</div>
                                        <p className="text-sm text-gray-500">billed monthly</p>
                                    </div>
                                    <div className="text-left md:text-right">
                                        <p className="text-sm text-gray-500">Tier status</p>
                                        <div className={`text-2xl font-semibold ${tier.accent}`}>{tier.name}</div>
                                        <div className="inline-flex items-center mt-1 rounded-full bg-black/90 px-3 py-1 text-xs font-semibold text-white">
                                            {tier.badge}
                                        </div>
                                    </div>
                                </div>
                                <div className="mt-6">
                                    <input
                                        type="range"
                                        min={5}
                                        max={200}
                                        step={1}
                                        value={amount}
                                        onChange={(event) => setAmount(Number(event.target.value))}
                                        className="w-full accent-indigo-600"
                                    />
                                    <div className="flex justify-between text-xs text-gray-500 mt-2">
                                        <span>$5</span>
                                        <span>$30</span>
                                        <span>$100</span>
                                        <span>$200</span>
                                    </div>
                                </div>
                            </div>

                            <div className="flex flex-wrap gap-3">
                                {[10, 30, 60, 100].map((preset) => (
                                    <button
                                        key={preset}
                                        onClick={() => setAmount(preset)}
                                        className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${amount === preset ? 'border-indigo-600 bg-indigo-600 text-white shadow-md' : 'border-gray-200 text-gray-700 hover:border-indigo-200 hover:text-indigo-700'}`}
                                    >
                                        ${preset}
                                    </button>
                                ))}
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="border border-black/5 shadow-sm bg-white/80 backdrop-blur-md">
                        <CardHeader>
                            <CardTitle className="text-lg">Estimated credits</CardTitle>
                            <CardDescription>
                                {creditSummary
                                    ? `You currently have ${creditSummary.unlimited ? 'unlimited credits' : `${Number(creditSummary.remaining || 0).toLocaleString()} credits available`}.`
                                    : 'Based on your chosen amount.'}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-5">
                            <div className="rounded-2xl bg-gray-900 p-6 text-white">
                                <p className="text-sm text-gray-300">Monthly credits</p>
                                <div className="text-4xl font-bold">{credits.toLocaleString()}</div>
                                <p className="text-sm text-gray-300 mt-2">${amount} × {baseRate} × {tier.multiplier}x</p>
                            </div>
                            <div className="space-y-3 text-sm text-gray-600">
                                <div className="flex items-center justify-between">
                                    <span>Credit rollover</span>
                                    <span className="font-semibold text-gray-900">30 days</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span>Upgrade anytime</span>
                                    <span className="font-semibold text-gray-900">Instantly applied</span>
                                </div>
                            </div>
                            <Button
                                className="w-full gradient-primary text-white font-bold border-0 shadow-sm"
                                disabled={!user || loading || isManaging}
                                onClick={handleCheckout}
                            >
                                Continue to checkout
                            </Button>
                            <p className="text-xs text-gray-500 text-center">Minimum $5/month. Cancel anytime.</p>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
