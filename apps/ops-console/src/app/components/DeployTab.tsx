'use client';

import { useState, useEffect, useCallback } from 'react';
import { GitBranch, Rocket, RefreshCw, CheckCircle, AlertCircle, ShieldCheck, Beaker, Terminal, Cloud, Clock, XCircle, Loader2, ExternalLink, History, Package, ArrowUpCircle, Tag, Hash, ChevronRight } from 'lucide-react';
import { StatusData, Deployment, formatDate, formatTimeAgo } from '../lib/api';

const STATUS_STYLES: Record<string, { bg: string; text: string; icon: React.ElementType }> = {
  pending: { bg: 'bg-gray-100', text: 'text-gray-600', icon: Clock },
  building: { bg: 'bg-blue-50', text: 'text-blue-600', icon: Loader2 },
  deploying: { bg: 'bg-amber-50', text: 'text-amber-600', icon: Loader2 },
  deployed: { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: CheckCircle },
  failed: { bg: 'bg-red-50', text: 'text-red-600', icon: XCircle },
  rolled_back: { bg: 'bg-orange-50', text: 'text-orange-600', icon: AlertCircle },
};

const CHANNEL_COLORS: Record<string, string> = {
  beta: 'bg-purple-50 text-purple-700 border-purple-200',
  staging: 'bg-blue-50 text-blue-700 border-blue-200',
  production: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

interface AppVersion {
  name: string;
  key: string;
  version: string;
  path: string;
}

interface VersionsData {
  apps: AppVersion[];
  monorepo: { version: string; path: string };
  git: {
    latestTag: string | null;
    allTags: string[];
    currentBranch: string;
    isClean: boolean;
    commitSha: string | null;
  };
  history: { tag: string; date: string | null; message: string | null; author: string | null }[];
}

type BumpType = 'patch' | 'minor' | 'major';

function bumpVersion(version: string, type: BumpType): string {
  const parts = version.replace(/^v/, '').split('.').map(Number);
  const [major = 0, minor = 0, patch = 0] = parts;
  switch (type) {
    case 'major': return `${major + 1}.0.0`;
    case 'minor': return `${major}.${minor + 1}.0`;
    case 'patch': return `${major}.${minor}.${patch + 1}`;
  }
}

export default function DeployTab({ status, onAction, loading, deployments, latestByChannel, onRefreshDeploys }: {
  status: StatusData;
  onAction: (type: string, payload?: Record<string, unknown>) => Promise<boolean>;
  loading: boolean;
  deployments: Deployment[];
  latestByChannel: Record<string, Deployment>;
  onRefreshDeploys: () => void;
}) {
  const [commitMsg, setCommitMsg] = useState('');
  const [version, setVersion] = useState('');
  const [newBranchName, setNewBranchName] = useState('');
  const [newBranchBase, setNewBranchBase] = useState('');
  const [checkoutBranch, setCheckoutBranch] = useState('');
  const [pushAutoCommit, setPushAutoCommit] = useState(false);
  const [selectedBetaBranch, setSelectedBetaBranch] = useState('');
  const [betaTargets, setBetaTargets] = useState({ website: true, cloud: true, desktop: true });
  const [stagingTargets, setStagingTargets] = useState({ website: true, cloud: true, desktop: true });
  const [prodTargets, setProdTargets] = useState({ website: true, cloud: true, desktop: true });

  // Version control state
  const [versions, setVersions] = useState<VersionsData | null>(null);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [bumpType, setBumpType] = useState<BumpType>('patch');
  const [bumpApps, setBumpApps] = useState<Record<string, boolean>>({
    desktop: true, website: true, 'cloud-ai': true, 'ops-console': true, 'browser-extension': true,
  });
  const [autoCommit, setAutoCommit] = useState(true);
  const [autoTag, setAutoTag] = useState(true);
  const [versionMessage, setVersionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadVersions = useCallback(async () => {
    setVersionsLoading(true);
    try {
      const res = await fetch('/api/ops/versions');
      if (res.ok) setVersions(await res.json());
    } catch { /* ignore */ } finally { setVersionsLoading(false); }
  }, []);

  useEffect(() => { loadVersions(); }, [loadVersions]);

  const getHighestVersion = (): string => {
    if (!versions?.apps.length) return '0.1.0';
    return versions.apps
      .map(a => a.version.replace(/^v/, ''))
      .sort((a, b) => {
        const pa = a.split('.').map(Number);
        const pb = b.split('.').map(Number);
        for (let i = 0; i < 3; i++) {
          if ((pa[i] || 0) !== (pb[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
        }
        return 0;
      })[0] || '0.1.0';
  };

  const targetVersion = bumpVersion(getHighestVersion(), bumpType);

  const handleBump = async () => {
    const selectedApps = Object.entries(bumpApps).filter(([, v]) => v).map(([k]) => k);
    if (selectedApps.length === 0) { setVersionMessage({ type: 'error', text: 'Select at least one app' }); return; }
    setVersionsLoading(true);
    setVersionMessage(null);
    try {
      const res = await fetch('/api/ops/versions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: targetVersion, apps: selectedApps, autoCommit, autoTag }),
      });
      const data = await res.json();
      if (res.ok) {
        setVersionMessage({ type: 'success', text: data.message || `Bumped to v${targetVersion}` });
        await loadVersions();
      } else {
        setVersionMessage({ type: 'error', text: data.error || 'Bump failed' });
      }
    } catch { setVersionMessage({ type: 'error', text: 'Network error' }); }
    finally { setVersionsLoading(false); }
  };

  const handleShipToBeta = async () => {
    // Skip local checks — the GitHub Actions workflow has its own CI checks gatekeeper.
    // Running local checks here blocks the actual beta release if they fail,
    // and adds unnecessary delay when they pass.
    await onAction('ship-to-beta', { targets: betaTargets, sourceBranch: selectedBetaBranch || undefined });
  };

  // Use live versions from API, fall back to status data
  const desktopVer = versions?.apps.find(a => a.key === 'desktop')?.version || status.versions?.desktop || '—';
  const websiteVer = versions?.apps.find(a => a.key === 'website')?.version || status.versions?.website || '—';
  const cloudVer = versions?.apps.find(a => a.key === 'cloud-ai')?.version || status.versions?.cloud || '—';
  const opsVer = versions?.apps.find(a => a.key === 'ops-console')?.version || '—';
  const extVer = versions?.apps.find(a => a.key === 'browser-extension')?.version || '—';
  const latestTag = versions?.git?.latestTag || status.latestTag || null;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Version Message */}
      {versionMessage && (
        <div className={`p-3 rounded-lg border flex items-center gap-2 text-sm ${
          versionMessage.type === 'error' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'
        }`}>
          {versionMessage.type === 'error' ? <AlertCircle className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}
          <span className="text-xs font-medium">{versionMessage.text}</span>
          <button onClick={() => setVersionMessage(null)} className="ml-auto text-xs opacity-60 hover:opacity-100">Dismiss</button>
        </div>
      )}

      {/* Latest Deploy per Channel */}
      {Object.keys(latestByChannel).length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {['beta', 'staging', 'production'].map(ch => {
            const d = latestByChannel[ch];
            if (!d) return (
              <div key={ch} className="card p-4 opacity-50">
                <div className="text-xs text-gray-500 uppercase font-medium mb-1">{ch}</div>
                <div className="text-sm text-gray-400">No deployments yet</div>
              </div>
            );
            const st = STATUS_STYLES[d.status] || STATUS_STYLES.pending;
            const StIcon = st.icon;
            return (
              <div key={ch} className="card p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-[10px] uppercase font-semibold px-2 py-0.5 rounded border ${CHANNEL_COLORS[ch] || ''}`}>{ch}</span>
                  <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded ${st.bg} ${st.text}`}>
                    <StIcon className={`w-3 h-3 ${d.status === 'building' || d.status === 'deploying' ? 'animate-spin' : ''}`} />
                    {d.status}
                  </span>
                </div>
                <div className="text-sm font-semibold text-gray-900">{d.version || 'No version'}</div>
                <div className="text-xs text-gray-500 mt-1 space-y-0.5">
                  <div className="flex items-center gap-1"><GitBranch className="w-3 h-3" /> <span className="font-mono">{d.git_branch || '—'}</span></div>
                  {d.git_commit_sha && <div className="font-mono text-[10px] text-gray-400">{d.git_commit_sha.slice(0, 8)}</div>}
                  <div>{formatTimeAgo(d.started_at)} by {d.triggered_by || 'system'}</div>
                  {d.duration_seconds && <div>{d.duration_seconds}s</div>}
                </div>
                {d.workflow_run_url && (
                  <a href={d.workflow_run_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] text-blue-600 hover:underline mt-1">
                    <ExternalLink className="w-2.5 h-2.5" /> GitHub Actions
                  </a>
                )}
                {d.error_message && <div className="text-[10px] text-red-500 mt-1 truncate">{d.error_message}</div>}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Version Control Overview ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* All Package Versions */}
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Package className="w-4 h-4 text-blue-600" />
              <h3 className="text-sm font-semibold text-gray-800">Package Versions</h3>
            </div>
            <button onClick={loadVersions} disabled={versionsLoading} className="btn-secondary px-3 py-1.5 text-xs flex items-center gap-1">
              <RefreshCw className={`w-3 h-3 ${versionsLoading ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-gray-100">
                  <th className="py-2 text-left font-medium">App</th>
                  <th className="py-2 text-left font-medium">Current Version</th>
                  <th className="py-2 text-left font-medium">Path</th>
                  <th className="py-2 text-right font-medium">After Bump</th>
                </tr>
              </thead>
              <tbody>
                {(versions?.apps || []).map(app => {
                  const isSelected = bumpApps[app.key];
                  return (
                    <tr key={app.key} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="py-2.5">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={isSelected ?? false} onChange={e => setBumpApps(p => ({ ...p, [app.key]: e.target.checked }))} className="rounded" />
                          <span className="font-medium text-gray-800">{app.name}</span>
                        </label>
                      </td>
                      <td className="py-2.5">
                        <span className="font-mono text-sm text-gray-700 bg-gray-100 px-2 py-0.5 rounded">{app.version}</span>
                      </td>
                      <td className="py-2.5 font-mono text-gray-400">{app.path}</td>
                      <td className="py-2.5 text-right">
                        {isSelected ? (
                          <span className="font-mono text-sm text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">{targetVersion}</span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {/* Fallback if versions API not loaded yet */}
                {!versions && (
                  <>
                    <tr className="border-b border-gray-50">
                      <td className="py-2.5"><span className="font-medium text-gray-800">Desktop</span></td>
                      <td className="py-2.5"><span className="font-mono text-sm text-gray-700 bg-gray-100 px-2 py-0.5 rounded">{desktopVer}</span></td>
                      <td className="py-2.5 font-mono text-gray-400">apps/desktop/package.json</td>
                      <td className="py-2.5 text-right text-gray-400">—</td>
                    </tr>
                    <tr className="border-b border-gray-50">
                      <td className="py-2.5"><span className="font-medium text-gray-800">Website</span></td>
                      <td className="py-2.5"><span className="font-mono text-sm text-gray-700 bg-gray-100 px-2 py-0.5 rounded">{websiteVer}</span></td>
                      <td className="py-2.5 font-mono text-gray-400">apps/website/package.json</td>
                      <td className="py-2.5 text-right text-gray-400">—</td>
                    </tr>
                    <tr className="border-b border-gray-50">
                      <td className="py-2.5"><span className="font-medium text-gray-800">Cloud AI</span></td>
                      <td className="py-2.5"><span className="font-mono text-sm text-gray-700 bg-gray-100 px-2 py-0.5 rounded">{cloudVer}</span></td>
                      <td className="py-2.5 font-mono text-gray-400">apps/cloud-ai/package.json</td>
                      <td className="py-2.5 text-right text-gray-400">—</td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Git Tags + Quick Bump */}
        <div className="card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Tag className="w-4 h-4 text-purple-600" />
            <h3 className="text-sm font-semibold text-gray-800">Version Control</h3>
          </div>

          {/* Current tag */}
          <div>
            <div className="text-[10px] text-gray-500 uppercase font-medium mb-1">Latest Tag</div>
            <div className="font-mono text-lg font-semibold text-gray-900">
              {latestTag || <span className="text-gray-400 text-sm">No tags yet</span>}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-gray-500 uppercase font-medium mb-1">Branch</div>
            <div className="flex items-center gap-1.5">
              <GitBranch className="w-3.5 h-3.5 text-blue-600" />
              <span className="font-mono text-sm text-gray-700">{status.currentBranch}</span>
              <div className={`w-1.5 h-1.5 rounded-full ${status.isClean ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            </div>
          </div>
          {versions?.git?.commitSha && (
            <div>
              <div className="text-[10px] text-gray-500 uppercase font-medium mb-1">HEAD</div>
              <div className="font-mono text-xs text-gray-500">{versions.git.commitSha.slice(0, 12)}</div>
            </div>
          )}

          {/* Quick bump controls */}
          <div className="pt-3 border-t border-gray-100">
            <div className="text-[10px] text-gray-500 uppercase font-medium mb-2">Quick Bump</div>
            <div className="flex gap-1.5">
              {(['patch', 'minor', 'major'] as BumpType[]).map(type => (
                <button key={type} onClick={() => setBumpType(type)}
                  className={`flex-1 px-2 py-1.5 rounded text-xs font-medium border transition-colors ${
                    bumpType === type ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}>
                  {type}
                </button>
              ))}
            </div>
            <div className="bg-blue-50 rounded-lg p-2.5 mt-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-blue-500 uppercase font-medium">Target</span>
                <span className="font-mono text-sm font-semibold text-blue-800">v{targetVersion}</span>
              </div>
              <div className="text-[10px] text-blue-600 mt-0.5">{Object.values(bumpApps).filter(Boolean).length} apps selected</div>
            </div>
            <div className="flex gap-2 mt-2">
              <label className="flex items-center gap-1 text-[10px] text-gray-600 cursor-pointer">
                <input type="checkbox" checked={autoCommit} onChange={e => setAutoCommit(e.target.checked)} className="rounded w-3 h-3" /> Commit
              </label>
              <label className="flex items-center gap-1 text-[10px] text-gray-600 cursor-pointer">
                <input type="checkbox" checked={autoTag} onChange={e => setAutoTag(e.target.checked)} className="rounded w-3 h-3" /> Tag
              </label>
            </div>
            <button onClick={handleBump} disabled={versionsLoading || loading}
              className="btn-primary w-full py-2 text-xs mt-2 disabled:opacity-40 flex items-center justify-center gap-1.5">
              {versionsLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <ArrowUpCircle className="w-3.5 h-3.5" />}
              Bump to v{targetVersion}
            </button>
          </div>

          {/* Recent tags */}
          {(versions?.git?.allTags || status.allTags || []).length > 0 && (
            <div className="pt-3 border-t border-gray-100">
              <div className="text-[10px] text-gray-500 uppercase font-medium mb-2">Recent Tags</div>
              <div className="space-y-1">
                {(versions?.git?.allTags || status.allTags || []).slice(0, 5).map(tag => (
                  <div key={tag} className="flex items-center gap-1.5 text-xs">
                    <Hash className="w-3 h-3 text-gray-400" />
                    <span className="font-mono text-gray-700">{tag}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Pipeline: 4-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* 1. Local Dev */}
        <div className="card p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center"><RefreshCw className="w-4 h-4 text-blue-600" /></div>
            <div><h2 className="text-sm font-semibold text-gray-800">1. Local Dev</h2><p className="text-[10px] text-gray-500">Code & Commit</p></div>
          </div>
          <div className="space-y-3">
            {/* Changed files */}
            <div className="bg-gray-50 rounded-lg p-3 max-h-28 overflow-y-auto">
              <div className="flex items-center justify-between mb-1.5"><span className="text-[10px] text-gray-500 font-medium uppercase">Changed</span><span className="text-[10px] font-mono text-gray-400">{(status.modified?.length || 0) + (status.not_added?.length || 0)}</span></div>
              {status.isClean ? <div className="text-xs text-gray-400 italic">Clean</div> : (
                <ul className="space-y-0.5 text-[11px] font-mono">
                  {status.modified?.slice(0, 4).map(f => <li key={f} className="text-amber-600 truncate">M {f.split('/').pop()}</li>)}
                  {status.not_added?.slice(0, 3).map(f => <li key={f} className="text-emerald-600 truncate">+ {f.split('/').pop()}</li>)}
                </ul>
              )}
            </div>

            <div>
              <label className="block text-[10px] text-gray-500 font-medium uppercase mb-1">Commit Message</label>
              <input type="text" className="input-field" placeholder="feat: ..." value={commitMsg} onChange={e => setCommitMsg(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <button onClick={() => onAction('stage-all')} disabled={loading || status.isClean} className="btn-secondary w-full py-1.5 text-xs disabled:opacity-40">Stage All</button>
              <button onClick={async () => { const ok = await onAction('commit', { message: commitMsg }); if (ok) setCommitMsg(''); }} disabled={loading || !commitMsg.trim()} className="btn-primary w-full py-1.5 text-xs disabled:opacity-40">Commit</button>
              <button onClick={() => onAction('run-checks')} disabled={loading} className="btn-secondary w-full py-1.5 text-xs disabled:opacity-40 flex items-center justify-center gap-1"><ShieldCheck className="w-3 h-3" /> Run Checks</button>
            </div>

            <div className="pt-3 border-t border-gray-100 space-y-2">
              <div className="text-[10px] text-gray-500 font-medium uppercase">Branches</div>
              <input type="text" className="input-field" placeholder="feature/my-branch" value={newBranchName} onChange={e => setNewBranchName(e.target.value)} />
              <select className="input-field" value={newBranchBase} onChange={e => setNewBranchBase(e.target.value)}>
                <option value="">Base: {status.currentBranch}</option>
                {status.branches?.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
              <button onClick={async () => { const ok = await onAction('create-branch', { branch: newBranchName, baseBranch: newBranchBase || undefined }); if (ok) setNewBranchName(''); }} disabled={loading || !newBranchName.trim()} className="btn-secondary w-full py-1.5 text-xs disabled:opacity-40"><GitBranch className="w-3 h-3 inline mr-1" />Create & Push</button>

              <select className="input-field" value={checkoutBranch} onChange={e => setCheckoutBranch(e.target.value)}>
                <option value="">Switch branch...</option>
                {status.branches?.map(b => <option key={b} value={b}>{b}{b === status.currentBranch ? ' (current)' : ''}</option>)}
              </select>
              <button onClick={() => onAction('checkout-branch', { branch: checkoutBranch })} disabled={loading || !checkoutBranch || checkoutBranch === status.currentBranch} className="btn-secondary w-full py-1.5 text-xs disabled:opacity-40">Switch</button>

              <label className="flex items-center gap-2 text-xs mt-2"><input type="checkbox" checked={pushAutoCommit} onChange={() => setPushAutoCommit(v => !v)} className="rounded" /> Auto-commit WIP</label>
              <button onClick={() => onAction('push-current', { autoCommit: pushAutoCommit })} disabled={loading} className="btn-primary w-full py-1.5 text-xs disabled:opacity-40"><Cloud className="w-3 h-3 inline mr-1" />Push Current</button>
            </div>
          </div>
        </div>

        {/* 2. Beta */}
        <div className="card p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-lg bg-purple-50 flex items-center justify-center"><Beaker className="w-4 h-4 text-purple-600" /></div>
            <div><h2 className="text-sm font-semibold text-gray-800">2. Beta</h2><p className="text-[10px] text-gray-500">Internal Testing</p></div>
          </div>
          <div className="space-y-3">
            <div>
              <label className="block text-[10px] text-gray-500 font-medium uppercase mb-1">Source Branch</label>
              <select className="input-field" value={selectedBetaBranch} onChange={e => setSelectedBetaBranch(e.target.value)}>
                <option value="">{status.currentBranch} (current)</option>
                {status.branches?.filter(b => b !== status.currentBranch).map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <TargetCheckboxes targets={betaTargets} onChange={setBetaTargets} />
            <button onClick={handleShipToBeta} disabled={loading} className="btn-primary w-full py-2 text-xs disabled:opacity-40">Ship to Beta</button>
          </div>
        </div>

        {/* 3. Staging */}
        <div className="card p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center"><Terminal className="w-4 h-4 text-indigo-600" /></div>
            <div><h2 className="text-sm font-semibold text-gray-800">3. Staging</h2><p className="text-[10px] text-gray-500">Pre-Production</p></div>
          </div>
          <div className="space-y-3">
            <TargetCheckboxes targets={stagingTargets} onChange={setStagingTargets} />
            <button onClick={() => onAction('ship-to-staging', { targets: stagingTargets })} disabled={loading} className="btn-primary w-full py-2 text-xs disabled:opacity-40">Ship to Staging</button>
          </div>
        </div>

        {/* 4. Production */}
        <div className="card p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center"><Rocket className="w-4 h-4 text-emerald-600" /></div>
            <div><h2 className="text-sm font-semibold text-gray-800">4. Production</h2><p className="text-[10px] text-gray-500">Live Release</p></div>
          </div>
          <div className="space-y-3">
            <div>
              <label className="block text-[10px] text-gray-500 font-medium uppercase mb-1">Release Version</label>
              <input type="text" className="input-field" placeholder={`v${targetVersion}`} value={version} onChange={e => setVersion(e.target.value)} />
              <div className="text-[10px] text-gray-400 mt-1">Current: {getHighestVersion()} → Suggestion: v{targetVersion}</div>
            </div>
            <TargetCheckboxes targets={prodTargets} onChange={setProdTargets} />
            <button onClick={() => onAction('ship-to-prod', { version: version || targetVersion, targets: prodTargets })} disabled={loading} className="btn-primary w-full py-2 text-xs disabled:opacity-40">Ship to Production</button>
          </div>
        </div>
      </div>

      {/* Version History from Git Tags */}
      {versions?.history && versions.history.length > 0 && (
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-4 h-4 text-gray-500" />
            <h3 className="text-sm font-semibold text-gray-800">Version History</h3>
            <span className="text-xs text-gray-400">{versions.history.length} releases</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-gray-100">
                  <th className="py-2 text-left font-medium">Tag</th>
                  <th className="py-2 text-left font-medium">Date</th>
                  <th className="py-2 text-left font-medium">Message</th>
                  <th className="py-2 text-left font-medium">Author</th>
                </tr>
              </thead>
              <tbody>
                {versions.history.map(entry => (
                  <tr key={entry.tag} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="py-2"><span className="font-mono text-sm text-blue-600 bg-blue-50 px-2 py-0.5 rounded">{entry.tag}</span></td>
                    <td className="py-2 text-gray-500">{entry.date ? formatTimeAgo(entry.date) : '—'}</td>
                    <td className="py-2 text-gray-700 max-w-[300px] truncate">{entry.message || '—'}</td>
                    <td className="py-2 text-gray-500">{entry.author || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Deployment History */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-gray-500" />
            <h3 className="text-sm font-semibold text-gray-800">Deployment History</h3>
            <span className="text-xs text-gray-400">{deployments.length} records</span>
          </div>
          <button onClick={onRefreshDeploys} className="btn-secondary px-3 py-1.5 text-xs flex items-center gap-1">
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>
        {deployments.length === 0 ? (
          <div className="text-sm text-gray-400 py-8 text-center">No deployments recorded yet. Ship to beta/staging/production to start tracking.</div>
        ) : (
          <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="text-gray-500 border-b border-gray-100">
                  <th className="py-2 text-left font-medium">Channel</th>
                  <th className="py-2 text-left font-medium">Version</th>
                  <th className="py-2 text-left font-medium">Status</th>
                  <th className="py-2 text-left font-medium">Branch</th>
                  <th className="py-2 text-left font-medium">SHA</th>
                  <th className="py-2 text-left font-medium">Targets</th>
                  <th className="py-2 text-left font-medium">By</th>
                  <th className="py-2 text-left font-medium">When</th>
                  <th className="py-2 text-left font-medium">Duration</th>
                  <th className="py-2 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {deployments.map(d => {
                  const st = STATUS_STYLES[d.status] || STATUS_STYLES.pending;
                  const StIcon = st.icon;
                  const targetList = d.targets ? Object.entries(d.targets).filter(([, v]) => v).map(([k]) => k[0].toUpperCase()).join('') : '—';
                  return (
                    <tr key={d.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="py-2"><span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${CHANNEL_COLORS[d.channel] || ''}`}>{d.channel}</span></td>
                      <td className="py-2 font-mono text-gray-800">{d.version || '—'}</td>
                      <td className="py-2">
                        <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded ${st.bg} ${st.text}`}>
                          <StIcon className={`w-2.5 h-2.5 ${d.status === 'building' || d.status === 'deploying' ? 'animate-spin' : ''}`} />
                          {d.status}
                        </span>
                      </td>
                      <td className="py-2 font-mono text-gray-600">{d.git_branch || '—'}</td>
                      <td className="py-2 font-mono text-gray-400">{d.git_commit_sha?.slice(0, 7) || '—'}</td>
                      <td className="py-2 text-gray-600">{targetList}</td>
                      <td className="py-2 text-gray-600">{d.triggered_by?.split('@')[0] || '—'}</td>
                      <td className="py-2 text-gray-500">{formatTimeAgo(d.started_at)}</td>
                      <td className="py-2 text-gray-500">{d.duration_seconds ? `${d.duration_seconds}s` : '—'}</td>
                      <td className="py-2 text-right">
                        {d.workflow_run_url && (
                          <a href={d.workflow_run_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:text-blue-800">
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

type DeployTargets = { website: boolean; cloud: boolean; desktop: boolean };

function TargetCheckboxes({ targets, onChange }: { targets: DeployTargets; onChange: (updater: (prev: DeployTargets) => DeployTargets) => void }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[10px] text-gray-500 font-medium uppercase">Deploy Targets</label>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={targets.website} onChange={() => onChange((p) => ({ ...p, website: !p.website }))} className="rounded" /> Website</label>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={targets.cloud} onChange={() => onChange((p) => ({ ...p, cloud: !p.cloud }))} className="rounded" /> Cloud API</label>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={targets.desktop} onChange={() => onChange((p) => ({ ...p, desktop: !p.desktop }))} className="rounded" /> Desktop</label>
    </div>
  );
}
