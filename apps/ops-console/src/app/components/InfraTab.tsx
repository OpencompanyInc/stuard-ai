'use client';

import { RefreshCw, Cloud, HardDrive, Webhook, Monitor, Database, Server, Cpu, MemoryStick } from 'lucide-react';
import { SyncSystemData, ServerStatusData, formatTimeAgo } from '../lib/api';

export default function InfraTab({ syncSystems, dbStats, serverStatus, onRefresh }: {
  syncSystems: SyncSystemData | null;
  dbStats: Record<string, number> | null;
  serverStatus: ServerStatusData | null;
  onRefresh: () => void;
}) {
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Infrastructure</h2>
          <p className="text-sm text-gray-500">Cloud sync systems, database, and server status</p>
        </div>
        <button onClick={onRefresh} className="btn-secondary px-4 py-2 text-sm flex items-center gap-2">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* Server Status */}
      {serverStatus && (
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Server className="w-4 h-4 text-gray-500" />
            <h3 className="text-sm font-semibold text-gray-800">Cloud Server</h3>
            <span className={`text-xs px-2 py-0.5 rounded-md ${serverStatus.isProduction ? 'badge-success' : 'badge-info'}`}>
              {serverStatus.environment}
            </span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <div>
              <div className="text-xs text-gray-500 mb-1">Uptime</div>
              <div className="text-sm font-semibold text-gray-900">{serverStatus.uptime.human}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">Node Version</div>
              <div className="text-sm font-mono text-gray-900">{serverStatus.nodeVersion}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">Memory (RSS)</div>
              <div className="text-sm font-mono text-gray-900">{serverStatus.memory.rss} MB</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">Heap Used / Total</div>
              <div className="text-sm font-mono text-gray-900">{serverStatus.memory.heapUsed} / {serverStatus.memory.heapTotal} MB</div>
              <div className="mt-1 w-full bg-gray-200 rounded-full h-1.5">
                <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${Math.min(100, (serverStatus.memory.heapUsed / serverStatus.memory.heapTotal) * 100)}%` }} />
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">Started At</div>
              <div className="text-xs text-gray-700">{new Date(serverStatus.startedAt).toLocaleString()}</div>
            </div>
          </div>
        </div>
      )}

      {/* Sync Systems */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <SyncCard icon={Cloud} color="violet" name="Shared Spaces" subtitle="E2E Encrypted Sync"
          rows={[
            { label: 'Total', value: String(syncSystems?.sharedSpaces?.total ?? '—') },
            { label: 'Status', value: syncSystems?.sharedSpaces?.status || 'unknown', isStatus: true },
            { label: 'Last Sync', value: formatTimeAgo(syncSystems?.sharedSpaces?.recentSync) },
          ]} />
        <SyncCard icon={HardDrive} color="blue" name="Memory Outbox" subtitle="Offline Delivery"
          rows={[
            { label: 'Total', value: String(syncSystems?.memoryOutbox?.total ?? '—') },
            { label: 'Pending', value: String(syncSystems?.memoryOutbox?.pending ?? 0), warn: (syncSystems?.memoryOutbox?.pending || 0) > 0 },
            { label: 'Failed', value: String(syncSystems?.memoryOutbox?.failed ?? 0), error: (syncSystems?.memoryOutbox?.failed || 0) > 0 },
          ]} />
        <SyncCard icon={Webhook} color="amber" name="Webhooks" subtitle="Event Triggers"
          rows={[
            { label: 'Active', value: `${syncSystems?.webhooks?.active ?? 0} / ${syncSystems?.webhooks?.total ?? 0}` },
            { label: 'Total Triggers', value: String(syncSystems?.webhooks?.totalTriggers ?? 0) },
            { label: 'Pending', value: String(syncSystems?.webhooks?.pendingDeliveries ?? 0), warn: (syncSystems?.webhooks?.pendingDeliveries || 0) > 0 },
          ]} />
        <SyncCard icon={Monitor} color="emerald" name="Devices" subtitle="Connected Clients"
          rows={[
            { label: 'Online', value: `${syncSystems?.devices?.online ?? 0} / ${syncSystems?.devices?.total ?? 0}` },
            { label: 'Status', value: syncSystems?.devices?.status || 'unknown', isStatus: true },
            ...(syncSystems?.devices?.byPlatform ? Object.entries(syncSystems.devices.byPlatform).map(([p, c]) => ({ label: p, value: String(c) })) : []),
          ]} />
      </div>

      {/* More sync systems */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center"><Database className="w-4 h-4 text-blue-600" /></div>
            <div><div className="text-sm font-semibold text-gray-800">Conversations</div><div className="text-xs text-gray-500">AI Chat Sessions</div></div>
          </div>
          <div className="space-y-1.5">
            <Row label="Total" value={String(syncSystems?.conversations?.total?.toLocaleString() ?? '—')} />
            <Row label="Messages" value={String(syncSystems?.conversations?.messages?.toLocaleString() ?? '—')} />
          </div>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-lg bg-purple-50 flex items-center justify-center"><Cpu className="w-4 h-4 text-purple-600" /></div>
            <div><div className="text-sm font-semibold text-gray-800">Marketplace</div><div className="text-xs text-gray-500">Workflow Store</div></div>
          </div>
          <div className="space-y-1.5">
            <Row label="Workflows" value={String(syncSystems?.marketplace?.workflows ?? '—')} />
            <Row label="Downloads" value={String(syncSystems?.marketplace?.totalDownloads ?? 0)} />
          </div>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center"><MemoryStick className="w-4 h-4 text-amber-600" /></div>
            <div><div className="text-sm font-semibold text-gray-800">Feedback</div><div className="text-xs text-gray-500">User Reports</div></div>
          </div>
          <div className="space-y-1.5">
            <Row label="Total" value={String(syncSystems?.feedback?.total ?? '—')} />
            <Row label="Open Bugs" value={String(syncSystems?.feedback?.openBugs ?? 0)} error={(syncSystems?.feedback?.openBugs || 0) > 0} />
            <Row label="Open Features" value={String(syncSystems?.feedback?.openFeatures ?? 0)} />
          </div>
        </div>
      </div>

      {/* Database Tables */}
      {dbStats && (
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Database className="w-4 h-4 text-gray-500" />
            <h3 className="text-sm font-semibold text-gray-800">Database Tables</h3>
            <span className="text-xs text-gray-400 ml-auto">{Object.keys(dbStats).length} tables</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-2">
            {Object.entries(dbStats)
              .filter(([, count]) => count >= 0)
              .sort(([, a], [, b]) => b - a)
              .map(([table, count]) => (
                <div key={table} className="flex items-center justify-between p-2.5 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                  <span className="text-xs text-gray-600 truncate mr-2">{table.replace(/_/g, ' ')}</span>
                  <span className="font-mono text-xs font-medium text-gray-900 flex-shrink-0">{count.toLocaleString()}</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, warn, error }: { label: string; value: string; warn?: boolean; error?: boolean }) {
  const color = error ? 'text-red-600 font-medium' : warn ? 'text-amber-600 font-medium' : 'text-gray-800';
  return (
    <div className="flex justify-between text-sm">
      <span className="text-gray-500">{label}</span>
      <span className={`font-mono text-xs ${color}`}>{value}</span>
    </div>
  );
}

function SyncCard({ icon: Icon, color, name, subtitle, rows }: {
  icon: React.ElementType; color: string; name: string; subtitle: string;
  rows: { label: string; value: string; isStatus?: boolean; warn?: boolean; error?: boolean }[];
}) {
  const bg = { violet: 'bg-violet-50', blue: 'bg-blue-50', amber: 'bg-amber-50', emerald: 'bg-emerald-50' }[color] || 'bg-gray-50';
  const ic = { violet: 'text-violet-600', blue: 'text-blue-600', amber: 'text-amber-600', emerald: 'text-emerald-600' }[color] || 'text-gray-600';
  return (
    <div className="card card-hover p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className={`w-9 h-9 rounded-lg ${bg} flex items-center justify-center`}><Icon className={`w-4 h-4 ${ic}`} /></div>
        <div><div className="text-sm font-semibold text-gray-800">{name}</div><div className="text-xs text-gray-500">{subtitle}</div></div>
      </div>
      <div className="space-y-1.5">
        {rows.map(r => (
          <div key={r.label} className="flex justify-between text-sm">
            <span className="text-gray-500">{r.label}</span>
            {r.isStatus ? (
              <div className="flex items-center gap-1.5">
                <div className={`w-1.5 h-1.5 rounded-full ${r.value === 'operational' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                <span className={`text-xs ${r.value === 'operational' ? 'text-emerald-600' : 'text-amber-600'}`}>{r.value}</span>
              </div>
            ) : (
              <span className={`font-mono text-xs ${r.error ? 'text-red-600 font-medium' : r.warn ? 'text-amber-600 font-medium' : 'text-gray-800'}`}>{r.value}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
