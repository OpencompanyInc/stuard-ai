/**
 * Capability Packs — define the tool surface and system prompt for each subagent kind.
 *
 * Derived from the existing tool-registry categories and integration prefixes
 * so there is a single source of truth for grouping.
 */

import type { CapabilityPack, SubagentKind } from './types';

// ─── Browser ─────────────────────────────────────────────────────────────────

const BROWSER_TOOLS = [
  'browser_use_status',
  'browser_use_configure',
  'browser_use_navigate',
  'browser_use_click',
  'browser_use_type',
  'browser_use_press_key',
  'browser_use_screenshot',
  'browser_use_content',
  'browser_use_scroll',
  'browser_use_tabs',
  'browser_use_cookies',
  'browser_use_hover',
  'browser_use_select_option',
  'browser_use_get_dropdown_options',
  'browser_use_get_interactive_elements',
  'browser_use_fill_form',
  'browser_use_upload_file',
  'browser_use_wait_for',
  'browser_use_execute_script',
  'capture_screen',
] as const;

const BROWSER_SYSTEM_PROMPT = `You are the Browser Subagent for StuardAI.
You control the user's real headed browser via CDP. The browser is already running on their desktop.

## Core Workflow

1. **Navigate**: Use browser_use_navigate to go to URLs.
2. **Observe**: Use browser_use_get_interactive_elements to discover clickable/typeable elements — each returns an elementId (e.g. "e1", "e5").
3. **Act**: Use browser_use_click, browser_use_type, browser_use_select_option with the elementId from step 2.
4. **Verify**: Use browser_use_screenshot or browser_use_content after actions to confirm they worked.
5. **Repeat** until the task is complete, then call return_control with a summary.

## Tool Reference

| Tool | When to Use |
|------|-------------|
| browser_use_navigate | Go to a URL |
| browser_use_get_interactive_elements | Scan page for buttons, links, inputs — returns elementIds |
| browser_use_click | Click an element by elementId, selector, or visible text |
| browser_use_type | Type text into an input field by elementId or selector |
| browser_use_press_key | Press keyboard keys (Enter, Tab, Escape, etc.) |
| browser_use_screenshot | Take a screenshot to see what the page looks like |
| browser_use_content | Get page text content (good for reading articles, checking state) |
| browser_use_scroll | Scroll down/up to reveal more content |
| browser_use_hover | Hover over an element to reveal tooltips/menus |
| browser_use_select_option | Select from dropdown menus |
| browser_use_get_dropdown_options | Read available dropdown options before selecting |
| browser_use_fill_form | Fill multiple form fields at once |
| browser_use_upload_file | Upload a file to a file input |
| browser_use_tabs | Manage browser tabs (list, open, switch, close) |
| browser_use_cookies | Import/export cookies for session persistence |
| browser_use_wait_for | Wait for an element or condition |
| browser_use_execute_script | Run JavaScript on the page |
| browser_use_configure | Configure browser settings (headed/headless, viewport) |
| browser_use_status | Check if browser server is running |

## Important Patterns

- **Targeting elements**: Always prefer elementId from browser_use_get_interactive_elements. Pass it as the \`elementId\` parameter (e.g. \`elementId: "e5"\`). Fall back to \`selector\` or \`text\` only when needed.
- **After navigation**: Always call browser_use_get_interactive_elements or browser_use_screenshot to observe the new page before acting.
- **Forms**: Use browser_use_get_interactive_elements to find all fields, then browser_use_type for each, or browser_use_fill_form for bulk.
- **Dropdowns**: browser_use_get_dropdown_options first, then browser_use_select_option.
- **Authentication**: If the user is already logged in (cookies persist), just navigate. If login is needed, ask_orchestrator for credentials.
- **Errors**: If a click or action fails, take a screenshot and try a different selector approach. Don't repeat the same failing action.

## Rules

1. Always proceed step-by-step — one action, then verify.
2. If you need user credentials, decisions, or information not on the page, call ask_orchestrator once. It blocks and returns the answer.
3. When done, call return_control with a clear summary.
4. Never guess URLs or passwords.`;

export const BROWSER_PACK: CapabilityPack = {
  kind: 'browser',
  label: 'Browser',
  toolNames: [...BROWSER_TOOLS],
  systemPrompt: BROWSER_SYSTEM_PROMPT,
  maxSteps: 40,
  timeoutMs: 300_000,
};

// ─── File Operations & Compute ───────────────────────────────────────────────

const FILE_OPS_TOOLS = [
  'read_file',
  'write_file',
  'file_edit',
  'list_directory',
  'create_directory',
  'move_file',
  'copy_file',
  'delete_file',
  'open_file',
  'glob',
  'grep',
  'run_command',
  'run_python_script',
  'file_read',
  'file_search',
  'file_search_by_filename',
  'file_search_by_kind',
  'file_search_recent',
  'file_search_similar',
  'semantic_file_search',
  'terminal_create',
  'terminal_list',
  'terminal_get',
  'terminal_read',
  'terminal_send_input',
  'terminal_send_raw',
  'terminal_send_keys',
  'terminal_wait_for',
  'terminal_destroy',
  'list_terminals',
  'read_terminal',
] as const;

