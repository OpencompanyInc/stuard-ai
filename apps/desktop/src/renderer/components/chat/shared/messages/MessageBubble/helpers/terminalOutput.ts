export const TERMINAL_OUTPUT_TOOL_NAMES = new Set([
  'cli_agent_wait_for',
  'cli_agent_read',
  'terminal_read',
  'terminal_wait_for',
  'run_command',
  'run_python_script',
  'run_node_script',
]);

export const LIVE_TERMINAL_TOOL_NAMES = new Set([
  'run_command',
  'run_python_script',
  'run_node_script',
  'cli_agent_wait_for',
  'cli_agent_read',
  'terminal_read',
  'terminal_wait_for',
]);

export interface TerminalOutputStatus {
  matched?: boolean;
  timeout?: boolean;
  done?: boolean;
  exitCode?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function extractTerminalText(result: unknown, liveOutput?: string): string | null {
  if (typeof liveOutput === 'string' && liveOutput.length > 0) return liveOutput;
  if (!isRecord(result)) return null;

  if (typeof result.tail === 'string' && result.tail.length > 0) return result.tail;
  if (typeof result.text === 'string' && result.text.length > 0) return result.text;
  if (typeof result.output === 'string' && result.output.length > 0) return result.output;
  if (typeof result.stdout === 'string' && result.stdout.length > 0) return result.stdout;

  if (Array.isArray(result.chunks)) {
    const joined = result.chunks
      .map((chunk) => (isRecord(chunk) && typeof chunk.text === 'string' ? chunk.text : ''))
      .join('');
    if (joined.length > 0) return joined;
  }

  if (Array.isArray(result.lines)) {
    const joined = result.lines
      .map((line) => (isRecord(line) && typeof line.text === 'string' ? line.text : ''))
      .join('\n');
    if (joined.length > 0) return joined;
  }

  return null;
}

export function extractTerminalStatus(result: unknown): TerminalOutputStatus | null {
  if (!isRecord(result)) return null;

  const status: TerminalOutputStatus = {};
  if (typeof result.matched === 'boolean') status.matched = result.matched;
  if (typeof result.timeout === 'boolean') status.timeout = result.timeout;
  if (typeof result.done === 'boolean') status.done = result.done;
  if (typeof result.exitCode === 'number') status.exitCode = result.exitCode;

  return Object.keys(status).length > 0 ? status : null;
}

export function getTerminalPanelTitle(toolName: string, args?: unknown, result?: unknown): string {
  const provider = extractProviderLabel(args, result);
  if (provider) return provider;

  switch (toolName) {
    case 'cli_agent_wait_for':
      return 'CLI Agent';
    case 'cli_agent_read':
      return 'CLI Agent';
    case 'terminal_read':
    case 'terminal_wait_for':
      return 'Terminal';
    case 'run_command':
    case 'run_python_script':
    case 'run_node_script':
      return 'Shell';
    default:
      return 'Terminal';
  }
}

function extractProviderLabel(args?: unknown, result?: unknown): string | null {
  for (const source of [result, args]) {
    if (!isRecord(source)) continue;

    const session = source.session;
    if (isRecord(session)) {
      if (typeof session.label === 'string' && session.label.trim()) return session.label;
      if (typeof session.provider === 'string' && session.provider.trim()) {
        return formatProviderName(session.provider);
      }
    }

    if (typeof source.provider === 'string' && source.provider.trim()) {
      return formatProviderName(source.provider);
    }
  }

  return null;
}

function formatProviderName(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  switch (normalized) {
    case 'claude':
      return 'Claude Code';
    case 'codex':
      return 'Codex';
    case 'cursor':
      return 'Cursor Agent';
    case 'antigravity':
      return 'Antigravity';
    default:
      return provider.charAt(0).toUpperCase() + provider.slice(1);
  }
}

export function getTerminalWaitingHint(toolName: string, args?: unknown): string | null {
  if (!isRecord(args)) return null;

  if (toolName === 'cli_agent_wait_for' || toolName === 'terminal_wait_for') {
    const needle = args.text ?? args.needle ?? args.contains;
    if (typeof needle === 'string' && needle.trim()) {
      return `Waiting for "${needle.trim()}"…`;
    }
    return 'Waiting for CLI output…';
  }

  if (toolName === 'cli_agent_read' || toolName === 'terminal_read') {
    return 'Reading terminal output…';
  }

  return null;
}
