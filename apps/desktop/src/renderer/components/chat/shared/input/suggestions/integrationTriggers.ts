/**
 * Keyword-driven integration suggestions.
 *
 * As the user types a prompt, we scan it for intent keywords and surface a single
 * calm suggestion to connect (OAuth) or install (local tool) the matching integration.
 * Pure string ops — no React, no I/O — so it can run on every keystroke cheaply.
 *
 * The action side lives in ./integrationInlineActions; the connected-state contract
 * (localStorage "integrations.connected") is shared with the dashboard hook
 * (useIntegrationsState).
 */

import {
  DISCORD_INTEGRATION_ENABLED,
  META_INTEGRATION_ENABLED,
  OUTLOOK_INTEGRATION_ENABLED,
  REDDIT_INTEGRATION_ENABLED,
  WHATSAPP_INTEGRATION_ENABLED,
} from '../../../../../../../../../shared/integration-flags';

export type IntegrationKind = 'connect' | 'install';

export interface IntegrationTrigger {
  slug: string;
  name: string;
  kind: IntegrationKind;
  /** Action button label. */
  verb: string;
  /** Higher wins when several triggers match the same prompt. */
  priority: number;
  /** Sentence shown in the chip. */
  blurb: string;
  /** Single-token matches (matched on word boundaries). */
  keywords?: string[];
  /** Multi-word matches (matched as substrings). */
  phrases?: string[];
  /** Optional feature-flag gate — when it returns false the trigger never fires. */
  enabled?: () => boolean;
}

export interface IntegrationSuggestion {
  slug: string;
  name: string;
  kind: IntegrationKind;
  verb: string;
  blurb: string;
  /** The keyword/phrase that produced the match (used for ranking + debugging). */
  matched: string;
}

/**
 * Trigger table. Tunable — keep keyword sets tight enough to avoid false positives.
 * Slugs + provider semantics must line up with useIntegrationsState / IntegrationsView.
 */
export const INTEGRATION_TRIGGERS: IntegrationTrigger[] = [
  {
    slug: 'browser-use',
    name: 'Stuard Browser',
    kind: 'install',
    verb: 'Install',
    priority: 50,
    blurb: 'Let Stuard browse the web to do this for you.',
    keywords: ['browse', 'website', 'scrape'],
    phrases: [
      'the web',
      'online',
      'log in',
      'sign in to',
      'fill out',
      'fill in',
      'look up',
      'research',
      'find me',
      'check prices',
      'add to cart',
      'book a',
      'book me',
      'order ',
    ],
  },
  {
    slug: 'github',
    name: 'GitHub',
    kind: 'connect',
    verb: 'Connect',
    priority: 60,
    blurb: 'Connect GitHub so Stuard can read your repos and issues.',
    keywords: ['github', 'repo', 'repository', 'commit', 'commits'],
    phrases: ['pull request', 'my issues', 'open a pr', 'my repos'],
  },
  {
    slug: 'gmail',
    name: 'Gmail',
    kind: 'connect',
    verb: 'Connect',
    priority: 40,
    blurb: 'Connect Gmail so Stuard can read and send your email.',
    keywords: ['gmail', 'inbox'],
    phrases: ['send an email', 'send me an email', 'email me', 'draft an email', 'check my email', 'reply to the email'],
  },
  {
    slug: 'google-calendar',
    name: 'Google Calendar',
    kind: 'connect',
    verb: 'Connect',
    priority: 45,
    blurb: 'Connect Google Calendar to manage events and your schedule.',
    keywords: ['calendar'],
    phrases: ['schedule a meeting', 'on my calendar', 'add an event', 'my availability', 'free time'],
  },
  {
    slug: 'google-drive',
    name: 'Google Drive',
    kind: 'connect',
    verb: 'Connect',
    priority: 40,
    blurb: 'Connect Google Drive so Stuard can find your files.',
    phrases: ['google drive', 'my drive', 'in my drive'],
  },
  {
    slug: 'google-sheets',
    name: 'Google Sheets',
    kind: 'connect',
    verb: 'Connect',
    priority: 42,
    blurb: 'Connect Google Sheets to read and edit your spreadsheets.',
    keywords: ['spreadsheet'],
    phrases: ['google sheet', 'google sheets'],
  },
  {
    slug: 'google-docs',
    name: 'Google Docs',
    kind: 'connect',
    verb: 'Connect',
    priority: 42,
    blurb: 'Connect Google Docs so Stuard can read your documents.',
    phrases: ['google doc', 'google docs'],
  },
  {
    slug: 'x',
    name: 'X (Twitter)',
    kind: 'connect',
    verb: 'Connect',
    priority: 35,
    blurb: 'Connect X to read timelines and post on your behalf.',
    keywords: ['tweet', 'tweets', 'twitter'],
    phrases: ['post on x'],
  },
  {
    slug: 'reddit',
    name: 'Reddit',
    kind: 'connect',
    verb: 'Connect',
    priority: 35,
    blurb: 'Connect Reddit to browse, search, and post.',
    keywords: ['reddit', 'subreddit'],
    enabled: () => REDDIT_INTEGRATION_ENABLED,
  },
  {
    slug: 'discord',
    name: 'Discord',
    kind: 'connect',
    verb: 'Connect',
    priority: 35,
    blurb: 'Connect Discord to read and send messages.',
    keywords: ['discord'],
    enabled: () => DISCORD_INTEGRATION_ENABLED,
  },
  {
    slug: 'outlook',
    name: 'Outlook',
    kind: 'connect',
    verb: 'Connect',
    priority: 35,
    blurb: 'Connect Outlook so Stuard can read your mail.',
    keywords: ['outlook'],
    enabled: () => OUTLOOK_INTEGRATION_ENABLED,
  },
  {
    slug: 'data-analysis',
    name: 'Data Analysis',
    kind: 'install',
    verb: 'Install',
    priority: 45,
    blurb: 'Install Data Analysis to crunch and chart your data.',
    keywords: ['csv', 'dataframe', 'pandas', 'histogram'],
    phrases: ['analyze data', 'analyze this data', 'plot a', 'visualize the data', 'visualise the data'],
  },
  {
    slug: 'ffmpeg',
    name: 'FFmpeg',
    kind: 'install',
    verb: 'Install',
    priority: 40,
    blurb: 'Install FFmpeg to convert and edit audio & video.',
    phrases: ['convert video', 'convert the video', 'trim audio', 'trim the video', 'extract audio', 'compress the video', '.mp4', '.mov'],
  },
  {
    slug: 'mediapipe',
    name: 'MediaPipe',
    kind: 'install',
    verb: 'Install',
    priority: 38,
    blurb: 'Install MediaPipe to detect faces, hands, and poses.',
    phrases: ['detect faces', 'face detection', 'hand tracking', 'body pose', 'recognize the image'],
  },
  {
    slug: 'ollama',
    name: 'Ollama',
    kind: 'install',
    verb: 'Install',
    priority: 30,
    blurb: 'Install Ollama to run AI models privately on your computer.',
    phrases: ['local model', 'offline ai', 'run a model locally', 'private model', 'run locally'],
  },
  {
    slug: 'python',
    name: 'Python',
    kind: 'install',
    verb: 'Install',
    priority: 28,
    blurb: 'Set up Python so Stuard can run scripts locally.',
    phrases: ['run python', 'python script', 'pip install'],
  },
  {
    slug: 'agent-cli',
    name: 'Agent CLI',
    kind: 'install',
    verb: 'Enable',
    priority: 30,
    blurb: 'Enable Agent CLI to delegate coding to Codex, Claude Code, or Cursor.',
    phrases: ['use codex', 'claude code', 'cursor agent', 'delegate coding'],
  },
];

