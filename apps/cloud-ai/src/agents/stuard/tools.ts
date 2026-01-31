import { waitTool } from '../../tools/wait';
import { runSequentialTool, runParallelTool } from '../../tools/workflow-system';
import { analyzeMediaTool } from '../../tools/analyze-media';
import { outlook_get_me, outlook_list_messages, outlook_search_messages, outlook_send_mail } from '../../tools/outlook-tools';
import { github_get_me, github_list_repos, github_list_issues, github_create_issue } from '../../tools/github-tools';
import { google_get_userinfo, gmail_send_message, gmail_list_messages, gmail_get_message_brief, gmail_get_message_full, gmail_get_messages_brief, gmail_list_recent_brief, gmail_get_most_recent_full, gmail_modify_message, gmail_delete_message, gmail_archive_message, gmail_mark_as_read, gmail_mark_as_unread, calendar_list_events, calendar_create_event, calendar_delete_event, tasks_list, drive_list_files, sheets_read_range, docs_get_document, docs_create_document, docs_write_text } from '../../tools/google-tools';
import { send_hotkey, list_directory, read_file, write_file, create_directory, open_file, move_file, copy_file, delete_file, canvas_list, canvas_read, canvas_write, canvas_create, canvas_delete, capture_media, stop_capture, describe_media_capture_capabilities, capture_screen, stop_screen_capture, describe_screen_capture_capabilities, capture_system_audio, stop_system_audio, describe_system_audio_capabilities, run_command, run_system_command, run_python_script, list_terminals, read_terminal, terminal_create, terminal_list, terminal_get, terminal_read, terminal_send_input, terminal_send_raw, terminal_send_keys, terminal_wait_for, terminal_destroy, list_local_workflows, list_local_stuards, show_json_workflow_code, execute_workflow, find_workflow_semantic, import_workflow, run_automation, stop_automation, invoke_workflow, search_past_conversations, get_conversation_context, list_user_spaces, get_space_contents, add_to_space, ensure_space_path, list_space_path, add_to_space_path, get_space_tree, create_space, add_source_to_space, add_note_to_space, add_code_snippet_to_space, link_conversation_to_space, find_or_create_space, update_space_item, delete_space_item, calendar_crud, task_crud, task_reminders, planner_list_items, list_open_windows, bring_window_to_foreground, smart_bring_window_to_foreground, get_window_info, set_window_bounds, file_index_add_root, file_index_remove_root, file_index_list_roots, file_index_scan, file_index_stats, file_search, file_search_by_filename, file_search_by_kind, file_search_recent, file_search_similar, process_pending_file_index, semantic_file_search, file_read, file_edit, browser_get_content, browser_click_element, browser_type_text, browser_find_text, browser_get_element_position, browser_find_clickable, browser_hover, browser_select_option, browser_press_key, browser_get_form_fields, browser_fill_form, browser_wait_for_element, browser_scroll_to, browser_get_page_info, browser_execute_script, agent_todo, get_mouse_position, computer_use, click_at_coordinates, double_click_at_coordinates, type_text, scroll, drag_and_drop } from '../../tools/device-tools';
import { computer_use_agent } from '../../tools/device-tools';
import { web_search } from '../../tools/perplexity-tools';
import { scrape_url } from '../../tools/tavily-tools';
import { deployHeadlessAgent } from '../../tools/deploy-headless-agent';
import { getHeadlessAgentStatus } from '../../tools/get-headless-agent-status';
import { listHeadlessAgentTasks } from '../../tools/list-headless-agent-tasks';
import { stopHeadlessAgent } from '../../tools/stop-headless-agent';
import { ffmpeg_status, ffmpeg_setup, ffmpeg_run, ffmpeg_convert_media, ffmpeg_extract_audio, ffmpeg_trim_media, ffmpeg_probe_media, ffmpeg_extract_frames } from '../../tools/device-tools';
import { submitFeedback, reportBug, suggestFeature, listMyFeedback, getFeedbackDetails } from '../../tools/feedback-tools';
import { createRequire } from 'node:module';
import type { SIS as SISType } from 'sis-tools';
import { searchToolsSemanticSupabase, isSupabaseSISEnabled } from '../../tools/sis-supabase';
import { SIS_RUNTIME_TOOLS } from '../../tools/sis-runtime-tools';
import { hasClientBridge } from '../../tools/bridge';

const require = createRequire(import.meta.url);
const { SIS: SISRuntime } = require('sis-tools') as { SIS: new (...args: any[]) => SISType };

