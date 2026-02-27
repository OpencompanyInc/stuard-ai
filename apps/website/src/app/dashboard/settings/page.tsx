'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
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
            // Revert on error
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
    }

    return (
        <div className="space-y-8 max-w-4xl mx-auto">
            <div>
                <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
                <p className="text-gray-500 mt-1">Manage your account preferences and personal details.</p>
            </div>

            {/* Profile Section */}
            <Card className="border border-black/5 shadow-sm bg-white/80 backdrop-blur-md">
                <CardHeader>
                    <CardTitle>Profile</CardTitle>
                    <CardDescription>Your personal account information.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6 max-w-xl">
                    <div className="grid gap-2">
                        <label className="text-sm font-medium text-gray-700">Display Name</label>
                        <Input disabled value={userData?.displayName || ''} className="bg-gray-50 text-gray-500" />
                    </div>

                    <div className="grid gap-2">
                        <label className="text-sm font-medium text-gray-700">Email Address</label>
                        <div className="flex gap-3">
                            <Input disabled value={user?.email || ''} className="bg-gray-50 text-gray-500" />
                            {user?.email_confirmed_at && (
                                <span className="inline-flex items-center px-3 py-1 rounded-lg bg-green-50 text-green-700 text-xs font-medium border border-green-100">Verified</span>
                            )}
                        </div>
                    </div>

                    <div className="pt-2">
                        <Button variant="outline" className="font-semibold text-gray-700 hover:text-gray-900">Change Password</Button>
                    </div>
                </CardContent>
            </Card>

            {/* Notifications */}
            <Card className="border border-black/5 shadow-sm bg-white/80 backdrop-blur-md">
                <CardHeader>
                    <CardTitle>Notifications</CardTitle>
                    <CardDescription>Choose how you want to be notified about agent activities.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <h4 className="font-medium text-gray-900">Email Notifications</h4>
                            <p className="text-sm text-gray-500">Receive weekly summaries and billing alerts.</p>
                        </div>
                        <div
                            onClick={() => handleUpdatePreference('marketingEmails', !marketingEmailEnabled)}
                            className={`relative inline-block w-12 h-6 transition duration-200 ease-in-out rounded-full border cursor-pointer ${marketingEmailEnabled ? 'bg-green-500 border-green-500' : 'bg-gray-200 border-gray-200'}`}
                        >
                            <div className={`absolute left-1 top-1 bg-white w-4 h-4 rounded-full shadow transition-transform ${marketingEmailEnabled ? 'translate-x-6' : 'translate-x-0'}`}></div>
                        </div>
                    </div>

                    <div className="flex items-start justify-between border-t border-gray-100 pt-6">
                        <div className="max-w-md w-full">
                            <h4 className="font-medium text-gray-900">SMS Alerts</h4>
                            <p className="text-sm text-gray-500 mb-4">Get critical alerts on your mobile device.</p>
                            <div className="flex gap-2">
                                <Input
                                    placeholder="+1 (555) 000-0000"
                                    value={phoneNumber}
                                    onChange={(e) => setPhoneNumber(e.target.value)}
                                    className="w-full md:w-64"
                                />
                                <Button
                                    className="gradient-primary border-0 font-bold text-white shadow-sm"
                                    disabled={!phoneNumber || phoneNumber === userData?.phoneNumber || loading}
                                    onClick={handlePhoneSave}
                                >
                                    {loading ? 'Saving...' : 'Save'}
                                </Button>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Danger Zone */}
            <div className="pt-8">
                <div className="border border-red-200 rounded-xl p-6 bg-red-50/30">
                    <h3 className="text-red-900 font-bold mb-2">Delete Account</h3>
                    <p className="text-red-700 text-sm mb-4">
                        Permanently delete your account and all associated data. This action cannot be undone.
                    </p>
                    <Button variant="destructive" className="bg-red-600 hover:bg-red-700 text-white">Delete Account</Button>
                </div>
            </div>
        </div>
    );
}
