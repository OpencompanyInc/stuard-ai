import { getSemanticInjections } from '../../utils/tool-groups';
import { waitTool } from '../../tools/wait';
import { runSequentialTool, runParallelTool } from '../../tools/workflow-system';
import { analyzeMediaTool } from '../../tools/analyze-media';
import {
  outlook_get_me, outlook_list_messages, outlook_search_messages, outlook_send_mail,
  outlook_get_message, outlook_list_recent_brief, outlook_list_folders,
  outlook_reply_message, outlook_forward_message, outlook_create_draft,
  outlook_mark_as_read, outlook_mark_as_unread, outlook_archive_message,
  outlook_move_message, outlook_delete_message,
  outlook_download_attachment, outlook_retrieve_messages_with_attachments,
  outlook_calendar_list_events, outlook_calendar_create_event,
  outlook_calendar_update_event, outlook_calendar_delete_event,
} from '../../tools/outlook-tools';
import {
  github_get_me, github_list_repos, github_list_issues, github_create_issue,
  github_list_issue_comments, github_create_issue_comment, github_update_issue,
  github_list_pulls, github_get_pull, github_create_pull, github_update_pull,
  github_merge_pull, github_list_pull_commits, github_list_pull_files,
  github_list_pull_reviews, github_create_pull_review, github_request_reviewers,
  github_list_branches, github_get_branch, github_create_branch, github_delete_branch,
  github_list_commits, github_get_commit, github_compare_commits,
  github_get_repo, github_get_file_content, github_search_code, github_search_repos,
  github_list_releases, github_create_release,
  github_list_labels,
  github_list_workflow_runs, github_get_workflow_run, github_rerun_workflow, github_dispatch_workflow,
  github_list_gists, github_create_gist,
} from '../../tools/github-tools';
import { google_get_userinfo, google_list_profiles, gmail_send_message, gmail_list_messages, gmail_get_message_brief, gmail_get_message_full, gmail_get_messages_brief, gmail_list_recent_brief, gmail_get_most_recent_full, gmail_modify_message, gmail_delete_message, gmail_archive_message, gmail_mark_as_read, gmail_mark_as_unread, gmail_download_attachment, gmail_retrieve_messages_with_attachments, calendar_list_events, calendar_create_event, calendar_delete_event, calendar_update_event, tasks_list, drive_list_files, sheets_read_range, sheets_create_spreadsheet, sheets_write_range, sheets_append_rows, sheets_clear_range, sheets_get_spreadsheet, sheets_add_sheet, sheets_format_cells, sheets_batch_update_values, sheets_delete_rows_columns, sheets_sort_range, sheets_auto_resize, docs_get_document, docs_create_document, docs_write_text } from '../../tools/google-tools';
import { send_hotkey, list_directory, read_file, write_file, create_directory, open_file, move_file, copy_file, delete_file, capture_media, stop_capture, describe_media_capture_capabilities, capture_screen, stop_screen_capture, describe_screen_capture_capabilities, capture_system_audio, stop_system_audio, describe_system_audio_capabilities, run_command, run_python_script, list_terminals, read_terminal, terminal_create, terminal_list, terminal_get, terminal_read, terminal_send_input, terminal_send_raw, terminal_send_keys, terminal_wait_for, terminal_destroy, list_local_stuards, show_json_workflow_code, execute_workflow, find_workflow_semantic, import_workflow, run_automation, stop_automation, invoke_workflow, search_local_workflows, run_workflow, search_past_conversations, get_conversation_context, list_user_spaces, get_space_contents, add_to_space, ensure_space_path, list_space_path, add_to_space_path, get_space_tree, create_space, add_source_to_space, add_note_to_space, add_code_snippet_to_space, link_conversation_to_space, find_or_create_space, update_space_item, delete_space_item, calendar_crud, task_crud, task_reminders, planner_list_items, list_open_windows, bring_window_to_foreground, smart_bring_window_to_foreground, get_window_info, set_window_bounds, file_index_add_root, file_index_remove_root, file_index_list_roots, file_index_scan, file_index_stats, file_search, file_search_by_filename, file_search_by_kind, file_search_recent, file_search_similar, process_pending_file_index, semantic_file_search, file_read, file_edit, glob, grep, browser_get_content, browser_click_element, browser_type_text, browser_find_text, browser_get_element_position, browser_find_clickable, browser_hover, browser_select_option, browser_press_key, browser_get_form_fields, browser_fill_form, browser_wait_for_element, browser_scroll_to, browser_get_page_info, browser_execute_script, browser_upload_file, browser_set_toggle, agent_todo, get_mouse_position, computer_use, click_at_coordinates, double_click_at_coordinates, type_text, scroll, drag_and_drop } from '../../tools/device-tools';
import { computer_use_agent, agent_node, agent_decision, agent_extract } from '../../tools/device-tools';
import { web_search } from '../../tools/perplexity-tools';
import { scrape_url } from '../../tools/tavily-tools';
import { deployHeadlessAgent } from '../../tools/deploy-headless-agent';
import { getHeadlessAgentStatus } from '../../tools/get-headless-agent-status';
import { listHeadlessAgentTasks } from '../../tools/list-headless-agent-tasks';
import { stopHeadlessAgent } from '../../tools/stop-headless-agent';
import { ffmpeg_status, ffmpeg_setup, ffmpeg_run, ffmpeg_convert_media, ffmpeg_extract_audio, ffmpeg_trim_media, ffmpeg_probe_media, ffmpeg_extract_frames, folder_permission_add, folder_permission_remove, folder_permission_list, folder_permission_set_enabled, folder_permission_check, get_datetime, math_eval, generate_uuid, random_number, random_choice, get_env_var, get_system_info, hash_string, base64_encode, base64_decode, json_parse, json_stringify, sleep, regex_match, regex_replace } from '../../tools/device-tools';
import { ollama_status, ollama_chat, ollama_generate, ollama_vision, ollama_embeddings, ollama_models } from '../../tools/device-tools';
import { browser_use_status, browser_use_configure, browser_use_execute_script, browser_use_navigate, browser_use_click, browser_use_type, browser_use_press_key, browser_use_screenshot, browser_use_content, browser_use_scroll, browser_use_tabs, browser_use_cookies, browser_use_hover, browser_use_select_option, browser_use_get_dropdown_options, browser_use_get_interactive_elements, browser_use_fill_form, browser_use_upload_file, browser_use_wait_for } from '../../tools/device-tools';
import { reddit_search, reddit_view_subreddit, reddit_view_comments, reddit_create_post, reddit_comment } from '../../tools/reddit-tools';
import { submitFeedback, reportBug, suggestFeature, listMyFeedback, getFeedbackDetails } from '../../tools/feedback-tools';
import { telnyx_send_sms, telnyx_call_control, telnyx_phone_status, telnyx_send_mms, telnyx_send_voice_note, telnyx_voice_call, telnyx_list_voice_providers, telnyx_list_active_calls, telnyx_hangup_call } from '../../tools/telnyx-tools';
import { whatsapp_send_message, whatsapp_send_media, whatsapp_send_reaction, whatsapp_mark_read, whatsapp_upload_media, whatsapp_status, whatsapp_get_media_url, whatsapp_download_media, whatsapp_send_voice_note, whatsapp_transcribe_voice_note, whatsapp_send_template, whatsapp_voice_call, whatsapp_make_call } from '../../tools/whatsapp-tools';
import { facebook_get_me, facebook_list_pages, facebook_list_page_posts, facebook_create_page_post, facebook_list_post_comments, facebook_reply_comment, facebook_delete_post, facebook_list_conversations, facebook_get_conversation_messages, facebook_send_message, instagram_get_me, instagram_list_media, instagram_publish_media, instagram_list_comments, instagram_reply_comment, instagram_delete_comment, instagram_list_conversations, instagram_get_conversation_messages, instagram_send_dm, threads_get_me, threads_list_posts, threads_publish_post, threads_get_post, threads_list_replies, threads_reply_to_post } from '../../tools/meta-social-tools';
import { text_to_speech, list_tts_voices, get_tts_models, elevenlabs_list_agents, elevenlabs_get_signed_conversation_url, elevenlabs_get_webrtc_token, elevenlabs_list_conversations, elevenlabs_get_conversation } from '../../tools/tts-tools';
import { cloud_storage_upload, cloud_storage_get_url, cloud_storage_list, cloud_storage_delete, cloud_storage_set_visibility } from '../../tools/cloud-storage-tools';
import { http_request } from '../../tools/http-tools';
import { proactive_task_create, proactive_task_list, proactive_task_update, proactive_task_delete } from '../../tools/proactive-task-tools';
import { createRequire } from 'node:module';
import type { SIS as SISType } from 'sis-tools';
import { searchToolsSemanticSupabase, isSupabaseSISEnabled } from '../../tools/sis-supabase';
import { get_tool_schema, execute_tool, search_tools, initToolRegistry } from '../../tools/meta-tools';
import { get_skill_info } from '../../tools/skill-tools';
import { hasClientBridge } from '../../tools/bridge';
import { ask_user } from '../../tools/ask-user';
import { getToolRegistry } from '../../tools/tool-registry';

