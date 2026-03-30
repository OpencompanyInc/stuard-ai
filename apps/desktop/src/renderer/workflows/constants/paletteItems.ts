import type { PaletteItem } from "../types";

export const TRIGGER_ITEMS: PaletteItem[] = [
  { k: 'trigger', t: 'app_start', label: 'On App Start', args: {} },
  { k: 'trigger', t: 'fs.watch', label: 'File/Folder Watch', args: { path: '', pattern: '*.*', recursive: true } },
  { k: 'trigger', t: 'schedule.cron', label: 'Schedule', args: { cron: '*/5 * * * *' } },
  { k: 'trigger', t: 'webhook', label: 'Webhook', args: { mode: 'cloud' } },
  { k: 'trigger', t: 'gmail.new_email', label: 'Gmail: New Email', args: { profile: 'default', labelIds: ['INBOX'] } },
  { k: 'trigger', t: 'drive.new_file', label: 'Drive: New File', args: { profile: 'default', onlyNew: true, includeFolders: false } },
  { k: 'trigger', t: 'hotkey', label: 'Hotkey', args: { accelerator: 'Ctrl+Alt+C' } },
  { k: 'trigger', t: 'hotkey.release', label: 'Hotkey Release', args: { accelerator: 'Ctrl+Alt+C' } },
  { k: 'trigger', t: 'outlook.calendar.poll', label: 'Outlook Calendar (poll)', args: { intervalSec: 60 } },
  { k: 'trigger', t: 'command.watch', label: 'Custom Script (watch)', args: { cmd: 'python', args: ['C:/path/to/script.py'] } }
];

