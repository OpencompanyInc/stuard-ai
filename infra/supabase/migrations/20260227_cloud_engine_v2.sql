-- Cloud Engine V2: Snapshots, Metrics, Terminal Sessions, Health Monitoring
-- Builds on top of 20260226_cloud_engines.sql

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. vm_snapshots — User-created backups
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.vm_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'creating'
    CHECK (status IN ('creating', 'ready', 'restoring', 'failed', 'deleted')),
  size_bytes BIGINT DEFAULT 0,
  gcs_object_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_vm_snapshots_user_id ON public.vm_snapshots(user_id);
CREATE INDEX IF NOT EXISTS idx_vm_snapshots_status ON public.vm_snapshots(status);
CREATE INDEX IF NOT EXISTS idx_vm_snapshots_created_at ON public.vm_snapshots(created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. vm_metrics_history — Time-series CPU/RAM/disk/network, sampled every 5min
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.vm_metrics_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cpu_percent NUMERIC(5, 2) NOT NULL DEFAULT 0,
  memory_percent NUMERIC(5, 2) NOT NULL DEFAULT 0,
  memory_used_mb INTEGER NOT NULL DEFAULT 0,
  memory_total_mb INTEGER NOT NULL DEFAULT 0,
  disk_percent NUMERIC(5, 2) NOT NULL DEFAULT 0,
  disk_used_gb NUMERIC(8, 2) NOT NULL DEFAULT 0,
  disk_total_gb NUMERIC(8, 2) NOT NULL DEFAULT 0,
  network_rx_bytes BIGINT NOT NULL DEFAULT 0,
  network_tx_bytes BIGINT NOT NULL DEFAULT 0,
  sampled_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vm_metrics_user_id ON public.vm_metrics_history(user_id);
CREATE INDEX IF NOT EXISTS idx_vm_metrics_sampled_at ON public.vm_metrics_history(sampled_at DESC);
CREATE INDEX IF NOT EXISTS idx_vm_metrics_user_sampled ON public.vm_metrics_history(user_id, sampled_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. terminal_sessions — Track active/closed terminal sessions
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.terminal_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_name TEXT DEFAULT 'default',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'closed')),
  cols INTEGER DEFAULT 80,
  rows INTEGER DEFAULT 24,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_terminal_sessions_user_id ON public.terminal_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_terminal_sessions_status ON public.terminal_sessions(status);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. ALTER cloud_engines — Add health monitoring columns
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.cloud_engines
  ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS health_status TEXT DEFAULT 'unknown'
    CHECK (health_status IN ('healthy', 'unhealthy', 'unreachable', 'unknown')),
  ADD COLUMN IF NOT EXISTS external_ip TEXT,
  ADD COLUMN IF NOT EXISTS agent_version TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RLS Policies for new tables
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.vm_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vm_metrics_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.terminal_sessions ENABLE ROW LEVEL SECURITY;

-- vm_snapshots
CREATE POLICY "Users can read own snapshots" ON public.vm_snapshots
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage snapshots" ON public.vm_snapshots
  FOR ALL USING (auth.role() = 'service_role');

-- vm_metrics_history
CREATE POLICY "Users can read own metrics" ON public.vm_metrics_history
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage metrics" ON public.vm_metrics_history
  FOR ALL USING (auth.role() = 'service_role');

-- terminal_sessions
CREATE POLICY "Users can read own terminal sessions" ON public.terminal_sessions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage terminal sessions" ON public.terminal_sessions
  FOR ALL USING (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Comments
-- ─────────────────────────────────────────────────────────────────────────────

COMMENT ON TABLE public.vm_snapshots IS 'User-created VM backups stored in GCS';
COMMENT ON TABLE public.vm_metrics_history IS 'Time-series VM metrics sampled every 5 minutes';
COMMENT ON TABLE public.terminal_sessions IS 'Active and historical terminal sessions on user VMs';
COMMENT ON COLUMN public.cloud_engines.last_heartbeat_at IS 'Last heartbeat received from the VM agent';
COMMENT ON COLUMN public.cloud_engines.health_status IS 'VM health: healthy (heartbeat recent), unhealthy (stale), unreachable (no heartbeat)';
COMMENT ON COLUMN public.cloud_engines.external_ip IS 'External IP address of the VM';
COMMENT ON COLUMN public.cloud_engines.agent_version IS 'Version of the Stuard VM agent running on the VM';
