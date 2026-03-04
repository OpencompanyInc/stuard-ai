/**
 * Offline Reminder Scheduler
 * Polls unified tasks for pending agent assignments (reminders) and fires
 * system notifications when they're due. Runs entirely in the main process
 * without any network dependency.
 * 
 * Also handles recurring reminders by creating the next occurrence after triggering.
 */

import { Notification, BrowserWindow } from 'electron';
import { unifiedTasksService } from './unified-tasks';
import logger from '../utils/logger';

const POLL_INTERVAL_MS = 15_000; // Check every 15 seconds
const SNOOZE_GRACE_MS = 5 * 60_000; // 5 minutes - don't re-notify within this window

let pollTimer: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

// Track already-fired reminder IDs to prevent duplicate notifications
const firedReminders = new Map<string, number>(); // id -> timestamp when fired

function cleanupFiredTracker() {
  const now = Date.now();
  const cutoff = now - 30 * 60_000; // Remove entries older than 30 min
  for (const [id, ts] of firedReminders.entries()) {
    if (ts < cutoff) firedReminders.delete(id);
  }
}

function sendNotification(title: string, body: string) {
  try {
    if (Notification.isSupported()) {
      const notif = new Notification({ title, body: body || '' });
      notif.show();
    }
  } catch (e) {
    logger.warn('[reminder-scheduler] Failed to send notification:', e);
  }

  // Also try to notify dashboard window
  try {
    const allWindows = BrowserWindow.getAllWindows();
    for (const win of allWindows) {
      if (!win.isDestroyed()) {
        win.webContents.send('reminder-triggered', { title, body, timestamp: Date.now() });
      }
    }
  } catch (e) {
    // Ignore
  }
}

function createNextRecurrence(taskId: string, assignment: any) {
  if (!assignment.recurring || assignment.recurring === 'none') return;

  try {
    const scheduledAt = new Date(assignment.scheduledAt);
    if (isNaN(scheduledAt.getTime())) return;

    let nextDate: Date;
    if (assignment.recurring === 'daily') {
      nextDate = new Date(scheduledAt);
      nextDate.setDate(nextDate.getDate() + 1);
    } else if (assignment.recurring === 'weekly') {
      nextDate = new Date(scheduledAt);
      nextDate.setDate(nextDate.getDate() + 7);
    } else if (assignment.recurring === 'monthly') {
      nextDate = new Date(scheduledAt);
      nextDate.setMonth(nextDate.getMonth() + 1);
    } else {
      return;
    }

    // Add the next occurrence
    unifiedTasksService.addAgentAssignment(taskId, {
      type: assignment.type || 'reminder',
      scheduledAt: nextDate.toISOString(),
      message: assignment.message,
      recurring: assignment.recurring,
    });

    logger.info(`[reminder-scheduler] Created next ${assignment.recurring} recurrence for task ${taskId} at ${nextDate.toISOString()}`);
  } catch (e) {
    logger.warn('[reminder-scheduler] Failed to create next recurrence:', e);
  }
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

      // Only fire if scheduled time has passed
      if (scheduledTime > now) continue;

      // Don't re-fire if already notified recently
      const lastFired = firedReminders.get(assignmentId);
      if (lastFired && (now - lastFired) < SNOOZE_GRACE_MS) continue;

      // Fire the notification
      const title = assignment.type === 'reminder'
        ? `⏰ Reminder: ${task.title}`
        : assignment.type === 'check-in'
          ? `📋 Check-in: ${task.title}`
          : `🔔 ${task.title}`;

      const body = assignment.message || task.description || 'Your scheduled reminder is due.';

      logger.info(`[reminder-scheduler] Firing ${assignment.type} for task "${task.title}" (${assignmentId})`);
      sendNotification(title, body);
      firedReminders.set(assignmentId, now);

      // Mark as triggered
      try {
        unifiedTasksService.updateAgentAssignment(task.id, assignmentId, {
          status: 'triggered',
          triggeredAt: new Date().toISOString(),
        });
      } catch (e) {
        logger.warn('[reminder-scheduler] Failed to mark assignment as triggered:', e);
      }

      // Handle recurring: create next occurrence
      if (assignment.recurring && assignment.recurring !== 'none') {
        createNextRecurrence(task.id, assignment);
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
          `Due in ${minsLeft} minute${minsLeft === 1 ? '' : 's'}${task.description ? ` — ${task.description}` : ''}`
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
