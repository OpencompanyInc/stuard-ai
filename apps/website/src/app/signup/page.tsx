'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthContext } from '@/components/providers/AuthProvider';
import { SignupOnboardingQuiz } from '@/components/auth/SignupOnboardingQuiz';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/Card';
import {
  DEFAULT_ONBOARDING_PROFILE,
  ONBOARDING_PROFILE_STORAGE_KEY,
  type OnboardingProfile,
} from '../../../../../shared/onboardingProfile';

// Force dynamic rendering to avoid SSR issues
export const dynamic = 'force-dynamic';

export default function SignUpPage() {
  const { signUp, signInWithGoogle } = useAuthContext();
  const router = useRouter();
  const [formData, setFormData] = useState({
    fullName: '',

    email: '',
    password: '',
    confirmPassword: '',
    phone: '',
    smsControl: false,
    agreeToTerms: false,
    marketingEmails: false
  });
  const [onboardingProfile, setOnboardingProfile] = useState<OnboardingProfile>({
    ...DEFAULT_ONBOARDING_PROFILE,
    source: 'website_signup',
    updatedAt: new Date().toISOString(),
  });
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [passwordStrength, setPasswordStrength] = useState({
    score: 0,
    feedback: ''
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));

    // Check password strength
    if (name === 'password') {
      checkPasswordStrength(value);
    }
  };

  const checkPasswordStrength = (password: string) => {
    let score = 0;
    let feedback = '';

    if (password.length >= 8) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[a-z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;

    switch (score) {
      case 0:
      case 1:
        feedback = 'Weak';
        break;
      case 2:
      case 3:
        feedback = 'Medium';
        break;
      case 4:
      case 5:
        feedback = 'Strong';
        break;
    }

    setPasswordStrength({ score, feedback });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (!formData.agreeToTerms) {
      setError('Please agree to the Terms of Service and Privacy Policy');
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await signUp(
        formData.email,
        formData.password,
        formData.fullName,
        formData.phone || undefined,
        formData.smsControl,
        formData.marketingEmails,
        {
          ...onboardingProfile,
          source: 'website_signup',
          updatedAt: new Date().toISOString(),
        }
      );

      if (result.success) {
        try { localStorage.removeItem(ONBOARDING_PROFILE_STORAGE_KEY); } catch { }
        // Redirect to verify-email with the user's email
        router.push(`/verify-email?email=${encodeURIComponent(formData.email)}`);
        return;
      } else {
        setError(result.error || 'Failed to create account');
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred';
      setError(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleSignUp = async () => {
    setError('');
    try {
      try {
        localStorage.setItem(
          ONBOARDING_PROFILE_STORAGE_KEY,
          JSON.stringify({
            ...onboardingProfile,
            source: 'website_google',
            updatedAt: new Date().toISOString(),
          })
        );
      } catch { }
      const result = await signInWithGoogle();
      if (result.success) {
        // Auth redirect handled by useAuth hook
        console.log('Google signup successful - redirect handled by auth system');
      } else {
        setError(result.error || 'Failed to sign up with Google');
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred';
      setError(errorMessage);
    }
  };

  return (
    <>
      <div className="min-h-screen grid lg:grid-cols-2">
        {/* Left Visual Side */}
        <div className="hidden lg:flex flex-col justify-between bg-gray-900 relative overflow-hidden p-12 text-white">
          <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1614028674026-a65e31bfd27c?q=80&w=2564&auto=format&fit=crop')] opacity-10 bg-cover bg-center" />
          <div className="absolute inset-0 bg-gradient-to-br from-primary/90 to-blue-900/90 mix-blend-multiply" />

          <div className="relative z-10">
            <Link href="/" className="flex items-center space-x-2 text-2xl font-bold font-stuard">
              <span>Stuard</span>
            </Link>
          </div>

          <div className="relative z-10 max-w-lg">
            <h2 className="text-4xl font-bold mb-6 leading-tight">
              Start your journey with intelligent automation.
            </h2>
            <ul className="space-y-4 text-lg text-white/90">
              <li className="flex items-start gap-3">
                <div className="mt-1 bg-white/20 p-1 rounded-full">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                </div>
                <span>Start free with about 15 starter credits, no credit card required</span>
              </li>
              <li className="flex items-start gap-3">
                <div className="mt-1 bg-white/20 p-1 rounded-full">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                </div>
                <span>Access to all premium AI models</span>
              </li>
              <li className="flex items-start gap-3">
                <div className="mt-1 bg-white/20 p-1 rounded-full">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                </div>
                <span>Full desktop control & automation</span>
              </li>
            </ul>
          </div>

          <div className="relative z-10 text-sm text-white/40">
            &copy; 2024 Stuard AI Inc.
          </div>
        </div>

        {/* Right Form Side */}
        <div className="flex items-center justify-center p-6 lg:p-12 bg-transparent relative z-10">
          <div className="max-w-md w-full">
            <div className="text-center lg:text-left mb-8">
              <h1 className="text-3xl font-bold text-gray-900 mb-2">Create an account</h1>
              <p className="text-gray-600">Get started on the free plan with about 15 starter credits.</p>
            </div>

            <Card className="border-none shadow-none bg-transparent lg:bg-white/80 lg:backdrop-blur-xl lg:shadow-sm lg:border lg:border-black/5 lg:rounded-3xl">
              <CardContent className="p-0 lg:p-6">
                {/* Error Message */}
                {error && (
                  <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-xl">
                    <p className="text-sm text-red-600">{error}</p>
                  </div>
                )}

                {/* Social Signup */}
                <div className="grid grid-cols-2 gap-3 mb-6">
                  <Button onClick={handleGoogleSignUp} type="button" variant="outline" className="w-full bg-white">
                    <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24" fill="#4285F4">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                    </svg>
                    Google
                  </Button>
                  <Button type="button" disabled className="w-full bg-white" variant="outline">
                    <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24" fill="#000">
                      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
                    </svg>
                    Apple
                  </Button>
                </div>

                <div className="relative mb-6">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-gray-200"></div>
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="px-2 bg-gray-50 lg:bg-white text-gray-500 font-medium">Or sign up with email</span>
                  </div>
                </div>

                {/* Signup Form */}
                <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                  <Input
                    type="text"
                    name="fullName"
                    required
                    value={formData.fullName}
                    onChange={handleInputChange}
                    label="Full Name"
                    placeholder="Enter your full name"
                    autoComplete="name"
                    className="bg-white"
                  />
                  <Input
                    type="email"
                    name="email"
                    required
                    value={formData.email}
                    onChange={handleInputChange}
                    label="Email"
                    placeholder="Enter your email"
                    autoComplete="email"
                    className="bg-white"
                  />

                  <SignupOnboardingQuiz
                    value={onboardingProfile}
                    onChange={setOnboardingProfile}
                  />

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <Input
                        type="password"
                        name="password"
                        required
                        value={formData.password}
                        onChange={handleInputChange}
                        label="Password"
                        placeholder="Create password"
                        autoComplete="new-password"
                        className="bg-white"
                      />
                    </div>
                    <div>
                      <Input
                        type="password"
                        name="confirmPassword"
                        required
                        value={formData.confirmPassword}
                        onChange={handleInputChange}
                        label="Confirm"
                        placeholder="Repeat password"
                        autoComplete="new-password"
                        className="bg-white"
                      />
                    </div>
                  </div>

                  {formData.password && (
                    <div className="text-xs">
                      <div className="flex justify-between mb-1">
                        <span className="text-gray-500">Strength</span>
                        <span className={`font-medium ${passwordStrength.score >= 4 ? 'text-green-600' :
                            passwordStrength.score >= 2 ? 'text-yellow-600' : 'text-red-600'
                          }`}>
                          {passwordStrength.feedback}
                        </span>
                      </div>
                      <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-300 ${passwordStrength.score >= 4 ? 'bg-green-500' :
                              passwordStrength.score >= 2 ? 'bg-yellow-500' : 'bg-red-500'
                            }`}
                          style={{ width: `${(passwordStrength.score / 5) * 100}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Optional Phone */}
                  <div className="pt-2">
                    <Input
                      type="tel"
                      name="phone"
                      value={formData.phone}
                      onChange={handleInputChange}
                      label="Phone Number (Optional)"
                      placeholder="For account notifications"
                      autoComplete="tel"
                      className="bg-white"
                    />
                  </div>

                  {/* Terms Checkboxes */}
                  <div className="space-y-3 pt-2">
                    <div className="flex items-start">
                      <input
                        type="checkbox"
                        id="agreeToTerms"
                        name="agreeToTerms"
                        required
                        checked={formData.agreeToTerms}
                        onChange={handleInputChange}
                        className="mt-1 w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary"
                      />
                      <label htmlFor="agreeToTerms" className="ml-2 text-sm text-gray-600">
                        I agree to the <Link href="/terms" className="text-primary hover:text-primary/80 font-medium">Terms</Link> and <Link href="/privacy" className="text-primary hover:text-primary/80 font-medium">Privacy Policy</Link>
                      </label>
                    </div>

                    <div className="flex items-start">
                      <input
                        type="checkbox"
                        id="smsControl"
                        name="smsControl"
                        checked={formData.smsControl}
                        onChange={handleInputChange}
                        className="mt-1 w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary"
                      />
                      <label htmlFor="smsControl" className="ml-2 text-sm text-gray-600">
                        Enable app control & SMS features
                      </label>
                    </div>
                  </div>

                  <Button
                    type="submit"
                    disabled={!formData.agreeToTerms || formData.password !== formData.confirmPassword || isSubmitting}
                    className="w-full gradient-primary text-white font-bold border-0 shadow-sm"
                    size="lg"
                  >
                    {isSubmitting ? 'Creating Account...' : 'Create Account'}
                  </Button>
                </form>

                <div className="text-center mt-6">
                  <p className="text-sm text-gray-600">
                    Already have an account?{' '}
                    <Link href="/login" className="font-semibold text-primary hover:text-primary/80">
                      Sign in
                    </Link>
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
} 