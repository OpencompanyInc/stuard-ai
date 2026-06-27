-- Cloud Engines: VM provisioning, storage tracking, and compute billing
-- Supports one dedicated cloud VM per user with hot/cold storage sync

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. cloud_engines — One VM per user
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.cloud_engines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  instance_name TEXT NOT NULL,
  zone TEXT NOT NULL DEFAULT 'us-central1-a',
  machine_type TEXT NOT NULL DEFAULT 'e2-standard-2',
  disk_size_gb INTEGER NOT NULL DEFAULT 10,
  status TEXT NOT NULL DEFAULT 'provisioning'
    CHECK (status IN ('provisioning', 'stopped', 'starting', 'running', 'stopping', 'deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  stopped_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  CONSTRAINT cloud_engines_user_unique UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_cloud_engines_user_id ON public.cloud_engines(user_id);
CREATE INDEX IF NOT EXISTS idx_cloud_engines_status ON public.cloud_engines(status);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. storage_usage — Per-user storage tracking
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.storage_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  hot_storage_gb INTEGER NOT NULL DEFAULT 0,
  cold_storage_bytes BIGINT NOT NULL DEFAULT 0,
  backup_object_name TEXT,
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT storage_usage_user_unique UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_storage_usage_user_id ON public.storage_usage(user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. compute_billing_events — Hourly billing deductions
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.compute_billing_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('compute', 'hot_storage', 'cold_storage')),
  credits_deducted NUMERIC(12, 4) NOT NULL DEFAULT 0,
  details JSONB DEFAULT '{}',
  billing_hour TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT compute_billing_unique_event UNIQUE (user_id, event_type, billing_hour)
);

CREATE INDEX IF NOT EXISTS idx_compute_billing_user_id ON public.compute_billing_events(user_id);
CREATE INDEX IF NOT EXISTS idx_compute_billing_created_at ON public.compute_billing_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_compute_billing_type ON public.compute_billing_events(event_type);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS Policies
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.cloud_engines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storage_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compute_billing_events ENABLE ROW LEVEL SECURITY;

-- cloud_engines: users can read their own, service role can manage all
CREATE POLICY "Users can read own cloud engine" ON public.cloud_engines
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage cloud engines" ON public.cloud_engines
  FOR ALL USING (auth.role() = 'service_role');

-- storage_usage: users can read their own, service role can manage all
CREATE POLICY "Users can read own storage usage" ON public.storage_usage
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage storage usage" ON public.storage_usage
  FOR ALL USING (auth.role() = 'service_role');

-- compute_billing_events: users can read their own, service role can manage all
CREATE POLICY "Users can read own billing events" ON public.compute_billing_events
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage billing events" ON public.compute_billing_events
  FOR ALL USING (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────────────────────────
-- Comments
-- ─────────────────────────────────────────────────────────────────────────────

COMMENT ON TABLE public.cloud_engines IS 'Dedicated cloud VMs for workflow execution, one per user';
COMMENT ON TABLE public.storage_usage IS 'Per-user hot/cold storage tracking for cloud engine data';
COMMENT ON TABLE public.compute_billing_events IS 'Hourly billing deductions for compute and storage resources';
COMMENT ON COLUMN public.cloud_engines.status IS 'VM lifecycle: provisioning → stopped → starting → running → stopping → stopped (or deleted)';
COMMENT ON COLUMN public.compute_billing_events.billing_hour IS 'Truncated hour for idempotent billing — unique per (user, type, hour)';
