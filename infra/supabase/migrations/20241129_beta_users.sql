-- Beta Users Table for managing access to beta/staging update channels
-- Users with entries in this table can access non-stable update channels

CREATE TABLE IF NOT EXISTS beta_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  access_level TEXT NOT NULL DEFAULT 'beta', -- 'beta', 'staging', 'all'
  invited_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ, -- NULL = never expires
  notes TEXT
);

-- Index for fast email lookups
CREATE INDEX IF NOT EXISTS idx_beta_users_email ON beta_users(email);

-- RLS Policies
ALTER TABLE beta_users ENABLE ROW LEVEL SECURITY;

-- Users can only read their own beta access status
CREATE POLICY "Users can read own beta status" ON beta_users
  FOR SELECT
  USING (LOWER(email) = LOWER(auth.jwt() ->> 'email'));

-- Only service role can insert/update/delete
CREATE POLICY "Service role can manage beta users" ON beta_users
  FOR ALL
  USING (auth.role() = 'service_role');

-- Insert some initial beta users (team members)
-- INSERT INTO beta_users (email, access_level, notes) VALUES
--   ('team@stuard.ai', 'all', 'Team member'),
--   ('beta-tester@example.com', 'beta', 'Beta tester');

COMMENT ON TABLE beta_users IS 'Manages access to beta and staging update channels';
COMMENT ON COLUMN beta_users.access_level IS 'beta = beta channel only, staging = beta + staging, all = all channels';