/** Minimum trimmed prompt length before we bother matching. */
const MIN_QUERY_LENGTH = 6;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Returns the single best integration suggestion for a prompt, or null.
 * Skips integrations that are already connected, dismissed, or gated off by a flag.
 */
export function matchIntegrationSuggestion(
  query: string,
  opts: { connectedMap?: Record<string, boolean>; dismissed?: Set<string> } = {},
): IntegrationSuggestion | null {
  const raw = String(query || '').trim();
  if (raw.length < MIN_QUERY_LENGTH) return null;
  // Don't fight slash-command palettes.
  if (raw.startsWith('/')) return null;

  const text = raw.toLowerCase();
  const connectedMap = opts.connectedMap || {};
  const dismissed = opts.dismissed;

  let best: IntegrationSuggestion | null = null;
  let bestScore = -1;

  for (const t of INTEGRATION_TRIGGERS) {
    if (t.enabled && !t.enabled()) continue;
    if (connectedMap[t.slug]) continue;
    if (dismissed?.has(t.slug)) continue;
    if (!META_INTEGRATION_ENABLED && (t.slug === 'facebook' || t.slug === 'instagram' || t.slug === 'threads')) continue;
    if (!WHATSAPP_INTEGRATION_ENABLED && t.slug === 'whatsapp') continue;

    let matched = '';
    for (const phrase of t.phrases || []) {
      if (text.includes(phrase) && phrase.length > matched.length) matched = phrase;
    }
    for (const kw of t.keywords || []) {
      const re = new RegExp(`\\b${escapeRegExp(kw)}\\b`, 'i');
      if (re.test(text) && kw.length > matched.length) matched = kw;
    }
    if (!matched) continue;

    // Rank by trigger priority first, then by how specific the matched token is.
    const score = t.priority * 100 + matched.length;
    if (score > bestScore) {
      bestScore = score;
      best = {
        slug: t.slug,
        name: t.name,
        kind: t.kind,
        verb: t.verb,
        blurb: t.blurb,
        matched,
      };
    }
  }

  return best;
}