const require = createRequire(import.meta.url);
const { SIS: SISRuntime } = require('sis-tools') as { SIS: new (...args: any[]) => SISType };

const BLOCKED_STUARD_TOOL_NAMES = new Set([
  'custom_ui',
  'update_custom_ui',
  'close_custom_ui',
  'list_custom_ui_windows',
  'send_ui_event',
  'run_ui_script',
]);

function isBlockedStuardToolName(name: string): boolean {
  return BLOCKED_STUARD_TOOL_NAMES.has(String(name || '').trim());
}

function blockedStuardToolError(name: string): string {
  return `Tool '${name}' is not available in Stuard agent mode. Use 'chat_ui' instead.`;
}

function filterBlockedStuardSearchResults<T extends { name?: string }>(tools: T[] | undefined): T[] {
  if (!Array.isArray(tools)) return [];
  return tools.filter((tool) => !isBlockedStuardToolName(String(tool?.name || '')));
}

function stripBlockedStuardTools<T extends Record<string, any>>(tools: T): T {
  const filtered: Record<string, any> = {};
  for (const [name, tool] of Object.entries(tools || {})) {
    if (!isBlockedStuardToolName(name)) filtered[name] = tool;
  }
  return filtered as T;
}

const search_tools_for_stuard = {
  ...(search_tools as any),
  execute: async (inputData: any, runCtx: any) => {
    const result = await (search_tools as any).execute(inputData, runCtx);
    if (!result || !Array.isArray(result.tools)) return result;
    const tools = filterBlockedStuardSearchResults(result.tools);
    return { ...result, tools };
  },
} as any;

