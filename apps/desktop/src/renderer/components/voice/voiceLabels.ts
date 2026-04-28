/**
 * Shared friendly labels for voice tool activity.
 *
 * Voice mode shows real-time status while Stuard reaches into the
 * orchestrator's tool surface — generic "Using web_search…" reads as
 * jargon, so we convert known tool names + args into short, present-tense
 * verbs the user can scan at a glance.
 */

const TOOL_LABELS: Record<string, string> = {
  search_memory: 'Looking through memory',
  search_past_conversations: 'Looking through past chats',
  get_conversation_context: 'Reading past chat',
  search_tools: 'Picking the right tool',
  get_tool_schema: 'Picking the right tool',
  execute_tool: 'Running a tool',
  web_search: 'Searching the web',
  scrape_url: 'Reading the page',
  google_search: 'Searching Google',
  send_sms: 'Texting you',
  send_email: 'Sending an email',
  read_email: 'Reading email',
  list_calendar_events: 'Checking your calendar',
  create_calendar_event: 'Creating an event',
  open_url: 'Opening a link',
  read_file: 'Reading a file',
  write_file: 'Writing a file',
  execute_command: 'Running a command',
  github_search: 'Searching GitHub',
  slack_send: 'Sending a Slack message',
  memory_store: 'Saving to memory',
  delegate: 'Delegating to a specialist',
  reply_to_subagent: 'Answering the specialist',
  analyze_media: 'Looking at the media',
  agent_todo: 'Tracking the task list',
  search_local_workflows: 'Finding a workflow',
  run_workflow: 'Running a workflow',
  deploy_headless_agent: 'Spinning up a background agent',
  get_headless_agent_status: 'Checking on the background agent',
  list_headless_agent_tasks: 'Listing background agents',
  stop_headless_agent: 'Stopping a background agent',
  get_skill_info: 'Looking up a skill',
  wait: 'Pausing for a moment',
};

const SUBAGENT_LABELS: Record<string, string> = {
  browser: 'browser agent',
  file_ops: 'file agent',
  files: 'file agent',
  workflow: 'workflow agent',
  reminders: 'reminders agent',
  ffmpeg: 'media agent',
  media: 'media agent',
  google: 'Google agent',
  outlook: 'Outlook agent',
  github: 'GitHub agent',
  meta: 'Meta agent',
  whatsapp: 'WhatsApp agent',
  telnyx: 'phone agent',
  reddit: 'Reddit agent',
  discord: 'Discord agent',
  research: 'research agent',
  code: 'code agent',
};

function titleCase(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function detailFromArgs(name: string, args?: Record<string, any>): string | undefined {
  if (!args) return undefined;
  switch (name) {
    case 'web_search':
    case 'google_search':
    case 'github_search':
    case 'search_memory':
    case 'search_past_conversations':
    case 'search_local_workflows':
      return typeof args.query === 'string' && args.query.length > 0 ? `"${truncate(args.query, 40)}"` : undefined;
    case 'scrape_url': {
      const u = Array.isArray(args.urls) ? args.urls[0] : args.urls;
      return typeof u === 'string' ? truncate(u, 40) : undefined;
    }
    case 'analyze_media': {
      const sources = Array.isArray(args.sources) ? args.sources : [];
      if (sources.some((s: any) => s?.captureScreen)) return 'your screen';
      const first = sources[0];
      const ref = first?.url || first?.path;
      if (typeof ref === 'string') return truncate(ref, 40);
      return typeof args.task === 'string' ? `"${truncate(args.task, 40)}"` : undefined;
    }
    case 'run_workflow':
      return typeof args.name === 'string' ? truncate(args.name, 40)
        : typeof args.id === 'string' ? truncate(args.id, 40) : undefined;
    case 'deploy_headless_agent': {
      const tasks = Array.isArray(args.tasks) ? args.tasks : [];
      if (tasks.length === 0) return undefined;
      if (tasks.length === 1) {
        const obj = tasks[0]?.objective;
        return typeof obj === 'string' ? `"${truncate(obj, 40)}"` : undefined;
      }
      return `${tasks.length} agents`;
    }
    case 'agent_todo':
      return typeof args.action === 'string' ? args.action : undefined;
    case 'get_skill_info':
      return typeof args.skill_name === 'string' ? truncate(args.skill_name, 40)
        : typeof args.skill_id === 'string' ? truncate(args.skill_id, 40) : undefined;
    case 'execute_tool':
      return typeof args.tool_name === 'string' ? titleCase(String(args.tool_name)) : undefined;
    case 'delegate': {
      const tasks = Array.isArray(args.tasks) ? args.tasks : [];
      if (tasks.length === 0) return undefined;
      if (tasks.length === 1) {
        const sub = String(tasks[0]?.subagent || '');
        return SUBAGENT_LABELS[sub] || (sub ? `${sub} agent` : undefined);
      }
      return `${tasks.length} agents`;
    }
    case 'send_sms':
    case 'send_email':
      return typeof args.message === 'string' ? `"${truncate(args.message, 40)}"` : undefined;
    case 'create_calendar_event':
      return typeof args.title === 'string' ? `"${truncate(args.title, 40)}"` : undefined;
    case 'open_url':
      return typeof args.url === 'string' ? truncate(args.url, 40) : undefined;
    default:
      return undefined;
  }
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max - 1) + '…';
}

export function friendlyToolLabel(name: string, args?: Record<string, any>): string {
  return TOOL_LABELS[name] || titleCase(name);
}

export function friendlyToolDetail(name: string, args?: Record<string, any>): string | undefined {
  return detailFromArgs(name, args);
}

export interface FriendlyTool {
  label: string;
  detail?: string;
}

export function describeTool(name: string, args?: Record<string, any>): FriendlyTool {
  return {
    label: friendlyToolLabel(name, args),
    detail: friendlyToolDetail(name, args),
  };
}

const STATE_COPY = {
  idle: 'Ready',
  connecting: 'Connecting…',
  listening: 'Listening',
  thinking: 'Thinking…',
  speaking: 'Speaking',
} as const;

export type VoiceLabelState = keyof typeof STATE_COPY;

export function friendlyVoiceState(state: VoiceLabelState): string {
  return STATE_COPY[state] ?? '';
}