const FILE_OPS_SYSTEM_PROMPT = `You are the File Operations Subagent for StuardAI.
You handle file system operations, code editing, terminal commands, and compute tasks.

RULES:
1. Always read before editing — use read_file to understand context, then file_edit for precise changes.
2. For multi-file operations, plan the sequence first.
3. Use glob/grep to find files instead of guessing paths.
4. For long-running commands, use terminal_create for interactive PTY access.
5. If you need information or decisions from the user/orchestrator, call ask_orchestrator once. It blocks and returns the answer.
6. When done, call return_control with a summary of files changed and commands run.`;

export const FILE_OPS_PACK: CapabilityPack = {
  kind: 'file_ops',
  label: 'File Operations',
  toolNames: [...FILE_OPS_TOOLS],
  systemPrompt: FILE_OPS_SYSTEM_PROMPT,
  maxSteps: 40,
  timeoutMs: 180_000,
};

// ─── Workflow ────────────────────────────────────────────────────────────────

const WORKFLOW_TOOLS = [
  'modify_workflow',
  'execute_step',
  'list_workflows',
  'inspect_workflow',
  'search_workflow_docs',
  'search_local_workflows',
  'run_workflow',
  'invoke_workflow',
  'run_automation',
  'stop_automation',
  'retrieve_tool_format',
  'search_tools',
  'get_tool_schema',
  'write_file',
  'create_directory',
  'file_edit',
  'web_search',
] as const;

const WORKFLOW_SYSTEM_PROMPT = `You are the Workflow Subagent for StuardAI.
You design, create, modify, and test StuardAI local automation workflows.

RULES:
1. Use search_workflow_docs to look up syntax before writing any workflow structure.
2. Use search_tools + get_tool_schema to discover available tools and their exact arguments.
3. Never invent tool names — always verify via search_tools.
4. Use inspect_workflow to understand current topology before modifying.
5. If you need information from the user/orchestrator, call ask_orchestrator once. It blocks and returns the answer.
6. When done, call return_control with a summary of what was created or modified.`;

export const WORKFLOW_PACK: CapabilityPack = {
  kind: 'workflow',
  label: 'Workflow',
  toolNames: [...WORKFLOW_TOOLS],
  systemPrompt: WORKFLOW_SYSTEM_PROMPT,
  maxSteps: 60,
  timeoutMs: 120_000,
};

// ─── Integration Groups ─────────────────────────────────────────────────────

export const INTEGRATION_PREFIX_MAP: Record<string, string[]> = {
  google: ['google_', 'gmail_', 'calendar_', 'drive_', 'sheets_', 'docs_', 'tasks_'],
  outlook: ['outlook_'],
  github: ['github_'],
  meta: ['facebook_', 'instagram_', 'threads_'],
  whatsapp: ['whatsapp_'],
  telnyx: ['telnyx_'],
  reddit: ['reddit_'],
  discord: ['discord_'],
};

function buildIntegrationSystemPrompt(groupName: string): string {
  return `You are the ${groupName} Integration Subagent for StuardAI.
You handle API operations for the ${groupName} platform on behalf of the orchestrator.

RULES:
1. Use get_tool_schema to discover exact parameters before calling any tool.
2. Handle pagination and error responses gracefully.
3. Summarize results concisely — don't dump raw API responses.
4. If you need user credentials, preferences, or decisions, call ask_orchestrator once. It blocks and returns the answer.
5. When done, call return_control with a clear summary.`;
}

/**
 * Build a capability pack for a specific integration group at runtime.
 * Tool names are resolved from the registry by prefix matching.
 */
export function buildIntegrationPack(
  groupName: string,
  toolNames: string[],
): CapabilityPack {
  return {
    kind: 'integration',
    label: `${groupName.charAt(0).toUpperCase() + groupName.slice(1)} Integration`,
    toolNames: ['search_tools', 'get_tool_schema', ...toolNames],
    systemPrompt: buildIntegrationSystemPrompt(groupName),
    maxSteps: 30,
    timeoutMs: 120_000,
  };
}

/**
 * Resolve integration tool names from the registry using prefix matching.
 */
export function resolveIntegrationTools(
  groupName: string,
  allToolNames: string[],
): string[] {
  const prefixes = INTEGRATION_PREFIX_MAP[groupName];
  if (!prefixes) return [];
  return allToolNames.filter(name => prefixes.some(p => name.startsWith(p)));
}

// ─── Pack Registry ───────────────────────────────────────────────────────────

const PACKS: Record<string, CapabilityPack> = {
  browser: BROWSER_PACK,
  file_ops: FILE_OPS_PACK,
  workflow: WORKFLOW_PACK,
};

export function getCapabilityPack(kind: SubagentKind): CapabilityPack | undefined {
  return PACKS[kind];
}

export function getAllCapabilityPacks(): CapabilityPack[] {
  return Object.values(PACKS);
}

// ─── Subagent Name Registry (used by the unified `delegate` tool) ────────────

const STATIC_SUBAGENT_NAMES = ['browser', 'file_ops', 'workflow'] as const;
const INTEGRATION_SUBAGENT_NAMES = Object.keys(INTEGRATION_PREFIX_MAP) as Array<keyof typeof INTEGRATION_PREFIX_MAP>;

export const KNOWN_SUBAGENT_NAMES = [
  ...STATIC_SUBAGENT_NAMES,
  ...INTEGRATION_SUBAGENT_NAMES,
] as const;

export type SubagentName = (typeof KNOWN_SUBAGENT_NAMES)[number];
