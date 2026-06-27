-- Wakeword Enrollments: tracks per-user custom wakeword fine-tuning jobs
-- Custom wakeword is a paid feature (STARTER+). The cloud server fine-tunes
-- a DS-CNN model using the user's voice samples and stores the resulting
-- NumPy weights in GCS.

-- ============================================
-- Wakeword enrollments table
-- ============================================
CREATE TABLE IF NOT EXISTS wakeword_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Enrollment configuration
  wake_phrase TEXT NOT NULL DEFAULT 'hey stuard',

  -- Job state
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message TEXT,

  -- Storage reference (GCS object path for the .npz weights)
  weights_object TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One enrollment per user (most recent wins) — index for fast lookup
CREATE UNIQUE INDEX IF NOT EXISTS idx_wakeword_enrollments_user
  ON wakeword_enrollments(user_id);

CREATE INDEX IF NOT EXISTS idx_wakeword_enrollments_status
  ON wakeword_enrollments(status) WHERE status = 'processing';

-- ============================================
-- Timestamp trigger
-- ============================================
CREATE OR REPLACE FUNCTION update_wakeword_enrollment_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_wakeword_enrollment_updated ON wakeword_enrollments;
CREATE TRIGGER trg_wakeword_enrollment_updated
BEFORE UPDATE ON wakeword_enrollments
FOR EACH ROW EXECUTE FUNCTION update_wakeword_enrollment_timestamp();

-- ============================================
-- RLS
-- ============================================
ALTER TABLE wakeword_enrollments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wakeword_enrollments_user_policy ON wakeword_enrollments;
CREATE POLICY wakeword_enrollments_user_policy ON wakeword_enrollments
  FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS wakeword_enrollments_service_policy ON wakeword_enrollments;
CREATE POLICY wakeword_enrollments_service_policy ON wakeword_enrollments
  FOR ALL USING (auth.role() = 'service_role');
