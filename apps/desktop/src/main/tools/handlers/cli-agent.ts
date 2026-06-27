import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import { ptyManager } from '../../terminal';
import { RouterContext } from '../types';
import { renderTerminalScreen } from './terminal-screen';

export type CliAgentProvider = 'codex' | 'cursor' | 'antigravity' | 'claude';

type ProviderSpec = {
  id: CliAgentProvider;
  label: string;
  aliases: string[];
  configDirs: string[];
  homepage: string;
  interactiveArgs?: string[];
  printArgs?: (prompt: string, extraArgs: string[]) => string[];
  resumeHint?: string;
  // Optional pre-launch hook that prepares trust state for the cwd. Returns
  // a status the caller can surface ('granted' = we wrote the marker now,
  // 'already' = workspace was already trusted, 'unsupported' = provider has
  // no auto-trust). Throwing is OK — caller treats it as a soft failure.
  ensureTrust?: (cwd: string) => 'granted' | 'already' | 'unsupported';
  // Patterns that indicate the REPL is ready to accept input. Used by
  // `cli_agent_start` to gate the auto-prompt write — without this, a fixed
  // timeout fires before the CLI has finished booting (cursor-agent takes
  // 5–15 s of splash + indexing) and the typed prompt vanishes into the
  // splash. Order matters: first match wins.
  readyPatterns?: RegExp[];
  // Human-readable marker the LLM can pass to cli_agent_wait_for after sending
  // a follow-up. Surfaces in the cli_agent_start response so the LLM doesn't
  // have to guess (the original transcript timed out waiting for `>` when
  // cursor-agent actually uses `~`).
  readyMarker?: string;
  // Patterns that mean the agent is actively working (spinner, "Generating…",
  // "Working", "esc to interrupt"). Used by cli_agent_wait_idle to detect the
  // busy→idle transition. This is the RIGHT readiness signal: the input prompt
  // (`~`, `? for shortcuts`) is on screen the whole time — including during
  // generation — so waiting for it to "appear" matches instantly and loops.
  // Waiting for the busy indicator to DISAPPEAR is what actually means "done".
  busyPatterns?: RegExp[];
};

type CliAgentSession = {
  id: string;
  provider: CliAgentProvider;
  label: string;
  command: string;
  terminalSessionId: string;
  cwd: string;
  createdAt: number;
  prompt?: string;
  initialPrompt?: {
    state: 'pending' | 'sent' | 'failed';
    text: string;
    createdAt: number;
    sentAt?: number;
    readyWaitedMs?: number;
    readyMatched?: boolean;
    error?: string;
  };
};

const DEFAULT_CLI_MAX_CHARS = 50000;
const DEFAULT_BOTTOM_LINE_COUNT = 40;
const DETECT_CACHE_TTL_MS = 30000;

// Cursor stores per-workspace trust as a marker file at
// ~/.cursor/projects/<slug>/.workspace-trusted with `{trustedAt, workspacePath}`.
// Writing it pre-trust the workspace so the interactive Ink "Workspace Trust
// Required" dialog never blocks the launch. The slug rule (verified against
// existing entries): strip `:` and `/`, then `\` → `-`, drive case preserved
// from the path Cursor was first invoked with.
export function cursorWorkspaceSlug(cwd: string): string {
  return cwd.replace(/[:/]/g, '').replace(/\\/g, '-');
}

export function ensureCursorTrust(cwd: string): 'granted' | 'already' | 'unsupported' {
  try {
    const slug = cursorWorkspaceSlug(resolvePath(cwd));
    const dir = join(homedir(), '.cursor', 'projects', slug);
    const marker = join(dir, '.workspace-trusted');
    if (existsSync(marker)) return 'already';
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      marker,
      JSON.stringify({ trustedAt: new Date().toISOString(), workspacePath: cwd }, null, 2),
      'utf8',
    );
    return 'granted';
  } catch {
    return 'unsupported';
  }
}

function ensureClaudeTrust(cwd: string): 'granted' | 'already' | 'unsupported' {
  // Claude Code persists trust at ~/.claude.json under
  // projects["<forward-slashed path>"].hasTrustDialogAccepted = true. We only
  // *read* it here — we never mutate this file, because it also holds
  // credentials, session telemetry, and per-project settings that we don't want
  // to risk corrupting. If trust is missing, the launch will still work; the
  // dialog just appears and the LLM must dismiss it (the subagent prompt covers
  // this).
  try {
    const cfgPath = join(homedir(), '.claude.json');
    if (!existsSync(cfgPath)) return 'unsupported';
    const raw = readFileSync(cfgPath, 'utf8');
    const key = resolvePath(cwd).replace(/\\/g, '/');
    // Look for "<key>": { ... "hasTrustDialogAccepted": true ... } in the
    // raw JSON without parsing (the file can hold duplicate keys that crash
    // JSON.parse on real user installs).
    const idx = raw.indexOf(`"${key}":`);
    if (idx < 0) return 'unsupported';
    const slice = raw.slice(idx, idx + 4000);
    return /"hasTrustDialogAccepted"\s*:\s*true/.test(slice) ? 'already' : 'unsupported';
  } catch {
    return 'unsupported';
  }
}

