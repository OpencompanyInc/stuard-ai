from __future__ import annotations

from typing import Any, Dict, Callable, Awaitable

from . import gui, system, windows, desktop_control, fs, clipboard, memory, knowledge, media, media_bus, tasks, workflows, context, concurrency, transform, loops, memory_conversations, file_scanner, file_search, subagents, screen_capture, agent_todo, ffmpeg, math_ops, http, streams, database, folder_limiter, mediapipe_tools, utils, vault, data_analysis


# Tool metadata for discovery (category and description)
# Format: tool_name -> (category, description)
_TOOL_METADATA: Dict[str, tuple[str, str]] = {
    # GUI
    "get_mouse_position": ("input", "Get the current mouse cursor position on screen"),
    "move_cursor": ("input", "Move the mouse cursor to specific screen coordinates"),
    "computer_use": ("input", "Perform GUI actions (mouse/keyboard) and optionally capture a screenshot"),
    "click_at_coordinates": ("input", "Click at specific screen coordinates"),
    "double_click_at_coordinates": ("input", "Double-click at specific screen coordinates"),
    "type_text": ("input", "Type text at cursor position"),
    "send_hotkey": ("input", "Send keyboard hotkey combinations"),
    "scroll": ("input", "Scroll the mouse wheel vertically and optionally horizontally"),
    "drag_and_drop": ("input", "Drag from one coordinate to another"),
    "take_screenshot": ("vision", "Capture screenshot and return a local file path"),
    "capture_screen_to_file": ("vision", "Capture screen to a specific file path"),
    "prepare_image_for_model": ("vision", "Prepare an image for model analysis"),

    # Windows
    "get_foreground_window": ("system", "Get info about the currently focused window"),
    "list_open_windows": ("system", "List all open windows and their basic properties"),
    "bring_window_to_foreground": ("system", "Activate and focus a window by title"),

    # Filesystem
    "list_directory": ("system", "List directory contents"),
    "read_file": ("system", "Read text file contents"),
    "write_file": ("system", "Write text content to a file"),
    "create_directory": ("system", "Create a directory on disk"),
    "move_file": ("system", "Move or rename files and directories"),
    "copy_file": ("system", "Copy a file to a new location"),
    "delete_file": ("system", "Delete a file or directory"),
    "open_file": ("system", "Open a file or folder with the default application"),
    "read_file_binary": ("system", "Read binary file contents"),
    "read_file_base64": ("system", "Read file as base64 encoded string"),
    "write_file_base64": ("system", "Write base64 encoded string to a file"),
    "file_read": ("system", "Read file contents with line numbers for AI agents"),
    "file_edit": ("system", "Edit file contents using string-based matching"),
    "file_edit": ("system", "Edit file contents using string-based matching"),
    "glob": ("system", "Find files by glob pattern (e.g. **/*.pdf). Requires root for **; **/* is rejected."),
    "grep": ("system", "Search text in files (regex or literal). Supports searching inside PDFs, XLSX, and XLS by extracting document text first."),

    # Filesystem Checkpoints
    "checkpoint_create": ("system", "Create a checkpoint of files for rollback"),
    "checkpoint_restore": ("system", "Restore files from a checkpoint"),
    "checkpoint_redo": ("system", "Re-apply previously reverted file changes"),
    "checkpoint_list": ("system", "List available checkpoints"),

    # Clipboard
    "get_clipboard_content": ("input", "Read text from the clipboard"),
    "set_clipboard_content": ("input", "Set text into the clipboard"),

    # System
    "launch_application_or_uri": ("system", "Launch desktop applications or open URLs"),
    "run_command": ("system", "Run shell commands cross-platform with timeout"),
    "list_terminals": ("system", "List active terminal sessions"),
    "read_terminal": ("system", "Read incremental terminal output"),
    "get_local_time": ("system", "Get the current local time"),
    "python_status": ("system", "Check Python environment status"),
    "python_setup": ("system", "Setup a Python environment"),
    "python_list_packages": ("system", "List installed Python packages in a managed venv"),
    "python_install": ("system", "Install Python packages in an environment"),
    "run_python_script": ("system", "Run Python code inline or from file"),
    "run_node_script": ("system", "Run Node.js code inline or from file"),

    # Data Analysis (pandas/numpy/scipy + matplotlib/seaborn in dedicated venv — installed on demand)
    "data_analysis_status": ("data_analysis", "Check data analysis env + required-package install status"),
    "data_analysis_setup": ("data_analysis", "Create venv and install pandas/numpy/scipy/matplotlib/seaborn/openpyxl"),
    "data_analysis_uninstall": ("data_analysis", "Remove the data analysis env and free disk space"),
    "data_load": ("data_analysis", "Peek at a CSV/XLSX/JSON/Parquet file: columns, dtypes, shape, sample rows"),
    "describe_data": ("data_analysis", "Pandas describe()-style summary stats for numeric columns"),
    "correlate_data": ("data_analysis", "Correlation matrix (Pearson/Spearman/Kendall) for numeric columns"),
    "plot_line": ("data_analysis", "Render a line chart (single or multi-series) to PNG"),
    "plot_bar": ("data_analysis", "Render a bar chart (vertical or horizontal) to PNG"),
    "plot_scatter": ("data_analysis", "Render a scatter plot with optional regression line to PNG"),
    "plot_hist": ("data_analysis", "Render a histogram (with optional KDE overlay) to PNG"),
    "plot_pie": ("data_analysis", "Render a pie or donut chart to PNG"),
    "plot_heatmap": ("data_analysis", "Render a seaborn heatmap from a 2D matrix to PNG"),
    "plot_box": ("data_analysis", "Render a box plot (single or grouped) to PNG"),
    "run_data_python": ("data_analysis", "Run arbitrary Python with pandas/numpy/scipy/matplotlib/seaborn pre-loaded"),

    # Desktop controls
    "describe_desktop_control_capabilities": ("desktop", "Describe available desktop software-control backends"),
    "get_desktop_wallpaper": ("desktop", "Get the current desktop wallpaper path"),
    "set_desktop_wallpaper": ("desktop", "Set the desktop wallpaper from a local image path"),
    "get_system_volume": ("desktop", "Get current system output volume and mute state"),
    "set_system_volume": ("desktop", "Set or adjust system output volume and mute state"),
    "list_bluetooth_devices": ("desktop", "List known Bluetooth devices"),
    "connect_bluetooth_device": ("desktop", "Connect a Bluetooth device when the platform backend supports it"),
    "disconnect_bluetooth_device": ("desktop", "Disconnect a Bluetooth device when the platform backend supports it"),
    "get_display_brightness": ("desktop", "Get laptop or display brightness when available"),
    "set_display_brightness": ("desktop", "Set laptop or display brightness when available"),
    "get_power_status": ("desktop", "Get battery and charging status"),

    # Utilities (no scripts needed)
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

    # Memory (Knowledge Graph)
    "memory_retrieval": ("memory", "Retrieve memories by query"),
    "group_management": ("memory", "Manage memory groups"),
    "context_manager": ("memory", "Manage conversation context"),

    # Knowledge
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
    "knowledge_get_facts_for_conversation": ("knowledge", "Get facts extracted from a conversation"),
    "knowledge_get_conversations_for_entity": ("knowledge", "Get conversations for an entity"),
    "knowledge_deduplicate_facts": ("knowledge", "Deduplicate near-identical facts"),
    "knowledge_stats": ("knowledge", "Get knowledge graph statistics"),
    "knowledge_delete_fact": ("knowledge", "Delete a fact"),
    "knowledge_invalidate_fact": ("knowledge", "Invalidate a fact"),
    "knowledge_delete_entity": ("knowledge", "Delete an entity"),
    "knowledge_update_entity": ("knowledge", "Update an entity"),
    "knowledge_build_context": ("knowledge", "Build context from knowledge graph"),
    "knowledge_get_procedural": ("knowledge", "Get procedural knowledge"),
    "knowledge_get_events": ("knowledge", "Get event history"),
    "knowledge_get_graph": ("knowledge", "Get knowledge graph visualization data"),

    # Pending Memories
    "pending_memory_create": ("memory", "Create a pending memory for confirmation"),
    "pending_memory_list": ("memory", "List pending memories"),
    "pending_memory_get": ("memory", "Get a pending memory"),
    "pending_memory_confirm": ("memory", "Confirm a pending memory"),
    "pending_memory_reject": ("memory", "Reject a pending memory"),
    "pending_memory_delete": ("memory", "Delete a pending memory"),
    "pending_memory_expire": ("memory", "B4: expire pending memories past TTL and cap active count"),
    "knowledge_consolidate_facts": ("knowledge", "B2: pairwise vector dedup for a (category, subtype) slice"),

    # Memory (Conversations & Spaces)
    "conversation_create": ("memory", "Create a new conversation"),
    "conversation_get": ("memory", "Get a conversation"),
    "conversation_get_extraction_offset": ("memory", "B1: highest turn index already extracted for a conversation"),
    "conversation_set_extraction_offset": ("memory", "B1: advance extraction watermark for a conversation"),
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
    "segment_build_topic_drawers": ("memory", "Build topic drawers (topics -> clustered segments)"),
    "segment_search_drawers_by_embedding": ("memory", "Search topic drawers by embedding similarity"),
    "collection_summary_upsert": ("memory", "Upsert a collection summary"),
    "collection_summary_get": ("memory", "Get a collection summary by topic"),
    "collection_summary_search": ("memory", "Search collection summaries by embedding"),
    "collection_summary_list": ("memory", "List all collection summaries"),
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
    "project_create": ("data", "Create a new project"),
    "project_get": ("data", "Get a project by ID"),
    "project_list": ("data", "List projects"),
    "project_update": ("data", "Update a project"),
    "project_delete": ("data", "Delete a project"),
    "project_context_add": ("data", "Attach a file or folder as indexed project context"),
    "memory_create": ("data", "Create a new memory entry (atomic note/fact/snippet)"),
    "memory_list": ("data", "List memories, optionally scoped to a project"),
    "memory_search": ("data", "Cosine-similarity search over memory embeddings"),
    "memory_delete": ("data", "Delete a memory"),
    "journal_add": ("data", "Add a journal/timeline entry to a project"),
    "journal_list": ("data", "List journal entries for a project"),
    "journal_delete": ("data", "Delete a journal entry"),
    "conversation_set_project": ("data", "Stamp a conversation with a project_id (or clear it)"),
    "security_get_settings": ("system", "Get security settings"),
    "security_set_password": ("system", "Set security password"),
    "security_verify_password": ("system", "Verify security password"),
    "security_update_settings": ("system", "Update security settings"),
    "security_remove_password": ("system", "Remove security password"),
    "memory_stats": ("memory", "Get memory statistics"),
    "memory_export_plaintext": ("memory", "Export memory.db with all encrypted columns decrypted (for VM sync)"),

    # Media capture
    "capture_media": ("vision", "Capture photos, videos, or audio"),
    "stop_capture": ("vision", "Stop an active capture session"),
    "stop_captures_by_flow": ("vision", "Stop capture sessions belonging to a specific workflow (by flowId)"),
    "list_active_captures": ("vision", "List active capture sessions"),
    "describe_media_capture_capabilities": ("vision", "Describe media capture capabilities"),
    "upload_file_to_url": ("data", "Upload a file to a URL"),

    # Media Bus
    "subscribe_media_bus": ("vision", "Subscribe to a media bus"),
    "unsubscribe_media_bus": ("vision", "Unsubscribe from a media bus"),
    "get_bus_status": ("vision", "Get media bus status"),
    "list_media_buses": ("vision", "List active media buses"),
    "start_bus_recording": ("vision", "Start recording from a media bus"),
    "stop_bus_recording": ("vision", "Stop recording from a media bus"),
    "get_bus_frames": ("vision", "Get frames from a media bus"),

    # Screen Recording & System Audio
    "capture_screen": ("vision", "Capture screen recording"),
    "stop_screen_capture": ("vision", "Stop screen recording"),
    "describe_screen_capture_capabilities": ("vision", "Describe screen capture capabilities"),
    "capture_system_audio": ("vision", "Capture system audio"),
    "stop_system_audio": ("vision", "Stop system audio capture"),
    "describe_system_audio_capabilities": ("vision", "Describe system audio capabilities"),

    # MediaPipe
    "mediapipe_status": ("vision", "Check if MediaPipe is installed and available"),
    "mediapipe_setup": ("vision", "Install MediaPipe + opencv-python + numpy"),
    "mediapipe_pose": ("vision", "Detect body pose landmarks in an image using MediaPipe"),
    "mediapipe_hands": ("vision", "Detect hand landmarks in an image using MediaPipe"),
    "mediapipe_face_detection": ("vision", "Detect faces with bounding boxes and keypoints using MediaPipe"),
    "mediapipe_face_mesh": ("vision", "Detect 468 face mesh landmarks using MediaPipe"),
    "mediapipe_segmentation": ("vision", "Segment person from background (selfie segmentation) using MediaPipe"),
    "mediapipe_holistic": ("vision", "Detect pose + hands + face in one pass using MediaPipe Holistic"),
    "mediapipe_process_video": ("vision", "Process video frames with MediaPipe (pose/hands/face/holistic)"),

    # FFmpeg
    "ffmpeg_status": ("vision", "Check FFmpeg availability"),
    "ffmpeg_setup": ("vision", "Setup FFmpeg"),
    "ffmpeg_run": ("vision", "Run FFmpeg with custom arguments"),
    "ffmpeg_convert_media": ("vision", "Convert media formats"),
    "ffmpeg_extract_audio": ("vision", "Extract audio from media"),
    "ffmpeg_trim_media": ("vision", "Trim media to time range"),
    "ffmpeg_probe_media": ("vision", "Probe media file metadata"),
    "ffmpeg_extract_frames": ("vision", "Extract frames from video"),

    # Calendar / Tasks / Reminders
    "calendar_crud": ("integrations", "Manage calendar events"),
    "task_crud": ("integrations", "Manage tasks"),
    "task_reminders": ("integrations", "Manage task reminders"),
    "unified_task_assignments": ("integrations", "Manage user task assignments (reminders, actions, check-ins scheduled for the agent)"),
    "send_notification": ("ui", "Send a desktop notification"),

    # Agent Todo
    "agent_todo": ("core", "Manage agent's internal todo list"),

    # Workflow Utilities
    "parallel_executor": ("flow", "Execute tools in parallel"),
    "transform_data": ("flow", "Transform data between steps"),
    "loop_executor": ("flow", "Execute tools in a loop"),

    # Workflows / Stuards
    "search_local_workflows": ("flow", "Search local workflow files"),
    "list_local_stuards": ("flow", "List local Stuard automations"),
    "import_workflow": ("flow", "Import a workflow from JSON"),
    "export_workflow": ("flow", "Export a workflow to JSON"),
    "validate_workflow_requirements": ("flow", "Validate workflow requirements"),
    "stuards_import_workflow": ("flow", "Import a Stuard workflow"),
    "run_automation": ("flow", "Run an automation"),
    "stuards_run": ("flow", "Run a Stuard automation"),
    "stop_automation": ("flow", "Stop an automation"),
    "stuards_stop": ("flow", "Stop a Stuard automation"),
    "invoke_workflow": ("flow", "Invoke a workflow with arguments"),
    "test_run_steps": ("flow", "Test run workflow steps"),
    "show_json_workflow_code": ("flow", "Display workflow JSON code"),

    # File Index & Search
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

    # Sub-agents
    "subagent_spawn": ("core", "Spawn a sub-agent"),
    "subagent_status": ("core", "Get sub-agent status"),
    "subagent_list": ("core", "List sub-agents"),
    "subagent_update": ("core", "Update sub-agent"),
    "subagent_steer": ("core", "Queue a steering message for a running sub-agent"),
    "subagent_consume_steers": ("core", "Drain pending steer messages for a sub-agent"),

    # Math & Neural Network Operations
    "math_add": ("math", "Add two values/tensors elementwise"),
    "math_subtract": ("math", "Subtract b from a elementwise"),
    "math_multiply": ("math", "Multiply two values/tensors elementwise"),
    "math_divide": ("math", "Divide a by b elementwise"),
    "math_power": ("math", "Raise a to power b elementwise"),
    "math_sqrt": ("math", "Square root elementwise"),
    "math_abs": ("math", "Absolute value elementwise"),
    "math_negate": ("math", "Negate values elementwise"),
    "math_exp": ("math", "Exponential (e^x) elementwise"),
    "math_log": ("math", "Natural logarithm elementwise"),
    "math_sum": ("math", "Sum all elements or along an axis"),
    "math_mean": ("math", "Mean of all elements or along an axis"),
    "math_max": ("math", "Maximum value"),
    "math_min": ("math", "Minimum value"),
    "math_argmax": ("math", "Index of maximum value"),
    "math_argmin": ("math", "Index of minimum value"),
    "math_dot": ("math", "Dot product / matrix multiplication"),
    "math_transpose": ("math", "Transpose a 2D matrix"),
    "math_reshape": ("math", "Reshape tensor to new shape"),
    "math_shape": ("math", "Get shape of a tensor"),
    "math_flatten": ("math", "Flatten tensor to 1D"),
    "math_zeros": ("math", "Create tensor of zeros"),
    "math_ones": ("math", "Create tensor of ones"),
    "math_random": ("math", "Create tensor of random values"),
    "math_range": ("math", "Create a range of values"),
    "math_linspace": ("math", "Create linearly spaced values"),
    "math_sigmoid": ("math", "Sigmoid activation function"),
    "math_relu": ("math", "ReLU activation function"),
    "math_leaky_relu": ("math", "Leaky ReLU activation function"),
    "math_tanh": ("math", "Tanh activation function"),
    "math_softmax": ("math", "Softmax activation function"),
    "math_gelu": ("math", "GELU activation function"),
    "math_swish": ("math", "Swish activation function"),
    "math_linear": ("math", "Linear layer: y = Wx + b"),
    "math_forward_pass": ("math", "Run forward pass through neural network layers"),
    "math_cross_entropy_loss": ("math", "Cross-entropy loss for classification"),
    "math_mse_loss": ("math", "Mean squared error loss"),
    "math_compare": ("math", "Compare two values (eq, ne, lt, le, gt, ge)"),
    "math_clip": ("math", "Clip values to [min, max] range"),
    "math_where": ("math", "Conditional selection: where(condition, x, y)"),
    "math_concat": ("math", "Concatenate arrays along axis"),
    "math_stack": ("math", "Stack arrays along new axis"),
    "math_slice": ("math", "Slice a tensor"),
    "math_get_index": ("math", "Get element at index"),
    "math_set_index": ("math", "Set element at index"),

    # Secure Vault (Credential Management)
    "vault_list": ("vault", "List stored credentials (secrets masked)"),
    "vault_get": ("vault", "Get a vault entry with decrypted secrets"),
    "vault_add": ("vault", "Add a new credential to the secure vault"),
    "vault_update": ("vault", "Update an existing vault entry"),
    "vault_delete": ("vault", "Delete a vault entry"),
    "vault_get_credential": ("vault", "Get credential (username/password) for agent use"),
    "vault_search": ("vault", "Search vault entries by service name"),
    "vault_stats": ("vault", "Get vault statistics"),

    # Folder Permissions
    "folder_permission_add": ("system", "Add a folder to the allowed access list with read/write/both permission"),
    "folder_permission_remove": ("system", "Remove a folder from the allowed access list"),
    "folder_permission_list": ("system", "List all folder permission rules"),
    "folder_permission_set_enabled": ("system", "Enable or disable the folder limiter"),
    "folder_permission_check": ("system", "Check if a path is allowed for a given operation"),

    # Database Storage
    "db_query": ("data", "Execute raw SQL against the local workflow database (SQLite)"),
    "db_store": ("data", "Store/upsert a JSON document into a named collection"),
    "db_retrieve": ("data", "Retrieve a document by ID from a collection"),
    "db_search": ("data", "Search documents in a collection with key-value filters"),
    "db_delete": ("data", "Delete a document by ID from a collection"),
    "db_list_tables": ("data", "List all tables/collections in the workflow database"),

    # HTTP
    "http_request": ("integrations", "Make HTTP requests like curl or Postman (GET, POST, PUT, PATCH, DELETE, etc.)"),

    # Streaming
    "stream_create": ("streaming", "Create a named data stream for real-time chunk processing"),
    "stream_write": ("streaming", "Push a chunk of data to a stream"),
    "stream_read": ("streaming", "Read next chunk(s) from a stream (cursor-based)"),
    "stream_close": ("streaming", "Close a stream, signaling end to all subscribers"),
    "stream_subscribe": ("streaming", "Subscribe to a stream to receive chunks"),
    "stream_unsubscribe": ("streaming", "Unsubscribe from a stream"),
    "stream_add_transform": ("streaming", "Add a transform function to the stream pipeline"),
    "stream_remove_transform": ("streaming", "Remove a transform from the stream pipeline"),
    "stream_update_transform": ("streaming", "Update transform parameters live"),
    "stream_list": ("streaming", "List active streams for a workflow"),
    "close_all_streams": ("streaming", "Close ALL active streams, optionally filtered by flowId"),
    "stream_get_status": ("streaming", "Get detailed stream stats and subscriber info"),
    "stream_from_script": ("streaming", "Run a Python script that emits chunks into a real-time stream"),
    "stream_from_api": ("streaming", "Subscribe to a streaming API (SSE/chunked HTTP) and push events into a stream"),
    "stream_from_llm": ("streaming", "Stream LLM text generation token-by-token into a workflow stream"),
}


