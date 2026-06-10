"use client";

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useAuthContext } from '@/components/providers/AuthProvider';

const ROTATING_TASKS = [
  'send your emails',
  'organize your tasks',
  'run CLIs like Claude Code',
  'clean up your downloads',
  'call you with updates',
  'text you reminders',
  'schedule your week',
  'build you mini-apps',
] as const;

/** Longest phrase reserves the width so the line never jitters as tasks rotate. */
const LONGEST_TASK = ROTATING_TASKS.reduce((a, b) => (b.length > a.length ? b : a));

const ROTATE_INTERVAL_MS = 2400;

/**
 * "Just Ask Stuard — to <task>" — the motto stays put while tasks fly up and out
 * and the next one rises from beneath. Width is reserved by an invisible copy of
 * the longest phrase; the animated phrases are absolutely positioned inside that
 * box so nothing around them shifts.
 */
function RotatingTaskLine() {
  const reduce = useReducedMotion();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (reduce) return;
    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % ROTATING_TASKS.length);
    }, ROTATE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [reduce]);

  return (
    <p
      style={{ fontFamily: 'var(--font-general-sans)' }}
      className="
        flex items-baseline justify-center gap-[0.45em]
        text-[17px] sm:text-[20px] lg:text-[23px]
        font-normal tracking-[-0.01em]
      "
    >
      <span className="font-medium text-white">Just Ask Stuard</span>
      <span className="text-[#8A8A91]">to</span>
      <span className="relative inline-block overflow-hidden align-baseline">
        {/* invisible width-reserver */}
        <span className="invisible whitespace-nowrap font-medium">{LONGEST_TASK}</span>
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            key={ROTATING_TASKS[index]}
            initial={reduce ? { y: 0, opacity: 1 } : { y: '110%', opacity: 0, filter: 'blur(6px)' }}
            animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
            exit={reduce ? { opacity: 0 } : { y: '-110%', opacity: 0, filter: 'blur(6px)' }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-0 whitespace-nowrap text-left font-medium text-[#FF6B6E]"
          >
            {ROTATING_TASKS[index]}
            <span className="text-white/70">.</span>
          </motion.span>
        </AnimatePresence>
      </span>
    </p>
  );
}

const HeroSection = () => {
  const { user } = useAuthContext();
  useEffect(() => {
    document.body.classList.add('hero-dark');
    return () => {
      document.body.classList.remove('hero-dark');
    };
  }, []);

  return (
    <section className="hero-section relative overflow-x-hidden text-white">
      <div className="hero-bg" aria-hidden="true" />
      <div className="hero-vignette" aria-hidden="true" />
      {/* Fade the hero into the dark sections below so the scroll feels seamless */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] h-48 bg-gradient-to-b from-transparent to-[#0A0A0B]"
        aria-hidden="true"
      />

      <div className="relative z-10">
        {/* Headline + CTAs: centered in the viewport, clear of floating nav */}
        <div className="hero-copy-panel flex min-h-[100svh] min-h-screen flex-col px-4">
          <div className="flex flex-1 flex-col items-center justify-center pb-10 sm:pb-12">
            <div className="flex w-full max-w-[900px] flex-col items-center text-center gap-5 sm:gap-6 lg:gap-7">
              <h1
                style={{ fontFamily: 'var(--font-general-sans)' }}
                className="
                  w-full font-normal tracking-[-0.02em]
                  bg-gradient-to-b from-white to-white/75 bg-clip-text text-transparent
                  text-[40px] leading-[1.05]
                  sm:text-[58px]
                  md:text-[72px]
                  lg:text-[86px]
                "
              >
                Your personal AI workspace on your PC
              </h1>

              <RotatingTaskLine />

              <p
                className="
                  max-w-[640px]
                  text-[14px] leading-[21px]
                  sm:text-[15px] sm:leading-[23px]
                  lg:text-[17px] lg:leading-[27px]
                  font-normal
                  text-[#D4D4D4]
                "
              >
                Stuard AI turns your Windows PC into an AI-powered workspace. Ask in plain English —
                it organizes your files, manages your Gmail and Calendar, and works your apps — then
                save any task as a one-click automation that runs whenever you need it.
              </p>

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
                    See it work (60 sec)
                  </button>
                </Link>
              </div>

              <p className="text-[12px] sm:text-[13px] text-[#737373]">
                Runs locally. Your files never leave your machine.
              </p>

              <Link
                href={user ? '/dashboard' : '/signup'}
                className="text-[13px] font-medium text-[#A3A3A3] transition-colors hover:text-white"
              >
                {user ? 'Go to dashboard →' : 'Sign up →'}
              </Link>
            </div>
          </div>
        </div>

        <div className="mx-auto flex w-full max-w-[480px] flex-col items-center px-4 pb-16 sm:pb-20 lg:pb-24">
          <MacLinuxWaitlist />
        </div>
      </div>
    </section>
  );
};

type WaitlistPlatform = 'macos' | 'linux' | 'both';

const PLATFORM_OPTIONS: { value: WaitlistPlatform; label: string }[] = [
  { value: 'macos', label: 'macOS' },
  { value: 'linux', label: 'Linux' },
  { value: 'both', label: 'Both' },
];

function platformLabel(platform: WaitlistPlatform): string {
  if (platform === 'macos') return 'macOS';
  if (platform === 'linux') return 'Linux';
  return 'macOS & Linux';
}

function MacLinuxWaitlist() {
  const [email, setEmail] = useState('');
  const [platform, setPlatform] = useState<WaitlistPlatform | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [joinedPlatform, setJoinedPlatform] = useState<WaitlistPlatform | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!platform) {
      setError('Please select macOS, Linux, or Both.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          useCase: platform,
          referralSource: 'hero-waitlist',
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to join waitlist');
      }

      setJoinedPlatform(platform);
      setSuccess(true);
      setEmail('');
      setPlatform(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (success && joinedPlatform) {
    return (
      <WaitlistCard>
        <p className="text-[13px] text-[#E5E5E5]">
          You&apos;re on the waitlist for {platformLabel(joinedPlatform)}. We&apos;ll email you when it&apos;s ready.
        </p>
      </WaitlistCard>
    );
  }

  return (
    <WaitlistCard>
      <p className="mb-3 text-[13px] font-semibold text-[#D4D4D4]">macOS &amp; Linux — join the waitlist</p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <fieldset className="m-0 border-0 p-0">
          <legend className="sr-only">Which platform are you waiting for?</legend>
          <div className="flex gap-2">
            {PLATFORM_OPTIONS.map(({ value, label }) => {
              const selected = platform === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    setPlatform(value);
                    if (error === 'Please select macOS, Linux, or Both.') setError('');
                  }}
                  className={
                    "flex-1 rounded-xl border px-3 py-2 text-[13px] font-medium transition-colors " +
                    (selected
                      ? "border-[#FF383C]/60 bg-[#FF383C]/15 text-white"
                      : "border-white/15 bg-[#0A0A0B] text-[#A3A3A3] hover:border-white/25 hover:text-white")
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>
        </fieldset>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
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
            {loading ? 'Joining...' : 'Join waitlist'}
          </button>
        </div>
      </form>
      {error ? <p className="mt-2 text-left text-[12px] text-[#FF6B6B]">{error}</p> : null}
    </WaitlistCard>
  );
}

function WaitlistCard({ children }: { children: ReactNode }) {
  return (
    <div
      className="
        w-full rounded-2xl border border-[#262626] bg-[#111111]
        px-4 py-4 sm:px-5
        shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_20px_50px_-12px_rgba(0,0,0,0.55)]
      "
    >
      {children}
    </div>
  );
}

const WindowsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M3 3h8.5v8.5H3V3zm9.5 0H21v8.5h-8.5V3zM3 12.5h8.5V21H3v-8.5zm9.5 0H21V21h-8.5v-8.5z" />
  </svg>
);

export default HeroSection;
