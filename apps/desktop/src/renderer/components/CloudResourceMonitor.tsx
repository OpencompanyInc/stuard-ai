import React from 'react';
import { clsx } from 'clsx';
import { Cpu, MemoryStick, HardDrive, Wifi } from 'lucide-react';

interface CloudResourceMonitorProps {
  metrics: {
    cpu: number;
    ram_used: number;
    ram_total: number;
    disk_used: number;
    disk_total: number;
    net_rx: number;
    net_tx: number;
  };
  expanded?: boolean;
}

function fmt(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(1)} GB`;
}

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="w-full h-1.5 rounded-full bg-theme-hover/50 overflow-hidden">
      <div
        className={clsx('h-full rounded-full transition-all duration-500', color)}
        style={{ width: `${Math.min(pct, 100)}%` }}
      />
    </div>
  );
}

export const CloudResourceMonitor: React.FC<CloudResourceMonitorProps> = ({ metrics, expanded }) => {
  const ramPct = metrics.ram_total > 0 ? (metrics.ram_used / metrics.ram_total) * 100 : 0;
  const diskPct = metrics.disk_total > 0 ? (metrics.disk_used / metrics.disk_total) * 100 : 0;

  if (!expanded) {
    // Compact: single row of mini widgets
    return (
      <div className="grid grid-cols-4 gap-1.5">
        <MiniStat icon={Cpu} label="CPU" value={`${metrics.cpu.toFixed(0)}%`} color="text-blue-500" />
        <MiniStat icon={MemoryStick} label="RAM" value={`${ramPct.toFixed(0)}%`} color="text-purple-500" />
        <MiniStat icon={HardDrive} label="Disk" value={`${diskPct.toFixed(0)}%`} color="text-amber-500" />
        <MiniStat icon={Wifi} label="Net" value={`↓${fmt(metrics.net_rx)}`} color="text-green-500" />
      </div>
    );
  }

  // Expanded: full cards with progress bars
  return (
    <div className="space-y-3">
      <StatCard
        icon={Cpu}
        label="CPU Usage"
        value={`${metrics.cpu.toFixed(1)}%`}
        pct={metrics.cpu}
        color="bg-blue-500"
        iconColor="text-blue-500"
      />
      <StatCard
        icon={MemoryStick}
        label="Memory"
        value={`${fmt(metrics.ram_used)} / ${fmt(metrics.ram_total)}`}
        pct={ramPct}
        color="bg-purple-500"
        iconColor="text-purple-500"
      />
      <StatCard
        icon={HardDrive}
        label="Disk"
        value={`${fmt(metrics.disk_used)} / ${fmt(metrics.disk_total)}`}
        pct={diskPct}
        color="bg-amber-500"
        iconColor="text-amber-500"
      />
      <StatCard
        icon={Wifi}
        label="Network"
        value={`↓ ${fmt(metrics.net_rx)}  ↑ ${fmt(metrics.net_tx)}`}
        pct={0}
        color="bg-green-500"
        iconColor="text-green-500"
        hideBar
      />
    </div>
  );
};

function MiniStat({ icon: Icon, label, value, color }: { icon: any; label: string; value: string; color: string }) {
  return (
    <div className="rounded-lg border border-theme/10 bg-theme-card/30 px-2 py-1.5 text-center">
      <Icon className={clsx('w-3 h-3 mx-auto mb-0.5', color)} />
      <div className="text-[10px] font-bold text-theme-fg">{value}</div>
      <div className="text-[8px] text-theme-muted">{label}</div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, pct, color, iconColor, hideBar }: {
  icon: any; label: string; value: string; pct: number; color: string; iconColor: string; hideBar?: boolean;
}) {
  return (
    <div className="rounded-xl border border-theme/10 bg-theme-card/30 p-2.5 space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Icon className={clsx('w-3.5 h-3.5', iconColor)} />
          <span className="text-[10px] font-bold text-theme-fg">{label}</span>
        </div>
        <span className="text-[10px] text-theme-muted font-mono">{value}</span>
      </div>
      {!hideBar && <ProgressBar pct={pct} color={color} />}
    </div>
  );
}
