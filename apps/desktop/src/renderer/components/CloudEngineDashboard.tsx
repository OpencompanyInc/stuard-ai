import React, { useState } from 'react';
import { clsx } from 'clsx';
import {
  Cloud, Server, Activity, Power, Trash2,
  RefreshCw, Loader2, HardDrive, Globe, Clock, Cpu,
  Download, Upload, Zap, Shield,
  CreditCard, Plus, Rocket,
  CheckCircle2, Circle,
  Workflow,
} from 'lucide-react';
import { useCloudEngine, type CloudDeployment } from '../hooks/useCloudEngine';
import { CloudTerminalPanel } from './CloudTerminalPanel';
import { CloudFileBrowser } from './CloudFileBrowser';
import { CloudResourceMonitor } from './CloudResourceMonitor';
import { CloudVmChat } from './CloudVmChat';
import { CloudVmPermissions } from './CloudVmPermissions';
import { CloudVmIntegrations } from './CloudVmIntegrations';
import { CloudVmSettings } from './CloudVmSettings';
import { CloudRuntimeWorkspace } from './CloudRuntimeWorkspace';
import { CloudAutomationsPanel } from '@stuardai/cloud-runtime-ui';
import { BotsView } from './BotsView';
import { useConfirm } from './ConfirmDialog';

const CREDITS_PER_USD = 33;
const STORAGE_USD_PER_GB_MONTH = 0.10;
const HOURS_PER_MONTH = 730;

function creditsFromUsd(usd: number): number {
  return Math.max(0, Math.round(usd * CREDITS_PER_USD));
}

