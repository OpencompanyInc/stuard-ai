import { z } from 'zod';
import { makeLocalTool } from './shared';

// NOTE: These tools are executed on the user's machine (Desktop/Electron) via the local agent bridge.
// They provide a true PTY so interactive CLIs (Claude Code, Codex, etc.) can receive input while running.

export const terminal_create = makeLocalTool(
  'terminal_create',
  'Create an interactive PTY terminal session. Use this for interactive CLIs (claude, codex) or anything that needs live stdin while running.',
  z.object({
    description: z
      .string()
      .optional()
      .describe('Explain to the user what terminal session will be used for (shown for approval).'),
    shell: z
      .enum(['auto', 'powershell', 'pwsh', 'cmd', 'bash', 'zsh', 'sh'])
      .optional()
      .default('auto'),
    cwd: z.string().optional(),
    cols: z.number().int().min(20).max(400).optional().default(120),
    rows: z.number().int().min(5).max(200).optional().default(30),
    env: z.any().optional().describe('Environment variables as a key-value object.'),
  }),
  z.object({
    ok: z.boolean(),
    session: z
      .object({
        id: z.string(),
        pid: z.number().int(),
        shell: z.string(),
        cwd: z.string(),
        title: z.string(),
        createdAt: z.number().int(),
        lastActivity: z.number().int(),
        cols: z.number().int(),
        rows: z.number().int(),
        status: z.enum(['running', 'exited']),
        exitCode: z.number().int().optional(),
      })
      .optional(),
    error: z.string().optional(),
  }),
);

export const terminal_list = makeLocalTool(
  'terminal_list',
  'List active PTY terminal sessions.',
  z.object({}),
  z.object({
    ok: z.boolean(),
    sessions: z
      .array(
        z.object({
          id: z.string(),
          pid: z.number().int(),
          shell: z.string(),
          cwd: z.string(),
          title: z.string(),
          createdAt: z.number().int(),
          lastActivity: z.number().int(),
          cols: z.number().int(),
          rows: z.number().int(),
          status: z.enum(['running', 'exited']),
          exitCode: z.number().int().optional(),
        }),
      )
      .optional(),
    error: z.string().optional(),
  }),
);

export const terminal_get = makeLocalTool(
  'terminal_get',
  'Get details for a PTY terminal session.',
  z.object({
    sessionId: z.string().describe('The PTY session id (from terminal_create).'),
  }),
  z.object({
    ok: z.boolean(),
    session: z
      .object({
        id: z.string(),
        pid: z.number().int(),
        shell: z.string(),
        cwd: z.string(),
        title: z.string(),
        createdAt: z.number().int(),
        lastActivity: z.number().int(),
        cols: z.number().int(),
        rows: z.number().int(),
        status: z.enum(['running', 'exited']),
        exitCode: z.number().int().optional(),
      })
      .optional(),
    error: z.string().optional(),
  }),
);

export const terminal_read = makeLocalTool(
  'terminal_read',
  'Read incremental PTY output using a seq cursor. Use repeatedly to stream output and to detect prompts before sending more input.',
  z.object({
    sessionId: z.string(),
    sinceSeq: z.number().int().optional().default(0),
    maxChars: z.number().int().min(100).max(50000).optional().default(8000),
    stripAnsi: z.boolean().optional().default(true),
  }),
  z.object({
    ok: z.boolean(),
    sessionId: z.string().optional(),
    done: z.boolean().optional(),
    exitCode: z.number().int().optional(),
    seq: z.number().int().optional(),
    truncated: z.boolean().optional(),
    chunks: z
      .array(
        z.object({
          seq: z.number().int(),
          ts: z.number().int(),
          stream: z.string().optional(),
          text: z.string(),
          raw: z.string().optional(),
        }),
      )
      .optional(),
    error: z.string().optional(),
  }),
  // Reads are fast; keep short-ish. If user is in a long-running interactive command, the model can call repeatedly.
  30000,
);

export const terminal_send_input = makeLocalTool(
  'terminal_send_input',
  'Send input to the PTY. By default it adds a newline (executes command), but can be set to just type.',
  z.object({
    description: z
      .string()
      .optional()
      .describe('Explain what you are sending and why (shown for approval).'),
    sessionId: z.string(),
    input: z.string(),
    enter: z
      .boolean()
      .optional()
      .default(true)
      .describe('Whether to press enter after typing the input. Defaults to true.'),
  }),
  z.object({ ok: z.boolean(), sessionId: z.string().optional(), inputLength: z.number().int().optional(), error: z.string().optional() }),
);

export const terminal_send_raw = makeLocalTool(
  'terminal_send_raw',
  'Send raw input to the PTY (no newline). Use for incremental typing, escape sequences, or when you need full control.',
  z.object({
    description: z
      .string()
      .optional()
      .describe('Explain what you are sending and why (shown for approval).'),
    sessionId: z.string(),
    data: z.string(),
  }),
  z.object({ ok: z.boolean(), sessionId: z.string().optional(), length: z.number().int().optional(), error: z.string().optional() }),
);

export const terminal_send_keys = makeLocalTool(
  'terminal_send_keys',
  'Send special keys to the PTY (enter, ctrl+c, arrows, etc.).',
  z.object({
    description: z
      .string()
      .optional()
      .describe('Explain what keys are sent and why (shown for approval).'),
    sessionId: z.string(),
    keys: z.any().describe('The key or keys to send. Can be a string like "enter" or an array of strings like ["up","enter"].'),
  }),
  z.object({ ok: z.boolean(), sessionId: z.string().optional(), error: z.string().optional() }),
);

export const terminal_wait_for = makeLocalTool(
  'terminal_wait_for',
  'Wait until PTY output contains a substring (polling terminal_read internally). Handy to pause until a prompt appears.',
  z.object({
    sessionId: z.string(),
    text: z.string().describe('Substring to wait for in output.'),
    sinceSeq: z.number().int().optional().default(0),
    timeoutMs: z.number().int().min(100).max(600000).optional().default(15000),
    pollMs: z.number().int().min(50).max(2000).optional().default(200),
    maxChars: z.number().int().min(100).max(50000).optional().default(8000),
    stripAnsi: z.boolean().optional().default(true),
  }),
  z.object({
    ok: z.boolean(),
    sessionId: z.string().optional(),
    matched: z.boolean().optional(),
    needle: z.string().optional(),
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
  'Destroy/kill a PTY terminal session.',
  z.object({
    description: z
      .string()
      .optional()
      .describe('Explain why the session is being closed (shown for approval).'),
    sessionId: z.string(),
  }),
  z.object({ ok: z.boolean(), destroyed: z.boolean().optional(), error: z.string().optional() }),
);


