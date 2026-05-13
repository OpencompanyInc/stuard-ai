/**
 * Offline Reminder Scheduler
 * Polls unified tasks for pending agent assignments (reminders) and fires
 * system notifications when they're due. Runs entirely in the main process
 * without any network dependency.
 *
 * Also handles recurring reminders by updating the same assignment to the
 * next occurrence after triggering. Supports both the legacy string format
 * ('daily' | 'weekly' | 'monthly') and the dict format used by the cloud
 * agent's task_reminders tool: { frequency, interval?, days?, until?, count? }.
 */

import { Notification, BrowserWindow } from 'electron';
import { unifiedTasksService } from './unified-tasks';
import logger from '../utils/logger';

const POLL_INTERVAL_MS = 15_000; // Check every 15 seconds
const SNOOZE_GRACE_MS = 60_000; // 1 minute - in-memory dedupe within a poll cycle

let pollTimer: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

// Track already-fired reminder IDs to prevent duplicate notifications within a poll cycle.
// The persistent dedupe lives in assignment.status; this is purely for in-memory races.
const firedReminders = new Map<string, number>(); // id -> timestamp when fired

function cleanupFiredTracker() {
  const now = Date.now();
  const cutoff = now - 10 * 60_000; // Remove entries older than 10 min
  for (const [id, ts] of firedReminders.entries()) {
    if (ts < cutoff) firedReminders.delete(id);
  }
}

function sendNotification(title: string, body: string, assignmentId?: string, taskId?: string) {
  try {
    if (Notification.isSupported()) {
      const notif = new Notification({ title, body: body || '' });
      notif.show();
    }
  } catch (e) {
    logger.warn('[reminder-scheduler] Failed to send notification:', e);
  }

  // Also notify renderer windows for in-app toast (NotificationController + onReminderTriggered)
  try {
    const payload = { title, body, message: body, id: assignmentId, taskId, timestamp: Date.now() };
    const allWindows = BrowserWindow.getAllWindows();
    for (const win of allWindows) {
      if (!win.isDestroyed()) {
        win.webContents.send('reminder-triggered', payload);
      }
    }
  } catch (e) {
    // Ignore renderer notification failures
  }
}

type RecurrenceDict = {
  frequency?: 'daily' | 'weekly' | 'monthly' | 'yearly' | string;
  interval?: number;
  days?: number[]; // 0=Mon..6=Sun (matches Python schema)
  until?: string;
  count?: number;
};

type NormalizedRecurrence = {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  days?: number[];
  until?: string;
  count?: number;
};

/**
 * Normalize the `recurring` field on an assignment into a NormalizedRecurrence
 * or null when the reminder is one-time. Accepts the dict format used by the
 * cloud agent's tool, plus the legacy string format ('daily' | 'weekly' | 'monthly').
 */
function normalizeRecurrence(recurring: unknown): NormalizedRecurrence | null {
  if (!recurring) return null;
  if (typeof recurring === 'string') {
    const s = recurring.trim().toLowerCase();
    if (!s || s === 'none') return null;
    if (s === 'daily' || s === 'weekly' || s === 'monthly' || s === 'yearly') {
      return { frequency: s as any, interval: 1 };
    }
    return null;
  }
  if (typeof recurring !== 'object') return null;
  const r = recurring as RecurrenceDict;
  const freq = String(r.frequency || '').trim().toLowerCase();
  if (freq !== 'daily' && freq !== 'weekly' && freq !== 'monthly' && freq !== 'yearly') return null;
  const interval = Math.max(1, Math.floor(Number(r.interval ?? 1)) || 1);
  const out: NormalizedRecurrence = { frequency: freq as any, interval };
  if (Array.isArray(r.days) && r.days.length > 0) {
    out.days = r.days
      .map((d) => Math.floor(Number(d)))
      .filter((d) => Number.isFinite(d) && d >= 0 && d <= 6);
    if (out.days.length === 0) delete out.days;
  }
  if (typeof r.until === 'string' && r.until.trim()) out.until = r.until;
  if (typeof r.count === 'number' && r.count > 0) out.count = Math.floor(r.count);
  return out;
}

// Python convention: Mon=0..Sun=6. JS getDay: Sun=0..Sat=6. Convert.
function toPyWeekday(dt: Date): number {
  return (dt.getDay() + 6) % 7;
}

function daysInMonth(year: number, monthZeroBased: number): number {
  return new Date(year, monthZeroBased + 1, 0).getDate();
}

/**
 * Calculate the next occurrence time strictly AFTER `last`, based on recurrence rule.
 * Returns null if recurrence has ended (e.g., past `until`).
 */
