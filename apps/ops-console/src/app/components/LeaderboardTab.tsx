'use client';

import { Trophy, Flame, Loader2, ChevronRight } from 'lucide-react';
import { LeaderboardData, LeaderboardEntry, LeaderboardMetric, formatNumber, formatCurrency, formatTimeAgo } from '../lib/api';
import { LEADERBOARD_METRIC_LABELS } from './UserDetail';

const PLAN_COLORS: Record<string, string> = {
  free: 'bg-gray-100 text-gray-600',
  pro: 'bg-blue-50 text-blue-700',
  team: 'bg-purple-50 text-purple-700',
  enterprise: 'bg-amber-50 text-amber-700',
};

const METRICS: LeaderboardMetric[] = ['credits', 'cost', 'tokens', 'requests'];

function metricValue(e: LeaderboardEntry, m: LeaderboardMetric): number {
  return m === 'credits' ? e.credits : m === 'cost' ? e.cost : m === 'tokens' ? e.tokens : e.requests;
}
function formatMetric(v: number, m: LeaderboardMetric): string {
  return m === 'cost' ? formatCurrency(v) : formatNumber(v);
}

function rankBadge(i: number) {
  if (i === 0) return 'bg-amber-100 text-amber-700';
  if (i === 1) return 'bg-gray-200 text-gray-700';
  if (i === 2) return 'bg-orange-100 text-orange-700';
  return 'bg-gray-100 text-gray-500';
}

export default function LeaderboardTab({ data, loading, days, onDaysChange, metric, onMetricChange, onSelectUser }: {
  data: LeaderboardData | null;
  loading: boolean;
  days: number;
  onDaysChange: (d: number) => void;
  metric: LeaderboardMetric;
  onMetricChange: (m: LeaderboardMetric) => void;
  onSelectUser: (userId: string) => void;
}) {
  const entries = data?.entries || [];
  const max = entries.length > 0 ? Math.max(...entries.map(e => metricValue(e, metric))) : 0;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2"><Trophy className="w-4 h-4 text-amber-500" /> Leaderboard</h2>
          <p className="text-sm text-gray-500">Heaviest users by {LEADERBOARD_METRIC_LABELS[metric].toLowerCase()} over {days} days</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {METRICS.map(m => (
              <button key={m} onClick={() => onMetricChange(m)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${metric === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                {LEADERBOARD_METRIC_LABELS[m]}
              </button>
            ))}
          </div>
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {[7, 14, 30, 60, 90].map(d => (
              <button key={d} onClick={() => onDaysChange(d)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${days === d ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                {d}d
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Summary */}
      {data && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="card p-4"><div className="text-xs text-gray-500 mb-1">Active Users</div><div className="text-xl font-bold text-gray-900">{formatNumber(data.activeUsers)}</div></div>
          <div className="card p-4"><div className="text-xs text-gray-500 mb-1">Requests</div><div className="text-xl font-bold text-gray-900">{formatNumber(data.totals.requests)}</div></div>
          <div className="card p-4"><div className="text-xs text-gray-500 mb-1">Tokens</div><div className="text-xl font-bold text-gray-900">{formatNumber(data.totals.tokens)}</div></div>
          <div className="card p-4"><div className="text-xs text-gray-500 mb-1">Credits / Cost</div><div className="text-xl font-bold text-gray-900">{formatNumber(data.totals.credits)} <span className="text-sm text-gray-400 font-medium">/ {formatCurrency(data.totals.cost)}</span></div></div>
        </div>
      )}

      {/* Ranked list */}
      <div className="card overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-100 flex items-center gap-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
          <Flame className="w-3.5 h-3.5 text-orange-400" /> Heavy users
        </div>
        {loading && !data ? (
          <div className="flex items-center justify-center h-48 text-gray-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : entries.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-gray-400 text-sm">No usage in this window</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {entries.map((e, i) => {
              const v = metricValue(e, metric);
              const pct = max > 0 ? Math.max(2, Math.round((v / max) * 100)) : 0;
              return (
                <button key={e.id} onClick={() => onSelectUser(e.id)}
                  className="w-full text-left px-4 py-3 hover:bg-gray-50/70 transition-colors flex items-center gap-3 group">
                  <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 ${rankBadge(i)}`}>{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-gray-800 truncate">{e.email || e.id.slice(0, 12) + '…'}</span>
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${PLAN_COLORS[e.plan] || 'bg-gray-100 text-gray-600'}`}>{e.plan}</span>
                    </div>
                    {/* metric bar */}
                    <div className="mt-1.5 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-[11px] text-gray-400">
                      <span>{formatNumber(e.requests)} req</span>
                      <span>{formatNumber(e.tokens)} tok</span>
                      <span>{formatCurrency(e.cost)}</span>
                      <span>{formatNumber(e.credits)} cr</span>
                      <span>· active {formatTimeAgo(e.lastActive)}</span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-sm font-bold text-gray-900 tabular-nums">{formatMetric(v, metric)}</div>
                    <div className="text-[10px] text-gray-400">{LEADERBOARD_METRIC_LABELS[metric]}</div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500 flex-shrink-0" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
