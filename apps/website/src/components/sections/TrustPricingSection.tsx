import Link from 'next/link';
import { ArrowRight, Check } from 'lucide-react';
import SectionReveal from '@/components/layout/SectionReveal';

/**
 * TrustPricingSection — privacy and cost condensed to one band. The Google
 * data-usage statement stays on the homepage (OAuth verification reviewers
 * look for it) but the deep detail lives on /privacy and /pricing.
 */

const FREE_POINTS = [
  'Chat, workflows, mini-apps, and agents on your PC',
  'Bring your own API keys or ChatGPT subscription',
  'Local file search and memory',
];

const CREDIT_POINTS = [
  'Stuard-managed AI — no keys to wrangle',
  'Always-on cloud computer for your agents',
  'Pay what you want, from $5 · cancel anytime',
];

export default function TrustPricingSection() {
  return (
    <section id="pricing" className="relative bg-[#0A0A0B] px-4 py-20 text-white sm:py-24">
      <div className="mx-auto grid w-full max-w-[1000px] grid-cols-1 gap-5 lg:grid-cols-2 sm:gap-6">
        {/* Privacy */}
        <SectionReveal className="h-full">
          <div className="flex h-full flex-col gap-4 rounded-2xl border border-[#222225] bg-[#101012] p-7 sm:p-8">
            <p className="text-[12px] font-semibold tracking-wider text-[#FF383C]">
              PRIVATE BY ARCHITECTURE
            </p>
            <h2
              className="text-[24px] leading-[1.2] text-white sm:text-[28px]"
              style={{ fontFamily: 'var(--font-general-sans)' }}
            >
              The whole day stayed on your machine.
            </h2>
            <p className="text-[14px] leading-[23px] text-[#A8A8AE]">
              Your files, screen, and conversations never leave your PC. Connected accounts like
              Gmail, Calendar, and Drive are touched only when a task you asked for needs them —
              never sold, never used to train models. The only things in the cloud are your
              encrypted memories and tokens, with keys we can&apos;t read.
            </p>
            <Link
              href="/privacy"
              className="group mt-auto inline-flex items-center gap-1.5 text-[13px] font-medium text-[#D4D4D4] transition-colors hover:text-white"
            >
              Read the full privacy policy
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
            </Link>
          </div>
        </SectionReveal>

        {/* Pricing */}
        <SectionReveal delay={0.08} className="h-full">
          <div className="flex h-full flex-col gap-4 rounded-2xl border border-[#FF383C]/25 bg-[#140e0f] p-7 sm:p-8">
            <p className="text-[12px] font-semibold tracking-wider text-[#FF6B6E]">
              AND IT WAS FREE
            </p>
            <h2
              className="text-[24px] leading-[1.2] text-white sm:text-[28px]"
              style={{ fontFamily: 'var(--font-general-sans)' }}
            >
              $0 on your PC, forever.
            </h2>
            <ul className="flex flex-col gap-2">
              {FREE_POINTS.map((p) => (
                <li key={p} className="flex items-start gap-2.5 text-[13.5px] leading-[20px] text-[#D4D4D4]">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#FF6B6E]" strokeWidth={2.5} />
                  {p}
                </li>
              ))}
            </ul>
            <p className="text-[13px] font-medium text-[#A8A8AE]">
              Reach for the cloud only when you want it:
            </p>
            <ul className="flex flex-col gap-2">
              {CREDIT_POINTS.map((p) => (
                <li key={p} className="flex items-start gap-2.5 text-[13.5px] leading-[20px] text-[#D4D4D4]">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#FF6B6E]" strokeWidth={2.5} />
                  {p}
                </li>
              ))}
            </ul>
            <Link
              href="/pricing"
              className="group mt-auto inline-flex items-center gap-1.5 text-[13px] font-medium text-[#D4D4D4] transition-colors hover:text-white"
            >
              Full pricing details
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
            </Link>
          </div>
        </SectionReveal>
      </div>
    </section>
  );
}
