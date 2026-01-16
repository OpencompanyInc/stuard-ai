import 'dotenv/config';
import { ensureToolEmbeddings } from './tools/meta-tools';
import { getSupabaseService } from './supabase';

async function main() {
  const supabase = getSupabaseService();
  if (!supabase) {
    console.error('[sync-tool-embeddings] Supabase service client not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY).');
    process.exit(2);
  }

  console.log('[sync-tool-embeddings] Starting tool embeddings sync...');
  const t0 = Date.now();
  await ensureToolEmbeddings();
  const dt = Date.now() - t0;
  console.log(`[sync-tool-embeddings] Done in ${dt}ms`);
}

main().catch((e) => {
  console.error('[sync-tool-embeddings] Failed:', e);
  process.exit(1);
});
