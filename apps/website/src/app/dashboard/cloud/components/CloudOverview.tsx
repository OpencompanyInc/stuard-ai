'use client';

import React, { useState, useEffect } from 'react';
import { startCloudEngine, stopCloudEngine, deleteCloudEngine } from '@/lib/cloudApi';

interface CloudOverviewProps {
  engine: any;
  onRefresh: () => void;
}

const STATUS_BANNERS: Record<string, { message: string; detail: string; color: string; dotColor: string }> = {
  provisioning: {
    message: 'Setting up your cloud engine...',
    detail: 'Creating VM, installing dependencies, and syncing your data. This usually takes 1\u20132 minutes.',
    color: 'bg-blue-50 border-blue-200 text-blue-800',
    dotColor: 'bg-blue-500',
  },
  starting: {
    message: 'Starting your engine...',
    detail: 'Booting VM and restoring your data from cloud storage.',
    color: 'bg-blue-50 border-blue-200 text-blue-800',
    dotColor: 'bg-blue-500',
  },
  stopping: {
    message: 'Stopping your engine...',
    detail: 'Syncing data to cloud storage before shutting down.',
    color: 'bg-amber-50 border-amber-200 text-amber-800',
    dotColor: 'bg-amber-500',
  },
};

export function CloudOverview({ engine, onRefresh }: CloudOverviewProps) {
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const isTransitional = ['provisioning', 'starting', 'stopping'].includes(engine.status);

  // Auto-refresh more frequently during transitional states
  useEffect(() => {
    if (!isTransitional) return;
    const timer = setInterval(onRefresh, 5000);
    return () => clearInterval(timer);
  }, [isTransitional, onRefresh]);

  const handleAction = async (action: 'start' | 'stop' | 'delete') => {
    setActionLoading(action);
    try {
      if (action === 'start') await startCloudEngine();
      else if (action === 'stop') await stopCloudEngine();
      else if (action === 'delete') {
        if (!confirm('Are you sure? This will delete your VM and all storage.')) {
          setActionLoading(null);
          return;
        }
        await deleteCloudEngine();
      }
      onRefresh();
    } catch (e) {
      console.error(`Failed to ${action}:`, e);
    } finally {
      setActionLoading(null);
    }
  };

  const uptime = engine.startedAt
    ? Math.round((Date.now() - new Date(engine.startedAt).getTime()) / 60000)
    : 0;

  const banner = STATUS_BANNERS[engine.status];

  return (
    <div className="space-y-6">
      {/* Status Banner for transitional states */}
      {banner && (
        <div className={`p-4 rounded-2xl border ${banner.color} flex items-start gap-3`}>
          <div className="flex-shrink-0 mt-0.5">
            <span className={`block w-2.5 h-2.5 rounded-full ${banner.dotColor} animate-pulse`} />
          </div>
          <div>
            <p className="text-sm font-semibold">{banner.message}</p>
            <p className="text-xs mt-0.5 opacity-80">{banner.detail}</p>
          </div>
          <svg className="w-5 h-5 animate-spin ml-auto flex-shrink-0 opacity-60" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-25" />
            <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        </div>
      )}

      {/* Status Card */}
      <div className="p-6 bg-white rounded-2xl border border-gray-200 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">VM Status</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <dt className="text-xs text-gray-500 uppercase tracking-wider">Status</dt>
            <dd className="mt-1 text-sm font-semibold text-gray-900 capitalize">{engine.status}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500 uppercase tracking-wider">Machine Type</dt>
            <dd className="mt-1 text-sm font-semibold text-gray-900">{engine.machineType}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500 uppercase tracking-wider">Disk Size</dt>
            <dd className="mt-1 text-sm font-semibold text-gray-900">{engine.diskSizeGb} GB</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500 uppercase tracking-wider">Uptime</dt>
            <dd className="mt-1 text-sm font-semibold text-gray-900">
              {engine.status === 'running' ? `${uptime}m` : '—'}
            </dd>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="p-6 bg-white rounded-2xl border border-gray-200 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h3>
        <div className="flex flex-wrap gap-3">
          {engine.status === 'stopped' && (
            <button
              onClick={() => handleAction('start')}
              disabled={!!actionLoading}
              className="px-6 py-2.5 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 disabled:opacity-50 transition-all shadow-sm"
            >
              {actionLoading === 'start' ? 'Starting...' : 'Start Engine'}
            </button>
          )}
          {engine.status === 'running' && (
            <button
              onClick={() => handleAction('stop')}
              disabled={!!actionLoading}
              className="px-6 py-2.5 bg-orange-500 text-white rounded-xl text-sm font-semibold hover:bg-orange-600 disabled:opacity-50 transition-all shadow-sm"
            >
              {actionLoading === 'stop' ? 'Stopping...' : 'Stop Engine'}
            </button>
          )}
          {isTransitional && (
            <span className="px-6 py-2.5 text-sm text-gray-400 italic">
              Please wait...
            </span>
          )}
          <button
            onClick={() => handleAction('delete')}
            disabled={!!actionLoading || isTransitional}
            className="px-6 py-2.5 bg-red-50 text-red-600 rounded-xl text-sm font-semibold hover:bg-red-100 disabled:opacity-50 transition-all border border-red-200"
          >
            {actionLoading === 'delete' ? 'Deleting...' : 'Delete Engine'}
          </button>
        </div>
      </div>

      {/* Resource Summary */}
      <div className="p-6 bg-white rounded-2xl border border-gray-200 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Details</h3>
        <dl className="space-y-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-gray-500">Instance Name</dt>
            <dd className="text-gray-900 font-mono text-xs">{engine.instanceName}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">Zone</dt>
            <dd className="text-gray-900">{engine.zone}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">Created</dt>
            <dd className="text-gray-900">{new Date(engine.createdAt).toLocaleDateString()}</dd>
          </div>
          {engine.startedAt && (
            <div className="flex justify-between">
              <dt className="text-gray-500">Last Started</dt>
              <dd className="text-gray-900">{new Date(engine.startedAt).toLocaleString()}</dd>
            </div>
          )}
          {engine.stoppedAt && (
            <div className="flex justify-between">
              <dt className="text-gray-500">Last Stopped</dt>
              <dd className="text-gray-900">{new Date(engine.stoppedAt).toLocaleString()}</dd>
            </div>
          )}
        </dl>
      </div>
    </div>
  );
}
