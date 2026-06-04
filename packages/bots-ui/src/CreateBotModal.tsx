import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import {
  Activity, AlertCircle, ArrowLeft, Bot, Brain, Check, ChevronDown, ChevronRight, Clock, Loader2,
  MessageSquare, Rocket, Search, Wand2, Wrench, X,
} from 'lucide-react';
import { SCHEDULE_LABELS, type ScheduleInterval } from './proactive-types';
import type { Bot as BotType, BotBlueprint, BlueprintStreamEvent, BlueprintPreflightStep, BlueprintTestRunStatus, BlueprintTrigger, BotTrigger } from './types';
import { COMMON_EMOJIS, TRIGGER_META } from './constants';
import { buildBotBlueprint, streamBotBlueprintWithAi, submitBlueprintClarifyAnswers, runBlueprintPreflightStep } from './blueprint';
import { compactWhitespace, describeTrigger, humanizeModelName, humanizeToolName } from './helpers';
import { ToolsPickerModal } from './ToolsSection';
import { useBotsPlatform } from './BotsPlatformContext';
import { useStudioThemeScope } from './theme-scope';

type Step = 'describe' | 'review';

type ProgressEntry = {
  id: number;
  icon: 'search' | 'results' | 'step' | 'phase' | 'start' | 'done' | 'clarify';
  title: string;
  detail?: string;
  tools?: Array<{ name: string; category: string }>;
  at: number;
};

type InlineClarifyPanel = {
  clarifyId: string;
  questions: string[];
  reason: string | null;
  blocking: boolean;
  answers: Record<number, string>;
  status: 'pending' | 'submitting' | 'resolved' | 'skipped';
  error: string | null;
};

type LiveTestRun = {
  runId: string;
  probe: string;
  label: string;
  rationale: string | null;
  args: Record<string, any> | null;
  status: 'running' | BlueprintTestRunStatus;
  detail: string;
};

type PreflightRunRecord = {
  status: BlueprintTestRunStatus | 'pending' | 'running';
  detail: string;
};

type SetupPreflightCheck = {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail?: string;
};

type SetupPreflightResult = {
  ok: boolean;
  summary: string;
  checks: SetupPreflightCheck[];
};

// ── Studio-native styling tokens ────────────────────────────────────────────
// These keep the modal reading as one calm surface with brand-red only as an
// accent. They use arbitrary `color-mix` values resolved off `--primary` /
// `--foreground-muted` rather than `bg-primary/10`-style opacity utilities:
// in the desktop app those don't generate any CSS (Tailwind v3 + `--primary` is
// a hex var), so the shared accents silently drop their colour. The literal
// arbitrary values below render correctly in the desktop studio/dashboard AND
// on the website (where `--primary` is also defined) — the same approach the
// studio uses to tint `--wf-accent`. Solid `bg-primary` / `text-primary-fg`
// already work via hand-written rules, so those stay as-is.
const HAIRLINE = 'border-[color:var(--dashboard-panel-border)]';
const CARD_CLASS = 'rounded-2xl border border-[color:var(--dashboard-panel-border)]';
const SECTION_LABEL_CLASS = 'mb-1.5 block text-[11px] font-medium uppercase tracking-[0.14em] text-theme-muted';
const FIELD_CLASS =
  'w-full rounded-xl border border-[color:var(--dashboard-panel-border)] text-theme-fg outline-none transition ' +
  'placeholder:text-[color:color-mix(in_srgb,var(--foreground-muted)_60%,transparent)] ' +
  'focus:border-[color:color-mix(in_srgb,var(--primary)_55%,transparent)] ' +
  'focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_18%,transparent)] disabled:opacity-60';

const ACCENT_TEXT = 'text-[color:var(--primary)]';
const ACCENT_BG_6 = 'bg-[color-mix(in_srgb,var(--primary)_6%,transparent)]';
const ACCENT_BG_10 = 'bg-[color-mix(in_srgb,var(--primary)_10%,transparent)]';
const ACCENT_BG_12 = 'bg-[color-mix(in_srgb,var(--primary)_12%,transparent)]';
const ACCENT_BAR = 'bg-[color-mix(in_srgb,var(--primary)_60%,transparent)]';
const ACCENT_BORDER_20 = 'border-[color:color-mix(in_srgb,var(--primary)_20%,transparent)]';
const ACCENT_RING_12 = 'ring-1 ring-[color-mix(in_srgb,var(--primary)_12%,transparent)]';
const ACCENT_RING_15 = 'ring-1 ring-[color-mix(in_srgb,var(--primary)_15%,transparent)]';
const ACCENT_EMOJI_HOVER =
  'hover:border-[color:color-mix(in_srgb,var(--primary)_40%,transparent)] hover:bg-[color-mix(in_srgb,var(--primary)_6%,transparent)]';
// Neutral translucent chip fill (real Tailwind colour → opacity works natively).
const NEUTRAL_CHIP = 'bg-zinc-500/15';

