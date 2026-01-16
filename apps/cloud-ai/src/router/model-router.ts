import { z } from 'zod';
import { generateObject } from 'ai';
import { buildProviderModel } from '../utils/models';
import { getDefaultModelForCategory } from '../pricing';

const ROUTER_VERBOSE = process.env.ROUTER_VERBOSE !== '0' && process.env.ROUTER_VERBOSE !== 'false';

export type ModelChoice = 'fast' | 'balanced' | 'smart' | 'research';

const MODEL_CHOICES: readonly ModelChoice[] = ['fast', 'balanced', 'smart', 'research'] as const;

// High-level slices of user/context memory that can be retrieved for a request.
export type MemoryLayer =
  | 'user_profile'
  | 'preferences'
  | 'ongoing_work'
  | 'recent_conversation'
  | 'tool_history'
  | 'workflow_habits'
  | 'schedule_availability'
  | 'files_and_docs';

const MEMORY_LAYERS: readonly MemoryLayer[] = [
  'user_profile',
  'preferences',
  'ongoing_work',
  'recent_conversation',
  'tool_history',
  'workflow_habits',
  'schedule_availability',
  'files_and_docs',
] as const;

// Schema for LLM routing response
const RouterResponseSchema = z.object({
  // Use short keys + numeric indexes to minimize router output tokens.
  m: z
    .number()
    .int()
    .min(0)
    .max(MODEL_CHOICES.length - 1)
    .describe('Model index: 0=fast, 1=balanced, 2=smart, 3=research'),
  l: z
    .array(z.number().int().min(0).max(MEMORY_LAYERS.length - 1))
    .optional()
    .default([])
    .describe('Memory layer indexes (0..7). Keep it small; max 4 unique.'),
});

interface RouterContext {
  messages: Array<{ role: string; content: string }>;
  contextSize?: number;
  hasAttachments?: boolean;
  recentTools?: string[];
}

const ROUTER_SYSTEM_PROMPT = `Route the request.

Return ONLY JSON matching the schema.

m = model index:
0 fast (default)
1 balanced
2 smart
3 research (use for web research, fact-checking, current events, citations needed)

l = memory layer indexes (0..7), pick only what's needed, max 4 unique.

Rules:
- Default m=0.
- If user message is extremely short/low-info (e.g. 1-5 word opener), MUST use m=0.
- Use m=2 only for clearly complex multi-step reasoning / big code generation.
- Use m=3 (research) when user needs current information, web search, fact verification, or research with sources.`;

/**
 * Route to a model tier and select which memory categories are needed.
 * Uses Gemini 2.5 Flash for fast, intelligent routing.
 */
export async function routeModel(
  ctx: RouterContext
): Promise<{ model: ModelChoice; memoryLayers: MemoryLayer[]; modelIndex: number; layerIndexes: number[] }> {
  const lastUserMsg = ctx.messages.filter((m) => m.role === 'user').slice(-1)[0]?.content || '';
  const messageLength = lastUserMsg.length;
  const hasAttachments = ctx.hasAttachments;
  const recentTools = ctx.recentTools || [];
  const contextSize = ctx.contextSize || 0;
  const messageCount = ctx.messages.length;

  try {
    const contextSummary = [
      `len=${messageLength}`,
      `turns=${messageCount}`,
      `att=${hasAttachments ? 1 : 0}`,
      `tools=${recentTools.length > 0 ? recentTools.join(',') : '-'}`,
      `ctx=${contextSize}`,
    ].join('\n');

    const routingModelId = getDefaultModelForCategory('fast');
    const routingModel = buildProviderModel(routingModelId);

    const result = await generateObject({
      model: routingModel,
      schema: RouterResponseSchema,
      system: ROUTER_SYSTEM_PROMPT,
      prompt: `c:\n${contextSummary}\n\nu:\n${lastUserMsg}`,
      temperature: 0,
      providerOptions: {
        google: {
          // Explicitly disable thinking for faster routing
          thinkingConfig: { includeThoughts: false },
        },
      },
    });

    const { m, l } = result.object;
    const modelIndex = Number.isInteger(m) ? m : 1;
    const model = MODEL_CHOICES[modelIndex] ?? 'balanced';

    const rawLayerIndexes = Array.isArray(l) ? l : [];
    const layerIndexes = Array.from(new Set(rawLayerIndexes))
      .filter((idx) => Number.isInteger(idx) && idx >= 0 && idx < MEMORY_LAYERS.length)
      .slice(0, 4);
    const memoryLayers = layerIndexes.map((idx) => MEMORY_LAYERS[idx]) as MemoryLayer[];

    if (ROUTER_VERBOSE) {
      console.log(
        `[router] LLM routing (gemini-2.5-flash): m=${modelIndex}, l=${layerIndexes.join(',')}`
      );
    }

    return { model, memoryLayers, modelIndex, layerIndexes };
  } catch (error) {
    console.error('[router] LLM routing failed:', error);
    // Fallback to balanced if LLM routing fails
    return {
      model: 'balanced',
      memoryLayers: ['user_profile', 'preferences', 'recent_conversation'],
      modelIndex: 1,
      layerIndexes: [0, 1, 3],
    };
  }
}
