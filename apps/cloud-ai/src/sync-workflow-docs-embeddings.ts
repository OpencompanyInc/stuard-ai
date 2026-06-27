import 'dotenv/config';
import { ensureWorkflowDocsEmbeddings } from './agents/workflow-agent/docs';
import { getSupabaseService } from './supabase';

async function main() {
  const supabase = getSupabaseService();
  if (!supabase) {
    console.error(
      '[sync-workflow-docs] Supabase service client not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY).',
    );
    process.exit(2);
  }

  const force = process.argv.includes('--force');
  console.log(
    `[sync-workflow-docs] Starting workflow_docs embeddings sync (${force ? 'FORCE re-embed all' : 'incremental'})...`,
  );
  const t0 = Date.now();

  const result = await ensureWorkflowDocsEmbeddings({ force });

  const dt = Date.now() - t0;
  console.log(
    `[sync-workflow-docs] Done in ${dt}ms — synced=${result.synced}, skipped=${result.skipped}, errors=${result.errors.length}`,
  );
  if (result.errors.length > 0) {
    console.error('[sync-workflow-docs] Errors:', result.errors);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('[sync-workflow-docs] Failed:', e);
  process.exit(1);
});