# Map tool names to handler functions
_HANDLERS = {
    # GUI
    "get_mouse_position": gui.get_mouse_position,
    "move_cursor": gui.move_cursor,
    "computer_use": gui.computer_use,
    "click_at_coordinates": gui.click_at_coordinates,
    "double_click_at_coordinates": gui.double_click_at_coordinates,
    "type_text": gui.type_text,
    "send_hotkey": gui.send_hotkey,
    "scroll": gui.scroll,
    "drag_and_drop": gui.drag_and_drop,
    "take_screenshot": gui.take_screenshot,
    "capture_screen_to_file": gui.capture_screen_to_file,
    "prepare_image_for_model": gui.prepare_image_for_model,

    # Windows
    "get_foreground_window": windows.get_foreground_window,
    "list_open_windows": windows.list_open_windows,
    "bring_window_to_foreground": windows.bring_window_to_foreground,

    # Filesystem
    "list_directory": fs.list_directory,
    "read_file": fs.read_file,
    "write_file": fs.write_file,
    "create_directory": fs.create_directory,
    "move_file": fs.move_file,
    "copy_file": fs.copy_file,
    "delete_file": fs.delete_file,
    "open_file": fs.open_file,
    "read_file_binary": fs.read_file_binary,
    "write_file_base64": fs.write_file_base64,
    "read_file_base64": fs.read_file_binary,  # Alias - returns base64 in 'data' field

    # Agentic File Tools (for AI agents)
    "file_read": fs.file_read,
    "file_edit": fs.file_edit,
    "file_edit": fs.file_edit,
    "glob": fs.glob_paths,
    "grep": fs.grep,

    # Filesystem Checkpoints
    "checkpoint_create": fs.checkpoint_create,
    "checkpoint_restore": fs.checkpoint_restore,
    "checkpoint_redo": fs.checkpoint_redo,
    "checkpoint_list": fs.checkpoint_list,

    # Clipboard
    "get_clipboard_content": clipboard.get_clipboard_content,
    "set_clipboard_content": clipboard.set_clipboard_content,

    # System
    "launch_application_or_uri": system.launch_application_or_uri,
    "run_command": system.run_command,
    "list_terminals": system.list_terminals,
    "read_terminal": system.read_terminal,
    "get_local_time": system.get_local_time,
    # Python runtime management
    "python_status": system.python_status,
    "python_setup": system.python_setup,
    "python_list_packages": system.python_list_packages,
    "python_install": system.python_install,
    "run_python_script": system.run_python_script,
    "run_node_script": system.run_node_script,

    # Data Analysis (pandas/numpy/scipy + matplotlib/seaborn, on-demand venv)
    "data_analysis_status": data_analysis.data_analysis_status,
    "data_analysis_setup": data_analysis.data_analysis_setup,
    "data_analysis_uninstall": data_analysis.data_analysis_uninstall,
    "data_load": data_analysis.data_load,
    "describe_data": data_analysis.describe_data,
    "correlate_data": data_analysis.correlate_data,
    "plot_line": data_analysis.plot_line,
    "plot_bar": data_analysis.plot_bar,
    "plot_scatter": data_analysis.plot_scatter,
    "plot_hist": data_analysis.plot_hist,
    "plot_pie": data_analysis.plot_pie,
    "plot_heatmap": data_analysis.plot_heatmap,
    "plot_box": data_analysis.plot_box,
    "run_data_python": data_analysis.run_data_python,

    # Desktop controls
    "describe_desktop_control_capabilities": desktop_control.describe_desktop_control_capabilities,
    "get_desktop_wallpaper": desktop_control.get_desktop_wallpaper,
    "set_desktop_wallpaper": desktop_control.set_desktop_wallpaper,
    "get_system_volume": desktop_control.get_system_volume,
    "set_system_volume": desktop_control.set_system_volume,
    "list_bluetooth_devices": desktop_control.list_bluetooth_devices,
    "connect_bluetooth_device": desktop_control.connect_bluetooth_device,
    "disconnect_bluetooth_device": desktop_control.disconnect_bluetooth_device,
    "get_display_brightness": desktop_control.get_display_brightness,
    "set_display_brightness": desktop_control.set_display_brightness,
    "get_power_status": desktop_control.get_power_status,

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

    # Memory (Knowledge Graph)
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
    "knowledge_get_facts_for_conversation": knowledge.knowledge_get_facts_for_conversation,
    "knowledge_get_conversations_for_entity": knowledge.knowledge_get_conversations_for_entity,
    "knowledge_deduplicate_facts": knowledge.knowledge_deduplicate_facts,
    "knowledge_stats": knowledge.knowledge_stats,
    "knowledge_delete_fact": knowledge.knowledge_delete_fact,
    "knowledge_invalidate_fact": knowledge.knowledge_invalidate_fact,
    "knowledge_delete_entity": knowledge.knowledge_delete_entity,
    "knowledge_update_entity": knowledge.knowledge_update_entity,
    "knowledge_build_context": knowledge.knowledge_build_context,
    "knowledge_get_procedural": knowledge.knowledge_get_procedural,
    "knowledge_get_events": knowledge.knowledge_get_events,
    "knowledge_get_graph": knowledge.knowledge_get_graph,

    # Pending Memories (uncertain memories awaiting confirmation)
    "pending_memory_create": knowledge.pending_memory_create,
    "pending_memory_list": knowledge.pending_memory_list,
    "pending_memory_get": knowledge.pending_memory_get,
    "pending_memory_confirm": knowledge.pending_memory_confirm,
    "pending_memory_reject": knowledge.pending_memory_reject,
    "pending_memory_delete": knowledge.pending_memory_delete,
    "pending_memory_expire": knowledge.pending_memory_expire,
    "knowledge_consolidate_facts": knowledge.knowledge_consolidate_facts,

    # Memory (Conversations & Spaces)
    "conversation_create": memory_conversations.conversation_create,
    "conversation_get": memory_conversations.conversation_get,
    "conversation_get_extraction_offset": memory_conversations.conversation_get_extraction_offset,
    "conversation_set_extraction_offset": memory_conversations.conversation_set_extraction_offset,
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
    "segment_search_drawers_by_embedding": memory_conversations.segment_search_drawers_by_embedding,
    "collection_summary_upsert": memory_conversations.collection_summary_upsert,
    "collection_summary_get": memory_conversations.collection_summary_get,
    "collection_summary_search": memory_conversations.collection_summary_search,
    "collection_summary_list": memory_conversations.collection_summary_list,
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
    "project_create": memory_conversations.project_create,
    "project_get": memory_conversations.project_get,
    "project_list": memory_conversations.project_list,
    "project_update": memory_conversations.project_update,
    "project_delete": memory_conversations.project_delete,
    "project_context_add": memory_conversations.project_context_add,
    "memory_create": memory_conversations.memory_create,
    "memory_list": memory_conversations.memory_list,
    "memory_search": memory_conversations.memory_search,
    "memory_delete": memory_conversations.memory_delete,
    "journal_add": memory_conversations.journal_add,
    "journal_list": memory_conversations.journal_list,
    "journal_delete": memory_conversations.journal_delete,
    "conversation_set_project": memory_conversations.conversation_set_project,
    "security_get_settings": memory_conversations.security_get_settings,
    "security_set_password": memory_conversations.security_set_password,
    "security_verify_password": memory_conversations.security_verify_password,
    "security_update_settings": memory_conversations.security_update_settings,
    "security_remove_password": memory_conversations.security_remove_password,
    "memory_stats": memory_conversations.memory_stats,
    "memory_export_plaintext": memory_conversations.memory_export_plaintext,

    # Media capture
    "capture_media": media.capture_media,
    "stop_capture": media.stop_capture,
    "stop_captures_by_flow": media.stop_captures_by_flow,
    "list_active_captures": media.list_active_captures,
    "describe_media_capture_capabilities": media.describe_media_capture_capabilities,
    "upload_file_to_url": media.upload_file_to_url,
    
    # Media Bus (shared capture)
    "subscribe_media_bus": media_bus.subscribe_media_bus,
    "unsubscribe_media_bus": media_bus.unsubscribe_media_bus,
    "get_bus_status": media_bus.get_bus_status,
    "list_media_buses": media_bus.list_media_buses,
    "start_bus_recording": media_bus.start_bus_recording,
    "stop_bus_recording": media_bus.stop_bus_recording,
    "get_bus_frames": media_bus.get_bus_frames,

    # Screen Recording & System Audio Capture
    "capture_screen": screen_capture.capture_screen,
    "stop_screen_capture": screen_capture.stop_screen_capture,
    "describe_screen_capture_capabilities": screen_capture.describe_screen_capture_capabilities,
    "capture_system_audio": screen_capture.capture_system_audio,
    "stop_system_audio": screen_capture.stop_system_audio,
    "describe_system_audio_capabilities": screen_capture.describe_system_audio_capabilities,

    # MediaPipe (Computer Vision)
    "mediapipe_status": mediapipe_tools.mediapipe_status,
    "mediapipe_setup": mediapipe_tools.mediapipe_setup,
    "mediapipe_pose": mediapipe_tools.mediapipe_pose,
    "mediapipe_hands": mediapipe_tools.mediapipe_hands,
    "mediapipe_face_detection": mediapipe_tools.mediapipe_face_detection,
    "mediapipe_face_mesh": mediapipe_tools.mediapipe_face_mesh,
    "mediapipe_segmentation": mediapipe_tools.mediapipe_segmentation,
    "mediapipe_holistic": mediapipe_tools.mediapipe_holistic,
    "mediapipe_process_video": mediapipe_tools.mediapipe_process_video,

    # FFmpeg (Media tools)
    "ffmpeg_status": ffmpeg.ffmpeg_status,
    "ffmpeg_setup": ffmpeg.ffmpeg_setup,
    "ffmpeg_run": ffmpeg.ffmpeg_run,
    "ffmpeg_convert_media": ffmpeg.ffmpeg_convert_media,
    "ffmpeg_extract_audio": ffmpeg.ffmpeg_extract_audio,
    "ffmpeg_trim_media": ffmpeg.ffmpeg_trim_media,
    "ffmpeg_probe_media": ffmpeg.ffmpeg_probe_media,
    "ffmpeg_extract_frames": ffmpeg.ffmpeg_extract_frames,

    # Calendar / Tasks / Reminders
    "calendar_crud": tasks.calendar_crud,
    "task_crud": tasks.task_crud,
    "task_reminders": tasks.task_reminders,
    "unified_task_assignments": tasks.unified_task_assignments,

    # Notifications
    "send_notification": tasks.send_notification,

    # Agent Internal Todo (session-scoped task tracking)
    "agent_todo": agent_todo.agent_todo,

    # Workflow Utilities
    "parallel_executor": concurrency.parallel_executor,
    "transform_data": transform.transform_data,
    "loop_executor": loops.loop_executor,

    # Workflows / Stuards metadata (desktop integration)
    "search_local_workflows": workflows.search_local_workflows,
    "list_local_stuards": workflows.list_local_stuards,
    "import_workflow": workflows.import_workflow,
    "export_workflow": workflows.export_workflow,
    "validate_workflow_requirements": workflows.validate_workflow_requirements,
    "stuards_import_workflow": workflows.stuards_import_workflow,
    "run_automation": workflows.stuards_run,
    "stuards_run": workflows.stuards_run,
    "stop_automation": workflows.stuards_stop,
    "stuards_stop": workflows.stuards_stop,
    "invoke_workflow": workflows.invoke_workflow,
    "test_run_steps": workflows.test_run_steps,
    "show_json_workflow_code": workflows.show_json_workflow_code,  # Supports emit for JSON display

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

    # Sub-agents (parallel background agents)
    "subagent_spawn": subagents.subagent_spawn,
    "subagent_status": subagents.subagent_status,
    "subagent_list": subagents.subagent_list,
    "subagent_update": subagents.subagent_update,
    "subagent_steer": subagents.subagent_steer,
    "subagent_consume_steers": subagents.subagent_consume_steers,

    # Math & Neural Network Operations
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

    # Secure Vault (Credential Management)
    "vault_list": vault.vault_list,
    "vault_get": vault.vault_get,
    "vault_add": vault.vault_add,
    "vault_update": vault.vault_update,
    "vault_delete": vault.vault_delete,
    "vault_get_credential": vault.vault_get_credential,
    "vault_search": vault.vault_search,
    "vault_stats": vault.vault_stats,

    # Folder Permissions
    "folder_permission_add": folder_limiter.folder_permission_add,
    "folder_permission_remove": folder_limiter.folder_permission_remove,
    "folder_permission_list": folder_limiter.folder_permission_list,
    "folder_permission_set_enabled": folder_limiter.folder_permission_set_enabled,
    "folder_permission_check": folder_limiter.folder_permission_check,

    # Database Storage
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
}


