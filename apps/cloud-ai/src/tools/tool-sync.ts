import { getSupabaseService } from '../supabase';
import { getToolRegistry, getToolMetadata } from './tool-registry';
import { embedMany } from 'ai';
import { google } from '../utils/models';
import { clearToolCache } from './sis-supabase';
import { invalidateGroupCache } from '../utils/tool-groups';
import { z } from 'zod';

// Ensure registry is initialized
import './meta-tools';
import { initToolRegistry } from './meta-tools';

const EMBEDDING_MODEL = 'gemini-embedding-2-preview';
const BATCH_SIZE = 50;

export interface ToolSyncResult {
  synced: number;
  skipped: number;
  errors: string[];
}

/**
 * Semantic groups for keyword-based runtime tool injection.
 * When a user query contains a group keyword, all tools in that group
 * are injected natively (full schema) — no search_tools round-trip.
 *
 * Key = tool name, Value = group keywords this tool belongs to.
 * Stored in Supabase `tool_embeddings.semantic_groups` column.
 */
const TOOL_SEMANTIC_GROUPS: Record<string, string[]> = {
  // Terminal / interactive CLI (core 3 only — rest discoverable via search_tools)
  terminal_create: ['terminal', 'shell', 'cli', 'interactive'],
  terminal_send_input: ['terminal', 'shell', 'cli', 'interactive'],
  terminal_read: ['terminal', 'shell', 'cli', 'interactive'],

  // Browser automation
  browser_use_navigate: ['browser', 'website', 'web automation', 'scrape'],
  browser_use_get_interactive_elements: ['browser', 'website', 'web automation'],
  browser_use_interact_with_element: ['browser', 'website', 'web automation'],
  browser_use_take_screenshot: ['browser', 'website', 'screenshot'],
  browser_use_execute_js: ['browser', 'javascript', 'web automation'],
  browser_use_scroll: ['browser', 'web automation'],

  // FFmpeg / media processing
  ffmpeg_run: ['ffmpeg', 'video', 'audio', 'media processing', 'convert'],
  ffmpeg_convert_media: ['ffmpeg', 'video', 'audio', 'convert', 'transcode'],
  ffmpeg_extract_audio: ['ffmpeg', 'audio', 'extract audio'],
  ffmpeg_trim_media: ['ffmpeg', 'video', 'audio', 'trim', 'cut'],
  ffmpeg_probe_media: ['ffmpeg', 'video', 'audio', 'media info'],
  ffmpeg_extract_frames: ['ffmpeg', 'video', 'frames', 'screenshot'],
  ffmpeg_status: ['ffmpeg'],
  ffmpeg_setup: ['ffmpeg'],

  // Cloud storage
  cloud_storage_upload: ['cloud storage', 'upload', 'stuard storage'],
  cloud_storage_get_url: ['cloud storage', 'upload', 'file url', 'stuard storage'],
  cloud_storage_list: ['cloud storage', 'stuard storage'],
  cloud_storage_delete: ['cloud storage', 'stuard storage'],
  cloud_storage_set_visibility: ['cloud storage', 'stuard storage'],

  // VM operations
  vm_status: ['vm', 'cloud vm', 'always on', 'remote desktop', 'headless'],
  vm_execute_tool: ['vm', 'cloud vm', 'headless', 'remote action', 'server'],
  vm_upload_file: ['vm', 'upload file', 'desktop to vm', 'file transfer'],
  vm_download_file: ['vm', 'download file', 'vm to desktop', 'file transfer'],

  // Vault / credentials
  vault_list: ['vault', 'password', 'credential', 'secret'],
  vault_get: ['vault', 'password', 'credential', 'secret'],
  vault_add: ['vault', 'password', 'credential', 'secret', 'api key'],
  vault_update: ['vault', 'password', 'credential'],
  vault_delete: ['vault', 'password', 'credential'],
  vault_get_credential: ['vault', 'password', 'credential', 'login'],
  vault_search: ['vault', 'password', 'credential'],
  vault_stats: ['vault'],

  // GUI / computer use
  computer_use: ['gui', 'click', 'screenshot', 'computer use', 'desktop control'],
  computer_use_agent: ['gui', 'computer use', 'desktop control'],
  click_at_coordinates: ['gui', 'click', 'mouse'],
  type_text: ['gui', 'type', 'keyboard'],
  send_hotkey: ['gui', 'hotkey', 'keyboard shortcut'],
  scroll: ['gui', 'scroll'],
  take_screenshot: ['gui', 'screenshot', 'screen capture'],
  capture_screen_to_file: ['gui', 'screenshot', 'screen capture'],
  find_and_click_text: ['gui', 'click', 'ocr'],
  find_text: ['gui', 'ocr', 'screen text'],
  drag_and_drop: ['gui', 'drag', 'mouse'],

  // Window management
  list_open_windows: ['window', 'windows', 'apps', 'processes'],
  bring_window_to_foreground: ['window', 'focus', 'switch app'],
  smart_bring_window_to_foreground: ['window', 'launch', 'open app'],
  set_window_bounds: ['window', 'resize', 'move window'],
  launch_application_or_uri: ['launch', 'open app', 'window'],

  // Streaming / capture
  capture_media: ['record', 'screen record', 'capture', 'audio record'],
  stop_capture: ['record', 'screen record', 'capture'],
  capture_screen: ['record', 'screen record', 'capture', 'screen recording'],
  stop_screen_capture: ['record', 'screen record', 'capture', 'stop recording'],
  capture_system_audio: ['system audio', 'audio capture', 'loopback', 'record audio'],
  stop_system_audio: ['system audio', 'audio capture', 'loopback', 'stop recording'],
  list_active_captures: ['record', 'capture'],
  stream_create: ['stream', 'streaming'],
  stream_close: ['stream', 'streaming'],
  stream_list: ['stream', 'streaming'],

  // Headless agents
  deploy_headless_agent: ['agent', 'background task', 'parallel', 'sub-agent'],
  get_headless_agent_status: ['agent', 'background task'],
  list_headless_agent_tasks: ['agent', 'background task'],
  bot_list: ['bot', 'agent', 'proactive', 'background task', 'status'],
  bot_get_status: ['bot', 'agent', 'proactive', 'background task', 'status'],
  bot_create: ['bot', 'agent', 'proactive', 'background task', 'automation'],
  bot_deploy: ['bot', 'agent', 'proactive', 'background task', 'cloud vm'],
  bot_pause: ['bot', 'agent', 'proactive', 'background task'],
  ask_bot: ['bot', 'agent', 'proactive', 'status', '@mention'],
  bot_ask: ['bot', 'agent', 'proactive', 'status', '@mention'],

  // MediaPipe
  mediapipe_pose: ['mediapipe', 'pose', 'body tracking'],
  mediapipe_hands: ['mediapipe', 'hand tracking'],
  mediapipe_face_detection: ['mediapipe', 'face detection'],
  mediapipe_face_mesh: ['mediapipe', 'face mesh'],
  mediapipe_segmentation: ['mediapipe', 'segmentation'],
  mediapipe_process_video: ['mediapipe', 'video analysis'],

  // ── Integration tools (gated by enabledIntegrations at runtime) ──

  // Gmail
  gmail_send_message: ['email', 'gmail', 'send email', 'compose'],
  gmail_list_messages: ['email', 'gmail', 'inbox', 'check email'],
  gmail_get_message_brief: ['email', 'gmail', 'read email'],
  gmail_get_message_full: ['email', 'gmail', 'read email'],
  gmail_get_messages_brief: ['email', 'gmail', 'inbox'],
  gmail_list_recent_brief: ['email', 'gmail', 'inbox', 'recent'],
  gmail_get_most_recent_full: ['email', 'gmail', 'inbox', 'recent'],
  gmail_modify_message: ['email', 'gmail', 'label'],
  gmail_delete_message: ['email', 'gmail', 'delete email'],
  gmail_archive_message: ['email', 'gmail', 'archive'],
  gmail_mark_as_read: ['email', 'gmail'],
  gmail_mark_as_unread: ['email', 'gmail'],
  gmail_download_attachment: ['email', 'gmail', 'attachment', 'download'],
  gmail_retrieve_messages_with_attachments: ['email', 'gmail', 'attachment', 'download'],
  // Google Calendar
  calendar_list_events: ['calendar', 'events', 'schedule', 'meetings'],
  calendar_create_event: ['calendar', 'schedule', 'meeting', 'event'],
  calendar_delete_event: ['calendar', 'cancel', 'delete event'],
  calendar_update_event: ['calendar', 'reschedule', 'update event'],
  // Google Drive / Sheets / Docs / Tasks
  drive_list_files: ['drive', 'google drive', 'files'],
  sheets_read_range: ['sheets', 'spreadsheet', 'google sheets'],
  sheets_create_spreadsheet: ['sheets', 'spreadsheet', 'google sheets'],
  sheets_write_range: ['sheets', 'spreadsheet', 'google sheets'],
  sheets_append_rows: ['sheets', 'spreadsheet', 'google sheets'],
  docs_get_document: ['docs', 'google docs', 'document'],
  docs_create_document: ['docs', 'google docs', 'document'],
  docs_write_text: ['docs', 'google docs', 'document'],
  tasks_list: ['tasks', 'google tasks', 'todo'],
  google_list_profiles: ['google', 'profile', 'account'],
  google_get_userinfo: ['google', 'profile', 'account'],

  // Outlook
  outlook_list_messages: ['email', 'outlook', 'inbox'],
  outlook_search_messages: ['email', 'outlook', 'search email'],
  outlook_send_mail: ['email', 'outlook', 'send email', 'compose'],
  outlook_get_message: ['email', 'outlook', 'read email'],
  outlook_list_recent_brief: ['email', 'outlook', 'inbox', 'recent'],
  outlook_reply_message: ['email', 'outlook', 'reply'],
  outlook_forward_message: ['email', 'outlook', 'forward'],
  outlook_create_draft: ['email', 'outlook', 'draft'],
  outlook_delete_message: ['email', 'outlook', 'delete email'],
  outlook_download_attachment: ['email', 'outlook', 'attachment'],
  outlook_retrieve_messages_with_attachments: ['email', 'outlook', 'attachment'],
  outlook_calendar_list_events: ['calendar', 'outlook', 'events', 'schedule'],
  outlook_calendar_create_event: ['calendar', 'outlook', 'meeting', 'event'],
  outlook_calendar_update_event: ['calendar', 'outlook', 'reschedule'],
  outlook_calendar_delete_event: ['calendar', 'outlook', 'cancel event'],

  // GitHub
  github_list_repos: ['github', 'repos', 'repositories'],
  github_get_repo: ['github', 'repo'],
  github_list_issues: ['github', 'issues', 'bugs'],
  github_create_issue: ['github', 'issue', 'bug report'],
  github_update_issue: ['github', 'issue'],
  github_list_pulls: ['github', 'pull request', 'pr'],
  github_get_pull: ['github', 'pull request', 'pr'],
  github_create_pull: ['github', 'pull request', 'pr'],
  github_merge_pull: ['github', 'merge', 'pr'],
  github_list_branches: ['github', 'branch'],
  github_create_branch: ['github', 'branch'],
  github_list_commits: ['github', 'commits', 'history'],
  github_search_code: ['github', 'search', 'code'],
  github_list_workflow_runs: ['github', 'actions', 'ci', 'workflow'],
  github_dispatch_workflow: ['github', 'actions', 'ci', 'workflow'],
  github_get_me: ['github', 'profile'],

  // WhatsApp
  whatsapp_send_message: ['whatsapp', 'message', 'chat'],
  whatsapp_send_media: ['whatsapp', 'media', 'photo'],
  whatsapp_send_voice_note: ['whatsapp', 'voice', 'audio'],
  whatsapp_voice_call: ['whatsapp', 'call', 'voice call'],

  // Telnyx
  telnyx_send_sms: ['sms', 'text message', 'telnyx'],
  telnyx_send_mms: ['mms', 'picture message', 'telnyx'],
  telnyx_voice_call: ['phone call', 'voice call', 'telnyx', 'call'],
  telnyx_send_voice_note: ['voice note', 'telnyx'],

  // Reddit
  reddit_search: ['reddit', 'search reddit'],
  reddit_view_subreddit: ['reddit', 'subreddit'],
  reddit_view_comments: ['reddit', 'comments'],
  reddit_create_post: ['reddit', 'post'],

  // X (Twitter)
  x_search_tweets: ['x', 'twitter', 'search tweets'],
  x_get_user_timeline: ['x', 'twitter', 'timeline'],
  x_get_tweet: ['x', 'twitter', 'tweet'],
  x_get_comments: ['x', 'twitter', 'comments', 'replies', 'mentions'],
  x_comment_on_post: ['x', 'twitter', 'comments', 'reply'],
  x_reply_to_comment: ['x', 'twitter', 'comments', 'reply'],
  x_like_comment: ['x', 'twitter', 'comments', 'likes'],
  x_post_tweet: ['x', 'twitter', 'post tweet', 'tweet'],
  x_delete_tweet: ['x', 'twitter', 'delete tweet'],
  x_send_dm: ['x', 'twitter', 'dm', 'direct message'],
  x_list_dms: ['x', 'twitter', 'dms', 'inbox'],
  x_get_user: ['x', 'twitter', 'user', 'profile'],
  x_list_followers: ['x', 'twitter', 'followers'],
  x_list_following: ['x', 'twitter', 'following'],

  // Discord
  discord_list_guilds: ['discord', 'servers'],
  discord_list_channels: ['discord', 'channels'],
  discord_read_messages: ['discord', 'messages', 'chat'],
  discord_send_dm: ['discord', 'dm', 'message'],
};

