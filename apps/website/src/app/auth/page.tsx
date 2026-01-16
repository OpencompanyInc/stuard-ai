'use client';

import { useEffect, useMemo, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Header from '@/components/layout/Header';
import { supabase } from '@/lib/supabaseClient';

export const dynamic = 'force-dynamic';

type AuthStatus = 'idle' | 'submitting' | 'publishing' | 'done';

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


