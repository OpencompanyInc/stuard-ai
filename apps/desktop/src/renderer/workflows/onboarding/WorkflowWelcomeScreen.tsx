import React from "react";
import { ArrowRight, GitBranch, Sparkles, Wrench, Workflow, Zap } from "lucide-react";

interface WorkflowWelcomeScreenProps {
  onBeginAi: () => void;
  onBeginManual: () => void;
  onSkip: () => void;
  // True when the user is replaying — we soften the language vs. first-run.
  isReplay?: boolean;
}

export function WorkflowWelcomeScreen({
  onBeginAi,
  onBeginManual,
  onSkip,
  isReplay,
}: WorkflowWelcomeScreenProps) {
  return (
    <div
      className="fixed inset-0 z-[80] overflow-y-auto"
      style={{
        background:
          "radial-gradient(ellipse at top, rgba(59,130,246,0.18), transparent 60%), var(--wf-bg, #0b1020)",
      }}
    >
      <div className="min-h-full flex items-center justify-center px-8 py-16">
        <div className="w-full max-w-3xl">
          <div className="flex items-center gap-2 mb-6">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: "rgba(59,130,246,0.18)", color: "#93c5fd" }}
            >
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="text-[12px] uppercase tracking-[0.22em] wf-fg-muted">
              {isReplay ? "Workflow tour" : "Welcome to Workflows"}
            </div>
          </div>

          <h1 className="text-[36px] leading-tight font-semibold wf-fg">
            Build small AI agents that run on their own.
          </h1>
          <p className="mt-4 text-[16px] leading-relaxed wf-fg-muted max-w-2xl">
            A workflow is a recipe: a <em>trigger</em> says when it runs, <em>steps</em> say what
            it does, and <em>wires</em> connect them in order. Pick how you want to learn —
            both tours cover the same five concepts.
          </p>

          <div className="grid grid-cols-3 gap-3 mt-8">
            <ConceptCard
              icon={<Zap className="w-4 h-4" />}
              title="Trigger"
              body="When it runs — manually, on a schedule, on an event, or as a function called by another workflow."
              tint="amber"
            />
            <ConceptCard
              icon={<Workflow className="w-4 h-4" />}
              title="Steps"
              body="The actual work — call an LLM, hit an API, write a file, send a Slack message."
              tint="blue"
            />
            <ConceptCard
              icon={<GitBranch className="w-4 h-4" />}
              title="Wires"
              body="The path of execution. Step A → Step B means A runs first, B uses A's output."
              tint="violet"
            />
          </div>

          <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <PathCard
              icon={<Sparkles className="w-5 h-5" />}
              accent="#60a5fa"
              accentBg="rgba(59,130,246,0.95)"
              title="Watch AI build one"
              subtitle="Demo · 0 credits"
              body="A pre-built workflow loads with a simulated AI exchange so you can see the build flow without spending credits."
              cta="Start AI demo"
              onClick={onBeginAi}
              primary
            />
            <PathCard
              icon={<Wrench className="w-5 h-5" />}
              accent="#a78bfa"
              accentBg="rgba(139,92,246,0.95)"
              title="Build it manually"
              subtitle="Hands-on · drag & drop"
              body="Open the tool palette and drag pieces onto the canvas yourself. You'll wire a real trigger to a real step."
              cta="Start manual tour"
              onClick={onBeginManual}
            />
          </div>

          <div className="mt-6 flex items-center gap-3">
            <button
              type="button"
              onClick={onSkip}
              className="text-[13px] font-medium wf-fg-muted wf-hover-fg transition-colors"
            >
              {isReplay ? "Close" : "Skip — I'll explore on my own"}
            </button>
            <span className="text-[12px] wf-fg-faint">·</span>
            <span className="text-[12px] wf-fg-faint">
              You can replay this tour anytime from the launcher.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConceptCard({
  icon,
  title,
  body,
  tint,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  tint: "amber" | "blue" | "violet";
}) {
  const palette = {
    amber: { bg: "rgba(245,158,11,0.14)", fg: "#fbbf24" },
    blue: { bg: "rgba(59,130,246,0.14)", fg: "#60a5fa" },
    violet: { bg: "rgba(139,92,246,0.14)", fg: "#a78bfa" },
  }[tint];

  return (
    <div
      className="border wf-panel rounded-2xl p-4"
      style={{ backdropFilter: "var(--wf-glass-blur)" }}
    >
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center mb-3"
        style={{ background: palette.bg, color: palette.fg }}
      >
        {icon}
      </div>
      <div className="text-[14px] font-semibold wf-fg">{title}</div>
      <p className="mt-1.5 text-[12px] leading-relaxed wf-fg-muted">{body}</p>
    </div>
  );
}

function PathCard({
  icon,
  accent,
  accentBg,
  title,
  subtitle,
  body,
  cta,
  onClick,
  primary,
}: {
  icon: React.ReactNode;
  accent: string;
  accentBg: string;
  title: string;
  subtitle: string;
  body: string;
  cta: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group text-left border wf-panel rounded-2xl p-5 transition-all hover:-translate-y-0.5"
      style={{
        backdropFilter: "var(--wf-glass-blur)",
        boxShadow: primary
          ? `0 18px 40px -20px ${accentBg.replace(/,\s*0\.95\)$/, ", 0.45)")}`
          : undefined,
      }}
    >
      <div className="flex items-center gap-3 mb-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: `${accent}22`, color: accent }}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-[15px] font-semibold wf-fg">{title}</div>
          <div className="text-[11px] uppercase tracking-[0.16em] wf-fg-muted mt-0.5">
            {subtitle}
          </div>
        </div>
      </div>
      <p className="text-[13px] leading-relaxed wf-fg-muted">{body}</p>
      <div
        className="mt-4 inline-flex items-center gap-1.5 text-[12px] font-semibold"
        style={{ color: accent }}
      >
        {cta}
        <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
      </div>
    </button>
  );
}