// Consolidated tool map
export const ALL_TOOLS = {
  // Keep minimal set while refactoring streaming
  wait: waitTool,
  run_sequential: runSequentialTool,
  run_parallel: runParallelTool,
  // Vision/media analysis (consolidated tool)
  analyze_media: analyzeMediaTool,
  web_search,
  scrape_url,
  deploy_headless_agent: deployHeadlessAgent,
  get_headless_agent_status: getHeadlessAgentStatus,
  list_headless_agent_tasks: listHeadlessAgentTasks,
  stop_headless_agent: stopHeadlessAgent,
  // Outlook / Microsoft Graph (cloud-only, requires accessToken argument)
  outlook_get_me,
  outlook_list_messages,
  outlook_search_messages,
  outlook_send_mail,
  // Google Workspace
  google_get_userinfo,
  gmail_send_message,
  gmail_list_messages,
  gmail_get_message_brief,
  gmail_get_message_full,
  gmail_get_messages_brief,
  gmail_list_recent_brief,
  gmail_get_most_recent_full,
  gmail_modify_message,
  gmail_delete_message,
  gmail_archive_message,
  gmail_mark_as_read,
  gmail_mark_as_unread,
  calendar_list_events,
  calendar_create_event,
  calendar_delete_event,
  tasks_list,
  drive_list_files,
  sheets_read_range,
  docs_get_document,
  docs_create_document,
  docs_write_text,
  send_hotkey,
  get_mouse_position,
  computer_use,
  computer_use_agent,
  click_at_coordinates,
  double_click_at_coordinates,
  type_text,
  scroll,
  drag_and_drop,
  canvas_list,
  canvas_read,
  canvas_write,
  canvas_create,
  canvas_delete,
  capture_media,
  stop_capture,
  describe_media_capture_capabilities,
  // Screen recording & system audio
  capture_screen,
  stop_screen_capture,
  describe_screen_capture_capabilities,
  capture_system_audio,
  stop_system_audio,
  describe_system_audio_capabilities,

  ffmpeg_status,
  ffmpeg_setup,
  ffmpeg_run,
  ffmpeg_convert_media,
  ffmpeg_extract_audio,
  ffmpeg_trim_media,
  ffmpeg_probe_media,
  ffmpeg_extract_frames,
  run_system_command,
  run_command,
  run_python_script,
  // Background terminal polling (non-interactive)
  list_terminals,
  read_terminal,
  // Interactive PTY terminal tools
  terminal_create,
  terminal_list,
  terminal_get,
  terminal_read,
  terminal_send_input,
  terminal_send_raw,
  terminal_send_keys,
  terminal_wait_for,
  terminal_destroy,

  // Calendar / Tasks / Reminders
  calendar_crud,
  task_crud,
  task_reminders,
  planner_list_items,
  // Basic filesystem tools
  list_directory,
  read_file,
  write_file,
  create_directory,
  open_file,
  move_file,
  copy_file,
  delete_file,
  // Window management
  list_open_windows,
  bring_window_to_foreground,
  get_window_info,
  smart_bring_window_to_foreground,
  set_window_bounds,
  // Local workflows / Stuards metadata
  list_local_workflows,
  list_local_stuards,
  show_json_workflow_code,
  execute_workflow,
  find_workflow_semantic,
  // Automation control
  import_workflow,
  run_automation,
  stop_automation,
  invoke_workflow,  // Invoke workflows with custom arguments
  // Memory + Spaces
  search_past_conversations,
  get_conversation_context,
  // Space management tools
  list_user_spaces,
  get_space_contents,
  add_to_space,
  ensure_space_path,
  list_space_path,
  add_to_space_path,
  get_space_tree,
  create_space,
  add_source_to_space,
  add_note_to_space,
  add_code_snippet_to_space,
  link_conversation_to_space,
  find_or_create_space,
  update_space_item,
  delete_space_item,
  // GitHub tools (require user to have connected GitHub via dashboard)
  github_get_me,
  github_list_repos,
  github_list_issues,
  github_create_issue,
  // File Search & Indexing
  file_index_add_root,
  file_index_remove_root,
  file_index_list_roots,
  file_index_scan,
  file_index_stats,
  file_search,
  file_search_by_filename,
  file_search_by_kind,
  file_search_recent,
  file_search_similar,
  process_pending_file_index,
  semantic_file_search,

  file_edit,
  // Browser Extension tools
  browser_get_content,
  browser_click_element,
  browser_type_text,
  browser_find_text,
  browser_get_element_position,
  browser_find_clickable,
  browser_hover,
  browser_select_option,
  browser_press_key,
  browser_get_form_fields,
  browser_fill_form,
  browser_wait_for_element,
  browser_scroll_to,
  browser_get_page_info,
  browser_execute_script,
  agent_todo,
  // Feedback tools
  submit_feedback: submitFeedback,
  report_bug: reportBug,
  suggest_feature: suggestFeature,
  list_my_feedback: listMyFeedback,
  get_feedback_details: getFeedbackDetails,
} as const;

