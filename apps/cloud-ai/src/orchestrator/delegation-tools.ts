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
import { writeLog } from '../utils/logger';
import { KNOWN_SUBAGENT_NAMES, type SubagentName } from './capability-packs';
import type { DelegationResult, SubagentQuestion, SubagentAnswer } from './types';
import {
  acquireQuestionTurn,
  activeCoordinators,
  coordinatorsBySubagent,
  parallelGroupsByQuestion,
  parallelQuestionItemsByQuestion,
  releaseQuestionTurn,
  wakeParallelGroup,
  type SubagentCoordinator,
} from './delegation-coordinator-registry';
import { execLocalTool, getBridgeWs, getBridgeSecrets, withClientBridge } from '../tools/bridge';
import { buildSkillContextSection, findSkillInContext, getSkillsFromContext } from '../tools/skill-tools';
import {
  DISCORD_INTEGRATION_ENABLED,
  META_INTEGRATION_ENABLED,
  OUTLOOK_INTEGRATION_ENABLED,
  REDDIT_INTEGRATION_ENABLED,
  WHATSAPP_INTEGRATION_ENABLED,
} from '../../../../shared/integration-flags';

// ─── Background subagent coordination ────────────────────────────────────────

type DelegateTaskStatus = 'running' | 'awaiting_reply' | 'completed' | 'failed';

interface StartedDelegateTask {
  index: number;
  subagent: SubagentName;
  coordinator: SubagentCoordinator;
  invocationPromise: Promise<void>;
}

interface ParallelTaskState extends StartedDelegateTask {
  status: DelegateTaskStatus;
  response?: any;
  currentQuestionId?: string;
}

interface ParallelQuestionItem {
  group: ParallelGroup;
  task: ParallelTaskState;
  coordinator: SubagentCoordinator;
  question: SubagentQuestion;
}

interface ParallelGroup {
  groupId: string;
  tasks: ParallelTaskState[];
  activeQuestion?: ParallelQuestionItem;
  questionQueue: ParallelQuestionItem[];
  waiters: Set<() => void>;
  finished: boolean;
}

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

function buildRunningResponse(task: ParallelTaskState) {
  return {
    ok: true,
    index: task.index,
    subagent: task.subagent,
    subagentId: task.coordinator.subagentId || undefined,
    status: task.status,
    completed: false,
    awaitingReply: task.status === 'awaiting_reply',
    questionId: task.currentQuestionId,
  };
}

function buildParallelTaskSnapshot(task: ParallelTaskState) {
  if (task.response) {
    return {
      index: task.index,
      subagent: task.subagent,
      status: task.status,
      ...task.response,
    };
  }

  return buildRunningResponse(task);
}

function buildParallelSummary(group: ParallelGroup) {
  const completed = group.tasks.filter(t => t.status === 'completed' || t.status === 'failed').length;
  const awaiting = group.tasks.filter(t => t.status === 'awaiting_reply').length;
  return `${completed}/${group.tasks.length} tasks completed${awaiting > 0 ? `, ${awaiting} awaiting reply` : ''}`;
}

function buildParallelCompletionResponse(group: ParallelGroup) {
  return {
    ok: true,
    results: group.tasks.map(buildParallelTaskSnapshot),
    summary: buildParallelSummary(group),
  };
}

function buildParallelQuestionResponse(item: ParallelQuestionItem) {
  const base = buildQuestionResponse(item.question);
  return {
    ...base,
    results: item.group.tasks.map(buildParallelTaskSnapshot),
    summary: `${buildParallelSummary(item.group)} (use reply_to_subagent with the questionId)`,
  };
}

function allParallelTasksTerminal(group: ParallelGroup) {
  return group.tasks.every(t => t.status === 'completed' || t.status === 'failed');
}

async function registerActiveQuestion(item: ParallelQuestionItem) {
  const { question, coordinator, group } = item;
  await acquireQuestionTurn(coordinator.requestId, question.questionId);
  activeCoordinators.set(question.questionId, coordinator);
  coordinator.pendingQuestion = {
    questionId: question.questionId,
    question: question.question,
    choices: question.choices,
  };
  coordinatorsBySubagent.set(coordinator.subagentId || question.subagentId, {
    questionId: question.questionId,
    coordinator,
  });
  parallelGroupsByQuestion.set(question.questionId, group);
  parallelQuestionItemsByQuestion.set(question.questionId, item);
}

