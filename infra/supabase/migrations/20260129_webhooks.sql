-- Webhook System for Stuard AI
-- Supports: workflow triggers, payment webhooks (Stripe), SMS (Twilio), custom integrations

-- ============================================
-- Webhook Endpoints (user-created webhook URLs)
-- ============================================
CREATE TABLE IF NOT EXISTS webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Identity
  name TEXT NOT NULL,
  slug TEXT NOT NULL, -- URL-friendly identifier (unique per user)
  description TEXT,
  
  -- Configuration
  type TEXT NOT NULL DEFAULT 'custom', -- 'workflow', 'custom', 'integration'
  target_workflow_id TEXT, -- For workflow triggers
  target_workflow_trigger_id TEXT, -- Specific trigger ID within the workflow
  
  -- Security
  secret TEXT NOT NULL, -- HMAC signing secret for verification
  allowed_ips TEXT[], -- Optional IP whitelist
  require_signature BOOLEAN DEFAULT false, -- Require HMAC signature
  
  -- State
  is_active BOOLEAN DEFAULT true,
  last_triggered_at TIMESTAMPTZ,
  trigger_count INTEGER DEFAULT 0,
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(user_id, slug)
);

-- Index for fast lookups
CREATE INDEX idx_webhooks_user_id ON webhooks(user_id);
CREATE INDEX idx_webhooks_slug ON webhooks(slug);
CREATE INDEX idx_webhooks_active ON webhooks(is_active) WHERE is_active = true;

-- ============================================
-- Webhook Events (audit log of all received webhooks)
-- ============================================
CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id UUID REFERENCES webhooks(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Request info
  source_ip TEXT,
  method TEXT DEFAULT 'POST',
  path TEXT,
  headers JSONB,
  query_params JSONB,
  body JSONB,
  raw_body TEXT, -- Original body for signature verification
  
  -- Processing
  status TEXT DEFAULT 'received', -- 'received', 'verified', 'processing', 'delivered', 'failed', 'rejected'
  error_message TEXT,
  
  -- Response
  response_status INTEGER,
  response_body JSONB,
  
  -- Delivery tracking
  delivered_to TEXT, -- 'desktop', 'queued', 'workflow'
  delivery_attempts INTEGER DEFAULT 0,
  delivered_at TIMESTAMPTZ,
  
  -- Timing
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for event queries
CREATE INDEX idx_webhook_events_webhook_id ON webhook_events(webhook_id);
CREATE INDEX idx_webhook_events_user_id ON webhook_events(user_id);
CREATE INDEX idx_webhook_events_status ON webhook_events(status);
CREATE INDEX idx_webhook_events_created_at ON webhook_events(created_at DESC);

-- ============================================
-- Webhook Providers (Stripe, Twilio, GitHub, etc.)
-- ============================================
CREATE TABLE IF NOT EXISTS webhook_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Provider identity
  provider TEXT NOT NULL, -- 'stripe', 'twilio', 'github', 'sendgrid', etc.
  name TEXT, -- User-friendly name
  
  -- Configuration
  webhook_secret TEXT, -- Provider's webhook signing secret
  config JSONB DEFAULT '{}', -- Provider-specific settings
  
  -- Event routing
  event_mappings JSONB DEFAULT '{}', -- Map provider events to workflows/actions
  -- Example: { "payment_intent.succeeded": { "workflow_id": "abc", "action": "notify" } }
  
  -- State
  is_active BOOLEAN DEFAULT true,
  last_event_at TIMESTAMPTZ,
  event_count INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(user_id, provider)
);

CREATE INDEX idx_webhook_providers_user_id ON webhook_providers(user_id);
CREATE INDEX idx_webhook_providers_provider ON webhook_providers(provider);

-- ============================================
-- Webhook Queue (for offline delivery)
-- ============================================
CREATE TABLE IF NOT EXISTS webhook_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  webhook_id UUID REFERENCES webhooks(id) ON DELETE SET NULL,
  event_id UUID REFERENCES webhook_events(id) ON DELETE CASCADE,
  
  -- Payload
  payload JSONB NOT NULL,
  
  -- Delivery state
  status TEXT DEFAULT 'pending', -- 'pending', 'processing', 'delivered', 'failed', 'expired'
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 5,
  last_attempt_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ DEFAULT now(),
  error_message TEXT,
  
  -- Expiration
  expires_at TIMESTAMPTZ DEFAULT (now() + interval '7 days'),
  
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_webhook_queue_user_id ON webhook_queue(user_id);
CREATE INDEX idx_webhook_queue_status ON webhook_queue(status) WHERE status = 'pending';
CREATE INDEX idx_webhook_queue_next_attempt ON webhook_queue(next_attempt_at) WHERE status = 'pending';

