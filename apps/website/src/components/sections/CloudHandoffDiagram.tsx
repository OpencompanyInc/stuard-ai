import { Check, Cloud, Moon, Globe, Send, type LucideIcon } from 'lucide-react';
import type { ComponentType } from 'react';

/**
 * Cloud-agent illustration — a friendly "while you're away" card.
 * Plain-language tasks the agent finished overnight, a live row, and a clear
 * "laptop closed" cue. Deliberately non-technical (no CPU/RAM/zone). Pure CSS.
 */

/** Official X (Twitter) glyph — a cloud run posts via the browser, no API needed. */
function XLogo({ className }: { className?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
    </svg>
  );
}

type Task = {
  icon: LucideIcon | ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  detail: string;
  time: string;
};

const TASKS: Task[] = [
  { icon: Globe, label: 'Pulled your morning brief', detail: 'Top news & weather, summarized', time: '6:00 AM' },
  { icon: XLogo, label: 'Posted your launch thread to X', detail: 'Drafted from your notes, then published', time: '9:30 AM' },
  { icon: Send, label: 'Emailed the daily report', detail: 'Sent to you and the team', time: '12:00 PM' },
];

const CloudHandoffDiagram = () => {
  return (
    <figure
      className="mx-auto w-full max-w-[720px]"
      aria-label="While your laptop is closed, your Stuard agent keeps working in the cloud — gathering your morning brief, posting a thread to X, and emailing reports."
    >
      <div className="relative overflow-hidden rounded-3xl border border-[#262626] bg-gradient-to-b from-[#151517] to-[#0d0d0f] p-6 shadow-[0_40px_100px_-30px_rgba(0,0,0,0.85)] sm:p-8">
        {/* soft brand glow */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 left-1/2 h-64 w-[120%] -translate-x-1/2"
          style={{
            background: 'radial-gradient(closest-side, rgba(255,56,60,0.18), transparent 70%)',
          }}
        />

        {/* Header */}
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[#FF383C]/25 bg-[#FF383C]/10">
              <Cloud className="h-6 w-6 text-[#FF6B6E]" strokeWidth={1.75} />
            </div>
            <div className="flex flex-col">
              <span className="text-[18px] font-medium leading-tight text-white sm:text-[20px]">
                Working while your laptop&apos;s closed
              </span>
              <span className="text-[13px] text-[#A3A3A3] sm:text-[14px]">
                You&apos;re offline. Stuard isn&apos;t.
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[12px] text-[#8b8b93]">
              <Moon className="h-3.5 w-3.5" strokeWidth={1.75} />
              Laptop closed
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-[#22c55e]/30 bg-[#22c55e]/10 px-3 py-1.5 text-[12px] font-medium text-[#4ade80]">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#22c55e] opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[#22c55e]" />
              </span>
              Live
            </span>
          </div>
        </div>

        {/* Task list */}
        <div className="relative mt-6 flex flex-col gap-3">
          {TASKS.map((task) => (
            <div
              key={task.label}
              className="flex items-center gap-4 rounded-2xl border border-[#1f1f1f] bg-[#0d0d0f] px-4 py-3.5 sm:px-5"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#22c55e]/30 bg-[#22c55e]/12">
                <Check className="h-5 w-5 text-[#4ade80]" strokeWidth={2.5} />
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-2 text-[15px] font-medium text-white sm:text-[16px]">
                  <task.icon className="h-4 w-4 shrink-0 text-[#737373]" strokeWidth={2} />
                  <span className="truncate">{task.label}</span>
                </span>
                <span className="truncate text-[13px] text-[#8b8b93]">{task.detail}</span>
              </div>
              <span className="shrink-0 text-[13px] tabular-nums text-[#737373]">{task.time}</span>
            </div>
          ))}

          {/* Live row */}
          <div className="flex items-center gap-4 rounded-2xl border border-[#FF383C]/25 bg-[#FF383C]/[0.07] px-4 py-3.5 sm:px-5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#FF383C]/35 bg-[#FF383C]/12">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#FF383C] opacity-70" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#FF383C]" />
              </span>
            </div>
            <span className="min-w-0 flex-1 text-[15px] font-medium text-white sm:text-[16px]">
              Watching for new orders…
            </span>
            <span className="shrink-0 text-[13px] font-medium text-[#FF6B6E]">now</span>
          </div>
        </div>
      </div>

      <figcaption className="mt-5 text-center text-[15px] font-medium text-[#D4D4D4]">
        All of this happened while you were away.
      </figcaption>
    </figure>
  );
};

export default CloudHandoffDiagram;