function unregisterActiveQuestion(questionId: string, coordinator: SubagentCoordinator) {
  activeCoordinators.delete(questionId);
  if (coordinator.pendingQuestion?.questionId === questionId) {
    coordinator.pendingQuestion = undefined;
  }
  if (coordinator.subagentId) {
    coordinatorsBySubagent.delete(coordinator.subagentId);
  }
  parallelGroupsByQuestion.delete(questionId);
  parallelQuestionItemsByQuestion.delete(questionId);
  releaseQuestionTurn(coordinator.requestId, questionId);
}

async function surfaceNextParallelQuestion(group: ParallelGroup) {
  if (group.activeQuestion || group.questionQueue.length === 0) return undefined;
  const next = group.questionQueue.shift();
  if (!next) return undefined;
  group.activeQuestion = next;
  await registerActiveQuestion(next);
  return next;
}

function cleanupParallelGroup(group: ParallelGroup) {
  group.finished = true;
  if (group.activeQuestion) {
    unregisterActiveQuestion(group.activeQuestion.question.questionId, group.activeQuestion.coordinator);
  }
  for (const item of group.questionQueue) {
    parallelGroupsByQuestion.delete(item.question.questionId);
    parallelQuestionItemsByQuestion.delete(item.question.questionId);
  }
  group.questionQueue = [];
  group.activeQuestion = undefined;
  wakeParallelGroup(group);
}

async function getParallelReadyResponse(group: ParallelGroup): Promise<any | undefined> {
  if (group.activeQuestion) {
    return buildParallelQuestionResponse(group.activeQuestion);
  }

  const queued = await surfaceNextParallelQuestion(group);
  if (queued) {
    return buildParallelQuestionResponse(queued);
  }

  if (allParallelTasksTerminal(group)) {
    const response = buildParallelCompletionResponse(group);
    cleanupParallelGroup(group);
    return response;
  }

  return undefined;
}

async function waitForParallelGroupNext(group: ParallelGroup): Promise<any> {
  for (;;) {
    const ready = await getParallelReadyResponse(group);
    if (ready) return ready;
    await new Promise<void>(resolve => {
      const wake = () => resolve();
      group.waiters.add(wake);
      // Re-check after registering: a sibling may have completed before we waited.
      queueMicrotask(async () => {
        if (await getParallelReadyResponse(group)) wake();
      });
    });
  }
}

