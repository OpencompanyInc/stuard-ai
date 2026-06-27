-- Add new columns for richer tool metadata
ALTER TABLE tool_embeddings
ADD COLUMN IF NOT EXISTS schema jsonb DEFAULT '{}',
ADD COLUMN IF NOT EXISTS semantic_hints text[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS kind text DEFAULT 'local',
ADD COLUMN IF NOT EXISTS enabled boolean DEFAULT true;

-- Add indexes for filtering
CREATE INDEX IF NOT EXISTS tool_embeddings_category_idx ON tool_embeddings(category);
CREATE INDEX IF NOT EXISTS tool_embeddings_kind_idx ON tool_embeddings(kind);
CREATE INDEX IF NOT EXISTS tool_embeddings_enabled_idx ON tool_embeddings(enabled);

-- Add RPC function for semantic search with filters
CREATE OR REPLACE FUNCTION search_tools(
  query_embedding vector(3072),
  match_threshold float DEFAULT 0.25,
  match_count int DEFAULT 15,
  filter_category text DEFAULT NULL,
  filter_kind text DEFAULT NULL,
  enabled_only boolean DEFAULT true
)
RETURNS TABLE (
  name text,
  description text,
  category text,
  kind text,
  schema jsonb,
  semantic_hints text[],
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.name,
    t.description,
    t.category,
    t.kind,
    t.schema,
    t.semantic_hints,
    1 - (t.embedding <=> query_embedding) AS similarity
  FROM tool_embeddings t
  WHERE
    (enabled_only = false OR t.enabled = true)
    AND (filter_category IS NULL OR t.category = filter_category)
    AND (filter_kind IS NULL OR t.kind = filter_kind)
    AND (1 - (t.embedding <=> query_embedding)) > match_threshold
  ORDER BY t.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
