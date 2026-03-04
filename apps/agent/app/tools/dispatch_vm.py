"""
VM-optimized tool dispatch — excludes desktop-only modules that need GUI/display.

This is a slim variant of dispatch.py for headless Linux cloud VMs.
Desktop-only modules (gui, clipboard, windows, screen_capture, media, media_bus,
wakeword, mediapipe_tools) are stubbed out. Everything else is the same.

Environment variable STUARD_AGENT_MODE=vm activates this dispatch.
"""
from __future__ import annotations

import os
from typing import Any, Dict, Callable, Awaitable

# ── VM-compatible modules (no GUI, no display, no hardware capture) ──────────
from . import (
    system, fs, memory, knowledge, canvas, tasks, workflows,
    context, concurrency, transform, loops, memory_conversations,
    file_scanner, file_search, subagents, agent_todo, ffmpeg,
    math_ops, http, streams, database, folder_limiter, utils,
)

# ── Stub out desktop-only modules ───────────────────────────────────────────
# These would fail on a headless VM (no display, no audio devices, no clipboard)

_STUB_RESULT: Dict[str, Any] = {"ok": False, "error": "tool_not_available_on_vm", "reason": "This tool requires the desktop app (GUI/display/hardware)."}

async def _stub_handler(args: Dict[str, Any], *_: Any) -> Dict[str, Any]:
    return _STUB_RESULT


