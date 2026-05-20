import Link from 'next/link';
import SectionReveal from '@/components/layout/SectionReveal';

const BeyondTheChatSection = () => {
  return (
    <section
      id="demo"
      className="relative flex min-h-screen flex-col items-center justify-center bg-[#0A0A0B] text-white px-4 py-16 sm:py-20 lg:py-24"
    >
      <div className="mx-auto flex w-full max-w-[1100px] flex-col items-center gap-8 sm:gap-10 lg:gap-12">
        <SectionReveal className="flex w-full max-w-[780px] flex-col items-center gap-4 sm:gap-5 lg:gap-7 text-center">
          <p className="text-[12px] sm:text-[13px] lg:text-[14px] font-semibold leading-tight text-[#FF383C] tracking-wider">
            BEYOND THE CHAT
          </p>

          <h2 className="text-[22px] leading-[1.2] sm:text-[28px] sm:leading-[1.2] lg:text-[36px] lg:leading-[1.2] font-normal text-white">
            Chat assistants are stuck in a tab.
            <br />
            Stuard lives on your machine.
          </h2>

          <p className="max-w-[720px] text-[14px] leading-[22px] sm:text-[15px] sm:leading-[24px] lg:text-[16px] lg:leading-[26px] font-normal text-[#E5E5E5]">
            ChatGPT can write a script that calls ffmpeg. Stuard can run it. It reads the file you just
            downloaded, sees what&apos;s on your screen, changes your wallpaper, dims your brightness,
            opens your camera — whatever the job needs.
          </p>

          <Link
            href="/features"
            className="mt-2 text-[14px] sm:text-[15px] text-white/80 underline-offset-4 hover:text-white hover:underline transition-colors"
          >
            See what Stuard can touch →
          </Link>
        </SectionReveal>

        <SectionReveal
          delay={0.15}
          distance={60}
          className="relative aspect-video w-full overflow-hidden rounded-xl sm:rounded-2xl border border-white/10 bg-[#171717] shadow-[0_30px_80px_-30px_rgba(0,0,0,0.8)]"
        >
          <div className="absolute inset-0 flex items-center justify-center text-white/30 text-xs sm:text-sm">
            90-second demo
          </div>
        </SectionReveal>
      </div>
    </section>
  );
};

export default BeyondTheChatSection;
