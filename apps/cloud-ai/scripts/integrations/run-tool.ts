/**
 * CLI harness for the declarative-integration test phase.
 *
 *   pnpm --filter @stuardai/cloud-ai tsx scripts/integrations/run-tool.ts \
 *     <slug>.<tool> '<json-args>'
 *
 *   pnpm --filter @stuardai/cloud-ai tsx scripts/integrations/run-tool.ts --list
 *   pnpm --filter @stuardai/cloud-ai tsx scripts/integrations/run-tool.ts --ping <slug>
 *
 * Reads secrets from env vars (INT_<SLUG>_<FIELD>) via secrets-env.ts.
 */

import 'dotenv/config';
import { loadAllPacks, resolveManifest } from '../../src/integrations/manifest-loader';
import { executeDeclarativeTool } from '../../src/integrations/declarative-executor';
import { resolveDeclaredSecrets, expectedEnvVar } from '../../src/integrations/secrets-env';
import type { IntegrationManifest } from '../../src/integrations/types';

function printUsage(): void {
  console.log(`
Usage:
  run-tool <slug>.<tool> [json-args]
  run-tool --list
  run-tool --ping <slug>
  run-tool --describe <slug>

Examples:
  run-tool stripe.list_customers '{"limit": 3}'
  run-tool github.get_authenticated_user
  run-tool --ping notion
`);
}

function listPacks(): void {
  const packs = loadAllPacks();
  if (packs.size === 0) {
    console.log('No packs found.');
    return;
  }
  console.log(`Loaded ${packs.size} integration pack(s):\n`);
  for (const m of packs.values()) {
    console.log(`  ${m.slug.padEnd(12)}  ${m.name}  (v${m.version})`);
    for (const tool of m.tools) {
      console.log(`    └─ ${tool.name}`);
    }
    console.log();
  }
}

function describe(slug: string): void {
  const m = resolveManifest(slug);
  if (!m) {
    console.error(`No pack with slug "${slug}"`);
    process.exit(1);
  }
  console.log(`${m.name} (${m.slug}) v${m.version}`);
  console.log(`  ${m.description}`);
  console.log(`  hosts: ${m.outbound_hosts.join(', ')}`);
  console.log(`  auth fields:`);
  for (const f of m.auth.fields) {
    const env = expectedEnvVar(m.slug, f.name);
    const present = !!process.env[env];
    console.log(`    - ${f.name}${f.required ? ' (required)' : ''}  env: ${env}  ${present ? '✓ set' : '✗ unset'}`);
  }
  console.log(`  tools:`);
  for (const t of m.tools) {
    console.log(`    - ${t.name}: ${t.description}`);
  }
}

async function runPing(slug: string): Promise<void> {
  const m = resolveManifest(slug);
  if (!m) {
    console.error(`No pack with slug "${slug}"`);
    process.exit(1);
  }
  if (!m.ping) {
    console.error(`Pack "${slug}" has no ping endpoint declared`);
    process.exit(1);
  }
  // Re-use the executor by treating ping as a synthetic tool.
  const synthetic: IntegrationManifest = {
    ...m,
    tools: [
      {
        name: '__ping__',
        description: 'health probe',
        args: { type: 'object', properties: {} },
        request: { method: m.ping.method, urlTemplate: m.ping.urlTemplate, headers: m.ping.headers },
      },
    ],
  };
  const secrets = resolveDeclaredSecrets(m.slug, m.auth.fields);
  const result = await executeDeclarativeTool(synthetic, '__ping__', { secrets, args: {} });
  printResult(result);
}

async function runTool(qualifier: string, argsJson: string | undefined): Promise<void> {
  const dot = qualifier.indexOf('.');
  if (dot <= 0) {
    console.error(`Tool id must be "<slug>.<tool>" — got "${qualifier}"`);
    process.exit(1);
  }
  const slug = qualifier.slice(0, dot);
  const tool = qualifier.slice(dot + 1);
  const manifest = resolveManifest(slug);
  if (!manifest) {
    console.error(`No pack with slug "${slug}"`);
    process.exit(1);
  }
  const args = argsJson ? safeJson(argsJson) : {};
  const secrets = resolveDeclaredSecrets(slug, manifest.auth.fields);
  const result = await executeDeclarativeTool(manifest, tool, { secrets, args });
  printResult(result);
}

function safeJson(s: string): any {
  try { return JSON.parse(s); }
  catch (e: any) {
    console.error(`Args is not valid JSON: ${e?.message || e}`);
    process.exit(1);
  }
}

function printResult(result: any): void {
  // Stringify with 2-space indent; trim if too big.
  const out = JSON.stringify(result, null, 2);
  const MAX = 8000;
  if (out.length > MAX) {
    console.log(out.slice(0, MAX) + `\n… (${out.length - MAX} bytes truncated)`);
  } else {
    console.log(out);
  }
  if (!result.ok) process.exit(2);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    printUsage();
    return;
  }
  if (argv[0] === '--list') return listPacks();
  if (argv[0] === '--ping') {
    if (!argv[1]) { console.error('--ping requires a slug'); process.exit(1); }
    return runPing(argv[1]);
  }
  if (argv[0] === '--describe') {
    if (!argv[1]) { console.error('--describe requires a slug'); process.exit(1); }
    return describe(argv[1]);
  }
  return runTool(argv[0], argv[1]);
}

main().catch(e => {
  console.error('Unhandled error:', e);
  process.exit(99);
});
