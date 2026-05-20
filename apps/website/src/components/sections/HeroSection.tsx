"use client";

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';

const HeroSection = () => {
  useEffect(() => {
    document.body.classList.add('hero-dark');
    return () => {
      document.body.classList.remove('hero-dark');
    };
  }, []);

  return (
    <section
      className="
        hero-section
        relative
        flex flex-col items-center justify-center
        min-h-screen
        px-4
        py-20
        overflow-x-hidden
        text-white
      "
    >
      <div className="hero-bg" aria-hidden="true" />
      <div className="hero-vignette" aria-hidden="true" />

      <div className="relative z-10 flex flex-col items-center text-center w-full max-w-[720px] mx-auto gap-7 sm:gap-8 lg:gap-9">
        <div className="flex flex-col items-center gap-4 sm:gap-5 lg:gap-6 w-full">
          <h1
            className="
              w-full
              font-medium tracking-tight text-white
              text-[28px] leading-[1.15]
              sm:text-[36px] sm:leading-[1.15]
              md:text-[44px] md:leading-[1.12]
              lg:text-[52px] lg:leading-[1.1]
            "
          >
            The AI workspace for your PC.
          </h1>

          <p
            className="
              max-w-[600px]
              text-[14px] leading-[20px]
              sm:text-[15px] sm:leading-[22px]
              lg:text-[17px] lg:leading-[26px]
              font-normal
              text-[#A3A3A3]
            "
          >
            Stuard plugs into your files, your apps, and every tool your computer exposes — then turns
            repeated work into workflows, mini-apps, and agents you can reuse forever.
          </p>
        </div>

        <div className="flex w-full max-w-[480px] flex-col items-center gap-4 sm:gap-5">
          <div className="flex flex-col sm:flex-row items-center gap-3 sm:gap-4">
            <Link href="/download">
              <button
                type="button"
                className="
                  inline-flex items-center justify-center gap-2
                  h-[42px] px-5
                  rounded-full
                  bg-[#F5F5F5] hover:bg-white
                  text-black text-[14px] font-medium leading-5
                  transition-colors
                  whitespace-nowrap
                "
              >
                <WindowsIcon />
                Download for Windows
              </button>
            </Link>
            <Link href="#demo">
              <button
                type="button"
                className="
                  inline-flex items-center justify-center
                  h-[42px] px-5
                  rounded-full
                  border border-white/20
                  text-white text-[14px] font-medium
                  hover:bg-white/5 transition-colors
                  whitespace-nowrap
                "
              >
                See a 90-second demo
              </button>
            </Link>
          </div>
          <p className="text-[12px] sm:text-[13px] text-[#737373]">
            Free. Local-first. No credit card.
          </p>

          <MacLinuxWaitlist />
        </div>
      </div>
    </section>
  );
};

function MacLinuxWaitlist() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

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
          useCase: 'macos-linux',
          referralSource: 'hero-waitlist',
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to join waitlist');
      }

      setSuccess(true);
      setEmail('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <WaitlistGlowCard>
        <p className="text-[13px] text-[#E5E5E5]">
          You&apos;re on the waitlist. We&apos;ll email you when macOS &amp; Linux are ready.
        </p>
      </WaitlistGlowCard>
    );
  }

  return (
    <WaitlistGlowCard>
      <p className="mb-3 text-[13px] font-medium text-[#A3A3A3]">macOS &amp; Linux — join the waitlist</p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@email.com"
          required
          className="
            min-w-0 flex-1 rounded-xl border border-white/15 bg-[#0A0A0B]
            px-3 py-2.5 text-[14px] text-white placeholder:text-[#525252]
            focus:outline-none focus:ring-1 focus:ring-[#FF383C]/50
          "
        />
        <button
          type="submit"
          disabled={loading}
          className="
            shrink-0 rounded-xl border border-[#FF383C]/40 bg-[#FF383C]/10 px-4 py-2.5
            text-[14px] font-medium text-white
            hover:bg-[#FF383C]/20 transition-colors
            disabled:opacity-50
          "
        >
          {loading ? 'Joining…' : 'Join waitlist'}
        </button>
      </form>
      {error ? <p className="mt-2 text-left text-[12px] text-[#FF6B6B]">{error}</p> : null}
    </WaitlistGlowCard>
  );
}

function WaitlistGlowCard({ children }: { children: ReactNode }) {
  return (
    <div className="waitlist-glow-border">
      <div className="waitlist-glow-border__inner px-4 py-4 sm:px-5">{children}
      </div>
    </div>
  );
}

const WindowsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801" />
  </svg>
);

export default HeroSection;
