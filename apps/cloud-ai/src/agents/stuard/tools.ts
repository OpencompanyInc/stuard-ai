import { waitTool } from '../../tools/wait';
import { runSequentialTool, runParallelTool } from '../../tools/workflow-system';
import { analyzeMediaTool } from '../../tools/analyze-media';
import { outlook_get_me, outlook_list_messages, outlook_search_messages, outlook_send_mail } from '../../tools/outlook-tools';
import { github_get_me, github_list_repos, github_list_issues, github_create_issue } from '../../tools/github-tools';
import { google_get_userinfo, gmail_send_message, gmail_list_messages, gmail_get_message_brief, gmail_get_message_full, gmail_get_messages_brief, gmail_list_recent_brief, gmail_get_most_recent_full, gmail_modify_message, gmail_delete_message, gmail_archive_message, gmail_mark_as_read, gmail_mark_as_unread, gmail_download_attachment, calendar_list_events, calendar_create_event, calendar_delete_event, tasks_list, drive_list_files, sheets_read_range, docs_get_document, docs_create_document, docs_write_text } from '../../tools/google-tools';
import { send_hotkey, list_directory, read_file, write_file, create_directory, open_file, move_file, copy_file, delete_file, canvas_list, canvas_read, canvas_write, canvas_create, canvas_delete, capture_media, stop_capture, describe_media_capture_capabilities, capture_screen, stop_screen_capture, describe_screen_capture_capabilities, capture_system_audio, stop_system_audio, describe_system_audio_capabilities, run_command, run_system_command, run_python_script, list_terminals, read_terminal, terminal_create, terminal_list, terminal_get, terminal_read, terminal_send_input, terminal_send_raw, terminal_send_keys, terminal_wait_for, terminal_destroy, list_local_stuards, show_json_workflow_code, execute_workflow, find_workflow_semantic, import_workflow, run_automation, stop_automation, invoke_workflow, search_local_workflows, run_workflow, search_past_conversations, get_conversation_context, list_user_spaces, get_space_contents, add_to_space, ensure_space_path, list_space_path, add_to_space_path, get_space_tree, create_space, add_source_to_space, add_note_to_space, add_code_snippet_to_space, link_conversation_to_space, find_or_create_space, update_space_item, delete_space_item, calendar_crud, task_crud, task_reminders, planner_list_items, list_open_windows, bring_window_to_foreground, smart_bring_window_to_foreground, get_window_info, set_window_bounds, file_index_add_root, file_index_remove_root, file_index_list_roots, file_index_scan, file_index_stats, file_search, file_search_by_filename, file_search_by_kind, file_search_recent, file_search_similar, process_pending_file_index, semantic_file_search, file_read, file_edit, browser_get_content, browser_click_element, browser_type_text, browser_find_text, browser_get_element_position, browser_find_clickable, browser_hover, browser_select_option, browser_press_key, browser_get_form_fields, browser_fill_form, browser_wait_for_element, browser_scroll_to, browser_get_page_info, browser_execute_script, agent_todo, get_mouse_position, computer_use, click_at_coordinates, double_click_at_coordinates, type_text, scroll, drag_and_drop } from '../../tools/device-tools';
import { computer_use_agent } from '../../tools/device-tools';
import { web_search } from '../../tools/perplexity-tools';
import { scrape_url } from '../../tools/tavily-tools';
import { deployHeadlessAgent } from '../../tools/deploy-headless-agent';
import { getHeadlessAgentStatus } from '../../tools/get-headless-agent-status';
import { listHeadlessAgentTasks } from '../../tools/list-headless-agent-tasks';
import { stopHeadlessAgent } from '../../tools/stop-headless-agent';
import { ffmpeg_status, ffmpeg_setup, ffmpeg_run, ffmpeg_convert_media, ffmpeg_extract_audio, ffmpeg_trim_media, ffmpeg_probe_media, ffmpeg_extract_frames } from '../../tools/device-tools';
import { submitFeedback, reportBug, suggestFeature, listMyFeedback, getFeedbackDetails } from '../../tools/feedback-tools';
import { http_request } from '../../tools/http-tools';
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
  // SIS runtime tools (for dynamic tool discovery)
  sis_search_tools: SIS_RUNTIME_TOOLS.sis_search_tools,
  sis_execute_tool: SIS_RUNTIME_TOOLS.sis_execute_tool,
  sis_list_categories: SIS_RUNTIME_TOOLS.sis_list_categories,
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

  // HTTP Requests (1)
  'http_request',

  // Web Extraction (1)
  'scrape_url',

  // Headless Agents (4)
  'deploy_headless_agent', 'get_headless_agent_status',
  'list_headless_agent_tasks', 'stop_headless_agent',

  // Workflows as Tools (4)
  'execute_workflow',
  'find_workflow_semantic',
  'search_local_workflows',
  'run_workflow',

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

  // xAI models have stricter grammar limits - use only Tier 1 tools
  if (isXaiModel(modelId)) {
    for (const name of TIER_1_PARAMOUNT_TOOLS) {
      if ((ALL_TOOLS as any)[name]) {
        tools[name] = (ALL_TOOLS as any)[name];
      }
    }
    if (process.env.SIS_DEBUG === '1') {
      console.log(`[tools] xAI model detected (${modelId}), limited to ${Object.keys(tools).length} Tier 1 tools`);
    }
    return tools;
  }

  // Add ALL registered tools for other providers
  Object.assign(tools, ALL_TOOLS);

  return tools;
}