/**
 * Semantic hints to improve tool matching.
 * Add alternative phrases, common user queries, and related terms.
 */
const SEMANTIC_HINTS: Record<string, string[]> = {
  // Gmail / Google Profile
  google_list_profiles: ['list google users', 'list connected accounts', 'who am i', 'what google profiles do i have', 'google accounts'],
  google_get_userinfo: ['user profile', 'google profile', 'my account info', 'who am i', 'my email'],
  gmail_send_message: ['email', 'send mail', 'compose', 'draft', 'message'],
  gmail_list_messages: ['inbox', 'email list', 'check mail', 'emails'],
  gmail_get_message_brief: ['email summary', 'read email', 'message preview'],
  gmail_get_message_full: ['full email', 'email content', 'message body'],
  gmail_retrieve_messages_with_attachments: ['download attachments', 'email attachments', 'save attachments', 'get files from email', 'download files'],
  gmail_modify_message: ['label email', 'categorize', 'organize'],
  gmail_delete_message: ['remove email', 'trash', 'delete mail'],
  gmail_archive_message: ['archive mail', 'move from inbox'],
  gmail_mark_as_read: ['read email', 'mark read'],
  gmail_mark_as_unread: ['unread email', 'mark unread'],

  // Outlook
  outlook_get_me: ['outlook profile', 'microsoft account'],
  outlook_list_messages: ['outlook inbox', 'outlook emails'],
  outlook_search_messages: ['search outlook', 'find outlook email'],
  outlook_send_mail: ['send outlook', 'outlook compose'],
  outlook_get_message: ['read outlook email', 'outlook message detail'],
  outlook_list_recent_brief: ['recent outlook', 'latest outlook emails'],
  outlook_list_folders: ['outlook folders', 'mail folders'],
  outlook_reply_message: ['reply outlook', 'respond email'],
  outlook_forward_message: ['forward outlook', 'forward email'],
  outlook_create_draft: ['outlook draft', 'draft email'],
  outlook_mark_as_read: ['outlook read', 'mark read'],
  outlook_mark_as_unread: ['outlook unread', 'mark unread'],
  outlook_archive_message: ['outlook archive', 'archive email'],
  outlook_move_message: ['outlook move', 'move email folder'],
  outlook_delete_message: ['outlook delete', 'delete email'],
  outlook_download_attachment: ['outlook attachment', 'download outlook file'],
  outlook_retrieve_messages_with_attachments: ['outlook attachments', 'outlook download'],
  outlook_calendar_list_events: ['outlook calendar', 'outlook events', 'outlook meetings'],
  outlook_calendar_create_event: ['outlook new event', 'outlook meeting', 'create outlook event'],
  outlook_calendar_update_event: ['outlook update event', 'change outlook meeting'],
  outlook_calendar_delete_event: ['outlook cancel event', 'delete outlook meeting'],

  // GitHub
  github_get_me: ['github profile', 'github user'],
  github_list_repos: ['repositories', 'projects', 'code repos', 'my repos'],
  github_list_issues: ['issues', 'bugs', 'tickets', 'github issues'],
  github_create_issue: ['bug report', 'new issue', 'create ticket', 'report bug'],

  // Discord
  discord_list_guilds: ['discord servers', 'my servers', 'guilds', 'discord'],
  discord_list_channels: ['discord channels', 'server channels', 'text channels'],
  discord_list_dms: ['discord dms', 'direct messages', 'discord conversations', 'discord inbox'],
  discord_read_messages: ['read discord', 'discord messages', 'check discord', 'view messages', 'discord chat'],
  discord_send_dm: ['send discord message', 'dm on discord', 'direct message', 'message someone discord'],
  discord_add_reaction: ['react discord', 'emoji reaction', 'discord reaction', 'react to message'],

  // Reddit
  reddit_search: ['search reddit', 'find on reddit', 'reddit lookup', 'reddit query'],
  reddit_view_subreddit: ['subreddit posts', 'browse reddit', 'reddit feed', 'r/', 'subreddit'],
  reddit_view_comments: ['reddit comments', 'post comments', 'reddit discussion', 'read comments'],
  reddit_create_post: ['post on reddit', 'submit to reddit', 'create reddit post', 'new reddit post'],
  reddit_comment: ['reply on reddit', 'reddit comment', 'respond on reddit', 'comment reddit'],

  // X (Twitter)
  x_search_tweets: ['search x', 'search twitter', 'find tweets', 'twitter query'],
  x_get_user_timeline: ['user tweets', 'timeline', 'twitter timeline', 'x feed', 'tweets by user'],
  x_get_tweet: ['fetch tweet', 'get tweet', 'twitter status'],
  x_get_comments: ['twitter comments', 'x comments', 'tweet replies', 'post replies', 'read comments', 'get comments', 'mentions with filters'],
  x_comment_on_post: ['comment on post', 'reply to post', 'post a comment', 'comment on tweet', 'respond to x post'],
  x_reply_to_comment: ['reply to comment', 'reply to tweet comment', 'respond to x comment', 'reply on x'],
  x_like_comment: ['like comment', 'like tweet reply', 'like x comment', 'favorite reply'],
  x_post_tweet: ['tweet', 'post on twitter', 'post on x', 'send tweet', 'new tweet', 'reply tweet'],
  x_delete_tweet: ['delete tweet', 'remove tweet', 'untweet'],
  x_send_dm: ['twitter dm', 'x dm', 'direct message twitter', 'send twitter message'],
  x_list_dms: ['twitter inbox', 'x dms', 'twitter messages', 'list twitter dms'],
  x_get_user: ['twitter profile', 'x user', 'lookup twitter user', 'twitter handle'],
  x_list_followers: ['twitter followers', 'x followers', 'who follows'],
  x_list_following: ['twitter following', 'x following', 'who are they following'],

  // Browser
  // Files
  read_file: ['open file', 'view file', 'file content'],
  write_file: ['save file', 'create file', 'write to file'],
  file_read: ['read with line numbers', 'code file'],
  file_edit: ['modify file', 'change code', 'update file', 'edit code'],
  file_search: ['find files', 'locate', 'search documents'],
  list_directory: ['ls', 'folder contents', 'list files', 'directory listing'],
  create_directory: ['mkdir', 'new folder', 'create folder'],
  move_file: ['rename file', 'move file', 'mv'],
  copy_file: ['duplicate file', 'cp', 'copy'],
  delete_file: ['remove file', 'rm', 'delete'],
  open_file: ['launch file', 'open with app'],

  // System
  run_command: ['terminal', 'shell', 'execute', 'bash', 'cmd', 'command line'],
  run_python_script: ['python', 'script', 'py', 'python code'],
  run_node_script: ['nodejs', 'javascript', 'node script'],

  // Terminal
  terminal_create: ['new terminal', 'open terminal', 'start shell'],
  terminal_list: ['list terminals', 'active shells'],
  terminal_send_input: ['terminal input', 'shell command'],
  list_terminals: ['active terminals', 'background processes'],
  read_terminal: ['terminal output', 'shell output'],

  // Vision/Media
  analyze_media: ['analyze video', 'analyze audio', 'youtube', 'media analysis'],
  take_screenshot: ['screenshot', 'capture screen', 'screen capture'],
  capture_media: ['record', 'capture video', 'capture audio', 'record screen'],
  analyze_image: ['image analysis', 'vision', 'describe image'],
  analyze_current_screen: ['what on screen', 'screen analysis'],
  find_text: ['find text on screen', 'locate text on screen', 'get text coordinates', 'find label on screen', 'ocr screen text'],
  find_text_on_screen: ['legacy screen text finder', 'find text on screen', 'screen text coordinates'],
  find_and_click_text: ['find and click text', 'click text on screen', 'ocr click text', 'click matching label'],

  // Secure Vault (Credential Management)
  vault_list: ['list passwords', 'list credentials', 'saved passwords', 'vault entries', 'my credentials'],
  vault_get: ['get password', 'get credential', 'show credential', 'view password', 'retrieve secret'],
  vault_add: ['save password', 'store credential', 'add password', 'save secret', 'store api key'],
  vault_update: ['update password', 'change credential', 'update secret', 'change api key'],
  vault_delete: ['delete password', 'remove credential', 'delete secret'],
  vault_get_credential: ['use credential', 'login with saved password', 'get login info', 'use saved password'],
  vault_search: ['find password', 'search credentials', 'find credential for', 'lookup password'],
  vault_stats: ['vault statistics', 'how many passwords', 'credential count'],

  // Web Search
  web_search: ['google', 'search online', 'look up', 'find information', 'research'],

  // Web Extraction
  scrape_url: ['scrape url', 'extract url', 'web scrape', 'web extraction', 'get page content', 'tavily extract'],

  // Memory/Context
  search_past_conversations: ['history', 'previous chats', 'memory search'],
  get_conversation_context: ['conversation history', 'chat context'],
  browse_topic_collections: ['topics', 'collections', 'what have we discussed', 'conversation topics', 'history topics', 'topic list'],
  get_collection_detail: ['topic detail', 'collection segments', 'topic conversations', 'drill into topic'],
  synthesize_collection: ['summarize topic', 'what do you know about', 'everything about', 'topic summary', 'collection overview'],
  // Workflows
  search_local_workflows: ['workflows', 'automations', 'stuards'],
  run_automation: ['run workflow', 'execute automation'],
  invoke_workflow: ['call workflow', 'trigger workflow'],

  // Headless Agents
  deploy_headless_agent: ['background task', 'spawn agent', 'async task', 'sub-agent', 'parallel agents'],
  get_headless_agent_status: ['task status', 'agent status', 'background status'],
  list_headless_agent_tasks: ['list tasks', 'background tasks'],
  stop_headless_agent: ['cancel task', 'stop agent', 'abort task'],
  bot_list: ['list bots', 'show bots', 'what bots exist', 'proactive agents'],
  bot_get_status: ['bot status', 'status update from bot', 'what is this bot doing', 'bot tasks', 'recent bot runs'],
  bot_create: ['create bot', 'make a bot', 'new proactive agent', 'background bot', 'monitoring bot'],
  bot_deploy: ['deploy bot', 'start bot', 'run bot', 'deploy to vm', 'always on bot'],
  bot_pause: ['pause bot', 'stop bot', 'turn off bot', 'stop vm bot'],
  ask_bot: ['ask bot', '@tag bot', 'mention bot', 'ask bot for update', 'bot status update'],
  bot_ask: ['ask bot', '@tag bot', 'mention bot', 'ask bot for update', 'bot status update'],

  // UI
  custom_ui: ['dialog', 'prompt', 'interface', 'form', 'popup', 'pages', 'spa', 'multi-page', 'app', 'navigation'],
  show_table: ['display data', 'grid', 'results table'],
  show_choices: ['multiple choice', 'options', 'selection'],
  ask_confirmation: ['confirm', 'yes no', 'approval'],
  show_progress: ['progress bar', 'loading'],

  // Calendar/Tasks
  calendar_crud: ['calendar', 'events', 'schedule', 'appointments'],
  calendar_delete_event: ['delete calendar event', 'remove event', 'cancel meeting', 'cancel event', 'delete meeting'],
  calendar_update_event: ['update calendar event', 'edit event', 'reschedule meeting', 'modify event', 'change event time', 'recurring event'],
  task_crud: ['tasks', 'todos', 'reminders'],
  task_reminders: ['reminder', 'set reminder', 'recurring reminder', 'repeat reminder', 'notification', 'alert', 'sms reminder', 'whatsapp reminder', 'cloud reminder', 'notify me', 'text me', 'send me a reminder'],

  // Window Management
  list_open_windows: ['windows', 'active apps', 'running programs'],
  bring_window_to_foreground: ['focus window', 'switch window', 'activate window'],
  smart_bring_window_to_foreground: ['find window', 'open app', 'launch'],

  // Input
  send_hotkey: ['keyboard shortcut', 'hotkey', 'key combo'],
  computer_use: ['computer use', 'control computer', 'use the computer', 'gui automation', 'mouse and keyboard', 'click and type', 'desktop control'],
  computer_use_agent: ['autonomous computer use', 'take control', 'control my screen', 'do it for me', 'computer control loop', 'agentic computer use'],
  type_text: ['type', 'keyboard input', 'enter text'],
  click_at_coordinates: ['click', 'mouse click'],
  scroll: ['scroll page', 'scroll down', 'scroll up'],
  drag_and_drop: ['drag', 'move element'],

  // Orchestration
  wait: ['delay', 'pause', 'sleep', 'wait seconds'],
  run_sequential: ['sequence', 'chain', 'one by one'],
  run_parallel: ['parallel', 'concurrent', 'simultaneously'],

  // Telnyx Telephony
  telnyx_send_sms: ['send sms', 'text message', 'send text', 'sms'],
  telnyx_send_mms: ['send picture', 'send image', 'mms', 'picture message', 'image message', 'send photo'],
  telnyx_send_voice_note: ['voice note', 'audio message', 'voice message', 'send recording', 'voice memo'],
  telnyx_voice_call: ['voice call', 'ai call', 'realtime call', 'phone conversation', 'voip call', 'live call', 'phone call', 'call phone', 'make call', 'tts call', 'elevenlabs call', 'openai call', 'grok call', 'gemini call'],
  telnyx_list_voice_providers: ['voice providers', 'available providers', 'voice services'],
  telnyx_list_active_calls: ['active calls', 'ongoing calls', 'current calls'],
  telnyx_hangup_call: ['hangup', 'end call', 'disconnect call'],

  // WhatsApp
  whatsapp_send_message: ['whatsapp message', 'send whatsapp', 'wa message'],
  whatsapp_send_media: ['whatsapp image', 'whatsapp photo', 'send media whatsapp', 'whatsapp file'],
  whatsapp_send_reaction: ['react whatsapp', 'emoji reaction', 'whatsapp emoji'],
  whatsapp_send_voice_note: ['whatsapp voice', 'whatsapp audio', 'voice note whatsapp', 'audio message whatsapp'],
  whatsapp_transcribe_voice_note: ['transcribe voice', 'voice to text', 'speech to text whatsapp', 'transcribe audio'],
  whatsapp_send_template: ['whatsapp template', 'template message', 'approved template'],
  whatsapp_voice_call: ['whatsapp call', 'call whatsapp', 'voice call whatsapp', 'phone call whatsapp', 'ai call whatsapp'],
  whatsapp_make_call: ['call whatsapp basic', 'tts call whatsapp', 'speak to whatsapp'],
};

