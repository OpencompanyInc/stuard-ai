
export type ToolCategory = 'core' | 'system' | 'input' | 'ui' | 'vision' | 'data' | 'integrations' | 'flow';

export interface ToolDefinition {
  id: string;
  category: ToolCategory;
  kind: 'local' | 'cloud' | 'orchestration';
  description: string;
  argsTemplate: any;
  outputSchema: any;
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  // --- CORE / FLOW ---
  {
    id: 'wait',
    category: 'flow',
    kind: 'local',
    description: 'Delay execution for a number of milliseconds',
    argsTemplate: { ms: 1000 },
    outputSchema: { ok: 'boolean', waitedMs: 'number' },
  },
  {
    id: 'run_sequential',
    category: 'flow',
    kind: 'orchestration',
    description: 'Run a list of tools in sequence',
    argsTemplate: { steps: [], continueOnError: false },
    outputSchema: { results: 'any[]', combined: 'object', allOk: 'boolean' },
  },
  {
    id: 'run_parallel',
    category: 'flow',
    kind: 'orchestration',
    description: 'Run a list of tools in parallel',
    argsTemplate: { steps: [], concurrency: 2 },
    outputSchema: { results: 'any[]', combined: 'object', allOk: 'boolean' },
  },
  {
    id: 'loop_executor',
    category: 'flow',
    kind: 'orchestration',
    description: 'Execute a tool repeatedly (each, times, while, until)',
    argsTemplate: {
      mode: 'each', // or 'times', 'while', 'until'
      items: ['a', 'b'],
      item_var: 'item',
      count: 3,
    },
    outputSchema: { results: 'any[]' },
  },

  // --- SYSTEM ---
  {
    id: 'run_command',
    category: 'system',
    kind: 'local',
    description: 'Run shell commands cross-platform with timeout',
    argsTemplate: {
      command: 'echo hello',
      shell: 'auto',
      timeoutMs: 30000,
      cwd: 'C:/path',
      background: false,
      terminalId: '',
    },
    outputSchema: { ok: 'boolean', stdout: 'string', stderr: 'string', exitCode: 'number', terminalId: 'string', pid: 'number', status: 'string', shell: 'string' },
  },
  {
    id: 'run_system_command',
    category: 'system',
    kind: 'local',
    description: 'Execute system commands with timeout (shell=true). Use background=true to stream output via read_terminal.',
    argsTemplate: {
      command: 'echo hello',
      timeoutMs: 30000,
      shell: true,
      background: false,
      terminalId: '',
    },
    outputSchema: { ok: 'boolean', stdout: 'string', stderr: 'string', exitCode: 'number', terminalId: 'string', pid: 'number', status: 'string', shell: 'string' },
  },
  {
    id: 'list_terminals',
    category: 'system',
    kind: 'local',
    description: 'List active and recent terminal sessions created by background run_command/run_system_command calls',
    argsTemplate: {},
    outputSchema: { ok: 'boolean', terminals: 'any[]' },
  },
  {
    id: 'read_terminal',
    category: 'system',
    kind: 'local',
    description: 'Read incremental terminal output for a terminalId (poll with sinceSeq)',
    argsTemplate: { terminalId: '', sinceSeq: 0, maxChars: 8000 },
    outputSchema: { ok: 'boolean', terminalId: 'string', chunks: 'any[]', done: 'boolean', exitCode: 'number', seq: 'number' },
  },
  {
    id: 'run_python_script',
    category: 'system',
    kind: 'local',
    description: 'Run Python code inline or from file. Optionally auto-install packages before running.',
    argsTemplate: {
      code: "import numpy as np\nprint(np.__version__)",
      packages: ["numpy", "pandas"],
      envId: "default",
      timeoutMs: 30000
    },
    outputSchema: { ok: 'boolean', stdout: 'string', stderr: 'string', exitCode: 'number', installed: 'string[]' },
  },
  {
    id: 'run_node_script',
    category: 'system',
    kind: 'local',
    description: 'Run Node.js code inline or from file',
    argsTemplate: { code: "console.log('hello')", timeoutMs: 30000 },
    outputSchema: { ok: 'boolean', stdout: 'string', stderr: 'string', exitCode: 'number' },
  },
  {
    id: 'launch_application_or_uri',
    category: 'system',
    kind: 'local',
    description: 'Launch desktop applications or open URLs',
    argsTemplate: {
      target: 'C:/Path/To/App.exe or https://example.com',
      args: ['--flag'],
    },
    outputSchema: { ok: 'boolean' },
  },
  {
    id: 'read_file',
    category: 'system',
    kind: 'local',
    description: 'Read text file contents. For files over 500 lines, use line_start/line_end to read portions.',
    argsTemplate: { path: 'C:/path/to/file.txt', line_start: 1, line_end: 100 },
    outputSchema: { ok: 'boolean', content: 'string', total_lines: 'number', line_start: 'number', line_end: 'number' },
  },

  // --- AGENTIC FILE TOOLS (for AI agents) ---
  {
    id: 'file_read',
    category: 'system',
    kind: 'local',
    description: 'Read file contents with line numbers. Use whole_file=true for small files (<650 lines), or line_start/line_end for larger files. Returns content with line numbers for precise editing.',
    argsTemplate: {
      path: 'C:/path/to/file.txt',
      whole_file: true,
      line_start: 1,
      line_end: 100
    },
    outputSchema: {
      ok: 'boolean',
      content: 'string',
      total_lines: 'number',
      line_start: 'number',
      line_end: 'number',
      lines_returned: 'number',
      truncated: 'boolean',
      error: 'string'
    },
  },
  {
    id: 'file_edit',
    category: 'system',
    kind: 'local',
    description: 'Edit file contents using string-based matching. Modes: replace (find & replace), insert_before, insert_after, delete, regex. Fails safely if string not found or has multiple matches (unless replace_all=true).',
    argsTemplate: {
      path: 'C:/path/to/file.txt',
      mode: 'replace',
      old_string: 'text to find',
      new_string: 'replacement text',
      replace_all: false
    },
    outputSchema: {
      ok: 'boolean',
      mode: 'string',
      changes: 'number',
      occurrences: 'number',
      error: 'string',
      message: 'string'
    },
  },

