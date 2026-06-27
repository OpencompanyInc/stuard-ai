/**
 * MCP Server — Async Job Store
 *
 * MCP tool calls are synchronous, but "ask the user a question" and long-running
 * tool executions are not. Both create a *job* identified by an id (the SID), and
 * the caller polls `stuard_status(job_id)` until it reaches a terminal state —
 * the same fire → SID → poll model the Telnyx SMS tools use.
 *
 * Jobs are user-scoped: `getJob` / `listJobs` only ever return the caller's jobs.
 * Storage is in-memory in the long-lived cloud-ai process with a TTL sweep. Swap
 * this module for a Supabase-backed store if cross-instance durability is needed.
 */

import { randomUUID } from 'crypto';

export type JobKind = 'ask' | 'execute';

export type JobStatus =
  | 'queued'         // created, not yet delivered/started
  | 'delivered'      // message shown to the user
  | 'awaiting_reply' // waiting on the user (ask)
  | 'running'        // tool executing (execute, background)
  | 'completed'      // resolved with a result/reply
  | 'failed'         // errored
  | 'expired'        // hit expires_in with no reply
  | 'dismissed';     // user closed the prompt

const TERMINAL: ReadonlySet<JobStatus> = new Set<JobStatus>([
  'completed',
  'failed',
  'expired',
  'dismissed',
]);

export interface Job {
  id: string;
  userId: string;
  kind: JobKind;
  status: JobStatus;
  /** Short human-readable summary of what the job was (message / tool name). */
  summary: string;
  /** Original request payload (echoed back for context). */
  request?: any;
  /** Tool result or mapped ask result, once terminal. */
  result?: any;
  /** Convenience: the user's textual reply for `ask` jobs. */
  reply?: string;
  /** Error message when status === 'failed'. */
  error?: string;
  createdAt: number;
  updatedAt: number;
  /** Epoch ms after which an unanswered job is considered expired. */
  expiresAt?: number;
}

const JOB_TTL_MS = 24 * 60 * 60 * 1000; // keep finished jobs for 24h
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
const MAX_JOBS_PER_USER = 200;

const jobs = new Map<string, Job>();

export function createJob(args: {
  userId: string;
  kind: JobKind;
  summary: string;
  request?: any;
  status?: JobStatus;
  expiresInMs?: number;
}): Job {
  const now = Date.now();
  const job: Job = {
    id: `job_${randomUUID()}`,
    userId: args.userId,
    kind: args.kind,
    status: args.status ?? 'queued',
    summary: args.summary.slice(0, 240),
    request: args.request,
    createdAt: now,
    updatedAt: now,
    expiresAt: args.expiresInMs ? now + args.expiresInMs : undefined,
  };
  jobs.set(job.id, job);
  pruneUser(args.userId);
  return job;
}

/** Returns the job only if it belongs to `userId` (no cross-user leakage). */
export function getJob(userId: string, jobId: string): Job | undefined {
  const job = jobs.get(jobId);
  if (!job || job.userId !== userId) return undefined;
  maybeExpire(job);
  return job;
}

export function listJobs(userId: string, limit = 20): Job[] {
  const out: Job[] = [];
  for (const job of jobs.values()) {
    if (job.userId !== userId) continue;
    maybeExpire(job);
    out.push(job);
  }
  out.sort((a, b) => b.createdAt - a.createdAt);
  return out.slice(0, Math.max(1, Math.min(limit, 100)));
}

export function updateJob(jobId: string, patch: Partial<Pick<Job, 'status' | 'result' | 'reply' | 'error'>>): void {
  const job = jobs.get(jobId);
  if (!job) return;
  // Don't resurrect a terminal job (e.g. a late bridge reply after expiry).
  if (TERMINAL.has(job.status)) return;
  Object.assign(job, patch);
  job.updatedAt = Date.now();
}

export function completeJob(jobId: string, result: any, reply?: string): void {
  updateJob(jobId, { status: 'completed', result, ...(reply !== undefined ? { reply } : {}) });
}

export function failJob(jobId: string, error: string): void {
  updateJob(jobId, { status: 'failed', error });
}

export function isTerminal(status: JobStatus): boolean {
  return TERMINAL.has(status);
}

/** Public, user-safe projection of a job for tool output. */
export function publicJob(job: Job) {
  return {
    job_id: job.id,
    kind: job.kind,
    status: job.status,
    summary: job.summary,
    ...(job.reply !== undefined ? { reply: job.reply } : {}),
    ...(job.result !== undefined ? { result: job.result } : {}),
    ...(job.error ? { error: job.error } : {}),
    created_at: new Date(job.createdAt).toISOString(),
    updated_at: new Date(job.updatedAt).toISOString(),
    ...(job.expiresAt ? { expires_at: new Date(job.expiresAt).toISOString() } : {}),
  };
}

function maybeExpire(job: Job): void {
  if (TERMINAL.has(job.status)) return;
  if (job.expiresAt && Date.now() > job.expiresAt) {
    job.status = 'expired';
    job.updatedAt = Date.now();
  }
}

function pruneUser(userId: string): void {
  const userJobs = [...jobs.values()].filter((j) => j.userId === userId).sort((a, b) => a.createdAt - b.createdAt);
  let excess = userJobs.length - MAX_JOBS_PER_USER;
  for (const job of userJobs) {
    if (excess <= 0) break;
    if (TERMINAL.has(job.status)) {
      jobs.delete(job.id);
      excess--;
    }
  }
}

let sweeper: NodeJS.Timeout | undefined;
function startSweeper(): void {
  if (sweeper) return;
  sweeper = setInterval(() => {
    const now = Date.now();
    for (const [id, job] of jobs) {
      maybeExpire(job);
      if (TERMINAL.has(job.status) && now - job.updatedAt > JOB_TTL_MS) {
        jobs.delete(id);
      }
    }
  }, SWEEP_INTERVAL_MS);
  // Don't keep the process alive solely for the sweeper.
  if (typeof sweeper.unref === 'function') sweeper.unref();
}
startSweeper();