_TOOL_METADATA: Dict[str, tuple[str, str]] = {
    # ── System (VM-compatible subset) ────────────────────────────────────────
    "run_system_command": ("system", "Execute system commands with shell"),
    "run_command": ("system", "Run shell commands cross-platform with timeout"),
    "list_terminals": ("system", "List active terminal sessions"),
    "read_terminal": ("system", "Read incremental terminal output"),
    "get_local_time": ("system", "Get the current local time"),
    "python_status": ("system", "Check Python environment status"),
    "python_setup": ("system", "Setup a Python environment"),
    "python_install": ("system", "Install Python packages in an environment"),
    "run_python_script": ("system", "Run Python code inline or from file"),
    "run_node_script": ("system", "Run Node.js code inline or from file"),

    # ── Filesystem ───────────────────────────────────────────────────────────
    "list_directory": ("system", "List directory contents"),
    "read_file": ("system", "Read text file contents"),
    "write_file": ("system", "Write text content to a file"),
    "create_directory": ("system", "Create a directory on disk"),
    "move_file": ("system", "Move or rename files and directories"),
    "copy_file": ("system", "Copy a file to a new location"),
    "delete_file": ("system", "Delete a file or directory"),
    "read_file_binary": ("system", "Read binary file contents"),
    "read_file_base64": ("system", "Read file as base64 encoded string"),
    "write_file_base64": ("system", "Write base64 encoded string to a file"),
    "file_read": ("system", "Read file contents with line numbers for AI agents"),
    "file_edit": ("system", "Edit file contents using string-based matching"),
    "glob": ("system", "Find files and folders using a glob pattern"),
    "grep": ("system", "Search text in files (regex or literal)"),
    "checkpoint_create": ("system", "Create a checkpoint of files for rollback"),
    "checkpoint_restore": ("system", "Restore files from a checkpoint"),
    "checkpoint_list": ("system", "List available checkpoints"),

    # ── Utilities ────────────────────────────────────────────────────────────
    "get_datetime": ("utils", "Get current date and time with formatting"),
    "math_eval": ("utils", "Evaluate a safe math expression"),
    "generate_uuid": ("utils", "Generate UUID(s)"),
    "random_number": ("utils", "Generate random number(s)"),
    "random_choice": ("utils", "Pick random item(s) from a list"),
    "get_env_var": ("utils", "Get environment variable value"),
    "get_system_info": ("utils", "Get basic system information"),
    "hash_string": ("utils", "Hash a string using various algorithms"),
    "base64_encode": ("utils", "Encode text to base64"),
    "base64_decode": ("utils", "Decode base64 to text"),
    "json_parse": ("utils", "Parse a JSON string"),
    "json_stringify": ("utils", "Convert data to JSON string"),
    "sleep": ("utils", "Sleep/wait for a duration"),
    "regex_match": ("utils", "Match regex pattern against text"),
    "regex_replace": ("utils", "Replace text using regex"),

    # ── Memory / Knowledge ───────────────────────────────────────────────────
    "memory_retrieval": ("memory", "Retrieve memories by query"),
    "group_management": ("memory", "Manage memory groups"),
    "context_manager": ("memory", "Manage conversation context"),
    "knowledge_upsert_core": ("knowledge", "Update core profile knowledge"),
    "knowledge_add_fact": ("knowledge", "Add a fact to the knowledge graph"),
    "knowledge_upsert_procedural": ("knowledge", "Add procedural knowledge"),
    "knowledge_create_entity": ("knowledge", "Create an entity in the knowledge graph"),
    "knowledge_find_entity": ("knowledge", "Find an entity by name"),
    "knowledge_list_entities": ("knowledge", "List all entities"),
    "knowledge_get_entity_context": ("knowledge", "Get context for an entity"),
    "knowledge_get_identity": ("knowledge", "Get user identity information"),
    "knowledge_get_directives": ("knowledge", "Get system directives"),
    "knowledge_get_bio": ("knowledge", "Get user biography information"),
    "knowledge_search_facts": ("knowledge", "Search facts in knowledge graph"),
    "knowledge_stats": ("knowledge", "Get knowledge graph statistics"),
    "knowledge_delete_fact": ("knowledge", "Delete a fact"),
    "knowledge_invalidate_fact": ("knowledge", "Invalidate a fact"),
    "knowledge_delete_entity": ("knowledge", "Delete an entity"),
    "knowledge_update_entity": ("knowledge", "Update an entity"),
    "knowledge_build_context": ("knowledge", "Build context from knowledge graph"),
    "knowledge_get_procedural": ("knowledge", "Get procedural knowledge"),
    "knowledge_get_events": ("knowledge", "Get event history"),
    "knowledge_get_graph": ("knowledge", "Get knowledge graph visualization data"),
    "pending_memory_create": ("memory", "Create a pending memory for confirmation"),
    "pending_memory_list": ("memory", "List pending memories"),
    "pending_memory_get": ("memory", "Get a pending memory"),
    "pending_memory_confirm": ("memory", "Confirm a pending memory"),
    "pending_memory_reject": ("memory", "Reject a pending memory"),
    "pending_memory_delete": ("memory", "Delete a pending memory"),

    # ── Conversations & Spaces ───────────────────────────────────────────────
    "conversation_create": ("memory", "Create a new conversation"),
    "conversation_get": ("memory", "Get a conversation"),
    "conversation_list": ("memory", "List conversations"),
    "conversation_update": ("memory", "Update a conversation"),
    "conversation_search": ("memory", "Search conversations"),
    "message_add": ("memory", "Add a message to a conversation"),
    "message_list": ("memory", "List messages in a conversation"),
    "segment_create": ("memory", "Create a conversation segment"),
    "segment_update": ("memory", "Update a conversation segment"),
    "segment_list": ("memory", "List conversation segments"),
    "segment_list_recent": ("memory", "List recent segments"),
    "segment_search": ("memory", "Search segments"),
    "segment_build_topic_drawers": ("memory", "Build topic drawers"),
    "space_create": ("data", "Create a new space"),
    "space_get": ("data", "Get a space"),
    "space_list": ("data", "List spaces"),
    "space_update": ("data", "Update a space"),
    "space_delete": ("data", "Delete a space"),
    "space_item_add": ("data", "Add an item to a space"),
    "space_item_list": ("data", "List items in a space"),
    "space_item_get": ("data", "Get a space item"),
    "space_item_update": ("data", "Update a space item"),
    "space_item_delete": ("data", "Delete a space item"),
    "space_item_move": ("data", "Move a space item"),
    "space_folder_create": ("data", "Create a folder in a space"),
    "space_get_tree": ("data", "Get space folder tree"),
    "space_share": ("data", "Share a space"),
    "space_unshare": ("data", "Unshare a space"),
    "space_share_info": ("data", "Get space sharing info"),
    "space_link_conversation": ("data", "Link a conversation to a space"),
    "space_unlink_conversation": ("data", "Unlink a conversation from a space"),
    "space_get_conversations": ("data", "Get conversations linked to a space"),
    "conversation_get_spaces": ("data", "Get spaces linked to a conversation"),
    "security_get_settings": ("system", "Get security settings"),
    "security_set_password": ("system", "Set security password"),
    "security_verify_password": ("system", "Verify security password"),
    "security_update_settings": ("system", "Update security settings"),
    "security_remove_password": ("system", "Remove security password"),
    "memory_stats": ("memory", "Get memory statistics"),

    # ── Canvas ───────────────────────────────────────────────────────────────
    "canvas_list": ("ui", "List canvas documents"),
    "canvas_read": ("ui", "Read a canvas document"),
    "canvas_write": ("ui", "Write to a canvas document"),
    "canvas_create": ("ui", "Create a canvas document"),
    "canvas_delete": ("ui", "Delete a canvas document"),

    # ── Tasks / Reminders ────────────────────────────────────────────────────
    "calendar_crud": ("integrations", "Manage calendar events"),
    "task_crud": ("integrations", "Manage tasks"),
    "task_reminders": ("integrations", "Manage task reminders"),
    "unified_task_assignments": ("integrations", "Manage user task assignments"),

    # ── Agent / Flow ─────────────────────────────────────────────────────────
    "agent_todo": ("core", "Manage agent's internal todo list"),
    "parallel_executor": ("flow", "Execute tools in parallel"),
    "transform_data": ("flow", "Transform data between steps"),
    "loop_executor": ("flow", "Execute tools in a loop"),
    "list_local_workflows": ("flow", "List local workflow files"),
    "list_local_stuards": ("flow", "List local Stuard automations"),
    "import_workflow": ("flow", "Import a workflow from JSON"),
    "export_workflow": ("flow", "Export a workflow to JSON"),
    "validate_workflow_requirements": ("flow", "Validate workflow requirements"),

    # ── File Index & Search ──────────────────────────────────────────────────
    "file_index_add_root": ("data", "Add a root directory to file index"),
    "file_index_remove_root": ("data", "Remove a root from file index"),
    "file_index_list_roots": ("data", "List file index roots"),
    "file_index_scan": ("data", "Scan a file index root"),
    "file_index_get_pending": ("data", "Get pending files for indexing"),
    "file_index_stats": ("data", "Get file index statistics"),
    "file_index_update": ("data", "Update file index data"),
    "file_index_mark_error": ("data", "Mark a file index error"),
    "file_index_purge_deleted": ("data", "Purge deleted files from index"),
    "file_search": ("data", "Search files semantically"),
    "file_search_by_filename": ("data", "Search files by filename"),
    "file_search_by_extension": ("data", "Search files by extension"),
    "file_search_by_kind": ("data", "Search files by kind"),
    "file_search_recent": ("data", "Get recently indexed files"),
    "file_search_details": ("data", "Get file details"),
    "file_search_folder": ("data", "Get folder contents"),
    "file_search_similar": ("data", "Find similar files"),

    # ── Sub-agents ───────────────────────────────────────────────────────────
    "subagent_spawn": ("core", "Spawn a sub-agent"),
    "subagent_status": ("core", "Get sub-agent status"),
    "subagent_list": ("core", "List sub-agents"),
    "subagent_update": ("core", "Update sub-agent"),

    # ── Math ─────────────────────────────────────────────────────────────────
    "math_add": ("math", "Add two values/tensors"),
    "math_subtract": ("math", "Subtract b from a"),
    "math_multiply": ("math", "Multiply two values/tensors"),
    "math_divide": ("math", "Divide a by b"),
    "math_power": ("math", "Raise a to power b"),
    "math_sqrt": ("math", "Square root"),
    "math_abs": ("math", "Absolute value"),
    "math_negate": ("math", "Negate values"),
    "math_exp": ("math", "Exponential"),
    "math_log": ("math", "Natural logarithm"),
    "math_sum": ("math", "Sum elements"),
    "math_mean": ("math", "Mean of elements"),
    "math_max": ("math", "Maximum value"),
    "math_min": ("math", "Minimum value"),
    "math_argmax": ("math", "Index of max"),
    "math_argmin": ("math", "Index of min"),
    "math_dot": ("math", "Dot product / matmul"),
    "math_transpose": ("math", "Transpose matrix"),
    "math_reshape": ("math", "Reshape tensor"),
    "math_shape": ("math", "Get tensor shape"),
    "math_flatten": ("math", "Flatten tensor"),
    "math_zeros": ("math", "Tensor of zeros"),
    "math_ones": ("math", "Tensor of ones"),
    "math_random": ("math", "Tensor of randoms"),
    "math_range": ("math", "Range of values"),
    "math_linspace": ("math", "Linearly spaced values"),
    "math_sigmoid": ("math", "Sigmoid activation"),
    "math_relu": ("math", "ReLU activation"),
    "math_leaky_relu": ("math", "Leaky ReLU activation"),
    "math_tanh": ("math", "Tanh activation"),
    "math_softmax": ("math", "Softmax activation"),
    "math_gelu": ("math", "GELU activation"),
    "math_swish": ("math", "Swish activation"),
    "math_linear": ("math", "Linear layer y = Wx + b"),
    "math_forward_pass": ("math", "Run forward pass through NN"),
    "math_cross_entropy_loss": ("math", "Cross-entropy loss"),
    "math_mse_loss": ("math", "MSE loss"),
    "math_compare": ("math", "Compare two values"),
    "math_clip": ("math", "Clip values to range"),
    "math_where": ("math", "Conditional selection"),
    "math_concat": ("math", "Concatenate arrays"),
    "math_stack": ("math", "Stack arrays"),
    "math_slice": ("math", "Slice tensor"),
    "math_get_index": ("math", "Get element"),
    "math_set_index": ("math", "Set element"),

    # ── Folder Permissions ───────────────────────────────────────────────────
    "folder_permission_add": ("system", "Add folder permission"),
    "folder_permission_remove": ("system", "Remove folder permission"),
    "folder_permission_list": ("system", "List folder permissions"),
    "folder_permission_set_enabled": ("system", "Enable/disable folder limiter"),
    "folder_permission_check": ("system", "Check path permission"),

    # ── Database ─────────────────────────────────────────────────────────────
    "db_query": ("data", "Execute SQL against local database"),
    "db_store": ("data", "Store JSON document"),
    "db_retrieve": ("data", "Retrieve document by ID"),
    "db_search": ("data", "Search documents"),
    "db_delete": ("data", "Delete document by ID"),
    "db_list_tables": ("data", "List tables/collections"),

    # ── HTTP ─────────────────────────────────────────────────────────────────
    "http_request": ("integrations", "Make HTTP requests"),

    # ── Streaming ────────────────────────────────────────────────────────────
    "stream_create": ("streaming", "Create a named data stream"),
    "stream_write": ("streaming", "Push data to a stream"),
    "stream_read": ("streaming", "Read from a stream"),
    "stream_close": ("streaming", "Close a stream"),
    "stream_subscribe": ("streaming", "Subscribe to a stream"),
    "stream_unsubscribe": ("streaming", "Unsubscribe from a stream"),
    "stream_add_transform": ("streaming", "Add transform to stream"),
    "stream_remove_transform": ("streaming", "Remove transform from stream"),
    "stream_update_transform": ("streaming", "Update transform parameters"),
    "stream_list": ("streaming", "List active streams"),
    "close_all_streams": ("streaming", "Close all active streams"),
    "stream_get_status": ("streaming", "Get stream stats"),
    "stream_from_script": ("streaming", "Stream from Python script"),
    "stream_from_api": ("streaming", "Stream from API"),
    "stream_from_llm": ("streaming", "Stream from LLM"),

    # ── FFmpeg (available if binary is auto-downloaded) ──────────────────────
    "ffmpeg_status": ("vision", "Check FFmpeg availability"),
    "ffmpeg_setup": ("vision", "Setup FFmpeg"),
    "ffmpeg_run": ("vision", "Run FFmpeg command"),
    "ffmpeg_convert_media": ("vision", "Convert media formats"),
    "ffmpeg_extract_audio": ("vision", "Extract audio"),
    "ffmpeg_trim_media": ("vision", "Trim media"),
    "ffmpeg_probe_media": ("vision", "Probe media metadata"),
    "ffmpeg_extract_frames": ("vision", "Extract video frames"),
}

