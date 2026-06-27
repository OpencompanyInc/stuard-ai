-- Aggregate usage log entries by sourceRef so that each chat turn / subagent
-- run appears as a single row instead of one row per step/settlement.
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
      COALESCE(raw->>'sourceRef', id::TEXT)         AS source_ref,
      MAX(model)                                     AS model,
      MAX(conversation_id::TEXT)                     AS conversation_id,
      COALESCE(MAX(raw->>'sourceType'), 'inference') AS source_type,
      MAX(raw->>'source_label')                      AS source_label,
      MAX(raw->>'subagentKind')                      AS subagent_kind,
      SUM(COALESCE(prompt_tokens, 0))::BIGINT        AS prompt_tokens,
      SUM(COALESCE(completion_tokens, 0))::BIGINT    AS completion_tokens,
      SUM(COALESCE(total_tokens, 0))::BIGINT         AS total_tokens,
      ROUND(SUM(COALESCE(cost_usd, 0))::NUMERIC, 8)  AS cost_usd,
      ROUND(SUM(COALESCE(credit_cost, 0))::NUMERIC, 4) AS credit_cost,
      COUNT(*)::BIGINT                               AS step_count,
      MAX(created_at)                                AS created_at
    FROM public.usage_events
    WHERE user_id = p_user_id
      AND created_at >= COALESCE(p_since, date_trunc('month', now()))
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
