import { createTool } from '@mastra/core/tools';
import { generateText } from 'ai';
import { z } from 'zod';
import { getBridgeSecrets } from './bridge';
import { buildProviderModel } from '../utils/models';
import { getDefaultModelForCategory } from '../pricing';

// Cloud-side LLM extraction for memory texts using Gemini 2.5 Flash
export const memory_extract_texts = createTool({
  id: 'memory_extract_texts',
  description: 'Extract the most important, note-worthy information from an array of texts using a fast AI model.',
  inputSchema: z.object({
    items: z.array(z.string()).min(1),
    maxWords: z.number().int().min(10).max(1000).default(120),
  }),
  outputSchema: z.object({ extraction: z.string() }),
  execute: async ({ context, writer }) => {
    const c = context as any;
    const secrets = getBridgeSecrets();
    const items = (c.items || []).map((s: any) => String(s)).filter((s: string) => s);
    const maxWords = Number(c.maxWords || 120);
    const joined = items.map((t: string, i: number) => `(${i + 1}) ${t}`).join('\n');
    const prompt = `Extract the most important, note-worthy information from the following texts under ${maxWords} words. Prefer concise bullets or short sentences. Include key facts, tasks, decisions, preferences, names, dates, numbers. Avoid fluff and speculation.\n\nTexts:\n${joined}\n\nExtraction:`;

    const modelId = getDefaultModelForCategory('fast');
    const model = buildProviderModel(modelId);

    await (writer as any)?.write?.({ type: 'tool_event', tool: 'memory_extract_texts', status: 'extracting', model: modelId, count: items.length });
    const res = await generateText({ model: model as any, prompt, temperature: 0.2 });
    const extraction = String((res as any)?.text || '').trim();
    return { extraction };
  },
});

// GUI Interaction & Automation
export {
  get_mouse_position,
  click_at_coordinates,
  double_click_at_coordinates,
  type_text,
  send_hotkey,
  scroll,
  drag_and_drop,
} from './device/gui';

// Screen & Visual Perception
export {
  take_screenshot,
  capture_screen_to_file,
  get_screen_text,
  find_and_click_text,
  read_image_optimized,
} from './device/screen';

// System & Window Management
export {
  launch_application_or_uri,
  run_system_command,
  run_command,
  list_terminals,
  read_terminal,
} from './device/system';

// Browser Interactions (Extension)
export {
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
} from './device/browser';

// Interactive PTY terminal (Electron/node-pty)
export {
  terminal_create,
  terminal_list,
  terminal_get,
  terminal_read,
  terminal_send_input,
  terminal_send_raw,
  terminal_send_keys,
  terminal_wait_for,
  terminal_destroy,
} from './device/terminal';

// Python Runtime Management
export {
  python_status,
  python_setup,
  python_install,
  run_python_script,
  run_node_script,
} from './device/python';

export {
  list_open_windows,
  bring_window_to_foreground,
  get_window_info,
  smart_bring_window_to_foreground,
} from './device/windows';

// Workflows / Stuards metadata (desktop-side JSON files)
// These tools require a client bridge to the desktop app. If no bridge is available,
// they return an empty list gracefully instead of timing out.
export {
  list_local_workflows,
  list_local_stuards,
  show_json_workflow_code,
  import_workflow,
  run_automation,
  stop_automation,
  invoke_workflow,
  test_run_steps,
} from './device/workflows';

// File System Operations
export {
  read_file,
  write_file,
  create_directory,
  list_directory,
  open_file,
  move_file,
  copy_file,
  delete_file,
  checkpoint_create,
  checkpoint_restore,
  checkpoint_list,
} from './device/filesystem';

// Agentic File Tools (for AI agents - Stuard & Workflow Agent)
export { file_read, file_edit } from './agentic-file-tools';

// Clipboard Operations
export { get_clipboard_content, set_clipboard_content } from './device/filesystem';

// Media & Audio Capture (Webcam/Microphone)
export {
  capture_media,
  stop_capture,
  list_active_captures,
  describe_media_capture_capabilities,
  subscribe_media_bus,
  unsubscribe_media_bus,
  get_bus_status,
  list_media_buses,
  start_bus_recording,
  stop_bus_recording,
  stream_speech,
  stop_stream_speech,
} from './device/media';

// Screen Recording & System Audio Capture
export {
  capture_screen,
  stop_screen_capture,
  describe_screen_capture_capabilities,
  capture_system_audio,
  stop_system_audio,
  describe_system_audio_capabilities,
} from './device/screen-capture';

// Canvas / Container Manager
export { canvas_manager } from './device/canvas';

// ============================================================================
// Workflow Variables - Persistent state across workflow runs
// ============================================================================
export {
  set_variable,
  get_variable,
  toggle_variable,
  increment_variable,
  append_to_list,
  list_variables,
  delete_variable,
} from './device/variables';

// Task & Calendar Management
export { calendar_crud, task_crud, task_reminders } from './device/productivity';

// Unified planner helper: aggregate meetings (Google Calendar), local tasks, and local reminders
export { planner_list_items } from './device/productivity';

// Generic local notification helper
export { send_notification } from './device/productivity';

// ═══════════════════════════════════════════════════════════════════════════════
// KNOWLEDGE GRAPH TOOLS
// ═══════════════════════════════════════════════════════════════════════════════
export {
  knowledge_add_instruction,
  knowledge_remember_about_user,
  knowledge_update_profile,
  knowledge_add_project_fact,
  knowledge_get_stats,
} from './device/knowledge';

// ═══════════════════════════════════════════════════════════════════════════════
// CONVERSATION MEMORY TOOLS
// ═══════════════════════════════════════════════════════════════════════════════
export {
  search_past_conversations,
  get_conversation_context,
  list_user_spaces,
  get_space_contents,
  add_to_space,
  create_space,
  get_memory_stats,
  add_source_to_space,
  add_note_to_space,
  add_code_snippet_to_space,
  link_conversation_to_space,
  find_or_create_space,
  update_space_item,
  delete_space_item,
} from './device/memory';

// ═══════════════════════════════════════════════════════════════════════════════
// SUB-AGENTS (HEADLESS)
// ═══════════════════════════════════════════════════════════════════════════════
export { deployHeadlessAgent } from './deploy-headless-agent';
export { listHeadlessAgentTasks } from './list-headless-agent-tasks';
export { getHeadlessAgentStatus } from './get-headless-agent-status';

// ═══════════════════════════════════════════════════════════════════════════════
// FILE INDEX & SEARCH
// ═══════════════════════════════════════════════════════════════════════════════
export {
  file_index_add_root,
  file_index_remove_root,
  file_index_list_roots,
  file_index_scan,
  file_index_get_pending,
  file_index_stats,
  file_index_update,
  file_search,
  file_search_by_filename,
  file_search_by_kind,
  file_search_recent,
  file_search_details,
  file_search_similar,
  process_pending_file_index,
  process_pending_file_index_batch,
  sync_file_index_batch_jobs,
  semantic_file_search,
} from './device/file-index';