# ── Desktop-only tools (stubbed) ────────────────────────────────────────────
_DESKTOP_ONLY_STUBS = [
    # GUI tools
    "get_mouse_position", "move_cursor", "computer_use", "click_at_coordinates",
    "double_click_at_coordinates", "type_text", "send_hotkey", "scroll",
    "drag_and_drop", "take_screenshot", "capture_screen_to_file", "prepare_image_for_model",
    # Window management
    "get_foreground_window", "list_open_windows", "bring_window_to_foreground",
    # Clipboard
    "get_clipboard_content", "set_clipboard_content",
    # Media capture (needs hardware)
    "capture_media", "stop_capture", "stop_captures_by_flow", "list_active_captures",
    "describe_media_capture_capabilities", "upload_file_to_url",
    # Media bus
    "subscribe_media_bus", "unsubscribe_media_bus", "get_bus_status",
    "list_media_buses", "start_bus_recording", "stop_bus_recording", "get_bus_frames",
    # Screen recording
    "capture_screen", "stop_screen_capture", "describe_screen_capture_capabilities",
    "capture_system_audio", "stop_system_audio", "describe_system_audio_capabilities",
    # MediaPipe (needs opencv + display for some)
    "mediapipe_status", "mediapipe_setup", "mediapipe_pose", "mediapipe_hands",
    "mediapipe_face_detection", "mediapipe_face_mesh", "mediapipe_segmentation",
    "mediapipe_holistic", "mediapipe_process_video",
    # Wakeword (needs mic)
    "wakeword_start", "wakeword_stop", "wakeword_status",
    # Desktop-only workflow tools
    "run_automation", "stuards_run", "stop_automation", "stuards_stop",
    "invoke_workflow", "test_run_steps", "stuards_import_workflow",
    "show_json_workflow_code",
    # Desktop notifications
    "send_notification",
    # Desktop file open
    "open_file",
]


