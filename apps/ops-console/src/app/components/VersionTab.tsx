'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Tag, ArrowUpCircle, GitBranch, Package, RefreshCw,
  CheckCircle, AlertCircle, Clock, ChevronRight, Hash
} from 'lucide-react';
import { StatusData, formatTimeAgo } from '../lib/api';

// ── Types ──
interface AppVersion {
  name: string;
  key: string;
  version: string;
  path: string;
}

interface VersionsResponse {
  apps: AppVersion[];
  monorepo: { version: string; path: string };
  git: {
    latestTag: string | null;
    allTags: string[];
    currentBranch: string;
    isClean: boolean;
    commitSha: string | null;
  };
  history: VersionHistoryEntry[];
}

interface VersionHistoryEntry {
  tag: string;
  date: string | null;
  message: string | null;
  author: string | null;
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

// ── Main Component ──
export default function VersionTab({
  status,
  onAction,
  loading: parentLoading,
}: {
  status: StatusData;
  onAction: (type: string, payload?: Record<string, unknown>) => Promise<boolean>;
  loading: boolean;
}) {
  const [versions, setVersions] = useState<VersionsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Bump state
  const [bumpType, setBumpType] = useState<BumpType>('patch');
  const [bumpApps, setBumpApps] = useState<Record<string, boolean>>({
    desktop: true,
    website: true,
    'cloud-ai': true,
    'ops-console': true,
  });
  const [bumpAll, setBumpAll] = useState(true);
  const [autoCommit, setAutoCommit] = useState(true);
  const [autoTag, setAutoTag] = useState(true);
  const [customVersion, setCustomVersion] = useState('');
  const [useCustomVersion, setUseCustomVersion] = useState(false);

  const loadVersions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ops/versions');
      if (res.ok) {
        const data = await res.json();
        setVersions(data);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadVersions();
  }, [loadVersions]);

  const handleBumpAll = (checked: boolean) => {
    setBumpAll(checked);
    setBumpApps(prev => {
      const updated: Record<string, boolean> = {};
      for (const k of Object.keys(prev)) updated[k] = checked;
      return updated;
    });
  };

  const handleBumpApp = (key: string, checked: boolean) => {
    setBumpApps(prev => ({ ...prev, [key]: checked }));
    if (!checked) setBumpAll(false);
  };

