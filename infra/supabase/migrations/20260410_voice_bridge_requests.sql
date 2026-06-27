-- Voice bridge requests: cloud signals desktop to open a per-call WebSocket bridge
-- for voice tool execution (see apps/cloud-ai voice-bridge-manager + desktop cloud-webhooks).

CREATE TABLE IF NOT EXISTS public.voice_bridge_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('telnyx', 'discord')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'connected', 'closed', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '1 hour'),
  CONSTRAINT voice_bridge_requests_session_unique UNIQUE (session_id)
);

CREATE INDEX IF NOT EXISTS idx_voice_bridge_requests_user_created
  ON public.voice_bridge_requests(user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.touch_voice_bridge_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_voice_bridge_requests_updated ON public.voice_bridge_requests;
CREATE TRIGGER trg_voice_bridge_requests_updated
BEFORE UPDATE ON public.voice_bridge_requests
FOR EACH ROW
EXECUTE FUNCTION public.touch_voice_bridge_updated_at();

ALTER TABLE public.voice_bridge_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS voice_bridge_requests_user_policy ON public.voice_bridge_requests;
CREATE POLICY voice_bridge_requests_user_policy ON public.voice_bridge_requests
  FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS voice_bridge_requests_service_policy ON public.voice_bridge_requests;
CREATE POLICY voice_bridge_requests_service_policy ON public.voice_bridge_requests
  FOR ALL USING (auth.role() = 'service_role');

-- Realtime: desktop filters on user_id; FULL helps UPDATE/DELETE filters
ALTER TABLE public.voice_bridge_requests REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'voice_bridge_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.voice_bridge_requests;
  END IF;
END $$;

COMMENT ON TABLE public.voice_bridge_requests IS 'Signals the desktop app to open a WebSocket bridge for a live voice session (Telnyx/Discord).';
