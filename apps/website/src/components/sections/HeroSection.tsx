"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

const ROTATING_TASKS = [
  'send your emails',
  'build you a website',
  'do your deep research',
  'make that tool you wished existed',
  'apply to internships for you',
  'call you with good news',
  'text you reminders',
  'remember everything',
] as const;

/** Longest phrase reserves the width so the line never jitters as tasks rotate. */
const LONGEST_TASK = ROTATING_TASKS.reduce((a, b) => (b.length > a.length ? b : a));

const ROTATE_INTERVAL_MS = 2400;

/**
 * The interactive compact-mode demo is the hero's explainer now — heavy
 * (framer-motion + react-markdown), so it loads after the static hero shell
 * paints. The placeholder mirrors the demo's backdrop so nothing jumps.
 */
const CompactDemo = dynamic(() => import('@/components/sections/CompactDemo'), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0" style={{ background: '#eceef3' }} aria-hidden>
      <div
        className="absolute inset-x-0 bottom-0 h-1/2"
        style={{
          background:
            'radial-gradient(135% 78% at 50% 122%, rgba(8,8,10,0.62) 0%, rgba(8,8,10,0.22) 40%, transparent 68%)',
        }}
      />
    </div>
  ),
});

/**
 * "Just Ask Stuard — to <task>" — the motto stays put while tasks fly up and out
 * and the next one rises from beneath.
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
        text-[16px] sm:text-[19px] lg:text-[22px]
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
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    document.body.classList.add('hero-dark');
    if (typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)) {
      setIsMac(true);
    }
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
        <div className="hero-copy-panel flex flex-col px-4 pb-16 sm:pb-20">
          <div className="mx-auto flex w-full max-w-[980px] flex-col items-center text-center gap-6 sm:gap-7">
            <h1
              style={{ fontFamily: 'var(--font-general-sans)' }}
              className="
                w-full font-normal tracking-[-0.02em]
                bg-gradient-to-b from-white to-white/75 bg-clip-text text-transparent
                text-[34px] leading-[1.08]
                sm:text-[48px]
                lg:text-[60px]
              "
            >
              Your personal AI, living on your PC
            </h1>

            <RotatingTaskLine />

            {/* The demo IS the pitch — type in it. */}
            <div className="w-full max-w-[880px]">
              <div
                className="relative w-full overflow-hidden rounded-2xl border border-white/10 bg-[#0d0d0f] shadow-[0_40px_120px_-32px_rgba(0,0,0,0.9)]"
                style={{ aspectRatio: '16 / 10' }}
              >
                <CompactDemo />
              </div>
              <p className="mt-3 text-[12px] sm:text-[13px] text-[#8A8A91]">
                This demo is live — click in and type. On your PC,{' '}
                <kbd className="rounded-md border border-white/15 bg-white/[0.06] px-1.5 py-0.5 text-[11px] font-medium text-white">
                  {isMac ? '⌘' : 'Ctrl'}
                </kbd>{' '}
                <span className="text-[#6f6f76]">+</span>{' '}
                <kbd className="rounded-md border border-white/15 bg-white/[0.06] px-1.5 py-0.5 text-[11px] font-medium text-white">
                  Space
                </kbd>{' '}
                drops Stuard over any app.
              </p>
            </div>

            <div className="flex flex-col items-center gap-3 sm:flex-row sm:gap-4">
              <Link href="/download">
                <button
                  type="button"
                  className="
                    inline-flex items-center justify-center gap-2
                    h-[44px] px-6
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
              <Link href="#day">
                <button
                  type="button"
                  className="
                    inline-flex items-center justify-center
                    h-[44px] px-6
                    rounded-full
                    border border-white/20
                    text-white text-[14px] font-medium
                    hover:bg-white/5 transition-colors
                    whitespace-nowrap
                  "
                >
                  See a day with Stuard ↓
                </button>
              </Link>
            </div>

            <p className="text-[12px] sm:text-[13px] text-[#737373]">
              Free forever on your machine · No credit card · Your files never leave your PC
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};

const WindowsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M3 3h8.5v8.5H3V3zm9.5 0H21v8.5h-8.5V3zM3 12.5h8.5V21H3v-8.5zm9.5 0H21V21h-8.5v-8.5z" />
  </svg>
);

export default HeroSection;