  {
    id: 'write_file',
    category: 'system',
    kind: 'local',
    description: 'Write text content to a file',
    argsTemplate: { path: 'C:/path/to/file.txt', content: 'Hello', append: false },
    outputSchema: { ok: 'boolean' },
  },
  {
    id: 'create_directory',
    category: 'system',
    kind: 'local',
    description: 'Create a directory on disk',
    argsTemplate: { path: 'C:/path/to/folder' },
    outputSchema: { ok: 'boolean' },
  },
  {
    id: 'list_directory',
    category: 'system',
    kind: 'local',
    description: 'List directory contents',
    argsTemplate: { path: 'C:/path/to/folder' },
    outputSchema: { ok: 'boolean', items: 'any[]' },
  },
  {
    id: 'open_file',
    category: 'system',
    kind: 'local',
    description: 'Open a file or folder with the default application',
    argsTemplate: { path: 'C:/path/to/file-or-folder' },
    outputSchema: { ok: 'boolean', opened: 'string', method: 'string' },
  },
  {
    id: 'move_file',
    category: 'system',
    kind: 'local',
    description: 'Move or rename files and directories',
    argsTemplate: { src: 'C:/old.txt', dest: 'C:/new.txt' },
    outputSchema: { ok: 'boolean' },
  },
  {
    id: 'list_open_windows',
    category: 'system',
    kind: 'local',
    description: 'List all open windows and their basic properties',
    argsTemplate: {},
    outputSchema: { ok: 'boolean', windows: 'any[]' },
  },
  {
    id: 'bring_window_to_foreground',
    category: 'system',
    kind: 'local',
    description: 'Activate and focus a window by title',
    argsTemplate: { title: 'Untitled - Notepad' },
    outputSchema: { ok: 'boolean' },
  },
  {
    id: 'smart_bring_window_to_foreground',
    category: 'system',
    kind: 'local',
    description: 'Intelligently find and activate a window, launching the app if needed',
    argsTemplate: { hint: 'Epic Games Launcher' },
    outputSchema: { ok: 'boolean' },
  },

  {
    id: 'get_window_info',
    category: 'system',
    kind: 'local',
    description: 'Get details about a specific window',
    argsTemplate: { title: 'Untitled - Notepad' },
    outputSchema: { ok: 'boolean', bounds: 'object' },
  },
  {
    id: 'set_window_bounds',
    category: 'system',
    kind: 'local',
    description: 'Move and/or resize a window',
    argsTemplate: { title: 'Untitled - Notepad', bounds: { x: 0, y: 0, width: 800, height: 600 }, bringToTop: true },
    outputSchema: { ok: 'boolean', bounds: 'object' },
  },

  // --- INPUT ---
  {
    id: 'get_mouse_position',
    category: 'input',
    kind: 'local',
    description: 'Get the current mouse cursor position on screen',
    argsTemplate: {},
    outputSchema: { ok: 'boolean', x: 'number', y: 'number' },
  },
  {
    id: 'computer_use',
    category: 'input',
    kind: 'local',
    description: 'Perform GUI actions (mouse/keyboard) and optionally capture a screenshot',
    argsTemplate: {
      action: 'left_click',
      coordinate: [500, 500],
      includeScreenshot: true,
      returnDataUrl: false,
    },
    outputSchema: { ok: 'boolean', action: 'string', filePath: 'string', screenshot: 'string' },
  },
  {
    id: 'computer_use_agent',
    category: 'input',
    kind: 'cloud',
    description: 'Autonomous computer control loop driven by a vision model (e.g., Qwen3-VL via OpenRouter). Repeats screenshot -> decide action -> execute until terminate.',
    argsTemplate: {
      goal: 'Open Notepad and type Hello world',
      context: '',
      maxSteps: 30,
      timeoutMs: 120000,
    },
    outputSchema: {
      ok: 'boolean',
      status: 'string',
      answer: 'string',
      error: 'string',
      modelResponsePreview: 'string',
      modelAction: 'any',
      modelValidationIssues: 'any[]',
      steps: 'any[]',
    },
  },
  {
    id: 'send_hotkey',
    category: 'input',
    kind: 'local',
    description: 'Send keyboard hotkey combinations',
    argsTemplate: { keys: ['windows', 'd'] },
    outputSchema: { ok: 'boolean' },
  },
  {
    id: 'type_text',
    category: 'input',
    kind: 'local',
    description: 'Type text at cursor position',
    argsTemplate: { text: 'Hello', useClipboardFallback: false },
    outputSchema: { ok: 'boolean' },
  },
  {
    id: 'click_at_coordinates',
    category: 'input',
    kind: 'local',
    description: 'Click at specific screen coordinates',
    argsTemplate: { x: 100, y: 100, button: 'left' },
    outputSchema: { ok: 'boolean' },
  },
  {
    id: 'double_click_at_coordinates',
    category: 'input',
    kind: 'local',
    description: 'Double-click at specific screen coordinates',
    argsTemplate: { x: 100, y: 100, button: 'left' },
    outputSchema: { ok: 'boolean' },
  },
  {
    id: 'scroll',
    category: 'input',
    kind: 'local',
    description: 'Scroll the mouse wheel vertically and optionally horizontally',
    argsTemplate: { deltaY: 120, deltaX: 0, speed: 1 },
    outputSchema: { ok: 'boolean' },
  },
  {
    id: 'drag_and_drop',
    category: 'input',
    kind: 'local',
    description: 'Drag from one coordinate to another',
    argsTemplate: { fromX: 100, fromY: 100, toX: 400, toY: 400 },
    outputSchema: { ok: 'boolean' },
  },
  {
    id: 'get_clipboard_content',
    category: 'input',
    kind: 'local',
    description: 'Read text from the clipboard',
    argsTemplate: {},
    outputSchema: { ok: 'boolean', text: 'string' },
  },
  {
    id: 'set_clipboard_content',
    category: 'input',
    kind: 'local',
    description: 'Set text into the clipboard',
    argsTemplate: { text: 'Hello from Stuard' },
    outputSchema: { ok: 'boolean' },
  },

