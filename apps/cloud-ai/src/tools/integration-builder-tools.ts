/**
 * Integration Builder tools — let a delegated subagent AUTHOR a custom HTTP
 * integration, DEPLOY it, and then USE it, all in one task.
 *
 * These reuse the exact deploy/run machinery behind the dashboard's Integration
 * Builder so a subagent-built integration is identical to a hand-built one:
 *   - deploy_integration → installed-store.upsertInstalled (envelope-encrypted secrets)
 *   - run_integration    → declarative-executor.executeDeclarativeTool (same as /v1/integrations/run)
 *
 * run_integration matters because compiled custom tools are loaded per-request
 * (prepare-chat-request → __customTools); a just-deployed integration isn't in
 * that request-scoped catalog yet, so this gives the builder an immediate way to
 * call what it just created without waiting for the next turn.
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getBridgeSecrets } from './bridge';
import { writeLog } from '../utils/logger';
import { validateManifestShape, sanitizeSecrets } from '../routes/integrations-installed';
import { upsertInstalled, getDecryptedSecrets } from '../integrations/installed-store';
import { ensureFreshOAuthToken } from '../integrations/oauth-refresh';
import { executeDeclarativeTool, IntegrationExecutorError } from '../integrations/declarative-executor';
import { compiledToolName } from '../integrations/compile-tools';
import type { IntegrationManifest } from '../integrations/types';

function resolveUserId(): string | null {
  try {
    const s = getBridgeSecrets() as any;
    const id = typeof s?.userId === 'string' ? s.userId.trim() : '';
    return id || null;
  } catch {
    return null;
  }
}

/**
 * Self-correcting hint appended to every manifest error. The empty-`{}` loop
 * that burned huge token counts came from terse errors ("manifest.slug is
 * required") that gave the model nothing to fix — so it re-sent `{}`. This
 * skeleton lets the model fill in the blanks on the very next attempt.
 */
const MANIFEST_SKELETON_HINT =
  'The `manifest` argument must be the COMPLETE manifest object — never {} and never partial. ' +
  'Emit every top-level field, for example: ' +
  '{"slug":"netlify","name":"Netlify","version":"1.0.0",' +
  '"auth":{"strategy":{"type":"bearer","tokenField":"api_key"},' +
  '"fields":[{"name":"api_key","label":"API token","secret":true,"required":true}]},' +
  '"outbound_hosts":["api.netlify.com"],' +
  '"tools":[{"name":"create_site","description":"Create a site",' +
  '"args":{"type":"object","properties":{"name":{"type":"string"}}},' +
  '"request":{"method":"POST","urlTemplate":"https://api.netlify.com/api/v1/sites",' +
  '"headers":{"Content-Type":"application/json"},' +
  '"body":{"kind":"json","value":{"name":"{{args.name}}"}}}}]}. ' +
  'If the manifest is large, pass it as a single JSON string instead of an object.';

/** Accept a manifest as an object or a JSON string (models sometimes stringify). */
function coerceManifest(raw: any): { manifest?: IntegrationManifest; error?: string } {
  let m = raw;
  if (typeof m === 'string') {
    const trimmed = m.trim();
    if (!trimmed) return { error: `manifest was an empty string. ${MANIFEST_SKELETON_HINT}` };
    try { m = JSON.parse(trimmed); } catch { return { error: `manifest must be valid JSON (failed to parse the string you passed). ${MANIFEST_SKELETON_HINT}` }; }
  }
  if (!m || typeof m !== 'object' || Array.isArray(m)) {
    return { error: `manifest must be a JSON object. ${MANIFEST_SKELETON_HINT}` };
  }
  if (Object.keys(m).length === 0) {
    return { error: `manifest was empty ({}). ${MANIFEST_SKELETON_HINT}` };
  }
  const shapeErr = validateManifestShape(m);
  if (shapeErr) return { error: `${shapeErr}. ${MANIFEST_SKELETON_HINT}` };
  return { manifest: m as IntegrationManifest };
}

// Structured-but-loose manifest schema. The top-level fields — and each tool's
// top-level fields — are typed so the model gets real slots to fill. A fully
// free-form object (z.object({}).loose()) gave no scaffolding, and some models
// repeatedly emitted `{}` for the whole manifest, looping on "slug is required".
// The genuinely variant leaves (auth.strategy, tool.args, tool.request, ping)
// stay loose objects: every node still carries a concrete `type: object`, so
// this guides the model WITHOUT the Gemini z.any()/type-less-property 400 trap
// (see project_gemini_tool_schema_no_any) and without discriminated-union anyOf.
const manifestToolSchema = z.object({
  name: z.string().describe('Tool name in snake_case; the name run_integration calls.'),
  description: z.string().describe('Tight description the agent reads to decide when to call this tool.'),
  args: z.object({}).loose().describe('JSON-Schema-style: { type:"object", properties:{ <arg>:{ type, description?, enum?, default? } }, required?:[] }.'),
  request: z.object({}).loose().describe('{ method, urlTemplate, headers?, query?, body? }. Use {{args.x}} / {{secrets.y}} templates. body kinds: none|json|form|text.'),
}).loose();

const manifestAuthSchema = z.object({
  strategy: z.object({}).loose().describe('e.g. { type:"bearer", tokenField:"api_key" }. Also: apiKey | basic | oauth2 | none.'),
  fields: z.array(z.object({}).loose()).describe('Credential fields, each: { name, label, secret, required, placeholder?, hint? }.'),
}).loose();

