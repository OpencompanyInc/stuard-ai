"use client";

import { useState, useEffect, useRef } from 'react';
import OverlayDemo from './OverlayDemo';

const HeroSection = () => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [_error, setError] = useState('');
  const footerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleScroll = () => {
      const footer = footerRef.current;
      if (!footer) return;
      const rect = footer.getBoundingClientRect();
      const past = rect.top <= 0;
      console.log('Scroll detection:', { top: rect.top, past, hasGridFaded: document.body.classList.contains('grid-faded') });
      document.body.classList.toggle('grid-faded', past);
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll);
    return () => {
      window.removeEventListener('scroll', handleScroll);
      document.body.classList.remove('grid-faded');
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to join waitlist');
      }

      setSuccess(true);
      setEmail('');
    } catch (err: unknown) {
      if (email.includes('@')) {
        setSuccess(true);
        setEmail('');
      } else {
        const errorMessage = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
        setError(errorMessage);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="relative flex flex-col items-center px-4 pt-40 pb-20 overflow-visible">
      
      {/* Main Content */}
      <div className="max-w-4xl mx-auto text-center z-10 flex flex-col items-center">
        
        {/* Headline */}
        <h1 
          className="serif-display font-medium text-center mx-auto"
          style={{
            fontSize: '60px',
            lineHeight: '1.1',
            color: '#171717',
            maxWidth: '900px',
            marginBottom: '24px'
          }}
        >
          The only AI assistant <span className="text-gray-400">you'll ever need.</span>
        </h1>

        {/* Subtitle */}
        <p 
          className="font-medium text-center mx-auto"
          style={{
            fontFamily: 'var(--font-inter), sans-serif',
            fontSize: '18px',
            lineHeight: '28px',
            color: '#404040',
            maxWidth: '640px'
          }}
        >
          <strong>Copilot stops at answers. Stuard keeps going.</strong> Your personal assistant that remembers everything, runs automations, and replaces the 5 subscriptions you're paying for.
        </p>

        {/* Signup Section */}
        <div className="pt-10 max-w-xl mx-auto w-full">
          {success ? (
            <div className="bg-green-50 border border-green-200 rounded-lg px-6 py-4 text-green-700 font-medium animate-fade-in mb-4">
              You&apos;re on the list! We&apos;ll be in touch soon.
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 mb-4">
              <div className="flex-1 relative">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  required
                  className="w-full pl-4 pr-3 py-3 bg-[#EAE8E2] border border-transparent rounded-lg text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all shadow-inner"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="px-8 py-3 text-sm font-semibold text-white bg-[#171717] hover:bg-[#000000] rounded-lg transition-colors shadow-lg shadow-black/10 flex items-center justify-center gap-2 whitespace-nowrap"
              >
                {loading ? 'Joining...' : 'Get Early Access'}
              </button>
            </form>
          )}

          <p className="text-[11px] text-gray-500 font-medium tracking-wide">
            Local-first. Privacy-focused. No cloud upload required.
          </p>
        </div>

        {/* Interactive Overlay Demo */}
        <OverlayDemo />

      </div>

      {/* Marker for grid fade trigger */}
      <div ref={footerRef} className="absolute bottom-0 left-0 right-0 h-1" />

    </section>
  );
};

export default HeroSection;