const PROVIDERS: ProviderSpec[] = [
  {
    id: 'codex',
    label: 'Codex CLI',
    aliases: ['codex'],
    configDirs: ['.codex'],
    homepage: 'https://github.com/openai/codex',
    printArgs: (prompt) => ['exec', prompt],
    resumeHint: 'codex resume',
    // Codex REPL shows `›` as its input prompt (single-line) once ready.
    readyPatterns: [/^›\s/m, /\n›\s/],
    readyMarker: '› ',
    busyPatterns: [/esc to interrupt/i, /\bthinking\b/i, /\bworking\b/i],
  },
  {
    id: 'cursor',
    label: 'Cursor Agent CLI',
    aliases: ['cursor-agent'],
    configDirs: ['.cursor'],
    homepage: 'https://docs.cursor.com/en/cli/overview',
    // Suppress the recurring approval dialogs at launch instead of asking the
    // LLM to navigate them per-session. The orchestrator user already
    // authorized us to delegate to cursor-agent; bouncing them through
    // Cursor's own gates (workspace-trust + MCP-server-approval + per-command
    // shell approval) is just duplicated consent and burns turns. Trust is
    // handled out-of-band via the marker file (ensureCursorTrust). The flags:
    //   --approve-mcps  → suppress the MCP approval prompt (fires per session
    //                     for any cursor-side MCP the user has globally
    //                     configured, e.g. their supabase MCP).
    //   --force/--yolo  → auto-allow shell commands. Without this, cursor-agent
    //                     blocks every command (`pwd`, `ls`, `cat`, etc.) on a
    //                     TUI dialog that — empirically — silently rejects
    //                     PTY keystrokes (`y`/Enter/Tab all returned ok:true
    //                     from the PTY write but the buffer seq never moved).
    //                     The cli-config.json deny list still applies, so
    //                     dangerous patterns can be blocked centrally.
    // Both apply to interactive AND print launches.
    interactiveArgs: ['--approve-mcps', '--force'],
    // Print mode: cursor-agent supports --trust to skip the workspace-trust
    // dialog only with -p/headless. We also default --model to "auto" when
    // caller didn't pass one, because the on-disk default (composer-2-fast)
    // is gated behind paid plans and otherwise fails the launch with a model
    // error for free users.
    printArgs: (prompt, extraArgs) => {
      const hasModel = extraArgs.some((a) => a === '--model' || a.startsWith('--model='));
      const modelArgs = hasModel ? [] : ['--model', 'auto'];
      return ['-p', '--trust', '--approve-mcps', '--force', ...modelArgs, ...extraArgs, prompt];
    },
    resumeHint: 'cursor-agent resume',
    ensureTrust: ensureCursorTrust,
    // After the splash, cursor-agent's interactive REPL paints "Auto" (the
    // current mode label) on one line and `~` (the input field marker) on
    // the next. The pair appearing together is reliable across versions; `~`
    // alone false-matches against random path output.
    readyPatterns: [/Auto[\s\S]{0,200}?\n\s*~/],
    readyMarker: '~',
    // cursor-agent shows "Working" + a braille spinner and "ctrl+c to stop"
    // while generating; "esc to interrupt" on tool calls.
    busyPatterns: [/\bWorking\b/, /ctrl\+c to stop/i, /esc to (interrupt|stop)/i],
  },
  {
    id: 'antigravity',
    label: 'Antigravity CLI',
    // Only the real coding-agent CLI alias. `antigravity` on PATH on Windows
    // resolves to the IDE binary (VS Code fork) which has no agent loop and
    // would mislead detection — we deliberately don't list it here.
    aliases: ['agy'],
    configDirs: [join('.gemini', 'antigravity-cli')],
    homepage: 'https://antigravity.google/docs/cli-overview',
    resumeHint: '/resume',
    readyPatterns: [/\n›\s/, /^›\s/m],
    readyMarker: '› ',
    busyPatterns: [/esc to interrupt/i, /\bthinking\b/i, /\bworking\b/i, /\bgenerating\b/i],
  },
  {
    id: 'claude',
    label: 'Claude Code',
    aliases: ['claude'],
    configDirs: ['.claude'],
    homepage: 'https://code.claude.com/docs/en/cli-usage',
    // Always open the interactive REPL — `-p` print mode bypasses the local
    // session that wires the user's Claude subscription, so the call gets
    // billed as anonymous API usage. Prompts get typed into the REPL after
    // launch (see execCliAgentStart below).
    resumeHint: 'claude --resume',
    ensureTrust: ensureClaudeTrust,
    // Claude's REPL prints "? for shortcuts" in its input footer once the
    // chat box is ready. The `> ` input prompt false-matches against shell
    // prompts (`PS C:\Users\solar> `) so we anchor on the shortcuts hint.
    // Claude's Ink footer can render with spaces (`? for shortcuts`) or as a
    // compact cell stream (`?forshortcuts`) depending on the PTY/screen pass.
    readyPatterns: [/\?\s*for\s*shortcuts/i, /Bypassing\s*Permissions/i],
    readyMarker: '? for shortcuts',
    // Claude streams "✻ Generating…", "esc to interrupt", "thinking with …"
    // while busy. Note: "? for shortcuts" is NOT a busy/idle signal — it's
    // always on screen — which is exactly why wait_for on it loops forever.
    busyPatterns: [/Generating…/i, /Pontificating…?/i, /esc to interrupt/i, /thinking with/i, /\bBaking\b/i],
  },
];

