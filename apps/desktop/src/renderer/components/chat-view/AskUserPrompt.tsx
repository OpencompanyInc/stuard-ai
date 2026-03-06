import React, { useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { Check, ChevronLeft, ChevronRight, MessageCircleQuestion, Send, X } from 'lucide-react';
import { buildAskUserResult, isQuestionAnswered, normalizeAskUserPrompt } from './askUserPromptUtils';

const panelStyle: React.CSSProperties = {
  backgroundColor: 'color-mix(in srgb, var(--card-bg) 88%, var(--foreground) 8%)',
  borderColor: 'color-mix(in srgb, var(--border) 82%, var(--foreground) 18%)',
};

const surfaceStyle: React.CSSProperties = {
  backgroundColor: 'color-mix(in srgb, var(--input-bg) 84%, var(--foreground) 8%)',
  borderColor: 'color-mix(in srgb, var(--border) 78%, var(--foreground) 22%)',
  color: 'var(--foreground)',
};

const selectedStyle: React.CSSProperties = {
  backgroundColor: 'var(--primary)',
  borderColor: 'var(--primary)',
  color: 'var(--primary-foreground)',
};

const iconStyle: React.CSSProperties = {
  backgroundColor: 'color-mix(in srgb, var(--primary) 18%, transparent)',
  color: 'var(--primary)',
};

export const AskUserPrompt: React.FC<{
  prompt: { id: string; args: any };
  onRespond: (id: string, result: any) => void;
}> = ({ prompt, onRespond }) => {
  const normalized = useMemo(() => normalizeAskUserPrompt(prompt.args), [prompt.args]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const firstTextRef = useRef<HTMLTextAreaElement | null>(null);
  const page = normalized.pages[currentPageIndex];
  const totalPages = normalized.pages.length;

  useEffect(() => {
    firstTextRef.current?.focus();
  }, [currentPageIndex]);

  const setAnswer = (questionId: string, value: unknown) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  };

  const submit = (nextAnswers = answers) => onRespond(prompt.id, buildAskUserResult(normalized, nextAnswers));
  const dismiss = () => onRespond(prompt.id, { ok: false, dismissed: true });
  const canContinue = page?.questions.every((question) => isQuestionAnswered(question, answers[question.id])) ?? false;
  const isLastPage = currentPageIndex === totalPages - 1;

  return (
    <div className="mx-3 mb-2 overflow-hidden rounded-2xl border shadow-sm backdrop-blur-sm animate-in slide-in-from-bottom-2 duration-200" style={panelStyle}>
      <div className="flex items-start gap-3 border-b border-theme px-4 py-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={iconStyle}>
          <MessageCircleQuestion className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-theme-fg">{normalized.title}</p>
              {normalized.description && <p className="mt-1 text-xs text-theme-muted">{normalized.description}</p>}
            </div>
            <button onClick={dismiss} className="rounded-lg p-1.5 text-theme-muted transition-colors hover:bg-theme-hover hover:text-theme-fg" title="Dismiss">
              <X className="h-4 w-4" />
            </button>
          </div>
          {totalPages > 1 && (
            <div className="mt-3 space-y-1.5">
              <div className="flex gap-1.5">
                {normalized.pages.map((step, index) => (
                  <div key={step.id} className={clsx('h-1.5 flex-1 rounded-full', index <= currentPageIndex ? 'bg-primary' : 'bg-theme-hover')} />
                ))}
              </div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-theme-muted">Step {currentPageIndex + 1} of {totalPages}</p>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-3 px-4 py-4">
        {totalPages > 1 && (
          <div>
            <p className="text-xs font-semibold text-theme-fg">{page?.title}</p>
            {page?.description && <p className="mt-1 text-xs text-theme-muted">{page.description}</p>}
          </div>
        )}

        {page?.questions.map((question, questionIndex) => {
          const answer = answers[question.id];
          return (
            <div key={question.id} className="rounded-xl border p-3" style={surfaceStyle}>
              <p className="text-sm font-medium text-theme-fg">
                {question.message}
                {question.required && <span className="ml-1 text-rose-500">*</span>}
              </p>

              {question.type === 'confirm' && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {[
                    { label: 'Yes', value: true },
                    { label: 'No', value: false },
                  ].map((choice) => {
                    const selected = answer === choice.value;
                    return (
                      <button
                        key={choice.label}
                        type="button"
                        onClick={() => {
                          const nextAnswers = { ...answers, [question.id]: choice.value };
                          setAnswer(question.id, choice.value);
                          if (normalized.isLegacySingle) submit(nextAnswers);
                        }}
                        className="rounded-xl border px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90"
                        style={selected ? selectedStyle : surfaceStyle}
                      >
                        {selected && choice.value ? <Check className="mr-1 inline h-3.5 w-3.5" /> : null}
                        {choice.label}
                      </button>
                    );
                  })}
                </div>
              )}

              {question.type === 'choices' && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {question.options.map((option) => {
                    const selected = answer === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => {
                          const nextAnswers = { ...answers, [question.id]: option.id };
                          setAnswer(question.id, option.id);
                          if (normalized.isLegacySingle) submit(nextAnswers);
                        }}
                        className="rounded-xl border px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90"
                        style={selected ? selectedStyle : surfaceStyle}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              )}

              {question.type === 'text' && (
                <textarea
                  ref={questionIndex === 0 ? firstTextRef : undefined}
                  value={typeof answer === 'string' ? answer : ''}
                  onChange={(event) => setAnswer(question.id, event.target.value)}
                  placeholder={question.placeholder || 'Type your answer…'}
                  rows={3}
                  className="mt-3 w-full resize-y rounded-xl border px-3 py-2 text-sm outline-none transition-shadow placeholder:opacity-60"
                  style={surfaceStyle}
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-theme px-4 py-3">
        <div>
          {currentPageIndex > 0 && (
            <button type="button" onClick={() => setCurrentPageIndex((index) => Math.max(0, index - 1))} className="inline-flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-medium text-theme-muted transition-colors hover:bg-theme-hover hover:text-theme-fg">
              <ChevronLeft className="h-3.5 w-3.5" />
              {normalized.backLabel}
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button type="button" onClick={dismiss} className="rounded-xl border border-theme px-3 py-2 text-xs font-medium text-theme-muted transition-colors hover:bg-theme-hover hover:text-theme-fg">
            {normalized.cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => (isLastPage ? submit() : setCurrentPageIndex((index) => Math.min(totalPages - 1, index + 1)))}
            disabled={!canContinue}
            className="inline-flex items-center gap-1 rounded-xl px-4 py-2 text-xs font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
            style={selectedStyle}
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