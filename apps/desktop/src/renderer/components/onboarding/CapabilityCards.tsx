import React from 'react';
import { motion } from 'framer-motion';
import { clsx } from 'clsx';
import {
  Workflow,
  Bell,
  Calendar,
  Plug,
  Brain,
  ArrowRight,
  type LucideIcon,
} from 'lucide-react';

export interface CapabilityItem {
  id: string;
  icon: LucideIcon;
  label: string;
  description: string;
  cta: string;
  color: string;
  featured?: boolean;
}

const CAPABILITIES: CapabilityItem[] = [
  {
    id: 'workflows',
    icon: Workflow,
    label: 'Workflows',
    description: "Stop paying for 5 different AI tools. Build exactly what you need — drag, drop, or just ask me.",
    cta: 'Try building one',
    color: 'purple',
    featured: true,
  },
  {
    id: 'proactive',
    icon: Bell,
    label: 'Scout, your proactive agent',
    description: "Never forget a deadline or miss a follow-up again. Scout watches your back, checks in on a schedule, and asks before anything destructive.",
    cta: 'Turn it on',
    color: 'amber',
    featured: true,
  },
  {
    id: 'planner',
    icon: Calendar,
    label: 'Planner',
    description: "Your day, tasks, and deadlines — all in one view.",
    cta: 'See your day',
    color: 'cyan',
  },
  {
    id: 'integrations',
    icon: Plug,
    label: 'Integrations',
    description: "Gmail, Calendar, GitHub — no more tab-switching.",
    cta: 'Connect your stuff',
    color: 'green',
  },
  {
    id: 'memories',
    icon: Brain,
    label: 'Memories',
    description: "I remember your context so you don't have to repeat yourself.",
    cta: 'See what I know',
    color: 'blue',
  },
];

const COLOR_MAP: Record<string, { bg: string; border: string; text: string; glow: string; ring: string }> = {
  purple: { bg: 'bg-purple-500/10', border: 'border-purple-400/15', text: 'text-purple-300', glow: 'rgba(168,85,247,0.12)', ring: 'ring-purple-400/20' },
  amber:  { bg: 'bg-amber-500/10', border: 'border-amber-400/15', text: 'text-amber-300', glow: 'rgba(245,158,11,0.12)', ring: 'ring-amber-400/20' },
  cyan:   { bg: 'bg-cyan-500/10', border: 'border-cyan-400/15', text: 'text-cyan-300', glow: 'rgba(6,182,212,0.10)', ring: 'ring-cyan-400/20' },
  green:  { bg: 'bg-green-500/10', border: 'border-green-400/15', text: 'text-green-300', glow: 'rgba(34,197,94,0.10)', ring: 'ring-green-400/20' },
  blue:   { bg: 'bg-blue-500/10', border: 'border-blue-400/15', text: 'text-blue-300', glow: 'rgba(56,168,255,0.10)', ring: 'ring-blue-400/20' },
};

interface CapabilityCardsProps {
  onSelect: (capabilityId: string) => void;
  experienced?: Record<string, boolean>;
}

export function CapabilityCards({ onSelect, experienced = {} }: CapabilityCardsProps) {
  return (
    <div className="flex flex-col gap-3 w-full max-w-lg">
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="text-xs font-bold uppercase tracking-widest text-white/25 mb-1"
      >
        Here's how I help
      </motion.p>

      {/* Featured capabilities — larger cards */}
      <div className="grid grid-cols-2 gap-3">
        {CAPABILITIES.filter(c => c.featured).map((cap, i) => {
          const colors = COLOR_MAP[cap.color] || COLOR_MAP.blue;
          const done = experienced[cap.id];
          return (
            <motion.button
              key={cap.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.08 }}
              onClick={() => onSelect(cap.id)}
              className={clsx(
                'group relative overflow-hidden rounded-2xl border text-left backdrop-blur-xl transition-all',
                'hover:ring-1 active:scale-[0.98]',
                colors.border, colors.ring, 'bg-white/[0.04]',
                done && 'opacity-60',
              )}
            >
              {/* Glow */}
              <div
                className="pointer-events-none absolute -top-10 left-1/2 h-20 w-32 -translate-x-1/2 rounded-full blur-3xl opacity-60 group-hover:opacity-100 transition-opacity"
                style={{ background: colors.glow }}
              />

              <div className="relative z-10 p-5">
                <div className={clsx('flex h-10 w-10 items-center justify-center rounded-xl', colors.bg)}>
                  <cap.icon className={clsx('w-5 h-5', colors.text)} />
                </div>
                <h4 className="mt-3.5 text-sm font-semibold text-white/85">{cap.label}</h4>
                <p className="mt-1.5 text-[11px] leading-relaxed text-white/40 line-clamp-2">{cap.description}</p>
                <div className={clsx('mt-3.5 flex items-center gap-1.5 text-[11px] font-medium', colors.text)}>
                  {done ? 'Explored' : cap.cta}
                  <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                </div>
              </div>
            </motion.button>
          );
        })}
      </div>

      {/* Regular capabilities — compact row */}
      <div className="flex gap-2">
        {CAPABILITIES.filter(c => !c.featured).map((cap, i) => {
          const colors = COLOR_MAP[cap.color] || COLOR_MAP.blue;
          const done = experienced[cap.id];
          return (
            <motion.button
              key={cap.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + i * 0.06 }}
              onClick={() => onSelect(cap.id)}
              className={clsx(
                'group flex-1 rounded-xl border px-3 py-3 text-left backdrop-blur-xl transition-all',
                'hover:ring-1 active:scale-[0.98]',
                colors.border, colors.ring, 'bg-white/[0.03]',
                done && 'opacity-50',
              )}
            >
              <div className={clsx('flex h-7 w-7 items-center justify-center rounded-lg', colors.bg)}>
                <cap.icon className={clsx('w-3.5 h-3.5', colors.text)} />
              </div>
              <p className="mt-2 text-[11px] font-medium text-white/70">{cap.label}</p>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

export { CAPABILITIES };
