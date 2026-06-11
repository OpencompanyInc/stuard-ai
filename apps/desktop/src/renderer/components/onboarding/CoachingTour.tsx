import React, { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { AudioLines, Plus, ArrowRight, X, Paperclip, Play } from 'lucide-react';
import { FIGMA_ROW_BASE, FIGMA_ROW_PRIMARY, FIGMA_KBD } from '../chat/shared/input/styles';
import { HighlightMatch } from '../chat/shared/input/HighlightMatch';
import { filterCompactStuardNav } from '../../utils/compactStuardNav';
import { SlashCommandMenu } from '../chat/shared/input/slash/SlashCommandMenu';
import { SlashCommandComposer } from '../chat/shared/input/slash/SlashCommandComposer';
import { BUILTIN_COMMANDS } from '../chat/shared/input/slash/commands';
import { parseWhen } from '../chat/shared/input/slash/parseWhen';
import type {
  SlashCommandSpec,
  SlashMenuItem,
  SlashPhase,
  SlashSession,
} from '../chat/shared/input/slash/types';
import googleLogo from '../../assets/icons/google.png';
import bingLogo from '../../assets/icons/bing.png';
import duckduckgoLogo from '../../assets/icons/duckduckgo.png';
import youtubeLogo from '../../assets/icons/youtube.png';
import githubLogo from '../../assets/icons/github.svg';
import wikipediaLogo from '../../assets/icons/wikipedia.png';
import merriamWebsterLogo from '../../assets/icons/merriam-webster.png';

// Post-welcome coaching: the real compact pill performs each core gesture
// (summon · find · move · context · expand · dismiss) on a transparent backdrop,
// so it looks exactly like the real app on the user's desktop. A single coach
// card — always anchored below the pill so it never covers the input — carries
// the copy and the Back / Next controls.
//
// Interactive steps are hands-on: Next stays locked until the user performs the
// gesture (a "skip this step" link is always there), and a successful try
// auto-advances after a short beat. The search dropdown, Ctrl+arrow movement,
// and @-file attach all mirror the real compact mode 1:1 — same nav catalog
// (filterCompactStuardNav), same quick-action rows, same movement physics.

type PillMode = 'compact' | 'sidebar' | 'window';
type Target = 'pill' | 'attach' | 'corner';

interface Step {
  id: 'summon' | 'find' | 'move' | 'context' | 'slash' | 'expand' | 'dismiss';
  eyebrow: string;
  title: string;
  body: string;
  keys: string[];
  target: Target;
  /** "Your turn" instruction shown on interactive steps until the user tries it. */
  hint?: string;
}

const STEPS: Step[] = [
  {
    id: 'summon', eyebrow: 'Meet Stuard', title: 'I live in this little pill.',
    // keys here are a fallback only — the summon step renders the user's own
    // saved global hotkey (see hotkeyKeys), not this hardcoded default.
    body: 'I float above your other windows, so I’m always one tap away. Press the shortcut below — or say “Hey Stuard” — and I appear right where you’re working.',
    keys: ['Ctrl', 'Shift', 'Space'], target: 'pill',
  },
  {
    id: 'find', eyebrow: 'Search', title: 'Type to find anything.',
    body: 'I’m also a launcher. Type in the pill above — try “settings” — and I instantly match Stuard pages, apps, files, and workflows. Use the arrow keys to pick a result.',
    keys: [], target: 'pill',
    hint: 'Your turn — click the pill and type “settings”.',
  },
  {
    id: 'move', eyebrow: 'Move', title: 'Move me out of your way.',
    body: 'Hold Ctrl and press the arrow keys — I glide across the screen. Add Shift to move faster. That way I never cover what you’re working on.',
    keys: ['Ctrl', '↑', '↓', '←', '→'], target: 'pill',
    hint: 'Your turn — hold Ctrl and tap an arrow key.',
  },
  {
    id: 'context', eyebrow: 'Attach files', title: 'Hand me a file.',
    body: 'Type @ in the pill to pick a file, or click the + button. I read whatever you attach before I answer.',
    keys: ['@', '+'], target: 'attach',
    hint: 'Your turn — type @ in the pill, then pick a file.',
  },
  {
    id: 'slash', eyebrow: 'Commands', title: 'Type / to run a command.',
    body: 'Slash commands do things on the spot — set a reminder, add a task, or run a workflow — without sending a chat message. This is a practice run, so nothing is saved.',
    keys: ['/'], target: 'pill',
    hint: 'Your turn — type /, pick “Remind me”, fill it in and press Enter.',
  },
  {
    id: 'expand', eyebrow: 'Resize', title: 'I grow as big as you need.',
    body: 'See the red arc on my corner? Drag it to stretch me from a pill into a sidebar or a full window. Like this:',
    keys: [], target: 'corner',
  },
  {
    id: 'dismiss', eyebrow: 'Hide', title: 'Tuck me away when you’re done.',
    body: 'Press Esc and I disappear. Your shortcut — or “Hey Stuard” — brings me right back.',
    keys: ['Esc'], target: 'pill',
    hint: 'Your turn — press Esc.',
  },
];

const INTERACTIVE_STEPS = new Set<Step['id']>(['find', 'move', 'context', 'slash', 'dismiss']);

const PLACEHOLDER = 'Ask Stuard…';
const HOME = { left: '50%', top: '30%' };

// Same engine lineup as the real compact dropdown (see InputAreaImpl).
const ENGINES = [
  { id: 'google', name: 'Google', logo: googleLogo },
  { id: 'bing', name: 'Bing', logo: bingLogo },
  { id: 'duckduckgo', name: 'DuckDuckGo', logo: duckduckgoLogo },
  { id: 'youtube', name: 'YouTube', logo: youtubeLogo },
  { id: 'github', name: 'GitHub', logo: githubLogo },
  { id: 'merriam', name: 'Merriam-Webster', logo: merriamWebsterLogo },
  { id: 'wikipedia', name: 'Wikipedia', logo: wikipediaLogo },
];

// Stand-in files for the @-attach practice (the real pill searches your disk).
const DEMO_FILES = [
  { name: 'report.pdf', tile: '#EF4444', label: 'PDF', path: 'Documents\\report.pdf' },
  { name: 'budget.xlsx', tile: '#10B981', label: 'XLS', path: 'Documents\\budget.xlsx' },
  { name: 'team-photo.png', tile: '#3B82F6', label: 'PNG', path: 'Pictures\\team-photo.png' },
];

// Stand-in workflows for the "/run" stage of the slash practice (the real
// menu lists the workflows installed on this machine).
const DEMO_WORKFLOWS = [
  { id: 'morning-briefing', name: 'Morning briefing', description: 'Weather, calendar and tasks at a glance' },
  { id: 'tidy-downloads', name: 'Tidy downloads', description: 'Sort new downloads into folders' },
];

// The real built-in command lineup (same titles, fields and success copy as
// commands.ts) with the runs stubbed out — practicing during the tour never
// writes to the task store.
const DEMO_SLASH_COMMANDS: SlashCommandSpec[] = BUILTIN_COMMANDS.map((cmd) => ({
  ...cmd,
  run: async (values) => {
    await new Promise((r) => setTimeout(r, 650)); // let the "working" beat read
    if (cmd.id === 'remind') {
      const what = String(values.what || '').trim();
      const whenText = String(values.when || '').trim();
      if (!what) return { ok: false, message: 'What should I remind you about?' };
      const when = parseWhen(whenText);
      if (!when.date) return { ok: false, message: `Couldn't understand "${whenText}" — try "tomorrow 9am"` };
      return { ok: true, message: `Reminder set · ${when.label}` };
    }
    const title = String(values.title || '').trim();
    if (!title) return { ok: false, message: 'Task needs a title' };
    const whenText = String(values.when || '').trim();
    const when = whenText ? parseWhen(whenText) : null;
    if (whenText && !when?.date) return { ok: false, message: `Couldn't understand "${whenText}" — try "friday 5pm"` };
    return { ok: true, message: when?.label ? `Task added · ${when.label}` : 'Task added' };
  },
}));

export function CoachingTour({ onComplete, onSkip, lastLabel = 'Open Stuard' }: { onComplete: () => void; onSkip?: () => void; lastLabel?: string }) {
  const [idx, setIdx] = useState(0);
  const step = STEPS[idx];

  const [pos, setPos] = useState(HOME);
  const [moveOffset, setMoveOffset] = useState({ x: 0, y: 0 });
  const [mode, setMode] = useState<PillMode>('compact');
  const [gone, setGone] = useState(false);
  const [typed, setTyped] = useState('');
  const [chipName, setChipName] = useState<string | null>(null);
  const [keyhint, setKeyhint] = useState(false);
  const [cornerActive, setCornerActive] = useState(false);
  const [userTried, setUserTried] = useState(false);
  const [stepDone, setStepDone] = useState(false);
  const [selIdx, setSelIdx] = useState(0);
  const [engineId, setEngineId] = useState('google');
  // ── slash-step state: a local stand-in for useSlashCommands driving the
  // real SlashCommandMenu + SlashCommandComposer with practice (no-IPC) runs.
  const [slashSession, setSlashSession] = useState<SlashSession | null>(null);
  const [slashValues, setSlashValues] = useState<Record<string, string>>({});
  const [slashPhase, setSlashPhase] = useState<SlashPhase>('editing');
  const [slashStatus, setSlashStatus] = useState('');
  const slashRunSeqRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  // The user's real global hotkey, shown on the summon step instead of a
  // hardcoded Ctrl+Shift+Space. Falls back to the default until it loads.
  const [hotkeyKeys, setHotkeyKeys] = useState<string[]>(['Ctrl', 'Shift', 'Space']);

  const pillRef = useRef<HTMLDivElement>(null);
  const attachRef = useRef<HTMLButtonElement>(null);
  const cornerRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const keyhintRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  // Last measured height of the below-pill dropdown, so we keep reserving its
  // space while it's briefly hidden (keeps the coach card and its Next button
  // from jumping up and down mid-step).
  const dropdownHeightRef = useRef(0);
  // The position rAF loop below only re-subscribes on step.target changes, so its
  // closure can hold a stale `step`. Read the current step id from a live ref.
  const stepIdRef = useRef(step.id);
  stepIdRef.current = step.id;

  // ── auto-advance plumbing: a successful try moves to the next step after a
  // short beat; cleared whenever the user navigates or the step changes.
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextRef = useRef<() => void>(() => {});
  const clearAdvance = () => {
    if (advanceTimerRef.current) { clearTimeout(advanceTimerRef.current); advanceTimerRef.current = null; }
  };
  const scheduleAdvance = (ms: number) => {
    clearAdvance();
    advanceTimerRef.current = setTimeout(() => { advanceTimerRef.current = null; nextRef.current(); }, ms);
  };

  const next = () => { clearAdvance(); if (idx < STEPS.length - 1) setIdx(i => i + 1); else onComplete(); };
  const back = () => { clearAdvance(); if (idx > 0) setIdx(i => i - 1); };
  nextRef.current = next;

  // Load the user's configured global hotkey (main-process settings are the
  // source of truth; fall back to the locally-cached value, then the default).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let accel = '';
      try {
        const r = await (window as any).desktopAPI?.getGlobalHotkey?.();
        if (r?.ok && r.hotkey) accel = String(r.hotkey);
      } catch {}
      if (!accel) { try { accel = localStorage.getItem('stuard_global_hotkey') || ''; } catch {} }
      if (!accel) accel = 'Control+Shift+Space';
      const keys = accel
        .split('+')
        .map(k => k.trim())
        .filter(Boolean)
        .map(k =>
          k === 'Control' || k === 'Ctrl' || k === 'CommandOrControl' ? 'Ctrl'
          : k === 'Command' || k === 'Cmd' || k === 'Meta' || k === 'Super' ? '⌘'
          : k === 'Option' ? 'Alt'
          : k,
        );
      if (!cancelled && keys.length) setHotkeyKeys(keys);
    })();
    return () => { cancelled = true; };
  }, []);

  // Reset all try-state and focus the pill input when the step changes.
  useEffect(() => {
    setUserTried(false);
    setStepDone(false);
    setTyped('');
    setChipName(null);
    setSelIdx(0);
    setMoveOffset({ x: 0, y: 0 });
    slashRunSeqRef.current += 1;
    setSlashSession(null);
    setSlashValues({});
    setSlashPhase('editing');
    setSlashStatus('');
    dropdownHeightRef.current = 0;
    clearAdvance();
    const t = setTimeout(() => {
      if (INTERACTIVE_STEPS.has(step.id)) inputRef.current?.focus();
    }, 350);
    return () => { clearTimeout(t); clearAdvance(); };
  }, [idx, step.id]);

  // ── per-step performance loop (visual-only steps; interactive steps wait for the user) ──
  useEffect(() => {
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const after = (fn: () => void, ms: number) => { const t = setTimeout(() => { if (!cancelled) fn(); }, ms); timers.push(t); return t; };

    setPos(HOME); setMode('compact'); setGone(false); setKeyhint(false); setCornerActive(false);

    if (step.id === 'summon') {
      setGone(true);
      after(() => setGone(false), 220);
    } else if (step.id === 'move') {
      setKeyhint(true);
    } else if (step.id === 'expand') {
      // demonstrate the drag-to-expand corner: grip pops, pill stretches, holds
      // at full size so the resize reads, then releases and rests before looping.
      const cycle = () => {
        if (cancelled) return;
        setMode('compact'); setCornerActive(false);
        after(() => { setCornerActive(true); setMode('sidebar'); }, 700);
        after(() => setMode('window'), 1700);
        after(() => setCornerActive(false), 3300);   // hold fully expanded, then let go
        after(() => setMode('compact'), 3500);
        after(cycle, 5200);                          // rest as a compact pill before repeating
      };
      cycle();
    }

    return () => { cancelled = true; timers.forEach(clearTimeout); };
  }, [idx, step.id]);

  // Interactive: Ctrl+arrows glide the pill on the move step. Same physics as
  // the real pill (AppController stepLoop): held keys drive a rAF loop at
  // 900 px/s, 1500 px/s with Shift, diagonal normalized.
  const movedRef = useRef(0);
  useEffect(() => {
    if (step.id !== 'move') return;
    movedRef.current = 0;
    const pressed = new Set<string>();
    let rafId: number | null = null;
    let lastTs = 0;

    const stepLoop = (ts: number) => {
      if (!lastTs) lastTs = ts;
      const dt = (ts - lastTs) / 1000;
      lastTs = ts;

      const ctrl = pressed.has('Control') || pressed.has('Meta');
      const shift = pressed.has('Shift');
      let vx = 0, vy = 0;
      if (pressed.has('ArrowLeft')) vx -= 1;
      if (pressed.has('ArrowRight')) vx += 1;
      if (pressed.has('ArrowUp')) vy -= 1;
      if (pressed.has('ArrowDown')) vy += 1;

      if (ctrl && (vx !== 0 || vy !== 0)) {
        const speed = shift ? 1500 : 900; // px/s — matches the real pill
        const len = Math.hypot(vx, vy) || 1;
        const dx = (vx / len) * speed * dt;
        const dy = (vy / len) * speed * dt;
        movedRef.current += Math.hypot(dx, dy);
        if (movedRef.current > 20) setUserTried(true);
        setMoveOffset(prev => {
          const w = window.innerWidth, h = window.innerHeight;
          const baseX = w * 0.5, baseY = h * 0.30;
          return {
            x: Math.max(-(baseX - 220), Math.min(w - baseX - 220, prev.x + dx)),
            y: Math.max(-(baseY - 60), Math.min(h - baseY - 230, prev.y + dy)),
          };
        });
        rafId = requestAnimationFrame(stepLoop);
      } else {
        rafId = null;
        lastTs = 0;
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      pressed.add(e.key);
      if (e.ctrlKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        if (rafId == null) rafId = requestAnimationFrame(stepLoop);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      pressed.delete(e.key);
      if (movedRef.current > 150) { setStepDone(true); scheduleAdvance(1500); }
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, [step.id]);

  // Interactive: Esc dismisses the pill on the dismiss step, then auto-advances
  // once it pops back so the user sees the full hide-and-return loop.
  useEffect(() => {
    if (step.id !== 'dismiss') return;
    let restoreTimer: ReturnType<typeof setTimeout> | undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setUserTried(true);
      setStepDone(true);
      setGone(true);
      if (restoreTimer) clearTimeout(restoreTimer);
      restoreTimer = setTimeout(() => setGone(false), 900);
      scheduleAdvance(2200);
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (restoreTimer) clearTimeout(restoreTimer);
    };
  }, [step.id]);

  // Find step: once the user's query actually matches something, count the step
  // as done and move on after a beat. Re-typing postpones the advance.
  useEffect(() => {
    if (step.id !== 'find') return;
    const q = typed.trim();
    if (q.length >= 2 && filterCompactStuardNav(q, 4).length > 0) {
      setStepDone(true);
      scheduleAdvance(3000);
    } else {
      setStepDone(false);
      clearAdvance();
    }
  }, [typed, step.id]);

  // Context step: attaching a file (via @ or +) completes the step.
  useEffect(() => {
    if (step.id !== 'context' || !chipName) return;
    setStepDone(true);
    scheduleAdvance(2000);
  }, [chipName, step.id]);

  // ── glue ring (to the step target) + card (always below the pill) ──
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const pill = pillRef.current, ring = ringRef.current, card = cardRef.current;
      if (pill && ring) {
        const targetEl =
          step.target === 'attach' ? attachRef.current ?? pill :
          step.target === 'corner' ? cornerRef.current ?? pill : pill;
        const r = targetEl.getBoundingClientRect();
        const pad = step.target === 'pill' ? 6 : 4;
        ring.style.left = `${r.left - pad}px`;
        ring.style.top = `${r.top - pad}px`;
        ring.style.width = `${r.width + pad * 2}px`;
        ring.style.height = `${r.height + pad * 2}px`;
        ring.style.borderRadius = `${step.target === 'pill' ? 26 : step.target === 'corner' ? 26 : 12}px`;

        // card always hangs below the pill, centered — never over the input.
        // When a dropdown is open (find search results, context file picker) it
        // extends below the pill, so anchor the card beneath it and keep
        // reserving that space for the rest of the step — otherwise the card
        // (and its Next button) would bounce around while the user types.
        if (card) {
          const pr = pill.getBoundingClientRect();
          const dd = dropdownRef.current;
          if (dd) dropdownHeightRef.current = dd.getBoundingClientRect().height;
          const inDropdownStep = stepIdRef.current === 'find' || stepIdRef.current === 'context' || stepIdRef.current === 'slash';
          const dropdownReserve = inDropdownStep && dropdownHeightRef.current
            ? 8 + dropdownHeightRef.current : 0;
          const anchorBottom = pr.bottom + dropdownReserve;
          const cw = card.offsetWidth, gap = 26;
          let left = pr.left + pr.width / 2 - cw / 2;
          let top = anchorBottom + gap;
          left = Math.max(16, Math.min(left, window.innerWidth - cw - 16));
          top = Math.max(16, Math.min(top, window.innerHeight - card.offsetHeight - 16));
          card.style.left = `${left}px`;
          card.style.top = `${top}px`;
        }
        const kh = keyhintRef.current;
        if (kh) { kh.style.left = `${r.left + r.width / 2 - 80}px`; kh.style.top = `${r.top - 46}px`; }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [step.target]);

  const isCompact = mode === 'compact';
  const isInteractive = INTERACTIVE_STEPS.has(step.id);

  // Find-step search results — the real compact-mode catalog, display-only.
  const navItems = step.id === 'find' ? filterCompactStuardNav(typed, 4) : [];
  const showNavDropdown = step.id === 'find' && typed.trim().length >= 2;
  const activeEngine = ENGINES.find(e => e.id === engineId) || ENGINES[0];

  // Context-step @-file picker.
  const atIndex = step.id === 'context' ? typed.indexOf('@') : -1;
  const atQuery = atIndex >= 0 ? typed.slice(atIndex + 1).trim().toLowerCase() : '';
  const showFileDropdown = step.id === 'context' && atIndex >= 0 && !chipName;
  const fileMatches = showFileDropdown
    ? DEMO_FILES.filter(f => !atQuery || f.name.toLowerCase().includes(atQuery))
    : [];

  // Slash-step "/" menu — same filtering rules as useSlashCommands: built-ins
  // match by id/title, "/run <filter>" lists only workflows.
  const slashToken = step.id === 'slash' && !slashSession && typed.startsWith('/')
    ? typed.slice(1).toLowerCase()
    : null;
  const slashItems: SlashMenuItem[] = (() => {
    if (slashToken === null) return [];
    const wfRows = (filter: string, cap: number): SlashMenuItem[] => {
      const f = filter.trim().toLowerCase();
      return DEMO_WORKFLOWS
        .filter((w) => !f || w.name.toLowerCase().includes(f))
        .slice(0, cap)
        .map((w) => ({
          key: `wf-${w.id}`,
          title: w.name,
          subtitle: w.description,
          icon: Play,
          kind: 'workflow' as const,
          onSelect: () => runDemoWorkflow(w),
        }));
    };
    const runStage = slashToken.match(/^run\s+(.*)$/);
    if (runStage) return wfRows(runStage[1], 8);
    const items: SlashMenuItem[] = [];
    for (const cmd of DEMO_SLASH_COMMANDS) {
      if (slashToken && !cmd.id.startsWith(slashToken) && !cmd.title.toLowerCase().includes(slashToken)) continue;
      items.push({
        key: `cmd-${cmd.id}`,
        title: cmd.title,
        subtitle: cmd.subtitle,
        icon: cmd.icon,
        kind: 'command',
        onSelect: () => beginSlashSession(cmd),
      });
    }
    if (!slashToken || 'run'.startsWith(slashToken) || 'workflow'.includes(slashToken)) {
      items.push({
        key: 'cmd-run',
        title: 'Run workflow',
        subtitle: 'Pick a workflow, fill its inputs',
        icon: Play,
        kind: 'command',
        onSelect: () => setTyped('/run '),
      });
    }
    if (slashToken.length >= 2) items.push(...wfRows(slashToken, 5));
    return items;
  })();
  const showSlashMenu = step.id === 'slash' && slashItems.length > 0 && !slashSession;
  const slashComposerActive = step.id === 'slash' && !!slashSession;

  const handleInputChange = (value: string) => {
    if (value.trim()) setUserTried(true);
    setTyped(value);
    setSelIdx(0);
  };

  const attachDemoFile = (name: string) => {
    setUserTried(true);
    setChipName(name);
    setTyped('');
  };

  // Selecting any dropdown row counts as a completed try.
  const completeFromDropdown = () => {
    setUserTried(true);
    setStepDone(true);
    scheduleAdvance(1200);
  };

  // ── slash-step plumbing: mirrors useSlashCommands' begin/submit/cancel
  // lifecycle, but the runs are the practice stubs above.
  const beginSlashSession = (cmd: SlashCommandSpec) => {
    const defaults: Record<string, string> = {};
    for (const f of cmd.fields) {
      if (f.defaultValue !== undefined) defaults[f.key] = f.defaultValue;
    }
    setSlashSession({ commandId: cmd.id, title: cmd.title, icon: cmd.icon, fields: cmd.fields, run: cmd.run });
    setSlashValues(defaults);
    setSlashPhase('editing');
    setSlashStatus('');
    setTyped('');
  };

  const finishSlash = (result: { ok: boolean; message: string }) => {
    if (result.ok) {
      setSlashPhase('done');
      setSlashStatus(result.message);
      setStepDone(true);
      scheduleAdvance(2600);
    } else {
      setSlashPhase('error');
      setSlashStatus(result.message);
    }
  };

  const runDemoWorkflow = (wf: { id: string; name: string }) => {
    setUserTried(true);
    setSlashSession({ commandId: `run:${wf.id}`, title: wf.name, icon: Play, fields: [], run: async () => ({ ok: true, message: '' }) });
    setSlashValues({});
    setSlashStatus('');
    setSlashPhase('working');
    setTyped('');
    const seq = ++slashRunSeqRef.current;
    setTimeout(() => {
      if (slashRunSeqRef.current !== seq) return;
      finishSlash({ ok: true, message: `Running ${wf.name}` });
    }, 900);
  };

  const submitSlash = () => {
    if (!slashSession || slashPhase === 'working' || slashPhase === 'done') return;
    const missing = slashSession.fields.find((f) => f.required && !String(slashValues[f.key] || '').trim());
    if (missing) {
      setSlashPhase('error');
      setSlashStatus(`Fill in "${missing.hint.replace(/…$/, '')}"`);
      return;
    }
    setSlashPhase('working');
    setSlashStatus('');
    const seq = ++slashRunSeqRef.current;
    void slashSession.run(slashValues).then((result) => {
      if (slashRunSeqRef.current !== seq) return;
      finishSlash(result);
    });
  };

  const cancelSlash = () => {
    slashRunSeqRef.current += 1;
    setSlashSession(null);
    setSlashValues({});
    setSlashPhase('editing');
    setSlashStatus('');
  };

  const setSlashValue = (key: string, value: string) => {
    setUserTried(true);
    setSlashValues((prev) => ({ ...prev, [key]: value }));
    // Editing after an error clears the stale message, like the real hook.
    setSlashPhase((p) => (p === 'error' ? 'editing' : p));
  };

  // Mirror the real dropdown's arrow-key selection: Ask Stuard (0), Search (1),
  // then the matched Stuard rows. Enter "runs" the selection in the demo.
  const handleFindKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (step.id !== 'find' || !showNavDropdown) return;
    const total = 2 + navItems.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setUserTried(true);
      setSelIdx(prev => (prev + (e.key === 'ArrowDown' ? 1 : -1) + total) % total);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      completeFromDropdown();
    }
  };

  // Slash-step keyboard: same keys the real menu owns (↑↓ navigate, Enter/Tab
  // select, Esc dismiss).
  const handleSlashKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSlashMenu) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setUserTried(true);
      setSelIdx(prev => (prev + (e.key === 'ArrowDown' ? 1 : -1) + slashItems.length) % slashItems.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      slashItems[Math.min(selIdx, slashItems.length - 1)]?.onSelect();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setTyped('');
    }
  };

  // The summon step reflects the user's real hotkey; every other step keeps its
  // own literal keycaps.
  const displayKeys = step.id === 'summon' ? hotkeyKeys : step.keys;

  return (
    <div data-theme="dark" className="fixed inset-0 z-[9998] pointer-events-none font-stuard">
      <style>{`
        @keyframes coach-float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
        @keyframes coach-blink { 0%,49%{opacity:1} 50%,100%{opacity:0} }
        @keyframes coach-shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        @keyframes coach-bob { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-4px)} }
        .coach-float { animation: coach-float 5s ease-in-out infinite; }
        .coach-bob { animation: coach-bob 1.1s ease-in-out infinite; }
        .coach-skel-bar { background: linear-gradient(90deg, rgb(var(--compact-pill-fg) / 0.14), rgb(var(--compact-pill-fg) / 0.05));
          background-size: 200% 100%; animation: coach-shimmer 2.2s linear infinite; border-radius: 6px; height: 10px; }
      `}</style>

      {/* highlight ring */}
      <div
        ref={ringRef}
        className="absolute pointer-events-none transition-all duration-500 ease-out"
        style={{ border: '1.5px solid rgba(255,140,115,0.6)', boxShadow: '0 0 0 4px rgba(255,130,110,0.08), 0 0 30px rgba(255,100,90,0.30)', borderRadius: 26 }}
      />

      {/* the real compact pill, performing */}
      <div
        className="absolute -translate-x-1/2 -translate-y-1/2"
        style={{ left: pos.left, top: pos.top }}
      >
        {/* move-step offset lives on its own wrapper so the per-frame glide
            never fights the centering transform or any CSS transitions */}
        <div style={{ transform: `translate(${moveOffset.x}px, ${moveOffset.y}px)` }}>
        <div className={clsx('coach-float', isInteractive && 'pointer-events-auto')}>
          <div
            ref={pillRef}
            data-interactive={isInteractive ? 'true' : undefined}
            className={clsx('relative flex flex-col justify-center transition-all duration-500', isInteractive && 'pointer-events-auto')}
            style={{
              width: isCompact ? 380 : mode === 'sidebar' ? 320 : 540,
              // The composer carries its own pill chrome (bg, shadow, radius),
              // so while it's active the wrapper goes transparent and lets it
              // grow if the token fields wrap to a second row.
              height: slashComposerActive ? 'auto' : isCompact ? 56 : mode === 'sidebar' ? 360 : 320,
              minHeight: 56,
              borderRadius: 26,
              padding: slashComposerActive ? 0 : 10,
              background: slashComposerActive ? 'transparent' : 'rgb(var(--compact-pill-bg))',
              boxShadow: slashComposerActive ? 'none' : 'var(--compact-pill-shadow)',
              color: 'rgb(var(--compact-pill-fg))',
              opacity: gone ? 0 : 1,
              transform: gone ? 'scale(0.6)' : 'scale(1)',
              transitionTimingFunction: 'cubic-bezier(.2,.7,.2,1)',
              overflow: 'visible',
            }}
          >
            {/* expanded conversation skeleton */}
            {!isCompact && (
              <div className="flex flex-1 flex-col gap-3 px-1.5 pt-1 pb-3 overflow-hidden" style={{ opacity: 0.9 }}>
                <div className="coach-skel-bar self-end" style={{ width: '42%' }} />
                <div className="coach-skel-bar" style={{ width: '72%' }} />
                <div className="coach-skel-bar" style={{ width: '58%' }} />
                <div className="coach-skel-bar self-end" style={{ width: '30%' }} />
                <div className="coach-skel-bar" style={{ width: mode === 'window' ? '80%' : '64%' }} />
              </div>
            )}

            {/* slash-step composer — the real SlashCommandComposer takes over
                the pill footprint exactly like in compact mode */}
            {slashComposerActive && slashSession ? (
              <SlashCommandComposer
                variant="compact"
                session={slashSession}
                values={slashValues}
                phase={slashPhase}
                statusMsg={slashStatus}
                onChange={setSlashValue}
                onSubmit={submitSlash}
                onCancel={cancelSlash}
              />
            ) : (
            <>
            {/* the input row — always present, like the real compact pill */}
            <div className="flex items-center w-full" style={{ gap: 8, height: 36 }}>
              <button
                ref={attachRef}
                type="button"
                tabIndex={step.id === 'context' ? 0 : -1}
                className="w-6 h-6 flex items-center justify-center flex-shrink-0"
                style={{ color: 'rgb(var(--compact-pill-fg) / 0.9)' }}
                title="Attach"
                onClick={() => {
                  if (step.id !== 'context') return;
                  attachDemoFile('report.pdf');
                }}
              >
                <Plus className="w-6 h-6" strokeWidth={1.5} />
              </button>

              <div className="flex-1 relative flex items-center min-h-[36px]" style={{ padding: 6 }}>
                {isInteractive && (step.id === 'find' || step.id === 'context' || step.id === 'slash') ? (
                  <input
                    ref={inputRef}
                    type="text"
                    value={typed}
                    onChange={(e) => handleInputChange(e.target.value)}
                    onKeyDown={step.id === 'slash' ? handleSlashKeyDown : handleFindKeyDown}
                    placeholder={step.id === 'context' ? 'Type @ to attach a file…' : step.id === 'slash' ? 'Type / for commands…' : PLACEHOLDER}
                    className="w-full bg-transparent border-none outline-none text-[12px] leading-4 font-normal text-center placeholder:text-[rgb(var(--compact-pill-fg)/0.45)]"
                    style={{ color: 'rgb(var(--compact-pill-fg) / 0.92)' }}
                    spellCheck={false}
                    autoComplete="off"
                  />
                ) : (
                  <span
                    className="w-full text-center text-[12px] leading-4 font-normal whitespace-nowrap"
                    style={{ color: `rgb(var(--compact-pill-fg) / ${typed ? 0.92 : 0.45})` }}
                  >
                    {typed || PLACEHOLDER}
                  </span>
                )}
              </div>

              <button type="button" tabIndex={-1} className="compact-voice-btn relative z-10 w-9 h-9 rounded-[14px] flex items-center justify-center flex-shrink-0" title="Voice">
                <AudioLines className="w-[18px] h-[18px] relative z-[1]" strokeWidth={2.25} />
              </button>
            </div>
            </>
            )}

            {/* red drag-to-expand corner grip — the real CompactDragCorner arc */}
            <div
              ref={cornerRef}
              aria-hidden
              className="absolute pointer-events-none"
              style={{
                right: -8, bottom: -8, width: 52, height: 52, zIndex: 6,
                transform: cornerActive ? 'scale(1.14)' : 'scale(1)', transformOrigin: 'bottom right',
                transition: 'transform 160ms ease-out, filter 160ms ease-out',
                filter: cornerActive ? 'brightness(1.18)' : 'none',
              }}
            >
              <svg width={52} height={52} viewBox="0 0 52 52" style={{ display: 'block', overflow: 'visible' }}>
                <path d="M 47 26 A 21 21 0 0 1 26 47" stroke="#FF383C" strokeWidth="3" strokeLinecap="butt" fill="none" />
              </svg>
            </div>
          </div>

          {/* find-step: a 1:1 clone of the real compact-mode search dropdown
              (Quick Actions · engine picker · Stuard navigation · Workflows),
              fed by the real filterCompactStuardNav catalog */}
          {showNavDropdown && (
            <div
              ref={dropdownRef}
              data-interactive="true"
              className="absolute left-1/2 -translate-x-1/2 pointer-events-auto"
              style={{ top: '100%', marginTop: 8, width: 380, zIndex: 7 }}
            >
              <div
                className="overflow-hidden flex flex-col"
                style={{ background: 'rgb(var(--compact-pill-bg))', borderRadius: 12, boxShadow: 'var(--compact-pill-shadow)', color: 'rgb(var(--compact-pill-fg))' }}
              >
                <div className="flex flex-col" style={{ padding: 16, gap: 12 }}>
                  {/* QUICK ACTIONS */}
                  <div className="flex flex-col" style={{ gap: 8 }}>
                    <div style={{ fontSize: 10, lineHeight: '14px', color: 'rgb(var(--compact-pill-fg))', fontWeight: 400 }}>
                      Quick Actions
                    </div>
                    <button
                      type="button"
                      onMouseEnter={() => setSelIdx(0)}
                      onClick={completeFromDropdown}
                      className="w-full flex items-center"
                      style={{ ...(selIdx === 0 ? FIGMA_ROW_PRIMARY : FIGMA_ROW_BASE), gap: 10 }}
                    >
                      <div className="flex-1 min-w-0 flex flex-col items-start text-left" style={{ gap: 6 }}>
                        <div className="truncate w-full" style={{ fontSize: 12, lineHeight: '16px', color: 'rgb(var(--compact-pill-fg))' }}>
                          &ldquo;{typed.trim()}&rdquo;
                        </div>
                        <div className="truncate w-full" style={{ fontSize: 10, lineHeight: '14px', color: 'rgb(var(--compact-pill-fg-muted))' }}>
                          Ask Stuard
                        </div>
                      </div>
                      <span className="shrink-0" style={{ ...FIGMA_KBD, fontSize: 10, lineHeight: '14px' }}>Enter</span>
                    </button>
                    <button
                      type="button"
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--compact-pill-hover)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                      onClick={completeFromDropdown}
                      className="w-full flex items-center"
                      style={{ ...FIGMA_ROW_BASE, gap: 10 }}
                    >
                      <div className="flex-1 min-w-0 flex flex-col items-start text-left" style={{ gap: 6 }}>
                        <div className="truncate w-full" style={{ fontSize: 12, lineHeight: '16px', color: 'rgb(var(--compact-pill-fg))' }}>
                          &ldquo;{typed.trim()}&rdquo;
                        </div>
                        <div className="truncate w-full" style={{ fontSize: 10, lineHeight: '14px', color: 'rgb(var(--compact-pill-fg-muted))' }}>
                          Screenshot &amp; send
                        </div>
                      </div>
                      <span className="shrink-0 whitespace-nowrap" style={{ ...FIGMA_KBD, fontSize: 10, lineHeight: '14px' }}>Ctrl + Shift + Enter</span>
                    </button>
                    <button
                      type="button"
                      onMouseEnter={() => setSelIdx(1)}
                      onClick={completeFromDropdown}
                      className="w-full flex items-center"
                      style={{ ...(selIdx === 1 ? FIGMA_ROW_PRIMARY : FIGMA_ROW_BASE), gap: 10 }}
                    >
                      <div className="flex-1 min-w-0 flex flex-col items-start text-left" style={{ gap: 6 }}>
                        <div className="truncate w-full" style={{ fontSize: 12, lineHeight: '16px', color: 'rgb(var(--compact-pill-fg))' }}>
                          &ldquo;{typed.trim()}&rdquo;
                        </div>
                        <div className="truncate w-full" style={{ fontSize: 10, lineHeight: '14px', color: 'rgb(var(--compact-pill-fg-muted))' }}>
                          Search {activeEngine.name}
                        </div>
                      </div>
                      <span className="shrink-0" style={{ ...FIGMA_KBD, fontSize: 10, lineHeight: '14px' }}>Ctrl + Enter</span>
                    </button>

                    {/* engine picker — same chips as the real dropdown */}
                    <div className="flex items-center" style={{ gap: 6, paddingLeft: 8, paddingRight: 8 }}>
                      {ENGINES.map((engine) => {
                        const isActive = engine.id === engineId;
                        return (
                          <button
                            key={`engine-${engine.id}`}
                            type="button"
                            title={`Use ${engine.name}`}
                            onClick={(e) => { e.stopPropagation(); setEngineId(engine.id); setUserTried(true); }}
                            className="flex items-center justify-center transition-all hover:scale-105"
                            style={{
                              width: 28, height: 28, padding: 4, borderRadius: 8,
                              background: isActive ? 'rgb(var(--compact-pill-fg) / 0.10)' : 'transparent',
                              border: isActive ? '1px solid rgb(var(--compact-pill-fg) / 0.20)' : '1px solid transparent',
                              opacity: isActive ? 1 : 0.55,
                            }}
                          >
                            <img src={engine.logo} className="w-5 h-5 object-contain" alt={engine.name} />
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* STUARD — dashboard & studio navigation */}
                  {navItems.length > 0 && (
                    <div className="flex flex-col" style={{ gap: 8 }}>
                      <div style={{ fontSize: 10, lineHeight: '14px', color: 'rgb(var(--compact-pill-fg))', fontWeight: 400 }}>
                        Stuard
                      </div>
                      {navItems.map((c, i) => {
                        const Icon = c.icon;
                        const rowIdx = 2 + i;
                        const isSel = selIdx === rowIdx;
                        const prevGroup = i > 0 ? navItems[i - 1]?.group : undefined;
                        const showGroupLabel = c.group && c.group !== prevGroup;
                        return (
                          <React.Fragment key={c.id}>
                            {showGroupLabel && (
                              <div
                                style={{
                                  fontSize: 9, lineHeight: '12px', color: 'rgb(var(--compact-pill-fg-muted))',
                                  paddingLeft: 8, paddingTop: i === 0 ? 0 : 2,
                                  textTransform: 'uppercase', letterSpacing: '0.06em',
                                }}
                              >
                                {c.group === 'dashboard' ? 'Dashboard' : 'Studio'}
                              </div>
                            )}
                            <button
                              type="button"
                              onMouseEnter={() => setSelIdx(rowIdx)}
                              onClick={completeFromDropdown}
                              className="w-full flex items-center text-left"
                              style={{ ...(isSel ? FIGMA_ROW_PRIMARY : FIGMA_ROW_BASE), padding: '6px 8px 6px 6px', gap: 6 }}
                            >
                              <div
                                className="flex items-center justify-center shrink-0"
                                style={{ width: 30, height: 30, borderRadius: 9, background: 'rgb(var(--compact-pill-fg) / 0.06)', color: 'rgb(var(--compact-pill-fg-muted))' }}
                              >
                                <Icon className="w-[15px] h-[15px]" strokeWidth={1.75} />
                              </div>
                              <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 6 }}>
                                <div className="truncate" style={{ fontSize: 12, lineHeight: '16px', color: 'rgb(var(--compact-pill-fg))' }}>
                                  <HighlightMatch text={c.title} query={typed} />
                                </div>
                                <div className="truncate" style={{ fontSize: 10, lineHeight: '14px', color: 'rgb(var(--compact-pill-fg-muted))' }}>
                                  {c.subtitle}
                                </div>
                              </div>
                            </button>
                          </React.Fragment>
                        );
                      })}
                    </div>
                  )}

                  {/* WORKFLOWS — header always present, like the real dropdown */}
                  <div className="flex flex-col" style={{ gap: 8 }}>
                    <div style={{ fontSize: 10, lineHeight: '14px', color: 'rgb(var(--compact-pill-fg))', fontWeight: 400 }}>
                      No workflows
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* context-step: the @-file picker, hung below the pill like the real
              one (real compact mode searches your actual files here) */}
          {showFileDropdown && (
            <div
              ref={dropdownRef}
              data-interactive="true"
              className="absolute left-1/2 -translate-x-1/2 pointer-events-auto"
              style={{ top: '100%', marginTop: 8, width: 380, zIndex: 7 }}
            >
              <div
                className="overflow-hidden flex flex-col"
                style={{ background: 'rgb(var(--compact-pill-bg))', borderRadius: 12, boxShadow: 'var(--compact-pill-shadow)', color: 'rgb(var(--compact-pill-fg))' }}
              >
                <div className="flex flex-col" style={{ padding: 16, gap: 8 }}>
                  <div style={{ fontSize: 10, lineHeight: '14px', color: 'rgb(var(--compact-pill-fg))', fontWeight: 400 }}>
                    Files
                  </div>
                  {fileMatches.length === 0 && (
                    <div style={{ fontSize: 11, lineHeight: '15px', color: 'rgb(var(--compact-pill-fg-muted))', paddingLeft: 8 }}>
                      No matches — try clearing what you typed after @
                    </div>
                  )}
                  {fileMatches.map((f) => (
                    <button
                      key={f.name}
                      type="button"
                      onClick={() => attachDemoFile(f.name)}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--compact-pill-hover)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                      className="w-full flex items-center text-left"
                      style={{ ...FIGMA_ROW_BASE, padding: '6px 8px 6px 6px', gap: 6 }}
                    >
                      <div
                        className="flex items-center justify-center shrink-0"
                        style={{ width: 36, height: 36, borderRadius: 4, background: f.tile }}
                      >
                        <span style={{ fontSize: 10, lineHeight: '14px', color: '#fff', fontWeight: 600 }}>{f.label}</span>
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 6 }}>
                        <div className="truncate" style={{ fontSize: 12, lineHeight: '16px', color: 'rgb(var(--compact-pill-fg))' }}>
                          <HighlightMatch text={f.name} query={atQuery} />
                        </div>
                        <div className="truncate" style={{ fontSize: 8, lineHeight: '14px', color: 'rgb(var(--compact-pill-fg-muted))' }}>
                          {f.path}
                        </div>
                      </div>
                      <span
                        className="shrink-0 flex items-center justify-center"
                        style={{ padding: '3px 6px', color: 'rgb(var(--compact-pill-fg-muted))' }}
                        title="Attach"
                      >
                        <Paperclip className="w-4 h-4" strokeWidth={1.75} />
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* slash-step: the real "/" command menu (SlashCommandMenu), hung
              below the pill in the same frame the real compact overlay uses */}
          {showSlashMenu && (
            <div
              ref={dropdownRef}
              data-interactive="true"
              className="absolute left-1/2 -translate-x-1/2 pointer-events-auto"
              style={{ top: '100%', marginTop: 8, width: 380, zIndex: 7 }}
            >
              <SlashCommandMenu
                variant="compact"
                items={slashItems}
                selectedIndex={selIdx}
                onHoverIndex={setSelIdx}
              />
            </div>
          )}
        </div>
        </div>
      </div>

      {/* context-step file chip (above the pill) */}
      <div
        className="absolute z-[1] inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] pointer-events-none transition-all duration-300"
        style={{
          left: pos.left, top: `calc(${pos.top} - 70px)`,
          transform: `translateX(-50%) ${chipName ? 'translateY(0) scale(1)' : 'translateY(6px) scale(0.96)'}`,
          opacity: chipName ? 1 : 0,
          background: 'rgba(28,20,21,0.95)', borderColor: 'rgba(255,200,195,0.25)', color: 'rgba(255,235,232,0.92)',
          boxShadow: '0 8px 26px rgba(0,0,0,0.5)',
        }}
      >
        {chipName || 'report.pdf'}
      </div>

      {/* Ctrl+arrows hint (move step) */}
      <div ref={keyhintRef} className="absolute z-[1] flex gap-1.5 transition-opacity duration-300" style={{ opacity: keyhint ? 1 : 0 }}>
        {['Ctrl', '↑', '↓', '←', '→'].map((k, i) => (
          <kbd key={i} className="coach-bob inline-flex items-center justify-center min-w-[20px] px-1.5 py-0.5 text-[11px] font-medium rounded-[5px]"
            style={{ background: 'rgba(40,28,29,0.92)', border: '1px solid rgba(255,200,195,0.22)', color: 'rgba(255,235,232,0.92)', animationDelay: `${i * 80}ms` }}>
            {k}
          </kbd>
        ))}
      </div>

      {/* skip the whole tour */}
      <button
        onClick={() => (onSkip ? onSkip() : onComplete())}
        className="pointer-events-auto absolute top-7 right-8 inline-flex items-center gap-1.5 rounded-md border border-white/[0.10] bg-stone-950/55 px-3 py-1.5 text-[11px] tracking-[0.08em] uppercase font-medium text-white/55 backdrop-blur-md transition-colors hover:bg-stone-900/65 hover:border-white/[0.20] hover:text-white/80"
      >
        <X size={11} strokeWidth={2} />
        Skip tour
      </button>

      {/* coach card — below the pill, carries copy AND navigation */}
      <div
        ref={cardRef}
        className="absolute z-[5] w-[330px] rounded-2xl border border-rose-200/20 bg-stone-950/90 backdrop-blur-md px-5 pt-4 pb-4 shadow-[0_16px_55px_rgba(20,8,12,0.7)] pointer-events-auto"
      >
        {/* upward pointer toward the pill */}
        <span className="absolute left-1/2 -top-[7px] -translate-x-1/2 w-3 h-3 rotate-45 bg-stone-950/90 border-l border-t border-rose-200/20" aria-hidden />

        <p className="text-[10px] tracking-[0.12em] uppercase font-semibold text-rose-200/70 mb-1.5">
          {step.eyebrow} · {idx + 1}/{STEPS.length}
        </p>
        <h3 className="text-[16px] font-medium text-white mb-1.5 tracking-[-0.01em]">{step.title}</h3>
        <p className="text-[13px] leading-relaxed font-light text-white/80">{step.body}</p>
        {isInteractive && (
          <p className={clsx(
            'mt-2 text-[11px] font-medium tracking-wide',
            userTried ? 'text-emerald-300/80' : 'text-rose-200/75',
          )}>
            {stepDone
              ? 'Perfect — that’s it. Moving on…'
              : userTried
                ? 'Nice — keep going.'
                : (
                  <>
                    {step.hint}{' '}
                    <button
                      onClick={next}
                      className="text-white/40 underline underline-offset-2 transition-colors hover:text-white/75"
                    >
                      skip this step
                    </button>
                  </>
                )}
          </p>
        )}
        {displayKeys.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {displayKeys.map((k, i) => (
              <kbd key={i} className="inline-flex items-center justify-center min-w-[22px] px-1.5 py-[3px] text-[11.5px] font-medium rounded-md bg-stone-900/80 border border-rose-200/20 text-rose-50/90 shadow-[0_1px_3px_rgba(0,0,0,0.4)]">
                {k}
              </kbd>
            ))}
          </div>
        )}

        {/* divider + navigation */}
        <div className="mt-4 pt-3 border-t border-white/[0.07] flex items-center justify-between">
          <button
            onClick={back}
            className="rounded-lg px-2.5 py-1.5 text-[12.5px] text-white/45 transition-colors hover:text-white/80"
            style={{ visibility: idx === 0 ? 'hidden' : 'visible' }}
          >
            Back
          </button>
          <div className="flex gap-1.5">
            {STEPS.map((_, i) => (
              <span key={i} className="rounded-full transition-all duration-300"
                style={{ width: i === idx ? 16 : 6, height: 6, borderRadius: i === idx ? 4 : 999, background: i === idx ? 'rgba(255,130,110,0.95)' : 'rgba(255,255,255,0.20)' }} />
            ))}
          </div>
          <button
            onClick={next}
            disabled={isInteractive && !userTried}
            title={isInteractive && !userTried ? 'Try it first — or use "skip this step"' : undefined}
            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200/40 bg-rose-700/60 px-4 py-1.5 text-[12.5px] font-medium text-white shadow-[0_2px_16px_rgba(60,15,25,0.4)] transition-all hover:bg-rose-600/65 hover:border-rose-200/55 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-rose-700/60 disabled:hover:border-rose-200/40 disabled:active:scale-100"
          >
            {idx === STEPS.length - 1 ? lastLabel : 'Next'}
            <ArrowRight size={13} className="text-rose-100/85" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default CoachingTour;
