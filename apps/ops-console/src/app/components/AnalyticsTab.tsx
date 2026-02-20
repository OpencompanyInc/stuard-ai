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

  const { signupTrend, conversationTrend, messageTrend, usageTrend, modelBreakdown, roleBreakdown, totals } = analytics;

  const roleData = Object.entries(roleBreakdown || {}).map(([role, count]) => ({ name: role, value: count }));

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
        <div className="card p-4"><div className="text-xs text-gray-500 mb-1">Period Conversations</div><div className="text-xl font-bold text-gray-900">{formatNumber(totals.periodConversations)}</div></div>
        <div className="card p-4"><div className="text-xs text-gray-500 mb-1">Tokens Used</div><div className="text-xl font-bold text-gray-900">{formatNumber(totals.totalTokens)}</div></div>
        <div className="card p-4"><div className="text-xs text-gray-500 mb-1">API Cost</div><div className="text-xl font-bold text-gray-900">{formatCurrency(totals.totalCost)}</div></div>
      </div>

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

        <ChartCard title="Conversations">
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={conversationTrend} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <defs><linearGradient id="convGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10B981" stopOpacity={0.2} /><stop offset="100%" stopColor="#10B981" stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94A3B8' }} tickFormatter={shortDate} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fill: '#94A3B8' }} width={30} allowDecimals={false} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E2E8F0' }} />
              <Area type="monotone" dataKey="count" name="Conversations" stroke="#10B981" strokeWidth={2} fill="url(#convGrad)" />
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

        <ChartCard title="Message Roles">
          {roleData.length === 0 ? (
            <div className="h-[250px] flex items-center justify-center text-sm text-gray-400">No message data</div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={roleData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={3} dataKey="value" label={({ name, percent }: { name: string; percent: number }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                    {roleData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E2E8F0' }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-3 mt-2 justify-center">
                {roleData.map((r, i) => (
                  <div key={r.name} className="flex items-center gap-1.5 text-xs text-gray-600">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                    {r.name}: {formatNumber(r.value)}
                  </div>
                ))}
              </div>
            </>
          )}
        </ChartCard>
      </div>

      {/* Messages trend */}
      <ChartCard title="Messages per Day">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={messageTrend} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94A3B8' }} tickFormatter={shortDate} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10, fill: '#94A3B8' }} width={40} allowDecimals={false} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E2E8F0' }} />
            <Bar dataKey="count" name="Messages" fill="#8B5CF6" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
