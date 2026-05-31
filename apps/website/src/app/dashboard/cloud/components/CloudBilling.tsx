'use client';

import React, { useState, useEffect } from 'react';
import { clsx } from 'clsx';
import { Loader2 } from 'lucide-react';
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
      if (data.ok) setBilling(data as BillingData);
    } catch (e) {
      console.error('Failed to load billing:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-theme-muted">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <span className="text-sm">Loading billing info...</span>
      </div>
    );
  }

  if (!billing) {
    return (
      <div className="dashboard-card py-12 text-center">
        <p className="text-sm text-theme-muted">No billing data available.</p>
        <p className="mt-1 text-xs text-theme-muted/80">Provision a VM to start tracking usage.</p>
      </div>
    );
  }

  const currentTier = (billing.current_tier || '').toLowerCase();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-theme-fg">Compute billing</h2>
        <p className="mt-1 text-sm text-theme-muted">Credits used by your cloud engine this billing period.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <BillingCard
          title="Total Credits Used"
          value={billing.total_credits_used?.toFixed(2) || '0.00'}
          subtitle="credits this billing period"
        />
        <BillingCard
          title="Compute"
          value={billing.compute_credits?.toFixed(2) || '0.00'}
          subtitle="credits for VM runtime"
        />
        <BillingCard
          title="Storage"
          value={billing.storage_credits?.toFixed(2) || '0.00'}
          subtitle="credits for disk + snapshots"
        />
      </div>

      <div className="dashboard-card p-6">
        <h3 className="mb-4 text-sm font-semibold text-theme-fg">Current plan</h3>
        <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
          <BillingField label="Tier" value={billing.current_tier || '—'} />
          <BillingField label="Status" value={billing.engine_status || '—'} />
          <BillingField
            label="Hours this month"
            value={billing.hours_this_month != null ? `${billing.hours_this_month.toFixed(1)} hrs` : '0 hrs'}
          />
          <BillingField
            label="Est. monthly cost"
            value={
              billing.total_credits_used
                ? `${billing.total_credits_used.toFixed(0)} credits`
                : '—'
            }
          />
        </div>
      </div>

      <div className="dashboard-card p-6">
        <h3 className="mb-3 text-sm font-semibold text-theme-fg">Pricing reference</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[
            { tier: 'basic', label: 'Basic', spec: '2 vCPU / 8 GB', rate: '$0.067/hr' },
            { tier: 'pro', label: 'Pro', spec: '4 vCPU / 16 GB', rate: '$0.134/hr' },
            { tier: 'power', label: 'Power', spec: '8 vCPU / 32 GB', rate: '$0.268/hr' },
          ].map((t) => (
            <div
              key={t.tier}
              className={clsx(
                'rounded-xl border p-3',
                currentTier === t.tier
                  ? 'border-primary/40 bg-primary/10'
                  : 'border-theme bg-theme-card/30',
              )}
            >
              <div className="text-sm font-semibold text-theme-fg">{t.label}</div>
              <div className="mt-0.5 text-xs text-theme-muted">{t.spec}</div>
              <div className="mt-1 font-mono text-xs text-theme-fg/90">{t.rate}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function BillingCard({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: string;
  subtitle: string;
}) {
  return (
    <div className="dashboard-card p-5">
      <div className="text-xs font-medium text-theme-muted">{title}</div>
      <div className="mt-1 text-2xl font-bold text-theme-fg">{value}</div>
      <div className="mt-0.5 text-xs text-theme-muted">{subtitle}</div>
    </div>
  );
}

function BillingField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-theme-muted">{label}</div>
      <div className="mt-0.5 font-medium capitalize text-theme-fg">{value}</div>
    </div>
  );
}
