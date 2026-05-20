import { z } from 'zod';
import { makeLocalTool } from './shared';

const providerSchema = z
  .enum(['auto', 'codex', 'cursor', 'antigravity', 'anitgravity', 'claude'])
  .optional()
  .default('auto')
  .describe('Which coding-agent CLI to use. auto picks the first detected provider.');

const cliPermissionFields = {
  isPermissionRequired: z
    .boolean()
    .optional()
    .default(false)
    .describe('Set true when starting, stopping, or sending work to an external coding-agent CLI.'),
  description: z
    .string()
    .optional()
    .describe('Required when permission is needed. Shown to the user.'),
};

function withCliPermission<T extends z.ZodRawShape>(shape: T) {
  return z.object({ ...cliPermissionFields, ...shape }).superRefine((value, ctx) => {
    const v = value as { isPermissionRequired?: boolean; description?: string };
    if (v.isPermissionRequired && !v.description?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['description'],
        message: 'description is required when isPermissionRequired is true',
      });
    }
  });
}

const providerStatusSchema = z.object({
  id: z.string(),
  label: z.string(),
  available: z.boolean(),
  command: z.string().optional(),
  commandPath: z.string().nullable().optional(),
  detectedAliases: z.array(z.string()).optional(),
  configPaths: z.array(z.string()).optional(),
  hasConfig: z.boolean().optional(),
  version: z.string().nullable().optional(),
  homepage: z.string().optional(),
  resumeHint: z.string().optional(),
});

const cliSessionSchema = z.object({
  id: z.string(),
  provider: z.string(),
  label: z.string(),
  command: z.string(),
  terminalSessionId: z.string(),
  cwd: z.string(),
  createdAt: z.number(),
  status: z.string(),
  exitCode: z.number().int().optional(),
});

export const cli_agent_detect = makeLocalTool(
  'cli_agent_detect',
  'Detect installed coding-agent CLIs on the user desktop: Codex, Cursor Agent, Antigravity, and Claude Code.',
  z.object({}),
  z.object({
    ok: z.boolean(),
    providers: z.array(providerStatusSchema).optional(),
    available: z.array(providerStatusSchema).optional(),
    anyAvailable: z.boolean().optional(),
    error: z.string().optional(),
  }),
  30000,
  { noFallback: true },
);

export const cli_agent_start = makeLocalTool(
  'cli_agent_start',
  'Start a delegated coding-agent CLI session in a persistent PTY. Supports Codex, Cursor Agent, Antigravity, and Claude Code.',
  withCliPermission({
    provider: providerSchema,
    prompt: z.string().optional().describe('Initial task or prompt for the CLI.'),
    mode: z.enum(['interactive', 'print']).optional().default('interactive').describe('interactive opens the CLI; print uses the provider one-shot print mode when available.'),
    cwd: z.string().optional().describe('Working directory for the delegated CLI.'),
    args: z.array(z.string()).optional().describe('Extra CLI arguments for interactive mode.'),
    promptDelayMs: z.number().int().min(0).max(60000).optional().default(1200),
    cols: z.number().int().min(20).max(400).optional().default(140),
    rows: z.number().int().min(5).max(200).optional().default(36),
    env: z.any().optional().describe('Extra environment variables.'),
  }),
  z.object({
    ok: z.boolean(),
    session: cliSessionSchema.optional(),
    launch: z.any().optional(),
    error: z.string().optional(),
    provider: z.string().optional(),
    checkedAliases: z.array(z.string()).optional(),
  }),
  30000,
  { noFallback: true },
);

export const cli_agent_send = makeLocalTool(
  'cli_agent_send',
  'Send input to a delegated coding-agent CLI session. Adds Enter by default.',
  withCliPermission({
    cliSessionId: z.string().describe('CLI session id returned by cli_agent_start.'),
    input: z.string().optional().default(''),
    enter: z.boolean().optional().default(true),
  }),
  z.object({
    ok: z.boolean(),
    session: cliSessionSchema.optional(),
    error: z.string().optional(),
  }),
  30000,
  { noFallback: true },
);

export const cli_agent_read = makeLocalTool(
  'cli_agent_read',
  'Read delegated coding-agent CLI output. Use bottom mode with lineOffsetFromBottom to inspect recent output, or incremental mode with sinceSeq.',
  z.object({
    cliSessionId: z.string().describe('CLI session id returned by cli_agent_start.'),
    mode: z.enum(['bottom', 'incremental']).optional().default('bottom'),
    sinceSeq: z.number().int().optional().default(0),
    maxChars: z.number().int().min(100).max(100000).optional().default(50000),
    lineCount: z.number().int().min(1).max(1000).optional().default(80),
    lineOffsetFromBottom: z.number().int().min(0).max(100000).optional().default(0),
    stripAnsi: z.boolean().optional().default(true),
  }),
  z.object({
    ok: z.boolean(),
    session: cliSessionSchema.optional(),
    seq: z.number().int().optional(),
    done: z.boolean().optional(),
    exitCode: z.number().int().optional(),
    truncated: z.boolean().optional(),
    chunks: z.array(z.any()).optional(),
    totalLines: z.number().int().optional(),
    lineOffsetFromBottom: z.number().int().optional(),
    lineCount: z.number().int().optional(),
    lines: z.array(z.any()).optional(),
    text: z.string().optional(),
    error: z.string().optional(),
  }),
  30000,
  { noFallback: true },
);

export const cli_agent_status = makeLocalTool(
  'cli_agent_status',
  'Get delegated coding-agent CLI session status, or list all active delegated CLI sessions.',
  z.object({
    cliSessionId: z.string().optional(),
  }),
  z.object({
    ok: z.boolean(),
    session: cliSessionSchema.optional(),
    sessions: z.array(cliSessionSchema).optional(),
    error: z.string().optional(),
  }),
  30000,
  { noFallback: true },
);

export const cli_agent_stop = makeLocalTool(
  'cli_agent_stop',
  'Stop a delegated coding-agent CLI session.',
  withCliPermission({
    cliSessionId: z.string().describe('CLI session id returned by cli_agent_start.'),
  }),
  z.object({
    ok: z.boolean(),
    destroyed: z.boolean().optional(),
    session: cliSessionSchema.optional(),
    error: z.string().optional(),
  }),
  30000,
  { noFallback: true },
);
