import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

/** Set to false to re-enable auto-refill / budget / metered-limit prefs API. */
const BILLING_PREFS_DISABLED = true;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function admin() {
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function getAuthedUserId(req: NextRequest): Promise<string | null> {
  const authHeader = req.headers.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) return null;
  const { data, error } = await admin().auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}

const PREF_COLUMNS = [
  'auto_refill_enabled',
  'auto_refill_threshold_credits',
  'auto_refill_amount_cents',
  'monthly_budget_cents',
  'hard_spend_limit_cents',
] as const;

export async function GET(req: NextRequest) {
  if (BILLING_PREFS_DISABLED) {
    return NextResponse.json(
      { error: 'disabled', message: 'Billing settings are temporarily unavailable.' },
      { status: 503 },
    );
  }

  const userId = await getAuthedUserId(req);
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data, error } = await admin()
    .from('profiles')
    .select(PREF_COLUMNS.join(','))
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: 'load_failed', message: error.message }, { status: 500 });
  }

  const prefs = (data || {}) as Record<string, unknown>;
  return NextResponse.json({
    autoRefillEnabled: Boolean(prefs.auto_refill_enabled ?? false),
    autoRefillThresholdCredits: Number(prefs.auto_refill_threshold_credits ?? 100),
    autoRefillAmountCents: Number(prefs.auto_refill_amount_cents ?? 1000),
    monthlyBudgetCents: prefs.monthly_budget_cents == null ? null : Number(prefs.monthly_budget_cents),
    hardSpendLimitCents: prefs.hard_spend_limit_cents == null ? null : Number(prefs.hard_spend_limit_cents),
  });
}

export async function PATCH(req: NextRequest) {
  if (BILLING_PREFS_DISABLED) {
    return NextResponse.json(
      { error: 'disabled', message: 'Billing settings are temporarily unavailable.' },
      { status: 503 },
    );
  }

  const userId = await getAuthedUserId(req);
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const updates: Record<string, unknown> = {};

  if (typeof body.autoRefillEnabled === 'boolean') {
    updates.auto_refill_enabled = body.autoRefillEnabled;
  }
  if (Number.isFinite(body.autoRefillThresholdCredits)) {
    updates.auto_refill_threshold_credits = Math.max(0, Number(body.autoRefillThresholdCredits));
  }
  if (Number.isFinite(body.autoRefillAmountCents)) {
    const cents = Math.max(500, Math.trunc(Number(body.autoRefillAmountCents)));
    updates.auto_refill_amount_cents = cents;
  }
  if (body.monthlyBudgetCents === null) {
    updates.monthly_budget_cents = null;
  } else if (Number.isFinite(body.monthlyBudgetCents)) {
    updates.monthly_budget_cents = Math.max(0, Math.trunc(Number(body.monthlyBudgetCents)));
  }
  if (body.hardSpendLimitCents === null) {
    updates.hard_spend_limit_cents = null;
  } else if (Number.isFinite(body.hardSpendLimitCents)) {
    updates.hard_spend_limit_cents = Math.max(0, Math.trunc(Number(body.hardSpendLimitCents)));
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'no_fields' }, { status: 400 });
  }

  const { error } = await admin().from('profiles').update(updates).eq('id', userId);
  if (error) {
    return NextResponse.json({ error: 'save_failed', message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
