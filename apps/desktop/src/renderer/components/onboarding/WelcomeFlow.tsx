import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { clsx } from 'clsx';
import { supabase } from '../../lib/supabaseClient';
import { startBrowserSignIn } from '../../auth/browserSignIn';
import { usePreferences, type TonePreset } from '../../hooks/usePreferences';
import { isOnboardingPath, type OnboardingPath } from '../../onboardingProfile';
import {
  ArrowRight,
  Brain,
  Check,
  ChevronLeft,
  Command,
  Eye,
  FileText,
  Keyboard,
  LayoutGrid,
  Lock,
  MessageSquare,
  Settings,
  Shield,
  Sparkles,
  Workflow,
  Zap,
  type LucideIcon,
} from 'lucide-react';

interface WelcomeFlowProps {
  onComplete: () => void;
  onSkip?: () => void;
}

type StartMode = 'guided' | 'all';

interface FlowStep {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  note: string;
}

interface PathOption {
  id: OnboardingPath;
  name: string;
  description: string;
  icon: LucideIcon;
  tags: string[];
  bestFor: string;
}

interface StarterAction {
  title: string;
  description: string;
  icon: LucideIcon;
}

interface ToneOption {
  id: TonePreset;
  label: string;
  description: string;
  icon: LucideIcon;
}

interface SummaryCard {
  title: string;
  description: string;
}

const PRIMARY_BUTTON =
  'inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-black transition-all hover:bg-gray-100 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50';
const SECONDARY_BUTTON =
  'inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-3 text-sm font-medium text-white/80 transition-all hover:bg-white/[0.08] hover:text-white active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50';
const GHOST_BUTTON =
  'inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-medium text-white/55 transition-colors hover:text-white';
const CARD_CLASS = 'rounded-[28px] border border-white/10 bg-[#10131a]/88 shadow-[0_30px_120px_rgba(0,0,0,0.42)] backdrop-blur-2xl';
const DEFAULT_SHORTCUT_KEYS = ['Control', 'Shift', 'Space'];
const SHORTCUT_MODIFIERS = ['Control', 'Alt', 'Shift', 'Command'];
const SHORTCUT_KEYS = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
  'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'Space', 'Enter',
  'Tab', 'Escape', 'Backspace', 'Delete', 'Home', 'End', 'PageUp', 'PageDown',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F1', 'F2', 'F3', 'F4',
  'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
];

const FLOW_STEPS: FlowStep[] = [
  {
    id: 'welcome',
    title: 'Meet Stuard',
    description: 'Lead with the product value, then move into setup.',
    icon: Sparkles,
    note: 'A strong first-run flow should explain what Stuard helps with before it asks for choices.',
  },
  {
    id: 'path',
    title: 'Choose your start',
    description: 'Pick the first mental model that should shape your experience.',
    icon: Workflow,
    note: 'This does not lock anything down. It only makes the first suggestions feel more relevant.',
  },
  {
    id: 'control',
    title: 'Trust and control',
    description: 'Make the boundaries clear before the product feels powerful.',
    icon: Shield,
    note: 'Capability feels much better when approvals, logs, and editable memory are obvious on day one.',
  },
  {
    id: 'tone',
    title: 'Tune the voice',
    description: 'Set how Stuard should respond and what context matters to you.',
    icon: MessageSquare,
    note: 'The assistant should already sound like it belongs in the user’s workflow on the first reply.',
  },
  {
    id: 'shortcut',
    title: 'Stay one shortcut away',
    description: 'Make it easy to come back without hunting for the window.',
    icon: Keyboard,
    note: 'A great onboarding flow ends by making return behavior effortless.',
  },
];

const FIRST_SESSION_ITEMS = [
  {
    icon: MessageSquare,
    title: 'Ask naturally',
    description: 'Start with a real question instead of learning a command language.',
  },
  {
    icon: Command,
    title: 'Act on your device',
    description: 'Move from advice into useful action when the task calls for it.',
  },
  {
    icon: Workflow,
    title: 'Grow into automation',
    description: 'Turn repeatable wins into workflows after the first success.',
  },
];

const PATH_OPTIONS: PathOption[] = [
  {
    id: 'assistant',
    name: 'Assistant-first',
    description: 'Great for drafting, research, file help, and quick daily support.',
    icon: Brain,
    tags: ['chat', 'memory', 'device help'],
    bestFor: 'Best if you want Stuard to feel like a daily AI teammate right away.',
  },
  {
    id: 'automation',
    name: 'Automation-first',
    description: 'Ideal when you already know you want repeated work delegated.',
    icon: Workflow,
    tags: ['workflows', 'delegation', 'mini apps'],
    bestFor: 'Best if you want structured workflows and automations to be front and center.',
  },
  {
    id: 'workspace',
    name: 'Workspace-first',
    description: 'Start from notes, reminders, planning, and organized project context.',
    icon: LayoutGrid,
    tags: ['projects', 'notes', 'planning'],
    bestFor: 'Best if you want one place to collect ideas, tasks, and follow-through.',
  },
  {
    id: 'operator',
    name: 'Operator-first',
    description: 'Lean into proactive systems, deeper control, and power-user surfaces.',
    icon: Shield,
    tags: ['proactive', 'remote', 'control'],
    bestFor: 'Best if you want advanced delegation with stronger oversight and controls.',
  },
];

