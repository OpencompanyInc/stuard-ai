/**
 * Delegation Tools
 *
 * Single unified `delegate` tool for routing work to any subagent by name,
 * plus `reply_to_subagent` for answering subagent questions mid-execution.
 *
 * When a subagent calls ask_orchestrator, the delegate tool returns EARLY
 * with the question (freeing the orchestrator to process it). The subagent
 * keeps running in the background. The orchestrator answers via
 * reply_to_subagent, which waits for the subagent to either complete or
 * ask another question.
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { runSubagent } from './subagent-runtime';
import { writeLog } from '../utils/logger';
import { KNOWN_SUBAGENT_NAMES, type SubagentName } from './capability-packs';
import type { DelegationResult, SubagentQuestion, SubagentAnswer } from './types';
import { getBridgeWs, getBridgeSecrets, withClientBridge } from '../tools/bridge';

// ─── Background subagent coordination ────────────────────────────────────────

interface SubagentCoordinator {
  subagentId: string;
  resultPromise: Promise<DelegationResult>;
  questionPromise: Promise<SubagentQuestion>;
  questionResolve: (q: SubagentQuestion) => void;
  answerResolvers: Map<string, { resolve: (answer: string) => void }>;
  /** True while a question is pending and hasn't been answered yet */
  questionPending: boolean;
}

const activeCoordinators = new Map<string, SubagentCoordinator>();

/** Secondary index: subagentId → { questionId, coordinator } for fallback lookup */
const coordinatorsBySubagent = new Map<string, { questionId: string; coordinator: SubagentCoordinator }>();

/** Cache of recently answered questions — prevents double-reply errors when the LLM calls reply_to_subagent twice */
const answeredCache = new Map<string, any>();


function createQuestionSignal() {
  let resolve!: (q: SubagentQuestion) => void;
  const promise = new Promise<SubagentQuestion>(r => { resolve = r; });
  return { promise, resolve };
}

function resetQuestionSignal(coord: SubagentCoordinator) {
  const sig = createQuestionSignal();
  coord.questionPromise = sig.promise;
  coord.questionResolve = sig.resolve;
}

async function raceCompletionOrQuestion(coord: SubagentCoordinator): Promise<
  | { type: 'completed'; result: DelegationResult }
  | { type: 'question'; question: SubagentQuestion }
> {
  return Promise.race([
    coord.resultPromise
      .then(result => ({ type: 'completed' as const, result }))
      .catch(err => ({
        type: 'completed' as const,
        result: {
          ok: false,
          subagentId: coord.subagentId,
          error: err?.message || 'Subagent failed',
          durationMs: 0,
        } as DelegationResult,
      })),
    coord.questionPromise.then(question => ({ type: 'question' as const, question })),
  ]);
}

function buildCompletionResponse(result: DelegationResult) {
  return {
    ok: result.ok,
    subagentId: result.subagentId,
    result: result.result,
    error: result.error,
    durationMs: result.durationMs,
    completed: true,
    awaitingReply: false,
  };
}

function buildQuestionResponse(question: SubagentQuestion) {
  return {
    ok: true,
    subagentId: question.subagentId,
    questionId: question.questionId,
    result: `[QUESTION from subagent] ${question.question}`,
    question: {
      questionId: question.questionId,
      question: question.question,
      choices: question.choices,
    },
    completed: false,
    awaitingReply: true,
  };
}

// ─── The one delegation tool ─────────────────────────────────────────────────