  // --- VISION / MEDIA ---
  {
    id: 'take_screenshot',
    category: 'vision',
    kind: 'local',
    description: 'Capture screenshot and return a local file path',
    argsTemplate: { region: { x: 0, y: 0, width: 800, height: 600 }, hideUI: false },
    outputSchema: { ok: 'boolean', filePath: 'string' },
  },
  {
    id: 'capture_media',
    category: 'vision',
    kind: 'local',
    description: 'Capture photos, videos, or audio. Use mode="until_stop" to capture indefinitely until stop_capture is called.',
    argsTemplate: {
      kind: 'audio', // 'photo' | 'video' | 'audio'
      mode: 'fixed', // 'fixed' (default) or 'until_stop'
      durationMs: 5000, // required for fixed mode video/audio
      device: '',
      filePath: '',
      sessionId: '', // for until_stop mode, auto-generated if not provided
      maxDurationMs: 600000, // safety limit for until_stop mode (10 min default)
    },
    outputSchema: {
      ok: 'boolean',
      filePath: 'string',
      mimeType: 'string',
      sessionId: 'string',
      stoppedBy: 'string', // 'stop_signal' or 'max_duration' for until_stop mode
    },
  },
  {
    id: 'stop_capture',
    category: 'vision',
    kind: 'local',
    description: 'Stop an active capture session started with capture_media in until_stop mode',
    argsTemplate: {
      sessionId: '', // required: session ID to stop
    },
    outputSchema: {
      ok: 'boolean',
      sessionId: 'string',
      wasActive: 'boolean',
    },
  },
  {
    id: 'list_active_captures',
    category: 'vision',
    kind: 'local',
    description: 'List all currently active capture sessions',
    argsTemplate: {},
    outputSchema: {
      ok: 'boolean',
      sessions: 'string[]',
    },
  },
  {
    id: 'analyze_image',
    category: 'vision',
    kind: 'cloud',
    description: 'Analyze an image file with AI vision',
    argsTemplate: { imagePath: 'C:/screen.png', prompt: 'Describe this' },
    outputSchema: { text: 'string' },
  },
  {
    id: 'analyze_current_screen',
    category: 'vision',
    kind: 'cloud',
    description: 'Capture and analyze the current screen in one step',
    argsTemplate: {
      mode: 'text', // or 'json', 'boolean'
      prompt: 'What is on screen?',
      booleanKey: 'is_error_present'
    },
    outputSchema: { text: 'string', json: 'any', boolean: 'boolean' },
  },
  {
    id: 'analyze_media',
    category: 'vision',
    kind: 'cloud',
    description: 'Analyze video/audio files or YouTube URLs with AI (Gemini 2.5 Flash or 2.5 Pro thinking)',
    argsTemplate: {
      task: 'Summarize this media with key takeaways',
      sources: [{ path: 'C:/video.mp4' }],
      thinking: false,
    },
    outputSchema: { summary: 'string' },
  },
  {
    id: 'ai_inference',
    category: 'data',
    kind: 'cloud',
    description: 'Run AI inference on text. Returns plain text or structured JSON. Use for summarization, classification, extraction, Q&A, or any text transformation.',
    argsTemplate: {
      prompt: 'Classify the sentiment of this text',
      input: 'I love this product!',
      mode: 'json',
      schema: { sentiment: 'string', confidence: 'number', keywords: 'string[]' },
      model: 'openai/gpt-4.1-mini',
      temperature: 0.3,
    },
    outputSchema: { ok: 'boolean', text: 'string', json: 'any', model: 'string' },
  },
  {
    id: 'stream_speech',
    category: 'vision',
    kind: 'local',
    description: 'Stream microphone audio to the cloud speech proxy',
    argsTemplate: {
      accessToken: '{{ input.accessToken }}',
      device: '',
      busId: 'default',
      durationMs: 60000,
      sampleRate: 16000,
    },
    outputSchema: { ok: 'boolean', sessionId: 'string' },
  },
  {
    id: 'stop_stream_speech',
    category: 'vision',
    kind: 'local',
    description: 'Stop an active stream_speech audio session',
    argsTemplate: { busId: 'default' },
    outputSchema: { ok: 'boolean', busId: 'string' },
  },

  // --- AUDIO PLAYBACK ---
  {
    id: 'play_audio',
    category: 'vision',  // Media tools use 'vision' category
    kind: 'local',
    description: 'Play an audio file (MP3, WAV, etc.) using cross-platform audio playback',
    argsTemplate: {
      path: 'C:\\path\\to\\audio.mp3',
      block: true, // Wait for playback to complete
    },
    outputSchema: { ok: 'boolean', played: 'string', method: 'string', error: 'string' },
  },

  {
    id: 'ffmpeg_status',
    category: 'vision',
    kind: 'local',
    description: 'Check if FFmpeg is available locally (downloaded or system-installed).',
    argsTemplate: {},
    outputSchema: {
      ok: 'boolean',
      available: 'boolean',
      source: 'string',
      ffmpegPath: 'string',
      ffprobePath: 'string',
      meta: 'any',
    },
  },
  {
    id: 'ffmpeg_setup',
    category: 'vision',
    kind: 'local',
    description: 'Ensure FFmpeg is available locally (auto-downloads if needed).',
    argsTemplate: {},
    outputSchema: {
      ok: 'boolean',
      available: 'boolean',
      source: 'string',
      ffmpegPath: 'string',
      ffprobePath: 'string',
      meta: 'any',
      error: 'string',
      message: 'string',
    },
  },
  {
    id: 'ffmpeg_run',
    category: 'vision',
    kind: 'local',
    description: 'Run FFmpeg with custom arguments. Use for advanced conversions and edits.',
    argsTemplate: {
      args: ['-hide_banner', '-i', 'C:/input.mp4', 'C:/output.mp4'],
      timeoutMs: 300000,
      cwd: '',
    },
    outputSchema: { ok: 'boolean', exitCode: 'number', stdout: 'string', stderr: 'string', ffmpegPath: 'string' },
  },
  {
    id: 'ffmpeg_convert_media',
    category: 'vision',
    kind: 'local',
    description: 'Convert media from one format to another using FFmpeg.',
    argsTemplate: {
      inputPath: 'C:/input.mp4',
      outputPath: 'C:/output.webm',
      overwrite: true,
      extraArgs: ['-c:v', 'libvpx-vp9', '-crf', 30, '-b:v', 0],
      timeoutMs: 300000,
      cwd: '',
    },
    outputSchema: { ok: 'boolean', exitCode: 'number', stdout: 'string', stderr: 'string', ffmpegPath: 'string' },
  },
  {
    id: 'ffmpeg_extract_audio',
    category: 'vision',
    kind: 'local',
    description: 'Extract audio from a media file into an audio-only output (e.g. mp3, wav).',
    argsTemplate: {
      inputPath: 'C:/input.mp4',
      outputPath: 'C:/output.mp3',
      overwrite: true,
      timeoutMs: 300000,
      cwd: '',
    },
    outputSchema: { ok: 'boolean', exitCode: 'number', stdout: 'string', stderr: 'string', ffmpegPath: 'string' },
  },
  {
    id: 'ffmpeg_trim_media',
    category: 'vision',
    kind: 'local',
    description: 'Trim a media file to a time range (fast copy mode).',
    argsTemplate: {
      inputPath: 'C:/input.mp4',
      outputPath: 'C:/clip.mp4',
      startSeconds: 0,
      durationSeconds: 10,
      overwrite: true,
      timeoutMs: 300000,
      cwd: '',
    },
    outputSchema: { ok: 'boolean', exitCode: 'number', stdout: 'string', stderr: 'string', ffmpegPath: 'string' },
  },
  {
    id: 'ffmpeg_probe_media',
    category: 'vision',
    kind: 'local',
    description: 'Inspect a media file using ffprobe and return JSON metadata.',
    argsTemplate: {
      inputPath: 'C:/input.mp4',
      timeoutMs: 300000,
      cwd: '',
    },
    outputSchema: { ok: 'boolean', data: 'any', stdout: 'string', stderr: 'string', ffprobePath: 'string' },
  },
  {
    id: 'ffmpeg_extract_frames',
    category: 'vision',
    kind: 'local',
    description: 'Extract image frames from a video to a numbered file pattern.',
    argsTemplate: {
      inputPath: 'C:/input.mp4',
      outputPattern: 'C:/frames/%04d.jpg',
      overwrite: true,
      fps: 1,
      startSeconds: 0,
      durationSeconds: 5,
      timeoutMs: 300000,
      cwd: '',
    },
    outputSchema: { ok: 'boolean', exitCode: 'number', stdout: 'string', stderr: 'string', ffmpegPath: 'string' },
  },

