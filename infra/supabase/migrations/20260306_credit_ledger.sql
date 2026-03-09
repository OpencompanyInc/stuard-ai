-- Unified credit grants + debit ledger for subscriptions, add-ons, and usage.

ALTER TABLE public.usage_events
  ADD COLUMN IF NOT EXISTS credit_cost NUMERIC(12,4) NOT NULL DEFAULT 0;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS billing_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS billing_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS billing_product_id TEXT,
  ADD COLUMN IF NOT EXISTS billing_subscription_status TEXT,
  ADD COLUMN IF NOT EXISTS current_period_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.credit_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL
    CHECK (source_type IN ('subscription_cycle', 'addon_purchase', 'trial', 'promo', 'admin_adjustment', 'legacy_plan', 'refund')),
  source_ref TEXT NOT NULL,
  plan TEXT,
  amount_usd NUMERIC(12,4),
  total_credits NUMERIC(12,4) NOT NULL DEFAULT 0,
  remaining_credits NUMERIC(12,4) NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT credit_grants_unique_source UNIQUE (user_id, source_type, source_ref),
  CONSTRAINT credit_grants_total_nonnegative CHECK (total_credits >= 0),
  CONSTRAINT credit_grants_remaining_nonnegative CHECK (remaining_credits >= 0)
);

CREATE INDEX IF NOT EXISTS idx_credit_grants_user_id ON public.credit_grants(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_grants_expires_at ON public.credit_grants(expires_at);
CREATE INDEX IF NOT EXISTS idx_credit_grants_source_type ON public.credit_grants(source_type);

CREATE TABLE IF NOT EXISTS public.credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  grant_id UUID REFERENCES public.credit_grants(id) ON DELETE SET NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('grant', 'debit', 'adjustment', 'refund')),
  source_type TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  credits NUMERIC(12,4) NOT NULL,
  amount_usd NUMERIC(12,4),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_transactions_dedupe
  ON public.credit_transactions(user_id, grant_id, entry_type, source_type, source_ref);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_id ON public.credit_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_created_at ON public.credit_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_source_type ON public.credit_transactions(source_type);

ALTER TABLE public.credit_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own credit grants" ON public.credit_grants
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage credit grants" ON public.credit_grants
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Users can read own credit transactions" ON public.credit_transactions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage credit transactions" ON public.credit_transactions
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE public.credit_grants IS 'Credit buckets granted to a user from subscriptions, add-ons, promos, or admin adjustments.';
COMMENT ON TABLE public.credit_transactions IS 'Audit trail of credit grants and debits, including per-grant allocation for usage spending.';
COMMENT ON COLUMN public.usage_events.credit_cost IS 'Exact credit cost for this usage event using current credits-per-USD conversion.';
