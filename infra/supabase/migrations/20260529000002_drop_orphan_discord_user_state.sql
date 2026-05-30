-- Drop the orphaned discord_user_state table.
--
-- It was created directly against the database (its create migration was never
-- tracked in this repo), holds 0 rows, is referenced nowhere in the codebase,
-- and has no inbound foreign-key dependents. Discord state is handled via
-- external_accounts / user_provider_keys instead.

DROP TABLE IF EXISTS public.discord_user_state;
