import React, { useMemo } from 'react';
import { motion, type Variants } from 'framer-motion';
import {
  ArrowRight,
  Bot,
  Layers,
  Plug,
  Search,
  Wand2,
  X,
  type LucideIcon,
} from 'lucide-react';

// Final onboarding beat — after the compact-pill coaching tour, point the user
// at Stuard Studio: where repeated work becomes reusable workflows, agents,
// skills and custom tools. We don't re-teach the workflow editor here (Studio
// ships its own guided walkthrough); this is the "here's what else you can
// build" hand-off before the app opens, with an optional jump straight in.

interface Tile {
  icon: LucideIcon;
  title: string;
  body: string;
}

const TILES: Tile[] = [
  {
    icon: Layers,
    title: 'Workflows',
    body: 'Chain steps across your apps into one automation you run on a trigger.',
  },
  {
    icon: Bot,
    title: 'Agents',
    body: 'Stand up bots that handle tasks on their own — on your PC or in the cloud.',
  },
  {
    icon: Wand2,
    title: 'Skills',
    body: 'Teach me how to handle a kind of request, once, and reuse it forever.',
  },
  {
    icon: Plug,
    title: 'Custom tools',
    body: 'Wire up any API and hand it to your chats, agents, and workflows.',
  },
];

export function StudioIntro({
  onComplete,
  onSkip,
}: {
  onComplete: () => void;
  onSkip?: () => void;
}) {
  const firstName = useMemo(() => {
    try {
      const raw = (localStorage.getItem('stuard_user_name') || '').trim();
      return raw ? raw.split(/\s+/)[0] : '';
    } catch {
      return '';
    }
  }, []);

  const openStudio = () => {
    try { (window as any).desktopAPI?.openWorkflows?.(); } catch {}
    onComplete();
  };

  const container: Variants = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.07, delayChildren: 0.15 } },
  };
  const item: Variants = {
    hidden: { opacity: 0, y: 12 },
    show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' } },
  };

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center px-6 font-stuard text-white">
      <div className="pointer-events-none absolute inset-0 bg-stone-950/70 backdrop-blur-md" aria-hidden />

      {/* skip */}
      {onSkip && (
        <button
          onClick={onSkip}
          className="pointer-events-auto absolute top-7 right-8 inline-flex items-center gap-1.5 rounded-md border border-white/[0.10] bg-stone-950/55 px-3 py-1.5 text-[11px] tracking-[0.08em] uppercase font-medium text-white/55 backdrop-blur-md transition-colors hover:bg-stone-900/65 hover:border-white/[0.20] hover:text-white/80"
        >
          <X size={11} strokeWidth={2} />
          Skip
        </button>
      )}

      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="relative w-full max-w-[600px] rounded-[28px] border border-rose-200/15 bg-stone-950/85 px-8 pt-8 pb-7 shadow-[0_24px_80px_rgba(20,8,12,0.7)] backdrop-blur-xl"
      >
        <motion.p variants={item} className="text-[10px] tracking-[0.18em] uppercase font-semibold text-rose-200/70">
          Stuard Studio
        </motion.p>
        <motion.h2 variants={item} className="mt-2 text-[26px] font-semibold leading-tight tracking-[-0.01em] text-white">
          {firstName ? `Build your own tools, ${firstName}.` : 'Build your own tools.'}
        </motion.h2>
        <motion.p variants={item} className="mt-2 max-w-[46ch] text-[14px] font-light leading-relaxed text-white/75">
          When you find yourself doing something more than once, turn it into something reusable.
          That all lives in Studio.
        </motion.p>

        <motion.div variants={item} className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {TILES.map((tile) => {
            const Icon = tile.icon;
            return (
              <div
                key={tile.title}
                className="group flex items-start gap-3.5 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 transition-colors hover:border-rose-200/25 hover:bg-rose-950/20"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] border border-rose-200/20 bg-rose-950/40 text-rose-100/90">
                  <Icon className="h-[19px] w-[19px]" strokeWidth={1.75} />
                </span>
                <div className="min-w-0">
                  <h3 className="text-[14px] font-semibold leading-none text-white">{tile.title}</h3>
                  <p className="mt-1.5 text-[12.5px] font-light leading-snug text-white/65">{tile.body}</p>
                </div>
              </div>
            );
          })}
        </motion.div>

        <motion.div
          variants={item}
          className="mt-5 flex items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3"
        >
          <Search className="h-4 w-4 shrink-0 text-rose-200/70" strokeWidth={1.75} />
          <p className="text-[12.5px] font-light leading-snug text-white/65">
            Need Studio, Settings, or anywhere else? Just start typing in Stuard&apos;s search bar — it
            takes you straight there.
          </p>
        </motion.div>

        <motion.div variants={item} className="mt-7 flex items-center justify-end gap-2.5">
          <button
            onClick={onComplete}
            className="pointer-events-auto rounded-lg px-4 py-2.5 text-[13px] font-medium text-white/55 transition-colors hover:text-white/85"
          >
            Dismiss
          </button>
          <button
            onClick={openStudio}
            className="pointer-events-auto inline-flex items-center gap-2 rounded-lg border border-rose-300/35 bg-rose-500/15 px-6 py-2.5 text-[13px] font-medium text-rose-50 transition-colors hover:border-rose-300/55 hover:bg-rose-500/25"
          >
            Check out Studio
            <ArrowRight size={14} className="text-rose-100/80" />
          </button>
        </motion.div>
      </motion.div>
    </div>
  );
}

export default StudioIntro;
