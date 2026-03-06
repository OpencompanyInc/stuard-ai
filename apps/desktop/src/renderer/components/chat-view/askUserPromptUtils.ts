export type AskUserQuestionType = 'confirm' | 'choices' | 'text';

export interface AskUserOption {
  id: string;
  label: string;
}

export interface NormalizedAskUserQuestion {
  id: string;
  message: string;
  type: AskUserQuestionType;
  options: AskUserOption[];
  placeholder?: string;
  required: boolean;
}

export interface NormalizedAskUserPage {
  id: string;
  title: string;
  description?: string;
  questions: NormalizedAskUserQuestion[];
}

export interface NormalizedAskUserPrompt {
  title: string;
  description?: string;
  submitLabel: string;
  cancelLabel: string;
  nextLabel: string;
  backLabel: string;
  pages: NormalizedAskUserPage[];
  isLegacySingle: boolean;
}

const QUESTION_TYPES = new Set<AskUserQuestionType>(['confirm', 'choices', 'text']);
const CHOICE_TYPES = new Set(['choice', 'choices', 'select', 'radio', 'single_select', 'multiselect']);
const TEXT_TYPES = new Set(['text', 'textarea', 'input', 'string', 'email']);
const CONFIRM_TYPES = new Set(['confirm', 'toggle', 'boolean', 'bool', 'yesno', 'switch']);

const trim = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

function normalizeOptions(value: unknown): AskUserOption[] {
  return Array.isArray(value)
    ? value
      .map((option: any, index) => {
        if (typeof option === 'string') {
          const label = trim(option);
          return label ? { id: label, label } : null;
        }
        const id = trim(option?.id) || trim(option?.value) || trim(option?.key) || `option_${index + 1}`;
        const label = trim(option?.label) || trim(option?.title) || trim(option?.name) || trim(option?.text) || id;
        return id && label ? { id, label } : null;
      })
      .filter((option): option is AskUserOption => !!option)
    : [];
}

function inferQuestionType(value: any, options: AskUserOption[]): AskUserQuestionType {
  const rawType = trim(value?.type || value?.fieldType || value?.inputType).toLowerCase();
  if (QUESTION_TYPES.has(rawType as AskUserQuestionType)) return rawType as AskUserQuestionType;
  if (CHOICE_TYPES.has(rawType) || options.length > 0) return 'choices';
  if (TEXT_TYPES.has(rawType) || trim(value?.placeholder) || trim(value?.defaultValue)) return 'text';
  if (CONFIRM_TYPES.has(rawType)) return 'confirm';
  return 'text';
}

function normalizeQuestion(value: any, index: number): NormalizedAskUserQuestion | null {
  const message = trim(value?.message) || trim(value?.label) || trim(value?.prompt) || trim(value?.question) || trim(value?.title) || trim(value?.name);
  if (!message) return null;
  const options = normalizeOptions(value?.options || value?.choices || value?.items || value?.values);
  return {
    id: trim(value?.id) || trim(value?.key) || `question_${index + 1}`,
    message,
    type: inferQuestionType(value, options),
    options,
    placeholder: trim(value?.placeholder) || undefined,
    required: value?.required !== false,
  };
}

function normalizePageQuestions(page: any): NormalizedAskUserQuestion[] {
  const sourceQuestions =
    (Array.isArray(page?.questions) && page.questions) ||
    (Array.isArray(page?.fields) && page.fields) ||
    (Array.isArray(page?.items) && page.items) ||
    [];

  return sourceQuestions
    .map((question: any, questionIndex: number) => normalizeQuestion(question, questionIndex))
    .filter((question: NormalizedAskUserQuestion | null): question is NormalizedAskUserQuestion => !!question);
}

