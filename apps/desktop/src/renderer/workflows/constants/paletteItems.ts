import type { PaletteItem } from "../types";

export const TRIGGER_ITEMS: PaletteItem[] = [
  { k: 'trigger', t: 'manual', label: 'Manual (Click to Run)', args: {} },
  { k: 'trigger', t: 'app_start', label: 'On App Start', args: {} },
  { k: 'trigger', t: 'hotkey', label: 'Hotkey', args: { accelerator: 'Ctrl+Alt+K' } },
  { k: 'trigger', t: 'hotkey.release', label: 'Hotkey Release', args: { accelerator: 'Ctrl+Alt+K' } },
  { k: 'trigger', t: 'keystroke', label: 'Keystroke Sequence', args: { sequence: 'stuard' } },
  { k: 'trigger', t: 'function', label: 'Function (callable workflow)', args: {} },
  { k: 'trigger', t: 'webhook', label: 'Webhook', args: { mode: 'cloud' } },
  // ── Disabled pending Google CASA verification (push triggers need gmail.readonly / drive.readonly) ──
  // { k: 'trigger', t: 'gmail.new_email', label: 'Gmail: New Email', args: { profile: 'default', labelIds: ['INBOX'] } },
  // { k: 'trigger', t: 'drive.new_file', label: 'Drive: New File', args: { profile: 'default', onlyNew: true, includeFolders: false } },
  { k: 'trigger', t: 'schedule.cron', label: 'Schedule', args: { cron: '*/5 * * * *' } },
  { k: 'trigger', t: 'fs.watch', label: 'File/Folder Watch', args: { path: '', pattern: '*.*', recursive: true } },
  { k: 'trigger', t: 'command.watch', label: 'Custom Script (watch)', args: { cmd: 'python', args: ['script.py'] } },
];

