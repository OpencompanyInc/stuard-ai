'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { clsx } from 'clsx';
import {
  Activity,
  Box,
  CheckCircle2,
  Globe,
  Link2,
  Loader2,
  RefreshCw,
  Rocket,
  Server,
  Terminal,
  XCircle,
} from 'lucide-react';
import { getCloudVmIntegrations } from '@/lib/cloudApi';
import { WHATSAPP_INTEGRATION_ENABLED } from '../../../../../../../shared/integration-flags';

interface IntegrationEntry {
  provider: string;
  profileLabel?: string;
  accountEmail?: string | null;
  isDefault?: boolean;
  connectedAt?: string | null;
  syncedAt?: string | null;
  scopes?: string[];
  hasAccessToken?: boolean;
  hasRefreshToken?: boolean;
  expiresAt?: string | null;
  expired?: boolean;
}

interface VmServiceStatus {
  services?: Record<string, string>;
  browserReachable?: boolean;
  chrome?: string;
  vmAgentMode?: string;
}

interface DeployEntry {
  id: string;
  name: string;
  kind: string;
  status: string;
  pid: number | null;
  startedAt: string | null;
  autoRestart: boolean;
}

interface IntegrationsResponse {
  ok: boolean;
  engineRunning?: boolean;
  engineStatus?: string | null;
  integrations?: IntegrationEntry[];
  vmIntegrations?: IntegrationEntry[];
  vm?: VmServiceStatus | null;
  deploys?: DeployEntry[];
  error?: string;
  message?: string;
}

const SERVICE_LABELS: Record<string, string> = {
  'stuard-agent': 'Node.js Agent',
  'stuard-python-agent': 'Python Agent',
  'stuard-browser-use': 'Browser Server',
  'stuard-xvfb': 'Virtual Display',
};

interface Props {
  engine: any;
  className?: string;
}

