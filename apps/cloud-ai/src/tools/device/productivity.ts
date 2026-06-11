import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { calendar_list_events } from '../google-tools';
import { execLocalTool, hasClientBridge, makeLocalTool, getBridgeSecrets, anyJsonObject } from './shared';
import { syncReminderToCloud, getCloudReminders } from '../cloud-reminder-tools';

export const calendar_crud = makeLocalTool(
  'calendar_crud',
  'Create, read, update, delete calendars stored locally by Stuard.',
  z.object({ action: z.string(), data: anyJsonObject.optional() }),
);

const _task_crud_base = makeLocalTool(
  'task_crud',
  'Full task management with priorities, due dates, tags for Stuard local tasks.',
  z.object({
    action: z.string(),
    data: anyJsonObject.optional(),
    /**
     * When in Project Mode and creating a task, pass the conversation_id (from
     * <conversation> in your system prompt) so the wrapper can auto-tag the
     * task with the active project_id. If the user is not in project mode this
     * is a no-op.
     */
    conversation_id: z.string().optional(),
  }),
);

// Wrap task_crud:
//  • on create: auto-inject projectId from the active project (if any) when the
//    caller passed a conversation_id and didn't already set projectId.
//  • on list: post-filter to respect limit/offset/status, and (when
//    conversation_id is supplied) prefer same-project results so AI list calls
//    don't drown in global tasks.
export const task_crud = createTool({
  id: _task_crud_base.id!,
  description:
    _task_crud_base.description! +
    ' For list action, pass limit (default 20), offset (default 0), and optional status in data to reduce payload.' +
    ' When working inside Project Mode, pass `conversation_id` so creates are auto-scoped to the active project and lists prioritize project-scoped tasks.',
  inputSchema: (_task_crud_base as any).inputSchema,
  outputSchema: z.any(),
  execute: async (input, context) => {
    const inp = input as any;

    // Resolve active project from conversation if caller provided one.
    let activeProjectId: string | null = null;
    if (inp.conversation_id && (inp.action === 'create' || inp.action === 'list')) {
      try {
        const convo: any = await execLocalTool(
          'conversation_get',
          { conversation_id: inp.conversation_id },
          undefined as any,
          5000,
        );
        const pid = convo?.conversation?.project_id;
        if (pid) activeProjectId = String(pid);
      } catch {
        /* best-effort */
      }
    }

    // Inject projectId on create when not already set.
    if (inp.action === 'create' && activeProjectId) {
      const data = (inp.data && typeof inp.data === 'object') ? inp.data : {};
      if (!data.projectId) {
        inp.data = { ...data, projectId: activeProjectId };
      }
    }

    const result = await (_task_crud_base.execute as any)(inp, context);

    // Post-filter list results
    if (inp.action === 'list' && result && Array.isArray(result.items)) {
      const d = inp.data || {};
      const limit = typeof d.limit === 'number' ? Math.min(Math.max(d.limit, 1), 100) : 20;
      const offset = typeof d.offset === 'number' ? Math.max(d.offset, 0) : 0;
      let items = result.items;

      if (d.status) {
        items = items.filter((t: any) => t?.status === d.status);
      }

      // When in project mode, surface that project's tasks first.
      if (activeProjectId) {
        const inProject = items.filter((t: any) => t?.projectId === activeProjectId);
        const others = items.filter((t: any) => t?.projectId !== activeProjectId);
        items = [...inProject, ...others];
        result.activeProjectId = activeProjectId;
      }

      const total = items.length;
      result.items = items.slice(offset, offset + limit);
      result.total = total;
      result.hasMore = offset + limit < items.length;
    }

    return result;
  },
});

const recurrenceSchema = z.object({
  frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']).describe('How often to repeat.'),
  interval: z.number().int().min(1).optional().describe('Every N units, e.g. 2 for every 2 weeks (default 1).'),
  days: z.array(z.number().int().min(0).max(6)).optional().describe('Days of week to fire: 0=Mon..6=Sun. Only used when frequency is "weekly".'),
  until: z.string().optional().describe('ISO 8601 date/time after which recurrence stops.'),
  count: z.number().int().min(1).optional().describe('Maximum number of times the reminder fires before stopping.'),
}).describe('Recurrence rule. Omit entirely for a one-time reminder.');

