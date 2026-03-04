import { waitTool } from '../../tools/wait';
import { runSequentialTool, runParallelTool } from '../../tools/workflow-system';
import { analyzeMediaTool } from '../../tools/analyze-media';
import { outlook_get_me, outlook_list_messages, outlook_search_messages, outlook_send_mail } from '../../tools/outlook-tools';
import { github_get_me, github_list_repos, github_list_issues, github_create_issue } from '../../tools/github-tools';
import { google_get_userinfo, gmail_send_message, gmail_list_messages, gmail_get_message_brief, gmail_get_message_full, gmail_get_messages_brief, gmail_list_recent_brief, gmail_get_most_recent_full, gmail_modify_message, gmail_delete_message, gmail_archive_message, gmail_mark_as_read, gmail_mark_as_unread, gmail_download_attachment, calendar_list_events, calendar_create_event, calendar_delete_event, tasks_list, drive_list_files, sheets_read_range, sheets_create_spreadsheet, sheets_write_range, sheets_append_rows, sheets_clear_range, sheets_get_spreadsheet, sheets_add_sheet, sheets_format_cells, sheets_batch_update_values, sheets_delete_rows_columns, sheets_sort_range, sheets_auto_resize, docs_get_document, docs_create_document, docs_write_text } from '../../tools/google-tools';
import { send_hotkey, list_directory, read_file, write_file, create_directory, open_file, move_file, copy_file, delete_file, canvas_list, canvas_read, canvas_write, canvas_create, canvas_delete, capture_media, stop_capture, describe_media_capture_capabilities, capture_screen, stop_screen_capture, describe_screen_capture_capabilities, capture_system_audio, stop_system_audio, describe_system_audio_capabilities, run_command, run_system_command, run_python_script, list_terminals, read_terminal, terminal_create, terminal_list, terminal_get, terminal_read, terminal_send_input, terminal_send_raw, terminal_send_keys, terminal_wait_for, terminal_destroy, list_local_stuards, show_json_workflow_code, execute_workflow, find_workflow_semantic, import_workflow, run_automation, stop_automation, invoke_workflow, search_local_workflows, run_workflow, search_past_conversations, get_conversation_context, list_user_spaces, get_space_contents, add_to_space, ensure_space_path, list_space_path, add_to_space_path, get_space_tree, create_space, add_source_to_space, add_note_to_space, add_code_snippet_to_space, link_conversation_to_space, find_or_create_space, update_space_item, delete_space_item, calendar_crud, task_crud, task_reminders, planner_list_items, list_open_windows, bring_window_to_foreground, smart_bring_window_to_foreground, get_window_info, set_window_bounds, file_index_add_root, file_index_remove_root, file_index_list_roots, file_index_scan, file_index_stats, file_search, file_search_by_filename, file_search_by_kind, file_search_recent, file_search_similar, process_pending_file_index, semantic_file_search, file_read, file_edit, glob, grep, browser_get_content, browser_click_element, browser_type_text, browser_find_text, browser_get_element_position, browser_find_clickable, browser_hover, browser_select_option, browser_press_key, browser_get_form_fields, browser_fill_form, browser_wait_for_element, browser_scroll_to, browser_get_page_info, browser_execute_script, browser_upload_file, browser_set_toggle, agent_todo, get_mouse_position, computer_use, click_at_coordinates, double_click_at_coordinates, type_text, scroll, drag_and_drop } from '../../tools/device-tools';
import { computer_use_agent, agent_node, agent_decision, agent_extract } from '../../tools/device-tools';
import { web_search } from '../../tools/perplexity-tools';
import { scrape_url } from '../../tools/tavily-tools';
import { deployHeadlessAgent } from '../../tools/deploy-headless-agent';
import { getHeadlessAgentStatus } from '../../tools/get-headless-agent-status';
import { listHeadlessAgentTasks } from '../../tools/list-headless-agent-tasks';
import { stopHeadlessAgent } from '../../tools/stop-headless-agent';
import { ffmpeg_status, ffmpeg_setup, ffmpeg_run, ffmpeg_convert_media, ffmpeg_extract_audio, ffmpeg_trim_media, ffmpeg_probe_media, ffmpeg_extract_frames, folder_permission_add, folder_permission_remove, folder_permission_list, folder_permission_set_enabled, folder_permission_check, get_datetime, math_eval, generate_uuid, random_number, random_choice, get_env_var, get_system_info, hash_string, base64_encode, base64_decode, json_parse, json_stringify, sleep, regex_match, regex_replace } from '../../tools/device-tools';
import { ollama_status, ollama_chat, ollama_generate, ollama_vision, ollama_embeddings, ollama_models } from '../../tools/device-tools';
import { browser_use_status, browser_use_configure, browser_use_task, browser_use_navigate, browser_use_click, browser_use_type, browser_use_press_key, browser_use_screenshot, browser_use_content, browser_use_scroll, browser_use_tabs, browser_use_cookies } from '../../tools/device-tools';
import { submitFeedback, reportBug, suggestFeature, listMyFeedback, getFeedbackDetails } from '../../tools/feedback-tools';
import { telnyx_send_sms, telnyx_make_call, telnyx_phone_status } from '../../tools/telnyx-tools';
import { http_request } from '../../tools/http-tools';
import { createRequire } from 'node:module';
import type { SIS as SISType } from 'sis-tools';
import { searchToolsSemanticSupabase, isSupabaseSISEnabled } from '../../tools/sis-supabase';
import { SIS_RUNTIME_TOOLS } from '../../tools/sis-runtime-tools';
import { get_tool_schema, execute_tool, search_tools } from '../../tools/meta-tools';
import { get_skill_info } from '../../tools/skill-tools';
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
  // AI Agent workflow nodes (synchronous inline agents)
  agent_node,
  agent_decision,
  agent_extract,
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
  calendar_create_event,
  calendar_delete_event,
  tasks_list,
  drive_list_files,
  sheets_read_range,
  sheets_create_spreadsheet,
  sheets_write_range,
  sheets_append_rows,
  sheets_clear_range,
  sheets_get_spreadsheet,
  sheets_add_sheet,
  sheets_format_cells,
  sheets_batch_update_values,
  sheets_delete_rows_columns,
  sheets_sort_range,
  sheets_auto_resize,
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
  http_request,
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
  // Folder permissions (restrict agent's file access)
  folder_permission_add,
  folder_permission_remove,
  folder_permission_list,
  folder_permission_set_enabled,
  folder_permission_check,
  // Utility tools (no scripts needed)
  get_datetime,
  math_eval,
  generate_uuid,
  random_number,
  random_choice,
  get_env_var,
  get_system_info,
  hash_string,
  base64_encode,
  base64_decode,
  json_parse,
  json_stringify,
  sleep,
  regex_match,
  regex_replace,
  // Window management
  list_open_windows,
  bring_window_to_foreground,
  get_window_info,
  smart_bring_window_to_foreground,
  set_window_bounds,
  // Local workflows metadata (consolidated - no more stuards distinction)
  list_local_stuards,  // Deprecated, kept for backwards compat
  show_json_workflow_code,
  execute_workflow,
  find_workflow_semantic,
  // Automation control
  import_workflow,
  run_automation,
  stop_automation,
  invoke_workflow,  // Invoke workflows with custom arguments
  search_local_workflows,  // Primary tool for listing/searching workflows
  run_workflow,  // Run workflow by ID or name
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
  // Ollama (Local AI models — private, on-device)
  ollama_status,
  ollama_chat,
  ollama_generate,
  ollama_vision,
  ollama_embeddings,
  ollama_models,
  // Browser Use (AI browser automation — requires browser-use Python package)
  browser_use_status,
  browser_use_configure,
  browser_use_task,
  browser_use_navigate,
  browser_use_click,
  browser_use_type,
  browser_use_press_key,
  browser_use_screenshot,
  browser_use_content,
  browser_use_scroll,
  browser_use_tabs,
  browser_use_cookies,
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
  glob,
  grep,
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
  browser_upload_file,
  browser_set_toggle,
  browser_execute_script,
  agent_todo,
  // Feedback tools
  submit_feedback: submitFeedback,
  report_bug: reportBug,
  suggest_feature: suggestFeature,
  list_my_feedback: listMyFeedback,
  get_feedback_details: getFeedbackDetails,
  // SIS runtime tools (for dynamic tool discovery)
  sis_search_tools: SIS_RUNTIME_TOOLS.sis_search_tools,
  sis_execute_tool: SIS_RUNTIME_TOOLS.sis_execute_tool,
  sis_list_categories: SIS_RUNTIME_TOOLS.sis_list_categories,
  // Meta-tools for lazy-loading (always in Tier 1)
  get_tool_schema,
  execute_tool,
  search_tools,
  // Skills
  get_skill_info,
  // Telnyx (SMS / Voice calls — requires verified phone)
  telnyx_send_sms,
  telnyx_make_call,
  telnyx_phone_status,
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
 * Tier 1 Paramount Tools - ALWAYS loaded natively (~15 tools)
 * These get full schemas sent to the LLM. Keep this list small to save tokens.
 * Everything else is listed as names in the system prompt and accessed via
 * get_tool_schema + execute_tool (lazy-loading pattern).
 */
