"use client";

/**
 * CompactDemo — interactive marketing clone of Stuard desktop compact mode.
 *
 * Auto-plays a loop when scrolled into view (PDF summary, research, spreadsheet,
 * French-lesson callback, inbox triage, nav to Settings/Studio). Typing or
 * clicking pauses the loop so visitors can try their own prompts.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Plus,
  AudioLines,
  Expand,
  ChevronDown,
  ChevronUp,
  Loader2,
  Mail,
  Calendar,
  MessageSquare,
  Users,
  Globe,
  Search,
  FileText,
  StickyNote,
  File,
  FolderOpen,
  Table2,
  Phone,
  LayoutDashboard,
  Settings,
  Layers,
  Paperclip,
  ExternalLink,
  AtSign,
  Wrench,
  Bell,
  type LucideIcon,
} from 'lucide-react';

const FG = 'rgb(var(--compact-pill-fg))';
const FG_MUTED = 'rgb(var(--compact-pill-fg-muted))';
const BG = 'rgb(var(--compact-pill-bg))';
const BORDER = 'rgb(var(--compact-pill-fg) / 0.18)';
const SHADOW = 'var(--compact-pill-shadow)';
const HOVER = 'var(--compact-pill-hover)';
const RED = '#FF383C';
const USER_BG = '#FFFFFF';
const USER_FG = '#171717';
const FONT = "'General Sans', var(--font-geist-sans), 'Inter', system-ui, sans-serif";
const PANEL_MAX_WIDTH = 372;
const PILL_MAX_WIDTH = 420;

const ROW_BASE = {
  height: 48,
  padding: '6px 8px',
  background: 'transparent',
  borderRadius: 8,
} as const;

const ROW_PRIMARY = {
  ...ROW_BASE,
  background: HOVER,
} as const;

const KBD = {
  padding: '3px 6px',
  color: FG_MUTED,
} as const;

type BrandKey =
  | 'gmail'
  | 'calendar'
  | 'slack'
  | 'notion'
  | 'web'
  | 'docs'
  | 'people'
  | 'files'
  | 'sheets'
  | 'phone'
  | 'generic';

interface DemoAttachment {
  name: string;
  kind: 'pdf' | 'file' | 'sheet';
}

interface Brand {
  key: BrandKey;
  label: string;
  Icon: LucideIcon;
  color: string;
}

const BRANDS: Record<BrandKey, Brand> = {
  gmail: { key: 'gmail', label: 'Gmail', Icon: Mail, color: '#EA4335' },
  calendar: { key: 'calendar', label: 'Calendar', Icon: Calendar, color: '#4285F4' },
  slack: { key: 'slack', label: 'Slack', Icon: MessageSquare, color: '#E01E5A' },
  notion: { key: 'notion', label: 'Notion', Icon: StickyNote, color: '#111111' },
  web: { key: 'web', label: 'the web', Icon: Search, color: '#A78BFA' },
  docs: { key: 'docs', label: 'Docs', Icon: FileText, color: '#4285F4' },
  people: { key: 'people', label: 'your CRM', Icon: Users, color: '#FBBC04' },
  files: { key: 'files', label: 'local files', Icon: FolderOpen, color: '#60A5FA' },
  sheets: { key: 'sheets', label: 'Excel', Icon: Table2, color: '#22C55E' },
  phone: { key: 'phone', label: 'phone', Icon: Phone, color: '#A78BFA' },
  generic: { key: 'generic', label: 'a tool', Icon: Globe, color: '#94A3B8' },
};

interface ToolCallLite {
  id: string;
  brand: BrandKey;
  status: 'running' | 'completed';
}

interface DemoStep {
  brand: BrandKey;
  status: string;
  duration: number;
}

interface Scenario {
  id: string;
  label: string;
  prompt: string;
  keywords: string[];
  steps: DemoStep[];
  reply: string;
  attachments?: DemoAttachment[];
}

/** Scenarios cycled during the unattended demo loop. */
const AUTO_DEMO_IDS = [
  'pdf',
  'at-search',
  'website',
  'slash',
  'mini-app',
  'research',
  'remind',
  'nav',
] as const;

const NAV_DEMO = {
  id: 'nav' as const,
  label: 'Jump to Settings or Studio',
  prompt: 'settings',
};

type DemoNavGroup = 'dashboard' | 'studio';

interface DemoNavItem {
  id: string;
  group: DemoNavGroup;
  title: string;
  subtitle: string;
  keywords: string[];
  Icon: LucideIcon;
  tile: string;
}

const DEMO_NAV: DemoNavItem[] = [
  {
    id: 'dash-overview',
    group: 'dashboard',
    title: 'Overview',
    subtitle: 'Dashboard · overview & activity',
    Icon: LayoutDashboard,
    tile: '#2563EB',
    keywords: ['overview', 'home', 'dashboard', 'dash', 'today', 'activity'],
  },
  {
    id: 'dash-settings',
    group: 'dashboard',
    title: 'Settings',
    subtitle: 'Dashboard · themes & preferences',
    Icon: Settings,
    tile: '#2563EB',
    keywords: ['settings', 'setting', 'preferences', 'theme', 'config', 'account'],
  },
  {
    id: 'studio-home',
    group: 'studio',
    title: 'Stuard Studio',
    subtitle: 'Open the studio home',
    Icon: Layers,
    tile: '#7C3AED',
    keywords: ['stuard', 'studio', 'workflow', 'workflows', 'automation', 'builder'],
  },
];

function scoreDemoNavMatch(item: DemoNavItem, q: string): number {
  const title = item.title.toLowerCase();
  const subtitle = item.subtitle.toLowerCase();
  if (title === q) return 100;
  if (title.startsWith(q)) return 90;
  if (title.includes(q)) return 80;
  if (subtitle.includes(q)) return 70;
  if (item.keywords.some((k) => k === q)) return 85;
  if (item.keywords.some((k) => k.startsWith(q) || q.startsWith(k))) return 75;
  if (item.keywords.some((k) => k.includes(q) || q.includes(k))) return 60;
  if (item.group === 'dashboard' && (q.includes('dash') || q.includes('dashboard'))) return 40;
  if (item.group === 'studio' && (q.includes('studio') || q.includes('workflow'))) return 35;
  return 0;
}

function filterDemoNav(query: string, max = 6): DemoNavItem[] {
  const q = (query || '').toLowerCase().trim();
  if (!q || q.length < 2) return [];
  return DEMO_NAV
    .map((item) => ({ item, score: scoreDemoNavMatch(item, q) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title))
    .slice(0, max)
    .map(({ item }) => item);
}

/** Slash commands surfaced when the visitor types "/" — mirrors the desktop app. */
interface SlashCmd {
  cmd: string;
  label: string;
  hint: string;
  scenarioId: string;
  Icon: LucideIcon;
}

const SLASH_COMMANDS: SlashCmd[] = [
  { cmd: '/research', label: 'Deep research', hint: 'Read real sources, return a cited brief', scenarioId: 'research', Icon: Search },
  { cmd: '/build', label: 'Make a mini-app', hint: 'Describe a tool, get an app in your workspace', scenarioId: 'mini-app', Icon: Wrench },
  { cmd: '/website', label: 'Build a website', hint: 'Scaffold, style, and preview it locally', scenarioId: 'website', Icon: Globe },
  { cmd: '/remind', label: 'Text your phone', hint: 'Reminders where you\'ll actually see them', scenarioId: 'remind', Icon: Bell },
  { cmd: '/call', label: 'Schedule a call', hint: 'Stuard calls you with what it found', scenarioId: 'french-call', Icon: Phone },
  { cmd: '/schedule', label: 'Book a meeting', hint: 'Find a slot, send the invites', scenarioId: 'calendar', Icon: Calendar },
];

function filterSlashCommands(query: string): SlashCmd[] {
  const q = query.trimStart().slice(1).toLowerCase().trim();
  if (!q) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter(
    (c) => c.cmd.slice(1).startsWith(q) || c.label.toLowerCase().includes(q),
  );
}

/** Fake local file index behind the "@" mention dropdown. */
interface DemoFile {
  name: string;
  kind: DemoAttachment['kind'];
  path: string;
  /** Concepts the file matches when searched "by meaning" rather than by name. */
  meaning: string[];
}

const DEMO_FILES: DemoFile[] = [
  { name: 'Q3-Investor-Deck.pdf', kind: 'pdf', path: 'Desktop', meaning: ['investor', 'deck', 'metrics', 'pitch', 'q3'] },
  { name: 'Tax-Return-2025.pdf', kind: 'pdf', path: 'Documents/Finance', meaning: ['tax', 'taxes', 'return', 'irs', 'march', 'filing', 'doc', 'document'] },
  { name: 'Lease-Agreement.pdf', kind: 'pdf', path: 'Documents', meaning: ['apartment', 'rent', 'lease', 'landlord', 'housing', 'contract'] },
  { name: 'resume-2026.pdf', kind: 'pdf', path: 'Documents', meaning: ['resume', 'cv', 'internship', 'job', 'application', 'career'] },
  { name: 'Sales-Pipeline-Q1.xlsx', kind: 'sheet', path: 'Desktop', meaning: ['sales', 'pipeline', 'deals', 'revenue', 'spreadsheet'] },
  { name: 'French-Progress.md', kind: 'file', path: 'Notes', meaning: ['french', 'lesson', 'language', 'verbs', 'learning'] },
  { name: 'receipt-march-14.png', kind: 'file', path: 'Downloads', meaning: ['receipt', 'dinner', 'march', 'expense', 'restaurant'] },
];

function quickFileMatches(q: string): DemoFile[] {
  const needle = q.toLowerCase().trim();
  if (!needle) return DEMO_FILES.slice(0, 4);
  return DEMO_FILES.filter((f) => f.name.toLowerCase().includes(needle)).slice(0, 5);
}

function semanticFileMatches(q: string): DemoFile[] {
  const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  if (!words.length) return [];
  return DEMO_FILES
    .map((f) => ({ f, score: words.filter((w) => f.meaning.some((m) => m.startsWith(w) || w.startsWith(m))).length }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ f }) => f);
}

