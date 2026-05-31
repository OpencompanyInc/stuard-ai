"use client";

/**
 * CompactDemo — a faithful, interactive clone of Stuard's desktop "compact mode"
 * launcher, rebuilt for the marketing site in dark mode.
 *
 * It mirrors apps/desktop's CompactStatusPill + CompactInputPill +
 * CompactResponsePanel + CompactHub: the floating status pill, the translucent
 * input pill (with the red→amber "thinking" sweep border and voice halo), and
 * the quick-response card that opens above the bar with the user's prompt on the
 * right, the streamed reply on the left, and integration "brand chips" in the
 * footer.
 *
 * Visitors can type. Stuard's real orchestrator (the cloud Opus model, "Scout")
 * isn't wired to this public page — responses are hand-authored and streamed to
 * look exactly like a live run. Typing one of the suggested asks (or anything
 * close to it) triggers the matching canned flow; anything else falls back to a
 * generic plan so the bar never feels broken.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Mic,
  Bell,
  ListTodo,
  type LucideIcon,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/* Tokens (dark mode — mirrors apps/desktop styles.css)               */
/* ------------------------------------------------------------------ */
const FG = 'rgb(var(--compact-pill-fg))';
const FG_MUTED = 'rgb(var(--compact-pill-fg-muted))';
const BG = 'rgb(var(--compact-pill-bg))';
const BORDER = 'rgb(var(--compact-pill-fg) / 0.18)';
const SHADOW = 'var(--compact-pill-shadow)';
const RED = '#FF383C';
const USER_BG = '#FFFFFF';
const USER_FG = '#171717';
const FONT = "'General Sans', var(--font-geist-sans), 'Inter', system-ui, sans-serif";
const PANEL_MAX_WIDTH = 372;

/* ------------------------------------------------------------------ */
/* Brand chips (mirrors apps/desktop utils/toolBrand)                 */
/* ------------------------------------------------------------------ */
type BrandKey =
  | 'gmail'
  | 'calendar'
  | 'slack'
  | 'notion'
  | 'web'
  | 'docs'
  | 'people'
  | 'generic';

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
  generic: { key: 'generic', label: 'a tool', Icon: Globe, color: '#94A3B8' },
};

interface ToolCallLite {
  id: string;
  brand: BrandKey;
  status: 'running' | 'completed';
}

/* ------------------------------------------------------------------ */
/* Canned scenarios                                                   */
/* ------------------------------------------------------------------ */
interface DemoStep {
  brand: BrandKey;
  status: string;
  duration: number;
}

interface Scenario {
  id: string;
  chip: string;
  prompt: string;
  keywords: string[];
  steps: DemoStep[];
  reply: string;
}

const SCENARIOS: Scenario[] = [
  {
    id: 'email',
    chip: 'Summarize my unread emails',
    prompt: 'Summarize my unread emails and draft replies to the urgent ones',
    keywords: ['email', 'inbox', 'unread', 'mail', 'gmail', 'summari'],
    steps: [
      { brand: 'gmail', status: 'Reading your inbox…', duration: 1500 },
      { brand: 'gmail', status: 'Drafting replies…', duration: 1500 },
    ],
    reply:
      'You have **12 unread** — 3 need a reply today:\n\n' +
      '- **Acme contract** — Priya needs sign-off by 5pm. *Draft ready.*\n' +
      '- **Design review** — moved to Thursday 2pm. *Draft ready.*\n' +
      '- **Invoice #4821** — finance is waiting on the PO number. *Draft ready.*\n\n' +
      'The rest are newsletters and CC threads. Want me to send the 3 drafts?',
  },
  {
    id: 'crm',
    chip: 'Add a contact to my CRM',
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
    chip: 'Schedule a team sync',
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
    id: 'research',
    chip: 'Compare Notion vs alternatives',
    prompt: 'Find the top 3 alternatives to Notion and compare them',
    keywords: ['compare', 'research', 'competitor', 'alternative', 'vs', 'notion', 'find'],
    steps: [
      { brand: 'web', status: 'Searching the web…', duration: 1600 },
      { brand: 'web', status: 'Reading 9 sources…', duration: 1500 },
      { brand: 'docs', status: 'Building comparison…', duration: 1200 },
    ],
    reply:
      'Here are the top 3, side by side:\n\n' +
      '| Tool | Best for | Free plan |\n' +
      '| --- | --- | --- |\n' +
      '| Coda | Docs + automation | Yes |\n' +
      '| Obsidian | Local-first notes | Yes |\n' +
      '| ClickUp | Project management | Yes |\n\n' +
      'Notion still wins on flexibility. Want this saved as a doc?',
  },
  {
    id: 'slack',
    chip: 'Post an update to #launch',
    prompt: 'Tell the #launch channel that the build is live',
    keywords: ['slack', 'channel', 'post', 'tell', 'launch', 'message', '#'],
    steps: [
      { brand: 'slack', status: 'Opening Slack…', duration: 1100 },
      { brand: 'slack', status: 'Posting message…', duration: 1200 },
    ],
    reply:
      'Posted to **#launch**:\n\n' +
      '> 🚀 The build is live! Grab the latest from the dashboard and drop any issues here.\n\n' +
      'Already picked up 3 🎉 reactions.',
  },
];

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