const _task_reminders_base = makeLocalTool(
  'task_reminders',
  'Schedule, update, cancel/delete, list, and resume reminders. Supports one-time and recurring reminders. ' +
  'Set cloud_notify=true to also auto-send an SMS or WhatsApp message at the scheduled time (works even when desktop is offline). ' +
  'For list action, use limit (default 20) and offset (default 0) to paginate results.',
  z.object({
    action: z.enum(['schedule', 'update', 'cancel', 'delete', 'list', 'resume']).describe(
      'schedule: create a new reminder | update: modify an existing reminder | cancel/delete: remove a reminder | list: list all pending reminders | resume: restart pending reminders after agent restart'
    ),
    when: z.string().optional().describe('When to fire: ISO 8601 datetime or relative seconds (e.g. "300" = 5 min from now). Required for schedule.'),
    scheduledAt: z.string().optional().describe('Explicit ISO 8601 datetime. Alternative to "when", primarily used in update.'),
    message: z.string().optional().describe('Reminder message text. Required for schedule.'),
    taskId: z.string().optional().describe('Optional task ID to associate with this reminder.'),
    id: z.string().optional().describe('Reminder ID. Required for update, cancel, and delete.'),
    recurrence: recurrenceSchema.optional().describe('Make this reminder repeat. Omit for one-time. Pass null/undefined in update to remove recurrence.'),
    cloud_notify: z.boolean().optional().describe('When true, also sends an SMS/WhatsApp at the scheduled time via the cloud. Requires a connected Telnyx or WhatsApp number.'),
    cloud_notify_method: z.enum(['sms', 'whatsapp', 'both']).optional().describe('Delivery method for cloud notification. Default: "sms".'),
    limit: z.number().int().min(1).max(100).default(20).optional().describe('Max items for list action (default 20).'),
    offset: z.number().int().min(0).default(0).optional().describe('Skip N items for list pagination (default 0).'),
    conversation_id: z
      .string()
      .optional()
      .describe('In Project Mode, pass the conversation ID so the backing task is created project-scoped and lists prioritize this project.'),
  }),
);

// Wrap task_reminders:
//  • Project Mode (conversation_id provided): on schedule without taskId, create a
//    project-scoped task first via task_crud and schedule against it — keeps the
//    reminder visible inside the project's tasks tab.
//  • On schedule with cloud_notify: sync to cloud for offline SMS/WhatsApp.
//  • On list: post-filter with limit/offset, and when in project mode bubble
//    reminders attached to project-scoped tasks to the top.
export const task_reminders = createTool({
  id: _task_reminders_base.id!,
  description:
    _task_reminders_base.description! +
    ' When in Project Mode, pass `conversation_id` so new reminders are anchored to a project-scoped task.',
  inputSchema: (_task_reminders_base as any).inputSchema,
  outputSchema: z.any(),
  execute: async (input, context) => {
    const inp = input as any;

    // Resolve active project from conversation if caller provided one.
    let activeProjectId: string | null = null;
    if (inp.conversation_id) {
      try {
        const convo: any = await execLocalTool(
          'conversation_get',
          { conversation_id: inp.conversation_id },
          undefined as any,
          5000,
        );
        const pid = convo?.conversation?.project_id;
        if (pid) activeProjectId = String(pid);
      } catch {
        /* best-effort */
      }
    }

    // Project-scope a fresh reminder by creating a project-tagged task first.
    if (
      inp.action === 'schedule' &&
      activeProjectId &&
      !inp.taskId &&
      typeof inp.message === 'string' &&
      inp.message.trim().length > 0
    ) {
      try {
        const created: any = await execLocalTool(
          'task_crud',
          {
            action: 'create',
            data: {
              title: inp.message,
              status: 'pending',
              priority: 'normal',
              projectId: activeProjectId,
            },
          },
          undefined as any,
          10000,
        );
        const newTaskId = created?.task?.id || created?.item?.id || created?.id;
        if (newTaskId) {
          inp.taskId = String(newTaskId);
        }
      } catch (e: any) {
        // Non-fatal — fall through to the default reminder path. The Python
        // side will auto-create an un-scoped task as a safety net.
        console.error('[task_reminders] project-scope task pre-create failed:', e?.message);
      }
    }

    const result = await (_task_reminders_base.execute as any)(inp, context);

    // Post-filter list results with limit/offset, and surface project-scoped
    // reminders first when we know the active project.
    if (inp.action === 'list' && result && Array.isArray(result.items)) {
      const limit = typeof inp.limit === 'number' ? Math.min(Math.max(inp.limit, 1), 100) : 20;
      const offset = typeof inp.offset === 'number' ? Math.max(inp.offset, 0) : 0;
      let items = result.items;

      if (activeProjectId) {
        const projectTaskIds = new Set<string>();
        try {
          const taskList: any = await execLocalTool(
            'task_crud',
            { action: 'list', data: { limit: 500 } },
            undefined as any,
            10000,
          );
          for (const t of taskList?.items || []) {
            if (t?.projectId === activeProjectId && t?.id) {
              projectTaskIds.add(String(t.id));
            }
          }
        } catch {
          /* best-effort — fall through to un-prioritized list */
        }
        if (projectTaskIds.size > 0) {
          const inProject = items.filter((r: any) => r?.taskId && projectTaskIds.has(String(r.taskId)));
          const others = items.filter((r: any) => !(r?.taskId && projectTaskIds.has(String(r.taskId))));
          items = [...inProject, ...others];
          result.activeProjectId = activeProjectId;
        }
      }

      const total = items.length;
      result.items = items.slice(offset, offset + limit);
      result.total = total;
      result.hasMore = offset + limit < total;
    }

    // Auto-sync to cloud when cloud_notify is set
    if (inp.action === 'schedule' && inp.cloud_notify && inp.message && (inp.when || inp.scheduledAt)) {
      try {
        const secrets = getBridgeSecrets();
        const userId = secrets?.userId || (context as any)?.userId || (context as any)?.resourceId;
        if (userId) {
          await syncReminderToCloud(userId, {
            when: inp.when || inp.scheduledAt,
            message: inp.message,
            recurrence: inp.recurrence,
            cloud_notify_method: inp.cloud_notify_method,
          });
        }
      } catch (e: any) {
        console.error('[task_reminders] Cloud sync failed (non-blocking):', e?.message);
      }
    }

    return result;
  },
});

