import {
  Clock, Calendar, Link as LinkIcon, Mail, Hand, FolderOpen, Terminal,
  MessageSquare, AtSign, UserPlus, Send, Hash,
} from 'lucide-react';
import type { BotTriggerType } from './types';

export const COMMON_EMOJIS = ['🤖', '✨', '📊', '📰', '🐦', '📸', '🛒', '💼', '🎯', '🧠', '⚡', '🔔', '📅', '💡', '🎨', '📝'];

export const BOT_TOOL_RULES: Array<{ keywords: string[]; tools: string[]; emojiIndex?: number }> = [
  { keywords: ['twitter', 'tweet', 'tweets', 'x post', 'x/twitter'], tools: ['x_post_tweet', 'x_search_tweets', 'x_get_user_timeline', 'x_get_user', 'web_search'], emojiIndex: 4 },
  // Gmail read/search/get tools disabled pending Google CASA verification; only send remains.
  { keywords: ['email', 'gmail', 'inbox', 'newsletter'], tools: ['gmail_send_message'], emojiIndex: 12 },
  { keywords: ['outlook'], tools: ['outlook_send_mail', 'outlook_search_messages', 'outlook_list_messages'], emojiIndex: 12 },
  { keywords: ['calendar', 'meeting', 'schedule', 'appointment'], tools: ['calendar_list_events', 'calendar_create_event', 'calendar_update_event', 'get_datetime'], emojiIndex: 12 },
  { keywords: ['github', 'issue', 'pull request', 'pr ', 'repo', 'repository'], tools: ['github_search_issues', 'github_create_issue', 'github_list_pull_requests', 'github_get_pull_request', 'github_comment_on_issue'], emojiIndex: 7 },
  { keywords: ['file', 'folder', 'document', 'docs', 'workspace', 'notes'], tools: ['file_search', 'semantic_file_search', 'read_file', 'write_file', 'file_edit', 'list_directory'], emojiIndex: 15 },
  { keywords: ['video', 'recording', 'camera', 'webcam', 'mp4', 'mov', 'media'], tools: ['capture_media', 'file_search', 'ffmpeg_probe_media', 'analyze_media'], emojiIndex: 5 },
  { keywords: ['mp3', 'convert', 'extract audio', 'audio-only', 'audio only'], tools: ['ffmpeg_extract_audio', 'ffmpeg_convert_media', 'analyze_media'], emojiIndex: 5 },
  { keywords: ['transcribe', 'transcription', 'speech to text', 'voice to text', 'rundown'], tools: ['analyze_media', 'ffmpeg_extract_audio'], emojiIndex: 5 },
  { keywords: ['browser', 'website', 'web page', 'scrape', 'page', 'site'], tools: ['browser_use_navigate', 'browser_use_content', 'browser_use_get_interactive_elements', 'browser_use_click', 'scrape_url', 'web_search'], emojiIndex: 10 },
  { keywords: ['research', 'monitor', 'news', 'market', 'competitor', 'price'], tools: ['web_search', 'scrape_url', 'search_past_conversations'], emojiIndex: 3 },
  { keywords: ['sheet', 'spreadsheet', 'csv', 'data'], tools: ['sheets_read_sheet', 'sheets_update_values', 'sheets_append_values', 'read_file', 'write_file'], emojiIndex: 2 },
  { keywords: ['discord'], tools: ['discord_send_message', 'discord_list_channels', 'discord_get_messages'], emojiIndex: 10 },
  { keywords: ['reddit', 'subreddit'], tools: ['reddit_search_posts', 'reddit_get_subreddit_posts', 'reddit_create_post', 'reddit_comment_on_post'], emojiIndex: 3 },
  { keywords: ['sms', 'text message', 'phone'], tools: ['telnyx_send_sms', 'telnyx_list_messages'], emojiIndex: 11 },
];

export const INTERNAL_BOT_TOOLS = new Set([
  'search_tools',
  'get_tool_schema',
  'execute_tool',
  'get_skill_info',
  'choose_notification_channel',
  'write_session_summary',
  'search_past_conversations',
  'get_conversation_context',
]);

export const TRIGGER_META: Record<BotTriggerType, { label: string; icon: any; tagline: string }> = {
  'schedule.interval': { label: 'On a schedule', icon: Clock, tagline: 'Wake every fixed interval (every 30m, 1h, …)' },
  'schedule.cron': { label: 'Cron expression', icon: Calendar, tagline: 'Custom cron — e.g. weekly Tuesday 9am' },
  'webhook': { label: 'Incoming webhook', icon: LinkIcon, tagline: 'Wake when a unique URL receives a POST' },
  'fs.watch': { label: 'File or folder change', icon: FolderOpen, tagline: 'Wake when files are added, changed, or removed' },
  'command.watch': { label: 'Custom script watcher', icon: Terminal, tagline: 'Wake from a long-running script or command output' },
  'gmail.new_email': { label: 'New Gmail email', icon: Mail, tagline: 'Wake when a new email matches your filters' },
  'x.new_mention': { label: 'X mention', icon: AtSign, tagline: 'Wake when someone @-mentions you on X' },
  'x.new_comment': { label: 'X comment', icon: MessageSquare, tagline: 'Wake when someone replies to your post on X' },
  'x.new_dm': { label: 'X direct message', icon: Send, tagline: 'Wake on a new X DM' },
  'x.new_follower': { label: 'X new follower', icon: UserPlus, tagline: 'Wake when you gain a follower on X' },
  'x.user_post': { label: 'X new post', icon: Hash, tagline: 'Wake when you publish a new post on X' },
  'instagram.new_comment': { label: 'Instagram comment', icon: MessageSquare, tagline: 'Wake on a new comment on your media' },
  'instagram.new_mention': { label: 'Instagram mention', icon: AtSign, tagline: 'Wake when your account is @-mentioned' },
  'instagram.new_message': { label: 'Instagram DM', icon: Send, tagline: 'Wake on a new Instagram direct message' },
  'manual': { label: 'Manual only', icon: Hand, tagline: 'Wake only when you press Run Now' },
};

export const CRON_PRESETS: { label: string; expr: string }[] = [
  { label: 'Every 5 min', expr: '*/5 * * * *' },
  { label: 'Hourly', expr: '0 * * * *' },
  { label: 'Daily at 9am', expr: '0 9 * * *' },
  { label: 'Weekly (Tue 9am)', expr: '0 9 * * 2' },
  { label: 'Monthly (1st 9am)', expr: '0 9 1 * *' },
];
