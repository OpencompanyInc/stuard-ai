'use client';

import { useEffect, useMemo, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Header from '@/components/layout/Header';
import { supabase } from '@/lib/supabaseClient';
import {
  normalizeOnboardingProfile,
  ONBOARDING_PROFILE_STORAGE_KEY,
  toOnboardingProfileRow,
} from '../../../../../shared/onboardingProfile';

export const dynamic = 'force-dynamic';

type AuthStatus = 'idle' | 'submitting' | 'publishing' | 'done' | 'google_redirect';

function AuthPageContent() {
  const searchParams = useSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState<AuthStatus>('idle');

  // Read cid and nonce from query or fragment
  const [cid, nonce] = useMemo(() => {
    const qCid = searchParams.get('cid');
    const qNonce = searchParams.get('nonce');
    if (qCid && qNonce) return [qCid, qNonce];
    if (typeof window !== 'undefined') {
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const hCid = hash.get('cid') || '';
      const hNonce = hash.get('nonce') || '';
      return [hCid, hNonce];
    }
    return ['', ''];
  }, [searchParams]);

  const hasDesktopHandoff = Boolean(cid && nonce);

  // Attempt to exchange OAuth/OTP code for session if present
  useEffect(() => {
    const code = searchParams.get('code');
    if (code) {
      supabase.auth.exchangeCodeForSession(code).catch(() => {});
    }
  }, [searchParams]);

  useEffect(() => {
    let isActive = true;

    const persistPendingOnboardingProfile = async () => {
      let raw: string | null = null;
      try {
        raw = window.localStorage.getItem(ONBOARDING_PROFILE_STORAGE_KEY);
      } catch {
        raw = null;
      }

      if (!raw) return;

      let parsed = null;
      try {
        parsed = normalizeOnboardingProfile(JSON.parse(raw));
      } catch {
        parsed = null;
      }

      if (!parsed) {
        try { window.localStorage.removeItem(ONBOARDING_PROFILE_STORAGE_KEY); } catch { }
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!isActive || !session?.user) return;

      const onboardingRow = toOnboardingProfileRow({
        ...parsed,
        source: parsed.source ?? 'website_google',
        updatedAt: new Date().toISOString(),
      });

      if (!onboardingRow) return;

      await supabase
        .from('profiles')
        .upsert({ user_id: session.user.id, ...onboardingRow }, { onConflict: 'user_id' });

      if (!isActive) return;
      try { window.localStorage.removeItem(ONBOARDING_PROFILE_STORAGE_KEY); } catch { }
    };

    void persistPendingOnboardingProfile();

    const { data: sub } = supabase.auth.onAuthStateChange((evt) => {
      if (evt === 'SIGNED_IN') {
        void persistPendingOnboardingProfile();
      }
    });

    return () => {
      isActive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // When signed in, broadcast tokens to the desktop app and finish
  useEffect(() => {
    let isActive = true;

    const publishIfReady = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!isActive || !session || !hasDesktopHandoff) return;

      try {
        setStatus('publishing');
        const channel = supabase.channel(`auth:${cid}`, { config: { broadcast: { ack: true } } });
        await new Promise<void>((resolve, reject) => {
          channel.subscribe(async (state) => {
            if (state === 'SUBSCRIBED') {
              const res = await channel.send({
                type: 'broadcast',
                event: 'SIGNED_IN',
                payload: {
                  nonce,
                  tokens: {
                    access_token: session.access_token,
                    refresh_token: session.refresh_token,
                  },
                },
              });
              if (res === 'ok') resolve(); else reject(new Error('Failed to publish sign-in'));
            }
          });
        });
        await supabase.removeChannel(channel);
        setStatus('done');
      } catch (e: unknown) {
        const errorMessage = e instanceof Error ? e.message : 'Failed to notify the desktop app';
        setError(errorMessage);
        setStatus('idle');
      }
    };

    // Try immediately
    publishIfReady();
    // And on auth changes
    const { data: sub } = supabase.auth.onAuthStateChange((evt) => {
      if (evt === 'SIGNED_IN') publishIfReady();
    });
    return () => {
      isActive = false;
      sub.subscription.unsubscribe();
    };
  }, [cid, nonce, hasDesktopHandoff]);

  const handlePasswordSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      setStatus('submitting');
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      // session listener will publish and move to 'done'
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to sign in';
      setError(errorMessage);
      setStatus('idle');
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    try {
      setStatus('google_redirect');
      // Build redirect URL preserving cid and nonce for desktop handoff
      const redirectUrl = new URL('/auth', window.location.origin);
      if (cid) redirectUrl.searchParams.set('cid', cid);
      if (nonce) redirectUrl.searchParams.set('nonce', nonce);
      
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl.toString(),
        },
      });
      if (error) throw error;
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to sign in with Google';
      setError(errorMessage);
      setStatus('idle');
    }
  };

  if (status === 'publishing') {
    return (
      <>
        <Header />
        <main className="min-h-screen  flex items-center justify-center py-20">
          <div className="max-w-md w-full mx-4">
            <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-8 text-center">
              <div className="w-16 h-16 gradient-primary rounded-2xl flex items-center justify-center mx-auto mb-4">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
              </div>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">Finishing up…</h1>
              <p className="text-gray-600">Notifying the desktop app.</p>
            </div>
          </div>
        </main>
      </>
    );
  }

  if (status === 'done') {
    return (
      <>
        <Header />
        <main className="min-h-screen  flex items-center justify-center py-20">
          <div className="max-w-md w-full mx-4">
            <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-8 text-center">
              <div className="w-16 h-16 bg-green-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              </div>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">All set</h1>
              <p className="text-gray-600">You can return to the app.</p>
            </div>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Header />
      <main className="min-h-screen  flex items-center justify-center py-20">
        <div className="max-w-md w-full mx-4">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-8">
            <div className="text-center mb-8">
              <div className="w-16 h-16 gradient-primary rounded-2xl flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
              </div>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">Sign in</h1>
              <p className="text-gray-600">Authenticate for the Stuard AI desktop app</p>
            </div>

            {error && (
              <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-xl">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            {/* Google Sign-In */}
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={status === 'google_redirect'}
              className="w-full flex items-center justify-center gap-3 py-3 px-4 bg-white border border-gray-300 rounded-xl font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed mb-6"
            >
              {status === 'google_redirect' ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-gray-600"></div>
                  Redirecting to Google...
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  Continue with Google
                </>
              )}
            </button>

            <div className="relative mb-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200"></div>
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="px-2 bg-white text-gray-500">Or continue with email</span>
              </div>
            </div>

            <form onSubmit={handlePasswordSignIn} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-colors"
                  placeholder="Enter your email address"
                />
              </div>
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <input
                  type="password"
                  id="password"
                  name="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-colors"
                  placeholder="Enter your password"
                />
              </div>
              <button
                type="submit"
                disabled={status === 'submitting' || !email || !password}
                className="w-full py-3 px-4 gradient-primary text-white font-semibold rounded-xl hover:shadow-xl hover:scale-105 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
              >
                {status === 'submitting' ? (
                  <div className="flex items-center justify-center">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Signing in…
                  </div>
                ) : 'Sign in'}
              </button>
            </form>

            <div className="mt-8 pt-6 border-t border-gray-200">
              <div className="flex items-center justify-center space-x-6 text-xs text-gray-500">
                <div className="flex items-center">
                  <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                  <span>SSL Encrypted</span>
                </div>
                <div className="flex items-center">
                  <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  <span>No-referrer</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}

export default function AuthPage() {
  return (
    // @ts-expect-error React types conflict in monorepo
    <Suspense fallback={
      <>
        <Header />
        <main className="min-h-screen  flex items-center justify-center py-20">
          <div className="max-w-md w-full mx-4">
            <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-8 text-center">
              <div className="w-16 h-16 gradient-primary rounded-2xl flex items-center justify-center mx-auto mb-4">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">Loading...</h1>
              <p className="text-gray-600">Preparing authentication</p>
            </div>
          </div>
        </main>
      </>
    }>
      <AuthPageContent />
    </Suspense>
  );
}