export const LOCAL_TOOL_ITEMS: PaletteItem[] = [
  // ── Flow control ───────────────────────────────────────────────────────────
  { k: 'local.tool', t: 'wait', label: 'Wait / Delay', args: { ms: 1000 } },
  { k: 'local.tool', t: 'log', label: 'Log Message', args: { message: '' } },
  { k: 'local.tool', t: 'send_notification', label: 'Send Notification', args: { title: 'Stuard AI', body: 'Hello!', severity: 'info' } },
  { k: 'local.tool', t: 'return_value', label: 'Return Value', args: { value: '{{}}', success: true, message: '' } },
  { k: 'local.tool', t: 'end', label: 'End Flow', args: {} },
  { k: 'local.tool', t: 'run_sequential', label: 'Run Sequential', args: { steps: [], continueOnError: false } },
  { k: 'local.tool', t: 'run_parallel', label: 'Run Parallel', args: { steps: [] } },
  { k: 'local.tool', t: 'invoke_workflow', label: 'Invoke Workflow', args: { id: '' } },
  { k: 'local.tool', t: 'call_workflow', label: 'Call Workflow (external)', args: { workflowId: '', inputs: {} } },
  { k: 'local.tool', t: 'call_function', label: 'Call Function (internal)', args: { triggerId: '', inputs: {} } },
  { k: 'local.tool', t: 'call_workspace_function', label: 'Call Workspace Function', args: { path: '', inputs: {} } },

  // ── Variables ──────────────────────────────────────────────────────────────
  { k: 'local.tool', t: 'set_variable', label: 'Set Variable', args: { name: 'myVar', value: '', type: 'string' } },
  { k: 'local.tool', t: 'get_variable', label: 'Get Variable', args: { name: 'myVar', default: '' } },
  { k: 'local.tool', t: 'toggle_variable', label: 'Toggle Boolean', args: { name: 'isActive' } },
  { k: 'local.tool', t: 'increment_variable', label: 'Increment Number', args: { name: 'counter', amount: 1 } },
  { k: 'local.tool', t: 'append_to_list', label: 'Append to List', args: { name: 'items', item: '' } },
  { k: 'local.tool', t: 'delete_variable', label: 'Delete Variable', args: { name: 'myVar' } },

  // ── Input: mouse, keyboard, clipboard ──────────────────────────────────────
  { k: 'local.tool', t: 'click_at_coordinates', label: 'Click', args: { x: 100, y: 100, button: 'left' } },
  { k: 'local.tool', t: 'double_click_at_coordinates', label: 'Double Click', args: { x: 100, y: 100 } },
  { k: 'local.tool', t: 'move_cursor', label: 'Move Cursor', args: { x: 100, y: 100, duration: 0 } },
  { k: 'local.tool', t: 'scroll', label: 'Scroll', args: { deltaY: 120 } },
  { k: 'local.tool', t: 'drag_and_drop', label: 'Drag & Drop', args: { fromX: 100, fromY: 100, toX: 400, toY: 400 } },
  { k: 'local.tool', t: 'get_mouse_position', label: 'Get Mouse Position', args: {} },
  { k: 'local.tool', t: 'type_text', label: 'Type Text', args: { text: '', useClipboardFallback: false } },
  { k: 'local.tool', t: 'send_hotkey', label: 'Send Hotkey', args: { keys: ['ctrl', 'c'] } },
  { k: 'local.tool', t: 'get_clipboard_content', label: 'Get Clipboard', args: {} },
  { k: 'local.tool', t: 'set_clipboard_content', label: 'Set Clipboard', args: { text: '' } },

  // ── Media & screen capture ─────────────────────────────────────────────────
  { k: 'local.tool', t: 'take_screenshot', label: 'Screenshot', args: {} },
  { k: 'local.tool', t: 'capture_media', label: 'Capture Photo', args: { kind: 'photo' } },
  { k: 'local.tool', t: 'capture_media', label: 'Record Webcam', args: { kind: 'video', mode: 'until_stop', sessionId: 'rec' } },
  { k: 'local.tool', t: 'capture_media', label: 'Record Mic Audio', args: { kind: 'audio', mode: 'until_stop', sessionId: 'rec' } },
  { k: 'local.tool', t: 'capture_media', label: 'Record Webcam + Mic', args: { kind: 'audiovideo', mode: 'until_stop', sessionId: 'rec' } },
  { k: 'local.tool', t: 'capture_screen', label: 'Record Screen', args: { mode: 'until_stop', target: 'fullscreen', fps: 30, quality: 'medium' } },
  { k: 'local.tool', t: 'capture_system_audio', label: 'Record System Audio', args: { mode: 'until_stop', format: 'wav' } },
  { k: 'local.tool', t: 'stop_capture', label: 'Stop Webcam/Mic', args: { sessionId: 'rec' } },
  { k: 'local.tool', t: 'stop_screen_capture', label: 'Stop Screen', args: { sessionId: '' } },
  { k: 'local.tool', t: 'stop_system_audio', label: 'Stop System Audio', args: { sessionId: '' } },

  // ── Files (local + workflow workspace) ─────────────────────────────────────
  { k: 'local.tool', t: 'read_file', label: 'Read File', args: { path: '' } },
  { k: 'local.tool', t: 'write_file', label: 'Write File', args: { path: '', content: '', description: '', append: false } },
  { k: 'local.tool', t: 'list_directory', label: 'List Directory', args: { path: '' } },
  { k: 'local.tool', t: 'glob', label: 'Find Files', args: { pattern: '*.txt', root: '' } },
  { k: 'local.tool', t: 'grep', label: 'Search In Files', args: { path: '', pattern: '' } },
  { k: 'local.tool', t: 'create_directory', label: 'Create Folder', args: { path: '' } },
  { k: 'local.tool', t: 'move_file', label: 'Move File', args: { src: '', dest: '' } },
  { k: 'local.tool', t: 'run_command', label: 'Run Command', args: { command: 'echo hello', shell: 'auto', isPermissionRequired: false, description: '' } },
  { k: 'local.tool', t: 'launch_application_or_uri', label: 'Launch App / URL', args: { target: '', args: [] } },
  { k: 'local.tool', t: 'workspace_read_file', label: 'Read Workspace File', args: { path: 'data/config.json' } },
  { k: 'local.tool', t: 'workspace_write_file', label: 'Write Workspace File', args: { path: 'data/config.json', content: '{}', description: 'Save config.json in the workflow workspace.' } },
  { k: 'local.tool', t: 'workspace_list_files', label: 'List Workspace Files', args: { path: '' } },
  { k: 'local.tool', t: 'workspace_create_folder', label: 'Create Workspace Folder', args: { path: 'data/exports' } },
  { k: 'local.tool', t: 'workspace_delete_file', label: 'Delete Workspace File', args: { path: '' } },
  { k: 'local.tool', t: 'workspace_get_info', label: 'Get Workspace Info', args: {} },

  // ── Scripts ────────────────────────────────────────────────────────────────
  { k: 'local.tool', t: 'run_python_script', label: 'Python Script', args: { code: 'print("Hello!")', packages: [], timeoutMs: 60000 } },
  { k: 'local.tool', t: 'run_node_script', label: 'Node.js Script', args: { code: 'console.log("Hello!")', timeoutMs: 30000 } },

  // ── Utilities ──────────────────────────────────────────────────────────────
  { k: 'local.tool', t: 'get_datetime', label: 'Get Date & Time', args: {} },
  { k: 'local.tool', t: 'math_eval', label: 'Math Expression', args: { expression: 'sqrt(16) + pow(2, 3)' } },
  { k: 'local.tool', t: 'generate_uuid', label: 'Generate UUID', args: {} },
  { k: 'local.tool', t: 'random_number', label: 'Random Number', args: { min: 1, max: 100 } },
  { k: 'local.tool', t: 'random_choice', label: 'Random Choice', args: { items: ['a', 'b', 'c'] } },
  { k: 'local.tool', t: 'sleep', label: 'Sleep / Delay', args: { seconds: 1 } },
  { k: 'local.tool', t: 'get_system_info', label: 'System Info', args: {} },
  { k: 'local.tool', t: 'get_env_var', label: 'Get Env Variable', args: { name: 'PATH' } },
  { k: 'local.tool', t: 'hash_string', label: 'Hash String', args: { text: '', algorithm: 'sha256' } },
  { k: 'local.tool', t: 'base64_encode', label: 'Base64 Encode', args: { text: '' } },
  { k: 'local.tool', t: 'base64_decode', label: 'Base64 Decode', args: { encoded: '' } },
  { k: 'local.tool', t: 'json_parse', label: 'Parse JSON', args: { text: '{}' } },
  { k: 'local.tool', t: 'json_stringify', label: 'Stringify JSON', args: { data: {}, pretty: true } },
  { k: 'local.tool', t: 'regex_match', label: 'Regex Match', args: { text: '', pattern: '' } },
  { k: 'local.tool', t: 'regex_replace', label: 'Regex Replace', args: { text: '', pattern: '', replacement: '' } },

  // ── Memory & groups ────────────────────────────────────────────────────────
  { k: 'local.tool', t: 'memory_retrieval', label: 'Memory', args: {} },
  { k: 'local.tool', t: 'group_management', label: 'Groups', args: {} },

  // ── HTTP / API ─────────────────────────────────────────────────────────────
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
    },
  },

  // ── Database (local SQL / KV) ──────────────────────────────────────────────
  { k: 'local.tool', t: 'db_store', label: 'Save Document', args: { table: 'my_collection', data: {} } },
  { k: 'local.tool', t: 'db_retrieve', label: 'Get Document', args: { table: 'my_collection', id: '' } },
  { k: 'local.tool', t: 'db_search', label: 'Search Documents', args: { table: 'my_collection', filters: {}, limit: 100 } },
  { k: 'local.tool', t: 'db_delete', label: 'Delete Document', args: { table: 'my_collection', id: '' } },
  { k: 'local.tool', t: 'db_list_tables', label: 'List All Data', args: {} },
  { k: 'local.tool', t: 'db_query', label: 'SQL Query', args: { query: 'SELECT * FROM my_table LIMIT 100' } },

  // ── Custom UI ──────────────────────────────────────────────────────────────
  { k: 'local.tool', t: 'custom_ui', label: 'Show Custom UI', args: { title: 'My UI', component: 'function App() {\n  return html`<div class="p-6"><h2 class="text-white">Hello</h2></div>`;\n}', window: { width: 300, height: 200 } } },
  { k: 'local.tool', t: 'update_custom_ui', label: 'Update Custom UI', args: { id: '', data: {}, html: '' } },
  { k: 'local.tool', t: 'close_custom_ui', label: 'Close Custom UI', args: { id: '' } },

  // ── Windows ────────────────────────────────────────────────────────────────
  { k: 'local.tool', t: 'list_open_windows', label: 'List Windows', args: {} },
  { k: 'local.tool', t: 'bring_window_to_foreground', label: 'Focus Window', args: { title: '' } },
  { k: 'local.tool', t: 'smart_bring_window_to_foreground', label: 'Smart Focus', args: { hint: '' } },
  { k: 'local.tool', t: 'get_window_info', label: 'Get Window Info', args: { title: '' } },
  { k: 'local.tool', t: 'set_window_bounds', label: 'Resize / Move', args: { title: '', bounds: { x: 0, y: 0, width: 900, height: 700 }, bringToTop: true } },

  // ── Desktop controls (volume, brightness, bluetooth, wallpaper, power) ────
  { k: 'local.tool', t: 'describe_desktop_control_capabilities', label: 'Check Capabilities', args: {} },
  { k: 'local.tool', t: 'get_system_volume', label: 'Get Volume', args: {} },
  { k: 'local.tool', t: 'set_system_volume', label: 'Set Volume', args: { level: 50 } },
  { k: 'local.tool', t: 'get_display_brightness', label: 'Get Brightness', args: {} },
  { k: 'local.tool', t: 'set_display_brightness', label: 'Set Brightness', args: { percent: 75 } },
  { k: 'local.tool', t: 'list_bluetooth_devices', label: 'List Bluetooth Devices', args: {} },
  { k: 'local.tool', t: 'connect_bluetooth_device', label: 'Connect Bluetooth', args: { address: '' } },
  { k: 'local.tool', t: 'disconnect_bluetooth_device', label: 'Disconnect Bluetooth', args: { address: '' } },
  { k: 'local.tool', t: 'get_power_status', label: 'Battery / Power Status', args: {} },
  { k: 'local.tool', t: 'get_desktop_wallpaper', label: 'Get Wallpaper', args: {} },
  { k: 'local.tool', t: 'set_desktop_wallpaper', label: 'Set Wallpaper', args: { path: '', style: 'fill' } },

  // ── FFmpeg ─────────────────────────────────────────────────────────────────
  { k: 'local.tool', t: 'ffmpeg_status', label: 'FFmpeg Status', args: {} },
  { k: 'local.tool', t: 'ffmpeg_setup', label: 'Install FFmpeg', args: {} },
  { k: 'local.tool', t: 'ffmpeg_probe_media', label: 'Probe File (Metadata)', args: { inputPath: '' } },
  { k: 'local.tool', t: 'ffmpeg_convert_media', label: 'Convert Media', args: { inputPath: '', outputPath: '', overwrite: true } },
  { k: 'local.tool', t: 'ffmpeg_extract_audio', label: 'Extract Audio', args: { inputPath: '', outputPath: '', overwrite: true } },
  { k: 'local.tool', t: 'ffmpeg_trim_media', label: 'Trim Media', args: { inputPath: '', outputPath: '', startSeconds: 0, durationSeconds: 30, overwrite: true } },
  { k: 'local.tool', t: 'ffmpeg_extract_frames', label: 'Extract Frames', args: { inputPath: '', outputPattern: '', fps: 1, overwrite: true } },
  { k: 'local.tool', t: 'ffmpeg_run', label: 'Custom FFmpeg Command', args: { args: [] } },

  // ── MediaPipe (CV) ─────────────────────────────────────────────────────────
  { k: 'local.tool', t: 'mediapipe_pose', label: 'Pose Estimation', args: { imagePath: '', drawLandmarks: true, modelComplexity: 1, minDetectionConfidence: 0.5 } },
  { k: 'local.tool', t: 'mediapipe_hands', label: 'Hand Tracking', args: { imagePath: '', drawLandmarks: true, maxNumHands: 2, minDetectionConfidence: 0.5 } },
  { k: 'local.tool', t: 'mediapipe_face_detection', label: 'Face Detection', args: { imagePath: '', drawDetections: true, modelSelection: 0, minDetectionConfidence: 0.5 } },
  { k: 'local.tool', t: 'mediapipe_face_mesh', label: 'Face Mesh (468pt)', args: { imagePath: '', drawLandmarks: true, maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: 0.5 } },
  { k: 'local.tool', t: 'mediapipe_segmentation', label: 'Background Removal', args: { imagePath: '', threshold: 0.5, blurBackground: false } },
  { k: 'local.tool', t: 'mediapipe_holistic', label: 'Holistic (All-in-One)', args: { imagePath: '', drawLandmarks: true, modelComplexity: 1, minDetectionConfidence: 0.5 } },
  { k: 'local.tool', t: 'mediapipe_process_video', label: 'Process Video', args: { videoPath: '', task: 'pose', drawLandmarks: true, maxFrames: 0, sampleEveryN: 1 } },

  // ── Ollama (local AI) ──────────────────────────────────────────────────────
  { k: 'local.tool', t: 'ollama_status', label: 'Check Status', args: {} },
  { k: 'local.tool', t: 'ollama_agent', label: 'Local AI Agent', args: { model: 'llama3.2', prompt: '', outputMode: 'text', toolMode: 'curated', maxSteps: 8 } },
  { k: 'local.tool', t: 'ollama_embeddings', label: 'Embeddings', args: { model: 'nomic-embed-text', input: '' } },
  { k: 'local.tool', t: 'ollama_models', label: 'Manage Models', args: { action: 'list' } },
];

