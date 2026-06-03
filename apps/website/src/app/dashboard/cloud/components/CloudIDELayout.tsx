'use client';

import React, { useCallback, useState } from 'react';
import { clsx } from 'clsx';
import {
  Activity,
  Clock,
  Cpu,
  Globe,
  Server,
} from 'lucide-react';
import { deleteCloudEngine, stopCloudEngine } from '@/lib/cloudApi';
import type { CloudRuntimeView } from '@stuardai/cloud-runtime-ui/shell';
import { CloudMonitoring } from './CloudMonitoring';
import { CloudBilling } from './CloudBilling';
import { CloudVmIntegrations } from './CloudVmIntegrations';
import { CloudVmDeploys } from './CloudVmDeploys';
import { CloudVmPermissions } from './CloudVmPermissions';
import { CloudVmBots } from './CloudVmBots';
import { CloudIDERuntime } from './CloudIDERuntime';
import { CloudIDETerminal } from './CloudIDETerminal';
import { CloudVmSettings } from './CloudVmSettings';
import { CloudIDEExplorer } from './CloudIDEExplorer';

interface CloudIDELayoutProps {
  engine: { status?: string; instance_name?: string; tier?: string; vcpus?: number; ram_gb?: number; zone?: string; disk_size_gb?: number; external_ip?: string; created_at?: string; health_status?: string; last_heartbeat_at?: string };
  onRefresh: () => void | Promise<void>;
}

export function CloudIDELayout({ engine, onRefresh }: CloudIDELayoutProps) {
  const [pauseLoading, setPauseLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const isRunning = engine?.status === 'running';
  const planLabel = String(engine?.tier || 'cloud').replace(/^\w/, (c: string) => c.toUpperCase());
  const machineLabel =
    engine?.vcpus && engine?.ram_gb
      ? `${engine.vcpus} vCPU / ${engine.ram_gb} GB`
      : 'Runtime';

  const handlePause = useCallback(async () => {
    setPauseLoading(true);
    try {
      await stopCloudEngine();
      await onRefresh();
    } catch (e) {
      console.error('Failed to pause engine:', e);
    } finally {
      setPauseLoading(false);
    }
  }, [onRefresh]);

  const handleDelete = useCallback(async () => {
    if (typeof window === 'undefined') return;
    if (!window.confirm('Permanently delete your cloud engine and all its data? This cannot be undone.')) return;
    setDeleteLoading(true);
    try {
      await deleteCloudEngine();
      await onRefresh();
    } catch (e) {
      console.error('Failed to delete engine:', e);
    } finally {
      setDeleteLoading(false);
    }
  }, [onRefresh]);

  const overviewView = (
    <div className="custom-scrollbar h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-4xl space-y-5">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-theme-fg">Engine overview</h2>
          <p className="mt-1 text-sm text-theme-muted">Live status, machine specs, and connectivity.</p>
        </div>

        <div className="grid grid-cols-12 gap-4">
          <div className="dashboard-card col-span-12 p-5 md:col-span-5">
            <h3 className="mb-4 text-[10px] font-semibold uppercase tracking-[0.12em] text-theme-muted">Machine</h3>
            <dl className="space-y-3 text-[13px]">
              <OverviewRow icon={Server} label="Name" value={engine?.instance_name || '—'} mono />
              <OverviewRow icon={Globe} label="Region" value={engine?.zone || '—'} />
              <OverviewRow icon={Cpu} label="Plan" value={planLabel} />
              <OverviewRow icon={Cpu} label="Machine" value={machineLabel} />
              <OverviewRow icon={Server} label="Storage" value={engine?.disk_size_gb ? `${engine.disk_size_gb} GB` : '—'} />
              {engine?.external_ip && <OverviewRow icon={Globe} label="Address" value={engine.external_ip} mono />}
              {engine?.created_at && <OverviewRow icon={Clock} label="Created" value={new Date(engine.created_at).toLocaleDateString()} />}
            </dl>
          </div>

          <div className="dashboard-card col-span-12 p-5 md:col-span-7">
            <h3 className="mb-4 text-[10px] font-semibold uppercase tracking-[0.12em] text-theme-muted">Status</h3>
            <div className="grid grid-cols-2 gap-3">
              <StatusPillSmall
                label="AI Agent"
                connected={(engine as any)?.health_status === 'healthy' || (engine as any)?.healthStatus === 'healthy'}
                detail={
                  (engine as any)?.health_status === 'healthy' || (engine as any)?.healthStatus === 'healthy'
                    ? 'Connected and ready'
                    : 'Not connected'
                }
              />
              <StatusPillSmall
                label="Heartbeat"
                connected={!!engine?.last_heartbeat_at}
                detail={engine?.last_heartbeat_at ? `Last: ${new Date(engine.last_heartbeat_at).toLocaleTimeString()}` : 'Waiting...'}
              />
              <StatusPillSmall
                label="Network"
                connected={!!engine?.external_ip}
                detail={engine?.external_ip || 'Assigning...'}
              />
              <StatusPillSmall
                label="Engine"
                connected={engine?.status === 'running'}
                detail={engine?.status || 'unknown'}
              />
            </div>
            <div className="mt-5 rounded-xl border border-theme/60 bg-theme-hover/20 p-3 text-[11px] text-theme-muted">
              Manage your engine from the top bar. Use the activity bar on the left to switch between chat,
              files, automations, and more. Automations are set up from the Stuard desktop app and run here
              around the clock.
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const viewMap: Omit<Record<CloudRuntimeView, React.ReactNode>, 'chat'> = {
    overview: overviewView,
    monitoring: <div className="custom-scrollbar h-full overflow-y-auto p-6"><CloudMonitoring engine={engine} /></div>,
    billing: <div className="custom-scrollbar h-full overflow-y-auto p-6"><CloudBilling /></div>,
    deploys: <CloudVmDeploys engine={engine} />,
    integrations: <CloudVmIntegrations engine={engine} />,
    permissions: <CloudVmPermissions engine={engine} />,
    bots: <div className="custom-scrollbar h-full overflow-y-auto p-6"><CloudVmBots engine={engine} /></div>,
    automations: <CloudVmDeploys engine={engine} />,
    settings: <CloudVmSettings engine={engine} onRefresh={onRefresh} />,
  };

  return (
    <CloudIDERuntime
      engine={engine}
      onRefresh={onRefresh}
      pauseLoading={pauseLoading}
      deleteLoading={deleteLoading}
      onPause={handlePause}
      onDelete={handleDelete}
      explorer={<CloudIDEExplorer isRunning={isRunning} />}
      terminal={<CloudIDETerminal isRunning={isRunning} />}
      views={viewMap}
    />
  );
}

function OverviewRow({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-theme-muted">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="text-[12px]">{label}</span>
      </div>
      <span
        className={clsx(
          'truncate text-right text-theme-fg',
          mono ? 'font-mono text-[12px]' : 'text-[12px] font-medium',
        )}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

function StatusPillSmall({
  label,
  connected,
  detail,
}: {
  label: string;
  connected: boolean;
  detail?: string;
}) {
  return (
    <div className="rounded-xl border border-theme/60 bg-theme-hover/20 p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-theme-muted">
        <span
          className={clsx(
            'h-1.5 w-1.5 rounded-full',
            connected ? 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.4)]' : 'bg-theme-muted/40',
          )}
        />
        {label}
      </div>
      <div className="mt-1 truncate text-[12px] font-medium text-theme-fg" title={detail}>
        {detail || (connected ? 'Connected' : 'Disconnected')}
      </div>
    </div>
  );
}
