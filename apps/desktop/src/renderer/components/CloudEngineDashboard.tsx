import React, { useState } from 'react';
import { clsx } from 'clsx';
import {
  Cloud, Server, Activity, Power, Trash2,
  RefreshCw, Loader2, HardDrive, WifiOff, Globe, Clock, Cpu,
  Download, Upload, Sparkles, Zap, Shield,
  CreditCard, Camera, RotateCcw, Plus, X, Rocket, Play, Square,
  ScrollText, AlertCircle, CheckCircle2, Circle,
} from 'lucide-react';
import { useCloudEngine } from '../hooks/useCloudEngine';
import { CloudTerminalPanel } from './CloudTerminalPanel';
import { CloudFileBrowser } from './CloudFileBrowser';
import { CloudResourceMonitor } from './CloudResourceMonitor';
import { CloudVmChat } from './CloudVmChat';
import { CloudVmPermissions } from './CloudVmPermissions';
import { CloudRuntimeWorkspace } from './CloudRuntimeWorkspace';

const CREDITS_PER_USD = 33;
const STORAGE_USD_PER_GB_MONTH = 0.10;
const HOURS_PER_MONTH = 730;

function creditsFromUsd(usd: number): number {
  return Math.max(0, Math.round(usd * CREDITS_PER_USD));
}

function estimateCustomComputeCredits(vcpus: number): number {
  return creditsFromUsd(vcpus * 0.034);
}

function estimateStorageCredits(diskGb: number): number {
  return creditsFromUsd((diskGb * STORAGE_USD_PER_GB_MONTH) / HOURS_PER_MONTH);
}

/* ─── Credit-based pricing plans ─────────────────────────────────── */
const PLANS = [
  {
    id: 'starter', label: 'Starter', emoji: '🌱',
    tagline: 'Perfect for trying things out',
    vcpus: 1, ram: 2, disk: 10,
    hourlyUsd: 0.017,
    credits: creditsFromUsd(0.017), creditsPer: 'hr',
    features: ['1 CPU core', '2 GB memory', '10 GB storage', 'Great for light tasks'],
  },
  {
    id: 'basic', label: 'Essential', emoji: '⚡',
    tagline: 'For everyday automation',
    vcpus: 2, ram: 8, disk: 20,
    hourlyUsd: 0.067,
    credits: creditsFromUsd(0.067), creditsPer: 'hr',
    features: ['2 CPU cores', '8 GB memory', '20 GB storage', 'Run automations 24/7'],
  },
  {
    id: 'pro', label: 'Pro', emoji: '🚀', popular: true,
    tagline: 'Best for most users',
    vcpus: 4, ram: 16, disk: 50,
    hourlyUsd: 0.134,
    credits: creditsFromUsd(0.134), creditsPer: 'hr',
    features: ['4 CPU cores', '16 GB memory', '50 GB storage', 'Fast AI processing'],
  },
  {
    id: 'power', label: 'Power', emoji: '🔥',
    tagline: 'Maximum performance',
    vcpus: 8, ram: 32, disk: 100,
    hourlyUsd: 0.268,
    credits: creditsFromUsd(0.268), creditsPer: 'hr',
    features: ['8 CPU cores', '32 GB memory', '100 GB storage', 'Heavy workloads'],
  },
];