export const CLOUD_TOOL_ITEMS: PaletteItem[] = [
  // AI Agent node
  { k: 'cloud.tool', t: 'agent_node', label: 'AI Agent', args: { prompt: '', model: 'google/gemini-3.1-pro-preview', outputMode: 'text', maxSteps: 10 } },

  // Flow control (cloud)
  { k: 'cloud.tool', t: 'run_sequential', label: 'Run Sequential', args: { steps: [] } },
  { k: 'cloud.tool', t: 'run_parallel', label: 'Run Parallel', args: { steps: [] } },

  // Unified AI inference — text, image, screen, audio, video, PDF — pick model + media in smart args.
  { k: 'cloud.tool', t: 'ai_inference', label: 'AI Inference', args: { prompt: 'Summarize this', input: '', sources: [], mode: 'text', model: 'google/gemini-3.1-pro-preview' } },
  { k: 'cloud.tool', t: 'ai_inference', label: 'Analyze Screen', args: { prompt: 'Describe what is currently on the screen — UI elements, text, and any relevant context.', sources: [{ captureScreen: true }], mode: 'text', model: 'google/gemini-3.1-pro-preview' } },
  { k: 'cloud.tool', t: 'ai_inference', label: 'AI Vision (JSON)', args: { prompt: 'Extract structured data from this image.', sources: [{ path: '' }], mode: 'json', schema: { description: 'string', objects: 'string[]' }, model: 'google/gemini-3.1-pro-preview' } },

  // Vision helpers
  { k: 'cloud.tool', t: 'find_text', label: 'Find Text', args: { text: '', context: '', start: false, region: { x: 0, y: 0, width: 800, height: 600 }, caseSensitive: false } },
  { k: 'cloud.tool', t: 'find_and_click_text', label: 'Find & Click Text', args: { text: '', context: '', start: false, region: { x: 0, y: 0, width: 800, height: 600 }, caseSensitive: false } },
  { k: 'cloud.tool', t: 'google_cloud_ocr', label: 'OCR (Image or Screen)', args: { path: '', imageUrl: '', base64: '', mimeType: 'image/png', captureScreen: false, region: { x: 0, y: 0, width: 800, height: 600 }, ocrMode: 'document', languageHints: [], includeWordBoxes: true } },
  { k: 'cloud.tool', t: 'generate_image', label: 'Generate Image', args: { prompt: '', model: 'gpt-image-1', size: 'auto', aspect_ratio: 'auto', quality: 'auto', n: 1, format: 'png', background: 'auto' } },

  // Web search
  { k: 'cloud.tool', t: 'web_search', label: 'Web Search', args: { query: 'latest AI news' } },
  { k: 'cloud.tool', t: 'scrape_url', label: 'Scrape URL', args: { urls: ['https://example.com'] } },

  // Cloud storage
  { k: 'cloud.tool', t: 'cloud_storage_upload', label: 'Upload File', args: { path: '', folder: '', visibility: 'private' } },
  { k: 'cloud.tool', t: 'cloud_storage_get_url', label: 'Get File URL', args: { objectName: '', visibility: 'private' } },
  { k: 'cloud.tool', t: 'cloud_storage_list', label: 'List Files', args: { prefix: '', limit: 100 } },
  { k: 'cloud.tool', t: 'cloud_storage_delete', label: 'Delete File', args: { objectName: '' } },
  { k: 'cloud.tool', t: 'cloud_storage_set_visibility', label: 'Set Visibility', args: { objectName: '', visibility: 'public' } },

  // Text-to-Speech / ElevenLabs Voice
  { k: 'cloud.tool', t: 'text_to_speech', label: 'Text to Speech', args: { text: 'Hello!', voice_id: 'JBFqnCBsd6RMkjVDRZzb', model_id: 'eleven_multilingual_v2', language_code: '', speed: 1.0, format: 'mp3', save: true, play: false } },
  { k: 'cloud.tool', t: 'list_tts_voices', label: 'List TTS Voices', args: {} },
  { k: 'cloud.tool', t: 'get_tts_models', label: 'Get TTS Models', args: {} },
  { k: 'cloud.tool', t: 'elevenlabs_list_agents', label: 'List Live Agents', args: { search: '', archived: false, show_only_owned_agents: true, page_size: 20 } },
  { k: 'cloud.tool', t: 'elevenlabs_get_signed_conversation_url', label: 'Get Live Session URL', args: { agent_id: '', include_conversation_id: true, branch_id: '' } },
  { k: 'cloud.tool', t: 'elevenlabs_get_webrtc_token', label: 'Get WebRTC Token', args: { agent_id: '', participant_name: '', branch_id: '' } },
  { k: 'cloud.tool', t: 'elevenlabs_list_conversations', label: 'List Voice Sessions', args: { agent_id: '', search: '', branch_id: '', page_size: 20 } },
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

// Browser automation
export const BROWSER_USE_ITEMS: PaletteItem[] = [
  { k: 'local.tool', t: 'browser_use_status', label: 'Browser Status', args: {} },
  { k: 'local.tool', t: 'browser_use_navigate', label: 'Navigate to URL', args: { url: 'https://example.com', wait_until: 'domcontentloaded' } },
  { k: 'local.tool', t: 'browser_use_click', label: 'Click Element', args: { selector: '', text: '' } },
  { k: 'local.tool', t: 'browser_use_type', label: 'Type Text', args: { selector: '', text: '', clear: true } },
  { k: 'local.tool', t: 'browser_use_press_key', label: 'Press Key', args: { key: 'Enter', selector: '' } },
  { k: 'local.tool', t: 'browser_use_screenshot', label: 'Screenshot', args: { full_page: false } },
  { k: 'local.tool', t: 'browser_use_content', label: 'Get Page Content', args: { mode: 'text', max_length: 15000 } },
  { k: 'local.tool', t: 'browser_use_scroll', label: 'Scroll Page', args: { direction: 'down', amount: 500 } },
  { k: 'local.tool', t: 'browser_use_get_interactive_elements', label: 'Get Interactive Elements', args: {} },
  { k: 'local.tool', t: 'browser_use_fill_form', label: 'Fill Form', args: { fields: {}, submit: false } },
  { k: 'local.tool', t: 'browser_use_upload_file', label: 'Upload Local File', args: { selector: '', filePath: '' } },
  { k: 'local.tool', t: 'browser_use_hover', label: 'Hover Element', args: { selector: '', text: '' } },
  { k: 'local.tool', t: 'browser_use_get_dropdown_options', label: 'Read Dropdown Options', args: { selector: '' } },
  { k: 'local.tool', t: 'browser_use_select_option', label: 'Select Dropdown', args: { selector: '', label: '' } },
  { k: 'local.tool', t: 'browser_use_wait_for', label: 'Wait For Element', args: { selector: '', timeout: 10000 } },
  { k: 'local.tool', t: 'browser_use_tabs', label: 'Manage Tabs', args: { action: 'list' } },
  { k: 'local.tool', t: 'browser_use_cookies', label: 'Manage Cookies', args: { action: 'get' } },
  { k: 'local.tool', t: 'browser_use_execute_script', label: 'Execute JS Script', args: { script: 'return document.title;' } },
  { k: 'local.tool', t: 'browser_use_configure', label: 'Configure Browser', args: { mode: 'headed' } },
  { k: 'local.tool', t: 'browser_use_sync_chrome', label: 'Sync Chrome Cookies', args: {} },
  { k: 'local.tool', t: 'browser_use_list_chrome_profiles', label: 'List Chrome Profiles', args: {} },
];

// Streaming — Debug / inspection only (streaming is via `stream: true` toggle on AI/HTTP/Script tools)
export const STREAM_ITEMS: PaletteItem[] = [
  { k: 'local.tool', t: 'stream_list', label: 'List Active Streams', args: {} },
  { k: 'local.tool', t: 'stream_get_status', label: 'Stream Status', args: { streamId: '' } },
];

export const INTEGRATION_ITEMS: PaletteItem[] = [
  // ── Gmail ─────────────────────────────────────────────────────────────────
  { k: 'cloud.tool', t: 'gmail_send_message', label: 'Gmail: Send Email', args: { to: [], subject: '', body: '', contentType: 'text/plain', from: '', profile: '' } },
  // ── Disabled pending Google CASA verification (gmail.readonly / gmail.modify restricted scopes) ──

  // ── Google Drive ──────────────────────────────────────────────────────────
  // ── Disabled pending Google CASA verification (drive / drive.readonly restricted scopes) ──
  // { k: 'cloud.tool', t: 'drive_list_files', label: 'Drive: List Files', args: { pageSize: 20 } },
  // { k: 'cloud.tool', t: 'drive_search_files', label: 'Drive: Search Files', args: { query: '', pageSize: 20, fileType: 'any' } },
  { k: 'cloud.tool', t: 'drive_get_file', label: 'Drive: Get File Metadata', args: { fileId: '' } },
  { k: 'cloud.tool', t: 'drive_create_file', label: 'Drive: Create File', args: { name: 'file.txt', content: '', mimeType: 'text/plain' } },
  { k: 'cloud.tool', t: 'drive_create_folder', label: 'Drive: Create Folder', args: { name: 'New Folder' } },
  { k: 'cloud.tool', t: 'drive_upload_file', label: 'Drive: Upload Local File', args: { path: '' } },
  { k: 'cloud.tool', t: 'drive_download_file', label: 'Drive: Download to Local', args: { fileId: '', path: '' } },
  { k: 'cloud.tool', t: 'drive_export_file', label: 'Drive: Export Google File', args: { fileId: '', path: '', exportMimeType: 'application/pdf' } },
  { k: 'cloud.tool', t: 'drive_update_file', label: 'Drive: Update File Content', args: { fileId: '', path: '' } },
  { k: 'cloud.tool', t: 'drive_move_file', label: 'Drive: Move File', args: { fileId: '', newParentId: '' } },
  { k: 'cloud.tool', t: 'drive_copy_file', label: 'Drive: Copy File', args: { fileId: '' } },
  { k: 'cloud.tool', t: 'drive_rename_file', label: 'Drive: Rename File', args: { fileId: '', name: '' } },
  { k: 'cloud.tool', t: 'drive_trash_file', label: 'Drive: Trash File', args: { fileId: '' } },
  { k: 'cloud.tool', t: 'drive_delete_file', label: 'Drive: Delete File (Permanent)', args: { fileId: '' } },
  { k: 'cloud.tool', t: 'drive_share_file', label: 'Drive: Share File', args: { fileId: '', role: 'reader', type: 'user', emailAddress: '' } },
  { k: 'cloud.tool', t: 'drive_list_permissions', label: 'Drive: List Permissions', args: { fileId: '' } },
  { k: 'cloud.tool', t: 'drive_remove_permission', label: 'Drive: Remove Permission', args: { fileId: '', permissionId: '' } },
  { k: 'cloud.tool', t: 'drive_get_storage_quota', label: 'Drive: Storage Quota', args: {} },

  // ── Google Calendar ───────────────────────────────────────────────────────
  { k: 'cloud.tool', t: 'calendar_list_events', label: 'Calendar: List Events', args: { calendarId: 'primary', maxResults: 10 } },
  { k: 'cloud.tool', t: 'calendar_create_event', label: 'Calendar: Create Event', args: { summary: '', start: '', end: '' } },
  { k: 'cloud.tool', t: 'calendar_delete_event', label: 'Calendar: Delete Event', args: { eventId: '' } },

  // ── Google Sheets ─────────────────────────────────────────────────────────
  { k: 'cloud.tool', t: 'sheets_read_range', label: 'Sheets: Read Range', args: { spreadsheetId: '', range: 'Sheet1!A1:B10' } },
  { k: 'cloud.tool', t: 'sheets_get_spreadsheet', label: 'Sheets: Get Info', args: { spreadsheetId: '' } },
  { k: 'cloud.tool', t: 'sheets_create_spreadsheet', label: 'Sheets: Create Spreadsheet', args: { title: 'Untitled' } },
  { k: 'cloud.tool', t: 'sheets_write_range', label: 'Sheets: Write Range', args: { spreadsheetId: '', range: 'Sheet1!A1', values: [[]] } },
  { k: 'cloud.tool', t: 'sheets_append_rows', label: 'Sheets: Append Rows', args: { spreadsheetId: '', range: 'Sheet1!A:Z', values: [[]] } },
  { k: 'cloud.tool', t: 'sheets_clear_range', label: 'Sheets: Clear Range', args: { spreadsheetId: '', range: 'Sheet1!A2:Z' } },
  { k: 'cloud.tool', t: 'sheets_add_sheet', label: 'Sheets: Add Sheet/Tab', args: { spreadsheetId: '', title: 'Sheet2' } },
  { k: 'cloud.tool', t: 'sheets_batch_update_values', label: 'Sheets: Batch Write', args: { spreadsheetId: '', data: [{ range: 'Sheet1!A1', values: [[]] }] } },
  { k: 'cloud.tool', t: 'sheets_format_cells', label: 'Sheets: Format Cells', args: { spreadsheetId: '', sheetId: 0, requests: [] } },
  { k: 'cloud.tool', t: 'sheets_delete_rows_columns', label: 'Sheets: Delete Rows/Cols', args: { spreadsheetId: '', sheetId: 0, dimension: 'ROWS', startIndex: 0, endIndex: 1 } },
  { k: 'cloud.tool', t: 'sheets_sort_range', label: 'Sheets: Sort Range', args: { spreadsheetId: '', sheetId: 0, range: { startRowIndex: 0, endRowIndex: 100, startColumnIndex: 0, endColumnIndex: 5 }, sortSpecs: [{ dimensionIndex: 0, sortOrder: 'ASCENDING' }] } },
  { k: 'cloud.tool', t: 'sheets_auto_resize', label: 'Sheets: Auto-Resize Columns', args: { spreadsheetId: '', sheetId: 0, dimension: 'COLUMNS', startIndex: 0, endIndex: 10 } },

  // ── Google Docs ───────────────────────────────────────────────────────────
  { k: 'cloud.tool', t: 'docs_get_document', label: 'Docs: Get Document', args: { documentId: '' } },
  { k: 'cloud.tool', t: 'docs_create_document', label: 'Docs: Create Document', args: { title: 'Untitled' } },
  { k: 'cloud.tool', t: 'docs_write_text', label: 'Docs: Write Text', args: { documentId: '', text: '' } },

  // ── Google Tasks ──────────────────────────────────────────────────────────
  { k: 'cloud.tool', t: 'tasks_list', label: 'Tasks: List', args: { maxResults: 10 } },

  // ── Outlook ───────────────────────────────────────────────────────────────
  { k: 'cloud.tool', t: 'outlook_send_mail', label: 'Outlook: Send Email', args: { to: [], subject: '', body: '', contentType: 'Text' } },
  { k: 'cloud.tool', t: 'outlook_list_messages', label: 'Outlook: List Messages', args: { folder: 'Inbox', top: 10 } },
  { k: 'cloud.tool', t: 'outlook_search_messages', label: 'Outlook: Search Messages', args: { query: '', top: 10 } },
  { k: 'cloud.tool', t: 'outlook_get_message', label: 'Outlook: Get Message', args: { id: '' } },
  { k: 'cloud.tool', t: 'outlook_list_recent_brief', label: 'Outlook: Recent Messages', args: { maxResults: 5 } },
  { k: 'cloud.tool', t: 'outlook_list_folders', label: 'Outlook: List Folders', args: {} },
  { k: 'cloud.tool', t: 'outlook_reply_message', label: 'Outlook: Reply', args: { id: '', comment: '' } },
  { k: 'cloud.tool', t: 'outlook_forward_message', label: 'Outlook: Forward', args: { id: '', to: [] } },
  { k: 'cloud.tool', t: 'outlook_create_draft', label: 'Outlook: Create Draft', args: { to: [], subject: '', body: '' } },
  { k: 'cloud.tool', t: 'outlook_mark_as_read', label: 'Outlook: Mark Read', args: { id: '' } },
  { k: 'cloud.tool', t: 'outlook_archive_message', label: 'Outlook: Archive', args: { id: '' } },
  { k: 'cloud.tool', t: 'outlook_move_message', label: 'Outlook: Move Message', args: { id: '', destinationId: '' } },
  { k: 'cloud.tool', t: 'outlook_delete_message', label: 'Outlook: Delete Message', args: { id: '' } },
  { k: 'cloud.tool', t: 'outlook_download_attachment', label: 'Outlook: Download Attachment', args: { messageId: '', attachmentId: '', path: '' } },
  { k: 'cloud.tool', t: 'outlook_get_me', label: 'Outlook: Get Profile', args: {} },
  { k: 'cloud.tool', t: 'outlook_calendar_list_events', label: 'Outlook: List Events', args: {} },
  { k: 'cloud.tool', t: 'outlook_calendar_create_event', label: 'Outlook: Create Event', args: { subject: '', start: '', end: '' } },
  { k: 'cloud.tool', t: 'outlook_calendar_update_event', label: 'Outlook: Update Event', args: { eventId: '' } },
  { k: 'cloud.tool', t: 'outlook_calendar_delete_event', label: 'Outlook: Delete Event', args: { eventId: '' } },

  // ── GitHub ────────────────────────────────────────────────────────────────
  { k: 'cloud.tool', t: 'github_get_me', label: 'GitHub: Get Profile', args: {} },
  { k: 'cloud.tool', t: 'github_list_repos', label: 'GitHub: List Repos', args: { visibility: 'all' } },
  { k: 'cloud.tool', t: 'github_list_issues', label: 'GitHub: List Issues', args: { owner: '', repo: '', state: 'open' } },
  { k: 'cloud.tool', t: 'github_create_issue', label: 'GitHub: Create Issue', args: { owner: '', repo: '', title: '', body: '' } },

  // ── Facebook ──────────────────────────────────────────────────────────────
  { k: 'cloud.tool', t: 'facebook_get_me', label: 'Facebook: Get Profile', args: {} },
  { k: 'cloud.tool', t: 'facebook_list_pages', label: 'Facebook: List Pages', args: {} },
  { k: 'cloud.tool', t: 'facebook_list_page_posts', label: 'Facebook: List Page Posts', args: { page_id: '', limit: 10 } },
  { k: 'cloud.tool', t: 'facebook_create_page_post', label: 'Facebook: Create Page Post', args: { page_id: '', message: '', link: '', published: true } },

  // ── Instagram ─────────────────────────────────────────────────────────────
  { k: 'cloud.tool', t: 'instagram_get_me', label: 'Instagram: Get Profile', args: {} },
  { k: 'cloud.tool', t: 'instagram_list_media', label: 'Instagram: List Media', args: { limit: 10 } },
  { k: 'cloud.tool', t: 'instagram_publish_media', label: 'Instagram: Publish Media', args: { media_type: 'IMAGE', image_url: '', caption: '' } },

  // ── Threads ───────────────────────────────────────────────────────────────
  { k: 'cloud.tool', t: 'threads_get_me', label: 'Threads: Get Profile', args: {} },
  { k: 'cloud.tool', t: 'threads_list_posts', label: 'Threads: List Posts', args: { limit: 10 } },
  { k: 'cloud.tool', t: 'threads_publish_post', label: 'Threads: Publish Post', args: { text: '', reply_control: 'everyone' } },

  // ── WhatsApp ──────────────────────────────────────────────────────────────
  { k: 'cloud.tool', t: 'whatsapp_status', label: 'WhatsApp: Status', args: {} },
  { k: 'cloud.tool', t: 'whatsapp_send_message', label: 'WhatsApp: Send Message', args: { message: '', preview_url: false } },
  { k: 'cloud.tool', t: 'whatsapp_send_media', label: 'WhatsApp: Send Media', args: { type: 'image', url: '', caption: '' } },
  { k: 'cloud.tool', t: 'whatsapp_send_reaction', label: 'WhatsApp: Send Reaction', args: { message_id: '', emoji: '👍' } },
  { k: 'cloud.tool', t: 'whatsapp_mark_read', label: 'WhatsApp: Mark Read', args: { message_id: '' } },
  { k: 'cloud.tool', t: 'whatsapp_upload_media', label: 'WhatsApp: Upload Media', args: { url: '', mime_type: '' } },

  // ── Telnyx (SMS / Voice) ──────────────────────────────────────────────────
  { k: 'cloud.tool', t: 'telnyx_send_sms', label: 'Telnyx: Send SMS', args: { message: '' } },
  { k: 'cloud.tool', t: 'telnyx_voice_call', label: 'Telnyx: AI Voice Call', args: { provider: 'auto', initial_message: '', system_prompt: '' } },
  { k: 'cloud.tool', t: 'telnyx_phone_status', label: 'Telnyx: Phone Status', args: {} },

  // ── X ─────────────────────────────────────────────────────────────────────
  { k: 'cloud.tool', t: 'x_search_tweets', label: 'X: Search Posts', args: { query: '', max_results: 20 } },
  { k: 'cloud.tool', t: 'x_get_user_timeline', label: 'X: User Timeline', args: { username: '', max_results: 20, exclude_replies: false, exclude_retweets: false } },
  { k: 'cloud.tool', t: 'x_get_tweet', label: 'X: Get Post', args: { id: '' } },
  { k: 'cloud.tool', t: 'x_get_comments', label: 'X: Get Comments', args: { post_id: '', username: '', max_results: 20, only_direct_replies: false, exclude_retweets: true } },
  { k: 'cloud.tool', t: 'x_comment_on_post', label: 'X: Comment Post', args: { post_id: '', text: '' } },
  { k: 'cloud.tool', t: 'x_reply_to_comment', label: 'X: Reply Comment', args: { comment_id: '', text: '' } },
  { k: 'cloud.tool', t: 'x_like_comment', label: 'X: Like Comment', args: { comment_id: '' } },
  { k: 'cloud.tool', t: 'x_post_tweet', label: 'X: Post', args: { text: '', reply_to_tweet_id: '' } },
  { k: 'cloud.tool', t: 'x_delete_tweet', label: 'X: Delete Post', args: { id: '' } },
  { k: 'cloud.tool', t: 'x_send_dm', label: 'X: Send DM', args: { recipient_username: '', text: '' } },
  { k: 'cloud.tool', t: 'x_list_dms', label: 'X: List DMs', args: { conversation_id: '', participant_username: '', max_results: 20 } },
  { k: 'cloud.tool', t: 'x_get_user', label: 'X: Get User', args: { username: '' } },
  { k: 'cloud.tool', t: 'x_list_followers', label: 'X: List Followers', args: { username: '', max_results: 100 } },
  { k: 'cloud.tool', t: 'x_list_following', label: 'X: List Following', args: { username: '', max_results: 100 } },

  // ── Discord ───────────────────────────────────────────────────────────────
  { k: 'cloud.tool', t: 'discord_list_guilds', label: 'Discord: List Servers', args: {} },
  { k: 'cloud.tool', t: 'discord_read_messages', label: 'Discord: Read Messages', args: { channel_id: '' } },
  { k: 'cloud.tool', t: 'discord_send_dm', label: 'Discord: Send DM', args: { channel_id: '', content: '' } },

  // ── Reddit ────────────────────────────────────────────────────────────────
  { k: 'cloud.tool', t: 'reddit_search', label: 'Reddit: Search Posts', args: { query: '', sort: 'relevance', time: 'all', limit: 25 } },
  { k: 'cloud.tool', t: 'reddit_view_subreddit', label: 'Reddit: View Subreddit', args: { subreddit: '', sort: 'hot', limit: 25 } },
  { k: 'cloud.tool', t: 'reddit_view_comments', label: 'Reddit: View Comments', args: { subreddit: '', post_id: '' } },
  { k: 'cloud.tool', t: 'reddit_create_post', label: 'Reddit: Create Post', args: { subreddit: '', title: '', kind: 'self', text: '' } },
  { k: 'cloud.tool', t: 'reddit_comment', label: 'Reddit: Comment / Reply', args: { thing_id: '', text: '' } },
];
