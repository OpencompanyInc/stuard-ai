/**
 * UX-friendly display names for integrations and local capabilities.
 * Slugs stay technical (ffmpeg, data-analysis); user-facing copy lives here.
 */

export interface IntegrationBranding {
  /** Primary name shown in cards, pills, and settings */
  displayName: string;
  /** Plain-language description — avoid library names in the lead sentence */
  description: string;
  /** Optional detail line for info sections — libraries, engines, product names */
  technicalDetail?: string;
  /** Compact label for status pills and tool-brand chips */
  shortLabel?: string;
}

const BRANDING: Record<string, IntegrationBranding> = {
  ffmpeg: {
    displayName: 'Media Processing',
    description: 'Convert, trim, and edit audio & video files. Installs automatically when needed.',
    technicalDetail: 'Powered by FFmpeg',
    shortLabel: 'Media',
  },
  'data-analysis': {
    displayName: 'Charts & Data',
    description: 'Explore spreadsheets and create charts from your data. Installed on demand in a private environment.',
    technicalDetail: 'Uses pandas, NumPy, SciPy, Matplotlib, and Seaborn',
    shortLabel: 'Charts',
  },
  mediapipe: {
    displayName: 'Vision & Motion',
    description: 'Detect faces, track hands, and understand body pose in photos and video.',
    technicalDetail: 'Powered by Google MediaPipe',
    shortLabel: 'Vision',
  },
  python: {
    displayName: 'Local Scripts',
    description: 'Run custom scripts on your computer. Stuard sets everything up automatically.',
    technicalDetail: 'Python runtime',
    shortLabel: 'Scripts',
  },
  ollama: {
    displayName: 'Private AI',
    description: 'Run AI models on your computer — chat, vision, and embeddings with no data leaving your device.',
    technicalDetail: 'Powered by Ollama',
    shortLabel: 'Local AI',
  },
  'agent-cli': {
    displayName: 'Coding Assistants',
    description: 'Delegate coding work to tools you already use — Codex, Cursor Agent, Antigravity, or Claude Code.',
    technicalDetail: 'Agent CLI integrations',
    shortLabel: 'Coding',
  },
  'browser-use': {
    displayName: 'Stuard Browser',
    description: 'Let Stuard browse the web for you — fill forms, search, log in, and complete tasks.',
    technicalDetail: 'Browser automation engine',
    shortLabel: 'Browser',
  },
  'browser-extension': {
    displayName: 'Browser Connector',
    description: 'Read, script, and organize tabs in your real browser — the page you are looking at, your sessions, your windows.',
    technicalDetail: 'Chrome/Edge MV3 extension bridge',
    shortLabel: 'Connector',
  },
};

/** Subagent kinds from capability packs — shown in delegation cards and voice status */
const SUBAGENT_LABELS: Record<string, string> = {
  browser: 'Web browsing',
  file_ops: 'Files & terminal',
  files: 'Files & terminal',
  cli_agent: 'Coding assistants',
  workflow: 'Workflow builder',
  reminders: 'Reminders',
  ffmpeg: 'Media processing',
  data_analysis: 'Charts & data',
  vm: 'Cloud VM',
  bot: 'Bot',
  agent: 'Agent',
  custom: 'Custom specialist',
  google: 'Google apps',
  outlook: 'Outlook',
  github: 'GitHub',
  meta: 'Social apps',
  whatsapp: 'WhatsApp',
  telnyx: 'Phone & SMS',
  reddit: 'Reddit',
  discord: 'Discord',
  research: 'Research',
  code: 'Code',
};