  const getTargetVersion = (): string => {
    if (useCustomVersion && customVersion.trim()) return customVersion.trim();
    // Calculate from the highest current version
    const currentVersions = versions?.apps.map(a => a.version) || ['0.1.0'];
    // Sort and take highest
    const highest = currentVersions
      .map(v => v.replace(/^v/, ''))
      .sort((a, b) => {
        const pa = a.split('.').map(Number);
        const pb = b.split('.').map(Number);
        for (let i = 0; i < 3; i++) {
          if ((pa[i] || 0) !== (pb[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
        }
        return 0;
      })[0] || '0.1.0';
    return bumpVersion(highest, bumpType);
  };

  const handleBump = async () => {
    const targetVersion = getTargetVersion();
    const selectedApps = Object.entries(bumpApps)
      .filter(([, v]) => v)
      .map(([k]) => k);

    if (selectedApps.length === 0) {
      setMessage({ type: 'error', text: 'Select at least one app to bump' });
      return;
    }

    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch('/api/ops/versions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: targetVersion,
          apps: selectedApps,
          autoCommit,
          autoTag,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: 'success', text: data.message || `Bumped to v${targetVersion}` });
        await loadVersions();
      } else {
        setMessage({ type: 'error', text: data.error || 'Bump failed' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error during version bump' });
    } finally {
      setLoading(false);
    }
  };

  const targetVersion = getTargetVersion();

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Message */}
      {message && (
        <div className={`p-3 rounded-lg border flex items-center gap-2 text-sm ${
          message.type === 'error'
            ? 'bg-red-50 border-red-200 text-red-700'
            : 'bg-emerald-50 border-emerald-200 text-emerald-700'
        }`}>
          {message.type === 'error' ? <AlertCircle className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}
          <span className="text-xs font-medium">{message.text}</span>
          <button onClick={() => setMessage(null)} className="ml-auto text-xs opacity-60 hover:opacity-100">Dismiss</button>
        </div>
      )}

      {/* Current Versions Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* All App Versions */}
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Package className="w-4 h-4 text-blue-600" />
              <h3 className="text-sm font-semibold text-gray-800">Package Versions</h3>
            </div>
            <button onClick={loadVersions} disabled={loading} className="btn-secondary px-3 py-1.5 text-xs flex items-center gap-1">
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
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
                {versions?.apps.map(app => {
                  const isSelected = bumpApps[app.key];
                  return (
                    <tr key={app.key} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="py-2.5">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${isSelected ? 'bg-blue-500' : 'bg-gray-300'}`} />
                          <span className="font-medium text-gray-800">{app.name}</span>
                        </div>
                      </td>
                      <td className="py-2.5">
                        <span className="font-mono text-sm text-gray-700 bg-gray-100 px-2 py-0.5 rounded">{app.version}</span>
                      </td>
                      <td className="py-2.5 font-mono text-gray-400">{app.path}</td>
                      <td className="py-2.5 text-right">
                        {isSelected ? (
                          <span className="font-mono text-sm text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">
                            {targetVersion}
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {versions?.monorepo && (
                  <tr className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-purple-500" />
                        <span className="font-medium text-gray-800">Monorepo Root</span>
                      </div>
                    </td>
                    <td className="py-2.5">
                      <span className="font-mono text-sm text-gray-700 bg-gray-100 px-2 py-0.5 rounded">{versions?.monorepo.version || '—'}</span>
                    </td>
                    <td className="py-2.5 font-mono text-gray-400">package.json</td>
                    <td className="py-2.5 text-right"><span className="text-gray-400">—</span></td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Git Tag Info */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Tag className="w-4 h-4 text-purple-600" />
            <h3 className="text-sm font-semibold text-gray-800">Git Tags</h3>
          </div>
          <div className="space-y-3">
            <div>
              <div className="text-[10px] text-gray-500 uppercase font-medium mb-1">Latest Tag</div>
              <div className="font-mono text-lg font-semibold text-gray-900">
                {status.latestTag || <span className="text-gray-400 text-sm">No tags yet</span>}
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
            <div className="pt-2 border-t border-gray-100">
              <div className="text-[10px] text-gray-500 uppercase font-medium mb-2">Recent Tags</div>
              <div className="space-y-1.5">
                {(status.allTags || []).length === 0 && (
                  <div className="text-xs text-gray-400 italic">No tags found</div>
                )}
                {(status.allTags || []).map(tag => (
                  <div key={tag} className="flex items-center gap-2 text-xs">
                    <Hash className="w-3 h-3 text-gray-400" />
                    <span className="font-mono text-gray-700">{tag}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Version Bump Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Bump Type */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <ArrowUpCircle className="w-4 h-4 text-blue-600" />
            <h3 className="text-sm font-semibold text-gray-800">Bump Type</h3>
          </div>
          <div className="space-y-2">
            {(['patch', 'minor', 'major'] as BumpType[]).map(type => {
              const descriptions: Record<BumpType, string> = {
                patch: 'Bug fixes, small changes (0.1.0 → 0.1.1)',
                minor: 'New features, backward-compatible (0.1.0 → 0.2.0)',
                major: 'Breaking changes (0.1.0 → 1.0.0)',
              };
              return (
                <label key={type} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  bumpType === type && !useCustomVersion
                    ? 'border-blue-300 bg-blue-50/50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}>
                  <input
                    type="radio"
                    name="bumpType"
                    checked={bumpType === type && !useCustomVersion}
                    onChange={() => { setBumpType(type); setUseCustomVersion(false); }}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="text-sm font-medium text-gray-800 capitalize">{type}</div>
                    <div className="text-[10px] text-gray-500">{descriptions[type]}</div>
                  </div>
                </label>
              );
            })}

            <div className="pt-2 border-t border-gray-100">
              <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                useCustomVersion ? 'border-blue-300 bg-blue-50/50' : 'border-gray-200 hover:border-gray-300'
              }`}>
                <input
                  type="radio"
                  name="bumpType"
                  checked={useCustomVersion}
                  onChange={() => setUseCustomVersion(true)}
                  className="mt-0.5"
                />
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-800">Custom Version</div>
                  <input
                    type="text"
                    className="input-field mt-1.5"
                    placeholder="e.g. 1.0.0-beta.1"
                    value={customVersion}
                    onChange={e => { setCustomVersion(e.target.value); setUseCustomVersion(true); }}
                  />
                </div>
              </label>
            </div>
          </div>
        </div>

        {/* Target Apps */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Package className="w-4 h-4 text-emerald-600" />
            <h3 className="text-sm font-semibold text-gray-800">Target Apps</h3>
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 p-2 rounded-lg bg-gray-50 text-xs font-medium text-gray-700 cursor-pointer">
              <input type="checkbox" checked={bumpAll} onChange={e => handleBumpAll(e.target.checked)} className="rounded" />
              Select All
            </label>
            <div className="space-y-1">
              {versions?.apps.map(app => (
                <label key={app.key} className="flex items-center gap-2 p-2 rounded hover:bg-gray-50 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={bumpApps[app.key] ?? false}
                    onChange={e => handleBumpApp(app.key, e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-gray-700">{app.name}</span>
                  <span className="ml-auto font-mono text-gray-400">{app.version}</span>
                  {bumpApps[app.key] && (
                    <>
                      <ChevronRight className="w-3 h-3 text-gray-400" />
                      <span className="font-mono text-emerald-600">{targetVersion}</span>
                    </>
                  )}
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Options & Execute */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <GitBranch className="w-4 h-4 text-amber-600" />
            <h3 className="text-sm font-semibold text-gray-800">Options</h3>
          </div>
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={autoCommit} onChange={e => setAutoCommit(e.target.checked)} className="rounded" />
              <span className="text-gray-700">Auto-commit version changes</span>
            </label>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={autoTag} onChange={e => setAutoTag(e.target.checked)} className="rounded" />
              <span className="text-gray-700">Create git tag</span>
            </label>

            {autoTag && (
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-[10px] text-gray-500 uppercase font-medium mb-1">Tag Preview</div>
                <div className="font-mono text-sm text-gray-800">v{targetVersion}</div>
              </div>
            )}

            <div className="pt-3 border-t border-gray-100">
              <div className="bg-blue-50 rounded-lg p-3 mb-3">
                <div className="text-[10px] text-blue-500 uppercase font-medium mb-1">Summary</div>
                <div className="text-xs text-blue-800 space-y-0.5">
                  <div>Version: <span className="font-mono font-semibold">{targetVersion}</span></div>
                  <div>Apps: {Object.values(bumpApps).filter(Boolean).length} selected</div>
                  {autoCommit && <div>+ Auto commit</div>}
                  {autoTag && <div>+ Git tag v{targetVersion}</div>}
                </div>
              </div>

              <button
                onClick={handleBump}
                disabled={loading || parentLoading || (!useCustomVersion && !bumpType)}
                className="btn-primary w-full py-2.5 text-xs disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ArrowUpCircle className="w-3.5 h-3.5" />
                )}
                Bump to v{targetVersion}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Tag History */}
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
                    <td className="py-2">
                      <span className="font-mono text-sm text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                        {entry.tag}
                      </span>
                    </td>
                    <td className="py-2 text-gray-500">
                      {entry.date ? formatTimeAgo(entry.date) : '—'}
                    </td>
                    <td className="py-2 text-gray-700 max-w-[300px] truncate">
                      {entry.message || '—'}
                    </td>
                    <td className="py-2 text-gray-500">{entry.author || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