/* ------------------------------------------------------------------ */
/* Ambient status rotation (mirrors useStatusCarousel)                */
/* ------------------------------------------------------------------ */
type StatusIconKey = 'ai' | 'working' | 'mic' | 'tool' | 'task' | 'bell' | 'calendar';

interface StatusView {
  iconKey: StatusIconKey;
  text: string;
  color?: string;
  brand?: BrandKey;
  urgent?: boolean;
}

const AMBIENT: StatusView[] = [
  { iconKey: 'ai', text: 'Stuard is ready' },
  { iconKey: 'bell', text: '2 reminders today', color: '#F59E0B' },
  { iconKey: 'calendar', text: 'Design sync at 2:30', color: '#3B82F6' },
  { iconKey: 'task', text: 'Inbox triaged 9m ago', color: '#10B981' },
];

/* ------------------------------------------------------------------ */
/* Markdown renderer (mirrors COMPACT_MD_COMPONENTS)                  */
/* ------------------------------------------------------------------ */
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
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      style={{ color: '#818CF8', textDecoration: 'underline', textUnderlineOffset: 2 }}
    >
      {children}
    </a>
  ),
};

/* ------------------------------------------------------------------ */
/* Small pieces                                                       */
/* ------------------------------------------------------------------ */
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

const StatusIcon = ({ view }: { view: StatusView }) => {
  if (view.iconKey === 'working')
    return <Loader2 className="animate-spin" style={{ width: 16, height: 16, color: RED }} strokeWidth={2} />;
  if (view.iconKey === 'mic')
    return <Mic style={{ width: 16, height: 16, color: RED }} strokeWidth={1.75} />;
  if (view.iconKey === 'bell')
    return <Bell style={{ width: 16, height: 16, color: view.color }} strokeWidth={1.75} />;
  if (view.iconKey === 'calendar')
    return <Calendar style={{ width: 16, height: 16, color: view.color }} strokeWidth={1.75} />;
  if (view.iconKey === 'task')
    return <ListTodo style={{ width: 16, height: 16, color: view.color }} strokeWidth={1.75} />;
  if (view.iconKey === 'tool' && view.brand) {
    const b = BRANDS[view.brand];
    return <b.Icon style={{ width: 16, height: 16, color: b.color }} strokeWidth={1.75} />;
  }
  // 'ai' — on-brand pulsing red dot instead of a sparkle
  return (
    <span className="relative flex items-center justify-center" style={{ width: 16, height: 16 }}>
      <span className="absolute rounded-full animate-ping" style={{ width: 10, height: 10, background: RED, opacity: 0.35 }} />
      <span className="relative rounded-full" style={{ width: 7, height: 7, background: RED }} />
    </span>
  );
};

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const uid = () => Math.random().toString(36).slice(2);

