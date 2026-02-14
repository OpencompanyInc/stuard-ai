import { z } from 'zod';
import { makeLocalTool } from './shared';

export const folder_permission_add = makeLocalTool(
  'folder_permission_add',
  'Add a folder to the allowed access list. When folder permissions are configured, the agent can only access listed folders. Permission levels: "read" (list/read/grep/glob), "write" (write/create/delete/move/copy), "both" (full access).',
  z.object({
    path: z.string().describe('Absolute path to the folder to allow'),
    permission: z
      .enum(['read', 'write', 'both'])
      .default('both')
      .describe('Permission level: read, write, or both'),
  }),
  z.object({
    ok: z.boolean(),
    rule: z.any().optional(),
    total_rules: z.number().optional(),
    error: z.string().optional(),
  }),
);

export const folder_permission_remove = makeLocalTool(
  'folder_permission_remove',
  'Remove a folder from the allowed access list by its rule id or path.',
  z.object({
    id: z.string().optional().describe('Rule ID to remove'),
    path: z.string().optional().describe('Folder path to remove'),
  }),
  z.object({
    ok: z.boolean(),
    message: z.string().optional(),
    total_rules: z.number().optional(),
  }),
);

export const folder_permission_list = makeLocalTool(
  'folder_permission_list',
  'List all folder permission rules. Shows which folders the agent is allowed to access and with what permissions.',
  z.object({}),
  z.object({
    ok: z.boolean(),
    enabled: z.boolean().optional(),
    rules: z.array(z.any()).optional(),
    total: z.number().optional(),
    note: z.string().optional(),
  }),
);

export const folder_permission_set_enabled = makeLocalTool(
  'folder_permission_set_enabled',
  'Enable or disable the folder limiter. When disabled, all folders are accessible.',
  z.object({
    enabled: z.boolean().describe('true to enable folder restrictions, false to disable'),
  }),
  z.object({
    ok: z.boolean(),
    enabled: z.boolean().optional(),
    error: z.string().optional(),
  }),
);

export const folder_permission_check = makeLocalTool(
  'folder_permission_check',
  'Check if a specific path is allowed for a given operation (read or write).',
  z.object({
    path: z.string().describe('Path to check'),
    operation: z.enum(['read', 'write']).default('read').describe('Operation to check'),
  }),
  z.object({
    ok: z.boolean(),
    path: z.string().optional(),
    operation: z.string().optional(),
    allowed: z.boolean().optional(),
  }),
);
