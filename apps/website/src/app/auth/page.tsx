'use client';

import { useEffect, useMemo, useRef, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { useAuthContext } from '@/components/providers/AuthProvider';
import { AuthBackdrop } from '@/components/auth/AuthBackdrop';
import { AuthCard } from '@/components/auth/AuthCard';
import { SignInCard } from '@/components/auth/SignInCard';
import {
  normalizeOnboardingProfile,
  ONBOARDING_PROFILE_STORAGE_KEY,
  toOnboardingProfileRow,
} from '@/lib/onboardingProfile';

export const dynamic = 'force-dynamic';

type AuthStatus = 'idle' | 'submitting' | 'publishing' | 'done';

function StatusCard({ children }: { children: React.ReactNode }) {
  return (
    <AuthCard className="gap-4 text-center">
      {children}
    </AuthCard>
  );
}

function AuthPageContent() {
  const searchParams = useSearchParams();
  const { signIn } = useAuthContext();

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

  const buildAuthRedirectUrl = () => {
    const url = new URL('/auth', window.location.origin);
    if (cid) url.searchParams.set('cid', cid);
    if (nonce) url.searchParams.set('nonce', nonce);
    return url.toString();
  };

  const handlePasswordSignIn = async (email: string, password: string) => {
    setError('');
    setStatus('submitting');
    try {
      const result = await signIn(email, password);
      if (!result.success) {
        setError(result.error || 'Failed to sign in');
        setStatus('idle');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to sign in');
      setStatus('idle');
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    try {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: buildAuthRedirectUrl() },
      });
      if (oauthError) setError(oauthError.message);
    } catch {
      setError('Google sign-in failed');
    }
  };

  if (status === 'publishing') {
    return (
      <AuthBackdrop>
        <StatusCard>
          <div className="auth-status-icon">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
          </div>
          <div>
            <h1 className="auth-title mb-1">Finishing up…</h1>
            <p className="auth-subtitle">Notifying the desktop app.</p>
          </div>
        </StatusCard>
      </AuthBackdrop>
    );
  }

  if (status === 'done') {
    return (
      <AuthBackdrop>
        <StatusCard>
          <div className="auth-status-icon auth-status-icon--success">
            <svg className="h-6 w-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <h1 className="auth-title mb-1">All set</h1>
            <p className="auth-subtitle">You can return to the app.</p>
          </div>
        </StatusCard>
      </AuthBackdrop>
    );
  }

  return (
    <AuthBackdrop>
      <SignInCard
        subtitle={hasDesktopHandoff ? 'Sign in to connect the Stuard desktop app.' : 'Pick up exactly where you left off.'}
        error={error}
        isSubmitting={status === 'submitting'}
        onSubmit={handlePasswordSignIn}
        onGoogle={handleGoogleSignIn}
      />
    </AuthBackdrop>
  );
}

function AuthLoadingFallback() {
  return (
    <AuthBackdrop>
      <AuthCard className="gap-4 text-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
        <p className="auth-subtitle">Loading…</p>
      </AuthCard>
    </AuthBackdrop>
  );
}

export default function AuthPage() {
  return (
    <Suspense fallback={<AuthLoadingFallback />}>
      <AuthPageContent />
    </Suspense>
  );
}
