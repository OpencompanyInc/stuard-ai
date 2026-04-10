CREATE INDEX IF NOT EXISTS idx_usage_events_user_created_at_desc
  ON public.usage_events(user_id, created_at DESC);

DROP FUNCTION IF EXISTS public.get_usage_credit_total(UUID, TIMESTAMPTZ);
CREATE OR REPLACE FUNCTION public.get_usage_credit_total(
  p_user_id UUID,
  p_since TIMESTAMPTZ DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(COALESCE(credit_cost, 0)), 0)::NUMERIC
  FROM public.usage_events
  WHERE user_id = p_user_id
    AND created_at >= COALESCE(p_since, date_trunc('month', now()));
$$;

DROP FUNCTION IF EXISTS public.get_usage_breakdown(UUID, TIMESTAMPTZ);
CREATE OR REPLACE FUNCTION public.get_usage_breakdown(
  p_user_id UUID,
  p_since TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE(
  category TEXT,
  credits NUMERIC,
  cost_usd NUMERIC,
  event_count BIGINT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    COALESCE(NULLIF(split_part(COALESCE(model, 'unknown'), '/', 1), ''), 'other') AS category,
    ROUND(SUM(COALESCE(credit_cost, 0))::NUMERIC, 2) AS credits,
    ROUND(SUM(COALESCE(cost_usd, 0))::NUMERIC, 6) AS cost_usd,
    COUNT(*)::BIGINT AS event_count
  FROM public.usage_events
  WHERE user_id = p_user_id
    AND created_at >= COALESCE(p_since, date_trunc('month', now()))
  GROUP BY 1
  ORDER BY SUM(COALESCE(credit_cost, 0)) DESC, COUNT(*) DESC;
$$;
