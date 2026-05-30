import Link from 'next/link';
import SectionReveal from '@/components/layout/SectionReveal';

const PricingSection = () => {
  return (
    <section
      id="pricing"
      className="relative bg-[#0A0A0B] px-4 py-16 text-white sm:py-20 lg:py-24"
    >
      <div className="mx-auto flex w-full max-w-[720px] flex-col items-center gap-5 text-center">
        <SectionReveal className="flex flex-col items-center gap-4 sm:gap-5">
          <p className="text-[12px] sm:text-[13px] font-semibold tracking-wider text-[#FF383C]">
            PRICING
          </p>
          <h2 className="text-[22px] leading-[1.2] sm:text-[28px] lg:text-[32px] font-normal text-white">
            Start free. Pay only when you outgrow it.
          </h2>
          <p className="text-[15px] leading-[24px] sm:text-[17px] sm:leading-[26px] text-[#D4D4D4]">
            Free to get going. Paid plans from $5/mo when you need more compute.{' '}
            <Link
              href="/pricing"
              className="font-medium text-white underline-offset-4 hover:underline"
            >
              See full pricing →
            </Link>
          </p>
        </SectionReveal>
      </div>
    </section>
  );
};

export default PricingSection;
