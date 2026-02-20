'use client';

import { useState } from 'react';
import { Search, ChevronLeft, ChevronRight, Users, Crown, Zap } from 'lucide-react';
import { UserEntry, formatNumber, formatCurrency, formatTimeAgo } from '../lib/api';

const PLAN_COLORS: Record<string, string> = {
  free: 'bg-gray-100 text-gray-600',
  pro: 'bg-blue-50 text-blue-700',
  team: 'bg-purple-50 text-purple-700',
  enterprise: 'bg-amber-50 text-amber-700',
};

export default function UsersTab({ users, total, planBreakdown, query, onQueryChange, onSearch, onPageChange, page, pageSize }: {
  users: UserEntry[];
  total: number;
  planBreakdown: Record<string, number>;
  query: string;
  onQueryChange: (q: string) => void;
  onSearch: () => void;
  onPageChange: (p: number) => void;
  page: number;
  pageSize: number;
}) {
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Users</h2>
          <p className="text-sm text-gray-500">{total} total users across all plans</p>
        </div>
      </div>

      {/* Plan Breakdown */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Object.entries(planBreakdown).map(([plan, count]) => (
          <div key={plan} className="card p-4 flex items-center gap-3">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${plan === 'free' ? 'bg-gray-100' : plan === 'pro' ? 'bg-blue-50' : 'bg-purple-50'}`}>
              {plan === 'free' ? <Users className="w-4 h-4 text-gray-500" /> : <Crown className="w-4 h-4 text-blue-600" />}
            </div>
            <div>
              <div className="text-lg font-bold text-gray-900">{count}</div>
              <div className="text-xs text-gray-500 capitalize">{plan}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="flex items-center gap-3">
        <div className="flex-1 relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            className="input-field pl-9"
            placeholder="Search by email, plan, or user ID..."
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onSearch(); }}
          />
        </div>
        <button onClick={onSearch} className="btn-primary px-4 py-2">Search</button>
      </div>

      {/* User Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Conversations</th>
                <th className="px-4 py-3 text-right">Tokens (30d)</th>
                <th className="px-4 py-3 text-right">Cost (30d)</th>
                <th className="px-4 py-3 text-right">Requests (30d)</th>
                <th className="px-4 py-3">Last Sign In</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-gray-100 hover:bg-gray-50/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-800 text-xs">{u.email || '—'}</div>
                    <div className="text-[10px] font-mono text-gray-400">{u.id.slice(0, 12)}...</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-md ${PLAN_COLORS[u.plan] || 'bg-gray-100 text-gray-600'}`}>{u.plan}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs ${u.status === 'active' ? 'text-emerald-600' : 'text-gray-400'}`}>{u.status}</span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-gray-700">{u.conversations}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-gray-700">{formatNumber(u.tokensLast30d)}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-gray-700">{formatCurrency(u.costLast30d)}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-gray-700">{u.requestsLast30d}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{formatTimeAgo(u.lastSignIn)}</td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400">No users found</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-t border-gray-100">
            <div className="text-xs text-gray-500">
              Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} of {total}
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => onPageChange(page - 1)} disabled={page === 0}
                className="btn-secondary px-2 py-1 text-xs disabled:opacity-30"><ChevronLeft className="w-3.5 h-3.5" /></button>
              <span className="text-xs text-gray-600 px-2">{page + 1} / {totalPages}</span>
              <button onClick={() => onPageChange(page + 1)} disabled={page >= totalPages - 1}
                className="btn-secondary px-2 py-1 text-xs disabled:opacity-30"><ChevronRight className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
