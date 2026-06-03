/**
 * Polar metered overage billing — DISABLED for now.
 * Re-enable when the Polar meter is configured and billing settings UI is wired.
 */

export async function getCycleOverageSpendCents(_userId: string, _cycleStart?: Date): Promise<number> {
  return 0;
}

export async function canUseOverageBilling(_userId: string): Promise<boolean> {
  return false;
}

export async function getOverageStatus(_userId: string): Promise<{
  overageBillingEnabled: boolean;
  cycleSpendCapCents: number | null;
  cycleSpendCents: number;
  cycleStart: string | null;
  cycleEnd: string | null;
  hasActiveSubscription: boolean;
  canUseOverage: boolean;
}> {
  return {
    overageBillingEnabled: false,
    cycleSpendCapCents: null,
    cycleSpendCents: 0,
    cycleStart: null,
    cycleEnd: null,
    hasActiveSubscription: false,
    canUseOverage: false,
  };
}

export async function handleOverageUsage(
  _userId: string,
  _uncoveredCredits: number,
  _costUsd: number,
  _creditCost: number,
  _usageEventId: string,
  _extraMetadata?: Record<string, string | number | boolean>,
): Promise<void> {
  return;
}

export function scheduleOverageReport(
  _userId: string,
  _uncoveredCredits: number,
  _costUsd: number,
  _creditCost: number,
  _usageEventId: string,
  _extraMetadata?: Record<string, string | number | boolean>,
): void {
  return;
}

