-- Cloud reminder series linkage.
--
-- Recurring cloud reminders are stored as one pending row at a time: when an
-- occurrence is delivered, the cron inserts the next occurrence as a NEW row
-- with a fresh id. That made a recurring series impossible to stop — there was
-- no stable handle linking the occurrences, so `task_reminders cancel` (which
-- only removed the local Unified Tasks assignment) left the cloud SMS/WhatsApp
-- series firing forever.
--
-- `series_id` is that stable handle. It equals the local Unified Tasks
-- assignment id the reminder was created from, and is carried forward across
-- every recurrence re-insert. Cancelling by (user_id, series_id) stops all
-- pending occurrences of the series at once.

ALTER TABLE cloud_reminders
  ADD COLUMN IF NOT EXISTS series_id TEXT;

CREATE INDEX IF NOT EXISTS idx_cloud_reminders_series
  ON cloud_reminders(user_id, series_id)
  WHERE series_id IS NOT NULL AND status = 'pending';
