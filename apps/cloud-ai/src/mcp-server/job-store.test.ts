import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { completeJob, createJob, failJob, getJob, listJobs, publicJob, updateJob } from './job-store';

describe('mcp-server job-store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-24T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is user-scoped: getJob/listJobs never leak across users', () => {
    const a = createJob({ userId: 'u1', kind: 'ask', summary: 'a' });
    createJob({ userId: 'u2', kind: 'ask', summary: 'b' });

    expect(getJob('u1', a.id)?.id).toBe(a.id);
    expect(getJob('u2', a.id)).toBeUndefined(); // wrong owner → not found
    expect(listJobs('u2').some((j) => j.id === a.id)).toBe(false);
  });

  it('lists newest-first and honors the limit', () => {
    const u = 'order-user';
    const first = createJob({ userId: u, kind: 'execute', summary: '1' });
    vi.advanceTimersByTime(10);
    const second = createJob({ userId: u, kind: 'execute', summary: '2' });

    const all = listJobs(u);
    expect(all[0].id).toBe(second.id);
    expect(all[1].id).toBe(first.id);
    expect(listJobs(u, 1)).toHaveLength(1);
  });

  it('auto-expires an unanswered job past expires_in', () => {
    const job = createJob({ userId: 'exp', kind: 'ask', summary: 'q', status: 'awaiting_reply', expiresInMs: 1000 });
    expect(getJob('exp', job.id)?.status).toBe('awaiting_reply');

    vi.advanceTimersByTime(1500);
    expect(getJob('exp', job.id)?.status).toBe('expired');
  });

  it('does not resurrect a terminal job (late bridge reply after expiry)', () => {
    const job = createJob({ userId: 'term', kind: 'ask', summary: 'q', status: 'awaiting_reply', expiresInMs: 100 });
    vi.advanceTimersByTime(200);
    expect(getJob('term', job.id)?.status).toBe('expired');

    // A reply arrives after expiry — must be ignored.
    completeJob(job.id, { ok: true }, 'yes');
    expect(getJob('term', job.id)?.status).toBe('expired');
  });

  it('completeJob/failJob set terminal state + projection', () => {
    const ok = createJob({ userId: 'p', kind: 'execute', summary: 'run x', status: 'running' });
    completeJob(ok.id, { success: true, value: 42 });
    const proj = publicJob(getJob('p', ok.id)!);
    expect(proj.status).toBe('completed');
    expect(proj.job_id).toBe(ok.id);
    expect(proj.result).toEqual({ success: true, value: 42 });

    const bad = createJob({ userId: 'p', kind: 'execute', summary: 'run y', status: 'running' });
    failJob(bad.id, 'boom');
    expect(getJob('p', bad.id)?.status).toBe('failed');
    expect(getJob('p', bad.id)?.error).toBe('boom');
  });

  it('updateJob is a no-op once terminal', () => {
    const job = createJob({ userId: 'nt', kind: 'execute', summary: 'z', status: 'running' });
    completeJob(job.id, { success: true });
    updateJob(job.id, { status: 'running' });
    expect(getJob('nt', job.id)?.status).toBe('completed');
  });
});