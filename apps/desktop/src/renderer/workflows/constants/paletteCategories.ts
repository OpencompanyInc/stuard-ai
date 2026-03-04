/**
 * Palette categories with icons for the workflow builder toolbox
 */
import {
  Zap, Clock, Folder, Link, Cloud, FileCode, Keyboard, Command,
  MousePointer2, Scroll, Clipboard, Camera, Mic, Video, StopCircle,
  FileText, FolderOpen, FolderPlus, Move, AppWindow, Eye, Mail,
  Database, Calendar, FileSpreadsheet, GitBranch, ListOrdered, Workflow,
  Box, PenLine, BookOpen, ToggleLeft, PlusCircle, ListPlus, Trash2,
  Package, List, Layout, X, Wand2, Rocket, Terminal, Bell,
  Monitor, Volume2, Search, Globe, Brain, Calculator, Sigma,
  Sparkles, BarChart3, Hash, Speaker, Download, Archive, CheckCircle,
  MessageSquare, ListChecks, GitPullRequest, Play, Inbox,
  Send, User, Activity, Radio, Bot, Phone, PhoneCall,
  Table2, HardDrive, Scan, Binary,
  type LucideIcon
} from "lucide-react";

export interface PaletteCategoryItem {
  k: 'trigger' | 'local.tool' | 'cloud.tool';
  t: string;
  label: string;
  icon: LucideIcon;
  args: Record<string, any>;
}

export interface PaletteCategory {
  id: string;
  label: string;
  icon: LucideIcon;
  color: string;
  items: PaletteCategoryItem[];
}