/**
 * Get semantic hints for a tool
 */
function getSemanticHints(toolName: string): string[] {
  const hints = SEMANTIC_HINTS[toolName];
  if (hints) return hints;
  // Generate default hints from tool name
  return [toolName.replace(/_/g, ' ')];
}

/**
 * Convert Zod schema to a simpler JSON representation for DB storage
 * Uses Zod 4's built-in z.toJSONSchema() for reliable conversion.
 */
function zodToJSON(schema: any): any {
  try {
    if (!schema) return {};
    const jsonSchema = z.toJSONSchema(schema, {
      target: 'draft-07',
      unrepresentable: 'any',
      io: 'input',
    });
    return jsonSchemaToSimple(jsonSchema);
  } catch {
    return "unknown";
  }
}

/** Convert a JSON Schema object to the simplified DB format */
function jsonSchemaToSimple(schema: any): any {
  if (!schema || typeof schema !== 'object') return 'unknown';

  if (schema.type === 'object' && schema.properties) {
    const result: any = {};
    for (const [key, prop] of Object.entries(schema.properties as Record<string, any>)) {
      const simple = jsonSchemaToSimple(prop);
      const isRequired = Array.isArray(schema.required) && schema.required.includes(key);
      result[key] = isRequired ? simple : (typeof simple === 'string' ? simple + '?' : simple);
    }
    return result;
  }
  if (schema.type === 'array') {
    return [jsonSchemaToSimple(schema.items)];
  }
  if (schema.type === 'string' && schema.enum) {
    return `enum(${schema.enum.join('|')})`;
  }
  if (schema.type === 'string') return 'string';
  if (schema.type === 'number' || schema.type === 'integer') return 'number';
  if (schema.type === 'boolean') return 'boolean';
  if (schema.anyOf || schema.oneOf) return 'union';
  if (schema.const !== undefined) return `literal(${schema.const})`;
  return 'unknown';
}

