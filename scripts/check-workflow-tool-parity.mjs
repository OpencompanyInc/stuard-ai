#!/usr/bin/env node
/**
 * Workflow engine tool-classification parity guard.
 *
 * The desktop engine (apps/desktop/src/main/tools/registry.ts) and the VM engine
 * (apps/vm-agent/src/vm-engine.ts) intentionally classify tools DIFFERENTLY —
 * the same tool routes to different handlers because the runtime environments
 * differ (e.g. capture_screen = `local` on desktop but `desktop-relay` on the
 * VM; write_file = `local`/Python on desktop but `vm-native`/Node on the VM).
 * That divergence is correct and must NOT be unified.
 *
 * But two categories MUST agree, or a workflow silently misroutes on the VM:
 *
 *  1. cloud — every tool the desktop routes to cloud-ai (AI inference, web,
 *     integrations, embeddings) MUST also be `cloud` on the VM. Otherwise the
 *     VM would try to run a cloud integration as a local/vm-native tool and fail.
 *  2. orchestration — run_sequential / run_parallel / loop_executor etc. must
 *     be handled inline by both engines, never dispatched as a tool.
 *
 * This guard enforces desktop ⊆ VM for those two sets. The VM may know MORE
 * cloud tools than desktop (legacy aliases, VM-specific) — that's safe.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const registryPath = path.join(root, 'apps', 'desktop', 'src', 'main', 'tools', 'registry.ts');
const vmEnginePath = path.join(root, 'apps', 'vm-agent', 'src', 'vm-engine.ts');

const errors = [];

function fail(msg) {
  errors.push(msg);
}

const registry = fs.readFileSync(registryPath, 'utf8');
const vmEngine = fs.readFileSync(vmEnginePath, 'utf8');

// Desktop: TOOL_REGISTRY entries `'name': { kind: 'cloud' }` / 'orchestration'.
function desktopToolsOfKind(kind) {
  const set = new Set();
  const re = new RegExp(`['"]([a-z0-9_]+)['"]\\s*:\\s*\\{\\s*kind:\\s*['"]${kind}['"]`, 'g');
  for (const m of registry.matchAll(re)) set.add(m[1]);
  return set;
}

// VM: `const NAME = new Set([ ...'tool'... ])` blocks.
function vmSet(constName) {
  const block = vmEngine.match(new RegExp(`const ${constName} = new Set\\(\\[([\\s\\S]*?)\\]\\)`));
  const set = new Set();
  if (block) for (const m of block[1].matchAll(/['"]([a-z0-9_]+)['"]/g)) set.add(m[1]);
  return set;
}

const desktopCloud = desktopToolsOfKind('cloud');
const vmCloud = vmSet('CLOUD_TOOLS');
const desktopOrch = desktopToolsOfKind('orchestration');
const vmOrch = vmSet('ORCHESTRATION_TOOLS');

if (desktopCloud.size === 0) fail('Could not parse any desktop cloud tools — registry format changed? Update this guard.');
if (vmCloud.size === 0) fail('Could not parse VM CLOUD_TOOLS — vm-engine format changed? Update this guard.');
if (vmOrch.size === 0) fail('Could not parse VM ORCHESTRATION_TOOLS — vm-engine format changed? Update this guard.');

const cloudMissingOnVm = [...desktopCloud].filter(t => !vmCloud.has(t));
if (cloudMissingOnVm.length > 0) {
  fail(
    `These tools are 'cloud' on desktop but NOT in the VM's CLOUD_TOOLS set — the VM would misroute them ` +
    `(run a cloud tool locally and fail). Add them to CLOUD_TOOLS in apps/vm-agent/src/vm-engine.ts:\n      ` +
    cloudMissingOnVm.join(', '),
  );
}

const orchMissingOnVm = [...desktopOrch].filter(t => !vmOrch.has(t));
if (orchMissingOnVm.length > 0) {
  fail(
    `These tools are 'orchestration' on desktop but NOT in the VM's ORCHESTRATION_TOOLS set — ` +
    `the VM would dispatch them as plain tools. Add them to ORCHESTRATION_TOOLS in apps/vm-agent/src/vm-engine.ts:\n      ` +
    orchMissingOnVm.join(', '),
  );
}

if (errors.length > 0) {
  console.error('Workflow tool-classification parity check failed:\n');
  for (const err of errors) console.error(`  - ${err}`);
  process.exit(1);
}

console.log(
  `Workflow tool parity OK — desktop cloud (${desktopCloud.size}) ⊆ VM cloud (${vmCloud.size}); ` +
  `desktop orchestration (${desktopOrch.size}) ⊆ VM orchestration (${vmOrch.size}).`,
);
