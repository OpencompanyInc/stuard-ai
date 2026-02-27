-- Add timezone to profiles for cron scheduling and display
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT NULL;
COMMENT ON COLUMN public.profiles.timezone IS 'IANA timezone string (e.g. America/New_York). NULL = auto-detect from client.';

-- Add sync_integrations flag for auto-syncing OAuth tokens across devices
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS sync_integrations BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN public.profiles.sync_integrations IS 'When true, OAuth integration tokens are synced to Supabase for multi-device access.';
