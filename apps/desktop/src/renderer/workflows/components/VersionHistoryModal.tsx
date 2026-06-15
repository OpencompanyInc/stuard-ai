/**
 * VersionHistoryModal — browse and revert local deploy versions of a workflow.
 *
 * Every local deploy snapshots the workflow into a per-workflow history store
 * (see main/workflows/versions.ts). This modal lists those snapshots newest-first
 * and lets the user restore a previous deploy (which becomes live again) or prune
 * old ones. Marketplace publishing is a separate concept and lives elsewhere.
 */
import React from "react";
import {
  History, X, RotateCcw, Trash2, Check, Clock, GitCommitVertical, Loader2, Zap, Boxes,
} from "lucide-react";
import { useWorkflowTheme } from "../WorkflowThemeContext";
import { confirmDialog } from "./ConfirmDialog";
import type { WorkflowVersion } from "../hooks/useWorkflowDeploy";

interface VersionHistoryModalProps {
  workflowName?: string;
  versions: WorkflowVersion[];
  currentVersionId: string | null;
  loading: boolean;
  revertingVersionId: string | null;
  onClose: () => void;
  onRefresh: () => void;
  onRevert: (versionId: string) => void;
  onDelete: (versionId: string) => void;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function absoluteTime(iso: string): string {
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? "" : t.toLocaleString();
}

export function VersionHistoryModal({
  workflowName,
  versions,
  currentVersionId,
  loading,
  revertingVersionId,
  onClose,
  onRefresh,
  onRevert,
  onDelete,
}: VersionHistoryModalProps) {
  const { isDark } = useWorkflowTheme();
  const d = isDark;
  const panelStyle = { background: d ? "#0f1117" : "#ffffff", borderColor: "var(--wf-border)", color: "var(--wf-fg)" } as React.CSSProperties;
  const headerStyle = { background: d ? "#0c0f14" : "#ffffff", borderColor: "var(--wf-border)" } as React.CSSProperties;
  const footerStyle = { background: d ? "#0c0f14" : "#ffffff", borderColor: "var(--wf-border)" } as React.CSSProperties;
  const rowStyle = { background: d ? "rgba(255,255,255,0.02)" : "var(--wf-bg)", borderColor: "var(--wf-border)" } as React.CSSProperties;

  const handleRevert = async (v: WorkflowVersion) => {
    const ok = await confirmDialog({
      title: `Restore v${v.version}?`,
      message: `This makes the deploy from ${relativeTime(v.deployedAt)} live again, replacing the current workflow on the canvas. The version that's live now stays in your history, so you can switch back. Any unsaved edits you haven't deployed will be lost.`,
      confirmLabel: "Restore & deploy",
      tone: "default",
    });
    if (ok) onRevert(v.id);
  };

  const handleDelete = async (v: WorkflowVersion) => {
    const ok = await confirmDialog({
      title: `Delete v${v.version}?`,
      message: "This permanently removes this snapshot from the deploy history. It can't be undone.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (ok) onDelete(v.id);
  };

  return (
    <div
      className="fixed inset-0 backdrop-blur-md flex items-center justify-center z-[60] animate-in fade-in duration-150 p-4"
      style={{ background: d ? "rgba(2, 6, 23, 0.78)" : "rgba(15, 23, 42, 0.18)" }}
      onClick={onClose}
    >
      <div
        className="rounded-[28px] border shadow-2xl w-[600px] max-w-[94vw] max-h-[86vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200"
        style={panelStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between" style={headerStyle}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: d ? "rgba(244,63,94,0.12)" : "#fef2f2", color: d ? "#fda4af" : "#e11d48" }}>
              <History className="w-4.5 h-4.5" />
            </div>
            <div>
              <h3 className="font-semibold wf-fg">Deploy History</h3>
              <p className="text-xs wf-fg-muted">{workflowName || "Untitled Workflow"}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg transition-colors" style={{ color: "var(--wf-fg-faint)" }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 wf-fg-muted text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading history…
            </div>
          ) : versions.length === 0 ? (
            <div className="text-center py-12 px-6">
              <div className="w-12 h-12 rounded-2xl mx-auto mb-3 flex items-center justify-center" style={{ background: d ? "rgba(255,255,255,0.04)" : "#f1f5f9" }}>
                <GitCommitVertical className={`w-6 h-6 ${d ? "text-white/35" : "text-slate-300"}`} />
              </div>
              <p className="text-sm wf-fg font-medium">No versions yet</p>
              <p className="text-xs wf-fg-muted mt-1">Deploy this workflow to save your first version. Every deploy is snapshotted here so you can roll back.</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {versions.map((v) => {
                const isCurrent = v.id === currentVersionId;
                const isReverting = revertingVersionId === v.id;
                return (
                  <div
                    key={v.id}
                    className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl border transition-colors"
                    style={isCurrent
                      ? { background: d ? "rgba(244,63,94,0.08)" : "#fff1f2", borderColor: d ? "rgba(244,63,94,0.22)" : "#fecdd3" }
                      : rowStyle}
                  >
                    {/* Version number */}
                    <div
                      className="flex items-center justify-center w-10 h-10 rounded-lg text-sm font-semibold shrink-0"
                      style={isCurrent
                        ? { background: d ? "rgba(244,63,94,0.15)" : "#ffe4e6", color: d ? "#fda4af" : "#e11d48" }
                        : { background: d ? "rgba(255,255,255,0.04)" : "#f1f5f9", color: "var(--wf-fg-muted)" }}
                    >
                      v{v.version}
                    </div>

                    {/* Meta */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium wf-fg truncate">{v.name}</span>
                        {isCurrent && (
                          <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full inline-flex items-center gap-1" style={{ background: d ? "rgba(16,185,129,0.15)" : "#dcfce7", color: d ? "#6ee7b7" : "#15803d" }}>
                            <Check className="w-2.5 h-2.5" /> Live
                          </span>
                        )}
                        {v.source === "revert" && (
                          <span className="px-1.5 py-0.5 text-[10px] font-medium rounded-full" style={{ background: d ? "rgba(255,255,255,0.06)" : "#f1f5f9", color: "var(--wf-fg-faint)" }}>
                            reverted{v.restoredFrom ? ` from v${v.restoredFrom}` : ""}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2.5 mt-0.5 text-xs wf-fg-faint" title={absoluteTime(v.deployedAt)}>
                        <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" />{relativeTime(v.deployedAt)}</span>
                        {v.triggerTypes.length > 0 && (
                          <span className="inline-flex items-center gap-1"><Zap className="w-3 h-3" />{v.triggerTypes.length} trigger{v.triggerTypes.length !== 1 ? "s" : ""}</span>
                        )}
                        <span className="inline-flex items-center gap-1"><Boxes className="w-3 h-3" />{v.nodeCount} node{v.nodeCount !== 1 ? "s" : ""}</span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      {!isCurrent && (
                        <>
                          <button
                            onClick={() => handleRevert(v)}
                            disabled={isReverting || !!revertingVersionId}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-all disabled:opacity-50"
                            style={{ background: d ? "rgba(244,63,94,0.10)" : "#fef2f2", color: d ? "#fda4af" : "#e11d48", borderColor: d ? "rgba(244,63,94,0.20)" : "#fecdd3" }}
                            title="Restore this version and make it live"
                          >
                            {isReverting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                            {isReverting ? "Restoring…" : "Restore"}
                          </button>
                          <button
                            onClick={() => handleDelete(v)}
                            disabled={!!revertingVersionId}
                            className="p-1.5 rounded-lg transition-colors disabled:opacity-50 hover:bg-black/5"
                            style={{ color: "var(--wf-fg-faint)" }}
                            title="Delete this version"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t flex items-center justify-between" style={footerStyle}>
          <p className="text-xs wf-fg-faint">A new version is saved each time you deploy locally.</p>
          <button
            onClick={onRefresh}
            className="text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors"
            style={{ background: d ? "rgba(255,255,255,0.03)" : "#ffffff", borderColor: "var(--wf-input-border)", color: "var(--wf-fg)" }}
          >
            Refresh
          </button>
        </div>
      </div>
    </div>
  );
}