# ── Build handler map ────────────────────────────────────────────────────────

_HANDLERS: Dict[str, Callable[..., Any]] = {}

# Register VM-compatible handlers
_HANDLERS.update({
    # System
    "run_system_command": system.run_system_command,
    "run_command": system.run_command,
    "list_terminals": system.list_terminals,
    "read_terminal": system.read_terminal,
    "get_local_time": system.get_local_time,
    "python_status": system.python_status,
    "python_setup": system.python_setup,
    "python_install": system.python_install,
    "run_python_script": system.run_python_script,
    "run_node_script": system.run_node_script,

    # Filesystem
    "list_directory": fs.list_directory,
    "read_file": fs.read_file,
    "write_file": fs.write_file,
    "create_directory": fs.create_directory,
    "move_file": fs.move_file,
    "copy_file": fs.copy_file,
    "delete_file": fs.delete_file,
    "read_file_binary": fs.read_file_binary,
    "write_file_base64": fs.write_file_base64,
    "read_file_base64": fs.read_file_binary,
    "file_read": fs.file_read,
    "file_edit": fs.file_edit,
    "glob": fs.glob_paths,
    "grep": fs.grep,
    "checkpoint_create": fs.checkpoint_create,
    "checkpoint_restore": fs.checkpoint_restore,
    "checkpoint_list": fs.checkpoint_list,

    # Utilities
    "get_datetime": utils.get_datetime,
    "math_eval": utils.math_eval,
    "generate_uuid": utils.generate_uuid,
    "random_number": utils.random_number,
    "random_choice": utils.random_choice,
    "get_env_var": utils.get_env_var,
    "get_system_info": utils.get_system_info,
    "hash_string": utils.hash_string,
    "base64_encode": utils.base64_encode,
    "base64_decode": utils.base64_decode,
    "json_parse": utils.json_parse,
    "json_stringify": utils.json_stringify,
    "sleep": utils.sleep,
    "regex_match": utils.regex_match,
    "regex_replace": utils.regex_replace,

    # Memory / Knowledge
    "memory_retrieval": memory.memory_retrieval,
    "group_management": memory.group_management,
    "context_manager": context.context_manager,
    "knowledge_upsert_core": knowledge.knowledge_upsert_core,
    "knowledge_add_fact": knowledge.knowledge_add_fact,
    "knowledge_upsert_procedural": knowledge.knowledge_upsert_procedural,
    "knowledge_create_entity": knowledge.knowledge_create_entity,
    "knowledge_find_entity": knowledge.knowledge_find_entity,
    "knowledge_list_entities": knowledge.knowledge_list_entities,
    "knowledge_get_entity_context": knowledge.knowledge_get_entity_context,
    "knowledge_get_identity": knowledge.knowledge_get_identity,
    "knowledge_get_directives": knowledge.knowledge_get_directives,
    "knowledge_get_bio": knowledge.knowledge_get_bio,
    "knowledge_search_facts": knowledge.knowledge_search_facts,
    "knowledge_stats": knowledge.knowledge_stats,
    "knowledge_delete_fact": knowledge.knowledge_delete_fact,
    "knowledge_invalidate_fact": knowledge.knowledge_invalidate_fact,
    "knowledge_delete_entity": knowledge.knowledge_delete_entity,
    "knowledge_update_entity": knowledge.knowledge_update_entity,
    "knowledge_build_context": knowledge.knowledge_build_context,
    "knowledge_get_procedural": knowledge.knowledge_get_procedural,
    "knowledge_get_events": knowledge.knowledge_get_events,
    "knowledge_get_graph": knowledge.knowledge_get_graph,
    "pending_memory_create": knowledge.pending_memory_create,
    "pending_memory_list": knowledge.pending_memory_list,
    "pending_memory_get": knowledge.pending_memory_get,
    "pending_memory_confirm": knowledge.pending_memory_confirm,
    "pending_memory_reject": knowledge.pending_memory_reject,
    "pending_memory_delete": knowledge.pending_memory_delete,

    # Conversations & Spaces
    "conversation_create": memory_conversations.conversation_create,
    "conversation_get": memory_conversations.conversation_get,
    "conversation_list": memory_conversations.conversation_list,
    "conversation_update": memory_conversations.conversation_update,
    "conversation_search": memory_conversations.conversation_search,
    "message_add": memory_conversations.message_add,
    "message_list": memory_conversations.message_list,
    "segment_create": memory_conversations.segment_create,
    "segment_update": memory_conversations.segment_update,
    "segment_list": memory_conversations.segment_list,
    "segment_list_recent": memory_conversations.segment_list_recent,
    "segment_search": memory_conversations.segment_search,
    "segment_build_topic_drawers": memory_conversations.segment_build_topic_drawers,
    "space_create": memory_conversations.space_create,
    "space_get": memory_conversations.space_get,
    "space_list": memory_conversations.space_list,
    "space_update": memory_conversations.space_update,
    "space_delete": memory_conversations.space_delete,
    "space_item_add": memory_conversations.space_item_add,
    "space_item_list": memory_conversations.space_item_list,
    "space_item_get": memory_conversations.space_item_get,
    "space_item_update": memory_conversations.space_item_update,
    "space_item_delete": memory_conversations.space_item_delete,
    "space_item_move": memory_conversations.space_item_move,
    "space_folder_create": memory_conversations.space_folder_create,
    "space_get_tree": memory_conversations.space_get_tree,
    "space_share": memory_conversations.space_share,
    "space_unshare": memory_conversations.space_unshare,
    "space_share_info": memory_conversations.space_share_info,
    "space_link_conversation": memory_conversations.space_link_conversation,
    "space_unlink_conversation": memory_conversations.space_unlink_conversation,
    "space_get_conversations": memory_conversations.space_get_conversations,
    "conversation_get_spaces": memory_conversations.conversation_get_spaces,
    "security_get_settings": memory_conversations.security_get_settings,
    "security_set_password": memory_conversations.security_set_password,
    "security_verify_password": memory_conversations.security_verify_password,
    "security_update_settings": memory_conversations.security_update_settings,
    "security_remove_password": memory_conversations.security_remove_password,
    "memory_stats": memory_conversations.memory_stats,

    # Canvas (in-memory doc store — works on VM)
    "canvas_list": canvas.canvas_list,
    "canvas_read": canvas.canvas_read,
    "canvas_write": canvas.canvas_write,
    "canvas_create": canvas.canvas_create,
    "canvas_delete": canvas.canvas_delete,

    # Tasks & Reminders
    "calendar_crud": tasks.calendar_crud,
    "task_crud": tasks.task_crud,
    "task_reminders": tasks.task_reminders,
    "unified_task_assignments": tasks.unified_task_assignments,

    # Agent & Flow
    "agent_todo": agent_todo.agent_todo,
    "parallel_executor": concurrency.parallel_executor,
    "transform_data": transform.transform_data,
    "loop_executor": loops.loop_executor,
    "list_local_workflows": workflows.list_local_workflows,
    "list_local_stuards": workflows.list_local_stuards,
    "import_workflow": workflows.import_workflow,
    "export_workflow": workflows.export_workflow,
    "validate_workflow_requirements": workflows.validate_workflow_requirements,

    # File Index & Search
    "file_index_add_root": file_scanner.add_index_root,
    "file_index_remove_root": file_scanner.remove_index_root,
    "file_index_list_roots": file_scanner.list_index_roots,
    "file_index_scan": file_scanner.scan_index_root,
    "file_index_get_pending": file_scanner.get_pending_files,
    "file_index_stats": file_scanner.get_index_stats,
    "file_index_update": file_scanner.update_file_index_data,
    "file_index_mark_error": file_scanner.mark_file_error,
    "file_index_purge_deleted": file_scanner.purge_deleted,
    "file_search": file_search.search_files,
    "file_search_by_filename": file_search.search_by_filename,
    "file_search_by_extension": file_search.search_by_extension,
    "file_search_by_kind": file_search.search_by_kind,
    "file_search_recent": file_search.get_recent_files,
    "file_search_details": file_search.get_file_details,
    "file_search_folder": file_search.get_folder_contents,
    "file_search_similar": file_search.find_similar_files,

    # Sub-agents
    "subagent_spawn": subagents.subagent_spawn,
    "subagent_status": subagents.subagent_status,
    "subagent_list": subagents.subagent_list,
    "subagent_update": subagents.subagent_update,

    # Math
    "math_add": math_ops.math_add,
    "math_subtract": math_ops.math_subtract,
    "math_multiply": math_ops.math_multiply,
    "math_divide": math_ops.math_divide,
    "math_power": math_ops.math_power,
    "math_sqrt": math_ops.math_sqrt,
    "math_abs": math_ops.math_abs,
    "math_negate": math_ops.math_negate,
    "math_exp": math_ops.math_exp,
    "math_log": math_ops.math_log,
    "math_sum": math_ops.math_sum,
    "math_mean": math_ops.math_mean,
    "math_max": math_ops.math_max,
    "math_min": math_ops.math_min,
    "math_argmax": math_ops.math_argmax,
    "math_argmin": math_ops.math_argmin,
    "math_dot": math_ops.math_dot,
    "math_transpose": math_ops.math_transpose,
    "math_reshape": math_ops.math_reshape,
    "math_shape": math_ops.math_shape,
    "math_flatten": math_ops.math_flatten,
    "math_zeros": math_ops.math_zeros,
    "math_ones": math_ops.math_ones,
    "math_random": math_ops.math_random,
    "math_range": math_ops.math_range,
    "math_linspace": math_ops.math_linspace,
    "math_sigmoid": math_ops.math_sigmoid,
    "math_relu": math_ops.math_relu,
    "math_leaky_relu": math_ops.math_leaky_relu,
    "math_tanh": math_ops.math_tanh,
    "math_softmax": math_ops.math_softmax,
    "math_gelu": math_ops.math_gelu,
    "math_swish": math_ops.math_swish,
    "math_linear": math_ops.math_linear,
    "math_forward_pass": math_ops.math_forward_pass,
    "math_cross_entropy_loss": math_ops.math_cross_entropy_loss,
    "math_mse_loss": math_ops.math_mse_loss,
    "math_compare": math_ops.math_compare,
    "math_clip": math_ops.math_clip,
    "math_where": math_ops.math_where,
    "math_concat": math_ops.math_concat,
    "math_stack": math_ops.math_stack,
    "math_slice": math_ops.math_slice,
    "math_get_index": math_ops.math_get_index,
    "math_set_index": math_ops.math_set_index,

    # Folder Permissions
    "folder_permission_add": folder_limiter.folder_permission_add,
    "folder_permission_remove": folder_limiter.folder_permission_remove,
    "folder_permission_list": folder_limiter.folder_permission_list,
    "folder_permission_set_enabled": folder_limiter.folder_permission_set_enabled,
    "folder_permission_check": folder_limiter.folder_permission_check,

    # Database
    "db_query": database.db_query,
    "db_store": database.db_store,
    "db_retrieve": database.db_retrieve,
    "db_search": database.db_search,
    "db_delete": database.db_delete,
    "db_list_tables": database.db_list_tables,

    # HTTP
    "http_request": http.http_request,

    # Streaming
    "stream_create": streams.stream_create,
    "stream_write": streams.stream_write,
    "stream_read": streams.stream_read,
    "stream_close": streams.stream_close,
    "stream_subscribe": streams.stream_subscribe,
    "stream_unsubscribe": streams.stream_unsubscribe,
    "stream_add_transform": streams.stream_add_transform,
    "stream_remove_transform": streams.stream_remove_transform,
    "stream_update_transform": streams.stream_update_transform,
    "stream_list": streams.stream_list,
    "close_all_streams": streams.close_all_streams,
    "stream_get_status": streams.stream_get_status,
    "stream_from_script": streams.stream_from_script,
    "stream_from_api": streams.stream_from_api,
    "stream_from_llm": streams.stream_from_llm,

    # FFmpeg
    "ffmpeg_status": ffmpeg.ffmpeg_status,
    "ffmpeg_setup": ffmpeg.ffmpeg_setup,
    "ffmpeg_run": ffmpeg.ffmpeg_run,
    "ffmpeg_convert_media": ffmpeg.ffmpeg_convert_media,
    "ffmpeg_extract_audio": ffmpeg.ffmpeg_extract_audio,
    "ffmpeg_trim_media": ffmpeg.ffmpeg_trim_media,
    "ffmpeg_probe_media": ffmpeg.ffmpeg_probe_media,
    "ffmpeg_extract_frames": ffmpeg.ffmpeg_extract_frames,
})

