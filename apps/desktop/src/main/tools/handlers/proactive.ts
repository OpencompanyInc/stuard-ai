import { proactiveService } from '../../services/proactive-service';
import type { RouterContext } from '../types';

const VALID_STATUSES = new Set(['queued', 'in_progress', 'completed', 'failed']);

export async function execProactiveTaskList(_args: any, _ctx: RouterContext): Promise<any> {
  return proactiveService.listTasks();
}

export async function execProactiveTaskUpdate(args: any, _ctx: RouterContext): Promise<any> {
  const taskId = String(args?.task_id || args?.id || '').trim();
  const status = String(args?.status || '').trim();
  const result = typeof args?.result === 'string' ? args.result : undefined;

  if (!taskId) return { ok: false, error: 'task_id is required' };
  if (!VALID_STATUSES.has(status)) return { ok: false, error: 'status must be queued, in_progress, completed, or failed' };

  return proactiveService.updateTask(taskId, { status: status as any, result });
}

export async function execProactiveTaskCreate(args: any, _ctx: RouterContext): Promise<any> {
  const title = String(args?.title || '').trim();
  const instructions = typeof args?.instructions === 'string' ? args.instructions : '';
  const status = typeof args?.status === 'string' && VALID_STATUSES.has(args.status) ? args.status : 'queued';

  if (!title) return { ok: false, error: 'title is required' };

  return proactiveService.addTask({ title, instructions, status: status as any });
}

export async function execProactiveTaskDelete(args: any, _ctx: RouterContext): Promise<any> {
  const taskId = String(args?.task_id || args?.id || '').trim();
  if (!taskId) return { ok: false, error: 'task_id is required' };

  return proactiveService.deleteTask(taskId);
}