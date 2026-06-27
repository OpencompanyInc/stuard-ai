-- ============================================
-- Chat Sync Queue
-- ============================================
-- Queues chat events (new messages, title updates) for offline delivery
-- between VM and desktop. Events are delivered immediately when the target
-- is online, or queued here for later delivery when it reconnects.
--
-- Security:
--   - RLS ensures users can only access their own queue entries
--   - Service role (cloud-ai server) can access all entries
--   - Entries auto-expire after 7 days via expiry check in queries
--   - CHECK constraints prevent invalid values for source/target/status/event_type
--   - Payload size is enforced server-side (MAX_CONTENT_LENGTH in chat-sync.ts)
--   - ON DELETE CASCADE removes entries when the user account is deleted

CREATE TABLE IF NOT EXISTS chat_sync_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Which conversation this event belongs to
  conversation_id TEXT NOT NULL,

  -- Event details (constrained to known values only)
  event_type TEXT NOT NULL CHECK (event_type IN ('new_message', 'new_conversation', 'title_update')),
  source TEXT NOT NULL CHECK (source IN ('desktop', 'vm')),
  target TEXT NOT NULL CHECK (target IN ('desktop', 'vm')),

  -- Full event payload (role, content, metadata, etc.)
  -- Capped at ~100KB by server-side sanitization before insert
  payload JSONB NOT NULL DEFAULT '{}',

  -- Delivery state
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'expired')),

  -- Expiration (auto-expire after 7 days)
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Compound index for efficient queue drain: fetch pending events for a user+target
CREATE INDEX idx_chat_sync_queue_user_target ON chat_sync_queue(user_id, target, status) WHERE status = 'pending';
-- Index for expiry cleanup
CREATE INDEX idx_chat_sync_queue_expires ON chat_sync_queue(expires_at) WHERE status = 'pending';

-- ─── Row Level Security ────────────────────────────────────────────────────

ALTER TABLE chat_sync_queue ENABLE ROW LEVEL SECURITY;

-- Users can only see/modify their own queue entries (enforced at DB level)
CREATE POLICY "users_own_chat_sync" ON chat_sync_queue
  FOR ALL USING (auth.uid() = user_id);

-- Service role (cloud-ai server) needs full access for queue management
CREATE POLICY "service_role_chat_sync" ON chat_sync_queue
  FOR ALL TO service_role USING (true);

-- ─── Periodic Cleanup ──────────────────────────────────────────────────────
-- Mark expired pending events. Run via pg_cron or app-level sweep.

CREATE OR REPLACE FUNCTION expire_chat_sync_queue()
RETURNS void AS $$
BEGIN
  UPDATE chat_sync_queue
  SET status = 'expired'
  WHERE status = 'pending' AND expires_at < now();

  -- Hard-delete events older than 30 days (delivered or expired)
  DELETE FROM chat_sync_queue
  WHERE status IN ('delivered', 'expired')
    AND created_at < now() - interval '30 days';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
