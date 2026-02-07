import { useState, useEffect, useCallback, useMemo } from 'react';

const DEFAULT_AGENT_HTTP = (window as any).__AGENT_HTTP__ || 'http://127.0.0.1:8765';
const AGENT_HTTP_CANDIDATES = (() => {
  const range: string[] = [];
  for (let p = 8765; p <= 8775; p++) range.push(`http://127.0.0.1:${p}`);
  return Array.from(new Set([DEFAULT_AGENT_HTTP, ...range, 'http://127.0.0.1:9090']));
})();
const CLOUD_AI_HTTP = (window as any).__CLOUD_AI_HTTP__ || (import.meta as any).env?.VITE_CLOUD_AI_URL || ((import.meta as any).env?.DEV ? 'http://127.0.0.1:8082' : 'https://cloud.stuard.ai');

export interface PlannerTask {
  id: string;
  title: string;
  due?: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  completed: boolean;
  tags?: string[];
  source?: 'agent' | 'unified'; // Where the task came from
  description?: string;
  subTodosTotal?: number;
  subTodosCompleted?: number;
}

export interface PlannerReminder {
  id: string;
  message: string;
  whenIso: string;
  whenEpochMs: number;
  taskId?: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay?: boolean;
  source: string;
}

export type UrgencyLevel = 'now' | 'soon' | 'upcoming' | 'later';

export interface NextUpItem {
  type: 'event' | 'task' | 'reminder';
  title: string;
  time: Date;
  timeLabel: string;
  icon: 'calendar' | 'task' | 'bell';
  urgency: UrgencyLevel;
  minutesUntil: number;
  raw: any;
}

export interface UsePlannerDataResult {
  tasks: PlannerTask[];
  reminders: PlannerReminder[];
  events: CalendarEvent[];
  nextUp: NextUpItem | null;
  tasksCount: number;
  dueTodayCount: number;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

function formatTimeUntil(date: Date): { label: string; urgency: UrgencyLevel; minutesUntil: number } {
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.round((getStartOfDay(date).getTime() - getStartOfDay(now).getTime()) / 86400000);
  
  // Determine urgency level
  let urgency: UrgencyLevel = 'later';
  if (diffMins <= 0) urgency = 'now';
  else if (diffMins <= 5) urgency = 'now';
  else if (diffMins <= 15) urgency = 'soon';
  else if (diffMins <= 60) urgency = 'upcoming';
  
  // Format label
  let label: string;
  if (diffMins <= 0) {
    label = 'now';
  } else if (diffMins === 1) {
    label = 'in 1 min';
  } else if (diffMins < 60) {
    label = `in ${diffMins} mins`;
  } else if (diffDays === 1) {
    label = 'tomorrow';
  } else if (diffDays > 1 && diffDays < 7) {
    label = `in ${diffDays} days`;
  } else if (diffHours === 1) {
    label = 'in 1 hour';
  } else if (diffHours < 24) {
    const remainingMins = diffMins % 60;
    if (remainingMins > 0 && diffHours < 3) {
      label = `in ${diffHours}h ${remainingMins}m`;
    } else {
      label = `in ${diffHours} hours`;
    }
  } else {
    label = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  
  return { label, urgency, minutesUntil: diffMins };
}

function getStartOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function getEndOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

function parseLocalDateOrIso(value: string): Date {
  const s = String(value || '').trim();
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(s);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    return new Date(y, mo - 1, d, 0, 0, 0, 0);
  }
  return new Date(s);
}

function parseTaskDueForNextUp(value: string): Date {
  const s = String(value || '').trim();
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(s);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    return new Date(y, mo - 1, d, 23, 59, 59, 999);
  }
  return new Date(s);
}

