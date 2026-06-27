import React, { useEffect, useMemo, useState } from "react";
import { Loader2, FileText, Image as ImageIcon, AlertTriangle, Package } from "lucide-react";
import {
  listBundleCandidates,
  MAX_BUNDLE_BYTES,
  type BundleCandidate,
} from "../utils/workspaceBundle";
import { detectReferencedFiles } from "../utils/workspaceReferences";
import {
  collectWorkflowDependencies,
  summarizeDependencies,
} from "@stuardai/workflow-core/dependencies";

/**
 * Publish-time "Files & dependencies" review. Auto-detects which workspace files
 * the workflow actually references and pre-selects only those, so a creator
 * doesn't accidentally ship personal media that merely sits in the workspace.
 * The creator can tick/untick anything; only checked files get bundled.
 */

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export interface BundleSelection {
  candidates: BundleCandidate[] | null;
  referenced: Set<string>;
  reasons: Map<string, string>;
  selected: Set<string>;
  toggle: (path: string) => void;
  loading: boolean;
}

/**
 * Loads the bundle candidates + reference detection once per modal open and
 * tracks the creator's selection (defaulting to the referenced subset).
 */
export function useBundleSelection(workflowId: string | undefined, spec: any): BundleSelection {
  const [candidates, setCandidates] = useState<BundleCandidate[] | null>(null);
  const [referenced, setReferenced] = useState<Set<string>>(new Set());
  const [reasons, setReasons] = useState<Map<string, string>>(new Map());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!workflowId) {
        setCandidates([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      const cands = await listBundleCandidates(workflowId);
      const api = (window as any).desktopAPI;
      const readStuard = api?.workflowsReadWorkspaceFile
        ? async (p: string) => {
            try {
              const r = await api.workflowsReadWorkspaceFile(workflowId, p);
              return r?.ok && typeof r.content === "string" ? r.content : null;
            } catch {
              return null;
            }
          }
        : undefined;
      const det = await detectReferencedFiles(spec, cands.map((c) => c.path), readStuard);
      if (!alive) return;
      setCandidates(cands);
      setReferenced(det.referenced);
      setReasons(det.reasonByPath);
      // Default selection: referenced files that fit under the per-file cap.
      setSelected(
        new Set(cands.filter((c) => det.referenced.has(c.path) && c.withinSizeCap).map((c) => c.path)),
      );
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
    // Re-detect only when the target workflow changes (spec identity is stable per open).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowId]);

  const toggle = (path: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return { candidates, referenced, reasons, selected, toggle, loading };
}

export function FilesReviewStep({
  spec,
  selection,
  isDark,
}: {
  spec: any;
  selection: BundleSelection;
  isDark: boolean;
}) {
  const { candidates, referenced, reasons, selected, toggle, loading } = selection;
  const d = isDark;

  const deps = useMemo(() => collectWorkflowDependencies(spec), [spec]);
  const depSummary = summarizeDependencies(deps, 6);

  const selectedBytes = useMemo(() => {
    if (!candidates) return 0;
    return candidates
      .filter((c) => selected.has(c.path))
      .reduce((sum, c) => sum + (c.kind === "binary" ? Math.ceil(c.size * 1.34) : c.size), 0);
  }, [candidates, selected]);

  const overCap = selectedBytes > MAX_BUNDLE_BYTES;

  const rowStyle: React.CSSProperties = {
    background: d ? "rgba(255,255,255,0.02)" : "var(--wf-bg)",
    borderColor: "var(--wf-border)",
  };

  if (loading) {
    return (
      <div className="flex items-center gap-3 py-10 justify-center wf-fg-muted text-sm">
        <Loader2 className="w-4 h-4 animate-spin" />
        Scanning workspace for referenced files…
      </div>
    );
  }

  const list = candidates || [];
  if (list.length === 0) {
    return (
      <div className="space-y-4">
        <DepSummary depSummary={depSummary} hasDeps={deps.python.packages.length > 0 || !!deps.python.requirementsTxt} />
        <div className="text-sm wf-fg-muted py-6 text-center">
          This workflow has no extra workspace files to bundle.
        </div>
      </div>
    );
  }

  const referencedList = list.filter((c) => referenced.has(c.path));
  const otherList = list.filter((c) => !referenced.has(c.path));

  const Row = ({ cand }: { cand: BundleCandidate }) => {
    const checked = selected.has(cand.path);
    const reason = reasons.get(cand.path);
    const disabled = !cand.withinSizeCap;
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => toggle(cand.path)}
        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-colors ${
          disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-[color:color-mix(in_srgb,var(--wf-fg)_4%,transparent)]"
        }`}
        style={rowStyle}
      >
        <span
          className="w-4 h-4 rounded-[5px] border flex items-center justify-center shrink-0"
          style={{
            background: checked ? "var(--wf-accent)" : "transparent",
            borderColor: checked ? "var(--wf-accent)" : "var(--wf-border)",
          }}
        >
          {checked && (
            <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none">
              <path d="M2.5 6.2l2.2 2.3 4.8-5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
        {cand.kind === "binary" ? (
          <ImageIcon className="w-4 h-4 shrink-0 wf-fg-faint" />
        ) : (
          <FileText className="w-4 h-4 shrink-0 wf-fg-faint" />
        )}
        <span className="flex-1 min-w-0">
          <span className="block text-[13px] wf-fg truncate">{cand.path}</span>
          {(reason || disabled) && (
            <span className="block text-[11px] wf-fg-muted truncate">
              {disabled ? "Too large to bundle" : reason}
            </span>
          )}
        </span>
        <span className="text-[11px] wf-fg-faint tabular-nums shrink-0">{formatBytes(cand.size)}</span>
      </button>
    );
  };

  return (
    <div className="space-y-5">
      <DepSummary depSummary={depSummary} hasDeps={deps.python.packages.length > 0 || !!deps.python.requirementsTxt} />

      {referencedList.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-semibold wf-fg-muted uppercase tracking-wide">
            Referenced by this workflow · included
          </div>
          <div className="space-y-1.5">
            {referencedList.map((c) => (
              <Row key={c.path} cand={c} />
            ))}
          </div>
        </div>
      )}

      {otherList.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold wf-fg-muted uppercase tracking-wide">
            <AlertTriangle className="w-3.5 h-3.5" style={{ color: "#f59e0b" }} />
            Not referenced · excluded by default
          </div>
          <p className="text-[11px] wf-fg-faint -mt-1">
            These aren't used by your scripts. Leave them off to avoid sharing personal files; tick any you intentionally want to include.
          </p>
          <div className="space-y-1.5">
            {otherList.map((c) => (
              <Row key={c.path} cand={c} />
            ))}
          </div>
        </div>
      )}

      {/* Size meter */}
      <div className="flex items-center justify-between text-xs">
        <span className="wf-fg-muted">
          {selected.size} file{selected.size === 1 ? "" : "s"} selected
        </span>
        <span className={overCap ? "font-semibold" : "wf-fg-muted"} style={overCap ? { color: "#f59e0b" } : undefined}>
          {formatBytes(selectedBytes)} / {formatBytes(MAX_BUNDLE_BYTES)}
          {overCap && " — over limit, some files will be skipped"}
        </span>
      </div>
    </div>
  );
}

function DepSummary({ depSummary, hasDeps }: { depSummary: string; hasDeps: boolean }) {
  if (!hasDeps) return null;
  return (
    <div
      className="rounded-xl px-3.5 py-3 flex items-start gap-2.5 text-[13px]"
      style={{
        background: "color-mix(in srgb, var(--wf-accent) 7%, transparent)",
        border: "1px solid color-mix(in srgb, var(--wf-accent) 18%, var(--wf-border))",
      }}
    >
      <Package className="w-4 h-4 mt-0.5 shrink-0 wf-accent-text" />
      <div>
        <div className="font-medium wf-fg">Dependencies install automatically</div>
        <div className="wf-fg-muted">Installers will set up: {depSummary}</div>
      </div>
    </div>
  );
}
