'use client';

import { useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import SectionReveal from '@/components/layout/SectionReveal';

export default function SuccessContent() {
  const searchParams = useSearchParams();
  const provider = useMemo(() => {
    const p = searchParams.get('provider');
    return p ? p.charAt(0).toUpperCase() + p.slice(1) : 'Integration';
  }, [searchParams]);

  useEffect(() => {
    document.body.classList.add('hero-dark');
    return () => {
      document.body.classList.remove('hero-dark');
    };
  }, []);

  return (
    <main className="relative min-h-screen bg-[#0A0A0B] px-4 pt-28 pb-20 text-white">
      <div className="mx-auto flex w-full max-w-[640px] flex-col items-center text-center">
        <SectionReveal className="flex w-full flex-col items-center gap-6 rounded-2xl border border-[#262626] bg-[#111111] p-8 sm:p-10">
          <p className="text-[12px] sm:text-[13px] font-semibold tracking-wider text-[#FF383C]">
            INTEGRATION CONNECTED
          </p>

          <div className="flex h-14 w-14 items-center justify-center rounded-full border border-[#22C55E]/30 bg-[#22C55E]/10">
            <svg
              className="h-7 w-7 text-[#22C55E]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>

          <div className="flex flex-col items-center gap-3">
            <h1 className="text-[26px] leading-[1.2] sm:text-[32px] lg:text-[36px] font-normal text-white">
              {provider} connected.
            </h1>
            <p className="max-w-[460px] text-[15px] leading-[24px] sm:text-[16px] sm:leading-[26px] text-[#D4D4D4]">
              Your {provider} account is now linked to Stuard. Your workflows and agents can call
              it whenever they need to.
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
            <Link href="/dashboard" className="block">
              <button
                type="button"
                className="inline-flex h-[44px] w-full items-center justify-center rounded-full bg-white px-5 text-[14px] font-medium text-[#080808] transition-colors hover:bg-white/90 sm:w-auto"
              >
                Open dashboard
              </button>
            </Link>
          </div>

          <p className="text-[12px] text-[#525252]">
            You can safely close this window and return to the app.
          </p>
        </SectionReveal>
      </div>
    </main>
  );
}
