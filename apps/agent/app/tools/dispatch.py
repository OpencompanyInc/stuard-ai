from __future__ import annotations

from typing import Any, Dict, Callable, Awaitable

from . import gui, system, windows, fs, clipboard, memory, knowledge, media, media_bus, canvas, tasks, workflows, context, concurrency, transform, loops, memory_conversations, wakeword, file_scanner, file_search, subagents, screen_capture, agent_todo, ffmpeg


# Map tool names to handler functions
_HANDLERS = {
    # GUI
    "get_mouse_position": gui.get_mouse_position,
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

    # Agentic File Tools (for AI agents)
    "file_read": fs.file_read,
    "file_edit": fs.file_edit,

    # Filesystem Checkpoints
    "checkpoint_create": fs.checkpoint_create,
    "checkpoint_restore": fs.checkpoint_restore,
    "checkpoint_list": fs.checkpoint_list,

    # Clipboard
    "get_clipboard_content": clipboard.get_clipboard_content,
    "set_clipboard_content": clipboard.set_clipboard_content,

    # System
    "launch_application_or_uri": system.launch_application_or_uri,
    "run_system_command": system.run_system_command,
    "run_command": system.run_command,
    "list_terminals": system.list_terminals,
    "read_terminal": system.read_terminal,
    "get_local_time": system.get_local_time,
    # Python runtime management
    "python_status": system.python_status,
    "python_setup": system.python_setup,
    "python_install": system.python_install,
    "run_python_script": system.run_python_script,
    "run_node_script": system.run_node_script,

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

    # Memory (Conversations & Spaces)
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

    # Media capture
    "capture_media": media.capture_media,
    "stop_capture": media.stop_capture,
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

    # FFmpeg (Media tools)
    "ffmpeg_status": ffmpeg.ffmpeg_status,
    "ffmpeg_setup": ffmpeg.ffmpeg_setup,
    "ffmpeg_run": ffmpeg.ffmpeg_run,
    "ffmpeg_convert_media": ffmpeg.ffmpeg_convert_media,
    "ffmpeg_extract_audio": ffmpeg.ffmpeg_extract_audio,
    "ffmpeg_trim_media": ffmpeg.ffmpeg_trim_media,
    "ffmpeg_probe_media": ffmpeg.ffmpeg_probe_media,
    "ffmpeg_extract_frames": ffmpeg.ffmpeg_extract_frames,

    # Canvas/Container manager
    "canvas_manager": canvas.canvas_manager,

    # Calendar / Tasks / Reminders
    "calendar_crud": tasks.calendar_crud,
    "task_crud": tasks.task_crud,
    "task_reminders": tasks.task_reminders,

    # Notifications
    "send_notification": tasks.send_notification,

    # Agent Internal Todo (session-scoped task tracking)
    "agent_todo": agent_todo.agent_todo,

    # Workflow Utilities
    "parallel_executor": concurrency.parallel_executor,
    "transform_data": transform.transform_data,
    "loop_executor": loops.loop_executor,

    # Workflows / Stuards metadata (desktop integration)
    "list_local_workflows": workflows.list_local_workflows,
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

    # Wakeword
    "wakeword_start": wakeword.wakeword_start,
    "wakeword_stop": wakeword.wakeword_stop,
    "wakeword_status": wakeword.wakeword_status,

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
}


async def execute(tool: str, args: Dict[str, Any], emit: Callable[[str, Dict[str, Any] | None], Awaitable[None]] | None = None) -> Dict[str, Any]:
    handler = _HANDLERS.get(tool)
    if handler is None:
        return {"ok": False, "error": "unknown_tool"}

    # Some handlers support an optional emit for progress / streaming events
    if tool in (
        "run_system_command",
        "run_command",
        "capture_media",
        "stop_capture",
        "list_active_captures",
        "canvas_manager",
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

        # Wakeword tools
        "wakeword_start",
        "wakeword_stop",

        # Workflow tools
        "show_json_workflow_code",

        # FFmpeg tools
        "ffmpeg_setup",
        "ffmpeg_run",
        "ffmpeg_convert_media",
        "ffmpeg_extract_audio",
        "ffmpeg_trim_media",
        "ffmpeg_probe_media",
        "ffmpeg_extract_frames",
    ):
        return await handler(args, emit)  # type: ignore[misc]
    else:
        return await handler(args)  # type: ignore[misc]
