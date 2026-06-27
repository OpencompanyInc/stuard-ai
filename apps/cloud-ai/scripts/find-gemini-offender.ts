/**
 * Scan the FULL execution-tool universe (everything any agent might serialize to
 * Gemini) for type-less subschemas (bare z.any() etc.) using the same converter
 * AI SDK v6 uses (z.toJSONSchema input mode, draft-7). gemini-3.5-flash rejects
 * type-less props (even optional), so any one is a latent 400.
 */
import { z } from 'zod';
import { ensureExecutionToolsRegistered } from '../src/orchestrator/execution-tools-bootstrap';
import { resolveExecutionTools } from '../src/orchestrator/execution-tools-resolver';
// prelude to avoid circular-import TDZ (mirror gemini-schema-safety.test.ts)
import { ORCHESTRATOR_DELEGATION_TOOLS } from '../src/orchestrator/delegation-tools';
import { ask_user } from '../src/tools/ask-user';
import { chatUiTool } from '../src/tools/meta-tools';
import { get_skill_info } from '../src/tools/skill-tools';
import { RESEARCH_MODE_TOOLS } from '../src/tools/research-mode';
import { variablesTool } from '../src/tools/chat-variables';
import * as projectTools from '../src/tools/device/projects';
void [ORCHESTRATOR_DELEGATION_TOOLS, ask_user, chatUiTool, get_skill_info, RESEARCH_MODE_TOOLS, variablesTool, projectTools];

function isTypeless(p: any): boolean {
  if (!p || typeof p !== 'object') return true;
  if (typeof p.type === 'string' || Array.isArray(p.type)) return false;
  if (p.enum || p.anyOf || p.oneOf || p.allOf || p.$ref || p.properties || p.items) return false;
  return true;
}
// `dangerous`: a NAMED property or ARRAY ITEM whose entire schema is type-less —
// Gemini drops it and 400s. `tolerated`: a type-less `additionalProperties`
// wildcard on an otherwise-typed object — Gemini accepts these (empirically:
// run_sequential.steps.items.args.additionalProperties serialized fine).
function findTypeless(node: any, path: string, dangerous: string[], tolerated: string[], depth = 0) {
  if (!node || typeof node !== 'object' || depth > 14) return;
  if (node.properties && typeof node.properties === 'object') {
    for (const [k, v] of Object.entries<any>(node.properties)) {
      if (isTypeless(v)) dangerous.push(`${path}.properties.${k}`);
      findTypeless(v, `${path}.properties.${k}`, dangerous, tolerated, depth + 1);
    }
  }
  if (node.items) {
    if (isTypeless(node.items)) dangerous.push(`${path}.items`);
    findTypeless(node.items, `${path}.items`, dangerous, tolerated, depth + 1);
  }
  if (node.additionalProperties && typeof node.additionalProperties === 'object') {
    if (isTypeless(node.additionalProperties)) tolerated.push(`${path}.additionalProperties`);
    findTypeless(node.additionalProperties, `${path}.additionalProperties`, dangerous, tolerated, depth + 1);
  }
  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    if (Array.isArray(node[key])) node[key].forEach((s: any, i: number) => findTypeless(s, `${path}.${key}[${i}]`, dangerous, tolerated, depth + 1));
  }
}

async function main() {
  await ensureExecutionToolsRegistered();
  const tools = resolveExecutionTools();
  const names = Object.keys(tools);
  console.log(`Scanning ${names.length} execution tools for type-less subschemas...\n`);
  let dangerCount = 0;
  for (const name of names) {
    const schema = tools[name]?.inputSchema;
    if (!schema) continue;
    const base = (schema as any)?.__stuardBaseSchema ?? schema;
    let json: any;
    try { json = z.toJSONSchema(base, { target: 'draft-7', io: 'input' } as any); } catch { continue; }
    const dangerous: string[] = [];
    const tolerated: string[] = [];
    findTypeless(json, '', dangerous, tolerated, 0);
    if (dangerous.length) { dangerCount++; console.log(`❌ DANGEROUS ${name}: ${dangerous.join(' , ')}`); }
  }
  console.log(`\n${dangerCount} tool(s) with a DANGEROUS (Gemini-400) type-less property/item.`);
  console.log('Done.');
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
