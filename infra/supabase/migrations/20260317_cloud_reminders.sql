-- Cloud Reminders: per-reminder SMS/WhatsApp delivery
-- When a reminder is created with cloud_notify=true, a row is inserted here.
-- The cloud-ai cron polls for due rows and delivers via SMS/WhatsApp.

-- ============================================
-- Cloud reminders table
-- ============================================
CREATE TABLE IF NOT EXISTS cloud_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Reminder content
  title TEXT NOT NULL,
  message TEXT,

  -- Scheduling (stored in UTC)
  remind_at TIMESTAMPTZ NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',

  -- Delivery
  delivery_method TEXT NOT NULL DEFAULT 'sms'
    CHECK (delivery_method IN ('sms', 'whatsapp', 'both')),

  -- Recurrence (null = one-time)
  recurrence JSONB,
  recurrence_count INTEGER NOT NULL DEFAULT 0,

  -- State
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed', 'cancelled', 'expired')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  last_attempt_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ,
  error_message TEXT,
  sent_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cloud_reminders_due
  ON cloud_reminders(remind_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_cloud_reminders_user
  ON cloud_reminders(user_id, status, remind_at);
CREATE INDEX IF NOT EXISTS idx_cloud_reminders_retry
  ON cloud_reminders(next_attempt_at)
  WHERE status = 'failed' AND attempts < max_attempts;

-- ============================================
-- Timestamp trigger
-- ============================================
CREATE OR REPLACE FUNCTION update_cloud_reminder_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cloud_reminder_updated ON cloud_reminders;
CREATE TRIGGER trg_cloud_reminder_updated
BEFORE UPDATE ON cloud_reminders
FOR EACH ROW EXECUTE FUNCTION update_cloud_reminder_timestamp();

-- ============================================
-- RLS
-- ============================================
ALTER TABLE cloud_reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cloud_reminders_user_policy ON cloud_reminders;
CREATE POLICY cloud_reminders_user_policy ON cloud_reminders
  FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS cloud_reminders_service_policy ON cloud_reminders;
CREATE POLICY cloud_reminders_service_policy ON cloud_reminders
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================
-- Claim due reminders for batch processing
-- ============================================
CREATE OR REPLACE FUNCTION claim_due_reminders(p_limit INTEGER DEFAULT 50)
RETURNS SETOF cloud_reminders AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  UPDATE cloud_reminders
  SET
    status = 'sent',
    attempts = attempts + 1,
    last_attempt_at = now(),
    updated_at = now()
  WHERE id IN (
    SELECT r.id FROM cloud_reminders r
    WHERE
      (r.status = 'pending' AND r.remind_at <= now())
      OR
      (r.status = 'failed' AND r.attempts < r.max_attempts
       AND r.next_attempt_at IS NOT NULL AND r.next_attempt_at <= now())
    ORDER BY r.remind_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  RETURNING *;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Mark sent / failed helpers
-- ============================================
CREATE OR REPLACE FUNCTION complete_reminder(p_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE cloud_reminders
  SET status = 'sent', sent_at = now(), error_message = NULL, updated_at = now()
  WHERE id = p_id AND (auth.role() = 'service_role' OR user_id = auth.uid());
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION fail_reminder(p_id UUID, p_error TEXT DEFAULT NULL)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE cloud_reminders
  SET
    status = CASE WHEN attempts >= max_attempts THEN 'expired' ELSE 'failed' END,
    error_message = LEFT(COALESCE(p_error, 'delivery_failed'), 1000),
    next_attempt_at = CASE
      WHEN attempts >= max_attempts THEN NULL
      ELSE now() + make_interval(secs => LEAST(300, GREATEST(15, attempts * 30)))
    END,
    updated_at = now()
  WHERE id = p_id AND (auth.role() = 'service_role' OR user_id = auth.uid());
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