export const LOCAL_TOOL_ITEMS: PaletteItem[] = [
  // Commands & apps
  { k: 'local.tool', t: 'run_command', label: 'Run Command', args: { command: 'echo hello', shell: 'auto', description: '' } },
  { k: 'local.tool', t: 'launch_application_or_uri', label: 'Launch App / URL', args: { target: 'C:/Path/To/App.exe', args: [] } },

  // Notifications
  { k: 'local.tool', t: 'send_notification', label: 'Send Notification', args: { title: 'Stuard AI', body: 'Hello!', severity: 'info' } },

  // HTTP / API
  {
    k: 'local.tool',
    t: 'http_request',
    label: 'HTTP Request',
    args: {
      url: 'https://httpbin.org/anything',
      method: 'GET',
      headers: {},
      query: {},
      bearer_token: '',
      timeout: 30,
      follow_redirects: true,
      verify_ssl: true,
      retries: 0,
    }
  },

  // Python & Node scripts
  {
    k: 'local.tool',
    t: 'run_python_script',
    label: 'Run Python Script',
    args: {
      code: 'print("Hello from Python!")',
      packages: [],
      timeoutMs: 60000
    }
  },
  {
    k: 'local.tool',
    t: 'run_node_script',
    label: 'Run Node.js Script',
    args: {
      code: 'console.log("Hello from Node!");',
      timeoutMs: 30000
    }
  },

  // Screen capture & media
  { k: 'local.tool', t: 'take_screenshot', label: 'Screenshot', args: {} },
  { k: 'local.tool', t: 'capture_media', label: 'Capture Photo', args: { kind: 'photo' } },
  { k: 'local.tool', t: 'capture_media', label: 'Record Video (fixed)', args: { kind: 'video', mode: 'fixed', duration: 5 } },
  { k: 'local.tool', t: 'capture_media', label: 'Record Video (until stop)', args: { kind: 'video', mode: 'until_stop', maxDuration: 300 } },
  { k: 'local.tool', t: 'capture_media', label: 'Record Audio (fixed)', args: { kind: 'audio', mode: 'fixed', duration: 5 } },
  { k: 'local.tool', t: 'capture_media', label: 'Record Audio (until stop)', args: { kind: 'audio', mode: 'until_stop', maxDuration: 300 } },
  { k: 'local.tool', t: 'capture_media', label: 'Record Audio (until silence)', args: { kind: 'audio', mode: 'silence', silenceThreshold: 5, silenceDuration: 2, maxDuration: 300 } },
  { k: 'local.tool', t: 'capture_media', label: 'Record Webcam + Mic (fixed)', args: { kind: 'audiovideo', mode: 'fixed', duration: 5 } },
  { k: 'local.tool', t: 'capture_media', label: 'Record Webcam + Mic (until stop)', args: { kind: 'audiovideo', mode: 'until_stop', maxDuration: 300 } },
  { k: 'local.tool', t: 'stop_capture', label: 'Stop Recording', args: { sessionId: '' } },

  // Screen recording & system audio
  { k: 'local.tool', t: 'capture_screen', label: 'Record Screen (fixed)', args: { mode: 'fixed', duration: 5, target: 'fullscreen', fps: 30, quality: 'medium' } },
  { k: 'local.tool', t: 'capture_screen', label: 'Record Screen (until stop)', args: { mode: 'until_stop', target: 'fullscreen', fps: 30, quality: 'medium' } },
  { k: 'local.tool', t: 'capture_screen', label: 'Record Screen + Audio', args: { mode: 'until_stop', target: 'fullscreen', includeSystemAudio: true, fps: 30, quality: 'medium' } },
  { k: 'local.tool', t: 'stop_screen_capture', label: 'Stop Screen Recording', args: { sessionId: '' } },
  { k: 'local.tool', t: 'capture_system_audio', label: 'Record System Audio (fixed)', args: { mode: 'fixed', duration: 5, format: 'wav' } },
  { k: 'local.tool', t: 'capture_system_audio', label: 'Record System Audio (until stop)', args: { mode: 'until_stop', format: 'wav' } },
  { k: 'local.tool', t: 'capture_system_audio', label: 'Record System Audio (until silence)', args: { mode: 'silence', silenceThreshold: 5, silenceDuration: 2, format: 'wav' } },
  { k: 'local.tool', t: 'stop_system_audio', label: 'Stop System Audio', args: { sessionId: '' } },

  // Mouse & keyboard
  { k: 'local.tool', t: 'click_at_coordinates', label: 'Click', args: { x: 100, y: 100, button: 'left' } },
  { k: 'local.tool', t: 'double_click_at_coordinates', label: 'Double Click', args: { x: 100, y: 100, button: 'left' } },
  { k: 'local.tool', t: 'scroll', label: 'Scroll', args: { deltaY: 120 } },
  { k: 'local.tool', t: 'drag_and_drop', label: 'Drag & Drop', args: { fromX: 100, fromY: 100, toX: 400, toY: 400 } },
  { k: 'local.tool', t: 'type_text', label: 'Type Text', args: { text: 'Hello', useClipboardFallback: false } },
  { k: 'local.tool', t: 'send_hotkey', label: 'Send Hotkey', args: { keys: ['windows', 'd'] } },

  // Window management
  { k: 'local.tool', t: 'list_open_windows', label: 'List Open Windows', args: {} },
  { k: 'local.tool', t: 'bring_window_to_foreground', label: 'Focus Window', args: { title: 'Untitled - Notepad' } },
  { k: 'local.tool', t: 'smart_bring_window_to_foreground', label: 'Smart Focus Window', args: { hint: 'Epic Games Launcher' } },
  { k: 'local.tool', t: 'get_window_info', label: 'Get Window Info', args: { title: 'Untitled - Notepad' } },
  { k: 'local.tool', t: 'set_window_bounds', label: 'Resize/Move Window', args: { title: 'Untitled - Notepad', bounds: { x: 0, y: 0, width: 900, height: 700 }, bringToTop: true } },

  // File system
  { k: 'local.tool', t: 'read_file', label: 'Read File', args: { path: 'C:/file.txt' } },
  { k: 'local.tool', t: 'write_file', label: 'Write File', args: { path: 'C:/file.txt', content: 'text', description: '', append: false } },
  { k: 'local.tool', t: 'create_directory', label: 'Create Directory', args: { path: 'C:/folder' } },
  { k: 'local.tool', t: 'list_directory', label: 'List Directory', args: { path: 'C:/folder' } },
  { k: 'local.tool', t: 'move_file', label: 'Move File', args: { src: 'C:/old.txt', dest: 'C:/new.txt' } },

  // Clipboard
  { k: 'local.tool', t: 'get_clipboard_content', label: 'Get Clipboard', args: {} },
  { k: 'local.tool', t: 'set_clipboard_content', label: 'Set Clipboard', args: { text: 'Hello' } },

  // Memory & groups
  { k: 'local.tool', t: 'memory_retrieval', label: 'Memory', args: {} },
  { k: 'local.tool', t: 'group_management', label: 'Groups', args: {} },

  // Utilities (no scripts needed)
  { k: 'local.tool', t: 'get_datetime', label: 'Get Date & Time', args: {} },
  { k: 'local.tool', t: 'math_eval', label: 'Math Expression', args: { expression: 'sqrt(16) + pow(2, 3)' } },
  { k: 'local.tool', t: 'generate_uuid', label: 'Generate UUID', args: {} },
  { k: 'local.tool', t: 'random_number', label: 'Random Number', args: { min: 1, max: 100 } },
  { k: 'local.tool', t: 'random_choice', label: 'Random Choice', args: { items: ['a', 'b', 'c'] } },
  { k: 'local.tool', t: 'sleep', label: 'Sleep / Delay', args: { seconds: 1 } },
  { k: 'local.tool', t: 'get_system_info', label: 'System Info', args: {} },
  { k: 'local.tool', t: 'get_env_var', label: 'Get Env Variable', args: { name: 'PATH' } },
  { k: 'local.tool', t: 'hash_string', label: 'Hash String', args: { text: 'hello', algorithm: 'sha256' } },
  { k: 'local.tool', t: 'base64_encode', label: 'Base64 Encode', args: { text: 'hello world' } },
  { k: 'local.tool', t: 'base64_decode', label: 'Base64 Decode', args: { encoded: 'aGVsbG8gd29ybGQ=' } },
  { k: 'local.tool', t: 'json_parse', label: 'Parse JSON', args: { text: '{"key": "value"}' } },
  { k: 'local.tool', t: 'regex_match', label: 'Regex Match', args: { text: 'hello world', pattern: '(\\w+)' } },
  { k: 'local.tool', t: 'regex_replace', label: 'Regex Replace', args: { text: 'hello world', pattern: 'world', replacement: 'there' } },

  // Orchestration & timing
  { k: 'local.tool', t: 'wait', label: 'Wait', args: { ms: 1000 } },
  { k: 'local.tool', t: 'run_sequential', label: 'Run Sequential (Local)', args: { steps: [], continueOnError: false } },
  { k: 'local.tool', t: 'run_parallel', label: 'Run Parallel (Local)', args: { steps: [] } },

  // Variables (persistent state across runs)
  { k: 'local.tool', t: 'set_variable', label: 'Set Variable', args: { name: 'myVar', value: '', type: 'string' } },
  { k: 'local.tool', t: 'get_variable', label: 'Get Variable', args: { name: 'myVar', default: '' } },
  { k: 'local.tool', t: 'toggle_variable', label: 'Toggle Boolean', args: { name: 'isActive' } },
  { k: 'local.tool', t: 'increment_variable', label: 'Increment Number', args: { name: 'counter', amount: 1 } },
  { k: 'local.tool', t: 'append_to_list', label: 'Append to List', args: { name: 'items', item: '' } },
  { k: 'local.tool', t: 'delete_variable', label: 'Delete Variable', args: { name: 'myVar' } },

  // Custom UI
  { k: 'local.tool', t: 'custom_ui', label: 'Show Custom UI', args: { title: 'My UI', component: 'function App() {\n  return html`<div class="p-6"><h2 class="text-white">Hello</h2></div>`;\n}', window: { width: 300, height: 200 } } },
  { k: 'local.tool', t: 'update_custom_ui', label: 'Update Custom UI', args: { id: '', data: {}, html: '' } },
  { k: 'local.tool', t: 'close_custom_ui', label: 'Close Custom UI', args: { id: '' } },
];