  // --- TEXT TO SPEECH ---
  {
    id: 'text_to_speech',
    category: 'vision',
    kind: 'cloud',
    description: 'Convert text to speech audio using OpenAI TTS. Can optionally save to file and/or play immediately.',
    argsTemplate: {
      text: 'Hello, how can I help you today?',
      voice: 'alloy', // alloy, echo, fable, onyx, nova, shimmer
      speed: 1.0,
      format: 'mp3',
      save: true, // save to file
      play: false, // play audio immediately
      outputPath: '', // optional custom path
    },
    outputSchema: { ok: 'boolean', filePath: 'string', format: 'string', voice: 'string', textLength: 'number', played: 'boolean', error: 'string' },
  },
  {
    id: 'list_tts_voices',
    category: 'vision',
    kind: 'cloud',
    description: 'List all available text-to-speech voices with their characteristics',
    argsTemplate: {},
    outputSchema: { ok: 'boolean', voices: 'any[]' },
  },

  // --- SEARCH ---
  {
    id: 'web_search',
    category: 'data',
    kind: 'cloud',
    description: 'Search the web using Perplexity AI to get ranked, citation-backed results.',
    argsTemplate: {
      query: 'latest AI developments',
      max_results: 5,
      max_tokens_per_page: 1024
    },
    outputSchema: { results: 'any[]', id: 'string' },
  },

  {
    id: 'scrape_url',
    category: 'data',
    kind: 'cloud',
    description: 'Extract/scrape raw page content from one or more URLs using Tavily Extract.',
    argsTemplate: {
      urls: ['https://stuard.ai'],
      includeImages: false,
      extractDepth: 'advanced',
      format: 'markdown',
      timeout: 30000,
      includeFavicon: false,
      includeUsage: false,
    },
    outputSchema: { results: 'any[]', failedResults: 'any[]', responseTime: 'number', requestId: 'string' },
  },

  // --- SPACES (PATH / FOLDERS) ---
  {
    id: 'ensure_space_path',
    category: 'data',
    kind: 'local',
    description: 'Ensure a folder path exists inside a space (creates nested folders as needed).',
    argsTemplate: {
      space_id: '{{ input.space_id }}',
      path: 'Project/Notes',
    },
    outputSchema: { ok: 'boolean', folder_id: 'string', created: 'boolean', error: 'string' },
  },
  {
    id: 'list_space_path',
    category: 'data',
    kind: 'local',
    description: 'List items inside a folder path within a space.',
    argsTemplate: {
      space_id: '{{ input.space_id }}',
      path: 'Project/Notes',
      type: 'note',
      limit: 200,
    },
    outputSchema: { ok: 'boolean', folder_id: 'string', items: 'any[]', error: 'string' },
  },
  {
    id: 'add_to_space_path',
    category: 'data',
    kind: 'local',
    description: 'Add an item (note/source/link/file/fact/snippet) under a folder path within a space.',
    argsTemplate: {
      space_id: '{{ input.space_id }}',
      path: 'Project/Notes',
      type: 'note',
      title: 'Quick note',
      content: '...'
    },
    outputSchema: { ok: 'boolean', item: 'any', folder_id: 'string', error: 'string' },
  },
  {
    id: 'get_space_tree',
    category: 'data',
    kind: 'local',
    description: 'Get the full folder tree for a space as a nested structure.',
    argsTemplate: {
      space_id: '{{ input.space_id }}',
    },
    outputSchema: { ok: 'boolean', tree: 'any[]', error: 'string' },
  },

  // --- BROWSER ---
  {
    id: 'browser_get_content',
    category: 'integrations',
    kind: 'local',
    description: 'Get the content of the currently active tab in the browser extension. Returns title, URL, and page text.',
    argsTemplate: {},
    outputSchema: { ok: 'boolean', title: 'string', url: 'string', text: 'string', html: 'string' },
  },
  {
    id: 'browser_click_element',
    category: 'integrations',
    kind: 'local',
    description: 'Click an element in the active browser tab. You can provide a text label (fallback to fuzzy match) or a CSS selector.',
    argsTemplate: { text: 'Login', selector: '' },
    outputSchema: { ok: 'boolean' },
  },
  {
    id: 'browser_type_text',
    category: 'integrations',
    kind: 'local',
    description: 'Type text into an input field in the active browser tab. Supports contenteditable elements and can press Enter after typing.',
    argsTemplate: { text: 'myusername', selector: '', replace: true, pressEnter: false },
    outputSchema: { ok: 'boolean', typed: 'boolean', length: 'number' },
  },
  {
    id: 'browser_find_text',
    category: 'integrations',
    kind: 'local',
    description: 'Find all occurrences of text on the page with their positions. Returns element info, coordinates, and whether each match is clickable.',
    argsTemplate: { text: 'Search text', caseSensitive: false, limit: 20 },
    outputSchema: { found: 'boolean', count: 'number', matches: 'array' },
  },
  {
    id: 'browser_get_element_position',
    category: 'integrations',
    kind: 'local',
    description: 'Get the exact position and bounding box of an element. Returns viewport and document coordinates, dimensions, and element metadata.',
    argsTemplate: { selector: '#element-id', text: '', index: 0 },
    outputSchema: { found: 'boolean', position: 'object', element: 'object' },
  },
  {
    id: 'browser_find_clickable',
    category: 'integrations',
    kind: 'local',
    description: 'Find all clickable elements on the page (buttons, links, interactive elements). Returns their positions, text, and selectors.',
    argsTemplate: { limit: 50, visibleOnly: true, includeText: true },
    outputSchema: { count: 'number', elements: 'array' },
  },
  {
    id: 'browser_hover',
    category: 'integrations',
    kind: 'local',
    description: 'Hover over an element to trigger hover effects, tooltips, or dropdown menus.',
    argsTemplate: { text: 'Menu', selector: '', index: 0, duration: 100 },
    outputSchema: { hovered: 'boolean', tag: 'string', position: 'object' },
  },
  {
    id: 'browser_select_option',
    category: 'integrations',
    kind: 'local',
    description: 'Select an option from a dropdown/select element. Can select by value, visible text, or index.',
    argsTemplate: { selector: 'select#country', value: '', text: 'United States', index: null },
    outputSchema: { selected: 'boolean', value: 'string', text: 'string', index: 'number' },
  },
  {
    id: 'browser_press_key',
    category: 'integrations',
    kind: 'local',
    description: 'Press a keyboard key in the browser, optionally with modifier keys (Ctrl, Shift, Alt, Meta).',
    argsTemplate: { key: 'Enter', ctrl: false, shift: false, alt: false, meta: false, target: '' },
    outputSchema: { pressed: 'boolean', key: 'string' },
  },
  {
    id: 'browser_get_form_fields',
    category: 'integrations',
    kind: 'local',
    description: 'Get all form fields on the page with their types, names, labels, and current values. Useful for understanding what data to fill.',
    argsTemplate: { selector: '', formIndex: 0 },
    outputSchema: { formFound: 'boolean', fields: 'array' },
  },
  {
    id: 'browser_fill_form',
    category: 'integrations',
    kind: 'local',
    description: 'Fill multiple form fields at once using a field name/value mapping. Can optionally submit the form.',
    argsTemplate: { fields: { username: 'john', email: 'john@example.com' }, selector: '', formIndex: 0, submit: false },
    outputSchema: { filled: 'array', errors: 'array', submitted: 'boolean' },
  },
  {
    id: 'browser_wait_for_element',
    category: 'integrations',
    kind: 'local',
    description: 'Wait for an element to appear on the page. Useful after clicking something that loads new content.',
    argsTemplate: { selector: '.loading-complete', text: '', timeout: 10000, pollInterval: 100 },
    outputSchema: { found: 'boolean', waitTime: 'number', element: 'object' },
  },
  {
    id: 'browser_scroll_to',
    category: 'integrations',
    kind: 'local',
    description: 'Scroll the page to an element, coordinates, or direction (up/down/left/right/top/bottom).',
    argsTemplate: { selector: '', text: '', direction: 'down', amount: 300, smooth: true },
    outputSchema: { scrolled: 'boolean', target: 'string', x: 'number', y: 'number' },
  },
  {
    id: 'browser_get_page_info',
    category: 'integrations',
    kind: 'local',
    description: 'Get comprehensive page information including URL, forms, links, inputs, and buttons. Useful for understanding page structure.',
    argsTemplate: {},
    outputSchema: { url: 'string', title: 'string', forms: 'array', links: 'array', inputs: 'array', buttons: 'array' },
  },
  {
    id: 'browser_execute_script',
    category: 'integrations',
    kind: 'local',
    description: 'Execute JavaScript code in the browser page context. Use for advanced interactions not covered by other tools.',
    argsTemplate: { script: 'return document.title;', args: {} },
    outputSchema: { success: 'boolean', result: 'any', error: 'string' },
  },

