import { z } from 'zod';
import { makeLocalTool } from './device/shared';

/**
 * Bot's private kanban + run-log tools.
 *
 * These are scoped to the *currently running bot* (the desktop scheduler
 * sets ctx.proactiveBotId before dispatch). Cards and run-log entries
 * persisted here survive across runs and are surfaced both in the bot's
 * system prompt (kanban + recent runs) and in the Kanban tab of BotsView.
 *
 * This is intentionally distinct from `proactive_task_*`, which manages
 * the user's task board. Treat `bot_memory_*` as your own working memory:
 * what you're planning, what you tried, what worked, what to revisit.
 */

const cardStatusEnum = z.enum(['queued', 'in_progress', 'completed', 'failed']);

const cardSchema = z.object({
  id: z.string(),
  title: z.string(),
  notes: z.string().optional(),
  status: cardStatusEnum,
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable().optional(),
  lastEditedBy: z.enum(['bot', 'user']),
});

const runLogSchema = z.object({
  id: z.string(),
  at: z.string(),
  summary: z.string(),
  outcome: z.enum(['success', 'partial', 'failed']),
  cardIds: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

const listOutput = z.object({
  ok: z.boolean(),
  cards: z.array(cardSchema).optional(),
  error: z.string().optional(),
});

const cardOutput = z.object({
  ok: z.boolean(),
  card: cardSchema.optional(),
  error: z.string().optional(),
});

const deleteOutput = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
});

const logOutput = z.object({
  ok: z.boolean(),
  entry: runLogSchema.optional(),
  error: z.string().optional(),
});

export const bot_memory_list = makeLocalTool(
  'bot_memory_list',
  'List the cards on YOUR private kanban (your working memory across runs). Optionally filter by status. These are your own notes — separate from the user\'s task board (use proactive_task_list for that).',
  z.object({
    status: cardStatusEnum.optional().describe('Filter to one column (queued, in_progress, completed, failed). Omit for all.'),
  }),
  listOutput,
  15000,
  { noFallback: true },
);

export const bot_memory_create = makeLocalTool(
  'bot_memory_create',
  'Add a card to YOUR private kanban. Use this to capture an intent ("queued"), something you\'re actively doing ("in_progress"), or a finished outcome ("completed"). Notes can hold context your future self should see (URLs, decisions, what to retry).',
  z.object({
    title: z.string().min(1).describe('Short, scannable title (one line).'),
    notes: z.string().optional().describe('Longer context — what you tried, what you decided, links, etc. Optional.'),
    status: cardStatusEnum.optional().default('queued').describe('Defaults to "queued".'),
  }),
  cardOutput,
  15000,
  { noFallback: true },
);

export const bot_memory_update = makeLocalTool(
  'bot_memory_update',
  'Update one of YOUR private kanban cards — change its status (move between columns), edit its title, or append notes. Use this when you finish something, decide to retry, or learn something new about an in-progress card.',
  z.object({
    id: z.string().min(1).describe('The card id from bot_memory_list.'),
    title: z.string().optional(),
    notes: z.string().optional().describe('Replaces existing notes. Pre-pend the existing notes if you want to append.'),
    status: cardStatusEnum.optional(),
  }),
  cardOutput,
  15000,
  { noFallback: true },
);

export const bot_memory_delete = makeLocalTool(
  'bot_memory_delete',
  'Remove a card from YOUR private kanban. Use sparingly — usually mark cards "completed" instead so the history is preserved.',
  z.object({
    id: z.string().min(1),
  }),
  deleteOutput,
  10000,
  { noFallback: true },
);

export const bot_memory_log = makeLocalTool(
  'bot_memory_log',
  'Append an entry to YOUR private run log so the next run can see what just happened. The scheduler auto-logs a brief outcome line — call this only when you want a richer entry (e.g. "tried X, X failed because Y, will try Z next run"). One call per run is plenty.',
  z.object({
    summary: z.string().min(1).describe('One-line "what happened this run" — keep it short and useful.'),
    outcome: z.enum(['success', 'partial', 'failed']).optional().default('success'),
    cardIds: z.array(z.string()).optional().describe('Card ids touched this run.'),
    notes: z.string().optional().describe('Optional richer context for your future self.'),
  }),
  logOutput,
  10000,
  { noFallback: true },
);