/** A query reads as "semantic" once it's a phrase, not a filename fragment. */
function isSemanticFileQuery(q: string): boolean {
  const t = q.trim();
  return t.includes(' ') || t.length >= 8;
}

const AUTO_PAUSE_IDLE_MS = 1600;
const AUTO_TYPE_MS = 38;
const AUTO_QUICK_ACTIONS_MS = 1200;
const AUTO_HOLD_RESULT_MS = 4200;
/** Hold on the collapsed "View response" pull-tab so the affordance is clearly shown. */
const AUTO_COLLAPSED_MS = 1900;
const AUTO_BETWEEN_MS = 700;

const SCENARIOS: Scenario[] = [
  {
    id: 'pdf',
    label: 'Read & summarize a PDF',
    prompt: 'Summarize the Q3 investor deck on my Desktop and pull out the key metrics',
    keywords: ['pdf', 'deck', 'investor', 'document', 'summarize'],
    attachments: [{ name: 'Q3-Investor-Deck.pdf', kind: 'pdf' }],
    steps: [
      { brand: 'files', status: 'Opening PDF…', duration: 1200 },
      { brand: 'files', status: 'Extracting 42 pages…', duration: 1400 },
      { brand: 'docs', status: 'Summarizing…', duration: 1300 },
    ],
    reply:
      '**Q3 Investor Deck — key metrics:**\n\n' +
      '- **ARR:** $4.2M (+38% QoQ)\n' +
      '- **Gross margin:** 78%\n' +
      '- **Net retention:** 124%\n' +
      '- **Runway:** 22 months at current burn\n\n' +
      'Top ask from investors: expand enterprise sales. Want a one-pager from this?',
  },
  {
    id: 'research',
    label: 'Research with sources',
    prompt: 'Research how the EU AI Act affects our product roadmap and cite sources',
    keywords: ['research', 'eu', 'ai act', 'regulation', 'cite', 'sources'],
    steps: [
      { brand: 'web', status: 'Searching the web…', duration: 1300 },
      { brand: 'web', status: 'Reading 11 sources…', duration: 1500 },
      { brand: 'docs', status: 'Writing brief…', duration: 1200 },
    ],
    reply:
      '**EU AI Act — impact on your roadmap:**\n\n' +
      '1. **High-risk classification** — your document-automation feature may need conformity assessment by Aug 2026.\n' +
      '2. **Transparency** — users must know when AI drafts emails or edits files.\n' +
      '3. **Data governance** — local-first processing is a strong compliance story.\n\n' +
      'Sources: EU Official Journal, IAPP, McKinsey AI compliance brief. Save as a doc?',
  },
  {
    id: 'spreadsheet',
    label: 'Create a spreadsheet',
    prompt: 'Create a spreadsheet tracking our Q1 sales pipeline — stages, owners, and amounts',
    keywords: ['spreadsheet', 'excel', 'sheet', 'pipeline', 'csv', 'xlsx'],
    steps: [
      { brand: 'files', status: 'Creating workbook…', duration: 1100 },
      { brand: 'sheets', status: 'Adding columns & formulas…', duration: 1400 },
      { brand: 'sheets', status: 'Formatting & saving…', duration: 1000 },
    ],
    reply:
      'Created **`Sales-Pipeline-Q1.xlsx`** on your Desktop ✅\n\n' +
      '| Column | Notes |\n' +
      '| --- | --- |\n' +
      '| Stage | Lead → Qualified → Proposal → Closed |\n' +
      '| Owner | Pulled from your CRM |\n' +
      '| Amount | SUM at bottom, conditional formatting on >$50k |\n\n' +
      '12 placeholder rows added. Want me to import live deals from your CRM?',
  },
  {
    id: 'french-call',
    label: 'Schedule a callback',
    prompt: 'Call me tomorrow at 7am to continue our French lesson — quiz me on past tense verbs',
    keywords: ['call me', 'french', 'lesson', 'phone', 'callback', '7am', '7 am'],
    steps: [
      { brand: 'calendar', status: 'Checking your schedule…', duration: 1100 },
      { brand: 'phone', status: 'Scheduling callback…', duration: 1300 },
      { brand: 'docs', status: 'Preparing quiz deck…', duration: 1100 },
    ],
    reply:
      '**French lesson callback set** for tomorrow at **7:00 AM** 📞\n\n' +
      '- I\'ll call your number on file\n' +
      '- Quiz focus: **passé composé** vs **imparfait** (15 verbs from last session)\n' +
      '- Lesson notes saved to `French-Progress.md`\n\n' +
      'Last session score was 8/10. Want to add subjunctive drills too?',
  },
  {
    id: 'x-post',
    label: 'Draft & post to X',
    prompt: 'Turn my launch notes into a punchy 3-post thread and post it on X',
    keywords: ['post on x', 'post to x', 'tweet', 'thread', 'twitter', 'x thread', 'social'],
    steps: [
      { brand: 'docs', status: 'Reading your launch notes…', duration: 1200 },
      { brand: 'docs', status: 'Drafting the thread…', duration: 1300 },
      { brand: 'web', status: 'Opening X in the browser…', duration: 1300 },
    ],
    reply:
      'Drafted a 3-post thread from your notes and opened X — ready to publish:\n\n' +
      '**1/** Big news: our new pricing is live. Simpler tiers, a lower entry point, same product you already know. Here\'s what changed 🧵\n\n' +
      '**2/** Starter is now free forever. Pro drops to $12/mo — no seat minimums, cancel anytime.\n\n' +
      '**3/** Already a customer? You\'ve been auto-moved to the best-value plan. Questions? Reply here.\n\n' +
      'Want me to post it, or tweak the hook first?',
  },
  {
    id: 'website',
    label: 'Build a website',
    prompt: 'Build me a clean portfolio site — my projects, an about page, and a contact form',
    keywords: ['website', 'web site', 'portfolio', 'landing page', 'site for', 'build me a site'],
    steps: [
      { brand: 'files', status: 'Scaffolding the project…', duration: 1300 },
      { brand: 'docs', status: 'Writing pages & styles…', duration: 1500 },
      { brand: 'web', status: 'Starting local preview…', duration: 1100 },
    ],
    reply:
      'Your site is running at **localhost:3000** ✅\n\n' +
      '- **Home** — hero + your three best projects\n' +
      '- **About** — written from your résumé\n' +
      '- **Contact** — form wired to your email\n\n' +
      'Open it and tell me what to change — or say the word and I\'ll deploy it.',
  },
  {
    id: 'mini-app',
    label: 'Create a tool on the spot',
    prompt: 'Make me a tool that splits a dinner bill from a receipt photo, tip included',
    keywords: ['make me a tool', 'build me a tool', 'mini-app', 'mini app', 'app that', 'tool that'],
    steps: [
      { brand: 'generic', status: 'Designing the tool…', duration: 1200 },
      { brand: 'files', status: 'Wiring the workflow…', duration: 1400 },
      { brand: 'generic', status: 'Adding buttons & inputs…', duration: 1100 },
    ],
    reply:
      '**Bill Splitter** is in your workspace ✅\n\n' +
      '- Drop in a receipt photo\n' +
      '- It reads the items, adds tax & tip\n' +
      '- Tap names to assign dishes — everyone gets a total\n\n' +
      'It\'s yours now — runs any time, no rebuilding. Want a "request via Venmo" button on it?',
  },
  {
    id: 'remind',
    label: 'Text your phone',
    prompt: 'Text me at 5pm to stretch and drink water, every weekday',
    keywords: ['remind', 'text me', 'reminder', 'notify me at', 'every weekday'],
    steps: [
      { brand: 'calendar', status: 'Setting the schedule…', duration: 1200 },
      { brand: 'phone', status: 'Sending a test text…', duration: 1100 },
    ],
    reply:
      'Done — I\'ll text your phone at **5:00 PM, Mon–Fri** 📱\n\n' +
      '> Stretch + water break 🧘\n\n' +
      'A test message just landed. Want a morning version with your day\'s plan too?',
  },
  {
    id: 'crm',
    label: 'Update your CRM',
    prompt: 'Add Sarah Connor (sarah@skynet.com) to my CRM as a Resistance Lead',
    keywords: ['crm', 'contact', 'lead', 'sarah', 'add '],
    steps: [
      { brand: 'people', status: 'Opening your CRM…', duration: 1300 },
      { brand: 'people', status: 'Creating record…', duration: 1300 },
    ],
    reply:
      'Done — **Sarah Connor** is in your CRM ✅\n\n' +
      '- **Email:** sarah@skynet.com\n' +
      '- **Role:** Resistance Lead\n' +
      '- **Stage:** New\n\n' +
      'I logged today as the first touchpoint. Want a follow-up reminder for Friday?',
  },
  {
    id: 'calendar',
    label: 'Book a meeting',
    prompt: 'Schedule a 30-min sync with the design team tomorrow afternoon',
    keywords: ['schedule', 'calendar', 'sync', 'meeting', 'book', 'invite'],
    steps: [
      { brand: 'calendar', status: 'Checking availability…', duration: 1500 },
      { brand: 'calendar', status: 'Creating event…', duration: 1100 },
      { brand: 'gmail', status: 'Sending invites…', duration: 1100 },
    ],
    reply:
      'Booked **Design Sync** for tomorrow at **2:30–3:00pm** — the only slot that worked for all four of you.\n\n' +
      '- Invites sent to the design team\n' +
      '- Google Meet link attached\n' +
      '- Agenda doc created and linked',
  },
  {
    id: 'files',
    label: 'Organize local files',
    prompt: 'Move all invoice PDFs from Downloads into Finance/2026 sorted by vendor',
    keywords: ['move', 'organize', 'downloads', 'folder', 'invoice', 'sort'],
    steps: [
      { brand: 'files', status: 'Scanning Downloads…', duration: 1200 },
      { brand: 'files', status: 'Moving 8 invoices…', duration: 1400 },
    ],
    reply:
      'Organized **8 invoice PDFs** into `Finance/2026/` ✅\n\n' +
      '- Acme Corp (3)\n' +
      '- Stripe (2)\n' +
      '- AWS (2)\n' +
      '- Notion (1)\n\n' +
      'Duplicates skipped. Want a CSV index of everything moved?',
  },
];