interface DelegateTaskInput {
  subagent: string;
  instruction: string;
  context?: string;
  skill?: string;
  bot_id?: string;
  bot_name?: string;
  agent_id?: string;
  agent_name?: string;
  /** For subagent === 'custom': exact tool names this ad-hoc subagent may use. */
  tools?: string[];
  /** For subagent === 'custom': the system prompt / role for this ad-hoc subagent. */
  system_prompt?: string;
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

function buildTargetContext(task: DelegateTaskInput, targetKind: 'bot' | 'agent'): string | undefined {
  const id = (targetKind === 'agent' ? task.agent_id : task.bot_id)?.trim();
  const name = (targetKind === 'agent' ? task.agent_name : task.bot_name)?.trim();
  if (!id && !name) return undefined;

  return [
    id ? `Target ${targetKind} id: ${id}` : undefined,
    name ? `Target ${targetKind} name: ${name}` : undefined,
  ].filter(Boolean).join('\n');
}

export function assignBrowserDelegateTabIndexes(tasks: Array<{ subagent: string }>): Array<number | undefined> {
  let nextBrowserTabIndex = 0;
  return tasks.map((task) => {
    const name = task.subagent.trim().toLowerCase();
    if (name !== 'browser') return undefined;
    const tabIndex = nextBrowserTabIndex;
    nextBrowserTabIndex += 1;
    return tabIndex;
  });
}

export function buildDelegateBridgeSecrets(
  kind: string,
  bridgeSecrets: Record<string, any> | undefined,
  runId: string,
  browserTabIndex?: number,
): Record<string, any> | undefined {
  if (kind !== 'browser') return bridgeSecrets;
  return {
    ...(bridgeSecrets || {}),
    browserUseSessionId: `browser-${runId}`,
    ...(typeof browserTabIndex === 'number' ? { browserUseTabIndex: browserTabIndex } : {}),
  };
}

// ─── The one delegation tool ─────────────────────────────────────────────────

/** Shared logic: spin up one subagent task. */
function startDelegateTask(
  task: PreparedDelegateTask,
  index: number,
  bridgeWs: any,
  bridgeSecrets: Record<string, any> | undefined,
  parentModelTier: string | undefined,
  parentModelId: string | undefined,
  chatWs: any,
  browserTabIndex?: number,
  onQuestionCreated?: (started: StartedDelegateTask, question: SubagentQuestion) => void,
  runSubagentImpl?: (args: any) => Promise<DelegationResult>,
): StartedDelegateTask {
  const name = task.subagent.trim().toLowerCase() as SubagentName;
  const STATIC_KINDS = ['browser', 'file_ops', 'cli_agent', 'workflow', 'reminders', 'ffmpeg', 'data_analysis', 'vm', 'bot', 'agent', 'integration_builder', 'skills', 'custom'] as const;
  const isIntegration = !STATIC_KINDS.includes(name as any);
  const kind = isIntegration
    ? 'integration' as const
    : name as 'browser' | 'file_ops' | 'cli_agent' | 'workflow' | 'reminders' | 'ffmpeg' | 'data_analysis' | 'vm' | 'bot' | 'agent' | 'integration_builder' | 'skills' | 'custom';
  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const parentAbortSignal = bridgeSecrets?.__abortSignal;
  const isBrowserSubagent = kind === 'browser';
  const taskBridgeSecrets = buildDelegateBridgeSecrets(kind, bridgeSecrets, runId, browserTabIndex);

  const releaseBrowserSession = async () => {
    const sessionId = typeof taskBridgeSecrets?.browserUseSessionId === 'string'
      ? taskBridgeSecrets.browserUseSessionId
      : '';
    if (!isBrowserSubagent || !sessionId) return;
    const release = () => execLocalTool('browser_use_tabs', {
      action: 'release',
      session_id: sessionId,
    }).catch(() => undefined);
    try {
      if (bridgeWs && (bridgeWs as any).readyState === 1) {
        await withClientBridge(bridgeWs as any, release, taskBridgeSecrets);
      } else {
        await release();
      }
    } catch {}
  };

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
    requestId: typeof (bridgeSecrets as any)?.__requestId === 'string' ? (bridgeSecrets as any).__requestId : undefined,
    subagentName: name,
  };
  let invocationResolve!: () => void;
  const invocationPromise = new Promise<void>(resolve => { invocationResolve = resolve; });
  const started: StartedDelegateTask = { index, subagent: name, coordinator, invocationPromise };

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

    if (onQuestionCreated) {
      queueMicrotask(() => onQuestionCreated(started, question));
    } else {
      coordinator.questionResolve(question);
    }

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

  const startSubagent = async () => {
    try {
      const runSubagent = runSubagentImpl || (await import('./subagent-runtime')).runSubagent;
      const result = runSubagent({
        request: {
          kind,
          instruction: task.instruction,
          targetAgentId: name === 'agent' ? task.agent_id?.trim() : task.bot_id?.trim(),
          targetAgentName: name === 'agent' ? task.agent_name?.trim() : task.bot_name?.trim(),
          context: joinContextSections(
            isIntegration ? `Integration group: ${name}` : undefined,
            name === 'bot' || name === 'agent' ? buildTargetContext(task, name) : undefined,
            task.skillContext,
            task.context,
          ),
          ...(name === 'custom'
            ? {
                customToolNames: Array.isArray(task.tools) ? task.tools : undefined,
                customSystemPrompt: task.system_prompt,
              }
            : {}),
        },
        runId,
        parentRunId: runId,
        model: (parentModelTier as any) || 'balanced',
        modelId: parentModelId,
        bridgeWs: bridgeWs as any,
        bridgeSecrets: taskBridgeSecrets,
        chatWs,
        abortSignal: parentAbortSignal && typeof parentAbortSignal === 'object' && 'aborted' in parentAbortSignal
          ? parentAbortSignal as AbortSignal
          : undefined,
        onQuestion,
      });
      invocationResolve();
      return result;
    } catch (error) {
      invocationResolve();
      throw error;
    }
  };

