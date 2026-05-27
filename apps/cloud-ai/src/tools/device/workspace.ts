import { z } from 'zod';
import { makeLocalTool } from './shared';

export const workspace_read_file = makeLocalTool(
  'workspace_read_file',
  'Read a file from the current workflow\'s workspace directory. The flowId is auto-injected by the engine. Use paths relative to the workspace root (e.g. "data/config.json", "assets/image.png").',
  z.object({
    path: z.string().describe('Relative file path within workspace (e.g. "data/config.json")'),
    flowId: z.string().optional().describe('Auto-injected by engine — the current workflow ID'),
  }),
  z.object({
    ok: z.boolean(),
    content: z.string().optional(),
    size: z.number().optional(),
    updatedAt: z.string().optional(),
    error: z.string().optional(),
  }),
);

export const workspace_write_file = makeLocalTool(
  'workspace_write_file',
  'Write/create a file in the current workflow\'s workspace directory. Creates parent directories automatically. Use paths relative to the workspace root. IMPORTANT: include a short description explaining what you are writing and why; the workflow chat shows it in the approval bar.',
  z.object({
    path: z.string().describe('Relative file path within workspace (e.g. "data/config.json")'),
    content: z.string().describe('File content to write'),
    description: z.string().optional().describe('Short user-facing explanation shown in the workflow chat approval bar'),
    flowId: z.string().optional().describe('Auto-injected by engine'),
  }),
  z.object({
    ok: z.boolean(),
    error: z.string().optional(),
  }),
);

export const workspace_delete_file = makeLocalTool(
  'workspace_delete_file',
  'Delete a file or directory from the current workflow\'s workspace.',
  z.object({
    path: z.string().describe('Relative path to delete'),
    flowId: z.string().optional().describe('Auto-injected by engine'),
  }),
  z.object({
    ok: z.boolean(),
    error: z.string().optional(),
  }),
);

export const workspace_list_files = makeLocalTool(
  'workspace_list_files',
  'List files and folders in the current workflow\'s workspace directory (or a subpath). Returns up to 500 entries by default (hard max 2000). Use limit/offset to paginate.',
  z.object({
    path: z.string().optional().describe('Subpath to list (default: workspace root)'),
    limit: z.number().int().positive().optional().describe('Max entries to return (default 500, hard max 2000)'),
    offset: z.number().int().nonnegative().optional().describe('Number of entries to skip (default 0)'),
    flowId: z.string().optional().describe('Auto-injected by engine'),
  }),
  z.object({
    ok: z.boolean(),
    files: z.array(z.object({
      name: z.string(),
      path: z.string(),
      type: z.enum(['file', 'directory']),
      size: z.number().optional(),
      updatedAt: z.string().optional(),
    })).optional(),
    count: z.number().optional(),
    truncated: z.boolean().optional(),
    total: z.number().optional(),
    error: z.string().optional(),
  }),
);

export const workspace_create_folder = makeLocalTool(
  'workspace_create_folder',
  'Create a subdirectory in the current workflow\'s workspace.',
  z.object({
    path: z.string().describe('Relative folder path to create (e.g. "data/exports")'),
    flowId: z.string().optional().describe('Auto-injected by engine'),
  }),
  z.object({
    ok: z.boolean(),
    error: z.string().optional(),
  }),
);

export const workspace_get_info = makeLocalTool(
  'workspace_get_info',
  'Get workspace info for the current workflow: absolute path, subdirectories, and all files.',
  z.object({
    flowId: z.string().optional().describe('Auto-injected by engine'),
  }),
  z.object({
    ok: z.boolean(),
    workspacePath: z.string().optional(),
    subdirs: z.array(z.string()).optional(),
    files: z.array(z.object({
      name: z.string(),
      path: z.string(),
      type: z.enum(['file', 'directory']),
      size: z.number().optional(),
      updatedAt: z.string().optional(),
    })).optional(),
    error: z.string().optional(),
  }),
);
