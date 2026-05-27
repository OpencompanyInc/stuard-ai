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
  'Start a delegated coding-agent CLI session in a persistent PTY. Supports Codex, Cursor Agent, Antigravity (agy), and Claude Code. Cursor workspaces are auto-trusted on launch so the Ink trust dialog never blocks; pass autoTrust: false if you want the dialog to surface.',
  withCliPermission({
    provider: providerSchema,
    prompt: z.string().optional().describe('Initial task or prompt for the CLI.'),
    mode: z.enum(['interactive', 'print']).optional().default('interactive').describe('interactive opens the CLI REPL and types the prompt in; print uses the provider one-shot print mode when available. Claude always falls back to interactive — its `-p` mode bypasses subscription auth.'),
    cwd: z.string().optional().describe('Working directory for the delegated CLI.'),
    args: z.array(z.string()).optional().describe('Extra CLI arguments. For Cursor print mode the harness already adds --trust and --model auto unless you override --model here.'),
    autoTrust: z.boolean().optional().default(true).describe('When true (default), pre-write the provider trust marker for cwd so the workspace-trust dialog never appears. Set false if you intentionally want to test the dialog.'),
    promptDelayMs: z.number().int().min(0).max(60000).optional().default(1200).describe('Fallback delay (ms) before typing the prompt when the provider has no readyPatterns. Ignored for providers with a known ready marker — those use readyTimeoutMs instead.'),
    readyTimeoutMs: z.number().int().min(500).max(120000).optional().default(30000).describe('Max time (ms) to wait for the provider REPL to print its ready marker before typing the auto-prompt. The harness types the prompt as soon as the marker appears (typically 2–10 s) or after this timeout, whichever comes first.'),
    cols: z.number().int().min(20).max(400).optional().default(140),
    rows: z.number().int().min(5).max(200).optional().default(36),
    env: z.any().optional().describe('Extra environment variables.'),
  }),
  z.object({
    ok: z.boolean(),
    session: cliSessionSchema.optional(),
    launch: z.any().optional(),
    trust: z.enum(['granted', 'already', 'unsupported', 'skipped']).optional().describe('granted = we just wrote the trust marker; already = workspace was already trusted; unsupported = provider has no auto-trust hook; skipped = caller passed autoTrust: false.'),
    readyMarker: z.string().optional().describe('The substring the provider prints once its REPL is ready (e.g. "~" for Cursor, "? for shortcuts" for Claude, "› " for Codex). Pass this to cli_agent_wait_for after sending follow-ups so you don\'t have to guess.'),
    error: z.string().optional(),
    initialPrompt: z.object({
      state: z.enum(['pending', 'sent', 'failed']),
      createdAt: z.number(),
    }).optional().describe('When a prompt is supplied in interactive mode, it is queued until the REPL is ready; cli_agent_wait_idle waits for this to send before declaring idle.'),
    provider: z.string().optional(),
    checkedAliases: z.array(z.string()).optional(),
  }),
  30000,
  { noFallback: true },
);

export const cli_agent_send = makeLocalTool(
  'cli_agent_send',
  'Send input to a delegated coding-agent CLI session. Use `input` for free-form text (Enter is added by default). Use `keys` for navigating TUI dialogs — named keys like "Up", "Down", "Enter", "Esc", "Tab", "Space", "Backspace", "ctrl+c", or single characters like "a", "y", "1". `keys` does NOT add Enter automatically (pass enter: true to append one).',
  withCliPermission({
    cliSessionId: z.string().describe('CLI session id returned by cli_agent_start.'),
    input: z.string().optional().default(''),
    keys: z.array(z.string()).optional().describe('Ordered list of key tokens for navigating Ink/TUI dialogs (e.g. ["a"] to pick "[a] Trust this workspace", or ["Down","Down","Enter"]). When provided, `input` is ignored and no automatic Enter is appended unless enter:true is also set.'),
    enter: z.boolean().optional().default(true).describe('For `input` mode: append \\r after the text (default true). For `keys` mode: append \\r after the key sequence (default false — most TUI dialogs auto-activate on key press).'),
  }),
  z.object({
    ok: z.boolean(),
    session: cliSessionSchema.optional(),
    sent: z.enum(['input', 'keys']).optional(),
    keys: z.array(z.string()).optional(),
    error: z.string().optional(),
  }),
  30000,
  { noFallback: true },
);

