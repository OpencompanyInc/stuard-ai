import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { clsx } from 'clsx';
import {
  ArrowRight,
  Check,
  Keyboard,
} from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { startBrowserSignIn } from '../../auth/browserSignIn';

// ─── Types ─────────────────────────────────────────────────────────────────

type Scene =
  | 'signin'
  | 'intro'
  | 'greet'
  | 'story'
  | 'acknowledge'
  | 'wakeword-try1'
  | 'wakeword-try2'
  | 'wakeword-success'
  | 'hotkey-intro'
  | 'hotkey-set'
  | 'done';

interface Props {
  onComplete: () => void;
  onSkip?: () => void;
}

// ─── Constants ─────────────────────────────────────────────────────────────

const DEFAULT_HOTKEY = ['Control', 'Shift', 'Space'];
const SHORTCUT_MODIFIERS = ['Control', 'Alt', 'Shift', 'Command'];
const AGENT_HTTP = (window as any).__AGENT_HTTP__ || 'http://127.0.0.1:8765';

// ─── Helpers ───────────────────────────────────────────────────────────────

function toAccelerator(keys: string[]): string {
  return keys.map(k => (k === 'Control' ? 'Ctrl' : k === 'Command' ? 'Cmd' : k)).join('+');
}

function displayHotkey(keys: string[]): string[] {
  return keys.map(k => (k === 'Control' ? 'Ctrl' : k === 'Command' ? 'Cmd' : k));
}

function hasValidShortcut(keys: string[]): boolean {
  return keys.some(k => SHORTCUT_MODIFIERS.includes(k)) && keys.some(k => !SHORTCUT_MODIFIERS.includes(k));
}

function pickFirstName(name: string | null | undefined, fallback: string): string {
  const raw = (name || '').trim();
  if (!raw) return fallback;
  return raw.split(/\s+/)[0] || fallback;
}