  // --- UI ---
  {
    id: 'custom_ui',
    category: 'ui',
    kind: 'local',
    description: 'Display custom interactive overlay UI with HTML + Tailwind CSS. Features: data-bind for inputs, data-action for buttons. FILE PICKERS: Use data-action="pick_file|pick_files|pick_folder|pick_save_path" with data-target="fieldName" to open native dialogs and populate inputs.',
    argsTemplate: {
      id: 'my-panel',
      title: 'My Custom UI',
      window: { width: 400, height: 500, position: 'center', alwaysOnTop: true, transparent: true, frameless: true },
      blocking: true,
      // update: true,  // Update existing window instead of creating new
      // keepOpen: true, // Keep window open after action (for loops)
      // timeoutMs: 60000, // Auto-close timeout
      css: `
        .root { padding: 20px; font-family: sans-serif; color: #fff; }
        .title { font-size: 24px; font-weight: bold; margin-bottom: 20px; }
        .input { width: 100%; padding: 10px; margin-bottom: 10px; border-radius: 6px; border: 1px solid #444; background: #222; color: #fff; }
        .btn { width: 100%; padding: 10px; background: #007acc; color: white; border: none; border-radius: 6px; cursor: pointer; margin-bottom: 8px; }
        .btn:hover { background: #005fa3; }
      `,
      // Option 1: Structured layout (recommended for data binding)
      layout: {
        type: 'div',
        className: 'root',
        children: [
          { type: 'div', className: 'title', children: 'Hello World' },
          { type: 'input', className: 'input', bind: 'userInput', placeholder: 'Type something...' },
          { type: 'button', className: 'btn', children: 'Submit', action: 'submit' },
          { type: 'button', className: 'btn', children: 'Cancel', action: 'cancel' }
        ]
      },
      // Option 2: Raw HTML string (use data-action="actionName" for buttons)
      // html: '<div class="root"><h1>Hello</h1><button data-action="submit">Submit</button></div>',
      data: { userInput: '' },
    },
    outputSchema: { ok: 'boolean', action: 'string (the button action clicked: submit, cancel, record, exit, etc.)', data: 'object' },
  },
  {
    id: 'update_custom_ui',
    category: 'ui',
    kind: 'local',
    description: 'Update existing custom_ui window with new content. Same as calling custom_ui with same ID - window is reused, not recreated. Use for multi-screen flows.',
    argsTemplate: {
      id: 'my-panel',
      title: 'Screen 2',
      // New content replaces old
      html: '<div>New screen content</div>',
      // Or use layout
      // layout: { type: 'div', children: [...] },
      css: '...',
      data: { step: 2 },
      // Window auto-resizes if dimensions change
      window: { width: 500, height: 400 }
    },
    outputSchema: { ok: 'boolean', action: 'string', data: 'object' },
  },
  {
    id: 'close_custom_ui',
    category: 'ui',
    kind: 'local',
    description: 'Close a UI window',
    argsTemplate: { id: 'my-panel' },
    outputSchema: { ok: 'boolean' },
  },