const PERSONALIZED_STARTER_ACTIONS: Record<OnboardingPath, StarterAction[]> = {
  assistant: [
    {
      title: 'Bring one real task into chat',
      description: 'Start with something useful now, like drafting, research, or organizing files.',
      icon: MessageSquare,
    },
    {
      title: 'Let useful context build up naturally',
      description: 'Memory helps follow-up work feel faster instead of starting from zero each time.',
      icon: Brain,
    },
    {
      title: 'Promote repeated wins later',
      description: 'Once a pattern works well in chat, it is a great candidate for automation.',
      icon: Workflow,
    },
  ],
  automation: [
    {
      title: 'Pick a repeated task first',
      description: 'The fastest onboarding win is improving something you already do often.',
      icon: Workflow,
    },
    {
      title: 'Describe the result before the flow',
      description: 'Let Stuard help draft the workflow before you fine-tune the details.',
      icon: Sparkles,
    },
    {
      title: 'Add UI only when it helps',
      description: 'Keep automations lean, then layer interfaces on top where monitoring matters.',
      icon: LayoutGrid,
    },
  ],
  workspace: [
    {
      title: 'Start with one active project',
      description: 'Collect the notes, reminders, and research for a single topic first.',
      icon: LayoutGrid,
    },
    {
      title: 'Capture quickly, organize later',
      description: 'Getting information in matters more than structuring it perfectly on day one.',
      icon: FileText,
    },
    {
      title: 'Turn loose tasks into systems',
      description: 'Recurring follow-ups can become reminders or workflows as patterns emerge.',
      icon: Workflow,
    },
  ],
  operator: [
    {
      title: 'Delegate one safe recurring job',
      description: 'Start with a single instruction you would otherwise remember manually.',
      icon: Shield,
    },
    {
      title: 'Keep visibility over bigger actions',
      description: 'Use approvals, logs, and checkpoints so autonomy still feels transparent.',
      icon: Eye,
    },
    {
      title: 'Expand from one reliable loop',
      description: 'Make one proactive system trustworthy before you connect more surfaces.',
      icon: Command,
    },
  ],
};

const EXPLORE_EVERYTHING_ACTIONS: StarterAction[] = [
  {
    title: 'See chat, action, and organization together',
    description: 'Start broad if you want to understand the whole product before specializing.',
    icon: MessageSquare,
  },
  {
    title: 'Try one workflow and one space',
    description: 'A quick side-by-side comparison helps reveal which part should become your default.',
    icon: Workflow,
  },
  {
    title: 'Let the product teach its shape',
    description: 'Use a wider set of suggestions, then settle into the areas that feel most natural.',
    icon: LayoutGrid,
  },
];

const CONTROL_POINTS = [
  {
    icon: Lock,
    title: 'Local-first by default',
    description: 'Your data stays on your device unless you explicitly opt into cloud features.',
  },
  {
    icon: Check,
    title: 'Clear approvals',
    description: 'High-impact actions should ask first instead of running silently in the background.',
  },
  {
    icon: Eye,
    title: 'Visible activity',
    description: 'Actions can be reviewed so the assistant feels inspectable instead of mysterious.',
  },
  {
    icon: FileText,
    title: 'Editable memory',
    description: 'You stay in charge of what Stuard remembers and can remove things whenever you want.',
  },
];

const TONE_OPTIONS: ToneOption[] = [
  { id: 'concise', label: 'Concise', description: 'Short, direct, and action-oriented.', icon: Zap },
  { id: 'friendly', label: 'Friendly', description: 'Warm, clear, and collaborative.', icon: MessageSquare },
  { id: 'formal', label: 'Formal', description: 'Polished and professional when clarity matters.', icon: FileText },
  { id: 'technical', label: 'Technical', description: 'Detailed, precise, and explicit.', icon: Command },
  { id: 'custom', label: 'Custom', description: 'Define your own style for replies.', icon: Settings },
];

function tonePreview(tone: TonePreset, customTone: string): string {
  switch (tone) {
    case 'concise':
      return 'I will keep replies short, useful, and focused on the next clear move.';
    case 'friendly':
      return 'I will feel like a thoughtful teammate: warm, helpful, and still practical.';
    case 'formal':
      return 'I will keep the tone polished, structured, and professional when presentation matters.';
    case 'technical':
      return 'I will be explicit, precise, and detailed when the work needs rigor.';
    case 'custom':
      return customTone.trim() || 'I will adapt to the voice you define here.';
    default:
      return 'I will adapt to how you like to work.';
  }
}

function getStoredPath(): OnboardingPath {
  try {
    const stored = localStorage.getItem('stuard_onboarding_path');
    return isOnboardingPath(stored) ? stored : 'assistant';
  } catch {
    return 'assistant';
  }
}

function getStoredStartMode(): StartMode {
  try {
    return localStorage.getItem('stuard_onboarding_mode') === 'all' ? 'all' : 'guided';
  } catch {
    return 'guided';
  }
}

function displayHotkey(keys: string[]): string[] {
  return keys.map((key) => {
    if (key === 'Control') return 'Ctrl';
    if (key === 'Command') return 'Cmd';
    return key;
  });
}

