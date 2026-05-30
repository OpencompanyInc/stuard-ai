import Link from 'next/link';
import SectionReveal from '@/components/layout/SectionReveal';
import MediaAssetSlot from '@/components/sections/MediaAssetSlot';

const CLOSING_VISUAL_SRC = process.env.NEXT_PUBLIC_CLOSING_SCREENSHOT_SRC;

const ClosingCTASection = () => {
  return (
    <section className="relative bg-[#0A0A0B] px-4 py-20 text-white sm:py-28 lg:py-32">
      <div className="mx-auto flex w-full max-w-[900px] flex-col items-center gap-10 text-center">
        <SectionReveal className="flex w-full flex-col items-center gap-6 sm:gap-8">
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
                See it work (60 sec)
              </button>
            </Link>
          </div>
          <p className="text-[12px] text-[#525252]">Built for your machine. Owned by you.</p>
        </SectionReveal>

        <SectionReveal delay={0.1} className="w-full max-w-[800px]">
          <MediaAssetSlot
            label="Optional: hero-quality screenshot of Stuard mid-task — or remove once you prefer wordmark-only close"
            assetPath="/media/closing-mid-task.png"
            imageSrc={CLOSING_VISUAL_SRC}
            imageAlt="Stuard operating apps on your PC"
            aspectClassName="aspect-[16/9]"
          />
        </SectionReveal>
      </div>
    </section>
  );
};

export default ClosingCTASection;
