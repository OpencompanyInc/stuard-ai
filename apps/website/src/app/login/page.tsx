'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuthContext } from '@/components/providers/AuthProvider';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/Card';

// Force dynamic rendering to avoid SSR issues
export const dynamic = 'force-dynamic';

import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const { signIn, signInWithGoogle } = useAuthContext();
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    rememberMe: false
  });
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const result = await signIn(formData.email, formData.password);

      if (result.success) {
        // Auth redirect handled by useAuth hook
        console.log('Login successful - redirecting to dashboard');
        await router.push('/dashboard');
      } else {
        setError(result.error || 'Failed to sign in');
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred';
      setError(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    try {
      const result = await signInWithGoogle();
      if (result.success) {
        // Auth redirect handled by useAuth hook
        console.log('Google login successful - redirecting to dashboard');
        await router.push('/dashboard');
      } else {
        setError(result.error || 'Failed to sign in with Google');
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
          <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=2564&auto=format&fit=crop')] opacity-10 bg-cover bg-center" />
          <div className="absolute inset-0 bg-gradient-to-br from-primary/90 to-purple-900/90 mix-blend-multiply" />

          <div className="relative z-10">
            <Link href="/" className="flex items-center space-x-2 text-2xl font-bold font-stuard">
              <span>Stuard</span>
            </Link>
          </div>

          <div className="relative z-10 max-w-lg">
            <h2 className="text-4xl font-bold mb-6 leading-tight">
              Automation that thinks, sees, and does.
            </h2>
            <p className="text-lg text-white/80 leading-relaxed mb-8">
              &quot;Stuard has completely transformed how I manage my daily workflows. It&apos;s not just a chatbot; it&apos;s a proactive assistant that actually gets things done on my desktop.&quot;
            </p>
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center font-bold">
                JD
              </div>
              <div>
                <div className="font-semibold">Jane Doe</div>
                <div className="text-sm text-white/60">Product Designer</div>
              </div>
            </div>
          </div>

          <div className="relative z-10 text-sm text-white/40">
            © 2024 Stuard AI Inc.
          </div>
        </div>

        {/* Right Form Side */}
        <div className="flex items-center justify-center p-6 lg:p-12 bg-gray-50/50">
          <div className="max-w-md w-full">
            <div className="text-center lg:text-left mb-8">
              <h1 className="text-3xl font-bold text-gray-900 mb-2">Welcome back</h1>
              <p className="text-gray-600">Enter your details to access your workspace.</p>
            </div>

            <Card className="border-none shadow-none bg-transparent lg:bg-white lg:shadow-xl lg:border lg:border-gray-100">
              <CardContent className="p-0 lg:p-6">
                {/* Error Message */}
                {error && (
                  <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-xl">
                    <p className="text-sm text-red-600">{error}</p>
                  </div>
                )}

                {/* Social Login */}
                <div className="grid grid-cols-2 gap-3 mb-6">
                  <Button onClick={handleGoogleSignIn} type="button" variant="outline" className="w-full bg-white">
                    <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24" fill="none">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                    </svg>
                    Google
                  </Button>
                  <Button variant="outline" className="w-full bg-white">
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
                    <span className="px-2 bg-gray-50 lg:bg-white text-gray-500 font-medium">Or continue with email</span>
                  </div>
                </div>

                {/* Login Form */}
                <form onSubmit={handleSubmit} className="space-y-4" noValidate>
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
                  <div className="space-y-1">
                    <Input
                      type="password"
                      name="password"
                      required
                      value={formData.password}
                      onChange={handleInputChange}
                      label="Password"
                      placeholder="••••••••"
                      autoComplete="current-password"
                      className="bg-white"
                    />
                    <div className="flex justify-end">
                      <Link href="/forgot-password" className="text-sm font-medium text-primary hover:text-primary/80">
                        Forgot password?
                      </Link>
                    </div>
                  </div>

                  <div className="flex items-center mb-6">
                    <input
                      type="checkbox"
                      id="rememberMe"
                      name="rememberMe"
                      checked={formData.rememberMe}
                      onChange={handleInputChange}
                      className="w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary"
                    />
                    <label htmlFor="rememberMe" className="ml-2 text-sm text-gray-600">Remember me for 30 days</label>
                  </div>

                  <Button type="submit" disabled={isSubmitting} className="w-full" size="lg">
                    {isSubmitting ? 'Signing In...' : 'Sign In'}
                  </Button>
                </form>

                <div className="text-center mt-6">
                  <p className="text-sm text-gray-600">
                    Don&apos;t have an account?{' '}
                    <Link href="/signup" className="font-semibold text-primary hover:text-primary/80">
                      Sign up for free
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