# Tool discovery handlers (added dynamically after definition)
async def _list_tools_handler(args: Dict[str, Any]) -> Dict[str, Any]:
    """Handler for list_tools tool."""
    category = args.get("category")
    return list_tools(category)


async def _get_tool_info_handler(args: Dict[str, Any]) -> Dict[str, Any]:
    """Handler for get_tool_info tool."""
    tool_name = args.get("name") or args.get("tool_name") or ""
    return get_tool_info(tool_name)


async def _list_tool_categories_handler(args: Dict[str, Any]) -> Dict[str, Any]:
    """Handler for list_tool_categories tool."""
    return get_all_categories()


# Register discovery tools
_HANDLERS["list_tools"] = _list_tools_handler
_HANDLERS["get_tool_info"] = _get_tool_info_handler
_HANDLERS["list_tool_categories"] = _list_tool_categories_handler

# Add metadata for discovery tools
_TOOL_METADATA["list_tools"] = ("core", "List all available tools with optional category filter")
_TOOL_METADATA["get_tool_info"] = ("core", "Get detailed information about a specific tool")
_TOOL_METADATA["list_tool_categories"] = ("core", "List all tool categories with counts")

# Desktop-local OAuth token store. Internal infra commands (intentionally NOT in
# _TOOL_METADATA so they stay out of the agent's tool catalog) — cloud-ai calls
# these over the bridge to keep OAuth tokens on the device instead of Supabase.
from ..storage import oauth_db as _oauth_db  # noqa: E402
_HANDLERS["store_oauth_tokens"] = _oauth_db.store_oauth_tokens_handler
_HANDLERS["get_oauth_token"] = _oauth_db.get_oauth_token_handler
_HANDLERS["oauth_list"] = _oauth_db.oauth_list_handler
_HANDLERS["remove_oauth_tokens"] = _oauth_db.remove_oauth_tokens_handler
_HANDLERS["set_oauth_default"] = _oauth_db.set_oauth_default_handler
_HANDLERS["export_oauth_tokens"] = _oauth_db.export_oauth_tokens_handler


