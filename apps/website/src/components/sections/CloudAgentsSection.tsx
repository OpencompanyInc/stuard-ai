import Link from 'next/link';
import SectionReveal from '@/components/layout/SectionReveal';

const CloudAgentsSection = () => {
  return (
    <section
      id="cloud"
      className="relative border-y border-[#262626] bg-[#0A0A0B] px-4 py-16 text-white sm:py-20 lg:py-24"
    >
      <div className="mx-auto flex w-full max-w-[900px] flex-col items-center gap-8 text-center">
        <SectionReveal className="flex flex-col items-center gap-5 sm:gap-7">
          <p className="text-[12px] sm:text-[13px] font-semibold tracking-wider text-[#FF383C]">
            CLOUD AGENTS
          </p>
          <h2 className="text-[26px] leading-[1.2] sm:text-[36px] lg:text-[44px] font-normal text-white">
            When you need it running without you.
          </h2>
          <p className="max-w-[680px] text-[15px] leading-[24px] sm:text-[17px] sm:leading-[26px] text-[#D4D4D4]">
            Most workflows run on your laptop. But when a job needs to run while your laptop&apos;s
            closed — like checking your inbox every 5 minutes or watching a webhook — one click
            mirrors it to a cloud VM. Same workflow. Different host.
          </p>
          <Link href="/#cloud">
            <button
              type="button"
              className="mt-2 inline-flex h-[48px] items-center justify-center rounded-full border border-white/20 px-6 text-[14px] text-white transition-colors hover:bg-white/5"
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
