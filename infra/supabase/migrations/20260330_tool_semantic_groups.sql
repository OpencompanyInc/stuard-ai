-- Add semantic_groups column for keyword-based tool injection.
-- Each tool can belong to multiple domain groups (e.g. ['terminal', 'shell', 'cli']).
-- Loaded once on startup to build an in-memory keyword→tools map.
ALTER TABLE tool_embeddings
ADD COLUMN IF NOT EXISTS semantic_groups text[] DEFAULT '{}';

-- GIN index for array containment queries (@> / &&)
CREATE INDEX IF NOT EXISTS tool_embeddings_semantic_groups_idx
ON tool_embeddings USING GIN (semantic_groups);
