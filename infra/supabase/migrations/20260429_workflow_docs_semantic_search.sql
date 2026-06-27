-- Workflow docs table backing the search_workflow_docs agent tool.
-- Mirrors tool_embeddings: gemini-embedding-2-preview produces 3072-dim vectors.

CREATE TABLE IF NOT EXISTS public.workflow_docs (
  id          text PRIMARY KEY,
  title       text NOT NULL,
  content     text NOT NULL,
  keywords    text[] NOT NULL DEFAULT '{}',
  embedding   vector(3072),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.workflow_docs ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS; the cloud-ai backend reads via the service key.
-- No public policies are added by design.

-- Cosine-similarity semantic search RPC, mirroring search_tools.
CREATE OR REPLACE FUNCTION public.search_workflow_docs(
  query_embedding vector(3072),
  match_threshold float DEFAULT 0.25,
  match_count     int   DEFAULT 5
)
RETURNS TABLE (
  id         text,
  title      text,
  content    text,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.id,
    d.title,
    d.content,
    1 - (d.embedding <=> query_embedding) AS similarity
  FROM public.workflow_docs d
  WHERE d.embedding IS NOT NULL
    AND (1 - (d.embedding <=> query_embedding)) > match_threshold
  ORDER BY d.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
