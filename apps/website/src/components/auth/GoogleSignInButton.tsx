'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import {
  generateNonce,
  getGoogleClientId,
  hashNonce,
  loadGoogleIdentity,
  type GoogleCredentialResponse,
} from '@/lib/googleIdentity';

interface GoogleSignInButtonProps {
  /** Visible label, e.g. "Continue with Google" / "Sign up with Google". */
  label: string;
  /** Tailwind/utility classes for the visible button (your existing styling). */
  className: string;
  /** Visible icon (the brand Google "G"). */
  icon?: React.ReactNode;
  /** Where the redirect-flow fallback should return to (used only if GIS is unavailable). */
  redirectTo?: string;
  /** Show the Google One Tap card to logged-out visitors (inline, no popup window). */
  enableOneTap?: boolean;
  /** Called after Supabase establishes a session via the ID token. */
  onSuccess?: () => void;
  onError?: (message: string) => void;
}

/**
 * Renders your own styled Google button and overlays an invisible Google
 * Identity Services button on top of it. Clicks land on the GIS button, which
 * yields an ID token we hand straight to Supabase — so the supabase.co domain
 * never appears. If GIS can't load (or no client id is configured) the visible
 * button falls back to the standard redirect OAuth flow.
 */
export function GoogleSignInButton({
  label,
  className,
  icon,
  redirectTo,
  enableOneTap = false,
  onSuccess,
  onError,
}: GoogleSignInButtonProps) {
  const visibleBtnRef = useRef<HTMLButtonElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [gsiReady, setGsiReady] = useState(false);
  const [pending, setPending] = useState(false);

  // Redirect-flow fallback (only reachable when the GIS overlay isn't active).
  const handleFallback = async () => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: redirectTo ? { redirectTo } : undefined,
      });
      if (error) onError?.(error.message);
    } catch {
      onError?.('Google sign-in failed');
    }
  };

  useEffect(() => {
    const clientId = getGoogleClientId();
    if (!clientId) return; // No client id → keep the redirect fallback.

    let cancelled = false;
    let resizeObserver: ResizeObserver | undefined;

    const run = async () => {
      let google;
      try {
        google = await loadGoogleIdentity();
      } catch {
        return; // Leave the visible button as a redirect fallback.
      }
      if (cancelled || !overlayRef.current) return;

      const rawNonce = generateNonce();
      const hashedNonce = await hashNonce(rawNonce);
      if (cancelled || !overlayRef.current) return;

      google.accounts.id.initialize({
        client_id: clientId,
        nonce: hashedNonce,
        auto_select: false,
        itp_support: true,
        use_fedcm_for_button: true,
        use_fedcm_for_prompt: true,
        cancel_on_tap_outside: true,
        callback: async (response: GoogleCredentialResponse) => {
          if (!response.credential) {
            onError?.('Google sign-in was cancelled');
            return;
          }
          setPending(true);
          try {
            const { error } = await supabase.auth.signInWithIdToken({
              provider: 'google',
              token: response.credential,
              nonce: rawNonce,
            });
            if (error) {
              onError?.(error.message);
              return;
            }
            onSuccess?.();
          } catch (e) {
            onError?.(e instanceof Error ? e.message : 'Google sign-in failed');
          } finally {
            setPending(false);
          }
        },
      });

      const renderButton = () => {
        const overlay = overlayRef.current;
        if (!overlay) return;
        const measured = visibleBtnRef.current?.offsetWidth ?? 0;
        const width = Math.min(Math.max(Math.round(measured), 200), 400);
        overlay.innerHTML = '';
        google.accounts.id.renderButton(overlay, {
          type: 'standard',
          theme: 'filled_black',
          size: 'large',
          text: 'continue_with',
          shape: 'pill',
          logo_alignment: 'center',
          width: String(width),
        });
      };

      renderButton();
      if (!cancelled) setGsiReady(true);

      // Keep the GIS button width in sync with the visible button.
      if (visibleBtnRef.current && typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => renderButton());
        resizeObserver.observe(visibleBtnRef.current);
      }

      // One Tap: only nudge visitors who aren't already signed in, so we never
      // nag an active session. Shares this same init (nonce + callback).
      if (enableOneTap) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (!cancelled && !session) {
            google.accounts.id.prompt();
          }
        } catch {
          /* One Tap is best-effort; the button remains the primary path. */
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      if (enableOneTap) {
        try { window.google?.accounts.id.cancel(); } catch { /* noop */ }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative w-full">
      <button
        ref={visibleBtnRef}
        type="button"
        onClick={gsiReady ? undefined : () => void handleFallback()}
        className={className}
        aria-hidden={gsiReady || undefined}
        tabIndex={gsiReady ? -1 : undefined}
        disabled={pending}
      >
        {icon}
        {label}
      </button>

      {/* Invisible GIS button. Covers the visible button and captures the click;
          opacity-0 hides Google's styling while still receiving the event. */}
      <div
        ref={overlayRef}
        aria-label={label}
        className="absolute inset-0 z-10 flex items-center justify-center overflow-hidden rounded-[inherit] opacity-0"
        style={{ pointerEvents: gsiReady ? 'auto' : 'none' }}
      />
    </div>
  );
}
