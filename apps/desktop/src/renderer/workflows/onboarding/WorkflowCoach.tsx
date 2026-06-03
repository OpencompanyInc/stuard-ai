import React from "react";
import { ArrowRight, Compass, X } from "lucide-react";
import type { OnboardingStepConfig } from "./onboardingSteps";

interface WorkflowCoachProps {
  step: OnboardingStepConfig;
  currentIndex: number; // 0-based
  totalSteps: number;
  onAdvance: () => void;
  onSkip: () => void;
  canAdvance?: boolean;
  blockedHint?: string;
}

export function WorkflowCoach({
  step,
  currentIndex,
  totalSteps,
  onAdvance,
  onSkip,
  canAdvance = true,
  blockedHint,
}: WorkflowCoachProps) {
  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] pointer-events-auto wf-card rounded-[20px] p-4"
      style={{
        width: 380,
        maxWidth: "calc(100vw - 32px)",
        backdropFilter: "var(--wf-glass-blur)",
        WebkitBackdropFilter: "var(--wf-glass-blur)",
        boxShadow:
          "inset 0 1px 0 color-mix(in srgb, var(--wf-fg) 5%, transparent), 0 16px 40px -12px rgba(15, 23, 42, 0.28)",
      }}
    >
      <div className="flex items-start gap-3">
        <span className="wf-feature-tile__icon flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
          <Compass className="w-4 h-4" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="flex items-center gap-2 min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] wf-fg-faint shrink-0">
                Workflow tour
              </div>
              {step.badge && (
                <span className="wf-icon-chip rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap">
                  {step.badge}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={onSkip}
              className="p-1 rounded-md wf-fg-muted wf-hover-fg transition-colors shrink-0"
              title="End tour"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="text-[15px] font-semibold wf-fg leading-snug">
            {step.title}
          </div>
          <p className="mt-2 text-[13px] leading-relaxed wf-fg-muted">
            {step.body}
          </p>
          {step.autoHint && !step.manualAction && (
            <p className="mt-2 text-[11px] leading-relaxed wf-accent-fg">
              {step.autoHint}
            </p>
          )}
          {step.manualAction && !canAdvance && blockedHint && (
            <p className="mt-2 text-[11px] leading-relaxed wf-fg-muted">
              {blockedHint}
            </p>
          )}

          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              {Array.from({ length: totalSteps }).map((_, i) => (
                <div
                  key={i}
                  className="h-1.5 rounded-full transition-all duration-300"
                  style={{
                    width: i === currentIndex ? 20 : 6,
                    background:
                      i <= currentIndex ? "var(--wf-accent)" : "var(--wf-border)",
                  }}
                />
              ))}
            </div>
            {step.manualAction ? (
              <button
                type="button"
                onClick={() => {
                  if (canAdvance) onAdvance();
                }}
                disabled={!canAdvance}
                className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition-all ${
                  canAdvance
                    ? "wf-primary-btn active:scale-[0.98]"
                    : "wf-surface-muted wf-fg-faint cursor-not-allowed"
                }`}
              >
                {step.manualAction}
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={onSkip}
                className="text-[12px] wf-fg-muted wf-hover-fg transition-colors"
              >
                Skip tour
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
