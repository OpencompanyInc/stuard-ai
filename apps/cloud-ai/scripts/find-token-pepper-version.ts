#!/usr/bin/env tsx
/**
 * Recover the correct TOKEN_ENCRYPTION_PEPPER for external_accounts.
 *
 * Symptom this solves:
 *   [supabase] decrypt access_token failed for <provider>/<profile>:
 *   Unsupported state or unable to authenticate data
 *
 * That AES-256-GCM auth-tag rejection means the deployed pepper no longer
 * matches the value the rows were encrypted with (the Secret Manager secret
 * is pinned to `:latest`, so a newer version silently orphaned the old
 * ciphertext — or a backfill ran with a different local pepper).
 *
 * This script samples a few encrypted rows and tries each candidate pepper
 * against them using the REAL decryption code. It reports which candidate
 * (and, with --gcloud, which secret VERSION) actually decrypts — that's the
 * version to pin the deploy to.
 *
 * It never prints pepper values or decrypted token plaintext — only version
 * ids and pass/fail counts.
 *
 * Usage (from apps/cloud-ai):
 *   # Auto-enumerate every Secret Manager version and test each one:
 *   npx tsx scripts/find-token-pepper-version.ts --gcloud
 *   npx tsx scripts/find-token-pepper-version.ts --gcloud --project=stuard-beta --secret=TOKEN_ENCRYPTION_PEPPER
 *
 *   # Or test specific candidate values you already have (comma-separated):
 *   CANDIDATE_PEPPERS="hexA,hexB" npx tsx scripts/find-token-pepper-version.ts
 *
 * Required env: SUPABASE_URL, SUPABASE_SECRET_KEY
 * For --gcloud: an authenticated `gcloud` with secretmanager.versions.access.
 */

import 'dotenv/config';
import { execFileSync } from 'child_process';
import { getSupabaseService } from '../src/supabase';
import { decryptForUser } from '../src/utils/token-encryption';

const SAMPLE_LIMIT = 8;

type SampleRow = {
  user_id: string;
  provider: string;
  profile_label: string;
  access_token_ct: string | null;
  access_token_iv: string | null;
  access_token_tag: string | null;
  key_version: number | null;
};

type Candidate = { label: string; value: string };

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/** Try one candidate pepper against the sample rows. Returns # of rows it decrypts. */
function countDecrypts(value: string, rows: SampleRow[]): number {
  const prev = process.env.TOKEN_ENCRYPTION_PEPPER;
  process.env.TOKEN_ENCRYPTION_PEPPER = value;
  let ok = 0;
  try {
    for (const r of rows) {
      if (!r.access_token_ct || !r.access_token_iv || !r.access_token_tag) continue;
      try {
        const pt = decryptForUser(r.user_id, {
          ciphertext: r.access_token_ct,
          iv: r.access_token_iv,
          tag: r.access_token_tag,
          key_version: r.key_version ?? 1,
        });
        if (pt) ok++;
      } catch {
        /* wrong pepper for this row */
      }
    }
  } finally {
    if (prev === undefined) delete process.env.TOKEN_ENCRYPTION_PEPPER;
    else process.env.TOKEN_ENCRYPTION_PEPPER = prev;
  }
  return ok;
}

