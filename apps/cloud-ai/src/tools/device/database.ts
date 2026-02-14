import { z } from 'zod';
import { makeLocalTool } from './shared';

export const db_query = makeLocalTool(
  'db_query',
  'Execute raw SQL against the local workflow SQLite database. Use for CREATE TABLE, INSERT, UPDATE, DELETE, SELECT queries. Parameters use ? placeholders.',
  z.object({
    query: z.string().describe('SQL query to execute (use ? for parameter placeholders)'),
    params: z.array(z.any()).optional().describe('Parameter values for ? placeholders'),
  }),
  z.object({
    ok: z.boolean(),
    results: z.array(z.any()).optional(),
    count: z.number().optional(),
    affected_rows: z.number().optional(),
    error: z.string().optional(),
  }),
);

export const db_store = makeLocalTool(
  'db_store',
  'Store or update a JSON document in a named collection. Auto-creates the collection if it does not exist. If a document with the same ID exists, it is updated (upsert).',
  z.object({
    table: z.string().optional().default('default_store').describe('Collection/table name'),
    id: z.string().optional().describe('Document ID (auto-generated if omitted)'),
    data: z.record(z.string(), z.any()).describe('JSON data object to store'),
  }),
  z.object({
    ok: z.boolean(),
    id: z.string().optional(),
    table: z.string().optional(),
    error: z.string().optional(),
  }),
);

export const db_retrieve = makeLocalTool(
  'db_retrieve',
  'Retrieve a single document by its ID from a collection.',
  z.object({
    table: z.string().optional().default('default_store').describe('Collection/table name'),
    id: z.string().describe('Document ID to retrieve'),
  }),
  z.object({
    ok: z.boolean(),
    result: z.any().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
    error: z.string().optional(),
  }),
);

export const db_search = makeLocalTool(
  'db_search',
  'Search documents in a collection. Optionally filter by key-value pairs (exact match). Returns all matching documents up to limit.',
  z.object({
    table: z.string().optional().default('default_store').describe('Collection/table name'),
    filters: z.record(z.string(), z.any()).optional().describe('Key-value filters for exact matching'),
    limit: z.number().optional().default(100).describe('Maximum number of results'),
  }),
  z.object({
    ok: z.boolean(),
    results: z.array(z.any()).optional(),
    count: z.number().optional(),
    error: z.string().optional(),
  }),
);

export const db_delete = makeLocalTool(
  'db_delete',
  'Delete a document by ID from a collection.',
  z.object({
    table: z.string().optional().default('default_store').describe('Collection/table name'),
    id: z.string().describe('Document ID to delete'),
  }),
  z.object({
    ok: z.boolean(),
    deleted: z.boolean().optional(),
    error: z.string().optional(),
  }),
);

export const db_list_tables = makeLocalTool(
  'db_list_tables',
  'List all tables/collections in the workflow database.',
  z.object({}),
  z.object({
    ok: z.boolean(),
    tables: z.array(z.string()).optional(),
    count: z.number().optional(),
    error: z.string().optional(),
  }),
);