export const cli_agent_read = makeLocalTool(
  'cli_agent_read',
  'Read delegated coding-agent CLI output. `bottom` mode returns the last visible TUI frame (cumulative buffer collapsed at screen-clear / alt-screen escapes) — what the user is actually looking at right now, not stale dialogs that were already dismissed. Use `incremental` mode with sinceSeq to tail raw chunks. Pass `raw: true` to disable the collapse and inspect the full scrollback for forensics.',
  z.object({
    cliSessionId: z.string().describe('CLI session id returned by cli_agent_start.'),
    mode: z.enum(['bottom', 'incremental']).optional().default('bottom'),
    sinceSeq: z.number().int().optional().default(0),
    maxChars: z.number().int().min(100).max(100000).optional().default(50000),
    lineCount: z.number().int().min(1).max(1000).optional().default(40).describe('bottom mode: how many trailing lines of the rendered screen to return as `text`. Default 40 — raise only if you need more scrollback context.'),
    lineOffsetFromBottom: z.number().int().min(0).max(100000).optional().default(0),
    stripAnsi: z.boolean().optional().default(true),
    includeLines: z.boolean().optional().default(false).describe('bottom mode only: also return a `lines[]` array of per-line objects with line numbers. Off by default because it duplicates `text` and roughly doubles the payload (which then rides in your history and is re-billed every step). Turn on only when you need to reference specific line numbers.'),
    raw: z.boolean().optional().default(false).describe('bottom mode only: disable the screen-clear / alt-screen collapse and return the full cumulative buffer.'),
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

export const cli_agent_wait_for = makeLocalTool(
  'cli_agent_wait_for',
  'Block until a substring appears in the delegated CLI output, the session exits, or the timeout fires. Use this to wait for a CLI to finish responding (e.g. wait for the `>` prompt to come back) before sending the next instruction.',
  z.object({
    cliSessionId: z.string().describe('CLI session id returned by cli_agent_start.'),
    text: z.string().describe('Substring to wait for in the (ANSI-stripped) output.'),
    timeoutMs: z.number().int().min(0).max(600000).optional().default(30000),
    pollMs: z.number().int().min(50).max(5000).optional().default(250),
    sinceSeq: z.number().int().optional().default(0).describe('Start scanning from this seq cursor; omit to watch all buffered output.'),
    maxChars: z.number().int().min(100).max(200000).optional().default(50000),
    stripAnsi: z.boolean().optional().default(true),
    exitOnDone: z.boolean().optional().default(true).describe('Return as soon as the session exits even if the substring was not seen.'),
    tailChars: z.number().int().min(0).max(20000).optional().default(800).describe('Bytes of trailing output to include in the response for context.'),
  }),
  z.object({
    ok: z.boolean(),
    session: cliSessionSchema.optional(),
    matched: z.boolean().optional(),
    timeout: z.boolean().optional(),
    seq: z.number().int().optional(),
    done: z.boolean().optional(),
    exitCode: z.number().int().optional(),
    tail: z.string().optional(),
    error: z.string().optional(),
  }),
  60000,
  { noFallback: true },
);

export const cli_agent_wait_idle = makeLocalTool(
  'cli_agent_wait_idle',
  'Wait until the delegated CLI finishes responding and is idle again. This is the PRIMARY way to tell "is it done?" — use it after sending a prompt/command, NOT cli_agent_wait_for. It detects the busy→idle transition (output goes quiet AND no spinner / "Generating…" / "Working" / "esc to interrupt" on screen), which is reliable. wait_for on a prompt marker like "~" or "? for shortcuts" fails because those are on screen the whole time — including mid-generation — so it matches instantly and you loop. wait_idle reads incrementally first, so if the CLI is already idle it returns fast.',
  z.object({
    cliSessionId: z.string().describe('CLI session id returned by cli_agent_start.'),
    timeoutMs: z.number().int().min(1000).max(600000).optional().default(120000).describe('Max time to wait for the agent to go idle. Use 180000+ for long agentic tasks.'),
    quietMs: z.number().int().min(300).max(30000).optional().default(6000).describe('How long output must stay quiet (no new bytes) before declaring idle. Default 6000ms. When babysitting another agentic CLI (e.g. Claude Code running a multi-step task), keep this high (6000–10000) — that CLI goes quiet for seconds between its own tool steps with no spinner on screen, and a low value declares it "idle" prematurely, making you read + re-evaluate over and over (each round-trip re-bills the whole history). A higher quiet window collapses those false-idle cycles into one server-side wait.'),
    pollMs: z.number().int().min(100).max(5000).optional().default(350),
    sinceSeq: z.number().int().optional().default(0).describe('Start watching from this seq cursor (omit to watch from now).'),
    tailChars: z.number().int().min(0).max(20000).optional().default(1200).describe('Trailing chars of the cleaned visible screen to include for context.'),
  }),
  z.object({
    ok: z.boolean(),
    session: cliSessionSchema.optional(),
    idle: z.boolean().optional(),
    exited: z.boolean().optional(),
    timeout: z.boolean().optional(),
    busy: z.boolean().optional(),
    seq: z.number().int().optional(),
    quietForMs: z.number().int().optional(),
    exitCode: z.number().int().optional(),
    tail: z.string().optional(),
    error: z.string().optional(),
  }),
  600000,
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
