'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getCloudEngineStatus } from '@/lib/cloudApi';
import { useAuthContext } from '@/components/providers/AuthProvider';
import { CloudOverview } from './components/CloudOverview';
import { CloudIDELayout } from './components/CloudIDELayout';

export default function CloudDashboardPage() {
  const { user, loading: authLoading } = useAuthContext();
  const [engine, setEngine] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasEngine = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const hasRenderableEngine = Boolean(engine);
  const engineStatus = engine?.status;

  const loadStatus = useCallback(async () => {
    if (authLoading) return;
    if (!user) {
      setEngine(null);
      setError('Sign in to load your cloud engine.');
      setLoading(false);
      hasEngine.current = false;
      return;
    }

    // Abort any in-flight status request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const data = await getCloudEngineStatus({ signal: controller.signal, timeoutMs: 30_000 });
      if (controller.signal.aborted) return;
      if (data.ok) {
        setEngine(data.engine);
        hasEngine.current = Boolean(data.engine);
        setError(null);
      } else if (!controller.signal.aborted) {
        setError(data.message || data.error || 'Could not load your cloud engine.');
      }
    } catch {
      if (controller.signal.aborted) return;
      setError('Unable to connect to Stuard Cloud right now.');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [authLoading, user]);

  useEffect(() => {
    if (authLoading) return;
    setLoading(true);
    void loadStatus();
  }, [authLoading, loadStatus]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  // Poll status — faster during transitional states, slower when stable
  useEffect(() => {
    if (authLoading || !user) return;
    if (!hasEngine.current && !hasRenderableEngine) return;
    const isTransitional = Boolean(engineStatus && ['provisioning', 'starting', 'stopping'].includes(engineStatus));
    const interval = isTransitional ? 5_000 : 30_000;
    const timer = setInterval(loadStatus, interval);
    return () => clearInterval(timer);
  }, [authLoading, user, hasRenderableEngine, engineStatus, loadStatus]);

  if ((authLoading || loading) && !engine) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading cloud engine...</div>
      </div>
    );
  }

  if (!engine && error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center gap-4">
        <div>
          <div className="text-sm font-semibold text-gray-900">Unable to load your cloud engine</div>
          <div className="text-sm text-gray-500 mt-1">{error}</div>
        </div>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            void loadStatus();
          }}
          className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  // No engine — deployment is desktop-only
  if (!engine) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto">
          <svg className="w-7 h-7 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25A2.25 2.25 0 015.25 3h13.5A2.25 2.25 0 0121 5.25z" />
          </svg>
        </div>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">No Cloud Engine Found</h2>
          <p className="text-sm text-gray-500 mt-1 max-w-sm">
            Deploying a Cloud Engine is only available in the Stuard desktop app. Once deployed, you can interact with it here.
          </p>
        </div>
        <a
          href="/download"
          className="inline-flex items-center px-4 py-2 text-[13px] font-medium text-white bg-gray-900 rounded-lg hover:bg-black transition-colors"
        >
          Download Desktop App
        </a>
      </div>
    );
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

  // When engine is running + healthy → full-bleed IDE (breaks out of max-w wrapper)
  if (engine.status === 'running') {
    return (
      <div className="fixed inset-0 lg:left-56" style={{ top: '2.5rem' }}>
        <CloudIDELayout engine={engine} onRefresh={loadStatus} />
      </div>
    );
  }

  // Stopped / error states → simplified overview with start/delete controls
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Cloud Engine</h1>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
            engine.status === 'stopped' ? 'bg-gray-100 text-gray-600' :
            'bg-yellow-100 text-yellow-800'
          }`}>
            <span className={`w-2 h-2 rounded-full ${
              engine.status === 'stopped' ? 'bg-gray-400' :
              'bg-yellow-500 animate-pulse'
            }`} />
            {engine.status}
          </span>
        </div>
      </div>
      <CloudOverview engine={engine} onRefresh={loadStatus} />
    </div>
  );
}
