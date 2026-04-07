'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
    creditsPerUsd?: number;
};

type UsageBreakdownItem = {
    category: string;
    credits: number;
    costUsd: number;
    count: number;
};

type CreditTransaction = {
    id: string;
    entryType: string;
    sourceType: string;
    sourceRef: string;
    credits: number;
    amountUsd: number | null;
    metadata: any;
    createdAt: string;
};

const CLOUD_API_URL = process.env.NEXT_PUBLIC_CLOUD_API_URL || 'https://api.stuard.ai';

const ADDON_PACKS = [
    { id: 'addon_5', label: '$5', amount: 500, credits: '~107', desc: 'Quick top-up' },
    { id: 'addon_10', label: '$10', amount: 1000, credits: '~231', desc: 'Standard pack' },
    { id: 'addon_25', label: '$25', amount: 2500, credits: '~577', desc: 'Popular choice' },
    { id: 'addon_50', label: '$50', amount: 5000, credits: '~1,237', desc: 'Power pack' },
];

const CATEGORY_CONFIG: Record<string, { label: string; color: string }> = {
    inference: { label: 'AI Inference', color: 'bg-blue-500' },
    subagent: { label: 'Delegated Agents', color: 'bg-purple-500' },
    compute: { label: 'Cloud Compute', color: 'bg-amber-500' },
    storage: { label: 'Storage', color: 'bg-teal-500' },
    messaging: { label: 'Messaging', color: 'bg-rose-500' },
};

const SOURCE_LABELS: Record<string, string> = {
    usage: 'AI Inference',
    inference: 'AI Inference',
    subagent: 'Delegated Agent',
    compute: 'Cloud Compute',
    hot_storage: 'Storage',
    cold_storage: 'Cold Storage',
    telnyx: 'SMS (Telnyx)',
    whatsapp: 'WhatsApp',
    subscription_cycle: 'Subscription',
    addon_purchase: 'Add-on Purchase',
    promo: 'Promotional',
    trial: 'Trial Credits',
    admin_adjustment: 'Admin Adjustment',
    refund: 'Refund',
};

function formatDate(iso: string): string {
    try {
        return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return iso; }
}

async function getAuthToken(): Promise<string | null> {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
}

async function apiFetch<T = any>(path: string): Promise<T | null> {
    const token = await getAuthToken();
    if (!token) return null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
        const res = await fetch(`${CLOUD_API_URL}${path}`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
        });
        const data = await res.json();
        return data?.ok ? data : null;
    } catch (e: any) {
        if (e?.name === 'AbortError') throw new Error('Request timed out. Please try again.');
        throw e;
    } finally {
        clearTimeout(timeout);
    }
}

