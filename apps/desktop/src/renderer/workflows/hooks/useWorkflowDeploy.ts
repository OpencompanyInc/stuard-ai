import { useCallback, useEffect, useState } from "react";
import type { DesignerModel } from "../types";

export interface WorkflowDeployStatus {
  deployed: boolean;
  running: boolean;
  triggers: string[];
}

interface UseWorkflowDeployProps {
  selectedId: string;
  model: DesignerModel | null;
}

export function useWorkflowDeploy({ selectedId, model }: UseWorkflowDeployProps) {
  const [showDeployPanel, setShowDeployPanel] = useState(false);
  const [deployStatus, setDeployStatus] = useState<WorkflowDeployStatus | null>(null);

  const fetchDeployStatus = useCallback(async () => {
    if (!selectedId) return;
    try {
      const status = await (window as any).desktopAPI?.workflowsGetDeployStatus?.(selectedId);
      if (status?.ok) {
        setDeployStatus({ deployed: status.deployed, running: status.running, triggers: status.triggers || [] });
      }
    } catch {
      // no-op
    }
  }, [selectedId]);

  useEffect(() => {
    if (selectedId) fetchDeployStatus();
  }, [fetchDeployStatus, selectedId]);

  const deploy = useCallback(async () => {
    if (!selectedId || !model) return;
    try {
      await (window as any).desktopAPI?.workflowsSave?.(selectedId, JSON.stringify(model, null, 2));
      const res = await (window as any).desktopAPI?.workflowsDeploy?.(selectedId);
      if (res?.ok) {
        setDeployStatus({ deployed: true, running: true, triggers: model.triggers?.map((t) => t.type) || [] });
        setShowDeployPanel(false);
      } else {
        alert(res?.error || "Deploy failed");
      }
    } catch (e: any) {
      alert(e?.message || "Failed");
    }
  }, [model, selectedId]);

  const undeploy = useCallback(async () => {
    if (!selectedId) return;
    try {
      const res = await (window as any).desktopAPI?.workflowsUndeploy?.(selectedId);
      if (res?.ok) {
        setDeployStatus({ deployed: false, running: false, triggers: model?.triggers?.map((t) => t.type) || [] });
      }
    } catch (e: any) {
      alert(e?.message || "Failed");
    }
  }, [model, selectedId]);

  const exportWorkflow = useCallback(async () => {
    if (!selectedId) return;
    try {
      const res = await (window as any).desktopAPI?.workflowsExport?.(selectedId);
      if (res?.ok && res?.path) {
        await (window as any).desktopAPI?.showItemInFolder?.(res.path);
      } else {
        alert(res?.error || "Export failed");
      }
    } catch (e: any) {
      alert(e?.message || "Export failed");
    }
  }, [selectedId]);

  return {
    showDeployPanel,
    setShowDeployPanel,
    deployStatus,
    deploy,
    undeploy,
    exportWorkflow,
  };
}