const _INTERNAL_SPACE_TOOLS = {
  list_user_spaces,
  get_space_contents,
  add_to_space,
  ensure_space_path,
  list_space_path,
  add_to_space_path,
  get_space_tree,
  create_space,
  add_source_to_space,
  add_note_to_space,
  add_code_snippet_to_space,
  link_conversation_to_space,
  find_or_create_space,
  update_space_item,
  delete_space_item,
} as const;

/**
 * Minimal Paramount Tools - DEPRECATED
 * @deprecated No longer used. Tier 1 tools are now always loaded.
 * Kept for backward compatibility only.
 */
export const MINIMAL_PARAMOUNT_TOOLS = [
  // Orchestration (3) - essential for any workflow
  'wait', 'run_sequential', 'run_parallel',

  // Basic File Operations (4) - very common operations
  'read_file', 'write_file', 'list_directory', 'file_edit',

  // System Commands (2) - frequently needed
  'run_command', 'run_system_command',

  // Web Search (1) - common for research
  'web_search',
] as const;

/**
 * Tier 1 Paramount Tools - ALWAYS loaded at runtime
 * These essential tools are loaded upfront for all agents.
 * When SIS runtime is enabled, discovery tools are added on top.
 */
export const TIER_1_PARAMOUNT_TOOLS = [
  // Orchestration (3)
  'wait', 'run_sequential', 'run_parallel',

  // Basic File Operations (8)
  'read_file', 'write_file', 'list_directory', 'create_directory',
  'file_read', 'file_edit', 'open_file', 'move_file',

  // System Commands (13)
  'run_command', 'run_system_command', 'list_terminals', 'read_terminal',
  'terminal_create', 'terminal_list', 'terminal_get', 'terminal_read',
  'terminal_send_input', 'terminal_send_raw', 'terminal_send_keys',
  'terminal_wait_for', 'terminal_destroy',

  // Input/Automation (7)
  'send_hotkey',
  'computer_use',
  'computer_use_agent',
  'get_mouse_position',
  'click_at_coordinates',
  'double_click_at_coordinates',
  'type_text',
  'scroll',
  'drag_and_drop',

  // Vision/Media/Capture (4)
  'analyze_media', 'capture_screen', 'capture_media', 'stop_capture',

  // Memory/Context & Spaces (17)
  'search_past_conversations', 'get_conversation_context',
  'list_user_spaces', 'get_space_contents',
  'create_space', 'add_to_space', 'add_source_to_space',
  'add_note_to_space', 'add_code_snippet_to_space',
  'ensure_space_path', 'list_space_path', 'add_to_space_path', 'get_space_tree',
  'find_or_create_space', 'update_space_item', 'delete_space_item',
  'link_conversation_to_space',

  // Web Search (1)
  'web_search',

  // Web Extraction (1)
  'scrape_url',

  // Headless Agents (4)
  'deploy_headless_agent', 'get_headless_agent_status',
  'list_headless_agent_tasks', 'stop_headless_agent',

  // Workflows as Tools (2)
  'execute_workflow',
  'find_workflow_semantic',

  // Agent Todo Management (1)
  'agent_todo',

  // Productivity (4)
  'calendar_crud',
  'task_crud',
  'task_reminders',
  'planner_list_items',

  // Canvas Documents (5) - AI can read/write user's canvas notes
  'canvas_list',
  'canvas_read',
  'canvas_write',
  'canvas_create',
  'canvas_delete',

  // Feedback (5) - Bug reports and feature requests
  'submit_feedback',
  'report_bug',
  'suggest_feature',
  'list_my_feedback',
  'get_feedback_details',
] as const;

const _FFMPEG_TIER_1_TOOLS = [
  'ffmpeg_status',
  'ffmpeg_setup',
  'ffmpeg_run',
  'ffmpeg_convert_media',
  'ffmpeg_extract_audio',
  'ffmpeg_trim_media',
  'ffmpeg_probe_media',
  'ffmpeg_extract_frames',
] as const;

