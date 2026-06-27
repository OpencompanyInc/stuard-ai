import 'dotenv/config';
import { ensureToolEmbeddings } from './tools/meta-tools';
import { syncToolsToSupabase } from './tools/tool-sync';
import { getSupabaseService } from './supabase';

async function main() {
  const supabase = getSupabaseService();
  if (!supabase) {
    console.error('[sync-tool-embeddings] Supabase service client not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY).');
    process.exit(2);
  }

  const forceMode = process.argv.includes('--force');

  console.log(`[sync-tool-embeddings] Starting tool embeddings sync (${forceMode ? 'FORCE re-embed all' : 'incremental'})...`);
  const t0 = Date.now();

  if (forceMode) {
    const result = await syncToolsToSupabase({ force: true });
    console.log(`[sync-tool-embeddings] Force sync result: ${result.synced} synced, ${result.skipped} skipped, ${result.errors.length} errors`);
    if (result.errors.length > 0) {
      console.error('[sync-tool-embeddings] Errors:', result.errors);
    }
  } else {
    await ensureToolEmbeddings();
  }

  const dt = Date.now() - t0;
  console.log(`[sync-tool-embeddings] Done in ${dt}ms`);
}

main().catch((e) => {
  console.error('[sync-tool-embeddings] Failed:', e);
  process.exit(1);
});