const _unified_task_assignments_base = makeLocalTool(
  'unified_task_assignments',
  'Manage user task assignments (reminders, actions, check-ins scheduled by the user for the agent). ' +
  'Use this to list pending assignments, mark them as triggered/completed, or get assignment details. ' +
  'For list_pending, use limit (default 20) and offset (default 0) to paginate.',
  z.object({
    action: z.enum(['list_pending', 'mark_triggered', 'mark_completed', 'get_task']).describe(
      'Action: list_pending (get due assignments), mark_triggered (when you start handling), ' +
      'mark_completed (when done), get_task (get full task details)'
    ),
    taskId: z.string().optional().describe('Task ID (required for mark_triggered, mark_completed, get_task).'),
    assignmentId: z.string().optional().describe('Assignment ID (required for mark_triggered, mark_completed).'),
    limit: z.number().int().min(1).max(100).default(20).optional().describe('Max items for list_pending (default 20).'),
    offset: z.number().int().min(0).default(0).optional().describe('Skip N items for pagination (default 0).'),
  }),
);

export const unified_task_assignments = createTool({
  id: _unified_task_assignments_base.id!,
  description: _unified_task_assignments_base.description!,
  inputSchema: (_unified_task_assignments_base as any).inputSchema,
  outputSchema: z.any(),
  execute: async (input, context) => {
    const result = await (_unified_task_assignments_base.execute as any)(input, context);
    const inp = input as any;

    // Post-filter list_pending results
    if (inp.action === 'list_pending' && result && Array.isArray(result.items)) {
      const limit = typeof inp.limit === 'number' ? Math.min(Math.max(inp.limit, 1), 100) : 20;
      const offset = typeof inp.offset === 'number' ? Math.max(inp.offset, 0) : 0;
      const total = result.items.length;
      result.items = result.items.slice(offset, offset + limit);
      result.total = total;
      result.hasMore = offset + limit < total;
    }

    return result;
  },
});

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
    maxItems: z.number().int().min(1).max(500).default(50).describe('Maximum total items (events + tasks + reminders) to return (default 50).'),
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
        const taskRes: any = await execLocalTool('task_crud', { action: 'list', data: { limit: 500 } }, undefined as any, 30000);
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
        const remRes: any = await execLocalTool('task_reminders', { action: 'list', limit: 500 }, undefined as any, 30000);
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

    // Cloud reminders (synced, with SMS/WhatsApp delivery)
    try {
      const secrets = getBridgeSecrets();
      const userId = secrets?.userId || (context as any)?.userId || (context as any)?.resourceId;
      if (userId) {
        const cloudReminders = await getCloudReminders(userId, {
          status: 'pending',
          start: start.toISOString(),
          end: end.toISOString(),
        });
        for (const cr of cloudReminders) {
          let dt: Date | null = null;
          try { dt = new Date(String(cr.remind_at)); } catch { dt = null; }
          if (!inRange(dt)) continue;
          items.push({
            id: `cloud-reminder:${String(cr.id ?? '')}`,
            title: String(cr.title || cr.message || 'Reminder'),
            provider: 'cloud',
            kind: 'reminder' as const,
            start: dt?.toISOString(),
            end: dt?.toISOString(),
            allDay: false,
            source: `cloud:${cr.delivery_method || 'sms'}`,
            raw: cr,
          });
        }
      }
    } catch {
      // Ignore cloud reminder failures
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

    // Cap total items to maxItems
    const maxItems = Number(c.maxItems || 50);
    const totalBeforeCap = items.length;
    const cappedItems = items.slice(0, maxItems);

    return { ok: true, items: cappedItems, total: totalBeforeCap, hasMore: totalBeforeCap > maxItems };
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
