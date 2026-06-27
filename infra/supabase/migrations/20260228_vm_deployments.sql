-- ─────────────────────────────────────────────────────────────────────────────
-- VM Deployments Table
-- Tracks workflow/script/project deployments to Cloud VMs
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vm_deployments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name           text NOT NULL,
  kind           text NOT NULL DEFAULT 'workflow' CHECK (kind IN ('workflow', 'script', 'project')),
  description    text,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'uploading', 'deploying', 'running', 'stopped', 'failed', 'completed')),
  gcs_object_name text,
  env_vars       jsonb NOT NULL DEFAULT '{}',
  auto_restart   boolean NOT NULL DEFAULT true,
  schedule       text,  -- cron expression
  pid            integer,
  logs_tail      text,
  error_message  text,
  started_at     timestamptz,
  stopped_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Index for fast lookup by user
CREATE INDEX IF NOT EXISTS idx_vm_deployments_user_id ON vm_deployments(user_id);

-- Index for finding running deployments
CREATE INDEX IF NOT EXISTS idx_vm_deployments_status ON vm_deployments(user_id, status);

-- RLS policies
ALTER TABLE vm_deployments ENABLE ROW LEVEL SECURITY;

-- Users can see and manage their own deployments
CREATE POLICY "users_own_deployments" ON vm_deployments
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Service role has full access (for backend operations)
CREATE POLICY "service_role_all_deployments" ON vm_deployments
  FOR ALL
  USING (auth.role() = 'service_role');

-- Updated at trigger
CREATE OR REPLACE FUNCTION update_vm_deployments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_vm_deployments_updated_at
  BEFORE UPDATE ON vm_deployments
  FOR EACH ROW
  EXECUTE FUNCTION update_vm_deployments_updated_at();
