-- Ensure billing-related tables publish realtime changes so desktop billing
-- screens can refresh immediately when usage settles mid-run.

ALTER TABLE public.usage_events REPLICA IDENTITY FULL;
ALTER TABLE public.credit_grants REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'usage_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.usage_events;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'credit_grants'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.credit_grants;
  END IF;
END $$;
