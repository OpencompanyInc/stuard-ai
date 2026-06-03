-- ─────────────────────────────────────────────────────────────────────────────
-- Remove the 'script' VM deployment kind
--
-- Scripts can no longer be deployed as automations. Only workflows and projects
-- remain. Any lingering script deployments are removed (they are no longer
-- runnable on the VM since the executor support was dropped), then the kind
-- CHECK constraint is narrowed.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Drop the existing kind check constraint (auto-named on table creation).
ALTER TABLE vm_deployments DROP CONSTRAINT IF EXISTS vm_deployments_kind_check;

-- 2. Remove any leftover script deployments — they can't run anymore.
DELETE FROM vm_deployments WHERE kind = 'script';

-- 3. Re-add the narrowed constraint.
ALTER TABLE vm_deployments
  ADD CONSTRAINT vm_deployments_kind_check CHECK (kind IN ('workflow', 'project'));
