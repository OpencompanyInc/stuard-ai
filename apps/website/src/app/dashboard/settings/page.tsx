'use client';

import React, { useState, useEffect } from 'react';
import { useAuthContext } from '@/components/providers/AuthProvider';

export default function SettingsPage() {
    const { user, userData, updateUserData } = useAuthContext();
    const [phoneNumber, setPhoneNumber] = useState('');
    const [loading, setLoading] = useState(false);
    const [marketingEmailEnabled, setMarketingEmailEnabled] = useState(false);

    useEffect(() => {
        if (userData) {
            setPhoneNumber(userData.phoneNumber || '');
            setMarketingEmailEnabled(userData.preferences?.marketingEmails ?? false);
        }
    }, [userData]);

    const handleUpdatePreference = async (key: 'marketingEmails', value: boolean) => {
        setMarketingEmailEnabled(value);
        try {
            await updateUserData({ preferences: { ...userData?.preferences, [key]: value } as any });
        } catch (e) {
            console.error('Failed to update preference', e);
            setMarketingEmailEnabled(!value);
        }
    };

    const handlePhoneSave = async () => {
        if (!phoneNumber) return;
        setLoading(true);
        try {
            await updateUserData({ phoneNumber });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-8 max-w-3xl">
            <div>
                <h1 className="dash-page-title">Settings</h1>
                <p className="dash-page-subtitle">Manage your account preferences.</p>
            </div>

            <div className="dash-card">
                <div className="dash-section-header">
                    <h2 className="dash-section-title">Profile</h2>
                    <p className="dash-section-desc">Your personal account information.</p>
                </div>
                <div className="px-6 py-5 space-y-5">
                    <div>
                        <label className="block text-[13px] font-medium text-neutral-300 mb-1.5">Display Name</label>
                        <input
                            disabled
                            value={userData?.displayName || ''}
                            className="dash-input max-w-sm cursor-not-allowed opacity-70"
                        />
                    </div>
                    <div>
                        <label className="block text-[13px] font-medium text-neutral-300 mb-1.5">Email Address</label>
                        <div className="flex items-center gap-3">
                            <input
                                disabled
                                value={user?.email || ''}
                                className="dash-input max-w-sm cursor-not-allowed opacity-70"
                            />
                            {user?.email_confirmed_at && (
                                <span className="dash-badge text-emerald-300 border-emerald-500/30 bg-emerald-500/10">
                                    Verified
                                </span>
                            )}
                        </div>
                    </div>
                    <div className="pt-1">
                        <button className="dash-card-button dash-card-button--ghost !flex-none px-3.5 py-2">
                            Change Password
                        </button>
                    </div>
                </div>
            </div>

            <div className="dash-card">
                <div className="dash-section-header">
                    <h2 className="dash-section-title">Notifications</h2>
                    <p className="dash-section-desc">Choose how you want to be notified.</p>
                </div>
                <div className="px-6 py-5 space-y-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-[13px] font-medium text-white">Email Notifications</p>
                            <p className="text-[12px] text-neutral-500 mt-0.5">Receive weekly summaries and billing alerts.</p>
                        </div>
                        <button
                            onClick={() => handleUpdatePreference('marketingEmails', !marketingEmailEnabled)}
                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                                marketingEmailEnabled ? 'bg-[#FF383C]' : 'bg-neutral-700'
                            }`}
                            aria-pressed={marketingEmailEnabled}
                            aria-label="Toggle email notifications"
                        >
                            <span
                                className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
                                    marketingEmailEnabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
                                }`}
                            />
                        </button>
                    </div>

                    <div className="border-t border-neutral-800 pt-5">
                        <p className="text-[13px] font-medium text-white">SMS Alerts</p>
                        <p className="text-[12px] text-neutral-500 mt-0.5 mb-3">Get critical alerts on your mobile device.</p>
                        <div className="flex gap-2">
                            <input
                                placeholder="+1 (555) 000-0000"
                                value={phoneNumber}
                                onChange={(e) => setPhoneNumber(e.target.value)}
                                className="dash-input w-56"
                            />
                            <button
                                disabled={!phoneNumber || phoneNumber === userData?.phoneNumber || loading}
                                onClick={handlePhoneSave}
                                className="dash-card-button dash-card-button--primary !flex-none px-3.5 py-2.5 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                {loading ? 'Saving…' : 'Save'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <div className="dash-alert dash-alert--danger rounded-xl p-6">
                <h3 className="dash-alert__title">Delete Account</h3>
                <p className="dash-alert__desc">
                    Permanently delete your account and all associated data. This cannot be undone.
                </p>
                <button className="px-3.5 py-2 text-[13px] font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors">
                    Delete Account
                </button>
            </div>
        </div>
    );
}
