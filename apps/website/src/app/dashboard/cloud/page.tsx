'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  const hasEngine = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const loadStatus = useCallback(async () => {
    // Abort any in-flight status request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const data = await getCloudEngineStatus();
      if (controller.signal.aborted) return;
      if (data.ok) {
        setEngine(data.engine);
        hasEngine.current = true;
      } else {
        setEngine(null);
        hasEngine.current = false;
      }
    } catch {
      if (controller.signal.aborted) return;
      setEngine(null);
      hasEngine.current = false;
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  // Poll status — faster during transitional states, slower when stable
  useEffect(() => {
    if (!hasEngine.current && !engine) return;
    const isTransitional = engine && ['provisioning', 'starting', 'stopping'].includes(engine.status);
    const interval = isTransitional ? 5_000 : 30_000;
    const timer = setInterval(loadStatus, interval);
    return () => clearInterval(timer);
  }, [engine?.status, loadStatus]);

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

  // Show provisioning progress view
  if (engine.status === 'provisioning') {
    const PROVISION_STEPS = [
      { key: 'vm_creating',          label: 'Creating your machine',       detail: 'Spinning up a dedicated VM in the cloud' },
      { key: 'vm_created',           label: 'Machine created',             detail: 'Your VM is ready, configuring network...' },
      { key: 'waiting_ip',           label: 'Assigning network address',   detail: 'Getting a public IP for your machine' },
      { key: 'waiting_agent',        label: 'Starting AI agent',           detail: 'Installing packages and booting your agent' },
      { key: 'restoring_data',       label: 'Restoring your data',         detail: 'Syncing your memories, scripts, and files' },
      { key: 'syncing_agent',        label: 'Syncing AI knowledge',        detail: 'Loading your knowledge base and databases' },
      { key: 'syncing_integrations', label: 'Setting up integrations',     detail: 'Connecting your linked accounts' },
      { key: 'finalizing',           label: 'Almost ready',                detail: 'Final checks and bringing everything online' },
    ];

    const currentStep = engine.provisionStep || 'vm_creating';
    const currentIdx = PROVISION_STEPS.findIndex(s => s.key === currentStep);
    const progress = Math.max(0, Math.min(100, ((currentIdx + 1) / PROVISION_STEPS.length) * 100));

    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh]">
        <div className="w-full max-w-lg">
          <div className="text-center mb-8">
            <div className="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-blue-600 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-gray-900">Setting up your Cloud Engine</h1>
            <p className="text-gray-500 text-sm mt-1">This usually takes 1-3 minutes.</p>
          </div>

          {/* Progress bar */}
          <div className="mb-6">
            <div className="flex justify-between text-xs text-gray-400 font-medium mb-1.5">
              <span>Progress</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-blue-600 transition-all duration-700 ease-out"
                style={{ width: `${Math.max(5, progress)}%` }}
              />
            </div>
          </div>

          {/* Steps */}
          <div className="space-y-1.5">
            {PROVISION_STEPS.map((step, idx) => {
              const isActive = idx === currentIdx;
              const isDone = idx < currentIdx;
              const isPending = idx > currentIdx;

              return (
                <div
                  key={step.key}
                  className={`flex items-center gap-3 px-3.5 py-2.5 rounded-lg transition-all ${
                    isActive ? 'bg-blue-50 ring-1 ring-blue-200' : ''
                  } ${isDone ? 'opacity-50' : ''} ${isPending ? 'opacity-25' : ''}`}
                >
                  <div className="shrink-0 w-4 h-4 flex items-center justify-center">
                    {isDone ? (
                      <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : isActive ? (
                      <svg className="w-4 h-4 text-blue-600 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    ) : (
                      <div className="w-2 h-2 rounded-full bg-gray-300" />
                    )}
                  </div>
                  <div>
                    <div className={`text-xs font-semibold ${isActive ? 'text-blue-700' : 'text-gray-700'}`}>
                      {step.label}
                    </div>
                    {isActive && (
                      <div className="text-[11px] text-gray-500 mt-0.5">{step.detail}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-6 p-3 rounded-lg bg-gray-50 text-center">
            <p className="text-[11px] text-gray-400">
              Your engine runs 24/7 once set up. Credits are only used while active.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Show "still booting" view when engine is running but agent hasn't come online yet
  if (engine.status === 'running' && (engine.healthStatus === 'unreachable' || engine.healthStatus === 'unknown')) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh]">
        <div className="w-full max-w-md text-center">
          <div className="w-14 h-14 rounded-2xl bg-amber-50 flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-amber-500 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900">Your VM is still booting</h1>
          <p className="text-gray-500 text-sm mt-2">
            The machine is running but the AI agent is still installing packages and starting up.
            This can take a few minutes on smaller plans.
          </p>
          <div className="mt-6 p-4 rounded-xl bg-gray-50 space-y-2 text-left">
            <div className="flex justify-between text-xs">
              <span className="text-gray-400">Status</span>
              <span className="font-semibold text-amber-600">Agent starting...</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-gray-400">VM</span>
              <span className="font-semibold text-green-600">Running</span>
            </div>
            {engine.externalIp && (
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">IP Address</span>
                <span className="font-mono text-gray-700">{engine.externalIp}</span>
              </div>
            )}
          </div>
          <p className="text-[11px] text-gray-400 mt-4">
            This page will refresh automatically once the agent comes online.
          </p>
        </div>
      </div>
    );
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
      <div className="flex gap-1 mb-6 p-1 bg-gray-100 rounded-lg w-fit">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3.5 py-1.5 text-[13px] font-medium rounded-md transition-all ${
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
