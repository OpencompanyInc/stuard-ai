import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  coerceToolInputSchema,
  normalizeToolInputForSchema,
  withToolInputCoercion,
  zodToJsonSchema,
} from './zod-utils';

describe('tool input coercion', () => {
  const schema = z.object({
    query: z.string(),
    search_domain_filter: z.array(z.string()).max(10).optional(),
    retry_on_status: z.array(z.number().int()).optional(),
  });

  it('coerces scalar values into array fields before validation', () => {
    const input = {
      query: 'weather today Lewis Center Ohio',
      search_domain_filter: 'weather.com',
      retry_on_status: '429, 500',
    };

    const normalized = normalizeToolInputForSchema(schema, input);

    expect(normalized).toEqual({
      query: 'weather today Lewis Center Ohio',
      search_domain_filter: ['weather.com'],
      retry_on_status: [429, 500],
    });
    expect(schema.safeParse(normalized).success).toBe(true);
  });

  it('wraps schemas so Zod accepts common LLM tool-call shape mistakes', () => {
    const wrappedSchema = coerceToolInputSchema(schema);
    const parsed = wrappedSchema.parse({
      query: 'weather today Lewis Center Ohio',
      search_domain_filter: 'weather.com',
    });

    expect(parsed.search_domain_filter).toEqual(['weather.com']);
  });

  it('preserves the original JSON schema shape for providers', () => {
    const jsonSchema = zodToJsonSchema(coerceToolInputSchema(schema));

    expect(jsonSchema.properties.search_domain_filter).toMatchObject({
      type: 'array',
      items: { type: 'string' },
    });
  });

  it('normalizes args passed through wrapped tool execute paths', async () => {
    const tool = withToolInputCoercion({
      id: 'web_search',
      inputSchema: schema,
      execute: async (args: any) => args,
    });

    await expect((tool as any).execute({
      query: 'weather today Lewis Center Ohio',
      search_domain_filter: 'weather.com',
    }, {})).resolves.toMatchObject({
      query: 'weather today Lewis Center Ohio',
      search_domain_filter: ['weather.com'],
    });
  });

  it('coerces empty strings to null for required nullable fields', () => {
    const inspectSchema = z.object({
      mode: z.enum(['overview', 'node_flow', 'trigger_flow', 'wire']),
      nodeId: z.string().nullable(),
      triggerId: z.string().nullable(),
      from: z.string().nullable(),
      to: z.string().nullable(),
      index: z.number().int().min(0).nullable(),
      stuardFile: z.string().nullable(),
    });

    const normalized = normalizeToolInputForSchema(inspectSchema, {
      mode: 'overview',
      nodeId: '',
      triggerId: '',
      from: '',
      to: '',
      index: '',
      stuardFile: '',
    });

    expect(normalized).toEqual({
      mode: 'overview',
      nodeId: null,
      triggerId: null,
      from: null,
      to: null,
      index: null,
      stuardFile: null,
    });
    expect(inspectSchema.safeParse(normalized).success).toBe(true);
  });

  it('fills omitted required nullable fields with null', () => {
    const inspectSchema = z.object({
      mode: z.enum(['overview', 'node_flow', 'trigger_flow', 'wire']),
      nodeId: z.string().nullable(),
      triggerId: z.string().nullable(),
      from: z.string().nullable(),
      to: z.string().nullable(),
      index: z.number().int().min(0).nullable(),
      stuardFile: z.string().nullable(),
    });

    const normalized = normalizeToolInputForSchema(inspectSchema, { mode: 'overview' });

    expect(normalized).toEqual({
      mode: 'overview',
      nodeId: null,
      triggerId: null,
      from: null,
      to: null,
      index: null,
      stuardFile: null,
    });
    expect(inspectSchema.safeParse(normalized).success).toBe(true);
  });
});
