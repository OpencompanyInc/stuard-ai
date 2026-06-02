"use client";

import { useEffect, useRef, useState } from 'react';

type LazyVideoProps = {
  src: string;
  className?: string;
  poster?: string;
  ariaLabel?: string;
  loop?: boolean;
  muted?: boolean;
  autoPlay?: boolean;
  /** Show native controls (use when the clip has narration / sound). */
  controls?: boolean;
};

/**
 * Remote demo video that doesn't tax initial page load — or Vercel bandwidth.
 *
 *  - `preload="none"` and no `src` is attached until the frame scrolls near the
 *    viewport, so visitors who never reach the demo never fetch the bytes.
 *  - When in view, the source attaches and (for autoplay loops) playback starts
 *    muted + inline; scrolling away pauses it so we stop pulling data.
 *
 * The `src` is expected to be an external URL (e.g. Cloudflare R2, which has
 * free egress), so none of this traffic counts against Vercel's quota.
 */
export default function LazyVideo({
  src,
  className,
  poster,
  ariaLabel,
  loop = true,
  muted = true,
  autoPlay = true,
  controls = false,
}: LazyVideoProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActive(true);
            if (autoPlay) {
              // Autoplay can be rejected by the browser; ignore the rejection.
              void el.play().catch(() => {});
            }
          } else if (autoPlay) {
            el.pause();
          }
        }
      },
      // Start fetching a touch before it's on screen for a seamless first frame.
      { rootMargin: '200px 0px', threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [autoPlay]);

  return (
    <video
      ref={videoRef}
      className={className}
      // Only attach the source once in view so nothing downloads up front.
      src={active ? src : undefined}
      poster={poster}
      preload="none"
      autoPlay={autoPlay}
      muted={muted}
      loop={loop}
      controls={controls}
      playsInline
      aria-label={ariaLabel}
    />
  );
}
