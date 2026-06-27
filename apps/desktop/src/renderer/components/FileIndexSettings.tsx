import React, { useCallback, useEffect, useState } from "react";
import {
  FolderSearch,
  Plus,
  Trash2,
  RefreshCw,
  Loader2,
  Clock,
  FolderOpen,
  ChevronRight,
  ScanSearch,
  Coins,
  CheckCircle2,
} from "lucide-react";
import { clsx } from "clsx";
import { supabase } from "../lib/supabaseClient";
import { confirmDialog } from "../workflows/components/ConfirmDialog";

const CLOUD_AI_HTTP =
  (window as any).__CLOUD_AI_HTTP__ ||
  (import.meta as any).env?.VITE_CLOUD_AI_URL ||
  "http://127.0.0.1:8082";

async function getEmbedAuth(): Promise<{ token: string; baseUrl: string } | null> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) return null;
    return { token: session.access_token, baseUrl: CLOUD_AI_HTTP };
  } catch {
    return null;
  }
}

interface EmbedProgress {
  jobId: string;
  rootId?: string;
  status: "gathering" | "submitting" | "running" | "writing" | "succeeded" | "failed";
  totalFiles: number;
  embeddedFiles: number;
  queuedFiles: number;
  estimatedCredits: number;
  error?: string;
}

interface EmbedPanelState {
  rootId: string;
  loading: boolean;
  files: number;
  credits: number;
  balance: number;
  unlimited: boolean;
  cap: number;
  error?: string;
}

const EMBED_STATUS_LABEL: Record<EmbedProgress["status"], string> = {
  gathering: "Preparing files",
  submitting: "Embedding",
  running: "Embedding",
  writing: "Saving vectors",
  succeeded: "Searchable by meaning",
  failed: "Failed",
};

interface IndexedRoot {
  id: string;
  path: string;
  enabled: boolean;
  schedule: "off" | "hourly" | "daily" | "weekly" | "custom";
  interval_hours: number | null;
  last_scan_at: string | null;
  exclude_globs?: string | null;
  semantic?: boolean;
  indexed_files?: number;
  pending_files?: number;
  created_at: string;
}

interface IndexingStatus {
  status: "idle" | "scanning" | "complete" | "error";
  totalRoots?: number;
  completedRoots?: number;
  currentPath?: string;
  error?: string;
}

const formatNumber = (n: number): string => {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
};