  // --- GENUI COMPONENTS (Human-in-the-Loop) ---
  {
    id: 'ask_confirmation',
    category: 'ui',
    kind: 'local',
    description: 'Show a confirmation dialog to the user. Use for destructive actions like file deletion, process termination, or irreversible operations. Blocks until user responds.',
    argsTemplate: {
      title: 'Confirm Action',
      message: 'Are you sure you want to proceed?',
      confirmLabel: 'Confirm',
      cancelLabel: 'Cancel',
      variant: 'warning' // 'danger' | 'warning' | 'info'
    },
    outputSchema: { confirmed: 'boolean' },
  },
  {
    id: 'show_choices',
    category: 'ui',
    kind: 'local',
    description: 'Present multiple choice options to the user as selectable chips/cards. Use when the user needs to pick one option from several (e.g., "Which microphone?", "Select format").',
    argsTemplate: {
      title: 'Select an option',
      choices: [
        { id: 'option1', label: 'Option 1', sublabel: 'Description' },
        { id: 'option2', label: 'Option 2' }
      ]
    },
    outputSchema: { selectedId: 'string' },
  },
  {
    id: 'pick_date',
    category: 'ui',
    kind: 'local',
    description: 'Show a calendar date picker. Use for scheduling meetings, setting reminders, or any date input.',
    argsTemplate: {
      label: 'Select a date',
      minDate: '2024-01-01' // Optional ISO date string
    },
    outputSchema: { date: 'string (ISO format)' },
  },
  {
    id: 'request_files',
    category: 'ui',
    kind: 'local',
    description: 'Show a file dropzone for the user to drag and drop or select files. Use when analyzing documents, images, or any file-based task.',
    argsTemplate: {
      label: 'Drop files here',
      accept: '.pdf,.png,.jpg', // File extensions
      maxFiles: 5
    },
    outputSchema: { files: 'array of { name, path, size, type }' },
  },
  {
    id: 'show_table',
    category: 'ui',
    kind: 'local',
    description: 'Display data in an interactive table with sorting and filtering. Use for showing lists of files, search results, or structured data.',
    argsTemplate: {
      title: 'Results',
      columns: [
        { key: 'name', header: 'Name', sortable: true },
        { key: 'size', header: 'Size', sortable: true }
      ],
      data: [
        { name: 'example.txt', size: '10 KB' }
      ],
      pageSize: 5
    },
    outputSchema: { action: 'string', row: 'object (when row clicked)' },
  },
  {
    id: 'show_info',
    category: 'ui',
    kind: 'local',
    description: 'Display key-value pairs in a clean grid format. Use for system specs, metadata, or structured information display.',
    argsTemplate: {
      title: 'System Information',
      items: [
        { key: 'Processor', value: 'Intel i7', copyable: true },
        { key: 'Memory', value: '32GB' }
      ],
      columns: 2 // 1 or 2
    },
    outputSchema: { ok: 'boolean' },
  },
  {
    id: 'show_details',
    category: 'ui',
    kind: 'local',
    description: 'Show expandable/collapsible sections for long content. Use for error logs, explanations, or detailed information.',
    argsTemplate: {
      sections: [
        { id: 'error', title: 'Error Log', content: 'Stack trace...', icon: 'error', defaultOpen: false }
      ],
      allowMultiple: false
    },
    outputSchema: { ok: 'boolean' },
  },
  {
    id: 'show_files',
    category: 'ui',
    kind: 'local',
    description: 'Display a file/folder tree structure. Use when showing project structure or directory contents.',
    argsTemplate: {
      title: 'Project Structure',
      nodes: [
        {
          name: 'src', type: 'folder', children: [
            { name: 'index.ts', type: 'file' }
          ]
        }
      ]
    },
    outputSchema: { action: 'string', node: 'object (when file selected)' },
  },
  {
    id: 'show_command',
    category: 'ui',
    kind: 'local',
    description: 'Display a terminal command block with optional "Run" button. Use when suggesting commands the user can execute.',
    argsTemplate: {
      command: 'npm install express',
      title: 'Terminal',
      autoRun: false // If true, runs immediately
    },
    outputSchema: { executed: 'boolean', output: 'string' },
  },
  {
    id: 'show_json',
    category: 'ui',
    kind: 'local',
    description: 'Display JSON data in a collapsible tree viewer. Use for API responses, config files, or debugging.',
    argsTemplate: {
      title: 'API Response',
      data: { status: 'ok', items: [] },
      expanded: true,
      maxDepth: 5
    },
    outputSchema: { ok: 'boolean' },
  },
  {
    id: 'show_link',
    category: 'ui',
    kind: 'local',
    description: 'Display a rich link preview card with image, title, and description. Use for web search results or external resources.',
    argsTemplate: {
      url: 'https://example.com',
      title: 'Example Site',
      description: 'A description of the site',
      image: 'https://example.com/og-image.jpg',
      siteName: 'Example'
    },
    outputSchema: { action: 'string', url: 'string' },
  },
  {
    id: 'show_colors',
    category: 'ui',
    kind: 'local',
    description: 'Display a color palette with clickable swatches. Use for design tasks or color scheme suggestions.',
    argsTemplate: {
      title: 'Sunset Palette',
      colors: [
        { hex: '#FF6B35', name: 'Coral' },
        { hex: '#F7931E', name: 'Orange' },
        { hex: '#FFD700', name: 'Gold' }
      ]
    },
    outputSchema: { ok: 'boolean' },
  },
  {
    id: 'show_progress',
    category: 'ui',
    kind: 'local',
    description: 'Display a progress bar for long-running tasks. Call repeatedly to update progress.',
    argsTemplate: {
      progress: 50, // 0-100
      label: 'Downloading...',
      sublabel: '50 MB / 100 MB',
      variant: 'download', // 'download' | 'upload' | 'task'
      status: 'active', // 'active' | 'complete' | 'error' | 'paused'
      color: 'blue' // 'blue' | 'emerald' | 'amber' | 'purple'
    },
    outputSchema: { ok: 'boolean' },
  },

  // --- WORKFLOW MODIFICATION ---
  {
    id: 'modify_workflow',
    category: 'flow',
    kind: 'cloud',
    description: 'Modify a workflow using high-level operations. The workflow is auto-loaded from session - DO NOT pass the full workflow JSON. Triggers are steps: use update_node/remove_node with the trigger id (trig_*). Operations: add_node, update_node, remove_node, add_wire, remove_wire, set_path, add_variable, rename.',
    argsTemplate: {
      op: 'add_node | update_node | remove_node | add_wire | remove_wire | set_path | add_variable | rename',
      // For add_node:
      tool: 'tool_name',
      args: {},
      label: 'Step Label',
      connectFrom: 'trig_0',
      // For update_node/remove_node:
      nodeId: 'step_abc (or trig_0 for trigger)',
      stepId: 'alias for nodeId',
      // For trigger steps (add/update):
      triggerType: 'manual | hotkey | keystroke | schedule.cron | webhook.local | fs.watch',
      triggerArgs: {},
      // For add_wire/remove_wire:
      from: 'source_id',
      to: 'target_id',
      guard: { if: 'condition' },
      // For set_path:
      path: 'triggers[0].args.sequence',
      value: 'new_value',
      // For add_variable:
      varName: 'counter',
      varType: 'number',
      varDefault: 0,
      // For rename:
      name: 'New Workflow Name',
    },
    outputSchema: { ok: 'boolean', workflow: 'object', message: 'string', error: 'string' },
  },

  // --- WORKFLOW CONTROL ---
  {
    id: 'end',
    category: 'flow',
    kind: 'local',
    description: 'Terminate the workflow gracefully. Use this in loop automations when user clicks an exit button.',
    argsTemplate: {},
    outputSchema: { ok: 'boolean', terminated: 'boolean' },
  },
  {
    id: 'return_value',
    category: 'flow',
    kind: 'local',
    description: 'Return a value from a workflow and terminate execution. Use this to implement custom tools via workflows.',
    argsTemplate: { value: {} },
    outputSchema: { ok: 'boolean', terminated: 'boolean', value: 'any' },
  },
  {
    id: 'log',
    category: 'flow',
    kind: 'local',
    description: 'Log a message to the workflow execution log',
    argsTemplate: { message: 'Step completed' },
    outputSchema: { ok: 'boolean', logged: 'string' },
  },

