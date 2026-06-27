'use client';

/**
 * Cloud VM — Automations view (website dashboard).
 *
 * Thin wrapper that loads the user's cloud deployments and renders the shared
 * `CloudAutomationsPanel` (also used by the desktop app) so the experience is
 * identical everywhere: plain-language status, run history, readable activity,
 * latest output, and clear errors.
 *
 * Deployments are created from the Stuard desktop app — the website is a
 * view-and-manage surface (start / pause / delete / inspect activity).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CloudAutomationsPanel,
  type AutomationDeployment,
} from '@stuardai/cloud-runtime-ui';
import {
  deleteCloudDeployment,
  getCloudDeploymentLogs,
  listCloudDeployments,
  restartCloudDeployment,
  stopCloudDeployment,
  type CloudDeployment,
  type CloudDeployKind,
} from '@/lib/cloudApi';

function useDeployments(engine: any) {
  const [deployments, setDeployments] = useState<CloudDeployment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRunning = engine?.status === 'running';
  const pollRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    if (!isRunning) {
      setDeployments([]);
      setLoading(false);
      return;
    }
    setRefreshing(true);
    try {
      const res = await listCloudDeployments();
      if (res.ok) {
        setDeployments(res.deployments || []);
        setError(null);
      } else {
        setError(res.error || 'Failed to load automations');
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load automations');
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, [isRunning]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!isRunning) return;
    pollRef.current = window.setInterval(() => void refresh(), 15_000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [refresh, isRunning]);

  return { deployments, loading, refreshing, error, refresh, isRunning };
}

interface CloudVmDeploysProps {
  engine: any;
  /** Restrict listing to specific kinds. Default shows everything. */
  filterKinds?: CloudDeployKind[];
  title?: string;
  subtitle?: string;
  emptyHint?: string;
  className?: string;
}

export function CloudVmDeploys({
  engine,
  filterKinds,
  title = 'Automations',
  subtitle = 'Tasks that run in the cloud around the clock — even when your computer is off.',
  emptyHint = 'Set up an automation in the Stuard desktop app and it will appear here, where you can see exactly when it runs and how it’s doing.',
  className,
}: CloudVmDeploysProps) {
  const { deployments, loading, refreshing, error, refresh, isRunning } = useDeployments(engine);

  const visible = useMemo<AutomationDeployment[]>(() => {
    const list = !filterKinds || filterKinds.length === 0
      ? deployments
      : deployments.filter((d) => filterKinds.includes(d.kind));
    return list as unknown as AutomationDeployment[];
  }, [deployments, filterKinds]);

  const getLogs = useCallback(async (id: string, lines = 400): Promise<string> => {
    const res = await getCloudDeploymentLogs(id, lines);
    if (res.ok) return res.logs || '';
    return `(couldn’t load activity — ${res.error || 'please try again'})`;
  }, []);

  return (
    <CloudAutomationsPanel
      className={className ? `${className} p-6` : 'p-6'}
      deployments={visible}
      loading={loading}
      refreshing={refreshing}
      error={error}
      isRunning={isRunning}
      title={title}
      subtitle={subtitle}
      emptyHint={emptyHint}
      onRefresh={() => void refresh()}
      onStart={async (id) => { await restartCloudDeployment(id); await refresh(); }}
      onStop={async (id) => { await stopCloudDeployment(id); await refresh(); }}
      onDelete={async (id, name) => {
        if (typeof window !== 'undefined' && !window.confirm(`Delete "${name}"? This can’t be undone.`)) return;
        await deleteCloudDeployment(id);
        await refresh();
      }}
      getLogs={getLogs}
    />
  );
}