function scenarioById(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}

function matchScenario(input: string): Scenario | null {
  const q = input.toLowerCase();
  for (const scn of SCENARIOS) {
    if (scn.keywords.some((k) => q.includes(k))) return scn;
  }
  return null;
}

const GENERIC_REPLY =
  "On it. Here's how I'd approach that:\n\n" +
  '1. Pull the context I need from your apps\n' +
  '2. Do the work step by step\n' +
  '3. Show you the result before anything goes out\n\n' +
  '*This is a live demo — download Stuard to run it for real.*';

const GENERIC_STEPS: DemoStep[] = [
  { brand: 'web', status: 'Looking into it…', duration: 1500 },
  { brand: 'generic', status: 'Working…', duration: 1200 },
];

const MD_COMPONENTS: Components = {
  p: ({ children }) => <p style={{ margin: '0 0 6px 0' }}>{children}</p>,
  ul: ({ children }) => <ul style={{ paddingLeft: 18, margin: '0 0 6px 0' }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ paddingLeft: 18, margin: '0 0 6px 0' }}>{children}</ol>,
  li: ({ children }) => <li style={{ margin: '0 0 2px 0' }}>{children}</li>,
  strong: ({ children }) => <strong style={{ fontWeight: 600 }}>{children}</strong>,
  blockquote: ({ children }) => (
    <blockquote
      style={{
        margin: '0 0 6px 0',
        paddingLeft: 10,
        borderLeft: `2px solid ${RED}`,
        color: FG_MUTED,
      }}
    >
      {children}
    </blockquote>
  ),
  code: ({ inline, children }: { inline?: boolean; children?: React.ReactNode }) =>
    inline ? (
      <code
        style={{
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontSize: '0.92em',
          padding: '1px 4px',
          borderRadius: 4,
          background: 'rgb(var(--compact-pill-fg) / 0.08)',
        }}
      >
        {children}
      </code>
    ) : (
      <pre
        style={{
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontSize: 11,
          padding: 8,
          borderRadius: 8,
          background: 'rgb(var(--compact-pill-fg) / 0.06)',
          overflowX: 'auto',
          margin: '0 0 6px 0',
        }}
      >
        <code>{children}</code>
      </pre>
    ),
};

const TypingDots = () => (
  <span
    aria-label="Assistant is typing"
    style={{ display: 'inline-flex', alignItems: 'center', gap: 3, verticalAlign: 'middle', marginLeft: 4 }}
  >
    {[0, 1, 2].map((i) => (
      <span
        key={i}
        style={{
          width: 3,
          height: 3,
          borderRadius: '50%',
          background: 'currentColor',
          opacity: 0.6,
          animation: `compactResponseDot 1.1s ${i * 0.18}s infinite ease-in-out`,
        }}
      />
    ))}
  </span>
);

const BrandChip = ({ brand, active }: { brand: Brand; active: boolean }) => (
  <span
    title={brand.label}
    className="relative inline-flex items-center justify-center shrink-0 rounded-full overflow-hidden"
    style={{
      width: 14,
      height: 14,
      background: USER_BG,
      border: active ? `0.6px solid ${RED}` : `0.4px solid ${BORDER}`,
      margin: '0 -3px',
      boxSizing: 'border-box',
    }}
  >
    <brand.Icon strokeWidth={2} style={{ width: 8.8, height: 8.8, color: brand.color }} />
  </span>
);