/** Exact tool-name overrides for chat pills and trace rows */
const TOOL_LABELS: Record<string, string> = {
  ffmpeg_status: 'Checking media tools',
  ffmpeg_setup: 'Setting up media tools',
  ffmpeg_probe_media: 'Reading media info',
  ffmpeg_convert_media: 'Converting media',
  ffmpeg_extract_audio: 'Extracting audio',
  ffmpeg_trim_media: 'Trimming media',
  ffmpeg_extract_frames: 'Extracting frames',
  ffmpeg_run: 'Processing media',
  data_analysis_status: 'Checking charts & data',
  data_analysis_setup: 'Setting up charts & data',
  data_analysis_uninstall: 'Removing charts & data',
  data_load: 'Loading data',
  describe_data: 'Summarizing data',
  correlate_data: 'Finding correlations',
  plot_line: 'Creating line chart',
  plot_bar: 'Creating bar chart',
  plot_scatter: 'Creating scatter chart',
  plot_hist: 'Creating histogram',
  plot_pie: 'Creating pie chart',
  plot_heatmap: 'Creating heatmap',
  plot_box: 'Creating box plot',
  run_data_python: 'Analyzing data',
  run_python_script: 'Running script',
  pip_install: 'Installing packages',
  mediapipe_pose: 'Detecting body pose',
  mediapipe_hands: 'Tracking hands',
  mediapipe_face_detection: 'Detecting faces',
  mediapipe_face_mesh: 'Mapping face details',
  mediapipe_segmentation: 'Removing background',
  mediapipe_holistic: 'Analyzing pose & face',
  mediapipe_process_video: 'Analyzing video',
  ollama_status: 'Checking local AI',
  ollama_agent: 'Running local AI',
  ollama_embeddings: 'Creating embeddings',
  ollama_models: 'Managing AI models',
  text_to_speech: 'Generating speech',
  list_tts_voices: 'Listing voices',
};

export function normalizeIntegrationSlug(slug: string): string {
  return String(slug || '').trim().toLowerCase().replace(/_/g, '-');
}

export function getIntegrationBranding(slug: string): IntegrationBranding | undefined {
  return BRANDING[normalizeIntegrationSlug(slug)];
}

/** Apply UX-friendly names to a catalog entry while preserving slug and other fields */
export function applyIntegrationBranding<T extends { slug: string; name: string; description: string }>(
  entry: T,
): T & { technicalDetail?: string } {
  const branding = getIntegrationBranding(entry.slug);
  if (!branding) return entry;
  return {
    ...entry,
    name: branding.displayName,
    description: branding.description,
    technicalDetail: branding.technicalDetail,
  };
}

export function getSubagentDisplayName(kind: string): string {
  const key = String(kind || '').trim().toLowerCase().replace(/-/g, '_');
  if (!key) return 'Specialist';
  if (SUBAGENT_LABELS[key]) return SUBAGENT_LABELS[key];
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function humanizeIntegrationToolName(toolName: string): string | undefined {
  const name = String(toolName || '').trim().toLowerCase();
  if (!name) return undefined;
  if (TOOL_LABELS[name]) return TOOL_LABELS[name];

  if (name.startsWith('ffmpeg_')) {
    const rest = name.slice('ffmpeg_'.length).replace(/_/g, ' ');
    return rest.charAt(0).toUpperCase() + rest.slice(1);
  }
  if (name.startsWith('data_analysis_')) {
    const rest = name.slice('data_analysis_'.length).replace(/_/g, ' ');
    return rest.charAt(0).toUpperCase() + rest.slice(1);
  }
  if (name.startsWith('plot_')) {
    const chart = name.slice('plot_'.length).replace(/_/g, ' ');
    return `Creating ${chart} chart`;
  }
  if (name.startsWith('mediapipe_')) {
    const rest = name.slice('mediapipe_'.length).replace(/_/g, ' ');
    return rest.charAt(0).toUpperCase() + rest.slice(1);
  }
  if (name.startsWith('ollama_')) {
    const rest = name.slice('ollama_'.length).replace(/_/g, ' ');
    return rest.charAt(0).toUpperCase() + rest.slice(1);
  }
  if (name.startsWith('elevenlabs_')) {
    const rest = name.slice('elevenlabs_'.length).replace(/_/g, ' ');
    return rest.charAt(0).toUpperCase() + rest.slice(1);
  }

  return undefined;
}

export function getIntegrationShortLabel(slug: string): string | undefined {
  return getIntegrationBranding(slug)?.shortLabel;
}
