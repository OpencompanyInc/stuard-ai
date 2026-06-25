import { useCallback, useEffect, useState } from "react";
import { getValidAccessToken } from "../../auth/authManager";
import { getMarketplaceApi, type MarketplaceUpdate } from "../../utils/cloud";
import { useWorkflowInstall } from "./useWorkflowInstall";

interface UseWorkflowMarketplaceProps {
  /** Currently open workflow id (accepted for API symmetry; not used directly here). */
  selectedId?: string;
  refresh: () => Promise<void>;
  load: (id: string, options?: { forTour?: boolean }) => Promise<boolean>;
}

export function useWorkflowMarketplace({ refresh, load }: UseWorkflowMarketplaceProps) {
  const [showImport, setShowImport] = useState(false);
  const [importJson, setImportJson] = useState("");
  const [importErr, setImportErr] = useState("");

  const [showPublish, setShowPublish] = useState(false);
  const [showMarketplace, setShowMarketplace] = useState(false);
  const [marketplaceSlug, setMarketplaceSlug] = useState<string | undefined>(undefined);
  const [showMyPublished, setShowMyPublished] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<{ id: string; update: MarketplaceUpdate } | null>(null);

  // Shared install orchestration — provisions files, media, and script
  // dependencies up front with a progress modal.
  const { installState, runInstall, dismissInstall } = useWorkflowInstall({ refresh, load });

  useEffect(() => {
    const unsub = (window as any).desktopAPI?.onWorkflowsNavigate?.((d: any) => {
      if (d?.marketplaceSlug) {
        setMarketplaceSlug(d.marketplaceSlug);
        setShowMarketplace(true);
      }
    });

    const params = new URLSearchParams(window.location.search);
    const slug = params.get("marketplaceSlug");
    if (slug) {
      setMarketplaceSlug(slug);
      setShowMarketplace(true);
    }

    return () => {
      try {
        unsub?.();
      } catch {
        // no-op
      }
    };
  }, []);

  const importJsonWorkflow = useCallback(async () => {
    setImportErr("");
    let parsed: any;
    try {
      parsed = JSON.parse(importJson);
    } catch (e: any) {
      setImportErr(e?.message || "Invalid JSON");
      return;
    }
    setShowImport(false);
    setImportJson("");
    try {
      // runInstall provisions files, media, and dependencies with a progress
      // modal (which also surfaces any error), so no extra alert is needed here.
      await runInstall(parsed, { name: parsed?.name });
    } catch {
      // surfaced by the install progress modal
    }
  }, [importJson, runInstall]);

  const importFromMarketplace = useCallback(
    async (spec: any) => {
      // Hand off to the install progress modal; close the browse modal behind it.
      setShowMarketplace(false);
      try {
        await runInstall(spec, { name: spec?.name });
      } catch {
        // surfaced by the install progress modal
      }
    },
    [runInstall]
  );

  const handleUpdateWorkflow = useCallback((id: string, update: MarketplaceUpdate) => {
    setPendingUpdate({ id, update });
  }, []);

  const executeWorkflowUpdate = useCallback(async () => {
    if (!pendingUpdate) throw new Error("No pending update");

    const { id, update } = pendingUpdate;
    const token = await getValidAccessToken();
    const api = getMarketplaceApi(() => token || null);

    const res = await api.getWorkflow(update.slug);
    if (!res.ok || !res.workflow?.spec) {
      throw new Error(res.error || "Failed to download update");
    }

    const spec = res.workflow.spec;
    // Re-provision in place: save the new spec, refresh bundled files/media to
    // match the new version, and pre-install any new dependencies — all behind
    // the install progress modal.
    await runInstall(spec, {
      targetId: id,
      name: update.name,
      marketplaceSlug: update.slug,
      version: update.latestVersion,
      locked: res.workflow.locked || false,
      onInstalled: async () => {
        try {
          await api.download(update.slug);
        } catch {
          // download-count ping is best-effort
        }
      },
    });

    setPendingUpdate(null);

    try {
      (window as any).desktopAPI?.notify?.("Updated!", `${update.name} has been updated to v${update.latestVersion}`);
    } catch {
      // no-op
    }
  }, [pendingUpdate, runInstall]);

  return {
    showImport,
    setShowImport,
    importJson,
    setImportJson,
    importErr,
    setImportErr,
    showPublish,
    setShowPublish,
    showMarketplace,
    setShowMarketplace,
    marketplaceSlug,
    setMarketplaceSlug,
    showMyPublished,
    setShowMyPublished,
    pendingUpdate,
    setPendingUpdate,
    importJsonWorkflow,
    importFromMarketplace,
    handleUpdateWorkflow,
    executeWorkflowUpdate,
    // Install progress (rendered by the workflows view as <InstallProgressModal/>).
    installState,
    dismissInstall,
  };
}
