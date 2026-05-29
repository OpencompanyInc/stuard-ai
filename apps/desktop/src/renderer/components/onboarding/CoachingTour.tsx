import React, { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { AudioLines, Plus, ArrowRight, X } from 'lucide-react';

// Post-welcome coaching: the real compact pill performs each core gesture
// (summon · move · context · expand · dismiss) on a transparent backdrop, so it
// looks exactly like the real app on the user's desktop. A single coach card —
// always anchored below the pill so it never covers the input — carries the
// copy and the Back / Next controls. No atmospheric glow: this is the normal UI.

type PillMode = 'compact' | 'sidebar' | 'window';
type Target = 'pill' | 'attach' | 'corner';

interface Step {
  id: 'summon' | 'move' | 'context' | 'expand' | 'dismiss';
  eyebrow: string;
  title: string;
  body: string;
  keys: string[];
  target: Target;
}

const STEPS: Step[] = [
  {
    id: 'summon', eyebrow: 'Meet Stuard', title: 'This is me.',
    body: 'I sit on top of everything, one shortcut away. Call me up from anywhere — tap the hotkey, or just say “Hey Stuard.”',
    keys: ['Ctrl', 'Shift', 'Space'], target: 'pill',
  },
  {
    id: 'move', eyebrow: 'Move me', title: 'Put me anywhere.',
    body: 'Hold Ctrl and the arrow keys to glide me around — so I never sit on top of what you’re working on.',
    keys: ['Ctrl', '↑', '↓', '←', '→'], target: 'pill',
  },
  {
    id: 'context', eyebrow: 'Give me context', title: 'Hand me anything.',
    body: 'Type @ to pull in files, folders, or what’s on your screen — or hit + to attach directly.',
    keys: ['@', '+'], target: 'attach',
  },
  {
    id: 'expand', eyebrow: 'Resize me', title: 'As big as you need.',
    body: 'Grab the red corner and drag — I stretch from a compact pill out to a full window, any time.',
    keys: ['drag'], target: 'corner',
  },
  {
    id: 'dismiss', eyebrow: 'Dismiss me', title: 'Tuck me away.',
    body: 'Done for now? Press Esc, or tap your hotkey again — I’m gone, and always one shortcut from coming back.',
    keys: ['Esc'], target: 'pill',
  },
];

const PLACEHOLDER = 'Ask Stuard…';
const HOME = { left: '50%', top: '30%' };

export function CoachingTour({ onComplete, onSkip }: { onComplete: () => void; onSkip?: () => void }) {
  const [idx, setIdx] = useState(0);
  const step = STEPS[idx];

  const [pos, setPos] = useState(HOME);
  const [mode, setMode] = useState<PillMode>('compact');
  const [gone, setGone] = useState(false);
  const [typed, setTyped] = useState('');
  const [chip, setChip] = useState(false);
  const [keyhint, setKeyhint] = useState(false);
  const [cornerActive, setCornerActive] = useState(false);

  const pillRef = useRef<HTMLDivElement>(null);
  const attachRef = useRef<HTMLButtonElement>(null);
  const cornerRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const keyhintRef = useRef<HTMLDivElement>(null);

  // ── per-step performance loop ──
  useEffect(() => {
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const after = (fn: () => void, ms: number) => { const t = setTimeout(() => { if (!cancelled) fn(); }, ms); timers.push(t); return t; };

    setPos(HOME); setMode('compact'); setGone(false); setTyped(''); setChip(false); setKeyhint(false); setCornerActive(false);

    if (step.id === 'summon') {
      setGone(true);
      after(() => setGone(false), 220);
    } else if (step.id === 'move') {
      setKeyhint(true);
      const spots = [
        { left: '50%', top: '30%' }, { left: '57%', top: '30%' }, { left: '57%', top: '37%' },
        { left: '43%', top: '37%' }, { left: '43%', top: '30%' }, { left: '50%', top: '30%' },
      ];
      let i = 0;
      const hop = () => { if (cancelled) return; setPos(spots[i % spots.length]); i++; after(hop, 950); };
      after(hop, 250);
    } else if (step.id === 'context') {
      const full = '@Documents/report.pdf';
      const type = (n: number) => {
        if (cancelled) return;
        setTyped(full.slice(0, n));
        if (n < full.length) after(() => type(n + 1), 55);
        else {
          after(() => setChip(true), 150);
          after(() => { setChip(false); setTyped(''); after(() => type(1), 650); }, 2400);
        }
      };
      after(() => type(1), 500);
    } else if (step.id === 'expand') {
      // demonstrate the drag-to-expand corner: grip pops, pill stretches, releases
      const cycle = () => {
        if (cancelled) return;
        setMode('compact'); setCornerActive(false);
        after(() => { setCornerActive(true); setMode('sidebar'); }, 600);
        after(() => setMode('window'), 1700);
        after(() => { setCornerActive(false); setMode('compact'); }, 2900);
        after(cycle, 3700);
      };
      cycle();
    } else if (step.id === 'dismiss') {
      const cycle = () => { if (cancelled) return; setGone(false); after(() => setGone(true), 1100); after(cycle, 2700); };
      after(cycle, 400);
    }

    return () => { cancelled = true; timers.forEach(clearTimeout); };
  }, [idx, step.id]);

  // ── glue ring (to the step target) + card (always below the pill) ──
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const pill = pillRef.current, ring = ringRef.current, card = cardRef.current;
      if (pill && ring) {
        const targetEl =
          step.target === 'attach' ? attachRef.current ?? pill :
          step.target === 'corner' ? cornerRef.current ?? pill : pill;
        const r = targetEl.getBoundingClientRect();
        const pad = step.target === 'pill' ? 6 : 4;
        ring.style.left = `${r.left - pad}px`;
        ring.style.top = `${r.top - pad}px`;
        ring.style.width = `${r.width + pad * 2}px`;
        ring.style.height = `${r.height + pad * 2}px`;
        ring.style.borderRadius = `${step.target === 'pill' ? 26 : step.target === 'corner' ? 26 : 12}px`;

        // card always hangs below the pill, centered — never over the input
        if (card) {
          const pr = pill.getBoundingClientRect();
          const cw = card.offsetWidth, gap = 26;
          let left = pr.left + pr.width / 2 - cw / 2;
          let top = pr.bottom + gap;
          left = Math.max(16, Math.min(left, window.innerWidth - cw - 16));
          top = Math.max(16, Math.min(top, window.innerHeight - card.offsetHeight - 16));
          card.style.left = `${left}px`;
          card.style.top = `${top}px`;
        }
        const kh = keyhintRef.current;
        if (kh) { kh.style.left = `${r.left + r.width / 2 - 80}px`; kh.style.top = `${r.top - 46}px`; }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [step.target]);

  const next = () => { if (idx < STEPS.length - 1) setIdx(i => i + 1); else onComplete(); };
  const back = () => { if (idx > 0) setIdx(i => i - 1); };

  const isCompact = mode === 'compact';

  return (
    <div data-theme="dark" className="fixed inset-0 z-[9998] pointer-events-none font-stuard">
      <style>{`
        @keyframes coach-float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
        @keyframes coach-blink { 0%,49%{opacity:1} 50%,100%{opacity:0} }
        @keyframes coach-shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        @keyframes coach-bob { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-4px)} }
        .coach-float { animation: coach-float 5s ease-in-out infinite; }
        .coach-bob { animation: coach-bob 1.1s ease-in-out infinite; }
        .coach-skel-bar { background: linear-gradient(90deg, rgb(var(--compact-pill-fg) / 0.14), rgb(var(--compact-pill-fg) / 0.05));
          background-size: 200% 100%; animation: coach-shimmer 2.2s linear infinite; border-radius: 6px; height: 10px; }
      `}</style>

      {/* highlight ring */}
      <div
        ref={ringRef}
        className="absolute pointer-events-none transition-all duration-500 ease-out"
        style={{ border: '1.5px solid rgba(255,140,115,0.6)', boxShadow: '0 0 0 4px rgba(255,130,110,0.08), 0 0 30px rgba(255,100,90,0.30)', borderRadius: 26 }}
      />

      {/* the real compact pill, performing */}
      <div
        className="absolute -translate-x-1/2 -translate-y-1/2 transition-[left,top] duration-700"
        style={{ left: pos.left, top: pos.top, transitionTimingFunction: 'cubic-bezier(.3,.8,.2,1)' }}
      >
        <div className="coach-float">
          <div
            ref={pillRef}
            className={clsx('relative flex flex-col justify-center transition-all duration-500')}
            style={{
              width: isCompact ? 380 : mode === 'sidebar' ? 320 : 540,
              height: isCompact ? 56 : mode === 'sidebar' ? 360 : 320,
              borderRadius: 26,
              padding: 10,
              background: 'rgb(var(--compact-pill-bg))',
              boxShadow: 'var(--compact-pill-shadow)',
              color: 'rgb(var(--compact-pill-fg))',
              opacity: gone ? 0 : 1,
              transform: gone ? 'scale(0.6)' : 'scale(1)',
              transitionTimingFunction: 'cubic-bezier(.2,.7,.2,1)',
              overflow: 'visible',
            }}
          >
            {/* expanded conversation skeleton */}
            {!isCompact && (
              <div className="flex flex-1 flex-col gap-3 px-1.5 pt-1 pb-3 overflow-hidden" style={{ opacity: 0.9 }}>
                <div className="coach-skel-bar self-end" style={{ width: '42%' }} />
                <div className="coach-skel-bar" style={{ width: '72%' }} />
                <div className="coach-skel-bar" style={{ width: '58%' }} />
                <div className="coach-skel-bar self-end" style={{ width: '30%' }} />
                <div className="coach-skel-bar" style={{ width: mode === 'window' ? '80%' : '64%' }} />
              </div>
            )}

            {/* the input row — always present, like the real compact pill */}
            <div className="flex items-center w-full" style={{ gap: 8, height: 36 }}>
              <button
                ref={attachRef}
                type="button"
                tabIndex={-1}
                className="w-6 h-6 flex items-center justify-center flex-shrink-0"
                style={{ color: 'rgb(var(--compact-pill-fg) / 0.9)' }}
                title="Attach"
              >
                <Plus className="w-6 h-6" strokeWidth={1.5} />
              </button>

              <div className="flex-1 relative flex items-center justify-center min-h-[36px]" style={{ padding: 6 }}>
                <span
                  className="text-[12px] leading-4 font-normal whitespace-nowrap"
                  style={{ color: `rgb(var(--compact-pill-fg) / ${typed ? 0.92 : 0.45})` }}
                >
                  {typed || PLACEHOLDER}
                  {typed && step.id === 'context' && (
                    <span className="inline-block align-[-2px] ml-px" style={{ width: 1.5, height: '1em', background: 'rgb(var(--compact-pill-fg) / 0.7)', animation: 'coach-blink 1s infinite' }} />
                  )}
                </span>
              </div>

              <button type="button" tabIndex={-1} className="compact-voice-btn relative z-10 w-9 h-9 rounded-[14px] flex items-center justify-center flex-shrink-0" title="Voice">
                <AudioLines className="w-[18px] h-[18px] relative z-[1]" strokeWidth={2.25} />
              </button>
            </div>

            {/* red drag-to-expand corner grip — the real CompactDragCorner arc */}
            <div
              ref={cornerRef}
              aria-hidden
              className="absolute pointer-events-none"
              style={{
                right: -8, bottom: -8, width: 52, height: 52, zIndex: 6,
                transform: cornerActive ? 'scale(1.14)' : 'scale(1)', transformOrigin: 'bottom right',
                transition: 'transform 160ms ease-out, filter 160ms ease-out',
                filter: cornerActive ? 'brightness(1.18)' : 'none',
              }}
            >
              <svg width={52} height={52} viewBox="0 0 52 52" style={{ display: 'block', overflow: 'visible' }}>
                <path d="M 47 26 A 21 21 0 0 1 26 47" stroke="#FF383C" strokeWidth="3" strokeLinecap="butt" fill="none" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* context-step file chip (above the pill) */}
      <div
        className="absolute z-[1] inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] pointer-events-none transition-all duration-300"
        style={{
          left: pos.left, top: `calc(${pos.top} - 70px)`,
          transform: `translateX(-50%) ${chip ? 'translateY(0) scale(1)' : 'translateY(6px) scale(0.96)'}`,
          opacity: chip ? 1 : 0,
          background: 'rgba(28,20,21,0.95)', borderColor: 'rgba(255,200,195,0.25)', color: 'rgba(255,235,232,0.92)',
          boxShadow: '0 8px 26px rgba(0,0,0,0.5)',
        }}
      >
        report.pdf
      </div>

      {/* Ctrl+arrows hint (move step) */}
      <div ref={keyhintRef} className="absolute z-[1] flex gap-1.5 transition-opacity duration-300" style={{ opacity: keyhint ? 1 : 0 }}>
        {['Ctrl', '↑', '↓', '←', '→'].map((k, i) => (
          <kbd key={i} className="coach-bob inline-flex items-center justify-center min-w-[20px] px-1.5 py-0.5 text-[11px] font-medium rounded-[5px]"
            style={{ background: 'rgba(40,28,29,0.92)', border: '1px solid rgba(255,200,195,0.22)', color: 'rgba(255,235,232,0.92)', animationDelay: `${i * 80}ms` }}>
            {k}
          </kbd>
        ))}
      </div>

      {/* skip */}
      <button
        onClick={() => (onSkip ? onSkip() : onComplete())}
        className="pointer-events-auto absolute top-7 right-8 inline-flex items-center gap-1.5 rounded-md border border-white/[0.10] bg-stone-950/55 px-3 py-1.5 text-[11px] tracking-[0.08em] uppercase font-medium text-white/55 backdrop-blur-md transition-colors hover:bg-stone-900/65 hover:border-white/[0.20] hover:text-white/80"
      >
        <X size={11} strokeWidth={2} />
        Skip
      </button>

      {/* coach card — below the pill, carries copy AND navigation */}
      <div
        ref={cardRef}
        className="absolute z-[5] w-[330px] rounded-2xl border border-rose-200/20 bg-stone-950/90 backdrop-blur-md px-5 pt-4 pb-4 shadow-[0_16px_55px_rgba(20,8,12,0.7)] pointer-events-auto"
      >
        {/* upward pointer toward the pill */}
        <span className="absolute left-1/2 -top-[7px] -translate-x-1/2 w-3 h-3 rotate-45 bg-stone-950/90 border-l border-t border-rose-200/20" aria-hidden />

        <p className="text-[10px] tracking-[0.12em] uppercase font-semibold text-rose-200/70 mb-1.5">
          {step.eyebrow} · {idx + 1}/{STEPS.length}
        </p>
        <h3 className="text-[16px] font-medium text-white mb-1.5 tracking-[-0.01em]">{step.title}</h3>
        <p className="text-[13px] leading-relaxed font-light text-white/80">{step.body}</p>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {step.keys.map((k, i) => (
            <kbd key={i} className="inline-flex items-center justify-center min-w-[22px] px-1.5 py-[3px] text-[11.5px] font-medium rounded-md bg-stone-900/80 border border-rose-200/20 text-rose-50/90 shadow-[0_1px_3px_rgba(0,0,0,0.4)]">
              {k}
            </kbd>
          ))}
        </div>

        {/* divider + navigation */}
        <div className="mt-4 pt-3 border-t border-white/[0.07] flex items-center justify-between">
          <button
            onClick={back}
            className="rounded-lg px-2.5 py-1.5 text-[12.5px] text-white/45 transition-colors hover:text-white/80"
            style={{ visibility: idx === 0 ? 'hidden' : 'visible' }}
          >
            Back
          </button>
          <div className="flex gap-1.5">
            {STEPS.map((_, i) => (
              <span key={i} className="rounded-full transition-all duration-300"
                style={{ width: i === idx ? 16 : 6, height: 6, borderRadius: i === idx ? 4 : 999, background: i === idx ? 'rgba(255,130,110,0.95)' : 'rgba(255,255,255,0.20)' }} />
            ))}
          </div>
          <button
            onClick={next}
            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200/40 bg-rose-700/60 px-4 py-1.5 text-[12.5px] font-medium text-white shadow-[0_2px_16px_rgba(60,15,25,0.4)] transition-all hover:bg-rose-600/65 hover:border-rose-200/55 active:scale-95"
          >
            {idx === STEPS.length - 1 ? 'Open Stuard' : 'Next'}
            <ArrowRight size={13} className="text-rose-100/85" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default CoachingTour;