  // --- DATA / TASKS ---
  {
    id: 'task_crud',
    category: 'data',
    kind: 'local',
    description: 'Create/Read/Update/Delete tasks',
    argsTemplate: { action: 'create', task: { title: 'Buy milk' } },
    outputSchema: { ok: 'boolean', task: 'object' },
  },
  {
    id: 'task_reminders',
    category: 'data',
    kind: 'local',
    description: 'Schedule/List reminders',
    argsTemplate: { action: 'schedule', taskId: '123', time: '2024-01-01T10:00:00Z' },
    outputSchema: { ok: 'boolean' },
  },
  {
    id: 'planner_list_items',
    category: 'data',
    kind: 'local',
    description: 'Get unified list of tasks/reminders',
    argsTemplate: { start: '2024-01-01', end: '2024-01-02' },
    outputSchema: { items: 'any[]' },
  },

  {
    id: 'gmail_send_message',
    category: 'integrations',
    kind: 'cloud',
    description: 'Send an email via Gmail. Requires gmail.send.',
    argsTemplate: {
      to: ['recipient@example.com'],
      subject: 'Subject line',
      body: 'Email content',
      contentType: 'text/plain'
    },
    outputSchema: { message: 'object' },
  },
  {
    id: 'gmail_list_messages',
    category: 'integrations',
    kind: 'cloud',
    description: 'List Gmail messages. Requires gmail.readonly.',
    argsTemplate: {
      q: '',
      labelIds: [],
      maxResults: 10,
      includeSpamTrash: false
    },
    outputSchema: { items: 'any[]', count: 'number', nextPageToken: 'string' },
  },
  {
    id: 'gmail_get_message_brief',
    category: 'integrations',
    kind: 'cloud',
    description: 'Get a Gmail message brief (from, subject, date, snippet). Requires gmail.readonly.',
    argsTemplate: { id: 'message-id' },
    outputSchema: { message: 'object' },
  },
  {
    id: 'gmail_get_message_full',
    category: 'integrations',
    kind: 'cloud',
    description: 'Get a Gmail message with full content. Requires gmail.readonly.',
    argsTemplate: { id: 'message-id' },
    outputSchema: { message: 'object' },
  },
  {
    id: 'gmail_modify_message',
    category: 'integrations',
    kind: 'cloud',
    description: 'Modify Gmail message labels (mark as read/unread, archive, etc.). Requires gmail.modify.',
    argsTemplate: {
      id: 'message-id',
      addLabelIds: ['INBOX'],
      removeLabelIds: ['UNREAD']
    },
    outputSchema: { message: 'object' },
  },
  {
    id: 'gmail_delete_message',
    category: 'integrations',
    kind: 'cloud',
    description: 'Delete a Gmail message permanently. Requires gmail.modify.',
    argsTemplate: { id: 'message-id' },
    outputSchema: { ok: 'boolean' },
  },
  {
    id: 'gmail_archive_message',
    category: 'integrations',
    kind: 'cloud',
    description: 'Archive a Gmail message (remove from inbox). Requires gmail.modify.',
    argsTemplate: { id: 'message-id' },
    outputSchema: { message: 'object' },
  },
  {
    id: 'gmail_mark_as_read',
    category: 'integrations',
    kind: 'cloud',
    description: 'Mark a Gmail message as read. Requires gmail.modify.',
    argsTemplate: { id: 'message-id' },
    outputSchema: { message: 'object' },
  },
  {
    id: 'gmail_mark_as_unread',
    category: 'integrations',
    kind: 'cloud',
    description: 'Mark a Gmail message as unread. Requires gmail.modify.',
    argsTemplate: { id: 'message-id' },
    outputSchema: { message: 'object' },
  },
  {
    id: 'calendar_delete_event',
    category: 'integrations',
    kind: 'cloud',
    description: 'Delete a Google Calendar event. Requires calendar.events.',
    argsTemplate: {
      calendarId: 'primary',
      eventId: 'event-id',
      sendUpdates: 'none',
    },
    outputSchema: { ok: 'boolean', calendarId: 'string', eventId: 'string' },
  },
  {
    id: 'youtube_get_video',
    category: 'integrations',
    kind: 'cloud',
    description: 'Get detailed information about a YouTube video by URL or video ID',
    argsTemplate: { url: 'https://www.youtube.com/watch?v=VIDEO_ID' },
    outputSchema: { ok: 'boolean', video: 'object', error: 'string' },
  },
  {
    id: 'youtube_get_channel',
    category: 'integrations',
    kind: 'cloud',
    description: 'Get information about a YouTube channel by URL, handle, or channel ID',
    argsTemplate: { url: 'https://www.youtube.com/@handle' },
    outputSchema: { ok: 'boolean', channel: 'object', error: 'string' },
  },
  {
    id: 'youtube_get_playlist',
    category: 'integrations',
    kind: 'cloud',
    description: 'Get information about a YouTube playlist and its videos',
    argsTemplate: { url: 'https://www.youtube.com/playlist?list=PLAYLIST_ID', maxVideos: 10 },
    outputSchema: { ok: 'boolean', playlist: 'object', videos: 'any[]', error: 'string' },
  },
  {
    id: 'youtube_search',
    category: 'integrations',
    kind: 'cloud',
    description: 'Search YouTube for videos, channels, or playlists',
    argsTemplate: { query: 'search term', type: 'video', maxResults: 5 },
    outputSchema: { ok: 'boolean', results: 'any[]', error: 'string' },
  },
  {
    id: 'youtube_parse_url',
    category: 'integrations',
    kind: 'cloud',
    description: 'Parse a YouTube URL and identify content type (video, channel, playlist)',
    argsTemplate: { url: 'https://www.youtube.com/watch?v=VIDEO_ID' },
    outputSchema: { ok: 'boolean', type: 'string', id: 'string' },
  },

