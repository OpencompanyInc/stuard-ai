import { z } from 'zod';
import { makeLocalTool } from './shared';

export const read_file = makeLocalTool(
  'read_file',
  'Read text file contents. For files over 500 lines, you must specify line_start and line_end to read a portion. Returns total_lines count for all files.',
  z.object({
    path: z.string().describe('Path to the file to read'),
    line_start: z.number().int().positive().optional().describe('Starting line number (1-indexed, inclusive). Required for large files.'),
    line_end: z.number().int().positive().optional().describe('Ending line number (1-indexed, inclusive). Required for large files.'),
  }),
  z.object({
    ok: z.boolean(),
    content: z.string().optional(),
    total_lines: z.number().optional(),
    line_start: z.number().optional(),
    line_end: z.number().optional(),
    lines_returned: z.number().optional(),
    error: z.string().optional(),
    message: z.string().optional(),
  }),
);

export const write_file = makeLocalTool(
  'write_file',
  'Write content to files. IMPORTANT: Always provide a clear description explaining what you are writing and why.',
  z.object({
    path: z.string(),
    content: z.string(),
    description: z
      .string()
      .describe('A clear, non-technical explanation of what file you are creating/modifying and why. This will be shown to the user for approval.'),
    append: z.boolean().optional(),
  }),
);

export const create_directory = makeLocalTool('create_directory', 'Create directories', z.object({ path: z.string() }));

export const list_directory = makeLocalTool(
  'list_directory',
  'List directory contents',
  z.object({ path: z.string() }),
  z.object({ items: z.array(z.object({ name: z.string(), type: z.enum(['file', 'dir']) })) }),
);

export const open_file = makeLocalTool(
  'open_file',
  'Open a file or folder with the default application',
  z.object({ path: z.string().describe('Path to the file or directory to open') }),
  z.object({ ok: z.boolean(), opened: z.string().optional(), method: z.string().optional(), error: z.string().optional() }),
);

export const move_file = makeLocalTool(
  'move_file',
  'Move/rename files and directories',
  z.object({ src: z.string(), dest: z.string() }),
);

export const copy_file = makeLocalTool('copy_file', 'Copy file to a new location', z.object({ src: z.string(), dest: z.string() }));

export const delete_file = makeLocalTool('delete_file', 'Delete a file', z.object({ path: z.string() }));

export const get_clipboard_content = makeLocalTool(
  'get_clipboard_content',
  'Read clipboard text',
  z.object({}),
  z.object({ text: z.string().optional() }),
);

export const set_clipboard_content = makeLocalTool(
  'set_clipboard_content',
  'Set clipboard text',
  z.object({ text: z.string() }),
);

// Checkpoint Tools

export const checkpoint_create = makeLocalTool(
  'checkpoint_create',
  'Create a filesystem checkpoint to allow reverting changes later.',
  z.object({ name: z.string().optional().describe('Optional name for the checkpoint') }),
  z.object({ ok: z.boolean(), id: z.string() })
);

export const checkpoint_restore = makeLocalTool(
  'checkpoint_restore',
  'Revert filesystem changes to a previous checkpoint. This is a destructive operation.',
  z.object({ id: z.string().optional().describe('Checkpoint ID to restore. If omitted, restores the latest active checkpoint.') }),
  z.object({ ok: z.boolean(), restored: z.number(), errors: z.array(z.string()) })
);

export const checkpoint_redo = makeLocalTool(
  'checkpoint_redo',
  'Re-apply file changes that were previously reverted from a checkpoint.',
  z.object({ id: z.string().describe('Checkpoint ID whose revert should be undone.') }),
  z.object({ ok: z.boolean(), restored: z.number(), errors: z.array(z.string()) })
);

export const checkpoint_list = makeLocalTool(
  'checkpoint_list',
  'List available filesystem checkpoints.',
  z.object({}),
  z.object({ ok: z.boolean(), checkpoints: z.array(z.any()) })
);
