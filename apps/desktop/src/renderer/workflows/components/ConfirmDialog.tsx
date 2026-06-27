/**
 * ConfirmDialog — a single, on-brand replacement for the native window.confirm()
 * dialog used across Stuard Studio (delete a tool / skill / workflow / draft …).
 *
 * Usage (imperative, promise-based — works from components *and* hooks):
 *
 *   import { confirmDialog } from "./ConfirmDialog";
 *   if (!(await confirmDialog({ title: "Delete X?", tone: "danger" }))) return;
 *
 * A single <ConfirmDialogHost /> must be mounted inside the Studio theme scope
 * (see workflows.tsx). If no host is mounted the call transparently falls back
 * to the native window.confirm so nothing ever hangs.
 */
import React, { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

export interface ConfirmOptions {
  title?: string;
  message?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
  /** "alert" hides the cancel button — used for one-button acknowledgements. */
  kind?: "confirm" | "alert";
}

type HostState = { open: boolean; opts: ConfirmOptions };

// Module-level bridge so any caller (component or hook) can open the dialog
// without prop-drilling a context through the whole Studio tree.
let pushState: ((s: HostState) => void) | null = null;
let resolveCurrent: ((v: boolean) => void) | null = null;

export function confirmDialog(opts: ConfirmOptions = {}): Promise<boolean> {
  if (!pushState) {
    // Host not mounted — degrade gracefully to the native dialog.
    const msg =
      typeof opts.message === "string"
        ? opts.message
        : opts.title || "Are you sure?";
    if (opts.kind === "alert") {
      window.alert(msg);
      return Promise.resolve(true);
    }
    return Promise.resolve(window.confirm(msg));
  }
  // Cancel any in-flight dialog before replacing it.
  if (resolveCurrent) {
    resolveCurrent(false);
    resolveCurrent = null;
  }
  return new Promise<boolean>((resolve) => {
    resolveCurrent = resolve;
    pushState!({ open: true, opts });
  });
}

/** One-button acknowledgement — a modern replacement for window.alert(). */
export function alertDialog(opts: Omit<ConfirmOptions, "kind"> = {}): Promise<void> {
  return confirmDialog({ confirmLabel: "OK", ...opts, kind: "alert" }).then(() => undefined);
}

export function ConfirmDialogHost() {
  const [state, setState] = useState<HostState>({ open: false, opts: {} });

  useEffect(() => {
    pushState = setState;
    return () => {
      if (pushState === setState) pushState = null;
    };
  }, []);

  const close = (val: boolean) => {
    setState((s) => ({ ...s, open: false }));
    const r = resolveCurrent;
    resolveCurrent = null;
    r?.(val);
  };

  useEffect(() => {
    if (!state.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        close(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.open]);

  if (!state.open) return null;

  const {
    title = "Are you sure?",
    message,
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    tone = "default",
    kind = "confirm",
  } = state.opts;
  const danger = tone === "danger";
  const isAlert = kind === "alert";

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center backdrop-blur-md p-4 animate-in fade-in duration-150"
      style={{ background: "color-mix(in srgb, var(--wf-bg-sunken) 72%, transparent)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close(false);
      }}
    >
      <div className="wf-bg-elevated wf-fg w-full max-w-[420px] rounded-[22px] border wf-border shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
        <div className="p-5">
          <div className="flex items-start gap-3.5">
            <span
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] ${danger ? "" : "wf-icon-chip"}`}
              style={danger ? { background: "rgba(244,63,94,0.13)", color: "#fb7185" } : undefined}
            >
              <AlertTriangle className="w-5 h-5" strokeWidth={1.9} />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <h2 className="text-[15.5px] font-semibold wf-fg leading-tight">{title}</h2>
              {message != null && (
                <div className="mt-1.5 text-[13px] leading-relaxed wf-fg-muted">{message}</div>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2.5 px-5 pb-5">
          {!isAlert && (
            <button
              type="button"
              onClick={() => close(false)}
              className="wf-card wf-card-interactive rounded-full px-4 py-2 text-[13px] font-medium wf-fg-muted hover:wf-fg"
            >
              {cancelLabel}
            </button>
          )}
          <button
            type="button"
            autoFocus
            onClick={() => close(true)}
            className={`rounded-full px-4 py-2 text-[13px] font-semibold transition-all active:scale-[0.98] ${danger ? "text-white shadow-sm" : "wf-primary-btn"}`}
            style={danger ? { background: "#e11d48" } : undefined}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
