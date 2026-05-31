'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { clsx } from 'clsx';
import { Cpu, HardDrive, Loader2, MemoryStick, Wifi } from 'lucide-react';
import { getMetricsHistory } from '@/lib/cloudApi';

interface CloudMonitoringProps {
  engine: any;
}

interface MetricPoint {
  ts: string;
  cpu: number;
  ram_used: number;
  ram_total: number;
  disk_used: number;
  disk_total: number;
  net_rx: number;
  net_tx: number;
}

const TIME_RANGES = [
  { label: '1h', hours: 1 },
  { label: '6h', hours: 6 },
  { label: '24h', hours: 24 },
  { label: '7d', hours: 168 },
] as const;

function fmt(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(1)} GB`;
}

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-theme-hover/50">
      <div
        className={clsx('h-full rounded-full transition-all duration-500', color)}
        style={{ width: `${Math.min(pct, 100)}%` }}
      />
    </div>
  );
}

export function CloudMonitoring({ engine }: CloudMonitoringProps) {
  const [metrics, setMetrics] = useState<MetricPoint[]>([]);
  const [range, setRange] = useState(1);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async (hours: number) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    try {
      const data = await getMetricsHistory(hours);
      if (controller.signal.aborted) return;
      if (data.ok) setMetrics(data.metrics || []);
    } catch (e) {
      if (controller.signal.aborted) return;
      console.error('Metrics fetch failed:', e);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (engine.status === 'running') load(range);
    return () => { abortRef.current?.abort(); };
  }, [engine.status, range, load]);

  useEffect(() => {
    if (engine.status !== 'running') return;
    const iv = setInterval(() => load(range), 60_000);
    return () => clearInterval(iv);
  }, [engine.status, range, load]);

  if (engine.status !== 'running') {
    const isBooting = engine.status === 'provisioning' || engine.status === 'starting';
    return (
      <div className="dashboard-card flex h-64 flex-col items-center justify-center gap-3 p-8 text-center">
        {isBooting ? (
          <>
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm font-medium text-theme-fg">Your engine is starting up...</p>
            <p className="text-xs text-theme-muted">
              Metrics will appear once the VM is fully ready. This may take 1-2 minutes.
            </p>
          </>
        ) : (
          <p className="text-sm text-theme-muted">Start your engine to view monitoring data.</p>
        )}
      </div>
    );
  }

  const latest = metrics.length > 0 ? metrics[metrics.length - 1] : null;
  const ramPct = latest && latest.ram_total > 0 ? (latest.ram_used / latest.ram_total) * 100 : 0;
  const diskPct = latest && latest.disk_total > 0 ? (latest.disk_used / latest.disk_total) * 100 : 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-theme-fg">Resource monitoring</h2>
        <p className="mt-1 text-sm text-theme-muted">Live CPU, memory, disk, and network for your cloud engine.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {TIME_RANGES.map((r) => (
          <button
            key={r.hours}
            type="button"
            onClick={() => setRange(r.hours)}
            className={clsx(
              'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
              range === r.hours
                ? 'bg-primary/15 text-primary'
                : 'bg-theme-hover/60 text-theme-muted hover:text-theme-fg',
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      {latest ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <WorkspaceMetricCard
            icon={Cpu}
            label="CPU Load"
            value={`${latest.cpu.toFixed(1)}%`}
            detail="Processor usage"
            pct={latest.cpu}
            color="bg-blue-500"
            iconColor="text-blue-400"
          />
          <WorkspaceMetricCard
            icon={MemoryStick}
            label="Memory"
            value={`${fmt(latest.ram_used)} / ${fmt(latest.ram_total)}`}
            detail={`${ramPct.toFixed(0)}% allocated`}
            pct={ramPct}
            color="bg-violet-500"
            iconColor="text-violet-400"
          />
          <WorkspaceMetricCard
            icon={HardDrive}
            label="Storage"
            value={`${fmt(latest.disk_used)} / ${fmt(latest.disk_total)}`}
            detail={`${diskPct.toFixed(0)}% used`}
            pct={diskPct}
            color="bg-amber-500"
            iconColor="text-amber-400"
          />
          <WorkspaceMetricCard
            icon={Wifi}
            label="Network"
            value={`↓ ${fmt(latest.net_rx)}`}
            detail={`↑ ${fmt(latest.net_tx)}`}
            pct={0}
            color="bg-emerald-500"
            iconColor="text-emerald-400"
            hideBar
          />
        </div>
      ) : null}

      {loading && metrics.length === 0 ? (
        <div className="dashboard-card flex flex-col items-center gap-2 py-12">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <p className="text-sm text-theme-muted">Collecting metrics...</p>
        </div>
      ) : metrics.length === 0 ? (
        <div className="dashboard-card py-12 text-center">
          <p className="text-sm text-theme-muted">No metrics data available yet.</p>
          <p className="mt-1 text-xs text-theme-muted/80">
            Metrics typically appear within a few minutes after your VM starts running.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <MiniChart title="CPU %" data={metrics} extract={(m) => m.cpu} color="#3b82f6" max={100} />
          <MiniChart
            title="RAM %"
            data={metrics}
            extract={(m) => (m.ram_total > 0 ? (m.ram_used / m.ram_total) * 100 : 0)}
            color="#8b5cf6"
            max={100}
          />
          <MiniChart
            title="Disk %"
            data={metrics}
            extract={(m) => (m.disk_total > 0 ? (m.disk_used / m.disk_total) * 100 : 0)}
            color="#f59e0b"
            max={100}
          />
          <MiniChart title="Network RX (bytes/s)" data={metrics} extract={(m) => m.net_rx} color="#10b981" />
        </div>
      )}
    </div>
  );
}

function WorkspaceMetricCard({
  icon: Icon,
  label,
  value,
  detail,
  pct,
  color,
  iconColor,
  hideBar,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  detail: string;
  pct: number;
  color: string;
  iconColor: string;
  hideBar?: boolean;
}) {
  return (
    <div className="dashboard-card space-y-4 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-theme-muted">{label}</div>
          <div className="mt-2 text-xl font-semibold text-theme-fg">{value}</div>
          <div className="mt-1 text-xs text-theme-muted">{detail}</div>
        </div>
        <div className="rounded-xl border border-theme/10 bg-theme-card/40 p-2.5">
          <Icon className={clsx('h-4 w-4', iconColor)} />
        </div>
      </div>
      {!hideBar && <ProgressBar pct={pct} color={color} />}
    </div>
  );
}

function MiniChart({
  title,
  data,
  extract,
  color,
  max,
}: {
  title: string;
  data: MetricPoint[];
  extract: (m: MetricPoint) => number;
  color: string;
  max?: number;
}) {
  const values = data.map(extract);
  const chartMax = max ?? Math.max(...values, 1);
  const W = 400;
  const H = 100;
  const points = values.map((v, i) => {
    const x = (i / Math.max(values.length - 1, 1)) * W;
    const y = H - (v / chartMax) * H;
    return `${x},${y}`;
  });
  const polyline = points.join(' ');
  const areaPoints = `0,${H} ${polyline} ${W},${H}`;

  return (
    <div className="dashboard-card p-4">
      <div className="mb-2 text-xs font-medium text-theme-muted">{title}</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-24 w-full">
        <polygon points={areaPoints} fill={color} fillOpacity={0.12} />
        <polyline points={polyline} fill="none" stroke={color} strokeWidth={2} />
      </svg>
    </div>
  );
}
