-- Pending Integration Tokens — handoff table for cloud → desktop OAuth flow.
--
-- Cloud-ai's OAuth callback writes a row here after exchanging the auth code
-- for tokens. Desktop subscribes via Supabase Realtime, picks up the row,
-- persists tokens locally (Electron safeStorage), then deletes the row.
--
-- Rows are short-lived (TTL ~10 min). Service role inserts; users can only
-- SELECT/DELETE their own. RLS prevents cross-user reads.

CREATE TABLE IF NOT EXISTS pending_integration_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Identity
  provider        TEXT NOT NULL,
  profile_label   TEXT NOT NULL DEFAULT 'default',
  account_email   TEXT,

  -- Token payload (cleartext; protected by RLS + short TTL)
  access_token    TEXT NOT NULL,
  refresh_token   TEXT,
  expires_at      TIMESTAMPTZ,
  scopes          JSONB NOT NULL DEFAULT '[]'::jsonb,
  meta            JSONB,

  -- Lifecycle
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ttl_expires_at  TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '10 minutes')
);

-- Fast lookup for the desktop's "drain pending on connect" path
CREATE INDEX IF NOT EXISTS idx_pending_int_tokens_user
  ON pending_integration_tokens(user_id, created_at);

-- ============================================
-- RLS
-- ============================================
ALTER TABLE pending_integration_tokens ENABLE ROW LEVEL SECURITY;

-- Service role (cloud-ai) has full access for INSERT/DELETE during handoff
CREATE POLICY pending_int_tokens_service_policy ON pending_integration_tokens
  FOR ALL USING (auth.role() = 'service_role');

-- Authenticated users can SELECT and DELETE their own pending rows
CREATE POLICY pending_int_tokens_user_select ON pending_integration_tokens
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY pending_int_tokens_user_delete ON pending_integration_tokens
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================
-- Realtime publication
-- ============================================
-- Add the table to the supabase_realtime publication so desktop clients
-- receive INSERT events filtered by user_id via RLS.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'pending_integration_tokens'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE pending_integration_tokens;
  END IF;
END$$;

-- ============================================
-- Periodic cleanup of expired rows
-- ============================================
-- Anything past its TTL is no longer useful — desktop didn't pick it up in time
-- and the user will need to retry the OAuth flow. Deleting protects the
-- access tokens from sitting around.
--
-- Pinned search_path so SECURITY DEFINER can't be tricked into resolving
-- objects in a caller-controlled schema. EXECUTE revoked from anon/authenticated
-- since this is maintenance only — never user-facing.
CREATE OR REPLACE FUNCTION cleanup_expired_pending_integration_tokens()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.pending_integration_tokens
   WHERE ttl_expires_at < now();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cleanup_expired_pending_integration_tokens() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_pending_integration_tokens() FROM anon;
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_pending_integration_tokens() FROM authenticated;
