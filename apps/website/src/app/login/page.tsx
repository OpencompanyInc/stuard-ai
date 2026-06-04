'use client';

import { useState } from 'react';
import { useAuthContext } from '@/components/providers/AuthProvider';
import { AuthBackdrop } from '@/components/auth/AuthBackdrop';
import { SignInCard } from '@/components/auth/SignInCard';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
  const { signIn } = useAuthContext();
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (email: string, password: string) => {
    setError('');
    setIsSubmitting(true);
    try {
      const result = await signIn(email, password);
      if (result.success) {
        setSuccess(true);
        window.location.href = '/dashboard';
      } else {
        setError(result.error || 'Invalid email or password');
        setIsSubmitting(false);
      }
    } catch {
      setError('An unexpected error occurred');
      setIsSubmitting(false);
    }
  };

  return (
    <AuthBackdrop>
      <SignInCard
        error={error}
        isSubmitting={isSubmitting}
        success={success}
        onSubmit={handleSubmit}
        onGoogleSuccess={() => { window.location.href = '/dashboard'; }}
        onGoogleError={setError}
        googleRedirectTo={typeof window !== 'undefined' ? `${window.location.origin}/auth` : undefined}
        enableGoogleOneTap
      />
    </AuthBackdrop>
  );
}
