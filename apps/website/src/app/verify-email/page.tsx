'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import Header from '@/components/layout/Header';
import { supabase } from '@/lib/supabaseClient';

// Force dynamic rendering to avoid SSR issues with Firebase
export const dynamic = 'force-dynamic';

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const [verificationStatus, setVerificationStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const email = searchParams.get('email') || '';

  useEffect(() => {
    const run = async () => {
      try {
        const code = searchParams.get('code');
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) return setVerificationStatus('error');
          return setVerificationStatus('success');
        }
        // If user returns after clicking confirmation in email, they might already be verified
        const { data: { user } } = await supabase.auth.getUser();
        if (user?.email_confirmed_at) return setVerificationStatus('success');
        setVerificationStatus('error');
      } catch {
        setVerificationStatus('error');
      }
    };
    run();
  }, [searchParams]);

  const resendVerification = async () => {
    // Supabase does not expose resend email directly; re-trigger sign-in link by updating email or backend RPC.
    // For now, provide feedback.
    console.log('Resend verification requested for:', email);
  };

  return (
    <>
      <Header />
      <main className="min-h-screen  flex items-center justify-center py-20">
        <div className="max-w-md w-full mx-4">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-8">
            {verificationStatus === 'loading' && (
              <div className="text-center">
                <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
                <h1 className="text-2xl font-bold text-gray-900 mb-2">
                  Verifying Your Email
                </h1>
                <p className="text-gray-600">
                  Please wait while we verify your email address...
                </p>
              </div>
            )}

            {verificationStatus === 'success' && (
              <div className="text-center">
                <div className="w-16 h-16 bg-green-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h1 className="text-2xl font-bold text-gray-900 mb-2">
                  Email Verified!
                </h1>
                <p className="text-gray-600 mb-6">
                  Your email has been successfully verified. You can now access all features of Stuard AI.
                </p>
                
                <div className="bg-gradient-to-r from-primary/5 to-secondary/5 rounded-xl p-4 mb-6">
                  <h3 className="text-sm font-semibold text-gray-900 mb-2">Next Steps:</h3>
                  <ul className="text-xs text-gray-600 space-y-1">
                    <li>• Download the Stuard AI app for Windows</li>
                    <li>• Set up the mobile app for remote control</li>
                    <li>• Start with about 15 free plan credits</li>
                  </ul>
                </div>

                <div className="space-y-3">
                  <Link
                    href="/download"
                    className="w-full inline-flex items-center justify-center px-6 py-3 gradient-primary text-white font-semibold rounded-xl hover:shadow-xl hover:scale-105 transition-all duration-300"
                  >
                    Download Stuard AI
                  </Link>
                  <Link
                    href="/login"
                    className="w-full inline-flex items-center justify-center px-6 py-3 border-2 border-primary text-primary font-semibold rounded-xl hover:bg-primary hover:text-white transition-all duration-300"
                  >
                    Sign In to Dashboard
                  </Link>
                </div>
              </div>
            )}

            {verificationStatus === 'error' && (
              <div className="text-center">
                <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                </div>
                <h1 className="text-2xl font-bold text-gray-900 mb-2">
                  Verification Failed
                </h1>
                <p className="text-gray-600 mb-6">
                  The verification link is invalid or has expired. Please try requesting a new verification email.
                </p>
                
                <div className="space-y-3">
                  <button
                    onClick={resendVerification}
                    className="w-full px-6 py-3 gradient-primary text-white font-semibold rounded-xl hover:shadow-xl hover:scale-105 transition-all duration-300"
                  >
                    Resend Verification Email
                  </button>
                  <Link
                    href="/signup"
                    className="w-full inline-flex items-center justify-center px-6 py-3 border-2 border-primary text-primary font-semibold rounded-xl hover:bg-primary hover:text-white transition-all duration-300"
                  >
                    Back to Sign Up
                  </Link>
                </div>
              </div>
            )}

            {/* Contact Support */}
            <div className="mt-8 pt-6 border-t border-gray-200 text-center">
              <p className="text-xs text-gray-500">
                Need help?{' '}
                <Link href="/contact" className="text-primary hover:text-primary/80 font-medium">
                  Contact Support
                </Link>
              </p>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen  flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    }>
      <VerifyEmailContent />
    </Suspense>
  );
} 