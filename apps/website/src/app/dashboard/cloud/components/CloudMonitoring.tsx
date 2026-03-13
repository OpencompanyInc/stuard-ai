'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
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

  // Auto-refresh every 60s
  useEffect(() => {
    if (engine.status !== 'running') return;
    const iv = setInterval(() => load(range), 60_000);
    return () => clearInterval(iv);
  }, [engine.status, range, load]);

  if (engine.status !== 'running') {
    return (
      <div className="flex items-center justify-center h-64 bg-gray-50 rounded-2xl border border-gray-200">
        <p className="text-gray-500">Start your engine to view monitoring data.</p>
      </div>
    );
  }

  const latest = metrics.length > 0 ? metrics[metrics.length - 1] : null;

  const cpuPct = latest ? latest.cpu.toFixed(1) : '—';
  const ramPct = latest && latest.ram_total > 0
    ? ((latest.ram_used / latest.ram_total) * 100).toFixed(1)
    : '—';
  const diskPct = latest && latest.disk_total > 0
    ? ((latest.disk_used / latest.disk_total) * 100).toFixed(1)
    : '—';
  const netRx = latest ? formatBytes(latest.net_rx) : '—';
  const netTx = latest ? formatBytes(latest.net_tx) : '—';

  return (
    <div className="space-y-6">
      {/* Time range selector */}
      <div className="flex gap-2">
        {TIME_RANGES.map(r => (
          <button
            key={r.hours}
            onClick={() => setRange(r.hours)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
              range === r.hours
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Current stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="CPU" value={`${cpuPct}%`} color="blue" />
        <StatCard label="RAM" value={`${ramPct}%`} sub={latest ? `${formatBytes(latest.ram_used)} / ${formatBytes(latest.ram_total)}` : ''} color="purple" />
        <StatCard label="Disk" value={`${diskPct}%`} sub={latest ? `${formatBytes(latest.disk_used)} / ${formatBytes(latest.disk_total)}` : ''} color="amber" />
        <StatCard label="Network" value={`↓${netRx}`} sub={`↑${netTx}`} color="green" />
      </div>

      {/* Mini charts */}
      {loading && metrics.length === 0 ? (
        <div className="text-center text-gray-500 py-8">Loading metrics...</div>
      ) : metrics.length === 0 ? (
        <div className="text-center text-gray-500 py-8">No metrics data available yet.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <MiniChart title="CPU %" data={metrics} extract={(m) => m.cpu} color="#3b82f6" max={100} />
          <MiniChart
            title="RAM %"
            data={metrics}
            extract={(m) => m.ram_total > 0 ? (m.ram_used / m.ram_total) * 100 : 0}
            color="#8b5cf6"
            max={100}
          />
          <MiniChart
            title="Disk %"
            data={metrics}
            extract={(m) => m.disk_total > 0 ? (m.disk_used / m.disk_total) * 100 : 0}
            color="#f59e0b"
            max={100}
          />
          <MiniChart
            title="Network RX (bytes/s)"
            data={metrics}
            extract={(m) => m.net_rx}
            color="#10b981"
          />
        </div>
      )}
    </div>
  );
}

function StatCard({
  label, value, sub, color,
}: {
  label: string; value: string; sub?: string; color: string;
}) {
  const colorClasses: Record<string, string> = {
    blue: 'border-blue-200 bg-blue-50',
    purple: 'border-purple-200 bg-purple-50',
    amber: 'border-amber-200 bg-amber-50',
    green: 'border-green-200 bg-green-50',
  };
  return (
    <div className={`rounded-xl border p-4 ${colorClasses[color] || 'border-gray-200 bg-gray-50'}`}>
      <div className="text-xs text-gray-500 font-medium">{label}</div>
      <div className="text-xl font-bold mt-1">{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

/**
 * Lightweight SVG sparkline chart — no external dependency needed.
 */
function MiniChart({
  title, data, extract, color, max,
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
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="text-xs text-gray-500 font-medium mb-2">{title}</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-24">
        <polygon points={areaPoints} fill={color} fillOpacity={0.1} />
        <polyline points={polyline} fill="none" stroke={color} strokeWidth={2} />
      </svg>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