export const delegate = createTool({
  id: 'delegate',
  description:
    'Delegate a task to a specialized subagent by name.\n' +
    'Available subagents:\n' +
    '  browser     — web browsing, form filling, page scraping, screenshots\n' +
    '  file_ops    — reading/writing files, code editing, terminal, commands\n' +
    '  workflow    — creating/modifying/testing StuardAI automation workflows\n' +
    '  google      — Gmail, Calendar, Drive, Sheets, Docs, Tasks\n' +
    '  outlook     — Outlook mail & calendar\n' +
    '  github      — repos, issues, PRs, branches, actions\n' +
    '  meta        — Facebook, Instagram, Threads\n' +
    '  whatsapp    — WhatsApp messaging\n' +
    '  telnyx      — SMS, voice calls\n' +
    '  reddit      — subreddits, posts, comments\n' +
    '  discord     — Discord bot operations\n' +
    'The subagent can ask you questions mid-task via ask_orchestrator. When that happens, ' +
    'this tool returns early with the question and a top-level questionId field. Pass that exact questionId to ' +
    'reply_to_subagent to answer, which will then wait for the subagent to either finish or ask another question.',
  inputSchema: z.object({
    subagent: z
      .string()
      .describe('Name of the subagent to delegate to (e.g. "browser", "file_ops", "google").'),
    instruction: z
      .string()
      .describe('Detailed instruction describing what the subagent should do.'),
    context: z
      .string()
      .optional()
      .describe('Additional context (conversation history, IDs, user preferences).'),
    timeoutMs: z
      .number()
      .optional()
      .describe('Timeout in milliseconds (uses subagent default if omitted).'),
  }),
  execute: async ({ subagent, instruction, context, timeoutMs }) => {
    const name = subagent.trim().toLowerCase() as SubagentName;

    if (!KNOWN_SUBAGENT_NAMES.includes(name as any)) {
      return {
        ok: false,
        error: `Unknown subagent "${subagent}". Valid names: ${KNOWN_SUBAGENT_NAMES.join(', ')}`,
      };
    }

    const bridgeWs = getBridgeWs();
    const bridgeSecrets = getBridgeSecrets();
    const parentModelTier = bridgeSecrets?.__modelTier as string | undefined;
    const parentModelId = bridgeSecrets?.__modelId as string | undefined;
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const isIntegration = !['browser', 'file_ops', 'workflow'].includes(name);
    const kind = isIntegration ? 'integration' as const : name as 'browser' | 'file_ops' | 'workflow';

    writeLog('delegate_start', {
      subagent: name,
      instruction: instruction.slice(0, 200),
      hasBridge: !!bridgeWs,
      parentModelTier,
      parentModelId,
    });

    // Set up coordinator for question/answer flow between subagent and orchestrator
    const sig = createQuestionSignal();
    const coordinator: SubagentCoordinator = {
      subagentId: '',
      resultPromise: null as any,
      questionPromise: sig.promise,
      questionResolve: sig.resolve,
      answerResolvers: new Map(),
      questionPending: false,
    };

    const onQuestion = async (question: SubagentQuestion): Promise<SubagentAnswer> => {
      // Duplicate calls should already be caught at the subagent-side
      // (makeAskOrchestratorTool shares its pending promise). Safety net:
      // if a duplicate somehow reaches here, block it on the same answer
      // resolver so it also receives the orchestrator's answer.
      if (coordinator.questionPending) {
        writeLog('delegate_question_duplicate_blocking', {
          subagent: name,
          questionId: question.questionId,
        });
        return new Promise<SubagentAnswer>((resolve) => {
          coordinator.answerResolvers.set(question.questionId, {
            resolve: (answer: string) => {
              resolve({
                type: 'subagent_answer',
                questionId: question.questionId,
                subagentId: question.subagentId,
                runId: question.runId,
                answer,
              });
            },
          });
        });
      }

      coordinator.subagentId = question.subagentId;
      coordinator.questionPending = true;

      writeLog('delegate_question_to_orchestrator', {
        subagent: name,
        questionId: question.questionId,
        question: question.question,
      });

      // Signal the delegate tool (or reply_to_subagent) that a question arrived
      coordinator.questionResolve(question);

      // Block here until the orchestrator answers via reply_to_subagent.
      // No timeout — the overall subagent timeout in runSubagent is the
      // safety net. A local timeout here caused unhandled rejections that
      // crashed the process.
      return new Promise<SubagentAnswer>((resolve) => {
        coordinator.answerResolvers.set(question.questionId, {
          resolve: (answer: string) => {
            coordinator.questionPending = false;
            resolve({
              type: 'subagent_answer',
              questionId: question.questionId,
              subagentId: question.subagentId,
              runId: question.runId,
              answer,
            });
          },
        });
      });
    };

    const startSubagent = () => runSubagent({
      request: {
        kind,
        instruction,
        context: isIntegration
          ? `Integration group: ${name}\n${context || ''}`
          : context,
        timeoutMs,
      },
      runId,
      parentRunId: runId,
      model: (parentModelTier as any) || 'balanced',
      modelId: parentModelId,
      bridgeWs: bridgeWs as any,
      bridgeSecrets,
      onQuestion,
    });

    coordinator.resultPromise = bridgeWs && (bridgeWs as any).readyState === 1
      ? withClientBridge(bridgeWs as any, startSubagent, bridgeSecrets) as Promise<DelegationResult>
      : startSubagent();

    // Prevent unhandled rejection if subagent settles after delegate already returned
    coordinator.resultPromise.catch(() => {});

    // Race: subagent completes first, or asks a question first
    const race = await raceCompletionOrQuestion(coordinator);

    if (race.type === 'completed') {
      return buildCompletionResponse(race.result);
    }

    // Subagent asked a question — store the coordinator and return early.
    // The subagent keeps running in the background, blocked on ask_orchestrator.
    resetQuestionSignal(coordinator);
    activeCoordinators.set(race.question.questionId, coordinator);
    coordinatorsBySubagent.set(coordinator.subagentId || race.question.subagentId, {
      questionId: race.question.questionId,
      coordinator,
    });

    writeLog('delegate_returning_question', {
      subagent: name,
      questionId: race.question.questionId,
      question: race.question.question,
    });

    return buildQuestionResponse(race.question);
  },
});