/*
// ─── Original implementation (disabled) ───────────────────────────────────────

import { Polar } from '@polar-sh/sdk';
import { getSupabaseAdmin } from '../supabase';
import { writeLog } from '../utils/logger';

const METER_EVENT_NAME = (process.env.POLAR_METER_EVENT_NAME || 'stuard_usage').trim();
// Overage billing requires a subscription in good standing — not past_due (failed payment).
const OVERAGE_ELIGIBLE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing']);

type OverageProfile = {
  user_id?: string;
  id?: string;
  overage_billing_enabled?: boolean;
  hard_spend_limit_cents?: number | null;
  billing_customer_id?: string | null;
  billing_subscription_id?: string | null;
  billing_subscription_status?: string | null;
  current_period_start?: string | null;
  current_period_end?: string | null;
};

function getPolarClient(): Polar | null {
  const accessToken = (process.env.POLAR_ACCESS_TOKEN || '').trim();
  if (!accessToken) return null;
  const mode = String(process.env.POLAR_MODE || '').toLowerCase().startsWith('sand') ? 'sandbox' : 'production';
  return new Polar({ accessToken, server: mode });
}

function getPolarApiBase(): string {
  const mode = String(process.env.POLAR_MODE || '').toLowerCase().startsWith('sand') ? 'sandbox' : 'production';
  return mode === 'sandbox' ? 'https://sandbox-api.polar.sh' : 'https://api.polar.sh';
}

async function fetchOverageProfile(userId: string): Promise<OverageProfile | null> {
  const sb = getSupabaseAdmin();
  if (!sb) return null;

  const columns = [
    'user_id',
    'overage_billing_enabled',
    'hard_spend_limit_cents',
    'billing_customer_id',
    'billing_subscription_id',
    'billing_subscription_status',
    'current_period_start',
    'current_period_end',
  ].join(',');

  const byUserId = await sb.from('profiles').select(columns).eq('user_id', userId).maybeSingle();
  if (byUserId.data) return byUserId.data as OverageProfile;

  const byId = await sb.from('profiles').select(columns).eq('id', userId).maybeSingle();
  return (byId.data as OverageProfile | null) ?? null;
}

function hasOverageEligibleSubscription(profile: OverageProfile): boolean {
  const status = String(profile.billing_subscription_status || '').trim().toLowerCase();
  return Boolean(profile.billing_subscription_id) && OVERAGE_ELIGIBLE_SUBSCRIPTION_STATUSES.has(status);
}

function resolveCycleStart(profile: OverageProfile): Date {
  const periodStart = profile.current_period_start;
  if (periodStart && Number.isFinite(Date.parse(periodStart))) {
    return new Date(periodStart);
  }
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export async function getCycleOverageSpendCents(userId: string, cycleStart?: Date): Promise<number> {
  const sb = getSupabaseAdmin();
  if (!sb) return 0;

  let start = cycleStart;
  if (!start) {
    const profile = await fetchOverageProfile(userId);
    start = resolveCycleStart(profile || {});
  }

  const { data } = await sb
    .from('usage_events')
    .select('raw')
    .eq('user_id', userId)
    .gte('created_at', start.toISOString())
    .contains('raw', { overageBilled: true });

  let totalCents = 0;
  for (const row of data || []) {
    const raw = (row as any)?.raw || {};
    const overageUsdCents = Number(raw?.overageUsdCents ?? raw?.overage_usd_cents);
    if (Number.isFinite(overageUsdCents) && overageUsdCents > 0) {
      totalCents += Math.trunc(overageUsdCents);
    }
  }
  return totalCents;
}

export async function canUseOverageBilling(userId: string): Promise<boolean> {
  const profile = await fetchOverageProfile(userId);
  if (!profile?.overage_billing_enabled) return false;
  if (!hasOverageEligibleSubscription(profile)) return false;
  if (!profile.billing_customer_id && !profile.billing_subscription_id) return false;

  const cap = profile.hard_spend_limit_cents;
  if (cap == null || !Number.isFinite(Number(cap)) || Number(cap) <= 0) {
    return true;
  }

  const spent = await getCycleOverageSpendCents(userId, resolveCycleStart(profile));
  return spent < Number(cap);
}

export async function getOverageStatus(userId: string): Promise<{
  overageBillingEnabled: boolean;
  cycleSpendCapCents: number | null;
  cycleSpendCents: number;
  cycleStart: string | null;
  cycleEnd: string | null;
  hasActiveSubscription: boolean;
  canUseOverage: boolean;
}> {
  const profile = await fetchOverageProfile(userId);
  const cycleStart = profile ? resolveCycleStart(profile) : new Date();
  const spent = await getCycleOverageSpendCents(userId, cycleStart);
  const active = profile ? hasOverageEligibleSubscription(profile) : false;
  const enabled = Boolean(profile?.overage_billing_enabled);

  return {
    overageBillingEnabled: enabled,
    cycleSpendCapCents: profile?.hard_spend_limit_cents ?? null,
    cycleSpendCents: spent,
    cycleStart: profile?.current_period_start || cycleStart.toISOString(),
    cycleEnd: profile?.current_period_end || null,
    hasActiveSubscription: active,
    canUseOverage: enabled && active && await canUseOverageBilling(userId),
  };
}

async function ingestPolarEvent(
  userId: string,
  usdCents: number,
  externalId: string,
  metadata: Record<string, string | number | boolean>,
): Promise<boolean> {
  const polar = getPolarClient();
  const accessToken = (process.env.POLAR_ACCESS_TOKEN || '').trim();
  if (!polar && !accessToken) {
    writeLog('overage_no_polar_client', { userId });
    return false;
  }

  const event = {
    name: METER_EVENT_NAME,
    external_customer_id: userId,
    external_id: externalId,
    timestamp: new Date().toISOString(),
    metadata: {
      ...metadata,
      usd_cents: usdCents,
    },
  };

  try {
    const eventsApi = (polar as any)?.events;
    if (eventsApi?.ingest) {
      await eventsApi.ingest({ events: [event] });
      return true;
    }

    const response = await fetch(`${getPolarApiBase()}/v1/events/ingest`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ events: [event] }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      writeLog('overage_polar_ingest_failed', { userId, status: response.status, body: body.slice(0, 200) });
      return false;
    }
    return true;
  } catch (e: any) {
    writeLog('overage_polar_ingest_error', { userId, error: e?.message || String(e) });
    return false;
  }
}

export async function handleOverageUsage(
  userId: string,
  uncoveredCredits: number,
  costUsd: number,
  creditCost: number,
  usageEventId: string,
  extraMetadata?: Record<string, string | number | boolean>,
): Promise<void> {
  if (!userId || uncoveredCredits <= 0 || costUsd <= 0) return;

  try {
    const profile = await fetchOverageProfile(userId);
    if (!profile?.overage_billing_enabled || !hasOverageEligibleSubscription(profile)) return;

    const overageFraction = creditCost > 0 ? Math.min(1, uncoveredCredits / creditCost) : 1;
    const overageUsd = Number((costUsd * overageFraction).toFixed(8));
    const overageUsdCents = Math.max(1, Math.round(overageUsd * 100));
    if (overageUsdCents <= 0) return;

    const cap = profile.hard_spend_limit_cents;
    if (cap != null && Number.isFinite(Number(cap)) && Number(cap) > 0) {
      const spent = await getCycleOverageSpendCents(userId, resolveCycleStart(profile));
      if (spent + overageUsdCents > Number(cap)) {
        writeLog('overage_cap_blocked', { userId, spent, overageUsdCents, cap });
        return;
      }
    }

    const reported = await ingestPolarEvent(userId, overageUsdCents, usageEventId, {
      uncovered_credits: Number(uncoveredCredits.toFixed(4)),
      ...(extraMetadata || {}),
    });

    if (!reported) return;

    const sb = getSupabaseAdmin();
    if (sb) {
      const { data: existing } = await sb
        .from('usage_events')
        .select('raw')
        .eq('id', usageEventId)
        .maybeSingle();

      const raw = { ...((existing as any)?.raw || {}), overageBilled: true, overageUsdCents };
      await sb.from('usage_events').update({ raw }).eq('id', usageEventId);
    }

    writeLog('overage_reported', { userId, overageUsdCents, usageEventId, uncoveredCredits });
  } catch (e: any) {
    writeLog('overage_handle_error', { userId, error: e?.message || String(e) });
  }
}

export function scheduleOverageReport(
  userId: string,
  uncoveredCredits: number,
  costUsd: number,
  creditCost: number,
  usageEventId: string,
  extraMetadata?: Record<string, string | number | boolean>,
): void {
  void handleOverageUsage(userId, uncoveredCredits, costUsd, creditCost, usageEventId, extraMetadata);
}

*/
