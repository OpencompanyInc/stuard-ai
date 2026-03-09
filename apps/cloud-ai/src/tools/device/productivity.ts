import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { calendar_list_events } from '../google-tools';
import { execLocalTool, hasClientBridge, makeLocalTool } from './shared';

export const calendar_crud = makeLocalTool(
  'calendar_crud',
  'Create, read, update, delete calendars stored locally by Stuard.',
  z.object({ action: z.string(), data: z.any().optional() }),
);

export const task_crud = makeLocalTool(
  'task_crud',
  'Full task management with priorities, due dates, tags for Stuard local tasks.',
  z.object({ action: z.string(), data: z.any().optional() }),
);

export const task_reminders = makeLocalTool(
  'task_reminders',
  'Schedule, update, cancel/delete, list, and resume Stuard local reminders.',
  z.object({
    action: z.enum(['schedule', 'update', 'cancel', 'delete', 'list', 'resume']),
    when: z.string().optional().describe('When to fire the reminder (ISO8601 or relative seconds, for schedule).'),
    scheduledAt: z.string().optional().describe('Explicit reminder datetime (ISO8601), primarily for update.'),
    message: z.string().optional().describe('Reminder message (for schedule).'),
    taskId: z.string().optional().describe('Optional associated task ID (for schedule).'),
    id: z.string().optional().describe('Reminder ID (for cancel).'),
    recurrence: z.any().optional().describe('Optional recurrence object for repeating reminders.'),
  }),
);

export const unified_task_assignments = makeLocalTool(
  'unified_task_assignments',
  'Manage user task assignments (reminders, actions, check-ins scheduled by the user for the agent). ' +
  'Use this to list pending assignments, mark them as triggered/completed, or get assignment details.',
  z.object({
    action: z.enum(['list_pending', 'mark_triggered', 'mark_completed', 'get_task']).describe(
      'Action: list_pending (get due assignments), mark_triggered (when you start handling), ' +
      'mark_completed (when done), get_task (get full task details)'
    ),
    taskId: z.string().optional().describe('Task ID (required for mark_triggered, mark_completed, get_task).'),
    assignmentId: z.string().optional().describe('Assignment ID (required for mark_triggered, mark_completed).'),
  }),
);