// ─── Reply to subagent question ──────────────────────────────────────────────

export const replyToSubagent = createTool({
  id: 'reply_to_subagent',
  description:
    'Reply to a question from a running subagent. ' +
    'When a subagent asks a question, the delegate tool returns with the question and a top-level questionId. ' +
    'Pass that questionId here to send your answer. This tool will wait for the subagent to ' +
    'either complete its task or ask another question, then return the result.',
  inputSchema: z.object({
    questionId: z.string().describe('The questionId from the delegate tool response (top-level questionId field).'),
    answer: z.string().describe('Your answer to the subagent question.'),
  }),
  execute: async ({ questionId, answer }) => {
    // Dedup: if this questionId was already answered, return the cached result
    const cached = answeredCache.get(questionId);
    if (cached) {
      writeLog('reply_to_subagent_dedup', { questionId });
      return cached;
    }

    // Primary lookup by exact questionId
    let effectiveQuestionId = questionId;
    let coordinator = activeCoordinators.get(questionId);

    // Fallback 1: questionId might actually be a subagentId
    if (!coordinator) {
      const bySubagent = coordinatorsBySubagent.get(questionId);
      if (bySubagent) {
        coordinator = bySubagent.coordinator;
        effectiveQuestionId = bySubagent.questionId;
        writeLog('reply_to_subagent_fallback_subagent', { questionId, effectiveQuestionId });
      }
    }

    // Fallback 2: if exactly one coordinator is active, use it regardless of questionId
    if (!coordinator && activeCoordinators.size === 1) {
      const entry = Array.from(activeCoordinators.entries())[0];
      if (entry) {
        [effectiveQuestionId, coordinator] = entry;
        writeLog('reply_to_subagent_fallback_single', { questionId, effectiveQuestionId });
      }
    }

    if (!coordinator) {
      const availableIds = Array.from(activeCoordinators.keys());
      return {
        ok: false,
        error: `No pending question with id "${questionId}". ${
          availableIds.length > 0
            ? `Active question IDs: [${availableIds.join(', ')}]. Use one of these instead.`
            : 'No active questions — the subagent may have timed out or already completed.'
        }`,
      };
    }

    // Remove from lookup maps
    activeCoordinators.delete(effectiveQuestionId);
    if (coordinator.subagentId) {
      coordinatorsBySubagent.delete(coordinator.subagentId);
    }

    // Find the answer resolver — try exact match first, then any available
    let resolver = coordinator.answerResolvers.get(effectiveQuestionId);
    let resolverKey = effectiveQuestionId;
    if (!resolver && coordinator.answerResolvers.size > 0) {
      const first = Array.from(coordinator.answerResolvers.entries())[0];
      if (first) {
        [resolverKey, resolver] = [first[0], first[1]];
      }
    }

    if (!resolver) {
      return { ok: false, error: `Answer resolver not found for "${effectiveQuestionId}". The subagent may have already received an answer.` };
    }

    resolver.resolve(answer);
    coordinator.answerResolvers.delete(resolverKey);

    // Resolve any remaining duplicate answer resolvers
    for (const [dupId, dupResolver] of coordinator.answerResolvers) {
      dupResolver.resolve(answer);
      coordinator.answerResolvers.delete(dupId);
    }

    writeLog('reply_to_subagent_answered', { questionId: effectiveQuestionId, answerLength: answer.length });

    // Wait for the subagent to either complete or ask another question
    const race = await raceCompletionOrQuestion(coordinator);

    let result: any;
    if (race.type === 'completed') {
      result = buildCompletionResponse(race.result);
    } else {
      // Another question from the subagent — store and return it
      resetQuestionSignal(coordinator);
      activeCoordinators.set(race.question.questionId, coordinator);
      if (coordinator.subagentId) {
        coordinatorsBySubagent.set(coordinator.subagentId, {
          questionId: race.question.questionId,
          coordinator,
        });
      }

      writeLog('reply_to_subagent_followup_question', {
        questionId: race.question.questionId,
        question: race.question.question,
      });

      result = buildQuestionResponse(race.question);
    }

    // Cache result for dedup — prevents double-reply errors (auto-cleanup after 30s)
    answeredCache.set(questionId, result);
    if (effectiveQuestionId !== questionId) {
      answeredCache.set(effectiveQuestionId, result);
    }
    setTimeout(() => {
      answeredCache.delete(questionId);
      answeredCache.delete(effectiveQuestionId);
    }, 30_000);

    return result;
  },
});

// ─── Export all orchestrator tools ───────────────────────────────────────────

export const ORCHESTRATOR_DELEGATION_TOOLS = {
  delegate,
  reply_to_subagent: replyToSubagent,
} as const;
