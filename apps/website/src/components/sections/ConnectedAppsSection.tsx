import Image from 'next/image';
import Link from 'next/link';
import SectionReveal from '@/components/layout/SectionReveal';

const PRIMARY_CAPABILITIES = [
  'Browser automation',
  'Files & folders',
  'Gmail, Drive, GitHub, Slack',
  'Screen & windows',
  'ffmpeg',
] as const;

const TRAILING_CAPABILITIES = [
  'Brightness',
  'Wallpaper',
  'Bluetooth',
  'Camera & mic',
  'Notifications',
  'MediaPipe',
  'Any installed app',
] as const;

const ConnectedAppsSection = () => {
  return (
    <section
      id="toolbelt"
      className="relative w-full bg-[#0A0A0B] py-16 text-white sm:py-20 lg:py-24"
    >
      <div className="mx-auto grid w-full max-w-[1200px] grid-cols-1 items-center gap-10 px-4 sm:px-8 lg:grid-cols-2 lg:gap-16">
        {/* Left — copy + capabilities */}
        <SectionReveal className="flex flex-col items-start gap-5 sm:gap-6">
          <p className="text-[12px] sm:text-[13px] lg:text-[14px] font-semibold leading-tight text-[#FF383C] tracking-wider">
            THE TOOLBELT
          </p>
          <h2 className="text-[26px] leading-[1.15] sm:text-[34px] sm:leading-[1.15] lg:text-[42px] lg:leading-[1.1] font-normal text-white">
            Your computer&apos;s a toolbox. Stuard knows where everything is.
          </h2>
          <p className="max-w-[520px] text-[15px] leading-[24px] sm:text-[17px] sm:leading-[26px] text-[#D4D4D4]">
            If your computer exposes it, Stuard can call it.
          </p>

          <div className="flex flex-col gap-2 pt-1">
            <p className="text-[13px] leading-relaxed text-[#A3A3A3]">
              {PRIMARY_CAPABILITIES.join(' · ')}
            </p>
            <p className="text-[13px] leading-relaxed text-[#737373]">
              <span className="text-[#A3A3A3]">…and the little stuff too:</span>{' '}
              {TRAILING_CAPABILITIES.join(' · ')}
            </p>
          </div>

          <Link href="/features" className="pt-2">
            <button
              type="button"
              className="inline-flex h-[48px] items-center justify-center gap-2 rounded-full border border-white/10 px-6 text-[14px] text-white transition-colors hover:bg-white/5"
            >
              Browse all capabilities
              <span aria-hidden="true">→</span>
            </button>
          </Link>
        </SectionReveal>

        {/* Right — connected-apps constellation (the Stuard mark surrounded by the cloud apps it reaches) */}
        <SectionReveal delay={0.1} className="w-full">
          <div className="relative mx-auto flex w-full max-w-[560px] items-center justify-center">
            {/* soft brand glow behind the red Stuard mark at the centre */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-0"
              style={{
                background:
                  'radial-gradient(closest-side, rgba(255,56,60,0.16), rgba(255,56,60,0.04) 55%, transparent 72%)',
              }}
            />
            <Image
              src="/connectedapps.png"
              alt="Cloud apps Stuard connects to — Gmail, Drive, Slack, GitHub, Notion, Discord and more, surrounding the Stuard mark"
              width={676}
              height={545}
              priority={false}
              className="relative z-[1] h-auto w-full"
              sizes="(max-width: 1024px) 100vw, 560px"
              style={{
                // fade the icons that bleed off the top/bottom edges instead of hard-cropping
                maskImage:
                  'linear-gradient(to bottom, transparent 0%, #000 14%, #000 86%, transparent 100%)',
                WebkitMaskImage:
                  'linear-gradient(to bottom, transparent 0%, #000 14%, #000 86%, transparent 100%)',
              }}
            />
          </div>
        </SectionReveal>
      </div>
    </section>
  );
};

export default ConnectedAppsSection;