/* ------------------------------------------------------------------ */
/* Main component                                                     */
/* ------------------------------------------------------------------ */
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

  const [runningStatus, setRunningStatus] = useState<StatusView | null>(null);
  const [justCompleted, setJustCompleted] = useState(false);

  // Ambient rotation
  const [ambientIndex, setAmbientIndex] = useState(0);

  const [interacted, setInteracted] = useState(false);
  const runToken = useRef(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  /* --- Ambient status rotation (paused while busy/voice) --- */
  const ambientLive = !busy && !voiceActive && !justCompleted;
  useEffect(() => {
    if (!ambientLive) return;
    const t = setInterval(() => setAmbientIndex((i) => (i + 1) % AMBIENT.length), 4000);
    return () => clearInterval(t);
  }, [ambientLive]);

  /* --- Auto-scroll response body as it streams --- */
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [assistantText, userPrompt]);

  /* --- Derive the active status view --- */
  const statusView: StatusView = useMemo(() => {
    if (voiceActive) return { iconKey: 'mic', text: 'Listening…', urgent: true };
    if (runningStatus) return runningStatus;
    if (justCompleted) return { iconKey: 'task', text: 'Task complete', color: '#10B981' };
    return AMBIENT[ambientIndex];
  }, [voiceActive, runningStatus, justCompleted, ambientIndex]);

  // The pill keeps its label visible — the icon+text flip-animate as the
  // underlying status changes (mirrors the desktop pill once it has something
  // to say).
  const statusExpanded = true;

  /* --- Brand chips derived from tool calls --- */
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

  /* --- Stream a reply char-by-char --- */
  const streamReply = useCallback(async (text: string, token: number) => {
    let i = 0;
    while (i < text.length) {
      if (runToken.current !== token) return;
      i = Math.min(text.length, i + 3);
      setAssistantText(text.slice(0, i));
      await delay(16);
    }
  }, []);

  /* --- Run a full scenario --- */
  const run = useCallback(
    async (steps: DemoStep[], reply: string, displayPrompt: string) => {
      const token = ++runToken.current;
      setUserPrompt(displayPrompt);
      setAssistantText('');
      setToolCalls([]);
      setHasReply(true);
      setShowResponse(true);
      setBusy(true);
      setIsStreaming(true);
      setJustCompleted(false);

      for (const step of steps) {
        if (runToken.current !== token) return;
        const id = uid();
        setToolCalls((prev) => [...prev, { id, brand: step.brand, status: 'running' }]);
        setRunningStatus({ iconKey: 'tool', text: step.status, brand: step.brand });
        await delay(step.duration);
        if (runToken.current !== token) return;
        setToolCalls((prev) => prev.map((t) => (t.id === id ? { ...t, status: 'completed' } : t)));
      }

      if (runToken.current !== token) return;
      setRunningStatus({ iconKey: 'working', text: 'Writing your reply…' });
      await streamReply(reply, token);
      if (runToken.current !== token) return;

      setIsStreaming(false);
      setBusy(false);
      setRunningStatus(null);
      setJustCompleted(true);
      setTimeout(() => {
        if (runToken.current === token) setJustCompleted(false);
      }, 2600);
    },
    [streamReply],
  );

  /* --- Submit handler --- */
  const submit = useCallback(
    (raw?: string) => {
      const text = (raw ?? query).trim();
      if (!text || busy) return;
      setInteracted(true);
      setVoiceActive(false);
      setQuery('');
      const scn = matchScenario(text);
      if (scn) {
        // Show the user's own words if they typed a real sentence; otherwise the
        // canonical example so a one-word query doesn't look broken.
        const display = text.split(/\s+/).length >= 3 ? text : scn.prompt;
        void run(scn.steps, scn.reply, display);
      } else {
        void run(GENERIC_STEPS, GENERIC_REPLY, text);
      }
    },
    [query, busy, run],
  );

  /* --- Autoplay one flow when first scrolled into view --- */
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !interacted) {
          io.disconnect();
          timer = setTimeout(() => {
            if (!interacted && runToken.current === 0) {
              const scn = SCENARIOS[0];
              void run(scn.steps, scn.reply, scn.prompt);
            }
          }, 1400);
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [interacted, run]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const hasAssistantText = assistantText.trim().length > 0;
  const showThinkingGlow = busy;

  return (
    <div
      ref={rootRef}
      className="stuard-compact-demo relative w-full h-full overflow-hidden select-none"
      style={{
        // A real desktop wallpaper — deliberately colorful so the near-black
        // Stuard pill reads as a distinct overlay floating on top of it.
        background:
          'radial-gradient(120% 90% at 12% 8%, #3b4f8a 0%, transparent 46%),' +
          'radial-gradient(120% 110% at 88% 14%, #6d3b86 0%, transparent 52%),' +
          'radial-gradient(140% 120% at 70% 100%, #2a6f7a 0%, transparent 55%),' +
          'linear-gradient(160deg, #15161f 0%, #0c0d12 100%)',
      }}
    >
      {/* ---- Faux desktop backdrop (so the bar reads as a real overlay) ---- */}
      <DesktopBackdrop dimmed={showResponse || busy} />

      {/* ---- Compact stack, anchored bottom-center ---- */}
      <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col items-center px-4 pb-6">
        {/* Response panel */}
        <AnimatePresence initial={false}>
          {showResponse && (
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
                  backdropFilter: 'blur(18px)',
                  WebkitBackdropFilter: 'blur(18px)',
                  borderRadius: 24,
                  boxShadow: SHADOW,
                  boxSizing: 'border-box',
                }}
              >
                {/* Header */}
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
                  <span style={{ fontFamily: FONT, fontSize: 10, color: FG_MUTED, letterSpacing: 0.2 }}>
                    Scout · cloud Opus
                  </span>
                  <button
                    type="button"
                    title="Hide"
                    className="flex items-center justify-center hover:opacity-80 transition-opacity"
                    style={{ width: 16, height: 16, color: FG_MUTED }}
                    onClick={() => setShowResponse(false)}
                  >
                    <ChevronDown style={{ width: 16, height: 16 }} />
                  </button>
                </div>

                {/* Body */}
                <div
                  ref={bodyRef}
                  className="flex flex-col custom-scrollbar"
                  style={{ gap: 6, maxHeight: 320, overflowY: 'auto' }}
                >
                  {/* User bubble */}
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

                  {/* Assistant reply */}
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

                {/* Footer — brand chips */}
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
                            fontWeight: 400,
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

        {/* Status pill */}
        <div className="flex w-full justify-center" style={{ maxWidth: 420, marginBottom: 8 }}>
          <motion.button
            type="button"
            layout
            transition={{ type: 'spring', stiffness: 320, damping: 30, mass: 0.7 }}
            className={`flex items-center min-w-0 outline-none ${statusView.urgent ? 'animate-pulse' : ''}`}
            style={{
              backgroundColor: BG,
              borderRadius: 9999,
              padding: '6px 12px',
              gap: 8,
              height: 32,
              maxWidth: '100%',
              boxShadow: statusView.urgent ? '0 0 12px rgba(255,56,60,0.35)' : SHADOW,
              cursor: 'default',
            }}
          >
            <div className="relative flex items-center justify-center shrink-0" style={{ width: 16, height: 16 }}>
              <AnimatePresence initial={false} mode="popLayout">
                <motion.span
                  key={`${statusView.iconKey}-${statusView.text}`}
                  className="absolute inset-0 flex items-center justify-center"
                  initial={{ y: '100%', opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: '-100%', opacity: 0 }}
                  transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                >
                  <StatusIcon view={statusView} />
                </motion.span>
              </AnimatePresence>
            </div>
            <AnimatePresence initial={false}>
              {statusExpanded && (
                <motion.div
                  key="status-text"
                  className="overflow-hidden whitespace-nowrap"
                  initial={{ opacity: 0, width: 0, marginLeft: -8 }}
                  animate={{ opacity: 1, width: 'auto', marginLeft: 0 }}
                  exit={{ opacity: 0, width: 0, marginLeft: -8 }}
                  transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                  style={{ height: 16 }}
                >
                  <AnimatePresence initial={false} mode="popLayout">
                    <motion.span
                      key={statusView.text}
                      className="block whitespace-nowrap"
                      initial={{ y: '100%', opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      exit={{ y: '-100%', opacity: 0 }}
                      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                      style={{ fontSize: 12, lineHeight: '16px', fontFamily: FONT, fontWeight: 400, color: FG }}
                    >
                      {statusView.text}
                    </motion.span>
                  </AnimatePresence>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.button>
        </div>

        {/* Input pill + peek */}
        <div className="relative w-full" style={{ maxWidth: 420 }}>
          {/* Peek strip — shown when a reply exists but the panel is collapsed */}
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
                    className="flex-1 truncate"
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

          {/* The pill */}
          <div className={`w-full relative ${showThinkingGlow ? 'compact-thinking-glow' : ''}`} style={{ zIndex: 2 }}>
            <div
              className={`w-full relative flex flex-col justify-center ${showThinkingGlow ? 'compact-thinking-glow__inner' : ''}`}
              style={{
                minHeight: 56,
                borderRadius: 26,
                ...(showThinkingGlow ? {} : { backgroundColor: BG, boxShadow: SHADOW }),
              }}
            >
              <div className="relative w-full flex items-center" style={{ padding: 10, gap: 8, zIndex: 2 }}>
                {/* Attach */}
                <button
                  type="button"
                  tabIndex={-1}
                  className="flex items-center justify-center shrink-0 transition-colors"
                  style={{ width: 24, height: 24, color: 'rgb(var(--compact-pill-fg) / 0.9)' }}
                  title="Attach"
                >
                  <Plus style={{ width: 22, height: 22 }} strokeWidth={1.5} />
                </button>

                {/* Textarea */}
                <div className="flex-1 relative flex items-center justify-center" style={{ minHeight: 36, padding: 6, gap: 4 }}>
                  {query.trim().length > 0 && (
                    <span
                      className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 whitespace-nowrap select-none"
                      style={{ fontSize: 10, lineHeight: 1, fontWeight: 400, color: 'rgb(var(--compact-pill-fg) / 0.35)' }}
                      aria-hidden
                    >
                      ↵ send
                    </span>
                  )}
                  <textarea
                    ref={inputRef}
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      if (!interacted) setInteracted(true);
                    }}
                    onFocus={() => setInteracted(true)}
                    onKeyDown={onKeyDown}
                    placeholder="Ask anything…"
                    rows={1}
                    className={`w-full bg-transparent outline-none resize-none scrollbar-hidden ${query.length > 0 ? 'text-left pr-20' : 'text-center'}`}
                    style={{
                      fontFamily: FONT,
                      fontSize: 12,
                      lineHeight: '16px',
                      color: FG,
                      padding: 0,
                      maxHeight: 80,
                    }}
                  />
                </div>

                {/* Voice */}
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => {
                    setInteracted(true);
                    setVoiceActive((v) => !v);
                  }}
                  className={`compact-voice-btn shrink-0 ${voiceActive ? 'compact-voice-btn--active' : ''} ${showThinkingGlow ? 'compact-voice-btn--thinking' : ''}`}
                  style={{ width: 36, height: 36 }}
                  title={voiceActive ? 'Stop voice' : 'Start voice'}
                >
                  <AudioLines style={{ width: 18, height: 18 }} strokeWidth={2.25} />
                </button>
              </div>
            </div>
          </div>

          {/* Suggestion chips */}
          <div className="flex flex-wrap items-center justify-center gap-1.5" style={{ marginTop: 12 }}>
            {SCENARIOS.slice(0, 4).map((scn) => (
              <button
                key={scn.id}
                type="button"
                disabled={busy}
                onClick={() => submit(scn.prompt)}
                className="transition-all hover:-translate-y-0.5 disabled:opacity-40"
                style={{
                  fontFamily: FONT,
                  fontSize: 11,
                  fontWeight: 500,
                  color: 'rgb(var(--compact-pill-fg) / 0.75)',
                  padding: '5px 11px',
                  borderRadius: 9999,
                  border: `0.5px solid ${BORDER}`,
                  background: 'rgb(var(--compact-pill-fg) / 0.04)',
                  cursor: busy ? 'default' : 'pointer',
                }}
              >
                {scn.chip}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Faux desktop backdrop                                              */
/* ------------------------------------------------------------------ */
function DesktopBackdrop({ dimmed }: { dimmed: boolean }) {
  return (
    <div
      className="absolute inset-0 transition-all duration-500"
      style={{ filter: dimmed ? 'blur(3px) brightness(0.8)' : 'none' }}
    >
      {/* Menu bar — translucent over the wallpaper */}
      <div
        className="absolute top-0 inset-x-0 h-7 flex items-center px-4 gap-4 backdrop-blur-md"
        style={{ background: 'rgba(10,12,20,0.35)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.85)' }}>Stuard</span>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>File</span>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>Edit</span>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>View</span>
        <div className="ml-auto flex items-center gap-3">
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>100%</span>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>Fri 2:14 PM</span>
        </div>
      </div>

      {/* A real-looking light app window so the dark Stuard pill clearly floats on top */}
      <div
        className="absolute left-1/2 top-[14%] -translate-x-1/2 w-[80%] max-w-2xl rounded-xl overflow-hidden shadow-2xl"
        style={{ border: '1px solid rgba(255,255,255,0.12)' }}
      >
        <div
          className="h-9 flex items-center px-3 gap-1.5"
          style={{ background: '#f4f5f7', borderBottom: '1px solid rgba(0,0,0,0.06)' }}
        >
          <span className="w-3 h-3 rounded-full" style={{ background: '#ff5f57' }} />
          <span className="w-3 h-3 rounded-full" style={{ background: '#febc2e' }} />
          <span className="w-3 h-3 rounded-full" style={{ background: '#28c840' }} />
          <span className="ml-3" style={{ fontSize: 11, fontWeight: 500, color: '#64748b' }}>
            CRM — Contacts
          </span>
        </div>
        <div className="p-5" style={{ background: '#ffffff' }}>
          <div className="mb-3" style={{ width: '32%', height: 11, borderRadius: 4, background: '#cbd5e1' }} />
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex items-center gap-3 py-2.5"
              style={{ borderBottom: '1px solid #f1f5f9' }}
            >
              <span className="rounded-full" style={{ width: 26, height: 26, background: i === 0 ? '#fecdd3' : '#e2e8f0' }} />
              <span className="rounded" style={{ width: `${38 + i * 11}%`, height: 9, background: '#e2e8f0' }} />
              <span className="ml-auto rounded" style={{ width: 54, height: 9, background: '#eef2f6' }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
