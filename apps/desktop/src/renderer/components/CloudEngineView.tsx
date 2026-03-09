import React, { useState } from 'react';
import { clsx } from 'clsx';
import { Cloud, Terminal, FolderOpen, Activity, Power, PowerOff, Trash2, RefreshCw, Server, Loader2, Sparkles, CreditCard, Camera, RotateCcw, Plus, X } from 'lucide-react';
import { useCloudEngine } from '../hooks/useCloudEngine';
import { CloudTerminalPanel } from './CloudTerminalPanel';
import { CloudFileBrowser } from './CloudFileBrowser';
import { CloudResourceMonitor } from './CloudResourceMonitor';

type CloudTab = 'overview' | 'terminal' | 'files' | 'monitoring' | 'billing' | 'snapshots';

interface CloudEngineViewProps {
  className?: string;
}

const CREDITS_PER_USD = 33;
const STORAGE_USD_PER_GB_MONTH = 0.10;
const HOURS_PER_MONTH = 730;

function creditsFromUsd(usd: number): number {
  return Math.max(0, Math.round(usd * CREDITS_PER_USD));
}

function estimateStorageCredits(diskGb: number): number {
  return creditsFromUsd((diskGb * STORAGE_USD_PER_GB_MONTH) / HOURS_PER_MONTH);
}

/* ─── Credit-based plans (compact for sidebar) ──────────────────── */
const PLANS = [
  { id: 'starter', label: '🌱 Starter', desc: '1 core · 2 GB', credits: creditsFromUsd(0.017) },
  { id: 'basic', label: '⚡ Essential', desc: '2 cores · 8 GB', credits: creditsFromUsd(0.067) },
  { id: 'pro', label: '🚀 Pro', desc: '4 cores · 16 GB', credits: creditsFromUsd(0.134), popular: true },
  { id: 'power', label: '🔥 Power', desc: '8 cores · 32 GB', credits: creditsFromUsd(0.268) },
];

