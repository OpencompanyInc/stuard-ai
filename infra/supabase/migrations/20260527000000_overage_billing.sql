-- Replace auto-refill with pay-as-you-go overage billing (Polar metered, billed each cycle).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS overage_billing_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.overage_billing_enabled IS
  'When true, usage beyond included credits is reported to Polar and billed automatically at cycle end.';

COMMENT ON COLUMN public.profiles.hard_spend_limit_cents IS
  'Maximum overage spend (USD cents) allowed per billing cycle. Blocks usage when reached.';

-- Drop auto-refill columns (replaced by overage billing).
ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS auto_refill_enabled,
  DROP COLUMN IF EXISTS auto_refill_threshold_credits,
  DROP COLUMN IF EXISTS auto_refill_amount_cents,
  DROP COLUMN IF EXISTS auto_refill_pending_checkout_id,
  DROP COLUMN IF EXISTS auto_refill_pending_url,
  DROP COLUMN IF EXISTS auto_refill_pending_at,
  DROP COLUMN IF EXISTS auto_refill_last_attempt_at,
  DROP COLUMN IF EXISTS auto_refill_last_success_at,
  DROP COLUMN IF EXISTS monthly_budget_cents;