export const CLOUD_TOOL_ITEMS: PaletteItem[] = [
  // AI Agent node
  { k: 'cloud.tool', t: 'agent_node', label: 'AI Agent', args: { prompt: '', model: 'google/gemini-3.1-pro-preview', outputMode: 'text', maxSteps: 10 } },

  { k: 'cloud.tool', t: 'run_sequential', label: 'Run Sequential', args: { steps: [] } },
  { k: 'cloud.tool', t: 'run_parallel', label: 'Run Parallel', args: { steps: [] } },
  { k: 'cloud.tool', t: 'analyze_image', label: 'Analyze Image', args: {} },
  { k: 'cloud.tool', t: 'analyze_current_screen', label: 'Analyze Screen', args: {} },
  { k: 'cloud.tool', t: 'find_text', label: 'Find Text', args: { text: '', context: '', start: false, region: { x: 0, y: 0, width: 800, height: 600 }, caseSensitive: false } },
  { k: 'cloud.tool', t: 'find_and_click_text', label: 'Find & Click Text', args: { text: '', context: '', start: false, region: { x: 0, y: 0, width: 800, height: 600 }, caseSensitive: false } },
  { k: 'cloud.tool', t: 'google_cloud_ocr', label: 'OCR Image / File', args: { path: '', imageUrl: '', base64: '', mimeType: 'image/png', captureScreen: false, region: { x: 0, y: 0, width: 800, height: 600 }, ocrMode: 'document', languageHints: [], includeWordBoxes: true } },
  { k: 'cloud.tool', t: 'google_cloud_ocr', label: 'OCR Screenshot', args: { path: '', imageUrl: '', base64: '', mimeType: 'image/png', captureScreen: true, region: { x: 0, y: 0, width: 800, height: 600 }, ocrMode: 'text', languageHints: [], includeWordBoxes: true } },

  // Text-to-Speech
  { k: 'cloud.tool', t: 'text_to_speech', label: 'Text to Speech', args: { text: 'Hello!', voice_id: 'JBFqnCBsd6RMkjVDRZzb', model_id: 'eleven_multilingual_v2', language_code: '', speed: 1.0, format: 'mp3', save: true, play: false } },
  { k: 'cloud.tool', t: 'text_to_speech', label: 'Speak Text (Play)', args: { text: 'Hello!', voice_id: 'JBFqnCBsd6RMkjVDRZzb', model_id: 'eleven_multilingual_v2', language_code: '', speed: 1.0, format: 'mp3', save: false, play: true } },
  { k: 'cloud.tool', t: 'list_tts_voices', label: 'List TTS Voices', args: {} },
  { k: 'cloud.tool', t: 'get_tts_models', label: 'Get TTS Models', args: {} },
  { k: 'cloud.tool', t: 'elevenlabs_list_agents', label: 'List ElevenLabs Agents', args: { search: '', archived: false, show_only_owned_agents: true, page_size: 20 } },
  { k: 'cloud.tool', t: 'elevenlabs_get_signed_conversation_url', label: 'Get Conversation URL', args: { agent_id: '', include_conversation_id: true, branch_id: '' } },
  { k: 'cloud.tool', t: 'elevenlabs_get_webrtc_token', label: 'Get WebRTC Token', args: { agent_id: '', participant_name: '', branch_id: '' } },
  { k: 'cloud.tool', t: 'elevenlabs_list_conversations', label: 'List Conversations', args: { agent_id: '', search: '', branch_id: '', page_size: 20 } },
  {
    k: 'cloud.tool',
    t: 'cloud_ai_vision',
    label: 'AI Vision (structured)',
    args: {
      prompt: 'Detect people and summarize the scene.',
      imagePath: '',
      schema: {
        type: 'object',
        properties: {
          person_present: { type: 'boolean' },
          person_count: { type: 'number' },
          summary: { type: 'string' },
        },
      },
    },
  },
];