const formatTime = (iso: string | null): string => {
  if (!iso) return "Never";
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

export const FileIndexSettings: React.FC = () => {
  const [roots, setRoots] = useState<IndexedRoot[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState<string | null>(null);
  const [addingFolder, setAddingFolder] = useState(false);
  const [indexingStatus, setIndexingStatus] = useState<IndexingStatus>({ status: "idle" });
  const [expandedFolderId, setExpandedFolderId] = useState<string | null>(null);
  const [embedProgress, setEmbedProgress] = useState<Record<string, EmbedProgress>>({});
  const [embedPanel, setEmbedPanel] = useState<EmbedPanelState | null>(null);
  const [excludeDraft, setExcludeDraft] = useState<Record<string, string>>({});
  const [savingExcludes, setSavingExcludes] = useState<string | null>(null);

  const api = (window as any).desktopAPI;

  // Only folders the user opted into semantic search appear here — the global
  // name-search index (Program Files, AppData, …) is managed elsewhere.
  const semanticRoots = roots.filter((r) => r.semantic);
  const embeddedTotal = semanticRoots.reduce((sum, r) => sum + (r.indexed_files ?? 0), 0);

  const loadData = useCallback(async () => {
    try {
      // Only the per-root list is rendered (folder rows + the embedded/folder
      // summary, both derived from `roots`). We intentionally do NOT fetch the
      // global index stats here: `getStats` runs five full-table COUNT scans +
      // a GROUP BY over the entire (multi-GB) index, and nothing in this view
      // displays it — it was pure latency on every load and every refresh.
      const rootsRes = await api?.fileIndexListRoots?.();
      if (rootsRes?.ok) setRoots(rootsRes.roots || []);
    } catch (e) {
      console.error("[FileIndexSettings] Load error:", e);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    loadData();

    const unsubStatus = api?.onFileIndexStatus?.((data: IndexingStatus) => {
      setIndexingStatus(data);
      if (data.status === "complete") {
        loadData();
      }
    });

    return () => {
      if (typeof unsubStatus === "function") unsubStatus();
    };
  }, [loadData, api]);

  // Subscribe to semantic embedding progress + hydrate any in-flight jobs.
  useEffect(() => {
    const unsub = api?.onFileIndexEmbedProgress?.((p: EmbedProgress) => {
      const key = p.rootId || p.jobId;
      setEmbedProgress((prev) => ({ ...prev, [key]: p }));
      if (p.status === "succeeded") {
        loadData();
      }
    });
    api?.fileIndexEmbedActive?.().then((r: any) => {
      if (r?.ok && Array.isArray(r.jobs)) {
        setEmbedProgress((prev) => {
          const next = { ...prev };
          for (const j of r.jobs) next[j.rootId || j.jobId] = j;
          return next;
        });
      }
    });
    return () => {
      if (typeof unsub === "function") unsub();
    };
  }, [api, loadData]);

  const handleMakeSearchable = async (rootId: string) => {
    const auth = await getEmbedAuth();
    if (!auth) {
      setEmbedPanel({ rootId, loading: false, files: 0, credits: 0, balance: 0, unlimited: false, cap: 0, error: "Sign in to enable semantic search." });
      return;
    }
    setEmbedPanel({ rootId, loading: true, files: 0, credits: 0, balance: 0, unlimited: false, cap: 0 });
    try {
      const est = await api?.fileIndexEmbedEstimate?.(rootId, auth.baseUrl, auth.token);
      if (!est?.ok) {
        setEmbedPanel({ rootId, loading: false, files: 0, credits: 0, balance: 0, unlimited: false, cap: 0, error: est?.error || "Couldn't estimate cost." });
        return;
      }
      const estCredits = Math.ceil(Number(est.estimatedCredits) || 0);
      const balance = Number(est.balance) || 0;
      const defaultCap = est.unlimited
        ? Math.max(1, estCredits)
        : Math.max(1, Math.min(estCredits || 1, Math.floor(balance) || 1));
      setEmbedPanel({
        rootId,
        loading: false,
        files: Number(est.files) || 0,
        credits: estCredits,
        balance,
        unlimited: !!est.unlimited,
        cap: defaultCap,
      });
    } catch (e: any) {
      setEmbedPanel({ rootId, loading: false, files: 0, credits: 0, balance: 0, unlimited: false, cap: 0, error: String(e?.message || e) });
    }
  };

  const handleStartEmbed = async (rootId: string) => {
    if (!embedPanel || embedPanel.rootId !== rootId) return;
    const auth = await getEmbedAuth();
    if (!auth) return;
    const cap = embedPanel.cap;
    setEmbedPanel(null);
    setEmbedProgress((prev) => ({
      ...prev,
      [rootId]: { jobId: "pending", rootId, status: "gathering", totalFiles: 0, embeddedFiles: 0, queuedFiles: 0, estimatedCredits: 0 },
    }));
    try {
      const res = await api?.fileIndexEmbedStart?.(rootId, cap, auth.baseUrl, auth.token);
      if (res?.ok) {
        setEmbedProgress((prev) => ({
          ...prev,
          [rootId]: {
            jobId: res.jobId,
            rootId,
            status: "running",
            totalFiles: Number(res.includedFiles) || 0,
            embeddedFiles: 0,
            queuedFiles: Number(res.queuedFiles) || 0,
            estimatedCredits: Number(res.estimatedCredits) || 0,
          },
        }));
      } else {
        setEmbedProgress((prev) => ({
          ...prev,
          [rootId]: { jobId: "error", rootId, status: "failed", totalFiles: 0, embeddedFiles: 0, queuedFiles: 0, estimatedCredits: 0, error: res?.error || "Failed to start" },
        }));
      }
    } catch (e: any) {
      setEmbedProgress((prev) => ({
        ...prev,
        [rootId]: { jobId: "error", rootId, status: "failed", totalFiles: 0, embeddedFiles: 0, queuedFiles: 0, estimatedCredits: 0, error: String(e?.message || e) },
      }));
    }
  };

  const handleSaveExcludes = async (rootId: string) => {
    setSavingExcludes(rootId);
    try {
      await api?.fileIndexSetExcludes?.(rootId, excludeDraft[rootId] ?? "");
    } finally {
      setSavingExcludes(null);
    }
  };

  // Wipe all semantic embeddings so the index starts fresh. Name/keyword search
  // is untouched; affected files just become "Ready to embed" again.
  const handleResetEmbeddings = async (rootId?: string) => {
    const scope = rootId ? "this folder's" : "ALL";
    const ok = await confirmDialog({
      title: "Reset semantic embeddings?",
      message: `This clears ${scope} embeddings and marks those files to be re-embedded. Name search is unaffected. Re-embedding later spends credits again.`,
      confirmLabel: "Reset",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api?.fileIndexClearEmbeddings?.(rootId);
      // Drop any local progress chips for the reset scope.
      setEmbedProgress((prev) => {
        if (!rootId) return {};
        const next = { ...prev };
        delete next[rootId];
        return next;
      });
      await loadData();
    } catch (e) {
      console.error("[FileIndexSettings] Reset embeddings error:", e);
    }
  };

  const handleAddFolder = async () => {
    setAddingFolder(true);
    try {
      const result = await api?.pickFolder?.({ title: "Select folder to index" });
      if (result?.ok && result?.folders?.length > 0) {
        // pickFolder returns either raw path strings or { path } objects depending
        // on the platform helper — normalize to a string before passing on, or the
        // root gets stored as "[object Object]".
        const picked = result.folders[0];
        const folderPath = typeof picked === "string" ? picked : picked?.path;
        if (!folderPath || typeof folderPath !== "string") return;
        // Opt this folder into semantic search (registers/reuses an index root).
        const addResult = await api?.fileIndexAddSemanticFolder?.(folderPath);
        if (addResult?.ok) {
          await loadData();
          if (addResult.root?.id) {
            handleScan(addResult.root.id);
          }
        }
      }
    } catch (e) {
      console.error("[FileIndexSettings] Add folder error:", e);
    } finally {
      setAddingFolder(false);
    }
  };

  const handleRemoveRoot = async (rootId: string) => {
    // "Remove" here means: stop semantically indexing this folder. We un-flag it
    // (keeping the root for name search) and purge its vectors so they no longer
    // show up in meaning search. Optimistic so it feels instant.
    const prevRoots = roots;
    setRoots((rs) => rs.filter((r) => r.id !== rootId));
    if (expandedFolderId === rootId) setExpandedFolderId(null);
    setEmbedProgress((prev) => {
      const next = { ...prev };
      delete next[rootId];
      return next;
    });
    try {
      const result = await api?.fileIndexSetRootSemantic?.(rootId, false);
      if (!result?.ok) {
        setRoots(prevRoots); // restore on failure
        return;
      }
      await api?.fileIndexClearEmbeddings?.(rootId);
      await loadData();
    } catch (e) {
      console.error("[FileIndexSettings] Remove semantic folder error:", e);
      setRoots(prevRoots);
    }
  };

  const handleScan = async (rootId: string) => {
    setScanning(rootId);
    try {
      await api?.fileIndexScan?.(rootId);
      await loadData();
    } catch (e) {
      console.error("[FileIndexSettings] Scan error:", e);
    } finally {
      setScanning(null);
    }
  };

  const handleScanAll = async () => {
    try {
      await api?.fileIndexScanAll?.();
    } catch (e) {
      console.error("[FileIndexSettings] Scan all error:", e);
    }
  };

  const renderSemanticControls = (root: IndexedRoot) => {
    const prog = embedProgress[root.id];
    const panel = embedPanel?.rootId === root.id ? embedPanel : null;
    const active = prog && prog.status !== "succeeded" && prog.status !== "failed";
    // Persisted state from the index — folders embedded in a past session have
    // no live `prog` but still carry vectors.
    const embeddedCount = root.indexed_files ?? 0;
    const readyCount = root.pending_files ?? 0;

    if (active) {
      const pct = prog.totalFiles > 0 ? Math.round((prog.embeddedFiles / prog.totalFiles) * 100) : 0;
      return (
        <div className="p-2.5 rounded-lg bg-primary/5 border border-primary/20 space-y-2">
          <div className="flex items-center gap-2 text-[11px] font-bold text-theme-fg">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
            {EMBED_STATUS_LABEL[prog.status]}
          </div>
          {prog.totalFiles > 0 && (
            <>
              <div className="h-1.5 rounded-full bg-theme-hover overflow-hidden">
                <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
              </div>
              <div className="text-[10px] text-theme-muted">
                {prog.embeddedFiles}/{prog.totalFiles} files
                {prog.queuedFiles > 0 ? ` · ${prog.queuedFiles} queued (cap reached)` : ""}
              </div>
            </>
          )}
          {prog.status === "running" && (
            <div className="text-[10px] text-theme-muted">
              Embedding your files — this usually takes a few seconds.
            </div>
          )}
        </div>
      );
    }

    if (prog?.status === "failed") {
      return (
        <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-red-500/5 border border-red-500/20">
          <div className="text-[11px] text-red-600 truncate">{prog.error || "Embedding failed"}</div>
          <button
            onClick={() => handleMakeSearchable(root.id)}
            className="text-[10px] font-bold text-theme-muted hover:text-theme-fg flex-shrink-0"
          >
            Retry
          </button>
        </div>
      );
    }

    // Searchable — either just finished this session, or already embedded from a
    // prior run (embeddedCount from the index). Show the count + an option to
    // pick up newly-added files.
    if (prog?.status === "succeeded" || (!panel && embeddedCount > 0)) {
      const count = prog?.status === "succeeded" ? Math.max(prog.embeddedFiles, embeddedCount) : embeddedCount;
      return (
        <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
          <div className="flex items-center gap-2 text-[11px] font-bold text-emerald-600">
            <CheckCircle2 className="w-3.5 h-3.5" /> Searchable · {formatNumber(count)} files
          </div>
          <button
            onClick={() => handleMakeSearchable(root.id)}
            className="text-[10px] font-bold text-theme-muted hover:text-theme-fg flex-shrink-0"
          >
            {readyCount > 0 ? `Embed ${formatNumber(readyCount)} new` : "Re-check"}
          </button>
        </div>
      );
    }

    if (panel) {
      if (panel.loading) {
        return (
          <div className="flex items-center gap-2 p-2.5 text-[11px] text-theme-muted">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Estimating cost…
          </div>
        );
      }
      if (panel.error) {
        return (
          <div className="p-2.5 rounded-lg bg-red-500/5 border border-red-500/20 space-y-2">
            <div className="text-[11px] text-red-600">{panel.error}</div>
            <button
              onClick={() => setEmbedPanel(null)}
              className="text-[10px] font-bold text-theme-muted hover:text-theme-fg"
            >
              Dismiss
            </button>
          </div>
        );
      }
      const sliderMax = Math.max(1, panel.unlimited ? Math.max(panel.credits, 10) : Math.floor(panel.balance) || 1);
      return (
        <div className="p-2.5 rounded-lg bg-theme-hover border border-theme space-y-2.5">
          <div className="flex items-center gap-2 text-[11px] text-theme-fg">
            <Coins className="w-3.5 h-3.5 text-primary flex-shrink-0" />
            <span>
              <span className="font-bold">{panel.files.toLocaleString()}</span> files · est.{" "}
              <span className="font-bold">{panel.credits.toLocaleString()}</span> credits
              {panel.unlimited ? "" : ` · ${Math.floor(panel.balance).toLocaleString()} available`}
            </span>
          </div>
          <div>
            <div className="flex items-center justify-between text-[10px] text-theme-muted mb-1">
              <span>Credit cap</span>
              <span className="font-bold text-theme-fg">{panel.cap.toLocaleString()}</span>
            </div>
            <input
              type="range"
              min={1}
              max={sliderMax}
              value={Math.min(panel.cap, sliderMax)}
              onChange={(e) => setEmbedPanel({ ...panel, cap: Number(e.target.value) })}
              className="w-full accent-primary"
            />
            <p className="text-[9px] text-theme-muted mt-1">
              Embeds files up to this credit budget (cheapest first). Anything beyond stays queued for later.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleStartEmbed(root.id)}
              className="flex-1 px-3 py-1.5 rounded-lg bg-primary text-primary-fg text-[11px] font-bold hover:opacity-90"
            >
              Start indexing
            </button>
            <button
              onClick={() => setEmbedPanel(null)}
              className="px-3 py-1.5 rounded-lg border border-theme text-theme-muted text-[11px] font-bold hover:text-theme-fg"
            >
              Cancel
            </button>
          </div>
        </div>
      );
    }

    return (
      <button
        onClick={() => handleMakeSearchable(root.id)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-theme-hover border border-theme text-theme-fg text-[11px] font-bold hover:bg-theme-active transition-all"
      >
        <ScanSearch className="w-3.5 h-3.5 text-primary" /> Make searchable by meaning
      </button>
    );
  };

  if (loading) {
    return (
      <div className="bg-theme-card rounded-theme-card border border-theme p-6 shadow-sm mb-6">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-theme-muted" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-theme-card rounded-theme-card border border-theme p-6 shadow-sm mb-6">
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-stuard text-theme-fg tracking-tight">Search by Meaning</h2>
            <p className="text-sm text-theme-muted font-medium">Embed your folders so you can find files by what they're about — not just their name.</p>
          </div>
          <div className="flex items-center gap-2">
            {semanticRoots.length > 0 && (
              <button
                onClick={handleScanAll}
                disabled={indexingStatus.status === "scanning"}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-theme-button border border-theme text-theme-fg text-[11px] font-bold hover:bg-theme-hover transition-all disabled:opacity-50"
              >
                {indexingStatus.status === "scanning" ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                Refresh
              </button>
            )}
            {embeddedTotal > 0 && (
              <button
                onClick={() => handleResetEmbeddings()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-theme-button border border-theme text-theme-muted text-[11px] font-bold hover:text-red-500 hover:border-red-500/40 transition-all"
                title="Clear all embeddings and start fresh"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Reset
              </button>
            )}
            <button
              onClick={handleAddFolder}
              disabled={addingFolder}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-theme-button bg-primary text-primary-fg text-[11px] font-bold hover:opacity-90 transition-all disabled:opacity-50"
            >
              {addingFolder ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Plus className="w-3.5 h-3.5" />
              )}
              Add Folder
            </button>
          </div>
        </div>

        {/* Compact, calm summary — scoped to the user's semantic folders only. */}
        <div className="flex items-stretch gap-2 rounded-xl border border-theme bg-theme-hover/60 p-1">
          <div className="flex-1 px-3 py-2">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-theme-muted">
              <ScanSearch className="w-3 h-3 text-primary" /> Searchable by meaning
            </div>
            <div className="text-2xl font-bold text-theme-fg font-stuard leading-tight mt-0.5">
              {formatNumber(embeddedTotal)}
            </div>
          </div>
          <div className="w-px bg-theme my-2" />
          <div className="flex-1 px-3 py-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-theme-muted">Folders</div>
            <div className="text-2xl font-bold text-theme-fg font-stuard leading-tight mt-0.5">
              {formatNumber(semanticRoots.length)}
            </div>
          </div>
        </div>
      </div>

      {indexingStatus.status === "scanning" && (
        <div className="mb-4 p-3 bg-blue-500/5 border border-blue-500/20 rounded-xl">
          <div className="flex items-center gap-3">
            <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
            <div className="flex-1">
              <div className="text-sm font-bold text-theme-fg">Scanning folders...</div>
              <div className="text-xs text-theme-muted">
                {indexingStatus.completedRoots}/{indexingStatus.totalRoots} folders
                {indexingStatus.currentPath && (
                  <span className="ml-2 truncate">- {indexingStatus.currentPath}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mb-6">
        <div className="text-[10px] text-theme-muted font-bold uppercase tracking-widest mb-2">
          Your Folders ({semanticRoots.length})
        </div>

        {semanticRoots.length === 0 ? (
          <div className="p-6 bg-theme-hover rounded-xl border border-dashed border-theme text-center">
            <FolderSearch className="w-7 h-7 text-theme-muted mx-auto mb-2" />
            <div className="text-sm text-theme-fg font-medium mb-1">No folders yet</div>
            <div className="text-xs text-theme-muted mb-3">
              Pick a folder to make its files searchable by meaning.
            </div>
            <button
              onClick={handleAddFolder}
              disabled={addingFolder}
              className="flex items-center gap-2 px-4 py-2 mx-auto rounded-xl bg-primary text-primary-fg text-xs font-bold hover:opacity-90 transition-all disabled:opacity-50"
            >
              {addingFolder ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              Add a folder
            </button>
          </div>
        ) : (
          <div className="space-y-1.5">
            {semanticRoots.map((root) => {
              const isExpanded = expandedFolderId === root.id;
              const folderName = root.path.split(/[/\\]/).filter(Boolean).pop() || root.path;
              return (
                <div key={root.id} className="rounded-xl border border-theme overflow-hidden">
                  <div
                    className="flex items-center gap-3 p-2.5 bg-theme-hover group cursor-pointer"
                    onClick={() => setExpandedFolderId(isExpanded ? null : root.id)}
                  >
                    <FolderOpen className="w-4 h-4 text-primary flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-theme-fg truncate text-[13px]">{folderName}</div>
                      <div className="text-[10px] text-theme-muted truncate">{root.path}</div>
                      <div className="flex items-center gap-2 text-[10px] text-theme-muted mt-0.5">
                        <Clock className="w-3 h-3" />
                        <span>{formatTime(root.last_scan_at)}</span>
                        <span className="text-theme/50">|</span>
                        <span className="px-1.5 py-0.5 rounded bg-theme-active text-theme-muted text-[9px] font-bold uppercase">{root.schedule}</span>
                        {(() => {
                          const prog = embedProgress[root.id];
                          const embeddedCount = root.indexed_files ?? 0;
                          // Active job → live progress; failed → failed; otherwise
                          // searchable when the index already holds vectors.
                          const isActive = prog && prog.status !== "succeeded" && prog.status !== "failed";
                          if (isActive) {
                            const pct = prog.totalFiles > 0 ? Math.round((prog.embeddedFiles / prog.totalFiles) * 100) : 0;
                            return (
                              <>
                                <span className="text-theme/50">|</span>
                                <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[9px] font-bold uppercase flex items-center gap-1">
                                  <Loader2 className="w-2.5 h-2.5 animate-spin" /> Embedding{prog.totalFiles > 0 ? ` ${pct}%` : ""}
                                </span>
                              </>
                            );
                          }
                          if (prog?.status === "failed") {
                            return (
                              <>
                                <span className="text-theme/50">|</span>
                                <span className="px-1.5 py-0.5 rounded bg-red-500/10 text-red-600 text-[9px] font-bold uppercase">Failed</span>
                              </>
                            );
                          }
                          if (prog?.status === "succeeded" || embeddedCount > 0) {
                            return (
                              <>
                                <span className="text-theme/50">|</span>
                                <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 text-[9px] font-bold uppercase flex items-center gap-1">
                                  <CheckCircle2 className="w-2.5 h-2.5" /> Searchable
                                </span>
                              </>
                            );
                          }
                          return null;
                        })()}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {/* Seamless one-click entry: expand the folder and jump straight
                          to the embed estimate. Only shown for folders with nothing
                          embedded yet and no active job. */}
                      {!embedProgress[root.id] && (root.indexed_files ?? 0) === 0 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedFolderId(root.id);
                            handleMakeSearchable(root.id);
                          }}
                          className="flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 text-primary text-[10px] font-bold hover:bg-primary/20 transition-colors"
                          title="Embed this folder for meaning search"
                        >
                          <ScanSearch className="w-3 h-3" /> Make searchable
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleScan(root.id);
                        }}
                        disabled={scanning === root.id}
                        className="p-1.5 rounded-md hover:bg-theme-active text-theme-muted hover:text-theme-fg transition-colors"
                        title="Rescan for new files"
                      >
                        {scanning === root.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="w-3.5 h-3.5" />
                        )}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveRoot(root.id);
                        }}
                        className="p-1.5 rounded-md hover:bg-red-500/10 text-theme-muted hover:text-red-500 transition-colors"
                        title="Remove"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                      <ChevronRight className={clsx("w-3.5 h-3.5 text-theme-muted transition-transform", isExpanded && "rotate-90")} />
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="px-3 py-3 bg-theme-card border-t border-theme space-y-3.5">
                      {/* Embedding is the headline action. */}
                      <div>
                        <div className="text-[10px] font-bold text-theme-muted uppercase tracking-widest mb-1.5">
                          Semantic Index
                        </div>
                        {renderSemanticControls(root)}
                      </div>

                      <div>
                        <div className="text-[10px] font-bold text-theme-muted uppercase tracking-widest mb-1.5">
                          Ignore Folders
                        </div>
                        <textarea
                          value={excludeDraft[root.id] ?? root.exclude_globs ?? ""}
                          onChange={(e) =>
                            setExcludeDraft((prev) => ({ ...prev, [root.id]: e.target.value }))
                          }
                          placeholder="node_modules, .cache, vendor (comma or newline separated)"
                          rows={2}
                          className="w-full text-[11px] rounded-lg bg-theme-hover border border-theme p-2 text-theme-fg placeholder:text-theme-muted/60 resize-none"
                        />
                        <div className="flex items-center justify-between gap-2 mt-1.5">
                          <p className="text-[9px] text-theme-muted">
                            Build/cache folders (node_modules, .git, dist…) are skipped automatically.
                          </p>
                          <button
                            onClick={() => handleSaveExcludes(root.id)}
                            disabled={savingExcludes === root.id}
                            className="px-2.5 py-1 rounded-lg border border-theme text-[10px] font-bold text-theme-muted hover:text-theme-fg disabled:opacity-50 flex-shrink-0"
                          >
                            {savingExcludes === root.id ? "Saving…" : "Save"}
                          </button>
                        </div>
                      </div>

                      {/* Re-scan only discovers new/changed files; it never re-embeds
                          what's already done, and changing this no longer wipes the index. */}
                      <div>
                        <div className="text-[10px] font-bold text-theme-muted uppercase tracking-widest mb-1.5">
                          Auto-Rescan For New Files
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {(["off", "hourly", "daily", "weekly"] as const).map((sched) => (
                            <button
                              key={sched}
                              onClick={async () => {
                                try {
                                  await api?.fileIndexUpdateRoot?.(root.id, { schedule: sched });
                                  await loadData();
                                } catch {
                                }
                              }}
                              className={clsx(
                                "px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-all capitalize",
                                root.schedule === sched
                                  ? "bg-primary/10 border-primary/30 text-primary"
                                  : "bg-theme-hover border-theme text-theme-muted hover:text-theme-fg"
                              )}
                            >
                              {sched}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
};

export default FileIndexSettings;