-- ============================================
-- Functions & Triggers
-- ============================================

-- Update trigger count on webhook
CREATE OR REPLACE FUNCTION update_webhook_trigger_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE webhooks
  SET trigger_count = trigger_count + 1,
      last_triggered_at = now(),
      updated_at = now()
  WHERE id = NEW.webhook_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_webhook_event_count
AFTER INSERT ON webhook_events
FOR EACH ROW
WHEN (NEW.webhook_id IS NOT NULL)
EXECUTE FUNCTION update_webhook_trigger_count();

-- Update provider event count
CREATE OR REPLACE FUNCTION update_provider_event_count()
RETURNS TRIGGER AS $$
BEGIN
  -- This will be called with provider info in metadata
  IF NEW.metadata ? 'provider' THEN
    UPDATE webhook_providers
    SET event_count = event_count + 1,
        last_event_at = now(),
        updated_at = now()
    WHERE user_id = NEW.user_id 
      AND provider = NEW.metadata->>'provider';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Auto-update timestamps
CREATE OR REPLACE FUNCTION update_webhook_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_webhooks_updated
BEFORE UPDATE ON webhooks
FOR EACH ROW
EXECUTE FUNCTION update_webhook_timestamp();

CREATE TRIGGER trg_webhook_providers_updated
BEFORE UPDATE ON webhook_providers
FOR EACH ROW
EXECUTE FUNCTION update_webhook_timestamp();

-- ============================================
-- RLS Policies
-- ============================================

ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_queue ENABLE ROW LEVEL SECURITY;

-- Webhooks: users can only see their own
CREATE POLICY webhooks_user_policy ON webhooks
  FOR ALL USING (auth.uid() = user_id);

-- Events: users can only see their own
CREATE POLICY webhook_events_user_policy ON webhook_events
  FOR ALL USING (auth.uid() = user_id);

-- Providers: users can only see their own
CREATE POLICY webhook_providers_user_policy ON webhook_providers
  FOR ALL USING (auth.uid() = user_id);

-- Queue: users can only see their own
CREATE POLICY webhook_queue_user_policy ON webhook_queue
  FOR ALL USING (auth.uid() = user_id);

-- Service role bypass for cloud-ai
CREATE POLICY webhooks_service_policy ON webhooks
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY webhook_events_service_policy ON webhook_events
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY webhook_providers_service_policy ON webhook_providers
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY webhook_queue_service_policy ON webhook_queue
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================
-- Helper Functions
-- ============================================

-- Generate a secure webhook secret
CREATE OR REPLACE FUNCTION generate_webhook_secret()
RETURNS TEXT AS $$
BEGIN
  RETURN 'whsec_' || encode(gen_random_bytes(32), 'hex');
END;
$$ LANGUAGE plpgsql;

-- Generate a URL-safe slug
CREATE OR REPLACE FUNCTION generate_webhook_slug()
RETURNS TEXT AS $$
BEGIN
  RETURN 'wh_' || encode(gen_random_bytes(12), 'base64url');
END;
$$ LANGUAGE plpgsql;

-- Get pending webhooks for a user (for delivery when they come online)
CREATE OR REPLACE FUNCTION get_pending_webhooks(p_user_id UUID, p_limit INTEGER DEFAULT 50)
RETURNS TABLE (
  id UUID,
  webhook_id UUID,
  event_id UUID,
  payload JSONB,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT q.id, q.webhook_id, q.event_id, q.payload, q.created_at
  FROM webhook_queue q
  WHERE q.user_id = p_user_id
    AND q.status = 'pending'
    AND q.expires_at > now()
  ORDER BY q.created_at ASC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Mark webhook as delivered
CREATE OR REPLACE FUNCTION mark_webhook_delivered(p_queue_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE webhook_queue
  SET status = 'delivered',
      last_attempt_at = now()
  WHERE id = p_queue_id;
  
  UPDATE webhook_events
  SET status = 'delivered',
      delivered_at = now()
  WHERE id = (SELECT event_id FROM webhook_queue WHERE id = p_queue_id);
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
