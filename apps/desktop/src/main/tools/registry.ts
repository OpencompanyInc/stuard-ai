export type ToolKind = 'local' | 'cloud' | 'orchestration' | 'electron';

export const TOOL_REGISTRY: Record<string, { kind: ToolKind; handler?: string }> = {
  // Electron-native tools (handled in main process)
  'custom_ui': { kind: 'electron' },
  'update_custom_ui': { kind: 'electron' },
  'close_custom_ui': { kind: 'electron' },
  'send_ui_event': { kind: 'electron' },     // Send event to custom UI window
  'run_ui_script': { kind: 'electron' },     // Run JavaScript in custom UI window
  'list_custom_ui_windows': { kind: 'electron' },  // List open custom UI windows
  'stop_workflow': { kind: 'electron' },  // Stop a running workflow
  'log': { kind: 'electron' },
  'wait': { kind: 'electron' },
  'end': { kind: 'electron' },  // Workflow terminator
  'return_value': { kind: 'electron' },  // Workflow return value (terminates run with result)
  'invoke_workflow': { kind: 'electron' },  // Invoke workflow with args
  'call_workflow': { kind: 'electron' },  // Call external workflow as function (waits for result)
  'call_function': { kind: 'electron' },  // Call function trigger within same workflow
  'call_workspace_function': { kind: 'electron' },  // Call a .stuard sub-workflow from within workspace
  'list_workspace_functions': { kind: 'electron' },  // Discover callable .stuard files in workspace

  // Workspace file management tools (read/write/list files in workflow workspace)
  'workspace_read_file': { kind: 'electron' },
  'workspace_write_file': { kind: 'electron' },
  'workspace_delete_file': { kind: 'electron' },
  'workspace_list_files': { kind: 'electron' },
  'workspace_create_folder': { kind: 'electron' },
  'workspace_get_info': { kind: 'electron' },
  'test_run_steps': { kind: 'electron' },  // Test run workflow steps
  'list_local_workflows': { kind: 'electron' },  // List saved workflows
  'list_local_stuards': { kind: 'electron' },  // List saved stuards
  'play_audio': { kind: 'electron' },
  'get_clipboard_content': { kind: 'electron' },
  'set_clipboard_content': { kind: 'electron' },
  'proactive_task_list': { kind: 'electron' },
  'proactive_task_update': { kind: 'electron' },
  'proactive_task_create': { kind: 'electron' },
  'proactive_task_delete': { kind: 'electron' },

  'list_open_windows': { kind: 'electron' },
  'bring_window_to_foreground': { kind: 'electron' },
  'get_window_info': { kind: 'electron' },
  'smart_bring_window_to_foreground': { kind: 'electron' },
  'set_window_bounds': { kind: 'electron' },

  // Browser control tools
  'browser_get_content': { kind: 'electron' },
  'browser_click_element': { kind: 'electron' },
  'browser_type_text': { kind: 'electron' },
  'browser_find_text': { kind: 'electron' },
  'browser_get_element_position': { kind: 'electron' },
  'browser_find_clickable': { kind: 'electron' },
  'browser_hover': { kind: 'electron' },
  'browser_select_option': { kind: 'electron' },
  'browser_press_key': { kind: 'electron' },
  'browser_get_form_fields': { kind: 'electron' },
  'browser_fill_form': { kind: 'electron' },
  'browser_wait_for_element': { kind: 'electron' },
  'browser_scroll_to': { kind: 'electron' },
  'browser_get_page_info': { kind: 'electron' },
  'browser_execute_script': { kind: 'electron' },
  'browser_upload_file': { kind: 'electron' },
  'browser_set_toggle': { kind: 'electron' },

  // Variable management tools (electron-native)
  'set_variable': { kind: 'electron' },
  'get_variable': { kind: 'electron' },
  'toggle_variable': { kind: 'electron' },
  'increment_variable': { kind: 'electron' },
  'append_to_list': { kind: 'electron' },
  'list_variables': { kind: 'electron' },
  'delete_variable': { kind: 'electron' },

  // Canvas document tools (sidebar canvas)
  'canvas_list': { kind: 'electron' },
  'canvas_read': { kind: 'electron' },
  'canvas_write': { kind: 'electron' },
  'canvas_create': { kind: 'electron' },
  'canvas_delete': { kind: 'electron' },
  // Backward compatibility aliases
  'sidebar_canvas_list': { kind: 'electron' },
  'sidebar_canvas_read': { kind: 'electron' },
  'sidebar_canvas_write': { kind: 'electron' },
  'sidebar_canvas_create': { kind: 'electron' },
  'sidebar_canvas_delete': { kind: 'electron' },

  // GenUI interactive tools (rendered by overlay, handled via custom_ui internally)
  'ask_confirmation': { kind: 'electron' },
  'show_choices': { kind: 'electron' },
  'pick_date': { kind: 'electron' },
  'request_files': { kind: 'electron' },
  'show_table': { kind: 'electron' },
  'show_info': { kind: 'electron' },
  'show_details': { kind: 'electron' },
  'show_files': { kind: 'electron' },
  'show_command': { kind: 'electron' },
  'show_json': { kind: 'electron' },
  'show_link': { kind: 'electron' },
  'show_colors': { kind: 'electron' },
  'show_progress': { kind: 'electron' },
  'show_info_card': { kind: 'electron' },
  'show_feedback_form': { kind: 'electron' },

  // Agent asks user a question (popup in chat)
  'ask_user': { kind: 'electron' },

  // Terminal tools (PTY-based, electron-native)
  'terminal_create': { kind: 'electron' },
  'terminal_list': { kind: 'electron' },
  'terminal_get': { kind: 'electron' },
  'terminal_send_input': { kind: 'electron' },  // AI writes to live PTY
  'terminal_send_raw': { kind: 'electron' },    // AI writes raw bytes (no newline)
  'terminal_send_keys': { kind: 'electron' },   // Convenience mapping (ctrl+c, enter, arrows, etc.)
  'terminal_read': { kind: 'electron' },        // Incremental read via seq cursor
  'terminal_wait_for': { kind: 'electron' },    // Wait until output contains a substring
  'terminal_destroy': { kind: 'electron' },

  // Orchestration tools (handled inline by engine)
  'run_sequential': { kind: 'orchestration' },
  'run_parallel': { kind: 'orchestration' },
  'loop_executor': { kind: 'orchestration' },

  // AI Agent workflow nodes (synchronous, cloud-side)
  'agent_node': { kind: 'cloud', handler: '/tools/agent_node' },
  'agent_decision': { kind: 'cloud', handler: '/tools/agent_decision' },
  'agent_extract': { kind: 'cloud', handler: '/tools/agent_extract' },

  // Cloud AI tools
  'analyze_media': { kind: 'cloud', handler: '/inference/ai/analyze-media' },
  'ai_inference': { kind: 'cloud', handler: '/inference/ai/text' },
  'analyze_image': { kind: 'cloud', handler: '/inference/ai/analyze-image' },
  'analyze_current_screen': { kind: 'cloud', handler: '/inference/ai/vision-structured' },
  'find_text': { kind: 'cloud' },
  'find_text_on_screen': { kind: 'cloud' },
  'find_and_click_text': { kind: 'cloud' },
  'google_cloud_ocr': { kind: 'cloud' },
  'web_search': { kind: 'cloud', handler: '/tools/web_search' },
  'scrape_url': { kind: 'cloud', handler: '/tools/scrape_url' },
  'text_to_speech': { kind: 'cloud', handler: '/tools/text_to_speech' },
  'generate_image': { kind: 'cloud', handler: '/tools/generate_image' },
  'list_tts_voices': { kind: 'cloud', handler: '/tools/list_tts_voices' },
  'get_tts_models': { kind: 'cloud', handler: '/tools/get_tts_models' },
  'elevenlabs_list_agents': { kind: 'cloud' },
  'elevenlabs_get_signed_conversation_url': { kind: 'cloud' },
  'elevenlabs_get_webrtc_token': { kind: 'cloud' },
  'elevenlabs_list_conversations': { kind: 'cloud' },
  'elevenlabs_get_conversation': { kind: 'cloud' },
  'elevenlabs_twilio_outbound_call': { kind: 'cloud' },
  'youtube_get_video': { kind: 'cloud' },
  'youtube_get_channel': { kind: 'cloud' },
  'youtube_get_playlist': { kind: 'cloud' },
  'youtube_search': { kind: 'cloud' },
  'search_marketplace': { kind: 'cloud' },
  'get_marketplace_workflow': { kind: 'cloud' },
  'import_from_marketplace': { kind: 'cloud' },
  'list_popular_workflows': { kind: 'cloud' },
  'list_marketplace_categories': { kind: 'cloud' },

  // Google integrations
  'google_get_userinfo': { kind: 'cloud' },
  'google_list_profiles': { kind: 'cloud' },
  'gmail_send': { kind: 'cloud' }, // Alias for gmail_send_message
  'gmail_send_message': { kind: 'cloud' },
  'gmail_list_messages': { kind: 'cloud' },
  'gmail_get_message_brief': { kind: 'cloud' },
  'gmail_get_message_full': { kind: 'cloud' },
  'gmail_get_messages_brief': { kind: 'cloud' },
  'gmail_list_recent_brief': { kind: 'cloud' },
  'gmail_get_most_recent_full': { kind: 'cloud' },
  'gmail_download_attachment': { kind: 'cloud' },
  'gmail_retrieve_messages_with_attachments': { kind: 'cloud' },
  'gmail_modify_message': { kind: 'cloud' },
  'gmail_delete_message': { kind: 'cloud' },
  'gmail_archive_message': { kind: 'cloud' },
  'gmail_mark_as_read': { kind: 'cloud' },
  'gmail_mark_as_unread': { kind: 'cloud' },
  'calendar_list_events': { kind: 'cloud' },
  'calendar_create_event': { kind: 'cloud' },
  'calendar_delete_event': { kind: 'cloud' },
  'tasks_list': { kind: 'cloud' },
  'drive_list_files': { kind: 'cloud' },
  'sheets_read_range': { kind: 'cloud' },
  'docs_get_document': { kind: 'cloud' },
  'docs_create_document': { kind: 'cloud' },
  'docs_write_text': { kind: 'cloud' },

  // Outlook integrations
  'outlook_get_me': { kind: 'cloud' },
  'outlook_send_mail': { kind: 'cloud' },
  'outlook_list_messages': { kind: 'cloud' },
  'outlook_search_messages': { kind: 'cloud' },

  // GitHub integrations
  'github_get_me': { kind: 'cloud' },
  'github_list_repos': { kind: 'cloud' },
  'github_list_issues': { kind: 'cloud' },
  'github_create_issue': { kind: 'cloud' },

  // Discord integrations
  'discord_list_guilds': { kind: 'cloud' },
  'discord_list_channels': { kind: 'cloud' },
  'discord_list_dms': { kind: 'cloud' },
  'discord_read_messages': { kind: 'cloud' },
  'discord_send_dm': { kind: 'cloud' },
  'discord_add_reaction': { kind: 'cloud' },

  // Reddit integrations
  'reddit_search': { kind: 'cloud' },
  'reddit_view_subreddit': { kind: 'cloud' },
  'reddit_view_comments': { kind: 'cloud' },
  'reddit_create_post': { kind: 'cloud' },
  'reddit_comment': { kind: 'cloud' },

  // Ollama (Local AI models)
  'ollama_status': { kind: 'electron' },
  'ollama_start': { kind: 'electron' },
  'ollama_chat': { kind: 'electron' },
  'ollama_generate': { kind: 'electron' },
  'ollama_vision': { kind: 'electron' },
  'ollama_embeddings': { kind: 'electron' },
  'ollama_models': { kind: 'electron' },

  // Browser Use (AI browser automation)
  'browser_use_setup': { kind: 'electron' },
  'browser_use_install': { kind: 'electron' },
  'browser_use_start': { kind: 'electron' },
  'browser_use_uninstall': { kind: 'electron' },
  'browser_use_stop': { kind: 'electron' },
  'browser_use_status': { kind: 'electron' },
  'browser_use_configure': { kind: 'electron' },
  'browser_use_task': { kind: 'electron' },
  'browser_use_execute_script': { kind: 'electron' },
  'browser_use_navigate': { kind: 'electron' },
  'browser_use_click': { kind: 'electron' },
  'browser_use_type': { kind: 'electron' },
  'browser_use_press_key': { kind: 'electron' },
  'browser_use_screenshot': { kind: 'electron' },
  'browser_use_content': { kind: 'electron' },
  'browser_use_scroll': { kind: 'electron' },
  'browser_use_tabs': { kind: 'electron' },
  'browser_use_cookies': { kind: 'electron' },
  'browser_use_sync_chrome': { kind: 'electron' },
  'browser_use_list_chrome_profiles': { kind: 'electron' },

  // Embeddings (cloud-side, requires OpenAI API)
  'embed_text': { kind: 'cloud' },
  'vector_similarity': { kind: 'cloud' },
  'embed_and_store': { kind: 'cloud' },

  // Everything else goes to local Python agent
  // (default if not in registry)
};

/**
 * Get the routing kind for a tool
 */
export function getToolKind(toolName: string): ToolKind {
  const entry = TOOL_REGISTRY[toolName];
  if (entry) return entry.kind;
  // Default: route to local Python agent
  return 'local';
}
