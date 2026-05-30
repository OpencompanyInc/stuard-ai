import Link from 'next/link';
import SectionReveal from '@/components/layout/SectionReveal';
import MediaAssetSlot from '@/components/sections/MediaAssetSlot';

const MICRO_PROOFS = [
  {
    label: 'Browser auto-filling a form',
    assetPath: '/media/toolbelt/browser-form.mp4',
  },
  {
    label: 'ffmpeg trimming a clip — progress visible',
    assetPath: '/media/toolbelt/ffmpeg-trim.mp4',
  },
  {
    label: 'Semantic file search resolving a document',
    assetPath: '/media/toolbelt/file-search.mp4',
  },
  {
    label: 'Gmail draft writing itself with attachment',
    assetPath: '/media/toolbelt/gmail-draft.mp4',
  },
  {
    label: 'Screen & windows — app operated without switching',
    assetPath: '/media/toolbelt/window-control.mp4',
  },
] as const;

const PRIMARY_LABELS = [
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
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-12 px-4 sm:px-8 lg:gap-16">
        <SectionReveal className="flex w-full max-w-[900px] flex-col items-start gap-5 sm:gap-7">
          <p className="text-[12px] sm:text-[13px] lg:text-[14px] font-semibold leading-tight text-[#FF383C] tracking-wider">
            THE TOOLBELT
          </p>
          <h2 className="text-[28px] leading-[1.15] sm:text-[40px] sm:leading-[1.15] lg:text-[52px] lg:leading-[1.1] font-normal text-white">
            Your computer&apos;s a toolbox. Stuard knows where everything is.
          </h2>
          <p className="max-w-[640px] text-[15px] leading-[24px] sm:text-[17px] sm:leading-[26px] text-[#D4D4D4]">
            If your computer exposes it, Stuard can call it.
          </p>
        </SectionReveal>

        <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {MICRO_PROOFS.map((proof, index) => (
            <SectionReveal key={proof.assetPath} delay={0.06 * index} className="flex flex-col gap-2">
              <MediaAssetSlot
                label={proof.label}
                assetPath={proof.assetPath}
                aspectClassName="aspect-[4/3]"
              />
              <p className="text-center text-[12px] font-medium text-[#A3A3A3]">
                {PRIMARY_LABELS[index]}
              </p>
            </SectionReveal>
          ))}
        </div>

        <SectionReveal delay={0.1}>
          <p className="text-[13px] leading-relaxed text-[#737373]">
            <span className="text-[#A3A3A3]">…and the little stuff too:</span>{' '}
            {TRAILING_CAPABILITIES.join(' · ')}
          </p>
        </SectionReveal>

        <SectionReveal delay={0.15}>
          <Link href="/features">
            <button
              type="button"
              className="inline-flex h-[48px] items-center justify-center gap-2 rounded-full border border-white/10 px-6 text-[14px] text-white transition-colors hover:bg-white/5"
            >
              Browse all capabilities
              <span aria-hidden="true">→</span>
            </button>
          </Link>
        </SectionReveal>
      </div>
    </section>
  );
};

export default ConnectedAppsSection;