// Fields are typed (so every slot is advertised to the model and it stops
// emitting `{}`) but OPTIONAL on purpose: coerceManifest/validateManifestShape
// stay the single, friendly validation authority that returns the
// self-correcting skeleton hint, instead of Mastra hard-rejecting a partial
// manifest with a terse Zod error before execute() is ever reached.
const manifestSchema = z.object({
  slug: z.string().optional().describe('REQUIRED. URL-safe identifier, e.g. "netlify".'),
  name: z.string().optional().describe('REQUIRED. Human-readable display name.'),
  version: z.string().optional().describe('REQUIRED. Semver string, e.g. "1.0.0".'),
  description: z.string().optional().describe('One-line summary of what the integration does.'),
  icon: z.string().optional().describe('Lucide icon id or emoji.'),
  category: z.string().optional().describe('Free-form category (Payments, Email, DevOps, …).'),
  auth: manifestAuthSchema.optional().describe('REQUIRED. Auth strategy + the credential fields it references.'),
  outbound_hosts: z.array(z.string()).optional().describe('REQUIRED, non-empty. Hostnames the tools call, e.g. ["api.netlify.com"].'),
  tools: z.array(manifestToolSchema).optional().describe('REQUIRED, non-empty. One entry per HTTP operation.'),
  ping: z.object({}).loose().optional().describe('Optional health check: { method, urlTemplate, headers? }.'),
}).loose().describe('The full integration manifest. Emit the COMPLETE object (never {}). A JSON string is also accepted.');

export const deploy_integration = createTool({
  id: 'deploy_integration',
  description:
    'Deploy (create or update) a custom HTTP integration from a declarative manifest, scoped to the current user. ' +
    'Pass the full manifest (slug, name, version, auth, outbound_hosts, tools). Optionally pass secrets (API keys etc. by auth-field name) ' +
    'and enabled. Returns the compiled tool names you can immediately call with run_integration. ' +
    'Author the manifest per the integration-manifest schema; verify real endpoints with web_search/scrape_url before deploying.',
  inputSchema: z.object({
    // Structured-but-loose (see manifestSchema above): typed top-level slots stop
    // the model from emitting `{}`, while variant leaves stay loose to dodge the
    // Gemini z.any() 400 trap. The coercion layer still accepts a JSON string.
    manifest: manifestSchema,
    secrets: z.record(z.string(), z.string()).optional().describe('Secret values keyed by auth-field name (e.g. { api_key: "sk-..." }). Omit to deploy without credentials.'),
    enabled: z.boolean().optional().default(true).describe('Whether the integration is enabled after deploy (default true).'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    slug: z.string().optional(),
    name: z.string().optional(),
    enabled: z.boolean().optional(),
    tools: z.array(z.object({
      name: z.string(),
      compiledName: z.string(),
      description: z.string().optional(),
    })).optional(),
    error: z.string().optional(),
  }),
  execute: async (input: any) => {
    const userId = resolveUserId();
    if (!userId) return { ok: false, error: 'No authenticated user in context — cannot deploy an integration.' };

    const { manifest, error } = coerceManifest(input?.manifest);
    if (!manifest) return { ok: false, error: error || 'invalid_manifest' };

    const secrets = sanitizeSecrets(input?.secrets, manifest.auth.fields);
    const enabled = input?.enabled === undefined ? true : !!input.enabled;

    try {
      const saved = await upsertInstalled(userId, manifest, secrets, enabled);
      writeLog('integration_builder_deploy', { slug: saved.slug, toolCount: manifest.tools.length, enabled });
      return {
        ok: true,
        slug: saved.slug,
        name: saved.name,
        enabled: saved.enabled,
        tools: manifest.tools.map((t) => ({
          name: t.name,
          compiledName: compiledToolName(saved.slug, t.name),
          description: t.description,
        })),
      };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  },
});

export const run_integration = createTool({
  id: 'run_integration',
  description:
    'Execute one tool of a deployed custom integration server-side (the same path as the dashboard\'s run). ' +
    'Use this to call an integration you just deployed with deploy_integration, before its compiled tools appear in the catalog. ' +
    'Pass the integration slug, the tool name (from the manifest), and the tool args.',
  inputSchema: z.object({
    slug: z.string().describe('The integration slug (manifest.slug).'),
    toolName: z.string().describe('The manifest tool name to run (DeclarativeTool.name, not the compiled name).'),
    args: z.record(z.string(), z.any()).optional().default({}).describe('Arguments matching the tool\'s args schema.'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    result: z.any().optional(),
    error: z.string().optional(),
  }),
  execute: async (input: any) => {
    const userId = resolveUserId();
    if (!userId) return { ok: false, error: 'No authenticated user in context — cannot run an integration.' };

    const slug = String(input?.slug || '').trim();
    const toolName = String(input?.toolName || '').trim();
    if (!slug || !toolName) return { ok: false, error: 'slug and toolName are required' };
    const args = (input?.args && typeof input.args === 'object' && !Array.isArray(input.args)) ? input.args : {};

    try {
      const resolved = await getDecryptedSecrets(userId, slug);
      if (!resolved) return { ok: false, error: `No enabled integration "${slug}". Deploy it first with deploy_integration.` };
      const secrets = await ensureFreshOAuthToken(userId, resolved.manifest, resolved.secrets);
      const result = await executeDeclarativeTool(resolved.manifest, toolName, { secrets, args });
      return { ok: true, result };
    } catch (e: any) {
      if (e instanceof IntegrationExecutorError) {
        return { ok: false, error: `${e.code}: ${e.message}` };
      }
      return { ok: false, error: e?.message || String(e) };
    }
  },
});

export const INTEGRATION_BUILDER_TOOLS = {
  deploy_integration,
  run_integration,
} as const;
