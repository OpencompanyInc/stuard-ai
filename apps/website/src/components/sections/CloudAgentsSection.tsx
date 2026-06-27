import Link from 'next/link';
import SectionReveal from '@/components/layout/SectionReveal';
import CloudHandoffDiagram from '@/components/sections/CloudHandoffDiagram';

const CloudAgentsSection = () => {
  return (
    <section
      id="cloud"
      className="relative border-y border-[#262626] bg-[#0A0A0B] px-4 py-16 text-white sm:py-20 lg:py-24"
    >
      <div className="mx-auto flex w-full max-w-[900px] flex-col items-center gap-8 sm:gap-10">
        <SectionReveal className="flex flex-col items-center gap-5 sm:gap-7 text-center">
          <p className="text-[12px] sm:text-[13px] font-semibold tracking-wider text-[#FF383C]">
            CLOUD AGENTS
          </p>
          <h2 className="text-[26px] leading-[1.2] sm:text-[36px] lg:text-[44px] font-normal text-white">
            When you need it running without you.
          </h2>
          <p className="max-w-[680px] text-[15px] leading-[24px] sm:text-[17px] sm:leading-[26px] text-[#D4D4D4]">
            Most workflows run on your laptop. When a job needs to run while your laptop&apos;s
            closed — inbox checks, webhooks, scheduled runs — one click mirrors it to a cloud VM.
          </p>
        </SectionReveal>

        <SectionReveal delay={0.1}>
          <CloudHandoffDiagram />
        </SectionReveal>

        <SectionReveal delay={0.15}>
          <Link href="/how-it-works">
            <button
              type="button"
              className="inline-flex h-[48px] items-center justify-center rounded-full border border-white/20 px-6 text-[14px] text-white transition-colors hover:bg-white/5"
            >
              Learn how cloud agents work
            </button>
          </Link>
        </SectionReveal>
      </div>
    </section>
  );
};

export default CloudAgentsSection;
