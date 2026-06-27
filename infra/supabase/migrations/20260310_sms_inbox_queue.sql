-- SMS Inbox Queue for desktop-owned SMS execution
-- Cloud-ai enqueues inbound SMS items. The desktop app claims, executes,
-- replies via cloud/Telnyx, then redacts/completes the queue item.

-- ============================================
-- SMS user state
-- ============================================
CREATE TABLE IF NOT EXISTS sms_user_state (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'agent' CHECK (mode IN ('agent', 'proactive')),
  preferred_model TEXT NOT NULL DEFAULT 'balanced' CHECK (preferred_model IN ('fast', 'balanced', 'smart', 'research')),
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  last_reply_to_phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sms_user_state_updated_at ON sms_user_state(updated_at DESC);

-- ============================================
-- SMS inbox queue
-- ============================================
CREATE TABLE IF NOT EXISTS sms_inbox_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  provider TEXT NOT NULL DEFAULT 'telnyx',
  provider_message_id TEXT,

  from_phone TEXT,
  reply_to_phone TEXT,
  message_text TEXT,

  mode TEXT NOT NULL DEFAULT 'agent' CHECK (mode IN ('agent', 'proactive')),
  preferred_model TEXT NOT NULL DEFAULT 'balanced' CHECK (preferred_model IN ('fast', 'balanced', 'smart', 'research')),
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'completed', 'failed', 'expired')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  claimed_at TIMESTAMPTZ,
  claimed_by TEXT,
  last_attempt_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  error_message TEXT,

  reply_sent_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (provider, provider_message_id)
);

CREATE INDEX IF NOT EXISTS idx_sms_inbox_queue_user_status ON sms_inbox_queue(user_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_sms_inbox_queue_next_attempt ON sms_inbox_queue(user_id, next_attempt_at) WHERE status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS idx_sms_inbox_queue_claimed_at ON sms_inbox_queue(claimed_at) WHERE status = 'claimed';

-- ============================================
-- Timestamp helpers
-- ============================================
CREATE OR REPLACE FUNCTION update_sms_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sms_user_state_updated ON sms_user_state;
CREATE TRIGGER trg_sms_user_state_updated
BEFORE UPDATE ON sms_user_state
FOR EACH ROW
EXECUTE FUNCTION update_sms_timestamp();

DROP TRIGGER IF EXISTS trg_sms_inbox_queue_updated ON sms_inbox_queue;
CREATE TRIGGER trg_sms_inbox_queue_updated
BEFORE UPDATE ON sms_inbox_queue
FOR EACH ROW
EXECUTE FUNCTION update_sms_timestamp();

-- ============================================
-- RLS
-- ============================================
ALTER TABLE sms_user_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_inbox_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sms_user_state_user_policy ON sms_user_state;
CREATE POLICY sms_user_state_user_policy ON sms_user_state
  FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS sms_inbox_queue_user_policy ON sms_inbox_queue;
CREATE POLICY sms_inbox_queue_user_policy ON sms_inbox_queue
  FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS sms_user_state_service_policy ON sms_user_state;
CREATE POLICY sms_user_state_service_policy ON sms_user_state
  FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS sms_inbox_queue_service_policy ON sms_inbox_queue;
CREATE POLICY sms_inbox_queue_service_policy ON sms_inbox_queue
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================
-- Queue functions
-- ============================================
CREATE OR REPLACE FUNCTION claim_next_sms_item(
  p_user_id UUID,
  p_consumer_id TEXT DEFAULT NULL
)
RETURNS SETOF sms_inbox_queue AS $$
DECLARE
  claimed sms_inbox_queue%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE sms_inbox_queue q
  SET
    status = 'claimed',
    claimed_at = now(),
    claimed_by = COALESCE(NULLIF(p_consumer_id, ''), q.claimed_by),
    attempts = q.attempts + 1,
    last_attempt_at = now(),
    error_message = NULL,
    updated_at = now()
  WHERE q.id = (
    SELECT inner_q.id
    FROM sms_inbox_queue inner_q
    WHERE inner_q.user_id = p_user_id
      AND inner_q.expires_at > now()
      AND (
        inner_q.status = 'pending'
        OR (
          inner_q.status = 'failed'
          AND inner_q.attempts < inner_q.max_attempts
          AND inner_q.next_attempt_at <= now()
        )
        OR (
          inner_q.status = 'claimed'
          AND inner_q.claimed_at IS NOT NULL
          AND inner_q.claimed_at < now() - interval '10 minutes'
        )
      )
    ORDER BY inner_q.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING * INTO claimed;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN NEXT claimed;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION fail_sms_item(
  p_queue_id UUID,
  p_error_message TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE sms_inbox_queue
  SET
    status = CASE
      WHEN attempts >= max_attempts THEN 'expired'
      ELSE 'failed'
    END,
    claimed_at = NULL,
    claimed_by = NULL,
    error_message = LEFT(COALESCE(p_error_message, 'processing_failed'), 1000),
    next_attempt_at = CASE
      WHEN attempts >= max_attempts THEN next_attempt_at
      ELSE now() + make_interval(secs => LEAST(900, GREATEST(30, attempts * 30)))
    END,
    updated_at = now()
  WHERE id = p_queue_id
    AND (
      auth.role() = 'service_role'
      OR user_id = auth.uid()
    );

  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION complete_sms_item(
  p_queue_id UUID,
  p_redact_payload BOOLEAN DEFAULT TRUE
)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE sms_inbox_queue
  SET
    status = 'completed',
    processed_at = now(),
    claimed_at = NULL,
    claimed_by = NULL,
    error_message = NULL,
    from_phone = CASE WHEN p_redact_payload THEN '[redacted]' ELSE from_phone END,
    reply_to_phone = CASE WHEN p_redact_payload THEN '[redacted]' ELSE reply_to_phone END,
    message_text = CASE WHEN p_redact_payload THEN '[redacted]' ELSE message_text END,
    metadata = CASE
      WHEN p_redact_payload THEN jsonb_build_object('redacted', true, 'provider', provider)
      ELSE metadata
    END,
    updated_at = now()
  WHERE id = p_queue_id
    AND (
      auth.role() = 'service_role'
      OR user_id = auth.uid()
    );

  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION cleanup_sms_queue()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER := 0;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  WITH deleted AS (
    DELETE FROM sms_inbox_queue
    WHERE
      (status = 'completed' AND processed_at IS NOT NULL AND processed_at < now() - interval '1 day')
      OR (status = 'expired' AND updated_at < now() - interval '1 day')
      OR (expires_at <= now() AND status IN ('pending', 'failed', 'claimed'))
    RETURNING 1
  )
  SELECT COUNT(*) INTO deleted_count FROM deleted;

  UPDATE sms_inbox_queue
  SET
    status = 'expired',
    claimed_at = NULL,
    claimed_by = NULL,
    updated_at = now()
  WHERE expires_at <= now()
    AND status IN ('pending', 'failed', 'claimed');

  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
