#!/usr/bin/env tsx
/**
 * Backfill: encrypt legacy plaintext OAuth tokens in external_accounts.
 *
 * Migration 20260512000000_external_accounts_encrypted added AES-256-GCM
 * ciphertext columns and made the plaintext access_token/refresh_token columns
 * NULL-able, but pre-existing rows keep their plaintext until they're next
 * written. This one-shot, idempotent job re-encrypts any remaining plaintext
 * rows and NULLs the plaintext columns, so a follow-up migration can safely
 * DROP them.
 *
 * Run this BEFORE applying 20260529000000_drop_external_accounts_plaintext_tokens.sql.
 *
 * Usage:
 *   tsx scripts/backfill-external-account-encryption.ts            # encrypt + null plaintext
 *   tsx scripts/backfill-external-account-encryption.ts --check    # report remaining plaintext rows, no writes
 *   tsx scripts/backfill-external-account-encryption.ts --dry-run  # show what would change, no writes
 *
 * Required env: SUPABASE_URL, SUPABASE_SECRET_KEY, TOKEN_ENCRYPTION_PEPPER
 */

import 'dotenv/config';
import { getSupabaseService } from '../src/supabase';
import { encryptForUser, isEncryptionConfigured } from '../src/utils/token-encryption';

const PAGE = 500;

type Row = {
  id: string;
  user_id: string;
  provider: string;
  profile_label: string;
  access_token: string | null;
  refresh_token: string | null;
};

async function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const dryRun = args.includes('--dry-run');

  console.log('========================================');
  console.log('  external_accounts encryption backfill');
  console.log('========================================\n');

  if (!isEncryptionConfigured()) {
    console.error('Error: TOKEN_ENCRYPTION_PEPPER must be set (same value as cloud-ai runtime).');
    process.exit(1);
  }
  const sb = getSupabaseService();
  if (!sb) {
    console.error('Error: Supabase service client unavailable (set SUPABASE_URL + SUPABASE_SECRET_KEY).');
    process.exit(1);
  }

  // Rows still carrying plaintext in either column.
  const selectPlaintext = () =>
    sb
      .from('external_accounts')
      .select('id, user_id, provider, profile_label, access_token, refresh_token')
      .or('access_token.not.is.null,refresh_token.not.is.null');

  if (check) {
    const { count, error } = await sb
      .from('external_accounts')
      .select('id', { count: 'exact', head: true })
      .or('access_token.not.is.null,refresh_token.not.is.null');
    if (error) { console.error('Check failed:', error.message); process.exit(1); }
    console.log(`Rows still holding plaintext tokens: ${count ?? 0}`);
    console.log(count ? '❌ NOT safe to drop plaintext columns yet — run the backfill.' : '✅ Safe to drop plaintext columns.');
    process.exit(count ? 2 : 0);
  }

  let processed = 0;
  let updated = 0;
  let failed = 0;

  // Always read the first page; updated rows drop out of the filter, so we keep
  // reading page 0 until nothing matches (avoids offset drift as rows clear).
  for (;;) {
    const { data, error } = await selectPlaintext().order('id', { ascending: true }).range(0, PAGE - 1);
    if (error) { console.error('Fetch failed:', error.message); process.exit(1); }
    const rows = (data || []) as Row[];
    if (rows.length === 0) break;

    for (const row of rows) {
      processed++;
      try {
        const update: Record<string, unknown> = { access_token: null, refresh_token: null };

        if (row.access_token) {
          const at = encryptForUser(row.user_id, row.access_token);
          if (at) {
            update.access_token_ct = at.ciphertext;
            update.access_token_iv = at.iv;
            update.access_token_tag = at.tag;
            update.key_version = at.key_version;
          }
        }
        if (row.refresh_token) {
          const rt = encryptForUser(row.user_id, row.refresh_token);
          if (rt) {
            update.refresh_token_ct = rt.ciphertext;
            update.refresh_token_iv = rt.iv;
            update.refresh_token_tag = rt.tag;
            update.key_version = rt.key_version;
          }
        }

        if (dryRun) {
          console.log(`[dry-run] would encrypt ${row.provider}/${row.profile_label} (user ${row.user_id})`);
          updated++;
          continue;
        }

        const { error: upErr } = await sb.from('external_accounts').update(update).eq('id', row.id);
        if (upErr) { failed++; console.warn(`  ! update failed for row ${row.id}: ${upErr.message}`); }
        else updated++;
      } catch (e: any) {
        failed++;
        console.warn(`  ! encrypt failed for row ${row.id}: ${e?.message || e}`);
      }
    }

    console.log(`processed=${processed} updated=${updated} failed=${failed}`);
    // In dry-run the rows never clear, so stop after one page to avoid looping.
    if (dryRun) break;
    if (failed > 0 && updated === 0) {
      console.error('Aborting: a full page failed with no progress.');
      process.exit(1);
    }
  }

  console.log(`\nDone. processed=${processed} updated=${updated} failed=${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
