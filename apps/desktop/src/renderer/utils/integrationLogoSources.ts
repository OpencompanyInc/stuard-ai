// Live brand-logo sources for the Connected Apps dashboard and the in-flight
// tool pills. Instead of only shipping bundled SVGs, we point an <img> at the
// provider's *current* favicon via Google's public favicon service. Chromium's
// persistent disk HTTP cache stores the result and revalidates it per the
// service's cache-control headers — so we fetch once and only re-fetch when the
// upstream icon actually changes. Bundled SVGs (see integrationIcons.tsx /
// toolBrand.tsx) remain the instant base layer and the offline/error fallback.
//
// Keys here cover BOTH the dashboard integration slugs (e.g. `google-drive`)
// and the tool-pill brand keys (e.g. `drive`) so either consumer can look up a
// domain with the identifier it already has.

/**
 * Identifier → canonical domain whose favicon represents the brand. Google
 * products use their distinct sub-domains so the service returns the
 * product-specific mark (Gmail, Drive, Calendar, Docs…) rather than a generic
 * Google "G".
 */
const LOGO_DOMAINS: Record<string, string> = {
  // ── Google family ──────────────────────────────────────────────────────────
  gmail: 'mail.google.com',
  drive: 'drive.google.com',
  'google-drive': 'drive.google.com',
  calendar: 'calendar.google.com',
  'google-calendar': 'calendar.google.com',
  docs: 'docs.google.com',
  'google-docs': 'docs.google.com',
  sheets: 'sheets.google.com',
  'google-sheets': 'sheets.google.com',
  tasks: 'tasks.google.com',
  'google-tasks': 'tasks.google.com',
  meet: 'meet.google.com',
  maps: 'maps.google.com',

  // ── Other connected apps ───────────────────────────────────────────────────
  github: 'github.com',
  discord: 'discord.com',
  reddit: 'reddit.com',
  x: 'x.com',
  facebook: 'facebook.com',
  instagram: 'instagram.com',
  threads: 'threads.net',
  outlook: 'outlook.com',
  youtube: 'youtube.com',
  whatsapp: 'whatsapp.com',
  telnyx: 'telnyx.com',
  slack: 'slack.com',
  notion: 'notion.so',
  supabase: 'supabase.com',
  elevenlabs: 'elevenlabs.io',
  ollama: 'ollama.com',

  // ── Local tools (favicon of the project homepage) ──────────────────────────
  python: 'python.org',
  data_analysis: 'python.org',
  ffmpeg: 'ffmpeg.org',
};

const FAVICON_ENDPOINT = 'https://t3.gstatic.com/faviconV2';

/**
 * Live favicon URL for a brand identifier, or null when we have no domain for
 * it (caller should fall back to the bundled asset / lucide icon).
 *
 * @param key  integration slug or tool-pill brand key
 * @param size requested pixel size (the service returns the closest available)
 */
export function faviconUrlFor(key: string, size = 128): string | null {
  const domain = LOGO_DOMAINS[(key || '').toLowerCase()];
  if (!domain) return null;
  const target = encodeURIComponent(`https://${domain}`);
  return `${FAVICON_ENDPOINT}?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${target}&size=${size}`;
}

/** Whether a live favicon source exists for this identifier. */
export function hasRemoteLogo(key: string): boolean {
  return (key || '').toLowerCase() in LOGO_DOMAINS;
}
