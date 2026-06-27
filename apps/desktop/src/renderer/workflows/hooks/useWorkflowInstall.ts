import { useCallback, useState } from "react";
import { specToDesignerModel } from "../utils/conversions";
import {
  unpackWorkspaceBundle,
  stripPublishMeta,
  bundleFileCount,
} from "../utils/workspaceBundle";
import {
  collectWorkflowDependencies,
  hasInstallableDependencies,
  summarizeDependencies,
} from "@stuardai/workflow-core/dependencies";

/**
 * Drives a marketplace install end-to-end with a determinate progress UI:
 * save the workflow → unpack its files & media → pre-install its script
 * dependencies (pip) → load it. Everything the workflow needs is provisioned up
 * front so its first run doesn't stall on a lazy pip install. A dependency that
 * fails to install is reported as a warning but does NOT block the install — the
 * runtime's lazy install remains the fallback.
 *
 * Used by the marketplace import, the "my published" update flow, and onboarding
 * featured installs so all three share one provisioning path + progress modal.
 */

export type InstallStepStatus = "pending" | "active" | "done" | "failed";

export interface InstallStep {
  key: string;
  label: string;
  status: InstallStepStatus;
  detail?: string;
}

export type InstallPhase = "idle" | "running" | "done" | "error";

export interface InstallState {
  phase: InstallPhase;
  name: string;
  steps: InstallStep[];
  /** 0..1 for the progress bar. */
  progress: number;
  warnings: string[];
  error?: string;
  installedId?: string;
}

export interface InstallSpecOptions {
  /** Existing workflow id to update in place; omit to create a new workflow. */
  targetId?: string;
  name?: string;
  marketplaceSlug?: string;
  version?: string;
  locked?: boolean;
  /** Ran after save+deps, before refresh/load (e.g. to record a download). */
  onInstalled?: (id: string) => Promise<void> | void;
}

const IDLE: InstallState = { phase: "idle", name: "", steps: [], progress: 0, warnings: [] };

function trimErr(msg: string): string {
  const s = String(msg || "").trim().replace(/\s+/g, " ");
  return s.length > 140 ? s.slice(0, 137) + "…" : s;
}

export function useWorkflowInstall(deps: {
  refresh: () => Promise<void>;
  load: (id: string) => Promise<boolean>;
}) {
  const { refresh, load } = deps;
  const [installState, setInstallState] = useState<InstallState>(IDLE);

  const dismissInstall = useCallback(() => setInstallState(IDLE), []);

  const runInstall = useCallback(
    async (spec: any, opts: InstallSpecOptions = {}): Promise<string> => {
      const api = (window as any).desktopAPI;
      const newId = opts.targetId || spec?.id || "flow_" + Date.now().toString(36);
      const name = opts.name || spec?.name || "workflow";

      const fileCount = bundleFileCount(spec);
      const wfDeps = collectWorkflowDependencies(spec);
      const hasDeps = hasInstallableDependencies(wfDeps);

      const steps: InstallStep[] = [{ key: "save", label: "Add to your workspace", status: "pending" }];
      if (fileCount > 0) steps.push({ key: "files", label: "Install files & media", status: "pending" });
      if (hasDeps)
        steps.push({ key: "deps", label: "Install dependencies", status: "pending", detail: summarizeDependencies(wfDeps) });
      steps.push({ key: "finalize", label: "Finish up", status: "pending" });

      const weights: Record<string, number> = { save: 1, files: Math.max(1, fileCount), deps: 2, finalize: 1 };
      const totalUnits = steps.reduce((sum, s) => sum + (weights[s.key] || 1), 0);
      let completed = 0;
      const warnings: string[] = [];

      const setStep = (key: string, status: InstallStepStatus, detail?: string) => {
        const s = steps.find((x) => x.key === key);
        if (s) {
          s.status = status;
          if (detail !== undefined) s.detail = detail;
        }
      };
      const commit = (phase: InstallPhase = "running", extra?: Partial<InstallState>) =>
        setInstallState({
          phase,
          name,
          steps: steps.map((s) => ({ ...s })),
          progress: Math.min(1, completed / totalUnits),
          warnings: [...warnings],
          ...extra,
        });

      commit();

      try {
        // 1. Save the workflow into the local workspace.
        setStep("save", "active");
        commit();
        const model = specToDesignerModel(
          stripPublishMeta({
            ...spec,
            id: newId,
            ...(opts.marketplaceSlug ? { marketplaceSlug: opts.marketplaceSlug } : {}),
            ...(opts.version ? { version: opts.version } : {}),
            ...(opts.locked !== undefined ? { locked: opts.locked } : {}),
          }),
        );
        await api?.workflowsSave?.(newId, JSON.stringify(model, null, 2));
        completed += weights.save;
        setStep("save", "done");
        commit();

        // 2. Unpack bundled workspace files + media (per-file progress).
        if (fileCount > 0) {
          setStep("files", "active");
          commit();
          const base = completed;
          await unpackWorkspaceBundle(newId, spec, {
            onProgress: (done, total, label) => {
              completed = base + (total > 0 ? (done / total) * weights.files : weights.files);
              const fname = String(label || "").split("/").pop() || "";
              setStep("files", "active", `${done}/${total}  ${fname}`);
              commit();
            },
          });
          completed = base + weights.files;
          setStep("files", "done", `${fileCount} file${fileCount === 1 ? "" : "s"}`);
          commit();
        }

        // 3. Pre-install script dependencies (pip). Warn + continue on failure.
        if (hasDeps) {
          setStep("deps", "active");
          commit();
          try {
            const res = await api?.pythonInstall?.({
              packages: wfDeps.python.packages,
              requirementsTxt: wfDeps.python.requirementsTxt,
            });
            if (res && res.ok) {
              setStep("deps", "done", summarizeDependencies(wfDeps) || "ready");
            } else {
              const msg = trimErr(res?.error || "Some dependencies could not be installed");
              warnings.push(`Dependencies: ${msg}`);
              setStep("deps", "failed", msg);
            }
          } catch (e: any) {
            const msg = trimErr(e?.message || "Dependency install failed");
            warnings.push(`Dependencies: ${msg}`);
            setStep("deps", "failed", msg);
          }
          completed += weights.deps;
          commit();
        }

        // 4. Finalize — refresh the list and open the workflow.
        setStep("finalize", "active");
        commit();
        if (opts.onInstalled) {
          try {
            await opts.onInstalled(newId);
          } catch {
            // a failed download-count ping shouldn't fail the install
          }
        }
        await refresh();
        await load(newId);
        completed += weights.finalize;
        setStep("finalize", "done");
        commit("done", { progress: 1, installedId: newId });
        return newId;
      } catch (e: any) {
        commit("error", { error: trimErr(e?.message || "Install failed") });
        throw e;
      }
    },
    [refresh, load],
  );

  return { installState, runInstall, dismissInstall };
}