const SIS_ESSENTIAL_TOOLS = ['wait', 'run_sequential', 'run_parallel'] as const;

let _sis: SISType | null = null;
let _sisInitPromise: Promise<void> | null = null;

async function getSis(): Promise<SISType | null> {
  if (_sis) return _sis;
  if (_sisInitPromise) {
    await _sisInitPromise;
    return _sis;
  }

  if (process.env.SIS_ENABLE !== '1') return null;

  _sis = new SISRuntime({
    embeddingProvider: 'openai',
    providerOptions: {
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.SIS_EMBEDDING_MODEL || 'text-embedding-3-small',
    },
    defaultTopK: Number(process.env.SIS_TOPK || '12'),
    defaultThreshold: Number(process.env.SIS_THRESHOLD || '0.25'),
  });

  // Build SIS index once from ALL_TOOLS. We use descriptions + lightweight semantic hints.
  // We intentionally do not include handlers here; we only use SIS for selection.
  for (const [name, tool] of Object.entries(ALL_TOOLS as any)) {
    const description = String((tool as any)?.description || '').trim();
    _sis.register({
      name,
      description: description || name,
      parameters: {},
      semanticHints: [name],
      metadata: {
        priority: SIS_ESSENTIAL_TOOLS.includes(name as any) ? 2.0 : 1.0,
      },
    });
  }

  _sisInitPromise = (async () => {
    try {
      await _sis!.initialize();
    } catch (e) {
      // If embeddings fail (missing API key, provider error), fall back to non-semantic selection.
      if (process.env.SIS_DEBUG === '1') {
        console.warn('[sis] initialize failed; disabling SIS for this process:', e);
      }
      _sis = null;
    } finally {
      _sisInitPromise = null;
    }
  })();

  await _sisInitPromise;
  return _sis;
}

// Always available tools
export const CORE_TOOLS_LIST = [
  'wait', 'run_sequential', 'run_parallel', 'analyze_media', 'web_search', 'scrape_url',
  'deploy_headless_agent', 'get_headless_agent_status', 'list_headless_agent_tasks', 'stop_headless_agent',
  'send_hotkey', 'computer_use', 'computer_use_agent', 'canvas_list', 'canvas_read', 'canvas_write', 'canvas_create', 'canvas_delete', 'capture_media', 'stop_capture',
  'describe_media_capture_capabilities',
  // Screen recording & system audio
  'capture_screen', 'stop_screen_capture', 'describe_screen_capture_capabilities',
  'capture_system_audio', 'stop_system_audio', 'describe_system_audio_capabilities',
  'run_system_command', 'run_command', 'run_python_script',
  // Background terminal polling (non-interactive)
  'list_terminals', 'read_terminal',
  // Interactive PTY terminal tools
  'terminal_create', 'terminal_list', 'terminal_get', 'terminal_read', 'terminal_send_input', 'terminal_send_raw', 'terminal_send_keys', 'terminal_wait_for', 'terminal_destroy',
  // Variables
  'set_variable', 'get_variable', 'toggle_variable', 'increment_variable', 'append_to_list', 'list_variables', 'delete_variable',
  'calendar_crud', 'task_crud', 'task_reminders', 'planner_list_items',
  'list_directory', 'read_file', 'write_file', 'create_directory', 'open_file', 'move_file', 'copy_file', 'delete_file',
  'list_open_windows', 'bring_window_to_foreground', 'get_window_info', 'smart_bring_window_to_foreground', 'set_window_bounds',
  'list_local_workflows', 'list_local_stuards', 'show_json_workflow_code',
  'import_workflow', 'run_automation', 'stop_automation', 'invoke_workflow',
  'search_past_conversations', 'get_conversation_context',
  'list_user_spaces', 'get_space_contents',
  'ensure_space_path', 'list_space_path', 'add_to_space_path', 'get_space_tree',
  'add_to_space', 'create_space',
  'add_source_to_space', 'add_note_to_space', 'add_code_snippet_to_space',
  'link_conversation_to_space', 'find_or_create_space',
  'update_space_item', 'delete_space_item',
  // File Search & Indexing
  'file_index_add_root', 'file_index_remove_root', 'file_index_list_roots', 'file_index_scan', 'file_index_stats',
  'file_search', 'file_search_by_filename', 'file_search_by_kind', 'file_search_recent', 'file_search_similar',
  'process_pending_file_index', 'semantic_file_search',
  // Agentic File Tools
  'file_read', 'file_edit',
  // Browser tools
  'browser_get_content', 'browser_click_element', 'browser_type_text',
  'browser_find_text', 'browser_get_element_position', 'browser_find_clickable',
  'browser_hover', 'browser_select_option', 'browser_press_key',
  'browser_get_form_fields', 'browser_fill_form', 'browser_wait_for_element',
  'browser_scroll_to', 'browser_get_page_info', 'browser_execute_script'
];

