'use client';

import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { Users, MessageSquare, Zap, DollarSign, TrendingUp, TrendingDown, Activity, UserPlus, MessagesSquare, Download, Bug, Shield } from 'lucide-react';
import { AnalyticsData, Activity as ActivityItem, SyncSystemData, ServerStatusData, formatTimeAgo, formatNumber, formatCurrency, shortDate } from '../lib/api';

const CHART_COLORS = { blue: '#3B82F6', emerald: '#10B981', purple: '#8B5CF6', amber: '#F59E0B', rose: '#F43F5E' };

function KPICard({ label, value, sub, trend, icon: Icon, color }: { label: string; value: string; sub?: string; trend?: number; icon: React.ElementType; color: string }) {
  const bg = { blue: 'bg-blue-50', emerald: 'bg-emerald-50', purple: 'bg-purple-50', amber: 'bg-amber-50', rose: 'bg-rose-50' }[color] || 'bg-gray-50';
  const iconColor = { blue: 'text-blue-600', emerald: 'text-emerald-600', purple: 'text-purple-600', amber: 'text-amber-600', rose: 'text-rose-600' }[color] || 'text-gray-600';
  return (
    <div className="card card-hover p-5">
      <div className="flex items-start justify-between mb-3">
        <div className={`w-10 h-10 rounded-lg ${bg} flex items-center justify-center`}><Icon className={`w-5 h-5 ${iconColor}`} /></div>
        {trend !== undefined && trend !== 0 && (
          <div className={`flex items-center gap-1 text-xs font-medium ${trend > 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
            {trend > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {trend > 0 ? '+' : ''}{trend}%
          </div>
        )}
      </div>
      <div className="text-2xl font-bold text-gray-900 tracking-tight">{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function MiniAreaChart({ data, dataKey, color }: { data: Record<string, unknown>[]; dataKey: string; color: string }) {
  if (!data?.length) return <div className="h-[120px] flex items-center justify-center text-xs text-gray-400">No data</div>;
  return (
    <ResponsiveContainer width="100%" height={120}>
      <AreaChart data={data} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
        <defs><linearGradient id={`grad-${dataKey}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.15} /><stop offset="100%" stopColor={color} stopOpacity={0} /></linearGradient></defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94A3B8' }} tickFormatter={shortDate} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 10, fill: '#94A3B8' }} width={35} />
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E2E8F0' }} />
        <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} fill={`url(#grad-${dataKey})`} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

const ACTIVITY_ICONS: Record<string, React.ElementType> = {
  conversation: MessagesSquare, signup: UserPlus, feedback: Bug, download: Download, beta: Shield, waitlist: Users,
};
const ACTIVITY_COLORS: Record<string, string> = {
  conversation: 'bg-blue-50 text-blue-600', signup: 'bg-emerald-50 text-emerald-600', feedback: 'bg-amber-50 text-amber-600',
  download: 'bg-purple-50 text-purple-600', beta: 'bg-indigo-50 text-indigo-600', waitlist: 'bg-pink-50 text-pink-600',
};

export default function OverviewTab({ analytics, activities, syncSystems, serverStatus }: {
  analytics: AnalyticsData | null; activities: ActivityItem[]; syncSystems: SyncSystemData | null; serverStatus: ServerStatusData | null;
}) {
  const t = analytics?.totals;
  return (
    <div className="space-y-6 animate-fade-in">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <KPICard icon={Users} color="blue" label="Total Users" value={formatNumber(t?.users || 0)} sub={`+${t?.periodSignups || 0} this period`} trend={t?.periodSignups ? Math.round((t.periodSignups / Math.max(t.users - t.periodSignups, 1)) * 100) : undefined} />
        <KPICard icon={MessageSquare} color="emerald" label="Conversations" value={formatNumber(t?.conversations || 0)} sub={`+${t?.periodConversations || 0} this period`} />
        <KPICard icon={MessagesSquare} color="purple" label="Messages" value={formatNumber(t?.messages || 0)} sub={`+${t?.periodMessages || 0} this period`} />
        <KPICard icon={Zap} color="amber" label="Tokens Used" value={formatNumber(t?.totalTokens || 0)} sub="In selected period" />
        <KPICard icon={DollarSign} color="rose" label="API Cost" value={formatCurrency(t?.totalCost || 0)} sub="In selected period" />
      </div>

      {/* Mini Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card p-4">
          <div className="text-sm font-semibold text-gray-700 mb-2">User Signups</div>
          <MiniAreaChart data={analytics?.signupTrend || []} dataKey="count" color={CHART_COLORS.blue} />
        </div>
        <div className="card p-4">
          <div className="text-sm font-semibold text-gray-700 mb-2">Conversations</div>
          <MiniAreaChart data={analytics?.conversationTrend || []} dataKey="count" color={CHART_COLORS.emerald} />
        </div>
        <div className="card p-4">
          <div className="text-sm font-semibold text-gray-700 mb-2">Token Usage</div>
          <MiniAreaChart data={analytics?.usageTrend || []} dataKey="tokens" color={CHART_COLORS.purple} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Activity Feed */}
        <div className="lg:col-span-2 card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-4 h-4 text-gray-500" />
            <h3 className="text-sm font-semibold text-gray-800">Recent Activity</h3>
          </div>
          <div className="space-y-1 max-h-[400px] overflow-y-auto">
            {activities.length === 0 && <div className="text-sm text-gray-400 py-8 text-center">No recent activity</div>}
            {activities.slice(0, 20).map((a, i) => {
              const Icon = ACTIVITY_ICONS[a.type] || Activity;
              const colorClass = ACTIVITY_COLORS[a.type] || 'bg-gray-50 text-gray-600';
              return (
                <div key={i} className="flex items-start gap-3 py-2.5 border-b border-gray-100 last:border-0">
                  <div className={`w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 ${colorClass}`}><Icon className="w-3.5 h-3.5" /></div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-700 truncate">{a.description}</div>
                    <div className="text-xs text-gray-400">{formatTimeAgo(a.timestamp)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Server & System Status */}
        <div className="space-y-4">
          {serverStatus && (
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-gray-800 mb-3">Cloud Server</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Environment</span><span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">{serverStatus.environment}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Uptime</span><span className="font-medium text-gray-700">{serverStatus.uptime.human}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Memory (RSS)</span><span className="font-mono text-xs">{serverStatus.memory.rss} MB</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Heap</span><span className="font-mono text-xs">{serverStatus.memory.heapUsed}/{serverStatus.memory.heapTotal} MB</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Node</span><span className="font-mono text-xs">{serverStatus.nodeVersion}</span></div>
              </div>
            </div>
          )}

          <div className="card p-5">
            <h3 className="text-sm font-semibold text-gray-800 mb-3">System Health</h3>
            <div className="space-y-2">
              {[
                { name: 'Shared Spaces', status: syncSystems?.sharedSpaces?.status },
                { name: 'Memory Outbox', status: syncSystems?.memoryOutbox?.status },
                { name: 'Webhooks', status: syncSystems?.webhooks?.status || 'operational' },
                { name: 'Devices', status: syncSystems?.devices?.status },
                { name: 'Marketplace', status: syncSystems?.marketplace?.status },
                { name: 'Feedback', status: syncSystems?.feedback?.status },
              ].map((s) => (
                <div key={s.name} className="flex items-center justify-between py-1.5">
                  <span className="text-sm text-gray-600">{s.name}</span>
                  <div className="flex items-center gap-1.5">
                    <div className={`w-1.5 h-1.5 rounded-full ${s.status === 'operational' ? 'bg-emerald-500 animate-pulse-dot' : 'bg-amber-500'}`} />
                    <span className={`text-xs ${s.status === 'operational' ? 'text-emerald-600' : 'text-amber-600'}`}>{s.status || 'unknown'}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
