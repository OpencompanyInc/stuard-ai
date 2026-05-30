-- Production hardening from Supabase advisor findings.
--
-- 1) Drop two confirmed duplicate indexes on usage_events (kept the idx_* names).
-- 2) Pin a non-mutable search_path on every public function WE own that lacks
--    one, closing all `function_search_path_mutable` security warnings without
--    changing name resolution (public stays on the path, so unqualified refs
--    keep working). Extension-owned functions (e.g. the `vector` extension,
--    which is installed in public) are skipped — we can't ALTER them.

DROP INDEX IF EXISTS public.usage_events_user_created_idx;
DROP INDEX IF EXISTS public.usage_events_user_time_idx;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.objid = p.oid AND d.deptype = 'e'   -- skip extension-owned funcs
      )
      AND NOT EXISTS (
        SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) AS cfg
        WHERE cfg LIKE 'search_path=%'
      )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', r.sig);
  END LOOP;
END $$;
