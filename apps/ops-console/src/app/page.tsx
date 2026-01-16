'use client';

import { useState, useEffect } from 'react';
import {
  GitBranch,
  Rocket,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  ArrowRight,
  Terminal,
  Clock,
  Activity,
  Beaker,
  ShieldCheck
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface UpdateChannelInfo {
  version?: string | null;
  releaseDate?: string | null;
  url: string;
  ok: boolean;
  error?: string;
}

interface StatusData {
  currentBranch: string;
  branches: string[];
  isClean: boolean;
  modified: string[];
  not_added: string[];
  ahead: number;
  behind: number;
  latestTag: string | null;
  allTags: string[];
  lastDeployTime: string | null;
  versions?: {
    desktop?: string | null;
    website?: string | null;
    cloud?: string | null;
  };
  updates?: {
    stable?: UpdateChannelInfo;
    staging?: UpdateChannelInfo;
    beta?: UpdateChannelInfo;
  };
  urls: {
    vercel: {
      preview: string;
      production: string;
    };
    cloudRun: {
      staging: string;
      production: string;
    };
  };
}

function StatusBadge({
  isClean,
  modifiedCount,
  untrackedCount,
}: {
  isClean: boolean;
  modifiedCount: number;
  untrackedCount: number;
}) {
  const m = modifiedCount || 0;
  const u = untrackedCount || 0;
  const total = m + u;

  if (isClean || total === 0) {
    return (
      <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-400 bg-emerald-950/30 border border-emerald-900/50 px-2.5 py-1 rounded-full shadow-sm">
        <CheckCircle className="w-3.5 h-3.5" />
        <span>Clean</span>
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-amber-400 bg-amber-950/30 border border-amber-900/50 px-2.5 py-1 rounded-full shadow-sm">
      <AlertCircle className="w-3.5 h-3.5" />
      <span>
        {total} change{total === 1 ? '' : 's'} (M:{m}, U:{u})
      </span>
    </span>
  );
}


function formatTimeAgo(dateString?: string | null) {
  if (!dateString) return 'Never';
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatDateLabel(dateString?: string | null) {
  if (!dateString) return 'n/a';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return dateString;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function OpsDashboard() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [commitMsg, setCommitMsg] = useState('');
  const [featureName, setFeatureName] = useState('');
  const [version, setVersion] = useState('');
  const [selectedCheckoutBranch, setSelectedCheckoutBranch] = useState('');
  const [selectedBetaBranch, setSelectedBetaBranch] = useState('');
  const [betaTargets, setBetaTargets] = useState({ website: true, cloud: true, desktop: true });
  const [stagingTargets, setStagingTargets] = useState({ website: true, cloud: true, desktop: true });
  const [prodTargets, setProdTargets] = useState({ website: true, cloud: true, desktop: true });

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      setStatus(data);
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const doAction = async (type: string, payload: Record<string, unknown> = {}) => {
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch('/api/actions', {
        method: 'POST',
        body: JSON.stringify({ type, payload }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage(`Success: ${data.message}`);
        fetchStatus();
        setCommitMsg('');
        setFeatureName('');
        setVersion('');
      } else {
        setMessage(`Error: ${data.error}`);
      }
    } catch {
      setMessage('Network error occurred');
    } finally {
      setLoading(false);
    }
  };

  const updateChannels = [
    {
      key: 'stable',
      label: 'Stable',
      badgeClass: 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20',
      data: status?.updates?.stable,
    },
    {
      key: 'staging',
      label: 'Staging',
      badgeClass: 'bg-indigo-500/10 text-indigo-300 border border-indigo-500/20',
      data: status?.updates?.staging,
    },
    {
      key: 'beta',
      label: 'Beta',
      badgeClass: 'bg-purple-500/10 text-purple-200 border border-purple-500/20',
      data: status?.updates?.beta,
    },
  ];

  if (!status) return (
    <div className="flex flex-col items-center justify-center h-screen bg-gray-950 text-gray-400 gap-4">
      <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      <div className="font-mono text-sm animate-pulse">Connecting to Mission Control...</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-100 p-6 md:p-10 font-sans selection:bg-blue-500/30">
      
      {/* Top Bar */}
      <header className="mb-10">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-6 border-b border-gray-800/50">
          <div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent tracking-tight">
              Mission Control
            </h1>
            <p className="text-gray-500 mt-1.5 flex items-center gap-2 text-sm">
              <Terminal className="w-3.5 h-3.5" /> Local DevOps Dashboard
            </p>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center gap-6 mr-6 border-r border-gray-800 pr-6">
               <div className="text-right">
                 <div className="text-xs text-gray-500 font-medium mb-0.5">LATEST ACTIVITY</div>
                 <div className="text-xs font-mono text-gray-300 flex items-center justify-end gap-1.5">
                   <Clock className="w-3 h-3" /> {formatTimeAgo(status.lastDeployTime)}
                 </div>
               </div>
               <div className="text-right">
                 <div className="text-xs text-gray-500 font-medium mb-0.5">SYSTEM STATUS</div>
                 <div className="text-xs font-mono text-emerald-400 flex items-center justify-end gap-1.5">
                   <Activity className="w-3 h-3" /> Operational
                 </div>
               </div>
            </div>

            <div className="flex items-center gap-3 bg-gray-900/50 px-4 py-2.5 rounded-xl border border-gray-800/50 shadow-inner">
              <GitBranch className="w-5 h-5 text-blue-400" />
              <div className="flex flex-col">
                <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Current Branch</span>
                <span className="font-mono text-sm font-medium text-gray-200">{status.currentBranch}</span>
              </div>
              <div className="w-px h-8 bg-gray-800 mx-1" />
              <StatusBadge
                isClean={status.isClean}
                modifiedCount={status.modified?.length || 0}
                untrackedCount={status.not_added?.length || 0}
              />
            </div>
          </div>
        </div>
      </header>

      {message && (
        <div className={cn(
          "mb-8 p-4 rounded-xl border flex items-center gap-3 shadow-lg animate-in fade-in slide-in-from-top-2 duration-300",
          message.startsWith('Error') 
            ? "bg-red-950/10 border-red-900/50 text-red-200" 
            : "bg-emerald-950/10 border-emerald-900/50 text-emerald-200"
        )}>
          {message.startsWith('Error') ? <AlertCircle className="w-5 h-5" /> : <CheckCircle className="w-5 h-5" />}
          <span className="font-medium">{message}</span>
        </div>
      )}

      {/* Version + Update System Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-gray-900/40 border border-gray-800 rounded-2xl p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-gray-500 font-bold uppercase tracking-wider">Version Control</div>
              <div className="text-sm font-semibold text-gray-100">Codebase Versions</div>
            </div>
            <div className="text-[11px] text-gray-500 text-right">
              <div className="uppercase tracking-wider font-bold text-[10px]">Latest Tag</div>
              <div className="font-mono text-gray-300">{status.latestTag || 'none'}</div>
            </div>
          </div>
          <div className="space-y-2 text-sm text-gray-300">
            <div className="flex items-center justify-between">
              <span className="text-gray-500 text-xs">Desktop</span>
              <span className="font-mono text-sm text-gray-100">{status.versions?.desktop || 'unknown'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500 text-xs">Website</span>
              <span className="font-mono text-sm text-gray-100">{status.versions?.website || 'unknown'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500 text-xs">Cloud</span>
              <span className="font-mono text-sm text-gray-100">{status.versions?.cloud || 'unknown'}</span>
            </div>
          </div>
          <div className="text-[11px] text-gray-500 pt-1 border-t border-gray-800/60">
            Last deploy: <span className="text-gray-300">{formatTimeAgo(status.lastDeployTime)}</span>
          </div>
        </div>

        {updateChannels.map((channel) => (
          <div key={channel.key} className="bg-gray-900/40 border border-gray-800 rounded-2xl p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-gray-500 font-bold uppercase tracking-wider">{channel.label} Channel</div>
                <div className="text-sm font-semibold text-gray-100">Update System</div>
              </div>
              <span className={cn("text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded", channel.badgeClass)}>
                Manifest
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] text-gray-500">Latest Version</span>
              <span className="font-mono text-sm text-gray-100">
                {channel.data?.version || 'unknown'}
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] text-gray-500">Released</span>
              <span className="text-xs text-gray-300">
                {channel.data?.releaseDate ? formatDateLabel(channel.data.releaseDate) : 'n/a'}
              </span>
            </div>
            <div className="text-[11px] text-gray-500">
              {channel.data?.error ? (
                <span className="text-amber-300">Manifest unavailable: {channel.data.error}</span>
              ) : (
                <a
                  href={channel.data?.url || '#'}
                  target="_blank"
                  className="text-blue-300 hover:text-blue-200 underline decoration-dotted"
                  rel="noreferrer"
                >
                  View manifest
                </a>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        
        {/* COL 1: LOCAL DEV */}
        <div className="bg-gray-900/40 border border-gray-800 rounded-2xl p-5 hover:border-gray-700 transition-all flex flex-col h-full">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-400 border border-blue-500/20">
              <RefreshCw className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-100">1. Local Dev</h2>
              <p className="text-xs text-gray-500">Code & Commit</p>
            </div>
          </div>

          <div className="flex-1 space-y-4">
            {/* Changed Files */}
            <div className="bg-black/40 rounded-lg p-3 border border-gray-800 max-h-40 overflow-y-auto">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Changed Files</span>
                <span className="text-[10px] font-mono text-gray-600">
                  {(status.modified?.length || 0) + (status.not_added?.length || 0)} files
                </span>
              </div>
              <div className="space-y-1 text-[11px] font-mono">
                {(!status.modified?.length && !status.not_added?.length) ? (
                  <div className="text-gray-600 flex items-center gap-1">
                    <CheckCircle className="w-3 h-3 opacity-60" />
                    <span>Working directory clean</span>
                  </div>
                ) : (
                  <>
                    {status.modified?.map((f: string) => (
                      <div key={`mod-${f}`} className="flex items-center gap-2 text-amber-300/90">
                        <span className="text-[9px] font-bold border border-amber-300/40 px-1 rounded">MOD</span>
                        <span className="truncate">{f}</span>
                      </div>
                    ))}
                    {status.not_added?.map((f: string) => (
                      <div key={`new-${f}`} className="flex items-center gap-2 text-emerald-300/90">
                        <span className="text-[9px] font-bold border border-emerald-300/40 px-1 rounded">NEW</span>
                        <span className="truncate">{f}</span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>

            <div>
              <label className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-2 block">Switch Branch</label>
              <div className="flex gap-2">
                <select
                  className="w-full bg-gray-950 border border-gray-800 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500 text-gray-300"
                  value={selectedCheckoutBranch}
                  onChange={(e) => setSelectedCheckoutBranch(e.target.value)}
                >
                  <option value="">Select a branch...</option>
                  {status.branches?.map((b: string) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
                <button 
                  onClick={() => doAction('checkout-branch', { branch: selectedCheckoutBranch })}
                  disabled={loading || !selectedCheckoutBranch || selectedCheckoutBranch === status.currentBranch}
                  className="px-3 bg-gray-800 hover:bg-gray-700 rounded text-gray-300 disabled:opacity-50"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="pt-4 border-t border-gray-800/50">
              <label className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-2 block">Start Feature</label>
              <div className="flex gap-2">
                <input 
                  type="text" 
                  placeholder="new-login"
                  className="w-full bg-gray-950 border border-gray-800 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                  value={featureName}
                  onChange={(e) => setFeatureName(e.target.value)}
                />
                <button 
                  onClick={() => doAction('start-feature', { name: featureName })}
                  disabled={loading || !featureName}
                  className="px-3 bg-blue-600 hover:bg-blue-500 rounded text-white disabled:opacity-50"
                >
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="pt-4 border-t border-gray-800/50">
               <label className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-2 block">Save Changes</label>
               <textarea 
                  placeholder="Commit message..."
                  className="w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 h-20 mb-2 resize-none"
                  value={commitMsg}
                  onChange={(e) => setCommitMsg(e.target.value)}
                />
                <div className="flex gap-2">
                  <button 
                    onClick={() => doAction('stage-all')}
                    className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-xs"
                    disabled={loading || status.isClean}
                  >
                    Stage
                  </button>
                  <button 
                    onClick={() => doAction('commit', { message: commitMsg })}
                    className="flex-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-bold disabled:opacity-50"
                    disabled={loading || !commitMsg}
                  >
                    Commit
                  </button>
                </div>
            </div>

            <button 
              onClick={() => doAction('share-feature')}
              className="w-full py-3 mt-auto bg-gray-800/50 hover:bg-gray-800 border border-gray-800 rounded-lg text-gray-300 text-xs font-medium transition-colors"
              disabled={loading}
            >
              Sync / Share Branch
            </button>
          </div>
        </div>

        {/* COL 2: BETA */}
        <div className="bg-gray-900/40 border border-gray-800 rounded-2xl p-5 hover:border-purple-900/30 transition-all flex flex-col h-full relative overflow-hidden">
          <div className="absolute top-0 right-0 p-10 bg-purple-500/5 blur-2xl -mr-10 -mt-10 rounded-full" />
          <div className="flex items-center gap-3 mb-4 relative z-10">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-400 border border-purple-500/20">
              <Beaker className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-100">2. Beta</h2>
              <p className="text-xs text-gray-500">Internal Testing</p>
            </div>
          </div>

          <div className="flex-1 flex flex-col justify-end space-y-3 relative z-10">
            <p className="text-sm text-gray-400 mb-4">
              Merge features here to build an internal <b>Beta Installer</b>.
            </p>
            <div className="space-y-1 text-xs text-gray-400">
              <div className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Source Branch</div>
              <select
                className="w-full bg-gray-950 border border-gray-800 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-purple-500 text-gray-300 mb-2"
                value={selectedBetaBranch}
                onChange={(e) => setSelectedBetaBranch(e.target.value)}
              >
                <option value="">Current ({status.currentBranch})</option>
                {status.branches?.filter((b: string) => b !== status.currentBranch).map((b: string) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>

              <div className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Targets</div>
              <div className="flex flex-wrap gap-2">
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border-gray-700 bg-gray-950 text-purple-500 focus:ring-0"
                    checked={betaTargets.website}
                    onChange={(e) => setBetaTargets(prev => ({ ...prev, website: e.target.checked }))}
                  />
                  <span>Website</span>
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border-gray-700 bg-gray-950 text-purple-500 focus:ring-0"
                    checked={betaTargets.cloud}
                    onChange={(e) => setBetaTargets(prev => ({ ...prev, cloud: e.target.checked }))}
                  />
                  <span>Cloud</span>
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border-gray-700 bg-gray-950 text-purple-500 focus:ring-0"
                    checked={betaTargets.desktop}
                    onChange={(e) => setBetaTargets(prev => ({ ...prev, desktop: e.target.checked }))}
                  />
                  <span>Desktop</span>
                </label>
              </div>
            </div>
            <button 
              onClick={() => doAction('ship-to-beta', { targets: betaTargets, sourceBranch: selectedBetaBranch })}
              className="w-full py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-sm font-bold shadow-lg shadow-purple-900/20 transition-all disabled:opacity-50"
              disabled={loading}
            >
              Ship to Beta
            </button>
          </div>
        </div>

        {/* COL 3: STAGING */}
        <div className="bg-gray-900/40 border border-gray-800 rounded-2xl p-5 hover:border-indigo-900/30 transition-all flex flex-col h-full relative overflow-hidden">
           <div className="absolute top-0 right-0 p-10 bg-indigo-500/5 blur-2xl -mr-10 -mt-10 rounded-full" />
          <div className="flex items-center gap-3 mb-4 relative z-10">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-400 border border-indigo-500/20">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-100">3. Staging</h2>
              <p className="text-xs text-gray-500">Release Candidate</p>
            </div>
          </div>

          <div className="flex-1 flex flex-col justify-end space-y-3 relative z-10">
             <p className="text-sm text-gray-400 mb-4">
              Promote Beta to <b>Staging</b>. Final dress rehearsal.
            </p>
            <div className="space-y-1 text-xs text-gray-400">
              <div className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Targets</div>
              <div className="flex flex-wrap gap-2">
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border-gray-700 bg-gray-950 text-indigo-500 focus:ring-0"
                    checked={stagingTargets.website}
                    onChange={(e) => setStagingTargets(prev => ({ ...prev, website: e.target.checked }))}
                  />
                  <span>Website</span>
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border-gray-700 bg-gray-950 text-indigo-500 focus:ring-0"
                    checked={stagingTargets.cloud}
                    onChange={(e) => setStagingTargets(prev => ({ ...prev, cloud: e.target.checked }))}
                  />
                  <span>Cloud</span>
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border-gray-700 bg-gray-950 text-indigo-500 focus:ring-0"
                    checked={stagingTargets.desktop}
                    onChange={(e) => setStagingTargets(prev => ({ ...prev, desktop: e.target.checked }))}
                  />
                  <span>Desktop</span>
                </label>
              </div>
            </div>
            <button 
              onClick={() => doAction('ship-to-staging', { targets: stagingTargets })}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-bold shadow-lg shadow-indigo-900/20 transition-all disabled:opacity-50"
              disabled={loading}
            >
              Ship to Staging
            </button>
          </div>
        </div>

        {/* COL 4: PRODUCTION */}
        <div className="bg-gray-900/40 border border-gray-800 rounded-2xl p-5 hover:border-pink-900/30 transition-all flex flex-col h-full relative overflow-hidden">
          <div className="absolute top-0 right-0 p-10 bg-pink-500/5 blur-2xl -mr-10 -mt-10 rounded-full" />
          <div className="flex items-center gap-3 mb-4 relative z-10">
            <div className="w-10 h-10 rounded-xl bg-pink-500/10 flex items-center justify-center text-pink-400 border border-pink-500/20">
              <Rocket className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-100">4. Production</h2>
              <p className="text-xs text-gray-500">Public Release</p>
            </div>
          </div>

          <div className="flex-1 flex flex-col justify-end space-y-3 relative z-10">
             <p className="text-sm text-gray-400 mb-4">
              Go live. Promotes Staging to <b>Production</b>.
            </p>
            
            <div className="mt-auto space-y-3">
              <div className="space-y-1 text-xs text-gray-400">
                <div className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Targets</div>
                <div className="flex flex-wrap gap-2">
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 rounded border-gray-700 bg-gray-950 text-pink-500 focus:ring-0"
                      checked={prodTargets.website}
                      onChange={(e) => setProdTargets(prev => ({ ...prev, website: e.target.checked }))}
                    />
                    <span>Website</span>
                  </label>
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 rounded border-gray-700 bg-gray-950 text-pink-500 focus:ring-0"
                      checked={prodTargets.cloud}
                      onChange={(e) => setProdTargets(prev => ({ ...prev, cloud: e.target.checked }))}
                    />
                    <span>Cloud</span>
                  </label>
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 rounded border-gray-700 bg-gray-950 text-pink-500 focus:ring-0"
                      checked={prodTargets.desktop}
                      onChange={(e) => setProdTargets(prev => ({ ...prev, desktop: e.target.checked }))}
                    />
                    <span>Desktop</span>
                  </label>
                </div>
              </div>
              <input 
                type="text" 
                placeholder="v1.0.x"
                className="w-full bg-gray-950 border border-gray-800 rounded px-3 py-2 text-sm focus:outline-none focus:border-pink-500 font-mono mb-2"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
              />
              <button
                onClick={() => doAction('ship-to-prod', { version, targets: prodTargets })}
                className="w-full py-3 bg-pink-600 hover:bg-pink-500 text-white rounded-lg text-sm font-bold shadow-lg shadow-pink-900/20 transition-all disabled:opacity-50"
                disabled={loading || !version || status.currentBranch !== 'staging'}
              >
                RELEASE TO WORLD
              </button>
              {status.currentBranch !== 'staging' && (
                <p className="text-[10px] text-amber-400/80 mt-2 text-center">
                  Switch to staging branch to release
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
