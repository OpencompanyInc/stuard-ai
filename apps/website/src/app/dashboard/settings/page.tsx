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
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
                <p className="text-sm text-gray-500 mt-1">Manage your account preferences.</p>
            </div>

            {/* Profile */}
            <div className="bg-white rounded-xl border border-gray-200">
                <div className="px-6 py-5 border-b border-gray-100">
                    <h2 className="text-[15px] font-semibold text-gray-900">Profile</h2>
                    <p className="text-[13px] text-gray-500 mt-0.5">Your personal account information.</p>
                </div>
                <div className="px-6 py-5 space-y-5">
                    <div>
                        <label className="block text-[13px] font-medium text-gray-700 mb-1.5">Display Name</label>
                        <input
                            disabled
                            value={userData?.displayName || ''}
                            className="w-full max-w-sm px-3.5 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-lg text-gray-500 cursor-not-allowed"
                        />
                    </div>
                    <div>
                        <label className="block text-[13px] font-medium text-gray-700 mb-1.5">Email Address</label>
                        <div className="flex items-center gap-3">
                            <input
                                disabled
                                value={user?.email || ''}
                                className="w-full max-w-sm px-3.5 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-lg text-gray-500 cursor-not-allowed"
                            />
                            {user?.email_confirmed_at && (
                                <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-700 text-[11px] font-medium border border-emerald-100">
                                    Verified
                                </span>
                            )}
                        </div>
                    </div>
                    <div className="pt-1">
                        <button className="px-3.5 py-2 text-[13px] font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                            Change Password
                        </button>
                    </div>
                </div>
            </div>

            {/* Notifications */}
            <div className="bg-white rounded-xl border border-gray-200">
                <div className="px-6 py-5 border-b border-gray-100">
                    <h2 className="text-[15px] font-semibold text-gray-900">Notifications</h2>
                    <p className="text-[13px] text-gray-500 mt-0.5">Choose how you want to be notified.</p>
                </div>
                <div className="px-6 py-5 space-y-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-[13px] font-medium text-gray-900">Email Notifications</p>
                            <p className="text-[12px] text-gray-500 mt-0.5">Receive weekly summaries and billing alerts.</p>
                        </div>
                        <button
                            onClick={() => handleUpdatePreference('marketingEmails', !marketingEmailEnabled)}
                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                                marketingEmailEnabled ? 'bg-gray-900' : 'bg-gray-200'
                            }`}
                        >
                            <span
                                className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
                                    marketingEmailEnabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
                                }`}
                            />
                        </button>
                    </div>

                    <div className="border-t border-gray-100 pt-5">
                        <p className="text-[13px] font-medium text-gray-900">SMS Alerts</p>
                        <p className="text-[12px] text-gray-500 mt-0.5 mb-3">Get critical alerts on your mobile device.</p>
                        <div className="flex gap-2">
                            <input
                                placeholder="+1 (555) 000-0000"
                                value={phoneNumber}
                                onChange={(e) => setPhoneNumber(e.target.value)}
                                className="w-56 px-3.5 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-400 transition-colors bg-white"
                            />
                            <button
                                disabled={!phoneNumber || phoneNumber === userData?.phoneNumber || loading}
                                onClick={handlePhoneSave}
                                className="px-3.5 py-2.5 text-[13px] font-medium text-white bg-gray-900 rounded-lg hover:bg-black transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                {loading ? 'Saving…' : 'Save'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Danger Zone */}
            <div className="rounded-xl border border-red-200 bg-red-50/50 p-6">
                <h3 className="text-[15px] font-semibold text-red-900 mb-1">Delete Account</h3>
                <p className="text-[13px] text-red-700/80 mb-4">
                    Permanently delete your account and all associated data. This cannot be undone.
                </p>
                <button className="px-3.5 py-2 text-[13px] font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors">
                    Delete Account
                </button>
            </div>
        </div>
    );
}