export function getTools(enabledIntegrations: string[] = [], mcpTools: Record<string, any> = {}): Record<string, any> {
  const tools: Record<string, any> = { ...mcpTools };

  // Add core tools
  CORE_TOOLS_LIST.forEach(name => {
    if ((ALL_TOOLS as any)[name]) {
      tools[name] = (ALL_TOOLS as any)[name];
    }
  });

  if (hasClientBridge()) {
    for (const name of _FFMPEG_TIER_1_TOOLS) {
      if ((ALL_TOOLS as any)[name]) {
        tools[name] = (ALL_TOOLS as any)[name];
      }
    }
  }

  // Integration-specific tools
  if (enabledIntegrations.includes('outlook')) {
    tools.outlook_get_me = ALL_TOOLS.outlook_get_me;
    tools.outlook_list_messages = ALL_TOOLS.outlook_list_messages;
    tools.outlook_search_messages = ALL_TOOLS.outlook_search_messages;
    tools.outlook_send_mail = ALL_TOOLS.outlook_send_mail;
  }

  if (enabledIntegrations.includes('google')) {
    tools.google_get_userinfo = ALL_TOOLS.google_get_userinfo;
    tools.gmail_send_message = ALL_TOOLS.gmail_send_message;
    tools.gmail_list_messages = ALL_TOOLS.gmail_list_messages;
    tools.gmail_get_message_brief = ALL_TOOLS.gmail_get_message_brief;
    tools.gmail_get_message_full = ALL_TOOLS.gmail_get_message_full;
    tools.gmail_get_messages_brief = ALL_TOOLS.gmail_get_messages_brief;
    tools.gmail_list_recent_brief = ALL_TOOLS.gmail_list_recent_brief;
    tools.gmail_get_most_recent_full = ALL_TOOLS.gmail_get_most_recent_full;
    tools.gmail_modify_message = ALL_TOOLS.gmail_modify_message;
    tools.gmail_delete_message = ALL_TOOLS.gmail_delete_message;
    tools.gmail_archive_message = ALL_TOOLS.gmail_archive_message;
    tools.gmail_mark_as_read = ALL_TOOLS.gmail_mark_as_read;
    tools.gmail_mark_as_unread = ALL_TOOLS.gmail_mark_as_unread;
    tools.calendar_list_events = ALL_TOOLS.calendar_list_events;
    tools.calendar_create_event = ALL_TOOLS.calendar_create_event;
    tools.tasks_list = ALL_TOOLS.tasks_list;
    tools.drive_list_files = ALL_TOOLS.drive_list_files;
    tools.sheets_read_range = ALL_TOOLS.sheets_read_range;
    tools.docs_get_document = ALL_TOOLS.docs_get_document;
    tools.docs_create_document = ALL_TOOLS.docs_create_document;
    tools.docs_write_text = ALL_TOOLS.docs_write_text;
  }

  if (enabledIntegrations.includes('github')) {
    tools.github_get_me = ALL_TOOLS.github_get_me;
    tools.github_list_repos = ALL_TOOLS.github_list_repos;
    tools.github_list_issues = ALL_TOOLS.github_list_issues;
    tools.github_create_issue = ALL_TOOLS.github_create_issue;
  }

  return tools;
}