function toAccelerator(keys: string[]): string {
  return keys
    .map((key) => {
      if (key === 'Control') return 'Ctrl';
      if (key === 'Command') return 'Cmd';
      return key;
    })
    .join('+');
}

function hasValidShortcut(keys: string[]): boolean {
  const hasModifier = keys.some((key) => SHORTCUT_MODIFIERS.includes(key));
  const hasKey = keys.some((key) => !SHORTCUT_MODIFIERS.includes(key));
  return hasModifier && hasKey;
}

function StepSurface({
  eyebrow,
  title,
  description,
  children,
  footer,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className={clsx(CARD_CLASS, 'flex h-full flex-col p-4 sm:p-5 lg:p-6')}>
      <div className="mb-4 shrink-0 lg:mb-5">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-white/45">
          <Sparkles size={12} />
          <span>{eyebrow}</span>
        </div>
        <h2 className="mt-3 text-[24px] font-semibold leading-[1.05] tracking-tight text-white sm:text-[30px] lg:mt-4 lg:text-[34px]">
          {title}
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-white/55 sm:text-[15px] lg:mt-3">
          {description}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 pb-2 min-h-0">
        {children}
      </div>

      <div className="mt-2 shrink-0 border-t border-white/8 pt-4 lg:mt-4">{footer}</div>
    </div>
  );
}