const get_tool_schema_for_stuard = {
  ...(get_tool_schema as any),
  execute: async (inputData: any, runCtx: any) => {
    const toolName = String(inputData?.tool_name || '');
    if (isBlockedStuardToolName(toolName)) {
      throw new Error(blockedStuardToolError(toolName));
    }
    return (get_tool_schema as any).execute(inputData, runCtx);
  },
} as any;

const execute_tool_for_stuard = {
  ...(execute_tool as any),
  execute: async (inputData: any, runCtx: any) => {
    const toolName = String(inputData?.tool_name || '');
    if (isBlockedStuardToolName(toolName)) {
      return { success: false, tool: toolName, error: blockedStuardToolError(toolName) };
    }
    return (execute_tool as any).execute(inputData, runCtx);
  },
} as any;

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
  outlook_get_message,
  outlook_list_recent_brief,
  outlook_list_folders,
  outlook_reply_message,
  outlook_forward_message,
  outlook_create_draft,
  outlook_mark_as_read,
  outlook_mark_as_unread,
  outlook_archive_message,
  outlook_move_message,
  outlook_delete_message,
  outlook_download_attachment,
  outlook_retrieve_messages_with_attachments,
  outlook_calendar_list_events,
  outlook_calendar_create_event,
  outlook_calendar_update_event,
  outlook_calendar_delete_event,
  // Google Workspace
  google_get_userinfo,
  google_list_profiles,
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
  gmail_download_attachment,
  gmail_retrieve_messages_with_attachments,
  calendar_list_events,
  calendar_create_event,
  calendar_delete_event,
  calendar_update_event,
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
  run_command,
  http_request,
  run_python_script,
  // Cloud Storage (GCS upload/download with public/private visibility)
  cloud_storage_upload,
  cloud_storage_get_url,
  cloud_storage_list,
  cloud_storage_delete,
  cloud_storage_set_visibility,
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
  proactive_task_list,
  proactive_task_update,
  proactive_task_create,
  proactive_task_delete,
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
  browser_use_execute_script,
  browser_use_navigate,
  browser_use_click,
  browser_use_type,
  browser_use_press_key,
  browser_use_screenshot,
  browser_use_content,
  browser_use_scroll,
  browser_use_tabs,
  browser_use_cookies,
  browser_use_hover,
  browser_use_select_option,
  browser_use_get_dropdown_options,
  browser_use_get_interactive_elements,
  browser_use_fill_form,
  browser_use_upload_file,
  browser_use_wait_for,
  // GitHub tools (require user to have connected GitHub via dashboard)
  github_get_me,
  github_list_repos,
  github_get_repo,
  github_list_issues,
  github_create_issue,
  github_update_issue,
  github_list_issue_comments,
  github_create_issue_comment,
  github_list_pulls,
  github_get_pull,
  github_create_pull,
  github_update_pull,
  github_merge_pull,
  github_list_pull_commits,
  github_list_pull_files,
  github_list_pull_reviews,
  github_create_pull_review,
  github_request_reviewers,
  github_list_branches,
  github_get_branch,
  github_create_branch,
  github_delete_branch,
  github_list_commits,
  github_get_commit,
  github_compare_commits,
  github_get_file_content,
  github_search_code,
  github_search_repos,
  github_list_releases,
  github_create_release,
  github_list_labels,
  github_list_workflow_runs,
  github_get_workflow_run,
  github_rerun_workflow,
  github_dispatch_workflow,
  github_list_gists,
  github_create_gist,
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
  // Meta-tools for lazy-loading (always in Tier 1)
  get_tool_schema: get_tool_schema_for_stuard,
  execute_tool: execute_tool_for_stuard,
  search_tools: search_tools_for_stuard,
  // Skills
  get_skill_info,
  // User interaction
  ask_user,
  text_to_speech,
  list_tts_voices,
  get_tts_models,
  elevenlabs_list_agents,
  elevenlabs_get_signed_conversation_url,
  elevenlabs_get_webrtc_token,
  elevenlabs_list_conversations,
  elevenlabs_get_conversation,
  // Telnyx (SMS / Voice calls — requires verified phone)
  telnyx_send_sms,
  telnyx_call_control,
  telnyx_phone_status,
  telnyx_send_mms,
  telnyx_send_voice_note,
  telnyx_voice_call,
  telnyx_list_voice_providers,
  telnyx_list_active_calls,
  telnyx_hangup_call,
  // WhatsApp (messaging — requires connected WhatsApp number)
  whatsapp_send_message,
  whatsapp_send_media,
  whatsapp_send_reaction,
  whatsapp_mark_read,
  whatsapp_upload_media,
  whatsapp_status,
  whatsapp_get_media_url,
  whatsapp_download_media,
  whatsapp_send_voice_note,
  whatsapp_transcribe_voice_note,
  whatsapp_send_template,
  whatsapp_voice_call,
  whatsapp_make_call,
  // Meta social tools — Facebook
  facebook_get_me,
  facebook_list_pages,
  facebook_list_page_posts,
  facebook_create_page_post,
  facebook_list_post_comments,
  facebook_reply_comment,
  facebook_delete_post,
  facebook_list_conversations,
  facebook_get_conversation_messages,
  facebook_send_message,
  // Meta social tools — Instagram
  instagram_get_me,
  instagram_list_media,
  instagram_publish_media,
  instagram_list_comments,
  instagram_reply_comment,
  instagram_delete_comment,
  instagram_list_conversations,
  instagram_get_conversation_messages,
  instagram_send_dm,
  // Reddit
  reddit_search,
  reddit_view_subreddit,
  reddit_view_comments,
  reddit_create_post,
  reddit_comment,
  // Meta social tools — Threads
  threads_get_me,
  threads_list_posts,
  threads_publish_post,
  threads_get_post,
  threads_list_replies,
  threads_reply_to_post,
} as const;

