-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger Registrations Table
-- Durable store for native trigger registrations (social webhooks + Google
-- watch channels). cloud-ai keeps these in in-memory maps for fast webhook
-- fan-out; this table is the source of truth that survives Cloud Run
-- restarts/redeploys — registrations are restored from here on boot.
-- Service-role only: rows carry watch-channel tokens and history cursors.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS trigger_registrations (
  kind        text NOT NULL CHECK (kind IN ('social', 'gmail', 'drive')),
  key         text NOT NULL,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workflow_id text NOT NULL,
  trigger_id  text NOT NULL,
  type        text NOT NULL,
  data        jsonb NOT NULL DEFAULT '{}',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, key)
);

CREATE INDEX IF NOT EXISTS idx_trigger_registrations_user ON trigger_registrations(user_id);

ALTER TABLE trigger_registrations ENABLE ROW LEVEL SECURITY;

-- Backend (service role) only — no user-facing policies on purpose.
CREATE POLICY "service_role_all_trigger_registrations" ON trigger_registrations
  FOR ALL
  USING (auth.role() = 'service_role');