export const PALETTE_CATEGORIES: PaletteCategory[] = [
  {
    id: 'triggers',
    label: 'Triggers',
    icon: Zap,
    color: 'amber',
    items: [
      { k: 'trigger', t: 'manual', label: 'Manual (Click to Run)', icon: Play, args: {} },
      { k: 'trigger', t: 'hotkey', label: 'Hotkey', icon: Keyboard, args: { accelerator: 'Ctrl+Alt+K' } },
      { k: 'trigger', t: 'hotkey', label: 'Hotkey (hold)', icon: Radio, args: { accelerator: 'Ctrl+H', hold: true } },
      { k: 'trigger', t: 'hotkey.release', label: 'Hotkey Release', icon: Keyboard, args: { accelerator: 'Ctrl+H' } },
      { k: 'trigger', t: 'keystroke', label: 'Keystroke Sequence', icon: Command, args: { sequence: 'stuard' } },
      { k: 'trigger', t: 'function', label: 'Function (callable workflow)', icon: Workflow, args: {} },
      { k: 'trigger', t: 'webhook.local', label: 'Webhook (Local)', icon: Link, args: {} },
      { k: 'trigger', t: 'webhook.cloud', label: 'Webhook (Cloud)', icon: Cloud, args: {} },
      { k: 'trigger', t: 'gmail.new_email', label: 'Gmail: New Email', icon: Mail, args: { profile: 'default', labelIds: ['INBOX'] } },
      { k: 'trigger', t: 'drive.new_file', label: 'Drive: New File', icon: Database, args: { profile: 'default', onlyNew: true, includeFolders: false } },
      { k: 'trigger', t: 'schedule.cron', label: 'Schedule', icon: Clock, args: { cron: '*/5 * * * *' } },
      { k: 'trigger', t: 'fs.watch', label: 'File/Folder Watch', icon: Folder, args: { path: '', pattern: '*.*', recursive: true } },
      { k: 'trigger', t: 'command.watch', label: 'Custom Script (watch)', icon: FileCode, args: { cmd: 'python', args: ['script.py'] } },
    ],
  },
  {
    id: 'flow',
    label: 'Flow Control',
    icon: GitBranch,
    color: 'indigo',
    items: [
      { k: 'local.tool', t: 'wait', label: 'Wait / Delay', icon: Clock, args: { ms: 1000 } },
      { k: 'local.tool', t: 'log', label: 'Log Message', icon: FileText, args: { message: '' } },
      { k: 'local.tool', t: 'send_notification', label: 'Send Notification', icon: Bell, args: { title: 'Stuard AI', body: 'Hello!', severity: 'info' } },
      { k: 'local.tool', t: 'return_value', label: 'Return Value', icon: StopCircle, args: { value: '{{}}', success: true, message: '' } },
      { k: 'local.tool', t: 'end', label: 'End Flow', icon: StopCircle, args: {} },
      { k: 'local.tool', t: 'run_sequential', label: 'Run Sequential', icon: ListOrdered, args: { steps: [] } },
      { k: 'local.tool', t: 'run_parallel', label: 'Run Parallel', icon: Zap, args: { steps: [] } },
      { k: 'local.tool', t: 'invoke_workflow', label: 'Invoke Workflow', icon: Workflow, args: { id: '' } },
      { k: 'local.tool', t: 'call_workflow', label: 'Call Workflow (external)', icon: Workflow, args: { workflowId: '', inputs: {} } },
      { k: 'local.tool', t: 'call_function', label: 'Call Function (internal)', icon: Zap, args: { triggerId: '', inputs: {} } },
      { k: 'local.tool', t: 'call_workspace_function', label: 'Call Workspace Function', icon: FolderOpen, args: { path: '', inputs: {} } },
    ],
  },
  {
    id: 'variables',
    label: 'Variables',
    icon: Box,
    color: 'orange',
    items: [
      { k: 'local.tool', t: 'set_variable', label: 'Set Variable', icon: PenLine, args: { name: 'myVar', value: '' } },
      { k: 'local.tool', t: 'get_variable', label: 'Get Variable', icon: BookOpen, args: { name: 'myVar', default: '' } },
      { k: 'local.tool', t: 'toggle_variable', label: 'Toggle Boolean', icon: ToggleLeft, args: { name: 'isActive' } },
      { k: 'local.tool', t: 'increment_variable', label: 'Increment Number', icon: PlusCircle, args: { name: 'counter', amount: 1 } },
      { k: 'local.tool', t: 'append_to_list', label: 'Append to List', icon: ListPlus, args: { name: 'items', item: '' } },
      { k: 'local.tool', t: 'delete_variable', label: 'Delete Variable', icon: Trash2, args: { name: 'myVar' } },
    ],
  },
  {
    id: 'mouse',
    label: 'Mouse',
    icon: MousePointer2,
    color: 'blue',
    items: [
      { k: 'local.tool', t: 'move_cursor', label: 'Move Cursor', icon: MousePointer2, args: { x: 100, y: 100, duration: 0 } },
      { k: 'local.tool', t: 'click_at_coordinates', label: 'Click', icon: MousePointer2, args: { x: 100, y: 100, button: 'left' } },
      { k: 'local.tool', t: 'click_at_coordinates', label: 'Right Click', icon: MousePointer2, args: { x: 100, y: 100, button: 'right' } },
      { k: 'local.tool', t: 'double_click_at_coordinates', label: 'Double Click', icon: MousePointer2, args: { x: 100, y: 100 } },
      { k: 'local.tool', t: 'scroll', label: 'Scroll Up', icon: Scroll, args: { deltaY: -120 } },
      { k: 'local.tool', t: 'scroll', label: 'Scroll Down', icon: Scroll, args: { deltaY: 120 } },
      { k: 'local.tool', t: 'drag_and_drop', label: 'Drag & Drop', icon: Move, args: { fromX: 100, fromY: 100, toX: 400, toY: 400 } },
      { k: 'local.tool', t: 'get_mouse_position', label: 'Get Mouse Position', icon: MousePointer2, args: {} },
    ],
  },
  {
    id: 'keyboard',
    label: 'Keyboard',
    icon: Keyboard,
    color: 'sky',
    items: [
      { k: 'local.tool', t: 'type_text', label: 'Type Text', icon: Keyboard, args: { text: '' } },
      { k: 'local.tool', t: 'send_hotkey', label: 'Send Hotkey', icon: Command, args: { keys: ['ctrl', 'c'] } },
      { k: 'local.tool', t: 'send_hotkey', label: 'Copy (Ctrl+C)', icon: Clipboard, args: { keys: ['ctrl', 'c'] } },
      { k: 'local.tool', t: 'send_hotkey', label: 'Paste (Ctrl+V)', icon: Clipboard, args: { keys: ['ctrl', 'v'] } },
      { k: 'local.tool', t: 'send_hotkey', label: 'Cut (Ctrl+X)', icon: Clipboard, args: { keys: ['ctrl', 'x'] } },
      { k: 'local.tool', t: 'send_hotkey', label: 'Undo (Ctrl+Z)', icon: Command, args: { keys: ['ctrl', 'z'] } },
      { k: 'local.tool', t: 'send_hotkey', label: 'Select All (Ctrl+A)', icon: Command, args: { keys: ['ctrl', 'a'] } },
      { k: 'local.tool', t: 'send_hotkey', label: 'Enter', icon: Command, args: { keys: ['enter'] } },
      { k: 'local.tool', t: 'send_hotkey', label: 'Tab', icon: Command, args: { keys: ['tab'] } },
      { k: 'local.tool', t: 'send_hotkey', label: 'Escape', icon: Command, args: { keys: ['escape'] } },
    ],
  },
  {
    id: 'clipboard',
    label: 'Clipboard',
    icon: Clipboard,
    color: 'slate',
    items: [
      { k: 'local.tool', t: 'get_clipboard_content', label: 'Get Clipboard Text', icon: Clipboard, args: {} },
      { k: 'local.tool', t: 'set_clipboard_content', label: 'Set Clipboard Text', icon: Clipboard, args: { text: '' } },
    ],
  },
  {
    id: 'media',
    label: 'Media & Screen',
    icon: Camera,
    color: 'pink',
    items: [
      { k: 'local.tool', t: 'take_screenshot', label: 'Screenshot', icon: Camera, args: {} },
      { k: 'local.tool', t: 'capture_media', label: 'Capture Photo', icon: Camera, args: { kind: 'photo' } },
      { k: 'local.tool', t: 'capture_media', label: 'Record Mic Audio', icon: Mic, args: { kind: 'audio', mode: 'until_stop', sessionId: 'rec' } },
      { k: 'local.tool', t: 'capture_media', label: 'Record Audio (until silence)', icon: Mic, args: { kind: 'audio', mode: 'silence', silenceThreshold: 0.01, silenceDurationMs: 2000, sessionId: 'rec' } },
      { k: 'local.tool', t: 'capture_media', label: 'Record Webcam', icon: Video, args: { kind: 'video', mode: 'until_stop', sessionId: 'rec' } },
      { k: 'local.tool', t: 'capture_media', label: 'Record Webcam + Mic', icon: Video, args: { kind: 'audiovideo', mode: 'until_stop', sessionId: 'rec' } },
      { k: 'local.tool', t: 'capture_screen', label: 'Record Screen', icon: Monitor, args: { mode: 'until_stop', target: 'fullscreen', fps: 30, quality: 'medium' } },
      { k: 'local.tool', t: 'capture_screen', label: 'Record Screen + Audio', icon: Monitor, args: { mode: 'until_stop', target: 'fullscreen', includeSystemAudio: true, fps: 30, quality: 'medium' } },
      { k: 'local.tool', t: 'capture_system_audio', label: 'Record System Audio', icon: Volume2, args: { mode: 'until_stop', format: 'wav' } },
      { k: 'local.tool', t: 'capture_system_audio', label: 'Record System Audio (until silence)', icon: Volume2, args: { mode: 'silence', silenceThreshold: 0.01, silenceDurationMs: 2000, format: 'wav' } },
      { k: 'local.tool', t: 'stop_capture', label: 'Stop Webcam/Mic', icon: StopCircle, args: { sessionId: 'rec' } },
      { k: 'local.tool', t: 'stop_screen_capture', label: 'Stop Screen', icon: StopCircle, args: { sessionId: '' } },
      { k: 'local.tool', t: 'stop_system_audio', label: 'Stop System Audio', icon: StopCircle, args: { sessionId: '' } },
    ],
  },
  {
    id: 'tts',
label: 'Text to Speech',
    icon: Speaker,
    color: 'purple',
    items: [
      { k: 'cloud.tool', t: 'text_to_speech', label: 'Text to Speech (Save)', icon: Speaker, args: { text: 'Hello!', voice_id: 'JBFqnCBsd6RMkjVDRZzb', model_id: 'eleven_multilingual_v2', language_code: '', speed: 1.0, format: 'mp3', save: true, play: false } },
      { k: 'cloud.tool', t: 'text_to_speech', label: 'Speak Text (Play)', icon: Play, args: { text: 'Hello!', voice_id: 'JBFqnCBsd6RMkjVDRZzb', model_id: 'eleven_multilingual_v2', language_code: '', speed: 1.0, format: 'mp3', save: false, play: true } },
      { k: 'cloud.tool', t: 'list_tts_voices', label: 'List TTS Voices', icon: List, args: {} },
      { k: 'cloud.tool', t: 'get_tts_models', label: 'Get TTS Models', icon: List, args: {} },
    ],
  },
  {
    id: 'files',
    label: 'Files',
    icon: FolderOpen,
    color: 'cyan',
    items: [
      { k: 'local.tool', t: 'read_file', label: 'Read File', icon: FileText, args: { path: '' } },
      { k: 'local.tool', t: 'write_file', label: 'Write File', icon: PenLine, args: { path: '', content: '', description: '' } },
      { k: 'local.tool', t: 'list_directory', label: 'List Directory', icon: Folder, args: { path: '' } },
      { k: 'local.tool', t: 'glob', label: 'Find Files', icon: Search, args: { pattern: '*.txt', root: '' } },
      { k: 'local.tool', t: 'grep', label: 'Search In Files', icon: Search, args: { path: '', pattern: '' } },
      { k: 'local.tool', t: 'create_directory', label: 'Create Folder', icon: FolderPlus, args: { path: '' } },
      { k: 'local.tool', t: 'move_file', label: 'Move File', icon: Package, args: { src: '', dest: '' } },
      { k: 'local.tool', t: 'run_command', label: 'Run Command', icon: Terminal, args: { command: 'echo hello', description: '' } },
      { k: 'local.tool', t: 'launch_application_or_uri', label: 'Launch App/URL', icon: Rocket, args: { target: '' } },
    ],
  },
  {
    id: 'workspace',
    label: 'Workspace Files',
    icon: HardDrive,
    color: 'teal',
    items: [
      { k: 'local.tool', t: 'workspace_read_file', label: 'Read Workspace File', icon: FileText, args: { path: 'data/config.json' } },
      { k: 'local.tool', t: 'workspace_write_file', label: 'Write Workspace File', icon: PenLine, args: { path: 'data/config.json', content: '{}' } },
      { k: 'local.tool', t: 'workspace_list_files', label: 'List Workspace Files', icon: List, args: { path: '' } },
      { k: 'local.tool', t: 'workspace_create_folder', label: 'Create Workspace Folder', icon: FolderPlus, args: { path: 'data/exports' } },
      { k: 'local.tool', t: 'workspace_delete_file', label: 'Delete Workspace File', icon: Trash2, args: { path: '' } },
      { k: 'local.tool', t: 'workspace_get_info', label: 'Get Workspace Info', icon: HardDrive, args: {} },
    ],
  },
  {
    id: 'utils',
    label: 'Utilities',
    icon: Sparkles,
    color: 'teal',
    items: [
      { k: 'local.tool', t: 'get_datetime', label: 'Get Date & Time', icon: Clock, args: {} },
      { k: 'local.tool', t: 'math_eval', label: 'Math Expression', icon: Calculator, args: { expression: 'sqrt(16) + pow(2, 3)' } },
      { k: 'local.tool', t: 'generate_uuid', label: 'Generate UUID', icon: Hash, args: {} },
      { k: 'local.tool', t: 'random_number', label: 'Random Number', icon: Sparkles, args: { min: 1, max: 100 } },
      { k: 'local.tool', t: 'random_choice', label: 'Random Choice', icon: Sparkles, args: { items: ['a', 'b', 'c'] } },
      { k: 'local.tool', t: 'sleep', label: 'Sleep / Delay', icon: Clock, args: { seconds: 1 } },
      { k: 'local.tool', t: 'get_system_info', label: 'System Info', icon: Monitor, args: {} },
      { k: 'local.tool', t: 'get_env_var', label: 'Get Env Variable', icon: Box, args: { name: 'PATH' } },
      { k: 'local.tool', t: 'hash_string', label: 'Hash String', icon: Hash, args: { text: '', algorithm: 'sha256' } },
      { k: 'local.tool', t: 'base64_encode', label: 'Base64 Encode', icon: Binary, args: { text: '' } },
      { k: 'local.tool', t: 'base64_decode', label: 'Base64 Decode', icon: Binary, args: { encoded: '' } },
      { k: 'local.tool', t: 'json_parse', label: 'Parse JSON', icon: FileCode, args: { text: '{}' } },
      { k: 'local.tool', t: 'json_stringify', label: 'Stringify JSON', icon: FileCode, args: { data: {}, pretty: true } },
      { k: 'local.tool', t: 'regex_match', label: 'Regex Match', icon: Search, args: { text: '', pattern: '' } },
      { k: 'local.tool', t: 'regex_replace', label: 'Regex Replace', icon: PenLine, args: { text: '', pattern: '', replacement: '' } },
    ],
  },
  {
    id: 'scripts',
    label: 'Scripts',
    icon: FileCode,
    color: 'emerald',
    items: [
      { k: 'local.tool', t: 'run_python_script', label: 'Python Script', icon: FileCode, args: { code: 'print("Hello!")', packages: [] } },
      { k: 'local.tool', t: 'run_node_script', label: 'Node.js Script', icon: FileCode, args: { code: 'console.log("Hello!")' } },
    ],
  },
  {
    id: 'windows',
    label: 'Windows',
    icon: AppWindow,
    color: 'sky',
    items: [
      { k: 'local.tool', t: 'list_open_windows', label: 'List Windows', icon: List, args: {} },
      { k: 'local.tool', t: 'bring_window_to_foreground', label: 'Focus Window', icon: AppWindow, args: { title: '' } },
      { k: 'local.tool', t: 'smart_bring_window_to_foreground', label: 'Smart Focus', icon: Wand2, args: { hint: '' } },
      { k: 'local.tool', t: 'get_window_info', label: 'Get Window Info', icon: AppWindow, args: { title: '' } },
      { k: 'local.tool', t: 'set_window_bounds', label: 'Resize / Move', icon: AppWindow, args: { title: '', bounds: { x: 0, y: 0, width: 900, height: 700 }, bringToTop: true } },
    ],
  },
  {
    id: 'ui',
    label: 'Custom UI',
    icon: Layout,
    color: 'violet',
    items: [
      { k: 'local.tool', t: 'custom_ui', label: 'Show UI', icon: AppWindow, args: { title: 'My UI', component: 'function App() {\n  return (\n    <div className="p-6 text-center">\n      <h2 className="text-2xl font-bold text-white">Hello</h2>\n      <button onClick={() => stuard.submit({ ok: true })} className="btn-primary mt-4 px-6">OK</button>\n    </div>\n  );\n}', window: { width: 300, height: 200, position: 'center', borderRadius: 12, frameless: true, alwaysOnTop: true, backgroundColor: '#1a1a2e', backgroundType: 'color', contentPadding: 24, shadow: { enabled: true, color: '#00000040', blur: 20, spread: 0, x: 0, y: 8 }, animation: { open: 'fade', close: 'fade', duration: 300, easing: 'ease-out' } } } },
      { k: 'local.tool', t: 'update_custom_ui', label: 'Update UI', icon: AppWindow, args: { id: '', data: {}, html: '' } },
      { k: 'local.tool', t: 'close_custom_ui', label: 'Close UI', icon: X, args: { id: '' } },
    ],
  },
  {
    id: 'agent',
    label: 'AI Agent',
    icon: Bot,
    color: 'purple',
    items: [
      { k: 'cloud.tool', t: 'agent_node', label: 'AI Agent', icon: Bot, args: { prompt: '', model: 'balanced', outputMode: 'text', maxSteps: 10 } },
      { k: 'cloud.tool', t: 'ai_inference', label: 'AI Inference', icon: Brain, args: { prompt: 'Summarize this', input: '', mode: 'text' } },
    ],
  },
  {
    id: 'ai',
    label: 'AI & Vision',
    icon: Eye,
    color: 'fuchsia',
    items: [
      { k: 'cloud.tool', t: 'analyze_current_screen', label: 'Analyze Screen', icon: Eye, args: {} },
      { k: 'cloud.tool', t: 'analyze_image', label: 'Analyze Image', icon: Eye, args: { path: '' } },
      { k: 'cloud.tool', t: 'analyze_media', label: 'Transcribe Audio', icon: Mic, args: { sources: [{ path: '' }], task: 'transcribe' } },
      { k: 'cloud.tool', t: 'cloud_ai_vision', label: 'AI Vision (JSON)', icon: Eye, args: { prompt: '', imagePath: '' } },
    ],
  },
  {
    id: 'search',
    label: 'Web Search',
    icon: Search,
    color: 'green',
    items: [
      { k: 'cloud.tool', t: 'web_search', label: 'Web Search', icon: Search, args: { query: 'latest AI news' } },
      { k: 'cloud.tool', t: 'scrape_url', label: 'Scrape URL', icon: Globe, args: { urls: ['https://example.com'] } },
    ],
  },
  {
    id: 'http',
    label: 'HTTP / API',
    icon: Globe,
    color: 'teal',
    items: [
      {
        k: 'local.tool',
        t: 'http_request',
        label: 'HTTP Request',
        icon: Globe,
        args: {
          url: 'https://httpbin.org/anything',
          method: 'GET',
          headers: {},
          query: {},
          json_body: undefined,
          form: undefined,
          bearer_token: '',
          timeout: 30,
          follow_redirects: true,
          verify_ssl: true,
          retries: 0,
        },
      },
    ],
  },
  {
    id: 'gmail',
    label: 'Gmail',
    icon: Mail,
    color: 'red',
    items: [
      { k: 'cloud.tool', t: 'gmail_send_message', label: 'Send Email', icon: Send, args: { to: [], subject: '', body: '', contentType: 'text/plain', from: '' } },
      { k: 'cloud.tool', t: 'gmail_list_messages', label: 'List Messages', icon: Inbox, args: { maxResults: 10 } },
      { k: 'cloud.tool', t: 'gmail_list_recent_brief', label: 'Recent Messages (Brief)', icon: List, args: { maxResults: 5 } },
      { k: 'cloud.tool', t: 'gmail_get_message_brief', label: 'Get Message Brief', icon: Mail, args: { id: '' } },
      { k: 'cloud.tool', t: 'gmail_get_message_full', label: 'Get Message Full', icon: FileText, args: { id: '' } },
      { k: 'cloud.tool', t: 'gmail_get_messages_brief', label: 'Get Messages Brief (Batch)', icon: List, args: { ids: [] } },
      { k: 'cloud.tool', t: 'gmail_get_most_recent_full', label: 'Most Recent (Full)', icon: Mail, args: {} },
      { k: 'cloud.tool', t: 'gmail_retrieve_messages_with_attachments', label: 'Get with Attachments', icon: Download, args: { maxResults: 10, downloadAttachments: false } },
      { k: 'cloud.tool', t: 'gmail_download_attachment', label: 'Download Attachment', icon: Download, args: { messageId: '', attachmentId: '', path: '' } },
      { k: 'cloud.tool', t: 'gmail_modify_message', label: 'Modify Labels', icon: ListChecks, args: { id: '', addLabelIds: [], removeLabelIds: [] } },
      { k: 'cloud.tool', t: 'gmail_archive_message', label: 'Archive Message', icon: Archive, args: { id: '' } },
      { k: 'cloud.tool', t: 'gmail_mark_as_read', label: 'Mark as Read', icon: CheckCircle, args: { id: '' } },
      { k: 'cloud.tool', t: 'gmail_mark_as_unread', label: 'Mark as Unread', icon: Mail, args: { id: '' } },
      { k: 'cloud.tool', t: 'gmail_delete_message', label: 'Delete Message', icon: Trash2, args: { id: '' } },
    ],
  },
  {
    id: 'google_drive',
    label: 'Google Drive',
    icon: Database,
    color: 'amber',
    items: [
      { k: 'cloud.tool', t: 'drive_list_files', label: 'List Files', icon: List, args: { pageSize: 20 } },
    ],
  },
  {
    id: 'google_calendar',
    label: 'Google Calendar',
    icon: Calendar,
    color: 'blue',
    items: [
      { k: 'cloud.tool', t: 'calendar_list_events', label: 'List Events', icon: List, args: { calendarId: 'primary', maxResults: 10 } },
      { k: 'cloud.tool', t: 'calendar_create_event', label: 'Create Event', icon: PlusCircle, args: { summary: '', start: '', end: '' } },
      { k: 'cloud.tool', t: 'calendar_delete_event', label: 'Delete Event', icon: Trash2, args: { eventId: '' } },
    ],
  },
  {
    id: 'google_sheets',
    label: 'Google Sheets',
    icon: FileSpreadsheet,
    color: 'green',
    items: [
      { k: 'cloud.tool', t: 'sheets_read_range', label: 'Read Range', icon: FileSpreadsheet, args: { spreadsheetId: '', range: 'Sheet1!A1:B10' } },
    ],
  },
  {
    id: 'google_docs',
    label: 'Google Docs',
    icon: FileText,
    color: 'blue',
    items: [
      { k: 'cloud.tool', t: 'docs_get_document', label: 'Get Document', icon: FileText, args: { documentId: '' } },
      { k: 'cloud.tool', t: 'docs_create_document', label: 'Create Document', icon: PlusCircle, args: { title: 'Untitled' } },
      { k: 'cloud.tool', t: 'docs_write_text', label: 'Write Text', icon: PenLine, args: { documentId: '', text: '' } },
    ],
  },
  {
    id: 'google_tasks',
    label: 'Google Tasks',
    icon: ListChecks,
    color: 'indigo',
    items: [
      { k: 'cloud.tool', t: 'tasks_list', label: 'List Tasks', icon: List, args: { maxResults: 10 } },
    ],
  },
  {
    id: 'outlook',
    label: 'Outlook',
    icon: Mail,
    color: 'sky',
    items: [
      { k: 'cloud.tool', t: 'outlook_send_mail', label: 'Send Email', icon: Send, args: { to: [], subject: '', body: '', contentType: 'Text' } },
      { k: 'cloud.tool', t: 'outlook_list_messages', label: 'List Messages', icon: Inbox, args: { folder: 'Inbox', top: 10 } },
      { k: 'cloud.tool', t: 'outlook_search_messages', label: 'Search Messages', icon: Search, args: { query: '', top: 10 } },
      { k: 'cloud.tool', t: 'outlook_get_me', label: 'Get Profile', icon: User, args: {} },
    ],
  },
  {
    id: 'github',
    label: 'GitHub',
    icon: GitBranch,
    color: 'slate',
    items: [
      { k: 'cloud.tool', t: 'github_get_me', label: 'Get Profile', icon: User, args: {} },
      { k: 'cloud.tool', t: 'github_list_repos', label: 'List Repos', icon: Database, args: { visibility: 'all' } },
      { k: 'cloud.tool', t: 'github_list_issues', label: 'List Issues', icon: MessageSquare, args: { owner: '', repo: '', state: 'open' } },
      { k: 'cloud.tool', t: 'github_create_issue', label: 'Create Issue', icon: GitPullRequest, args: { owner: '', repo: '', title: '', body: '' } },
    ],
  },
  {
    id: 'telnyx',
    label: 'SMS / Call',
    icon: Phone,
    color: 'emerald',
    items: [
      { k: 'cloud.tool', t: 'telnyx_send_sms', label: 'Send SMS', icon: MessageSquare, args: { message: '' } },
      { k: 'cloud.tool', t: 'telnyx_make_call', label: 'Make Call (TTS)', icon: PhoneCall, args: { message: '', voice: 'female' } },
      { k: 'cloud.tool', t: 'telnyx_phone_status', label: 'Check Phone Status', icon: Phone, args: {} },
    ],
  },
  {
    id: 'math',
    label: 'Math',
    icon: Calculator,
    color: 'rose',
    items: [
      { k: 'local.tool', t: 'math_add', label: 'Add', icon: PlusCircle, args: { a: 0, b: 0 } },
      { k: 'local.tool', t: 'math_subtract', label: 'Subtract', icon: Calculator, args: { a: 0, b: 0 } },
      { k: 'local.tool', t: 'math_multiply', label: 'Multiply', icon: Hash, args: { a: 0, b: 0 } },
      { k: 'local.tool', t: 'math_divide', label: 'Divide', icon: Calculator, args: { a: 0, b: 1 } },
      { k: 'local.tool', t: 'math_power', label: 'Power', icon: Sparkles, args: { a: 2, b: 2 } },
      { k: 'local.tool', t: 'math_sqrt', label: 'Square Root', icon: Calculator, args: { x: 4 } },
      { k: 'local.tool', t: 'math_abs', label: 'Absolute', icon: Calculator, args: { x: -5 } },
      { k: 'local.tool', t: 'math_random', label: 'Random', icon: Sparkles, args: { min: 1, max: 10 } },
      { k: 'local.tool', t: 'math_sum', label: 'Sum List', icon: Sigma, args: { x: [1, 2, 3] } },
      { k: 'local.tool', t: 'math_mean', label: 'Average', icon: BarChart3, args: { x: [1, 2, 3] } },
      { k: 'local.tool', t: 'math_max', label: 'Max', icon: BarChart3, args: { x: [1, 5, 3] } },
      { k: 'local.tool', t: 'math_min', label: 'Min', icon: BarChart3, args: { x: [1, 5, 3] } },
      { k: 'local.tool', t: 'math_compare', label: 'Compare', icon: Calculator, args: { a: 5, b: 3, op: 'gt' } },
      { k: 'local.tool', t: 'math_range', label: 'Range', icon: ListOrdered, args: { start: 1, stop: 10 } },
    ],
  },
  {
    id: 'database',
    label: 'Database',
    icon: Database,
    color: 'emerald',
    items: [
      { k: 'local.tool', t: 'db_store', label: 'Save Document', icon: HardDrive, args: { table: 'my_collection', data: {} } },
      { k: 'local.tool', t: 'db_retrieve', label: 'Get Document', icon: Search, args: { table: 'my_collection', id: '' } },
      { k: 'local.tool', t: 'db_search', label: 'Search Documents', icon: Search, args: { table: 'my_collection', filters: {}, limit: 100 } },
      { k: 'local.tool', t: 'db_delete', label: 'Delete Document', icon: Trash2, args: { table: 'my_collection', id: '' } },
      { k: 'local.tool', t: 'db_list_tables', label: 'List All Data', icon: List, args: {} },
      { k: 'local.tool', t: 'db_query', label: 'Create Table', icon: PlusCircle, args: { query: 'CREATE TABLE IF NOT EXISTS my_table (\n  id TEXT PRIMARY KEY,\n  name TEXT,\n  value TEXT\n)' } },
      { k: 'local.tool', t: 'db_query', label: 'Find Rows', icon: Search, args: { query: 'SELECT * FROM my_table LIMIT 100' } },
      { k: 'local.tool', t: 'db_query', label: 'Add Row', icon: PlusCircle, args: { query: "INSERT INTO my_table (name, value) VALUES ('', '')" } },
      { k: 'local.tool', t: 'db_query', label: 'Edit Rows', icon: PenLine, args: { query: "UPDATE my_table SET name = '' WHERE id = ''" } },
      { k: 'local.tool', t: 'db_query', label: 'Remove Rows', icon: Trash2, args: { query: "DELETE FROM my_table WHERE id = ''" } },
    ],
  },
  {
    id: 'ollama',
    label: 'Ollama (Local AI)',
    icon: Bot,
    color: 'violet',
    items: [
      { k: 'local.tool', t: 'ollama_status', label: 'Check Status', icon: Activity, args: {} },
      { k: 'local.tool', t: 'ollama_chat', label: 'Chat (Multi-turn)', icon: MessageSquare, args: { model: 'llama3.2', messages: [{ role: 'user', content: '' }] } },
      { k: 'local.tool', t: 'ollama_generate', label: 'Generate Text', icon: PenLine, args: { model: 'llama3.2', prompt: '' } },
      { k: 'local.tool', t: 'ollama_vision', label: 'Analyze Image', icon: Eye, args: { model: 'llava', prompt: 'Describe this image.', images: [{ path: '' }] } },
      { k: 'local.tool', t: 'ollama_embeddings', label: 'Embeddings', icon: Binary, args: { model: 'nomic-embed-text', input: '' } },
      { k: 'local.tool', t: 'ollama_models', label: 'List Models', icon: List, args: { action: 'list' } },
      { k: 'local.tool', t: 'ollama_models', label: 'Pull Model', icon: Download, args: { action: 'pull', model: '' } },
      { k: 'local.tool', t: 'ollama_models', label: 'Delete Model', icon: Trash2, args: { action: 'delete', model: '' } },
    ],
  },
  {
    id: 'mediapipe',
    label: 'MediaPipe (CV)',
    icon: Scan,
    color: 'lime',
    items: [
      { k: 'local.tool', t: 'mediapipe_pose', label: 'Pose Estimation', icon: Activity, args: { imagePath: '', drawLandmarks: true, modelComplexity: 1, minDetectionConfidence: 0.5 } },
      { k: 'local.tool', t: 'mediapipe_hands', label: 'Hand Tracking', icon: Scan, args: { imagePath: '', drawLandmarks: true, maxNumHands: 2, minDetectionConfidence: 0.5 } },
      { k: 'local.tool', t: 'mediapipe_face_detection', label: 'Face Detection', icon: User, args: { imagePath: '', drawDetections: true, modelSelection: 0, minDetectionConfidence: 0.5 } },
      { k: 'local.tool', t: 'mediapipe_face_mesh', label: 'Face Mesh (468pt)', icon: Scan, args: { imagePath: '', drawLandmarks: true, maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: 0.5 } },
      { k: 'local.tool', t: 'mediapipe_segmentation', label: 'Background Removal', icon: User, args: { imagePath: '', threshold: 0.5, blurBackground: false } },
      { k: 'local.tool', t: 'mediapipe_holistic', label: 'Holistic (All-in-One)', icon: Activity, args: { imagePath: '', drawLandmarks: true, modelComplexity: 1, minDetectionConfidence: 0.5 } },
      { k: 'local.tool', t: 'mediapipe_process_video', label: 'Process Video', icon: Video, args: { videoPath: '', task: 'pose', drawLandmarks: true, maxFrames: 0, sampleEveryN: 1 } },
    ],
  },
];

