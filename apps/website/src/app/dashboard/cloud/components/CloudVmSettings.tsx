'use client';

import React, { useCallback, useState } from 'react';
import { clsx } from 'clsx';
import {
  AlertTriangle,
  Clock,
  Cpu,
  ExternalLink,
  Globe,
  HardDrive,
  Loader2,
  PowerOff,
  RefreshCw,
  Server,
  Settings as SettingsIcon,
  Trash2,
} from 'lucide-react';
import { deleteCloudEngine, stopCloudEngine } from '@/lib/cloudApi';

interface Props {
  engine: any;
  onRefresh?: () => void | Promise<void>;
  className?: string;
}

export function CloudVmSettings({ engine, onRefresh, className }: Props) {
  const [pauseLoading, setPauseLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const handlePause = useCallback(async () => {
    if (typeof window !== 'undefined' && !window.confirm('Pause your cloud engine? It will stop billing for compute time.')) return;
    setPauseLoading(true);
    try {
      await stopCloudEngine();
      await onRefresh?.();
    } finally {
      setPauseLoading(false);
    }
  }, [onRefresh]);

  const handleDelete = useCallback(async () => {
    if (typeof window === 'undefined') return;
    const confirmed = window.confirm(
      'Permanently delete your cloud engine?\n\nThis will destroy the VM, all of its files and any running deployments. This cannot be undone.',
    );
    if (!confirmed) return;
    setDeleteLoading(true);
    try {
      await deleteCloudEngine();
      await onRefresh?.();
    } finally {
      setDeleteLoading(false);
    }
  }, [onRefresh]);

  const planLabel = String(engine?.tier || 'cloud').replace(/^\w/, (c: string) => c.toUpperCase());
  const machineLabel =
    engine?.vcpus && engine?.ram_gb
      ? `${engine.vcpus} vCPU · ${engine.ram_gb} GB RAM`
      : '—';

  return (
    <div className={clsx('h-full overflow-y-auto custom-scrollbar p-6 space-y-6', className)}>
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-theme-fg tracking-tight">VM Settings</h2>
          <p className="text-xs text-theme-muted mt-1 max-w-lg">
            Basic information and controls for your Cloud Engine.
          </p>
        </div>
        {onRefresh && (
          <button
            type="button"
            onClick={() => void onRefresh?.()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-theme-hover/40 text-theme-muted hover:text-theme-fg text-[11px] font-medium transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        )}
      </header>

      <section className="rounded-2xl border border-theme bg-theme-card p-5">
        <h3 className="text-[10px] font-bold text-theme-muted uppercase tracking-wider mb-4">
          Machine
        </h3>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-[13px]">
          <Row icon={Server} label="Name" value={engine?.instance_name || '—'} mono />
          <Row icon={Globe} label="Region" value={engine?.zone || '—'} />
          <Row icon={Cpu} label="Plan" value={planLabel} />
          <Row icon={Cpu} label="Compute" value={machineLabel} />
          <Row icon={HardDrive} label="Storage" value={engine?.disk_size_gb ? `${engine.disk_size_gb} GB` : '—'} />
          {engine?.external_ip && <Row icon={Globe} label="Address" value={engine.external_ip} mono />}
          {engine?.created_at && (
            <Row icon={Clock} label="Created" value={new Date(engine.created_at).toLocaleString()} />
          )}
        </dl>
      </section>

      <section className="rounded-2xl border border-theme bg-theme-card p-5">
        <h3 className="text-[10px] font-bold text-theme-muted uppercase tracking-wider mb-4">
          Advanced configuration
        </h3>
        <p className="text-[13px] text-theme-muted">
          Memory sync rules, browser profiles, model preferences and bot definitions live in the
          Stuard desktop app. Changes there sync to the VM automatically while it&apos;s running.
        </p>
        <a
          href="/download"
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-theme-fg px-4 py-2 text-[12px] font-semibold text-theme-bg transition hover:opacity-90"
          style={{ background: 'var(--ide-text)', color: 'var(--ide-bg)' }}
        >
          <SettingsIcon className="w-4 h-4" />
          Open Stuard Desktop
          <ExternalLink className="w-3.5 h-3.5 opacity-70" />
        </a>
      </section>

      <section className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0 space-y-3">
            <div>
              <h3 className="text-sm font-bold text-amber-700 dark:text-amber-400">Danger zone</h3>
              <p className="text-[12px] text-theme-muted mt-0.5">
                Pausing keeps your data and stops compute billing. Deleting destroys your VM
                and all of its files permanently.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handlePause()}
                disabled={pauseLoading || engine?.status !== 'running'}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[12px] font-bold hover:bg-amber-500/20 transition-colors disabled:opacity-40"
              >
                {pauseLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PowerOff className="w-3.5 h-3.5" />}
                Pause Engine
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={deleteLoading}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 text-red-500 text-[12px] font-bold hover:bg-red-500/20 transition-colors disabled:opacity-40"
              >
                {deleteLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                Delete Engine
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon: any;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 min-w-0">
      <div className="flex items-center gap-2 text-theme-muted shrink-0">
        <Icon className="w-3.5 h-3.5" />
        <span>{label}</span>
      </div>
      <span
        className={clsx('truncate text-right text-theme-fg', mono ? 'font-mono text-[12px]' : 'font-medium')}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}
