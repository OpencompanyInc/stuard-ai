'use client';

import React, { useEffect, useMemo, useState } from 'react';
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
                if (isActive) { setCreditSummary(null); setCreditsLoading(false); }
                return;
            }
            try {
                setCreditsLoading(true);
                const { data: sessionDataRes } = await supabase.auth.getSession();
                const token = sessionDataRes.session?.access_token;
                if (!token) { if (isActive) setCreditsLoading(false); return; }
                const res = await fetch(`${CLOUD_API_URL}/v1/credits`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                const data = await res.json();
                if (isActive && data?.ok) setCreditSummary(data);
            } catch (e: any) {
                if (isActive) setError((prev) => prev || String(e?.message || 'Failed to load credits.'));
            } finally {
                if (isActive) setCreditsLoading(false);
            }
        }
        loadCredits();
        return () => { isActive = false; };
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
        if (amount >= 100) return { name: 'Whale', multiplier: 0.75, badge: 'Best Rate', color: 'text-amber-600' };
        if (amount >= 30) return { name: 'Pro', multiplier: 0.70, badge: 'Boosted Rate', color: 'text-gray-900' };
        return { name: 'Starter', multiplier: 0.65, badge: 'Standard Rate', color: 'text-gray-600' };
    }, [amount]);

    const credits = Math.floor(amount * baseRate * tier.multiplier);
    const canManage = Boolean(user);
    const isFreePlan = currentPlan === 'free';

    const handleCheckout = async () => {
        setError(null);
        if (!user) { setError('Please sign in to upgrade.'); return; }
        if (!payWhatYouWantProductId) { setError('Missing Polar product id for pay-what-you-want pricing.'); return; }
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
        if (!user) { setError('Please sign in to manage your subscription.'); return; }
        setIsManaging(true);
        try {
            const { data: sessionDataRes } = await supabase.auth.getSession();
            const token = sessionDataRes.session?.access_token;
            if (!token) { setError('Missing session token. Please sign in again.'); return; }
            const response = await fetch('/api/polar/portal', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await response.json();
            if (!response.ok) { setError(data?.error || 'Failed to open customer portal.'); return; }
            if (data?.url) { window.location.href = data.url; return; }
            setError('No portal URL returned.');
        } catch (e: any) {
            setError(String(e?.message || 'Failed to open customer portal.'));
        } finally {
            setIsManaging(false);
        }
    };

    return (
        <div className="space-y-8 max-w-4xl">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold text-gray-900">Billing & Plans</h1>
                <p className="text-sm text-gray-500 mt-1">Manage your subscription and credits.</p>
            </div>

            {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
                    {error}
                </div>
            )}

            {/* Current Plan Card */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-5">
                    <div>
                        <p className="text-[13px] font-medium text-gray-500">Current Plan</p>
                        <p className="text-3xl font-bold text-gray-900 mt-1 capitalize">{currentPlan}</p>
                        <p className="text-[13px] text-gray-500 mt-1">
                            {isFreePlan ? 'Upgrade to unlock more power.' : 'Thanks for being a subscriber.'}
                        </p>
                    </div>
                    <button
                        onClick={handleManage}
                        disabled={(!canManage && !isFreePlan) || isManaging || loading || creditsLoading}
                        className="px-4 py-2.5 text-[13px] font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
                    >
                        {isManaging ? 'Loading…' : isFreePlan ? 'View Plans' : 'Manage Subscription'}
                    </button>
                </div>

                {creditSummary && (
                    <div className="mt-6 pt-5 border-t border-gray-100 grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="bg-gray-50 rounded-lg px-4 py-3">
                            <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Available Now</p>
                            <p className="text-xl font-semibold text-gray-900 mt-0.5">
                                {creditSummary.unlimited ? 'Unlimited' : Number(creditSummary.remaining || 0).toLocaleString()}
                            </p>
                        </div>
                        <div className="bg-gray-50 rounded-lg px-4 py-3">
                            <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Subscription Pool</p>
                            <p className="text-xl font-semibold text-gray-900 mt-0.5">
                                {Number(creditSummary.includedRemaining || 0).toLocaleString()}
                            </p>
                        </div>
                        <div className="bg-gray-50 rounded-lg px-4 py-3">
                            <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Add-on Pool</p>
                            <p className="text-xl font-semibold text-gray-900 mt-0.5">
                                {Number(creditSummary.addonRemaining || 0).toLocaleString()}
                            </p>
                        </div>
                    </div>
                )}
            </div>

            {/* Pay What You Want */}
            <div id="plans">
                <h2 className="text-[15px] font-semibold text-gray-900 mb-4">Choose your monthly amount</h2>
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
                    {/* Slider */}
                    <div className="lg:col-span-3 bg-white rounded-xl border border-gray-200 p-6">
                        <p className="text-[13px] font-medium text-gray-900 mb-1">Pick your price</p>
                        <p className="text-[12px] text-gray-500 mb-5">Pay what you want. Minimum $5. Credits roll over for 30 days.</p>

                        <div className="rounded-lg border border-gray-100 bg-gray-50 p-5">
                            <div className="flex items-end justify-between mb-1">
                                <div>
                                    <p className="text-[12px] text-gray-500">Your price</p>
                                    <p className="text-3xl font-bold text-gray-900">${amount}</p>
                                    <p className="text-[12px] text-gray-500">per month</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-[12px] text-gray-500">Tier</p>
                                    <p className={`text-xl font-semibold ${tier.color}`}>{tier.name}</p>
                                    <span className="inline-flex mt-1 px-2 py-0.5 rounded-full bg-gray-900 text-[11px] font-medium text-white">
                                        {tier.badge}
                                    </span>
                                </div>
                            </div>
                            <div className="mt-5">
                                <input
                                    type="range"
                                    min={5}
                                    max={200}
                                    step={1}
                                    value={amount}
                                    onChange={(e) => setAmount(Number(e.target.value))}
                                    className="w-full accent-gray-900"
                                />
                                <div className="flex justify-between text-[11px] text-gray-400 mt-1">
                                    <span>$5</span>
                                    <span>$30</span>
                                    <span>$100</span>
                                    <span>$200</span>
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-wrap gap-2 mt-4">
                            {[10, 30, 60, 100].map((preset) => (
                                <button
                                    key={preset}
                                    onClick={() => setAmount(preset)}
                                    className={`rounded-lg border px-3.5 py-2 text-[13px] font-medium transition-colors ${
                                        amount === preset
                                            ? 'border-gray-900 bg-gray-900 text-white'
                                            : 'border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                                    }`}
                                >
                                    ${preset}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Credits estimate */}
                    <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-6 flex flex-col">
                        <p className="text-[13px] font-medium text-gray-900 mb-1">Estimated credits</p>
                        <p className="text-[12px] text-gray-500 mb-5">
                            {creditSummary
                                ? `You have ${creditSummary.unlimited ? 'unlimited credits' : `${Number(creditSummary.remaining || 0).toLocaleString()} credits`} now.`
                                : 'Based on your chosen amount.'}
                        </p>

                        <div className="rounded-lg bg-gray-900 p-5 text-white mb-5">
                            <p className="text-[12px] text-gray-400">Monthly credits</p>
                            <p className="text-3xl font-bold mt-0.5">{credits.toLocaleString()}</p>
                            <p className="text-[12px] text-gray-400 mt-1">${amount}/mo · {tier.name} tier</p>
                        </div>

                        <div className="space-y-3 text-[13px] mb-5">
                            <div className="flex justify-between">
                                <span className="text-gray-500">Credit rollover</span>
                                <span className="font-medium text-gray-900">30 days</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500">Upgrade anytime</span>
                                <span className="font-medium text-gray-900">Instantly applied</span>
                            </div>
                        </div>

                        <div className="mt-auto space-y-2">
                            <button
                                disabled={!user || loading || isManaging}
                                onClick={handleCheckout}
                                className="w-full py-2.5 text-[13px] font-medium text-white bg-gray-900 rounded-lg hover:bg-black transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                Continue to checkout
                            </button>
                            <p className="text-[11px] text-gray-400 text-center">Minimum $5/month. Cancel anytime.</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
