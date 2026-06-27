/**
 * Run State Service
 *
 * Tracks active request lifecycle (phase, pending approvals, terminal results)
 * per user so the desktop can recover missed events after a WebSocket drop.
 *
 * In-memory for now — sufficient for same-instance reconnects on Cloud Run.
 * Can be backed by Redis or Supabase for cross-instance durability later.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type RunPhase = 'routing' | 'tool' | 'responding' | 'completed' | 'aborted' | 'error';

export interface PendingApproval {
  id: string;
  tool: string;
  args?: Record<string, any>;
  description?: string;
  createdAt: number;
}

export interface TerminalResult {
  text: string;
  finishReason: string;
  aborted?: boolean;
  error?: boolean;
  model?: string;
  conversationId?: string;
}

export interface RunState {
  userId: string;
  requestId: string;
  phase: RunPhase;
  pendingApprovals: Map<string, PendingApproval>;
  terminalResult?: TerminalResult;
  createdAt: number;
  updatedAt: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────────────────────

const userRuns = new Map<string, Map<string, RunState>>();

const TTL_MS = 10 * 60 * 1000; // 10 min — requests older than this are garbage-collected
const CLEANUP_INTERVAL_MS = 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export function registerRun(userId: string, requestId: string): RunState {
  let runs = userRuns.get(userId);
  if (!runs) {
    runs = new Map();
    userRuns.set(userId, runs);
  }
  const now = Date.now();
  const state: RunState = {
    userId,
    requestId,
    phase: 'routing',
    pendingApprovals: new Map(),
    createdAt: now,
    updatedAt: now,
  };
  runs.set(requestId, state);
  return state;
}

export function updateRunPhase(userId: string, requestId: string, phase: RunPhase): void {
  const run = getRun(userId, requestId);
  if (run) {
    run.phase = phase;
    run.updatedAt = Date.now();
  }
}

export function addPendingApproval(userId: string, requestId: string, approval: PendingApproval): void {
  const run = getRun(userId, requestId);
  if (run) {
    run.pendingApprovals.set(approval.id, approval);
    run.phase = 'tool';
    run.updatedAt = Date.now();
  }
}

export function removePendingApproval(userId: string, requestId: string, approvalId: string): void {
  const run = getRun(userId, requestId);
  if (run) {
    run.pendingApprovals.delete(approvalId);
    run.updatedAt = Date.now();
  }
}

export function removePendingApprovalByToolId(userId: string, approvalId: string): void {
  const runs = userRuns.get(userId);
  if (!runs) return;
  for (const run of runs.values()) {
    if (run.pendingApprovals.has(approvalId)) {
      run.pendingApprovals.delete(approvalId);
      run.updatedAt = Date.now();
      return;
    }
  }
}

export function setTerminalResult(userId: string, requestId: string, result: TerminalResult): void {
  const run = getRun(userId, requestId);
  if (run) {
    run.terminalResult = result;
    run.phase = result.aborted ? 'aborted' : result.error ? 'error' : 'completed';
    run.pendingApprovals.clear();
    run.updatedAt = Date.now();
  }
}

export function getRun(userId: string, requestId: string): RunState | undefined {
  return userRuns.get(userId)?.get(requestId);
}

/** Returns all active (non-terminal) runs for a user. */
export function getActiveRuns(userId: string): RunState[] {
  const runs = userRuns.get(userId);
  if (!runs) return [];
  const active: RunState[] = [];
  for (const run of runs.values()) {
    if (run.phase !== 'completed' && run.phase !== 'aborted' && run.phase !== 'error') {
      active.push(run);
    }
  }
  return active;
}

const APPROVAL_TIMEOUT_MS = 55_000; // Agent timeout is 60s; skip approvals likely already expired

/** Returns all pending approvals across all active runs for a user. */
export function getAllPendingApprovals(userId: string): PendingApproval[] {
  const runs = userRuns.get(userId);
  if (!runs) return [];
  const now = Date.now();
  const approvals: PendingApproval[] = [];
  for (const run of runs.values()) {
    if (run.phase === 'completed' || run.phase === 'aborted' || run.phase === 'error') continue;
    for (const a of run.pendingApprovals.values()) {
      if (now - a.createdAt < APPROVAL_TIMEOUT_MS) {
        approvals.push(a);
      }
    }
  }
  return approvals;
}

/** Returns terminal results that haven't been acknowledged. */
export function getUndeliveredTerminals(userId: string): Array<{ requestId: string; result: TerminalResult }> {
  const runs = userRuns.get(userId);
  if (!runs) return [];
  const terminals: Array<{ requestId: string; result: TerminalResult }> = [];
  for (const run of runs.values()) {
    if (run.terminalResult) {
      terminals.push({ requestId: run.requestId, result: run.terminalResult });
    }
  }
  return terminals;
}

export function clearRun(userId: string, requestId: string): void {
  const runs = userRuns.get(userId);
  if (runs) {
    runs.delete(requestId);
    if (runs.size === 0) userRuns.delete(userId);
  }
}

/** Builds a sync payload for the desktop to reconcile after reconnect. */
export function buildSyncPayload(userId: string): {
  pendingApprovals: PendingApproval[];
  terminals: Array<{ requestId: string; result: TerminalResult }>;
  activePhases: Array<{ requestId: string; phase: RunPhase }>;
} {
  return {
    pendingApprovals: getAllPendingApprovals(userId),
    terminals: getUndeliveredTerminals(userId),
    activePhases: getActiveRuns(userId).map(r => ({ requestId: r.requestId, phase: r.phase })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cleanup
// ─────────────────────────────────────────────────────────────────────────────

function cleanup(): void {
  const cutoff = Date.now() - TTL_MS;
  for (const [userId, runs] of userRuns.entries()) {
    for (const [reqId, run] of runs.entries()) {
      if (run.updatedAt < cutoff) {
        runs.delete(reqId);
      }
    }
    if (runs.size === 0) userRuns.delete(userId);
  }
}

setInterval(cleanup, CLEANUP_INTERVAL_MS);