// Basic Math Operations (Scratch-like)
export const MATH_ITEMS: PaletteItem[] = [
  { k: 'local.tool', t: 'math_add', label: 'Add', args: { a: 0, b: 0 } },
  { k: 'local.tool', t: 'math_subtract', label: 'Subtract', args: { a: 0, b: 0 } },
  { k: 'local.tool', t: 'math_multiply', label: 'Multiply', args: { a: 0, b: 0 } },
  { k: 'local.tool', t: 'math_divide', label: 'Divide', args: { a: 0, b: 1 } },
  { k: 'local.tool', t: 'math_power', label: 'Power', args: { a: 2, b: 2 } },
  { k: 'local.tool', t: 'math_sqrt', label: 'Square Root', args: { x: 4 } },
  { k: 'local.tool', t: 'math_abs', label: 'Absolute', args: { x: -5 } },
  { k: 'local.tool', t: 'math_random', label: 'Random', args: { min: 1, max: 10 } },
  { k: 'local.tool', t: 'math_sum', label: 'Sum List', args: { x: [1, 2, 3] } },
  { k: 'local.tool', t: 'math_mean', label: 'Average', args: { x: [1, 2, 3] } },
  { k: 'local.tool', t: 'math_max', label: 'Max', args: { x: [1, 5, 3] } },
  { k: 'local.tool', t: 'math_min', label: 'Min', args: { x: [1, 5, 3] } },
  { k: 'local.tool', t: 'math_compare', label: 'Compare', args: { a: 5, b: 3, op: 'gt' } },
  { k: 'local.tool', t: 'math_range', label: 'Range', args: { start: 1, stop: 10 } },
];

