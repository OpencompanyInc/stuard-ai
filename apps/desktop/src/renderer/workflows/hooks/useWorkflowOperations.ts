/**
 * useWorkflowOperations - Hook for workflow CRUD and execution operations
 */
import { useState, useCallback, useEffect } from "react";
import type { DesignerModel, WorkspaceFileEntry } from "../types";
import { getValidAccessToken } from "../../auth/authManager";

export interface WorkspaceInfo {
  workspacePath: string;
  subdirs: string[];
  files: WorkspaceFileEntry[];
}

interface UseWorkflowOperationsProps {
  refresh: () => Promise<void>;
}

export function useWorkflowOperations({ refresh }: UseWorkflowOperationsProps) {
  const [selectedId, setSelectedId] = useState("");
  const [model, setModel] = useState<DesignerModel | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [runningIds, setRunningIds] = useState<Record<string, boolean>>({});
  const [showDeployPanel, setShowDeployPanel] = useState(false);
  const [deployStatus, setDeployStatus] = useState<{ deployed: boolean; running: boolean; triggers: string[] } | null>(null);
  const [workspaceInfo, setWorkspaceInfo] = useState<WorkspaceInfo | null>(null);

  const refreshWorkspace = useCallback(async (id?: string) => {
    const fid = id || selectedId;
    if (!fid) { setWorkspaceInfo(null); return; }
    try {
      const res = await (window as any).desktopAPI?.workflowsGetWorkspaceInfo?.(fid);
      if (res?.ok) {
        setWorkspaceInfo({ workspacePath: res.workspacePath, subdirs: res.subdirs, files: res.files });
      } else {
        setWorkspaceInfo(null);
      }
    } catch { setWorkspaceInfo(null); }
  }, [selectedId]);

  const load = useCallback(async (id: string, onLoadSuccess?: () => void) => {
    if (!id) return;
    const res = await (window as any).desktopAPI?.workflowsRead?.(id);
    if (res?.ok) {
      setSelectedId(res.id);
      try { setModel(JSON.parse(res.content || '{}')); } catch { setModel(null); }
      setDirty(false);
      onLoadSuccess?.();
      // Load workspace info if this is a workspace-based workflow
      if (res.isWorkspace) {
        const wsRes = await (window as any).desktopAPI?.workflowsGetWorkspaceInfo?.(res.id);
        if (wsRes?.ok) setWorkspaceInfo({ workspacePath: wsRes.workspacePath, subdirs: wsRes.subdirs, files: wsRes.files });
        else setWorkspaceInfo(null);
      } else {
        setWorkspaceInfo(null);
      }
    }
  }, []);

  const save = useCallback(async () => {
    if (!selectedId || !model) return;
    setSaving(true);
    const res = await (window as any).desktopAPI?.workflowsSave?.(selectedId, JSON.stringify(model, null, 2));
    if (res?.ok) { setDirty(false); await refresh(); } else alert(res?.error || 'Save failed');
    setSaving(false);
  }, [selectedId, model, refresh]);

  const create = useCallback(async () => {
    const safe = `flow_${Math.random().toString(36).slice(2, 10)}`;
    const skeleton: DesignerModel = {
      id: safe,
      name: "Hello World Starter",
      version: "1",
      triggers: [{ id: `trig_0`, type: 'manual', label: 'Manual Trigger', args: {}, position: { x: 60, y: 50 } }],
      nodes: [
        {
          id: `step_welcome`,
          type: 'local.tool',
          tool: 'send_notification',
          label: 'Show Welcome Notification',
          args: { title: 'Hello from Stuard', body: 'Your first workflow is running.', severity: 'success' },
          fallbackTo: '',
          position: { x: 60, y: 190 }
        },
        {
          id: `step_now`,
          type: 'local.tool',
          tool: 'get_datetime',
          label: 'Get Current Time',
          args: { format: 'YYYY-MM-DD HH:mm:ss' },
          fallbackTo: '',
          position: { x: 60, y: 330 }
        },
        {
          id: `step_clipboard`,
          type: 'local.tool',
          tool: 'set_clipboard_content',
          label: 'Copy Hello Message',
          args: { text: 'Hello World from Stuard! Ran at {{step_now.formatted}}' },
          fallbackTo: '',
          position: { x: 60, y: 470 }
        },
        {
          id: `step_log`,
          type: 'local.tool',
          tool: 'log',
          label: 'Log Completion',
          args: { message: 'Done! Message copied to clipboard at {{step_now.formatted}}' },
          fallbackTo: '',
          position: { x: 60, y: 610 }
        }
      ],
      wires: [
        { from: 'trig_0', to: 'step_welcome' },
        { from: 'step_welcome', to: 'step_now' },
        { from: 'step_now', to: 'step_clipboard' },
        { from: 'step_clipboard', to: 'step_log' }
      ],
    };
    try {
      const res = await (window as any).desktopAPI?.workflowsSave?.(safe, JSON.stringify(skeleton, null, 2));
      if (res?.ok) {
        await refresh();
        await load(safe);
      } else {
        alert(res?.error || 'Failed to create workflow');
      }
    } catch (e: any) {
      alert(e?.message || 'Failed to create workflow');
    }
  }, [refresh, load]);

  const del = useCallback(async () => {
    if (!selectedId || !confirm(`Delete "${selectedId}"?`)) return;
    await (window as any).desktopAPI?.workflowsDelete?.(selectedId);
    setSelectedId("");
    setModel(null);
    await refresh();
  }, [selectedId, refresh]);

  const run = useCallback(async () => {
    if (!selectedId) return;
    setRunningIds(p => ({ ...p, [selectedId]: true }));
    try {
      // Get access token for cloud tool authentication
      const accessToken = await getValidAccessToken() || undefined;
      const res = await (window as any).desktopAPI?.workflowsRun?.(selectedId, undefined, { accessToken });
      setRunningIds(p => ({ ...p, [selectedId]: false }));
      if (!res?.ok) alert(res?.error || 'Run failed');
    } catch (e: any) {
      setRunningIds(p => ({ ...p, [selectedId]: false }));
      alert(e?.message || 'Run failed');
    }
  }, [selectedId]);

  const stop = useCallback(async () => {
    if (!selectedId) return;
    await (window as any).desktopAPI?.workflowsStop?.(selectedId);
    setRunningIds(p => ({ ...p, [selectedId]: false }));
  }, [selectedId]);

  const fetchDeployStatus = useCallback(async () => {
    if (!selectedId) return;
    try {
      const status = await (window as any).desktopAPI?.workflowsGetDeployStatus?.(selectedId);
      if (status?.ok) setDeployStatus({ deployed: status.deployed, running: status.running, triggers: status.triggers || [] });
    } catch {}
  }, [selectedId]);

  useEffect(() => { if (selectedId) fetchDeployStatus(); }, [selectedId, fetchDeployStatus]);

  const deploy = useCallback(async () => {
    if (!selectedId || !model) return;
    try {
      await (window as any).desktopAPI?.workflowsSave?.(selectedId, JSON.stringify(model, null, 2));
      const res = await (window as any).desktopAPI?.workflowsDeploy?.(selectedId);
      if (res?.ok) {
        setDeployStatus({ deployed: true, running: true, triggers: model.triggers?.map(t => t.type) || [] });
        setShowDeployPanel(false);
      } else {
        alert(res?.error || 'Deploy failed');
      }
    } catch (e: any) { alert(e?.message || 'Failed'); }
  }, [selectedId, model]);

  const undeploy = useCallback(async () => {
    if (!selectedId) return;
    try {
      const res = await (window as any).desktopAPI?.workflowsUndeploy?.(selectedId);
      if (res?.ok) {
        setDeployStatus({ deployed: false, running: false, triggers: model?.triggers?.map(t => t.type) || [] });
      }
    } catch (e: any) { alert(e?.message || 'Failed'); }
  }, [selectedId, model]);

  const exportWorkflow = useCallback(async () => {
    if (!selectedId) return;
    try {
      const res = await (window as any).desktopAPI?.workflowsExport?.(selectedId);
      if (res?.ok && res?.path) {
        await (window as any).desktopAPI?.showItemInFolder?.(res.path);
      } else {
        alert(res?.error || 'Export failed');
      }
    } catch (e: any) {
      alert(e?.message || 'Export failed');
    }
  }, [selectedId]);

  const updateModel = useCallback((m: DesignerModel) => {
    setModel(m);
    setDirty(true);
  }, []);

  return {
    selectedId, setSelectedId,
    model, setModel,
    dirty, setDirty,
    saving,
    runningIds, setRunningIds,
    showDeployPanel, setShowDeployPanel,
    deployStatus,
    workspaceInfo, refreshWorkspace,
    load, save, create, del, run, stop, deploy, undeploy, exportWorkflow, updateModel
  };
}
