import React, { useEffect, useState } from "react";
import { Loader2, Check, AlertTriangle, X, PackageCheck, Download } from "lucide-react";
import { useWorkflowTheme, WorkflowPortal } from "../WorkflowThemeContext";
import type { InstallState, InstallStep } from "../hooks/useWorkflowInstall";

/**
 * Determinate progress UI for a marketplace install: a checklist of provisioning
 * steps (save → files & media → dependencies → finish) with a progress bar.
 * Dependency failures surface as ⚠ rows but the install still completes
 * (warn + continue); the workflow's lazy install remains the fallback at run time.
 */

function StepIcon({ status }: { status: InstallStep["status"] }) {
  if (status === "done") return <Check className="w-4 h-4 wf-accent-text" />;
  if (status === "active") return <Loader2 className="w-4 h-4 animate-spin wf-accent-text" />;
  if (status === "failed") return <AlertTriangle className="w-4 h-4" style={{ color: "#f59e0b" }} />;
  return (
    <span
      className="block w-2.5 h-2.5 rounded-full"
      style={{ background: "color-mix(in srgb, var(--wf-fg) 22%, transparent)" }}
    />
  );
}

export function InstallProgressModal({ state, onClose }: { state: InstallState; onClose: () => void }) {
  const { isDark } = useWorkflowTheme();
  const d = isDark;
  const [showWarnings, setShowWarnings] = useState(false);

  // Seamless finish: a clean install (no warnings) reveals the freshly-loaded
  // workflow on its own after a short beat, so trivial installs don't demand a
  // click. Installs with warnings stay up so the user actually sees them.
  const cleanDone = state.phase === "done" && state.warnings.length === 0;
  useEffect(() => {
    if (!cleanDone) return;
    const t = window.setTimeout(onClose, 1400);
    return () => window.clearTimeout(t);
  }, [cleanDone, onClose]);

  if (state.phase === "idle") return null;

  const pct = Math.round(state.progress * 100);
  const isRunning = state.phase === "running";
  const isDone = state.phase === "done";
  const isError = state.phase === "error";
  const hasWarnings = state.warnings.length > 0;

  const headline = isError
    ? "Install failed"
    : isDone
      ? hasWarnings
        ? `Installed with ${state.warnings.length} warning${state.warnings.length === 1 ? "" : "s"}`
        : "Installed"
      : `Installing ${state.name}…`;

  return (
    <WorkflowPortal>
    <div
      className="fixed inset-0 z-[1100] flex items-center justify-center backdrop-blur-md p-4 animate-in fade-in duration-200"
      style={{ background: d ? "rgba(2, 6, 23, 0.78)" : "rgba(15, 23, 42, 0.18)" }}
    >
      <div
        className="w-full max-w-md rounded-[24px] border shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200"
        style={{ background: d ? "#0f1117" : "#ffffff", borderColor: "var(--wf-border)", color: "var(--wf-fg)" }}
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-4 flex items-start gap-3">
          <div
            className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0"
            style={{
              background: isError
                ? "color-mix(in srgb, #f59e0b 14%, transparent)"
                : "color-mix(in srgb, var(--wf-accent) 14%, transparent)",
              color: isError ? "#f59e0b" : "var(--wf-accent)",
            }}
          >
            {isError ? (
              <AlertTriangle className="w-5 h-5" />
            ) : isDone ? (
              <PackageCheck className="w-5 h-5" />
            ) : (
              <Download className="w-5 h-5" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-[15px] font-semibold wf-fg leading-tight">{headline}</h3>
            <p className="text-xs wf-fg-muted mt-0.5 truncate">{state.name}</p>
          </div>
          {!isRunning && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg transition-colors hover:bg-[color:color-mix(in_srgb,var(--wf-fg)_8%,transparent)]"
              style={{ color: "var(--wf-fg-faint)" }}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Progress bar */}
        <div className="px-5">
          <div
            className="h-1.5 rounded-full overflow-hidden"
            style={{ background: "color-mix(in srgb, var(--wf-fg) 8%, transparent)" }}
          >
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${isError ? pct : isDone ? 100 : pct}%`,
                background: isError ? "#f59e0b" : "var(--wf-accent)",
              }}
            />
          </div>
        </div>

        {/* Step checklist */}
        <div className="px-5 py-4 space-y-2.5">
          {state.steps.map((step) => (
            <div key={step.key} className="flex items-center gap-3">
              <span className="w-4 h-4 flex items-center justify-center shrink-0">
                <StepIcon status={step.status} />
              </span>
              <span
                className={`text-[13px] flex-1 min-w-0 ${
                  step.status === "pending" ? "wf-fg-faint" : "wf-fg"
                }`}
              >
                {step.label}
              </span>
              {step.detail && (
                <span className="text-[11px] wf-fg-muted truncate max-w-[55%] text-right tabular-nums">
                  {step.detail}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Warnings / error detail */}
        {(hasWarnings || isError) && (
          <div className="px-5 pb-4">
            <div
              className="rounded-xl p-3 text-xs"
              style={{
                background: "color-mix(in srgb, #f59e0b 8%, transparent)",
                border: "1px solid color-mix(in srgb, #f59e0b 22%, transparent)",
              }}
            >
              {isError ? (
                <span className="wf-fg">{state.error || "Something went wrong."}</span>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setShowWarnings((v) => !v)}
                    className="font-medium wf-fg flex items-center gap-1.5"
                  >
                    <AlertTriangle className="w-3.5 h-3.5" style={{ color: "#f59e0b" }} />
                    {showWarnings ? "Hide details" : "View details"}
                  </button>
                  {showWarnings && (
                    <ul className="mt-2 space-y-1 wf-fg-muted list-disc pl-4">
                      {state.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-2 wf-fg-muted">
                    The workflow is installed — these will be retried automatically the first time it runs.
                  </p>
                </>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        {!isRunning && (
          <div className="px-5 pb-5 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-white shadow-sm transition-all hover:-translate-y-0.5"
              style={{ background: "var(--wf-accent)" }}
            >
              {isDone ? "Open workflow" : "Close"}
            </button>
          </div>
        )}
      </div>
    </div>
    </WorkflowPortal>
  );
}