# Register desktop-only stubs
for _tool_name in _DESKTOP_ONLY_STUBS:
    _HANDLERS[_tool_name] = _stub_handler
    if _tool_name not in _TOOL_METADATA:
        _TOOL_METADATA[_tool_name] = ("desktop_only", f"{_tool_name} (not available on VM)")


# ── Tool discovery handlers ──────────────────────────────────────────────────

async def _list_tools_handler(args: Dict[str, Any]) -> Dict[str, Any]:
    category = args.get("category")
    return list_tools(category)

async def _get_tool_info_handler(args: Dict[str, Any]) -> Dict[str, Any]:
    tool_name = args.get("name") or args.get("tool_name") or ""
    return get_tool_info(tool_name)

async def _list_tool_categories_handler(args: Dict[str, Any]) -> Dict[str, Any]:
    return get_all_categories()

_HANDLERS["list_tools"] = _list_tools_handler
_HANDLERS["get_tool_info"] = _get_tool_info_handler
_HANDLERS["list_tool_categories"] = _list_tool_categories_handler
_TOOL_METADATA["list_tools"] = ("core", "List all available tools")
_TOOL_METADATA["get_tool_info"] = ("core", "Get tool information")
_TOOL_METADATA["list_tool_categories"] = ("core", "List tool categories")


