/**
 * Built-in slash commands (/remind, /task, /run) + workflow-as-command support.
 *
 * Reminders/tasks write straight to the unified tasks store over IPC — no
 * model round-trip. Workflow runs go through workflows:run with the values
 * collected from the workflow trigger's declared inputParams, which the
 * engine exposes to steps as {{input.x}} / {{args.x}}.
 */
import { Bell, Bookmark, ListTodo, Play } from 'lucide-react';
import { parseWhen } from './parseWhen';
import type { SlashCommandSpec, SlashFieldSpec, SlashRunResult, SlashSession } from './types';

const api = () => (window as any).desktopAPI;

async function createReminder(values: Record<string, string>): Promise<SlashRunResult> {
  const what = String(values.what || '').trim();
  const whenText = String(values.when || '').trim();
  if (!what) return { ok: false, message: 'What should I remind you about?' };
  const when = parseWhen(whenText);
  if (!when.date) return { ok: false, message: `Couldn't understand "${whenText}" — try "tomorrow 9am"` };

  const taskRes = await api()?.unifiedTasksAdd?.({ title: what, showInCalendar: true });
  if (!taskRes?.ok || !taskRes.task?.id) return { ok: false, message: taskRes?.error || 'Failed to save reminder' };
  const remRes = await api()?.unifiedTasksAddReminder?.(taskRes.task.id, {
    scheduledAt: when.date.toISOString(),
    message: what,
    recurring: when.recurrence ?? 'none',
  });
  if (!remRes?.ok) return { ok: false, message: remRes?.error || 'Failed to schedule reminder' };
  return { ok: true, message: `Reminder set · ${when.label}` };
}

async function createTask(values: Record<string, string>): Promise<SlashRunResult> {
  const title = String(values.title || '').trim();
  if (!title) return { ok: false, message: 'Task needs a title' };
  const whenText = String(values.when || '').trim();
  const when = whenText ? parseWhen(whenText) : null;
  if (whenText && !when?.date) {
    return { ok: false, message: `Couldn't understand "${whenText}" — try "friday 5pm"` };
  }

  const priority = String(values.priority || 'normal').toLowerCase();
  const taskRes = await api()?.unifiedTasksAdd?.({
    title,
    dueDate: when?.date ? when.date.toISOString() : null,
    priority,
    showInCalendar: true,
  });
  if (!taskRes?.ok || !taskRes.task?.id) return { ok: false, message: taskRes?.error || 'Failed to add task' };

  // A recurring "when" on a task ("every monday") also schedules the nudge.
  if (when?.date && when.recurrence) {
    await api()?.unifiedTasksAddReminder?.(taskRes.task.id, {
      scheduledAt: when.date.toISOString(),
      message: title,
      recurring: when.recurrence,
    });
  }
  return { ok: true, message: when?.label ? `Task added · ${when.label}` : 'Task added' };
}

