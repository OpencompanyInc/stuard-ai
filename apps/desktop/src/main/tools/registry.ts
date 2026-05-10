export type ToolKind = 'local' | 'cloud' | 'orchestration' | 'electron';

export const TOOL_REGISTRY: Record<string, { kind: ToolKind; handler?: string }> = {
  // Electron-native tools (handled in main process)
  '_media_register': { kind: 'electron' },  // Internal: register media from cloud tools into local media library
  'custom_ui': { kind: 'electron' },
  'update_custom_ui': { kind: 'electron' },
  'close_custom_ui': { kind: 'electron' },
  'send_notification': { kind: 'electron' },
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
  'read_local_workflow': { kind: 'electron' },  // Read a saved workflow's JSON
  'deploy_local_workflow': { kind: 'electron' },  // Deploy/undeploy a saved workflow locally
  'list_local_stuards': { kind: 'electron' },  // List saved stuards
  'play_audio': { kind: 'electron' },
  'get_clipboard_content': { kind: 'electron' },
  'set_clipboard_content': { kind: 'electron' },
  'proactive_task_list': { kind: 'electron' },
  'proactive_task_update': { kind: 'electron' },
  'proactive_task_create': { kind: 'electron' },
  'proactive_task_delete': { kind: 'electron' },
  // Bot management tools for normal agent chat (@tag status, create, deploy)
  'bot_list': { kind: 'electron' },
  'bot_get_status': { kind: 'electron' },
  'bot_create': { kind: 'electron' },
  'bot_deploy': { kind: 'electron' },
  'bot_pause': { kind: 'electron' },
  'ask_bot': { kind: 'electron' },
  'bot_ask': { kind: 'electron' },
  // Bot's private kanban + run log (scoped by ctx.proactiveBotId)
  'bot_memory_list': { kind: 'electron' },
  'bot_memory_create': { kind: 'electron' },
  'bot_memory_update': { kind: 'electron' },
  'bot_memory_delete': { kind: 'electron' },
  'bot_memory_log': { kind: 'electron' },
  'wakeword_start': { kind: 'electron' },
  'wakeword_stop': { kind: 'electron' },
  'wakeword_status': { kind: 'electron' },

  // Auto-skill storage (called from cloud-ai auto-skills pipeline)
  'auto_skill_store': { kind: 'electron' },
  'auto_skill_list': { kind: 'electron' },

  'list_open_windows': { kind: 'electron' },
  'bring_window_to_foreground': { kind: 'electron' },
  'get_window_info': { kind: 'electron' },
  'smart_bring_window_to_foreground': { kind: 'electron' },
  'set_window_bounds': { kind: 'electron' },

  // Variable management tools (electron-native)
  'set_variable': { kind: 'electron' },
  'get_variable': { kind: 'electron' },
  'toggle_variable': { kind: 'electron' },
  'increment_variable': { kind: 'electron' },
  'append_to_list': { kind: 'electron' },
  'list_variables': { kind: 'electron' },
  'delete_variable': { kind: 'electron' },

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
  'cloud_ai_vision': { kind: 'cloud', handler: '/inference/ai/vision-structured' },
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
  'gmail_search_messages': { kind: 'cloud' },
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
  'github_get_repo': { kind: 'cloud' },
  'github_list_issues': { kind: 'cloud' },
  'github_create_issue': { kind: 'cloud' },
  'github_update_issue': { kind: 'cloud' },
  'github_list_issue_comments': { kind: 'cloud' },
  'github_create_issue_comment': { kind: 'cloud' },
  'github_list_pulls': { kind: 'cloud' },
  'github_get_pull': { kind: 'cloud' },
  'github_create_pull': { kind: 'cloud' },
  'github_update_pull': { kind: 'cloud' },
  'github_merge_pull': { kind: 'cloud' },
  'github_list_pull_commits': { kind: 'cloud' },
  'github_list_pull_files': { kind: 'cloud' },
  'github_list_pull_reviews': { kind: 'cloud' },
  'github_create_pull_review': { kind: 'cloud' },
  'github_request_reviewers': { kind: 'cloud' },
  'github_list_branches': { kind: 'cloud' },
  'github_get_branch': { kind: 'cloud' },
  'github_create_branch': { kind: 'cloud' },
  'github_delete_branch': { kind: 'cloud' },
  'github_list_commits': { kind: 'cloud' },
  'github_get_commit': { kind: 'cloud' },
  'github_compare_commits': { kind: 'cloud' },
  'github_get_file_content': { kind: 'cloud' },
  'github_search_code': { kind: 'cloud' },
  'github_search_repos': { kind: 'cloud' },
  'github_list_releases': { kind: 'cloud' },
  'github_create_release': { kind: 'cloud' },
  'github_list_labels': { kind: 'cloud' },
  'github_list_workflow_runs': { kind: 'cloud' },
  'github_get_workflow_run': { kind: 'cloud' },
  'github_rerun_workflow': { kind: 'cloud' },
  'github_dispatch_workflow': { kind: 'cloud' },
  'github_list_gists': { kind: 'cloud' },
  'github_create_gist': { kind: 'cloud' },

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

  // Facebook / Instagram / Threads (Meta social tools)
  'facebook_get_me': { kind: 'cloud' },
  'facebook_list_pages': { kind: 'cloud' },
  'facebook_list_page_posts': { kind: 'cloud' },
  'facebook_create_page_post': { kind: 'cloud' },
  'instagram_get_me': { kind: 'cloud' },
  'instagram_list_media': { kind: 'cloud' },
  'instagram_publish_media': { kind: 'cloud' },
  'threads_get_me': { kind: 'cloud' },
  'threads_list_posts': { kind: 'cloud' },
  'threads_publish_post': { kind: 'cloud' },

  // X / Twitter
  'x_search_tweets': { kind: 'cloud' },
  'x_get_user_timeline': { kind: 'cloud' },
  'x_get_tweet': { kind: 'cloud' },
  'x_get_comments': { kind: 'cloud' },
  'x_comment_on_post': { kind: 'cloud' },
  'x_reply_to_comment': { kind: 'cloud' },
  'x_like_comment': { kind: 'cloud' },
  'x_post_tweet': { kind: 'cloud' },
  'x_delete_tweet': { kind: 'cloud' },
  'x_send_dm': { kind: 'cloud' },
  'x_list_dms': { kind: 'cloud' },
  'x_get_user': { kind: 'cloud' },
  'x_list_followers': { kind: 'cloud' },
  'x_list_following': { kind: 'cloud' },

  // WhatsApp
  'whatsapp_status': { kind: 'cloud' },
  'whatsapp_send_message': { kind: 'cloud' },
  'whatsapp_send_media': { kind: 'cloud' },
  'whatsapp_send_reaction': { kind: 'cloud' },
  'whatsapp_mark_read': { kind: 'cloud' },
  'whatsapp_upload_media': { kind: 'cloud' },

  // Telnyx (SMS / Voice)
  'telnyx_send_sms': { kind: 'cloud' },
  'telnyx_send_mms': { kind: 'cloud' },
  'telnyx_send_voice_note': { kind: 'cloud' },
  'telnyx_call_control': { kind: 'cloud' },
  'telnyx_phone_status': { kind: 'cloud' },
  'telnyx_voice_call': { kind: 'cloud' },
  'telnyx_list_voice_providers': { kind: 'cloud' },
  'telnyx_list_active_calls': { kind: 'cloud' },
  'telnyx_hangup_call': { kind: 'cloud' },

  // Ollama (Local AI models)
  'ollama_status': { kind: 'electron' },
  'ollama_start': { kind: 'electron' },
  'ollama_agent': { kind: 'electron' },
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
  'browser_use_hover': { kind: 'electron' },
  'browser_use_select_option': { kind: 'electron' },
  'browser_use_get_dropdown_options': { kind: 'electron' },
  'browser_use_get_interactive_elements': { kind: 'electron' },
  'browser_use_fill_form': { kind: 'electron' },
  'browser_use_upload_file': { kind: 'electron' },
  'browser_use_wait_for': { kind: 'electron' },

  // Cloud Storage (GCS upload/download with public/private visibility)
  'cloud_storage_upload': { kind: 'cloud' },
  'cloud_storage_get_url': { kind: 'cloud' },
  'cloud_storage_list': { kind: 'cloud' },
  'cloud_storage_delete': { kind: 'cloud' },
  'cloud_storage_set_visibility': { kind: 'cloud' },

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