export async function getToolsForQuery(
  query: string,
  enabledIntegrations: string[] = [],
  mcpTools: Record<string, any> = {}
): Promise<Record<string, any>> {
  const selected: Record<string, any> = { ...mcpTools };

  // =========================================================================
  // ALWAYS load Tier 1 paramount tools first
  // These are the most commonly used tools and should always be available
  // =========================================================================
  const tier1Tools = hasClientBridge()
    ? [...TIER_1_PARAMOUNT_TOOLS, ..._FFMPEG_TIER_1_TOOLS]
    : TIER_1_PARAMOUNT_TOOLS;

  for (const name of tier1Tools) {
    if ((ALL_TOOLS as any)[name]) {
      selected[name] = (ALL_TOOLS as any)[name];
    }
  }

  // =========================================================================
  // ALWAYS add SIS runtime tools for dynamic discovery
  // These tools now have proper fallback (keyword search) when Supabase isn't available
  // =========================================================================
  selected.sis_search_tools = SIS_RUNTIME_TOOLS.sis_search_tools;
  selected.sis_execute_tool = SIS_RUNTIME_TOOLS.sis_execute_tool;
  selected.sis_list_categories = SIS_RUNTIME_TOOLS.sis_list_categories;

  if (process.env.SIS_DEBUG === '1') {
    const searchMode = isSupabaseSISEnabled() ? 'semantic (Supabase)' : 'keyword (fallback)';
    console.log(`[sis-runtime] Loaded ${Object.keys(selected).length} tools (Tier 1 + SIS discovery)`);
    console.log(`[sis-runtime] Search mode: ${searchMode}`);
    console.log('[sis-runtime] SIS tools added: sis_search_tools, sis_execute_tool, sis_list_categories');
  }

  // Also try in-memory SIS for additional query-based tools if enabled
  if (process.env.SIS_ENABLE === '1') {
    const sis = await getSis();
    if (sis) {
      try {
        const resolved = await sis.resolve(String(query || ''), { format: 'raw' });
        for (const r of resolved) {
          if ((ALL_TOOLS as any)[r.name] && !selected[r.name]) {
            selected[r.name] = (ALL_TOOLS as any)[r.name];
          }
        }
        if (process.env.SIS_DEBUG === '1') {
          console.log('[sis-memory] Added additional tools from in-memory SIS');
        }
      } catch (e) {
        if (process.env.SIS_DEBUG === '1') {
          console.warn('[sis-memory] In-memory resolve failed:', e);
        }
      }
    }
  }

  // =========================================================================
  // Always add integration-specific tools if user has them enabled
  // These are loaded regardless of SIS mode since user explicitly connected
  // =========================================================================

  if (enabledIntegrations.includes('outlook')) {
    selected.outlook_get_me = ALL_TOOLS.outlook_get_me;
    selected.outlook_list_messages = ALL_TOOLS.outlook_list_messages;
    selected.outlook_search_messages = ALL_TOOLS.outlook_search_messages;
    selected.outlook_send_mail = ALL_TOOLS.outlook_send_mail;
  }

  if (enabledIntegrations.includes('google')) {
    selected.google_get_userinfo = ALL_TOOLS.google_get_userinfo;
    selected.gmail_send_message = ALL_TOOLS.gmail_send_message;
    selected.gmail_list_messages = ALL_TOOLS.gmail_list_messages;
    selected.gmail_get_message_brief = ALL_TOOLS.gmail_get_message_brief;
    selected.gmail_get_message_full = ALL_TOOLS.gmail_get_message_full;
    selected.gmail_get_messages_brief = ALL_TOOLS.gmail_get_messages_brief;
    selected.gmail_list_recent_brief = ALL_TOOLS.gmail_list_recent_brief;
    selected.gmail_get_most_recent_full = ALL_TOOLS.gmail_get_most_recent_full;
    selected.gmail_modify_message = ALL_TOOLS.gmail_modify_message;
    selected.gmail_delete_message = ALL_TOOLS.gmail_delete_message;
    selected.gmail_archive_message = ALL_TOOLS.gmail_archive_message;
    selected.gmail_mark_as_read = ALL_TOOLS.gmail_mark_as_read;
    selected.gmail_mark_as_unread = ALL_TOOLS.gmail_mark_as_unread;
    selected.calendar_list_events = ALL_TOOLS.calendar_list_events;
    selected.calendar_create_event = ALL_TOOLS.calendar_create_event;
    selected.tasks_list = ALL_TOOLS.tasks_list;
    selected.drive_list_files = ALL_TOOLS.drive_list_files;
    selected.sheets_read_range = ALL_TOOLS.sheets_read_range;
    selected.docs_get_document = ALL_TOOLS.docs_get_document;
    selected.docs_create_document = ALL_TOOLS.docs_create_document;
    selected.docs_write_text = ALL_TOOLS.docs_write_text;
  }

  if (enabledIntegrations.includes('github')) {
    selected.github_get_me = ALL_TOOLS.github_get_me;
    selected.github_list_repos = ALL_TOOLS.github_list_repos;
    selected.github_list_issues = ALL_TOOLS.github_list_issues;
    selected.github_create_issue = ALL_TOOLS.github_create_issue;
  }

  return selected;
}