async def execute(tool: str, args: Dict[str, Any], emit: Callable[[str, Dict[str, Any] | None], Awaitable[None]] | None = None) -> Dict[str, Any]:
    handler = _HANDLERS.get(tool)
    if handler is None:
        return {"ok": False, "error": "unknown_tool"}

    # Some handlers support an optional emit for progress / streaming events
    if tool in (
        "run_command",
        "capture_media",
        "stop_capture",
        "list_active_captures",
        "task_reminders",
        "python_install",
        "run_python_script",
        "run_node_script",
        # Media bus tools
        "subscribe_media_bus",
        "unsubscribe_media_bus",
        "get_bus_status",
        "list_media_buses",
        "start_bus_recording",
        "stop_bus_recording",
        "get_bus_frames",

        # Screen Recording & System Audio
        "capture_screen",
        "stop_screen_capture",
        "capture_system_audio",
        "stop_system_audio",

        # Workflow tools
        "show_json_workflow_code",

        # MediaPipe tools
        "mediapipe_status",
        "mediapipe_setup",
        "mediapipe_pose",
        "mediapipe_hands",
        "mediapipe_face_detection",
        "mediapipe_face_mesh",
        "mediapipe_segmentation",
        "mediapipe_holistic",
        "mediapipe_process_video",

        # FFmpeg tools
        "ffmpeg_setup",
        "ffmpeg_run",
        "ffmpeg_convert_media",
        "ffmpeg_extract_audio",
        "ffmpeg_trim_media",
        "ffmpeg_probe_media",
        "ffmpeg_extract_frames",

        # Data Analysis tools (emit install progress)
        "data_analysis_setup",
        "data_load",
        "describe_data",
        "correlate_data",
        "plot_line",
        "plot_bar",
        "plot_scatter",
        "plot_hist",
        "plot_pie",
        "plot_heatmap",
        "plot_box",
        "run_data_python",

        # Stream tools
        "stream_create",
        "stream_write",
        "stream_read",
        "stream_close",
        "stream_subscribe",
        "stream_unsubscribe",
        "stream_add_transform",
        "stream_remove_transform",
        "stream_update_transform",
        "stream_list",
        "stream_get_status",
        "stream_from_script",
        "stream_from_api",
        "stream_from_llm",

        # Agent Todo
        "agent_todo",
    ):
        return await handler(args, emit)  # type: ignore[misc]
    else:
        return await handler(args)  # type: ignore[misc]