export async function getToolsForQuery(
  query: string,
  enabledIntegrations: string[] = [],
  mcpTools: Record<string, any> = {},
  modelId?: string,
  rankedToolNames?: string[]
): Promise<Record<string, any>> {
  // Start with MCP tools
  const selected: Record<string, any> = { ...mcpTools };

  // xAI models have stricter grammar limits - use only Tier 1 tools
  if (isXaiModel(modelId)) {
    for (const name of TIER_1_PARAMOUNT_TOOLS) {
      if ((ALL_TOOLS as any)[name]) {
        selected[name] = (ALL_TOOLS as any)[name];
      }
    }
    if (process.env.SIS_DEBUG === '1') {
      console.log(`[tools] xAI model detected (${modelId}), limited to ${Object.keys(selected).length} Tier 1 tools`);
    }
    return selected;
  }

  // =========================================================================
  // SIS_TOOL_PREFILTER mode: Tier 1 + SIS meta + top-N ranked tools
  // Default (off): load ALL registered tools as before
  // =========================================================================
  if (process.env.SIS_TOOL_PREFILTER === '1') {
    // 1. Always load Tier 1 paramount tools
    for (const name of TIER_1_PARAMOUNT_TOOLS) {
      if ((ALL_TOOLS as any)[name]) {
        selected[name] = (ALL_TOOLS as any)[name];
      }
    }

    // 2. Always load SIS meta-tools (for long-tail discovery)
    for (const name of SIS_META_TOOL_NAMES) {
      if ((ALL_TOOLS as any)[name]) {
        selected[name] = (ALL_TOOLS as any)[name];
      }
    }

    // 3. Add top-N ranked tools from embedding-based likelihood ranking
    if (rankedToolNames && rankedToolNames.length > 0) {
      for (const name of rankedToolNames) {
        if ((ALL_TOOLS as any)[name] && !selected[name]) {
          selected[name] = (ALL_TOOLS as any)[name];
        }
      }
    }

    if (process.env.SIS_DEBUG === '1') {
      const tier1Count = TIER_1_PARAMOUNT_TOOLS.length;
      const sisCount = SIS_META_TOOL_NAMES.length;
      const rankedCount = rankedToolNames?.length || 0;
      console.log(`[sis-prefilter] Loaded ${Object.keys(selected).length} tools (Tier1=${tier1Count}, SIS=${sisCount}, Ranked=${rankedCount}, MCP=${Object.keys(mcpTools).length})`);
      if (rankedToolNames && rankedToolNames.length > 0) {
        console.log(`[sis-prefilter] Ranked tools added: ${rankedToolNames.join(', ')}`);
      }
    }

    return selected;
  }

  // =========================================================================
  // Default: Load ALL registered tools (~200+ tools) for non-xAI providers
  // =========================================================================
  Object.assign(selected, ALL_TOOLS);

  if (process.env.SIS_DEBUG === '1') {
    const searchMode = isSupabaseSISEnabled() ? 'semantic (Supabase)' : 'keyword (fallback)';
    console.log(`[sis-runtime] Loaded ${Object.keys(selected).length} tools (Full + MCP)`);
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

  return selected;
}

