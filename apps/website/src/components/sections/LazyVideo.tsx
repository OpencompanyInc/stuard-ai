"use client";

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

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
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);

  // Reset load state when the source or activation changes. Done during render
  // (instead of an effect) so we avoid an extra commit + cascading re-render.
  const resetKey = `${src}|${active}`;
  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey);
    setReady(false);
    setError(false);
  }

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActive(true);
            if (autoPlay) {
              void el.play().catch(() => {});
            }
          } else if (autoPlay) {
            el.pause();
          }
        }
      },
      { rootMargin: '200px 0px', threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [autoPlay]);

  const showLoading = active && !ready && !error;

  return (
    <div className="absolute inset-0">
      {showLoading ? (
        <div
          className="absolute inset-0 z-[1] flex flex-col items-center justify-center gap-2 bg-[#0d0d0d]"
          role="status"
          aria-live="polite"
          aria-label="Loading video"
        >
          <Loader2 className="h-7 w-7 animate-spin text-[#FF383C]" aria-hidden />
          <span className="text-[11px] text-[#737373]">Loading video…</span>
        </div>
      ) : null}
      {error ? (
        <div className="absolute inset-0 z-[1] flex items-center justify-center bg-[#111111] px-4 text-center text-[12px] text-[#737373]">
          Video could not be loaded
        </div>
      ) : null}
      <video
        ref={videoRef}
        className={className}
        src={active ? src : undefined}
        poster={poster}
        preload={active ? 'auto' : 'none'}
        autoPlay={autoPlay}
        muted={muted}
        loop={loop}
        controls={controls}
        playsInline
        aria-label={ariaLabel}
        onLoadedData={() => setReady(true)}
        onCanPlay={() => setReady(true)}
        onError={() => {
          setError(true);
          setReady(false);
        }}
      />
    </div>
  );
}
