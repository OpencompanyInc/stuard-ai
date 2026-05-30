import Link from 'next/link';
import SectionReveal from '@/components/layout/SectionReveal';
import MediaAssetSlot from '@/components/sections/MediaAssetSlot';

const MARKETPLACE_IMAGE_SRC = process.env.NEXT_PUBLIC_MARKETPLACE_SCREENSHOT_SRC;

const MarketplacePromoSection = () => {
  return (
    <section
      id="marketplace"
      className="relative bg-[#0A0A0B] px-4 py-16 text-white sm:py-20 lg:py-24"
    >
      <div className="mx-auto flex w-full max-w-[1000px] flex-col items-center gap-8 sm:gap-10">
        <SectionReveal className="flex w-full flex-col items-center gap-5 sm:gap-7 text-center">
          <p className="text-[12px] sm:text-[13px] font-semibold tracking-wider text-[#FF383C]">
            MARKETPLACE
          </p>
          <h2 className="text-[26px] leading-[1.2] sm:text-[36px] lg:text-[44px] font-normal text-white">
            Don&apos;t build it. Install it.
          </h2>
          <p className="max-w-[640px] text-[15px] leading-[24px] sm:text-[17px] sm:leading-[26px] text-[#D4D4D4]">
            Browse mini-apps built by the community. Hit install. They run on your machine with your
            tools, your files, your accounts.
          </p>
        </SectionReveal>

        <SectionReveal delay={0.1} className="w-full">
          <MediaAssetSlot
            label="Real marketplace grid — community mini-apps, ratings, visible Install button"
            assetPath="/media/marketplace-grid.png"
            imageSrc={MARKETPLACE_IMAGE_SRC}
            imageAlt="Stuard marketplace with installable community mini-apps"
            aspectClassName="aspect-[16/9]"
          />
        </SectionReveal>

        <SectionReveal delay={0.15}>
          <Link href="/marketplace">
            <button
              type="button"
              className="inline-flex h-[52px] items-center justify-center gap-2 rounded-full border border-white/10 bg-white px-6 text-[15px] font-medium text-[#080808] transition-colors hover:bg-white/90"
            >
              Browse the marketplace
            </button>
          </Link>
        </SectionReveal>
      </div>
    </section>
  );
};

export default MarketplacePromoSection;
