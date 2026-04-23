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
import { buildSkillContextSection, findSkillInContext, getSkillsFromContext } from '../tools/skill-tools';

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

interface DelegateTaskInput {
  subagent: string;
  instruction: string;
  context?: string;
  skill?: string;
}

interface PreparedDelegateTask extends DelegateTaskInput {
  skillContext?: string;
}

function joinContextSections(...sections: Array<string | undefined>): string | undefined {
  const normalized = sections
    .map((section) => section?.trim())
    .filter((section): section is string => !!section);

  return normalized.length > 0 ? normalized.join('\n\n') : undefined;
}

function prepareDelegateTask(task: DelegateTaskInput): { preparedTask?: PreparedDelegateTask; error?: string } {
  const skillName = task.skill?.trim();
  if (!skillName) {
    return { preparedTask: { ...task } };
  }

  const skill = findSkillInContext({ skill_name: skillName });
  if (!skill) {
    const availableSkills = getSkillsFromContext().map(({ name }) => name);
    return {
      error: availableSkills.length > 0
        ? `Unknown skill "${task.skill}". Available skills: ${availableSkills.join(', ')}`
        : `Unknown skill "${task.skill}". No active skills are available in the current context.`,
    };
  }

  return {
    preparedTask: {
      ...task,
      skill: skill.name,
      skillContext: buildSkillContextSection(skill),
    },
  };
}

// ─── The one delegation tool ─────────────────────────────────────────────────

/** Shared logic: spin up one subagent task, race completion vs question */
async function runDelegateTask(
  task: PreparedDelegateTask,
  index: number,
  bridgeWs: any,
  bridgeSecrets: Record<string, any> | undefined,
  parentModelTier: string | undefined,
  parentModelId: string | undefined,
  chatWs: any,
) {
  const name = task.subagent.trim().toLowerCase() as SubagentName;
  const STATIC_KINDS = ['browser', 'file_ops', 'workflow', 'reminders'] as const;
  const isIntegration = !STATIC_KINDS.includes(name as any);
  const kind = isIntegration
    ? 'integration' as const
    : name as 'browser' | 'file_ops' | 'workflow' | 'reminders';
  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  writeLog('delegate_start', {
    subagent: name,
    skill: task.skill,
    instruction: task.instruction.slice(0, 200),
    hasBridge: !!bridgeWs,
    parentModelTier,
    parentModelId,
  });
  console.log(`[delegation] ▶ DELEGATE START | subagent=${name} runId=${runId} kind=${kind} | instruction="${task.instruction.slice(0, 120)}"`);

  // Set up coordinator for question/answer flow
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
    if (coordinator.questionPending) {
      writeLog('delegate_question_duplicate_blocking', {
        subagent: name,
        questionId: question.questionId,
      });
      console.log(`[delegation] ⚠ DUPLICATE QUESTION from ${name} | questionId=${question.questionId} — blocking on same answer`);
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
    console.log(`[delegation] ❓ QUESTION from ${name} | subagentId=${question.subagentId} questionId=${question.questionId} | "${question.question.slice(0, 100)}"`);

    coordinator.questionResolve(question);

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
      instruction: task.instruction,
      context: joinContextSections(
        isIntegration ? `Integration group: ${name}` : undefined,
        task.skillContext,
        task.context,
      ),
    },
    runId,
    parentRunId: runId,
    model: (parentModelTier as any) || 'balanced',
    modelId: parentModelId,
    bridgeWs: bridgeWs as any,
    bridgeSecrets,
    chatWs,
    onQuestion,
  });

  coordinator.resultPromise = bridgeWs && (bridgeWs as any).readyState === 1
    ? withClientBridge(bridgeWs as any, startSubagent, bridgeSecrets) as Promise<DelegationResult>
    : startSubagent();

  coordinator.resultPromise.catch(() => {});

  const race = await raceCompletionOrQuestion(coordinator);

  if (race.type === 'completed') {
    console.log(`[delegation] ✅ DELEGATE COMPLETE (no question) | subagent=${name} ok=${race.result.ok} | result="${(race.result.result || race.result.error || '').slice(0, 120)}"`);
    return { index, subagent: name, ...buildCompletionResponse(race.result) };
  }

  // Subagent asked a question — store the coordinator and return early
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
  console.log(`[delegation] ⏸ DELEGATE PAUSED — returning question to orchestrator | subagent=${name} subagentId=${coordinator.subagentId} questionId=${race.question.questionId} | activeCoordinators=${activeCoordinators.size}`);

  return { index, subagent: name, ...buildQuestionResponse(race.question) };
}

