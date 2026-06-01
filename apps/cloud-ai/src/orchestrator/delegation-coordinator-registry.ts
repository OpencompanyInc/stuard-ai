/**
 * Lightweight coordinator state for delegated subagents.
 *
 * Kept separate from delegation-tools.ts so chat runners can import guard
 * helpers without pulling Mastra tool definitions or subagent-runtime.
 */

import { writeLog } from '../utils/logger';
import type { DelegationResult, SubagentQuestion } from './types';

export interface SubagentCoordinator {
  subagentId: string;
  resultPromise: Promise<DelegationResult>;
  questionPromise: Promise<SubagentQuestion>;
  questionResolve: (q: SubagentQuestion) => void;
  answerResolvers: Map<string, { resolve: (answer: string) => void }>;
  questionPending: boolean;
  requestId?: string;
  subagentName?: string;
  pendingQuestion?: { questionId: string; question: string; choices?: string[] };
}

/** Parallel group shape (defined in delegation-tools; kept loose here to avoid cycles). */
export type ParallelGroupRef = {
  questionQueue: Array<{ question: { questionId: string }; coordinator: SubagentCoordinator }>;
  activeQuestion?: { question: { questionId: string }; coordinator: SubagentCoordinator };
  finished: boolean;
  waiters: Set<() => void>;
};

export const activeCoordinators = new Map<string, SubagentCoordinator>();
export const coordinatorsBySubagent = new Map<string, { questionId: string; coordinator: SubagentCoordinator }>();
export const parallelGroupsByQuestion = new Map<string, ParallelGroupRef>();
export const parallelQuestionItemsByQuestion = new Map<string, { question: { questionId: string }; coordinator: SubagentCoordinator }>();

export function wakeParallelGroup(group: ParallelGroupRef) {
  const waiters = Array.from(group.waiters);
  group.waiters.clear();
  for (const wake of waiters) wake();
}

// ─── Per-request question turn (serializes across separate delegate calls) ───

interface RequestQuestionTurn {
  activeQuestionId?: string;
  queue: Array<{ questionId: string; release: () => void }>;
}

const requestQuestionTurns = new Map<string, RequestQuestionTurn>();

function getOrCreateRequestTurn(requestId: string): RequestQuestionTurn {
  let turn = requestQuestionTurns.get(requestId);
  if (!turn) {
    turn = { queue: [] };
    requestQuestionTurns.set(requestId, turn);
  }
  return turn;
}

/**
 * Wait until this question may be surfaced to the orchestrator. Within one
 * request/turn only one ask_orchestrator question is active at a time; others
 * block in delegate until the orchestrator replies (or the turn ends).
 */
export async function acquireQuestionTurn(requestId: string | undefined, questionId: string): Promise<void> {
  if (!requestId) return;
  const turn = getOrCreateRequestTurn(requestId);
  if (!turn.activeQuestionId || turn.activeQuestionId === questionId) {
    turn.activeQuestionId = questionId;
    return;
  }
  await new Promise<void>(resolve => {
    turn.queue.push({ questionId, release: resolve });
  });
  turn.activeQuestionId = questionId;
}

/** Release the active question slot so the next queued question can surface. */
export function releaseQuestionTurn(requestId: string | undefined, questionId: string) {
  if (!requestId) return;
  const turn = requestQuestionTurns.get(requestId);
  if (!turn || turn.activeQuestionId !== questionId) return;
  turn.activeQuestionId = undefined;
  const next = turn.queue.shift();
  if (next) {
    turn.activeQuestionId = next.questionId;
    next.release();
  }
  if (!turn.activeQuestionId && turn.queue.length === 0) {
    requestQuestionTurns.delete(requestId);
  }
}

/** Tear down any waiters still blocked on a question turn for this request. */
export function drainRequestQuestionTurn(requestId: string) {
  const turn = requestQuestionTurns.get(requestId);
  if (!turn) return;
  requestQuestionTurns.delete(requestId);
  for (const item of turn.queue) {
    try { item.release(); } catch {}
  }
}

// ─── Turn-end guard ──────────────────────────────────────────────────────────

export interface PendingSubagentQuestion {
  questionId: string;
  subagentId: string;
  subagent?: string;
  question: string;
  choices?: string[];
}

function coordinatorMatchesRequest(coord: SubagentCoordinator, requestId?: string): boolean {
  if (!requestId) return true;
  return coord.requestId === requestId;
}

export function getPendingSubagentQuestions(requestId?: string): PendingSubagentQuestion[] {
  const out: PendingSubagentQuestion[] = [];
  for (const [questionId, coord] of activeCoordinators) {
    if (!coordinatorMatchesRequest(coord, requestId)) continue;
    out.push({
      questionId,
      subagentId: coord.subagentId,
      subagent: coord.subagentName,
      question: coord.pendingQuestion?.question || 'The subagent is waiting for your reply.',
      choices: coord.pendingQuestion?.choices,
    });
  }
  return out;
}

export function hasPendingSubagentQuestions(requestId?: string): boolean {
  for (const coord of activeCoordinators.values()) {
    if (coordinatorMatchesRequest(coord, requestId)) return true;
  }
  return false;
}

export function resolvePendingSubagentQuestionsForRequest(requestId: string | undefined, reason: string): string[] {
  if (!requestId) return [];
  const unblocked: string[] = [];
  const stopAnswer = `[The orchestrator ended this turn without answering (${reason}). Stop now: call return_control with whatever you already have.]`;

  const drainCoordinator = (coord: SubagentCoordinator) => {
    for (const [resolverKey, resolver] of Array.from(coord.answerResolvers.entries())) {
      try { resolver.resolve(stopAnswer); } catch {}
      coord.answerResolvers.delete(resolverKey);
    }
    coord.questionPending = false;
    coord.pendingQuestion = undefined;
    if (coord.subagentId) {
      coordinatorsBySubagent.delete(coord.subagentId);
      unblocked.push(coord.subagentId);
    }
  };

  for (const [questionId, coord] of Array.from(activeCoordinators.entries())) {
    if (!coordinatorMatchesRequest(coord, requestId)) continue;
    activeCoordinators.delete(questionId);

    const group = parallelGroupsByQuestion.get(questionId);
    if (group) {
      for (const item of group.questionQueue) {
        parallelGroupsByQuestion.delete(item.question.questionId);
        parallelQuestionItemsByQuestion.delete(item.question.questionId);
        drainCoordinator(item.coordinator);
      }
      group.questionQueue = [];
      group.activeQuestion = undefined;
      group.finished = true;
      wakeParallelGroup(group);
    }
    parallelGroupsByQuestion.delete(questionId);
    parallelQuestionItemsByQuestion.delete(questionId);

    drainCoordinator(coord);
  }

  drainRequestQuestionTurn(requestId);

  if (unblocked.length > 0) {
    writeLog('subagent_questions_force_resolved', { requestId, reason, count: unblocked.length });
  }
  return unblocked;
}