def list_tools(category: str | None = None) -> Dict[str, Any]:
    """
    List all available tools with their metadata.
    
    Args:
        category: Optional category filter (e.g., 'system', 'input', 'vision')
    
    Returns:
        Dictionary with list of tools and their metadata
    """
    tools = []
    for name in _HANDLERS.keys():
        meta = _TOOL_METADATA.get(name, ("other", name.replace("_", " ").title()))
        tool_category, description = meta
        
        # Filter by category if specified
        if category and tool_category != category:
            continue
            
        tools.append({
            "name": name,
            "category": tool_category,
            "description": description,
            "kind": "local",  # All agent tools are local
        })
    
    # Sort by category then name
    tools.sort(key=lambda t: (t["category"], t["name"]))
    
    return {
        "ok": True,
        "count": len(tools),
        "tools": tools,
    }


def get_tool_info(tool_name: str) -> Dict[str, Any]:
    """
    Get detailed info about a specific tool.
    
    Args:
        tool_name: Name of the tool to get info for
    
    Returns:
        Dictionary with tool info or error if not found
    """
    if tool_name not in _HANDLERS:
        return {"ok": False, "error": f"Tool '{tool_name}' not found"}
    
    meta = _TOOL_METADATA.get(tool_name, ("other", tool_name.replace("_", " ").title()))
    category, description = meta
    
    return {
        "ok": True,
        "name": tool_name,
        "category": category,
        "description": description,
        "kind": "local",
        "available": True,
    }


def get_all_categories() -> Dict[str, Any]:
    """
    Get all available tool categories with counts.
    
    Returns:
        Dictionary with categories and their tool counts
    """
    category_counts: Dict[str, int] = {}
    
    for name in _HANDLERS.keys():
        meta = _TOOL_METADATA.get(name, ("other", ""))
        category = meta[0]
        category_counts[category] = category_counts.get(category, 0) + 1
    
    categories = [
        {"id": cat, "count": count}
        for cat, count in sorted(category_counts.items())
    ]
    
    return {
        "ok": True,
        "categories": categories,
    }
