'use client';

import { AreaChart, Area, BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { X, Mail, Calendar, Clock, Activity, Loader2, Cpu, Coins } from 'lucide-react';
import { UserActivityData, formatNumber, formatCurrency, formatDate, formatTimeAgo, shortDate, LeaderboardMetric } from '../lib/api';

const PLAN_COLORS: Record<string, string> = {
  free: 'bg-gray-100 text-gray-600',
  pro: 'bg-blue-50 text-blue-700',
  team: 'bg-purple-50 text-purple-700',
  enterprise: 'bg-amber-50 text-amber-700',
};

const CATEGORY_LABELS: Record<string, string> = {
  inference: 'Inference', voice: 'Voice', messaging: 'Messaging',
  compute: 'Compute', storage: 'Storage', subagent: 'Subagents',
};

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-3">
      <div className="text-[11px] text-gray-500 mb-0.5">{label}</div>
      <div className="text-lg font-bold text-gray-900 leading-tight">{value}</div>
      {sub && <div className="text-[10px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

export default function UserDetail({ data, loading, days, onDaysChange, onClose }: {
  data: UserActivityData | null;
  loading: boolean;
  days: number;
  onDaysChange: (d: number) => void;
  onClose: () => void;
}) {
  const profile = data?.profile;
  const totals = data?.totals;
  const limitPct = profile && profile.monthlyTokenLimit > 0 && totals
    ? Math.min(100, Math.round((totals.tokens / profile.monthlyTokenLimit) * 100))
    : null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[1px] animate-fade-in" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-2xl h-full bg-[#F8FAFC] shadow-2xl overflow-y-auto animate-slide-in-right">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-6 py-4 flex items-start justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-semibold text-gray-900 truncate">{profile?.email || 'User activity'}</h2>
              {profile && (
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-md ${PLAN_COLORS[profile.plan] || 'bg-gray-100 text-gray-600'}`}>{profile.plan}</span>
              )}
              {profile && (
                <span className={`text-[11px] ${profile.status === 'active' ? 'text-emerald-600' : 'text-gray-400'}`}>{profile.status}</span>
              )}
            </div>
            {profile && (
              <div className="text-[11px] font-mono text-gray-400 mt-0.5">{profile.id}</div>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Period selector */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">Activity over the last {days} days</p>
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
              {[7, 14, 30, 60, 90].map(d => (
                <button key={d} onClick={() => onDaysChange(d)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${days === d ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  {d}d
                </button>
              ))}
            </div>
          </div>

          {loading && !data ? (
            <div className="flex items-center justify-center h-64 text-gray-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : !data ? (
            <div className="flex items-center justify-center h-64 text-gray-400 text-sm">No activity data.</div>
          ) : (
            <>
              {/* Meta row */}
              <div className="card p-4 grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                <div className="flex items-center gap-2 text-gray-600"><Mail className="w-3.5 h-3.5 text-gray-400" /><span className="truncate">{profile?.email || '—'}</span></div>
                <div className="flex items-center gap-2 text-gray-600"><Calendar className="w-3.5 h-3.5 text-gray-400" />Joined {formatDate(profile?.createdAt)}</div>
                <div className="flex items-center gap-2 text-gray-600"><Clock className="w-3.5 h-3.5 text-gray-400" />Last sign-in {formatTimeAgo(profile?.lastSignIn)}</div>
                <div className="flex items-center gap-2 text-gray-600"><Activity className="w-3.5 h-3.5 text-gray-400" />Last active {formatTimeAgo(totals?.lastActive)}</div>
                <div className="flex items-center gap-2 text-gray-600"><Cpu className="w-3.5 h-3.5 text-gray-400" />{totals?.models || 0} models · {totals?.conversations || 0} convos</div>
                <div className="flex items-center gap-2 text-gray-600">
                  <Coins className="w-3.5 h-3.5 text-gray-400" />
                  Limit {profile?.monthlyTokenLimit ? formatNumber(profile.monthlyTokenLimit) : '∞'}{limitPct !== null ? ` · ${limitPct}% used` : ''}
                </div>
              </div>

              {/* Stat cards */}
              <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
                <StatCard label="Requests" value={formatNumber(totals?.requests)} />
                <StatCard label="Tokens" value={formatNumber(totals?.tokens)} />
                <StatCard label="API Cost" value={formatCurrency(totals?.cost)} />
                <StatCard label="Credits" value={formatNumber(totals?.credits)} />
                <StatCard label="Active days" value={String(totals?.activeDays ?? 0)} sub={`of ${days}d`} />
                <StatCard label="Avg tokens/req" value={formatNumber(totals?.avgTokensPerReq)} />
              </div>

              {/* Use rate chart */}
              <div className="card p-5">
                <h3 className="text-sm font-semibold text-gray-800 mb-4">Use rate</h3>
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={data.usageTrend} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="udReq" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8B5CF6" stopOpacity={0.25} /><stop offset="100%" stopColor="#8B5CF6" stopOpacity={0} /></linearGradient>
                      <linearGradient id="udTok" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3B82F6" stopOpacity={0.2} /><stop offset="100%" stopColor="#3B82F6" stopOpacity={0} /></linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94A3B8' }} tickFormatter={shortDate} interval="preserveStartEnd" />
                    <YAxis yAxisId="req" tick={{ fontSize: 10, fill: '#94A3B8' }} width={30} allowDecimals={false} />
                    <YAxis yAxisId="tok" orientation="right" tick={{ fontSize: 10, fill: '#94A3B8' }} width={45} tickFormatter={(v: number) => formatNumber(v)} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E2E8F0' }} />
                    <Legend />
                    <Area yAxisId="req" type="monotone" dataKey="requests" name="Requests" stroke="#8B5CF6" strokeWidth={2} fill="url(#udReq)" />
                    <Area yAxisId="tok" type="monotone" dataKey="tokens" name="Tokens" stroke="#3B82F6" strokeWidth={2} fill="url(#udTok)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* Usage by category (credits) — matches billing categorization */}
              {data.categoryBreakdown && data.categoryBreakdown.length > 0 && (
                <div className="card p-5">
                  <h3 className="text-sm font-semibold text-gray-800 mb-4">Usage by category</h3>
                  {(() => {
                    const maxCredits = Math.max(...data.categoryBreakdown.map(c => c.credits), 0);
                    return (
                      <div className="space-y-2.5">
                        {data.categoryBreakdown.map(c => (
                          <div key={c.category} className="flex items-center gap-3 text-xs">
                            <span className="w-20 text-gray-600 capitalize flex-shrink-0">{CATEGORY_LABELS[c.category] || c.category}</span>
                            <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full bg-blue-500 rounded-full" style={{ width: `${maxCredits > 0 ? Math.max(2, Math.round((c.credits / maxCredits) * 100)) : 0}%` }} />
                            </div>
                            <span className="w-16 text-right text-gray-700 tabular-nums flex-shrink-0">{formatNumber(c.credits)} cr</span>
                            <span className="w-16 text-right text-gray-400 tabular-nums flex-shrink-0">{formatCurrency(c.cost)}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Model breakdown */}
              <div className="card p-5">
                <h3 className="text-sm font-semibold text-gray-800 mb-4">Model usage</h3>
                {data.modelBreakdown.length === 0 ? (
                  <div className="h-32 flex items-center justify-center text-sm text-gray-400">No usage data</div>
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={Math.max(120, data.modelBreakdown.slice(0, 8).length * 32)}>
                      <BarChart data={data.modelBreakdown.slice(0, 8)} layout="vertical" margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 10, fill: '#94A3B8' }} tickFormatter={(v: number) => formatNumber(v)} />
                        <YAxis type="category" dataKey="model" tick={{ fontSize: 10, fill: '#64748B' }} width={130} />
                        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E2E8F0' }} formatter={(v: number) => formatNumber(v)} />
                        <Bar dataKey="tokens" name="Tokens" fill="#3B82F6" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead><tr className="text-gray-500 border-b border-gray-100"><th className="py-1.5 text-left">Model</th><th className="py-1.5 text-right">Requests</th><th className="py-1.5 text-right">Tokens</th><th className="py-1.5 text-right">Cost</th></tr></thead>
                        <tbody>
                          {data.modelBreakdown.map(m => (
                            <tr key={m.model} className="border-b border-gray-50">
                              <td className="py-1.5 font-mono text-gray-700">{m.model}</td>
                              <td className="py-1.5 text-right text-gray-600">{m.count}</td>
                              <td className="py-1.5 text-right text-gray-600">{formatNumber(m.tokens)}</td>
                              <td className="py-1.5 text-right text-gray-600">{formatCurrency(m.cost)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export const LEADERBOARD_METRIC_LABELS: Record<LeaderboardMetric, string> = {
  credits: 'Credits',
  cost: 'API Cost',
  tokens: 'Tokens',
  requests: 'Requests',
};