export const delegate = createTool({
  id: 'delegate',
  description:
    'Delegate one or more tasks to specialized subagents.\n' +
    'Pass a single task or multiple independent tasks — multiple tasks run in parallel.\n\n' +
    'If you pass skill, the matching user-defined skill is loaded into the delegated subagent context automatically.\n\n' +
    'Available subagents:\n' +
    '  browser     — web browsing, form filling, page scraping, screenshots\n' +
    '  file_ops    — reading/writing files, code editing, terminal, commands\n' +
    '  workflow    — creating/modifying/testing StuardAI automation workflows\n' +
    '  reminders   — scheduling one-time/recurring reminders, managing the user\'s tasks and to-dos\n' +
    '  google      — Gmail, Calendar, Drive, Sheets, Docs, Tasks\n' +
    '  outlook     — Outlook mail & calendar\n' +
    '  github      — repos, issues, PRs, branches, actions\n' +
    '  meta        — Facebook, Instagram, Threads\n' +
    '  whatsapp    — WhatsApp messaging\n' +
    '  telnyx      — SMS, voice calls\n' +
    '  reddit      — subreddits, posts, comments\n' +
    '  discord     — Discord bot operations\n\n' +
    'A subagent can ask you questions mid-task via ask_orchestrator. When that happens, ' +
    'this tool returns with the question and a questionId. Use reply_to_subagent to answer.',
  inputSchema: z.object({
    tasks: z.array(z.object({
      subagent: z
        .string()
        .describe('Name of the subagent (e.g. "browser", "file_ops", "google").'),
      instruction: z
        .string()
        .describe('Detailed instruction describing what the subagent should do.'),
      context: z
        .string()
        .optional()
        .describe('Additional context (conversation history, IDs, user preferences).'),
      skill: z
        .string()
        .optional()
        .describe('Optional user-defined skill name to inject into the delegated subagent context automatically.'),
    })).min(1).max(10).describe('Array of tasks to delegate. Use 1 for a single task, or multiple for parallel execution.'),
  }),
  execute: async ({ tasks }) => {
    const bridgeWs = getBridgeWs();
    const bridgeSecrets = getBridgeSecrets();
    const parentModelTier = bridgeSecrets?.__modelTier as string | undefined;
    const parentModelId = bridgeSecrets?.__modelId as string | undefined;
    // Primary chat WS (stashed by runAgent for the VM-agent flow where bridge
    // and chat are different sockets). Falls back to bridgeWs downstream.
    const chatWs = (bridgeSecrets as any)?.__chatWs;
    const preparedTasks: PreparedDelegateTask[] = [];

    // Validate all subagent names upfront
    for (const task of tasks) {
      const name = task.subagent.trim().toLowerCase();
      if (!KNOWN_SUBAGENT_NAMES.includes(name as any)) {
        return {
          ok: false,
          error: `Unknown subagent "${task.subagent}". Valid names: ${KNOWN_SUBAGENT_NAMES.join(', ')}`,
        };
      }

      const { preparedTask, error } = prepareDelegateTask(task);
      if (!preparedTask || error) {
        return {
          ok: false,
          error: error || 'Failed to prepare delegated task.',
        };
      }

      preparedTasks.push(preparedTask);
    }

    if (preparedTasks.length === 1) {
      // Single task — return flat result (backwards-compatible shape)
      const result = await runDelegateTask(preparedTasks[0], 0, bridgeWs, bridgeSecrets, parentModelTier, parentModelId, chatWs);
      const { index: _index, ...rest } = result;
      return rest;
    }

    // Multiple tasks — run in parallel
    writeLog('delegate_multi_start', {
      taskCount: preparedTasks.length,
      subagents: preparedTasks.map(t => t.subagent),
    });
    console.log(`[delegation] ▶▶ DELEGATE PARALLEL | ${preparedTasks.length} tasks | subagents=[${preparedTasks.map(t => t.subagent).join(', ')}]`);

    const results = await Promise.all(
      preparedTasks.map((task, index) =>
        runDelegateTask(task, index, bridgeWs, bridgeSecrets, parentModelTier, parentModelId, chatWs),
      ),
    );

    const completed = results.filter(r => r.completed);
    const pending = results.filter(r => !r.completed);

    console.log(`[delegation] 🏁 DELEGATE PARALLEL DONE | ${completed.length} completed, ${pending.length} awaiting replies`);
    writeLog('delegate_multi_complete', {
      totalTasks: preparedTasks.length,
      completed: completed.length,
      pendingQuestions: pending.length,
    });

    return {
      ok: true,
      results,
      summary: `${completed.length}/${preparedTasks.length} tasks completed${pending.length > 0 ? `, ${pending.length} awaiting reply (use reply_to_subagent with the questionId)` : ''}`,
    };
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
    console.log(`[delegation] 💬 REPLY_TO_SUBAGENT called | questionId=${questionId} answer="${answer.slice(0, 80)}" | activeCoordinators=${activeCoordinators.size} coordBySubagent=${coordinatorsBySubagent.size} answeredCache=${answeredCache.size}`);

    // Dedup: if this questionId was already answered, return the cached result
    const cached = answeredCache.get(questionId);
    if (cached) {
      writeLog('reply_to_subagent_dedup', { questionId });
      console.log(`[delegation] ♻ REPLY DEDUP — already answered | questionId=${questionId}`);
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
      const availableSubagents = Array.from(coordinatorsBySubagent.keys());
      console.log(`[delegation] ✖ REPLY FAILED — coordinator not found | questionId=${questionId} | availableQuestionIds=[${availableIds.join(', ')}] availableSubagentIds=[${availableSubagents.join(', ')}]`);
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
    console.log(`[delegation] ✉ ANSWER SENT to subagent | subagentId=${coordinator.subagentId} questionId=${effectiveQuestionId} | waiting for completion or next question...`);

    // Wait for the subagent to either complete or ask another question
    const race = await raceCompletionOrQuestion(coordinator);

    let result: any;
    if (race.type === 'completed') {
      console.log(`[delegation] ✅ SUBAGENT COMPLETED after reply | subagentId=${coordinator.subagentId} ok=${race.result.ok} durationMs=${race.result.durationMs} | result="${(race.result.result || race.result.error || '').slice(0, 120)}"`);
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
