import { z } from 'zod';
import { makeLocalTool } from './shared';

const runCommandInputSchema = z.object({
  command: z.string(),
  isPermissionRequired: z
    .boolean()
    .describe('Required. Set to false for read-only inspection commands. Set to true for commands that write files, install packages, change system state, or could be destructive.'),
  description: z
    .string()
    .optional()
    .describe('Required when isPermissionRequired is true. A clear, non-technical explanation of what this command does and why you are running it. This will be shown to the user for approval.'),
  shell: z
    .enum(['auto', 'default', 'cmd', 'powershell', 'bash', 'sh'])
    .default('auto')
    .describe('auto prefers a modern cross-platform shell; default uses the platform default shell (cmd on Windows, sh on Unix).'),
  timeoutMs: z.number().int().min(100).max(600000).default(30000),
  cwd: z.string().optional(),
  checkpoint: z
    .boolean()
    .optional()
    .default(false)
    .describe('When true, create a filesystem checkpoint before execution for potential rollback.'),
  background: z
    .boolean()
    .optional()
    .default(false)
    .describe('If true, run in background and return a terminalId for live polling.'),
  terminalId: z.string().optional().describe('Optional caller-provided terminal ID to reuse/track a session.'),
  forwardToStreamId: z
    .string()
    .optional()
    .describe('If set, forward live stdout/stderr output chunks to this stream id (only meaningful when background=true).'),
}).superRefine((value, ctx) => {
  if (value.isPermissionRequired && !value.description?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['description'],
      message: 'description is required when isPermissionRequired is true',
    });
  }
});

export const launch_application_or_uri = makeLocalTool(
  'launch_application_or_uri',
  'Launch applications or open URLs',
  z.object({ target: z.string(), args: z.array(z.string()).optional() }),
);

export const run_command = makeLocalTool(
  'run_command',
  'Run shell commands cross-platform (auto/default/cmd/powershell/bash/sh) with timeout. Set isPermissionRequired=false for read-only inspection commands and true for write/destructive commands.',
  runCommandInputSchema,
  z.object({
    ok: z.boolean().optional(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
    exitCode: z.number().int().optional(),
    shell: z.string().optional(),
    terminalId: z.string().optional(),
    pid: z.number().int().optional(),
    status: z.string().optional(),
  }),
  (ctx) => {
    try {
      const ms = Number((ctx as any)?.timeoutMs);
      if (Number.isFinite(ms) && ms > 0) {
        return Math.min(ms + 15000, 600000);
      }
    } catch {}
    return 300000;
  },
);

export const list_terminals = makeLocalTool(
  'list_terminals',
  'List active and recent terminal sessions created by background run_command calls.',
  z.object({}),
  z.object({
    ok: z.boolean().optional(),
    terminals: z
      .array(
        z.object({
          terminalId: z.string(),
          command: z.string().optional(),
          shell: z.string().optional(),
          cwd: z.string().nullable().optional(),
          pid: z.number().int().optional(),
          done: z.boolean().optional(),
          exitCode: z.number().int().nullable().optional(),
          updatedAtMs: z.number().int().optional(),
          createdAtMs: z.number().int().optional(),
          seq: z.number().int().optional(),
        }),
      )
      .optional(),
  }),
);

export const read_terminal = makeLocalTool(
  'read_terminal',
  'Read incremental terminal output for a specific terminalId. Use sinceSeq to poll new output as it streams.',
  z.object({
    terminalId: z.string(),
    sinceSeq: z.number().int().optional().default(0),
    maxChars: z.number().int().min(100).max(50000).optional().default(8000),
  }),
  z.object({
    ok: z.boolean().optional(),
    terminalId: z.string().optional(),
    command: z.string().optional(),
    shell: z.string().optional(),
    cwd: z.string().nullable().optional(),
    pid: z.number().int().optional(),
    done: z.boolean().optional(),
    exitCode: z.number().int().nullable().optional(),
    seq: z.number().int().optional(),
    chunks: z
      .array(
        z.object({
          seq: z.number().int(),
          ts: z.number().int().optional(),
          stream: z.string().optional(),
          text: z.string(),
        }),
      )
      .optional(),
    truncated: z.boolean().optional(),
    error: z.string().optional(),
  }),
);