// Browser Use (Playwright-powered browser automation)
export const BROWSER_USE_ITEMS: PaletteItem[] = [
  { k: 'local.tool', t: 'browser_use_status', label: 'Browser Status', args: {} },
  { k: 'local.tool', t: 'browser_use_navigate', label: 'Navigate to URL', args: { url: 'https://example.com', wait_until: 'domcontentloaded' } },
  { k: 'local.tool', t: 'browser_use_click', label: 'Click Element', args: { selector: '', text: '' } },
  { k: 'local.tool', t: 'browser_use_type', label: 'Type Text', args: { selector: '', text: '', clear: true } },
  { k: 'local.tool', t: 'browser_use_press_key', label: 'Press Key', args: { key: 'Enter', selector: '' } },
  { k: 'local.tool', t: 'browser_use_screenshot', label: 'Screenshot', args: { full_page: false } },
  { k: 'local.tool', t: 'browser_use_content', label: 'Get Page Content', args: { mode: 'text', max_length: 15000 } },
  { k: 'local.tool', t: 'browser_use_scroll', label: 'Scroll', args: { direction: 'down', amount: 500 } },
  { k: 'local.tool', t: 'browser_use_get_interactive_elements', label: 'Get Interactive Elements', args: {} },
  { k: 'local.tool', t: 'browser_use_fill_form', label: 'Fill Form', args: { fields: {}, submit: false } },
  { k: 'local.tool', t: 'browser_use_upload_file', label: 'Upload Local File', args: { selector: '', filePath: '' } },
  { k: 'local.tool', t: 'browser_use_hover', label: 'Hover Element', args: { selector: '', text: '' } },
  { k: 'local.tool', t: 'browser_use_select_option', label: 'Select Dropdown Option', args: { selector: '', label: '' } },
  { k: 'local.tool', t: 'browser_use_wait_for', label: 'Wait For Element', args: { selector: '', timeout: 10000 } },
  { k: 'local.tool', t: 'browser_use_wait_for', label: 'Wait For URL', args: { url_pattern: '', timeout: 10000 } },
  { k: 'local.tool', t: 'browser_use_tabs', label: 'List Tabs', args: { action: 'list' } },
  { k: 'local.tool', t: 'browser_use_tabs', label: 'New Tab', args: { action: 'new', url: '' } },
  { k: 'local.tool', t: 'browser_use_tabs', label: 'Switch Tab', args: { action: 'switch', index: 0 } },
  { k: 'local.tool', t: 'browser_use_tabs', label: 'Close Tab', args: { action: 'close', index: 0 } },
  { k: 'local.tool', t: 'browser_use_cookies', label: 'Get Cookies', args: { action: 'get' } },
  { k: 'local.tool', t: 'browser_use_cookies', label: 'Set Cookies', args: { action: 'set', cookies: [] } },
  { k: 'local.tool', t: 'browser_use_cookies', label: 'Clear Cookies', args: { action: 'clear' } },
  { k: 'local.tool', t: 'browser_use_cookies', label: 'Export Cookies', args: { action: 'export', path: '' } },
  { k: 'local.tool', t: 'browser_use_cookies', label: 'Import Cookies', args: { action: 'import', path: '' } },
  { k: 'local.tool', t: 'browser_use_execute_script', label: 'Execute JS Script', args: { script: 'return document.title;' } },
  { k: 'local.tool', t: 'browser_use_configure', label: 'Configure Browser', args: { mode: 'headed' } },
  { k: 'local.tool', t: 'browser_use_sync_chrome', label: 'Sync Chrome Cookies', args: { action: 'sync' } },
  { k: 'local.tool', t: 'browser_use_list_chrome_profiles', label: 'List Chrome Profiles', args: {} },
];