export function CloudEngineDashboard() {
  const {
    engine, loading, error, metrics, billing, snapshots, deployments,
    provision, start, stop, destroy, listFiles, readFile, refresh,
    createSnapshot, restoreSnapshot, deleteSnapshot,
    createDeployment, stopDeployment, restartDeployment, deleteDeployment,
    getDeployLogs, fetchDeployments,
  } = useCloudEngine();
  const [selectedPlan, setSelectedPlan] = useState('pro');
  const [customMode, setCustomMode] = useState(false);
  const [customCpu, setCustomCpu] = useState(2);
  const [customRam, setCustomRam] = useState(4);
  const [customDisk, setCustomDisk] = useState(20);
  const [provisioning, setProvisioning] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // ─── Provision Flow ────────────────────────────────────────────────
  if (!engine && !loading) {
    const plan = PLANS.find(p => p.id === selectedPlan)!;
    const diskCredits = estimateStorageCredits(customMode ? customDisk : plan.disk);
    const cpuCredits = customMode ? estimateCustomComputeCredits(customCpu) : plan.credits;
    const totalCredits = cpuCredits + diskCredits;

    const handleProvision = async () => {
      setProvisioning(true);
      if (customMode) {
        await provision('custom', customDisk, customCpu, customRam);
      } else {
        await provision(plan.id, plan.disk);
      }
      setProvisioning(false);
    };

    return (
      <div className="h-full overflow-y-auto custom-scrollbar px-5 pb-5 pt-6 md:px-6 md:pb-6 md:pt-7">
      <div className="animate-in fade-in duration-500">
        {/* Hero */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Cloud className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-black text-theme-fg tracking-tight">Cloud Engine</h1>
              <p className="text-theme-muted text-sm">Your personal AI computer in the cloud — always on, always ready.</p>
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-500 text-sm font-medium flex items-start gap-3">
            <Shield className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              <div className="font-bold">Something went wrong</div>
              <div className="opacity-80 mt-0.5">{error}</div>
            </div>
          </div>
        )}

        {/* What you get */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          {[
            { icon: Zap, title: 'Always Running', desc: 'Your agent works even when your computer is off' },
            { icon: Shield, title: 'Secure & Private', desc: 'Your own isolated environment with encrypted storage' },
            { icon: Sparkles, title: 'Instant Setup', desc: 'Ready in under 60 seconds, no technical knowledge needed' },
          ].map((f, i) => (
            <div key={i} className="p-4 rounded-2xl bg-theme-card/20 border border-theme/5">
              <f.icon className="w-5 h-5 text-primary mb-2" />
              <div className="text-sm font-bold text-theme-fg">{f.title}</div>
              <div className="text-xs text-theme-muted mt-1">{f.desc}</div>
            </div>
          ))}
        </div>

        {/* Plan Selection */}
        {!customMode && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-black text-theme-fg">Choose a plan</h2>
              <button
                onClick={() => setCustomMode(true)}
                className="text-xs text-primary font-bold hover:underline flex items-center gap-1"
              >
                <Cpu className="w-3 h-3" /> Build custom
              </button>
            </div>
            <div className="grid grid-cols-4 gap-3">
              {PLANS.map(p => (
                <button
                  key={p.id}
                  onClick={() => setSelectedPlan(p.id)}
                  className={clsx(
                    'relative p-4 rounded-2xl border-2 text-left transition-all duration-200',
                    selectedPlan === p.id
                      ? 'border-primary bg-primary/5 shadow-lg shadow-primary/10'
                      : 'border-theme/10 bg-theme-card/30 hover:border-theme/20'
                  )}
                >
                  {p.popular && (
                    <span className="absolute -top-2.5 right-3 bg-primary text-primary-fg text-[9px] font-black px-2.5 py-0.5 rounded-full shadow-lg shadow-primary/30">
                      Best Value
                    </span>
                  )}
                  <div className="text-xl mb-1">{p.emoji}</div>
                  <div className="text-sm font-black text-theme-fg">{p.label}</div>
                  <div className="text-[10px] text-theme-muted mt-0.5">{p.tagline}</div>
                  <div className="mt-3 flex items-baseline gap-1">
                    <span className="text-lg font-black text-primary">{p.credits}</span>
                    <span className="text-[10px] text-theme-muted font-bold">credits/{p.creditsPer}</span>
                  </div>
                  <div className="mt-2 space-y-1">
                    {p.features.map((f, i) => (
                      <div key={i} className="text-[10px] text-theme-muted flex items-center gap-1">
                        <span className="text-green-500">✓</span> {f}
                      </div>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Custom Builder */}
        {customMode && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-black text-theme-fg">Custom Configuration</h2>
              <button
                onClick={() => setCustomMode(false)}
                className="text-xs text-primary font-bold hover:underline"
              >
                ← Back to plans
              </button>
            </div>
            <div className="p-6 rounded-2xl bg-theme-card/30 border border-theme/10 space-y-5">
              {/* CPU */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold text-theme-fg flex items-center gap-2">
                    <Cpu className="w-3.5 h-3.5 text-theme-muted" /> CPU Cores
                  </label>
                  <span className="text-sm font-black text-primary">{customCpu} cores</span>
                </div>
                <input type="range" min={1} max={16} step={1} value={customCpu} onChange={e => setCustomCpu(Number(e.target.value))} className="w-full accent-primary" />
                <div className="flex justify-between text-[9px] text-theme-muted mt-1"><span>1 core</span><span>16 cores</span></div>
              </div>
              {/* RAM */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold text-theme-fg flex items-center gap-2">
                    <Server className="w-3.5 h-3.5 text-theme-muted" /> Memory (RAM)
                  </label>
                  <span className="text-sm font-black text-primary">{customRam} GB</span>
                </div>
                <input type="range" min={1} max={64} step={1} value={customRam} onChange={e => setCustomRam(Number(e.target.value))} className="w-full accent-primary" />
                <div className="flex justify-between text-[9px] text-theme-muted mt-1"><span>1 GB</span><span>64 GB</span></div>
              </div>
              {/* Disk */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold text-theme-fg flex items-center gap-2">
                    <HardDrive className="w-3.5 h-3.5 text-theme-muted" /> Storage
                  </label>
                  <span className="text-sm font-black text-primary">{customDisk} GB</span>
                </div>
                <input type="range" min={10} max={500} step={10} value={customDisk} onChange={e => setCustomDisk(Number(e.target.value))} className="w-full accent-primary" />
                <div className="flex justify-between text-[9px] text-theme-muted mt-1"><span>10 GB</span><span>500 GB</span></div>
              </div>
            </div>
          </div>
        )}

        {/* Cost Summary */}
        <div className="p-5 rounded-2xl bg-theme-card/30 border border-theme/10 mb-6">
          <h3 className="text-[10px] font-black text-theme-muted uppercase tracking-wider mb-3">Credit Usage</h3>
          <div className="flex justify-between text-sm">
            <span className="text-theme-muted">Compute</span>
            <span className="font-bold text-theme-fg">{cpuCredits} credits/hr</span>
          </div>
          <div className="flex justify-between text-sm mt-1">
            <span className="text-theme-muted">Storage ({customMode ? customDisk : plan.disk} GB)</span>
            <span className="font-bold text-theme-fg">{diskCredits} credits/hr</span>
          </div>
          <div className="border-t border-theme/10 mt-3 pt-3 flex justify-between text-sm">
            <span className="font-black text-theme-fg">Total</span>
            <span className="font-black text-primary">{totalCredits} credits/hr</span>
          </div>
          <div className="text-[10px] text-theme-muted mt-2 text-right">
            ~{totalCredits * 24} credits/day • ~{(totalCredits * 24 * 30 / 1000).toFixed(1)}k credits/month
          </div>
        </div>

        <button
          onClick={handleProvision}
          disabled={provisioning}
          className="w-full py-4 rounded-2xl bg-primary text-primary-fg text-sm font-black hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-xl shadow-primary/20"
        >
          {provisioning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {provisioning ? 'Setting up your cloud engine...' : 'Create My Cloud Engine'}
        </button>
        <p className="text-center text-[10px] text-theme-muted mt-3">You can stop or delete your engine at any time. Credits are only used while running.</p>
      </div>
      </div>
    );
  }

  // ─── Loading ────────────────────────────────────────────────────────
  if (loading && !engine) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <span className="text-sm text-theme-muted font-medium">Loading your cloud engine...</span>
        </div>
      </div>
    );
  }

  if (!engine) return null;

  // ─── Provisioning Progress View ─────────────────────────────────────
  if (engine.status === 'provisioning') {
    const ScrollWrapper = ({ children }: { children: React.ReactNode }) => (
      <div className="h-full overflow-y-auto custom-scrollbar px-5 pb-5 pt-6 md:px-6 md:pb-6 md:pt-7">{children}</div>
    );
    const PROVISION_STEPS = [
      { key: 'vm_creating',          label: 'Creating your machine',       detail: 'Spinning up a dedicated VM in the cloud' },
      { key: 'vm_created',           label: 'Machine created',             detail: 'Your VM is ready, configuring network...' },
      { key: 'waiting_ip',           label: 'Assigning network address',   detail: 'Getting a public IP for your machine' },
      { key: 'waiting_agent',        label: 'Starting AI agent',           detail: 'Installing packages and booting your agent' },
      { key: 'restoring_data',       label: 'Restoring your data',         detail: 'Syncing your memories, scripts, and files' },
      { key: 'syncing_agent',        label: 'Syncing AI knowledge',        detail: 'Loading your knowledge base and databases' },
      { key: 'syncing_integrations', label: 'Setting up integrations',     detail: 'Connecting your linked accounts' },
      { key: 'finalizing',           label: 'Almost ready',                detail: 'Final checks and bringing everything online' },
    ] as const;

    const currentStep = engine.provision_step || 'vm_creating';
    const currentIdx = PROVISION_STEPS.findIndex(s => s.key === currentStep);
    const progress = Math.max(0, Math.min(100, ((currentIdx + 1) / PROVISION_STEPS.length) * 100));

    return (
      <ScrollWrapper>
      <div className="animate-in fade-in duration-500">
        <div className="flex flex-col items-center justify-center min-h-[60vh]">
          <div className="w-full max-w-lg">
            <div className="text-center mb-8">
              <div className="w-16 h-16 rounded-3xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
              <h1 className="text-2xl font-black text-theme-fg tracking-tight">Setting up your Cloud Engine</h1>
              <p className="text-theme-muted text-sm mt-1">This usually takes 1–3 minutes. You can wait here or come back shortly.</p>
            </div>

            {/* Progress bar */}
            <div className="mb-8">
              <div className="flex items-center justify-between text-[10px] text-theme-muted font-bold mb-2">
                <span>Progress</span>
                <span>{Math.round(progress)}%</span>
              </div>
              <div className="h-2 rounded-full bg-theme-hover/50 overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-700 ease-out"
                  style={{ width: `${Math.max(5, progress)}%` }}
                />
              </div>
            </div>

            {/* Step list */}
            <div className="space-y-2">
              {PROVISION_STEPS.map((step, idx) => {
                const isActive = idx === currentIdx;
                const isDone = idx < currentIdx;
                const isPending = idx > currentIdx;

                return (
                  <div
                    key={step.key}
                    className={clsx(
                      'flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300',
                      isActive && 'bg-primary/10 border border-primary/20',
                      isDone && 'opacity-60',
                      isPending && 'opacity-30',
                    )}
                  >
                    <div className="shrink-0">
                      {isDone ? (
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                      ) : isActive ? (
                        <Loader2 className="w-4 h-4 animate-spin text-primary" />
                      ) : (
                        <Circle className="w-4 h-4 text-theme-muted/40" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className={clsx(
                        'text-xs font-bold',
                        isActive ? 'text-primary' : isDone ? 'text-theme-fg' : 'text-theme-muted',
                      )}>
                        {step.label}
                      </div>
                      {isActive && (
                        <div className="text-[10px] text-theme-muted mt-0.5 animate-in fade-in duration-300">
                          {step.detail}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Info footer */}
            <div className="mt-8 p-3 rounded-xl bg-theme-hover/30 text-center">
              <p className="text-[10px] text-theme-muted">
                Your engine runs 24/7 once set up. Credits are only used while the engine is active.
              </p>
            </div>
          </div>
        </div>
      </div>
      </ScrollWrapper>
    );
  }

  // Transitional states (starting / stopping)
  if (engine.status === 'starting' || engine.status === 'stopping') {
    const isStarting = engine.status === 'starting';
    return (
      <div className="h-full overflow-y-auto custom-scrollbar px-5 pb-5 pt-6 md:px-6 md:pb-6 md:pt-7">
      <div className="animate-in fade-in duration-500">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-black text-theme-fg tracking-tight">Cloud Engine</h1>
            <div className="flex items-center gap-3 mt-1">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                <span className="text-sm font-bold text-blue-400">{isStarting ? 'Starting...' : 'Stopping...'}</span>
              </div>
              <span className="text-theme-muted text-xs">•</span>
              <span className="text-theme-muted text-xs font-medium capitalize">{engine.tier} tier</span>
            </div>
          </div>
          <button onClick={refresh} className="p-2.5 rounded-xl hover:bg-theme-hover text-theme-muted hover:text-theme-fg transition-all" title="Refresh">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-col items-center justify-center py-16">
          <div className="w-16 h-16 rounded-3xl bg-blue-500/10 flex items-center justify-center mb-4">
            <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
          </div>
          <h2 className="text-2xl font-black text-theme-fg tracking-tight">
            {isStarting ? 'Starting your engine' : 'Pausing your engine'}
          </h2>
          <p className="text-theme-muted text-sm mt-2 text-center max-w-md">
            {isStarting
              ? 'Booting VM, restoring your data, and syncing memories. This usually takes 1\u20132 minutes.'
              : 'Syncing your data to cloud storage and shutting down the VM. This takes about 30 seconds.'}
          </p>
        </div>

        {error && (
          <div className="mt-4 p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-500 text-sm font-medium text-center">{error}</div>
        )}
      </div>
      </div>
    );
  }

  // Show a "still booting" view if engine is running but agent is unreachable
  const isBooting = engine.status === 'running' && (engine.health_status === 'unreachable' || engine.health_status === 'unknown') && !metrics;
  if (isBooting) {
    return (
      <div className="h-full overflow-y-auto custom-scrollbar px-5 pb-5 pt-6 md:px-6 md:pb-6 md:pt-7">
      <div className="animate-in fade-in duration-500">
        <div className="flex flex-col items-center justify-center min-h-[60vh]">
          <div className="w-full max-w-md text-center">
            <div className="w-16 h-16 rounded-3xl bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
              <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
            </div>
            <h1 className="text-2xl font-black text-theme-fg tracking-tight">Your VM is still booting</h1>
            <p className="text-theme-muted text-sm mt-2">
              The machine is running but the AI agent is still installing packages and starting up.
              This can take a few minutes on smaller plans.
            </p>
            <div className="mt-6 p-4 rounded-2xl bg-theme-card/30 border border-theme/10 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-theme-muted">Status</span>
                <span className="font-bold text-amber-500">Agent starting...</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-theme-muted">VM</span>
                <span className="font-bold text-green-500">Running</span>
              </div>
              {engine.external_ip && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-theme-muted">IP Address</span>
                  <span className="font-mono text-theme-fg">{engine.external_ip}</span>
                </div>
              )}
              <div className="flex items-center justify-between text-xs">
                <span className="text-theme-muted">Plan</span>
                <span className="font-bold text-theme-fg capitalize">{engine.tier}</span>
              </div>
            </div>
            <p className="text-[10px] text-theme-muted mt-4">
              This page will refresh automatically once the agent comes online.
            </p>
            <button
              onClick={() => { if (confirm('This will permanently delete your cloud engine and all its data. Continue?')) destroy(); }}
              className="mt-4 flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600/10 text-red-500 text-xs font-black hover:bg-red-600/20 transition-all mx-auto"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete Engine
            </button>
          </div>
        </div>
      </div>
      </div>
    );
  }

  const handlePause = async () => {
    setActionLoading('stop');
    await stop();
    setActionLoading(null);
  };

  const handleDelete = () => {
    if (confirm('This will permanently delete your cloud engine and all its data. Continue?')) {
      destroy();
    }
  };

  const overviewPanel = (
    <div className="custom-scrollbar h-full overflow-y-auto p-6">
      <div className="grid grid-cols-12 gap-4">
        <div className="dashboard-card p-5 col-span-5 space-y-4">
          <h3 className="text-[10px] font-black text-theme-muted uppercase tracking-wider">Machine</h3>
          <div className="space-y-3">
            <InfoRow icon={Server} label="Name" value={engine.instance_name} />
            <InfoRow icon={Globe} label="Region" value={engine.zone} />
            <InfoRow icon={Cpu} label="Plan" value={engine.tier} capitalize />
            <InfoRow icon={Cpu} label="Machine" value={engine.vcpus && engine.ram_gb ? `${engine.vcpus} vCPU / ${engine.ram_gb} GB RAM` : '—'} />
            <InfoRow icon={HardDrive} label="Storage" value={`${engine.disk_size_gb} GB`} />
            {engine.external_ip && <InfoRow icon={Globe} label="Address" value={engine.external_ip} mono />}
            <InfoRow icon={Clock} label="Created" value={new Date(engine.created_at).toLocaleDateString()} />
          </div>
        </div>

        <div className="dashboard-card p-5 col-span-7">
          <h3 className="text-[10px] font-black text-theme-muted uppercase tracking-wider mb-4">Performance</h3>
          {metrics ? (
            <div className="space-y-4">
              <MetricBar label="CPU" value={metrics.cpu} unit={`${Math.round(metrics.cpu)}%`} color="primary" />
              <MetricBar label="Memory" value={(metrics.ram_used / metrics.ram_total) * 100} unit={`${(metrics.ram_used / 1e9).toFixed(1)} / ${(metrics.ram_total / 1e9).toFixed(1)} GB`} color="violet" />
              <MetricBar label="Storage" value={(metrics.disk_used / metrics.disk_total) * 100} unit={`${(metrics.disk_used / 1e9).toFixed(1)} / ${(metrics.disk_total / 1e9).toFixed(1)} GB`} color="amber" />
              <div className="grid grid-cols-2 gap-4 pt-2">
                <div className="flex items-center gap-2 text-xs">
                  <Upload className="w-3.5 h-3.5 text-green-500" />
                  <span className="text-theme-muted">Upload:</span>
                  <span className="font-bold text-theme-fg">{formatBytes(metrics.net_tx)}/s</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <Download className="w-3.5 h-3.5 text-blue-500" />
                  <span className="text-theme-muted">Download:</span>
                  <span className="font-bold text-theme-fg">{formatBytes(metrics.net_rx)}/s</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-theme-muted">
              <Loader2 className="w-5 h-5 animate-spin mb-2" />
              <span className="text-xs">Loading performance data...</span>
            </div>
          )}
        </div>

        <div className="dashboard-card p-5 col-span-12">
          <h3 className="text-[10px] font-black text-theme-muted uppercase tracking-wider mb-4">Status</h3>
          <div className="grid grid-cols-3 gap-3">
            <StatusPill label="AI Agent" connected={engine.health_status === 'healthy'} detail={engine.health_status === 'healthy' ? 'Connected and ready' : 'Not connected'} />
            <StatusPill label="Heartbeat" connected={!!engine.last_heartbeat_at} detail={engine.last_heartbeat_at ? `Last: ${new Date(engine.last_heartbeat_at).toLocaleTimeString()}` : 'Waiting...'} />
            <StatusPill label="Network" connected={!!engine.external_ip} detail={engine.external_ip || 'Assigning...'} />
          </div>
        </div>
      </div>
    </div>
  );

  const monitoringPanel = (
    <div className="custom-scrollbar h-full overflow-y-auto p-6">
      {metrics ? (
        <CloudResourceMonitor metrics={metrics} expanded variant="workspace" />
      ) : (
        <div className="dashboard-card p-8 flex flex-col items-center justify-center py-20 text-theme-muted">
          <Loader2 className="w-6 h-6 animate-spin mb-3" />
          <span className="text-sm">Collecting data...</span>
        </div>
      )}
    </div>
  );

  if (engine.status === 'running') {
    return (
      <div className="h-full">
      <CloudRuntimeWorkspace
        engine={engine}
        pauseLoading={actionLoading === 'stop'}
        onPause={handlePause}
        onRefresh={refresh}
        onDelete={handleDelete}
        explorer={
          <CloudFileBrowser
            engine={engine}
            listFiles={listFiles}
            readFile={readFile}
            className="w-full h-full"
            variant="explorer"
          />
        }
        terminal={
          <CloudTerminalPanel
            engine={engine}
            className="w-full h-full"
            variant="workspace"
          />
        }
        views={{
          chat: <CloudVmChat engine={engine} className="h-full" variant="workspace" />,
          overview: overviewPanel,
          monitoring: monitoringPanel,
          billing: (
            <div className="custom-scrollbar h-full overflow-y-auto p-6">
              <BillingTab billing={billing} engine={engine} />
            </div>
          ),
          snapshots: (
            <div className="custom-scrollbar h-full overflow-y-auto p-6">
              <SnapshotsTab
                snapshots={snapshots}
                createSnapshot={createSnapshot}
                restoreSnapshot={restoreSnapshot}
                deleteSnapshot={deleteSnapshot}
              />
            </div>
          ),
          deploys: (
            <div className="custom-scrollbar h-full overflow-y-auto p-6">
              <DeploysTab
                deployments={deployments}
                engineRunning
                createDeployment={createDeployment}
                stopDeployment={stopDeployment}
                restartDeployment={restartDeployment}
                deleteDeployment={deleteDeployment}
                getDeployLogs={getDeployLogs}
                refreshDeployments={fetchDeployments}
              />
            </div>
          ),
          permissions: (
            <div className="custom-scrollbar h-full overflow-y-auto p-6">
              <CloudVmPermissions engine={engine} variant="workspace" />
            </div>
          ),
        }}
      />
      </div>
    );
  }

  // ─── Stopped / Other States → Overview with controls ─────────────
  const statusColor = engine.status === 'stopped' ? 'text-amber-500' : 'text-red-500';
  const statusBgColor = engine.status === 'stopped' ? 'bg-amber-500' : 'bg-red-500';
  const statusLabel = engine.status === 'stopped' ? 'Paused' : engine.status;

  return (
    <div className="h-full overflow-y-auto custom-scrollbar px-5 pb-5 pt-6 md:px-6 md:pb-6 md:pt-7">
    <div className="animate-in fade-in duration-500">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-black text-theme-fg tracking-tight">Cloud Engine</h1>
          <div className="flex items-center gap-3 mt-1">
            <div className="flex items-center gap-1.5">
              <div className={clsx('w-2 h-2 rounded-full', statusBgColor)} />
              <span className={clsx('text-sm font-bold capitalize', statusColor)}>{statusLabel}</span>
            </div>
            <span className="text-theme-muted text-xs">•</span>
            <span className="text-theme-muted text-xs font-medium capitalize">{engine.tier} tier</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={refresh} className="p-2.5 rounded-xl hover:bg-theme-hover text-theme-muted hover:text-theme-fg transition-all" title="Refresh">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={async () => { setActionLoading('start'); await start(); setActionLoading(null); }}
            disabled={actionLoading === 'start'}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-green-600/10 text-green-600 text-xs font-black hover:bg-green-600/20 transition-all disabled:opacity-50"
          >
            {actionLoading === 'start' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Power className="w-3.5 h-3.5" />}
            Resume
          </button>
          <button
            onClick={() => { if (confirm('This will permanently delete your cloud engine and all its data. Continue?')) destroy(); }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-600/10 text-red-500 text-xs font-black hover:bg-red-600/20 transition-all"
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-500 text-sm font-medium">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-6">
        <div className="rounded-2xl bg-theme-card/30 border border-theme/10 p-6 space-y-4">
          <h3 className="text-xs font-black text-theme-muted uppercase tracking-wider">Your Machine</h3>
          <div className="space-y-3">
            <InfoRow icon={Server} label="Name" value={engine.instance_name} />
            <InfoRow icon={Globe} label="Region" value={engine.zone} />
            <InfoRow icon={Cpu} label="Plan" value={engine.tier} capitalize />
            <InfoRow icon={Cpu} label="Machine" value={engine.vcpus && engine.ram_gb ? `${engine.vcpus} vCPU / ${engine.ram_gb} GB RAM` : '—'} />
            <InfoRow icon={HardDrive} label="Storage" value={`${engine.disk_size_gb} GB`} />
            {engine.external_ip && <InfoRow icon={Globe} label="Address" value={engine.external_ip} mono />}
            <InfoRow icon={Clock} label="Created" value={new Date(engine.created_at).toLocaleDateString()} />
          </div>
        </div>
        <div className="rounded-2xl bg-theme-card/30 border border-theme/10 p-6">
          <h3 className="text-xs font-black text-theme-muted uppercase tracking-wider mb-4">Status</h3>
          <div className="flex flex-col gap-4">
            <StatusPill label="AI Agent" connected={false} detail="Engine paused" />
            <StatusPill label="Network" connected={false} detail={engine.external_ip || 'No IP assigned'} />
          </div>
          <div className="mt-6 p-4 rounded-xl bg-theme-hover/30 text-center">
            <p className="text-xs text-theme-muted">Resume your engine to access chat, terminal, files, and more.</p>
          </div>
        </div>
      </div>
    </div>
    </div>
  );
}

/* ─── Billing Tab ─────────────────────────────────────────────────── */

function BillingTab({ billing, engine }: { billing: any; engine: any }) {
  const tier = engine?.tier || billing?.current_tier || '—';
  const planInfo = PLANS.find(p => p.id === tier);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <div className="dashboard-card p-5 !border-blue-500/20 bg-blue-500/5">
          <CreditCard className="w-5 h-5 text-blue-400 mb-2" />
          <div className="text-[10px] text-theme-muted font-bold uppercase tracking-wider">Total Credits Used</div>
          <div className="text-2xl font-black text-theme-fg mt-1">{(billing?.total_credits_used ?? 0).toFixed(2)}</div>
          <div className="text-[10px] text-theme-muted mt-0.5">this billing period</div>
        </div>
        <div className="dashboard-card p-5 !border-purple-500/20 bg-purple-500/5">
          <Cpu className="w-5 h-5 text-purple-400 mb-2" />
          <div className="text-[10px] text-theme-muted font-bold uppercase tracking-wider">Compute</div>
          <div className="text-2xl font-black text-theme-fg mt-1">{(billing?.compute_credits ?? 0).toFixed(2)}</div>
          <div className="text-[10px] text-theme-muted mt-0.5">credits for VM runtime</div>
        </div>
        <div className="dashboard-card p-5 !border-amber-500/20 bg-amber-500/5">
          <HardDrive className="w-5 h-5 text-amber-400 mb-2" />
          <div className="text-[10px] text-theme-muted font-bold uppercase tracking-wider">Storage</div>
          <div className="text-2xl font-black text-theme-fg mt-1">{(billing?.storage_credits ?? 0).toFixed(2)}</div>
          <div className="text-[10px] text-theme-muted mt-0.5">credits for disk + snapshots</div>
        </div>
      </div>

      <div className="dashboard-card p-5">
        <h3 className="text-[10px] font-black text-theme-muted uppercase tracking-wider mb-4">Current Plan</h3>
        <div className="grid grid-cols-4 gap-4">
          <div>
            <div className="text-[10px] text-theme-muted">Tier</div>
            <div className="text-sm font-bold text-theme-fg capitalize">{planInfo?.label || tier}</div>
          </div>
          <div>
            <div className="text-[10px] text-theme-muted">Status</div>
            <div className="text-sm font-bold text-theme-fg capitalize">{engine?.status || '—'}</div>
          </div>
          <div>
            <div className="text-[10px] text-theme-muted">Hours This Month</div>
            <div className="text-sm font-bold text-theme-fg">{(billing?.hours_this_month ?? 0).toFixed(1)} hrs</div>
          </div>
          <div>
            <div className="text-[10px] text-theme-muted">Rate</div>
            <div className="text-sm font-bold text-primary">{planInfo?.credits ?? '—'} credits/hr</div>
          </div>
        </div>
      </div>

      <div className="dashboard-card p-5">
        <h3 className="text-[10px] font-black text-theme-muted uppercase tracking-wider mb-4">Pricing Reference</h3>
        <div className="grid grid-cols-4 gap-3">
          {PLANS.map(p => (
            <div
              key={p.id}
              className={clsx(
                'rounded-xl p-3 border transition-all',
                tier === p.id
                  ? 'border-primary bg-primary/5'
                  : 'border-theme/10 bg-theme-card/20'
              )}
            >
              <div className="text-sm font-black text-theme-fg">{p.emoji} {p.label}</div>
              <div className="text-[10px] text-theme-muted mt-0.5">{p.vcpus} cores · {p.ram} GB</div>
              <div className="text-xs font-black text-primary mt-2">{p.credits} credits/hr</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Snapshots Tab ───────────────────────────────────────────────── */

function SnapshotsTab({
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

  const handleRestore = async (id: string) => {
    if (!confirm('Restore this snapshot? Current VM data will be overwritten.')) return;
    setActionId(id);
    await restoreSnapshot(id);
    setActionId(null);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this snapshot permanently?')) return;
    setActionId(id);
    await deleteSnapshot(id);
    setActionId(null);
  };

  const formatSize = (bytes?: number) => {
    if (!bytes) return '—';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <div className="flex-1">
          <input
            type="text"
            placeholder="Snapshot name (e.g. before-update)..."
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
            className="w-full px-4 py-3 text-sm bg-theme-card/30 border border-theme/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all text-theme-fg placeholder:text-theme-muted/50"
          />
        </div>
        <button
          onClick={handleCreate}
          disabled={creating || !newName.trim()}
          className="flex items-center gap-2 px-5 py-3 text-sm font-black bg-primary text-primary-fg rounded-xl hover:opacity-90 disabled:opacity-50 transition-all"
        >
          {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          {creating ? 'Creating...' : 'Create Snapshot'}
        </button>
      </div>

      {snapshots.length === 0 ? (
        <div className="dashboard-card p-8 flex flex-col items-center justify-center py-16 text-theme-muted">
          <Camera className="w-8 h-8 mb-3 opacity-30" />
          <div className="text-sm font-bold">No snapshots yet</div>
          <div className="text-xs mt-1">Create one to save your VM state</div>
        </div>
      ) : (
        <div className="space-y-3">
          {snapshots.map(snap => (
            <div
              key={snap.id}
              className="dashboard-card p-4 flex items-center justify-between hover:border-theme/20 transition-all"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Camera className="w-3.5 h-3.5 text-theme-muted shrink-0" />
                  <span className="text-sm font-bold text-theme-fg truncate">{snap.name}</span>
                  <span className={clsx(
                    'px-2 py-0.5 rounded-full text-[9px] font-black shrink-0',
                    snap.status === 'ready' ? 'bg-green-500/10 text-green-500' :
                    snap.status === 'creating' ? 'bg-blue-500/10 text-blue-400 animate-pulse' :
                    snap.status === 'failed' ? 'bg-red-500/10 text-red-500' :
                    'bg-theme-hover text-theme-muted'
                  )}>
                    {snap.status}
                  </span>
                </div>
                <div className="flex gap-4 mt-1 text-[10px] text-theme-muted pl-6">
                  <span>{new Date(snap.created_at).toLocaleString()}</span>
                  <span>{formatSize(snap.size_bytes)}</span>
                </div>
              </div>
              <div className="flex gap-2 shrink-0 ml-4">
                {snap.status === 'ready' && (
                  <button
                    onClick={() => handleRestore(snap.id)}
                    disabled={actionId === snap.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-blue-500/10 text-blue-400 rounded-lg hover:bg-blue-500/20 disabled:opacity-50 transition-all"
                  >
                    {actionId === snap.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                    Restore
                  </button>
                )}
                <button
                  onClick={() => handleDelete(snap.id)}
                  disabled={actionId === snap.id}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-red-500/10 text-red-400 rounded-lg hover:bg-red-500/20 disabled:opacity-50 transition-all"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Helpers ─────────────────────────────────────────────────────── */

function InfoRow({ icon: Icon, label, value, mono, capitalize }: { icon: any; label: string; value: string; mono?: boolean; capitalize?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <Icon className="w-4 h-4 text-theme-muted shrink-0" />
      <span className="text-xs text-theme-muted font-medium w-24">{label}</span>
      <span className={clsx('text-sm font-bold text-theme-fg', mono && 'font-mono text-xs', capitalize && 'capitalize')}>{value}</span>
    </div>
  );
}

function MetricBar({ label, value, unit, color }: { label: string; value: number; unit: string; color: string }) {
  const barColor = color === 'primary' ? 'bg-primary' : color === 'violet' ? 'bg-violet-500' : 'bg-amber-500';
  const v = Math.min(100, Math.max(0, value));
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-bold text-theme-fg">{label}</span>
        <span className="text-[10px] text-theme-muted font-medium">{unit}</span>
      </div>
      <div className="h-2 bg-theme-hover rounded-full overflow-hidden">
        <div className={clsx('h-full rounded-full transition-all duration-500', barColor)} style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

function StatusPill({ label, connected, detail }: { label: string; connected: boolean; detail: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-theme/10 bg-theme-card/20 p-4 flex-1">
      <div className={clsx('w-2.5 h-2.5 rounded-full', connected ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-gray-400')} />
      <div>
        <div className="text-xs font-bold text-theme-fg">{label}</div>
        <div className="text-[10px] text-theme-muted">{detail}</div>
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ─── Deploy Tab ──────────────────────────────────────────────────── */

type DeployKind = 'workflow' | 'script' | 'project';

interface DeployEntry {
  id: string;
  name: string;
  kind: DeployKind;
  description: string | null;
  status: string;
  auto_restart: boolean;
  schedule: string | null;
  pid: number | null;
  error_message: string | null;
  started_at: string | null;
  stopped_at: string | null;
  created_at: string;
}

function DeploysTab({
  deployments,
  engineRunning,
  createDeployment,
  stopDeployment,
  restartDeployment,
  deleteDeployment,
  getDeployLogs,
  refreshDeployments,
}: {
  deployments: DeployEntry[];
  engineRunning: boolean;
  createDeployment: (opts: any) => Promise<any>;
  stopDeployment: (id: string) => Promise<any>;
  restartDeployment: (id: string) => Promise<any>;
  deleteDeployment: (id: string) => Promise<any>;
  getDeployLogs: (id: string, lines?: number) => Promise<string>;
  refreshDeployments: () => Promise<void>;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [logsId, setLogsId] = useState<string | null>(null);
  const [logs, setLogs] = useState('');
  const [logsLoading, setLogsLoading] = useState(false);

  // ── Create form state ──
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<DeployKind>('workflow');
  const [newDesc, setNewDesc] = useState('');
  const [newPayload, setNewPayload] = useState('');
  const [newEnvVars, setNewEnvVars] = useState('');
  const [newAutoRestart, setNewAutoRestart] = useState(true);
  const [newSchedule, setNewSchedule] = useState('');

  const handleCreate = async () => {
    if (!newName.trim() || !newPayload.trim()) return;
    setCreating(true);
    try {
      let payload: any;
      try {
        payload = JSON.parse(newPayload);
      } catch {
        // Treat as raw script content
        payload = newKind === 'script' ? { content: newPayload, language: 'auto' } : newPayload;
      }

      const envVars: Record<string, string> = {};
      if (newEnvVars.trim()) {
        for (const line of newEnvVars.split('\n')) {
          const eq = line.indexOf('=');
          if (eq > 0) envVars[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
        }
      }

      await createDeployment({
        name: newName.trim(),
        kind: newKind,
        description: newDesc.trim() || undefined,
        payload,
        envVars: Object.keys(envVars).length > 0 ? envVars : undefined,
        autoRestart: newAutoRestart,
        schedule: newSchedule.trim() || undefined,
      });
      setShowCreate(false);
      setNewName('');
      setNewPayload('');
      setNewDesc('');
      setNewEnvVars('');
      setNewSchedule('');
    } finally {
      setCreating(false);
    }
  };

  const handleStop = async (id: string) => {
    setActionId(id);
    await stopDeployment(id);
    setActionId(null);
  };

  const handleRestart = async (id: string) => {
    setActionId(id);
    await restartDeployment(id);
    setActionId(null);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this deployment? This action cannot be undone.')) return;
    setActionId(id);
    await deleteDeployment(id);
    setActionId(null);
  };

  const handleViewLogs = async (id: string) => {
    if (logsId === id) { setLogsId(null); return; }
    setLogsId(id);
    setLogsLoading(true);
    const content = await getDeployLogs(id);
    setLogs(content);
    setLogsLoading(false);
  };

  const refreshLogs = async () => {
    if (!logsId) return;
    setLogsLoading(true);
    const content = await getDeployLogs(logsId);
    setLogs(content);
    setLogsLoading(false);
  };

  const statusConfig: Record<string, { color: string; bg: string; icon: any; label: string }> = {
    running: { color: 'text-green-500', bg: 'bg-green-500/10', icon: CheckCircle2, label: 'Running' },
    stopped: { color: 'text-gray-400', bg: 'bg-gray-400/10', icon: Circle, label: 'Stopped' },
    failed: { color: 'text-red-500', bg: 'bg-red-500/10', icon: AlertCircle, label: 'Failed' },
    deploying: { color: 'text-blue-400', bg: 'bg-blue-500/10', icon: Loader2, label: 'Deploying' },
    pending: { color: 'text-amber-400', bg: 'bg-amber-500/10', icon: Clock, label: 'Pending' },
    uploading: { color: 'text-blue-400', bg: 'bg-blue-500/10', icon: Upload, label: 'Uploading' },
    completed: { color: 'text-green-500', bg: 'bg-green-500/10', icon: CheckCircle2, label: 'Completed' },
  };

  const kindEmoji: Record<string, string> = { workflow: '🔄', script: '📜', project: '📦' };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-black text-theme-fg">Deployments</h3>
          <p className="text-xs text-theme-muted mt-0.5">Deploy workflows, scripts, and projects to your Cloud Engine</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={refreshDeployments} className="p-2 rounded-lg hover:bg-theme-hover text-theme-muted hover:text-theme-fg transition-all">
            <RefreshCw className="w-4 h-4" />
          </button>
          {engineRunning && (
            <button
              onClick={() => setShowCreate(!showCreate)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary/10 text-primary text-xs font-black hover:bg-primary/20 transition-all"
            >
              <Plus className="w-3.5 h-3.5" /> New Deploy
            </button>
          )}
        </div>
      </div>

      {!engineRunning && (
        <div className="dashboard-card p-6 bg-amber-500/5 !border-amber-500/20 text-center">
          <Rocket className="w-8 h-8 text-amber-500 mx-auto mb-2 opacity-60" />
          <p className="text-sm font-bold text-amber-500">Engine not running</p>
          <p className="text-xs text-theme-muted mt-1">Start your Cloud Engine to deploy and manage workloads</p>
        </div>
      )}

      {showCreate && (
        <div className="dashboard-card p-6 !border-primary/20 bg-theme-card/50 space-y-4 animate-in slide-in-from-top-2 duration-200">
          <h4 className="text-sm font-black text-theme-fg flex items-center gap-2">
            <Rocket className="w-4 h-4 text-primary" /> New Deployment
          </h4>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-bold text-theme-muted uppercase tracking-wider block mb-1">Name</label>
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="My Workflow"
                className="w-full px-3 py-2 text-sm rounded-lg bg-theme-hover border border-theme/10 text-theme-fg placeholder:text-theme-muted/50 focus:outline-none focus:border-primary/40"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-theme-muted uppercase tracking-wider block mb-1">Type</label>
              <div className="flex gap-2">
                {(['workflow', 'script', 'project'] as DeployKind[]).map(k => (
                  <button
                    key={k}
                    onClick={() => setNewKind(k)}
                    className={clsx(
                      'flex-1 px-3 py-2 text-xs font-bold rounded-lg border transition-all',
                      newKind === k ? 'border-primary/40 bg-primary/10 text-primary' : 'border-theme/10 bg-theme-hover text-theme-muted hover:text-theme-fg'
                    )}
                  >
                    {kindEmoji[k]} {k.charAt(0).toUpperCase() + k.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="text-[10px] font-bold text-theme-muted uppercase tracking-wider block mb-1">Description (optional)</label>
            <input
              type="text"
              value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
              placeholder="Brief description of this deployment"
              className="w-full px-3 py-2 text-sm rounded-lg bg-theme-hover border border-theme/10 text-theme-fg placeholder:text-theme-muted/50 focus:outline-none focus:border-primary/40"
            />
          </div>

          <div>
            <label className="text-[10px] font-bold text-theme-muted uppercase tracking-wider block mb-1">
              {newKind === 'workflow' ? 'Workflow JSON' : newKind === 'script' ? 'Script Content' : 'Project Manifest (JSON)'}
            </label>
            <textarea
              value={newPayload}
              onChange={e => setNewPayload(e.target.value)}
              placeholder={newKind === 'workflow' ? '{\n  "name": "My Workflow",\n  "version": "1",\n  "steps": [...]\n}' : newKind === 'script' ? '#!/usr/bin/env python3\nprint("Hello from the cloud!")' : '{\n  "files": {},\n  "packageJson": {},\n  "startCommand": "npm start"\n}'}
              rows={8}
              className="w-full px-3 py-2 text-xs font-mono rounded-lg bg-theme-hover border border-theme/10 text-theme-fg placeholder:text-theme-muted/50 focus:outline-none focus:border-primary/40 resize-y"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-bold text-theme-muted uppercase tracking-wider block mb-1">Environment Variables (optional)</label>
              <textarea
                value={newEnvVars}
                onChange={e => setNewEnvVars(e.target.value)}
                placeholder="KEY=value&#10;ANOTHER_KEY=value"
                rows={3}
                className="w-full px-3 py-2 text-xs font-mono rounded-lg bg-theme-hover border border-theme/10 text-theme-fg placeholder:text-theme-muted/50 focus:outline-none focus:border-primary/40 resize-y"
              />
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-bold text-theme-muted uppercase tracking-wider block mb-1">Schedule (cron, optional)</label>
                <input
                  type="text"
                  value={newSchedule}
                  onChange={e => setNewSchedule(e.target.value)}
                  placeholder="0 */6 * * *"
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg bg-theme-hover border border-theme/10 text-theme-fg placeholder:text-theme-muted/50 focus:outline-none focus:border-primary/40"
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={newAutoRestart} onChange={e => setNewAutoRestart(e.target.checked)} className="rounded border-theme/20 text-primary" />
                <span className="text-xs font-bold text-theme-muted">Auto-restart on crash</span>
              </label>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 text-xs font-bold text-theme-muted hover:text-theme-fg rounded-lg transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={creating || !newName.trim() || !newPayload.trim()}
              className="flex items-center gap-2 px-5 py-2 bg-primary text-white text-xs font-black rounded-xl hover:bg-primary/90 transition-all disabled:opacity-50"
            >
              {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Rocket className="w-3.5 h-3.5" />}
              Deploy
            </button>
          </div>
        </div>
      )}

      {deployments.length === 0 && !showCreate && (
        <div className="dashboard-card p-12 text-center">
          <Rocket className="w-10 h-10 text-theme-muted mx-auto mb-3 opacity-30" />
          <p className="text-sm font-bold text-theme-muted">No deployments yet</p>
          <p className="text-xs text-theme-muted/70 mt-1">Deploy a workflow, script, or project to your Cloud Engine</p>
        </div>
      )}

      {deployments.length > 0 && (
        <div className="space-y-3">
          {deployments.map(dep => {
            const sc = statusConfig[dep.status] || statusConfig.stopped;
            const StatusIcon = sc.icon;
            const isActive = dep.status === 'running' || dep.status === 'deploying' || dep.status === 'pending' || dep.status === 'uploading';

            return (
              <div key={dep.id}>
                <div className="dashboard-card p-4 flex items-center justify-between hover:border-theme/20 transition-all">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-base">{kindEmoji[dep.kind] || '📄'}</span>
                      <span className="text-sm font-bold text-theme-fg truncate">{dep.name}</span>
                      <span className={clsx('flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black shrink-0', sc.bg, sc.color)}>
                        <StatusIcon className={clsx('w-2.5 h-2.5', dep.status === 'deploying' && 'animate-spin')} />
                        {sc.label}
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-theme-hover text-theme-muted shrink-0">
                        {dep.kind}
                      </span>
                    </div>
                    <div className="flex gap-4 mt-1 text-[10px] text-theme-muted pl-7">
                      {dep.description && <span className="truncate max-w-[200px]">{dep.description}</span>}
                      <span>Created {new Date(dep.created_at).toLocaleString()}</span>
                      {dep.pid && <span>PID {dep.pid}</span>}
                      {dep.schedule && <span>⏰ {dep.schedule}</span>}
                      {dep.auto_restart && <span>🔁 auto-restart</span>}
                    </div>
                    {dep.error_message && (
                      <div className="flex items-center gap-1.5 mt-1.5 pl-7 text-[10px] text-red-400">
                        <AlertCircle className="w-3 h-3 shrink-0" />
                        <span className="truncate">{dep.error_message}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0 ml-4">
                    <button
                      onClick={() => handleViewLogs(dep.id)}
                      className={clsx(
                        'flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-all',
                        logsId === dep.id ? 'bg-primary/10 text-primary' : 'bg-theme-hover text-theme-muted hover:text-theme-fg'
                      )}
                    >
                      <ScrollText className="w-3 h-3" /> Logs
                    </button>
                    {dep.status === 'running' && (
                      <button
                        onClick={() => handleStop(dep.id)}
                        disabled={actionId === dep.id}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-amber-500/10 text-amber-400 rounded-lg hover:bg-amber-500/20 disabled:opacity-50 transition-all"
                      >
                        {actionId === dep.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Square className="w-3 h-3" />}
                        Stop
                      </button>
                    )}
                    {(dep.status === 'stopped' || dep.status === 'failed' || dep.status === 'completed') && (
                      <button
                        onClick={() => handleRestart(dep.id)}
                        disabled={actionId === dep.id}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-green-500/10 text-green-400 rounded-lg hover:bg-green-500/20 disabled:opacity-50 transition-all"
                      >
                        {actionId === dep.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                        Restart
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(dep.id)}
                      disabled={actionId === dep.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-red-500/10 text-red-400 rounded-lg hover:bg-red-500/20 disabled:opacity-50 transition-all"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {/* Logs panel */}
                {logsId === dep.id && (
                  <div className="mt-2 rounded-xl border border-theme/10 bg-[#0d1117] overflow-hidden animate-in slide-in-from-top-1 duration-150">
                    <div className="flex items-center justify-between px-4 py-2 border-b border-theme/10">
                      <span className="text-[10px] font-black text-theme-muted uppercase tracking-wider">Deploy Logs — {dep.name}</span>
                      <div className="flex items-center gap-2">
                        <button onClick={refreshLogs} className="text-theme-muted hover:text-theme-fg transition-all">
                          <RefreshCw className={clsx('w-3 h-3', logsLoading && 'animate-spin')} />
                        </button>
                        <button onClick={() => setLogsId(null)} className="text-theme-muted hover:text-theme-fg transition-all">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    <pre className="p-4 text-[11px] font-mono text-green-400/90 overflow-auto max-h-[300px] whitespace-pre-wrap leading-relaxed">
                      {logsLoading ? 'Loading logs...' : (logs || 'No logs available yet.')}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
