import { describe, expect, it, beforeAll } from 'vitest';
import { z } from 'zod';
import { ensureExecutionToolsRegistered } from '../orchestrator/execution-tools-bootstrap';
import { resolveExecutionTools } from '../orchestrator/execution-tools-resolver';
// Orchestrator-active tools that are NOT in the execution universe
// (resolveExecutionTools). The orchestrator agent is built with executionTools
// ∪ these, and ALL of those schemas are serialized to the provider (the
// `activeTools` option restricts which the model may CALL, not which schemas are
// sent) — so a bad schema anywhere in this superset reaches Gemini and 400s.
import { ORCHESTRATOR_DELEGATION_TOOLS } from '../orchestrator/delegation-tools';
import { ask_user } from './ask-user';
import { chatUiTool } from './meta-tools';
import { get_skill_info } from './skill-tools';
import { RESEARCH_MODE_TOOLS } from './research-mode';
import { variablesTool } from './chat-variables';
import * as projectTools from './device/projects';

/**
 * Gemini's GenerateContentRequest validator rejects any tool whose `required[]`
 * names a property that is type-less in the emitted JSON Schema — it drops the
 * type-less property and then 400s: "...required[N]: property is not defined".
 * Bare z.any() (and z.any().default(), since a default makes the field required
 * in output mode) is the usual cause. OpenAI/Anthropic tolerate it, so it only
 * breaks Gemini. The blessed fix in this repo is z.object({}).loose() (see
 * workflow-system.ts ToolArgsSchema). This test guards the whole tool universe
 * so a new z.any()-required field can't silently break every Gemini call.
 */
function propIsTypeless(p: any): boolean {
  if (!p || typeof p !== 'object') return true;
  if (typeof p.type === 'string') return false;
  if (Array.isArray(p.enum) || Array.isArray(p.anyOf) || Array.isArray(p.oneOf) || Array.isArray(p.allOf)) return false;
  if (p.$ref) return false;
  if (p.properties || p.items) return false;
  // NB: additionalProperties alone does NOT save a property in Gemini's eyes —
  // a record whose value schema is z.any() emits {additionalProperties:{}} with
  // no top-level `type`, which Gemini still drops. Only a concrete `type` counts.
  return true; // {} or description-only → Gemini drops it
}

/**
 * Convert exactly as Mastra/AI-SDK does for the provider: zod v4 native
 * z.toJSONSchema in OUTPUT mode (so .default() fields become required, the way
 * the provider sees them) with unrepresentable types (z.any()) emitted as {}
 * instead of throwing. This is what reaches Gemini — NOT the display-oriented
 * zodToJsonSchema util (which normalizes types and hides the bug).
 */
function toProviderJsonSchema(schema: any): any {
  const target = (schema as any)?.__stuardBaseSchema ?? schema;
  return z.toJSONSchema(target, { io: 'output', unrepresentable: 'any' } as any);
}

describe('Gemini tool-schema safety', () => {
  let offenders: string[];

  beforeAll(async () => {
    await ensureExecutionToolsRegistered();
    const tools: Record<string, any> = {
      ...resolveExecutionTools(),
      // Orchestrator-only active tools (not in the universe) — these DO get sent
      // to the provider for an orchestrator turn, so they must be Gemini-safe too.
      ...ORCHESTRATOR_DELEGATION_TOOLS,
      ask_user,
      chat_ui: chatUiTool,
      get_skill_info,
      variables: variablesTool,
      ...RESEARCH_MODE_TOOLS,
      ...projectTools,
    };
    offenders = [];
    for (const [name, tool] of Object.entries<any>(tools)) {
      const schema = tool?.inputSchema;
      if (!schema) continue;
      let json: any;
      try { json = toProviderJsonSchema(schema); } catch { continue; }
      const props = json?.properties || {};
      const required: string[] = Array.isArray(json?.required) ? json.required : [];
      for (const r of required) {
        const p = props[r];
        if (p === undefined) offenders.push(`${name}.${r} (required, not in properties)`);
        else if (propIsTypeless(p)) offenders.push(`${name}.${r} (required but type-less → z.any()? use z.object({}).loose())`);
      }
    }
  }, 60_000);

  it('has no tool with a required type-less property (Gemini 400 risk)', () => {
    expect(offenders, `Gemini-invalid required fields:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });
});
