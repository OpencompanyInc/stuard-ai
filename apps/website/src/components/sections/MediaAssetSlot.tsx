import Image from 'next/image';
import type { ReactNode } from 'react';

type MediaAssetSlotProps = {
  /** Shown in the placeholder until a real asset is wired in */
  label: string;
  /** Expected path under /public — e.g. /media/hero-loop.mp4 */
  assetPath?: string;
  caption?: string;
  className?: string;
  aspectClassName?: string;
  /** When set, renders the real asset instead of the placeholder */
  videoSrc?: string;
  imageSrc?: string;
  imageAlt?: string;
  posterSrc?: string;
  loop?: boolean;
  muted?: boolean;
  autoPlay?: boolean;
  children?: ReactNode;
};

/**
 * Drop-in slot for screen captures and demo loops. Wire `videoSrc` / `imageSrc`
 * once files exist under public/ (see `assetPath` hint in the placeholder).
 */
export function MediaAssetSlot({
  label,
  assetPath,
  caption,
  className = '',
  aspectClassName = 'aspect-video',
  videoSrc,
  imageSrc,
  imageAlt,
  posterSrc,
  loop = true,
  muted = true,
  autoPlay = true,
  children,
}: MediaAssetSlotProps) {
  const frameClass = `
    relative w-full overflow-hidden rounded-xl sm:rounded-2xl
    border border-white/10 bg-[#111111]
    shadow-[0_30px_80px_-30px_rgba(0,0,0,0.8)]
    ${aspectClassName}
    ${className}
  `;

  if (videoSrc) {
    return (
      <div className={frameClass}>
        <video
          className="absolute inset-0 h-full w-full object-cover"
          src={videoSrc}
          poster={posterSrc}
          autoPlay={autoPlay}
          muted={muted}
          loop={loop}
          playsInline
          aria-label={imageAlt ?? label}
        />
        {caption ? (
          <p className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-4 py-3 text-[12px] sm:text-[13px] text-[#E5E5E5]">
            {caption}
          </p>
        ) : null}
      </div>
    );
  }

  if (imageSrc) {
    return (
      <div className={frameClass}>
        <Image
          src={imageSrc}
          alt={imageAlt ?? label}
          fill
          className="object-cover object-top"
          sizes="(max-width: 1200px) 100vw, 1100px"
        />
        {caption ? (
          <p className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-4 py-3 text-[12px] sm:text-[13px] text-[#E5E5E5]">
            {caption}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className={frameClass}>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 py-8 text-center">
        <span className="rounded-full border border-white/10 bg-[#171717] px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-[#737373]">
          Screen capture / demo
        </span>
        <p className="max-w-[420px] text-[14px] sm:text-[15px] font-medium leading-snug text-[#A3A3A3]">
          {label}
        </p>
        {assetPath ? (
          <p className="font-mono text-[11px] text-[#525252]">{assetPath}</p>
        ) : null}
        {children}
      </div>
      {caption ? (
        <p className="absolute bottom-0 left-0 right-0 border-t border-white/5 bg-[#0A0A0B]/90 px-4 py-2.5 text-left text-[12px] sm:text-[13px] font-medium text-[#D4D4D4]">
          {caption}
        </p>
      ) : null}
    </div>
  );
}

export default MediaAssetSlot;
