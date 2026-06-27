-- Support tickets: user-submitted help requests with threaded replies
CREATE TABLE IF NOT EXISTS support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  name TEXT,
  subject TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general' CHECK (category IN (
    'general', 'billing', 'technical', 'account', 'feature_request', 'bug_report', 'other'
  )),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
    'open', 'pending', 'awaiting_user', 'resolved', 'closed'
  )),
  assigned_to TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_by TEXT NOT NULL DEFAULT 'user' CHECK (last_message_by IN ('user', 'staff')),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_user_id ON support_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_email ON support_tickets(lower(email));
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_priority ON support_tickets(priority);
CREATE INDEX IF NOT EXISTS idx_support_tickets_created_at ON support_tickets(created_at DESC);

CREATE OR REPLACE FUNCTION update_support_tickets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_support_tickets_updated_at ON support_tickets;
CREATE TRIGGER trigger_support_tickets_updated_at
  BEFORE UPDATE ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION update_support_tickets_updated_at();

ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own tickets" ON support_tickets
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users insert own tickets" ON support_tickets
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own open tickets" ON support_tickets
  FOR UPDATE USING (auth.uid() = user_id AND status NOT IN ('resolved', 'closed'));

CREATE POLICY "Service role full access tickets" ON support_tickets
  FOR ALL USING (auth.role() = 'service_role');


-- Threaded replies between user and support staff
CREATE TABLE IF NOT EXISTS support_ticket_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  author_type TEXT NOT NULL CHECK (author_type IN ('user', 'staff')),
  author_name TEXT,
  content TEXT NOT NULL,
  attachments JSONB NOT NULL DEFAULT '[]',
  internal_note BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_ticket_id
  ON support_ticket_messages(ticket_id, created_at);

ALTER TABLE support_ticket_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own ticket messages" ON support_ticket_messages
  FOR SELECT USING (
    NOT internal_note AND EXISTS (
      SELECT 1 FROM support_tickets t
      WHERE t.id = support_ticket_messages.ticket_id AND t.user_id = auth.uid()
    )
  );

CREATE POLICY "Users add messages to own tickets" ON support_ticket_messages
  FOR INSERT WITH CHECK (
    author_type = 'user'
    AND auth.uid() = user_id
    AND internal_note = FALSE
    AND EXISTS (
      SELECT 1 FROM support_tickets t
      WHERE t.id = support_ticket_messages.ticket_id
        AND t.user_id = auth.uid()
        AND t.status NOT IN ('resolved', 'closed')
    )
  );

CREATE POLICY "Service role full access ticket messages" ON support_ticket_messages
  FOR ALL USING (auth.role() = 'service_role');


-- Keep ticket.last_message_at / last_message_by / status in sync on new messages
CREATE OR REPLACE FUNCTION bump_support_ticket_on_message()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.internal_note THEN
    RETURN NEW;
  END IF;
  UPDATE support_tickets
  SET last_message_at = NEW.created_at,
      last_message_by = NEW.author_type,
      status = CASE
        WHEN NEW.author_type = 'user' AND status IN ('resolved', 'closed') THEN 'open'
        WHEN NEW.author_type = 'user' AND status = 'awaiting_user' THEN 'pending'
        WHEN NEW.author_type = 'staff' AND status = 'open' THEN 'awaiting_user'
        ELSE status
      END,
      updated_at = NOW()
  WHERE id = NEW.ticket_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_support_ticket_message_insert ON support_ticket_messages;
CREATE TRIGGER trigger_support_ticket_message_insert
  AFTER INSERT ON support_ticket_messages
  FOR EACH ROW EXECUTE FUNCTION bump_support_ticket_on_message();