/**
 * Sync tool definitions to Supabase tool_embeddings table
 */
export async function syncToolsToSupabase(options: {
  force?: boolean;
  toolNames?: string[];
} = {}): Promise<ToolSyncResult> {
  // Ensure tools are registered
  initToolRegistry();

  const { force = false, toolNames } = options;
  const result: ToolSyncResult = { synced: 0, skipped: 0, errors: [] };

  const supabase = getSupabaseService();
  if (!supabase) {
    result.errors.push('Supabase service not available');
    return result;
  }

  // Get tools from registry
  const registry = getToolRegistry();
  let toolsToSync: any[] = [];

  if (toolNames && toolNames.length > 0) {
    for (const name of toolNames) {
      const tool = registry.get(name);
      if (tool) toolsToSync.push(tool);
    }
  } else {
    toolsToSync = Array.from(registry.values());
  }

  console.log(`[tool-sync] Found ${toolsToSync.length} tool definitions`);

  // Check which tools need updating
  const { data: existingTools, error: fetchError } = await supabase
    .from('tool_embeddings')
    .select('name, updated_at')
    .in('name', toolsToSync.map(t => t.id || t.name));

  if (fetchError) {
    result.errors.push(`Failed to fetch existing tools: ${fetchError.message}`);
    return result;
  }

  const existingMap = new Map(
    (existingTools || []).map((t: any) => [t.name, new Date(t.updated_at)])
  );

  const toUpdate = force
    ? toolsToSync
    : toolsToSync.filter(t => !existingMap.has(t.id || t.name));

  if (toUpdate.length === 0) {
    console.log('[tool-sync] All tools up to date');
    result.skipped = toolsToSync.length;
    return result;
  }

  console.log(`[tool-sync] Syncing ${toUpdate.length} tools (${force ? 'forced' : 'incremental'})...`);

  // Generate embeddings in batches
  for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
    const batch = toUpdate.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(toUpdate.length / BATCH_SIZE);

    console.log(`[tool-sync] Processing batch ${batchNum}/${totalBatches} (${batch.length} tools)...`);

    try {
      // Generate embeddings
      const texts = batch.map(t => {
        const id = t.id || t.name;
        const hints = getSemanticHints(id);
        return `${id}: ${t.description}${hints.length > 0 ? ' ' + hints.join(' ') : ''}`;
      });

      const { embeddings } = await embedMany({
        model: google.textEmbeddingModel(EMBEDDING_MODEL),
        values: texts,
      });

      // Prepare rows for upsert
      const rows = batch.map((tool, idx) => {
        const id = tool.id || tool.name;
        const metadata = getToolMetadata(id) || { category: 'Other', kind: 'local' };

        return {
          name: id,
          description: tool.description,
          category: metadata.category,
          kind: metadata.kind || 'local',
          schema: {
            args: zodToJSON(tool.inputSchema),
            output: zodToJSON(tool.outputSchema)
          },
          semantic_hints: getSemanticHints(id),
          semantic_groups: TOOL_SEMANTIC_GROUPS[id] || [],
          embedding: embeddings[idx],
          enabled: true,
          updated_at: new Date().toISOString(),
        };
      });

      // Upsert to Supabase
      const { error: upsertError } = await supabase
        .from('tool_embeddings')
        .upsert(rows, { onConflict: 'name' });

      if (upsertError) {
        const errorMsg = `Batch ${batchNum} failed: ${upsertError.message}`;
        console.error('[tool-sync]', errorMsg);
        result.errors.push(errorMsg);
      } else {
        result.synced += batch.length;
        console.log(`[tool-sync] Batch ${batchNum} synced successfully`);
      }
    } catch (error: any) {
      const errorMsg = `Batch ${batchNum} error: ${error.message}`;
      console.error('[tool-sync]', errorMsg);
      console.error('[tool-sync] Stack:', error.stack);
      result.errors.push(errorMsg);
    }
  }

  // Clear caches after sync
  clearToolCache();
  invalidateGroupCache();

  console.log(`[tool-sync] Sync complete: ${result.synced} synced, ${result.errors.length} errors`);
  return result;
}

