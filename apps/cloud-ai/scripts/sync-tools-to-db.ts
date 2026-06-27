#!/usr/bin/env tsx
/**
 * Tool Sync CLI
 *
 * Syncs tool definitions from the tool registry (dynamic) to Supabase tool_embeddings table.
 *
 * Usage:
 *   npm run sync:tools              # Incremental sync (only new tools)
 *   npm run sync:tools:force        # Force sync all tools + disable obsolete
 *   tsx scripts/sync-tools-to-db.ts --force --disable-obsolete --validate
 *
 * Options:
 *   --force             Force re-sync all tools (regenerate embeddings)
 *   --disable-obsolete  Disable tools in DB that aren't in TOOL_DEFINITIONS
 *   --validate          Validate that all synced tools have valid embeddings
 *   --status            Show sync status without making changes
 *   --tools <names>     Sync only specific tools (comma-separated)
 */

import 'dotenv/config';
import {
  syncToolsToSupabase,
  disableObsoleteTools,
  getSyncStatus,
  validateSyncedTools,
} from '../src/tools/tool-sync';

async function main() {
  const args = process.argv.slice(2);

  const force = args.includes('--force');
  const disableObsolete = args.includes('--disable-obsolete');
  const validate = args.includes('--validate');
  const statusOnly = args.includes('--status');

  // Parse --tools flag
  const toolsIdx = args.indexOf('--tools');
  const toolNames = toolsIdx >= 0 && args[toolsIdx + 1]
    ? args[toolsIdx + 1].split(',').map(s => s.trim())
    : undefined;

  console.log('========================================');
  console.log('  Tool Sync CLI');
  console.log('========================================\n');

  // Check environment
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
    console.error('Error: SUPABASE_URL and SUPABASE_SECRET_KEY must be set');
    process.exit(1);
  }

  if (!process.env.OPENAI_API_KEY) {
    console.error('Error: OPENAI_API_KEY must be set for embedding generation');
    process.exit(1);
  }

  // Status only mode
  if (statusOnly) {
    console.log('Checking sync status...\n');
    const status = await getSyncStatus();

    console.log('Sync Status:');
    console.log(`  Defined in code: ${status.definedCount} tools`);
    console.log(`  Synced to DB:    ${status.syncedCount} tools`);

    if (status.unsyncedTools.length > 0) {
      console.log(`\n  Unsynced tools (${status.unsyncedTools.length}):`);
      status.unsyncedTools.slice(0, 20).forEach(t => console.log(`    - ${t}`));
      if (status.unsyncedTools.length > 20) {
        console.log(`    ... and ${status.unsyncedTools.length - 20} more`);
      }
    }

    if (status.obsoleteTools.length > 0) {
      console.log(`\n  Obsolete tools (${status.obsoleteTools.length}):`);
      status.obsoleteTools.forEach(t => console.log(`    - ${t}`));
    }

    process.exit(0);
  }

  // Sync tools
  console.log('Syncing tools to Supabase...\n');
  console.log(`  Mode: ${force ? 'FORCE (all tools)' : 'Incremental (new only)'}`);
  if (toolNames) {
    console.log(`  Tools: ${toolNames.join(', ')}`);
  }
  console.log('');

  const result = await syncToolsToSupabase({ force, toolNames });

  console.log('\n----------------------------------------');
  console.log('Sync Results:');
  console.log(`  Synced:  ${result.synced}`);
  console.log(`  Skipped: ${result.skipped}`);
  console.log(`  Errors:  ${result.errors.length}`);

  if (result.errors.length > 0) {
    console.log('\nErrors:');
    result.errors.forEach(err => console.log(`  - ${err}`));
  }

  // Disable obsolete tools
  if (disableObsolete) {
    console.log('\n----------------------------------------');
    console.log('Disabling obsolete tools...');
    const disabled = await disableObsoleteTools();
    console.log(`  Disabled: ${disabled}`);
  }

  // Validate embeddings
  if (validate) {
    console.log('\n----------------------------------------');
    console.log('Validating embeddings...');
    const validation = await validateSyncedTools();
    console.log(`  Valid:   ${validation.valid}`);
    console.log(`  Invalid: ${validation.invalid.length}`);

    if (validation.invalid.length > 0) {
      console.log('\n  Tools with invalid embeddings:');
      validation.invalid.forEach(t => console.log(`    - ${t}`));
    }
  }

  console.log('\n========================================');
  console.log('  Done!');
  console.log('========================================');

  process.exit(result.errors.length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
