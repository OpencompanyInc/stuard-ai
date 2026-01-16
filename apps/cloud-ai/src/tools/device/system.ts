import { z } from 'zod';
import { makeLocalTool } from './shared';

export const launch_application_or_uri = makeLocalTool(
  'launch_application_or_uri',
  'Launch applications or open URLs',
  z.object({ target: z.string(), args: z.array(z.string()).optional() }),
);

export const run_system_command = makeLocalTool(
  'run_system_command',
  'Execute system commands with timeout. IMPORTANT: Always provide a clear description explaining what this command does and why you are running it.',
  z.object({
    command: z.string(),
    description: z
      .string()
      .describe('A clear, non-technical explanation of what this command does and why you are running it. This will be shown to the user for approval.'),
    timeoutMs: z.number().int().min(100).max(600000).default(30000),
    shell: z.boolean().default(true),
    background: z
      .boolean()
      .optional()
      .default(false)
      .describe('If true, run in background and return a terminalId for live polling.'),
    terminalId: z.string().optional().describe('Optional caller-provided terminal ID to reuse/track a session.'),
  }),
  z.object({
    ok: z.boolean().optional(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
    exitCode: z.number().int().optional(),
    terminalId: z.string().optional(),
    pid: z.number().int().optional(),
    status: z.string().optional(),
    shell: z.string().optional(),
  }),
);

export const run_command = makeLocalTool(
  'run_command',
  'Run shell commands cross-platform (auto/cmd/powershell/bash/sh) with timeout. IMPORTANT: Always provide a clear description explaining what this command does and why you are running it.',
  z.object({
    command: z.string(),
    description: z
      .string()
      .describe('A clear, non-technical explanation of what this command does and why you are running it. This will be shown to the user for approval.'),
    shell: z.enum(['auto', 'cmd', 'powershell', 'bash', 'sh']).default('auto'),
    timeoutMs: z.number().int().min(100).max(600000).default(30000),
    cwd: z.string().optional(),
    background: z
      .boolean()
      .optional()
      .default(false)
      .describe('If true, run in background and return a terminalId for live polling.'),
    terminalId: z.string().optional().describe('Optional caller-provided terminal ID to reuse/track a session.'),
  }),
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
  'List active and recent terminal sessions created by background run_command/run_system_command calls.',
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
