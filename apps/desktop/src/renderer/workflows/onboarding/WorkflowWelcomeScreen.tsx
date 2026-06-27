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
    <div className="fixed inset-0 z-[80] overflow-y-auto wf-bg wf-fg">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at top, color-mix(in srgb, var(--wf-accent) 10%, transparent), transparent 62%)",
        }}
      />
      <div className="relative min-h-full flex items-center justify-center px-8 py-16">
        <div className="w-full max-w-3xl">
          <div className="flex items-center gap-2 mb-6">
            <span className="wf-feature-tile__icon flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
              <Sparkles className="w-4 h-4" strokeWidth={1.75} />
            </span>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] wf-fg-faint">
              {isReplay ? "Workflow tour" : "Welcome to Workflows"}
            </div>
          </div>

          <h1 className="text-[32px] leading-tight font-semibold tracking-tight wf-fg">
            Build small AI agents that run on their own.
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed wf-fg-muted max-w-2xl">
            A workflow is a recipe: a <em>trigger</em> says when it runs, <em>steps</em> say what
            it does, and <em>wires</em> connect them in order. Pick how you want to learn —
            both tours cover the same five concepts.
          </p>

          <div className="grid grid-cols-3 gap-3 mt-8">
            <ConceptCard
              icon={<Zap className="w-4 h-4" strokeWidth={1.75} />}
              title="Trigger"
              body="When it runs — manually, on a schedule, on an event, or as a function called by another workflow."
            />
            <ConceptCard
              icon={<Workflow className="w-4 h-4" strokeWidth={1.75} />}
              title="Steps"
              body="The actual work — call an LLM, hit an API, write a file, send a Slack message."
            />
            <ConceptCard
              icon={<GitBranch className="w-4 h-4" strokeWidth={1.75} />}
              title="Wires"
              body="The path of execution. Step A → Step B means A runs first, B uses A's output."
            />
          </div>

          <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <PathCard
              icon={<Sparkles className="w-5 h-5" strokeWidth={1.75} />}
              title="Watch AI build one"
              subtitle="Demo · 0 credits"
              body="A pre-built workflow loads with a simulated AI exchange so you can see the build flow without spending credits."
              cta="Start AI demo"
              onClick={onBeginAi}
              primary
            />
            <PathCard
              icon={<Wrench className="w-5 h-5" strokeWidth={1.75} />}
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
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="wf-card rounded-[20px] p-4">
      <span className="wf-icon-chip mb-3 flex h-8 w-8 items-center justify-center rounded-lg">
        {icon}
      </span>
      <div className="text-[14px] font-semibold wf-fg">{title}</div>
      <p className="mt-1.5 text-[12px] leading-relaxed wf-fg-muted">{body}</p>
    </div>
  );
}

function PathCard({
  icon,
  title,
  subtitle,
  body,
  cta,
  onClick,
  primary,
}: {
  icon: React.ReactNode;
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
      className={`wf-feature-tile group flex flex-col items-start rounded-[22px] p-5 text-left ${
        primary ? "wf-card-active" : ""
      }`}
    >
      <div className="flex w-full items-start gap-3 mb-3">
        <span className="wf-feature-tile__icon flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px]">
          {icon}
        </span>
        <div className="min-w-0">
          <div className="text-[15px] font-semibold wf-fg">{title}</div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] wf-fg-faint mt-0.5">
            {subtitle}
          </div>
        </div>
      </div>
      <p className="text-[13px] leading-relaxed wf-fg-muted">{body}</p>
      <div className="mt-4 inline-flex items-center gap-1.5 text-[12px] font-semibold wf-fg-muted">
        <span className="transition-colors group-hover:text-[color:var(--wf-accent)]">{cta}</span>
        <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5 group-hover:text-[color:var(--wf-accent)]" />
      </div>
    </button>
  );
}
