"use client";

import React, { useState } from 'react';
import Link from 'next/link';
// import { useAuthContext } from '@/components/providers/AuthProvider';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/Card';
import Container from '@/components/ui/Container';

export default function SettingsPage() {
  // Mock user for no-auth visual access
  const user = { phone: '', email: 'demo@example.com' }; 
  const [phoneNumber, setPhoneNumber] = useState(user?.phone || '');
  const [agreed, setAgreed] = useState(false);
  const [smsEnabled, setSmsEnabled] = useState(false); 
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleSmsOptIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    
    if (!phoneNumber) {
      setError('Please enter a valid phone number.');
      return;
    }
    
    if (!agreed) {
      setError('You must agree to the terms to enable SMS notifications.');
      return;
    }

    setLoading(true);

    try {
      // Mock API call to save phone number and opt-in status
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      setSmsEnabled(true);
      setMessage('Success! You are now subscribed to SMS updates.');
    } catch (err) {
      setError('Failed to update settings. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleOptOut = async () => {
    setLoading(true);
    try {
      // Mock API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      setSmsEnabled(false);
      setAgreed(false);
      setMessage('You have been unsubscribed from SMS updates.');
    } catch (err) {
      setError('Failed to unsubscribe. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0A0B] pt-24 pb-12 text-white">
      <Container>
        <div className="flex flex-col md:flex-row gap-8">
          {/* Sidebar Navigation */}
          <aside className="w-full md:w-64 space-y-2">
            <div className="bg-[#111111] p-4 rounded-xl border border-white/10">
              <nav className="space-y-1">
                <button className="w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg bg-[#FF383C]/10 text-[#FF6B6E]">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                  Notifications
                </button>
                <button className="w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg text-[#A3A3A3] hover:bg-white/5 transition-colors">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                  </svg>
                  Profile
                </button>
                <button className="w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg text-[#A3A3A3] hover:bg-white/5 transition-colors">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4 4a2 2 0 00-2 2v4a2 2 0 002 2V6h10a2 2 0 00-2-2H4zm2 6a2 2 0 012-2h8a2 2 0 012 2v4a2 2 0 01-2 2H8a2 2 0 01-2-2v-4zm6 4a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                  </svg>
                  Billing
                </button>
              </nav>
            </div>
          </aside>

          {/* Main Content */}
          <main className="flex-1 space-y-6">
            <div>
              <h1 className="text-2xl font-bold text-white">Notification Settings</h1>
              <p className="text-[#A3A3A3]">Manage how you receive updates and alerts from Stuard.</p>
            </div>

            {/* SMS Settings Card */}
            <Card>
              <CardHeader>
                <CardTitle>SMS Notifications</CardTitle>
                <CardDescription>
                  Get real-time alerts for critical workflow events directly to your phone.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!smsEnabled ? (
                  <form onSubmit={handleSmsOptIn} className="space-y-6 max-w-lg">
                    <Input
                      label="Mobile Phone Number"
                      type="tel"
                      placeholder="+1 (555) 000-0000"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      hint="We&apos;ll send a verification code to this number."
                    />

                    <div className="bg-[#FF383C]/5 p-4 rounded-xl border border-[#FF383C]/15">
                      <div className="flex items-start gap-3">
                        <input
                          id="sms-consent"
                          type="checkbox"
                          checked={agreed}
                          onChange={(e) => setAgreed(e.target.checked)}
                          className="mt-1 w-4 h-4 accent-[#FF383C] border-white/20 rounded focus:ring-[#FF383C]"
                        />
                        <label htmlFor="sms-consent" className="text-sm text-[#A3A3A3] leading-relaxed">
                          I agree to receive SMS notifications from Stuard AI. 
                          I understand that message frequency varies and message/data rates may apply.
                          Review our <Link href="/terms" className="text-[#FF6B6E] hover:underline font-medium">Terms</Link> and <Link href="/privacy" className="text-[#FF6B6E] hover:underline font-medium">Privacy Policy</Link>.
                          Reply HELP for help, STOP to cancel.
                        </label>
                      </div>
                    </div>

                    <Button 
                      type="submit" 
                      isLoading={loading}
                      disabled={!agreed || !phoneNumber}
                    >
                      Enable SMS Alerts
                    </Button>
                  </form>
                ) : (
                  <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-6">
                    <div className="flex items-start justify-between">
                      <div className="flex gap-4">
                        <div className="bg-emerald-500/15 p-2 rounded-lg text-emerald-400 h-fit">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                        <div>
                          <h3 className="font-semibold text-white">SMS Notifications Active</h3>
                          <p className="text-sm text-[#A3A3A3] mt-1">
                            Alerts are being sent to <span className="font-medium text-white">{phoneNumber}</span>
                          </p>
                          <div className="mt-4 flex gap-3">
                            <Button 
                              variant="outline" 
                              size="sm" 
                              className="border-white/10 bg-white/5 text-white hover:bg-white/10"
                              onClick={() => {
                                  setSmsEnabled(false);
                                  // In a real app, this would be an edit mode
                              }}
                            >
                              Change Number
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="text-red-600 hover:bg-red-50 hover:text-red-700"
                              onClick={handleOptOut}
                              isLoading={loading}
                            >
                              Opt Out
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Status Messages */}
                {message && (
                  <div className="mt-4 p-3 bg-emerald-500/10 text-emerald-300 text-sm rounded-lg border border-emerald-500/20 flex items-center gap-2">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                    {message}
                  </div>
                )}
                {error && (
                  <div className="mt-4 p-3 bg-red-500/10 text-red-300 text-sm rounded-lg border border-red-500/25 flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    {error}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Other Notification Settings (Placeholder) */}
            <Card>
              <CardHeader>
                <CardTitle>Email Preferences</CardTitle>
                <CardDescription>Control which emails you receive.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between py-2">
                  <div>
                    <h4 className="font-medium text-white">Product Updates</h4>
                    <p className="text-sm text-[#737373]">New features and improvements.</p>
                  </div>
                  <div className="relative inline-block w-12 mr-2 align-middle select-none transition duration-200 ease-in">
                      <input type="checkbox" name="toggle" id="toggle-1" className="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 appearance-none cursor-pointer checked:right-0 right-6 checked:border-green-400 border-gray-300"/>
                      <label htmlFor="toggle-1" className="toggle-label block overflow-hidden h-6 rounded-full bg-gray-300 cursor-pointer checked:bg-green-400"></label>
                  </div>
                </div>
                <div className="flex items-center justify-between py-2 border-t border-white/10">
                  <div>
                    <h4 className="font-medium text-white">Workflow Summaries</h4>
                    <p className="text-sm text-[#737373]">Weekly digest of your agent&apos;s activity.</p>
                  </div>
                  <div className="relative inline-block w-12 mr-2 align-middle select-none transition duration-200 ease-in">
                      <input type="checkbox" name="toggle" id="toggle-2" defaultChecked className="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 appearance-none cursor-pointer checked:right-0 right-6 checked:border-green-400 border-gray-300"/>
                      <label htmlFor="toggle-2" className="toggle-label block overflow-hidden h-6 rounded-full bg-gray-300 cursor-pointer checked:bg-green-400"></label>
                  </div>
                </div>
              </CardContent>
            </Card>
          </main>
        </div>
      </Container>
    </div>
  );
}
