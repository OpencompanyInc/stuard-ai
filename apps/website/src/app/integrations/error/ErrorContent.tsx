'use client';

import { useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import SectionReveal from '@/components/layout/SectionReveal';

export default function ErrorContent() {
  const searchParams = useSearchParams();
  const provider = useMemo(() => {
    const p = searchParams.get('provider');
    return p ? p.charAt(0).toUpperCase() + p.slice(1) : 'Integration';
  }, [searchParams]);
  const message = useMemo(
    () => searchParams.get('message') || 'An unknown error occurred.',
    [searchParams],
  );

  useEffect(() => {
    document.body.classList.add('hero-dark');
    return () => {
      document.body.classList.remove('hero-dark');
    };
  }, []);

  return (
    <main className="relative min-h-screen bg-[#0A0A0B] px-4 pt-28 pb-20 text-white">
      <div className="mx-auto flex w-full max-w-[640px] flex-col items-center text-center">
        <SectionReveal className="flex w-full flex-col items-center gap-6 rounded-2xl border border-[#FF383C]/40 bg-[rgba(255,56,60,0.05)] p-8 sm:p-10">
          <p className="text-[12px] sm:text-[13px] font-semibold tracking-wider text-[#FF383C]">
            CONNECTION FAILED
          </p>

          <div className="flex h-14 w-14 items-center justify-center rounded-full border border-[#FF383C]/40 bg-[#FF383C]/10">
            <svg
              className="h-7 w-7 text-[#FF383C]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </div>

          <div className="flex flex-col items-center gap-3">
            <h1 className="text-[26px] leading-[1.2] sm:text-[32px] lg:text-[36px] font-normal text-white">
              {provider} didn&apos;t connect.
            </h1>
            <p className="max-w-[460px] text-[15px] leading-[24px] sm:text-[16px] sm:leading-[26px] text-[#D4D4D4]">
              {message}
            </p>
          </div>

          <div className="flex w-full flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-center">
            <Link href="/integrations" className="block">
              <button
                type="button"
                className="inline-flex h-[44px] w-full items-center justify-center rounded-full border border-white/20 px-5 text-[14px] font-medium text-white transition-colors hover:bg-white/5 sm:w-auto"
              >
                Back to integrations
              </button>
            </Link>
            <a href="mailto:support@stuard.ai" className="block">
              <button
                type="button"
                className="inline-flex h-[44px] w-full items-center justify-center rounded-full bg-white px-5 text-[14px] font-medium text-[#080808] transition-colors hover:bg-white/90 sm:w-auto"
              >
                Contact support
              </button>
            </a>
          </div>

          <p className="text-[12px] text-[#525252]">
            Try again from the desktop app, or reach out and we&apos;ll dig in.
          </p>
        </SectionReveal>
      </div>
    </main>
  );
}
