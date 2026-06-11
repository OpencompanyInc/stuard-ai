import { z } from 'zod';
import { makeLocalTool } from './shared';

// NOTE: These tools are executed on the user's machine (Desktop/Electron) via the local agent bridge.
// They provide a true PTY so interactive CLIs (Claude Code, Codex, etc.) can receive input while running.

const DEFAULT_TERMINAL_MAX_CHARS = 4000;

const terminalSessionSchema = z.object({
  id: z.string(),
  shell: z.string(),
  cwd: z.string(),
  title: z.string().optional(),
  status: z.enum(['running', 'exited']),
  exitCode: z.number().int().optional(),
});

const terminalChunkSchema = z.object({
  seq: z.number().int(),
  text: z.string(),
  raw: z.string().optional(),
});

const terminalPermissionFields = {
  isPermissionRequired: z
    .boolean()
    .describe('Set true for destructive or untrusted commands.'),
  description: z
    .string()
    .optional()
    .describe('Required when permission is needed. Shown to the user.'),
};

function withTerminalPermission<T extends z.ZodRawShape>(shape: T) {
  return z.object({ ...terminalPermissionFields, ...shape }).superRefine((value, ctx) => {
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

export const terminal_create = makeLocalTool(
  'terminal_create',
  'Start a persistent PTY terminal session.',
  withTerminalPermission({
    shell: z
      .enum(['auto', 'powershell', 'pwsh', 'cmd', 'bash', 'zsh', 'sh'])
      .optional()
      .default('auto'),
    cwd: z.string().optional(),
    cols: z.number().int().min(20).max(400).optional().default(120),
    rows: z.number().int().min(5).max(200).optional().default(30),
    // Typed record (not z.any) so the schema stays representable for strict
    // providers like Gemini, whose function-declaration validator rejects
    // typeless properties (it drops them, then errors on the dangling
    // `required` entry). See terminal_send_keys below for the same reason.
    env: z.record(z.string(), z.string()).optional().describe('Environment variables (name -> value).'),
  }),
  z.object({
    ok: z.boolean(),
    session: terminalSessionSchema.optional(),
    error: z.string().optional(),
  }),
);

export const terminal_list = makeLocalTool(
  'terminal_list',
  'List PTY terminal sessions.',
  z.object({}),
  z.object({
    ok: z.boolean(),
    sessions: z.array(terminalSessionSchema).optional(),
    error: z.string().optional(),
  }),
);

export const terminal_get = makeLocalTool(
  'terminal_get',
  'Get PTY session details.',
  z.object({
    sessionId: z.string().describe('PTY session id.'),
  }),
  z.object({
    ok: z.boolean(),
    session: terminalSessionSchema.optional(),
    error: z.string().optional(),
  }),
);

export const terminal_read = makeLocalTool(
  'terminal_read',
  'Read new PTY output since a seq cursor.',
  z.object({
    sessionId: z.string(),
    sinceSeq: z.number().int().optional().default(0),
    maxChars: z.number().int().min(100).max(50000).optional().default(DEFAULT_TERMINAL_MAX_CHARS),
    stripAnsi: z.boolean().optional().default(true),
    includeRaw: z.boolean().optional().default(false),
  }),
  z.object({
    ok: z.boolean(),
    sessionId: z.string().optional(),
    done: z.boolean().optional(),
    exitCode: z.number().int().optional(),
    seq: z.number().int().optional(),
    truncated: z.boolean().optional(),
    chunks: z.array(terminalChunkSchema).optional(),
    error: z.string().optional(),
  }),
  // Reads are fast; keep short-ish. If user is in a long-running interactive command, the model can call repeatedly.
  30000,
);

export const terminal_send_input = makeLocalTool(
  'terminal_send_input',
  'Send text to a PTY. Adds enter by default.',
  withTerminalPermission({
    sessionId: z.string(),
    input: z.string(),
    enter: z
      .boolean()
      .optional()
      .default(true)
      .describe('Press enter after typing. Defaults to true.'),
  }),
  z.object({ ok: z.boolean(), sessionId: z.string().optional(), error: z.string().optional() }),
);

export const terminal_send_raw = makeLocalTool(
  'terminal_send_raw',
  'Send raw bytes to a PTY.',
  withTerminalPermission({
    sessionId: z.string(),
    data: z.string(),
  }),
  z.object({ ok: z.boolean(), sessionId: z.string().optional(), error: z.string().optional() }),
);

export const terminal_send_keys = makeLocalTool(
  'terminal_send_keys',
  'Send special keys to a PTY.',
  withTerminalPermission({
    sessionId: z.string(),
    // Typed union (not z.any) — Gemini's strict schema validator rejects
    // typeless properties, which broke every delegated file_ops call on
    // Gemini models because this tool ships in the File Ops pack.
    keys: z
      .union([z.string(), z.array(z.string())])
      .describe('A single key (e.g. "Enter") or a list of keys.'),
  }),
  z.object({ ok: z.boolean(), sessionId: z.string().optional(), error: z.string().optional() }),
);

export const terminal_wait_for = makeLocalTool(
  'terminal_wait_for',
  'Wait until PTY output contains text.',
  z.object({
    sessionId: z.string(),
    text: z.string().describe('Text to wait for.'),
    sinceSeq: z.number().int().optional().default(0),
    timeoutMs: z.number().int().min(100).max(600000).optional().default(15000),
    pollMs: z.number().int().min(50).max(2000).optional().default(200),
    maxChars: z.number().int().min(100).max(50000).optional().default(DEFAULT_TERMINAL_MAX_CHARS),
    stripAnsi: z.boolean().optional().default(true),
    exitOnDone: z
      .boolean()
      .optional()
      .default(true)
      .describe('Return early if the session exits.'),
  }),
  z.object({
    ok: z.boolean(),
    sessionId: z.string().optional(),
    matched: z.boolean().optional(),
    timeout: z.boolean().optional(),
    seq: z.number().int().optional(),
    done: z.boolean().optional(),
    exitCode: z.number().int().optional(),
    error: z.string().optional(),
  }),
  (ctx) => {
    try {
      const ms = Number((ctx as any)?.timeoutMs);
      if (Number.isFinite(ms) && ms > 0) return Math.min(ms + 15000, 600000);
    } catch {}
    return 30000;
  },
);

export const terminal_destroy = makeLocalTool(
  'terminal_destroy',
  'Close a PTY session.',
  withTerminalPermission({
    sessionId: z.string(),
  }),
  z.object({ ok: z.boolean(), destroyed: z.boolean().optional(), error: z.string().optional() }),
);


