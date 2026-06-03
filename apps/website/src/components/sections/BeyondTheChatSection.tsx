import SectionReveal from '@/components/layout/SectionReveal';
import MediaAssetSlot from '@/components/sections/MediaAssetSlot';

const DEMO_VIDEO_SRC = process.env.NEXT_PUBLIC_DEMO_VIDEO_SRC;

const BeyondTheChatSection = () => {
  return (
    <section
      id="demo"
      className="relative flex flex-col items-center bg-[#0A0A0B] text-white px-4 py-16 sm:py-20 lg:py-24"
    >
      <div className="mx-auto flex w-full max-w-[1100px] flex-col items-center gap-8 sm:gap-10 lg:gap-12">
        <SectionReveal className="flex w-full max-w-[780px] flex-col items-center gap-4 sm:gap-5 text-center">
          <p className="text-[12px] sm:text-[13px] lg:text-[14px] font-semibold tracking-wider text-[#FF383C]">
            BUILD ONCE, REUSE FOREVER
          </p>
          <h2 className="text-[22px] leading-[1.2] sm:text-[28px] lg:text-[36px] font-normal text-white">
            From a sentence to a workflow to a{' '}
            <span className="text-[#FF383C]">mini-app</span>, in one flow.
          </h2>
          <p className="max-w-[720px] text-[14px] leading-[22px] sm:text-[15px] sm:leading-[24px] lg:text-[16px] lg:leading-[26px] text-[#E5E5E5]">
            Describe what you want. Stuard wires up the steps, then wraps them in a UI you can run
            any time. No code, no rebuilding it twice.
          </p>
        </SectionReveal>

        <SectionReveal delay={0.1} className="w-full">
          <MediaAssetSlot
            label="Build demo: chat prompt → workflow canvas wiring up → mini-app UI you can run"
            assetPath="/media/workflow-demo.mp4"
            videoSrc={DEMO_VIDEO_SRC}
            imageAlt="Building a workflow and wrapping it as a mini-app in Stuard"
          />
        </SectionReveal>
      </div>
    </section>
  );
};

export default BeyondTheChatSection;
