import type { ReactNode } from 'react';
import Link from 'next/link';
import SectionReveal from '@/components/layout/SectionReveal';
import CompactDemo from '@/components/sections/CompactDemo';

/**
 * ProductShowcase — two full-viewport "frames" the visitor scrolls through:
 *   1. "The AI that lives on your PC. Not in a tab." — live CompactDemo overlay + hotkey
 *   2. Big "Your PC is more powerful… / give it an assistant that knows that." scroll-reveal payoff
 *
 * Each frame reveals on scroll-in via SectionReveal. Kept as a server component;
 * the only interactive/client piece is the imported CompactDemo.
 */

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-[12px] sm:text-[13px] font-semibold uppercase tracking-[0.18em] text-[#FF6B6E]">
      {children}
    </p>
  );
}

function Keycap({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-[26px] min-w-[26px] items-center justify-center rounded-md border border-white/15 bg-white/[0.06] px-2 text-[12px] font-medium text-white shadow-[inset_0_-2px_0_rgba(0,0,0,0.45)]">
      {children}
    </kbd>
  );
}

const FRAME = 'mx-auto flex min-h-[100svh] w-full max-w-[1200px] items-center px-4 py-20 sm:px-8';
const GRID = 'grid w-full grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-16';
const HEADING = 'text-[28px] sm:text-[36px] lg:text-[46px] font-medium leading-[1.1] tracking-tight text-white';
const BODY = 'max-w-[460px] text-[15px] sm:text-[16px] leading-[26px] text-[#A8A8AE]';

export default function ProductShowcase() {
  return (
    <section id="showcase" className="relative bg-[#0A0A0B] text-white">
      {/* Frame 1 — the overlay + hotkey */}
      <div className={FRAME}>
        <div className={GRID}>
          <SectionReveal direction="up" className="flex flex-col gap-5">
            <Eyebrow>The overlay</Eyebrow>
            <h2 className={HEADING}>
              The AI that lives on your PC.
              <br />
              <span className="text-[#FF6B6E]">Not in a tab.</span>
            </h2>
            <p className={BODY}>
              Tap{' '}
              <span className="inline-flex items-center gap-1 whitespace-nowrap align-middle">
                <Keycap>Ctrl</Keycap>
                <span className="text-[#6f6f76]">+</span>
                <Keycap>Space</Keycap>
              </span>{' '}
              and Stuard drops in over whatever you&apos;re doing. It reads what&apos;s on screen and
              acts on it — no window-switching, no copy-paste, no leaving your flow.
            </p>
          </SectionReveal>
          <SectionReveal direction="up" delay={0.1}>
            <div
              className="relative w-full overflow-hidden rounded-2xl border border-white/10 bg-[#0d0d0f] shadow-2xl"
              style={{ aspectRatio: '16 / 10' }}
            >
              <CompactDemo />
            </div>
          </SectionReveal>
        </div>
      </div>

      {/* Frame 2 — big scroll-reveal payoff */}
      <div className="mx-auto flex min-h-[100svh] w-full max-w-[1100px] flex-col items-center justify-center gap-10 px-4 py-20 text-center">
        <SectionReveal once={false} amount={0.55} duration={0.85} distance={28}>
          <h2 className="tracking-tight">
            <span className="block text-[28px] leading-[1.08] sm:text-[44px] lg:text-[58px] font-medium text-white">
              Your PC is more powerful than your chatbot thinks.
            </span>
            <span className="mt-2 block text-[28px] leading-[1.08] sm:text-[44px] lg:text-[58px] font-bold text-[#FF6B6E]">
              Give it an assistant that knows that.
            </span>
          </h2>
        </SectionReveal>
        <SectionReveal once={false} amount={0.55} delay={0.15}>
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:gap-4">
            <Link href="/download">
              <button
                type="button"
                className="inline-flex h-[46px] items-center justify-center rounded-full bg-[#F5F5F5] px-6 text-[14px] font-medium text-black transition-colors hover:bg-white"
              >
                Download for Windows
              </button>
            </Link>
            <Link href="#how-it-works">
              <button
                type="button"
                className="inline-flex h-[46px] items-center justify-center rounded-full border border-white/20 px-6 text-[14px] text-white transition-colors hover:bg-white/5"
              >
                See how it works
              </button>
            </Link>
          </div>
        </SectionReveal>
      </div>
    </section>
  );
}
