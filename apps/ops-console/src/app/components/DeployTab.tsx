'use client';

import { useState } from 'react';
import { GitBranch, Rocket, RefreshCw, CheckCircle, AlertCircle, ShieldCheck, Beaker, Terminal, Cloud, Clock, XCircle, Loader2, ExternalLink, History } from 'lucide-react';
import { StatusData, Deployment, formatDate, formatTimeAgo } from '../lib/api';

const STATUS_STYLES: Record<string, { bg: string; text: string; icon: any }> = {
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

export default function DeployTab({ status, onAction, loading, message, deployments, latestByChannel, onRefreshDeploys }: {
  status: StatusData;
  onAction: (type: string, payload?: Record<string, unknown>) => Promise<boolean>;
  loading: boolean;
  message: string;
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

  const updateChannels = [
    { key: 'stable', label: 'Stable', data: status?.updates?.stable, badgeClass: 'badge-success' },
    { key: 'staging', label: 'Staging', data: status?.updates?.staging, badgeClass: 'badge-info' },
    { key: 'beta', label: 'Beta', data: status?.updates?.beta, badgeClass: 'bg-purple-50 text-purple-600 border border-purple-200' },
  ];

  const handleShipToBeta = async () => {
    const checksPassed = await onAction('run-checks');
    if (!checksPassed) return;
    await new Promise(r => setTimeout(r, 1000));
    await onAction('ship-to-beta', { targets: betaTargets, sourceBranch: selectedBetaBranch || undefined });
  };

  return (
    <div className="space-y-6 animate-fade-in">
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

      {/* Version Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <div><div className="text-xs text-gray-500 font-medium uppercase">Version Control</div><div className="text-sm font-semibold text-gray-800">Codebase</div></div>
            <div className="text-right"><div className="text-[10px] text-gray-500 uppercase font-medium">Latest Tag</div><div className="font-mono text-xs text-gray-700">{status.latestTag || 'none'}</div></div>
          </div>
          <div className="space-y-1.5 pt-2 border-t border-gray-100">
            <div className="flex justify-between"><span className="text-gray-500 text-xs">Desktop</span><span className="font-mono text-sm text-gray-800">{status.versions?.desktop || '—'}</span></div>
            <div className="flex justify-between"><span className="text-gray-500 text-xs">Website</span><span className="font-mono text-sm text-gray-800">{status.versions?.website || '—'}</span></div>
            <div className="flex justify-between"><span className="text-gray-500 text-xs">Cloud</span><span className="font-mono text-sm text-gray-800">{status.versions?.cloud || '—'}</span></div>
          </div>
        </div>

        {updateChannels.map(ch => (
          <div key={ch.key} className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <div><div className="text-xs text-gray-500 font-medium uppercase">{ch.label}</div><div className="text-sm font-semibold text-gray-800">Update Channel</div></div>
              <span className={`text-[10px] font-medium px-2 py-1 rounded-md ${ch.badgeClass}`}>{ch.data?.ok ? 'Active' : 'Offline'}</span>
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between"><span className="text-xs text-gray-500">Version</span><span className="font-mono text-sm text-gray-800">{ch.data?.version || '—'}</span></div>
              <div className="flex justify-between"><span className="text-xs text-gray-500">Released</span><span className="text-xs text-gray-600">{formatDate(ch.data?.releaseDate)}</span></div>
            </div>
            <div className="text-xs mt-2">{ch.data?.error ? <span className="text-amber-600">Unavailable</span> : <a href={ch.data?.url || '#'} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">View manifest</a>}</div>
          </div>
        ))}
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
              <input type="text" className="input-field" placeholder="v1.0.0" value={version} onChange={e => setVersion(e.target.value)} />
            </div>
            <TargetCheckboxes targets={prodTargets} onChange={setProdTargets} />
            <button onClick={() => onAction('ship-to-prod', { version, targets: prodTargets })} disabled={loading || !version.trim()} className="btn-primary w-full py-2 text-xs disabled:opacity-40">Ship to Production</button>
          </div>
        </div>
      </div>

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

function TargetCheckboxes({ targets, onChange }: { targets: { website: boolean; cloud: boolean; desktop: boolean }; onChange: (t: any) => void }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[10px] text-gray-500 font-medium uppercase">Deploy Targets</label>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={targets.website} onChange={() => onChange((p: any) => ({ ...p, website: !p.website }))} className="rounded" /> Website</label>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={targets.cloud} onChange={() => onChange((p: any) => ({ ...p, cloud: !p.cloud }))} className="rounded" /> Cloud API</label>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={targets.desktop} onChange={() => onChange((p: any) => ({ ...p, desktop: !p.desktop }))} className="rounded" /> Desktop</label>
    </div>
  );
}
