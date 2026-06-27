import { beforeEach, describe, expect, it, vi } from 'vitest';

const { proactiveServiceMock } = vi.hoisted(() => ({
  proactiveServiceMock: {
    listTasks: vi.fn(),
    updateTask: vi.fn(),
    addTask: vi.fn(),
    deleteTask: vi.fn(),
  },
}));

vi.mock('../../services/proactive-service', () => ({
  proactiveService: proactiveServiceMock,
}));

import { execProactiveTaskCreate, execProactiveTaskList, execProactiveTaskUpdate, execProactiveTaskDelete } from './proactive';

describe('proactive task handlers', () => {
  const ctx = {} as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists tasks from the proactive service', async () => {
    proactiveServiceMock.listTasks.mockReturnValue({ ok: true, tasks: [{ id: '1' }] });
    await expect(execProactiveTaskList({}, ctx)).resolves.toEqual({ ok: true, tasks: [{ id: '1' }] });
  });

  it('validates task updates before delegating', async () => {
    await expect(execProactiveTaskUpdate({ task_id: '', status: 'completed' }, ctx)).resolves.toEqual({ ok: false, error: 'task_id is required' });
    await expect(execProactiveTaskUpdate({ task_id: '1', status: 'bogus' }, ctx)).resolves.toEqual({ ok: false, error: 'status must be queued, in_progress, completed, or failed' });

    proactiveServiceMock.updateTask.mockReturnValue({ ok: true, task: { id: '1', status: 'completed' } });
    await expect(execProactiveTaskUpdate({ task_id: '1', status: 'completed', result: 'Done' }, ctx)).resolves.toEqual({ ok: true, task: { id: '1', status: 'completed' } });
    expect(proactiveServiceMock.updateTask).toHaveBeenCalledWith('1', { status: 'completed', result: 'Done' });
  });

  it('creates queued tasks by default', async () => {
    proactiveServiceMock.addTask.mockReturnValue({ ok: true, task: { id: '2', status: 'queued' } });
    await expect(execProactiveTaskCreate({ title: 'Follow up' }, ctx)).resolves.toEqual({ ok: true, task: { id: '2', status: 'queued' } });
    expect(proactiveServiceMock.addTask).toHaveBeenCalledWith({ title: 'Follow up', instructions: '', status: 'queued' });
  });

  it('deletes a task by id', async () => {
    proactiveServiceMock.deleteTask.mockReturnValue({ ok: true, tasks: [] });
    await expect(execProactiveTaskDelete({ task_id: '1' }, ctx)).resolves.toEqual({ ok: true, tasks: [] });
    expect(proactiveServiceMock.deleteTask).toHaveBeenCalledWith('1');
  });

  it('requires task_id for delete', async () => {
    await expect(execProactiveTaskDelete({}, ctx)).resolves.toEqual({ ok: false, error: 'task_id is required' });
    expect(proactiveServiceMock.deleteTask).not.toHaveBeenCalled();
  });
});