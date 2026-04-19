-- Exclude embedding usage rows from user-facing billing summaries/logs while
-- still allowing the raw usage_event rows to exist for internal observability.

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
    AND created_at >= COALESCE(p_since, date_trunc('month', now()))
    AND NOT (
      LOWER(COALESCE(raw->>'sourceType', raw->>'source_type', '')) = 'embedding'
      OR LOWER(COALESCE(raw->>'source_label', raw->>'sourceLabel', '')) LIKE 'embedding%'
      OR LOWER(COALESCE(raw->>'billingExcluded', raw->>'billing_excluded', '')) IN ('true', '1', 'yes')
      OR LOWER(COALESCE(model, '')) LIKE '%embedding%'
      OR LOWER(COALESCE(model, '')) LIKE '%embed-text%'
      OR LOWER(COALESCE(model, '')) LIKE '%nomic-embed%'
      OR LOWER(COALESCE(model, '')) LIKE '%mxbai-embed%'
    );
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
    AND NOT (
      LOWER(COALESCE(raw->>'sourceType', raw->>'source_type', '')) = 'embedding'
      OR LOWER(COALESCE(raw->>'source_label', raw->>'sourceLabel', '')) LIKE 'embedding%'
      OR LOWER(COALESCE(raw->>'billingExcluded', raw->>'billing_excluded', '')) IN ('true', '1', 'yes')
      OR LOWER(COALESCE(model, '')) LIKE '%embedding%'
      OR LOWER(COALESCE(model, '')) LIKE '%embed-text%'
      OR LOWER(COALESCE(model, '')) LIKE '%nomic-embed%'
      OR LOWER(COALESCE(model, '')) LIKE '%mxbai-embed%'
    )
  GROUP BY 1
  ORDER BY SUM(COALESCE(credit_cost, 0)) DESC, COUNT(*) DESC;
$$;

CREATE OR REPLACE FUNCTION public.get_usage_logs_aggregated(
  p_user_id    UUID,
  p_limit      INT          DEFAULT 50,
  p_offset     INT          DEFAULT 0,
  p_since      TIMESTAMPTZ  DEFAULT NULL
)
RETURNS TABLE(
  source_ref          TEXT,
  model               TEXT,
  conversation_id     TEXT,
  source_type         TEXT,
  source_label        TEXT,
  subagent_kind       TEXT,
  prompt_tokens       BIGINT,
  completion_tokens   BIGINT,
  total_tokens        BIGINT,
  cost_usd            NUMERIC,
  credit_cost         NUMERIC,
  step_count          BIGINT,
  created_at          TIMESTAMPTZ,
  total_count         BIGINT
)
LANGUAGE sql
STABLE
AS $$
  WITH grouped AS (
    SELECT
      COALESCE(raw->>'sourceRef', id::TEXT)            AS source_ref,
      MAX(model)                                       AS model,
      MAX(conversation_id::TEXT)                       AS conversation_id,
      COALESCE(MAX(raw->>'sourceType'), 'inference')   AS source_type,
      MAX(raw->>'source_label')                        AS source_label,
      MAX(raw->>'subagentKind')                        AS subagent_kind,
      SUM(COALESCE(prompt_tokens, 0))::BIGINT          AS prompt_tokens,
      SUM(COALESCE(completion_tokens, 0))::BIGINT      AS completion_tokens,
      SUM(COALESCE(total_tokens, 0))::BIGINT           AS total_tokens,
      ROUND(SUM(COALESCE(cost_usd, 0))::NUMERIC, 8)    AS cost_usd,
      ROUND(SUM(COALESCE(credit_cost, 0))::NUMERIC, 4) AS credit_cost,
      COUNT(*)::BIGINT                                 AS step_count,
      MAX(created_at)                                  AS created_at
    FROM public.usage_events
    WHERE user_id = p_user_id
      AND created_at >= COALESCE(p_since, date_trunc('month', now()))
      AND NOT (
        LOWER(COALESCE(raw->>'sourceType', raw->>'source_type', '')) = 'embedding'
        OR LOWER(COALESCE(raw->>'source_label', raw->>'sourceLabel', '')) LIKE 'embedding%'
        OR LOWER(COALESCE(raw->>'billingExcluded', raw->>'billing_excluded', '')) IN ('true', '1', 'yes')
        OR LOWER(COALESCE(model, '')) LIKE '%embedding%'
        OR LOWER(COALESCE(model, '')) LIKE '%embed-text%'
        OR LOWER(COALESCE(model, '')) LIKE '%nomic-embed%'
        OR LOWER(COALESCE(model, '')) LIKE '%mxbai-embed%'
      )
    GROUP BY COALESCE(raw->>'sourceRef', id::TEXT)
  )
  SELECT
    g.source_ref,
    g.model,
    g.conversation_id,
    g.source_type,
    g.source_label,
    g.subagent_kind,
    g.prompt_tokens,
    g.completion_tokens,
    g.total_tokens,
    g.cost_usd,
    g.credit_cost,
    g.step_count,
    g.created_at,
    COUNT(*) OVER()::BIGINT AS total_count
  FROM grouped g
  ORDER BY g.created_at DESC
  LIMIT p_limit OFFSET p_offset;
$$;