let _toolUniverseCache: Record<string, any> | null = null;

function getToolUniverse(): Record<string, any> {
  if (_toolUniverseCache) return _toolUniverseCache;

  const merged: Record<string, any> = { ...(ALL_TOOLS as Record<string, any>) };

  try {
    initToolRegistry();
    for (const [name, tool] of getToolRegistry().entries()) {
      if (!merged[name] && tool && typeof (tool as any).execute === 'function') {
        merged[name] = tool;
      }
    }
  } catch { }

  _toolUniverseCache = merged;
  return merged;
}

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

const LEGACY_BROWSER_EXTENSION_TOOL_NAMES = new Set([
  'browser_status',
  'browser_get_content',
  'browser_click_element',
  'browser_type_text',
  'browser_find_text',
  'browser_get_element_position',
  'browser_find_clickable',
  'browser_hover',
  'browser_select_option',
  'browser_press_key',
  'browser_get_form_fields',
  'browser_fill_form',
  'browser_wait_for_element',
  'browser_scroll_to',
  'browser_get_page_info',
  'browser_upload_file',
  'browser_set_toggle',
  'browser_execute_script',
]);

function isLegacyBrowserExtensionTool(name: string): boolean {
  return LEGACY_BROWSER_EXTENSION_TOOL_NAMES.has(name);
}

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

  // System Commands (1) - frequently needed
  'run_command',

  // Web Search (1) - common for research
  'web_search',
] as const;