// Unified planner helper: aggregate meetings (Google Calendar), local tasks, and local reminders
export const planner_list_items = createTool({
  id: 'planner_list_items',
  description:
    'Get a unified list of meetings/events, Stuard local tasks, and Stuard reminders for a time range. ' +
    'Use this for questions like "what meetings do I have this week?" or "what tasks are due today?". ' +
    'Each item includes a provider field such as "google_calendar" or "local".',
  inputSchema: z.object({
    range: z.enum(['today', 'this_week', 'custom']).default('today'),
    start: z.string().optional().describe('ISO 8601 start (when range="custom").'),
    end: z.string().optional().describe('ISO 8601 end (when range="custom").'),
    maxEvents: z.number().int().min(1).max(500).default(250).describe('Maximum number of calendar events to return.'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    items: z
      .array(
        z.object({
          id: z.string(),
          title: z.string(),
          provider: z.string().describe('Source provider, e.g. "google_calendar" or "local".'),
          kind: z.enum(['event', 'task', 'reminder']),
          start: z.string().optional().describe('ISO 8601 start time (if applicable).'),
          end: z.string().optional().describe('ISO 8601 end time (if applicable).'),
          allDay: z.boolean().optional(),
          source: z.string().optional().describe('Optional source label, e.g. "primary".'),
          raw: z.any().optional().describe('Raw underlying object for advanced use.'),
        }),
      )
      .optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData, context) => {
    const c = inputData as any;

    // Compute time range
    let start: Date | null = null;
    let end: Date | null = null;
    const now = new Date();

    const startOfDay = (d: Date) => {
      const x = new Date(d);
      x.setHours(0, 0, 0, 0);
      return x;
    };
    const endOfDay = (d: Date) => {
      const x = new Date(d);
      x.setHours(23, 59, 59, 999);
      return x;
    };

    if (c.range === 'today') {
      start = startOfDay(now);
      end = endOfDay(now);
    } else if (c.range === 'this_week') {
      // Monday–Sunday week, similar to dashboard behaviour
      const d = startOfDay(now);
      const day = d.getDay(); // 0=Sun..6=Sat
      const diffToMonday = (day + 6) % 7; // convert so Monday=0
      d.setDate(d.getDate() - diffToMonday);
      start = startOfDay(d);
      const e = new Date(start);
      e.setDate(e.getDate() + 6);
      end = endOfDay(e);
    } else if (c.range === 'custom') {
      try {
        if (c.start) start = new Date(String(c.start));
        if (c.end) end = new Date(String(c.end));
      } catch {}
    }

    if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return { ok: false, items: [], error: 'invalid_range' };
    }

    const items: any[] = [];

    // Helper to check if a date is within range
    const inRange = (dt: Date | null) => {
      if (!dt || Number.isNaN(dt.getTime())) return false;
      return dt.getTime() >= start!.getTime() && dt.getTime() <= end!.getTime();
    };

    // Local Stuard tasks (from tasks.db)
    try {
      if (hasClientBridge()) {
        const taskRes: any = await execLocalTool('task_crud', { action: 'list', data: {} }, undefined as any, 30000);
        const tItems = Array.isArray(taskRes?.items) ? taskRes.items : [];
        for (const t of tItems) {
          if (!t || !t.due) continue;
          let dt: Date | null = null;
          try {
            dt = new Date(String(t.due));
          } catch {
            dt = null;
          }
          if (!inRange(dt)) continue;
          items.push({
            id: `local-task:${String(t.id ?? '')}`,
            title: String(t.title || '(task)'),
            provider: 'local',
            kind: 'task' as const,
            start: dt?.toISOString(),
            end: dt?.toISOString(),
            allDay: false,
            source: 'tasks',
            raw: t,
          });
        }
      }
    } catch {
      // Ignore local task failures; other providers may still work
    }

    // Local Stuard reminders
    try {
      if (hasClientBridge()) {
        const remRes: any = await execLocalTool('task_reminders', { action: 'list' }, undefined as any, 30000);
        const rItems = Array.isArray(remRes?.items) ? remRes.items : [];
        for (const r of rItems) {
          if (!r) continue;
          let dt: Date | null = null;
          try {
            if (r.whenIso) dt = new Date(String(r.whenIso));
            else if (r.whenEpochMs) dt = new Date(Number(r.whenEpochMs));
          } catch {
            dt = null;
          }
          if (!inRange(dt)) continue;
          items.push({
            id: `local-reminder:${String(r.id ?? '')}`,
            title: String(r.message || 'Reminder'),
            provider: 'local',
            kind: 'reminder' as const,
            start: dt?.toISOString(),
            end: dt?.toISOString(),
            allDay: false,
            source: 'reminders',
            raw: r,
          });
        }
      }
    } catch {
      // Ignore reminder failures
    }

    // Google Calendar events (primary)
    let calendarError: string | null = null;
    try {
      const calRes: any = await (calendar_list_events.execute as any)({
        context: {
          calendarId: 'primary',
          timeMin: start.toISOString(),
          timeMax: end.toISOString(),
          maxResults: Number(c.maxEvents || 250),
          singleEvents: true,
          orderBy: 'startTime',
        },
      } as any);

      if (calRes && Array.isArray(calRes.items)) {
        for (const ev of calRes.items) {
          if (!ev) continue;
          const startField = ev.start || {};
          const endField = ev.end || {};
          const startStr = startField.dateTime || startField.date || '';
          const endStr = endField.dateTime || endField.date || '';
          let sDt: Date | null = null;
          let eDt: Date | null = null;
          try {
            if (startStr) sDt = new Date(String(startStr));
            if (endStr) eDt = new Date(String(endStr));
          } catch {
            sDt = null;
            eDt = null;
          }
          if (!inRange(sDt)) continue;
          const allDay = !!startField.date && !startField.dateTime;
          items.push({
            id: `gcal:${String(ev.id ?? '')}`,
            title: String(ev.summary || '(No Title)'),
            provider: 'google_calendar',
            kind: 'event' as const,
            start: sDt?.toISOString(),
            end: eDt?.toISOString(),
            allDay,
            source: String(ev.creator?.email || 'primary'),
            raw: ev,
          });
        }
      } else if (calRes && calRes.ok === false) {
        calendarError = String(calRes.error || 'calendar_not_available');
      }
    } catch (e: any) {
      calendarError = e?.message || 'calendar_fetch_failed';
    }

    // Sort by start time if present
    items.sort((a, b) => {
      const ta = a.start ? new Date(a.start).getTime() : 0;
      const tb = b.start ? new Date(b.start).getTime() : 0;
      return ta - tb;
    });

    if (!items.length && calendarError) {
      return { ok: false, items: [], error: calendarError };
    }

    return { ok: true, items };
  },
});

// Generic local notification helper
export const send_notification = makeLocalTool(
  'send_notification',
  'Show a local desktop notification (OS toast) with optional linkage to tasks or workflow runs.',
  z.object({
    title: z.string().optional(),
    message: z.string().optional(),
    body: z.string().optional(),
    severity: z.enum(['info', 'success', 'warning', 'error', 'neutral']).optional(),
    variant: z.enum(['info', 'success', 'warning', 'error', 'neutral']).optional(),
    position: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right']).optional(),
    duration: z.number().optional(),
    durationMs: z.number().optional(),
    dismissible: z.boolean().optional(),
    sound: z.boolean().optional(),
    progress: z.number().optional(),
    image: z.string().optional(),
    imagePath: z.string().optional(),
    showInput: z.boolean().optional(),
    waitForInput: z.boolean().optional(),
    inputPlaceholder: z.string().optional(),
    inputDefaultValue: z.string().optional(),
    inputSubmitText: z.string().optional(),
    inputCancelText: z.string().optional(),
    inputType: z.enum(['text', 'password', 'email', 'number']).optional(),
    keepAfterSubmit: z.boolean().optional(),
    timeoutMs: z.number().optional(),
    taskId: z.string().optional(),
    workflowRunId: z.string().optional(),
  }),
);