export function CreateBotModal({ onClose, onCreated }: { onClose: () => void; onCreated: (bot: BotType) => void }) {
  const platform = useBotsPlatform();
  const themeScope = useStudioThemeScope();
  const [step, setStep] = useState<Step>('describe');

  // Step 1 inputs
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');

  // Generated / editable blueprint state (filled after generation)
  const [emoji, setEmoji] = useState('🤖');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [instructions, setInstructions] = useState('');
  const [interval, setInterval] = useState<ScheduleInterval>('30m');
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const [clarifyingQuestions, setClarifyingQuestions] = useState<string[]>([]);
  const [clarifyingAnswers, setClarifyingAnswers] = useState<Record<number, string>>({});
  const [resolvedClarifications, setResolvedClarifications] = useState<Array<{ question: string; answer: string }>>([]);
  const [inlineClarifyPanels, setInlineClarifyPanels] = useState<InlineClarifyPanel[]>([]);
  const [liveTestRuns, setLiveTestRuns] = useState<LiveTestRun[]>([]);
  const [preflightSteps, setPreflightSteps] = useState<BlueprintPreflightStep[]>([]);
  const [preflightRuns, setPreflightRuns] = useState<Record<string, PreflightRunRecord>>({});
  const [preflightRunning, setPreflightRunning] = useState(false);
  const [setupChecks, setSetupChecks] = useState<string[]>([]);
  const [triggers, setTriggers] = useState<BlueprintTrigger[]>([]);
  const [availableTools, setAvailableTools] = useState<string[]>([]);
  const [toolPickerOpen, setToolPickerOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Generation progress
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generateElapsed, setGenerateElapsed] = useState(0);
  const [generateStage, setGenerateStage] = useState('');
  const [progressEvents, setProgressEvents] = useState<ProgressEntry[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState<SetupPreflightResult | null>(null);

  useEffect(() => {
    if (!generating) {
      setGenerateElapsed(0);
      return;
    }
    const startedAt = Date.now();
    const tick = () => setGenerateElapsed(Math.floor((Date.now() - startedAt) / 1000));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [generating]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await platform.getAvailableTools?.();
        if (!cancelled && res?.ok && Array.isArray(res.tools)) setAvailableTools(res.tools);
      } catch { /* keep creation usable without the tool registry */ }
    })();
    return () => { cancelled = true; };
  }, [platform]);

  useEffect(() => {
    setTestResult(null);
  }, [selectedTools, interval, clarifyingAnswers, setupChecks]);

  const pushProgress = useCallback((entry: Omit<ProgressEntry, 'id' | 'at'>) => {
    setProgressEvents(prev => [...prev, { id: prev.length, ...entry, at: Date.now() }]);
  }, []);

  const handleStreamEvent = useCallback((event: BlueprintStreamEvent) => {
    if (event.type === 'start') {
      setGenerateStage('Connecting');
      pushProgress({ icon: 'start', title: 'Connected', detail: humanizeModelName(event.model) });
    } else if (event.type === 'phase') {
      if (event.phase === 'generate') {
        setGenerateStage('Designing the agent');
        pushProgress({ icon: 'phase', title: 'Designing the agent' });
      } else {
        setGenerateStage('Refining the output');
        pushProgress({ icon: 'phase', title: 'Refining the output' });
      }
    } else if (event.type === 'tool_search.start') {
      const label = event.fallback ? 'Backup search' : 'Searching the catalog';
      setGenerateStage(label);
      pushProgress({ icon: 'search', title: label, detail: event.query });
    } else if (event.type === 'tool_search.results') {
      const count = event.tools.length;
      pushProgress({
        icon: 'results',
        title: count === 0 ? 'No matches' : `${count} match${count === 1 ? '' : 'es'}`,
        detail: event.query,
        tools: event.tools.map(t => ({ name: t.name, category: t.category })),
      });
    } else if (event.type === 'clarify_user') {
      const questions = Array.isArray(event.questions)
        ? event.questions.map(q => compactWhitespace(q)).filter(Boolean)
        : [];
      if (questions.length > 0 && event.clarifyId) {
        setClarifyingQuestions(prev => Array.from(new Set([...prev, ...questions])).slice(0, 5));
        setInlineClarifyPanels(prev => {
          if (prev.some(panel => panel.clarifyId === event.clarifyId)) return prev;
          return [...prev, {
            clarifyId: event.clarifyId,
            questions,
            reason: event.reason || null,
            blocking: event.blocking !== false,
            answers: {},
            status: 'pending',
            error: null,
          }];
        });
        setGenerateStage('Waiting on your answers');
        pushProgress({
          icon: 'clarify',
          title: event.blocking === false ? 'Clarification suggested' : 'Clarification needed',
          detail: event.reason || questions.join(' '),
        });
      }
    } else if (event.type === 'clarify_received') {
      const answers = Array.isArray(event.answers) ? event.answers : [];
      if (answers.length > 0) {
        setResolvedClarifications(prev => {
          const next = new Map(prev.map(item => [item.question.toLowerCase(), item]));
          for (const item of answers) {
            const question = compactWhitespace(String(item?.question || ''));
            const answer = compactWhitespace(String(item?.answer || ''));
            if (question && answer) next.set(question.toLowerCase(), { question, answer });
          }
          return Array.from(next.values());
        });
      }
      setInlineClarifyPanels(prev => prev.map(panel => panel.clarifyId === event.clarifyId
        ? { ...panel, status: answers.length > 0 ? 'resolved' : 'skipped', error: null }
        : panel));
      setGenerateStage(answers.length > 0 ? 'Refining with your answers' : 'Continuing without answers');
    } else if (event.type === 'test_run.start') {
      setLiveTestRuns(prev => {
        if (prev.some(run => run.runId === event.runId)) return prev;
        return [...prev, {
          runId: event.runId,
          probe: event.probe,
          label: event.label,
          rationale: event.rationale || null,
          args: event.args || null,
          status: 'running',
          detail: 'Running on this machine…',
        }];
      });
      const progress = event.index && event.budget
        ? `Probe ${event.index}/${event.budget}: ${event.label}`
        : `Verifying: ${event.label}`;
      setGenerateStage(progress);
    } else if (event.type === 'test_run.result') {
      setLiveTestRuns(prev => prev.map(run => run.runId === event.runId
        ? { ...run, status: event.status, detail: event.detail || '' }
        : run));
      // Don't lock the stage label to the probe result — the model is moving on
      // to the next step. The next event ('step' / 'test_run.start' / 'blueprint')
      // will set a more accurate label. If nothing else arrives quickly, the
      // 'step' handler below covers the JSON-composition phase.
    } else if (event.type === 'step') {
      const toolNames = event.toolCalls.map(c => c.tool).filter(Boolean);
      if (toolNames.length > 0) {
        pushProgress({ icon: 'step', title: 'Looked up tools', detail: toolNames.map(humanizeToolName).join(', ') });
        // A step with tool calls means the model dispatched work; the tool-specific
        // start handlers above already set a precise stage. No-op here.
      } else {
        pushProgress({ icon: 'step', title: 'Thinking', detail: event.textPreview || undefined });
        // No tool calls in this step → the model is writing the final JSON
        // blueprint. This is the phase where the old UI said "Probe passed —
        // continuing" forever. Surface what's actually happening.
        setGenerateStage('Composing blueprint');
      }
    } else if (event.type === 'blueprint') {
      setGenerateStage('Finalizing');
      const count = event.blueprint?.allowedTools?.length || 0;
      pushProgress({
        icon: 'done',
        title: 'Setup ready',
        detail: count === 0 ? 'No extra tools needed' : `${count} tool${count === 1 ? '' : 's'} selected`,
      });
    }
  }, [pushProgress]);

  const applyBlueprint = (blueprint: BotBlueprint) => {
    setName(blueprint.name);
    setEmoji(blueprint.emoji);
    setSystemPrompt(blueprint.systemPrompt);
    setInstructions(blueprint.instructions);
    setSelectedTools(blueprint.allowedTools);
    setInterval(blueprint.interval);
    setClarifyingQuestions(Array.isArray(blueprint.clarifyingQuestions) ? blueprint.clarifyingQuestions : []);
    setClarifyingAnswers({});
    if (Array.isArray(blueprint.clarifyingAnswers) && blueprint.clarifyingAnswers.length > 0) {
      setResolvedClarifications(prev => {
        const next = new Map(prev.map(item => [item.question.toLowerCase(), item]));
        for (const item of blueprint.clarifyingAnswers || []) {
          const question = compactWhitespace(item?.question || '');
          const answer = compactWhitespace(item?.answer || '');
          if (question && answer) next.set(question.toLowerCase(), { question, answer });
        }
        return Array.from(next.values());
      });
    }
    setSetupChecks(Array.isArray(blueprint.setupChecks) ? blueprint.setupChecks : []);
    setTriggers(Array.isArray(blueprint.triggers) ? blueprint.triggers : []);
    const steps = Array.isArray(blueprint.preflightSteps) ? blueprint.preflightSteps : [];
    setPreflightSteps(steps);
    setPreflightRuns(prev => {
      const next: Record<string, PreflightRunRecord> = {};
      for (const step of steps) next[step.id] = prev[step.id] || { status: 'pending', detail: '' };
      return next;
    });
    setTestResult(null);
  };

  const submitInlineClarifyAnswers = useCallback(async (clarifyId: string, includeAnswers: boolean) => {
    setInlineClarifyPanels(prev => prev.map(panel => panel.clarifyId === clarifyId
      ? { ...panel, status: 'submitting', error: null }
      : panel));
    const target = inlineClarifyPanels.find(panel => panel.clarifyId === clarifyId);
    const answers = includeAnswers && target
      ? target.questions
          .map((question, idx) => ({ question, answer: compactWhitespace(target.answers[idx] || '') }))
          .filter(item => item.answer)
      : [];
    const res = await submitBlueprintClarifyAnswers(platform, clarifyId, answers);
    if (!res.ok) {
      setInlineClarifyPanels(prev => prev.map(panel => panel.clarifyId === clarifyId
        ? { ...panel, status: 'pending', error: res.error || 'Could not submit answers.' }
        : panel));
      return;
    }
    // The clarify_received event will arrive next and mark the panel resolved/skipped.
  }, [inlineClarifyPanels]);

  const updateInlineClarifyAnswer = useCallback((clarifyId: string, idx: number, value: string) => {
    setInlineClarifyPanels(prev => prev.map(panel => panel.clarifyId === clarifyId
      ? { ...panel, answers: { ...panel.answers, [idx]: value } }
      : panel));
  }, []);

  const runSetupPreflight = useCallback(async (): Promise<SetupPreflightResult | null> => {
    setTestRunning(true);
    setPreflightRunning(true);
    try {
      const probeRecords: Record<string, PreflightRunRecord> = {};
      for (const step of preflightSteps) {
        setPreflightRuns(prev => ({ ...prev, [step.id]: { status: 'running', detail: 'Running…' } }));
        try {
          const probeResult = await runBlueprintPreflightStep(platform, { probe: step.probe, args: step.args });
          probeRecords[step.id] = probeResult;
          setPreflightRuns(prev => ({ ...prev, [step.id]: probeResult }));
        } catch (e: any) {
          const failed: PreflightRunRecord = { status: 'fail', detail: e?.message || 'Probe threw an error.' };
          probeRecords[step.id] = failed;
          setPreflightRuns(prev => ({ ...prev, [step.id]: failed }));
        }
      }

      const probeChecks: SetupPreflightCheck[] = preflightSteps.map(step => {
        const run = probeRecords[step.id] || { status: 'pending', detail: 'Did not run.' };
        const status: 'pass' | 'warn' | 'fail' =
          run.status === 'pass' ? 'pass' :
          run.status === 'fail' ? 'fail' :
          'warn';
        return {
          id: `probe-${step.id}`,
          label: step.label,
          status,
          detail: run.detail || step.rationale,
        };
      });

      // When the builder produced no probes, fall back to the legacy heuristic
      // summary so the user still sees something useful. Otherwise the probes
      // are the source of truth — the keyword heuristic is noisier than helpful.
      let combinedChecks = probeChecks;
      if (probeChecks.length === 0) {
        try {
          const res = await platform.testSetup?.({
            allowedTools: selectedTools,
            interval,
            executionTarget: 'local',
            clarifyingQuestions,
            clarifyingAnswers,
            setupChecks,
          });
          combinedChecks = Array.isArray(res?.checks) ? (res.checks as SetupPreflightCheck[]) : [];
        } catch { /* fall through with empty checks */ }
      }

      const failCount = combinedChecks.filter(c => c.status === 'fail').length;
      const warnCount = combinedChecks.filter(c => c.status === 'warn').length;
      const ok = failCount === 0;
      const summary = failCount > 0
        ? `${failCount} probe${failCount === 1 ? '' : 's'} failed — fix before launch.`
        : warnCount > 0
          ? `All probes completed. ${warnCount} warning${warnCount === 1 ? '' : 's'} to review.`
          : combinedChecks.length === 0
            ? 'No preflight probes were registered by the builder.'
            : 'All probes passed. Ready to launch.';

      const result: SetupPreflightResult = { ok, summary, checks: combinedChecks };
      setTestResult(result);
      return result;
    } catch (e: any) {
      const result: SetupPreflightResult = {
        ok: false,
        summary: e?.message || 'Could not run setup checks.',
        checks: [],
      };
      setTestResult(result);
      return result;
    } finally {
      setTestRunning(false);
      setPreflightRunning(false);
    }
  }, [clarifyingAnswers, clarifyingQuestions, interval, preflightSteps, selectedTools, setupChecks]);

  const handleGenerate = async () => {
    const seed = compactWhitespace(goal || name);
    if (!seed) return;
    setGenerating(true);
    setGenerateError(null);
    setProgressEvents([]);
    setInlineClarifyPanels([]);
    setResolvedClarifications([]);
    setLiveTestRuns([]);
    setPreflightSteps([]);
    setPreflightRuns({});
    setTriggers([]);
    setGenerateStage('Connecting');
    const startedAt = Date.now();
    try {
      let blueprint: BotBlueprint;
      try {
        blueprint = await streamBotBlueprintWithAi(platform, seed, availableTools, name, handleStreamEvent);
      } catch (e: any) {
        const took = ((Date.now() - startedAt) / 1000).toFixed(1);
        const reason = e?.message || String(e || 'unknown error');
        console.warn(`[bot-blueprint] failed after ${took}s — using local fallback`, e);
        blueprint = buildBotBlueprint(seed, availableTools, name);
        setGenerateError(`Couldn't reach the AI (${reason}). Used a local setup instead.`);
      }
      applyBlueprint(blueprint);
      setStep('review');
    } finally {
      setGenerating(false);
    }
  };

  const handleStartBlank = () => {
    const blank = buildBotBlueprint(compactWhitespace(goal || name) || 'A new agent', availableTools, name);
    applyBlueprint(blank);
    setStep('review');
  };

  const handleCreate = async () => {
    const finalName = compactWhitespace(name);
    if (!finalName) return;
    const reviewAnswers = clarifyingQuestions
      .map((question, idx) => ({ question, answer: compactWhitespace(clarifyingAnswers[idx] || '') }))
      .filter(item => item.answer);
    const mergedAnswers = new Map<string, { question: string; answer: string }>();
    for (const item of resolvedClarifications) mergedAnswers.set(item.question.toLowerCase(), item);
    for (const item of reviewAnswers) mergedAnswers.set(item.question.toLowerCase(), item);
    const answeredClarifications = Array.from(mergedAnswers.values());
    const unansweredClarifications = clarifyingQuestions.filter((_, idx) => !compactWhitespace(clarifyingAnswers[idx] || ''));
    const clarificationBlock = answeredClarifications.length > 0
      ? [
          'User clarification answers:',
          ...answeredClarifications.map(item => `- ${item.question}: ${item.answer}`),
        ].join('\n')
      : '';
    const unattendedBlock = unansweredClarifications.length > 0
      ? [
          'Before taking unattended action, ask the user:',
          ...unansweredClarifications.map(question => `- ${question}`),
        ].join('\n')
      : '';
    const setupBlock = setupChecks.length > 0
      ? [
          'Setup checks to verify on first run:',
          ...setupChecks.map(check => `- ${check}`),
        ].join('\n')
      : '';
    const finalInstructions = [instructions.trim(), clarificationBlock].filter(Boolean).join('\n\n');
    const finalSystemPrompt = [systemPrompt.trim(), unattendedBlock, setupBlock].filter(Boolean).join('\n\n');
    // Map the blueprint's chosen triggers into the create payload. bot-service
    // seeds any missing per-type defaults (webhook slug, fs.watch events, etc.)
    // and synthesizes a schedule.interval trigger if this array ends up empty.
    const triggerPayload = triggers
      .map(trigger => {
        const baseArgs = trigger.args && typeof trigger.args === 'object' ? trigger.args : {};
        // Keep the schedule.interval trigger in sync with the interval the user
        // sees/edits in the "Wakes up" select, so the two never diverge.
        const args = trigger.type === 'schedule.interval' ? { ...baseArgs, every: interval } : baseArgs;
        return { type: trigger.type, args, enabled: true, label: trigger.label };
      })
      .filter(trigger => trigger.type);
    setSubmitting(true);
    try {
      const preflight = testResult || await runSetupPreflight();
      if (preflight && !preflight.ok) return;
      const res = await platform.create?.({
        name: finalName,
        emoji,
        systemPrompt: finalSystemPrompt,
        triggers: triggerPayload.length > 0 ? triggerPayload : undefined,
        config: {
          interval,
          executionTarget: 'local',
          modelMode: 'balanced',
          instructions: finalInstructions,
          allowedTools: selectedTools,
          notificationChannels: ['app'],
          memoryEnabled: true,
        },
      });
      if (res?.ok && res.bot) onCreated(res.bot);
    } finally {
      setSubmitting(false);
    }
  };

  const canGenerate = !!compactWhitespace(goal || name);

  return createPortal(
    <div
      data-wf-theme={themeScope}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 animate-in fade-in duration-150"
      onClick={onClose}
      style={{ WebkitBackdropFilter: 'blur(14px)', backdropFilter: 'blur(14px)' }}
    >
      <div
        className="flex w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-[color:var(--dashboard-panel-border)] bg-theme-card shadow-2xl animate-in zoom-in-95 duration-150"
        style={{ height: 'min(680px, 88vh)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className={clsx('flex-shrink-0 border-b px-6 pt-5 pb-4', HAIRLINE)}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className={clsx('flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl', ACCENT_BG_10, ACCENT_TEXT)}>
                {step === 'describe' ? <Wand2 className="h-[18px] w-[18px]" /> : <Bot className="h-[18px] w-[18px]" />}
              </span>
              <div className="min-w-0">
                <h2 className="font-stuard text-[17px] font-semibold leading-tight text-theme-fg">
                  {step === 'describe' ? 'Describe your agent' : 'Review & launch'}
                </h2>
                <p className="mt-0.5 text-[12.5px] leading-snug text-theme-muted">
                  {step === 'describe'
                    ? 'Tell us what it should do — we’ll wire up tools, schedule, and prompt.'
                    : 'Tweak anything now, or change it later in Settings.'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="-mr-1 rounded-lg p-1.5 text-theme-muted transition hover:bg-theme-hover hover:text-theme-fg"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Two-step progress — segmented, calm; red marks the active step. */}
          <div className="mt-4 flex items-center gap-3">
            <StepSegment label="Describe" index={1} state={step === 'describe' ? 'active' : 'done'} />
            <StepSegment label="Review" index={2} state={step === 'review' ? 'active' : 'todo'} />
          </div>
        </div>

        {/* Body */}
        <div
          className="memory-context-scrollbar px-6 py-5"
          style={{ flex: '1 1 0', minHeight: 0, overflowY: 'auto', scrollbarGutter: 'stable' }}
        >
          {step === 'describe' ? (
            <DescribeStep
              name={name}
              setName={setName}
              goal={goal}
              setGoal={setGoal}
              generating={generating}
              generateStage={generateStage}
              generateElapsed={generateElapsed}
              progressEvents={progressEvents}
              generateError={generateError}
              clarifyPanels={inlineClarifyPanels}
              onClarifyAnswerChange={updateInlineClarifyAnswer}
              onClarifySubmit={(clarifyId) => submitInlineClarifyAnswers(clarifyId, true)}
              onClarifySkip={(clarifyId) => submitInlineClarifyAnswers(clarifyId, false)}
              liveTestRuns={liveTestRuns}
            />
          ) : (
            <ReviewStep
              name={name}
              setName={setName}
              emoji={emoji}
              setEmoji={setEmoji}
              interval={interval}
              setInterval={setInterval}
              selectedTools={selectedTools}
              openToolsPicker={() => setToolPickerOpen(true)}
              clarifyingQuestions={clarifyingQuestions}
              clarifyingAnswers={clarifyingAnswers}
              setClarifyingAnswer={(idx, value) => setClarifyingAnswers(prev => ({ ...prev, [idx]: value }))}
              resolvedClarifications={resolvedClarifications}
              setupChecks={setupChecks}
              triggers={triggers}
              preflightSteps={preflightSteps}
              preflightRuns={preflightRuns}
              preflightRunning={preflightRunning}
              onTestSetup={runSetupPreflight}
              testRunning={testRunning}
              testResult={testResult}
              systemPrompt={systemPrompt}
              setSystemPrompt={setSystemPrompt}
              instructions={instructions}
              setInstructions={setInstructions}
              showAdvanced={showAdvanced}
              setShowAdvanced={setShowAdvanced}
              generateError={generateError}
            />
          )}
        </div>

        {/* Footer */}
        <div className={clsx('flex flex-shrink-0 items-center justify-between gap-3 border-t px-6 py-4', HAIRLINE)}>
          {step === 'describe' ? (
            <>
              <button
                type="button"
                onClick={handleStartBlank}
                disabled={generating}
                className="rounded-full px-3 py-2 text-[12.5px] font-medium text-theme-muted transition hover:text-theme-fg disabled:opacity-50"
              >
                Start blank instead
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={generating}
                  className="rounded-full px-4 py-2 text-[13px] font-medium text-theme-muted transition hover:text-theme-fg disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={generating || !canGenerate}
                  className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-[13px] font-semibold text-primary-fg shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                  {generating ? `Generating · ${generateElapsed}s` : 'Generate setup'}
                </button>
              </div>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setStep('describe')}
                disabled={submitting}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[13px] font-medium text-theme-muted transition hover:text-theme-fg disabled:opacity-50"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={submitting}
                  className="rounded-full px-4 py-2 text-[13px] font-medium text-theme-muted transition hover:text-theme-fg disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={!compactWhitespace(name) || submitting}
                  className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-[13px] font-semibold text-primary-fg shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
                  Launch agent
                </button>
              </div>
            </>
          )}
        </div>

        {toolPickerOpen && (
          <ToolsPickerModal
            available={availableTools}
            selected={selectedTools}
            onClose={() => setToolPickerOpen(false)}
            onApply={(next) => { setSelectedTools(next); setToolPickerOpen(false); }}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}

// ─── Header step segment ──────────────────────────────────────────────────

function StepSegment({ label, index, state }: { label: string; index: number; state: 'active' | 'done' | 'todo' }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <span
        className={clsx(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold transition-colors',
          state === 'active' && 'bg-primary text-primary-fg',
          state === 'done' && clsx(ACCENT_BG_12, ACCENT_TEXT),
          state === 'todo' && clsx(NEUTRAL_CHIP, 'text-theme-muted'),
        )}
      >
        {state === 'done' ? <Check className="h-3 w-3" /> : index}
      </span>
      <span
        className={clsx(
          'truncate text-[12px] font-medium transition-colors',
          state === 'todo' ? 'text-theme-muted' : 'text-theme-fg',
        )}
      >
        {label}
      </span>
      <span
        className={clsx(
          'ml-1 h-[3px] flex-1 rounded-full transition-colors',
          state === 'todo' ? 'bg-zinc-500/25' : ACCENT_BAR,
        )}
      />
    </div>
  );
}

// ─── Step 1: Describe ──────────────────────────────────────────────────────

function DescribeStep({
  name,
  setName,
  goal,
  setGoal,
  generating,
  generateStage,
  generateElapsed,
  progressEvents,
  generateError,
  clarifyPanels,
  onClarifyAnswerChange,
  onClarifySubmit,
  onClarifySkip,
  liveTestRuns,
}: {
  name: string;
  setName: (v: string) => void;
  goal: string;
  setGoal: (v: string) => void;
  generating: boolean;
  generateStage: string;
  generateElapsed: number;
  progressEvents: ProgressEntry[];
  generateError: string | null;
  clarifyPanels: InlineClarifyPanel[];
  onClarifyAnswerChange: (clarifyId: string, idx: number, value: string) => void;
  onClarifySubmit: (clarifyId: string) => void;
  onClarifySkip: (clarifyId: string) => void;
  liveTestRuns: LiveTestRun[];
}) {
  const activeClarifyPanel = clarifyPanels.find(panel => panel.status === 'pending' || panel.status === 'submitting') || null;
  const probesScrollRef = useRef<HTMLUListElement>(null);
  const firstClarifyInputRef = useRef<HTMLInputElement>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  // Autoscroll the probes feed to the latest entry so the user always sees the
  // current verification step instead of having to scroll an inner panel.
  useEffect(() => {
    const el = probesScrollRef.current;
    if (!el || liveTestRuns.length === 0) return;
    el.scrollTop = el.scrollHeight;
  }, [liveTestRuns]);

  // Auto-focus the first clarification input when a new panel appears, so the
  // user can type immediately instead of hunting for the field.
  useEffect(() => {
    if (!activeClarifyPanel) return;
    const id = window.requestAnimationFrame(() => {
      firstClarifyInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [activeClarifyPanel?.clarifyId]);

  const probesDone = liveTestRuns.filter(r => r.status !== 'running').length;
  const probesTotal = liveTestRuns.length;
  const probesFailed = liveTestRuns.filter(r => r.status === 'fail').length;

  return (
    <div className="space-y-5">
      <div>
        <label className={SECTION_LABEL_CLASS}>What should it do?</label>
        <textarea
          autoFocus
          rows={5}
          value={goal}
          onChange={e => setGoal(e.target.value)}
          disabled={generating}
          placeholder="e.g. Watch GitHub issues for billing bugs, summarize what changed, and notify me when something needs a reply."
          className={clsx(FIELD_CLASS, 'resize-none px-4 py-3 text-[14px] leading-6')}
        />
        <p className="mt-1.5 text-[11px] leading-5 text-theme-muted">
          Be concrete: what to watch, what to do about it, and when you want to be told.
        </p>
      </div>

      <div>
        <label className={SECTION_LABEL_CLASS}>
          Name <span className="ml-1 normal-case tracking-normal text-theme-muted">(optional — we’ll suggest one)</span>
        </label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          disabled={generating}
          placeholder="Twitter Update Agent"
          className={clsx(FIELD_CLASS, 'px-4 py-3 text-[14px]')}
        />
      </div>

      {/* Sticky stage banner. Always reflects what's actually happening right
          now, so the user never sees a frozen "Probe passed — continuing" while
          the model is composing the final JSON. Opaque so feed scrolls cleanly
          underneath it. */}
      {generating && (
        <div className={clsx('sticky top-0 z-10 -mx-1 flex items-center justify-between gap-3 rounded-2xl border bg-theme-card px-4 py-2.5 shadow-sm', HAIRLINE)}>
          <div className="flex min-w-0 items-center gap-2.5">
            <Loader2 className={clsx('h-4 w-4 shrink-0 animate-spin', ACCENT_TEXT)} />
            <div className="min-w-0">
              <div className="truncate text-[12.5px] font-semibold text-theme-fg">
                {generateStage || 'Working'}
              </div>
              {probesTotal > 0 && (
                <div className="text-[10.5px] text-theme-muted">
                  {probesDone}/{probesTotal} probe{probesTotal === 1 ? '' : 's'} complete
                  {probesFailed > 0 && (
                    <span className="text-red-400"> · {probesFailed} failed</span>
                  )}
                </div>
              )}
            </div>
          </div>
          <span className={clsx('shrink-0 rounded-full px-2 py-0.5 text-[10.5px] tabular-nums text-theme-muted', NEUTRAL_CHIP)}>
            {generateElapsed}s
          </span>
        </div>
      )}

      {/* Clarification panel rendered prominently right under the stage banner
          so it can't get buried under the probes feed. Auto-focuses the first
          input. Reads as a calm, studio-native question card — the agent is
          asking, not alarming. */}
      {activeClarifyPanel && (
        <div className={clsx('overflow-hidden rounded-2xl border bg-theme-card shadow-sm', HAIRLINE, ACCENT_RING_15)}>
          <div className={clsx('flex items-center gap-2.5 border-b px-4 py-3', HAIRLINE)}>
            <span className={clsx('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', ACCENT_BG_10, ACCENT_TEXT)}>
              <MessageSquare className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-theme-fg">
                {activeClarifyPanel.blocking ? 'A couple of quick questions' : 'A couple of details would help'}
              </div>
              <div className="text-[11px] text-theme-muted">
                {activeClarifyPanel.blocking
                  ? 'Needed to finish setting up your agent'
                  : 'Optional — answer to sharpen the setup'}
              </div>
            </div>
            <span className="shrink-0 text-[10.5px] tabular-nums text-theme-muted">{generateElapsed}s</span>
          </div>
          <div className="space-y-3 px-4 py-3.5">
            {activeClarifyPanel.reason && (
              <p className="text-[12px] leading-5 text-theme-muted">{activeClarifyPanel.reason}</p>
            )}
            {activeClarifyPanel.questions.map((question, idx) => (
              <label key={`${activeClarifyPanel.clarifyId}-${idx}`} className="block">
                <span className="mb-1.5 block text-[12.5px] leading-5 text-theme-fg">{question}</span>
                <input
                  ref={idx === 0 ? firstClarifyInputRef : undefined}
                  type="text"
                  value={activeClarifyPanel.answers[idx] || ''}
                  onChange={e => onClarifyAnswerChange(activeClarifyPanel.clarifyId, idx, e.target.value)}
                  disabled={activeClarifyPanel.status === 'submitting'}
                  placeholder="Your answer"
                  className={clsx(FIELD_CLASS, 'px-3 py-2 text-[13px]')}
                />
              </label>
            ))}
            {activeClarifyPanel.error && (
              <p className="flex items-start gap-1.5 text-[11.5px] text-red-400">
                <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>{activeClarifyPanel.error}</span>
              </p>
            )}
            <div className="flex items-center justify-end gap-1 pt-1">
              <button
                type="button"
                onClick={() => onClarifySkip(activeClarifyPanel.clarifyId)}
                disabled={activeClarifyPanel.status === 'submitting'}
                className="rounded-full px-3 py-1.5 text-[12px] font-medium text-theme-muted transition hover:text-theme-fg disabled:opacity-50"
              >
                Skip — ask me on first run
              </button>
              <button
                type="button"
                onClick={() => onClarifySubmit(activeClarifyPanel.clarifyId)}
                disabled={
                  activeClarifyPanel.status === 'submitting' ||
                  activeClarifyPanel.questions.every((_, idx) => !compactWhitespace(activeClarifyPanel.answers[idx] || ''))
                }
                className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-[12.5px] font-semibold text-primary-fg shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {activeClarifyPanel.status === 'submitting' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                Send answers
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Probes feed — calm neutral rows, autoscrolls to the latest entry so the
          user actually watches probes execute. */}
      {liveTestRuns.length > 0 && (
        <div className={clsx(CARD_CLASS, 'overflow-hidden')}>
          <div className={clsx('flex items-center justify-between border-b px-4 py-2.5', HAIRLINE)}>
            <div className="flex items-center gap-2 text-[12.5px] font-medium text-theme-fg">
              <Activity className={clsx('h-4 w-4', ACCENT_TEXT)} />
              <span>Verifying on your machine</span>
            </div>
            <span className="text-[10.5px] tabular-nums text-theme-muted">
              {probesDone}/{probesTotal} done{probesFailed > 0 && ` · ${probesFailed} failed`}
            </span>
          </div>
          <ul ref={probesScrollRef} className="max-h-64 overflow-y-auto scrollbar-minimal">
            {liveTestRuns.map((run, idx) => {
              const Icon =
                run.status === 'running' ? Loader2 :
                run.status === 'pass' ? Check :
                run.status === 'fail' ? AlertCircle :
                AlertCircle;
              const tone =
                run.status === 'running' ? ACCENT_TEXT :
                run.status === 'pass' ? 'text-emerald-400' :
                run.status === 'fail' ? 'text-red-400' :
                'text-amber-400';
              return (
                <li
                  key={run.runId}
                  className={clsx(
                    'flex items-start gap-3 px-4 py-3 text-[12.5px] transition-colors',
                    run.status === 'fail' && 'bg-red-500/[0.04]',
                    idx !== liveTestRuns.length - 1 && clsx('border-b', HAIRLINE),
                  )}
                >
                  <span className={clsx('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center', tone)}>
                    <Icon className={clsx('h-3.5 w-3.5', run.status === 'running' && 'animate-spin')} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-theme-fg">{run.label}</div>
                    {run.detail && (
                      <div className="mt-0.5 text-[11.5px] leading-4 text-theme-muted">{run.detail}</div>
                    )}
                  </div>
                  <span className={clsx('ml-2 shrink-0 rounded-md border px-1.5 py-0.5 text-[9.5px] uppercase tracking-wide text-theme-muted', HAIRLINE)}>
                    {run.probe.replace(/_/g, ' ')}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Activity log lives behind a collapsible disclosure so the busy
          "Looked up tools / Searching the catalog" stream doesn't dominate the
          modal. The current stage banner above is enough for most users. */}
      {progressEvents.length > 0 && (
        <div className={clsx(CARD_CLASS, 'overflow-hidden')}>
          <button
            type="button"
            onClick={() => setDetailsOpen(open => !open)}
            className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-[12px] text-theme-muted transition hover:text-theme-fg"
          >
            <div className="flex items-center gap-2">
              <Activity className="h-3.5 w-3.5" />
              <span>Activity log</span>
              <span className={clsx('rounded-full px-1.5 py-0.5 text-[10px] tabular-nums', NEUTRAL_CHIP)}>
                {progressEvents.length}
              </span>
            </div>
            <ChevronDown className={clsx('h-3.5 w-3.5 transition-transform', detailsOpen && 'rotate-180')} />
          </button>
          {detailsOpen && (
            <ul className={clsx('max-h-72 space-y-0 overflow-y-auto border-t scrollbar-minimal', HAIRLINE)}>
              {progressEvents.map((event, idx) => {
                const IconCmp =
                  event.icon === 'search' ? Search :
                  event.icon === 'results' ? Check :
                  event.icon === 'clarify' ? MessageSquare :
                  event.icon === 'step' ? Brain :
                  event.icon === 'phase' ? Activity :
                  event.icon === 'done' ? Check :
                  Activity;
                const iconTone =
                  event.icon === 'done' || event.icon === 'results'
                    ? 'text-emerald-400'
                    : ACCENT_TEXT;
                return (
                  <li
                    key={event.id}
                    className={clsx(
                      'flex items-start gap-2.5 px-4 py-2.5 text-[12px]',
                      idx !== progressEvents.length - 1 && clsx('border-b', HAIRLINE),
                    )}
                  >
                    <span className={clsx('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center', iconTone)}>
                      <IconCmp className="h-3 w-3" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-theme-fg">{event.title}</div>
                      {event.detail && (
                        <div className="mt-0.5 truncate text-theme-muted">{event.detail}</div>
                      )}
                      {event.tools && event.tools.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {event.tools.slice(0, 10).map(t => (
                            <span
                              key={t.name}
                              title={t.name}
                              className={clsx('rounded-md border bg-theme-card px-1.5 py-0.5 text-[10px] text-theme-fg', HAIRLINE)}
                            >
                              {humanizeToolName(t.name)}
                            </span>
                          ))}
                          {event.tools.length > 10 && (
                            <span className={clsx('rounded-md px-1.5 py-0.5 text-[10px] text-theme-muted', NEUTRAL_CHIP)}>
                              +{event.tools.length - 10} more
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {generateError && <NoticeBanner message={generateError} />}
    </div>
  );
}

// ─── Step 2: Review ───────────────────────────────────────────────────────

function ReviewStep({
  name,
  setName,
  emoji,
  setEmoji,
  interval,
  setInterval,
  selectedTools,
  openToolsPicker,
  clarifyingQuestions,
  clarifyingAnswers,
  setClarifyingAnswer,
  resolvedClarifications,
  setupChecks,
  triggers,
  preflightSteps,
  preflightRuns,
  preflightRunning,
  onTestSetup,
  testRunning,
  testResult,
  systemPrompt,
  setSystemPrompt,
  instructions,
  setInstructions,
  showAdvanced,
  setShowAdvanced,
  generateError,
}: {
  name: string;
  setName: (v: string) => void;
  emoji: string;
  setEmoji: (v: string) => void;
  interval: ScheduleInterval;
  setInterval: (v: ScheduleInterval) => void;
  selectedTools: string[];
  openToolsPicker: () => void;
  clarifyingQuestions: string[];
  clarifyingAnswers: Record<number, string>;
  setClarifyingAnswer: (idx: number, value: string) => void;
  resolvedClarifications: Array<{ question: string; answer: string }>;
  setupChecks: string[];
  triggers: BlueprintTrigger[];
  preflightSteps: BlueprintPreflightStep[];
  preflightRuns: Record<string, PreflightRunRecord>;
  preflightRunning: boolean;
  onTestSetup: () => void | Promise<any>;
  testRunning: boolean;
  testResult: SetupPreflightResult | null;
  systemPrompt: string;
  setSystemPrompt: (v: string) => void;
  instructions: string;
  setInstructions: (v: string) => void;
  showAdvanced: boolean;
  setShowAdvanced: (v: boolean) => void;
  generateError: string | null;
}) {
  return (
    <div className="space-y-5">
      {generateError && <NoticeBanner message={generateError} />}

      {/* Identity row */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          className={clsx('flex h-14 w-14 items-center justify-center rounded-2xl border bg-theme-card text-2xl transition', HAIRLINE, ACCENT_EMOJI_HOVER)}
          onClick={() => {
            const idx = COMMON_EMOJIS.indexOf(emoji);
            setEmoji(COMMON_EMOJIS[(idx + 1) % COMMON_EMOJIS.length]);
          }}
          title="Click to cycle"
          aria-label="Change emoji"
        >
          {emoji}
        </button>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Agent name"
          className={clsx(FIELD_CLASS, 'flex-1 px-4 py-3 text-[14px] font-medium')}
        />
      </div>

      {resolvedClarifications.length > 0 && (
        <div className={clsx(CARD_CLASS, 'px-4 py-3')}>
          <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold text-theme-fg">
            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-emerald-500/12 text-emerald-400">
              <Check className="h-3 w-3" />
            </span>
            Answered during setup
          </div>
          <ul className="space-y-2">
            {resolvedClarifications.map((item, idx) => (
              <li key={`${item.question}-${idx}`} className="text-[12px] leading-5">
                <span className="block text-theme-muted">{item.question}</span>
                <span className="block font-medium text-theme-fg">{item.answer}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(clarifyingQuestions.length > 0 || setupChecks.length > 0 || preflightSteps.length > 0) && (
        <div className="space-y-3">
          {clarifyingQuestions.length > 0 && (
            <div className={clsx(CARD_CLASS, 'px-4 py-3', ACCENT_RING_12)}>
              <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold text-theme-fg">
                <span className={clsx('flex h-5 w-5 items-center justify-center rounded-md', ACCENT_BG_12, ACCENT_TEXT)}>
                  <MessageSquare className="h-3 w-3" />
                </span>
                Clarify before unattended runs
              </div>
              <div className="space-y-2.5">
                {clarifyingQuestions.map((question, idx) => (
                  <label key={`${question}-${idx}`} className="block">
                    <span className="mb-1 block text-[11.5px] leading-4 text-theme-muted">{question}</span>
                    <input
                      type="text"
                      value={clarifyingAnswers[idx] || ''}
                      onChange={e => setClarifyingAnswer(idx, e.target.value)}
                      placeholder="Answer or leave for the agent to ask later"
                      className={clsx(FIELD_CLASS, 'px-3 py-2 text-[12.5px]')}
                    />
                  </label>
                ))}
              </div>
            </div>
          )}

          {preflightSteps.length > 0 && (
            <div className={clsx(CARD_CLASS, 'px-4 py-3')}>
              <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold text-theme-fg">
                <Activity className={clsx('h-3.5 w-3.5', ACCENT_TEXT)} />
                Preflight probes
                {preflightRunning && <Loader2 className={clsx('ml-1 h-3 w-3 animate-spin', ACCENT_TEXT)} />}
              </div>
              <ul className="space-y-1.5">
                {preflightSteps.map(step => {
                  const run = preflightRuns[step.id] || { status: 'pending', detail: '' };
                  const Icon =
                    run.status === 'running' ? Loader2 :
                    run.status === 'pass' ? Check :
                    run.status === 'fail' ? AlertCircle :
                    run.status === 'warn' ? AlertCircle :
                    Activity;
                  const tone =
                    run.status === 'running' ? ACCENT_TEXT :
                    run.status === 'pass' ? 'text-emerald-400' :
                    run.status === 'fail' ? 'text-red-400' :
                    run.status === 'warn' ? 'text-amber-400' :
                    'text-theme-muted';
                  return (
                    <li key={step.id} className="flex items-start gap-2 text-[12px] leading-5">
                      <span className={clsx('mt-1 flex h-4 w-4 shrink-0 items-center justify-center', tone)}>
                        <Icon className={clsx('h-3 w-3', run.status === 'running' && 'animate-spin')} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-theme-fg">{step.label}</div>
                        {(run.detail || step.rationale) && (
                          <div className="mt-0.5 text-theme-muted">{run.detail || step.rationale}</div>
                        )}
                      </div>
                      <span className={clsx('ml-2 shrink-0 rounded-md border px-1.5 py-0.5 text-[9.5px] uppercase tracking-wide text-theme-muted', HAIRLINE)}>
                        {step.probe.replace(/_/g, ' ')}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {setupChecks.length > 0 && (
            <div className={clsx(CARD_CLASS, 'px-4 py-3')}>
              <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold text-theme-fg">
                <Check className="h-3.5 w-3.5 text-emerald-400" />
                Additional reminders
              </div>
              <ul className="space-y-1.5">
                {setupChecks.map((check, idx) => (
                  <li key={`${check}-${idx}`} className="flex gap-2 text-[12px] leading-5 text-theme-muted">
                    <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-zinc-500/60" />
                    <span>{check}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className={clsx(CARD_CLASS, 'px-4 py-3')}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[12px] font-semibold text-theme-fg">
              <Activity className={clsx('h-3.5 w-3.5', ACCENT_TEXT)} />
              Test setup
            </div>
            <p className="mt-1 text-[11.5px] leading-5 text-theme-muted">
              Checks tool availability, routing, unanswered clarifications, and local/VM setup risks before launch.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onTestSetup()}
            disabled={testRunning}
            className={clsx('inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11.5px] font-medium text-theme-fg transition hover:bg-theme-hover disabled:opacity-60', HAIRLINE)}
          >
            {testRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            Run
          </button>
        </div>
        {testResult && (
          <div className={clsx('mt-3 space-y-2 border-t pt-3', HAIRLINE)}>
            <div className={clsx(
              'text-[12px] font-medium',
              testResult.ok ? 'text-emerald-400' : 'text-red-400',
            )}>
              {testResult.summary}
            </div>
            {testResult.checks.length > 0 && (
              <ul className="space-y-1.5">
                {testResult.checks.map(check => (
                  <li key={check.id} className="flex gap-2 text-[12px] leading-5 text-theme-muted">
                    <span className={clsx(
                      'mt-2 h-1.5 w-1.5 shrink-0 rounded-full',
                      check.status === 'pass' ? 'bg-emerald-400' :
                      check.status === 'warn' ? 'bg-amber-400' :
                      'bg-red-400',
                    )} />
                    <span className="min-w-0">
                      <span className="text-theme-fg">{check.label}</span>
                      {check.detail && <span className="text-theme-muted"> - {check.detail}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* When it runs — triggers chosen by the builder, plus the editable cadence. */}
      <div>
        <label className={clsx(SECTION_LABEL_CLASS, 'flex items-center gap-1.5')}>
          <Clock className="h-3 w-3" /> When it runs
        </label>

        {(() => {
          const nonInterval = triggers.filter(t => t.type !== 'schedule.interval');
          const hasInterval = triggers.length === 0 || triggers.some(t => t.type === 'schedule.interval');
          return (
            <div className="space-y-2">
              {nonInterval.map((trigger, idx) => {
                const meta = TRIGGER_META[trigger.type];
                const Icon = meta?.icon || Clock;
                const desc = describeTrigger({ type: trigger.type, args: trigger.args || {} } as BotTrigger);
                return (
                  <div
                    key={`${trigger.type}-${idx}`}
                    className={clsx('flex items-start gap-3 rounded-2xl border px-4 py-3', ACCENT_BORDER_20, ACCENT_BG_6)}
                  >
                    <div className={clsx('flex h-8 w-8 shrink-0 items-center justify-center rounded-xl', ACCENT_BG_10, ACCENT_TEXT)}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium text-theme-fg">{meta?.label || trigger.type}</div>
                      <div className="truncate text-[12px] text-theme-muted">{desc}</div>
                      {trigger.rationale && (
                        <div className="mt-0.5 text-[11px] leading-4 text-theme-muted">{trigger.rationale}</div>
                      )}
                    </div>
                  </div>
                );
              })}

              {hasInterval && (
                <div className={clsx(CARD_CLASS, 'px-3 py-2.5')}>
                  <div className="mb-1.5 flex items-center gap-2 text-[11.5px] font-medium text-theme-fg">
                    <Clock className={clsx('h-3.5 w-3.5', ACCENT_TEXT)} />
                    {nonInterval.length > 0 ? 'Also on a schedule' : 'On a schedule'}
                  </div>
                  <select
                    value={interval}
                    onChange={e => setInterval(e.target.value as ScheduleInterval)}
                    className={clsx(FIELD_CLASS, 'px-3 py-2.5 text-[13.5px]')}
                  >
                    {Object.entries(SCHEDULE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          );
        })()}

        <p className="mt-1.5 text-[11px] leading-5 text-theme-muted">
          Fine-tune these or add more triggers after launch in Settings → When it runs. Any trigger firing wakes the agent.
        </p>
      </div>

      {/* Tools */}
      <div>
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <label className={clsx(SECTION_LABEL_CLASS, 'mb-0 flex items-center gap-1.5')}>
            <Wrench className="h-3 w-3" /> Tools
          </label>
          <button
            type="button"
            onClick={openToolsPicker}
            className={clsx('text-[11px] font-medium transition hover:opacity-80', ACCENT_TEXT)}
          >
            Edit tools
          </button>
        </div>
        <div className={clsx(CARD_CLASS, 'px-4 py-3')}>
          {selectedTools.length === 0 ? (
            <p className="text-[12px] text-theme-muted">
              No extra tools added — the agent will use its default toolkit.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {selectedTools.map(tool => (
                <span
                  key={tool}
                  title={tool}
                  className={clsx('rounded-md border px-2 py-1 text-[11px] font-medium', ACCENT_BORDER_20, ACCENT_BG_10, ACCENT_TEXT)}
                >
                  {humanizeToolName(tool)}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Advanced */}
      <div className={clsx('border-t pt-4', HAIRLINE)}>
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex w-full items-center justify-between gap-3 text-[12px] font-medium text-theme-muted transition hover:text-theme-fg"
        >
          <span>Advanced — system prompt &amp; run instructions</span>
          <ChevronRight className={clsx('h-3.5 w-3.5 transition-transform', showAdvanced && 'rotate-90')} />
        </button>
        {showAdvanced && (
          <div className="mt-3 space-y-4">
            <div>
              <label className={SECTION_LABEL_CLASS}>System prompt</label>
              <textarea
                rows={6}
                value={systemPrompt}
                onChange={e => setSystemPrompt(e.target.value)}
                placeholder="Posts a weekly product update to X every Tuesday at 9am."
                className={clsx(FIELD_CLASS, 'resize-none px-4 py-3 text-[13px] leading-6')}
              />
            </div>
            <div>
              <label className={SECTION_LABEL_CLASS}>Per-run instructions</label>
              <textarea
                rows={3}
                value={instructions}
                onChange={e => setInstructions(e.target.value)}
                placeholder="At each wake-up, check the latest context, use tools, and only notify when useful."
                className={clsx(FIELD_CLASS, 'resize-none px-4 py-3 text-[13px] leading-6')}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Shared notice banner ──────────────────────────────────────────────────
// Calm, low-saturation advisory (e.g. "couldn't reach the AI, used a local
// setup"). Soft amber accent on a neutral surface — not an alarm block.

function NoticeBanner({ message }: { message: string }) {
  return (
    <div className={clsx('flex items-start gap-2.5 rounded-xl border bg-amber-500/[0.06] px-3.5 py-2.5 text-[12px] leading-5', HAIRLINE)}>
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
      <span className="flex-1 text-theme-muted">{message}</span>
    </div>
  );
}
