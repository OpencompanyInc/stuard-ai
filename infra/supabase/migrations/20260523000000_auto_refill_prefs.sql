-- Auto-refill preferences and pending checkout tracking on profiles.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS auto_refill_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_refill_threshold_credits NUMERIC(12,4) NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS auto_refill_amount_cents INTEGER NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS monthly_budget_cents INTEGER,
  ADD COLUMN IF NOT EXISTS hard_spend_limit_cents INTEGER,
  ADD COLUMN IF NOT EXISTS auto_refill_pending_checkout_id TEXT,
  ADD COLUMN IF NOT EXISTS auto_refill_pending_url TEXT,
  ADD COLUMN IF NOT EXISTS auto_refill_pending_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS auto_refill_last_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS auto_refill_last_success_at TIMESTAMPTZ;

COMMENT ON COLUMN public.profiles.auto_refill_enabled IS 'When true, trigger a Polar checkout when remaining credits drop below the threshold.';
COMMENT ON COLUMN public.profiles.auto_refill_threshold_credits IS 'Remaining credit balance that triggers auto-refill.';
COMMENT ON COLUMN public.profiles.auto_refill_amount_cents IS 'USD cents to charge on auto-refill (minimum 500).';
COMMENT ON COLUMN public.profiles.auto_refill_pending_checkout_id IS 'Polar checkout session id awaiting customer confirmation.';
COMMENT ON COLUMN public.profiles.auto_refill_pending_url IS 'Hosted Polar checkout URL for the pending auto-refill.';
