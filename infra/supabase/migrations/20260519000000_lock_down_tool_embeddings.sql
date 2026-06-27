-- Tool embeddings are backend catalog data. Keep direct client access closed;
-- cloud-ai uses the service role for semantic tool lookup and sync.
ALTER TABLE public.tool_embeddings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.tool_embeddings FROM anon;
REVOKE ALL ON TABLE public.tool_embeddings FROM authenticated;

DROP POLICY IF EXISTS tool_embeddings_no_client_access ON public.tool_embeddings;
CREATE POLICY tool_embeddings_no_client_access ON public.tool_embeddings
  FOR ALL
  USING (false)
  WITH CHECK (false);
