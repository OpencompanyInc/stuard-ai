-- Remove Outlook, Discord, and Reddit tools from semantic search index.
-- Re-enable via shared/integration-flags.ts and re-sync embeddings.

DELETE FROM public.tool_embeddings
WHERE name LIKE 'outlook_%'
   OR name LIKE 'discord_%'
   OR name LIKE 'reddit_%';
