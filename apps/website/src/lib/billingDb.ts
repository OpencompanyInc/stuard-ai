// Shared server-side helpers for reading billing data straight from Supabase.
// Mirrors the subset of apps/cloud-ai/src/supabase.ts that the website billing
// page needs, so billing works even when the cloud-ai service is offline.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function normalizeText(v: unknown): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

function isTruthyFlag(v: unknown): boolean {
  if (v === true) return true;
  const n = normalizeText(v);
  return n === 'true' || n === '1' || n === 'yes';
}

function isEmbeddingModel(model: string | null | undefined): boolean {
  const n = normalizeText(model);
  if (!n) return false;
  return n.includes('embedding') || n.includes('embed-text') || n.includes('nomic-embed') || n.includes('mxbai-embed');
}

export function isNonBillableUsageEvent(input: { model?: string | null; raw?: any }): boolean {
  const raw = input?.raw && typeof input.raw === 'object' ? input.raw : {};
  const sourceType = normalizeText(raw.sourceType ?? raw.source_type);
  const sourceLabel = normalizeText(raw.source_label ?? raw.sourceLabel);
  const billingExcluded = raw.billingExcluded ?? raw.billing_excluded ?? raw.nonBillable ?? raw.non_billable;
  return (
    isTruthyFlag(billingExcluded) ||
    sourceType === 'embedding' ||
    sourceLabel.startsWith('embedding') ||
    isEmbeddingModel(input?.model ?? raw.model)
  );
}

export function resolvePeriodStart(since?: string | null): Date {
  if (since) {
    const d = new Date(since);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export function categorizeModel(model: string): string {
  const m = String(model || 'unknown');
  if (m.startsWith('voice:')) return 'voice';
  if (m.startsWith('messaging:') || ['telnyx', 'sms', 'reminder_sms', 'reminder_whatsapp', 'whatsapp'].includes(m)) return 'messaging';
  if (m.startsWith('compute') || m.startsWith('cloud_compute')) return 'compute';
  if (m.startsWith('storage')) return 'storage';
  if (m.startsWith('subagent') || m.startsWith('browser') || m.startsWith('delegation')) return 'subagent';
  return `inference:${m}`;
}

export function isIncludedGrant(sourceType: string | null | undefined): boolean {
  return normalizeText(sourceType) === 'subscription_cycle';
}

export function isExpiredGrant(expiresAt: string | null | undefined, now = Date.now()): boolean {
  if (!expiresAt) return false;
  const t = Date.parse(expiresAt);
  return Number.isFinite(t) && t <= now;
}

export function serviceClient(): SupabaseClient | null {
  if (!supabaseUrl || !supabaseServiceKey) return null;
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export async function getAuthedUser(authHeader: string | null): Promise<{ id: string; email?: string | null } | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) return null;
  const client = serviceClient();
  if (!client) return null;
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email };
}