function calculateNextOccurrence(last: Date, rec: NormalizedRecurrence): Date | null {
  let next: Date | null = null;

  if (rec.frequency === 'daily') {
    next = new Date(last);
    next.setDate(next.getDate() + rec.interval);
  } else if (rec.frequency === 'weekly') {
    if (rec.days && rec.days.length > 0) {
      const currentWeekday = toPyWeekday(last);
      const sortedDays = [...rec.days].sort((a, b) => a - b);
      const laterToday = sortedDays.find((d) => d > currentWeekday);
      if (laterToday !== undefined) {
        next = new Date(last);
        next.setDate(next.getDate() + (laterToday - currentWeekday));
      } else {
        const firstDay = sortedDays[0];
        const delta = 7 - currentWeekday + firstDay + 7 * Math.max(0, rec.interval - 1);
        next = new Date(last);
        next.setDate(next.getDate() + delta);
      }
    } else {
      next = new Date(last);
      next.setDate(next.getDate() + 7 * rec.interval);
    }
  } else if (rec.frequency === 'monthly') {
    next = new Date(last);
    const targetMonth = next.getMonth() + rec.interval;
    const targetYear = next.getFullYear() + Math.floor(targetMonth / 12);
    const monthMod = ((targetMonth % 12) + 12) % 12;
    const maxDay = daysInMonth(targetYear, monthMod);
    next.setFullYear(targetYear, monthMod, Math.min(last.getDate(), maxDay));
  } else if (rec.frequency === 'yearly') {
    next = new Date(last);
    next.setFullYear(next.getFullYear() + rec.interval);
  }

  if (!next || isNaN(next.getTime())) return null;

  if (rec.until) {
    try {
      const untilDt = new Date(rec.until);
      if (!isNaN(untilDt.getTime()) && next.getTime() > untilDt.getTime()) {
        return null;
      }
    } catch {
      // Ignore parse failure
    }
  }

  return next;
}

/**
 * After firing a recurring reminder, update the assignment in place to the
 * next occurrence (decrementing count if present). If recurrence has ended,
 * mark the assignment as completed.
 *
 * Returns true if the assignment is still pending (rescheduled), false if completed.
 */
function rescheduleOrCompleteRecurring(
  taskId: string,
  assignment: any,
  firedTime: Date,
  rec: NormalizedRecurrence,
): boolean {
  // Decrement count if present
  let updatedRec: NormalizedRecurrence | undefined = rec;
  if (typeof rec.count === 'number') {
    const remaining = rec.count - 1;
    if (remaining <= 0) {
      updatedRec = undefined;
    } else {
      updatedRec = { ...rec, count: remaining };
    }
  }

  if (!updatedRec) {
    // Last occurrence — mark completed
    try {
      unifiedTasksService.updateAgentAssignment(taskId, String(assignment.id), {
        status: 'completed',
        completedAt: new Date().toISOString(),
      });
    } catch (e) {
      logger.warn('[reminder-scheduler] Failed to mark recurring assignment completed:', e);
    }
    return false;
  }

  // Compute the next occurrence strictly after firedTime. If the scheduled time
  // was far in the past, fast-forward past `now` so we don't fire a backlog of
  // missed occurrences on every poll.
  let nextDate = calculateNextOccurrence(firedTime, updatedRec);
  if (!nextDate) {
    // Recurrence ended via `until`
    try {
      unifiedTasksService.updateAgentAssignment(taskId, String(assignment.id), {
        status: 'completed',
        completedAt: new Date().toISOString(),
      });
    } catch {}
    return false;
  }

  const now = Date.now();
  let skipped = 0;
  let activeRec: NormalizedRecurrence | null = updatedRec;
  while (nextDate && activeRec && nextDate.getTime() <= now && skipped < 1000) {
    const curCount = activeRec.count;
    if (typeof curCount === 'number') {
      const remaining: number = curCount - 1;
      if (remaining <= 0) {
        activeRec = null;
        nextDate = null;
        break;
      }
      activeRec = { ...activeRec, count: remaining };
    }
    nextDate = activeRec ? calculateNextOccurrence(nextDate, activeRec) : null;
    skipped++;
  }
  updatedRec = activeRec ?? (undefined as any);

  if (!nextDate || !updatedRec) {
    try {
      unifiedTasksService.updateAgentAssignment(taskId, String(assignment.id), {
        status: 'completed',
        completedAt: new Date().toISOString(),
      });
    } catch {}
    return false;
  }

  try {
    unifiedTasksService.updateAgentAssignment(taskId, String(assignment.id), {
      scheduledAt: nextDate.toISOString(),
      recurring: updatedRec,
      status: 'pending',
      triggeredAt: null,
    });
    logger.info(
      `[reminder-scheduler] Rescheduled recurring assignment ${assignment.id} to ${nextDate.toISOString()}${skipped ? ` (skipped ${skipped} missed occurrences)` : ''}`,
    );
  } catch (e) {
    logger.warn('[reminder-scheduler] Failed to reschedule recurring assignment:', e);
    return false;
  }
  return true;
}