# ── Execute ──────────────────────────────────────────────────────────────────

# Tools that accept an emit callback for progress events (same list as desktop dispatch)
_EMIT_TOOLS = {
    "run_system_command", "run_command",
    "python_install", "run_python_script", "run_node_script",
    "canvas_list", "canvas_read", "canvas_write", "canvas_create", "canvas_delete",
    "task_reminders",
    "ffmpeg_setup", "ffmpeg_run", "ffmpeg_convert_media", "ffmpeg_extract_audio",
    "ffmpeg_trim_media", "ffmpeg_probe_media", "ffmpeg_extract_frames",
    "stream_create", "stream_write", "stream_read", "stream_close",
    "stream_subscribe", "stream_unsubscribe", "stream_add_transform",
    "stream_remove_transform", "stream_update_transform", "stream_list",
    "stream_get_status", "stream_from_script", "stream_from_api", "stream_from_llm",
    "agent_todo", "show_json_workflow_code",
}


async def execute(tool: str, args: Dict[str, Any], emit: Callable[[str, Dict[str, Any] | None], Awaitable[None]] | None = None) -> Dict[str, Any]:
    handler = _HANDLERS.get(tool)
    if handler is None:
        return {"ok": False, "error": "unknown_tool"}

    if tool in _EMIT_TOOLS and emit is not None:
        return await handler(args, emit)
    else:
        return await handler(args)


