import { useCallback, useEffect, useState } from "react";
import { getValidAccessToken } from "../../auth/authManager";
import { getMarketplaceApi, type MarketplaceUpdate } from "../../utils/cloud";
import { specToDesignerModel } from "../utils/conversions";

interface UseWorkflowMarketplaceProps {
  selectedId: string;
  refresh: () => Promise<void>;
  load: (id: string) => Promise<void>;
}

export function useWorkflowMarketplace({ selectedId, refresh, load }: UseWorkflowMarketplaceProps) {
  const [showImport, setShowImport] = useState(false);
  const [importJson, setImportJson] = useState("");
  const [importErr, setImportErr] = useState("");

  const [showPublish, setShowPublish] = useState(false);
  const [showMarketplace, setShowMarketplace] = useState(false);
  const [marketplaceSlug, setMarketplaceSlug] = useState<string | undefined>(undefined);
  const [showMyPublished, setShowMyPublished] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<{ id: string; update: MarketplaceUpdate } | null>(null);

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
    try {
      const d = JSON.parse(importJson);
      const newId = d.id || "flow_" + Date.now().toString(36);
      const m = specToDesignerModel({ ...d, id: newId });
      await (window as any).desktopAPI?.workflowsSave?.(newId, JSON.stringify(m, null, 2));
      await refresh();
      await load(newId);
      setShowImport(false);
      setImportJson("");
    } catch (e: any) {
      setImportErr(e?.message || "Invalid JSON");
    }
  }, [importJson, load, refresh]);

  const importFromMarketplace = useCallback(
    async (spec: any) => {
      try {
        const newId = spec.id || "flow_" + Date.now().toString(36);
        const m = specToDesignerModel({ ...spec, id: newId });
        await (window as any).desktopAPI?.workflowsSave?.(newId, JSON.stringify(m, null, 2));
        await refresh();
        await load(newId);
      } catch (e: any) {
        alert(e?.message || "Import failed");
      }
    },
    [load, refresh]
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
    const newModel = specToDesignerModel({
      ...spec,
      id,
      marketplaceSlug: update.slug,
      version: update.latestVersion,
      locked: res.workflow.locked || false,
    });

    await (window as any).desktopAPI?.workflowsSave?.(id, JSON.stringify(newModel, null, 2));

    try {
      await api.download(update.slug);
    } catch {
      // no-op
    }

    await refresh();
    if (selectedId === id) {
      await load(id);
    }

    setPendingUpdate(null);

    try {
      (window as any).desktopAPI?.notify?.("Updated!", `${update.name} has been updated to v${update.latestVersion}`);
    } catch {
      // no-op
    }
  }, [load, pendingUpdate, refresh, selectedId]);

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
  };
}
