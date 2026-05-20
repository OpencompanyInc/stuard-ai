import Image from 'next/image';
import Link from 'next/link';
import SectionReveal from '@/components/layout/SectionReveal';

const CAPABILITIES = [
  'Files & folders',
  'Screen & windows',
  'Camera & mic',
  'Bluetooth',
  'Brightness',
  'Wallpaper',
  'Notifications',
  'ffmpeg',
  'MediaPipe',
  'Browser automation',
  'Any installed app',
  'Gmail, Drive, GitHub, Slack & more',
] as const;

const ConnectedAppsSection = () => {
  return (
    <section
      id="toolbelt"
      className="relative w-full bg-[#0A0A0B] py-16 text-white sm:py-20 lg:py-24"
    >
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-12 px-4 sm:px-8 lg:gap-16">
        <SectionReveal className="flex w-full max-w-[900px] flex-col items-start gap-5 sm:gap-7">
          <p className="text-[12px] sm:text-[13px] lg:text-[14px] font-semibold leading-tight text-[#FF383C] tracking-wider">
            THE TOOLBELT
          </p>
          <h2 className="text-[28px] leading-[1.15] sm:text-[40px] sm:leading-[1.15] lg:text-[52px] lg:leading-[1.1] font-normal text-white">
            Your computer&apos;s a toolbox. Stuard knows where everything is.
          </h2>
        </SectionReveal>

        <div className="grid w-full grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <SectionReveal
            direction="right"
            distance={60}
            className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4"
          >
            {CAPABILITIES.map((label) => (
              <div
                key={label}
                className="flex min-h-[72px] items-center justify-center rounded-xl border border-[#262626] bg-[#111111] px-3 py-4 text-center text-[12px] leading-snug text-[#E5E5E5] sm:text-[13px]"
              >
                {label}
              </div>
            ))}
          </SectionReveal>

          <SectionReveal direction="left" distance={60} delay={0.1} className="flex flex-col items-start gap-8">
            <Image
              src="/connectedapps.png"
              alt="Apps and system capabilities Stuard can access"
              width={680}
              height={560}
              sizes="(max-width: 1024px) 90vw, 45vw"
              className="block h-auto w-full max-w-[560px] select-none object-contain"
            />
            <p className="max-w-[520px] text-[15px] leading-[24px] sm:text-[17px] sm:leading-[26px] text-[#D4D4D4]">
              If your computer exposes it, Stuard can call it.
            </p>
            <Link href="/features">
              <button
                type="button"
                className="inline-flex h-[52px] items-center justify-center gap-2 rounded-full border border-white/5 bg-[linear-gradient(90deg,rgba(0,0,0,0.8)_0%,rgba(26,26,26,0.8)_100%)] px-6 text-[15px] font-normal text-white transition-opacity hover:opacity-90"
              >
                Browse all capabilities
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </button>
            </Link>
          </SectionReveal>
        </div>
      </div>
    </section>
  );
};

export default ConnectedAppsSection;
