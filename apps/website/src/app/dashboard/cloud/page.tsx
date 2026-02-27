'use client';

import React, { useState, useEffect } from 'react';
import { getCloudEngineStatus } from '@/lib/cloudApi';
import { CloudOverview } from './components/CloudOverview';
import { CloudTerminal } from './components/CloudTerminal';
import { CloudFileBrowser } from './components/CloudFileBrowser';
import { CloudMonitoring } from './components/CloudMonitoring';
import { CloudSnapshots } from './components/CloudSnapshots';
import { CloudBilling } from './components/CloudBilling';
import { ProvisionFlow } from './components/ProvisionFlow';

type CloudTab = 'overview' | 'terminal' | 'files' | 'monitoring' | 'snapshots' | 'billing';

export default function CloudDashboardPage() {
  const [activeTab, setActiveTab] = useState<CloudTab>('overview');
  const [engine, setEngine] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const loadStatus = async () => {
    try {
      const data = await getCloudEngineStatus();
      if (data.ok) setEngine(data.engine);
      else setEngine(null);
    } catch {
      setEngine(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadStatus(); }, []);

  // Poll status every 30s when engine exists
  useEffect(() => {
    if (!engine) return;
    const timer = setInterval(loadStatus, 30_000);
    return () => clearInterval(timer);
  }, [engine]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading cloud engine...</div>
      </div>
    );
  }

  // Show provision flow if no engine
  if (!engine) {
    return <ProvisionFlow onProvisioned={loadStatus} />;
  }

  const tabs: { id: CloudTab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'terminal', label: 'Terminal' },
    { id: 'files', label: 'Files' },
    { id: 'monitoring', label: 'Monitoring' },
    { id: 'snapshots', label: 'Snapshots' },
    { id: 'billing', label: 'Billing' },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Cloud Engine</h1>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
            engine.status === 'running' ? 'bg-green-100 text-green-800' :
            engine.status === 'stopped' ? 'bg-gray-100 text-gray-600' :
            'bg-yellow-100 text-yellow-800'
          }`}>
            <span className={`w-2 h-2 rounded-full ${
              engine.status === 'running' ? 'bg-green-500' :
              engine.status === 'stopped' ? 'bg-gray-400' :
              'bg-yellow-500 animate-pulse'
            }`} />
            {engine.status}
          </span>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 mb-6 p-1 bg-gray-100 rounded-xl w-fit">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
              activeTab === tab.id
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="mt-4">
        {activeTab === 'overview' && <CloudOverview engine={engine} onRefresh={loadStatus} />}
        {activeTab === 'terminal' && <CloudTerminal engine={engine} />}
        {activeTab === 'files' && <CloudFileBrowser engine={engine} />}
        {activeTab === 'monitoring' && <CloudMonitoring engine={engine} />}
        {activeTab === 'snapshots' && <CloudSnapshots />}
        {activeTab === 'billing' && <CloudBilling />}
      </div>
    </div>
  );
}
