-- Hot Storage: storage plans, quotas, and user subscriptions
-- Users can purchase storage tiers with hot (PD-SSD) + cold (GCS) quotas.
-- VM hot disk is synced to GCS cold storage on start/stop.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Add storage plan columns to storage_usage
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.storage_usage
  ADD COLUMN IF NOT EXISTS storage_plan_id TEXT NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS storage_quota_gb INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS cold_quota_gb INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS plan_purchased_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMPTZ;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. storage_plans reference table (denormalized from code, for admin/audit)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.storage_plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  hot_disk_gb INTEGER NOT NULL,
  cold_storage_gb INTEGER NOT NULL,
  monthly_usd NUMERIC(8, 2) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.storage_plans (id, name, hot_disk_gb, cold_storage_gb, monthly_usd) VALUES
  ('free',    'Free',    5,   1,  0.00),
  ('starter', 'Starter', 10,  5,  1.50),
  ('pro',     'Pro',     25,  15, 4.00),
  ('power',   'Power',   50,  30, 8.00),
  ('max',     'Max',     100, 60, 15.00)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  hot_disk_gb = EXCLUDED.hot_disk_gb,
  cold_storage_gb = EXCLUDED.cold_storage_gb,
  monthly_usd = EXCLUDED.monthly_usd;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. storage_purchases — track every plan purchase/upgrade
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.storage_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES public.storage_plans(id),
  previous_plan_id TEXT,
  credits_charged NUMERIC(12, 4) NOT NULL DEFAULT 0,
  action TEXT NOT NULL DEFAULT 'purchase'
    CHECK (action IN ('purchase', 'upgrade', 'downgrade')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_storage_purchases_user_id ON public.storage_purchases(user_id);
CREATE INDEX IF NOT EXISTS idx_storage_purchases_created_at ON public.storage_purchases(created_at DESC);

-- Add storage_purchase event type to billing events
ALTER TABLE public.compute_billing_events
  DROP CONSTRAINT IF EXISTS compute_billing_events_event_type_check;

ALTER TABLE public.compute_billing_events
  ADD CONSTRAINT compute_billing_events_event_type_check
  CHECK (event_type IN ('compute', 'hot_storage', 'cold_storage', 'storage_purchase'));

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS Policies
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.storage_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storage_purchases ENABLE ROW LEVEL SECURITY;

-- storage_plans: everyone can read, only service role can modify
CREATE POLICY "Anyone can read storage plans" ON public.storage_plans
  FOR SELECT USING (true);

CREATE POLICY "Service role can manage storage plans" ON public.storage_plans
  FOR ALL USING (auth.role() = 'service_role');

-- storage_purchases: users read own, service role manages all
CREATE POLICY "Users can read own storage purchases" ON public.storage_purchases
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage storage purchases" ON public.storage_purchases
  FOR ALL USING (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────────────────────────
-- Comments
-- ─────────────────────────────────────────────────────────────────────────────

COMMENT ON TABLE public.storage_plans IS 'Available storage plans with hot (PD-SSD) and cold (GCS) quotas';
COMMENT ON TABLE public.storage_purchases IS 'Audit log of storage plan purchases and upgrades';
COMMENT ON COLUMN public.storage_usage.storage_plan_id IS 'Current active storage plan for this user';
COMMENT ON COLUMN public.storage_usage.storage_quota_gb IS 'Allocated hot disk quota in GB based on plan';
COMMENT ON COLUMN public.storage_usage.cold_quota_gb IS 'Allocated cold storage quota in GB based on plan';