function SearchEngineIcon({ id }: { id: string }) {
  if (id === 'merriam' || id === 'wikipedia') {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/search-engines/${id === 'merriam' ? 'merriam-webster' : 'wikipedia'}.png`}
        alt=""
        width={16}
        height={16}
        style={{ width: 16, height: 16, objectFit: 'contain' }}
      />
    );
  }
  if (id === 'google') {
    return (
      <span style={{ fontSize: 14, fontWeight: 700, color: '#4285F4' }}>G</span>
    );
  }
  if (id === 'bing') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
        <path fill="#00A4EF" d="M5 3v18l9.5-3.5L20 21V3H5z" />
      </svg>
    );
  }
  if (id === 'duckduckgo') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
        <circle cx="12" cy="12" r="10" fill="#DE5833" />
        <ellipse cx="12" cy="13" rx="5" ry="4" fill="#FFF" />
      </svg>
    );
  }
  if (id === 'github') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
        <rect width="24" height="24" rx="5.5" fill="#A855F7" />
        <g transform="translate(12 12) scale(0.78) translate(-12 -12)">
          <path
            fill="#FFFFFF"
            d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
          />
        </g>
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <path fill="#FF0000" d="M23.5 6.5a3 3 0 0 0-2.1-2.1C19.5 4 12 4 12 4s-7.5 0-9.4.4A3 3 0 0 0 .5 6.5 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.5 3 3 0 0 0 2.1 2.1c1.9.4 9.4.4 9.4.4s7.5 0 9.4-.4a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.5z" />
      <path fill="#FFF" d="M9.75 15.02l6.5-3.75L9.75 7.52v7.5z" />
    </svg>
  );
}

const SEARCH_ENGINES = [
  { id: 'google', name: 'Google' },
  { id: 'bing', name: 'Bing' },
  { id: 'duckduckgo', name: 'DuckDuckGo' },
  { id: 'youtube', name: 'YouTube' },
  { id: 'github', name: 'GitHub' },
  { id: 'merriam', name: 'Merriam-Webster' },
  { id: 'wikipedia', name: 'Wikipedia' },
] as const;

function CompactDragCorner() {
  return (
    <div
      className="absolute pointer-events-none"
      style={{ right: -8, bottom: -8, width: 52, height: 52, zIndex: 6 }}
      aria-hidden
    >
      <svg width={52} height={52} viewBox="0 0 52 52" style={{ display: 'block', overflow: 'visible' }}>
        <path d="M 47 26 A 21 21 0 0 1 26 47" stroke="#FF383C" strokeWidth="3" strokeLinecap="butt" fill="none" />
      </svg>
    </div>
  );
}

function AttachmentChip({ att }: { att: DemoAttachment }) {
  const Icon = att.kind === 'pdf' ? FileText : att.kind === 'sheet' ? Table2 : File;
  const tint = att.kind === 'pdf' ? '#EA4335' : att.kind === 'sheet' ? '#22C55E' : '#60A5FA';
  return (
    <span
      className="inline-flex items-center gap-1.5 max-w-[200px] shrink-0"
      style={{
        padding: '4px 8px',
        borderRadius: 8,
        background: 'rgb(var(--compact-pill-fg) / 0.08)',
        border: `0.4px solid ${BORDER}`,
      }}
    >
      <Icon style={{ width: 12, height: 12, color: tint, flexShrink: 0 }} strokeWidth={2} />
      <span
        className="truncate"
        style={{ fontSize: 10, lineHeight: '14px', color: 'rgb(var(--compact-pill-fg) / 0.88)' }}
      >
        {att.name}
      </span>
    </span>
  );
}

function DemoCaption({ label, visible }: { label: string; visible: boolean }) {
  if (!visible) return null;
  return (
    <motion.div
      className="absolute top-4 inset-x-0 z-10 flex justify-center px-4 pointer-events-none"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.25 }}
    >
      <span
        style={{
          fontFamily: FONT,
          fontSize: 11,
          fontWeight: 500,
          lineHeight: '16px',
          color: 'rgb(var(--compact-pill-fg) / 0.72)',
          padding: '5px 12px',
          borderRadius: 9999,
          background: 'rgb(var(--compact-pill-bg))',
          border: `0.4px solid ${BORDER}`,
          boxShadow: SHADOW,
        }}
      >
        {label}
      </span>
    </motion.div>
  );
}

function QuickActionsPanel({
  query,
  attachments,
  stuardNavItems,
  selectedIndex,
  onHoverIndex,
  onAskStuard,
  onWebSearch,
  activeEngineId,
  onSelectEngine,
}: {
  query: string;
  attachments: DemoAttachment[];
  stuardNavItems: DemoNavItem[];
  selectedIndex: number;
  onHoverIndex: (i: number) => void;
  onAskStuard: () => void;
  onWebSearch: () => void;
  activeEngineId: string;
  onSelectEngine: (id: string) => void;
}) {
  const trimmed = query.trim();
  const engine = SEARCH_ENGINES.find((e) => e.id === activeEngineId) ?? SEARCH_ENGINES[0];
  const fileRowStart = 2;
  const stuardRowStart = fileRowStart + attachments.length;

  const fileTint = (kind: DemoAttachment['kind']) =>
    kind === 'pdf' ? '#EA4335' : kind === 'sheet' ? '#22C55E' : '#60A5FA';

  return (
    <motion.div
      key="quick-actions"
      className="w-full"
      style={{ maxWidth: PILL_MAX_WIDTH, marginBottom: 10 }}
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.98 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
    >
      <div
        className="overflow-hidden flex flex-col"
        style={{
          background: BG,
          borderRadius: 12,
          boxShadow: SHADOW,
        }}
      >
        <div className="flex flex-col custom-scrollbar" style={{ padding: 16, gap: 12, maxHeight: 320, overflowY: 'auto' }}>
          <div className="flex flex-col" style={{ gap: 8 }}>
            <div style={{ fontSize: 10, lineHeight: '14px', color: FG, fontWeight: 400 }}>
              Quick Actions
            </div>

            <button
              type="button"
              onMouseEnter={() => onHoverIndex(0)}
              onClick={onAskStuard}
              className="w-full flex items-center"
              style={{ ...(selectedIndex === 0 ? ROW_PRIMARY : ROW_BASE), gap: 10 }}
            >
              <div className="flex-1 min-w-0 flex flex-col items-start text-left" style={{ gap: 6 }}>
                <div className="truncate w-full" style={{ fontSize: 12, lineHeight: '16px', color: FG }}>
                  &ldquo;{trimmed}&rdquo;
                </div>
                <div className="truncate w-full" style={{ fontSize: 10, lineHeight: '14px', color: FG_MUTED }}>
                  Ask Stuard
                </div>
              </div>
              <span className="shrink-0" style={{ ...KBD, fontSize: 10, lineHeight: '14px' }}>
                Enter
              </span>
            </button>

            <button
              type="button"
              onMouseEnter={() => onHoverIndex(1)}
              onClick={onWebSearch}
              className="w-full flex items-center"
              style={{ ...(selectedIndex === 1 ? ROW_PRIMARY : ROW_BASE), gap: 10 }}
            >
              <div className="flex-1 min-w-0 flex flex-col items-start text-left" style={{ gap: 6 }}>
                <div className="truncate w-full" style={{ fontSize: 12, lineHeight: '16px', color: FG }}>
                  &ldquo;{trimmed}&rdquo;
                </div>
                <div className="truncate w-full" style={{ fontSize: 10, lineHeight: '14px', color: FG_MUTED }}>
                  Search {engine.name}
                </div>
              </div>
              <span className="shrink-0" style={{ ...KBD, fontSize: 10, lineHeight: '14px' }}>
                Ctrl + Enter
              </span>
            </button>

            <div className="flex items-center" style={{ gap: 6, paddingLeft: 8, paddingRight: 8 }}>
              {SEARCH_ENGINES.map((eng) => {
                const isActive = eng.id === activeEngineId;
                return (
                  <button
                    key={eng.id}
                    type="button"
                    title={`Use ${eng.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectEngine(eng.id);
                    }}
                    className="flex items-center justify-center transition-all hover:scale-105"
                    style={{
                      width: 28,
                      height: 28,
                      padding: 4,
                      borderRadius: 8,
                      background: isActive ? 'rgb(var(--compact-pill-fg) / 0.10)' : 'transparent',
                      border: isActive ? '1px solid rgb(var(--compact-pill-fg) / 0.20)' : '1px solid transparent',
                      opacity: isActive ? 1 : 0.55,
                    }}
                  >
                    <SearchEngineIcon id={eng.id} />
                  </button>
                );
              })}
            </div>
          </div>

          {stuardNavItems.length > 0 && (
            <div className="flex flex-col" style={{ gap: 8 }}>
              <div style={{ fontSize: 10, lineHeight: '14px', color: FG, fontWeight: 400 }}>
                Stuard
              </div>

              {stuardNavItems.map((item, idx) => {
                const Icon = item.Icon;
                const rowIdx = stuardRowStart + idx;
                const isSel = selectedIndex === rowIdx;
                const prevGroup = idx > 0 ? stuardNavItems[idx - 1]?.group : undefined;
                const showGroupLabel = item.group !== prevGroup;
                return (
                  <div key={item.id} className="flex flex-col" style={{ gap: 8 }}>
                    {showGroupLabel && (
                      <div
                        style={{
                          fontSize: 9,
                          lineHeight: '12px',
                          color: FG_MUTED,
                          paddingLeft: 8,
                          paddingTop: idx === 0 ? 0 : 2,
                          textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                        }}
                      >
                        {item.group === 'dashboard' ? 'Dashboard' : 'Studio'}
                      </div>
                    )}
                    <button
                      type="button"
                      onMouseEnter={() => onHoverIndex(rowIdx)}
                      className="w-full flex items-center text-left"
                      style={{
                        ...(isSel ? ROW_PRIMARY : ROW_BASE),
                        padding: '6px 8px 6px 6px',
                        gap: 6,
                      }}
                    >
                      <div
                        className="flex items-center justify-center shrink-0"
                        style={{
                          width: 30,
                          height: 30,
                          borderRadius: 9,
                          background: 'rgb(var(--compact-pill-fg) / 0.06)',
                          color: FG_MUTED,
                        }}
                      >
                        <Icon style={{ width: 15, height: 15 }} strokeWidth={1.75} />
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 6 }}>
                        <div
                          className="truncate"
                          style={{ fontSize: 12, lineHeight: '16px', color: FG }}
                        >
                          {item.title}
                        </div>
                        <div
                          className="truncate"
                          style={{ fontSize: 10, lineHeight: '14px', color: FG_MUTED }}
                        >
                          {item.subtitle}
                        </div>
                      </div>
                      <span
                        className="shrink-0 flex items-center justify-center"
                        style={{ padding: '3px 6px', color: FG_MUTED }}
                        title="Open"
                      >
                        <ExternalLink style={{ width: 16, height: 16 }} strokeWidth={1.75} />
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {attachments.length > 0 && (
            <div className="flex flex-col" style={{ gap: 8 }}>
              <div style={{ fontSize: 10, lineHeight: '14px', color: FG, fontWeight: 400 }}>
                Files
              </div>

              {attachments.map((att, idx) => {
                const rowIdx = fileRowStart + idx;
                const isSel = selectedIndex === rowIdx;
                const AttIcon = att.kind === 'pdf' ? FileText : att.kind === 'sheet' ? Table2 : File;
                return (
                  <button
                    key={att.name}
                    type="button"
                    onMouseEnter={() => onHoverIndex(rowIdx)}
                    className="w-full flex items-center text-left"
                    style={{
                      ...(isSel ? ROW_PRIMARY : ROW_BASE),
                      padding: '6px 8px 6px 6px',
                      gap: 6,
                    }}
                  >
                    <div
                      className="flex items-center justify-center shrink-0"
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 4,
                        background: fileTint(att.kind),
                      }}
                    >
                      <AttIcon style={{ width: 18, height: 18, color: '#fff' }} strokeWidth={1.75} />
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 6 }}>
                      <div
                        className="truncate"
                        style={{ fontSize: 12, lineHeight: '16px', color: FG }}
                      >
                        {att.name}
                      </div>
                      <div
                        className="truncate"
                        style={{ fontSize: 8, lineHeight: '14px', color: FG_MUTED }}
                      >
                        Attach to conversation
                      </div>
                    </div>
                    <span
                      className="shrink-0 flex items-center justify-center"
                      style={{ padding: '3px 6px', color: FG_MUTED }}
                      title="Attach"
                    >
                      <Paperclip style={{ width: 16, height: 16 }} strokeWidth={1.75} />
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <div style={{ fontSize: 10, lineHeight: '14px', color: FG, fontWeight: 400 }}>
            No workflows
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function PanelShell({ children, panelKey }: { children: ReactNode; panelKey: string }) {
  return (
    <motion.div
      key={panelKey}
      className="w-full"
      style={{ maxWidth: PILL_MAX_WIDTH, marginBottom: 10 }}
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.98 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="overflow-hidden flex flex-col" style={{ background: BG, borderRadius: 12, boxShadow: SHADOW }}>
        <div className="flex flex-col custom-scrollbar" style={{ padding: 16, gap: 8, maxHeight: 320, overflowY: 'auto' }}>
          {children}
        </div>
      </div>
    </motion.div>
  );
}

function SlashPanel({
  commands,
  selectedIndex,
  onHoverIndex,
  onRun,
}: {
  commands: SlashCmd[];
  selectedIndex: number;
  onHoverIndex: (i: number) => void;
  onRun: (cmd: SlashCmd) => void;
}) {
  return (
    <PanelShell panelKey="slash-panel">
      <div style={{ fontSize: 10, lineHeight: '14px', color: FG, fontWeight: 400 }}>Commands</div>
      {commands.length === 0 && (
        <div style={{ fontSize: 12, lineHeight: '16px', color: FG_MUTED, padding: '6px 8px' }}>
          No matching command — just ask in plain English instead.
        </div>
      )}
      {commands.map((cmd, idx) => {
        const isSel = selectedIndex === idx;
        return (
          <button
            key={cmd.cmd}
            type="button"
            onMouseEnter={() => onHoverIndex(idx)}
            onClick={() => onRun(cmd)}
            className="w-full flex items-center text-left"
            style={{ ...(isSel ? ROW_PRIMARY : ROW_BASE), padding: '6px 8px 6px 6px', gap: 8 }}
          >
            <div
              className="flex items-center justify-center shrink-0"
              style={{
                width: 30,
                height: 30,
                borderRadius: 9,
                background: 'rgb(var(--compact-pill-fg) / 0.06)',
                color: FG_MUTED,
              }}
            >
              <cmd.Icon style={{ width: 15, height: 15 }} strokeWidth={1.75} />
            </div>
            <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 4 }}>
              <div className="flex items-baseline" style={{ gap: 6 }}>
                <span style={{ fontSize: 12, lineHeight: '16px', color: FG, fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
                  {cmd.cmd}
                </span>
                <span className="truncate" style={{ fontSize: 11, lineHeight: '15px', color: FG }}>
                  {cmd.label}
                </span>
              </div>
              <div className="truncate" style={{ fontSize: 10, lineHeight: '14px', color: FG_MUTED }}>
                {cmd.hint}
              </div>
            </div>
            {isSel && (
              <span className="shrink-0" style={{ ...KBD, fontSize: 10, lineHeight: '14px' }}>
                Enter
              </span>
            )}
          </button>
        );
      })}
    </PanelShell>
  );
}

function FilePanel({
  atQuery,
  semanticLoading,
  quick,
  semantic,
  selectedIndex,
  onHoverIndex,
  onSelect,
}: {
  atQuery: string;
  semanticLoading: boolean;
  quick: DemoFile[];
  semantic: DemoFile[];
  selectedIndex: number;
  onHoverIndex: (i: number) => void;
  onSelect: (file: DemoFile) => void;
}) {
  const fileTint = (kind: DemoAttachment['kind']) =>
    kind === 'pdf' ? '#EA4335' : kind === 'sheet' ? '#22C55E' : '#60A5FA';

  const renderRow = (file: DemoFile, rowIdx: number, byMeaning: boolean) => {
    const isSel = selectedIndex === rowIdx;
    const FileIcon = file.kind === 'pdf' ? FileText : file.kind === 'sheet' ? Table2 : File;
    return (
      <button
        key={`${byMeaning ? 'sem' : 'quick'}-${file.name}`}
        type="button"
        onMouseEnter={() => onHoverIndex(rowIdx)}
        onClick={() => onSelect(file)}
        className="w-full flex items-center text-left"
        style={{ ...(isSel ? ROW_PRIMARY : ROW_BASE), padding: '6px 8px 6px 6px', gap: 8 }}
      >
        <div
          className="flex items-center justify-center shrink-0"
          style={{ width: 30, height: 30, borderRadius: 7, background: fileTint(file.kind) }}
        >
          <FileIcon style={{ width: 15, height: 15, color: '#fff' }} strokeWidth={1.75} />
        </div>
        <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 4 }}>
          <div className="truncate" style={{ fontSize: 12, lineHeight: '16px', color: FG }}>
            {file.name}
          </div>
          <div className="truncate" style={{ fontSize: 10, lineHeight: '14px', color: FG_MUTED }}>
            ~/{file.path}
          </div>
        </div>
        {byMeaning && (
          <span
            className="shrink-0"
            style={{
              fontSize: 9,
              lineHeight: '13px',
              padding: '2px 7px',
              borderRadius: 9999,
              color: '#FF8A8C',
              background: 'rgba(255,56,60,0.10)',
              border: '0.4px solid rgba(255,56,60,0.28)',
            }}
          >
            meaning match
          </span>
        )}
        {isSel && (
          <span className="shrink-0 flex items-center justify-center" style={{ padding: '3px 4px', color: FG_MUTED }}>
            <Paperclip style={{ width: 14, height: 14 }} strokeWidth={1.75} />
          </span>
        )}
      </button>
    );
  };

  const semanticOffset = quick.length;

  return (
    <PanelShell panelKey="file-panel">
      <div className="flex items-center" style={{ gap: 6 }}>
        <AtSign style={{ width: 11, height: 11, color: FG_MUTED }} strokeWidth={2} />
        <span style={{ fontSize: 10, lineHeight: '14px', color: FG, fontWeight: 400 }}>
          {atQuery.trim() ? 'Your files' : 'Attach a file — type a name, or describe it'}
        </span>
      </div>

      {quick.map((f, i) => renderRow(f, i, false))}

      {semanticLoading && (
        <div className="flex items-center" style={{ gap: 7, padding: '6px 8px' }}>
          <Loader2 className="animate-spin shrink-0" style={{ width: 12, height: 12, color: RED }} strokeWidth={2.5} />
          <span style={{ fontSize: 11, lineHeight: '15px', color: FG_MUTED }}>
            Searching by meaning…
          </span>
        </div>
      )}

      {!semanticLoading && semantic.length > 0 && (
        <>
          <div style={{ fontSize: 9, lineHeight: '12px', color: FG_MUTED, paddingLeft: 8, paddingTop: 2, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Semantic matches
          </div>
          {semantic.map((f, i) => renderRow(f, semanticOffset + i, true))}
        </>
      )}

      {!semanticLoading && quick.length === 0 && semantic.length === 0 && (
        <div style={{ fontSize: 12, lineHeight: '16px', color: FG_MUTED, padding: '6px 8px' }}>
          Nothing in the demo index — try &ldquo;@tax doc from march&rdquo;.
        </div>
      )}
    </PanelShell>
  );
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const uid = () => Math.random().toString(36).slice(2);

/** Faux line of body text inside the backdrop document. */
function TextBar({ w, dim = false }: { w: string; dim?: boolean }) {
  return <div style={{ height: 9, width: w, borderRadius: 4, background: dim ? '#e4e7ee' : '#d6dae3' }} />;
}

/**
 * Static "your workspace" scene behind the floating pill. It never reacts to the
 * demo — the whole point is that Stuard rides on top of whatever you're already
 * doing, so there's no alt-tabbing to a separate chat window.
 */
function AppBackdrop() {
  return (
    <div className="absolute inset-0 z-0 overflow-hidden" aria-hidden style={{ background: '#eceef3' }}>
      {/* App / browser title bar */}
      <div
        className="flex items-center shrink-0"
        style={{ height: 38, padding: '0 14px', gap: 12, background: '#f7f8fb', borderBottom: '1px solid #e2e5ec' }}
      >
        <div className="flex items-center" style={{ gap: 7 }}>
          {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
            <span key={c} style={{ width: 11, height: 11, borderRadius: '50%', background: c }} />
          ))}
        </div>
        <div className="flex-1 flex justify-center">
          <div
            className="flex items-center"
            style={{
              gap: 8,
              width: '100%',
              maxWidth: 300,
              height: 24,
              padding: '0 12px',
              borderRadius: 8,
              background: '#ffffff',
              border: '1px solid #e2e5ec',
            }}
          >
            <span style={{ width: 10, height: 10, borderRadius: '50%', border: '1.5px solid #b6bcc8', flexShrink: 0 }} />
            <span
              className="truncate"
              style={{ fontFamily: FONT, fontSize: 11, lineHeight: '14px', color: '#8b919e' }}
            >
              docs.stuard.ai/quarterly-planning
            </span>
          </div>
        </div>
        <div style={{ width: 52 }} />
      </div>

      {/* Document page */}
      <div style={{ padding: '24px 7% 0' }}>
        <div
          style={{
            background: '#ffffff',
            borderRadius: 12,
            border: '1px solid #e6e8ef',
            boxShadow: '0 14px 34px rgba(15,18,30,0.12)',
            padding: '28px 32px',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <div style={{ fontFamily: FONT, fontSize: 21, fontWeight: 600, color: '#212635', letterSpacing: '-0.01em' }}>
            Q3 Planning
          </div>
          <div className="flex flex-col" style={{ gap: 9 }}>
            <TextBar w="94%" />
            <TextBar w="100%" />
            <TextBar w="73%" />
          </div>
          {/* Lightweight report figure */}
          <div className="flex items-end" style={{ gap: 11, height: 72, marginTop: 2 }}>
            {[42, 64, 50, 81, 60, 95].map((h, i) => (
              <div
                key={i}
                style={{
                  width: 28,
                  height: `${h}%`,
                  borderRadius: '5px 5px 0 0',
                  background: i === 5 ? '#FF383C' : '#ccd1da',
                }}
              />
            ))}
          </div>
          <div className="flex flex-col" style={{ gap: 9, marginTop: 2 }}>
            <TextBar w="88%" />
            <TextBar w="61%" dim />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CompactDemo() {
  const [query, setQuery] = useState('');
  const [userPrompt, setUserPrompt] = useState('');
  const [assistantText, setAssistantText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toolCalls, setToolCalls] = useState<ToolCallLite[]>([]);
  const [showResponse, setShowResponse] = useState(false);
  const [hasReply, setHasReply] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  const [selectedAction, setSelectedAction] = useState(0);
  const [activeEngineId, setActiveEngineId] = useState('google');
  const [attachments, setAttachments] = useState<DemoAttachment[]>([]);
  const [autoDemoLabel, setAutoDemoLabel] = useState<string | null>(null);
  const [autoDemoActive, setAutoDemoActive] = useState(false);

  const runToken = useRef(0);
  const autoToken = useRef(0);
  const autoIndex = useRef(0);
  const interacted = useRef(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // --- "/" slash-command mode -------------------------------------------------
  const slashActive = query.trimStart().startsWith('/');
  const slashCommands = useMemo(() => (slashActive ? filterSlashCommands(query) : []), [slashActive, query]);
  const showSlashPanel = slashActive && !busy && !showResponse;

  // --- "@" file-mention mode ---------------------------------------------------
  const atQuery = useMemo(() => {
    if (slashActive) return null;
    const idx = query.lastIndexOf('@');
    if (idx === -1) return null;
    return { idx, q: query.slice(idx + 1) };
  }, [query, slashActive]);
  const showFilePanel = !!atQuery && !busy && !showResponse;

  const [fileSemanticLoading, setFileSemanticLoading] = useState(false);
  const [semanticResults, setSemanticResults] = useState<DemoFile[]>([]);
  const semanticTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const quickFiles = useMemo(() => (atQuery ? quickFileMatches(atQuery.q) : []), [atQuery]);

  useEffect(() => {
    if (semanticTimer.current) {
      clearTimeout(semanticTimer.current);
      semanticTimer.current = null;
    }
    if (!atQuery || !isSemanticFileQuery(atQuery.q)) {
      setFileSemanticLoading(false);
      setSemanticResults([]);
      return;
    }
    const q = atQuery.q;
    setFileSemanticLoading(true);
    setSemanticResults([]);
    semanticTimer.current = setTimeout(() => {
      setSemanticResults(semanticFileMatches(q));
      setFileSemanticLoading(false);
    }, 650);
    return () => {
      if (semanticTimer.current) clearTimeout(semanticTimer.current);
    };
  }, [atQuery]);

  const showQuickActions =
    query.trim().length > 0 && !busy && !showResponse && !slashActive && !atQuery;

  const stuardNavItems = useMemo(() => filterDemoNav(query), [query]);

  const selectableCount = useMemo(() => {
    if (showSlashPanel) return slashCommands.length;
    if (showFilePanel) return quickFiles.length + semanticResults.length;
    if (!showQuickActions) return 0;
    return 2 + attachments.length + stuardNavItems.length;
  }, [
    showSlashPanel,
    slashCommands.length,
    showFilePanel,
    quickFiles.length,
    semanticResults.length,
    showQuickActions,
    attachments.length,
    stuardNavItems.length,
  ]);

  const markInteracted = useCallback(() => {
    if (!interacted.current) {
      interacted.current = true;
      autoToken.current += 1;
      setAutoDemoActive(false);
      setAutoDemoLabel(null);
    }
  }, []);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [assistantText, userPrompt]);

  const visibleBrands = useMemo(() => {
    const seen = new Set<BrandKey>();
    const out: Brand[] = [];
    for (const tc of toolCalls) {
      if (seen.has(tc.brand)) continue;
      seen.add(tc.brand);
      out.push(BRANDS[tc.brand]);
    }
    return out.slice(-3);
  }, [toolCalls]);

  const activeBrandKey = useMemo(() => {
    for (let i = toolCalls.length - 1; i >= 0; i--) {
      if (toolCalls[i].status === 'running') return toolCalls[i].brand;
    }
    return toolCalls.length ? toolCalls[toolCalls.length - 1].brand : null;
  }, [toolCalls]);
  const activeBrand = visibleBrands.find((b) => b.key === activeBrandKey) ?? null;

  const streamReply = useCallback(async (text: string, token: number) => {
    let i = 0;
    while (i < text.length) {
      if (runToken.current !== token) return;
      i = Math.min(text.length, i + 3);
      setAssistantText(text.slice(0, i));
      await delay(16);
    }
  }, []);

  const run = useCallback(
    async (
      steps: DemoStep[],
      reply: string,
      displayPrompt: string,
      promptAttachments: DemoAttachment[] = [],
    ) => {
      const token = ++runToken.current;
      setUserPrompt(displayPrompt);
      setAttachments(promptAttachments);
      setAssistantText('');
      setToolCalls([]);
      setHasReply(true);
      setShowResponse(true);
      setBusy(true);
      setIsStreaming(true);

      for (const step of steps) {
        if (runToken.current !== token) return;
        const id = uid();
        setToolCalls((prev) => [...prev, { id, brand: step.brand, status: 'running' }]);
        await delay(step.duration);
        if (runToken.current !== token) return;
        setToolCalls((prev) => prev.map((t) => (t.id === id ? { ...t, status: 'completed' } : t)));
      }

      if (runToken.current !== token) return;
      await streamReply(reply, token);
      if (runToken.current !== token) return;

      setIsStreaming(false);
      setBusy(false);
    },
    [streamReply],
  );

  const runScenario = useCallback(
    async (scn: Scenario, displayPrompt?: string) => {
      const prompt = displayPrompt ?? scn.prompt;
      await run(scn.steps, scn.reply, prompt, scn.attachments ?? []);
    },
    [run],
  );

  const resetDemoState = useCallback(() => {
    runToken.current += 1;
    setQuery('');
    setUserPrompt('');
    setAssistantText('');
    setToolCalls([]);
    setAttachments([]);
    setShowResponse(false);
    setHasReply(false);
    setBusy(false);
    setIsStreaming(false);
    setVoiceActive(false);
  }, []);

  const autoTypePrompt = useCallback(async (text: string, token: number) => {
    setQuery('');
    for (let i = 1; i <= text.length; i++) {
      if (autoToken.current !== token || interacted.current) return;
      setQuery(text.slice(0, i));
      await delay(AUTO_TYPE_MS);
    }
  }, []);

  const playAutoDemoLoop = useCallback(async () => {
    const token = ++autoToken.current;
    await delay(AUTO_PAUSE_IDLE_MS);
    if (autoToken.current !== token || interacted.current) return;

    setAutoDemoActive(true);

    while (autoToken.current === token && !interacted.current) {
      const id = AUTO_DEMO_IDS[autoIndex.current % AUTO_DEMO_IDS.length];
      autoIndex.current += 1;

      if (id === 'slash') {
        resetDemoState();
        setAutoDemoLabel('Type / for commands');
        await delay(AUTO_PAUSE_IDLE_MS);
        if (autoToken.current !== token || interacted.current) break;

        await autoTypePrompt('/', token);
        if (autoToken.current !== token || interacted.current) break;
        await delay(2200);
        if (autoToken.current !== token || interacted.current) break;

        setQuery('');
        await delay(AUTO_BETWEEN_MS);
        continue;
      }

      if (id === 'at-search') {
        resetDemoState();
        setAutoDemoLabel('@ finds your files — even by meaning');
        await delay(AUTO_PAUSE_IDLE_MS);
        if (autoToken.current !== token || interacted.current) break;

        await autoTypePrompt('@that tax doc from march', token);
        if (autoToken.current !== token || interacted.current) break;
        // hold while the "Searching by meaning…" beat plays and results land
        await delay(2400);
        if (autoToken.current !== token || interacted.current) break;

        setQuery('');
        setAttachments([{ name: 'Tax-Return-2025.pdf', kind: 'pdf' }]);
        await delay(1500);
        if (autoToken.current !== token || interacted.current) break;

        setAttachments([]);
        await delay(AUTO_BETWEEN_MS);
        continue;
      }

      if (id === 'nav') {
        resetDemoState();
        setAutoDemoLabel(NAV_DEMO.label);
        await delay(AUTO_PAUSE_IDLE_MS);
        if (autoToken.current !== token || interacted.current) break;

        await autoTypePrompt(NAV_DEMO.prompt, token);
        if (autoToken.current !== token || interacted.current) break;

        await delay(AUTO_QUICK_ACTIONS_MS + 600);
        if (autoToken.current !== token || interacted.current) break;

        setQuery('');
        await delay(AUTO_BETWEEN_MS);
        continue;
      }

      const scn = scenarioById(id);
      if (!scn) continue;

      resetDemoState();
      setAutoDemoLabel(scn.label);
      await delay(AUTO_PAUSE_IDLE_MS);
      if (autoToken.current !== token || interacted.current) break;

      if (scn.attachments?.length) setAttachments(scn.attachments);
      await autoTypePrompt(scn.prompt, token);
      if (autoToken.current !== token || interacted.current) break;

      await delay(AUTO_QUICK_ACTIONS_MS);
      if (autoToken.current !== token || interacted.current) break;

      setQuery('');
      await runScenario(scn);
      if (autoToken.current !== token || interacted.current) break;

      await delay(AUTO_HOLD_RESULT_MS);
      if (autoToken.current !== token || interacted.current) break;

      // Collapse to the "View response" pull-tab and hold so the overlay's
      // tuck-away affordance reads clearly before the next scenario.
      setShowResponse(false);
      await delay(AUTO_COLLAPSED_MS);
      if (autoToken.current !== token || interacted.current) break;

      await delay(AUTO_BETWEEN_MS);
    }

    setAutoDemoActive(false);
    setAutoDemoLabel(null);
  }, [autoTypePrompt, resetDemoState, runScenario]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    let started = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !started && !interacted.current) {
          started = true;
          void playAutoDemoLoop();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      autoToken.current += 1;
    };
  }, [playAutoDemoLoop]);

  const submit = useCallback(
    (raw?: string) => {
      const text = (raw ?? query).trim();
      if (!text || busy) return;
      markInteracted();
      setVoiceActive(false);
      setQuery('');
      const scn = matchScenario(text);
      if (scn) {
        const display = text.split(/\s+/).length >= 3 ? text : scn.prompt;
        void run(scn.steps, scn.reply, display, scn.attachments ?? []);
      } else {
        void run(GENERIC_STEPS, GENERIC_REPLY, text, attachments);
      }
    },
    [query, busy, run, attachments, markInteracted],
  );

  const runSlashCommand = useCallback(
    (cmd: SlashCmd) => {
      const scn = scenarioById(cmd.scenarioId);
      if (!scn || busy) return;
      markInteracted();
      setQuery('');
      setSelectedAction(0);
      void runScenario(scn);
    },
    [busy, markInteracted, runScenario],
  );

  const selectDemoFile = useCallback(
    (file: DemoFile) => {
      if (!atQuery) return;
      markInteracted();
      setAttachments((prev) =>
        prev.some((a) => a.name === file.name) ? prev : [...prev, { name: file.name, kind: file.kind }],
      );
      setQuery(query.slice(0, atQuery.idx));
      setSelectedAction(0);
      inputRef.current?.focus();
    },
    [atQuery, markInteracted, query],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((showSlashPanel || showFilePanel) && selectableCount > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const delta = e.key === 'ArrowDown' ? 1 : -1;
        setSelectedAction((i) => Math.max(0, Math.min(selectableCount - 1, i + delta)));
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (showSlashPanel) {
          const cmd = slashCommands[selectedAction] ?? slashCommands[0];
          if (cmd) runSlashCommand(cmd);
        } else {
          const all = [...quickFiles, ...semanticResults];
          const file = all[selectedAction] ?? all[0];
          if (file) selectDemoFile(file);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setQuery(showFilePanel && atQuery ? query.slice(0, atQuery.idx) : '');
        return;
      }
    }

    if (showQuickActions && selectableCount > 0) {
      const maxIdx = selectableCount - 1;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedAction((i) => Math.min(maxIdx, i + 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedAction((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (selectedAction === 1) return;
        submit();
        return;
      }
    }

    if (e.key === 'Tab' && !e.shiftKey && query.trim() && !showSlashPanel && !showFilePanel) {
      e.preventDefault();
      submit();
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (showQuickActions && selectedAction === 1) return;
      submit();
    }
  };

  const hasAssistantText = assistantText.trim().length > 0;
  const showThinkingGlow = busy;

  return (
    <div
      ref={rootRef}
      className="stuard-compact-demo relative w-full h-full overflow-hidden select-none"
      onPointerDown={markInteracted}
      style={{ background: '#0a0a0b' }}
    >
      <AppBackdrop />

      {/* Dim + bottom vignette so the workspace recedes and the pill floats above it */}
      <div
        className="absolute inset-0 z-[1] pointer-events-none"
        aria-hidden
        style={{
          background:
            'radial-gradient(135% 78% at 50% 122%, rgba(8,8,10,0.62) 0%, rgba(8,8,10,0.22) 40%, transparent 68%),' +
            'linear-gradient(to bottom, rgba(8,8,10,0.12) 0%, transparent 22%)',
        }}
      />

      <AnimatePresence>
        <DemoCaption label={autoDemoLabel ?? ''} visible={!!autoDemoLabel && autoDemoActive} />
      </AnimatePresence>

      <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col items-center px-4 pb-8 pt-4">
        <AnimatePresence initial={false}>
          {showSlashPanel && (
            <SlashPanel
              commands={slashCommands}
              selectedIndex={selectedAction}
              onHoverIndex={setSelectedAction}
              onRun={runSlashCommand}
            />
          )}
        </AnimatePresence>

        <AnimatePresence initial={false}>
          {showFilePanel && atQuery && (
            <FilePanel
              atQuery={atQuery.q}
              semanticLoading={fileSemanticLoading}
              quick={quickFiles}
              semantic={semanticResults}
              selectedIndex={selectedAction}
              onHoverIndex={setSelectedAction}
              onSelect={selectDemoFile}
            />
          )}
        </AnimatePresence>

        <AnimatePresence initial={false}>
          {showQuickActions && (
            <QuickActionsPanel
              query={query}
              attachments={attachments}
              stuardNavItems={stuardNavItems}
              selectedIndex={selectedAction}
              onHoverIndex={setSelectedAction}
              onAskStuard={() => submit()}
              onWebSearch={() => {}}
              activeEngineId={activeEngineId}
              onSelectEngine={setActiveEngineId}
            />
          )}
        </AnimatePresence>

        <AnimatePresence initial={false}>
          {showResponse && !showQuickActions && (
            <motion.div
              key="response"
              className="w-full"
              style={{ maxWidth: PANEL_MAX_WIDTH, marginBottom: 10 }}
              initial={{ opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            >
              <div
                className="flex flex-col w-full"
                style={{
                  padding: 12,
                  gap: 8,
                  background: BG,
                  border: `0.4px solid ${BORDER}`,
                  borderRadius: 24,
                  boxShadow: SHADOW,
                  boxSizing: 'border-box',
                }}
              >
                <div className="flex items-center justify-between" style={{ height: 16, gap: 10 }}>
                  <button
                    type="button"
                    title="Open full conversation view"
                    className="flex items-center justify-center hover:opacity-80 transition-opacity"
                    style={{ width: 16, height: 16, color: FG_MUTED }}
                    onClick={() => inputRef.current?.focus()}
                  >
                    <Expand strokeWidth={1.5} style={{ width: 14, height: 14 }} />
                  </button>
                  <button
                    type="button"
                    title="Hide"
                    className="flex items-center justify-center hover:opacity-80 transition-opacity ml-auto"
                    style={{ width: 16, height: 16, color: FG_MUTED }}
                    onClick={() => setShowResponse(false)}
                  >
                    <ChevronDown style={{ width: 16, height: 16 }} />
                  </button>
                </div>

                <div
                  ref={bodyRef}
                  className="flex flex-col custom-scrollbar"
                  style={{ gap: 6, maxHeight: 320, overflowY: 'auto' }}
                >
                  <div className="flex justify-end shrink-0">
                    <div
                      style={{
                        maxWidth: 260,
                        padding: '7px 10px',
                        background: USER_BG,
                        borderRadius: 14,
                        boxSizing: 'border-box',
                      }}
                    >
                      <div
                        style={{
                          fontFamily: FONT,
                          fontWeight: 400,
                          fontSize: 12,
                          lineHeight: '18px',
                          color: USER_FG,
                          wordBreak: 'break-word',
                          whiteSpace: 'pre-wrap',
                        }}
                      >
                        {userPrompt}
                      </div>
                    </div>
                  </div>

                  {(hasAssistantText || isStreaming) && (
                    <div
                      className="compact-response-md"
                      style={{
                        fontFamily: FONT,
                        fontWeight: 400,
                        fontSize: 12,
                        lineHeight: '18px',
                        color: FG,
                        wordBreak: 'break-word',
                        paddingTop: 2,
                      }}
                    >
                      {hasAssistantText && (
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
                          {assistantText}
                        </ReactMarkdown>
                      )}
                      {isStreaming && <TypingDots />}
                    </div>
                  )}
                </div>

                <div className="flex items-center" style={{ height: 14 }}>
                  {visibleBrands.length === 0 ? (
                    <div style={{ height: 14 }} />
                  ) : (
                    <div className="flex items-center" style={{ gap: 6 }}>
                      <div className="flex items-center">
                        {visibleBrands.map((b) => (
                          <BrandChip key={b.key} brand={b} active={b.key === activeBrandKey} />
                        ))}
                      </div>
                      {activeBrand && busy && (
                        <span
                          style={{
                            fontFamily: FONT,
                            fontSize: 9,
                            lineHeight: '13px',
                            color: FG_MUTED,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          using {activeBrand.label}…
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="relative w-full" style={{ maxWidth: PILL_MAX_WIDTH }}>
          <AnimatePresence initial={false}>
            {hasReply && !showResponse && (
              <div
                className="absolute left-1/2 -translate-x-1/2"
                style={{ bottom: 'calc(100% - 10px)', width: '50%', height: 44, zIndex: 0 }}
              >
                <motion.button
                  type="button"
                  onClick={() => setShowResponse(true)}
                  className="group w-full h-full flex items-center gap-2 px-3 rounded-t-[18px] border border-b-0 cursor-pointer"
                  style={{ background: BG, borderColor: 'rgb(var(--compact-pill-fg) / 0.12)', boxShadow: SHADOW }}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  whileHover={{ y: -3 }}
                  transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                  title="View response"
                >
                  <span
                    className="flex-1 truncate text-left"
                    style={{ fontSize: 11, fontWeight: 500, color: 'rgb(var(--compact-pill-fg) / 0.85)' }}
                  >
                    {busy ? 'Working…' : 'View response'}
                  </span>
                  {busy && <Loader2 className="animate-spin shrink-0" style={{ width: 12, height: 12, color: RED }} strokeWidth={2.5} />}
                  <ChevronUp className="shrink-0" style={{ width: 14, height: 14, color: 'rgb(var(--compact-pill-fg) / 0.5)' }} strokeWidth={2} />
                </motion.button>
              </div>
            )}
          </AnimatePresence>

          <div className={`w-full relative ${showThinkingGlow ? 'compact-thinking-glow' : ''}`} style={{ zIndex: 2 }}>
            <div
              className={`w-full relative flex flex-col justify-center ${showThinkingGlow ? 'compact-thinking-glow__inner' : 'rounded-[26px]'}`}
              style={{
                minHeight: 56,
                ...(showThinkingGlow ? {} : { backgroundColor: BG, boxShadow: SHADOW }),
              }}
            >
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-1.5 px-3 pt-2.5 pb-0" style={{ zIndex: 2 }}>
                  {attachments.map((att) => (
                    <AttachmentChip key={att.name} att={att} />
                  ))}
                </div>
              )}
              <div className="relative w-full flex items-center" style={{ padding: 10, gap: 8, zIndex: 2 }}>
                <button
                  type="button"
                  tabIndex={-1}
                  className="flex items-center justify-center shrink-0 transition-colors"
                  style={{ width: 24, height: 24, color: 'rgb(var(--compact-pill-fg) / 0.9)' }}
                  title="Attach"
                >
                  <Plus style={{ width: 22, height: 22 }} strokeWidth={1.5} />
                </button>

                <div className="flex-1 relative flex items-center justify-center" style={{ minHeight: 36, padding: 6, gap: 4 }}>
                  {query.trim().length > 0 && !busy && !slashActive && !atQuery && (
                    <span
                      className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 whitespace-nowrap select-none"
                      style={{ fontSize: 10, lineHeight: 1, fontWeight: 400, color: 'rgb(var(--compact-pill-fg) / 0.35)' }}
                      aria-hidden
                    >
                      Tab for quick answer
                    </span>
                  )}
                  <textarea
                    ref={inputRef}
                    value={query}
                    onChange={(e) => {
                      markInteracted();
                      setQuery(e.target.value);
                      if (e.target.value.trim()) setSelectedAction(0);
                    }}
                    onFocus={markInteracted}
                    onKeyDown={onKeyDown}
                    placeholder={busy ? '' : 'Just Ask Stuard'}
                    rows={1}
                    disabled={busy}
                    className={`w-full bg-transparent outline-none resize-none scrollbar-hidden ${query.length > 0 ? 'text-left pr-[7.5rem]' : 'text-center'}`}
                    style={{
                      fontFamily: FONT,
                      fontSize: 14,
                      lineHeight: '20px',
                      color: FG,
                      padding: 0,
                      maxHeight: 80,
                    }}
                  />
                </div>

                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => {
                    markInteracted();
                    setVoiceActive((v) => !v);
                  }}
                  className={`compact-voice-btn ${voiceActive ? 'compact-voice-btn--active' : ''} ${showThinkingGlow ? 'compact-voice-btn--thinking' : ''}`}
                  style={{ width: 36, height: 36 }}
                  title={voiceActive ? 'Stop voice' : 'Start voice'}
                >
                  <AudioLines className="relative z-[1] shrink-0" style={{ width: 18, height: 18, display: 'block' }} strokeWidth={2.25} />
                </button>
              </div>
            </div>
            <CompactDragCorner />
          </div>

          {/* "Try it" hint chips — the playground is useless if visitors don't know
              the affordances. Hidden the moment anything is typed or running. */}
          {!busy && !showResponse && query.length === 0 && (
            <div className="flex items-center justify-center flex-wrap" style={{ gap: 6, marginTop: 12 }}>
              {[
                { label: '/ commands', value: '/' },
                { label: '@ your files', value: '@' },
                { label: '“@tax doc from march” — search by meaning', value: '@tax doc from march' },
              ].map((hint) => (
                <button
                  key={hint.label}
                  type="button"
                  onClick={() => {
                    markInteracted();
                    setQuery(hint.value);
                    setSelectedAction(0);
                    inputRef.current?.focus();
                  }}
                  className="transition-colors hover:opacity-90"
                  style={{
                    fontFamily: FONT,
                    fontSize: 10,
                    lineHeight: '14px',
                    fontWeight: 500,
                    padding: '5px 10px',
                    borderRadius: 9999,
                    color: 'rgb(var(--compact-pill-fg) / 0.78)',
                    background: BG,
                    border: `0.4px solid ${BORDER}`,
                    boxShadow: SHADOW,
                  }}
                >
                  {hint.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
