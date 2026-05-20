import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ptyManager } from '../../terminal';
import { RouterContext } from '../types';

type CliAgentProvider = 'codex' | 'cursor' | 'antigravity' | 'claude';

type ProviderSpec = {
  id: CliAgentProvider;
  label: string;
  aliases: string[];
  configDirs: string[];
  homepage: string;
  interactiveArgs?: string[];
  printArgs?: (prompt: string) => string[];
  resumeHint?: string;
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
};

const DEFAULT_CLI_MAX_CHARS = 50000;
const DEFAULT_BOTTOM_LINE_COUNT = 80;

const PROVIDERS: ProviderSpec[] = [
  {
    id: 'codex',
    label: 'Codex CLI',
    aliases: ['codex'],
    configDirs: ['.codex'],
    homepage: 'https://github.com/openai/codex',
    printArgs: (prompt) => ['exec', prompt],
    resumeHint: 'codex resume',
  },
  {
    id: 'cursor',
    label: 'Cursor Agent CLI',
    aliases: ['cursor-agent'],
    configDirs: ['.cursor'],
    homepage: 'https://docs.cursor.com/en/cli/overview',
    printArgs: (prompt) => ['-p', prompt],
    resumeHint: 'cursor-agent resume',
  },
  {
    id: 'antigravity',
    label: 'Antigravity CLI',
    aliases: ['agy', 'antigravity'],
    configDirs: [join('.gemini', 'antigravity-cli')],
    homepage: 'https://antigravity.google/docs/cli-overview',
    resumeHint: '/resume',
  },
  {
    id: 'claude',
    label: 'Claude Code',
    aliases: ['claude'],
    configDirs: ['.claude'],
    homepage: 'https://code.claude.com/docs/en/cli-usage',
    printArgs: (prompt) => ['-p', prompt],
    resumeHint: 'claude --resume',
  },
];

const cliSessions = new Map<string, CliAgentSession>();

function commandLookupName(): string {
  return process.platform === 'win32' ? 'where.exe' : 'which';
}

function findCommand(alias: string): string | null {
  try {
    const result = spawnSync(commandLookupName(), [alias], {
      encoding: 'utf8',
      timeout: 2500,
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

function detectProvider(spec: ProviderSpec) {
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
    version: primary?.path ? getVersion(primary.path) : null,
    homepage: spec.homepage,
    resumeHint: spec.resumeHint,
  };
}

function detectAllProviders() {
  const providers = PROVIDERS.map(detectProvider);
  return {
    ok: true,
    providers,
    available: providers.filter((provider) => provider.available),
    anyAvailable: providers.some((provider) => provider.available),
  };
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

function stripTerminalText(text: string): string {
  return String(text || '')
    .replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[\(\)][0-9A-Za-z]/g, '')
    .replace(/\r/g, '\n');
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

export async function execCliAgentDetect(): Promise<any> {
  return detectAllProviders();
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

    const launchArgs = mode === 'print' && prompt && spec.printArgs
      ? spec.printArgs(prompt)
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
    };
    cliSessions.set(id, session);

    if (mode !== 'print' && prompt) {
      const delayMs = Math.max(0, Number(args?.promptDelayMs ?? args?.prompt_delay_ms ?? 1200) || 1200);
      setTimeout(() => {
        const live = cliSessions.get(id);
        if (live && ptyManager.get(live.terminalSessionId)?.status === 'running') {
          ptyManager.write(live.terminalSessionId, `${prompt}\r`);
        }
      }, delayMs).unref?.();
    }

    ctx.logFn(`Started ${spec.label} session ${id}`);
    return {
      ok: true,
      session: summarizeCliSession(session),
      launch: { provider: spec.id, command: detected.command, args: launchArgs, mode },
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'cli_agent_start_failed' };
  }
}

export async function execCliAgentSend(args: any, ctx: RouterContext): Promise<any> {
  try {
    const session = getCliSession(args);
    if (!session) return { ok: false, error: 'cli_session_not_found' };
    const input = String(args?.input || args?.text || args?.message || '');
    const enter = args?.enter !== false;
    if (!input && !enter) return { ok: false, error: 'missing_input' };
    const ok = ptyManager.write(session.terminalSessionId, enter ? `${input}\r` : input);
    if (!ok) return { ok: false, error: 'write_failed_or_session_not_running' };
    ctx.logFn(`Sent input to ${session.label} session ${session.id}`);
    return { ok: true, session: summarizeCliSession(session) };
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
    const text = stripAnsi ? stripTerminalText(buffer) : buffer;
    const rawLines = text.split('\n');
    const lines = rawLines.length > 1 && rawLines[rawLines.length - 1] === '' ? rawLines.slice(0, -1) : rawLines;
    const lineCount = Math.max(1, Number(args?.lineCount ?? args?.line_count ?? args?.lines ?? DEFAULT_BOTTOM_LINE_COUNT) || DEFAULT_BOTTOM_LINE_COUNT);
    const offsetFromBottom = Math.max(0, Number(args?.lineOffsetFromBottom ?? args?.line_offset_from_bottom ?? args?.fromBottom ?? 0) || 0);
    const endExclusive = Math.max(0, lines.length - offsetFromBottom);
    const start = Math.max(0, endExclusive - lineCount);
    const selected = lines.slice(start, endExclusive).map((line, index) => {
      const lineNumber = start + index + 1;
      return {
        lineNumber,
        lineNumberFromBottom: Math.max(0, lines.length - lineNumber),
        text: line,
      };
    });
    const seqProbe = ptyManager.read(session.terminalSessionId, 0, 100);

    return {
      ok: true,
      session: summarizeCliSession(session),
      seq: seqProbe.seq,
      done: seqProbe.done,
      exitCode: seqProbe.exitCode,
      totalLines: lines.length,
      lineOffsetFromBottom: offsetFromBottom,
      lineCount: selected.length,
      lines: selected,
      text: selected.map((line) => line.text).join('\n'),
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'cli_agent_read_failed' };
  }
}

export async function execCliAgentStop(args: any, ctx: RouterContext): Promise<any> {
  try {
    const session = getCliSession(args);
    if (!session) return { ok: false, error: 'cli_session_not_found' };
    const summary = summarizeCliSession(session);
    const destroyed = ptyManager.destroy(session.terminalSessionId);
    cliSessions.delete(session.id);
    ctx.logFn(`Stopped ${session.label} session ${session.id}`);
    return { ok: true, destroyed, session: summary };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'cli_agent_stop_failed' };
  }
}
