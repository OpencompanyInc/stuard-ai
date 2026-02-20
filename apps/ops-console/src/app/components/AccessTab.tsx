'use client';

import { useState } from 'react';
import { Search, UserPlus, Trash2, Shield, Users, RefreshCw } from 'lucide-react';
import { BetaUser, WaitlistEntry, formatDate } from '../lib/api';

export default function AccessTab({ betaUsers, waitlistEntries, waitlistTotal, onRefresh, onUpsertBeta, onDeleteBeta, onPromoteWaitlist, loading }: {
  betaUsers: BetaUser[];
  waitlistEntries: WaitlistEntry[];
  waitlistTotal: number;
  onRefresh: () => void;
  onUpsertBeta: (email: string, accessLevel: string, notes: string) => Promise<void>;
  onDeleteBeta: (email: string) => Promise<void>;
  onPromoteWaitlist: (email: string, accessLevel: string) => Promise<void>;
  loading: boolean;
}) {
  const [betaEmail, setBetaEmail] = useState('');
  const [betaAccessLevel, setBetaAccessLevel] = useState<string>('beta');
  const [betaNotes, setBetaNotes] = useState('');
  const [waitlistQuery, setWaitlistQuery] = useState('');
  const [localWaitlist, setLocalWaitlist] = useState<WaitlistEntry[]>(waitlistEntries);

  // Keep local waitlist in sync
  if (waitlistEntries !== localWaitlist && waitlistEntries.length > 0) {
    setLocalWaitlist(waitlistEntries);
  }

  const handleAddBeta = async () => {
    const email = betaEmail.trim().toLowerCase();
    if (!email) return;
    await onUpsertBeta(email, betaAccessLevel, betaNotes);
    setBetaEmail('');
    setBetaNotes('');
  };

  const filteredWaitlist = waitlistQuery.trim()
    ? localWaitlist.filter(e =>
        e.email?.toLowerCase().includes(waitlistQuery.toLowerCase()) ||
        e.name?.toLowerCase().includes(waitlistQuery.toLowerCase()) ||
        e.company?.toLowerCase().includes(waitlistQuery.toLowerCase()))
    : localWaitlist;

  const accessCounts = { beta: 0, staging: 0, all: 0 };
  for (const u of betaUsers) {
    const level = u.access_level as keyof typeof accessCounts;
    if (level in accessCounts) accessCounts[level]++;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Access Control</h2>
          <p className="text-sm text-gray-500">Manage beta users and waitlist</p>
        </div>
        <button onClick={onRefresh} className="btn-secondary px-4 py-2 text-sm flex items-center gap-2">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-4">
          <div className="text-xs text-gray-500 mb-1">Beta Users</div>
          <div className="text-xl font-bold text-gray-900">{accessCounts.beta}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-gray-500 mb-1">Staging Users</div>
          <div className="text-xl font-bold text-gray-900">{accessCounts.staging}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-gray-500 mb-1">Full Access</div>
          <div className="text-xl font-bold text-gray-900">{accessCounts.all}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-gray-500 mb-1">Waitlist</div>
          <div className="text-xl font-bold text-gray-900">{waitlistTotal}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Beta Users */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Shield className="w-4 h-4 text-indigo-600" />
            <h3 className="text-sm font-semibold text-gray-800">Beta Users</h3>
            <span className="text-xs text-gray-400 ml-auto">{betaUsers.length} users</span>
          </div>

          {/* Add form */}
          <div className="space-y-2 mb-4 p-3 bg-gray-50 rounded-lg">
            <div className="grid grid-cols-3 gap-2">
              <input type="email" className="input-field col-span-1" placeholder="email@domain.com" value={betaEmail} onChange={e => setBetaEmail(e.target.value)} />
              <select className="input-field col-span-1" value={betaAccessLevel} onChange={e => setBetaAccessLevel(e.target.value)}>
                <option value="beta">beta</option>
                <option value="staging">staging</option>
                <option value="all">all</option>
              </select>
              <button onClick={handleAddBeta} disabled={loading || !betaEmail.trim()} className="btn-primary col-span-1 flex items-center justify-center gap-1.5 disabled:opacity-40">
                <UserPlus className="w-3.5 h-3.5" /> Add
              </button>
            </div>
            <input type="text" className="input-field" placeholder="Notes (optional)" value={betaNotes} onChange={e => setBetaNotes(e.target.value)} />
          </div>

          {/* Table */}
          <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="text-gray-500 border-b border-gray-100">
                  <th className="py-2 text-left font-medium">Email</th>
                  <th className="py-2 text-left font-medium">Access</th>
                  <th className="py-2 text-left font-medium">Invited By</th>
                  <th className="py-2 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {betaUsers.map(u => (
                  <tr key={u.id || u.email} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="py-2 font-mono text-gray-800">{u.email}</td>
                    <td className="py-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        u.access_level === 'all' ? 'bg-emerald-50 text-emerald-700' :
                        u.access_level === 'staging' ? 'bg-blue-50 text-blue-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>{u.access_level}</span>
                    </td>
                    <td className="py-2 text-gray-500">{u.invited_by || '—'}</td>
                    <td className="py-2 text-right">
                      <button onClick={() => onDeleteBeta(u.email)} disabled={loading}
                        className="text-gray-400 hover:text-red-500 transition-colors disabled:opacity-40">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
                {betaUsers.length === 0 && <tr><td colSpan={4} className="py-8 text-center text-gray-400">No beta users</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        {/* Waitlist */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-4 h-4 text-pink-600" />
            <h3 className="text-sm font-semibold text-gray-800">Waitlist</h3>
            <span className="text-xs text-gray-400 ml-auto">{waitlistTotal} signups</span>
          </div>

          {/* Search */}
          <div className="relative mb-4">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input type="text" className="input-field pl-9" placeholder="Filter by email, name, company..."
              value={waitlistQuery} onChange={e => setWaitlistQuery(e.target.value)} />
          </div>

          {/* Table */}
          <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="text-gray-500 border-b border-gray-100">
                  <th className="py-2 text-left font-medium">Email</th>
                  <th className="py-2 text-left font-medium">Name</th>
                  <th className="py-2 text-left font-medium">Company</th>
                  <th className="py-2 text-left font-medium">Date</th>
                  <th className="py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredWaitlist.slice(0, 50).map(e => (
                  <tr key={e.id || e.email} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="py-2 font-mono text-gray-800">{e.email}</td>
                    <td className="py-2 text-gray-600">{e.name || '—'}</td>
                    <td className="py-2 text-gray-600">{e.company || '—'}</td>
                    <td className="py-2 text-gray-500">{formatDate(e.created_at)}</td>
                    <td className="py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => onPromoteWaitlist(e.email, 'beta')} disabled={loading}
                          className="btn-primary px-2 py-1 text-[10px] disabled:opacity-40">Beta</button>
                        <button onClick={() => onPromoteWaitlist(e.email, 'staging')} disabled={loading}
                          className="btn-secondary px-2 py-1 text-[10px] disabled:opacity-40">Staging</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredWaitlist.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-gray-400">No waitlist entries</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
