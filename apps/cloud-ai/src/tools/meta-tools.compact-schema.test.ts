import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { zodToJsonSchema } from './zod-utils';
import { compactSchemaSignature } from './meta-tools';

describe('compactSchemaSignature', () => {
  it('renders required vs optional fields, types, enums, defaults and ranges', () => {
    const schema = zodToJsonSchema(
      z.object({
        query: z.string().describe('Natural-language search query'),
        mode: z.enum(['web', 'x']).default('web').optional(),
        max_results: z.number().int().min(1).max(20).default(5).optional(),
      }),
    );
    const sig = compactSchemaSignature(schema);

    // Required field has no "?", optional fields do.
    expect(sig.query).toMatch(/^string/);
    expect(sig.query).toContain('Natural-language search query');
    expect(sig).toHaveProperty('mode?');
    expect(sig['mode?']).toContain('enum[web|x]');
    expect(sig['mode?']).toContain('default "web"');
    expect(sig).toHaveProperty('max_results?');
    expect(sig['max_results?']).toMatch(/(number|integer)/);
    expect(sig['max_results?']).toContain('1..20');
  });

  it('handles arrays and nested objects', () => {
    const schema = zodToJsonSchema(
      z.object({
        tags: z.array(z.string()).optional(),
        bounds: z.object({ min: z.number(), max: z.number() }).optional(),
      }),
    );
    const sig = compactSchemaSignature(schema);
    expect(sig['tags?']).toContain('string[]');
    expect(sig['bounds?']).toContain('min:');
    expect(sig['bounds?']).toContain('max:');
  });

  it('truncates very long descriptions', () => {
    const long = 'x'.repeat(300);
    const schema = zodToJsonSchema(z.object({ field: z.string().describe(long) }));
    const sig = compactSchemaSignature(schema);
    expect(sig.field.length).toBeLessThan(160);
    expect(sig.field).toContain('…');
  });

  it('is dramatically smaller than the raw JSON Schema for a rich tool', () => {
    // Mirrors web_search: many fields with the long, detailed descriptions that
    // dominate the raw schema (~2.8k chars in production).
    const schema = zodToJsonSchema(
      z.object({
        query: z.string().describe('Natural-language search query. Do NOT include site:, OR, quotes, or other Google operators — use the structured filter parameters instead, they parse far more reliably.'),
        mode: z.enum(['web', 'x']).default('web').optional().describe('Search mode: "web" for general web search (default, uses Perplexity), "x" for X/Twitter post search (uses Grok).'),
        max_results: z.number().int().min(1).max(20).default(5).optional().describe('Number of web results to return (1-20, default 5). Only used in web mode and ignored otherwise entirely.'),
        search_domain_filter: z.array(z.string().max(253)).max(20).optional().describe('Restrict results to these hostnames. Pass bare hosts like "linkedin.com" or subdomains; paths are NOT supported. Prefix with "-" to exclude. Max 20.'),
        country: z.string().length(2).optional().describe('ISO 3166-1 alpha-2 country code (e.g. "US", "GB") for localized results. Only used in web mode and ignored in x mode entirely.'),
        search_recency_filter: z.enum(['hour', 'day', 'week', 'month', 'year']).optional().describe('Relative published-within window. Easier than the absolute date filters for "recent" queries. Only used in web mode.'),
      }),
    );
    const rawLen = JSON.stringify(schema).length;
    const compactLen = JSON.stringify(compactSchemaSignature(schema)).length;
    // Meaningfully smaller even when long descriptions (the irreducible bulk)
    // are preserved; full text stays reachable via get_tool_schema.
    expect(compactLen).toBeLessThan(rawLen * 0.72);
  });

  it('compacts description-light output schemas dramatically', () => {
    // Output schemas rarely carry per-field descriptions, so the raw JSON
    // Schema is almost all structural boilerplate — exactly what compaction
    // strips. search_workflow_nodes returns one of these per candidate too.
    const schema = zodToJsonSchema(
      z.object({
        ok: z.boolean(),
        value: z.number(),
        items: z.array(z.string()),
        meta: z.object({ count: z.number(), nextCursor: z.string().optional() }),
      }),
    );
    const rawLen = JSON.stringify(schema).length;
    const compactLen = JSON.stringify(compactSchemaSignature(schema)).length;
    expect(compactLen).toBeLessThan(rawLen * 0.5);
  });

  it('returns undefined for empty/missing schemas', () => {
    expect(compactSchemaSignature(undefined)).toBeUndefined();
    expect(compactSchemaSignature({})).toBeUndefined();
  });
});
