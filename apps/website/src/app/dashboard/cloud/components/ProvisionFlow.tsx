'use client';

import React, { useState } from 'react';
import { provisionCloudEngine } from '@/lib/cloudApi';

/* ─── Credit-based plans ─────────────────────────────────────────── */
const PLANS = [
  {
    id: 'starter', name: 'Starter', emoji: '🌱',
    tagline: 'Perfect for trying things out',
    vcpus: 1, ram: 2, disk: 10,
    credits: 5,
    features: ['1 CPU core', '2 GB memory', '10 GB storage'],
  },
  {
    id: 'basic', name: 'Essential', emoji: '⚡',
    tagline: 'For everyday automation',
    vcpus: 2, ram: 4, disk: 20,
    credits: 10,
    features: ['2 CPU cores', '4 GB memory', '20 GB storage'],
  },
  {
    id: 'pro', name: 'Pro', emoji: '🚀', popular: true,
    tagline: 'Best for most users',
    vcpus: 4, ram: 8, disk: 50,
    credits: 20,
    features: ['4 CPU cores', '8 GB memory', '50 GB storage'],
  },
  {
    id: 'power', name: 'Power', emoji: '🔥',
    tagline: 'Maximum performance',
    vcpus: 8, ram: 16, disk: 100,
    credits: 40,
    features: ['8 CPU cores', '16 GB memory', '100 GB storage'],
  },
];

interface ProvisionFlowProps {
  onProvisioned: () => void;
}