/**
 * Tier 1 Paramount Tools - ALWAYS loaded natively
 * These get full schemas sent to the LLM. Keep this list small to save tokens.
 * Everything else is listed as names in the system prompt and accessed via
 * get_tool_schema + execute_tool (lazy-loading pattern).
 */
export const TIER_1_PARAMOUNT_TOOLS = [
  // File Operations (6) — most common across all conversations
  'read_file', 'write_file', 'list_directory', 'file_edit', 'grep', 'glob',

  // System Commands (1) — frequently needed
  'run_command',

  // Web (2) — research & scraping
  'web_search', 'scrape_url',

  // Vision (1) — screenshots for computer-use flows
  'capture_screen',

  // Memory (2) — recall past context
  'search_past_conversations', 'get_conversation_context',

  // Task Tracking (1) — multi-step task management
  'agent_todo',

  // Sub-agents (4) — background delegation and task management
  'deploy_headless_agent',
  'get_headless_agent_status',
  'list_headless_agent_tasks',
  'stop_headless_agent',

  // Meta-tools for lazy-loading (3) — discover & run any other tool
  'get_tool_schema', 'execute_tool', 'search_tools',

  // Orchestration (3) — always needed for multi-step flows
  'wait', 'run_sequential', 'run_parallel',

  // Skills (1) — retrieve user-defined skill details
  'get_skill_info',

  // User interaction (1) — ask questions, confirmations, choices
  'ask_user',
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

// These are now in TIER_1_PARAMOUNT_TOOLS — kept as alias for SIS priority boost
const SIS_ESSENTIAL_TOOLS = ['wait', 'run_sequential', 'run_parallel'] as const;

const PROMPT_DIRECT_TOOLS = ['search_local_workflows', 'run_workflow'] as const;
const DESKTOP_UI_DIRECT_TOOLS = ['chat_ui'] as const;

function addDesktopUiTools(target: Record<string, any>, toolUniverse: Record<string, any>): void {
  if (!hasClientBridge()) return;

  for (const name of DESKTOP_UI_DIRECT_TOOLS) {
    if ((toolUniverse as any)[name]) {
      target[name] = (toolUniverse as any)[name];
    }
  }
}

// Semantic injection map is now DB-backed via tool_embeddings.semantic_groups.
// See utils/tool-groups.ts for the runtime loader and cache.

// SIS tools removed — search_tools / execute_tool / get_tool_schema are the single canonical set

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
  for (const [name, tool] of Object.entries(getToolUniverse() as any)) {
    if (isLegacyBrowserExtensionTool(name)) continue;
    if (isBlockedStuardToolName(name)) continue;
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

/**
 * Returns the full set of all registered tools (blocked ones stripped).
 * Used by the Agent constructor so Mastra can execute ANY tool at runtime,
 * while `activeTools` (from getTools/getToolsForQuery) limits what the LLM sees.
 */
export function getExecutionTools(mcpTools: Record<string, any> = {}): Record<string, any> {
  return stripBlockedStuardTools({ ...getToolUniverse(), ...mcpTools });
}

export function getTools(
  enabledIntegrations: string[] = [],
  mcpTools: Record<string, any> = {},
  modelId?: string
): Record<string, any> {
  const toolUniverse = getToolUniverse();
  // Start with MCP tools
  const tools: Record<string, any> = { ...mcpTools };

  // Default: Tier 1 + SIS discovery tools
  // Use SIS_LOAD_ALL=1 to force loading all tools (legacy behavior)
  if (process.env.SIS_LOAD_ALL === '1') {
    Object.assign(tools, toolUniverse);
    return stripBlockedStuardTools(tools);
  }

  // Load Tier 1 tools
  for (const name of TIER_1_PARAMOUNT_TOOLS) {
    if ((toolUniverse as any)[name]) {
      tools[name] = (toolUniverse as any)[name];
    }
  }

  // Always load essential orchestration tools (wait, run_sequential, run_parallel)
  for (const name of SIS_ESSENTIAL_TOOLS) {
    if ((toolUniverse as any)[name]) {
      tools[name] = (toolUniverse as any)[name];
    }
  }

  // Always load prompt direct tools
  for (const name of PROMPT_DIRECT_TOOLS) {
    if ((toolUniverse as any)[name]) {
      tools[name] = (toolUniverse as any)[name];
    }
  }

  // Desktop-only UI tools should be directly callable when a bridge is active.
  addDesktopUiTools(tools, toolUniverse);

  if (process.env.SIS_DEBUG === '1') {
    console.log(`[tools] Lean mode: ${Object.keys(tools).length} tools (Tier1, integrations via system prompt)`);
  }

  return stripBlockedStuardTools(tools);
}

export async function getToolsForQuery(
  query: string,
  enabledIntegrations: string[] = [],
  mcpTools: Record<string, any> = {},
  modelId?: string,
  rankedToolNames?: string[]
): Promise<Record<string, any>> {
  const toolUniverse = getToolUniverse();
  const selected: Record<string, any> = { ...mcpTools };

  // ── Escape hatch: SIS_LOAD_ALL=1 loads everything (legacy) ──
  if (process.env.SIS_LOAD_ALL === '1') {
    Object.assign(selected, toolUniverse);
    return stripBlockedStuardTools(selected);
  }

  // ── 1. Tier 1 paramount tools (always loaded) ──
  for (const name of TIER_1_PARAMOUNT_TOOLS) {
    if ((toolUniverse as any)[name]) {
      selected[name] = (toolUniverse as any)[name];
    }
  }

  // ── 1b. Essential orchestration tools (wait, run_sequential, run_parallel) ──
  for (const name of SIS_ESSENTIAL_TOOLS) {
    if ((toolUniverse as any)[name]) {
      selected[name] = (toolUniverse as any)[name];
    }
  }

  // ── 1c. Prompt direct tools (always loaded) ──
  for (const name of PROMPT_DIRECT_TOOLS) {
    if ((toolUniverse as any)[name]) {
      selected[name] = (toolUniverse as any)[name];
    }
  }

  // ── 2. Semantic group injection (keyword → tools from Supabase) ──
  // Fast keyword matching against DB-stored semantic_groups.
  // e.g. "do this in terminal" → injects terminal_create, terminal_send_input, terminal_read
  // Integration tools (gmail_*, github_*, etc.) are gated by enabledIntegrations.
  addDesktopUiTools(selected, toolUniverse);

  try {
    const injected = await getSemanticInjections(query, enabledIntegrations);
    for (const name of injected) {
      if (isLegacyBrowserExtensionTool(name)) continue;
      if ((toolUniverse as any)[name] && !selected[name]) {
        selected[name] = (toolUniverse as any)[name];
      }
    }
  } catch (e: any) {
    if (process.env.SIS_DEBUG === '1') {
      console.warn('[tools] Semantic injection failed:', e.message);
    }
  }

  // ── 4. Embedding-ranked tools (dynamic, top-N from pgvector) ──
  // These are the tools most likely needed for this specific query,
  // selected by cosine similarity between prompt embedding and tool embeddings.
  // The embedding is memoized and shared with knowledge/memory retrieval.
  if (rankedToolNames && rankedToolNames.length > 0) {
    for (const name of rankedToolNames) {
      if (isLegacyBrowserExtensionTool(name)) continue;
      if ((toolUniverse as any)[name] && !selected[name]) {
        selected[name] = (toolUniverse as any)[name];
      }
    }
  }

  // ── 5. Integration tools are NOT loaded natively to save tokens ──
  // The system prompt tells the model which integrations are connected,
  // and it discovers/executes them via search_tools + get_tool_schema + execute_tool.

  if (process.env.SIS_DEBUG === '1') {
    const rankedCount = rankedToolNames?.length || 0;
    console.log(`[tools] ${Object.keys(selected).length} tools loaded (Tier1=${TIER_1_PARAMOUNT_TOOLS.length} + Ranked=${rankedCount})`);
  }

  return stripBlockedStuardTools(selected);
}