def list_tools(category: str | None = None) -> Dict[str, Any]:
    tools = []
    for name in _HANDLERS.keys():
        meta = _TOOL_METADATA.get(name, ("other", name.replace("_", " ").title()))
        tool_category, description = meta
        if category and tool_category != category:
            continue
        # Mark desktop-only stubs
        kind = "stub" if name in _DESKTOP_ONLY_STUBS else "local"
        tools.append({"name": name, "category": tool_category, "description": description, "kind": kind})
    tools.sort(key=lambda t: (t["category"], t["name"]))
    return {"ok": True, "count": len(tools), "tools": tools, "mode": "vm"}


def get_tool_info(tool_name: str) -> Dict[str, Any]:
    if tool_name not in _HANDLERS:
        return {"ok": False, "error": f"Tool '{tool_name}' not found"}
    meta = _TOOL_METADATA.get(tool_name, ("other", tool_name.replace("_", " ").title()))
    category, description = meta
    return {"ok": True, "name": tool_name, "category": category, "description": description,
            "kind": "stub" if tool_name in _DESKTOP_ONLY_STUBS else "local", "available": tool_name not in _DESKTOP_ONLY_STUBS}


def get_all_categories() -> Dict[str, Any]:
    category_counts: Dict[str, int] = {}
    for name in _HANDLERS.keys():
        meta = _TOOL_METADATA.get(name, ("other", ""))
        category_counts[meta[0]] = category_counts.get(meta[0], 0) + 1
    return {"ok": True, "categories": [{"id": c, "count": n} for c, n in sorted(category_counts.items())]}
