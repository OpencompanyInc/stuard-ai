import React, { useEffect, useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { clsx } from 'clsx';
import { supabase } from '../../lib/supabaseClient';
import { startBrowserSignIn } from '../../auth/browserSignIn';
import { getValidAccessToken } from '../../auth/authManager';
import { getCloudAiHttp, getMarketplaceApi, type MarketplaceWorkflow } from '../../utils/cloud';
import { usePreferences, type TonePreset } from '../../hooks/usePreferences';
import {
  ArrowRight,
  Bell,
  BookOpen,
  Briefcase,
  Check,
  ChevronLeft,
  Code2,
  Command,
  Download,
  FileText,
  Gamepad2,
  Keyboard,
  Loader2,
  MessageSquare,
  Palette,
  Phone,
  Plug,
  Search,
  Settings,
  Sparkles,
  Star,
  Users,
  Workflow,
  Zap,
  type LucideIcon,
} from 'lucide-react';

// =============================================================================
// HELPERS
// =============================================================================

const DEFAULT_SHORTCUT_KEYS = ['Control', 'Shift', 'Space'];
const SHORTCUT_MODIFIERS = ['Control', 'Alt', 'Shift', 'Command'];
const SHORTCUT_KEYS = [
  'A','B','C','D','E','F','G','H','I','J','K','L','M',
  'N','O','P','Q','R','S','T','U','V','W','X','Y','Z',
  '0','1','2','3','4','5','6','7','8','9','Space','Enter',
  'Tab','Escape','Backspace','Delete','Home','End','PageUp','PageDown',
  'ArrowUp','ArrowDown','ArrowLeft','ArrowRight','F1','F2','F3','F4',
  'F5','F6','F7','F8','F9','F10','F11','F12',
];

interface ToneOption { id: TonePreset; label: string; icon: LucideIcon }

const TONE_OPTIONS: ToneOption[] = [
  { id: 'concise', label: 'Concise', icon: Zap },
  { id: 'friendly', label: 'Friendly', icon: MessageSquare },
  { id: 'formal', label: 'Formal', icon: FileText },
  { id: 'technical', label: 'Technical', icon: Command },
  { id: 'custom', label: 'Custom', icon: Settings },
];

function tonePreview(tone: TonePreset, customTone: string): string {
  switch (tone) {
    case 'concise': return 'Short, direct, and focused on the next move.';
    case 'friendly': return 'Warm, helpful, and still practical.';
    case 'formal': return 'Polished, structured, and professional.';
    case 'technical': return 'Explicit, precise, and detailed.';
    case 'custom': return customTone.trim() || 'Describe your style below.';
    default: return '';
  }
}

function displayHotkey(keys: string[]): string[] {
  return keys.map(k => (k === 'Control' ? 'Ctrl' : k === 'Command' ? 'Cmd' : k));
}
function toAccelerator(keys: string[]): string {
  return keys.map(k => (k === 'Control' ? 'Ctrl' : k === 'Command' ? 'Cmd' : k)).join('+');
}
function hasValidShortcut(keys: string[]): boolean {
  return keys.some(k => SHORTCUT_MODIFIERS.includes(k)) && keys.some(k => !SHORTCUT_MODIFIERS.includes(k));
}

async function getToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || null;
  } catch { return null; }
}

