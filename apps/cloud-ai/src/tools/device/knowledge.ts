import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { execLocalTool, hasClientBridge, makeLocalTool } from './shared';

export const knowledge_add_instruction = createTool({
  id: 'knowledge_add_instruction',
  description:
    'Add a system instruction that the AI should always follow. Use this when the user tells you how they want you to behave.',
  inputSchema: z.object({
    instruction: z
      .string()
      .describe('The instruction to remember (e.g., "Always be concise", "Use Python for scripts")'),
  }),
  outputSchema: z.object({ ok: z.boolean(), fact: z.any().optional(), error: z.string().optional() }),
  execute: async ({ context }) => {
    const c = context as any;
    if (!hasClientBridge()) return { ok: false, error: 'No client bridge available' };
    return execLocalTool(
      'knowledge_add_fact',
      {
        category: 'instruction',
        subtype: 'system',
        text: c.instruction,
        source: 'ai_extracted',
      },
      undefined,
      5000,
    );
  },
});

export const knowledge_remember_about_user = createTool({
  id: 'knowledge_remember_about_user',
  description:
    'Remember a personal fact about the user (preferences, habits, relationships, hobbies). Use this for bio-style information.',
  inputSchema: z.object({
    fact: z
      .string()
      .describe('The fact to remember (e.g., "Has a dog named Max", "Prefers dark mode")'),
  }),
  outputSchema: z.object({ ok: z.boolean(), fact: z.any().optional(), error: z.string().optional() }),
  execute: async ({ context }) => {
    const c = context as any;
    if (!hasClientBridge()) return { ok: false, error: 'No client bridge available' };
    return execLocalTool(
      'knowledge_add_fact',
      {
        category: 'personal',
        subtype: 'bio',
        text: c.fact,
        source: 'ai_extracted',
      },
      undefined,
      5000,
    );
  },
});

export const knowledge_update_profile = createTool({
  id: 'knowledge_update_profile',
  description:
    'Update a core profile attribute (overwrites previous value). Keys: name, nickname, birthday, country, timezone, occupation, email, language, os, gpu, cpu, ram, shell, editor.',
  inputSchema: z.object({
    key: z.string().describe('The profile key to update'),
    value: z.string().describe('The new value'),
  }),
  outputSchema: z.object({ ok: z.boolean(), fact: z.any().optional(), error: z.string().optional() }),
  execute: async ({ context }) => {
    const c = context as any;
    if (!hasClientBridge()) return { ok: false, error: 'No client bridge available' };
    return execLocalTool(
      'knowledge_upsert_core',
      {
        key: c.key,
        value: c.value,
        source: 'ai_extracted',
      },
      undefined,
      5000,
    );
  },
});

export const knowledge_add_project_fact = createTool({
  id: 'knowledge_add_project_fact',
  description: 'Add a fact about a project, tool, person, or company. Creates the entity if it does not exist.',
  inputSchema: z.object({
    entity_name: z.string().describe('Name of the project/person/tool/company'),
    entity_type: z.enum(['project', 'person', 'company', 'tool', 'topic']).default('project'),
    fact: z.string().describe('The fact to remember about this entity'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    fact: z.any().optional(),
    entity: z.any().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ context }) => {
    const c = context as any;
    if (!hasClientBridge()) return { ok: false, error: 'No client bridge available' };

    // Find or create entity
    let entity = await execLocalTool('knowledge_find_entity', { name: c.entity_name }, undefined, 5000);
    if (!entity?.id) {
      entity = await execLocalTool(
        'knowledge_create_entity',
        {
          name: c.entity_name,
          type: c.entity_type || 'project',
        },
        undefined,
        5000,
      );
    }

    // Add fact
    const result = await execLocalTool(
      'knowledge_add_fact',
      {
        category: 'project',
        subtype: 'detail',
        text: c.fact,
        entity_id: entity?.id,
        source: 'ai_extracted',
      },
      undefined,
      5000,
    );

    return { ...result, entity };
  },
});

export const knowledge_get_stats = makeLocalTool(
  'knowledge_stats',
  'Get statistics about the knowledge graph (entity count, fact counts by category).',
  z.object({}),
  z.object({
    entities: z.number(),
    facts: z.number(),
    facts_by_category: z.record(z.string(), z.number()),
    entities_by_type: z.record(z.string(), z.number()),
  }),
);
