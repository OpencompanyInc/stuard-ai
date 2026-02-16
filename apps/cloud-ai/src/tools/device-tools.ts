import { createTool } from '@mastra/core/tools';
import { generateText } from 'ai';
import { z } from 'zod';
import { getBridgeSecrets, execLocalTool } from './bridge';
import { buildProviderModel } from '../utils/models';
import { getDefaultModelForCategory } from '../pricing';

export { computer_use_agent } from './computer-use-agent';

// Cloud-side LLM extraction for memory texts using Gemini 2.5 Flash
export const memory_extract_texts = createTool({
  id: 'memory_extract_texts',
  description: 'Extract the most important, note-worthy information from an array of texts using a fast AI model.',
  inputSchema: z.object({
    items: z.array(z.string()).min(1),
    maxWords: z.number().int().min(10).max(1000).default(120),
  }),
  outputSchema: z.object({ extraction: z.string() }),
  execute: async (inputData, { writer }) => {
    const c = inputData as any;
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
  computer_use,
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
  read_image_optimized,
} from './device/screen';

// Google Cloud Vision OCR (Cloud-side, uses API key)
export { find_text_on_screen, find_and_click_text } from './device/ocr';

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
  browser_upload_file,
  browser_set_toggle,
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
  set_window_bounds,
} from './device/windows';

// Workflows metadata (desktop-side JSON files)
// These tools require a client bridge to the desktop app. If no bridge is available,
// they return an empty list gracefully instead of timing out.
// NOTE: list_local_workflows removed - use search_local_workflows instead
// NOTE: list_local_stuards deprecated - stuards and workflows are now unified
export {
  list_local_stuards,  // Deprecated, kept for backwards compatibility
  show_json_workflow_code,
  execute_workflow,
  find_workflow_semantic,
  import_workflow,
  run_automation,
  stop_automation,
  invoke_workflow,
  test_run_steps,
  search_local_workflows,  // Primary tool for listing/searching workflows
  run_workflow,
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
export { file_read, file_edit, glob, grep } from './agentic-file-tools';

// Clipboard Operations
export { get_clipboard_content, set_clipboard_content } from './device/filesystem';

// Folder Permissions
export {
  folder_permission_add,
  folder_permission_remove,
  folder_permission_list,
  folder_permission_set_enabled,
  folder_permission_check,
} from './device/folder-permissions';

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

export {
  ffmpeg_status,
  ffmpeg_setup,
  ffmpeg_run,
  ffmpeg_convert_media,
  ffmpeg_extract_audio,
  ffmpeg_trim_media,
  ffmpeg_probe_media,
  ffmpeg_extract_frames,
} from './device/ffmpeg';

// ═══════════════════════════════════════════════════════════════════════════════
// MEDIAPIPE — Computer Vision (Pose, Hands, Face, Segmentation)
// ═══════════════════════════════════════════════════════════════════════════════
export {
  mediapipe_status,
  mediapipe_setup,
  mediapipe_pose,
  mediapipe_hands,
  mediapipe_face_detection,
  mediapipe_face_mesh,
  mediapipe_segmentation,
  mediapipe_holistic,
  mediapipe_process_video,
} from './device/mediapipe';

// Canvas Document Tools (AI can read/write user's canvas notes)
export {
  canvas_list,
  canvas_read,
  canvas_write,
  canvas_create,
  canvas_delete,
  // Backward compatibility aliases
  sidebar_canvas_list,
  sidebar_canvas_read,
  sidebar_canvas_write,
  sidebar_canvas_create,
  sidebar_canvas_delete,
} from './device/sidebar-canvas';

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
  ensure_space_path,
  list_space_path,
  add_to_space_path,
  get_space_tree,
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
// AGENT TODO TOOLS
// ═══════════════════════════════════════════════════════════════════════════════
export const agent_todo = createTool({
  id: 'agent_todo',
  description: `Agent's internal todo management for long-running tasks within a session.

Actions:
- list: Get all todos for the session
- create: Create a new todo
- update: Update a todo's status or details
- complete: Mark a todo as completed
- fail: Mark a todo as failed with error
- delete: Remove a todo
- clear: Clear all todos for the session
- get_current: Get the currently in-progress todo
- get_next: Get the next pending todo
- progress: Get progress summary
- bulk_create: Create multiple todos at once
- start: Mark a todo as in_progress
- block: Mark a todo as blocked

Args:
  action: The action to perform
  sessionId: The conversation/thread ID (required)
  data: Action-specific data`,
  inputSchema: z.object({
    action: z.string().describe('The action to perform'),
    sessionId: z.string().describe('The conversation/thread ID'),
    data: z.any().optional().describe('Action-specific data'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    todo: z.any().optional(),
    todos: z.any().optional(),
    items: z.any().optional(),
    count: z.number().optional(),
    progress: z.any().optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData, context) => {
    return await execLocalTool('agent_todo', inputData);
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUB-AGENTS (HEADLESS)
// ═══════════════════════════════════════════════════════════════════════════════
export { deployHeadlessAgent } from './deploy-headless-agent';
export { listHeadlessAgentTasks } from './list-headless-agent-tasks';
export { getHeadlessAgentStatus } from './get-headless-agent-status';

// ═══════════════════════════════════════════════════════════════════════════════
// AI AGENT WORKFLOW NODES — Synchronous agent steps for workflows
// ═══════════════════════════════════════════════════════════════════════════════
export { agent_node, agent_decision, agent_extract } from './device/agent-node';

// ═══════════════════════════════════════════════════════════════════════════════
// MATH & NEURAL NETWORK OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════════
export {
  // Basic arithmetic
  math_add,
  math_subtract,
  math_multiply,
  math_divide,
  math_power,
  math_sqrt,
  math_abs,
  math_negate,
  math_exp,
  math_log,
  // Aggregations
  math_sum,
  math_mean,
  math_max,
  math_min,
  math_argmax,
  math_argmin,
  // Matrix operations
  math_dot,
  math_transpose,
  math_reshape,
  math_shape,
  math_flatten,
  // Tensor creation
  math_zeros,
  math_ones,
  math_random,
  math_range,
  math_linspace,
  // Activation functions
  math_sigmoid,
  math_relu,
  math_leaky_relu,
  math_tanh,
  math_softmax,
  math_gelu,
  math_swish,
  // Neural network layers
  math_linear,
  math_forward_pass,
  math_cross_entropy_loss,
  math_mse_loss,
  // Comparison & logic
  math_compare,
  math_clip,
  math_where,
  // Array operations
  math_concat,
  math_stack,
  math_slice,
  math_get_index,
  math_set_index,
} from './device/math';

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

// ═══════════════════════════════════════════════════════════════════════════════
// DATABASE STORAGE — Local SQLite persistent storage for workflows
// ═══════════════════════════════════════════════════════════════════════════════
export {
  db_query,
  db_store,
  db_retrieve,
  db_search,
  db_delete,
  db_list_tables,
} from './device/database';

// ═══════════════════════════════════════════════════════════════════════════════
// VECTOR EMBEDDINGS — Text embedding and similarity search
// ═══════════════════════════════════════════════════════════════════════════════
export {
  embed_text,
  vector_similarity,
  embed_and_store,
} from './device/embeddings';

// ═══════════════════════════════════════════════════════════════════════════════
// STREAMING — Advanced stream management (user-facing)
// Most streaming is now handled via `stream: true` on tools like agent_node,
// ai_inference, http_request, run_python_script. These advanced tools are for
// manual stream control when needed.
// ═══════════════════════════════════════════════════════════════════════════════
export {
  stream_create,
  stream_close,
  stream_list,
  stream_get_status,
} from './device/streams';

// Engine-internal stream tools (not user-facing, used by engine stream wires)
// Re-exported so the engine/tool-router can still call them internally
export {
  stream_write as _stream_write,
  stream_read as _stream_read,
  stream_subscribe as _stream_subscribe,
  stream_unsubscribe as _stream_unsubscribe,
  stream_add_transform as _stream_add_transform,
  stream_remove_transform as _stream_remove_transform,
  stream_update_transform as _stream_update_transform,
} from './device/streams';
