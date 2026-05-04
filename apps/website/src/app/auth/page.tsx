'use client';

import { useEffect, useMemo, useRef, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import {
  normalizeOnboardingProfile,
  ONBOARDING_PROFILE_STORAGE_KEY,
  toOnboardingProfileRow,
} from '@/lib/onboardingProfile';

export const dynamic = 'force-dynamic';

type AuthStatus = 'idle' | 'submitting' | 'publishing' | 'done' | 'google_redirect';

function AuthPageContent() {
  const searchParams = useSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState<AuthStatus>('idle');
  const publishInFlightRef = useRef(false);
  const publishDoneRef = useRef(false);

  const [cid, nonce] = useMemo(() => {
    const qCid = searchParams.get('cid');
    const qNonce = searchParams.get('nonce');
    if (qCid && qNonce) return [qCid, qNonce];
    if (typeof window !== 'undefined') {
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      return [hash.get('cid') || '', hash.get('nonce') || ''];
    }
    return ['', ''];
  }, [searchParams]);

  const hasDesktopHandoff = Boolean(cid && nonce);

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
      try { raw = window.localStorage.getItem(ONBOARDING_PROFILE_STORAGE_KEY); } catch { raw = null; }
      if (!raw) return;
      let parsed = null;
      try { parsed = normalizeOnboardingProfile(JSON.parse(raw)); } catch { parsed = null; }
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
      await supabase.from('profiles').upsert({ user_id: session.user.id, ...onboardingRow }, { onConflict: 'user_id' });
      if (!isActive) return;
      try { window.localStorage.removeItem(ONBOARDING_PROFILE_STORAGE_KEY); } catch { }
    };
    void persistPendingOnboardingProfile();
    const { data: sub } = supabase.auth.onAuthStateChange((evt) => {
      if (evt === 'SIGNED_IN') {
        window.setTimeout(() => void persistPendingOnboardingProfile(), 0);
      }
    });
    return () => { isActive = false; sub.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    let isActive = true;
    const publishIfReady = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!isActive || !session || !hasDesktopHandoff) return;
      if (publishInFlightRef.current || publishDoneRef.current) return;
      try {
        publishInFlightRef.current = true;
        setStatus('publishing');
        const channel = supabase.channel(`auth:${cid}`, { config: { broadcast: { ack: true } } });
        await new Promise<void>((resolve, reject) => {
          channel.subscribe(async (state) => {
            if (state === 'SUBSCRIBED') {
              const res = await channel.send({
                type: 'broadcast',
                event: 'SIGNED_IN',
                payload: { nonce, tokens: { access_token: session.access_token, refresh_token: session.refresh_token } },
              });
              if (res === 'ok') resolve(); else reject(new Error('Failed to publish sign-in'));
            }
          });
        });
        await supabase.removeChannel(channel);
        publishDoneRef.current = true;
        setStatus('done');
      } catch (e: unknown) {
        setError(typeof e === 'string' ? e : e instanceof Error ? e.message : 'Failed to notify the desktop app');
        setStatus('idle');
      } finally {
        publishInFlightRef.current = false;
      }
    };
    publishIfReady();
    const { data: sub } = supabase.auth.onAuthStateChange((evt) => {
      if (evt === 'SIGNED_IN') {
        window.setTimeout(() => void publishIfReady(), 0);
      }
    });
    return () => { isActive = false; sub.subscription.unsubscribe(); };
  }, [cid, nonce, hasDesktopHandoff]);

  const handlePasswordSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setStatus('submitting');
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to sign in');
      setStatus('idle');
    }
  };

  const card = (content: React.ReactNode) => (
    <div className="min-h-screen flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link href="/" className="inline-block">
            <span className="text-2xl font-bold text-gray-900">Stuard AI</span>
          </Link>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          {content}
        </div>
      </div>
    </div>
  );

  if (status === 'publishing') {
    return card(
      <div className="text-center py-4">
        <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-blue-600"></div>
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-1">Finishing up…</h1>
        <p className="text-sm text-gray-500">Notifying the desktop app.</p>
      </div>
    );
  }

  if (status === 'done') {
    return card(
      <div className="text-center py-4">
        <div className="w-14 h-14 bg-green-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <svg className="w-7 h-7 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-1">All set</h1>
        <p className="text-sm text-gray-500">You can return to the app.</p>
      </div>
    );
  }

  return card(
    <>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Sign in</h1>
      <p className="text-sm text-gray-500 mb-8">Authenticate for Stuard AI desktop</p>

      {error && (
        <div className="mb-5 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      <form onSubmit={handlePasswordSignIn} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
          <input
            type="email"
            id="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-colors bg-white"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1.5">Password</label>
          <input
            type="password"
            id="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-colors bg-white"
          />
        </div>
        <button
          type="submit"
          disabled={status === 'submitting' || !email || !password}
          className="w-full py-3 px-4 bg-gray-900 text-white font-semibold rounded-xl hover:bg-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-1"
        >
          {status === 'submitting' ? (
            <span className="flex items-center justify-center gap-2">
              <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></span>
              Signing in…
            </span>
          ) : 'Sign In'}
        </button>
      </form>

      <p className="text-center text-xs text-gray-400 mt-6">
        Don&apos;t have an account?{' '}
        <Link href="/signup" className="text-blue-600 hover:text-blue-700 font-medium">Sign up free</Link>
      </p>
    </>
  );
}

function AuthLoadingFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <span className="text-2xl font-bold text-gray-900">Stuard AI</span>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-400 mx-auto mb-4"></div>
          <p className="text-sm text-gray-500">Loading…</p>
        </div>
      </div>
    </div>
  );
}

export default function AuthPage() {
  return (
    <Suspense fallback={<AuthLoadingFallback />}>
      <AuthPageContent />
    </Suspense>
  );
}
