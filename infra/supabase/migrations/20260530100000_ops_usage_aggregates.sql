-- SQL-side aggregates for ops console. Avoids PostgREST 1000-row cap on raw
-- usage_events selects, which caused stale lastActive and undercounted totals
-- for heavy users.

CREATE OR REPLACE FUNCTION public.get_ops_leaderboard(
  p_since     TIMESTAMPTZ,
  p_metric    TEXT DEFAULT 'credits',
  p_limit     INT  DEFAULT 50
)
RETURNS TABLE(
  user_id             UUID,
  requests            BIGINT,
  tokens              BIGINT,
  prompt_tokens       BIGINT,
  completion_tokens   BIGINT,
  cost_usd            NUMERIC,
  credit_cost         NUMERIC,
  model_count         BIGINT,
  conversation_count  BIGINT,
  first_active        TIMESTAMPTZ,
  last_active         TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    ue.user_id,
    COUNT(*)::BIGINT                                              AS requests,
    SUM(COALESCE(ue.total_tokens, 0))::BIGINT                     AS tokens,
    SUM(COALESCE(ue.prompt_tokens, 0))::BIGINT                    AS prompt_tokens,
    SUM(COALESCE(ue.completion_tokens, 0))::BIGINT                AS completion_tokens,
    ROUND(SUM(COALESCE(ue.cost_usd, 0))::NUMERIC, 8)              AS cost_usd,
    ROUND(SUM(COALESCE(ue.credit_cost, 0))::NUMERIC, 8)           AS credit_cost,
    COUNT(DISTINCT ue.model)::BIGINT                              AS model_count,
    COUNT(DISTINCT ue.conversation_id)::BIGINT                  AS conversation_count,
    MIN(ue.created_at)                                            AS first_active,
    MAX(ue.created_at)                                            AS last_active
  FROM public.usage_events ue
  WHERE ue.created_at >= p_since
    AND ue.user_id IS NOT NULL
  GROUP BY ue.user_id
  ORDER BY
    CASE lower(COALESCE(p_metric, 'credits'))
      WHEN 'cost'     THEN SUM(COALESCE(ue.cost_usd, 0))
      WHEN 'tokens'   THEN SUM(COALESCE(ue.total_tokens, 0))::NUMERIC
      WHEN 'requests' THEN COUNT(*)::NUMERIC
      ELSE SUM(COALESCE(ue.credit_cost, 0))
    END DESC,
    MAX(ue.created_at) DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
$$;

CREATE OR REPLACE FUNCTION public.get_ops_period_totals(
  p_since TIMESTAMPTZ
)
RETURNS TABLE(
  active_users  BIGINT,
  requests      BIGINT,
  tokens        BIGINT,
  cost_usd      NUMERIC,
  credit_cost   NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    COUNT(DISTINCT user_id)::BIGINT                               AS active_users,
    COUNT(*)::BIGINT                                              AS requests,
    SUM(COALESCE(total_tokens, 0))::BIGINT                        AS tokens,
    ROUND(SUM(COALESCE(cost_usd, 0))::NUMERIC, 8)                 AS cost_usd,
    ROUND(SUM(COALESCE(credit_cost, 0))::NUMERIC, 8)              AS credit_cost
  FROM public.usage_events
  WHERE created_at >= p_since;
$$;

CREATE OR REPLACE FUNCTION public.get_ops_usage_daily(
  p_since TIMESTAMPTZ
)
RETURNS TABLE(
  day         DATE,
  requests    BIGINT,
  tokens      BIGINT,
  cost_usd    NUMERIC,
  credit_cost NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    (created_at AT TIME ZONE 'UTC')::DATE                         AS day,
    COUNT(*)::BIGINT                                              AS requests,
    SUM(COALESCE(total_tokens, 0))::BIGINT                        AS tokens,
    ROUND(SUM(COALESCE(cost_usd, 0))::NUMERIC, 8)                 AS cost_usd,
    ROUND(SUM(COALESCE(credit_cost, 0))::NUMERIC, 8)              AS credit_cost
  FROM public.usage_events
  WHERE created_at >= p_since
  GROUP BY 1
  ORDER BY 1;
$$;

CREATE OR REPLACE FUNCTION public.get_ops_active_users_daily(
  p_since TIMESTAMPTZ
)
RETURNS TABLE(
  day   DATE,
  users BIGINT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    (created_at AT TIME ZONE 'UTC')::DATE                         AS day,
    COUNT(DISTINCT user_id)::BIGINT                               AS users
  FROM public.usage_events
  WHERE created_at >= p_since
    AND user_id IS NOT NULL
  GROUP BY 1
  ORDER BY 1;
$$;

CREATE OR REPLACE FUNCTION public.get_ops_model_breakdown(
  p_since  TIMESTAMPTZ,
  p_user_id UUID DEFAULT NULL
)
RETURNS TABLE(
  model               TEXT,
  requests            BIGINT,
  tokens              BIGINT,
  prompt_tokens       BIGINT,
  completion_tokens   BIGINT,
  cost_usd            NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    COALESCE(model, 'unknown')                                    AS model,
    COUNT(*)::BIGINT                                              AS requests,
    SUM(COALESCE(total_tokens, 0))::BIGINT                        AS tokens,
    SUM(COALESCE(prompt_tokens, 0))::BIGINT                       AS prompt_tokens,
    SUM(COALESCE(completion_tokens, 0))::BIGINT                   AS completion_tokens,
    ROUND(SUM(COALESCE(cost_usd, 0))::NUMERIC, 8)                 AS cost_usd
  FROM public.usage_events
  WHERE created_at >= p_since
    AND (p_user_id IS NULL OR user_id = p_user_id)
  GROUP BY 1
  ORDER BY SUM(COALESCE(total_tokens, 0)) DESC, COUNT(*) DESC;
$$;

CREATE OR REPLACE FUNCTION public.get_ops_category_breakdown(
  p_since   TIMESTAMPTZ,
  p_user_id UUID DEFAULT NULL
)
RETURNS TABLE(
  category    TEXT,
  credits     NUMERIC,
  cost_usd    NUMERIC,
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
      ELSE 'inference'
    END                                                           AS category,
    ROUND(SUM(COALESCE(credit_cost, 0))::NUMERIC, 4)              AS credits,
    ROUND(SUM(COALESCE(cost_usd, 0))::NUMERIC, 8)                 AS cost_usd,
    COUNT(*)::BIGINT                                              AS event_count
  FROM public.usage_events
  WHERE created_at >= p_since
    AND (p_user_id IS NULL OR user_id = p_user_id)
  GROUP BY 1
  ORDER BY SUM(COALESCE(credit_cost, 0)) DESC, COUNT(*) DESC;
$$;

CREATE OR REPLACE FUNCTION public.get_ops_engagement_stats(
  p_since TIMESTAMPTZ
)
RETURNS TABLE(
  dau BIGINT,
  wau BIGINT,
  mau BIGINT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    COUNT(DISTINCT user_id) FILTER (WHERE created_at >= now() - interval '1 day')::BIGINT  AS dau,
    COUNT(DISTINCT user_id) FILTER (WHERE created_at >= now() - interval '7 days')::BIGINT AS wau,
    COUNT(DISTINCT user_id) FILTER (WHERE created_at >= now() - interval '30 days')::BIGINT AS mau
  FROM public.usage_events
  WHERE created_at >= p_since
    AND user_id IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.get_ops_user_usage_summary(
  p_since TIMESTAMPTZ
)
RETURNS TABLE(
  user_id     UUID,
  requests    BIGINT,
  tokens      BIGINT,
  cost_usd    NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    user_id,
    COUNT(*)::BIGINT                                              AS requests,
    SUM(COALESCE(total_tokens, 0))::BIGINT                        AS tokens,
    ROUND(SUM(COALESCE(cost_usd, 0))::NUMERIC, 8)                 AS cost_usd
  FROM public.usage_events
  WHERE created_at >= p_since
    AND user_id IS NOT NULL
  GROUP BY user_id;
$$;

CREATE OR REPLACE FUNCTION public.get_ops_user_activity_summary(
  p_user_id UUID,
  p_since   TIMESTAMPTZ
)
RETURNS TABLE(
  requests            BIGINT,
  tokens              BIGINT,
  cost_usd            NUMERIC,
  credit_cost         NUMERIC,
  conversation_count  BIGINT,
  model_count         BIGINT,
  active_days         BIGINT,
  first_active        TIMESTAMPTZ,
  last_active         TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    COUNT(*)::BIGINT                                              AS requests,
    SUM(COALESCE(total_tokens, 0))::BIGINT                        AS tokens,
    ROUND(SUM(COALESCE(cost_usd, 0))::NUMERIC, 8)                 AS cost_usd,
    ROUND(SUM(COALESCE(credit_cost, 0))::NUMERIC, 8)              AS credit_cost,
    COUNT(DISTINCT conversation_id)::BIGINT                       AS conversation_count,
    COUNT(DISTINCT model)::BIGINT                                 AS model_count,
    COUNT(DISTINCT (created_at AT TIME ZONE 'UTC')::DATE)::BIGINT AS active_days,
    MIN(created_at)                                               AS first_active,
    MAX(created_at)                                               AS last_active
  FROM public.usage_events
  WHERE user_id = p_user_id
    AND created_at >= p_since;
$$;

CREATE OR REPLACE FUNCTION public.get_ops_user_activity_daily(
  p_user_id UUID,
  p_since   TIMESTAMPTZ
)
RETURNS TABLE(
  day         DATE,
  requests    BIGINT,
  tokens      BIGINT,
  cost_usd    NUMERIC,
  credit_cost NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    (created_at AT TIME ZONE 'UTC')::DATE                         AS day,
    COUNT(*)::BIGINT                                              AS requests,
    SUM(COALESCE(total_tokens, 0))::BIGINT                        AS tokens,
    ROUND(SUM(COALESCE(cost_usd, 0))::NUMERIC, 8)                 AS cost_usd,
    ROUND(SUM(COALESCE(credit_cost, 0))::NUMERIC, 8)              AS credit_cost
  FROM public.usage_events
  WHERE user_id = p_user_id
    AND created_at >= p_since
  GROUP BY 1
  ORDER BY 1;
$$;