async function createBookmark(values: Record<string, string>): Promise<SlashRunResult> {
  const name = String(values.name || '').trim();
  let target = String(values.target || '').trim();
  const type = String(values.type || 'url').toLowerCase() as 'url' | 'app' | 'file' | 'folder';
  if (!name) return { ok: false, message: 'Give the shortcut a name' };
  if (!target) return { ok: false, message: 'What should it open? (URL or path)' };
  // Normalize a bare domain into a URL so "google.com" still opens in a browser.
  if (type === 'url' && !/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) {
    target = `https://${target}`;
  }

  const id = `bm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const res = await api()?.bookmarksAdd?.({ id, name, type, target });
  if (!res?.ok) return { ok: false, message: res?.error || 'Failed to save shortcut' };
  // Nudge any mounted useBookmarks() hooks (search dropdown, launcher grid) to
  // reload from disk so the new shortcut shows up without reopening the overlay.
  try { window.dispatchEvent(new CustomEvent('stuard:bookmarks-changed')); } catch { /* best effort */ }
  return { ok: true, message: `Shortcut saved · ${name}` };
}

export const BUILTIN_COMMANDS: SlashCommandSpec[] = [
  {
    id: 'remind',
    title: 'Remind me',
    subtitle: 'Get pinged at a time — "every monday 9am" works',
    icon: Bell,
    fields: [
      { key: 'what', hint: 'what…', kind: 'text', required: true },
      { key: 'when', hint: 'when…', kind: 'when', required: true },
    ],
    run: createReminder,
  },
  {
    id: 'task',
    title: 'Create task',
    subtitle: 'Add a to-do to your planner',
    icon: ListTodo,
    fields: [
      { key: 'title', hint: 'task…', kind: 'text', required: true },
      { key: 'when', hint: 'due… (optional)', kind: 'when' },
      { key: 'priority', hint: 'priority', kind: 'select', options: ['normal', 'high', 'urgent', 'low'], defaultValue: 'normal' },
    ],
    run: createTask,
  },
  {
    id: 'bookmark',
    title: 'Save shortcut',
    subtitle: 'Pin a site, app, file or folder to quick actions',
    icon: Bookmark,
    fields: [
      { key: 'name', hint: 'name…', kind: 'text', required: true },
      { key: 'target', hint: 'https://… or path', kind: 'text', required: true },
      { key: 'type', hint: 'type', kind: 'select', options: ['url', 'app', 'file', 'folder'], defaultValue: 'url' },
    ],
    run: createBookmark,
  },
];

/** Minimal info the menu needs about a runnable local workflow. */
export interface SlashWorkflowItem {
  id: string;
  name: string;
  description?: string;
}

let workflowsCache: { at: number; items: SlashWorkflowItem[] } | null = null;

/** Lazily list local workflows (cached ~15s so the menu stays snappy). */
export async function listSlashWorkflows(): Promise<SlashWorkflowItem[]> {
  if (workflowsCache && Date.now() - workflowsCache.at < 15_000) return workflowsCache.items;
  try {
    const res = await api()?.workflowsList?.();
    const items: SlashWorkflowItem[] = (res?.ok && Array.isArray(res.items))
      ? res.items.map((w: any) => ({
          id: String(w.id),
          name: String(w.name || w.id),
          description: typeof w.description === 'string' ? w.description : undefined,
        }))
      : [];
    workflowsCache = { at: Date.now(), items };
    return items;
  } catch {
    return workflowsCache?.items ?? [];
  }
}

function fieldFromInputParam(p: any): SlashFieldSpec {
  const type = String(p?.type || 'string');
  const name = String(p?.name || '');
  const desc = typeof p?.description === 'string' && p.description.trim() ? p.description.trim() : '';
  if (type === 'boolean') {
    return {
      key: name,
      hint: name,
      kind: 'select',
      options: ['true', 'false'],
      defaultValue: p?.defaultValue !== undefined ? String(p.defaultValue) : 'true',
      required: !!p?.required,
      paramType: type,
    };
  }
  // Dropdown param — the publisher fixed the valid choices, so the runner picks
  // one from the list instead of typing it. Falls back to free text if the
  // options list is empty/malformed.
  if (type === 'select' && Array.isArray(p?.options) && p.options.length > 0) {
    const options = p.options.map((o: any) => String(o)).filter((o: string) => o.trim());
    if (options.length > 0) {
      const def = p?.defaultValue !== undefined && options.includes(String(p.defaultValue))
        ? String(p.defaultValue)
        : options[0];
      return {
        key: name,
        hint: desc ? `${name} — ${desc}` : name,
        kind: 'select',
        options,
        defaultValue: def,
        required: !!p?.required,
        paramType: type,
      };
    }
  }
  return {
    key: name,
    hint: desc ? `${name} — ${desc}` : `${name}…`,
    kind: 'text',
    required: !!p?.required,
    defaultValue: p?.defaultValue !== undefined && p.defaultValue !== null ? String(p.defaultValue) : undefined,
    paramType: type,
  };
}

function coerceParam(value: string, paramType?: string): any {
  const v = value.trim();
  switch (paramType) {
    case 'number': {
      const n = Number(v);
      return Number.isFinite(n) ? n : v;
    }
    case 'boolean':
      return v.toLowerCase() === 'true';
    case 'json':
    case 'array':
      try { return JSON.parse(v); } catch { return v; }
    default:
      return v;
  }
}

/**
 * Build a composer session for a workflow. Reads the workflow model, pulls
 * inputParams off its trigger (any trigger that declares them), and turns
 * each one into a composer field. Workflows without params get zero fields —
 * the caller runs them immediately.
 */
export async function buildWorkflowSession(
  workflow: SlashWorkflowItem,
  getAccessToken: () => Promise<string | null>,
): Promise<SlashSession> {
  let fields: SlashFieldSpec[] = [];
  let triggerId: string | undefined;
  try {
    const read = await api()?.workflowsRead?.(workflow.id);
    if (read?.ok && typeof read.content === 'string') {
      const model = JSON.parse(read.content || '{}');
      const triggers: any[] = Array.isArray(model?.triggers) ? model.triggers : [];
      const withParams = triggers.find((t) => Array.isArray(t?.inputParams) && t.inputParams.length > 0)
        || triggers.find((t) => Array.isArray(t?.args?.inputParams) && t.args.inputParams.length > 0);
      const params: any[] = withParams?.inputParams || withParams?.args?.inputParams || [];
      if (withParams && params.length > 0) {
        triggerId = String(withParams.id || '') || undefined;
        fields = params
          .filter((p) => String(p?.name || '').trim())
          .map(fieldFromInputParam);
      }
    }
  } catch {
    // Unreadable model — run without params.
  }

  const paramTypes: Record<string, string | undefined> = {};
  for (const f of fields) paramTypes[f.key] = f.paramType;

  return {
    commandId: `run:${workflow.id}`,
    title: workflow.name,
    icon: Play,
    fields,
    run: async (values: Record<string, string>): Promise<SlashRunResult> => {
      const inputs: Record<string, any> = {};
      for (const [k, v] of Object.entries(values)) {
        if (String(v ?? '').trim() === '') continue;
        inputs[k] = coerceParam(String(v), paramTypes[k]);
      }
      const accessToken = await getAccessToken().catch(() => null);
      const res = await api()?.workflowsRun?.(workflow.id, triggerId, {
        ...(accessToken ? { accessToken } : {}),
        ...(Object.keys(inputs).length > 0 ? { inputs } : {}),
      });
      if (!res?.ok) return { ok: false, message: res?.error || 'Failed to start workflow' };
      try { api()?.notify?.('Workflow Started', `Running ${workflow.name}…`); } catch { /* best effort */ }
      return { ok: true, message: `Running ${workflow.name}` };
    },
  };
}
