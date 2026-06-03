import Link from 'next/link';
import { Check } from 'lucide-react';
import SectionReveal from '@/components/layout/SectionReveal';

const FREE_FEATURES = [
  'Everything that runs on your machine',
  'Chat, voice, workflows, and agents',
  'File search and memory, all local',
  'Bring your own API keys (BYOK)',
  'Use your ChatGPT subscription',
];

const CREDIT_FEATURES = [
  'Stuard-managed AI, no keys to wrangle',
  'Always-on Cloud Engine for agents',
  'Semantic search across your files',
  'Monthly or one-time, cancel anytime',
];

const CREDIT_ANCHORS = [
  { amount: '$5', credits: '100 credits' },
  { amount: '$30', credits: '700 credits' },
  { amount: '$100', credits: '2,500 credits' },
];

function FeatureList({ items }: { items: readonly string[] }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2.5 text-[14px] leading-[20px] text-[#D4D4D4]">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#FF6B6E]" strokeWidth={2.5} />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

const PricingSection = () => {
  return (
    <section id="pricing" className="relative bg-[#0A0A0B] px-4 py-16 text-white sm:py-20 lg:py-24">
      <div className="mx-auto flex w-full max-w-[960px] flex-col items-center gap-10 sm:gap-12">
        <SectionReveal className="flex flex-col items-center gap-4 text-center sm:gap-5">
          <p className="text-[12px] sm:text-[13px] font-semibold tracking-wider text-[#FF383C]">PRICING</p>
          <h2 className="text-[26px] leading-[1.2] sm:text-[36px] lg:text-[44px] font-normal text-white">
            Start free. Pay only for what you use.
          </h2>
          <p className="max-w-[620px] text-[15px] leading-[24px] sm:text-[17px] sm:leading-[26px] text-[#D4D4D4]">
            Stuard runs locally at no cost. Add credits only when you want managed AI, cloud agents,
            or semantic search, and pay whatever fits, starting at $5.
          </p>
        </SectionReveal>

        <div className="grid w-full gap-5 sm:grid-cols-2 sm:gap-6">
          {/* Free */}
          <SectionReveal className="h-full">
            <div className="flex h-full flex-col gap-6 rounded-2xl border border-[#262626] bg-[#111111] p-6 sm:p-7">
              <div>
                <p className="text-[13px] font-semibold uppercase tracking-wider text-[#A3A3A3]">Free</p>
                <div className="mt-2 flex items-baseline gap-1.5">
                  <span className="text-[40px] font-semibold leading-none text-white">$0</span>
                  <span className="text-[14px] text-[#737373]">forever</span>
                </div>
                <p className="mt-2 text-[14px] leading-[21px] text-[#A3A3A3]">
                  Everything that runs on your PC. No credit card.
                </p>
              </div>
              <FeatureList items={FREE_FEATURES} />
              <Link href="/download" className="mt-auto block">
                <button
                  type="button"
                  className="h-[46px] w-full rounded-full bg-white text-[14px] font-medium text-[#080808] transition-colors hover:bg-white/90"
                >
                  Download for Windows
                </button>
              </Link>
            </div>
          </SectionReveal>

          {/* Credits — pay what you want */}
          <SectionReveal delay={0.08} className="h-full">
            <div className="flex h-full flex-col gap-6 rounded-2xl border border-[#FF383C]/30 bg-[#150d0e] p-6 sm:p-7">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[13px] font-semibold uppercase tracking-wider text-[#FF6B6E]">Credits</p>
                  <span className="rounded-full border border-[#FF383C]/30 bg-[#FF383C]/10 px-2.5 py-0.5 text-[11px] font-medium text-[#FF8A8C]">
                    Pay what you want
                  </span>
                </div>
                <div className="mt-2 flex items-baseline gap-1.5">
                  <span className="text-[40px] font-semibold leading-none text-white">from $5</span>
                  <span className="text-[14px] text-[#737373]">/mo</span>
                </div>
                <p className="mt-2 text-[14px] leading-[21px] text-[#A3A3A3]">
                  Add credits only when you reach for the cloud.
                </p>
              </div>

              <div className="flex gap-2">
                {CREDIT_ANCHORS.map((anchor) => (
                  <div
                    key={anchor.amount}
                    className="flex-1 rounded-xl border border-white/[0.07] bg-white/[0.03] px-2 py-2.5 text-center"
                  >
                    <div className="text-[14px] font-semibold text-white">{anchor.amount}</div>
                    <div className="text-[11px] leading-tight text-[#9a9aa0]">{anchor.credits}</div>
                  </div>
                ))}
              </div>

              <FeatureList items={CREDIT_FEATURES} />
              <Link href="/signup" className="mt-auto block">
                <button
                  type="button"
                  className="h-[46px] w-full rounded-full border border-[#FF383C]/40 bg-[#FF383C]/15 text-[14px] font-medium text-white transition-colors hover:bg-[#FF383C]/25"
                >
                  Start free, add credits later
                </button>
              </Link>
            </div>
          </SectionReveal>
        </div>

        <p className="text-[13px] text-[#737373]">
          Prefer your own keys or your ChatGPT subscription? Bring them and skip credits entirely.
        </p>
      </div>
    </section>
  );
};

export default PricingSection;