function Fade({ children, delay = 0, duration = 0.8, className }: {
  children: React.ReactNode; delay?: number; duration?: number; className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay, duration, ease: 'easeOut' }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// =============================================================================
// FULL-SCREEN BACKGROUND
// =============================================================================

function AuroraBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[#060608]" />
      <motion.div
        className="absolute rounded-full"
        style={{ width: '55vw', height: '55vw', top: '-20%', left: '-12%', background: 'radial-gradient(circle, rgba(56,168,255,0.07) 0%, transparent 60%)' }}
        animate={{ x: [0, 60, 0], y: [0, 40, 0] }}
        transition={{ duration: 25, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute rounded-full"
        style={{ width: '50vw', height: '50vw', bottom: '-15%', right: '-10%', background: 'radial-gradient(circle, rgba(168,85,247,0.05) 0%, transparent 60%)' }}
        animate={{ x: [0, -50, 0], y: [0, -30, 0] }}
        transition={{ duration: 30, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute rounded-full"
        style={{ width: '30vw', height: '30vw', top: '30%', right: '15%', background: 'radial-gradient(circle, rgba(245,158,11,0.04) 0%, transparent 55%)' }}
        animate={{ x: [0, -25, 0], y: [0, 30, 0] }}
        transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
      />
      <div className="absolute inset-0 opacity-[0.025]" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`, backgroundSize: '128px 128px' }} />
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 70% 60% at 50% 50%, transparent 0%, rgba(0,0,0,0.45) 100%)' }} />
    </div>
  );
}

// =============================================================================
// PAGE WRAPPER & SHARED BUTTONS
// =============================================================================

function Page({ children, stepKey }: { children: React.ReactNode; stepKey: string }) {
  return (
    <motion.div
      key={stepKey}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 0.8, ease: 'easeOut' } }}
      exit={{ opacity: 0, transition: { duration: 1.0, ease: 'easeIn' } }}
      className="absolute inset-0 flex flex-col items-center justify-center px-8"
    >
      {children}
    </motion.div>
  );
}

function ScrollablePage({ children, stepKey }: { children: React.ReactNode; stepKey: string }) {
  return (
    <motion.div
      key={stepKey}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 0.8, ease: 'easeOut' } }}
      exit={{ opacity: 0, transition: { duration: 1.0, ease: 'easeIn' } }}
      className="absolute inset-0 flex flex-col items-center pt-20 pb-12 px-8 overflow-y-auto custom-scrollbar"
    >
      {children}
    </motion.div>
  );
}

function ContinueButton({ onClick, label = 'Continue', disabled = false, delay = 1.2 }: {
  onClick: () => void; label?: string; disabled?: boolean; delay?: number;
}) {
  return (
    <Fade delay={delay}>
      <button
        onClick={onClick}
        disabled={disabled}
        className="mt-14 inline-flex items-center gap-2 rounded-full border border-white/[0.12] bg-white/[0.06] px-7 py-3 text-[13px] font-normal tracking-wide text-white/80 transition-colors duration-300 hover:bg-white/[0.10] hover:text-white disabled:opacity-25 disabled:cursor-not-allowed"
      >
        {label}
        <ArrowRight size={14} className="text-white/40" />
      </button>
    </Fade>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <Fade delay={0.6}>
      <button onClick={onClick} className="absolute top-10 left-10 z-20 inline-flex items-center gap-1 text-[12px] tracking-wide text-white/35 transition-colors duration-300 hover:text-white/60">
        <ChevronLeft size={13} /> Back
      </button>
    </Fade>
  );
}

function SkipButton({ onClick }: { onClick: () => void }) {
  return (
    <Fade delay={1.5} className="absolute top-10 right-10 z-20">
      <button onClick={onClick} className="text-[12px] tracking-wide text-white/30 transition-colors duration-300 hover:text-white/50">Skip</button>
    </Fade>
  );
}

// =============================================================================
// CAPABILITY DATA
// =============================================================================

interface Capability { id: string; icon: LucideIcon; label: string; hook: string; followUp: string; color: string; glow: string }

const CAPABILITIES: Capability[] = [
  {
    id: 'chat', icon: MessageSquare, label: 'Chat',
    hook: "Ever spent 20 minutes down a Google rabbit hole for something that should've taken 10 seconds?",
    followUp: "Just ask me. No tabs, no digging — straight answers.",
    color: 'text-blue-400/80', glow: 'rgba(56,168,255,0.08)',
  },
  {
    id: 'proactive', icon: Bell, label: 'Proactive Agent',
    hook: "You know that feeling when you wake up and realize you forgot to send that email? Or missed a deadline because it just... slipped?",
    followUp: "I keep track of things for you — even when you're asleep.",
    color: 'text-amber-400/80', glow: 'rgba(245,158,11,0.08)',
  },
  {
    id: 'workflows', icon: Workflow, label: 'Workflows',
    hook: "You've probably been paying for a bunch of AI tools that each do one thing. What if you could just build exactly what you need — for free?",
    followUp: "Drag, drop, done. Or just tell me what you want and I'll build it for you.",
    color: 'text-purple-400/80', glow: 'rgba(168,85,247,0.08)',
  },
  {
    id: 'integrations', icon: Plug, label: 'Integrations',
    hook: "Your stuff is scattered across Gmail, Calendar, GitHub, Slack... you're constantly switching tabs just to stay on top of things.",
    followUp: "I plug into all of them, so everything's in one place.",
    color: 'text-emerald-400/80', glow: 'rgba(34,197,94,0.08)',
  },
];

// =============================================================================
// TYPEWRITER
// =============================================================================

function useTypewriter(text: string, speed = 40, startDelay = 600) {
  const [displayed, setDisplayed] = useState('');
  const [done, setDone] = useState(false);
  useEffect(() => {
    setDisplayed(''); setDone(false);
    let i = 0; let timeout: ReturnType<typeof setTimeout>;
    const startTimeout = setTimeout(() => {
      const tick = () => { if (i < text.length) { i++; setDisplayed(text.slice(0, i)); timeout = setTimeout(tick, speed); } else { setDone(true); } };
      tick();
    }, startDelay);
    return () => { clearTimeout(startTimeout); clearTimeout(timeout); };
  }, [text, speed, startDelay]);
  return { displayed, done };
}

// =============================================================================
// PAGE 0: TYPEWRITER INTRO
// =============================================================================

const INTRO_LINES = [
  "Hey there, I'm Stuard.",
  "I live on your desktop — always one shortcut away.",
  "If you need anything, just ask.",
  "Just ask Stuard.",
];

function HelloSplash({ onNext }: { onNext: () => void }) {
  const [lineIndex, setLineIndex] = useState(0);
  const [lines, setLines] = useState<string[]>([]);
  const currentLine = INTRO_LINES[lineIndex];
  const { displayed, done } = useTypewriter(currentLine || '', 35, lineIndex === 0 ? 800 : 400);

  useEffect(() => {
    if (!done || lineIndex >= INTRO_LINES.length - 1) return;
    const t = setTimeout(() => { setLines(prev => [...prev, INTRO_LINES[lineIndex]]); setLineIndex(i => i + 1); }, 600);
    return () => clearTimeout(t);
  }, [done, lineIndex]);

  const allDone = done && lineIndex === INTRO_LINES.length - 1;
  useEffect(() => { if (!allDone) return; const t = setTimeout(onNext, 2200); return () => clearTimeout(t); }, [allDone, onNext]);

  return (
    <Page stepKey="hello">
      <div className="flex flex-col items-start max-w-lg w-full px-4 select-none cursor-pointer" onClick={allDone ? onNext : undefined}>
        {lines.map((line, i) => (
          <motion.p key={i} initial={{ opacity: 0.8 }} animate={{ opacity: 0.35 }} transition={{ duration: 0.6 }} className="text-[clamp(1.4rem,3.5vw,2.2rem)] font-extralight leading-snug text-white/35 mb-3">{line}</motion.p>
        ))}
        {currentLine && (
          <p className="text-[clamp(1.4rem,3.5vw,2.2rem)] font-extralight leading-snug text-white/85 mb-3">
            {displayed}
            {!done && <span className="inline-block w-[2px] h-[1em] bg-white/50 ml-0.5 align-baseline animate-[pulse_1s_ease-in-out_infinite]" />}
          </p>
        )}
      </div>
    </Page>
  );
}

// =============================================================================
// MINI-DEMO COMPONENTS — visual previews that mirror actual features
// =============================================================================

/** Chat demo: a miniature chat exchange with typing */
function ChatDemo() {
  const { displayed: answer, done } = useTypewriter('Paris. The capital of France.', 30, 2400);
  const [showTyping, setShowTyping] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setShowTyping(true), 1800);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="w-[280px] rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden backdrop-blur-sm">
      {/* Title bar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/[0.04]">
        <div className="w-2 h-2 rounded-full bg-blue-400/40" />
        <span className="text-[10px] text-white/30 tracking-wide">Chat</span>
      </div>
      {/* Messages */}
      <div className="px-4 py-3 flex flex-col gap-2.5 min-h-[100px]">
        {/* User message */}
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.4, duration: 0.4 }}
          className="self-end max-w-[80%]"
        >
          <div className="rounded-2xl rounded-br-md bg-blue-500/15 border border-blue-400/10 px-3 py-2">
            <p className="text-[11px] text-white/70">What's the capital of France?</p>
          </div>
        </motion.div>
        {/* Stuard response */}
        {showTyping && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="self-start max-w-[85%]"
          >
            <div className="rounded-2xl rounded-bl-md bg-white/[0.04] border border-white/[0.06] px-3 py-2">
              {!done ? (
                <p className="text-[11px] text-white/60">
                  {answer}<span className="inline-block w-[1.5px] h-[0.85em] bg-white/40 ml-0.5 align-baseline animate-[pulse_1s_ease-in-out_infinite]" />
                </p>
              ) : (
                <p className="text-[11px] text-white/60">{answer}</p>
              )}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}

/** Proactive demo: notification cards sliding in */
function ProactiveDemo() {
  return (
    <div className="flex flex-col gap-2 w-[280px]">
      {[
        { delay: 1.6, icon: '\u2709\uFE0F', text: "You haven't replied to Sarah \u2014 it's been 3 hours.", time: '2m ago' },
        { delay: 2.4, icon: '\uD83D\uDCC5', text: 'Team standup in 15 minutes.', time: 'just now' },
      ].map((n, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: n.delay, duration: 0.5, ease: 'easeOut' }}
          className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 backdrop-blur-sm"
        >
          <div className="flex items-start gap-3">
            <span className="text-[14px] mt-0.5">{n.icon}</span>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-white/65 leading-relaxed">{n.text}</p>
              <p className="text-[9px] text-white/25 mt-1">{n.time}</p>
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

/** Workflow demo: mini node graph with animated connections */
function WorkflowDemo() {
  const nodes = [
    { label: 'New Email', x: 0, color: 'rgba(56,168,255,0.3)' },
    { label: 'AI Summarize', x: 110, color: 'rgba(168,85,247,0.3)' },
    { label: 'Send Slack', x: 220, color: 'rgba(34,197,94,0.3)' },
  ];

  return (
    <div className="w-[300px] rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden backdrop-blur-sm">
      {/* Title bar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/[0.04]">
        <div className="w-2 h-2 rounded-full bg-purple-400/40" />
        <span className="text-[10px] text-white/30 tracking-wide">Workflow Builder</span>
      </div>
      <div className="relative px-5 py-6">
        {/* Connection lines */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ top: 0, left: 0 }}>
          {[0, 1].map(i => (
            <motion.line
              key={i}
              x1={nodes[i].x + 65}
              y1={32}
              x2={nodes[i + 1].x + 25}
              y2={32}
              stroke="rgba(255,255,255,0.08)"
              strokeWidth={1.5}
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ delay: 1.8 + i * 0.4, duration: 0.6 }}
            />
          ))}
          {/* Animated pulse traveling along lines */}
          {[0, 1].map(i => (
            <motion.circle
              key={`pulse-${i}`}
              r={3}
              fill="rgba(168,85,247,0.5)"
              initial={{ cx: nodes[i].x + 65, cy: 32, opacity: 0 }}
              animate={{
                cx: [nodes[i].x + 65, nodes[i + 1].x + 25],
                cy: 32,
                opacity: [0, 1, 1, 0],
              }}
              transition={{ delay: 3.0 + i * 0.6, duration: 0.8, ease: 'easeInOut' }}
            />
          ))}
        </svg>
        {/* Nodes */}
        <div className="flex items-center justify-between relative z-10">
          {nodes.map((node, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 1.4 + i * 0.2, duration: 0.4 }}
              className="flex flex-col items-center gap-1.5"
            >
              <div
                className="w-[50px] h-[36px] rounded-lg border border-white/[0.08] flex items-center justify-center"
                style={{ background: node.color }}
              >
                <span className="text-[8px] text-white/50 font-medium tracking-wide">{(i + 1)}</span>
              </div>
              <span className="text-[9px] text-white/40 whitespace-nowrap">{node.label}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Integrations demo: app icons consolidating into one hub */
function IntegrationsDemo() {
  const apps = [
    { label: 'Gmail', color: '#EA4335', letter: 'G' },
    { label: 'Calendar', color: '#4285F4', letter: 'C' },
    { label: 'GitHub', color: '#8B5CF6', letter: 'GH' },
    { label: 'Slack', color: '#E01E5A', letter: 'S' },
  ];

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex items-center gap-3">
        {apps.map((app, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.4 + i * 0.15, duration: 0.4 }}
            className="flex flex-col items-center gap-1.5"
          >
            <div
              className="w-10 h-10 rounded-xl border border-white/[0.06] flex items-center justify-center"
              style={{ background: `${app.color}15` }}
            >
              <span className="text-[10px] font-semibold" style={{ color: app.color }}>{app.letter}</span>
            </div>
            <span className="text-[9px] text-white/30">{app.label}</span>
          </motion.div>
        ))}
      </div>
      {/* Connecting arrows */}
      <motion.div
        initial={{ opacity: 0, scaleY: 0 }}
        animate={{ opacity: 1, scaleY: 1 }}
        transition={{ delay: 2.4, duration: 0.5 }}
        className="flex flex-col items-center gap-1"
      >
        <div className="w-px h-4 bg-gradient-to-b from-white/10 to-white/5" />
        <div className="w-2 h-2 rotate-45 border-b border-r border-white/15" />
      </motion.div>
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 2.8, duration: 0.5 }}
        className="rounded-xl border border-emerald-400/15 bg-emerald-500/[0.06] px-5 py-2.5"
      >
        <span className="text-[11px] text-emerald-300/70 tracking-wide">Everything in one place</span>
      </motion.div>
    </div>
  );
}

const CAPABILITY_DEMOS: Record<string, React.FC> = {
  chat: ChatDemo,
  proactive: ProactiveDemo,
  workflows: WorkflowDemo,
  integrations: IntegrationsDemo,
};

// =============================================================================
// PAGES 1-4: CAPABILITY SHOWCASE
// =============================================================================

function CapabilityPage({ capability, index, total, onNext, onBack }: {
  capability: Capability; index: number; total: number; onNext: () => void; onBack: () => void;
}) {
  const Demo = CAPABILITY_DEMOS[capability.id];

  return (
    <Page stepKey={`cap-${capability.id}`}>
      <BackButton onClick={onBack} />

      {/* Hook — the relatable scenario */}
      <Fade delay={0.3} duration={1.0}>
        <p className="max-w-[28rem] text-center text-[18px] leading-relaxed text-white/70 font-light italic">
          {capability.hook}
        </p>
      </Fade>

      {/* Interactive demo that mirrors the real feature */}
      <Fade delay={1.0} duration={0.6}>
        <div className="mt-10">
          {Demo && <Demo />}
        </div>
      </Fade>

      {/* Follow-up — the punchline */}
      <Fade delay={2.0} duration={0.9}>
        <p className="mt-6 max-w-[26rem] text-center text-[15px] leading-relaxed text-white/55 font-light">
          {capability.followUp}
        </p>
      </Fade>

      <Fade delay={2.6}>
        <div className="mt-8 flex items-center gap-2">
          {Array.from({ length: total }).map((_, i) => (<div key={i} className={clsx('rounded-full transition-all duration-700', i === index ? 'h-1.5 w-6 bg-white/50' : 'h-1.5 w-1.5 bg-white/10')} />))}
        </div>
      </Fade>
      <ContinueButton onClick={onNext} delay={2.8} />
    </Page>
  );
}

// =============================================================================
// PAGE 5: SIGN IN
// =============================================================================

function SignInPage({ signedIn, signingIn, userEmail, onSignIn, onNext, onBack }: {
  signedIn: boolean; signingIn: boolean; userEmail: string | null;
  onSignIn: () => Promise<void>; onNext: () => void; onBack: () => void;
}) {
  return (
    <Page stepKey="signin">
      <BackButton onClick={onBack} />
      {signedIn ? (
        <>
          <Fade delay={0.2} duration={0.9}><div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-emerald-500/10 bg-emerald-500/[0.04]"><Check className="w-7 h-7 text-emerald-400/70" strokeWidth={1.5} /></div></Fade>
          <Fade delay={0.5}><h2 className="mt-8 text-[28px] font-light text-white/90">Signed in</h2></Fade>
          <Fade delay={0.7}><p className="mt-2 text-[14px] text-white/50">{userEmail}</p></Fade>
        </>
      ) : (
        <>
          <Fade delay={0.2}><h2 className="text-[28px] font-light text-white/90">Sign in</h2></Fade>
          <Fade delay={0.5}><p className="mt-3 text-[14px] text-white/50 font-light">Optional. Sync your settings across devices.</p></Fade>
          <Fade delay={0.8}>
            <button onClick={() => void onSignIn()} disabled={signingIn} className="mt-8 rounded-full border border-white/[0.08] bg-white/[0.03] px-7 py-3 text-[13px] font-normal tracking-wide text-white/60 transition-colors duration-300 hover:bg-white/[0.06] hover:text-white/80 disabled:opacity-40">
              {signingIn ? 'Opening browser...' : 'Sign in with browser'}
            </button>
          </Fade>
        </>
      )}
      <ContinueButton onClick={onNext} label={signedIn ? 'Continue' : 'Skip for now'} />
    </Page>
  );
}

// =============================================================================
// PAGE 6: "WHAT DO YOU DO?" — role selection for personalized suggestions
// =============================================================================

interface RoleOption { id: string; icon: LucideIcon; label: string; sub: string }

const ROLES: RoleOption[] = [
  { id: 'developer', icon: Code2, label: 'Developer', sub: 'Code, PRs, automation' },
  { id: 'student', icon: BookOpen, label: 'Student', sub: 'Research, notes, assignments' },
  { id: 'creator', icon: Palette, label: 'Creator', sub: 'Content, social, design' },
  { id: 'business', icon: Briefcase, label: 'Business', sub: 'Email, meetings, reports' },
  { id: 'hobbyist', icon: Gamepad2, label: 'Hobbyist', sub: 'Projects, learning, fun' },
];

function RolePage({ onNext, onBack, onSelect }: { onNext: () => void; onBack: () => void; onSelect: (roles: string) => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleRole = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      onSelect(Array.from(next).join(','));
      return next;
    });
  };

  return (
    <Page stepKey="role">
      <BackButton onClick={onBack} />
      <Fade delay={0.2}><h2 className="text-[28px] font-light text-white/90">What do you do?</h2></Fade>
      <Fade delay={0.5}><p className="mt-3 text-[14px] text-white/50 font-light">Pick all that apply — this helps Stuard suggest the right workflows.</p></Fade>

      <Fade delay={0.7}>
        <div className="mt-10 flex flex-wrap justify-center gap-3 max-w-md">
          {ROLES.map(role => {
            const active = selected.has(role.id);
            return (
              <button
                key={role.id}
                onClick={() => toggleRole(role.id)}
                className={clsx(
                  'flex items-center gap-3 rounded-2xl border px-5 py-3.5 text-left transition-all duration-300 min-w-[180px]',
                  active
                    ? 'border-white/15 bg-white/[0.07]'
                    : 'border-white/[0.05] bg-white/[0.015] hover:border-white/[0.08] hover:bg-white/[0.03]',
                )}
              >
                <div className={clsx(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-all duration-300',
                  active ? 'border-white/30 bg-white/[0.12]' : 'border-white/[0.10] bg-white/[0.02]',
                )}>
                  {active && <Check size={11} className="text-white/80" strokeWidth={2.5} />}
                </div>
                <role.icon size={18} strokeWidth={1.5} className={active ? 'text-white/80' : 'text-white/40'} />
                <div>
                  <span className={clsx('text-[13px] font-normal', active ? 'text-white/90' : 'text-white/60')}>{role.label}</span>
                  <span className={clsx('block text-[11px]', active ? 'text-white/45' : 'text-white/35')}>{role.sub}</span>
                </div>
              </button>
            );
          })}
        </div>
      </Fade>

      {selected.size > 0 && (
        <Fade delay={0} duration={0.3}>
          <p className="mt-4 text-[12px] text-white/45">{selected.size} selected</p>
        </Fade>
      )}

      <ContinueButton onClick={onNext} disabled={selected.size === 0} />
    </Page>
  );
}

// =============================================================================
// PAGE 7: FEATURES SETUP — proactive agent, phone number, connect more apps
// =============================================================================

function FeaturesPage({ onNext, onBack, signedIn }: { onNext: () => void; onBack: () => void; signedIn: boolean }) {
  // Proactive
  const [proactiveOn, setProactiveOn] = useState(false);
  const [proactiveLoading, setProactiveLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await (window as any).desktopAPI?.proactiveGetConfig?.();
        if (!cancelled && res?.config) {
          setProactiveOn(!!res.config.enabled);
        }
      } catch { }
    })();
    return () => { cancelled = true; };
  }, []);

  // Phone (Telnyx)
  const [phoneStep, setPhoneStep] = useState<'idle' | 'input' | 'code' | 'done'>('idle');
  const [countryCode, setCountryCode] = useState('+1');
  const [phoneDigits, setPhoneDigits] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [phoneLoading, setPhoneLoading] = useState(false);
  const [phoneError, setPhoneError] = useState('');
  const [verifiedPhone, setVerifiedPhone] = useState('');

  const toggleProactive = async () => {
    setProactiveLoading(true);
    try {
      const next = !proactiveOn;
      await (window as any).desktopAPI.proactiveUpdateConfig({ enabled: next });
      setProactiveOn(next);
    } catch {} finally { setProactiveLoading(false); }
  };

  const handlePhoneRequest = async () => {
    const digits = phoneDigits.replace(/\D/g, '');
    if (countryCode === '+1' ? digits.length !== 10 : digits.length < 6) return;
    setPhoneLoading(true); setPhoneError('');
    try {
      const token = await getValidAccessToken();
      const res = await fetch(`${getCloudAiHttp()}/integrations/telnyx/request-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ phone: `${countryCode}${digits}`, slot: 0 }),
      });
      const data = await res.json();
      if (data.ok) { setPhoneStep('code'); } else { setPhoneError(data.error || 'Failed to send code.'); }
    } catch { setPhoneError('Network error.'); } finally { setPhoneLoading(false); }
  };

  const handlePhoneVerify = async () => {
    if (verifyCode.length < 4) return;
    setPhoneLoading(true); setPhoneError('');
    try {
      const token = await getValidAccessToken();
      const res = await fetch(`${getCloudAiHttp()}/integrations/telnyx/verify-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ code: verifyCode, slot: 0 }),
      });
      const data = await res.json();
      if (data.ok) { setVerifiedPhone(data.phone || `${countryCode}${phoneDigits.replace(/\D/g, '')}`); setPhoneStep('done'); }
      else { setPhoneError(data.error || 'Invalid code.'); }
    } catch { setPhoneError('Network error.'); } finally { setPhoneLoading(false); }
  };

  const phoneE164 = `${countryCode}${phoneDigits.replace(/\D/g, '')}`;
  const phoneValid = countryCode === '+1' ? phoneDigits.replace(/\D/g, '').length === 10 : phoneDigits.replace(/\D/g, '').length >= 6;

  return (
    <ScrollablePage stepKey="features">
      <BackButton onClick={onBack} />

      <Fade delay={0.2}><h2 className="text-[28px] font-light text-white/90">A couple things before we start</h2></Fade>
      <Fade delay={0.5}><p className="mt-3 text-[14px] text-white/55 font-light">Turn on what you want now — you can always change this later.</p></Fade>

      <Fade delay={0.7}>
        <div className="mt-10 flex flex-col gap-4 w-full max-w-md">

          {/* PROACTIVE AGENT */}
          <div className={clsx('rounded-2xl border px-5 py-4 transition-all duration-300', proactiveOn ? 'border-amber-400/20 bg-amber-500/[0.06]' : 'border-white/[0.06] bg-white/[0.02]')}>
            <div className="flex items-center gap-4">
              <div className={clsx('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', proactiveOn ? 'bg-amber-500/15' : 'bg-white/[0.04]')}>
                <Bell className="w-5 h-5 text-amber-400" strokeWidth={1.5} />
              </div>
              <div className="flex-1">
                <span className="text-[14px] font-normal text-white/90">Proactive Agent</span>
                <p className="text-[12px] text-white/55 mt-0.5">I'll remember things so you don't have to — reminders, follow-ups, check-ins.</p>
              </div>
              <button
                onClick={() => void toggleProactive()}
                disabled={proactiveLoading}
                className={clsx('h-7 w-12 rounded-full border relative transition-all duration-300 shrink-0', proactiveOn ? 'border-amber-400/30 bg-amber-500/20' : 'border-white/[0.10] bg-white/[0.03]')}
              >
                {proactiveLoading ? (
                  <Loader2 className="w-3 h-3 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-spin text-white/50" />
                ) : (
                  <div className={clsx('absolute top-1 h-5 w-5 rounded-full transition-all duration-300', proactiveOn ? 'left-[22px] bg-amber-300' : 'left-1 bg-white/30')} />
                )}
              </button>
            </div>
          </div>

          {/* PHONE — text or call you */}
          <div className={clsx('rounded-2xl border px-5 py-4 transition-all duration-300', phoneStep === 'done' ? 'border-emerald-400/20 bg-emerald-500/[0.06]' : 'border-white/[0.06] bg-white/[0.02]')}>
            <div className="flex items-center gap-4">
              <div className={clsx('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', phoneStep === 'done' ? 'bg-emerald-500/15' : 'bg-white/[0.04]')}>
                <Phone className="w-5 h-5 text-emerald-400" strokeWidth={1.5} />
              </div>
              <div className="flex-1">
                <span className="text-[14px] font-normal text-white/90">Phone Number</span>
                <p className="text-[12px] text-white/55 mt-0.5">
                  {phoneStep === 'done' ? `Verified: ${verifiedPhone}` : 'Stuard can text or call you — reminders, alerts, check-ins.'}
                </p>
              </div>
              {phoneStep === 'idle' && (
                <button
                  onClick={() => signedIn ? setPhoneStep('input') : undefined}
                  disabled={!signedIn}
                  className="shrink-0 rounded-full border border-white/[0.10] px-3 py-1.5 text-[11px] text-white/60 transition-colors hover:text-white/80 hover:border-white/[0.15] disabled:opacity-30"
                >
                  Verify
                </button>
              )}
              {phoneStep === 'done' && <Check size={16} className="text-emerald-400 shrink-0" />}
            </div>

            <AnimatePresence>
              {phoneStep === 'input' && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.3 }} className="overflow-hidden">
                  <div className="mt-4 flex gap-2">
                    <input value={countryCode} onChange={e => setCountryCode(e.target.value)} className="w-16 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-2 text-[13px] text-white/80 outline-none text-center font-light" />
                    <input value={phoneDigits} onChange={e => setPhoneDigits(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && phoneValid) handlePhoneRequest(); }} placeholder="Phone number" className="flex-1 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[13px] text-white/80 outline-none placeholder:text-white/25 font-light" />
                  </div>
                  {phoneError && <p className="mt-2 text-[11px] text-rose-400/80">{phoneError}</p>}
                  <div className="mt-3 flex gap-2">
                    <button onClick={() => { setPhoneStep('idle'); setPhoneError(''); }} className="rounded-lg border border-white/[0.06] px-3 py-1.5 text-[11px] text-white/40 hover:text-white/60 transition-colors">Cancel</button>
                    <button onClick={() => void handlePhoneRequest()} disabled={!phoneValid || phoneLoading} className="rounded-lg border border-emerald-400/20 bg-emerald-500/[0.08] px-4 py-1.5 text-[11px] text-emerald-300 hover:bg-emerald-500/[0.12] transition-colors disabled:opacity-30 flex items-center gap-1.5">
                      {phoneLoading ? <Loader2 size={10} className="animate-spin" /> : null} Send code
                    </button>
                  </div>
                </motion.div>
              )}
              {phoneStep === 'code' && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.3 }} className="overflow-hidden">
                  <p className="mt-4 text-[11px] text-white/45">Code sent to {phoneE164}</p>
                  <input value={verifyCode} onChange={e => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))} onKeyDown={e => { if (e.key === 'Enter' && verifyCode.length >= 4) handlePhoneVerify(); }} placeholder="Enter code" maxLength={6} className="mt-2 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[13px] text-white/80 outline-none placeholder:text-white/25 font-light tracking-[0.3em] text-center" />
                  {phoneError && <p className="mt-2 text-[11px] text-rose-400/80">{phoneError}</p>}
                  <div className="mt-3 flex gap-2">
                    <button onClick={() => { setPhoneStep('input'); setPhoneError(''); setVerifyCode(''); }} className="rounded-lg border border-white/[0.06] px-3 py-1.5 text-[11px] text-white/40 hover:text-white/60 transition-colors">Back</button>
                    <button onClick={() => void handlePhoneVerify()} disabled={verifyCode.length < 4 || phoneLoading} className="rounded-lg border border-emerald-400/20 bg-emerald-500/[0.08] px-4 py-1.5 text-[11px] text-emerald-300 hover:bg-emerald-500/[0.12] transition-colors disabled:opacity-30 flex items-center gap-1.5">
                      {phoneLoading ? <Loader2 size={10} className="animate-spin" /> : null} Verify
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {!signedIn && (
            <p className="text-[11px] text-white/40 text-center mt-1">Sign in first to verify your phone number.</p>
          )}
        </div>
      </Fade>

      <ContinueButton onClick={onNext} />
    </ScrollablePage>
  );
}

// =============================================================================
// PAGE 8: WORKFLOW MARKETPLACE — real workflows from API
// =============================================================================

function MarketplacePage({ onNext, onBack, userRole }: { onNext: () => void; onBack: () => void; userRole: string }) {
  const [workflows, setWorkflows] = useState<MarketplaceWorkflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [installing, setInstalling] = useState<string | null>(null);

  // Fetch real workflows on mount
  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        const token = await getToken();
        const api = getMarketplaceApi(() => token);
        // Try featured first, fall back to search
        const featured = await api.getFeatured();
        if (active && featured.ok && featured.workflows.length > 0) {
          setWorkflows(featured.workflows);
        } else if (active) {
          // Search by role for personalized results
          const roleQueries: Record<string, string> = {
            developer: 'development',
            student: 'research',
            creator: 'content',
            business: 'productivity',
            hobbyist: 'automation',
          };
          const search = await api.search({ query: roleQueries[userRole] || '', limit: 12 });
          if (active && search.ok) setWorkflows(search.results);
        }
      } catch {} finally { if (active) setLoading(false); }
    };
    void load();
    return () => { active = false; };
  }, [userRole]);

  const filtered = query.trim()
    ? workflows.filter(w => w.name.toLowerCase().includes(query.toLowerCase()) || (w.category || '').toLowerCase().includes(query.toLowerCase()))
    : workflows;

  const toggle = (slug: string) => {
    setSelected(prev => { const next = new Set(prev); if (next.has(slug)) next.delete(slug); else next.add(slug); return next; });
  };

  const handleContinue = async () => {
    // Download selected workflows
    if (selected.size > 0) {
      const token = await getToken();
      const api = getMarketplaceApi(() => token);
      for (const slug of selected) {
        setInstalling(slug);
        try { await api.download(slug); } catch {}
      }
      setInstalling(null);
    }
    onNext();
  };

  return (
    <ScrollablePage stepKey="marketplace">
      <BackButton onClick={onBack} />

      <Fade delay={0.2}><h2 className="text-[28px] font-light text-white/90">Start with a workflow</h2></Fade>
      <Fade delay={0.5}><p className="mt-3 text-[14px] text-white/55 font-light">These are pre-built — grab one and it just works. Or skip and build your own later.</p></Fade>

      <Fade delay={0.7}>
        <div className="mt-8 w-full max-w-lg relative">
          <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" strokeWidth={1.5} />
          <input type="text" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search workflows..." className="w-full rounded-xl border border-white/[0.08] bg-white/[0.03] pl-10 pr-4 py-2.5 text-[13px] text-white/80 outline-none placeholder:text-white/30 focus:border-white/[0.12] font-light" />
        </div>
      </Fade>

      <Fade delay={0.9}>
        <div className="mt-5 w-full max-w-lg">
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-white/30" /></div>
          ) : filtered.length === 0 ? (
            <p className="text-center py-12 text-[13px] text-white/45">No workflows found.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 max-h-[300px] overflow-y-auto pr-1 custom-scrollbar">
              {filtered.map(wf => {
                const isSelected = selected.has(wf.slug);
                const isInstalling = installing === wf.slug;
                return (
                  <button
                    key={wf.id}
                    onClick={() => toggle(wf.slug)}
                    disabled={!!installing}
                    className={clsx(
                      'flex flex-col gap-2 rounded-xl border px-4 py-3.5 text-left transition-all duration-300',
                      isSelected ? 'border-white/[0.15] bg-white/[0.07]' : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.10] hover:bg-white/[0.04]',
                    )}
                  >
                    <div className="flex items-center gap-2 w-full">
                      <span className="text-[13px] font-normal text-white/85 truncate flex-1">{wf.name}</span>
                      {isInstalling ? <Loader2 size={12} className="animate-spin text-white/50 shrink-0" /> : isSelected ? <Check size={12} className="text-white/60 shrink-0" /> : null}
                    </div>
                    <p className="text-[11px] leading-relaxed text-white/50 line-clamp-2">{wf.short_description || wf.description}</p>
                    <div className="flex items-center gap-3 mt-auto">
                      {wf.category && <span className="text-[10px] tracking-wide text-white/35 uppercase">{wf.category}</span>}
                      {wf.download_count > 0 && (
                        <span className="flex items-center gap-1 text-[10px] text-white/35">
                          <Download size={9} /> {wf.download_count}
                        </span>
                      )}
                      {wf.rating_avg > 0 && (
                        <span className="flex items-center gap-1 text-[10px] text-white/35">
                          <Star size={9} /> {wf.rating_avg.toFixed(1)}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </Fade>

      {selected.size > 0 && (
        <Fade delay={0} duration={0.3}>
          <p className="mt-4 text-[12px] text-white/45">{selected.size} selected</p>
        </Fade>
      )}

      <ContinueButton onClick={() => void handleContinue()} label={selected.size > 0 ? `Install ${selected.size} & continue` : 'Skip for now'} delay={1.1} />
    </ScrollablePage>
  );
}

// =============================================================================
// PAGE 9: TONE
// =============================================================================

function TonePage({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const { tone, setTone, customTone, setCustomTone, persona, setPersona } = usePreferences();
  const canContinue = tone !== 'custom' || customTone.trim().length > 0;

  return (
    <Page stepKey="tone">
      <BackButton onClick={onBack} />
      <Fade delay={0.2}><h2 className="text-[28px] font-light text-white/90">How should Stuard talk?</h2></Fade>
      <Fade delay={0.5}><p className="mt-3 text-[14px] text-white/50 font-light">You can always change this later.</p></Fade>

      <Fade delay={0.7}>
        <div className="mt-10 flex flex-wrap justify-center gap-2.5 max-w-md">
          {TONE_OPTIONS.map(option => {
            const active = tone === option.id;
            return (
              <button key={option.id} onClick={() => setTone(option.id)} className={clsx('flex items-center gap-2 rounded-full border px-4 py-2.5 text-[13px] font-normal tracking-wide transition-colors duration-300', active ? 'border-white/15 bg-white/[0.07] text-white/85' : 'border-white/[0.06] bg-transparent text-white/50 hover:text-white/65 hover:border-white/[0.10]')}>
                <option.icon size={14} strokeWidth={1.5} />{option.label}
              </button>
            );
          })}
        </div>
      </Fade>

      <AnimatePresence mode="wait">
        <motion.div key={tone} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.4 }} className="mt-8 max-w-sm text-center text-[13px] leading-relaxed text-white/55 font-light">
          &ldquo;{tonePreview(tone, customTone)}&rdquo;
        </motion.div>
      </AnimatePresence>

      <AnimatePresence>
        {tone === 'custom' && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.4 }} className="mt-5 w-full max-w-sm overflow-hidden">
            <textarea value={customTone} onChange={e => setCustomTone(e.target.value)} rows={2} maxLength={200} placeholder="e.g. Talk like a sharp but friendly teammate" className="w-full resize-none rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-[13px] text-white/80 outline-none placeholder:text-white/30 focus:border-white/[0.12] font-light" />
          </motion.div>
        )}
      </AnimatePresence>

      <Fade delay={1}>
        <div className="mt-6 w-full max-w-sm">
          <textarea value={persona} onChange={e => setPersona(e.target.value)} rows={2} maxLength={240} placeholder="Optional: describe your role or how you work" className="w-full resize-none rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-[12px] text-white/55 outline-none placeholder:text-white/25 focus:border-white/[0.10] font-light" />
        </div>
      </Fade>

      <ContinueButton onClick={onNext} disabled={!canContinue} />
    </Page>
  );
}

// =============================================================================
// PAGE 10: SHORTCUT
// =============================================================================

function ShortcutPage({ onBack, onComplete, onSkip }: { onBack: () => void; onComplete: () => void; onSkip?: () => void }) {
  const [recording, setRecording] = useState(false);
  const [recordedKeys, setRecordedKeys] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!recording) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault(); event.stopPropagation();
      if (event.key === 'Escape' && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) { setRecording(false); setError(null); return; }
      const nextKeys: string[] = [];
      if (event.ctrlKey) nextKeys.push('Control');
      if (event.altKey) nextKeys.push('Alt');
      if (event.shiftKey) nextKeys.push('Shift');
      if (event.metaKey) nextKeys.push('Command');
      const rawKey = event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : event.key;
      if (rawKey && !SHORTCUT_MODIFIERS.includes(rawKey) && SHORTCUT_KEYS.includes(rawKey)) nextKeys.push(rawKey);
      const uniqueKeys = Array.from(new Set(nextKeys));
      setRecordedKeys(uniqueKeys); setError(null);
      if (hasValidShortcut(uniqueKeys)) setRecording(false);
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [recording]);

  const displayKeys = displayHotkey(recordedKeys.length > 0 ? recordedKeys : DEFAULT_SHORTCUT_KEYS);

  const handleFinish = async () => {
    if (recording) return;
    const keys = recordedKeys.length > 0 ? recordedKeys : DEFAULT_SHORTCUT_KEYS;
    if (!hasValidShortcut(keys)) { setError('Use a modifier + another key.'); return; }
    setSaving(true); setError(null);
    try {
      const accel = toAccelerator(keys);
      const result = await (window as any).desktopAPI.setGlobalHotkey(accel);
      if (!result?.ok) { setError(result?.error || 'Failed to register.'); return; }
      try { localStorage.setItem('stuard_global_hotkey', accel); } catch {}
      onComplete();
    } catch { setError('Something went wrong.'); } finally { setSaving(false); }
  };

  return (
    <Page stepKey="shortcut">
      <BackButton onClick={onBack} />
      <Fade delay={0.2}><h2 className="text-[28px] font-light text-white/90">Set a shortcut</h2></Fade>
      <Fade delay={0.5}><p className="mt-3 text-[14px] text-white/50 font-light">{recording ? 'Press your shortcut...' : 'Open Stuard from anywhere on your desktop.'}</p></Fade>

      <Fade delay={0.7}>
        <div className="mt-12 flex items-center gap-3">
          {displayKeys.map((key, i) => (
            <React.Fragment key={`${key}-${i}`}>
              {i > 0 && <span className="text-[15px] text-white/10 font-light">+</span>}
              <motion.span layout transition={{ duration: 0.3 }} className={clsx('min-w-[60px] rounded-xl border px-5 py-3 text-center text-[16px] font-light tracking-wide', recording ? 'border-blue-400/15 bg-blue-500/[0.04] text-blue-300/70' : 'border-white/[0.06] bg-white/[0.02] text-white/70')}>{key}</motion.span>
            </React.Fragment>
          ))}
        </div>
      </Fade>

      {error && <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }} className="mt-4 text-[12px] text-rose-400/60">{error}</motion.p>}

      <Fade delay={0.9}>
        <div className="mt-8 flex items-center gap-3">
          <button onClick={() => { setRecording(true); setRecordedKeys([]); setError(null); }} disabled={saving} className="rounded-full border border-white/[0.08] px-4 py-2 text-[12px] tracking-wide text-white/45 transition-colors duration-300 hover:text-white/65 hover:border-white/[0.12]">
            <Keyboard size={12} className="inline mr-1.5 -mt-px" strokeWidth={1.5} />{recording ? 'Listening...' : 'Record custom'}
          </button>
          {recordedKeys.length > 0 && <button onClick={() => { setRecordedKeys([]); setError(null); }} className="text-[12px] tracking-wide text-white/35 transition-colors duration-300 hover:text-white/55">Reset</button>}
        </div>
      </Fade>

      <Fade delay={1.2}>
        <div className="mt-14 flex items-center gap-6">
          {onSkip && <button onClick={onSkip} className="text-[12px] text-white/30 transition-colors duration-300 hover:text-white/50">Skip</button>}
          <button onClick={() => void handleFinish()} disabled={recording || saving} className="inline-flex items-center gap-2 rounded-full border border-white/[0.12] bg-white/[0.06] px-7 py-3 text-[13px] font-normal tracking-wide text-white/80 transition-colors duration-300 hover:bg-white/[0.10] hover:text-white disabled:opacity-25">
            {saving ? 'Saving...' : 'Finish'}<ArrowRight size={14} className="text-white/40" />
          </button>
        </div>
      </Fade>
    </Page>
  );
}

// =============================================================================
// PAGE 11: COMPLETION — two CTAs, fade out background
// =============================================================================

function CompletionPage({ onConnectApps, onTryHotkey }: { onConnectApps: () => void; onTryHotkey: () => void }) {
  const savedHotkey = (() => {
    try { return localStorage.getItem('stuard_global_hotkey') || 'Ctrl+Shift+Space'; } catch { return 'Ctrl+Shift+Space'; }
  })();
  const keys = savedHotkey.replace(/Cmd/g, '⌘').split('+').map(k => k.trim());

  return (
    <Page stepKey="complete">
      <Fade delay={0.15} duration={0.9}>
        <div className="relative">
          <div className="absolute inset-0 rounded-full blur-[60px] opacity-80" style={{ background: 'rgba(56,168,255,0.12)', transform: 'scale(5)' }} />
          <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.04]">
            <Check className="w-9 h-9 text-white/90" strokeWidth={1.5} />
          </div>
        </div>
      </Fade>

      <Fade delay={0.4} duration={0.9}>
        <h2 className="mt-10 text-[28px] font-light tracking-tight text-white/90">You're all set</h2>
      </Fade>

      <Fade delay={0.7} duration={0.9}>
        <p className="mt-4 max-w-[26rem] text-center text-[15px] leading-relaxed text-white/50 font-light">
          Stuard is running. Pick how you want to start.
        </p>
      </Fade>

      <Fade delay={1.0}>
        <div className="mt-12 flex flex-col gap-3 w-full max-w-xs">
          {/* CTA 1: Connect Apps */}
          <button
            onClick={onConnectApps}
            className="group w-full flex items-center gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.04] px-5 py-4 transition-all duration-300 hover:border-white/[0.15] hover:bg-white/[0.07] active:scale-[0.98]"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/[0.08] border border-emerald-500/[0.12]">
              <Plug className="w-5 h-5 text-emerald-400/80" strokeWidth={1.5} />
            </div>
            <div className="flex-1 text-left">
              <span className="text-[14px] font-normal text-white/85">Connect Your Apps</span>
              <p className="text-[11px] text-white/40 mt-0.5">Gmail, Calendar, GitHub & more</p>
            </div>
            <ArrowRight className="w-4 h-4 text-white/20 group-hover:text-white/50 transition-colors shrink-0" />
          </button>

          {/* CTA 2: Try the Hotkey */}
          <button
            onClick={onTryHotkey}
            className="group w-full flex items-center gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.04] px-5 py-4 transition-all duration-300 hover:border-white/[0.15] hover:bg-white/[0.07] active:scale-[0.98]"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/[0.08] border border-blue-500/[0.12]">
              <Keyboard className="w-5 h-5 text-blue-400/80" strokeWidth={1.5} />
            </div>
            <div className="flex-1 text-left">
              <span className="text-[14px] font-normal text-white/85">Try the Hotkey</span>
              <div className="flex items-center gap-1 mt-1">
                {keys.map((k, i) => (
                  <React.Fragment key={`${k}-${i}`}>
                    {i > 0 && <span className="text-[10px] text-white/15">+</span>}
                    <span className="px-1.5 py-0.5 rounded-md bg-white/[0.06] border border-white/[0.08] text-[10px] text-white/50 font-mono">{k}</span>
                  </React.Fragment>
                ))}
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-white/20 group-hover:text-white/50 transition-colors shrink-0" />
          </button>
        </div>
      </Fade>
    </Page>
  );
}

// =============================================================================
// MAIN — hello → caps → sign-in → role → features → marketplace → tone → shortcut → done
// =============================================================================

interface InteractiveWelcomeProps {
  onComplete: () => void;
  onSkip?: () => void;
}

export function InteractiveWelcome({ onComplete, onSkip }: InteractiveWelcomeProps) {
  const [page, setPage] = useState(0);
  const [signedIn, setSignedIn] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [userRole, setUserRole] = useState('');
  const [fadingOut, setFadingOut] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      setSignedIn(!!data?.session);
      setUserEmail(data?.session?.user?.email ?? null);
    };
    void load();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_ev, session) => {
      setSignedIn(!!session);
      setUserEmail(session?.user?.email ?? null);
      setSigningIn(false);
    });
    return () => { active = false; try { subscription.unsubscribe(); } catch {} };
  }, []);

  const handleSignIn = async () => {
    setSigningIn(true);
    const result = await startBrowserSignIn();
    if (!result.ok) setSigningIn(false);
  };

  const handleRoleSelect = (role: string) => {
    setUserRole(role);
    try { localStorage.setItem('stuard_user_role', role); } catch {}
  };

  const next = useCallback(() => setPage(p => p + 1), []);
  const back = useCallback(() => setPage(p => Math.max(0, p - 1)), []);

  // Fade out the entire background then call onComplete
  const dismiss = useCallback(() => {
    setFadingOut(true);
    setTimeout(() => onComplete(), 600);
  }, [onComplete]);

  const handleConnectApps = useCallback(() => {
    // Open dashboard integrations tab before closing onboarding window
    try { (window as any).desktopAPI?.openDashboard?.({ tab: 'integrations' }); } catch {}
    dismiss();
  }, [dismiss]);

  const handleTryHotkey = useCallback(() => {
    dismiss();
  }, [dismiss]);

  // 0=hello, 1-4=caps, 5=signin, 6=role, 7=features, 8=marketplace, 9=tone, 10=shortcut, 11=done
  return (
    <motion.div
      className="relative h-full w-full overflow-hidden"
      initial={{ opacity: 1 }}
      animate={{ opacity: fadingOut ? 0 : 1 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
    >
      <AuroraBackground />
      {onSkip && page > 0 && page < 11 && <SkipButton onClick={onSkip} />}
      <div className="relative z-10 h-full w-full">
        <AnimatePresence mode="wait">
          {page === 0 && <HelloSplash onNext={next} />}
          {page >= 1 && page <= 4 && <CapabilityPage capability={CAPABILITIES[page - 1]} index={page - 1} total={CAPABILITIES.length} onNext={next} onBack={back} />}
          {page === 5 && <SignInPage signedIn={signedIn} signingIn={signingIn} userEmail={userEmail} onSignIn={handleSignIn} onNext={next} onBack={back} />}
          {page === 6 && <RolePage onNext={next} onBack={back} onSelect={handleRoleSelect} />}
          {page === 7 && <FeaturesPage onNext={next} onBack={back} signedIn={signedIn} />}
          {page === 8 && <MarketplacePage onNext={next} onBack={back} userRole={userRole} />}
          {page === 9 && <TonePage onNext={next} onBack={back} />}
          {page === 10 && <ShortcutPage onBack={back} onComplete={next} onSkip={() => setPage(11)} />}
          {page === 11 && <CompletionPage onConnectApps={handleConnectApps} onTryHotkey={handleTryHotkey} />}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