export function normalizeAskUserPrompt(args: any): NormalizedAskUserPrompt {
  const hasPages = Array.isArray(args?.pages) && args.pages.length > 0;
  const topLevelQuestions =
    (Array.isArray(args?.questions) && args.questions) ||
    (Array.isArray(args?.fields) && args.fields) ||
    (Array.isArray(args?.items) && args.items) ||
    [];
  const hasQuestions = topLevelQuestions.length > 0;
  const multiIntro = trim(args?.description) || trim(args?.message) || undefined;
  let pages: NormalizedAskUserPage[] = [];
  let isLegacySingle = false;

  if (hasPages) {
    pages = args.pages
      .map((page: any, pageIndex: number) => {
        const questions = normalizePageQuestions(page);
        if (!questions.length) return null;
        return {
          id: trim(page?.id) || `page_${pageIndex + 1}`,
          title: trim(page?.title) || trim(page?.label) || trim(page?.prompt) || trim(page?.question) || `Page ${pageIndex + 1}`,
          description: trim(page?.description) || trim(page?.helperText) || undefined,
          questions,
        };
      })
      .filter((page: NormalizedAskUserPage | null): page is NormalizedAskUserPage => !!page);
  } else if (hasQuestions) {
    pages = topLevelQuestions
      .map((question: any, index: number) => {
        const normalizedQuestion = normalizeQuestion(question, index);
        if (!normalizedQuestion) return null;
        return {
          id: `page_${index + 1}`,
          title: trim(question?.title) || trim(question?.label) || trim(question?.prompt) || trim(question?.question) || `Question ${index + 1}`,
          description: trim(question?.description) || trim(question?.helperText) || undefined,
          questions: [normalizedQuestion],
        };
      })
      .filter((page: NormalizedAskUserPage | null): page is NormalizedAskUserPage => !!page);
  }

  if (!pages.length) {
    const question = normalizeQuestion(args, 0) || {
      id: 'question_1',
      message: 'The agent has a question for you.',
      type: 'confirm' as const,
      options: [],
      placeholder: undefined,
      required: true,
    };
    pages = [{ id: 'page_1', title: 'Question', description: undefined, questions: [question] }];
    isLegacySingle = true;
  }

  const title = trim(args?.title) || (pages.length > 1 || pages[0]?.questions.length > 1 ? 'Questions from Stuard' : 'Question from Stuard');
  return {
    title,
    description: isLegacySingle ? trim(args?.description) || undefined : multiIntro,
    submitLabel: trim(args?.submitLabel) || 'Submit',
    cancelLabel: trim(args?.cancelLabel) || 'Cancel',
    nextLabel: trim(args?.nextLabel) || 'Next',
    backLabel: trim(args?.backLabel) || 'Back',
    pages,
    isLegacySingle,
  };
}

export function isQuestionAnswered(question: NormalizedAskUserQuestion, value: unknown): boolean {
  if (!question.required) return true;
  if (question.type === 'confirm') return typeof value === 'boolean';
  if (question.type === 'choices') return trim(value).length > 0;
  return trim(value).length > 0;
}

export function buildAskUserResult(prompt: NormalizedAskUserPrompt, answers: Record<string, unknown>) {
  const responses = prompt.pages.flatMap((page) => page.questions.map((question) => {
    const value = answers[question.id];
    if (question.type === 'confirm') {
      return { id: question.id, message: question.message, type: question.type, value: !!value, confirmed: !!value };
    }
    if (question.type === 'choices') {
      const selected = trim(value);
      const selectedLabel = question.options.find((option) => option.id === selected)?.label;
      return { id: question.id, message: question.message, type: question.type, value: selected, selected, selectedLabel };
    }
    const text = trim(value);
    return { id: question.id, message: question.message, type: question.type, value: text, text };
  }));

  const answersById = Object.fromEntries(responses.map((response) => [response.id, response]));
  if (prompt.isLegacySingle && responses.length === 1) {
    return { ok: true, dismissed: false, ...responses[0], answers: answersById, responses };
  }
  return { ok: true, dismissed: false, answers: answersById, responses };
}