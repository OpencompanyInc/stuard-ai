-- Remove Meta (Facebook, Instagram, Threads) tools from semantic search index.
-- Re-enable via shared/integration-flags.ts META_INTEGRATION_ENABLED and re-sync embeddings.

DELETE FROM public.tool_embeddings
WHERE name LIKE 'facebook_%'
   OR name LIKE 'instagram_%'
   OR name LIKE 'threads_%';
