-- Ensure SMS queue changes are published to Supabase Realtime.
-- Desktop listening depends on insert/update events for prompt pickup.
--
-- REPLICA IDENTITY FULL is required so UPDATE/DELETE WAL events include
-- all columns. Without it, realtime filters on non-PK columns (like user_id)
-- silently fail for UPDATE and DELETE events.

ALTER TABLE public.sms_inbox_queue REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'sms_inbox_queue'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sms_inbox_queue;
  END IF;
END $$;
