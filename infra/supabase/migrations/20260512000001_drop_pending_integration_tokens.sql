-- Drop the cloud→desktop OAuth handoff table.
--
-- The desktop-local encrypted token store has been removed; cloud-ai is once
-- again the single source of truth for OAuth tokens (now with column-level
-- encryption per the previous migration). The pending_integration_tokens
-- table and its TTL cleanup function are no longer needed.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'pending_integration_tokens'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.pending_integration_tokens;
  END IF;
END$$;

DROP TABLE IF EXISTS public.pending_integration_tokens;
DROP FUNCTION IF EXISTS public.cleanup_expired_pending_integration_tokens();
