'use client';

import { AreaChart, Area, BarChart, Bar, LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, Legend, PieChart, Pie, Cell } from 'recharts';
import { AnalyticsData, shortDate, formatNumber, formatCurrency } from '../lib/api';

const COLORS = ['#3B82F6', '#10B981', '#8B5CF6', '#F59E0B', '#F43F5E', '#06B6D4', '#84CC16', '#EC4899'];

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-5">
      <h3 className="text-sm font-semibold text-gray-800 mb-4">{title}</h3>
      {children}
    </div>
  );
}

export default function AnalyticsTab({ analytics, days, onDaysChange }: {
  analytics: AnalyticsData | null; days: number; onDaysChange: (d: number) => void;
}) {
  if (!analytics) return <div className="flex items-center justify-center h-64 text-gray-400">Loading analytics...</div>;

  const { signupTrend, usageTrend, activeUsersTrend, modelBreakdown, categoryBreakdown, totals, engagement } = analytics;
  const CATEGORY_LABELS: Record<string, string> = {
    inference: 'Inference', voice: 'Voice', messaging: 'Messaging',
    compute: 'Compute', storage: 'Storage', subagent: 'Subagents',
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Period Selector */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Analytics</h2>
          <p className="text-sm text-gray-500">Trends over the last {days} days</p>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {[7, 14, 30, 60, 90].map(d => (
            <button key={d} onClick={() => onDaysChange(d)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${days === d ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-4"><div className="text-xs text-gray-500 mb-1">Period Signups</div><div className="text-xl font-bold text-gray-900">{totals.periodSignups}</div></div>
        <div className="card p-4"><div className="text-xs text-gray-500 mb-1">API Requests</div><div className="text-xl font-bold text-gray-900">{formatNumber(totals.totalRequests)}</div></div>
        <div className="card p-4"><div className="text-xs text-gray-500 mb-1">Tokens Used</div><div className="text-xl font-bold text-gray-900">{formatNumber(totals.totalTokens)}</div></div>
        <div className="card p-4"><div className="text-xs text-gray-500 mb-1">API Cost</div><div className="text-xl font-bold text-gray-900">{formatCurrency(totals.totalCost)}</div></div>
      </div>

      {/* Engagement cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-4"><div className="text-xs text-gray-500 mb-1">Active (24h)</div><div className="text-xl font-bold text-gray-900">{formatNumber(engagement?.dau || 0)}</div></div>
        <div className="card p-4"><div className="text-xs text-gray-500 mb-1">Active (7d)</div><div className="text-xl font-bold text-gray-900">{formatNumber(engagement?.wau || 0)}</div></div>
        <div className="card p-4"><div className="text-xs text-gray-500 mb-1">Active (30d)</div><div className="text-xl font-bold text-gray-900">{formatNumber(engagement?.mau || 0)}</div></div>
        <div className="card p-4"><div className="text-xs text-gray-500 mb-1">Avg Cost / Request</div><div className="text-xl font-bold text-gray-900">{formatCurrency(totals.avgCostPerRequest)}</div></div>
      </div>

      {/* Active Users trend */}
      <ChartCard title="Active Users per Day">
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={activeUsersTrend || []} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <defs><linearGradient id="activeGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#06B6D4" stopOpacity={0.25} /><stop offset="100%" stopColor="#06B6D4" stopOpacity={0} /></linearGradient></defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94A3B8' }} tickFormatter={shortDate} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10, fill: '#94A3B8' }} width={30} allowDecimals={false} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E2E8F0' }} />
            <Area type="monotone" dataKey="users" name="Active Users" stroke="#06B6D4" strokeWidth={2} fill="url(#activeGrad)" />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Usage by category (credits) — mirrors billing categorization */}
      <ChartCard title="Usage by Category (credits)">
        {!categoryBreakdown || categoryBreakdown.length === 0 ? (
          <div className="h-[200px] flex items-center justify-center text-sm text-gray-400">No usage data</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ResponsiveContainer width="100%" height={Math.max(160, categoryBreakdown.length * 38)}>
              <BarChart data={categoryBreakdown.map(c => ({ ...c, label: CATEGORY_LABELS[c.category] || c.category }))} layout="vertical" margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: '#94A3B8' }} tickFormatter={(v: number) => formatNumber(v)} />
                <YAxis type="category" dataKey="label" tick={{ fontSize: 11, fill: '#64748B' }} width={90} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E2E8F0' }} formatter={(v: number) => formatNumber(v)} />
                <Bar dataKey="credits" name="Credits" radius={[0, 4, 4, 0]}>
                  {categoryBreakdown.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="overflow-x-auto self-center">
              <table className="w-full text-xs">
                <thead><tr className="text-gray-500 border-b border-gray-100"><th className="py-1.5 text-left">Category</th><th className="py-1.5 text-right">Credits</th><th className="py-1.5 text-right">Cost</th><th className="py-1.5 text-right">Events</th></tr></thead>
                <tbody>
                  {categoryBreakdown.map(c => (
                    <tr key={c.category} className="border-b border-gray-50">
                      <td className="py-1.5 text-gray-700">{CATEGORY_LABELS[c.category] || c.category}</td>
                      <td className="py-1.5 text-right text-gray-600">{formatNumber(c.credits)}</td>
                      <td className="py-1.5 text-right text-gray-600">{formatCurrency(c.cost)}</td>
                      <td className="py-1.5 text-right text-gray-600">{c.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </ChartCard>

      {/* Signups + Conversations chart */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="User Signups">
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={signupTrend} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <defs><linearGradient id="signupGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3B82F6" stopOpacity={0.2} /><stop offset="100%" stopColor="#3B82F6" stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94A3B8' }} tickFormatter={shortDate} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fill: '#94A3B8' }} width={30} allowDecimals={false} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E2E8F0' }} />
              <Area type="monotone" dataKey="count" name="Signups" stroke="#3B82F6" strokeWidth={2} fill="url(#signupGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="API Requests">
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={usageTrend} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <defs><linearGradient id="reqGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10B981" stopOpacity={0.2} /><stop offset="100%" stopColor="#10B981" stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94A3B8' }} tickFormatter={shortDate} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fill: '#94A3B8' }} width={30} allowDecimals={false} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E2E8F0' }} />
              <Area type="monotone" dataKey="requests" name="Requests" stroke="#10B981" strokeWidth={2} fill="url(#reqGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Token & Cost Usage */}
      <ChartCard title="Token Usage & API Cost">
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={usageTrend} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94A3B8' }} tickFormatter={shortDate} interval="preserveStartEnd" />
            <YAxis yAxisId="tokens" tick={{ fontSize: 10, fill: '#94A3B8' }} width={50} tickFormatter={(v: number) => formatNumber(v)} />
            <YAxis yAxisId="cost" orientation="right" tick={{ fontSize: 10, fill: '#94A3B8' }} width={50} tickFormatter={(v: number) => `$${v.toFixed(2)}`} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E2E8F0' }} />
            <Legend />
            <Line yAxisId="tokens" type="monotone" dataKey="tokens" name="Tokens" stroke="#8B5CF6" strokeWidth={2} dot={false} />
            <Line yAxisId="cost" type="monotone" dataKey="cost" name="Cost ($)" stroke="#F43F5E" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Model Breakdown + Role Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="Model Usage">
          {modelBreakdown.length === 0 ? (
            <div className="h-[250px] flex items-center justify-center text-sm text-gray-400">No usage data</div>
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={modelBreakdown.slice(0, 8)} margin={{ top: 5, right: 10, left: 0, bottom: 0 }} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: '#94A3B8' }} tickFormatter={(v: number) => formatNumber(v)} />
                <YAxis type="category" dataKey="model" tick={{ fontSize: 10, fill: '#64748B' }} width={120} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E2E8F0' }} />
                <Bar dataKey="tokens" name="Tokens" fill="#3B82F6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
          {modelBreakdown.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-gray-500 border-b border-gray-100"><th className="py-1.5 text-left">Model</th><th className="py-1.5 text-right">Requests</th><th className="py-1.5 text-right">Tokens</th><th className="py-1.5 text-right">Cost</th></tr></thead>
                <tbody>
                  {modelBreakdown.map(m => (
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
          )}
        </ChartCard>

        <ChartCard title="Cost by Model">
          {modelBreakdown.length === 0 ? (
            <div className="h-[250px] flex items-center justify-center text-sm text-gray-400">No usage data</div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={modelBreakdown.slice(0, 8).map(m => ({ name: m.model, value: m.cost }))} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={3} dataKey="value" label={({ name, percent }: { name: string; percent: number }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                    {modelBreakdown.slice(0, 8).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E2E8F0' }} formatter={(v: number) => formatCurrency(v)} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-3 mt-2 justify-center">
                {modelBreakdown.slice(0, 8).map((m, i) => (
                  <div key={m.model} className="flex items-center gap-1.5 text-xs text-gray-600">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                    {m.model}: {formatCurrency(m.cost)}
                  </div>
                ))}
              </div>
            </>
          )}
        </ChartCard>
      </div>

      {/* Requests trend */}
      <ChartCard title="API Requests per Day">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={usageTrend} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94A3B8' }} tickFormatter={shortDate} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10, fill: '#94A3B8' }} width={40} allowDecimals={false} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E2E8F0' }} />
            <Bar dataKey="requests" name="Requests" fill="#8B5CF6" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
