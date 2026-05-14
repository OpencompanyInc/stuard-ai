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
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] pointer-events-auto border wf-panel"
      style={{
        width: 380,
        maxWidth: "calc(100vw - 32px)",
        borderRadius: 20,
        padding: 16,
        backdropFilter: "var(--wf-glass-blur)",
        boxShadow:
          "0 24px 48px -16px rgba(0, 0, 0, 0.35), 0 8px 24px -8px rgba(59, 130, 246, 0.25)",
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ background: "rgba(59, 130, 246, 0.15)", color: "#60a5fa" }}
        >
          <Compass className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="flex items-center gap-2 min-w-0">
              <div className="text-[11px] uppercase tracking-[0.18em] wf-fg-muted shrink-0">
                Workflow tour
              </div>
              {step.badge && (
                <span
                  className="text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
                  style={{
                    background: "rgba(59, 130, 246, 0.15)",
                    color: "#93c5fd",
                  }}
                >
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
            <p className="mt-2 text-[11px] leading-relaxed" style={{ color: "#60a5fa" }}>
              {step.autoHint}
            </p>
          )}
          {step.manualAction && !canAdvance && blockedHint && (
            <p className="mt-2 text-[11px] leading-relaxed" style={{ color: "#f59e0b" }}>
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
                      i <= currentIndex
                        ? "rgba(96, 165, 250, 0.9)"
                        : "var(--wf-border)",
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
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors"
                style={{
                  background: canAdvance ? "rgba(59, 130, 246, 0.95)" : "rgba(148, 163, 184, 0.35)",
                  color: canAdvance ? "white" : "rgba(255, 255, 255, 0.6)",
                  cursor: canAdvance ? "pointer" : "not-allowed",
                }}
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