function envNumber(key: string, fallback: number): number {
  const v = process.env[key];
  if (v == null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function creditsPerUsd(): number {
  return envNumber('CREDITS_PER_USD', 33);
}

// Mirrors apps/cloud-ai/src/pricing.ts `monthlyCreditLimitForPlan` for the plans
// the website needs. Returns -1 for unlimited (BYOK). Used as the included-credit
// fallback when a user has no subscription_cycle grant (e.g. fresh free accounts),
// so the website shows the plan's monthly allotment instead of collapsing to 0.
const PLAN_BUDGET_USD: Record<string, number> = {
  free_trial: 0.45,
  starter: 6.5,
  pro: 31.5,
  power: 75,
};
export function monthlyCreditLimitForPlan(plan: string): number {
  const key = String(plan || '').trim().toLowerCase();
  const direct = envNumber(`PLAN_${key.toUpperCase()}_MONTHLY_CREDITS`, -1);
  if (direct >= 0) return direct;
  if (key === 'byok') return -1;
  const budget = PLAN_BUDGET_USD[key];
  if (budget != null) return Math.round(budget * creditsPerUsd());
  // free / unknown → 30 credits, just under $1 (≈33 credits = $1)
  return 30;
}

export type CreditSummary = {
  plan: string;
  limit: number;
  used: number;
  remaining: number;
  unlimited: boolean;
  includedCredits: number;
  includedRemaining: number;
  addonCredits: number;
  addonRemaining: number;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
};

export async function getCreditSummary(userId: string): Promise<CreditSummary> {
  const client = serviceClient();
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  let plan = 'free';
  let currentPeriodStart: string | null = null;
  let currentPeriodEnd: string | null = null;

  if (client) {
    const { data: profile } = await client
      .from('profiles')
      .select('plan, current_period_start, current_period_end')
      .eq('id', userId)
      .maybeSingle();
    if (profile) {
      plan = String((profile as any).plan || plan).toLowerCase();
      currentPeriodStart = (profile as any).current_period_start || null;
      currentPeriodEnd = (profile as any).current_period_end || null;
    }
  }

  const billingStart = currentPeriodStart && !Number.isNaN(Date.parse(currentPeriodStart))
    ? new Date(currentPeriodStart)
    : monthStart;

  let used = 0;
  let includedCredits = 0;
  let includedRemaining = 0;
  let addonCredits = 0;
  let addonRemaining = 0;

  if (client) {
    const [{ data: events }, { data: grants }] = await Promise.all([
      client
        .from('usage_events')
        .select('model, credit_cost, raw')
        .eq('user_id', userId)
        .gte('created_at', billingStart.toISOString()),
      client
        .from('credit_grants')
        .select('source_type, total_credits, remaining_credits, expires_at')
        .eq('user_id', userId),
    ]);

    for (const row of events || []) {
      if (isNonBillableUsageEvent({ model: (row as any).model, raw: (row as any).raw })) continue;
      const c = Number((row as any).credit_cost);
      if (Number.isFinite(c) && c > 0) used += c;
    }
    used = Math.max(0, Math.ceil(used));

    const now = Date.now();
    for (const row of grants || []) {
      if (isExpiredGrant((row as any).expires_at, now)) continue;
      const total = Math.max(0, Number((row as any).total_credits) || 0);
      const remaining = Math.max(0, Number((row as any).remaining_credits) || 0);
      if (isIncludedGrant((row as any).source_type)) {
        includedCredits += total;
        includedRemaining += remaining;
      } else {
        addonCredits += total;
        addonRemaining += remaining;
      }
    }
  }

  // Apply the plan-limit fallback (mirrors cloud-ai getCreditSummary): when there
  // is no subscription_cycle grant, fall back to the plan's monthly allotment so
  // free accounts show e.g. "0 / 50" instead of "0 / 0".
  const limit = monthlyCreditLimitForPlan(plan);
  const unlimited = limit < 0;
  const fallbackIncludedCredits = unlimited ? 0 : Math.max(0, limit);
  const fallbackIncludedRemaining = unlimited ? 0 : Math.max(0, limit - used);
  const effectiveIncludedCredits = includedCredits > 0 ? includedCredits : fallbackIncludedCredits;
  const grantBasedRemaining = (includedCredits > 0 || includedRemaining > 0)
    ? Math.max(0, includedRemaining)
    : fallbackIncludedRemaining;
  const usageBasedRemaining = Math.max(0, effectiveIncludedCredits - used);
  const effectiveIncludedRemaining = Math.min(grantBasedRemaining, usageBasedRemaining);
  const remaining = unlimited ? -1 : Math.max(0, effectiveIncludedRemaining + addonRemaining);
  const totalLimit = unlimited ? -1 : Math.max(0, effectiveIncludedCredits + addonCredits);

  return {
    plan,
    limit: totalLimit,
    used,
    remaining,
    unlimited,
    includedCredits: effectiveIncludedCredits,
    includedRemaining: effectiveIncludedRemaining,
    addonCredits,
    addonRemaining,
    currentPeriodStart: currentPeriodStart || billingStart.toISOString(),
    currentPeriodEnd,
  };
}

export async function getUsageBreakdown(
  userId: string,
  since: Date,
): Promise<Array<{ category: string; credits: number; costUsd: number; count: number }>> {
  const client = serviceClient();
  if (!client) return [];
  const { data, error } = await client
    .from('usage_events')
    .select('model, cost_usd, credit_cost, raw')
    .eq('user_id', userId)
    .gte('created_at', since.toISOString());
  if (error || !data) return [];

  const buckets: Record<string, { credits: number; costUsd: number; count: number }> = {};
  for (const row of data as any[]) {
    if (isNonBillableUsageEvent({ model: row.model, raw: row.raw })) continue;
    const category = categorizeModel(String(row.model || 'unknown'));
    const b = buckets[category] || (buckets[category] = { credits: 0, costUsd: 0, count: 0 });
    b.credits += Number(row.credit_cost) || 0;
    b.costUsd += Number(row.cost_usd) || 0;
    b.count += 1;
  }
  return Object.entries(buckets).map(([category, v]) => ({
    category,
    credits: Number(v.credits.toFixed(2)),
    costUsd: Number(v.costUsd.toFixed(6)),
    count: v.count,
  }));
}

export async function getModelBreakdown(
  userId: string,
  since: Date,
): Promise<Array<{ model: string; credits: number; costUsd: number; count: number }>> {
  const client = serviceClient();
  if (!client) return [];
  const { data, error } = await client
    .from('usage_events')
    .select('model, cost_usd, credit_cost, raw')
    .eq('user_id', userId)
    .gte('created_at', since.toISOString());
  if (error || !data) return [];

  const buckets: Record<string, { credits: number; costUsd: number; count: number }> = {};
  for (const row of data as any[]) {
    if (isNonBillableUsageEvent({ model: row.model, raw: row.raw })) continue;
    const model = String(row.model || 'unknown');
    if (
      model.startsWith('voice:') || model.startsWith('messaging:') ||
      model.startsWith('compute') || model.startsWith('storage') ||
      model === 'telnyx' || model === 'sms' || model === 'whatsapp'
    ) continue;
    const b = buckets[model] || (buckets[model] = { credits: 0, costUsd: 0, count: 0 });
    b.credits += Number(row.credit_cost) || 0;
    b.costUsd += Number(row.cost_usd) || 0;
    b.count += 1;
  }
  return Object.entries(buckets)
    .map(([model, v]) => ({
      model,
      credits: Number(v.credits.toFixed(2)),
      costUsd: Number(v.costUsd.toFixed(6)),
      count: v.count,
    }))
    .sort((a, b) => b.credits - a.credits);
}

export async function getUsageLogs(
  userId: string,
  limit: number,
  offset: number,
  since: Date,
): Promise<{ logs: any[]; total: number }> {
  const client = serviceClient();
  if (!client) return { logs: [], total: 0 };

  const fetchLimit = Math.max(limit * 8, 200);
  const { data, error } = await client
    .from('usage_events')
    .select('id, model, prompt_tokens, completion_tokens, total_tokens, cost_usd, credit_cost, conversation_id, raw, created_at')
    .eq('user_id', userId)
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: false })
    .limit(fetchLimit);

  if (error || !data) return { logs: [], total: 0 };

  const groups = new Map<string, any>();
  for (const row of data as any[]) {
    const raw = row.raw && typeof row.raw === 'object' ? row.raw : {};
    if (isNonBillableUsageEvent({ model: row.model, raw })) continue;
    const key = raw.sourceRef || raw.source_ref || row.id;
    if (!groups.has(key)) {
      groups.set(key, {
        id: key,
        source_ref: key,
        model: row.model,
        conversation_id: row.conversation_id,
        source_type: raw.sourceType || raw.source_type || null,
        source_label: raw.source_label || raw.sourceLabel || null,
        subagent_kind: raw.subagentKind || raw.subagent_kind || null,
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        cost_usd: 0,
        credit_cost: 0,
        step_count: 0,
        created_at: row.created_at,
      });
    }
    const g = groups.get(key)!;
    g.prompt_tokens += Number(row.prompt_tokens || 0);
    g.completion_tokens += Number(row.completion_tokens || 0);
    g.total_tokens += Number(row.total_tokens || 0);
    g.cost_usd += Number(row.cost_usd || 0);
    g.credit_cost += Number(row.credit_cost || 0);
    g.step_count += 1;
    if (row.created_at > g.created_at) g.created_at = row.created_at;
  }

  const allGroups = Array.from(groups.values()).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return {
    logs: allGroups.slice(offset, offset + limit),
    total: allGroups.length,
  };
}