export function ProvisionFlow({ onProvisioned }: ProvisionFlowProps) {
  const [selectedPlan, setSelectedPlan] = useState('basic');
  const [customMode, setCustomMode] = useState(false);
  const [customCpu, setCustomCpu] = useState(2);
  const [customRam, setCustomRam] = useState(4);
  const [customDisk, setCustomDisk] = useState(20);
  const [provisioning, setProvisioning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const plan = PLANS.find(p => p.id === selectedPlan)!;
  const cpuCredits = customMode ? customCpu * 5 : plan.credits;
  const diskCredits = Math.ceil((customMode ? customDisk : plan.disk) * 0.5);
  const totalCredits = cpuCredits + diskCredits;

  const handleProvision = async () => {
    setProvisioning(true);
    setError(null);
    try {
      const disk = customMode ? customDisk : plan.disk;
      const data = customMode
        ? await provisionCloudEngine('custom', disk, customCpu, customRam)
        : await provisionCloudEngine(plan.id, disk);
      if (data.ok) {
        onProvisioned();
      } else {
        setError(data.error || 'Something went wrong. Please try again.');
      }
    } catch (e: any) {
      setError(e.message || 'Unable to connect. Check your internet and try again.');
    } finally {
      setProvisioning(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto py-12">
      {/* Hero */}
      <div className="text-center mb-10">
        <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Create Your Cloud Engine</h1>
        <p className="text-gray-500 text-sm mt-2">
          Your personal AI computer in the cloud — always on, always ready.
        </p>
      </div>

      {/* Feature highlights */}
      <div className="grid grid-cols-3 gap-3 mb-10">
        {[
          { icon: '⚡', title: 'Always Running', desc: 'Works even when your computer is off' },
          { icon: '🔒', title: 'Secure & Private', desc: 'Your own isolated environment' },
          { icon: '✨', title: 'Instant Setup', desc: 'Ready in under 60 seconds' },
        ].map((f, i) => (
          <div key={i} className="text-center p-4 rounded-xl bg-gray-50 border border-gray-100">
            <div className="text-2xl mb-1">{f.icon}</div>
            <div className="text-sm font-semibold text-gray-900">{f.title}</div>
            <div className="text-xs text-gray-500 mt-0.5">{f.desc}</div>
          </div>
        ))}
      </div>

      {/* Plan Selection */}
      {!customMode && (
        <div className="space-y-3 mb-8">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">Choose a plan</h2>
            <button onClick={() => setCustomMode(true)} className="text-xs text-blue-600 font-semibold hover:underline">
              Build custom →
            </button>
          </div>
          <div className="grid grid-cols-4 gap-3">
            {PLANS.map(p => (
              <button
                key={p.id}
                onClick={() => setSelectedPlan(p.id)}
                className={`relative p-4 rounded-2xl border-2 text-left transition-all ${
                  selectedPlan === p.id
                    ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                {p.popular && (
                  <span className="absolute -top-2 right-3 bg-blue-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                    Best Value
                  </span>
                )}
                <div className="text-xl mb-1">{p.emoji}</div>
                <div className="font-semibold text-gray-900">{p.name}</div>
                <div className="text-[11px] text-gray-500 mt-0.5">{p.tagline}</div>
                <div className="mt-3 flex items-baseline gap-1">
                  <span className="text-lg font-bold text-blue-600">{p.credits}</span>
                  <span className="text-[10px] text-gray-400 font-medium">credits/hr</span>
                </div>
                <div className="mt-2 space-y-0.5">
                  {p.features.map((f, i) => (
                    <div key={i} className="text-[10px] text-gray-500 flex items-center gap-1">
                      <span className="text-green-500">✓</span> {f}
                    </div>
                  ))}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Custom Builder */}
      {customMode && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-900">Custom Configuration</h2>
            <button onClick={() => setCustomMode(false)} className="text-xs text-blue-600 font-semibold hover:underline">
              ← Back to plans
            </button>
          </div>
          <div className="bg-gray-50 rounded-2xl border border-gray-200 p-6 space-y-5">
            {/* CPU */}
            <div>
              <div className="flex justify-between mb-2">
                <label className="text-sm font-medium text-gray-700">CPU Cores</label>
                <span className="text-sm font-bold text-blue-600">{customCpu} cores</span>
              </div>
              <input type="range" min={1} max={16} step={1} value={customCpu} onChange={e => setCustomCpu(Number(e.target.value))} className="w-full accent-blue-600" />
              <div className="flex justify-between text-[10px] text-gray-400 mt-1"><span>1 core</span><span>16 cores</span></div>
            </div>
            {/* RAM */}
            <div>
              <div className="flex justify-between mb-2">
                <label className="text-sm font-medium text-gray-700">Memory (RAM)</label>
                <span className="text-sm font-bold text-blue-600">{customRam} GB</span>
              </div>
              <input type="range" min={1} max={64} step={1} value={customRam} onChange={e => setCustomRam(Number(e.target.value))} className="w-full accent-blue-600" />
              <div className="flex justify-between text-[10px] text-gray-400 mt-1"><span>1 GB</span><span>64 GB</span></div>
            </div>
            {/* Disk */}
            <div>
              <div className="flex justify-between mb-2">
                <label className="text-sm font-medium text-gray-700">Storage</label>
                <span className="text-sm font-bold text-blue-600">{customDisk} GB</span>
              </div>
              <input type="range" min={10} max={500} step={10} value={customDisk} onChange={e => setCustomDisk(Number(e.target.value))} className="w-full accent-blue-600" />
              <div className="flex justify-between text-[10px] text-gray-400 mt-1"><span>10 GB</span><span>500 GB</span></div>
            </div>
          </div>
        </div>
      )}

      {/* Credit Summary */}
      <div className="bg-gray-50 rounded-2xl border border-gray-200 p-5 mb-8">
        <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-3">Credit Usage</h3>
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">Compute</span>
          <span className="font-medium text-gray-900">{cpuCredits} credits/hr</span>
        </div>
        <div className="flex justify-between text-sm mt-1">
          <span className="text-gray-600">Storage ({customMode ? customDisk : plan.disk} GB)</span>
          <span className="font-medium text-gray-900">{diskCredits} credits/hr</span>
        </div>
        <div className="border-t border-gray-200 mt-3 pt-3 flex justify-between text-sm font-bold">
          <span className="text-gray-900">Total</span>
          <span className="text-blue-600">{totalCredits} credits/hr</span>
        </div>
        <div className="text-[10px] text-gray-400 mt-2 text-right">
          ~{totalCredits * 24} credits/day • ~{(totalCredits * 24 * 30 / 1000).toFixed(1)}k credits/month
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Provision Button */}
      <button
        onClick={handleProvision}
        disabled={provisioning}
        className="w-full py-3.5 bg-blue-600 text-white text-sm font-semibold rounded-2xl hover:bg-blue-700 disabled:opacity-50 transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20"
      >
        {provisioning ? (
          <>
            <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-25" />
              <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
            Setting up your cloud engine...
          </>
        ) : (
          '✨ Create My Cloud Engine'
        )}
      </button>
      <p className="text-center text-xs text-gray-400 mt-3">
        Credits are only used while your engine is running. Stop or delete anytime.
      </p>
    </div>
  );
}