/**
 * Disable tools that are no longer in registry
 */
export async function disableObsoleteTools(): Promise<number> {
  initToolRegistry();
  const supabase = getSupabaseService();
  if (!supabase) return 0;

  const validToolNames = Array.from(getToolRegistry().keys());

  // Get currently enabled tools that aren't in registry
  const { data: allEnabled } = await supabase
    .from('tool_embeddings')
    .select('name')
    .eq('enabled', true);

  const toDisable = (allEnabled || [])
    .filter((t: any) => !validToolNames.includes(t.name))
    .map((t: any) => t.name);

  if (toDisable.length === 0) {
    console.log('[tool-sync] No obsolete tools to disable');
    return 0;
  }

  const { error } = await supabase
    .from('tool_embeddings')
    .update({ enabled: false, updated_at: new Date().toISOString() })
    .in('name', toDisable);

  if (error) {
    console.error('[tool-sync] Failed to disable obsolete tools:', error.message);
    return 0;
  }

  console.log(`[tool-sync] Disabled ${toDisable.length} obsolete tools:`, toDisable);
  clearToolCache();

  return toDisable.length;
}

/**
 * Get sync status for all tools
 */
export async function getSyncStatus(): Promise<{
  definedCount: number;
  syncedCount: number;
  unsyncedTools: string[];
  obsoleteTools: string[];
}> {
  initToolRegistry();
  const supabase = getSupabaseService();
  const registry = getToolRegistry();
  const definedTools = Array.from(registry.keys());

  if (!supabase) {
    return {
      definedCount: definedTools.length,
      syncedCount: 0,
      unsyncedTools: definedTools,
      obsoleteTools: [],
    };
  }

  const definedNames = new Set(definedTools);

  const { data: syncedTools } = await supabase
    .from('tool_embeddings')
    .select('name, enabled');

  const syncedSet = new Set((syncedTools || []).map((t: any) => t.name));

  const unsyncedTools = definedTools.filter(t => !syncedSet.has(t));

  const obsoleteTools = (syncedTools || [])
    .filter((t: any) => !definedNames.has(t.name) && t.enabled)
    .map((t: any) => t.name);

  return {
    definedCount: definedTools.length,
    syncedCount: syncedSet.size,
    unsyncedTools,
    obsoleteTools,
  };
}

/**
 * Validate that all synced tools have valid embeddings
 */
export async function validateSyncedTools(): Promise<{
  valid: number;
  invalid: string[];
}> {
  const supabase = getSupabaseService();
  if (!supabase) {
    return { valid: 0, invalid: [] };
  }

  const { data: tools } = await supabase
    .from('tool_embeddings')
    .select('name, embedding')
    .eq('enabled', true);

  const invalid: string[] = [];
  let valid = 0;

  for (const tool of (tools || []) as any[]) {
    // Check if embedding exists and has correct dimension
    if (!tool.embedding || !Array.isArray(tool.embedding) || tool.embedding.length !== 3072) {
      invalid.push(tool.name);
    } else {
      valid++;
    }
  }

  return { valid, invalid };
}
