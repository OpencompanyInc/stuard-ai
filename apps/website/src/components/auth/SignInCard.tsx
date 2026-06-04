'use client';

import { useState } from 'react';
import Link from 'next/link';
import { EyeIcon, GoogleIcon } from './authIcons';
import { AuthCard } from './AuthCard';
import { GoogleSignInButton } from './GoogleSignInButton';

export interface SignInCardProps {
  title?: string;
  subtitle?: string;
  error?: string;
  isSubmitting?: boolean;
  success?: boolean;
  onSubmit: (email: string, password: string) => void | Promise<void>;
  /** Called once Supabase has a session from the Google ID-token flow. */
  onGoogleSuccess?: () => void;
  onGoogleError?: (message: string) => void;
  /** Return target for the redirect-flow fallback (when GIS is unavailable). */
  googleRedirectTo?: string;
  /** Show Google One Tap to logged-out visitors. */
  enableGoogleOneTap?: boolean;
  showCreateAccount?: boolean;
}

export function SignInCard({
  title = 'Sign in to Stuard',
  subtitle = 'Pick up exactly where you left off.',
  error = '',
  isSubmitting = false,
  success = false,
  onSubmit,
  onGoogleSuccess,
  onGoogleError,
  googleRedirectTo,
  enableGoogleOneTap = false,
  showCreateAccount = true,
}: SignInCardProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit(email, password);
  };

  return (
    <AuthCard>
      <div className="flex w-full flex-col items-center gap-1.5 text-center">
        <h1 className="auth-title">{title}</h1>
        <p className="auth-subtitle">{subtitle}</p>
      </div>

      <div className="mt-5 flex w-full flex-col gap-3.5">
        {error && (
          <div className="auth-error" role="alert">
            {error}
          </div>
        )}

        <GoogleSignInButton
          label="Continue with Google"
          className="auth-btn-ghost w-full"
          icon={<GoogleIcon />}
          redirectTo={googleRedirectTo}
          enableOneTap={enableGoogleOneTap}
          onSuccess={onGoogleSuccess}
          onError={onGoogleError}
        />

        <div className="auth-divider">
          <span>or</span>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-3">
          <div className="auth-input-field">
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              autoComplete="email"
            />
          </div>

          <div className="flex flex-col gap-2">
            <div className="auth-input-field">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="ml-2 shrink-0 text-[#A6A6A6] transition-colors hover:text-white"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                <EyeIcon open={showPassword} />
              </button>
            </div>
            <Link href="/forgot-password" className="auth-link self-start">
              Forgot password?
            </Link>
          </div>

          <button
            type="submit"
            disabled={isSubmitting || !email || !password || success}
            className="auth-btn-primary"
          >
            {isSubmitting ? (
              <span className="flex items-center gap-2">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#171717]/20 border-t-[#171717]" />
                Signing in…
              </span>
            ) : success ? (
              'Redirecting…'
            ) : (
              'Sign in'
            )}
          </button>

          {showCreateAccount && (
            <Link href="/signup" className="auth-btn-ghost">
              Create account
            </Link>
          )}
        </form>
      </div>
    </AuthCard>
  );
}
