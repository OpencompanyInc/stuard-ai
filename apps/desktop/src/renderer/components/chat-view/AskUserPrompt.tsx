import React, { useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { ChevronLeft, ChevronRight, Send, X } from 'lucide-react';
import { buildAskUserResult, isQuestionAnswered, normalizeAskUserPrompt } from './askUserPromptUtils';

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
  const singleQuestion = totalPages === 1 && (page?.questions.length ?? 0) === 1;

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

  const choiceBase = 'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors';
  const choiceIdle = 'bg-theme-input border-theme text-theme-fg hover:bg-theme-hover';
  const choiceSelected = 'border-transparent text-white';
  const choiceSelectedStyle: React.CSSProperties = { backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' };

  return (
    <div className="mx-3 mb-2 overflow-hidden rounded-xl border border-theme bg-theme-card animate-in slide-in-from-bottom-1 duration-150">
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-theme-fg">{normalized.title}</p>
          {normalized.description && (
            <p className="mt-0.5 line-clamp-2 text-[11px] text-theme-muted">{normalized.description}</p>
          )}
        </div>
        {totalPages > 1 && (
          <span className="shrink-0 text-[10px] uppercase tracking-wider text-theme-muted">
            {currentPageIndex + 1}/{totalPages}
          </span>
        )}
        <button
          onClick={dismiss}
          className="shrink-0 rounded-md p-1 text-theme-muted transition-colors hover:bg-theme-hover hover:text-theme-fg"
          title="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {totalPages > 1 && (
        <div className="flex gap-1 px-3 pb-2">
          {normalized.pages.map((step, index) => (
            <div
              key={step.id}
              className={clsx(
                'h-1 flex-1 rounded-full transition-colors',
                index <= currentPageIndex ? 'bg-primary' : 'bg-theme-hover',
              )}
            />
          ))}
        </div>
      )}

      <div className="space-y-2.5 border-t border-theme px-3 py-2.5">
        {totalPages > 1 && page?.title && (
          <div>
            <p className="text-xs font-semibold text-theme-fg">{page.title}</p>
            {page.description && <p className="mt-0.5 text-[11px] text-theme-muted">{page.description}</p>}
          </div>
        )}

        {page?.questions.map((question, questionIndex) => {
          const answer = answers[question.id];
          return (
            <div key={question.id} className={clsx(questionIndex > 0 && 'pt-2.5 border-t border-theme')}>
              <p className="text-xs font-medium text-theme-fg">
                {question.message}
                {question.required && <span className="ml-1 text-rose-500">*</span>}
              </p>

              {question.type === 'confirm' && (
                <div className="mt-2 flex flex-wrap gap-1.5">
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
                        className={clsx(choiceBase, selected ? choiceSelected : choiceIdle)}
                        style={selected ? choiceSelectedStyle : undefined}
                      >
                        {choice.label}
                      </button>
                    );
                  })}
                </div>
              )}

              {question.type === 'choices' && (
                <div className="mt-2 flex flex-wrap gap-1.5">
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
                        className={clsx(choiceBase, selected ? choiceSelected : choiceIdle)}
                        style={selected ? choiceSelectedStyle : undefined}
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
                  rows={singleQuestion ? 2 : 3}
                  className="input-field mt-2 w-full resize-y rounded-lg px-2.5 py-1.5 text-xs outline-none placeholder:text-theme-muted"
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-theme px-3 py-2">
        <div>
          {currentPageIndex > 0 && (
            <button
              type="button"
              onClick={() => setCurrentPageIndex((index) => Math.max(0, index - 1))}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-theme-muted transition-colors hover:bg-theme-hover hover:text-theme-fg"
            >
              <ChevronLeft className="h-3 w-3" />
              {normalized.backLabel}
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={dismiss}
            className="rounded-md px-2 py-1 text-[11px] font-medium text-theme-muted transition-colors hover:bg-theme-hover hover:text-theme-fg"
          >
            {normalized.cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => (isLastPage ? submit() : setCurrentPageIndex((index) => Math.min(totalPages - 1, index + 1)))}
            disabled={!canContinue}
            className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
            style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
          >
            {isLastPage ? <Send className="h-3 w-3" /> : null}
            {isLastPage ? normalized.submitLabel : normalized.nextLabel}
            {!isLastPage ? <ChevronRight className="h-3 w-3" /> : null}
          </button>
        </div>
      </div>
    </div>
  );
};
