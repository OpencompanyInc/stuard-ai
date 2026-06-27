ALTER TABLE vm_deployments
  ADD COLUMN IF NOT EXISTS source_workflow_id text;

ALTER TABLE vm_deployments
  ADD COLUMN IF NOT EXISTS trigger_bindings jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_vm_deployments_source_workflow_id
  ON vm_deployments(user_id, source_workflow_id);
