#!/usr/bin/env tsx
/**
 * Run a SQL migration against Supabase
 *
 * Usage: tsx scripts/run-migration.ts
 */

import 'dotenv/config';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error('Error: SUPABASE_URL and SUPABASE_SECRET_KEY must be set');
  process.exit(1);
}

const MIGRATION_SQL = `
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
`;

const SEARCH_FUNCTION_SQL = `
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
`;

async function runSQL(sql: string, description: string): Promise<boolean> {
  console.log(`\n${description}...`);

  // Use the Supabase REST API to run raw SQL
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SECRET_KEY,
      'Authorization': `Bearer ${SUPABASE_SECRET_KEY}`,
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({ query: sql }),
  });

  // The REST API doesn't support raw SQL directly, so we need to use the SQL Editor endpoint
  // Let's try a different approach - use the postgres connection string

  return true;
}

async function main() {
  console.log('========================================');
  console.log('  Running SIS Migration');
  console.log('========================================');

  // Use the Supabase Management API or direct SQL
  // Since we can't run raw SQL via REST, let's create the columns one at a time using the API

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { persistSession: false },
  });

  // Test connection by checking if table exists
  console.log('\nChecking tool_embeddings table...');
  const { data, error } = await supabase
    .from('tool_embeddings')
    .select('name')
    .limit(1);

  if (error) {
    console.error('Error connecting to tool_embeddings:', error.message);
    process.exit(1);
  }

  console.log('Connected successfully. Found tool_embeddings table.');

  // Try to check if columns exist by selecting them
  console.log('\nChecking if new columns exist...');
  const { data: colCheck, error: colError } = await supabase
    .from('tool_embeddings')
    .select('name, schema, semantic_hints, kind, enabled')
    .limit(1);

  if (colError) {
    console.log('New columns do not exist yet. Migration needed.');
    console.log('\n⚠️  Please run this SQL in the Supabase SQL Editor:');
    console.log('=====================================');
    console.log(MIGRATION_SQL);
    console.log('=====================================');
    console.log('\nThen run this to create the search function:');
    console.log('=====================================');
    console.log(SEARCH_FUNCTION_SQL);
    console.log('=====================================');
    console.log('\nAfter running the migration, re-run: npm run sync:tools:force');
  } else {
    console.log('✅ New columns already exist!');
    console.log('\nYou can now run: npm run sync:tools:force');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
