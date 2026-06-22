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

/** Accept a manifest as an object or a JSON string (models sometimes stringify). */
function coerceManifest(raw: any): { manifest?: IntegrationManifest; error?: string } {
  let m = raw;
  if (typeof m === 'string') {
    try { m = JSON.parse(m); } catch { return { error: 'manifest must be a JSON object (failed to parse string)' }; }
  }
  if (!m || typeof m !== 'object' || Array.isArray(m)) return { error: 'manifest must be a JSON object' };
  const shapeErr = validateManifestShape(m);
  if (shapeErr) return { error: shapeErr };
  return { manifest: m as IntegrationManifest };
}

export const deploy_integration = createTool({
  id: 'deploy_integration',
  description:
    'Deploy (create or update) a custom HTTP integration from a declarative manifest, scoped to the current user. ' +
    'Pass the full manifest (slug, name, version, auth, outbound_hosts, tools). Optionally pass secrets (API keys etc. by auth-field name) ' +
    'and enabled. Returns the compiled tool names you can immediately call with run_integration. ' +
    'Author the manifest per the integration-manifest schema; verify real endpoints with web_search/scrape_url before deploying.',
  inputSchema: z.object({
    // Loose object (NOT z.any()): a required z.any() emits a type-less JSON Schema
    // property that Gemini drops and then 400s on ("required[0]: property is not
    // defined"). z.object({}).loose() keeps it free-form but gives Gemini a
    // concrete `type: object`. The coercion layer still accepts a JSON string.
    manifest: z.object({}).loose().describe('The full integration manifest object (slug, name, version, auth, outbound_hosts, tools). A JSON string is also accepted.'),
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