export function usePlannerData(accessToken?: string | null): UsePlannerDataResult {
  const [tasks, setTasks] = useState<PlannerTask[]>([]);
  const [reminders, setReminders] = useState<PlannerReminder[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0); // Force re-render for time updates
  const [agentOnline, setAgentOnline] = useState(false);
  const [agentHttp, setAgentHttp] = useState<string>(DEFAULT_AGENT_HTTP);

  const probeAgent = useCallback(async (timeoutMs: number): Promise<{ ok: boolean; baseUrl: string | null }> => {
    const perRequestTimeoutMs = Math.max(100, Math.floor(timeoutMs / Math.max(1, AGENT_HTTP_CANDIDATES.length)));

    const checks = AGENT_HTTP_CANDIDATES.map(async (baseUrl) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), perRequestTimeoutMs);
      try {
        const res = await fetch(`${baseUrl}/health`, { cache: 'no-store', signal: ctrl.signal });
        return res.ok ? baseUrl : null;
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    });

    const results = await Promise.all(checks);
    const found = results.find((v) => typeof v === 'string' && v.length > 0) || null;
    return { ok: Boolean(found), baseUrl: found };
  }, []);

  const fetchTasks = async (baseUrl: string): Promise<PlannerTask[] | null> => {
    try {
      const urls = [`${baseUrl}/v1/tasks/list`, `${baseUrl}/tasks/list`];
      for (const url of urls) {
        try {
          const res = await fetch(url);
          if (!res.ok) {
            continue;
          }
          const j = await res.json();
          if (j?.ok && Array.isArray(j.items)) {
            return j.items.filter((t: any) => !t.completed);
          }
        } catch (e) {
        }
      }
    } catch (e) {
    }
    return null;
  };

  const fetchReminders = async (baseUrl: string): Promise<PlannerReminder[] | null> => {
    try {
      const urls = [`${baseUrl}/v1/reminders/list`, `${baseUrl}/reminders/list`];
      for (const url of urls) {
        try {
          const res = await fetch(url);
          if (!res.ok) {
            continue;
          }
          const j = await res.json();
          if (j?.ok && Array.isArray(j.items)) {
            return j.items;
          }
        } catch (e) {
        }
      }
    } catch (e) {
    }
    return null;
  };

  const fetchCalendarEvents = async (): Promise<CalendarEvent[]> => {
    if (!accessToken) return [];
    try {
      const res = await fetch(`${CLOUD_AI_HTTP}/v1/calendar/events?view=week`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        setError(`Calendar fetch failed (${res.status})`);
        return [];
      }
      const j = await res.json();
      if (j?.ok && Array.isArray(j.blocks)) {
        return j.blocks.map((b: any) => ({
          id: b.id,
          title: b.title || '(No Title)',
          start: b.start,
          end: b.end,
          allDay: b.allDay,
          source: b.source || 'google',
        }));
      }
    } catch {}
    return [];
  };

  const fetchUnifiedTasks = async (): Promise<PlannerTask[]> => {
    try {
      const res = await (window as any).desktopAPI?.unifiedTasksGetCalendarItems?.();
      if (res?.ok && Array.isArray(res.items)) {
        return res.items
          .filter((t: any) => t.start || t.end)
          .map((t: any) => ({
            id: t.id,
            title: t.title,
            due: t.end || t.start,
            priority: t.priority || 'normal',
            completed: t.status === 'completed',
            source: 'unified' as const,
            subTodosTotal: t.subTodosTotal,
            subTodosCompleted: t.subTodosCompleted,
          }));
      }
    } catch (e) {
      console.warn('Failed to fetch unified tasks:', e);
    }
    return [];
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const eventsPromise = fetchCalendarEvents();
      const unifiedTasksPromise = fetchUnifiedTasks();

      let ok = agentOnline;
      let baseUrl = agentHttp;
      if (!ok) {
        const probed = await probeAgent(1500);
        ok = probed.ok;
        if (probed.baseUrl) baseUrl = probed.baseUrl;
      }

      if (baseUrl !== agentHttp) setAgentHttp(baseUrl);
      if (ok !== agentOnline) setAgentOnline(ok);

      const [agentTasks, r, e, unifiedTasks] = await Promise.all([
        ok ? fetchTasks(baseUrl) : Promise.resolve(null),
        ok ? fetchReminders(baseUrl) : Promise.resolve(null),
        eventsPromise,
        unifiedTasksPromise,
      ]);

      // Merge agent tasks with unified tasks
      const mergedTasks: PlannerTask[] = [];
      if (agentTasks !== null) {
        mergedTasks.push(...agentTasks.map((t: any) => ({ ...t, source: 'agent' as const })));
      }
      mergedTasks.push(...unifiedTasks);
      setTasks(mergedTasks);

      if (r !== null) setReminders(r);
      setEvents(e);

      if (ok && agentTasks === null && r === null) {
        setAgentOnline(false);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load planner data');
    } finally {
      setLoading(false);
    }
  }, [accessToken, agentOnline, agentHttp, probeAgent]);

  useEffect(() => {
    refresh();
    const refreshMs = agentOnline ? 30000 : 3000;
    const dataInterval = setInterval(refresh, refreshMs);
    const tickInterval = setInterval(() => setTick(t => t + 1), 10000);
    return () => {
      clearInterval(dataInterval);
      clearInterval(tickInterval);
    };
  }, [refresh, agentOnline]);

  // Compute next upcoming item (re-computed on tick for live time updates)
  const nextUp: NextUpItem | null = useMemo(() => {
    const now = new Date();
    const candidates: NextUpItem[] = [];

    // Calendar events
    for (const ev of events) {
      const start = parseLocalDateOrIso(ev.start);
      if (isNaN(start.getTime())) continue;

      const end = ev.end ? parseLocalDateOrIso(ev.end) : new Date(start.getTime() + 3600000);
      const safeEnd = isNaN(end.getTime()) ? new Date(start.getTime() + 3600000) : end;

      if (safeEnd < now) continue;

      const inFuture = start.getTime() >= now.getTime();
      const isOngoing = start.getTime() <= now.getTime() && safeEnd.getTime() >= now.getTime();
      if (!inFuture && !isOngoing) continue;

      const timeInfo = formatTimeUntil(start);
      candidates.push({
        type: 'event',
        title: ev.title,
        time: start,
        timeLabel: isOngoing ? 'happening now' : timeInfo.label,
        icon: 'calendar',
        urgency: isOngoing ? 'now' : timeInfo.urgency,
        minutesUntil: isOngoing ? 0 : timeInfo.minutesUntil,
        raw: ev,
      });
    }

    const overdueWindowStart = new Date(now.getTime() - 5 * 60000);

    // Reminders
    for (const rem of reminders) {
      const when = new Date(rem.whenIso);
      if (when >= overdueWindowStart) {
        const timeInfo = formatTimeUntil(when);
        candidates.push({
          type: 'reminder',
          title: rem.message,
          time: when,
          timeLabel: timeInfo.label,
          icon: 'bell',
          urgency: timeInfo.urgency,
          minutesUntil: timeInfo.minutesUntil,
          raw: rem,
        });
      }
    }

    const taskOverdueWindowStart = new Date(now.getTime() - 24 * 3600000);

    // Tasks with due dates
    for (const task of tasks) {
      if (task.due && !task.completed) {
        const due = parseTaskDueForNextUp(task.due);
        if (isNaN(due.getTime())) continue;
        if (due < taskOverdueWindowStart) continue;

        const timeInfo = formatTimeUntil(due);
        const isOverdue = due.getTime() < now.getTime();
        candidates.push({
          type: 'task',
          title: task.title,
          time: due,
          timeLabel: isOverdue ? 'overdue' : timeInfo.label,
          icon: 'task',
          urgency: isOverdue ? 'now' : timeInfo.urgency,
          minutesUntil: isOverdue ? 0 : timeInfo.minutesUntil,
          raw: task,
        });
      }
    }

    // Sort by time and pick closest
    const futureCandidates = candidates.filter((c) => c.time.getTime() >= now.getTime());
    futureCandidates.sort((a, b) => a.time.getTime() - b.time.getTime());
    if (futureCandidates[0]) return futureCandidates[0];

    const pastCandidates = candidates.filter((c) => c.time.getTime() < now.getTime());
    pastCandidates.sort((a, b) => b.time.getTime() - a.time.getTime());
    return pastCandidates[0] || null;
  }, [events, reminders, tasks, tick]);

  // Count tasks due today
  const today = getStartOfDay(new Date());
  const todayEnd = getEndOfDay(new Date());
  const dueTodayCount = tasks.filter(t => {
    if (!t.due || t.completed) return false;
    const due = parseLocalDateOrIso(t.due);
    return due >= today && due <= todayEnd;
  }).length;

  return {
    tasks,
    reminders,
    events,
    nextUp,
    tasksCount: tasks.filter(t => !t.completed).length,
    dueTodayCount,
    loading,
    error,
    refresh,
  };
}