// Streaming — Debug / inspection only (streaming is via `stream: true` toggle on AI/HTTP/Script tools)
export const STREAM_ITEMS: PaletteItem[] = [
  { k: 'local.tool', t: 'stream_list', label: 'List Active Streams', args: {} },
  { k: 'local.tool', t: 'stream_get_status', label: 'Stream Status', args: { streamId: '' } },
];

export const INTEGRATION_ITEMS: PaletteItem[] = [
  { k: 'cloud.tool', t: 'drive_list_files', label: 'Google Drive', args: {} },
  { k: 'cloud.tool', t: 'calendar_list_events', label: 'Google Calendar', args: {} },
  { k: 'cloud.tool', t: 'gmail_send_message', label: 'Gmail Send', args: { to: [], subject: '', body: '' } },
  { k: 'cloud.tool', t: 'sheets_read_range', label: 'Google Sheets', args: { spreadsheetId: '', range: 'Sheet1!A1:B10' } },
  { k: 'cloud.tool', t: 'docs_get_document', label: 'Google Docs', args: { documentId: '' } },
  { k: 'cloud.tool', t: 'docs_create_document', label: 'Create Google Doc', args: { title: 'Untitled' } },
  { k: 'cloud.tool', t: 'docs_write_text', label: 'Write to Google Doc', args: { documentId: '', text: '' } },
  { k: 'cloud.tool', t: 'outlook_send_mail', label: 'Outlook Send', args: { to: [], subject: '', body: '' } },
  { k: 'cloud.tool', t: 'outlook_get_message', label: 'Outlook Read Message', args: { id: '' } },
  { k: 'cloud.tool', t: 'outlook_reply_message', label: 'Outlook Reply', args: { id: '', comment: '' } },
  { k: 'cloud.tool', t: 'outlook_forward_message', label: 'Outlook Forward', args: { id: '', to: [] } },
  { k: 'cloud.tool', t: 'outlook_download_attachment', label: 'Outlook Attachment', args: { messageId: '', attachmentId: '', path: '' } },
  { k: 'cloud.tool', t: 'outlook_calendar_list_events', label: 'Outlook Events', args: {} },
  { k: 'cloud.tool', t: 'outlook_calendar_create_event', label: 'Outlook New Event', args: { subject: '', start: '', end: '' } },
  { k: 'cloud.tool', t: 'facebook_list_pages', label: 'Facebook Pages', args: {} },
  { k: 'cloud.tool', t: 'facebook_create_page_post', label: 'Facebook Post', args: { page_id: '', message: '' } },
  { k: 'cloud.tool', t: 'instagram_list_media', label: 'Instagram Media', args: { limit: 10 } },
  { k: 'cloud.tool', t: 'instagram_publish_media', label: 'Instagram Publish', args: { media_type: 'IMAGE', image_url: '', caption: '' } },
  { k: 'cloud.tool', t: 'threads_list_posts', label: 'Threads Posts', args: { limit: 10 } },
  { k: 'cloud.tool', t: 'threads_publish_post', label: 'Threads Publish', args: { text: '' } },
  { k: 'cloud.tool', t: 'whatsapp_status', label: 'WhatsApp Status', args: {} },
  { k: 'cloud.tool', t: 'whatsapp_send_message', label: 'WhatsApp Message', args: { message: '' } },
  { k: 'cloud.tool', t: 'discord_list_guilds', label: 'Discord Servers', args: {} },
  { k: 'cloud.tool', t: 'discord_read_messages', label: 'Discord Messages', args: { channel_id: '' } },
  { k: 'cloud.tool', t: 'discord_send_dm', label: 'Discord DM', args: { channel_id: '', content: '' } },
  { k: 'cloud.tool', t: 'reddit_search', label: 'Reddit Search', args: { query: '' } },
  { k: 'cloud.tool', t: 'reddit_view_subreddit', label: 'Reddit Feed', args: { subreddit: '' } },
  { k: 'cloud.tool', t: 'reddit_create_post', label: 'Reddit Post', args: { subreddit: '', title: '', kind: 'self' } }
];