  // --- MARKETPLACE ---
  {
    id: 'search_marketplace',
    category: 'integrations',
    kind: 'cloud',
    description: 'Search the Stuard workflow marketplace to find pre-built automations using semantic similarity',
    argsTemplate: { query: 'file organizer', category: 'automation', limit: 10 },
    outputSchema: { ok: 'boolean', results: 'any[]', count: 'number' },
  },
  {
    id: 'get_marketplace_workflow',
    category: 'integrations',
    kind: 'cloud',
    description: 'Retrieve the full workflow specification from the marketplace by slug',
    argsTemplate: { slug: 'workflow-slug' },
    outputSchema: { ok: 'boolean', workflow: 'object' },
  },
  {
    id: 'list_popular_workflows',
    category: 'integrations',
    kind: 'cloud',
    description: 'List popular and highly-rated workflows from the Stuard marketplace',
    argsTemplate: { category: 'productivity', sort_by: 'downloads', limit: 10 },
    outputSchema: { ok: 'boolean', workflows: 'any[]', count: 'number' },
  },
  {
    id: 'list_marketplace_categories',
    category: 'integrations',
    kind: 'cloud',
    description: 'List all available workflow categories in the Stuard marketplace',
    argsTemplate: {},
    outputSchema: { ok: 'boolean', categories: 'any[]' },
  },
  {
    id: 'deploy_headless_agent',
    category: 'flow',
    kind: 'cloud',
    description: 'Deploys an autonomous sub-agent to run a task locally in the background. Multiple sub-agents can run in parallel. Returns a taskId to track progress.',
    argsTemplate: {
      objective: 'Search for recent news about OpenAI and summarize it',
      mode: 'generic',
      tools_allowed: ['web_search'],
      custom_system_prompt: 'Be extremely concise',
      model: 'fast'
    },
    outputSchema: { ok: 'boolean', taskId: 'string', error: 'string' },
  },
  {
    id: 'get_headless_agent_status',
    category: 'flow',
    kind: 'cloud',
    description: 'Retrieves the current status, logs, and results of a previously deployed sub-agent task.',
    argsTemplate: { taskId: 'task-uuid' },
    outputSchema: { ok: 'boolean', task: 'object', error: 'string' },
  },
  {
    id: 'list_headless_agent_tasks',
    category: 'flow',
    kind: 'cloud',
    description: 'List recent sub-agent tasks (optionally filtered by status or parent conversation).',
    argsTemplate: { status: 'running', parent_id: 'conversation-uuid', limit: 25 },
    outputSchema: { ok: 'boolean', tasks: 'any[]', error: 'string' },
  },
  {
    id: 'stop_headless_agent',
    category: 'flow',
    kind: 'cloud',
    description: 'Stops a running headless sub-agent. Use this when you need to cancel a background task that was started with deploy_headless_agent.',
    argsTemplate: { task_id: 'task-uuid' },
    outputSchema: { ok: 'boolean', task_id: 'string', message: 'string', error: 'string' },
  },

  // --- FEEDBACK ---
  {
    id: 'submit_feedback',
    category: 'integrations',
    kind: 'cloud',
    description: 'Submit a bug report or feature request. Shows a confirmation dialog before submitting.',
    argsTemplate: {
      type: 'bug',
      title: 'Short summary of the issue',
      description: 'Detailed explanation...',
      severity: 'medium',
      screenshots: ['C:/path/to/screenshot.png'],
      labels: ['ui', 'bug'],
      skipConfirmation: false,
    },
    outputSchema: { ok: 'boolean', feedbackId: 'string', type: 'string', title: 'string', status: 'string', cancelled: 'boolean', error: 'string' },
  },
  {
    id: 'report_bug',
    category: 'integrations',
    kind: 'cloud',
    description: 'Quick way to report a bug. Shortcut for submit_feedback with type="bug".',
    argsTemplate: {
      title: 'Short bug summary',
      description: 'Steps to reproduce, expected vs actual behavior',
      severity: 'medium',
      screenshots: [],
    },
    outputSchema: { ok: 'boolean', feedbackId: 'string', error: 'string', cancelled: 'boolean' },
  },
  {
    id: 'suggest_feature',
    category: 'integrations',
    kind: 'cloud',
    description: 'Quick way to suggest a feature. Shortcut for submit_feedback with type="feature".',
    argsTemplate: {
      title: 'Feature title',
      description: 'Describe the feature, use case, and benefits',
      screenshots: [],
    },
    outputSchema: { ok: 'boolean', feedbackId: 'string', error: 'string', cancelled: 'boolean' },
  },
  {
    id: 'list_my_feedback',
    category: 'integrations',
    kind: 'cloud',
    description: 'List your submitted bug reports and feature requests.',
    argsTemplate: { type: 'all', status: 'all', limit: 10 },
    outputSchema: { ok: 'boolean', feedback: 'any[]', count: 'number', error: 'string' },
  },
  {
    id: 'get_feedback_details',
    category: 'integrations',
    kind: 'cloud',
    description: 'Get full details of a specific feedback item including comments.',
    argsTemplate: { feedbackId: 'uuid' },
    outputSchema: { ok: 'boolean', feedback: 'any', comments: 'any[]', error: 'string' },
  },

  // --- TOOL DISCOVERY (SIS) ---
  {
    id: 'sis_search_tools',
    category: 'core',
    kind: 'cloud',
    description: 'Search for available tools by describing what you need. Returns matching tools with their full schemas. Use this when you need a capability that isn\'t in your current toolset.',
    argsTemplate: { query: 'send an email', category: 'integrations', limit: 10 },
    outputSchema: { success: 'boolean', query: 'string', count: 'number', tools: 'array', searchMethod: 'string', hint: 'string' },
  },
  {
    id: 'sis_execute_tool',
    category: 'core',
    kind: 'cloud',
    description: 'Execute any tool by name after discovering it with sis_search_tools. Pass tool_name and args matching the tool\'s schema.',
    argsTemplate: { tool_name: 'gmail_send_message', args: { to: ['user@example.com'], subject: 'Hello', body: 'Message' } },
    outputSchema: { success: 'boolean', tool: 'string', result: 'any', source: 'string', error: 'string' },
  },
  {
    id: 'sis_list_categories',
    category: 'core',
    kind: 'cloud',
    description: 'List all available tool categories to help narrow down tool searches.',
    argsTemplate: {},
    outputSchema: { categories: 'array', hint: 'string' },
  },
  {
    id: 'list_tools',
    category: 'core',
    kind: 'local',
    description: 'List all tools available on the local agent with optional category filter.',
    argsTemplate: { category: 'system' },
    outputSchema: { ok: 'boolean', count: 'number', tools: 'array' },
  },
  {
    id: 'get_tool_info',
    category: 'core',
    kind: 'local',
    description: 'Get detailed information about a specific tool by name.',
    argsTemplate: { name: 'run_command' },
    outputSchema: { ok: 'boolean', name: 'string', category: 'string', description: 'string', kind: 'string', available: 'boolean' },
  },
  {
    id: 'list_tool_categories',
    category: 'core',
    kind: 'local',
    description: 'List all tool categories available on the local agent with counts.',
    argsTemplate: {},
    outputSchema: { ok: 'boolean', categories: 'array' },
  },
];

export const TRIGGER_DEFINITIONS = [
  { type: 'manual', description: 'Manual trigger', argsTemplate: {} },
  { type: 'webhook.local', description: 'Local webhook trigger', argsTemplate: {} },
  { type: 'webhook.cloud', description: 'Cloud webhook trigger', argsTemplate: {} },
  { type: 'schedule.cron', description: 'Cron schedule trigger', argsTemplate: { cron: '* * * * *' } },
  { type: 'hotkey', description: 'Global hotkey trigger', argsTemplate: { accelerator: 'Ctrl+Alt+K' } },
  { type: 'fs.watch', description: 'Filesystem watch trigger', argsTemplate: { path: 'C:/path', pattern: '*.*' } },
];
