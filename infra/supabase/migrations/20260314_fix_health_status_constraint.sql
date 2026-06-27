-- Fix: Drop and recreate health_status check constraint to include all valid values.
-- The original ADD COLUMN IF NOT EXISTS may have created the constraint with fewer values
-- or the constraint may have been added inconsistently.

-- Drop the existing constraint (ignore if not exists)
DO $$
BEGIN
  ALTER TABLE public.cloud_engines DROP CONSTRAINT IF EXISTS cloud_engines_health_status_check;
EXCEPTION WHEN undefined_object THEN
  -- constraint doesn't exist, that's fine
  NULL;
END $$;

-- Recreate with all valid values
ALTER TABLE public.cloud_engines
  ADD CONSTRAINT cloud_engines_health_status_check
  CHECK (health_status IS NULL OR health_status IN ('healthy', 'unhealthy', 'unreachable', 'unknown'));
