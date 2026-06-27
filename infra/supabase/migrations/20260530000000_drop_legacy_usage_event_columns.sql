-- Retire legacy usage_events columns from the early design.
--
-- These were never populated by the current writers (logUsageEvent, debitCredits):
--   * input_tokens / output_tokens  -> 0 on every row; the live system uses
--     prompt_tokens / completion_tokens.
--   * kind                          -> always 'message'; usage categories are now
--     derived from the model prefix (voice:/messaging:/compute/storage/subagent)
--     in get_usage_breakdown().
--
-- No views/matviews depend on usage_events, no indexes reference these columns,
-- and the billing RPCs (get_usage_credit_total / get_credit_usage_total /
-- get_usage_breakdown) use credit_cost/cost_usd/model only.
--
-- model_cost_usd() is an orphaned helper with hardcoded legacy pricing and no
-- callers in the DB or the application.

alter table public.usage_events drop column if exists input_tokens;
alter table public.usage_events drop column if exists output_tokens;
alter table public.usage_events drop column if exists kind;

drop function if exists public.model_cost_usd(bigint, bigint, text);