  coordinator.resultPromise = bridgeWs && (bridgeWs as any).readyState === 1
    ? withClientBridge(bridgeWs as any, startSubagent, taskBridgeSecrets) as Promise<DelegationResult>
    : startSubagent();

  coordinator.resultPromise.finally(releaseBrowserSession).catch(() => {});
  coordinator.resultPromise.catch(() => {});

  return started;
}

/** Shared logic: spin up one subagent task, race completion vs question */
async function runDelegateTask(
  task: PreparedDelegateTask,
  index: number,
  bridgeWs: any,
  bridgeSecrets: Record<string, any> | undefined,
  parentModelTier: string | undefined,
  parentModelId: string | undefined,
  chatWs: any,
  browserTabIndex?: number,
) {
  const started = startDelegateTask(
    task,
    index,
    bridgeWs,
    bridgeSecrets,
    parentModelTier,
    parentModelId,
    chatWs,
    browserTabIndex,
  );
  const { coordinator, subagent: name } = started;

  const race = await raceCompletionOrQuestion(coordinator);

  if (race.type === 'completed') {
    console.log(`[delegation] ✅ DELEGATE COMPLETE (no question) | subagent=${name} ok=${race.result.ok} | result="${(race.result.result || race.result.error || '').slice(0, 120)}"`);
    return { index, subagent: name, ...buildCompletionResponse(race.result) };
  }

  // Subagent asked a question — wait for this request's question turn, then surface
  await acquireQuestionTurn(coordinator.requestId, race.question.questionId);
  resetQuestionSignal(coordinator);
  activeCoordinators.set(race.question.questionId, coordinator);
  coordinator.pendingQuestion = {
    questionId: race.question.questionId,
    question: race.question.question,
    choices: race.question.choices,
  };
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

function completeParallelTask(group: ParallelGroup, task: ParallelTaskState, result: DelegationResult) {
  if (task.status === 'completed' || task.status === 'failed') return;
  task.status = result.ok ? 'completed' : 'failed';
  task.currentQuestionId = undefined;
  task.response = buildCompletionResponse(result);
  wakeParallelGroup(group);
}

function handleParallelQuestion(group: ParallelGroup, task: ParallelTaskState, question: SubagentQuestion) {
  task.status = 'awaiting_reply';
  task.currentQuestionId = question.questionId;

  const item: ParallelQuestionItem = {
    group,
    task,
    coordinator: task.coordinator,
    question,
  };

  if (group.activeQuestion) {
    group.questionQueue.push(item);
  } else {
    group.activeQuestion = item;
    void registerActiveQuestion(item);
  }

  writeLog('delegate_parallel_question', {
    groupId: group.groupId,
    subagent: task.subagent,
    questionId: question.questionId,
    queued: group.activeQuestion !== item,
  });
  wakeParallelGroup(group);
}

async function runParallelDelegateTasks(
  preparedTasks: PreparedDelegateTask[],
  bridgeWs: any,
  bridgeSecrets: Record<string, any> | undefined,
  parentModelTier: string | undefined,
  parentModelId: string | undefined,
  chatWs: any,
) {
  const group: ParallelGroup = {
    groupId: `group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    tasks: [],
    questionQueue: [],
    waiters: new Set(),
    finished: false,
  };

  const browserTabIndexes = assignBrowserDelegateTabIndexes(preparedTasks);
  const { runSubagent } = await import('./subagent-runtime');

  for (const [index, task] of preparedTasks.entries()) {
    let taskState!: ParallelTaskState;
    const started = startDelegateTask(
      task,
      index,
      bridgeWs,
      bridgeSecrets,
      parentModelTier,
      parentModelId,
      chatWs,
      browserTabIndexes[index],
      (_started, question) => handleParallelQuestion(group, taskState, question),
      runSubagent,
    );

    taskState = {
      ...started,
      status: 'running',
    };
    group.tasks.push(taskState);

    started.coordinator.resultPromise
      .then(result => completeParallelTask(group, taskState, result))
      .catch(err => completeParallelTask(group, taskState, {
        ok: false,
        subagentId: started.coordinator.subagentId,
        error: err?.message || 'Subagent failed',
        durationMs: 0,
      }));
  }

  await Promise.all(group.tasks.map(task => task.invocationPromise));
  return waitForParallelGroupNext(group);
}

function resolveCoordinatorAnswer(
  coordinator: SubagentCoordinator,
  effectiveQuestionId: string,
  answer: string,
): { ok: true } | { ok: false; error: string } {
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

  for (const [dupId, dupResolver] of coordinator.answerResolvers) {
    dupResolver.resolve(answer);
    coordinator.answerResolvers.delete(dupId);
  }

  return { ok: true };
}

function cacheAnsweredQuestion(questionId: string, effectiveQuestionId: string, result: any) {
  answeredCache.set(questionId, result);
  if (effectiveQuestionId !== questionId) {
    answeredCache.set(effectiveQuestionId, result);
  }
  setTimeout(() => {
    answeredCache.delete(questionId);
    answeredCache.delete(effectiveQuestionId);
  }, 30_000);
}

async function replyToParallelQuestion(
  group: ParallelGroup,
  item: ParallelQuestionItem,
  effectiveQuestionId: string,
  questionId: string,
  answer: string,
) {
  unregisterActiveQuestion(effectiveQuestionId, item.coordinator);
  if (group.activeQuestion?.question.questionId === effectiveQuestionId) {
    group.activeQuestion = undefined;
  }

  item.task.status = 'running';
  item.task.currentQuestionId = undefined;

  const resolved = resolveCoordinatorAnswer(item.coordinator, effectiveQuestionId, answer);
  if (!resolved.ok) return resolved;

  writeLog('reply_to_subagent_answered', { questionId: effectiveQuestionId, answerLength: answer.length, parallelGroupId: group.groupId });
  console.log(`[delegation] âœ‰ ANSWER SENT to parallel subagent | subagentId=${item.coordinator.subagentId} questionId=${effectiveQuestionId} | waiting for batch completion or next question...`);

  const result = await waitForParallelGroupNext(group);
  cacheAnsweredQuestion(questionId, effectiveQuestionId, result);
  return result;
}

export const delegate = createTool({
  id: 'delegate',
  description:
    'Delegate one or more tasks to specialized subagents.\n' +
    'Pass a single task or multiple independent tasks — multiple tasks run in parallel.\n' +
    'If you pass skill, the matching user-defined skill is loaded into the delegated subagent context automatically.\n\n' +
    'Valid subagent names (see the subagent table in your instructions for what each one does):\n' +
    '  browser, file_ops, cli_agent, workflow, integration_builder, skills, reminders, vm, bot, agent, custom, ' +
    'google, ' + (OUTLOOK_INTEGRATION_ENABLED ? 'outlook, ' : '') + 'github, ' +
    (META_INTEGRATION_ENABLED ? 'meta, ' : '') + (WHATSAPP_INTEGRATION_ENABLED ? 'whatsapp, ' : '') + 'telnyx, ' +
    (REDDIT_INTEGRATION_ENABLED ? 'reddit, ' : '') + (DISCORD_INTEGRATION_ENABLED ? 'discord, ' : '') + 'x\n' +
    '(For "custom": also pass `tools` — exact tool names it may use — and `system_prompt` — its role.)\n\n' +
    'A subagent can ask you questions mid-task via ask_orchestrator. When that happens, ' +
    'this tool returns with the question and a questionId. If the user must decide or confirm, ' +
    'call ask_user first, then reply_to_subagent with the user\'s answer. Otherwise reply_to_subagent directly.',
  inputSchema: z.object({
    tasks: z.array(z.object({
      subagent: z
        .string()
        .describe('Name of the subagent (e.g. "browser", "file_ops", "agent", "bot", "google").'),
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
      bot_id: z
        .string()
        .optional()
        .describe('Optional target bot id when subagent is "bot" (for example "bot_default" or "bot_...").'),
      bot_name: z
        .string()
        .optional()
        .describe('Optional target bot display name when subagent is "bot".'),
      agent_id: z
        .string()
        .optional()
        .describe('Optional target agent id when subagent is "agent" (for example "agent_default" or "agent_...").'),
      agent_name: z
        .string()
        .optional()
        .describe('Optional target agent display name when subagent is "agent".'),
      tools: z
        .array(z.string())
        .optional()
        .describe('Only for subagent "custom": exact tool names this ad-hoc subagent may use. Omit to give it just the discovery meta-tools (search_tools/get_tool_schema/execute_tool).'),
      system_prompt: z
        .string()
        .optional()
        .describe('Only for subagent "custom": the role/instructions/system prompt for this ad-hoc subagent.'),
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

    const response = await runParallelDelegateTasks(
      preparedTasks,
      bridgeWs,
      bridgeSecrets,
      parentModelTier,
      parentModelId,
      chatWs,
    );

    const results = Array.isArray(response?.results) ? response.results : [];
    const completed = results.filter((r: any) => r.completed);
    const pending = results.filter((r: any) => !r.completed);

    console.log(`[delegation] 🏁 DELEGATE PARALLEL DONE | ${completed.length} completed, ${pending.length} awaiting replies`);
    writeLog('delegate_multi_complete', {
      totalTasks: preparedTasks.length,
      completed: completed.length,
      pendingQuestions: pending.length,
    });

    return response;
  },
});

// ─── Reply to subagent question ──────────────────────────────────────────────

export const replyToSubagent = createTool({
  id: 'reply_to_subagent',
  description:
    'Reply to a question from a running subagent. ' +
    'When a subagent asks a question, the delegate tool returns with the question and a top-level questionId. ' +
    'If the answer requires user input or confirmation, call ask_user first, then pass the user\'s response here. ' +
    'Pass the questionId from delegate. This tool waits for the subagent to complete or ask another question.',
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

    const parallelGroup = parallelGroupsByQuestion.get(effectiveQuestionId) as ParallelGroup | undefined;
    const parallelItem = parallelQuestionItemsByQuestion.get(effectiveQuestionId) as ParallelQuestionItem | undefined;
    if (parallelGroup && parallelItem) {
      return replyToParallelQuestion(parallelGroup, parallelItem, effectiveQuestionId, questionId, answer);
    }

    // Remove from lookup maps and release this request's question turn
    activeCoordinators.delete(effectiveQuestionId);
    if (coordinator.pendingQuestion?.questionId === effectiveQuestionId) {
      coordinator.pendingQuestion = undefined;
    }
    if (coordinator.subagentId) {
      coordinatorsBySubagent.delete(coordinator.subagentId);
    }
    releaseQuestionTurn(coordinator.requestId, effectiveQuestionId);

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
      // Another question from the subagent — wait for turn, then surface
      await acquireQuestionTurn(coordinator.requestId, race.question.questionId);
      resetQuestionSignal(coordinator);
      activeCoordinators.set(race.question.questionId, coordinator);
      coordinator.pendingQuestion = {
        questionId: race.question.questionId,
        question: race.question.question,
        choices: race.question.choices,
      };
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

// Re-export turn-end guard helpers (implemented in delegation-coordinator-registry).
export {
  getPendingSubagentQuestions,
  hasPendingSubagentQuestions,
  resolvePendingSubagentQuestionsForRequest,
  type PendingSubagentQuestion,
} from './delegation-coordinator-registry';

// ─── Export all orchestrator tools ───────────────────────────────────────────

export const ORCHESTRATOR_DELEGATION_TOOLS = {
  delegate,
  reply_to_subagent: replyToSubagent,
} as const;