// Persist the name the user gives at "What should I call you?" as a core
// identity fact, so it lands in Dashboard → Memories → My Context and
// personalizes the agent from the very first session. Fire-and-forget: the
// name is also kept in localStorage, so a momentarily-unreachable agent is fine.
async function saveNameToMemory(name: string): Promise<void> {
  try {
    await fetch(`${AGENT_HTTP}/v1/knowledge/facts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: 'personal',
        subtype: 'core',
        attribute_key: 'name',
        text: name,
        source: 'onboarding',
      }),
    });
  } catch {
    /* agent may not be up yet during onboarding — name persists in localStorage */
  }
}

// ─── Light-develop reveal ───────────────────────────────────────────────────
// A warm light edge sweeps left→right and the text "develops" behind it, then
// stays. Replaces the old typewriter. The sweep is driven imperatively through
// refs so React doesn't re-render on every animation frame.

interface DevelopTiming {
  holdMs?: number;        // beat to read each phrase before it fades out
  tailMs?: number;        // pause after the final phrase before onComplete
  revealBase?: number;    // base reveal duration, ms
  revealPerChar?: number; // extra reveal time per character, ms
}

function LightDevelopLine({
  phrases,
  single = false,
  onRevealed,
  onComplete,
  timing,
}: {
  phrases: string[];
  single?: boolean;
  onRevealed?: () => void;
  onComplete?: () => void;
  timing?: DevelopTiming;
}) {
  const textRef = useRef<HTMLParagraphElement>(null);
  const glowRef = useRef<HTMLSpanElement>(null);

  // Keep latest callbacks without restarting the animation loop.
  const onRevealedRef = useRef(onRevealed); onRevealedRef.current = onRevealed;
  const onCompleteRef = useRef(onComplete); onCompleteRef.current = onComplete;

  const { holdMs = 1500, tailMs = 1100, revealBase = 320, revealPerChar = 9 } = timing || {};
  const key = phrases.join('|');

  useEffect(() => {
    const textEl = textRef.current;
    const glowEl = glowRef.current;
    if (!textEl) return;
    let cancelled = false;
    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const wait = (ms: number) => new Promise<void>(r => { timer = setTimeout(r, ms); });

    const reveal = (text: string) => new Promise<void>(resolve => {
      textEl.textContent = text;
      textEl.style.opacity = '1';
      if (reduce) {
        textEl.style.maskImage = 'none'; textEl.style.webkitMaskImage = 'none';
        if (glowEl) glowEl.style.opacity = '0';
        resolve();
        return;
      }
      const dur = revealBase + text.length * revealPerChar;
      const width = textEl.offsetWidth;
      const start = performance.now();
      if (glowEl) glowEl.style.opacity = '0.9';
      const frame = (now: number) => {
        if (cancelled) { resolve(); return; }
        const p = Math.min(1.12, (now - start) / dur);
        const pct = p * 100;
        const mask = `linear-gradient(90deg, #000 ${pct - 7}%, rgba(0,0,0,0) ${pct + 5}%)`;
        textEl.style.maskImage = mask; textEl.style.webkitMaskImage = mask;
        if (glowEl) {
          glowEl.style.left = `${Math.min(width, p * width)}px`;
          glowEl.style.opacity = p >= 1.05 ? '0' : '0.9';
        }
        if (p >= 1.12) {
          textEl.style.maskImage = 'none'; textEl.style.webkitMaskImage = 'none';
          resolve();
          return;
        }
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    });

    const fadeOut = async () => {
      textEl.style.transition = 'opacity 0.3s ease';
      textEl.style.opacity = '0';
      await wait(320);
      textEl.style.transition = '';
    };

    const run = async () => {
      for (let i = 0; i < phrases.length; i++) {
        if (cancelled) return;
        await reveal(phrases[i]);
        if (cancelled) return;
        if (single) { onRevealedRef.current?.(); return; }
        if (i === phrases.length - 1) {
          await wait(tailMs);
          if (cancelled) return;
          onCompleteRef.current?.();
          return;
        }
        await wait(holdMs);
        if (cancelled) return;
        await fadeOut();
      }
    };
    void run();

    return () => { cancelled = true; cancelAnimationFrame(raf); if (timer) clearTimeout(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, single]);

  return (
    <span className="relative inline-block">
      <p
        ref={textRef}
        className="text-center text-[clamp(1.05rem,1.55vw,1.3rem)] font-extralight leading-relaxed text-white/95 max-w-[42ch] mx-auto"
        style={{ textShadow: '0 2px 24px rgba(40,10,12,0.7), 0 0 2px rgba(0,0,0,0.5)' }}
      />
      <span
        ref={glowRef}
        aria-hidden
        className="pointer-events-none absolute top-1/2 h-[1.6em] w-[60px] -translate-x-1/2 -translate-y-1/2 opacity-0"
        style={{
          background: 'radial-gradient(closest-side, rgba(255,180,160,0.55), rgba(255,180,160,0) 72%)',
          filter: 'blur(6px)',
        }}
      />
    </span>
  );
}

// ─── Red atmospheric glow ─────────────────────────────────────────────────

function RedGlow() {
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden">
      {/* deep core — warm bright center, same scattered placement as the
          original glow but as a soft-edged rounded rectangle instead of an
          oval. Heavy blur creates the falloff at the rectangle's edges. */}
      <motion.div
        className="absolute left-1/2 top-1/2"
        style={{
          x: '-50%', y: '-50%',
          width: '65vw', height: '65vh',
          maxWidth: '880px', maxHeight: '880px',
          background: 'rgba(180, 55, 55, 0.34)',
          borderRadius: '40px',
          filter: 'blur(80px)',
        }}
        animate={{ scale: [1, 1.04, 1] }}
        transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* hotter highlight just above center */}
      <div
        className="absolute left-1/2 top-1/2"
        style={{
          transform: 'translate(-50%, calc(-50% - 6vh))',
          width: '36vw', height: '36vh',
          maxWidth: '480px', maxHeight: '480px',
        }}
      >
        <motion.div
          className="w-full h-full"
          style={{
            background: 'rgba(215, 110, 85, 0.26)',
            borderRadius: '24px',
            filter: 'blur(60px)',
          }}
          animate={{ x: [0, 14, -8, 0], y: [0, -8, 6, 0] }}
          transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      {/* drifting cloud wisp inside the glow — a long flat rectangle */}
      <div
        className="absolute left-1/2 top-1/2"
        style={{
          transform: 'translate(-50%, calc(-50% + 5vh))',
          width: '46vw', height: '22vh',
          maxWidth: '600px', maxHeight: '290px',
        }}
      >
        <motion.div
          className="w-full h-full"
          style={{
            background: 'rgba(220, 90, 70, 0.14)',
            borderRadius: '14px',
            filter: 'blur(40px)',
          }}
          animate={{ x: [0, 18, -10, 0], y: [0, 6, -4, 0] }}
          transition={{ duration: 28, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      {/* irregular edge rectangles — break up the perfectly-centered
          silhouette with three randomly-placed rectangular patches. */}
      <div
        className="absolute left-1/2 top-1/2"
        style={{
          transform: 'translate(calc(-50% - 22vw), calc(-50% - 10vh))',
          width: '28vw', height: '18vh', maxWidth: '380px', maxHeight: '240px',
        }}
      >
        <motion.div
          className="w-full h-full"
          style={{
            background: 'rgba(190, 55, 55, 0.22)',
            borderRadius: '22px',
            filter: 'blur(56px)',
          }}
          animate={{ x: [0, 8, -5, 0], y: [0, -5, 3, 0] }}
          transition={{ duration: 26, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>
      <div
        className="absolute left-1/2 top-1/2"
        style={{
          transform: 'translate(calc(-50% + 22vw), calc(-50% - 5vh))',
          width: '26vw', height: '17vh', maxWidth: '340px', maxHeight: '220px',
        }}
      >
        <motion.div
          className="w-full h-full"
          style={{
            background: 'rgba(175, 50, 60, 0.20)',
            borderRadius: '18px',
            filter: 'blur(54px)',
          }}
          animate={{ x: [0, -7, 5, 0], y: [0, 4, -3, 0] }}
          transition={{ duration: 30, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>
      <div
        className="absolute left-1/2 top-1/2"
        style={{
          transform: 'translate(calc(-50% + 3vw), calc(-50% + 16vh))',
          width: '32vw', height: '16vh', maxWidth: '420px', maxHeight: '210px',
        }}
      >
        <motion.div
          className="w-full h-full"
          style={{
            background: 'rgba(165, 45, 65, 0.19)',
            borderRadius: '20px',
            filter: 'blur(54px)',
          }}
          animate={{ x: [0, -10, 6, 0], y: [0, 5, -3, 0] }}
          transition={{ duration: 32, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>
      {/* fine grain for texture */}
      <div
        className="absolute inset-0 opacity-[0.05] mix-blend-overlay"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`,
          backgroundSize: '128px 128px',
        }}
      />
    </div>
  );
}

// ─── Stuard line ───────────────────────────────────────────────────────────

function StuardLine({ text, onTypingDone }: { text: string; onTypingDone?: () => void }) {
  return <LightDevelopLine phrases={[text]} single onRevealed={onTypingDone} />;
}

function StuardLineSequence({
  phrases,
  onComplete,
  timing,
}: {
  phrases: string[];
  onComplete: () => void;
  timing?: DevelopTiming;
}) {
  return <LightDevelopLine phrases={phrases} onComplete={onComplete} timing={timing} />;
}

// ─── Wake-word listening indicator ────────────────────────────────────────

function ListenIndicator({ active }: { active: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className={clsx(
        'relative flex h-11 w-11 items-center justify-center rounded-lg border shadow-[0_2px_14px_rgba(40,12,20,0.45)]',
        active
          ? 'border-rose-300/40 bg-rose-950/55'
          : 'border-white/[0.12] bg-stone-950/55',
      )}>
        {active && (
          <>
            <motion.span
              className="absolute inset-0 rounded-lg border border-rose-200/45"
              animate={{ scale: [1, 1.45], opacity: [0.55, 0] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
            />
            <motion.span
              className="absolute inset-0 rounded-lg border border-rose-200/45"
              animate={{ scale: [1, 1.45], opacity: [0.55, 0] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut', delay: 0.8 }}
            />
          </>
        )}
        <span
          className={clsx(
            'h-2 w-2 rounded-sm',
            active ? 'bg-rose-200' : 'bg-white/35',
          )}
          style={active ? { boxShadow: '0 0 14px rgba(255,160,160,0.85)' } : undefined}
        />
      </div>
      <span className={clsx(
        'text-[11px] tracking-[0.08em] uppercase font-medium',
        active ? 'text-rose-100/80' : 'text-white/50',
      )}>
        {active ? 'Listening' : 'Mic off'}
      </span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────

export function ConversationalOnboarding({ onComplete, onSkip }: Props) {
  const [scene, setScene] = useState<Scene>('signin');
  const [authChecked, setAuthChecked] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [supabaseName, setSupabaseName] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [editing, setEditing] = useState(false);
  const [wakewordHeard, setWakewordHeard] = useState(false);
  const [listening, setListening] = useState(false);
  const [recordedKeys, setRecordedKeys] = useState<string[]>([]);
  const [recording, setRecording] = useState(false);
  const [savingHotkey, setSavingHotkey] = useState(false);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  const [fadingOut, setFadingOut] = useState(false);
  const [lineDone, setLineDone] = useState(false);

  const firstName = useMemo(() => pickFirstName(name, 'friend'), [name]);

  const storyPhrases = useMemo(() => [
    `Good to meet you, ${firstName}.`,
    'I plug into your files, your apps, and every tool your computer exposes.',
    'Tell me what you want. I read what\'s on your screen and actually run the job.',
    'Clean up downloads. Summarize an inbox. Change your wallpaper. Whatever the job needs.',
    'Do something twice? I save the recipe as a workflow you can run again.',
    'Or grab a mini-app from the marketplace and install it in one click.',
    'Your stuff stays local. Cloud only when you ask.',
  ], [firstName]);

  // ── Auth bootstrap
  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data } = await supabase.auth.getUser();
      if (!active) return;
      const user = data?.user;
      if (user) {
        setSignedIn(true);
        const raw =
          user.user_metadata?.full_name ||
          user.user_metadata?.name ||
          user.email?.split('@')[0] ||
          '';
        setSupabaseName(String(raw));
        setName(String(raw));
        setScene(prev => (prev === 'signin' ? 'intro' : prev));
      }
      setAuthChecked(true);
    };
    void load();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_ev, session) => {
      if (session?.user) {
        setSignedIn(true);
        setSigningIn(false);
        const raw =
          session.user.user_metadata?.full_name ||
          session.user.user_metadata?.name ||
          session.user.email?.split('@')[0] ||
          '';
        setSupabaseName(String(raw));
        setName(prev => prev || String(raw));
        setScene(prev => (prev === 'signin' ? 'intro' : prev));
      } else {
        setSignedIn(false);
      }
    });
    return () => { active = false; try { subscription.unsubscribe(); } catch {} };
  }, []);

  // ── Reset typing-done when scene changes
  useEffect(() => { setLineDone(false); }, [scene]);

  // ── Wake-word service lifecycle (only while in wakeword scenes)
  useEffect(() => {
    const inWakewordScene = scene === 'wakeword-try1' || scene === 'wakeword-try2';
    if (!inWakewordScene) {
      setListening(false);
      try { void (window as any).desktopAPI?.execTool?.('wakeword_stop', {}); } catch {}
      return;
    }

    let cancelled = false;
    setWakewordHeard(false);
    (async () => {
      try {
        await (window as any).desktopAPI?.execTool?.('wakeword_start', { sensitivity: 0.78, cooldown: 1.0, triggerCount: 6 });
        if (!cancelled) setListening(true);
      } catch {
        if (!cancelled) setListening(false);
      }
    })();

    const off = (window as any).desktopAPI?.onWakewordDetected?.(() => {
      setWakewordHeard(true);
    });

    return () => {
      cancelled = true;
      try { off?.(); } catch {}
      try { void (window as any).desktopAPI?.execTool?.('wakeword_stop', {}); } catch {}
    };
  }, [scene]);

  // Advance after wake-word detection — pause long enough for the user to
  // read Stuard's acknowledgement and see the green confirmation.
  useEffect(() => {
    if (!wakewordHeard) return;
    const t = setTimeout(() => {
      if (scene === 'wakeword-try1') setScene('wakeword-try2');
      else if (scene === 'wakeword-try2') setScene('wakeword-success');
    }, 1400);
    return () => clearTimeout(t);
  }, [wakewordHeard, scene]);

  // Wake-word success auto-advance
  useEffect(() => {
    if (scene !== 'wakeword-success') return;
    const t = setTimeout(() => setScene('hotkey-intro'), 3000);
    return () => clearTimeout(t);
  }, [scene]);

  // ── Hotkey recording
  useEffect(() => {
    if (!recording) return;
    const handler = (event: KeyboardEvent) => {
      event.preventDefault(); event.stopPropagation();
      if (event.key === 'Escape' && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
        setRecording(false);
        return;
      }
      const next: string[] = [];
      if (event.ctrlKey) next.push('Control');
      if (event.altKey) next.push('Alt');
      if (event.shiftKey) next.push('Shift');
      if (event.metaKey) next.push('Command');
      const raw = event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : event.key;
      if (raw && !SHORTCUT_MODIFIERS.includes(raw)) next.push(raw);
      const unique = Array.from(new Set(next));
      setRecordedKeys(unique);
      setHotkeyError(null);
      if (hasValidShortcut(unique)) setRecording(false);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [recording]);

  // ── Handlers
  const handleSignIn = async () => {
    setSigningIn(true);
    const result = await startBrowserSignIn();
    if (!result.ok) setSigningIn(false);
  };

  const handleGreetContinue = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try { localStorage.setItem('stuard_user_name', trimmed); } catch {}
    void saveNameToMemory(trimmed);
    setScene('story');
  };

  const handleSaveHotkey = async () => {
    if (recording) return;
    const keys = recordedKeys.length > 0 ? recordedKeys : DEFAULT_HOTKEY;
    if (!hasValidShortcut(keys)) { setHotkeyError('Use a modifier + another key.'); return; }
    setSavingHotkey(true);
    setHotkeyError(null);
    try {
      const accel = toAccelerator(keys);
      const result = await (window as any).desktopAPI.setGlobalHotkey(accel);
      if (!result?.ok) { setHotkeyError(result?.error || 'Failed to register.'); return; }
      try { localStorage.setItem('stuard_global_hotkey', accel); } catch {}
      setScene('done');
    } catch {
      setHotkeyError('Something went wrong.');
    } finally {
      setSavingHotkey(false);
    }
  };

  const dismiss = useCallback(() => {
    setFadingOut(true);
    setTimeout(() => onComplete(), 500);
  }, [onComplete]);

  // ── Render helpers
  const renderScene = () => {
    switch (scene) {
      case 'signin':
        return (
          <SceneShell stepKey="signin">
            <StuardLine
              text="Sign in first, so I remember you."
              onTypingDone={() => setLineDone(true)}
            />
            <div className="mt-12">
              <button
                onClick={() => void handleSignIn()}
                disabled={signingIn}
                className="rounded-lg border border-rose-200/30 bg-rose-950/55 px-7 py-2.5 text-[13px] tracking-wide text-rose-50/95 shadow-[0_2px_18px_rgba(60,15,25,0.35)] transition-all duration-300 hover:border-rose-200/50 hover:bg-rose-900/60 hover:text-rose-50 disabled:opacity-50"
              >
                {signingIn ? 'Opening browser…' : 'Sign in with browser'}
              </button>
            </div>
          </SceneShell>
        );

      case 'intro':
        return (
          <SceneShell stepKey="intro">
            <StuardLineSequence
              phrases={[
                'Hey there.',
                "I'm Stuard.",
                'The AI workspace for your PC.',
                'Most chat assistants live in a browser tab.',
                'I live right here on your machine.',
                'Your files, your apps, your whole toolbox.',
                'I turn repeated work into workflows, mini-apps, and agents you can reuse.',
                "But first, I don't think we've met.",
              ]}
              onComplete={() => setScene('greet')}
            />
          </SceneShell>
        );

      case 'greet':
        return (
          <SceneShell stepKey="greet">
            <StuardLine
              text="What should I call you?"
              onTypingDone={() => setLineDone(true)}
            />
            <div className={clsx('mt-10 w-full max-w-[380px] transition-opacity duration-500', lineDone ? 'opacity-100' : 'opacity-0 pointer-events-none')}>
              <div className="flex items-stretch gap-2">
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && name.trim()) handleGreetContinue(); }}
                  placeholder="Your name"
                  autoFocus
                  className="flex-1 rounded-lg border border-rose-200/15 bg-stone-950/55 px-4 py-2.5 text-[14px] text-white/95 outline-none placeholder:text-white/30 focus:border-rose-300/45 focus:bg-stone-900/65 font-light text-center transition-colors shadow-inner"
                />
                <button
                  onClick={handleGreetContinue}
                  disabled={!name.trim()}
                  className="rounded-lg border border-rose-200/30 bg-rose-950/55 px-3.5 text-rose-50/90 transition-all duration-300 hover:border-rose-200/50 hover:bg-rose-900/60 hover:text-rose-50 disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="Continue"
                >
                  <ArrowRight size={16} />
                </button>
              </div>
              {supabaseName.trim() && !editing && supabaseName.trim() === name.trim() && (
                <p className="mt-3 text-center text-[11px] text-white/45">
                  Not {pickFirstName(supabaseName, firstName)}?{' '}
                  <button onClick={() => { setEditing(true); setName(''); }} className="text-rose-200/80 underline-offset-2 hover:underline hover:text-rose-100">
                    Edit
                  </button>
                </p>
              )}
            </div>
          </SceneShell>
        );

      case 'story':
        return (
          <SceneShell stepKey="story">
            <StuardLineSequence
              phrases={storyPhrases}
              timing={{ holdMs: 1900, tailMs: 1400 }}
              onComplete={() => setScene('acknowledge')}
            />
          </SceneShell>
        );

      case 'acknowledge':
        return (
          <SceneShell stepKey="acknowledge">
            <StuardLineSequence
              phrases={[
                `Alright, ${firstName}.`,
                'Let me show you how to reach me.',
              ]}
              onComplete={() => setScene('wakeword-try1')}
            />
          </SceneShell>
        );

      case 'wakeword-try1':
        return (
          <SceneShell stepKey="wakeword-try1">
            <StuardLine
              text={wakewordHeard ? 'There you are.' : 'Try saying: Hey Stuard.'}
            />
            <div className="mt-9">
              {wakewordHeard ? (
                <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex h-11 w-11 items-center justify-center rounded-lg border border-emerald-300/35 bg-emerald-950/55 shadow-[0_2px_14px_rgba(20,80,55,0.35)]">
                  <Check className="w-5 h-5 text-emerald-200" strokeWidth={2} />
                </motion.div>
              ) : (
                <ListenIndicator active={listening} />
              )}
            </div>
            {!wakewordHeard && (
              <button
                onClick={() => setScene('hotkey-intro')}
                className="mt-7 text-[12px] tracking-wide text-white/40 transition-colors duration-300 hover:text-white/70"
              >
                Skip voice setup
              </button>
            )}
          </SceneShell>
        );

      case 'wakeword-try2':
        return (
          <SceneShell stepKey="wakeword-try2">
            <StuardLine
              text={wakewordHeard ? 'Got it.' : 'One more time, just to lock it in.'}
            />
            <div className="mt-9">
              {wakewordHeard ? (
                <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex h-11 w-11 items-center justify-center rounded-lg border border-emerald-300/35 bg-emerald-950/55 shadow-[0_2px_14px_rgba(20,80,55,0.35)]">
                  <Check className="w-5 h-5 text-emerald-200" strokeWidth={2} />
                </motion.div>
              ) : (
                <ListenIndicator active={listening} />
              )}
            </div>
            {!wakewordHeard && (
              <button
                onClick={() => setScene('hotkey-intro')}
                className="mt-7 text-[12px] tracking-wide text-white/40 transition-colors duration-300 hover:text-white/70"
              >
                Skip voice setup
              </button>
            )}
          </SceneShell>
        );

      case 'wakeword-success':
        return (
          <SceneShell stepKey="wakeword-success">
            <StuardLine text="Nice. We're connected. Voice works." />
          </SceneShell>
        );

      case 'hotkey-intro':
        return (
          <SceneShell stepKey="hotkey-intro">
            <StuardLineSequence
              phrases={[
                "Talking isn't always an option.",
                'Pick a hotkey too, for when you are heads-down.',
              ]}
              onComplete={() => setScene('hotkey-set')}
            />
          </SceneShell>
        );

      case 'hotkey-set': {
        const display = displayHotkey(recordedKeys.length > 0 ? recordedKeys : DEFAULT_HOTKEY);
        return (
          <SceneShell stepKey="hotkey-set">
            <StuardLine
              text="Press this from anywhere and I am right there."
              onTypingDone={() => setLineDone(true)}
            />
            <div className={clsx('mt-12 flex flex-col items-center gap-8 transition-opacity duration-500', lineDone ? 'opacity-100' : 'opacity-0 pointer-events-none')}>
              <div className="flex items-center gap-2.5">
                {display.map((k, i) => (
                  <React.Fragment key={`${k}-${i}`}>
                    {i > 0 && <span className="text-[14px] text-white/30 font-light">+</span>}
                    <motion.span
                      layout
                      transition={{ duration: 0.3 }}
                      className={clsx(
                        'min-w-[64px] rounded-md border px-4 py-2 text-center text-[14px] font-light tracking-wide shadow-[0_2px_10px_rgba(20,8,12,0.45)]',
                        recording
                          ? 'border-rose-300/50 bg-rose-900/55 text-rose-50'
                          : 'border-rose-200/15 bg-stone-950/55 text-white/90',
                      )}
                    >{k}</motion.span>
                  </React.Fragment>
                ))}
              </div>
              {hotkeyError && <p className="text-[12px] text-rose-200/90">{hotkeyError}</p>}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => { setRecording(true); setRecordedKeys([]); setHotkeyError(null); }}
                  disabled={savingHotkey}
                  className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.14] bg-stone-950/45 px-3.5 py-2 text-[12px] tracking-wide text-white/80 transition-colors duration-300 hover:bg-stone-900/60 hover:border-white/[0.25] hover:text-white"
                >
                  <Keyboard size={12} strokeWidth={1.6} />
                  {recording ? 'Listening…' : 'Record custom'}
                </button>
                {recordedKeys.length > 0 && (
                  <button
                    onClick={() => { setRecordedKeys([]); setHotkeyError(null); }}
                    className="rounded-md border border-transparent px-2.5 py-2 text-[12px] tracking-wide text-white/55 hover:text-white/85 hover:bg-stone-950/40 transition-colors"
                  >
                    Reset
                  </button>
                )}
              </div>
              <button
                onClick={() => void handleSaveHotkey()}
                disabled={recording || savingHotkey}
                className="inline-flex items-center gap-2 rounded-lg border border-rose-200/30 bg-rose-950/55 px-7 py-2.5 text-[13px] tracking-wide text-rose-50/95 shadow-[0_2px_18px_rgba(60,15,25,0.35)] transition-all duration-300 hover:border-rose-200/50 hover:bg-rose-900/60 hover:text-rose-50 disabled:opacity-30"
              >
                {savingHotkey ? 'Saving…' : `That'll do`}
                <ArrowRight size={14} className="text-rose-200/70" />
              </button>
            </div>
          </SceneShell>
        );
      }

      case 'done':
        return (
          <SceneShell stepKey="done">
            <motion.div
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
              className="mb-8 flex h-14 w-14 items-center justify-center rounded-xl border border-emerald-300/35 bg-emerald-950/55 shadow-[0_3px_22px_rgba(20,80,55,0.40)]"
            >
              <Check className="w-7 h-7 text-emerald-200" strokeWidth={1.6} />
            </motion.div>
            <StuardLine
              text={`Your PC is more powerful than your average chatbot thinks, ${firstName}. I'll be right here.`}
              onTypingDone={() => setLineDone(true)}
            />
            <Continue show={lineDone} label="Open Stuard" onClick={dismiss} />
          </SceneShell>
        );
    }
  };

  return (
    <motion.div
      className="relative h-full w-full overflow-hidden"
      initial={{ opacity: 1 }}
      animate={{ opacity: fadingOut ? 0 : 1 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
    >
      {/* Top-right: skip */}
      {onSkip && (
        <div className="absolute top-7 right-8 z-30">
          <button
            onClick={onSkip}
            className="rounded-md border border-white/[0.10] bg-stone-950/45 px-3 py-1.5 text-[11px] tracking-[0.08em] uppercase font-medium text-white/55 transition-colors duration-300 hover:bg-stone-900/55 hover:border-white/[0.20] hover:text-white/80"
          >
            Skip
          </button>
        </div>
      )}

      {/* Warm red atmospheric glow — full-screen but fades to transparent at
          the edges so the OS still shows through and it feels like a glow,
          not an overlay. */}
      <RedGlow />

      {/* Center stage */}
      <div className="absolute inset-0 flex flex-col items-center justify-center px-8">
        <AnimatePresence mode="wait">
          {authChecked && renderScene()}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// ─── Scene shell with fade ─────────────────────────────────────────────────

function SceneShell({ children, stepKey }: { children: React.ReactNode; stepKey: string }) {
  return (
    <motion.div
      key={stepKey}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.55, ease: 'easeOut' } }}
      exit={{ opacity: 0, y: -6, transition: { duration: 0.35, ease: 'easeIn' } }}
      className="flex flex-col items-center"
    >
      {children}
    </motion.div>
  );
}

// ─── Continue button (used when scene needs explicit advance) ─────────────

function Continue({ show, label = 'Continue', onClick }: { show: boolean; label?: string; onClick: () => void }) {
  return (
    <motion.button
      onClick={onClick}
      initial={false}
      animate={{ opacity: show ? 1 : 0, y: show ? 0 : 6 }}
      transition={{ duration: 0.45, ease: 'easeOut' }}
      style={{ pointerEvents: show ? 'auto' : 'none' }}
      className="mt-12 inline-flex items-center gap-2 rounded-lg border border-rose-200/30 bg-rose-950/55 px-7 py-2.5 text-[13px] tracking-wide text-rose-50/95 shadow-[0_2px_18px_rgba(60,15,25,0.35)] transition-all duration-300 hover:border-rose-200/50 hover:bg-rose-900/60 hover:text-rose-50"
    >
      {label}
      <ArrowRight size={13} className="text-rose-200/70" />
    </motion.button>
  );
}

