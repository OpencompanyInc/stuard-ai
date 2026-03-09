import React, { useEffect, useMemo, useState } from "react";
import { Compass, Lightbulb, Sparkles } from "lucide-react";
import { clsx } from "clsx";

export interface DiscoverTipItem {
  id: string;
  title: string;
  description: string;
}

interface DiscoverTipsProps {
  title?: string;
  tips?: DiscoverTipItem[];
  intervalMs?: number;
  className?: string;
  compact?: boolean;
}

const DEFAULT_TIPS: DiscoverTipItem[] = [
  {
    id: "workflow-ai",
    title: "Ask AI to build the first draft",
    description: "Describe the outcome you want, then refine the workflow visually instead of starting from scratch.",
  },
  {
    id: "workflow-mini-app",
    title: "Workflows can become mini apps",
    description: "Add custom UI so a workflow can collect input, show status, or feel like a tiny purpose-built tool.",
  },
  {
    id: "workflow-assistant",
    title: "Start simple, automate later",
    description: "If a task works well in chat first, it usually becomes a strong candidate for a workflow later.",
  },
  {
    id: "workflow-path",
    title: "Pick a starting path, not a permanent mode",
    description: "Assistant, automation, workspace, and operator flows all connect. Stuard grows with how you use it.",
  },
];

export function DiscoverTips({
  title = "Discover while you wait",
  tips = DEFAULT_TIPS,
  intervalMs = 4200,
  className,
  compact = false,
}: DiscoverTipsProps) {
  const safeTips = useMemo(() => (tips.length > 0 ? tips : DEFAULT_TIPS), [tips]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (safeTips.length <= 1) return;
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % safeTips.length);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs, safeTips]);

  const activeTip = safeTips[index] ?? safeTips[0];

  return (
    <div
      className={clsx(
        "rounded-2xl border backdrop-blur-xl",
        compact
          ? "border-white/10 bg-white/[0.04] px-4 py-3"
          : "border-white/10 bg-white/[0.05] px-5 py-4",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <div className={clsx(
          "shrink-0 rounded-xl flex items-center justify-center",
          compact ? "w-9 h-9 bg-blue-500/10 text-blue-300" : "w-10 h-10 bg-blue-500/10 text-blue-300"
        )}>
          <Lightbulb className={compact ? "w-4 h-4" : "w-5 h-5"} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1.5">
            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] text-white/35">
              <Compass className="w-3 h-3" />
              <span>{title}</span>
            </div>
            <Sparkles className="w-3 h-3 text-blue-300/80" />
          </div>
          <div key={activeTip.id} className="transition-all duration-300 ease-out">
            <p className={clsx("font-medium text-white", compact ? "text-sm" : "text-[15px]")}>{activeTip.title}</p>
            <p className={clsx("text-white/50 leading-relaxed mt-1", compact ? "text-xs" : "text-[13px]")}>{activeTip.description}</p>
          </div>
          {safeTips.length > 1 && (
            <div className="flex items-center gap-1.5 mt-3">
              {safeTips.map((tip, tipIndex) => (
                <div
                  key={tip.id}
                  className={clsx(
                    "h-1.5 rounded-full transition-all duration-300",
                    tipIndex === index ? "w-5 bg-blue-400/90" : "w-1.5 bg-white/15"
                  )}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