export default function BillingPage() {
    const { user, userData, loading } = useAuthContext();
    const [isManaging, setIsManaging] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [amount, setAmount] = useState(30);
    const [creditSummary, setCreditSummary] = useState<CreditSummary | null>(null);
    const [creditsLoading, setCreditsLoading] = useState(true);
    const [usageBreakdown, setUsageBreakdown] = useState<UsageBreakdownItem[]>([]);
    const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
    const [txTotal, setTxTotal] = useState(0);
    const [txLoading, setTxLoading] = useState(false);
    const [addonLoading, setAddonLoading] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'overview' | 'history'>('overview');

    const loadData = useCallback(async () => {
        if (!user) { setCreditSummary(null); setCreditsLoading(false); return; }
        try {
            setCreditsLoading(true);
            setError(null);
            const [creditsData, usageData, txData] = await Promise.all([
                apiFetch<any>('/v1/credits'),
                apiFetch<any>('/v1/credits/usage'),
                apiFetch<any>('/v1/credits/transactions?limit=20'),
            ]);
            if (creditsData) setCreditSummary(creditsData);
            if (usageData?.breakdown) setUsageBreakdown(usageData.breakdown);
            if (txData?.transactions) { setTransactions(txData.transactions); setTxTotal(txData.total || 0); }
            if (!creditsData && !usageData && !txData) {
                setError('Could not load billing data. The server may be temporarily unavailable.');
            }
        } catch (e: any) {
            setError(String(e?.message || 'Failed to load billing data.'));
        } finally {
            setCreditsLoading(false);
        }
    }, [user]);

    useEffect(() => { loadData(); }, [loadData]);

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

    const usageTotal = usageBreakdown.reduce((s, b) => s + b.credits, 0);
    const usagePercent = creditSummary && !creditSummary.unlimited && creditSummary.limit && creditSummary.limit > 0
        ? Math.min(100, Math.round(((creditSummary.used || 0) / creditSummary.limit) * 100))
        : 0;

    const handleCheckout = async () => {
        setError(null);
        if (!user) { setError('Please sign in to upgrade.'); return; }
        if (!payWhatYouWantProductId) { setError('Missing Polar product id.'); return; }
        const metadata = JSON.stringify({ userId: user.id });
        const qs = new URLSearchParams({
            products: payWhatYouWantProductId,
            customerEmail: user.email || '',
            customerExternalId: user.id,
            metadata,
            amount: String(Math.round(amount * 100)),
        });
        window.location.href = `/api/polar/checkout?${qs.toString()}`;
    };

    const handleAddonPurchase = async (pack: typeof ADDON_PACKS[number]) => {
        setError(null);
        if (!user) { setError('Please sign in first.'); return; }
        if (!payWhatYouWantProductId) { setError('Checkout not configured.'); return; }
        setAddonLoading(pack.id);
        try {
            const metadata = JSON.stringify({ userId: user.id, type: 'addon', packId: pack.id });
            const qs = new URLSearchParams({
                products: payWhatYouWantProductId,
                customerEmail: user.email || '',
                customerExternalId: user.id,
                metadata,
                amount: String(pack.amount),
            });
            window.location.href = `/api/polar/checkout?${qs.toString()}`;
        } catch (e: any) {
            setError(String(e?.message || 'Failed to start checkout.'));
        } finally {
            setAddonLoading(null);
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
            const token = await getAuthToken();
            if (!token) { setError('Missing session token.'); return; }
            const response = await fetch('/api/polar/portal', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await response.json();
            if (!response.ok) { setError(data?.error || 'Failed to open portal.'); return; }
            if (data?.url) { window.location.href = data.url; return; }
            setError('No portal URL returned.');
        } catch (e: any) {
            setError(String(e?.message || 'Failed to open customer portal.'));
        } finally {
            setIsManaging(false);
        }
    };

    const handleLoadMoreTx = async () => {
        if (txLoading || transactions.length >= txTotal) return;
        setTxLoading(true);
        try {
            const data = await apiFetch<any>(`/v1/credits/transactions?limit=20&offset=${transactions.length}`);
            if (data?.transactions) {
                setTransactions(prev => [...prev, ...data.transactions]);
                setTxTotal(data.total || txTotal);
            }
        } catch {} finally { setTxLoading(false); }
    };

    return (
        <div className="space-y-8 max-w-4xl">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold text-gray-900">Billing & Credits</h1>
                <p className="text-sm text-gray-500 mt-1">Manage your subscription, credits, and usage.</p>
            </div>

            {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700 flex items-center justify-between">
                    <span>{error}</span>
                    <div className="flex items-center gap-2 ml-4">
                        <button onClick={() => { setError(null); loadData(); }} className="underline font-medium">retry</button>
                        <button onClick={() => setError(null)} className="underline">dismiss</button>
                    </div>
                </div>
            )}

            {/* Loading skeleton */}
            {creditsLoading && !creditSummary && (
                <div className="bg-white rounded-xl border border-gray-200 p-6 animate-pulse">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-5">
                        <div className="space-y-2">
                            <div className="h-3 w-20 bg-gray-200 rounded" />
                            <div className="h-8 w-32 bg-gray-200 rounded" />
                            <div className="h-3 w-48 bg-gray-200 rounded" />
                        </div>
                        <div className="h-10 w-40 bg-gray-200 rounded-lg" />
                    </div>
                    <div className="mt-5 pt-5 border-t border-gray-100 grid grid-cols-1 sm:grid-cols-3 gap-4">
                        {[1, 2, 3].map(i => (
                            <div key={i} className="bg-gray-50 rounded-lg px-4 py-3">
                                <div className="h-2.5 w-16 bg-gray-200 rounded mb-2" />
                                <div className="h-6 w-20 bg-gray-200 rounded" />
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Current Plan & Balance Card */}
            {(!creditsLoading || creditSummary) && (
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
                        {isManaging ? 'Loading...' : isFreePlan ? 'View Plans' : 'Manage Subscription'}
                    </button>
                </div>

                {creditSummary && (
                    <>
                        {/* Usage progress bar */}
                        {!creditSummary.unlimited && creditSummary.limit && creditSummary.limit > 0 && (
                            <div className="mt-5">
                                <div className="flex justify-between text-[12px] text-gray-500 mb-1.5">
                                    <span>{Number(creditSummary.used || 0).toLocaleString()} used</span>
                                    <span>{Number(creditSummary.limit).toLocaleString()} total</span>
                                </div>
                                <div className="w-full bg-gray-100 rounded-full h-2.5">
                                    <div
                                        className={`h-2.5 rounded-full transition-all ${usagePercent >= 90 ? 'bg-red-500' : usagePercent >= 70 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                                        style={{ width: `${usagePercent}%` }}
                                    />
                                </div>
                            </div>
                        )}

                        <div className="mt-5 pt-5 border-t border-gray-100 grid grid-cols-1 sm:grid-cols-3 gap-4">
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
                    </>
                )}
            </div>
            )}

            {/* Tabs: Overview | History */}
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
                {(['overview', 'history'] as const).map(tab => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`px-4 py-2 text-[13px] font-medium rounded-md transition-colors capitalize ${
                            activeTab === tab ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                        }`}
                    >
                        {tab}
                    </button>
                ))}
            </div>

            {activeTab === 'overview' && (
                <>
                    {/* Usage Breakdown */}
                    {usageBreakdown.length > 0 && (
                        <div className="bg-white rounded-xl border border-gray-200 p-6">
                            <h2 className="text-[15px] font-semibold text-gray-900 mb-4">Usage This Period</h2>

                            {/* Stacked bar */}
                            <div className="flex w-full h-4 rounded-full overflow-hidden bg-gray-100 mb-4">
                                {usageBreakdown.map(item => {
                                    const pct = usageTotal > 0 ? (item.credits / usageTotal) * 100 : 0;
                                    if (pct < 0.5) return null;
                                    const config = CATEGORY_CONFIG[item.category] || { color: 'bg-gray-400' };
                                    return (
                                        <div
                                            key={item.category}
                                            className={`${config.color} transition-all`}
                                            style={{ width: `${pct}%` }}
                                            title={`${config.label || item.category}: ${item.credits.toFixed(1)} credits`}
                                        />
                                    );
                                })}
                            </div>

                            {/* Legend table */}
                            <div className="space-y-2">
                                {usageBreakdown.map(item => {
                                    const config = CATEGORY_CONFIG[item.category] || { label: item.category, color: 'bg-gray-400' };
                                    const pct = usageTotal > 0 ? ((item.credits / usageTotal) * 100).toFixed(1) : '0';
                                    return (
                                        <div key={item.category} className="flex items-center justify-between text-[13px]">
                                            <div className="flex items-center gap-2.5">
                                                <div className={`w-3 h-3 rounded-sm ${config.color}`} />
                                                <span className="text-gray-700 font-medium">{config.label}</span>
                                                <span className="text-gray-400">({item.count} calls)</span>
                                            </div>
                                            <div className="flex items-center gap-4">
                                                <span className="text-gray-500">{pct}%</span>
                                                <span className="font-semibold text-gray-900 w-20 text-right">
                                                    {item.credits.toFixed(1)}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                                <div className="flex items-center justify-between text-[13px] pt-2 border-t border-gray-100">
                                    <span className="text-gray-500 font-medium">Total</span>
                                    <span className="font-bold text-gray-900 w-20 text-right">{usageTotal.toFixed(1)}</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Quick Add-on Credit Purchase */}
                    <div className="bg-white rounded-xl border border-gray-200 p-6">
                        <h2 className="text-[15px] font-semibold text-gray-900 mb-1">Top Up Credits</h2>
                        <p className="text-[12px] text-gray-500 mb-4">One-time add-on packs. Credits never expire while your account is active.</p>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            {ADDON_PACKS.map(pack => (
                                <button
                                    key={pack.id}
                                    onClick={() => handleAddonPurchase(pack)}
                                    disabled={!user || !!addonLoading}
                                    className="p-4 rounded-xl border border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-all text-left group disabled:opacity-50"
                                >
                                    <div className="text-xl font-bold text-gray-900 group-hover:text-primary transition-colors">
                                        {pack.label}
                                    </div>
                                    <div className="text-[12px] text-gray-500 mt-0.5">{pack.credits} credits</div>
                                    <div className="text-[11px] text-gray-400 mt-1">{pack.desc}</div>
                                    {addonLoading === pack.id && (
                                        <div className="text-[11px] text-primary mt-1 font-medium">Redirecting...</div>
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Pay What You Want */}
                    <div id="plans">
                        <h2 className="text-[15px] font-semibold text-gray-900 mb-4">Choose your monthly amount</h2>
                        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
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
                                            <span>$5</span><span>$30</span><span>$100</span><span>$200</span>
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
                                    <p className="text-[12px] text-gray-400 mt-1">${amount}/mo &middot; {tier.name} tier</p>
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
                </>
            )}

            {activeTab === 'history' && (
                <div className="bg-white rounded-xl border border-gray-200 p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-[15px] font-semibold text-gray-900">Transaction History</h2>
                        <span className="text-[12px] text-gray-400">{txTotal} total</span>
                    </div>

                    {transactions.length === 0 && !creditsLoading && (
                        <p className="text-[13px] text-gray-400 text-center py-8">No transactions yet.</p>
                    )}

                    {transactions.length > 0 && (
                        <div className="divide-y divide-gray-100">
                            {transactions.map(tx => {
                                const isGrant = tx.entryType === 'grant' || tx.entryType === 'refund';
                                const label = SOURCE_LABELS[tx.sourceType] || tx.sourceType;
                                return (
                                    <div key={tx.id} className="flex items-center justify-between py-3 text-[13px]">
                                        <div>
                                            <p className="font-medium text-gray-900">{label}</p>
                                            <p className="text-[11px] text-gray-400">{formatDate(tx.createdAt)}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className={`font-semibold ${isGrant ? 'text-emerald-600' : 'text-gray-900'}`}>
                                                {isGrant ? '+' : '-'}{tx.credits.toFixed(1)}
                                            </p>
                                            {tx.amountUsd != null && (
                                                <p className="text-[11px] text-gray-400">
                                                    ${Math.abs(tx.amountUsd).toFixed(4)}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {transactions.length < txTotal && (
                        <button
                            onClick={handleLoadMoreTx}
                            disabled={txLoading}
                            className="mt-4 w-full py-2 text-[13px] font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                        >
                            {txLoading ? 'Loading...' : 'Load more'}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
