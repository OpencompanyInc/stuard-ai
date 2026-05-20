'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { useAuthContext } from '@/components/providers/AuthProvider';

export const dynamic = 'force-dynamic';

export default function SignUpPage() {
  const router = useRouter();
  const { signInWithGoogle } = useAuthContext();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }

    setError('');
    setIsSubmitting(true);

    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { fullName },
          emailRedirectTo: `${window.location.origin}/dashboard`,
        },
      });

      if (signUpError) {
        setError(signUpError.message);
        return;
      }

      if (data.user) {
        supabase.from('profiles').upsert(
          { user_id: data.user.id, email, display_name: fullName, created_at: new Date().toISOString() },
          { onConflict: 'user_id' }
        ).then(() => {}).catch(() => {});
      }

      if (data.session) {
        router.push('/dashboard');
        return;
      }

      setCheckEmail(true);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    setError('');
    try {
      const result = await signInWithGoogle();
      if (!result.success) setError(result.error || 'Google sign-up failed');
    } catch {
      setError('Google sign-up failed');
    }
  };

  if (checkEmail) {
    return (
      <AuthBackdrop>
        <div className="flex w-full max-w-[400px] flex-col items-center gap-5 rounded-3xl border border-white/10 bg-[#171717]/40 p-6 backdrop-blur-[40px] backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_30px_80px_-20px_rgba(0,0,0,0.6)] text-center">
          <Image src="/stuard-mark.png" alt="Stuard" width={28} height={28} priority />
          <h1 className="text-[22px] font-medium leading-tight text-[#E5E5E5]">Check your email</h1>
          <p className="text-[14px] leading-5 text-white">
            We sent a confirmation link to <span className="font-semibold">{email}</span>.
          </p>
          <p className="text-[12px] text-[#A3A3A3]">Click the link in the email to activate your account, then sign in.</p>
          <Link
            href="/login"
            className="mt-1 flex h-11 w-full items-center justify-center rounded-xl bg-white text-[15px] font-medium text-black hover:bg-white/90 transition-colors"
          >
            Go to Sign In
          </Link>
        </div>
      </AuthBackdrop>
    );
  }

  return (
    <AuthBackdrop>
      <div
        className="
          relative flex w-full max-w-[1000px] flex-col items-stretch
          overflow-hidden gap-7 sm:gap-9 lg:gap-10
          p-5 sm:p-6 lg:p-7
          rounded-3xl
          border border-white/10
          bg-[#171717]/40
          backdrop-blur-[40px] backdrop-saturate-150
          shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_40px_120px_-30px_rgba(0,0,0,0.7)]
          lg:flex-row
        "
      >
        {/* LEFT — title */}
        <div className="relative flex flex-1 items-center min-h-0 lg:min-h-[260px]">
          <h1 className="max-w-[540px] text-[24px] leading-[1.15] sm:text-[30px] sm:leading-[1.15] md:text-[40px] md:leading-[1.15] font-normal text-white lg:text-[52px] lg:leading-[1.15]">
            Your autonomous workspace awaits.
          </h1>
        </div>

        {/* RIGHT — form */}
        <div className="flex w-full lg:max-w-[380px] flex-col items-center gap-6 sm:gap-7 pt-2 lg:pt-6">
          {/* Logo */}
          <Image src="/stuard-mark.png" alt="Stuard" width={28} height={28} className="h-7 w-7 object-contain" priority />

          {/* Title */}
          <div className="flex w-full flex-col items-center gap-2 sm:gap-3 text-center">
            <h2 className="text-[22px] sm:text-[24px] font-medium leading-tight text-[#E5E5E5]">Create an Account</h2>
            <p className="text-[13px] sm:text-[14px] leading-5 text-white">Enter your details to create an account</p>
          </div>

          {/* Form block */}
          <div className="flex w-full flex-col gap-4 sm:gap-5">
            {error && (
              <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3">
                <p className="text-sm text-red-300">{error}</p>
              </div>
            )}

            {/* Google */}
            <button
              type="button"
              onClick={handleGoogle}
              className="
                flex h-11 w-full items-center justify-center gap-2
                rounded-xl border border-[#737373]/80 bg-[#171717]/85
                text-[14px] font-medium text-white
                hover:bg-[#1f1f1f] transition-colors
              "
            >
              <GoogleIcon />
              Sign up with Google
            </button>

            <div className="text-center text-[13px] font-medium leading-5 text-white">OR</div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
              {/* Name */}
              <div className="flex h-11 items-center rounded-xl border border-[#A3A3A3]/80 px-3.5">
                <input
                  id="fullName"
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Name"
                  autoComplete="name"
                  className="w-full bg-transparent text-[14px] font-medium text-white placeholder:text-white/60 focus:outline-none"
                />
              </div>

              {/* Email */}
              <div className="flex h-11 items-center rounded-xl border border-[#A3A3A3]/80 px-3.5">
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email"
                  autoComplete="email"
                  className="w-full bg-transparent text-[14px] font-medium text-white placeholder:text-white/60 focus:outline-none"
                />
              </div>

              {/* Password + hint */}
              <div className="flex flex-col gap-3">
                <div className="flex h-11 items-center justify-between rounded-xl border border-[#A3A3A3]/80 px-3.5">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password"
                    autoComplete="new-password"
                    className="w-full bg-transparent text-[14px] font-medium text-white placeholder:text-white/60 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="ml-2 text-white/80 hover:text-white"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    <EyeIcon open={showPassword} />
                  </button>
                </div>
                <p className="text-[11px] font-medium leading-4 text-[#A3A3A3]">At least 8 Characters</p>
              </div>

              {/* Create Account */}
              <button
                type="submit"
                disabled={isSubmitting || !email || !password || !fullName}
                className="
                  flex h-11 items-center justify-center
                  rounded-xl bg-white
                  text-[15px] font-medium leading-5 text-black
                  hover:bg-white/90 transition-colors
                  disabled:opacity-50 disabled:cursor-not-allowed
                "
              >
                {isSubmitting ? (
                  <span className="flex items-center gap-2">
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-b-2 border-black" />
                    Creating account…
                  </span>
                ) : (
                  'Create Account'
                )}
              </button>

              {/* Terms text */}
              <p className="text-center text-[13px] leading-5 text-[#A3A3A3]">
                By continuing you agree to our{' '}
                <Link href="/terms" className="text-[#FF383C] hover:text-[#FF6A6A]">
                  Terms of Service
                </Link>
              </p>

              {/* Sign in link */}
              <Link href="/login">
                <button
                  type="button"
                  className="
                    flex h-11 w-full items-center justify-center
                    rounded-xl border border-[#737373]/80 bg-[#171717]
                    backdrop-blur-[18px]
                    text-[13px] font-normal text-white
                    hover:bg-[#1f1f1f] transition-colors
                  "
                >
                  Sign in to an existing account
                </button>
              </Link>
            </form>
          </div>
        </div>
      </div>
    </AuthBackdrop>
  );
}

function AuthBackdrop({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#0A0A0B]">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 auth-bg" />
      <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-10">
        {children}
      </div>
    </div>
  );
}

const GoogleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09Z" />
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.25 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23Z" />
    <path fill="#FBBC05" d="M5.84 14.1A6.97 6.97 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.05H2.18A11 11 0 0 0 1 12c0 1.77.42 3.45 1.18 4.95l3.66-2.85Z" />
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.07.56 4.21 1.65l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.05l3.66 2.85C6.71 7.31 9.14 5.38 12 5.38Z" />
  </svg>
);

const EyeIcon = ({ open }: { open: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {open ? (
      <>
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ) : (
      <>
        <path d="M17.94 17.94A10.43 10.43 0 0 1 12 19c-6.5 0-10-7-10-7a17.6 17.6 0 0 1 3.9-4.66" />
        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 7 10 7a17.7 17.7 0 0 1-2.16 3.19" />
        <path d="m1 1 22 22" />
        <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      </>
    )}
  </svg>
);