function checkPendingReminders() {
  try {
    cleanupFiredTracker();

    const result = unifiedTasksService.getPendingAssignments();
    if (!result.ok || !Array.isArray(result.pending)) return;

    const now = Date.now();

    for (const { task, assignment } of result.pending) {
      if (!assignment || !task) continue;

      const assignmentId = String(assignment.id);
      const scheduledTime = new Date(assignment.scheduledAt).getTime();

      if (isNaN(scheduledTime)) continue;
      if (scheduledTime > now) continue;

      // Persistent dedupe via assignment.status — only fire when still pending
      if (assignment.status && assignment.status !== 'pending') continue;

      // In-memory dedupe to prevent racing with concurrent fire paths
      const lastFired = firedReminders.get(assignmentId);
      if (lastFired && now - lastFired < SNOOZE_GRACE_MS) continue;

      const title = assignment.type === 'reminder'
        ? `⏰ Reminder: ${task.title}`
        : assignment.type === 'check-in'
          ? `📋 Check-in: ${task.title}`
          : `🔔 ${task.title}`;

      const body = assignment.message || task.description || 'Your scheduled reminder is due.';

      logger.info(`[reminder-scheduler] Firing ${assignment.type} for task "${task.title}" (${assignmentId})`);
      sendNotification(title, body, assignmentId, task.id);
      firedReminders.set(assignmentId, now);

      const rec = normalizeRecurrence(assignment.recurring);
      if (rec) {
        // Reschedule the same assignment in place. Use the original scheduledTime
        // as the anchor so the cadence is preserved even if we polled late.
        const firedAnchor = new Date(scheduledTime);
        rescheduleOrCompleteRecurring(task.id, assignment, firedAnchor, rec);
      } else {
        // Non-recurring: mark completed so it doesn't show in pending lists
        try {
          unifiedTasksService.updateAgentAssignment(task.id, assignmentId, {
            status: 'completed',
            completedAt: new Date().toISOString(),
            triggeredAt: new Date().toISOString(),
          });
        } catch (e) {
          logger.warn('[reminder-scheduler] Failed to mark assignment as completed:', e);
        }
      }
    }
  } catch (e) {
    logger.warn('[reminder-scheduler] Error checking pending reminders:', e);
  }
}

/**
 * Also check tasks approaching their due date and notify.
 * Fires a notification if a task is due within 15 minutes and hasn't been notified.
 */
const dueDateNotified = new Map<string, number>(); // taskId -> timestamp

function checkUpcomingDueDates() {
  try {
    const result = unifiedTasksService.list();
    if (!result.ok || !Array.isArray(result.tasks)) return;

    const now = Date.now();
    const fifteenMin = 15 * 60_000;

    for (const task of result.tasks) {
      if (task.status === 'completed' || task.status === 'cancelled') continue;
      if (!task.dueDate) continue;

      const due = new Date(task.dueDate).getTime();
      if (isNaN(due)) continue;

      // Check if due within the next 15 minutes
      const timeUntilDue = due - now;
      if (timeUntilDue > 0 && timeUntilDue <= fifteenMin) {
        const lastNotified = dueDateNotified.get(task.id);
        if (lastNotified && (now - lastNotified) < fifteenMin) continue;

        const minsLeft = Math.ceil(timeUntilDue / 60_000);
        sendNotification(
          `📅 Task due soon: ${task.title}`,
          `Due in ${minsLeft} minute${minsLeft === 1 ? '' : 's'}${task.description ? ` — ${task.description}` : ''}`,
          undefined,
          task.id,
        );
        dueDateNotified.set(task.id, now);
      }
    }

    // Cleanup old entries
    const cutoff = now - 60 * 60_000;
    for (const [id, ts] of dueDateNotified.entries()) {
      if (ts < cutoff) dueDateNotified.delete(id);
    }
  } catch (e) {
    // Ignore
  }
}

/**
 * Clear the in-memory dedupe entry for an assignment. Call this when a
 * reminder is updated (e.g. scheduled to a new time) so the next firing
 * is not suppressed by the SNOOZE_GRACE_MS guard.
 */
export function clearFiredReminder(assignmentId: string) {
  firedReminders.delete(String(assignmentId));
}

export function startReminderScheduler() {
  if (isRunning) return;
  isRunning = true;

  logger.info('[reminder-scheduler] Starting offline reminder scheduler');

  // Initial check after a short delay (allow app to fully initialize)
  setTimeout(() => {
    checkPendingReminders();
    checkUpcomingDueDates();
  }, 3000);

  // Poll periodically
  pollTimer = setInterval(() => {
    checkPendingReminders();
    checkUpcomingDueDates();
  }, POLL_INTERVAL_MS);
}

export function stopReminderScheduler() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  isRunning = false;
  logger.info('[reminder-scheduler] Stopped offline reminder scheduler');
}

export function isReminderSchedulerRunning() {
  return isRunning;
}
