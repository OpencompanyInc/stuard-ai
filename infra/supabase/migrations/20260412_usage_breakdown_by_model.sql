-- Change usage breakdown to group inference events by model name instead of provider
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
    CASE
      WHEN COALESCE(model, '') LIKE 'voice:%' THEN 'voice'
      WHEN COALESCE(model, '') LIKE 'messaging:%'
        OR COALESCE(model, '') IN ('telnyx', 'sms', 'reminder_sms', 'reminder_whatsapp', 'whatsapp')
        THEN 'messaging'
      WHEN COALESCE(model, '') LIKE 'compute%'
        OR COALESCE(model, '') LIKE 'cloud_compute%'
        THEN 'compute'
      WHEN COALESCE(model, '') LIKE 'storage%' THEN 'storage'
      WHEN COALESCE(model, '') LIKE 'subagent%'
        OR COALESCE(model, '') LIKE 'browser%'
        OR COALESCE(model, '') LIKE 'delegation%'
        THEN 'subagent'
      ELSE 'inference:' || COALESCE(model, 'unknown')
    END AS category,
    ROUND(SUM(COALESCE(credit_cost, 0))::NUMERIC, 2) AS credits,
    ROUND(SUM(COALESCE(cost_usd, 0))::NUMERIC, 6) AS cost_usd,
    COUNT(*)::BIGINT AS event_count
  FROM public.usage_events
  WHERE user_id = p_user_id
    AND created_at >= COALESCE(p_since, date_trunc('month', now()))
  GROUP BY 1
  ORDER BY SUM(COALESCE(credit_cost, 0)) DESC, COUNT(*) DESC;
$$;
