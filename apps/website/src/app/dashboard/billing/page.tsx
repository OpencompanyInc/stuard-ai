'use client';

import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useAuthContext } from '@/components/providers/AuthProvider';

export default function BillingPage() {
    const { userData } = useAuthContext();
    const currentPlan = userData?.plan || 'free';

    const plans = [
        {
            id: 'free',
            name: 'Free',
            price: '$0',
            period: '/month',
            description: 'For personal hobby experimentation.',
            features: ['50 credits/mo', 'Community support', 'Desktop App Access'],
        },
        {
            id: 'starter',
            name: 'Starter',
            price: '$10',
            period: '/month',
            description: 'For everyday assistance.',
            features: ['650 credits/mo', 'Standard support'],
        },
        {
            id: 'pro',
            name: 'Pro',
            price: '$45',
            period: '/month',
            description: 'For serious power users.',
            features: ['3,000 credits/mo', 'Priority support', 'Advanced Models'],
            popular: true,
        },
        {
            id: 'power',
            name: 'Power',
            price: '$100',
            period: '/month',
            description: 'For maximum throughput.',
            features: ['6,500 credits/mo', 'Dedicated support', 'Early access features'],
        },
    ];

    return (
        <div className="space-y-8 max-w-6xl mx-auto">
            <div>
                <h1 className="text-3xl font-bold text-gray-900">Billing & Plans</h1>
                <p className="text-gray-500 mt-1">Manage your subscription and billing history.</p>
            </div>

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
                        <Button variant="outline" className="bg-white/10 text-white border-white/20 hover:bg-white/20">
                            Manage Subscription
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Plans */}
            <div>
                <h2 className="text-xl font-bold text-gray-900 mb-6">Available Plans</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    {plans.map((plan) => {
                        const isCurrent = currentPlan === plan.id;
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
                                        variant={isCurrent ? "outline" : "default"}
                                        disabled={isCurrent}
                                    >
                                        {isCurrent ? 'Current Plan' : 'Upgrade'}
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
