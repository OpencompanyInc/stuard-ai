ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_run_id_fkey;

ALTER TABLE public.messages
  DROP COLUMN IF EXISTS run_id;

DROP TABLE IF EXISTS public.automation_runs;

DROP TABLE IF EXISTS public.user_settings;
