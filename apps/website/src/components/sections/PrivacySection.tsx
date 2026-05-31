import SectionReveal from '@/components/layout/SectionReveal';

const PrivacySection = () => {
  return (
    <section
      id="privacy"
      className="relative bg-[#0A0A0B] px-4 py-16 text-white sm:py-20 lg:py-24"
    >
      <div className="mx-auto flex w-full max-w-[900px] flex-col items-center gap-8 sm:gap-10">
        <SectionReveal className="flex flex-col items-center gap-5 sm:gap-7 text-center">
          <p className="text-[12px] sm:text-[13px] font-semibold tracking-wider text-[#FF383C]">
            PRIVACY
          </p>
          <h2 className="text-[26px] leading-[1.2] sm:text-[36px] lg:text-[44px] font-normal text-white">
            Local by architecture. Cloud only when you ask.
          </h2>
          <p className="max-w-[720px] text-[15px] leading-[24px] sm:text-[17px] sm:leading-[28px] text-[#D4D4D4]">
            Your files, your camera, your screen — they never leave your machine. The only things
            that go to the cloud are the things that have to: your memories (so Stuard remembers
            you across devices) and your OAuth tokens (so it can talk to Gmail or Drive). Both are
            encrypted per-user with keys we can&apos;t read.
          </p>
        </SectionReveal>

        <SectionReveal delay={0.1}>
          <p className="text-center text-[15px] sm:text-[16px] font-medium text-white">
            Local where it matters. Cloud where it has to be. Encrypted either way.
          </p>
        </SectionReveal>
      </div>
    </section>
  );
};

export default PrivacySection;
