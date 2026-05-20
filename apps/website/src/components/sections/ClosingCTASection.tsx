import Link from 'next/link';
import SectionReveal from '@/components/layout/SectionReveal';

const ClosingCTASection = () => {
  return (
    <section className="relative bg-[#0A0A0B] px-4 py-20 text-white sm:py-28 lg:py-32">
      <div className="mx-auto flex w-full max-w-[800px] flex-col items-center gap-8 text-center">
        <SectionReveal className="flex flex-col items-center gap-6 sm:gap-8">
          <h2 className="text-[28px] leading-[1.15] sm:text-[40px] lg:text-[48px] font-normal text-white">
            Your PC is more powerful than your chatbot thinks.
          </h2>
          <p className="text-[16px] sm:text-[18px] text-[#A3A3A3]">
            Give it an assistant that knows that.
          </p>
          <div className="flex flex-col sm:flex-row items-center gap-3 sm:gap-4">
            <Link href="/download">
              <button
                type="button"
                className="inline-flex h-[48px] items-center justify-center gap-2 rounded-full bg-white px-6 text-[15px] font-medium text-[#080808] transition-colors hover:bg-white/90"
              >
                Download Stuard
              </button>
            </Link>
            <Link href="#demo">
              <button
                type="button"
                className="inline-flex h-[48px] items-center justify-center rounded-full border border-white/20 px-6 text-[15px] text-white transition-colors hover:bg-white/5"
              >
                See a 90-second demo
              </button>
            </Link>
          </div>
          <p className="text-[12px] text-[#525252]">Built for your machine. Owned by you.</p>
        </SectionReveal>
      </div>
    </section>
  );
};

export default ClosingCTASection;
