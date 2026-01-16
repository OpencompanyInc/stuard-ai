'use client';

import { useState } from 'react';

interface WaitlistFormProps {
  variant?: 'hero' | 'inline' | 'modal';
  showExtendedFields?: boolean;
  className?: string;
}

export default function WaitlistForm({ 
  variant = 'hero', 
  showExtendedFields = false,
  className = '' 
}: WaitlistFormProps) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [useCase, setUseCase] = useState('');
  const [referralSource, setReferralSource] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [position, setPosition] = useState<number | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          name: name || undefined,
          company: company || undefined,
          useCase: useCase || undefined,
          referralSource: referralSource || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to join waitlist');
      }

      setSuccess(true);
      setPosition(data.position);
      
      // Reset form
      setEmail('');
      setName('');
      setCompany('');
      setUseCase('');
      setReferralSource('');
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className={`${variant === 'hero' ? 'max-w-md mx-auto' : ''} ${className}`}>
        <div className="bg-white rounded-2xl shadow-xl p-8 border-2 border-green-500 animate-fade-in">
          <div className="text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-2xl font-bold text-gray-900 mb-2">
              You&apos;re on the list! 🎉
            </h3>
            <p className="text-gray-600 mb-4">
              You&apos;re #{position?.toLocaleString()} in line for early access
            </p>
            <div className="bg-gradient-to-r from-primary/10 to-secondary/10 rounded-lg p-4 mb-6">
              <p className="text-sm text-gray-700 mb-2">
                <strong>What happens next?</strong>
              </p>
              <ul className="text-sm text-gray-600 text-left space-y-1">
                <li>✉️ Check your email for confirmation</li>
                <li>🚀 We&apos;ll notify you when access is available</li>
                <li>💰 Get 10% off your first 3 months</li>
              </ul>
            </div>
            <button
              onClick={() => setSuccess(false)}
              className="text-primary hover:text-primary-600 font-medium text-sm"
            >
              Join another email →
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`${variant === 'hero' ? 'max-w-md mx-auto' : ''} ${className}`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <label htmlFor="waitlist-email" className="sr-only">
              Email address
            </label>
            <input
              id="waitlist-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email"
              required
              className="w-full px-6 py-4 text-base text-gray-900 placeholder-gray-500 bg-white border-2 border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent shadow-sm transition-all"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="px-8 py-4 text-base font-bold text-white gradient-primary rounded-xl hover:shadow-xl hover:scale-105 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {loading ? (
              <span className="flex items-center justify-center">
                <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Joining...
              </span>
            ) : (
              'Join Waitlist'
            )}
          </button>
        </div>

        {showExtendedFields && (
          <div className="space-y-3 pt-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name (optional)"
              className="w-full px-4 py-3 text-sm text-gray-900 placeholder-gray-500 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            />
            <input
              type="text"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Company (optional)"
              className="w-full px-4 py-3 text-sm text-gray-900 placeholder-gray-500 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            />
            <select
              value={useCase}
              onChange={(e) => setUseCase(e.target.value)}
              className="w-full px-4 py-3 text-sm text-gray-900 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            >
              <option value="">What will you use Stuard AI for? (optional)</option>
              <option value="personal-productivity">Personal Productivity</option>
              <option value="business-tasks">Business Tasks</option>
              <option value="creative-work">Creative Work</option>
              <option value="development">Software Development</option>
              <option value="research">Research & Learning</option>
              <option value="other">Other</option>
            </select>
          </div>
        )}

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-xs text-gray-500 text-center">
            Be among the first to get early access. No spam, ever.
          </p>
          <div className="flex items-center justify-center gap-4 text-xs">
            <div className="flex items-center text-green-600 font-medium">
              <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              Windows, macOS, and Linux available
            </div>
            <div className="flex items-center text-gray-400">
              <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
              </svg>
              Runs locally on your device
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}

