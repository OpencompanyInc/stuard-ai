import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { execLocalTool, hasClientBridge } from './bridge';

// ── Full schemas (kept for backward compat / tests, NOT sent to LLM) ────────

const AskUserTypeSchema = z.enum(['confirm', 'choices', 'text']);

export const AskUserOptionSchema = z.object({ id: z.string(), label: z.string() });

export const AskUserQuestionSchema = z.object({
  id: z.string().optional(), title: z.string().optional(), description: z.string().optional(),
  message: z.string(), type: AskUserTypeSchema.optional().default('confirm'),
  options: z.array(AskUserOptionSchema).optional(), placeholder: z.string().optional(),
  required: z.boolean().optional().default(true),
});

export const AskUserPageSchema = z.object({
  id: z.string().optional(), title: z.string().optional(), description: z.string().optional(),
  questions: z.array(AskUserQuestionSchema).min(1),
});

export const AskUserResponseDetailSchema = z.object({
  id: z.string(), message: z.string(), type: AskUserTypeSchema,
  value: z.union([z.string(), z.boolean(), z.null()]).optional(),
  confirmed: z.boolean().optional(), selected: z.string().optional(),
  selectedLabel: z.string().optional(), text: z.string().optional(),
});

export const AskUserOutputSchema = z.object({
  ok: z.boolean(), confirmed: z.boolean().optional(), selected: z.string().optional(),
  selectedLabel: z.string().optional(), text: z.string().optional(),
  dismissed: z.boolean().optional(),
  answers: z.record(z.string(), AskUserResponseDetailSchema).optional(),
  responses: z.array(AskUserResponseDetailSchema).optional(),
  error: z.string().optional(),
});

// ── Lean schema sent to LLM (flat, no nesting → ~300 tok vs ~5200 tok) ──────

export const AskUserInputSchema = z.object({
  title: z.string().optional(),
  message: z.string().optional(),
  type: z.enum(['confirm', 'choices', 'text']).optional(),
  options: z.array(z.object({ id: z.string(), label: z.string() })).optional(),
  placeholder: z.string().optional(),
  pages: z.array(AskUserPageSchema).min(1).optional(),
}).refine(
  (value) => Boolean(value.message) || Boolean(value.pages?.length),
  { message: 'ask_user requires either a message or at least one page' },
);

export const ask_user = createTool({
  id: 'ask_user',
  description:
    'Ask the user a question. confirm=yes/no, choices=pick from options, text=free input. Required before destructive actions.',
  inputSchema: AskUserInputSchema,
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