function WelcomeIntroStep({
  signedIn,
  signingIn,
  userEmail,
  onSignIn,
  onNext,
}: {
  signedIn: boolean;
  signingIn: boolean;
  userEmail: string | null;
  onSignIn: () => Promise<void>;
  onNext: () => void;
}) {
  return (
    <StepSurface
      eyebrow="Welcome"
      title="A better first run for Stuard"
      description="This setup stays focused on one job: helping you understand what Stuard can do, choose the right starting shape, and get to your first useful interaction without any scrolling."
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="hidden text-xs text-white/40 sm:block">
            You can edit every choice later in settings.
          </p>
          <button onClick={onNext} className={PRIMARY_BUTTON}>
            Continue
            <ArrowRight size={15} />
          </button>
        </div>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-4">
          <div className="flex-1 rounded-3xl border border-white/10 bg-white/[0.03] p-4 lg:p-5">
            <p className="text-[11px] uppercase tracking-[0.18em] text-white/35">Desktop assistant</p>
            <p className="mt-3 text-lg font-medium leading-tight text-white sm:text-xl lg:text-2xl">
              Built to help with real work on your machine, not just one-off prompts in a browser tab.
            </p>
            <div className="mt-4 flex flex-col gap-3">
              {FIRST_SESSION_ITEMS.map((item) => (
                <div key={item.title} className="rounded-2xl border border-white/8 bg-black/20 p-4 flex items-start gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-white/80">
                    <item.icon size={18} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">{item.title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-white/45">{item.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {[
              'Clear product shape before settings',
              'No long form or scrolling setup',
              'One strong path into first use',
            ].map((promise, index) => (
              <div key={promise} className="rounded-2xl border border-white/8 bg-white/[0.025] px-4 py-3">
                <p className="text-[11px] text-white/35">0{index + 1}</p>
                <p className="mt-2 text-sm text-white/80 leading-snug">{promise}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.05] to-white/[0.015] p-4 lg:p-5">
            <p className="text-[11px] uppercase tracking-[0.18em] text-white/35">Your first 10 minutes</p>
            <div className="mt-4 space-y-3">
              {[
                'Choose the starting path that matches how you work.',
                'Set the tone so the assistant already feels right.',
                'Add a shortcut so Stuard stays one action away.',
              ].map((item, index) => (
                <div key={item} className="flex items-start gap-3 rounded-2xl border border-white/8 bg-black/20 px-4 py-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-500/20 text-xs font-semibold text-blue-100">
                    {index + 1}
                  </div>
                  <p className="pt-1 text-sm leading-relaxed text-white/82">{item}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-1 flex-col justify-between rounded-3xl border border-white/10 bg-black/25 p-4 lg:p-5">
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-white/35">Optional account sync</p>
              <p className="mt-3 text-lg font-medium text-white">
                Bring in your saved setup and cloud-connected features now, or do it later.
              </p>
            </div>

            <div className="mt-5">
              {signedIn ? (
                <div className="rounded-2xl border border-emerald-400/15 bg-emerald-500/10 p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-400/15 text-emerald-100">
                      <Check size={16} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white">Account synced</p>
                      <p className="truncate text-xs text-white/45">{userEmail}</p>
                    </div>
                  </div>
                </div>
              ) : (
                <button onClick={() => void onSignIn()} disabled={signingIn} className={PRIMARY_BUTTON + ' w-full'}>
                  {signingIn ? 'Opening sign-in...' : 'Sync account now'}
                </button>
              )}
              <p className="mt-3 text-xs leading-relaxed text-white/45">
                Sync is helpful, but not required. The goal here is a better first impression, not blocking setup.
              </p>
            </div>
          </div>
        </div>
      </div>
    </StepSurface>
  );
}

function PathSelectionStep({
  selectedPath,
  setSelectedPath,
  recommendedPath,
  profileChecked,
  startMode,
  setStartMode,
  onBack,
  onNext,
}: {
  selectedPath: OnboardingPath;
  setSelectedPath: (path: OnboardingPath) => void;
  recommendedPath: OnboardingPath | null;
  profileChecked: boolean;
  startMode: StartMode;
  setStartMode: (mode: StartMode) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const selectedOption = PATH_OPTIONS.find((option) => option.id === selectedPath) ?? PATH_OPTIONS[0];
  const starterActions =
    startMode === 'all' ? EXPLORE_EVERYTHING_ACTIONS : PERSONALIZED_STARTER_ACTIONS[selectedOption.id];

  return (
    <StepSurface
      eyebrow="Starting path"
      title="Choose the version of Stuard you want to feel first"
      description="You still keep access to everything later. This only shapes which capabilities and suggestions are brought forward during the first stretch."
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button onClick={onBack} className={SECONDARY_BUTTON}>
            <ChevronLeft size={15} />
            Back
          </button>
          <div className="flex items-center gap-3">
            <p className="hidden text-xs text-white/40 lg:block">
              Change it later if your workflow evolves.
            </p>
            <button onClick={onNext} className={PRIMARY_BUTTON}>
              Continue
              <ArrowRight size={15} />
            </button>
          </div>
        </div>
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="grid gap-3 sm:grid-cols-2">
          {PATH_OPTIONS.map((option) => {
            const active = selectedPath === option.id;
            return (
              <button
                key={option.id}
                onClick={() => setSelectedPath(option.id)}
                className={clsx(
                  'relative flex flex-col rounded-3xl border p-4 text-left transition-all duration-200',
                  active
                    ? 'border-blue-400/45 bg-blue-500/10 ring-1 ring-blue-400/35'
                    : 'border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]'
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className={clsx(
                    'flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl',
                    active ? 'bg-blue-500/15 text-blue-200' : 'bg-white/10 text-white/70'
                  )}>
                    <option.icon size={18} />
                  </div>
                  {recommendedPath === option.id && (
                    <span className="shrink-0 rounded-full border border-blue-400/20 bg-blue-500/10 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-blue-100">
                      Recommended
                    </span>
                  )}
                </div>

                <div className="mt-4">
                  <p className={clsx('text-base font-semibold', active ? 'text-white' : 'text-white/90')}>
                    {option.name}
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-white/50">{option.description}</p>
                </div>

                <div className="mt-auto pt-4">
                  <div className="flex flex-wrap gap-2">
                    {option.tags.map((tag) => (
                      <span
                        key={tag}
                        className={clsx(
                          'rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.14em]',
                          active
                            ? 'border-blue-300/20 bg-blue-500/10 text-blue-100/90'
                            : 'border-white/10 bg-white/[0.03] text-white/45'
                        )}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-white/35">How wide should setup feel?</p>
                <p className="mt-1 text-sm text-white/70">Choose focused guidance or a broader product tour.</p>
              </div>
              {!profileChecked && <p className="text-[11px] text-white/35 shrink-0">Checking saved setup...</p>}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl border border-white/8 bg-black/20 p-2">
              {[
                {
                  id: 'guided' as StartMode,
                  label: 'Guided start',
                  description: 'Prioritize the path you chose.',
                },
                {
                  id: 'all' as StartMode,
                  label: 'Explore everything',
                  description: 'Show a broader set of suggestions.',
                },
              ].map((mode) => {
                const active = startMode === mode.id;
                return (
                  <button
                    key={mode.id}
                    onClick={() => setStartMode(mode.id)}
                    className={clsx(
                      'rounded-2xl px-4 py-3 text-left transition-all flex flex-col',
                      active ? 'bg-white text-black' : 'bg-transparent text-white/65 hover:bg-white/5 hover:text-white'
                    )}
                  >
                    <p className="text-sm font-semibold">{mode.label}</p>
                    <p className={clsx('mt-1 text-xs leading-relaxed flex-1', active ? 'text-black/70' : 'text-white/45')}>
                      {mode.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-1 flex-col rounded-3xl border border-white/10 bg-black/25 p-4 lg:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-white/35">Preview</p>
                <p className="mt-2 text-xl font-semibold text-white">{selectedOption.name}</p>
                <p className="mt-2 text-sm leading-relaxed text-white/50">
                  {startMode === 'all'
                    ? 'You will see a wider cross-section of Stuard instead of a tighter guided track.'
                    : selectedOption.bestFor}
                </p>
              </div>
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-white/80">
                <selectedOption.icon size={18} />
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {starterActions.map((action) => (
                <div key={action.title} className="flex items-start gap-3 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-white/80">
                    <action.icon size={15} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">{action.title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-white/45">{action.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </StepSurface>
  );
}

function TrustStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  return (
    <StepSurface
      eyebrow="Trust and control"
      title="Capable by design, but still clearly under your control"
      description="The first-run experience should reduce uncertainty. These are the boundaries that keep Stuard feeling powerful without feeling risky."
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button onClick={onBack} className={SECONDARY_BUTTON}>
            <ChevronLeft size={15} />
            Back
          </button>
          <button onClick={onNext} className={PRIMARY_BUTTON}>
            Continue
            <ArrowRight size={15} />
          </button>
        </div>
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="grid gap-3 sm:grid-cols-2">
          {CONTROL_POINTS.map((point) => (
            <div key={point.title} className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 lg:p-5">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 text-white/85">
                <point.icon size={18} />
              </div>
              <p className="mt-4 text-base font-semibold text-white">{point.title}</p>
              <p className="mt-2 text-sm leading-relaxed text-white/50">{point.description}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.05] to-white/[0.015] p-4 lg:p-5">
            <p className="text-[11px] uppercase tracking-[0.18em] text-white/35">What this looks like in practice</p>
            <div className="mt-4 rounded-3xl border border-blue-300/12 bg-blue-500/8 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-white">Approval required</p>
                  <p className="mt-1 text-xs leading-relaxed text-white/45">
                    Stuard wants to move files and update a folder structure. Review first.
                  </p>
                </div>
                <div className="rounded-full border border-white/10 bg-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-white/60">
                  Review
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <button className={SECONDARY_BUTTON + ' flex-1'}>Not now</button>
                <button className={PRIMARY_BUTTON + ' flex-1'}>Approve</button>
              </div>
            </div>
          </div>

          <div className="grid flex-1 gap-3 sm:grid-cols-2">
            <div className="rounded-3xl border border-white/10 bg-black/25 p-4 lg:p-5">
              <p className="text-[11px] uppercase tracking-[0.18em] text-white/35">Editable memory</p>
              <div className="mt-4 rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                <p className="text-sm text-white/80">“Prefers concise summaries and works mainly inside the desktop app.”</p>
                <div className="mt-3 flex gap-2 text-[11px] text-white/45">
                  <span className="rounded-full border border-white/10 px-2 py-1">Edit</span>
                  <span className="rounded-full border border-white/10 px-2 py-1">Delete</span>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-black/25 p-4 lg:p-5">
              <p className="text-[11px] uppercase tracking-[0.18em] text-white/35">Visible activity</p>
              <div className="mt-4 space-y-2">
                {['Checked auth status', 'Prepared workflow draft', 'Requested approval before action'].map((item) => (
                  <div key={item} className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-white/78">
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </StepSurface>
  );
}

function ToneStep({
  onBack,
  onNext,
}: {
  onBack: () => void;
  onNext: () => void;
}) {
  const { tone, setTone, customTone, setCustomTone, persona, setPersona } = usePreferences();
  const canContinue = tone !== 'custom' || customTone.trim().length > 0;

  return (
    <StepSurface
      eyebrow="Voice and context"
      title="Make Stuard sound right before the first real reply"
      description="The assistant should fit your workflow from day one. Choose a tone and optionally add a short note about how you like to work."
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button onClick={onBack} className={SECONDARY_BUTTON}>
            <ChevronLeft size={15} />
            Back
          </button>
          <div className="flex items-center gap-3">
            <p className="hidden text-xs text-white/40 lg:block">You can refine this later as your usage gets more specific.</p>
            <button onClick={onNext} disabled={!canContinue} className={PRIMARY_BUTTON}>
              Continue
              <ArrowRight size={15} />
            </button>
          </div>
        </div>
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {TONE_OPTIONS.map((option) => {
              const active = tone === option.id;
              return (
                <button
                  key={option.id}
                  onClick={() => setTone(option.id)}
                  className={clsx(
                    'rounded-3xl border p-4 text-left transition-all',
                    active
                      ? 'border-blue-400/45 bg-blue-500/10 ring-1 ring-blue-400/30'
                      : 'border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]'
                  )}
                >
                  <div className={clsx(
                    'flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl',
                    active ? 'bg-blue-500/15 text-blue-100' : 'bg-white/10 text-white/70'
                  )}>
                    <option.icon size={17} />
                  </div>
                  <p className="mt-4 text-sm font-semibold text-white">{option.label}</p>
                  <p className="mt-1 text-xs leading-relaxed text-white/45">{option.description}</p>
                </button>
              );
            })}
          </div>

          <AnimatePresence initial={false}>
            {tone === 'custom' && (
              <motion.div
                key="custom-tone"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="rounded-3xl border border-white/10 bg-black/25 p-4">
                  <p className="text-sm font-medium text-white">Describe the voice you want</p>
                  <textarea
                    value={customTone}
                    onChange={(event) => setCustomTone(event.target.value)}
                    rows={3}
                    maxLength={200}
                    placeholder="Example: Talk like a sharp but friendly teammate who explains decisions clearly."
                    className="mt-3 w-full resize-none rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-white/28 focus:border-white/25"
                  />
                  <div className="mt-2 flex items-center justify-between text-[11px] text-white/35">
                    <span>{customTone.trim() ? 'Custom tone is ready.' : 'Add a short style description to continue.'}</span>
                    <span>{customTone.length}/200</span>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.05] to-white/[0.015] p-4 lg:p-5">
            <p className="text-[11px] uppercase tracking-[0.18em] text-white/35">Preview reply</p>
            <div className="mt-4 space-y-3">
              <div className="ml-auto max-w-[88%] rounded-3xl rounded-br-xl border border-white/10 bg-white/[0.07] px-4 py-3 text-sm text-white/80">
                Help me plan my afternoon and keep it realistic.
              </div>
              <div className="max-w-[92%] rounded-3xl rounded-bl-xl border border-blue-300/12 bg-blue-500/10 px-4 py-3 text-sm leading-relaxed text-white/85">
                {tonePreview(tone, customTone)}
              </div>
            </div>
          </div>

          <div className="flex flex-1 flex-col rounded-3xl border border-white/10 bg-black/25 p-4 lg:p-5">
            <p className="text-[11px] uppercase tracking-[0.18em] text-white/35">Optional working context</p>
            <p className="mt-2 text-sm text-white/68">
              Add a short note about preferences, role, or how you want help to feel.
            </p>
            <textarea
              value={persona}
              onChange={(event) => setPersona(event.target.value)}
              rows={5}
              maxLength={240}
              placeholder="Example: I like concise summaries first, then deeper detail if needed. Treat me like a builder, not a beginner."
              className="mt-4 flex-1 resize-none rounded-3xl border border-white/10 bg-white/[0.04] px-4 py-4 text-sm text-white outline-none transition-colors placeholder:text-white/28 focus:border-white/25 min-h-[100px]"
            />
            <div className="mt-3 flex items-center justify-between text-[11px] text-white/35">
              <span>{persona.trim() ? 'This can help shape future replies.' : 'Optional, but useful for a more tailored feel.'}</span>
              <span>{persona.length}/240</span>
            </div>
          </div>
        </div>
      </div>
    </StepSurface>
  );
}

function ShortcutStep({
  onBack,
  onComplete,
}: {
  onBack: () => void;
  onComplete: () => void;
}) {
  const [recording, setRecording] = useState(false);
  const [recordedKeys, setRecordedKeys] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!recording) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === 'Escape' && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
        setRecording(false);
        setError(null);
        return;
      }

      const nextKeys: string[] = [];
      if (event.ctrlKey) nextKeys.push('Control');
      if (event.altKey) nextKeys.push('Alt');
      if (event.shiftKey) nextKeys.push('Shift');
      if (event.metaKey) nextKeys.push('Command');

      const rawKey = event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : event.key;
      if (rawKey && !SHORTCUT_MODIFIERS.includes(rawKey) && SHORTCUT_KEYS.includes(rawKey)) {
        nextKeys.push(rawKey);
      }

      const uniqueKeys = Array.from(new Set(nextKeys));
      setRecordedKeys(uniqueKeys);
      setError(null);

      if (hasValidShortcut(uniqueKeys)) {
        setRecording(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [recording]);

  const displayKeysNow = recordedKeys.length > 0 ? recordedKeys : DEFAULT_SHORTCUT_KEYS;
  const displayLabel = displayHotkey(displayKeysNow);

  const handleRecord = () => {
    setRecording(true);
    setRecordedKeys([]);
    setError(null);
  };

  const handleUseDefault = () => {
    setRecording(false);
    setRecordedKeys([]);
    setError(null);
  };

  const handleClear = () => {
    setRecording(false);
    setRecordedKeys([]);
    setError(null);
  };

  const saveKeys = async (keys: string[]) => {
    if (!hasValidShortcut(keys)) {
      setError('Use at least one modifier plus another key.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const accelerator = toAccelerator(keys);
      const result = await window.desktopAPI.setGlobalHotkey(accelerator);
      if (!result?.ok) {
        setError(result?.error || 'Failed to register shortcut.');
        return;
      }

      try {
        localStorage.setItem('stuard_global_hotkey', accelerator);
      } catch {
      }

      onComplete();
    } catch {
      setError('An unexpected error happened while saving the shortcut.');
    } finally {
      setSaving(false);
    }
  };

  const handleFinish = async () => {
    if (recording) return;
    const keysToSave = recordedKeys.length > 0 ? recordedKeys : DEFAULT_SHORTCUT_KEYS;
    await saveKeys(keysToSave);
  };

  return (
    <StepSurface
      eyebrow="Shortcut"
      title="Make Stuard easy to reopen without changing your flow"
      description="A shortcut is the fastest way to make the product feel present after onboarding. You can keep the suggested default or record your own."
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button onClick={onBack} className={SECONDARY_BUTTON}>
            <ChevronLeft size={15} />
            Back
          </button>
          <div className="flex items-center gap-3">
            <button onClick={onComplete} className={GHOST_BUTTON}>
              Skip shortcut
            </button>
            <button onClick={() => void handleFinish()} disabled={recording || saving} className={PRIMARY_BUTTON}>
              {saving ? 'Saving...' : recordedKeys.length > 0 ? 'Save shortcut and finish' : 'Use default and finish'}
              <ArrowRight size={15} />
            </button>
          </div>
        </div>
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <div className="flex flex-1 flex-col items-center justify-center rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.05] to-white/[0.015] p-6 text-center min-h-[200px]">
            <p className="text-[11px] uppercase tracking-[0.18em] text-white/35">
              {recording ? 'Listening for keys' : recordedKeys.length > 0 ? 'Custom shortcut ready' : 'Suggested default'}
            </p>
            <p className="mt-3 text-sm text-white/60">
              {recording ? 'Press your shortcut now. Escape cancels recording.' : 'You can always change this later in settings.'}
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              {displayLabel.map((key, index) => (
                <React.Fragment key={`${key}-${index}`}>
                  {index > 0 && <span className="text-lg text-white/35">+</span>}
                  <span className="min-w-[72px] rounded-2xl border border-white/12 bg-black/30 px-4 py-3 text-center text-lg font-semibold text-white shadow-inner">
                    {key}
                  </span>
                </React.Fragment>
              ))}
            </div>

            {error && (
              <div className="mt-6 w-full rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100/90">
                {error}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-3xl border border-white/10 bg-black/25 p-4 lg:p-5">
            <p className="text-[11px] uppercase tracking-[0.18em] text-white/35">Why this matters</p>
            <div className="mt-4 space-y-3">
              {[
                'Bring up Stuard without mousing through windows.',
                'Make the assistant feel close enough to become habitual.',
                'Keep the first-run experience ending on a useful action.',
              ].map((item) => (
                <div key={item} className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-white/80">
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 lg:p-5">
            <p className="text-[11px] uppercase tracking-[0.18em] text-white/35">Shortcut actions</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button onClick={handleRecord} disabled={saving} className={PRIMARY_BUTTON}>
                <Keyboard size={15} />
                {recording ? 'Recording...' : 'Record new'}
              </button>
              <button onClick={handleUseDefault} disabled={saving} className={SECONDARY_BUTTON}>
                Use default
              </button>
              {recordedKeys.length > 0 && (
                <button onClick={handleClear} disabled={saving} className={SECONDARY_BUTTON}>
                  Clear
                </button>
              )}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-white/45">
              The default is <span className="text-white/80">Ctrl + Shift + Space</span>. Choose a combination that will be easy to remember and unlikely to conflict.
            </p>
          </div>
        </div>
      </div>
    </StepSurface>
  );
}

export function WelcomeFlow({ onComplete }: WelcomeFlowProps) {
  const [step, setStep] = useState(0);
  const [signedIn, setSignedIn] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [selectedPath, setSelectedPath] = useState<OnboardingPath>(getStoredPath);
  const [recommendedPath, setRecommendedPath] = useState<OnboardingPath | null>(null);
  const [profileChecked, setProfileChecked] = useState(false);
  const [startMode, setStartMode] = useState<StartMode>(getStoredStartMode);
  const { tone, customTone, persona } = usePreferences();

  useEffect(() => {
    let active = true;

    const loadSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      setSignedIn(!!data?.session);
      setUserEmail(data?.session?.user?.email ?? null);
    };

    void loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(!!session);
      setUserEmail(session?.user?.email ?? null);
      setSigningIn(false);
    });

    return () => {
      active = false;
      try {
        subscription.unsubscribe();
      } catch {
      }
    };
  }, []);

  useEffect(() => {
    let active = true;

    const loadRecommendedPath = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const userId = data?.session?.user?.id;
        if (!userId) {
          if (active) setProfileChecked(true);
          return;
        }

        const { data: profileData } = await supabase
          .from('profiles')
          .select('onboarding_path, onboarding_profile')
          .eq('id', userId)
          .limit(1);

        if (!active) return;

        const row = (profileData as Array<Record<string, any>> | null)?.[0] ?? null;
        const remotePath = row?.onboarding_profile?.path ?? row?.onboarding_path;
        if (isOnboardingPath(remotePath)) {
          setRecommendedPath(remotePath);
          setSelectedPath(remotePath);
        }
      } catch {
      } finally {
        if (active) setProfileChecked(true);
      }
    };

    void loadRecommendedPath();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('stuard_onboarding_path', selectedPath);
    } catch {
    }
  }, [selectedPath]);

  useEffect(() => {
    try {
      localStorage.setItem('stuard_onboarding_mode', startMode === 'all' ? 'all' : 'guided');
    } catch {
    }
  }, [startMode]);

  const currentStep = FLOW_STEPS[step];
  const totalSteps = FLOW_STEPS.length;
  const pathSummary = PATH_OPTIONS.find((option) => option.id === selectedPath) ?? PATH_OPTIONS[0];

  const sideSummary = useMemo<SummaryCard>(() => {
    if (currentStep.id === 'welcome') {
      return signedIn
        ? {
            title: 'Account is ready',
            description: userEmail ?? 'Your saved setup can be used during onboarding.',
          }
        : {
            title: 'No blockers here',
            description: 'Setup works without signing in. Sync is optional, not a gate.',
          };
    }

    if (currentStep.id === 'path') {
      return {
        title: pathSummary.name,
        description: startMode === 'all' ? 'Showing a broader product path for discovery.' : pathSummary.bestFor,
      };
    }

    if (currentStep.id === 'control') {
      return {
        title: 'Trust should be legible',
        description: 'Approvals, visible activity, and editable memory should be obvious on day one.',
      };
    }

    if (currentStep.id === 'tone') {
      return {
        title: `Tone: ${tone === 'custom' ? 'Custom' : tone.charAt(0).toUpperCase() + tone.slice(1)}`,
        description: persona.trim()
          ? `${persona.trim().slice(0, 110)}${persona.trim().length > 110 ? '...' : ''}`
          : tonePreview(tone, customTone),
      };
    }

    return {
      title: 'Suggested shortcut',
      description: displayHotkey(DEFAULT_SHORTCUT_KEYS).join(' + '),
    };
  }, [currentStep.id, customTone, pathSummary, persona, signedIn, startMode, tone, userEmail]);

  const handleSignIn = async () => {
    setSigningIn(true);
    const result = await startBrowserSignIn();
    if (!result.ok) {
      setSigningIn(false);
    }
  };

  const handleNext = () => {
    setStep((current) => Math.min(current + 1, totalSteps - 1));
  };

  const handleBack = () => {
    setStep((current) => Math.max(current - 1, 0));
  };

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[#09090b]">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: [
            'radial-gradient(circle at 15% 10%, rgba(56,168,255,0.14) 0%, transparent 34%)',
            'radial-gradient(circle at 85% 12%, rgba(72,98,255,0.12) 0%, transparent 32%)',
            'radial-gradient(ellipse 120% 65% at 50% 105%, rgba(56,168,255,0.42) 0%, rgba(18,103,196,0.18) 35%, rgba(6,90,160,0.06) 62%, transparent 84%)',
          ].join(', '),
        }}
      />

      <div className="relative z-10 flex h-full min-h-0 flex-col px-5 py-5 sm:px-6">
        <div className="mx-auto flex h-full min-h-0 w-full max-w-[1320px] gap-5">
          <aside className="hidden xl:flex w-[280px] shrink-0 flex-col rounded-[32px] border border-white/10 bg-white/[0.03] p-6 backdrop-blur-2xl">
            <div className="inline-flex items-center gap-2 self-start rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-white/40">
              <Sparkles size={12} />
              <span>Stuard setup</span>
            </div>

            <div className="mt-6 flex h-14 w-14 items-center justify-center rounded-[22px] bg-white/10 text-white">
              <currentStep.icon size={22} />
            </div>

            <p className="mt-5 text-[11px] uppercase tracking-[0.18em] text-white/35">
              Step {step + 1} of {totalSteps}
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">{currentStep.title}</h1>
            <p className="mt-3 text-sm leading-relaxed text-white/50">{currentStep.description}</p>

            <div className="mt-8 space-y-2">
              {FLOW_STEPS.map((flowStep, index) => {
                const active = index === step;
                const complete = index < step;
                return (
                  <button
                    key={flowStep.id}
                    onClick={() => setStep(index)}
                    className={clsx(
                      'w-full rounded-2xl border px-4 py-3 text-left transition-all',
                      active
                        ? 'border-blue-400/35 bg-blue-500/10'
                        : complete
                          ? 'border-white/10 bg-white/[0.035]'
                          : 'border-white/8 bg-black/15 hover:bg-white/[0.03]'
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className={clsx(
                        'flex h-8 w-8 shrink-0 items-center justify-center rounded-xl',
                        active ? 'bg-blue-500/20 text-blue-100' : complete ? 'bg-white/10 text-white/80' : 'bg-white/5 text-white/35'
                      )}>
                        {complete ? <Check size={14} /> : <flowStep.icon size={14} />}
                      </div>
                      <div>
                        <p className={clsx('text-sm font-medium', active ? 'text-white' : 'text-white/70')}>
                          {flowStep.title}
                        </p>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-white/35">{flowStep.description}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-auto rounded-3xl border border-white/10 bg-black/20 p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-white/35">Current focus</p>
              <p className="mt-3 text-sm font-medium text-white">{sideSummary.title}</p>
              <p className="mt-2 text-xs leading-relaxed text-white/45">{sideSummary.description}</p>
              <p className="mt-4 text-xs leading-relaxed text-white/35">{currentStep.note}</p>
            </div>
          </aside>

          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <div className="mb-4 flex shrink-0 items-center justify-between gap-4 px-1">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-[0.18em] text-white/35">
                  Step {step + 1} of {totalSteps}
                </p>
                <div className="mt-3 flex gap-2 xl:hidden">
                  {FLOW_STEPS.map((flowStep, index) => (
                    <div
                      key={flowStep.id}
                      className={clsx(
                        'h-1.5 flex-1 rounded-full transition-all',
                        index === step ? 'bg-white' : index < step ? 'bg-white/40' : 'bg-white/15'
                      )}
                    />
                  ))}
                </div>
              </div>

            </div>

            <div className="min-h-0 flex-1 overflow-hidden">
              <AnimatePresence mode="wait">
                <motion.div
                  key={currentStep.id}
                  initial={{ opacity: 0, y: 14, scale: 0.99 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -14, scale: 0.99 }}
                  transition={{ duration: 0.22, ease: 'easeOut' }}
                  className="h-full"
                >
                  {step === 0 && (
                    <WelcomeIntroStep
                      signedIn={signedIn}
                      signingIn={signingIn}
                      userEmail={userEmail}
                      onSignIn={handleSignIn}
                      onNext={handleNext}
                    />
                  )}

                  {step === 1 && (
                    <PathSelectionStep
                      selectedPath={selectedPath}
                      setSelectedPath={setSelectedPath}
                      recommendedPath={recommendedPath}
                      profileChecked={profileChecked}
                      startMode={startMode}
                      setStartMode={setStartMode}
                      onBack={handleBack}
                      onNext={handleNext}
                    />
                  )}

                  {step === 2 && <TrustStep onBack={handleBack} onNext={handleNext} />}

                  {step === 3 && <ToneStep onBack={handleBack} onNext={handleNext} />}

                  {step === 4 && <ShortcutStep onBack={handleBack} onComplete={onComplete} />}
                </motion.div>
              </AnimatePresence>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