export const TIER_1_PARAMOUNT_TOOLS = [
  // File Operations (4) — most common across all conversations
  'read_file', 'write_file', 'list_directory', 'file_edit',

  // System Commands (2) — frequently needed
  'run_command', 'run_system_command',

  // Web (2) — research & scraping
  'web_search', 'scrape_url',

  // Vision (1) — screenshots for computer-use flows
  'capture_screen',

  // Memory (1) — recall past context
  'search_past_conversations',

  // Task Tracking (1) — multi-step task management
  'agent_todo',

  // Meta-tools for lazy-loading (3) — discover & run any other tool
  'get_tool_schema', 'execute_tool', 'search_tools',

  // Skills (1) — retrieve user-defined skill details
  'get_skill_info',
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

const SIS_META_TOOL_NAMES = ['sis_search_tools', 'sis_execute_tool', 'sis_list_categories'] as const;

let _sis: SISType | null = null;
let _sisInitPromise: Promise<void> | null = null;

/**
 * xAI models have stricter grammar complexity limits.
 * Limit to ~50 tools max to avoid "Grammar is too complex" errors.
 */
const XAI_MAX_TOOLS = 50;

function isXaiModel(modelId?: string): boolean {
  if (!modelId) return false;
  return modelId.startsWith('xai/') || modelId.includes('grok');
}

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

// Core tools list removed - using ALL_TOOLS by default

export function getTools(
  enabledIntegrations: string[] = [],
  mcpTools: Record<string, any> = {},
  modelId?: string
): Record<string, any> {
  // Start with MCP tools
  const tools: Record<string, any> = { ...mcpTools };

  // Default: Tier 1 + SIS discovery tools (lean ~35 tools)
  // Use SIS_LOAD_ALL=1 to force loading all tools (legacy behavior)
  if (process.env.SIS_LOAD_ALL === '1') {
    Object.assign(tools, ALL_TOOLS);
    return tools;
  }

  // Load Tier 1 tools
  for (const name of TIER_1_PARAMOUNT_TOOLS) {
    if ((ALL_TOOLS as any)[name]) {
      tools[name] = (ALL_TOOLS as any)[name];
    }
  }

  // Always add SIS discovery tools
  for (const name of SIS_META_TOOL_NAMES) {
    if ((ALL_TOOLS as any)[name]) {
      tools[name] = (ALL_TOOLS as any)[name];
    }
  }

  // Add integration tools if user has them connected
  if (enabledIntegrations.includes('google')) {
    for (const [name, tool] of Object.entries(ALL_TOOLS as any)) {
      if (name.startsWith('google_') || name.startsWith('gmail_') || name.startsWith('calendar_') || name.startsWith('drive_') || name.startsWith('sheets_') || name.startsWith('docs_') || name.startsWith('tasks_')) {
        tools[name] = tool;
      }
    }
  }
  if (enabledIntegrations.includes('outlook')) {
    for (const [name, tool] of Object.entries(ALL_TOOLS as any)) {
      if (name.startsWith('outlook_')) tools[name] = tool;
    }
  }
  if (enabledIntegrations.includes('github')) {
    for (const [name, tool] of Object.entries(ALL_TOOLS as any)) {
      if (name.startsWith('github_')) tools[name] = tool;
    }
  }
  if (enabledIntegrations.includes('ollama')) {
    for (const [name, tool] of Object.entries(ALL_TOOLS as any)) {
      if (name.startsWith('ollama_')) tools[name] = tool;
    }
  }
  if (enabledIntegrations.includes('telnyx')) {
    for (const [name, tool] of Object.entries(ALL_TOOLS as any)) {
      if (name.startsWith('telnyx_')) tools[name] = tool;
    }
  }
  if (enabledIntegrations.includes('browser_use') || hasClientBridge()) {
    for (const [name, tool] of Object.entries(ALL_TOOLS as any)) {
      if (name.startsWith('browser_use_')) tools[name] = tool;
    }
  }

  if (process.env.SIS_DEBUG === '1') {
    console.log(`[tools] Lean mode: ${Object.keys(tools).length} tools (Tier1 + SIS + integrations)`);
  }

  return tools;
}

export async function getToolsForQuery(
  query: string,
  enabledIntegrations: string[] = [],
  mcpTools: Record<string, any> = {},
  modelId?: string,
  rankedToolNames?: string[]
): Promise<Record<string, any>> {
  const selected: Record<string, any> = { ...mcpTools };

  // ── Escape hatch: SIS_LOAD_ALL=1 loads everything (legacy) ──
  if (process.env.SIS_LOAD_ALL === '1') {
    Object.assign(selected, ALL_TOOLS);
    return selected;
  }

  // ── 1. Tier 1 paramount tools (always loaded, ~35) ──
  for (const name of TIER_1_PARAMOUNT_TOOLS) {
    if ((ALL_TOOLS as any)[name]) {
      selected[name] = (ALL_TOOLS as any)[name];
    }
  }

  // ── 2. SIS meta-tools for long-tail discovery (always loaded, 3) ──
  for (const name of SIS_META_TOOL_NAMES) {
    if ((ALL_TOOLS as any)[name]) {
      selected[name] = (ALL_TOOLS as any)[name];
    }
  }

  // ── 3. Embedding-ranked tools (dynamic, top-N from pgvector) ──
  // These are the tools most likely needed for this specific query,
  // selected by cosine similarity between prompt embedding and tool embeddings.
  // The embedding is memoized and shared with knowledge/memory retrieval.
  if (rankedToolNames && rankedToolNames.length > 0) {
    for (const name of rankedToolNames) {
      if ((ALL_TOOLS as any)[name] && !selected[name]) {
        selected[name] = (ALL_TOOLS as any)[name];
      }
    }
  }

  // ── 4. Integration tools (only if user has the integration connected) ──
  const integrationPrefixes: Record<string, string[]> = {
    google: ['google_', 'gmail_', 'calendar_', 'drive_', 'sheets_', 'docs_', 'tasks_'],
    outlook: ['outlook_'],
    github: ['github_'],
    notion: ['notion_'],
    linear: ['linear_'],
    ollama: ['ollama_'],
    telnyx: ['telnyx_'],
    browser_use: ['browser_use_'],
  };
  for (const integration of enabledIntegrations) {
    const prefixes = integrationPrefixes[integration];
    if (!prefixes) continue;
    for (const [name, tool] of Object.entries(ALL_TOOLS as any)) {
      if (!selected[name] && prefixes.some(p => name.startsWith(p))) {
        selected[name] = tool;
      }
    }
  }

  // Safety net: when a desktop bridge is active, keep browser_use tools available
  // even if integration state arrives late/stale.
  if (hasClientBridge()) {
    for (const [name, tool] of Object.entries(ALL_TOOLS as any)) {
      if (!selected[name] && name.startsWith('browser_use_')) {
        selected[name] = tool;
      }
    }
  }

  if (process.env.SIS_DEBUG === '1') {
    const rankedCount = rankedToolNames?.length || 0;
    console.log(`[tools] ${Object.keys(selected).length} tools loaded (Tier1=${TIER_1_PARAMOUNT_TOOLS.length} + SIS=${SIS_META_TOOL_NAMES.length} + Ranked=${rankedCount} + Integrations)`);
  }

  return selected;
}

