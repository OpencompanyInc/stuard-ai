-- Memory Sync Table
-- Stores encrypted sync packets for E2E encrypted cloud sync

CREATE TABLE IF NOT EXISTS memory_sync (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('conversation', 'message', 'segment', 'space', 'space_item')),
    entity_id TEXT NOT NULL,
    operation TEXT NOT NULL CHECK (operation IN ('create', 'update', 'delete')),
    encrypted_data TEXT NOT NULL,  -- Base64-encoded encrypted JSON blob
    checksum TEXT NOT NULL,  -- SHA256 truncated for integrity verification
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient sync queries
CREATE INDEX IF NOT EXISTS idx_memory_sync_user_id ON memory_sync(user_id);
CREATE INDEX IF NOT EXISTS idx_memory_sync_created_at ON memory_sync(created_at);
CREATE INDEX IF NOT EXISTS idx_memory_sync_entity ON memory_sync(user_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_memory_sync_device ON memory_sync(user_id, device_id);

-- RLS policies
ALTER TABLE memory_sync ENABLE ROW LEVEL SECURITY;

-- Users can only access their own sync data
CREATE POLICY "Users can view own sync data" ON memory_sync
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own sync data" ON memory_sync
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own sync data" ON memory_sync
    FOR DELETE USING (auth.uid() = user_id);

-- Cleanup old sync packets (keep last 30 days)
-- This can be run periodically via a cron job or edge function
CREATE OR REPLACE FUNCTION cleanup_old_sync_packets()
RETURNS void AS $$
BEGIN
    DELETE FROM memory_sync
    WHERE created_at < NOW() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON TABLE memory_sync IS 'E2E encrypted sync packets for local-first memory system';
COMMENT ON COLUMN memory_sync.encrypted_data IS 'AES-256-GCM encrypted JSON blob, base64 encoded';
COMMENT ON COLUMN memory_sync.checksum IS 'Truncated SHA256 of plaintext for integrity verification';
