import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { execLocalTool, hasClientBridge } from './bridge';

const AskUserTypeSchema = z.enum(['confirm', 'choices', 'text']);

export const AskUserOptionSchema = z.object({
  id: z.string().describe('Value returned when selected'),
  label: z.string().describe('Display label'),
});

export const AskUserQuestionSchema = z.object({
  id: z.string().optional().describe('Stable identifier for the answer payload'),
  title: z.string().optional().describe('Optional page title when using the top-level questions array'),
  description: z.string().optional().describe('Optional helper text for this question page'),
  message: z.string().describe('The question or message to show the user'),
  type: AskUserTypeSchema.optional().default('confirm')
    .describe('confirm = yes/no buttons, choices = pick from options, text = free text input'),
  options: z.array(AskUserOptionSchema).optional().describe('Options for "choices" type'),
  placeholder: z.string().optional().describe('Placeholder for "text" type input'),
  required: z.boolean().optional().default(true).describe('Whether the user must answer before continuing'),
});

export const AskUserPageSchema = z.object({
  id: z.string().optional().describe('Stable identifier for the page'),
  title: z.string().optional().describe('Page title shown in the questionnaire UI'),
  description: z.string().optional().describe('Page description shown below the title'),
  questions: z.array(AskUserQuestionSchema).min(1).describe('Questions to show on this page'),
});

export const AskUserResponseDetailSchema = z.object({
  id: z.string(),
  message: z.string(),
  type: AskUserTypeSchema,
  value: z.union([z.string(), z.boolean(), z.null()]).optional(),
  confirmed: z.boolean().optional(),
  selected: z.string().optional(),
  selectedLabel: z.string().optional(),
  text: z.string().optional(),
});

export const AskUserInputSchema = z.object({
  title: z.string().optional().describe('Optional title for the questionnaire card'),
  description: z.string().optional().describe('Optional helper text shown below the title'),
  submitLabel: z.string().optional().describe('Label for the final submit button'),
  cancelLabel: z.string().optional().describe('Label for the cancel button'),
  nextLabel: z.string().optional().describe('Label for the next-page button'),
  backLabel: z.string().optional().describe('Label for the previous-page button'),
  message: z.string().optional().describe('Legacy single-question prompt text, or intro text for multi-step prompts'),
  type: AskUserTypeSchema.optional().default('confirm')
    .describe('Legacy single-question type: confirm = yes/no, choices = pick from options, text = free text input'),
  options: z.array(AskUserOptionSchema).optional().describe('Legacy options for "choices" type'),
  placeholder: z.string().optional().describe('Legacy placeholder for "text" type input'),
  questions: z.array(AskUserQuestionSchema).optional().describe('Multi-question flow; each question becomes its own page'),
  pages: z.array(AskUserPageSchema).optional().describe('Explicit multi-page questionnaire definition'),
}).superRefine((value, ctx) => {
  const hasMessage = typeof value.message === 'string' && value.message.trim().length > 0;
  const hasQuestions = Array.isArray(value.questions) && value.questions.length > 0;
  const hasPages = Array.isArray(value.pages) && value.pages.length > 0;
  if (!hasMessage && !hasQuestions && !hasPages) {
    ctx.addIssue({ code: 'custom', message: 'Provide message, questions, or pages.' });
  }
});

export const AskUserOutputSchema = z.object({
  ok: z.boolean(),
  confirmed: z.boolean().optional().describe('For confirm type: true if user confirmed'),
  selected: z.string().optional().describe('For choices type: the selected option id'),
  selectedLabel: z.string().optional().describe('For choices type: the selected option label'),
  text: z.string().optional().describe('For text type: what the user typed'),
  dismissed: z.boolean().optional().describe('True if user dismissed/cancelled without answering'),
  answers: z.record(z.string(), AskUserResponseDetailSchema).optional().describe('Combined answers keyed by question id'),
  responses: z.array(AskUserResponseDetailSchema).optional().describe('Combined answers in display order'),
  error: z.string().optional(),
});

/**
 * ask_user — a single tool the agent calls to ask the user a question.
 *
 * Supports three modes:
 *   - confirm: Yes / No buttons
 *   - choices: Pick from a list of options
 *   - text: Free-text input
 * It can also render paged questionnaires with multiple questions and a final submit.
 *
 * This is NOT a GenUI display tool. It's a real tool call that blocks
 * until the user responds and returns the answer to the model.
 */
export const ask_user = createTool({
  id: 'ask_user',
  description:
    'Ask the user a question and wait for their response. ' +
    'Use "confirm" for yes/no decisions, "choices" to pick from options, or "text" for free input. ' +
    'For multi-step forms, provide "questions" or "pages" and wait for the final combined submit. ' +
    'ALWAYS use this before destructive actions (deleting files, overwriting data, etc.).',
  inputSchema: AskUserInputSchema,
  outputSchema: AskUserOutputSchema,
  execute: async (args) => {
    if (hasClientBridge()) {
      try {
        const result = await execLocalTool('ask_user', args, undefined, 300000);
        return result as any;
      } catch (err: any) {
        return { ok: false, dismissed: true, error: err.message || 'ask_user failed' } as any;
      }
    }
    // No client connected — can't ask
    return { ok: false, dismissed: true, error: 'No client connected to show the question.' } as any;
  },
});