export const CATEGORY_COLORS: Record<string, { bg: string; border: string; hover: string; text: string; icon: string }> = {
  slate: { bg: 'bg-slate-50', border: 'border-slate-200', hover: 'hover:bg-slate-100', text: 'text-slate-700', icon: 'text-slate-500' },
  amber: { bg: 'bg-amber-50', border: 'border-amber-200', hover: 'hover:bg-amber-100', text: 'text-amber-800', icon: 'text-amber-600' },
  purple: { bg: 'bg-purple-50', border: 'border-purple-200', hover: 'hover:bg-purple-100', text: 'text-purple-800', icon: 'text-purple-600' },
  blue: { bg: 'bg-blue-50', border: 'border-blue-200', hover: 'hover:bg-blue-100', text: 'text-blue-800', icon: 'text-blue-600' },
  green: { bg: 'bg-green-50', border: 'border-green-200', hover: 'hover:bg-green-100', text: 'text-green-800', icon: 'text-green-600' },
  pink: { bg: 'bg-pink-50', border: 'border-pink-200', hover: 'hover:bg-pink-100', text: 'text-pink-800', icon: 'text-pink-600' },
  orange: { bg: 'bg-orange-50', border: 'border-orange-200', hover: 'hover:bg-orange-100', text: 'text-orange-800', icon: 'text-orange-600' },
  yellow: { bg: 'bg-yellow-50', border: 'border-yellow-200', hover: 'hover:bg-yellow-100', text: 'text-yellow-800', icon: 'text-yellow-600' },
  cyan: { bg: 'bg-cyan-50', border: 'border-cyan-200', hover: 'hover:bg-cyan-100', text: 'text-cyan-800', icon: 'text-cyan-600' },
  violet: { bg: 'bg-violet-50', border: 'border-violet-200', hover: 'hover:bg-violet-100', text: 'text-violet-800', icon: 'text-violet-600' },
  indigo: { bg: 'bg-indigo-50', border: 'border-indigo-200', hover: 'hover:bg-indigo-100', text: 'text-indigo-800', icon: 'text-indigo-600' },
  emerald: { bg: 'bg-emerald-50', border: 'border-emerald-200', hover: 'hover:bg-emerald-100', text: 'text-emerald-800', icon: 'text-emerald-600' },
  fuchsia: { bg: 'bg-fuchsia-50', border: 'border-fuchsia-200', hover: 'hover:bg-fuchsia-100', text: 'text-fuchsia-800', icon: 'text-fuchsia-600' },
  teal: { bg: 'bg-teal-50', border: 'border-teal-200', hover: 'hover:bg-teal-100', text: 'text-teal-800', icon: 'text-teal-600' },
  sky: { bg: 'bg-sky-50', border: 'border-sky-200', hover: 'hover:bg-sky-100', text: 'text-sky-800', icon: 'text-sky-600' },
  rose: { bg: 'bg-rose-50', border: 'border-rose-200', hover: 'hover:bg-rose-100', text: 'text-rose-800', icon: 'text-rose-600' },
  red: { bg: 'bg-red-50', border: 'border-red-200', hover: 'hover:bg-red-100', text: 'text-red-800', icon: 'text-red-600' },
  lime: { bg: 'bg-lime-50', border: 'border-lime-200', hover: 'hover:bg-lime-100', text: 'text-lime-800', icon: 'text-lime-600' },
};

/** Helper to find icon for a tool/trigger type */
export const getToolIcon = (type: string, isTrigger?: boolean): LucideIcon => {
  for (const cat of PALETTE_CATEGORIES) {
    const found = cat.items.find(i => i.t === type);
    if (found) return found.icon;
  }
  return isTrigger ? Zap : Command;
};

/** Helper to find category color for a tool/trigger type */
export const getToolColor = (type: string, isTrigger?: boolean): string => {
  for (const cat of PALETTE_CATEGORIES) {
    const found = cat.items.find(i => i.t === type);
    if (found) return cat.color;
  }
  return isTrigger ? 'amber' : 'slate';
};
