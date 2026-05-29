/**
 * The proactive/bot agent's "default kit" — tool names that are ALWAYS
 * available to a bot regardless of its per-bot allowedTools list. The user's
 * configured tools are layered on top of this set.
 *
 * This set must be IDENTICAL across runtimes (desktop local Python agent and
 * cloud-ai's AI-SDK agent / VM runs) so a bot gets the same default toolkit
 * wherever it executes. It was previously hardcoded in the desktop scheduler
 * utils and re-composed in cloud-ai; single-sourced here so adding a core tool
 * lands in both. (Tool *classification* — which handler runs a tool per
 * environment — is intentionally NOT shared; only these names are.)
 */

/** The user-facing task board. */
export const PROACTIVE_TASK_TOOL_NAMES = [
  'proactive_task_list',
  'proactive_task_update',
  'proactive_task_create',
  'proactive_task_delete',
] as const;

/** The bot's private kanban + run-log (the @stuardai/bots-core bot-memory store). */
export const BOT_MEMORY_TOOL_NAMES = [
  'bot_memory_list',
  'bot_memory_create',
  'bot_memory_update',
  'bot_memory_delete',
  'bot_memory_log',
  'bot_memory_profile_get',
  'bot_memory_profile_update',
] as const;

/**
 * Fixed plumbing tools (not a name family): tool discovery/execution, skill
 * lookup, notification + session bookkeeping, and cross-run memory recall.
 */
export const PROACTIVE_FIXED_CORE_TOOL_NAMES = [
  'search_tools',
  'get_tool_schema',
  'execute_tool',
  'get_skill_info',
  'choose_notification_channel',
  'write_session_summary',
  'search_past_conversations',
  'get_conversation_context',
] as const;

/** Full always-available core set = task board + private kanban + fixed plumbing. */
export const PROACTIVE_CORE_TOOL_NAMES: readonly string[] = [
  ...PROACTIVE_TASK_TOOL_NAMES,
  ...BOT_MEMORY_TOOL_NAMES,
  ...PROACTIVE_FIXED_CORE_TOOL_NAMES,
];
