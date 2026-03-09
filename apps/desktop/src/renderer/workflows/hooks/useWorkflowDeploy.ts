import { useCallback, useEffect, useState, useRef } from "react";
import { supabase } from "../../lib/supabaseClient";
import type { DesignerModel } from "../types";

export interface WorkflowDeployStatus {
  deployed: boolean;
  running: boolean;
  triggers: string[];
}

export interface CloudVM {
  id: string;
  instance_name: string;
  zone: string;
  tier: string;
  status: 'provisioning' | 'running' | 'stopped' | 'terminated' | 'error';
  external_ip?: string;
  health_status?: string;
}

export type CloudDeployState = 'idle' | 'deploying' | 'success' | 'error';

interface UseWorkflowDeployProps {
  selectedId: string;
  model: DesignerModel | null;
}

const CLOUD_AI_HTTP = (window as any).__CLOUD_AI_HTTP__ || (import.meta as any).env?.VITE_CLOUD_AI_URL || 'http://127.0.0.1:8082';

async function getAuthToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || null;
  } catch { return null; }
}

async function cloudFetch(path: string, opts?: RequestInit) {
  const token = await getAuthToken();
  const headers: Record<string, string> = { ...(opts?.headers as Record<string, string> || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (opts?.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const resp = await fetch(`${CLOUD_AI_HTTP}${path}`, { ...opts, headers });
  return resp.json();
}

export function useWorkflowDeploy({ selectedId, model }: UseWorkflowDeployProps) {
  const [showDeployPanel, setShowDeployPanel] = useState(false);
  const [deployStatus, setDeployStatus] = useState<WorkflowDeployStatus | null>(null);

  // Cloud VM state
  const [cloudVMs, setCloudVMs] = useState<CloudVM[]>([]);
  const [selectedVM, setSelectedVM] = useState<string | null>(null);
  const [cloudDeployState, setCloudDeployState] = useState<CloudDeployState>('idle');
  const [cloudDeployError, setCloudDeployError] = useState<string | null>(null);
  const [cloudDeployId, setCloudDeployId] = useState<string | null>(null);
  const vmPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch cloud VMs ──────────────────────────────────────────────────────
  const fetchCloudVMs = useCallback(async () => {
    try {
      const data = await cloudFetch('/v1/cloud-engine/status');
      if (data.ok && data.engine) {
        const e = data.engine;
        const vm: CloudVM = {
          id: e.id || e.instanceName || e.instance_name || '',
          instance_name: e.instance_name || e.instanceName || '',
          zone: e.zone || '',
          tier: e.tier || e.machineType || '',
          status: e.status || 'stopped',
          external_ip: e.external_ip || e.externalIp,
          health_status: e.health_status || e.healthStatus,
        };
        setCloudVMs([vm]);
        // Auto-select if only one VM and it's running
        if (vm.status === 'running') {
          setSelectedVM((prev) => prev || vm.id);
        }
      } else {
        setCloudVMs([]);
      }
    } catch {
      // Can't reach cloud-ai — no VMs available
      setCloudVMs([]);
    }
  }, []);

  // Fetch VMs when deploy panel opens
  useEffect(() => {
    if (showDeployPanel) {
      fetchCloudVMs();
      vmPollRef.current = setInterval(fetchCloudVMs, 15_000);
    }
    return () => { if (vmPollRef.current) { clearInterval(vmPollRef.current); vmPollRef.current = null; } };
  }, [showDeployPanel, fetchCloudVMs]);

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

  // ── Local deploy (existing) ──────────────────────────────────────────────
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

  // ── Deploy to Cloud VM ───────────────────────────────────────────────────
  const deployToCloud = useCallback(async (vmId?: string) => {
    if (!selectedId || !model) return;

    const targetVM = vmId || selectedVM;
    if (!targetVM) {
      setCloudDeployError('No VM selected');
      return;
    }

    // Check VM is running
    const vm = cloudVMs.find((v) => v.id === targetVM);
    if (!vm || vm.status !== 'running') {
      setCloudDeployError('Selected VM is not running. Start it first.');
      return;
    }

    setCloudDeployState('deploying');
    setCloudDeployError(null);
    setCloudDeployId(null);

    try {
      // Save workflow first
      await (window as any).desktopAPI?.workflowsSave?.(selectedId, JSON.stringify(model, null, 2));

      // Create cloud deployment via API
      // NOTE: No user tokens are passed to the VM. The VM authenticates with cloud-ai
      // using its own per-VM HMAC secret (VM_TOKEN_SECRET), which cloud-ai verifies
      // server-side to resolve the userId. This prevents token theft if a VM is compromised.
      const res = await cloudFetch('/v1/cloud-engine/deploys', {
        method: 'POST',
        body: JSON.stringify({
          name: model.name || `Workflow ${selectedId}`,
          kind: 'workflow',
          description: model.description || `Deployed from workflow editor`,
          payload: model,
          envVars: {},
          autoRestart: true,
          schedule: model.triggers?.find((t) => t.type === 'schedule.cron')?.args?.cron || undefined,
        }),
      });

      if (res.ok && res.deployment?.status === 'failed') {
        setCloudDeployState('error');
        setCloudDeployError(res.deployment?.error_message || res.error || res.message || 'Deploy failed');
        setCloudDeployId(res.deployment?.id || null);
      } else if (res.ok && res.deployment) {
        setCloudDeployState('success');
        setCloudDeployId(res.deployment.id);
      } else {
        setCloudDeployState('error');
        setCloudDeployError(res.error || res.message || 'Deploy failed');
      }
    } catch (e: any) {
      setCloudDeployState('error');
      setCloudDeployError(e?.message || 'Connection failed');
    }
  }, [selectedId, model, selectedVM, cloudVMs]);

  const resetCloudDeploy = useCallback(() => {
    setCloudDeployState('idle');
    setCloudDeployError(null);
    setCloudDeployId(null);
  }, []);

  return {
    showDeployPanel,
    setShowDeployPanel,
    deployStatus,
    deploy,
    undeploy,
    exportWorkflow,
    // Cloud deploy
    cloudVMs,
    selectedVM,
    setSelectedVM,
    cloudDeployState,
    cloudDeployError,
    cloudDeployId,
    deployToCloud,
    resetCloudDeploy,
  };
}