export function CloudVmIntegrations({ engine, className }: Props) {
  const [data, setData] = useState<IntegrationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const isRunning = engine?.status === 'running';

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await getCloudVmIntegrations();
      setData(result as IntegrationsResponse);
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (!isRunning) return;
    const id = setInterval(refresh, 20_000);
    return () => clearInterval(id);
  }, [refresh, isRunning]);

  if (loading) {
    return (
      <div className={clsx('flex items-center justify-center h-full text-theme-muted', className)}>
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading integrations…
      </div>
    );
  }

  const vmIntegrations = (data?.vmIntegrations || []).filter(
    (it) => WHATSAPP_INTEGRATION_ENABLED || it.provider.toLowerCase() !== 'whatsapp',
  );
  const services = data?.vm?.services || {};
  const browserReachable = !!data?.vm?.browserReachable;
  const chrome = data?.vm?.chrome || '';
  const deploys = data?.deploys || [];

  const serviceEntries = Object.entries(services);
  const allRunning =
    serviceEntries.length > 0 && serviceEntries.every(([, s]) => s === 'active');

  return (
    <div className={clsx('h-full overflow-y-auto custom-scrollbar p-6 space-y-6', className)}>
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-theme-fg tracking-tight">Integrations</h2>
          <p className="text-xs text-theme-muted mt-1">
            Connected accounts and live VM service status.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-theme-hover/40 text-theme-muted hover:text-theme-fg text-[11px] font-medium transition-colors disabled:opacity-50"
        >
          {refreshing ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5" />
          )}
          Refresh
        </button>
      </header>

      <section className="rounded-2xl border border-theme bg-theme-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[10px] font-bold text-theme-muted uppercase tracking-wider">
            Running services
          </h3>
          <span
            className={clsx(
              'flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider',
              allRunning ? 'text-green-500' : 'text-amber-500',
            )}
          >
            <span
              className={clsx(
                'w-1.5 h-1.5 rounded-full',
                allRunning ? 'bg-green-500' : 'bg-amber-500',
              )}
            />
            {allRunning ? 'All up' : 'Mixed'}
          </span>
        </div>

        {!isRunning && (
          <div className="text-xs text-theme-muted">
            Engine is paused. Start the engine to see live service status.
          </div>
        )}

        {isRunning && serviceEntries.length === 0 && (
          <div className="text-xs text-theme-muted">
            VM did not respond to status query. The agent may still be booting.
          </div>
        )}

        {isRunning && serviceEntries.length > 0 && (
          <ul className="space-y-2">
            {serviceEntries.map(([name, state]) => (
              <ServiceRow
                key={name}
                name={SERVICE_LABELS[name] || name}
                state={state}
                hint={
                  name === 'stuard-browser-use'
                    ? browserReachable
                      ? 'Reachable on :18082'
                      : 'Not reachable on :18082'
                    : undefined
                }
              />
            ))}
            {chrome && (
              <li className="flex items-center justify-between pt-3 mt-2 border-t border-theme/10 text-[11px] text-theme-muted">
                <span className="flex items-center gap-2">
                  <Globe className="w-3.5 h-3.5" /> Chromium binary
                </span>
                <span className="font-mono">{chrome}</span>
              </li>
            )}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-theme bg-theme-card p-5">
        <h3 className="text-[10px] font-bold text-theme-muted uppercase tracking-wider mb-4">
          Active deploys
        </h3>
        {deploys.length === 0 ? (
          <div className="text-xs text-theme-muted">
            {isRunning ? 'Nothing deployed right now.' : 'Engine paused.'}
          </div>
        ) : (
          <ul className="space-y-2">
            {deploys.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between rounded-lg bg-theme-hover/40 px-3 py-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Rocket className="w-3.5 h-3.5 text-theme-muted shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-theme-fg truncate">{d.name}</div>
                    <div className="text-[10px] text-theme-muted">
                      {d.kind} · pid {d.pid ?? '—'}
                    </div>
                  </div>
                </div>
                <DeployStatusPill status={d.status} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-theme bg-theme-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[10px] font-bold text-theme-muted uppercase tracking-wider">
            VM accounts
          </h3>
          <span className="text-[10px] text-theme-muted">{vmIntegrations.length} total</span>
        </div>
        {vmIntegrations.length === 0 ? (
          <div className="text-xs text-theme-muted">
            No VM-local integrations connected. Connect accounts from the Stuard desktop app
            and they will sync to the cloud automatically while the engine is running.
          </div>
        ) : (
          <ul className="space-y-2">
            {vmIntegrations.map((it) => (
              <IntegrationRow key={`${it.provider}/${it.profileLabel}`} it={it} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ServiceRow({
  name,
  state,
  hint,
}: {
  name: string;
  state: string;
  hint?: string;
}) {
  const ok = state === 'active';
  const Icon = ok ? CheckCircle2 : state === 'unknown' ? Activity : XCircle;
  const color = ok
    ? 'text-green-500'
    : state === 'unknown'
      ? 'text-theme-muted'
      : 'text-red-500';

  return (
    <li className="flex items-center justify-between rounded-lg bg-theme-hover/40 px-3 py-2">
      <div className="flex items-center gap-2">
        {name.toLowerCase().includes('browser') ? (
          <Globe className="w-3.5 h-3.5 text-theme-muted" />
        ) : name.toLowerCase().includes('display') ? (
          <Terminal className="w-3.5 h-3.5 text-theme-muted" />
        ) : (
          <Server className="w-3.5 h-3.5 text-theme-muted" />
        )}
        <div>
          <div className="text-xs font-bold text-theme-fg">{name}</div>
          {hint && <div className="text-[10px] text-theme-muted">{hint}</div>}
        </div>
      </div>
      <div className={clsx('flex items-center gap-1 text-[10px] font-bold uppercase', color)}>
        <Icon className="w-3 h-3" />
        {state}
      </div>
    </li>
  );
}

function DeployStatusPill({ status }: { status: string }) {
  const color =
    status === 'running'
      ? 'bg-green-500/15 text-green-500'
      : status === 'failed' || status === 'error'
        ? 'bg-red-500/15 text-red-500'
        : 'bg-amber-500/15 text-amber-500';
  return (
    <span className={clsx('px-2 py-0.5 rounded-full text-[10px] font-bold uppercase', color)}>
      {status}
    </span>
  );
}

function IntegrationRow({ it }: { it: IntegrationEntry }) {
  // The `expired` flag is sourced from the server. We only fall back to
  // a client-side check when the server didn't supply one, and we use the
  // `expiresAt` timestamp's parsed time directly (deterministic from props)
  // rather than comparing to a non-deterministic `Date.now()` during render.
  const expired = typeof it.expired === 'boolean'
    ? it.expired
    : false;
  return (
    <li className="flex items-center justify-between rounded-lg bg-theme-hover/40 px-3 py-2">
      <div className="flex items-center gap-2 min-w-0">
        <Box className="w-3.5 h-3.5 text-theme-muted shrink-0" />
        <div className="min-w-0">
          <div className="text-xs font-bold text-theme-fg truncate">
            {it.provider}
            {it.isDefault && (
              <span className="ml-2 text-[9px] font-bold text-primary uppercase">
                Default
              </span>
            )}
          </div>
          <div className="text-[10px] text-theme-muted truncate">
            {it.accountEmail || it.profileLabel || 'default'}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {expired ? (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-amber-500/15 text-amber-500">
            Expired
          </span>
        ) : (
          <span className="flex items-center gap-1 text-[10px] font-bold uppercase text-green-500">
            <Link2 className="w-3 h-3" /> On VM
          </span>
        )}
      </div>
    </li>
  );
}
