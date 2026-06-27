/**
 * Per-agent tool permission policy, single-sourced for every surface that runs
 * or configures a bot: the desktop local run gate (proactive-scheduler-utils),
 * the cloud wakeup runner (cloud-ai routes/proactive), and the settings UI
 * (bots-ui SettingsTab).
 */

export type BotPermissionMode = 'auto' | 'selective' | 'manual';

export interface SensitiveBotTool {
  id: string;
  label: string;
  description: string;
  /** Hidden aliases gate the same as their primary id but stay out of the settings UI. */
  uiHidden?: boolean;
}

/**
 * Sensitive tools a bot run must clear with its permission gate before they
 * execute: anything that mutates files, runs commands, or drives a terminal.
 */
export const SENSITIVE_BOT_TOOLS: SensitiveBotTool[] = [
  { id: 'write_file', label: 'Write file', description: 'Create or overwrite text files' },
  { id: 'write_file_base64', label: 'Write binary file', description: 'Write binary/base64 content' },
  { id: 'create_directory', label: 'Create folder', description: 'Make a new directory' },
  { id: 'copy_file', label: 'Copy file', description: 'Duplicate a file' },
  { id: 'file_edit', label: 'Edit file', description: 'Modify file contents in place' },
  { id: 'move_file', label: 'Move / rename file', description: 'Move or rename (can overwrite)' },
  { id: 'delete_file', label: 'Delete file', description: 'Remove files or folders' },
  { id: 'run_command', label: 'Run command', description: 'Execute shell commands' },
  { id: 'run_system_command', label: 'Run system command', description: 'Execute shell commands', uiHidden: true },
  { id: 'terminal_create', label: 'Open terminal', description: 'Start a terminal session' },
  { id: 'terminal_send_input', label: 'Terminal input', description: 'Type into a terminal' },
  { id: 'terminal_send_raw', label: 'Terminal raw input', description: 'Send raw terminal bytes', uiHidden: true },
  { id: 'terminal_send_keys', label: 'Terminal keys', description: 'Send key presses to a terminal', uiHidden: true },
  { id: 'terminal_destroy', label: 'Close terminal', description: 'Terminate a terminal session', uiHidden: true },
];

const SENSITIVE_BOT_TOOL_IDS = new Set(SENSITIVE_BOT_TOOLS.map(t => t.id));

/** The subset shown as toggles in agent settings (aliases collapse into their primary). */
export const SENSITIVE_BOT_TOOL_OPTIONS: SensitiveBotTool[] = SENSITIVE_BOT_TOOLS.filter(t => !t.uiHidden);

export function isSensitiveBotTool(tool: string): boolean {
  return SENSITIVE_BOT_TOOL_IDS.has(String(tool || '').trim().toLowerCase());
}

export function normalizeBotPermissionMode(mode: unknown): BotPermissionMode {
  return mode === 'auto' || mode === 'manual' || mode === 'selective' ? mode : 'selective';
}

/**
 * Whether a tool call must clear an approval step (blocking prompt on desktop,
 * policy denial during unattended cloud runs) before executing.
 */
export function botToolNeedsApproval(
  tool: string,
  mode: BotPermissionMode,
  autoApprove: readonly string[] | null | undefined,
): boolean {
  if (!isSensitiveBotTool(tool)) return false;
  if (mode === 'auto') return false;
  if (mode === 'selective') {
    const t = String(tool || '').trim().toLowerCase();
    const approved = (autoApprove || []).map(x => String(x || '').trim().toLowerCase());
    if (approved.includes(t)) return false;
  }
  return true; // 'manual', or 'selective' without the tool listed
}