function estimateCustomComputeCredits(vcpus: number, ramGb: number): number {
  return creditsFromUsd((vcpus * 0.022) + (ramGb * 0.003));
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

type ConfigSliderProps = {
  icon: any;
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  minLabel: string;
  maxLabel: string;
  valueLabel: string;
  onChange: (value: number) => void;
};

function ConfigSlider({
  icon: Icon,
  label,
  hint,
  value,
  min,
  max,
  step,
  minLabel,
  maxLabel,
  valueLabel,
  onChange,
}: ConfigSliderProps) {
  const percent = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  const sliderBackground = `linear-gradient(90deg, var(--primary) 0%, var(--primary) ${percent}%, var(--border) ${percent}%, var(--border) 100%)`;

  return (
    <div className="rounded-[20px] border border-[color:var(--dashboard-panel-border)] bg-zinc-500/10 px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold text-theme-fg">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-theme-hover/55 text-primary">
              <Icon className="h-3 w-3" />
            </span>
            {label}
          </div>
          <p className="mt-1 text-[11px] leading-5 text-theme-muted">{hint}</p>
        </div>
        <div className="rounded-full bg-theme-hover/60 px-2.5 py-1 text-[11px] font-black text-primary">
          {valueLabel}
        </div>
      </div>

      <div className="mt-3">
        <div className="rounded-full bg-black/10 px-1 py-2">
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={e => onChange(Number(e.target.value))}
            style={{ background: sliderBackground }}
            className="h-2 w-full cursor-pointer appearance-none rounded-full bg-transparent transition-[background] duration-150 focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/15 [&::-webkit-slider-runnable-track]:h-2 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:-mt-[4px] [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-theme-card [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_2px_10px_rgba(0,0,0,0.35)] [&::-moz-range-track]:h-2 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-transparent [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-theme-card [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow-[0_2px_10px_rgba(0,0,0,0.35)]"
          />
        </div>

        <div className="mt-2 flex items-center justify-between text-[10px] font-medium text-theme-muted">
          <span>{minLabel}</span>
          <span>{maxLabel}</span>
        </div>
      </div>
    </div>
  );
}

export function CloudEngineDashboard() {
  const {
    engine, loading, error, metrics, billing, syncStatus, isSyncing, deployments,
    provision, start, stop, destroy, syncData, listFiles, readFile, readFileFull, getServeUrl, getPreviewUrl,
    uploadFileToVm, createDirectory, deleteFile,
    refresh,
    createDeployment, stopDeployment, restartDeployment, deleteDeployment,
    getDeployLogs, fetchDeployments,
  } = useCloudEngine();
  const [selectedPlan, setSelectedPlan] = useState('pro');
  const [customMode, setCustomMode] = useState(false);
  const [customCpu, setCustomCpu] = useState(2);
  const [customRam, setCustomRam] = useState(4);
  const [customDisk, setCustomDisk] = useState(20);
  const [provisioning, setProvisioning] = useState(false);
  const [confirm, confirmDialog] = useConfirm();
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // ─── Provision Flow ────────────────────────────────────────────────
  if (!engine && !loading) {
    const plan = PLANS.find(p => p.id === selectedPlan)!;
    const diskCredits = estimateStorageCredits(customMode ? customDisk : plan.disk);
    const cpuCredits = customMode ? estimateCustomComputeCredits(customCpu, customRam) : plan.credits;
    const totalCredits = cpuCredits + diskCredits;
    const selectedStorageGb = customMode ? customDisk : plan.disk;
    const architectureHighlights = [
      {
        icon: Zap,
        title: 'Persistent Execution',
        description: 'Workloads run autonomously 24/7, entirely independent of your local machine.',
      },
      {
        icon: Shield,
        title: 'Isolated Sandboxes',
        description: 'Dedicated instances secured with encrypted storage and private networking.',
      },
      {
        icon: Rocket,
        title: 'Rapid Provisioning',
        description: 'Spin up a fully configured environment in under 60 seconds.',
      },
    ] as const;

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
      <div className="cloud-engine-dashboard h-full overflow-y-auto custom-scrollbar px-5 pb-5 pt-6 md:px-6 md:pb-6 md:pt-7">
      <div className="animate-in fade-in duration-500">
        {/* Hero */}
        <div className="mb-7">
          <div className="mb-1.5 flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10">
              <Cloud className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tight text-theme-fg">Cloud Engine</h1>
              <p className="text-xs text-theme-muted sm:text-sm">Your personal AI computer in the cloud — always on, always ready.</p>
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

        <div className="grid gap-5 xl:grid-cols-12 xl:items-start">
          <div className="space-y-5 xl:col-span-7">
            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-black text-theme-fg">{customMode ? 'Custom Configuration' : 'Select Compute Tier'}</h2>
                <p className="mt-1 text-xs text-theme-muted">
                  {customMode
                    ? 'Tune CPU, memory, and storage, then deploy from the panel on the right.'
                    : 'Compare the presets side by side, then deploy from the summary panel on the right.'}
                </p>
              </div>
              <button
                onClick={() => setCustomMode(prev => !prev)}
                className={clsx(
                  'inline-flex items-center gap-2 self-start rounded-full border px-3.5 py-1.5 text-[11px] font-semibold transition shadow-sm',
                  customMode
                    ? 'border-theme/10 bg-zinc-500/10 text-theme-fg hover:bg-zinc-500/14'
                    : 'border-theme/10 bg-zinc-500/10 text-theme-fg hover:bg-zinc-500/14'
                )}
              >
                <Cpu className="h-3 w-3 text-primary" />
                {customMode ? 'Back To Tiers' : 'Custom Configuration'}
              </button>
            </div>

            {!customMode && (
              <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
                {PLANS.map(p => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedPlan(p.id)}
                    className={clsx(
                      'relative flex min-h-[182px] flex-col rounded-[24px] border-2 p-4 text-left transition-all duration-200',
                      selectedPlan === p.id
                        ? 'border-primary bg-zinc-500/10'
                        : 'border-theme/10 bg-zinc-500/10 hover:border-theme/20 hover:bg-zinc-500/14'
                    )}
                  >
                    {p.popular && (
                      <span className="absolute -top-2 right-2.5 rounded-full bg-primary px-2 py-0.5 text-[8px] font-black text-primary-fg shadow-lg shadow-primary/30">
                        Best Value
                      </span>
                    )}
                    <div className="mb-2.5 text-lg">{p.emoji}</div>
                    <div className="text-xl font-black text-theme-fg">{p.label}</div>
                    <div className="mt-1.5 max-w-[22rem] text-xs leading-5 text-theme-muted">{p.tagline}</div>

                    <div className="mt-4 flex items-baseline gap-1.5">
                      <span className="text-2xl font-black text-primary">{p.credits}</span>
                      <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-theme-muted">credits/{p.creditsPer}</span>
                    </div>

                    <div className="mt-4 space-y-1.5 text-xs text-theme-muted">
                      {p.features.map((feature, index) => (
                        <div key={index} className="flex items-start gap-2">
                          <span className="mt-1 h-1 w-1 rounded-full bg-primary/80" />
                          <span>{feature}</span>
                        </div>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {customMode && (
              <div className="rounded-[24px] border border-[color:var(--dashboard-panel-border)] bg-theme-card/30 p-5 space-y-4">
                <ConfigSlider
                  icon={Cpu}
                  label="CPU Cores"
                  hint="Scale compute for heavier agents and concurrent runs."
                  value={customCpu}
                  min={1}
                  max={16}
                  step={1}
                  minLabel="1 core"
                  maxLabel="16 cores"
                  valueLabel={`${customCpu} cores`}
                  onChange={setCustomCpu}
                />

                <ConfigSlider
                  icon={Server}
                  label="Memory (RAM)"
                  hint="Increase memory for larger contexts and multi-step workflows."
                  value={customRam}
                  min={1}
                  max={64}
                  step={1}
                  minLabel="1 GB"
                  maxLabel="64 GB"
                  valueLabel={`${customRam} GB`}
                  onChange={setCustomRam}
                />

                <ConfigSlider
                  icon={HardDrive}
                  label="Storage"
                  hint="Reserve persistent space for your workspace, files, and backups."
                  value={customDisk}
                  min={10}
                  max={500}
                  step={10}
                  minLabel="10 GB"
                  maxLabel="500 GB"
                  valueLabel={`${customDisk} GB`}
                  onChange={setCustomDisk}
                />
              </div>
            )}
          </div>

          <aside className="space-y-3.5 xl:col-span-5 xl:sticky xl:top-5">
            <div>
              <h3 className="text-sm font-black text-theme-fg">Core Architecture</h3>
              <div className="mt-2.5 space-y-2.5">
                {architectureHighlights.map(item => (
                  <div key={item.title} className="relative overflow-hidden rounded-[20px] border border-[color:var(--dashboard-panel-border)] bg-zinc-500/10 p-3.5">
                    <div className="pointer-events-none absolute inset-y-0 right-0 w-20 bg-gradient-to-l from-primary/18 via-primary/6 to-transparent" />
                    <div className="relative">
                      <div className="flex items-center gap-1.5">
                        <item.icon className="h-3.5 w-3.5 text-primary" />
                        <div className="text-base font-semibold text-theme-fg">{item.title}</div>
                      </div>
                      <p className="mt-1.5 text-xs leading-5 text-theme-muted">{item.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[24px] border border-[color:var(--dashboard-panel-border)] bg-zinc-500/10 p-4 shadow-xl shadow-black/10">
              <h3 className="text-sm font-black text-theme-fg">Resource Allocation</h3>
              <div className="mt-3 space-y-2.5">
                <div className="rounded-xl bg-theme-hover/35 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-4 text-xs">
                    <span className="text-theme-muted">Credit Usage</span>
                    <span className="text-right font-black text-theme-fg">{cpuCredits} credits/hr</span>
                  </div>
                </div>
                <div className="rounded-xl bg-theme-hover/35 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-4 text-xs">
                    <span className="text-theme-muted">Storage</span>
                    <span className="text-right font-black text-theme-fg">{selectedStorageGb} GB</span>
                  </div>
                </div>
                <div className="border-t border-theme/10 pt-3 text-center text-[10px] leading-5 text-theme-muted">
                  {totalCredits * 24} credits/day or {(totalCredits * 24 * 30 / 1000).toFixed(1)}k credits/month
                </div>
              </div>

              <button
                onClick={handleProvision}
                disabled={provisioning}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-black text-primary-fg transition hover:opacity-90 disabled:opacity-50 shadow-xl shadow-primary/20"
              >
                {provisioning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
                {provisioning ? 'Setting up your cloud engine...' : 'Deploy Cloud Engine'}
              </button>
              <p className="mt-3 text-center text-[10px] text-theme-muted">
                You can stop or delete your engine at any time. Credits are only used while running.
              </p>
            </div>
          </aside>
        </div>
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
      <div className="cloud-engine-dashboard h-full overflow-y-auto custom-scrollbar px-5 pb-5 pt-6 md:px-6 md:pb-6 md:pt-7">
      {confirmDialog}
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
      {confirmDialog}
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
            <div className="mt-6 p-4 rounded-2xl bg-theme-card/30 border border-[color:var(--dashboard-panel-border)] space-y-2">
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
              onClick={async () => {
                const ok = await confirm({
                  title: 'Delete cloud engine?',
                  message: 'This will permanently delete your cloud engine and all of its data. This action cannot be undone.',
                  confirmLabel: 'Delete engine',
                  destructive: true,
                });
                if (ok) destroy();
              }}
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

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Delete cloud engine?',
      message: 'This will permanently delete your cloud engine and all of its data. This action cannot be undone.',
      confirmLabel: 'Delete engine',
      destructive: true,
    });
    if (ok) {
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
          <div className="grid grid-cols-4 gap-3">
            <StatusPill label="AI Agent" connected={engine.health_status === 'healthy'} detail={engine.health_status === 'healthy' ? 'Connected and ready' : 'Not connected'} />
            <StatusPill label="Heartbeat" connected={!!engine.last_heartbeat_at} detail={engine.last_heartbeat_at ? `Last: ${new Date(engine.last_heartbeat_at).toLocaleTimeString()}` : 'Waiting...'} />
            <StatusPill label="Network" connected={!!engine.external_ip} detail={engine.external_ip || 'Assigning...'} />
            <SyncStatusPill syncStatus={syncStatus} isSyncing={isSyncing} onSync={syncData} />
          </div>
        </div>

        {/* Sync Details */}
        {syncStatus && (syncStatus.vm || syncStatus.desktop) && (
          <div className="dashboard-card p-5 col-span-12">
            <h3 className="text-[10px] font-black text-theme-muted uppercase tracking-wider mb-4">Memory Sync</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="text-[10px] font-bold text-theme-muted uppercase tracking-wider flex items-center gap-1.5">
                  <Server className="w-3 h-3" /> Desktop
                </div>
                {syncStatus.desktop ? (
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs"><span className="text-theme-muted">Conversations</span><span className="font-bold text-theme-fg">{syncStatus.desktop.conversations}</span></div>
                    <div className="flex justify-between text-xs"><span className="text-theme-muted">Messages</span><span className="font-bold text-theme-fg">{syncStatus.desktop.messages}</span></div>
                    <div className="flex justify-between text-xs"><span className="text-theme-muted">Projects</span><span className="font-bold text-theme-fg">{syncStatus.desktop.projects}</span></div>
                    <div className="flex justify-between text-xs"><span className="text-theme-muted">Segments</span><span className="font-bold text-theme-fg">{syncStatus.desktop.segments}</span></div>
                  </div>
                ) : (
                  <div className="text-xs text-theme-muted/60 italic">No data available</div>
                )}
              </div>
              <div className="space-y-2">
                <div className="text-[10px] font-bold text-theme-muted uppercase tracking-wider flex items-center gap-1.5">
                  <Cloud className="w-3 h-3" /> Cloud VM
                </div>
                {syncStatus.vm ? (
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs"><span className="text-theme-muted">Memories</span><span className="font-bold text-theme-fg">{syncStatus.vm.memories}</span></div>
                    <div className="flex justify-between text-xs"><span className="text-theme-muted">Conversations</span><span className="font-bold text-theme-fg">{syncStatus.vm.conversations}</span></div>
                    <div className="flex justify-between text-xs"><span className="text-theme-muted">Topics</span><span className="font-bold text-theme-fg">{syncStatus.vm.topics}</span></div>
                    <div className="flex justify-between text-xs"><span className="text-theme-muted">Disk</span><span className="font-bold text-theme-fg">{(syncStatus.vm.diskBytes / 1024).toFixed(1)} KB</span></div>
                    {syncStatus.vm.byOrigin && (
                      <div className="pt-1.5 mt-1.5 border-t border-theme/10">
                        <div className="text-[9px] font-bold text-theme-muted uppercase tracking-wider mb-1">Origin Breakdown</div>
                        <div className="flex justify-between text-xs"><span className="text-theme-muted">From Cloud VM</span><span className="font-bold text-theme-fg">{syncStatus.vm.byOrigin.cloud_vm}</span></div>
                        <div className="flex justify-between text-xs"><span className="text-theme-muted">From Desktop</span><span className="font-bold text-theme-fg">{syncStatus.vm.byOrigin.desktop}</span></div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-theme-muted/60 italic">VM not reachable</div>
                )}
              </div>
            </div>
            {syncStatus.lastSyncAt && (
              <div className="mt-3 pt-3 border-t border-theme/10 text-[10px] text-theme-muted">
                Last synced: {new Date(syncStatus.lastSyncAt).toLocaleString()}
              </div>
            )}
          </div>
        )}
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
      <div className="cloud-engine-dashboard h-full">
      {confirmDialog}
      <CloudRuntimeWorkspace
        engine={engine}
        pauseLoading={actionLoading === 'stop'}
        syncState={isSyncing ? 'syncing' : (syncStatus?.state || 'unknown')}
        onPause={handlePause}
        onRefresh={refresh}
        onDelete={handleDelete}
        onSync={syncData}
        fileFetcher={readFileFull}
        serveUrlBuilder={getServeUrl}
        previewUrlBuilder={getPreviewUrl}
        explorer={
          <CloudFileBrowser
            engine={engine}
            listFiles={listFiles}
            readFile={readFile}
            uploadFileToVm={uploadFileToVm}
            createDirectory={createDirectory}
            deleteFile={deleteFile}
            onPickFile={(entry) => {
              // Click-in-nav opens the file in the right-side viewer pane.
              // Attach-to-chat lives as an action button inside the pane.
              try {
                (window as any).__cloudVmFileViewerOpen?.({
                  path: entry.path,
                  name: entry.name,
                  source: 'vm',
                  meta: { size: entry.size },
                });
              } catch { /* noop */ }
            }}
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
          integrations: (
            <CloudVmIntegrations engine={engine} className="h-full" />
          ),
          permissions: (
            <div className="custom-scrollbar h-full overflow-y-auto p-6">
              <CloudVmPermissions engine={engine} variant="workspace" />
            </div>
          ),
          bots: (
            <div className="custom-scrollbar h-full overflow-y-auto p-6">
              <BotsView scope="vm" />
            </div>
          ),
          // "Automations" renders the full, working DeploysTab (the old
          // VmAutomationsTab was a broken duplicate; the separate "Deploys"
          // nav entry has been removed in favor of this single view).
          automations: (
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
          settings: (
            <CloudVmSettings engine={engine} className="h-full" />
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
    <div className="cloud-engine-dashboard h-full overflow-y-auto custom-scrollbar px-5 pb-5 pt-6 md:px-6 md:pb-6 md:pt-7">
    {confirmDialog}
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
            onClick={async () => {
              const ok = await confirm({
                title: 'Delete cloud engine?',
                message: 'This will permanently delete your cloud engine and all of its data. This action cannot be undone.',
                confirmLabel: 'Delete engine',
                destructive: true,
              });
              if (ok) destroy();
            }}
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
        <div className="rounded-2xl bg-theme-card/30 border border-[color:var(--dashboard-panel-border)] p-6 space-y-4">
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
        <div className="rounded-2xl bg-theme-card/30 border border-[color:var(--dashboard-panel-border)] p-6">
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
    <div className="flex items-center gap-3 rounded-2xl border border-[color:var(--dashboard-panel-border)] bg-theme-card/20 p-4 flex-1">
      <div className={clsx('w-2.5 h-2.5 rounded-full', connected ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-gray-400')} />
      <div>
        <div className="text-xs font-bold text-theme-fg">{label}</div>
        <div className="text-[10px] text-theme-muted">{detail}</div>
      </div>
    </div>
  );
}

function SyncStatusPill({ syncStatus, isSyncing, onSync }: { syncStatus: any; isSyncing: boolean; onSync: () => Promise<any> }) {
  const state = isSyncing ? 'syncing' : (syncStatus?.state || 'unknown');
  const colorMap: Record<string, { dot: string; text: string; bg: string }> = {
    synced: { dot: 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]', text: 'text-green-500', bg: 'border-green-500/20' },
    out_of_sync: { dot: 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]', text: 'text-amber-500', bg: 'border-amber-500/20' },
    syncing: { dot: 'bg-blue-400 animate-pulse shadow-[0_0_8px_rgba(96,165,250,0.5)]', text: 'text-blue-400', bg: 'border-blue-400/20' },
    unknown: { dot: 'bg-gray-400', text: 'text-gray-400', bg: 'border-theme/10' },
  };
  const colors = colorMap[state] || colorMap.unknown;
  const labelMap: Record<string, string> = {
    synced: 'Synced',
    out_of_sync: 'Out of Sync',
    syncing: 'Syncing...',
    unknown: 'Unknown',
  };

  return (
    <div className={clsx('flex items-center gap-3 rounded-2xl border bg-theme-card/20 p-4 flex-1', colors.bg)}>
      <div className={clsx('w-2.5 h-2.5 rounded-full shrink-0', colors.dot)} />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-bold text-theme-fg">Memory Sync</div>
        <div className={clsx('text-[10px] font-medium', colors.text)}>{labelMap[state]}</div>
      </div>
      {state !== 'syncing' && (
        <button
          onClick={onSync}
          disabled={isSyncing}
          className="p-1.5 rounded-lg hover:bg-theme-hover/60 text-theme-muted hover:text-primary transition-colors disabled:opacity-50"
          title="Sync now"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      )}
      {state === 'syncing' && (
        <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400 shrink-0" />
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ─── Deploy Tab ──────────────────────────────────────────────────── */

type DeployKind = 'workflow' | 'project';

interface DeployEntry {
  id: string;
  name: string;
  kind: DeployKind;
  description: string | null;
  status: string;
  auto_restart: boolean;
  schedule: string | null;
  pid: number | null;
  logs_tail?: string | null;
  source_workflow_id?: string | null;
  trigger_bindings?: Array<{ triggerId: string; type: string; mode?: string | null; args?: Record<string, any> }>;
  timezone?: string | null;
  run_count?: number;
  last_run_at?: string | null;
  last_completed_at?: string | null;
  last_trigger_source?: string | null;
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
  const [confirm, confirmDialog] = useConfirm();

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
        payload = newPayload;
      }

      const envVars: Record<string, string> = {};
      if (newEnvVars.trim()) {
        for (const line of newEnvVars.split('\n')) {
          const eq = line.indexOf('=');
          if (eq > 0) envVars[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
        }
      }
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      if (!envVars.TZ) envVars.TZ = timezone;
      if (!envVars.STUARD_USER_TIMEZONE) envVars.STUARD_USER_TIMEZONE = timezone;

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
      await refreshDeployments();
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    const ok = await confirm({
      title: `Delete “${name}”?`,
      message: 'This automation and its history will be removed. This can’t be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    await deleteDeployment(id);
    await refreshDeployments();
  };

  const KIND_OPTIONS: Array<{ id: DeployKind; label: string; Icon: typeof Workflow }> = [
    { id: 'workflow', label: 'Workflow', Icon: Workflow },
    { id: 'project', label: 'App', Icon: Rocket },
  ];

  const createForm = (
    <div className="dashboard-card mb-5 space-y-4 !border-primary/20 bg-theme-card/50 p-6 animate-in slide-in-from-top-2 duration-200">
      <h4 className="flex items-center gap-2 text-sm font-black text-theme-fg">
        <Rocket className="h-4 w-4 text-primary" /> New automation
      </h4>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-theme-muted">Name</label>
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Daily inbox summary"
            className="w-full rounded-lg border border-[color:var(--dashboard-panel-border)] bg-theme-hover px-3 py-2 text-sm text-theme-fg placeholder:text-theme-muted/50 focus:border-primary/40 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-theme-muted">Type</label>
          <div className="flex gap-2">
            {KIND_OPTIONS.map(({ id, label, Icon }) => (
              <button
                key={id}
                onClick={() => setNewKind(id)}
                className={clsx(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold transition-all',
                  newKind === id ? 'border-primary/40 bg-primary/10 text-primary' : 'border-theme/10 bg-theme-hover text-theme-muted hover:text-theme-fg',
                )}
              >
                <Icon className="h-3 w-3" />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-theme-muted">What it does (optional)</label>
        <input
          type="text"
          value={newDesc}
          onChange={e => setNewDesc(e.target.value)}
          placeholder="A short description so you remember what this is"
          className="w-full rounded-lg border border-[color:var(--dashboard-panel-border)] bg-theme-hover px-3 py-2 text-sm text-theme-fg placeholder:text-theme-muted/50 focus:border-primary/40 focus:outline-none"
        />
      </div>

      <div>
        <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-theme-muted">
          {newKind === 'workflow' ? 'Workflow JSON' : 'Project manifest (JSON)'}
        </label>
        <textarea
          value={newPayload}
          onChange={e => setNewPayload(e.target.value)}
          placeholder={newKind === 'workflow' ? '{\n  "name": "My Workflow",\n  "version": "1",\n  "steps": [...]\n}' : '{\n  "files": {},\n  "packageJson": {},\n  "startCommand": "npm start"\n}'}
          rows={8}
          className="w-full resize-y rounded-lg border border-[color:var(--dashboard-panel-border)] bg-theme-hover px-3 py-2 font-mono text-xs text-theme-fg placeholder:text-theme-muted/50 focus:border-primary/40 focus:outline-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-theme-muted">Environment variables (optional)</label>
          <textarea
            value={newEnvVars}
            onChange={e => setNewEnvVars(e.target.value)}
            placeholder="KEY=value&#10;ANOTHER_KEY=value"
            rows={3}
            className="w-full resize-y rounded-lg border border-[color:var(--dashboard-panel-border)] bg-theme-hover px-3 py-2 font-mono text-xs text-theme-fg placeholder:text-theme-muted/50 focus:border-primary/40 focus:outline-none"
          />
        </div>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-theme-muted">Schedule (cron, optional)</label>
            <input
              type="text"
              value={newSchedule}
              onChange={e => setNewSchedule(e.target.value)}
              placeholder="0 */6 * * *"
              className="w-full rounded-lg border border-[color:var(--dashboard-panel-border)] bg-theme-hover px-3 py-2 font-mono text-xs text-theme-fg placeholder:text-theme-muted/50 focus:border-primary/40 focus:outline-none"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={newAutoRestart} onChange={e => setNewAutoRestart(e.target.checked)} className="rounded border-theme/20 text-primary" />
            <span className="text-xs font-bold text-theme-muted">Restart automatically if it stops</span>
          </label>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 pt-2">
        <button
          onClick={() => setShowCreate(false)}
          className="rounded-lg px-4 py-2 text-xs font-bold text-theme-muted transition-all hover:text-theme-fg"
        >
          Cancel
        </button>
        <button
          onClick={handleCreate}
          disabled={creating || !newName.trim() || !newPayload.trim()}
          className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2 text-xs font-black text-white transition-all hover:bg-primary/90 disabled:opacity-50"
        >
          {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
          Set it live
        </button>
      </div>
    </div>
  );

  return (
    <>
      {confirmDialog}
      <CloudAutomationsPanel
        deployments={deployments as any}
        isRunning={engineRunning}
        title="Automations"
        subtitle="Tasks that run in the cloud around the clock — even when your computer is off."
        emptyTitle={showCreate ? 'Set up your first automation' : 'No automations yet'}
        emptyHint="Use “New automation” to deploy a workflow or project. It runs in the cloud 24/7, and you’ll see exactly when it runs and how it’s doing right here."
        onRefresh={() => void refreshDeployments()}
        onStart={async (id) => { await restartDeployment(id); await refreshDeployments(); }}
        onStop={async (id) => { await stopDeployment(id); await refreshDeployments(); }}
        onDelete={(id, name) => handleDelete(id, name)}
        getLogs={(id, lines) => getDeployLogs(id, lines)}
        headerActions={engineRunning ? (
          <button
            onClick={() => setShowCreate(v => !v)}
            className="flex items-center gap-2 rounded-full bg-primary/10 px-4 py-2 text-[12px] font-bold text-primary transition-all hover:bg-primary/20"
          >
            <Plus className="h-3.5 w-3.5" /> New automation
          </button>
        ) : null}
        banner={showCreate ? createForm : null}
      />
    </>
  );
}