function gcloudCandidates(secret: string, project?: string): Candidate[] {
  const base = ['--secret', secret, ...(project ? ['--project', project] : [])];
  let versions: Array<{ name: string; state: string }>;
  try {
    const raw = execFileSync(
      'gcloud',
      ['secrets', 'versions', 'list', secret, '--format=json', ...(project ? ['--project', project] : [])],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    versions = JSON.parse(raw);
  } catch (e: any) {
    console.error(`Could not list secret versions via gcloud: ${e?.message || e}`);
    console.error('Is gcloud installed, authenticated, and pointed at the right project?');
    return [];
  }

  const out: Candidate[] = [];
  for (const v of versions) {
    // name looks like projects/123/secrets/NAME/versions/4 — take the trailing id
    const id = String(v.name || '').split('/').pop() || '?';
    if (String(v.state || '').toUpperCase() !== 'ENABLED') {
      console.log(`  · version ${id}: ${v.state} (skipped — not ENABLED)`);
      continue;
    }
    try {
      const value = execFileSync(
        'gcloud',
        ['secrets', 'versions', 'access', id, ...base],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      );
      out.push({ label: `version ${id}`, value });
    } catch (e: any) {
      console.log(`  · version ${id}: access failed (${e?.message || e})`);
    }
  }
  return out;
}

async function main() {
  const secret = arg('secret') || 'TOKEN_ENCRYPTION_PEPPER';
  const project = arg('project');

  console.log('================================================');
  console.log('  TOKEN_ENCRYPTION_PEPPER version finder');
  console.log('================================================\n');

  const sb = getSupabaseService();
  if (!sb) {
    console.error('Error: Supabase service client unavailable (set SUPABASE_URL + SUPABASE_SECRET_KEY).');
    process.exit(1);
  }

  const { data, error } = await sb
    .from('external_accounts')
    .select('user_id, provider, profile_label, access_token_ct, access_token_iv, access_token_tag, key_version')
    .not('access_token_ct', 'is', null)
    .limit(SAMPLE_LIMIT);
  if (error) {
    console.error('Failed to read external_accounts:', error.message);
    process.exit(1);
  }
  const rows = (data || []) as SampleRow[];
  if (rows.length === 0) {
    console.log('No encrypted rows found — nothing to test. (No access_token_ct populated.)');
    process.exit(0);
  }
  console.log(`Sampled ${rows.length} encrypted account(s): ${rows.map((r) => `${r.provider}/${r.profile_label}`).join(', ')}\n`);

  // Build candidate list.
  const candidates: Candidate[] = [];
  if (process.env.TOKEN_ENCRYPTION_PEPPER) {
    candidates.push({ label: 'current env TOKEN_ENCRYPTION_PEPPER', value: process.env.TOKEN_ENCRYPTION_PEPPER });
  }
  const manual = (process.env.CANDIDATE_PEPPERS || '').split(',').map((s) => s.trim()).filter(Boolean);
  manual.forEach((v, i) => candidates.push({ label: `CANDIDATE_PEPPERS[${i}]`, value: v }));

  if (flag('gcloud')) {
    console.log(`Enumerating Secret Manager versions of "${secret}"${project ? ` in ${project}` : ''}...`);
    candidates.push(...gcloudCandidates(secret, project));
    console.log('');
  }

  if (candidates.length === 0) {
    console.error('No candidate peppers to test. Pass --gcloud, or set CANDIDATE_PEPPERS / TOKEN_ENCRYPTION_PEPPER.');
    process.exit(1);
  }

  // De-dupe identical values (keep first label) so we don't test the same value twice.
  const seen = new Set<string>();
  const winners: string[] = [];
  console.log('Results (rows decrypted / sampled):');
  for (const c of candidates) {
    if (seen.has(c.value)) continue;
    seen.add(c.value);
    let n = 0;
    try {
      n = countDecrypts(c.value, rows);
    } catch (e: any) {
      console.log(`  ✗ ${c.label}: invalid pepper (${e?.message || e})`);
      continue;
    }
    const mark = n === rows.length ? '✅' : n > 0 ? '⚠️ ' : '✗';
    console.log(`  ${mark} ${c.label}: ${n}/${rows.length}`);
    if (n > 0) winners.push(c.label);
  }

  console.log('');
  if (winners.length === 0) {
    console.log('❌ No candidate decrypted any row. The original pepper may be gone —');
    console.log('   in that case the fix is to reconnect the affected integrations so');
    console.log('   fresh tokens are written with the current pepper.');
    process.exit(2);
  }
  console.log(`✅ Decrypting pepper: ${winners[0]}`);
  if (winners[0].startsWith('version ')) {
    const v = winners[0].replace('version ', '');
    console.log(`\n   Pin the deploy to it — in .github/workflows/release-beta.yml change:`);
    console.log(`     TOKEN_ENCRYPTION_PEPPER=${secret}:latest`);
    console.log(`   to:`);
    console.log(`     TOKEN_ENCRYPTION_PEPPER=${secret}:${v}`);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
