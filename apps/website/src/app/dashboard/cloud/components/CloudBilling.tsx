'use client';

import React, { useState, useEffect } from 'react';
import { getComputeUsage } from '@/lib/cloudApi';

interface BillingData {
  total_credits_used: number;
  compute_credits: number;
  storage_credits: number;
  current_tier?: string;
  engine_status?: string;
  hours_this_month?: number;
}

export function CloudBilling() {
  const [billing, setBilling] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const data = await getComputeUsage();
      if (data.ok) setBilling(data);
    } catch (e) {
      console.error('Failed to load billing:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading) {
    return <div className="text-center text-gray-500 py-8">Loading billing info...</div>;
  }

  if (!billing) {
    return (
      <div className="text-center py-12 bg-gray-50 rounded-2xl border border-gray-200">
        <p className="text-gray-500 text-sm">No billing data available.</p>
        <p className="text-gray-400 text-xs mt-1">Provision a VM to start tracking usage.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Usage Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <BillingCard
          title="Total Credits Used"
          value={billing.total_credits_used?.toFixed(2) || '0.00'}
          subtitle="credits this billing period"
          color="blue"
        />
        <BillingCard
          title="Compute"
          value={billing.compute_credits?.toFixed(2) || '0.00'}
          subtitle="credits for VM runtime"
          color="purple"
        />
        <BillingCard
          title="Storage"
          value={billing.storage_credits?.toFixed(2) || '0.00'}
          subtitle="credits for disk + snapshots"
          color="amber"
        />
      </div>

      {/* Tier Info */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Current Plan</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-gray-500 text-xs">Tier</div>
            <div className="font-medium text-gray-900 capitalize">{billing.current_tier || '—'}</div>
          </div>
          <div>
            <div className="text-gray-500 text-xs">Status</div>
            <div className="font-medium text-gray-900 capitalize">{billing.engine_status || '—'}</div>
          </div>
          <div>
            <div className="text-gray-500 text-xs">Hours This Month</div>
            <div className="font-medium text-gray-900">{billing.hours_this_month?.toFixed(1) || '0'} hrs</div>
          </div>
          <div>
            <div className="text-gray-500 text-xs">Est. Monthly Cost</div>
            <div className="font-medium text-gray-900">
              {billing.total_credits_used ? `${billing.total_credits_used.toFixed(0)} credits` : '—'}
            </div>
          </div>
        </div>
      </div>

      {/* Pricing Reference */}
      <div className="bg-gray-50 rounded-2xl border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Pricing Reference</h3>
        <div className="grid grid-cols-3 gap-4">
          {[
            { tier: 'Basic', spec: '2 vCPU / 8 GB', rate: '$0.067/hr' },
            { tier: 'Pro', spec: '4 vCPU / 16 GB', rate: '$0.134/hr' },
            { tier: 'Power', spec: '8 vCPU / 32 GB', rate: '$0.268/hr' },
          ].map(t => (
            <div key={t.tier} className={`rounded-xl p-3 border ${
              billing.current_tier === t.tier.toLowerCase() ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-white'
            }`}>
              <div className="font-semibold text-sm text-gray-900">{t.tier}</div>
              <div className="text-xs text-gray-500 mt-0.5">{t.spec}</div>
              <div className="text-xs font-mono text-gray-700 mt-1">{t.rate}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function BillingCard({
  title, value, subtitle, color,
}: {
  title: string; value: string; subtitle: string; color: string;
}) {
  const colors: Record<string, string> = {
    blue: 'border-blue-200 bg-blue-50',
    purple: 'border-purple-200 bg-purple-50',
    amber: 'border-amber-200 bg-amber-50',
  };
  return (
    <div className={`rounded-2xl border p-5 ${colors[color] || 'border-gray-200 bg-gray-50'}`}>
      <div className="text-xs text-gray-500 font-medium">{title}</div>
      <div className="text-2xl font-bold text-gray-900 mt-1">{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{subtitle}</div>
    </div>
  );
}
