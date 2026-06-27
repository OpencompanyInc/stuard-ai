import React, { useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { Check, ChevronLeft, ChevronRight, CornerDownLeft, MessagesSquare, Send, X } from 'lucide-react';
import {
  buildAskUserResult,
  isQuestionAnswered,
  normalizeAskUserPrompt,
  type NormalizedAskUserQuestion,
} from './askUserPromptUtils';

/** Brand-red tint helpers (opacity modifiers on --primary are dead no-ops here,
 *  so we mix the channel explicitly — same idiom Studio uses for --wf-accent). */
const brandSoft = (pct: number) => `color-mix(in srgb, var(--primary) ${pct}%, transparent)`;

export const AskUserPrompt: React.FC<{
  prompt: { id: string; args: any };
  onRespond: (id: string, result: any) => void;
}> = ({ prompt, onRespond }) => {
  const normalized = useMemo(() => normalizeAskUserPrompt(prompt.args), [prompt.args]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const firstTextRef = useRef<HTMLTextAreaElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const page = normalized.pages[currentPageIndex];
  const totalPages = normalized.pages.length;

  useEffect(() => {
    // Focus the textarea if the page leads with one; otherwise focus the card so
    // number-key / Enter shortcuts work immediately.
    if (firstTextRef.current) firstTextRef.current.focus();
    else cardRef.current?.focus();
  }, [currentPageIndex]);

  const setAnswer = (questionId: string, value: unknown) =>
    setAnswers((prev) => ({ ...prev, [questionId]: value }));

  const submit = (nextAnswers = answers) => onRespond(prompt.id, buildAskUserResult(normalized, nextAnswers));
  const dismiss = () => onRespond(prompt.id, { ok: false, dismissed: true });
  const canContinue = page?.questions.every((question) => isQuestionAnswered(question, answers[question.id])) ?? false;
  const isLastPage = currentPageIndex === totalPages - 1;
  const advance = () =>
    isLastPage ? submit() : setCurrentPageIndex((index) => Math.min(totalPages - 1, index + 1));

  const pick = (question: NormalizedAskUserQuestion, value: unknown) => {
    const nextAnswers = { ...answers, [question.id]: value };
    setAnswer(question.id, value);
    // Legacy single-question prompts answer-and-go in one tap.
    if (normalized.isLegacySingle) submit(nextAnswers);
  };

  // A page with exactly one pick-style question gets number-key shortcuts (1..9).
  const soloPickQuestion =
    page && page.questions.length === 1 && page.questions[0].type !== 'text' ? page.questions[0] : null;

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      dismiss();
      return;
    }
    const inTextarea = (event.target as HTMLElement)?.tagName === 'TEXTAREA';
    if (event.key === 'Enter' && !event.shiftKey && !inTextarea) {
      if (canContinue) {
        event.preventDefault();
        advance();
      }
      return;
    }
    if (inTextarea) return;
    if (soloPickQuestion && /^[1-9]$/.test(event.key)) {
      const idx = Number(event.key) - 1;
      if (soloPickQuestion.type === 'confirm') {
        if (idx <= 1) {
          event.preventDefault();
          pick(soloPickQuestion, idx === 0);
        }
      } else if (soloPickQuestion.options[idx]) {
        event.preventDefault();
        pick(soloPickQuestion, soloPickQuestion.options[idx].id);
      }
    }
  };

  /** One selectable option row — radio affordance + label + number hint. */
  const OptionCard: React.FC<{
    selected: boolean;
    label: string;
    index: number;
    showHint: boolean;
    onSelect: () => void;
  }> = ({ selected, label, index, showHint, onSelect }) => (
    <button
      type="button"
      onClick={onSelect}
      className={clsx(
        'group flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-all',
        'focus:outline-none focus-visible:ring-2',
        selected ? 'shadow-sm' : 'border-theme bg-theme-input hover:bg-theme-hover',
      )}
      style={{
        ['--tw-ring-color' as any]: brandSoft(35),
        ...(selected ? { borderColor: 'var(--primary)', background: brandSoft(8) } : {}),
      }}
    >
      <span
        className={clsx(
          'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 transition-colors',
          selected ? 'border-transparent' : 'border-theme-muted/50 group-hover:border-theme-muted',
        )}
        style={selected ? { background: 'var(--primary)' } : undefined}
      >
        {selected && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
      </span>
      <span
        className={clsx('flex-1 text-[13px] leading-snug', selected ? 'font-semibold text-theme-fg' : 'text-theme-fg/90')}
      >
        {label}
      </span>
      {showHint && (
        <kbd className="shrink-0 rounded-md border border-theme/60 bg-theme-hover px-1.5 py-0.5 font-mono text-[10px] text-theme-muted">
          {index + 1}
        </kbd>
      )}
    </button>
  );

  return (
    <div
      ref={cardRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="mx-3 mb-2 overflow-hidden rounded-2xl border border-theme bg-theme-card shadow-lg outline-none animate-in slide-in-from-bottom-2 fade-in duration-200"
    >
      {/* Header */}
      <div className="flex items-start gap-2.5 px-3.5 pt-3 pb-2.5">
        <span
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px]"
          style={{ background: brandSoft(12), color: 'var(--primary)' }}
        >
          <MessagesSquare className="h-4 w-4" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-theme-fg">{normalized.title}</p>
          {normalized.description && (
            <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-theme-muted">{normalized.description}</p>
          )}
        </div>
        {totalPages > 1 && (
          <span className="mt-0.5 shrink-0 rounded-full bg-theme-hover px-2 py-0.5 text-[10px] font-bold tabular-nums text-theme-muted">
            {currentPageIndex + 1}/{totalPages}
          </span>
        )}
        <button
          onClick={dismiss}
          className="-mr-1 shrink-0 rounded-lg p-1 text-theme-muted transition-colors hover:bg-theme-hover hover:text-theme-fg"
          title="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Step progress */}
      {totalPages > 1 && (
        <div className="flex gap-1 px-3.5 pb-2.5">
          {normalized.pages.map((step, index) => (
            <div
              key={step.id}
              className="h-1 flex-1 overflow-hidden rounded-full bg-theme-hover"
            >
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: index < currentPageIndex ? '100%' : index === currentPageIndex ? '100%' : '0%',
                  background: index <= currentPageIndex ? 'var(--primary)' : 'transparent',
                }}
              />
            </div>
          ))}
        </div>
      )}

      {/* Body */}
      <div className="space-y-3 border-t border-theme px-3.5 py-3">
        {totalPages > 1 && page?.title && (
          <div>
            <p className="text-[13px] font-semibold text-theme-fg">{page.title}</p>
            {page.description && <p className="mt-0.5 text-[11.5px] text-theme-muted">{page.description}</p>}
          </div>
        )}

        {page?.questions.map((question, questionIndex) => {
          const answer = answers[question.id];
          const showHints = soloPickQuestion?.id === question.id;
          return (
            <div key={question.id} className={clsx(questionIndex > 0 && 'border-t border-theme pt-3')}>
              <p className="mb-2 text-[12.5px] font-medium leading-snug text-theme-fg">
                {question.message}
                {question.required && (
                  <span className="ml-1" style={{ color: 'var(--primary)' }}>
                    *
                  </span>
                )}
              </p>

              {question.type === 'confirm' && (
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { label: 'Yes', value: true },
                    { label: 'No', value: false },
                  ].map((choice, idx) => (
                    <OptionCard
                      key={choice.label}
                      selected={answer === choice.value}
                      label={choice.label}
                      index={idx}
                      showHint={showHints}
                      onSelect={() => pick(question, choice.value)}
                    />
                  ))}
                </div>
              )}

              {question.type === 'choices' && (
                <div className="space-y-1.5">
                  {question.options.map((option, idx) => (
                    <OptionCard
                      key={option.id}
                      selected={answer === option.id}
                      label={option.label}
                      index={idx}
                      showHint={showHints && idx < 9}
                      onSelect={() => pick(question, option.id)}
                    />
                  ))}
                </div>
              )}

              {question.type === 'text' && (
                <textarea
                  ref={questionIndex === 0 ? firstTextRef : undefined}
                  value={typeof answer === 'string' ? answer : ''}
                  onChange={(event) => setAnswer(question.id, event.target.value)}
                  placeholder={question.placeholder || 'Type your answer…'}
                  rows={2}
                  className="input-field w-full resize-y rounded-xl px-3 py-2 text-[13px] outline-none transition-shadow placeholder:text-theme-muted focus:ring-2"
                  style={{ ['--tw-ring-color' as any]: brandSoft(35) }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 border-t border-theme bg-theme-hover/30 px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          {currentPageIndex > 0 ? (
            <button
              type="button"
              onClick={() => setCurrentPageIndex((index) => Math.max(0, index - 1))}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11.5px] font-medium text-theme-muted transition-colors hover:bg-theme-hover hover:text-theme-fg"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              {normalized.backLabel}
            </button>
          ) : (
            <span className="hidden items-center gap-1 text-[10.5px] text-theme-muted/70 sm:inline-flex">
              <CornerDownLeft className="h-3 w-3" />
              {soloPickQuestion ? 'press 1–9 or' : ''} Enter to {isLastPage ? 'submit' : 'continue'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={dismiss}
            className="rounded-lg px-2.5 py-1.5 text-[11.5px] font-medium text-theme-muted transition-colors hover:bg-theme-hover hover:text-theme-fg"
          >
            {normalized.cancelLabel}
          </button>
          <button
            type="button"
            onClick={advance}
            disabled={!canContinue}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: 'var(--primary)' }}
          >
            {isLastPage ? <Send className="h-3.5 w-3.5" /> : null}
            {isLastPage ? normalized.submitLabel : normalized.nextLabel}
            {!isLastPage ? <ChevronRight className="h-3.5 w-3.5" /> : null}
          </button>
        </div>
      </div>
    </div>
  );
};