export const CloudEngineView: React.FC<CloudEngineViewProps> = ({ className }) => {
  const { engine, loading, error, metrics, billing, snapshots, provision, start, stop, destroy, listFiles, readFile, refresh, fetchSnapshots, createSnapshot, restoreSnapshot, deleteSnapshot } = useCloudEngine();
  const [tab, setTab] = useState<CloudTab>('overview');
  const [selectedPlan, setSelectedPlan] = useState('basic');
  const [provDisk, setProvDisk] = useState(20);
  const [provisioning, setProvisioning] = useState(false);

  // ─── No Engine: Provision Flow ───────────────────────────────────────
  if (!engine && !loading) {
    const plan = PLANS.find(p => p.id === selectedPlan)!;
    const totalCredits = plan.credits + estimateStorageCredits(provDisk);

    return (
      <div className={clsx('flex flex-col h-full p-4 gap-3', className)}>
        <div className="text-center py-4">
          <Cloud className="w-8 h-8 mx-auto text-primary/60 mb-2" />
          <h2 className="text-base font-black text-theme-fg">Cloud Engine</h2>
          <p className="text-[10px] text-theme-muted mt-1">Your AI runs 24/7 — even when your computer is off</p>
        </div>

        {error && <div className="text-[10px] text-red-500 bg-red-500/10 rounded-lg p-2 text-center">{error}</div>}

        <div className="flex flex-col gap-1.5">
          {PLANS.map(p => (
            <button
              key={p.id}
              onClick={() => setSelectedPlan(p.id)}
              className={clsx(
                'flex items-center justify-between px-3 py-2 rounded-xl border text-left transition-all',
                selectedPlan === p.id
                  ? 'border-primary bg-primary/5 text-theme-fg'
                  : 'border-theme/10 text-theme-muted hover:border-theme/20'
              )}
            >
              <div>
                <div className="text-xs font-bold flex items-center gap-1">
                  {p.label}
                  {p.popular && <span className="text-[8px] bg-primary text-primary-fg px-1.5 py-0.5 rounded-full font-black">Best</span>}
                </div>
                <div className="text-[10px] opacity-70">{p.desc}</div>
              </div>
              <div className="text-right">
                <div className="text-xs font-black text-primary">{p.credits}</div>
                <div className="text-[8px] text-theme-muted">credits/hr</div>
              </div>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 px-1">
          <label className="text-[10px] text-theme-muted font-medium">Storage</label>
          <input
            type="range"
            min={10}
            max={100}
            step={10}
            value={provDisk}
            onChange={e => setProvDisk(Number(e.target.value))}
            className="flex-1 accent-primary"
          />
          <span className="text-[10px] text-theme-muted font-bold w-10 text-right">{provDisk} GB</span>
        </div>

        <div className="text-center text-[10px] text-theme-muted">
          Total: <span className="font-bold text-primary">{totalCredits} credits/hr</span>
        </div>

        <button
          onClick={async () => { setProvisioning(true); await provision(plan.id, provDisk); setProvisioning(false); }}
          disabled={provisioning}
          className="w-full py-2.5 rounded-xl bg-primary text-primary-fg text-xs font-black hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {provisioning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {provisioning ? 'Setting up...' : 'Create My Cloud Engine'}
        </button>
        <p className="text-[8px] text-theme-muted text-center">Credits only used while running. Stop anytime.</p>
      </div>
    );
  }

  // ─── Loading ─────────────────────────────────────────────────────────
  if (loading && !engine) {
    return (
      <div className={clsx('flex items-center justify-center h-full', className)}>
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="w-5 h-5 animate-spin text-primary" />
          <span className="text-[10px] text-theme-muted">Loading...</span>
        </div>
      </div>
    );
  }

  if (!engine) return null;

  const statusColor = engine.status === 'running' ? 'text-green-500' : engine.status === 'stopped' ? 'text-amber-500' : 'text-red-500';
  const statusLabel = engine.status === 'running' ? 'Running' : engine.status === 'stopped' ? 'Paused' : engine.status === 'provisioning' ? 'Setting up...' : engine.status;

  const tabs: { id: CloudTab; label: string; icon: any }[] = [
    { id: 'overview', label: 'Info', icon: Server },
    { id: 'terminal', label: 'Shell', icon: Terminal },
    { id: 'files', label: 'Files', icon: FolderOpen },
    { id: 'monitoring', label: 'Stats', icon: Activity },
    { id: 'billing', label: 'Bill', icon: CreditCard },
    { id: 'snapshots', label: 'Snaps', icon: Camera },
  ];

  // ─── Main View ───────────────────────────────────────────────────────
  return (
    <div className={clsx('flex flex-col h-full', className)}>
      {/* Tab bar */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-theme/10 shrink-0 bg-theme-hover/20">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              'flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition-all',
              tab === t.id
                ? 'bg-theme-card text-primary shadow-sm'
                : 'text-theme-muted hover:text-theme-fg'
            )}
          >
            <t.icon className="w-3 h-3" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === 'overview' && (
          <div className="p-3 space-y-3 overflow-y-auto h-full">
            {/* Status Card */}
            <div className="rounded-xl border border-theme/10 bg-theme-card/30 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={clsx('w-2 h-2 rounded-full', statusColor.replace('text-', 'bg-'))} />
                  <span className="text-xs font-bold text-theme-fg capitalize">{statusLabel}</span>
                </div>
                <button onClick={refresh} className="p-1 rounded hover:bg-theme-hover text-theme-muted">
                  <RefreshCw className="w-3 h-3" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <div><span className="text-theme-muted">Plan:</span> <span className="text-theme-fg font-medium capitalize">{engine.tier}</span></div>
                <div><span className="text-theme-muted">Machine:</span> <span className="text-theme-fg font-medium">{engine.vcpus && engine.ram_gb ? `${engine.vcpus} vCPU / ${engine.ram_gb} GB` : '—'}</span></div>
                <div><span className="text-theme-muted">Storage:</span> <span className="text-theme-fg font-medium">{engine.disk_size_gb} GB</span></div>
                <div><span className="text-theme-muted">Region:</span> <span className="text-theme-fg font-medium">{engine.zone}</span></div>
                <div><span className="text-theme-muted">Status:</span> <span className="text-theme-fg font-medium capitalize">{engine.health_status || '—'}</span></div>
              </div>
            </div>

            {/* Quick Metrics */}
            {metrics && <CloudResourceMonitor metrics={metrics} />}

            {/* Actions */}
            <div className="flex gap-2">
              {engine.status === 'stopped' && (
                <button onClick={start} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-green-600/10 text-green-600 text-xs font-bold hover:bg-green-600/20 transition-all">
                  <Power className="w-3 h-3" /> Resume
                </button>
              )}
              {engine.status === 'running' && (
                <button onClick={stop} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-amber-600/10 text-amber-500 text-xs font-bold hover:bg-amber-600/20 transition-all">
                  <PowerOff className="w-3 h-3" /> Pause
                </button>
              )}
              <button
                onClick={() => { if (confirm('This will permanently delete your cloud engine and all its data. Continue?')) destroy(); }}
                className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-red-600/10 text-red-500 text-xs font-bold hover:bg-red-600/20 transition-all"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>

            {error && <div className="text-[10px] text-red-500 text-center">{error}</div>}
          </div>
        )}

        {tab === 'terminal' && (
          <CloudTerminalPanel engine={engine} className="w-full h-full" />
        )}

        {tab === 'files' && (
          <CloudFileBrowser engine={engine} listFiles={listFiles} readFile={readFile} className="w-full h-full" />
        )}

        {tab === 'monitoring' && (
          <div className="p-3 h-full overflow-y-auto">
            {metrics ? (
              <CloudResourceMonitor metrics={metrics} expanded />
            ) : (
              <div className="text-xs text-theme-muted text-center py-8">
                {engine.status === 'running' ? 'Loading performance data...' : 'Resume your engine to see stats'}
              </div>
            )}
          </div>
        )}

        {tab === 'billing' && (
          <SidebarBillingTab billing={billing} engine={engine} />
        )}

        {tab === 'snapshots' && (
          <SidebarSnapshotsTab
            snapshots={snapshots}
            createSnapshot={createSnapshot}
            restoreSnapshot={restoreSnapshot}
            deleteSnapshot={deleteSnapshot}
          />
        )}
      </div>
    </div>
  );
};

/* ─── Compact Billing Tab ─────────────────────────────────────────── */

function SidebarBillingTab({ billing, engine }: { billing: any; engine: any }) {
  const tier = engine?.tier || billing?.current_tier || '—';
  const plan = PLANS.find(p => p.id === tier);

  return (
    <div className="p-3 space-y-3 overflow-y-auto h-full">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3">
          <div className="text-[9px] text-theme-muted font-bold uppercase">Credits Used</div>
          <div className="text-lg font-black text-theme-fg">{(billing?.total_credits_used ?? 0).toFixed(1)}</div>
        </div>
        <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-3">
          <div className="text-[9px] text-theme-muted font-bold uppercase">Compute</div>
          <div className="text-lg font-black text-theme-fg">{(billing?.compute_credits ?? 0).toFixed(1)}</div>
        </div>
      </div>

      <div className="rounded-xl border border-theme/10 bg-theme-card/30 p-3 space-y-1.5">
        <div className="text-[9px] font-bold text-theme-muted uppercase">Plan</div>
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-theme-muted">Tier</span>
          <span className="text-theme-fg font-bold capitalize">{plan?.label || tier}</span>
        </div>
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-theme-muted">Rate</span>
          <span className="text-primary font-bold">{plan?.credits ?? '—'} credits/hr</span>
        </div>
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-theme-muted">Hours</span>
          <span className="text-theme-fg font-bold">{(billing?.hours_this_month ?? 0).toFixed(1)} hrs</span>
        </div>
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-theme-muted">Storage</span>
          <span className="text-theme-fg font-bold">{(billing?.storage_credits ?? 0).toFixed(1)} credits</span>
        </div>
      </div>
    </div>
  );
}

/* ─── Compact Snapshots Tab ───────────────────────────────────────── */

function SidebarSnapshotsTab({
  snapshots,
  createSnapshot,
  restoreSnapshot,
  deleteSnapshot,
}: {
  snapshots: any[];
  createSnapshot: (name: string, description?: string) => Promise<any>;
  restoreSnapshot: (id: string) => Promise<any>;
  deleteSnapshot: (id: string) => Promise<any>;
}) {
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    await createSnapshot(newName.trim());
    setNewName('');
    setCreating(false);
  };

  return (
    <div className="p-3 space-y-3 overflow-y-auto h-full">
      {/* Create */}
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Snapshot name..."
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleCreate()}
          className="flex-1 px-2.5 py-1.5 text-[10px] bg-theme-card/30 border border-theme/10 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/20 text-theme-fg placeholder:text-theme-muted/50"
        />
        <button
          onClick={handleCreate}
          disabled={creating || !newName.trim()}
          className="p-1.5 rounded-lg bg-primary text-primary-fg disabled:opacity-50 transition-all"
        >
          {creating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
        </button>
      </div>

      {/* List */}
      {snapshots.length === 0 ? (
        <div className="text-center py-6 text-theme-muted">
          <Camera className="w-5 h-5 mx-auto mb-2 opacity-30" />
          <div className="text-[10px] font-bold">No snapshots</div>
        </div>
      ) : (
        <div className="space-y-2">
          {snapshots.map(snap => (
            <div key={snap.id} className="rounded-xl border border-theme/10 bg-theme-card/30 p-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Camera className="w-3 h-3 text-theme-muted shrink-0" />
                  <span className="text-[10px] font-bold text-theme-fg truncate">{snap.name}</span>
                  <span className={clsx(
                    'px-1.5 py-0.5 rounded-full text-[8px] font-black shrink-0',
                    snap.status === 'ready' ? 'bg-green-500/10 text-green-500' :
                    snap.status === 'creating' ? 'bg-blue-500/10 text-blue-400' :
                    'bg-theme-hover text-theme-muted'
                  )}>{snap.status}</span>
                </div>
                <div className="flex gap-1 shrink-0 ml-2">
                  {snap.status === 'ready' && (
                    <button
                      onClick={async () => {
                        if (!confirm('Restore this snapshot?')) return;
                        setActionId(snap.id);
                        await restoreSnapshot(snap.id);
                        setActionId(null);
                      }}
                      disabled={actionId === snap.id}
                      className="p-1 rounded-md bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 disabled:opacity-50"
                    >
                      {actionId === snap.id ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <RotateCcw className="w-2.5 h-2.5" />}
                    </button>
                  )}
                  <button
                    onClick={async () => {
                      if (!confirm('Delete this snapshot?')) return;
                      setActionId(snap.id);
                      await deleteSnapshot(snap.id);
                      setActionId(null);
                    }}
                    disabled={actionId === snap.id}
                    className="p-1 rounded-md bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-50"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              </div>
              <div className="text-[8px] text-theme-muted mt-1 pl-4">
                {new Date(snap.created_at).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
