/**
 * Compile deployed custom-integration manifests into callable agent tools.
 *
 * Mirrors the MCP pattern (mcp/client.ts getMCPToolsForIntegrations): load a
 * user's enabled integrations and turn each declarative tool into a Mastra tool
 * the agent / bots / workflows can execute. The compiled tool id is
 * `${slug}_${toolName}` (sanitized to the tool-name charset). Each tool's
 * execute() runs the declarative executor with the user's decrypted secrets.
 *
 * These tools are NOT spread always-on into the lean orchestrator prompt; they
 * live in a request-scoped registry that search_tools surfaces and execute_tool
 * resolves (see meta-tools.ts), so discovery stays cheap.
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  executeDeclarativeTool,
  IntegrationExecutorError,
} from './declarative-executor';
import type {
  IntegrationManifest,
  DeclarativeTool,
  JsonSchemaProperty,
  ToolArgsSchema,
} from './types';
import { getEnabledWithSecrets, type InstalledIntegrationWithSecrets } from './installed-store';
import { zodToJsonSchema } from '../tools/zod-utils';

const TOOL_NAME_RE = /[^a-z0-9_]/g;

/** Sanitize a slug/tool name fragment into the tool-name charset. */
function sanitizeFragment(s: string): string {
  return String(s || '').toLowerCase().replace(/-/g, '_').replace(TOOL_NAME_RE, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

/** Stable compiled tool id for an integration tool. */
export function compiledToolName(slug: string, toolName: string): string {
  return `${sanitizeFragment(slug)}_${sanitizeFragment(toolName)}`;
}

/** One searchable catalog entry for the request-scoped custom-tool registry. */
export interface CustomToolCatalogEntry {
  name: string;
  description: string;
  category: string;
  inputSchema: any;
}

export interface CompiledIntegrationTools {
  /** name (`${slug}_${tool}`) -> Mastra tool */
  tools: Record<string, any>;
  /** lightweight entries for search_tools / palettes */
  catalog: CustomToolCatalogEntry[];
}

// ─── JSON Schema (manifest args subset) → Zod ──────────────────────────────────

function propToZod(prop: JsonSchemaProperty): z.ZodTypeAny {
  let base: z.ZodTypeAny;
  switch (prop.type) {
    case 'number':
      base = z.number();
      break;
    case 'integer':
      base = z.number().int();
      break;
    case 'boolean':
      base = z.boolean();
      break;
    case 'array':
      base = z.array(prop.items ? propToZod(prop.items) : z.any());
      break;
    case 'object':
      base = prop.properties ? objectToZod(prop.properties, []) : z.record(z.string(), z.any());
      break;
    case 'string':
    default:
      base = z.string();
      break;
  }
  if (Array.isArray(prop.enum) && prop.enum.length > 0 && (prop.type === 'string' || prop.type === undefined)) {
    base = z.enum(prop.enum.map((v) => String(v)) as [string, ...string[]]);
  }
  if (prop.description) base = base.describe(prop.description);
  if (prop.default !== undefined) base = base.default(prop.default);
  return base;
}

function objectToZod(properties: Record<string, JsonSchemaProperty>, required: string[]): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {};
  const reqSet = new Set(required || []);
  for (const [key, prop] of Object.entries(properties || {})) {
    let field = propToZod(prop);
    if (!reqSet.has(key) && prop.default === undefined) field = field.optional();
    shape[key] = field;
  }
  return z.object(shape);
}

function argsSchemaToZod(args: ToolArgsSchema | undefined): z.ZodTypeAny {
  if (!args || !args.properties) return z.object({});
  return objectToZod(args.properties, args.required || []);
}

// ─── Compilation ───────────────────────────────────────────────────────────────

function compileOneTool(
  manifest: IntegrationManifest,
  tool: DeclarativeTool,
  secrets: Record<string, string>,
): { name: string; tool: any; entry: CustomToolCatalogEntry } {
  const name = compiledToolName(manifest.slug, tool.name);
  const category = manifest.category || 'Integrations';
  const description = `[${manifest.name || manifest.slug}] ${tool.description || tool.name}`.trim();
  const inputSchema = argsSchemaToZod(tool.args);

  const mastraTool = createTool({
    id: name,
    description,
    inputSchema,
    execute: async (args: any) => {
      try {
        const result = await executeDeclarativeTool(manifest, tool.name, {
          secrets,
          args: args && typeof args === 'object' ? args : {},
        });
        return result;
      } catch (e: any) {
        if (e instanceof IntegrationExecutorError) {
          return { ok: false, status: 0, body: null, headers: {}, error: `${e.code}: ${e.message}`, elapsed_ms: 0 };
        }
        return { ok: false, status: 0, body: null, headers: {}, error: e?.message || String(e), elapsed_ms: 0 };
      }
    },
  });

  return {
    name,
    tool: mastraTool,
    entry: { name, description, category, inputSchema: undefined },
  };
}

/** Build compiled tools + catalog from an already-loaded set of integrations. */
export function compileIntegrations(integrations: InstalledIntegrationWithSecrets[]): CompiledIntegrationTools {
  const tools: Record<string, any> = {};
  const catalog: CustomToolCatalogEntry[] = [];
  for (const integ of integrations) {
    const manifest = integ.manifest;
    if (!manifest || !Array.isArray(manifest.tools)) continue;
    for (const tool of manifest.tools) {
      if (!tool?.name) continue;
      try {
        const { name, tool: mastraTool, entry } = compileOneTool(manifest, tool, integ.secrets);
        tools[name] = mastraTool;
        // Attach a JSON-schema view for palettes / workflow-node discovery.
        try { entry.inputSchema = zodToJsonSchema(mastraTool.inputSchema); } catch {}
        catalog.push(entry);
      } catch {
        // Skip a malformed tool rather than failing the whole integration.
      }
    }
  }
  return { tools, catalog };
}

/**
 * Load a user's enabled integrations and compile them. Returns empty when the
 * user has none or Supabase is unconfigured. Never throws.
 */
export async function compileInstalledToTools(userId: string): Promise<CompiledIntegrationTools> {
  if (!userId) return { tools: {}, catalog: [] };
  try {
    const integrations = await getEnabledWithSecrets(userId);
    if (!integrations.length) return { tools: {}, catalog: [] };
    return compileIntegrations(integrations);
  } catch {
    return { tools: {}, catalog: [] };
  }
}