// Poll the PTY buffer for a provider's ready marker. Used by cli_agent_start
// to delay the auto-typed prompt until the REPL is actually accepting input
// — the original 1200ms fixed timeout fired during the splash and the prompt
// was discarded. Returns true if a pattern matched, false on timeout or PTY
// exit. Cheap: only scans the trailing window of the cumulative buffer.
async function waitForReadyMarker(
  terminalId: string,
  patterns: RegExp[],
  timeoutMs: number,
): Promise<boolean> {
  if (!patterns || patterns.length === 0) return false;
  const start = Date.now();
  const pollMs = 200;
  while (Date.now() - start < timeoutMs) {
    const session = ptyManager.get(terminalId);
    if (!session || session.status !== 'running') return false;
    const raw = ptyManager.getBuffer(terminalId).join('');
    // Run the same collapse + strip the LLM would see — so the ready
    // patterns are written against what cursor-agent *visually* renders,
    // not against raw bytes the user never sees.
    const visible = stripTerminalText(collapseToVisibleFrame(raw));
    // Cap the scan window to the trailing 4 KB — boot output rarely exceeds
    // that, and we don't want to re-scan megabytes of indexing chatter.
    const tail = visible.slice(-4096);
    if (patterns.some((p) => p.test(tail))) return true;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return false;
}

export function hasReadyMarker(provider: CliAgentProvider, text: string): boolean {
  const spec = PROVIDERS.find((p) => p.id === provider);
  return !!spec?.readyPatterns?.some((pattern) => pattern.test(text));
}

async function sendInitialPromptWhenReady(
  sessionId: string,
  spec: ProviderSpec,
  prompt: string,
  readyTimeoutMs: number,
  fallbackDelayMs: number,
  submitDelayMs: number,
  ctx: RouterContext,
): Promise<void> {
  const session = cliSessions.get(sessionId);
  if (!session?.initialPrompt || session.initialPrompt.state !== 'pending') return;

  const patterns = spec.readyPatterns;
  let readyWaited = 0;
  let readyMatched = false;
  if (patterns && patterns.length > 0) {
    const start = Date.now();
    readyMatched = await waitForReadyMarker(session.terminalSessionId, patterns, readyTimeoutMs);
    readyWaited = Date.now() - start;
    if (!readyMatched) {
      ctx.logFn(
        `${spec.label} session ${sessionId}: ready marker not seen in ${readyTimeoutMs}ms; typing prompt anyway`,
      );
    }
  } else {
    await new Promise((r) => setTimeout(r, fallbackDelayMs));
  }

  const live = cliSessions.get(sessionId);
  if (!live?.initialPrompt || live.initialPrompt.state !== 'pending') return;
  if (ptyManager.get(live.terminalSessionId)?.status !== 'running') {
    live.initialPrompt = {
      ...live.initialPrompt,
      state: 'failed',
      readyWaitedMs: readyWaited,
      readyMatched,
      error: 'terminal_not_running',
    };
    return;
  }

  // Type the prompt and submit it as TWO separate PTY writes with a gap in
  // between — do NOT send `${prompt}\r` in one write. Ink-based REPLs (Claude
  // Code especially) treat a single large byte burst as a *paste*: a `\r`
  // arriving in the same chunk as the text is absorbed into the input as a
  // literal newline instead of firing "submit", so the prompt ends up sitting
  // in the input box unsent — yet the PTY write returns ok, so the harness
  // wrongly marked it 'sent'. Writing the text, letting the paste window
  // close, then sending Enter on its own makes the CR register as a submit
  // keystroke. This is exactly the manual "send text → send a separate Enter"
  // sequence that works.
  const typed = ptyManager.write(live.terminalSessionId, prompt);
  if (!typed) {
    live.initialPrompt = {
      ...live.initialPrompt,
      state: 'failed',
      readyWaitedMs: readyWaited,
      readyMatched,
      error: 'write_failed_or_session_not_running',
    };
    ctx.logFn(`${spec.label} session ${sessionId}: prompt write failed`);
    return;
  }

  await new Promise((r) => setTimeout(r, submitDelayMs));

  const submitted = ptyManager.write(live.terminalSessionId, '\r');
  live.initialPrompt = {
    ...live.initialPrompt,
    state: submitted ? 'sent' : 'failed',
    sentAt: submitted ? Date.now() : undefined,
    readyWaitedMs: readyWaited,
    readyMatched,
    error: submitted ? undefined : 'submit_write_failed_or_session_not_running',
  };
  ctx.logFn(
    `${spec.label} session ${sessionId}: prompt ${submitted ? 'sent' : 'submit-failed'} after ${readyWaited}ms ready-wait (typed text + separate Enter, ${submitDelayMs}ms gap)`,
  );
}

const cliSessions = new Map<string, CliAgentSession>();
let detectCache: { at: number; includeVersions: boolean; result: any } | null = null;

function commandLookupName(): string {
  return process.platform === 'win32' ? 'where.exe' : 'which';
}

function findCommand(alias: string): string | null {
  try {
    const result = spawnSync(commandLookupName(), [alias], {
      encoding: 'utf8',
      timeout: 900,
      windowsHide: true,
    });
    if (result.status !== 0) return null;
    const first = String(result.stdout || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    return first || alias;
  } catch {
    return null;
  }
}

function getVersion(commandPath: string): string | null {
  try {
    // shell:true on Windows with a backslash path eats the slashes
    // (e.g. C:\Users\solar\.local\bin\claude.exe → C:Userssolar.local\binclaude.exe),
    // so spawn directly. .cmd/.bat wrappers still need a shell on Windows, so
    // fall back to a quoted shell call when the direct exec returns ENOEXEC.
    const direct = spawnSync(commandPath, ['--version'], {
      encoding: 'utf8',
      timeout: 3000,
      windowsHide: true,
    });
    if (direct.error && (direct.error as any).code === 'ENOEXEC' && process.platform === 'win32') {
      const shellResult = spawnSync(`"${commandPath}" --version`, {
        encoding: 'utf8',
        timeout: 3000,
        windowsHide: true,
        shell: true,
      });
      const shellText = `${shellResult.stdout || ''}${shellResult.stderr || ''}`.trim();
      return shellText.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || null;
    }
    const text = `${direct.stdout || ''}${direct.stderr || ''}`.trim();
    return text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || null;
  } catch {
    return null;
  }
}

function detectProvider(spec: ProviderSpec, options: { includeVersions?: boolean } = {}) {
  const binaries = spec.aliases
    .map((alias) => ({ alias, path: findCommand(alias) }))
    .filter((item): item is { alias: string; path: string } => !!item.path);
  const configPaths = spec.configDirs
    .map((dir) => join(homedir(), dir))
    .filter((dir) => {
      try { return existsSync(dir); } catch { return false; }
    });
  const primary = binaries[0] || null;

  return {
    id: spec.id,
    label: spec.label,
    available: !!primary,
    command: primary?.alias || spec.aliases[0],
    commandPath: primary?.path || null,
    detectedAliases: binaries.map((item) => item.alias),
    configPaths,
    hasConfig: configPaths.length > 0,
    version: options.includeVersions && primary?.path ? getVersion(primary.path) : null,
    homepage: spec.homepage,
    resumeHint: spec.resumeHint,
  };
}

function detectAllProviders(options: { includeVersions?: boolean; force?: boolean } = {}) {
  const includeVersions = options.includeVersions === true;
  const now = Date.now();
  if (
    !options.force &&
    detectCache &&
    now - detectCache.at < DETECT_CACHE_TTL_MS &&
    (detectCache.includeVersions || !includeVersions)
  ) {
    return { ...detectCache.result, cached: true };
  }

  const providers = PROVIDERS.map((spec) => detectProvider(spec, { includeVersions }));
  const result = {
    ok: true,
    cached: false,
    cacheTtlMs: DETECT_CACHE_TTL_MS,
    includeVersions,
    detectedAt: now,
    providers,
    available: providers.filter((provider) => provider.available),
    anyAvailable: providers.some((provider) => provider.available),
  };
  detectCache = { at: now, includeVersions, result };
  return result;
}

function resolveProvider(provider: any): ProviderSpec | null {
  const normalized = String(provider || '').trim().toLowerCase();
  const providerAlias = normalized === 'anitgravity' ? 'antigravity' : normalized;
  if (!normalized || normalized === 'auto') {
    const detected = detectAllProviders().available[0];
    return PROVIDERS.find((spec) => spec.id === detected?.id) || null;
  }
  return PROVIDERS.find((spec) => spec.id === providerAlias || spec.aliases.includes(providerAlias)) || null;
}

function shellForPlatform(): 'powershell' | 'bash' {
  return process.platform === 'win32' ? 'powershell' : 'bash';
}

function quoteShellArg(value: string): string {
  if (process.platform === 'win32') {
    return `'${String(value).replace(/'/g, "''")}'`;
  }
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function buildShellLine(command: string, args: string[]): string {
  const quoted = [command, ...args].map(quoteShellArg).join(' ');
  return process.platform === 'win32' ? `& ${quoted}` : quoted;
}

// Resolve `\r`-overwrite within each line the way a real terminal would. A
// bare carriage return means "go back to column 0 — the next bytes overwrite
// what's already on this line." PowerShell's progress bars
// (`Writing web request stream... (N bytes)\r`) emit thousands of these per
// second; treating `\r` as a newline (the naïve `.replace(/\r/g,'\n')`)
// inflates 1 MB of progress chatter into thousands of nearly identical
// "lines" and is what was eating the subagent's context window.
function applyCarriageReturns(text: string): string {
  // Normalize CRLF first so we don't split paired \r\n into the per-line
  // overwriter (where it would erase the real line break).
  const normalized = String(text || '').replace(/\r\n/g, '\n');
  return normalized
    .split('\n')
    .map((line) => {
      if (!line.includes('\r')) return line;
      const parts = line.split('\r');
      let buf = '';
      for (const part of parts) {
        buf = part.length >= buf.length ? part : part + buf.slice(part.length);
      }
      return buf;
    })
    .join('\n');
}

function stripTerminalText(text: string): string {
  return applyCarriageReturns(
    String(text || '')
      .replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '')
      .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
      .replace(/\x1b[\(\)][0-9A-Za-z]/g, ''),
  );
}

// Collapse a raw PTY byte stream down to its last visible frame for snapshot
// reads. Ink-style TUIs (Cursor's trust dialog, Claude's REPL) drive their UI
// via screen-clear and alternate-screen escapes; without this, the caller
// keeps seeing stale dialogs that were already dismissed because every paint
// is still in the cumulative buffer.
//   • `\x1b[2J` / `\x1b[3J`      → full screen clear; drop everything before.
//   • `\x1b[?1049l`              → leave alt screen; drop the alt-screen body.
//   • `\x1b[?1049h`              → enter alt screen; treat as a clear so the
//                                  alt-screen frame starts fresh.
// We deliberately don't run a full VT100 emulator — we just trim to the last
// "screen-reset" marker, which is enough to surface what the user is looking
// at right now in 99% of cases.
export { applyCarriageReturns };
export function collapseToVisibleFrame(raw: string): string {
  let text = String(raw || '');
  // Process resets newest-to-oldest. Find the LAST occurrence of any reset
  // and keep only what follows it. Repeat once for nested cases (e.g. enter
  // alt-screen + later a clear inside it).
  for (let pass = 0; pass < 2; pass++) {
    let cut = -1;
    let cutEnd = 0;
    const markers: Array<{ re: RegExp }> = [
      { re: /\x1b\[\??1049l/g },
      { re: /\x1b\[\??1049h/g },
      { re: /\x1b\[3J/g },
      { re: /\x1b\[2J/g },
      { re: /\x1b\[H\x1b\[2J/g },
    ];
    for (const { re } of markers) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        if (m.index > cut) {
          cut = m.index;
          cutEnd = m.index + m[0].length;
        }
      }
    }
    if (cut < 0) break;
    text = text.slice(cutEnd);
  }
  return text;
}

// Translate a named-key token from the LLM into the bytes a PTY-attached TUI
// expects. We intentionally accept a small, well-known set rather than
// arbitrary escape sequences — the LLM should describe intent ("Down"), not
// bytes ("\\x1b[B"). Single printable characters pass through as themselves
// so e.g. `keys: ["a"]` works for the Cursor trust dialog.
const NAMED_KEYS: Record<string, string> = {
  enter: '\r',
  return: '\r',
  newline: '\n',
  tab: '\t',
  'shift+tab': '\x1b[Z', // standard back-tab; Ink TUIs use this for reverse navigation
  backtab: '\x1b[Z',
  backspace: '\x7f',
  delete: '\x1b[3~',
  escape: '\x1b',
  esc: '\x1b',
  space: ' ',
  up: '\x1b[A',
  down: '\x1b[B',
  right: '\x1b[C',
  left: '\x1b[D',
  home: '\x1b[H',
  end: '\x1b[F',
  pageup: '\x1b[5~',
  pagedown: '\x1b[6~',
  'ctrl+c': '\x03',
  'ctrl+d': '\x04',
  'ctrl+l': '\x0c',
  'ctrl+u': '\x15',
};

export function encodeKey(key: string): string | null {
  const trimmed = String(key || '').trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (NAMED_KEYS[lower] !== undefined) return NAMED_KEYS[lower];
  if (trimmed.length === 1) return trimmed;
  // Multi-char strings that aren't a known name are sent as literal text so
  // callers can shove arbitrary input via `keys` if they want to — but we
  // surface the unknown name in logs (caller still gets ok:true).
  return trimmed;
}

function summarizeCliSession(session: CliAgentSession) {
  const terminal = ptyManager.get(session.terminalSessionId);
  return {
    id: session.id,
    provider: session.provider,
    label: session.label,
    command: session.command,
    terminalSessionId: session.terminalSessionId,
    cwd: session.cwd,
    createdAt: session.createdAt,
    status: terminal?.status || 'missing',
    exitCode: terminal?.exitCode,
  };
}

function getCliSession(args: any): CliAgentSession | null {
  const sessionId = String(args?.cliSessionId || args?.cli_session_id || args?.sessionId || args?.id || '').trim();
  if (sessionId) return cliSessions.get(sessionId) || null;

  const terminalSessionId = String(args?.terminalSessionId || args?.terminal_session_id || '').trim();
  if (terminalSessionId) {
    for (const session of cliSessions.values()) {
      if (session.terminalSessionId === terminalSessionId) return session;
    }
  }
  return null;
}

export async function execCliAgentDetect(args?: any): Promise<any> {
  return detectAllProviders({
    includeVersions: args?.includeVersions === true || args?.withVersions === true,
    force: args?.force === true,
  });
}

export async function execCliAgentStart(args: any, ctx: RouterContext): Promise<any> {
  try {
    const spec = resolveProvider(args?.provider);
    if (!spec) return { ok: false, error: 'provider_not_available' };

    const detected = detectProvider(spec);
    if (!detected.available) {
      return { ok: false, error: 'cli_not_found', provider: spec.id, checkedAliases: spec.aliases };
    }

    const cwd = String(args?.cwd || process.cwd());
    const prompt = String(args?.prompt || args?.message || '').trim();
    const mode = String(args?.mode || 'interactive').toLowerCase();
    const extraArgs = Array.isArray(args?.args) ? args.args.map((arg: any) => String(arg)) : [];

    // Pre-trust the workspace when the provider supports it. For Cursor this
    // writes the .workspace-trusted marker so the interactive Ink trust
    // dialog never appears; for Claude we only verify and report status so
    // the caller knows to expect (and dismiss) the dialog. Skippable via
    // `autoTrust: false` for callers that want the dialog to surface.
    const autoTrust = args?.autoTrust !== false && args?.auto_trust !== false;
    let trustStatus: 'granted' | 'already' | 'unsupported' | 'skipped' = 'unsupported';
    if (autoTrust && spec.ensureTrust) {
      try {
        trustStatus = spec.ensureTrust(cwd);
      } catch {
        trustStatus = 'unsupported';
      }
    } else if (!autoTrust) {
      trustStatus = 'skipped';
    }

    const usePrintMode = mode === 'print' && !!prompt && !!spec.printArgs;
    const launchArgs = usePrintMode
      ? spec.printArgs!(prompt, extraArgs)
      : [...(spec.interactiveArgs || []), ...extraArgs];

    const terminal = ptyManager.create({
      shell: shellForPlatform(),
      cwd,
      cols: Number(args?.cols || 140),
      rows: Number(args?.rows || 36),
      env: args?.env && typeof args.env === 'object' ? args.env : undefined,
    });

    const line = buildShellLine(detected.command, launchArgs);
    ptyManager.write(terminal.id, `${line}\r`);

    const id = `cli-${spec.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const session: CliAgentSession = {
      id,
      provider: spec.id,
      label: spec.label,
      command: detected.command,
      terminalSessionId: terminal.id,
      cwd,
      createdAt: Date.now(),
      ...(prompt ? { prompt } : {}),
      ...(!usePrintMode && prompt
        ? {
            initialPrompt: {
              state: 'pending' as const,
              text: prompt,
              createdAt: Date.now(),
            },
          }
        : {}),
    };
    cliSessions.set(id, session);

    // If we didn't bake the prompt into argv (interactive launch, or print
    // mode that fell back to interactive because the provider has no
    // printArgs), type the prompt into the live REPL — but wait for the
    // provider's ready marker first. The previous fixed 1200ms timeout
    // fired during cursor-agent's 5–15 s splash + indexing phase and the
    // prompt bytes were vanishing. With readyPatterns we hold the prompt
    // until the REPL is actually accepting input; if the marker never
    // shows (unknown provider, or splash is taking abnormally long), we
    // fall back to typing after `readyTimeoutMs` (default 30 s) so the
    // session never deadlocks waiting forever.
    if (!usePrintMode && prompt) {
      const readyTimeoutMs = Math.max(
        500,
        Number(args?.readyTimeoutMs ?? args?.ready_timeout_ms ?? 30000) || 30000,
      );
      const fallbackDelayMs = Math.max(
        0,
        Number(args?.promptDelayMs ?? args?.prompt_delay_ms ?? 1200) || 1200,
      );
      // Gap between typing the prompt text and sending the submit Enter. Must
      // be long enough for the REPL's paste-detection window to close so the
      // Enter is read as a distinct keystroke (see sendInitialPromptWhenReady).
      const submitDelayMs = Math.max(
        0,
        Number(args?.submitDelayMs ?? args?.submit_delay_ms ?? 400) || 400,
      );
      void sendInitialPromptWhenReady(id, spec, prompt, readyTimeoutMs, fallbackDelayMs, submitDelayMs, ctx)
        .catch((e) => {
          const live = cliSessions.get(id);
          if (live?.initialPrompt?.state === 'pending') {
            live.initialPrompt = {
              ...live.initialPrompt,
              state: 'failed',
              error: e?.message || String(e),
            };
          }
          ctx.logFn(`prompt-after-ready failed for ${id}: ${e?.message || e}`);
        });
    }

    const effectiveMode = usePrintMode ? 'print' : 'interactive';

    // Headed mode: tell the renderer a delegated CLI session is live so it can
    // auto-surface a watchable terminal panel. The PTY itself already
    // broadcasts terminal:data/terminal:exit on session.terminalSessionId, so
    // the UI just needs the session metadata to mount an <XTerminal> on it.
    ptyManager.broadcast('cli-agent:session-started', {
      id,
      terminalSessionId: terminal.id,
      provider: spec.id,
      label: spec.label,
      cwd,
      mode: effectiveMode,
      createdAt: session.createdAt,
    });

    ctx.logFn(`Started ${spec.label} session ${id} (trust: ${trustStatus})`);
    return {
      ok: true,
      session: summarizeCliSession(session),
      launch: { provider: spec.id, command: detected.command, args: launchArgs, mode: effectiveMode, requestedMode: mode },
      trust: trustStatus,
      // Surface the provider's ready marker so the LLM can pass it to
      // cli_agent_wait_for after sending follow-ups without guessing.
      readyMarker: spec.readyMarker,
      initialPrompt: session.initialPrompt
        ? { state: session.initialPrompt.state, createdAt: session.initialPrompt.createdAt }
        : undefined,
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'cli_agent_start_failed' };
  }
}

export async function execCliAgentSend(args: any, ctx: RouterContext): Promise<any> {
  try {
    const session = getCliSession(args);
    if (!session) return { ok: false, error: 'cli_session_not_found' };

    // Three input modes, picked in priority order:
    //   1. `keys`: array of named keys/single chars. Default enter=false, so
    //      this is the right mode for dismissing TUI dialogs ("a" to trust
    //      a workspace, "Down Down Enter" to navigate a menu).
    //   2. `input`: free text. Default enter=true so chat-style follow-ups
    //      send immediately, matching prior behavior.
    //   3. `enter: true` alone with no input/keys: a bare Enter (Carriage
    //      Return) — useful to confirm a single highlighted option.
    const keysArg = args?.keys;
    if (Array.isArray(keysArg) && keysArg.length > 0) {
      const encoded = keysArg.map((k: any) => encodeKey(String(k))).filter((s): s is string => !!s);
      if (encoded.length === 0) return { ok: false, error: 'no_valid_keys' };
      const enterTrailing = args?.enter === true;
      const payload = encoded.join('') + (enterTrailing ? '\r' : '');
      const ok = ptyManager.write(session.terminalSessionId, payload);
      if (!ok) return { ok: false, error: 'write_failed_or_session_not_running' };
      ctx.logFn(`Sent ${encoded.length} keys to ${session.label} session ${session.id}`);
      return { ok: true, session: summarizeCliSession(session), sent: 'keys', keys: keysArg };
    }

    const input = String(args?.input || args?.text || args?.message || '');
    const enter = args?.enter !== false;
    if (!input && !enter) return { ok: false, error: 'missing_input' };
    const ok = ptyManager.write(session.terminalSessionId, enter ? `${input}\r` : input);
    if (!ok) return { ok: false, error: 'write_failed_or_session_not_running' };
    ctx.logFn(`Sent input to ${session.label} session ${session.id}`);
    return { ok: true, session: summarizeCliSession(session), sent: 'input' };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'cli_agent_send_failed' };
  }
}

export async function execCliAgentStatus(args: any): Promise<any> {
  try {
    const session = getCliSession(args);
    if (session) return { ok: true, session: summarizeCliSession(session) };
    return { ok: true, sessions: Array.from(cliSessions.values()).map(summarizeCliSession) };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'cli_agent_status_failed' };
  }
}

export async function execCliAgentRead(args: any): Promise<any> {
  try {
    const session = getCliSession(args);
    if (!session) return { ok: false, error: 'cli_session_not_found' };

    const mode = String(args?.mode || '').toLowerCase();
    const sinceSeq = Number(args?.sinceSeq ?? args?.since_seq ?? args?.since ?? 0) || 0;
    const maxChars = Math.max(100, Number(args?.maxChars ?? args?.max_chars ?? DEFAULT_CLI_MAX_CHARS) || DEFAULT_CLI_MAX_CHARS);
    const stripAnsi = args?.stripAnsi !== false;

    if (mode === 'incremental' || sinceSeq > 0) {
      const result = ptyManager.read(session.terminalSessionId, sinceSeq, maxChars);
      if (!result.ok) return { ok: false, error: 'terminal_session_not_found' };
      const chunks = result.chunks.map((chunk) => ({
        seq: chunk.seq,
        text: stripAnsi ? stripTerminalText(chunk.text) : chunk.text,
      }));
      return {
        ok: true,
        session: summarizeCliSession(session),
        seq: result.seq,
        done: result.done,
        exitCode: result.exitCode,
        truncated: result.truncated,
        chunks,
      };
    }

    const buffer = ptyManager.getBuffer(session.terminalSessionId).join('');
    // Default `bottom` reads run the cumulative byte stream through a real
    // VT100 screen model (terminal-screen.ts), so the caller gets the clean,
    // readable text a human would see in the terminal *right now* — not the
    // raw ANSI paint stream. This is what keeps progress-bar floods and
    // already-dismissed dialogs out of the LLM's context. `raw: true` bypasses
    // it for forensic full-scrollback dumps.
    let text: string;
    if (args?.raw === true) {
      text = stripAnsi ? stripTerminalText(buffer) : buffer;
    } else {
      const term = ptyManager.get(session.terminalSessionId);
      text = renderTerminalScreen(buffer, {
        cols: term?.cols || 140,
        rows: term?.rows || 36,
      });
    }
    const rawLines = text.split('\n');
    const lines = rawLines.length > 1 && rawLines[rawLines.length - 1] === '' ? rawLines.slice(0, -1) : rawLines;
    const lineCount = Math.max(1, Number(args?.lineCount ?? args?.line_count ?? args?.lines ?? DEFAULT_BOTTOM_LINE_COUNT) || DEFAULT_BOTTOM_LINE_COUNT);
    const offsetFromBottom = Math.max(0, Number(args?.lineOffsetFromBottom ?? args?.line_offset_from_bottom ?? args?.fromBottom ?? 0) || 0);
    const endExclusive = Math.max(0, lines.length - offsetFromBottom);
    const start = Math.max(0, endExclusive - lineCount);
    const selectedLines = lines.slice(start, endExclusive);
    // `lines[]` (per-line objects carrying lineNumber/lineNumberFromBottom)
    // duplicates the content already in `text` and roughly doubles the payload
    // with repeated JSON keys. Every read persists in the subagent's message
    // history and is re-billed on every later step, so we omit it by default.
    // Opt in with includeLines only when you actually need line addressing.
    const includeLines = args?.includeLines === true || args?.include_lines === true;
    const seqProbe = ptyManager.read(session.terminalSessionId, 0, 100);

    return {
      ok: true,
      session: summarizeCliSession(session),
      seq: seqProbe.seq,
      done: seqProbe.done,
      exitCode: seqProbe.exitCode,
      totalLines: lines.length,
      lineOffsetFromBottom: offsetFromBottom,
      lineCount: selectedLines.length,
      ...(includeLines
        ? {
            lines: selectedLines.map((line, index) => {
              const lineNumber = start + index + 1;
              return {
                lineNumber,
                lineNumberFromBottom: Math.max(0, lines.length - lineNumber),
                text: line,
              };
            }),
          }
        : {}),
      text: selectedLines.join('\n'),
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'cli_agent_read_failed' };
  }
}

export async function execCliAgentWaitFor(args: any): Promise<any> {
  try {
    const session = getCliSession(args);
    if (!session) return { ok: false, error: 'cli_session_not_found' };

    const needle = String(args?.text ?? args?.needle ?? args?.contains ?? '');
    if (!needle) return { ok: false, error: 'missing_text' };

    const timeoutMs = Math.max(0, Number(args?.timeoutMs ?? args?.timeout_ms ?? 30000) || 30000);
    const pollMs = Math.max(50, Number(args?.pollMs ?? args?.poll_ms ?? 250) || 250);
    const maxChars = Math.max(100, Number(args?.maxChars ?? args?.max_chars ?? DEFAULT_CLI_MAX_CHARS) || DEFAULT_CLI_MAX_CHARS);
    const stripAnsi = args?.stripAnsi !== false;
    const exitOnDone = args?.exitOnDone !== false;
    const tailChars = Math.max(0, Number(args?.tailChars ?? args?.tail_chars ?? 800) || 800);

    const start = Date.now();
    let sinceSeq = Math.max(0, Number(args?.sinceSeq ?? args?.since_seq ?? 0) || 0);
    let collected = '';

    while (Date.now() - start < timeoutMs) {
      const r = ptyManager.read(session.terminalSessionId, sinceSeq, maxChars);
      if (!r.ok) return { ok: false, error: 'terminal_session_not_found' };

      const pieces = r.chunks.map((c) => c.text || '').join('');
      const text = stripAnsi ? stripTerminalText(pieces) : pieces;
      if (text) collected += text;
      sinceSeq = r.seq || sinceSeq;

      if (collected.includes(needle)) {
        return {
          ok: true,
          session: summarizeCliSession(session),
          matched: true,
          seq: sinceSeq,
          done: r.done,
          exitCode: r.exitCode,
          tail: tailChars > 0 ? collected.slice(-tailChars) : undefined,
        };
      }
      if (r.done && exitOnDone) {
        return {
          ok: true,
          session: summarizeCliSession(session),
          matched: false,
          seq: sinceSeq,
          done: true,
          exitCode: r.exitCode,
          tail: tailChars > 0 ? collected.slice(-tailChars) : undefined,
        };
      }

      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }

    return {
      ok: true,
      session: summarizeCliSession(session),
      matched: collected.includes(needle),
      timeout: true,
      seq: sinceSeq,
      tail: tailChars > 0 ? collected.slice(-tailChars) : undefined,
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'cli_agent_wait_for_failed' };
  }
}

/**
 * Wait until the agent finishes responding — the readiness primitive the LLM
 * should use after sending a prompt/command. Unlike wait_for (which matches a
 * substring and fires the instant it appears — fatal when the substring is the
 * always-present input prompt), this watches for the busy→idle transition:
 *
 *   idle  ⇔  output has gone quiet for `quietMs`  AND  no busyPattern matches
 *            the current visible screen.
 *
 * Output quiescence alone is a strong, provider-agnostic signal (spinners and
 * token streaming produce continuous bytes; an idle REPL is silent). The
 * busyPattern guard prevents declaring idle during a brief lull mid-generation
 * when the screen still shows "Generating…"/"Working".
 *
 * It reads incrementally first (read-then-wait), so the very common case of
 * "already idle" returns in one poll instead of always sleeping a full cycle.
 */
export async function execCliAgentWaitIdle(args: any): Promise<any> {
  try {
    const session = getCliSession(args);
    if (!session) return { ok: false, error: 'cli_session_not_found' };
    const spec = PROVIDERS.find((p) => p.id === session.provider);
    const busyPatterns = spec?.busyPatterns || [];

    const timeoutMs = Math.max(1000, Number(args?.timeoutMs ?? args?.timeout_ms ?? 120000) || 120000);
    const quietMs = Math.max(300, Number(args?.quietMs ?? args?.quiet_ms ?? 6000) || 6000);
    const pollMs = Math.max(100, Number(args?.pollMs ?? args?.poll_ms ?? 350) || 350);
    const tailChars = Math.max(0, Number(args?.tailChars ?? args?.tail_chars ?? 1200) || 1200);

    const start = Date.now();
    let sinceSeq = Math.max(0, Number(args?.sinceSeq ?? args?.since_seq ?? 0) || 0);
    let lastChangeAt = Date.now();
    let lastSeq = sinceSeq;
    let initialPromptSentObserved = session.initialPrompt?.state !== 'pending';

    const visibleNow = (): string => {
      const term = ptyManager.get(session.terminalSessionId);
      const buffer = ptyManager.getBuffer(session.terminalSessionId).join('');
      return renderTerminalScreen(buffer, { cols: term?.cols || 140, rows: term?.rows || 36 });
    };
    const isBusy = (screen: string): boolean => busyPatterns.some((p) => p.test(screen));

    while (Date.now() - start < timeoutMs) {
      const r = ptyManager.read(session.terminalSessionId, lastSeq, 2000);
      if (!r.ok) return { ok: false, error: 'terminal_session_not_found' };

      const newSeq = r.seq || lastSeq;
      if (newSeq !== lastSeq) {
        lastSeq = newSeq;
        lastChangeAt = Date.now();
      }

      if (r.done) {
        return {
          ok: true,
          session: summarizeCliSession(session),
          idle: true,
          exited: true,
          exitCode: r.exitCode,
          seq: lastSeq,
          tail: tailChars > 0 ? visibleNow().slice(-tailChars) : undefined,
        };
      }

      if (session.initialPrompt?.state === 'failed') {
        return {
          ok: false,
          error: session.initialPrompt.error || 'initial_prompt_failed',
          session: summarizeCliSession(session),
          seq: lastSeq,
          tail: tailChars > 0 ? visibleNow().slice(-tailChars) : undefined,
        };
      }

      if (session.initialPrompt?.state === 'pending') {
        lastChangeAt = Date.now();
        await new Promise((resolve) => setTimeout(resolve, pollMs));
        continue;
      }

      if (!initialPromptSentObserved && session.initialPrompt?.state === 'sent') {
        initialPromptSentObserved = true;
        lastChangeAt = Date.now();
      }

      const quietFor = Date.now() - lastChangeAt;
      if (quietFor >= quietMs) {
        const screen = visibleNow();
        if (!isBusy(screen)) {
          return {
            ok: true,
            session: summarizeCliSession(session),
            idle: true,
            seq: lastSeq,
            quietForMs: quietFor,
            tail: tailChars > 0 ? screen.slice(-tailChars) : undefined,
          };
        }
        // Quiet but still showing a busy indicator — keep waiting, and reset
        // the quiet clock so we require a fresh quiet window after it clears.
        lastChangeAt = Date.now();
      }

      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }

    const screen = visibleNow();
    return {
      ok: true,
      session: summarizeCliSession(session),
      idle: false,
      timeout: true,
      busy: isBusy(screen),
      seq: lastSeq,
      tail: tailChars > 0 ? screen.slice(-tailChars) : undefined,
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'cli_agent_wait_idle_failed' };
  }
}

export async function execCliAgentStop(args: any, ctx: RouterContext): Promise<any> {
  try {
    const session = getCliSession(args);
    if (!session) return { ok: false, error: 'cli_session_not_found' };
    const summary = summarizeCliSession(session);
    const destroyed = ptyManager.destroy(session.terminalSessionId);
    cliSessions.delete(session.id);
    ptyManager.broadcast('cli-agent:session-stopped', {
      id: session.id,
      terminalSessionId: session.terminalSessionId,
    });
    ctx.logFn(`Stopped ${session.label} session ${session.id}`);
    return { ok: true, destroyed, session: summary };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'cli_agent_stop_failed' };
  }
}
